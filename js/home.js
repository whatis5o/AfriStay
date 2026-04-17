/**
 * HOME PAGE — home.js  →  /js/home.js
 */

const STORAGE_BASE = 'https://xuxzeinufjpplxkerlsd.supabase.co/storage/v1/object/public/listing-images';
const FEATURED_CACHE_KEY = 'afristay_featured_v1';
const FEATURED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

document.addEventListener('DOMContentLoaded', async () => {
    await loadFeaturedListings();
});

/* ═══════════════════════════════════════════════
   IMAGE RESOLVER
   1. Try listing_images TABLE (fast, batch)
   2. For any listing still missing, check Storage folder
   ═══════════════════════════════════════════════ */
async function resolveImages(sb, ids) {
    const imgMap = {};

    const { data: rows } = await sb
        .from('listing_images')
        .select('listing_id, image_url')
        .in('listing_id', ids);

    (rows || []).forEach(r => {
        if (!imgMap[r.listing_id] && r.image_url) imgMap[r.listing_id] = r.image_url;
    });

    const missing = ids.filter(id => !imgMap[id]);
    if (missing.length) {
        await Promise.all(missing.map(async (id) => {
            try {
                const { data: files } = await sb.storage
                    .from('listing-images')
                    .list(id, { limit: 1 });
                const file = (files || []).find(f => f.name && !f.id?.endsWith('/'));
                if (file) imgMap[id] = `${STORAGE_BASE}/${id}/${file.name}`;
            } catch(e) {}
        }));
    }

    return imgMap;
}

/* ── FEATURED LISTINGS ── */
async function loadFeaturedListings() {
    const sb = window.supabaseClient;
    if (!sb) { renderFallback(); return; }

    // ── Cache-first: serve from sessionStorage if fresh ──
    try {
        const raw = sessionStorage.getItem(FEATURED_CACHE_KEY);
        if (raw) {
            const { ts, listings, imgMap, dtMap, pvMap } = JSON.parse(raw);
            if (Date.now() - ts < FEATURED_CACHE_TTL) {
                renderCards(listings, imgMap, dtMap, pvMap);
                return;
            }
        }
    } catch(e) {}

    const { data: listings, error } = await sb
        .from('listings')
        .select('id, title, price, price_display, price_outside_kigali_display, currency, availability_status, category_slug, province_id, district_id, created_at')
        .eq('featured', true)
        .eq('status', 'approved')
        .eq('availability_status', 'available')
        .order('created_at', { ascending: false })
        .limit(6);

    if (error || !listings?.length) {
        renderFallback();
        return;
    }

    const ids    = listings.map(l => l.id);
    const today  = new Date().toISOString().slice(0, 10);
    const pvIds  = [...new Set(listings.map(l => l.province_id).filter(Boolean))];
    const dtIds  = [...new Set(listings.map(l => l.district_id).filter(Boolean))];

    const [imgMap, promoRes, pvRes, dtRes] = await Promise.all([
        resolveImages(sb, ids),
        sb.from('promotions').select('listing_id,discount').in('listing_id', ids).lte('start_date', today).gte('end_date', today),
        pvIds.length ? sb.from('provinces').select('id,name').in('id', pvIds) : Promise.resolve({ data: [] }),
        dtIds.length ? sb.from('districts').select('id,name').in('id', dtIds) : Promise.resolve({ data: [] }),
    ]);

    const pvMap = {}, dtMap = {}, promoMap = {};
    (pvRes.data  || []).forEach(p => pvMap[p.id] = p.name);
    (dtRes.data  || []).forEach(d => dtMap[d.id] = d.name);
    (promoRes.data || []).forEach(p => { promoMap[p.listing_id] = p.discount; });

    listings.forEach(l => {
        const disc = promoMap[l.id];
        const dp   = l.price_display || l.price;
        l.promo_discount = disc || null;
        l.promo_price    = disc ? Math.round(dp * (1 - disc / 100)) : null;
    });

    // ── Store in sessionStorage for subsequent loads ──
    try {
        sessionStorage.setItem(FEATURED_CACHE_KEY, JSON.stringify({
            ts: Date.now(), listings, imgMap, dtMap, pvMap
        }));
    } catch(e) {}

    renderCards(listings, imgMap, dtMap, pvMap);
}

/* ── RENDER CARDS ── */
function renderCards(listings, imgMap, dtMap, pvMap) {
    const track = document.getElementById('carouselTrack');
    if (!track) return;
    track.innerHTML = '';

    listings.forEach(l => {
        const thumb   = imgMap[l.id] || null;
        const avail   = l.availability_status || 'available';
        const isVeh   = l.category_slug === 'vehicle';
        const catLbl  = isVeh ? 'Vehicle' : 'Real Estate';
        const catIcon = isVeh ? 'fa-car' : 'fa-house';
        const unit        = isVeh ? '/day' : '/night';
        const dp          = l.price_display || l.price;
        const price       = Number(dp).toLocaleString();
        const promoPrice  = l.promo_discount ? Number(l.promo_price).toLocaleString() : null;
        const loc         = [dtMap[l.district_id], pvMap[l.province_id]].filter(Boolean).join(', ') || 'Rwanda';

        const imgHtml = thumb
            ? '<img src="' + esc(thumb) + '" alt="' + esc(l.title) + '" loading="lazy" ' +
              'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
              '<div class="card-no-img" style="display:none;"><i class="fa-solid fa-image" style="font-size:44px;color:#ddd;"></i></div>'
            : '<div class="card-no-img"><i class="fa-solid fa-image" style="font-size:44px;color:#ddd;"></i></div>';

        const card = document.createElement('a');
        card.className = 'property-card';
        card.href = '/Listings/Detail/?id=' + l.id;

        card.innerHTML =
            '<div class="card-image">' +
                imgHtml +
                '<div class="cat-label">' + catLbl + '</div>' +
                '<div class="card-heart" data-lid="' + l.id + '" onclick="event.preventDefault();event.stopPropagation();window.toggleFavorite(event,this,\'' + l.id + '\')"><i class="fa-regular fa-heart"></i></div>' +
                (avail !== 'available' ? '<div class="avail-strip ' + avail + '">&#9679; ' + avail + '</div>' : '') +
            '</div>' +
            '<div class="card-content">' +
                '<h3>' + esc(l.title) + '</h3>' +
                '<div class="card-location"><i class="fa-solid fa-location-dot"></i><span>' + esc(loc) + '</span></div>' +
                '<div class="card-features">' +
                    '<div class="feature"><i class="fa-solid ' + catIcon + '"></i><span>' + catLbl + '</span></div>' +
                    (avail !== 'available' ? '<div class="feature"><i class="fa-solid fa-circle-xmark" style="color:#e74c3c"></i><span>' + avail + '</span></div>' : '') +
                '</div>' +
                '<div class="card-footer">' +
                    (promoPrice
                        ? '<div class="card-price">' +
                          '<span class="promo-original">' + price + ' <span style="font-size:11px;">' + (l.currency||'RWF') + unit + '</span></span>' +
                          '<span class="promo-new-price">' + promoPrice + ' <span style="font-size:12px;font-weight:500;">' + (l.currency||'RWF') + unit + '</span></span>' +
                          '<span class="promo-badge">Promo</span>' +
                          '</div>'
                        : '<div class="card-price">' + price + ' <span>' + (l.currency || 'RWF') + unit + '</span></div>') +
                    '<button class="details-btn" onclick="event.preventDefault();event.stopPropagation();window.location.href=\'/Listings/Detail/?id=' + l.id + '\'">View Details</button>' +
                '</div>' +
            '</div>';

        track.appendChild(card);
    });

    initCarousel();

    if (window.refreshFavHearts) window.refreshFavHearts();
    if (window.refreshScrollAnimations) window.refreshScrollAnimations();
}

function renderFallback() {
    const track = document.getElementById('carouselTrack');
    if (track) track.innerHTML =
        '<div style="padding:48px;text-align:center;color:#999;width:100%;">' +
        '<i class="fa-solid fa-house-circle-exclamation" style="font-size:40px;color:#EB6753;margin-bottom:12px;display:block;"></i>' +
        '<p style="margin-bottom:10px;">No featured listings available right now.</p>' +
        '<a href="/Listings/" style="color:#EB6753;font-weight:600;text-decoration:none;">Browse all listings →</a></div>';
}

/* ── CAROUSEL ── */
function initCarousel() {
    let current = 0;
    const track = document.getElementById('carouselTrack');
    const prevBtn = document.querySelector('.prev-btn');
    const nextBtn = document.querySelector('.next-btn');
    function visible() { const w = window.innerWidth; return w >= 1024 ? 3 : w >= 768 ? 2 : 1; }
    function getCardWidth() {
        const cards = track.querySelectorAll('.property-card');
        if (!cards.length) return 0;
        // Prefer getBoundingClientRect for accurate post-layout width
        const rect = cards[0].getBoundingClientRect();
        return rect.width || cards[0].offsetWidth;
    }
    window.slideCarousel = function(dir) {
        const cards = track.querySelectorAll('.property-card');
        if (!cards.length) return;
        const max = Math.max(0, cards.length - visible());
        current = Math.min(Math.max(current + dir, 0), max);
        const gap = parseInt(getComputedStyle(track).gap) || 25;
        const cardW = getCardWidth();
        const offset = cardW > 0 ? current * (cardW + gap) : 0;
        requestAnimationFrame(() => {
            track.style.webkitTransform = 'translateX(-' + offset + 'px)';
            track.style.transform = 'translateX(-' + offset + 'px)';
        });
        if (prevBtn) prevBtn.disabled = current === 0;
        if (nextBtn) nextBtn.disabled = current >= max;
    };
    // Initialize after layout settles (cards may have offsetWidth=0 immediately after append)
    requestAnimationFrame(() => window.slideCarousel(0));
    window.addEventListener('resize', () => { current = 0; requestAnimationFrame(() => window.slideCarousel(0)); });
    let tx = 0;
    track.addEventListener('touchstart', e => { tx = e.changedTouches[0].screenX; }, { passive: true });
    track.addEventListener('touchend', e => { const d = tx - e.changedTouches[0].screenX; if (Math.abs(d) > 50) slideCarousel(d > 0 ? 1 : -1); });
}

function esc(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
