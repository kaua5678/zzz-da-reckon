/**
 * 派派（1281）—— 动力与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1281.json。
 * 用户口径 2026-08-26：动力默认一直满（平A回能 + 强特耗能，很容易续上——一开始转满，后面点一下就能续），
 * 所以动力恒为满层，不用管旋转命中次数。影画2 增伤 = 10% + 满层动力（C0 20层=30%、影画1 30层=40%）。
 * - 核心：每层动力物理异常积蓄效率 +4%，满层恒生效。
 * - 强特（引擎转）：先持续耗能 20/秒、末段下砸耗能 20；通常秒接下砸（耗能慢），能量太多才长按——不影响动力满层口径。
 * - C1：动力上限 20→30（额外 50% 动力不影响，因为恒满）。
 * - C2：有亿点重、非常重、终结下砸物理增伤 10%+满层动力（恒 30%/40%）。
 * - C4：队伍触发属性异常回 20 能量，30 秒 CD；整局由可调触发次数注入能量池。
 * - C6：动力持续 12→16 秒（仅记录）；引擎转时长 +2 秒不伪造额外命中。
 *
 * 2026-09-01 用户裁决（派派 150 条投稿里 149 条是 M6，恒满近似三处同时顶满），口径改为：
 *   ① 物理积蓄只有**开局启动那段**是逐层积累，之后全满 → 整局平均≈满覆盖，默认 100%；
 *   ② 影画2 增伤仍按**满层**——起手转满后就保持住；
 *   ③ 终结技只有 **30% 倍率是下砸**，按占比折算（增伤区加算 ⇒ 折算精确）；
 *   ④ 全队 18% 覆盖率接近 100%，保持默认，用户可在队友 buff 覆盖率里自调；
 *   ⑤ 影画3/5 技能等级 +2/+4 **已由通用规则建模**（resourceCalc/helpers.ts 的 agentHasCinemaSkillLevelBuff 分支），模块不重复实现。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'

export const PIPER_ID = '1281'
export const PIPER_C2_BASE_DMG = 10
export const PIPER_C4_ENERGY = 20
export const PIPER_C4_CD = 30
export const PIPER_C2_MOVE_IDS = new Set(['1281006', '1281007', '1281008', '1281009', '1281014'])

export interface PiperMomentumCycle {
  cinemaLevel: number
  cap: number
  /** 满层层数（影画2 增伤用：起手转满后就保持满层） */
  stacks: number
  /** 积蓄侧的**平均**层数（动力要慢慢积累，整局平均只吃到覆盖率那一档） */
  buildupStacks: number
  /** 积蓄侧覆盖率（默认 0.6，用户 2026-09-01 裁决） */
  buildupCoverage: number
  durationSeconds: number
  note: string
}

/**
 * 积蓄侧默认覆盖率 = 100%（用户 2026-09-01 二次澄清：**只有开局启动那段是逐层**，之后全满，
 * 整局平均非常接近满覆盖）。滑块保留：想显式建模开局爬坡、或做敏感性对照时调低即可。
 */
export const PIPER_BUILDUP_COVERAGE_DEFAULT = 1

/**
 * 影画2 下砸占比：原文限「下砸攻击命中时」，而执行行是整招合并行。
 * 增伤区是**加算**的（用户 2026-09-01：所有描述都应落实在乘区，他是增伤区加算），
 * 所以「只有 30% 倍率吃 +B」等价于「整行吃 +B×0.3」——占比折算是精确换算，不是近似。
 * 终结技（1281014）只有 30% 倍率是下砸；有亿点重/非常重本身就是下砸招式，整行计。
 */
export const PIPER_C2_MOVE_WEIGHTS: Record<string, number> = { '1281014': 0.3 }

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = (cfg as unknown as Record<string, unknown>)[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// @fact agent:1281/动力 口径: 积蓄与影画2 拆成两条通道，均默认满层——只有开局启动那段逐层，整局平均≈满覆盖；滑块 piper.momentumCoverage 可显式建模爬坡 | 据 用户@2026-09-01 | 验 src/mechanics/__tests__/piper.test.ts | 锚 src/mechanics/agents/piper.ts#computePiperMomentum | 信 确认
// @fact agent:1281/影画2 口径: 终结技(1281014)只有30%倍率是下砸，按占比折算增伤；增伤区加算 ⇒ 占比折算是精确换算而非近似 | 据 用户@2026-09-01 | 验 src/mechanics/__tests__/piper.test.ts | 锚 src/mechanics/agents/piper.ts#PIPER_C2_MOVE_WEIGHTS | 信 确认

/**
 * 动力层数。默认满层（用户口径：平A回能+强特耗能容易续，一开始转满后面点一下续，不用管命中次数）；
 * coverage < 1 时按 round(cap × coverage) 折算 —— 这是做「爬坡/掉层」对照实验的唯一入口。
 */
export function computePiperMomentum(input: { cinemaLevel: number; buildupCoverage?: number }): PiperMomentumCycle {
  const cinema = Math.max(0, Math.floor(input.cinemaLevel))
  const cap = cinema >= 1 ? 30 : 20
  const coverage = Math.max(0, Math.min(1,
    Number.isFinite(input.buildupCoverage) ? (input.buildupCoverage as number) : PIPER_BUILDUP_COVERAGE_DEFAULT))
  const buildupStacks = Math.max(0, Math.min(cap, Math.round(cap * coverage)))
  return {
    cinemaLevel: cinema,
    cap,
    stacks: cap,
    buildupStacks,
    buildupCoverage: coverage,
    durationSeconds: cinema >= 6 ? 16 : 12,
    note: '影画2增伤按满层 ' + cap + ' 层；物理积蓄按覆盖率 ' + Math.round(coverage * 100) + '%（' + buildupStacks + ' 层）——只有开局启动那段逐层，之后全满。',
  }
}

function buildPiperCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.piperCinemaLevel = cinemaLevel
  record.piperMomentumCoverage = cfgSetting(cfg, 'piper.momentumCoverage', PIPER_BUILDUP_COVERAGE_DEFAULT)
  if (cinemaLevel >= 4) {
    const maxTriggers = Math.max(1, Math.ceil((cfg.battleTime ?? 180) / PIPER_C4_CD))
    const triggers = Math.min(maxTriggers, Math.max(0, Math.floor(cfgSetting(cfg, 'piper.c4AnomalyTriggers', 1))))
    cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + triggers * PIPER_C4_ENERGY
    record.piperC4AnomalyTriggers = triggers
  }
}

function cycleFromInput({ cfg }: Pick<AgentResourceInput, 'cfg' | 'state'>): PiperMomentumCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computePiperMomentum({
    cinemaLevel: Number(record.piperCinemaLevel ?? 0),
    buildupCoverage: Number(record.piperMomentumCoverage ?? PIPER_BUILDUP_COVERAGE_DEFAULT),
  })
}

function buildPiperResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { piper_momentum: cycleFromInput({ cfg, state }) } }
}

function applyPiperPanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  if (!panel) return
  // 面板级机制走 applyPanel（文档化通道，corin 历史缺陷同款：transformSkillExecutions 改写 panel
  // 会在收敛轮间对同一缓存面板对象 `+=` 累积——曾致物理积蓄效率 80%×20轮=1600%，物理积蓄 28.9 万、
  // 派派校准反向高估 +18652）。applyPanel 每次面板重算都是新对象，`+=` 不累积。
  const coverage = Math.max(0, Math.min(1, Number(settings?.['piper.momentumCoverage']
    ?? PIPER_BUILDUP_COVERAGE_DEFAULT)))
  const cap = cinemaLevel >= 1 ? 30 : 20
  // 积蓄侧吃「平均层数」，影画2 侧吃「满层」——两条通道口径不同，别合并（用户 2026-09-01）
  const buildupStacks = Math.max(0, Math.min(cap, Math.round(cap * coverage)))
  panel.physicalAnomalyBuildUpEfficiency = (panel.physicalAnomalyBuildUpEfficiency ?? 0) + buildupStacks * 4
  panel.piperMomentumStacks = cap
}

function patchPiperExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.cinemaLevel < 2) return
  const bonus = PIPER_C2_BASE_DMG + cycle.stacks
  for (const exec of executions) {
    if (!exec.moveId || !PIPER_C2_MOVE_IDS.has(exec.moveId)) continue
    const weight = PIPER_C2_MOVE_WEIGHTS[exec.moveId] ?? 1
    exec.dmgBonus = (exec.dmgBonus ?? 0) + bonus * weight
  }
}

function buildPiperResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.piper_momentum as PiperMomentumCycle | undefined
  if (!cycle) return []
  return [{
    id: 'piper-momentum',
    title: '派派·动力',
    summary: `动力 ${cycle.stacks} / ${cycle.cap}（恒满） · 物理积蓄 +${cycle.stacks * 4}%`,
    rows: [
      { label: '动力层数', value: `${cycle.stacks} 层`, detail: '默认一直满（平A回能+强特耗能易续，不用管命中次数）' },
      { label: '影画2下砸增伤', value: `+${PIPER_C2_BASE_DMG + cycle.stacks}%`, detail: `10% + 满层动力 ${cycle.stacks} 层，恒满` },
      { label: '动力持续', value: `${cycle.durationSeconds}秒`, detail: cycle.cinemaLevel >= 6 ? '影画6：基础12秒+4秒' : '基础持续12秒' },
    ],
    footer: cycle.note,
  }]
}

export const piperMechanic: AgentMechanicModule = {
  id: 'agent:piper',
  agentIds: [PIPER_ID],
  name: '派派·动力蓄能',
  description: '动力循环（默认满层）、物理异常积蓄、C2下砸增伤、C4异常回能。',
  settings: [
    { id: 'piper.momentumCoverage', label: '动力积蓄覆盖率', description: '物理积蓄效率吃到的平均动力层数占比（默认 100%：只有开局启动那段逐层，之后全满）；影画2 增伤不受此项影响，恒按满层', default: PIPER_BUILDUP_COVERAGE_DEFAULT, min: 0, max: 1, step: 0.05 },
    { id: 'piper.c4AnomalyTriggers', label: '影画4异常触发', description: '全队触发属性异常并满足30秒冷却的次数', default: 1, min: 0, max: 6, step: 1, suffix: '次' },
  ],
  buildCharConfig: buildPiperCharConfig,
  applyPanel: applyPiperPanel,
  buildResourceResult: buildPiperResourceResult,
  patchExecutions: patchPiperExecutions,
  resourceSections: buildPiperResourceSections,
}

export default piperMechanic
