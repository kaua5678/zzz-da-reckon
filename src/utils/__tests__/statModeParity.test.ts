/**
 * 判据 19：**全局 Buff** 的 stat 结算口径（`applyStat` 的 mode）必须单源。
 *
 * 背景（2026-09-18 round 27 实测）：本仓曾有三份**各自独立**的「这个 stat 是不是百分比」实现，
 * 全都按**字段名后缀**猜：
 *   ① `utils/statMeta.ts#isPctStat`（**展示**口径：UI 显示 % 还是绝对值）
 *   ② `composables/resourceCalc/helpers.ts#isPctStat`（① 的逐字漂移副本，全仓零引用 ⇒ 已删）
 *   ③ `core/panel.ts#inferStatMode`（**驱动盘**口径，见下方「不合并」说明）
 * 而 `STAT_META` 里**逐条声明**了每个字段的 `mode`（单一事实源），实测与名字启发式 **39 个字段结论相反**
 * （其中 **34 个 mode 敏感**：pct 与 flat 进不同累加器 ⇒ 数值不同）。
 *
 * 症状（修前实测，真引擎路径 `computePanelPhases`）：
 *   - 全局 Buff `anomalyMastery = 30` ⇒ 引擎算 `148 × 1.3 = 192.4`（当成 pct），
 *     而 `TeamConfigPage` 预览按 flat 显示 `+30` ⇒ **同一份配置两个面板**；
 *   - 全局 Buff `energyRegen = 0.5` ⇒ 实算进 `energyRegenBonusPct`（×1.5）而不是 `BonusFlat`（+0.5）。
 *
 * ⚠ **驱动盘通路不适用本判据**（别把两者合并）：驱动盘数值语义由 catalog 外部数据
 * `statRules.statDisplay[k].display` 决定（`percent` = 按基础值百分比 / `number`、`integer` = 固定值加点），
 * 与 `STAT_META.mode` **不同义**。实测反例：`energyRegen` 的 `display = "percent"`（6 号位 = +60% 回能）
 * 而 `STAT_META.energyRegen.mode = 'flat'`（描述基础回能字段本身 = 1.2 点/秒）⇒ 合并会把 +60% 变成 +60/s
 * （round 27 实测踩到并回退）。该通路的「`anomalyMastery` 主词条被当 pct」缺陷另立候选，见 OPEN-ITEMS。
 *
 * 判据（每条都能被注入证伪）：
 *   ① **声明的 mode 就是结算 mode**：`statSettlementMode(v) === STAT_META.get(v).mode`（逐条）
 *   ② **驱动盘口径未被误合并**（源码级，见上）
 *   ③ **mode 敏感性非空洞**：被纠正的字段 ≥30 个，且其中 ≥30 个真算出不同面板值
 *      （防「把两边都写成 flat 就恒绿」这种装饰性一致）
 *   ④ **未登记字段回落**：`statSettlementMode` 对表外字段仍回落名字启发式
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { STAT_META, isPctStat, statSettlementMode } from '@/utils/statMeta'
import { applyTargetedStat, applyStat } from '@/core/buff'
import type { PanelValues } from '@/types/catalog'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

const BASE_CHAR = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

/** 面板字段快照比较（忽略 applyStat 的 `__xxxAccum` 内部累加器） */
function panelDiffers(a: PanelValues, b: PanelValues): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (k.startsWith('__')) continue
    if ((a as any)[k] !== (b as any)[k]) return true
  }
  return false
}

const PANEL_BASE: any = {
  hp: 1000, atk: 1000, def: 1000, impact: 100, anomalyProficiency: 100, anomalyMastery: 100,
  critRate: 5, critDmg: 50, energyRegen: 1.2, penRatio: 0,
}

describe('判据 19：stat 结算口径单一事实源（statSettlementMode）', () => {
  it('① 声明的 mode 就是结算 mode（全部已登记字段逐条）', () => {
    const wrong = STAT_META.filter(m => statSettlementMode(m.value) !== m.mode)
      .map(m => `${m.value}: declared=${m.mode} got=${statSettlementMode(m.value)}`)
    expect(wrong).toEqual([])
  })

  it('①b 已登记字段数 > 100（防「表被清空 ⇒ 判据①空转变绿」）', () => {
    expect(STAT_META.length).toBeGreaterThan(100)
  })

  it('④ 未登记字段回落名字启发式（与 getStatMeta 合成兜底同语义）', () => {
    for (const s of ['someFutureStatPct', 'someFutureStatFlat', 'totallyUnknown']) {
      expect(statSettlementMode(s)).toBe(isPctStat(s) ? 'pct' : 'flat')
    }
    expect(statSettlementMode('someFutureStatPct')).toBe('pct')
    expect(statSettlementMode('someFutureStatFlat')).toBe('flat')
  })

  it('③ mode 敏感性非空洞：被纠正的名字启发式对 ≥30 个字段结论不同，且真算出不同面板', () => {
    // 本测试内**显式复刻历史引擎启发式**（core/panel.ts 修前的 inferStatMode 逐字），
    // 用来量「单一事实源纠正了多少字段」。它只作**对照基线**，不是实现。
    const LEGACY_ENGINE_NAME_HEURISTIC = (s: string): 'pct' | 'flat' =>
      s.endsWith('Pct') || s.endsWith('Rate') || s.endsWith('Dmg')
        || s.endsWith('Ratio') || s.endsWith('Mastery') || s.endsWith('Regen')
        || s.endsWith('Impact') || s.endsWith('Efficiency') || s.endsWith('Bonus')
        ? 'pct' : 'flat'

    // 纠正面（实测 2026-09-18 round 27：39 个字段结论相反）
    const corrected = STAT_META.filter(m => LEGACY_ENGINE_NAME_HEURISTIC(m.value) !== statSettlementMode(m.value))
    expect(corrected.length).toBeGreaterThanOrEqual(30)

    // 非空洞：这些纠正里 ≥30 个真的 mode 敏感（进不同累加器 ⇒ 面板值不同）
    const sensitive = corrected.filter(m => {
      const p = { ...PANEL_BASE } as PanelValues
      const q = { ...PANEL_BASE } as PanelValues
      applyStat(p, m.value as any, 25, 'flat')
      applyStat(q, m.value as any, 25, 'pct')
      return panelDiffers(p, q)
    })
    expect(sensitive.length).toBeGreaterThanOrEqual(30)

    // 展示口径 `isPctStat` 与声明 mode **也不等价**（实测 4 条：`enemyDefFlatReduction` 后缀
    // `Reduction` 被判 pct 但声明 flat；`stunDmgMultiplierBonusAlways` / `...CapAlways` /
    // `remielleRefringeCoefficient` 声明 pct 但后缀不在其表内）。这就是「两个谓词不能合并成一个」
    // 的硬证据 —— 钉住它，防后人为了「统一」把展示面改成结算面（会翻掉 UI 显示）。
    const displayVsDeclared = STAT_META.filter(m => isPctStat(m.value) !== (m.mode === 'pct'))
      .map(m => m.value)
    expect(displayVsDeclared).toContain('enemyDefFlatReduction')
    expect(displayVsDeclared).toContain('remielleRefringeCoefficient')
    expect(displayVsDeclared.length).toBeGreaterThan(0)
  })

  it('② core/panel.ts#inferStatMode 是**驱动盘专用**口径，未与 Buff 口径合并（防误合并两个通路）', () => {
    const src = readFileSync(new URL('../../core/panel.ts', import.meta.url), 'utf8')
    // 驱动盘数值的语义由 catalog 外部数据 `statDisplay.display` 决定，与 STAT_META.mode 不同义
    // （实测：anomalyMastery display=number 而 STAT_META.mode=flat 一致；energyRegen display=percent
    //  而 STAT_META.mode=flat 描述的是「基础回能字段本身」⇒ 拿后者当驱动盘口径会把 +60% 变成 +60/s）。
    // ⇒ 本判据钉的是「**不要**把 statSettlementMode 接进 inferStatMode」，并保留对该函数的口径注解。
    expect(src).toMatch(/function inferStatMode\(stat: string\)/)
    expect(src).toMatch(/驱动盘数值的语义由 \*\*catalog 外部数据\*\*/)
    // 若有人把两个通路合并（无论哪个方向）都会命中下面这条
    expect(src).not.toMatch(/function inferStatMode\(stat: string\)[\s\S]{0,400}?statSettlementMode\(stat\)/)
  })

  it('②b 三份副本只剩一份（resourceCalc/helpers.ts 的 isPctStat 副本已删）', () => {
    const helperSrc = readFileSync(new URL('../../composables/resourceCalc/helpers.ts', import.meta.url), 'utf8')
    expect(helperSrc).not.toMatch(/export function isPctStat/)
    expect(helperSrc).not.toMatch(/endsWith\('Mastery'\)/)
    const phasesSrc = readFileSync(new URL('../../composables/resourceCalc/panelPhases.ts', import.meta.url), 'utf8')
    // panelPhases 不得再 import './helpers'（反向边已解环）
    expect(phasesSrc).not.toMatch(/from '\.\/helpers'/)
  })

  // ★ 下面这条是**反向验证逼出来的**：端到端用例若自己写死 `statSettlementMode(stat)` 当入参，
  // 它测的是「函数等于自己」，把视图改回 `isPctStat` 也照样全绿（round 27 实测 injection B 逃逸）。
  // ⇒ 必须断言**真实调用点**用的是结算口径。覆盖本仓全部「用户自由选 stat」的入口。
  it('②c 真实调用点一律用结算口径（防视图层回退到 isPctStat，端到端测不到）', () => {
    const callSites: Array<[string, RegExp, RegExp]> = [
      // [文件, 必须是结算口径的那行, 该文件里「结算位上出现展示口径」的回退形态]
      ['src/views/TeamConfigPage.vue',
        /applyTargetedStat\(panel,\s*buff\.stat,\s*buff\.value,\s*statSettlementMode\(buff\.stat\)/,
        /applyTargetedStat\([^)]*isPctStat\(/],
      ['src/views/DebugPage.vue',
        /row\('全局 Buff',\s*buff\.name,\s*buff\.stat,\s*buff\.value,\s*statSettlementMode\(buff\.stat\)/,
        /row\('全局 Buff'[^)]*isPctStat\(/],
      ['src/composables/resourceCalc/panelPhases.ts',
        /mode:\s*statSettlementMode\(b\.stat\)/,
        /mode:\s*\(?isPctStat\(/],
    ]
    for (const [rel, must, mustNot] of callSites) {
      const src = readFileSync(new URL('../../' + rel.replace(/^src\//, ''), import.meta.url), 'utf8')
      expect({ file: rel, hasSettlementMode: must.test(src) }).toEqual({ file: rel, hasSettlementMode: true })
      // 回退形态：把**展示**口径塞进**结算**位（`isPctStat` 用在别处、做显示格式化是合法的，故只锚结算位）
      expect({ file: rel, fellBackToDisplayPredicate: mustNot.test(src) })
        .toEqual({ file: rel, fellBackToDisplayPredicate: false })
    }
  })
})

describe('判据 19：全局 Buff 的预览面与引擎面必须同值（端到端）', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  async function enginePanel(stat: string, value: number): Promise<PanelValues> {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1261', cinemaLevel: 0, ...BASE_CHAR } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...BASE_CHAR } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...BASE_CHAR } as any
    config.globalBuffs = [{ id: 'g1', name: 't', stat, value, enabled: true, targetSkillType: 'all' }] as any
    return computePanelPhases(0, config as any, catalog as any)!.inCombat
  }

  it('预览面（TeamConfigPage 口径）与引擎面逐字段一致 —— 含修前分裂的 anomalyMastery/energyRegen', async () => {
    for (const [stat, value] of [['anomalyMastery', 30], ['energyRegen', 0.5], ['enemyResReduction', 20], ['atkPct', 15]] as const) {
      const engine = await enginePanel(stat, value)
      // 预览面：与 TeamConfigPage.vue 的 computed 同一调用形态（改前它错用 isPctStat）
      const preview: PanelValues = { ...(await enginePanel('', 0)) }
      applyTargetedStat(preview, stat as any, value, statSettlementMode(stat), 'all')
      for (const key of ['anomalyMastery', 'energyRegenBonusPct', 'energyRegenBonusFlat', 'enemyResReduction', 'atkPct'] as const) {
        expect({ stat, key, v: (preview as any)[key] })
          .toEqual({ stat, key, v: (engine as any)[key] })
      }
    }
  })

  it('anomalyMastery 的结算口径是 flat：+30 就是 +30（不是 ×1.3）', async () => {
    const none = await enginePanel('', 0)
    const am = await enginePanel('anomalyMastery', 30)
    expect(am.anomalyMastery - none.anomalyMastery).toBeCloseTo(30, 9)
  })

  it('energyRegen 的结算口径是 flat：进 BonusFlat 而不是 BonusPct', async () => {
    const none = await enginePanel('', 0)
    const er = await enginePanel('energyRegen', 0.5)
    expect(er.energyRegenBonusFlat - none.energyRegenBonusFlat).toBeCloseTo(0.5, 9)
    expect(er.energyRegenBonusPct - none.energyRegenBonusPct).toBeCloseTo(0, 9)
  })
})
