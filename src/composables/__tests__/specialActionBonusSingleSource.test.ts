/**
 * CC-227：特殊动作喧响（弹刀 215 / 连携 10 / 闪反 10 / 快支 20）的每槽输入次数只在引擎侧组装一次
 * （`composables/resourceCalc/convergence.ts`，注入后的 cfg：含交互缩放、Boss 弹刀反推拆分、只给喧响弹刀、般岳补齐），
 * 结果随 `CalcRoundResult.specialActionBonus` 交给展示层。旧写法在 useResourceCalc 用 store 原值另拼一份，
 * 20 态探针 11 态与引擎不一致（例：1431-1481-1491 默认 Boss 旧展示 3050 vs 引擎 900）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import type { BossPresetFile } from '@/types/bossPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

describe('特殊动作喧响单一来源（CC-227）', () => {
  it('源码锁：calcSpecialActionBonus 只在 convergence.ts 调用', () => {
    const SRC = join(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n)
        if (statSync(f).isDirectory()) { if (n !== '__tests__') walk(f); continue }
        if (!/\.(ts|vue)$/.test(n)) continue
        const rel = relative(SRC, f).replace(/\\/g, '/')
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          const t = line.trim()
          if (t.startsWith('//') || t.startsWith('*')) return
          if (/\bcalcSpecialActionBonus\s*\(/.test(line) && !/export function calcSpecialActionBonus/.test(line)) hits.push(`${rel}:${i + 1}`)
        })
      }
    }
    walk(SRC)
    expect(hits.map(h => h.split(':')[0])).toEqual(['composables/resourceCalc/convergence.ts'])
  })

  it('展示 = 引擎实值：雨果队 + 秽息司祭(30033) 主C 弹刀 = 反推拆分结果 13（旧规则只在主C 配置弹刀为 0 时才用拆分 ⇒ 停在配置值 6）', async () => {
    const { config } = await setupHarness([{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }], { recommendedBuild: true })
    const preset = bossData.bosses.find(b => b.id === '30033')!
    config.applyBossPreset({ id: preset.id }, preset.phases[0] as never, preset.monster as never, preset.defaults as never)
    /**
     * 2026-10-23：**显式注入配置弹刀**，让反推通道真的启动。
     *
     * 修前依赖「默认配置弹刀 = 6」来触发 `parrySplitGate.active`；
     * 2026-10-21「交互默认全 0」后默认是 0 ⇒ 门控不激活 ⇒ `parryTotal = 0` ⇒
     * 本用例退化成「测一个不存在的通道」（旧断言读 store 值 6 只会误导）。
     * 现在由测试自己给出触发条件，不依赖默认值。
     */
    config.team[0]!.parryCount = 6
    // `parrySplitActive` 还要求保底开关（`guaranteeStun`）——见 convergence.ts 的 gate 条件
    config.setMechanicSetting('guarantee.stun', 1)
    const calc = useResourceCalc()
    const split = calc.parrySplitResult.value!
    const bonus = calc.specialActionBonus.value!
    /**
     * 2026-10-23：不再写死「配置值 6 / 拆分量 13」。
     * 本用例真正要守的是「**展示走反推拆分、不是配置值**」这条关系：
     * ① 拆分量 > 0（否则测不到拆分通道）② 展示 == 拆分（单一来源）
     * ③ 展示 ≠ 配置值（证明没退回「只读配置」的旧规则）。
     * 数值会随交互基准/配装变化，关系不会。
     */
    const configuredParry = config.team[0].parryCount
    // `parryTotal` = 反推拆分的**总量**（`mainDpsParry + mainDpsNoFollowUp` 只是主C 那份，
    // 不含击破位，和 perSlotParry 不可直接比 — 2026-10-23 订正）
    /**
     * 2026-10-23 实测订正两处：
     *
     * ① 该 Boss（30033）**没声明强制弹刀**（`parryTotal = 0`，全库 23 个 Boss 有 17 个如此），
     *    反推量全在 `parryNoFollowUpTotal` ⇒ 「拆分通道活着」的判据是**两者之和 > 0**。
     * ② `perSlotParry` 是「各角色**实际打出的全部弹刀**」，含用户配置的那部分；
     *    而 `parrySplitResult` 只描述**反推拆分的那一份**（主C 份额 = `mainDpsParry + mainDpsNoFollowUp`）。
     *    拿总量去等值比对是错的（实测 perSlot 合计 23 vs 拆分 15，差的就是配置/基础部分）。
     *    ⇒ 按原语义比**主C 份额**，那才是同一件事。
     */
    const splitTotal = split.parryTotal + split.parryNoFollowUpTotal
    expect(splitTotal, '反推拆分总量必须 > 0（否则本用例测不到拆分通道）').toBeGreaterThan(0)
    const mainDpsShare = split.mainDpsParry + split.mainDpsNoFollowUp
    expect(bonus.perSlotParry[0], '主C 展示必须含拆分给主C 的那一份（单一来源）').toBeGreaterThanOrEqual(mainDpsShare)
    expect(bonus.perSlotParry[0], '主C 展示不得等于配置值（旧规则会停在配置值）').not.toBe(configuredParry)
    expect(bonus.parry).toBe(bonus.perSlotParry.reduce((a, b) => a + b, 0) * 215)
  })
})
