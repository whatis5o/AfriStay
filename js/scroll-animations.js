/**
 * AfriStay Scroll Animations — /js/scroll-animations.js
 * Uses IntersectionObserver. No dependencies. ~3 KB.
 * Respects prefers-reduced-motion.
 */
(function () {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    /* ── CSS ── */
    const style = document.createElement('style');
    style.textContent = `
        .sa-up, .sa-fade, .sa-left, .sa-right, .sa-scale {
            will-change: opacity, transform;
        }
        .sa-up {
            opacity: 0;
            transform: translateY(30px);
            transition: opacity 0.55s cubic-bezier(0.22,1,0.36,1),
                        transform 0.55s cubic-bezier(0.22,1,0.36,1);
        }
        .sa-fade {
            opacity: 0;
            transition: opacity 0.65s ease;
        }
        .sa-left {
            opacity: 0;
            transform: translateX(-30px);
            transition: opacity 0.55s cubic-bezier(0.22,1,0.36,1),
                        transform 0.55s cubic-bezier(0.22,1,0.36,1);
        }
        .sa-right {
            opacity: 0;
            transform: translateX(30px);
            transition: opacity 0.55s cubic-bezier(0.22,1,0.36,1),
                        transform 0.55s cubic-bezier(0.22,1,0.36,1);
        }
        .sa-scale {
            opacity: 0;
            transform: scale(0.93);
            transition: opacity 0.55s cubic-bezier(0.22,1,0.36,1),
                        transform 0.55s cubic-bezier(0.22,1,0.36,1);
        }
        .sa-visible {
            opacity: 1 !important;
            transform: none !important;
        }
    `;
    document.head.appendChild(style);

    /* ── Skip these containers entirely ── */
    const SKIP = '#sidebar, nav, .topbar, header, .main-nav, .nav-wrapper, ' +
                 '.mobile-menu, .apin-box, #adminPinOverlay, .maintenance-overlay, ' +
                 '#toast-container, .lightbox, .modal, [role="dialog"]';

    /* ─────────────────────────────────────────────────────────
       AUTO TARGETS
       [selector, animation, stagger?]
       stagger = true  → each sibling gets +70ms delay (max 350ms)
    ───────────────────────────────────────────────────────── */
    const AUTO = [
        /* ── CARDS (staggered) ── */
        ['.property-card',          'up',    true ],
        ['.team-card',              'up',    true ],
        ['.value-card',             'up',    true ],
        ['.mission-card',           'up',    true ],
        ['.event-card',             'up',    true ],
        ['.ev-body',                'up',    true ],
        ['.ob-step',                'up',    true ],
        ['.ob-card',                'up',    true ],
        ['.stat-item',              'up',    true ],
        ['.step-item',              'up',    true ],
        ['.feature-item',           'up',    true ],
        ['.footer-column',          'up',    true ],
        ['.similar-card',           'up',    true ],
        ['.stat-card',              'up',    true ],

        /* ── SPLIT / SIDE-BY-SIDE SECTIONS ── */
        ['.story-content',          'left',  false],
        ['.box-left',               'left',  false],
        ['.story-image',            'right', false],
        ['.box-right',              'right', false],

        /* ── HERO & BANNER BLOCKS ── */
        ['.about-hero .hero-content','fade', false],
        ['.about-hero .hero-tag',   'up',    false],
        ['.events-hero',            'fade',  false],
        ['.ob-hero',                'fade',  false],
        ['.legal-hero',             'fade',  false],
        ['.hero-inner',             'up',    false],
        ['.cta-content',            'up',    false],

        /* ── SECTION TITLES & HEADERS ── */
        ['.section-title',          'up',    false],
        ['.section-header',         'up',    false],
        ['.title-group',            'up',    false],

        /* ── DETAIL PAGE ── */
        ['.listing-title',          'up',    false],
        ['.meta-chips',             'up',    false],
        ['.desc-text',              'up',    false],
        ['.price-line',             'up',    false],
        ['.info-card',              'up',    false],
        ['.breadcrumb',             'fade',  false],
        ['.thumbs-row',             'up',    false],
        ['.avail-pill',             'up',    false],

        /* ── LEGAL (Privacy / Terms) ── */
        ['.legal-nav',              'up',    false],
        ['.legal-body',             'up',    false],
        ['.legal-updated',          'fade',  false],

        /* ── ONBOARDING ── */
        ['.ob-payout',              'up',    false],
        ['.ob-support',             'up',    false],
        ['.ob-cta',                 'up',    false],

        /* ── AUTH ── */
        ['.auth-desc',              'up',    false],

        /* ── CONTACT ── */
        ['.box',                    'up',    false],

        /* ── CHECKOUT / RESULT PAGES ── */
        ['.summary',                'up',    false],
        ['.pay-card',               'up',    false],
        ['.result-card',            'scale', false],
        ['.ref-box',                'scale', false],
        ['.s-row',                  'up',    true ],
        ['.error-box',              'up',    false],

        /* ── FAVORITES ── */
        ['.fav-list',               'up',    false],

        /* ── DASHBOARD WIDGETS ── */
        ['.data-section',           'up',    false],
        ['.chart-card',             'up',    false],
        ['.listing-row',            'up',    false],

        /* ── ABOUT ── */
        ['.stats-container',        'up',    false],
        ['.mission-vision-container','up',   false],
        ['.newsletter-form',        'up',    false],

        /* ── EVENTS ── */
        ['.events-section',         'up',    false],
        ['.filters-box',            'up',    false],
    ];

    /* ── Observer ── */
    const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const el  = entry.target;
            const ms  = Number(el.dataset.saDelay || 0);
            setTimeout(() => el.classList.add('sa-visible'), ms);
            io.unobserve(el);
        });
    }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });

    /* ── Register one element ── */
    function prep(el, cls, stagger, siblings) {
        if (el.dataset.saInit) return;
        if (el.closest(SKIP)) return;
        el.dataset.saInit = '1';
        if (stagger && siblings && siblings.length > 1) {
            const idx = [...siblings].indexOf(el);
            el.dataset.saDelay = String(Math.min(idx * 70, 350));
        }
        el.classList.add('sa-' + cls);
        io.observe(el);
    }

    /* ── Section-level sweep: fade every <section> / *-section that isn't already handled ── */
    function sweepSections() {
        // Target: top-level section tags and divs with "section" in their class
        const SECT_SKIP = '.about-hero, .events-hero, .ob-hero, .legal-hero, ' +
                          '.properties-carousel-section, .hero, .cta-section';
        document.querySelectorAll(
            'section:not([data-sa-init]), ' +
            '[class*="-section"]:not([data-sa-init]):not(nav):not(header)'
        ).forEach(el => {
            if (el.dataset.saInit) return;
            if (el.closest(SKIP)) return;
            if (el.matches(SECT_SKIP) || el.closest(SECT_SKIP)) return;
            // Don't re-animate children that will be individually animated
            prep(el, 'fade', false, null);
        });
    }

    /* ── Main init — idempotent ── */
    function init() {
        /* Manual [data-animate] overrides */
        document.querySelectorAll('[data-animate]').forEach(el => {
            if (el.dataset.saInit) return;
            const type  = el.dataset.animate || 'up';
            const valid = ['up', 'fade', 'left', 'right', 'scale'];
            prep(el, valid.includes(type) ? type : 'up', false, null);
        });

        /* Named selectors */
        AUTO.forEach(([sel, cls, stagger]) => {
            const all = document.querySelectorAll(sel);
            all.forEach(el => {
                const siblings = stagger
                    ? el.parentElement?.querySelectorAll(sel) || []
                    : [];
                prep(el, cls, stagger, siblings);
            });
        });

        /* Broad section sweep */
        sweepSections();
    }

    /* ── Boot ── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* ── Public API: call after dynamic card renders ── */
    window.refreshScrollAnimations = init;
})();
