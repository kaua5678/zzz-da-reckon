/**
 * **3D 面拖拽状态机**判据（2026-10-19 用户报「点击一次后就粘手上了，一直跟着鼠标转」）。
 *
 * ## 锁什么
 *
 * 原实现只在 `mouseleave` 清拖拽标志 ⇒ 鼠标**在画布内松开**（最常见操作）后标志恒真，
 * 之后每次 `mousemove` 都被当成拖拽，图形跟着鼠标转。
 *
 * 本判据是**源码锁**：断言模板同时绑定了 `pointerup` / `pointercancel` /
 * `lostpointercapture` 三个释放通道，且 `onDown` 调用了 `setPointerCapture`。
 * 行为面另由实机判据覆盖（`.zc/perf/dragStuck2.mjs`，真实 CDP 鼠标：松开后画面不变），
 * 因为 jsdom 没有真实指针捕获语义，纯单测无法复现。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(
  fileURLToPath(new URL('../InteractionSurface3D.vue', import.meta.url)),
  'utf8',
)
/** 去注释，避免注释里的词命中判据 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

describe('InteractionSurface3D 拖拽状态机', () => {
  it('★ 三个释放通道都绑定（pointerup / pointercancel / lostpointercapture）', () => {
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      expect(CODE, '必须监听 ' + ev + '（只靠 pointerleave 会让「画布内松开」粘住）')
        .toContain('@' + ev + '=')
    }
  })

  it('★ pointerdown 时捕获指针（松开事件必定回到本元素）', () => {
    expect(CODE, 'onDown 必须 setPointerCapture').toContain('setPointerCapture')
  })

  it('★ 不使用 mouse 事件做拖拽（与 pointer 混用会漏掉触摸/笔，且语义不同）', () => {
    expect(CODE, '拖拽必须走 pointer 事件').not.toContain('@mousedown')
    expect(CODE, '拖拽必须走 pointer 事件').not.toContain('@mousemove')
  })

  it('★ pointerleave 不再清拖拽标志（拖着移出画布是正常操作，不该中断）', () => {
    const fn = CODE.slice(CODE.indexOf('function onLeave'), CODE.indexOf('function onLeave') + 400)
    expect(fn, 'onLeave 里不得写 dragging = false').not.toMatch(/dragging\s*=\s*false/)
  })
})
