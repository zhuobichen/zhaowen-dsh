# Start the Doubao desktop app with a CDP debugging port.
#
# This file carries a UTF-8 BOM on purpose: Windows PowerShell 5.1 reads a
# BOM-less UTF-8 .ps1 as ANSI and would corrupt the Chinese install path.
#
# ---------------------------------------------------------------------------
# Three things have to be right, and each one silently fails on its own:
#
# 1) THE POLICY. Doubao 2.32.4 ships Chromium with remote debugging disabled by
#    policy. Passing --remote-debugging-port alone does nothing: the port never
#    listens. The switch is the Chromium enterprise policy
#    `RemoteDebuggingAllowed=1`, and it has to go into the registry under
#    `...\SOFTWARE\Policies\Chromium` (writing there needs admin). Doubao's own
#    binary carries the string "DevTools remote debugging is disallowed by the
#    system admin" - that is this check.
#
# 2) WHICH EXE. `D:\豆包\Doubao\Doubao.exe` is the launcher; it DOES forward the
#    user's arguments to `app\Doubao.exe` as `"%s" %s --start_time=%llu`.
#    Launching `app\Doubao.exe` directly exits immediately, so use the launcher.
#
# 3) WHICH PROFILE. The port only opens with a non-default --user-data-dir.
#    But an empty profile is not logged in, and Doubao answers with text and
#    prompt rewrites instead of drawing. Point at the real profile
#    (`%LOCALAPPDATA%\Doubao\User Data`, profile "Default") - it counts as
#    non-default for the argv check and it keeps the login.
#
# Override with env vars: DOUBAO_PORT, DOUBAO_USER_DATA_DIR, DOUBAO_PROFILE_DIR,
# DOUBAO_EXE, DOUBAO_RESTART=1.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

$port = if ($env:DOUBAO_PORT) { $env:DOUBAO_PORT } else { '9333' }
$exe = if ($env:DOUBAO_EXE) { $env:DOUBAO_EXE } else { 'D:\豆包\Doubao\Doubao.exe' }
$userDataDir = if ($env:DOUBAO_USER_DATA_DIR) { $env:DOUBAO_USER_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'Doubao\User Data' }
$profileDir = if ($env:DOUBAO_PROFILE_DIR) { $env:DOUBAO_PROFILE_DIR } else { 'Default' }

function Test-Cdp {
    param([string]$Port)
    try {
        Invoke-WebRequest "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 3 | Out-Null
        return $true
    } catch { return $false }
}

# --- 1. policy ---
foreach ($key in @('HKLM:\SOFTWARE\Policies\Chromium', 'HKCU:\SOFTWARE\Policies\Chromium')) {
    try {
        if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
        New-ItemProperty -Path $key -Name 'RemoteDebuggingAllowed' -Value 1 -PropertyType DWord -Force | Out-Null
        New-ItemProperty -Path $key -Name 'DevToolsRemoteDebuggingAllowed' -Value 1 -PropertyType DWord -Force | Out-Null
        Write-Host "[i] policy written: $key"
    } catch {
        Write-Host "[!] could not write $key - run this script as administrator."
        Write-Host "    ($($_.Exception.Message))"
    }
}

# --- 2. already up? ---
if (Test-Cdp -Port $port) {
    Write-Host "[OK] http://127.0.0.1:$port is already up"
    exit 0
}

# --- 3. optional restart ---
if ($env:DOUBAO_RESTART -eq '1') {
    Get-Process -Name 'Doubao' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    Write-Host '[i] existing Doubao processes stopped'
}

# --- 4. launch ---
if (-not (Test-Path -LiteralPath $exe)) {
    Write-Host "[x] Doubao not found: $exe"
    Write-Host '    Set DOUBAO_EXE if it is installed somewhere else.'
    exit 1
}
if (-not (Test-Path -LiteralPath $userDataDir)) {
    Write-Host "[x] profile dir not found: $userDataDir"
    Write-Host '    Point DOUBAO_USER_DATA_DIR at the real profile so the session stays logged in.'
    exit 1
}

Write-Host "[i] launching: $exe"
Write-Host "    port=$port  user-data-dir=$userDataDir  profile-directory=$profileDir"
Start-Process -FilePath $exe `
    -ArgumentList "--remote-debugging-port=$port", "--user-data-dir=$userDataDir", "--profile-directory=$profileDir" `
    -WorkingDirectory (Split-Path -LiteralPath $exe -Parent) | Out-Null

Write-Host '[i] waiting for the debug port (up to 80s)...'
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Cdp -Port $port) {
        Write-Host "[OK] http://127.0.0.1:$port is up after $($i * 2 + 2)s"
        exit 0
    }
}

Write-Host "[x] debug port never came up."
Write-Host '    Check, in this order:'
Write-Host '      1. the policy actually landed (reg query "HKLM\SOFTWARE\Policies\Chromium")'
Write-Host '      2. you launched the LAUNCHER exe, not app\Doubao.exe'
Write-Host '      3. security software is not blocking the listening socket'
exit 1
