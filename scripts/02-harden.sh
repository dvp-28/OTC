#!/usr/bin/env bash
# Step 2: security and policy settings, kept as code so every install is identical.
# Run: docker compose exec -u www-data php bash /opt/ekalavya/scripts/02-harden.sh
source /opt/ekalavya/scripts/common.sh

echo "Locale and time"
cfg --name=timezone        --set=Asia/Kolkata
cfg --name=forcetimezone   --set=Asia/Kolkata
cfg --name=country         --set=IN

echo "Access: login required, no guests, no self-registration"
cfg --name=forcelogin         --set=1
cfg --name=guestloginbutton   --set=0
cfg --name=registerauth       --set=''
cfg --name=enrol_plugins_enabled --set='manual,cohort'

echo "Password policy and lockout"
cfg --name=passwordpolicy          --set=1
cfg --name=minpasswordlength       --set=12
cfg --name=minpassworddigits       --set=1
cfg --name=minpasswordlower        --set=1
cfg --name=minpasswordupper        --set=1
cfg --name=minpasswordnonalphanum  --set=1
cfg --name=passwordreuselimit      --set=5
cfg --name=lockoutthreshold        --set=5
cfg --name=lockoutwindow           --set=1800
cfg --name=lockoutduration         --set=1800

echo "Sessions and cookies"
cfg --name=sessiontimeout  --set=1800     # 30 minutes idle
cfg --name=cookiesecure    --set=1
cfg --name=allowframembedding --set=0

echo "Turn off features that are not needed or call out to the internet"
cfg --name=enableblogs            --set=0
cfg --name=enableanalytics        --set=0
cfg --name=enableportfolios       --set=0
cfg --name=enablestats            --set=0
cfg --name=enablewebservices      --set=0   # re-enable in phase 2 for the mobile app
cfg --name=enablemobilewebservice --set=0
cfg --name=cronclionly            --set=1

echo "Recycle bin: accidental deletes by Institute/Course Admins are recoverable"
cfg --component=tool_recyclebin --name=coursebinenable   --set=1
cfg --component=tool_recyclebin --name=categorybinenable --set=1
cfg --component=tool_recyclebin --name=coursebinexpiry   --set=2592000   # 30 days

echo "Logs: keep 365 days (CERT-In asks for at least 180)"
cfg --component=logstore_standard --name=loglifetime --set=365

php "$CLI/purge_caches.php"
echo "Hardening complete. Next: 03-structure.php"
