// @ts-nocheck
/**
 * approve-booking — AfriStay v23
 * Sandbox IremboPay enabled. Switch IREMBO_BASE_URL to production when going live.
 *
 * GET  ?token=xxx&action=approve|reject  → redirect to static approve page
 * GET  ?token=xxx&info=1                 → JSON booking info for static page
 * POST { token, action, reason? }        → owner clicking from email (no auth)
 * POST { booking_id, action, reason? } + Bearer → dashboard button (auth required)
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ── Switch to production URL when going live ──────────────────────
const IREMBO_BASE_URL = 'https://api.sandbox.irembopay.com/payments';

const getSiteOrigin = () => Deno.env.get('SITE_ORIGIN') || 'https://afristay.rw';

const jsonRes  = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const failJson = (msg: string, status = 400) => jsonRes({ error: msg }, status);

/* ── Send email via Resend ── */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key  = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM') || 'AfriStay <bookings@dm.afristay.rw>';
  if (!key) { console.error('[EMAIL] No RESEND_API_KEY'); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) console.error('[EMAIL] Resend error:', res.status, await res.text());
  else console.log('[EMAIL] Sent to:', to);
}

/* ── Create IremboPay invoice ── */
async function createIremboInvoice(b: {
  total_amount: number; listing_title: string; booking_id: string;
  guest_name: string; guest_email: string; guest_phone?: string;
}): Promise<{ payment_url: string; invoice_number: string } | null> {
  const secretKey     = Deno.env.get('IREMBO_SECRET_KEY');
  const accountId     = Deno.env.get('IREMBO_PAYMENT_ACCOUNT');
  const productCode   = Deno.env.get('IREMBO_PRODUCT_CODE');

  if (!secretKey || !accountId || !productCode) {
    console.warn('[IREMBO] Missing IREMBO_SECRET_KEY, IREMBO_PAYMENT_ACCOUNT, or IREMBO_PRODUCT_CODE — skipping payment link');
    return null;
  }

  try {
    const res = await fetch(`${IREMBO_BASE_URL}/invoices`, {
      method:  'POST',
      headers: {
        'irembopay-secretkey': secretKey,
        'X-API-Version':       '3',
        'Content-Type':        'application/json',
      },
      body: JSON.stringify({
        transactionId:            b.booking_id,
        paymentAccountIdentifier: accountId,
        description:              `AfriStay booking: ${b.listing_title}`,
        expiryAt:                 new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        language:                 'EN',
        paymentItems: [
          { code: productCode, quantity: 1, unitAmount: Number(b.total_amount) },
        ],
        customer: {
          name:        b.guest_name,
          email:       b.guest_email,
          phoneNumber: b.guest_phone || undefined,
        },
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      console.error('[IREMBO] Invoice creation failed:', res.status, raw);
      return null;
    }

    const result = JSON.parse(raw);
    const paymentLinkUrl  = result?.data?.paymentLinkUrl;
    const invoiceNumber   = result?.data?.invoiceNumber;
    if (!paymentLinkUrl) { console.error('[IREMBO] No paymentLinkUrl in response:', raw); return null; }
    console.log('[IREMBO] Invoice created:', invoiceNumber, paymentLinkUrl);
    return { payment_url: paymentLinkUrl, invoice_number: invoiceNumber };
  } catch (e) {
    console.error('[IREMBO] Invoice creation error:', e.message);
    return null;
  }
}

/* ── Approval email to guest ── */
function approvedEmail(p: {
  guestName: string; ownerName: string; listingTitle: string;
  startDate: string; endDate: string; nights: number;
  totalAmount: number; currency: string; bookingRef: string;
  paymentUrl: string; isIrembo: boolean;
}): string {
  const fmt = (d: string) => {
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
  };
  const ctaLabel = p.isIrembo ? '💳 Complete Payment Now' : '✓ Confirm My Stay';
  const ctaBg    = p.isIrembo ? '#EB6753' : '#16a34a';
  const urgency  = p.isIrembo
    ? `Complete your payment within 48 hours to lock in your booking. The payment link will expire after that.`
    : `Click below to confirm your stay. This link expires in 48 hours.`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f2f0ec;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0ec;padding:40px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.06);">
  <tr><td style="background:#f5f5f5;border-radius:20px 20px 0 0;padding:32px 40px;text-align:center;border-bottom:1px solid #ebebdd;">
    <img src="https://afristay.rw/Pictures/light-afri.svg" alt="AfriStay" width="160" style="display:block;margin:0 auto;">
    <div style="color:#a6a68d;font-size:11px;margin-top:14px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;">Booking Approved</div>
  </td></tr>
  <tr><td style="background:#16a34a;padding:26px 40px;text-align:center;">
    <div style="font-size:38px;margin-bottom:8px;">🎉</div>
    <div style="color:#fff;font-size:22px;font-weight:800;">Your Stay is Approved!</div>
    <div style="color:rgba(255,255,255,.85);font-size:14px;margin-top:6px;">${p.isIrembo ? 'Complete payment to confirm your booking' : 'Confirm now to lock in your booking'}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px 40px;">
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#1a1a1a;">Hi ${p.guestName},</p>
    <p style="margin:0 0 26px;font-size:15px;color:#555;line-height:1.75;">
      <strong>${p.ownerName}</strong> approved your request for <strong style="color:#1a1a1a;">${p.listingTitle}</strong>.
      ${p.isIrembo ? 'Click below to complete your payment and confirm the booking.' : ''}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:14px;margin-bottom:22px;border:1px solid #bbf7d0;">
    <tr><td style="padding:22px 24px;">
      <div style="font-size:11px;font-weight:800;color:#16a34a;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">Booking Summary</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;">Reference</td><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:800;color:#16a34a;text-align:right;font-family:monospace;">${p.bookingRef}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;">Property</td><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:700;color:#1a1a1a;text-align:right;">${p.listingTitle}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;">Check-in</td><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;">${fmt(p.startDate)}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;">Check-out</td><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;">${fmt(p.endDate)}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;color:#555;">Nights</td><td style="padding:8px 0;border-bottom:1px solid #dcfce7;font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;">${p.nights}</td></tr>
        <tr><td style="padding:12px 0 0;font-size:15px;font-weight:800;color:#1a1a1a;">Total</td><td style="padding:12px 0 0;font-size:20px;font-weight:900;color:#EB6753;text-align:right;">${Number(p.totalAmount).toLocaleString('en-RW')} ${p.currency}</td></tr>
      </table>
    </td></tr></table>
    <a href="${p.paymentUrl}" style="display:block;background:${ctaBg};color:#fff;text-decoration:none;text-align:center;padding:20px;border-radius:14px;font-size:18px;font-weight:800;margin-bottom:18px;">${ctaLabel}</a>
    <div style="background:#fefce8;border:1.5px solid #fde047;border-radius:12px;padding:14px 18px;">
      <p style="margin:0;font-size:13px;color:#713f12;line-height:1.65;">${urgency}</p>
    </div>
  </td></tr>
  <tr><td style="background:#16213e;border-radius:0 0 20px 20px;padding:22px 40px;text-align:center;">
    <a href="https://afristay.rw" style="color:rgba(255,255,255,.85);font-size:13px;font-weight:700;text-decoration:none;">afristay.rw</a>
    <p style="margin:8px 0 0;font-size:11px;color:rgba(255,255,255,.25);">© ${new Date().getFullYear()} AfriStay · Rwanda's Premier Rental Platform</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

/* ── Rejection email to guest ── */
function rejectedEmail(p: {
  guestName: string; listingTitle: string;
  startDate: string; endDate: string; bookingRef: string; reason?: string;
}): string {
  const fmt = (d: string) => {
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2f0ec;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0ec;padding:40px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.06);">
  <tr><td style="background:#f5f5f5;border-radius:20px 20px 0 0;padding:32px 40px;text-align:center;border-bottom:1px solid #ebebdd;">
    <img src="https://afristay.rw/Pictures/light-afri.svg" alt="AfriStay" width="160" style="display:block;margin:0 auto;">
    <div style="color:#a6a68d;font-size:11px;margin-top:14px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;">Booking Update</div>
  </td></tr>
  <tr><td style="background:#EB6753;padding:22px 40px;text-align:center;">
    <div style="color:#fff;font-size:20px;font-weight:800;">Update on Your Booking Request</div>
    <div style="color:rgba(255,255,255,.88);font-size:13px;margin-top:5px;">Ref: ${p.bookingRef}</div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px 40px;">
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#1a1a1a;">Hi ${p.guestName},</p>
    <p style="margin:0 0 22px;font-size:15px;color:#555;line-height:1.75;">
      Unfortunately the host was unable to accommodate your request for <strong>${p.listingTitle}</strong>
      (${fmt(p.startDate)} → ${fmt(p.endDate)}). No charges were made.
    </p>
    ${p.reason ? `<div style="background:#fdf1ef;border:1.5px solid #f9dad5;border-radius:12px;padding:14px 18px;margin-bottom:22px;"><p style="margin:0;font-size:13px;color:#b91c1c;"><strong>Host's note:</strong> ${p.reason}</p></div>` : ''}
    <a href="https://afristay.rw/Listings" style="display:block;background:#EB6753;color:#fff;text-decoration:none;text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:800;">Browse Similar Listings</a>
  </td></tr>
  <tr><td style="background:#16213e;border-radius:0 0 20px 20px;padding:22px 40px;text-align:center;">
    <p style="margin:0;font-size:11px;color:rgba(255,255,255,.25);">© ${new Date().getFullYear()} AfriStay · <a href="https://afristay.rw" style="color:#EB6753;text-decoration:none;">afristay.rw</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

/* ── Core: approve ── */
async function doApprove(sb: ReturnType<typeof createClient>, bookingId: string) {
  const { data: b, error } = await sb
    .from('bookings')
    .select('*, listings(title,owner_id,currency), profiles!bookings_user_id_fkey(full_name,email)')
    .eq('id', bookingId).single();

  if (error || !b) return { ok: false, msg: 'Booking not found' };
  if (!['awaiting_approval', 'pending'].includes(b.status))
    return { ok: false, msg: `Booking is already ${b.status}` };

  const { error: updErr } = await sb.from('bookings')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approval_token: null })
    .eq('id', bookingId);
  if (updErr) return { ok: false, msg: 'Update failed: ' + updErr.message };

  const { data: owner } = await sb.from('profiles').select('full_name').eq('id', b.listings?.owner_id).single();

  const nights     = b.nights || Math.ceil((new Date(b.end_date).getTime() - new Date(b.start_date).getTime()) / 86400000);
  const guestEmail = b.guest_email || b.profiles?.email;

  // Try to create IremboPay invoice
  let paymentUrl = `${getSiteOrigin()}/Listings/Checkout/confirm/?booking_id=${bookingId}`;
  let isIrembo   = false;

  if (guestEmail) {
    const invoice = await createIremboInvoice({
      total_amount:  Number(b.total_amount),
      listing_title: b.listings?.title || 'AfriStay Listing',
      booking_id:    bookingId,
      guest_name:    b.guest_name || b.profiles?.full_name || 'Guest',
      guest_email:   guestEmail,
      guest_phone:   b.guest_phone || undefined,
    });

    if (invoice) {
      paymentUrl = invoice.payment_url;
      isIrembo   = true;
      await sb.from('bookings').update({ irembo_reference: invoice.invoice_number }).eq('id', bookingId);
    }
  }

  if (guestEmail) {
    await sendEmail(
      guestEmail,
      isIrembo
        ? `Your stay at ${b.listings?.title} is approved — complete payment now`
        : `Your stay at ${b.listings?.title} is approved — confirm now`,
      approvedEmail({
        guestName:    b.guest_name || b.profiles?.full_name || 'Guest',
        ownerName:    owner?.full_name || 'Your host',
        listingTitle: b.listings?.title || 'your listing',
        startDate:    b.start_date,
        endDate:      b.end_date,
        nights,
        totalAmount:  Number(b.total_amount),
        currency:     b.listings?.currency || b.currency || 'RWF',
        bookingRef:   b.booking_reference || bookingId.slice(0, 8).toUpperCase(),
        paymentUrl,
        isIrembo,
      }),
    );
  }

  return { ok: true, irembo: isIrembo, payment_url: isIrembo ? paymentUrl : undefined };
}

/* ── Core: reject ── */
async function doReject(sb: ReturnType<typeof createClient>, bookingId: string, reason?: string) {
  const { data: b } = await sb
    .from('bookings')
    .select('*, listings(title,listing_id), profiles!bookings_user_id_fkey(full_name,email)')
    .eq('id', bookingId).single();
  if (!b) return { ok: false, msg: 'Booking not found' };

  await sb.from('bookings').update({
    status:         'rejected',
    rejected_at:    new Date().toISOString(),
    reject_reason:  reason || null,
    approval_token: null,
  }).eq('id', bookingId);

  if (b.listing_id) {
    await sb.from('listings').update({ availability_status: 'available' }).eq('id', b.listing_id);
  }

  const guestEmail = b.guest_email || b.profiles?.email;
  if (guestEmail) {
    await sendEmail(
      guestEmail,
      `Update on your booking request — ${b.booking_reference || ''}`,
      rejectedEmail({
        guestName:    b.guest_name || b.profiles?.full_name || 'Guest',
        listingTitle: b.listings?.title || 'the listing',
        startDate:    b.start_date,
        endDate:      b.end_date,
        bookingRef:   b.booking_reference || bookingId.slice(0, 8).toUpperCase(),
        reason,
      }),
    );
  }
  return { ok: true };
}

/* ── Resolve approval token ── */
async function resolveToken(sb: ReturnType<typeof createClient>, token: string) {
  const { data, error } = await sb
    .from('bookings')
    .select('id, status, approval_token_expires_at, booking_reference, guest_name, listings(title)')
    .eq('approval_token', token)
    .single();

  if (error || !data) return { err: 'Booking not found or link already used' };
  if (data.approval_token_expires_at && new Date(data.approval_token_expires_at) < new Date())
    return { err: 'This approval link has expired' };
  if (!['awaiting_approval', 'pending'].includes(data.status))
    return { err: `This booking is already ${data.status}` };

  return {
    id:        data.id,
    ref:       data.booking_reference || data.id.slice(0, 8).toUpperCase(),
    guestName: data.guest_name || 'Guest',
    listing:   (data.listings as { title: string } | null)?.title || 'Listing',
  };
}

/* ════ MAIN ════ */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  /* ══ GET ══ */
  if (req.method === 'GET') {
    const url        = new URL(req.url);
    const token      = url.searchParams.get('token') || '';
    const action     = (url.searchParams.get('action') || 'approve').toLowerCase();
    const siteOrigin = getSiteOrigin();

    if (url.searchParams.get('info') === '1') {
      if (!token) return jsonRes({ error: 'No token provided' }, 400);
      const resolved = await resolveToken(sb, token);
      if (resolved.err) return jsonRes({ error: resolved.err }, 400);
      return jsonRes({ ref: resolved.ref, guestName: resolved.guestName, listing: resolved.listing });
    }

    if (!token) {
      return new Response(null, {
        status: 302,
        headers: { ...CORS, Location: `${siteOrigin}/Listings/Checkout/approve/?error=notoken` },
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        ...CORS,
        Location: `${siteOrigin}/Listings/Checkout/approve/?token=${encodeURIComponent(token)}&action=${encodeURIComponent(action)}`,
      },
    });
  }

  /* ══ POST ══ */
  if (req.method === 'POST') {
    let body: Record<string, string>;
    try { body = await req.json(); } catch { return failJson('Invalid JSON'); }

    const { token, action, booking_id, reason } = body;

    /* Token route — owner or admin clicking from email */
    if (token) {
      const resolved = await resolveToken(sb, token);
      if (resolved.err) return failJson(resolved.err);

      if (action === 'reject') {
        const r = await doReject(sb, resolved.id!, reason);
        return r.ok ? jsonRes({ success: true, action: 'rejected' }) : failJson(r.msg || 'Failed');
      }
      const r = await doApprove(sb, resolved.id!);
      return r.ok ? jsonRes({ success: true, action: 'approved', irembo: r.irembo, payment_url: r.payment_url }) : failJson(r.msg || 'Failed');
    }

    /* Auth route — dashboard buttons */
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !booking_id) return failJson('Provide token or auth + booking_id', 401);

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await sb.auth.getUser(jwt);
    if (authErr || !user) return failJson('Unauthorized', 401);

    const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
    const { data: bk }      = await sb.from('bookings').select('listing_id').eq('id', booking_id).single();
    if (!bk) return failJson('Booking not found', 404);
    const { data: listing } = await sb.from('listings').select('owner_id').eq('id', bk.listing_id).single();
    if (listing?.owner_id !== user.id && profile?.role !== 'admin') return failJson('Not authorized', 403);

    if (action === 'reject') {
      const r = await doReject(sb, booking_id, reason);
      return r.ok ? jsonRes({ success: true }) : failJson(r.msg || 'Failed');
    }
    const r = await doApprove(sb, booking_id);
    return r.ok ? jsonRes({ success: true, irembo: r.irembo, payment_url: r.payment_url }) : failJson(r.msg || 'Failed');
  }

  return failJson('Method not allowed', 405);
});
