/**
 * 可琳（1061）—— 专注电锯增伤与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1061.json，按核心被动 Lv.7。
 * - 核心被动专注：电锯持续斩击（强化普攻）伤害+37.5%。用户口径：每个招式都写了长按持续斩击
 *   → 全招式生效，作为普通增伤直接加面板 dmgBonus（applyPanel，不限定行）。
 * - 额外能力扫除帮手：同属性/同阵营队友激活，命中失衡敌人自身伤害+35%。
 *   轴模式按 buff 轴扫描（computeCorinStunBonusMoves：失衡轴内所有招式都在失衡窗口内 → 全部+35%，
 *   普攻段归并 basic_attack 聚合行键），装配分支在 useResourceCalc emitExecDirect（般岳明王同款）；
 *   非轴模式按 corin.additionalStunCoverage 覆盖率滑块近似（默认 0.5，用户口径）。
 * - 影画1 开放性创伤：连携/终结命中后对目标伤害+12%（15秒），按覆盖率折算面板 dmgBonus（applyPanel）。
 * - 影画2 裂解效应：强特/连携/终结命中使目标物理抗性-0.5%×20层（上限10%），默认全覆盖，
 *   按覆盖率折算面板 enemyPhysicalResReduction（applyPanel；spec teamBuffs 条已 hidden 防双计）。
 * - 影画4 战场随侍：快速支援/招架支援/连携技命中回 7.2 能量，16s 内最多一次。
 *   按已有次数计触发（快支+招架支援+连携总数），CD floor(战斗时长/16) 做上限（用户口径），
 *   并入开局能量赠送（妮可 C2 同款通道）。
 * - 影画6 厚积薄发：持续斩击叠充能（上限40），闪避反击/特殊技/强特/快速支援/支援突击引爆电锯时
 *   消耗全部充能，每层额外造成3%攻击力伤害，按引爆次数×充能层数生成合成执行行
 *   （damageMultiplierOverride，不伪造 catalog moveId）。catalog 无 hit/段数数据，段数无法抓取 → 滑块默认。
 *
 * 明确未建模：
 * - 影画2 每层独立结算5秒持续、影画6 充能逐层积累/消耗时序，均按覆盖率/层数滑块近似。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'

export const CORIN_ID = '1061'
export const CORIN_CORE_SAW_DMG = 37.5
export const CORIN_ADDITIONAL_DMG = 35
export const CORIN_C1_DMG = 12
export const CORIN_C2_RES_PER_STACK = 0.5
export const CORIN_C2_MAX_STACKS = 20
export const CORIN_C4_ENERGY = 7.2
export const CORIN_C4_CD = 16
export const CORIN_C6_DMG_PER_CHARGE = 3
export const CORIN_C6_MAX_CHARGES = 40

export interface CorinCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreSawDmg: number
  additionalDmg: number
  c1Dmg: number
  c2ResReduction: number
  c4EnergyTotal: number
  c6DetonationCount: number
  c6DamagePerDetonation: number
  note: string
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function settingOf(settings: Readonly<Record<string, number>>, id: string, fallback: number): number {
  const value = Number(settings?.[id])
  return Number.isFinite(value) ? value : fallback
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

export function computeCorinCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  coreSawCoverage: number
  additionalStunCoverage: number
  c1Coverage: number
  c2ResCoverage: number
  c4EnergyTotal: number
  c6DetonationCount: number
  c6ChargeStacks: number
}): CorinCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const c6ChargeStacks = Math.max(0, Math.min(CORIN_C6_MAX_CHARGES, input.c6ChargeStacks))
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    coreSawDmg: CORIN_CORE_SAW_DMG * clampRatio(input.coreSawCoverage),
    additionalDmg: input.additionalActive ? CORIN_ADDITIONAL_DMG * clampRatio(input.additionalStunCoverage) : 0,
    c1Dmg: cinemaLevel >= 1 ? CORIN_C1_DMG * clampRatio(input.c1Coverage) : 0,
    c2ResReduction: cinemaLevel >= 2
      ? CORIN_C2_RES_PER_STACK * CORIN_C2_MAX_STACKS * clampRatio(input.c2ResCoverage)
      : 0,
    c4EnergyTotal: cinemaLevel >= 4 ? Math.max(0, input.c4EnergyTotal) : 0,
    c6DetonationCount: cinemaLevel >= 6 ? whole(input.c6DetonationCount) : 0,
    c6DamagePerDetonation: cinemaLevel >= 6 ? CORIN_C6_DMG_PER_CHARGE * c6ChargeStacks : 0,
    note: '影画2/6逐层时序按滑块近似；影画4按快支+招架支援+连携次数计、CD上限；额外能力轴模式按buff轴、非轴按覆盖率。',
  }
}

/**
 * 影画4 触发次数（用户口径）：快支 + 招架支援 + 连携总数，16s CD 做上限。
 * 纯函数，buildCharConfig 调用；连携总数 = chainCountTotalOverride ?? chainCountPerStun × stunCount。
 */
export function computeCorinC4Triggers(input: {
  battleTime: number
  quickAssistCount: number
  parryCount: number
  chainTotal: number
}): number {
  const cdCap = Math.max(0, Math.floor(input.battleTime / CORIN_C4_CD))
  const raw = Math.max(0, Math.floor(input.quickAssistCount))
    + Math.max(0, Math.floor(input.parryCount))
    + Math.max(0, Math.floor(input.chainTotal))
  return Math.min(cdCap, raw)
}

/**
 * 额外能力扫除帮手 buff 轴（轴模式，般岳明王同款扫描）：
 * 失衡轴内可琳槽位的所有动作都在失衡窗口内 → 全部 +35%。
 * 平A块归并到 'basic_attack' 键：轴编辑器的平A块是 moveId 'basic'（按秒数），
 * 执行行平A是 basic_attack 聚合秒均行；catalog 普攻段 id（手改 JSON 场景）一并归并。
 * 返回 moveId → 增伤%（值恒为 CORIN_ADDITIONAL_DMG；装配端按 exec.moveId 查表，
 * 且只吃轴内段——装配端按 stunOverride 门控）。
 */
export function computeCorinStunBonusMoves(
  slot: number,
  axes: { actions: { slot: number; moveId: string; count: number; startTime?: number }[] }[],
  basicMoveIds: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const axis of axes) {
    for (const act of axis.actions ?? []) {
      if (act.slot !== slot) continue
      if ((act.count ?? 1) <= 0) continue
      const key = act.moveId === 'basic' || basicMoveIds.has(act.moveId) ? 'basic_attack' : act.moveId
      out.set(key, CORIN_ADDITIONAL_DMG)
    }
  }
  return out
}

function buildCorinCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.corinCinemaLevel = cinemaLevel
  record.corinCoreSawCoverage = clampRatio(setting(cfg, 'corin.coreSawCoverage', 1))
  record.corinAdditionalStunCoverage = clampRatio(setting(cfg, 'corin.additionalStunCoverage', 0.5))
  record.corinC1Coverage = clampRatio(setting(cfg, 'corin.c1Coverage', 1))
  record.corinC2ResCoverage = clampRatio(setting(cfg, 'corin.c2ResCoverage', 1))
  record.corinC6DetonationCount = whole(setting(cfg, 'corin.c6DetonationCount', 8))
  record.corinC6ChargeStacks = Math.max(0, Math.min(CORIN_C6_MAX_CHARGES, setting(cfg, 'corin.c6ChargeStacks', 40)))
  record.corinAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

/**
 * 影画4 战场随侍（applyTeamConfig · converge 阶段）：
 * 快支 + 招架支援 + 连携总数，16s CD 做上限（用户口径）→ 并入开局能量赠送。
 *
 * 为什么不在 buildCharConfig：resourceConfig（cfg 构建）在失衡次数收敛**之前**缓存，
 * 那里拿不到收敛后的 stunCount（连携总数 = chainCountTotalOverride ?? chainCountPerStun × stunCount）。
 * converge 每轮重入且带上一轮收敛的 stunCount，写入在 iterate 能量结算前生效（莱特 C4 同阶段）。
 * 幂等：先扣上一轮本模块写入量再写新值（合并 cfg 每轮从 base 重建，prev 通常为 0）。
 */
function applyCorinTeamConfig({ slot, cinemaLevel, characters, phase, combatTime, stunCount }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  const cfg = characters[slot]
  if (!cfg || cinemaLevel < 4) return
  const record = cfg as unknown as Record<string, unknown>
  const chainTotal = cfg.chainCountTotalOverride ?? (cfg.chainCountPerStun ?? 0) * stunCount
  const triggers = computeCorinC4Triggers({
    battleTime: combatTime,
    quickAssistCount: cfg.quickAssistCount ?? 0,
    parryCount: cfg.parryCount ?? 0,
    chainTotal,
  })
  const gift = triggers * CORIN_C4_ENERGY
  const prev = Math.max(0, Number(record.corinC4EnergyTotal ?? 0))
  cfg.initialEnergyGift = Math.max(0, (cfg.initialEnergyGift ?? 0) - prev) + gift
  record.corinC4EnergyTotal = gift
  record.corinC4Triggers = triggers
}

function cycleFromInput({ cfg, state: _state }: Pick<AgentResourceInput, 'cfg' | 'state'>): CorinCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeCorinCycle({
    cinemaLevel: Number(record.corinCinemaLevel ?? 0),
    additionalActive: record.corinAdditionalActive === true,
    coreSawCoverage: Number(record.corinCoreSawCoverage ?? 1),
    additionalStunCoverage: Number(record.corinAdditionalStunCoverage ?? 0.5),
    c1Coverage: Number(record.corinC1Coverage ?? 1),
    c2ResCoverage: Number(record.corinC2ResCoverage ?? 1),
    c4EnergyTotal: Number(record.corinC4EnergyTotal ?? 0),
    c6DetonationCount: Number(record.corinC6DetonationCount ?? 8),
    c6ChargeStacks: Number(record.corinC6ChargeStacks ?? 40),
  })
}

function buildCorinExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.c6DetonationCount <= 0 || cycle.c6DamagePerDetonation <= 0) return
  executions.push({
    moveId: '1061_c6_chainsaw_detonation',
    moveName: '电锯引爆（影画6）',
    category: 'special',
    element: 'physical',
    count: cycle.c6DetonationCount,
    actionTime: 0,
    comboAlignRatio: 0,
    totalTime: 0,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: cycle.c6DamagePerDetonation,
    damageMultiplierOverride: true,
    skillDamageTarget: 'additionalAttack',
  })
}

/**
 * 面板级机制（核心电锯增伤 / 影画1增伤 / 影画2减抗）——走文档化的 applyPanel 通道，
 * 直接读 input.settings（已解析滑块）。
 *
 * 额外能力失衡增伤不在这里：轴模式按 buff 轴逐行生效、非轴按覆盖率逐行近似，
 * 装配分支在 useResourceCalc emitExecDirect（般岳明王同款），见 computeCorinStunBonusMoves。
 *
 * 历史缺陷（2026-02 录入复查发现）：旧实现把面板增益放在 transformSkillExecutions 里改写 panel，
 * 并用 `__corinPanelApplied` 守卫防重复。但可琳没有 applyPanel 钩子 → computePanelPhases 从不调用
 * resolveMechanicSettings → panels computed 不追踪滑块 → 滑块变化后面板不重算，而缓存面板对象上的
 * 守卫又挡住重新施加 → 覆盖率滑块首次求值后**永久冻结**（静默失效，般岳 rageGainCoverage 同类）。
 * applyPanel 是文档化通道：settings 已解析、面板每次重算都新鲜。
 */
function applyCorinPanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  if (!panel) return
  const cycle = computeCorinCycle({
    cinemaLevel,
    additionalActive: false, // 额外能力走伤害行分支（emitExecDirect），不进面板
    coreSawCoverage: settingOf(settings, 'corin.coreSawCoverage', 1),
    additionalStunCoverage: 0,
    c1Coverage: settingOf(settings, 'corin.c1Coverage', 1),
    c2ResCoverage: settingOf(settings, 'corin.c2ResCoverage', 1),
    c4EnergyTotal: 0, // 非面板通道（buildCharConfig → initialEnergyGift）
    c6DetonationCount: 0, // 非面板通道（buildExecutions 合成行）
    c6ChargeStacks: 0,
  })
  // 核心被动专注：用户口径——每个招式都写了长按持续斩击 → 全招式普通增伤，不限定行
  if (cycle.coreSawDmg > 0) panel.dmgBonus = (panel.dmgBonus ?? 0) + cycle.coreSawDmg
  if (cycle.c1Dmg > 0) panel.dmgBonus = (panel.dmgBonus ?? 0) + cycle.c1Dmg
  if (cycle.c2ResReduction > 0) {
    panel.enemyPhysicalResReduction = (panel.enemyPhysicalResReduction ?? 0) + cycle.c2ResReduction
  }
}

function buildCorinResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { corin_cycle: cycleFromInput({ cfg, state }) } }
}

function buildCorinResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.corin_cycle as CorinCycle | undefined
  if (!cycle) return []
  return [{
    id: 'corin-cycle',
    title: '可琳·专注电锯',
    summary: `电锯增伤 +${cycle.coreSawDmg}%（全招式） · 失衡增伤 +${cycle.additionalDmg}%（非轴近似）`,
    rows: [
      { label: '核心电锯增伤', value: `+${cycle.coreSawDmg}%`, detail: '持续斩击+37.5%，全招式生效（每个招式都有长按持续斩击）' },
      { label: '额外能力失衡增伤', value: `+${cycle.additionalDmg}%`, detail: cycle.additionalActive ? '命中失衡敌人+35%；轴模式按buff轴全招式，非轴按此覆盖率' : '未激活（需同属性/同阵营队友）' },
      { label: '影画1连携终结增伤', value: `+${cycle.c1Dmg}%`, detail: '命中后15秒按覆盖率' },
      { label: '影画2物理减抗', value: `+${cycle.c2ResReduction}%`, detail: '0.5%×20层上限10%，默认全覆盖' },
      { label: '影画4回能', value: `+${cycle.c4EnergyTotal.toFixed(1)}`, detail: '快支+招架支援+连携次数 × 7.2，16s CD上限' },
      { label: '影画6电锯引爆', value: `${cycle.c6DetonationCount} 次`, detail: `每次 ${cycle.c6DamagePerDetonation}% 攻击力（无hit数据，层数按滑块）` },
    ],
    footer: cycle.note,
  }]
}

export const corinMechanic: AgentMechanicModule = {
  id: 'agent:corin',
  agentIds: [CORIN_ID],
  name: '可琳·专注',
  description: '电锯增伤37.5%全招式、额外能力失衡增伤（轴模式buff轴/非轴覆盖率）、影画1/2/4/6；影画2/6逐层时序按滑块近似。',
  settings: [
    { id: 'corin.coreSawCoverage', label: '电锯增伤覆盖率', description: '核心被动持续斩击+37.5%，全招式生效（每个招式都有长按持续斩击）', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'corin.additionalStunCoverage', label: '失衡增伤覆盖率（非轴）', description: '额外能力命中失衡敌人+35%；轴模式按buff轴全招式生效，此滑块仅非轴模式生效', default: 0.5, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'corin.c1Coverage', label: '影画1增伤覆盖率', description: '影画1连携/终结命中后+12%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'corin.c2ResCoverage', label: '影画2减抗覆盖率', description: '影画2物理抗性-10%，默认全覆盖', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'corin.c6DetonationCount', label: '影画6引爆次数', description: '闪避反击/特殊技/强特/快支/支援突击引爆电锯次数（无hit数据，手动定）', default: 8, min: 0, max: 40, step: 1, suffix: '次' },
    { id: 'corin.c6ChargeStacks', label: '影画6充能层数', description: '引爆时消耗的充能层数（每层+3%攻击力，上限40）', default: 40, min: 0, max: 40, step: 1, suffix: '层' },
  ],
  buildCharConfig: buildCorinCharConfig,
  applyTeamConfig: applyCorinTeamConfig,
  buildExecutions: buildCorinExecutions,
  applyPanel: applyCorinPanel,
  buildResourceResult: buildCorinResourceResult,
  resourceSections: buildCorinResourceSections,
}

export default corinMechanic
