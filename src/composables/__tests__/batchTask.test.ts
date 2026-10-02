import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import {
  isBatchAborted,
  useBatchOwner,
} from '@/composables/batchTask'

describe('批任务取消探测', () => {
  it('isBatchAborted：无 control / 空 control 不炸，取消后为 true', () => {
    expect(isBatchAborted()).toBe(false)
    expect(isBatchAborted({})).toBe(false)
    const controller = new AbortController()
    expect(isBatchAborted({ signal: controller.signal })).toBe(false)
    controller.abort()
    expect(isBatchAborted({ signal: controller.signal })).toBe(true)
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
