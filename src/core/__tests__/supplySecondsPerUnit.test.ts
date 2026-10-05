/**
 * CC-496：跨槽位供给「每单位秒数」只写一份（`crossAgentSupply.ts#supplySecondsPerUnit`）。
 * 模块供给路径与琉音赠大轴覆盖路径都走它；文件里不再出现第二处 `ultimateActionTime` 缺省。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { supplySecondsPerUnit } from '@/core/resource/crossAgentSupply'
import type { CharacterOperationConfig } from '@/types/resource'

const cfg = (over: Partial<CharacterOperationConfig>) => over as CharacterOperationConfig

describe('supplySecondsPerUnit（CC-496）', () => {
  it('模块声明 secondsPerUnit 优先（拿到 targetCfg/ownCfg）；无声明或无 ownCfg → 落点 ultimateActionTime，缺省 0', () => {
    const target = cfg({ ultimateActionTime: 4.5, chainActionTime: 1.25 })
    const own = cfg({ agentId: 'x' })
    const spec = { kind: 'gift-chain:ultimate', supply: () => 0, secondsPerUnit: ({ targetCfg }: { targetCfg: CharacterOperationConfig }) => targetCfg.chainActionTime ?? 0 } as never
    expect(supplySecondsPerUnit(spec, target, own)).toBe(1.25)
    expect(supplySecondsPerUnit(spec, target, undefined)).toBe(4.5)
    expect(supplySecondsPerUnit(undefined, target, own)).toBe(4.5)
    expect(supplySecondsPerUnit(undefined, cfg({}), own)).toBe(0)
  })
  it('源码锁：crossAgentSupply.ts 里 `ultimateActionTime ??` 只在 helper 出现一次，两条路径都调 helper', () => {
    const src = readFileSync(join(__dirname, '..', 'resource', 'crossAgentSupply.ts'), 'utf8')
    const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code.split('ultimateActionTime ??').length - 1).toBe(1)
    expect(code.split('supplySecondsPerUnit(').length - 1).toBe(3) // 定义 1 + 调用 2
  })
})
