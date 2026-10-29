<?php
// Step 8: Create mdl_ek_wifi_lock table for Air-Gapped Wi-Fi Enclosure & Guard
// Safe to re-run.
//
// Run:
//   docker compose exec -u www-data php php /opt/ekalavya/scripts/08-wifi-guard-migration.php

$host = getenv('DB_HOST') ?: 'db';
$dbname = getenv('DB_NAME') ?: 'moodle';
$user = getenv('DB_USER') ?: 'moodle';
$pass = getenv('DB_PASS');
if (empty($pass)) {
    fwrite(STDERR, "Database configuration error: DB_PASS environment variable is required.\n");
    exit(1);
}

echo "=== Ekalavya LMS: Wi-Fi Security Guard Migration ===\n";

$mysqli = @new mysqli($host, $user, $pass, $dbname, 3306);
if ($mysqli->connect_error) {
    fwrite(STDERR, "Database connection failed: " . $mysqli->connect_error . "\n");
    exit(1);
}

$mysqli->set_charset('utf8mb4');

$createSql = "
CREATE TABLE IF NOT EXISTS mdl_ek_wifi_lock (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    is_locked TINYINT(1) NOT NULL DEFAULT 0,
    authorized_ssid VARCHAR(128) NOT NULL DEFAULT '',
    authorized_bssid VARCHAR(64) NOT NULL DEFAULT '',
    authorized_gateway VARCHAR(64) NOT NULL DEFAULT '',
    authorized_subnet VARCHAR(64) NOT NULL DEFAULT '',
    current_ssid VARCHAR(128) NOT NULL DEFAULT '',
    current_bssid VARCHAR(64) NOT NULL DEFAULT '',
    current_gateway VARCHAR(64) NOT NULL DEFAULT '',
    current_host_ip VARCHAR(64) NOT NULL DEFAULT '',
    host_connected TINYINT(1) NOT NULL DEFAULT 1,
    last_heartbeat BIGINT NOT NULL DEFAULT 0,
    last_violation_reason VARCHAR(255) NULL,
    updated_by BIGINT NOT NULL DEFAULT 0,
    timecreated BIGINT NOT NULL DEFAULT 0,
    timemodified BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
";

if ($mysqli->query($createSql) === TRUE) {
    echo "  + Table 'mdl_ek_wifi_lock' created / verified successfully.\n";
} else {
    fwrite(STDERR, "Failed to create table 'mdl_ek_wifi_lock': " . $mysqli->error . "\n");
    $mysqli->close();
    exit(1);
}

// Ensure at least one initial config row exists
$res = $mysqli->query("SELECT id FROM mdl_ek_wifi_lock WHERE id = 1 LIMIT 1");
if ($res && $res->num_rows === 0) {
    $envSsid = getenv('ALLOWED_WIFI_SSID') ?: '';
    $envSubnet = getenv('ALLOWED_WIFI_SUBNET') ?: '';
    $envGateway = getenv('ALLOWED_WIFI_GATEWAY') ?: '';
    $isLocked = (!empty($envSsid) || !empty($envSubnet)) ? 1 : 0;

    $stmt = $mysqli->prepare("INSERT INTO mdl_ek_wifi_lock 
        (id, is_enabled, is_locked, authorized_ssid, authorized_subnet, authorized_gateway, host_connected, timecreated, timemodified)
        VALUES (1, 1, ?, ?, ?, ?, 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())");
    $stmt->bind_param('isss', $isLocked, $envSsid, $envSubnet, $envGateway);
    $stmt->execute();
    $stmt->close();
    echo "  + Inserted initial Wi-Fi configuration record (ID 1).\n";
} else {
    echo "  = Wi-Fi configuration record (ID 1) already present.\n";
}

$mysqli->close();
echo "=== Wi-Fi Security Guard Migration Complete ===\n";
