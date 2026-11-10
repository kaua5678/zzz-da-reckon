/**
 * 挽昼（1601）烬痕的**第二条来源**：全队[毁伤]按该次实际伤害 **35%** 也积攒[烬痕]
 * （3.4.3+20278274 核心被动；影画2 整体 ×1.2 ⇒ 42%）。
 *
 * 2026-11-10 之前只算**自己**那份（队友那份没有跨槽通道）；本批补：队友锋御的[毁伤]累计倍率
 * 经 `ModuleFeedback.sunbringerTeamMaimMultiplier` 跨轮送到 converge，写进
 * `cfg.sunbringerTeammateMaimMultiplier`，由 `computeEmberScar` 按同一 35% 计入。
 *
 * ⚠ 已知近似（debt，写在这里防遗忘）：跨槽读的是**倍率口径**（毁伤行 count × damageMultiplier），
 * 没有按两槽面板比折算成实际伤害 —— 与挽昼自己那份（maimCount × 毁伤表值）是同一个空间。
 * 升级路径见 `gashMaim#collectTeamMaimMultiplier` 头注释。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { collectTeamMaimMultiplier } from '@/mechanics/gashMaim'
import { computeEmberScar, EMBER_SCAR_MAIM_RATE } from '@/mechanics/agents/sunbringer'

const maimRow = (count: number, mult: number) => ({
  moveName: '毁伤（每消耗 1 层残痕触发 1 次）',
  count,
  damageMultiplier: mult,
})

const meta = {
  basic: { damagePerSec: 0, gashPerSec: 0, sharpPerSec: 0 },
  ex: { moveId: '1601106', actionTime: 2.5, damage: 0, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  jufeng: { moveId: '1601015', actionTime: 1.367, damage: 1722.5, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  changan: { moveId: '1601107', actionTime: 3.7, damage: 2690.6, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  torch: { moveId: '1601007', actionTime: 3.667, damage: 2441.1, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  ultA: { moveId: '1601111', actionTime: 2.883, damage: 3900.1, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  ultB: { moveId: '1601011', actionTime: 4.083, damage: 2827, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  maim: { moveId: '1601114', actionTime: 0, damage: 336.3, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  chain: { moveId: '1601110', actionTime: 2.466, damage: 0, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  sharpnessRegen: 1.5,
} as const

describe('1601 烬痕：全队[毁伤] 35% 那条来源（跨槽，2026-11-10）', () => {
  it('① 收集器：按行名认[毁伤]、排除自己槽、忽略非毁伤行', () => {
    const characters = [
      { slot: 0, executions: [maimRow(3, 336.3)] },
      {
        slot: 1,
        executions: [
          maimRow(2, 1625.6 * 1.3),
          { moveName: '普通攻击：执旌', count: 5, damageMultiplier: 100 },
        ],
      },
    ]
    // 挽昼视角：只拿队友（槽1）那份，且只认毁伤行
    expect(collectTeamMaimMultiplier(characters, 0)).toBeCloseTo(2 * 1625.6 * 1.3, 6)
    // 反向：槽1 视角拿槽0
    expect(collectTeamMaimMultiplier(characters, 1)).toBeCloseTo(3 * 336.3, 6)
    // 负控：队里只有自己 ⇒ 0（单锋御逐位不变）
    expect(collectTeamMaimMultiplier([characters[0]!], 0)).toBe(0)
    // 负控：没有 executions 字段 / 空行 ⇒ 0，不抛
    expect(collectTeamMaimMultiplier([{ slot: 1 }, { slot: 2, executions: [] }], 0)).toBe(0)
  })

  it('② computeEmberScar：队友那份按同一 35% 计入，0/缺省时与接线前逐位相同', () => {
    const loops = { jufengCount: 2, changanCount: 2, torchCount: 1, ultACount: 1, maimCount: 4 }
    const base = { meta: meta as never, loops, ultBCount: 1, cinemaLevel: 0 }
    const own = computeEmberScar(base)
    // 35% 一档：+0.35 × 队友倍率
    const withMate = computeEmberScar({ ...base, teammateMaimMultiplier: 1000 })
    expect(withMate - own).toBeCloseTo(1000 * EMBER_SCAR_MAIM_RATE, 6)
    // 负控：0 = 缺省 = 接线前
    expect(computeEmberScar({ ...base, teammateMaimMultiplier: 0 })).toBeCloseTo(own, 9)
    // 影画2 整体 ×1.2 对这条也生效（三条来源一视同仁）
    const c2own = computeEmberScar({ ...base, cinemaLevel: 2 })
    const c2mate = computeEmberScar({ ...base, cinemaLevel: 2, teammateMaimMultiplier: 1000 })
    expect(c2mate - c2own).toBeCloseTo(1000 * EMBER_SCAR_MAIM_RATE * 1.2, 6)
  })

  it('③ 真管线：队里有第二个锋御 ⇒ 烬痕读数比单锋御队大（跨轮通道真的通了）', async () => {
    const emberOf = async (team: { agentId: string }[]) => {
      const { config } = await setupHarness(team)
      config.setActionCount(0, 'parryCount', 6)
      const calc = useResourceCalc()
      const slot0 = calc.resourceResult.value!.characters.find(c => c.slot === 0)!
      // ⚠ 判据不能用行名里的「烬痕消除 +N%」：patch 打完 override 之后，enrich 还会按倍率表
      // 回填 moveName（override 只保倍率）。所以读**倍率本身**：二段行的 damageMultiplier 比表值大出的
      // 那部分就是摊进来的烬痕。
      const row = (slot0.executions ?? []).find(e => String(e.moveId) === '1601011')
      return Number(row?.damageMultiplier ?? 0) - 2827
    }
    const solo = await emberOf([{ agentId: '1601' }])
    const withClaret = await emberOf([{ agentId: '1601' }, { agentId: '1611' }, { agentId: '1661' }])
    expect(solo, '单锋御：烬痕只有自己的来源').toBeGreaterThan(0)
    expect(withClaret, '双锋御：队友毁伤也进烬痕').toBeGreaterThan(solo)
  }, 180000)
})
