import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getRegisteredMechanicSettings } from '@/mechanics'

/**
 * spec `adjustable`（判据 4 的 **Form-E**）生效测试。
 *
 * ## 为什么单独一个文件（2026-09-20 round 49）
 *
 * 这些 id 形如 `<四位数>.<resource>.<rule>.rate`，**声明在 `src/specs/agents/*.json` 里**，
 * 经 `registry.ts:27-34` 的 spec 合并注入 `settingDefaults`，值由 `specs/resources.ts:150` 的
 * `setting:${adjustable.id}` **按构造消费**。R48 分诊实测：判据 4 的旧扫描面（`agents/*.ts` 的
 * `settings: [` 正则）**结构性看不见它们**（id 根本不在 .ts 里）⇒ 这 39 条此前**零可问责性**。
 *
 * R49 把判据 4 的扫描面接上运行时注册表后，它们逐条具名进 `SETTINGS_UNTESTED_BACKLOG`。
 * 本文件是同批「补生效测试」的第一批：**一条表驱动测试覆盖 16 条**（其余留在清单里，见下方口径）。
 *
 * ## 口径（三条，别放宽）
 *
 * ① **必须走真管线**：`setupHarness` 装配真队伍 → `config.setMechanicSetting(id, v)` →
 *    真 `useResourceCalc()` 的 `resourceResult`。**不许**直调 `computeSpecResources` 并手写 cfg ——
 *    R48 实测过手写 cfg 的代价：它会把「生产代码写不写这个字段」这个自由度整个抹掉，
 *    让断链「通过」（`anbyC2StunCoverage` 曾因此掩盖恒等 0.5 的真缺陷）。
 * ② **断言强度 = 比例性**，不只是「有 delta」：`rate=0 ⇒ 该 gain 恒 0`、`rate=1 ⇒ 基准值`、
 *    `rate=2 ⇒ 恰好 2×基准`（`apps/resources.ts:152` 的钳制区间是 `[min,max]`，此处 max=2 未钳）。
 * ③ **只收实测可证的**：下面 16 条是本任在真管线上逐条实测「0 / 1 / 2 三点线性」的；
 *    其余 Form-E id 要么 countSource 靠默认队伍没触发的量（`perfectBlockCount` / `parryCount`
 *    在特定队伍下才非 0），要么被模块的 `buildResourceResult` 覆盖（**另案**，见
 *    `.claude/OPEN-ITEMS.md` §R49-J1 的 jufufu 覆盖导致滑块失效）⇒ **不在这里假装覆盖**。
 */

/** 表：[settingId, 资源 id, gain 键, rate=1 时的基准获取量] */
const CASES: Array<[string, string, string, number]> = [
  ['1011.anby_charge.anby_ex_charge_gain.rate', 'anby_charge', 'anby_ex_charge_gain', 72],
  ['1041.soldier11_charge.soldier11_ex_charge_gain.rate', 'soldier11_charge', 'soldier11_ex_charge_gain', 48],
  ['1041.soldier11_charge.soldier11_ult_charge_gain.rate', 'soldier11_charge', 'soldier11_ult_charge_gain', 24],
  ['1351.pulchra_hunt_step.pulchra_assist_hunt_gain.rate', 'pulchra_hunt_step', 'pulchra_assist_hunt_gain', 5],
  ['1351.pulchra_hunt_step.pulchra_ex_hunt_gain.rate', 'pulchra_hunt_step', 'pulchra_ex_hunt_gain', 9],
  ['1441.zhendou_heartfire.zhendou_parry_heartfire_gain.rate', 'zhendou_heartfire', 'zhendou_parry_heartfire_gain', 600],
  ['1441.zhendou_remnant_flame.zhendou_chain_remnant_gain.rate', 'zhendou_remnant_flame', 'zhendou_chain_remnant_gain', 12],
  ['1441.zhendou_remnant_flame.zhendou_ult_remnant_gain.rate', 'zhendou_remnant_flame', 'zhendou_ult_remnant_gain', 24],
  ['1521.xixifu_toxin.toxin_tuxin_stage4.rate', 'xixifu_toxin', 'toxin_tuxin_stage4', 20],
  ['1531.billy_radiant_star.billy_radiant_basic4_gain.rate', 'billy_radiant_star', 'billy_radiant_basic4_gain', 1],
  ['1531.billy_radiant_star.billy_radiant_ex_gain.rate', 'billy_radiant_star', 'billy_radiant_ex_gain', 21],
  ['1531.billy_star_glow.billy_star_basic4_gain.rate', 'billy_star_glow', 'billy_star_basic4_gain', 1],
  ['1531.billy_star_glow.billy_star_ex_gain.rate', 'billy_star_glow', 'billy_star_ex_gain', 21],
  ['1531.billy_star_glow.billy_star_ultimate_gain.rate', 'billy_star_glow', 'billy_star_ultimate_gain', 3],
  ['1551.peiluo_prominence.peiluo_frontline_gain.rate', 'peiluo_prominence', 'peiluo_frontline_gain', 60],
  ['1551.peiluo_prominence.peiluo_upper_ult_gain.rate', 'peiluo_prominence', 'peiluo_upper_ult_gain', 180],
]

/** 队伍夹具：主角 + 两个固定队友（同属性以触发出战条件；数值只依赖本槽 cfg 与 state） */
const ALLY: Record<string, [string, string]> = {
  '1011': ['1381', '1211'],
  '1091': ['1251', '1171'],
  '1531': ['1041', '1281'],
  '1041': ['1531', '1281'],
}

/** 让 countSource 类的量表非 0（`parryCount` / `chainCountTotal` / `blockCount` 等） */
const RICH = { cinemaLevel: 6, parryCount: 8, dodgeCounterCount: 12, quickAssistCount: 4, chainCountPerStun: 2, blockCount: 4 }

describe('spec adjustable（Form-E）经真管线生效：rate 0 / 1 / 2 三点线性', () => {
  it('16 条 adjustable 全部：rate=0 ⇒ 0，rate=1 ⇒ 基准，rate=2 ⇒ 恰好 2×基准', async () => {
    // 前提断言（防「夹具失效导致恒 0 假绿」）：这些 id 必须真的在运行时注册表里
    const registered = new Set(getRegisteredMechanicSettings().map(s => s.id))
    for (const [id] of CASES) {
      expect(registered.has(id), `${id} 不在运行时注册表里 ⇒ 本表口径过期`).toBe(true)
    }

    const failures: string[] = []
    for (const [id, resKey, gainKey, base] of CASES) {
      const agentId = id.slice(0, 4)
      const [a1, a2] = ALLY[agentId] ?? ['1011', '1211']
      const { config } = await setupHarness([
        { agentId, ...RICH },
        { agentId: a1, cinemaLevel: 6 },
        { agentId: a2, cinemaLevel: 6 },
      ] as never)
      for (const buff of config.globalBuffs) buff.enabled = false
      const calc = useResourceCalc()
      const readGain = async (rate: number) => {
        config.setMechanicSetting(id, rate)
        await new Promise(r => setTimeout(r, 0))
        const char = calc.resourceResult.value?.characters?.find(c => c.agentId === agentId) as
          { specResources?: Record<string, { gains?: Record<string, number> }> } | undefined
        return char?.specResources?.[resKey]?.gains?.[gainKey]
      }

      const r0 = await readGain(0)
      const r1 = await readGain(1)
      const r2 = await readGain(2)
      // rate=0 ⇒ 该 gain 分量必须归零（**这是「滑块真的接线」的核心断言**：
      // 若消费侧读的是另一个字段名 ⇒ 恒走 `?? default` ⇒ 这里必然非 0）
      if (r0 !== 0) failures.push(`${id}: rate=0 应恒 0，实到 ${r0}`)
      // rate=1 ⇒ 精确基准（钉住绝对值，防「按比例但基数错」）
      if (r1 !== base) failures.push(`${id}: rate=1 应为 ${base}，实到 ${r1}`)
      // rate=2 ⇒ 恰好两倍（证明是按比例进算式，而不是 0/1 开关或某处钳死）
      if (r2 !== 2 * base) failures.push(`${id}: rate=2 应为 ${2 * base}，实到 ${r2}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)
})
