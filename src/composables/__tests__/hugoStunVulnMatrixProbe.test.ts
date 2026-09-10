/**
 * 探针：雨果（1291）逐招「失衡易伤」矩阵——哪些招式吃满、哪些吃一部分、哪些完全不吃。
 *
 * 三层逻辑（口径出处见 docs/MECHANICS_IMPLEMENTATION.md:512/517 + hugo.ts:33-45）：
 *  ① 非轴：白名单 `HUGO_FULL_STUN_MOVES`（失衡赠送连携 1291015 / 终结技本体 1291018 /
 *     强特决算 1291_ex_verdict_final / 决算追加 1291_ultimate_verdict_bonus）直给 1，
 *     其余招式直给 0（不走全局覆盖率）；未列白名单的槽位不受影响。
 *  ② 轴模式：易伤 = 「该招式在轴里被认领的单位数 / 该招式总单位数」——`axisSplitFor` 把一行切成
 *     轴内段(易伤=1) + 轴外段(易伤=0) 两行；未被轴认领的招式全部落轴外段 → 0；
 *     **未进轴的槽位回落全局失衡覆盖率**（不是 0）。
 *  ③ 「吃一部分」的两种来源：(a) 轴内段/轴外段并存（同一招被切两行）；
 *     (b) 块跨越窗口边界 → `computeInAxisRatio(startTime, 时长, 窗长)` = 窗口内时长占比 < 1。
 *
 * 跑法：PROBE_HUGO_MATRIX=1 npx vitest run src/composables/__tests__/hugoStunVulnMatrixProbe.test.ts
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { stunAxisPresets, cloneStunAxes } from '@/data/stunAxisPresets'
import { findMoveById } from '@/composables/resourceCalc/helpers'
import { calcStunMultiplier } from '@/core/anomalyPool/helpers'
import { hugoMoveActionTime, HUGO_FULL_STUN_MOVES } from '@/mechanics/agents/hugo'
import { computeInAxisRatio } from '@/core/stunAxis'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

describe('探针：雨果逐招失衡易伤矩阵', () => {
  it.runIf(process.env.PROBE_HUGO_MATRIX)('非轴白名单 / 0命轴 / 2命轴 三态逐招表', async () => {
    const { config, catalog } = await setupHarness(
      [{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }],
      { recommendedBuild: true },
    )
    const calc = useResourceCalc()
    const nameOf = (id?: string) => (id ? (catalog.getAgent(id)?.name?.zhCN ?? id) : '?')

    const setAxis = (presetId: string | null, cinema: number) => {
      config.autoYidhariAxis = false
      config.stunAxisPlans.splice(0)
      config.stunAxes.splice(0)
      config.useStunAxis = false
      config.setCinemaLevel(0, cinema)
      if (presetId) {
        const preset = stunAxisPresets.find(p => p.id === presetId)
        const axes = preset?.axes
        if (!axes) throw new Error(`预设不存在或无轴：${presetId}`)
        config.stunAxes.push(...cloneStunAxes(axes))
        config.useStunAxis = true
        return preset
      }
      return null
    }

    const report = (title: string, _preset?: ReturnType<typeof stunAxisPresets.find> | null) => {
      const vuln = config.enemy.stunVuln
      const panel = calc.panels.value[0]
      const full = calcStunMultiplier(vuln, panel?.stunDmgMultiplierBonus ?? 0, panel?.stunDmgMultiplierBonusAlways ?? 0, panel?.stunDmgMultiplierBonusCapAlways ?? 0, true)
      const rows = (calc.damagePoolRows.value ?? []).filter((r: DamagePoolRow) => r.slot === 0)
      const total = calc.teamTotalDamage.value ?? 0
      const slotTotal = rows.reduce((s, r) => s + r.totalDamage, 0)
      // 行级 stunMult 列 = 1 + (Boss失衡易伤 − 1) × stunForThis ⇒ 反推「轴内占比」0/1/中间值
      const fracOf = (m: number) => (vuln - 1) > 0 ? Math.max(0, Math.min(1, (m - 1) / (vuln - 1))) : 0
      console.log(`\n### ${title}`)
      console.log(`  Boss失衡易伤=${vuln} 面板加成 s0=+${panel?.stunDmgMultiplierBonus ?? 0} → 满额生效易伤=${full.toFixed(3)} | 单窗=${calc.windowDuration.value}s | 轴模式=${config.useStunAxis} | 失衡次数池=${(calc.stunPoolResult.value as any)?.stunCount}`)
      for (const ax of config.stunAxes) {
        for (const act of ax.actions) {
          const skills = catalog.getAgentSkills(config.team[act.slot]?.agentId ?? '')
          const mv = findMoveById(skills, act.moveId)
          const mvName = typeof mv?.name === 'string' ? mv.name : (mv?.name as any)?.zhCN ?? ''
          const dur = hugoMoveActionTime(act.moveId, mv?.actionTime ?? 0)
          const ratio = computeInAxisRatio(act.startTime ?? 0, dur, calc.windowDuration.value)
          console.log(`  轴块 s${act.slot} ${act.moveId}${mvName ? '(' + mvName.replace(/（.*）/, '') + ')' : ''} count=${act.count} start=${act.startTime ?? 0}s 时长=${dur.toFixed(3)}s → 窗口内时间占比=${(ratio * 100).toFixed(1)}%`)
        }
      }
      const executed: any[] = Array.isArray((calc.stackTraversalResult.value as any)?.executed)
        ? (calc.stackTraversalResult.value as any).executed
        : Object.values((calc.stackTraversalResult.value as any)?.executed ?? {})
      if (executed.length) console.log('  轴栈实际执行：' + executed.map((e: any) => `s${e?.slot}·${e?.moveId ?? e?.key}×${(e?.count ?? 0).toFixed(2)}`).join(' '))
      const hugoExec = (calc.resourceResult.value?.characters?.[0]?.executions ?? []).filter(e => /1291|hugo/.test(String(e.moveId)))
      if (hugoExec.length) console.log('  资源池雨果执行行：' + hugoExec.map(e => `${e.moveId}×${(e.count ?? 0).toFixed(2)}`).join(' '))
      const bucket = { full: 0, partial: 0, zero: 0, anomaly: 0 }
      for (const r of rows) {
        if (r.type !== '直伤') { bucket.anomaly += r.totalDamage; continue }
        const frac = fracOf(r.stunMult ?? 1)
        const tag = frac >= 0.999 ? '满额' : frac <= 0.001 ? '零  ' : '部分'
        const applied = calcStunMultiplier(vuln, panel?.stunDmgMultiplierBonus ?? 0, panel?.stunDmgMultiplierBonusAlways ?? 0, panel?.stunDmgMultiplierBonusCapAlways ?? 0, frac)
        if (tag === '满额') bucket.full += r.totalDamage
        else if (tag.trim() === '零') bucket.zero += r.totalDamage
        else bucket.partial += r.totalDamage
        const white = HUGO_FULL_STUN_MOVES.has(String(r.moveId))
        console.log(`  ${tag} 轴内占比=${(frac * 100).toFixed(0).padStart(3)}% 生效易伤=${applied.toFixed(3)} | ${r.name.slice(0, 20).padEnd(22)} moveId=${String(r.moveId ?? '-').padEnd(28)} ×${String(r.count.toFixed(2)).padStart(5)} | 白名单=${white ? '是' : '否'} | 占总伤 ${(r.totalDamage / total * 100).toFixed(1)}%${/轴外/.test(r.note) ? ' [轴外段]' : ''}`)
      }
      const pct = (v: number) => `${(v / total * 100).toFixed(1)}%`
      console.log(`  雨果行合计占总伤 ${(slotTotal / total * 100).toFixed(1)}% → 满额 ${pct(bucket.full)} / 部分 ${pct(bucket.partial)} / 零 ${pct(bucket.zero)} / 异常 ${pct(bucket.anomaly)}`)
      console.log(`  （全队总伤 ${(total / 1e6).toFixed(2)}M，队伍 ${config.team.map(c => nameOf(c.agentId)).join('/')}）`)
    }

    report('案例 A：非轴（白名单直给 0/1）', setAxis(null, 0))
    report('案例 B：雨果 0 命轴（双连携 + 强特决算）', setAxis('hugo-c0-e', 0))
    report('案例 C：雨果 2 命轴（双连携 + Q + 决算追加 + E）', setAxis('hugo-c2', 2))
    // 案例 D：「吃一部分」——轴只认领招式的一部分次数：0 命轴 + 追加一个闪反块（每窗 1 次 × 5 窗 = 认领 5 次，
    // 而资源计划里闪反共 10 次）→ 该招式应被切成「轴内 5 次满额 + 轴外 5 次零」两行。
    setAxis('hugo-c0-e', 0)
    config.stunAxes[0].actions.push({ slot: 0, moveId: '1291012', count: 1, startTime: 8 })
    report('案例 D：0 命轴 + 闪反块 count=1（轴认领 5 次 vs 实际 10 次 → 部分）', null)

    expect(true).toBe(true)
  }, 3600000)
})
