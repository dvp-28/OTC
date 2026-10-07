<?php
// Step 4: Verification script for Ekalavya LMS structure and configuration.
define('CLI_SCRIPT', true);
require('/var/www/moodle/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->libdir . '/adminlib.php');
require_once($CFG->libdir . '/environmentlib.php');

cli_heading('1. CATEGORIES');
$cats = $DB->get_records('course_categories', null, 'id ASC');
foreach ($cats as $c) {
    cli_writeln("  ID {$c->id}: {$c->name} (idnumber: {$c->idnumber}, parent: {$c->parent})");
}

cli_heading('2. COURSES');
$courses = $DB->get_records_select('course', 'id > 1', null, 'id ASC');
foreach ($courses as $crs) {
    cli_writeln("  ID {$crs->id}: {$crs->shortname} - {$crs->fullname} (Category ID: {$crs->category})");
}

cli_heading('3. ROLES & CAPABILITIES');
foreach (['instituteadmin', 'courseadmin'] as $rshort) {
    $role = $DB->get_record('role', ['shortname' => $rshort]);
    if (!$role) {
        cli_writeln("  FAIL: Role {$rshort} not found!");
        continue;
    }
    cli_writeln("  Role: {$role->name} ({$role->shortname}), Archetype: {$role->archetype}");
    
    // Check context levels
    $levels = get_role_contextlevels($role->id);
    cli_writeln("    Allowed context levels: " . implode(', ', $levels));
}

// Check instituteadmin restrictions
$instrole = $DB->get_record('role', ['shortname' => 'instituteadmin']);
if ($instrole) {
    $caps = $DB->get_records('role_capabilities', ['roleid' => $instrole->id]);
    $capmap = [];
    foreach ($caps as $cap) {
        $capmap[$cap->capability] = $cap->permission;
    }
    $cdel = $capmap['moodle/course:delete'] ?? 'not set';
    $cman = $capmap['moodle/category:manage'] ?? 'not set';
    cli_writeln("    moodle/course:delete permission: {$cdel} (CAP_PREVENT is " . CAP_PREVENT . ")");
    cli_writeln("    moodle/category:manage permission: {$cman} (CAP_PREVENT is " . CAP_PREVENT . ")");
}

cli_heading('4. COHORTS & COHORT ENROLMENTS');
$cohorts = $DB->get_records('cohort', null, 'id ASC');
foreach ($cohorts as $ch) {
    $enrolcount = $DB->count_records('enrol', ['enrol' => 'cohort', 'customint1' => $ch->id]);
    cli_writeln("  Cohort: {$ch->name} (idnumber: {$ch->idnumber}) -> Enrolled in {$enrolcount} course(s)");
}

cli_heading('5. MOODLE ENVIRONMENT CHECK');
[$envstatus, $envresults] = check_moodle_environment(normalize_version($CFG->release), ENV_SELECT_RELEASE);
cli_writeln("  Overall status: " . ($envstatus ? 'OK (All requirements passed)' : 'FAIL / WARNING'));
if (!$envstatus) {
    foreach ($envresults as $res) {
        if (!$res->getStatus()) {
            cli_writeln("    FAIL: {$res->part} {$res->info}");
        }
    }
}
cli_heading('VERIFICATION COMPLETE');
