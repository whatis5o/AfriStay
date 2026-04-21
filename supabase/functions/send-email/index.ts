// @ts-nocheck
// AfriStay — send-email Edge Function v2
// Deploy: supabase functions deploy send-email --no-verify-jwt
// Required secret: RESEND_API_KEY (Supabase Dashboard → Edge Functions → Secrets)
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  attachments?: { filename: string; content: string }[];
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

// ── Booking request to owner/admin ────────────────────────────────
function bookingRequestHtml(p: {
  recipient_name: string; listing_title: string; is_admin?: boolean;
  guest_name: string; guest_email: string; guest_phone?: string;
  start_date: string; end_date: string; nights: number;
  total: number; currency: string; booking_id: string;
  guest_notes?: string;
  price_per_unit?: number;
  commission?: number;
  owner_name?: string; owner_email?: string; owner_phone?: string;
  approve_url?: string; reject_url?: string;
  _subject_override?: string;
}) {
  const ref = '#' + String(p.booking_id).slice(0,8).toUpperCase();
  const row = (label: string, value: string, highlight = false) => `
    <tr>
      <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0f0;width:42%;">${label}</td>
      <td style="font-size:13px;font-weight:${highlight ? '800' : '600'};color:${highlight ? '#EB6753' : '#1a1a1a'};padding:6px 0;border-bottom:1px solid #f0f0f0;">${value}</td>
    </tr>`;

  const adminOwnerBox = p.is_admin && p.owner_name ? `
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:22px;background:#fffbeb;border-radius:14px;border:1.5px solid #fde047;">
    <tbody><tr><td style="padding:18px 22px;">
      <p style="margin:0 0 10px;font-size:11px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:1px;">Owner to Contact</p>
      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1a1a1a;">${p.owner_name}</p>
      ${p.owner_email ? `<a href="mailto:${p.owner_email}" style="color:#EB6753;font-size:13px;text-decoration:none;display:block;">${p.owner_email}</a>` : ''}
      ${p.owner_phone ? `<p style="margin:4px 0 0;font-size:13px;color:#555;">${p.owner_phone}</p>` : ''}
      <p style="margin:12px 0 0;font-size:13px;color:#92400e;line-height:1.6;">
        <strong>Action needed:</strong> Please contact the owner and remind them to respond to this booking request as soon as possible. The booking expires in 12 hours.
      </p>
    </td></tr></tbody></table>` : '';

  const actionButtons = (() => {
    if (p.is_admin && p.approve_url) {
      return `
        <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:14px;">
          <tbody><tr>
            <td width="49%" style="padding-right:6px;">
              <a href="${p.approve_url}" style="color:#fff;text-decoration:none;display:block;background:#16a34a;text-align:center;padding:15px;border-radius:12px;font-size:14px;font-weight:700;">✓ Approve Yourself</a>
            </td>
            <td width="49%" style="padding-left:6px;">
              <a href="${p.reject_url || '#'}" style="color:#fff;text-decoration:none;display:block;background:#dc2626;text-align:center;padding:15px;border-radius:12px;font-size:14px;font-weight:700;">✕ Reject</a>
            </td>
          </tr></tbody>
        </table>
        <p style="margin:0 0 20px;font-size:12px;color:#aaa;text-align:center;">Or contact the owner above and have them approve via their dashboard.</p>
        <a href="https://afristay.rw/Dashboards/Admin/" style="color:#EB6753;text-decoration:none;display:block;text-align:center;padding:12px;border-radius:12px;font-size:13px;font-weight:600;border:1.5px solid #EB6753;">Open Admin Dashboard</a>`;
    }
    if (!p.is_admin && p.approve_url) {
      return `
        <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:14px;">
          <tbody><tr>
            <td width="49%" style="padding-right:6px;">
              <a href="${p.approve_url}" style="color:#fff;text-decoration:none;display:block;background:#16a34a;text-align:center;padding:15px;border-radius:12px;font-size:14px;font-weight:700;">✓ Approve</a>
            </td>
            <td width="49%" style="padding-left:6px;">
              <a href="${p.reject_url || '#'}" style="color:#fff;text-decoration:none;display:block;background:#dc2626;text-align:center;padding:15px;border-radius:12px;font-size:14px;font-weight:700;">✕ Reject</a>
            </td>
          </tr></tbody>
        </table>
        <p style="margin:0 0 0;font-size:12px;color:#aaa;text-align:center;">Or manage in your <a href="https://afristay.rw/Dashboards/Owner/" style="color:#EB6753;">Owner Dashboard</a></p>`;
    }
    const dashUrl = p.is_admin ? 'https://afristay.rw/Dashboards/Admin/' : 'https://afristay.rw/Dashboards/Owner/';
    return `<a href="${dashUrl}" style="color:#fff;text-decoration:none;display:block;background:#EB6753;text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:700;">${p.is_admin ? 'View in Admin Dashboard' : 'Review &amp; Respond'}</a>`;
  })();

  const header = `
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">New Booking Request</p>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:13px;">${p.listing_title}</p>`;

  const body = `
    <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1a1a1a;">Hello ${p.recipient_name},</p>
    <p style="margin:0 0 22px;font-size:15px;color:#555;line-height:1.75;">
      ${p.is_admin
        ? `<strong>${p.guest_name}</strong> has requested to book <strong>${p.listing_title}</strong>. Review the details below and either approve it yourself or contact the owner.`
        : `<strong>${p.guest_name}</strong> has requested a booking for <strong>${p.listing_title}</strong>. Please respond as soon as possible — the booking expires in 12 hours.`
      }
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:22px;background:#f9fafb;border-radius:14px;border:1px solid #eee;">
    <tbody><tr><td style="padding:22px 24px;">
      <p style="margin:0 0 14px;font-size:11px;font-weight:800;color:#EB6753;text-transform:uppercase;letter-spacing:1px;">Booking Details</p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tbody>
        ${row('Guest', p.guest_name)}
        ${row('Guest Email', `<a href="mailto:${p.guest_email}" style="color:#EB6753;text-decoration:none;">${p.guest_email}</a>`)}
        ${p.guest_phone ? row('Guest Phone', p.guest_phone) : ''}
        ${row('Check-in', fmtDate(p.start_date))}
        ${row('Check-out', fmtDate(p.end_date))}
        ${row('Duration', `${p.nights} night${p.nights !== 1 ? 's' : ''}`)}
        ${p.price_per_unit ? row('Price / Night', `${p.currency} ${Number(p.price_per_unit).toLocaleString()}`) : ''}
        ${p.guest_notes ? row('Guest Notes', `<em>${p.guest_notes}</em>`) : ''}
        <tr>
          <td style="font-size:14px;font-weight:700;color:#1a1a1a;padding:10px 0 4px;">Total</td>
          <td style="font-size:15px;font-weight:800;color:#EB6753;padding:10px 0 4px;">${p.currency} ${p.total.toLocaleString()}</td>
        </tr>
        ${p.commission != null ? `<tr>
          <td style="font-size:13px;color:#888;padding:4px 0 0;">AfriStay Commission (10%)</td>
          <td style="font-size:13px;font-weight:700;color:#16a34a;padding:4px 0 0;">${p.currency} ${p.commission.toLocaleString()}</td>
        </tr>` : ''}
      </tbody></table>
    </td></tr></tbody></table>

    ${adminOwnerBox}

    <div style="margin-bottom:22px;">${actionButtons}</div>

    <p style="margin:0;font-size:12px;color:#ccc;">Ref: <strong style="color:#999;">${ref}</strong></p>`;

  return emailShell('#EB6753', header, body);
}

// ── Guest booking confirmation ────────────────────────────────────
function bookingReceivedUserHtml(p: {
  guest_name: string; listing_title: string;
  start_date: string; end_date: string; nights: number;
  total: number; currency: string; booking_id: string;
  category_slug?: string;
}) {
  const isVeh  = p.category_slug === 'vehicle';
  const inLbl  = isVeh ? 'Pick-up'  : 'Check-in';
  const outLbl = isVeh ? 'Return'   : 'Check-out';
  const durLbl = isVeh ? 'Days'     : 'Nights';

  const header = `
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">Booking Request Received!</p>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:13px;">${p.listing_title}</p>`;

  const body = `
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#1a1a1a;">Hi ${p.guest_name},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.75;">
      Your booking request for <strong>${p.listing_title}</strong> has been received and sent to the host for review.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:28px;background:#f9fafb;border-radius:14px;border:1px solid #eee;">
    <tbody><tr><td style="padding:22px 24px;">
      <p style="margin:0 0 14px;font-size:11px;font-weight:800;color:#EB6753;text-transform:uppercase;letter-spacing:1px;">Your Booking Summary</p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
        <tbody>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0f0;width:40%;">${inLbl}</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #f0f0f0;">${fmtDate(p.start_date)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0f0;">${outLbl}</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #f0f0f0;">${fmtDate(p.end_date)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0f0;">${durLbl}</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #f0f0f0;">${p.nights}</td>
          </tr>
          <tr>
            <td style="font-size:14px;font-weight:700;color:#1a1a1a;padding:8px 0 0;">Estimated Total</td>
            <td style="font-size:14px;font-weight:800;color:#EB6753;padding:8px 0 0;">${p.currency} ${p.total.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </td></tr></tbody></table>

    <!-- What happens next -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:28px;background:#fff8f3;border-radius:14px;border:1px solid #fdd5c4;">
    <tbody><tr><td style="padding:20px 22px;">
      <p style="margin:0 0 14px;font-size:11px;font-weight:800;color:#EB6753;text-transform:uppercase;letter-spacing:1px;">What happens next?</p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:24px;vertical-align:top;padding-top:1px;">
            <span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:#EB6753;color:#fff;font-size:10px;font-weight:800;align-items:center;justify-content:center;">1</span>
          </td>
          <td style="font-size:13px;color:#555;padding:0 0 10px 10px;line-height:1.5;">The host reviews your request (typically within 12 hours)</td>
        </tr>
        <tr>
          <td style="width:24px;vertical-align:top;padding-top:1px;">
            <span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:#EB6753;color:#fff;font-size:10px;font-weight:800;align-items:center;justify-content:center;">2</span>
          </td>
          <td style="font-size:13px;color:#555;padding:0 0 10px 10px;line-height:1.5;">You'll receive an email notification once they respond</td>
        </tr>
        <tr>
          <td style="width:24px;vertical-align:top;padding-top:1px;">
            <span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:#EB6753;color:#fff;font-size:10px;font-weight:800;align-items:center;justify-content:center;">3</span>
          </td>
          <td style="font-size:13px;color:#555;padding:0 0 0 10px;line-height:1.5;">If approved, a secure payment link will be sent to your email</td>
        </tr>
      </table>
    </td></tr></tbody></table>

    <p style="margin:0 0 28px;">
      <a href="https://afristay.rw/Dashboards/Profile/?tab=bookings"
        style="color:#ffffff;text-decoration:none;display:block;background:#EB6753;
               text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:700;">
        View My Bookings
      </a>
    </p>

    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;text-align:center;">
      Booking ref: <strong style="color:#555;">#${String(p.booking_id).slice(0,8).toUpperCase()}</strong><br>
      No payment is charged until the host approves your request.
    </p>`;

  return emailShell('#EB6753', header, body);
}

// ── Booking approved — email to guest ────────────────────────────
function bookingApprovedUserHtml(p: {
  guest_name: string; listing_title: string;
  start_date: string; end_date: string; nights: number;
  total: number; currency: string; booking_id: string;
  checkout_url: string; category_slug?: string;
}) {
  const isVeh  = p.category_slug === 'vehicle';
  const inLbl  = isVeh ? 'Pick-up'  : 'Check-in';
  const outLbl = isVeh ? 'Return'   : 'Check-out';
  const durLbl = isVeh ? 'Days'     : 'Nights';

  const header = `
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">&#127881; Booking Approved!</p>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:13px;">${p.listing_title}</p>`;

  const body = `
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#1a1a1a;">Hi ${p.guest_name},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.75;">
      Great news! The host has <strong>approved your booking request</strong> for <strong>${p.listing_title}</strong>.
      Click the button below to complete your payment and confirm your ${isVeh ? 'rental' : 'stay'}.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:28px;background:#f0fdf4;border-radius:14px;border:1px solid #bbf7d0;">
    <tbody><tr><td style="padding:22px 24px;">
      <p style="margin:0 0 14px;font-size:11px;font-weight:800;color:#16a34a;text-transform:uppercase;letter-spacing:1px;">Approved Booking Details</p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
        <tbody>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #d1fae5;width:40%;">${inLbl}</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #d1fae5;">${fmtDate(p.start_date)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #d1fae5;">${outLbl}</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #d1fae5;">${fmtDate(p.end_date)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:6px 0;border-bottom:1px solid #d1fae5;">${durLbl}</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:6px 0;border-bottom:1px solid #d1fae5;">${p.nights}</td>
          </tr>
          <tr>
            <td style="font-size:14px;font-weight:700;color:#1a1a1a;padding:8px 0 0;">Total Due</td>
            <td style="font-size:14px;font-weight:800;color:#16a34a;padding:8px 0 0;">${p.currency} ${p.total.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </td></tr></tbody></table>

    <p style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.7;">
      This approval is valid for <strong>24 hours</strong>. Complete your payment to secure your booking.
    </p>

    <p style="margin:0 0 28px;">
      <a href="${p.checkout_url}"
        style="color:#ffffff;text-decoration:none;display:block;background:#16a34a;
               text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:700;">
        &#128274; Complete Payment
      </a>
    </p>

    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;text-align:center;">
      Booking ref: <strong style="color:#555;">#${String(p.booking_id).slice(0,8).toUpperCase()}</strong><br>
      If you have any questions, reply to this email.
    </p>`;

  return emailShell('#16a34a', header, body);
}

// ── Booking rejected — email to guest ────────────────────────────
function bookingRejectedUserHtml(p: {
  guest_name: string; listing_title: string;
  reject_reason?: string; booking_id: string;
  category_slug?: string;
}) {
  const catSlug  = p.category_slug || 'property';
  const browseUrl = `https://afristay.rw/Listings/?category=${catSlug}`;

  const header = `
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">Booking Request Declined</p>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:13px;">${p.listing_title}</p>`;

  const body = `
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#1a1a1a;">Hi ${p.guest_name},</p>
    <p style="margin:0 0 ${p.reject_reason ? '16' : '24'}px;font-size:15px;color:#555;line-height:1.75;">
      Unfortunately, the host was unable to accept your booking request for
      <strong>${p.listing_title}</strong> at this time.
    </p>

    ${p.reject_reason ? `
    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:24px;background:#fff8f3;border-radius:12px;border:1px solid #fdd5c4;">
    <tbody><tr><td style="padding:16px 20px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:800;color:#EB6753;text-transform:uppercase;letter-spacing:1px;">Host's message</p>
      <p style="margin:0;font-size:14px;color:#555;line-height:1.6;font-style:italic;">"${p.reject_reason}"</p>
    </td></tr></tbody></table>` : ''}

    <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.75;">
      Don't worry — there are many other great options available. Browse similar listings and find
      your perfect ${p.category_slug === 'vehicle' ? 'vehicle' : 'stay'} on AfriStay.
    </p>

    <p style="margin:0 0 28px;">
      <a href="${browseUrl}"
        style="color:#ffffff;text-decoration:none;display:block;background:#EB6753;
               text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:700;">
        Browse Similar Listings
      </a>
    </p>

    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;text-align:center;">
      Booking ref: <strong style="color:#555;">#${String(p.booking_id).slice(0,8).toUpperCase()}</strong><br>
      No charges were made for this request.
    </p>`;

  return emailShell('#EB6753', header, body);
}

// ── Booking expiry reminder — email to guest ─────────────────────
function bookingExpiryReminderUserHtml(p: {
  guest_name: string; listing_title: string;
  start_date: string; end_date: string;
  hours_left: number; booking_id: string; category_slug?: string;
}) {
  const isVeh = p.category_slug === 'vehicle';

  const header = `
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">&#9200; Your Request is Expiring</p>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:13px;">${p.listing_title}</p>`;

  const body = `
    <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#1a1a1a;">Hi ${p.guest_name},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.75;">
      Your booking request for <strong>${p.listing_title}</strong> is expiring in approximately
      <strong>${p.hours_left} hour${p.hours_left !== 1 ? 's' : ''}</strong>.
      The host has not yet responded.
    </p>

    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"
      style="margin-bottom:28px;background:#fffbf0;border-radius:14px;border:1px solid #fde68a;">
    <tbody><tr><td style="padding:18px 22px;">
      <p style="margin:0 0 10px;font-size:11px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:1px;">Booking Details</p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
        <tbody>
          <tr>
            <td style="font-size:13px;color:#888;padding:5px 0;border-bottom:1px solid #fef3c7;width:40%;">${isVeh ? 'Pick-up' : 'Check-in'}</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:5px 0;border-bottom:1px solid #fef3c7;">${fmtDate(p.start_date)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888;padding:5px 0;">${isVeh ? 'Return' : 'Check-out'}</td>
            <td style="font-size:13px;font-weight:600;color:#1a1a1a;padding:5px 0;">${fmtDate(p.end_date)}</td>
          </tr>
        </tbody>
      </table>
    </td></tr></tbody></table>

    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.75;">
      If the host does not respond before the deadline, your request will be
      <strong>automatically cancelled</strong> at no charge. You can then search for another listing.
    </p>

    <p style="margin:0 0 28px;">
      <a href="https://afristay.rw/Listings"
        style="color:#ffffff;text-decoration:none;display:block;background:#EB6753;
               text-align:center;padding:18px;border-radius:14px;font-size:16px;font-weight:700;">
        Browse Other Listings
      </a>
    </p>

    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;text-align:center;">
      Booking ref: <strong style="color:#555;">#${String(p.booking_id).slice(0,8).toUpperCase()}</strong><br>
      No payment has been charged.
    </p>`;

  return emailShell('#f59e0b', header, body);
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

    // ── owner_invite ──────────────────────────────────────────────
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

    // ── custom ────────────────────────────────────────────────────
    } else if (type === 'custom') {
      const { to, subject, body: emailBody, sender_name, sender_email, sender_title, sender_phone, attachment } = body;
      if (!to || !subject || !emailBody) return json({ error: 'Missing fields: to, subject, body' }, 400);

      const payload: any = {
        from:    `${sender_name} via AfriStay <${sender_email}>`,
        to,
        subject,
        html:    customEmailHtml({ subject, body: emailBody, sender_name, sender_email, sender_title, sender_phone }),
      };
      if (attachment?.filename && attachment?.content) {
        payload.attachments = [{ filename: attachment.filename, content: attachment.content }];
      }
      const result = await sendEmail(RESEND_API_KEY, payload);
      return json({ ok: true, id: result.id });

    // ── booking_request (single recipient) ────────────────────────
    } else if (type === 'booking_request') {
      const { to, owner_name, listing_title, guest_name, guest_email, guest_phone, start_date, end_date, nights, total, currency, booking_id, guest_notes } = body;
      if (!to || !guest_name || !listing_title) return json({ error: 'Missing fields: to, guest_name, listing_title' }, 400);

      const result = await sendEmail(RESEND_API_KEY, {
        from:    'AfriStay Bookings <info@afristay.rw>',
        to,
        subject: `New booking request: ${listing_title} — ${guest_name}`,
        html:    bookingRequestHtml({
          recipient_name: owner_name || 'there', listing_title,
          guest_name, guest_email, guest_phone: guest_phone || '',
          start_date, end_date, nights: nights || 1,
          total: total || 0, currency: currency || 'RWF', booking_id,
          guest_notes: guest_notes || '',
        }),
      });
      return json({ ok: true, id: result.id });

    // ── booking_request_all — emails owner + all admins + guest ───
    } else if (type === 'booking_request_all') {
      const { booking_id } = body;
      if (!booking_id) return json({ error: 'booking_id is required' }, 400);

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase env not configured' }, 500);

      const sb = createClient(supabaseUrl, serviceKey);

      // Fetch booking
      const { data: booking, error: bookingErr } = await sb
        .from('bookings')
        .select('id, listing_id, start_date, end_date, nights, total_amount, price_per_unit, currency, guest_name, guest_email, guest_phone, guest_notes, category_slug, approval_token')
        .eq('id', booking_id)
        .single();

      if (bookingErr || !booking) {
        return json({ error: 'Booking not found: ' + (bookingErr?.message || 'unknown') }, 404);
      }

      // Fetch listing + owner profile
      const { data: listing } = await sb
        .from('listings')
        .select('title, owner_id')
        .eq('id', booking.listing_id)
        .single();

      const { data: ownerProfile } = listing?.owner_id
        ? await sb.from('profiles').select('full_name, email, phone').eq('id', listing.owner_id).single()
        : { data: null };

      // Fetch all admin profiles
      const { data: admins } = await sb
        .from('profiles')
        .select('full_name, email')
        .eq('role', 'admin');

      const COMMISSION_PCT = 0.10; // 10% — update if rate changes
      const listingTitle  = listing?.title || 'AfriStay Listing';
      const total         = Number(booking.total_amount) || 0;
      const commission    = Math.round(total * COMMISSION_PCT);
      const supabaseFnUrl = Deno.env.get('SUPABASE_URL')!.replace('supabase.co', 'supabase.co') + '/functions/v1';
      const approveUrl    = booking.approval_token
        ? `${supabaseFnUrl}/approve-booking?token=${booking.approval_token}&action=approve`
        : undefined;
      const rejectUrl     = booking.approval_token
        ? `${supabaseFnUrl}/approve-booking?token=${booking.approval_token}&action=reject`
        : undefined;

      const emailData = {
        listing_title:  listingTitle,
        guest_name:     booking.guest_name  || 'Guest',
        guest_email:    booking.guest_email || '',
        guest_phone:    booking.guest_phone || '',
        guest_notes:    booking.guest_notes || '',
        start_date:     booking.start_date,
        end_date:       booking.end_date,
        nights:         booking.nights || 1,
        total,
        currency:       booking.currency || 'RWF',
        booking_id,
        price_per_unit: Number(booking.price_per_unit) || undefined,
        approve_url:    approveUrl,
        reject_url:     rejectUrl,
      };

      const sent: string[] = [];
      const errors: string[] = [];

      // Email owner
      if (ownerProfile?.email) {
        try {
          await sendEmail(RESEND_API_KEY, {
            from:    'AfriStay Bookings <bookings@dm.afristay.rw>',
            to:      ownerProfile.email,
            subject: `New booking request: ${listingTitle} — ${emailData.guest_name}`,
            html:    bookingRequestHtml({ recipient_name: ownerProfile.full_name || 'Host', ...emailData }),
          });
          sent.push(ownerProfile.email);
        } catch(e: any) { errors.push('owner:' + e.message); }
      }

      // Email all admins (with commission + owner contact info)
      for (const admin of (admins || [])) {
        if (!admin.email || admin.email === ownerProfile?.email) continue;
        try {
          await sendEmail(RESEND_API_KEY, {
            from:    'AfriStay Platform <bookings@dm.afristay.rw>',
            to:      admin.email,
            subject: `[Admin] New booking: ${listingTitle} — ${emailData.guest_name}`,
            html:    bookingRequestHtml({
              recipient_name: admin.full_name || 'Admin',
              is_admin:       true,
              commission,
              owner_name:     ownerProfile?.full_name  || undefined,
              owner_email:    ownerProfile?.email       || undefined,
              owner_phone:    (ownerProfile as any)?.phone || undefined,
              ...emailData,
            }),
          });
          sent.push(admin.email);
        } catch(e: any) { errors.push('admin:' + e.message); }
      }

      // Email guest confirmation
      if (booking.guest_email) {
        try {
          await sendEmail(RESEND_API_KEY, {
            from:    'AfriStay Bookings <info@afristay.rw>',
            to:      booking.guest_email,
            subject: `Booking request received: ${listingTitle}`,
            html:    bookingReceivedUserHtml({
              guest_name:    booking.guest_name || 'Guest',
              listing_title: listingTitle,
              start_date:    booking.start_date,
              end_date:      booking.end_date,
              nights:        booking.nights || 1,
              total:         Number(booking.total_amount) || 0,
              currency:      booking.currency || 'RWF',
              booking_id,
              category_slug: booking.category_slug || '',
            }),
          });
          sent.push(booking.guest_email + ' (guest)');
        } catch(e: any) { errors.push('guest:' + e.message); }
      }

      return json({ ok: true, sent_count: sent.length, sent, errors: errors.length ? errors : undefined });

    // ── booking_expiry_reminder_user ──────────────────────────────
    } else if (type === 'booking_expiry_reminder_user') {
      const { to, guest_name, listing_title, start_date, end_date, hours_left, booking_id, category_slug } = body;
      if (!to || !guest_name || !listing_title) return json({ error: 'Missing fields: to, guest_name, listing_title' }, 400);

      const result = await sendEmail(RESEND_API_KEY, {
        from:    'AfriStay Bookings <info@afristay.rw>',
        to,
        subject: `⏰ Your booking request for ${listing_title} is expiring soon`,
        html:    bookingExpiryReminderUserHtml({ guest_name, listing_title, start_date, end_date, hours_left: hours_left || 3, booking_id, category_slug }),
      });
      return json({ ok: true, id: result.id });

    // ── booking_approved_user ─────────────────────────────────────
    } else if (type === 'booking_approved_user') {
      const { to, guest_name, listing_title, start_date, end_date, nights, total, currency, booking_id, checkout_url, category_slug } = body;
      if (!to || !guest_name || !listing_title || !checkout_url) return json({ error: 'Missing fields: to, guest_name, listing_title, checkout_url' }, 400);

      const result = await sendEmail(RESEND_API_KEY, {
        from:    'AfriStay Bookings <info@afristay.rw>',
        to,
        subject: `Booking approved — ${listing_title}`,
        html:    bookingApprovedUserHtml({ guest_name, listing_title, start_date, end_date, nights: nights || 1, total: total || 0, currency: currency || 'RWF', booking_id, checkout_url, category_slug }),
      });
      return json({ ok: true, id: result.id });

    // ── booking_rejected_user ─────────────────────────────────────
    } else if (type === 'booking_rejected_user') {
      const { to, guest_name, listing_title, reject_reason, booking_id, category_slug } = body;
      if (!to || !guest_name || !listing_title) return json({ error: 'Missing fields: to, guest_name, listing_title' }, 400);

      const result = await sendEmail(RESEND_API_KEY, {
        from:    'AfriStay Bookings <info@afristay.rw>',
        to,
        subject: `Booking request for ${listing_title} — update`,
        html:    bookingRejectedUserHtml({ guest_name, listing_title, reject_reason: reject_reason || '', booking_id, category_slug }),
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
