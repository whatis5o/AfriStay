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
let REVIEWS_OPEN = false; // set from platform_config key='open_reviews' value='true'

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

    // Fetch user + reviews-open flag + active promo in parallel
    const today = new Date().toISOString().slice(0, 10);
    const [authResult, configResult] = await Promise.all([
        _supabase.auth.getUser(),
        _supabase.from('platform_config').select('value').eq('key', 'open_reviews').maybeSingle(),
    ]);

    CURRENT_USER  = authResult.data?.user || null;
    REVIEWS_OPEN  = configResult.data?.value === 'true';

    // Fetch profile to check banned flag
    if (CURRENT_USER) {
        const { data: prof } = await _supabase.from('profiles').select('banned').eq('id', CURRENT_USER.id).single();
        if (prof?.banned) {
            CURRENT_USER = null; // treat as logged-out so they can't book
            await _supabase.auth.signOut();
            const msg = document.createElement('div');
            msg.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#e74c3c;color:#fff;text-align:center;padding:14px 20px;font-size:14px;font-weight:700;z-index:9999;';
            msg.textContent = 'Your account has been suspended. You cannot make bookings.';
            document.body.prepend(msg);
        }
    }
    console.log(CURRENT_USER ? `✅ [DETAIL] Logged in: ${CURRENT_USER.email}` : 'ℹ️ [DETAIL] Not logged in');
    console.log(`ℹ️ [DETAIL] Reviews open: ${REVIEWS_OPEN}`);

    if (CURRENT_USER) {
        document.getElementById('signInBtn')?.classList.add('hidden');
        document.getElementById('userIcon')?.classList.remove('hidden');
    }

    await Promise.all([loadListingDetails(today), loadReviews()]);
    initBookingForm();
    initReviewForm();

    // If reviews are closed, hide the section title too
    if (!REVIEWS_OPEN) {
        const reviewsHeader = document.getElementById('reviewsSection');
        if (reviewsHeader) reviewsHeader.style.display = 'none';
    }
});

async function loadListingDetails(today) {
    if (!today) today = new Date().toISOString().slice(0, 10);
    console.log('📋 [DETAIL] Fetching listing...');

    const [{ data: listing, error }, { data: promoData }] = await Promise.all([
        _supabase
            .from('listings')
            .select(`
                id, title, description, price, price_display, price_outside_kigali, price_outside_kigali_display, currency, address,
                availability_status, status, avg_rating, reviews_count,
                category_slug, landmark_description,
                province_id, district_id, sector_id, owner_id,
                room_count, bathroom_count, bed_count, max_guests, floor_area_sqm, amenities_data,
                provinces ( name ),
                districts ( name ),
                sectors ( name ),
                real_estate_types ( name ),
                listing_images ( id, image_url, created_at ),
                listing_videos ( id, video_url, created_at )
            `)
            .eq('id', LISTING_ID)
            .single(),
        _supabase
            .from('promotions')
            .select('discount, title, end_date')
            .eq('listing_id', LISTING_ID)
            .lte('start_date', today)
            .gte('end_date', today)
            .limit(1)
            .maybeSingle(),
    ]);

    if (error || !listing) {
        console.error('❌ [DETAIL] Not found:', error?.message);
        showDetailError('This listing could not be found.');
        return;
    }

    console.log(`📊 [DETAIL] status="${listing.status}" | availability="${listing.availability_status}"`);
    console.log(`🖼️ [DETAIL] images: ${listing.listing_images?.length || 0} | videos: ${listing.listing_videos?.length || 0}`);

    // ── Guard: block unapproved or unavailable listings ──
    const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
    if (!isPreview) {
        if (listing.status !== 'approved') {
            console.warn('🚫 [DETAIL] Listing not approved — redirecting');
            window.location.replace('/Listings/?msg=not_available');
            return;
        }
        if (listing.availability_status === 'unavailable') {
            console.warn('🚫 [DETAIL] Listing unavailable — redirecting');
            window.location.replace('/Listings/?msg=not_available');
            return;
        }
    }

    CURRENT_LISTING = listing;

    setEl('listingTitle', listing.title);
    setEl('breadTitle', listing.title);
    document.title = listing.title + ' - AfriStay';
    // Dynamic OG / meta updates for social sharing
    const _ogImg = listing.listing_images?.[0]?.image_url || 'https://afristay.rw/Pictures/Rwanda.jpg';
    const _ogUrl = 'https://afristay.rw/Listings/Detail/?id=' + LISTING_ID;
    [['og:title', listing.title + ' — AfriStay Rwanda'],
     ['og:description', (listing.description || 'Book this listing on AfriStay').slice(0, 160)],
     ['og:image', _ogImg], ['og:url', _ogUrl]
    ].forEach(([p, v]) => { const m = document.querySelector('meta[property="' + p + '"]'); if (m) m.setAttribute('content', v); });
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

    const currency  = listing.currency || 'RWF';
    const dp        = listing.price_display || listing.price;
    const price     = Number(dp).toLocaleString('en-RW');
    const priceUnit = listing.category_slug === 'vehicle' ? '/ day' : '/ night';
    const isVehDual = listing.category_slug === 'vehicle' && listing.price_outside_kigali;
    const priceEl   = document.getElementById('listingPrice');
    if (priceEl) {
        if (isVehDual) {
            const oDP  = listing.price_outside_kigali_display || listing.price_outside_kigali;
            const oStr = Number(oDP).toLocaleString('en-RW');
            priceEl.innerHTML =
                '<div style="font-size:13px;line-height:2.2;">' +
                '🏙️ Kigali: <strong>' + price + ' <small>' + currency + '</small><span style="font-size:12px;color:#bbb;font-weight:400;"> /day</span></strong><br>' +
                '🌍 Outside Kigali: <strong>' + oStr + ' <small>' + currency + '</small><span style="font-size:12px;color:#bbb;font-weight:400;"> /day</span></strong>' +
                '</div>';
        } else if (promoData && promoData.discount) {
            const discounted = Math.round(dp * (1 - promoData.discount / 100));
            const discStr    = Number(discounted).toLocaleString('en-RW');
            const endFmt     = new Date(promoData.end_date).toLocaleDateString('en-RW', { month: 'short', day: 'numeric' });
            priceEl.innerHTML =
                '<div class="detail-promo-wrap">' +
                '<span class="detail-promo-original">' + price + ' <small>' + currency + '</small></span>' +
                '<span>' + discStr + ' <small>' + currency + '</small> <span style="font-size:14px;color:#bbb;font-weight:400;">' + priceUnit + '</span>' +
                '<span class="detail-promo-badge">Promo</span>' +
                '</span>' +
                '<small style="color:#EB6753;font-size:12px;margin-top:2px;">Promo ends ' + endFmt + '</small>' +
                '</div>';
        } else {
            priceEl.innerHTML = price + ' <small>' + currency + '</small> <span style="font-size:14px;color:#bbb;font-weight:400;">' + priceUnit + '</span>';
        }
    }

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
    if (typeof window.refreshFavHearts === 'function') {
        setTimeout(() => window.refreshFavHearts(), 200);
    }

    const images = (listing.listing_images || []).map(img => ({ type: 'image', src: img.image_url }));
    const videos = (listing.listing_videos || []).map(vid => ({ type: 'video', src: vid.video_url }));
    MEDIA_ITEMS = [...images, ...videos];
    console.log('📽️ [DETAIL] Total media: ' + MEDIA_ITEMS.length);

    renderMediaSlider(listing.title);

    document.getElementById('skelEl').style.display = 'none';
    document.getElementById('contentEl').style.display = 'grid';
    console.log('✅ [DETAIL] Page rendered');

    _injectShareButton(LISTING_ID, listing.title);
    loadSimilarListings(listing.province_id, listing.category_slug);
    renderListingSpecs(listing);
    renderListingAmenities(listing);

    // ── Pending notice: hide booking form if not approved ──
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

    // ── Fetch and render owner info (public — no phone/email) ──
    if (listing.owner_id) {
        _supabase
            .from('v_owner_public')
            .select('full_name, bio, member_since')
            .eq('id', listing.owner_id)
            .maybeSingle()
            .then(({ data: owner, error }) => {
                if (error) console.warn("Could not fetch owner:", error);
                if (owner) renderOwnerContact(owner);
            });
    }
}

function renderOwnerContact(owner) {
    const anchor = document.getElementById('reviewsSection');
    if (!anchor || document.getElementById('ownerContactCard')) return;
    const el = document.createElement('div');
    el.id = 'ownerContactCard';
    const since = owner.member_since ? new Date(owner.member_since).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : null;
    el.innerHTML =
        '<div style="background:#fff;border-radius:16px;padding:22px 24px;margin-bottom:24px;border:1px solid #f0f0f0;box-shadow:0 2px 12px rgba(0,0,0,0.05);">' +
        '<h3 style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 16px;padding-bottom:10px;border-bottom:2px solid #f5f5f5;">' +
        '<i class="fa-solid fa-user-tie" style="color:#EB6753;margin-right:8px;"></i>Your Host</h3>' +
        '<div style="display:flex;align-items:center;gap:14px;">' +
        '<div style="width:52px;height:52px;border-radius:50%;background:#EB6753;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;flex-shrink:0;">' +
        escHtml((owner.full_name || 'H').charAt(0).toUpperCase()) + '</div>' +
        '<div style="flex:1;">' +
        '<p style="font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 3px;">' + escHtml(owner.full_name || 'Host') + '</p>' +
        (since ? '<p style="font-size:12px;color:#aaa;margin:0 0 6px;"><i class="fa-regular fa-calendar" style="margin-right:5px;"></i>Host since ' + since + '</p>' : '') +
        (owner.bio ? '<p style="font-size:13px;color:#555;margin:0;line-height:1.6;">' + escHtml(owner.bio) + '</p>' : '') +
        '</div></div></div>';
    anchor.before(el);
}
function renderListingSpecs(listing) {
    // Insert specs chips after the description
    const descEl = document.getElementById('listingDescription');
    if (!descEl || document.getElementById('listingSpecsEl')) return;

    const specs = [];
    if (listing.room_count)     specs.push({ icon: 'fa-solid fa-door-open',     label: listing.room_count + ' Bedroom' + (listing.room_count > 1 ? 's' : '') });
    if (listing.bathroom_count) specs.push({ icon: 'fa-solid fa-bath',           label: listing.bathroom_count + ' Bathroom' + (listing.bathroom_count > 1 ? 's' : '') });
    if (listing.bed_count)      specs.push({ icon: 'fa-solid fa-bed',            label: listing.bed_count + ' Bed' + (listing.bed_count > 1 ? 's' : '') });
    if (listing.max_guests)     specs.push({ icon: 'fa-solid fa-users',          label: listing.max_guests + ' Guest' + (listing.max_guests > 1 ? 's' : '') });
    if (listing.floor_area_sqm) specs.push({ icon: 'fa-solid fa-ruler-combined', label: listing.floor_area_sqm + ' m²' });

    if (!specs.length) return;

    const el = document.createElement('div');
    el.id = 'listingSpecsEl';
    el.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin:16px 0 24px;';
    el.innerHTML = specs.map(s =>
        '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f7f7f7;border-radius:10px;font-size:13px;font-weight:600;color:#333;">' +
        '<i class="' + s.icon + '" style="color:#EB6753;font-size:14px;"></i>' + s.label + '</div>'
    ).join('');
    descEl.after(el);
}

async function renderListingAmenities(listing) {
    const reviewsEl = document.getElementById('reviewsSection');
    if (!reviewsEl || document.getElementById('amenitiesSection')) return;

    const slugs = listing.amenities_data;
    if (!slugs || !slugs.length) return;

    // Fetch definitions for these slugs
    const { data, error } = await _supabase
        .from('amenity_definitions')
        .select('slug, label, icon, category')
        .in('slug', slugs);
    if (error || !data || !data.length) return;

    // Group by category
    const groups = {};
    data.forEach(a => {
        if (!groups[a.category]) groups[a.category] = [];
        groups[a.category].push(a);
    });

    const el = document.createElement('div');
    el.id = 'amenitiesSection';
    let html = '<div style="font-size:18px;font-weight:800;color:#1a1a1a;margin:0 0 16px;padding-bottom:12px;border-bottom:2px solid #f0f0f0;">Amenities</div>';
    Object.keys(groups).forEach(cat => {
        html += '<div style="margin-bottom:20px;">';
        if (cat && cat !== 'null') html += '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#aaa;margin-bottom:10px;">' + escHtml(cat) + '</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;">';
        groups[cat].forEach(a => {
            html += '<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1.5px solid #f0f0f0;border-radius:12px;font-size:13px;font-weight:600;color:#333;background:#fafafa;">' +
                '<i class="' + (a.icon || 'fa-solid fa-check') + '" style="color:#EB6753;font-size:15px;width:18px;text-align:center;flex-shrink:0;"></i>' +
                escHtml(a.label) + '</div>';
        });
        html += '</div></div>';
    });
    el.innerHTML = html;
    el.style.cssText = 'background:#fff;border-radius:16px;padding:22px 24px;margin-bottom:24px;border:1px solid #f0f0f0;box-shadow:0 2px 12px rgba(0,0,0,0.05);';
    reviewsEl.before(el);
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
    // If reviews are closed, don't show the badge at all
    if (!REVIEWS_OPEN) { badge.style.display = 'none'; return; }
    if (!avgRating || !reviewsCount) {
        badge.innerHTML = '<i class="fa-regular fa-star" style="color:#ddd;"></i> No ratings yet';
        return;
    }
    const rating = parseFloat(avgRating).toFixed(1);
    badge.innerHTML = '<i class="fa-solid fa-star" style="color:#f1c40f;"></i> ' + rating + ' (' + reviewsCount + ' review' + (reviewsCount !== 1 ? 's' : '') + ')';
}

async function loadReviews() {
    const list = document.getElementById('reviewsList');
    if (!list) return;

    if (!REVIEWS_OPEN) {
        list.innerHTML =
            '<div style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:14px;padding:28px 20px;text-align:center;">' +
            '<i class="fa-solid fa-lock" style="font-size:28px;color:#ccc;display:block;margin-bottom:10px;"></i>' +
            '<p style="font-weight:700;color:#555;margin:0 0 6px;font-size:15px;">Reviews are currently closed</p>' +
            '<p style="color:#bbb;font-size:13px;margin:0;line-height:1.6;">The host or admin has temporarily disabled reviews for this listing.</p>' +
            '</div>';
        return;
    }

    const { data: reviews, error } = await _supabase
        .from('reviews')
        .select('id, rating, comment, created_at, user_id, owner_reply, owner_replied_at, profiles ( full_name )')
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
    const isOwner = CURRENT_USER && CURRENT_LISTING?.owner_id === CURRENT_USER.id;

    list.innerHTML = '';
    reviews.forEach(r => {
        const name      = r.profiles?.full_name || 'Anonymous';
        const initials  = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        const date      = new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        const stars     = Array.from({ length: 5 }, (_, i) => '<i class="fa-' + (i < r.rating ? 'solid' : 'regular') + ' fa-star" style="color:' + (i < r.rating ? '#f1c40f' : '#ddd') + ';font-size:13px;"></i>').join('');
        const replyDate = r.owner_replied_at ? new Date(r.owner_replied_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '';

        const card = document.createElement('div');
        card.id = 'review-' + r.id;
        card.style.cssText = 'background:#fff;border:1px solid #eee;border-radius:14px;padding:20px;margin-bottom:14px;';
        card.innerHTML =
            '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">' +
            '<div style="width:40px;height:40px;border-radius:50%;background:#EB6753;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;">' + initials + '</div>' +
            '<div style="flex:1;"><div style="font-weight:600;font-size:14px;color:#222;">' + escHtml(name) + '</div><div style="font-size:12px;color:#aaa;">' + date + '</div></div>' +
            '<div>' + stars + '</div></div>' +
            (r.comment ? '<p style="color:#555;font-size:14px;line-height:1.65;margin:0 0 10px;">' + escHtml(r.comment) + '</p>' : '') +
            // Existing reply
            (r.owner_reply
                ? '<div style="background:#fff8f6;border-left:3px solid #EB6753;border-radius:0 10px 10px 0;padding:10px 14px;margin-top:8px;">' +
                  '<p style="font-size:11px;font-weight:700;color:#EB6753;margin:0 0 4px;text-transform:uppercase;letter-spacing:.5px;"><i class="fa-solid fa-reply"></i> Host Reply · ' + replyDate + '</p>' +
                  '<p id="reply-text-' + r.id + '" style="font-size:13px;color:#444;margin:0;line-height:1.6;">' + escHtml(r.owner_reply) + '</p>' +
                  (isOwner ? '<button onclick="openReplyForm(\'' + r.id + '\',true)" style="margin-top:6px;background:none;border:none;font-size:12px;color:#EB6753;cursor:pointer;font-weight:600;padding:0;">Edit reply</button>' : '') +
                  '</div>'
                : '') +
            // Reply button for owner (no reply yet)
            (isOwner && !r.owner_reply
                ? '<button onclick="openReplyForm(\'' + r.id + '\',false)" style="margin-top:8px;background:none;border:1px solid #EB6753;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;color:#EB6753;cursor:pointer;display:flex;align-items:center;gap:6px;"><i class="fa-solid fa-reply"></i> Reply</button>'
                : '') +
            '<div id="reply-form-' + r.id + '" style="display:none;margin-top:10px;"></div>';
        list.appendChild(card);
    });
}

window.openReplyForm = function(reviewId, isEdit) {
    const wrap = document.getElementById('reply-form-' + reviewId);
    if (!wrap) return;
    if (wrap.style.display === 'block') { wrap.style.display = 'none'; return; } // toggle
    const existing = document.getElementById('reply-text-' + reviewId)?.textContent || '';
    wrap.style.display = 'block';
    wrap.innerHTML =
        '<textarea id="reply-input-' + reviewId + '" style="width:100%;min-height:70px;padding:10px 12px;border:1.5px solid #e0e0e0;border-radius:10px;font-family:Inter,sans-serif;font-size:13px;resize:vertical;" placeholder="Write your reply...">' + (isEdit ? existing : '') + '</textarea>' +
        '<div style="display:flex;gap:8px;margin-top:8px;">' +
        '<button onclick="submitReply(\'' + reviewId + '\')" style="background:#EB6753;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;">Post Reply</button>' +
        '<button onclick="document.getElementById(\'reply-form-' + reviewId + '\').style.display=\'none\'" style="background:#f5f5f5;color:#555;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>' +
        '</div>';
};

window.submitReply = async function(reviewId) {
    const input = document.getElementById('reply-input-' + reviewId);
    const reply = input?.value.trim();
    if (!reply) { showToast('Please write a reply first.', 'warning'); return; }

    const { error } = await _supabase.from('reviews').update({
        owner_reply:      reply,
        owner_replied_at: new Date().toISOString(),
    }).eq('id', reviewId);

    if (error) { showToast('Failed to post reply: ' + error.message, 'error'); return; }
    showToast('Reply posted!', 'success');
    await loadReviews(); // re-render
};

async function initReviewForm() {
    const formSection = document.getElementById('reviewFormSection');
    if (!formSection) return;

    // Gate: reviews closed in platform_config
    if (!REVIEWS_OPEN) {
        formSection.style.display = 'none';
        return;
    }

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

    // When open_reviews is true, any logged-in user may review (testing/open mode).
    // Otherwise, require a confirmed/completed booking whose end_date has passed.
    if (!REVIEWS_OPEN) {
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

async function initBookingForm() {
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

    // ── Fetch already-booked date ranges ──
    let BOOKED_RANGES = [];
    try {
        const { data: taken } = await _supabase
            .from('bookings')
            .select('start_date, end_date')
            .eq('listing_id', LISTING_ID)
            .in('status', ['pending', 'awaiting_approval', 'approved', 'confirmed']);
        BOOKED_RANGES = (taken || []).map(b => ({
            s: new Date(b.start_date + 'T00:00:00'),
            e: new Date(b.end_date   + 'T00:00:00')
        }));
    } catch(e) { console.warn('[BOOKING] Could not fetch booked ranges:', e.message); }

    function datesOverlap(s, e) {
        const start = new Date(s + 'T00:00:00'), end = new Date(e + 'T00:00:00');
        return BOOKED_RANGES.some(r => start < r.e && end > r.s);
    }

    const startDate = document.getElementById('bookingStartDate');
    const endDate   = document.getElementById('bookingEndDate');
    const today     = new Date().toISOString().split('T')[0];
    if (startDate) startDate.min = today;
    if (endDate)   endDate.min   = today;

    // ── Inject guest count field ──
    if (!document.getElementById('bookingGuestCount')) {
        const maxG = CURRENT_LISTING?.max_guests || 20;
        const isVeh = CURRENT_LISTING?.category_slug === 'vehicle';
        const gcDiv = document.createElement('div');
        gcDiv.style.cssText = 'margin-bottom:14px;';
        gcDiv.innerHTML = '<label style="font-size:13px;color:#666;font-weight:600;display:block;margin-bottom:6px;">' +
            (isVeh ? 'Passengers' : 'Guests') + (maxG ? ' <span style="color:#bbb;font-weight:400;">(max ' + maxG + ')</span>' : '') + '</label>' +
            '<input type="number" id="bookingGuestCount" min="1" max="' + maxG + '" value="1" ' +
            'style="width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:8px;font-family:\'Inter\',sans-serif;font-size:14px;">' +
            '<p id="guestCountError" style="display:none;color:#e74c3c;font-size:12px;margin:4px 0 0;"></p>';
        // Insert before the total div
        const totalEl = document.getElementById('bookingTotal');
        if (totalEl) totalEl.before(gcDiv);

        // Clamp manual input to [1, maxG]
        const gcInput = document.getElementById('bookingGuestCount');
        const gcError = document.getElementById('guestCountError');
        gcInput.addEventListener('input', () => {
            let v = parseInt(gcInput.value, 10);
            if (isNaN(v) || v < 1) {
                gcInput.value = 1;
                gcError.style.display = 'none';
            } else if (v > maxG) {
                gcInput.value = maxG;
                gcError.textContent = 'Maximum ' + maxG + (isVeh ? ' passenger' : ' guest') + (maxG === 1 ? '' : 's') + ' allowed.';
                gcError.style.display = 'block';
                setTimeout(() => { gcError.style.display = 'none'; }, 3000);
            } else {
                gcError.style.display = 'none';
            }
        });
    }

    function calcTotal() {
        const s = startDate?.value, e = endDate?.value;
        const totalEl = document.getElementById('bookingTotal');
        const statusEl = document.getElementById('bookingStatus');
        if (!s || !e || !totalEl) return;
        const days = Math.round((new Date(e) - new Date(s)) / 86400000);
        if (days <= 0) { totalEl.textContent = ''; return; }
        // Overlap check
        if (datesOverlap(s, e)) {
            totalEl.textContent = '';
            if (statusEl) { statusEl.style.color = '#e74c3c'; statusEl.innerHTML = '<i class="fa-solid fa-calendar-xmark"></i> These dates are already booked. Please choose different dates.'; }
            document.getElementById('bookingBtn').disabled = true;
            return;
        }
        if (statusEl) { statusEl.style.color = ''; statusEl.textContent = ''; }
        document.getElementById('bookingBtn').disabled = false;
        const isVeh = CURRENT_LISTING?.category_slug === 'vehicle';
        const unit = isVeh ? 'day' : 'night';
        const selectedZone = document.querySelector('input[name="zone"]:checked')?.value || 'kigali';
        const price = isVeh && selectedZone === 'outside_kigali' && CURRENT_LISTING?.price_outside_kigali
            ? (CURRENT_LISTING.price_outside_kigali_display || CURRENT_LISTING.price_outside_kigali)
            : (CURRENT_LISTING?.price_display || CURRENT_LISTING?.price || 0);
        const currency = CURRENT_LISTING?.currency || 'RWF';
        totalEl.innerHTML = days + ' ' + unit + (days > 1 ? 's' : '') + ' × ' + Number(price).toLocaleString('en-RW') + ' ' + currency + ' = <span style="color:#EB6753;font-weight:700;">' + Number(days * price).toLocaleString('en-RW') + ' ' + currency + '</span>';
    }
    startDate?.addEventListener('change', () => { calcTotal(); if (endDate && startDate.value) endDate.min = startDate.value; });
    endDate?.addEventListener('change', calcTotal);
    document.getElementById('bookingBtn')?.addEventListener('click', goToCheckout);

    // Zone selector for vehicles with dual pricing
    if (CURRENT_LISTING?.category_slug === 'vehicle' && CURRENT_LISTING?.price_outside_kigali) {
        const zoneEl = document.createElement('div');
        zoneEl.id = 'zoneSelector';
        zoneEl.style.cssText = 'margin:10px 0 4px;padding:12px 14px;background:#f9fafb;border-radius:10px;border:1px solid #eee;font-size:13px;';
        zoneEl.innerHTML =
            '<p style="font-weight:700;color:#555;margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;">Zone</p>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:7px;">' +
            '<input type="radio" name="zone" value="kigali" checked> ' +
            '🏙️ Within Kigali <span style="margin-left:auto;font-weight:700;color:#EB6753;">' + Number(CURRENT_LISTING.price_display || CURRENT_LISTING.price).toLocaleString('en-RW') + ' RWF/day</span></label>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
            '<input type="radio" name="zone" value="outside_kigali"> ' +
            '🌍 Outside Kigali <span style="margin-left:auto;font-weight:700;color:#EB6753;">' + Number(CURRENT_LISTING.price_outside_kigali_display || CURRENT_LISTING.price_outside_kigali).toLocaleString('en-RW') + ' RWF/day</span></label>';
        const totalEl2 = document.getElementById('bookingTotal');
        if (totalEl2) totalEl2.before(zoneEl);
        zoneEl.querySelectorAll('input[name="zone"]').forEach(r => r.addEventListener('change', calcTotal));
    }
}

function goToCheckout() {
    if (!CURRENT_USER) {
        const statusEl = document.getElementById('bookingStatus');
        if (statusEl) { statusEl.style.color = '#e74c3c'; statusEl.textContent = 'Please sign in to book.'; }
        return;
    }
    const startDate = document.getElementById('bookingStartDate')?.value;
    const endDate = document.getElementById('bookingEndDate')?.value;
    const statusEl = document.getElementById('bookingStatus');
    const btn = document.getElementById('bookingBtn');
    const isVeh = CURRENT_LISTING?.category_slug === 'vehicle';
    if (!startDate || !endDate) { if (statusEl) { statusEl.style.color = '#e74c3c'; statusEl.textContent = isVeh ? 'Please select pick-up and return dates.' : 'Please select check-in and check-out dates.'; } return; }
    const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000);
    if (days <= 0) { if (statusEl) { statusEl.style.color = '#e74c3c'; statusEl.textContent = isVeh ? 'Return must be after pick-up.' : 'Check-out must be after check-in.'; } return; }
    const selectedZone = document.querySelector('input[name="zone"]:checked')?.value || 'kigali';
    const selectedPrice = isVeh && selectedZone === 'outside_kigali' && CURRENT_LISTING?.price_outside_kigali
        ? (CURRENT_LISTING.price_outside_kigali_display || CURRENT_LISTING.price_outside_kigali)
        : (CURRENT_LISTING?.price_display || CURRENT_LISTING?.price || 0);
    const totalAmount = days * selectedPrice;
    const currency = CURRENT_LISTING?.currency || 'RWF';
    const maxG = CURRENT_LISTING?.max_guests || CURRENT_LISTING?.max_passengers || Infinity;
    let guests = parseInt(document.getElementById('bookingGuestCount')?.value) || 1;
    if (guests < 1) guests = 1;
    if (guests > maxG) {
        if (statusEl) { statusEl.style.color = '#e74c3c'; statusEl.textContent = 'Maximum ' + maxG + (isVeh ? ' passenger' : ' guest') + (maxG === 1 ? '' : 's') + ' allowed for this listing.'; }
        return;
    }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Redirecting...'; }
    const params = new URLSearchParams({ listing_id: LISTING_ID, title: CURRENT_LISTING?.title || '', start_date: startDate, end_date: endDate, nights: days, price: selectedPrice, currency, total: totalAmount, category: CURRENT_LISTING?.category_slug || 'property', price_zone: selectedZone, guests });
    window.location.href = '/Listings/Checkout/?' + params.toString();
}

/* ═══════════════════════════════════════════════
   SHARE BUTTON
   ═══════════════════════════════════════════════ */
function _injectShareButton(listingId, title) {
    // Find the actions area (next to book button) or append after header
    const contentEl = document.getElementById('contentEl');
    if (!contentEl) return;

    // Don't double-inject
    if (document.getElementById('shareBtn')) return;

    const shareUrl  = 'https://afristay.rw/Listings/Detail/?id=' + encodeURIComponent(listingId);
    const shareText = (title || 'Check out this listing') + ' — AfriStay Rwanda';

    const btn = document.createElement('button');
    btn.id = 'shareBtn';
    btn.innerHTML = '<i class="fa-solid fa-share-nodes"></i> Share';
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border:1.5px solid #e0e0e0;background:#fff;border-radius:10px;font-family:Inter,sans-serif;font-size:14px;font-weight:600;color:#333;cursor:pointer;transition:all .2s;margin-top:12px;';
    btn.onmouseenter = () => { btn.style.borderColor = '#EB6753'; btn.style.color = '#EB6753'; };
    btn.onmouseleave = () => { btn.style.borderColor = '#e0e0e0'; btn.style.color = '#333'; };

    btn.addEventListener('click', async () => {
        // 1. Native share (mobile)
        if (navigator.share) {
            try { await navigator.share({ title: shareText, url: shareUrl }); return; } catch (_) { /* cancelled */ return; }
        }
        // 2. Desktop fallback — small dropdown
        const existing = document.getElementById('shareDrop');
        if (existing) { existing.remove(); return; }

        const drop = document.createElement('div');
        drop.id = 'shareDrop';
        drop.style.cssText = 'position:absolute;background:#fff;border:1px solid #e0e0e0;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:8px;z-index:9999;min-width:200px;';

        const items = [
            { icon: 'fa-brands fa-whatsapp', label: 'Share on WhatsApp', color: '#25D366',
              action: () => window.open('https://wa.me/?text=' + encodeURIComponent(shareText + '\n' + shareUrl), '_blank') },
            { icon: 'fa-solid fa-envelope', label: 'Share via Email', color: '#EB6753',
              action: () => window.location.href = 'mailto:?subject=' + encodeURIComponent(shareText) + '&body=' + encodeURIComponent(shareUrl) },
            { icon: 'fa-solid fa-link', label: 'Copy Link', color: '#6366f1',
              action: () => {
                  navigator.clipboard?.writeText(shareUrl).then(() => showToast('Link copied!', 'success'))
                      .catch(() => { const ta = document.createElement('textarea'); ta.value = shareUrl; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); showToast('Link copied!', 'success'); });
                  drop.remove();
              }
            },
        ];

        items.forEach(({ icon, label, color, action }) => {
            const row = document.createElement('button');
            row.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;padding:10px 14px;border:none;background:none;font-family:Inter,sans-serif;font-size:14px;font-weight:600;color:#333;cursor:pointer;border-radius:8px;text-align:left;';
            row.innerHTML = `<i class="${icon}" style="width:18px;text-align:center;color:${color};font-size:16px;"></i>${label}`;
            row.onmouseenter = () => row.style.background = '#f8f8f8';
            row.onmouseleave = () => row.style.background = 'none';
            row.addEventListener('click', () => { action(); drop.remove(); });
            drop.appendChild(row);
        });

        // Position relative to button
        const rect = btn.getBoundingClientRect();
        drop.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
        drop.style.left = (rect.left  + window.scrollX)      + 'px';
        document.body.appendChild(drop);

        // Close on outside click
        const close = e => { if (!drop.contains(e.target) && e.target !== btn) { drop.remove(); document.removeEventListener('click', close); } };
        setTimeout(() => document.addEventListener('click', close), 10);
    });

    // Inject after the booking form or at end of header section
    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm && bookingForm.parentNode) {
        bookingForm.parentNode.insertBefore(btn, bookingForm.nextSibling);
    } else {
        contentEl.appendChild(btn);
    }
}

/* ═══════════════════════════════════════════════
   SIMILAR LISTINGS
   ═══════════════════════════════════════════════ */
async function loadSimilarListings(provinceId, categorySlug) {
    if (!provinceId && !categorySlug) return;

    // Fetch up to 3 similar listings (same province + same category, excluding current)
    let query = _supabase
        .from('listings')
        .select('id, title, price, price_display, currency, category_slug, province_id, district_id, availability_status')
        .neq('id', LISTING_ID)
        .eq('availability_status', 'available')
        .limit(3);

    if (categorySlug) query = query.eq('category_slug', categorySlug);
    if (provinceId)   query = query.eq('province_id', provinceId);

    const { data: similar } = await query;
    if (!similar || !similar.length) return;

    // Fetch images for these listings
    const ids = similar.map(l => l.id);
    const { data: imgRows } = await _supabase
        .from('listing_images')
        .select('listing_id, image_url')
        .in('listing_id', ids)
        .order('display_order', { ascending: true });

    const imgMap = {};
    (imgRows || []).forEach(r => { if (!imgMap[r.listing_id]) imgMap[r.listing_id] = r.image_url; });

    // Fetch province names
    const pvIds = [...new Set(similar.map(l => l.province_id).filter(Boolean))];
    const pvMap = {};
    if (pvIds.length) {
        const { data: pvs } = await _supabase.from('provinces').select('id, name').in('id', pvIds);
        (pvs || []).forEach(p => pvMap[p.id] = p.name);
    }

    // Build section
    const section = document.createElement('div');
    section.id = 'similarSection';
    section.style.cssText = 'grid-column:1/-1;margin-top:32px;';
    section.innerHTML = '<h3 style="font-size:20px;font-weight:800;color:#1a1a1a;margin:0 0 16px;">Similar Listings</h3>';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;';

    similar.forEach(l => {
        const img   = imgMap[l.id] || '';
        const loc   = pvMap[l.province_id] || 'Rwanda';
        const price = Number(l.price_display || l.price).toLocaleString('en-RW');
        const cur   = l.currency || 'RWF';
        const unit  = l.category_slug === 'vehicle' ? '/day' : '/night';

        const card = document.createElement('a');
        card.href = '/Listings/Detail/?id=' + l.id;
        card.style.cssText = 'display:block;text-decoration:none;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:transform .2s,box-shadow .2s;';
        card.onmouseenter = () => { card.style.transform = 'translateY(-3px)'; card.style.boxShadow = '0 8px 24px rgba(0,0,0,.1)'; };
        card.onmouseleave = () => { card.style.transform = 'none'; card.style.boxShadow = '0 2px 12px rgba(0,0,0,.06)'; };
        card.innerHTML = img
            ? `<img src="${escHtml(img)}" alt="${escHtml(l.title)}" style="width:100%;height:160px;object-fit:cover;" onerror="this.style.display='none'">`
            : `<div style="width:100%;height:160px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-image" style="font-size:28px;color:#ddd;"></i></div>`;
        card.innerHTML += `
            <div style="padding:14px 16px;">
                <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(l.title)}</p>
                <p style="margin:0 0 10px;font-size:12px;color:#888;"><i class="fa-solid fa-location-dot" style="margin-right:4px;color:#EB6753;"></i>${escHtml(loc)}</p>
                <p style="margin:0;font-size:15px;font-weight:800;color:#EB6753;">${price} <span style="font-size:11px;font-weight:500;color:#aaa;">${cur}${unit}</span></p>
            </div>`;
        grid.appendChild(card);
    });

    section.appendChild(grid);

    const contentEl = document.getElementById('contentEl');
    if (contentEl) {
        contentEl.appendChild(section);
        if (window.refreshScrollAnimations) window.refreshScrollAnimations();
    }
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