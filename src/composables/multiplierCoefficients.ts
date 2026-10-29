/**
 * 倍率表系数演算引擎 —— 把每个角色实际录入的倍率表与「标准职业稀有度倍率表」
 * （@/data/standardMultiplierTable）对比，推导三类结果：
 *   1. 角色纵向系数（每列跨招式中位数，如爱丽丝失衡 0.90、伊德海莉喧响 ~0.49）
 *   2. 版本直伤系数（支援突击伤害列比值——支援突击通常不随角色变化，作全队锚点；
 *      **反制支援本体与专属追击各自是独立招式类型**（counterAssist / counterAssistFollowUp），
 *      分类上就不属于支援突击，恒不进锚点，见 classifyMove）
 *   3. 反制支援系「等效能量」（standardMultiplierTable#EQUIVALENT_ENERGY）：支援突击 = 强特公式@20、
 *      反制本体 = @40、专属追击 = @80 —— 奖励值是「等效多少能量 × 能量转化率」算出来的
 *   3. 招式特定偏差（单招式比值 vs 本角色该列基准：连携增强/大招削弱一类设计空间）
 *
 * 纯函数：输入 catalog 原始数组、输出类型化报告，页面（MultiplierCoeffPage）与测试共用同一实现。
 * 聚合口径：纵向系数只取「干净类型」——排除强化特殊技（逐角色设计空间大）、轻/重招架
 * （标准常数与数据存在恒定 ~10% 出入，待确认）与未分类招式；中位数天然抗个别脏行。
 */
import type { Agent, AgentSkills, SkillMove } from '@/types/catalog'
import {
  COEFFICIENT_ROW_IDS,
  EQUIVALENT_ENERGY,
  EX_SHARPNESS_ENERGY,
  FIXED_RECORD_UNITS,
  RESOURCE_ROW_IDS,
  FLASH_ENERGY_QUALITY,
  MOVE_FUSION_GROUPS,
  MOVE_TIME_ADJUSTMENTS,
  MOVE_TYPE_LABELS,
  MOVE_TYPE_OVERRIDES,
  MOVE_TYPE_TIME_SCALE,
  SHARPNESS_GATED_MOVES,
  STANDARD_MULTIPLIER_TABLE,
  STANDARD_ROW_IDS,
  STANDARD_S_AGENT_IDS,
  getRarityMultiplier,
  type CoefficientRowId,
  type MoveType,
  type StandardRowId,
} from '@/data/standardMultiplierTable'
import { LEVEL1_TO_LEVEL12 } from '@/core/skillLevel'
import { COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS, COUNTER_ASSIST_MOVE_IDS } from '@/data/counterAssists'
import { AGENT_RELEASE_NODE, VERSION_NODES, nodeIndexOf } from '@/data/versionTimeline'

import { localized } from '@/utils/format'
/** actionTime 低于此值视为录入噪声（0 / 0.001 的子段行），不参与期望值计算 */
const MIN_ACTION_TIME = 0.01

/**
 * 单元格遍历全集 = 标准行 + 资源行（RESOURCE_ROW_IDS：专属资源 / 残痕积累 / 锐能回复）。
 * 资源行没有标准式 ⇒ 单元格只有 actual 与秒均两栏，ratio 恒 null（不进纵向聚合与偏差清单）。
 */
const RESOURCE_ROW_ID_SET: ReadonlySet<string> = new Set<string>(RESOURCE_ROW_IDS)

/** 招式特定偏差判定阈值：偏离本角色列基准 ±5% 记一条 */
const DEVIATION_THRESHOLD = 0.05

/**
 * 中位数「抹平到 1」的半径（用户口径 2026-10-24）。
 *
 * 原始数据是从小数点后几位截断来的，实测同源列的中位数会落在 99.9x%~100.5% 这种纯噪声带里
 * （用户：「我算的异常积蓄秒均基本都是 99.99，这个我都当做是 100」「中位数如果偏差不多，那就算成 1 呗」）。
 * 这类 **0.5%** 以内的偏离**不是角色系数**，抹成 1 让表格可读；超出半径一律照实显示
 * （100.6%（星见雅失衡）/ 100.9%（安东）/ 101.5%（妮可失衡）/ 91.5%（凯撒）/ 90%（爱丽丝）都留着）
 * —— 半径再放大就会把真系数一起抹平，精度换不来可读性。
 * ⚠ 只影响「系数展示与偏差判定基准」，不改任何倍率录入值——Σ 原值仍然照算。
 */
const UNITY_SNAP_RADIUS = 0.005

/** 0.5% 以内抹到 1；否则原样返回 */
function snapToUnity(v: number): number {
  return Math.abs(v - 1) <= UNITY_SNAP_RADIUS ? 1 : v
}

/**
 * 参与纵向系数聚合的招式类型白名单（其余为设计空间/待确认口径）。
 *
 * 排除理由：
 * - exSpecial：逐角色设计空间大（耗能分摊方式不同）；
 * - parryLight / parryHeavy：标准常数是数据校准值，与数据存在恒定 ~10% 出入；
 * - **counterAssist / counterAssistFollowUp（2026-10-24 起）**：反制系由「等效能量」定价
 *   （支援突击基线 + 奖励，见 standardMultiplierTable#EQUIVALENT_ENERGY），其比值天然 ≈ 角色系数
 *   —— 把它喂回中位数等于「用反解出来的系数再算系数」（循环论证），故只展示、不聚合；
 * - other：未分类。
 */
export function isCleanVerticalType(moveType: MoveType | 'other'): boolean {
  return moveType !== 'exSpecial'
    && moveType !== 'parryLight'
    && moveType !== 'parryHeavy'
    && moveType !== 'counterAssist'
    && moveType !== 'counterAssistFollowUp'
    && moveType !== 'other'
}

/** 招式分类：定点覆盖 + 名称前缀 + 类别 + timeType + energyCost + 职业 → 标准表行单位 */
export function classifyMove(move: SkillMove, categoryId: string, specialty: string): MoveType | 'other' {
  const override = MOVE_TYPE_OVERRIDES[move.id]
  if (override) return override
  // 反制支援系：按 data/counterAssists.ts 登记表定点分类（**不按名字扫**——克拉蕾的两条
  // 「支援突击」EN 同为 Assist Follow-Up，按名会挑错行；反制本体名也不含「支援突击」）。
  if (COUNTER_ASSIST_MOVE_IDS.has(move.id)) return 'counterAssist'
  if (COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS.has(move.id)) return 'counterAssistFollowUp'
  const name = move.name.zhCN ?? ''
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
      if (name.startsWith('快速支援')) {
        // 两版口径：喧响速率 ≥40/s 判为翻倍版（喧响不受稀有度系数影响，可直接比）
        const db = move.rows.find((r) => r.id === 'decibel_recovery')?.values[0]
        return typeof db === 'number' && typeof move.actionTime === 'number' && move.actionTime > MIN_ACTION_TIME && db / move.actionTime >= 40
          ? 'quickAssistLegacy'
          : 'quickAssist'
      }
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

/**
 * 耗能信息：kind 区分普通能量 / 闪能（质量 ×1.2，见 standardMultiplierTable.FLASH_ENERGY_QUALITY）/ 锋御锐能。
 *
 * 锐能走同一条 e 通道（1 点锐能 = 1 点能量），但只有实测验证过的角色才登记（`EX_SHARPNESS_ENERGY`）——
 * 克拉蕾的 60 锐能是[猩红铭刻]的入场门禁、不产生奖励倍率，故不在此列。
 */
export interface EnergyCostInfo {
  value: number
  kind: 'energy' | 'flashEnergy' | 'sharpness'
}

/**
 * 解析耗能：取首个非持续（无 /s、/sec 后缀）项的数值前缀。
 *
 * catalog 没有锋御的能量键（锐能不是能量），实测同价的角色由 `EX_SHARPNESS_ENERGY` 定点补登；
 * 没有登记 → 返回 null（= e 项为 0，例如克拉蕾 1611010 的锐能强特，她走特殊技基线）。
 */
export function parseEnergyCost(move: SkillMove): EnergyCostInfo | null {
  for (const [key, value] of Object.entries(move.energyCost ?? {})) {
    if (/\/s|\/sec/.test(value)) continue
    const m = value.match(/^\d+(\.\d+)?/)
    if (m) return { value: Number(m[0]), kind: key.includes('Flash') ? 'flashEnergy' : 'energy' }
  }
  const sharpness = EX_SHARPNESS_ENERGY[move.id]
  if (sharpness != null) return { value: sharpness, kind: 'sharpness' }
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
  /** 标准行 + 资源行（attack_data_0 / gash_buildup / sharpness_gain）的实际录入值 */
  values: Partial<Record<CoefficientRowId, number>>
  flags: string[]
  /** 普攻回能显式录 0（数据缺口）：合成 0 比值单元格展示 */
  zeroEnergyRow?: boolean
}

/** 去掉结尾的「 #N」段号（分段合并分组键） */
function stripPartSuffix(name: string): string {
  return name.replace(/\s*#\d+$/, '')
}

function rowValuesById(move: SkillMove): Partial<Record<CoefficientRowId, number>> {
  const out: Partial<Record<CoefficientRowId, number>> = {}
  for (const rowId of COEFFICIENT_ROW_IDS) {
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
      if (moveType === 'exSpecial' && energy?.kind === 'sharpness') flags.push(`锐能按能量计价(${energy.value}/发)`)
      if (moveType === 'exSpecial' && energy == null && SHARPNESS_GATED_MOVES.has(move.id)) {
        // 克拉蕾：60 锐能只是[猩红铭刻]的入场门禁，不产生奖励倍率（实测三列落在特殊技基线）
        flags.push('锐能=门禁(不进公式)')
      }
      // 普攻的回能恒应存在：显式录入 0 属数据缺口（全库 13 条，如爱丽丝「星芒圆舞曲」；
      // 席德「霜蕊轮舞 #1/#2」等 2 条已由 scripts/patch-misplaced-attack-data.mjs 回填——
      // 其真实回能/喧响错位在 attack_data 1/2 位），合成 0 比值单元格并打标，避免静默隐藏
      const zeroEnergyRow =
        moveType === 'basic' && typeof move.actionTime === 'number' && move.actionTime > MIN_ACTION_TIME &&
        move.rows.some((r) => r.id === 'energy_recovery' && r.values[0] === 0)
      if (zeroEnergyRow) flags.push('回能录入为0(待补)')
      units.push({
        agentId: String(agent.id),
        agentName: localized(agent.name, agent.id),
        rarity: agent.rarity,
        specialty: agent.specialty,
        moveId: move.id,
        moveName: localized(move.name, move.id),
        moveType,
        t: typeof move.actionTime === 'number'
          ? move.actionTime + (MOVE_TIME_ADJUSTMENTS[move.id] ?? 0)
          : null,
        energy,
        values: rowValuesById(move),
        flags,
        zeroEnergyRow,
      })
    }
  }

  // 定点整链记录（FIXED_RECORD_UNITS）：以合成评估单元替代 catalog 行的自动评估——
  // 整链一次计耗能、弹刀赠送段免费，逐段/简单融合都表达不了（仪玄墨痕化形 2连/3连×弹刀
  // + 单E×弹刀；原「#1+#2 / #3+#4」融合评估得 ~0.46~2.56 假象）。成员行不再单独/融合评估。
  const replacedByFixed = new Set<string>()
  const fixedUnits: RawUnit[] = []
  for (const rec of FIXED_RECORD_UNITS) {
    if (String(rec.agentId) !== String(agent.id)) continue
    const members = units.filter((u) => rec.members.includes(u.moveId))
    if (members.length !== rec.members.length) continue // 缺 catalog 行则跳过（保留原评估）
    for (const m of members) replacedByFixed.add(m.moveId)
    const t = members.reduce((s, u) => s + (u.t ?? 0), 0)
    const values: Partial<Record<CoefficientRowId, number>> = {}
    for (const u of members) {
      for (const [rowId, v] of Object.entries(u.values)) {
        values[rowId as CoefficientRowId] = (values[rowId as CoefficientRowId] ?? 0) + v
      }
    }
    fixedUnits.push({
      agentId: String(agent.id),
      agentName: localized(agent.name, String(agent.id)),
      rarity: agent.rarity,
      specialty: agent.specialty,
      moveId: rec.moveId,
      moveName: rec.moveName,
      moveType: rec.moveType,
      t,
      energy: rec.energy,
      values,
      flags: [`定点整链记录(${rec.members.length}段)`],
    })
  }
  units.push(...fixedUnits)

  // 倍率行融合组：catalog 把一套招式拆成多行/多段时，加总为一个评估单元（前缀项/耗能只计一次）。
  // 实证：星见雅「飞雪 #1+#2」融合后 = nanoka 官方斩击倍率 788.3%，代入强特公式三列比值 ≈1.001；
  // 连携 #1~#3 融合后伤害/喧响比值 ≈1.000（逐段评估会得到 ~0.38 的假象）。
  const fusedIds = new Set<string>()
  for (const group of MOVE_FUSION_GROUPS) {
    const members = units.filter((u) => group.members.includes(u.moveId))
    if (members.length < 2) continue
    const head = members[0]
    for (const extra of members.slice(1)) {
      head.t = (head.t ?? 0) + (extra.t ?? 0)
      for (const [rowId, v] of Object.entries(extra.values)) {
        head.values[rowId as CoefficientRowId] = (head.values[rowId as CoefficientRowId] ?? 0) + v
      }
      fusedIds.add(extra.moveId)
    }
    head.moveName = `${stripPartSuffix(head.moveName)}（融合${members.length}段）`
    head.flags.push(`倍率行融合(${members.length}段)`)
  }
  const out = units.filter((u) => !fusedIds.has(u.moveId) && !replacedByFixed.has(u.moveId))

  // 支援突击的「#N」分段是同一套招式的分段，标准式前缀项只计一次：按去段号名称合并后再评估。
  // 实证：苍角「席卷打击 #1+#2」合并后伤害/失衡/喧响三列比值 ≈1.000（分段单算各 88.7%/59.2%，
  // 会把直伤锚点拖到 0.74）。
  const merged = new Map<string, RawUnit>()
  const result: RawUnit[] = []
  for (const unit of out) {
    if (unit.moveType !== 'assistFollowUp' || !/ #\d+$/.test(unit.moveName)) {
      result.push(unit)
      continue
    }
    const key = `${unit.agentId}/${stripPartSuffix(unit.moveName)}`
    const head = merged.get(key)
    if (!head) {
      merged.set(key, unit)
      result.push(unit)
      continue
    }
    head.t = (head.t ?? 0) + (unit.t ?? 0)
    for (const [rowId, v] of Object.entries(unit.values)) {
      head.values[rowId as CoefficientRowId] = (head.values[rowId as CoefficientRowId] ?? 0) + v
    }
    head.moveName = stripPartSuffix(head.moveName)
    head.flags.push('支援突击分段已合并')
  }
  return result
}

/** 等级系数：标准表按 1 级记录，catalog 录 12 级单值 */
function levelMultiplier(rowId: StandardRowId): number {
  if (rowId === 'damage') return LEVEL1_TO_LEVEL12.damage
  if (rowId === 'daze') return LEVEL1_TO_LEVEL12.daze
  return 1
}

export interface MoveCellEval {
  rowId: CoefficientRowId
  /** catalog 实际录入值（Lv12，**整招合计**） */
  actual: number
  /** 标准表期望值（含等级/稀有度/命破系数）；无标准式的行（资源行）为 null */
  expected: number | null
  /** 实际/期望，即该格的角色系数表现；无标准式为 null（不参与纵向聚合与偏差判定） */
  ratio: number | null
  /**
   * 秒均 = actual / t（t 取与展示列同一个动作时间，含类型级时间缩放）。
   * 资源行（专属资源/残痕/锐能）靠它跨招式比较——总数值随招式长短变化，读不出效率；
   * 标准行也一并算出（诊断用），t 缺失/过小时为 null。
   */
  perSecond: number | null
  /** 数据缺口格（显式录 0）：仅展示，不参与纵向聚合与偏差判定 */
  dataGap?: boolean
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
  /**
   * 等效能量（奖励口径）：支援突击 / 反制支援系的标准式是「等效多少能量 × 强特耗能利用率系数」
   * 堆出来的，不是玩家花掉的真能量。支援突击 = 20，反制支援本体 = 40，反制专属追击 = 80。
   * 其余招式（含强特）为 null —— 它们的 energy 是真实耗能。
   */
  equivalentEnergy: number | null
  /** 相对「支援突击基线(=20)」多出来的奖励等效能量（反制本体 +20 / 专属追击 +60；其余 null） */
  rewardEnergy: number | null
  flags: string[]
  cells: MoveCellEval[]
}

function evaluateUnit(unit: RawUnit): MoveEval {
  const cells: MoveCellEval[] = []
  const table = unit.moveType === 'other' ? undefined : STANDARD_MULTIPLIER_TABLE[unit.moveType]
  const timeScale = unit.moveType === 'other' ? 1 : MOVE_TYPE_TIME_SCALE[unit.moveType] ?? 1
  const t = unit.t != null && unit.t > MIN_ACTION_TIME ? unit.t * timeScale : null
  for (const rowId of COEFFICIENT_ROW_IDS) {
    const actual = unit.values[rowId]
    if (actual == null) continue
    // 资源行（attack_data_0 专属资源 / gash_buildup 残痕 / sharpness_gain 锐能）：没有标准式
    // ⇒ 只出实际值与**秒均**（ratio=null，不进纵向聚合/偏差判定）。含普攻聚合行，
    // 平A的电压/残痕/锐能由此在倍率表可见；0 值（这一招不发该资源）跳过，表更干净。
    if (RESOURCE_ROW_ID_SET.has(rowId)) {
      if (actual > 0) {
        cells.push({ rowId, actual, expected: null, ratio: null, perSecond: t == null ? null : actual / t })
      }
      continue
    }
    // ratio 有值的只可能是标准行（资源行恒 ratio=null）—— 此处把联合类型收窄回 StandardRowId
    const stdRowId = rowId as StandardRowId
    const formula = table?.[stdRowId]
    // 该招式类型没有这一列的标准式（如强攻终结技没有喧响标准）：只出实际值，ratio 留空
    if (!formula) {
      if (actual > 0) {
        cells.push({ rowId, actual, expected: null, ratio: null, perSecond: t == null ? null : actual / t })
      }
      continue
    }
    // 普攻回能显式录 0 属数据缺口：合成 0 比值单元格展示（其余 0 值多为后台禁用置 0，仍跳过）
    if (actual <= 0 && !(actual === 0 && rowId === 'energy_recovery' && unit.zeroEnergyRow)) continue
    if (t == null) continue
    const eFactor = unit.energy?.kind === 'flashEnergy' ? FLASH_ENERGY_QUALITY : 1
    const std = (formula.const ?? 0) + (formula.perT ?? 0) * t + (formula.perE ?? 0) * (unit.energy?.value ?? 0) * eFactor
    const expected = std * levelMultiplier(stdRowId) * getRarityMultiplier(unit.rarity, unit.agentId, unit.specialty, stdRowId)
    if (expected <= 0) continue
    const dataGap = actual === 0
    cells.push({
      rowId,
      actual,
      expected,
      ratio: actual / expected,
      perSecond: actual / t,
      ...(dataGap ? { dataGap: true } : {}),
    })
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
    equivalentEnergy: unit.moveType === 'other' ? null : EQUIVALENT_ENERGY[unit.moveType] ?? null,
    rewardEnergy: unit.moveType === 'counterAssist'
      ? (EQUIVALENT_ENERGY.counterAssist! - EQUIVALENT_ENERGY.assistFollowUp!)
      : unit.moveType === 'counterAssistFollowUp'
        ? (EQUIVALENT_ENERGY.counterAssistFollowUp! - EQUIVALENT_ENERGY.assistFollowUp!)
        : null,
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
        .flatMap((m): number[] => m.cells
          .filter((c) => c.rowId === rowId && !c.dataGap && c.ratio != null)
          .map((c) => c.ratio as number))
      // 中位数落进噪声带（±0.5%）的抹成 1：录入截断的残余，不是角色系数（用户口径 2026-10-24）
      if (ratios.length) coefficients[rowId] = { value: snapToUnity(median(ratios)), samples: ratios.length }
    }
    // 版本直伤系数（中心系数）= 支援突击伤害列比值。
    // 支援突击锚点只看 assistFollowUp 分类：反制系（本体/专属追击）自 2026-10-24 起是独立类型，
    // 分类层就不会走到这里（历史：它们曾同挂「支援突击」名，两条取中位数得 206.8% 的假象，
    // 订正后 = 122.7%，用户 2026-10-09 口径「中心系数该用支援突击：血华誓·无垢熔锋 (1611027)」）。
    // 保留下面的显式过滤作为**二道闸**：万一有人给反制系加 MOVE_TYPE_OVERRIDES 改回 assistFollowUp，
    // 锚点也不会被拖走。
    const ddRatios = list
      .filter((m) => m.moveType === 'assistFollowUp' && !COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS.has(m.moveId))
      .flatMap((m) => m.cells.filter((c) => c.rowId === 'damage' && !c.dataGap && c.ratio != null).map((c) => c.ratio as number))
    rows.push({
      agentId,
      agentName: head.agentName,
      rarity: head.rarity,
      specialty: head.specialty,
      coefficients,
      directDamage: ddRatios.length ? { value: snapToUnity(median(ddRatios)), samples: ddRatios.length } : null,
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
      if (cell.rowId === 'damage' || cell.dataGap || cell.ratio == null) continue
      const rowId = cell.rowId as StandardRowId // ratio 非空 ⇒ 必是标准行（资源行恒 ratio=null）
      const baseline = base.coefficients[rowId]?.value
      if (baseline == null || baseline <= 0) continue
      const deviation = cell.ratio / baseline
      if (Math.abs(deviation - 1) > DEVIATION_THRESHOLD) {
        out.push({
          agentId: m.agentId,
          agentName: m.agentName,
          moveId: m.moveId,
          moveName: m.moveName,
          moveTypeLabel: m.moveTypeLabel,
          rowId,
          ratio: cell.ratio,
          baseline,
          deviation,
        })
      }
    }
  }
  return out
}

export interface CoefficientReport {
  vertical: AgentVerticalRow[]
  moves: MoveEval[]
  deviations: MoveDeviation[]
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
