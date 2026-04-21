/**
 * FAVORITES UTILITY  →  /js/favorites_util.js
 * Include this on every page that shows listing cards.
 * Provides: initFavorites(), toggleHeart()
 *
 * Heart states:
 *   • Not favorited  → fa-regular fa-heart (outline, orange border)
 *   • Favorited      → fa-solid fa-heart   (filled orange)
 *   • Hover (either) → fa-solid fa-heart   (filled orange)
 */

(function () {
    const SB = () => window.supabaseClient;

    // Map of listingId → favRowId (null = not favorited)
    let _favMap = {};
    let _user   = null;
    let _ready  = false;

    /* ─────────────────────────────────────────
       INIT — call once per page after auth check
    ───────────────────────────────────────── */
    window.initFavorites = async function (user) {
        _user = user || null;
        if (!_user || !SB()) { _ready = true; return; }

        const ids = _collectListingIds();
        if (!ids.length) { _ready = true; return; }

        const { data } = await SB()
            .from('favorites')
            .select('id, listing_id')
            .eq('user_id', _user.id)
            .in('listing_id', ids);

        _favMap = {};
        (data || []).forEach(f => { _favMap[f.listing_id] = f.id; });
        _ready = true;

        // Mark hearts that are already favorited
        _syncAllHearts();
        console.log(' [FAV] Loaded', Object.keys(_favMap).length, 'favorites');
    };

    /* ─────────────────────────────────────────
       TOGGLE — called by onclick on heart icon
    ───────────────────────────────────────── */
    window.toggleHeart = window.toggleFavorite = async function (e, listingId) {
        e.stopPropagation();
        e.preventDefault();

        if (!_user) {
            // Redirect to auth, come back here
            window.location.href = '/Auth?next=' + encodeURIComponent(window.location.pathname + window.location.search);
            return;
        }

        const icon = _iconFor(listingId);
        if (!icon) return;

        const isFaved = _favMap.hasOwnProperty(listingId);

        // Optimistic UI update
        _setHeart(icon, !isFaved);

        if (isFaved) {
            // Remove from favorites
            const favId = _favMap[listingId];
            const { error } = await SB().from('favorites').delete().eq('id', favId).eq('user_id', _user.id);
            if (error) {
                console.error(' [FAV] Remove error:', error.message);
                _setHeart(icon, true); // revert
                showFavToast('Failed to remove: ' + error.message, 'error');
            } else {
                delete _favMap[listingId];
                showFavToast('Removed from favorites.', 'remove');
            }
        } else {
            // Add to favorites
            const { data, error } = await SB()
                .from('favorites')
                .insert({ listing_id: listingId, user_id: _user.id })
                .select('id')
                .single();
            if (error) {
                console.error(' [FAV] Add error:', error.message);
                _setHeart(icon, false); // revert
                showFavToast('Failed to save: ' + error.message, 'error');
            } else {
                _favMap[listingId] = data.id;
                showFavToast('Added to favorites!', 'add');
            }
        }
    };

    /* ─────────────────────────────────────────
       HELPERS
    ───────────────────────────────────────── */
    function _collectListingIds() {
        const ids = new Set();
        // Support both data-listing-id (util) and data-lid (home.js cards)
        document.querySelectorAll('[data-listing-id],[data-lid]').forEach(el => {
            const id = el.dataset.listingId || el.dataset.lid;
            if (id) ids.add(id);
        });
        return [...ids];
    }

    function _iconFor(listingId) {
        // Support both attribute names
        const el = document.querySelector('[data-listing-id="' + listingId + '"],[data-lid="' + listingId + '"]');
        return el ? el.querySelector('i') : null;
    }

    function _syncAllHearts() {
        document.querySelectorAll('[data-listing-id],[data-lid]').forEach(el => {
            const id = el.dataset.listingId || el.dataset.lid;
            const icon = el.querySelector('i');
            if (icon && id) _setHeart(icon, _favMap.hasOwnProperty(id));
        });
    }

    function _setHeart(icon, filled) {
        if (filled) {
            icon.className = 'fa-solid fa-heart';
            icon.parentElement.classList.add('faved');
        } else {
            icon.className = 'fa-regular fa-heart';
            icon.parentElement.classList.remove('faved');
        }
    }

    /* ─────────────────────────────────────────
       TOAST
    ───────────────────────────────────────── */
    window.showFavToast = function (message, type) {
        let box = document.getElementById('_favToastBox');
        if (!box) {
            box = document.createElement('div');
            box.id = '_favToastBox';
            box.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
            document.body.appendChild(box);
        }
        const colors = { add: '#EB6753', remove: '#555', error: '#e74c3c' };
        const icons  = { add: '&#10084;', remove: '&#9825;', error: '&#9888;' };
        const t = document.createElement('div');
        t.style.cssText =
            'background:' + (colors[type] || '#555') + ';color:#fff;' +
            'padding:12px 20px;border-radius:12px;font-family:Inter,sans-serif;' +
            'font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;' +
            'box-shadow:0 4px 20px rgba(0,0,0,0.2);' +
            'animation:_favSlide 0.3s ease;pointer-events:none;';
        t.innerHTML = '<span>' + (icons[type] || '') + '</span> ' + message;
        if (!document.getElementById('_favToastAnim')) {
            const s = document.createElement('style');
            s.id = '_favToastAnim';
            s.textContent = '@keyframes _favSlide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}';
            document.head.appendChild(s);
        }
        box.appendChild(t);
        setTimeout(() => { t.style.transition = 'opacity 0.3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2800);
    };
})();