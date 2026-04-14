-- ═══════════════════════════════════════════════════════
-- AfriStay Supabase Migrations  (PostgreSQL / Supabase)
-- Run in Supabase Dashboard → SQL Editor — NOT in VS Code
-- VS Code linter shows T-SQL errors here; ignore them.
-- All syntax below is valid PostgreSQL / Supabase RLS.
-- ═══════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════
-- IMPORTANT: Before running, go to Supabase Dashboard →
-- Authentication → URL Configuration and set:
--   Site URL:      https://afristay.rw
--   Redirect URLs: https://afristay.rw/Auth/
-- This fixes password reset emails pointing to localhost.
-- ═══════════════════════════════════════════════════════

-- ── 1. Payout RLS: Allow admins to insert payouts ──────
CREATE POLICY "Admins can insert payouts"
ON payouts FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- ── 2. Payout RLS: Allow admins to update payouts ──────
CREATE POLICY "Admins can update payouts"
ON payouts FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- ── 3. Payout RLS: Owners can view their own payouts ──
CREATE POLICY "Owners can view own payouts"
ON payouts FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- ── 4. Ensure listings status filter index exists ──────
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_availability ON listings(availability_status);

-- ── 5. Date-blocking: index to speed up date-range overlap queries ──
CREATE INDEX IF NOT EXISTS idx_bookings_listing_dates ON bookings(listing_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- ── 6. Date-blocking: prevent duplicate overlapping bookings at DB level ──
-- This function checks if a new booking's dates overlap with existing confirmed bookings
CREATE OR REPLACE FUNCTION check_booking_overlap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE listing_id = NEW.listing_id
      AND id <> NEW.id
      AND status IN ('pending', 'approved', 'confirmed')
      AND start_date < NEW.end_date
      AND end_date > NEW.start_date
  ) THEN
    RAISE EXCEPTION 'DATES_UNAVAILABLE: These dates overlap with an existing booking for this listing.';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop trigger if exists, then recreate
DROP TRIGGER IF EXISTS trg_booking_overlap ON bookings;
CREATE TRIGGER trg_booking_overlap
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION check_booking_overlap();

-- ── 7. NOTE: Ensure store-booking edge function does NOT update ──
-- listings.availability_status = 'booked' or 'unavailable' on booking creation.
-- The listing stays 'available' at all times (owners set it manually).
-- Date-level blocking is handled by the trg_booking_overlap trigger above
-- and the BOOKED_RANGES check in detail.js (fetches bookings by listing_id + status).

-- ── 8. Bookings RLS ──────────────────────────────────────────
-- Drop-then-create pattern is safe in PostgreSQL (Supabase SQL Editor).

DROP POLICY IF EXISTS "Users can insert own bookings" ON bookings;
CREATE POLICY "Users can insert own bookings"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own bookings" ON bookings;
CREATE POLICY "Users can view own bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id = bookings.listing_id
        AND listings.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- ── 6. Listings UPDATE RLS ─────────────────────────────
-- Run these if RLS is enabled on the listings table.
-- Drop existing update policies first to avoid conflicts:
DROP POLICY IF EXISTS "Owners can update own listings" ON listings;
DROP POLICY IF EXISTS "Admins can update any listing" ON listings;

CREATE POLICY "Owners can update own listings"
ON listings FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Admins can update any listing"
ON listings FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- ── 7. Trigger: prevent owners from changing featured/fee ─
-- Owners cannot change featured status or price_afristay_fee directly.
CREATE OR REPLACE FUNCTION listings_owner_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only block non-admins
  IF EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;
  -- Prevent owner from toggling featured
  IF NEW.featured IS DISTINCT FROM OLD.featured THEN
    RAISE EXCEPTION 'Only admins can change the featured status';
  END IF;
  -- Prevent owner from changing commission fee
  IF NEW.price_afristay_fee IS DISTINCT FROM OLD.price_afristay_fee THEN
    RAISE EXCEPTION 'Only admins can change the commission fee';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_listings_owner_guard ON listings;
CREATE TRIGGER trg_listings_owner_guard
BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION listings_owner_guard();

-- ── 8. amenity_definitions — allow authenticated reads ──
-- (VS Code T-SQL linter will flag these; they are valid PostgreSQL)
ALTER TABLE amenity_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read amenities" ON amenity_definitions;
CREATE POLICY "Authenticated users can read amenities"
ON amenity_definitions FOR SELECT
TO authenticated
USING (true);

-- ── 9. listing_edit_requests table ─────────────────────
CREATE TABLE IF NOT EXISTS listing_edit_requests (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id  uuid REFERENCES listings(id) ON DELETE CASCADE NOT NULL,
  owner_id    uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  proposed_changes jsonb NOT NULL,
  status      text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at  timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id)
);

ALTER TABLE listing_edit_requests ENABLE ROW LEVEL SECURITY;

-- Owners: view and insert their own; delete pending only
DROP POLICY IF EXISTS "Owners view own edit requests" ON listing_edit_requests;
CREATE POLICY "Owners view own edit requests"
ON listing_edit_requests FOR SELECT TO authenticated
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners insert own edit requests" ON listing_edit_requests;
CREATE POLICY "Owners insert own edit requests"
ON listing_edit_requests FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners delete own pending edit requests" ON listing_edit_requests;
CREATE POLICY "Owners delete own pending edit requests"
ON listing_edit_requests FOR DELETE TO authenticated
USING (owner_id = auth.uid() AND status = 'pending');

-- Admins: full access
DROP POLICY IF EXISTS "Admins manage edit requests" ON listing_edit_requests;
CREATE POLICY "Admins manage edit requests"
ON listing_edit_requests FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_edit_requests_listing ON listing_edit_requests(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_edit_requests_owner   ON listing_edit_requests(owner_id, status);
