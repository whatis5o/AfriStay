# AfriStay — IremboPay Callback URL Setup
> Follow this top to bottom. Do not skip steps.

---

## Your new callback URL (give this to IremboPay)

```
https://api.afristay.rw/payment/webhook
```

---

## Your Proxy Secret (generated, keep this private)

```
05b9c57d491f497d186acfd5ac48df1b2ab6c80a4a5d74e5b2c865b84a393f10
```

> This secret is the handshake between your PHP proxy and your Supabase function.
> Anyone calling the raw Supabase URL directly gets a 404 — only your proxy knows the secret.

---

## Step 1 — Add the secret to Supabase

1. Open: https://supabase.com/dashboard/project/xuxzeinufjpplxkerlsd/settings/functions
2. Scroll to **"Edge Function Secrets"**
3. Click **"Add new secret"**
4. Fill in:
   - **Name:** `PROXY_SECRET`
   - **Value:** `05b9c57d491f497d186acfd5ac48df1b2ab6c80a4a5d74e5b2c865b84a393f10`
5. Click **Save**

Done. Supabase now knows the secret.

---

## Step 2 — Put the secret in webhook.php

Open `api/webhook.php` in your project. Line 17 currently says:

```php
define('PROXY_SECRET', 'YOUR_PROXY_SECRET_HERE');
```

Change it to:

```php
define('PROXY_SECRET', '05b9c57d491f497d186acfd5ac48df1b2ab6c80a4a5d74e5b2c865b84a393f10');
```

Save the file.

---

## Step 3 — Create the `api.afristay.rw` subdomain in cPanel

1. Log into your cPanel (usually `afristay.rw/cpanel` or your host's login link)
2. Go to **Domains** → **Subdomains**
3. Fill in:
   - **Subdomain:** `api`
   - **Domain:** `afristay.rw`
   - **Document Root:** `public_html/api` ← cPanel fills this automatically, keep it
4. Click **Create**
5. Wait 2–5 minutes

---

## Step 4 — Upload the two files to cPanel

You need to upload these two files from your project's `api/` folder to cPanel:

| Local file | Upload to (on server) |
|---|---|
| `api/webhook.php` | `/public_html/api/webhook.php` |
| `api/.htaccess` | `/public_html/api/.htaccess` |

**How to upload:**
1. In cPanel → **File Manager**
2. Navigate to `public_html/api/` (it was created in Step 3)
3. Click **Upload** → upload both files
4. For `.htaccess`: if you can't see it in File Manager, click **Settings** (top right) → check **"Show hidden files"**

---

## Step 5 — Enable HTTPS on the subdomain

IremboPay requires HTTPS. Do this:

1. In cPanel → **SSL/TLS** → **Let's Encrypt SSL** (or **AutoSSL**)
2. Find `api.afristay.rw` in the list
3. Click **Issue** (or it may already be included automatically — check if `api.afristay.rw` appears as covered)
4. Wait 2–3 minutes

To verify: open `https://api.afristay.rw` in your browser. You should see a 403 Forbidden (the `.htaccess` is blocking browsing) — that means it's working and HTTPS is live.

---

## Step 6 — Test the full chain

Open your terminal (or Git Bash on Windows) and run:

```bash
curl -X POST https://api.afristay.rw/payment/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

**Expected result:** A JSON response with an error about missing signature — something like:
```json
{"error": "Unauthorized"} 
```
with HTTP status 401.

This means:
- Your subdomain is live ✓
- HTTPS is working ✓
- The proxy forwarded the request to Supabase ✓
- Supabase rejected it (correctly) because there's no IremboPay signature ✓

**If you get 404** → the proxy secret in `webhook.php` doesn't match the one in Supabase. Re-check Step 1 and 2.

**If you get a cURL/connection error** → subdomain or HTTPS isn't set up yet. Wait a few more minutes or re-check Step 3–5.

---

## Step 7 — Test that the raw Supabase URL is blocked

Run this:

```bash
curl -X POST https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/irembo-webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

**Expected result:** `Not Found` with HTTP 404.

If you get anything other than 404, the secret isn't set in Supabase yet — go back to Step 1.

---

## Step 8 — Update the URL in IremboPay portal

1. Log into your IremboPay merchant portal
2. Go to **Settings** → **Webhooks** (or **Callback URL** / **Integration Settings** — the name varies)
3. Replace the existing URL with:
   ```
   https://api.afristay.rw/payment/webhook
   ```
4. Save

That's it. IremboPay will now send all payment events to your branded URL.

---

## How the security works (for reference)

```
IremboPay server
      │
      │  POST https://api.afristay.rw/payment/webhook
      ▼
  PHP Proxy (webhook.php)
  - Adds header: X-AfriStay-Proxy-Secret: 05b9c57...
  - Forwards: irembopay-signature header
  - Forwards: request body (unchanged)
      │
      │  POST https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/irembo-webhook
      ▼
  Supabase Edge Function (irembo-webhook)
  - Check 1: X-AfriStay-Proxy-Secret must match → else 404
  - Check 2: irembopay-signature HMAC must be valid → else 401
  - If both pass: update booking, send emails ✓
```

Anyone calling the Supabase URL directly → **404** (no proxy secret)
Anyone faking a webhook from a different source → **401** (HMAC fails)

---

## Summary checklist

- [ ] Secret added to Supabase → `PROXY_SECRET`
- [ ] Secret pasted into `api/webhook.php` line 17
- [ ] `api.afristay.rw` subdomain created in cPanel
- [ ] `webhook.php` and `.htaccess` uploaded to `/public_html/api/`
- [ ] HTTPS enabled for `api.afristay.rw`
- [ ] Tested proxy: returns 401 (not 404, not connection error)
- [ ] Tested raw Supabase URL: returns 404
- [ ] Updated URL in IremboPay portal to `https://api.afristay.rw/payment/webhook`
