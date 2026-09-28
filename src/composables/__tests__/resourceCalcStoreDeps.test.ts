/**
 * CC-245 / CC-246：管线后半段（composables/resourceCalc/）运行时依赖闭包的分层锁。
 *
 * - 不进入 pinia store：store 实例一律由 useResourceCalc 入口注入，resourceCalc 内只在类型位置引用；
 *   唯一允许的 stores 运行时依赖是纯函数口径 `stores/selectionReads.ts`（无 pinia）。
 * - 不进入 resourceCalc/ 以外的 composables（展示门面 / 分析器等上层；CC-246 修前 roundInputs → agentMechanicView）。
 * 这是 ARCHITECTURE.md §0「管线后半段并入 core」前提的可核对部分。
 */
import { describe, expect, it } from 'vitest'
import { runtimeImportOffenders, sourceFilesUnder } from '@/test/importClosure'

const ALLOWED_STORES = new Set(['stores/selectionReads.ts'])

describe('CC-245/246 resourceCalc 运行时依赖闭包', () => {
  it('不进入 stores/（selectionReads 除外）与 resourceCalc/ 以外的 composables', () => {
    const offenders = runtimeImportOffenders(sourceFilesUnder('composables/resourceCalc'), rel =>
      (rel.startsWith('stores/') && !ALLOWED_STORES.has(rel))
      || (rel.startsWith('composables/') && !rel.startsWith('composables/resourceCalc/')))
    expect(offenders).toEqual({})
  })
})
