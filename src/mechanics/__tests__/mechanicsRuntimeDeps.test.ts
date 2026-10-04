/**
 * 录入层（mechanics）运行时依赖闭包的**分层锁**。
 *
 * 为什么需要：core / specs / data 三层都有闭包锁（`*RuntimeDeps.test.ts`），唯独 mechanics——
 * 全仓最大、改动最热的一层（62 个模块对象 / 3.2 万行）——只有**直接 import** 锁
 * （判据 19 `layer-inversion` 管 mechanics→composables 的值导入）。直接锁看不见「经 data 绕一圈」的越层：
 * 实测闭包里的 `logicEditor/fusion.ts` 正是这样进来的（`mechanics/agents/aire.ts` > `data/moveTableQueries.ts` >
 * `logicEditor/fusion.ts`，即 `ARCHITECTURE-OVERVIEW.md` §3 A3 记的隐式全局状态）。
 *
 * 当前闭包事实（2026-10-04 实测，本锁把它钉住）：mechanics 的运行时闭包只进 `specs/`（spec 解释器）
 * 与 `logicEditor/fusion.ts`（经 data 带入的全局快照）——**一个 composables / stores / views / components 都没进**。
 * 这两条例外是有意的（spec 解释器是录入层的正常依赖；fusion 快照是已登记的 A3 欠账，收口时同步收紧本锁）。
 *
 * 与判据 19 的分工：判据 19 管「mechanics 直接值导入 composables」；本锁管**传递闭包**不得触达编排/状态/展示层。
 */
import { describe, expect, it } from 'vitest'
import { runtimeImportOffenders, sourceFilesUnder } from '@/test/importClosure'

/** 编排层 / 状态层 / 展示层：录入层闭包绝不许进入 */
const FORBIDDEN = /^(composables|stores|views|components)\//
/** 已登记的两条例外（见文件头；收紧时把 logicEditor 也挪进 FORBIDDEN） */
const ALLOWED_UPPER = /^(specs\/|logicEditor\/fusion\.ts$)/

describe('录入层 mechanics 运行时依赖闭包', () => {
  it('不进入编排层 / 状态层 / 展示层（specs 与 logicEditor/fusion 为已登记例外）', () => {
    const offenders = runtimeImportOffenders(
      sourceFilesUnder('mechanics'),
      rel => FORBIDDEN.test(rel) || (/^(specs|logicEditor)\//.test(rel) && !ALLOWED_UPPER.test(rel)),
    )
    expect(offenders).toEqual({})
  })

  it('反空洞：确实扫到了模块（否则 sourceFilesUnder 返回空集会假绿）', () => {
    const files = sourceFilesUnder('mechanics')
    expect(files.length).toBeGreaterThan(50)
    expect(files.some(f => f.includes('/agents/'))).toBe(true)
  })
})
