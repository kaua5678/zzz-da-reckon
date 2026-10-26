/**
 * 探针：自动加金准不准 —— 三臂对账（PROBE_AUTO_GOLD=1）。
 *
 * 用户 2026-10-26：「队伍对比的自动加金感觉完全不准，你可以给我一串结果，我给你更强的配置」
 * ⇒ 本探针不改生产逻辑，把同一支队伍、同一金数预算下的三条加金路径并排量出来，
 * 供用户逐行指认哪一档不对。
 *
 * | 臂 | 是谁 | 代码 |
 * |---|---|---|
 * | D | 页面**默认**路径（「最优加金」未勾）：加金阶梯的前 N 步 | goldStepsForPreset → applyGoldToStore |
 * | G | 勾「最优加金」：逐金贪婪链 | teamCompare#computeOptimalGoldAllocations |
 * | O | 参考最优：同一候选池按「槽位前缀」全枚举取最大 | 本文件 |
 *
 * 三臂候选池同源（同一份 goldSteps）：O ⊇ G ⊇ D（状态集合意义上）。
 * 所以 D 与 O 的差 = 「默认路径有多不按伤害走」，G 与 O 的差 = 「贪婪近视值多少」。
 *
 * 跑法：
 *   PROBE_AUTO_GOLD=1 npx vitest run src/composables/__tests__/autoGoldProbe.test.ts
 *   PROBE_AUTO_GOLD=1 PROBE_AUTO_GOLD_TEAMS=banyue-liuyin-lucia,auto-1051-1141-1451 npx vitest run ...
 *   PROBE_AUTO_GOLD=1 PROBE_AUTO_GOLD_MAX=3 npx vitest run ...   # 预算上限 = 基础金 + 3（缺省 3）
 *   PROBE_AUTO_GOLD=1 PROBE_AUTO_GOLD_BOSS=40009 npx vitest run ...
 *
 * 不设 PROBE_AUTO_GOLD 时空跑（普通 vitest 不受影响）。
 */

import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyBossRoom } from '@/composables/bossRoom'
import { goldStepsForPreset } from '@/composables/goldStepsFromCatalog'
import { isLimitedSWengineId } from '@/composables/limitedGold'
import {
  applyGoldAllocationToStore,
  applyGoldToStore,
  applyGoldSteps,
  applyTeamToStore,
  baseGoldOf,
  computeAutoEnginePicks,
  computeOptimalGoldAllocations,
  resolveGoldLevel,
  type OptimalGoldAllocation,
} from '@/composables/teamCompare'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { GoldStep, TeamPreset } from '@/types/teamPreset'
import type { TeamGoldState } from '@/composables/teamTimeline'

const ACTIVE = process.env.PROBE_AUTO_GOLD === '1'
const TEAM_IDS = (process.env.PROBE_AUTO_GOLD_TEAMS ?? '').split(',').map(s => s.trim()).filter(Boolean)
const MAX_EXTRA = Math.max(0, Number(process.env.PROBE_AUTO_GOLD_MAX ?? 3))
const BOSS_ID = process.env.PROBE_AUTO_GOLD_BOSS ?? ''
/** 逐档明细只展开「默认路径偏离最大」的前 N 队（缺省 12；0 = 全部不展开，只出汇总） */
const TOP_N = Number(process.env.PROBE_AUTO_GOLD_TOP ?? 12)

/** 缺省要看的队：作者排过顺序的 2 条 + 空 goldSteps 的 4 条（覆盖常驻队友 / 非限定基础音擎两种形状） */
const DEFAULT_TEAMS = [
  'banyue-liuyin-lucia',
  'claret-roxy-rina',
  'auto-1051-1141-1451',
  'auto-1091-1031-1311',
  'auto-1021-1481-1311',
  'auto-1371-1311-1451',
]

const M = (v: number) => (v / 1e6).toFixed(2) + 'M'
const P = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
const lossPct = (ref: number, v: number) => (ref > 0 ? ((ref - v) / ref) * 100 : 0)
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))

/** 一个槽位的阶梯（影画线 / 音擎线），与 applyGoldSteps 的分组口径一致 */
interface SlotLadder {
  cinemas: GoldStep[]
  /** 音擎线：首条可能是「换装限定音擎（本体）」，其后是精炼 2..5 */
  engines: GoldStep[]
}

function laddersOf(steps: readonly GoldStep[]): SlotLadder[] {
  const out: SlotLadder[] = [0, 1, 2].map(() => ({ cinemas: [], engines: [] }))
  for (const s of steps) {
    const l = out[s.slot]
    if (!l) continue
    if (s.kind === 'cinema') l.cinemas.push(s)
    else l.engines.push(s)
  }
  for (const l of out) {
    l.cinemas.sort((a, b) => a.value - b.value)
    // 获取步（带 wEngineId）必须排在精炼步之前：换装后精炼从 1 重算
    l.engines.sort((a, b) => (a.wEngineId ? 0 : 1) - (b.wEngineId ? 0 : 1) || a.value - b.value)
  }
  return out
}

/** 组合枚举：每槽取「影画前 kc 级 + 音擎前 ke 步」，总代价 = Σ(kc + ke) */
function combosAt(ladders: SlotLadder[], cost: number): [number, number][][] {
  const acc: [number, number][][] = []
  const cur: [number, number][] = [[0, 0], [0, 0], [0, 0]]
  const walk = (slot: number, left: number): void => {
    if (slot === 3) {
      if (left === 0) acc.push(cur.map(c => [c[0], c[1]] as [number, number]))
      return
    }
    const l = ladders[slot]!
    for (let kc = 0; kc <= l.cinemas.length && kc <= left; kc++) {
      for (let ke = 0; ke <= l.engines.length && kc + ke <= left; ke++) {
        cur[slot] = [kc, ke]
        walk(slot + 1, left - kc - ke)
      }
    }
    cur[slot] = [0, 0]
  }
  walk(0, cost)
  return acc
}

function stateFromCombos(base: TeamGoldState, ladders: SlotLadder[], combo: [number, number][]): TeamGoldState {
  const cinemas: [number, number, number] = [base.cinemas[0], base.cinemas[1], base.cinemas[2]]
  const mods: [number, number, number] = [base.wengineMods[0], base.wengineMods[1], base.wengineMods[2]]
  const engines: [string, string, string] = [base.wEngines[0], base.wEngines[1], base.wEngines[2]]
  for (let s = 0; s < 3; s++) {
    const pair = combo[s]!
    for (const st of ladders[s]!.cinemas.slice(0, pair[0])) cinemas[s] = Math.max(cinemas[s], st.value)
    for (const st of ladders[s]!.engines.slice(0, pair[1])) {
      if (st.wEngineId) { engines[s] = st.wEngineId; mods[s] = 1 }
      else if (isLimitedSWengineId(engines[s])) mods[s] = Math.max(mods[s], st.value)
    }
  }
  return { cinemas, wengineMods: mods, wEngines: engines }
}

/** 配装码：左位影画 + 右位精炼；戴非限定音擎时右位写 - */
function codeOf(state: TeamGoldState, slot: number): string {
  const c = String(state.cinemas[slot])
  return isLimitedSWengineId(state.wEngines[slot]) ? c + String(state.wengineMods[slot]) : c + '-'
}
const codesOf = (state: TeamGoldState) => codeOf(state, 0) + ' ' + codeOf(state, 1) + ' ' + codeOf(state, 2)

/** 配装差分 → 「这笔金花在哪」 */
function diffLabel(base: TeamGoldState, next: TeamGoldState): string {
  const parts: string[] = []
  for (let s = 0; s < 3; s++) {
    const d = next.cinemas[s] - base.cinemas[s]
    if (d > 0) parts.push('槽' + (s + 1) + ' ' + next.cinemas[s] + '命')
    if (next.wEngines[s] !== base.wEngines[s]) parts.push('槽' + (s + 1) + ' 换音擎')
    else if (next.wengineMods[s] > base.wengineMods[s]) parts.push('槽' + (s + 1) + ' 精' + next.wengineMods[s])
  }
  return parts.length > 0 ? parts.join(' + ') : '（无变化）'
}

interface Row {
  gold: number
  baseState: TeamGoldState
  dState: TeamGoldState
  dDamage: number
  gState: TeamGoldState
  gDamage: number
  oState: TeamGoldState
  oDamage: number
  combos: number
}


describe.runIf(ACTIVE)('探针：自动加金三臂对账（D 默认确定性 / G 贪婪 / O 穷举参考）', () => {
  it('逐队逐金档输出 D/G/O 配装与伤害', { timeout: 3_600_000 }, async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const data = await catalog.loadBossPresets()
    const pairs: { boss: BossPreset; phase: BossPresetPhase }[] = []
    for (const b of data.bosses ?? []) for (const ph of b.phases) pairs.push({ boss: b, phase: ph })
    pairs.sort((a, b) => (b.phase.begin || b.phase.phaseId).localeCompare(a.phase.begin || a.phase.phaseId))
    const pick = BOSS_ID ? pairs.find(p => p.boss.id === BOSS_ID) : undefined
    const { boss, phase } = pick ?? pairs[0]!
    console.log('环境：' + boss.name + '(' + boss.id + ') · ' + phase.label + ' · hp=' + phase.hp)
    console.log('配装码：左位影画 + 右位精炼（21 = 2命1精）；右位 - = 戴非限定音擎（不占金）')

    const names = TEAM_IDS.length > 0 ? TEAM_IDS : DEFAULT_TEAMS
    const targets: TeamPreset[] = []
    for (const id of names) {
      const p = teamPresets.find(x => x.id === id)
      if (p) targets.push(p)
      else console.log('⚠ 未找到预设 ' + id)
    }
    console.log('队伍 ' + targets.length + ' 条 · 预算上限 = 基础金 + ' + MAX_EXTRA)

    const allRows: { preset: TeamPreset; base: number; rows: Row[] }[] = []
    const t0 = Date.now()

    for (const preset of targets) {
      const tTeam = Date.now()
      applyTeamToStore(config, preset)
      const baseGold = baseGoldOf(preset)
      const goldSteps = goldStepsForPreset(preset, catalog)
      // 与 computeTeamComparePoints 同序：置基础档 → 下 boss → 自动下位择优 → 贪婪
      applyGoldAllocationToStore(
        config,
        applyGoldSteps(goldSteps, baseGold, baseGold, preset.standardSteps ?? [], preset.wEngines ?? []),
      )
      applyBossRoom(config, boss, phase)
      const autoPicks = computeAutoEnginePicks(calc, config, preset, {})
      const allocs = computeOptimalGoldAllocations(calc, config, preset, baseGold, autoPicks, {}, goldSteps)
      const baseAlloc = allocs[0]!
      const baseState: TeamGoldState = { cinemas: baseAlloc.cinemas, wengineMods: baseAlloc.wengineMods, wEngines: baseAlloc.wEngines }
      const ladders = laddersOf(goldSteps)
      const rows: Row[] = []
      for (let k = 0; k <= MAX_EXTRA; k++) {
        const target = baseGold + k
        const { totalGold } = resolveGoldLevel(goldSteps, target, baseGold)
        if (totalGold !== target) continue
        const dApplied = applyGoldToStore(config, preset, target, autoPicks, goldSteps)
        const dDamage = calc.teamTotalDamage.value
        const dState: TeamGoldState = { cinemas: dApplied.cinemas, wengineMods: dApplied.wengineMods, wEngines: dApplied.wEngines }
        const gAlloc: OptimalGoldAllocation | undefined = allocs.find(a => a.budgetGold === target)
        let oState = baseState
        let oDamage = baseAlloc.damage
        let oN = 0
        for (const combo of combosAt(ladders, k)) {
          const st = stateFromCombos(baseState, ladders, combo)
          applyGoldAllocationToStore(config, st)
          const dmg = calc.teamTotalDamage.value
          oN++
          if (Number.isFinite(dmg) && dmg > oDamage + 1e-9) { oDamage = dmg; oState = st }
        }
        rows.push({
          gold: target,
          baseState,
          dState, dDamage,
          gState: gAlloc ? { cinemas: gAlloc.cinemas, wengineMods: gAlloc.wengineMods, wEngines: gAlloc.wEngines } : baseState,
          gDamage: gAlloc?.damage ?? baseAlloc.damage,
          oState, oDamage, combos: oN,
        })
      }
      allRows.push({ preset, base: baseGold, rows })
      console.log('· ' + preset.name + '（' + preset.id + '）基础 ' + baseGold + ' 金 · 阶梯 ' + goldSteps.length + ' 步 · ' + ((Date.now() - tTeam) / 1000).toFixed(1) + 's')
    }

    // 每队聚合：默认路径最大偏离 / 贪婪最大偏离 / 选错档数
    const perTeam = allRows.map(({ preset, base, rows }) => {
      let maxD = 0
      let maxG = 0
      let wrongD = 0
      let wrongG = 0
      let n = 0
      let worstGoldD = base
      for (const r of rows) {
        if (r.gold === base) continue
        n++
        const d = lossPct(r.oDamage, r.dDamage)
        const g = lossPct(r.oDamage, r.gDamage)
        if (d > maxD) { maxD = d; worstGoldD = r.gold }
        if (g > maxG) maxG = g
        if (codesOf(r.dState) !== codesOf(r.oState)) wrongD++
        if (codesOf(r.gState) !== codesOf(r.oState)) wrongG++
      }
      return { preset, base, maxD, maxG, wrongD, wrongG, n, worstGoldD }
    })
    console.log('')
    console.log('================ 逐队汇总（按 默认路径最大偏离 降序；D = 页面默认 / G = 勾最优加金 / O = 同池穷举最优） ================')
    console.log(pad('队伍', 34) + pad('基础金', 7) + pad('档数', 5) + pad('D最大偏离', 11) + pad('D选错', 9) + pad('G最大偏离', 11) + pad('G选错', 9) + 'D 最差那档')
    for (const t of [...perTeam].sort((a, b) => b.maxD - a.maxD)) {
      console.log(
        pad(t.preset.name, 34) + pad(String(t.base), 7) + pad(String(t.n), 5)
        + pad('-' + t.maxD.toFixed(1) + '%', 11) + pad(t.wrongD + '/' + t.n, 9)
        + pad('-' + t.maxG.toFixed(1) + '%', 11) + pad(t.wrongG + '/' + t.n, 9)
        + (t.maxD > 0 ? t.worstGoldD + ' 金' : '—'),
      )
    }

    const detailSet = new Set([...perTeam].sort((a, b) => b.maxD - a.maxD).slice(0, TOP_N).map(t => t.preset.id))
    console.log('')
    console.log('================ 逐档明细（只展开默认路径偏离最大的前 ' + TOP_N + ' 队） ================')
    for (const { preset, base, rows } of allRows) {
      if (TOP_N > 0 && !detailSet.has(preset.id)) continue
      console.log('')
      console.log('### ' + preset.name + '（' + preset.id + '）· 基础 ' + base + ' 金')
      console.log(pad('金', 4) + pad('D配装', 11) + pad('D伤害', 11) + pad('G配装', 11) + pad('G伤害', 11) + pad('O配装', 11) + pad('O伤害', 11) + pad('D-O', 9) + pad('G-O', 9) + 'O 这笔金花在')
      for (const r of rows) {
        console.log(
          pad(String(r.gold), 4)
          + pad(codesOf(r.dState), 11) + pad(M(r.dDamage), 11)
          + pad(codesOf(r.gState), 11) + pad(M(r.gDamage), 11)
          + pad(codesOf(r.oState), 11) + pad(M(r.oDamage), 11)
          + pad(r.gold === base ? '—' : P(-lossPct(r.oDamage, r.dDamage)), 9)
          + pad(r.gold === base ? '—' : P(-lossPct(r.oDamage, r.gDamage)), 9)
          + diffLabel(r.baseState, r.oState),
        )
      }
    }

    console.log('')
    console.log('================ 汇总 ================')
    const dGaps: number[] = []
    const gGaps: number[] = []
    let dDiff = 0
    let gDiff = 0
    let n = 0
    for (const { base, rows } of allRows) {
      for (const r of rows) {
        if (r.gold === base) continue
        n++
        dGaps.push(lossPct(r.oDamage, r.dDamage))
        gGaps.push(lossPct(r.oDamage, r.gDamage))
        if (codesOf(r.dState) !== codesOf(r.oState)) dDiff++
        if (codesOf(r.gState) !== codesOf(r.oState)) gDiff++
      }
    }
    const stat = (a: number[]) => a.length === 0 ? 'n=0' : 'n=' + a.length
      + ' 均值=' + (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) + '%'
      + ' 中位=' + [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!.toFixed(2) + '%'
      + ' 最大=' + Math.max(...a).toFixed(2) + '%'
    console.log('D（页面默认）比 O 低：' + stat(dGaps) + ' · 配装选错 ' + dDiff + '/' + n + ' 档')
    console.log('G（最优加金）比 O 低：' + stat(gGaps) + ' · 配装选错 ' + gDiff + '/' + n + ' 档')
    console.log('总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's')

    expect(allRows.length).toBeGreaterThan(0)
    expect(allRows.every(x => x.rows.length > 0)).toBe(true)
  })
})


describe.runIf(ACTIVE)('探针：单步单调性审计（每个加金步单独加在基础档上，看伤害涨还是跌）', () => {
  it('列出「花 1 金反而掉伤害」的步', { timeout: 3_600_000 }, async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const data = await catalog.loadBossPresets()
    const pairs: { boss: BossPreset; phase: BossPresetPhase }[] = []
    for (const b of data.bosses ?? []) for (const ph of b.phases) pairs.push({ boss: b, phase: ph })
    pairs.sort((a, b) => (b.phase.begin || b.phase.phaseId).localeCompare(a.phase.begin || a.phase.phaseId))
    const { boss, phase } = (BOSS_ID ? pairs.find(p => p.boss.id === BOSS_ID) : undefined) ?? pairs[0]!

    const names = TEAM_IDS.length > 0 ? TEAM_IDS : DEFAULT_TEAMS
    let totalSteps = 0
    const negative: { team: string; step: string; base: number; after: number; pct: number }[] = []
    for (const id of names) {
      const preset = teamPresets.find(x => x.id === id)
      if (!preset) continue
      applyTeamToStore(config, preset)
      const baseGold = baseGoldOf(preset)
      const goldSteps = goldStepsForPreset(preset, catalog)
      applyGoldAllocationToStore(
        config,
        applyGoldSteps(goldSteps, baseGold, baseGold, preset.standardSteps ?? [], preset.wEngines ?? []),
      )
      applyBossRoom(config, boss, phase)
      const autoPicks = computeAutoEnginePicks(calc, config, preset, {})
      const allocs = computeOptimalGoldAllocations(calc, config, preset, baseGold, autoPicks, {}, goldSteps)
      const baseAlloc = allocs[0]!
      const baseState: TeamGoldState = { cinemas: baseAlloc.cinemas, wengineMods: baseAlloc.wengineMods, wEngines: baseAlloc.wEngines }
      const baseDamage = baseAlloc.damage
      const ladders = laddersOf(goldSteps)
      // 每个「第 1 级」候选各单独试一次
      for (let s = 0; s < 3; s++) {
        const cands: GoldStep[] = []
        if (ladders[s]!.cinemas.length > 0) cands.push(ladders[s]!.cinemas[0]!)
        if (ladders[s]!.engines.length > 0) cands.push(ladders[s]!.engines[0]!)
        for (const step of cands) {
          const st = stateFromCombos(baseState, ladders, [[0, 0], [0, 0], [0, 0]].map((_, i) => i === s
            ? [step.kind === 'cinema' ? 1 : 0, step.kind === 'cinema' ? 0 : 1]
            : [0, 0]) as [number, number][])
          applyGoldAllocationToStore(config, st)
          const dmg = calc.teamTotalDamage.value
          totalSteps++
          if (!Number.isFinite(dmg) || dmg < baseDamage - 1e-9) {
            negative.push({ team: preset.name, step: '槽' + (s + 1) + ' ' + (step.label ?? ''), base: baseDamage, after: dmg, pct: lossPct(baseDamage, dmg) })
          }
        }
      }
    }
    console.log('')
    console.log('================ 单步单调性（花 1 金却掉伤害的步） ================')
    console.log('总试探步数 ' + totalSteps + ' · 掉伤害 ' + negative.length + ' 步')
    for (const n of negative.sort((a, b) => b.pct - a.pct)) {
      console.log('  ' + pad(n.team, 30) + pad(n.step, 26) + M(n.base) + ' → ' + M(n.after) + '  (' + (-n.pct).toFixed(1) + '%)')
    }
    expect(totalSteps).toBeGreaterThan(0)
  })
})


describe.runIf(ACTIVE)('探针：武器对比（诺姆 精5人为刀俎 vs 精1首席跟班）逐层拆解', () => {
  it('把「全队 +20% / 个人 +60%」拆成面板项 × 乘区', { timeout: 3_600_000 }, async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1611' }, { agentId: '1571' }, { agentId: '1211' }])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const data = await catalog.loadBossPresets()
    const pairs: { boss: BossPreset; phase: BossPresetPhase }[] = []
    for (const b of data.bosses ?? []) for (const ph of b.phases) pairs.push({ boss: b, phase: ph })
    pairs.sort((a, b) => (b.phase.begin || b.phase.phaseId).localeCompare(a.phase.begin || a.phase.phaseId))
    const { boss, phase } = (BOSS_ID ? pairs.find(p => p.boss.id === BOSS_ID) : undefined) ?? pairs[0]!

    const preset = teamPresets.find(p => p.id === 'auto-1611-1571-1211')!
    applyTeamToStore(config, preset)
    const baseGold = baseGoldOf(preset)
    applyGoldAllocationToStore(config, applyGoldSteps(preset.goldSteps, baseGold, baseGold, preset.standardSteps ?? [], preset.wEngines ?? []))
    applyBossRoom(config, boss, phase)
    console.log('队伍：' + preset.name + ' · Boss ' + boss.name + ' · 槽2 = 诺姆')

    const readArm = (wId: string, mod: number) => {
      config.setWEngine(1, wId)
      config.setWEngineModLevel(1, mod)
      void calc.teamTotalDamage.value
      const rows = calc.damagePoolRows.value ?? []
      let own = 0
      for (const r of rows) if (r.slot === 1) own += r.totalDamage
      const p0 = (calc.panels.value ?? [])[1] ?? null
      const rr = calc.resourceResult.value
      return {
        wId, mod,
        team: calc.teamTotalDamage.value,
        own,
        panel: p0,
        stunCount: calc.stunPoolResult.value?.stunCount ?? -1,
        coverage: calc.stunCoverage.value,
        chars: (rr?.characters ?? []).length,
      }
    }
    const A = readArm('13005', 5)
    const B = readArm('14157', 1)
    console.log('')
    console.log('A = 精5 人为刀俎(13005) · 全队 ' + M(A.team) + ' · 个人 ' + M(A.own) + ' · 失衡 ' + A.stunCount)
    console.log('B = 精1 首席跟班(14157) · 全队 ' + M(B.team) + ' · 个人 ' + M(B.own) + ' · 失衡 ' + B.stunCount)
    console.log('全队 ' + P(((B.team - A.team) / A.team) * 100) + ' · 个人 ' + P(((B.own - A.own) / A.own) * 100))
    console.log('')
    console.log('---- 面板项差分（B − A）----')
    const pa = A.panel
    const pb = B.panel
    if (pa && pb) {
      const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter(k => typeof (pa as never as Record<string, number>)[k] === 'number')
      for (const k of keys.sort()) {
        const va = (pa as never as Record<string, number>)[k]
        const vb = (pb as never as Record<string, number>)[k]
        if (Math.abs((vb ?? 0) - (va ?? 0)) > 1e-9) console.log('  ' + pad(k, 34) + String(va) + ' → ' + String(vb))
      }
    }
    expect(A.team).toBeGreaterThan(0)
    expect(B.team).toBeGreaterThan(0)
  })
})


describe.runIf(ACTIVE)('探针：武器对比的失衡锁（同一次换武器，锁 2 次 vs 自由收敛）', () => {
  it('把「+88% 个人」拆成「锁失衡后的真实收益」与「多打一次失衡」', { timeout: 3_600_000 }, async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1611' }, { agentId: '1571' }, { agentId: '1211' }])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const data = await catalog.loadBossPresets()
    const pairs: { boss: BossPreset; phase: BossPresetPhase }[] = []
    for (const b of data.bosses ?? []) for (const ph of b.phases) pairs.push({ boss: b, phase: ph })
    pairs.sort((a, b) => (b.phase.begin || b.phase.phaseId).localeCompare(a.phase.begin || a.phase.phaseId))
    const { boss, phase } = (BOSS_ID ? pairs.find(p => p.boss.id === BOSS_ID) : undefined) ?? pairs[0]!

    const preset = teamPresets.find(p => p.id === 'auto-1611-1571-1211')!
    applyTeamToStore(config, preset)
    const baseGold = baseGoldOf(preset)
    applyGoldAllocationToStore(config, applyGoldSteps(preset.goldSteps, baseGold, baseGold, preset.standardSteps ?? [], preset.wEngines ?? []))
    applyBossRoom(config, boss, phase)

    const arm = (wId: string, mod: number, lock: number | null) => {
      config.enemy.stunCountLock = lock ?? -1
      config.setWEngine(1, wId)
      config.setWEngineModLevel(1, mod)
      void calc.teamTotalDamage.value
      let own = 0
      for (const r of calc.damagePoolRows.value ?? []) if (r.slot === 1) own += r.totalDamage
      return { team: calc.teamTotalDamage.value, own, stun: calc.stunPoolResult.value?.stunCount ?? -1 }
    }
    const origLock = config.enemy.stunCountLock
    // 自由收敛：先量两边各打几次失衡
    const aFree = arm('13005', 5, null)
    const bFree = arm('14157', 1, null)
    console.log('')
    console.log('【自由收敛】A 精5人为刀俎 全队 ' + M(aFree.team) + ' 个人 ' + M(aFree.own) + ' 失衡 ' + aFree.stun)
    console.log('【自由收敛】B 精1首席跟班 全队 ' + M(bFree.team) + ' 个人 ' + M(bFree.own) + ' 失衡 ' + bFree.stun)
    console.log('  全队 ' + P((bFree.team / aFree.team - 1) * 100) + ' · 个人 ' + P((bFree.own / aFree.own - 1) * 100) + '   ← 页面上报的就是这一行')
    // 锁 A 的失衡次数，两边同次数比
    const lock = aFree.stun
    const aLock = arm('13005', 5, lock)
    const bLock = arm('14157', 1, lock)
    config.enemy.stunCountLock = origLock
    console.log('')
    console.log('【锁 ' + lock + ' 次失衡】A 全队 ' + M(aLock.team) + ' 个人 ' + M(aLock.own) + ' 失衡 ' + aLock.stun)
    console.log('【锁 ' + lock + ' 次失衡】B 全队 ' + M(bLock.team) + ' 个人 ' + M(bLock.own) + ' 失衡 ' + bLock.stun)
    console.log('  全队 ' + P((bLock.team / aLock.team - 1) * 100) + ' · 个人 ' + P((bLock.own / aLock.own - 1) * 100))
    console.log('')
    console.log('⇒ 自由口径里有 ' + (bFree.stun - aFree.stun) + ' 次失衡是「换武器顺带多打的」，不属于武器属性。')
    expect(aFree.team).toBeGreaterThan(0)
  })
})


describe.runIf(ACTIVE)('探针：武器对比逐因子拆解（人为刀俎 → 首席跟班 的每项面板差各值多少钱）', () => {
  it('在 A 上逐项叠加 B 的属性，看边际', { timeout: 3_600_000 }, async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1611' }, { agentId: '1571' }, { agentId: '1211' }])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const data = await catalog.loadBossPresets()
    const pairs: { boss: BossPreset; phase: BossPresetPhase }[] = []
    for (const b of data.bosses ?? []) for (const ph of b.phases) pairs.push({ boss: b, phase: ph })
    pairs.sort((a, b) => (b.phase.begin || b.phase.phaseId).localeCompare(a.phase.begin || a.phase.phaseId))
    const { boss, phase } = (BOSS_ID ? pairs.find(p => p.boss.id === BOSS_ID) : undefined) ?? pairs[0]!
    const preset = teamPresets.find(p => p.id === 'auto-1611-1571-1211')!
    applyTeamToStore(config, preset)
    const baseGold = baseGoldOf(preset)
    applyGoldAllocationToStore(config, applyGoldSteps(preset.goldSteps, baseGold, baseGold, preset.standardSteps ?? [], preset.wEngines ?? []))
    applyBossRoom(config, boss, phase)
    // 锁住 A 的失衡次数（页面武器对比当前是自由口径，这里两种都给）
    const readArm = (wId: string, mod: number) => {
      config.setWEngine(1, wId)
      config.setWEngineModLevel(1, mod)
      void calc.teamTotalDamage.value
      let own = 0
      for (const r of calc.damagePoolRows.value ?? []) if (r.slot === 1) own += r.totalDamage
      return { team: calc.teamTotalDamage.value, own, stun: calc.stunPoolResult.value?.stunCount ?? -1 }
    }
    const A = readArm('13005', 5)
    const B = readArm('14157', 1)
    const lock = A.stun
    config.enemy.stunCountLock = lock
    const aL = readArm('13005', 5)
    const bL = readArm('14157', 1)
    console.log('')
    console.log('自由：A 全队 ' + M(A.team) + '/个人 ' + M(A.own) + ' 失衡 ' + A.stun + ' | B 全队 ' + M(B.team) + '/个人 ' + M(B.own) + ' 失衡 ' + B.stun)
    console.log('锁 ' + lock + '：A 全队 ' + M(aL.team) + '/个人 ' + M(aL.own) + ' | B 全队 ' + M(bL.team) + '/个人 ' + M(bL.own))
    console.log('')

    // 逐项叠加：只在 A 的配装上，把 B 多出来的属性逐条加进去（globalBuff 行）
    const deltas: { stat: string; value: number; note: string }[] = [
      { stat: 'critRate', value: 24, note: '首席跟班 副属性暴击率 24' },
      { stat: 'dmgBonus', value: 25, note: '首席跟班 特效全队增伤 12.5×2 层' },
      { stat: 'enemyFireResReduction', value: 15, note: '首席跟班 无视火抗 15' },
      { stat: 'atkFlat', value: 119, note: '白值攻击 713 vs 594' },
      { stat: 'impactFlat', value: 0, note: '（冲击力 30 vs 136 已由基础音擎给）' },
    ]
    const applyDelta = (rows: { stat: string; value: number }[]) => {
      config.globalBuffs.splice(0, config.globalBuffs.length)
      for (const [i, r] of rows.entries()) {
        config.globalBuffs.push({ id: 'probe' + i, name: 'probe', stat: r.stat, value: r.value, enabled: true, targetSkillType: 'all' })
      }
    }
    config.setWEngine(1, '13005')
    config.setWEngineModLevel(1, 5)
    applyDelta([])
    void calc.teamTotalDamage.value
    let ownBase = 0
    for (const r of calc.damagePoolRows.value ?? []) if (r.slot === 1) ownBase += r.totalDamage
    const teamBase = calc.teamTotalDamage.value
    console.log('基线（精5人为刀俎 + 已锁失衡）全队 ' + M(teamBase) + ' 个人 ' + M(ownBase))
    console.log('')
    console.log(pad('叠加项', 44) + pad('全队', 11) + pad('Δ全队', 9) + pad('个人', 11) + 'Δ个人')
    const readNow = () => {
      void calc.teamTotalDamage.value
      let own = 0
      for (const r of calc.damagePoolRows.value ?? []) if (r.slot === 1) own += r.totalDamage
      return { team: calc.teamTotalDamage.value, own }
    }
    const cumulative: { stat: string; value: number }[] = []
    for (const d of deltas) {
      if (d.value === 0) continue
      cumulative.push({ stat: d.stat, value: d.value })
      applyDelta(cumulative)
      const now = readNow()
      console.log(pad(d.note, 44) + pad(M(now.team), 11) + pad(P((now.team / teamBase - 1) * 100), 9) + pad(M(now.own), 11) + P((now.own / ownBase - 1) * 100))
    }
    config.globalBuffs.splice(0, config.globalBuffs.length)
    config.enemy.stunCountLock = -1
    expect(A.team).toBeGreaterThan(0)
  })
})


describe.runIf(ACTIVE)('探针：加金步的音擎/影画候选从哪来（含掉伤害的那几步）', () => {
  it('列出每槽的基础音擎 vs 阶梯里「换专武」的目标音擎', { timeout: 3_600_000 }, async () => {
    const { catalog } = await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    const { baseWEngineFor, bestLimitedWEngineFor, goldStepsForPreset } = await import('@/composables/goldStepsFromCatalog')
    const ids = TEAM_IDS.length > 0 ? TEAM_IDS : ['auto-1181-1511-1411', 'auto-1021-1141-1211', 'auto-1091-1411-1131', 'auto-1041-1571-1311', 'auto-1051-1141-1451']
    const nameOfW = (id: string) => { const w = catalog.getWEngine(id); return w ? w.name.zhCN + '(' + id + ') ' + w.rarity + '/' + w.specialty : id || '—' }
    const nameOfA = (id: string) => { const a = catalog.getAgent(id); return a ? a.name.zhCN + '(' + id + ')' : id }
    console.log('')
    console.log('================ 每槽：基础音擎 vs 阶梯里换装目标 ================')
    for (const id of ids) {
      const preset = teamPresets.find(p => p.id === id)
      if (!preset) continue
      console.log('')
      console.log('### ' + preset.name + '（' + preset.id + '）')
      const steps = goldStepsForPreset(preset, catalog)
      for (let s = 0; s < 3; s++) {
        const agent = catalog.getAgent(preset.team[s]!)
        if (!agent) continue
        const base = baseWEngineFor(agent, catalog)
        const best = bestLimitedWEngineFor(agent, catalog)
        const step = steps.find(x => x.slot === s && x.kind === 'wengine' && x.wEngineId)
        console.log('  槽' + (s + 1) + ' ' + pad(nameOfA(preset.team[s]!), 24)
          + ' 职业=' + agent.specialty + ' 属性=' + agent.damageElement
          + (agent.id === '1571' ? '（火）' : ''))
        console.log('      预设声明=' + pad(nameOfW(preset.wEngines?.[s] ?? ''), 34) + ' baseWEngineFor=' + nameOfW(base))
        console.log('      bestLimited  =' + pad(nameOfW(best ?? ''), 34) + ' 阶梯换装步=' + (step ? nameOfW(step.wEngineId!) : '—'))
      }
    }
    expect(ids.length).toBeGreaterThan(0)
  })
})


describe.runIf(ACTIVE)('探针：诺姆换武器（推荐配装口径，贴近页面实数）', () => {
  it('复现页面上的 60% 并拆出每一层', { timeout: 3_600_000 }, async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1611' }, { agentId: '1571' }, { agentId: '1211' }], { recommendedBuild: true })
    const calc = useResourceCalc()
    const data = await catalog.loadBossPresets()
    const pairs: { boss: BossPreset; phase: BossPresetPhase }[] = []
    for (const b of data.bosses ?? []) for (const ph of b.phases) pairs.push({ boss: b, phase: ph })
    pairs.sort((a, b) => (b.phase.begin || b.phase.phaseId).localeCompare(a.phase.begin || a.phase.phaseId))
    const { boss, phase } = (BOSS_ID ? pairs.find(p => p.boss.id === BOSS_ID) : undefined) ?? pairs[0]!
    applyBossRoom(config, boss, phase)
    const arm = (wId: string, mod: number, lock: number) => {
      config.enemy.stunCountLock = lock
      config.setWEngine(1, wId)
      config.setWEngineModLevel(1, mod)
      void calc.teamTotalDamage.value
      let own = 0
      for (const r of calc.damagePoolRows.value ?? []) if (r.slot === 1) own += r.totalDamage
      const p = (calc.panels.value ?? [])[1]!
      return { team: calc.teamTotalDamage.value, own, stun: calc.stunPoolResult.value?.stunCount ?? -1, critRate: p.critRate, critDmg: p.critDmg, atk: p.atk, dmgBonus: p.dmgBonus, fireRes: (p as never as Record<string, number>).enemyFireResReduction, stunEx: (p as never as Record<string, number>).stunBuildUpBonus__exSpecial }
    }
    const aF = arm('13005', 5, -1)
    const bF = arm('14157', 1, -1)
    console.log('')
    console.log('推荐配装 · 自由（= 页面当前口径）')
    console.log('  A 精5人为刀俎：全队 ' + M(aF.team) + ' 个人 ' + M(aF.own) + ' 失衡 ' + aF.stun + ' | 暴击 ' + aF.critRate + ' 爆伤 ' + aF.critDmg + ' 攻 ' + aF.atk.toFixed(0) + ' 增伤 ' + aF.dmgBonus + ' 火抗忽视 ' + aF.fireRes)
    console.log('  B 精1首席跟班：全队 ' + M(bF.team) + ' 个人 ' + M(bF.own) + ' 失衡 ' + bF.stun + ' | 暴击 ' + bF.critRate + ' 爆伤 ' + bF.critDmg + ' 攻 ' + bF.atk.toFixed(0) + ' 增伤 ' + bF.dmgBonus + ' 火抗忽视 ' + bF.fireRes)
    console.log('  ⇒ 全队 ' + P((bF.team / aF.team - 1) * 100) + ' · 个人 ' + P((bF.own / aF.own - 1) * 100))
    const aL = arm('13005', 5, aF.stun)
    const bL = arm('14157', 1, aF.stun)
    config.enemy.stunCountLock = -1
    console.log('')
    console.log('锁 ' + aF.stun + ' 次失衡（同次数比）')
    console.log('  A 全队 ' + M(aL.team) + ' 个人 ' + M(aL.own) + '   B 全队 ' + M(bL.team) + ' 个人 ' + M(bL.own))
    console.log('  ⇒ 全队 ' + P((bL.team / aL.team - 1) * 100) + ' · 个人 ' + P((bL.own / aL.own - 1) * 100))
    console.log('')
    console.log('⇒ 「多打一次失衡」自己占：全队 ' + P(((bF.team / aF.team) / (bL.team / aL.team) - 1) * 100) + ' · 个人 ' + P(((bF.own / aF.own) / (bL.own / aL.own) - 1) * 100))
    expect(bF.team).toBeGreaterThan(0)
  })
})


describe.runIf(ACTIVE)('探针：伊德海莉 C0→C1 为什么掉伤害', () => {
  it('拆面板/失衡/时间账', { timeout: 3_600_000 }, async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1051' }, { agentId: '1141' }, { agentId: '1451' }], { recommendedBuild: true })
    const calc = useResourceCalc()
    const data = await catalog.loadBossPresets()
    const pairs: { boss: BossPreset; phase: BossPresetPhase }[] = []
    for (const b of data.bosses ?? []) for (const ph of b.phases) pairs.push({ boss: b, phase: ph })
    pairs.sort((a, b) => (b.phase.begin || b.phase.phaseId).localeCompare(a.phase.begin || a.phase.phaseId))
    const { boss, phase } = (BOSS_ID ? pairs.find(p => p.boss.id === BOSS_ID) : undefined) ?? pairs[0]!
    applyBossRoom(config, boss, phase)
    const arm = (c: number) => {
      config.setCinemaLevel(0, c)
      void calc.teamTotalDamage.value
      const rr = calc.resourceResult.value
      const p = (calc.panels.value ?? [])[0]!
      let own = 0
      for (const r of calc.damagePoolRows.value ?? []) if (r.slot === 0) own += r.totalDamage
      return {
        c, team: calc.teamTotalDamage.value, own,
        stun: calc.stunPoolResult.value?.stunCount ?? -1,
        time: rr ? (rr as never as Record<string, number>) : {},
        atk: p.atk, critRate: p.critRate, critDmg: p.critDmg, dmgBonus: p.dmgBonus,
        rows: (calc.damagePoolRows.value ?? []).length,
      }
    }
    const c0 = arm(0)
    const c1 = arm(1)
    config.setCinemaLevel(0, 0)
    console.log('')
    console.log('C0 全队 ' + M(c0.team) + ' 个人 ' + M(c0.own) + ' 失衡 ' + c0.stun + ' 行 ' + c0.rows + ' | 攻 ' + c0.atk.toFixed(0) + ' 暴 ' + c0.critRate + ' 爆伤 ' + c0.critDmg + ' 增伤 ' + c0.dmgBonus)
    console.log('C1 全队 ' + M(c1.team) + ' 个人 ' + M(c1.own) + ' 失衡 ' + c1.stun + ' 行 ' + c1.rows + ' | 攻 ' + c1.atk.toFixed(0) + ' 暴 ' + c1.critRate + ' 爆伤 ' + c1.critDmg + ' 增伤 ' + c1.dmgBonus)
    console.log('⇒ 全队 ' + P((c1.team / c0.team - 1) * 100) + ' · 个人 ' + P((c1.own / c0.own - 1) * 100))
    expect(c0.team).toBeGreaterThan(0)
  })
})

