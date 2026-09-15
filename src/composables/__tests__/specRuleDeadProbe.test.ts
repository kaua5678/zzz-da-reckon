/**
 * 探针：spec 资源规则「声明 implemented 但运行期恒 0」全库体检（剑仪池式缺陷族，2026-09-15 立）。
 *
 * 背景：1401 剑仪池两条 gain 规则声明 status:"implemented"，但三个调用点都没传次数源 ⇒ 恒 0
 * （commit 1de3e47 修复）。本探针把同一形态**在运行期**扫全库：对**每个角色**跑单人队（C0/C6）
 * 再跑全部预设（C0/C1/C2/C6），收集每个角色 specResources 里每条 gain/feedback 规则的实测值，
 * 报告「声明 implemented* 却恒 0」的规则。
 *
 * 为什么运行期而不是静态：模块角色 spec 字段是死数据（AGENTS 规则 4），规则是否真被消费
 * 取决于模块是否调用 computeSpecResources + 是否传得进次数源 ⇒ 只有跑一遍才作数（规则 15）。
 *
 * ⚠ 两个已踩过的探针污染坑（不修就会假报死规则）：
 *   ① **必须复刻 UI 的 preset.interactions → 槽位字段**（TeamConfigPage.onPresetSelect）：
 *      不补这一步，1531 闪反默认 0 ⇒ billy_dodge_determination_gain 被假报恒 0。
 *   ② **必须扫命座档**：C1/C2/C6 门控的规则在 C0 下恒 0 是设计，不是缺陷。
 *   （2026-09-15 首版两条都踩了：10 条「候选」里 8 条是污染，修完只剩 2 条。）
 *
 * 运行：PROBE_SPEC_DEAD=1 npx vitest run src/composables/__tests__/specRuleDeadProbe.test.ts
 * 不设 env 时空跑（普通 vitest run 不受影响）。
 */
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { agentSpecs } from '@/specs/registry'

const active = process.env.PROBE_SPEC_DEAD === '1'

describe.runIf(active)('探针：spec 规则恒 0 全库体检', () => {
  it('全角色单人 + 全预设收集每规则实测值', async () => {
    const declared = new Map<string, { agent: string; res: string; rule: string; kind: string; status: string }>()
    for (const spec of agentSpecs) {
      for (const r of spec.resources ?? []) {
        for (const kind of ['gainRules', 'feedbackGainRules'] as const) {
          for (const rule of (r as any)[kind] ?? []) {
            const key = `${spec.agentIds[0]}/${r.id}/${rule.id ?? '?'}`
            declared.set(key, { agent: spec.agentIds[0], res: r.id, rule: rule.id ?? '?', kind, status: rule.status })
          }
        }
      }
    }
    const seen = new Map<string, number[]>()
    const record = (agentId: string, sr: Record<string, any> | undefined) => {
      if (!sr) return
      for (const [resId, res] of Object.entries(sr)) {
        const gains = (res as any)?.gains as Record<string, number> | undefined
        if (!gains) continue
        for (const [ruleId, val] of Object.entries(gains)) {
          const key = `${agentId}/${resId}/${ruleId}`
          if (!declared.has(key)) continue
          const arr = seen.get(key) ?? []
          arr.push(Number(val) || 0)
          seen.set(key, arr)
        }
      }
    }

    // 每个角色一轮 harness（catalog 只加载一次，复用）
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const applyInteractions = (p: (typeof teamPresets)[number]) => {
      for (const it of p.interactions ?? []) {
        const slot = (it as any).slot ?? 0
        if (it.type === 'parry') config.setParryCount(slot, it.count)
        else if (it.type === 'dodge') config.setDodgeCounterCount(slot, it.count)
        else if (it.type === 'quickAssist') config.setQuickAssistCount(slot, it.count)
        else if (it.type === 'block') config.setBlockCount(slot, it.count)
      }
    }

    // ---- 1. 全角色单人队（C0/C6），覆盖所有不在预设里的角色 ----
    let soloRuns = 0
    for (const spec of agentSpecs) {
      const agentId = spec.agentIds[0]
      for (const cin of [0, 6]) {
        config.setAgent(0, agentId)
        config.setAgent(1, '')
        config.setAgent(2, '')
        ;(config.team[0] as any).cinemaLevel = cin
        const rr = calc.resourceResult.value
        if (!rr) continue
        soloRuns++
        for (const c of rr.characters) record(c.agentId, (c as any).specResources)
      }
    }

    // ---- 2. 全预设（C0/C1/C2/C6）+ interactions ----
    let presetRuns = 0
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    for (const p of presets) {
      for (const cin of [0, 1, 2, 6]) {
        for (let i = 0; i < 3; i++) { config.setAgent(i, p.team[i]); (config.team[i] as any).cinemaLevel = cin }
        config.applyTeamPreset(p.team as [string, string, string])
        applyInteractions(p)
        const rr = calc.resourceResult.value
        if (!rr) continue
        presetRuns++
        for (const c of rr.characters) record(c.agentId, (c as any).specResources)
      }
    }

    const impl = (st: string) => st === 'implemented' || st === 'implemented_approximation'
    const alwaysZero: any[] = []
    const neverObserved: any[] = []
    for (const [key, e] of declared) {
      const vals = seen.get(key)
      if (!vals) { neverObserved.push(e); continue }
      if (Math.max(...vals) <= 0) alwaysZero.push({ ...e, n: vals.length })
    }
    // eslint-disable-next-line no-console
    console.log([
      `【spec 规则恒 0 体检】单人 ${soloRuns} 队 + 预设 ${presetRuns} 队 · 声明规则 ${declared.size} · 观测到 ${seen.size}`,
      ``,
      `=== A. 声明 implemented* 且**至少观测到一次但恒 0**（真·死规则，剑仪池同族）===
${alwaysZero.filter(e => impl(e.status)).map(e => `  ${e.agent} ${e.res}.${e.rule} [${e.kind}] status=${e.status} 观测 ${e.n} 队全 0`).join('\n') || '  （无）'}`,
      ``,
      `=== B. 声明 implemented* 但**整个跑批从未观测到**（模块未消费该资源）===
${neverObserved.filter(e => impl(e.status)).map(e => `  ${e.agent} ${e.res}.${e.rule} [${e.kind}] status=${e.status}`).join('\n') || '  （无）'}`,
      ``,
      `=== C. 非 implemented* 且恒 0（仅参考，不判缺陷）===
${alwaysZero.filter(e => !impl(e.status)).map(e => `  ${e.agent} ${e.res}.${e.rule} status=${e.status}`).join('\n') || '  （无）'}`,
    ].join('\n'))
  }, 1_800_000)
})
