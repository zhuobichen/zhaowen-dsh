import { spawn } from 'node:child_process';
/**
 * Run a command without throwing: resolves with `{ code, stdout, stderr }`
 * even when the process exits non-zero or cannot spawn.
 * @param file - The executable path to spawn.
 * @param args - Command-line arguments; defaults to none.
 * @param options - Spawn options (input, timeout, cwd).
 * @returns The process outcome: exit code, captured stdout, and captured stderr.
 */
export function execFileNoThrow(file, args, options) {
    // 门禁（docs/门禁-等待与取消.md）：不允许「只有 close 一条 settle 路径」。
    // 调用方不传 timeout 时给默认上限；到点必须**自己 settle**，
    // 而不是 kill 完继续等 close（那曾在 Windows 上把整个会话挂死）。
    const timeoutMs = options?.timeout ?? 5 * 60_000;
    return new Promise(resolve => {
        let settled = false;
        let stdout = '';
        let stderr = '';
        const finish = (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        };
        const child = spawn(file, args ?? [], { cwd: options?.cwd });
        const timer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            }
            catch {
                /* 可能已经退了 */
            }
            try {
                child.stdout?.destroy();
            }
            catch {
                /* ignore */
            }
            try {
                child.stderr?.destroy();
            }
            catch {
                /* ignore */
            }
            // 超时按「跑完了但失败」处理：code 为 null，调用方看得出来不是正常退出
            finish(null);
        }, timeoutMs);
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', () => {
            finish(1);
        });
        child.on('close', code => {
            finish(code);
        });
        if (options?.input !== undefined)
            child.stdin.write(options.input);
        child.stdin.end();
    });
}
