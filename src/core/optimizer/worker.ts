// @ts-nocheck
/**
 * 优化器 Web Worker 包装
 *
 * 将优化算法运行在 Web Worker 中，避免阻塞 UI 线程。
 * 支持取消和进度回调。
 *
 * 消息协议：
 * - 主线程 → Worker:  { type: 'start', input } | { type: 'cancel' }
 * - Worker → 主线程:  { type: 'progress', metrics }
 *                     | { type: 'result', output }
 *                     | { type: 'cancelled' }
 *                     | { type: 'error', message }
 */
import { optimize, type OptimizerInput, type OptimizerOutput } from './super-bound'
import type { OptimizerMetrics } from '@/types/catalog'

// ============ 消息类型 ============

/** 主线程 → Worker 消息 */
export type WorkerRequest =
  | { type: 'start'; input: OptimizerInput }
  | { type: 'cancel' }

/** Worker → 主线程 消息 */
export type WorkerResponse =
  | { type: 'progress'; metrics: OptimizerMetrics }
  | { type: 'result'; output: OptimizerOutput }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

// ============ Worker 通信辅助 ============

/**
 * 向主线程发送消息。
 * 使用类型断言绕过 DOM lib 中 self.postMessage 需要 targetOrigin 的类型限制。
 */
function postToMain(message: WorkerResponse): void {
  ;(self as unknown as Worker).postMessage(message)
}

// ============ Worker 主逻辑 ============

/** 取消标志（由 cancel 消息设置） */
let cancelled = false
/** 是否正在运行 */
let running = false

/** 消息处理 */
async function handleMessage(msg: WorkerRequest): Promise<void> {
  if (msg.type === 'cancel') {
    cancelled = true
    return
  }

  if (msg.type === 'start') {
    if (running) {
      postToMain({ type: 'error', message: '优化器已在运行中，请先取消当前任务' })
      return
    }

    cancelled = false
    running = true

    try {
      const output = await optimize(msg.input, (metrics: OptimizerMetrics) => {
        // 上报进度
        postToMain({ type: 'progress', metrics })
        // 返回取消状态
        return cancelled
      })

      if (cancelled) {
        postToMain({ type: 'cancelled' })
      } else {
        postToMain({ type: 'result', output })
      }
    } catch (err) {
      postToMain({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      running = false
    }
  }
}

// ============ 消息监听 ============

;(self as unknown as Worker).onmessage = (
  e: MessageEvent<WorkerRequest>,
) => {
  handleMessage(e.data).catch((err) => {
    postToMain({
      type: 'error',
      message: `未处理的错误: ${err instanceof Error ? err.message : String(err)}`,
    })
  })
}
