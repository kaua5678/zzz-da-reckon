/**
 * Canvas 主题桥：自绘 canvas 场景（`components/charts/*3D*.vue`）读主题色的唯一入口。
 *
 * 为什么需要它：Canvas 的 `fillStyle` / `strokeStyle` 不是 CSS 属性，**不解析 `var(--x)`**——
 * 赋值被浏览器静默忽略，画布沿用上一笔颜色且不报错（2026-09-18 round 29 实测：TeamDamage3DChart
 * 的柱阵标签因此继承了上一片的阴影色）。⇒ 主题由 `global.css` 的 CSS 变量承载，canvas 侧必须**读回**真实值。
 *
 * CC-348 之前三个 3D 组件各写一份 `cssVarColor` / `sceneInk()` + 各自一份「夜间兜底」常量
 * （注释都写「与 :root 逐字同值」，但没有任何检查），另有两份行为不同的 `withAlpha`。
 * 现在：读取、兜底表、主题判定、加 α 都在这里；兜底表与 `global.css` `:root` 逐字一致由
 * `__tests__/canvasTheme.test.ts` 锁住，新增 canvas 组件不许再自己 `getPropertyValue`（同一测试的源码锁）。
 *
 * 主题切换重绘（CC-348 顺带修）：canvas 只在 props / 尺寸 / 悬停变化时重画，切主题后会**停留在旧主题的画面**
 * 直到下一次交互（2026-10-02 实测三组件都这样：切到明亮后画布哈希不变，拖一下窗口才变）。
 * 组件 setup 里调 `useThemeRedraw(重绘函数)` 即可；判定只看 `html.light` 的翻转，与 `stores/theme.ts#applyMode` 同源。
 *
 * 不缓存：每帧读一次计算样式（一次 `getComputedStyle` 相对整帧绘制可忽略，ResponseSurface3D 实测 13×13 曲面整帧 < 8ms）；
 * 缓存就得自己接主题切换事件。
 */

import { onBeforeUnmount, onMounted } from 'vue'

/**
 * canvas 场景用到的令牌及其**夜间兜底**（无 DOM——SSR / 单测——或变量缺失时用）。
 * 值必须与 `src/styles/global.css` 的 `:root` 逐字相同（测试锁定）。
 * `--scene-ink-rgb` 是**裸 RGB 三元组**，用法是 `rgba(${rgb}, α)`。
 */
export const SCENE_ROOT_FALLBACK = {
  '--scene-ink-rgb': '255, 255, 255',
  '--scene-ink-dim': 'rgba(255, 255, 255, 0.55)',
  '--scene-panel': 'rgba(15, 20, 32, 0.88)',
  '--scene-panel-line': 'rgba(255, 255, 255, 0.18)',
  '--scene-shadow': '0 4px 16px rgba(0, 0, 0, 0.4)',
  '--scene-axis-x': '#38bdf8',
  '--scene-axis-y': '#a78bfa',
  '--scene-axis-z': '#63e2b7',
  '--scene-mark-cur': '#63e2b7',
  '--scene-mark-max': '#fbbf24',
  '--app-text-solid': '#ffffff',
  '--c-danger': '#f87171',
} as const

export type SceneVar = keyof typeof SCENE_ROOT_FALLBACK

function hasDom(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/**
 * 取一帧的读取器：只做一次 `getComputedStyle`，之后按名读（一帧要读多个令牌时用它）。
 * 无 DOM 或变量为空时回落 `SCENE_ROOT_FALLBACK`。
 */
export function themeReader(): (name: SceneVar) => string {
  if (!hasDom()) return name => SCENE_ROOT_FALLBACK[name]
  const cs = getComputedStyle(document.documentElement)
  return name => cs.getPropertyValue(name).trim() || SCENE_ROOT_FALLBACK[name]
}

/** 读单个令牌（跟随主题）。 */
export function readThemeVar(name: SceneVar): string {
  return themeReader()(name)
}

/** 明亮主题？（`html.light`；无 DOM = 夜间） */
export function isLightTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('light')
}

/**
 * 给色值加 α：`#rgb` / `#rrggbb` / `rgb()` / `rgba()`（已有 α 则替换）→ `rgba(r, g, b, α)`；
 * 其它写法（`hsl()`、颜色名等）原样返回——不猜、不抛。
 * 用途：场景标记柔光、曲线幕布等「同一主题色的半透明版」；固定写 `rgba(...)` 字面量会在明亮档变成另一个色相。
 */
export function withAlpha(color: string, alpha: number): string {
  const s = color.trim()
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    const n = parseInt(h, 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s)
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`
  return s
}

/**
 * 订阅明暗主题翻转（`html` 的 `light` class 变化），返回退订函数。无 DOM / 无 MutationObserver 时为空操作。
 * 只在明暗真的翻转时回调（同一元素上其它 class 变动不触发）。
 */
export function onThemeChange(cb: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  let light = isLightTheme()
  const mo = new MutationObserver(() => {
    const now = isLightTheme()
    if (now === light) return
    light = now
    cb()
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => mo.disconnect()
}

/** Vue 组件用：挂载后订阅主题翻转、卸载前退订；翻转时调 `redraw`（通常是组件的 requestRender / draw）。 */
export function useThemeRedraw(redraw: () => void): void {
  let off: (() => void) | null = null
  onMounted(() => { off = onThemeChange(redraw) })
  onBeforeUnmount(() => { off?.(); off = null })
}
