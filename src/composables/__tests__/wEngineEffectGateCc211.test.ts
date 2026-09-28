/**
 * CC-211：展示层音擎发放判定 `wEngineEffectBlockReason` 与引擎 `collectAllBuffs` 逐条等价
 * （全音擎 × 全角色 × {未声明弱点, 冰弱点}）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { collectAllBuffs } from '@/core/buff'
import { wEngineEffectBlockReason } from '@/composables/wEngineEffectDisplay'
import type { DriveDiscConfig } from '@/types/catalog'

const NO_DISC = { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStats: {} } as unknown as DriveDiscConfig

describe('CC-211 音擎发放判定与引擎同源', () => {
  it('逐条等价：reason===null ⇔ 引擎发放', async () => {
    const { catalog } = await setupHarness([{ agentId: '1191' }, '', ''])
    const wEngines = [...new Map([...catalog.wEnginesMap.values()].map(w => [w.id, w])).values()]
    const agents = [...new Map([...catalog.agentsMap.values()].map(a => [a.id, a])).values()]
    let checked = 0
    const blockedByGate = new Set<string>()
    for (const weakness of [undefined, ['冰']] as const) {
      for (const agent of agents) {
        const cfg = { cinemaLevel: 0, wEngineModLevel: 1, enemyWeakness: weakness }
        const base = collectAllBuffs(agent, undefined, NO_DISC, catalog.driveDiscSetsMap, [], cfg)
        const baseIds = new Set([...base.outOfCombat, ...base.inCombat].map(e => e.id))
        for (const w of wEngines) {
          const all = collectAllBuffs(agent, w, NO_DISC, catalog.driveDiscSetsMap, [], cfg)
          const engineIds = new Set([...all.outOfCombat, ...all.inCombat].map(e => e.id).filter(id => !baseIds.has(id)))
          const viewIds = new Set<string>()
          for (const g of [w.effect?.selfBuff, w.effect?.teamBuff]) {
            for (const e of g?.effects ?? []) {
              if (!e?.stat) continue
              const reason = wEngineEffectBlockReason(w, g, e, agent, weakness)
              if (reason === null) viewIds.add(e.id)
              else if (reason !== '职业不匹配') blockedByGate.add(`${w.id}:${e.id}`)
            }
          }
          expect({ w: w.id, a: agent.id, ids: [...viewIds].sort() }).toEqual({ w: w.id, a: agent.id, ids: [...engineIds].sort() })
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
    // 判别力：确有「职业匹配但被组条件 / 效果限定拦下」的条目（旧展示口径只看职业，会误报生效）
    expect(blockedByGate.size).toBeGreaterThan(0)
  })

  it('源码锁：展示点不再只按职业判定音擎生效', () => {
    for (const rel of ['views/DebugPage.vue', 'composables/hpSourceBreakdown.ts']) {
      const src = readFileSync(new URL('../../' + rel, import.meta.url), 'utf8')
      expect({ rel, usesShared: /wEngineEffectBlockReason\(/.test(src) }).toEqual({ rel, usesShared: true })
      expect({ rel, specialtyOnly: /\bw(?:Engine)?\.specialty === agent\.specialty/.test(src) }).toEqual({ rel, specialtyOnly: false })
    }
  })
})
