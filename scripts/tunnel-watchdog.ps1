# frpc 守护：每 20 秒检查一次，掉了就重新拉起（不依赖任何终端窗口）
$dir = "$env:LOCALAPPDATA\dsh-tunnel"
$exe = "$dir\frpc.exe"
$cfg = "$dir\frpc.toml"
$log = "$dir\watchdog.log"

function Write-Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Path $log -Encoding utf8
}

Write-Log "watchdog 启动"

while ($true) {
    $proc = Get-Process frpc -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Log "frpc 不在，重新拉起"
        try {
            Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "start", '""', "/min", "`"$exe`"", "-c", "`"$cfg`"" -WindowStyle Hidden
        } catch {
            Write-Log "拉起失败: $($_.Exception.Message)"
        }
    } elseif (($proc | Measure-Object).Count -gt 1) {
        # 多个实例只保留最早的那个
        $sorted = $proc | Sort-Object StartTime
        $sorted | Select-Object -Skip 1 | ForEach-Object {
            Write-Log "发现重复 frpc PID $($_.Id)，结束"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 20
}
