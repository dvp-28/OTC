<?php
// Ekalavya LMS - Moodle configuration.
// All environment-specific values come from .env, so the same file works
// locally and on the client's VMs.

unset($CFG);
global $CFG;
$CFG = new stdClass();

// Database (Database VM).
$CFG->dbtype    = 'mysqli';
$CFG->dblibrary = 'native';
$CFG->dbhost    = getenv('DB_HOST');
$CFG->dbname    = getenv('DB_NAME');
$CFG->dbuser    = getenv('DB_USER');
$CFG->dbpass    = getenv('DB_PASS');
$CFG->prefix    = 'mdl_';
$CFG->dboptions = [
    'dbpersist'   => false,
    'dbport'      => 3306,
    'dbcollation' => 'utf8mb4_unicode_ci',
];

// Site address and paths.
$CFG->wwwroot       = getenv('MOODLE_WWWROOT');
$CFG->dataroot      = '/var/www/moodledata';
$CFG->localcachedir = '/var/www/localcache';
$CFG->directorypermissions = 02770;
$CFG->admin = 'admin';

// TLS ends at the Proxy VM; tell Moodle the site is HTTPS anyway.
$CFG->sslproxy = true;
// Trust X-Forwarded-For from our own proxy, so Moodle logs real client IPs
// (needed for audit logs and the Institute-admin IP allowlist).
$CFG->getremoteaddrconf  = 1;
$CFG->reverseproxyignore = getenv('TRUSTED_PROXY_SUBNET');

// Sessions in Redis: web nodes stay stateless, so splitting to more VMs later
// needs no code change.
$CFG->session_handler_class = '\core\session\redis';
$CFG->session_redis_host    = getenv('REDIS_HOST');
$CFG->session_redis_port    = 6379;
$CFG->session_redis_auth    = getenv('REDIS_PASSWORD');
$CFG->session_redis_prefix  = 'ek_sess_';
$CFG->session_redis_acquire_lock_timeout = 120;
$CFG->session_redis_lock_expire = 7200;

// Let nginx stream files (videos) after Moodle checks access.
$CFG->xsendfile        = 'X-Accel-Redirect';
$CFG->xsendfilealiases = ['/dataroot/' => $CFG->dataroot];

// Moodle 5.x routing is handled by the try_files rule in nginx.
$CFG->routerconfigured = true;

// Air-gap / hardening: no calls home, no installing code from the web UI.
$CFG->disableupdatenotifications = true;
$CFG->disableupdateautodeploy    = true;
$CFG->preventexecpath            = true;

// Debugging: on locally, off in production (set MOODLE_DEBUG=0 in .env).
if (getenv('MOODLE_DEBUG') === '1') {
    @error_reporting(E_ALL);
    @ini_set('display_errors', '1');
    $CFG->debug = (E_ALL);
    $CFG->debugdisplay = 1;
} else {
    $CFG->debug = 0;
    $CFG->debugdisplay = 0;
}

// Moodle 5.1+ keeps code under public/; older layouts keep it at the root.
if (file_exists(__DIR__ . '/public/lib/setup.php')) {
    require_once(__DIR__ . '/public/lib/setup.php');
} else {
    require_once(__DIR__ . '/lib/setup.php');
}
// There is no closing PHP tag on purpose.
