# Build every package that has a src/ directory (i.e. lib/ is a tsc artifact).
#
# Usage (from the repo root):
#   powershell -File scripts\build-all.ps1                 # build all
#   powershell -File scripts\build-all.ps1 -OnlyMissing    # only packages whose main entry is missing
#   powershell -File scripts\build-all.ps1 -SkipInstall    # skip npm install (deps already present)
#
# NOTE: this file is intentionally pure ASCII. Windows PowerShell 5.1 decodes a
# .ps1 without a BOM as ANSI, so non-ASCII text here breaks parsing unless the
# file keeps its BOM. English-only text avoids that whole class of failure.

[CmdletBinding()]
param(
    [switch]$OnlyMissing,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$packagesRoot = Join-Path $repoRoot 'packages'

# Packages whose lib/ is produced by tsc. dsh-cc-tui uses pnpm, the rest use npm.
$targets = @(
    'dsh-balance',
    'dsh-image-gen',
    'dsh-import',
    'dsh-moon-band',
    'dsh-novel-pane',
    'dsh-remote-exec',
    'dsh-team',
    'dsh-cc-tui'
)

$failed = @()
$skipped = @()
$built = @()

foreach ($name in $targets) {
    $dir = Join-Path $packagesRoot $name
    $pkgJson = Join-Path $dir 'package.json'

    if (-not (Test-Path $pkgJson)) {
        Write-Host "[skip] $name - directory not found" -ForegroundColor DarkGray
        $skipped += $name
        continue
    }

    # Read as UTF-8 on purpose: package.json holds non-ASCII text, and PS 5.1
    # would otherwise decode it as ANSI and corrupt the JSON.
    $pkg = Get-Content $pkgJson -Raw -Encoding UTF8 | ConvertFrom-Json
    $main = $pkg.main
    $mainPath = $null
    if ($main) { $mainPath = Join-Path $dir $main }

    if ($OnlyMissing -and $mainPath -and (Test-Path $mainPath)) {
        Write-Host "[skip] $name - $main already present" -ForegroundColor DarkGray
        $skipped += $name
        continue
    }

    $pm = 'npm'
    if (Test-Path (Join-Path $dir 'pnpm-lock.yaml')) { $pm = 'pnpm' }

    Write-Host ""
    Write-Host "=== $name  ($pm) ===" -ForegroundColor Cyan

    try {
        Push-Location $dir
        try {
            if (-not $SkipInstall) {
                Write-Host "  $pm install"
                & $pm install 2>&1 | ForEach-Object { "  $_" }
                if ($LASTEXITCODE -ne 0) { throw "$pm install failed (exit $LASTEXITCODE)" }
            }

            if (-not $pkg.scripts.build) { throw "no build script in package.json" }

            Write-Host "  $pm run build"
            & $pm run build 2>&1 | ForEach-Object { "  $_" }
            if ($LASTEXITCODE -ne 0) { throw "$pm run build failed (exit $LASTEXITCODE)" }

            if ($mainPath -and -not (Test-Path $mainPath)) {
                throw "build finished but entry '$main' is still missing"
            }
            $built += $name
            Write-Host "  OK" -ForegroundColor Green
        }
        finally {
            Pop-Location
        }
    }
    catch {
        $failed += $name
        Write-Host "  FAIL: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "================ summary ================"
Write-Host ("  ok      {0}: {1}" -f $built.Count, ($built -join ', '))
if ($skipped.Count) { Write-Host ("  skipped {0}: {1}" -f $skipped.Count, ($skipped -join ', ')) -ForegroundColor DarkGray }
if ($failed.Count) {
    Write-Host ("  failed  {0}: {1}" -f $failed.Count, ($failed -join ', ')) -ForegroundColor Red
    exit 1
}
Write-Host "  all good" -ForegroundColor Green
