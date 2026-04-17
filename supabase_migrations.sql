-- ═══════════════════════════════════════════════════════
-- AfriStay Supabase Migrations  (PostgreSQL / Supabase)
-- Run in Supabase Dashboard → SQL Editor — NOT in VS Code
-- VS Code linter shows T-SQL errors here; ignore them.
-- All syntax below is valid PostgreSQL / Supabase RLS.
-- ═══════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════
-- 10. Listing unavailability tracking columns
-- ═══════════════════════════════════════════════════════

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS unavailable_from       DATE,
  ADD COLUMN IF NOT EXISTS unavailable_until      DATE,
  ADD COLUMN IF NOT EXISTS unavailable_indefinite BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_listings_unavail
  ON listings (availability_status, unavailable_indefinite, unavailable_until)
  WHERE availability_status = 'unavailable';

-- ═══════════════════════════════════════════════════════
-- 11. pg_cron — automated availability resets
--     Run each SELECT cron.schedule(...) separately if needed.
-- ═══════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Job A: Reset manual unavailability when end date passes (every hour on the hour)
SELECT cron.schedule(
  'afristay-reset-manual-unavailability',
  '0 * * * *',
  $$
  UPDATE listings
  SET availability_status = 'available',
      unavailable_from = NULL,
      unavailable_until = NULL,
      unavailable_indefinite = FALSE
  WHERE availability_status = 'unavailable'
    AND unavailable_indefinite = FALSE
    AND unavailable_until IS NOT NULL
    AND unavailable_until < CURRENT_DATE;
  $$
);

-- Job B: Reset booking-locked listings with no active bookings (every hour at :30)
SELECT cron.schedule(
  'afristay-reset-booking-unavailability',
  '30 * * * *',
  $$
  UPDATE listings l
  SET availability_status = 'available',
      unavailable_from = NULL,
      unavailable_until = NULL,
      unavailable_indefinite = FALSE
  WHERE l.availability_status = 'unavailable'
    AND l.unavailable_indefinite = FALSE
    AND l.unavailable_until IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.listing_id = l.id
        AND b.status IN ('confirmed', 'approved', 'awaiting_approval', 'pending')
        AND b.end_date >= CURRENT_DATE
    );
  $$
);

-- Job C: 12-hour timeout — expire stale pending bookings then release listing (every hour at :15)
SELECT cron.schedule(
  'afristay-timeout-pending-bookings',
  '15 * * * *',
  $$
  UPDATE bookings
  SET status = 'timed_out'
  WHERE status IN ('awaiting_approval', 'pending')
    AND created_at < NOW() - INTERVAL '12 hours';

  UPDATE listings l
  SET availability_status = 'available',
      unavailable_from = NULL,
      unavailable_until = NULL,
      unavailable_indefinite = FALSE
  WHERE l.availability_status = 'unavailable'
    AND l.unavailable_indefinite = FALSE
    AND l.unavailable_until IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.listing_id = l.id
        AND b.status IN ('confirmed', 'approved', 'awaiting_approval', 'pending')
        AND b.end_date >= CURRENT_DATE
    );
  $$
);

-- ═══════════════════════════════════════════════════════
-- 12. Update handle_new_user trigger to read role from
--     user metadata (supports owner invite signup page)
--     EXCEPTION block prevents signup failures.
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    CASE WHEN NEW.raw_user_meta_data->>'role' = 'owner' THEN 'owner' ELSE 'user' END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block signup even if profile insert fails
  RAISE WARNING 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════
-- 13. Add pin_hash to profiles (cross-device admin PIN)
-- ═══════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- ═══════════════════════════════════════════════════════
-- 14. RLS policies for profiles table
--     Required: without these, users get a 406 error
--     when the app tries to load their own profile.
-- ═══════════════════════════════════════════════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile (name, phone, pin_hash, etc.)
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Admins can update all profiles
CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Service role (triggers, edge functions) can insert profiles
CREATE POLICY "Service role can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (true);
