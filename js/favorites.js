/**
 * FAVORITES PAGE — favorites.js  →  /js/favorites.js
 *
 * - Auth guard: redirects to /Auth if not logged in
 * - Fetches favorites table joined with listings + images + owner profile
 * - Storage fallback for images (listing_images/{listing_id}/file)
 * - Unfavorite button removes row and animates card out
 */

const STORAGE_BASE = 'https://xuxzeinufjpplxkerlsd.supabase.co/storage/v1/object/public/listing_images';

let _sb = null;
let _user = null;

document.addEventListener('DOMContentLoaded', async () => {
    _sb = window.supabaseClient;
    if (!_sb) { console.error('❌ [FAV] Supabase client missing'); return; }

    // ── Auth guard ──
    const { data: { user } } = await _sb.auth.getUser();
    if (!user) {
        console.log('🔒 [FAV] Not logged in → redirecting to /Auth');
        window.location.href = '/Auth?next=/Favorites';
        return;
    }
    _user = user;
    console.log('✅ [FAV] Logged in:', user.email);

    // Update nav
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) {
        const _role = localStorage.getItem('afriStay_role');
        const _dashHref = _role === 'admin' ? '/Dashboards/Admin/' : _role === 'owner' ? '/Dashboards/Owner/' : '/Dashboards/Profile/';
        authBtn.outerHTML =
            '<div style="display:flex;align-items:center;gap:12px;">' +
                '<a href="' + _dashHref + '" class="signin-btn" style="background:#EB6753;">Dashboard</a>' +
                '<a href="/Dashboards/Profile/" class="icon-link" title="Profile">' +
                    '<i class="fa-solid fa-circle-user" style="font-size:22px;color:#EB6753;"></i>' +
                '</a>' +
            '</div>';
    }

    showSkeletons(3);
    await loadFavorites(0);
});

const FAV_PAGE_SIZE = 15;

/* ── LOAD FAVORITES ── */
async function loadFavorites(page = 0) {
    console.log('❤️ [FAV] Fetching favorites page', page);

    const start = page * FAV_PAGE_SIZE, end = start + FAV_PAGE_SIZE - 1;

    // 1. Get paginated favorite rows for this user
    const { data: favRows, error: favErr, count: favCount } = await _sb
        .from('favorites')
        .select('id, listing_id, created_at', { count: 'exact' })
        .eq('user_id', _user.id)
        .order('created_at', { ascending: false })
        .range(start, end);

    if (favErr) {
        console.error('❌ [FAV] Error fetching favorites:', favErr.message);
        showError('Could not load your favorites. ' + favErr.message);
        return;
    }

    if (!favRows || favRows.length === 0) {
        showEmpty();
        return;
    }

    const listingIds = favRows.map(f => f.listing_id);
    console.log('📋 [FAV] Found', favRows.length, 'favorites');

    // 2. Fetch listing details
    const { data: listings, error: listErr } = await _sb
        .from('listings')
        .select('id, title, price, price_display, price_outside_kigali_display, currency, availability_status, category_slug, address, province_id, district_id, owner_id')
        .in('id', listingIds);

    if (listErr) { console.error('❌ [FAV] Listings error:', listErr.message); showError(listErr.message); return; }

    // 3. Fetch images from table
    const imgMap = await resolveImages(listingIds);

    // 4. Fetch province + district names
    const pvIds = [...new Set(listings.map(l => l.province_id).filter(Boolean))];
    const dtIds = [...new Set(listings.map(l => l.district_id).filter(Boolean))];
    const pvMap = {}, dtMap = {};
    if (pvIds.length) {
        const { data: ps } = await _sb.from('provinces').select('id,name').in('id', pvIds);
        (ps || []).forEach(p => pvMap[p.id] = p.name);
    }
    if (dtIds.length) {
        const { data: ds } = await _sb.from('districts').select('id,name').in('id', dtIds);
        (ds || []).forEach(d => dtMap[d.id] = d.name);
    }

    // 5. Fetch owner profiles (full_name + email)
    const ownerIds = [...new Set(listings.map(l => l.owner_id).filter(Boolean))];
    const ownerMap = {};
    if (ownerIds.length) {
        const { data: owners } = await _sb
            .from('profiles')
            .select('id, full_name, email, phone')
            .in('id', ownerIds);
        (owners || []).forEach(o => ownerMap[o.id] = o);
    }

    // 6. Build a lookup of listing by id
    const listingMap = {};
    (listings || []).forEach(l => listingMap[l.id] = l);

    // Update count badge
    const countEl = document.getElementById('favCount');
    if (countEl) { countEl.textContent = favCount || favRows.length; countEl.style.display = 'inline'; }

    // 7. Render — in the order favorites were saved
    const container = document.getElementById('favList');
    container.innerHTML = '';

    favRows.forEach(fav => {
        const l = listingMap[fav.listing_id];
        if (!l) return; // listing may have been deleted

        const thumb   = imgMap[l.id] || null;
        const avail   = l.availability_status || 'available';
        const isVeh   = l.category_slug === 'vehicle';
        const catLbl  = isVeh ? 'Vehicle' : 'Real Estate';
        const catIcon = isVeh ? 'fa-car' : 'fa-house';
        const unit    = isVeh ? '/day' : '/night';
        const price   = Number(l.price_display || l.price).toLocaleString('en-RW');
        const loc     = [dtMap[l.district_id], pvMap[l.province_id]].filter(Boolean).join(', ') || l.address || 'Rwanda';
        const owner   = ownerMap[l.owner_id] || null;
        const savedAt = new Date(fav.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const detailUrl = '/Listings/Detail/?id=' + l.id;

        const card = document.createElement('div');
        card.className = 'fav-card';
        card.id = 'fav-card-' + fav.id;

        card.innerHTML =
            // ── Image ──
            '<div class="fav-img">' +
                (thumb
                    ? '<img src="' + esc(thumb) + '" alt="' + esc(l.title) + '" loading="lazy" ' +
                      'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
                      '<div class="no-img" style="display:none;"><i class="fa-solid fa-image" style="font-size:36px;color:#ccc;"></i></div>'
                    : '<div class="no-img"><i class="fa-solid fa-image" style="font-size:36px;color:#ccc;"></i></div>'
                ) +
                '<div class="avail-badge ' + avail + '">' +
                    '&#9679; ' + (avail === 'available' ? 'Available' : avail === 'booked' ? 'Booked' : 'Unavailable') +
                '</div>' +
            '</div>' +

            // ── Content ──
            '<div class="fav-content">' +
                '<div class="fav-top">' +
                    '<div style="min-width:0;">' +
                        '<div class="fav-title">' + esc(l.title) + '</div>' +
                        '<div class="fav-location">' +
                            '<i class="fa-solid fa-location-dot"></i>' +
                            '<span>' + esc(loc) + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="fav-cat"><i class="fa-solid ' + catIcon + '"></i>' + catLbl + '</div>' +
                '</div>' +

                '<div class="fav-middle">' +
                    '<div class="fav-price">' + price + ' <span>' + (l.currency || 'RWF') + unit + '</span></div>' +
                    (owner ?
                        '<div class="owner-info">' +
                            '<div class="owner-name"><i class="fa-solid fa-user"></i>' + esc(owner.full_name || 'Owner') + '</div>' +
                            (owner.email ?
                                '<div class="owner-contact"><i class="fa-solid fa-envelope"></i>' +
                                '<a href="mailto:' + esc(owner.email) + '" onclick="event.stopPropagation()">' + esc(owner.email) + '</a></div>'
                            : '') +
                            (owner.phone ?
                                '<div class="owner-contact"><i class="fa-solid fa-phone"></i>' +
                                '<a href="tel:' + esc(owner.phone) + '" onclick="event.stopPropagation()">' + esc(owner.phone) + '</a></div>'
                            : '') +
                        '</div>'
                    : '') +
                '</div>' +

                '<div class="fav-bottom">' +
                    '<div class="fav-saved-at"><i class="fa-regular fa-clock"></i> Saved ' + savedAt + '</div>' +
                    '<button class="unfav-btn" id="unfav-' + fav.id + '"' +
                        ' onclick="removeFavorite(event,\'' + fav.id + '\',\'' + l.id + '\')">' +
                        '<i class="fa-solid fa-heart-crack"></i> Remove' +
                    '</button>' +
                '</div>' +
            '</div>';

        // Clicking the card (not the button) goes to detail page
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.unfav-btn') && !e.target.closest('a')) {
                window.location.href = detailUrl;
            }
        });

        container.appendChild(card);
    });

    if (window.renderPagination && favCount) {
        const pageCount = Math.ceil(favCount / FAV_PAGE_SIZE);
        renderPagination('favPagination', page, pageCount, favCount, FAV_PAGE_SIZE, (p) => loadFavorites(p));
    }

    console.log('✅ [FAV] Favorites rendered:', favRows.length);
}

/* ── REMOVE FAVORITE ── */
window.removeFavorite = async function(e, favId, listingId) {
    e.stopPropagation();

    const btn = document.getElementById('unfav-' + favId);
    if (btn) { btn.classList.add('removing'); btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Removing...'; }

    const { error } = await _sb
        .from('favorites')
        .delete()
        .eq('id', favId)
        .eq('user_id', _user.id);

    if (error) {
        console.error('❌ [FAV] Remove error:', error.message);
        showToast('Failed to remove: ' + error.message, 'error');
        if (btn) { btn.classList.remove('removing'); btn.innerHTML = '<i class="fa-solid fa-heart-crack"></i> Remove'; }
        return;
    }

    // Animate card out
    const card = document.getElementById('fav-card-' + favId);
    if (card) {
        card.style.transition = 'opacity 0.3s, transform 0.3s, max-height 0.4s 0.25s, margin 0.4s 0.25s, padding 0.4s 0.25s';
        card.style.opacity = '0';
        card.style.transform = 'translateX(30px)';
        card.style.maxHeight = card.offsetHeight + 'px';
        setTimeout(() => {
            card.style.maxHeight = '0';
            card.style.margin = '0';
            card.style.padding = '0';
            card.style.overflow = 'hidden';
        }, 280);
        setTimeout(() => card.remove(), 700);
    }

    showToast('Removed from favorites.', 'success');
    console.log('✅ [FAV] Removed favorite:', favId);

    // Update count badge
    const countEl = document.getElementById('favCount');
    if (countEl) {
        const cur = parseInt(countEl.textContent) - 1;
        if (cur <= 0) {
            setTimeout(showEmpty, 750);
        } else {
            countEl.textContent = cur;
        }
    }
};

/* ── IMAGE RESOLVER (table → storage fallback) ── */
async function resolveImages(ids) {
    const imgMap = {};

    const { data: rows } = await _sb
        .from('listing_images')
        .select('listing_id, image_url')
        .in('listing_id', ids);

    (rows || []).forEach(r => {
        if (!imgMap[r.listing_id] && r.image_url) imgMap[r.listing_id] = r.image_url;
    });

    console.log('🗄️ [FAV] Table images:', Object.keys(imgMap).length + '/' + ids.length);

    // Storage fallback for any listing with no table row
    const missing = ids.filter(id => !imgMap[id]);
    if (missing.length) {
        await Promise.all(missing.map(async (id) => {
            try {
                const { data: files } = await _sb.storage.from('listing_images').list(id, { limit: 1 });
                const file = (files || []).find(f => f.name && !f.id?.endsWith('/'));
                if (file) {
                    imgMap[id] = STORAGE_BASE + '/' + id + '/' + file.name;
                    console.log('📦 [FAV] Storage img for', id + ':', file.name);
                }
            } catch(e) {}
        }));
    }

    return imgMap;
}

/* ── UI STATES ── */
function showSkeletons(n) {
    const container = document.getElementById('favList');
    container.innerHTML = Array(n).fill(
        '<div class="skel-card">' +
            '<div style="width:260px;min-width:260px;" class="skeleton"></div>' +
            '<div style="flex:1;padding:20px 24px;display:flex;flex-direction:column;gap:14px;">' +
                '<div class="skeleton" style="height:20px;width:65%;"></div>' +
                '<div class="skeleton" style="height:13px;width:40%;"></div>' +
                '<div class="skeleton" style="height:28px;width:30%;"></div>' +
                '<div class="skeleton" style="height:13px;width:55%;margin-top:auto;"></div>' +
            '</div>' +
        '</div>'
    ).join('');
}

function showEmpty() {
    const countEl = document.getElementById('favCount');
    if (countEl) countEl.style.display = 'none';

    document.getElementById('favList').innerHTML =
        '<div class="empty-state">' +
            '<i class="fa-regular fa-heart"></i>' +
            '<h3>No favorites yet</h3>' +
            '<p>Save listings you love and they\'ll appear here.</p>' +
            '<a href="/Listings/"><i class="fa-solid fa-magnifying-glass"></i> Browse Listings</a>' +
        '</div>';
}

function showError(msg) {
    document.getElementById('favList').innerHTML =
        '<div class="empty-state">' +
            '<i class="fa-solid fa-triangle-exclamation" style="color:#e74c3c;"></i>' +
            '<h3>Something went wrong</h3>' +
            '<p>' + esc(msg) + '</p>' +
            '<a href="/Listings/"><i class="fa-solid fa-arrow-left"></i> Back to Listings</a>' +
        '</div>';
}

/* ── TOAST ── */
function showToast(message, type) {
    const colors = { success: '#2ecc71', error: '#e74c3c', info: '#3498db', warning: '#f39c12' };
    const icons  = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
    const box = document.getElementById('toastBox');
    const t = document.createElement('div');
    t.className = 'toast-item';
    t.style.background = colors[type] || colors.info;
    t.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.info) + '"></i> ' + message;
    box.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

/* ── HELPER ── */
function esc(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}