<?php
// Ekalavya LMS - Database connection + session helper
// Connects to Moodle's MySQL database via MySQLi
session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

function get_db_connection(): mysqli {
    static $conn = null;
    if ($conn !== null) {
        return $conn;
    }

    $host = getenv('DB_HOST') ?: 'db';
    $dbname = getenv('DB_NAME') ?: 'moodle';
    $user = getenv('DB_USER') ?: 'moodle';
    $pass = getenv('DB_PASS') ?: 'Ek@l4vya#Db!Pass2026';

    $conn = @new mysqli($host, $user, $pass, $dbname, 3306);
    if ($conn->connect_error) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Database connection failed']);
        exit;
    }

    $conn->set_charset('utf8mb4');
    return $conn;
}

// Get current logged-in user from session, or null
function get_current_user_session(): ?array {
    return $_SESSION['ek_user'] ?? null;
}

// Require authentication - returns user or sends 401
function require_auth(): array {
    $user = get_current_user_session();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Not authenticated. Please log in.']);
        exit;
    }
    return $user;
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
