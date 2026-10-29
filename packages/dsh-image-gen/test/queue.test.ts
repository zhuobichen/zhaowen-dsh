import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSerialQueue } from '../lib/queue.js'

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

test('严格串行：第二个任务等第一个结束才开始', async () => {
  const queue = createSerialQueue()
  const events: string[] = []

  const first = queue.run(async () => {
    events.push('a:start')
    await tick(30)
    events.push('a:end')
    return 'a'
  })
  const second = queue.run(async () => {
    events.push('b:start')
    await tick(5)
    events.push('b:end')
    return 'b'
  })

  await tick()
  assert.equal(queue.pending, 1, '第一个开始后，第二个还在排队')
  assert.equal(await first, 'a')
  assert.equal(await second, 'b')
  assert.equal(queue.pending, 0)
  assert.equal(queue.running, false)
  assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end'])
})

test('失败的任务不会把队列带崩', async () => {
  const queue = createSerialQueue()

  await assert.rejects(
    queue.run(async () => {
      throw new Error('boom')
    }),
    /boom/,
  )

  assert.equal(await queue.run(async () => 'still-alive'), 'still-alive')
  assert.equal(queue.running, false)
  assert.equal(queue.pending, 0)
})

test('running 只在任务执行期间为真', async () => {
  const queue = createSerialQueue()
  let resolveJob: (() => void) | undefined
  const job = queue.run(
    () =>
      new Promise<void>((resolve) => {
        resolveJob = resolve
      }),
  )

  await tick()
  assert.equal(queue.running, true)
  resolveJob?.()
  await job
  assert.equal(queue.running, false)
})

test('超过 maxPending 直接拒绝', async () => {
  const queue = createSerialQueue({ maxPending: 2 })
  let release: (() => void) | undefined
  const held = queue.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )

  const queued = queue.run(async () => 'queued')

  await assert.rejects(queue.run(async () => 'third'), /队列已满/)

  release?.()
  await held
  assert.equal(await queued, 'queued')
})
