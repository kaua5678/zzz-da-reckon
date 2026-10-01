/**
 * Canvas 主题桥（CC-348）：① 夜间兜底表与 global.css `:root` 逐字一致；② withAlpha 语义；
 * ③ onThemeChange 只在明暗翻转时回调；④ 源码锁：canvas 读 CSS 变量只走 `utils/canvasTheme.ts`（防止各组件再抄一份读取器 + 兜底常量）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { onThemeChange, readThemeVar, SCENE_ROOT_FALLBACK, themeReader, withAlpha, type SceneVar } from '@/utils/canvasTheme'

const SRC = resolve(__dirname, '../..')

function rootBlock(): string {
  const css = readFileSync(join(SRC, 'styles/global.css'), 'utf8')
  const start = css.indexOf(':root {')
  expect(start, 'global.css 找不到 :root 块').toBeGreaterThanOrEqual(0)
  // :root 块内没有嵌套花括号；注释里也不含 }（若哪天有了，这里会截短 → 下面的断言会红而不是静默通过）
  return css.slice(start, css.indexOf('}', start))
}

describe('canvasTheme', () => {
  it('兜底表与 global.css :root 逐字一致（无 DOM 时 canvas 画出的就是夜间主题）', () => {
    const root = rootBlock().replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [name, fallback] of Object.entries(SCENE_ROOT_FALLBACK)) {
      const m = new RegExp(`${name}:\\s*([^;]+);`).exec(root)
      expect(m, `:root 里没有 ${name}`).not.toBeNull()
      expect(m![1]!.trim(), name).toBe(fallback)
    }
  })

  it('无 DOM：读取器回落兜底表', () => {
    // vitest 环境若带 DOM，计算样式里没有这些变量（未加载 global.css）也会回落兜底
    const read = themeReader()
    for (const name of Object.keys(SCENE_ROOT_FALLBACK) as SceneVar[]) {
      expect(read(name)).toBe(SCENE_ROOT_FALLBACK[name])
      expect(readThemeVar(name)).toBe(SCENE_ROOT_FALLBACK[name])
    }
  })

  it('withAlpha：hex3 / hex6 / rgb / rgba（替换 α）/ 空格语法；不认识的原样返回', () => {
    expect(withAlpha('#63e2b7', 0.4)).toBe('rgba(99, 226, 183, 0.4)')
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
    expect(withAlpha(' rgb(1, 2, 3) ', 0.16)).toBe('rgba(1, 2, 3, 0.16)')
    expect(withAlpha('rgba(1,2,3,0.9)', 0.45)).toBe('rgba(1, 2, 3, 0.45)')
    expect(withAlpha('rgb(1 2 3)', 0.2)).toBe('rgba(1, 2, 3, 0.2)')
    expect(withAlpha('hsl(120, 50%, 50%)', 0.3)).toBe('hsl(120, 50%, 50%)')
    expect(withAlpha('red', 0.3)).toBe('red')
  })

  it('onThemeChange：只在 html.light 翻转时回调；退订后不再回调；无 DOM 为空操作', () => {
    expect(() => onThemeChange(() => {})()).not.toThrow() // node 环境无 document
    const classes = new Set<string>()
    let fire: (() => void) | null = null
    let disconnected = false
    const g = globalThis as Record<string, unknown>
    g.document = { documentElement: { classList: { contains: (c: string) => classes.has(c) } } }
    g.MutationObserver = class {
      constructor(cb: () => void) { fire = cb }
      observe() {}
      disconnect() { disconnected = true }
    }
    try {
      let calls = 0
      const off = onThemeChange(() => { calls++ })
      classes.add('other'); fire!()
      expect(calls, '无关 class 变动不该重绘').toBe(0)
      classes.add('light'); fire!()
      expect(calls).toBe(1)
      fire!()
      expect(calls, '同一主题重复通知不该重绘').toBe(1)
      classes.delete('light'); fire!()
      expect(calls).toBe(2)
      off()
      expect(disconnected).toBe(true)
    } finally {
      delete g.document
      delete g.MutationObserver
    }
  })

  it('三个 canvas 组件都接了 useThemeRedraw（否则切主题后画面停在旧主题）', () => {
    for (const f of ['TeamDamage3DChart.vue', 'DifficultyCurve3DChart.vue', 'ResponseSurface3D.vue']) {
      expect(readFileSync(join(SRC, 'components/charts', f), 'utf8'), f).toMatch(/\buseThemeRedraw\(/)
    }
  })

  it('源码锁：src 里读 CSS 变量（getPropertyValue）只在 utils/canvasTheme.ts', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name)) continue
        const rel = relative(SRC, p).replace(/\\/g, '/')
        if (rel === 'utils/canvasTheme.ts') continue
        if (/\.getPropertyValue\(/.test(readFileSync(p, 'utf8'))) hits.push(rel)
      }
    }
    walk(SRC)
    expect(hits, '这些文件自己读 CSS 变量；改用 utils/canvasTheme.ts（readThemeVar / themeReader）').toEqual([])
  })
})
