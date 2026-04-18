# AfriStay 🇷🇼
**Rwanda's Premier Property & Vehicle Rental Platform**

AfriStay connects property owners and vehicle renters with guests across Rwanda.
Built by Josue, Sabin, and Artur under **King Technologies**.

Live at → [afristay.rw](https://afristay.rw)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript — no framework, no build step |
| Backend / Auth | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| Payments | IremboPay (Rwanda's national payment gateway) |
| Email | Resend (`bookings@dm.afristay.rw`) |
| Fonts & Icons | Google Fonts (Sora, Playfair Display) + Font Awesome 6 |
| Hosting | cPanel / afristay.rw |

---

## Pages

| Route | Description |
|---|---|
| `/` | Home — hero, featured listings carousel |
| `/Listings/` | Browse all approved + available listings with filters |
| `/Listings/Detail/` | Single listing — gallery, map, booking |
| `/Listings/Checkout/request/` | Booking request form (no payment upfront) |
| `/Listings/Checkout/approve/` | Owner approve/reject page (from email link) |
| `/Listings/Checkout/result/` | Post-payment confirmation page |
| `/Auth/` | Sign in / Sign up / Forgot password |
| `/Dashboards/Profile/` | User profile — bookings, favorites, settings |
| `/Dashboards/Owner/` | Owner dashboard — listings, bookings, earnings |
| `/Dashboards/Admin/` | Admin dashboard — all listings, users, financials |
| `/Events/` | Events & promotions |
| `/Favorites/` | Saved listings |
| `/About/` | About AfriStay |
| `/Contact/` | Contact form |
| `/Privacy/` | Privacy policy |
| `/Terms/` | Terms & conditions |

---

## Booking Flow

```
Guest requests booking (no payment upfront)
        ↓
Owner + Admins receive email with Approve / Reject buttons
        ↓
Owner approves → IremboPay invoice created → Guest gets payment link by email
        ↓
Guest pays on IremboPay hosted page (card or Mobile Money)
        ↓
IremboPay fires webhook → booking confirmed → Guest gets receipt email
```

---

## Edge Functions (Supabase)

| Function | Purpose |
|---|---|
| `store-booking` | Creates booking record, validates availability |
| `send-email` | All transactional emails via Resend |
| `approve-booking` | Approves/rejects bookings, creates IremboPay invoice |
| `irembo-webhook` | Receives IremboPay payment confirmation (no JWT) |
| `booking-expiry-reminder` | Hourly cron — alerts owner + admin before expiry |
| `delete-account` | GDPR account deletion |

---

## Environment Secrets (Supabase)

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected |
| `RESEND_API_KEY` | Resend email API |
| `IREMBO_SECRET_KEY` | IremboPay API auth + webhook HMAC verification |
| `IREMBO_PUBLIC_KEY` | IremboPay public key |
| `IREMBO_PAYMENT_ACCOUNT` | Payment account identifier from IremboPay portal |
| `IREMBO_PRODUCT_CODE` | Product code from IremboPay portal |
| `IREMBO_CALLBACK_URL` | Webhook URL registered with IremboPay |
| `SITE_ORIGIN` | `https://afristay.rw` |

---

## Go Live

See [`docs/GO-LIVE-CHECKLIST.md`](docs/GO-LIVE-CHECKLIST.md) for the full checklist and monitoring guide.

**Quick summary:**
1. Swap Supabase secrets to live IremboPay credentials
2. Change `IREMBO_BASE_URL` in `approve-booking/index.ts` → `https://api.irembopay.com/payments`
3. Redeploy `approve-booking`
4. Run one live test end-to-end

---

## Local Development

No build step — serve with any static server:

```bash
npx serve .
# or
python -m http.server 8080
```

Update `/js/config.js` to point to a different Supabase project if needed.

---

## Deploy Edge Functions

```bash
npx supabase functions deploy approve-booking --no-verify-jwt --project-ref xuxzeinufjpplxkerlsd
npx supabase functions deploy irembo-webhook --no-verify-jwt --project-ref xuxzeinufjpplxkerlsd
npx supabase functions deploy send-email --project-ref xuxzeinufjpplxkerlsd
npx supabase functions deploy store-booking --project-ref xuxzeinufjpplxkerlsd
npx supabase functions deploy booking-expiry-reminder --project-ref xuxzeinufjpplxkerlsd
npx supabase functions deploy delete-account --project-ref xuxzeinufjpplxkerlsd
```

---

© 2026 AfriStay · King Technologies · Rwanda
