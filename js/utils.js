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

console.log("✅ [UTILS] Utilities loaded");
