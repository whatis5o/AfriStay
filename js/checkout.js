/**
 * checkout.js — AfriStay v3 (no payment, clean booking flow)
 * Calls: store-booking edge function
 * Place at: /js/checkout.js
 */

console.log('📋 [CHECKOUT] Loading...');

let _supabase    = null;
let CURRENT_USER = null;
let BOOKING_PARAMS = {};

document.addEventListener('DOMContentLoaded', async () => {
    _supabase = window.supabaseClient;
    if (!_supabase) { console.error('❌ [CHECKOUT] No Supabase client'); return; }

    // ── Auth check ────────────────────────────────────────────
    const { data: { user } } = await _supabase.auth.getUser();
    CURRENT_USER = user;

    if (!CURRENT_USER) {
        window.location.href = '/Auth?next=' + encodeURIComponent(window.location.href);
        return;
    }

    // Update nav avatar
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) {
        authBtn.outerHTML = `<a href="/Profile" class="icon-link">
            <i class="fa-solid fa-circle-user" style="font-size:22px;color:#EB6753"></i></a>`;
    }

    // ── Read URL params ───────────────────────────────────────
    const p = new URLSearchParams(window.location.search);
    BOOKING_PARAMS = {
        listing_id: p.get('listing_id'),
        title:      p.get('title')     || 'Listing',
        start_date: p.get('start_date'),
        end_date:   p.get('end_date'),
        nights:     parseInt(p.get('nights'))  || 1,
        price:      parseInt(p.get('price'))   || 0,
        currency:   p.get('currency')  || 'RWF',
        total:      parseInt(p.get('total'))   || 0,
    };

    if (!BOOKING_PARAMS.listing_id || !BOOKING_PARAMS.start_date) {
        showErr('Missing booking information. Please go back and select your dates.');
        disableBtn();
        return;
    }

    renderSummary();
    await loadThumb();
    await loadGuestInfo();
});

/* ── Render booking summary ── */
function renderSummary() {
    const fmt = d => d
        ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' })
        : '—';

    setEl('listingTitle',  BOOKING_PARAMS.title);
    setEl('checkInDate',   fmt(BOOKING_PARAMS.start_date));
    setEl('checkOutDate',  fmt(BOOKING_PARAMS.end_date));
    setEl('nightsLabel',
        `${BOOKING_PARAMS.nights} night${BOOKING_PARAMS.nights !== 1 ? 's' : ''} × ` +
        `${Number(BOOKING_PARAMS.price).toLocaleString('en-RW')} ${BOOKING_PARAMS.currency}`
    );
    setEl('nightsAmount', fmt_money(BOOKING_PARAMS.total, BOOKING_PARAMS.currency));
    setEl('totalAmount',  fmt_money(BOOKING_PARAMS.total, BOOKING_PARAMS.currency));
}

async function loadThumb() {
    if (!_supabase || !BOOKING_PARAMS.listing_id) return;
    const { data } = await _supabase
        .from('listing_images')
        .select('image_url')
        .eq('listing_id', BOOKING_PARAMS.listing_id)
        .limit(1)
        .maybeSingle();
    if (data?.image_url) {
        const img = document.getElementById('listingThumb');
        if (img) { img.src = data.image_url; img.style.display = 'block'; }
    }
}

/* Pre-fill guest info from profile */
async function loadGuestInfo() {
    if (!_supabase || !CURRENT_USER) return;
    const { data: profile } = await _supabase
        .from('profiles')
        .select('full_name, email, phone')
        .eq('id', CURRENT_USER.id)
        .single();
    if (!profile) return;

    const nameEl  = document.getElementById('guestName');
    const emailEl = document.getElementById('guestEmail');
    const phoneEl = document.getElementById('guestPhone');

    if (nameEl  && !nameEl.value)  nameEl.value  = profile.full_name || '';
    if (emailEl && !emailEl.value) emailEl.value = profile.email     || CURRENT_USER.email || '';
    if (phoneEl && !phoneEl.value) phoneEl.value = profile.phone     || '';
}

/* ── Confirm booking ── */
window.confirmBooking = async function () {
    const btn = document.getElementById('confirmBtn');
    if (!btn || btn.disabled) return;

    const guestName  = (document.getElementById('guestName')?.value  || '').trim();
    const guestEmail = (document.getElementById('guestEmail')?.value || '').trim();
    const guestPhone = (document.getElementById('guestPhone')?.value || '').trim();
    const notes      = (document.getElementById('guestNotes')?.value || '').trim();

    if (!guestName)  { showErr('Please enter your full name.');  return; }
    if (!guestEmail) { showErr('Please enter your email address.'); return; }
    if (!CURRENT_USER) { showErr('You must be logged in to book.'); return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending request...';
    clearErr();

    try {
        const res = await fetch(CONFIG.FUNCTIONS_BASE + '/store-booking', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Bearer ' + (await _supabase.auth.getSession()).data.session?.access_token,
                'apikey':        CONFIG.SUPABASE_KEY,
            },
            body: JSON.stringify({
                listing_id:   BOOKING_PARAMS.listing_id,
                start_date:   BOOKING_PARAMS.start_date,
                end_date:     BOOKING_PARAMS.end_date,
                nights:       BOOKING_PARAMS.nights,
                total_amount: BOOKING_PARAMS.total,
                currency:     BOOKING_PARAMS.currency,
                guest_name:   guestName,
                guest_email:  guestEmail,
                guest_phone:  guestPhone || null,
                user_id:      CURRENT_USER.id,
                notes:        notes || null,
            }),
        });

        const data = await res.json();

        if (!res.ok || data.error) {
            // Pretty errors
            if (data.code === 'SELF_BOOKING') {
                showErr('You cannot book your own listing.');
            } else if (data.code === 'DUPLICATE_BOOKING') {
                showErr('You already have an active booking for this property. Check your dashboard.');
            } else {
                showErr(data.error || 'Booking failed. Please try again.');
            }
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Booking Request';
            return;
        }

        console.log('✅ [CHECKOUT] Booking created:', data.booking_id, 'Ref:', data.reference);
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Request Sent!';
        setTimeout(() => showSuccessScreen(data), 1000);

    } catch(err) {
        console.error('❌ [CHECKOUT]', err);
        showErr('Something went wrong. Please check your connection and try again.');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Booking Request';
    }
};

/* ── Success screen ── */
function showSuccessScreen(data) {
    const body = document.querySelector('.page-body') || document.querySelector('main') || document.body;
    const fmt = d => d
        ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' })
        : '—';

    body.innerHTML = `
    <div style="max-width:560px;margin:0 auto;text-align:center;padding:48px 20px">
      <div style="width:88px;height:88px;border-radius:50%;background:#dcfce7;display:flex;align-items:center;justify-content:center;margin:0 auto 24px">
        <i class="fa-solid fa-paper-plane" style="font-size:40px;color:#16a34a"></i>
      </div>
      <h2 style="font-size:26px;font-weight:800;color:#1a1a1a;margin:0 0 10px">Request Sent! 🎉</h2>
      <p style="color:#666;font-size:15px;line-height:1.7;margin:0 0 28px;max-width:420px;margin-left:auto;margin-right:auto">
        Your booking request for <strong>${escHtml(BOOKING_PARAMS.title)}</strong> is now with the host.
        You'll get an email as soon as they respond — usually within a few hours.
      </p>

      <div style="background:#fff;border-radius:18px;box-shadow:0 4px 20px rgba(0,0,0,.08);padding:24px;text-align:left;margin-bottom:28px">
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:9px 0;border-bottom:1px solid #f5f5f5">
          <span style="color:#999">Booking Ref</span>
          <span style="font-weight:700;font-family:monospace;color:#1a56db">${data.reference || '—'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:9px 0;border-bottom:1px solid #f5f5f5">
          <span style="color:#999">Check-in</span>
          <span style="font-weight:600">${fmt(BOOKING_PARAMS.start_date)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:9px 0;border-bottom:1px solid #f5f5f5">
          <span style="color:#999">Check-out</span>
          <span style="font-weight:600">${fmt(BOOKING_PARAMS.end_date)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:15px;padding:12px 0 0;font-weight:800">
          <span>Total</span>
          <span style="color:#EB6753">${fmt_money(BOOKING_PARAMS.total, BOOKING_PARAMS.currency)}</span>
        </div>
      </div>

      <div style="background:#fefce8;border:1.5px solid #fde047;border-radius:12px;padding:14px 18px;text-align:left;font-size:13px;color:#713f12;margin-bottom:24px;line-height:1.7">
        <strong>What happens next?</strong><br>
        1. The host reviews your request<br>
        2. You'll get an email to confirm your stay<br>
        3. Once confirmed, your booking is locked in
      </div>

      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <a href="/Dashboard" style="background:#EB6753;color:#fff;padding:14px 26px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">
          <i class="fa-solid fa-gauge"></i> View Bookings
        </a>
        <a href="/" style="background:#f5f5f5;color:#333;padding:14px 26px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">
          <i class="fa-solid fa-house"></i> Home
        </a>
      </div>
    </div>`;
}

/* ── Helpers ── */
function setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function fmt_money(n, cur = 'RWF') { return Number(n).toLocaleString('en-RW') + ' ' + cur; }
function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showErr(msg) {
    const el = document.getElementById('checkoutError') || document.getElementById('statusMsg');
    if (!el) return;
    el.style.display = 'block';
    el.style.color   = '#e74c3c';
    el.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="margin-right:6px"></i>' + escHtml(msg);
}
function clearErr() {
    const el = document.getElementById('checkoutError') || document.getElementById('statusMsg');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
}
function disableBtn() {
    const btn = document.getElementById('confirmBtn');
    if (btn) btn.disabled = true;
}

console.log('✅ [CHECKOUT] checkout.js ready');