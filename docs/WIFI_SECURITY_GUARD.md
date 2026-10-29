# AIR-GAPPED WI-FI INTEGRITY GUARD SYSTEM
**Officers Training College (OTC), AMC Centre & College, Lucknow**  
**Compliance Baseline:** Indian Army Cyber Group (ACG) Air-Gap Directives, CERT-In Guidelines, ISO/IEC 27001 Controls

---

## 1. Overview & Objective

In a military offline training environment, the e-learning platform must run completely disconnected from the public internet. Furthermore, the application must be bound strictly to the authorized local training Wi-Fi network.

**Enforced Security Rule:**
> *The application shall only open and function while connected to the designated authorized Wi-Fi network. If the Wi-Fi network changes (e.g. mobile hotspot, guest Wi-Fi, or disconnection), all media and operations immediately freeze under an impenetrable lockdown overlay, resuming automatically only once reconnected to the authorized Wi-Fi network.*

---

## 2. Architecture & Defense-in-Depth Layers

The Wi-Fi Guard operates across three synchronized layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Host OS Layer (Watchdog Daemon)                                       │
│  - netsh wlan / iwgetid checks active SSID, BSSID, Gateway, and IP      │
│  - Sends telemetry to /api/wifi-sync every 2 seconds                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│  Server & Database Layer (PHP + MySQL mdl_ek_wifi_lock)                │
│  - Verifies host Wi-Fi interface is connected to authorized SSID       │
│  - Verifies client IP is within authorized Wi-Fi subnet                │
│  - Blocks API endpoints with HTTP 403 WIFI_LOCKDOWN on mismatch        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│  Client Browser Layer (wifi-guard.js + wifi-guard.css)                 │
│  - Active 2.5-second heartbeat poller to /api/wifi-heartbeat           │
│  - Intercepts network drops and offline events immediately             │
│  - Non-dismissible full-screen military lockdown screen with radar     │
│  - Pauses all instructional video/audio playback                       │
│  - Instant self-healing when reconnected to authorized Wi-Fi           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. How to Run the System

### Step 1: Start the Docker Platform (Offline Local Server)
```powershell
docker compose up -d
```

### Step 2: Start the Wi-Fi Watchdog Daemon (Host Machine)
Double-click `start-wifi-guard.bat` in the repository root, or run in PowerShell:

```powershell
.\scripts\wifi-watchdog.ps1 -AutoLock
```

**Parameters:**
- `-AutoLock`: Automatically captures the current connected Wi-Fi network on start and engages the lock.
- `-Interval <seconds>`: Polling frequency (default: 2s).
- `-ServerUrl <url>`: Target URL (default: `https://localhost`).

### Step 3: Access the Portal
Open `https://ekalavya.local` or `https://<server-ip>` in any browser connected to that Wi-Fi network.

---

## 4. Administrative Controls (Web Portal)

Institute Administrators can manage Wi-Fi policy directly inside the portal:
1. Click **Settings** (top-right) → **Wi-Fi Air-Gap Security**.
2. **Auto-Lock to Current Wi-Fi**: Automatically captures the active SSID, Subnet, and Gateway.
3. **Manual Override**: Specify authorized SSID (e.g., `OTC_CLASSROOM_WIFI`), subnet CIDR (e.g., `192.168.29.0/24`), and expected gateway.
4. **Test Lockdown Screen**: Simulates a 5-second network lockdown for live demonstration.
5. **Unlock**: Returns the platform to discovery mode when moving to a new classroom.

---

## 5. Verification & Automated Regression Tests

Run the dedicated test suite:
```powershell
python scripts/09-wifi-guard-tests.py
```

**Verified Test Cases:**
1. Public Wi-Fi Status & Diagnostics Query (HTTP 200)
2. High-Frequency Heartbeat Pre-Lock (HTTP 200)
3. Host Telemetry Sync & Auto-Lock (HTTP 200)
4. Network Change Simulation to Rogue Hotspot
5. Heartbeat Lockdown Enforcement (HTTP 403 `WIFI_LOCKDOWN`)
6. Protected API Endpoints Gate Closure (HTTP 403 `WIFI_LOCKDOWN`)
7. Reconnection to Authorized Wi-Fi (HTTP 200)
8. Automatic Lockdown Lift & Self-Healing (HTTP 200)
9. Reset & Discovery Mode Transition
