import { getCurrentScope, onScopeDispose } from 'vue'

/** 批任务的协作式取消；只在独立场景上运行，不能替代数据隔离。 */
export interface BatchControl {
  signal?: AbortSignal
  /** 兼容旧调用方；新页面传 signal。 */
  shouldAbort?: () => boolean
}

export function throwIfBatchAborted(control: BatchControl): void {
  if (control.signal?.aborted || control.shouldAbort?.()) {
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

/** 一个页面/图表的任务所有者；新运行、输入失效与关闭均撤销前任的提交权。 */
export function createBatchOwner() {
  let current: AbortController | null = null
  let disposed = false

  function cancel(): void {
    const previous = current
    current = null
    previous?.abort()
  }

  return {
    start(): BatchRun {
      if (disposed) throw new DOMException('任务所属页面已关闭', 'AbortError')
      const previous = current
      const controller = new AbortController()
      current = controller
      previous?.abort()
      const isCurrent = () => !disposed && current === controller && !controller.signal.aborted
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

/** Vue Adapter：离开页面后即使异步计算恢复，也不能再提交结果。 */
export function useBatchOwner() {
  const owner = createBatchOwner()
  if (getCurrentScope()) onScopeDispose(owner.dispose)
  return owner
}
