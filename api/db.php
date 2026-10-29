<?php
// Dronacharya LMS - Database connection + session helper
// Connects to Moodle's MySQL database via MySQLi
// Configure hardened session cookies before session_start()
if (session_status() === PHP_SESSION_NONE) {
    // Only use cookies, not URL parameters
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.cookie_httponly', '1');
    
    // Check if HTTPS is on or trusted proxy sent X-Forwarded-Proto https
    $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https')
        || (!empty($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443);

    session_name('__Host-EKALAVYA_SESSID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'domain'   => '',
        'secure'   => $isSecure,
        'httponly' => true,
        'samesite' => 'Strict'
    ]);
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

// Enforce session idle timeout (30 min = 1800s) and absolute timeout (8 hours = 28800s)
if (isset($_SESSION['ek_user'])) {
    $now = time();
    $lastActivity = $_SESSION['LAST_ACTIVITY'] ?? $now;
    $createdTime = $_SESSION['CREATED_TIME'] ?? $now;

    if (($now - $lastActivity) > 1800 || ($now - $createdTime) > 28800) {
        $_SESSION = [];
        if (session_id()) {
            session_destroy();
        }
        $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
        setcookie('__Host-EKALAVYA_SESSID', '', [
            'expires'  => time() - 3600,
            'path'     => '/',
            'domain'   => '',
            'secure'   => $isSecure,
            'httponly' => true,
            'samesite' => 'Strict'
        ]);
    } else {
        $_SESSION['LAST_ACTIVITY'] = $now;
    }
}

function get_db_connection(): mysqli {
    static $conn = null;
    if ($conn !== null) {
        return $conn;
    }

    $host = getenv('DB_HOST') ?: 'db';
    $dbname = getenv('DB_NAME') ?: 'moodle';
    $user = getenv('DB_USER') ?: 'moodle';
    $pass = getenv('DB_PASS');

    if ($pass === false || $pass === '') {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Database configuration error: DB_PASS missing']);
        exit;
    }

    $conn = @new mysqli($host, $user, $pass, $dbname, 3306);
    if ($conn->connect_error) {
        error_log("Database connection error: " . $conn->connect_error);
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Internal database service unavailable']);
        exit;
    }

    $conn->set_charset('utf8mb4');
    return $conn;
}

// Get current logged-in user from session, or null
function get_current_user_session(): ?array {
    return $_SESSION['ek_user'] ?? null;
}

// Verify live user status in database to prevent stale privilege retention (SEC-A05)
function refresh_and_validate_user(mysqli $mysqli, array $cachedUser): ?array {
    $userId = (int)($cachedUser['id'] ?? 0);
    if ($userId < 2) {
        return null;
    }

    $stmt = $mysqli->prepare("SELECT id, username, firstname, lastname, email, suspended, deleted FROM mdl_user WHERE id = ? LIMIT 1");
    if (!$stmt) {
        return null;
    }
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $res = $stmt->get_result();
    $dbUser = $res->fetch_assoc();
    $stmt->close();

    if (!$dbUser || (int)$dbUser['deleted'] !== 0 || (int)$dbUser['suspended'] !== 0) {
        return null;
    }

    // Determine current role dynamically
    $role = 'student';
    $roleLabel = 'Student Officer';
    $assignedCourses = [];

    if ($dbUser['username'] === 'siteadmin' || (int)$dbUser['id'] === 2) {
        $role = 'instituteadmin';
        $roleLabel = 'Site Administrator';
    } else {
        $rStmt = $mysqli->prepare("
            SELECT r.shortname 
            FROM mdl_role_assignments ra
            JOIN mdl_role r ON r.id = ra.roleid
            WHERE ra.userid = ? AND r.shortname = 'instituteadmin'
            LIMIT 1
        ");
        $rStmt->bind_param('i', $userId);
        $rStmt->execute();
        if ($rStmt->get_result()->fetch_assoc()) {
            $role = 'instituteadmin';
            $roleLabel = 'Institute Admin';
        }
        $rStmt->close();

        if ($role === 'student') {
            $rStmt2 = $mysqli->prepare("
                SELECT r.shortname, ctx.instanceid as courseid
                FROM mdl_role_assignments ra
                JOIN mdl_role r ON r.id = ra.roleid
                JOIN mdl_context ctx ON ctx.id = ra.contextid
                WHERE ra.userid = ? AND r.shortname = 'courseadmin' AND ctx.contextlevel = 50
            ");
            $rStmt2->bind_param('i', $userId);
            $rStmt2->execute();
            $cRes = $rStmt2->get_result();
            while ($cRow = $cRes->fetch_assoc()) {
                $role = 'courseadmin';
                $roleLabel = 'Course Admin';
                $assignedCourses[] = (int)$cRow['courseid'];
            }
            $rStmt2->close();
        }
    }

    // Resolve enrolled courses
    $enrolledCourses = [];
    $enrolStmt = $mysqli->prepare("
        SELECT c.id, c.shortname, c.fullname
        FROM mdl_user_enrolments ue
        JOIN mdl_enrol e ON e.id = ue.enrolid
        JOIN mdl_course c ON c.id = e.courseid
        WHERE ue.userid = ? AND c.id > 1 AND ue.status = 0
    ");
    $enrolStmt->bind_param('i', $userId);
    $enrolStmt->execute();
    $enrolRes = $enrolStmt->get_result();
    while ($er = $enrolRes->fetch_assoc()) {
        $enrolledCourses[] = $er;
    }
    $enrolStmt->close();

    $updatedUser = [
        'id'               => (int)$dbUser['id'],
        'username'         => $dbUser['username'],
        'firstname'        => $dbUser['firstname'],
        'lastname'         => $dbUser['lastname'],
        'email'            => $dbUser['email'],
        'role'             => $role,
        'role_label'       => $roleLabel,
        'assigned_courses' => $assignedCourses,
        'enrolled_courses' => $enrolledCourses,
        'can_edit'         => in_array($role, ['instituteadmin', 'courseadmin']),
        'can_manage_users' => ($role === 'instituteadmin'),
        'can_add_course'   => ($role === 'instituteadmin'),
        'can_delete_course'=> ($role === 'instituteadmin'),
    ];

    $_SESSION['ek_user'] = $updatedUser;
    return $updatedUser;
}

// Require authentication - returns user or sends 401
function require_auth(): array {
    $cached = get_current_user_session();
    if (!$cached) {
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Not authenticated. Please log in.']);
        exit;
    }

    $mysqli = get_db_connection();
    $liveUser = refresh_and_validate_user($mysqli, $cached);

    if (!$liveUser) {
        $_SESSION = [];
        if (session_id()) {
            session_destroy();
        }
        $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
        setcookie('__Host-EKALAVYA_SESSID', '', [
            'expires'  => time() - 3600,
            'path'     => '/',
            'domain'   => '',
            'secure'   => $isSecure,
            'httponly' => true,
            'samesite' => 'Strict'
        ]);
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Session expired or account is inactive. Please log in again.']);
        exit;
    }

    return $liveUser;
}

// Check if current user has one of the required roles
function require_role(array $allowedRoles): array {
    $user = require_auth();
    if (!in_array($user['role'], $allowedRoles)) {
        http_response_code(403);
        echo json_encode(['status' => 'error', 'message' => 'Access denied. Required role: ' . implode(' or ', $allowedRoles)]);
        exit;
    }
    return $user;
}

// Require course authorization guard
function require_course_access(mysqli $mysqli, array $currentUser, int $courseId, string $action = 'view'): void {
    if (!function_exists('can_user_access_course')) {
        require_once __DIR__ . '/index.php';
    }
    $requireEdit = in_array($action, ['edit', 'manage', 'delete', 'upload']);
    if (!can_user_access_course($mysqli, $currentUser, $courseId, $requireEdit)) {
        http_response_code(403);
        echo json_encode(['status' => 'error', 'message' => "Access denied. You do not have permission to {$action} this course."]);
        exit;
    }
}

// Client IP resolver respecting trusted reverse proxy
function get_client_ip(): string {
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ips = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $ip = trim($ips[0]);
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
    }
    if (!empty($_SERVER['HTTP_X_REAL_IP']) && filter_var($_SERVER['HTTP_X_REAL_IP'], FILTER_VALIDATE_IP)) {
        return $_SERVER['HTTP_X_REAL_IP'];
    }
    return $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
}

// Redis client connector with credentials from environment
function get_redis_connection(): ?Redis {
    static $redis = null;
    static $attempted = false;
    if ($attempted) {
        return $redis;
    }
    $attempted = true;

    if (!class_exists('Redis')) {
        return null;
    }

    try {
        $client = new Redis();
        $host = getenv('REDIS_HOST') ?: 'redis';
        $port = (int)(getenv('REDIS_PORT') ?: 6379);
        $pass = getenv('REDIS_PASSWORD');

        if ($client->connect($host, $port, 1.5)) {
            if (!empty($pass)) {
                $client->auth($pass);
            }
            $redis = $client;
        }
    } catch (Throwable $e) {
        error_log("Redis connection error: " . $e->getMessage());
        $redis = null;
    }

    return $redis;
}

// Server-side password policy validator enforcing 12+ chars and complexity (SEC-A06)
function validate_password_policy(string $password, ?string &$errorMsg = null): bool {
    if (strlen($password) < 12) {
        $errorMsg = 'Password must be at least 12 characters long';
        return false;
    }
    if (!preg_match('/[a-z]/', $password)) {
        $errorMsg = 'Password must include at least one lowercase letter';
        return false;
    }
    if (!preg_match('/[A-Z]/', $password)) {
        $errorMsg = 'Password must include at least one uppercase letter';
        return false;
    }
    if (!preg_match('/[0-9]/', $password)) {
        $errorMsg = 'Password must include at least one numerical digit';
        return false;
    }
    if (!preg_match('/[^a-zA-Z0-9]/', $password)) {
        $errorMsg = 'Password must include at least one special character';
        return false;
    }
    return true;
}

// Check Redis-backed login lockout (SEC-A02)
function check_login_lockout(string $username, string $ip): ?string {
    $redis = get_redis_connection();
    if (!$redis) {
        return null; // Graceful fallback
    }

    try {
        // IP rate limit: max 30 attempts per minute
        $ipKey = "ek_ratelimit_ip:{$ip}";
        $ipAttempts = (int)$redis->get($ipKey);
        if ($ipAttempts >= 30) {
            return "Too many requests from this IP address. Please wait a minute before retrying.";
        }

        // Account lockout check (lockoutduration = 1800s per 02-harden.sh)
        $cleanUser = strtolower(trim($username));
        $lockKey = "ek_lock_user:{$cleanUser}";
        $isLocked = $redis->get($lockKey);
        if ($isLocked) {
            $ttl = $redis->ttl($lockKey);
            $mins = ceil(($ttl > 0 ? $ttl : 1800) / 60);
            return "Account is temporarily locked due to multiple failed login attempts. Please try again in {$mins} minutes.";
        }
    } catch (Throwable $e) {
        error_log("Redis lockout check error: " . $e->getMessage());
    }

    return null;
}

// Record login failure and trigger lockout after 5 attempts (SEC-A02)
function record_login_failure(string $username, string $ip): int {
    $redis = get_redis_connection();
    if (!$redis) {
        return 0;
    }

    try {
        // Increment IP rate limit
        $ipKey = "ek_ratelimit_ip:{$ip}";
        $ipCount = $redis->incr($ipKey);
        if ($ipCount === 1) {
            $redis->expire($ipKey, 60);
        }

        // Increment username fail count
        $cleanUser = strtolower(trim($username));
        $failKey = "ek_fail_user:{$cleanUser}";
        $fails = $redis->incr($failKey);
        if ($fails === 1) {
            $redis->expire($failKey, 1800); // 30 min window
        }

        if ($fails >= 5) {
            $lockKey = "ek_lock_user:{$cleanUser}";
            $redis->setex($lockKey, 1800, '1'); // Lock for 30 minutes
        }

        return $fails;
    } catch (Throwable $e) {
        error_log("Redis failure record error: " . $e->getMessage());
        return 0;
    }
}

// Clear login failures on successful authentication
function clear_login_failures(string $username): void {
    $redis = get_redis_connection();
    if (!$redis) {
        return;
    }

    try {
        $cleanUser = strtolower(trim($username));
        $redis->del("ek_fail_user:{$cleanUser}");
        $redis->del("ek_lock_user:{$cleanUser}");
    } catch (Throwable $e) {
        error_log("Redis clear failures error: " . $e->getMessage());
    }
}

// Verify Origin and Referer for state-changing requests (SEC-C02)
function verify_request_origin(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    $referer = $_SERVER['HTTP_REFERER'] ?? null;
    $host = $_SERVER['HTTP_HOST'] ?? '';

    $hostOnly = strtolower(explode(':', $host)[0]);
    $allowedHosts = ['ekalavya.local', 'localhost', '127.0.0.1'];
    if (!empty($hostOnly) && !in_array($hostOnly, $allowedHosts, true)) {
        $allowedHosts[] = $hostOnly;
    }

    if ($origin !== null && $origin !== '') {
        $parsed = parse_url($origin);
        $originHost = strtolower($parsed['host'] ?? '');
        if (!in_array($originHost, $allowedHosts, true)) {
            http_response_code(403);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['status' => 'error', 'message' => 'Origin header validation failed']);
            exit;
        }
    }

    if ($referer !== null && $referer !== '') {
        $parsed = parse_url($referer);
        $refererHost = strtolower($parsed['host'] ?? '');
        if (!in_array($refererHost, $allowedHosts, true)) {
            http_response_code(403);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['status' => 'error', 'message' => 'Referer header validation failed']);
            exit;
        }
    }
}

// Enforce CSRF protection on state-changing requests (SEC-C01)
function require_csrf_token(string $action): void {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if (!in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
        return;
    }

    // Login and internal watchdog sync do not have a web session
    if ($action === 'login' || $action === 'wifi-sync') {
        return;
    }

    $sessionToken = $_SESSION['csrf_token'] ?? '';
    if (empty($sessionToken)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['status' => 'error', 'message' => 'Session expired or missing CSRF token. Please log in again.']);
        exit;
    }

    // Check header or POST param or parsed body
    $clientToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
    if (!$clientToken && isset($_POST['csrf_token'])) {
        $clientToken = $_POST['csrf_token'];
    }
    if (!$clientToken) {
        global $body;
        if (is_array($body) && isset($body['csrf_token'])) {
            $clientToken = $body['csrf_token'];
        }
    }

    if (!$clientToken || !hash_equals($sessionToken, $clientToken)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['status' => 'error', 'message' => 'Invalid or missing CSRF token']);
        exit;
    }
}

// Ensure persistent security audit log table exists (SEC-F01)
function ensure_audit_table(mysqli $mysqli): void {
    static $ensured = false;
    if ($ensured) return;

    $mysqli->query("
        CREATE TABLE IF NOT EXISTS mdl_ek_audit (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT DEFAULT NULL,
            username VARCHAR(100) DEFAULT NULL,
            event_type VARCHAR(50) NOT NULL,
            target_type VARCHAR(50) DEFAULT NULL,
            target_id VARCHAR(50) DEFAULT NULL,
            ip_address VARCHAR(45) NOT NULL,
            user_agent VARCHAR(255) DEFAULT NULL,
            details TEXT DEFAULT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_time (user_id, created_at),
            INDEX idx_event (event_type, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $ensured = true;
}

// Log security-relevant audit event (SEC-F01)
function log_audit_event(
    mysqli $mysqli,
    string $eventType,
    ?string $targetType = null,
    ?string $targetId = null,
    ?array $details = null,
    string $status = 'SUCCESS',
    ?array $user = null
): void {
    try {
        ensure_audit_table($mysqli);

        if ($user === null) {
            $user = get_current_user_session();
        }
        $userId = $user ? (int)($user['id'] ?? 0) : null;
        if ($userId <= 0) $userId = null;
        $username = $user ? ($user['username'] ?? null) : null;
        $ip = get_client_ip();
        $userAgent = substr($_SERVER['HTTP_USER_AGENT'] ?? 'Unknown', 0, 255);

        // Strictly purge sensitive credentials before recording details
        if ($details !== null) {
            unset($details['password'], $details['csrf_token'], $details['token'], $details['pass']);
        }
        $detailsJson = $details ? json_encode($details, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : null;

        $stmt = $mysqli->prepare("
            INSERT INTO mdl_ek_audit 
            (user_id, username, event_type, target_type, target_id, ip_address, user_agent, details, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        if ($stmt) {
            $stmt->bind_param('issssssss', $userId, $username, $eventType, $targetType, $targetId, $ip, $userAgent, $detailsJson, $status);
            $stmt->execute();
            $stmt->close();
        }
    } catch (Throwable $e) {
        error_log("Audit logging error: " . $e->getMessage());
    }
}

// Check if an IP address belongs to a CIDR or comma-separated list of CIDRs
function is_ip_in_subnet(string $ip, string $cidrList): bool {
    if ($ip === '127.0.0.1' || $ip === '::1' || $ip === 'localhost') {
        return true;
    }

    $cidrs = array_map('trim', explode(',', $cidrList));
    foreach ($cidrs as $cidr) {
        if (empty($cidr)) continue;
        if (strpos($cidr, '/') === false) {
            $cidr .= '/32';
        }
        list($subnet, $mask) = explode('/', $cidr, 2);
        $mask = (int)$mask;

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) && filter_var($subnet, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $ipLong = ip2long($ip);
            $subnetLong = ip2long($subnet);
            if ($mask === 0) {
                return true;
            }
            $maskLong = -1 << (32 - $mask);
            if (($ipLong & $maskLong) === ($subnetLong & $maskLong)) {
                return true;
            }
        } elseif ($ip === $subnet) {
            return true;
        }
    }
    return false;
}

// Retrieve current Wi-Fi Guard Configuration from database / environment
function get_wifi_guard_config(mysqli $mysqli): array {
    $default = [
        'id' => 1,
        'is_enabled' => 1,
        'is_locked' => 0,
        'authorized_ssid' => getenv('ALLOWED_WIFI_SSID') ?: '',
        'authorized_bssid' => '',
        'authorized_gateway' => getenv('ALLOWED_WIFI_GATEWAY') ?: '',
        'authorized_subnet' => getenv('ALLOWED_WIFI_SUBNET') ?: '',
        'current_ssid' => '',
        'current_bssid' => '',
        'current_gateway' => '',
        'current_host_ip' => '',
        'host_connected' => 1,
        'last_heartbeat' => 0,
        'last_violation_reason' => null
    ];

    $res = $mysqli->query("SELECT * FROM mdl_ek_wifi_lock WHERE id = 1 LIMIT 1");
    if ($res && $row = $res->fetch_assoc()) {
        $row['is_enabled'] = (int)$row['is_enabled'];
        $row['is_locked'] = (int)$row['is_locked'];
        $row['host_connected'] = (int)$row['host_connected'];
        $row['last_heartbeat'] = (int)$row['last_heartbeat'];

        if (!empty(getenv('ALLOWED_WIFI_SSID'))) {
            $row['authorized_ssid'] = getenv('ALLOWED_WIFI_SSID');
            $row['is_locked'] = 1;
        }
        if (!empty(getenv('ALLOWED_WIFI_SUBNET'))) {
            $row['authorized_subnet'] = getenv('ALLOWED_WIFI_SUBNET');
        }
        if (!empty(getenv('ALLOWED_WIFI_GATEWAY'))) {
            $row['authorized_gateway'] = getenv('ALLOWED_WIFI_GATEWAY');
        }
        return $row;
    }
    return $default;
}

// Update Wi-Fi Guard Host Telemetry from watchdog or auto-lock
function record_wifi_host_heartbeat(mysqli $mysqli, array $hostData, bool $triggerAutoLock = false): array {
    $config = get_wifi_guard_config($mysqli);

    $currentSsid = trim($hostData['ssid'] ?? '');
    $currentBssid = trim($hostData['bssid'] ?? '');
    $currentGateway = trim($hostData['gateway'] ?? '');
    $currentIp = trim($hostData['ip'] ?? '');
    $connected = isset($hostData['connected']) ? ((bool)$hostData['connected'] ? 1 : 0) : 1;
    $now = time();

    $isLocked = (int)$config['is_locked'];
    $authSsid = $config['authorized_ssid'];
    $authGateway = $config['authorized_gateway'];
    $authSubnet = $config['authorized_subnet'];

    // Auto-lock to current connected Wi-Fi if requested or if system is unlocked and auto-lock is triggered
    if (($triggerAutoLock || ($isLocked === 0 && !empty($currentSsid))) && $connected === 1) {
        $isLocked = 1;
        if (!empty($currentSsid)) $authSsid = $currentSsid;
        if (!empty($currentGateway)) $authGateway = $currentGateway;
        if (!empty($currentIp) && empty($authSubnet)) {
            $parts = explode('.', $currentIp);
            if (count($parts) === 4) {
                $authSubnet = "{$parts[0]}.{$parts[1]}.{$parts[2]}.0/24";
            }
        }
    }

    $stmt = $mysqli->prepare("
        UPDATE mdl_ek_wifi_lock SET
            current_ssid = ?,
            current_bssid = ?,
            current_gateway = ?,
            current_host_ip = ?,
            host_connected = ?,
            is_locked = ?,
            authorized_ssid = ?,
            authorized_gateway = ?,
            authorized_subnet = ?,
            last_heartbeat = ?,
            timemodified = ?
        WHERE id = 1
    ");
    if ($stmt) {
        $stmt->bind_param('ssssissssii', 
            $currentSsid, 
            $currentBssid, 
            $currentGateway, 
            $currentIp, 
            $connected, 
            $isLocked, 
            $authSsid, 
            $authGateway, 
            $authSubnet, 
            $now, 
            $now
        );
        $stmt->execute();
        $stmt->close();
    }

    return get_wifi_guard_config($mysqli);
}

// Check Wi-Fi Network Integrity for client and server
function check_wifi_network_integrity(mysqli $mysqli, string $clientIp): array {
    $config = get_wifi_guard_config($mysqli);

    $response = [
        'allowed' => true,
        'is_enabled' => (bool)$config['is_enabled'],
        'is_locked' => (bool)$config['is_locked'],
        'client_ip' => $clientIp,
        'authorized_ssid' => $config['authorized_ssid'],
        'authorized_subnet' => $config['authorized_subnet'],
        'authorized_gateway' => $config['authorized_gateway'],
        'current_ssid' => $config['current_ssid'],
        'current_gateway' => $config['current_gateway'],
        'host_connected' => (bool)$config['host_connected'],
        'last_heartbeat' => (int)$config['last_heartbeat'],
        'violation' => null
    ];

    if (!$config['is_enabled']) {
        return $response;
    }

    if (!$config['is_locked']) {
        return $response;
    }

    // 1. Check if server host is connected to Wi-Fi
    if ($config['host_connected'] === 0) {
        $response['allowed'] = false;
        $response['violation'] = 'Server host Wi-Fi network interface is disconnected.';
        return $response;
    }

    // 2. Check if server host Wi-Fi SSID matches authorized SSID
    if (!empty($config['authorized_ssid']) && !empty($config['current_ssid'])) {
        if (strcasecmp($config['current_ssid'], $config['authorized_ssid']) !== 0) {
            $response['allowed'] = false;
            $response['violation'] = "Wi-Fi network mismatch. Connected to unauthorized Wi-Fi '{$config['current_ssid']}', required '{$config['authorized_ssid']}'.";
            return $response;
        }
    }

    // 3. Check if server host default gateway matches authorized gateway
    if (!empty($config['authorized_gateway']) && !empty($config['current_gateway'])) {
        if ($config['current_gateway'] !== $config['authorized_gateway']) {
            $response['allowed'] = false;
            $response['violation'] = "Network gateway mismatch. Detected gateway {$config['current_gateway']}, expected {$config['authorized_gateway']}.";
            return $response;
        }
    }

    // 4. Verify client IP is on the same authorized Wi-Fi subnet
    if (!empty($config['authorized_subnet'])) {
        // Also allow local loopback and internal docker subnets
        $trustedSubnets = $config['authorized_subnet'] . ',127.0.0.1/32,172.16.0.0/12,172.28.10.0/24';
        if (!is_ip_in_subnet($clientIp, $trustedSubnets)) {
            $response['allowed'] = false;
            $response['violation'] = "Client IP ({$clientIp}) is outside the authorized Wi-Fi subnet ({$config['authorized_subnet']}).";
            return $response;
        }
    }

    return $response;
}



