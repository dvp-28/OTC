<?php
// Ekalavya LMS - Create demo users for each role (Institute Admin, Course Admin, Student)
// Run: docker compose exec -u www-data php php /opt/ekalavya/scripts/05-demo-users.php
define('CLI_SCRIPT', true);
require('/var/www/moodle/config.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->dirroot . '/cohort/lib.php');

\core\cron::setup_user();

cli_heading('Creating Demo Users for Role-Based Login');

// Helper: create or update user
function ek_ensure_user(string $username, string $password, string $firstname, string $lastname, string $email): stdClass {
    global $DB, $CFG;
    $user = $DB->get_record('user', ['username' => $username]);
    if ($user) {
        cli_writeln("  = user {$username} already exists (id {$user->id})");
        return $user;
    }
    $user = new stdClass();
    $user->username = $username;
    $user->password = hash_internal_user_password($password);
    $user->firstname = $firstname;
    $user->lastname = $lastname;
    $user->email = $email;
    $user->confirmed = 1;
    $user->mnethostid = $CFG->mnet_localhost_id;
    $user->auth = 'manual';
    $user->id = user_create_user($user, false, false);
    cli_writeln("  + user {$username} created (id {$user->id})");
    return $user;
}

// 1. Institute Admin - can manage all courses at OTC category level
$instAdmin = ek_ensure_user(
    'inst.admin',
    'InstAdmin@2026!',
    'Col Rajesh',
    'Mehta',
    'inst.admin@ekalavya.local'
);

// 2. Course Admin - can edit content in MOBC only
$courseAdmin = ek_ensure_user(
    'course.admin',
    'CourseAdmin@2026!',
    'Maj Priya',
    'Singh',
    'course.admin@ekalavya.local'
);

// 3. Student Officer - enrolled in MOBC-2026 batch
$student = ek_ensure_user(
    'student.officer',
    'Student@2026!',
    'Capt Vikramaditya',
    'Sharma',
    'student.officer@ekalavya.local'
);

// Assign roles
cli_heading('Assigning Roles');

$instRole = $DB->get_record('role', ['shortname' => 'instituteadmin'], '*', MUST_EXIST);
$courseRole = $DB->get_record('role', ['shortname' => 'courseadmin'], '*', MUST_EXIST);

// Institute Admin on OTC category
$otcCat = $DB->get_record('course_categories', ['idnumber' => 'OTC'], '*', MUST_EXIST);
$catContext = context_coursecat::instance($otcCat->id);
if (!user_has_role_assignment($instAdmin->id, $instRole->id, $catContext->id)) {
    role_assign($instRole->id, $instAdmin->id, $catContext->id);
    cli_writeln("  + inst.admin assigned as Institute Admin on OTC category");
} else {
    cli_writeln("  = inst.admin already has Institute Admin role on OTC");
}

// Course Admin on MOBC course
$mobcCourse = $DB->get_record('course', ['shortname' => 'MOBC'], '*', MUST_EXIST);
$courseContext = context_course::instance($mobcCourse->id);
if (!user_has_role_assignment($courseAdmin->id, $courseRole->id, $courseContext->id)) {
    role_assign($courseRole->id, $courseAdmin->id, $courseContext->id);
    cli_writeln("  + course.admin assigned as Course Admin on MOBC");
} else {
    cli_writeln("  = course.admin already has Course Admin role on MOBC");
}

// Student: add to MOBC-2026 cohort (auto-enrols via cohort sync)
$cohort = $DB->get_record('cohort', ['idnumber' => 'MOBC-2026']);
if ($cohort) {
    if (!$DB->record_exists('cohort_members', ['cohortid' => $cohort->id, 'userid' => $student->id])) {
        cohort_add_member($cohort->id, $student->id);
        cli_writeln("  + student.officer added to MOBC-2026 cohort");
    } else {
        cli_writeln("  = student.officer already in MOBC-2026 cohort");
    }
} else {
    cli_writeln("  ! MOBC-2026 cohort not found");
}

// Manual enrol student in MOBC as student role
$enrol = $DB->get_record('enrol', ['courseid' => $mobcCourse->id, 'enrol' => 'manual']);
if ($enrol) {
    $plugin = enrol_get_plugin('manual');
    $studentRole = $DB->get_record('role', ['shortname' => 'student'], '*', MUST_EXIST);
    if (!is_enrolled($courseContext, $student)) {
        $plugin->enrol_user($enrol, $student->id, $studentRole->id);
        cli_writeln("  + student.officer enrolled in MOBC as student");
    } else {
        cli_writeln("  = student.officer already enrolled in MOBC");
    }
}

cli_heading('Demo Login Credentials');
cli_writeln('');
cli_writeln('  ┌───────────────────┬──────────────────────┬─────────────────────┐');
cli_writeln('  │ Role              │ Username             │ Password            │');
cli_writeln('  ├───────────────────┼──────────────────────┼─────────────────────┤');
cli_writeln('  │ Institute Admin   │ inst.admin           │ InstAdmin@2026!     │');
cli_writeln('  │ Course Admin      │ course.admin         │ CourseAdmin@2026!   │');
cli_writeln('  │ Student Officer   │ student.officer      │ Student@2026!       │');
cli_writeln('  └───────────────────┴──────────────────────┴─────────────────────┘');
cli_writeln('');
cli_writeln('Done.');
