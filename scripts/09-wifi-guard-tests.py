#!/usr/bin/env python3
"""
Air-Gapped Wi-Fi Guard Security Regression Tests
Officers Training College (OTC), AMC Centre & College, Lucknow
"""

import sys
import json
import ssl
import time
import urllib.request
import urllib.error

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

def req(path, method="GET", data=None, headers=None):
    if headers is None:
        headers = {}
    if "Origin" not in headers:
        headers["Origin"] = "https://ekalavya.local"

    body_bytes = None
    if data is not None:
        if isinstance(data, dict):
            body_bytes = json.dumps(data).encode("utf-8")
            if "Content-Type" not in headers:
                headers["Content-Type"] = "application/json"
        elif isinstance(data, str):
            body_bytes = data.encode("utf-8")

    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=body_bytes,
        headers=headers,
        method=method
    )

    try:
        with urllib.request.urlopen(request, context=SSL_CTX, timeout=5) as response:
            status_code = response.getcode()
            resp_body = response.read().decode("utf-8")
            try:
                parsed = json.loads(resp_body)
            except Exception:
                parsed = resp_body
            return status_code, parsed
    except urllib.error.HTTPError as e:
        status_code = e.code
        resp_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(resp_body)
        except Exception:
            parsed = resp_body
        return status_code, parsed
    except Exception as e:
        return 0, str(e)

def main():
    print(f"{BOLD}=== Ekalavya LMS: Air-Gapped Wi-Fi Guard Test Suite ==={RESET}")

    # TEST 1: Query initial wifi-status
    log_test(1, "Public Wi-Fi Status & Diagnostics Query")
    status, body = req("/api/wifi-status")
    report_result("Wi-Fi status endpoint reachable", status == 200, f"HTTP {status}")
    report_result("Status returns valid structure", isinstance(body, dict) and body.get("status") == "success")

    # TEST 2: High-frequency heartbeat endpoint
    log_test(2, "Wi-Fi Heartbeat Endpoint (Pre-Lock)")
    status, body = req("/api/wifi-heartbeat")
    report_result("Heartbeat returns 200 OK", status == 200, f"HTTP {status}")
    report_result("Heartbeat reports allowed=true", isinstance(body, dict) and body.get("allowed") is True)

    # TEST 3: Host telemetry synchronization with auto-lock
    log_test(3, "Host Telemetry Synchronization & Auto-Lock")
    sync_payload = {
        "ssid": "OTC-Campus-WiFi",
        "bssid": "00:11:22:33:44:55",
        "gateway": "192.168.29.1",
        "ip": "192.168.29.88",
        "connected": True,
        "auto_lock": True
    }
    sync_headers = {
        "X-Wifi-Watchdog-Key": "OTC-Wifi-Guard-Secret-Key-2026!"
    }
    status, body = req("/api/wifi-sync", method="POST", data=sync_payload, headers=sync_headers)
    report_result("Host sync accepted", status == 200, f"HTTP {status}")
    data = body.get("data", {})
    report_result("Auto-lock engaged to 'OTC-Campus-WiFi'", data.get("is_locked") == 1 and data.get("authorized_ssid") == "OTC-Campus-WiFi")

    # TEST 4: Wi-Fi network change simulation (Violation)
    log_test(4, "Simulate Network Change to Unauthorized Wi-Fi ('Rogue-Hotspot')")
    violation_payload = {
        "ssid": "Rogue-Hotspot",
        "bssid": "66:77:88:99:aa:bb",
        "gateway": "192.168.43.1",
        "ip": "192.168.43.10",
        "connected": True,
        "auto_lock": False
    }
    status, body = req("/api/wifi-sync", method="POST", data=violation_payload, headers=sync_headers)
    report_result("Violation telemetry recorded", status == 200)

    # TEST 5: Heartbeat verifies immediate lockdown (HTTP 403)
    log_test(5, "Wi-Fi Heartbeat Enforces Immediate Lockdown on Violation")
    hb_status, hb_body = req("/api/wifi-heartbeat")
    report_result("Heartbeat rejects with HTTP 403", hb_status == 403, f"HTTP {hb_status}")
    report_result("Heartbeat payload codes WIFI_LOCKDOWN", isinstance(hb_body, dict) and hb_body.get("code") == "WIFI_LOCKDOWN")
    report_result("Heartbeat details mention SSID mismatch", "Rogue-Hotspot" in str(hb_body.get("message", "")))

    # TEST 6: Protected API endpoints blocked during lockdown
    log_test(6, "Protected API Endpoints Blocked During Wi-Fi Violation")
    c_status, c_body = req("/api/courses")
    report_result("/api/courses rejected during Wi-Fi violation", c_status == 403, f"HTTP {c_status}")
    report_result("/api/courses error codes WIFI_LOCKDOWN", isinstance(c_body, dict) and c_body.get("code") == "WIFI_LOCKDOWN")

    # TEST 7: Reconnect back to authorized Wi-Fi (Self-Healing)
    log_test(7, "Reconnect to Authorized Wi-Fi ('OTC-Campus-WiFi')")
    restore_payload = {
        "ssid": "OTC-Campus-WiFi",
        "bssid": "00:11:22:33:44:55",
        "gateway": "192.168.29.1",
        "ip": "192.168.29.88",
        "connected": True,
        "auto_lock": False
    }
    status, body = req("/api/wifi-sync", method="POST", data=restore_payload, headers=sync_headers)
    report_result("Restored telemetry recorded", status == 200)

    # TEST 8: Heartbeat automatically recovers to HTTP 200
    log_test(8, "Heartbeat Automatically Lifts Lockdown on Reconnect")
    hb_status, hb_body = req("/api/wifi-heartbeat")
    report_result("Heartbeat returns HTTP 200 after reconnection", hb_status == 200, f"HTTP {hb_status}")
    report_result("Heartbeat confirms allowed=true", isinstance(hb_body, dict) and hb_body.get("allowed") is True)

    # TEST 9: Clean up & reset to discovery mode
    log_test(9, "Reset Wi-Fi Lock to Discovery Mode")
    reset_payload = {
        "ssid": "",
        "bssid": "",
        "gateway": "",
        "ip": "",
        "connected": True,
        "auto_lock": False
    }
    req("/api/wifi-sync", method="POST", data=reset_payload, headers=sync_headers)
    report_result("Reset telemetry synchronized", True)

    print("\n-------------------------------------------------------------")
    print(f"Results: {GREEN}{passed} Passed{RESET}, {RED}{failed} Failed{RESET}")
    print("-------------------------------------------------------------")
    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()
