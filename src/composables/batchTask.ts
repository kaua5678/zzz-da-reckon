import { getCurrentScope, onScopeDispose } from 'vue'

/**
 * 批任务的协作式取消；只在独立场景上运行，不能替代数据隔离。
 *
 * 取消通道只有一条：`signal`（AbortSignal，由 `createBatchOwner#start` 发车、`cancel` 吊销计算）。
 * S4（CC-343）起分析器与页面统一走它，早期的 `shouldAbort: () => boolean` 页面回调已废除。
 */
export interface BatchControl {
  signal?: AbortSignal
}

/** 非抛出的取消探测：已取消返回 true。「保留已算部分」式中止与抛错式中止共用它。 */
export function isBatchAborted(control: BatchControl = {}): boolean {
  return control.signal?.aborted === true
}

export function throwIfBatchAborted(control: BatchControl): void {
  if (isBatchAborted(control)) {
    throw new DOMException('计算已取消', 'AbortError')
  }
}

interface SchedulerPlatform {
  timeSliceMs?: number
  now?: () => number
  yieldToMain?: () => Promise<void>
}

/**
 * 首次调用先让出主线程，之后按时间预算让步；调用方在求值点之间 await checkpoint()。
 * 单次同步求值不可抢占：预算限制连续工作，不是单次求值耗时的承诺。
 */
export function createBatchScheduler(control: BatchControl = {}, platform: SchedulerPlatform = {}) {
  const now = platform.now ?? (() => performance.now())
  const yieldToMain = platform.yieldToMain ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)))
  const timeSliceMs = platform.timeSliceMs ?? 8
  if (!Number.isFinite(timeSliceMs) || timeSliceMs < 0) throw new RangeError('timeSliceMs must be finite and non-negative')
  let deadline = -Infinity
  return async function checkpoint(): Promise<void> {
    throwIfBatchAborted(control)
    if (now() < deadline) return
    await yieldToMain()
    throwIfBatchAborted(control)
    deadline = now() + timeSliceMs
  }
}

export interface BatchRun {
  readonly signal: AbortSignal
  isCurrent(): boolean
  /** 进度、结果及 finally 清理都必须经此处同步提交。 */
  commit(write: () => void): boolean
}

/**
 * 一个页面/图表的任务所有者。**提交权（commit）只归当前运行**，吊销只来自两处：
 * `start()` 被新运行顶掉、`dispose()` 页面关闭。
 * `cancel()` 只停计算（页面「取消」/「中止」按钮），**不吊销提交权**——分析器中止时会带上
 * 已算部分返回，那部分结果仍由该运行自己发布（曲线 / 海选「保留已算部分」的依据）。
 */
export function createBatchOwner() {
  let current: AbortController | null = null
  let disposed = false

  function cancel(): void {
    current?.abort()
  }

  return {
    start(): BatchRun {
      if (disposed) throw new DOMException('任务所属页面已关闭', 'AbortError')
      const previous = current
      const controller = new AbortController()
      current = controller
      previous?.abort()
      const isCurrent = () => !disposed && current === controller
      return {
        signal: controller.signal,
        isCurrent,
        commit(write) {
          if (!isCurrent()) return false
          write()
          return true
        },
      }
    },
    cancel,
    dispose(): void {
      disposed = true
      cancel()
    },
  }
}

/** 页面/图表侧持有的任务所有者类型（`createBatchOwner` / `useBatchOwner` 的返回值） */
export type BatchOwner = ReturnType<typeof createBatchOwner>

/** Vue Adapter：离开页面后即使异步计算恢复，也不能再提交结果。 */
export function useBatchOwner() {
  const owner = createBatchOwner()
  if (getCurrentScope()) onScopeDispose(owner.dispose)
  return owner
}
