#!/usr/bin/env bash
# Step 1: create the Moodle database tables and the hidden Site Admin account.
# Run: docker compose exec -u www-data php bash /opt/ekalavya/scripts/01-install.sh
source /opt/ekalavya/scripts/common.sh

php "$CLI/install_database.php" \
  --agree-license \
  --lang=en \
  --adminuser="$MOODLE_ADMIN_USER" \
  --adminpass="$MOODLE_ADMIN_PASS" \
  --adminemail="$MOODLE_ADMIN_EMAIL" \
  --fullname="$MOODLE_SITE_FULLNAME" \
  --shortname="$MOODLE_SITE_SHORTNAME"

echo "Install complete. Next: 02-harden.sh"
