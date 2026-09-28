/**
 * CC-243：core/resource/moveLookup 的 find* 族（各通道喧响）/ 融合组喧响 / 平A回能秒均吃逻辑编辑器行规则。
 *
 * core 不得 import 逻辑编辑器 ⇒ 以 `RowValueReader` 注入：core 默认 rawRowReader（原始首列），
 * 编排层注入 data `fusedRowReader`。修前第 265 轮探针：雅 energy_recovery ×2 仅 +5.54%（平A回能不吃规则），修后 +12.34%。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import { fusedRowReader } from '@/data/moveTableQueries'
import { calcBasicAttackRegenPerSec, findChainAttack, findUltimate } from '@/core/resource/moveLookup'
import type { AgentSkills } from '@/types/catalog'

afterEach(() => setActiveRowFusionRules([]))

const catalog = JSON.parse(readFileSync(join(process.cwd(), 'public/static/catalog.json'), 'utf-8'))
const skillsOf = (agentId: string) => (catalog.agentSkills as AgentSkills[]).find(s => s.agentId === agentId)!
const allMoves = (s: AgentSkills) => s.categories.flatMap(c => c.moves)
const rulesFor = (s: AgentSkills, agentId: string, rowId: string) =>
  allMoves(s).map(m => ({ id: `t_${m.id}_${rowId}`, name: 't', agentId, moveId: m.id, rowId, multiplier: 2, enabled: true, note: '' }))

describe('CC-243 moveLookup 行取值注入', () => {
  for (const agentId of ['1091', '1191']) {
    it(`${agentId}：decibel_recovery ×2 ⇒ 注入后连携/终结喧响 ×2；不注入（core 默认）不变`, () => {
      const s = skillsOf(agentId)
      const chain0 = findChainAttack(s, fusedRowReader)!.decibelRecovery
      const ult0 = findUltimate(s, fusedRowReader)!.decibelRecovery
      expect(chain0).toBeGreaterThan(0)
      setActiveRowFusionRules(rulesFor(s, agentId, 'decibel_recovery'))
      expect(findChainAttack(s, fusedRowReader)!.decibelRecovery).toBeCloseTo(chain0 * 2, 9)
      expect(findUltimate(s, fusedRowReader)!.decibelRecovery).toBeCloseTo(ult0 * 2, 9)
      expect(findChainAttack(s)!.decibelRecovery).toBeCloseTo(chain0, 9)
    })

    it(`${agentId}：energy_recovery ×2 ⇒ 注入后平A回能秒均 ×2；强化平A分类不受 damage 规则影响`, () => {
      const s = skillsOf(agentId)
      const base = calcBasicAttackRegenPerSec(s, fusedRowReader)
      expect(base.energyPerSec).toBeGreaterThan(0)
      setActiveRowFusionRules(rulesFor(s, agentId, 'energy_recovery'))
      expect(calcBasicAttackRegenPerSec(s, fusedRowReader).energyPerSec).toBeCloseTo(base.energyPerSec * 2, 9)
      setActiveRowFusionRules(rulesFor(s, agentId, 'damage').map(r => ({ ...r, multiplier: 100 })))
      expect(calcBasicAttackRegenPerSec(s, fusedRowReader)).toEqual(base)
    })
  }

  it('源码：moveLookup 非注释行的 values[0] 仅限 rawRowReader 与强化平A分类判定两处', () => {
    const lines = readFileSync(resolve(__dirname, '../../core/resource/moveLookup.ts'), 'utf-8').split('\n')
    const hits = lines.filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l) && /values\??\.?\[0\]/.test(l)).map(l => l.trim())
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatch(/^export const rawRowReader/)
    expect(hits[1]).toMatch(/row\.id === 'damage'/)
  })

  it('调用点：composables/ 与 mechanics/ 调 find* 族 / 平A回能 / channelMetricsOf 必须注入 fusedRowReader', () => {
    const CALL = /\b(findExSpecial|findUltimate|findChainAttack|findDodgeCounter|findDefensiveAssist|findAssistFollowUp|findCounterAssist|calcBasicAttackRegenPerSec|channelMetricsOf|fusedGroupMetrics)\(/
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!name.endsWith('.ts')) continue
        readFileSync(p, 'utf-8').split('\n').forEach((l, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(l) || /\bfunction\b|import /.test(l)) return
          if (CALL.test(l) && !l.includes('fusedRowReader')) hits.push(`${p.split('/src/')[1]}:${i + 1}`)
        })
      }
    }
    walk(resolve(__dirname, '..'))
    walk(resolve(__dirname, '../../mechanics'))
    expect(hits).toEqual([])
  })
})
