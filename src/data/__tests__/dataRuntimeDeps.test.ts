/**
 * CC-248：数据层 data/ 运行时依赖闭包的分层锁（data 是最底层的静态数据与纯查询：不得依赖任何上层）。
 * 先例约定：data/stunAxisPresets.ts「data 层不 import mechanics」（提示对象由调用方注入）。
 * 唯一白名单：data/moveTableQueries.ts → logicEditor/fusion.ts（getRowValue 读行规则全局快照；N2 裁决「不做」，见 r6 §6）。
 */
import { describe, expect, it } from 'vitest'
import { runtimeImportOffenders, sourceFilesUnder } from '@/test/importClosure'

const FORBIDDEN = /^(core|composables|stores|views|components|mechanics|specs|logicEditor)\//
const ALLOWED = new Set(['logicEditor/fusion.ts'])

describe('CC-248 data 运行时依赖闭包', () => {
  it('不进入任何上层（fusion 的 N2 例外除外）', () => {
    const files = sourceFilesUnder('data')
    expect(files.length).toBeGreaterThanOrEqual(20)
    expect(runtimeImportOffenders(files, rel => FORBIDDEN.test(rel) && !ALLOWED.has(rel))).toEqual({})
  })

  it('N2 例外本身不外溢：fusion.ts 运行时闭包不再进入 logicEditor 其他文件或任何上层', () => {
    const fusion = sourceFilesUnder('logicEditor').filter(f => f.endsWith('/fusion.ts'))
    expect(fusion).toHaveLength(1)
    expect(runtimeImportOffenders(fusion, rel => /^(core|composables|stores|views|components|mechanics|specs|logicEditor)\//.test(rel))).toEqual({})
  })
})
