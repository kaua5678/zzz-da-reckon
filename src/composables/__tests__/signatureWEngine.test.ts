/**
 * CC-498：「专武 = ownerAgentId === agentId」只写一份（`composables/signatureWEngine.ts`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signatureWEngineOf } from '@/composables/signatureWEngine'
import type { WEngine } from '@/types/catalog'

const w = (id: string, ownerAgentId?: string) => ({ id, ownerAgentId } as unknown as WEngine)

describe('signatureWEngineOf（CC-498）', () => {
  it('按 ownerAgentId 找专武；无目录 / 无专武 → undefined；只认精确相等', () => {
    const catalog = { displayWEngines: [w('a'), w('b', '1091'), w('c', '1191')] }
    expect(signatureWEngineOf(catalog, '1191')?.id).toBe('c')
    expect(signatureWEngineOf(catalog, '1')).toBeUndefined()
    expect(signatureWEngineOf({ displayWEngines: undefined }, '1091')).toBeUndefined()
  })
  it('源码锁：src 下（测试除外）不再手写 find(… ownerAgentId === …)', () => {
    const files = [
      'stores/config.ts', 'composables/pullPlannerEngine.ts', 'composables/teamTimelineStore.ts',
      'composables/freeCompare/engine.ts', 'composables/teamCompare.ts', 'composables/signatureWEngine.ts',
    ]
    let defs = 0
    for (const f of files) {
      const src = readFileSync(join(__dirname, '..', '..', f), 'utf8')
      const hits = (src.match(/find\(\w+ => \w+\.ownerAgentId ===/g) ?? []).length
      if (f.endsWith('signatureWEngine.ts')) defs += hits
      else expect(hits, f).toBe(0)
    }
    expect(defs).toBe(1)
  })
})
