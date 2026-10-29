@echo off
TITLE Ekalavya LMS - Wi-Fi Security Guard
echo =========================================================================
echo  Starting Air-Gapped Wi-Fi Security Guard Watchdog...
echo  Officers Training College (OTC), AMC Centre and College, Lucknow
echo =========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wifi-watchdog.ps1" -AutoLock %*
pause
