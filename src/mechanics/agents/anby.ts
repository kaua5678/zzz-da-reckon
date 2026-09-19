import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import type { SkillExecution } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 安比（1011，电·强攻）—— 整局近似口径
 *
 * 已接管（原先分散在 helpers.ts / specPanelBuffs）：
 * - 影画1 快充模式：普攻第四段命中 → 能量获得效率 +12%（30s 刷新，覆盖率滑块 `anby.fastChargeCoverage` 默认 100%）。
 *
 * 原文录入修正（2026-09-17 用户裁决三条，契约 `data/recordings/1011.json`）：
 * - ① **核心被动·波动电压（Lv.7）是招式限定**：原文「安比在[普通攻击]第三段后发动[普通攻击：落雷]、
 *   [特殊技]或[强化特殊技]时，招式造成的失衡值提升64%」⇒ 只有 落雷(1011005)/特殊技(1011006)/
 *   强化特殊技(1011007) 吃 +64%。此前挂在 `basic_attack` **聚合行整体**上 ⇒ 伏特速攻 #1~#4 不该吃却吃满
 *   （**过范围**，不是「未生效」——聚合行 ×1.64 在真管线实测生效）。
 * - ② **普攻元素按原文分段**：原文「向前方进行至多四段的斩击，前三段造成物理伤害，第四段造成电属性伤害」
 *   ⇒ #1~#3 physical、#4 electric、落雷 electric。此前 catalog 五段全 electric（导入器把**角色元素**
 *   铺满每招）⇒ 非电属性的段白吃电伤加成/电抗。**根因在导入器**，已由
 *   `scripts/patch-move-elements.mjs` + `scripts/lib/move-elements.mjs` 按原文重刷 catalog（规则 2）。
 * - ③ **影画6 充能电场是执行级**：原文「发动[强化特殊技]时获得8层充能（上限8层）；[普通攻击]或
 *   [冲刺攻击]命中敌人时，消耗1层充能，使**当前招式**造成的伤害提升45%」⇒ 按可消费命中数挂**执行级**
 *   `dmgBonus`，不是面板级全局 +45%（旧实现让强特/终结/连携也吃满 45% = 过范围）。
 *
 * 分段物化（2026-09-17，照希格莉德 `countBasicSegments` 先例）：
 * - 平A池按 #1→#2→#3→#4→落雷 循环**整轮**计数，分段落进**真实 moveId 行**（元素/倍率/失衡/积蓄各自成立）；
 * - 只计**完整循环**，余量留在 `basic_attack` 聚合行（时间守恒）；
 * - 聚合行降级为时间/回能/喧响载体（伤害/失衡/积蓄归零防双算）——回能源于整段平A时长，
 *   段行不带回能（`energyRecovery: 0`），与 `agent:1591/出枪式段时间` 同一条口径。
 *
 * 其余已实现：
 * - 额外能力·并联电路：同属性/同阵营队友触发（spec.additionalAbility）→ 闪避反击命中回 7.2 能量、
 *   5s 至多一次。整局能量 = min(dodgeCounterCount, floor(combatTime/5)) × 7.2，converge 阶段并入 initialEnergyGift。
 * - 影画2·精准放电：落雷命中失衡敌伤害 +30%（× 失衡覆盖率）；强化特殊技命中未失衡敌失衡 +10%（× (1-覆盖率)）。
 *   覆盖率滑块 `anby.c2StunCoverage`（默认 0.5）。
 * - 影画4·电荷传导：连携/终结为后场电属性角色回 `3 + min(6, floor(自身能量获得效率/12)×2)` 能量
 *   （applyTeamConfig postRound 阶段直接写入后场电队友 initialEnergyGift，幂等）。
 */

const ANBY_ID = '1011'
const MOVE_EX = '1011007' // 强化特殊技：苍雷斩
const MOVE_SPECIAL = '1011006' // 特殊技：电光挥击
const MOVE_LIGHTNING = '1011005' // 普通攻击：落雷
const MOVE_BASIC_POOL = 'basic_attack'
/** 伏特速攻 #1~#4 + 落雷：平A循环分段（真实 moveId，顺序 = 循环顺序） */
const ANBY_BASIC_CYCLE_IDS = ['1011001', '1011002', '1011003', '1011004', MOVE_LIGHTNING] as const

/** 核心被动·波动电压 Lv.7 失衡值提升（%） */
export const ANBY_CORE_STUN_BONUS = 64
/** 额外能力·并联电路：闪反回能 */
export const ANBY_AA_ENERGY = 7.2
/** 并联电路 CD（秒） */
export const ANBY_AA_CD = 5
/** 影画1 快充模式：能量获得效率（%） */
export const ANBY_C1_ENERGY_EFF = 12
/** 影画2 落雷命中失衡敌增伤（%） */
export const ANBY_C2_LIGHTNING_DMG = 30
/** 影画2 强特命中未失衡敌失衡（%） */
export const ANBY_C2_EX_STUN = 10
/** 影画4 电荷传导：基础回能 */
export const ANBY_C4_BASE_ENERGY = 3
/** 影画4 每 12% 能量效率额外回能 */
export const ANBY_C4_ENERGY_STEP = 2
/** 影画4 额外回能上限 */
export const ANBY_C4_ENERGY_CAP = 6
/** 影画6·充能电场：每次强化特殊技获得层数（同时是上限，原文「获得8层充能（上限8层）」） */
export const ANBY_C6_CHARGES_PER_EX = 8
/** 影画6·充能电场：消耗 1 层使当前招式增伤（%） */
export const ANBY_C6_CHARGE_DMG = 45

/**
 * 波动电压 作用的招式集合（**招式限定**，2026-09-17 用户裁决①）：
 * 落雷 / 特殊技 / 强化特殊技各 +64% 失衡。
 * ⚠ 伏特速攻 #1~#4 **不在内**（此前经 `basic_attack` 聚合行误吃整池 +64%）。
 */
export const ANBY_CORE_STUN_MOVE_IDS = new Set([MOVE_LIGHTNING, MOVE_SPECIAL, MOVE_EX])

/** 并联电路整局能量 = min(闪反次数, floor(战斗时间/5)) × 7.2 */
export function computeAnbyParallelCircuitEnergy(dodgeCounterCount: number, combatTime: number): number {
  const dodge = Math.max(0, Math.floor(Number(dodgeCounterCount) || 0))
  const t = Math.max(0, Number(combatTime) || 0)
  const triggers = Math.min(dodge, Math.floor(t / ANBY_AA_CD))
  return triggers * ANBY_AA_ENERGY
}

/** 影画4 电荷传导：单次连携/终结为后场电角色回复的能量 */
export function computeAnbyC4ChargeEnergy(energyGainEfficiency: number): number {
  const eff = Math.max(0, Number(energyGainEfficiency) || 0)
  const extra = Math.min(ANBY_C4_ENERGY_CAP, Math.floor(eff / 12) * ANBY_C4_ENERGY_STEP)
  return ANBY_C4_BASE_ENERGY + extra
}

/**
 * 影画6 可消费命中数 = min(8 × 强特次数, 平A命中数 + 冲刺攻击命中数)。
 *
 * 原文「发动[强化特殊技]时，安比获得8层充能（上限8层）；[普通攻击]或[冲刺攻击]命中敌人时，
 * 消耗1层充能」。每次强特恰好灌满上限 8 层 ⇒ 只要在下次强特前打满 8 下就不浪费；
 * 上限语义因此等价于「8 × 强特次数」的预算，再被实际命中数封顶。
 *
 * ⚠ 冲刺攻击（1011008）当前不在执行计划里（无独立行）⇒ `dashHits` 由调用方给 0——
 * 属**已有通道缺口**（与「平A池不区分冲刺段」同源），不是本次口径选择。
 */
export function computeAnbyChargeConsumed(exSpecialCount: number, basicHits: number, dashHits = 0): number {
  const ex = Math.max(0, Number(exSpecialCount) || 0)
  const hits = Math.max(0, Number(basicHits) || 0) + Math.max(0, Number(dashHits) || 0)
  return Math.max(0, Math.min(ANBY_C6_CHARGES_PER_EX * ex, hits))
}

function applyAnbyPanel({ panel, cinemaLevel, settings }: AgentPanelInput): void {
  // 影画1 快充模式
  if (cinemaLevel >= 1) {
    const cov = clampRatio(settings['anby.fastChargeCoverage'] ?? 1)
    panel.energyGainEfficiency = (panel.energyGainEfficiency ?? 0) + ANBY_C1_ENERGY_EFF * cov
  }
  // 影画6 充能电场**不再走面板级**（2026-09-17 录入修正③）：原文限定「消耗充能的**当前招式** +45%」，
  // 面板级全局 +45 会让强特/终结/连携/异常全部吃满（旧实现实测：C6 无充能输入也 +45）。
  // 改为 `buildAnbyExecutions` 按可消费命中数挂**执行级** dmgBonus（见下）。
}

/** 读机制滑块（`helpers.ts:632` 已把已注册滑块按 `setting:<id>` 写进 cfg）。
 *
 * ⚠ 历史缺陷（2026-09-20 round 48 管理员AA 分诊实测，与般岳 `rageGainCoverage` 同源）：
 * `patchAnbyExecutions` 读的是 `record.anbyC2StunCoverage`——该字段**全仓无人写入**
 * （`buildAnbyCharConfig` 不写、派发器也不写）⇒ 永远回落 `?? 0.5`，
 * 滑块 `anby.c2StunCoverage` 在 UI 上可拖但**恒等于 0.5**：实测滑块 0 与 1 的
 * 落雷 `dmgBonus` **都是 15**（真管线 `computePanelPhases` 与执行级双证）。
 * 修法按 `evelyn.ts`/`koleda.ts`/`soldier11.ts` 同款：走 `setting:` 前缀读**已注册**的滑块 id。
 */
function cfgNum(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function buildAnbyCharConfig({ cfg, cinemaLevel, panel, skills }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.anbyCinemaLevel = Math.max(0, Math.floor(Number(cinemaLevel ?? 0)))
  record.anbyAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  record.anbyEnergyGainEfficiency = panel.energyGainEfficiency ?? 0
  // 影画2 失衡覆盖率：滑块 → cfg 的**唯一**通道（读法见 cfgNum 头注释）
  record.anbyC2StunCoverage = cfgNum(cfg, 'anby.c2StunCoverage', 0.5)
  // 平A循环分段元数据预存（buildExecutions 输入无 skills；单一事实源仍是倍率表）。
  // 元素取 catalog 的 move.damageElement——#1~#3 物理 / #4、落雷 电（原文口径，见文件头②）。
  const basicMoves = skills?.categories?.find(c => c.id === 'basic')?.moves ?? []
  const cycle = ANBY_BASIC_CYCLE_IDS.map(moveId => {
    const move = basicMoves.find(m => String(m.id) === moveId)
    return {
      moveId,
      actionTime: move?.actionTime ?? 0,
      element: move?.damageElement ?? 'electric',
      moveName: move?.name?.zhCN || moveId,
    }
  })
  record.anbyBasicCycle = cycle
}

/** 并联电路（converge）+ 影画4 电荷传导（postRound）回能，幂等并入各槽初始能量礼物 */
// 本模块那份 cfg 由派发器直给（`characters` 按位置压缩，`characters[slot]` 在空槽时取错对象）。
function applyAnbyTeamConfig({ cfg, slot, cinemaLevel, characters, team, phase, combatTime, stunCount, ultimateCounts }: AgentTeamConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>

  if (phase === 'converge') {
    // 并联电路：闪反回 7.2 能量/5s（additionalAbility 门控）
    const active = record.anbyAdditionalActive === true
    const gift = active
      ? computeAnbyParallelCircuitEnergy(cfg.dodgeCounterCount ?? 0, combatTime)
      : 0
    const prev = Math.max(0, Number(record.anbyParallelEnergyTotal ?? 0))
    cfg.initialEnergyGift = Math.max(0, (cfg.initialEnergyGift ?? 0) - prev) + gift
    record.anbyParallelEnergyTotal = gift
  }

  if (phase === 'postRound' && cinemaLevel >= 4) {
    // 影画4 电荷传导：连携/终结为后场电角色回 3+min(6,floor(能量效率/12)×2) 能量
    const chainTotal = cfg.chainCountTotalOverride ?? (cfg.chainCountPerStun ?? 0) * stunCount
    const ult = Math.max(0, Math.floor(Number(ultimateCounts?.[slot] ?? 0)))
    const triggers = Math.max(0, Math.floor(chainTotal)) + ult
    const perTrigger = computeAnbyC4ChargeEnergy(Number(record.anbyEnergyGainEfficiency ?? 0))
    const energy = triggers * perTrigger
    for (const mate of team) {
      if (mate.slot === slot) continue
      if (mate.agent?.damageElement !== 'electric') continue
      // ⚠ 队友那份 cfg 按**身份**查，不按 `characters[mate.slot]` 下标——`characters` 按位置
      // 压缩（空槽被跳过），槽位号 ≠ 下标：前导/中间空槽时会把能量写进**别人那份 cfg**。
      const mateCfg = characters.find(c => c.slot === mate.slot)
      if (!mateCfg) continue
      const mateRecord = mateCfg as unknown as Record<string, unknown>
      const prevC4 = Math.max(0, Number(mateRecord.anbyC4EnergyTotal ?? 0))
      mateCfg.initialEnergyGift = Math.max(0, (mateCfg.initialEnergyGift ?? 0) - prevC4) + energy
      mateRecord.anbyC4EnergyTotal = energy
    }
  }
}

/**
 * 平A分段物化 + 影画6 充能消耗（执行级）。
 * 结构同希格莉德 `buildSigridExecutions`：分段行承载伤害/失衡/积蓄，聚合行保留时间与回能。
 *
 * ⚠ 分段行的 `element` 取 catalog `move.damageElement`（原文口径②）——**不能**写死角色元素，
 *   否则 #1~#3 会重新吃上电属性加成（本批正是来修这个）。
 */
function buildAnbyExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cycle = (record.anbyBasicCycle as
    | { moveId: string; actionTime: number; element: string; moveName: string }[]
    | undefined) ?? []
  const poolIdx = executions.findIndex(e => e.moveId === MOVE_BASIC_POOL)
  const basicTime = Math.max(0, Number(state.basicAttackTime ?? 0))
  if (poolIdx < 0 || cycle.length !== ANBY_BASIC_CYCLE_IDS.length || basicTime <= 0) return
  const cycleTime = cycle.reduce((sum, seg) => sum + Math.max(0, seg.actionTime), 0)
  if (cycleTime <= 0) return
  // 只计**完整**循环；余量留在聚合行（总时间守恒，不产生超出平A池的尾巴行）。
  // 与希格莉德「命中起点在窗内即计」的尾巴口径**刻意不同**——那种记法会让段行总时长超过平A池。
  const fullCycles = Math.floor(basicTime / cycleTime)
  if (fullCycles <= 0) return

  const cinema = Math.max(0, Math.floor(Number(record.anbyCinemaLevel ?? 0)))
  const totalHits = fullCycles * cycle.length
  let chargesLeft = cinema >= 6
    ? computeAnbyChargeConsumed(Number(state.exSpecialCount ?? 0), totalHits)
    : 0

  let segTime = 0
  for (const seg of cycle) {
    const hits = fullCycles
    if (hits <= 0) continue
    const charged = Math.min(chargesLeft, hits)
    chargesLeft -= charged
    segTime += hits * seg.actionTime
    // 未吃充能的部分（影画6 前 / 充能耗尽后）
    pushAnbyBasicSegment(executions, seg, hits - charged, 0)
    // 吃充能的部分：同一 moveId 的第二行（伤害池按 moveId 去重加序号），+45% 只落这一行
    pushAnbyBasicSegment(executions, seg, charged, ANBY_C6_CHARGE_DMG)
  }

  // 聚合行降级为时间/回能/喧响载体：时间挤掉段行占用（守恒），伤害/失衡/积蓄归零防双算。
  // 回能与喧响**不动**——它们由 core 按 `state.basicAttackTime × cfg.basicAttack*PerSec` 写在
  // 聚合行上（段行 energyRecovery/decibelRecovery 恒 0），缩时间不会丢能量。
  const pool = executions[poolIdx]
  const poolTime = Math.max(0, (pool.totalTime ?? 0) - Math.min(pool.totalTime ?? 0, segTime))
  executions[poolIdx] = {
    ...pool,
    totalTime: poolTime,
    damageMultiplier: 0,
    damageMultiplierOverride: true,
    dazeMultiplier: 0,
    dazeMultiplierOverride: true,
    anomalyBuildUp: 0,
    skillTableNote: `平A分段已物化（${cycle.length} 段 × ${fullCycles} 轮）：伤害/失衡/积蓄由分段行承载，本行只作时间与回能载体（余量 ${poolTime.toFixed(2)}s）。`,
  }
  record.anbyBasicChargedHits = totalHits - chargesLeft
  record.anbyBasicHitTotal = totalHits
}

/** 单条平A分段执行行：真实 moveId ⇒ enrich 从倍率表回填伤害/失衡/积蓄（元素随 catalog 每招口径）。 */
function pushAnbyBasicSegment(
  executions: SkillExecution[],
  seg: { moveId: string; actionTime: number; element: string; moveName: string },
  count: number,
  dmgBonus: number,
): void {
  if (count <= 0) return
  const note = dmgBonus > 0
    ? `影画6 充能电场：消耗充能命中 ${count} 次，当前招式 +${dmgBonus}%（执行级）`
    : ''
  executions.push({
    moveId: seg.moveId,
    moveName: seg.moveName,
    category: 'basic',
    element: seg.element,
    count,
    actionTime: seg.actionTime,
    comboAlignRatio: 0,
    totalTime: count * seg.actionTime,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    ...(dmgBonus > 0 ? { dmgBonus, skillTableNote: note } : {}),
  })
}

/** 波动电压（招式限定失衡+64%）+ 影画2（落雷增伤/强特失衡，同招式限定） */
function patchAnbyExecutions({ cfg, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.anbyCinemaLevel ?? 0)))
  const stunCov = clampRatio(Number(record.anbyC2StunCoverage ?? 0.5))
  for (const exec of executions) {
    if (!exec.moveId) continue
    // 波动电压：落雷/特殊技/强特 失衡 +64%（招式限定；平A聚合行不再吃）
    if (ANBY_CORE_STUN_MOVE_IDS.has(exec.moveId)) {
      exec.stunBuildUpBonus = (exec.stunBuildUpBonus ?? 0) + ANBY_CORE_STUN_BONUS
    }
    if (cinema >= 2) {
      // 影画2：落雷命中失衡敌伤害 +30%（招式限定——此前挂在 basic 聚合行上，会连伏特速攻一起加成）
      if (exec.moveId === MOVE_LIGHTNING) {
        exec.dmgBonus = (exec.dmgBonus ?? 0) + ANBY_C2_LIGHTNING_DMG * stunCov
      }
      // 影画2：强特命中未失衡敌失衡 +10%
      if (exec.moveId === MOVE_EX) {
        exec.stunBuildUpBonus = (exec.stunBuildUpBonus ?? 0) + ANBY_C2_EX_STUN * (1 - stunCov)
      }
    }
  }
}

function buildAnbyResourceResult({ cfg, state }: AgentResourceResultInput) {
  const spec = getAgentSpec(ANBY_ID)
  return {
    specResources: spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {},
  }
}

function buildAnbyResourceSections(input: AgentResourceSectionsInput) {
  const spec = getAgentSpec(ANBY_ID)
  return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
}

function clampRatio(v: number): number {
  return Math.max(0, Math.min(1, Number(v) || 0))
}

export const anbyMechanic: AgentMechanicModule = {
  id: 'agent:1011',
  agentIds: [ANBY_ID],
  name: '安比·波动电压',
  description: '核心被动波动电压（落雷/特殊技/强特 失衡+64% 招式限定）+ 额外能力并联电路（闪反回能）+ 影画1 快充/影画2 精准放电（落雷限定）/影画4 电荷传导（后场电角色回能）/影画6 充能（执行级 +45% 按消耗次数）。',
  settings: [
    {
      id: 'anby.fastChargeCoverage',
      label: '安比·影画1 快充覆盖率',
      description: '普攻第四段命中 → 能量获得效率 +12%（30s 刷新），按覆盖率折算，默认 100%。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      id: 'anby.c2StunCoverage',
      label: '安比·影画2 失衡覆盖率',
      description: '落雷命中失衡敌人增伤 +30%（×覆盖率）；强特命中未失衡敌人失衡 +10%（×(1-覆盖率)）。默认 0.5。',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
    },
  ],
  applyPanel: applyAnbyPanel,
  buildCharConfig: buildAnbyCharConfig,
  buildExecutions: buildAnbyExecutions,
  applyTeamConfig: applyAnbyTeamConfig,
  patchExecutions: patchAnbyExecutions,
  buildResourceResult: buildAnbyResourceResult,
  resourceSections: buildAnbyResourceSections,
}
