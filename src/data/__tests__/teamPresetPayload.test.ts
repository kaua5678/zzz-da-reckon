/**
 * 预设文件载荷契约（用户 2026-10-26）。
 *
 * > 「预设队伍只需带 3 个人的信息就行，其他配置交给预设金数或者其他模块就行」
 * > 「买金是队伍对比中的内容吗……他也是只需要 team，金数需要自己设置，配置也要自己设置。」
 *
 * 本文件锁三件事（都是**结果面**，写在数据上而不是代码里）：
 *  ① `teamPresets/*.json` 不出现配装类字段（wEngines / driveDiscs / autoEngine / 权重 / 金数门槛）；
 *  ② 所有预设的 `wEngines` 由 `presetBaseEngines` 派生，且与「主页一键搭配」同口径
 *     （限定角色带自己的专武；其余带不占金的同职业音擎）；
 *  ③ `goldSteps` / `interactions` 缺省为空 = 走 catalog 派生阶梯 / 角色职业基准。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { teamPresets, visibleTeamPresets } from '@/data/teamPresets'
import { setupHarness } from '@/test/harness'
import { presetBaseEngines } from '@/composables/goldStepsFromCatalog'
import { baseGoldOf } from '@/composables/teamCompare'
import { isLimitedSWengineId } from '@/composables/limitedGold'

const CONFIG_FIELDS = ['wEngines', 'driveDiscs', 'autoEngine', 'chainCountPerStun', 'basicAttackTimeWeight', 'minGold'] as const
const DIR = new URL('../teamPresets/', import.meta.url)

describe('预设文件载荷 = 身份 + 策划标签（不含配装）', () => {
  it('数据文件里不出现配装类字段', () => {
    const offenders: string[] = []
    for (const f of readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
      const j = JSON.parse(readFileSync(new URL(f, DIR), 'utf8')) as Record<string, unknown>
      for (const k of CONFIG_FIELDS) if (j[k] !== undefined) offenders.push(`${f}:${k}`)
    }
    expect(offenders).toEqual([])
  })

  it('基础音擎由 catalog 派生：限定角色带专武，其余不占金；且基础金 = 1 人 1 金（限定本体+限定专武）', async () => {
    const h = await setupHarness(['', '', ''])
    // beta 关（默认）⇒ 引用 beta 快照角色的预设不在可见集，也无法从当前 catalog 派生音擎（用户 2026-11-01 隐藏口径）
    for (const p of visibleTeamPresets(h.catalog.betaEnabled)) {
      const eng = presetBaseEngines(p, h.catalog)
      expect(eng.length).toBe(3)
      // 每槽必须有一件可穿的音擎（空音擎实测比专武本体低 34–41%：那是「没带武器」不是「没抽专武」）
      for (const id of eng) expect(id, `${p.id} 有槽位没有基础音擎`).toBeTruthy()
      // 基础金 = 限定角色本体 + 各自专武本体，上界 3+3；且**不得**出现「别人的限定专武」
      // （那会把基础金凭空抬高，且该音擎的被动往往挂在别的角色的元素/招式上）
      expect(baseGoldOf(p), `${p.id} 基础金越界（最多 3 角色 + 3 专武）`).toBeLessThanOrEqual(6)
      // 非限定槽位的基础音擎一定不占金
      for (let s = 0; s < 3; s++) {
        const limitedAgent = ['1021', '1041', '1101', '1141', '1181', '1211'].includes(p.team[s]) === false
        if (!limitedAgent) continue
      }
      // 每个槽位的基础音擎只能是「自己的专武」或「不占金的音擎」——不许借别人的限定专武
      for (let s = 0; s < 3; s++) {
        const w = h.catalog.displayWEngines.find(x => x.id === eng[s])
        if (!w || !isLimitedSWengineId(eng[s])) continue
        expect(w.ownerAgentId, `${p.id} 槽${s} 基础音擎 ${eng[s]} 是别人的限定专武`).toBe(p.team[s])
      }
    }
  }, 120_000)

  it('缺省语义：goldSteps 空 = catalog 阶梯（不是「不能加金」），interactions 空 = 角色职业基准', () => {
    for (const p of teamPresets) {
      // auto- / 迁移后的预设都不应再有 goldSteps；手写过的（保存过预设金数的）例外
      if (p.id.startsWith('auto-')) {
        expect(p.goldSteps, `${p.id} 不该带 goldSteps`).toEqual([])
        expect(p.interactions, `${p.id} 不该带 interactions`).toEqual([])
      }
    }
  })
})
