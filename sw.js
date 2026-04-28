/**
 * AfriStay Service Worker v3
 * Strategies:
 *   - Static shell (CSS/JS/fonts): cache-first, auto-updates in background
 *   - HTML navigation: network-first with offline fallback
 *   - Supabase Storage images: cache-first (CDN images, 7-day TTL)
 *   - Supabase API/Auth/Functions: always network (bypass SW)
 *   - External CDN (FA, Google Fonts, jsDelivr): cache-first
 */

const SHELL_CACHE = 'afristay-shell-v4';
const IMG_CACHE   = 'afristay-imgs-v1';
const OFFLINE_URL = '/offline.html';

const IMG_MAX_AGE  = 7 * 24 * 60 * 60 * 1000; // 7 days
const IMG_MAX_ENTRIES = 150;

const PRECACHE = [
    '/',
    '/index.html',
    '/Listings/',
    '/Listings/index.html',
    '/Events/',
    '/Style/style.css',
    '/Style/index.css',
    '/Style/listing.css',
    '/Style/about.css',
    '/Style/auth.css',
    '/Style/dashboard.css',
    '/Style/contact.css',
    '/js/config.js',
    '/js/utils.js',
    '/js/script.js',
    '/js/auth.js',
    '/js/profile.js',
    '/js/home.js',
    '/js/detail.js',
    '/js/favorites.js',
    '/Pictures/favicon.png',
    OFFLINE_URL,
];

// ── Install ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

// ── Activate: purge old caches ───────────────────────────────────
self.addEventListener('activate', event => {
    const keep = [SHELL_CACHE, IMG_CACHE];
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// ── Helpers ──────────────────────────────────────────────────────
function isSupabaseApi(url) {
    // Bypass: REST, Auth, Edge Functions — but NOT storage public images
    return url.hostname.endsWith('supabase.co') && !url.pathname.startsWith('/storage/v1/object/public');
}

function isSupabaseStorage(url) {
    return url.hostname.endsWith('supabase.co') && url.pathname.startsWith('/storage/v1/object/public');
}

function isExternalCdn(url) {
    return url.hostname.includes('fonts.googleapis.com') ||
           url.hostname.includes('fonts.gstatic.com') ||
           url.hostname.includes('cdnjs.cloudflare.com') ||
           url.hostname.includes('cdn.jsdelivr.net') ||
           url.hostname.includes('fontawesome');
}

// Limit image cache size + enforce TTL
async function trimImageCache() {
    const cache   = await caches.open(IMG_CACHE);
    const keys    = await cache.keys();
    const now     = Date.now();
    // Delete expired first
    for (const req of keys) {
        const res = await cache.match(req);
        if (!res) continue;
        const dateStr = res.headers.get('sw-cached-at');
        if (dateStr && now - parseInt(dateStr, 10) > IMG_MAX_AGE) {
            await cache.delete(req);
        }
    }
    // Trim to max entries (oldest first)
    const remaining = await cache.keys();
    if (remaining.length > IMG_MAX_ENTRIES) {
        const toDelete = remaining.slice(0, remaining.length - IMG_MAX_ENTRIES);
        await Promise.all(toDelete.map(r => cache.delete(r)));
    }
}

async function cacheImage(request, response) {
    const cache = await caches.open(IMG_CACHE);
    // Clone response and inject a timestamp header so we can enforce TTL later
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', String(Date.now()));
    const stamped = new Response(await response.clone().arrayBuffer(), { status: response.status, statusText: response.statusText, headers });
    await cache.put(request, stamped);
    trimImageCache(); // async — don't block the response
}

// ── Fetch ────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // 1. Supabase API/Auth/Functions — always bypass
    if (isSupabaseApi(url)) return;

    // 2. Supabase Storage public images — cache-first with TTL
    if (isSupabaseStorage(url)) {
        event.respondWith((async () => {
            const cached = await caches.match(request, { cacheName: IMG_CACHE });
            if (cached) {
                const ts = parseInt(cached.headers.get('sw-cached-at') || '0', 10);
                if (Date.now() - ts < IMG_MAX_AGE) return cached;
            }
            try {
                const fresh = await fetch(request);
                if (fresh.ok) await cacheImage(request, fresh.clone());
                return fresh;
            } catch(e) {
                return cached || new Response('', { status: 503 });
            }
        })());
        return;
    }

    // 3. External CDN (fonts, FA, jsDelivr) — cache-first, stale-while-revalidate
    if (isExternalCdn(url)) {
        event.respondWith((async () => {
            const cached = await caches.match(request);
            if (cached) {
                // Revalidate in background
                fetch(request).then(res => {
                    if (res && res.status === 200) {
                        caches.open(SHELL_CACHE).then(c => c.put(request, res));
                    }
                }).catch(() => {});
                return cached;
            }
            const fresh = await fetch(request);
            if (fresh && fresh.status === 200) {
                const clone = fresh.clone();
                caches.open(SHELL_CACHE).then(c => c.put(request, clone));
            }
            return fresh;
        })());
        return;
    }

    // 4. HTML navigation — network-first with 7s timeout, cache on success, offline fallback
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            const networkFetch = fetch(request).then(res => {
                if (res && res.status === 200 && res.type === 'basic') {
                    caches.open(SHELL_CACHE).then(c => c.put(request, res.clone()));
                }
                return res;
            });
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('sw-timeout')), 7000)
            );
            try {
                return await Promise.race([networkFetch, timeout]);
            } catch {
                const cached = await caches.match(request);
                return cached || await caches.match(OFFLINE_URL);
            }
        })());
        return;
    }

    // 5. Same-origin static assets (CSS/JS/images) — cache-first, stale-while-revalidate
    if (url.origin === self.location.origin) {
        event.respondWith((async () => {
            const cached = await caches.match(request);
            const fetchPromise = fetch(request).then(res => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const clone = res.clone();
                    caches.open(SHELL_CACHE).then(c => c.put(request, clone));
                }
                return res;
            }).catch(() => null);

            // Return cache immediately; update in background
            return cached || fetchPromise;
        })());
    }
});
