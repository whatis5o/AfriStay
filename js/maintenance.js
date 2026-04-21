/**
 * maintenance.js — AfriStay
 * Self-contained: no dependencies on config.js, utils.js, or supabaseClient.
 * Include this in EVERY page <body> before closing </body>.
 *
 * Checks platform_config for maintenance_mode = 'true'.
 * - Admin users: see a dismissable yellow banner.
 * - Everyone else: sees a full-screen blocking overlay.
 */
(function () {
    const SUPA_URL  = 'https://xuxzeinufjpplxkerlsd.supabase.co';
    const SUPA_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1eHplaW51ZmpwcGx4a2VybHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NDQ0OTAsImV4cCI6MjA4NjMyMDQ5MH0.u8D-VZ98wBX448UJXq-UugLPTFf57uq946FSQXJLgac';
    const REST_BASE = SUPA_URL + '/rest/v1';
    const AUTH_BASE = SUPA_URL + '/auth/v1';

    const HEADERS = {
        'apikey':        SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
    };

    async function getSessionUserId() {
        // Try localStorage for Supabase v2 session token
        try {
            const storageKey = 'sb-' + SUPA_URL.split('//')[1].split('.')[0] + '-auth-token';
            const raw = localStorage.getItem(storageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const token = parsed?.access_token || parsed?.currentSession?.access_token;
            if (!token) return null;
            // Decode JWT payload (no verification needed — just reading uid)
            const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
            return payload?.sub || null;
        } catch (_) { return null; }
    }

    async function getUserRole(userId) {
        if (!userId) return null;
        try {
            const r = await fetch(
                `${REST_BASE}/profiles?id=eq.${userId}&select=role&limit=1`,
                { headers: HEADERS }
            );
            const data = await r.json();
            return data?.[0]?.role || null;
        } catch (_) { return null; }
    }

    async function run() {
        try {
            // Fetch both maintenance_mode + maintenance_message in parallel
            const [cfgRes, msgRes] = await Promise.all([
                fetch(`${REST_BASE}/platform_config?key=eq.maintenance_mode&select=value&limit=1`, { headers: HEADERS }),
                fetch(`${REST_BASE}/platform_config?key=eq.maintenance_message&select=value&limit=1`, { headers: HEADERS }),
            ]);

            const cfgData = await cfgRes.json();
            if (cfgData?.[0]?.value !== 'true') return; // not in maintenance

            const msgData = await msgRes.json();
            const msg = msgData?.[0]?.value || 'AfriStay is currently undergoing scheduled maintenance. We\'ll be back shortly!';

            // Determine if the current user is an admin
            const userId = await getSessionUserId();
            const role = await getUserRole(userId);
            const isAdmin = role === 'admin';

            if (isAdmin) {
                // Admin: dismissable banner only
                if (document.getElementById('_maintenanceBanner')) return;
                const banner = document.createElement('div');
                banner.id = '_maintenanceBanner';
                banner.style.cssText = [
                    'position:fixed;top:0;left:0;right:0;z-index:999999',
                    'background:#f39c12;color:#fff',
                    'padding:10px 20px',
                    'display:flex;align-items:center;justify-content:space-between',
                    'font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;gap:12px',
                ].join(';');
                banner.innerHTML =
                    '<span>! Maintenance mode is ON — users see a blocked page.' +
                    ' <a href="/Dashboards/Admin/?tab=settings" style="color:#fff;text-decoration:underline;margin-left:8px;">Turn off in Settings</a></span>' +
                    '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;">&times;</button>';
                document.body.prepend(banner);
            } else {
                // Non-admin: full-screen blocking overlay
                if (document.getElementById('_maintenanceOverlay')) return;
                const overlay = document.createElement('div');
                overlay.id = '_maintenanceOverlay';
                overlay.style.cssText = [
                    'position:fixed;inset:0;z-index:999999',
                    'background:rgba(18,18,18,0.97)',
                    'display:flex;align-items:center;justify-content:center',
                    'font-family:Inter,system-ui,sans-serif;padding:20px',
                ].join(';');
                overlay.innerHTML =
                    '<div style="text-align:center;max-width:480px;color:#fff;">' +
                    '<div style="font-size:72px;margin-bottom:24px;line-height:1;"></div>' +
                    '<h1 style="font-size:28px;font-weight:800;margin:0 0 16px;letter-spacing:-.5px;">Under Maintenance</h1>' +
                    '<p style="font-size:15px;color:rgba(255,255,255,.72);line-height:1.75;margin:0 0 28px;">' + _escHtml(msg) + '</p>' +
                    '<div style="background:rgba(235,103,83,.15);border:1px solid rgba(235,103,83,.3);border-radius:14px;padding:14px 20px;font-size:13px;color:rgba(255,255,255,.55);">' +
                    'Questions? Email <strong style="color:#EB6753;">support@afristay.rw</strong>' +
                    '</div></div>';
                document.body.appendChild(overlay);
                document.body.style.overflow = 'hidden';
            }
        } catch (_) { /* never crash the page */ }
    }

    function _escHtml(s) {
        return String(s)
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
    }

    // Run after DOM is ready (works even if script is in <head>)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
