# AfriStay — Go Live Checklist

## Step 1: Update Supabase Secrets
Go to **Supabase Dashboard → Edge Functions → Manage Secrets** and update:

| Secret | Change to |
|---|---|
| `IREMBO_SECRET_KEY` | Live secret key from IremboPay portal |
| `IREMBO_PUBLIC_KEY` | Live public key from IremboPay portal |
| `IREMBO_PAYMENT_ACCOUNT` | Live payment account identifier |
| `IREMBO_PRODUCT_CODE` | Live product code |
| `IREMBO_CALLBACK_URL` | Should already be correct — confirm it's `https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/irembo-webhook` |

---

## Step 2: Switch approve-booking to Production API

In `supabase/functions/approve-booking/index.ts` line 22, change:
```
const IREMBO_BASE_URL = 'https://api.sandbox.irembopay.com/payments';
```
to:
```
const IREMBO_BASE_URL = 'https://api.irembopay.com/payments';
```

Then redeploy:
```bash
npx supabase functions deploy approve-booking --no-verify-jwt --project-ref xuxzeinufjpplxkerlsd
```

---

## Step 3: Confirm IremboPay Portal Settings
- Webhook/callback URL is set to: `https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/irembo-webhook`
- Payment account is active and verified
- Product code is live (not sandbox)

---

## Step 4: Do One Live Test Before Announcing
1. Submit a real booking request (use a real listing, real email)
2. Approve it as owner
3. Check that the payment email arrives with a **live** IremboPay link
4. Pay a small amount (or ask IremboPay if they have a live test process)
5. Confirm booking goes to `confirmed` in the dashboard
6. Confirm receipt email arrives

---

## Step 5: Remove the "Payment Coming Soon" Ticker
The red ticker bar on the checkout page saying "PAYMENT SERVICES NOT AVAILABLE YET" is in:
`Listings/Checkout/index.html` — but that page now redirects to `/request/`.

Check if it appears anywhere on the site and remove it.

---

## Things to Monitor Daily (First 2 Weeks)

### Supabase Dashboard → Edge Functions → Logs
Watch these functions for errors:
| Function | What to watch for |
|---|---|
| `approve-booking` | Any 400/500 responses — means invoice creation failed |
| `irembo-webhook` | Any 401 responses — means signature mismatch |
| `irembo-webhook` | Any 404 responses — means booking ID not found |
| `send-email` | Any 500 responses — means Resend is failing |
| `store-booking` | Any 400 responses — means booking creation failing |

### Supabase Dashboard → Table Editor → bookings
Watch for bookings stuck in `approved` with no `irembo_reference` — means invoice creation failed silently.

Run this SQL weekly to catch stuck bookings:
```sql
SELECT id, booking_reference, guest_name, guest_email, status, payment_status, irembo_reference, created_at
FROM bookings
WHERE status = 'approved'
AND irembo_reference IS NULL
AND created_at > NOW() - INTERVAL '7 days';
```

### Bookings stuck as `approved` but never paid
Guests have 48 hours to pay the IremboPay link. After that the invoice expires. Watch for:
```sql
SELECT id, booking_reference, guest_name, status, approved_at
FROM bookings
WHERE status = 'approved'
AND payment_status = 'unpaid'
AND approved_at < NOW() - INTERVAL '48 hours';
```
These guests need a follow-up — either re-approve to generate a new invoice or cancel.

### IremboPay Portal
- Check transaction history daily for the first week
- Make sure PAID transactions match `confirmed` bookings in your DB
- If a payment shows PAID in IremboPay but booking is still `approved` in DB → webhook failed → manually update via SQL or dashboard

---

## Emergency Fixes

### Webhook not firing (booking paid but still `approved`)
Manually confirm via SQL:
```sql
UPDATE bookings
SET status = 'confirmed', payment_status = 'paid', paid_at = NOW(), payment_reference = 'MANUAL-FIX'
WHERE id = 'BOOKING_UUID_HERE';
```

### Guest paid but didn't get receipt email
Trigger manually via Supabase → Edge Functions → send-email → test with:
```json
{
  "type": "custom",
  "to": "guest@email.com",
  "subject": "Your booking is confirmed — AfriStay",
  "body": "Your payment was received and booking confirmed. Ref: #XXXXXX"
}
```

### Re-send payment link to guest (invoice expired)
Re-approve the booking from the dashboard — this creates a new IremboPay invoice and sends a fresh payment email.

---

## Commission Reminder
Currently hardcoded at **10%** in `supabase/functions/send-email/index.ts` around line 692.
Update `COMMISSION_PCT = 0.10` if your rate changes.

---

## You're Live 🇷🇼
Full flow working:
**Request → Owner approves → IremboPay payment email → Guest pays → Webhook confirms → Receipt email**
