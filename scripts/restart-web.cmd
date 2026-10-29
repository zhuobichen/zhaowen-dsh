@echo off
chcp 65001 >nul
setlocal

rem Restart dsh web with public URL and show pairing QR code.
rem All logic lives in restart-web.ps1 (UTF-8). This wrapper is ASCII only
rem so cmd.exe's OEM codepage can never corrupt it.

set "SCRIPT=%~dp0restart-web.ps1"

where pwsh >nul 2>nul
if errorlevel 1 (
    echo [info] pwsh not found, falling back to powershell.exe
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
)

echo.
echo Logs: %LOCALAPPDATA%\dsh-tunnel\
pause
endlocal
