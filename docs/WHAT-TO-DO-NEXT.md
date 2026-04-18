# AfriStay — Manual Setup Checklist
> Everything that can't be done from code. Follow in order.

---

## ✅ Already Done (no action needed)
- Request booking page: `/Listings/Checkout/request/`
- `detail.js` redirects to new request page
- `send-email` v8 deployed — all email templates ready
- `booking-expiry-reminder` edge function deployed
- `reminder_sent_at` column added to bookings
- Duplicate approval/rejection emails removed from `dashboard.js`
- IremboPay secrets stored: `IREMBO_PUBLIC_KEY`, `IREMBO_SECRET_KEY`, `IREMBO_CALLBACK_URL`

---

## 1. Run SQL — Add Missing Columns

**Supabase Dashboard → SQL Editor:**

```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS irembo_reference text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_reference text;
```

---

## 2. Set Up pg_cron — Expiry Reminder Job

**Supabase Dashboard → SQL Editor** (replace `YOUR_SERVICE_ROLE_KEY` from Settings → API):

```sql
SELECT cron.schedule(
  'booking-expiry-reminder',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url    := 'https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/booking-expiry-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body   := '{}'::jsonb
  );
  $$
);
```

Verify: `SELECT * FROM cron.job WHERE jobname = 'booking-expiry-reminder';`

---

## 3. Email Templates — Status

| Template | Where it lives | Status |
|---|---|---|
| New booking request → owner + admins | `send-email` v8 (`booking_request_all`) | ✅ Ready |
| Guest booking confirmation | `send-email` v8 (`booking_received_user`) | ✅ Ready |
| Guest approval email | `approve-booking` edge fn (`approvedEmail()`) | ✅ Ready — will show IremboPay payment link after Step 4 |
| Guest rejection email | `reject-booking` edge fn (`guestRejectedEmail()`) | ✅ Ready |
| Guest expiry warning | `send-email` v8 (`booking_expiry_reminder_user`) | ✅ Ready |
| Guest payment confirmed | `irembo-webhook` edge fn (custom email) | ⏳ Deploy in Step 4 |

---

## 4. IremboPay — Wire Up Payments (Next Session)

> See `docs/irembo-pay-setup.md` for full code.

**4a.** Update `approve-booking` edge function:
- In `doApprove()`, after DB update, call IremboPay invoice API using `IREMBO_PUBLIC_KEY` and `IREMBO_CALLBACK_URL`
- Store `invoice.invoice_id` → `bookings.irembo_reference`
- Pass `invoice.payment_url` as the CTA link in the approval email (replaces old `/Checkout/confirm/` link)
- Redeploy

**4b.** Create + deploy `irembo-webhook` edge function:
- Full source in `docs/irembo-pay-setup.md` Step 4
- Uses `IREMBO_SECRET_KEY` for HMAC verification
- On SUCCESS: sets `status=confirmed`, `payment_status=paid`, emails guest
- Deploy: `npx supabase functions deploy irembo-webhook --no-verify-jwt --project-ref xuxzeinufjpplxkerlsd`

**4c.** Create `/Listings/Checkout/result/` page:
- Post-payment landing page IremboPay redirects to
- Read `booking_id` from URL, show confirmation card

---

## 5. Test Checklist

- [ ] Detail page → "Request to Book" → lands on `/Listings/Checkout/request/`
- [ ] Submit request → owner + admins get emails, guest gets confirmation
- [ ] Approve booking → guest gets ONE email with payment link
- [ ] Reject booking → guest gets ONE email with rejection notice
- [ ] pg_cron fires → expiry reminder emails sent
- [ ] Full IremboPay sandbox payment flow works end to end

---

## 6. Booking Flow (current → future)

```
Guest → /Listings/Checkout/request/ → submits form
  ↓ store-booking (status: awaiting_approval)
  ↓ send-email: booking_request_all → owner + admins + guest
Owner approves in dashboard
  ↓ approve-booking edge fn
  ↓ [NOW]  emails "Confirm My Stay" link → /Checkout/confirm/
  ↓ [SOON] creates IremboPay invoice → emails payment_url to guest
Guest pays on IremboPay hosted page
  ↓ irembo-webhook fires
  ↓ status: confirmed, payment_status: paid
  ↓ emails guest payment confirmation
  ↓ redirects to /Listings/Checkout/result/
```
