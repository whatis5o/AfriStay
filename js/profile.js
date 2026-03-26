/**
 * profile.js  →  /js/profile.js
 *
 * Handles the user profile page:
 *   - Auth guard (redirect to /Auth if not logged in)
 *   - Load profile from `profiles` table
 *   - Overview tab: stats + recent bookings
 *   - My Bookings tab: pending + approved
 *   - History tab: completed + rejected + cancelled
 *   - Favorites tab: uses generateListingCard from script.js
 *   - Edit Profile: update full_name, phone, bio, email
 *   - Change Password: Supabase auth.updateUser
 *   - Logout
 *   - Delete account
 */

const STORAGE_BASE = 'https://xuxzeinufjpplxkerlsd.supabase.co/storage/v1/object/public/listing_images';

let _sb      = null;
let _user    = null;
let _profile = null;

/* ══════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
    _sb = window.supabaseClient;
    if (!_sb) { console.error('❌ [PROFILE] No Supabase client'); return; }

    // ── Auth guard ──
    const { data: { user } } = await _sb.auth.getUser();
    if (!user) {
        window.location.href = '/Auth?next=/Profile';
        return;
    }
    _user = user;
    console.log('✅ [PROFILE] Logged in as', user.email);

    // ── Load profile ──
    const { data: prof } = await _sb
        .from('profiles')
        .select('id, full_name, email, role, avatar_seed, phone, bio')
        .eq('id', user.id)
        .single();

    _profile = prof || { id: user.id, email: user.email, full_name: '', role: 'user', phone: '', bio: '' };

    updateSidebar();
    prefillProfileForm();
    await loadOverview();

    // Auto-switch tab if ?tab= param is in URL
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    if (urlTab && TAB_LOADERS[urlTab]) {
        switchTab(urlTab);
    }
});

/* ══════════════════════════════════════════════
   SIDEBAR
   ══════════════════════════════════════════════ */
function updateSidebar() {
    const initials = (_profile.full_name || _profile.email || '?')
        .split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    const av = document.getElementById('sidebarAvatar');
    const nm = document.getElementById('sidebarName');
    const em = document.getElementById('sidebarEmail');

    if (av) av.textContent = initials;
    if (nm) nm.textContent = _profile.full_name || 'No name set';
    if (em) em.textContent = _profile.email || _user.email;
}

/* ══════════════════════════════════════════════
   TAB SWITCHING
   ══════════════════════════════════════════════ */
const TAB_LOADERS = {
    overview:  loadOverview,
    bookings:  loadActiveBookings,
    history:   loadHistory,
    favorites: loadFavorites,
};

let loadedTabs = new Set(['overview']);

window.switchTab = function(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

    const panel = document.getElementById('tab-' + name);
    if (panel) panel.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(btn => {
        if (btn.getAttribute('onclick') === `switchTab('${name}')`) btn.classList.add('active');
    });

    // Load data the first time tab is opened
    if (!loadedTabs.has(name) && TAB_LOADERS[name]) {
        loadedTabs.add(name);
        TAB_LOADERS[name]();
    }
};

/* ══════════════════════════════════════════════
   OVERVIEW
   ══════════════════════════════════════════════ */
async function loadOverview() {
    // Stats
    const [
        { count: activeCnt },
        { count: histCnt },
        { count: favCnt }
    ] = await Promise.all([
        _sb.from('bookings').select('id', { count: 'exact', head: true })
            .eq('user_id', _user.id).in('status', ['pending', 'approved', 'confirmed']),
        _sb.from('bookings').select('id', { count: 'exact', head: true })
            .eq('user_id', _user.id).in('status', ['completed', 'rejected', 'cancelled']),
        _sb.from('favorites').select('id', { count: 'exact', head: true })
            .eq('user_id', _user.id),
    ]);

    setText('statActive',    activeCnt  ?? 0);
    setText('statCompleted', histCnt    ?? 0);
    setText('statFavs',      favCnt     ?? 0);

    // Update sidebar badge
    const badge = document.getElementById('bookingsBadge');
    if (badge && activeCnt) {
        badge.textContent = activeCnt;
        badge.style.display = 'flex';
    }

    // Recent bookings (last 3)
    const { data: recent } = await _sb
        .from('bookings')
        .select('id, listing_id, start_date, end_date, total_amount, status, payment_method, created_at')
        .eq('user_id', _user.id)
        .order('created_at', { ascending: false })
        .limit(3);

    const container = document.getElementById('recentBookingsList');
    if (!container) return;

    if (!recent || !recent.length) {
        container.innerHTML = emptyState('fa-calendar-xmark', 'No bookings yet', 'Start browsing listings to make your first booking.', '/Listings/', 'Browse Listings');
        return;
    }

    await renderBookingCards(container, recent);
}

/* ══════════════════════════════════════════════
   ACTIVE BOOKINGS
   ══════════════════════════════════════════════ */
async function loadActiveBookings() {
    const container = document.getElementById('activeBookingsList');
    skeletonCards(container, 3);

    const { data, error } = await _sb
        .from('bookings')
        .select('id, listing_id, start_date, end_date, total_amount, status, payment_method, created_at')
        .eq('user_id', _user.id)
        .in('status', ['pending', 'approved', 'confirmed'])
        .order('created_at', { ascending: false });

    if (error || !data || !data.length) {
        container.innerHTML = emptyState('fa-calendar-check', 'No active bookings', 'Your pending and approved bookings will appear here.', '/Listings/', 'Browse Listings');
        return;
    }

    await renderBookingCards(container, data, true);
}

/* ══════════════════════════════════════════════
   HISTORY
   ══════════════════════════════════════════════ */
async function loadHistory() {
    const container = document.getElementById('historyList');
    skeletonCards(container, 2);

    const { data, error } = await _sb
        .from('bookings')
        .select('id, listing_id, start_date, end_date, total_amount, status, payment_method, created_at')
        .eq('user_id', _user.id)
        .in('status', ['completed', 'rejected', 'cancelled'])
        .order('created_at', { ascending: false });

    if (error || !data || !data.length) {
        container.innerHTML = emptyState('fa-clock-rotate-left', 'No history yet', 'Completed and past bookings will appear here.', null, null);
        return;
    }

    await renderBookingCards(container, data, true);
}

/* ══════════════════════════════════════════════
   BOOKING CARD RENDERER (shared)
   ══════════════════════════════════════════════ */
async function renderBookingCards(container, bookings, showReceipt = false) {
    // Batch-fetch listing titles
    const listingIds = [...new Set(bookings.map(b => b.listing_id))];
    const { data: listings } = await _sb
        .from('listings')
        .select('id, title, price, currency, province_id, district_id, category_slug')
        .in('id', listingIds);

    const listingMap = {};
    (listings || []).forEach(l => listingMap[l.id] = l);

    // Batch-fetch images (table + storage fallback)
    const imgMap = await resolveImages(listingIds);

    // Location names
    const pvIds = [...new Set((listings||[]).map(l => l.province_id).filter(Boolean))];
    const dtIds = [...new Set((listings||[]).map(l => l.district_id).filter(Boolean))];
    const pvMap = {}, dtMap = {};
    if (pvIds.length) { const { data: ps } = await _sb.from('provinces').select('id,name').in('id', pvIds); (ps||[]).forEach(p => pvMap[p.id] = p.name); }
    if (dtIds.length) { const { data: ds } = await _sb.from('districts').select('id,name').in('id', dtIds); (ds||[]).forEach(d => dtMap[d.id] = d.name); }

    container.innerHTML = '';

    bookings.forEach(b => {
        const l       = listingMap[b.listing_id] || {};
        const thumb   = imgMap[b.listing_id] || null;
        const loc     = [dtMap[l.district_id], pvMap[l.province_id]].filter(Boolean).join(', ') || 'Rwanda';
        const nights  = Math.max(1, Math.ceil((new Date(b.end_date) - new Date(b.start_date)) / 86400000));
        const isVeh   = l.category_slug === 'vehicle';
        const unit    = isVeh ? 'day' : 'night';
        const fmt     = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const payLbl  = (b.payment_method || '').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
        const priceFmt= Number(b.total_amount).toLocaleString('en-RW');
        const currency= l.currency || 'RWF';

        const imgHtml = thumb
            ? `<img class="booking-thumb" src="${esc(thumb)}" alt="${esc(l.title)}" onerror="this.parentNode.innerHTML='<div class=booking-thumb-placeholder><i class=fa-solid\\ fa-image style=color:#ddd;font-size:24px></i></div>'">`
            : `<div class="booking-thumb-placeholder"><i class="fa-solid fa-image" style="color:#ddd;font-size:24px;"></i></div>`;

        const receiptBtnHtml = (showReceipt && ['approved','confirmed','completed'].includes(b.status))
            ? `<button class="receipt-btn" onclick="event.stopPropagation();downloadReceipt('${b.id}')"><i class="fa-solid fa-download"></i> Receipt</button>`
            : '';

        const canCancel = b.status === 'pending' || b.status === 'approved' || b.status === 'confirmed';
        const cancelBtnHtml = canCancel
            ? `<button class="cancel-booking-btn" onclick="event.stopPropagation();cancelBooking('${b.id}',this)"><i class="fa-solid fa-xmark"></i> Cancel</button>`
            : '';

        const viewBtnHtml = `<a class="booking-view-btn" href="/Detail/?id=${b.listing_id}" onclick="event.stopPropagation()"><i class="fa-solid fa-arrow-up-right-from-square"></i> View</a>`;

        // Use div (not <a>) so button clicks don't accidentally navigate
        const card = document.createElement('div');
        card.className = 'booking-card';
        card.id = 'booking-card-' + b.id;
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => window.location.href = `/Detail/?id=${b.listing_id}`);
        card.innerHTML = `
            ${imgHtml}
            <div class="booking-info">
                <div class="booking-title">${esc(l.title || '—')}</div>
                <div class="booking-meta">
                    <span><i class="fa-solid fa-location-dot"></i>${esc(loc)}</span>
                    <span><i class="fa-solid fa-calendar"></i>${fmt(b.start_date)} → ${fmt(b.end_date)}</span>
                    <span><i class="fa-solid fa-moon"></i>${nights} ${unit}${nights > 1 ? 's' : ''}</span>
                    ${payLbl ? `<span><i class="fa-solid fa-credit-card"></i>${esc(payLbl)}</span>` : ''}
                </div>
                <div class="booking-footer">
                    <div class="booking-price">${priceFmt} <span>${currency}</span></div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        ${viewBtnHtml}
                        ${receiptBtnHtml}
                        ${cancelBtnHtml}
                        <span class="status-pill status-${b.status}" id="pill-${b.id}">${b.status}</span>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

/* ══════════════════════════════════════════════
   FAVORITES
   ══════════════════════════════════════════════ */
async function loadFavorites() {
    const grid = document.getElementById('profileFavGrid');
    if (!grid) return;

    const { data: favRows } = await _sb
        .from('favorites')
        .select('id, listing_id, created_at')
        .eq('user_id', _user.id)
        .order('created_at', { ascending: false })
        .limit(12);

    if (!favRows || !favRows.length) {
        grid.innerHTML = emptyState('fa-heart', 'No favorites yet', "Listings you save will appear here.", '/Listings/', 'Browse Listings');
        return;
    }

    const ids = favRows.map(f => f.listing_id);

    const { data: listings } = await _sb
        .from('listings')
        .select('id, title, price, currency, availability_status, category_slug, province_id, district_id')
        .in('id', ids);

    const imgMap  = await resolveImages(ids);

    const pvIds = [...new Set((listings||[]).map(l => l.province_id).filter(Boolean))];
    const dtIds = [...new Set((listings||[]).map(l => l.district_id).filter(Boolean))];
    const pvMap = {}, dtMap = {};
    if (pvIds.length) { const { data: ps } = await _sb.from('provinces').select('id,name').in('id', pvIds); (ps||[]).forEach(p => pvMap[p.id] = p.name); }
    if (dtIds.length) { const { data: ds } = await _sb.from('districts').select('id,name').in('id', dtIds); (ds||[]).forEach(d => dtMap[d.id] = d.name); }

    const listingMap = {};
    (listings || []).forEach(l => listingMap[l.id] = l);

    grid.innerHTML = '';
    favRows.forEach(fav => {
        const l = listingMap[fav.listing_id];
        if (!l) return;
        l.final_thumb_url = imgMap[l.id] || null;
        const locName = [dtMap[l.district_id], pvMap[l.province_id]].filter(Boolean).join(', ') || 'Rwanda';
        // Use shared generateListingCard from script.js
        grid.innerHTML += generateListingCard(l, locName);
    });
}

/* ══════════════════════════════════════════════
   EDIT PROFILE
   ══════════════════════════════════════════════ */
function prefillProfileForm() {
    setVal('pfFullName', _profile.full_name || '');
    setVal('pfEmail',    _profile.email     || _user.email || '');
    setVal('pfPhone',    _profile.phone     || '');
    setVal('pfBio',      _profile.bio       || '');
}

window.saveProfile = async function() {
    const btn = document.getElementById('saveProfileBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';

    const full_name = document.getElementById('pfFullName').value.trim();
    const phone     = document.getElementById('pfPhone').value.trim();
    const bio       = document.getElementById('pfBio').value.trim();
    const newEmail  = document.getElementById('pfEmail').value.trim();

    try {
        // Update profiles table
        const { error: pErr } = await _sb
            .from('profiles')
            .update({ full_name, phone, bio })
            .eq('id', _user.id);
        if (pErr) throw pErr;

        // Update email in auth if changed
        if (newEmail && newEmail !== _user.email) {
            const { error: eErr } = await _sb.auth.updateUser({ email: newEmail });
            if (eErr) throw eErr;
            toast('Profile saved! Check your inbox to confirm the new email.', 'success');
        } else {
            toast('Profile updated!', 'success');
        }

        _profile.full_name = full_name;
        _profile.phone     = phone;
        _profile.bio       = bio;
        updateSidebar();

    } catch (err) {
        console.error('❌ [PROFILE] Save error:', err);
        toast('Failed to save: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
};

/* ══════════════════════════════════════════════
   CHANGE PASSWORD
   ══════════════════════════════════════════════ */
window.togglePw = function(inputId, btn) {
    const inp = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    if (inp.type === 'password') {
        inp.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
    } else {
        inp.type = 'password';
        icon.className = 'fa-solid fa-eye';
    }
};

window.checkPwStrength = function(pw) {
    const bar  = document.getElementById('pwBar');
    const hint = document.getElementById('pwHint');
    if (!bar || !hint) return;

    let score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    const levels = [
        { pct: '0%',   color: '#eee',    label: '' },
        { pct: '20%',  color: '#e74c3c', label: 'Too weak' },
        { pct: '40%',  color: '#e67e22', label: 'Weak' },
        { pct: '65%',  color: '#f1c40f', label: 'Fair' },
        { pct: '85%',  color: '#2ecc71', label: 'Strong' },
        { pct: '100%', color: '#27ae60', label: 'Very strong' },
    ];
    const lv = levels[Math.min(score, 5)];
    bar.style.width     = lv.pct;
    bar.style.background = lv.color;
    hint.textContent    = lv.label || 'At least 8 characters';
    hint.style.color    = lv.color === '#eee' ? '#aaa' : lv.color;
};

window.changePassword = async function() {
    const newPw  = document.getElementById('pwNew').value;
    const confPw = document.getElementById('pwConfirm').value;
    const btn    = document.getElementById('changePwBtn');

    if (!newPw || newPw.length < 8) { toast('Password must be at least 8 characters.', 'warning'); return; }
    if (newPw !== confPw)           { toast("Passwords don't match.", 'warning'); return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Updating...';

    const { error } = await _sb.auth.updateUser({ password: newPw });

    if (error) {
        toast('Failed: ' + error.message, 'error');
    } else {
        toast('Password updated successfully!', 'success');
        document.getElementById('pwNew').value    = '';
        document.getElementById('pwConfirm').value = '';
        document.getElementById('pwBar').style.width = '0%';
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-lock"></i> Update Password';
};

/* ══════════════════════════════════════════════
   LOGOUT
   ══════════════════════════════════════════════ */
window.handleLogout = async function() {
    if (!confirm('Are you sure you want to log out?')) return;
    await _sb.auth.signOut();
    localStorage.removeItem('afriStay_role');
    localStorage.removeItem('afriStay_firstName');
    toast('Logged out. See you soon! 👋', 'success');
    setTimeout(() => window.location.href = '/', 1500);
};

/* ══════════════════════════════════════════════
   DELETE ACCOUNT
   ══════════════════════════════════════════════ */
window.deleteAccount = async function() {
    const confirmed = prompt('This will permanently delete your account. Type DELETE to confirm:');
    if (confirmed !== 'DELETE') { toast('Cancelled.', 'info'); return; }

    toast('Deleting account...', 'info');
    try {
        // Delete profile row (cascade should handle the rest via FK)
        await _sb.from('profiles').delete().eq('id', _user.id);
        await _sb.auth.signOut();
        toast('Account deleted.', 'success');
        setTimeout(() => window.location.href = '/', 1800);
    } catch (err) {
        toast('Failed to delete: ' + err.message, 'error');
    }
};

/* ══════════════════════════════════════════════
   DOWNLOAD RECEIPT (PDF via jsPDF)
   ══════════════════════════════════════════════ */
/* ══════════════════════════════════════════════
   DOWNLOAD RECEIPT (PDF via jsPDF) + ANTI-SPAM
   ══════════════════════════════════════════════ */
window.downloadReceipt = async function(bookingId) {
    toast('Authenticating receipt...', 'info');
    try {
        // 1. Fetch booking data
        const { data: b } = await _sb.from('bookings').select('*').eq('id', bookingId).single();
        if (!b) throw new Error("Booking not found");

        // 2. Anti-Spam & Traffic Control via `digital_receipts` table
        let { data: receipt } = await _sb.from('digital_receipts').select('*').eq('booking_id', bookingId).maybeSingle();
        const receiptNo = receipt ? receipt.receipt_no : 'RCP-' + b.id.substring(0, 8).toUpperCase();

        if (!receipt) {
            // First time downloading: Create the record
            const { data: newReceipt, error: insErr } = await _sb.from('digital_receipts').insert({
                booking_id: b.id,
                user_id: b.user_id,
                receipt_no: receiptNo,
                download_count: 1
            }).select().single();
            if (!insErr) receipt = newReceipt;
        } else {
            // Enforcement: Max 5 downloads per receipt to prevent trafficking/bot abuse
            if (receipt.download_count >= 5) {
                toast('Download limit reached to prevent abuse. Please contact support.', 'error');
                return;
            }
            // Increment the counter
            await _sb.from('digital_receipts').update({ download_count: receipt.download_count + 1 }).eq('id', receipt.id);
        }

        toast('Generating PDF...', 'info');

        // 3. Fetch Listing & Owner details for the PDF
        const { data: l } = await _sb.from('listings').select('title, price, currency, address, province_id, district_id, owner_id, category_slug').eq('id', b.listing_id).single();
        const { data: owner } = await _sb.from('profiles').select('full_name, email, phone').eq('id', l?.owner_id).single();

        let loc = l?.address || 'Rwanda';
        if (l?.district_id || l?.province_id) {
            const [{ data: dist }, { data: prov }] = await Promise.all([
                l?.district_id ? _sb.from('districts').select('name').eq('id', l.district_id).single() : { data: null },
                l?.province_id ? _sb.from('provinces').select('name').eq('id', l.province_id).single() : { data: null },
            ]);
            loc = [dist?.name, prov?.name].filter(Boolean).join(', ') || loc;
        }

        const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const nights   = Math.max(1, Math.ceil((new Date(b.end_date) - new Date(b.start_date)) / 86400000));
        const currency = l?.currency || 'RWF';
        const totalFmt = Number(b.total_amount).toLocaleString('en-RW') + ' ' + currency;
        const pricePN  = Number(l?.price || 0).toLocaleString('en-RW');
        const payMethod= (b.payment_method || '').replace('_',' ').replace(/\b\w/g, c => c.toUpperCase());
        const issued   = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        // Load jsPDF on demand
        if (!window.jspdf) {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const W = 210, M = 20; let y = 0;

        // Header
        doc.setFillColor(26, 26, 46); doc.rect(0, 0, W, 44, 'F');
        doc.setTextColor(235, 103, 83); doc.setFontSize(26); doc.setFont('helvetica', 'bold');
        doc.text('AfriStay', W/2, 18, { align: 'center' });
        doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
        doc.text('Digital Booking Receipt', W/2, 30, { align: 'center' });
        y = 58;

        // Receipt number
        doc.setFillColor(248, 249, 250); doc.roundedRect(M, y-6, W-M*2, 16, 3, 3, 'F');
        doc.setTextColor(80,80,80); doc.setFontSize(9); doc.text('RECEIPT NO', M+6, y+3);
        doc.setTextColor(30,30,30); doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.text(receiptNo, M+6, y+8);
        doc.setTextColor(80,80,80); doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.text('ISSUED', W-M-6, y+3, { align: 'right' });
        doc.setTextColor(30,30,30); doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.text(issued, W-M-6, y+8, { align: 'right' });
        y += 26;

        const secHead = title => {
            doc.setFillColor(235, 103, 83); doc.rect(M, y, 3, 6, 'F');
            doc.setTextColor(30,30,30); doc.setFontSize(10); doc.setFont('helvetica','bold');
            doc.text(title, M+7, y+5); y += 12;
        };
        const row = (label, value, highlight = false) => {
            doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(140,140,140); doc.text(label, M, y);
            doc.setTextColor(highlight ? 235 : 30, highlight ? 103 : 30, highlight ? 83 : 30);
            doc.setFont('helvetica', highlight ? 'bold' : 'normal'); doc.setFontSize(highlight ? 12 : 10);
            doc.text(value, W-M, y, { align: 'right' }); y += 8;
            doc.setDrawColor(240,240,240); doc.line(M, y-1, W-M, y-1); y += 2;
        };

        const isVeh = l?.category_slug === 'vehicle';
        const unit = isVeh ? 'day' : 'night';
        const rateLabel = isVeh ? 'Rate per Day' : 'Rate per Night';

        secHead(isVeh ? 'VEHICLE' : 'PROPERTY');
        doc.setTextColor(20,20,20); doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.text(l?.title || '—', M, y); y += 7;
        doc.setTextColor(100,100,100); doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.text('📍 ' + loc, M, y); y += 14;

        secHead('BOOKING DETAILS');
        row(isVeh ? 'Pick-up Date' : 'Check-in',   fmt(b.start_date));
        row(isVeh ? 'Return Date'  : 'Check-out',  fmt(b.end_date));
        row('Duration',  nights + ' ' + unit + (nights !== 1 ? 's' : ''));
        row('Status',    '✓ Paid & Confirmed');
        y += 4;

        secHead('PAYMENT');
        row(rateLabel, pricePN + ' ' + currency);
        row('Payment Method', payMethod);
        y += 2;

        // Total
        doc.setFillColor(255, 249, 248); doc.roundedRect(M, y, W-M*2, 16, 3, 3, 'F');
        doc.setDrawColor(235, 103, 83); doc.setLineWidth(0.5); doc.roundedRect(M, y, W-M*2, 16, 3, 3, 'S');
        doc.setTextColor(30,30,30); doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.text('TOTAL', M+6, y+10);
        doc.setTextColor(235,103,83); doc.setFontSize(15); doc.text(totalFmt, W-M-6, y+10, { align: 'right' });
        y += 26;

        if (owner) {
            secHead('HOST CONTACT');
            doc.setTextColor(30,30,30); doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.text(owner.full_name || '—', M, y); y += 6;
            doc.setTextColor(100,100,100); doc.setFontSize(9); doc.setFont('helvetica','normal');
            if (owner.email) { doc.text(owner.email, M, y); y += 6; }
            if (owner.phone) { doc.text(owner.phone, M, y); y += 6; }
        }

        // Footer
        const pH = doc.internal.pageSize.height;
        doc.setFillColor(248,249,250); doc.rect(0, pH-18, W, 18, 'F');
        doc.setDrawColor(235,235,235); doc.line(0, pH-18, W, pH-18);
        doc.setTextColor(160,160,160); doc.setFontSize(8); doc.setFont('helvetica','normal');
        doc.text('© ' + new Date().getFullYear() + ' AfriStay · afristay.rw', W/2, pH-8, { align: 'center' });

        doc.save(`AfriStay-Receipt-${receiptNo}.pdf`);
        toast('📄 Receipt downloaded!', 'success');

    } catch (err) {
        console.error('❌ [RECEIPT] Error:', err);
        toast('Could not generate receipt: ' + err.message, 'error');
    }
};

/* ══════════════════════════════════════════════
   IMAGE RESOLVER  (table → storage fallback)
   ══════════════════════════════════════════════ */
async function resolveImages(ids) {
    const imgMap = {};
    const { data: rows } = await _sb.from('listing_images').select('listing_id,image_url').in('listing_id', ids);
    (rows || []).forEach(r => {
        if (!imgMap[r.listing_id] && r.image_url) imgMap[r.listing_id] = resolveUrl(r.image_url);
    });
    const missing = ids.filter(id => !imgMap[id]);
    if (missing.length) {
        await Promise.all(missing.map(async id => {
            try {
                const { data: files } = await _sb.storage.from('listing_images').list(id, { limit: 1 });
                const f = (files||[]).find(x => x.name && !x.id?.endsWith('/'));
                if (f) imgMap[id] = STORAGE_BASE + '/' + id + '/' + f.name;
            } catch(e) {}
        }));
    }
    return imgMap;
}

function resolveUrl(raw) {
    if (!raw) return null;
    if (raw.startsWith('http')) return raw;
    const clean = raw.replace(/^\//, '');
    return clean.startsWith('listing_images/') ? 'https://xuxzeinufjpplxkerlsd.supabase.co/storage/v1/object/public/' + clean : STORAGE_BASE + '/' + clean;
}

/* ══════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════ */
function emptyState(icon, title, msg, href, linkText) {
    return `<div class="empty-state">
        <i class="fa-solid ${icon}"></i>
        <h3>${title}</h3>
        <p>${msg}</p>
        ${href ? `<a href="${href}"><i class="fa-solid fa-magnifying-glass"></i> ${linkText}</a>` : ''}
    </div>`;
}

function skeletonCards(container, n) {
    if (!container) return;
    container.innerHTML = Array(n).fill(
        '<div style="border:1.5px solid #f0f0f0;border-radius:16px;padding:20px;margin-bottom:14px;display:flex;gap:16px;">' +
        '<div class="skeleton" style="width:80px;height:80px;border-radius:12px;flex-shrink:0;"></div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:10px;">' +
        '<div class="skeleton" style="height:16px;width:55%;"></div>' +
        '<div class="skeleton" style="height:12px;width:75%;"></div>' +
        '<div class="skeleton" style="height:12px;width:40%;margin-top:6px;"></div>' +
        '</div></div>'
    ).join('');
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}
function esc(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toast(msg, type = 'info') {
    const colors = { success: '#2ecc71', error: '#e74c3c', info: '#3498db', warning: '#f39c12' };
    const icons  = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
    const box = document.getElementById('toastBox');
    const t   = document.createElement('div');
    t.className = 'toast-item';
    t.style.background = colors[type] || colors.info;
    t.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${msg}`;
    box.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

/* ══════════════════════════════════════════════
   CANCEL BOOKING
   ══════════════════════════════════════════════ */
window.cancelBooking = async function(bookingId, btn) {
    if (!confirm('Are you sure you want to cancel this booking?')) return;

    // Disable button immediately
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

    const { error } = await _sb
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)
        .eq('user_id', _user.id);  // safety: only cancel own bookings

    if (error) {
        console.error('❌ [CANCEL] Error:', error.message);
        toast('Failed to cancel: ' + error.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Cancel';
        return;
    }

    // Update the pill in-place
    const pill = document.getElementById('pill-' + bookingId);
    if (pill) {
        pill.textContent = 'cancelled';
        pill.className = 'status-pill status-cancelled';
    }

    // Hide the cancel button
    btn.style.display = 'none';

    // Update stats count
    const statEl = document.getElementById('statActive');
    if (statEl) {
        const cur = parseInt(statEl.textContent) || 1;
        statEl.textContent = Math.max(0, cur - 1);
    }

    toast('Booking cancelled.', 'success');
    console.log('✅ [CANCEL] Booking cancelled:', bookingId);
};