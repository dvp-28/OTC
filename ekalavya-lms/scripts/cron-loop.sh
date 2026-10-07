#!/usr/bin/env bash
# Runs Moodle cron every minute (cron container / App VM).
source /opt/ekalavya/scripts/common.sh
while true; do
  php "$CLI/cron.php" || echo "cron run failed at $(date)"
  sleep 60
done
