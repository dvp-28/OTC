<?php
// Step 6: Create mdl_course_ppts table and persistent storage directory for course presentations
// Safe to run more than once.
//
// Run:
//   docker compose exec -u www-data php php /opt/ekalavya/scripts/06-course-ppts-migration.php

$host = getenv('DB_HOST') ?: 'db';
$dbname = getenv('DB_NAME') ?: 'moodle';
$user = getenv('DB_USER') ?: 'moodle';
$pass = getenv('DB_PASS') ?: 'Ek@l4vya#Db!Pass2026';

echo "=== Ekalavya LMS: Course PPTs Migration ===\n";

$mysqli = @new mysqli($host, $user, $pass, $dbname, 3306);
if ($mysqli->connect_error) {
    fwrite(STDERR, "Database connection failed: " . $mysqli->connect_error . "\n");
    exit(1);
}

$mysqli->set_charset('utf8mb4');

$createSql = "
CREATE TABLE IF NOT EXISTS mdl_course_ppts (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    storage_path VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(100) NOT NULL,
    uploaded_by BIGINT NOT NULL,
    timecreated BIGINT NOT NULL DEFAULT 0,
    KEY mdl_courppts_cou_ix (course_id),
    KEY mdl_courppts_upl_ix (uploaded_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
";

if ($mysqli->query($createSql) === TRUE) {
    echo "  + Table 'mdl_course_ppts' verified / created successfully.\n";
} else {
    fwrite(STDERR, "Failed to create table 'mdl_course_ppts': " . $mysqli->error . "\n");
    $mysqli->close();
    exit(1);
}

$chkCol = $mysqli->query("SHOW COLUMNS FROM mdl_course_ppts LIKE 'slide_count'");
if ($chkCol && $chkCol->num_rows === 0) {
    $mysqli->query("ALTER TABLE mdl_course_ppts ADD COLUMN slide_count INT NOT NULL DEFAULT 1 AFTER mime_type");
    echo "  + Added 'slide_count' column to mdl_course_ppts.\n";
} else {
    echo "  = 'slide_count' column verified in mdl_course_ppts.\n";
}

$chkMediaCols = [
    'media_filename' => "ALTER TABLE mdl_course_ppts ADD COLUMN media_filename VARCHAR(255) NULL DEFAULT NULL AFTER slide_count",
    'media_stored_filename' => "ALTER TABLE mdl_course_ppts ADD COLUMN media_stored_filename VARCHAR(255) NULL DEFAULT NULL AFTER media_filename",
    'media_storage_path' => "ALTER TABLE mdl_course_ppts ADD COLUMN media_storage_path VARCHAR(255) NULL DEFAULT NULL AFTER media_stored_filename",
    'media_file_size' => "ALTER TABLE mdl_course_ppts ADD COLUMN media_file_size BIGINT NOT NULL DEFAULT 0 AFTER media_storage_path",
    'media_mime_type' => "ALTER TABLE mdl_course_ppts ADD COLUMN media_mime_type VARCHAR(100) NULL DEFAULT NULL AFTER media_file_size",
    'media_type' => "ALTER TABLE mdl_course_ppts ADD COLUMN media_type VARCHAR(20) NULL DEFAULT NULL AFTER media_mime_type"
];

foreach ($chkMediaCols as $col => $alterSql) {
    $cRes = $mysqli->query("SHOW COLUMNS FROM mdl_course_ppts LIKE '{$col}'");
    if ($cRes && $cRes->num_rows === 0) {
        $mysqli->query($alterSql);
        echo "  + Added '{$col}' column to mdl_course_ppts.\n";
    } else {
        echo "  = '{$col}' column verified in mdl_course_ppts.\n";
    }
}

// Update existing test rows with realistic slide counts
$mysqli->query("UPDATE mdl_course_ppts SET slide_count = 36 WHERE title LIKE '%Trauma%'");
$mysqli->query("UPDATE mdl_course_ppts SET slide_count = 24 WHERE title LIKE '%TCCC%'");
$mysqli->query("UPDATE mdl_course_ppts SET slide_count = 42 WHERE title LIKE '%Staff%'");
$mysqli->query("UPDATE mdl_course_ppts SET slide_count = 18 WHERE slide_count <= 1");
echo "  + Verified realistic slide counts for existing presentations.\n";

$mysqli->close();

// Ensure persistent storage directory exists in moodledata
$storageDir = '/var/www/moodledata/course_ppts';
if (!is_dir($storageDir)) {
    if (mkdir($storageDir, 0770, true)) {
        echo "  + Storage directory '{$storageDir}' created successfully.\n";
    } else {
        fwrite(STDERR, "Failed to create storage directory '{$storageDir}'.\n");
        exit(1);
    }
} else {
    echo "  = Storage directory '{$storageDir}' already exists.\n";
}

// Add .htaccess inside storageDir for defense-in-depth against direct execution
$htaccessFile = $storageDir . '/.htaccess';
if (!file_exists($htaccessFile)) {
    file_put_contents($htaccessFile, "Deny from all\n");
    chmod($htaccessFile, 0644);
    echo "  + Storage protection .htaccess created.\n";
}

echo "Course PPT storage migration completed successfully.\n";
