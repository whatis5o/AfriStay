// @ts-nocheck
// AfriStay — booking-expiry-reminder Edge Function
// Deploy: supabase functions deploy booking-expiry-reminder --no-verify-jwt
// Called by pg_cron every hour. Emails owner + guest when a booking expires in < 3 hours.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey   = Deno.env.get('RESEND_API_KEY')!;

  if (!supabaseUrl || !serviceKey || !resendKey) {
    return json({ error: 'Missing env vars' }, 500);
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // Find bookings expiring in the next 3 hours that haven't been reminded yet
  const { data: expiring, error } = await sb
    .from('bookings')
    .select(`
      id, listing_id, start_date, end_date, nights, total_amount, currency,
      guest_name, guest_email, category_slug, expires_at,
      listings ( title, owner_id,
        profiles!listings_owner_id_fkey ( full_name, email )
      )
    `)
    .eq('status', 'awaiting_approval')
    .is('reminder_sent_at', null)
    .gt('expires_at', new Date().toISOString())
    .lt('expires_at', new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString());

  if (error) return json({ error: error.message }, 500);
  if (!expiring || expiring.length === 0) return json({ ok: true, processed: 0 });

  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });

  async function sendViaFunction(payload: Record<string, unknown>) {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': Deno.env.get('SUPABASE_ANON_KEY') || serviceKey,
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  }

  let processed = 0;
  const results: Array<{ id: string; sent: string[]; errors: string[] }> = [];

  for (const booking of expiring) {
    const sent: string[] = [];
    const errors: string[] = [];
    const listing     = booking.listings as any;
    const ownerProfile = listing?.profiles as any;
    const listingTitle = listing?.title || 'AfriStay Listing';
    const expiresAt    = new Date(booking.expires_at);
    const hoursLeft    = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 3600000));

    // Email owner
    if (ownerProfile?.email) {
      const ok = await sendViaFunction({
        type: 'booking_request',
        to: ownerProfile.email,
        owner_name: ownerProfile.full_name || 'Host',
        listing_title: listingTitle,
        guest_name: booking.guest_name || 'Guest',
        guest_email: booking.guest_email || '',
        start_date: booking.start_date,
        end_date: booking.end_date,
        nights: booking.nights || 1,
        total: Number(booking.total_amount) || 0,
        currency: booking.currency || 'RWF',
        booking_id: booking.id,
        _subject_override: `⏰ Pending booking expiring in ~${hoursLeft}h — respond now`,
      });
      if (ok) sent.push(ownerProfile.email); else errors.push('owner');
    }

    // Email guest
    if (booking.guest_email) {
      const ok = await sendViaFunction({
        type: 'booking_expiry_reminder_user',
        to: booking.guest_email,
        guest_name: booking.guest_name || 'Guest',
        listing_title: listingTitle,
        start_date: booking.start_date,
        end_date: booking.end_date,
        hours_left: hoursLeft,
        booking_id: booking.id,
        category_slug: booking.category_slug || 'property',
      });
      if (ok) sent.push(booking.guest_email); else errors.push('guest');
    }

    // Mark reminder sent
    await sb.from('bookings').update({ reminder_sent_at: new Date().toISOString() }).eq('id', booking.id);
    processed++;
    results.push({ id: booking.id, sent, errors });
  }

  return json({ ok: true, processed, results });
});
