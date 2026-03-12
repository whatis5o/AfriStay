/**
 * LISTING DETAIL PAGE — detail.js  /js/detail.js
 * Changes: full image+video slider, open reviews (no booking required), relaxed status check
 */

let _supabase = null;
let LISTING_ID = null;
let CURRENT_USER = null;
let CURRENT_LISTING = null;
let MEDIA_ITEMS = [];
let CURRENT_MEDIA_INDEX = 0;

document.addEventListener('DOMContentLoaded', async () => {
    _supabase = window.supabaseClient;
    if (!_supabase) { console.error('❌ [DETAIL] Supabase client missing'); return; }

    const params = new URLSearchParams(window.location.search);
    LISTING_ID = params.get('id');

    if (!LISTING_ID) {
        console.error('❌ [DETAIL] No ?id= in URL. Current URL:', window.location.href);
        showDetailError('No listing ID found. Please go back and try again.');
        return;
    }
    console.log('🔑 [DETAIL] Listing ID:', LISTING_ID);

    const { data: { user } } = await _supabase.auth.getUser();
    CURRENT_USER = user;
    console.log(CURRENT_USER ? `✅ [DETAIL] Logged in: ${CURRENT_USER.email}` : 'ℹ️ [DETAIL] Not logged in');

    if (CURRENT_USER) {
        document.getElementById('signInBtn')?.classList.add('hidden');
        document.getElementById('userIcon')?.classList.remove('hidden');
    }

    await Promise.all([loadListingDetails(), loadReviews()]);
    initBookingForm();
    initReviewForm();
});

async function loadListingDetails() {
    console.log('📋 [DETAIL] Fetching listing...');

    const { data: listing, error } = await _supabase
        .from('listings')
        .select(`
            id, title, description, price, currency, address,
            availability_status, status, avg_rating, reviews_count,
            category_slug, landmark_description,
            province_id, district_id, sector_id, owner_id,
            provinces ( name ),
            districts ( name ),
            sectors ( name ),
            real_estate_types ( name ),
            listing_images ( id, image_url, created_at ),
            listing_videos ( id, video_url, created_at )
        `)
        .eq('id', LISTING_ID)
        .single();

    if (error || !listing) {
        console.error('❌ [DETAIL] Not found:', error?.message);
        showDetailError('This listing could not be found.');
        return;
    }

    console.log(`📊 [DETAIL] status="${listing.status}" | availability="${listing.availability_status}"`);
    console.log(`🖼️ [DETAIL] images: ${listing.listing_images?.length || 0} | videos: ${listing.listing_videos?.length || 0}`);

    CURRENT_LISTING = listing;

    setEl('listingTitle', listing.title);
    setEl('breadTitle', listing.title);
    document.title = listing.title + ' - AfriStay';
    setEl('listingDescription', listing.description || 'No description provided.');
    setEl('listingCategory', listing.real_estate_types?.name || listing.category_slug || 'Listing');

    if (listing.landmark_description) {
        const t = document.getElementById('landmarkTitle');
        const lm = document.getElementById('listingLandmark');
        if (t) t.style.display = 'block';
        if (lm) { lm.style.display = 'block'; lm.textContent = listing.landmark_description; }
    }

    const locationParts = [listing.sectors?.name, listing.districts?.name, listing.provinces?.name].filter(Boolean);
    const locationStr = listing.address
        ? listing.address + (locationParts.length ? ' · ' + locationParts.join(', ') : '')
        : locationParts.join(', ') || 'Rwanda';
    setEl('listingLocation', locationStr);

    const currency = listing.currency || 'RWF';
    const price = Number(listing.price).toLocaleString('en-RW');
    const priceUnit = listing.category_slug === 'vehicle' ? '/ day' : '/ night';
    const priceEl = document.getElementById('listingPrice');
    if (priceEl) priceEl.innerHTML = price + ' <small>' + currency + '</small> <span style="font-size:14px;color:#bbb;font-weight:400;">' + priceUnit + '</span>';

    const isAvailable = listing.availability_status === 'available';
    const badge = document.getElementById('listingAvailability');
    if (badge) {
        badge.className = 'avail-pill ' + (listing.availability_status || 'unavailable');
        badge.innerHTML = isAvailable
            ? '<i class="fa-solid fa-circle-check"></i> Available'
            : '<i class="fa-solid fa-circle-xmark"></i> ' + (listing.availability_status === 'booked' ? 'Booked' : 'Unavailable');
    }

    renderRatingBadge(listing.avg_rating, listing.reviews_count);
    // Wire up heart/favorites for this listing
    if (typeof window.initFavorites === 'function') {
        try { const { data:{ user } } = await _supabase.auth.getUser(); await window.initFavorites(user||null); }
        catch(_) {}
    }

    // Wire up favorites/heart for this listing
    if (typeof window.initFavorites === 'function') {
        try {
            const { data: { user } } = await _supabase.auth.getUser();
            await window.initFavorites(user || null);
        } catch(_) {}
    }

    const images = (listing.listing_images || []).map(img => ({ type: 'image', src: img.image_url }));
    const videos = (listing.listing_videos || []).map(vid => ({ type: 'video', src: vid.video_url }));
    MEDIA_ITEMS = [...images, ...videos];
    console.log('📽️ [DETAIL] Total media: ' + MEDIA_ITEMS.length);

    renderMediaSlider(listing.title);

    document.getElementById('skelEl').style.display = 'none';
    document.getElementById('contentEl').style.display = 'grid';
    console.log('✅ [DETAIL] Page rendered');

    // ── Pending notice: hide booking form if not approved ──
    const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
    if (listing.status !== 'approved') {
        const bf = document.getElementById('bookingForm');
        if (bf) bf.innerHTML =
            '<div style="background:#fff8e1;border:1.5px solid #ffd047;border-radius:12px;padding:18px 20px;text-align:center;margin-top:4px;">' +
            '<i class="fa-solid fa-clock" style="font-size:28px;color:#f39c12;display:block;margin-bottom:8px;"></i>' +
            '<p style="font-weight:700;color:#856404;margin:0 0 4px;font-size:15px;">Awaiting Approval</p>' +
            '<p style="color:#6c5700;font-size:13px;margin:0;">This listing hasn\'t been approved yet and cannot be booked.</p>' +
            (isPreview ? '<p style="margin:10px 0 0;font-size:12px;color:#aaa;">Preview mode — only you can see this.</p>' : '') +
            '</div>';
    }

    // ── Fetch and render owner contact info ──
// ── Fetch and render owner contact info ──
    if (listing.owner_id) {
        _supabase
            .from('profiles')
            .select('full_name, email, phone')
            .eq('id', listing.owner_id)
            .maybeSingle() /* Changed from .single() */
            .then(({ data: owner, error }) => { 
                if (error) console.warn("Could not fetch owner:", error);
                if (owner) renderOwnerContact(owner); 
            });
    }
}

function renderOwnerContact(owner) {
    // Inject contact card before the reviews section
    const anchor = document.getElementById('reviewsSection');
    if (!anchor || document.getElementById('ownerContactCard')) return;
    const el = document.createElement('div');
    el.id = 'ownerContactCard';
    el.innerHTML =
        '<div style="background:#fff;border-radius:16px;padding:22px 24px;margin-bottom:24px;border:1px solid #f0f0f0;box-shadow:0 2px 12px rgba(0,0,0,0.05);">' +
        '<h3 style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 16px;padding-bottom:10px;border-bottom:2px solid #f5f5f5;">' +
        '<i class="fa-solid fa-user-tie" style="color:#EB6753;margin-right:8px;"></i>Contact Host</h3>' +
        '<div style="display:flex;align-items:center;gap:14px;">' +
        '<div style="width:50px;height:50px;border-radius:50%;background:#EB6753;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;flex-shrink:0;">' +
        escHtml((owner.full_name||'H').charAt(0).toUpperCase()) + '</div>' +
        '<div style="flex:1;">' +
        '<p style="font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 6px;">' + escHtml(owner.full_name||'Host') + '</p>' +
        (owner.email
            ? '<a href="mailto:' + escHtml(owner.email) + '" style="display:flex;align-items:center;gap:7px;color:#555;font-size:13px;text-decoration:none;margin-bottom:5px;transition:color 0.2s;" onmouseover="this.style.color=\'#EB6753\'" onmouseout="this.style.color=\'#555\'">' +
              '<i class="fa-solid fa-envelope" style="color:#EB6753;font-size:12px;width:14px;text-align:center;"></i>' + escHtml(owner.email) + '</a>'
            : '') +
        (owner.phone
            ? '<a href="tel:' + escHtml(owner.phone) + '" style="display:flex;align-items:center;gap:7px;color:#555;font-size:13px;text-decoration:none;transition:color 0.2s;" onmouseover="this.style.color=\'#EB6753\'" onmouseout="this.style.color=\'#555\'">' +
              '<i class="fa-solid fa-phone" style="color:#EB6753;font-size:12px;width:14px;text-align:center;"></i>' + escHtml(owner.phone) + '</a>'
            : '<p style="font-size:12px;color:#ccc;margin:0;font-style:italic;">No phone number listed</p>') +
        '</div></div></div>';
    anchor.before(el);
}

function renderMediaSlider(title) {
    const gallery = document.getElementById('listingGallery');
    if (!gallery) return;

    if (MEDIA_ITEMS.length === 0) {
        gallery.innerHTML = '<div class="gallery-main" style="background:#f0f0f0;border-radius:20px;overflow:hidden;margin-bottom:12px;"><div class="no-img" style="height:460px;display:flex;flex-direction:column;align-items:center;justify-content:center;"><i class="fa-solid fa-image" style="font-size:56px;color:#ccc;"></i><p style="color:#bbb;margin-top:12px;font-size:14px;">No media available</p></div></div>';
        return;
    }

    const hasMultiple = MEDIA_ITEMS.length > 1;
    const thumbsHtml = hasMultiple ? MEDIA_ITEMS.map((item, i) => {
        const border = i === 0 ? '#EB6753' : 'transparent';
        const opacity = i === 0 ? '1' : '0.55';
        const inner = item.type === 'image'
            ? '<img src="' + escHtml(item.src) + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">'
            : '<video src="' + escHtml(item.src) + '" style="width:100%;height:100%;object-fit:cover;" muted preload="metadata"></video><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);"><i class="fa-solid fa-play" style="color:#fff;font-size:16px;"></i></div>';
        return '<div onclick="goToMedia(' + i + ')" id="thumb_' + i + '" style="width:80px;min-width:80px;height:60px;border-radius:10px;overflow:hidden;cursor:pointer;border:2.5px solid ' + border + ';opacity:' + opacity + ';transition:all 0.18s;background:#1a1a1a;display:flex;align-items:center;justify-content:center;position:relative;flex-shrink:0;">' + inner + '</div>';
    }).join('') : '';

    gallery.innerHTML =
        '<div class="gallery-main" style="position:relative;background:#111;border-radius:20px;overflow:hidden;margin-bottom:12px;">' +
            '<div id="mediaViewer" style="width:100%;height:460px;position:relative;"></div>' +
            (hasMultiple ? '<button id="slidePrev" onclick="slideMedia(-1)" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:15px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-chevron-left"></i></button><button id="slideNext" onclick="slideMedia(1)" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:15px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-chevron-right"></i></button>' : '') +
            '<div id="mediaCounter" style="position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,0.55);color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;z-index:10;"></div>' +
            '<div id="mediaTypeBadge" style="position:absolute;bottom:12px;left:12px;background:rgba(0,0,0,0.55);color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;z-index:10;"></div>' +
        '</div>' +
        (hasMultiple ? '<div class="thumbs-row" style="display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;margin-bottom:20px;padding-bottom:4px;">' + thumbsHtml + '</div>' : '');

    renderMediaAt(0);

    let touchStartX = 0;
    const viewer = document.getElementById('mediaViewer');
    if (viewer) {
        viewer.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
        viewer.addEventListener('touchend', e => {
            const diff = touchStartX - e.changedTouches[0].screenX;
            if (Math.abs(diff) > 50) slideMedia(diff > 0 ? 1 : -1);
        });
    }
}

function renderMediaAt(index) {
    CURRENT_MEDIA_INDEX = index;
    const item = MEDIA_ITEMS[index];
    const viewer = document.getElementById('mediaViewer');
    if (!viewer || !item) return;

    viewer.querySelectorAll('video').forEach(v => v.pause());

    if (item.type === 'image') {
        viewer.innerHTML = '<img src="' + escHtml(item.src) + '" alt="Listing photo" onclick="openLb(\'' + escHtml(item.src) + '\')" style="width:100%;height:460px;object-fit:cover;cursor:zoom-in;display:block;">';
    } else {
        viewer.innerHTML = '<video src="' + escHtml(item.src) + '" controls style="width:100%;height:460px;object-fit:contain;background:#000;display:block;" preload="metadata">Your browser does not support video.</video>';
        const vid = viewer.querySelector('video');
        if (vid) vid.play().catch(() => {});
    }

    const counter = document.getElementById('mediaCounter');
    const typeBadge = document.getElementById('mediaTypeBadge');
    if (counter && MEDIA_ITEMS.length > 1) counter.textContent = (index + 1) + ' / ' + MEDIA_ITEMS.length;
    if (typeBadge) typeBadge.innerHTML = item.type === 'video' ? '<i class="fa-solid fa-video"></i> Video' : '<i class="fa-solid fa-image"></i> Photo';

    MEDIA_ITEMS.forEach((_, i) => {
        const t = document.getElementById('thumb_' + i);
        if (t) { t.style.borderColor = i === index ? '#EB6753' : 'transparent'; t.style.opacity = i === index ? '1' : '0.55'; }
    });

    console.log('📽️ [DETAIL] Media ' + (index + 1) + '/' + MEDIA_ITEMS.length + ': ' + item.type);
}

window.slideMedia = (dir) => renderMediaAt((CURRENT_MEDIA_INDEX + dir + MEDIA_ITEMS.length) % MEDIA_ITEMS.length);
window.goToMedia = (i) => renderMediaAt(i);
window.openLb = (src) => { document.getElementById('lbImg').src = src; document.getElementById('lightbox').classList.add('open'); };
window.closeLb = () => document.getElementById('lightbox').classList.remove('open');
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.closeLb();
    if (e.key === 'ArrowRight' && MEDIA_ITEMS.length > 1) window.slideMedia(1);
    if (e.key === 'ArrowLeft' && MEDIA_ITEMS.length > 1) window.slideMedia(-1);
});

function renderRatingBadge(avgRating, reviewsCount) {
    const badge = document.getElementById('listingRatingBadge');
    if (!badge) return;
    if (!avgRating || !reviewsCount) {
        badge.innerHTML = '<i class="fa-regular fa-star" style="color:#ddd;"></i> No ratings yet';
        return;
    }
    const rating = parseFloat(avgRating).toFixed(1);
    badge.innerHTML = '<i class="fa-solid fa-star" style="color:#f1c40f;"></i> ' + rating + ' (' + reviewsCount + ' review' + (reviewsCount !== 1 ? 's' : '') + ')';
}

async function loadReviews() {
    const { data: reviews, error } = await _supabase
        .from('reviews')
        .select('id, rating, comment, created_at, user_id, profiles ( full_name )')
        .eq('listing_id', LISTING_ID)
        .order('created_at', { ascending: false });

    if (error) { console.error('❌ [DETAIL] Reviews error:', error.message); return; }
    console.log('💬 [DETAIL] ' + (reviews?.length || 0) + ' reviews');
    renderReviews(reviews || []);
}

function renderReviews(reviews) {
    const list = document.getElementById('reviewsList');
    if (!list) return;
    if (reviews.length === 0) {
        list.innerHTML = '<div style="background:#fff;border:1px solid #eee;border-radius:14px;padding:32px;text-align:center;margin-bottom:20px;"><i class="fa-regular fa-comment-dots" style="font-size:36px;color:#ddd;display:block;margin-bottom:10px;"></i><p style="color:#999;font-size:15px;font-weight:500;margin:0;">No reviews yet</p><p style="color:#bbb;font-size:13px;margin:6px 0 0;">Be the first to share your experience!</p></div>';
        return;
    }
    list.innerHTML = reviews.map(r => {
        const name = r.profiles?.full_name || 'Anonymous';
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        const date = new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        const stars = Array.from({ length: 5 }, (_, i) => '<i class="fa-' + (i < r.rating ? 'solid' : 'regular') + ' fa-star" style="color:' + (i < r.rating ? '#f1c40f' : '#ddd') + ';font-size:13px;"></i>').join('');
        return '<div style="background:#fff;border:1px solid #eee;border-radius:14px;padding:20px;margin-bottom:14px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;"><div style="width:40px;height:40px;border-radius:50%;background:#EB6753;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;">' + initials + '</div><div style="flex:1;"><div style="font-weight:600;font-size:14px;color:#222;">' + escHtml(name) + '</div><div style="font-size:12px;color:#aaa;">' + date + '</div></div><div>' + stars + '</div></div>' + (r.comment ? '<p style="color:#555;font-size:14px;line-height:1.65;margin:0;">' + escHtml(r.comment) + '</p>' : '') + '</div>';
    }).join('');
}

async function initReviewForm() {
    const formSection = document.getElementById('reviewFormSection');
    if (!formSection) return;

    // Context-aware language based on listing type
    const isVeh = CURRENT_LISTING?.category_slug === 'vehicle';
    const thing    = isVeh ? 'vehicle' : 'property';
    const action   = isVeh ? 'rented this vehicle' : 'stayed at this property';
    const noun     = isVeh ? 'rental' : 'stay';

    if (!CURRENT_USER) {
        formSection.innerHTML =
            '<div style="text-align:center;padding:20px;">' +
            '<i class="fa-solid fa-star" style="font-size:26px;color:#f1c40f;margin-bottom:10px;display:block;"></i>' +
            '<p style="color:#555;font-size:14px;margin:0;">' +
            '<a href="/Auth" style="color:#EB6753;font-weight:700;text-decoration:none;">Sign in</a> ' +
            'to leave a review — guests who have ' + action + ' can share their experience.' +
            '</p></div>';
        return;
    }

    // Check if this user has a confirmed booking whose end_date has passed
    const today = new Date().toISOString().slice(0, 10);
    const { data: completedBooking } = await _supabase
        .from('bookings')
        .select('id')
        .eq('listing_id', LISTING_ID)
        .eq('user_id', CURRENT_USER.id)
        .in('status', ['confirmed', 'completed'])
        .lt('end_date', today)
        .maybeSingle();

    if (!completedBooking) {
        formSection.innerHTML =
            '<div style="background:#f9f9f9;border:1.5px solid #e8e8e8;border-radius:16px;padding:24px 20px;text-align:center;">' +
            '<div style="width:52px;height:52px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">' +
            '<i class="fa-solid fa-lock" style="font-size:20px;color:#ccc;"></i></div>' +
            '<p style="font-weight:800;color:#333;margin:0 0 8px;font-size:15px;">Review not available yet</p>' +
            '<p style="color:#aaa;font-size:13px;margin:0 0 14px;line-height:1.6;">Only guests who completed a ' + noun + ' here can review. ' +
            (isVeh ? 'Once your rental ends, come back to share your experience.' : 'Once your stay is complete, come back to share your experience.') +
            '</p>' +
            '<a href="/Listings" style="display:inline-flex;align-items:center;gap:7px;padding:9px 20px;background:#EB6753;color:#fff;border-radius:100px;font-size:13px;font-weight:700;text-decoration:none;"><i class="fa-solid fa-magnifying-glass"></i> Browse Listings</a>' +
            '</div>';
        return;
    }

    const { data: existingReview } = await _supabase.from('reviews').select('id').eq('listing_id', LISTING_ID).eq('user_id', CURRENT_USER.id).maybeSingle();
    if (existingReview) {
        formSection.innerHTML = '<p style="color:#2ecc71;font-size:14px;text-align:center;margin:0;"><i class="fa-solid fa-circle-check"></i> You\'ve already reviewed this ' + thing + '. Thank you!</p>';
        return;
    }

    const placeholder = isVeh
        ? 'How was the drive? Condition, pickup experience, anything to know...'
        : 'How was your stay? Cleanliness, location, host, anything to know...';

    formSection.innerHTML =
        '<h3 style="margin:0 0 6px;font-size:16px;color:#222;"><i class="fa-solid fa-star" style="color:#f1c40f;margin-right:6px;"></i>Leave a Review</h3>' +
        '<p style="font-size:13px;color:#aaa;margin:0 0 14px;">You\'ve ' + action + ' — share your experience!</p>' +
        '<div id="starPicker" style="display:flex;gap:8px;margin-bottom:16px;cursor:pointer;">' +
        [1,2,3,4,5].map(n => '<i class="fa-regular fa-star review-star" style="font-size:28px;color:#ddd;transition:color 0.12s;" onmouseover="hoverStars(' + n + ')" onmouseout="resetStars()" onclick="selectStar(' + n + ')"></i>').join('') +
        '</div>' +
        '<input type="hidden" id="reviewRating" value="0">' +
        '<textarea id="reviewComment" placeholder="' + placeholder + '" rows="3" style="width:100%;padding:14px;border:1px solid #ddd;border-radius:10px;font-family:\'Inter\',sans-serif;font-size:14px;resize:vertical;margin-bottom:12px;outline:none;box-sizing:border-box;"></textarea>' +
        '<button onclick="submitReview()" style="background:#EB6753;color:#fff;border:none;padding:12px 26px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;">Submit Review</button>' +
        '<p id="reviewMsg" style="margin:10px 0 0;font-size:13px;font-weight:500;"></p>';
}

let selectedRating = 0;
window.hoverStars = (n) => { document.querySelectorAll('.review-star').forEach((s, i) => { s.className = i < n ? 'fa-solid fa-star review-star' : 'fa-regular fa-star review-star'; s.style.color = i < n ? '#f1c40f' : '#ddd'; }); };
window.resetStars = () => { document.querySelectorAll('.review-star').forEach((s, i) => { s.className = i < selectedRating ? 'fa-solid fa-star review-star' : 'fa-regular fa-star review-star'; s.style.color = i < selectedRating ? '#f1c40f' : '#ddd'; }); };
window.selectStar = (n) => { selectedRating = n; document.getElementById('reviewRating').value = n; resetStars(); };

window.submitReview = async () => {
    const comment = document.getElementById('reviewComment')?.value?.trim() || '';
    const msgEl = document.getElementById('reviewMsg');
    if (!selectedRating) { if (msgEl) { msgEl.style.color = '#e74c3c'; msgEl.textContent = 'Please click a star to rate.'; } return; }
    if (msgEl) { msgEl.style.color = '#999'; msgEl.textContent = 'Submitting...'; }

    const { error } = await _supabase.from('reviews').insert({ listing_id: LISTING_ID, user_id: CURRENT_USER.id, rating: selectedRating, comment: comment || null });

    if (error) {
        console.error('❌ [DETAIL] Review error:', error.message);
        const isTrigger = error.message.toLowerCase().includes('approved') || error.message.toLowerCase().includes('booking');
        if (msgEl) {
            msgEl.innerHTML = isTrigger
                ? '<div style="background:#fff5f5;border:1.5px solid #fcc;border-radius:10px;padding:12px 14px;color:#c0392b;font-size:13px;line-height:1.6;text-align:left;margin-top:8px;"><i class="fa-solid fa-triangle-exclamation" style="margin-right:7px;"></i><strong>Database trigger blocked review.</strong><br>Go to Supabase → Database → Functions → <code>validate_review</code> and remove the booking check.</div>'
                : '<div style="background:#fff5f5;border:1.5px solid #fcc;border-radius:10px;padding:12px 14px;color:#c0392b;font-size:13px;line-height:1.6;text-align:left;margin-top:8px;"><i class="fa-solid fa-circle-xmark" style="margin-right:7px;"></i>' + error.message + '</div>';
        }
        return;
    }

    showToast('Review submitted! Thank you ⭐', 'success');
    if (msgEl) { msgEl.style.color = '#2ecc71'; msgEl.textContent = '✅ Review submitted! Thank you.'; }
    await loadReviews();
    const { data: updated } = await _supabase.from('listings').select('avg_rating, reviews_count').eq('id', LISTING_ID).single();
    if (updated) renderRatingBadge(updated.avg_rating, updated.reviews_count);
    selectedRating = 0;
    if (document.getElementById('reviewComment')) document.getElementById('reviewComment').value = '';
    resetStars();
};

function initBookingForm() {
    const bookingForm = document.getElementById('bookingForm');
    if (!bookingForm) return;

    if (!CURRENT_USER) {
        bookingForm.innerHTML = '<div style="text-align:center;padding:12px;"><p style="color:#666;margin-bottom:14px;font-size:14px;">Sign in to check availability and book.</p><a href="/Auth" class="book-btn" style="text-decoration:none;">Sign In to Book</a></div>';
        return;
    }

    // Owner cannot book their own listing
    if (CURRENT_LISTING?.owner_id && CURRENT_LISTING.owner_id === CURRENT_USER.id) {
        bookingForm.innerHTML = '<div style="background:#f0f4ff;border:1.5px solid #c7d7f5;border-radius:12px;padding:16px 18px;text-align:center;"><i class="fa-solid fa-house-user" style="color:#4a6fa5;font-size:22px;margin-bottom:8px;display:block;"></i><p style="color:#4a6fa5;font-weight:700;margin:0 0 4px;font-size:14px;">This is your listing</p><p style="color:#6683aa;font-size:13px;margin:0;">You cannot book your own property.</p></div>';
        return;
    }

    if (CURRENT_LISTING?.availability_status !== 'available') {
        const status = CURRENT_LISTING?.availability_status || 'unavailable';
        const msg = status === 'booked' ? 'Currently Booked' : 'Not Available for Booking';
        bookingForm.innerHTML = '<p style="color:#c0392b;text-align:center;font-weight:600;background:#fde8e8;padding:14px;border-radius:10px;margin:0;"><i class="fa-solid fa-circle-xmark"></i> ' + msg + '</p>';
        return;
    }
    const startDate = document.getElementById('bookingStartDate');
    const endDate = document.getElementById('bookingEndDate');
    const today = new Date().toISOString().split('T')[0];
    if (startDate) startDate.min = today;
    if (endDate) endDate.min = today;

    function calcTotal() {
        const s = startDate?.value, e = endDate?.value, totalEl = document.getElementById('bookingTotal');
        if (!s || !e || !totalEl) return;
        const days = Math.round((new Date(e) - new Date(s)) / 86400000);
        if (days <= 0) { totalEl.textContent = ''; return; }
        const price = CURRENT_LISTING?.price || 0, currency = CURRENT_LISTING?.currency || 'RWF';
        const isVeh = CURRENT_LISTING?.category_slug === 'vehicle';
        const unit = isVeh ? 'day' : 'night';
        totalEl.innerHTML = days + ' ' + unit + (days > 1 ? 's' : '') + ' × ' + Number(price).toLocaleString('en-RW') + ' ' + currency + ' = <span style="color:#EB6753;font-weight:700;">' + Number(days * price).toLocaleString('en-RW') + ' ' + currency + '</span>';
    }
    startDate?.addEventListener('change', () => { calcTotal(); if (endDate && startDate.value) endDate.min = startDate.value; });
    endDate?.addEventListener('change', calcTotal);
    document.getElementById('bookingBtn')?.addEventListener('click', goToCheckout);
}

function goToCheckout() {
    const startDate = document.getElementById('bookingStartDate')?.value;
    const endDate = document.getElementById('bookingEndDate')?.value;
    const statusEl = document.getElementById('bookingStatus');
    const btn = document.getElementById('bookingBtn');
    if (!startDate || !endDate) { if (statusEl) { statusEl.style.color = '#e74c3c'; statusEl.textContent = 'Please select check-in and check-out dates.'; } return; }
    const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000);
    if (days <= 0) { if (statusEl) { statusEl.style.color = '#e74c3c'; statusEl.textContent = 'Check-out must be after check-in.'; } return; }
    const totalAmount = days * (CURRENT_LISTING?.price || 0);
    const currency = CURRENT_LISTING?.currency || 'RWF';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Redirecting...'; }
    const params = new URLSearchParams({ listing_id: LISTING_ID, title: CURRENT_LISTING?.title || '', start_date: startDate, end_date: endDate, nights: days, price: CURRENT_LISTING?.price || 0, currency, total: totalAmount, category: CURRENT_LISTING?.category_slug || 'property' });
    window.location.href = '/Checkout/?' + params.toString();
}

function setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function escHtml(s) { if (!s) return ''; return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showToast(message, type) {
    const colors = { success: '#2ecc71', error: '#e74c3c', info: '#3498db' };
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:' + (colors[type]||colors.info) + ';color:#fff;padding:14px 22px;border-radius:12px;font-family:Inter,sans-serif;font-size:14px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,0.2);z-index:99999;max-width:360px;';
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
}
function showDetailError(msg) {
    const skel = document.getElementById('skelEl'); if (skel) skel.style.display = 'none';
    const content = document.getElementById('contentEl');
    if (content) { content.style.display = 'block'; content.innerHTML = '<div style="text-align:center;padding:80px 20px;grid-column:1/-1;"><i class="fa-solid fa-triangle-exclamation" style="font-size:52px;color:#e74c3c;margin-bottom:18px;display:block;"></i><p style="font-size:18px;color:#555;margin-bottom:20px;">' + msg + '</p><a href="/Listings" style="color:#EB6753;font-weight:700;text-decoration:none;font-size:15px;">← Back to Listings</a></div>'; }
}