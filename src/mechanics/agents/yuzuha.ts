import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import type { CharacterResourceResult, MechanicSetting, YuzuhaMechanicSource } from '@/types/resource'
import { fmt } from '@/utils/format'

const YUZUHA_AGENT_ID = '1411'
const SWEETNESS_INITIAL = 3
const SWEETNESS_CAP = 6
const TEAM_ATK_RATIO = 0.4
/** 满级（核心被动 lv7）口径：上限1200，初始攻击力3000打满；计算器一律按满级角色计算 */
const TEAM_ATK_CAP = 1200
const TEAM_DMG_BONUS = 15
/** 影画6：招架支援/狸之帐成功招架额外 +1 甜度点（次数≈parryCount） */
const C6_SWEETNESS_PER_PARRY = 1
/** 硬糖射击（8秒CD后台追击）：其他角色攻击命中触发，重击命中耗1甜度点；影画2 CD-25% → 6秒 */
export const YUZUHA_HARD_CANDY_MOVE_ID = '1411018'
const HARD_CANDY_CD_SECONDS = 8
const C2_HARD_CANDY_CD_CUT = 0.25
/** 彩糖花火：甜蜜惊吓敌人每1秒一次（惊吓按满覆盖近似）；·极由硬糖射击/夹心硬糖射击重击触发（≈招架次数） */
export const YUZUHA_FIREWORK_MOVE_ID = '1411020'
export const YUZUHA_FIREWORK_EXTREME_MOVE_ID = '1411021'
const FIREWORK_TICK_SECONDS = 1
/** 终结技·队友回能：每次大招全队其他角色回复 7+1.5×终结技等级（满级12级=25）点能量；走 crossAgent.supportUltimateRegen 通道 */
export const YUZUHA_ULT_TEAM_ENERGY = 25
/** 影画1 进场回能：30 点（勘域模式 180s 一次 → 每局一次） */
export const YUZUHA_C1_ENTER_ENERGY = 30
/** 影画2 强制连携 CD：20 秒最多一次（重击命中非失衡敌） */
export const YUZUHA_C2_CHAIN_CD = 20

export function computeYuzuhaMechanic(input: {
  initialAtk: number
  chainEntryCount: number
  cinemaLevel?: number
  parryCount?: number
  /** 有效战斗时间（秒）= battleTime - invincibleTime（后台追击不吃 boss 无敌时间） */
  effectiveSeconds?: number
  /** 十人十色转积蓄目标元素（队伍有异常队友时为其属性，否则缺省物理不转） */
  transferElement?: string
}): YuzuhaMechanicSource {
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel ?? 0))
  const parryCount = Math.max(0, Math.floor(input.parryCount ?? 0))
  const effectiveSeconds = Math.max(0, input.effectiveSeconds ?? 0)
  const sweetnessFromChain = Math.max(0, input.chainEntryCount)
  const sweetnessFromParry = cinemaLevel >= 6 ? parryCount * C6_SWEETNESS_PER_PARRY : 0
  const sweetnessTotal = Math.min(SWEETNESS_CAP, SWEETNESS_INITIAL + sweetnessFromChain + sweetnessFromParry)
  // 硬糖射击吃整场终身预算：存量上限 6 只钳瞬时持有，不钳「花掉再进」的终身收入
  const sweetnessBudget = SWEETNESS_INITIAL + sweetnessFromChain + sweetnessFromParry
  const teamAtkBonus = Math.min(TEAM_ATK_CAP, Math.max(0, input.initialAtk) * TEAM_ATK_RATIO)
  const hardCandyCdSeconds = cinemaLevel >= 2
    ? HARD_CANDY_CD_SECONDS * (1 - C2_HARD_CANDY_CD_CUT)
    : HARD_CANDY_CD_SECONDS
  const hardCandyCount = Math.min(Math.floor(effectiveSeconds / hardCandyCdSeconds), sweetnessBudget)
  const fireworkTickCount = Math.floor(effectiveSeconds / FIREWORK_TICK_SECONDS)
  const fireworkExtremeCount = hardCandyCount + parryCount
  const transferElement = input.transferElement
  return {
    sweetnessInitial: SWEETNESS_INITIAL,
    sweetnessFromChain,
    sweetnessFromParry,
    sweetnessTotal,
    sweetnessCap: SWEETNESS_CAP,
    sweetnessBudget,
    teamAtkBonus,
    teamAtkCap: TEAM_ATK_CAP,
    teamDmgBonus: TEAM_DMG_BONUS,
    effectiveSeconds,
    hardCandyCount,
    hardCandyCdSeconds,
    fireworkTickCount,
    fireworkExtremeCount,
    transferElement,
    note: '甜度点：进场3点、上限6，其他角色连携入场+1（二命），六命招架成功额外+1；甜度终身预算全部给硬糖射击（8秒CD后台追击，二命后6秒）。「影画6蓄能炮弹」作者拒绝实现（实时蓄能/自动闪避/逐发触发·极复杂度不成比例）。彩糖花火每1秒一次（惊吓满覆盖）；·极=硬糖射击+夹心硬糖重击触发；花火/·极积蓄经十人十色转入异常队友元素池（转积蓄，不吃自身伤害结算）。',
  }
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function buildYuzuhaCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  // 滑块必须经 buildCharConfig 落到 cfg，buildResourceResult 阶段才读得到（applyPanel 早于 cfg 构建拿不到 settings）
  cfg.yuzuhaChainEntryCount = Math.max(0, Math.floor(cfgSetting(cfg, 'yuzuha.chainEntryCount', 0)))
  cfg.yuzuhaCinemaLevel = cinemaLevel
  // 终结技队友回能（calcCrossAgentEnergy 泛型通道，类型注释预留的「如柚叶25」）：满级12级 7+1.5×12
  cfg.supportUltimateEnergyRegen = YUZUHA_ULT_TEAM_ENERGY
  // 影画1 进场回 30 能量（勘域模式 180s 一次 → 每局一次，克拉蕾锐能/佩洛伊斯喧响同款口径）
  if ((cinemaLevel ?? 0) >= 1) {
    cfg.initialEnergyGift = Number(cfg.initialEnergyGift ?? 0) + YUZUHA_C1_ENTER_ENERGY
  }
  // 影画2 强制连携：每次强制连携也有角色入场 → 甜度点 +1/次（与全队 chainCountTotalExtra 同源近似）
  if ((cinemaLevel ?? 0) >= 2) {
    const effective = Math.max(0, (cfg.battleTime ?? 180) - (cfg.invincibleTime ?? 0))
    cfg.yuzuhaChainEntryCount += Math.floor(effective / YUZUHA_C2_CHAIN_CD)
  }
}

/** 队伍级联动：①异常专精队友 → 十人十色转积蓄目标元素写入自身 cfg（buildExecutions 读）；
 * 元素取「队友招式的异常积储主元素」（anomalyBuildupElementBySlot，派发器按倍率表
 * anomaly_buildup 之和最大的 move.damageElement 预计算），回退 agent.damageElement——
 * agent 级元素可能与招式级不一致（星见雅 agent=ice 但招式=frostfire），此前用 agent 级
 * 导致转积蓄打进元素名不匹配的空池（2026-09-02 修复，探针实证）。
 * ②影画2 强制连携（2026-09-03 用户口径）：重击命中非失衡敌强制触发[连携技]（20s 最多一次）
 * → 全队连携计数 +floor(有效战斗时间/20)，写各槽位 cfg.chainCountTotalExtra。 */
function buildYuzuhaTeamConfig({ slot, characters, team, anomalyBuildupElementBySlot, cinemaLevel, combatTime }: AgentTeamConfigInput): void {
  const mine = characters.find(c => c.slot === slot)
  if (!mine) return
  const target = team.find(m => m.slot !== slot && m.agent?.specialty === 'anomaly')
  const targetSlot = target?.slot ?? -1
  mine.yuzuhaTransferElement = anomalyBuildupElementBySlot?.[targetSlot]
    ?? target?.agent?.damageElement
  // 影画2 强制连携：全队生效（强制连携=正常连携技，阵营全员入场）
  if ((cinemaLevel ?? 0) >= 2) {
    const effective = Math.max(0, combatTime - (mine.invincibleTime ?? 0))
    const forced = Math.floor(effective / YUZUHA_C2_CHAIN_CD)
    if (forced > 0) {
      for (const char of characters) {
        char.chainCountTotalExtra = forced
      }
    }
  }
}

function yuzuhaSourceFromCfg(cfg: AgentResourceInput['cfg']): YuzuhaMechanicSource {
  const effectiveSeconds = Math.max(0, (cfg.battleTime ?? 180) - (cfg.invincibleTime ?? 0))
  return computeYuzuhaMechanic({
    initialAtk: cfg.panel.atk ?? 0,
    chainEntryCount: cfg.yuzuhaChainEntryCount ?? 0,
    cinemaLevel: cfg.yuzuhaCinemaLevel ?? 0,
    parryCount: cfg.parryCount ?? 0,
    effectiveSeconds,
    transferElement: cfg.yuzuhaTransferElement,
  })
}

function buildYuzuhaResourceResult({ cfg }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return { yuzuhaMechanicSource: yuzuhaSourceFromCfg(cfg) }
}

function pushBackstageRow(
  executions: AgentResourceInput['executions'],
  moveId: string,
  moveName: string,
  count: number,
  element?: string,
): void {
  executions.push({
    moveId,
    moveName,
    category: 'basic',
    count,
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
    ...(element ? { element } : {}),
    timeBucket: 'backstage',
  })
}

function buildYuzuhaExecutions({ cfg, executions }: AgentResourceInput): void {
  const source = yuzuhaSourceFromCfg(cfg)
  // 硬糖射击：真实 moveId（catalog 264%伤害/132%失衡/积蓄0），倍率由 enrich 从倍率表回填
  if (source.hardCandyCount > 0) {
    pushBackstageRow(executions, YUZUHA_HARD_CANDY_MOVE_ID, '硬糖射击（8秒CD后台追击）', source.hardCandyCount)
  }
  // 彩糖花火/·极：行级 element = 十人十色转换后属性（异常池按它分组积蓄，伤害仍走 catalog 物理行）
  if (source.fireworkTickCount > 0) {
    pushBackstageRow(executions, YUZUHA_FIREWORK_MOVE_ID, '彩糖花火（甜蜜惊吓每秒一次）', source.fireworkTickCount, source.transferElement)
  }
  if (source.fireworkExtremeCount > 0) {
    pushBackstageRow(executions, YUZUHA_FIREWORK_EXTREME_MOVE_ID, '彩糖花火·极（硬糖/夹心硬糖重击触发）', source.fireworkExtremeCount, source.transferElement)
  }
}

function buildYuzuhaResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.yuzuhaMechanicSource
  if (!source) return []
  return [
    {
      id: 'yuzuha-sweetness',
      title: '柚叶甜度点',
      summary: `${source.sweetnessTotal}/${source.sweetnessCap}`,
      rows: [
        { label: '进场甜度', value: `+${source.sweetnessInitial}` },
        { label: '连携入场', value: `+${source.sweetnessFromChain}`, detail: '其他角色连携技入场+1（二命）' },
        ...(source.sweetnessFromParry > 0
          ? [{ label: '影画6·招架成功', value: `+${source.sweetnessFromParry}`, detail: '招架支援/狸之帐成功招架+1' }]
          : []),
        {
          label: '硬糖射击',
          value: `${source.hardCandyCount} 次`,
          detail: `有效战斗时间 ${fmt(source.effectiveSeconds)}s ÷ ${fmt(source.hardCandyCdSeconds)}s CD，受甜度终身预算 ${source.sweetnessBudget} 钳制；264%攻击力物理（倍率表回填）`,
        },
        { label: '终结技·队友回能', value: `${YUZUHA_ULT_TEAM_ENERGY}/次`, detail: '每次大招全队其他角色回复25能量（满级12级 7+1.5×12），走能量总览 crossAgent 口径并参与强特次数收敛' },
      ],
      footer: '六命招架成功额外+1；影画6蓄能炮弹作者拒绝实现，甜度终身预算全部给硬糖射击。',
    },
    {
      id: 'yuzuha-liwang-wish',
      title: '柚叶狸之愿（全队）',
      summary: `攻击 +${fmt(source.teamAtkBonus)}（上限${source.teamAtkCap}）· 伤害 +${source.teamDmgBonus}%`,
      rows: [
        { label: '攻击力加成', value: `+${fmt(source.teamAtkBonus)}`, detail: '40%初始攻击力（满级lv7口径：上限1200/初始攻击力3000打满）' },
        { label: '伤害提升', value: `+${source.teamDmgBonus}%`, detail: '持续40秒，重复触发刷新' },
      ],
      footer: '额外能力（异常/同阵营队友）：异常掌控超100每点+0.2%积蓄效率、+0.2%异常与紊乱伤害（各上限20%），见队友buff。',
    },
    {
      id: 'yuzuha-firework-transfer',
      title: '柚叶彩糖花火·转积蓄',
      summary: `花火 ${source.fireworkTickCount} 次 · ·极 ${source.fireworkExtremeCount} 次${source.transferElement ? ` · 转入 ${source.transferElement}` : ''}`,
      rows: [
        { label: '彩糖花火', value: `${source.fireworkTickCount} 次`, detail: '甜蜜惊吓敌人每1秒一次（满覆盖近似），55%攻击力物理 + 17.66 积蓄' },
        { label: '彩糖花火·极', value: `${source.fireworkExtremeCount} 次`, detail: '硬糖射击/夹心硬糖射击重击触发，616%攻击力物理 + 120 积蓄' },
        {
          label: '十人十色转积蓄',
          value: source.transferElement ? `→ ${source.transferElement} 池` : '未转换（无异常队友）',
          detail: '积蓄计入异常队友元素池（行级 element 覆盖）；积蓄不参与柚叶伤害结算（异常伤害由池主施加者面板结算）',
        },
      ],
      footer: '十人十色转积蓄：积蓄进异常队友的元素池（2026-09-02 修复目标元素取招式级积储主元素，此前按 agent.damageElement 转进元素名不匹配的空池）；施加者判定按池内占比，柚叶单发 17.6 积蓄 vs 异常角色数百/发，占比恒小不成为施加者（条件已证伪，销债）。',
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'yuzuha.chainEntryCount',
    label: '柚叶连携入场次数',
    description: '其他角色通过连携技入场时柚叶获得1甜度点；默认0，可按轮转调整。',
    default: 0,
    min: 0,
    max: 20,
    step: 1,
    suffix: '次',
  },
]

export const yuzuhaMechanic: AgentMechanicModule = {
  id: 'agent:yuzuha',
  agentIds: [YUZUHA_AGENT_ID],
  name: '柚叶',
  description: '甜度点/狸之愿：进场3甜度点，连携入场+1；硬糖射击8秒CD后台追击（甜度终身预算全给硬糖）；彩糖花火/·极逐秒后台行 + 十人十色转积蓄（异常队友元素池）。',
  buildCharConfig: buildYuzuhaCharConfig,
  applyTeamConfig: buildYuzuhaTeamConfig,
  buildExecutions: buildYuzuhaExecutions,
  buildResourceResult: buildYuzuhaResourceResult,
  resourceSections: buildYuzuhaResourceSections,
  settings,
}
