import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateImages, validatePrompt } from '../lib/files.js'

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

const JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
])

const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'latin1'),
  Buffer.from([0x56, 0x50, 0x38, 0x20, 0x00, 0x00, 0x00, 0x00]),
])

const temp = () => mkdtempSync(join(tmpdir(), 'dsh-image-val-'))

const image = (dir: string, name: string, data: Buffer) => {
  const path = join(dir, name)

  writeFileSync(path, data)

  return path
}

test('prompt：非空、类型、上限', () => {
  assert.equal(validatePrompt('  一只猫  '), '一只猫')
  assert.throws(() => validatePrompt('   '), /不能为空/)
  assert.throws(() => validatePrompt(42), /必须是字符串/)
  assert.throws(() => validatePrompt('x'.repeat(11), 10), /太长/)
})

test('images：1–4 张', () => {
  const dir = temp()
  const png = image(dir, 'a.png', PNG)

  assert.deepEqual(validateImages([png], dir), [png])
  assert.throws(() => validateImages([], dir), /1–4/)
  assert.throws(
    () => validateImages(Array.from({ length: 5 }, () => png), dir),
    /1–4/,
  )
  assert.throws(() => validateImages(42, dir), /必须是本地图片路径数组/)
})

test('images：存在性、目录、空文件、扩展名、内容一致性', () => {
  const dir = temp()
  const png = image(dir, 'a.png', PNG)
  const jpg = image(dir, 'b.jpg', JPG)
  const webp = image(dir, 'c.webp', WEBP)

  assert.deepEqual(validateImages([png, jpg, webp], dir), [png, jpg, webp])

  assert.throws(() => validateImages([join(dir, 'missing.png')], dir), /找不到/)
  assert.throws(() => validateImages([dir], dir), /不是文件/)

  const empty = join(dir, 'empty.png')

  writeFileSync(empty, '')
  assert.throws(() => validateImages([empty], dir), /空文件/)

  const bmp = image(dir, 'x.bmp', PNG)

  assert.throws(() => validateImages([bmp], dir), /扩展名 .bmp 不支持/)

  const mismatch = image(dir, 'mismatch.png', JPG)

  assert.throws(() => validateImages([mismatch], dir), /内容与扩展名不一致/)

  const garbage = image(dir, 'garbage.png', Buffer.from('not an image at all'))

  assert.throws(() => validateImages([garbage], dir), /认不出输入图片的格式/)
})

test('images：相对路径按 cwd 解析，重复项去重', () => {
  const dir = temp()

  image(dir, 'a.png', PNG)

  assert.deepEqual(validateImages(['a.png', './a.png'], dir), [join(dir, 'a.png')])
})

test('images：大文件被拒绝', () => {
  const dir = temp()
  const big = join(dir, 'big.png')

  writeFileSync(big, Buffer.concat([PNG, Buffer.alloc(64)]))

  assert.throws(() => validateImages([big], dir, 4, 32), /太大/)
})

test('images：支持单张字符串（兼容老调用）', () => {
  const dir = temp()
  const png = image(dir, 'a.png', PNG)

  assert.deepEqual(validateImages(png, dir), [png])
})

test('目录里创建子目录不影响校验', () => {
  const dir = temp()

  mkdirSync(join(dir, 'sub'))
  assert.throws(() => validateImages([join(dir, 'sub')], dir), /不是文件/)
})
