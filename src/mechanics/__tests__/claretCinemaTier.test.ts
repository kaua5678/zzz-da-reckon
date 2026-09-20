/**
 * 克拉蕾(1611) 影画分档 —— **影画1/影画2 效果门槛 + 电抗值**（R55 结清 §R54-J1）。
 *
 * ## 缺陷（R54 外部复核发现、刻意未修；R55 单独立项修复）
 *
 * 旧实现把两档**完全互换**，且电抗值是过期值：
 * | | 原文（raw `talent.1/2.desc`） | 旧实现 | 判定 |
 * |---|---|---|---|
 * | **C1** 淋漓古志 | 残痕积蓄效率 +20%；[毁伤] 倍率 → 130% | 门控 `>= 2` | **错**（应在 C1） |
 * | **C2** 薪火荣冠 | 猩红铭刻最大持续 **+2秒**；无视 **18%** 电抗 | 门控 `>= 1` 且常量 = **16** | **错**（应在 C2，且 16→18） |
 * ⇒ 后果：**C1 玩家少拿、C2 玩家多拿**。
 *
 * ## 根因（外部侦察实测，本仓 git 历史自证）
 *
 * `ad227de` 把 **3.2.4+18409985 测试服**文案原样入库（测试服里 C1/C2 就是反的、电抗 = 16%、
 * 铭刻 +3秒）；`d056e11`（v12 重录）**只刷新了 desc 文本**（16→18、+3s→+2s）而**机制实现没跟着重排**。
 * ⇒ 普适教训：**raw 文案更新 ≠ 机制重排**（测试服→正式服的 kit 重排必须在实现层逐条对账）。
 *
 * ## 本文件的判据设计（为什么不是同义反复）
 *
 * 硬约束「跨路径恒等式先查同义反复：两边同读一个常量 ⇒ 它不是判据」。故本文件分两层：
 * ① **常量层钉在原文**：直接读 `data/raw/nanoka_missing/full/1611.json` 的 `talent.1/2.desc`
 *    断言关键子句（「积蓄效率提升20%」/「130%」/「延长2秒」/「18%」）**存在**，
 *    再断言实现常量与之**数值相等** ⇒ 原文改了本测试必红，不是两边同读一个常量。
 * ② **行为层走真管线**：`setupHarness` 真队伍 → 真 `useResourceCalc()`，三档 C0/C1/C2
 *    逐档断言**可分辨的量**（电抗削减 / 积蓄倍率 / 毁伤倍率 / 单窗时长），
 *    **每点独立 `setupHarness`**（硬约束：不复用响应式快照）。
 *
 * ⚠ 本条**替换**了旧的代理判据 `claretSmoke.test.ts::影画1 电抗无视 16% 确实抬高结果`
 *   （`toBeGreaterThan(0)`）：那条只证明「有变化」，门槛互换后**照样绿** —— R51/R52 各踩过一次的陷阱。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  C1_MAIM_MULT,
  C2_INSCRIPTION_WINDOW_BONUS_SECONDS,
  C2_RES_IGNORE,
  DEFAULT_INSCRIPTION_WINDOW_SECONDS,
  GASH_EFF_C1,
  GASH_EFF_CORE,
} from '@/mechanics/agents/claret'

/** 真管线单档探针：**每次调用都独立 setupHarness**（不许复用 calc 快照）。 */
async function probe(cinemaLevel: number) {
  await setupHarness([{ agentId: '1611', cinemaLevel }, '', ''])
  const calc = useResourceCalc()
  // R52 坑①：必须在设滑块/建队 + await setTimeout(0) **之后**读 resourceResult.value
  await new Promise(r => setTimeout(r, 0))
  const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
  const src = ch.claretSharpResourceSource!
  const maim = ch.executions.find(e => e.moveId === '1611013' && (e.damageMultiplierOverride ?? false))
  return {
    resIgnore: (calc.panels.value[0] as { enemyElectricResReduction?: number })?.enemyElectricResReduction ?? 0,
    buildup: src.gashBuildupMultiplier,
    maimMultiplier: maim?.damageMultiplier ?? 0,
    windowSecondsPerEntry: src.inscriptionWindowSecondsPerEntry,
    inscriptionTime: src.inscriptionBasicTime,
    damage: calc.teamTotalDamage.value,
  }
}

describe('R55 · 克拉蕾影画分档（C1 = 积蓄+毁伤 / C2 = 铭刻+2s + 18%电抗）', () => {
  it('① 常量层钉在原文：raw talent.1/2.desc 含关键子句，且实现常量与之相等（原文改了必红）', async () => {
    const { readFileSync } = await import('node:fs')
    const raw = JSON.parse(readFileSync(
      new URL('../../../data/raw/nanoka_missing/full/1611.json', import.meta.url), 'utf8',
    ))
    const c1: string = raw.talent['1'].desc
    const c2: string = raw.talent['2'].desc

    // ── C1 淋漓古志：积蓄 +20% + 毁伤倍率 → 130% ──
    expect(c1).toContain('残痕积蓄效率提升20%')
    expect(c1).toContain('130%')
    expect(c1).not.toContain('电属性伤害抗性') // 反锁：C1 **不**给电抗
    expect(GASH_EFF_C1).toBe(20) // 原文「20%」
    expect(C1_MAIM_MULT).toBeCloseTo(130 / 100, 10) // 原文「原本的130%」

    // ── C2 薪火荣冠：铭刻 +2秒 + 无视 18% 电抗 ──
    expect(c2).toContain('[猩红铭刻]最大持续时间延长2秒')
    expect(c2).toContain('18%')
    expect(c2).not.toContain('积蓄效率') // 反锁：C2 **不**给积蓄
    expect(C2_RES_IGNORE).toBe(18) // 原文「18%」（旧实现 16 是 3.2.4 测试服过期值）
    expect(C2_INSCRIPTION_WINDOW_BONUS_SECONDS).toBe(2) // 原文「延长2秒」（旧注释错写 +3s）

    // 反锁：旧实现的 16 已不存在于任何现行源（外部 6 语言 × 4 版本 + gachabase 全为 18）
    expect(C2_RES_IGNORE).not.toBe(16)
  })

  it('② 行为层真管线三档：电抗只 C2 给（=18）、积蓄只 C1 起给、毁伤 ×130% 只 C1 起给', async () => {
    const c0 = await probe(0)
    const c1 = await probe(1)
    const c2 = await probe(2)

    // 电抗无视：C0/C1 = 0，C2 = 18 —— **门槛两侧**各断言一次（旧实现是 C1 给 16）
    expect(c0.resIgnore).toBe(0)
    expect(c1.resIgnore).toBe(0)
    expect(c2.resIgnore).toBe(C2_RES_IGNORE)

    // 积蓄效率：C0 无、C1 起 +20%（命座**累进** ⇒ C2 含 C1 的加成）
    expect(c0.buildup).toBeCloseTo(1 + GASH_EFF_CORE / 100, 5)
    expect(c1.buildup).toBeCloseTo(1 + GASH_EFF_CORE / 100 + GASH_EFF_C1 / 100, 5)
    expect(c2.buildup).toBeCloseTo(c1.buildup, 5)

    // 毁伤倍率：override 行恒在（C0 = 表值），C1 起 ×1.3
    expect(c0.maimMultiplier).toBeCloseTo(1625.6, 1)
    expect(c1.maimMultiplier).toBeCloseTo(1625.6 * C1_MAIM_MULT, 1)
    expect(c2.maimMultiplier).toBeCloseTo(c1.maimMultiplier, 1)

    // 端到端：C1/C2 都严格高于 C0
    expect(c0.damage).toBeGreaterThan(0)
    expect(c1.damage).toBeGreaterThan(c0.damage)
    expect(c2.damage).toBeGreaterThan(c0.damage)
  })

  it('③ 影画2 铭刻窗口 +2s：单窗 16s → 18s，且真的进两态时间解（C1 不动）', async () => {
    const c0 = await probe(0)
    const c1 = await probe(1)
    const c2 = await probe(2)

    // 单窗时长：raw 基础 16s；**影画2 起** 18s（C0/C1 都是 16 —— 门槛两侧）
    expect(c0.windowSecondsPerEntry).toBe(DEFAULT_INSCRIPTION_WINDOW_SECONDS)
    expect(c1.windowSecondsPerEntry).toBe(DEFAULT_INSCRIPTION_WINDOW_SECONDS)
    expect(c2.windowSecondsPerEntry).toBe(DEFAULT_INSCRIPTION_WINDOW_SECONDS + C2_INSCRIPTION_WINDOW_BONUS_SECONDS)
    expect(c2.windowSecondsPerEntry).toBe(18)

    // 真的进时间解：窗口变长 ⇒ 铭刻总时间不减少（单调），且 C1 与 C0 同口径
    expect(c2.inscriptionTime).toBeGreaterThanOrEqual(c1.inscriptionTime)
    expect(c1.inscriptionTime).toBeCloseTo(c0.inscriptionTime, 6)
  })
})
