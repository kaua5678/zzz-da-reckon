import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import {
  createBatchScheduler,
  isBatchAborted,
  throwIfBatchAborted,
  useBatchOwner,
} from '@/composables/batchTask'

describe('批任务调度', () => {
  it('首次求值前让出宏任务，使已经排队的取消生效', async () => {
    const controller = new AbortController()
    let timerRan = false
    const timer = setTimeout(() => { timerRan = true; controller.abort() }, 0)
    const checkpoint = createBatchScheduler({ signal: controller.signal })
    try {
      await expect(checkpoint()).rejects.toMatchObject({ name: 'AbortError' })
      expect(timerRan).toBe(true)
    } finally {
      clearTimeout(timer)
    }
  })

  it('按时间预算合并轻量步骤，并在预算耗尽后再次让出', async () => {
    let now = 0
    let yields = 0
    const checkpoint = createBatchScheduler({}, {
      timeSliceMs: 10,
      now: () => now,
      yieldToMain: async () => { yields++ },
    })
    await checkpoint()
    expect(yields).toBe(1)
    now = 9
    await checkpoint()
    expect(yields).toBe(1)
    now = 10
    await checkpoint()
    expect(yields).toBe(2)
  })

  it('取消在预算内也会立即检查', async () => {
    const controller = new AbortController()
    let yields = 0
    const checkpoint = createBatchScheduler({ signal: controller.signal }, {
      now: () => 0,
      yieldToMain: async () => { yields++ },
    })
    await checkpoint()
    controller.abort()
    await expect(checkpoint()).rejects.toMatchObject({ name: 'AbortError' })
    expect(yields).toBe(1)
  })

  it('isBatchAborted 与 throwIfBatchAborted 同口径；无 control 也不炸', () => {
    expect(isBatchAborted()).toBe(false)
    expect(isBatchAborted({})).toBe(false)
    const controller = new AbortController()
    expect(isBatchAborted({ signal: controller.signal })).toBe(false)
    controller.abort()
    expect(isBatchAborted({ signal: controller.signal })).toBe(true)
    expect(() => throwIfBatchAborted({ signal: controller.signal })).toThrow('计算已取消')
    expect(() => throwIfBatchAborted({})).not.toThrow()
  })
})

describe('批任务结果归属', () => {
  it('A暂停→B启动→A恢复不污染B；取消只停计算不吊销提交权，卸载后不能发布', async () => {
    const scope = effectScope()
    const owner = scope.run(() => useBatchOwner())!
    const a = owner.start()
    const state = { progress: 'A', result: 0, computing: true }
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const pendingA = (async () => {
      await gate
      a.commit(() => { state.progress = 'A done'; state.result = 1 })
      // 旧 finally 同样不得清理新任务的状态。
      a.commit(() => { state.progress = ''; state.computing = false })
    })()
    const b = owner.start()
    expect(a.signal.aborted).toBe(true)
    expect(b.commit(() => { state.progress = 'B'; state.result = 2 })).toBe(true)
    release()
    await pendingA
    expect(state).toEqual({ progress: 'B', result: 2, computing: true })

    // 用户「取消」（页面「取消」/「中止」按钮）：只停计算，**不吊销提交权**——
    // 已算部分仍由该运行自己发布（曲线/海选「保留已算部分」的依据）。
    owner.cancel()
    expect(b.signal.aborted).toBe(true)
    expect(b.commit(() => { state.result = 3 })).toBe(true)
    // 吊销只来自两处：新运行顶掉、页面关闭。
    const c = owner.start()
    expect(b.commit(() => { state.result = 4 })).toBe(false)
    expect(c.commit(() => { state.result = 5 })).toBe(true)
    scope.stop()
    expect(c.signal.aborted).toBe(true)
    expect(c.commit(() => { state.result = 6 })).toBe(false)
    expect(state.result).toBe(5)
    expect(() => owner.start()).toThrow('已关闭')
  })
})
