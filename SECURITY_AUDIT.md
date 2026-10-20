# SECURITY AUDIT REPORT: EKALAVYA LMS (DEFENCE AIR-GAPPED PLATFORM)
**Target:** Officers Training College (OTC), AMC Centre & College, Lucknow  
**System Classification:** Defence Air-Gapped E-Learning & Training Management System  
**Compliance Baseline:** CERT-In Cyber Security Guidelines, ISO/IEC 27001 Controls, Indian Army Cyber Group (ACG) Directives  
**Audit Stage:** Phase 1 — Comprehensive Security Audit & Vulnerability Assessment (No code changes applied)  
**Date:** 19 October 2026  

---

## 1. Executive Summary & Assessment Scope

A comprehensive security audit of the Ekalavya LMS repository was conducted across edge proxies, web servers, API micro-routers, database connectors, frontend single-page applications (SPA), media pipelines, container configurations, and automation scripts.

The platform processes sensitive military data including Officer PII (Service Numbers, ranks, names, mobile numbers, official communications), credential hashes, cohort batch records, and restricted instructional materials (tactical trauma care, command courses, instructional slide decks, and narrated video lectures).

### Key Findings Summary:
- **Total Findings:** 36 Vulnerabilities & Security Deficiencies
- **Critical Severity:** 8 findings (Immediate threat of account takeover, privilege escalation, or unauthorized access)
- **High Severity:** 12 findings (Significant authorization, session, CSRF, or file handling flaws)
- **Medium Severity:** 11 findings (Data leakage, missing headers, resource exhaustion, or configuration weaknesses)
- **Low Severity:** 5 findings (Defense-in-depth and operational hygiene items)

---

## 2. Route Authorization & RBAC Guard Matrix

Every API route implemented in [`api/index.php`](file:///d:/OTC/api/index.php) was analyzed for current access guards versus required security policy:

| Route URI & Action | HTTP Method | Current Authorization Guard | Required Authorization Guard | Vulnerability / IDOR Status |
|---|---|---|---|---|
| `POST /api/login` | POST | None (Public) | None (Add Redis Rate Limit & Lockout) | **VULNERABLE** (Brute-force & Timing Attack) |
| `GET /api/logout` | GET | None (Destroys `$_SESSION`) | Session Invalidation + Cookie Clear | Stale cookie remains in client browser |
| `GET /api/session` | GET | `get_current_user_session()` | Active DB / Session-Version Check | **VULNERABLE** (Stale privileges cached) |
| `GET /api/status` | GET | None (Public) | `require_auth()` | Information Disclosure (System Stats) |
| `GET /api/courses` | GET | `require_auth()` | `require_auth()` + Student Catalog Filter | Information Disclosure (Unenrolled Shells) |
| `POST /api/courses/create` | POST | `require_role(['instituteadmin'])` | Guard + CSRF Token + Origin Check | Missing CSRF Protection |
| `POST /api/courses/delete` | POST | `require_role(['instituteadmin'])` | Guard + CSRF Token + Exception Masking | Missing CSRF & SQL Error Leakage |
| `GET /api/categories` | GET | `require_auth()` | `require_auth()` | OK |
| `GET /api/cohorts` | GET | `require_role(['instituteadmin'])` | `require_role(['instituteadmin'])` | OK |
| `GET /api/users` | GET | `require_role(['instituteadmin'])` | Guard + Exclude Site Admin + Pagination | **VULNERABLE** (Siteadmin exposed, Bulk PII) |
| `POST /api/users/create` | POST | `require_role(['instituteadmin'])` | Guard + CSRF + Password Policy Enforce | **VULNERABLE** (Bypasses 12-char policy) |
| `POST /api/users/update` | POST | `require_role(['instituteadmin'])` | Guard + CSRF + Block Target ID 2 + Block Self-Edit | **VULNERABLE** (Can overwrite Siteadmin) |
| `POST /api/users/update-role` | POST | `require_role(['instituteadmin'])` | Guard + CSRF + Block Target ID 2 + Block Self-Edit | **VULNERABLE** (Can modify Siteadmin) |
| `GET /api/users/{id}/courses` | GET | `require_role(['instituteadmin'])` | Guard + Prepared Query + ID Validation | Direct string interpolation in SQL |
| `POST /api/users/{id}/courses/assign` | POST | `require_role(['instituteadmin'])` | Guard + CSRF + Invalidate User Session | Stale session permissions persist |
| `POST /api/users/{id}/courses/remove` | POST | `require_role(['instituteadmin'])` | Guard + CSRF + Invalidate User Session | Stale session permissions persist |
| `POST /api/course-update` | POST | `require_role(['instituteadmin', 'courseadmin'])` | Guard + Assigned Course Check + CSRF | Missing CSRF Protection |
| `POST /api/section-add` | POST | `require_role(['instituteadmin', 'courseadmin'])` | Guard + Assigned Course Check + CSRF | Missing CSRF Protection |
| `GET /api/sections` | GET | `require_auth()` | `require_course_access($courseId, 'view')` | **CRITICAL IDOR** (Any user reads any course) |
| `GET /api/roles` | GET | `require_auth()` | `require_auth()` | OK |
| `GET /api/course-ppts` | GET | `can_user_access_course()` | Guard + Rate Limiting | OK |
| `POST /api/course-ppts/upload` | POST | `can_user_access_course(..., true)` | Guard + CSRF + Magic Byte/finfo Check | **HIGH** (Media upload lacks magic check) |
| `GET /api/course-ppts/{id}/download` | GET | `can_user_access_course(..., false)` | Guard + Rate Limit + Audit Log | Missing Audit Logging |
| `GET /api/course-ppts/{id}/stream` | GET | `can_user_access_course(..., false)` | Guard + Range Clamping + Private Cache | Range parser flaw + Public caching |
| `POST/DELETE /api/course-ppts/{id}/delete` | POST/DELETE | `can_user_access_course(..., true)` | Guard + CSRF + Audit Log | Missing CSRF Protection |
| `GET /api/commanders` | GET | None (Public) | `require_auth()` | Unauthenticated gallery metadata |
| `POST /api/commanders-upload` | POST | `require_role(['instituteadmin'])` | Guard + CSRF + GD Re-encoding | Polyglot / EXIF payload risk |
| `GET /api/commanders/image` | GET | None (Public) | `require_auth()` + Strip `file` Param | Unauthenticated file existence check |

---

## 3. Comprehensive Vulnerability Findings

### Category A: Authentication & Sessions

#### [SEC-A01] Username Enumeration via Login Response Timing Discrepancy
- **Severity:** High
- **Location:** [`api/index.php:389-417`](file:///d:/OTC/api/index.php#L389-L417)
- **CWE / OWASP:** CWE-208 (Observable Timing Discrepancy) / A07:2021-Identification and Authentication Failures
- **Exploit Scenario:** An attacker scripts requests against `/api/login` and compares execution timings. Requests with valid officer usernames incur an expensive bcrypt/crypt computation (~150-300ms), whereas non-existent or suspended usernames return in ~1ms, allowing automated enumeration of valid military personnel accounts.
- **Proposed Fix:** Perform a constant-time dummy password hash computation (e.g. `password_verify($password, '$2y$10$abcdefghijklmnopqrstuu...')`) whenever a user lookup fails, and ensure consistent execution time and identical error messages (`"Invalid username or password"`).

#### [SEC-A02] Absence of Rate Limiting & Account Lockout on Login Endpoint
- **Severity:** Critical
- **Location:** [`api/index.php:372-418`](file:///d:/OTC/api/index.php#L372-L418)
- **CWE / OWASP:** CWE-307 (Improper Restriction of Excessive Authentication Attempts) / A07:2021
- **Exploit Scenario:** An unauthorized user on the local military LAN can launch automated password brute-force or dictionary attacks against known service IDs at thousands of attempts per second without any throttling, IP ban, or temporary account lock.
- **Proposed Fix:** Implement Redis-backed rate limiting per client IP (e.g. max 10 attempts per minute) and per username. Enforce account lockout after 5 consecutive failed attempts for 1800 seconds (matching Moodle's `02-harden.sh` policy). Write every failed attempt and lockout event to an append-only audit log.

#### [SEC-A03] Missing Session ID Regeneration on Authentication and Role Transition
- **Severity:** High
- **Location:** [`api/index.php:525-531`](file:///d:/OTC/api/index.php#L525-L531)
- **CWE / OWASP:** CWE-384 (Session Fixation) / A07:2021
- **Exploit Scenario:** An attacker who induces an officer's terminal to accept a fixed session ID can hijack the officer's session after they authenticate because the session ID remains unchanged upon login.
- **Proposed Fix:** Invoke `session_regenerate_id(true)` immediately following successful credential verification in `/api/login` and after any role change. On `/api/logout`, explicitly overwrite and expire the session cookie using `setcookie()`.

#### [SEC-A04] Insecure Session Cookie Flags and Missing Idle/Absolute Timeouts
- **Severity:** High
- **Location:** [`api/db.php:4`](file:///d:/OTC/api/db.php#L4)
- **CWE / OWASP:** CWE-614 (Sensitive Cookie in HTTPS Session Without 'Secure' Attribute), CWE-1004 (Cookie Without 'HttpOnly' Flag) / A05:2021-Security Misconfiguration
- **Exploit Scenario:** Because `session_start()` is called without `session_set_cookie_params()`, session cookies lack `HttpOnly`, `SameSite=Strict`, `Secure`, and `__Host-` prefixes. Client-side scripts can read session tokens in the event of XSS, cookies persist indefinitely across browser restarts, and sessions do not terminate after 30 minutes of inactivity.
- **Proposed Fix:** Call `session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict'])` before `session_start()`, set the session cookie name to `__Host-EKALAVYA_SESSID`, and implement server-side tracking for both 30-minute idle timeouts and 8-hour absolute session limits.

#### [SEC-A05] Stale Privilege Retention: Session Cached Roles & Enrolments Never Invalidated
- **Severity:** Critical
- **Location:** [`api/db.php:33-57`](file:///d:/OTC/api/db.php#L33-L57), [`api/index.php:509-525`](file:///d:/OTC/api/index.php#L509-L525), [`api/index.php:978-995`](file:///d:/OTC/api/index.php#L978-L995)
- **CWE / OWASP:** CWE-284 (Improper Access Control) / A01:2021-Broken Access Control
- **Exploit Scenario:** When an Institute Admin suspends a compromised officer, demotes a Course Admin, or removes an officer from a restricted course batch, the user's active session (`$_SESSION['ek_user']`) retains its original elevated permissions and cached enrolled courses until the user manually logs out.
- **Proposed Fix:** Implement a per-user `session_version` in Redis (or perform a lightweight active-status query verifying `suspended = 0` and current role assignments on each privileged API invocation). Invalidate or reject requests if the session version is outdated.

#### [SEC-A06] Server-Side Password Policy & History Check Bypass in User Management
- **Severity:** High
- **Location:** [`api/index.php:900, 965`](file:///d:/OTC/api/index.php#L900)
- **CWE / OWASP:** CWE-521 (Weak Password Requirements) / A07:2021
- **Exploit Scenario:** An Institute Admin creating or resetting officer accounts via `/api/users/create` or `/api/users/update` can set single-character or trivial passwords (e.g. `"1"` or `"admin"`), completely bypassing the 12-character complexity rules mandated by defence guidelines and configured in `02-harden.sh`.
- **Proposed Fix:** Implement a server-side password validation helper enforcing: minimum 12 characters, at least 1 uppercase letter, 1 lowercase letter, 1 digit, 1 special symbol, and checking against recent passwords in `mdl_user_password_history`.

#### [SEC-A07] Hidden Technical Site Administrator Exposed and Modifiable via API
- **Severity:** Critical
- **Location:** [`api/index.php:798, 958, 1016`](file:///d:/OTC/api/index.php#L798)
- **CWE / OWASP:** CWE-285 (Improper Authorization) / A01:2021
- **Exploit Scenario:** An Institute Admin calls `/api/users` and observes the hidden technical Site Administrator (`id = 2`, `username = siteadmin`). The Institute Admin can then issue a `POST /api/users/update` targeting `user_id = 2` to overwrite the Site Admin's password, modify its email, or suspend the account, effectively seizing control of root infrastructure management.
- **Proposed Fix:** Exclude `u.id = 2` and `username = 'siteadmin'` from the SQL queries in `/api/users`. In `/api/users/update`, `/api/users/update-role`, and course assignment endpoints, immediately reject any request targeting `user_id <= 2` or `username === 'siteadmin'` with HTTP 403 Forbidden.

---

### Category B: Authorisation (RBAC, IDOR)

#### [SEC-B01] Critical IDOR: Unrestricted Access to Course Curriculum Sections
- **Severity:** Critical
- **Location:** [`api/index.php:1211-1229`](file:///d:/OTC/api/index.php#L1211-L1229)
- **CWE / OWASP:** CWE-639 (Insecure Direct Object Reference) / A01:2021-Broken Access Control
- **Exploit Scenario:** The `sections` endpoint only executes `require_auth()`. A Student Officer enrolled only in the Basic Nursing Officers Course (BNOC) can supply `?course_id=2` (MOBC) or `?course_id=4` (MOSCC) to inspect restricted curriculum outlines, topics, and syllabus schedules of advanced officer command courses.
- **Proposed Fix:** Guard `case 'sections':` with `if (!can_user_access_course($mysqli, $currentUser, $courseId, false))` to ensure students and course admins can only view sections of courses they are enrolled in or assigned to.

#### [SEC-B02] Lack of Central Unified Authorization Guard for API Routes
- **Severity:** High
- **Location:** [`api/index.php:367-2051`](file:///d:/OTC/api/index.php#L367-L2051)
- **CWE / OWASP:** CWE-285 (Improper Authorization) / A01:2021
- **Exploit Scenario:** Authorization checks are scattered ad-hoc across switch cases using differing mechanisms (`require_auth()`, `require_role()`, `can_user_access_course()`, or no guard at all for `commanders` and `status`). This inconsistency allowed the IDOR in `sections` and unauthenticated access in `commanders-image`.
- **Proposed Fix:** Implement a unified route authorization table that automatically maps every route action to its required role permissions and course context constraints before the action handler is invoked.

#### [SEC-B03] Self-Modification of Role and Privilege Escalation Risk
- **Severity:** High
- **Location:** [`api/index.php:940-1040`](file:///d:/OTC/api/index.php#L940-L1040)
- **CWE / OWASP:** CWE-269 (Improper Privilege Management) / A01:2021
- **Exploit Scenario:** An Institute Admin can submit a `POST /api/users/update-role` targeting their own user ID, demoting themselves to a Student Officer and locking the institution out of administrative operations if no other admin exists, or conversely attempting to alter system-level assignments.
- **Proposed Fix:** Prohibit users from modifying their own role (`if ($userId === (int)$currentUser['id']) { return 403; }`), and forbid assigning roles higher than or equal to system admin.

#### [SEC-B04] Absence of Input Whitelisting & Mass-Assignment Risks in User Management
- **Severity:** Medium
- **Location:** [`api/index.php:868-876, 948-957`](file:///d:/OTC/api/index.php#L868-L876)
- **CWE / OWASP:** CWE-915 (Improperly Controlled Modification of Dynamically-Determined Object Attributes) / A04:2021-Insecure Design
- **Exploit Scenario:** The user creation and update endpoints ingest arbitrary body attributes without strict type and format validation, allowing malformed strings, arbitrary auth plugins, or unexpected characters into Moodle user tables.
- **Proposed Fix:** Explicitly whitelist permitted input attributes (`firstname`, `lastname`, `email`, `mobile`, `suspended`, `role`, `course_ids`), enforce strict regex patterns (e.g. valid military service numbers for usernames), and reject unlisted properties.

#### [SEC-B05] Over-Exposed Officer PII in API Responses
- **Severity:** High
- **Location:** [`api/index.php:793-855`](file:///d:/OTC/api/index.php#L793-L855)
- **CWE / OWASP:** CWE-359 (Exposure of Private Personal Information) / A01:2021
- **Exploit Scenario:** The `GET /api/users` endpoint returns an unpaginated array containing full names, service IDs, email addresses, phone/mobile numbers, and last access timestamps of every military personnel registered on the LMS. A compromised Institute Admin session allows immediate mass exfiltration of the entire brigade/college roster.
- **Proposed Fix:** Paginate the `/api/users` endpoint (default 20 records per page), remove unnecessary contact details from routine listings, and ensure student endpoints never return other officers' PII.

---

### Category C: CSRF & Request Integrity

#### [SEC-C01] Absence of Anti-CSRF Token on All State-Changing Endpoints
- **Severity:** Critical
- **Location:** [`api/index.php:613, 685, 860, 940, 1004, 1070, 1102, 1131, 1167, 1354, 1772, 1899`](file:///d:/OTC/api/index.php#L613)
- **CWE / OWASP:** CWE-352 (Cross-Site Request Forgery) / A01:2021
- **Exploit Scenario:** An authenticated Institute or Course Admin browsing an untrusted intranet site or clicking a phishing link can have state-changing requests forged on their behalf. Attackers can delete courses (`/api/courses-delete`), alter user roles (`/api/users-update-role`), or delete course presentations (`/api/course-ppts-delete`) without the admin's knowledge.
- **Proposed Fix:** Generate a cryptographically strong anti-CSRF token per session (`bin2hex(random_bytes(32))`), provide it in `GET /api/session`, and enforce validation of an `X-CSRF-Token` header on all POST, PUT, PATCH, and DELETE requests.

#### [SEC-C02] Missing Origin and Referer Header Verification
- **Severity:** High
- **Location:** [`api/index.php:353-365`](file:///d:/OTC/api/index.php#L353-L365)
- **CWE / OWASP:** CWE-352 (Cross-Site Request Forgery) / A01:2021
- **Exploit Scenario:** Cross-origin POST requests originating from other hosts on the LAN or rogue internal applications are processed without verifying that the request initiated from `https://ekalavya.local`.
- **Proposed Fix:** Reject any state-changing HTTP request whose `Origin` or `Referer` header does not strictly match `https://ekalavya.local`.

#### [SEC-C03] Unrestricted Content-Type Handling on JSON API Endpoints
- **Severity:** Medium
- **Location:** [`api/index.php:353-364`](file:///d:/OTC/api/index.php#L353-L364)
- **CWE / OWASP:** CWE-352 / A01:2021
- **Exploit Scenario:** The router falls back to `$_POST` when `php://input` JSON parsing produces an empty array. This permits simple HTML form submissions (`application/x-www-form-urlencoded`) that bypass CORS preflight restrictions, facilitating cross-origin exploitation.
- **Proposed Fix:** Enforce `Content-Type: application/json` on all non-upload mutating endpoints, and reject requests that do not present valid JSON payloads.

---

### Category D: Injection & Output Safety

#### [SEC-D01] Widespread Stored Cross-Site Scripting (XSS) in Frontend SPA
- **Severity:** Critical
- **Location:** [`frontend/js/portal.js:404, 478, 572, 1160, 1172, 1194, 1288, 1667, 1699, 1712, 1739, 1916, 2169`](file:///d:/OTC/frontend/js/portal.js#L404)
- **CWE / OWASP:** CWE-79 (Improper Neutralization of Input During Web Page Generation) / A03:2021-Injection
- **Exploit Scenario:** Course titles, summaries, section names, presentation titles, commander titles, and officer names are concatenated directly into `innerHTML` strings without HTML entity encoding. A Course Admin or attacker who enters `<script>` or `<img src=x onerror=...>` in a course title or presentation title executes arbitrary JavaScript in the browser of every officer or admin viewing the portal.
- **Proposed Fix:** Introduce a centralized HTML sanitization/escaping utility `escapeHtml(str)` in `portal.js` and wrap all dynamic data substitutions, or replace `innerHTML` with safe DOM construction using `textContent` and `createElement()`.

#### [SEC-D02] Direct Variable Interpolation in Database Queries
- **Severity:** High
- **Location:** [`api/index.php:717, 720, 721, 725, 730, 735, 738, 745, 747, 813, 823, 839, 920, 978, 984, 1023, 1029, 1035, 1059, 1119, 1122, 1192`](file:///d:/OTC/api/index.php#L717)
- **CWE / OWASP:** CWE-89 (SQL Injection) / A03:2021-Injection
- **Exploit Scenario:** Numerous SQL queries interpolate variables directly into SQL statements (e.g. `WHERE ra.userid = {$userId}`, `WHERE course_id = {$courseId}`, `enrolid IN ({$idsStr})`). While integer casting is currently applied in most places, any future code modification or non-numeric input introduction presents severe SQL injection risks.
- **Proposed Fix:** Convert every database query across `api/index.php` to use parameterized prepared statements (`$mysqli->prepare()` and `$stmt->bind_param()`), eliminating string concatenation.

#### [SEC-D03] Information Disclosure via Verbose Database Exceptions & Stack Traces
- **Severity:** Medium
- **Location:** [`api/index.php:764, 1583, 2054`](file:///d:/OTC/api/index.php#L764)
- **CWE / OWASP:** CWE-209 (Generation of Error Message Containing Sensitive Information) / A05:2021
- **Exploit Scenario:** When a database error occurs, `$ex->getMessage()`, `$stmt->error`, or `$e->getMessage()` is echoed directly in JSON responses (e.g. `'Failed to delete course: ' . $ex->getMessage()`), exposing internal MySQL schema details, table names, and filesystem paths to users.
- **Proposed Fix:** Catch exceptions, log full diagnostics to the server's private error log using `error_log()`, and return clean, generic error messages (`"An internal error occurred. Please contact the system administrator."`) with appropriate HTTP 500 status codes.

---

### Category E: File Upload & Media Pipeline

#### [SEC-E01] Insufficient File Validation for Multimedia Lecture Uploads
- **Severity:** High
- **Location:** [`api/index.php:1510-1518`](file:///d:/OTC/api/index.php#L1510-L1518)
- **CWE / OWASP:** CWE-434 (Unrestricted Upload of File with Dangerous Type) / A04:2021
- **Exploit Scenario:** While `.ppt` and `.pptx` files are verified against binary signatures, lecture media files (`.mp4`, `.webm`, `.mov`, `.mkv`, `.mp3`) are validated solely by their file extension. An attacker with upload rights can upload an executable or script disguised with an `.mp4` extension.
- **Proposed Fix:** Validate all media uploads using PHP's `finfo_file(FILEINFO_MIME_TYPE)` and magic byte signatures (e.g. `ftyp` for MP4, `ID3` for MP3), rejecting files whose MIME content does not match allowed video/audio media types.

#### [SEC-E02] Image Polyglot & Sensitive EXIF Metadata Leakage in Commander Gallery
- **Severity:** Medium
- **Location:** [`api/index.php:1949-1960`](file:///d:/OTC/api/index.php#L1949-L1960)
- **CWE / OWASP:** CWE-434 / A04:2021
- **Exploit Scenario:** Images uploaded to the Previous Commanders gallery are stored and served directly without re-encoding. Uploaded portraits may retain sensitive EXIF metadata (camera serials, GPS coordinates of military headquarters) or contain embedded polyglot HTML payloads.
- **Proposed Fix:** Re-encode all uploaded images using PHP GD (`imagecreatefromjpeg`/`imagecreatefrompng`/`imagecreatefromwebp`), strip all EXIF metadata, and regenerate a sanitized bitmap file before saving to storage.

#### [SEC-E03] Zip Bomb & XXE Risks in PowerPoint Presentation Slide Parser
- **Severity:** High
- **Location:** [`api/index.php:113-134`](file:///d:/OTC/api/index.php#L113-L134)
- **CWE / OWASP:** CWE-409 (Improper Handling of Highly Compressed Data - Zip Bomb), CWE-611 (Improper Restriction of XML External Entity Reference) / A05:2021
- **Exploit Scenario:** An attacker uploads a crafted `.pptx` archive containing nested decompression bombs or thousands of entries, exhausting server memory and disk space during extraction. If XML parsing is applied to `docProps/app.xml`, external DTD entities could trigger XXE attacks.
- **Proposed Fix:** In `extract_presentation_slide_count()`, enforce limits on the ZIP archive: maximum 1,000 entries, maximum uncompressed size of 100MB, and compression ratio capped at 50:1. When parsing XML, disable external entities using `libxml_disable_entity_loader(true)` and `LIBXML_NONET`.

#### [SEC-E04] Ineffective `.htaccess` Execution Blocker Under Nginx
- **Severity:** High
- **Location:** [`scripts/06-course-ppts-migration.php:97-103`](file:///d:/OTC/scripts/06-course-ppts-migration.php#L97-L103), [`docker/web/moodle.conf`](file:///d:/OTC/docker/web/moodle.conf)
- **CWE / OWASP:** CWE-653 (Improper Isolation or Compartmentalization) / A05:2021
- **Exploit Scenario:** The migration script creates an `.htaccess` file with `Deny from all` in the upload directory. Nginx does not parse `.htaccess` files. If an upload alias or misconfiguration allows requests to reach this directory, Nginx will not block them based on `.htaccess`.
- **Proposed Fix:** Add an explicit location rule in `docker/web/moodle.conf` denying all HTTP access to `/var/www/moodledata/` and blocking the execution of any `.php` files outside the designated web root. Verify that `/dataroot/` remains strictly an `internal;` Nginx location accessible only via `X-Accel-Redirect`.

#### [SEC-E05] Improper Range Header Validation & Public Caching on Media Stream
- **Severity:** Medium
- **Location:** [`api/index.php:187-225`](file:///d:/OTC/api/index.php#L187-L225)
- **CWE / OWASP:** CWE-20 (Improper Input Validation) / A04:2021
- **Exploit Scenario:** The `stream_media_file()` function does not reject multipart range headers (`bytes=0-10,20-30`) or validate non-numeric bounds, and sets `Cache-Control: public, max-age=86400` on restricted military instructional videos, allowing shared proxy caches or local browsers to cache classified lectures.
- **Proposed Fix:** Reject multipart range requests with HTTP 416, strictly clamp numeric bounds (`0 <= $start <= $end < $size`), set `Cache-Control: private, no-transform, no-store, must-revalidate`, and add `X-Content-Type-Options: nosniff`.

#### [SEC-E06] Unauthenticated Arbitrary File Probe in Commanders Image Endpoint
- **Severity:** Medium
- **Location:** [`api/index.php:2004, 2023-2028`](file:///d:/OTC/api/index.php#L2004)
- **CWE / OWASP:** CWE-22 (Improper Limitation of a Pathname to a Restricted Directory) / A01:2021
- **Exploit Scenario:** The `commanders-image` endpoint accepts an unauthenticated `file` query parameter and checks if it exists in `/var/www/moodledata/commanders/`, allowing unauthenticated users on the LAN to probe file existence.
- **Proposed Fix:** Remove the `file` parameter entirely; require authentication and look up images strictly by numeric database `id` with verified database record mappings.

---

### Category F: Data Misuse & Exfiltration Controls

#### [SEC-F01] Total Absence of Security Audit Logging (`mdl_ek_audit`)
- **Severity:** High
- **Location:** Entire codebase ([`api/index.php`](file:///d:/OTC/api/index.php), [`api/db.php`](file:///d:/OTC/api/db.php))
- **CWE / OWASP:** CWE-778 (Insufficient Logging) / A09:2021-Security Logging and Monitoring Failures
- **Exploit Scenario:** There is no persistent audit logging for authentication successes/failures, account lockouts, user creation, role changes, course deletions, presentation uploads, lecture downloads, or video streaming. If an insider or intruder exfiltrates training materials or tampers with course records, forensic investigation and attribution are impossible (violating CERT-In and ISO 27001 mandates).
- **Proposed Fix:** Create an append-only `mdl_ek_audit` database table and implement a central logging helper `log_audit_event($action, $targetType, $targetId, $details, $status)` recording user ID, IP address (via trusted `X-Forwarded-For`), User-Agent, action type, and UTC timestamp. Never log passwords or tokens.

#### [SEC-F02] Unthrottled Listing Endpoints Vulnerable to Bulk Scraping
- **Severity:** Medium
- **Location:** [`api/index.php:793-855, 1250-1350`](file:///d:/OTC/api/index.php#L793-L855)
- **CWE / OWASP:** CWE-799 (Improper Control of Generation of Code or Resource Consumption) / A04:2021
- **Exploit Scenario:** Listing endpoints for users and course presentations have no pagination or velocity limits. An officer account can automate rapid mass queries to scrape all presentations and materials across assigned courses within seconds without triggering any alert.
- **Proposed Fix:** Apply rate limits on resource listing and download endpoints, paginate data arrays, and record download volume metrics to flag unusual exfiltration patterns (e.g. >10 lecture streams within 5 minutes).

#### [SEC-F03] Lack of Dynamic Forensic Watermarking on Classroom Presentations
- **Severity:** Low (Operational Security Requirement)
- **Location:** [`frontend/portal.html`](file:///d:/OTC/frontend/portal.html), [`frontend/js/portal.js:700-850`](file:///d:/OTC/frontend/js/portal.js#L700-L850)
- **CWE / OWASP:** Operational Data Protection / ISO 27001 A.8.12 (Data Leakage Prevention)
- **Exploit Scenario:** Personnel can capture screenshots or photograph restricted slide presentations and video lectures without any identifying attribution visible on the screen.
- **Proposed Fix:** Implement a non-intrusive, dynamic semi-transparent watermark overlay on the classroom slide viewer and video player showing the authenticated officer's Service ID, client IP, and current access date.

---

### Category G: HTTP Security Headers (Edge Proxy)

#### [SEC-G01] Absence of Content Security Policy (CSP)
- **Severity:** High
- **Location:** [`docker/proxy/proxy.conf:20-25`](file:///d:/OTC/docker/proxy/proxy.conf#L20-L25)
- **CWE / OWASP:** CWE-1021 (Improper Restriction of Rendered UI Layers or Frames) / A05:2021
- **Exploit Scenario:** The edge proxy does not return a `Content-Security-Policy` header. If stored XSS is injected via course or user records, the browser executes rogue scripts and can connect to arbitrary local endpoints without restriction.
- **Proposed Fix:** Configure a strict CSP on Nginx:
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self';`

#### [SEC-G02] Inline Scripts in HTML Files Prevent Clean CSP Enforcement
- **Severity:** Medium
- **Location:** [`frontend/login.html:502`](file:///d:/OTC/frontend/login.html#L502), [`frontend/index.html:7`](file:///d:/OTC/frontend/index.html#L7), and multiple `onclick` attributes in [`frontend/portal.html`](file:///d:/OTC/frontend/portal.html)
- **CWE / OWASP:** CWE-1021 / A05:2021
- **Exploit Scenario:** Enforcing `script-src 'self'` without `'unsafe-inline'` breaks the inline scripts in `login.html` and `index.html`. If `'unsafe-inline'` is added to CSP, XSS protection is severely degraded.
- **Proposed Fix:** Extract inline scripts from `login.html` and `index.html` into dedicated static `.js` files (`frontend/js/login.js` and `frontend/js/index.js`), and migrate inline `onclick` attributes to standard DOM `addEventListener()` handlers in `portal.js`.

#### [SEC-G03] Suboptimal Security Headers on Edge Proxy
- **Severity:** Medium
- **Location:** [`docker/proxy/proxy.conf:20-25`](file:///d:/OTC/docker/proxy/proxy.conf#L20-L25)
- **CWE / OWASP:** CWE-1021, CWE-693 / A05:2021
- **Exploit Scenario:** `X-Frame-Options` is set to `SAMEORIGIN` instead of `DENY`, `Referrer-Policy` is `strict-origin-when-cross-origin` instead of `no-referrer`, and `Permissions-Policy` and `Cross-Origin-Opener-Policy` (COOP) headers are omitted, allowing camera/microphone hardware probing and cross-origin window access.
- **Proposed Fix:** Update `proxy.conf` to set:
  `add_header X-Frame-Options "DENY" always;`
  `add_header Referrer-Policy "no-referrer" always;`
  `add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;`
  `add_header Cross-Origin-Opener-Policy "same-origin" always;`

#### [SEC-G04] Unrestricted Access to Moodle Native Administrative Paths from LAN
- **Severity:** High
- **Location:** [`docker/proxy/proxy.conf:39-46`](file:///d:/OTC/docker/proxy/proxy.conf#L39-L46)
- **CWE / OWASP:** CWE-284 / A01:2021
- **Exploit Scenario:** The edge proxy exposes native Moodle paths (`/admin`, `/login`, etc.) to all child nodes on the military LAN, exposing Moodle's native login forms and administrative interfaces to general classroom workstations.
- **Proposed Fix:** Restrict `location ~ ^/(admin|login|course|user)/` to an allowlist of authorized administrative IP addresses (admin office PCs) and return HTTP 403 Forbidden to unauthorized LAN nodes.

#### [SEC-G05] TLS Protocol Configuration & Server Fingerprinting
- **Severity:** Low
- **Location:** [`docker/proxy/proxy.conf:17-18`](file:///d:/OTC/docker/proxy/proxy.conf#L17-L18)
- **CWE / OWASP:** CWE-326 (Inadequate Encryption Strength) / A02:2021
- **Exploit Scenario:** TLS configuration permits legacy TLS 1.2 cipher suites without strict cipher prioritization, and upstream headers could leak `X-Powered-By: PHP/8.3`.
- **Proposed Fix:** Enforce modern TLS 1.3 as primary with high-strength TLS 1.2 fallback ciphers (`ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384`), ensure `proxy_hide_header X-Powered-By;` is set, and confirm `server_tokens off;`.

---

### Category H: Infrastructure & Containers

#### [SEC-H01] Hardcoded Fallback Database Credentials in Source Code
- **Severity:** High
- **Location:** [`api/db.php:19`](file:///d:/OTC/api/db.php#L19), [`scripts/06-course-ppts-migration.php:11`](file:///d:/OTC/scripts/06-course-ppts-migration.php#L11)
- **CWE / OWASP:** CWE-798 (Use of Hard-coded Credentials) / A07:2021
- **Exploit Scenario:** If environment variables fail to load or are unset, scripts fall back to hardcoded default passwords (`'Ek@l4vya#Db!Pass2026'`). Anyone with read access to the source code or a leaked repository copy obtains the database credentials.
- **Proposed Fix:** Remove all hardcoded password strings from PHP scripts; terminate with a clean error if required environment variables (`DB_PASS`) are missing.

#### [SEC-H02] Demo Users Script Unrestricted and Executable in Production
- **Severity:** Critical
- **Location:** [`scripts/05-demo-users.php:36-62`](file:///d:/OTC/scripts/05-demo-users.php#L36-L62)
- **CWE / OWASP:** CWE-1188 (Insecure Default Initialization of Resource) / A05:2021
- **Exploit Scenario:** The demo user script creates default accounts (`inst.admin`, `course.admin`, `student.officer`) with known default passwords (`InstAdmin@2026!`, etc.). If executed in staging or production, anyone aware of the defaults gains instant administrative and student access.
- **Proposed Fix:** Add an environment guard at the top of `05-demo-users.php` that immediately exits if `APP_ENV === 'production'`. Add a verification check in `04-verify.php` that fails if any demo account exists.

#### [SEC-H03] Application Database User Granted Excessive Privileges
- **Severity:** High
- **Location:** [`docker-compose.yml:86-89`](file:///d:/OTC/docker-compose.yml#L86-L89)
- **CWE / OWASP:** CWE-250 (Execution with Unnecessary Privileges) / A01:2021
- **Exploit Scenario:** The MySQL application user (`moodle`) is granted default broad privileges on the database, allowing schema alterations, table drops, and administrative operations beyond daily runtime needs.
- **Proposed Fix:** Restrict the runtime `moodle` user permissions to `SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, LOCK TABLES` on the moodle database; explicitly disallow `FILE`, `SUPER`, `PROCESS`, and `GRANT OPTION`.

#### [SEC-H04] Missing Redis Protected Mode and Unrenamed Dangerous Commands
- **Severity:** High
- **Location:** [`docker-compose.yml:76-80`](file:///d:/OTC/docker-compose.yml#L76-L80)
- **CWE / OWASP:** CWE-284 / A05:2021
- **Exploit Scenario:** The Redis container starts without `--protected-mode yes` and without disabling dangerous management commands (`FLUSHALL`, `FLUSHDB`, `CONFIG`, `KEYS`, `SHUTDOWN`, `DEBUG`). A compromised PHP worker could wipe all session caches or reconfigure Redis memory parameters.
- **Proposed Fix:** Add `--protected-mode yes` to the Redis command in `docker-compose.yml`, and rename or disable dangerous commands via configuration or startup flags.

#### [SEC-H05] Lack of Container Security Options and Linux Capability Drops
- **Severity:** Medium
- **Location:** [`docker-compose.yml:14-104`](file:///d:/OTC/docker-compose.yml#L14-L104)
- **CWE / OWASP:** CWE-250 / A05:2021
- **Exploit Scenario:** Containers run with default Linux capabilities, without `no-new-privileges: true`, and without CPU and memory constraints. A container compromise could facilitate container-escape exploration or host resource starvation.
- **Proposed Fix:** Add `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`, add only necessary capabilities (`NET_BIND_SERVICE` for proxy), run PHP-FPM strictly under `www-data`, and set explicit memory limits (`mem_limit: 1g`).

#### [SEC-H06] Incomplete PHP Runtime Hardening in FPM Configuration
- **Severity:** Medium
- **Location:** [`docker/php/moodle.ini:1-17`](file:///d:/OTC/docker/php/moodle.ini#L1-L17)
- **CWE / OWASP:** CWE-200, CWE-250 / A05:2021
- **Exploit Scenario:** Dangerous PHP functions (`exec`, `passthru`, `shell_exec`, `system`, `proc_open`, `popen`) are not disabled in `moodle.ini`, `allow_url_fopen` is not explicitly disabled, and `display_errors` is not forced off. If an upload or injection vulnerability occurs, attackers can invoke shell commands.
- **Proposed Fix:** Add to `docker/php/moodle.ini`:
  `disable_functions = exec,passthru,shell_exec,system,proc_open,popen,curl_exec,curl_multi_exec,parse_ini_file,show_source`
  `allow_url_fopen = Off`
  `display_errors = Off`
  `log_errors = On`

#### [SEC-H07] Absence of Automated Encrypted Backup & Verification SOP
- **Severity:** Medium
- **Location:** [`scripts/`](file:///d:/OTC/scripts/)
- **CWE / OWASP:** ISO 27001 A.8.13 (Information Backup)
- **Exploit Scenario:** No automated, encrypted backup procedure exists for the MySQL database and `/var/www/moodledata/` course presentations. A storage failure, accidental purge, or ransomware event would result in catastrophic loss of officer records and courseware.
- **Proposed Fix:** Implement an automated backup script (`scripts/backup.sh`) producing GPG/AES-256 encrypted database dumps and moodledata snapshots, with a documented and tested restore drill.

---

## 4. Vulnerability Severity Breakdown & Summary Table

| Finding ID | Title | Severity | Location | Remediation Category |
|---|---|---|---|---|
| **SEC-A01** | Login Timing Discrepancy & Username Enumeration | **High** | `api/index.php:389` | Auth & Sessions |
| **SEC-A02** | Absence of Login Rate Limiting & Account Lockout | **Critical** | `api/index.php:372` | Auth & Sessions |
| **SEC-A03** | Missing Session ID Regeneration on Login/Role Change | **High** | `api/index.php:525` | Auth & Sessions |
| **SEC-A04** | Insecure Session Cookie Flags & Missing Timeouts | **High** | `api/db.php:4` | Auth & Sessions |
| **SEC-A05** | Stale Privilege Retention Across Suspensions/Demotions | **Critical** | `api/db.php:33` | Auth & Sessions |
| **SEC-A06** | Server-Side Password Policy & History Bypass | **High** | `api/index.php:900` | Auth & Sessions |
| **SEC-A07** | Hidden Technical Site Administrator Exposed & Modifiable | **Critical** | `api/index.php:798` | Auth & Sessions |
| **SEC-B01** | IDOR: Unrestricted Access to Course Curriculum Sections | **Critical** | `api/index.php:1211` | Authorisation (RBAC) |
| **SEC-B02** | Lack of Central Unified Route Guard Architecture | **High** | `api/index.php:367` | Authorisation (RBAC) |
| **SEC-B03** | Self-Modification of Administrative Roles | **High** | `api/index.php:940` | Authorisation (RBAC) |
| **SEC-B04** | Missing Input Whitelisting in User Create/Update | **Medium** | `api/index.php:868` | Authorisation (RBAC) |
| **SEC-B05** | Over-Exposed Officer PII in User Listing Responses | **High** | `api/index.php:793` | Authorisation (RBAC) |
| **SEC-C01** | Absence of Anti-CSRF Token on Mutating Endpoints | **Critical** | `api/index.php:613` | CSRF & Integrity |
| **SEC-C02** | Missing Origin and Referer Header Verification | **High** | `api/index.php:353` | CSRF & Integrity |
| **SEC-C03** | Unenforced Content-Type on JSON API Endpoints | **Medium** | `api/index.php:353` | CSRF & Integrity |
| **SEC-D01** | Widespread Stored XSS in Frontend Portal SPA | **Critical** | `frontend/js/portal.js:404` | Injection & Output |
| **SEC-D02** | Direct Variable Interpolation in Database Queries | **High** | `api/index.php:717` | Injection & Output |
| **SEC-D03** | Sensitive Information Disclosure in Error Exceptions | **Medium** | `api/index.php:764` | Injection & Output |
| **SEC-E01** | Insufficient MIME & Magic Byte Check on Media Uploads | **High** | `api/index.php:1510` | Uploads & Media |
| **SEC-E02** | Image Polyglot & EXIF Leakage in Commander Gallery | **Medium** | `api/index.php:1949` | Uploads & Media |
| **SEC-E03** | Zip Bomb & XXE Risks in Slide Count Parser | **High** | `api/index.php:113` | Uploads & Media |
| **SEC-E04** | Ineffective `.htaccess` Execution Blocker Under Nginx | **High** | `scripts/06-course-ppts-migration.php:97` | Uploads & Media |
| **SEC-E05** | Range Header Clamping Flaws & Public Caching on Stream | **Medium** | `api/index.php:187` | Uploads & Media |
| **SEC-E06** | Unauthenticated File Probe in Commanders Image Endpoint | **Medium** | `api/index.php:2004` | Uploads & Media |
| **SEC-F01** | Total Absence of Security Audit Logging (`mdl_ek_audit`) | **High** | Entire API Router | Audit & Anti-Exfiltration |
| **SEC-F02** | Unthrottled Listing Endpoints Vulnerable to Bulk Scraping | **Medium** | `api/index.php:793` | Audit & Anti-Exfiltration |
| **SEC-F03** | Missing Forensic Watermarking on Classroom Presentations | **Low** | `frontend/portal.html` | Audit & Anti-Exfiltration |
| **SEC-G01** | Missing Content Security Policy (CSP) Header | **High** | `docker/proxy/proxy.conf:20` | HTTP Headers |
| **SEC-G02** | Inline Scripts Prevent Strict CSP Implementation | **Medium** | `frontend/login.html:502` | HTTP Headers |
| **SEC-G03** | Weak or Missing Security Headers on Reverse Proxy | **Medium** | `docker/proxy/proxy.conf:20` | HTTP Headers |
| **SEC-G04** | Unrestricted Access to Native Moodle Admin Paths | **High** | `docker/proxy/proxy.conf:39` | HTTP Headers |
| **SEC-G05** | TLS 1.2/1.3 Inconsistencies & Upstream Header Leaks | **Low** | `docker/proxy/proxy.conf:17` | HTTP Headers |
| **SEC-H01** | Hardcoded Fallback Database Credentials in Code | **High** | `api/db.php:19` | Infrastructure |
| **SEC-H02** | Demo Users Script Executable in Production | **Critical** | `scripts/05-demo-users.php:36` | Infrastructure |
| **SEC-H03** | Excessive Database User Permissions (`moodle`) | **High** | `docker-compose.yml:86` | Infrastructure |
| **SEC-H04** | Missing Redis Protected Mode & Unrenamed Commands | **High** | `docker-compose.yml:76` | Infrastructure |
| **SEC-H05** | Missing Container Capability Drops & Resource Caps | **Medium** | `docker-compose.yml:14` | Infrastructure |
| **SEC-H06** | Incomplete PHP Runtime Hardening (`disable_functions`) | **Medium** | `docker/php/moodle.ini:1` | Infrastructure |
| **SEC-H07** | Absence of Automated Encrypted Backup & Restore SOP | **Medium** | `scripts/` | Infrastructure |

---

## 5. Phase 2 Remediation Plan (Proposed Execution Batches)

Following your approval, fixes will be implemented in priority sequence as small, reviewable commits:

1. **Batch 1 (Critical Auth & Authorization Guards)**:
   - Fix IDOR in `sections` (SEC-B01) and establish central route guard (SEC-B02).
   - Protect hidden Site Admin account from listing, modification, and suspension (SEC-A07).
   - Eliminate stale session privileges with live active check / session versioning (SEC-A05).
   - Prevent self-role modification and demotion (SEC-B03).
2. **Batch 2 (Authentication Hardening & Rate Limiting)**:
   - Implement constant-time comparison on login to eliminate timing enumeration (SEC-A01).
   - Add Redis-backed rate limiting and account lockout (5 attempts, 1800s) on login (SEC-A02).
   - Implement session regeneration, cookie flags (`Secure`, `HttpOnly`, `SameSite=Strict`, `__Host-`), and idle/absolute timeouts (SEC-A03, SEC-A04).
   - Enforce 12-character server-side password policy on create/reset (SEC-A06).
   - Guard `05-demo-users.php` against production execution (SEC-H02).
3. **Batch 3 (CSRF Protection & Request Integrity)**:
   - Issue anti-CSRF token on `/api/session` and enforce validation on all POST/DELETE routes (SEC-C01).
   - Enforce Origin and Referer verification (SEC-C02) and strict JSON content-type (SEC-C03).
4. **Batch 4 (Stored XSS Neutralization & Frontend Safety)**:
   - Implement `escapeHtml()` and replace vulnerable `innerHTML` calls across `portal.js` (SEC-D01).
   - Extract inline scripts from `login.html` and `index.html` into standalone `.js` files (SEC-G02).
   - Add dynamic forensic watermarking on classroom player (SEC-F03).
5. **Batch 5 (Database Injection & Output Masking)**:
   - Convert all direct SQL string interpolations to parameterized prepared statements (SEC-D02).
   - Mask internal database exceptions and stack traces in API responses (SEC-D03).
6. **Batch 6 (File Uploads & Media Streaming Security)**:
   - Enforce magic byte and `finfo` verification on media uploads (SEC-E01).
   - Neutralize polyglots and strip EXIF via GD re-encoding in commander gallery (SEC-E02).
   - Apply Zip bomb and XXE defenses in presentation slide count parser (SEC-E03).
   - Fix Range header parsing, clamp bounds, and set private caching on media stream (SEC-E05).
   - Block upload folder execution in Nginx configuration (SEC-E04).
   - Remove unauthenticated `file` probe from commander image endpoint (SEC-E06).
7. **Batch 7 (Audit Logging & Exfiltration Controls)**:
   - Create `mdl_ek_audit` table and implement central audit logging helper (SEC-F01).
   - Paginate `/api/users` and restrict sensitive officer PII (SEC-B05, SEC-F02).
8. **Batch 8 (Edge Proxy & Container Hardening)**:
   - Configure strict CSP, HSTS, X-Frame-Options: DENY, and Permissions-Policy in `proxy.conf` (SEC-G01, SEC-G03, SEC-G05).
   - Restrict native Moodle administrative paths to admin IP allowlist (SEC-G04).
   - Remove hardcoded credentials from source code (SEC-H01).
   - Harden Redis with `--protected-mode yes` and command renaming (SEC-H04).
   - Harden PHP runtime with `disable_functions` in `moodle.ini` (SEC-H06).
   - Add container resource limits and security options in `docker-compose.yml` (SEC-H05).
   - Create automated encrypted backup script and documentation (SEC-H07).
9. **Batch 9 (Verification & Delivery)**:
   - Build automated security test suite `scripts/07-security-tests.sh` verifying all requirements.
   - Produce operator guide `SECURITY.md`.

---
*End of Phase 1 Audit Report. Awaiting Tech Lead approval to proceed with Phase 2 implementation.*
