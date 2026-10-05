import { getCurrentScope, onScopeDispose } from 'vue'

/**
 * 批任务的协作式取消与结果归属；只在独立场景上运行，不能替代数据隔离。
 *
 * 取消通道只有一条：`signal`（AbortSignal，由 `createBatchOwner#start` 发车、`cancel` 吊销计算）。
 * S4（CC-343）起分析器与页面统一走它，早期的 `shouldAbort: () => boolean` 页面回调已废除。
 *
 * **中止语义只有一种：优雅式**——分析器在循环头 `isBatchAborted` 后 `break`，带上已算部分返回，
 * 发布还是丢弃由页面决定（曲线 / 海选「保留已算部分」）。第 421 轮删掉了从未接线的抛错式
 * `createBatchScheduler` / `throwIfBatchAborted`（时间片让步 + 抛错），依据见
 * `docs/mcp-analyzer-scenario-isolation.md` §7：生产零调用方；Web Worker 里也不必向主线程让步；
 * 两种取消惯用法共处一个 100 行模块，正是第 374 轮差点接错线的诱因。
 */
export interface BatchControl {
  signal?: AbortSignal
}

/** 非抛出的取消探测：已取消返回 true。之后由调用方决定发布已算部分还是丢弃。 */
export function isBatchAborted(control: BatchControl = {}): boolean {
  return control.signal?.aborted === true
}

/** 进度回调载荷：pct 0–1，text 给页面状态栏 */
export interface BatchProgress { pct: number; text: string }

/**
 * 批任务公共选项（CC-490）：取消句柄 + 进度回调。各 compute* / run* 的 Options `extends BatchTaskOptions`，
 * 不再各自内联这两行（CC-490 前 `onProgress?: (p: { pct; text }) => void` 10 处、`control?: BatchControl` 13 处各写一遍）。
 * 取消语义统一：被新运行顶掉 / 页面取消时及早停算；已算部分发布还是丢弃由调用方决定（各任务头注释写明粒度）。
 */
export interface BatchTaskOptions {
  onProgress?: (p: BatchProgress) => void
  control?: BatchControl
}

/** 各任务开头那行 `report` 闭包的唯一实现：`(pct, text) => onProgress?.({ pct, text })` */
export function batchReporter(opts: Pick<BatchTaskOptions, 'onProgress'>): (pct: number, text: string) => void {
  return (pct, text) => opts.onProgress?.({ pct, text })
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
