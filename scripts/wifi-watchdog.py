#!/usr/bin/env python3
"""
Air-Gapped Wi-Fi Security Guard Watchdog (Cross-Platform Python)
Officers Training College (OTC), AMC Centre & College, Lucknow

Monitors active Wi-Fi interface (SSID, Gateway, IP, state) and synchronizes with /api/wifi-sync.
"""

import sys
import time
import json
import ssl
import subprocess
import urllib.request
import urllib.error

SERVER_URL = "https://localhost"
SECRET_KEY = "OTC-Wifi-Guard-Secret-Key-2026!"
INTERVAL = 2

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

def get_wifi_details():
    details = {
        "ssid": "",
        "bssid": "",
        "gateway": "",
        "ip": "",
        "connected": False
    }

    # Platform detection
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(["netsh", "wlan", "show", "interfaces"], text=True, stderr=subprocess.DEVNULL)
            if "State" in out and "connected" in out.lower():
                details["connected"] = True
                for line in out.splitlines():
                    if "SSID" in line and "BSSID" not in line:
                        parts = line.split(":", 1)
                        if len(parts) == 2:
                            details["ssid"] = parts[1].strip()
                    elif "BSSID" in line:
                        parts = line.split(":", 1)
                        if len(parts) == 2:
                            details["bssid"] = parts[1].strip()
        except Exception:
            pass

        # If Wi-Fi is not connected, check if connected via physical LAN Cable (Ethernet)
        if not details["connected"]:
            try:
                ps_cmd = 'Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.InterfaceDescription -notmatch "Virtual|Hyper-V|WSL|Bluetooth|Loopback" -and $_.Name -notmatch "Wi-Fi|Wireless" } | Select-Object -First 1 -ExpandProperty Name'
                adapter_name = subprocess.check_output(["powershell", "-NoProfile", "-Command", ps_cmd], text=True, stderr=subprocess.DEVNULL).strip()
                if adapter_name:
                    details["connected"] = True
                    details["ssid"] = f"Wired LAN ({adapter_name})"
                    
                    gw_cmd = '(Get-NetRoute -DestinationPrefix "0.0.0.0/0" | Sort-Object RouteMetric | Select-Object -First 1).NextHop'
                    gw = subprocess.check_output(["powershell", "-NoProfile", "-Command", gw_cmd], text=True, stderr=subprocess.DEVNULL).strip()
                    if gw:
                        details["gateway"] = gw

                    ip_cmd = f'(Get-NetIPAddress -InterfaceAlias "{adapter_name}" -AddressFamily IPv4 | Select-Object -First 1).IPAddress'
                    ip = subprocess.check_output(["powershell", "-NoProfile", "-Command", ip_cmd], text=True, stderr=subprocess.DEVNULL).strip()
                    if ip:
                        details["ip"] = ip
            except Exception:
                pass
    elif sys.platform.startswith("linux"):
        try:
            ssid = subprocess.check_output(["iwgetid", "-r"], text=True, stderr=subprocess.DEVNULL).strip()
            if ssid:
                details["ssid"] = ssid
                details["connected"] = True
            else:
                # Check for wired ethernet interface
                ip_route = subprocess.check_output(["ip", "route", "show", "default"], text=True, stderr=subprocess.DEVNULL)
                if "default via" in ip_route:
                    parts = ip_route.split()
                    details["connected"] = True
                    details["ssid"] = f"Wired LAN ({parts[4] if len(parts) > 4 else 'eth0'})"
                    details["gateway"] = parts[2] if len(parts) > 2 else ""
        except Exception:
            pass

    return details

def sync_telemetry(data, auto_lock=False):
    payload = json.dumps({
        "ssid": data["ssid"],
        "bssid": data["bssid"],
        "gateway": data["gateway"],
        "ip": data["ip"],
        "connected": data["connected"],
        "auto_lock": auto_lock
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{SERVER_URL}/api/wifi-sync",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Wifi-Watchdog-Key": SECRET_KEY
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=4) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"status": "error", "message": str(e)}

def main():
    print("=================================================================")
    print("  EKALAVYA LMS - AIR-GAPPED WI-FI INTEGRITY WATCHDOG (Python)")
    print("  Officers Training College (OTC), AMC Centre & College, Lucknow")
    print("=================================================================")

    first_run = True
    auto_lock_flag = "--auto-lock" in sys.argv

    while True:
        wifi = get_wifi_details()
        res = sync_telemetry(wifi, auto_lock=(first_run and auto_lock_flag))
        now = time.strftime("%H:%M:%S")

        if res.get("status") == "success":
            data = res.get("data", {})
            is_locked = bool(data.get("is_locked"))
            auth_ssid = data.get("authorized_ssid", "")
            curr_ssid = wifi["ssid"]

            if not wifi["connected"]:
                print(f"[{now}] [ALERT] Wi-Fi is disconnected! Platform is LOCKED.")
            elif is_locked and curr_ssid != auth_ssid:
                print(f"[{now}] [VIOLATION] Connected to '{curr_ssid}', required '{auth_ssid}'! Platform is LOCKED.")
            else:
                tag = "LOCKED & GUARDED" if is_locked else "MONITORING (UNLOCKED)"
                print(f"[{now}] [HEALTHY] {tag} -> SSID: '{curr_ssid or 'LAN'}'")
        else:
            print(f"[{now}] [ERROR] Sync failed: {res.get('message')}")

        first_run = False
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
