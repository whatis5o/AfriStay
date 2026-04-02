/**
 * AfriStay Service Worker
 * Strategy: Cache-first for static assets, network-first for API/Supabase calls
 */

const CACHE_NAME  = 'afristay-v1';
const OFFLINE_URL = '/offline.html';

// Static shell assets to pre-cache
const PRECACHE = [
    '/',
    '/index.html',
    '/Listings/',
    '/Events/',
    '/Style/style.css',
    '/js/config.js',
    '/js/utils.js',
    '/Pictures/favicon.png',
    OFFLINE_URL,
];

// ── Install: pre-cache shell ─────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
    );
});

// ── Activate: purge old caches ───────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: network-first for API, cache-first for static ────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Never intercept Supabase, auth, or external calls
    if (url.hostname.includes('supabase.co') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('cloudflare.com') ||
        url.hostname.includes('fontawesome') ||
        request.method !== 'GET') {
        return;
    }

    // Network-first for HTML navigation (fresh content)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .catch(() => caches.match(OFFLINE_URL))
        );
        return;
    }

    // Cache-first for static assets (CSS, JS, images, fonts)
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(request, clone));
                }
                return response;
            });
        })
    );
});
