/**
 * 一次性探针：下位音擎（无专武档）到底该挑哪把？
 *
 * 用户口径 2026-09-15：「右位 0 = 不抽专武、改穿下位武器，比如 A 级武器」。
 * ⇒ 「无专武」不等于「裸奔」，要显式穿一件下位。但**挑哪把**不能凭 id 顺序武断
 * （异常职业有 3 把 A 级可选），得实测伤害差多少 —— 若差异小，任选一把都行；
 * 若差异大，「无专武」这个档位就有歧义，必须让用户选或按最优挑。
 *
 * 跑法：PROBE_AGENT=<id> npx vitest run src/composables/freeCompare/__tests__/freeCompareDowngradeProbe.test.ts
 * 默认（不设 env）= 三把全跑（柏妮思 1171 / 菲欧妮 1641 / 维琳娜 1561）。
 */
import { describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mockStaticFetch } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { signatureWEngineId } from '@/composables/freeCompare/engine'

const ANOMALY_A = ['13008', '13009', '13018']
const TARGETS = process.env.PROBE_AGENT
  ? [process.env.PROBE_AGENT]
  : ['1171', '1641', '1561']

describe('探针：无专武档的下位音擎选择', () => {
  it('三把 A 级异常音擎的伤害差异（含专武本体/裸奔对照）', async () => {
    setActivePinia(createPinia())
    mockStaticFetch()
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()

    for (const target of TARGETS) {
      const sig = signatureWEngineId(catalog, target)
      const name = catalog.getAgent(target)?.name.zhCN ?? target
      const rows: Array<{ label: string; w: string; dmg: number }> = []

      // 固定一个基底队：目标 + 两个击破/支援，避免队友随目标变化
      const team: [string, string, string] = [target, '1481', '1211']
      config.applyTeamPreset(team)
      config.setCinemaLevel(0, 0)
      config.setCinemaLevel(1, 0)
      config.setCinemaLevel(2, 0)
      config.setWEngineModLevel(0, 1)

      // ① 专武本体（精炼1）
      if (sig) {
        config.setWEngine(0, sig)
        rows.push({ label: `专武本体`, w: sig, dmg: calc.teamTotalDamage.value })
      }
      // ② 三把 A 级下位（A 级默认精炼 5，与 DEFAULT/teamCompare 口径一致）
      for (const w of ANOMALY_A) {
        config.setWEngine(0, w)
        config.setWEngineModLevel(0, 5)
        rows.push({ label: `A级 ${catalog.getWEngine(w)?.name.zhCN ?? w}`, w, dmg: calc.teamTotalDamage.value })
      }
      // ③ 裸奔（空音擎）= 我原来 fallback 会不会走到这里
      config.setWEngine(0, '')
      config.setWEngineModLevel(0, 1)
      rows.push({ label: '裸奔（无音擎）', w: '', dmg: calc.teamTotalDamage.value })

      const base = rows[0]?.dmg || 1
      // eslint-disable-next-line no-console
      console.log(`\n===== ${name}(${target}) 专武=${sig ?? '无'} =====`)
      for (const r of rows) {
        console.log(`  ${r.label.padEnd(22)} ${r.w.padEnd(6)} ${(r.dmg / 1e8).toFixed(3)}亿  相对专武 ${((r.dmg / base - 1) * 100).toFixed(1)}%`)
      }
      expect(rows.length).toBeGreaterThan(0)
    }
  }, 600000)
})
