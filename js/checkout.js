/**
 * CHECKOUT PAGE - checkout.js
 * Place at: /js/checkout.js
 *
 * Reads booking info from URL params (set by detail.js goToCheckout()),
 * lets user pick payment method, then inserts booking into Supabase.
 */

console.log('💳 [CHECKOUT] Loading checkout.js...');

let _supabase = null;
let CURRENT_USER = null;
let BOOKING_PARAMS = {};
let SELECTED_METHOD = 'mobile_money';

const METHOD_NOTES = {
    mobile_money: '📱 You\'ll receive a Mobile Money prompt after confirming.',
    card: '💳 Enter your card details securely on the next screen.',
    bank_transfer: '🏦 Bank transfer details will be sent to your email.',
    cash: '💵 Pay in cash upon arrival. Booking is still confirmed instantly.'
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log('💳 [CHECKOUT] DOM ready');
    _supabase = window.supabaseClient;
    if (!_supabase) { console.error('❌ [CHECKOUT] No Supabase client'); return; }

    // Auth check — must be logged in
    const { data: { user } } = await _supabase.auth.getUser();
    CURRENT_USER = user;

    if (!CURRENT_USER) {
        console.warn('⚠️ [CHECKOUT] Not logged in — redirecting to auth');
        window.location.href = '/Auth?redirect=' + encodeURIComponent(window.location.href);
        return;
    }
    console.log('✅ [CHECKOUT] Logged in:', CURRENT_USER.email);

    // Update nav
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) authBtn.outerHTML = `<a href="/Profile" class="icon-link"><i class="fa-solid fa-circle-user" style="font-size:22px;color:#EB6753;"></i></a>`;

    // Read URL params
    const p = new URLSearchParams(window.location.search);
    BOOKING_PARAMS = {
        listing_id: p.get('listing_id'),
        title:      p.get('title') || 'Listing',
        start_date: p.get('start_date'),
        end_date:   p.get('end_date'),
        nights:     parseInt(p.get('nights')) || 1,
        price:      parseInt(p.get('price')) || 0,
        currency:   p.get('currency') || 'RWF',
        total:      parseInt(p.get('total')) || 0,
        category:   p.get('category') || 'property'  // 'vehicle' or 'property'
    };

    console.log('📋 [CHECKOUT] Booking params:', BOOKING_PARAMS);

    if (!BOOKING_PARAMS.listing_id || !BOOKING_PARAMS.start_date) {
        showStatus('Missing booking information. Please go back and select dates.', 'error');
        document.getElementById('confirmBtn').disabled = true;
        return;
    }

    // Render summary
    renderSummary();

    // Fetch listing thumbnail
    loadListingThumb();
});

/* ─────────────────────────────
   RENDER SUMMARY
   ───────────────────────────── */
function renderSummary() {
    const fmt = (d) => {
        if (!d) return '—';
        return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    };

    setEl('listingTitle', BOOKING_PARAMS.title);
    setEl('listingId', 'ID: ' + BOOKING_PARAMS.listing_id);
    setEl('checkInDate', fmt(BOOKING_PARAMS.start_date));
    setEl('checkOutDate', fmt(BOOKING_PARAMS.end_date));

    const isVeh = BOOKING_PARAMS.category === 'vehicle';
    const unit = isVeh ? 'day' : 'night';
    setEl('nightsLabel', `${BOOKING_PARAMS.nights} ${unit}${BOOKING_PARAMS.nights !== 1 ? 's' : ''} × ${Number(BOOKING_PARAMS.price).toLocaleString('en-RW')} ${BOOKING_PARAMS.currency}`);
    setEl('nightsAmount', `${Number(BOOKING_PARAMS.total).toLocaleString('en-RW')} ${BOOKING_PARAMS.currency}`);
    setEl('totalAmount', `${Number(BOOKING_PARAMS.total).toLocaleString('en-RW')} ${BOOKING_PARAMS.currency}`);

    console.log('✅ [CHECKOUT] Summary rendered');
}

async function loadListingThumb() {
    const { data } = await _supabase
        .from('listing_images')
        .select('image_url')
        .eq('listing_id', BOOKING_PARAMS.listing_id)
        .limit(1)
        .maybeSingle();

    if (data?.image_url) {
        const img = document.getElementById('listingThumb');
        if (img) { img.src = data.image_url; img.style.display = 'block'; }
        console.log('🖼️ [CHECKOUT] Thumbnail loaded');
    }
}

/* ─────────────────────────────
   PAYMENT METHOD SELECTION
   ───────────────────────────── */
window.selectMethod = function(el, method) {
    document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected');
    SELECTED_METHOD = method;
    const note = document.getElementById('methodNote');
    if (note) note.textContent = METHOD_NOTES[method] || '';
    console.log('💳 [CHECKOUT] Payment method selected:', method);
};

/* ─────────────────────────────
   CONFIRM BOOKING
   ───────────────────────────── */
window.confirmBooking = async function() {
    const btn = document.getElementById('confirmBtn');
    if (!btn || btn.disabled) return;

    console.log('📤 [CHECKOUT] Confirming booking...', BOOKING_PARAMS);
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Confirming...';
    showStatus('Processing your booking...', 'info');

    // Insert booking into Supabase
    const { data: booking, error } = await _supabase
        .from('bookings')
        .insert({
            listing_id:     BOOKING_PARAMS.listing_id,
            user_id:        CURRENT_USER.id,
            start_date:     BOOKING_PARAMS.start_date,
            end_date:       BOOKING_PARAMS.end_date,
            total_amount:   BOOKING_PARAMS.total,
            status:         'pending',
            payment_method: SELECTED_METHOD,
            payment_status: 'unpaid'
        })
        .select()
        .single();

    if (error) {
        console.error('❌ [CHECKOUT] Booking failed:', error.message);
        showStatus('Booking failed: ' + error.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-lock"></i> Confirm Booking';
        return;
    }

    console.log('✅ [CHECKOUT] Booking created! ID:', booking.id);
    showStatus('✅ Booking confirmed! The owner will review your request.', 'success');
    btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Booked!';

    // Show success screen
    setTimeout(() => showSuccessScreen(booking), 1200);
};

function showSuccessScreen(booking) {
    const body = document.querySelector('.page-body');
    if (!body) return;

    const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const isVeh = BOOKING_PARAMS.category === 'vehicle';
    const unit = isVeh ? 'day' : 'night';

    body.innerHTML = `
        <div style="max-width:560px;margin:0 auto;text-align:center;padding:40px 20px;">
            <div style="width:80px;height:80px;border-radius:50%;background:#d4f5e4;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;">
                <i class="fa-solid fa-circle-check" style="font-size:40px;color:#2ecc71;"></i>
            </div>
            <h2 style="font-size:26px;font-weight:800;color:#1a1a1a;margin:0 0 10px;">Booking Requested! 🎉</h2>
            <p style="color:#666;font-size:15px;line-height:1.6;margin:0 0 28px;">
                Your booking for <strong>${escHtml(BOOKING_PARAMS.title)}</strong> is now pending owner approval.
                You'll be notified once confirmed.
            </p>

            <div style="background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);padding:24px;text-align:left;margin-bottom:28px;">
                <div style="display:flex;justify-content:space-between;font-size:14px;padding:8px 0;border-bottom:1px solid #f5f5f5;">
                    <span style="color:#888;">Booking ID</span>
                    <span style="font-weight:600;font-size:12px;color:#555;">${booking.id}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:14px;padding:8px 0;border-bottom:1px solid #f5f5f5;">
                    <span style="color:#888;">Check-in</span>
                    <span style="font-weight:600;">${fmt(BOOKING_PARAMS.start_date)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:14px;padding:8px 0;border-bottom:1px solid #f5f5f5;">
                    <span style="color:#888;">Check-out</span>
                    <span style="font-weight:600;">${fmt(BOOKING_PARAMS.end_date)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:14px;padding:8px 0;border-bottom:1px solid #f5f5f5;">
                    <span style="color:#888;">Payment</span>
                    <span style="font-weight:600;text-transform:capitalize;">${SELECTED_METHOD.replace('_', ' ')}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:16px;padding:12px 0 0;font-weight:700;">
                    <span>Total</span>
                    <span style="color:#EB6753;">${Number(BOOKING_PARAMS.total).toLocaleString('en-RW')} ${BOOKING_PARAMS.currency}</span>
                </div>
            </div>

            <div style="display:flex;gap:12px;justify-content:center;">
                <a href="/Dashboard/" style="background:#EB6753;color:#fff;padding:14px 28px;border-radius:12px;
                    text-decoration:none;font-weight:700;font-size:15px;">
                    <i class="fa-solid fa-gauge"></i> View in Dashboard
                </a>
                <a href="/Listings/" style="background:#f5f5f5;color:#333;padding:14px 28px;border-radius:12px;
                    text-decoration:none;font-weight:700;font-size:15px;">
                    <i class="fa-solid fa-search"></i> Browse More
                </a>
            </div>
        </div>`;

    console.log('🎉 [CHECKOUT] Success screen shown');
}

/* ─────────────────────────────
   HELPERS
   ───────────────────────────── */
function setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showStatus(msg, type = 'info') {
    const el = document.getElementById('statusMsg');
    if (!el) return;
    const colors = { success: '#2ecc71', error: '#e74c3c', info: '#666' };
    el.style.color = colors[type] || colors.info;
    el.textContent = msg;
}

console.log('✅ [CHECKOUT] checkout.js ready');