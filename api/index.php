<?php
// Ekalavya LMS - Full REST API with Authentication and Role-Based Access
// Connected to Moodle MySQL 8.4 Schema via MySQLi
require_once __DIR__ . '/db.php';

$mysqli = get_db_connection();

// Helper functions for Moodle schema operations
function get_or_create_course_context(mysqli $mysqli, int $courseId): int {
    $stmt = $mysqli->prepare("SELECT id FROM mdl_context WHERE contextlevel = 50 AND instanceid = ? LIMIT 1");
    $stmt->bind_param('i', $courseId);
    $stmt->execute();
    $res = $stmt->get_result();
    if ($row = $res->fetch_assoc()) {
        $stmt->close();
        return (int)$row['id'];
    }
    $stmt->close();

    $stmt = $mysqli->prepare("INSERT INTO mdl_context (contextlevel, instanceid, path, depth) VALUES (50, ?, '', 2)");
    $stmt->bind_param('i', $courseId);
    $stmt->execute();
    $ctxId = (int)$stmt->insert_id;
    $stmt->close();

    $path = "/1/40/{$ctxId}";
    $mysqli->query("UPDATE mdl_context SET path = '{$path}' WHERE id = {$ctxId}");

    return $ctxId;
}

function get_or_create_manual_enrol(mysqli $mysqli, int $courseId): int {
    $stmt = $mysqli->prepare("SELECT id FROM mdl_enrol WHERE courseid = ? AND enrol = 'manual' LIMIT 1");
    $stmt->bind_param('i', $courseId);
    $stmt->execute();
    $res = $stmt->get_result();
    if ($row = $res->fetch_assoc()) {
        $stmt->close();
        return (int)$row['id'];
    }
    $stmt->close();

    $stmt = $mysqli->prepare("INSERT INTO mdl_enrol (enrol, status, courseid, sortorder, timecreated, timemodified) VALUES ('manual', 0, ?, 0, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())");
    $stmt->bind_param('i', $courseId);
    $stmt->execute();
    $enrolId = (int)$stmt->insert_id;
    $stmt->close();

    return $enrolId;
}

function assign_user_course_enrolment(mysqli $mysqli, int $userId, int $courseId, string $roleShortname = 'student'): void {
    if ($courseId < 2 || $userId < 2) return;

    $enrolId = get_or_create_manual_enrol($mysqli, $courseId);

    // Check if user enrolment exists
    $check = $mysqli->prepare("SELECT id FROM mdl_user_enrolments WHERE enrolid = ? AND userid = ? LIMIT 1");
    $check->bind_param('ii', $enrolId, $userId);
    $check->execute();
    $res = $check->get_result();
    if (!$res->fetch_assoc()) {
        $ins = $mysqli->prepare("INSERT INTO mdl_user_enrolments (status, enrolid, userid, timestart, timeend, timecreated, timemodified, modifierid) VALUES (0, ?, ?, UNIX_TIMESTAMP(), 0, UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), 2)");
        $ins->bind_param('ii', $enrolId, $userId);
        $ins->execute();
        $ins->close();
    }
    $check->close();

    // Assign role in course context
    $ctxId = get_or_create_course_context($mysqli, $courseId);
    $roleStmt = $mysqli->prepare("SELECT id FROM mdl_role WHERE shortname = ? LIMIT 1");
    $roleStmt->bind_param('s', $roleShortname);
    $roleStmt->execute();
    $roleRes = $roleStmt->get_result();
    $roleRow = $roleRes->fetch_assoc();
    $roleStmt->close();

    if ($roleRow) {
        $roleId = (int)$roleRow['id'];
        $raCheck = $mysqli->prepare("SELECT id FROM mdl_role_assignments WHERE roleid = ? AND contextid = ? AND userid = ? LIMIT 1");
        $raCheck->bind_param('iii', $roleId, $ctxId, $userId);
        $raCheck->execute();
        if (!$raCheck->get_result()->fetch_assoc()) {
            $raIns = $mysqli->prepare("INSERT INTO mdl_role_assignments (roleid, contextid, userid, timemodified, modifierid) VALUES (?, ?, ?, UNIX_TIMESTAMP(), 2)");
            $raIns->bind_param('iii', $roleId, $ctxId, $userId);
            $raIns->execute();
            $raIns->close();
        }
        $raCheck->close();
    }
}

// Determine request action from URL
$action = $_GET['action'] ?? '';
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$urlUserId = null;

// Handle parameterized endpoints like /api/users/123/courses/assign
if (preg_match('#^/api/users/(\d+)/courses/assign$#', $path, $pm)) {
    $action = 'users-courses-assign';
    $urlUserId = (int)$pm[1];
} elseif (preg_match('#^/api/users/(\d+)/courses/remove$#', $path, $pm)) {
    $action = 'users-courses-remove';
    $urlUserId = (int)$pm[1];
} elseif (preg_match('#^/api/users/(\d+)/courses$#', $path, $pm)) {
    $action = 'users-courses';
    $urlUserId = (int)$pm[1];
} elseif (empty($action)) {
    if (preg_match('#/api/([a-zA-Z0-9_/-]+)#', $path, $matches)) {
        $action = trim($matches[1], '/');
        $action = str_replace('/', '-', $action);
    } else {
        $action = 'status';
    }
}

// Read JSON body for POST requests
$body = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true) ?: [];
}
if ($urlUserId !== null && !isset($body['user_id'])) {
    $body['user_id'] = $urlUserId;
}

try {
    switch ($action) {

        // =====================================================================
        // AUTH: Login - verify against Moodle's mdl_user table
        // =====================================================================
        case 'login':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }

            $username = trim($body['username'] ?? '');
            $password = $body['password'] ?? '';

            if (empty($username) || empty($password)) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Username and password are required']);
                break;
            }

            // Fetch user from Moodle DB
            $stmt = $mysqli->prepare("SELECT id, username, password, firstname, lastname, email, auth FROM mdl_user WHERE username = ? AND deleted = 0 AND suspended = 0 AND confirmed = 1 LIMIT 1");
            $stmt->bind_param('s', $username);
            $stmt->execute();
            $result = $stmt->get_result();
            $user = $result->fetch_assoc();
            $stmt->close();

            if (!$user) {
                http_response_code(401);
                echo json_encode(['status' => 'error', 'message' => 'Invalid username or password']);
                break;
            }

            // Verify password against Moodle's hash (SHA-512 crypt format or bcrypt)
            $storedHash = $user['password'];
            $valid = false;
            if (substr($storedHash, 0, 3) === '$6$') {
                $valid = (crypt($password, $storedHash) === $storedHash);
            } elseif (substr($storedHash, 0, 4) === '$2y$') {
                $valid = password_verify($password, $storedHash);
            } else {
                $valid = password_verify($password, $storedHash);
            }

            if (!$valid) {
                http_response_code(401);
                echo json_encode(['status' => 'error', 'message' => 'Invalid username or password']);
                break;
            }

            // Determine role by checking Moodle role assignments
            $role = 'student'; // default
            $roleLabel = 'Student Officer';
            $assignedCourses = [];

            // Check for instituteadmin role or siteadmin
            if ($user['username'] === 'siteadmin' || (int)$user['id'] === 2) {
                $role = 'instituteadmin';
                $roleLabel = 'Site Administrator';
            } else {
                $roleCheck = $mysqli->prepare("
                    SELECT r.shortname 
                    FROM mdl_role_assignments ra
                    JOIN mdl_role r ON r.id = ra.roleid
                    WHERE ra.userid = ? AND r.shortname = 'instituteadmin'
                    LIMIT 1
                ");
                $roleCheck->bind_param('i', $user['id']);
                $roleCheck->execute();
                $roleResult = $roleCheck->get_result();
                if ($roleResult->fetch_assoc()) {
                    $role = 'instituteadmin';
                    $roleLabel = 'Institute Admin';
                }
                $roleCheck->close();
            }

            // Check for courseadmin role
            if ($role === 'student') {
                $roleCheck2 = $mysqli->prepare("
                    SELECT r.shortname, ctx.instanceid as courseid
                    FROM mdl_role_assignments ra
                    JOIN mdl_role r ON r.id = ra.roleid
                    JOIN mdl_context ctx ON ctx.id = ra.contextid
                    WHERE ra.userid = ? AND r.shortname = 'courseadmin'
                ");
                $roleCheck2->bind_param('i', $user['id']);
                $roleCheck2->execute();
                $roleResult2 = $roleCheck2->get_result();
                while ($row = $roleResult2->fetch_assoc()) {
                    $role = 'courseadmin';
                    $roleLabel = 'Course Admin';
                    $assignedCourses[] = (int)$row['courseid'];
                }
                $roleCheck2->close();
            }

            // Get cohort memberships
            $cohorts = [];
            $cohortQ = $mysqli->prepare("
                SELECT c.idnumber, c.name
                FROM mdl_cohort_members cm
                JOIN mdl_cohort c ON c.id = cm.cohortid
                WHERE cm.userid = ?
            ");
            $cohortQ->bind_param('i', $user['id']);
            $cohortQ->execute();
            $cohortRes = $cohortQ->get_result();
            while ($row = $cohortRes->fetch_assoc()) {
                $cohorts[] = $row;
            }
            $cohortQ->close();

            // Get enrolled courses
            $enrolledCourses = [];
            $enrolQ = $mysqli->prepare("
                SELECT c.id, c.shortname, c.fullname
                FROM mdl_user_enrolments ue
                JOIN mdl_enrol e ON e.id = ue.enrolid
                JOIN mdl_course c ON c.id = e.courseid
                WHERE ue.userid = ? AND c.id > 1 AND ue.status = 0
            ");
            $enrolQ->bind_param('i', $user['id']);
            $enrolQ->execute();
            $enrolRes = $enrolQ->get_result();
            while ($row = $enrolRes->fetch_assoc()) {
                $enrolledCourses[] = $row;
            }
            $enrolQ->close();

            // For instituteadmin, they can access all courses
            if ($role === 'instituteadmin') {
                $allCourses = $mysqli->query("SELECT id, shortname, fullname FROM mdl_course WHERE id > 1 ORDER BY id");
                $enrolledCourses = [];
                while ($row = $allCourses->fetch_assoc()) {
                    $enrolledCourses[] = $row;
                }
            }

            // Store session
            $sessionUser = [
                'id' => (int)$user['id'],
                'username' => $user['username'],
                'firstname' => $user['firstname'],
                'lastname' => $user['lastname'],
                'email' => $user['email'],
                'role' => $role,
                'role_label' => $roleLabel,
                'assigned_courses' => $assignedCourses,
                'enrolled_courses' => $enrolledCourses,
                'cohorts' => $cohorts,
                'can_edit' => in_array($role, ['instituteadmin', 'courseadmin']),
                'can_manage_users' => ($role === 'instituteadmin'),
                'can_add_course' => ($role === 'instituteadmin'),
                'can_delete_course' => ($role === 'instituteadmin'),
            ];
            $_SESSION['ek_user'] = $sessionUser;

            echo json_encode([
                'status' => 'success',
                'message' => 'Login successful',
                'data' => $sessionUser
            ]);
            break;

        // =====================================================================
        // AUTH: Logout
        // =====================================================================
        case 'logout':
            $_SESSION = [];
            session_destroy();
            echo json_encode(['status' => 'success', 'message' => 'Logged out']);
            break;

        // =====================================================================
        // AUTH: Get current session
        // =====================================================================
        case 'session':
            $user = get_current_user_session();
            if ($user) {
                echo json_encode(['status' => 'success', 'data' => $user]);
            } else {
                echo json_encode(['status' => 'success', 'data' => null, 'authenticated' => false]);
            }
            break;

        // =====================================================================
        // STATUS: Public system info
        // =====================================================================
        case 'status':
            $courseCount = (int)$mysqli->query("SELECT COUNT(*) FROM mdl_course WHERE id > 1")->fetch_row()[0];
            $categoryCount = (int)$mysqli->query("SELECT COUNT(*) FROM mdl_course_categories WHERE idnumber != ''")->fetch_row()[0];
            $cohortCount = (int)$mysqli->query("SELECT COUNT(*) FROM mdl_cohort")->fetch_row()[0];
            $userCount = (int)$mysqli->query("SELECT COUNT(*) FROM mdl_user WHERE deleted = 0 AND id > 1")->fetch_row()[0];

            echo json_encode([
                'status' => 'success',
                'data' => [
                    'system' => 'Ekalavya LMS',
                    'institution' => 'Officers Training College, AMC Centre and College, Lucknow',
                    'stats' => [
                        'courses' => $courseCount,
                        'categories' => $categoryCount,
                        'cohorts' => $cohortCount,
                        'users' => $userCount
                    ],
                    'server_time' => date('Y-m-d H:i:s T')
                ]
            ]);
            break;

        // =====================================================================
        // COURSES: List all (auth required)
        // =====================================================================
        case 'courses':
            $currentUser = require_auth();
            $sql = "
                SELECT c.id, c.fullname, c.shortname, c.idnumber, c.summary, c.category, c.visible,
                       cat.name AS category_name, cat.idnumber AS category_code
                FROM mdl_course c
                LEFT JOIN mdl_course_categories cat ON c.category = cat.id
                WHERE c.id > 1
                ORDER BY c.category ASC, c.id ASC
            ";
            $result = $mysqli->query($sql);
            $courses = [];
            while ($row = $result->fetch_assoc()) {
                $row['can_edit'] = false;
                $row['can_delete'] = false;
                if ($currentUser['role'] === 'instituteadmin') {
                    $row['can_edit'] = true;
                    $row['can_delete'] = true;
                } elseif ($currentUser['role'] === 'courseadmin') {
                    $row['can_edit'] = in_array((int)$row['id'], $currentUser['assigned_courses']);
                }
                $courses[] = $row;
            }

            echo json_encode(['status' => 'success', 'data' => $courses]);
            break;

        // =====================================================================
        // COURSES: Create a new course (Institute Admin ONLY)
        // =====================================================================
        case 'courses-create':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            require_role(['instituteadmin']);

            $fullname = trim($body['fullname'] ?? '');
            $shortname = trim($body['shortname'] ?? '');
            $summary = trim($body['summary'] ?? '');
            $categoryId = (int)($body['category_id'] ?? 0);
            $visible = isset($body['visible']) ? (int)$body['visible'] : 1;

            if (empty($fullname) || empty($shortname)) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Course Full Name and Short Name are required']);
                break;
            }

            // Check duplicate shortname
            $dupCheck = $mysqli->prepare("SELECT id FROM mdl_course WHERE shortname = ? LIMIT 1");
            $dupCheck->bind_param('s', $shortname);
            $dupCheck->execute();
            if ($dupCheck->get_result()->fetch_assoc()) {
                $dupCheck->close();
                http_response_code(409);
                echo json_encode(['status' => 'error', 'message' => "Course with short name '{$shortname}' already exists"]);
                break;
            }
            $dupCheck->close();

            // Validate category_id or pick default category
            if ($categoryId < 1) {
                $catRes = $mysqli->query("SELECT id FROM mdl_course_categories ORDER BY id ASC LIMIT 1");
                if ($cRow = $catRes->fetch_assoc()) {
                    $categoryId = (int)$cRow['id'];
                } else {
                    $categoryId = 1;
                }
            }

            $stmt = $mysqli->prepare("
                INSERT INTO mdl_course 
                (category, fullname, shortname, idnumber, summary, summaryformat, format, visible, timecreated, timemodified) 
                VALUES (?, ?, ?, ?, ?, 1, 'topics', ?, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
            ");
            $stmt->bind_param('issssi', $categoryId, $fullname, $shortname, $shortname, $summary, $visible);
            $stmt->execute();
            $courseId = (int)$stmt->insert_id;
            $stmt->close();

            // Setup context and manual enrolment record
            get_or_create_course_context($mysqli, $courseId);
            get_or_create_manual_enrol($mysqli, $courseId);

            // Create topic 0 section
            $secStmt = $mysqli->prepare("INSERT INTO mdl_course_sections (course, section, name, summary, summaryformat, visible, timemodified) VALUES (?, 0, 'General', '', 1, 1, UNIX_TIMESTAMP())");
            $secStmt->bind_param('i', $courseId);
            $secStmt->execute();
            $secStmt->close();

            echo json_encode([
                'status' => 'success',
                'message' => "Course '{$fullname}' created successfully",
                'data' => ['id' => $courseId, 'fullname' => $fullname, 'shortname' => $shortname]
            ]);
            break;

        // =====================================================================
        // COURSES: Delete a course (Institute Admin ONLY - Transactional)
        // =====================================================================
        case 'courses-delete':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            require_role(['instituteadmin']);

            $courseId = (int)($body['course_id'] ?? 0);
            if ($courseId < 2) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid course_id is required']);
                break;
            }

            // Verify course exists
            $cCheck = $mysqli->prepare("SELECT id, fullname, shortname FROM mdl_course WHERE id = ? LIMIT 1");
            $cCheck->bind_param('i', $courseId);
            $cCheck->execute();
            $cRes = $cCheck->get_result();
            $course = $cRes->fetch_assoc();
            $cCheck->close();

            if (!$course) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'Course not found']);
                break;
            }

            $mysqli->begin_transaction();
            try {
                // Delete context & role assignments for this course
                $ctxRes = $mysqli->query("SELECT id FROM mdl_context WHERE contextlevel = 50 AND instanceid = {$courseId}");
                if ($ctxRow = $ctxRes->fetch_assoc()) {
                    $ctxId = (int)$ctxRow['id'];
                    $mysqli->query("DELETE FROM mdl_role_assignments WHERE contextid = {$ctxId}");
                    $mysqli->query("DELETE FROM mdl_context WHERE id = {$ctxId}");
                }

                // Delete enrolments for this course
                $enrolRes = $mysqli->query("SELECT id FROM mdl_enrol WHERE courseid = {$courseId}");
                $enrolIds = [];
                while ($eRow = $enrolRes->fetch_assoc()) $enrolIds[] = (int)$eRow['id'];
                if (!empty($enrolIds)) {
                    $idsStr = implode(',', $enrolIds);
                    $mysqli->query("DELETE FROM mdl_user_enrolments WHERE enrolid IN ({$idsStr})");
                    $mysqli->query("DELETE FROM mdl_enrol WHERE courseid = {$courseId}");
                }

                // Delete sections & modules
                $mysqli->query("DELETE FROM mdl_course_sections WHERE course = {$courseId}");
                $mysqli->query("DELETE FROM mdl_course WHERE id = {$courseId}");

                $mysqli->commit();

                echo json_encode([
                    'status' => 'success',
                    'message' => "Course '{$course['fullname']}' deleted successfully"
                ]);
            } catch (Exception $ex) {
                $mysqli->rollback();
                http_response_code(500);
                echo json_encode(['status' => 'error', 'message' => 'Failed to delete course: ' . $ex->getMessage()]);
            }
            break;

        // =====================================================================
        // CATEGORIES: List
        // =====================================================================
        case 'categories':
            require_auth();
            $result = $mysqli->query("SELECT id, name, idnumber, parent FROM mdl_course_categories ORDER BY id ASC");
            $categories = [];
            while ($row = $result->fetch_assoc()) $categories[] = $row;
            echo json_encode(['status' => 'success', 'data' => $categories]);
            break;

        // =====================================================================
        // COHORTS: List (Institute Admin only)
        // =====================================================================
        case 'cohorts':
            require_role(['instituteadmin']);
            $result = $mysqli->query("SELECT id, name, idnumber, description FROM mdl_cohort ORDER BY id ASC");
            $cohorts = [];
            while ($row = $result->fetch_assoc()) $cohorts[] = $row;
            echo json_encode(['status' => 'success', 'data' => $cohorts]);
            break;

        // =====================================================================
        // USERS: List all users (Institute Admin only)
        // =====================================================================
        case 'users':
            require_role(['instituteadmin']);
            $result = $mysqli->query("
                SELECT u.id, u.username, u.firstname, u.lastname, u.email, u.phone1 AS mobile, u.suspended, u.lastaccess
                FROM mdl_user u
                WHERE u.deleted = 0 AND u.id > 1
                ORDER BY u.id ASC
            ");
            $users = [];
            while ($row = $result->fetch_assoc()) {
                $userId = (int)$row['id'];

                // Determine user role
                $userRole = 'student';
                $userRoleLabel = 'Student Officer';

                $rCheck1 = $mysqli->query("
                    SELECT r.shortname 
                    FROM mdl_role_assignments ra 
                    JOIN mdl_role r ON r.id = ra.roleid 
                    WHERE ra.userid = {$userId} AND r.shortname = 'instituteadmin' 
                    LIMIT 1
                ");
                if ($rCheck1 && $rCheck1->fetch_assoc()) {
                    $userRole = 'instituteadmin';
                    $userRoleLabel = 'Institute Admin';
                } else {
                    $rCheck2 = $mysqli->query("
                        SELECT r.shortname 
                        FROM mdl_role_assignments ra 
                        JOIN mdl_role r ON r.id = ra.roleid 
                        WHERE ra.userid = {$userId} AND r.shortname = 'courseadmin' 
                        LIMIT 1
                    ");
                    if ($rCheck2 && $rCheck2->fetch_assoc()) {
                        $userRole = 'courseadmin';
                        $userRoleLabel = 'Course Admin';
                    }
                }

                // Get enrolled/assigned courses
                $cRes = $mysqli->query("
                    SELECT DISTINCT c.id, c.fullname, c.shortname
                    FROM mdl_user_enrolments ue
                    JOIN mdl_enrol e ON e.id = ue.enrolid
                    JOIN mdl_course c ON c.id = e.courseid
                    WHERE ue.userid = {$userId} AND c.id > 1 AND ue.status = 0
                ");
                $userCourses = [];
                $courseIds = [];
                while ($cRow = $cRes->fetch_assoc()) {
                    $userCourses[] = $cRow;
                    $courseIds[] = (int)$cRow['id'];
                }

                $row['role'] = $userRole;
                $row['role_label'] = $userRoleLabel;
                $row['courses'] = $userCourses;
                $row['course_ids'] = $courseIds;
                $users[] = $row;
            }
            echo json_encode(['status' => 'success', 'data' => $users]);
            break;

        // =====================================================================
        // USERS: Create a new user (Institute Admin ONLY)
        // =====================================================================
        case 'users-create':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            require_role(['instituteadmin']);

            $username = trim($body['username'] ?? '');
            $firstname = trim($body['firstname'] ?? '');
            $lastname = trim($body['lastname'] ?? '');
            $email = trim($body['email'] ?? '');
            $mobile = trim($body['mobile'] ?? '');
            $password = $body['password'] ?? '';
            $suspended = isset($body['suspended']) ? (int)$body['suspended'] : 0;
            $role = trim($body['role'] ?? 'student');
            $courseIds = is_array($body['course_ids'] ?? null) ? $body['course_ids'] : [];

            if (empty($username) || empty($firstname) || empty($password)) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Service ID/Username, First Name, and Password are required']);
                break;
            }

            if (!in_array($role, ['instituteadmin', 'courseadmin', 'student'])) {
                $role = 'student';
            }

            // Check duplicate username
            $dup = $mysqli->prepare("SELECT id FROM mdl_user WHERE username = ? AND deleted = 0 LIMIT 1");
            $dup->bind_param('s', $username);
            $dup->execute();
            if ($dup->get_result()->fetch_assoc()) {
                $dup->close();
                http_response_code(409);
                echo json_encode(['status' => 'error', 'message' => "User with Service ID/Username '{$username}' already exists"]);
                break;
            }
            $dup->close();

            $pwdHash = password_hash($password, PASSWORD_BCRYPT);
            if (empty($email)) $email = "{$username}@otc.amc.local";

            $stmt = $mysqli->prepare("
                INSERT INTO mdl_user 
                (username, password, firstname, lastname, email, phone1, suspended, auth, confirmed, timecreated, timemodified) 
                VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
            ");
            $stmt->bind_param('ssssssi', $username, $pwdHash, $firstname, $lastname, $email, $mobile, $suspended);
            $stmt->execute();
            $newUserId = (int)$stmt->insert_id;
            $stmt->close();

            // Assign role
            if ($role === 'instituteadmin') {
                $rStmt = $mysqli->prepare("SELECT id FROM mdl_role WHERE shortname = 'instituteadmin' LIMIT 1");
                $rStmt->execute();
                $rRes = $rStmt->get_result();
                if ($rRow = $rRes->fetch_assoc()) {
                    $rId = (int)$rRow['id'];
                    $mysqli->query("INSERT INTO mdl_role_assignments (roleid, contextid, userid, timemodified, modifierid) VALUES ({$rId}, 1, {$newUserId}, UNIX_TIMESTAMP(), 2)");
                }
                $rStmt->close();
            }

            // Assign courses
            foreach ($courseIds as $cId) {
                assign_user_course_enrolment($mysqli, $newUserId, (int)$cId, $role);
            }

            echo json_encode([
                'status' => 'success',
                'message' => "User '{$username}' created successfully",
                'data' => ['id' => $newUserId, 'username' => $username]
            ]);
            break;

        // =====================================================================
        // USERS: Update user details & role (Institute Admin ONLY)
        // =====================================================================
        case 'users-update':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            require_role(['instituteadmin']);

            $userId = (int)($body['user_id'] ?? 0);
            $firstname = trim($body['firstname'] ?? '');
            $lastname = trim($body['lastname'] ?? '');
            $email = trim($body['email'] ?? '');
            $mobile = trim($body['mobile'] ?? '');
            $suspended = isset($body['suspended']) ? (int)$body['suspended'] : 0;
            $role = trim($body['role'] ?? '');
            $password = $body['password'] ?? '';
            $courseIds = isset($body['course_ids']) && is_array($body['course_ids']) ? $body['course_ids'] : null;

            if ($userId < 2 || empty($firstname)) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid user_id and First Name are required']);
                break;
            }

            if (!empty($password)) {
                $pwdHash = password_hash($password, PASSWORD_BCRYPT);
                $stmt = $mysqli->prepare("UPDATE mdl_user SET firstname = ?, lastname = ?, email = ?, phone1 = ?, password = ?, suspended = ?, timemodified = UNIX_TIMESTAMP() WHERE id = ?");
                $stmt->bind_param('sssssii', $firstname, $lastname, $email, $mobile, $pwdHash, $suspended, $userId);
            } else {
                $stmt = $mysqli->prepare("UPDATE mdl_user SET firstname = ?, lastname = ?, email = ?, phone1 = ?, suspended = ?, timemodified = UNIX_TIMESTAMP() WHERE id = ?");
                $stmt->bind_param('ssssii', $firstname, $lastname, $email, $mobile, $suspended, $userId);
            }
            $stmt->execute();
            $stmt->close();

            // Update role assignment if role specified
            if (!empty($role) && in_array($role, ['instituteadmin', 'courseadmin', 'student'])) {
                // Delete existing system/category level role assignments for this user
                $mysqli->query("DELETE FROM mdl_role_assignments WHERE userid = {$userId}");

                if ($role === 'instituteadmin') {
                    $rStmt = $mysqli->query("SELECT id FROM mdl_role WHERE shortname = 'instituteadmin' LIMIT 1");
                    if ($rRow = $rStmt->fetch_assoc()) {
                        $rId = (int)$rRow['id'];
                        $mysqli->query("INSERT INTO mdl_role_assignments (roleid, contextid, userid, timemodified, modifierid) VALUES ({$rId}, 1, {$userId}, UNIX_TIMESTAMP(), 2)");
                    }
                }
            }

            // Update course assignments if courseIds array provided
            if ($courseIds !== null) {
                // Delete existing enrolments
                $mysqli->query("DELETE FROM mdl_user_enrolments WHERE userid = {$userId}");
                foreach ($courseIds as $cId) {
                    assign_user_course_enrolment($mysqli, $userId, (int)$cId, $role ?: 'student');
                }
            }

            echo json_encode(['status' => 'success', 'message' => 'User updated successfully']);
            break;

        // =====================================================================
        // USERS: Update role specifically (Institute Admin ONLY)
        // =====================================================================
        case 'users-update-role':
        case 'users-role':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            require_role(['instituteadmin']);

            $userId = (int)($body['user_id'] ?? 0);
            $role = trim($body['role'] ?? '');

            if ($userId < 2 || !in_array($role, ['instituteadmin', 'courseadmin', 'student'])) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid user_id and role (instituteadmin|courseadmin|student) required']);
                break;
            }

            // Remove existing system/category role assignments
            $mysqli->query("DELETE FROM mdl_role_assignments WHERE userid = {$userId}");

            if ($role === 'instituteadmin') {
                $rStmt = $mysqli->query("SELECT id FROM mdl_role WHERE shortname = 'instituteadmin' LIMIT 1");
                if ($rRow = $rStmt->fetch_assoc()) {
                    $rId = (int)$rRow['id'];
                    $mysqli->query("INSERT INTO mdl_role_assignments (roleid, contextid, userid, timemodified, modifierid) VALUES ({$rId}, 1, {$userId}, UNIX_TIMESTAMP(), 2)");
                }
            } elseif ($role === 'courseadmin') {
                $rStmt = $mysqli->query("SELECT id FROM mdl_role WHERE shortname = 'courseadmin' LIMIT 1");
                if ($rRow = $rStmt->fetch_assoc()) {
                    $rId = (int)$rRow['id'];
                    $mysqli->query("INSERT INTO mdl_role_assignments (roleid, contextid, userid, timemodified, modifierid) VALUES ({$rId}, 1, {$userId}, UNIX_TIMESTAMP(), 2)");
                }
            }

            echo json_encode(['status' => 'success', 'message' => "Role updated to {$role}"]);
            break;

        // =====================================================================
        // USERS: Get assigned courses for a specific user (Institute Admin ONLY)
        // =====================================================================
        case 'users-courses':
            require_role(['instituteadmin']);
            $targetUserId = (int)($urlUserId ?: ($_GET['user_id'] ?? 0));
            if ($targetUserId < 2) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid user_id required']);
                break;
            }

            $cRes = $mysqli->query("
                SELECT DISTINCT c.id, c.fullname, c.shortname
                FROM mdl_user_enrolments ue
                JOIN mdl_enrol e ON e.id = ue.enrolid
                JOIN mdl_course c ON c.id = e.courseid
                WHERE ue.userid = {$targetUserId} AND c.id > 1 AND ue.status = 0
            ");
            $uCourses = [];
            while ($cRow = $cRes->fetch_assoc()) $uCourses[] = $cRow;

            echo json_encode(['status' => 'success', 'data' => $uCourses]);
            break;

        // =====================================================================
        // USERS: Assign courses to a user (Institute Admin ONLY)
        // =====================================================================
        case 'users-courses-assign':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            require_role(['instituteadmin']);

            $userId = (int)($body['user_id'] ?? 0);
            $courseIds = [];
            if (isset($body['course_id'])) {
                $courseIds[] = (int)$body['course_id'];
            } elseif (is_array($body['course_ids'] ?? null)) {
                $courseIds = array_map('intval', $body['course_ids']);
            }

            if ($userId < 2 || empty($courseIds)) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid user_id and course_id required']);
                break;
            }

            foreach ($courseIds as $cId) {
                assign_user_course_enrolment($mysqli, $userId, (int)$cId, 'student');
            }

            echo json_encode(['status' => 'success', 'message' => 'Courses assigned successfully']);
            break;

        // =====================================================================
        // USERS: Remove course enrolment from a user (Institute Admin ONLY)
        // =====================================================================
        case 'users-courses-remove':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            require_role(['instituteadmin']);

            $userId = (int)($body['user_id'] ?? 0);
            $courseId = (int)($body['course_id'] ?? 0);

            if ($userId < 2 || $courseId < 2) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'user_id and course_id required']);
                break;
            }

            $enrolRes = $mysqli->query("SELECT id FROM mdl_enrol WHERE courseid = {$courseId}");
            while ($eRow = $enrolRes->fetch_assoc()) {
                $eId = (int)$eRow['id'];
                $mysqli->query("DELETE FROM mdl_user_enrolments WHERE enrolid = {$eId} AND userid = {$userId}");
            }

            echo json_encode(['status' => 'success', 'message' => 'Course assignment removed']);
            break;

        // =====================================================================
        // COURSE UPDATE: Edit course details (Institute Admin or assigned Course Admin)
        // =====================================================================
        case 'course-update':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            $currentUser = require_role(['instituteadmin', 'courseadmin']);

            $courseId = (int)($body['course_id'] ?? 0);
            $fullname = trim($body['fullname'] ?? '');
            $summary = trim($body['summary'] ?? '');

            if ($courseId < 2 || empty($fullname)) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'course_id and fullname are required']);
                break;
            }

            // Course admins can only edit their assigned courses
            if ($currentUser['role'] === 'courseadmin' && !in_array($courseId, $currentUser['assigned_courses'])) {
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'You can only edit courses assigned to you']);
                break;
            }

            $stmt = $mysqli->prepare("UPDATE mdl_course SET fullname = ?, summary = ?, timemodified = UNIX_TIMESTAMP() WHERE id = ?");
            $stmt->bind_param('ssi', $fullname, $summary, $courseId);
            $stmt->execute();
            $stmt->close();

            echo json_encode(['status' => 'success', 'message' => 'Course updated successfully']);
            break;

        // =====================================================================
        // SECTION ADD: Add a new section/topic to a course
        // =====================================================================
        case 'section-add':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            $currentUser = require_role(['instituteadmin', 'courseadmin']);

            $courseId = (int)($body['course_id'] ?? 0);
            $sectionName = trim($body['name'] ?? '');
            $sectionSummary = trim($body['summary'] ?? '');

            if ($courseId < 2 || empty($sectionName)) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'course_id and name are required']);
                break;
            }

            if ($currentUser['role'] === 'courseadmin' && !in_array($courseId, $currentUser['assigned_courses'])) {
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'You can only add sections to your assigned courses']);
                break;
            }

            // Get next section number
            $maxSection = (int)$mysqli->query("SELECT COALESCE(MAX(section), 0) FROM mdl_course_sections WHERE course = {$courseId}")->fetch_row()[0];
            $newSection = $maxSection + 1;

            $stmt = $mysqli->prepare("INSERT INTO mdl_course_sections (course, section, name, summary, summaryformat, visible, timemodified) VALUES (?, ?, ?, ?, 1, 1, UNIX_TIMESTAMP())");
            $stmt->bind_param('iiss', $courseId, $newSection, $sectionName, $sectionSummary);
            $stmt->execute();
            $sectionId = $stmt->insert_id;
            $stmt->close();

            echo json_encode([
                'status' => 'success',
                'message' => "Section '{$sectionName}' added as topic {$newSection}",
                'data' => ['id' => $sectionId, 'section' => $newSection]
            ]);
            break;

        // =====================================================================
        // SECTIONS: List sections for a course
        // =====================================================================
        case 'sections':
            require_auth();
            $courseId = (int)($_GET['course_id'] ?? 0);
            if ($courseId < 2) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'course_id parameter required']);
                break;
            }

            $stmt = $mysqli->prepare("SELECT id, section, name, summary, visible FROM mdl_course_sections WHERE course = ? ORDER BY section ASC");
            $stmt->bind_param('i', $courseId);
            $stmt->execute();
            $result = $stmt->get_result();
            $sections = [];
            while ($row = $result->fetch_assoc()) $sections[] = $row;
            $stmt->close();

            echo json_encode(['status' => 'success', 'data' => $sections]);
            break;

        // =====================================================================
        // ROLES: List configured roles
        // =====================================================================
        case 'roles':
            require_auth();
            $result = $mysqli->query("
                SELECT r.id, r.name, r.shortname, r.archetype, r.description 
                FROM mdl_role r 
                WHERE r.shortname IN ('instituteadmin', 'courseadmin', 'student')
                ORDER BY r.id ASC
            ");
            $roles = [];
            while ($row = $result->fetch_assoc()) $roles[] = $row;
            echo json_encode(['status' => 'success', 'data' => $roles]);
            break;

        default:
            http_response_code(404);
            echo json_encode(['status' => 'error', 'message' => 'Endpoint not found: ' . $action]);
            break;
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
