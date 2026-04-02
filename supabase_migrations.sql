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
