/**
 * AFRI-STAY ADMIN - UNIFIED DASHBOARD
 * Features: Authentication, Role-based UI, Navigation, Modals, Data Management
 * 
 * Assumes:
 *  - Supabase client available as global `window.supabaseClient` (via config.js)
 *  - DEMO_MODE can be toggled for testing without real payments
 */

console.log("🚀 [ADMIN] Loading dashboard.js...");

/* ===========================
   CONFIG
   =========================== */
const DEMO_MODE = false; // Set to true only when testing with mock provider

/* ═══════════════════════════════════════════════
   EMAILJS CONFIG  — fill in after creating your account at emailjs.com
   See EMAIL_SETUP.md for step-by-step instructions
   ═══════════════════════════════════════════════ */
// EmailJS removed — emails handled by Brevo edge functions

console.log("🎯 [ADMIN] Demo mode:", DEMO_MODE ? "ENABLED" : "DISABLED");

/* ═══════════════════════════════════════════════════════════════
   AUDIT LOGGING  — fire-and-forget; never crashes the caller
   Calls the log_audit() SECURITY DEFINER RPC in Supabase.
   If the RPC itself fails, the DB-level fallback in log_audit()
   writes an error row automatically.
   ═══════════════════════════════════════════════════════════════ */
function logAudit({ action, entityType = null, entityId = null, description = null, metadata = {}, isError = false }) {
    if (!window.supabaseClient) return;
    const actor = window.CURRENT_PROFILE;
    window.supabaseClient.rpc('log_audit', {
        p_actor_id:    actor?.id    || null,
        p_actor_role:  actor?.role  || null,
        p_action:      action,
        p_entity_type: entityType,
        p_entity_id:   entityId ? String(entityId) : null,
        p_description: description,
        p_metadata:    metadata,
        p_is_error:    isError,
    }).then(({ error }) => {
        if (error) console.warn('[AUDIT] log_audit RPC returned error:', error.message);
    }).catch(err => console.warn('[AUDIT] log_audit call failed:', err.message));
}
window.logAudit = logAudit;;

/* ═══════════════════════════════════════════════════
   CLIENT-SIDE CACHE  ← reduces redundant DB calls
   Key structure:  'table:queryHash'
   Default TTL:    60s  (override per call)
   ═══════════════════════════════════════════════════ */
const _cache = {
    _store: Object.create(null),
    _ttl:   Object.create(null),
    set(key, val, ms = 60000) { this._store[key] = val; this._ttl[key] = Date.now() + ms; },
    get(key) {
        if (!(key in this._store)) return null;
        if (Date.now() > this._ttl[key]) { delete this._store[key]; delete this._ttl[key]; return null; }
        return this._store[key];
    },
    del(key)   { delete this._store[key]; delete this._ttl[key]; },
    bust(pfx)  { Object.keys(this._store).filter(k => k.startsWith(pfx)).forEach(k => this.del(k)); }
};

/* Cached province list  — 5 min TTL */
async function cProvinces() {
    const hit = _cache.get('prov'); if (hit) return hit;
    const { data } = await _supabase.from('provinces').select('id,name').order('name');
    _cache.set('prov', data || [], 300000); return data || [];
}
/* Cached districts for a province — 5 min TTL */
async function cDistricts(provId) {
    const k = 'dist_' + provId; const hit = _cache.get(k); if (hit) return hit;
    const { data } = await _supabase.from('districts').select('id,name').eq('province_id', provId).order('name');
    _cache.set(k, data || [], 300000); return data || [];
}
/* Cached sectors for a district — 5 min TTL */
async function cSectors(distId) {
    const k = 'sect_' + distId; const hit = _cache.get(k); if (hit) return hit;
    const { data } = await _supabase.from('sectors').select('id,name').eq('district_id', distId).order('name');
    _cache.set(k, data || [], 300000); return data || [];
}
/* First image per listing — 2 min TTL (batch) */
async function cImageMap(ids) {
    if (!ids.length) return {};
    const key = 'imgs_' + ids.slice().sort().join('|').slice(0,80);
    const hit = _cache.get(key); if (hit) return hit;
    const { data } = await _supabase.from('listing_images').select('listing_id,image_url').in('listing_id', ids);
    const map = {};
    (data||[]).forEach(r => { if (!map[r.listing_id]) map[r.listing_id] = r.image_url; });
    _cache.set(key, map, 120000); return map;
}
/* Owner listing IDs — 30 s TTL */
async function cOwnerIds() {
    if (!CURRENT_PROFILE) return [];
    const k = 'ownIds_' + CURRENT_PROFILE.id; const hit = _cache.get(k); if (hit) return hit;
    const ids = await fetchOwnerListingIds();
    _cache.set(k, ids, 30000); return ids;
}
/* Invalidate all listing-related caches (after create/approve/delete) */
function bustListingCache() {
    _cache.bust('imgs_'); _cache.bust('ownIds_'); _cache.del('pendingCount');
}


// Get Supabase client from window (created by config.js)
let _supabase = null;

// Utility selectors
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Global state
let CURRENT_USER = null;
let CURRENT_PROFILE = null;
let CURRENT_ROLE = null; // 'admin' | 'owner' | 'user'

/* ===========================
   TOAST NOTIFICATIONS
   =========================== */
function toast(message, type = 'success', duration = 3500) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
        document.body.appendChild(container);
    }
    const cfg = {
        success: { bg: '#2ecc71', icon: 'fa-circle-check' },
        error:   { bg: '#e74c3c', icon: 'fa-circle-xmark' },
        info:    { bg: '#3498db', icon: 'fa-circle-info' },
        warning: { bg: '#f39c12', icon: 'fa-triangle-exclamation' }
    };
    const { bg, icon } = cfg[type] || cfg.info;
    if (!document.getElementById('toastStyle')) {
        const s = document.createElement('style');
        s.id = 'toastStyle';
        s.textContent = `@keyframes slideInT{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:translateX(0)}}@keyframes fadeOutT{from{opacity:1}to{opacity:0;transform:translateX(60px)}}`;
        document.head.appendChild(s);
    }
    const t = document.createElement('div');
    t.style.cssText = `background:${bg};color:#fff;padding:14px 20px;border-radius:10px;display:flex;align-items:center;gap:12px;font-size:14px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,0.18);pointer-events:all;min-width:260px;max-width:380px;animation:slideInT 0.3s ease;font-family:'Inter',sans-serif;`;
    t.innerHTML = `<i class="fa-solid ${icon}" style="font-size:18px;flex-shrink:0;"></i><span>${message}</span>`;
    container.appendChild(t);
    setTimeout(() => { t.style.animation = 'fadeOutT 0.3s ease forwards'; setTimeout(() => t.remove(), 350); }, duration);
}
window.toast = toast;

/* ===========================
   INITIALIZATION
   =========================== */
document.addEventListener('DOMContentLoaded', async () => {
    console.log("📱 [ADMIN] DOM loaded, initializing...");
    
    // Step 0: Get Supabase client
    if (window.supabaseClient) {
        _supabase = window.supabaseClient;
        console.log("✅ [ADMIN] Supabase client found!");
    } else {
        console.error("❌ [ADMIN] Supabase client not found! Make sure config.js loaded properly.");
        alert("⚠️ Database connection failed. Check console for details.");
        return;
    }
    
    // Step 0.5: Fire-and-forget — expire stale bookings before loading UI
    fetch(CONFIG.FUNCTIONS_BASE + '/expire-bookings', { method: 'POST' }).catch(() => {});

    // Step 1: Re-parent modals and quick actions to body
    reparentModalsAndQuickActions();
    
    // Step 2: Bind all UI interactions
    bindUIInteractions();
    
    // Step 3: Authentication & role-based setup
    await initAuthAndRole();
    
    // Step 4: Load data based on role
    await loadAllCountsAndTables();
    loadNotificationBadges();

    // Step 4.5: Realtime — refresh badges instantly when a new notification arrives
    _supabase.channel('notif-live')
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'notifications',
            filter: 'user_id=eq.' + CURRENT_PROFILE.id
        }, () => loadNotificationBadges())
        .subscribe();
    
    // Step 5: Make quick actions visible
    const qa = $('.quick-actions');
    if (qa) {
        qa.style.display = 'flex';
        console.log("✅ [SPECIAL USER] Quick actions initialized");
    }
    
    // Step 6: Show default panel (dashboard)
    togglePanels('dashboardPanel');
    
    console.log("✨ [SPECIAL USER] Initialization complete!");
});

/* ===========================
   DOM REPARENTING
   =========================== */
function injectDashboardStyles() {
    if (document.getElementById('_dashV2Styles')) return;
    const s = document.createElement('style');
    s.id = '_dashV2Styles';
    s.textContent = `
        /* Settings panel centered */
        #settingsPanel .settings-inner,
        #settingsPanel > div:not(.panel-header) {
            max-width: 560px;
            margin-left: auto;
            margin-right: auto;
        }
        /* Users table fixed columns */
        #usersTable th, #usersTable td {
            min-width: 140px;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            vertical-align: middle;
        }
        #usersTable th:first-child, #usersTable td:first-child { min-width:40px;max-width:50px; }
        #usersTable { table-layout: fixed; width: 100%; }
        #usersTable th:nth-child(2), #usersTable td:nth-child(2) { min-width:160px; } /* name */
        #usersTable th:nth-child(3), #usersTable td:nth-child(3) { min-width:200px; } /* email */
        #usersTable th:nth-child(4), #usersTable td:nth-child(4) { min-width:130px; } /* phone */
        #usersTable th:nth-child(5), #usersTable td:nth-child(5) { min-width:100px; } /* role */
        #usersTable th:nth-child(6), #usersTable td:nth-child(6) { min-width:130px; } /* status */
        #usersTable th:nth-child(7), #usersTable td:nth-child(7) { min-width:160px; } /* actions */
        /* Promo price strikethrough on cards */
        .promo-original { text-decoration: line-through; color: #aaa !important; font-size: 14px !important; font-weight: 400 !important; }
        .promo-badge { background:#EB6753;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:6px;vertical-align:middle; }
        /* New bookings container */
        #newBookingsContainer { min-height: 100px; }
        /* ── Amenity chips — forced override ── */
        #amenityCheckboxes { display:flex !important; flex-wrap:wrap !important; gap:8px !important; padding:4px 0 !important; align-items:flex-start !important; }
        #amenityCheckboxes button.am-chip {
            display:inline-flex !important; align-items:center !important; gap:6px !important;
            padding:6px 14px !important; border:1.5px solid #ebebeb !important;
            border-radius:20px !important; background:#fff !important;
            font-size:12px !important; font-weight:600 !important; color:#666 !important;
            cursor:pointer !important; white-space:nowrap !important;
            transition:all .18s !important; flex-shrink:0 !important;
            font-family:'Inter',sans-serif !important; line-height:1.3 !important;
            outline:none !important; box-shadow:none !important;
            text-decoration:none !important; margin:0 !important;
        }
        #amenityCheckboxes button.am-chip i {
            color:#bbb !important; font-size:11px !important;
            width:12px !important; text-align:center !important;
            display:inline-block !important;
        }
        #amenityCheckboxes button.am-chip:hover {
            border-color:#EB6753 !important; color:#EB6753 !important;
        }
        #amenityCheckboxes button.am-chip:hover i { color:#EB6753 !important; }
        #amenityCheckboxes button.am-chip.active {
            background:#EB6753 !important; color:#fff !important;
            border-color:#EB6753 !important;
        }
        #amenityCheckboxes button.am-chip.active i { color:#fff !important; }
        /* ── Stepper +/- ── */
        .stepper-wrap { display:flex !important; align-items:center !important; border:1.5px solid #e8e8e8 !important; border-radius:11px !important; overflow:hidden !important; background:#fff !important; }
        button.step-btn { width:38px !important; height:42px !important; border:none !important; background:none !important; font-size:18px !important; font-weight:700 !important; color:#555 !important; cursor:pointer !important; display:flex !important; align-items:center !important; justify-content:center !important; flex-shrink:0 !important; font-family:'Inter',sans-serif !important; line-height:1 !important; padding:0 !important; margin:0 !important; outline:none !important; }
        button.step-btn:hover { background:#fff0ee !important; color:#EB6753 !important; }
        input.step-inp { border:none !important; text-align:center !important; font-size:15px !important; font-weight:700 !important; color:#1a1a1a !important; width:100% !important; min-width:0 !important; padding:10px 4px !important; background:#fff !important; outline:none !important; box-shadow:none !important; -moz-appearance:textfield !important; }
    `;
    document.head.appendChild(s);
}

function reparentModalsAndQuickActions() {
    console.log("🔄 [ADMIN] Reparenting modals and quick actions...");
    injectDashboardStyles();
    
    const move = (selector) => {
        const elements = $$(selector);
        console.log(`  Moving ${elements.length} ${selector} elements to body`);
        elements.forEach(node => {
            if (node && node.parentElement !== document.body) {
                document.body.appendChild(node);
            }
        });
    };

    move('.form-modal');
    move('.modal');
    move('.quick-actions');
}

/* ===========================
   UI EVENT BINDINGS
   =========================== */
function bindUIInteractions() {
    console.log("🎛️ [ADMIN] Binding UI interactions...");
    
    const navButtons = $$('.nav-btn');
    const mobileMenuBtn = $('#mobileMenuBtn');
    const sidebar = $('#sidebar');
    const overlay = $('#sidebarOverlay');
    const toggleSidebarBtn = $('#toggleSidebarBtn');
    const quickMainBtn = $('#quickMainBtn');
    const backBtn = $('#backToChats');
    const logoutBtn = $('#logoutBtn');

    console.log("  Found", navButtons.length, "navigation buttons");

    // === Navigation Buttons ===
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            console.log("🔘 [NAV] Clicked tab:", tabName);
            
            if (!tabName) return;
            
            // Handle logout separately
            if (tabName === 'logout' || btn.id === 'logoutBtn') {
                handleLogout();
                return;
            }
            
            // Switch to the selected panel
            togglePanels(`${tabName}Panel`);
            // Auto-load data when switching tabs
            if (tabName === 'listings')         { filterListings(); }
            if (tabName === 'messages')         { loadMessagesPreview(); }
            if (tabName === 'listing-requests') { loadListingRequests(); }
            if (tabName === 'bookings')         { loadBookingsTable(); }

            // Mark relevant notifications as read and hide the badge
            const typesToClear = _TAB_NOTIF_CLEAR[tabName];
            if (typesToClear) markNotificationsRead(typesToClear);

            // Update active states
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Close mobile sidebar
            if (sidebar) sidebar.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
        });
    });

    // === Mobile Menu Toggle ===
    if (mobileMenuBtn && sidebar && overlay) {
        mobileMenuBtn.addEventListener('click', () => {
            console.log("📱 [MOBILE] Toggling menu");
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
        });
    }

    // === Overlay Click (close sidebar) ===
    if (overlay && sidebar) {
        overlay.addEventListener('click', () => {
            console.log("📱 [MOBILE] Closing sidebar via overlay");
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
        });
    }

    // === Desktop Sidebar Collapse ===
    if (toggleSidebarBtn && sidebar) {
        toggleSidebarBtn.addEventListener('click', () => {
            console.log("💻 [DESKTOP] Toggling sidebar collapse");
            sidebar.classList.toggle('collapsed');
        });
    }

    // === Quick Actions Toggle ===
    if (quickMainBtn) {
        quickMainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log("⚡ [QUICK] Toggling quick actions");
            const qa = $('.quick-actions');
            if (qa) qa.classList.toggle('active');
        });
    }

    // Close quick actions when clicking outside
    document.addEventListener('click', (e) => {
        const qa = $('.quick-actions');
        if (qa && !e.target.closest('.quick-actions') && !e.target.closest('#quickMainBtn')) {
            qa.classList.remove('active');
        }
    });

    // === Modal Close on Overlay Click ===
    $$('.form-modal, .modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                console.log("🚪 [MODAL] Closing via overlay click");
                modal.classList.remove('active');
            }
        });
    });

    // === Create Listing Button ===
    const openCreateListingBtn = $('#openCreateListingBtn');
    if (openCreateListingBtn) {
        openCreateListingBtn.addEventListener('click', () => {
            console.log("➕ [LISTING] Opening create listing modal");
            openModal('listingModal');
            loadAmenityCheckboxes();
        });
    }

    // === Listing Form Submit ===
    const listingForm = $('#listingForm');
    if (listingForm) {
        listingForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log("📝 [LISTING] Submitting listing form");
            await handleCreateListing();
            // Only close if listing was created (status shows success)
            const statusEl = document.getElementById('listingCreateStatus');
            if (statusEl && statusEl.style.background && statusEl.style.background.includes('e9faf0')) {
                setTimeout(() => {
                    closeModal('listingModal');
                    if (statusEl) statusEl.style.display = 'none';
                    loadListingsTable();
                }, 2000);
            }
        });
    }

    // === Chat User Items ===
    const chatItems = $$('.chat-user-item');
    const chatHeader = $('#chatWindowHeader');
    
    chatItems.forEach(item => {
        item.addEventListener('click', () => {
            console.log("💬 [CHAT] Selecting chat user");
            chatItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            const name = item.querySelector('h4')?.innerText;
            if (chatHeader && name) {
                chatHeader.innerText = name;
            }

            // Mobile: show chat window
            if (window.innerWidth <= 768) {
                const chatWindow = $('.chat-window');
                if (chatWindow) chatWindow.classList.add('active');
            }
        });
    });

    // === Back to Chats (Mobile) ===
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            console.log("⬅️ [CHAT] Back to chats list");
            const chatWindow = $('.chat-window');
            if (chatWindow) chatWindow.classList.remove('active');
        });
    }

    // === Window Resize Handler ===
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            const chatWindow = $('.chat-window');
            if (chatWindow) chatWindow.classList.remove('active');
        }
    });

    // === Event Form Submit ===
    document.getElementById('eventForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleCreateEvent();
    });

    // Promo form submit — modal is now self-built, listener kept harmless
    document.getElementById('promoForm')?.addEventListener('submit', async (e) => { e.preventDefault(); await handleCreatePromo(); });

    // === Settings Form Submit ===
    document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleSaveSettings();
    });

    // === Logout Button ===
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log("🚪 [AUTH] Logout button clicked");
            handleLogout();
        });
    }
    const listingSearchInput = document.getElementById('listingSearchInput');

    if (listingSearchInput) {
        let _lsTimer;
        listingSearchInput.addEventListener('input', () => {
            clearTimeout(_lsTimer);
            _lsTimer = setTimeout(filterListings, 300); // debounce 300ms
        });
        listingSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); clearTimeout(_lsTimer); filterListings(); }
        });
    }
    document.getElementById('searchIcon')?.addEventListener('click', filterListings);
    // Add to bindUIInteractions() after other bindings
    $('#fetchUsersBtn')?.addEventListener('click', () => loadUsersTable());
    const userSearchInput = document.getElementById('userSearchInput');
    if (userSearchInput) {
        let t;
        userSearchInput.addEventListener('input', (e) => {
            clearTimeout(t);
            t = setTimeout(()=> loadUsersTable(e.target.value.trim()), 300); // debounce search
        });
        userSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); loadUsersTable(userSearchInput.value.trim()); }
        });
    }

    // in bindUIInteractions()
    document.getElementById('filterProvince')?.addEventListener('change', async () => { await loadFilterDistricts(); });
    document.getElementById('filterDistrict')?.addEventListener('change', async () => { await loadFilterSectors(); });
    document.getElementById('filterSector')?.addEventListener('change', filterListings);

    // reset filters
    document.getElementById('resetFiltersBtn')?.addEventListener('click', async () => {
        document.getElementById('listingSearchInput').value = '';
        document.getElementById('filterProvince').value = '';
        document.getElementById('filterDistrict').innerHTML = '<option value="">District</option>'; document.getElementById('filterDistrict').disabled = true;
        document.getElementById('filterSector').innerHTML = '<option value="">Sector</option>'; document.getElementById('filterSector').disabled = true;
        await loadFilterProvinces();
        await filterListings();
    });
    // owner search (debounced)
    const ownerSearchEl = document.getElementById('ownerSearch');
    if (ownerSearchEl) {
    let ownerTimer = null;
    ownerSearchEl.addEventListener('input', (e) => {
        clearTimeout(ownerTimer);
        ownerTimer = setTimeout(() => {
        const ev = { target: { value: e.target.value } };
        _searchOwners(ev); // uses your existing _searchOwners implementation
        }, 260);
    });
    }

    // USERS
    $('#fetchUsersBtn')?.addEventListener('click', () => loadUsersTable());
    const userSearch = document.getElementById('userSearchInput');
    if (userSearch) {
    let ut;
    userSearch.addEventListener('input', (e)=> {
        clearTimeout(ut);
        ut = setTimeout(()=> loadUsersTable(e.target.value.trim()), 300);
    });
    userSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); loadUsersTable(userSearch.value.trim()); }
    });
    }

    // LISTINGS filters + search binding
    document.getElementById('searchIcon')?.addEventListener('click', filterListings);
    document.getElementById('listingSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); filterListings(); }
    });

    // load filter selects initially (call after auth)
    loadFilterProvinces();

    // ── Sidebar toggle (desktop collapse + mobile slide) ──
    initSidebarToggle();

    // ── Per-tab search bindings ──
    function _bindSearch(inputId, fn) {
        const el = document.getElementById(inputId);
        if (!el) return;
        let t;
        el.addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => fn(e.target.value.trim()), 350); });
        el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fn(el.value.trim()); } });
    }
    _bindSearch('bookingSearchInput', q => loadBookingsTable(0, q));
    _bindSearch('reqSearchInput',     q => loadListingRequests(q));
    _bindSearch('finSearchInput',     q => loadFinancialData(0, q));

    console.log("✅ [ADMIN] All UI interactions bound");
}

/* ===========================
   SIDEBAR TOGGLE
   =========================== */
function initSidebarToggle() {
    const btn     = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!btn || !sidebar) return;

    btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            document.body.classList.toggle('sb-open');
        } else {
            document.body.classList.toggle('sb-collapsed');
            // Update icon
            const ic = btn.querySelector('i');
            if (ic) {
                ic.className = document.body.classList.contains('sb-collapsed')
                    ? 'fa-solid fa-bars-staggered'
                    : 'fa-solid fa-bars';
            }
        }
    });

    if (overlay) {
        overlay.addEventListener('click', () => {
            document.body.classList.remove('sb-open');
        });
    }

    // Close mobile sidebar when a nav item is clicked
    sidebar.querySelectorAll('.nav-btn[data-tab]').forEach(b => {
        b.addEventListener('click', () => {
            if (window.innerWidth <= 768) document.body.classList.remove('sb-open');
        });
    });
}

/* ══════════════════════════════════════════════════════════
   NOTIFICATION BADGES  (Instagram-style tab counts)
   ══════════════════════════════════════════════════════════ */

// type → badge element id mapping per role
const _NOTIF_BADGE_MAP = {
    admin: {
        'new_booking':        'badge-bookings',
        'listing_request':    'badge-listing-requests',
        'owner_application':  'badge-owner-applications',
        'new_message':        'badge-messages',
    },
    owner: {
        'new_booking':        'badge-bookings',
        'listing_approved':   'badge-listings',
    }
};

function _setBadge(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
        el.textContent = count > 99 ? '99+' : count;
        el.style.display = 'flex';
    } else {
        el.style.display = 'none';
    }
}

async function loadNotificationBadges() {
    if (!_supabase || !CURRENT_PROFILE) return;
    const role = CURRENT_ROLE;
    const map  = _NOTIF_BADGE_MAP[role];
    if (!map) return;   // 'user' role — no dashboard badges

    try {
        const { data, error } = await _supabase
            .from('notifications')
            .select('type')
            .eq('user_id', CURRENT_PROFILE.id)
            .eq('read', false);
        if (error || !data) return;

        // Count by type
        const counts = {};
        data.forEach(n => { counts[n.type] = (counts[n.type] || 0) + 1; });

        // Map to badge elements
        Object.entries(map).forEach(([type, badgeId]) => {
            _setBadge(badgeId, counts[type] || 0);
        });

        // Merge owner-applications + listing-request into attentionBadge for admin
        if (role === 'admin') {
            const attn = (counts['owner_application'] || 0) + (counts['listing_request'] || 0);
            _setBadge('attentionBadge', attn);
        }
    } catch(e) {
        console.warn('[NOTIF]', e.message);
    }
}

async function markNotificationsRead(types) {
    if (!_supabase || !CURRENT_PROFILE || !types.length) return;
    await _supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', CURRENT_PROFILE.id)
        .eq('read', false)
        .in('type', types);
    // Refresh badges after marking read
    loadNotificationBadges();
}

// Which tab click clears which notification types
const _TAB_NOTIF_CLEAR = {
    'bookings':           ['new_booking'],
    'listing-requests':   ['listing_request'],
    'owner-applications': ['owner_application'],
    'messages':           ['new_message'],
    'listings':           ['listing_approved'],
    'attention':          ['owner_application', 'listing_request'],
};

/* ===========================
   ADMIN GLOBAL SEARCH
   =========================== */
function initAdminSearch() {
    const input = document.getElementById('adminSearchInput');
    if (!input) return;

    const pills = document.querySelectorAll('.asf-pill');
    let activeFilter = 'all';

    pills.forEach(pill => {
        pill.addEventListener('click', () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            activeFilter = pill.dataset.asf;
            const q = input.value.trim();
            if (q) runAdminSearch(q, activeFilter);
        });
    });

    let t;
    input.addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(() => runAdminSearch(e.target.value.trim(), activeFilter), 350);
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); runAdminSearch(input.value.trim(), activeFilter); }
    });
}

function runAdminSearch(query, filter) {
    if (!query) return;

    // navigate to a panel and optionally call a load function
    const navTo = (panelId, tabName) => {
        document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');
        document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
        if (btn) btn.classList.add('active');
        const pt = document.getElementById('panelTitle');
        if (pt) pt.textContent = (typeof PTITLES !== 'undefined' ? PTITLES[panelId] : null) || tabName;
    };

    switch (filter) {
        case 'listings':
            navTo('listingsPanel', 'listings');
            const si = document.getElementById('listingSearchInput');
            if (si) { si.value = query; filterListings(); }
            break;
        case 'bookings':
            navTo('bookingsPanel', 'bookings');
            loadBookingsTable(0, query);
            break;
        case 'events':
            navTo('eventsPanel', 'events');
            loadEventsCards(0, query);
            break;
        case 'promotions':
            navTo('promotionsPanel', 'promotions');
            loadPromotionsCards(0, query);
            break;
        case 'payouts':
            toast('Financial / Payouts tab coming soon.', 'info');
            break;
        default: // all — search listings as primary
            navTo('listingsPanel', 'listings');
            const si2 = document.getElementById('listingSearchInput');
            if (si2) { si2.value = query; filterListings(); }
    }
}
function updateFormLabels() {
    const cat = document.getElementById('listCategory')?.value;
    const priceLabel = document.getElementById('priceLabel');
    const locationBox = document.querySelector('.location-box');
    const locationInputs = locationBox ? locationBox.querySelectorAll('select, input') : [];

    const vehiclePricingGroup = document.getElementById('vehiclePricingGroup');
    if (cat === 'vehicle') {
        if (locationBox) {
            locationBox.style.opacity = '0.4';
            locationBox.style.pointerEvents = 'none';
            locationBox.style.position = 'relative';
            // Add overlay label
            let lbl = locationBox.querySelector('.vehicle-note');
            if (!lbl) {
                lbl = document.createElement('p');
                lbl.className = 'vehicle-note';
                lbl.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(235,103,83,0.12);color:var(--primary,#EB6753);font-weight:600;font-size:13px;padding:6px 14px;border-radius:8px;white-space:nowrap;pointer-events:none;';
                lbl.textContent = '📍 Location not required for vehicles';
                locationBox.appendChild(lbl);
            }
        }
        if (priceLabel) priceLabel.innerText = 'Price in Kigali (RWF/day) *';
        if (vehiclePricingGroup) vehiclePricingGroup.style.display = '';
        locationInputs.forEach(el => el.removeAttribute('required'));
    } else {
        if (locationBox) {
            locationBox.style.opacity = '';
            locationBox.style.pointerEvents = '';
            const lbl = locationBox.querySelector('.vehicle-note');
            if (lbl) lbl.remove();
        }
        if (priceLabel) priceLabel.innerText = 'Price per Night (RWF) *';
        if (vehiclePricingGroup) vehiclePricingGroup.style.display = 'none';
    }
    // Reload amenity chips for the selected category
    updateAmenitiesForCategory();
}
window.updateFormLabels = updateFormLabels;

// ── Stepper helper ──
function stepField(id, delta) {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = parseInt(el.value) || 0;
    el.value = Math.max(0, cur + delta);
}
window.stepField = stepField;

// ── FA6 Free icon map by slug (overrides any broken DB icons) ──
const AMENITY_ICONS = {
    air_conditioning:  'fa-solid fa-snowflake',
    wifi:              'fa-solid fa-wifi',
    pool:              'fa-solid fa-person-swimming',
    parking:           'fa-solid fa-square-parking',
    kitchen:           'fa-solid fa-utensils',
    generator:         'fa-solid fa-bolt',
    backup_generator:  'fa-solid fa-bolt',
    tv:                'fa-solid fa-tv',
    gym:               'fa-solid fa-dumbbell',
    laundry:           'fa-solid fa-rotate',
    washing_machine:   'fa-solid fa-rotate',
    balcony:           'fa-solid fa-building',
    security:          'fa-solid fa-shield-halved',
    breakfast:         'fa-solid fa-mug-hot',
    workspace:         'fa-solid fa-laptop',
    fireplace:         'fa-solid fa-fire',
    pet_friendly:      'fa-solid fa-paw',
    pets_allowed:      'fa-solid fa-paw',
    hot_tub:           'fa-solid fa-bath',
    elevator:          'fa-solid fa-up-down',
    cctv:              'fa-solid fa-camera',
    water_tank:        'fa-solid fa-droplet',
    garden:            'fa-solid fa-leaf',
    smoking_allowed:   'fa-solid fa-smoking',
    first_aid:         'fa-solid fa-briefcase-medical',
    fire_extinguisher: 'fa-solid fa-fire-extinguisher',
    gps:               'fa-solid fa-location-dot',
    driver_included:   'fa-solid fa-user-tie',
    full_tank:         'fa-solid fa-gas-pump',
    fuel_included:     'fa-solid fa-gas-pump',
    insurance:         'fa-solid fa-shield-halved',
    fully_insured:     'fa-solid fa-shield-halved',
    child_seat:        'fa-solid fa-baby',
    roadside_assist:   'fa-solid fa-wrench',
    sunroof:           'fa-solid fa-sun',
    four_by_four:      'fa-solid fa-truck-monster',
    bluetooth:         'fa-solid fa-headphones',
    bluetooth_audio:   'fa-solid fa-headphones',
    dash_cam:          'fa-solid fa-camera-retro',
    usb_charging:      'fa-solid fa-plug',
    swimming_pool:     'fa-solid fa-person-swimming',
    free_parking:      'fa-solid fa-square-parking',
    gps_navigation:    'fa-solid fa-location-dot',
};

// ── Amenity chip renderer — fetches from amenity_definitions table ──
let _amenityCache = null; // cache full list so we only fetch once per session

async function loadAmenityCheckboxes() {
    const container = document.getElementById('amenityCheckboxes');
    if (!container) return;

    const cat = document.getElementById('listCategory')?.value || '';
    const isVehicle = cat === 'vehicle';

    // Wait for supabase to be ready (in case modal opens before auth init)
    if (!_supabase) {
        container.innerHTML = '<span style="color:#bbb;font-size:13px;">Session not ready — please wait…</span>';
        return;
    }

    // Show loading state
    container.innerHTML = '<span style="color:#bbb;font-size:13px;"><i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px;"></i>Loading amenities…</span>';

    try {
        // Fetch once and cache
        if (!_amenityCache) {
            const { data, error } = await _supabase
                .from('amenity_definitions')
                .select('slug, label, icon, category')
                .order('label');
            if (error) throw error;
            _amenityCache = data || [];
        }

        // Known vehicle-specific slugs — fallback if DB category is null/empty
        const VEHICLE_SLUGS = new Set([
            'four_by_four','four_wd','awd','gps','gps_navigation','sunroof','leather_seats',
            'cruise_control','reverse_camera','backup_camera','dashcam','child_seat',
            'roof_rack','spare_tire','towing','bluetooth_audio','bluetooth','usb_charger',
            'entertainment_system','android_auto','apple_carplay','heated_seats',
        ]);

        // Filter by category: vehicle listings get vehicle + general, others get non-vehicle
        // Falls back to slug-based detection when DB category is empty/null
        const list = _amenityCache.filter(a => {
            const c = (a.category || '').toLowerCase();
            const slugIsVehicle = VEHICLE_SLUGS.has(a.slug) || VEHICLE_SLUGS.has((a.slug || '').toLowerCase());
            // If DB category is set, trust it; otherwise use slug-based fallback
            if (c === 'vehicle' || (c === '' && slugIsVehicle)) {
                return isVehicle; // vehicle amenity → only show for vehicle listings
            }
            if (c === 'real_estate' || (c === '' && !slugIsVehicle)) {
                return !isVehicle; // property amenity → only show for non-vehicle listings
            }
            // 'general' or unrecognised — show for both
            return true;
        });

        if (!list.length) {
            container.innerHTML = '<span style="color:#bbb;font-size:13px;">No amenities available.</span>';
            return;
        }

        // Group by category for visual sections
        const groups = {};
        list.forEach(a => {
            const g = a.category || 'General';
            if (!groups[g]) groups[g] = [];
            groups[g].push(a);
        });

        container.innerHTML = '';
        Object.keys(groups).forEach(groupName => {
            const items = groups[groupName];
            // Only show group label if more than one group
            if (Object.keys(groups).length > 1) {
                const lbl = document.createElement('div');
                lbl.style.cssText = 'width:100%;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#bbb;margin:10px 0 4px;';
                lbl.textContent = groupName;
                container.appendChild(lbl);
            }
            items.forEach(a => {
                // Use our guaranteed FA6-Free icon map, fall back to DB icon, then generic check
                const icon = AMENITY_ICONS[a.slug] || AMENITY_ICONS[a.slug?.toLowerCase().replace(/[\s/]+/g,'_')] || a.icon || 'fa-solid fa-circle-check';
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'am-chip';
                btn.dataset.am = a.slug;
                btn.innerHTML = `<i class="${icon}"></i> ${a.label}`;
                btn.addEventListener('click', () => btn.classList.toggle('active'));
                container.appendChild(btn);
            });
        });

    } catch (err) {
        console.error('[AMENITIES]', err);
        const offline = !navigator.onLine;
        container.innerHTML = `<span style="color:#e0a0a0;font-size:13px;">
            <i class="fa-solid fa-${offline ? 'wifi-slash' : 'triangle-exclamation'}" style="margin-right:5px;"></i>
            ${offline ? 'No internet — amenities unavailable' : 'Could not load amenities'}
        </span>`;
    }
}
window.loadAmenityCheckboxes = loadAmenityCheckboxes;

function updateAmenitiesForCategory() {
    if (!document.getElementById('listingModal')?.classList.contains('active')) return;
    loadAmenityCheckboxes();
}
window.updateAmenitiesForCategory = updateAmenitiesForCategory;

// populate filterProvince (for toolbar)
async function loadFilterProvinces() {
    const sel = document.getElementById('filterProvince');
    if (!sel) return;
    sel.innerHTML = '<option value="">Province</option>';
    const { data, error } = await _supabase.from('provinces').select('id, name').order('name');
    if (error) return console.error('loadFilterProvinces', error);
    (data || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.text = p.name;
        sel.appendChild(opt);
    });
    sel.disabled = false;
}

// load districts for filter toolbar and auto-trigger filtering
async function loadFilterDistricts() {
    const prov = document.getElementById('filterProvince').value;
    const sel = document.getElementById('filterDistrict');
    sel.innerHTML = '<option value="">District</option>';
    document.getElementById('filterSector').innerHTML = '<option value="">Sector</option>';
    document.getElementById('filterSector').disabled = true;
    if (!prov) { sel.disabled = true; filterListings(); return; }
    const { data, error } = await _supabase.from('districts').select('id, name').eq('province_id', prov).order('name');
    if (error) return console.error('loadFilterDistricts', error);
    (data || []).forEach(d => {
        const opt = document.createElement('option'); opt.value = d.id; opt.text = d.name; sel.appendChild(opt);
    });
    sel.disabled = false;
    // Immediately update listings for province-level selection
    await filterListings();
}

// load sectors for filter toolbar and trigger listings update
async function loadFilterSectors() {
    const dist = document.getElementById('filterDistrict').value;
    const sel = document.getElementById('filterSector');
    sel.innerHTML = '<option value="">Sector</option>';
    if (!dist) { sel.disabled = true; filterListings(); return; }
    const { data, error } = await _supabase.from('sectors').select('id, name').eq('district_id', dist).order('name');
    if (error) return console.error('loadFilterSectors', error);
    (data || []).forEach(s => {
        const opt = document.createElement('option'); opt.value = s.id; opt.text = s.name; sel.appendChild(opt);
    });
    sel.disabled = false;
    await filterListings();
}


/* ===========================
   PANEL SWITCHING
   =========================== */
function togglePanels(panelId) {
    console.log("📄 [PANEL] Switching to:", panelId);
    
    const panels = $$('.content-panel');
    panels.forEach(p => p.classList.remove('active'));
    
    const target = document.getElementById(panelId);
    if (target) {
        target.classList.add('active');
        console.log("✅ [PANEL] Panel activated:", panelId);
    } else {
        console.warn("⚠️ [PANEL] Panel not found:", panelId);
    }
}

/* ===========================
   MODAL MANAGEMENT
   =========================== */
function openModal(modalId) {
    console.log("🔓 [MODAL] Opening:", modalId);
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        // Always (re)load amenity chips when the listing modal opens
        if (modalId === 'listingModal') {
            loadAmenityCheckboxes();
        }
    } else {
        console.warn("⚠️ [MODAL] Modal not found:", modalId);
    }
}

function closeModal(modalId) {
    console.log("🔒 [MODAL] Closing:", modalId);
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        // Reset form + amenity chips when listing modal closes
        if (modalId === 'listingModal') {
            const form = document.getElementById('listingForm');
            if (form) form.reset();
            document.querySelectorAll('#amenityCheckboxes .am-chip').forEach(c => c.classList.remove('active'));
        }
    }
}

/* ===========================
   AUTHENTICATION & ROLE
   =========================== */
async function initAuthAndRole() {
    console.log("🔐 [AUTH] Initializing authentication...");
    
    try {
        const { data: userData, error: userErr } = await _supabase.auth.getUser();
        
        if (userErr) {
            console.error("❌ [AUTH] Error getting user:", userErr);
            applyRoleToUI(null);
            return;
        }
        
        const user = userData?.user;
        if (!user) {
            console.warn("⚠️ [AUTH] No logged-in user detected");
            applyRoleToUI(null);
            return;
        }

        CURRENT_USER = user;
        console.log("✅ [AUTH] User authenticated:", user.email);
        
        // Fetch profile
        const { data: profile, error: pErr } = await _supabase
            .from('profiles')
            .select('id, full_name, email, role, avatar_seed')
            .eq('id', user.id)
            .single();

        if (pErr) {
            console.error("❌ [AUTH] Failed to load profile:", pErr);
            applyRoleToUI(null);
            return;
        }

        CURRENT_PROFILE = profile;
        CURRENT_ROLE = (profile.role || 'user');
        console.log("✅ [AUTH] Profile loaded. Role:", CURRENT_ROLE);

        // place inside initAuthAndRole() after CURRENT_ROLE set
        if (CURRENT_ROLE !== 'admin' && CURRENT_ROLE !== 'owner') {
        console.warn('Not an admin/owner — redirecting from dashboard');
        // friendly message then redirect
        alert('You do not have permission to access the dashboard.');
        window.location.href = '/index.html';
        return;
        }


        // Update UI with user info
        const adminName = $('#adminName');
        const adminEmailDisplay = $('#adminEmailDisplay');
        const adminAvatar = $('#adminAvatar');

        if (adminName) adminName.innerText = profile.full_name || "No name";
        if (adminEmailDisplay) adminEmailDisplay.innerText = profile.email || user.email || '';
        if (adminAvatar && profile.full_name) {
            adminAvatar.innerText = initials(profile.full_name);
        }

        // Apply role-based UI
        applyRoleToUI(CURRENT_ROLE);

    } catch (err) {
        console.error("❌ [AUTH] Exception in initAuthAndRole:", err);
        applyRoleToUI(null);
    }
    await populatePromoListings();
    // after initAuthAndRole() finishes
    await loadFilterProvinces();

    await loadProvinces();
    await loadDistricts();
    await loadSectors();
}


async function deleteListing(listingId) {
    if (!confirm('Delete this listing permanently? This also removes media.')) return;
    try {
        // Archive snapshot before deletion
        await _supabase.rpc('archive_deleted_listing', {
            p_listing_id:   listingId,
            p_deleter_id:   CURRENT_PROFILE?.id   || null,
            p_deleter_name: CURRENT_PROFILE?.full_name || CURRENT_ROLE,
            p_reason:       'deleted_by_' + CURRENT_ROLE,
        });
        const { error } = await _supabase.from('listings').delete().eq('id', listingId);
        if (error) throw error;
        logAudit({ action: 'listing_deleted', entityType: 'listing', entityId: listingId, description: 'Listing deleted and archived by ' + (CURRENT_PROFILE?.full_name || CURRENT_ROLE) });
        toast('Listing deleted and archived.', 'success');
        await filterListings();
        await loadCounts();
    } catch (err) {
        logAudit({ action: 'listing_deleted_failed', entityType: 'listing', entityId: listingId, description: 'Failed to delete listing: ' + err.message, isError: true });
        console.error('deleteListing', err);
        toast('Failed to delete listing: ' + err.message, 'error');
    }
}


function initials(name) {
    return name.split(' ').map(s => s[0]?.toUpperCase() || '').slice(0, 2).join('');
}

// change role in profiles table
async function updateUserRole(userId, newRole) {
    if (!confirm(`Change role to "${newRole}" for this user?`)) return;
    try {
        const { error } = await _supabase.from('profiles').update({ role: newRole }).eq('id', userId);
        if (error) throw error;
        logAudit({ action: 'user_role_changed', entityType: 'user', entityId: userId, description: 'Role changed to "' + newRole + '" by admin' });
        toast('Role updated successfully.', 'success');
        await loadUsersTable();
    } catch (err) {
        logAudit({ action: 'user_role_change_failed', entityType: 'user', entityId: userId, description: 'Failed to change role to "' + newRole + '": ' + err.message, isError: true });
        console.error('updateUserRole', err);
        toast('Failed to update role: ' + (err.message || JSON.stringify(err)), 'error');
    }
}

async function toggleUserBan(userId, action) {
    try {
        const banned = action === 'banned';
        const { error } = await _supabase.from('profiles').update({ banned }).eq('id', userId);
        if (error) throw error;
        logAudit({ action: banned ? 'user_banned' : 'user_unbanned', entityType: 'user', entityId: userId, description: (banned ? 'User banned' : 'User unbanned') + ' by admin' });
        toast(banned ? 'User banned.' : 'User unbanned.', banned ? 'warning' : 'success');
        await loadUsersTable();
    } catch (err) {
        logAudit({ action: 'user_ban_toggle_failed', entityType: 'user', entityId: userId, description: 'Failed to toggle ban: ' + err.message, isError: true });
        console.error('toggleUserBan', err);
        toast('Failed to change user status.', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('Delete this user and profile? This is permanent.')) return;
    try {
        const { error } = await _supabase.from('profiles').delete().eq('id', userId);
        if (error) throw error;
        logAudit({ action: 'user_deleted', entityType: 'user', entityId: userId, description: 'User profile hard-deleted by admin' });
        toast('User profile deleted.', 'success');
        await loadUsersTable();
        await loadCounts();
    } catch (err) {
        logAudit({ action: 'user_deleted_failed', entityType: 'user', entityId: userId, description: 'Failed to delete user: ' + err.message, isError: true });
        console.error('deleteUser', err);
        toast('Failed to delete user: ' + (err.message || JSON.stringify(err)), 'error');
    }
}

// expose globally (so inline onclick can call them)
window.updateUserRole = updateUserRole;
window.toggleUserBan = toggleUserBan;
window.deleteUser = deleteUser;


/* ===========================
   ROLE-BASED UI CONTROL
   =========================== */
function applyRoleToUI(role) {
    console.log("🎭 [ROLE] Applying role-based UI for:", role || "GUEST");
    
    // Helper functions
    const show = (tabName) => {
        const btn = $(`.nav-btn[data-tab="${tabName}"]`);
        if (btn) {
            btn.style.display = '';
            console.log(`  👁️ Showing tab: ${tabName}`);
        }
    };
    
    const hide = (tabName) => {
        const btn = $(`.nav-btn[data-tab="${tabName}"]`);
        if (btn) {
            btn.style.display = 'none';
            console.log(`  🙈 Hiding tab: ${tabName}`);
        }
    };

    // Reset: show basic tabs
    ['dashboard', 'listings', 'bookings', 'messages', 'settings'].forEach(t => show(t));
    
    // Hide advanced tabs by default
    hide('users');
    hide('events');
    hide('promotions');

    const createListingBtn = $('#openCreateListingBtn');
    const quickMenu = $('#quickMenu');

    // No role (not logged in)
    if (!role) {
        console.log("  🚫 No role - limiting UI");
        hide('bookings');
        hide('messages');
        if (createListingBtn) createListingBtn.style.display = 'none';
        if (quickMenu) quickMenu.querySelectorAll('button').forEach(b => b.style.display = 'none');
        return;
    }

    // ADMIN: sees everything
    if (role === 'admin') {
        console.log("  👑 ADMIN role - showing all features");
        ['users', 'messages', 'listing-requests', 'events', 'promotions'].forEach(t => show(t));
        if (createListingBtn) createListingBtn.style.display = '';
        if (quickMenu) quickMenu.querySelectorAll('button').forEach(b => b.style.display = '');
        // Show owner-assignment field for admin
        const assignGroup = document.getElementById('assignOwnerGroup');
        if (assignGroup) assignGroup.style.display = '';
        // Inject listing-requests nav button if not in HTML
        injectListingRequestsTab();
    }
    // OWNER: manages listings and bookings
    else if (role === 'owner') {
        console.log("  🏠 OWNER role - showing owner features");
        show('listings');
        show('bookings');
        show('promotions');
        hide('messages');
        hide('users');

        // Relabel stat cards for owner context
        // Try multiple selector strategies to find the label element
        const userCard = document.querySelector('#totalUsers')?.closest('.stat-card, [class*=stat], [class*=card]');
        if (userCard) {
            const lbl = userCard.querySelector('.stat-label, .stat-lbl, label, p, small, span:not(#totalUsers)');
            if (lbl) lbl.textContent = 'Total Clients';
            // Also try direct next sibling / parent text nodes
        }
        // Fallback: brute-force find any element containing "Total Users" text
        document.querySelectorAll('.stat-label, .stat-lbl, [class*=label]').forEach(el => {
            if (el.textContent.trim().toLowerCase() === 'total users') el.textContent = 'Total Clients';
        });

        const revLbl = document.querySelector('#totalRevenue')?.closest('.stat-card, [class*=stat], [class*=card]')
            ?.querySelector('.stat-label, .stat-lbl, p, label, small, span:not(#totalRevenue)');
        if (revLbl) revLbl.textContent = 'My Revenue';

        // Hide the "New Listings" pending widget — only admins need it
        setTimeout(() => {
            const pendingWrap = document.getElementById('dashPendingListings')
                ?.closest('.data-section, [class*=section]');
            if (pendingWrap) pendingWrap.style.display = 'none';
        }, 100);

        if (createListingBtn) createListingBtn.style.display = '';

        if (quickMenu) {
            quickMenu.querySelectorAll('button').forEach(b => {
                const txt = b.innerText.toLowerCase();
                if (txt.includes('listing')) {
                    b.style.display = '';
                } else {
                    b.style.display = 'none';
                }
            });
        }
    } 
    // USER: minimal access
    else if (role === 'user') {
        console.log("  👤 USER role - showing user features");
        show('dashboard');
        show('bookings');
        show('messages');
        hide('listings');
        hide('users');

        if (createListingBtn) createListingBtn.style.display = 'none';
        if (quickMenu) quickMenu.querySelectorAll('button').forEach(b => b.style.display = 'none');
    }
}

/* ===========================
   DATA LOADING
   =========================== */
// add near other filters
async function filterListings() {
    const qtext = (document.getElementById('listingSearchInput')?.value || '').trim();
    const province = document.getElementById('filterProvince')?.value;
    const district = document.getElementById('filterDistrict')?.value;
    const sector = document.getElementById('filterSector')?.value;

    // call a more generic listing loader with filters
    await loadListingsGrid({ qtext, province, district, sector });
    }

    // bind Enter to search input (add this in bindUIInteractions())
    const listingSearchInput = document.getElementById('listingSearchInput');
    if (listingSearchInput) {
    listingSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
        e.preventDefault();
        filterListings();
        }
    });
}
// call this from filterListings() or loadListingsTable() when you want grid
async function loadListingsGrid(filters = {}, page = 0) {
    const container = document.getElementById('listingsGrid');
    if (!container) return;
    const PAGE_SIZE = 15;
    const start = page * PAGE_SIZE, end = start + PAGE_SIZE - 1;
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
    container.innerHTML = '<div style="padding:20px;grid-column:1/-1">Loading...</div>';

    let q = _supabase
        .from('listings')
        .select('id,title,price,currency,availability_status,status,owner_id,province_id,district_id,sector_id,category_slug,created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(start, end);

    if (filters.qtext) q = q.ilike('title', `%${filters.qtext}%`);
    if (filters.province) q = q.eq('province_id', filters.province);
    if (filters.district) q = q.eq('district_id', filters.district);
    if (filters.sector) q = q.eq('sector_id', filters.sector);
    if (filters.category) q = q.eq('category_slug', filters.category);

    if (CURRENT_ROLE === 'owner') q = q.eq('owner_id', CURRENT_PROFILE.id);

    const { data, error, count } = await q;
    if (error) { container.innerHTML = `<div style="padding:20px;color:red">Error: ${error.message}</div>`; return; }
    if (!data || data.length === 0) { container.innerHTML = '<div style="padding:20px">No listings match.</div>'; return; }

    // Batch-fetch first image per listing (cached 2 min)
    const listingIds = data.map(l => l.id);
    const imageMap = await cImageMap(listingIds);

    // Fetch owner names
    const ownerIds = [...new Set(data.map(l => l.owner_id).filter(Boolean))];
    const ownerMap = {};
    if (ownerIds.length) {
        const { data: owners } = await _supabase.from('profiles').select('id,full_name').in('id', ownerIds);
        (owners || []).forEach(o => ownerMap[o.id] = o.full_name);
    }

    container.innerHTML = '';
    for (const l of data) {
        const thumb = imageMap[l.id] || null;
        const availBadgeColor = l.availability_status === 'available' ? '#2ecc71' : l.availability_status === 'booked' ? '#e74c3c' : '#95a5a6';
        const statusBadgeColor = l.status === 'approved' ? '#2ecc71' : l.status === 'pending' ? '#f39c12' : '#95a5a6';
        const card = document.createElement('div');
        card.className = 'listing-card';
        card.style.cssText = 'background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);display:flex;flex-direction:column;';
        card.innerHTML = `
            <a href="/Listings/Detail/?id=${l.id}" style="text-decoration:none;color:inherit;display:block;">
                <div style="height:180px;background:#f0f0f0;overflow:hidden;position:relative;">
                    ${thumb
                        ? `<img src="${thumb}" alt="${escapeHtml(l.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">`
                        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-image" style="font-size:32px;color:#ccc;"></i></div>`}
                    <span style="position:absolute;top:8px;left:8px;background:${availBadgeColor};color:#fff;font-size:11px;padding:3px 8px;border-radius:20px;font-weight:600;">${l.availability_status || 'available'}</span>
                    <span style="position:absolute;top:8px;right:8px;background:${statusBadgeColor};color:#fff;font-size:11px;padding:3px 8px;border-radius:20px;font-weight:600;">${l.status || 'pending'}</span>
                </div>
            </a>
            <div style="padding:14px;flex:1;display:flex;flex-direction:column;gap:6px;">
                <a href="/Listings/Detail/?id=${l.id}" style="text-decoration:none;"><h4 style="margin:0;font-size:15px;font-weight:600;color:#222;">${escapeHtml(l.title)}</h4></a>
                <p style="margin:0;color:#888;font-size:13px;">${l.category_slug || ''} • ${ownerMap[l.owner_id] || 'Unknown'}</p>
                <p style="margin:0;color:var(--primary,#EB6753);font-weight:700;font-size:14px;">${Number(l.price).toLocaleString()} ${l.currency || 'RWF'}</p>
                <div style="display:flex;gap:6px;margin-top:auto;padding-top:10px;flex-wrap:wrap;">
                    ${CURRENT_ROLE === 'admin' ? `
                        ${l.availability_status === 'available'
                            ? `<button class="btn-small" onclick="toggleListingAvailability('${l.id}','${l.availability_status}')" style="flex:1;background:#fff3e0;color:#e67e22;border:1px solid #f5cba7;font-weight:600;gap:5px;"><i class="fa-solid fa-eye-slash"></i> Disable</button>`
                            : `<button class="btn-small" onclick="toggleListingAvailability('${l.id}','${l.availability_status}')" style="flex:1;background:#e8f8f0;color:#27ae60;border:1px solid #a9dfbf;font-weight:600;gap:5px;"><i class="fa-solid fa-eye"></i> Enable</button>`
                        }
                        <button class="btn-small" onclick="deleteListing('${l.id}')" style="flex:1;background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;font-weight:600;gap:5px;"><i class="fa-solid fa-trash"></i> Delete</button>
                    ` : ''}
                    ${CURRENT_ROLE === 'owner' && l.availability_status !== 'booked' ? `
                        ${l.availability_status === 'available'
                            ? `<button class="btn-small" onclick="toggleListingAvailability('${l.id}','${l.availability_status}')" style="flex:1;background:#fff3e0;color:#e67e22;border:1px solid #f5cba7;font-weight:600;gap:5px;"><i class="fa-solid fa-eye-slash"></i> Set Unavailable</button>`
                            : `<button class="btn-small" onclick="toggleListingAvailability('${l.id}','${l.availability_status}')" style="flex:1;background:#e8f8f0;color:#27ae60;border:1px solid #a9dfbf;font-weight:600;gap:5px;"><i class="fa-solid fa-eye"></i> Set Available</button>`
                        }
                    ` : ''}
                </div>
            </div>
        `;
        container.appendChild(card);
    }

    // Pagination
    if (window.renderPagination) {
        const totalCount = count || data.length;
        const pageCount = Math.ceil(totalCount / PAGE_SIZE);
        renderPagination('dashListingsPagination', page, pageCount, totalCount, PAGE_SIZE, (newPage) => {
            loadListingsGrid(filters, newPage);
        });
    }
}


async function loadAllCountsAndTables() {
    console.log("📊 [DATA] Loading all data...");
    await Promise.all([
        loadCounts(),
        loadListingsTable(),
        loadBookingsTable(),
        loadUsersTable(),
        loadEventsCards(),
        loadPromotionsCards(),
        loadMessagesPreview()
    ]);
    // Owner-specific: load new (pending) bookings panel
    if (CURRENT_ROLE === 'owner') {
        loadNewBookings();
    }
    // Admin: inject listing-requests tab
    if (CURRENT_ROLE === 'admin') {
        loadListingRequests();
    }
    // Admin only: pending listings widget in dashboard tab
    if (CURRENT_ROLE === 'admin') {
        loadDashPendingListings();
    }
    console.log("✅ [DATA] All data loaded");
}

async function loadCounts() {
    console.log("🔢 [COUNTS] Loading dashboard counts...");
    
    try {
        if (!CURRENT_ROLE) {
            console.log("  No role - showing zeros");
            setCount('#totalUsers', 0);
            setCount('#totalListings', 0);
            setCount('#totalBookings', 0);
            setCount('#totalRevenue', '0 RWF');
            return;
        }

        if (CURRENT_ROLE === 'admin') {
            console.log("  Loading admin counts...");
            const { count: usersCount, error: e1 } = await _supabase.from('profiles').select('id', { count: 'exact', head: true });
            if (e1) console.error("Error counting users:", e1);
            
            const { count: listingsCount, error: e2 } = await _supabase.from('listings').select('id', { count: 'exact', head: true });
            if (e2) console.error("Error counting listings:", e2);
            
            const { count: bookingsCount, error: e3 } = await _supabase.from('bookings').select('id', { count: 'exact', head: true });
            if (e3) console.error("Error counting bookings:", e3);
            
            // Admin total revenue = sum of all approved bookings
            const { data: revRows } = await _supabase
                .from('bookings')
                .select('total_amount')
                .in('status', ['confirmed', 'approved', 'completed']);
            const adminRevenue = (revRows || []).reduce((s, r) => s + Number(r.total_amount || 0), 0);

            setCount('#totalUsers', usersCount || 0);
            setCount('#totalListings', listingsCount || 0);
            setCount('#totalBookings', bookingsCount || 0);
            setCount('#totalRevenue', Number(adminRevenue).toLocaleString('en-RW') + ' RWF');
        } 
        else if (CURRENT_ROLE === 'owner') {
            console.log("  Loading owner counts...");
            const { count: listingsCount } = await _supabase
                .from('listings')
                .select('id', { count: 'exact', head: true })
                .eq('owner_id', CURRENT_PROFILE.id);

            const listingIds = await fetchOwnerListingIds();
            const safeIds = listingIds.length ? listingIds : ['00000000-0000-0000-0000-000000000000'];

            // Total unique clients (distinct user_ids who have ever booked)
            const { data: clientRows } = await _supabase
                .from('bookings')
                .select('user_id')
                .in('listing_id', safeIds);
            const uniqueClients = new Set((clientRows || []).map(r => r.user_id)).size;

            // Total bookings
            const { count: bookingsCount } = await _supabase
                .from('bookings')
                .select('id', { count: 'exact', head: true })
                .in('listing_id', safeIds);

            // Total revenue (sum of approved bookings)
            const { data: revenueRows } = await _supabase
                .from('bookings')
                .select('total_amount')
                .in('listing_id', safeIds)
                .in('status', ['approved', 'completed']);
            const totalRevenue = (revenueRows || []).reduce((s, r) => s + Number(r.total_amount || 0), 0);

            setCount('#totalUsers', uniqueClients);
            setCount('#totalListings', listingsCount || 0);
            setCount('#totalBookings', bookingsCount || 0);
            setCount('#totalRevenue', Number(totalRevenue).toLocaleString('en-RW') + ' RWF');
            console.log(`  Owner stats: ${uniqueClients} clients, ${listingsCount} listings, ${totalRevenue} RWF`);
        } 
        else {
            console.log("  Loading user counts...");
            const { count: bookingsCount, error: e1 } = await _supabase
                .from('bookings')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', CURRENT_PROFILE.id);
            if (e1) console.error("Error counting user bookings:", e1);
            
            setCount('#totalUsers', 0);
            setCount('#totalListings', 0);
            setCount('#totalBookings', bookingsCount || 0);
            setCount('#totalRevenue', '0 RWF');
        }
        
        console.log("✅ [COUNTS] Dashboard counts updated");
    } catch (err) {
        console.error("❌ [COUNTS] Error loading counts:", err);
    }
}

function setCount(selector, value) {
    const el = $(selector);
    if (el) {
        el.innerText = value;
        console.log(`  📝 Set ${selector} = ${value}`);
    }
}

async function fetchOwnerListingIds() {
    if (!CURRENT_PROFILE) return [];
    const { data, error } = await _supabase
        .from('listings')
        .select('id')
        .eq('owner_id', CURRENT_PROFILE.id);
    
    if (error) {
        console.error("Error fetching owner listing IDs:", error);
        return [];
    }
    return data.map(r => r.id);
}
// Add this helper (requires UTILS.debounce if you have it, otherwise simple debounce inline)
window.searchOwners = _searchOwners;

async function _searchOwners(e) {
    const q = (e.target.value || '').trim();
    const resultsEl = document.getElementById('ownerResults');
    if (!resultsEl) return;

    if (!q || q.length < 2) {
        resultsEl.style.display = 'none';
        return;
    }

    // query profiles where role = owner and name matches (case-insensitive)
    const { data, error } = await _supabase
        .from('profiles')
        .select('id, full_name, email')
        .ilike('full_name', `%${q}%`)
        .limit(10);

    if (error) {
        console.error('owner search error', error);
        resultsEl.style.display = 'none';
        return;
    }

    resultsEl.innerHTML = '';
    (data || []).forEach(u => {
        const row = document.createElement('div');
        row.className = 'search-result-item';
        row.innerText = `${u.full_name} — ${u.email || ''}`;
        row.onclick = () => {
        document.getElementById('selectedOwnerId').value = u.id;
        document.getElementById('selectedOwnerName').innerText = `Assigned to: ${u.full_name}`;
        resultsEl.style.display = 'none';
        document.getElementById('ownerSearch').value = u.full_name;
        };
        resultsEl.appendChild(row);
    });

    resultsEl.style.display = (data && data.length) ? 'block' : 'none';
}


// Call loadProvinces() after initAuthAndRole() completes
async function loadProvinces() {
    const sel = document.getElementById('selProvince');
    if (!sel) return;
    sel.innerHTML = '<option value="">Province</option>';
    const { data, error } = await _supabase.from('provinces').select('id, name').order('name');
    if (error) { console.error('loadProvinces', error); return; }
    (data||[]).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.text = p.name;
        sel.appendChild(opt);
    });
    sel.disabled = false;
}

// loadDistricts uses currently selected province
async function loadDistricts() {
    const prov = document.getElementById('selProvince').value;
    const sel = document.getElementById('selDistrict');
    const sectorSel = document.getElementById('selSector');
    sel.innerHTML = '<option value="">District</option>';
    sectorSel.innerHTML = '<option value="">Sector</option>'; sectorSel.disabled = true;

    if (!prov) { sel.disabled = true; return; }

    const { data, error } = await _supabase.from('districts').select('id, name, province_id').eq('province_id', prov).order('name');
    if (error) { console.error('loadDistricts', error); return; }
    (data||[]).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.text = d.name;
        sel.appendChild(opt);
    });
    sel.disabled = false;
}

// loadSectors uses selected district
async function loadSectors() {
    const dist = document.getElementById('selDistrict').value;
    const sel = document.getElementById('selSector');
    sel.innerHTML = '<option value="">Sector</option>';
    if (!dist) { sel.disabled = true; return; }

    const { data, error } = await _supabase.from('sectors').select('id, name, district_id').eq('district_id', dist).order('name');
    if (error) { console.error('loadSectors', error); return; }
    (data||[]).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.text = s.name;
        sel.appendChild(opt);
    });
    sel.disabled = false;
}


/* ===========================
   LISTINGS TABLE
   =========================== */
async function loadListingsTable(page = 0) {
    await loadListingsGrid({}, page);
}

/* ===========================
   BOOKINGS TABLE
   =========================== */
async function loadBookingsTable(page = 0, searchTerm = '') {
    console.log("📅 [BOOKINGS] Loading bookings table...");

    const tbody = $('#allBookingsBody');
    if (!tbody) {
        console.warn("⚠️ [BOOKINGS] Table body not found");
        return;
    }

    tbody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';

    try {
        let q = _supabase.from('bookings').select('id, listing_id, start_date, end_date, total_amount, status, payment_status, payment_method, user_id, guest_name, guest_email, created_at, category_slug, price_zone', { count: 'exact' });

        if (CURRENT_ROLE === 'owner') {
            console.log("  Filtering for owner's listing bookings");
            const listingIds = await fetchOwnerListingIds();
            if (!listingIds.length) {
                tbody.innerHTML = '<tr><td colspan="7">No bookings for your listings.</td></tr>';
                return;
            }
            q = q.in('listing_id', listingIds);
        } else if (CURRENT_ROLE === 'user') {
            console.log("  Filtering for user's bookings");
            q = q.eq('user_id', CURRENT_PROFILE.id);
        }

        if (searchTerm) {
            // Also search by listing title: fetch matching listing IDs first
            const { data: matchedLst } = await _supabase
                .from('listings').select('id').ilike('title', `%${searchTerm}%`);
            const lstIds = (matchedLst || []).map(l => l.id);
            let orParts = [`guest_name.ilike.%${searchTerm}%`, `guest_email.ilike.%${searchTerm}%`];
            if (lstIds.length) orParts.push(`listing_id.in.(${lstIds.join(',')})`);
            q = q.or(orParts.join(','));
        }

        const PAGE_SIZE = 15;
        const start = page * PAGE_SIZE, end = start + PAGE_SIZE - 1;
        const { data, error, count } = await q.order('created_at', { ascending: false }).range(start, end);
        
        if (error) {
            console.error("❌ [BOOKINGS] Error loading bookings:", error);
            tbody.innerHTML = `<tr><td colspan="8">Error: ${error.message}</td></tr>`;
            return;
        }

        if (!data || data.length === 0) {
            console.log("  No bookings found");
            tbody.innerHTML = '<tr><td colspan="8">No bookings found.</td></tr>';
            return;
        }

        console.log(`  Found ${data.length} bookings`);

        tbody.innerHTML = '';
        
        for (let i = 0; i < data.length; i++) {
            const r = data[i];
            
            const { data: listing } = await _supabase
                .from('listings')
                .select('title, owner_id, category_slug')
                .eq('id', r.listing_id)
                .maybeSingle();
            const rowCat = r.category_slug || listing?.category_slug || 'real_estate';
            const isVehRow = rowCat === 'vehicle';
            
            const row = document.createElement('tr');
            // Determine which action buttons to show
            const isOwnerRow  = CURRENT_ROLE === 'owner' && listing?.owner_id === CURRENT_PROFILE?.id;
            const isAdminRow  = CURRENT_ROLE === 'admin';
            const needsAction = isOwnerRow || isAdminRow;
            const canApprove  = needsAction && ['awaiting_approval', 'pending'].includes(r.status);
            const canReject   = needsAction && (r.status === 'awaiting_approval' || r.status === 'pending' || r.status === 'confirmed');
            const isPaid      = r.status === 'confirmed' || r.status === 'approved' || r.status === 'completed';
            const hasFailed   = r.status === 'payment_failed';

            const statusLabels = {
                awaiting_approval: '⏳ Awaiting Approval',
                pending:           '⏳ Pending',
                payment_pending:   '💳 Charging...',
                payment_failed:    '❌ Payment Failed',
                confirmed:         '✅ Confirmed',
                approved:          '✅ Approved',
                rejected:          '❌ Rejected',
                cancelled:         '🚫 Cancelled',
                completed:         '🏁 Completed',
            };
            const statusLabel = statusLabels[r.status] || r.status;
            const fmtAmt = Number(r.total_amount || 0).toLocaleString('en-RW');
            const pmLabel = (r.payment_method || '—').replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());

            row.innerHTML = `
                <td><input type="checkbox" class="booking-cb" data-id="${r.id}" onchange="toggleBookingCheck('${r.id}',this.checked)" style="width:15px;height:15px;accent-color:var(--primary,#EB6753);"></td>
                <td>${i + 1}.</td>
                <td style="font-family:monospace;font-size:12px;">${shortId(r.id)}</td>
                <td>${escapeHtml(listing?.title || '—')}</td>
                <td style="font-size:12px;">${r.guest_name || shortId(r.user_id)}<br><span style="color:#aaa;font-size:11px;">${r.guest_email || ''}</span></td>
                <td style="font-size:12px;">
                    <span style="font-size:10px;color:#aaa;">${isVehRow ? 'Pick-up' : 'Check-in'}:</span> ${r.start_date}<br>
                    <span style="font-size:10px;color:#aaa;">${isVehRow ? 'Return' : 'Check-out'}:</span> ${r.end_date}
                    ${isVehRow && r.price_zone ? `<br><span style="font-size:10px;color:#aaa;">${r.price_zone === 'outside_kigali' ? '🌍 Outside Kigali' : '🏙️ Kigali'}</span>` : ''}
                </td>
                <td style="font-weight:700;color:#EB6753;">${fmtAmt} RWF<br><span style="font-size:11px;color:#aaa;font-weight:400;">${pmLabel}</span></td>
                <td>
                    <span class="status-badge status-${r.status}" style="white-space:nowrap;">${statusLabel}</span>
                    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">
                        ${canApprove ? `
                            <button class="btn-small" style="background:#e8f8f0;color:#27ae60;border:1px solid #a9dfbf;font-weight:600;gap:5px;" onclick="approveBooking('${r.id}')">
                                <i class="fa-solid fa-check"></i> Approve
                            </button>` : ''}
                        ${canReject ? `
                            <button class="btn-small" style="background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;font-weight:600;gap:5px;" onclick="rejectBooking('${r.id}')">
                                <i class="fa-solid fa-xmark"></i> Reject
                            </button>` : ''}
                        ${isPaid ? `
                            <button class="btn-small" style="background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;font-weight:600;gap:5px;" onclick="downloadReceipt('${r.id}')">
                                <i class="fa-solid fa-receipt"></i> Receipt
                            </button>` : ''}
                        ${hasFailed ? `
                            <span style="font-size:11px;color:#e74c3c;display:block;margin-top:2px;">
                                Payment could not be processed
                            </span>` : ''}
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        }

        console.log("✅ [BOOKINGS] Table populated");

        if (window.renderPagination) {
            const pageCount = Math.ceil((count || data.length) / PAGE_SIZE);
            renderPagination('dashBookingsPagination', page, pageCount, count || data.length, PAGE_SIZE, (p) => loadBookingsTable(p, searchTerm));
        }

    } catch (err) {
        console.error("❌ [BOOKINGS] Exception:", err);
        tbody.innerHTML = '<tr><td colspan="8">Failed to load bookings</td></tr>';
    }
}

/* ===========================
   USERS TABLE
   =========================== */
async function loadUsersTable(searchTerm = '', page = 0) {
    console.log("👥 [USERS] Loading users table (search:", searchTerm || 'none', ")");

    const tbody = $('#usersTableBody');
    if (!tbody) return;

    if (CURRENT_ROLE !== 'admin') {
        tbody.innerHTML = '<tr><td colspan="8">Only admins can manage users.</td></tr>';
        return;
    }

    tbody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';

    try {
        const PAGE_SIZE = 15;
        const start = page * PAGE_SIZE, end = start + PAGE_SIZE - 1;

        let q = _supabase
        .from('profiles')
        .select('id, full_name, email, phone, role, banned', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(start, end);

        if (searchTerm && searchTerm.length > 0) {
            q = q.or(`full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
        }

        const { data, error, count } = await q;
        if (error) {
            console.error('[USERS] error', error);
            tbody.innerHTML = `<tr><td colspan="8">Error: ${error.message}</td></tr>`;
            return;
        }
        if (!data || !data.length) {
            tbody.innerHTML = '<tr><td colspan="8">No users found.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        data.forEach((u, i) => {
            const tr = document.createElement('tr');
            const rowNum = page * PAGE_SIZE + i + 1;

            const roleSelectHtml = `
                <select class="status-select" onchange="updateUserRole('${u.id}', this.value)">
                <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
                <option value="owner" ${u.role === 'owner' ? 'selected' : ''}>owner</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
                </select>
            `;

            const isBanned = u.banned === true;
            const actionSelectHtml = (isBanned
                ? `<button class="btn-small" onclick="toggleUserBan('${u.id}','active')" style="background:#e8f8f0;color:#27ae60;border:1px solid #a9dfbf;font-weight:600;gap:4px;"><i class="fa-solid fa-unlock"></i> Unban</button>`
                : `<button class="btn-small" onclick="toggleUserBan('${u.id}','banned')" style="background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;font-weight:600;gap:4px;"><i class="fa-solid fa-ban"></i> Ban</button>`) +
                `<button class="btn-small" onclick="impersonateUser('${u.id}','${escapeHtml(u.email||'').replace(/'/g,'&apos;')}')" style="background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;font-weight:600;gap:4px;margin-left:4px;" title="Login as this user"><i class="fa-solid fa-user-secret"></i></button>`;

            tr.innerHTML = `
                <td>${rowNum}.</td>
                <td>${escapeHtml(u.full_name || '')}</td>
                <td>${escapeHtml(u.email || '')}</td>
                <td>${escapeHtml(u.phone || '')}</td>
                <td>${roleSelectHtml}</td>
                <td>-</td>
                <td>${actionSelectHtml}</td>
                <td>
                <button class="btn-small" onclick="deleteUser('${u.id}')" style="background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;font-weight:600;gap:4px;"><i class="fa-solid fa-trash"></i> Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (window.renderPagination) {
            const pageCount = Math.ceil((count || data.length) / PAGE_SIZE);
            renderPagination('dashUsersPagination', page, pageCount, count || data.length, PAGE_SIZE, (p) => loadUsersTable(searchTerm, p));
        }

        console.log("✅ [USERS] Table populated");
    } catch (err) {
        console.error('❌ [USERS] Exception:', err);
        tbody.innerHTML = '<tr><td colspan="8">Failed to load users</td></tr>';
    }
}



/* ===========================
   MESSAGES PANEL
   =========================== */
async function loadMessagesPreview() {
    console.log("💬 [MESSAGES] Loading messages...");
    const list = $('#chatUserList');
    if (!list) return;

    const headerHTML = '<div class="chat-list-header">Inbox</div>';
    list.innerHTML = headerHTML + '<div style="padding:40px 20px;text-align:center;color:#ccc;"><i class="fa-solid fa-circle-notch fa-spin" style="font-size:24px;display:block;margin-bottom:10px;"></i><span style="font-size:13px;">Loading…</span></div>';

    if (!CURRENT_ROLE || CURRENT_ROLE !== 'admin') {
        list.innerHTML = headerHTML + '<div style="padding:40px 20px;text-align:center;color:#ccc;"><i class="fa-solid fa-lock" style="font-size:28px;display:block;margin-bottom:10px;"></i><span style="font-size:13px;">Admin access only.</span></div>';
        return;
    }

    const { data, error } = await _supabase
        .from('contact_messages')
        .select('id, name, email, message, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        const offline = !navigator.onLine;
        list.innerHTML = headerHTML + `<div style="padding:40px 20px;text-align:center;color:#ccc;">
            <i class="fa-solid fa-${offline ? 'wifi-slash' : 'triangle-exclamation'}" style="font-size:28px;display:block;margin-bottom:10px;color:#e0a0a0;"></i>
            <span style="font-size:13px;color:#c0392b;">${offline ? 'No internet' : 'Could not load messages'}</span>
        </div>`;
        return;
    }
    if (!data || !data.length) {
        list.innerHTML = headerHTML + '<div style="padding:40px 20px;text-align:center;color:#ccc;"><i class="fa-solid fa-inbox" style="font-size:28px;display:block;margin-bottom:10px;"></i><span style="font-size:13px;">No messages yet.</span></div>';
        return;
    }

    list.innerHTML = headerHTML;
    data.forEach((m, i) => {
        const el = document.createElement('div');
        el.className = 'chat-user-item' + (i === 0 ? ' active' : '');
        el.dataset.id = m.id;
        const initial = (m.name || 'U')[0].toUpperCase();
        const preview = (m.message || '').slice(0, 55) + ((m.message || '').length > 55 ? '…' : '');
        const timeStr = m.created_at ? _fmtMsgTime(m.created_at) : '';
        el.innerHTML = `
            <div class="chat-user-avatar">${escapeHtml(initial)}</div>
            <div class="chat-user-info">
                <h4>${escapeHtml(m.name || 'Unknown')}</h4>
                <p>${escapeHtml(preview)}</p>
            </div>
            <span class="chat-user-time">${timeStr}</span>
        `;
        el.addEventListener('click', () => {
            $$('.chat-user-item').forEach(x => x.classList.remove('active'));
            el.classList.add('active');
            showMessageDetail(m);
        });
        list.appendChild(el);
    });

    if (data.length) showMessageDetail(data[0]);
    console.log("✅ [MESSAGES] Loaded", data.length, "messages");
}

function _fmtMsgTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function showMessageDetail(m) {
    const area = $('#chatMessagesArea');
    if (!area) return;
    const date = m.created_at ? new Date(m.created_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : '';
    const initial = escapeHtml((m.name || 'U')[0].toUpperCase());
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.email || '')}&su=${encodeURIComponent('Re: Your message to AfriStay')}&body=${encodeURIComponent('Hi ' + (m.name || '') + ',\n\nThank you for reaching out to AfriStay!\n\n')}`;
    const mailtoUrl = `mailto:${encodeURIComponent(m.email || '')}?subject=${encodeURIComponent('Re: Your message to AfriStay')}&body=${encodeURIComponent('Hi ' + (m.name || '') + ',\n\n')}`;

    // Update header
    const win = area.closest('.chat-window');
    if (win) {
        let hdr = win.querySelector('.chat-win-header');
        if (!hdr) {
            hdr = document.createElement('div');
            hdr.className = 'chat-win-header';
            win.insertBefore(hdr, win.firstChild);
        }
        hdr.innerHTML = `
            <div class="chat-win-avatar">${initial}</div>
            <div>
                <div class="chat-win-name">${escapeHtml(m.name || 'Unknown')}</div>
                <div class="chat-win-sub">${escapeHtml(m.email || '')}</div>
            </div>
        `;
    }

    area.innerHTML = `
        <div style="padding:24px 28px;">
            <!-- Meta row -->
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
                <span style="font-size:12px;color:#bbb;"><i class="fa-regular fa-clock" style="margin-right:4px;"></i>${date}</span>
                <span style="color:#e8e8e8;">·</span>
                <a href="mailto:${escapeHtml(m.email || '')}" style="font-size:12px;color:var(--primary);text-decoration:none;font-weight:600;">${escapeHtml(m.email || '')}</a>
            </div>
            <!-- Message bubble -->
            <div style="background:#fff;border-radius:16px;padding:22px 24px;box-shadow:0 2px 12px rgba(0,0,0,.06);border-left:4px solid var(--primary);margin-bottom:20px;">
                <p style="font-size:15px;line-height:1.85;color:#333;margin:0;white-space:pre-wrap;">${escapeHtml(m.message || '')}</p>
            </div>
            <!-- Reply actions -->
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <a href="${gmailUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;background:var(--primary);color:#fff;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;transition:opacity .2s;" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
                    <i class="fa-solid fa-reply"></i> Reply via Gmail
                </a>
                <a href="${mailtoUrl}" style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;background:#f5f5f5;color:#555;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;transition:background .2s;" onmouseover="this.style.background='#ebebeb'" onmouseout="this.style.background='#f5f5f5'">
                    <i class="fa-solid fa-envelope"></i> Default Mail App
                </a>
            </div>
        </div>
    `;
}

/* ===========================
   ACTIONS
   =========================== */
async function approveListing(listingId) {
    console.log("✅ [ACTION] Approving listing:", listingId);
    if (!confirm('Approve this listing?')) return;
    try {
        const { error } = await _supabase
            .from('listings')
            .update({ status: 'approved' })
            .eq('id', listingId);
        if (error) throw error;
        logAudit({ action: 'listing_approved', entityType: 'listing', entityId: listingId, description: 'Listing approved by admin' });
        toast('Listing approved successfully!', 'success');
        await filterListings();
        loadAttentionItems();
    } catch (err) {
        logAudit({ action: 'listing_approved_failed', entityType: 'listing', entityId: listingId, description: 'Failed to approve listing: ' + err.message, isError: true });
        console.error("❌ [ACTION] Error approving listing:", err);
        toast('Failed to approve listing: ' + err.message, 'error');
    }
}

async function toggleListingAvailability(listingId, current) {
    console.log("🔄 [ACTION] Toggling listing availability:", listingId, current);
    try {
        const newStatus = (current === 'available') ? 'unavailable' : 'available';
        const { error } = await _supabase
            .from('listings')
            .update({ availability_status: newStatus })
            .eq('id', listingId);
        if (error) throw error;
        toast(`Listing set to "${newStatus}"`, 'success');
        await filterListings();
    } catch (err) {
        console.error("❌ [ACTION] Error toggling availability:", err);
        toast('Failed to change availability: ' + err.message, 'error');
    }
}

/* ═══════════════════════════════════════════════════════════════
   APPROVE / REJECT BOOKING — v3 clean flow (no payment)
   Owner approves → calls approve-booking edge function →
   Edge function emails guest a "Confirm Your Stay" link
   (When DPO is live: edge function emails a payment link instead)
   ═══════════════════════════════════════════════════════════════ */
async function approveBooking(bookingId) {
    console.log('✅ [APPROVE] Owner approving booking:', bookingId);

    // Load booking to show confirm dialog
    const { data: booking } = await _supabase
        .from('bookings').select('*, listings(title)').eq('id', bookingId).single();
    if (!booking) { toast('Booking not found', 'error'); return; }

    const title = booking.listings?.title || 'this listing';
    if (!confirm(`Approve booking for "${title}"?\n\nThe guest will receive an email to confirm their stay.`)) return;

    toast('Approving booking…', 'info');

    try {
        // Get auth session for the function call
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) throw new Error('Not logged in');

        const res = await fetch(CONFIG.FUNCTIONS_BASE + '/approve-booking', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Bearer ' + session.access_token,
                'apikey':        CONFIG.SUPABASE_KEY,
            },
            body: JSON.stringify({ booking_id: bookingId }),
        });

        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Approval failed');

        console.log('✅ [APPROVE] Done:', data);

        if (data.dpo_active) {
            toast('✅ Approved! Guest received a payment link.', 'success');
        } else {
            toast('✅ Approved! Guest received a confirmation email.', 'success');
        }

        logAudit({ action: 'booking_approved', entityType: 'booking', entityId: bookingId, description: 'Booking approved for "' + (booking.listings?.title || bookingId) + '"' });
        await loadBookingsTable();
        await loadCounts();

    } catch (err) {
        logAudit({ action: 'booking_approved_failed', entityType: 'booking', entityId: bookingId, description: 'Failed to approve booking: ' + err.message, isError: true });
        console.error('❌ [APPROVE]', err);
        toast('Failed to approve: ' + err.message, 'error');
    }
}

async function rejectBooking(bookingId) {
    console.log('❌ [REJECT] Rejecting booking:', bookingId);

    const { data: booking } = await _supabase
        .from('bookings').select('*, listings(title)').eq('id', bookingId).single();
    if (!booking) { toast('Booking not found', 'error'); return; }

    const title  = booking.listings?.title || 'this listing';
    const reason = prompt(`Reject booking for "${title}"?\n\nOptional: enter a reason for the guest (or leave blank):`) ;
    if (reason === null) return; // cancelled

    toast('Rejecting booking…', 'info');

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) throw new Error('Not logged in');

        const res = await fetch(CONFIG.FUNCTIONS_BASE + '/reject-booking', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Bearer ' + session.access_token,
                'apikey':        CONFIG.SUPABASE_KEY,
            },
            body: JSON.stringify({ booking_id: bookingId, reason: reason || null }),
        });

        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Rejection failed');

        logAudit({ action: 'booking_rejected', entityType: 'booking', entityId: bookingId, description: 'Booking rejected for "' + title + '"' + (reason ? ' — reason: ' + reason : '') });
        toast('Booking rejected. Guest has been notified.', 'success');
        await loadBookingsTable();
        await filterListings();

    } catch (err) {
        logAudit({ action: 'booking_rejected_failed', entityType: 'booking', entityId: bookingId, description: 'Failed to reject booking: ' + err.message, isError: true });
        console.error('❌ [REJECT]', err);
        toast('Failed to reject: ' + err.message, 'error');
    }
}

async function demoMarkPaid(bookingId) {
    console.log("💰 [DEMO] Marking booking as paid:", bookingId);
    
    if (!DEMO_MODE) {
        alert('Demo mode off');
        return;
    }
    
    if (!confirm('Mark booking as paid for demo?')) return;
    
    try {
        await _supabase.from('payments').insert({
            booking_id: bookingId,
            user_id: CURRENT_PROFILE?.id || null,
            provider: 'in_person',
            amount: 1,
            currency: 'RWF',
            status: 'success'
        });
        
        await _supabase
            .from('bookings')
            .update({ status: 'paid' })
            .eq('id', bookingId);
        
        try {
            await _supabase.rpc('generate_receipt', { p_booking_id: bookingId });
        } catch (e) {
            console.log("  Receipt generation skipped (function may not exist)");
        }
        
        toast('Marked as paid (demo).', 'success');
        console.log("✅ [DEMO] Booking marked as paid");
        await loadBookingsTable();
        await loadCounts();
    } catch (err) {
        console.error("❌ [DEMO] Error marking as paid:", err);
        alert('Failed to mark as paid.');
    }
}

async function promoteToOwner(userId) {
    console.log("⬆️ [ACTION] Promoting user to owner:", userId);
    
    if (!confirm('Promote this user to Owner?')) return;
    
    try {
        const { error } = await _supabase
            .from('profiles')
            .update({ role: 'owner' })
            .eq('id', userId);
        
        if (error) throw error;
        
        alert('User promoted to owner.');
        console.log("✅ [ACTION] User promoted successfully");
        await loadUsersTable();
    } catch (err) {
        console.error("❌ [ACTION] Error promoting user:", err);
        alert('Failed to promote user.');
    }
}

async function handleCreateListing() {
    console.log("➕ [LISTING] Creating new listing (with media)...");

    const title    = $('#listTitle')?.value?.trim();
    const price    = Number($('#listPrice')?.value || 0);
    const desc     = $('#listDesc')?.value?.trim();
    const category = $('#listCategory')?.value;
    const priceOutsideKigali = category === 'vehicle'
        ? (Number($('#listPriceOutside')?.value) || null)
        : null;
    // Admin picks an owner; owner always gets themselves
    const ownerId  = CURRENT_ROLE === 'admin'
        ? ($('#selectedOwnerId')?.value || (CURRENT_PROFILE && CURRENT_PROFILE.id))
        : (CURRENT_PROFILE && CURRENT_PROFILE.id);

    const provinceId = $('#selProvince')?.value || null;
    const districtId = $('#selDistrict')?.value || null;
    const sectorId   = $('#selSector')?.value || null;
    const address    = $('#listAddress')?.value?.trim() || '';

    // Specs
    const rooms     = parseInt($('#listRooms')?.value)     || null;
    const bathrooms = parseInt($('#listBathrooms')?.value) || null;
    const beds      = parseInt($('#listBeds')?.value)      || null;
    const maxGuests = parseInt($('#listMaxGuests')?.value)  || null;
    const floorArea = parseInt($('#listFloorArea')?.value)  || null;

    // Amenities
    const checkedAmenities = Array.from(document.querySelectorAll('#amenityCheckboxes .am-chip.active')).map(c => c.dataset.am);
    const amenitiesData = checkedAmenities.length ? checkedAmenities : null;

    const statusEl  = document.getElementById('listingCreateStatus');
    const createBtn = document.getElementById('createBtn');

    function setStatus(msg, type) {
        if (!statusEl) return;
        const colors = { info: '#e8f4fd', success: '#e9faf0', error: '#fdecea', warning: '#fff8e1' };
        const text   = { info: '#1565c0', success: '#1b7a3e', error: '#c0392b', warning: '#7c5c00' };
        statusEl.style.display  = 'block';
        statusEl.style.background = colors[type] || colors.info;
        statusEl.style.color    = text[type] || text.info;
        statusEl.style.border   = `1px solid ${text[type] || text.info}33`;
        statusEl.innerHTML      = msg;
    }
    function clearStatus() { if (statusEl) statusEl.style.display = 'none'; }

    if (!title || !price || !desc || !ownerId) {
        setStatus('Please fill in all required fields.', 'error');
        return;
    }

    const imagesInput = document.getElementById('listImageFiles');
    const videosInput = document.getElementById('listVideoFiles');
    const images = imagesInput ? Array.from(imagesInput.files || []) : [];
    const videos = videosInput ? Array.from(videosInput.files || []) : [];

    if (images.length > 10) { setStatus('Max 10 images allowed.', 'error'); return; }
    if (videos.length > 3)  { setStatus('Max 3 videos allowed.', 'error'); return; }

    if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Working…'; }
    clearStatus();

    try {
        // 1) Create listing row
        setStatus('<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px;"></i>Saving your listing…', 'info');
        const { data: created, error: createErr } = await _supabase
            .from('listings')
            .insert([{
                owner_id: ownerId,
                title,
                description: desc,
                price,
                currency: 'RWF',
                province_id: provinceId,
                district_id: districtId,
                sector_id: sectorId,
                address,
                category_slug: category,
                price_outside_kigali: priceOutsideKigali,
                rooms,
                bathrooms,
                beds,
                max_guests: maxGuests,
                floor_area: floorArea,
                amenities_data: amenitiesData,
                status: 'pending',
                availability_status: 'available'
            }])
            .select()
            .single();

        if (createErr) throw createErr;
        const listingId = created.id;

        // 2) Upload images
        const uploadedImageRows = [];
        for (let i = 0; i < images.length; i++) {
            const file = images[i];
            setStatus(`<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px;"></i>Uploading image ${i + 1} of ${images.length}: <strong>${file.name}</strong>…`, 'info');
            const path = `${ownerId}/${listingId}/${Date.now()}-${file.name}`;
            const { error: upErr } = await _supabase.storage.from('listing-images').upload(path, file, { upsert: false });
            if (upErr) {
                setStatus(`<i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>Image <strong>${file.name}</strong> failed: ${upErr.message}. Continuing with next…`, 'warning');
                await new Promise(r => setTimeout(r, 1500));
                continue;
            }
            const { data: urlData } = await _supabase.storage.from('listing-images').getPublicUrl(path);
            uploadedImageRows.push({ listing_id: listingId, image_url: urlData?.publicUrl || null, filename: file.name, mime_type: file.type });
        }
        if (uploadedImageRows.length) {
            const { error: imgErr } = await _supabase.from('listing_images').insert(uploadedImageRows);
            if (imgErr) console.warn('listing_images insert error', imgErr);
        }

        // 3) Upload videos
        const uploadedVideoRows = [];
        for (let i = 0; i < videos.length; i++) {
            const file = videos[i];
            setStatus(`<i class="fa-solid fa-circle-notch fa-spin" style="margin-right:6px;"></i>Uploading video ${i + 1} of ${videos.length}: <strong>${file.name}</strong>…`, 'info');
            const path = `${ownerId}/${listingId}/${Date.now()}-${file.name}`;
            const { error: upErr } = await _supabase.storage.from('listing-videos').upload(path, file, { upsert: false });
            if (upErr) {
                setStatus(`<i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>Video <strong>${file.name}</strong> failed: ${upErr.message}. Continuing with next…`, 'warning');
                await new Promise(r => setTimeout(r, 1500));
                continue;
            }
            const { data: urlData } = await _supabase.storage.from('listing-videos').getPublicUrl(path);
            uploadedVideoRows.push({ listing_id: listingId, video_url: urlData?.publicUrl || null, filename: file.name, mime_type: file.type });
        }
        if (uploadedVideoRows.length) {
            const { error: vidErr } = await _supabase.from('listing_videos').insert(uploadedVideoRows);
            if (vidErr) console.warn('listing_videos insert error', vidErr);
        }

        const mediaCount = uploadedImageRows.length + uploadedVideoRows.length;
        setStatus(
            `<i class="fa-solid fa-circle-check" style="margin-right:6px;"></i>` +
            `Listing submitted${mediaCount ? ` with ${mediaCount} file${mediaCount > 1 ? 's' : ''}` : ''}! ` +
            (CURRENT_ROLE === 'owner' ? 'An admin will review and approve it shortly.' : 'It is now pending approval.'),
            'success'
        );
        console.log('✅ Listing and media created');

    } catch (err) {
        console.error('❌ [LISTING] Error creating listing:', err);
        setStatus(`<i class="fa-solid fa-circle-xmark" style="margin-right:6px;"></i>Failed: ${err.message || 'Something went wrong. Please try again.'}`, 'error');
    } finally {
        if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create Listing'; }
    }
}

async function populatePromoListings() {
    const sel = document.getElementById('promoListingId');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- General Promo --</option>';
    let q = _supabase.from('listings').select('id, title').eq('status','approved').order('created_at', { ascending: false });
    // if owner, show only their listings
    if (CURRENT_ROLE === 'owner') q = q.eq('owner_id', CURRENT_PROFILE.id);
    const { data, error } = await q;
    if (error) return console.warn('populatePromoListings', error);
    (data||[]).forEach(l => {
        const o = document.createElement('option'); o.value = l.id; o.text = l.title; sel.appendChild(o);
    });
}


async function handleLogout() {
    console.log("🚪 [AUTH] Logging out...");
    
    try {
        await _supabase.auth.signOut();
        console.log("✅ [AUTH] Logged out successfully");
        window.location.href = "/";
    } catch (err) {
        console.error("❌ [AUTH] Error logging out:", err);
        location.reload();
    }
}

/* ===========================
    TABLE FILTERING
   =========================== */
function filterTable(inputId, tableBodyId) {
    const input = document.getElementById(inputId);
    const filter = input.value.toUpperCase();
    const tableBody = document.getElementById(tableBodyId);
    const rows = tableBody.getElementsByTagName('tr');

    for (let i = 0; i < rows.length; i++) {
        const textContent = rows[i].textContent || rows[i].innerText;
        rows[i].style.display = textContent.toUpperCase().indexOf(filter) > -1 ? "" : "none";
    }
}

/* ===========================
    UTILITY FUNCTIONS
   =========================== */
function shortId(id) {
    if (!id) return '—';
    return String(id).slice(0, 8) + '…';
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}


/* ===========================
   EVENTS
   =========================== */

/* ═══════════════════════════════════════════════
   EVENTS — cards display + create with 5 images
   ═══════════════════════════════════════════════ */
const EVENTS_STORAGE = 'event-images';

async function loadEventsCards(page = 0, searchTerm = '') {
    console.log('📅 [EVENTS] Loading events cards...');
    let container = document.getElementById('eventsCardsContainer');
    if (!container) {
        const panel = document.getElementById('eventsPanel');
        if (!panel) return;
        const old = panel.querySelector('.events-inner');
        if (old) old.remove();
        const wrap = document.createElement('div');
        wrap.className = 'events-inner';
        wrap.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">' +
            '<h3 style="font-size:18px;font-weight:700;color:#1a1a1a;margin:0;">Events</h3>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
            '<div style="display:flex;align-items:center;gap:8px;background:#f5f6fa;border:1.5px solid #ebebeb;border-radius:10px;padding:7px 12px;min-width:200px;" id="eventsSearchWrap">' +
            '<i class="fa-solid fa-magnifying-glass" style="color:#bbb;font-size:13px;flex-shrink:0;"></i>' +
            '<input id="eventsSearchInput" type="text" placeholder="Search events..." style="border:none;background:none;outline:none;font-size:13px;font-family:Inter,sans-serif;width:100%;color:#1a1a1a;">' +
            '</div>' +
            (CURRENT_ROLE === 'admin'
                ? '<button onclick="openCreateEventModal()" style="background:#EB6753;color:#fff;border:none;padding:10px 20px;border-radius:10px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;gap:6px;"><i class=\"fa-solid fa-plus\"></i> Add Event</button>'
                : '') +
            '</div></div>' +
            '<div id="eventsCardsContainer" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;"></div>' +
            '<div id="dashEventsPagination" style="margin-top:16px;"></div>';
        panel.prepend(wrap);
        // wire search input
        const evSI = document.getElementById('eventsSearchInput');
        if (evSI) {
            let evT; evSI.addEventListener('input', e => { clearTimeout(evT); evT = setTimeout(() => loadEventsCards(0, e.target.value.trim()), 350); });
            evSI.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); loadEventsCards(0, evSI.value.trim()); } });
            const wrap2 = document.getElementById('eventsSearchWrap');
            if (wrap2) { evSI.addEventListener('focus', ()=>wrap2.style.borderColor='var(--primary)'); evSI.addEventListener('blur', ()=>wrap2.style.borderColor='#ebebeb'); }
        }
        container = document.getElementById('eventsCardsContainer');
    }
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#aaa;">Loading events...</div>';
    const PAGE_SIZE = 15;
    const start = page * PAGE_SIZE, end = start + PAGE_SIZE - 1;
    try {
        let evQ = _supabase
            .from('events')
            .select('id,title,description,images,province_id,district_id,sector_id,location_label,landmark,start_date,end_date,created_at', { count: 'exact' })
            .order('start_date', { ascending: true })
            .range(start, end);
        if (searchTerm) evQ = evQ.ilike('title', `%${searchTerm}%`);
        const { data, error, count } = await evQ;
        if (error) throw error;
        if (!data || !data.length) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:#ccc;">' +
                '<i class="fa-regular fa-calendar" style="font-size:48px;margin-bottom:16px;display:block;"></i>' +
                '<p>No events yet.' + (CURRENT_ROLE==='admin' ? ' Create the first one!' : '') + '</p></div>';
            return;
        }
        container.innerHTML = '';
        data.forEach(ev => {
            const img     = ev.images && ev.images.length ? ev.images[0] : null;
            const sDate   = ev.start_date || ev.event_date;
            const eDate   = ev.end_date;
            const dateStr = sDate
                ? (eDate && eDate !== sDate
                    ? new Date(sDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' – ' + new Date(eDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
                    : new Date(sDate+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}))
                : '—';
            const locLine = [ev.location_label, ev.landmark].filter(Boolean).join(' · ');
            const card = document.createElement('div');
            card.style.cssText = 'background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);transition:transform 0.2s,box-shadow 0.2s;cursor:pointer;';
            card.onmouseenter = () => { card.style.transform='translateY(-4px)'; card.style.boxShadow='0 12px 32px rgba(0,0,0,0.14)'; };
            card.onmouseleave = () => { card.style.transform=''; card.style.boxShadow='0 4px 20px rgba(0,0,0,0.08)'; };
            card.innerHTML =
                '<div style="height:180px;overflow:hidden;background:#f0f0f0;position:relative;">' +
                (img ? '<img src="' + escapeHtml(img) + '" style="width:100%;height:100%;object-fit:cover;">' :
                    '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><i class="fa-regular fa-calendar" style="font-size:40px;color:#ddd;"></i></div>') +
                '<div style="position:absolute;top:12px;left:12px;background:rgba(235,103,83,0.9);color:#fff;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;">' +
                '<i class="fa-solid fa-calendar-day"></i> ' + dateStr + '</div></div>' +
                '<div style="padding:16px;">' +
                '<h4 style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 6px;">' + escapeHtml(ev.title) + '</h4>' +
                '<p style="font-size:13px;color:#888;margin:0 0 8px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">' + escapeHtml(ev.description||'') + '</p>' +
                (locLine ? '<p style="font-size:12px;color:#EB6753;margin:0 0 12px;"><i class="fa-solid fa-location-dot"></i> ' + escapeHtml(locLine) + '</p>' : '') +
                '<div style="display:flex;gap:8px;">' +
                '<a href="/Events/Event/?id=' + ev.id + '" style="flex:1;text-align:center;background:#f5f5f5;color:#333;padding:8px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;"><i class="fa-solid fa-eye"></i> View</a>' +
                (CURRENT_ROLE === 'admin'
                    ? '<button onclick="deleteEvent(\'' + ev.id + '\')" style="flex:1;background:#fde8e8;color:#e74c3c;border:none;padding:8px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;"><i class="fa-solid fa-trash"></i> Delete</button>'
                    : '') +
                '</div></div>';
            container.appendChild(card);
        });

        if (window.renderPagination) {
            const pageCount = Math.ceil((count || data.length) / PAGE_SIZE);
            renderPagination('dashEventsPagination', page, pageCount, count || data.length, PAGE_SIZE, (p) => loadEventsCards(p, searchTerm));
        }

        console.log('✅ [EVENTS] Cards rendered:', data.length);
    } catch (err) {
        console.error('❌ [EVENTS]', err);
        container.innerHTML = '<div style="grid-column:1/-1;color:red;padding:20px;">' + escapeHtml(err.message) + '</div>';
    }
}

/* ── Build event create modal completely in JS (no HTML dependency) ── */
async function openCreateEventModal() {
    let modal = document.getElementById('_createEventModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = '_createEventModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.body.appendChild(modal);
    }

    // Load provinces for dropdowns
    const { data: provs } = await _supabase.from('provinces').select('id,name').order('name');
    const provOpts = '<option value="">Select Province</option>' +
        (provs||[]).map(p => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('');

    const IS = 'width:100%;padding:11px 14px;border:1.5px solid #ebebeb;border-radius:10px;font-size:14px;outline:none;font-family:Inter,sans-serif;box-sizing:border-box;background:#fff;';

    modal.innerHTML =
        '<div style="background:#fff;border-radius:20px;padding:32px;max-width:580px;width:100%;margin:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.28);">' +
        '<button onclick="document.getElementById(\'_createEventModal\').style.display=\'none\'" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:24px;cursor:pointer;color:#aaa;line-height:1;">&times;</button>' +
        '<h3 style="font-size:22px;font-weight:800;color:#1a1a1a;margin:0 0 6px;">New Event</h3>' +
        '<p style="font-size:13px;color:#aaa;margin:0 0 24px;">Fill in the details below</p>' +

        _evtFld('Title *', '<input id="_evtTitle" placeholder="Event title" style="' + IS + '">') +
        _evtFld('Description', '<textarea id="_evtDesc" placeholder="What is this event about?" style="' + IS + 'min-height:80px;resize:vertical;"></textarea>') +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        _evtFld('Start Date *', '<input id="_evtStart" type="date" style="' + IS + '">') +
        _evtFld('End Date <span style="color:#aaa;font-weight:400;">(leave empty if one day)</span>', '<input id="_evtEnd" type="date" style="' + IS + '">') +
        '</div>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">' +
        _evtFld('Province', '<select id="_evtProvince" onchange="_evtLoadDistricts()" style="' + IS + '">' + provOpts + '</select>') +
        _evtFld('District', '<select id="_evtDistrict" onchange="_evtLoadSectors()" style="' + IS + '"><option value="">Select District</option></select>') +
        _evtFld('Sector', '<select id="_evtSector" style="' + IS + '"><option value="">Select Sector</option></select>') +
        '</div>' +

        _evtFld('Landmark / Venue', '<input id="_evtLandmark" placeholder="e.g. Kigali Convention Centre" style="' + IS + '">') +

        _evtFld('Images <span style="color:#aaa;font-weight:400;">(up to 5)</span>',
            '<input id="_evtImages" type="file" accept="image/*" multiple style="' + IS + 'padding:8px;border-style:dashed;">' +
            '<p style="font-size:11px;color:#aaa;margin:4px 0 0;">Select up to 5 images. First image used as cover.</p>') +

        '<button id="_evtCreateBtn" onclick="handleCreateEvent()" style="width:100%;background:#EB6753;color:#fff;border:none;padding:14px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;margin-top:8px;">' +
        '<i class="fa-solid fa-calendar-plus"></i> Create Event</button></div>';

    modal.style.display = 'flex';
}
window.openCreateEventModal = openCreateEventModal;

function _evtFld(label, inner) {
    return '<div style="margin-bottom:14px;"><label style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">' + label + '</label>' + inner + '</div>';
}

window._evtLoadDistricts = async function() {
    const provId = document.getElementById('_evtProvince')?.value;
    const dSel   = document.getElementById('_evtDistrict');
    const sSel   = document.getElementById('_evtSector');
    if (dSel) dSel.innerHTML = '<option value="">Select District</option>';
    if (sSel) sSel.innerHTML = '<option value="">Select Sector</option>';
    if (!provId) return;
    const { data } = await _supabase.from('districts').select('id,name').eq('province_id', provId).order('name');
    (data||[]).forEach(d => { const o = document.createElement('option'); o.value=d.id; o.textContent=d.name; dSel.appendChild(o); });
};
window._evtLoadSectors = async function() {
    const distId = document.getElementById('_evtDistrict')?.value;
    const sSel   = document.getElementById('_evtSector');
    if (sSel) sSel.innerHTML = '<option value="">Select Sector</option>';
    if (!distId) return;
    const { data } = await _supabase.from('sectors').select('id,name').eq('district_id', distId).order('name');
    (data||[]).forEach(s => { const o = document.createElement('option'); o.value=s.id; o.textContent=s.name; sSel.appendChild(o); });
};

async function handleCreateEvent() {
    const title    = document.getElementById('_evtTitle')?.value?.trim();
    const desc     = document.getElementById('_evtDesc')?.value?.trim() || null;
    const startD   = document.getElementById('_evtStart')?.value;
    const endD     = document.getElementById('_evtEnd')?.value || null;
    const provId   = document.getElementById('_evtProvince')?.value || null;
    const distId   = document.getElementById('_evtDistrict')?.value || null;
    const sectId   = document.getElementById('_evtSector')?.value || null;
    const landmark = document.getElementById('_evtLandmark')?.value?.trim() || null;
    const files    = document.getElementById('_evtImages')?.files;

    if (!title || !startD) { toast('Title and start date are required.', 'warning'); return; }

    const btn = document.getElementById('_evtCreateBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...'; }

    try {
        // Build human-readable location label
        const locParts = [];
        if (sectId) { const { data: s } = await _supabase.from('sectors').select('name').eq('id', Number(sectId)).single(); if (s) locParts.push(s.name); }
        if (distId) { const { data: d } = await _supabase.from('districts').select('name').eq('id', Number(distId)).single(); if (d) locParts.push(d.name); }
        if (provId) { const { data: p } = await _supabase.from('provinces').select('name').eq('id', Number(provId)).single(); if (p) locParts.push(p.name); }
        const locationLabel = locParts.join(', ') || null;

        // Upload up to 5 images
        const imageUrls = [];
        if (files && files.length) {
            const toUpload = Array.from(files).slice(0, 5);
            for (const file of toUpload) {
                const path = 'events/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const { error: upErr } = await _supabase.storage.from('event-images').upload(path, file, { upsert: false });
                if (!upErr) {
                    const { data: pub } = _supabase.storage.from('event-images').getPublicUrl(path);
                    if (pub?.publicUrl) imageUrls.push(pub.publicUrl);
                } else { console.warn('Event image upload failed:', upErr.message); }
            }
        }

        const { error } = await _supabase.from('events').insert([{
            title, description: desc,
            start_date: startD,
            end_date: endD || startD,
            province_id: provId ? Number(provId) : null,
            district_id: distId ? Number(distId) : null,
            sector_id:   sectId ? Number(sectId) : null,
            location_label: locationLabel,
            landmark,
            images: imageUrls,
            created_by: CURRENT_PROFILE?.id || null
        }]);
        if (error) throw error;

        toast('Event created!', 'success');
        const modal = document.getElementById('_createEventModal');
        if (modal) modal.style.display = 'none';
        await loadEventsCards();
    } catch (err) {
        console.error('❌ [EVENTS] create:', err);
        toast('Failed: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Create Event'; }
    }
}

async function deleteEvent(eventId) {
    if (!confirm('Delete this event? This cannot be undone.')) return;
    try {
        const { error } = await _supabase.from('events').delete().eq('id', eventId);
        if (error) throw error;
        toast('Event deleted.', 'success');
        await loadEventsCards();
    } catch (err) {
        toast('Failed to delete: ' + err.message, 'error');
    }
}
window.deleteEvent = deleteEvent;


/* ═══════════════════════════════════════════════════
   PROMOTIONS — card display (no promo code, listing required)
   ═══════════════════════════════════════════════════ */
async function loadPromotionsCards(page = 0, searchTerm = '') {
    if (CURRENT_ROLE !== 'admin') return; // owner has its own promotions view (loadOwnerPromotions)
    console.log('🏷️ [PROMOS] Loading promotion cards...');
    let container = document.getElementById('promosCardsContainer');
    if (!container) {
        const panel = document.getElementById('promotionsPanel');
        if (!panel) return;
        const old = panel.querySelector('.promos-inner');
        if (old) old.remove();
        const wrap = document.createElement('div');
        wrap.className = 'promos-inner';
        wrap.style.cssText = 'padding:20px;';
        wrap.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap;">' +
            '<h3 style="font-size:18px;font-weight:700;color:#1a1a1a;margin:0;">Active Promotions</h3>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
            '<div style="display:flex;align-items:center;gap:8px;background:#f5f6fa;border:1.5px solid #ebebeb;border-radius:10px;padding:7px 12px;min-width:200px;" id="promosSearchWrap">' +
            '<i class="fa-solid fa-magnifying-glass" style="color:#bbb;font-size:13px;flex-shrink:0;"></i>' +
            '<input id="promosSearchInput" type="text" placeholder="Search promotions..." style="border:none;background:none;outline:none;font-size:13px;font-family:Inter,sans-serif;width:100%;color:#1a1a1a;">' +
            '</div>' +
            '<button onclick="openCreatePromoModal()" style="background:#EB6753;color:#fff;border:none;padding:10px 20px;border-radius:10px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;gap:6px;">' +
            '<i class="fa-solid fa-plus"></i> Add Promotion</button></div></div>' +
            '<div id="promosCardsContainer" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;"></div>' +
            '<div id="dashPromosPagination" style="margin-top:16px;"></div>';
        panel.prepend(wrap);
        // wire search input
        const prSI = document.getElementById('promosSearchInput');
        if (prSI) {
            let prT; prSI.addEventListener('input', e => { clearTimeout(prT); prT = setTimeout(() => loadPromotionsCards(0, e.target.value.trim()), 350); });
            prSI.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); loadPromotionsCards(0, prSI.value.trim()); } });
            const wrap2 = document.getElementById('promosSearchWrap');
            if (wrap2) { prSI.addEventListener('focus', ()=>wrap2.style.borderColor='var(--primary)'); prSI.addEventListener('blur', ()=>wrap2.style.borderColor='#ebebeb'); }
        }
        container = document.getElementById('promosCardsContainer');
    }
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#aaa;">Loading...</div>';

    const PAGE_SIZE = 15;
    const start = page * PAGE_SIZE, end = start + PAGE_SIZE - 1;

    try {
        let promoQ = _supabase
            .from('promotions')
            .select('id,title,description,listing_id,discount,start_date,end_date,banner_url,created_at', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(start, end);
        if (searchTerm) promoQ = promoQ.ilike('title', `%${searchTerm}%`);
        const { data, error, count } = await promoQ;
        if (error) throw error;

        const lids = [...new Set((data || []).map(p => p.listing_id).filter(Boolean))];
        const lstMap = {}, lstImgMap = {};
        if (lids.length) {
            const { data: ls } = await _supabase.from('listings').select('id,title').in('id', lids);
            (ls || []).forEach(l => { lstMap[l.id] = l.title; });
            const { data: imgs } = await _supabase.from('listing_images').select('listing_id,image_url').in('listing_id', lids);
            (imgs || []).forEach(i => { if (!lstImgMap[i.listing_id]) lstImgMap[i.listing_id] = i.image_url; });
        }

        if (!data || !data.length) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:#ccc;">' +
                '<i class="fa-solid fa-tag" style="font-size:48px;margin-bottom:16px;display:block;"></i><p>No promotions yet.</p></div>';
            return;
        }
        container.innerHTML = '';
        const today = new Date().toISOString().split('T')[0];
        data.forEach(p => {
            const imgSrc = p.banner_url || lstImgMap[p.listing_id] || null;
            const isActive = p.start_date <= today && p.end_date >= today;
            const card = document.createElement('div');
            card.style.cssText = 'background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;';
            card.onmouseenter = () => { card.style.transform='translateY(-4px)'; card.style.boxShadow='0 12px 32px rgba(0,0,0,0.13)'; };
            card.onmouseleave = () => { card.style.transform=''; card.style.boxShadow='0 4px 20px rgba(0,0,0,0.08)'; };
            card.onclick = () => openPromoEditModal(p, lstImgMap[p.listing_id]);
            card.innerHTML =
                '<div style="height:160px;overflow:hidden;background:#f5f5f5;position:relative;">' +
                (imgSrc ? '<img src="' + escapeHtml(imgSrc) + '" style="width:100%;height:100%;object-fit:cover;">' :
                    '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-tag" style="font-size:36px;color:#ddd;"></i></div>') +
                '<div style="position:absolute;top:10px;left:10px;background:#EB6753;color:#fff;padding:5px 14px;border-radius:20px;font-size:14px;font-weight:800;">Promo</div>' +
                '<div style="position:absolute;top:10px;right:10px;background:' + (isActive ? 'rgba(46,204,113,0.9)' : 'rgba(150,150,150,0.9)') + ';color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;">' + (isActive ? 'ACTIVE' : 'INACTIVE') + '</div></div>' +
                '<div style="padding:16px;">' +
                '<h4 style="font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 4px;">' + escapeHtml(p.title || '') + '</h4>' +
                '<p style="font-size:12px;color:#EB6753;margin:0 0 6px;font-weight:600;"><i class="fa-solid fa-house"></i> ' + escapeHtml(lstMap[p.listing_id] || '—') + '</p>' +
                (p.description ? '<p style="font-size:12px;color:#888;margin:0 0 10px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">' + escapeHtml(p.description) + '</p>' : '') +
                '<p style="font-size:11px;color:#aaa;margin:0;"><i class="fa-regular fa-calendar"></i> ' + (p.start_date||'') + ' → ' + (p.end_date||'') + '</p>' +
                '<p style="font-size:11px;color:#bbb;margin:4px 0 0;"><i class="fa-solid fa-pencil"></i> Click to edit</p></div>';
            container.appendChild(card);
        });

        if (window.renderPagination) {
            const pageCount = Math.ceil((count || data.length) / PAGE_SIZE);
            renderPagination('dashPromosPagination', page, pageCount, count || data.length, PAGE_SIZE, (p) => loadPromotionsCards(p, searchTerm));
        }

        console.log('✅ [PROMOS] Cards rendered:', data.length);
    } catch (err) {
        console.error('❌ [PROMOS]', err);
        container.innerHTML = '<div style="grid-column:1/-1;color:red;padding:20px;">' + err.message + '</div>';
    }
}

function openPromoEditModal(promo, listingImgFallback) {
    let modal = document.getElementById('promoEditModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'promoEditModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;align-items:center;justify-content:center;';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.body.appendChild(modal);
    }
    const imgPreview = promo.banner_url || listingImgFallback;
    modal.innerHTML =
        '<div style="background:#fff;border-radius:20px;padding:32px;max-width:520px;width:90%;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
        '<button onclick="document.getElementById(\'promoEditModal\').style.display=\'none\'" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#888;line-height:1;">&times;</button>' +
        '<h3 style="font-size:20px;font-weight:800;color:#1a1a1a;margin:0 0 6px;">Edit Promotion</h3>' +
        '<p style="font-size:13px;color:#aaa;margin:0 0 24px;">Update details, add a banner image, or delete</p>' +
        fld('Title', '<input id="epTitle" value="' + escapeHtml(promo.title||'') + '" style="' + inp + '">') +
        fld('Description', '<textarea id="epDesc" style="' + inp + 'min-height:70px;resize:vertical;">' + escapeHtml(promo.description||'') + '</textarea>') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        fld('Discount (RWF)', '<input id="epDiscount" type="number" min="0" value="' + promo.discount + '" style="' + inp + '">') +
        fld('Start Date', '<input id="epStart" type="date" value="' + (promo.start_date||'') + '" style="' + inp + '">') +
        '</div>' +
        fld('End Date', '<input id="epEnd" type="date" value="' + (promo.end_date||'') + '" style="' + inp + '">') +
        fld('Banner Image <span style="color:#aaa;font-weight:400;">(optional)</span>',
            (imgPreview ? '<img src="' + escapeHtml(imgPreview) + '" style="width:100%;height:110px;object-fit:cover;border-radius:10px;margin-bottom:8px;">' : '') +
            '<input id="epImage" type="file" accept="image/*" style="width:100%;padding:8px;border:1.5px dashed #ddd;border-radius:10px;font-size:13px;">') +
        '<div style="display:flex;gap:10px;margin-top:8px;">' +
        '<button id="epSaveBtn" onclick="savePromoEdit(\'' + promo.id + '\')" style="flex:1;background:#EB6753;color:#fff;border:none;padding:14px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;">Save Changes</button>' +
        '<button onclick="if(confirm(\'Delete this promotion?\'))deletePromotion(\'' + promo.id + '\')" style="background:#fde8e8;color:#e74c3c;border:none;padding:14px 18px;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;"><i class="fa-solid fa-trash"></i></button>' +
        '</div></div>';
    modal.style.display = 'flex';
}

const inp = 'width:100%;padding:11px 14px;border:1.5px solid #ebebeb;border-radius:10px;font-size:14px;outline:none;font-family:Inter,sans-serif;box-sizing:border-box;';
function fld(label, inner) {
    return '<div style="margin-bottom:14px;"><label style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">' + label + '</label>' + inner + '</div>';
}
window.openPromoEditModal = openPromoEditModal;

async function savePromoEdit(promoId) {
    const title    = document.getElementById('epTitle')?.value?.trim();
    const desc     = document.getElementById('epDesc')?.value?.trim() || null;
    const discount = Number(document.getElementById('epDiscount')?.value || 0);
    const start    = document.getElementById('epStart')?.value;
    const end      = document.getElementById('epEnd')?.value;
    const file     = document.getElementById('epImage')?.files?.[0];
    if (!title || !discount || !start || !end) { toast('Fill all required fields.', 'warning'); return; }
    const btn = document.getElementById('epSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
        let banner_url;
        if (file) {
            const path = 'promos/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const { error: upErr } = await _supabase.storage.from('promotion-images').upload(path, file, { upsert: false });
            if (!upErr) {
                const { data: pub } = _supabase.storage.from('promotion-images').getPublicUrl(path);
                banner_url = pub?.publicUrl;
            }
        }
        const updates = { title, description: desc, discount, start_date: start, end_date: end };
        if (banner_url) updates.banner_url = banner_url;
        const { error } = await _supabase.from('promotions').update(updates).eq('id', promoId);
        if (error) throw error;
        toast('Promotion updated!', 'success');
        document.getElementById('promoEditModal').style.display = 'none';
        await loadPromotionsCards();
    } catch (err) {
        toast('Failed: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
}
window.savePromoEdit = savePromoEdit;

/* ── Self-building promotion create modal (no HTML dependency) ── */
async function openCreatePromoModal() {
    let modal = document.getElementById('_createPromoModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = '_createPromoModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.body.appendChild(modal);
    }

    // Fetch owner's listings for the dropdown
    let listingQuery = _supabase.from('listings').select('id,title').eq('status','approved').order('title');
    if (CURRENT_ROLE === 'owner') listingQuery = listingQuery.eq('owner_id', CURRENT_PROFILE.id);
    const { data: listings } = await listingQuery;
    const lstOpts = '<option value="">— Select a listing —</option>' +
        (listings||[]).map(l => '<option value="' + l.id + '">' + escapeHtml(l.title) + '</option>').join('');

    const IS = 'width:100%;padding:11px 14px;border:1.5px solid #ebebeb;border-radius:10px;font-size:14px;outline:none;font-family:Inter,sans-serif;box-sizing:border-box;background:#fff;';

    modal.innerHTML =
        '<div style="background:#fff;border-radius:20px;padding:32px;max-width:540px;width:100%;margin:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.28);">' +
        '<button onclick="document.getElementById(\'_createPromoModal\').style.display=\'none\'" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:24px;cursor:pointer;color:#aaa;line-height:1;">&times;</button>' +
        '<h3 style="font-size:22px;font-weight:800;color:#1a1a1a;margin:0 0 6px;">New Promotion</h3>' +
        '<p style="font-size:13px;color:#aaa;margin:0 0 24px;">Promotions must be linked to a listing</p>' +

        _pFld('Title *', '<input id="_promoTitle" placeholder="e.g. Weekend Special" style="' + IS + '">') +
        _pFld('Apply to Listing *',
            '<select id="_promoListingId" style="' + IS + '">' + lstOpts + '</select>') +
        _pFld('Description', '<textarea id="_promoDesc" placeholder="Short description (optional)" style="' + IS + 'min-height:70px;resize:vertical;"></textarea>') +

        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">' +
        _pFld('Discount % *', '<input id="_promoDiscount" type="number" min="1" max="100" placeholder="e.g. 20" style="' + IS + '">') +
        _pFld('Start Date *', '<input id="_promoStart" type="date" style="' + IS + '">') +
        _pFld('End Date *',   '<input id="_promoEnd"   type="date" style="' + IS + '">') +
        '</div>' +

        _pFld('Banner Images <span style="color:#aaa;font-weight:400;">(optional, max 2)</span>',
            '<input id="_promoImages" type="file" accept="image/*" multiple style="' + IS + 'padding:8px;border-style:dashed;">' +
            '<p style="font-size:11px;color:#aaa;margin:4px 0 0;">If no image, the listing\'s own image will be used.</p>') +

        '<button id="_promoCreateBtn" onclick="handleCreatePromo()" style="width:100%;background:#EB6753;color:#fff;border:none;padding:14px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;margin-top:8px;">' +
        '<i class="fa-solid fa-tag"></i> Create Promotion</button></div>';

    modal.style.display = 'flex';
}
window.openCreatePromoModal = openCreatePromoModal;

function _pFld(label, inner) {
    return '<div style="margin-bottom:14px;"><label style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">' + label + '</label>' + inner + '</div>';
}

async function handleCreatePromo() {
    const title     = document.getElementById('_promoTitle')?.value?.trim();
    const discount  = Number(document.getElementById('_promoDiscount')?.value || 0);
    const start     = document.getElementById('_promoStart')?.value;
    const end       = document.getElementById('_promoEnd')?.value;
    const desc      = document.getElementById('_promoDesc')?.value?.trim() || null;
    const listingId = document.getElementById('_promoListingId')?.value || null;
    const files     = document.getElementById('_promoImages')?.files;

    if (!title)     { toast('Please enter a title.',           'warning'); return; }
    if (!listingId) { toast('Please select a listing.',        'warning'); return; }
    if (!discount)  { toast('Please enter a discount %.',      'warning'); return; }
    if (!start)     { toast('Please set a start date.',        'warning'); return; }
    if (!end)       { toast('Please set an end date.',         'warning'); return; }
    if (end < start){ toast('End date must be after start.',   'warning'); return; }

    const btn = document.getElementById('_promoCreateBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...'; }

    try {
        // Upload up to 2 banner images, use first as banner_url
        let bannerUrl = null;
        if (files && files.length) {
            const toUpload = Array.from(files).slice(0, 2);
            for (const file of toUpload) {
                const path = 'promos/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const { error: upErr } = await _supabase.storage.from('promotion-images').upload(path, file, { upsert: false });
                if (!upErr) {
                    const { data: pub } = _supabase.storage.from('promotion-images').getPublicUrl(path);
                    if (!bannerUrl && pub?.publicUrl) bannerUrl = pub.publicUrl;
                } else { console.warn('Promo image upload failed:', upErr.message); }
            }
        }

        const { error } = await _supabase.from('promotions').insert([{
            title, description: desc, discount,
            start_date: start, end_date: end,
            listing_id: listingId,
            banner_url: bannerUrl
        }]);
        if (error) throw error;

        toast('Promotion created!', 'success');
        const modal = document.getElementById('_createPromoModal');
        if (modal) modal.style.display = 'none';
        await loadPromotionsCards();
    } catch (err) {
        console.error('❌ [PROMOS] create:', err);
        toast('Failed: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-tag"></i> Create Promotion'; }
    }
}

async function deletePromotion(promoId) {
    const modal = document.getElementById('promoEditModal');
    if (modal) modal.style.display = 'none';
    try {
        const { error } = await _supabase.from('promotions').delete().eq('id', promoId);
        if (error) throw error;
        toast('Promotion deleted.', 'success');
        await loadPromotionsCards();
    } catch (err) {
        toast('Failed: ' + err.message, 'error');
    }
}
window.deletePromotion = deletePromotion;

/* ===========================
   SETTINGS
   =========================== */
async function handleSaveSettings() {
    const newEmail = document.getElementById('newEmail')?.value?.trim();
    const newPassword = document.getElementById('newPassword')?.value;

    if (!newEmail && !newPassword) {
        toast('Enter a new email or password.', 'warning');
        return;
    }

    const btn = document.querySelector('#settingsForm button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        const updates = {};
        if (newEmail) updates.email = newEmail;
        if (newPassword) updates.password = newPassword;

        const { error } = await _supabase.auth.updateUser(updates);
        if (error) throw error;

        // Update profile email if changed
        if (newEmail && CURRENT_USER) {
            await _supabase.from('profiles').update({ email: newEmail }).eq('id', CURRENT_USER.id);
            const el = document.getElementById('adminEmailDisplay');
            if (el) el.textContent = newEmail;
        }

        toast(newPassword ? 'Password updated!' : 'Email updated! Check your inbox to confirm.', 'success');
        document.getElementById('newEmail').value = '';
        document.getElementById('newPassword').value = '';
    } catch (err) {
        console.error("❌ [SETTINGS]", err);
        toast('Failed: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
}

/* ═══════════════════════════════════════════════════
   LISTING REQUESTS (admin approves before listing goes live)
   ═══════════════════════════════════════════════════ */
function injectListingRequestsTab() {
    if (document.querySelector('[data-tab="listing-requests"]')) return;
    const sidebar = document.getElementById('sidebar') || document.querySelector('.sidebar-nav') || document.querySelector('nav');
    if (!sidebar) return;
    const bookingsBtn = sidebar.querySelector('[data-tab="bookings"]');
    if (!bookingsBtn) return;
    const btn = document.createElement('button');
    btn.className = 'nav-btn';
    btn.setAttribute('data-tab', 'listing-requests');
    btn.innerHTML = '<i class="fa-solid fa-list-check"></i> Listing Requests';
    bookingsBtn.after(btn);
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        togglePanels('listing-requestsPanel');
        loadListingRequests();
    });

    // Create panel if missing
    if (!document.getElementById('listing-requestsPanel')) {
        const allPanels = document.querySelector('.content-area, .main-content, main, #contentArea');
        if (allPanels) {
            const panel = document.createElement('div');
            panel.id = 'listing-requestsPanel';
            panel.className = 'panel';
            panel.style.display = 'none';
            panel.innerHTML =
                '<div style="padding:28px;">' +
                '<h2 style="font-size:22px;font-weight:800;color:#1a1a1a;margin:0 0 6px;">Listing Requests</h2>' +
                '<p style="color:#aaa;font-size:14px;margin:0 0 24px;">Review and approve owner-submitted listings before they go live</p>' +
                '<div id="listingRequestsContainer"></div></div>';
            allPanels.appendChild(panel);
        }
    }
}

async function loadListingRequests(searchTerm = '') {
    console.log('📋 [REQUESTS] Loading pending listing requests...');
    let container = document.getElementById('listingRequestsContainer');
    if (!container) {
        const panel = document.getElementById('listing-requestsPanel');
        if (!panel) { console.warn('listing-requestsPanel missing'); return; }
        container = panel.querySelector('#listingRequestsContainer') || panel;
    }
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;">Loading requests...</div>';

    try {
        let rq = _supabase
            .from('listings')
            .select('id,title,price,currency,category_slug,province_id,district_id,owner_id,created_at,status')
            .in('status', ['pending'])
            .order('created_at', { ascending: false });
        if (searchTerm) rq = rq.ilike('title', `%${searchTerm}%`);
        const { data, error } = await rq;
        if (error) throw error;

        // Batch owner names
        const ownerIds = [...new Set((data||[]).map(l => l.owner_id).filter(Boolean))];
        const ownerMap = {};
        if (ownerIds.length) {
            const { data: owners } = await _supabase.from('profiles').select('id,full_name,email').in('id', ownerIds);
            (owners||[]).forEach(o => { ownerMap[o.id] = o; });
        }
        // Batch province + district names
        const pvIds = [...new Set((data||[]).map(l=>l.province_id).filter(Boolean))];
        const dtIds = [...new Set((data||[]).map(l=>l.district_id).filter(Boolean))];
        const pvMap = {}, dtMap = {};
        if (pvIds.length) { const {data:ps} = await _supabase.from('provinces').select('id,name').in('id',pvIds); (ps||[]).forEach(p=>pvMap[p.id]=p.name); }
        if (dtIds.length) { const {data:ds} = await _supabase.from('districts').select('id,name').in('id',dtIds); (ds||[]).forEach(d=>dtMap[d.id]=d.name); }

        if (!data || !data.length) {
            container.innerHTML = '<div style="text-align:center;padding:60px;color:#ccc;"><i class="fa-solid fa-inbox" style="font-size:48px;display:block;margin-bottom:16px;"></i><p>No pending listing requests.</p></div>';
            return;
        }

        container.innerHTML = '';
        data.forEach(l => {
            const owner = ownerMap[l.owner_id] || {};
            const loc = [dtMap[l.district_id], pvMap[l.province_id]].filter(Boolean).join(', ') || 'Rwanda';
            const row = document.createElement('div');
            row.setAttribute('data-req-id', l.id);
            row.style.cssText = 'background:#fff;border-radius:16px;padding:20px 24px;margin-bottom:14px;display:flex;align-items:center;gap:20px;box-shadow:0 4px 16px rgba(0,0,0,0.07);flex-wrap:wrap;transition:opacity 0.3s;';
            row.innerHTML =
                '<div style="flex:1;min-width:200px;">' +
                '<h4 style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 4px;">' + escapeHtml(l.title) + '</h4>' +
                '<p style="font-size:13px;color:#888;margin:0;"><i class="fa-solid fa-location-dot" style="color:#EB6753;"></i> ' + escapeHtml(loc) + ' &nbsp;|&nbsp; ' +
                '<i class="fa-solid fa-tag" style="color:#EB6753;"></i> ' + Number(l.price||0).toLocaleString('en-RW') + ' ' + (l.currency||'RWF') + '</p></div>' +
                '<div style="min-width:180px;">' +
                '<p style="font-size:13px;color:#555;margin:0;font-weight:600;">' + escapeHtml(owner.full_name||'Unknown') + '</p>' +
                '<p style="font-size:12px;color:#aaa;margin:2px 0 0;">' + escapeHtml(owner.email||'') + '</p></div>' +
                '<div style="display:flex;gap:8px;flex-shrink:0;">' +
                '<button onclick="openApprovalFeeDialog(\'' + l.id + '\',\'' + Number(l.price||0) + '\')" style="background:#e8f8f0;color:#27ae60;border:1px solid #b8e6ce;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;gap:6px;">' +
                '<i class="fa-solid fa-check"></i> Approve</button>' +
                '<button onclick="rejectListingRequest(\'' + l.id + '\',this)" style="background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;gap:6px;">' +
                '<i class="fa-solid fa-xmark"></i> Reject</button></div>';
            container.appendChild(row);
        });
        console.log('✅ [REQUESTS] Loaded', data.length, 'pending listings');
    } catch(err) {
        console.error('❌ [REQUESTS]', err);
        container.innerHTML = '<div style="color:red;padding:20px;">' + err.message + '</div>';
    }
}
window.loadListingRequests = loadListingRequests;

function openApprovalFeeDialog(listingId, ownerPrice) {
    // Remove any existing dialog
    document.getElementById('approvalFeeDialog')?.remove();
    const price = Number(ownerPrice) || 0;
    const suggestedFee = Math.round(price * 0.05 / 1000) * 1000; // 5% rounded to nearest 1000
    const dlg = document.createElement('div');
    dlg.id = 'approvalFeeDialog';
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    dlg.innerHTML =
        '<div style="background:#fff;border-radius:20px;padding:32px;max-width:420px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.15);">' +
        '<h3 style="font-size:18px;font-weight:800;color:#1a1a1a;margin:0 0 8px;">Set AfriStay Fee</h3>' +
        '<p style="font-size:13px;color:#888;margin:0 0 20px;">Set the flat fee (RWF) added on top of the owner\'s price. Guest sees: owner price + this fee.</p>' +
        '<label style="font-size:13px;font-weight:700;color:#1a1a1a;display:block;margin-bottom:6px;">Owner Price: <span style="color:#EB6753;">' + price.toLocaleString('en-RW') + ' RWF</span></label>' +
        '<div style="margin-bottom:16px;">' +
        '<label style="font-size:13px;font-weight:700;color:#1a1a1a;display:block;margin-bottom:6px;">AfriStay Fee (RWF) *</label>' +
        '<input type="number" id="approvalFeeInput" value="' + suggestedFee + '" min="0" style="width:100%;padding:12px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:15px;font-weight:700;font-family:Inter,sans-serif;box-sizing:border-box;" placeholder="e.g. 5000">' +
        '<p style="font-size:12px;color:#aaa;margin:6px 0 0;">Guest will see: <strong id="approvalTotalPreview">' + (price + suggestedFee).toLocaleString('en-RW') + '</strong> RWF</p>' +
        '</div>' +
        '<div style="display:flex;gap:10px;">' +
        '<button onclick="document.getElementById(\'approvalFeeDialog\').remove()" style="flex:1;padding:12px;border:1.5px solid #e0e0e0;border-radius:10px;background:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;">Cancel</button>' +
        '<button onclick="confirmApproveWithFee(\'' + listingId + '\',' + price + ')" style="flex:1;padding:12px;background:#27ae60;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;"><i class="fa-solid fa-check"></i> Approve</button>' +
        '</div></div>';
    // Live preview of total
    dlg.querySelector('#approvalFeeInput').addEventListener('input', function() {
        const fee = parseInt(this.value) || 0;
        const total = document.getElementById('approvalTotalPreview');
        if (total) total.textContent = (price + fee).toLocaleString('en-RW');
    });
    document.body.appendChild(dlg);
}
window.openApprovalFeeDialog = openApprovalFeeDialog;

async function confirmApproveWithFee(listingId, ownerPrice) {
    const feeInput = document.getElementById('approvalFeeInput');
    const fee = parseInt(feeInput?.value) || 0;
    document.getElementById('approvalFeeDialog')?.remove();
    try {
        const priceDisplay = ownerPrice + fee;
        const { error } = await _supabase.from('listings').update({
            status: 'approved',
            price_afristay_fee: fee,
            price_display: priceDisplay,
        }).eq('id', listingId);
        if (error) throw error;
        toast('Listing approved — fee set to ' + fee.toLocaleString('en-RW') + ' RWF!', 'success');
        bustListingCache();
        const row = document.querySelector('[data-req-id="' + listingId + '"]');
        if (row) { row.style.opacity = '0'; row.style.transition = 'opacity 0.3s'; setTimeout(() => row.remove(), 320); }
        loadDashPendingListings();
        loadAttentionItems();
    } catch (err) {
        toast('Failed: ' + err.message, 'error');
    }
}
window.confirmApproveWithFee = confirmApproveWithFee;

async function approveListingRequest(listingId, btn) {
    // Legacy — now goes through openApprovalFeeDialog
    openApprovalFeeDialog(listingId, 0);
}
window.approveListingRequest = approveListingRequest;

async function loadOwnerApplications() {
    const container = document.getElementById('ownerApplicationsContainer');
    if (!container) return;
    container.innerHTML = '<div style="padding:20px;color:#aaa;font-size:13px;">Loading…</div>';
    try {
        const { data, error } = await _supabase
            .from('owner_applications')
            .select('id, user_id, phone, status, answers, admin_note, created_at, profiles ( full_name, email )')
            .order('created_at', { ascending: false });
        if (error) throw error;
        if (!data || !data.length) {
            container.innerHTML = '<div style="padding:30px;text-align:center;color:#aaa;font-size:14px;">No owner applications yet.</div>';
            return;
        }
        container.innerHTML = '';
        data.forEach(app => {
            const profile = app.profiles || {};
            const statusColors = { pending: '#fff8e1', approved: '#e8f8f0', rejected: '#fdecea' };
            const statusTextColors = { pending: '#7c5c00', approved: '#1b7a3e', rejected: '#c0392b' };
            const row = document.createElement('div');
            row.style.cssText = 'background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:12px;border:1px solid #f0f0f0;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;';
            row.innerHTML =
                '<div style="flex:1;min-width:200px;">' +
                '<p style="font-weight:700;color:#1a1a1a;margin:0 0 3px;font-size:15px;">' + escapeHtml(profile.full_name || 'Unknown') + '</p>' +
                '<p style="color:#aaa;font-size:12px;margin:0 0 8px;">' + escapeHtml(profile.email || '') + ' · ' + escapeHtml(app.phone || '') + '</p>' +
                (app.answers && typeof app.answers === 'object'
                    ? Object.entries(app.answers).slice(0,3).map(([k,v]) =>
                        '<p style="font-size:12px;color:#555;margin:2px 0;"><strong>' + escapeHtml(k) + ':</strong> ' + escapeHtml(String(v||'')) + '</p>'
                    ).join('')
                    : '') +
                '</div>' +
                '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;flex-shrink:0;">' +
                '<span style="padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;background:' + (statusColors[app.status] || '#f5f5f5') + ';color:' + (statusTextColors[app.status] || '#333') + ';">' + (app.status || 'pending') + '</span>' +
                (app.status === 'pending'
                    ? '<button onclick="handleOwnerApplication(\'' + app.id + '\',\'' + (app.user_id || '') + '\',\'approved\')" style="background:#e8f8f0;color:#27ae60;border:1px solid #b8e6ce;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;"><i class="fa-solid fa-check"></i> Approve</button>' +
                      '<button onclick="handleOwnerApplication(\'' + app.id + '\',\'' + (app.user_id || '') + '\',\'rejected\')" style="background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;"><i class="fa-solid fa-xmark"></i> Reject</button>'
                    : '') +
                '</div>';
            container.appendChild(row);
        });
    } catch(err) {
        container.innerHTML = '<div style="color:red;padding:20px;">' + err.message + '</div>';
    }
}
window.loadOwnerApplications = loadOwnerApplications;

async function handleOwnerApplication(appId, userId, newStatus) {
    try {
        // Update application status
        const { error: appErr } = await _supabase.from('owner_applications').update({ status: newStatus }).eq('id', appId);
        if (appErr) throw appErr;
        // If approved, update user role to owner
        if (newStatus === 'approved' && userId) {
            const { error: profileErr } = await _supabase.from('profiles').update({ role: 'owner' }).eq('id', userId);
            if (profileErr) console.warn('Profile role update:', profileErr.message);
        }
        logAudit({ action: 'owner_application_' + newStatus, entityType: 'user', entityId: userId, description: 'Owner application ' + newStatus + ' by admin', metadata: { app_id: appId } });
        toast(newStatus === 'approved' ? 'Applicant approved as owner!' : 'Application rejected.', newStatus === 'approved' ? 'success' : 'warning');
        loadOwnerApplications();
        loadAttentionItems();
    } catch(err) {
        logAudit({ action: 'owner_application_failed', entityType: 'user', entityId: userId, description: 'Failed to ' + newStatus + ' owner application: ' + err.message, isError: true });
        toast('Failed: ' + err.message, 'error');
    }
}
window.handleOwnerApplication = handleOwnerApplication;

async function loadAttentionItems() {
    const container = document.getElementById('attentionContainer');
    const badge = document.getElementById('attentionBadge');
    if (!container) return;
    container.innerHTML = '<div style="padding:20px;color:#aaa;font-size:13px;">Loading…</div>';
    let items = [];
    try {
        // 1) Pending owner applications
        const { data: pendingApps } = await _supabase
            .from('owner_applications')
            .select('id, profiles ( full_name, email )')
            .eq('status', 'pending');
        (pendingApps || []).forEach(a => {
            items.push({ icon: 'fa-solid fa-user-plus', color: '#3b82f6', bg: '#eff6ff',
                text: '<strong>' + escapeHtml(a.profiles?.full_name || 'A user') + '</strong> applied to become an owner.',
                action: '<button onclick="document.querySelector(\'[data-tab=owner-applications]\')?.click();loadOwnerApplications()" style="background:#eff6ff;color:#3b82f6;border:1px solid #bfdbfe;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;">Review</button>' });
        });

        // 2) Owners with no phone number
        const { data: noPhone } = await _supabase
            .from('profiles')
            .select('id, full_name, email')
            .eq('role', 'owner')
            .or('phone.is.null,phone.eq.');
        (noPhone || []).slice(0, 5).forEach(p => {
            items.push({ icon: 'fa-solid fa-phone-slash', color: '#f59e0b', bg: '#fffbeb',
                text: 'Owner <strong>' + escapeHtml(p.full_name || p.email || 'Unknown') + '</strong> has no phone number on file.',
                action: '' });
        });

        // 3) Pending listing requests
        const { count: pendingListings } = await _supabase
            .from('listings').select('id', { count: 'exact', head: true }).eq('status', 'pending');
        if (pendingListings > 0) {
            items.push({ icon: 'fa-solid fa-list-check', color: '#8b5cf6', bg: '#f5f3ff',
                text: '<strong>' + pendingListings + ' listing' + (pendingListings > 1 ? 's' : '') + '</strong> awaiting approval.',
                action: '<button onclick="document.querySelector(\'[data-tab=listing-requests]\')?.click();loadListingRequests()" style="background:#f5f3ff;color:#8b5cf6;border:1px solid #ddd6fe;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;">Review</button>' });
        }

        // 4) Error audit logs (most recent 10)
        const { data: errorLogs } = await _supabase
            .from('audit_logs')
            .select('id, created_at, action, entity_type, entity_id, description, actor_role')
            .eq('is_error', true)
            .order('created_at', { ascending: false })
            .limit(10);
        if (errorLogs?.length) {
            const fmtTs = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            errorLogs.forEach(log => {
                const label = (log.entity_type ? log.entity_type + ' ' : '') + (log.action || 'error');
                items.push({
                    icon: 'fa-solid fa-triangle-exclamation',
                    color: '#dc2626',
                    bg: '#fef2f2',
                    text: '<strong style="color:#dc2626;">[Error] ' + escapeHtml(label) + '</strong>'
                        + (log.description ? '<br><span style="font-size:12px;color:#666;">' + escapeHtml(log.description.slice(0, 220)) + '</span>' : '')
                        + '<br><span style="font-size:11px;color:#aaa;">' + fmtTs(log.created_at) + (log.actor_role ? ' · ' + escapeHtml(log.actor_role) : '') + '</span>',
                    action: '',
                    isError: true,
                });
            });
        }

        if (badge) { badge.textContent = items.length; badge.style.display = items.length ? '' : 'none'; }

        if (!items.length) {
            container.innerHTML = '<div style="padding:40px;text-align:center;color:#aaa;font-size:14px;"><i class="fa-solid fa-circle-check" style="font-size:32px;color:#27ae60;display:block;margin-bottom:12px;"></i>All clear — nothing needs your attention right now.</div>';
            return;
        }
        container.innerHTML = items.map(item =>
            '<div style="display:flex;align-items:flex-start;gap:14px;background:' + (item.isError ? '#fff8f8' : '#fff') + ';border-radius:14px;padding:16px 18px;margin-bottom:10px;border:1px solid ' + (item.isError ? '#fecaca' : '#f0f0f0') + ';">' +
            '<div style="width:38px;height:38px;border-radius:10px;background:' + item.bg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
            '<i class="' + item.icon + '" style="color:' + item.color + ';font-size:16px;"></i></div>' +
            '<div style="flex:1;font-size:13px;color:#444;line-height:1.7;">' + item.text + '</div>' +
            (item.action ? '<div style="flex-shrink:0;">' + item.action + '</div>' : '') +
            '</div>'
        ).join('');
    } catch(err) {
        container.innerHTML = '<div style="color:red;padding:20px;">' + err.message + '</div>';
    }
}
window.loadAttentionItems = loadAttentionItems;

async function rejectListingRequest(listingId, btn) {
    if (!confirm('Reject and delete this listing request?')) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Rejecting...'; }
    try {
        await _supabase.rpc('archive_deleted_listing', { p_listing_id: listingId, p_deleter_id: CURRENT_PROFILE?.id || null, p_deleter_name: CURRENT_PROFILE?.full_name || 'admin', p_reason: 'request_rejected' });
        const { error } = await _supabase.from('listings').delete().eq('id', listingId);
        if (error) throw error;
        logAudit({ action: 'listing_request_rejected', entityType: 'listing', entityId: listingId, description: 'Listing request rejected and archived by admin' });
        toast('Listing request rejected.', 'warning');
        bustListingCache();
        // Remove just this row from DOM
        const row = btn ? btn.closest('[data-req-id]') : document.querySelector('[data-req-id="' + listingId + '"]');
        if (row) { row.style.opacity = '0'; row.style.transition = 'opacity 0.3s'; setTimeout(() => row.remove(), 320); }
        loadDashPendingListings();
        loadAttentionItems();
    } catch (err) {
        logAudit({ action: 'listing_request_rejected_failed', entityType: 'listing', entityId: listingId, description: 'Failed to reject listing request: ' + err.message, isError: true });
        toast('Failed: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Reject'; }
    }
}
window.rejectListingRequest = rejectListingRequest;

/* ═══════════════════════════════════════════════════
   OWNER — NEW BOOKINGS (pending only)
   ═══════════════════════════════════════════════════ */
async function loadNewBookings() {
    console.log('🆕 [NEW BOOKINGS] Loading pending bookings...');
    const container = document.getElementById('newBookingsContainer');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;">Loading...</div>';

    try {
        const listingIds = await cOwnerIds();
        if (!listingIds.length) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#ccc;"><i class="fa-solid fa-inbox" style="font-size:36px;display:block;margin-bottom:12px;"></i><p>No listings yet.</p></div>';
            return;
        }
        const { data, error } = await _supabase
            .from('bookings')
            .select('id,listing_id,user_id,guest_name,guest_email,guest_phone,start_date,end_date,total_amount,payment_method,created_at,category_slug')
            .in('listing_id', listingIds)
            .in('status', ['awaiting_approval', 'approved', 'pending'])
            .order('created_at', { ascending: false });
        if (error) throw error;

        if (!data || !data.length) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#ccc;"><i class="fa-solid fa-check-circle" style="font-size:36px;display:block;margin-bottom:12px;color:#2ecc71;"></i><p>No new bookings waiting for approval.</p></div>';
            return;
        }

        // Batch listing titles
        const lids = [...new Set(data.map(b=>b.listing_id))];
        const lstM = {};
        if (lids.length) { const {data:ls} = await _supabase.from('listings').select('id,title').in('id',lids); (ls||[]).forEach(l=>lstM[l.id]=l.title); }

        container.innerHTML = '';
        data.forEach(b => {
            const dur = b.start_date && b.end_date ? Math.max(1, Math.round((new Date(b.end_date)-new Date(b.start_date))/86400000)) : '?';
            const isVehNb = b.category_slug === 'vehicle';
            const nights = dur + (dur === '?' ? '' : (isVehNb ? (dur === 1 ? ' day' : ' days') : (dur === 1 ? ' night' : ' nights')));
            const pmLabel = (b.payment_method || '').replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase()) || 'Pay on Arrival';
            const row = document.createElement('div');
            row.style.cssText = 'background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:12px;display:flex;align-items:center;gap:16px;box-shadow:0 3px 12px rgba(0,0,0,0.07);flex-wrap:wrap;border-left:4px solid #f39c12;';
            row.innerHTML =
                '<div style="flex:1;min-width:160px;">' +
                '<p style="font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 3px;">' + escapeHtml(lstM[b.listing_id]||'Unknown listing') + '</p>' +
                '<p style="font-size:12px;color:#888;margin:0;"><i class="fa-regular fa-calendar" style="color:#EB6753;"></i> ' + (b.start_date||'') + ' → ' + (b.end_date||'') + ' (' + nights + ')</p>' +
                '<p style="font-size:11px;color:#bbb;margin:4px 0 0;"><i class="fa-solid fa-credit-card" style="margin-right:4px;"></i>' + escapeHtml(pmLabel) + '</p>' +
                '</div>' +
                '<div style="min-width:160px;">' +
                '<p style="font-size:13px;font-weight:600;color:#1a1a1a;margin:0;">' + escapeHtml(b.guest_name||'Guest') + '</p>' +
                (b.guest_email ? '<a href="mailto:' + escapeHtml(b.guest_email) + '" onclick="event.stopPropagation()" style="font-size:12px;color:#EB6753;text-decoration:none;margin:2px 0 0;display:block;">' + escapeHtml(b.guest_email) + '</a>' : '') +
                (b.guest_phone ? '<p style="font-size:12px;color:#aaa;margin:2px 0 0;">' + escapeHtml(b.guest_phone) + '</p>' : '') +
                '</div>' +
                '<p style="font-size:16px;font-weight:800;color:#EB6753;margin:0;min-width:100px;">' + Number(b.total_amount||0).toLocaleString('en-RW') + ' RWF</p>' +
                '<div style="display:flex;gap:8px;">' +
                '<button onclick="approveBooking(\'' + b.id + '\')" style="background:#e8f8f0;color:#27ae60;border:1px solid #b8e6ce;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;"><i class="fa-solid fa-check"></i> Approve</button>' +
                '<button onclick="rejectBooking(\'' + b.id + '\')" style="background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;"><i class="fa-solid fa-xmark"></i> Reject</button></div>';
            container.appendChild(row);
        });
        console.log('✅ [NEW BOOKINGS] Loaded', data.length);
    } catch (err) {
        console.error('❌ [NEW BOOKINGS]', err);
        const offline = !navigator.onLine;
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ccc;"><i class="fa-solid fa-' + (offline ? 'wifi-slash' : 'triangle-exclamation') + '" style="font-size:32px;display:block;margin-bottom:12px;color:#e0a0a0;"></i><p style="font-size:14px;color:#c0392b;">' + (offline ? 'No internet connection' : 'Could not load bookings') + '</p></div>';
    }
}
window.loadNewBookings = loadNewBookings;

/* expose new functions globally */
window.loadEventsTable = loadEventsCards;
window.loadEventsCards = loadEventsCards;
window.handleCreateEvent = handleCreateEvent;
window.loadPromotionsTable = loadPromotionsCards;
window.loadPromotionsCards = loadPromotionsCards;
window.handleCreatePromo = handleCreatePromo;
window.handleSaveSettings = handleSaveSettings;


/* ═══════════════════════════════════════════════════
   DASHBOARD PANEL — "New Listings" pending-approval widget
   Replaces old "Recent Bookings" section.
   Admin  → sees ALL pending listings with approve/reject
   Owner  → sees THEIR pending listings (status-only view)
   ═══════════════════════════════════════════════════ */
async function loadDashPendingListings() {
    // Find or create the container inside dashboardPanel
    let el = document.getElementById('dashPendingListings');
    if (!el) {
        const panel = document.getElementById('dashboardPanel');
        if (!panel) return;

        // Remove old newBookingsContainer section if present
        const old = panel.querySelector('[id="newBookingsContainer"], .new-bookings-section');
        if (old) old.closest('.data-section, [class*=section]')?.remove?.() || old.remove();

        // Build wrapper
        const wrap = document.createElement('div');
        wrap.className = 'data-section';
        wrap.style.marginTop = '20px';
        wrap.innerHTML =
            '<div class="section-header">' +
            '<h2><i class="fa-solid fa-list-check" style="margin-right:8px;color:#EB6753;"></i>New Listings</h2>' +
            '<span id="dashPendingBadge" style="background:#f39c12;color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;display:none;"></span>' +
            '</div>' +
            '<p style="font-size:13px;color:#aaa;margin:-8px 0 16px;">Listings waiting for approval</p>' +
            '<div id="dashPendingListings"></div>';
        panel.appendChild(wrap);
        el = document.getElementById('dashPendingListings');
    }
    if (!el) return;

    el.innerHTML = '<div style="text-align:center;padding:30px;color:#bbb;">Loading...</div>';

    try {
        let q = _supabase
            .from('listings')
            .select('id,title,price,currency,category_slug,province_id,district_id,owner_id,created_at')
            .neq('status', 'approved')
            .order('created_at', { ascending: false })
            .limit(15);

        if (CURRENT_ROLE === 'owner') q = q.eq('owner_id', CURRENT_PROFILE.id);

        const { data, error } = await q;
        if (error) throw error;

        // Update badge
        const badge = document.getElementById('dashPendingBadge');
        if (badge) {
            badge.textContent = (data?.length || 0) + ' pending';
            badge.style.display = data?.length ? 'inline-block' : 'none';
        }

        if (!data || !data.length) {
            el.innerHTML =
                '<div style="text-align:center;padding:40px;color:#ccc;">' +
                '<i class="fa-solid fa-circle-check" style="font-size:38px;color:#2ecc71;display:block;margin-bottom:12px;"></i>' +
                '<p>No listings waiting for approval.</p></div>';
            return;
        }

        // Batch image + owner info + locations
        const ids = data.map(l => l.id);
        const imgMap = await cImageMap(ids);

        const ownerIds = [...new Set(data.map(l => l.owner_id).filter(Boolean))];
        const ownerMap = {};
        if (ownerIds.length) {
            const { data: ows } = await _supabase.from('profiles').select('id,full_name,email,phone').in('id', ownerIds);
            (ows||[]).forEach(o => ownerMap[o.id] = o);
        }

        const pvIds = [...new Set(data.map(l => l.province_id).filter(Boolean))];
        const dtIds = [...new Set(data.map(l => l.district_id).filter(Boolean))];
        const pvMap = {}, dtMap = {};
        if (pvIds.length) { const {data:ps} = await _supabase.from('provinces').select('id,name').in('id',pvIds); (ps||[]).forEach(p=>pvMap[p.id]=p.name); }
        if (dtIds.length) { const {data:ds} = await _supabase.from('districts').select('id,name').in('id',dtIds); (ds||[]).forEach(d=>dtMap[d.id]=d.name); }

        el.innerHTML = '';
        data.forEach(l => {
            const img   = imgMap[l.id] || null;
            const owner = ownerMap[l.owner_id] || {};
            const loc   = [dtMap[l.district_id], pvMap[l.province_id]].filter(Boolean).join(', ') || 'Rwanda';
            const unit  = l.category_slug === 'vehicle' ? '/day' : '/night';
            const priceFmt = Number(l.price||0).toLocaleString('en-RW');

            const row = document.createElement('div');
            row.id = 'dplRow_' + l.id;
            row.style.cssText = 'display:flex;gap:14px;padding:14px 0;border-bottom:1px solid #f5f5f5;align-items:center;flex-wrap:wrap;transition:opacity 0.3s;';
            row.innerHTML =
                // Thumbnail → links to preview
                '<a href="/Listings/Detail/?id=' + l.id + '&preview=1" target="_blank" style="flex-shrink:0;width:76px;height:62px;border-radius:12px;overflow:hidden;background:#f0f0f0;display:flex;align-items:center;justify-content:center;text-decoration:none;">' +
                (img ? '<img src="' + escapeHtml(img) + '" style="width:100%;height:100%;object-fit:cover;">' : '<i class="fa-solid fa-image" style="color:#ddd;font-size:20px;"></i>') +
                '</a>' +
                // Title + location
                '<div style="flex:1;min-width:140px;">' +
                '<a href="/Listings/Detail/?id=' + l.id + '&preview=1" target="_blank" style="text-decoration:none;">' +
                '<p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#1a1a1a;line-height:1.3;">' + escapeHtml(l.title) + '</p></a>' +
                '<p style="margin:0;font-size:12px;color:#aaa;"><i class="fa-solid fa-location-dot" style="color:#EB6753;font-size:10px;"></i> ' + escapeHtml(loc) + '</p>' +
                (CURRENT_ROLE === 'admin' && owner.full_name
                    ? '<p style="margin:2px 0 0;font-size:12px;color:#888;"><i class="fa-solid fa-user" style="color:#EB6753;font-size:10px;"></i> ' + escapeHtml(owner.full_name) + ' · ' + escapeHtml(owner.email||'') + '</p>'
                    : '') +
                '</div>' +
                // Price
                '<p style="font-weight:800;color:#EB6753;font-size:15px;margin:0;flex-shrink:0;white-space:nowrap;">' +
                priceFmt + ' <span style="font-size:11px;color:#aaa;font-weight:400;">RWF' + unit + '</span></p>' +
                // Approve / Reject (admin only) | Pending badge (owner)
                '<div style="display:flex;gap:6px;flex-shrink:0;">' +
                (CURRENT_ROLE === 'admin'
                    ? '<button onclick="dashApprove(\'' + l.id + '\',this)" style="background:#e8f8f0;color:#27ae60;border:1px solid #b8e6ce;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;white-space:nowrap;transition:opacity 0.2s;"><i class="fa-solid fa-check"></i> Approve</button>' +
                      '<button onclick="dashReject(\'' + l.id + '\',this)" style="background:#fde8e8;color:#e74c3c;border:1px solid #f5c6c6;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:Inter,sans-serif;white-space:nowrap;transition:opacity 0.2s;"><i class="fa-solid fa-xmark"></i> Reject</button>'
                    : '<span style="background:#fff3cd;color:#856404;border:1px solid #ffd047;padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;">⏳ Pending Review</span>'
                ) +
                '</div>';
            el.appendChild(row);
        });

        console.log('✅ [DASH] Pending listings widget loaded:', data.length);
    } catch(err) {
        console.error('❌ [DASH PENDING]', err);
        el.innerHTML = '<div style="color:#e74c3c;padding:16px;">' + escapeHtml(err.message) + '</div>';
    }
}
window.loadDashPendingListings = loadDashPendingListings;

async function dashApprove(id, btn) {
    if (!confirm('Approve this listing? It will immediately appear on the public Listings page.')) return;
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    try {
        const { error } = await _supabase.from('listings').update({ status: 'approved' }).eq('id', id);
        if (error) throw error;
        toast('✅ Listing approved — now live!', 'success');
        bustListingCache();
        const row = document.getElementById('dplRow_' + id);
        if (row) { row.style.opacity = '0'; setTimeout(() => row.remove(), 320); }
        // Also refresh the sidebar Listing Requests panel if visible
        if (document.getElementById('listingRequestsContainer')) loadListingRequests();
    } catch(err) {
        toast('Failed: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<i class="fa-solid fa-check"></i> Approve'; }
    }
}
window.dashApprove = dashApprove;

async function dashReject(id, btn) {
    if (!confirm('Reject and permanently delete this listing request?')) return;
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    try {
        await _supabase.rpc('archive_deleted_listing', { p_listing_id: id, p_deleter_id: CURRENT_PROFILE?.id || null, p_deleter_name: CURRENT_PROFILE?.full_name || 'admin', p_reason: 'request_rejected' });
        const { error } = await _supabase.from('listings').delete().eq('id', id);
        if (error) throw error;
        logAudit({ action: 'listing_request_rejected', entityType: 'listing', entityId: id, description: 'Listing request rejected and deleted by ' + (CURRENT_PROFILE?.full_name || 'admin') });
        toast('Listing rejected and removed.', 'warning');
        bustListingCache();
        const row = document.getElementById('dplRow_' + id);
        if (row) { row.style.opacity = '0'; setTimeout(() => row.remove(), 320); }
        if (document.getElementById('listingRequestsContainer')) loadListingRequests();
    } catch(err) {
        logAudit({ action: 'listing_request_rejected_failed', entityType: 'listing', entityId: id, description: 'Failed dashReject: ' + err.message, isError: true });
        toast('Failed: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Reject'; }
    }
}
window.dashReject = dashReject;

/* ===========================
    GLOBAL EXPORTS
    =========================== */
window.approveListing = approveListing;
window.toggleListingAvailability = toggleListingAvailability;
window.approveBooking = approveBooking;
window.rejectBooking   = rejectBooking;
window.demoMarkPaid = demoMarkPaid;
window.promoteToOwner = promoteToOwner;
window.openModal = openModal;
window.closeModal = closeModal;
window.filterTable = filterTable;
window.togglePanels = togglePanels;


/* ═══════════════════════════════════════════════════════════════
   URL ACTION HANDLER
   Email links contain ?action=approve&booking=ID
   Opens dashboard and auto-triggers the action
   ═══════════════════════════════════════════════════════════════ */
async function handleUrlActions() {
    const params = new URLSearchParams(window.location.search);
    const action    = params.get('action');
    const bookingId = params.get('booking');
    if (!action || !bookingId) return;

    console.log(`[URL-ACTION] action=${action} booking=${bookingId}`);

    // Clean URL so it doesn't re-trigger on reload
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);

    // Wait for auth + data to load
    await new Promise(r => setTimeout(r, 1000)); // already waited 3.5s on page load

    if (action === 'approve') {
        console.log('[URL-ACTION] Auto-approving booking from email link:', bookingId);
        await approveBooking(bookingId);
    } else if (action === 'reject') {
        console.log('[URL-ACTION] Auto-rejecting booking from email link:', bookingId);
        await rejectBooking(bookingId);
    }
}

/* ═══════════════════════════════════════════════════════════════
   ARCHIVE / TRASH TAB  (admin only)
   ═══════════════════════════════════════════════════════════════ */
let _archiveFilter = 'all';
let _archivePage   = 0;
const _ARCHIVE_PAGE_SIZE = 20;

window.setArchiveFilter = function(filter) {
    _archiveFilter = filter;
    _archivePage   = 0;
    document.querySelectorAll('.archive-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
    loadArchiveTab();
};

async function loadArchiveTab(page = 0) {
    if (CURRENT_ROLE !== 'admin') return;
    _archivePage = page;
    const container  = document.getElementById('archiveContainer');
    const pagination = document.getElementById('archivePagination');
    if (!container) return;

    container.innerHTML = '<p style="color:#bbb;text-align:center;padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</p>';

    const search = (document.getElementById('archiveSearchInput')?.value || '').trim().toLowerCase();
    const from   = page * _ARCHIVE_PAGE_SIZE;
    const to     = from + _ARCHIVE_PAGE_SIZE - 1;

    try {
        let q = _supabase.from('archive').select('*', { count: 'exact' }).order('deleted_at', { ascending: false }).range(from, to);
        if (_archiveFilter !== 'all') q = q.eq('entity_type', _archiveFilter);
        if (search) q = q.or('entity_id.ilike.%' + search + '%,deleted_by_name.ilike.%' + search + '%,reason.ilike.%' + search + '%,data::text.ilike.%' + search + '%');

        const { data, error, count } = await q;
        if (error) throw error;
        if (!data || !data.length) {
            container.innerHTML = '<p style="color:#bbb;text-align:center;padding:40px;"><i class="fa-solid fa-box-archive" style="font-size:32px;display:block;margin-bottom:12px;"></i>No archived records found.</p>';
            if (pagination) pagination.innerHTML = '';
            return;
        }

        container.innerHTML = data.map(r => {
            const d = r.data || {};
            const iconClass = r.entity_type === 'user' ? 'arc-user fa-user' : r.entity_type === 'booking' ? 'arc-booking fa-calendar-xmark' : 'arc-listing fa-house-circle-xmark';
            const typeColor = r.entity_type === 'user' ? 'var(--primary)' : r.entity_type === 'booking' ? '#c47f2a' : '#16a34a';
            const when = new Date(r.deleted_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });

            let title = '', sub = '';
            if (r.entity_type === 'user') {
                title = d.full_name || 'Unknown User';
                sub   = [d.email, d.phone, 'Role: ' + (d.role || '—')].filter(Boolean).join(' · ');
            } else if (r.entity_type === 'booking') {
                title = 'Booking #' + (d.booking_reference || r.entity_id.slice(0,8));
                sub   = ['Guest: ' + (d.guest_name || d.user_id || '—'), 'Status: ' + (d.status || r.reason || '—'), d.start_date ? d.start_date + ' → ' + d.end_date : ''].filter(Boolean).join(' · ');
            } else {
                title = d.title || 'Listing #' + r.entity_id.slice(0,8);
                sub   = ['By: ' + (r.deleted_by_name || '—'), 'Reason: ' + (r.reason || '—'), d.province_id ? 'Province ID ' + d.province_id : ''].filter(Boolean).join(' · ');
            }

            return '<div class="archive-row">' +
                '<div class="archive-icon arc-' + r.entity_type + '"><i class="fa-solid ' + iconClass.split(' ')[1] + '"></i></div>' +
                '<div>' +
                    '<div style="font-size:14px;font-weight:700;color:#1a1a1a;">' + escHtml(title) + '</div>' +
                    '<div style="font-size:12px;color:#888;margin-top:3px;line-height:1.5;">' + escHtml(sub) + '</div>' +
                '</div>' +
                '<div style="text-align:right;flex-shrink:0;">' +
                    '<span style="font-size:11px;font-weight:700;color:' + typeColor + ';background:' + (r.entity_type==='user'?'var(--ps)':r.entity_type==='booking'?'#fef9ee':'#f0fdf4') + ';padding:3px 10px;border-radius:20px;">' + r.entity_type.toUpperCase() + '</span>' +
                    '<div style="font-size:11px;color:#bbb;margin-top:5px;">' + when + '</div>' +
                '</div>' +
            '</div>';
        }).join('');

        // Pagination
        if (pagination) {
            const totalPages = Math.ceil((count || 0) / _ARCHIVE_PAGE_SIZE);
            pagination.innerHTML = totalPages <= 1 ? '' :
                Array.from({ length: totalPages }, (_, i) =>
                    '<button class="btn-s" ' + (i === page ? 'style="background:var(--primary);color:#fff;"' : '') +
                    ' onclick="loadArchiveTab(' + i + ')">' + (i + 1) + '</button>'
                ).join('');
        }
    } catch(err) {
        container.innerHTML = '<p style="color:#e74c3c;padding:20px;">' + err.message + '</p>';
    }
}
window.loadArchiveTab = loadArchiveTab;

// Wire archive search with debounce
setTimeout(() => {
    const archInput = document.getElementById('archiveSearchInput');
    if (archInput) {
        let _archT;
        archInput.addEventListener('input', () => { clearTimeout(_archT); _archT = setTimeout(() => loadArchiveTab(0), 350); });
    }
}, 2000);

// Auto-load archive when tab is clicked
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-btn[data-tab="archive"]').forEach(b =>
        b.addEventListener('click', () => { if (!document.getElementById('archiveContainer')?.textContent?.includes('records')) loadArchiveTab(); })
    );
});

function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Run after page init
setTimeout(handleUrlActions, 3500); // give auth session time to restore

/* ═══════════════════════════════════════════════════════════════
   OWNER WALLET SETTINGS
   Owners set their MoMo/bank details for receiving payouts
   ═══════════════════════════════════════════════════════════════ */
async function loadOwnerWallet() {
    if (CURRENT_ROLE !== 'owner') return;
    console.log('[WALLET] Loading owner wallet...');

    const { data: wallet } = await _supabase
        .from('owner_wallets')
        .select('*')
        .eq('owner_id', CURRENT_PROFILE.id)
        .maybeSingle();

    // Find or create wallet settings section
    let section = document.getElementById('ownerWalletSection');
    if (!section) {
        const settingsPanel = document.getElementById('settingsPanel') ||
            document.querySelector('[id*=settings], [id*=profile]');
        if (!settingsPanel) { console.warn('[WALLET] No settings panel found'); return; }
        section = document.createElement('div');
        section.id = 'ownerWalletSection';
        section.style.cssText = 'margin-top:28px;';
        settingsPanel.appendChild(section);
    }

    const method  = wallet?.payout_method || 'momo_mtn';
    const phone   = wallet?.momo_phone    || '';
    const name    = wallet?.momo_name     || '';
    const bank    = wallet?.bank_name     || '';
    const acc     = wallet?.account_number|| '';
    const accName = wallet?.account_name  || '';

    section.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:24px;border:1.5px solid #e8e8e8;box-shadow:0 2px 12px rgba(0,0,0,.05);">
            <h3 style="font-size:16px;font-weight:800;color:#161616;margin-bottom:4px;display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-wallet" style="color:#EB6753;"></i> Payout Wallet
            </h3>
            <p style="font-size:13px;color:#aaa;margin-bottom:20px;">
                Where AfriStay sends your earnings after each confirmed booking.
            </p>

            ${!wallet?.verified ? `
            <div style="background:#fff8f3;border:1.5px solid #fdd5c4;border-radius:11px;padding:12px 16px;
                        font-size:13px;color:#9a3412;margin-bottom:18px;display:flex;align-items:center;gap:10px;">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>No payout wallet set up yet. Add your details below to receive payments.</span>
            </div>` : `
            <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:11px;padding:12px 16px;
                        font-size:13px;color:#166534;margin-bottom:18px;display:flex;align-items:center;gap:10px;">
                <i class="fa-solid fa-circle-check"></i>
                <span>Wallet active — payouts go to <strong>${wallet.momo_phone ? maskPhone(wallet.momo_phone) : wallet.bank_name}</strong></span>
            </div>`}

            <div style="margin-bottom:16px;">
                <label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:6px;">Payout Method</label>
                <select id="walletMethod" onchange="toggleWalletFields()"
                        style="width:100%;padding:11px 14px;border:1.5px solid #e8e8e8;border-radius:11px;font-size:14px;font-family:inherit;outline:none;">
                    <option value="momo_mtn"    ${method==='momo_mtn'    ? 'selected' : ''}>MTN MoMo Rwanda</option>
                    <option value="momo_airtel" ${method==='momo_airtel' ? 'selected' : ''}>Airtel Money Rwanda</option>
                    <option value="bank"        ${method==='bank'        ? 'selected' : ''}>Bank Transfer</option>
                </select>
            </div>

            <div id="walletMomoFields" style="display:${method !== 'bank' ? 'block' : 'none'};">
                <div style="margin-bottom:14px;">
                    <label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:6px;">MoMo Phone Number</label>
                    <div style="position:relative;display:flex;">
                        <span style="position:absolute;left:0;top:0;bottom:0;display:flex;align-items:center;padding:0 12px;font-size:14px;font-weight:700;border-right:1.5px solid #e8e8e8;pointer-events:none;gap:5px;z-index:1;">
                            🇷🇼 +250
                        </span>
                        <input id="walletPhone" type="tel" value="${phone.replace(/^250/,'')}" placeholder="78X XXX XXX"
                               maxlength="9" inputmode="numeric" oninput="this.value=this.value.replace(/\D/g,'')"
                               style="width:100%;padding:11px 14px 11px 95px;border:1.5px solid #e8e8e8;border-radius:11px;font-size:14px;font-family:inherit;outline:none;">
                    </div>
                </div>
                <div style="margin-bottom:14px;">
                    <label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:6px;">Account Name (as registered on MoMo)</label>
                    <input id="walletMomoName" type="text" value="${name}" placeholder="e.g. Jean Amahoro"
                           style="width:100%;padding:11px 14px;border:1.5px solid #e8e8e8;border-radius:11px;font-size:14px;font-family:inherit;outline:none;">
                </div>
            </div>

            <div id="walletBankFields" style="display:${method === 'bank' ? 'block' : 'none'};">
                <div style="margin-bottom:14px;">
                    <label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:6px;">Bank Name</label>
                    <input id="walletBankName" type="text" value="${bank}" placeholder="e.g. Bank of Kigali"
                           style="width:100%;padding:11px 14px;border:1.5px solid #e8e8e8;border-radius:11px;font-size:14px;font-family:inherit;outline:none;">
                </div>
                <div style="margin-bottom:14px;">
                    <label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:6px;">Account Number</label>
                    <input id="walletAccNum" type="text" value="${acc}" placeholder="000000000"
                           style="width:100%;padding:11px 14px;border:1.5px solid #e8e8e8;border-radius:11px;font-size:14px;font-family:inherit;outline:none;">
                </div>
                <div style="margin-bottom:14px;">
                    <label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:6px;">Account Holder Name</label>
                    <input id="walletAccName" type="text" value="${accName}" placeholder="Full name on account"
                           style="width:100%;padding:11px 14px;border:1.5px solid #e8e8e8;border-radius:11px;font-size:14px;font-family:inherit;outline:none;">
                </div>
            </div>

            <button onclick="saveOwnerWallet()"
                    style="width:100%;padding:13px;background:#EB6753;color:#fff;border:none;border-radius:11px;
                           font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;margin-top:6px;
                           transition:all .2s;" onmouseover="this.style.background='#d04e3b'" onmouseout="this.style.background='#EB6753'">
                <i class="fa-solid fa-floppy-disk"></i> Save Payout Details
            </button>
        </div>
    `;
}

function toggleWalletFields() {
    const method = document.getElementById('walletMethod')?.value;
    const isMomo = method !== 'bank';
    const momoFields = document.getElementById('walletMomoFields');
    const bankFields = document.getElementById('walletBankFields');
    if (momoFields) momoFields.style.display = isMomo ? 'block' : 'none';
    if (bankFields) bankFields.style.display = isMomo ? 'none'  : 'block';
}

async function saveOwnerWallet() {
    const method    = document.getElementById('walletMethod')?.value;
    const rawPhone  = document.getElementById('walletPhone')?.value?.trim()     || '';
    const momoName  = document.getElementById('walletMomoName')?.value?.trim()  || '';
    const bankName  = document.getElementById('walletBankName')?.value?.trim()  || '';
    const accNum    = document.getElementById('walletAccNum')?.value?.trim()    || '';
    const accName   = document.getElementById('walletAccName')?.value?.trim()   || '';

    if (method !== 'bank' && (!rawPhone || rawPhone.length < 8)) {
        toast('Please enter a valid MoMo phone number.', 'error'); return;
    }
    if (method === 'bank' && (!bankName || !accNum || !accName)) {
        toast('Please fill in all bank details.', 'error'); return;
    }

    console.log('[WALLET] Saving wallet — method:', method);
    try {
        const payload = {
            owner_id:       CURRENT_PROFILE.id,
            payout_method:  method,
            momo_phone:     method !== 'bank' ? '250' + rawPhone : null,
            momo_name:      method !== 'bank' ? momoName : null,
            bank_name:      method === 'bank' ? bankName : null,
            account_number: method === 'bank' ? accNum   : null,
            account_name:   method === 'bank' ? accName  : null,
            is_active:      true,
            updated_at:     new Date().toISOString(),
        };

        const { error } = await _supabase.from('owner_wallets').upsert(payload, { onConflict: 'owner_id' });
        if (error) throw error;

        console.log('✅ [WALLET] Saved successfully');
        toast("✅ Payout wallet saved! Your earnings will be sent here after each booking.", 'success');
        await loadOwnerWallet(); // refresh to show verified state
    } catch (err) {
        console.error('❌ [WALLET] Save error:', err);
        toast('Failed to save wallet: ' + err.message, 'error');
    }
}

function maskPhone(p) {
    if (!p || p.length < 6) return p;
    return p.slice(0, 5) + '***' + p.slice(-3);
}

window.toggleWalletFields = toggleWalletFields;
window.saveOwnerWallet    = saveOwnerWallet;
window.loadOwnerWallet    = loadOwnerWallet;
window.handleUrlActions   = handleUrlActions;

/* ═══════════════════════════════════════════════════════════════
   EARNINGS TAB (owner)
   ═══════════════════════════════════════════════════════════════ */
async function loadEarnings() {
    if (CURRENT_ROLE !== 'owner' || !CURRENT_PROFILE) {
        const sec = document.getElementById('earningsPayoutSection');
        if (sec) sec.innerHTML = '<p style="color:#bbb;font-size:13px;text-align:center;padding:20px;">Sign in as an owner to view earnings.</p>';
        return;
    }
    const _set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    _set('earningsBalance', '…'); _set('earningsPaid', '…'); _set('earningsBookings', '…');

    try {
        const [bkRes, payRes] = await Promise.all([
            _supabase.from('bookings')
                .select('total_amount, status')
                .in('listing_id',
                    (await _supabase.from('listings').select('id').eq('owner_id', CURRENT_PROFILE.id)).data?.map(l => l.id) || [])
                .in('status', ['confirmed', 'approved', 'completed']),
            _supabase.from('payouts')
                .select('payout_amount, status')
                .eq('owner_id', CURRENT_PROFILE.id)
                .eq('status', 'completed'),
        ]);

        const totalEarned  = (bkRes.data  || []).reduce((s, b) => s + (b.total_amount || 0), 0);
        const totalPaidOut = (payRes.data || []).reduce((s, p) => s + (p.payout_amount || 0), 0);
        const pending      = Math.max(0, totalEarned - totalPaidOut);
        const completedBks = (bkRes.data  || []).filter(b => b.status === 'completed').length;

        const fmt = n => Number(n).toLocaleString('en-RW') + ' RWF';
        _set('earningsBalance',  fmt(pending));
        _set('earningsPaid',     fmt(totalPaidOut));
        _set('earningsBookings', completedBks || '0');
    } catch (e) {
        _set('earningsBalance',  'Error');
        _set('earningsPaid',     'Error');
        _set('earningsBookings', 'Error');
        console.error('[EARNINGS]', e);
    }

    await loadPayoutHistory();
}
window.loadEarnings = loadEarnings;

/* ═══════════════════════════════════════════════════════════════
   PAYOUT HISTORY (for owners + admin)
   ═══════════════════════════════════════════════════════════════ */
async function loadPayoutHistory() {
    if (CURRENT_ROLE !== 'owner' && CURRENT_ROLE !== 'admin') return;

    let section = document.getElementById('payoutHistorySection');
    if (!section) return;

    console.log('[PAYOUTS] Loading payout history...');

    let q = _supabase.from('payouts')
        .select('*')
        .order('initiated_at', { ascending: false })
        .limit(50);

    if (CURRENT_ROLE === 'owner') q = q.eq('owner_id', CURRENT_PROFILE.id).eq('recipient_type','owner');

    const { data: payouts, error } = await q;
    if (error) {
        console.error('[PAYOUTS] Error:', error);
        const payOffline = !navigator.onLine;
        section.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:20px;"><i class="fa-solid fa-' + (payOffline ? 'wifi-slash' : 'triangle-exclamation') + '" style="margin-right:6px;color:#e0a0a0;"></i>' + (payOffline ? 'No internet connection' : 'Could not load payout history') + '</p>';
        return;
    }

    if (!payouts?.length) {
        section.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:20px;">No payouts yet.</p>';
        return;
    }

    const fmtMoney = n => Number(n||0).toLocaleString('en-RW');
    const fmtDate  = d => new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const statusColors = { completed:'#166534', pending:'#92400e', processing:'#1e40af', failed:'#991b1b' };
    const statusBg     = { completed:'#f0fdf4', pending:'#fffbeb', processing:'#eff6ff', failed:'#fff0f0' };

    section.innerHTML = payouts.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;
                    border-bottom:1px solid #f5f5f5;gap:12px;flex-wrap:wrap;">
            <div>
                <p style="margin:0;font-size:13px;font-weight:700;color:#161616;">
                    ${fmtMoney(p.payout_amount)} ${p.currency}
                    <span style="font-size:11px;color:#aaa;font-weight:400;margin-left:4px;">
                        (${p.fee_percent}% fee: ${fmtMoney(p.fee_amount)} ${p.currency})
                    </span>
                </p>
                <p style="margin:2px 0 0;font-size:12px;color:#aaa;">
                    ${p.payout_method?.replace(/_/g,' ') || '—'} · ${p.payout_phone || '—'} · ${fmtDate(p.initiated_at)}
                </p>
                ${p.failure_reason ? `<p style="margin:2px 0 0;font-size:11px;color:#e74c3c;">${p.failure_reason}</p>` : ''}
            </div>
            <span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;
                         background:${statusBg[p.status]||'#f5f5f5'};color:${statusColors[p.status]||'#555'};">
                ${p.status}
            </span>
        </div>
    `).join('');
}

window.loadPayoutHistory = loadPayoutHistory;

/* ═══════════════════════════════════════════════════════════════
   RECEIPT DOWNLOAD — pulls from digital_receipts table first,
   falls back to generating from booking data
   ═══════════════════════════════════════════════════════════════ */

console.log("✨ [ADMIN] Dashboard.js loaded and ready!");

/* ═══════════════════════════════════════════════
   DOWNLOAD RECEIPT (PDF) — client-side via jsPDF
   ═══════════════════════════════════════════════ */
window.downloadReceipt = async function(bookingId) {
    console.log('📄 [RECEIPT] Downloading receipt for booking:', bookingId);
    toast('Preparing receipt...', 'info');

    try {
        // ── Try digital_receipts table first ───────────────────────
        let receiptData = null;
        const { data: dbReceipt } = await _supabase
            .from('digital_receipts')
            .select('*')
            .eq('booking_id', bookingId)
            .maybeSingle();

        if (dbReceipt) {
            console.log('✅ [RECEIPT] Found saved receipt:', dbReceipt.receipt_number);
            receiptData = dbReceipt;
        } else {
            // ── Generate from booking + listing data ───────────────
            console.log('ℹ️ [RECEIPT] No saved receipt — building from booking data');

            // Try to generate via Edge Function (will also save it)
            try {
                const res = await fetch(CONFIG.FUNCTIONS_BASE + '/generate-receipt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bookingId }),
                });
                const data = await res.json();
                if (data.success && data.receipt) receiptData = data.receipt;
            } catch (efErr) {
                console.warn('[RECEIPT] Edge Function unavailable, building locally:', efErr.message);
            }

            // Fallback: build from raw booking data
            if (!receiptData) {
                const { data: booking }  = await _supabase.from('bookings').select('*').eq('id', bookingId).single();
                const { data: listing }  = await _supabase.from('listings').select('title,price,currency,address,province_id,district_id,owner_id').eq('id', booking.listing_id).single();
                const ownerRes = listing?.owner_id
                    ? await _supabase.from('profiles').select('full_name,email,phone').eq('id', listing.owner_id).single()
                    : { data: null };
                const owner = ownerRes.data || null;

                let location = listing?.address || 'Rwanda';
                try {
                    const [{ data: dist }, { data: prov }] = await Promise.all([
                        listing?.district_id ? _supabase.from('districts').select('name').eq('id', listing.district_id).single() : { data: null },
                        listing?.province_id ? _supabase.from('provinces').select('name').eq('id', listing.province_id).single() : { data: null },
                    ]);
                    location = [dist?.name, prov?.name].filter(Boolean).join(', ') || location;
                } catch {}

                const nights      = Math.ceil((new Date(booking.end_date) - new Date(booking.start_date)) / 86400000);
                const totalAmount = Number(booking.total_amount || 0);
                const priceNight  = Number(listing?.price || totalAmount / nights || 0);
                const platformFee = Math.round(totalAmount * 0.05);

                receiptData = {
                    receipt_number:  'RCP-' + booking.id.slice(0,8).toUpperCase(),
                    listing_title:   listing?.title || 'AfriStay Property',
                    listing_address: location,
                    check_in:        booking.start_date,
                    check_out:       booking.end_date,
                    nights,
                    price_per_night: priceNight,
                    subtotal:        priceNight * nights,
                    platform_fee:    platformFee,
                    total_amount:    totalAmount,
                    currency:        listing?.currency || 'RWF',
                    payment_method:  booking.payment_method || 'unknown',
                    guest_name:      booking.guest_name  || CURRENT_PROFILE?.full_name || '—',
                    guest_email:     booking.guest_email || CURRENT_PROFILE?.email     || '—',
                    guest_phone:     booking.guest_phone || '—',
                    owner_name:      owner?.full_name || 'Host',
                    issued_at:       booking.created_at || new Date().toISOString(),
                };
            }
        }

        // ── Build PDF ─────────────────────────────────────────────
        if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
            });
        }
        const { jsPDF } = window.jspdf || window;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });

        const W = doc.internal.pageSize.width;
        const M = 18;
        let y = 0;
        const fmt    = d => d ? new Date(d + (d.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }) : '—';
        const money  = n => Number(n||0).toLocaleString('en-RW') + ' ' + receiptData.currency;
        const pmLabel = String(receiptData.payment_method||'').replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());

        // ── Header band ───────────────────────────────────────────
        doc.setFillColor(235, 103, 83);
        doc.rect(0, 0, W, 38, 'F');

        // Logo text
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.text('AfriStay', M, 16);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('Rwanda\'s Premier Property Marketplace', M, 23);

        // RECEIPT label
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('BOOKING RECEIPT', W - M, 16, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(receiptData.receipt_number, W - M, 23, { align: 'right' });
        doc.text('Issued: ' + fmt(receiptData.issued_at || new Date().toISOString()), W - M, 29, { align: 'right' });
        y = 50;

        // ── Green status badge ────────────────────────────────────
        doc.setFillColor(240, 253, 244);
        doc.roundedRect(M, y - 5, W - M * 2, 14, 3, 3, 'F');
        doc.setTextColor(22, 163, 74);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('✓  PAYMENT CONFIRMED', W / 2, y + 3, { align: 'center' });
        y += 18;

        // ── Property info ─────────────────────────────────────────
        doc.setTextColor(22, 22, 22);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text(receiptData.listing_title, M, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text(receiptData.listing_address || 'Rwanda', M, y);
        y += 12;

        // ── Stay details box ──────────────────────────────────────
        doc.setFillColor(250, 250, 250);
        doc.setDrawColor(232, 232, 232);
        doc.roundedRect(M, y, W - M * 2, 36, 3, 3, 'FD');

        const col1 = M + 8, col2 = W / 2 + 4;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(180, 180, 180);
        doc.text('CHECK-IN',  col1,   y + 8); doc.text('CHECK-OUT', col2,   y + 8);
        doc.text('DURATION',  col1,   y + 22); doc.text('PAYMENT METHOD', col2, y + 22);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(22, 22, 22);
        doc.text(fmt(receiptData.check_in),  col1,  y + 15);
        doc.text(fmt(receiptData.check_out), col2,  y + 15);
        doc.text(receiptData.nights + ' night' + (receiptData.nights !== 1 ? 's' : ''), col1, y + 29);
        doc.text(pmLabel, col2, y + 29);
        y += 46;

        // ── Price breakdown ───────────────────────────────────────
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(232, 232, 232);
        doc.roundedRect(M, y, W - M * 2, 54, 3, 3, 'FD');

        const drawLine = (label, value, yy, bold = false, color = [22,22,22]) => {
            doc.setFont('helvetica', bold ? 'bold' : 'normal');
            doc.setFontSize(bold ? 10 : 9);
            doc.setTextColor(...(bold ? [22,22,22] : [100,100,100]));
            doc.text(label, col1, yy);
            doc.setTextColor(...color);
            doc.text(value, W - M - 6, yy, { align: 'right' });
        };
        drawLine('Rate per night',  money(receiptData.price_per_night),  y + 12);
        drawLine('× ' + receiptData.nights + ' nights', '',              y + 12); // already shown
        drawLine('Subtotal',     money(receiptData.subtotal),        y + 22);

        // Divider
        doc.setDrawColor(235, 103, 83); doc.setLineWidth(0.5);
        doc.line(col1, y + 28, W - M - 6, y + 28);

        drawLine('TOTAL AMOUNT', money(receiptData.total_amount),    y + 37, true, [235,103,83]);
        y += 54;

        // ── Guest + Host info ─────────────────────────────────────
        const boxH = 36;
        doc.setDrawColor(232, 232, 232); doc.setLineWidth(0.3);
        doc.roundedRect(M, y, (W - M * 2) / 2 - 4, boxH, 3, 3, 'D');
        doc.roundedRect(W / 2 + 1, y, (W - M * 2) / 2 - 4, boxH, 3, 3, 'D');

        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(180,180,180);
        doc.text('GUEST', M + 6, y + 9);
        doc.text('HOST', W / 2 + 7, y + 9);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(22,22,22);
        doc.text(receiptData.guest_name || '—', M + 6, y + 17);
        doc.text(receiptData.owner_name || '—', W / 2 + 7, y + 17);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130,130,130);
        doc.text(receiptData.guest_email || '—', M + 6, y + 24);
        doc.text(receiptData.guest_phone || '—', M + 6, y + 30);
        y += boxH + 14;

        // ── Footer ────────────────────────────────────────────────
        const pageH = doc.internal.pageSize.height;
        doc.setFillColor(248, 248, 248);
        doc.rect(0, pageH - 18, W, 18, 'F');
        doc.setDrawColor(235,235,235); doc.line(0, pageH - 18, W, pageH - 18);
        doc.setTextColor(170,170,170); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
        doc.text('Official AfriStay receipt · © ' + new Date().getFullYear() + ' AfriStay Ltd · afristay.rw · support@afristay.rw', W / 2, pageH - 8, { align: 'center' });

        doc.save('AfriStay-Receipt-' + receiptData.receipt_number + '.pdf');
        toast('📄 Receipt downloaded!', 'success');
        console.log('✅ [RECEIPT] PDF saved:', receiptData.receipt_number);

    } catch (err) {
        console.error('❌ [RECEIPT] Error:', err);
        toast('Failed to generate receipt: ' + err.message, 'error');
    }
};

/* ═══════════════════════════════════════════════════
   OWNER — PROMOTIONS TAB
   ═══════════════════════════════════════════════════ */
async function loadOwnerPromotions(page = 0) {
    if (CURRENT_ROLE !== 'owner') return;
    const container = document.getElementById('ownerPromosContainer');
    if (!container) return;
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#aaa;">Loading...</div>';

    try {
        const listingIds = await cOwnerIds();
        if (!listingIds.length) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#ccc;"><i class="fa-solid fa-tag" style="font-size:36px;display:block;margin-bottom:12px;"></i><p>You need at least one approved listing to create promotions.</p></div>';
            return;
        }

        const PAGE_SIZE = 15;
        const start = page * PAGE_SIZE, end = start + PAGE_SIZE - 1;

        const { data, error, count } = await _supabase
            .from('promotions')
            .select('id,title,description,listing_id,discount,start_date,end_date,banner_url,created_at', { count: 'exact' })
            .in('listing_id', listingIds)
            .order('created_at', { ascending: false })
            .range(start, end);
        if (error) throw error;

        // listing titles
        const lstMap = {};
        if (listingIds.length) {
            const { data: ls } = await _supabase.from('listings').select('id,title').in('id', listingIds);
            (ls || []).forEach(l => lstMap[l.id] = l.title);
        }

        if (!data || !data.length) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#ccc;"><i class="fa-solid fa-tag" style="font-size:36px;display:block;margin-bottom:12px;"></i><p>No promotions yet. Create your first one!</p></div>';
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        container.innerHTML = '';
        data.forEach(p => {
            const isActive = p.start_date <= today && p.end_date >= today;
            const card = document.createElement('div');
            card.style.cssText = 'background:#fff;border-radius:14px;padding:18px;box-shadow:0 3px 14px rgba(0,0,0,0.07);border-left:4px solid ' + (isActive ? '#2ecc71' : '#ddd') + ';';
            card.innerHTML =
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px;">' +
                '<div>' +
                '<div style="font-size:15px;font-weight:800;color:#1a1a1a;">' + escapeHtml(p.title || '—') + '</div>' +
                '<div style="font-size:12px;color:#EB6753;margin-top:3px;font-weight:600;"><i class="fa-solid fa-house"></i> ' + escapeHtml(lstMap[p.listing_id] || '—') + '</div>' +
                '</div>' +
                '<div style="background:#EB6753;color:#fff;padding:6px 14px;border-radius:20px;font-size:14px;font-weight:800;white-space:nowrap;">Promo</div>' +
                '</div>' +
                (p.description ? '<p style="font-size:13px;color:#888;margin:0 0 10px;">' + escapeHtml(p.description) + '</p>' : '') +
                '<div style="font-size:12px;color:#aaa;margin-bottom:10px;"><i class="fa-regular fa-calendar"></i> ' + (p.start_date || '—') + ' → ' + (p.end_date || '—') + '</div>' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                '<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:' + (isActive ? '#e8f5e9' : '#f5f5f5') + ';color:' + (isActive ? '#27ae60' : '#aaa') + ';">' + (isActive ? 'ACTIVE' : 'INACTIVE') + '</span>' +
                '<button class="btn-s danger" style="margin-left:auto;" onclick="deleteOwnerPromo(\'' + p.id + '\')"><i class="fa-solid fa-trash"></i> Delete</button>' +
                '</div>';
            container.appendChild(card);
        });

        if (window.renderPagination) {
            const pageCount = Math.ceil((count || data.length) / PAGE_SIZE);
            renderPagination('ownerPromosPagination', page, pageCount, count || data.length, PAGE_SIZE, (pg) => loadOwnerPromotions(pg));
        }

    } catch (err) {
        console.error('❌ [OWNER PROMOS]', err);
        container.innerHTML = '<div style="grid-column:1/-1;color:red;padding:20px;">' + escapeHtml(err.message) + '</div>';
    }
}

window.loadOwnerPromotions = loadOwnerPromotions;

window.deleteOwnerPromo = async function(promoId) {
    if (!confirm('Delete this promotion?')) return;
    try {
        const { error } = await _supabase.from('promotions').delete().eq('id', promoId);
        if (error) throw error;
        toast('Promotion deleted.', 'success');
        loadOwnerPromotions();
    } catch (err) {
        toast('Failed: ' + err.message, 'error');
    }
};

window.openOwnerCreatePromoModal = async function() {
    let modal = document.getElementById('_ownerPromoModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = '_ownerPromoModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.body.appendChild(modal);
    }

    const listingIds = await cOwnerIds();
    const lstOpts = listingIds.length
        ? (await (async () => {
            const { data } = await _supabase.from('listings').select('id,title').in('id', listingIds).eq('status','approved');
            return (data || []).map(l => `<option value="${l.id}">${escapeHtml(l.title)}</option>`).join('');
        })())
        : '';

    const IS = 'width:100%;padding:11px 14px;border:1.5px solid #ebebeb;border-radius:10px;font-size:14px;outline:none;font-family:Inter,sans-serif;box-sizing:border-box;background:#fff;';
    modal.innerHTML =
        '<div style="background:#fff;border-radius:20px;padding:32px;max-width:480px;width:100%;margin:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.28);">' +
        '<button onclick="document.getElementById(\'_ownerPromoModal\').style.display=\'none\'" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:24px;cursor:pointer;color:#aaa;">&times;</button>' +
        '<h3 style="font-size:20px;font-weight:800;color:#1a1a1a;margin:0 0 20px;">New Promotion</h3>' +
        '<div style="display:flex;flex-direction:column;gap:14px;">' +
        '<div><label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:5px;">Listing *</label><select id="_opListing" style="' + IS + '"><option value="">Select listing</option>' + lstOpts + '</select></div>' +
        '<div><label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:5px;">Promo Title *</label><input id="_opTitle" placeholder="Summer Special" style="' + IS + '"></div>' +
        '<div><label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:5px;">Description</label><textarea id="_opDesc" placeholder="Short description..." style="' + IS + 'min-height:70px;resize:vertical;"></textarea></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">' +
        '<div><label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:5px;">Discount %</label><input id="_opDiscount" type="number" min="1" max="99" placeholder="15" style="' + IS + '"></div>' +
        '<div><label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:5px;">Start Date</label><input id="_opStart" type="date" style="' + IS + '"></div>' +
        '<div><label style="font-size:11px;font-weight:700;color:#bbb;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:5px;">End Date</label><input id="_opEnd" type="date" style="' + IS + '"></div>' +
        '</div>' +
        '<button onclick="submitOwnerPromo()" style="background:#EB6753;color:#fff;border:none;padding:13px;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;font-family:Inter,sans-serif;width:100%;margin-top:4px;">Create Promotion</button>' +
        '</div></div>';
    modal.style.display = 'flex';
};

window.submitOwnerPromo = async function() {
    const listing_id = document.getElementById('_opListing')?.value;
    const title = document.getElementById('_opTitle')?.value?.trim();
    const description = document.getElementById('_opDesc')?.value?.trim();
    const discount = parseInt(document.getElementById('_opDiscount')?.value);
    const start_date = document.getElementById('_opStart')?.value;
    const end_date = document.getElementById('_opEnd')?.value;

    if (!listing_id || !title || !discount || !start_date || !end_date) {
        toast('Please fill in all required fields.', 'warning');
        return;
    }
    if (discount < 1 || discount > 99) { toast('Discount must be between 1 and 99.', 'warning'); return; }
    if (start_date > end_date) { toast('End date must be after start date.', 'warning'); return; }

    try {
        const { error } = await _supabase.from('promotions').insert({ listing_id, title, description: description || null, discount, start_date, end_date });
        if (error) throw error;
        toast('Promotion created!', 'success');
        document.getElementById('_ownerPromoModal').style.display = 'none';
        loadOwnerPromotions();
    } catch (err) {
        toast('Failed: ' + err.message, 'error');
    }
};

/* ═══════════════════════════════════════════════════
   FINANCIAL TAB
   ═══════════════════════════════════════════════════ */
let _finData = [];

async function loadFinancialData(page = 0, searchTerm = '') {
    if (CURRENT_ROLE !== 'admin') return;
    const tbody = document.getElementById('finTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#aaa;">Loading...</td></tr>';

    // use input field value if no arg passed
    if (!searchTerm) searchTerm = (document.getElementById('finSearchInput')?.value || '').trim();

    const range = document.getElementById('finDateRange')?.value || '30';
    let fromDate = null;
    if (range !== 'all') {
        const d = new Date();
        d.setDate(d.getDate() - parseInt(range));
        fromDate = d.toISOString().split('T')[0];
    }

    const PAGE_SIZE = 15;
    const start = page * PAGE_SIZE, end = start + PAGE_SIZE - 1;

    try {
        let q = _supabase
            .from('bookings')
            .select('id, listing_id, user_id, guest_name, guest_email, start_date, end_date, total_amount, status, payment_method, created_at', { count: 'exact' })
            .in('status', ['confirmed', 'approved', 'completed'])
            .order('created_at', { ascending: false })
            .range(start, end);

        if (fromDate) q = q.gte('created_at', fromDate);

        if (searchTerm) {
            const { data: matchedLst } = await _supabase.from('listings').select('id').ilike('title', `%${searchTerm}%`);
            const lstIds = (matchedLst || []).map(l => l.id);
            let orParts = [`guest_name.ilike.%${searchTerm}%`, `guest_email.ilike.%${searchTerm}%`];
            if (lstIds.length) orParts.push(`listing_id.in.(${lstIds.join(',')})`);
            q = q.or(orParts.join(','));
        }

        const { data, error, count } = await q;
        if (error) throw error;

        // Batch listing info
        const lids = [...new Set((data || []).map(b => b.listing_id).filter(Boolean))];
        const lstMap = {};
        if (lids.length) {
            const { data: ls } = await _supabase.from('listings').select('id,title,price_afristay_fee').in('id', lids);
            (ls || []).forEach(l => lstMap[l.id] = l);
        }

        if (!data || !data.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:#aaa;">No confirmed bookings found for this period.</td></tr>';
            // clear stats
            _renderFinStats(0, 0, 0, 0);
            return;
        }

        // Store for export
        _finData = data.map(b => {
            const lst = lstMap[b.listing_id] || {};
            const fee = lst.price_afristay_fee || 0;
            const total = Number(b.total_amount || 0);
            const nights = b.start_date && b.end_date
                ? Math.max(1, Math.round((new Date(b.end_date) - new Date(b.start_date)) / 86400000))
                : 1;
            const afristayEarns = fee * nights;
            const ownerEarns = total - afristayEarns;
            return { ...b, lst_title: lst.title || '—', fee, nights, afristayEarns, ownerEarns, total };
        });

        // Stats
        const totalRevenue = _finData.reduce((s, r) => s + r.total, 0);
        const totalFees = _finData.reduce((s, r) => s + r.afristayEarns, 0);
        const totalOwner = _finData.reduce((s, r) => s + r.ownerEarns, 0);
        _renderFinStats(_finData.length, totalRevenue, totalFees, totalOwner);

        tbody.innerHTML = '';
        _finData.forEach((r, i) => {
            const tr = document.createElement('tr');
            const fmt = n => Number(n || 0).toLocaleString('en-RW');
            tr.innerHTML = `
                <td>${page * PAGE_SIZE + i + 1}.</td>
                <td style="font-family:monospace;font-size:11px;">${shortId(r.id)}</td>
                <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.lst_title)}">${escapeHtml(r.lst_title)}</td>
                <td style="font-size:12px;">${escapeHtml(r.guest_name || '—')}<br><span style="color:#aaa;font-size:11px;">${escapeHtml(r.guest_email || '')}</span></td>
                <td style="font-size:11px;color:#888;">${r.start_date} → ${r.end_date}</td>
                <td style="font-weight:600;">${fmt(r.ownerEarns)} RWF</td>
                <td style="color:#EB6753;font-weight:700;">${fmt(r.afristayEarns)} RWF</td>
                <td style="font-weight:800;">${fmt(r.total)} RWF</td>
                <td><span class="status-badge status-${r.status}">${r.status}</span></td>
                <td style="font-size:11px;color:#aaa;">${(r.payment_method || '—').replace(/_/g,' ')}</td>
            `;
            tbody.appendChild(tr);
        });

        if (window.renderPagination) {
            const pageCount = Math.ceil((count || data.length) / PAGE_SIZE);
            renderPagination('finPagination', page, pageCount, count || data.length, PAGE_SIZE, (p) => loadFinancialData(p, searchTerm));
        }

        // Draw revenue chart (only on first page load with no search)
        if (page === 0 && typeof window.drawRevenueChart === 'function') {
            window.drawRevenueChart();
        }

    } catch (err) {
        console.error('❌ [FINANCIAL]', err);
        tbody.innerHTML = `<tr><td colspan="10" style="color:red;padding:20px;">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function _renderFinStats(bookings, revenue, fees, ownerPayout) {
    const el = document.getElementById('finStatsRow');
    if (!el) return;
    const fmt = n => Number(n || 0).toLocaleString('en-RW');
    const cards = [
        { icon: 'fa-calendar-check', color: '#eff6ff', iconColor: '#3b82f6', label: 'Paid Bookings', value: bookings },
        { icon: 'fa-coins', color: '#fff0ee', iconColor: '#EB6753', label: 'Total Revenue', value: fmt(revenue) + ' RWF' },
        { icon: 'fa-building-columns', color: '#f0fdf4', iconColor: '#22c55e', label: 'AfriStay Earnings', value: fmt(fees) + ' RWF' },
        { icon: 'fa-hand-holding-dollar', color: '#faf5ff', iconColor: '#a855f7', label: 'Owner Payouts', value: fmt(ownerPayout) + ' RWF' },
    ];
    el.innerHTML = cards.map(c =>
        `<div style="background:#fff;border-radius:14px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,0.05);">
            <div style="width:38px;height:38px;border-radius:10px;background:${c.color};color:${c.iconColor};display:flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:16px;">
                <i class="fa-solid ${c.icon}"></i>
            </div>
            <div style="font-size:18px;font-weight:800;color:#1a1a1a;line-height:1.2;">${c.value}</div>
            <div style="font-size:11px;color:#aaa;margin-top:4px;">${c.label}</div>
        </div>`
    ).join('');
}

window.loadFinancialData = loadFinancialData;

/* ── Export Financial Data ── */
window.exportFinancial = function(format) {
    if (!_finData.length) {
        toast('No data to export. Load financial data first.', 'warning');
        return;
    }

    if (format === 'csv') {
        const headers = ['#', 'Booking ID', 'Listing', 'Guest', 'Email', 'Check-in', 'Check-out', 'Nights', 'Owner Earns (RWF)', 'AfriStay Fee (RWF)', 'Total (RWF)', 'Status', 'Payment Method'];
        const rows = _finData.map((r, i) => [
            i + 1,
            r.id,
            '"' + (r.lst_title || '').replace(/"/g, '""') + '"',
            '"' + (r.guest_name || '').replace(/"/g, '""') + '"',
            r.guest_email || '',
            r.start_date || '',
            r.end_date || '',
            r.nights,
            Math.round(r.ownerEarns),
            Math.round(r.afristayEarns),
            Math.round(r.total),
            r.status,
            (r.payment_method || '').replace(/_/g, ' ')
        ]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'AfriStay-Financial-' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        toast('CSV exported!', 'success');

    } else if (format === 'pdf') {
        // Use jsPDF if loaded, otherwise fallback to print
        if (typeof window.jspdf !== 'undefined' || typeof window.jsPDF !== 'undefined') {
            const jsPDF = window.jsPDF || window.jspdf?.jsPDF;
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const W = doc.internal.pageSize.width;
            doc.setFontSize(16); doc.setFont('helvetica', 'bold');
            doc.text('AfriStay — Financial Report', 14, 16);
            doc.setFontSize(9); doc.setFont('helvetica', 'normal');
            doc.text('Generated: ' + new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }), 14, 22);

            const cols = ['#', 'Listing', 'Guest', 'Check-in', 'Check-out', 'Owner (RWF)', 'Fee (RWF)', 'Total (RWF)', 'Status'];
            const rows = _finData.map((r, i) => [
                i + 1,
                (r.lst_title || '—').substring(0, 22),
                (r.guest_name || '—').substring(0, 18),
                r.start_date || '—',
                r.end_date || '—',
                Math.round(r.ownerEarns).toLocaleString(),
                Math.round(r.afristayEarns).toLocaleString(),
                Math.round(r.total).toLocaleString(),
                r.status
            ]);

            doc.autoTable({ head: [cols], body: rows, startY: 28, styles: { fontSize: 8 }, headStyles: { fillColor: [235, 103, 83] } });
            doc.save('AfriStay-Financial-' + new Date().toISOString().split('T')[0] + '.pdf');
            toast('PDF exported!', 'success');
        } else {
            // fallback — open print dialog of the table
            const html = `<html><head><title>AfriStay Financial Report</title>
            <style>body{font-family:sans-serif;font-size:12px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;}th{background:#EB6753;color:#fff;}tr:nth-child(even){background:#f9f9f9;}h2{color:#EB6753;}</style></head>
            <body><h2>AfriStay Financial Report</h2><p>Generated: ${new Date().toLocaleDateString()}</p>
            <table><thead><tr><th>#</th><th>Listing</th><th>Guest</th><th>Check-in</th><th>Check-out</th><th>Owner Earns</th><th>AfriStay Fee</th><th>Total</th><th>Status</th></tr></thead><tbody>
            ${_finData.map((r, i) => `<tr><td>${i+1}</td><td>${r.lst_title||'—'}</td><td>${r.guest_name||'—'}</td><td>${r.start_date||'—'}</td><td>${r.end_date||'—'}</td><td>${Math.round(r.ownerEarns).toLocaleString()} RWF</td><td>${Math.round(r.afristayEarns).toLocaleString()} RWF</td><td>${Math.round(r.total).toLocaleString()} RWF</td><td>${r.status}</td></tr>`).join('')}
            </tbody></table></body></html>`;
            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
            w.print();
        }
    }
};

/* ═══════════════════════════════════════════════════════════════
   BULK BOOKING ACTIONS
   ═══════════════════════════════════════════════════════════════ */
window._bulkBookingIds = new Set();

function _updateBulkBar() {
    const bar = document.getElementById('bookingsBulkBar');
    if (!bar) return;
    const count = window._bulkBookingIds.size;
    if (count > 0) {
        bar.style.display = 'flex';
        const lbl = bar.querySelector('.bulk-count');
        if (lbl) lbl.textContent = count + ' selected';
    } else {
        bar.style.display = 'none';
    }
}

window.toggleBookingCheck = function(id, checked) {
    if (checked) window._bulkBookingIds.add(id);
    else window._bulkBookingIds.delete(id);
    _updateBulkBar();
};

window.bulkSelectAllBookings = function(checked) {
    document.querySelectorAll('.booking-cb').forEach(cb => {
        cb.checked = checked;
        if (checked) window._bulkBookingIds.add(cb.dataset.id);
        else window._bulkBookingIds.delete(cb.dataset.id);
    });
    _updateBulkBar();
};

window.clearBulkBookings = function() {
    window._bulkBookingIds.clear();
    document.querySelectorAll('.booking-cb').forEach(cb => cb.checked = false);
    const all = document.getElementById('bookingSelectAll');
    if (all) all.checked = false;
    _updateBulkBar();
};

window.bulkActionBookings = async function(status) {
    const ids = [...window._bulkBookingIds];
    if (!ids.length) return;
    const label = { approved: 'approve', rejected: 'reject', completed: 'mark complete' }[status] || status;
    if (!confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} ${ids.length} booking(s)?`)) return;
    try {
        const { error } = await _supabase.from('bookings').update({ status }).in('id', ids);
        if (error) throw error;
        toast(`${ids.length} booking(s) updated to "${status}"!`, 'success');
        logAudit({ action: 'bulk_update_bookings', entityType: 'booking', description: `Bulk ${label} — ${ids.length} bookings`, metadata: { ids, status } });
        window.clearBulkBookings();
        loadBookingsTable();
    } catch(err) {
        toast('Bulk action failed: ' + err.message, 'error');
        logAudit({ action: 'bulk_update_bookings', entityType: 'booking', description: `Error bulk ${label}: ${err.message}`, isError: true });
    }
};

/* ═══════════════════════════════════════════════════════════════
   REVENUE CHART (Chart.js)
   ═══════════════════════════════════════════════════════════════ */
let _revenueChart = null;

window.drawRevenueChart = function() {
    const canvas = document.getElementById('revenueChart');
    const wrap   = document.getElementById('revenueChartWrap');
    if (!canvas) return;

    // Build day-by-day map for current month (day 1 → today)
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    const today = now.getDate();

    const dayTotals = {};
    for (let d = 1; d <= today; d++) dayTotals[d] = 0;

    (_finData || []).forEach(r => {
        if (!r.created_at) return;
        const d = new Date(r.created_at);
        if (d.getFullYear() === year && d.getMonth() === month) {
            const day = d.getDate();
            if (day <= today) dayTotals[day] = (dayTotals[day] || 0) + (r.total || 0);
        }
    });

    const labels = Object.keys(dayTotals).map(d => {
        const dt = new Date(year, month, parseInt(d));
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const values = Object.values(dayTotals);

    if (wrap) wrap.style.display = 'block';
    if (_revenueChart) _revenueChart.destroy();
    _revenueChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Revenue (RWF)',
                data: values,
                backgroundColor: values.map(v => v > 0 ? 'rgba(235,103,83,0.85)' : 'rgba(235,103,83,0.15)'),
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false }, tooltip: { callbacks: {
                label: ctx => Number(ctx.parsed.y).toLocaleString('en-RW') + ' RWF'
            }}},
            scales: {
                y: { beginAtZero: true, grid: { color: '#f0f0f0' }, ticks: {
                    font: { size: 11 },
                    callback: v => v === 0 ? '0' : (v >= 1000 ? Math.round(v/1000) + 'K' : v)
                }},
                x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } }
            }
        }
    });
};

/* ═══════════════════════════════════════════════════════════════
   CSV EXPORTS — Users & Bookings
   ═══════════════════════════════════════════════════════════════ */
window.exportUsers = async function() {
    if (CURRENT_ROLE !== 'admin') { toast('Admin only', 'error'); return; }
    toast('Preparing users export…', 'info', 2000);
    try {
        const { data, error } = await _supabase
            .from('profiles')
            .select('id, full_name, email, phone, role, banned, created_at')
            .order('created_at', { ascending: false })
            .limit(10000);
        if (error) throw error;

        const headers = ['#', 'Name', 'Email', 'Phone', 'Role', 'Banned', 'Joined'];
        const rows = (data || []).map((u, i) => [
            i + 1,
            '"' + (u.full_name || '').replace(/"/g, '""') + '"',
            u.email || '',
            u.phone || '',
            u.role || '',
            u.banned ? 'Yes' : 'No',
            (u.created_at || '').slice(0, 10),
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'AfriStay-Users-' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click(); URL.revokeObjectURL(url);
        toast('Users CSV exported!', 'success');
        logAudit({ action: 'export_users_csv', entityType: 'profile', description: `Exported ${(data||[]).length} users as CSV` });
    } catch(err) {
        toast('Export failed: ' + err.message, 'error');
        logAudit({ action: 'export_users_csv', description: 'CSV export error: ' + err.message, isError: true });
    }
};

window.exportBookings = async function() {
    if (CURRENT_ROLE !== 'admin') { toast('Admin only', 'error'); return; }
    toast('Preparing bookings export…', 'info', 2000);
    try {
        const { data, error } = await _supabase
            .from('bookings')
            .select('id, listing_id, guest_name, guest_email, start_date, end_date, total_amount, status, payment_method, created_at')
            .order('created_at', { ascending: false })
            .limit(10000);
        if (error) throw error;

        const headers = ['#', 'Booking ID', 'Listing ID', 'Guest', 'Email', 'Check-in', 'Check-out', 'Amount (RWF)', 'Status', 'Payment', 'Created'];
        const rows = (data || []).map((b, i) => [
            i + 1,
            b.id,
            b.listing_id,
            '"' + (b.guest_name || '').replace(/"/g, '""') + '"',
            b.guest_email || '',
            b.start_date || '',
            b.end_date || '',
            Math.round(b.total_amount || 0),
            b.status || '',
            (b.payment_method || '').replace(/_/g, ' '),
            (b.created_at || '').slice(0, 10),
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'AfriStay-Bookings-' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click(); URL.revokeObjectURL(url);
        toast('Bookings CSV exported!', 'success');
        logAudit({ action: 'export_bookings_csv', entityType: 'booking', description: `Exported ${(data||[]).length} bookings as CSV` });
    } catch(err) {
        toast('Export failed: ' + err.message, 'error');
        logAudit({ action: 'export_bookings_csv', description: 'CSV export error: ' + err.message, isError: true });
    }
};

/* ═══════════════════════════════════════════════════════════════
   PLATFORM CONFIG EDITOR
   ═══════════════════════════════════════════════════════════════ */
window.loadPlatformConfig = async function() {
    if (CURRENT_ROLE !== 'admin') return;
    const container = document.getElementById('platformConfigContainer');
    if (!container) return;
    container.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:16px;">Loading…</p>';
    try {
        const { data, error } = await _supabase
            .from('platform_config')
            .select('key, value, description')
            .order('key');
        if (error) throw error;

        if (!data?.length) {
            container.innerHTML = '<p style="color:#bbb;text-align:center;padding:16px;font-size:13px;">No config keys found.</p>';
            return;
        }

        container.innerHTML = data.map(c => `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f5f5f5;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;color:#1a1a1a;font-family:monospace;">${escapeHtml(c.key)}</div>
                    ${c.description ? `<div style="font-size:11px;color:#aaa;margin-top:1px;">${escapeHtml(c.description)}</div>` : ''}
                </div>
                <input type="text" id="cfg_${c.key}" value="${escapeHtml(c.value || '')}"
                    style="width:160px;padding:6px 10px;border:1.5px solid #ebebeb;border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none;"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();savePlatformConfig('${c.key}',this.value);}">
                <button class="btn-s" onclick="savePlatformConfig('${escapeHtml(c.key)}',document.getElementById('cfg_${c.key}').value)" title="Save">
                    <i class="fa-solid fa-floppy-disk"></i>
                </button>
            </div>
        `).join('');
    } catch(err) {
        container.innerHTML = `<p style="color:#e74c3c;font-size:13px;">${escapeHtml(err.message)}</p>`;
    }
};

window.savePlatformConfig = async function(key, value) {
    try {
        const { error } = await _supabase.from('platform_config').update({ value }).eq('key', key);
        if (error) throw error;
        toast(`"${key}" saved!`, 'success');
        logAudit({ action: 'update_platform_config', entityType: 'platform_config', entityId: key, description: `Set "${key}" = "${value}"` });
    } catch(err) {
        toast('Save failed: ' + err.message, 'error');
    }
};

/* ═══════════════════════════════════════════════════════════════
   BROADCAST NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════ */
window.sendBroadcast = async function() {
    if (CURRENT_ROLE !== 'admin') { toast('Admin only', 'error'); return; }
    const title   = document.getElementById('broadcastTitle')?.value.trim();
    const message = document.getElementById('broadcastMessage')?.value.trim();
    const target  = document.getElementById('broadcastTarget')?.value || 'all';
    const link    = document.getElementById('broadcastLink')?.value.trim() || null;

    if (!title || !message) { toast('Title and message are required', 'warning'); return; }

    const btn = document.getElementById('sendBroadcastBtn');
    const statusEl = document.getElementById('broadcastStatus');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending…'; }

    try {
        let q = _supabase.from('profiles').select('id').neq('id', CURRENT_PROFILE.id);
        if (target !== 'all') q = q.eq('role', target);
        const { data: users, error: uErr } = await q;
        if (uErr) throw uErr;
        if (!users?.length) { toast('No users matched that target', 'warning'); return; }

        const BATCH_SIZE = 100;
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE).map(u => ({
                user_id: u.id,
                type: 'broadcast',
                title,
                message,
                link: link || null,
                read: false,
            }));
            const { error: insErr } = await _supabase.from('notifications').insert(batch);
            if (insErr) throw insErr;
        }

        toast(`Broadcast sent to ${users.length} user(s)!`, 'success');
        logAudit({ action: 'broadcast_notification', entityType: 'notification', description: `Broadcast to "${target}" (${users.length} users): "${title}"` });
        if (statusEl) statusEl.innerHTML = `<div style="background:#e8f5e9;color:#27ae60;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:600;">✓ Sent to ${users.length} users</div>`;
        document.getElementById('broadcastTitle').value = '';
        document.getElementById('broadcastMessage').value = '';
        document.getElementById('broadcastLink').value = '';
    } catch(err) {
        toast('Broadcast failed: ' + err.message, 'error');
        logAudit({ action: 'broadcast_notification', description: 'Broadcast error: ' + err.message, isError: true });
        if (statusEl) statusEl.innerHTML = `<div style="background:#fde8e8;color:#e74c3c;padding:12px 16px;border-radius:10px;font-size:13px;">${escapeHtml(err.message)}</div>`;
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Broadcast'; }
    }
};

/* ═══════════════════════════════════════════════════════════════
   USER IMPERSONATION
   Admin generates a magic-link for any user via edge function
   ═══════════════════════════════════════════════════════════════ */
window.impersonateUser = async function(userId, userEmail) {
    if (CURRENT_ROLE !== 'admin') { toast('Admin only', 'error'); return; }
    if (!confirm(`Impersonate ${userEmail}?\n\nYou will be redirected and logged in as this user. Open in a new tab to keep your admin session.`)) return;

    toast('Generating impersonation link…', 'info', 4000);
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        const res = await fetch(CONFIG.FUNCTIONS_BASE + '/impersonate-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session?.access_token },
            body: JSON.stringify({ user_id: userId }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Edge function error');
        if (!json.url) throw new Error('No URL returned');

        logAudit({ action: 'impersonate_user', entityType: 'profile', entityId: userId, description: `Admin impersonated ${userEmail}` });
        window.open(json.url, '_blank');
    } catch(err) {
        toast('Impersonation failed: ' + err.message, 'error');
        logAudit({ action: 'impersonate_user', entityType: 'profile', entityId: userId, description: 'Impersonation error: ' + err.message, isError: true });
    }
};

/* ═══════════════════════════════════════════════════════════════
   MANUAL PAYOUT TRIGGER
   ═══════════════════════════════════════════════════════════════ */
window.loadPayoutOwners = async function() {
    if (CURRENT_ROLE !== 'admin') return;
    const sel = document.getElementById('payoutOwnerSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Loading…</option>';
    try {
        const { data, error } = await _supabase
            .from('profiles')
            .select('id, full_name, email')
            .eq('role', 'owner')
            .order('full_name');
        if (error) throw error;
        sel.innerHTML = '<option value="">Select owner…</option>' +
            (data || []).map(o => `<option value="${o.id}">${escapeHtml(o.full_name || o.email)}</option>`).join('');
    } catch(err) {
        sel.innerHTML = '<option value="">Failed to load</option>';
    }
};

/* ═══════════════════════════════════════════════════════════════
   MAINTENANCE MODE TOGGLE
   ═══════════════════════════════════════════════════════════════ */
window.setMaintenanceMode = async function(enable) {
    if (CURRENT_ROLE !== 'admin') { toast('Admin only', 'error'); return; }
    const msg = document.getElementById('maintenanceMsg')?.value.trim() || '';
    const label = enable ? 'ENABLE' : 'DISABLE';
    if (!confirm(`${label} maintenance mode? ${enable ? 'This will block the site for all non-admin users.' : 'This will restore normal access.'}`)) return;
    try {
        // Upsert maintenance_mode key
        await _supabase.from('platform_config').upsert({ key: 'maintenance_mode', value: enable ? 'true' : 'false' }, { onConflict: 'key' });
        if (enable && msg) {
            await _supabase.from('platform_config').upsert({ key: 'maintenance_message', value: msg }, { onConflict: 'key' });
        }
        toast(`Maintenance mode ${enable ? 'ENABLED — site is now blocked for users' : 'disabled — site is live again'}!`, enable ? 'warning' : 'success');
        logAudit({ action: enable ? 'enable_maintenance_mode' : 'disable_maintenance_mode', entityType: 'platform_config', description: enable ? `Maintenance enabled: ${msg || '(no message)'}` : 'Maintenance disabled' });
    } catch(err) {
        toast('Failed: ' + err.message, 'error');
    }
};

window.triggerPayout = async function() {
    if (CURRENT_ROLE !== 'admin') { toast('Admin only', 'error'); return; }
    const ownerId = document.getElementById('payoutOwnerSelect')?.value;
    const amount  = parseFloat(document.getElementById('payoutAmount')?.value || '0');
    const notes   = document.getElementById('payoutNotes')?.value.trim() || '';

    if (!ownerId) { toast('Select an owner', 'warning'); return; }
    if (!amount || amount <= 0) { toast('Enter a valid amount', 'warning'); return; }

    const ownerName = document.getElementById('payoutOwnerSelect')?.selectedOptions[0]?.text || ownerId;
    if (!confirm(`Trigger payout of ${amount.toLocaleString()} RWF to ${ownerName}?`)) return;

    try {
        const { error } = await _supabase.from('payouts').insert({
            owner_id:       ownerId,
            payout_amount:  amount,
            currency:       'RWF',
            status:         'pending',
            recipient_type: 'owner',
            notes:          notes || null,
            initiated_at:   new Date().toISOString(),
            fee_percent:    0,
            fee_amount:     0,
        });
        if (error) throw error;
        toast(`Payout of ${amount.toLocaleString()} RWF triggered!`, 'success');
        logAudit({ action: 'trigger_manual_payout', entityType: 'payout', entityId: ownerId, description: `Manual payout ${amount} RWF to ${ownerName}. Notes: ${notes}`, metadata: { owner_id: ownerId, amount, notes } });
        document.getElementById('payoutAmount').value = '';
        document.getElementById('payoutNotes').value  = '';
    } catch(err) {
        toast('Payout failed: ' + err.message, 'error');
        logAudit({ action: 'trigger_manual_payout', entityType: 'payout', description: 'Payout error: ' + err.message, isError: true });
    }
};