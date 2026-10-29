<#
.SYNOPSIS
    Air-Gapped Wi-Fi Security Guard Watchdog for Ekalavya LMS
    Officers Training College (OTC), AMC Centre & College, Lucknow

.DESCRIPTION
    Continuously monitors the host machine's Wi-Fi network interface (SSID, Gateway, IP, Connection state).
    Sends real-time telemetry heartbeats to the Ekalavya LMS backend API (/api/wifi-sync).
    If the Wi-Fi disconnects or switches to an unauthorized network, the backend and frontend
    immediately trigger a full security lockdown.

.EXAMPLE
    .\scripts\wifi-watchdog.ps1 -AutoLock
    .\scripts\wifi-watchdog.ps1 -ServerUrl "https://localhost" -Interval 2
#>

param(
    [string]$ServerUrl = "https://localhost",
    [string]$SecretKey = "OTC-Wifi-Guard-Secret-Key-2026!",
    [int]$Interval = 2,
    [switch]$AutoLock = $false
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}

Clear-Host
Write-Host "========================================================================" -ForegroundColor DarkYellow
Write-Host "  EKALAVYA LMS - AIR-GAPPED WI-FI INTEGRITY WATCHDOG" -ForegroundColor Yellow
Write-Host "  Officers Training College (OTC), AMC Centre & College, Lucknow" -ForegroundColor White
Write-Host "  Compliance: Army Cyber Group (ACG) Air-Gap Directives" -ForegroundColor DarkGray
Write-Host "========================================================================" -ForegroundColor DarkYellow
Write-Host "Server URL : $ServerUrl" -ForegroundColor Cyan
Write-Host "Heartbeat  : Every ${Interval}s" -ForegroundColor Cyan
Write-Host "Auto-Lock  : $(if ($AutoLock) { 'Enabled (Locking to current network on start)' } else { 'Configured Policy' })" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------------------" -ForegroundColor DarkGray

function Get-HostWifiDetails {
    $wifi = @{
        ssid = ""
        bssid = ""
        state = "disconnected"
        gateway = ""
        ip = ""
        connected = $false
    }

    try {
        $netsh = netsh wlan show interfaces 2>&1 | Out-String
        if ($netsh -match "State\s*:\s*connected") {
            $wifi.state = "connected"
            $wifi.connected = $true

            if ($netsh -match "SSID\s*:\s*([^\r\n]+)") {
                $wifi.ssid = $matches[1].Trim()
            }
            if ($netsh -match "BSSID\s*:\s*([^\r\n]+)") {
                $wifi.bssid = $matches[1].Trim()
            }
        } elseif ($netsh -match "State\s*:\s*([^\r\n]+)") {
            $wifi.state = $matches[1].Trim()
        }
    } catch {
        $wifi.state = "error: " + $_.Exception.Message
    }

    # Retrieve active default gateway and primary IP
    try {
        $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
        if ($route) {
            $wifi.gateway = $route.NextHop
            $ipObj = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($ipObj) {
                $wifi.ip = $ipObj.IPAddress
            }
        }
    } catch {}

    # If Wi-Fi interface specifically has an IP, prioritize it
    try {
        $wifiAdapter = Get-NetAdapter -Name "*Wi-Fi*", "*Wireless*" -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Select-Object -First 1
        if ($wifiAdapter) {
            $wifiIp = Get-NetIPAddress -InterfaceIndex $wifiAdapter.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($wifiIp) {
                $wifi.ip = $wifiIp.IPAddress
            }
        }
    } catch {}

    # If Wi-Fi is not connected, check if connected via physical LAN Cable (Ethernet)
    if (-not $wifi.connected) {
        try {
            $ethAdapter = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { 
                $_.Status -eq 'Up' -and 
                $_.InterfaceDescription -notmatch 'Virtual|Hyper-V|WSL|Bluetooth|Loopback' -and 
                $_.Name -notmatch 'Wi-Fi|Wireless' 
            } | Select-Object -First 1

            if ($ethAdapter) {
                $wifi.connected = $true
                $wifi.state = "connected"
                $wifi.ssid = "Wired LAN (" + $ethAdapter.Name + ")"
                $wifi.adapter_type = "Ethernet"

                $ethIp = Get-NetIPAddress -InterfaceIndex $ethAdapter.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($ethIp) {
                    $wifi.ip = $ethIp.IPAddress
                }
            }
        } catch {}
    } else {
        $wifi.adapter_type = "Wi-Fi"
    }

    return $wifi
}

$firstRun = $true

while ($true) {
    $now = Get-Date -Format "HH:mm:ss"
    $wifiInfo = Get-HostWifiDetails

    $payload = @{
        ssid = $wifiInfo.ssid
        bssid = $wifiInfo.bssid
        gateway = $wifiInfo.gateway
        ip = $wifiInfo.ip
        connected = $wifiInfo.connected
        auto_lock = ($firstRun -and $AutoLock)
    } | ConvertTo-Json -Compress

    $headers = @{
        "Content-Type" = "application/json"
        "X-Wifi-Watchdog-Key" = $SecretKey
    }

    try {
        $syncUrl = "$ServerUrl/api/wifi-sync"
        $response = Invoke-RestMethod -Uri $syncUrl -Method Post -Body $payload -Headers $headers -TimeoutSec 4 -ErrorAction Stop

        $d = $response.data
        $isLocked = [bool]$d.is_locked
        $authSsid = $d.authorized_ssid
        $currSsid = $wifiInfo.ssid

        if (-not $wifiInfo.connected) {
            Write-Host "[$now] [ALERT - DISCONNECTED] Host Wi-Fi is disconnected! Platform is LOCKED." -ForegroundColor Red
        } elseif ($isLocked -and ($currSsid -ne $authSsid)) {
            Write-Host "[$now] [VIOLATION] Connected to '$currSsid', required '$authSsid'! Platform is LOCKED." -ForegroundColor Magenta
        } else {
            $statusText = if ($isLocked) { "LOCKED & GUARDED" } else { "MONITORING (UNLOCKED)" }
            $dispSsid = if ($currSsid) { "'$currSsid'" } else { "LAN/Ethernet" }
            Write-Host "[$now] [HEALTHY] $statusText -> Network: $dispSsid | IP: $($wifiInfo.ip) | GW: $($wifiInfo.gateway)" -ForegroundColor Green
        }
    } catch {
        Write-Host "[$now] [WARNING] Server communication error: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    $firstRun = $false
    Start-Sleep -Seconds $Interval
}
