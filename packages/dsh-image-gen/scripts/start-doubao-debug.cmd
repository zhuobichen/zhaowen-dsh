@echo off
rem Start the isolated Doubao debug instance. The real work lives in the
rem PowerShell script because non-ASCII install paths are unreliable in cmd.
rem This wrapper stays ASCII-only.

set "SCRIPT=%~dp0start-doubao-debug.ps1"

where pwsh >nul 2>nul
if errorlevel 1 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
)

pause
