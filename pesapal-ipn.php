<?php
/**
 * pesapal-ipn.php
 * Upload this file to: afristay.rw/pesapal-ipn.php
 *
 * Then use this as your Pesapal IPN Listener URL:
 *   https://afristay.rw/pesapal-ipn.php
 *
 * This file receives Pesapal's notification and forwards
 * it to your Supabase edge function. That's all it does.
 */

// Your Supabase webhook function URL
define('SUPABASE_WEBHOOK', 'https://xuxzeinufjpplxkerlsd.supabase.co/functions/v1/kpay-webhook');

// Log file for debugging (disable in production by setting to null)
define('LOG_FILE', __DIR__ . '/pesapal-ipn.log');

// ── Read incoming request ─────────────────────────────────────
$method  = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$rawBody = file_get_contents('php://input');
$getParams = $_GET;

// Build a unified payload — Pesapal sends params as GET query string
// even on POST requests sometimes, so capture both
$payload = array_merge($getParams, (array)json_decode($rawBody, true));

// Pesapal sends these key fields:
// OrderTrackingId, OrderNotificationType, OrderMerchantReference
$trackingId = $payload['OrderTrackingId']        ?? $payload['orderTrackingId']        ?? '';
$notifType  = $payload['OrderNotificationType']  ?? $payload['orderNotificationType']  ?? '';
$merchantRef= $payload['OrderMerchantReference'] ?? $payload['orderMerchantReference'] ?? '';

// ── Log it ────────────────────────────────────────────────────
if (LOG_FILE) {
    $entry = date('Y-m-d H:i:s') . " | METHOD=$method | tracking=$trackingId | ref=$merchantRef | body=" . substr($rawBody, 0, 300) . "\n";
    file_put_contents(LOG_FILE, $entry, FILE_APPEND);
}

// ── Forward to Supabase ───────────────────────────────────────
// Translate Pesapal's format into the shape kpay-webhook expects
$forwardPayload = json_encode([
    'provider'          => 'pesapal',
    'tid'               => $trackingId,
    'refid'             => $merchantRef,
    'statusid'          => '01',          // Pesapal only pings on success — we'll verify below
    'statusdesc'        => $notifType,
    'OrderTrackingId'   => $trackingId,
    'OrderMerchantReference' => $merchantRef,
    'raw'               => $payload,
]);

$ch = curl_init(SUPABASE_WEBHOOK);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $forwardPayload,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Content-Length: ' . strlen($forwardPayload),
    ],
]);

$response   = curl_exec($ch);
$httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError  = curl_error($ch);
curl_close($ch);

// ── Log response ──────────────────────────────────────────────
if (LOG_FILE) {
    $entry = date('Y-m-d H:i:s') . " | Supabase response: HTTP $httpStatus | " . substr($response, 0, 200) . "\n";
    file_put_contents(LOG_FILE, $entry, FILE_APPEND);
}

// ── Respond to Pesapal ────────────────────────────────────────
// Pesapal expects a 200 OK with this exact JSON
http_response_code(200);
header('Content-Type: application/json');
echo json_encode([
    'orderNotificationType' => $notifType,
    'orderTrackingId'       => $trackingId,
    'orderMerchantReference'=> $merchantRef,
    'status'                => 200,
]);
