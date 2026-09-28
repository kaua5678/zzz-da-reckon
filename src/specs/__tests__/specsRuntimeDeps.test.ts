/**
 * CC-248：录入层 specs/ 运行时依赖闭包的分层锁（ARCHITECTURE §0：specs 可 import data，不可 import core / 编排 / 状态 / 展示 / 角色模块）。
 * 修前唯一越界：specs/verify.ts → core/panel（emptyPanel）。verify.ts 是「拿引擎面板跑 spec 校验」的测试执行器、
 * 唯一调用者为测试 ⇒ 迁至 src/test/specVerify.ts（测试基础设施，可依赖 core）。
 * 唯一白名单：logicEditor/fusion.ts —— 经 data/moveTableQueries 到达（N2 裁决「不做」：行规则全局快照，见 r6 §6）。
 * 判据 19（scripts/lib/layer-inversion.mjs）只管 specs/mechanics → composables 的**直接**值导入；本锁管传递闭包、覆盖更多层。
 */
import { describe, expect, it } from 'vitest'
import { runtimeImportOffenders, sourceFilesUnder } from '@/test/importClosure'

const FORBIDDEN = /^(core|composables|stores|views|components|mechanics|logicEditor)\//
const ALLOWED = new Set(['logicEditor/fusion.ts'])

describe('CC-248 specs 运行时依赖闭包', () => {
  it('不进入 core / 编排层 / 状态层 / 展示层 / 角色模块 / logicEditor（fusion 经 data 的 N2 例外除外）', () => {
    const files = sourceFilesUnder('specs')
    expect(files.length).toBeGreaterThanOrEqual(8)
    expect(runtimeImportOffenders(files, rel => FORBIDDEN.test(rel) && !ALLOWED.has(rel))).toEqual({})
  })
})
