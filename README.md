# AfriStay — Rwanda Property & Vehicle Rental Platform

**AfriStay** (`afristay.rw`) connects property owners and vehicle renters with guests across Rwanda. Built by Josue, Sabin, and Artur under **King Technologies** — part of the broader Rwanda App Hub vision.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript (no framework, no build step) |
| Backend / Auth | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| Payments | Irembo Pay (dummy edge function; swap with live credentials when ready) |
| Email | Brevo Transactional API (`bookings@afristay.rw`) |
| Icons | Font Awesome 6 |
| Fonts | Google Fonts — Inter |

---

## Pages

| Route | Description |
|---|---|
| `/` | Home — featured listings carousel |
| `/Listings/` | Browse all approved + available listings with filters |
| `/Detail/?id=` | Single listing — gallery, booking form, reviews |
| `/Auth/` | Sign in / Sign up / Forgot password |
| `/Checkout/` | Booking checkout — card or MoMo payment via Irembo Pay |
| `/Profile/` | User profile — bookings, favorites, receipts |
| `/Dashboard/` | Admin + Owner dashboard |
| `/Events/` | Events listing page |
| `/Event/?id=` | Single event detail |
| `/Favorites/` | Saved listings |
| `/Contact/` | Contact form |
| `/About/` | About page |

---

## User Roles

| Role | Access |
|---|---|
| `user` | Browse, book, favorite, review |
| `owner` | All user access + manage own listings, bookings, promotions |
| `admin` | Full dashboard — users, all listings, bookings, events, promotions, messages |

---

## Key Features

### Listings
- Filter by province, district, sector, category (vehicle / real estate)
- Only `approved` + `available` listings shown publicly
- Owners submit → admins approve before going live

### Promotions
- Admin or owner sets a % discount with start and end date on a specific listing
- Active promotions automatically reduce the displayed price on the home page, listings page, and detail page
- Crossed-out original price + "X% OFF" badge + promo end date shown
- Price reverts automatically once the end date passes — no manual action needed

### Bookings & Payments
- Supports **card** (name, number, expiry MM/YY, CVV) and **Mobile Money** (MTN / Airtel)
- Two-step flow: `irembo-pay` edge function validates payment details → `store-booking` edge function saves the booking
- Pay on arrival bypasses Irembo Pay entirely

### Favorites
- Heart icon on every listing card — click to save / unsave
- Synced to `favorites` table when logged in; prompts sign-in when logged out

### Reviews
- Gated by `platform_config` key `open_reviews`:
  - `true` → any logged-in user can review (open / testing mode)
  - `false` / missing → only guests with a completed booking can review

### Forgot Password
- User requests reset email → Supabase sends link → user lands on `/Auth/` → auto-switches to "New Password" form → password updated, redirected to sign in

---

## Database Tables

| Table | Purpose |
|---|---|
| `profiles` | Extends `auth.users` — name, role, phone, avatar, banned flag |
| `listings` | Properties and vehicles |
| `listing_images` | Images per listing |
| `listing_videos` | Videos per listing |
| `bookings` | Booking records — dates, payment method, status, reference |
| `favorites` | User saved listings |
| `reviews` | Guest reviews |
| `promotions` | Time-limited % discounts on listings |
| `events` | Events created by admin |
| `provinces` / `districts` / `sectors` | Rwanda location hierarchy |
| `platform_config` | Feature flags (e.g. `open_reviews = true`) |

---

## Edge Functions

| Function | Purpose |
|---|---|
| `irembo-pay` | Dummy Irembo Pay gateway — validates card/MoMo, returns fake reference. Replace `/* DUMMY */` blocks with real Irembo API calls when credentials arrive. |
| `store-booking` | Saves the booking to the database after payment is confirmed |

Deploy:
```bash
supabase functions deploy irembo-pay --no-verify-jwt
supabase functions deploy store-booking --no-verify-jwt
```

---

## RLS Policies — Promotions

Run in the Supabase SQL editor:

```sql
-- Anyone (including guests) can read promotions
alter policy "Public can read promotions"
on "public"."promotions"
to public
using (true);

-- Admins and owners can insert, update, and delete promotions
alter policy "Admin can manage promotions"
on "public"."promotions"
to authenticated
using (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
      and profiles.role = any (array['admin'::user_role, 'owner'::user_role])
  )
)
with check (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
      and profiles.role = any (array['admin'::user_role, 'owner'::user_role])
  )
);
```

---

## Project Structure

```
AfriStay/
├── index.html              # Home page
├── Auth/                   # Sign in / sign up / forgot password
├── Listings/               # Browse listings
├── Detail/                 # Single listing detail
├── Checkout/               # Booking checkout
├── Profile/                # User profile
├── Dashboard/              # Admin + owner dashboard
├── Events/                 # Events list
├── Event/                  # Single event
├── Favorites/              # Saved listings
├── Contact/                # Contact form
├── About/                  # About page
├── js/
│   ├── script.js           # Global nav, card generator, favorites, promo merge helper
│   ├── home.js             # Home page featured listings + carousel
│   ├── detail.js           # Listing detail page (price, booking, reviews)
│   ├── auth.js             # Auth flow (sign in, sign up, OTP, forgot/reset password)
│   ├── dashboard.js        # Full admin + owner dashboard logic
│   └── supabase-client.js  # Supabase init
├── Style/
│   ├── style.css           # Global styles + responsive breakpoints
│   └── index.css           # Home page styles
└── supabase/
    └── functions/
        ├── irembo-pay/     # Dummy Irembo Pay edge function
        └── store-booking/  # Booking persistence edge function
```

---

## Local Development

No build step required — it's a static site.

```bash
# Option A — npx serve
npx serve .

# Option B — Python
python -m http.server 8080
```

Supabase config lives in `/js/supabase-client.js`. Swap the keys for your own project if forking.

---

## Roadmap

- [ ] Irembo Pay live credentials — replace dummy edge function
- [ ] Supabase custom SMTP — send auth emails from `bookings@afristay.rw`
- [ ] Brevo domain verification — remove `brevosend.com` subdomain from outbound emails
- [ ] Rwanda App Hub integration — connect AfriStay to the unified East Africa digital ecosystem

---

*Built with love in Rwanda by King Technologies.*
