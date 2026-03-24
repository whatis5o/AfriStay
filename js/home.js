/**
 * HOME PAGE — home.js  →  /js/home.js
 */

document.addEventListener('DOMContentLoaded', async () => {
    console.log("🏠 [HOME] DOM ready — initializing featured listings...");
    await loadFeaturedListings();
    
});

/* ═══════════════════════════════════════════════
   IMAGE RESOLVER
   1. Try listing_images TABLE (fast, batch)
   2. For any listing still missing an image,
      list the Storage folder: listing_images/{id}/
      and build the public URL from the first file found
   ═══════════════════════════════════════════════ */
const STORAGE_BASE = 'https://xuxzeinufjpplxkerlsd.supabase.co/storage/v1/object/public/listing_images';

async function resolveImages(sb, ids) {
    const imgMap = {};

    // Step 1 — table lookup
    const { data: rows } = await sb
        .from('listing_images')
        .select('listing_id, image_url')
        .in('listing_id', ids);

    (rows || []).forEach(r => {
        if (!imgMap[r.listing_id] && r.image_url) imgMap[r.listing_id] = r.image_url;
    });

    console.log(`🗄️ [HOME] Table images found: ${Object.keys(imgMap).length}/${ids.length}`);

    // Step 2 — storage fallback for listings with no table row
    const missing = ids.filter(id => !imgMap[id]);
    if (missing.length) {
        console.log(`📦 [HOME] Checking storage for ${missing.length} listings with no table image...`);
        await Promise.all(missing.map(async (id) => {
            try {
                const { data: files, error } = await sb.storage
                    .from('listing_images')
                    .list(id, { limit: 1 });

                if (error) {
                    console.warn(`  ⚠️ [HOME] Storage list error for ${id}:`, error.message);
                    return;
                }

                const file = (files || []).find(f => f.name && !f.id?.endsWith('/'));
                if (file) {
                    imgMap[id] = `${STORAGE_BASE}/${id}/${file.name}`;
                    console.log(`  ✅ [HOME] Storage image found for ${id}: ${file.name}`);
                } else {
                    console.log(`  ℹ️ [HOME] No storage image for ${id}`);
                }
            } catch(e) {
                console.warn(`  ❌ [HOME] Storage error for ${id}:`, e.message);
            }
        }));
    }

    return imgMap;
}

/* ── FEATURED LISTINGS ── */
async function loadFeaturedListings() {
    const sb = window.supabaseClient;
    if (!sb) { renderFallback(); return; }

    const { data: listings, error } = await sb
        .from('listings')
        .select('id, title, price, currency, availability_status, category_slug, province_id, district_id, created_at')
        .eq('featured', true)
        .eq('status', 'approved')
        .eq('availability_status', 'available')
        .order('created_at', { ascending: false })
        .limit(6);

    if (error || !listings?.length) {
        console.warn('⚠️ [HOME] No featured listings:', error?.message || 'empty');
        renderFallback();
        return;
    }
    console.log(`✅ [HOME] ${listings.length} featured listings`);

    const ids = listings.map(l => l.id);

    // Resolve images (table → storage fallback)
    const imgMap = await resolveImages(sb, ids);

    // Batch district + province names
    const pvIds = [...new Set(listings.map(l => l.province_id).filter(Boolean))];
    const dtIds = [...new Set(listings.map(l => l.district_id).filter(Boolean))];
    const pvMap = {}, dtMap = {};
    if (pvIds.length) { const { data: ps } = await sb.from('provinces').select('id,name').in('id', pvIds); (ps||[]).forEach(p => pvMap[p.id] = p.name); }
    if (dtIds.length) { const { data: ds } = await sb.from('districts').select('id,name').in('id', dtIds); (ds||[]).forEach(d => dtMap[d.id] = d.name); }

    renderCards(listings, imgMap, dtMap, pvMap);
}

/* ── RENDER CARDS — identical structure to Listings page ── */
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
        const unit    = isVeh ? '/day' : '/night';
        const price   = Number(l.price).toLocaleString();
        const loc     = [dtMap[l.district_id], pvMap[l.province_id]].filter(Boolean).join(', ') || 'Rwanda';

        console.log(`  🃏 [HOME] "${l.title}" | loc: ${loc} | img: ${thumb ? '✅' : '❌'}`);

        const imgHtml = thumb
            ? '<img src="' + esc(thumb) + '" alt="' + esc(l.title) + '" loading="eager" ' +
              'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
              '<div class="card-no-img" style="display:none;"><i class="fa-solid fa-image" style="font-size:44px;color:#ddd;"></i></div>'
            : '<div class="card-no-img"><i class="fa-solid fa-image" style="font-size:44px;color:#ddd;"></i></div>';

        const card = document.createElement('a');
        card.className = 'property-card';
        card.href = '/Detail/?id=' + l.id;

        card.innerHTML =
            '<div class="card-image">' +
                imgHtml +
                '<div class="cat-label">' + catLbl + '</div>' +
                '<div class="card-heart" data-lid="' + l.id + '" onclick="event.preventDefault();event.stopPropagation();window.toggleFavorite(event,this,\'' + l.id + '\')"><i class="fa-regular fa-heart"></i></div>' +
                '<div class="avail-strip ' + avail + '">' + (avail === 'available' ? '&#9679; Available' : '&#9679; ' + avail) + '</div>' +
            '</div>' +
            '<div class="card-content">' +
                '<h3>' + esc(l.title) + '</h3>' +
                '<div class="card-location"><i class="fa-solid fa-location-dot"></i><span>' + esc(loc) + '</span></div>' +
                '<div class="card-features">' +
                    '<div class="feature"><i class="fa-solid ' + catIcon + '"></i><span>' + catLbl + '</span></div>' +
                    '<div class="feature"><i class="fa-solid fa-circle-check" style="color:#2ecc71"></i><span>' + avail + '</span></div>' +
                '</div>' +
                '<div class="card-footer">' +
                    '<div class="card-price">' + price + ' <span>' + (l.currency || 'RWF') + unit + '</span></div>' +
                    '<button class="details-btn" onclick="event.preventDefault();event.stopPropagation();window.location.href=\'/Detail/?id=' + l.id + '\'">View Details</button>' +
                '</div>' +
            '</div>';

        track.appendChild(card);
    });

    initCarousel();
    console.log('✅ [HOME] All cards rendered');

    // Refresh heart states now that cards are in the DOM
    if (window.refreshFavHearts) window.refreshFavHearts();
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
    window.slideCarousel = function(dir) {
        const cards = track.querySelectorAll('.property-card');
        if (!cards.length) return;
        const max = Math.max(0, cards.length - visible());
        current = Math.min(Math.max(current + dir, 0), max);
        const gap = parseInt(getComputedStyle(track).gap) || 25;
        const offset = current * (cards[0].offsetWidth + gap);
        // Use requestAnimationFrame for smooth iOS animation
        requestAnimationFrame(() => {
            track.style.webkitTransform = 'translateX(-' + offset + 'px)';
            track.style.transform = 'translateX(-' + offset + 'px)';
        });
        if (prevBtn) prevBtn.disabled = current === 0;
        if (nextBtn) nextBtn.disabled = current >= max;
    };
    window.addEventListener('resize', () => { current = 0; track.style.transform = 'translateX(0)'; });
    let tx = 0;
    track.addEventListener('touchstart', e => { tx = e.changedTouches[0].screenX; }, { passive: true });
    track.addEventListener('touchend', e => { const d = tx - e.changedTouches[0].screenX; if (Math.abs(d) > 50) slideCarousel(d > 0 ? 1 : -1); });
}

function esc(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}