/**
 * 倍率表系数演算引擎 —— 把每个角色实际录入的倍率表与「标准职业稀有度倍率表」
 * （@/data/standardMultiplierTable）对比，推导四类结果：
 *   1. 角色纵向系数（每列跨招式中位数，如爱丽丝失衡 0.90、伊德海莉喧响 ~0.49）
 *   2. 版本直伤系数（支援突击伤害列比值——支援突击通常不随角色变化，作全队锚点）
 *   3. 招式特定偏差（单招式比值 vs 本角色该列基准：连携增强/大招削弱一类设计空间）
 *   4. 快速支援时间校准清单（actionTime 存疑时用喧响基准 27.5/s 反推有效 t）
 *
 * 纯函数：输入 catalog 原始数组、输出类型化报告，页面（MultiplierCoeffPage）与测试共用同一实现。
 * 聚合口径：纵向系数只取「干净类型」——排除强化特殊技（逐角色设计空间大）、轻/重招架
 * （标准常数与数据存在恒定 ~10% 出入，待确认）与未分类招式；中位数天然抗个别脏行。
 */
import type { Agent, AgentSkills, SkillMove } from '@/types/catalog'
import {
  DECIBEL_PER_SECOND,
  FLASH_ENERGY_QUALITY,
  MOVE_TYPE_LABELS,
  MOVE_TYPE_OVERRIDES,
  STANDARD_MULTIPLIER_TABLE,
  STANDARD_ROW_IDS,
  STANDARD_S_AGENT_IDS,
  getRarityMultiplier,
  type MoveType,
  type StandardRowId,
} from '@/data/standardMultiplierTable'
import { LEVEL1_TO_LEVEL12 } from '@/core/skillLevel'
import { AGENT_RELEASE_NODE, VERSION_NODES, nodeIndexOf } from '@/data/versionTimeline'

/** actionTime 低于此值视为录入噪声（0 / 0.001 的子段行），不参与期望值计算 */
const MIN_ACTION_TIME = 0.01

/** 招式特定偏差判定阈值：偏离本角色列基准 ±5% 记一条 */
const DEVIATION_THRESHOLD = 0.05

/** 时间校准判定阈值：喧响反推 t 与 actionTime 相对偏差 >15% 记一条 */
const CALIBRATION_THRESHOLD = 0.15

/** 参与纵向系数聚合的招式类型白名单（其余为设计空间/待确认口径） */
export function isCleanVerticalType(moveType: MoveType | 'other'): boolean {
  return moveType !== 'exSpecial' && moveType !== 'parryLight' && moveType !== 'parryHeavy' && moveType !== 'other'
}

/** 招式分类：定点覆盖 + 名称前缀 + 类别 + timeType + energyCost + 职业 → 标准表行单位 */
export function classifyMove(move: SkillMove, categoryId: string, specialty: string): MoveType | 'other' {
  const override = MOVE_TYPE_OVERRIDES[move.id]
  if (override) return override
  const name = move.name?.zhCN ?? ''
  if (move.timeType === 'ultimate' || name.includes('终结')) {
    if (specialty === 'stun') return 'ultimateStun'
    if (specialty === 'anomaly') return 'ultimateAnomaly'
    return 'ultimateAttack'
  }
  switch (categoryId) {
    case 'chain':
      return 'chain'
    case 'dodge':
      if (name.startsWith('闪避反击')) return 'dodgeCounter'
      if (name.startsWith('冲刺攻击')) return 'dashAttack'
      return 'other'
    case 'assist':
      if (name.startsWith('支援突击')) return 'assistFollowUp'
      if (name.startsWith('快速支援')) return 'quickAssist'
      if (name.startsWith('招架支援')) {
        const part = name.match(/#(\d+)/)?.[1]
        if (part === '3') return 'parryChain'
        if (part === '1') return 'parryLight'
        return 'parryHeavy'
      }
      return 'other'
    case 'special':
      // 有耗能标注或名称即「强化特殊技」都算强特（真斗等角色 catalog 未录耗能，靠名称兜底）
      return move.energyCost || name.startsWith('强化特殊技') ? 'exSpecial' : 'special'
    case 'basic':
      if ((move.skillTags ?? []).includes('dashAttack') || name.includes('冲刺')) return 'dashAttack'
      return 'basic'
    default:
      return 'other'
  }
}

/** 耗能信息：kind 区分普通能量与闪能（闪能质量 ×1.2，见 standardMultiplierTable.FLASH_ENERGY_QUALITY） */
export interface EnergyCostInfo {
  value: number
  kind: 'energy' | 'flashEnergy'
}

/** 解析 energyCost：取首个非持续（无 /s、/sec 后缀）项的数值前缀；解析失败返回 null */
export function parseEnergyCost(move: SkillMove): EnergyCostInfo | null {
  for (const [key, value] of Object.entries(move.energyCost ?? {})) {
    if (/\/s|\/sec/.test(value)) continue
    const m = value.match(/^\d+(\.\d+)?/)
    if (m) return { value: Number(m[0]), kind: key.includes('Flash') ? 'flashEnergy' : 'energy' }
  }
  return null
}

/** 内部中间单元：一段一单元（强化特殊技逐段评估，耗能分摊方式因角色而异，见页面待确认口径） */
interface RawUnit {
  agentId: string
  agentName: string
  rarity: string
  specialty: string
  moveId: string
  moveName: string
  moveType: MoveType | 'other'
  t: number | null
  energy: EnergyCostInfo | null
  values: Partial<Record<StandardRowId, number>>
  flags: string[]
}

/** 去掉结尾的「 #N」段号（分段合并分组键） */
function stripPartSuffix(name: string): string {
  return name.replace(/\s*#\d+$/, '')
}

function rowValuesById(move: SkillMove): Partial<Record<StandardRowId, number>> {
  const out: Partial<Record<StandardRowId, number>> = {}
  for (const rowId of STANDARD_ROW_IDS) {
    const v = move.rows.find((r) => r.id === rowId)?.values[0]
    if (typeof v === 'number') out[rowId] = v
  }
  return out
}

function collectUnits(agent: Agent, skills: AgentSkills): RawUnit[] {
  const units: RawUnit[] = []
  for (const category of skills.categories) {
    for (const move of category.moves) {
      const moveType = classifyMove(move, category.id, agent.specialty)
      if (moveType === 'other') continue
      const energy = parseEnergyCost(move)
      const flags: string[] = []
      if (moveType === 'exSpecial' && energy == null) flags.push('缺耗能标注')
      if (moveType === 'exSpecial' && energy?.kind === 'flashEnergy') flags.push('闪能消耗(质量×1.2)')
      units.push({
        agentId: String(agent.id),
        agentName: agent.name.zhCN ?? agent.id,
        rarity: agent.rarity,
        specialty: agent.specialty,
        moveId: move.id,
        moveName: move.name?.zhCN ?? move.id,
        moveType,
        t: typeof move.actionTime === 'number' ? move.actionTime : null,
        energy,
        values: rowValuesById(move),
        flags,
      })
    }
  }

  // 支援突击的「#N」分段是同一套招式的分段，标准式前缀项只计一次：按去段号名称合并后再评估。
  // 实证：苍角「席卷打击 #1+#2」合并后伤害/失衡/喧响三列比值 ≈1.000（分段单算各 88.7%/59.2%，
  // 会把直伤锚点拖到 0.74）。例外见待确认口径：真斗「孤影·断獠」合并后伤害≈1.02 但失衡/喧响仍偏离。
  const merged = new Map<string, RawUnit>()
  const out: RawUnit[] = []
  for (const unit of units) {
    if (unit.moveType !== 'assistFollowUp' || !/ #\d+$/.test(unit.moveName)) {
      out.push(unit)
      continue
    }
    const key = `${unit.agentId}/${stripPartSuffix(unit.moveName)}`
    const head = merged.get(key)
    if (!head) {
      merged.set(key, unit)
      out.push(unit)
      continue
    }
    head.t = (head.t ?? 0) + (unit.t ?? 0)
    for (const [rowId, v] of Object.entries(unit.values)) {
      head.values[rowId as StandardRowId] = (head.values[rowId as StandardRowId] ?? 0) + (v ?? 0)
    }
    head.moveName = stripPartSuffix(head.moveName)
    head.flags.push('支援突击分段已合并')
  }
  return out
}

/** 等级系数：标准表按 1 级记录，catalog 录 12 级单值 */
function levelMultiplier(rowId: StandardRowId): number {
  if (rowId === 'damage') return LEVEL1_TO_LEVEL12.damage
  if (rowId === 'daze') return LEVEL1_TO_LEVEL12.daze
  return 1
}

export interface MoveCellEval {
  rowId: StandardRowId
  /** catalog 实际录入值（Lv12） */
  actual: number
  /** 标准表期望值（含等级/稀有度/命破系数） */
  expected: number
  /** 实际/期望，即该格的角色系数表现 */
  ratio: number
}

export interface MoveEval {
  agentId: string
  agentName: string
  rarity: string
  specialty: string
  moveId: string
  moveName: string
  moveType: MoveType | 'other'
  moveTypeLabel: string
  t: number | null
  energy: EnergyCostInfo | null
  flags: string[]
  cells: MoveCellEval[]
}

function evaluateUnit(unit: RawUnit): MoveEval {
  const cells: MoveCellEval[] = []
  const table = unit.moveType === 'other' ? undefined : STANDARD_MULTIPLIER_TABLE[unit.moveType]
  const t = unit.t != null && unit.t > MIN_ACTION_TIME ? unit.t : null
  for (const rowId of STANDARD_ROW_IDS) {
    const formula = table?.[rowId]
    const actual = unit.values[rowId]
    if (!formula || actual == null || actual <= 0) continue
    if (t == null) continue
    const eFactor = unit.energy?.kind === 'flashEnergy' ? FLASH_ENERGY_QUALITY : 1
    const std = (formula.const ?? 0) + (formula.perT ?? 0) * t + (formula.perE ?? 0) * (unit.energy?.value ?? 0) * eFactor
    const expected = std * levelMultiplier(rowId) * getRarityMultiplier(unit.rarity, unit.agentId, unit.specialty, rowId)
    if (expected <= 0) continue
    cells.push({ rowId, actual, expected, ratio: actual / expected })
  }
  return {
    agentId: unit.agentId,
    agentName: unit.agentName,
    rarity: unit.rarity,
    specialty: unit.specialty,
    moveId: unit.moveId,
    moveName: unit.moveName,
    moveType: unit.moveType,
    moveTypeLabel: unit.moveType === 'other' ? '未分类' : MOVE_TYPE_LABELS[unit.moveType],
    t: unit.t,
    energy: unit.energy,
    flags: [...unit.flags],
    cells,
  }
}

export interface VerticalCoefficient {
  value: number
  samples: number
}

export interface AgentVerticalRow {
  agentId: string
  agentName: string
  rarity: string
  specialty: string
  /** 各资源列纵向系数（干净类型比值中位数）；damage 列不进纵向（普攻分段等噪声大），直伤看 directDamage */
  coefficients: Partial<Record<StandardRowId, VerticalCoefficient>>
  /** 版本直伤系数 = 支援突击伤害列比值（锚点列，通常为 1） */
  directDamage: VerticalCoefficient | null
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function buildVertical(moves: MoveEval[]): AgentVerticalRow[] {
  const byAgent = new Map<string, MoveEval[]>()
  for (const m of moves) {
    const list = byAgent.get(m.agentId) ?? []
    list.push(m)
    byAgent.set(m.agentId, list)
  }

  const rows: AgentVerticalRow[] = []
  for (const [agentId, list] of byAgent) {
    const head = list[0]
    const coefficients: Partial<Record<StandardRowId, VerticalCoefficient>> = {}
    for (const rowId of STANDARD_ROW_IDS) {
      if (rowId === 'damage') continue
      const ratios = list
        .filter((m) => isCleanVerticalType(m.moveType))
        .flatMap((m) => m.cells.filter((c) => c.rowId === rowId).map((c) => c.ratio))
      if (ratios.length) coefficients[rowId] = { value: median(ratios), samples: ratios.length }
    }
    const ddRatios = list
      .filter((m) => m.moveType === 'assistFollowUp')
      .flatMap((m) => m.cells.filter((c) => c.rowId === 'damage').map((c) => c.ratio))
    rows.push({
      agentId,
      agentName: head.agentName,
      rarity: head.rarity,
      specialty: head.specialty,
      coefficients,
      directDamage: ddRatios.length ? { value: median(ddRatios), samples: ddRatios.length } : null,
    })
  }
  return rows.sort((a, b) => a.agentId.localeCompare(b.agentId))
}

export interface MoveDeviation {
  agentId: string
  agentName: string
  moveId: string
  moveName: string
  moveTypeLabel: string
  rowId: StandardRowId
  /** 该招式该列的实际比值 */
  ratio: number
  /** 本角色该列纵向系数（基准） */
  baseline: number
  /** ratio / baseline，>1 增强、<1 削弱 */
  deviation: number
}

function buildDeviations(moves: MoveEval[], vertical: AgentVerticalRow[]): MoveDeviation[] {
  const baseByAgent = new Map(vertical.map((v) => [v.agentId, v]))
  const out: MoveDeviation[] = []
  for (const m of moves) {
    if (!isCleanVerticalType(m.moveType)) continue
    const base = baseByAgent.get(m.agentId)
    if (!base) continue
    for (const cell of m.cells) {
      if (cell.rowId === 'damage') continue
      const baseline = base.coefficients[cell.rowId]?.value
      if (baseline == null || baseline <= 0) continue
      const deviation = cell.ratio / baseline
      if (Math.abs(deviation - 1) > DEVIATION_THRESHOLD) {
        out.push({
          agentId: m.agentId,
          agentName: m.agentName,
          moveId: m.moveId,
          moveName: m.moveName,
          moveTypeLabel: m.moveTypeLabel,
          rowId: cell.rowId,
          ratio: cell.ratio,
          baseline,
          deviation,
        })
      }
    }
  }
  return out
}

export interface TimeCalibrationItem {
  agentId: string
  agentName: string
  moveId: string
  moveName: string
  tAction: number
  /** 喧响反推的有效时间 = 喧响实际值 / 27.5 */
  tDecibel: number
}

function buildCalibrations(moves: MoveEval[]): TimeCalibrationItem[] {
  const out: TimeCalibrationItem[] = []
  for (const m of moves) {
    if (m.moveType !== 'quickAssist' || m.t == null || m.t <= MIN_ACTION_TIME) continue
    const decibel = m.cells.find((c) => c.rowId === 'decibel_recovery')?.actual
    if (decibel == null) continue
    const tDecibel = decibel / DECIBEL_PER_SECOND
    if (Math.abs(tDecibel - m.t) / m.t > CALIBRATION_THRESHOLD) {
      out.push({ agentId: m.agentId, agentName: m.agentName, moveId: m.moveId, moveName: m.moveName, tAction: m.t, tDecibel })
    }
  }
  return out
}

export interface CoefficientReport {
  vertical: AgentVerticalRow[]
  moves: MoveEval[]
  deviations: MoveDeviation[]
  calibrations: TimeCalibrationItem[]
}

/** 演算总入口：catalog 原始数组 → 系数报告（纯函数） */
export function deriveCoefficientReport(agents: Agent[], agentSkillsList: AgentSkills[]): CoefficientReport {
  const agentMap = new Map(agents.map((a) => [String(a.id), a]))
  const units: RawUnit[] = []
  for (const skills of agentSkillsList) {
    const agent = agentMap.get(String(skills.agentId))
    if (!agent || agent.isTeammateOnly) continue
    units.push(...collectUnits(agent, skills))
  }
  const moves = units.map(evaluateUnit)
  const vertical = buildVertical(moves)
  return {
    vertical,
    moves,
    deviations: buildDeviations(moves, vertical),
    calibrations: buildCalibrations(moves),
  }
}

export interface DirectDamagePoint {
  agentId: string
  agentName: string
  nodeId: string
  nodeLabel: string
  nodeIndex: number
  /** 版本节点备注（如 3.2 测试服标注） */
  nodeNote?: string
  /** 版本直伤系数（支援突击伤害比值）；无支援突击样本的角色为 null */
  value: number | null
}

/**
 * 限定S「首次 UP 版本 × 版本直伤系数（支援突击锚点）」散点，按节点序排序。
 * 常驻 S 不参与（无 UP 概念）；A 级不参与（非限定金）。时间图表页的直伤系数图用。
 */
export function buildDirectDamageTimeline(agents: Agent[], agentSkillsList: AgentSkills[]): DirectDamagePoint[] {
  const report = deriveCoefficientReport(agents, agentSkillsList)
  const nodeById = new Map(VERSION_NODES.map((n) => [n.id, n]))
  return report.vertical
    .filter((v) => v.rarity === 'S' && !STANDARD_S_AGENT_IDS.has(v.agentId))
    .flatMap((v) => {
      const nodeId = AGENT_RELEASE_NODE[v.agentId]
      if (!nodeId) return []
      const node = nodeById.get(nodeId)
      return [
        {
          agentId: v.agentId,
          agentName: v.agentName,
          nodeId,
          nodeLabel: node?.label ?? nodeId,
          nodeIndex: nodeIndexOf(nodeId),
          nodeNote: node?.note,
          value: v.directDamage?.value ?? null,
        },
      ]
    })
    .sort((a, b) => a.nodeIndex - b.nodeIndex || a.agentId.localeCompare(b.agentId))
}
