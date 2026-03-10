<?php
$secret = 'afriStay@2026#deploy';

$signature = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
$payload = file_get_contents('php://input');
$expected = 'sha256=' . hash_hmac('sha256', $payload, $secret);

if (!hash_equals($expected, $signature)) {
    http_response_code(403);
    die('Unauthorized');
}

$output = shell_exec('cd /home/afristay/public_html && git pull 2>&1');

echo json_encode(['status' => 'deployed', 'output' => $output]);
?>