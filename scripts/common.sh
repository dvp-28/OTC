#!/usr/bin/env bash
# Shared helpers. Moodle 5.1+ keeps code (incl. admin/cli) under public/.
set -euo pipefail
if [ -d /var/www/moodle/public/admin/cli ]; then
  MOODLE_CODE=/var/www/moodle/public
else
  MOODLE_CODE=/var/www/moodle
fi
CLI="$MOODLE_CODE/admin/cli"
cfg() { php "$CLI/cfg.php" "$@"; }
