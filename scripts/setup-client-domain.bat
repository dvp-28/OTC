@echo off
:: ============================================================================
:: EKALAVYA LMS - CLIENT PC QUICK DOMAIN & TLS SETUP
:: Officers Training College (OTC), AMC Centre & College, Lucknow
:: ============================================================================
:: Purpose: Maps friendly domain name (ekalavya.local / lms.otc) and trusts
::          air-gapped TLS certificate on client workstations with 1 click.
:: ============================================================================

set SERVER_IP=192.168.29.88
set DOMAIN_NAME=ekalavya.local
set HOSTS_FILE=%WINDIR%\System32\drivers\etc\hosts

:: Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo ============================================================================
    echo [!] ADMINISTRATOR PRIVILEGES REQUIRED
    echo ============================================================================
    echo Please right-click this file and select 'Run as Administrator'.
    echo ============================================================================
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo   EKALAVYA LMS - AIR-GAPPED LOCAL DOMAIN SETUP
echo ============================================================================
echo   Server IP    : %SERVER_IP%
echo   Local Domain : %DOMAIN_NAME%
echo ============================================================================
echo.

:: 1. Add entry to Windows hosts file
echo [*] Checking Windows hosts file...
findstr /i "%DOMAIN_NAME%" "%HOSTS_FILE%" >nul 2>&1
if %errorLevel% neq 0 (
    echo [*] Adding %SERVER_IP% %DOMAIN_NAME% to %HOSTS_FILE%...
    echo. >> "%HOSTS_FILE%"
    echo # Ekalavya LMS Air-Gapped Local Domain >> "%HOSTS_FILE%"
    echo %SERVER_IP%    %DOMAIN_NAME% >> "%HOSTS_FILE%"
    echo %SERVER_IP%    lms.otc >> "%HOSTS_FILE%"
    echo [+] Successfully added %DOMAIN_NAME% to hosts file!
) else (
    echo [=] Domain %DOMAIN_NAME% already mapped in hosts file.
)

:: 2. Optional: Install local TLS certificate for green padlock
set CERT_PATH=%~dp0..\certs\ekalavya.crt
if exist "%CERT_PATH%" (
    echo [*] Installing local TLS certificate into Trusted Root Store...
    certutil -addstore -f "Root" "%CERT_PATH%" >nul 2>&1
    if %errorLevel% equ 0 (
        echo [+] Certificate installed successfully! Browser warning cleared.
    ) else (
        echo [!] Certificate installation skipped or returned non-zero.
    )
)

echo.
echo ============================================================================
echo [SUCCESS] Domain wrapping complete!
echo.
echo You can now open your browser and navigate directly to:
echo   https://%DOMAIN_NAME%
echo   or
echo   https://lms.otc
echo ============================================================================
echo.
pause
