/**
 * CC-247：core 运行时依赖闭包的分层锁（C1 `coreMechanicsRegistryOnly.test` 只钉直接 import，本锁钉**传递闭包**）。
 *
 * core 只允许经 `mechanics/registry.ts`（纯叶子：只有类型 import）查询模块；闭包不得进入 mechanics 其余部分、
 * specs、logicEditor（全局可变快照）、composables、stores、views、components。
 * 修前：registry 值导入 specs/registry + specs/mechanics（仅为注册时合并 spec settings）⇒
 * core/resource/assembleSlot > mechanics/registry > specs/mechanics > data/moveTableQueries > logicEditor/fusion。
 */
import { describe, expect, it } from 'vitest'
import { runtimeImportOffenders, sourceFilesUnder } from '@/test/importClosure'

const FORBIDDEN = /^(specs|logicEditor|composables|stores|views|components)\//

describe('CC-247 core 运行时依赖闭包', () => {
  it('只经 mechanics/registry 触达 mechanics；不进入 specs / logicEditor / 编排层 / 状态层 / 展示层', () => {
    const offenders = runtimeImportOffenders(sourceFilesUnder('core'), rel =>
      FORBIDDEN.test(rel) || (rel.startsWith('mechanics/') && rel !== 'mechanics/registry.ts'))
    expect(offenders).toEqual({})
  })

  it('mechanics/registry.ts 无运行时 import（纯叶子）', () => {
    const offenders = runtimeImportOffenders(sourceFilesUnder('mechanics').filter(f => f.endsWith('/registry.ts')), () => true)
    expect(offenders).toEqual({})
  })
})
