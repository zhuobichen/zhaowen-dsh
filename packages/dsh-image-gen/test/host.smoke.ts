// 装配冒烟：拿编译后的 lib/index.js，在假 Cordis 上下文里真跑一遍工具。
//
// 跑：node test/host.smoke.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../lib/index.js'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

const temp = () => mkdtempSync(join(tmpdir(), 'dsh-image-smoke-'))

const writeResult = async (outputBase: string, prompt: string) => {
  const path = `${outputBase}.png`
  const metaPath = `${path}.meta.json`

  writeFileSync(path, PNG)
  writeFileSync(metaPath, JSON.stringify({ prompt, kind: 'generate' }))

  return {
    path,
    metaPath,
    format: 'png' as const,
    width: 1024,
    height: 1024,
    bytes: PNG.length,
    model: null,
    requestedModel: 'doubao (桌面版)',
    aigcMarker: { ContentProducer: 'doubao' },
    durationMs: 12,
  }
}

interface Harness {
  ctx: any
  tools: Map<string, any>
  attachments: any
  seen: { mode?: string; prompt?: string; images?: string[]; outputBase?: string }
}

const harness = (options: { withAttachments?: boolean } = {}): Harness => {
  const tools = new Map<string, any>()
  const seen: Harness['seen'] = {}
  const attachments = options.withAttachments === false
    ? undefined
    : {
        async saveImage(input: any) {
          return {
            attachmentId: 'sha256:test',
            mediaType: input.mediaType,
            bytes: input.data.length,
            width: 1024,
            height: 1024,
            name: input.name,
          }
        },
      }

  const ctx = {
    tools: {
      register(definition: any) {
        tools.set(definition.name, definition)

        return () => {}
      },
    },
    get(name: string) {
      return name === 'attachments' ? attachments : undefined
    },
  }

  return { ctx, tools, attachments, seen }
}

const install = (h: Harness, outputDir: string) => {
  apply(h.ctx, {
    outputDir,
    driverFactory: () => ({
      async generate(prompt: string, opts: any) {
        h.seen.mode = 'generate'
        h.seen.prompt = prompt
        h.seen.outputBase = opts.outputBase

        return writeResult(opts.outputBase, prompt)
      },
      async edit(prompt: string, opts: any) {
        h.seen.mode = 'edit'
        h.seen.prompt = prompt
        h.seen.images = opts.images
        h.seen.outputBase = opts.outputBase

        return writeResult(opts.outputBase, prompt)
      },
      async status() {
        return { reachable: true, chatTargetUrl: 'ws://127.0.0.1:9333/devtools/page/x', composerVisible: true }
      },
    }),
  })
}

test('注册三个工具，都有 parameters / output.schema / render', () => {
  const h = harness()

  install(h, temp())

  assert.deepEqual([...h.tools.keys()].sort(), ['edit_image', 'generate_image', 'image_gen_status'])

  for (const definition of h.tools.values()) {
    assert.equal(definition.parameters.type, 'object')
    assert.equal(definition.output.schema.type, 'object')
    assert.equal(typeof definition.output.render, 'function')
  }
})

test('generate_image：落盘 + 保存附件 + render 返回 text+image', async () => {
  const h = harness()
  const out = temp()

  install(h, out)

  const value = await h.tools.get('generate_image').execute({ prompt: '  一只猫  ' })

  assert.equal(h.seen.mode, 'generate')
  assert.equal(h.seen.prompt, '一只猫')
  assert.match(value.path, /gen_\d{8}-\d{6}_[0-9a-f]{6}\.png$/)
  assert.equal(value.media_type, 'image/png')
  assert.equal(value.image.attachmentId, 'sha256:test')
  assert.equal(value.width, 1024)
  assert.ok(existsSync(value.path))
  assert.ok(existsSync(value.meta_path))
  assert.match(readFileSync(value.meta_path, 'utf8'), /"attachmentId": "sha256:test"/)

  const blocks = h.tools.get('generate_image').output.render({}, value)

  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /已生成图片/)
  assert.equal(blocks[1].type, 'image')
  assert.equal(blocks[1].attachment.attachmentId, 'sha256:test')
})

test('generate_image：空 prompt 被拒绝', async () => {
  const h = harness()

  install(h, temp())

  await assert.rejects(
    h.tools.get('generate_image').execute({ prompt: '   ' }),
    /不能为空/,
  )
})

test('edit_image：把路径传给驱动', async () => {
  const h = harness()
  const out = temp()
  const input = join(out, 'input.png')

  writeFileSync(input, PNG)
  install(h, out)

  const value = await h.tools.get('edit_image').execute({
    prompt: '把背景换成纯白',
    images: [input],
  })

  assert.equal(h.seen.mode, 'edit')
  assert.deepEqual(h.seen.images, [input])
  assert.equal(value.mode, 'edit')
  assert.deepEqual(value.input_images, [input])
})

test('edit_image：0 张 / 5 张都拒绝', async () => {
  const h = harness()
  const out = temp()
  const input = join(out, 'input.png')

  writeFileSync(input, PNG)
  install(h, out)

  await assert.rejects(
    h.tools.get('edit_image').execute({ prompt: 'x', images: [] }),
    /1–4/,
  )
  await assert.rejects(
    h.tools.get('edit_image').execute({ prompt: 'x', images: [input, input, input, input, input] }),
    /1–4/,
  )
})

test('image_gen_status：返回可达性与队列状态', async () => {
  const h = harness()
  const out = temp()

  install(h, out)

  const value = await h.tools.get('image_gen_status').execute({})

  assert.equal(value.reachable, true)
  assert.equal(value.composer_visible, true)
  assert.equal(value.driver, 'doubao-desktop')
  assert.equal(value.output_dir, out)
  assert.equal(value.queue_running, false)
  assert.equal(value.queue_pending, 0)
})

test('没有 attachments 服务时降级为只返回路径', async () => {
  const h = harness({ withAttachments: false })
  const out = temp()

  install(h, out)

  const value = await h.tools.get('generate_image').execute({ prompt: '一只狗' })

  assert.equal(value.image, undefined)
  assert.match(value.attachment_error, /附件服务未挂载/)

  const blocks = h.tools.get('generate_image').output.render({}, value)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /打开这个路径查看图片/)
})
