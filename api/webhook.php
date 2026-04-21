<?php
/**
 * AfriStay Payment Webhook Proxy
 * Deploy to: api.afristay.rw/webhook.php
 * Clean URL via .htaccess: https://api.afristay.rw/payment/webhook
 *
 * Forwards IremboPay webhook to Supabase Edge Function.
 * Adds X-AfriStay-Proxy-Secret so the edge function rejects
 * any direct calls to the raw Supabase URL.
 *
 * Set PROXY_SECRET to the same value in Supabase → Settings → Edge Function Secrets.
 */

define('PROXY_SECRET', '05b9c57d491f497d186acfd5ac48df1b2ab6c80a4a5d74e5b2c865b84a393f10'); // <-- paste your secret here (same as Supabase env var)
define('TARGET',       'https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/irembo-webhook');

// Only accept POST from IremboPay
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('Method Not Allowed');
}

$body    = file_get_contents('php://input');
$headers = ['X-AfriStay-Proxy-Secret: ' . PROXY_SECRET];

foreach (getallheaders() as $name => $value) {
    $lower = strtolower($name);
    if (in_array($lower, ['irembopay-signature', 'content-type', 'x-api-version', 'x-real-ip', 'x-forwarded-for'])) {
        $headers[] = "$name: $value";
    }
}

$ch = curl_init(TARGET);
curl_setopt($ch, CURLOPT_POST,           true);
curl_setopt($ch, CURLOPT_POSTFIELDS,     $body);
curl_setopt($ch, CURLOPT_HTTPHEADER,     $headers);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT,        30);

$response   = curl_exec($ch);
$statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError  = curl_error($ch);
curl_close($ch);

if ($curlError) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Proxy error', 'detail' => $curlError]);
    exit;
}

http_response_code($statusCode ?: 500);
header('Content-Type: application/json');
echo $response;
