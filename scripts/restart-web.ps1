# 一键开启「手机远程」：认证代理 → frp 隧道(东京) → 重启 DSH → 二维码
# 用法：双击 restart-web.cmd，并保持该窗口开着（关掉 = 远程断开）

$ErrorActionPreference = "Continue"
$dir       = "$env:LOCALAPPDATA\dsh-tunnel"
$dshHome   = "D:\github_project\ZhaoWen_GitHub维护\dsh\home"
$toolchain = "D:\github_project\ZhaoWen_GitHub维护\dsh\toolchain"
$proxyJs   = "D:\github_project\ZhaoWen_GitHub维护\zhaowen-dsh\scripts\dsh-auth-proxy.mjs"
$credsFile = "$dir\creds.json"
$publicUrl = "https://43.133.171.234:8443"
$publicHost = "43.133.171.234:8443"
$frpcLog   = "$dir\frpc.log"
$dshLog    = "$dir\dsh-web.log"
$dshErr    = "$dir\dsh-web.err.log"

function Test-Port($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}
function Wait-Port($port, $seconds) {
    for ($i = 0; $i -lt $seconds; $i++) { if (Test-Port $port) { return $true }; Start-Sleep -Seconds 1 }
    return (Test-Port $port)
}

Write-Host "================ DSH 手机远程（东京 frp）================"
Write-Host ""

if (-not (Test-Path $credsFile)) {
    Write-Host "[X] 缺少凭据文件: $credsFile"; Read-Host "按回车退出"; exit 1
}
$creds = Get-Content $credsFile -Raw | ConvertFrom-Json

# ---------- 1/5 清理 ----------
Write-Host "[1/5] 清理旧的代理与隧道..."
Get-Process frpc -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*auth-proxy*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Write-Host "      已清理"

# ---------- 2/5 认证代理 ----------
Write-Host "[2/5] 认证代理 (127.0.0.1:3081)..."
Start-Process -FilePath "node" `
    -ArgumentList $proxyJs, $creds.user, $creds.pass, "3081", "3080" `
    -WindowStyle Hidden -RedirectStandardOutput "$dir\proxy.log" -RedirectStandardError "$dir\proxy.err.log"
if (Wait-Port 3081 15) { Write-Host "      OK" } else {
    Write-Host "      失败，看 $dir\proxy.err.log"; Read-Host "按回车退出"; exit 1
}

# ---------- 3/5 frp 隧道 ----------
Write-Host "[3/5] frp 隧道 -> 43.133.171.234:7000 ..."
if (Test-Path $frpcLog) { Remove-Item $frpcLog -Force -ErrorAction SilentlyContinue }
Start-Process -FilePath "$dir\frpc.exe" -ArgumentList "-c", "$dir\frpc.toml" -WindowStyle Hidden
$tunnelOk = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $t = Get-Content $frpcLog -Raw -ErrorAction SilentlyContinue
    if ($t -match "start proxy success") { $tunnelOk = $true; break }
}
if ($tunnelOk) { Write-Host "      隧道已建立" } else {
    Write-Host "      隧道没起来，日志："; Get-Content $frpcLog -Tail 8 -ErrorAction SilentlyContinue
}

# ---------- 4/5 重启 DSH ----------
Write-Host "[4/5] 重启 dsh web（公网入口 $publicUrl）..."
Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "      结束 PID $($_.OwningProcess)"
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

Remove-Item $dshLog, $dshErr -Force -ErrorAction SilentlyContinue
$env:DSH_HOME = $dshHome
$proc = Start-Process -FilePath "node" `
    -ArgumentList "node_modules\@deepseek-ai\dsh\lib\bin.js","web","--public-url",$publicUrl,"--trusted-host",$publicHost `
    -WorkingDirectory $toolchain `
    -RedirectStandardOutput $dshLog -RedirectStandardError $dshErr -WindowStyle Hidden -PassThru

# ---------- 5/5 登录地址 + 二维码 ----------
Write-Host "[5/5] 等待 DSH 启动..."
$tokenUrl = $null
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $dshLog) {
        $m = Select-String -Path $dshLog -Pattern 'dsh web:\s*(https?://\S+)' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $tokenUrl = $m.Matches[0].Groups[1].Value; break }
    }
}

Write-Host ""
if ($tokenUrl) {
    $tokenUrl | Set-Content "$dir\url.txt" -Encoding utf8
    Write-Host "================================================"
    Write-Host " 手机访问地址:"
    Write-Host " $tokenUrl"
    Write-Host ""
    Write-Host " 账号: $($creds.user)"
    Write-Host " 密码: $($creds.pass)"
    Write-Host "================================================"
    Write-Host ""
    Write-Host " 证书是自签的，手机会提示不安全 -> 高级 -> 继续访问"
    Write-Host " !!! 不要关闭这个窗口，关掉远程就断了 !!!"
    Write-Host ""

    $qr = "$dir\pair.png"
    @'
import sys, qrcode
qr = qrcode.QRCode(box_size=10, border=3)
qr.add_data(sys.argv[1]); qr.make(fit=True)
qr.make_image().save(sys.argv[2])
'@ | Set-Content -Path "$dir\mkqr.py" -Encoding utf8
    try {
        & python "$dir\mkqr.py" $tokenUrl $qr 2>$null
        if (Test-Path $qr) { Start-Process $qr }
    } catch { }
} else {
    Write-Host "没抓到登录地址。进程状态：$(if ($proc.HasExited) { "已退出 exit=$($proc.ExitCode)" } else { "运行中" })"
    if (Test-Path $dshErr) { Get-Content $dshErr -Tail 15 }
}

Write-Host ""
Read-Host "按回车关闭本窗口（会断开远程），最小化可保持连接"
