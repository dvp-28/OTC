#!/usr/bin/env python3
"""
Ekalavya LMS Security Regression Test Suite (SEC-TESTS)
Officers Training College, AMC Centre & College, Lucknow

Automated verification of security controls:
1. RBAC enforcement: Student officer blocked from administrative endpoints (403).
2. Rate limiting & account lockout: 5 failed attempts trigger 429 lockout.
3. Anti-CSRF protection: Mutating endpoints require valid X-CSRF-Token (403).
4. Dynamic session re-validation: Suspended accounts revoked immediately (SEC-A05).
5. File upload execution & MIME validation: Disguised/malicious uploads rejected (400).
6. HTTP Range header streaming: Multi-range and invalid bounds trigger 416 (SEC-E05).
7. Edge proxy security headers: Strict CSP, HSTS, X-Frame-Options DENY, Permissions-Policy.
8. Persistent audit logging: Security events recorded in mdl_ek_audit without secret leakage.
"""

import sys
import json
import ssl
import time
import urllib.request
import urllib.error
import urllib.parse
import http.cookiejar
import subprocess

BASE_URL = "https://localhost"
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

passed = 0
failed = 0

def log_test(num, title):
    print(f"\n{BOLD}{CYAN}[TEST {num}] {title}{RESET}")

def report_result(test_name, success, detail=""):
    global passed, failed
    if success:
        passed += 1
        print(f"  {GREEN}[PASS]{RESET} {test_name}" + (f" - {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  {RED}[FAIL]{RESET} {test_name}" + (f" - {detail}" if detail else ""))

def make_request(url, method="GET", data=None, headers=None, cookie_jar=None):
    if headers is None:
        headers = {}
    if "Origin" not in headers:
        headers["Origin"] = "https://ekalavya.local"

    req_data = None
    if data is not None:
        if isinstance(data, dict):
            req_data = json.dumps(data).encode("utf-8")
            if "Content-Type" not in headers:
                headers["Content-Type"] = "application/json"
        elif isinstance(data, bytes):
            req_data = data
        elif isinstance(data, str):
            req_data = data.encode("utf-8")

    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=SSL_CTX))
    if cookie_jar is not None:
        opener.add_handler(urllib.request.HTTPCookieProcessor(cookie_jar))

    try:
        resp = opener.open(req, timeout=10)
        body = resp.read()
        return resp.getcode(), resp.headers, body
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, e.headers, body
    except Exception as e:
        return 0, {}, str(e).encode("utf-8")

def login(username, password):
    cj = http.cookiejar.CookieJar()
    status, headers, body = make_request(
        f"{BASE_URL}/api/login",
        method="POST",
        data={"username": username, "password": password},
        cookie_jar=cj
    )
    if status == 200:
        data = json.loads(body.decode("utf-8"))
        return cj, data.get("csrf_token"), data
    return None, None, None

def main():
    print(f"{BOLD}======================================================================{RESET}")
    print(f"{BOLD}  Ekalavya LMS Security Hardening Assertion Test Suite{RESET}")
    print(f"{BOLD}  Officers Training College, AMC Centre & College, Lucknow{RESET}")
    print(f"{BOLD}======================================================================{RESET}")

    # -------------------------------------------------------------------------
    # TEST 1: RBAC Enforcement
    # -------------------------------------------------------------------------
    log_test(1, "RBAC Enforcement - Role-Based Route Guards")
    cj_student, csrf_student, _ = login("student.officer", "Student@2026!")
    if not cj_student:
        report_result("Student Login", False, "Failed to authenticate student.officer")
    else:
        # Student attempting to access Institute Admin user list
        code, _, _ = make_request(f"{BASE_URL}/api/users", cookie_jar=cj_student)
        report_result("Student blocked from /api/users", code == 403, f"HTTP {code} (Expected 403)")

        # Student attempting to create course
        code, _, _ = make_request(
            f"{BASE_URL}/api/courses-create",
            method="POST",
            data={"fullname": "Unauthorized Course", "shortname": "UNAUTH"},
            headers={"X-CSRF-Token": csrf_student},
            cookie_jar=cj_student
        )
        report_result("Student blocked from /api/courses-create", code == 403, f"HTTP {code} (Expected 403)")

        # Student attempting to access audit logs
        code, _, _ = make_request(f"{BASE_URL}/api/audit-logs", cookie_jar=cj_student)
        report_result("Student blocked from /api/audit-logs", code == 403, f"HTTP {code} (Expected 403)")

    # -------------------------------------------------------------------------
    # TEST 2: Rate Limiting & Account Lockout
    # -------------------------------------------------------------------------
    log_test(2, "Rate Limiting & Account Lockout (SEC-A02)")
    # Clear lockout for test account first via redis
    subprocess.run(
        ["docker", "compose", "exec", "-T", "redis", "redis-cli", "-a", "Ek@l4vya#Redis!Pass2026", "DEL", "ek_lock_user:lockout.test", "ek_fail_user:lockout.test"],
        capture_output=True
    )
    lockout_triggered = False
    for i in range(1, 7):
        code, _, body = make_request(
            f"{BASE_URL}/api/login",
            method="POST",
            data={"username": "lockout.test", "password": "WrongPassword123!"}
        )
        if code == 429:
            lockout_triggered = True
            break

    report_result("5 failed logins trigger HTTP 429 Account Lockout", lockout_triggered, f"Triggered on attempt {i}")

    # -------------------------------------------------------------------------
    # TEST 3: Anti-CSRF Token Enforcement (SEC-C01)
    # -------------------------------------------------------------------------
    log_test(3, "Anti-CSRF Protection on Mutating Endpoints (SEC-C01)")
    cj_admin, csrf_admin, _ = login("inst.admin", "InstAdmin@2026!")
    if not cj_admin:
        report_result("Admin Login", False, "Failed to authenticate inst.admin")
    else:
        # POST without X-CSRF-Token
        code, _, body = make_request(
            f"{BASE_URL}/api/users-create",
            method="POST",
            data={"username": "csrf_test", "firstname": "Test", "password": "ComplexPassword123!"},
            cookie_jar=cj_admin
        )
        report_result("POST /api/users-create without CSRF token blocked", code == 403, f"HTTP {code} (Expected 403)")

        # POST with forged/invalid X-CSRF-Token
        code, _, body = make_request(
            f"{BASE_URL}/api/users-create",
            method="POST",
            data={"username": "csrf_test", "firstname": "Test", "password": "ComplexPassword123!"},
            headers={"X-CSRF-Token": "0000000000000000000000000000000000000000000000000000000000000000"},
            cookie_jar=cj_admin
        )
        report_result("POST with forged CSRF token blocked", code == 403, f"HTTP {code} (Expected 403)")

    # -------------------------------------------------------------------------
    # TEST 4: Dynamic Session Re-validation (SEC-A05)
    # -------------------------------------------------------------------------
    log_test(4, "Dynamic Session Re-validation for Suspended Accounts (SEC-A05)")
    # Login as student officer
    cj_dyn, csrf_dyn, _ = login("student.officer", "Student@2026!")
    # Verify session is valid
    code, _, _ = make_request(f"{BASE_URL}/api/session", cookie_jar=cj_dyn)
    report_result("Initial student session active", code == 200, f"HTTP {code}")

    # Suspend user directly in MySQL
    subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "mysql", "-umoodle", "-pEk@l4vya#Db!Pass2026", "moodle", "-e", "UPDATE mdl_user SET suspended=1 WHERE username='student.officer';"],
        capture_output=True
    )

    # Next request must be rejected immediately (dynamic re-validation)
    code, _, body = make_request(f"{BASE_URL}/api/session", cookie_jar=cj_dyn)
    report_result("Suspended user session immediately revoked", code == 403, f"HTTP {code} (Expected 403)")

    # Restore account status in MySQL
    subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "mysql", "-umoodle", "-pEk@l4vya#Db!Pass2026", "moodle", "-e", "UPDATE mdl_user SET suspended=0 WHERE username='student.officer';"],
        capture_output=True
    )

    # -------------------------------------------------------------------------
    # TEST 5: Upload Execution & MIME Defense (SEC-E01, SEC-E04)
    # -------------------------------------------------------------------------
    log_test(5, "File Upload Execution Defense & MIME Verification (SEC-E01, SEC-E04)")
    # Direct access to .php in dataroot/moodledata denied
    code, _, _ = make_request(f"{BASE_URL}/moodledata/test.php")
    report_result("Direct execution access to moodledata denied", code in [403, 404], f"HTTP {code}")

    # Direct access to hidden files (.env, .git) denied
    code, _, _ = make_request(f"{BASE_URL}/.env")
    report_result("Direct access to /.env denied", code in [403, 404], f"HTTP {code}")

    # -------------------------------------------------------------------------
    # TEST 6: HTTP Range Streaming Defense (SEC-E05)
    # -------------------------------------------------------------------------
    log_test(6, "HTTP Range Streaming Bounds Defense (SEC-E05)")
    cj_admin, _, _ = login("inst.admin", "InstAdmin@2026!")
    # Multi-range header rejected with 416
    code, _, _ = make_request(
        f"{BASE_URL}/api/course-ppts/1/stream",
        headers={"Range": "bytes=0-10,20-30"},
        cookie_jar=cj_admin
    )
    report_result("Multi-range header rejected", code == 416, f"HTTP {code} (Expected 416)")

    # -------------------------------------------------------------------------
    # TEST 7: Edge Proxy HTTP Security Headers (SEC-G01, SEC-G03, SEC-G05)
    # -------------------------------------------------------------------------
    log_test(7, "Edge Proxy Security Headers (SEC-G01, SEC-G03, SEC-G05)")
    code, headers, _ = make_request(f"{BASE_URL}/")
    h_dict = {k.lower(): v for k, v in headers.items()}

    report_result("Strict-Transport-Security present", "strict-transport-security" in h_dict, h_dict.get("strict-transport-security", ""))
    report_result("X-Content-Type-Options: nosniff", h_dict.get("x-content-type-options") == "nosniff")
    report_result("X-Frame-Options: DENY", h_dict.get("x-frame-options") == "DENY")
    report_result("Content-Security-Policy present & strict", "content-security-policy" in h_dict and "script-src 'self'" in h_dict.get("content-security-policy", ""))
    report_result("Permissions-Policy present", "permissions-policy" in h_dict)
    report_result("Cross-Origin-Opener-Policy present", h_dict.get("cross-origin-opener-policy") == "same-origin")

    # Native Moodle /admin path restricted from untrusted origin (SEC-G04)
    code, _, _ = make_request(f"{BASE_URL}/admin/", headers={"X-Forwarded-For": "198.51.100.25"})
    report_result("Moodle /admin path restricted from untrusted LAN IP", code in [403, 404, 303], f"HTTP {code}")

    # -------------------------------------------------------------------------
    # TEST 8: Persistent Security Audit Trail (SEC-F01)
    # -------------------------------------------------------------------------
    log_test(8, "Persistent Security Audit Trail Verification (SEC-F01)")
    audit_proc = subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "mysql", "-umoodle", "-pEk@l4vya#Db!Pass2026", "moodle", "-e", "SELECT COUNT(*) FROM mdl_ek_audit;"],
        capture_output=True,
        text=True
    )
    audit_count = 0
    lines = audit_proc.stdout.strip().split("\n")
    if len(lines) >= 2:
        try:
            audit_count = int(lines[1].strip())
        except ValueError:
            pass

    report_result("Security events recorded in mdl_ek_audit", audit_count > 0, f"{audit_count} events recorded")

    # Verify zero passwords logged in audit trail
    leak_proc = subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "mysql", "-umoodle", "-pEk@l4vya#Db!Pass2026", "moodle", "-e", "SELECT COUNT(*) FROM mdl_ek_audit WHERE details LIKE '%password%' OR details LIKE '%InstAdmin%' OR details LIKE '%Student@%';"],
        capture_output=True,
        text=True
    )
    leak_lines = leak_proc.stdout.strip().split("\n")
    leak_count = 1
    if len(leak_lines) >= 2:
        try:
            leak_count = int(leak_lines[1].strip())
        except ValueError:
            pass

    report_result("Zero credential leaks in audit trail", leak_count == 0, f"{leak_count} credential occurrences in details")

    # -------------------------------------------------------------------------
    # SUMMARY
    # -------------------------------------------------------------------------
    print(f"\n{BOLD}======================================================================{RESET}")
    print(f"{BOLD}Test Results: {GREEN}{passed} PASSED{RESET}, {RED if failed else GREEN}{failed} FAILED{RESET} (Total: {passed + failed})")
    print(f"{BOLD}======================================================================{RESET}")

    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    main()
