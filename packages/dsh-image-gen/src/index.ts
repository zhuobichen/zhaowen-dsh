// dsh-image-gen：让 agent 用本机豆包桌面版生图 / 改图。
//
// 豆包驱动在 ./doubao.ts（从 zhaowen-mcp/image-vision/doubao.ts vendored 过来，
// 改成可配置的工厂）。这个文件只做三件事：注册工具、串行化豆包调用、把产物
// 存进 DSH 附件系统并返回图片块（Web GUI 的客户端插件负责内联显示）。

import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

import {
  createDoubaoDriver,
  DEFAULT_DOUBAO_CONFIG,
  type DoubaoConfig,
  type DoubaoDriver,
  type DoubaoResult,
} from './doubao.js'

import {
  defaultOutputDir,
  MAX_INPUT_IMAGES,
  MAX_PROMPT_CHARS,
  mediaTypeOf,
  resolveOutputBase,
  validateImages,
  validatePrompt,
  type ImageFormat,
  type ImageMode,
} from './files.js'

import { createSerialQueue } from './queue.js'

export const name = 'dsh-image-gen'
/** 只需要工具注册表；attachments 是可选的（没有就降级成只返回路径）。 */
export const inject: string[] = ['tools']

export interface Config {
  /** 豆包调试端口，默认 http://127.0.0.1:9333。 */
  cdpUrl?: string
  /** 图片默认输出目录。 */
  outputDir?: string
  /** 成图判定的最小边长，默认 512。 */
  minPx?: number
  /** 等图超时，默认 240000ms。 */
  timeoutMs?: number
  /** 是否每次点「新对话」，默认 false（接着当前会话发）。 */
  newChat?: boolean
  /** 队列最多同时排多少个，默认 8。 */
  maxPending?: number
  /** 提示词上限，默认 8000。 */
  maxPromptChars?: number
  /** 是否保存附件用于内联显示，默认 true。 */
  attachImages?: boolean
  /** 测试注入点。 */
  driverFactory?: (config: DoubaoConfig) => DoubaoDriver
}

interface ResolvedConfig {
  cdpUrl: string
  outputDir: string
  minPx: number
  timeoutMs: number
  newChat: boolean
  maxPending: number
  maxPromptChars: number
  attachImages: boolean
  driverFactory: (config: DoubaoConfig) => DoubaoDriver
}

const envBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback

  return /^(1|true|yes|on)$/i.test(value)
}

const envNumber = (value: string | undefined, fallback: number): number => {
  const n = Number(value)

  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback
}

const resolveConfig = (config: Config = {}): ResolvedConfig => ({
  cdpUrl: (config.cdpUrl || process.env.DOUBAO_CDP_URL || DEFAULT_DOUBAO_CONFIG.cdpUrl).replace(/\/$/, ''),
  outputDir: config.outputDir || process.env.DSH_IMAGE_GEN_OUTPUT_DIR || defaultOutputDir(),
  minPx: config.minPx ?? envNumber(process.env.DOUBAO_MIN_PX, DEFAULT_DOUBAO_CONFIG.minPx),
  timeoutMs:
    config.timeoutMs ?? envNumber(process.env.DOUBAO_TIMEOUT_MS, DEFAULT_DOUBAO_CONFIG.timeoutMs),
  newChat: config.newChat ?? envBool(process.env.DOUBAO_NEW_CHAT, DEFAULT_DOUBAO_CONFIG.newChat),
  maxPending: Math.max(1, config.maxPending ?? envNumber(process.env.DSH_IMAGE_GEN_MAX_PENDING, 8)),
  maxPromptChars: Math.max(
    1,
    config.maxPromptChars ?? envNumber(process.env.DSH_IMAGE_GEN_MAX_PROMPT, MAX_PROMPT_CHARS),
  ),
  attachImages: config.attachImages ?? envBool(process.env.DSH_IMAGE_GEN_ATTACH, true),
  driverFactory: config.driverFactory ?? createDoubaoDriver,
})

/** 图片值：和内置 read_image 的图片块形状保持兼容。 */
interface AttachmentValue {
  attachmentId: string
  mediaType: 'image/png' | 'image/jpeg'
  bytes: number
  width: number
  height: number
  name?: string
  originalDimensions?: { width: number; height: number }
}

interface ImageToolValue {
  mode: ImageMode
  prompt: string
  path: string
  meta_path: string
  media_type: 'image/png' | 'image/jpeg'
  width: number
  height: number
  bytes: number
  format: ImageFormat
  duration_ms: number
  requested_path?: string
  input_images?: string[]
  attachment_error?: string
  image?: AttachmentValue
}

const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string' },
    mediaType: {
      type: 'string',
      enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer' },
        height: { type: 'integer' },
      },
    },
  },
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['generate', 'edit'] },
    prompt: { type: 'string' },
    path: { type: 'string' },
    meta_path: { type: 'string' },
    media_type: { type: 'string', enum: ['image/png', 'image/jpeg'] },
    width: { type: 'integer' },
    height: { type: 'integer' },
    bytes: { type: 'integer' },
    format: { type: 'string', enum: ['png', 'jpg'] },
    duration_ms: { type: 'integer' },
    requested_path: { type: 'string' },
    input_images: { type: 'array', items: { type: 'string' } },
    attachment_error: { type: 'string' },
    image: IMAGE_VALUE_SCHEMA,
  },
}

const toAttachmentValue = (ref: any): AttachmentValue | undefined => {
  if (ref === null || typeof ref !== 'object' || typeof ref.attachmentId !== 'string') return undefined

  const value: AttachmentValue = {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
  }

  if (typeof ref.name === 'string') value.name = ref.name
  if (ref.originalDimensions) {
    value.originalDimensions = {
      width: ref.originalDimensions.width,
      height: ref.originalDimensions.height,
    }
  }

  return value
}

const renderResult = (_args: unknown, value: ImageToolValue): any[] => {
  const lines = [
    `${value.mode === 'edit' ? '已编辑并保存' : '已生成图片'}: ${value.path}`,
    `尺寸: ${value.width}x${value.height} · ${value.bytes} 字节 · ${value.media_type}`,
    `sidecar: ${value.meta_path}`,
    '水印: 豆包 AI 生成（右下角像素里，未裁剪）',
  ]

  if (value.attachment_error) lines.push(`内联预览不可用: ${value.attachment_error}`)
  if (!value.image) lines.push(`打开这个路径查看图片: ${value.path}`)

  const blocks: any[] = [{ type: 'text', text: lines.join('\n') }]

  if (value.image) blocks.push({ type: 'image', attachment: value.image })

  return blocks
}

const presentationMeta = (_args: unknown, value: ImageToolValue) => ({
  path: value.path,
  mode: value.mode,
  media_type: value.media_type,
  width: value.width,
  height: value.height,
  bytes: value.bytes,
  prompt: value.prompt,
})

const patchSidecar = async (metaPath: string, patch: Record<string, unknown>): Promise<void> => {
  try {
    const current = JSON.parse(await readFile(metaPath, 'utf8'))

    current.dsh = patch
    await writeFile(metaPath, JSON.stringify(current, null, 2) + '\n', 'utf8')
  } catch {
    // sidecar 补写失败不影响这次生图
  }
}

/** 把产物存进 DSH 附件系统；失败只记错误，不把整次生图判死。 */
const attachResult = async (
  ctx: any,
  enabled: boolean,
  result: DoubaoResult,
  mediaType: 'image/png' | 'image/jpeg',
): Promise<{ image?: AttachmentValue; error?: string }> => {
  if (!enabled) return {}

  const attachments = ctx.get?.('attachments')

  if (!attachments || typeof attachments.saveImage !== 'function') {
    return { error: '附件服务未挂载' }
  }

  try {
    const data = await readFile(result.path)
    const ref = await attachments.saveImage({
      data: new Uint8Array(data),
      mediaType,
      name: basename(result.path),
    })
    const image = toAttachmentValue(ref)

    if (!image) return { error: '附件服务返回了无法识别的引用' }

    await patchSidecar(result.metaPath, {
      plugin: '@zhuobichen/dsh-image-gen',
      attachment: {
        attachmentId: image.attachmentId,
        mediaType: image.mediaType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
      },
    })

    return { image }
  } catch (error: any) {
    return { error: String(error?.message || error) }
  }
}

const assertWebSocket = (): void => {
  if (typeof (globalThis as any).WebSocket === 'undefined') {
    throw new Error(
      `dsh-image-gen 需要 Node 22+（缺少全局 WebSocket；当前 ${process.version}）`,
    )
  }
}

export function apply(ctx: any, config: Config = {}): void {
  const cfg = resolveConfig(config)
  const driver = cfg.driverFactory({
    cdpUrl: cfg.cdpUrl,
    minPx: cfg.minPx,
    timeoutMs: cfg.timeoutMs,
    newChat: cfg.newChat,
  })

  // ---- 串行队列：所有豆包调用共用一个窗口，必须排队 ----
  const queue = createSerialQueue({ maxPending: cfg.maxPending })
  const runExclusive = <T>(job: () => Promise<T>): Promise<T> => queue.run(job)

  const finalize = async (
    mode: ImageMode,
    prompt: string,
    inputImages: string[],
    requestedPath: string | undefined,
    result: DoubaoResult,
  ): Promise<ImageToolValue> => {
    const mediaType = mediaTypeOf(result.format)
    const attached = await attachResult(ctx, cfg.attachImages, result, mediaType)
    const value: ImageToolValue = {
      mode,
      prompt,
      path: result.path,
      meta_path: result.metaPath,
      media_type: mediaType,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      format: result.format,
      duration_ms: result.durationMs,
    }

    if (requestedPath !== undefined) value.requested_path = requestedPath
    if (inputImages.length > 0) value.input_images = inputImages
    if (attached.error !== undefined) value.attachment_error = attached.error
    if (attached.image !== undefined) value.image = attached.image

    return value
  }

  const cwdOf = (exec: any): string => String(exec?.agent?.session?.header?.cwd ?? process.cwd())

  // ---- generate_image：文字 → 图片 ----
  ctx.tools.register({
    name: 'generate_image',
    description:
      '用本机豆包桌面版从文字生成一张图片（约 15–35 秒，通常 2048×2048）。' +
      '图片保存到 DSH 输出目录，并在 Web GUI 里尽量内联显示。' +
      '产物右下角带「豆包 AI 生成」可见水印，本工具不裁剪。' +
      '前提：豆包桌面版已带 --remote-debugging-port=9333 启动并已登录。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          description: '图片描述。越具体越好（主体、构图、配色、风格、文字内容）。',
        },
        output_path: {
          type: 'string',
          description:
            '可选。目录、文件主干，或带 .png/.jpg/.jpeg/.webp 的完整路径；' +
            '省略时写到 $DSH_HOME/plugins/dsh-image-gen/output/。相对路径按该目录解析。',
        },
        name: {
          type: 'string',
          description: '可选文件名主干（不指定 output_path 或它是目录时使用）。',
        },
      },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: renderResult,
      presentationMeta,
    },
    isConcurrencySafe: () => true,
    async execute(args: any) {
      assertWebSocket()
      const prompt = validatePrompt(args?.prompt, cfg.maxPromptChars)
      const resolved = resolveOutputBase({
        mode: 'generate',
        outputDir: cfg.outputDir,
        requestedPath: typeof args?.output_path === 'string' ? args.output_path : undefined,
        name: typeof args?.name === 'string' ? args.name : undefined,
      })

      const result = await runExclusive(() =>
        driver.generate(prompt, {
          outputBase: resolved.base,
          extraMeta: {
            plugin: '@zhuobichen/dsh-image-gen',
            pluginVersion: '0.1.0',
            requestedPath: resolved.requestedPath ?? null,
          },
        }),
      )

      return finalize('generate', prompt, [], resolved.requestedPath, result)
    },
  })

  // ---- edit_image：参考图 + 指令 ----
  ctx.tools.register({
    name: 'edit_image',
    description:
      '用本机豆包桌面版按提示词修改 1–4 张本地参考图（保版式/文字/配色的能力较好，约 30–60 秒）。' +
      '图片保存到 DSH 输出目录，并在 Web GUI 里尽量内联显示；产物带可见水印，不裁剪。' +
      '前提：豆包桌面版已带调试端口启动并已登录。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'images'],
      properties: {
        prompt: {
          type: 'string',
          description: '修改指令。建议明确「改哪里、保持什么不变」。',
        },
        images: {
          type: 'array',
          items: { type: 'string' },
          description: `1–${MAX_INPUT_IMAGES} 张本地参考图路径（绝对路径，或相对会话 cwd）。`,
        },
        output_path: {
          type: 'string',
          description: '同 generate_image。',
        },
        name: {
          type: 'string',
          description: '同 generate_image。',
        },
      },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: renderResult,
      presentationMeta,
    },
    isConcurrencySafe: () => true,
    async execute(args: any, exec: any) {
      assertWebSocket()
      const prompt = validatePrompt(args?.prompt, cfg.maxPromptChars)
      const images = validateImages(args?.images, cwdOf(exec), MAX_INPUT_IMAGES)
      const resolved = resolveOutputBase({
        mode: 'edit',
        outputDir: cfg.outputDir,
        requestedPath: typeof args?.output_path === 'string' ? args.output_path : undefined,
        name: typeof args?.name === 'string' ? args.name : undefined,
      })

      const result = await runExclusive(() =>
        driver.edit(prompt, {
          images,
          outputBase: resolved.base,
          extraMeta: {
            plugin: '@zhuobichen/dsh-image-gen',
            pluginVersion: '0.1.0',
            requestedPath: resolved.requestedPath ?? null,
          },
        }),
      )

      return finalize('edit', prompt, images, resolved.requestedPath, result)
    },
  })

  // ---- image_gen_status：只读诊断，不进队列 ----
  ctx.tools.register({
    name: 'image_gen_status',
    description:
      '只读诊断：检查豆包桌面版调试端口是否可达、是否找到聊天页、输入框是否可见，' +
      '并返回输出目录与生图队列状态。不生成图片。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reachable: { type: 'boolean' },
          composer_visible: { type: 'boolean' },
          chat_target_url: { type: 'string' },
          error: { type: 'string' },
          cdp_url: { type: 'string' },
          output_dir: { type: 'string' },
          node_version: { type: 'string' },
          driver: { type: 'string', enum: ['doubao-desktop'] },
          queue_pending: { type: 'integer' },
          queue_running: { type: 'boolean' },
        },
      },
      render: (_args: unknown, value: unknown) => [
        { type: 'text' as const, text: JSON.stringify(value, null, 2) },
      ],
    },
    async execute() {
      const status = await driver.status()
      const value: Record<string, unknown> = {
        reachable: status.reachable,
        composer_visible: status.composerVisible,
        cdp_url: cfg.cdpUrl,
        output_dir: cfg.outputDir,
        node_version: process.version,
        driver: 'doubao-desktop',
        queue_pending: queue.pending,
        queue_running: queue.running,
      }

      if (status.chatTargetUrl !== null) value.chat_target_url = status.chatTargetUrl
      if (status.error !== undefined) value.error = status.error

      return value
    },
  })
}
