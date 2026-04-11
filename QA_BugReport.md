# AfriStay QA Bug Report
**Date:** 2026-04-09  
**Tester:** Claude (automated browser QA via Claude in Chrome MCP)  
**Environment:** Local dev server — `python -m http.server 8787` → `http://localhost:8787`  
**Backend:** Supabase project `xuxzeinufjpplxkerlsd`  
**Scope:** Unauthenticated flow · User Dashboard · Owner Dashboard · Admin Dashboard

---

## Section 1 — Critical Bugs

### BUG-001 · Owner Earnings Panel — "Sign in to view earnings" Race Condition
**Severity:** Critical  
**Location:** Owner Dashboard → Earnings tab (`/Owner/` inline script — `loadEarnings()`)  
**Reproducible:** Always (first page load after login)

**Description:**  
When an authenticated owner navigates to their dashboard, the Earnings panel briefly (or permanently) displays "Sign in to view earnings" instead of the actual earnings data. The function `loadEarnings()` checks `window.CURRENT_PROFILE` synchronously at call time. If the profile fetch from Supabase has not yet resolved, `CURRENT_PROFILE` is undefined and the function falls back to the error message. The retry fires once after 1200ms, which sometimes catches the profile in time — but on slower connections or cold loads, it doesn't.

**Root Cause (code):**
```javascript
// Owner dashboard inline script
async function loadEarnings() {
    if (!window.CURRENT_PROFILE) {
        // Retries ONCE after 1200ms — not enough on slow connections
        setTimeout(() => loadEarnings(), 1200);
        // Falls through to show "Sign in to view earnings"
        return;
    }
    // ... actual earnings logic
}
```

**Impact:** Owners cannot see their earnings on first load. Trust-breaking for the core monetization UX.

---

### BUG-002 · Owner & Admin Settings — Profile Fields Not Pre-filled
**Severity:** Critical  
**Location:** Owner Dashboard → Settings tab · Admin Dashboard → Settings tab  
**Reproducible:** Always (same race condition as BUG-001)

**Description:**  
`prefillOwnerProfile()` and `prefillAdminProfile()` both check `window.CURRENT_PROFILE` at call time. Since these functions run when the Settings panel is initialized (before the async profile fetch completes), all form fields (Full Name, Email, Phone, Bio, etc.) remain empty. Users who try to update their profile see blank inputs and may overwrite their data with empty values.

**Root Cause (code):**
```javascript
function prefillOwnerProfile() {
    if (!window.CURRENT_PROFILE) return; // ← exits immediately on first load
    // ... field population logic never runs
}
```

**Impact:** Profile settings appear broken. Risk of data loss if a user submits the blank form.

---

## Section 2 — Functional Bugs

### BUG-003 · Listings Page — Default `priceMax` Filters Out Real Estate
**Severity:** High  
**Location:** `/Listings/` inline script — `loadListings()` function  
**Reproducible:** Always (affects every user's first view of the listings page)

**Description:**  
The listings filter function has a default parameter of `priceMax = 500000` (500K RWF), but the UI slider's defined maximum is `PRICE_MAX = 5,000,000` (5M RWF). Real estate listings in Rwanda routinely price in the millions per night/month. On the initial page load, `loadListings()` is called without arguments, so the default 500K cap silently truncates the result set — hiding most real estate inventory from users who haven't touched the price filter.

**Root Cause (code):**
```javascript
// PRICE_MAX constant defined as:
const PRICE_MAX = 5000000;

// But default parameter uses 500000 (10× too small):
async function loadListings(page = 1, priceMin = 0, priceMax = 500000) {
    // Supabase query: .lte('price', priceMax) → cuts off results above 500K
}
```

**Expected:** Default `priceMax` should equal `PRICE_MAX` (5,000,000).  
**Actual:** Default is 500,000 — 10× below the UI slider's stated maximum.

---

### BUG-004 · Storage Bucket Name Mismatch
**Severity:** High  
**Location:** `js/home.js` vs `/Listings/` inline script  
**Reproducible:** Consistently (structural inconsistency)

**Description:**  
Two different bucket names are used across the codebase for the same Supabase storage bucket:
- `home.js` uses: `listing_images` (underscore)
- Listings page script uses: `listing-images` (hyphen)

Only one of these can be the correct bucket name. Whichever page uses the wrong name will fail to load fallback images via the storage folder path, silently displaying placeholder icons instead of property photos.

**Files:**
```
js/home.js          → const STORAGE_BASE = '.../listing_images'
/Listings/ script   → sb.storage.from('listing-images').list(id, ...)
```

**Impact:** Property images may not display on either the homepage carousel or the listings grid, depending on which name is wrong.

---

### BUG-005 · Admin Financial Tab — AfriStay Earnings = 0 RWF
**Severity:** High  
**Location:** Admin Dashboard → Financial tab (`loadFinancialData()`)  
**Reproducible:** Confirmed in testing session

**Description:**  
The Financial tab reports:
- Total Revenue: 130,000 RWF
- **AfriStay Earnings: 0 RWF**
- Owner Payouts: 130,000 RWF

This means 100% of all booking revenue is attributed to owner payouts with zero platform commission retained by AfriStay. This is either a calculation bug (the platform fee is not being deducted before computing owner payouts) or a data entry issue where no commission rate has been configured.

**Secondary Issue:** The Monthly Revenue chart Y-axis renders on a 0.0–1.0 scale (labeled "K RWF"), suggesting the chart data or scaling factor may be miscalculated.

**Impact:** Platform revenue tracking is broken. AfriStay cannot verify its own earnings or commission income.

---

### BUG-006 · User Dashboard — Log Out Does Not Sign Out Cleanly
**Severity:** Medium  
**Location:** User Dashboard → Log Out button  
**Reproducible:** Confirmed once during testing

**Description:**  
Clicking the "Log Out" button on the User Dashboard triggered a browser/CDP timeout — the action did not complete, and the Supabase session remained active. After navigating away to `/Auth/`, the nav bar still showed "Profile" (indicating an authenticated session). The owner login that followed successfully superseded the stale session, but users who rely on the Log Out button may not actually be signed out.

**Impact:** Security concern — users think they've logged out but their session persists, especially on shared devices.

---

### BUG-007 · Messages Tab — Sender Names Display as Numbers
**Severity:** Medium  
**Location:** User Dashboard → Messages tab  
**Reproducible:** Confirmed in testing

**Description:**  
Several message threads in the Messages tab show numeric values ("5", "4") as the sender/contact name instead of a human-readable name. This suggests the display name lookup is failing and falling back to a numeric ID or array index.

**Impact:** Users cannot identify who sent them a message, making the inbox unusable for those affected threads.

---

## Section 3 — UI/UX Issues

### BUG-008 · New Listing Form — Duplicate "Air Conditioning" Amenity Checkbox
**Severity:** Medium  
**Location:** Owner Dashboard → New Listing form → Amenities section  
**Reproducible:** Always

**Description:**  
"Air Conditioning" appears twice in the amenities checklist. Selecting both checkboxes presumably saves duplicate data. This also visually signals sloppiness in the amenity list and may cause filter/search bugs if amenities are matched exactly.

---

### BUG-009 · Homepage Carousel — Cards Clipped / Blank Area on Wide Viewport
**Severity:** Low–Medium  
**Location:** `index.html` — Featured Listings carousel  
**Reproducible:** Observed during testing at desktop viewport width

**Description:**  
On the homepage, the carousel track renders property cards but a blank gray area appears at the right side (visible in screenshot). This suggests either:
- The carousel `overflow: hidden` clips cards that extend beyond the visible area, and the computed width is off
- Cards are not filling the expected width, leaving visual dead space

The `initCarousel()` function computes offsets using `cards[0].offsetWidth + gap` — if `offsetWidth` returns 0 during the first render (before layout completes), all computed positions are wrong.

---

### BUG-010 · Owner Dashboard — "Price Outside Kigali" Field Has No Label Context
**Severity:** Low  
**Location:** Owner Dashboard → New Listing form  
**Reproducible:** Always

**Description:**  
The "Price Outside Kigali Display" field is present in the new listing form but has no tooltip or helper text explaining what it means or when it applies. Owners who list properties outside Kigali may not understand the distinction between `price_display` and `price_outside_kigali_display`.

---

## Section 4 — Fix Prompt (Copy-Paste for AI Developer)

> Paste this prompt into a new Claude Code session to fix the bugs above in priority order.

---

```
You are working on AfriStay, a vanilla HTML/CSS/JS property rental platform (no framework).
Backend: Supabase (project xuxzeinufjpplxkerlsd).
Primary working directory: C:\Users\shema\OneDrive\Desktop\Projects\AfriStay

Fix the following bugs in this exact priority order. For each bug, read the relevant file first,
make the minimal change needed, and confirm it resolves the issue. Do NOT refactor surrounding code.

────────────────────────────────────────────────────────────────
PRIORITY 1 (Critical) — Race condition: window.CURRENT_PROFILE not ready
────────────────────────────────────────────────────────────────
Files affected: /Owner/index.html (inline script), /Admin/index.html (inline script)

The functions loadEarnings(), prefillOwnerProfile(), and prefillAdminProfile() all check
window.CURRENT_PROFILE synchronously. If the async Supabase profile fetch hasn't resolved yet,
these functions exit early and show broken/empty UI.

Fix: Replace the one-shot setTimeout retry with a Promise-based wait that polls CURRENT_PROFILE
at 200ms intervals for up to 5 seconds, then calls the original function. Example:

  function waitForProfile(fn, maxMs = 5000) {
      const start = Date.now();
      return new Promise((resolve) => {
          (function check() {
              if (window.CURRENT_PROFILE) { fn(); resolve(); return; }
              if (Date.now() - start > maxMs) { resolve(); return; } // give up gracefully
              setTimeout(check, 200);
          })();
      });
  }

Replace all three call sites (loadEarnings, prefillOwnerProfile, prefillAdminProfile) to use
waitForProfile(() => loadEarnings()) etc., instead of the current direct call.

────────────────────────────────────────────────────────────────
PRIORITY 2 (High) — Default priceMax in loadListings() is 10× too small
────────────────────────────────────────────────────────────────
File: /Listings/index.html (inline script)

Find the function signature:
  async function loadListings(page = 1, priceMin = 0, priceMax = 500000)

Change the default to match the PRICE_MAX constant (5000000):
  async function loadListings(page = 1, priceMin = 0, priceMax = 5000000)

Do NOT change anything else in this function.

────────────────────────────────────────────────────────────────
PRIORITY 3 (High) — Storage bucket name mismatch
────────────────────────────────────────────────────────────────
Files: js/home.js and /Listings/index.html (inline script)

One uses 'listing_images' (underscore), the other uses 'listing-images' (hyphen).
Check the actual Supabase Storage bucket name by reading the Supabase dashboard config or
looking at what bucket name matches successful image loads in the browser network tab.
Then update whichever file has the wrong name so both use the same bucket name consistently.

────────────────────────────────────────────────────────────────
PRIORITY 4 (High) — AfriStay Earnings = 0 in Financial tab
────────────────────────────────────────────────────────────────
File: /Admin/index.html (inline script — loadFinancialData())

Inspect how AfriStay Earnings is calculated. It should be:
  afriStayEarnings = totalRevenue - ownerPayouts
OR use a configured platform_fee_percent from a settings table.

If no commission rate is configured, add a default (e.g., 10%) and document it clearly.
Also check the Monthly Revenue chart data — if the Y-axis shows 0.0–1.0 instead of
actual RWF values, the data is likely in the wrong unit (RWF vs K-RWF).

────────────────────────────────────────────────────────────────
PRIORITY 5 (Medium) — Duplicate "Air Conditioning" in amenities
────────────────────────────────────────────────────────────────
File: /Owner/index.html (New Listing form — amenities checklist)

Search for 'Air Conditioning' in the HTML. Remove the duplicate checkbox/label entry.
Keep only one instance. Verify the value attribute matches what is stored in Supabase.

────────────────────────────────────────────────────────────────
PRIORITY 6 (Medium) — Messages sender names show as numbers
────────────────────────────────────────────────────────────────
File: Wherever the Messages tab is rendered (likely /Dashboard/index.html or /Owner/index.html)

Find the code that renders message sender names. It is likely reading a numeric field
(e.g., array index or raw integer ID) instead of the profile full_name. Fix the lookup
to join on the profiles table and display full_name.

────────────────────────────────────────────────────────────────
PRIORITY 7 (Low) — Log Out button unreliable
────────────────────────────────────────────────────────────────
Find the Log Out button handler across all dashboard pages (/Dashboard/, /Owner/, /Admin/).
Ensure it calls: await supabaseClient.auth.signOut()
Then immediately clears localStorage keys (afriStay_role, afriStay_firstName)
Then redirects to /Auth/ via window.location.href.
If there is a debounce or async gap between these steps, collapse them into a single
async handler that awaits signOut before clearing state and redirecting.
```

---

## Summary Table

| ID | Severity | Area | Short Description |
|----|----------|------|-------------------|
| BUG-001 | Critical | Owner Dashboard | Earnings shows "Sign in" due to race condition |
| BUG-002 | Critical | Owner & Admin Dashboard | Settings fields blank due to same race condition |
| BUG-003 | High | Listings Page | Default priceMax=500K hides most real estate |
| BUG-004 | High | Home + Listings | Storage bucket name inconsistency |
| BUG-005 | High | Admin Financial | AfriStay Earnings = 0 RWF despite 130K revenue |
| BUG-006 | Medium | User Dashboard | Log Out doesn't terminate session cleanly |
| BUG-007 | Medium | User Dashboard | Message senders show numeric IDs |
| BUG-008 | Medium | Owner Dashboard | Duplicate "Air Conditioning" amenity checkbox |
| BUG-009 | Low–Med | Homepage | Carousel blank area / possible width offset bug |
| BUG-010 | Low | Owner Dashboard | "Price Outside Kigali" field lacks context |

**Total: 2 Critical · 3 High · 3 Medium · 2 Low**
