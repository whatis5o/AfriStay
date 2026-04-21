// @ts-nocheck
// AfriStay — irembo-webhook Edge Function v3
// Deploy: npx supabase functions deploy irembo-webhook --no-verify-jwt --project-ref xuxzeinufjpplxkerlsd

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac }   from 'https://deno.land/std@0.177.0/node/crypto.ts';

const RESEND_URL = 'https://api.resend.com/emails';
const FROM       = 'AfriStay <bookings@dm.afristay.rw>';

async function sendEmail(key: string, to: string, subject: string, html: string) {
  const r = await fetch(RESEND_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!r.ok) console.error('[WEBHOOK] Email failed to', to, r.status, await r.text());
  else console.log('[WEBHOOK] Email sent to:', to);
}

function fmtDate(d: string) {
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function guestReceiptHtml(p: {
  guestName: string; listingTitle: string; bookingRef: string;
  startDate: string; endDate: string; nights: number;
  amount: string; paymentRef: string; currency: string;
}): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f2f0ec;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0ec;padding:40px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.06);">

  <!-- Header -->
  <tr><td style="background:#f5f5f5;border-radius:20px 20px 0 0;padding:28px 40px;text-align:center;border-bottom:1px solid #ebebdd;">
    <img src="https://afristay.rw/Pictures/light-afri.svg" alt="AfriStay" width="150" style="display:block;margin:0 auto;">
    <div style="color:#a6a68d;font-size:11px;margin-top:12px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;">Booking Confirmed</div>
  </td></tr>

  <!-- Hero -->
  <tr><td style="background:linear-gradient(135deg,#16a34a,#15803d);padding:36px 40px;text-align:center;">
    <div style="color:#fff;font-size:26px;font-weight:900;margin-bottom:6px;">You're all set!</div>
    <div style="color:rgba(255,255,255,.88);font-size:15px;line-height:1.6;">Payment received · Booking confirmed · Adventure awaits</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#fff;padding:36px 40px;">
    <p style="margin:0 0 6px;font-size:17px;font-weight:800;color:#1a1a1a;">Hi ${p.guestName},</p>
    <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.8;">
      Your payment went through and your stay at <strong style="color:#1a1a1a;">${p.listingTitle}</strong> is officially locked in.
      We can't wait to host you — this is going to be great!
    </p>

    <!-- Booking card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:16px;margin-bottom:28px;border:1.5px solid #bbf7d0;">
    <tr><td style="padding:24px 26px;">
      <div style="font-size:11px;font-weight:800;color:#16a34a;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px;">Your Booking Details</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;width:40%;">Booking Ref</td>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:14px;font-weight:800;color:#16a34a;font-family:monospace;">#${p.bookingRef}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">Property</td>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:700;color:#1a1a1a;">${p.listingTitle}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">Check-in</td>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;">${fmtDate(p.startDate)}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">Check-out</td>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;">${fmtDate(p.endDate)}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">Duration</td>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;">${p.nights} ${p.nights === 1 ? 'night' : 'nights'}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">Transaction ID</td>
          <td style="padding:9px 0;border-bottom:1px solid #dcfce7;font-size:11px;color:#9ca3af;font-family:monospace;">${p.paymentRef}</td>
        </tr>
        <tr>
          <td style="padding:14px 0 0;font-size:15px;font-weight:800;color:#1a1a1a;">Amount Paid</td>
          <td style="padding:14px 0 0;font-size:22px;font-weight:900;color:#EB6753;">${p.amount} ${p.currency}</td>
        </tr>
      </table>
    </td></tr></table>

    <!-- CTA -->
    <a href="https://afristay.rw/Dashboards/Profile/?tab=bookings"
       style="display:block;background:#EB6753;color:#fff;text-decoration:none;text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:800;margin-bottom:20px;">
      View My Booking
    </a>

    <!-- Tips -->
    <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;padding:16px 20px;">
      <div style="font-size:12px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Before you arrive</div>
      <ul style="margin:0;padding:0 0 0 16px;font-size:13px;color:#78350f;line-height:2;">
        <li>Save your booking reference <strong>#${p.bookingRef}</strong></li>
        <li>Contact your host if you need early check-in or special arrangements</li>
        <li>Questions? Email us at <a href="mailto:support@afristay.rw" style="color:#EB6753;font-weight:700;">support@afristay.rw</a></li>
      </ul>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#16213e;border-radius:0 0 20px 20px;padding:22px 40px;text-align:center;">
    <a href="https://afristay.rw" style="color:rgba(255,255,255,.85);font-size:13px;font-weight:700;text-decoration:none;">afristay.rw</a>
    <p style="margin:8px 0 0;font-size:11px;color:rgba(255,255,255,.3);">© ${new Date().getFullYear()} AfriStay · Rwanda's Premier Rental Platform</p>
  </td></tr>

</table></td></tr></table></body></html>`;
}

function ownerNotificationHtml(p: {
  ownerName: string; guestName: string; guestEmail: string; guestPhone: string;
  listingTitle: string; bookingRef: string;
  startDate: string; endDate: string; nights: number;
  amount: string; commission: string; ownerEarnings: string; currency: string;
}): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f2f0ec;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0ec;padding:40px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.06);">

  <!-- Header -->
  <tr><td style="background:#f5f5f5;border-radius:20px 20px 0 0;padding:28px 40px;text-align:center;border-bottom:1px solid #ebebdd;">
    <img src="https://afristay.rw/Pictures/light-afri.svg" alt="AfriStay" width="150" style="display:block;margin:0 auto;">
    <div style="color:#a6a68d;font-size:11px;margin-top:12px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;">New Booking Paid</div>
  </td></tr>

  <!-- Hero -->
  <tr><td style="background:linear-gradient(135deg,#1d4ed8,#1e40af);padding:32px 40px;text-align:center;">
    <div style="color:#fff;font-size:24px;font-weight:900;margin-bottom:6px;">Payment Received</div>
    <div style="color:rgba(255,255,255,.88);font-size:14px;">A guest just paid for a stay at your listing</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#fff;padding:36px 40px;">
    <p style="margin:0 0 6px;font-size:17px;font-weight:800;color:#1a1a1a;">Hi ${p.ownerName},</p>
    <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.8;">
      Great news — <strong>${p.guestName}</strong> just completed payment for <strong style="color:#1a1a1a;">${p.listingTitle}</strong>.
      The booking is now fully confirmed.
    </p>

    <!-- Guest info -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border-radius:14px;margin-bottom:20px;border:1.5px solid #bfdbfe;">
    <tr><td style="padding:20px 22px;">
      <div style="font-size:11px;font-weight:800;color:#1d4ed8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">Guest Information</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:7px 0;border-bottom:1px solid #dbeafe;font-size:13px;color:#6b7280;width:40%;">Name</td>
          <td style="padding:7px 0;border-bottom:1px solid #dbeafe;font-size:13px;font-weight:700;color:#1a1a1a;">${p.guestName}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;border-bottom:1px solid #dbeafe;font-size:13px;color:#6b7280;">Email</td>
          <td style="padding:7px 0;border-bottom:1px solid #dbeafe;font-size:13px;color:#1a1a1a;"><a href="mailto:${p.guestEmail}" style="color:#1d4ed8;text-decoration:none;">${p.guestEmail}</a></td>
        </tr>
        <tr>
          <td style="padding:7px 0;font-size:13px;color:#6b7280;">Phone</td>
          <td style="padding:7px 0;font-size:13px;color:#1a1a1a;">${p.guestPhone || 'Not provided'}</td>
        </tr>
      </table>
    </td></tr></table>

    <!-- Booking details -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:14px;margin-bottom:20px;border:1.5px solid #bbf7d0;">
    <tr><td style="padding:20px 22px;">
      <div style="font-size:11px;font-weight:800;color:#16a34a;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">Booking Details</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;width:40%;">Ref</td>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:800;color:#16a34a;font-family:monospace;">#${p.bookingRef}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">Check-in</td>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;">${fmtDate(p.startDate)}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">Check-out</td>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;">${fmtDate(p.endDate)}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">Duration</td>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;">${p.nights} ${p.nights === 1 ? 'night' : 'nights'}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">Total Paid</td>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:700;color:#1a1a1a;">${p.amount} ${p.currency}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#6b7280;">AfriStay Fee (10%)</td>
          <td style="padding:7px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#9ca3af;">− ${p.commission} ${p.currency}</td>
        </tr>
        <tr>
          <td style="padding:12px 0 0;font-size:15px;font-weight:800;color:#1a1a1a;">Your Earnings</td>
          <td style="padding:12px 0 0;font-size:22px;font-weight:900;color:#16a34a;">${p.ownerEarnings} ${p.currency}</td>
        </tr>
      </table>
    </td></tr></table>

    <!-- CTA -->
    <a href="https://afristay.rw/Dashboards/Owner/"
       style="display:block;background:#1d4ed8;color:#fff;text-decoration:none;text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:800;margin-bottom:18px;">
      View in My Dashboard
    </a>

    <div style="background:#f9fafb;border-radius:12px;padding:14px 18px;font-size:13px;color:#6b7280;line-height:1.7;text-align:center;">
      Payout will be processed after the guest's check-out. Questions? <a href="mailto:support@afristay.rw" style="color:#EB6753;font-weight:700;">support@afristay.rw</a>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#16213e;border-radius:0 0 20px 20px;padding:22px 40px;text-align:center;">
    <a href="https://afristay.rw" style="color:rgba(255,255,255,.85);font-size:13px;font-weight:700;text-decoration:none;">afristay.rw</a>
    <p style="margin:8px 0 0;font-size:11px;color:rgba(255,255,255,.3);">© ${new Date().getFullYear()} AfriStay · Rwanda's Premier Rental Platform</p>
  </td></tr>

</table></td></tr></table></body></html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  // Block direct calls — only allow requests coming through api.afristay.rw proxy
  const proxySecret = Deno.env.get('PROXY_SECRET');
  if (proxySecret) {
    const callerSecret = req.headers.get('x-afristay-proxy-secret') || '';
    if (callerSecret !== proxySecret) {
      console.warn('[WEBHOOK] Rejected direct call — missing or wrong proxy secret');
      return new Response('Not Found', { status: 404 });
    }
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

  const expected = createHmac('sha256', secret).update(`${timestamp}#${body}`).digest('hex');
  if (signature !== expected) {
    console.warn('[WEBHOOK] Signature mismatch');
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: Record<string, any>;
  try { payload = JSON.parse(body); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const paymentStatus = payload?.data?.paymentStatus;
  const transactionId = payload?.data?.transactionId;
  const paymentRef    = payload?.data?.paymentReference || transactionId;

  console.log('[WEBHOOK] Status:', paymentStatus, 'id:', transactionId);

  if (paymentStatus !== 'PAID') {
    console.log('[WEBHOOK] Ignoring:', paymentStatus);
    return new Response('OK', { status: 200 });
  }

  if (!transactionId) {
    console.error('[WEBHOOK] No transactionId');
    return new Response('Bad payload', { status: 400 });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Confirm booking and fetch full details including owner
  const { data: booking, error } = await sb
    .from('bookings')
    .update({ status: 'confirmed', payment_status: 'paid', paid_at: new Date().toISOString(), payment_reference: paymentRef })
    .eq('id', transactionId)
    .select('*, listings(title, owner_id, currency)')
    .single();

  if (error || !booking) {
    console.error('[WEBHOOK] Booking update failed:', error?.message, 'id:', transactionId);
    return new Response('Booking not found', { status: 404 });
  }

  console.log('[WEBHOOK] Booking confirmed:', booking.id);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) { console.error('[WEBHOOK] No RESEND_API_KEY'); return new Response('OK', { status: 200 }); }

  const listingTitle = booking.listings?.title || 'your listing';
  const bookingRef   = booking.booking_reference || String(booking.id).slice(0, 8).toUpperCase();
  const currency     = booking.listings?.currency || booking.currency || 'RWF';
  const total        = Number(booking.total_amount || 0);
  const commission   = Math.round(total * 0.10);
  const ownerEarnings = total - commission;
  const nights       = booking.nights || Math.ceil(
    (new Date(booking.end_date).getTime() - new Date(booking.start_date).getTime()) / 86400000
  ) || 1;

  // 1. Email guest — receipt + celebration
  const guestEmail = booking.guest_email;
  if (guestEmail) {
    await sendEmail(
      resendKey,
      guestEmail,
      `Booking confirmed — ${listingTitle} (#${bookingRef})`,
      guestReceiptHtml({
        guestName:    booking.guest_name || 'Guest',
        listingTitle,
        bookingRef,
        startDate:    booking.start_date,
        endDate:      booking.end_date,
        nights,
        amount:       total.toLocaleString('en-RW'),
        paymentRef,
        currency,
      }),
    );
  }

  // 2. Email owner — booking paid notification
  const ownerId = booking.listings?.owner_id;
  if (ownerId) {
    const { data: owner } = await sb
      .from('profiles')
      .select('full_name, email, phone')
      .eq('id', ownerId)
      .single();

    if (owner?.email) {
      await sendEmail(
        resendKey,
        owner.email,
        `Payment received — ${listingTitle} booked by ${booking.guest_name || 'a guest'}`,
        ownerNotificationHtml({
          ownerName:     owner.full_name || 'Host',
          guestName:     booking.guest_name || 'Guest',
          guestEmail:    guestEmail || '',
          guestPhone:    booking.guest_phone || '',
          listingTitle,
          bookingRef,
          startDate:     booking.start_date,
          endDate:       booking.end_date,
          nights,
          amount:        total.toLocaleString('en-RW'),
          commission:    commission.toLocaleString('en-RW'),
          ownerEarnings: ownerEarnings.toLocaleString('en-RW'),
          currency,
        }),
      );
    }
  }

  return new Response('OK', { status: 200 });
});
