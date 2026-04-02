/* ─────────────────────────────────────────
   GLOBAL NAVIGATION & AUTH STATE
   ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
    await initGlobalNav();
});

async function initGlobalNav() {
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;

    // Ensure heart is always present — add it if the static HTML somehow lost it
    if (!navRight.querySelector('.nav-heart')) {
        const heart = document.createElement('a');
        heart.href = '/Favorites';
        heart.className = 'icon-link nav-heart';
        heart.title = 'Favorites';
        heart.innerHTML = '<i class="fa-regular fa-heart"></i>';
        navRight.insertBefore(heart, navRight.firstChild);
    }

    // Update only the auth button part (never touch the heart)
    function _setAuthBtn(html) {
        const existing = navRight.querySelector('#auth-btn, .nav-auth-btn');
        if (existing) {
            existing.outerHTML = html;
        } else {
            // auth-btn was already replaced (e.g. by page-specific code) — append
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            navRight.appendChild(tmp.firstElementChild);
        }
    }

    const cachedRole = localStorage.getItem('afriStay_role');
    if (cachedRole) {
        const profileLink = cachedRole === 'admin' ? '/Dashboards/Admin/' : cachedRole === 'owner' ? '/Dashboards/Owner/' : '/Dashboards/Profile/';
        _setAuthBtn(`<a href="${profileLink}" class="icon-link nav-auth-btn" title="${cachedRole === 'user' ? 'Profile' : 'Dashboard'}"><i class="fa-solid fa-circle-user" style="font-size:24px;margin-left:10px;"></i></a>`);
    }

    const client = window.supabaseClient;
    if (!client) return;
    try {
        const { data: { user } } = await client.auth.getUser();
        if (!user) {
            localStorage.removeItem('afriStay_role');
            localStorage.removeItem('afriStay_firstName');
            _setAuthBtn(`<a href="/Auth" id="auth-btn" class="signin-btn nav-auth-btn">Sign In</a>`);
        }
    } catch (_) { /* keep current state */ }
}

// Heart click interception — logged-out users get a toast + redirect
document.addEventListener('click', function(e) {
    const heart = e.target.closest('.nav-heart');
    if (!heart) return;
    if (localStorage.getItem('afriStay_role')) return; // logged in — let link work
    e.preventDefault();
    // Show inline toast
    let toast = document.getElementById('_navFavToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = '_navFavToast';
        toast.style.cssText = 'position:fixed;top:76px;right:20px;z-index:9999;background:#1a1a1a;color:#fff;padding:12px 18px;border-radius:12px;font-size:14px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,.25);display:flex;align-items:center;gap:10px;transition:opacity .3s;';
        toast.innerHTML = '<i class="fa-solid fa-heart" style="color:#EB6753;"></i> <span>Sign in to save listings to favorites</span> <a href="/Auth?redirect=favorites" style="color:#EB6753;font-weight:700;text-decoration:none;margin-left:4px;">Sign In →</a>';
        document.body.appendChild(toast);
    }
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
});

window.toggleMenu = function() {
    const navWrapper = document.getElementById("navWrapper");
    if (navWrapper) navWrapper.classList.toggle("active");
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof initAuthUI === 'function') initAuthUI();
});

/* ─────────────────────────────────────────
   SHARED LISTING CARD GENERATOR
   ───────────────────────────────────────── */
function generateListingCard(listing, locationName) {
    const thumb    = listing.final_thumb_url;
    const avail    = listing.availability_status || 'available';
    const isVeh    = listing.category_slug === 'vehicle';
    const catLbl   = isVeh ? 'Vehicle' : 'Real Estate';
    const catIcon  = isVeh ? 'fa-car' : 'fa-house';
    const unit     = isVeh ? '/day' : '/night';
    const dp       = listing.price_display || listing.price;
    const price    = Number(dp).toLocaleString();
    const currency = listing.currency || 'RWF';

    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    return `
        <a href="/Listings/Detail/?id=${listing.id}" class="property-card">
            <div class="card-image">
                ${thumb
                    ? `<img src="${esc(thumb)}" alt="${esc(listing.title)}" loading="lazy">`
                    : `<div class="card-no-img"><i class="fa-solid fa-image" style="font-size:44px;color:#ddd;"></i></div>`
                }
                <div class="cat-label">${catLbl}</div>
                <div class="card-heart" data-lid="${listing.id}"
                     onclick="event.preventDefault();event.stopPropagation();window.toggleFavorite(event,this,'${listing.id}')">
                    <i class="fa-regular fa-heart"></i>
                </div>
                <div class="avail-strip ${avail}">${avail === 'available' ? '&#9679; Available' : '&#9679; ' + avail}</div>
            </div>
            <div class="card-content">
                <h3>${esc(listing.title)}</h3>
                <div class="card-location"><i class="fa-solid fa-location-dot"></i><span>${esc(locationName)}</span></div>
                <div class="card-features">
                    <div class="feature"><i class="fa-solid ${catIcon}"></i><span>${catLbl}</span></div>
                    <div class="feature"><i class="fa-solid fa-circle-check" style="color:#2ecc71"></i><span>${avail}</span></div>
                </div>
                <div class="card-footer">
                    ${listing.promo_discount
                        ? '<div class="card-price">' +
                          '<span class="promo-original">' + (currency === 'RWF' ? '' : currency + ' ') + price + ' <span style="font-size:11px;">' + (currency === 'RWF' ? 'RWF' : '') + unit + '</span></span>' +
                          '<span class="promo-badge">Promo</span><br>' +
                          (currency === 'RWF' ? '' : currency + ' ') + Number(listing.promo_price).toLocaleString() + ' <span>' + (currency === 'RWF' ? 'RWF' : '') + unit + '</span>' +
                          '</div>'
                        : '<div class="card-price">' + (currency === 'RWF' ? '' : currency + ' ') + price + ' <span>' + (currency === 'RWF' ? 'RWF' : '') + unit + '</span></div>'
                    }
                    <button class="details-btn" onclick="event.preventDefault();window.location.href='/Listings/Detail/?id=${listing.id}'">View Details</button>
                </div>
            </div>
        </a>
    `;
}

/* ─────────────────────────────────────────
   SHARED LISTING FETCH + RENDER ENGINE
   ───────────────────────────────────────── */

/* ─── Lightweight location name cache (5 min TTL) ─── */
const _locCache = { _s: {}, _t: {},
    set(k,v){ this._s[k]=v; this._t[k]=Date.now()+300000; },
    get(k){ if(!this._s[k]||Date.now()>this._t[k]){delete this._s[k];return null;} return this._s[k]; }
};
async function _cacheLocNames(sb, pvIds, dtIds) {
    const pvMap = {}, dtMap = {};
    const pvMiss = pvIds.filter(id => !_locCache.get('pv_'+id));
    const dtMiss = dtIds.filter(id => !_locCache.get('dt_'+id));
    if (pvMiss.length) { const {data:ps}=await sb.from('provinces').select('id,name').in('id',pvMiss); (ps||[]).forEach(p=>{_locCache.set('pv_'+p.id,p.name);}); }
    if (dtMiss.length) { const {data:ds}=await sb.from('districts').select('id,name').in('id',dtMiss); (ds||[]).forEach(d=>{_locCache.set('dt_'+d.id,d.name);}); }
    pvIds.forEach(id=>pvMap[id]=_locCache.get('pv_'+id)||'');
    dtIds.forEach(id=>dtMap[id]=_locCache.get('dt_'+id)||'');
    return { pvMap, dtMap };
}

/* ─── Merge active promotions into listing objects ─── */
async function applyActivePromos(sb, listings) {
    if (!listings || !listings.length) return;
    const ids   = listings.map(l => l.id);
    const today = new Date().toISOString().slice(0, 10);
    const { data: promos } = await sb
        .from('promotions')
        .select('listing_id, discount')
        .in('listing_id', ids)
        .lte('start_date', today)
        .gte('end_date', today);
    if (!promos || !promos.length) return;
    const promoMap = {};
    promos.forEach(p => { promoMap[p.listing_id] = p.discount; });
    listings.forEach(l => {
        const disc = promoMap[l.id];
        if (disc) {
            const dp = l.price_display || l.price;
            l.promo_discount = disc;
            l.promo_price    = Math.round(dp * (1 - disc / 100));
        }
    });
}
window.applyActivePromos = applyActivePromos;

window.fetchAndRenderSharedListings = async function(options) {
    const sb        = window.supabaseClient;
    const container = document.getElementById(options.containerId);
    if (!container) return;

    // Show loading state immediately
    if (window.showAfriLoading) showAfriLoading(container);
    else container.innerHTML = '<div class="afri-loading"><div class="afri-loading-logo">Loading</div></div>';

    const PAGE_SIZE = options.pageSize || 15;
    const page      = options.page || 0;
    const start     = page * PAGE_SIZE;
    const end       = start + PAGE_SIZE - 1;

    let q = sb.from('listings')
        .select(`id, title, price, price_display, price_outside_kigali_display, currency, availability_status, status,
                 category_slug, province_id, district_id, created_at, avg_rating, reviews_count,
                 listing_images ( image_url )`, { count: 'exact' })
        .eq('status', 'approved')
        .eq('availability_status', 'available');

    if (options.featuredOnly) q = q.eq('featured', true);
    if (options.qtext)        q = q.ilike('title', `%${options.qtext}%`);
    if (options.province)     q = q.eq('province_id', options.province);
    if (options.district)     q = q.eq('district_id', options.district);
    if (options.sector)       q = q.eq('sector_id', options.sector);
    if (options.category)     q = q.eq('category_slug', options.category);
    if (options.amenity)      q = q.contains('amenities_data', [options.amenity]);
    q = q.order('created_at', { ascending: false });

    if (!options.featuredOnly && !options.limit) {
        q = q.range(start, end);
    } else if (options.limit) {
        q = q.limit(options.limit);
    }

    const { data: listings, error, count } = await q;

    if (error || !listings || !listings.length) {
        if (window.showEmptyResults) {
            showEmptyResults(container,
                error ? 'Could not load listings' : 'No listings found',
                error ? error.message : 'Try different filters or search terms.');
        } else {
            container.innerHTML = '<div class="empty-results"><i class="fa-solid fa-magnifying-glass"></i><h4>No listings found</h4><p>Try different filters or search terms.</p></div>';
        }
        if (options.onComplete) options.onComplete(0);
        return;
    }

    const pvIds = [...new Set(listings.map(l => l.province_id).filter(Boolean))];
    const dtIds = [...new Set(listings.map(l => l.district_id).filter(Boolean))];
    const [{ pvMap, dtMap }] = await Promise.all([
        _cacheLocNames(sb, pvIds, dtIds),
        applyActivePromos(sb, listings),
    ]);

    container.innerHTML = '';
    listings.forEach(l => {
        const rawUrl = l.listing_images?.[0]?.image_url;
        let finalImageUrl = rawUrl;
        if (rawUrl && !rawUrl.startsWith('http')) {
            const { data: pub } = sb.storage.from('listing_images').getPublicUrl(rawUrl);
            finalImageUrl = pub.publicUrl;
        }
        l.final_thumb_url = finalImageUrl;
        if (!l.promo_discount) { l.promo_discount = null; l.promo_price = null; }
        const locName = [dtMap[l.district_id], pvMap[l.province_id]].filter(Boolean).join(', ') || 'Rwanda';
        container.innerHTML += generateListingCard(l, locName);
    });

    // Pagination (for listings page only, not featured carousel)
    if (!options.featuredOnly && !options.limit && options.paginationId && window.renderPagination) {
        const total = count || listings.length;
        const pageCount = Math.ceil(total / PAGE_SIZE);
        renderPagination(options.paginationId, page, pageCount, total, PAGE_SIZE, (newPage) => {
            fetchAndRenderSharedListings({ ...options, page: newPage });
            const grid = document.getElementById(options.containerId);
            if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    if (options.onComplete) options.onComplete(listings.length);
    // Refresh hearts after cards are in the DOM
    // Re-tag hearts and refresh state after cards render
    setTimeout(function() {
        console.log('🔄 [FAV] Re-tagging hearts after render...');
        document.querySelectorAll('.card-heart').forEach(function(btn) {
            var m = (btn.getAttribute('onclick') || '').match(/['"]([a-f0-9-]{36})['"]/i);
            if (m && !btn.dataset.lid) btn.dataset.lid = m[1];
        });
        refreshAllHearts();
        var found = document.querySelectorAll('.card-heart[data-lid]').length;
        console.log('✅ [FAV] Hearts refreshed, found:', found);
    }, 150);
};

/* ─────────────────────────────────────────
   FAVORITES
   ─────────────────────────────────────────
   Logged in  → reads/writes Supabase favorites table
   Logged out → saves to localStorage, shows sign-in toast
   On login   → auth.js calls syncPendingFavorites(userId)
                which flushes localStorage into Supabase
   ───────────────────────────────────────── */

// In-memory cache so we don't re-query Supabase on every click
var _favCache    = null;   // Set of listing IDs the user has saved
var _favRowIds   = {};     // { listingId: favoriteRowId } needed for DELETE
var _favUserId   = null;

// ── toast helper (works on every page, creates its own container) ──
function showFavToast(html, type) {
    var colors = { success: '#2ecc71', error: '#e74c3c', info: '#3b82f6', warning: '#f59e0b' };
    var box = document.getElementById('_favToastBox');
    if (!box) {
        box = document.createElement('div');
        box.id = '_favToastBox';
        box.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
        document.body.appendChild(box);
        var sty = document.createElement('style');
        sty.textContent = '@keyframes favPop{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';
        document.head.appendChild(sty);
    }
    var el = document.createElement('div');
    el.style.cssText = 'background:' + (colors[type] || colors.info) + ';color:#fff;padding:13px 18px;border-radius:12px;'
        + 'font-family:Inter,sans-serif;font-size:14px;font-weight:500;'
        + 'box-shadow:0 4px 24px rgba(0,0,0,0.22);display:flex;align-items:center;gap:9px;'
        + 'pointer-events:auto;max-width:320px;line-height:1.5;animation:favPop 0.25s ease;';
    el.innerHTML = html;
    box.appendChild(el);
    setTimeout(function() {
        el.style.transition = 'opacity 0.3s';
        el.style.opacity = '0';
        setTimeout(function() { el.remove(); }, 320);
    }, 3800);
}

// ── pending favorites in localStorage (for logged-out users) ──
function getPendingFavs()     { try { return JSON.parse(localStorage.getItem('afriStay_pendingFavs') || '[]'); } catch(e) { return []; } }
function setPendingFavs(arr)  { localStorage.setItem('afriStay_pendingFavs', JSON.stringify([...new Set(arr)])); }
function addPendingFav(id)    { setPendingFavs([...getPendingFavs(), id]); }
function removePendingFav(id) { setPendingFavs(getPendingFavs().filter(function(x){ return x !== id; })); }
function hasPendingFav(id)    { return getPendingFavs().includes(id); }

// ── load saved listing IDs from Supabase once per session ──
async function loadFavCache(sb, userId) {
    if (_favUserId === userId && _favCache !== null) return; // already loaded, skip
    _favCache  = new Set();
    _favRowIds = {};
    _favUserId = userId;
    var result = await sb.from('favorites').select('id, listing_id').eq('user_id', userId);
    var rows = result.data || [];
    rows.forEach(function(r) {
        _favCache.add(r.listing_id);
        _favRowIds[r.listing_id] = r.id;
    });
    console.log('❤️ [FAV] Loaded', _favCache.size, 'saved listings');
}

// ── set a heart button to filled or outline ──
function setHeartState(btn, saved) {
    if (!btn) return;
    var icon = btn.querySelector('i');
    if (saved) {
        btn.classList.add('faved');
        if (icon) icon.className = 'fa-solid fa-heart';
    } else {
        btn.classList.remove('faved');
        if (icon) icon.className = 'fa-regular fa-heart';
    }
}

// ── after cards render, mark hearts that are already saved ──
function refreshAllHearts() {
    document.querySelectorAll('.card-heart[data-lid]').forEach(function(btn) {
        var id    = btn.dataset.lid;
        var saved = (_favCache && _favCache.has(id)) || hasPendingFav(id);
        setHeartState(btn, saved);
    });
}

// ── on page load, load cache and mark hearts ──
async function initFavoriteHearts() {
    console.log('🚀 [FAV] initFavoriteHearts() called');
    var sb = window.supabaseClient;
    if (!sb) {
        console.error('❌ [FAV] initFavoriteHearts: no Supabase client');
        return;
    }
    var authResult = await sb.auth.getUser().catch(function() { return { data: {} }; });
    var user = authResult.data && authResult.data.user;
    console.log('👤 [FAV] init: user is', user ? user.email : 'NOT LOGGED IN');
    if (user) {
        await loadFavCache(sb, user.id);
        console.log('📦 [FAV] init: cache has', _favCache.size, 'saved listings');
    } else {
        console.log('💾 [FAV] init: checking localStorage pending:', getPendingFavs());
    }
    refreshAllHearts();
    var hearts = document.querySelectorAll('.card-heart');
    console.log('❤️ [FAV] init: found', hearts.length, 'heart buttons on page');
    var tagged = document.querySelectorAll('.card-heart[data-lid]');
    console.log('🏷️ [FAV] init:', tagged.length, 'hearts have data-lid tag');
}

// expose so home.js and other pages can trigger a refresh after their own renders
window.refreshFavHearts = async function() {
    console.log('🔄 [FAV] Manual refreshFavHearts() called');
    // Tag any untagged hearts with data-lid from their onclick
    document.querySelectorAll('.card-heart').forEach(function(btn) {
        var m = (btn.getAttribute('onclick') || '').match(/['"]([a-f0-9-]{36})['"]/i);
        if (m && !btn.dataset.lid) btn.dataset.lid = m[1];
    });
    // If cache not loaded yet, load it now before refreshing hearts
    if (_favCache === null) {
        var sb = window.supabaseClient;
        if (sb) {
            try {
                var authResult = await sb.auth.getUser();
                var user = authResult.data && authResult.data.user;
                if (user) await loadFavCache(sb, user.id);
            } catch(e) { console.warn('[FAV] refreshFavHearts cache load failed:', e); }
        }
    }
    refreshAllHearts();
};

// run on page load — no delay so cache is ready before cards render
document.addEventListener('DOMContentLoaded', function() {
    initFavoriteHearts();
});

// ── THE MAIN TOGGLE — called by onclick on every card heart ──
window.toggleFavorite = async function(event, btnEl, listingId) {
    console.log('🖱️ [FAV] Heart clicked! listingId:', listingId);
    event.preventDefault();
    event.stopPropagation();

    // btnEl is passed explicitly via `this` in onclick — currentTarget is null in inline handlers
    var btn = btnEl || event.currentTarget;
    btn.dataset.lid = listingId;
    console.log('🔘 [FAV] Button found:', btn);

    var sb = window.supabaseClient;
    if (!sb) {
        console.error('❌ [FAV] No Supabase client! Is config.js loaded before script.js?');
        return;
    }
    console.log('✅ [FAV] Supabase client OK');

    var authResult = await sb.auth.getUser().catch(function(e) {
        console.error('❌ [FAV] getUser() threw:', e);
        return { data: {} };
    });
    var user = authResult.data && authResult.data.user;
    console.log('👤 [FAV] Current user:', user ? user.email : 'NOT LOGGED IN');

    // ══ NOT LOGGED IN ══
    if (!user) {
        console.log('💾 [FAV] Saving to localStorage (not logged in)');
        if (hasPendingFav(listingId)) {
            removePendingFav(listingId);
            setHeartState(btn, false);
            showFavToast('💔 Removed from saved.', 'info');
            console.log('🗑️ [FAV] Removed from localStorage');
        } else {
            addPendingFav(listingId);
            setHeartState(btn, true);
            var count = getPendingFavs().length;
            var label = count === 1 ? 'favorite' : count + ' favorites';
            showFavToast(
                '❤️ Saved! <a href="/Auth" style="color:#fff;font-weight:800;text-decoration:underline;margin-left:5px;">Sign in</a> to keep your ' + label + '.',
                'warning'
            );
            console.log('✅ [FAV] Saved to localStorage. Pending:', getPendingFavs());
        }
        return;
    }

    // ══ LOGGED IN ══
    console.log('🔄 [FAV] Loading Supabase favorites cache...');
    await loadFavCache(sb, user.id);
    console.log('📦 [FAV] Cache loaded. Saved listings:', [..._favCache]);

    if (_favCache.has(listingId)) {
        console.log('🗑️ [FAV] Already saved — deleting from Supabase. Row ID:', _favRowIds[listingId]);
        var favId = _favRowIds[listingId];
        var deleteResult = await sb.from('favorites').delete().eq('id', favId).eq('user_id', user.id);
        console.log('🔁 [FAV] Delete result:', deleteResult);
        if (deleteResult.error) {
            console.error('❌ [FAV] Delete failed:', deleteResult.error);
            showFavToast('❌ Could not remove: ' + deleteResult.error.message, 'error');
            return;
        }
        _favCache.delete(listingId);
        delete _favRowIds[listingId];
        setHeartState(btn, false);
        showFavToast('💔 Removed from favorites.', 'info');
        console.log('✅ [FAV] Removed from favorites');

    } else {
        console.log('➕ [FAV] Not saved yet — inserting into Supabase...');
        var insertResult = await sb.from('favorites').insert({ listing_id: listingId, user_id: user.id }).select('id').single();
        console.log('🔁 [FAV] Insert result:', insertResult);
        if (insertResult.error) {
            console.error('❌ [FAV] Insert failed:', insertResult.error);
            showFavToast('❌ Could not save: ' + insertResult.error.message, 'error');
            return;
        }
        _favCache.add(listingId);
        _favRowIds[listingId] = insertResult.data.id;
        setHeartState(btn, true);
        showFavToast('❤️ Added to favorites!', 'success');
        console.log('✅ [FAV] Saved to Supabase! Row ID:', insertResult.data.id);
    }
};

// ── called by auth.js right after login to flush localStorage → Supabase ──
window.syncPendingFavorites = async function(userId) {
    var pending = getPendingFavs();
    if (!pending.length) return;
    var sb = window.supabaseClient;
    if (!sb || !userId) return;
    console.log('🔄 [FAV] Syncing', pending.length, 'pending favorites...');
    var rows = pending.map(function(listing_id) { return { listing_id: listing_id, user_id: userId }; });
    var result = await sb.from('favorites').upsert(rows, { onConflict: 'user_id,listing_id', ignoreDuplicates: true });
    if (!result.error) {
        setPendingFavs([]);
        _favCache = null; // force reload next time
        console.log('✅ [FAV] Sync done');
    } else {
        console.error('❌ [FAV] Sync failed:', result.error.message);
    }
};