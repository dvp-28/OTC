# Ekalavya LMS – Project context for the coding agent

You are my pair-programming agent on this repository. Read this whole file before doing anything. It is the source of truth for scope, constraints, and plan. If something here conflicts with your defaults, follow this file. If something is unclear or missing, ask me instead of assuming.

---

## 1. What we are building

A **Moodle-based e-learning platform ("Ekalavya")** for the **Officers Training College (OTC), AMC Centre and College** (Indian Army Medical Corps). It is a defence project, so it will be vetted by the Army Cyber Group (ACG) and must meet CERT-In guidelines, ISO 27001 controls, and Army cyber-security directives. Vulnerability scans and penetration tests are required before go-live.

The team is 2 people:
- **Me (Tech Lead):** everything technical. This is what you help with.
- **Content/Design Lead:** modernises 150 PowerPoint decks (~11,000 slides), writes scripts, and produces 150 narrated videos. Their output arrives as files for us to upload. Do not work on content creation.

### Users and courses
7 officer courses, grouped in Moodle like this:

```
Officers Training College, AMC Centre and College, Lucknow   (category idnumber: OTC)
├── Medical Officers   (OTC-MED): MOBC, MOJCC, MOSCC
├── Nursing Officers   (OTC-NUR): BNOC, SNOC
└── Non-Technical      (OTC-NT):  NTPCC, NTADM
```
Full course names (confirmed by client on 01 Oct 2026):
- **MOBC:** Medical Officers Basic Course
- **MOJCC:** Medical Officers Junior Command Course
- **MOSCC:** Medical Officers Senior Command Course
- **BNOC:** Basic Nursing Officers Course
- **SNOC:** Senior Nursing Officers Course
- **NTPCC:** Non-Tech Post Commissioning Course
- **NTADM:** Non-Tech Administration

### The client's 3 login levels (exact requirement)
| Level | Moodle role (shortname) | Context | Can do |
|---|---|---|---|
| Institute | `instituteadmin` (archetype manager) | OTC category | Add/delete content in all courses, manage users and batches. **Cannot** delete whole courses or manage categories (CAP_PREVENT). |
| Course Admin | `courseadmin` (archetype editingteacher) | Per course | Add/delete content in assigned courses only |
| Student | `student` (built-in) | Per course, via batch cohort | View content, attempt quizzes |
| *(hidden)* Site Admin | Moodle site admin | System | Tech team only – plugins, security, backups |

Students are enrolled through **one cohort per course batch** (e.g. `MOBC-2026`) with cohort-sync enrolment.

---

## 2. Hard constraints (never violate)

1. **On-prem and air-gapped.** No runtime dependency on the internet: no external CDNs, Google Fonts, reCAPTCHA, analytics beacons, update checks, Moodle hub registration, or remote APIs. Every JS/CSS/font asset must be bundled locally. Containers run on `internal` Docker networks to catch violations early.
2. **Don't modify Moodle core.** All custom work goes in plugins (`auth/`, `local/`, `theme/`, `tool/`) or config/scripts in this repo. Moodle 5.1+ keeps code under `moodle-src/public/`, so plugins go in `moodle-src/public/<type>/<name>` (check the layout on disk).
3. **Configuration as code.** Every setting is applied by an idempotent script in `scripts/`, never by clicking in the admin UI. A fresh install must be fully reproducible.
4. **Scripts are re-runnable.** Check before creating anything.
5. **Security by default.** No secrets in git (use `.env`). Validate all input. Use Moodle APIs (`required_param`, `require_capability`, `$DB` placeholders, `s()`/`format_string()`); never raw SQL concatenation. Log security-relevant actions.
6. **Open-source, well-known components only.** Keep a list of every third-party component and version (we will produce an SBOM).
7. **Versions:** Moodle **5.2 now → 5.3 LTS** (released 5 Oct 2026, supported to Oct 2029; deliver on 5.3). PHP 8.3, MySQL 8.4, Redis 7, nginx 1.27.

---

## 3. Deployment target

The client has **one central server** (VMware/Hyper-V). **Child nodes** (classroom, faculty, and office PCs) on the LAN reach it with only a browser. Inside the server we use 4 VMs as security zones:

| Docker service (local) | Client VM | Role |
|---|---|---|
| `proxy` | Proxy VM | TLS, security headers, ModSecurity WAF. Only thing on the LAN. |
| `web`, `php`, `cron`, `redis` | App VM | Moodle (nginx + PHP-FPM), cron, Redis sessions |
| `db` | Database VM | MySQL 8.4, encrypted at rest |
| *(to add)* | Ops VM | Matomo, central logs, backups → separate NAS / Azure-compatible storage |

Design notes:
- Sessions live in Redis and the web tier is stateless, so we can scale out later without code changes.
- Files are served by nginx through `X-Accel-Redirect` after Moodle permission checks; video must not tie up PHP workers.
- Size for the **real number of child nodes** (unknown, to be confirmed), not the 5,000 in the tender. Video bandwidth on the LAN is the main bottleneck (~2.5 Mbps per 720p stream).
- Institute Admin logins will be allowed only from allow-listed IPs (admin office PCs).
- Moodle sees real client IPs via `X-Forwarded-For` (`getremoteaddrconf=1`, `reverseproxyignore`).

---

## 4. Current state of the repo (done)

```
docker-compose.yml        proxy, web, php, cron, redis, db on edge/app/data networks
docker/php/               PHP 8.3-FPM image, moodle.ini, FPM pool (clear_env=no)
docker/proxy/proxy.conf   TLS 1.2+/1.3, HSTS and security headers, reverse proxy to web
docker/web/moodle.conf    nginx for Moodle (public/ root, r.php routing, X-Accel, deny internal files)
config/config.php         env-driven Moodle config (Redis sessions, sslproxy, xsendfile, no update checks)
scripts/common.sh         helpers ($CLI path detection, cfg())
scripts/01-install.sh     install_database.php with hidden Site Admin
scripts/02-harden.sh      password policy, lockout, session timeout, forced login, recycle bin, logs 365 days, features off
scripts/03-structure.php  categories, 7 course shells, 3 roles, batch cohorts with cohort enrol
scripts/04-verify.php     verification of categories, courses, roles, cohorts and environment
scripts/cron-loop.sh      cron every 60 seconds
README.md                 setup steps
```
**Stack brought up and verified end-to-end on 01 Oct 2026.** All services running, schema installed, hardened, and structure created.

---

## 5. Plan and deadline

**Deadline: Wed 28 Oct 2026.** Working days only (no Sat/Sun). Check holidays: Oct 2 (Gandhi Jayanti), Dussehra around Oct 20.

Goal for Oct 28: a complete, hardened, documented platform running locally, packaged as a single-host installer, ready to deploy the day we get infrastructure access. Formal VAPT, ACG vetting, UAT, and integration with systems not yet named come later and are out of scope until then.

| Date | Task | Done when |
|---|---|---|
| Oct 1–5 | **Bring the stack up**, fix errors, verify roles, courses and cohorts in the UI. Moodle environment check has no failures. | [x] Fresh `down -v` → `up` → scripts 01–03 works end to end (Verified 01 Oct 2026) |
| Oct 6 | Upgrade to `MOODLE_503_STABLE` (5.3 LTS). Re-test scripts. | Running on 5.3 |
| Oct 7 | **Theme** `theme_ekalavya` (child of Boost): AMC branding placeholders, login page, dashboard with "continue where you left off" and course cards with progress (UI inspiration: TCCC tactical-medicine app). All assets local. | Theme installs via script and is set as default |
| Oct 8–9 | **JWT auth plugin** `auth_ekalavyajwt` plus a mock IdP script (RS256). Verify signature, `exp`, `iss`, `aud`. Claims → user: `sub`, `name`, `email`, `level` (institute/courseadmin/student), `courses[]`, `batch`. Auto-provision users, role assignment, cohort membership. **Reject institute-level logins from IPs not in the allowlist.** PHPUnit tests. | Mock token logs in with the correct role and course |
| Oct 12 | **Video pipeline:** ffmpeg script MP4 → HLS (multi-bitrate, e.g. 360p/720p) plus VTT subtitles; nginx caching on the proxy. | Sample video streams and seeks |
| Oct 13 | **Bulk upload CLI** (`local_ekalavyaupload` or a script): reads a CSV/JSON manifest (course, section, title, video path, PPT path, order) and creates sections and activities. Pilot with MOBC. | MOBC populated by script only |
| Oct 14 | **WAF:** ModSecurity + OWASP CRS on the proxy, tuned so Moodle works (no false positives on editing/quiz pages). Offline CAPTCHA on login and forgot-password. | Attack payloads blocked, Moodle fully usable |
| Oct 15 | **Hardening 2:** all green in Moodle Security overview; MySQL InnoDB encryption at rest (keyring); document LUKS/BitLocker for the VMs. | Checklist complete |
| Oct 16 | **Ops zone:** Matomo (self-hosted, no external calls) + Moodle integration; dashboards for logins, completion, and video views. | Dashboard shows real activity |
| Oct 19 | Split into VM-like zones: confirm proxy-only exposure, firewall-style network rules, real client IPs in logs. | Zone test passes |
| Oct 20 | MySQL replication config (optional, off by default); VM snapshot and restore procedure. | Documented and tested |
| Oct 21 | **Backups:** nightly full + incremental (DB binlogs + restic for moodledata), encrypted, pushed to Azurite (Azure emulator) or a NAS path. **Restore drill.** | Restore produces a working site |
| Oct 22 | **Load test:** Moodle `tool_generator` + JMeter; simultaneous video playback; tune PHP-FPM, OPcache, MySQL. Produce a sizing sheet. | Users-per-server figure documented |
| Oct 23 | **Scans:** OWASP ZAP, Trivy on images, Moodle security checks; fix highs and criticals. Generate the SBOM. | Scan report clean |
| Oct 26 | **Packaging:** single-host installer + `.env` template; test a fresh install on a clean VM. | Clean VM → working site in under 1 hour |
| Oct 27 | **Docs:** Institute Admin manual, Course Admin manual, Student quick-start, deployment SOP, backup/restore SOP, incident response SOP, test scripts and QA report. | Docs in `docs/` |
| Oct 28 | Demo walkthrough, handover checklist, open-items list. | Ready for client |

---

## 6. Open questions (don't guess; use mocks or config flags)

1. Exact number of child nodes (concurrent users)
2. Existing identity provider for JWT, or do we provide one? (Build against the mock IdP until known.)
3. Batch sizes for each course (full course names confirmed by client on 01 Oct 2026)
4. Can students download slides and videos, or stream only?
5. Branding guidelines and insignia assets (use placeholders)
6. Whether Docker is allowed in production. Keep everything installable natively too.
7. Mobile app – **phase 2, out of scope now.** Keep web services disabled.

---

## 7. How I want you to work

- **Start every session** by reading this file and `README.md`, then tell me which plan item we're on and what you'll do first.
- Work in **small, verifiable steps.** After each change, give me the exact command to test it and the expected result.
- **Ask before** anything destructive (`docker compose down -v`, deleting files, rewriting scripts wholesale) or anything that adds a new third-party dependency.
- When you add a component, add it to `docs/SBOM.md` (name, version, licence, purpose).
- Prefer Moodle core APIs and documented settings. If you are not sure a setting, function, or capability exists in Moodle 5.2/5.3, say so and check the code in `moodle-src/` rather than guessing.
- Keep `README.md` and this file up to date: tick off finished plan items in section 5 and update section 4.
- Write PHPUnit tests for custom plugins; keep plugin code to Moodle coding style (frankenstyle naming, `version.php`, `lang/en/`, `db/access.php`, privacy provider).
- Every security decision gets one line in `docs/SECURITY_DECISIONS.md` (what, why, which requirement – CERT-In / ISO 27001 / client note).
- End each session with: what changed (files), what's verified, what's next, and any new question for the client.

---

## 8. First task right now

1. Check prerequisites (Docker, Compose v2, git, mkcert) and that `moodle-src/` is cloned on `MOODLE_502_STABLE`.
2. Check whether `moodle-src/public/` exists, and that `config/config.php`, `docker/web/moodle.conf` and `scripts/common.sh` match that layout.
3. Run the first-time setup from `README.md`, step by step. Stop and fix at the first error.
4. Log in as Site Admin and verify: the category tree, 7 courses, `instituteadmin` and `courseadmin` roles with the right context levels, the course:delete/category:manage prevents, batch cohorts with cohort enrolment, and **Site administration → Notifications/Environment** with no failures.
5. Report results and propose fixes for anything that failed.
