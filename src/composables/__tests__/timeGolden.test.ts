/**
 * 时间系统 golden 快照（自顶向下重构·阶段0 等价性脚手架，2026-09-08 立）。
 *
 * 为什么需要它：时间系统重构（单一行模型 → 统一残差 → 单调求解 → 计数投影）**必然**会动
 * 数值（平A时间→回能→次数→伤害）。没有逐队 delta 表，任何重构都只能靠"看起来没变"来赌，
 * 而本仓已经有过两次「重生成基线悄悄吸收别人漂移」的事故。本文件是重构的**唯一验收面**：
 * 每次改时间系统就跑它，差异必须逐条解释（哪队、哪个量、为什么），解释不了的 delta 不许进。
 *
 * 覆盖：105 预设（`teamPresets` 展开难度变体后；2026-09-11 删 8 条与 auto- 重复的手编预设 127→119，
 *       2026-09-13 成员集合去重（同 3 人换槽位 = 同队）再删 14 条 auto- 重复 → 105）
 *       + 60 角色 × 命座 0/6
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
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
// ⚠ **2026-09-18 round 22：`[0, 6]` → `[0, 3, 6]`**（补真实盲区；R22 熵分诊发现，派活方复现+验收）。
// ⚠ **2026-09-18 round 23：`[0, 3, 6]` → `[0, 3, 4, 6]`**（补 c4；R23 复现 + 反向验证）。
//
// 为什么必须加 c3：通用命座规则是「**3 命技能等级 +2、5 命 +4**」
// （`panelPhases.ts` 两处 `panel.skillLevelBonus = … cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0`），
// 而旧口径只取 `{0, 6}` ⇒ **c3/c4 这两级从未进过任何全局网**。实测（隔离 worktree）：
// 把该式改成 `cinema >= 3 ? 2.5 : 0`（静默数值改动，无类型错误、无 API 变化）⇒ 旧口径下
// `timeGolden` 3 passed + `allAgentsSweep` 125 passed + `cinemaSkillLevel` 12 passed，**三条全绿零告警**。
//
// 为什么还要加 c4（**本轮 R23 实测的结构性证明**）：`{0,3,6}` 的 c3 与 c6 都**跨过**了 4 命，
// 故「只影响 cinema==4」的改动对旧网**完全不可见**。实测：把该式注入成
// `cinema >= 5 ? 4 : cinema >= 4 ? 3 : cinema >= 3 ? 2 : 0`（只改 c4 一档）
// ⇒ 旧口径 `allAgentsSweep` **187 passed**（sweep 只断言不变量，结构上不可能看见它）。
// 加上 c4 后同一条注入 ⇒ `timeGolden` **15 条红**；反向再验 c3（`2 → 2.5`）⇒ **26 条红**。
//
// 口径纠正备注（规则 17②）：这是**扩大测量面**不是放宽判据；两次 baseline delta 都已逐条归因 ——
// c3：228 → 290 条**纯新增**（62 条 `:c3`）；c4：290 → 352 条**纯新增**（62 条 `:c4`，
// `git diff --numstat` = **558 插入 / 0 删除** ⇒ 已有条目零改动零漂移）。
//
// ⚠ **一条残留盲区**（本轮实测，留给后继，别误以为加满命座档就万事大吉）：
// 本文件的 `diffEntry` 把 `dmg` 差异归入 **info（不判红）**，只有 `stun`/`slack`/`over`/`slots`
// 也变了才进 `fail` ⇒ **纯伤害型**回归仍可能静默（上例被抓到正因为时间账同时变了）。
// （若要让纯伤害回归也红，需改 `diffEntry` 的归类口径——那是独立决策，不在本批。）
// ⚠ **c4 的覆盖是「档位采样」不是「全档」**：5 命（`+4`）仍未被单独采样（c6 ≥ 5 会掩盖它）。
//
// ⚠ **2026-09-18 round 24：`[0, 3, 4, 6]` → `[0, 3, 4, 5, 6]`**（补 c5，收掉上面点名的残留盲区）。
// 结构性证明（与 c3/c4 同法，先证旧网**看不见**再证新网能看见）：通用命座式
// `cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0` 只影响 `cinema==5`，而 `{0,3,4,6}` 的 c4 与 c6
// 都**跨过** 5 命 ⇒ 注入 `cinema >= 6 ? 4 : cinema >= 3 ? 2 : 0`（只改 c5 一档）时
// **旧口径 `timeGolden` 3 passed + `allAgentsSweep` 252 passed 全绿**（实测）。
// 加上 c5 后同一条注入 ⇒ 本文件 **30 条红**（`agent:*:c5` 的 stun/slack + 逐槽时间账）。
// 反向再验：c4-only（`>=4?3`）⇒ **15 条红**、c3（`2→2.5`）⇒ **26 条红**（与 R23 记录逐位一致）
// ⇒ 两级既有覆盖未被削弱。
// 口径纠正备注（规则 17②）：这是**扩大测量面**不是放宽判据；baseline delta = 352 → 414 条
// **纯新增**（62 条 `:c5`，`git diff --numstat` = 558 插入 / 0 删除 ⇒ 已有条目零改动零漂移）。
const CINEMA_LEVELS = [0, 3, 4, 5, 6] as const

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
 *
 * **判据分级（2026-09-08 实测教训，2026-09-18 round 26 修订）**：
 * - 时间/次数（`stun`/`slack`/`over`/逐槽 7 字段）恒为**硬判据**——时间系统重构必然动它们，必须逐条解释。
 * - `dmg` 的变化**分级**（R23-N2 实测口径，见下方 `dmgFailEligible`）：
 *   - 若同一快照的**时间账也变了**（`stun`/`slack`/`over`/`slots` 任一）⇒ `dmg` 仍是 **info**。
 *     理由：这类变化本就会因时间字段判红，把 dmg 也塞进 fail 只是把同一批 delta 打两遍
 *     （实测历史 348/484 行 = 72%，对「是否红」零增量）。
 *   - 若**只有 dmg 变**（时间账逐位相同）**且 `public/static/catalog.json` 相对 HEAD 未变**
 *     ⇒ 升级为 **fail**。这正是「只改伤害不改时间账」的静默回归形态（实测 1111/1241 元素翻回时
 *     全库 300+ 例零红）。
 *   - 若**只有 dmg 变**但本次改动**确实改了 catalog** ⇒ 仍是 **info**（有意的数据订正；
 *     实测历史 136 行 A 类里 119 行属改 catalog 的提交，逐条都在提交说明里归因过）。
 *
 * ⚠ **已知残留盲区（结构性代价，不是缺陷）**：`catalog.json` 是**整文件**判据，
 * 分不清「这次提交改的是哪个角色」。故「同一次既改 catalog 又引入真实伤害回归」会被放过。
 * 完备解在 **catalog 侧字段级判据**（如判据 18 招式属性对账），不在本文件。
 *
 * ⚠ **为什么用 git 判 catalog 而不是文件 mtime/内容 hash**：`catalog.json` 在两个隔离面上
 * 本来就与 HEAD 不同（重生成产物、行尾/紧凑写），用内容比对会**恒判"变了"⇒ 判据永久失效**
 * （这是本仓反复踩过的"假绿反面：恒红即等于关掉"）。故判据 = **该文件相对 HEAD 是否 dirty**。
 */
export function diffEntry(
  key: string,
  a: GoldenEntry | undefined,
  b: GoldenEntry,
  dmgFailEligible = false,
): { fail: string[]; info: string[] } {
  if (!a) return { fail: [`${key}: 新增（baseline 无此条）→ dmg=${b.dmg} slack=${b.slack} over=${b.over} stun=${b.stun}`], info: [] }
  const out: string[] = []
  const info: string[] = []
  const num = (x: string) => Number(x)
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
  if (a.dmg !== b.dmg) {
    const d = num(b.dmg) - num(a.dmg)
    const line = `${key}.dmg: ${a.dmg} → ${b.dmg} (${d > 0 ? '+' : ''}${(d / Math.max(1, num(a.dmg)) * 100).toFixed(3)}%)`
    // 时间账逐位相同（out 为空）且本次未动 catalog ⇒ 纯伤害回归，判红
    if (dmgFailEligible && out.length === 0) {
      out.push(`${line} ← 时间账零变化且 catalog.json 未改动 ⇒ 纯伤害回归（R23-N2 口径）`)
    } else {
      info.push(line)
    }
  }
  return { fail: out, info }
}

const baseline: Record<string, GoldenEntry> = (() => {
  try { return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) } catch { return {} }
})()

/**
 * 本次改动是否动过 `public/static/catalog.json`（相对 HEAD 是否 dirty）。
 *
 * 这是 R23-N2 口径的第二个合取项：只有「dmg 变 ∧ 时间账未变 ∧ **未改 catalog**」才判红
 * （实测把历史噪声 136 行压到 17 行，−87.5%，且放过的全是提交说明里已归因的有意数据订正）。
 *
 * ⚠ **非 git 环境（zip 解包 / 无 .git）**：`git status` 会抛 ⇒ 返回 `true`（**偏向不判红**）。
 * 诚实性：这条判据的价值是「在真实开发/CI 流程里拦住纯伤害回归」，而 CI 一定是 git checkout
 * ⇒ 降级只影响"把仓库打包后手动跑测试"这种非判据场景。**方向是保守的**（宁可不红也不误报），
 * 且 `dmg` 仍以 info 打印、时间账判据完全不受影响。
 */
export function catalogDirtyVsHead(): boolean {
  try {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
    const out = execFileSync('git', ['status', '--porcelain', '--', 'public/static/catalog.json'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim().length > 0
  } catch {
    return true // 非 git 环境 ⇒ 不启用纯伤害 fail（保守）
  }
}

const measured: Record<string, GoldenEntry> = {}

describe('时间系统 golden 快照（重构等价性验收面）', () => {
  it('105 预设：伤害 / 失衡 / 留白 / 逐槽时间账', async () => {
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
    // R23-N2：仅当本次未改 catalog 时，才把「纯 dmg 变化（时间账零变化）」升级为 fail。
    const catalogDirty = catalogDirtyVsHead()
    if (!catalogDirty) {
      console.log('[golden] catalog.json 未改动 ⇒ 启用 R23-N2 纯伤害回归判据（dmg 变 ∧ 时间账零变化 ⇒ fail）')
    }
    for (const k of keys) {
      const d = diffEntry(k, baseline[k], measured[k], !catalogDirty)
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

/**
 * `diffEntry` 的归类判据单测（R23-N2）。
 * 这些是**纯函数**用例：不跑引擎、不依赖 goldens，专门钉住「哪一侧判红」这件事。
 * ⚠ 存在理由：本判据的失效形态是**静默的**——若 `dmgFailEligible` 被写反/被短路，
 * 端到端跑仍是绿的（因为当前 HEAD 上 dmg delta 恰好为 0），没有任何测试会红。
 */
describe('diffEntry 归类（R23-N2：dmg → fail 的两侧判据）', () => {
  const base: GoldenEntry = {
    dmg: '1000', stun: 3, slack: '1.000', over: '0.000',
    slots: ['1.0000|2.0000|0.0000|10.000|20.000|30.000|40.000'],
  }
  const onlyDmg: GoldenEntry = { ...base, dmg: '1200' }
  const dmgAndTime: GoldenEntry = { ...base, dmg: '1200', stun: 4 }

  it('① 纯 dmg 变化 + 未改 catalog ⇒ fail（这就是要拦的静默回归）', () => {
    const r = diffEntry('k', base, onlyDmg, true)
    expect(r.fail.join('\n')).toContain('k.dmg')
    expect(r.info).toEqual([])
  })

  it('② 纯 dmg 变化 + 改了 catalog ⇒ info（有意的数据订正，不拦）', () => {
    const r = diffEntry('k', base, onlyDmg, false)
    expect(r.fail).toEqual([])
    expect(r.info.join('\n')).toContain('k.dmg')
  })

  it('③ dmg 变 + 时间账也变 + 未改 catalog ⇒ dmg 仍走 info（不重复判红）', () => {
    const r = diffEntry('k', base, dmgAndTime, true)
    expect(r.fail.join('\n')).toContain('k.stun')
    expect(r.fail.join('\n')).not.toContain('.dmg')
    expect(r.info.join('\n')).toContain('k.dmg')
  })

  it('④ 时间账变化恒为 fail（与 dmg 口径无关）——防止改造削弱既有判据', () => {
    const r = diffEntry('k', base, { ...base, stun: 5 }, false)
    expect(r.fail.join('\n')).toContain('k.stun')
  })

  it('⑤ 新增条目恒为 fail（不加门控，原有语义不退化）', () => {
    expect(diffEntry('k', undefined, onlyDmg, false).fail.join('\n')).toContain('新增')
    expect(diffEntry('k', undefined, onlyDmg, true).fail.join('\n')).toContain('新增')
  })

  it('⑥ 逐槽时间变化也算「时间账变了」⇒ dmg 不升级为 fail', () => {
    const slotMoved: GoldenEntry = {
      ...base, dmg: '1200',
      slots: ['1.0000|2.0000|0.0000|11.000|20.000|30.000|40.000'],
    }
    const r = diffEntry('k', base, slotMoved, true)
    expect(r.fail.join('\n')).toContain('.slot0')
    expect(r.fail.join('\n')).not.toContain('.dmg')
  })
})
