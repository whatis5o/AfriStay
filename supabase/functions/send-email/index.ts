// @ts-nocheck
// AfriStay — send-email Edge Function
// Deploy: supabase functions deploy send-email --no-verify-jwt
// Required secret: RESEND_API_KEY  (Supabase Dashboard → Edge Functions → Secrets)

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const CAT: Record<string, string> = {
  hotel:      'Hotels & Guest Houses',
  apartment:  'Apartments & Studios',
  villa:      'Villas & Luxury Homes',
  vehicle:    'Vehicles & Car Rentals',
  conference: 'Conference & Event Spaces',
  cottage:    'Cottages & Cabins',
  other:      'Properties',
};

async function sendEmail(apiKey: string, payload: {
  from: string; to: string; subject: string; html: string;
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.name || 'Resend error');
  return data;
}

function fmtDate(dateStr: string) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ── Shared email shell ────────────────────────────────────────────
function emailShell(headerBg: string, headerContent: string, bodyContent: string) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta content="width=device-width" name="viewport" />
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta content="telephone=no,address=no,email=no,date=no,url=no" name="format-detection" />
</head>
<body style="margin:0;padding:0;background:#f2f0ec;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tbody><tr><td>
<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
<tbody><tr style="width:100%"><td>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
  style="padding:40px 16px;background:#f2f0ec;">
<tbody><tr><td>
<tr style="margin:0;padding:0"><td align="center" style="margin:0;padding:0">
<table width="600" border="0" cellpadding="0" cellspacing="0" role="presentation"
  style="max-width:600px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.05);">
<tbody><tr><td>

  <!-- Logo header -->
  <tr><td align="center" style="padding:32px 40px;background:#f5f5f5;border-radius:20px 20px 0 0;text-align:center;border-bottom:1px solid #ebebdd;">
    <a href="https://afristay.rw" style="text-decoration:none;" target="_blank">
      <img alt="AfriStay" src="https://afristay.rw/Pictures/light-afri.svg"
        style="display:block;outline:none;border:0;max-width:100%;margin:0 auto;" width="150" />
    </a>
  </td></tr>

  <!-- Brand header -->
  <tr><td align="center" style="padding:24px 40px;background:${headerBg};text-align:center;">
    ${headerContent}
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:36px 40px;background:#ffffff;">
    ${bodyContent}
  </td></tr>

  <!-- Footer -->
  <tr><td align="center" style="padding:22px 40px;background:#16213e;border-radius:0 0 20px 20px;text-align:center;">
    <a href="https://afristay.rw" style="color:rgba(255,255,255,0.85);font-size:13px;font-weight:700;text-decoration:none;">afristay.rw</a>
    <p style="margin:6px 0 0;font-size:12px;">
      <a href="mailto:info@afristay.rw" style="color:rgba(255,255,255,0.5);text-decoration:none;">info@afristay.rw</a>
    </p>
    <p style="margin:10px 0 0;font-size:10px;color:rgba(255,255,255,0.25);">
      &copy; ${new Date().getFullYear()} AfriStay &middot; Rwanda's Premier Rental Platform
    </p>
  </td></tr>

</td></tr></tbody></table>
</td></tr>
</td></tr></tbody></table>
</td></tr></tbody></table>
</td></tr></tbody></table>
</body></html>`;
}

function signature(p: { sender_name: string; sender_title: string; sender_email: string; sender_phone?: string }) {
  return `
  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
    style="margin-top:28px;padding-top:20px;border-top:1px solid #f0f0f0;">
  <tbody><tr>
    <td>
      <p style="margin:0 0 3px;font-size:13px;color:#aaa;">Best regards,</p>
      <p style="margin:0;font-size:14px;font-weight:700;color:#1a1a1a;">${p.sender_name}</p>
      <p style="margin:2px 0 0;font-size:13px;color:#888;">${p.sender_title}</p>
      <a href="mailto:${p.sender_email}" style="color:#EB6753;font-size:12px;text-decoration:none;display:block;margin-top:4px;">${p.sender_email}</a>
      ${p.sender_phone ? `<p style="margin:3px 0 0;font-size:12px;color:#aaa;">${p.sender_phone}</p>` : ''}
    </td>
    <td align="right" style="vertical-align:middle;">
      <img src="https://afristay.rw/Pictures/light-afri.svg" alt="AfriStay" width="80" style="display:block;" />
    </td>
  </tr></tbody></table>`;
}

// ── Owner invite ──────────────────────────────────────────────────
function ownerInviteHtml(p: {
  invitee_name: string; business: string; category: string; invite_token?: string;
  sender_name: string; sender_email: string; sender_title: string; sender_phone?: string;
}) {
  const cat      = CAT[p.category] || 'Properties';
  const catLower = cat.toLowerCase();
  const ctaUrl   = `https://afristay.rw/join/aX3kP7mR9qN2vL8j/${p.invite_token ? '?t=' + p.invite_token : ''}`;

  const header = `
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">You're Invited to AfriStay</p>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:13px;">List your ${cat} and start earning today</p>`;

  const body = `
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#1a1a1a;">Hello ${p.invitee_name},</p>
    <p style="margin:0 0 18px;font-size:15px;color:#555;line-height:1.75;">
      We'd love to welcome <strong>${p.business}</strong> onto AfriStay — Rwanda's fastest-growing
      platform for property and vehicle rentals.
    </p>
    <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.75;">
      By joining AfriStay, you'll connect with thousands of guests actively looking for quality
      <strong>${catLower}</strong> every day. We handle bookings, payments, and communication
      so you can focus on what you do best.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:28px;background:#fdf1ef;border-radius:14px;border:1px solid #f9dad5;">
    <tbody><tr><td style="padding:22px 24px;">
      <p style="margin:0 0 16px;font-size:11px;font-weight:800;color:#EB6753;text-transform:uppercase;letter-spacing:1px;">Why AfriStay?</p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
      <tbody><tr>
        <td width="32%" style="text-align:center;vertical-align:top;padding:0 6px 0 0;">
          <p style="margin:0;font-size:12px;font-weight:700;color:#EB6753;">Easy Listings</p>
          <p style="margin:4px 0 0;font-size:11px;color:#888;line-height:1.5;">List in minutes with photos &amp; pricing</p>
        </td>
        <td width="36%" style="text-align:center;vertical-align:top;padding:0 3px;">
          <p style="margin:0;font-size:12px;font-weight:700;color:#EB6753;">Earn More</p>
          <p style="margin:4px 0 0;font-size:11px;color:#888;line-height:1.5;">Competitive payouts to your account</p>
        </td>
        <td width="32%" style="text-align:center;vertical-align:top;padding:0 0 0 6px;">
          <p style="margin:0;font-size:12px;font-weight:700;color:#EB6753;">Dashboard</p>
          <p style="margin:4px 0 0;font-size:11px;color:#888;line-height:1.5;">Track bookings &amp; earnings live</p>
        </td>
      </tr></tbody></table>
    </td></tr></tbody></table>

    <p style="margin:0 0 28px;">
      <a href="${ctaUrl}"
        style="color:#ffffff;text-decoration:none;display:block;background:#EB6753;
               text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:700;">
        Create Your Owner Account
      </a>
    </p>

    <p style="margin:0 0 6px;font-size:14px;color:#555;line-height:1.7;">
      Have questions? Simply reply to this email and we'll be happy to help.
    </p>
    <p style="margin:0 0 28px;font-size:14px;color:#555;line-height:1.7;">
      We hope to see <strong>${p.business}</strong> on AfriStay very soon.
    </p>

    ${signature(p)}`;

  return emailShell('#EB6753', header, body);
}

// ── Custom email ──────────────────────────────────────────────────
function customEmailHtml(p: {
  subject: string; body: string;
  sender_name: string; sender_email: string; sender_title: string; sender_phone?: string;
}) {
  const bodyHtml = p.body
    .split('\n\n')
    .map(para => `<p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.75;white-space:pre-wrap;">${para.replace(/\n/g, '<br>')}</p>`)
    .join('');

  const header = `
    <p style="margin:0;color:#ffffff;font-size:20px;font-weight:800;">${p.subject}</p>
    <p style="margin:5px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">A message from the AfriStay team</p>`;

  const body = `
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:24px;background:#f9fafb;border-radius:14px;border:1px solid #eee;">
    <tbody><tr><td style="padding:22px 24px;">
      <p style="margin:0 0 12px;font-size:11px;font-weight:800;color:#EB6753;text-transform:uppercase;letter-spacing:1px;">Message</p>
      ${bodyHtml}
    </td></tr></tbody></table>

    <p style="margin:0 0 28px;">
      <a href="mailto:${p.sender_email}"
        style="color:#ffffff;text-decoration:none;display:block;background:#EB6753;
               text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:700;">
        Reply to ${p.sender_name}
      </a>
    </p>

    ${signature(p)}`;

  return emailShell('#EB6753', header, body);
}

// ── Booking request to owner ──────────────────────────────────────
function bookingRequestHtml(p: {
  owner_name: string; listing_title: string;
  guest_name: string; guest_email: string;
  start_date: string; end_date: string; nights: number;
  total: number; currency: string; booking_id: string;
}) {
  const dashUrl = `https://afristay.rw/Dashboards/Owner/`;

  const header = `
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">New Booking Request</p>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:13px;">${p.listing_title}</p>`;

  const body = `
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#1a1a1a;">Hello ${p.owner_name},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.75;">
      <strong>${p.guest_name}</strong> has requested a booking for <strong>${p.listing_title}</strong>.
      Please review and respond as soon as possible.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:28px;background:#f9fafb;border-radius:14px;border:1px solid #eee;">
    <tbody><tr><td style="padding:22px 24px;">
      <p style="margin:0 0 14px;font-size:11px;font-weight:800;color:#EB6753;text-transform:uppercase;letter-spacing:1px;">Booking Details</p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
        <tbody>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0f0;width:40%;">Guest</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #f0f0f0;">${p.guest_name}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0f0;">Guest Email</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #f0f0f0;">
              <a href="mailto:${p.guest_email}" style="color:#EB6753;text-decoration:none;">${p.guest_email}</a>
            </td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0f0;">Check-in</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #f0f0f0;">${fmtDate(p.start_date)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0f0;">Check-out</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #f0f0f0;">${fmtDate(p.end_date)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0f0;">Duration</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #f0f0f0;">${p.nights} night${p.nights !== 1 ? 's' : ''}</td>
          </tr>
          <tr>
            <td style="font-size:14px;font-weight:700;color:#1a1a1a;padding:8px 0 0;">Total</td>
            <td style="font-size:14px;font-weight:800;color:#EB6753;padding:8px 0 0;">${p.currency} ${p.total.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </td></tr></tbody></table>

    <p style="margin:0 0 28px;">
      <a href="${dashUrl}"
        style="color:#ffffff;text-decoration:none;display:block;background:#EB6753;
               text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:700;">
        Review &amp; Respond in Dashboard
      </a>
    </p>

    <p style="margin:0;font-size:13px;color:#aaa;line-height:1.6;">
      Log in to your owner dashboard to approve or decline this request. The guest will be notified by email once you respond.
    </p>`;

  return emailShell('#EB6753', header, body);
}

// ── Main handler ──────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
  if (!RESEND_API_KEY) return json({ error: 'Email service not configured. Set RESEND_API_KEY in Edge Function secrets.' }, 500);

  try {
    const body = await req.json();
    const { type } = body;

    if (type === 'owner_invite') {
      const { to, invitee_name, business, category, invite_token, sender_name, sender_email, sender_title, sender_phone } = body;
      if (!to || !invitee_name || !business) return json({ error: 'Missing fields: to, invitee_name, business' }, 400);

      const cat = CAT[category] || 'Properties';
      const result = await sendEmail(RESEND_API_KEY, {
        from:    `${sender_name} via AfriStay <${sender_email}>`,
        to,
        subject: `${invitee_name}, you're invited to list your ${cat} on AfriStay`,
        html:    ownerInviteHtml({ invitee_name, business, category, invite_token, sender_name, sender_email, sender_title, sender_phone }),
      });
      return json({ ok: true, id: result.id });

    } else if (type === 'custom') {
      const { to, subject, body: emailBody, sender_name, sender_email, sender_title, sender_phone } = body;
      if (!to || !subject || !emailBody) return json({ error: 'Missing fields: to, subject, body' }, 400);

      const result = await sendEmail(RESEND_API_KEY, {
        from:    `${sender_name} via AfriStay <${sender_email}>`,
        to,
        subject,
        html:    customEmailHtml({ subject, body: emailBody, sender_name, sender_email, sender_title, sender_phone }),
      });
      return json({ ok: true, id: result.id });

    } else if (type === 'booking_request') {
      const { to, owner_name, listing_title, guest_name, guest_email, start_date, end_date, nights, total, currency, booking_id } = body;
      if (!to || !guest_name || !listing_title) return json({ error: 'Missing fields: to, guest_name, listing_title' }, 400);

      const result = await sendEmail(RESEND_API_KEY, {
        from:    'AfriStay Bookings <info@afristay.rw>',
        to,
        subject: `New booking request: ${listing_title} — ${guest_name}`,
        html:    bookingRequestHtml({ owner_name: owner_name || 'there', listing_title, guest_name, guest_email, start_date, end_date, nights: nights || 1, total: total || 0, currency: currency || 'RWF', booking_id }),
      });
      return json({ ok: true, id: result.id });

    } else {
      return json({ error: `Unknown type: "${type}"` }, 400);
    }

  } catch (err) {
    console.error('[SEND-EMAIL]', err);
    return json({ error: (err as Error).message }, 500);
  }
});
