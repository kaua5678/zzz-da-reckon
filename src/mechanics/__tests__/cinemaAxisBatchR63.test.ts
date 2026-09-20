/**
 * R63 batchA —— **「模块/通用规则写同一字段」双写者普查**的判据（§R62-J1）。
 *
 * 背景：R62 命中 1111 安东影画3/5「技能等级双计」——**两个写者写同一个 `panel.*` 字段**，
 * 且没有测试能分辨。§R62-J1 的前提假设 = **除 `skillLevelBonus` 外还有别的存量**。
 * 本文件是那个普查的**行为层判据**（静态「谁写谁」扫描在本仓既漏报又假阳，R59/R61/R62 三任同向）。
 *
 * ★ 普查面 = `panelPhases.ts#computePanelPhases` 通用块写的**全部** 8 个字段
 *   （`skillLevelBonus` / 4 个元素异常时长 / `infectionZoneBonus` / `energyRegenOutOfCombat` /
 *   `additionalAbilityActive`），逐个查「模块 `applyPanel` 或 spec 的 buff 通道是否也写它」。
 *
 * ★★ 命中（R63 batchA）：**4 个元素异常时长字段的通用规则侧用 `=` 无条件覆写** ⇒
 *   把 `calcPanel` 的 buff 通道刚写进去的值**静默清零**。现存一例：
 *   `1501` 爱芮额外能力 `aire_extra_erosion_duration` → `etherAnomalyDurationBonusSeconds` +3。
 *   实测（真管线）：`calcPanel` 前 `in.etherAnomalyDurationBonusSeconds=3`
 *   → `computePanelPhases` 后 **`0`**。
 *
 * 判定口径（沿用 R58~R62 模板，**两侧都钉外部事实**）：
 *   ① **原文层**：从 `data/raw/nanoka_missing/full/<id>.json` 逐字解析「[元素异常]效果的持续时间
 *      提升 N 秒」——**期望值钉在 raw 文本上**，不读被测模块的任何导出常量（R61 最贵教训）。
 *   ② **行为层**：真 `setupHarness` → 真 `computePanelPhases()` / 真 `useResourceCalc()`，
 *      读**面板通道量**（R57：通道被钳时端到端恒绿）；每点独立 `setupHarness`。
 *   ③ **对抗性反锁**：断言「加法 ≠ 覆写」——把同一 buff 的覆盖率推到 3 个档位，
 *      覆写实现下读数**恒为 0**（与「未接入」同形），加法实现下**线性**。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { getTeamAnomalyDurationBonus } from '@/composables/resourceCalc/anomalyPanels'
import { getAnomalyDuration } from '@/core/anomalyPool/helpers'

const F = (p: unknown, k: string): number => Number((p as Record<string, unknown>)?.[k] ?? 0)

/**
 * ① 原文层：从 raw 逐字解析「[<元素异常名>]…持续时间提升 N 秒」。
 * ⚠ 期望值**不取自被测对象**（R61）——raw 是外部事实。
 */
function rawDurationBonus(id: string, anomalyName: string): number {
  const raw = readFileSync(
    new URL(`../../../data/raw/nanoka_missing/full/${id}.json`, import.meta.url), 'utf8')
  const text = raw.replace(/<[^>]+>/g, '')
  const re = new RegExp(`\\[${anomalyName}\\][^。]{0,60}?持续时间提升(\\d+(?:\\.\\d+)?)秒`)
  const m = text.match(re)
  if (!m) throw new Error(`raw ${id} 未解析出「[${anomalyName}]…持续时间提升N秒」`)
  return Number(m[1])
}

/** 读某槽位 inCombat 面板的元素时长通道量（真管线） */
async function readDuration(
  team: Array<{ agentId: string } | ''>,
  slot: number,
  key: string,
): Promise<number> {
  await setupHarness(team)
  const p = computePanelPhases(slot, useConfigStore(), useCatalogStore())
  return F(p?.inCombat, key)
}

describe('R63 batchA · 元素异常时长「双写者」判据（通用规则不得覆写 buff 通道）', () => {
  /**
   * ★★ 核心判据：爱芮(1501) 额外能力的以太侵蚀 +3s **必须真的进面板通道**。
   *
   * 修复前：`computePanelPhases` 的 `panel.etherAnomalyDurationBonusSeconds = …` 是**赋值**
   * ⇒ 把 `calcPanel` buff 通道写的 3 覆写成 0 ⇒ 读数恒 0（与「未接入」同形）。
   */
  it('1501 额外能力：raw 声明侵蚀 +3s ⇒ 面板 ether 时长通道量 +3（不得被通用规则覆写为 0）', async () => {
    // ① 原文层：期望值钉 raw
    const want = rawDurationBonus('1501', '侵蚀')
    expect(want, `raw 1501 声明 +3s，实到 ${want}`).toBe(3)

    // ② 行为层：1501 在队（额外能力需 [击破]/[支援]/同阵营/其他[异常] ⇒ 队友取 1561 异常）
    const got = await readDuration(
      [{ agentId: '1561' }, { agentId: '1501' }, ''],
      0, 'etherAnomalyDurationBonusSeconds')
    expect(got, `1561 面板的 ether 时长通道量应为 raw 的 +3，实到 ${got}`).toBe(want)

    // ③ 端到端下游：侵蚀异常时长 T = 基准 10s + 3s = 13s
    //    （`getAnomalyDuration` 是该通道的**唯一**消费者口径：覆盖率/紊乱/乱流都读它）
    await setupHarness([{ agentId: '1561' }, { agentId: '1501' }, ''])
    const panel = computePanelPhases(0, useConfigStore(), useCatalogStore())!.inCombat
    expect(getAnomalyDuration(panel, 'ether'), '侵蚀 T 应为 10(基准) + 3(raw) = 13').toBe(13)
  })

  /**
   * ★ 对抗性反锁：把覆盖率滑块推到 3 个档位。
   * **覆写实现**下三条读数**恒等**（都是 0）；**加法实现**下线性 ⇒ 本断言能分辨两种实现。
   */
  it('1501 覆盖率滑块线性：0 / 50 / 100 ⇒ 通道量 0 / 1.5 / 3（覆写实现恒 0，分辨得出）', async () => {
    const seen: number[] = []
    for (const cov of [0, 50, 100]) {
      await setupHarness([{ agentId: '1561' }, { agentId: '1501' }, ''])
      const cfg = useConfigStore()
      cfg.setTeammateBuffCoverage('aire_extra_erosion_duration', cov)
      const p = computePanelPhases(0, cfg, useCatalogStore())
      seen.push(F(p?.inCombat, 'etherAnomalyDurationBonusSeconds'))
    }
    expect(seen, `覆盖率 0/50/100 应线性 0/1.5/3，实到 ${JSON.stringify(seen)}`).toEqual([0, 1.5, 3])
  })

  /**
   * ★ 正交三臂回归（R58：档位表类必须正交实验）：1171/1211/1261 三臂走**通用规则**
   * `getTeamAnomalyDurationBonus`，与 1501 的 **buff 通道**是两条不同的写者。
   * 期望值同样钉 raw 原文。
   */
  it('正交回归：火(1171)+3 / 电(1211 需门控)+3 / 物理(1261)+5 —— 全部钉 raw 原文', async () => {
    // 1211 电臂的额外能力需「同属性/同阵营队友」⇒ 第三槽放 1181（电·异常）满足门控（R61：分诊队友要满足门控条件）
    const arms: Array<[string, string, string, Array<{ agentId: string } | ''>]> = [
      ['1171', '灼烧', 'fireAnomalyDurationBonusSeconds',
        [{ agentId: '1561' }, { agentId: '1171' }, '']],
      ['1211', '感电', 'electricAnomalyDurationBonusSeconds',
        [{ agentId: '1561' }, { agentId: '1211' }, { agentId: '1181' }]],
      ['1261', '畏缩', 'physicalAnomalyDurationBonusSeconds',
        [{ agentId: '1561' }, { agentId: '1261' }, '']],
    ]
    for (const [id, anomaly, key, team] of arms) {
      const want = rawDurationBonus(id, anomaly)
      // 期望值不许硬编码在被测对象里：raw 声明的 N 就是断言值
      const got = await readDuration(team, 0, key)
      expect(got, `${id} ${key}：raw 声明 +${want}s，实到 ${got}`).toBe(want)
    }
  })

  /**
   * ★ 负控（防橡皮图章）：**1501 不在队**时该通道必须为 0 —— 证明上一条不是「恒真」。
   */
  it('负控：1501 不在队 ⇒ ether 时长通道量 0（同一读数能分辨在场/不在场）', async () => {
    const got = await readDuration(
      [{ agentId: '1561' }, { agentId: '1591' }, ''],
      0, 'etherAnomalyDurationBonusSeconds')
    expect(got, `1501 不在队时应为 0，实到 ${got}`).toBe(0)
  })

  /**
   * ★ 死臂反锁：`getTeamAnomalyDurationBonus(·,'ether')` **必须**恒 0 ——
   * 以太臂曾写作陈旧别名 `'aria'`（全库零命中）。若有人把它「修好」成 `'1501'`
   * 而没删 spec 那条，就会**双计**（通用规则 +3 **加上** buff 通道 +3 = 6）。
   * 本断言把「唯一写者 = spec teamBuff」这个不变量钉死。
   */
  it('死臂反锁：以太臂不得同时存在于通用规则与 spec（否则双计 6s）', async () => {
    await setupHarness([{ agentId: '1561' }, { agentId: '1501' }, ''])
    const cfg = useConfigStore()
    const cat = useCatalogStore()
    expect(getTeamAnomalyDurationBonus(cfg, cat, 'ether'),
      '以太时长若走通用规则，会与 spec teamBuff 双计').toBe(0)
    // 且三臂之外的元素（冰/风/以太）通用规则侧一律 0（无该臂）
    for (const el of ['ice', 'wind', 'ether']) {
      expect(getTeamAnomalyDurationBonus(cfg, cat, el), `${el} 无通用规则臂`).toBe(0)
    }
  })
})
