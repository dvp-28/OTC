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
