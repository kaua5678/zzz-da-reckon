/**
 * 共享 canvas 场景壳：DPR 尺寸、ResizeObserver、主题重绘、rAF 合帧。
 *
 * 为什么抽出来：4 个 3D 组件各自抄了一遍「取 wrap 尺寸 → 乘 devicePixelRatio → 改 canvas.width/height →
 * setTransform → clearRect → 挂 ResizeObserver → 切主题重绘」。漏一处就是画面拉伸/停在旧主题/尺寸为 0 不画，
 * 而每个组件的业务绘制逻辑并不需要关心这些。
 *
 * 口径：
 * - `render(ctx, size)` 拿到的 canvas 已按 DPR 缩放、已清空，画布 CSS 尺寸 = `size.w × size.h`；
 * - 所有重绘（props watch / 主题翻转 / resize / 交互）都走 `requestRender()`，rAF 合帧；
 * - 组件仍自己管业务状态与相机；本模块不导出任何绘制原语。
 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { useThemeRedraw } from '@/utils/canvasTheme'

export interface CanvasSceneSize {
  w: number
  h: number
}

export interface CanvasSceneOptions {
  wrapRef: Ref<HTMLElement | null>
  canvasRef: Ref<HTMLCanvasElement | null>
  /** 真正的业务绘制；ctx 已做 DPR 变换与清屏 */
  render: (ctx: CanvasRenderingContext2D, size: CanvasSceneSize) => void
}

export interface CanvasScene {
  /** 最近一次渲染的 CSS 尺寸（组件 hit-test/toScreen 直接读；渲染前为 0） */
  size: CanvasSceneSize
  /** 合帧重绘（同帧多次调用只画一次） */
  requestRender: () => void
  /** 立即重绘（一般只在需要同步测量的场景用） */
  renderNow: () => void
}

export function useCanvasScene(opts: CanvasSceneOptions): CanvasScene {
  const size: CanvasSceneSize = { w: 0, h: 0 }
  let frame: number | null = null
  let disposed = false
  let observer: ResizeObserver | null = null

  function renderNow(): void {
    if (disposed) return
    const wrap = opts.wrapRef.value
    const canvas = opts.canvasRef.value
    if (!wrap || !canvas) return
    const w = wrap.clientWidth
    const h = wrap.clientHeight
    if (w <= 0 || h <= 0) return
    size.w = w
    size.h = h
    const dpr = window.devicePixelRatio || 1
    const pxW = Math.max(1, Math.round(w * dpr))
    const pxH = Math.max(1, Math.round(h * dpr))
    if (canvas.width !== pxW) canvas.width = pxW
    if (canvas.height !== pxH) canvas.height = pxH
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    opts.render(ctx, size)
  }

  function requestRender(): void {
    if (disposed || frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      renderNow()
    })
  }

  // CC-348：切明暗必须重绘，否则画面停在旧主题
  useThemeRedraw(requestRender)
  onMounted(() => {
    requestRender()
    if (typeof ResizeObserver !== 'undefined' && opts.wrapRef.value) {
      observer = new ResizeObserver(() => requestRender())
      observer.observe(opts.wrapRef.value)
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    if (frame !== null) {
      cancelAnimationFrame(frame)
      frame = null
    }
    observer?.disconnect()
    observer = null
  })

  return { size, requestRender, renderNow }
}
