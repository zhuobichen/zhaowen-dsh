/**
 * dsh-sandbox-grant —— 给指定会话切换沙箱模式。
 *
 * 为什么需要：
 *   DSH 每个会话有一个沙箱模式（read-only / workspace-write / danger-full-access），
 *   由 `dsh-sandbox-policy` 以一条 `sandbox/mode` 会话事件承载，可跨重启回放。
 *   Windows 上 `workspace-write` 会把子进程降级成**低完整性受限令牌**，
 *   只允许写工作区与私有临时目录——于是"启动 NapCat""连 ToDesk IPC""写 %USERPROFILE%"
 *   这类事全部 Access denied。本插件让指定会话切到 danger-full-access。
 *
 * 安全设计（这是提权面，按"越用越安全"那侧做）：
 *   1. **降级永远允许**（read-only / workspace-write）：收紧权限不需要审批。
 *   2. **升级到 danger-full-access** 只允许两种调用方：
 *        a. 调用方给自己提权（self-grant）；
 *        b. 调用方标题在 config.escalationOwners 里（默认 ['管理Bot']）。
 *      除此之外一律拒绝，并给出拒绝原因。
 *   3. 只对**活会话**生效：冷会话没有 live Session 对象，拒绝而不是去重放日志猜。
 *   4. 每次变更写一条审计到 $DSH_HOME/plugins/dsh-sandbox-grant/audit.jsonl。
 *
 * 不做什么：
 *   - 不提供"恢复出厂"之类的破坏性操作；收回权限 = 切回 workspace-write。
 *   - 不改 approval 策略（本插件只管沙箱模式，审批归 dsh-user-approval）。
 *
 * host_exec（默认关闭，按会话授权）：
 *   沙箱模式改的是"给多少写权限"，但 spawn 时的降级令牌由沙箱后端打上，
 *   模式切到 danger-full-access 也不会解除。插件代码本身跑在宿主进程里
 *   （正常令牌），所以 host_exec 直接用 node:child_process 派生子进程，
 *   绕过 ctx.subprocess / 沙箱后端。
 *
 *   代价明确：这是给 agent 的无沙箱执行入口。因此：
 *     - config.hostExec.enabled 默认 false，必须用户显式打开；
 *     - config.hostExec.authorizedSessions 列出**允许的会话 id**（完整或唯一前缀），
 *       不在名单里的会话调用一律 ESCALATION_DENIED；
 *     - 每次调用写完整命令 + 退出码到审计。
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import { SANDBOX_MODES, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'

export const name = 'sandbox-grant'

/** 只在调用时用到的服务，缺了就如实报不可用，不假装成功。 */
export const inject = ['tools']

const ESCALATED = 'danger-full-access'

/** 审计文件：写失败只影响可追溯性，不影响功能。 */
function auditPath() {
	const home = process.env.DSH_HOME || join(homedir(), '.dsh')
	const dir = join(home, 'plugins', 'dsh-sandbox-grant')
	try {
		mkdirSync(dir, { recursive: true })
	} catch {
		// 目录建不出来就让 append 自己失败，下面 try 包住
	}
	return join(dir, 'audit.jsonl')
}

function audit(record) {
	try {
		appendFileSync(auditPath(), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n')
	} catch {
		// 审计写不进去不能阻断操作，但也别抛
	}
}

function serviceOf(ctx, serviceName) {
	try {
		if (typeof ctx?.get === 'function') {
			const found = ctx.get(serviceName)
			if (found !== undefined && found !== null) return found
		}
	} catch {
		// 服务未就绪时 ctx.get 会抛：退到属性访问
	}
	try {
		return ctx?.[serviceName]
	} catch {
		return undefined
	}
}

/** 取活会话；拿不到返回 undefined（不猜、不重放日志）。 */
function liveSessionOf(ctx, sessionId) {
	const sessions = serviceOf(ctx, 'sessions')
	if (sessions === undefined || typeof sessions.get !== 'function') return undefined
	try {
		return sessions.get(sessionId)
	} catch {
		return undefined
	}
}

function callerSessionOf(exec) {
	const agent = exec?.agent
	return agent?.session ?? undefined
}

/** 会话标题：投影里的 title，取不到就用 id 兜底。 */
function titleOf(session) {
	try {
		const values = session?.projections?.values
		const title = values?.title?.title ?? values?.title
		if (typeof title === 'string' && title.trim() !== '') return title.trim()
	} catch {
		// ignore
	}
	return undefined
}

function sameSession(a, b) {
	if (a === undefined || b === undefined) return false
	if (a === b) return true
	const aid = a.id ?? a.sessionId
	const bid = b.id ?? b.sessionId
	return aid !== undefined && aid === bid
}

const OUTPUT = {
	schema: {
		type: 'object',
		additionalProperties: true,
		properties: {
			ok: { type: 'boolean', required: true },
			code: { type: 'string' },
			error: { type: 'string' },
			target: { type: 'string' },
			mode: { type: 'string' },
			escalated: { type: 'boolean' },
			note: { type: 'string' },
			audit: { type: 'string' },
			candidates: { type: 'array', items: { type: 'string' } },
			exit_code: { type: 'number' },
			stdout: { type: 'string' },
			stderr: { type: 'string' },
			duration_ms: { type: 'number' },
			truncated: { type: 'boolean' },
			timed_out: { type: 'boolean' },
			aborted: { type: 'boolean' },
			detached: { type: 'boolean' },
			pid: { type: 'number' },
			hint: { type: 'string' },
			count: { type: 'number' },
			sessions: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, title: { type: 'string' } } } },
		},
	},
	render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

export function apply(ctx, config = {}) {
	const owners = Array.isArray(config.escalationOwners) && config.escalationOwners.length > 0
		? config.escalationOwners.map((s) => String(s))
		: ['管理Bot']

	ctx.tools.register(
		defineTool({
			name: 'sandbox_grant',
			description:
				'给指定会话切换沙箱模式。' +
				'降级（read-only / workspace-write）总是允许；' +
				'升级到 danger-full-access 仅允许"给自己提权"或调用方标题在 escalationOwners 中。' +
				'只对活会话生效，冷会话返回错误。每次变更写审计。',
			parameters: {
				session_id: { type: 'string', required: true, description: '目标会话 id（支持前缀匹配当前活会话）。' },
				mode: {
					type: 'string',
					required: true,
					enum: [...SANDBOX_MODES],
					description: 'read-only | workspace-write | danger-full-access',
				},
				reason: { type: 'string', description: '可选：为什么要改，写进审计。' },
			},
			output: OUTPUT,
			execute: async (args, exec) => {
				const rawId = String(args.session_id ?? '').trim()
				const mode = String(args.mode ?? '').trim()

				if (!SANDBOX_MODES.includes(mode)) {
					return { ok: false, code: 'BAD_MODE', error: `不认识的模式 ${mode}；可用：${SANDBOX_MODES.join(', ')}` }
				}
				if (rawId === '') {
					return { ok: false, code: 'MISSING_SESSION', error: 'session_id 不能为空' }
				}

				const caller = callerSessionOf(exec)
				const callerId = caller?.id ?? caller?.sessionId
				const sessions = serviceOf(ctx, 'sessions')

				if (sessions === undefined || typeof sessions.get !== 'function') {
					return { ok: false, code: 'NO_SESSION_STORE', error: '当前部署取不到 ctx.sessions，无法按 id 定位会话。' }
				}

				// 精确 id 优先；否则唯一前缀匹配（多义就报错，绝不猜）
				let target = liveSessionOf(ctx, rawId)
				if (target === undefined && typeof sessions.list === 'function') {
					let all = []
					try {
						all = Array.from(sessions.list() ?? [])
					} catch {
						all = []
					}
					const matches = all.filter((s) => String(s?.id ?? s?.sessionId ?? '').startsWith(rawId))
					if (matches.length === 1) target = matches[0]
					else if (matches.length > 1) {
						return {
							ok: false,
							code: 'AMBIGUOUS_SESSION',
							error: `前缀 ${rawId} 命中 ${matches.length} 个会话，请给更完整的 id`,
							candidates: matches.map((s) => s?.id ?? s?.sessionId),
						}
					}
				}

				if (target === undefined) {
					return {
						ok: false,
						code: 'NOT_LIVE',
						error: `找不到活会话 ${rawId}；本插件只对活会话生效（冷会话需要用户在前端切模式）`,
					}
				}

				const targetId = target?.id ?? target?.sessionId ?? rawId
				const callerTitle = titleOf(caller)
				const self = sameSession(target, caller)
				const ownerCaller = callerTitle !== undefined && owners.includes(callerTitle)

				// 升级守卫：只有 self 或白名单调用方
				if (mode === ESCALATED && !self && !ownerCaller) {
					return {
						ok: false,
						code: 'ESCALATION_DENIED',
						error:
							`拒绝升级：目标 ${targetId} 不是调用方自己，调用方标题「${callerTitle ?? '(未知)'}」也不在 escalationOwners(${owners.join(', ')}) 里。` +
							'降级到 read-only / workspace-write 仍然允许。',
					}
				}

				try {
					setSandboxMode(target, mode)
				} catch (err) {
					return { ok: false, code: 'SET_FAILED', error: `写入 sandbox/mode 失败：${err?.message ?? err}` }
				}

				audit({
					action: 'set',
					from: 'unknown',
					to: mode,
					target: targetId,
					caller: callerId ?? null,
					callerTitle: callerTitle ?? null,
					self,
					reason: typeof args.reason === 'string' ? args.reason : null,
				})

				return {
					ok: true,
					target: targetId,
					mode,
					escalated: mode === ESCALATED,
					note: '已记录一条 sandbox/mode 事件；对该会话之后的下一次受限调用生效（bash/文件操作）。',
					audit: auditPath(),
				}
			},
		}),
	)


	// ── host_exec：默认关闭、按会话授权的无沙箱执行 ─────────────────────
	const hostExecCfg = config.hostExec ?? {}
	const hostExecEnabled = hostExecCfg.enabled === true
	const hostExecConfigSessions = Array.isArray(hostExecCfg.authorizedSessions)
		? hostExecCfg.authorizedSessions.map((s) => String(s))
		: []

	/** 额外授权写在文件里，调用时现读——加会话不用重启 DSH。 */
	function hostExecAuthorizedFile() {
		const home = process.env.DSH_HOME || join(homedir(), '.dsh')
		return join(home, 'plugins', 'dsh-sandbox-grant', 'authorized.json')
	}

	function hostExecSessionsNow() {
		let extra = []
		try {
			const raw = readFileSync(hostExecAuthorizedFile(), 'utf-8')
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) extra = parsed.map((x) => String(x))
		} catch {
			// 文件不存在或写坏了：只用 config 里的名单
		}
		return [...new Set([...hostExecConfigSessions, ...extra])]
	}
	const hostExecTimeout = Number(hostExecCfg.timeoutMs) > 0 ? Number(hostExecCfg.timeoutMs) : 120000
	const MAX_OUT = 8192

	/**
	 * 杀掉**整棵进程树**。
	 *
	 * ⚠️ 这是修过的一个真事故：只 `child.kill()` 在 Windows 上等于
	 * `TerminateProcess` 打**直接子进程**一个。而 `cmd /c "start /B ..."` 这种写法
	 * 会把真正的活儿丢给孙进程，孙进程继续跑、并且**继承着宿主给的 stdout/stderr 管道**。
	 * 于是 `child.on('close')`（只在管道全关时触发）永远不触发 ——
	 * 超时到了也只杀掉一个已经退出的壳，调用**永久挂起**，
	 * 连 UI 上的停止键都按不动（因为下面还完全不看 abort signal）。
	 * 用 `taskkill /T /F` 连树一起收，再把管道 destroy 掉，才能让调用真的结束。
	 */
	function killTree(child) {
		try {
			if (process.platform === 'win32' && child.pid) {
				spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
					windowsHide: true,
					timeout: 10000,
				})
			} else {
				child.kill('SIGKILL')
			}
		} catch {
			// 进程可能已经没了
		}
	}

	/**
	 * 跑一个进程并**保证一定会 resolve**：正常退出 / 超时 / 被取消，三条路都会结束。
	 *
	 * `signal` 是 DSH 传进来的 `exec.signal`（`Required caller-owned cancellation`）。
	 * 不接它的后果很严重：UI 上的停止键按了也没反应，那个调用会一直挂在队列里。
	 */
	function runProcess(argv, cwdOpt, timeoutMs, signal) {
		return new Promise((resolve) => {
			const started = Date.now()
			let out = ''
			let err = ''
			let truncated = false
			let settled = false

			const child = spawn(argv[0], argv.slice(1), { cwd: cwdOpt, windowsHide: true, shell: false })

			const finish = (code, extra = {}) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				if (signal) {
					try {
						signal.removeEventListener('abort', onAbort)
					} catch {
						// ignore
					}
				}
				// 关键：主动关掉管道。孙进程可能还活着并持有写端，
				// 不 destroy 的话宿主侧的 'close' 依旧不会来。
				try {
					child.stdout?.destroy()
				} catch {
					// ignore
				}
				try {
					child.stderr?.destroy()
				} catch {
					// ignore
				}
				try {
					child.unref()
				} catch {
					// ignore
				}
				resolve({
					exit_code: code,
					stdout: out.slice(0, MAX_OUT),
					stderr: (extra.stderrOverride ?? err).slice(0, MAX_OUT),
					duration_ms: Date.now() - started,
					truncated,
					...(extra.timed_out ? { timed_out: true } : {}),
					...(extra.aborted ? { aborted: true } : {}),
				})
			}

			const timer = setTimeout(() => {
				killTree(child)
				finish(-1, { timed_out: true })
			}, timeoutMs)

			const onAbort = () => {
				killTree(child)
				finish(-1, { aborted: true })
			}

			if (signal) {
				if (signal.aborted) {
					// 进来之前就已经取消了
					killTree(child)
					finish(-1, { aborted: true })
					return
				}
				signal.addEventListener('abort', onAbort, { once: true })
			}

			child.stdout?.on('data', (b) => {
				if (out.length < MAX_OUT) out += b.toString('utf8')
				else truncated = true
			})
			child.stderr?.on('data', (b) => {
				if (err.length < MAX_OUT) err += b.toString('utf8')
				else truncated = true
			})
			child.on('error', (e) => finish(-1, { stderrOverride: String(e?.message ?? e) }))
			child.on('close', (code) => finish(typeof code === 'number' ? code : -1))
		})
	}

	/**
	 * 起一个**长驻**进程并立刻返回。
	 *
	 * 为什么需要：`host_exec` 是「跑完再返回」的同步语义。拿它去起 watchdog / NapCat /
	 * MCP server 这类**永不退出**的服务，本来就只能靠超时脱身 —— 而超时又曾经
	 * 不生效（见 killTree 的注释），于是整条调用链卡死。要常驻就明确用 detach。
	 */
	function spawnDetached(argv, cwdOpt) {
		const started = Date.now()
		const child = spawn(argv[0], argv.slice(1), {
			cwd: cwdOpt,
			windowsHide: true,
			shell: false,
			detached: true,
			// 不接任何管道：它的 stdout/stderr 不归我们管，也不会拖住任何调用。
			stdio: 'ignore',
		})
		child.unref()
		return {
			exit_code: 0,
			stdout: `[detached] pid=${child.pid ?? '?'}\n`,
			stderr: '',
			duration_ms: Date.now() - started,
			truncated: false,
			detached: true,
			pid: child.pid ?? null,
		}
	}

	ctx.tools.register(
		defineTool({
			name: 'sandbox_sessions',
			description: '只读：列出当前所有活会话的 id 与标题，用来确定该给哪个会话授权 host_exec。',
			parameters: {},
			output: OUTPUT,
			execute: async () => {
				const sessions = serviceOf(ctx, 'sessions')
				if (sessions === undefined || typeof sessions.list !== 'function') {
					return { ok: false, code: 'NO_SESSION_STORE', error: '当前部署取不到 ctx.sessions' }
				}
				let all = []
				try {
					all = Array.from(sessions.list() ?? [])
				} catch (e) {
					return { ok: false, code: 'LIST_FAILED', error: String(e?.message ?? e) }
				}
				const rows = all.map((s) => ({
					id: String(s?.id ?? s?.sessionId ?? ''),
					title: titleOf(s) ?? '(无标题)',
				})).filter((r) => r.id !== '')
				return { ok: true, count: rows.length, sessions: rows }
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'host_exec',
			description:
				'在宿主机上执行命令，**绕过 DSH 沙箱子进程隔离**（默认关闭，需用户按会话授权）。' +
				'用途：启动被沙箱挡住的本机程序（如 NapCat、ToDesk MCP）或访问工作区外的路径。' +
				'\n\n⚠️ 这是**同步**语义：命令退出才返回。要起**常驻服务**（watchdog / NapCat / MCP server 等' +
				'永不退出的进程）必须加 `detach: true`，否则只能拖到超时，而且那个服务会一直挂在后台。' +
				'\n\n超时或用户在 UI 上点停止时，会 kill **整棵进程树**并正常返回（`code: TIMEOUT` / `ABORTED`）。',
			parameters: {
				command: { type: 'string', description: '命令行字符串（经 cmd.exe /c 执行）。与 argv 二选一。' },
				argv: { type: 'array', items: { type: 'string' }, description: 'argv 数组（直接 execFile，不经 shell）。与 command 二选一。' },
				cwd: { type: 'string', description: '可选：工作目录。' },
				timeout_ms: { type: 'number', description: '可选：超时毫秒，默认取配置值（120000）。到时整棵树被 kill。' },
				detach: {
					type: 'boolean',
					description:
						'可选：true = 后台常驻模式。立刻返回 pid，不接 stdio、不等退出。' +
						'**启动 watchdog / NapCat / MCP server 这类服务时必须用它。**',
				},
			},
			output: OUTPUT,
			execute: async (args, exec) => {
				if (!hostExecEnabled) {
					return { ok: false, code: 'HOST_EXEC_DISABLED', error: 'host_exec 未启用：在 profile 的 sandbox-grant.config.hostExec.enabled 设为 true 后才可用。' }
				}

				const caller = callerSessionOf(exec)
				const callerId = String(caller?.id ?? caller?.sessionId ?? '')
				const authorized = hostExecSessionsNow().some((s) => s !== '' && (callerId === s || callerId.startsWith(s)))
				if (!authorized) {
					return {
						ok: false,
						code: 'ESCALATION_DENIED',
						error: `会话 ${callerId || '(未知)'} 未获 host_exec 授权；把该会话 id 加入 config.hostExec.authorizedSessions 后重启生效。`,
					}
				}

				const raw = args.command
				const argvArg = Array.isArray(args.argv) ? args.argv.map(String) : undefined
				let argv
				if (argvArg && argvArg.length > 0) argv = argvArg
				else if (typeof raw === 'string' && raw.trim() !== '') argv = ['cmd.exe', '/d', '/s', '/c', raw]
				else return { ok: false, code: 'MISSING_COMMAND', error: '需要 command 或 argv' }

				const timeoutMs = Number(args.timeout_ms) > 0 ? Number(args.timeout_ms) : hostExecTimeout
				const cwdOpt = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? args.cwd : undefined
				const detach = args.detach === true

				// 常驻服务（watchdog / NapCat / MCP server）必须走 detach：
				// 同步跑它们只会拖到超时，历史事故就是这么来的。
				if (detach) {
					const d = spawnDetached(argv, cwdOpt)
					audit({
						action: 'host_exec',
						mode: 'detach',
						argv,
						cwd: cwdOpt ?? null,
						caller: callerId || null,
						callerTitle: titleOf(caller) ?? null,
						exit_code: d.exit_code,
						duration_ms: d.duration_ms,
						pid: d.pid,
					})
					return { ok: true, target: cwdOpt ?? '', ...d }
				}

				const r = await runProcess(argv, cwdOpt, timeoutMs, exec?.signal)
				audit({
					action: 'host_exec',
					argv,
					cwd: cwdOpt ?? null,
					caller: callerId || null,
					callerTitle: titleOf(caller) ?? null,
					exit_code: r.exit_code,
					duration_ms: r.duration_ms,
					timed_out: r.timed_out === true,
					aborted: r.aborted === true,
				})
				// ⚠️ 只在该有的时候才放 hint。写成 `hint: undefined` 会被判定为
				// "value is not lossless JSON" —— undefined 不是合法 JSON 值，
				// 工具会报 invalid output（我踩过一次）。
				const stopHint = r.timed_out
					? '命令被超时终止（整棵进程树已 kill）。要启动常驻服务请加 detach: true。'
					: r.aborted
						? '命令被取消（整棵进程树已 kill）。要启动常驻服务请加 detach: true。'
						: undefined
				return {
					ok: r.exit_code === 0 && !r.timed_out && !r.aborted,
					target: cwdOpt ?? '',
					...(r.timed_out ? { code: 'TIMEOUT' } : r.aborted ? { code: 'ABORTED' } : {}),
					...r,
					...(stopHint === undefined ? {} : { hint: stopHint }),
				}
			},
		}),
	)

	ctx.tools.register(
		defineTool({
			name: 'sandbox_revoke',
			description: '收回指定会话的提权：切回 workspace-write（安全方向，不需要审批）。等价于 sandbox_grant(mode=workspace-write)。',
			parameters: {
				session_id: { type: 'string', required: true, description: '目标会话 id。' },
				reason: { type: 'string', description: '可选：写进审计。' },
			},
			output: OUTPUT,
			execute: async (args, exec) => {
				const rawId = String(args.session_id ?? '').trim()
				const target = liveSessionOf(ctx, rawId)
				if (target === undefined) {
					return { ok: false, code: 'NOT_LIVE', error: `找不到活会话 ${rawId}` }
				}
				try {
					setSandboxMode(target, 'workspace-write')
				} catch (err) {
					return { ok: false, code: 'SET_FAILED', error: `写入失败：${err?.message ?? err}` }
				}
				const caller = callerSessionOf(exec)
				audit({
					action: 'revoke',
					to: 'workspace-write',
					target: rawId,
					caller: caller?.id ?? null,
					reason: typeof args.reason === 'string' ? args.reason : null,
				})
				return { ok: true, target: rawId, mode: 'workspace-write' }
			},
		}),
	)
}
