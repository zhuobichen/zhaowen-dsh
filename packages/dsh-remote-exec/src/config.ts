/**
 * 配置解析：把 cordis.yml 里的 config 与 `$DSH_HOME/.env` 的 DSH_REMOTE_* 变量
 * 合成一份「已解析」的主机列表。
 *
 * 设定原则（照 DSH 仓库的约定）：部署差异进 Config 字段，不硬编码；配置写错就
 * 明确报错，不静默跳过。唯一的例外是「一台主机都没配」——那不算错误，插件会退化成
 * 只提供 remote_doctor，免得一个没配好的插件把整个 profile 卡死。
 *
 * @module dsh-remote-exec/config
 */

/** 远端默认工作目录（POSIX 路径，支持 `~`）。 */
export const DEFAULT_REMOTE_WORKDIR = '~/.dsh-remote'

/** 一台 SSH 主机的部署配置。 */
export interface HostConfig {
  /** `HostName` 或 `~/.ssh/config` 里的别名；认证、端口、跳板都可以交给 OpenSSH 自己解析。 */
  host: string
  /** 端口，缺省用 OpenSSH 的默认值（22 或 config 里的 Port）。 */
  port?: number
  /** 登录用户，缺省用 OpenSSH 的默认值。 */
  user?: string
  /** 私钥路径，缺省交给 ssh-agent / `~/.ssh/config`。 */
  identityFile?: string
  /** `ProxyJump`（先连跳板），例如 `root@jump.example.com`。 */
  proxyJump?: string
  /** 远端默认工作目录，缺省 `~/.dsh-remote`。 */
  workdir?: string
  /** 额外透传给 OpenSSH 的 `-o` 选项。 */
  options?: Record<string, string>
}

/** cordis.yml 里这个插件接受的配置。 */
export interface Config {
  /** 具名主机表；工具可以用 `host` 参数指定，缺省用 `defaultHost`。 */
  hosts?: Record<string, HostConfig>
  /** 缺省主机的名字。 */
  defaultHost?: string
  /** 本地 ssh 可执行文件，缺省 `ssh`（Windows 上是系统自带 OpenSSH）。 */
  sshBinary?: string
  /** 本地 tar 可执行文件，缺省 `tar`（Windows 10+ 自带 bsdtar）。 */
  tarBinary?: string
  /** 建连超时，缺省 15000ms。 */
  connectTimeoutMs?: number
  /** 单条命令的默认超时（不含工具参数覆盖），缺省 120000ms。 */
  execTimeoutMs?: number
  /** 每次调用保留的输出上限（字节，尾部优先），缺省 64000。 */
  maxOutputBytes?: number
  /** 单次传输上限（字节），缺省 268435456（256 MiB）。 */
  maxTransferBytes?: number
  /** 主机密钥策略，缺省 `accept-new`（首次信任并记住，之后变更即拒绝）。 */
  strictHostKeyChecking?: 'accept-new' | 'yes' | 'no'
  /** 后台作业轮询间隔，缺省 1500ms。 */
  backgroundPollMs?: number
  /** 远端登录 shell 命令，缺省 `bash -l`；没有 bash 的机器可改成 `sh -l`。 */
  remoteShell?: string
}

/** 一台已解析的主机：所有缺省值都已落定。 */
export interface ResolvedHost {
  name: string
  host: string
  port?: number
  user?: string
  identityFile?: string
  proxyJump?: string
  workdir: string
  options: Record<string, string>
  /** 传给 ssh 的目标串：`user@host` 或 `host`。 */
  target: string
}

/** 已解析的插件配置。 */
export interface ResolvedConfig {
  hosts: ResolvedHost[]
  defaultHost?: string
  sshBinary: string
  tarBinary: string
  connectTimeoutMs: number
  execTimeoutMs: number
  maxOutputBytes: number
  maxTransferBytes: number
  strictHostKeyChecking: 'accept-new' | 'yes' | 'no'
  backgroundPollMs: number
  remoteShell: string
}

/** 从环境变量里读出一台主机（用于不想改 cordis.yml 的场合）。 */
export function envHostConfig(env: NodeJS.ProcessEnv = process.env): HostConfig | undefined {
  const host = env.DSH_REMOTE_HOST?.trim()

  if (!host) return undefined

  const portRaw = env.DSH_REMOTE_PORT?.trim()
  const port = portRaw ? Number(portRaw) : undefined

  if (portRaw && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`DSH_REMOTE_PORT 不是合法端口: ${portRaw}`)
  }

  return {
    host,
    ...(env.DSH_REMOTE_USER?.trim() ? { user: env.DSH_REMOTE_USER.trim() } : {}),
    ...(port ? { port } : {}),
    ...(env.DSH_REMOTE_KEY?.trim() ? { identityFile: env.DSH_REMOTE_KEY.trim() } : {}),
    ...(env.DSH_REMOTE_WORKDIR?.trim() ? { workdir: env.DSH_REMOTE_WORKDIR.trim() } : {}),
  }
}

const positiveInt = (value: unknown, fallback: number, label: string, min = 1): number => {
  if (value === undefined || value === null) return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < min) throw new Error(`${label} 必须是 >= ${min} 的整数，收到: ${String(value)}`)

  return Math.floor(n)
}

function resolveHost(name: string, config: HostConfig): ResolvedHost {
  if (!config || typeof config.host !== 'string' || config.host.trim() === '') {
    throw new Error(`hosts.${name}.host 必须是非空字符串（HostName 或 ~/.ssh/config 别名）`)
  }

  const port = config.port === undefined ? undefined : positiveInt(config.port, 22, `hosts.${name}.port`, 1)

  if (port !== undefined && port > 65535) throw new Error(`hosts.${name}.port 超出范围: ${port}`)

  if (config.options !== undefined && (typeof config.options !== 'object' || config.options === null)) {
    throw new Error(`hosts.${name}.options 必须是对象（键值都是字符串）`)
  }

  const user = config.user?.trim()

  return {
    name,
    host: config.host.trim(),
    ...(port === undefined ? {} : { port }),
    ...(user ? { user } : {}),
    ...(config.identityFile?.trim() ? { identityFile: config.identityFile.trim() } : {}),
    ...(config.proxyJump?.trim() ? { proxyJump: config.proxyJump.trim() } : {}),
    workdir: config.workdir?.trim() || DEFAULT_REMOTE_WORKDIR,
    options: { ...(config.options ?? {}) },
    target: user ? `${user}@${config.host.trim()}` : config.host.trim(),
  }
}

/** 解析插件配置；配置本身有问题时抛错（调用方负责降级成 doctor-only）。 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const declared: Record<string, HostConfig> = { ...(config.hosts ?? {}) }

  const fromEnv = envHostConfig()

  if (fromEnv && declared.default === undefined) declared.default = fromEnv

  const hosts: ResolvedHost[] = []

  for (const [name, hostConfig] of Object.entries(declared)) {
    hosts.push(resolveHost(name, hostConfig))
  }

  const preferred = config.defaultHost?.trim()
  const defaultHost = preferred
    ? hosts.find((h) => h.name === preferred)?.name
    : hosts[0]?.name

  if (preferred && defaultHost === undefined) {
    throw new Error(`defaultHost 指向了不存在的主机: ${preferred}（已配置: ${hosts.map((h) => h.name).join(', ') || '无'}）`)
  }

  const strict = config.strictHostKeyChecking ?? 'accept-new'

  if (strict !== 'accept-new' && strict !== 'yes' && strict !== 'no') {
    throw new Error(`strictHostKeyChecking 只能是 accept-new / yes / no，收到: ${String(strict)}`)
  }

  return {
    hosts,
    ...(defaultHost ? { defaultHost } : {}),
    sshBinary: config.sshBinary?.trim() || 'ssh',
    tarBinary: config.tarBinary?.trim() || 'tar',
    connectTimeoutMs: positiveInt(config.connectTimeoutMs, 15_000, 'connectTimeoutMs', 100),
    execTimeoutMs: positiveInt(config.execTimeoutMs, 120_000, 'execTimeoutMs', 1_000),
    maxOutputBytes: positiveInt(config.maxOutputBytes, 64_000, 'maxOutputBytes', 1_000),
    maxTransferBytes: positiveInt(config.maxTransferBytes, 256 * 1024 * 1024, 'maxTransferBytes', 1_024),
    strictHostKeyChecking: strict,
    backgroundPollMs: positiveInt(config.backgroundPollMs, 1_500, 'backgroundPollMs', 200),
    remoteShell: config.remoteShell?.trim() || 'bash -l',
  }
}

/** 按名字取主机；名字不存在时报出可选值，方便模型自己纠正。 */
export function pickHost(config: ResolvedConfig, name?: string): ResolvedHost {
  if (config.hosts.length === 0) {
    throw new Error(
      '没有配置任何远端主机。在 cordis.yml 的 remote-exec 条目里写 hosts，' +
        '或在 $DSH_HOME/.env 里设 DSH_REMOTE_HOST / DSH_REMOTE_USER / DSH_REMOTE_KEY。',
    )
  }

  const wanted = name?.trim()

  if (!wanted) {
    const host = config.hosts.find((h) => h.name === config.defaultHost) ?? config.hosts[0]

    return host
  }

  const found = config.hosts.find((h) => h.name === wanted)

  if (!found) {
    throw new Error(`没有名为 ${wanted} 的主机。可选: ${config.hosts.map((h) => h.name).join(', ')}`)
  }

  return found
}
