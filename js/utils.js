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
        unit:       isVeh ? 'day'     : 'night',
        unitPlural: isVeh ? 'days'    : 'nights',
        action:     isVeh ? 'rental'  : 'stay',
        startLabel: isVeh ? 'Pick-up' : 'Check-in',
        endLabel:   isVeh ? 'Return'  : 'Check-out',
        thing:      isVeh ? 'vehicle' : 'property',
        verb:       isVeh ? 'rented'  : 'stayed at',
        icon:       isVeh ? '🚗'      : '🏠',
    };
}
window.getListingLabels = getListingLabels;

console.log("✅ [UTILS] Utilities loaded");
