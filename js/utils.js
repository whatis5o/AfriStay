/**
 * Utilities: small, focused helpers used across the UI
 */

console.log("🛠️ [UTILS] Loading utilities...");

const UTILS = {
    formatMoney(amount) {
        if (amount == null) return `0 ${CONFIG.CURRENCY}`;
        return new Intl.NumberFormat('en-RW').format(amount) + ` ${CONFIG.CURRENCY}`;
    },

    formatDate(dateString) {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
    },

    getRandomColor() {
        const colors = ['#EB6753', '#3498db', '#9b59b6', '#2ecc71', '#f1c40f', '#e67e22', '#95a5a6'];
        return colors[Math.floor(Math.random() * colors.length)];
    },

    debounce(fn, wait = 220) {
        let t;
        return function(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }
};

// Returns label set based on category slug
function getListingLabels(categorySlug) {
    const isVeh = categorySlug === 'vehicle';
    return {
        unit:        isVeh ? 'day'     : 'night',
        unitPlural:  isVeh ? 'days'    : 'nights',
        action:      isVeh ? 'rental'  : 'stay',
        startLabel:  isVeh ? 'Pick-up' : 'Check-in',
        endLabel:    isVeh ? 'Return'  : 'Check-out',
        thing:       isVeh ? 'vehicle' : 'property',
        verb:        isVeh ? 'rented'  : 'stayed at',
        reviewVerb:  isVeh ? 'rented this vehicle' : 'stayed here',
        icon:        isVeh ? '🚗'      : '🏠',
        priceLabel:  isVeh ? '/day'    : '/night',
    };
}
window.getListingLabels = getListingLabels;

// Loading animation — call on any element, returns interval handle to clearInterval
function showLoadingDots(el, text) {
    if (!el) return null;
    text = text || 'Loading';
    let i = 0;
    const dots = ['', '.', '..', '...'];
    el.textContent = text;
    return setInterval(function() { el.textContent = text + dots[i++ % 4]; }, 400);
}
window.showLoadingDots = showLoadingDots;

// Get display price for a listing (uses price_display if available, falls back to price)
function getDisplayPrice(listing) {
    return listing.price_display || listing.price || 0;
}
window.getDisplayPrice = getDisplayPrice;

// Get display price for outside-Kigali zone (vehicles)
function getOutsideKigaliDisplayPrice(listing) {
    return listing.price_outside_kigali_display || listing.price_outside_kigali || 0;
}
window.getOutsideKigaliDisplayPrice = getOutsideKigaliDisplayPrice;

// Inject AfriStay loading animation into a container element by ID or element reference
function showAfriLoading(containerOrId, text) {
    const el = typeof containerOrId === 'string' ? document.getElementById(containerOrId) : containerOrId;
    if (!el) return;
    text = text || 'Loading';
    el.innerHTML = '<div class="afri-loading"><div class="afri-loading-logo">' + text + '</div></div>';
}
window.showAfriLoading = showAfriLoading;

// Show empty/no-results state
function showEmptyResults(containerOrId, message, subtext) {
    const el = typeof containerOrId === 'string' ? document.getElementById(containerOrId) : containerOrId;
    if (!el) return;
    message = message || 'No results found';
    subtext = subtext || 'Try different filters or search terms.';
    el.innerHTML =
        '<div class="empty-results">' +
        '<i class="fa-solid fa-magnifying-glass"></i>' +
        '<h4>' + message + '</h4>' +
        '<p>' + subtext + '</p>' +
        '</div>';
}
window.showEmptyResults = showEmptyResults;

// Build pagination HTML and wire up a loadPage callback
// pageCount = total number of pages, currentPage = 0-indexed, total = total items
function renderPagination(containerId, currentPage, pageCount, total, pageSize, onPageChange) {
    const el = document.getElementById(containerId);
    if (!el || pageCount <= 1) { if (el) el.innerHTML = ''; return; }
    const from = currentPage * pageSize + 1;
    const to   = Math.min((currentPage + 1) * pageSize, total);
    el.innerHTML =
        '<div class="afri-pagination">' +
        '<button ' + (currentPage === 0 ? 'disabled' : '') + ' onclick="(' + onPageChange.toString() + ')(' + (currentPage - 1) + ')">← Previous</button>' +
        '<span class="page-info">' + from + '–' + to + ' of ' + total + '</span>' +
        '<button ' + (currentPage >= pageCount - 1 ? 'disabled' : '') + ' onclick="(' + onPageChange.toString() + ')(' + (currentPage + 1) + ')">Next →</button>' +
        '</div>';
}
window.renderPagination = renderPagination;

/* ══════════════════════════════════════════════════════════
   MAINTENANCE MODE
   Reads platform_config key 'maintenance_mode' on every page.
   If 'true', shows a full-screen overlay blocking the site
   (admins are exempt and see only a dismissable banner).
   ══════════════════════════════════════════════════════════ */
(function initMaintenanceCheck() {
    document.addEventListener('DOMContentLoaded', async () => {
        const supa = window.supabaseClient;
        if (!supa) return;

        try {
            const [cfgRes, sessionRes] = await Promise.all([
                supa.from('platform_config')
                    .select('value')
                    .eq('key', 'maintenance_mode')
                    .maybeSingle(),
                supa.auth.getSession(),
            ]);

            if (cfgRes.data?.value !== 'true') return; // not in maintenance

            // Check if current user is admin
            const userId = sessionRes.data?.session?.user?.id;
            let isAdmin = false;
            if (userId) {
                const { data: p } = await supa.from('profiles').select('role').eq('id', userId).maybeSingle();
                isAdmin = p?.role === 'admin';
            }

            // Fetch message
            const { data: msgCfg } = await supa.from('platform_config')
                .select('value').eq('key', 'maintenance_message').maybeSingle();
            const msg = msgCfg?.value || 'AfriStay is currently undergoing scheduled maintenance. We\'ll be back shortly!';

            if (isAdmin) {
                // Admin: show a dismissable banner at top
                const banner = document.createElement('div');
                banner.id = '_maintenanceBanner';
                banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f39c12;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;font-family:Inter,sans-serif;font-size:14px;font-weight:600;gap:12px;';
                banner.innerHTML = `<span><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>Maintenance mode is ON — users see a blocked page. <a href="/Dashboards/Admin/?tab=settings" style="color:#fff;text-decoration:underline;margin-left:8px;">Turn off in Settings</a></span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;">&times;</button>`;
                document.body.prepend(banner);
            } else {
                // Regular user: full-screen overlay, interaction blocked
                const overlay = document.createElement('div');
                overlay.id = '_maintenanceOverlay';
                overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(26,26,26,0.97);display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;padding:20px;';
                overlay.innerHTML = `
                    <div style="text-align:center;max-width:460px;color:#fff;">
                        <div style="font-size:64px;margin-bottom:24px;">🔧</div>
                        <h1 style="font-size:26px;font-weight:800;margin:0 0 14px;">Under Maintenance</h1>
                        <p style="font-size:15px;color:rgba(255,255,255,0.75);line-height:1.7;margin:0 0 28px;">${msg}</p>
                        <div style="background:rgba(235,103,83,0.15);border:1px solid rgba(235,103,83,0.3);border-radius:12px;padding:14px 20px;font-size:13px;color:rgba(255,255,255,0.6);">
                            Questions? Email <strong style="color:#EB6753;">info@afristay.rw</strong>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                // Prevent scrolling
                document.body.style.overflow = 'hidden';
            }
        } catch (_) { /* silent — never break the site */ }
    });
})();

console.log("✅ [UTILS] Utilities loaded");
