<?php
// Step 3: build the OTC structure - categories, 7 course shells, the 3 client
// roles, and one student cohort per course batch. Safe to run more than once.
//
// Run:
//   docker compose exec -u www-data php php /opt/ekalavya/scripts/03-structure.php --batch=2026

define('CLI_SCRIPT', true);
require('/var/www/moodle/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/cohort/lib.php');
require_once($CFG->dirroot . '/enrol/cohort/locallib.php');

[$options] = cli_get_params(['batch' => date('Y'), 'help' => false], ['h' => 'help']);
if ($options['help']) {
    echo "Usage: php 03-structure.php [--batch=2026]\n";
    exit(0);
}
$batch = clean_param($options['batch'], PARAM_ALPHANUMEXT);

\core\cron::setup_user();   // act as the site admin
$syscontext = context_system::instance();

// ---------------------------------------------------------------------------
// 1. Category tree (confirm full course names with the client).
// ---------------------------------------------------------------------------
$structure = [
    'MED' => ['Medical Officers', [
        'MOBC'  => 'Medical Officers Basic Course',
        'MOJCC' => 'Medical Officers Junior Command Course',
        'MOSCC' => 'Medical Officers Senior Command Course',
    ]],
    'NUR' => ['Nursing Officers', [
        'BNOC'  => 'Basic Nursing Officers Course',
        'SNOC'  => 'Senior Nursing Officers Course',
    ]],
    'NT'  => ['Non-Technical', [
        'NTPCC' => 'Non-Tech Post Commissioning Course',
        'NTADM' => 'Non-Tech Administration',
    ]],
];

function ek_category(string $name, string $idnumber, int $parent = 0): core_course_category {
    global $DB;
    if ($id = $DB->get_field('course_categories', 'id', ['idnumber' => $idnumber])) {
        return core_course_category::get($id, MUST_EXIST, true);
    }
    cli_writeln("  + category {$name}");
    return core_course_category::create((object)[
        'name' => $name, 'idnumber' => $idnumber, 'parent' => $parent,
    ]);
}

cli_heading('Categories and courses');
$root = ek_category('Officers Training College - AMC Centre and College', 'OTC');

$courses = [];
foreach ($structure as $catid => [$catname, $list]) {
    $cat = ek_category($catname, "OTC-{$catid}", $root->id);
    foreach ($list as $short => $full) {
        $course = $DB->get_record('course', ['shortname' => $short]);
        if (!$course) {
            cli_writeln("  + course {$short}");
            $course = create_course((object)[
                'category'         => $cat->id,
                'fullname'         => $full,
                'shortname'        => $short,
                'idnumber'         => $short,
                'format'           => 'topics',
                'enablecompletion' => 1,
                'visible'          => 1,
            ]);
        }
        $courses[$short] = $course;
    }
}

// ---------------------------------------------------------------------------
// 2. Roles: the client's 3 levels. (Site Admin = the account from 01-install.sh.)
// ---------------------------------------------------------------------------
function ek_role(string $name, string $short, string $desc, string $archetype, array $levels): int {
    global $DB;
    if ($id = $DB->get_field('role', 'id', ['shortname' => $short])) {
        return (int)$id;
    }
    cli_writeln("  + role {$name}");
    $id = create_role($name, $short, $desc, $archetype);
    reset_role_capabilities($id);          // copy the archetype's default permissions
    set_role_contextlevels($id, $levels);
    return $id;
}

cli_heading('Roles');
$instituteid = ek_role(
    'Institute Admin', 'instituteadmin',
    'Adds and deletes content in all OTC courses, manages users and batches. Assigned on the OTC category.',
    'manager', [CONTEXT_COURSECAT]
);
$courseadminid = ek_role(
    'Course Admin', 'courseadmin',
    'Adds and deletes content in assigned courses only. Assigned per course.',
    'editingteacher', [CONTEXT_COURSE]
);
$studentid = (int)$DB->get_field('role', 'id', ['shortname' => 'student'], MUST_EXIST);

// Institute Admins manage content and people, not the structure itself:
// they cannot delete whole courses or reorganise categories (Site Admin only).
foreach (['moodle/course:delete', 'moodle/category:manage'] as $cap) {
    assign_capability($cap, CAP_PREVENT, $instituteid, $syscontext->id, true);
}
// Who may assign whom.
core_role_set_assign_allowed($instituteid, $courseadminid);
core_role_set_assign_allowed($instituteid, $studentid);
accesslib_clear_all_caches(true);

// ---------------------------------------------------------------------------
// 3. One cohort per course batch, auto-enrolled as Student.
//    Later the JWT login plugin will drop officers into the right cohort.
// ---------------------------------------------------------------------------
cli_heading("Batch cohorts ({$batch})");
$cohortplugin = enrol_get_plugin('cohort');
$rootcontext  = context_coursecat::instance($root->id);

foreach ($courses as $short => $course) {
    $idnumber = "{$short}-{$batch}";
    $cohortid = $DB->get_field('cohort', 'id', ['idnumber' => $idnumber]);
    if (!$cohortid) {
        cli_writeln("  + cohort {$idnumber}");
        $cohortid = cohort_add_cohort((object)[
            'contextid' => $rootcontext->id,
            'name'      => "{$short} batch {$batch}",
            'idnumber'  => $idnumber,
        ]);
    }
    $exists = $DB->record_exists('enrol', [
        'courseid' => $course->id, 'enrol' => 'cohort', 'customint1' => $cohortid,
    ]);
    if (!$exists) {
        $cohortplugin->add_instance($course, ['customint1' => $cohortid, 'roleid' => $studentid]);
        enrol_cohort_sync(new null_progress_trace(), $course->id);
    }
}

cli_heading('Done');
cli_writeln('Next: assign Institute Admins on the OTC category and Course Admins per course.');
