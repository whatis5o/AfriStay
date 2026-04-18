# IremboPay Integration Guide — AfriStay

## Overview

IremboPay is Rwanda's government-backed payment gateway. Guests pay via card or Mobile Money. AfriStay uses it **after owner approval** — the guest gets a payment link, clicks it, pays on IremboPay's hosted page, then a webhook confirms the booking.

---

## Step 1: Get Your API Keys

✅ **Keys already obtained and stored in Supabase secrets:**

| Secret Name | Value | Purpose |
|---|---|---|
| `IREMBO_PUBLIC_KEY` | your Public Key | API auth header when creating invoices |
| `IREMBO_SECRET_KEY` | your Secret Key | HMAC-SHA256 verification of incoming webhooks |
| `IREMBO_CALLBACK_URL` | your Current Callback URL | The URL IremboPay POSTs to when payment completes |

To add/view secrets: **Supabase Dashboard → Edge Functions → Manage Secrets**

---

## Step 2: Create an Invoice (when owner approves booking)

After the owner approves, call IremboPay to create an invoice and get a payment URL.

### API call (inside `approve-booking` edge function, in `doApprove()`)

```typescript
const invoiceRes = await fetch('https://api.irembo.gov.rw/v1/invoices', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${Deno.env.get('IREMBO_PUBLIC_KEY')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    amount: b.total_amount,
    currency: 'RWF',
    description: `AfriStay booking: ${b.listings?.title}`,
    callback_url: Deno.env.get('IREMBO_CALLBACK_URL'),   // from Supabase secrets
    return_url: `https://afristay.rw/Listings/Checkout/result/?booking_id=${bookingId}`,
    customer: {
      name: b.guest_name,
      email: guestEmail,
      phone: b.guest_phone,   // +250XXXXXXXXX
    },
    reference: bookingId,     // your internal booking ID
  }),
});
const invoice = await invoiceRes.json();
// invoice.payment_url → replace confirmUrl in the approval email
// invoice.invoice_id  → store in bookings.irembo_reference
await sb.from('bookings').update({ irembo_reference: invoice.invoice_id }).eq('id', bookingId);
```

Then pass `invoice.payment_url` as `confirmUrl` in the `approvedEmail()` call (replaces the old `/Checkout/confirm/` link).

### Required SQL (run in Supabase SQL Editor)

```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS irembo_reference text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_reference text;
```

---

## Step 3: IremboPay Hosted Payment Page

The guest clicks the link → lands on IremboPay's hosted page → pays via:
- **Card** (Visa/Mastercard)
- **MTN Mobile Money**
- **Airtel Money**

No custom payment UI needed — IremboPay handles everything.

---

## Step 4: Receive the Webhook

IremboPay POSTs to your `IREMBO_CALLBACK_URL` when payment completes.

### Edge function: `irembo-webhook`

Deploy: `npx supabase functions deploy irembo-webhook --no-verify-jwt --project-ref xuxzeinufjpplxkerlsd`

```typescript
// supabase/functions/irembo-webhook/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.177.0/node/crypto.ts';

serve(async (req) => {
  const body      = await req.text();
  const signature = req.headers.get('x-irembo-signature') || '';
  const secret    = Deno.env.get('IREMBO_SECRET_KEY')!;

  // Verify HMAC-SHA256 signature
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  if (signature !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = JSON.parse(body);
  // payload.status: 'SUCCESS' | 'FAILED' | 'CANCELLED'
  // payload.reference: booking ID
  // payload.transaction_id: IremboPay transaction ID

  if (payload.status !== 'SUCCESS') {
    return new Response('OK', { status: 200 }); // acknowledge but don't confirm
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: booking } = await sb
    .from('bookings')
    .update({
      status:            'confirmed',
      payment_status:    'paid',
      paid_at:           new Date().toISOString(),
      payment_reference: payload.transaction_id,
    })
    .eq('id', payload.reference)
    .select('*, listings(title)')
    .single();

  if (!booking) return new Response('Booking not found', { status: 404 });

  // Email guest payment confirmation
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type:         'custom',
      to:           booking.guest_email,
      subject:      `Payment confirmed — ${booking.listings?.title}`,
      body:         `Hi ${booking.guest_name},\n\nYour payment of ${booking.total_amount} RWF has been received and your booking is confirmed!\n\nRef: #${String(booking.id).slice(0,8).toUpperCase()}\nProperty: ${booking.listings?.title}\nCheck-in: ${booking.start_date}\nCheck-out: ${booking.end_date}\n\nSee you soon!`,
      sender_name:  'AfriStay',
      sender_email: 'info@afristay.rw',
      sender_title: "Rwanda's Premier Rental Platform",
    }),
  });

  return new Response('OK', { status: 200 });
});
```

### Webhook URL (already registered with IremboPay as IREMBO_CALLBACK_URL):
```
https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/irembo-webhook
```

---

## Step 5: Webhook Payload Example

```json
{
  "status": "SUCCESS",
  "reference": "your-booking-uuid",
  "invoice_id": "INV-2026-XXXXX",
  "amount": 50000,
  "currency": "RWF",
  "transaction_id": "TXN-XXXXXXXX",
  "payment_method": "MOBILE_MONEY",
  "customer_phone": "+250781234567",
  "paid_at": "2026-04-18T14:30:00Z"
}
```

---

## Step 6: Test in Sandbox

- **Card**: `4111 1111 1111 1111`, any future expiry, CVV `123`
- **MoMo test number**: `0781234567` (sandbox only)
- Sandbox base URL: `https://sandbox-api.irembo.gov.rw/v1/`
- Production URL: `https://api.irembo.gov.rw/v1/`

---

## Summary Checklist

- [x] Registered at IremboPay portal — got Public Key, Secret Key, Callback URL
- [x] Added `IREMBO_PUBLIC_KEY`, `IREMBO_SECRET_KEY`, `IREMBO_CALLBACK_URL` to Supabase secrets
- [ ] Run SQL — add `irembo_reference`, `paid_at`, `payment_reference` columns
- [ ] Update `approve-booking` edge function — create IremboPay invoice + use `payment_url` in approval email
- [ ] Deploy `irembo-webhook` edge function
- [ ] Test in sandbox before going live
