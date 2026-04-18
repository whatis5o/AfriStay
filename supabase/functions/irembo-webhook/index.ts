// @ts-nocheck
// AfriStay — irembo-webhook Edge Function v2
// IremboPay POSTs here when a payment completes.
// Deploy: npx supabase functions deploy irembo-webhook --no-verify-jwt --project-ref xuxzeinufjpplxkerlsd

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac }   from 'https://deno.land/std@0.177.0/node/crypto.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const body      = await req.text();
  const sigHeader = req.headers.get('irembopay-signature') || '';
  const secret    = Deno.env.get('IREMBO_SECRET_KEY');

  if (!secret) {
    console.error('[WEBHOOK] IREMBO_SECRET_KEY not set');
    return new Response('Server misconfigured', { status: 500 });
  }

  // Parse "t=<timestamp>,s=<signature>"
  let timestamp = '', signature = '';
  for (const part of sigHeader.split(',')) {
    const [k, v] = part.trim().split('=');
    if (k === 't') timestamp = v;
    if (k === 's') signature = v;
  }

  if (!timestamp || !signature) {
    console.warn('[WEBHOOK] Missing signature components — header:', sigHeader);
    return new Response('Unauthorized', { status: 401 });
  }

  // Verify: HMAC_SHA256(secret, "${timestamp}#${body}")
  const signedPayload = `${timestamp}#${body}`;
  const expected      = createHmac('sha256', secret).update(signedPayload).digest('hex');
  if (signature !== expected) {
    console.warn('[WEBHOOK] Signature mismatch — possible spoofed request');
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: Record<string, any>;
  try { payload = JSON.parse(body); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const paymentStatus = payload?.data?.paymentStatus;
  const transactionId = payload?.data?.transactionId;   // our booking UUID
  const paymentRef    = payload?.data?.paymentReference;

  console.log('[WEBHOOK] Received status:', paymentStatus, 'transactionId:', transactionId);

  // Only process PAID
  if (paymentStatus !== 'PAID') {
    console.log('[WEBHOOK] Ignoring status:', paymentStatus);
    return new Response('OK', { status: 200 });
  }

  if (!transactionId) {
    console.error('[WEBHOOK] No transactionId in payload');
    return new Response('Bad payload', { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb          = createClient(supabaseUrl, serviceKey);

  const { data: booking, error } = await sb
    .from('bookings')
    .update({
      status:            'confirmed',
      payment_status:    'paid',
      paid_at:           new Date().toISOString(),
      payment_reference: paymentRef || transactionId,
    })
    .eq('id', transactionId)
    .select('*, listings(title)')
    .single();

  if (error || !booking) {
    console.error('[WEBHOOK] Booking update failed:', error?.message, 'id:', transactionId);
    return new Response('Booking not found', { status: 404 });
  }

  console.log('[WEBHOOK] Booking confirmed:', booking.id);

  // Email guest payment confirmation
  const guestEmail = booking.guest_email;
  if (guestEmail) {
    const listingTitle = booking.listings?.title || 'your listing';
    const bookingRef   = booking.booking_reference || String(booking.id).slice(0, 8).toUpperCase();
    const amount       = Number(booking.total_amount || 0).toLocaleString('en-RW');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f2f0ec;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0ec;padding:40px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.06);">
  <tr><td style="background:#f5f5f5;border-radius:20px 20px 0 0;padding:32px 40px;text-align:center;border-bottom:1px solid #ebebdd;">
    <img src="https://afristay.rw/Pictures/light-afri.svg" alt="AfriStay" width="160" style="display:block;margin:0 auto;">
    <div style="color:#a6a68d;font-size:11px;margin-top:14px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;">Payment Receipt</div>
  </td></tr>
  <tr><td style="background:#16a34a;padding:26px 40px;text-align:center;">
    <div style="font-size:38px;margin-bottom:8px;">✅</div>
    <div style="color:#fff;font-size:22px;font-weight:800;">Payment Received!</div>
    <div style="color:rgba(255,255,255,.85);font-size:14px;margin-top:6px;">Your booking is now confirmed</div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px 40px;">
    <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1a1a1a;">Hi ${booking.guest_name || 'Guest'},</p>
    <p style="margin:0 0 26px;font-size:15px;color:#555;line-height:1.75;">
      Your payment has been received and your booking for <strong>${listingTitle}</strong> is now confirmed. See you soon!
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:14px;margin-bottom:26px;border:1px solid #bbf7d0;">
    <tr><td style="padding:22px 24px;">
      <div style="font-size:11px;font-weight:800;color:#16a34a;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">Booking Confirmation</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;width:42%;">Booking Ref</td>
            <td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:800;color:#16a34a;font-family:monospace;">#${bookingRef}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;">Property</td>
            <td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:700;color:#1a1a1a;">${listingTitle}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;">Check-in</td>
            <td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;">${booking.start_date}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;">Check-out</td>
            <td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;">${booking.end_date}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;">Payment Ref</td>
            <td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:12px;color:#888;font-family:monospace;">${paymentRef || ''}</td></tr>
        <tr><td style="padding:12px 0 0;font-size:15px;font-weight:800;color:#1a1a1a;">Amount Paid</td>
            <td style="padding:12px 0 0;font-size:20px;font-weight:900;color:#EB6753;">${amount} RWF</td></tr>
      </table>
    </td></tr></table>
    <a href="https://afristay.rw/Dashboards/Profile/?tab=bookings"
       style="display:block;background:#EB6753;color:#fff;text-decoration:none;text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:800;">
      View My Bookings
    </a>
  </td></tr>
  <tr><td style="background:#16213e;border-radius:0 0 20px 20px;padding:22px 40px;text-align:center;">
    <a href="https://afristay.rw" style="color:rgba(255,255,255,.85);font-size:13px;font-weight:700;text-decoration:none;">afristay.rw</a>
    <p style="margin:8px 0 0;font-size:11px;color:rgba(255,255,255,.25);">© ${new Date().getFullYear()} AfriStay · Rwanda's Premier Rental Platform</p>
  </td></tr>
</table></td></tr></table></body></html>`;

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (resendKey) {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          from:    'AfriStay <bookings@dm.afristay.rw>',
          to:      [guestEmail],
          subject: `Payment confirmed — ${listingTitle} (#${bookingRef})`,
          html,
        }),
      });
      if (!emailRes.ok) console.error('[WEBHOOK] Email failed:', emailRes.status, await emailRes.text());
      else console.log('[WEBHOOK] Confirmation email sent to:', guestEmail);
    }
  }

  return new Response('OK', { status: 200 });
});
