/**
 * CC-59：agentAxisRageCombos 与原 StunAxisPage 写死判断（1471 + banyue-combo / banyue-combo-didong）逐值一致。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { agentAxisRageCombos, agentCombos } from '@/composables/agentMechanicView'

const P = 'banyue-combo'
const D = 'banyue-combo-didong'
const legacyIsRage = (agentId: string, comboId: string) => agentId === '1471' && (comboId === P || comboId === D)
const legacyDidongShare = (comboId: string, moveId: string) => comboId === P && moveId === D
const legacyPrimary = (comboId: string) => comboId === P
const legacyMingwangTrigger = (moveId: string) => moveId === P || moveId === D

describe('CC-59 般岳怒相连段 comboId → 模块声明 axisRageCombos', () => {
  it('全 catalog 角色 × 全部 combo id：怒相判定 / didong 共享 / primary 分支与原判断逐值相等', async () => {
    const { catalog } = await setupHarness([{ agentId: '1471' }, '', ''])
    const ids = [...catalog.agentsMap.keys()]
    expect(ids.length).toBeGreaterThan(30)
    let hits = 0
    for (const id of ['', ...ids]) {
      const rc = agentAxisRageCombos(id)
      const comboIds = [...new Set([...Object.keys(agentCombos(id) ?? {}), P, D, 'basic'])]
      for (const comboId of comboIds) {
        const isRage = !!rc && (comboId === rc.primary || comboId === rc.didong)
        expect(isRage, `${id}/${comboId}`).toBe(legacyIsRage(id, comboId))
        if (isRage) {
          hits++
          expect(comboId === rc?.primary).toBe(legacyPrimary(comboId))
          for (const mid of [P, D, 'basic']) {
            expect(!!rc && comboId === rc.primary && mid === rc.didong, `${comboId}/${mid}`).toBe(legacyDidongShare(comboId, mid))
          }
        }
      }
    }
    expect(hits).toBe(2)
  }, 60000)

  it('般岳声明：两个 id 都是其 combos 的 key；明王触发集合与原字面量相同', () => {
    const rc = agentAxisRageCombos('1471')
    expect(rc).toEqual({ primary: P, didong: D })
    const keys = Object.keys(agentCombos('1471') ?? {})
    expect(keys).toContain(rc?.primary)
    expect(keys).toContain(rc?.didong)
    for (const mid of [P, D, 'basic', '1471012']) {
      expect(mid === rc?.primary || mid === rc?.didong).toBe(legacyMingwangTrigger(mid))
    }
    expect(agentAxisRageCombos(null)).toBeUndefined()
  })

  it('StunAxisPage 不再写死怒相连段 comboId 字面量', () => {
    const src = readFileSync(resolve(__dirname, '../../views/StunAxisPage.vue'), 'utf8')
    expect(src.includes("'" + P)).toBe(false)
  })
})
