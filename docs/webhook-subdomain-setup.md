# IremboPay Callback URL — Subdomain Setup Guide

## Your Callback URL

```
https://api.afristay.rw/payment/webhook
```

Give **exactly this URL** to IremboPay as the webhook/callback URL.

---

## How it works

```
IremboPay → api.afristay.rw/payment/webhook (PHP proxy)
                        ↓  adds X-AfriStay-Proxy-Secret header
         xuxzeinufjpplxkerlsd.supabase.co/functions/v1/irembo-webhook
```

- Anyone calling the raw Supabase URL directly gets `404 Not Found`
- Only calls through your proxy (which knows the secret) go through
- IremboPay's HMAC signature is **also** verified inside the edge function — double layer

---

## Step 1 — Generate a Proxy Secret

Run this in your browser console or any terminal to get a random secret:

```js
// Browser console
crypto.getRandomValues(new Uint8Array(32))
  .reduce((s, b) => s + b.toString(16).padStart(2,'0'), '')
// Example output: a3f8c2e1d9b47062...
```

Or use any random string generator — just make it long (32+ chars).

---

## Step 2 — Set the secret in Supabase

1. Go to: https://supabase.com/dashboard/project/xuxzeinufjpplxkerlsd/settings/functions
2. Under **Edge Function Secrets**, add:
   - Name: `PROXY_SECRET`
   - Value: `<your-generated-secret>`
3. Click Save.

---

## Step 3 — Put the secret in webhook.php

Open `api/webhook.php` and replace the placeholder:

```php
define('PROXY_SECRET', 'YOUR_PROXY_SECRET_HERE');
//                      ↑ paste your secret here (same value as Supabase)
```

---

## Step 4 — Create `api.afristay.rw` subdomain in cPanel

1. Log in to cPanel at your host
2. Go to **Domains** → **Subdomains** (or **Zone Editor**)
3. Create subdomain:
   - Subdomain: `api`
   - Domain: `afristay.rw`
   - Document root: `public_html/api` (or wherever you'll upload the files)
4. Wait 1–5 minutes for DNS to propagate

---

## Step 5 — Upload files to cPanel

Upload these two files to the `api` subdomain's document root:

```
api/
├── webhook.php     ← the PHP proxy
└── .htaccess       ← clean URL rewrite rules
```

Via cPanel File Manager or FTP. The document root is usually:
`/home/<yourusername>/public_html/api/`

---

## Step 6 — Enable SSL on the subdomain

1. In cPanel → **SSL/TLS** → **Let's Encrypt** (or AutoSSL)
2. Issue a certificate for `api.afristay.rw`
3. This makes the URL `https://` which IremboPay requires

---

## Step 7 — Test the proxy

Run this curl command to check the proxy is working (should get 401 from IremboPay sig check, not 404):

```bash
curl -X POST https://api.afristay.rw/payment/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

Expected: `{"error": "..."}` with status 401 (signature missing) — **not** 404.

If you get 404, the proxy secret check is rejecting it — means `PROXY_SECRET` env var doesn't match `webhook.php`.

---

## Step 8 — Register URL with IremboPay

Send IremboPay this exact URL:

```
https://api.afristay.rw/payment/webhook
```

That's it. IremboPay sends a POST here → proxy forwards to Supabase → booking confirmed, emails sent.

---

## Security summary

| Layer | What it does |
|-------|-------------|
| `X-AfriStay-Proxy-Secret` header | Blocks anyone calling Supabase URL directly |
| IremboPay HMAC signature | Blocks anyone faking a payment webhook |
| HTTPS | Encrypts the payload in transit |
| cPanel `.htaccess` | Blocks directory browsing of `/api/` |
