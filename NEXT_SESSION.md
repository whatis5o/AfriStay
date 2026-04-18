# AfriStay — Next Session Tasks

## ✅ Completed
- Request booking page: `/Listings/Checkout/request/`
- `detail.js` redirects to request page
- `send-email` deployed — all email templates, admin email with commission + owner contact + approve/reject buttons
- `approve-booking` v23 deployed — full IremboPay sandbox integration (creates invoice on approve, sends payment link to guest)
- `booking-expiry-reminder` edge function deployed
- `reminder_sent_at` column added to bookings
- Duplicate emails removed from `dashboard.js`
- IremboPay secrets stored: `IREMBO_PUBLIC_KEY`, `IREMBO_SECRET_KEY`, `IREMBO_CALLBACK_URL`
- Admin email now shows: commission (10%), owner contact (name, email, phone), approve/reject token buttons, "call owner" note
- Owner email now shows: approve/reject token buttons directly in email

---

## Remaining — Do These Next

### 1. Run SQL (Supabase Dashboard → SQL Editor)

```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS irembo_reference text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_reference text;
```

---

### 2. Set Up pg_cron — Expiry Reminder (Supabase Dashboard → SQL Editor)

Replace `YOUR_SERVICE_ROLE_KEY` with key from Settings → API:

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

---

### 3. Create + Deploy `irembo-webhook` Edge Function

Full source code is in `docs/irembo-pay-setup.md` Step 4.
Uses `IREMBO_SECRET_KEY` (already in secrets) for HMAC verification.

On SUCCESS webhook: sets `status=confirmed`, `payment_status=paid`, `paid_at`, `payment_reference`, emails guest confirmation.

Deploy:
```bash
npx supabase functions deploy irembo-webhook --no-verify-jwt --project-ref xuxzeinufjpplxkerlsd
```

**Webhook URL** (already registered as `IREMBO_CALLBACK_URL`):
```
https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/irembo-webhook
```

---

### 4. Create `/Listings/Checkout/result/` Page

Post-payment page IremboPay redirects to after guest pays.
**Prompt:**
> Create `/Listings/Checkout/result/index.html`. Read `booking_id` from URL params. Fetch booking from Supabase (status, guest_name, listing title, start_date, end_date, total_amount, booking_reference). If `status === 'confirmed'`: show green confirmation card ("Payment received! Booking confirmed. Ref: #XXXXXXXX"). If not confirmed yet: show "Processing payment..." and poll every 5 seconds up to 30s, then show "Contact us if payment isn't confirmed shortly." Match AfriStay brand (EB6753 accent, dark navy footer, Inter font).

---

### 5. Admin Expiry Reminder Email — Different Content for Admin

Currently `booking-expiry-reminder` sends the same `booking_request` email type to both owner and admin. Admin should get a different email: "⏰ Booking expiring soon — call the owner NOW and remind them to respond."

**Prompt:**
> Update `supabase/functions/booking-expiry-reminder/index.ts`. When emailing admins (query profiles where role='admin'), use a different message: subject "⏰ ACTION NEEDED: Booking expiring in ~Xh — contact owner", body should include owner contact (name, email, phone), guest details, booking details, and a strong CTA to call the owner. Use the existing `send-email` function's `booking_request` type with `_subject_override` plus `is_admin: true`, OR add a new `booking_expiry_reminder_admin` type to `send-email`. Redeploy both functions.

---

### 6. Rejection Email — Include Similar Listings

Currently the rejection email just has a "Browse Listings" button. It should show 2-3 actual similar listings (same category, same location district, similar price range).

**Prompt:**
> Update `supabase/functions/approve-booking/index.ts` in `doReject()`. After updating booking status, query: `SELECT id, title, price_per_unit, currency, category_slug, location FROM listings WHERE availability_status='available' AND category_slug = <booking.category_slug> AND id != <booking.listing_id> LIMIT 3`. Pass these as `similar_listings` to `rejectedEmail()`. Update `rejectedEmail()` to render a "Similar Listings" section with title, price, and a "View" link to `/Listings/<category>/<id>`. Redeploy.

---

### 7. Tell me the commission % so I can update from hardcoded 10%

Currently `COMMISSION_PCT = 0.10` in `send-email/index.ts` line ~692. If your rate is different, say the % and I'll update + redeploy.

---

## Key Context
- Supabase project: `xuxzeinufjpplxkerlsd`
- IremboPay: sandbox mode (`sandbox-api.irembo.gov.rw`) — switch to production when live
- IremboPay secrets: `IREMBO_PUBLIC_KEY`, `IREMBO_SECRET_KEY`, `IREMBO_CALLBACK_URL` (all stored ✅)
- `approve-booking` v23: tries IremboPay first, falls back to `/Checkout/confirm/` if keys missing
- Commission = 10% of total — update `COMMISSION_PCT` in `send-email/index.ts` if different
- Admin emails come from profiles with `role='admin'` in DB — no hardcoding needed
- Full flow: request → owner+admin emailed with approve/reject buttons → approve → IremboPay invoice → guest gets payment link → pays → irembo-webhook confirms → result page
