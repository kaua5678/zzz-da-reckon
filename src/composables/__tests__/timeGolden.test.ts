/**
 * 时间系统 golden 快照（自顶向下重构·阶段0 等价性脚手架，2026-09-08 立）。
 *
 * 为什么需要它：时间系统重构（单一行模型 → 统一残差 → 单调求解 → 计数投影）**必然**会动
 * 数值（平A时间→回能→次数→伤害）。没有逐队 delta 表，任何重构都只能靠"看起来没变"来赌，
 * 而本仓已经有过两次「重生成基线悄悄吸收别人漂移」的事故。本文件是重构的**唯一验收面**：
 * 每次改时间系统就跑它，差异必须逐条解释（哪队、哪个量、为什么），解释不了的 delta 不许进。
 *
 * 覆盖：127 预设（`teamPresets`，含 applyTeamPreset 的配装/交互）+ 60 角色 × 命座 0/6
 * （`catalog.json` 全角色，走 harness 默认配装）。两者都是全管线真实计算。
 *
 * 口径（改精度前先想清楚）：伤害取整数（百万级，小数无意义）、时间取 3 位、次数取 4 位。
 * 用 `toFixed` 字符串存储 → JSON 可读、diff 稳定、不受浮点末位影响。
 *
 * 用法：
 *   比对（默认）：npx vitest run src/composables/__tests__/timeGolden.test.ts
 *   重生成：TIME_GOLDEN_UPDATE=1 npx vitest run src/composables/__tests__/timeGolden.test.ts
 *   只看某队：TIME_GOLDEN_FILTER=1591 npx vitest run ...
 * **重生成前必须先跑一次比对**，把 delta 表贴进提交说明/账本（本仓纪律：先归因再改基线）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { teamPresets } from '@/data/teamPresets'

const BASELINE_FILE = new URL('./timeGolden.baseline.json', import.meta.url)
const UPDATE = process.env.TIME_GOLDEN_UPDATE === '1'
const FILTER = process.env.TIME_GOLDEN_FILTER ?? ''

const catalogData = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
const agentIds: string[] = (catalogData.agents ?? []).map((a: { id: number | string }) => String(a.id))
const CINEMA_LEVELS = [0, 6] as const

/** 一条快照：伤害 + 时间账 + 逐槽签名（字符串化的定点数，diff 稳定） */
interface GoldenEntry {
  /** 全队总伤害（整数） */
  dmg: string
  /** 失衡次数（池答案） */
  stun: number
  /** 留白 / 超预算（3 位） */
  slack: string
  over: string
  /** 逐槽：ex/ult/chain/basic/nec/front/back */
  slots: string[]
}

function slotSig(c: {
  exSpecialCount?: number; ultimateCount?: number; chainCountTotal?: number
  timeAllocation: { basicAttackTime: number; necessaryTime: number; frontlineTime: number; backstageTime: number }
}): string {
  return [
    (c.exSpecialCount ?? 0).toFixed(4),
    (c.ultimateCount ?? 0).toFixed(4),
    (c.chainCountTotal ?? 0).toFixed(4),
    c.timeAllocation.basicAttackTime.toFixed(3),
    c.timeAllocation.necessaryTime.toFixed(3),
    c.timeAllocation.frontlineTime.toFixed(3),
    c.timeAllocation.backstageTime.toFixed(3),
  ].join('|')
}

/**
 * 逐字段比较两条快照。
 * **判据分级（2026-09-08 实测教训）**：时间/次数（stun/slack/over/逐槽 7 字段）是**硬判据**——
 * 时间系统重构必然动它们，必须逐条解释；`dmg` 是**信息项**——别的会话改倍率/数据（实测
 * 克拉蕾 1611 数据更新）会让它变而时间账不动，那不是时间重构的回归，只报不拦。
 */
function diffEntry(key: string, a: GoldenEntry | undefined, b: GoldenEntry): { fail: string[]; info: string[] } {
  if (!a) return { fail: [`${key}: 新增（baseline 无此条）→ dmg=${b.dmg} slack=${b.slack} over=${b.over} stun=${b.stun}`], info: [] }
  const out: string[] = []
  const info: string[] = []
  const num = (x: string) => Number(x)
  if (a.dmg !== b.dmg) {
    const d = num(b.dmg) - num(a.dmg)
    info.push(`${key}.dmg: ${a.dmg} → ${b.dmg} (${d > 0 ? '+' : ''}${(d / Math.max(1, num(a.dmg)) * 100).toFixed(3)}%)`)
  }
  if (a.stun !== b.stun) out.push(`${key}.stun: ${a.stun} → ${b.stun}`)
  if (a.slack !== b.slack) out.push(`${key}.slack: ${a.slack} → ${b.slack} (${(num(b.slack) - num(a.slack)).toFixed(3)})`)
  if (a.over !== b.over) out.push(`${key}.over: ${a.over} → ${b.over} (${(num(b.over) - num(a.over)).toFixed(3)})`)
  const n = Math.max(a.slots.length, b.slots.length)
  for (let i = 0; i < n; i++) {
    if (a.slots[i] !== b.slots[i]) {
      const [ae, au, ac, ab, an, af, ak] = (a.slots[i] ?? '').split('|')
      const [be, bu, bc, bb, bn, bf, bk] = (b.slots[i] ?? '').split('|')
      const parts: string[] = []
      const cmp = (label: string, x: string, y: string) => {
        if (x !== y) parts.push(`${label} ${x}→${y} (${(Number(y) - Number(x)).toFixed(3)})`)
      }
      cmp('ex', ae, be); cmp('ult', au, bu); cmp('chain', ac, bc)
      cmp('basic', ab, bb); cmp('nec', an, bn); cmp('front', af, bf); cmp('back', ak, bk)
      out.push(`${key}.slot${i}: ${parts.join(', ')}`)
    }
  }
  return { fail: out, info }
}

const baseline: Record<string, GoldenEntry> = (() => {
  try { return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) } catch { return {} }
})()

const measured: Record<string, GoldenEntry> = {}

describe('时间系统 golden 快照（重构等价性验收面）', () => {
  it('127 预设：伤害 / 失衡 / 留白 / 逐槽时间账', async () => {
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    for (const p of presets) {
      if (FILTER && !p.id.includes(FILTER)) continue
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const rr = calc.resourceResult.value
      expect(rr, `${p.id} 无资源结果`).toBeTruthy()
      const t = buildTeamTimeSummary({
        rr: rr!, battleTime: rr!.totalTime,
        invincibleTime: config.enemy.invincibleTime ?? 0,
        nameOf: () => '',
      })
      measured[`preset:${p.id}`] = {
        dmg: String(Math.round(calc.teamTotalDamage.value)),
        stun: calc.stunPoolResult.value?.stunCount ?? 0,
        slack: Math.max(0, t.slack).toFixed(3),
        over: Math.max(0, -t.slack).toFixed(3),
        slots: rr!.characters.map(c => slotSig(c as never)),
      }
    }
    expect(Object.keys(measured).length).toBeGreaterThan(0)
  }, 900_000)

  it('60 角色 × 命座 0/6：伤害 / 逐槽时间账', async () => {
    for (const agentId of agentIds) {
      if (FILTER && !agentId.includes(FILTER)) continue
      for (const cinemaLevel of CINEMA_LEVELS) {
        const { config } = await setupHarness([{ agentId, cinemaLevel }])
        const calc = useResourceCalc()
        const rr = calc.resourceResult.value
        expect(rr, `${agentId} 命座${cinemaLevel} 无资源结果`).toBeTruthy()
        const t = buildTeamTimeSummary({
          rr: rr!, battleTime: rr!.totalTime,
          invincibleTime: config.enemy.invincibleTime ?? 0,
          nameOf: () => '',
        })
        measured[`agent:${agentId}:c${cinemaLevel}`] = {
          dmg: String(Math.round(calc.teamTotalDamage.value)),
          stun: calc.stunPoolResult.value?.stunCount ?? 0,
          slack: Math.max(0, t.slack).toFixed(3),
          over: Math.max(0, -t.slack).toFixed(3),
          slots: rr!.characters.map(c => slotSig(c as never)),
        }
      }
    }
    expect(Object.keys(measured).length).toBeGreaterThan(0)
  }, 900_000)

  it('与 golden 比对（差异必须逐条解释）', () => {
    const keys = Object.keys(measured)
    expect(keys.length, '未采集到任何快照').toBeGreaterThan(0)
    if (UPDATE) {
      const sorted = Object.fromEntries(keys.sort().map(k => [k, measured[k]]))
      writeFileSync(BASELINE_FILE, JSON.stringify({
        _note: '时间系统 golden 快照（阶段0 等价性脚手架）。重生成：TIME_GOLDEN_UPDATE=1 npx vitest run src/composables/__tests__/timeGolden.test.ts —— 重生成前必须先跑比对并把 delta 表贴进账本/提交说明',
        ...sorted,
      }, null, 1) + '\n', 'utf8')
      console.log(`golden 已重生成：${keys.length} 条`)
      return
    }
    const deltas: string[] = []
    const infos: string[] = []
    for (const k of keys) {
      const d = diffEntry(k, baseline[k], measured[k])
      deltas.push(...d.fail)
      infos.push(...d.info)
    }
    for (const k of Object.keys(baseline)) {
      if (k.startsWith('_')) continue
      if (!(k in measured) && !FILTER) deltas.push(`${k}: baseline 有、本次未采集（条目被删/改名？）`)
    }
    if (infos.length > 0) {
      console.log(`[golden 信息项] 伤害变化 ${infos.length} 条（数据/倍率更新，非时间系统回归；时间账零变化）：\n  ${infos.slice(0, 20).join('\n  ')}`)
    }
    expect(deltas, [
      `时间系统数值与 golden 不一致（${deltas.length} 条）。`,
      '处置：① 先确认这是不是你这次改动的**预期**结果；② 逐条写清「哪队/哪个量/为什么变」；',
      '③ 解释不了的 delta 不许改基线，去修代码；④ 确认后才 TIME_GOLDEN_UPDATE=1 重生成。',
      ...deltas.slice(0, 60),
      deltas.length > 60 ? `…（另有 ${deltas.length - 60} 条，见上方口径）` : '',
    ].filter(Boolean).join('\n')).toEqual([])
  }, 120_000)
})
