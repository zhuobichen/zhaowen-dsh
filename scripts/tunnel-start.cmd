@echo off
chcp 65001 >nul
setlocal

rem Start frpc + its watchdog detached from this console.
rem ASCII only: cmd.exe reads this file in the OEM codepage.

set "DIR=%LOCALAPPDATA%\dsh-tunnel"
set "WATCH=%~dp0tunnel-watchdog.ps1"

if not exist "%DIR%\frpc.exe" (
    echo [X] frpc.exe not found in %DIR%
    pause
    exit /b 1
)

echo [1/3] start frpc...
tasklist /FI "IMAGENAME eq frpc.exe" 2>nul | find /i "frpc.exe" >nul
if errorlevel 1 (
    start "" /min "%DIR%\frpc.exe" -c "%DIR%\frpc.toml"
) else (
    echo     already running
)

echo [2/3] start watchdog...
tasklist /FI "IMAGENAME eq pwsh.exe" 2>nul | find /i "pwsh.exe" >nul
if errorlevel 1 (
    echo     (pwsh not running yet, watchdog will be started anyway)
)

start "" /min pwsh -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%WATCH%"

echo [3/3] done. tunnel should be up in a few seconds.
echo.
echo Tip: put a shortcut to this file into shell:startup to auto-start on logon.
timeout /t 5 >nul
endlocal
