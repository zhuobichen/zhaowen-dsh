// 一个只保证「串行」的小队列。
//
// 为什么需要：豆包只有一个窗口、一个输入框。两个调用同时跑会互相污染
// （输入文字叠加、旧图快照互相干扰、一个调用点「新对话」把另一个的页面刷掉）。
// 这里只做排队，不做并发控制。

export interface SerialQueue {
  run<T>(job: () => Promise<T>): Promise<T>
  /** 排队中（不含正在执行的）任务数。 */
  readonly pending: number
  readonly running: boolean
}

export function createSerialQueue(options: { maxPending?: number } = {}): SerialQueue {
  const maxPending = Math.max(1, options.maxPending ?? 8)

  let tail: Promise<void> = Promise.resolve()
  let active = 0
  let running = false

  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      if (active >= maxPending) {
        return Promise.reject(
          new Error(`生图队列已满（${active} 个在排队/执行，上限 ${maxPending}）`),
        )
      }

      active += 1

      const run = tail.then(async () => {
        running = true

        try {
          return await job()
        } finally {
          running = false
          active -= 1
        }
      })

      // 某个任务失败不能把后面的任务一起带崩。
      tail = run.then(
        () => undefined,
        () => undefined,
      )

      return run
    },

    get pending(): number {
      return Math.max(0, active - (running ? 1 : 0))
    },

    get running(): boolean {
      return running
    },
  }
}
