import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  makeStem,
  resolveOutputBase,
  sanitizeStem,
} from '../lib/files.js'

const temp = () => mkdtempSync(join(tmpdir(), 'dsh-image-name-'))

test('默认文件名：gen_/edit_ + 时间戳 + 随机串', () => {
  const now = new Date(2026, 9, 19, 20, 15, 30)

  assert.equal(makeStem('generate', now, 'a1b2c3'), 'gen_20261019-201530_a1b2c3')
  assert.equal(makeStem('edit', now, 'ffffff'), 'edit_20261019-201530_ffffff')
  assert.match(makeStem('generate'), /^gen_\d{8}-\d{6}_[0-9a-f]{6}$/)
})

test('sanitizeStem 去掉 Windows 非法字符并限长', () => {
  assert.equal(sanitizeStem('a<b>c:d"e/f\\g|h?i*j'), 'a-b-c-d-e-f-g-h-i-j')
  assert.equal(sanitizeStem('  ..名字..  '), '名字')
  assert.equal(sanitizeStem('x'.repeat(120)).length, 80)
  assert.equal(sanitizeStem('///'), '')
})

test('默认落在 outputDir 下，且不覆盖已有文件', () => {
  const dir = temp()

  writeFileSync(join(dir, 'gen_20261019-201530_a1b2c3.png'), 'x')

  const first = resolveOutputBase({
    mode: 'generate',
    outputDir: dir,
    now: new Date(2026, 9, 19, 20, 15, 30),
    random: 'a1b2c3',
  })
  const second = resolveOutputBase({
    mode: 'generate',
    outputDir: dir,
    now: new Date(2026, 9, 19, 20, 15, 30),
    random: 'a1b2c3',
    exists: (path) => path === join(dir, 'gen_20261019-201530_a1b2c3.png'),
  })

  assert.equal(first.base, join(dir, 'gen_20261019-201530_a1b2c3-1'))
  assert.equal(second.base, join(dir, 'gen_20261019-201530_a1b2c3-1'))
})

test('output_path 是目录：放到目录里', () => {
  const dir = temp()
  const nested = join(dir, 'books')

  mkdirSync(nested)

  const resolved = resolveOutputBase({
    mode: 'edit',
    outputDir: dir,
    requestedPath: nested,
    name: '封面 图',
  })

  assert.equal(resolved.base, join(nested, '封面 图'))
})

test('output_path 带受支持的扩展名：去掉扩展名', () => {
  const dir = temp()

  assert.equal(
    resolveOutputBase({ mode: 'generate', outputDir: dir, requestedPath: join(dir, 'a.jpg') }).base,
    join(dir, 'a'),
  )
  assert.equal(
    resolveOutputBase({ mode: 'generate', outputDir: dir, requestedPath: join(dir, 'b.JPEG') }).base,
    join(dir, 'b'),
  )
})

test('output_path 带不支持的扩展名：报错', () => {
  const dir = temp()

  assert.throws(
    () => resolveOutputBase({ mode: 'generate', outputDir: dir, requestedPath: join(dir, 'a.bmp') }),
    /扩展名 \.bmp 不支持/,
  )
})

test('相对 output_path 按输出目录解析', () => {
  const dir = temp()
  const resolved = resolveOutputBase({ mode: 'generate', outputDir: dir, requestedPath: 'sub/x.png' })

  assert.equal(resolved.base, join(dir, 'sub', 'x'))
})

test('name 只在必要时使用；空 name 回落到默认名', () => {
  const dir = temp()
  const now = new Date(2026, 0, 2, 3, 4, 5)

  assert.equal(
    resolveOutputBase({ mode: 'generate', outputDir: dir, name: '猫', now, random: 'abcdef' }).base,
    join(dir, '猫'),
  )
  assert.equal(
    resolveOutputBase({ mode: 'generate', outputDir: dir, name: '  ', now, random: 'abcdef' }).base,
    join(dir, 'gen_20260102-030405_abcdef'),
  )
})
