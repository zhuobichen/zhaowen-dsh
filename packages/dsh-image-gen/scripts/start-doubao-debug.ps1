# Start an isolated Doubao desktop instance with a CDP debugging port.
# This file carries a UTF-8 BOM on purpose: Windows PowerShell 5.1 reads a
# BOM-less UTF-8 .ps1 as ANSI and would corrupt the Chinese install path.
#
# Override with env vars: DOUBAO_PORT, DOUBAO_PROFILE, DOUBAO_EXE.
# Do NOT enable the debugging port on your daily Doubao profile: the port is a
# local backdoor that lets any local process drive that window.

$ErrorActionPreference = 'Stop'

$port = if ($env:DOUBAO_PORT) { $env:DOUBAO_PORT } else { '9333' }
$profileDir = if ($env:DOUBAO_PROFILE) { $env:DOUBAO_PROFILE } else { 'D:\github_project\ZhaoWen_GitHub维护\_doubao-profile' }
$exe = if ($env:DOUBAO_EXE) { $env:DOUBAO_EXE } else { 'D:\豆包\Doubao\app\Doubao.exe' }

if (-not (Test-Path -LiteralPath $exe)) {
    Write-Host "[x] Doubao not found: $exe"
    Write-Host '    Set DOUBAO_EXE if it is installed somewhere else.'
    exit 1
}

if (-not (Test-Path -LiteralPath $profileDir)) {
    New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
}

Write-Host "[i] starting Doubao (debug port $port, profile: $profileDir)"
Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$port", "--user-data-dir=$profileDir", '--no-first-run'

Write-Host '[i] waiting for the debug port...'
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        Invoke-WebRequest "http://127.0.0.1:$port/json/version" -UseBasicParsing -TimeoutSec 3 | Out-Null
        Write-Host "[OK] http://127.0.0.1:$port is up"
        Write-Host '     If this is the first run, scan the QR code in that Doubao window once.'
        exit 0
    } catch {
        # keep waiting
    }
}

Write-Host "[x] debug port still not reachable. Check that Doubao started and that $port is free."
exit 1
