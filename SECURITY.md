# Ekalavya LMS: Security Operations Handbook & Architecture Standard
**Officers Training College (OTC), AMC Centre & College, Lucknow**  
**Classification:** RESTRICTED — MILITARY OPERATIONAL CODEBASE  
**Version:** 2.0 (Post-Audit Hardened Baseline)  
**Date:** October 2026  

---

## 1. System Security Overview

Ekalavya (Dronacharya) is an air-gapped, on-premise Defence Learning Management System (LMS) deployed at the Officers Training College, AMC Centre & College, Lucknow. The portal serves three military roles:
1. **Institute Administrator (Commandant / Trg Officer):** Brigade-level management of courses, faculty assignments, personnel records, and forensic audit logs.
2. **Course Administrator (Instructor Officer):** Instructional syllabus administration, upload of restricted tactical lectures, slide decks, and multimedia briefs.
3. **Student Officer (Course Attendee):** Read-only instructional portal access, dynamic slide viewer, classroom lecture streaming, and previous commanders historical gallery.

### Defence Threat Model & Asset Classification
- **Restricted Instructional Material:** Tactical Combat Casualty Care (TCCC), field surgery, military command doctrine, and instructional video lectures.
- **Officer Personally Identifiable Information (PII):** Military Service IDs, full names, ranks, postings, email addresses, phone contacts, and login access trails.
- **System Integrity:** Anti-tampering controls against privilege escalation, unauthorized course modifications, and bulk automated content extraction.

---

## 2. Hardened Architecture & Security Controls

```
+-----------------------------------------------------------------------------------+
|                           MILITARY LAN WORKSTATIONS                               |
+-----------------------------------------------------------------------------------+
                                         |
                                (HTTPS :443 / TLS 1.3)
                                         v
+-----------------------------------------------------------------------------------+
|   EDGE PROXY (Nginx 1.27) [LAN Exposed]                                          |
|   - TLS Termination (ECDHE-AES256-GCM / TLS 1.3 preferred)                       |
|   - Content Security Policy (default-src 'self'; script-src 'self';)              |
|   - Headers: HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff        |
|   - Access Restriction: Moodle native /admin restricted to management subnet       |
|   - Deny direct access to hidden files (/.env) and dataroot storage mounts       |
+-----------------------------------------------------------------------------------+
                                         |
                               (Internal Docker Network)
                                         v
+-----------------------------------------------------------------------------------+
|   WEB ROUTER (Nginx FastCGI) -> PHP-FPM 8.3 CONTAINER                             |
|   - Route Guards: require_auth(), require_role(), require_course_access()        |
|   - Dynamic DB Re-validation: Suspended accounts revoked immediately (SEC-A05)   |
|   - Anti-CSRF Token: Cryptographic X-CSRF-Token on all mutating requests          |
|   - Stored XSS Neutralization: Pure context-aware DOM injection (zero innerHTML)   |
|   - Zero Shell Access: disable_functions = exec, passthru, shell_exec, system...  |
|   - Dynamic Visual Forensic Watermarking: Officer Service ID, IP, and timestamp   |
+-----------------------------------------------------------------------------------+
                 |                                                   |
      (Encrypted Sessions)                                 (Parameterized SQL)
                 v                                                   v
+----------------------------------+               +--------------------------------+
|   REDIS 7 (Session Store)        |               |   MYSQL 8.4 (Database VM)      |
|   - Protected Mode Enabled       |               |   - Strict Parameterized SQL   |
|   - Dangerous Commands Renamed:  |               |   - mdl_ek_audit (Audit Log)   |
|     FLUSHALL, FLUSHDB, CONFIG    |               |   - Least Privilege User       |
|   - 5-Fail 30-Min Lockout (A02)  |               |   - No Super/File Privileges   |
+----------------------------------+               +--------------------------------+
```

---

## 3. Secret Rotation Standard Operating Procedure (SOP)

Secret rotation must be performed every 90 days or immediately upon suspected insider threat or staff transfer.

### 3.1 Database Credentials (`DB_PASS`, `DB_ROOT_PASS`)
1. Generate high-entropy 24+ character passwords containing upper, lower, digits, and symbols:
   ```bash
   openssl rand -base64 24
   ```
2. Update MySQL user password via docker command:
   ```bash
   docker compose exec -T db mysql -uroot -p"${DB_ROOT_PASS}" -e "
       ALTER USER 'moodle'@'%' IDENTIFIED BY 'NEW_STRONG_PASSWORD';
       FLUSH PRIVILEGES;
   "
   ```
3. Update `.env` with the new password:
   ```ini
   DB_PASS=NEW_STRONG_PASSWORD
   ```
4. Recreate dependent services:
   ```bash
   docker compose up -d php cron
   ```

### 3.2 Redis Session Password (`REDIS_PASSWORD`)
1. Generate new password and update `.env`:
   ```ini
   REDIS_PASSWORD=NEW_REDIS_PASSWORD
   ```
2. Recreate Redis and PHP services:
   ```bash
   docker compose up -d redis php
   ```
3. Note: Rotating the Redis password will invalidate existing sessions, requiring active personnel to re-authenticate.

### 3.3 TLS Certificate Renewal (`certs/ekalavya.crt`)
Since the facility is strictly air-gapped, TLS certificates are generated using an offline internal Military CA:
```bash
# Generate 4096-bit RSA Private Key
openssl genrsa -out certs/ekalavya.key 4096

# Generate CSR and Self-Signed Certificate with SAN
openssl req -new -x509 -sha256 -key certs/ekalavya.key -out certs/ekalavya.crt -days 730 \
    -subj "/C=IN/ST=Uttar Pradesh/L=Lucknow/O=Indian Army/OU=AMC Centre and College/CN=ekalavya.local" \
    -addext "subjectAltName=DNS:ekalavya.local,DNS:localhost,IP:127.0.0.1"

# Reload Edge Proxy without downtime
docker compose exec -T proxy nginx -s reload
```

---

## 4. Security Audit Log Review & Forensic Analysis

All security-critical actions are recorded into the append-only `mdl_ek_audit` database table. Passwords, session tokens, and cryptographic keys are strictly excluded from audit details.

### 4.1 Audit Event Types
| Event Identifier | Trigger Condition | Forensic Value |
|---|---|---|
| `AUTH_LOGIN_SUCCESS` | Successful officer authentication | Correlates user to IP and role |
| `AUTH_LOGIN_FAILED` | Incorrect credentials | Detects brute-force / guessing attacks |
| `AUTH_ACCOUNT_LOCKED` | 5 failed attempts reached | Identifies targeted accounts |
| `AUTH_LOGIN_BLOCKED` | Attempt against locked account | Identifies persistent attackers |
| `AUTH_LOGOUT` | Officer explicitly terminated session | Establishes session boundaries |
| `USER_ROSTER_VIEW` | Roster queried via `/api/users` | Flags bulk reconnaissance |
| `USER_CREATE` | New personnel registered | Attribution for unauthorized users |
| `USER_UPDATE` | Officer record altered | Detects tampering with ranks/emails |
| `USER_ROLE_CHANGE` | Administrative role modified | Flags privilege escalation attempts |
| `COURSE_CREATE` | New course created | Instructional tracking |
| `COURSE_DELETE` | Course deleted | High-impact integrity tracking |
| `PPT_UPLOAD` | Presentation or lecture uploaded | Content provenance tracking |
| `PPT_DELETE` | Presentation removed | Material deletion tracking |
| `PPT_DOWNLOAD` | Slide deck downloaded | Data exfiltration volume tracking |
| `MEDIA_STREAM` | Video/audio lecture playback initiated | Classroom content consumption tracking |
| `COMMANDER_UPLOAD` | Historical commander portrait added | Image upload verification |

### 4.2 Forensic Investigation Queries
Execute against the MySQL container:
```bash
# 1. Investigate failed login attempts in the last 24 hours
docker compose exec -T db mysql -umoodle -p"${DB_PASS}" moodle -e "
    SELECT id, username, ip_address, created_at, details 
    FROM mdl_ek_audit 
    WHERE event_type IN ('AUTH_LOGIN_FAILED', 'AUTH_ACCOUNT_LOCKED') 
    ORDER BY id DESC LIMIT 50;
"

# 2. Check for privilege modifications
docker compose exec -T db mysql -umoodle -p"${DB_PASS}" moodle -e "
    SELECT id, username, target_id, details, created_at 
    FROM mdl_ek_audit 
    WHERE event_type = 'USER_ROLE_CHANGE';
"

# 3. Detect high-volume downloads by an officer
docker compose exec -T db mysql -umoodle -p"${DB_PASS}" moodle -e "
    SELECT user_id, username, COUNT(*) as download_count 
    FROM mdl_ek_audit 
    WHERE event_type = 'PPT_DOWNLOAD' 
    GROUP BY user_id, username 
    HAVING download_count > 5;
"
```

---

## 5. Incident Response Playbooks

### 5.1 Compromised Officer Account
1. **Immediate Account Suspension:**
   ```bash
   docker compose exec -T db mysql -umoodle -p"${DB_PASS}" moodle -e "
       UPDATE mdl_user SET suspended = 1 WHERE username = 'TARGET_USERNAME';
   "
   ```
   *The dynamic session guard (`SEC-A05`) immediately revokes all active requests across the portal within 0 milliseconds.*
2. **Evict Active Sessions in Redis:**
   ```bash
   docker compose exec -T redis redis-cli -a "${REDIS_PASSWORD}" KEYS "*sess*" | xargs -r docker compose exec -T redis redis-cli -a "${REDIS_PASSWORD}" DEL
   ```
3. **Forensic Query:**
   Trace all actions performed by the compromised account from `mdl_ek_audit`:
   ```bash
   docker compose exec -T db mysql -umoodle -p"${DB_PASS}" moodle -e "
       SELECT event_type, target_type, target_id, ip_address, created_at, details 
       FROM mdl_ek_audit 
       WHERE username = 'TARGET_USERNAME' 
       ORDER BY id DESC;
   "
   ```

### 5.2 Content Leakage Attribution
If restricted slide decks or lecture recordings are photographed or leaked:
1. Review the dynamic forensic watermark visible on the classroom viewer.
2. The watermark renders: `RESTRICTED // OTC LUCKNOW // [OFFICER SERVICE ID] // [CLIENT IP] // [TIMESTAMP]`.
3. Cross-reference the Service ID and timestamp against `mdl_ek_audit` event records for `MEDIA_STREAM` and `PPT_DOWNLOAD`.

### 5.3 Disaster Recovery & Encrypted Backup Restore Drill
Backups are created automatically using `scripts/backup.sh` (AES-256-CBC encrypted, SHA-256 verified):
```bash
# 1. Run backup
./scripts/backup.sh

# 2. Restore drill: Decrypt and inspect backup archive
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
    -in backups/ekalavya_backup_TIMESTAMP.tar.enc \
    -pass pass:"${DB_PASS}" | tar -tvf -

# 3. Restore database if needed
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
    -in backups/ekalavya_backup_TIMESTAMP.tar.enc \
    -pass pass:"${DB_PASS}" | tar -xOf - database.sql | \
    docker compose exec -T db mysql -umoodle -p"${DB_PASS}" moodle
```

---

## 6. Developer Safe API Onboarding Checklist

When introducing new endpoints into `api/index.php`:
- [ ] **Authentication Required:** Call `$currentUser = require_auth();` as the first line of the endpoint.
- [ ] **Role Authorization:** If the endpoint is restricted, call `require_role(['instituteadmin'])` or verify course access using `require_course_access($mysqli, $currentUser, $courseId, 'manage')`.
- [ ] **Anti-CSRF Verification:** State-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) are automatically validated via `require_csrf_token($action)` in the micro-router. Ensure the frontend passes `X-CSRF-Token`.
- [ ] **Content-Type Enforced:** All mutating endpoints require `Content-Type: application/json` (or `multipart/form-data` for file uploads).
- [ ] **Parameterized SQL Queries:** Never interpolate variables into SQL strings. Use prepared statements with `$stmt->bind_param()`.
- [ ] **Input Whitelisting:** Validate all input fields against strict regex whitelist patterns (`preg_match`).
- [ ] **Audit Logging:** Record successful mutations and security-sensitive read operations using `log_audit_event($mysqli, $eventType, $targetType, $targetId, $details, 'SUCCESS', $currentUser);`. Never pass passwords or tokens into `$details`.
- [ ] **Frontend Safe Injection:** Never inject user-controlled input into `innerHTML` without passing through `esc()` or `escJs()`. Prefer `textContent` or `document.createElement()`.
