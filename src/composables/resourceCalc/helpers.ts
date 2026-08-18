/**
 * 资源池计算 composable
 *
 * 从 config store 获取队伍配置 → 计算面板 → 构建资源池计算配置 → 调用计算引擎
 *
 * 数据流：
 *   configStore.team (3角色配置)
 *     → calcPanel (面板计算，复用 TeamConfigPage 同逻辑)
 *     → findExSpecial / findUltimate / findChainAttack / calcBasicAttackRegenPerSec (技能数据提取)
 *     → CharacterOperationConfig[] (资源池配置)
 *     → calcTeamResources (迭代计算)
 *     → TeamResourceResult (结果)
 *     → calcStunPool / calcAnomalyPool (失衡池 + 积蓄池)
 */
import { computed } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { calcPanel, emptyPanel } from '@/core/panel'
import { applyTargetedStat } from '@/core/buff'
import { calcDirectDamage, calcAnomalyDamage } from '@/core/damage'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import {
  calcTeamResources,
  findExSpecial,
  findUltimate,
  findChainAttack,
  findDefensiveAssist,
  findAssistFollowUp,
  findDodgeCounter,
  calcBasicAttackRegenPerSec,
  findRemielleRainbowEnd,
  findRemielleRadiantTurn,
  ULTIMATE_COST_DEFAULT,
} from '@/core/resource'
import { calcStunPool } from '@/core/stunPool'
import type { StunSkillExecution } from '@/core/stunPool'
import { calcAnomalyPool, calcSpecialActionBonus } from '@/core/anomalyPool'
import type { AnomalySkillExecution } from '@/core/anomalyPool'
import { getAgentMechanic, getRegisteredAgentMechanics, type MechanicTeamMember } from '@/mechanics'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import type {
  CharacterOperationConfig,
  ResourceCalcConfig,
  TeamResourceResult,
  StunPoolResult,
  AnomalyPoolResult,
  SpecialActionBonusResult,
  SkillExecution,
  AnomalyEventRecord,
  AnomalyProgress,
} from '@/types/resource'
import type { PanelValues, TeammateBuff, AgentSkills, SkillMove, Agent } from '@/types/catalog'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { fmt } from '@/utils/format'
import { getRowFusionMultiplier } from '@/logicEditor/fusion'

/** 判断字符串是否为百分比型属性（决定 applyStat 用 pct 还是 flat） */


export type DamagePoolRow = {
  id: string
  slot: number
  agentId: string
  agentName: string
  type: '直伤' | '异放' | '乱流' | '耀变' | '特殊虚耀' | '灼烧' | '感电' | '侵蚀' | '风化' | '强击' | '极性强击' | '碎冰' | '简6命附伤' | '紊乱' | '爱丽丝6命附伤'
  name: string
  element: string
  source: string
  count: number
  perDamage: number
  totalDamage: number
  note: string
  /** 来源招式 moveId（直伤行有值，异常行 undefined） */
  moveId?: string
  /** 来源标签：gift=队友赠送（诺姆转连携/琉音转大等）、stun=失衡送连携、self=自身攒 */
  sourceTag?: 'gift' | 'stun' | 'self'
  /** 失衡易伤乘数（轴启用时按轴内位置分配，默认 1） */
  stunMult?: number
}

export function parseReleaseMultiplier(event: { formula?: string; fields?: string[] }): number {
  const text = `${event.formula ?? ''} ${(event.fields ?? []).join(' ')}`
  const match = text.match(/releaseMultiplier\s*=\s*(\d+(?:\.\d+)?)/i)
  return match ? Number(match[1]) : 0
}

export function safeElement(element?: string): any {
  return (element || 'physical') as any
}


export const DAMAGE_ELEMENT_LABELS: Record<string, string> = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风',
  lumiflux: '辉光',
  physical_polar_assault: '极性强击',  // 爱丽丝物理变种
  ether_ink: '玄墨',                  // 仪玄以太变种（独立积蓄槽）
  frostfire: '烈霜',                     // 雅独立元素
}

export function elementLabel(element: string): string {
  return DAMAGE_ELEMENT_LABELS[element] ?? element
}

export function isPctStat(stat: string): boolean {
  return stat.endsWith('Pct') || stat.endsWith('Rate') || stat.endsWith('Dmg') ||
    stat.endsWith('Ratio') || stat.endsWith('Mastery') || stat.endsWith('Regen') ||
    stat.endsWith('Impact') || stat.endsWith('Efficiency') || stat.endsWith('Bonus')
}

export function buildMechanicTeamMembers(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): MechanicTeamMember[] {
  return configStore.team.map((char, slot) => ({
    slot,
    agentId: char.agentId,
    agent: char.agentId ? catalogStore.getAgent(char.agentId) ?? null : null,
    cinemaLevel: char.cinemaLevel ?? 0,
    wEngineId: char.wEngineId ?? '',
    wEngineModLevel: char.wEngineModLevel ?? 1,
  }))
}

/** 角色 combatBuffs 是否已自带 3/5 命技能等级提升（避免通用规则重复叠加） */
function agentHasCinemaSkillLevelBuff(agent: any): boolean {
  return (agent?.combatBuffs?.cinemaBuffs ?? []).some((cinema: any) =>
    (cinema.buff?.effects ?? []).some((e: any) => e.stat === 'skillLevelBonus'),
  )
}

export function resolveRemielleDazeBonus(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  slot: number,
  agent: Agent,
): number {
  const team = buildMechanicTeamMembers(configStore, catalogStore)
  const faction = agent.faction
  const active = team.some(member => {
    if (member.slot === slot || !member.agent) return false
    return member.agent.specialty === 'anomaly' || (!!faction && member.agent.faction === faction)
  })
  const anomalyCount = team.filter(member => member.agent?.specialty === 'anomaly').length
  const tier = active ? Math.max(1, Math.min(3, anomalyCount)) : 0
  return [0, 6, 12, 35][tier] ?? 0
}

/** 计算单个角色的局内面板（复用 TeamConfigPage 同逻辑） */
export function computePanel(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): PanelValues | null {
  return computePanelPhases(slot, configStore, catalogStore)?.inCombat ?? null
}

/**
 * 计算最终面板的局外/局内两阶段（供最终面板展示：局外 = calcPanel.outOfCombat，
 * 局内 = 在局外基础上叠队友/全局 buff 与角色机制 applyPanel 修正后的权威面板，与计算完全一致）。
 */
export function computePanelPhases(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): { outOfCombat: PanelValues; inCombat: PanelValues } | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null

  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return null

  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined

  const { enabledTeammateBuffs, sourcePanelsByOwner } = buildTeammateBuffSourceContext(configStore.team, {
    teammateBuffGroups: catalogStore.teammateBuffGroups,
    driveDiscSetsMap: catalogStore.driveDiscSetsMap,
    statRules: catalogStore.statRules,
    getAgent: (id) => catalogStore.getAgent(id),
    getWEngine: (id) => catalogStore.getWEngine(id),
    isTeammateBuffEnabled: (id) => configStore.isTeammateBuffEnabled(id),
  })

  // 全局 Buff（属性配置页手动添加）转 TeammateBuff 并入 calcPanel 同批 apply：
  // 修复架构问题——此前全局 atkPct 等 core stat 在 calcPanel finalize 后补 apply，
  // applyCoreStatBonus 会把"当前合并 atk（含模块/硬编码块直加的局内固定值）"当 base 重新乘百分比，
  // 导致局内固定加成（如诺姆 870 / 琉音 500）被局内百分比错误放大（×1.2）。
  // 并入 calcPanel 后：局内 = 局外结果 × (1 + Σ局内%) + Σ局内固定，公式正确。
  const globalAsTeammateBuffs: TeammateBuff[] = configStore.globalBuffs
    .filter(b => b.enabled)
    .map(b => ({
      id: `global-${b.id}`,
      source: { zhCN: '全局Buff' },
      description: { zhCN: b.name },
      scope: 'inCombat' as const,
      effects: [{
        id: `global-${b.id}-effect`,
        type: 'fixed' as const,
        target: { kind: 'default' as const },
        stat: b.stat as TeammateBuff['effects'][number]['stat'],
        mode: (isPctStat(b.stat) ? 'pct' : 'flat') as 'pct' | 'flat',
        value: b.value,
        ...(b.targetSkillType && b.targetSkillType !== 'all' ? { targetSkillType: b.targetSkillType } : {}),
      }],
      buffModifiers: [],
      sourceType: 'teammate' as const,
      sourceCategory: 'agent' as const,
      sourceKind: 'global' as const,
      sourceLabel: { zhCN: '全局Buff' },
      ownerId: '',
      ownerName: { zhCN: b.name },
      teammateId: '',
      teammateName: { zhCN: b.name },
    }))
  const allTeammateBuffs = [...enabledTeammateBuffs, ...globalAsTeammateBuffs]

  // 计算面板
  const result = calcPanel(
    agent,
    wEngine,
    char.driveDisc,
    catalogStore.driveDiscSetsMap,
    allTeammateBuffs,
    catalogStore.statRules,
    {
      cinemaLevel: char.cinemaLevel,
      wEngineModLevel: char.wEngineModLevel,
      sourcePanelsByOwner,
      effectCoverageMap: configStore.getWEngineEffectCoverageMap(),
    },
  )

  // 局内面板（全局 buff 已并入 calcPanel，不再后补）
  const panel: PanelValues = { ...result.inCombat }
  // 局外回能总计（基础 × 局外加成 + 固定），供回能转模按局外口径读取。
  panel.energyRegenOutOfCombat = (result.outOfCombat.energyRegen ?? 1.2)
    * (1 + (result.outOfCombat.energyRegenBonusPct ?? 0) / 100)
    + (result.outOfCombat.energyRegenBonusFlat ?? 0)
  const team = buildMechanicTeamMembers(configStore, catalogStore)
  // 额外能力触发条件统一判定（声明式 spec.additionalAbility）：满足才写面板标记，模块/伤害池按标记开关。
  const aaSpec = getAgentSpec(agent.id)?.additionalAbility
  if (aaSpec) {
    panel.additionalAbilityActive = evalAdditionalAbility(team, slot, agent, aaSpec) ? 1 : 0
  }
  getAgentMechanic(agent.id)?.applyPanel?.({
    slot,
    agent,
    cinemaLevel: char.cinemaLevel ?? 0,
    team,
    panel,
  })
  if (agent.id === '1531') {
    // 星徽·比利（模块 starlightBilly 的覆盖率面板块；applyPanel 阶段无 configStore，故在此施加）：
    // - 核心被动：接战状态每次动力压制后暴伤 +90%（Lv.7，45s 刷新）× 覆盖率滑块（默认 100%）
    // - 影画4：动力压制每次暴伤 +8%（至多 2 层 = 16%，45s 刷新）× 覆盖率滑块（默认 100%）
    // - 影画1：强化特殊技命中后自身攻击无视 18% 物理抗性（45s 刷新）× 覆盖率滑块（默认 100%）
    const cinema = char.cinemaLevel ?? 0
    const coreCoverage = configStore.getMechanicSetting('1531.driveSuppressionCritDmgCoverage', 1)
    const c4Coverage = configStore.getMechanicSetting('1531.c4CritDmgCoverage', 1)
    const c1Coverage = configStore.getMechanicSetting('1531.c1ResIgnoreCoverage', 1)
    panel.critDmg = (panel.critDmg ?? 0) + 90 * coreCoverage
    if (cinema >= 4) {
      panel.critDmg = (panel.critDmg ?? 0) + 8 * 2 * c4Coverage
    }
    if (cinema >= 1) {
      panel.enemyPhysicalResReduction = (panel.enemyPhysicalResReduction ?? 0) + 18 * c1Coverage
    }
  }
  if (agent.id === '1011') {
    // 安比影画1 快充模式：[普通攻击]第四段斩击命中敌人时能量获得效率 +12%（持续 30s），
    // 按时段覆盖率折算（覆盖率滑块默认 100%）。
    const cinema = char.cinemaLevel ?? 0
    if (cinema >= 1) {
      const coverage = configStore.getMechanicSetting('anby.fastChargeCoverage', 1)
      panel.energyGainEfficiency = (panel.energyGainEfficiency ?? 0) + 12 * coverage
    }
  }
  if (agent.id === '1041') {
    // 「11号」额外能力·燎原（队伍存在同属性或同阵营角色）：
    // 火属性伤害 +10%；攻击失衡敌人额外 +22.5% × 覆盖率滑块（非轴模式默认满覆盖）。
    // 暴伤 +48%（潜能最高档）在模块 applyPanel 施加。
    if ((panel.additionalAbilityActive ?? 0) > 0) {
      panel.fireDmg = (panel.fireDmg ?? 0) + 10
      const stunCov = configStore.getMechanicSetting('soldier11.prairieFireStunCoverage', 1)
      panel.fireDmg = (panel.fireDmg ?? 0) + 22.5 * stunCov
    }
  }
  if (agent.id === '1321') {
    // 伊芙琳影画2 赴火之舞：攻击力提升 15%（燎火返还部分未建模，见 status pending）。
    const cinema = char.cinemaLevel ?? 0
    if (cinema >= 2) {
      panel.atk = Math.round(panel.atk * (1 + 0.15))
    }
  }
  if (agent.id === '1331') {
    // 薇薇安影画2《暴风雨夜，暴风雨夜》：以太异常积蓄效率 +25%
    //（异放精通收益 130% 与无视 15% 全属性抗性部分未建模，见 status pending）。
    const cinema = char.cinemaLevel ?? 0
    if (cinema >= 2) {
      panel.etherAnomalyBuildUpEfficiency = (panel.etherAnomalyBuildUpEfficiency ?? 0) + 25
    }
  }
  if (agent.id === '1551') {
    // 佩洛伊斯影画1 黄昏旧章：暴击率 +8%（进场喧响 1000 在模块 buildCharConfig 注入）。
    const cinema = char.cinemaLevel ?? 0
    if (cinema >= 1) {
      panel.critRate = (panel.critRate ?? 0) + 8
    }
    // 额外能力：队伍存在[击破]/[支援]角色时暴伤 +40%（连携回 300 喧响未建模，见 status pending）。
    if ((panel.additionalAbilityActive ?? 0) > 0) {
      panel.critDmg = (panel.critDmg ?? 0) + 40
    }
  }
  if (agent.id === '1481' || agent.teammateBuffId === '1481') {
    // 影画4：好评如潮状态下攻击力 +500，默认满覆盖（用户可在资源利用率页调节覆盖率）。
    const atkBonus = panel.liuyinGoodReviewAtkBonus ?? 0
    if (atkBonus > 0) {
      const coverage = configStore.getMechanicSetting('liuyin.goodReviewAtkCoverage', 1)
      panel.atk = (panel.atk ?? 0) + atkBonus * coverage
    }
  }
  if (agent.id === '1571' || agent.teammateBuffId === '1571') {
    // 诺姆额外能力·集群优势：嗯呢弹幕期间攻击 +44~870（Lv7 满级 870，按弹幕覆盖率折算）。
    // buildCharConfig 也写入 cfg.panel（计算用），此处补进最终面板展示，保证"最终面板包含一切实际计算"。
    if ((panel.additionalAbilityActive ?? 0) > 0) {
      // 满覆盖（用户确认去弹幕覆盖率滑块，嗯呢弹幕易全程覆盖）
      panel.atk = (panel.atk ?? 0) + 870
    }
  }
  if (agent.id === '1581' || agent.teammateBuffId === 'remielle') {
    panel.remielleRadiantTurnDazeBonusPct = resolveRemielleDazeBonus(configStore, catalogStore, slot, agent)
  }
  if (agent.id === '1261' || agent.teammateBuffId === '1261') {
    const cinema = char.cinemaLevel ?? 0
    const passionCoverage = configStore.getMechanicSetting('jane.passionCoverage', 0.9)
    const anomalyProficiency = panel.anomalyProficiency ?? 0

    // 狂热：物理积蓄+25%；精通>120时每点+2攻击，最多600。
    panel.physicalAnomalyBuildUpEfficiency += 25 * passionCoverage
    if (anomalyProficiency > 120) {
      panel.atk += Math.min(600, (anomalyProficiency - 120) * 2) * passionCoverage
    }

    // 额外能力：痛点。物理积蓄+20%；敌人处于异常状态时额外+15%（按100%覆盖）。
    const team = buildMechanicTeamMembers(configStore, catalogStore)
    const additionalActive = team.some(member =>
      member.slot !== slot && member.agent && (
        member.agent.specialty === 'anomaly' || member.agent.faction === agent.faction
      ),
    )
    if (additionalActive) {
      panel.physicalAnomalyBuildUpEfficiency += 20
      panel.physicalAnomalyBuildUpEfficiency += 15
    }

    // 1命：物理积蓄+15%；每点精通增伤0.1%，最多30%，按狂热覆盖率折算。
    if (cinema >= 1) {
      panel.physicalAnomalyBuildUpEfficiency += 15 * passionCoverage
      panel.dmgBonus += Math.min(30, anomalyProficiency * 0.1) * passionCoverage
    }

    // 6命：触发强击即狂热，狂热覆盖率按100%；双暴+20/40。
    if (cinema >= 6) {
      panel.critRate += 20
      panel.critDmg += 40
    }
  }

  // 蕾米强特 Radiant Turn 的“相变时流”：全队增伤，按技能等级 12/14/16 对应 18%/21%/24%。
  const phaseFlowRemielleSlot = configStore.team.findIndex(char => {
    const member = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return member?.id === '1581' || member?.teammateBuffId === 'remielle'
  })
  if (phaseFlowRemielleSlot >= 0) {
    const remielleCinema = configStore.team[phaseFlowRemielleSlot]?.cinemaLevel ?? 0
    const remielleSkillLevelBonus = remielleCinema >= 5 ? 4 : remielleCinema >= 3 ? 2 : 0
    panel.dmgBonus += (12 + remielleSkillLevelBonus) * 1.5
  }
  // 3命技能等级+2、5命+4，统一进入伤害/失衡倍率系数；角色buff已带此条的跳过通用规则
  const cinema = char.cinemaLevel ?? 0
  if (!agentHasCinemaSkillLevelBuff(agent)) {
    panel.skillLevelBonus = (panel.skillLevelBonus ?? 0) + (cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0)
  }

  // 入队时长加成按元素写入面板，异常池覆盖率/紊乱/乱流统一读取
  panel.physicalAnomalyDurationBonusSeconds = getTeamAnomalyDurationBonus(configStore, catalogStore, 'physical')
  panel.fireAnomalyDurationBonusSeconds = getTeamAnomalyDurationBonus(configStore, catalogStore, 'fire')
  panel.electricAnomalyDurationBonusSeconds = getTeamAnomalyDurationBonus(configStore, catalogStore, 'electric')
  panel.etherAnomalyDurationBonusSeconds = getTeamAnomalyDurationBonus(configStore, catalogStore, 'ether')

  // 风化侵染区：10% 独立乘区，仅风属性与染色属性直伤生效
  const windCharInTeam = configStore.team.some(char => {
    const member = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return member?.damageElement === 'wind'
  })
  panel.infectionZoneBonus = windCharInTeam ? 10 : 0

  return { outOfCombat: { ...result.outOfCombat }, inCombat: panel }
}

/** 计算蕾米特殊虚耀使用的“进场记录面板”：只吃自身被动/命座/音擎/驱动盘，不吃队友战内拐力 */
export function computeRemielleEntryPanel(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): PanelValues | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null

  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return null

  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined

  const result = calcPanel(
    agent,
    wEngine,
    char.driveDisc,
    catalogStore.driveDiscSetsMap,
    [],
    catalogStore.statRules,
    {
      cinemaLevel: char.cinemaLevel ?? 0,
      wEngineModLevel: char.wEngineModLevel ?? 1,
      effectCoverageMap: configStore.getWEngineEffectCoverageMap(),
    },
  )
  const panel = { ...result.inCombat }
  const cinema = char.cinemaLevel ?? 0
  if (!agentHasCinemaSkillLevelBuff(agent)) {
    panel.skillLevelBonus = (panel.skillLevelBonus ?? 0) + (cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0)
  }
  return panel
}

/** 从 SkillMove 的 rows 中提取指定 row 的值 */
export function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  const row = move.rows.find(r => r.id === rowId)
  return (row?.values[0] ?? 0) * getRowFusionMultiplier(move.id, rowId)
}

export const ELEMENT_DMG_KEYS: Record<string, string> = {
  physical: 'physicalDmg',
  fire: 'fireDmg',
  ice: 'iceDmg',
  electric: 'electricDmg',
  ether: 'etherDmg',
  wind: 'windDmg',
  lumiflux: 'lumifluxDmg',
  physical_polar_assault: 'physicalDmg',  // 物理变种，使用物理增伤
}

export const ELEMENT_DEF_REDUCTION_KEYS: Record<string, string> = {
  physical: 'enemyPhysicalDefReduction',
  fire: 'enemyFireDefReduction',
  ice: 'enemyIceDefReduction',
  electric: 'enemyElectricDefReduction',
  ether: 'enemyEtherDefReduction',
  wind: 'enemyWindDefReduction',
  lumiflux: 'enemyLumifluxDefReduction',
  physical_polar_assault: 'enemyPhysicalDefReduction',  // 物理变种
}

export const ELEMENT_RES_REDUCTION_KEYS: Record<string, string> = {
  physical: 'enemyPhysicalResReduction',
  fire: 'enemyFireResReduction',
  ice: 'enemyIceResReduction',
  electric: 'enemyElectricResReduction',
  ether: 'enemyEtherResReduction',
  wind: 'enemyWindResReduction',
  lumiflux: 'enemyLumifluxResReduction',
  physical_polar_assault: 'enemyPhysicalResReduction',  // 物理变种
}

export function teamHasAgent(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  agentIds: string[],
): boolean {
  return configStore.team.some(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agentIds.includes(char.agentId) || agentIds.includes(agent?.teammateBuffId ?? '')
  })
}

export function getTeamAnomalyDurationBonus(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  element: string,
): number {
  if (element === 'fire' && teamHasAgent(configStore, catalogStore, ['1171'])) return 3
  if (element === 'electric' && teamHasAgent(configStore, catalogStore, ['1211'])) return 3
  if (element === 'ether' && teamHasAgent(configStore, catalogStore, ['aria'])) return 3
  if (element === 'physical' && teamHasAgent(configStore, catalogStore, ['1261'])) return 5
  return 0
}

/** 风化浸染默认选择：优先非支援/防护、非蕾米埃尔的非风队友属性 */
export function getWindInfectionTargetSlot(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): number {
  const windSlot = configStore.team.findIndex(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agent?.damageElement === 'wind'
  })
  if (windSlot < 0) return -1

  const candidates = configStore.team.map((char, slot) => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return {
      slot,
      agentId: char.agentId ?? '',
      element: agent?.damageElement ?? '',
      specialty: agent?.specialty ?? '',
      isRemielle: agent?.id === '1581' || agent?.teammateBuffId === 'remielle',
    }
  }).filter(x => !!x.agentId)

  const userSlot = Math.floor(configStore.getMechanicSetting('wind.infectionTargetSlot', -1))
  const userValid = userSlot >= 0 && userSlot !== windSlot && candidates.some(x => x.slot === userSlot)
  if (userValid) return userSlot

  return candidates.find(x =>
    x.slot !== windSlot && x.element && x.element !== 'wind'
    && x.specialty !== 'support' && x.specialty !== 'defense' && !x.isRemielle,
  )?.slot
    ?? candidates.find(x => x.slot !== windSlot && x.element && x.element !== 'wind')?.slot
    ?? windSlot
}

export function getWindInfectionElement(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): string {
  const slot = getWindInfectionTargetSlot(configStore, catalogStore)
  const char = configStore.team[slot]
  const agent = char?.agentId ? catalogStore.getAgent(char.agentId) : null
  return agent?.damageElement || 'wind'
}

/** 风化浸染覆盖率：默认风化覆盖时间/全局时间，用户可手动覆盖 */
export function getWindInfectionCoverage(
  configStore: ReturnType<typeof useConfigStore>,
  autoRate: number,
): number {
  return Math.max(0, Math.min(1, configStore.getMechanicSetting('wind.infectionCoverage', autoRate)))
}

export interface AnomalyVirtualPanelRow {
  slot: number
  name: string
  buildup: number
  /** 展示权重 = buildup / totalBuildUp（含所有贡献者，异属性赠送也计入） */
  weight: number
  /** 是否可以结算该元素（同属性角色才可结算） */
  settlementEligible: boolean
  atk: number
  anomalyProficiency: number
  dmgBonus: number
  anomalyDmgBonus: number
  anomalyCritRate: number
  anomalyCritDmg: number
  assaultCritRate: number
  assaultCritDmg: number
  enemyAssaultDefReduction: number
  enemyAnomalyDefReduction: number
  enemyDefFlatReduction: number
  enemyResReduction: number
  elementResReduction: number
  penRatio: number
  penFlat: number
  /** 异化度（蕾米异化系数之和，基础区属性） */
  refringe: number
}

export interface AnomalyVirtualPanelBuild {
  element: string
  totalBuildUp: number
  rows: AnomalyVirtualPanelRow[]
  virtual: AnomalyVirtualPanelRow
  panel: PanelValues
}

export function buildAnomalyVirtualPanel(
  prog: AnomalyProgress,
  panels: PanelValues[],
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): AnomalyVirtualPanelBuild | null {
  const slotBuildUp = new Map<number, number>()
  for (const contrib of prog.contributions ?? []) {
    slotBuildUp.set(contrib.slot, (slotBuildUp.get(contrib.slot) ?? 0) + contrib.totalBuildUp)
  }
  const totalBuildUp = [...slotBuildUp.values()].reduce((a, b) => a + b, 0)
  if (totalBuildUp <= 0) return null

  const rows: AnomalyVirtualPanelRow[] = [...slotBuildUp.entries()]
    .map(([slot, buildup]) => {
      const panel = panels[slot] ?? emptyPanel()
      const agentId = configStore.team[slot]?.agentId ?? ''
      const agent = agentId ? catalogStore.getAgent(agentId) : null
      const dmgBonus = (panel.dmgBonus ?? 0) + (panel[ELEMENT_DMG_KEYS[prog.element]] ?? 0)
      // 同属性角色才可参与结算/面板加权
      const settlementEligible = agent?.damageElement === prog.element
      return {
        slot,
        name: agent?.name?.zhCN || agentId || `槽${slot + 1}`,
        buildup,
        weight: 0,   // 展示权重 = 同属性内积蓄占比，rows 构建后统一修正（赠送积蓄不参与权重）
        settlementEligible,
        atk: panel.atk ?? 0,
        anomalyProficiency: panel.anomalyProficiency ?? 0,
        dmgBonus,
        anomalyDmgBonus: panel.anomalyDmgBonus ?? 0,
        anomalyCritRate: panel.anomalyCritRate ?? 0,
        anomalyCritDmg: panel.anomalyCritDmg ?? 0,
        assaultCritRate: panel.assaultCritRate ?? 0,
        assaultCritDmg: panel.assaultCritDmg ?? 0,
        enemyAssaultDefReduction: panel.enemyAssaultDefReduction ?? 0,
        enemyAnomalyDefReduction: panel.enemyAnomalyDefReduction ?? 0,
        enemyDefFlatReduction: panel.enemyDefFlatReduction ?? 0,
        enemyResReduction: panel.enemyResReduction ?? 0,
        elementResReduction: panel[ELEMENT_RES_REDUCTION_KEYS[prog.element]] ?? 0,
        penRatio: panel.penRatio ?? 0,
        penFlat: panel.penFlat ?? 0,
        refringe: (panel.remielleRefringeCoefficient ?? 0) + (panel.remielleRefringeCoefficientBonusPct ?? 0),
      }
    })
    .sort((a, b) => b.buildup - a.buildup)

  // 属性加权只用同属性行（异属性赠送积蓄只计入总次数，不参与面板加权）
  const eligibleRows = rows.filter(r => r.settlementEligible)
  const blendRows = eligibleRows.length > 0 ? eligibleRows : rows
  const blendTotal = blendRows.reduce((s, r) => s + r.buildup, 0) || totalBuildUp

  const weighted = (key: keyof AnomalyVirtualPanelRow): number =>
    blendRows.reduce((sum, row) => sum + (row[key] as number) * (row.buildup / blendTotal), 0)

  // 修正展示权重：同属性行 = 同属性内积蓄占比（和恒为100%），赠送行 = 0
  for (const row of rows) {
    row.weight = row.settlementEligible && blendTotal > 0 ? row.buildup / blendTotal : 0
  }

  const panel = emptyPanel()
  panel.atk = weighted('atk')
  panel.anomalyProficiency = weighted('anomalyProficiency')
  panel.dmgBonus = weighted('dmgBonus')
  panel.penRatio = weighted('penRatio')
  panel.penFlat = weighted('penFlat')

  const virtual: AnomalyVirtualPanelRow = {
    slot: -1,
    name: '虚拟面板',
    buildup: totalBuildUp,
    weight: 1,
    settlementEligible: true,
    atk: panel.atk,
    anomalyProficiency: panel.anomalyProficiency,
    dmgBonus: panel.dmgBonus,
    anomalyDmgBonus: 0,
    anomalyCritRate: 0,
    anomalyCritDmg: 0,
    assaultCritRate: 0,
    assaultCritDmg: 0,
    enemyAssaultDefReduction: 0,
    enemyAnomalyDefReduction: 0,
    enemyDefFlatReduction: 0,
    enemyResReduction: 0,
    elementResReduction: 0,
    penRatio: panel.penRatio,
    penFlat: panel.penFlat,
    refringe: weighted('refringe'),
  }

  panel.refringe = (virtual.refringe ?? 0) as any

  return { element: prog.element, totalBuildUp, rows, virtual, panel }
}

/** 结算触发者条目：每人用自己的面板独立结算，触发次数按积蓄占比分摊 */
export interface AnomalySettlementEntry {
  slot: number
  /** 积蓄占比（0-1），含用户覆盖 */
  share: number
  /** 该触发者的触发次数（整数） */
  triggerCount: number
  /** 触发者自己的完整面板（结算区） */
  panel: PanelValues
  /** 显示用名称 */
  name: string
}

/**
 * 构建异常结算触发者列表。
 *
 * 改为「按触发次数分摊」：每个触发者用自己的面板独立结算，
 * 不再加权合成为一个面板。
 *
 * - 同属性角色（同色共享积蓄池）才有资格触发
 * - 触发次数 = round(share × totalTriggers)，末端补余保证总数一致
 */
export function buildAnomalySettlementEntries(
  build: AnomalyVirtualPanelBuild,
  panels: PanelValues[],
  totalTriggers: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): AnomalySettlementEntry[] {
  // 同属性角色筛选（用 virtual panel row 的 settlementEligible 字段）
  const settlementRows = build.rows.filter(row => row.settlementEligible)
  const rows = settlementRows.length > 0 ? settlementRows : build.rows

  // 份额（含用户覆盖）。单人结算时强制 100%，不受异属性赋彩贡献稀释。
  const isSingle = rows.length === 1
  const shares = rows.map(row => {
    if (isSingle) return 1
    const override = configStore.getAnomalySettlementShare(build.element, row.slot)
    return override ?? row.weight
  })
  const shareTotal = isSingle ? 1 : (shares.reduce((a, b) => a + b, 0) || 1)

  // 触发次数分摊
  const rawCounts = shares.map(s => Math.round((s / shareTotal) * totalTriggers))
  const sumRaw = rawCounts.reduce((a, b) => a + b, 0)
  const diff = totalTriggers - sumRaw
  // 余数（正或负）加到第一个参与结算的角色上
  if (diff !== 0 && rawCounts.length > 0) {
    rawCounts[0] += diff
  }

  return rows.map((row, i) => {
    const agent = catalogStore.getAgent(configStore.team[row.slot]?.agentId ?? '')
    return {
      slot: row.slot,
      share: shares[i] / shareTotal,
      triggerCount: Math.max(0, rawCounts[i] ?? 0),
      panel: panels[row.slot] ?? emptyPanel(),
      name: agent?.name?.zhCN || `槽${row.slot + 1}`,
    }
  }).filter(e => e.triggerCount > 0)
}

export function getRemielleLevelValue(row: SkillMove['rows'][number] | undefined, skillLevelBonus: number): number {
  if (!row) return 0
  const values = row.values ?? []
  if (!values.length) return 0
  const skillLevel = getSkillLevelCoef(skillLevelBonus).skillLevel
  const levelValues = (row as any).levelValues ?? (row as any).luminizeLevelValues
  if (Array.isArray(levelValues)) {
    const idx = levelValues.indexOf(skillLevel)
    if (idx >= 0) return values[idx] ?? values[0] ?? 0
  }
  if (values.length === 3) {
    return values[skillLevel >= 16 ? 2 : skillLevel >= 14 ? 1 : 0] ?? values[0] ?? 0
  }
  return values[0] ?? 0
}

export function remielleSpecialVoidflareCount(panel: PanelValues): number {
  const firstRound = panel.remielleCinema1SpecialVoidflareCount ?? 0
  if (firstRound <= 0) return 0
  const refillRound = panel.remielleCinema4SpecialVoidflareRefillCount ?? 0
  const c6Multiplier = 1 + Math.max(0, panel.remielleCinema6SpecialVoidflareTriggerMultiplier ?? 0)
  return (firstRound + Math.max(0, refillRound)) * c6Multiplier
}

export interface VoidflareDamageInput {
  sourcePanel: PanelValues
  remiellePanel: PanelValues
  multiplier: number
  element: string
  enemyDefense: number
  enemyResistances: Record<string, number>
  stunMultiplier: number
  /** 是否失衡或失衡易伤覆盖率（0-1） */
  stunned: boolean | number
  cinema1ResIgnore: number
}

export function calcVoidflareDamage(input: VoidflareDamageInput): { damage: number; formula: string } {
  const { sourcePanel: source, remiellePanel: remielle, multiplier, element, enemyDefense, enemyResistances, stunMultiplier, stunned, cinema1ResIgnore } = input

  const baseDmg = source.atk * (multiplier / 100)
  const elementDmg = source[ELEMENT_DMG_KEYS[element]] ?? 0
  const dmgMult = 1 + ((source.dmgBonus ?? 0) + elementDmg) / 100
  const profMult = (source.anomalyProficiency ?? 0) / 100

  const remielleDefReduction = (remielle.enemyDefReduction ?? 0)
    + (remielle.enemyAnomalyDefReduction ?? 0)
    + (remielle[ELEMENT_DEF_REDUCTION_KEYS[element]] ?? 0)
  const effectiveDef = Math.max(0,
    enemyDefense * (1 - (source.penRatio ?? 0) / 100) * (1 - remielleDefReduction / 100)
    - ((source.penFlat ?? 0) + (remielle.enemyDefFlatReduction ?? 0)),
  )
  const defMult = 794 / (794 + effectiveDef)
  const levelMult = 2
  const mass = baseDmg * dmgMult * profMult * defMult * levelMult

  const baseRes = enemyResistances[element] ?? 0
  const sourceResReduction = (source.enemyResReduction ?? 0)
    + (source[ELEMENT_RES_REDUCTION_KEYS[element]] ?? 0)
    + cinema1ResIgnore
  const resMult = 1 - (baseRes - sourceResReduction) / 100

  const anomalyDmgMult = 1 + (remielle.anomalyDmgBonus ?? 0) / 100
  const passiveLuminizeMult = 1 + (remielle.remielleLuminizeMultiplierBonus ?? 0) / 100
  const cinema4LuminizeMult = 1 + (remielle.remielleCinema4LuminizeMultiplierBonus ?? 0) / 100
  const luminizeMult = passiveLuminizeMult * cinema4LuminizeMult
  const refringeMult = 1 + ((remielle.remielleRefringeCoefficient ?? 0) + (remielle.remielleRefringeCoefficientBonusPct ?? 0)) / 100

  const dmgTakenMult = 1 + (remielle.enemyDamageTakenBonus ?? 0) / 100
  let stunBonus = (remielle.stunDmgMultiplierBonus ?? 0) + (remielle.stunDmgMultiplierBonusAlways ?? 0)
  const stunCap = remielle.stunDmgMultiplierBonusCapAlways ?? 0
  if (stunCap > 0) stunBonus = Math.min(stunBonus, stunCap)
  const stunMult = stunned ? Math.max(0, stunMultiplier + stunBonus / 100) : 1

  const damage = mass * resMult * anomalyDmgMult * luminizeMult * refringeMult * stunMult * dmgTakenMult
  const formula = `基础 ${fmt(source.atk)}×${fmt(multiplier)}% × 增伤(1+${fmt((source.dmgBonus ?? 0) + elementDmg)}%) × 精通(${fmt(source.anomalyProficiency ?? 0)}/100) × 防御(${fmt(defMult, 4)}) × 等级(${levelMult}) × 抗性(${fmt(resMult, 4)}) × 异化(${fmt(refringeMult, 4)}) × 异常增伤(1+${fmt(remielle.anomalyDmgBonus ?? 0)}%) × 耀变被动(${fmt(passiveLuminizeMult, 4)}) × 4命(${fmt(cinema4LuminizeMult, 4)}) × 失衡(${fmt(stunMult, 4)}) × 易伤(${fmt(dmgTakenMult, 4)})`

  return { damage, formula }
}

export function isHealingRow(row: any): boolean {
  const id = String(row.id ?? '').toLowerCase()
  const kind = String(row.kind ?? '').toLowerCase()
  const label = `${row.label?.zhCN ?? ''}${row.label?.en ?? ''}`.toLowerCase()
  return id.includes('heal') || id.includes('hp_recover') || id.includes('hp_recovery')
    || kind.includes('heal') || label.includes('治疗') || label.includes('回血') || label.includes('生命回复')
}

export function getHealingAmount(move: SkillMove): number {
  let total = 0
  for (const row of move.rows as any[]) {
    if (!isHealingRow(row)) continue
    total += row.values?.[0] ?? 0
  }
  return total
}

export function getSpecialResourceRecovery(move: SkillMove): number {
  let total = 0
  for (const row of move.rows as any[]) {
    const id = String(row.id ?? '')
    if (!id.includes('recovery')) continue
    if (id === 'energy_recovery' || id === 'decibel_recovery') continue
    if (isHealingRow(row)) continue
    total += row.values?.[0] ?? 0
  }
  return total
}

export function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.id === moveId)
    if (move) return move
  }
  return null
}

export function findMoveByEnglishName(skills: AgentSkills | undefined, englishName: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.name?.en === englishName || m.name?.zhCN === englishName)
    if (move) return move
  }
  return null
}

/**
 * 平A基准段硬编码 override。
 * key = agentId（catalog id），value = 使用的 moveId。
 * 不在此映射的角色默认取第 3 段（index 2），不足 3 段取最后一段。
 */
export const BASIC_BENCHMARK_OVERRIDE: Record<string, string> = {
  // 在此填入需要特殊基准段的角色，如 '1401': '1401003'
}

/**
 * 获取平A基准段（单段，秒均化）。
 * 优先：catalog agent.basicBenchmarkMoveId（数据配置）→ 硬编码 override 兜底 → 默认第 3 段（#3）；不足 3 段取最后一段。
 */
export function getBasicComboMoves(
  skills: AgentSkills | undefined,
  agentId?: string,
  catalogStore?: ReturnType<typeof useCatalogStore>,
): SkillMove | null {
  const basic = skills?.categories.find(c => c.id === 'basic')
  if (!basic) return null

  // 1. 收集所有 #N 段（排除 dash/dodge），数组顺序 = 原始顺序（#1,#2,#3...）
  const all: SkillMove[] = []
  for (const move of basic.moves) {
    const name = move.name?.en || ''
    if (!name.match(/#\d+/)) continue
    if (name.toLowerCase().includes('dash') || name.toLowerCase().includes('dodge')) continue
    if (!move.actionTime || move.actionTime <= 0) continue
    all.push(move)
  }
  if (all.length === 0) return null

  // 2. 数据配置优先（catalog agent.basicBenchmarkMoveId）
  if (agentId && catalogStore) {
    const dataId = catalogStore.getAgent(agentId)?.basicBenchmarkMoveId
    if (dataId) {
      const found = all.find(m => m.id === dataId)
      if (found) return found
    }
  }

  // 3. 硬编码 override 兜底
  if (agentId && BASIC_BENCHMARK_OVERRIDE[agentId]) {
    const overrideId = BASIC_BENCHMARK_OVERRIDE[agentId]
    const found = all.find(m => m.id === overrideId)
    if (found) return found
  }

  // 4. 默认第 3 段（index 2），不足取末尾
  const idx = Math.min(2, all.length - 1)
  return all[idx]
}

export function averageBasicRows(
  skills: AgentSkills | undefined,
  agentId?: string,
  catalogStore?: ReturnType<typeof useCatalogStore>,
): Partial<SkillExecution> {
  const move = getBasicComboMoves(skills, agentId, catalogStore)
  if (!move) return {}
  const at = move.actionTime ?? 1

  const s = (rowId: string) => getRowValue(move, rowId) / at
  return {
    damageMultiplier: s('damage'),
    dazeMultiplier: s('daze'),
    anomalyBuildUp: s('anomaly_buildup'),
    specialResourceRecovery: getSpecialResourceRecovery(move) / at,
    healingAmount: getHealingAmount(move) / at,
    skillTableResolved: true,
    skillTableNote: '平A按基准段（默认#3）秒均 × 平A时间计算（只打该段）。',
  }
}

export function enrichExecutionPlan(result: TeamResourceResult, catalogStore: ReturnType<typeof useCatalogStore>): TeamResourceResult {
  return {
    ...result,
    characters: result.characters.map(char => {
      const skills = catalogStore.getAgentSkills(char.agentId)
      const executions = char.executions.map(exec => {
        let patch: Partial<SkillExecution> = {}
        if (exec.moveId === 'basic_attack') {
          if (exec.damageMultiplierOverride || exec.dazeMultiplierOverride) {
            // 机制模块已覆盖秒均倍率（如青衣「一煞#4→醉花」循环），保留自定义值
            const bu = exec.anomalyBuildUp ?? 0
            patch = {
              actionCode: exec.moveId,
              skillTableResolved: true,
              anomalyBuildUp: bu,
              totalAnomalyBuildUp: bu * Math.max(0, exec.totalTime),
            }
          } else {
            const rows = averageBasicRows(skills, char.agentId, catalogStore)
            const bu = rows.anomalyBuildUp ?? 0
            patch = {
              actionCode: exec.moveId,
              ...rows,
              anomalyBuildUp: bu,
              totalAnomalyBuildUp: bu * Math.max(0, exec.totalTime),
            }
          }
        } else {
          const move = findMoveById(skills, exec.moveId)
          if (move) {
            const specialResourceRecovery = getSpecialResourceRecovery(move)
            const healingAmount = getHealingAmount(move)
            // exec.anomalyBuildUp 显式为 0 = 模块显式禁用异常积蓄（如莱卡恩围猎后台招式"仅伤害+失衡值"）
            const bu = exec.anomalyBuildUp === 0 ? 0 : getRowValue(move, 'anomaly_buildup')
            // 同上：decibel/energy 显式 0 = 模块显式禁用回填（围猎后台闪反无喧响/能量）
            const tableDecibel = getRowValue(move, 'decibel_recovery')
            const decibelValue = exec.decibelRecovery === 0 ? 0 : (tableDecibel || exec.decibelRecovery)
            const tableEnergy = getRowValue(move, 'energy_recovery')
            const energyValue = exec.energyRecovery === 0 ? 0 : (tableEnergy || exec.energyRecovery)
            patch = {
              actionCode: move.id,
              moveName: move.name?.zhCN || move.name?.en || exec.moveName,
              damageMultiplier: exec.damageMultiplierOverride
                ? exec.damageMultiplier
                : getRowValue(move, 'damage'),
              dazeMultiplier: exec.dazeMultiplierOverride
                ? exec.dazeMultiplier
                : getRowValue(move, 'daze'),
              anomalyBuildUp: bu,
              totalAnomalyBuildUp: bu * Math.max(0, exec.count),
              energyRecovery: energyValue,
              totalEnergyRecovery: energyValue * Math.max(0, exec.count),
              decibelRecovery: decibelValue,
              totalDecibelRecovery: decibelValue * Math.max(0, exec.count),
              specialResourceRecovery,
              totalSpecialResourceRecovery: specialResourceRecovery * Math.max(0, exec.count),
              healingAmount,
              totalHealingAmount: healingAmount * Math.max(0, exec.count),
              skillTableResolved: true,
              skillTableNote: '已从倍率表 rows 回填 damage/daze/energy_recovery/decibel_recovery/anomaly_buildup。',
            }
          } else {
            patch = {
              skillTableResolved: false,
              skillTableNote: '未在倍率表中找到对应 moveId；可能是资源池合成行或待补数据。',
            }
          }
        }
        return { ...exec, ...patch }
      })
      return { ...char, executions }
    }),
  }
}

/** 从技能数据提取资源池所需的招式信息，构建单个角色的操作配置 */

export function normalizeResourceSkillType(move: SkillMove | null, execMoveId: string): string {
  if (execMoveId === 'basic_attack') return 'basic'
  const raw = move?.skillType ?? ''
  if (raw === 'dodge') return 'dodgeCounter'
  if (raw === 'special') return move?.energyCost ? 'exSpecial' : 'special'
  if (raw === 'basic' || raw === 'ultimate' || raw === 'chain' || raw === 'assist') return raw
  return 'all'
}

export function buildCharConfig(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): CharacterOperationConfig | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null

  const agent = catalogStore.getAgent(char.agentId)
  const skills = catalogStore.getAgentSkills(char.agentId)
  if (!agent || !skills) return null

  const panel = computePanel(slot, configStore, catalogStore)
  if (!panel) return null

  const remielleEnabled = agent.id === '1581' || agent.teammateBuffId === 'remielle'
  const remielleDazeBonusPct = remielleEnabled
    ? resolveRemielleDazeBonus(configStore, catalogStore, slot, agent)
    : 0
  if (remielleEnabled) {
    panel.remielleRadiantTurnDazeBonusPct = remielleDazeBonusPct
  }

  // 判断命破角色
  const isFlash = !!(agent.level60.flashEnergyRegen && agent.level60.flashEnergyRegen > 0)

  // 提取技能数据
  const exSpecial = findExSpecial(skills as AgentSkills)
  const ultimate = findUltimate(skills as AgentSkills)
  const chainAttack = findChainAttack(skills as AgentSkills)
  const defensiveAssist = findDefensiveAssist(skills as AgentSkills)
  const assistFollowUp = findAssistFollowUp(skills as AgentSkills)
  const dodgeCounter = findDodgeCounter(skills as AgentSkills)
  const basicRegen = calcBasicAttackRegenPerSec(skills as AgentSkills)
  const remielleRainbowEnd = findRemielleRainbowEnd(skills as AgentSkills)
  const remielleRadiantTurn = findRemielleRadiantTurn(skills as AgentSkills)

  // 合轴率覆盖：优先使用用户在结果页设置的值，否则用倍率表默认值
  const ov = (moveId: string, defaultRatio: number) =>
    configStore.getComboAlignOverride(slot, moveId, defaultRatio)

  // 角色类型
  const isSupport = agent.specialty === 'support'

  // 加农转子（14001）：攻击命中并暴击时触发 200% 攻击力直伤事件，按精修 CD 计算本局上限。
  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : null
  const wEngineMatchesSpecialty = !!wEngine && wEngine.specialty === agent.specialty
  const cannonRotorCooldowns = [8, 7.5, 7, 6.5, 6]
  const cannonRotorModIndex = Math.max(0, Math.min(4, (char.wEngineModLevel ?? 1) - 1))
  // 音擎 id 已统一为数字（旧 zzz_wiki_XXXX 存于 legacyIds，兼容旧 localStorage 配置）
  const hasCannonRotorEvent = wEngineMatchesSpecialty && !!wEngine
    && (wEngine.id === '14001' || (wEngine.legacyIds ?? []).includes('14001'))

  // 平A时间分配权重：优先读取用户配置；旧配置缺字段时按当前默认规则兜底
  const timeWeight = char.basicAttackTimeWeight ?? configStore.getDefaultBasicAttackTimeWeight(agent)

  // 开局赠送能量：普通角色40点
  const initialEnergyGift = 40

  const resourceUtilizationPrefix = `${slot}:`
  const resourceUtilization = Object.fromEntries(
    Object.entries(configStore.resourceUtilization ?? {})
      .filter(([key]) => key.startsWith(resourceUtilizationPrefix))
      .map(([key, value]) => [key.slice(resourceUtilizationPrefix.length), value]),
  )

  const cfg: CharacterOperationConfig = {
    slot,
    agentId: char.agentId,
    isFlashUser: isFlash,
    panel,
    basicAttackRegenPerSec: basicRegen.energyPerSec,
    basicAttackDecibelPerSec: basicRegen.decibelPerSec,
    remielleRainbowEndMoveId: remielleRainbowEnd?.moveId ?? '',
    remielleRainbowEndActionTime: remielleRainbowEnd?.actionTime ?? 0,
    remielleRainbowEndDecibelRecovery: remielleRainbowEnd?.decibelRecovery ?? 0,
    remielleRainbowEndComboAlignRatio: remielleRainbowEnd?.comboAlignRatio ?? 0,
    remielleEnabled,
    remielleRadiantTurnMoveId: remielleRadiantTurn?.moveId ?? '',
    remielleRadiantTurnActionTime: remielleRadiantTurn?.actionTime ?? 0,
    remielleRadiantTurnDecibelRecovery: remielleRadiantTurn?.decibelRecovery ?? 0,
    remielleRadiantTurnDazeBonusPct: remielleDazeBonusPct,
    exSpecialMoveId: exSpecial?.moveId ?? '',
    exSpecialEnergyConsume: exSpecial?.energyConsume ?? 0,
    exSpecialActionTime: exSpecial?.actionTime ?? 0,
    exSpecialDecibelRecovery: exSpecial?.decibelRecovery ?? 0,
    exSpecialComboAlignRatio: ov(exSpecial?.moveId ?? '', exSpecial?.comboAlignRatio ?? 0),
    ultimateMoveId: ultimate?.moveId ?? '',
    ultimateCost: ULTIMATE_COST_DEFAULT,
    ultimateActionTime: ultimate?.actionTime ?? 0,
    ultimateDecibelRecovery: 0,
    ultimateComboAlignRatio: ov(ultimate?.moveId ?? '', ultimate?.comboAlignRatio ?? 0),
    chainMoveId: chainAttack?.moveId ?? '',
    chainActionTime: chainAttack?.actionTime ?? 0,
    chainDecibelRecovery: chainAttack?.decibelRecovery ?? 0,
    chainComboAlignRatio: ov(chainAttack?.moveId ?? '', chainAttack?.comboAlignRatio ?? 0),
    chainCountPerStun: char.chainCountPerStun ?? (isSupport ? 0 : 1),
    parryCount: char.parryCount ?? 0,
    perfectBlockCount: (char as { perfectBlockCount?: number }).perfectBlockCount ?? 0,
    dodgeCounterCount: char.dodgeCounterCount ?? 0,
    blockCount: char.blockCount ?? 0,
    dualCounterCount: char.dualCounterCount ?? 0,
    tauntCancelCount: char.tauntCancelCount ?? 0,
    quickAssistCount: char.quickAssistCount ?? 0,
    yixuanInk2Count: char.yixuanInk2Count ?? 0,
    yixuanInk3Count: char.yixuanInk3Count ?? 0,
    yixuanPerfectBlockCount: char.yixuanPerfectBlockCount ?? 0,
    yixuanExtremeAssistCount: char.yixuanExtremeAssistCount ?? -1,
    yixuanBackstageComboCount: char.yixuanBackstageComboCount ?? 0,
    dodgeCounterMoveId: dodgeCounter?.moveId ?? '',
    dodgeCounterActionTime: dodgeCounter?.actionTime ?? 0,
    dodgeCounterDecibelRecovery: dodgeCounter?.decibelRecovery ?? 0,
    dodgeCounterComboAlignRatio: ov(dodgeCounter?.moveId ?? '', dodgeCounter?.comboAlignRatio ?? 0),
    defensiveAssistMoveId: defensiveAssist?.moveId ?? '',
    defensiveAssistActionTime: defensiveAssist?.actionTime ?? 0,
    defensiveAssistDecibelRecovery: defensiveAssist?.decibelRecovery ?? 0,
    defensiveAssistComboAlignRatio: ov(defensiveAssist?.moveId ?? '', defensiveAssist?.comboAlignRatio ?? 0),
    assistFollowUpMoveId: assistFollowUp?.moveId ?? '',
    assistFollowUpActionTime: assistFollowUp?.actionTime ?? 0,
    assistFollowUpDecibelRecovery: assistFollowUp?.decibelRecovery ?? 0,
    assistFollowUpComboAlignRatio: ov(assistFollowUp?.moveId ?? '', assistFollowUp?.comboAlignRatio ?? 0),
    backstageRegenBonus: 0,
    comboAlignRegenBonus: 0,
    zhenyuanTriggerCount: 0,
    cannonRotorDamageMultiplier: hasCannonRotorEvent ? 200 : 0,
    cannonRotorCooldownSeconds: hasCannonRotorEvent ? cannonRotorCooldowns[cannonRotorModIndex] : 0,
    initialEnergyGift,
    initialDecibelGift: 1000,
    battleTime: configStore.enemy.battleTime ?? 180,
    extraSelfDecibelReward: (panel.remielleFlowerFeatherDanceDecibelPerUse ?? 0) * (panel.remielleFlowerFeatherDanceCount ?? 0),
    decibelShareRatio: 0.5,
    supportUltimateEnergyRegen: 0,
    isSupport,
    timeWeight,
    resourceUtilization,
  }

  // 先把机制模块声明的可调设置写入 cfg，模块的 buildCharConfig 随后才能读到。
  const charModule = getAgentMechanic(agent.id)
  for (const setting of charModule?.settings ?? []) {
    const record = cfg as unknown as Record<string, unknown>
    record[`setting:${setting.id}`] = configStore.getMechanicSetting(setting.id, setting.default)
  }

  charModule?.buildCharConfig?.({
    slot,
    agent,
    skills: skills as AgentSkills,
    cinemaLevel: char.cinemaLevel ?? 0,
    wEngineId: char.wEngineId ?? '',
    wEngineModLevel: char.wEngineModLevel ?? 1,
    team: buildMechanicTeamMembers(configStore, catalogStore),
    panel,
    cfg,
    getRowValue,
  })

  return cfg
}

/** 从倍率表提取招式的 daze 和 anomaly_buildup 数据
 *  返回用于失衡池和积蓄池计算的招式执行记录
 */
export function extractSkillExecutions(
  slot: number,
  agentId: string,
  skills: AgentSkills | undefined,
  resourceResult: TeamResourceResult | null,
  catalogStore: ReturnType<typeof useCatalogStore>,
  panel: PanelValues | null,
  configStore: ReturnType<typeof useConfigStore>,
): { stunExecs: StunSkillExecution[]; anomalyExecs: AnomalySkillExecution[] } {
  if (!skills || !resourceResult) return { stunExecs: [], anomalyExecs: [] }

  const charResult = resourceResult.characters.find(c => c.slot === slot)
  if (!charResult) return { stunExecs: [], anomalyExecs: [] }

  // 命座技能等级系数（3命+2级，5命+4级）
  const skillLevelBonus = panel?.skillLevelBonus ?? 0
  const dazeCoef = skillLevelBonus > 0 ? getSkillLevelCoef(skillLevelBonus).dazeCoef : 1

  const agent = catalogStore.getAgent(agentId)
  const fallbackElement = agent?.damageElement
  const charCfg = configStore.team[slot]
  const mechanic = getAgentMechanic(agentId)
  const usesModuleTransform = !!mechanic?.transformSkillExecutions
  const team = buildMechanicTeamMembers(configStore, catalogStore)
  const anomalyUtilizationRate = configStore.getAnomalyUtilizationRate(slot)

  const stunExecs: StunSkillExecution[] = []
  const anomalyExecs: AnomalySkillExecution[] = []

  // 从 resourceResult.executions 获取执行次数
  // 然后从倍率表查找对应的 move，提取 daze 和 anomaly_buildup
  for (const exec of charResult.executions) {
    if (exec.count <= 0 && exec.totalTime <= 0) continue

    // 在倍率表中查找对应的 move
    let foundMove: SkillMove | null = null
    let foundElement: string | undefined
    for (const cat of skills.categories) {
      for (const move of cat.moves) {
        if (move.id === exec.moveId) {
          foundMove = move
          foundElement = exec.element ?? move.damageElement ?? fallbackElement
          break
        }
      }
      if (foundMove) break
    }

    // 平A汇总行（moveId = 'basic_attack'）：用基准段（第3段）秒均数据 × 时间
    if (exec.moveId === 'basic_attack' && exec.totalTime > 0) {
      let dazePerSec = 0
      let anomalyPerSec = 0
      let basicElement: string | undefined = fallbackElement
      if (exec.dazeMultiplierOverride || exec.damageMultiplierOverride) {
        // 机制模块已覆盖秒均倍率（如青衣「一煞#4→醉花月云转」循环），保留自定义值
        dazePerSec = exec.dazeMultiplier ?? 0
        anomalyPerSec = exec.anomalyBuildUp ?? 0
      } else {
        const move = getBasicComboMoves(skills, agentId, catalogStore)
        if (move && move.actionTime && move.actionTime > 0) {
          const at = move.actionTime
          basicElement = move.damageElement ?? fallbackElement
          dazePerSec = getRowValue(move, 'daze') / at
          anomalyPerSec = getRowValue(move, 'anomaly_buildup') / at
        }
      }

      if (dazePerSec > 0) {
        stunExecs.push({
          moveId: 'basic_attack',
          moveName: '普通攻击',
          slot,
          count: 1,
          baseDaze: dazePerSec * exec.totalTime * dazeCoef,
          element: basicElement,
          skillType: 'basic',
        })
      }
      if (anomalyPerSec > 0 && basicElement) {
        anomalyExecs.push({
          moveId: 'basic_attack',
          moveName: '普通攻击',
          slot,
          count: 1,
          baseBuildUp: anomalyPerSec * exec.totalTime * anomalyUtilizationRate,
          element: basicElement,
        })
      }
      continue
    }

    // 模块角色由角色机制模块负责处理所有非平A倍率行。
    if (usesModuleTransform) continue

    // 其他招式（强特、终结技、连携等）
    if (foundMove) {
      const count = exec.count
      // 模块可用 dazeMultiplierOverride 覆盖失衡倍率（如诺姆影画6 破甲弹头失衡值+30%），与 damageMultiplierOverride 同机制
      const tableDaze = getRowValue(foundMove, 'daze')
      const daze = exec.dazeMultiplierOverride && (exec.dazeMultiplier ?? 0) > 0
        ? exec.dazeMultiplier!
        : tableDaze
      // 假 id/合成执行支持执行级异常积蓄覆盖（如仪玄符法千重-破 226.7，倍率行被隐藏）
      const anomaly = exec.anomalyBuildUp ?? getRowValue(foundMove, 'anomaly_buildup')
      const moveName = exec.moveName.replace(/（.*）/g, '').trim()
      const radiantTurnDazeMult = foundMove.id === '1581010'
        ? 1 + ((panel?.remielleRadiantTurnDazeBonusPct ?? 0) / 100)
        : 1

      if (daze > 0 && count > 0) {
        stunExecs.push({
          moveId: exec.moveId,
          moveName,
          slot,
          count,
          baseDaze: daze * dazeCoef * radiantTurnDazeMult,
          element: foundElement,
          skillType: normalizeResourceSkillType(foundMove, exec.moveId),
          stunBuildUpBonus: exec.stunBuildUpBonus,
        })
      }
      if (anomaly > 0 && count > 0 && foundElement) {
        anomalyExecs.push({
          moveId: exec.moveId,
          moveName,
          slot,
          count,
          baseBuildUp: anomaly * anomalyUtilizationRate,
          element: foundElement,
        })
      }
    }
  }

  if (usesModuleTransform) {
    mechanic!.transformSkillExecutions!({
      slot,
      agent: agent ?? null,
      skills,
      charResult,
      panel,
      cinemaLevel: charCfg?.cinemaLevel ?? 0,
      team,
      dazeCoef,
      stunExecs,
      anomalyExecs,
      getRowValue,
      normalizeResourceSkillType,
    })
  }

  return { stunExecs, anomalyExecs }
}

