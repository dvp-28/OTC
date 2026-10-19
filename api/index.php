<?php
// Dronacharya LMS - Full REST API with Authentication and Role-Based Access
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

function format_bytes(int $bytes): string {
    if ($bytes >= 1073741824) {
        return number_format($bytes / 1073741824, 2) . ' GB';
    } elseif ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 1) . ' MB';
    } elseif ($bytes >= 1024) {
        return number_format($bytes / 1024, 0) . ' KB';
    } elseif ($bytes > 0) {
        return $bytes . ' B';
    }
    return '0 B';
}

function extract_presentation_slide_count(string $filePath, string $ext): int {
    if (!file_exists($filePath)) {
        return 1;
    }

    $ext = strtolower($ext);
    if ($ext === 'pptx' && class_exists('ZipArchive')) {
        $zip = new ZipArchive();
        if ($zip->open($filePath) === true) {
            // Check docProps/app.xml for authoritative <Slides>N</Slides>
            $appXml = $zip->getFromName('docProps/app.xml');
            if ($appXml !== false && preg_match('/<Slides>(\d+)<\/Slides>/i', $appXml, $matches)) {
                $count = (int)$matches[1];
                $zip->close();
                if ($count > 0) return $count;
            }

            // Fallback: count individual slide XML files ppt/slides/slide*.xml
            $count = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry = $zip->getNameIndex($i);
                if ($entry && preg_match('#^ppt/slides/slide\d+\.xml$#i', $entry)) {
                    $count++;
                }
            }
            $zip->close();
            if ($count > 0) return $count;
        }
    } elseif ($ext === 'ppt') {
        // Binary PowerPoint: slide persist atoms (0x03EE)
        $content = @file_get_contents($filePath, false, null, 0, 524288);
        if ($content !== false) {
            $cnt = substr_count($content, "\x00\x00\xEE\x03");
            if ($cnt > 0) return $cnt;
        }
    }

    // Default to at least 1 slide
    return 1;
}

function detect_media_type(string $ext): ?array {
    $ext = strtolower($ext);
    $videoExts = [
        'mp4' => 'video/mp4',
        'webm' => 'video/webm',
        'ogg' => 'video/ogg',
        'ogv' => 'video/ogg',
        'mov' => 'video/quicktime',
        'mkv' => 'video/x-matroska'
    ];
    $audioExts = [
        'mp3' => 'audio/mpeg',
        'wav' => 'audio/wav',
        'm4a' => 'audio/mp4',
        'aac' => 'audio/aac',
        'oga' => 'audio/ogg',
        'flac' => 'audio/flac'
    ];

    if (isset($videoExts[$ext])) {
        return ['type' => 'video', 'mime' => $videoExts[$ext]];
    }
    if (isset($audioExts[$ext])) {
        return ['type' => 'audio', 'mime' => $audioExts[$ext]];
    }
    return null;
}

function stream_media_file(string $filePath, string $mimeType, string $filename): void {
    if (!file_exists($filePath) || !is_file($filePath)) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => 'Media file not found']);
        exit;
    }

    $size = filesize($filePath);
    $start = 0;
    $end = $size - 1;

    $rangeHeader = $_SERVER['HTTP_RANGE'] ?? '';
    $isRange = false;

    if (!empty($rangeHeader) && preg_match('/bytes=(\d+)-(\d*)/i', $rangeHeader, $matches)) {
        $isRange = true;
        $start = (int)$matches[1];
        if (!empty($matches[2])) {
            $end = (int)$matches[2];
        }
    }

    if ($start > $end || $start >= $size) {
        http_response_code(416);
        header("Content-Range: bytes */{$size}");
        exit;
    }

    if ($end >= $size) {
        $end = $size - 1;
    }

    $length = $end - $start + 1;

    while (ob_get_level()) {
        ob_end_clean();
    }

    if ($isRange) {
        http_response_code(206);
        header("Content-Range: bytes {$start}-{$end}/{$size}");
    } else {
        http_response_code(200);
    }

    header("Content-Type: {$mimeType}");
    header("Content-Length: {$length}");
    header("Accept-Ranges: bytes");
    header("Content-Disposition: inline; filename=\"" . preg_replace('/[^\w\.\-]/', '_', basename($filename)) . "\"");
    header("Cache-Control: public, max-age=86400");

    $fp = fopen($filePath, 'rb');
    if ($fp === false) {
        http_response_code(500);
        exit;
    }

    fseek($fp, $start);
    $bytesRemaining = $length;
    $bufferSize = 65536;

    while (!feof($fp) && $bytesRemaining > 0 && (connection_status() === 0)) {
        $readBytes = min($bufferSize, $bytesRemaining);
        $data = fread($fp, $readBytes);
        echo $data;
        flush();
        $bytesRemaining -= strlen($data);
    }

    fclose($fp);
    exit;
}



function can_user_access_course(mysqli $mysqli, array $currentUser, int $courseId, bool $requireEdit = false): bool {
    if ($courseId < 2) return false;
    $role = $currentUser['role'] ?? 'student';

    // Student can NEVER edit or upload presentations
    if ($requireEdit && $role === 'student') {
        return false;
    }

    // Institute Admin has access to all courses (view and edit)
    if ($role === 'instituteadmin') {
        return true;
    }

    // Course Admin with assigned course can view and edit
    if ($role === 'courseadmin') {
        $assignedCourses = $currentUser['assigned_courses'] ?? [];
        if (!empty($assignedCourses) && in_array($courseId, $assignedCourses)) {
            return true;
        }
    }

    // Check DB role assignments for this course
    $stmt = $mysqli->prepare("
        SELECT r.shortname 
        FROM mdl_role_assignments ra
        JOIN mdl_role r ON r.id = ra.roleid
        JOIN mdl_context ctx ON ctx.id = ra.contextid
        WHERE ra.userid = ? AND ctx.contextlevel = 50 AND ctx.instanceid = ?
        LIMIT 1
    ");
    $stmt->bind_param('ii', $currentUser['id'], $courseId);
    $stmt->execute();
    $res = $stmt->get_result();
    $row = $res->fetch_assoc();
    $stmt->close();

    if ($row) {
        if ($requireEdit) {
            return in_array($row['shortname'], ['courseadmin', 'instituteadmin']);
        }
        return true;
    }

    if ($requireEdit) {
        return false;
    }

    // For viewing/downloading: check user enrolment
    $stmt2 = $mysqli->prepare("
        SELECT ue.id 
        FROM mdl_user_enrolments ue
        JOIN mdl_enrol e ON e.id = ue.enrolid
        WHERE ue.userid = ? AND e.courseid = ? AND ue.status = 0
        LIMIT 1
    ");
    $stmt2->bind_param('ii', $currentUser['id'], $courseId);
    $stmt2->execute();
    $isEnrolled = (bool)$stmt2->get_result()->fetch_assoc();
    $stmt2->close();

    return $isEnrolled;
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
} elseif (preg_match('#^/api/course-ppts/(\d+)/download$#', $path, $pm)) {
    $action = 'course-ppts-download';
    $_GET['id'] = (int)$pm[1];
} elseif (preg_match('#^/api/course-ppts/(\d+)/stream$#', $path, $pm)) {
    $action = 'course-ppts-stream';
    $_GET['id'] = (int)$pm[1];
} elseif (preg_match('#^/api/course-ppts/(\d+)/delete$#', $path, $pm)) {
    $action = 'course-ppts-delete';
    $_GET['id'] = (int)$pm[1];
} elseif (preg_match('#^/api/course-ppts/(\d+)$#', $path, $pm) && $_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $action = 'course-ppts-delete';
    $_GET['id'] = (int)$pm[1];
} elseif (preg_match('#^/api/course-ppts/delete$#', $path, $pm)) {
    $action = 'course-ppts-delete';
} elseif (empty($action)) {
    if (preg_match('#/api/([a-zA-Z0-9_/-]+)#', $path, $matches)) {
        $action = trim($matches[1], '/');
        $action = str_replace('/', '-', $action);
    } else {
        $action = 'status';
    }
}

// Read JSON body for POST requests or fallback to $_POST for multipart
$body = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true) ?: [];
    if (empty($body) && !empty($_POST)) {
        $body = $_POST;
    }
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
                    'system' => 'Dronacharya LMS',
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

                // Delete PPT presentations and clean up stored files
                $pptRes = $mysqli->query("SELECT stored_filename FROM mdl_course_ppts WHERE course_id = {$courseId}");
                $storedFilesToPurge = [];
                if ($pptRes) {
                    while ($pRow = $pptRes->fetch_assoc()) {
                        $storedFilesToPurge[] = $pRow['stored_filename'];
                    }
                }
                $mysqli->query("DELETE FROM mdl_course_ppts WHERE course_id = {$courseId}");

                $mysqli->query("DELETE FROM mdl_course WHERE id = {$courseId}");

                $mysqli->commit();

                // Clean up physical PPT files after transaction commit
                foreach ($storedFilesToPurge as $sf) {
                    $sfPath = '/var/www/moodledata/course_ppts/' . basename($sf);
                    if (file_exists($sfPath)) @unlink($sfPath);
                }

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

        // =====================================================================
        // COURSE PPTS: List all presentations for a course
        // =====================================================================
        case 'course-ppts':
            $currentUser = require_auth();
            $courseId = (int)($_GET['course_id'] ?? 0);
            if ($courseId < 2) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid course_id parameter is required']);
                break;
            }

            // Verify course exists
            $cCheck = $mysqli->prepare("SELECT id, fullname, shortname, visible FROM mdl_course WHERE id = ? LIMIT 1");
            $cCheck->bind_param('i', $courseId);
            $cCheck->execute();
            $course = $cCheck->get_result()->fetch_assoc();
            $cCheck->close();

            if (!$course) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'Course not found']);
                break;
            }

            // Verify user is authorized to access this course
            if (!can_user_access_course($mysqli, $currentUser, $courseId, false)) {
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'Access denied. You are not authorized to view presentations for this course.']);
                break;
            }

            // Determine if current user has upload capability for this course
            $canUpload = can_user_access_course($mysqli, $currentUser, $courseId, true);

            $stmt = $mysqli->prepare("
                SELECT p.id, p.course_id, p.title, p.original_filename, p.stored_filename,
                       p.file_size, p.mime_type, p.slide_count, p.timecreated, p.uploaded_by,
                       p.media_filename, p.media_stored_filename, p.media_file_size, p.media_mime_type, p.media_type,
                       u.username, u.firstname, u.lastname
                FROM mdl_course_ppts p
                LEFT JOIN mdl_user u ON u.id = p.uploaded_by
                WHERE p.course_id = ?
                ORDER BY p.timecreated DESC, p.id DESC
            ");
            $stmt->bind_param('i', $courseId);
            $stmt->execute();
            $res = $stmt->get_result();

            $ppts = [];
            while ($row = $res->fetch_assoc()) {
                $ext = strtolower(pathinfo($row['original_filename'], PATHINFO_EXTENSION));
                $uploaderName = trim(($row['firstname'] ?? '') . ' ' . ($row['lastname'] ?? ''));
                if (empty($uploaderName)) {
                    $uploaderName = $row['username'] ?? 'Instructor';
                }

                $hasMedia = !empty($row['media_stored_filename']);
                $mediaType = $row['media_type'] ?? null;
                if (!$hasMedia) {
                    $detected = detect_media_type($ext);
                    if ($detected) {
                        $hasMedia = true;
                        $mediaType = $detected['type'];
                    }
                }

                $ppts[] = [
                    'id' => (int)$row['id'],
                    'course_id' => (int)$row['course_id'],
                    'title' => $row['title'],
                    'original_filename' => $row['original_filename'],
                    'file_type' => strtoupper($ext),
                    'file_size' => (int)$row['file_size'],
                    'file_size_formatted' => format_bytes((int)$row['file_size']),
                    'mime_type' => $row['mime_type'],
                    'slide_count' => (int)($row['slide_count'] ?? 1),
                    'has_media' => $hasMedia,
                    'media_type' => $mediaType,
                    'media_filename' => $row['media_filename'] ?? null,
                    'media_file_size' => (int)($row['media_file_size'] ?? 0),
                    'media_file_size_formatted' => format_bytes((int)($row['media_file_size'] ?? 0)),
                    'media_stream_url' => $hasMedia ? ('/api/course-ppts/' . $row['id'] . '/stream') : null,
                    'uploaded_by_id' => (int)$row['uploaded_by'],
                    'uploaded_by_name' => $uploaderName,
                    'timecreated' => (int)$row['timecreated'],
                    'timecreated_formatted' => date('d M Y, H:i', (int)$row['timecreated']),
                    'download_url' => '/api/course-ppts/' . $row['id'] . '/download'
                ];
            }
            $stmt->close();

            echo json_encode([
                'status' => 'success',
                'course' => [
                    'id' => (int)$course['id'],
                    'fullname' => $course['fullname'],
                    'shortname' => $course['shortname']
                ],
                'can_upload' => $canUpload,
                'data' => $ppts
            ]);
            break;

        // =====================================================================
        // COURSE PPTS: Upload a new presentation (Institute Admin or assigned Course Admin)
        // =====================================================================
        case 'course-ppts-upload':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }
            $currentUser = require_auth();

            $courseId = (int)($body['course_id'] ?? ($_POST['course_id'] ?? 0));
            $title = trim($body['title'] ?? ($_POST['title'] ?? ''));

            if ($courseId < 2) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid course_id is required']);
                break;
            }

            // Verify course exists
            $cCheck = $mysqli->prepare("SELECT id, fullname, shortname FROM mdl_course WHERE id = ? LIMIT 1");
            $cCheck->bind_param('i', $courseId);
            $cCheck->execute();
            $course = $cCheck->get_result()->fetch_assoc();
            $cCheck->close();

            if (!$course) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'Target course not found']);
                break;
            }

            // Verify upload permission: Institute Admin or assigned Course Admin
            if (!can_user_access_course($mysqli, $currentUser, $courseId, true)) {
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'Access denied. You are not authorized to upload presentations to this course.']);
                break;
            }

            $hasPptFile = isset($_FILES['file']) && is_array($_FILES['file']) && $_FILES['file']['error'] !== UPLOAD_ERR_NO_FILE;
            $hasMediaFile = isset($_FILES['media_file']) && is_array($_FILES['media_file']) && $_FILES['media_file']['error'] !== UPLOAD_ERR_NO_FILE;

            // If user passed video/audio in the 'file' slot and media_file is empty, treat 'file' as media
            if ($hasPptFile && !$hasMediaFile) {
                $checkExt = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
                if (detect_media_type($checkExt) !== null) {
                    $_FILES['media_file'] = $_FILES['file'];
                    $hasMediaFile = true;
                    $hasPptFile = false;
                }
            }

            if (!$hasPptFile && !$hasMediaFile) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Please select a presentation file (.ppt/.pptx) or lecture video/audio file to upload']);
                break;
            }

            $storageDir = '/var/www/moodledata/course_ppts';
            if (!is_dir($storageDir)) {
                @mkdir($storageDir, 0770, true);
            }

            $origFilename = '';
            $storedFilename = '';
            $destinationPath = '';
            $fileSize = 0;
            $canonicalMime = '';
            $slideCount = 1;

            // Handle PPT presentation file
            if ($hasPptFile) {
                $file = $_FILES['file'];
                if ($file['error'] !== UPLOAD_ERR_OK) {
                    http_response_code(400);
                    echo json_encode(['status' => 'error', 'message' => 'Presentation file upload failed with error code ' . $file['error']]);
                    break;
                }

                if ($file['size'] > 50 * 1024 * 1024) {
                    http_response_code(400);
                    echo json_encode(['status' => 'error', 'message' => 'Presentation file exceeds 50MB limit']);
                    break;
                }

                $origFilename = preg_replace('/[\x00-\x1F\x7F\/\\\\]/', '', basename($file['name']));
                $ext = strtolower(pathinfo($origFilename, PATHINFO_EXTENSION));

                if (!in_array($ext, ['ppt', 'pptx'])) {
                    http_response_code(400);
                    echo json_encode(['status' => 'error', 'message' => 'Invalid presentation extension. Only .ppt and .pptx are supported.']);
                    break;
                }

                $tmpPath = $file['tmp_name'];
                $handle = @fopen($tmpPath, 'rb');
                $headerBytes = $handle ? fread($handle, 8) : '';
                if ($handle) fclose($handle);

                $isValidFormat = false;
                if ($ext === 'ppt') {
                    if (substr($headerBytes, 0, 8) === "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1") {
                        $isValidFormat = true;
                        $canonicalMime = 'application/vnd.ms-powerpoint';
                    }
                } elseif ($ext === 'pptx') {
                    if (substr($headerBytes, 0, 2) === "PK") {
                        $isValidFormat = true;
                        $canonicalMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
                    }
                }

                if (!$isValidFormat) {
                    http_response_code(400);
                    echo json_encode(['status' => 'error', 'message' => 'File content does not match a valid PowerPoint presentation (.ppt / .pptx)']);
                    break;
                }

                $storedFilename = sprintf("ppt_%d_%d_%s.%s", $courseId, time(), bin2hex(random_bytes(8)), $ext);
                $destinationPath = $storageDir . '/' . $storedFilename;

                if (!move_uploaded_file($tmpPath, $destinationPath)) {
                    http_response_code(500);
                    echo json_encode(['status' => 'error', 'message' => 'Failed to save presentation file to persistent storage']);
                    break;
                }
                chmod($destinationPath, 0640);
                $fileSize = (int)$file['size'];

                $customSlides = isset($_POST['slide_count']) ? (int)$_POST['slide_count'] : 0;
                $slideCount = $customSlides > 0 ? $customSlides : extract_presentation_slide_count($destinationPath, $ext);
            }

            // Handle Video or Audio media file
            $mediaOrigFilename = null;
            $mediaStoredFilename = null;
            $mediaDestPath = null;
            $mediaSize = 0;
            $mediaMime = null;
            $mediaType = null;

            if ($hasMediaFile) {
                $mFile = $_FILES['media_file'];
                if ($mFile['error'] !== UPLOAD_ERR_OK) {
                    if ($hasPptFile) @unlink($destinationPath);
                    http_response_code(400);
                    echo json_encode(['status' => 'error', 'message' => 'Media file upload failed with error code ' . $mFile['error']]);
                    break;
                }

                if ($mFile['size'] > 256 * 1024 * 1024) {
                    if ($hasPptFile) @unlink($destinationPath);
                    http_response_code(400);
                    echo json_encode(['status' => 'error', 'message' => 'Media file exceeds 256MB limit']);
                    break;
                }

                $mediaOrigFilename = preg_replace('/[\x00-\x1F\x7F\/\\\\]/', '', basename($mFile['name']));
                $mExt = strtolower(pathinfo($mediaOrigFilename, PATHINFO_EXTENSION));
                $mediaInfo = detect_media_type($mExt);

                if (!$mediaInfo) {
                    if ($hasPptFile) @unlink($destinationPath);
                    http_response_code(400);
                    echo json_encode(['status' => 'error', 'message' => 'Unsupported media format. Supported formats: .mp4, .webm, .mov, .mkv, .mp3, .wav, .m4a, .ogg']);
                    break;
                }

                $mediaType = $mediaInfo['type'];
                $mediaMime = $mediaInfo['mime'];
                $mediaStoredFilename = sprintf("media_%d_%d_%s.%s", $courseId, time(), bin2hex(random_bytes(8)), $mExt);
                $mediaDestPath = $storageDir . '/' . $mediaStoredFilename;

                if (!move_uploaded_file($mFile['tmp_name'], $mediaDestPath)) {
                    if ($hasPptFile) @unlink($destinationPath);
                    http_response_code(500);
                    echo json_encode(['status' => 'error', 'message' => 'Failed to save media file to persistent storage']);
                    break;
                }
                chmod($mediaDestPath, 0640);
                $mediaSize = (int)$mFile['size'];

                // If no PPT file was provided, set media file as primary presentation download
                if (!$hasPptFile) {
                    $origFilename = $mediaOrigFilename;
                    $storedFilename = $mediaStoredFilename;
                    $destinationPath = $mediaDestPath;
                    $fileSize = $mediaSize;
                    $canonicalMime = $mediaMime;
                    $customSlides = isset($_POST['slide_count']) ? (int)$_POST['slide_count'] : 0;
                    $slideCount = $customSlides > 0 ? $customSlides : 1;
                }
            }

            if (empty($title)) {
                $baseName = $hasPptFile ? $origFilename : $mediaOrigFilename;
                $title = pathinfo($baseName, PATHINFO_FILENAME);
            }
            $title = mb_substr($title, 0, 255);

            $stmt = $mysqli->prepare("
                INSERT INTO mdl_course_ppts
                (course_id, title, original_filename, stored_filename, storage_path, file_size, mime_type, slide_count,
                 media_filename, media_stored_filename, media_storage_path, media_file_size, media_mime_type, media_type,
                 uploaded_by, timecreated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP())
            ");
            $stmt->bind_param('issssisississsi',
                $courseId,
                $title,
                $origFilename,
                $storedFilename,
                $destinationPath,
                $fileSize,
                $canonicalMime,
                $slideCount,
                $mediaOrigFilename,
                $mediaStoredFilename,
                $mediaDestPath,
                $mediaSize,
                $mediaMime,
                $mediaType,
                $currentUser['id']
            );

            if (!$stmt->execute()) {
                if ($hasPptFile) @unlink($destinationPath);
                if ($hasMediaFile) @unlink($mediaDestPath);
                $err = $stmt->error;
                $stmt->close();
                http_response_code(500);
                echo json_encode(['status' => 'error', 'message' => 'Database error while saving presentation metadata: ' . $err]);
                break;
            }

            $newPptId = (int)$stmt->insert_id;
            $stmt->close();

            $uploaderName = trim(($currentUser['firstname'] ?? '') . ' ' . ($currentUser['lastname'] ?? ''));
            if (empty($uploaderName)) {
                $uploaderName = $currentUser['username'];
            }

            $finalExt = strtolower(pathinfo($origFilename, PATHINFO_EXTENSION));

            echo json_encode([
                'status' => 'success',
                'message' => "Presentation '{$title}' uploaded successfully" . ($mediaType ? " with {$mediaType} lecture" : ""),
                'data' => [
                    'id' => $newPptId,
                    'course_id' => $courseId,
                    'title' => $title,
                    'original_filename' => $origFilename,
                    'file_type' => strtoupper($finalExt),
                    'file_size' => $fileSize,
                    'file_size_formatted' => format_bytes($fileSize),
                    'mime_type' => $canonicalMime,
                    'slide_count' => $slideCount,
                    'has_media' => (bool)$hasMediaFile,
                    'media_type' => $mediaType,
                    'media_filename' => $mediaOrigFilename,
                    'media_file_size' => $mediaSize,
                    'media_file_size_formatted' => format_bytes($mediaSize),
                    'media_stream_url' => $hasMediaFile ? ('/api/course-ppts/' . $newPptId . '/stream') : null,
                    'uploaded_by_id' => (int)$currentUser['id'],
                    'uploaded_by_name' => $uploaderName,
                    'timecreated' => time(),
                    'timecreated_formatted' => date('d M Y, H:i'),
                    'download_url' => '/api/course-ppts/' . $newPptId . '/download'
                ]
            ]);
            break;

        // =====================================================================
        // COURSE PPTS: Secure Download / Serve Presentation
        // =====================================================================
        case 'course-ppts-download':
            $currentUser = require_auth();
            $pptId = (int)($_GET['id'] ?? 0);
            if ($pptId < 1) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid presentation ID required']);
                break;
            }

            $stmt = $mysqli->prepare("SELECT * FROM mdl_course_ppts WHERE id = ? LIMIT 1");
            $stmt->bind_param('i', $pptId);
            $stmt->execute();
            $ppt = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            if (!$ppt) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'Presentation not found']);
                break;
            }

            $courseId = (int)$ppt['course_id'];
            if (!can_user_access_course($mysqli, $currentUser, $courseId, false)) {
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'Access denied. You do not have permission to download presentations for this course.']);
                break;
            }

            $storageDir = realpath('/var/www/moodledata/course_ppts');
            $storedFilename = basename($ppt['stored_filename']);
            $fullPath = $storageDir . '/' . $storedFilename;

            // Strict path traversal defense
            $realPath = realpath($fullPath);
            if (!$realPath || !str_starts_with($realPath, $storageDir) || !is_file($realPath)) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'Presentation file missing from storage']);
                break;
            }

            $safeFilename = preg_replace('/[^\w\.\-\s\(\)\[\]]/', '_', $ppt['original_filename']);
            if (empty($safeFilename)) {
                $safeFilename = 'presentation_' . $ppt['id'] . '.' . pathinfo($storedFilename, PATHINFO_EXTENSION);
            }

            $mimeType = !empty($ppt['mime_type']) ? $ppt['mime_type'] : 'application/octet-stream';
            $fileSize = (int)$ppt['file_size'];
            if ($fileSize <= 0) {
                $fileSize = filesize($realPath);
            }

            while (ob_get_level()) {
                ob_end_clean();
            }

            header('Content-Description: File Transfer', true);
            header('Content-Type: ' . $mimeType, true);
            header('Content-Disposition: attachment; filename="' . $safeFilename . '"; filename*="UTF-8\'\'' . rawurlencode($safeFilename) . '"', true);
            header('Content-Length: ' . $fileSize, true);
            header('Content-Transfer-Encoding: binary', true);
            header('Cache-Control: private, must-revalidate, max-age=0', true);
            header('Pragma: public', true);
            header('X-Content-Type-Options: nosniff', true);
            readfile($realPath);
            exit;

        // =====================================================================
        // COURSE PPTS: Stream Presentation Video / Audio Media File
        // =====================================================================
        case 'course-ppts-stream':
            $currentUser = require_auth();
            $pptId = (int)($_GET['id'] ?? 0);
            if ($pptId < 1) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid presentation ID required']);
                break;
            }

            $stmt = $mysqli->prepare("SELECT * FROM mdl_course_ppts WHERE id = ? LIMIT 1");
            $stmt->bind_param('i', $pptId);
            $stmt->execute();
            $ppt = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            if (!$ppt) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'Presentation not found']);
                break;
            }

            $courseId = (int)$ppt['course_id'];
            if (!can_user_access_course($mysqli, $currentUser, $courseId, false)) {
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'Access denied. You do not have permission to stream media for this course.']);
                break;
            }

            $storageDir = realpath('/var/www/moodledata/course_ppts');
            $targetMediaFile = null;
            $targetMime = 'video/mp4';
            $targetFilename = 'lecture.mp4';

            if (!empty($ppt['media_stored_filename'])) {
                $checkPath = $storageDir . '/' . basename($ppt['media_stored_filename']);
                $real = realpath($checkPath);
                if ($real && str_starts_with($real, $storageDir) && is_file($real)) {
                    $targetMediaFile = $real;
                    $mExt = strtolower(pathinfo($ppt['media_filename'] ?? $real, PATHINFO_EXTENSION));
                    $mInfo = detect_media_type($mExt);
                    if ($mInfo) {
                        $targetMime = $mInfo['mime'];
                    } elseif (!empty($ppt['media_mime_type']) && $ppt['media_mime_type'] !== '0') {
                        $targetMime = $ppt['media_mime_type'];
                    } else {
                        $targetMime = 'video/mp4';
                    }
                    $targetFilename = !empty($ppt['media_filename']) ? $ppt['media_filename'] : basename($real);
                }
            } elseif (!empty($ppt['stored_filename'])) {
                $ext = strtolower(pathinfo($ppt['original_filename'], PATHINFO_EXTENSION));
                $mInfo = detect_media_type($ext);
                if ($mInfo) {
                    $checkPath = $storageDir . '/' . basename($ppt['stored_filename']);
                    $real = realpath($checkPath);
                    if ($real && str_starts_with($real, $storageDir) && is_file($real)) {
                        $targetMediaFile = $real;
                        $targetMime = $mInfo['mime'];
                        $targetFilename = $ppt['original_filename'];
                    }
                }
            }

            if (!$targetMediaFile) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'No video or audio media file attached to this presentation']);
                break;
            }

            stream_media_file($targetMediaFile, $targetMime, $targetFilename);
            exit;

        // =====================================================================
        // COURSE PPTS: Delete presentation (Institute Admin or assigned Course Admin)
        // =====================================================================
        case 'course-ppts-delete':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'DELETE') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST or DELETE method required']);
                break;
            }
            $currentUser = require_auth();

            $pptId = (int)($_GET['id'] ?? ($body['id'] ?? ($body['ppt_id'] ?? 0)));
            if ($pptId < 1) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Valid presentation ID required']);
                break;
            }

            $stmt = $mysqli->prepare("SELECT id, course_id, title, stored_filename, media_stored_filename FROM mdl_course_ppts WHERE id = ? LIMIT 1");
            $stmt->bind_param('i', $pptId);
            $stmt->execute();
            $ppt = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            if (!$ppt) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'Presentation not found']);
                break;
            }

            $courseId = (int)$ppt['course_id'];
            if (!can_user_access_course($mysqli, $currentUser, $courseId, true)) {
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'Access denied. You do not have permission to delete presentations from this course.']);
                break;
            }

            // Remove presentation file from disk storage if present
            $storageDir = realpath('/var/www/moodledata/course_ppts');
            if ($storageDir && !empty($ppt['stored_filename'])) {
                $storedFilename = basename($ppt['stored_filename']);
                $fullPath = $storageDir . '/' . $storedFilename;
                $realPath = realpath($fullPath);
                if ($realPath && str_starts_with($realPath, $storageDir) && is_file($realPath)) {
                    @unlink($realPath);
                }
            }

            // Remove media file from disk storage if present
            if ($storageDir && !empty($ppt['media_stored_filename'])) {
                $mediaStored = basename($ppt['media_stored_filename']);
                $fullMediaPath = $storageDir . '/' . $mediaStored;
                $realMediaPath = realpath($fullMediaPath);
                if ($realMediaPath && str_starts_with($realMediaPath, $storageDir) && is_file($realMediaPath)) {
                    @unlink($realMediaPath);
                }
            }

            // Delete database record
            $delStmt = $mysqli->prepare("DELETE FROM mdl_course_ppts WHERE id = ?");
            $delStmt->bind_param('i', $pptId);
            $delStmt->execute();
            $delStmt->close();

            echo json_encode([
                'status' => 'success',
                'message' => 'Presentation "' . $ppt['title'] . '" deleted successfully',
                'deleted_id' => $pptId,
                'course_id' => $courseId
            ]);
            break;

        // =====================================================================
        // PREVIOUS COMMANDERS: Get list, upload new portrait, stream image
        // =====================================================================
        case 'commanders':
            if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'GET required']);
                break;
            }

            // Ensure database table exists
            $mysqli->query("CREATE TABLE IF NOT EXISTS mdl_otc_commanders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL DEFAULT 'Previous Commander of Officers Training College',
                sub_title VARCHAR(255) DEFAULT '',
                filename VARCHAR(255) NOT NULL,
                storage_path VARCHAR(255) NOT NULL,
                mime_type VARCHAR(100) NOT NULL,
                uploaded_by BIGINT DEFAULT 0,
                timecreated BIGINT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

            // Baseline 31 commanders
            $commandersList = [];
            for ($i = 1; $i <= 31; $i++) {
                $commandersList[] = [
                    'id' => $i,
                    'type' => 'base',
                    'image_url' => "previouscomd/{$i}.jpg",
                    'title' => 'Previous Commander of Officers Training College',
                    'sub_title' => 'Officers Training College, AMC Centre and College, Lucknow'
                ];
            }

            // Custom uploaded commanders from database
            $cRes = $mysqli->query("SELECT id, title, sub_title, filename, mime_type, timecreated FROM mdl_otc_commanders ORDER BY id ASC");
            if ($cRes) {
                while ($row = $cRes->fetch_assoc()) {
                    $customId = 31 + (int)$row['id'];
                    $commandersList[] = [
                        'id' => $customId,
                        'db_id' => (int)$row['id'],
                        'type' => 'custom',
                        'image_url' => '/api/commanders/image?id=' . (int)$row['id'],
                        'title' => !empty($row['title']) ? $row['title'] : 'Previous Commander of Officers Training College',
                        'sub_title' => !empty($row['sub_title']) ? $row['sub_title'] : 'Officers Training College, AMC Centre and College, Lucknow',
                        'timecreated' => (int)$row['timecreated']
                    ];
                }
            }

            echo json_encode([
                'status' => 'success',
                'commanders' => $commandersList,
                'total' => count($commandersList)
            ]);
            break;

        case 'commanders-upload':
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                http_response_code(405);
                echo json_encode(['status' => 'error', 'message' => 'POST required']);
                break;
            }

            // Access to add commander portraits is granted exclusively to Institute Admin
            $currentUser = require_role(['instituteadmin']);
            $userId = (int)$currentUser['id'];

            if (empty($_FILES['image']) || !is_array($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
                http_response_code(400);
                $err = $_FILES['image']['error'] ?? 'No file provided';
                echo json_encode(['status' => 'error', 'message' => 'Please select a valid image file to upload (Error: ' . $err . ')']);
                break;
            }

            $imgFile = $_FILES['image'];
            $origName = basename($imgFile['name']);
            $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

            if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp'])) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Invalid image format. Supported formats: JPG, PNG, WEBP']);
                break;
            }

            if ($imgFile['size'] > 15 * 1024 * 1024) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Image file exceeds maximum allowable size of 15MB']);
                break;
            }

            $imageInfo = @getimagesize($imgFile['tmp_name']);
            if (!$imageInfo) {
                http_response_code(400);
                echo json_encode(['status' => 'error', 'message' => 'Uploaded file is not a valid image']);
                break;
            }
            $mimeType = $imageInfo['mime'];

            $storageDir = '/var/www/moodledata/commanders';
            if (!is_dir($storageDir)) {
                @mkdir($storageDir, 0775, true);
            }

            $uniqueFilename = 'cmd_' . time() . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
            $destPath = $storageDir . '/' . $uniqueFilename;

            if (!move_uploaded_file($imgFile['tmp_name'], $destPath)) {
                http_response_code(500);
                echo json_encode(['status' => 'error', 'message' => 'Failed to save commander portrait to storage directory']);
                break;
            }
            @chmod($destPath, 0644);

            $frontendDir = '/var/www/frontend/previouscomd';
            if (is_dir($frontendDir) && is_writable($frontendDir)) {
                @copy($destPath, $frontendDir . '/' . $uniqueFilename);
            }

            $cmdTitle = trim($_POST['title'] ?? '');
            if (empty($cmdTitle)) {
                $cmdTitle = 'Previous Commander of Officers Training College';
            }
            $cmdSub = trim($_POST['sub_title'] ?? '');
            if (empty($cmdSub)) {
                $cmdSub = 'Officers Training College, AMC Centre and College, Lucknow';
            }

            $mysqli->query("CREATE TABLE IF NOT EXISTS mdl_otc_commanders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL DEFAULT 'Previous Commander of Officers Training College',
                sub_title VARCHAR(255) DEFAULT '',
                filename VARCHAR(255) NOT NULL,
                storage_path VARCHAR(255) NOT NULL,
                mime_type VARCHAR(100) NOT NULL,
                uploaded_by BIGINT DEFAULT 0,
                timecreated BIGINT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

            $stmt = $mysqli->prepare("INSERT INTO mdl_otc_commanders (title, sub_title, filename, storage_path, mime_type, uploaded_by, timecreated) VALUES (?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP())");
            $stmt->bind_param('sssssi', $cmdTitle, $cmdSub, $uniqueFilename, $destPath, $mimeType, $userId);
            $stmt->execute();
            $newDbId = (int)$stmt->insert_id;
            $stmt->close();

            echo json_encode([
                'status' => 'success',
                'message' => 'Previous commander portrait uploaded successfully',
                'commander' => [
                    'id' => 31 + $newDbId,
                    'db_id' => $newDbId,
                    'type' => 'custom',
                    'image_url' => '/api/commanders/image?id=' . $newDbId,
                    'title' => $cmdTitle,
                    'sub_title' => $cmdSub,
                    'timecreated' => time()
                ]
            ]);
            break;

        case 'commanders-image':
            $dbId = (int)($_GET['id'] ?? 0);
            $filename = basename($_GET['file'] ?? '');

            $targetPath = '';
            $targetMime = 'image/jpeg';

            if ($dbId > 0) {
                $stmt = $mysqli->prepare("SELECT filename, storage_path, mime_type FROM mdl_otc_commanders WHERE id = ? LIMIT 1");
                $stmt->bind_param('i', $dbId);
                $stmt->execute();
                $row = $stmt->get_result()->fetch_assoc();
                $stmt->close();

                if ($row) {
                    $targetPath = $row['storage_path'];
                    $targetMime = $row['mime_type'];
                    if (!file_exists($targetPath)) {
                        $targetPath = '/var/www/moodledata/commanders/' . $row['filename'];
                    }
                }
            } elseif (!empty($filename)) {
                $targetPath = '/var/www/moodledata/commanders/' . $filename;
                $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
                if ($ext === 'png') $targetMime = 'image/png';
                elseif ($ext === 'webp') $targetMime = 'image/webp';
            }

            if (empty($targetPath) || !file_exists($targetPath)) {
                http_response_code(404);
                echo json_encode(['status' => 'error', 'message' => 'Commander image not found']);
                break;
            }

            while (ob_get_level()) {
                ob_end_clean();
            }

            header('Content-Type: ' . $targetMime, true);
            header('Content-Length: ' . filesize($targetPath));
            header('Cache-Control: public, max-age=86400');
            header('X-Content-Type-Options: nosniff');
            readfile($targetPath);
            exit;

        default:
            http_response_code(404);
            echo json_encode(['status' => 'error', 'message' => 'Endpoint not found: ' . $action]);
            break;
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
