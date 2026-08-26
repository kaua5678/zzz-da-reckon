import type { AgentCharConfigInput, AgentMechanicModule, AgentPanelInput, AgentResourceInput, AgentResourceResultInput, AgentResourceSectionsInput } from '../types'
import type { MechanicSetting } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 朱鸢（1241，以太·击破，新艾利都治安局）—— 自身机制模块。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1241.json。
 *
 * 朱鸢机制全部自身向，无团队 buff（1241 teammate-buffs 组原为误挂的橘福福旧版
 * 草稿，已删除；橘福福正式版在 1391 组）。
 *
 * 本模块承接：
 * - 额外能力·武装协同：[支援]或同阵营（治安局）队友在队时，强特/连携/终结后
 *   自身暴击率+30%（10秒窗口高频刷新，按常驻近似），applyPanel 按
 *   additionalAbilityActive 门控。
 * - 核心被动·特种弹药（Lv.12）：消耗[强化霰弹]攻击（请勿抵抗/火力压制）伤害+40%。
 *   口径 [已确认]：通用池平A为聚合行无法按 moveId 拆分，近似为
 *   skillDmgBonus__basic + skillDmgBonus__dashAttack 定向（作用范围略宽：
 *   含不许动/火力奇袭）。失衡状态额外+40% 走覆盖率滑块（helpers 面板块，
 *   轴模式参照仪玄凝云术待接入，非轴默认 0 自调兜底）。
 * - 影画2：请勿抵抗/火力压制以太伤害+10%×5层 → 面板级 etherDmg+50 近似
 *   （作用范围扩至全部以太伤害）。
 * - 影画4：请勿抵抗/火力压制无视25%以太抗性 → 面板级 enemyEtherResReduction+25
 *   近似（同影画2 口径）。
 * - 强化霰弹资源循环（spec resource zhuyuan_shells，用户口径：资源条是角色核心特色）：
 *   初始6枚；突击段4/5、闪避反击、全弹连射、歼灭模式/MAX、掩护射击、自卫还击获取；
 *   影画1 快速装填连携+6/终结+9（原文6/9 口径用户确认，cfgField 按命座门控）；
 *   消耗=压制模式开火（总量口径）。
 * - 影画6 以太余温：累计消耗12枚得1次余温，追加4枚×220%攻击力以太鹿弹
 *   （buildExecutions 执行行）；余温强特耗能-30 按回能口径接入（每次余温 → 30 能量
 *   并入 initialEnergyGift，buildResourceResult，用户口径 2026-08）。
 *
 * 未建模（spec notes）：影画2 防御向。
 */

const ZHUYUAN_AGENT_ID = '1241'
const ZHUYUAN_AA_CRIT_RATE = 30
const ZHUYUAN_CORE_SHELL_DMG = 40
const ZHUYUAN_C2_ETHER_DMG = 50
const ZHUYUAN_C4_ETHER_RES_IGNORE = 25
const ZHUYUAN_SHELLS_RESOURCE_ID = 'zhuyuan_shells'
/** 影画1 快速装填（原文6/9 口径用户确认：连携6枚/终结9枚） */
const ZHUYUAN_C1_RELOAD_CHAIN = 6
const ZHUYUAN_C1_RELOAD_ULTIMATE = 9
/** 影画6 以太余温（原文）：累计消耗12枚得1次，追加4枚×220%攻击力以太鹿弹 */
const ZHUYUAN_C6_AFTERGLOW_COST = 12
const ZHUYUAN_C6_EXTRA_BULLETS = 4
const ZHUYUAN_C6_BULLET_RATIO = 220
/** 影画6 余温强特耗能-30 → 按回能口径：每次余温等价回 30 能量（用户口径 2026-08） */
const ZHUYUAN_C6_AFTERGLOW_ENERGY = 30
/**
 * 压制模式·请勿抵抗的以太强化霰弹（用户口径 2026-08：物理不打，只打以太子弹）：
 * 3 段以太子弹轮转（1241010/1241011/1241012），每段消耗 1 枚强化霰弹。
 * 1 枚霰弹 = 1 段以太子弹（就像艾莲 1 颗充能打 1 段平A），各段 DPS 相同。
 */
const ZHUYUAN_SUPPRESS_ETHER_MOVE_IDS = ['1241010', '1241011', '1241012'] as const
const ZHUYUAN_SUPPRESS_ETHER_ACTION_TIMES = [0.542, 0.542, 1.625] as const
/** 压制以太单段均时 */
const ZHUYUAN_SUPPRESS_ETHER_AVG_TIME =
  (ZHUYUAN_SUPPRESS_ETHER_ACTION_TIMES[0] + ZHUYUAN_SUPPRESS_ETHER_ACTION_TIMES[1] + ZHUYUAN_SUPPRESS_ETHER_ACTION_TIMES[2]) / 3
/** 核心被动·特种弹药：消耗强化霰弹攻击命中失衡敌人额外 +40%（增伤区，仅压制以太行生效，仪玄凝云术同款 per-row） */
const ZHUYUAN_CORE_STUN_DMG = 40

function applyZhuYuanPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    panel.critRate = (panel.critRate ?? 0) + ZHUYUAN_AA_CRIT_RATE
  }
  panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + ZHUYUAN_CORE_SHELL_DMG
  panel['skillDmgBonus__dashAttack'] = (panel['skillDmgBonus__dashAttack'] ?? 0) + ZHUYUAN_CORE_SHELL_DMG
  if (cinemaLevel >= 2) {
    panel.etherDmg = (panel.etherDmg ?? 0) + ZHUYUAN_C2_ETHER_DMG
  }
  if (cinemaLevel >= 4) {
    panel.enemyEtherResReduction = (panel.enemyEtherResReduction ?? 0) + ZHUYUAN_C4_ETHER_RES_IGNORE
  }
}

const settings: MechanicSetting[] = [
  {
    id: 'zhuYuan.coreStunnedCoverage',
    label: '朱鸢核心被动失衡增伤覆盖率',
    description: '核心被动：消耗强化霰弹攻击命中失衡敌人时增伤额外+40%（per-row 挂在压制以太行，仪玄凝云术同款）。轴模式待接入（轴内行直加/轴外0）；非轴模式默认 0，按需自调。',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  },
]

function buildZhuYuanCharConfig({ cfg, cinemaLevel }: AgentCharConfigInput): void {
  cfg.zhuyuanCinemaLevel = cinemaLevel
}

function computeZhuYuanShellsTotal(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']): number {
  const spec = getAgentSpec(ZHUYUAN_AGENT_ID)
  if (!spec) return 0
  // 影画1 快速装填：连携+6/终结+9（initialValue/gain 的 cfgField 门控；
  // buildExecutions 先于 buildResourceResult 调用，此处写入保证两条路径一致）
  const cinema = Math.max(0, Math.floor(Number((cfg as any).zhuyuanCinemaLevel ?? 0)))
  ;(cfg as any).zhuyuanC1ChainReload = cinema >= 1 ? ZHUYUAN_C1_RELOAD_CHAIN : 0
  ;(cfg as any).zhuyuanC1UltReload = cinema >= 1 ? ZHUYUAN_C1_RELOAD_ULTIMATE : 0
  const shells = computeSpecResources(spec, cfg, state).get(ZHUYUAN_SHELLS_RESOURCE_ID)
  if (!shells) return 0
  return Math.max(0, Math.floor(shells.initialValue + shells.totalGain))
}

function buildZhuYuanExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).zhuyuanCinemaLevel ?? 0)))
  const shellsTotal = computeZhuYuanShellsTotal(cfg, state)
  // 核心被动失衡增伤 +40%：per-row 挂在压制以太行（仪玄凝云术同款），非轴按覆盖率近似（默认0），轴模式待接入
  const stunCov = Math.max(0, Math.min(1, Number((cfg as any)['setting:zhuYuan.coreStunnedCoverage'] ?? 0)))
  const stunBonus = stunCov > 0 ? Math.round(ZHUYUAN_CORE_STUN_DMG * stunCov) : 0
  // 压制模式·请勿抵抗：1 枚霰弹 = 1 段以太强化霰弹（1241010/1241011/1241012 三段轮转），
  // 时间有界（超出平A池的霰弹浪费，时间紧可浪费）。物理不打（用户口径）。
  const maxByTime = Math.max(0, Math.floor((state.basicAttackTime ?? 0) / ZHUYUAN_SUPPRESS_ETHER_AVG_TIME))
  const bullets = Math.min(shellsTotal, maxByTime)
  const len = ZHUYUAN_SUPPRESS_ETHER_MOVE_IDS.length
  for (let i = 0; i < len; i++) {
    const count = Math.floor((bullets + len - 1 - i) / len)
    if (count <= 0) continue
    executions.push({
      moveId: ZHUYUAN_SUPPRESS_ETHER_MOVE_IDS[i],
      moveName: `普通攻击：请勿抵抗 #${i + 1}（以太强化霰弹）`,
      category: 'basic',
      element: 'ether',
      count,
      actionTime: ZHUYUAN_SUPPRESS_ETHER_ACTION_TIMES[i],
      comboAlignRatio: 0,
      totalTime: count * ZHUYUAN_SUPPRESS_ETHER_ACTION_TIMES[i],
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      ...(stunBonus > 0 ? { dmgBonus: stunBonus } : {}),
    })
  }
  if (cinema < 6) return
  const afterglowCount = Math.floor(shellsTotal / ZHUYUAN_C6_AFTERGLOW_COST)
  if (afterglowCount <= 0) return
  executions.push({
    moveId: 'zhuyuan_c6_afterglow_bullets',
    moveName: '以太余温·追加鹿弹',
    category: 'special',
    count: afterglowCount * ZHUYUAN_C6_EXTRA_BULLETS,
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
    damageMultiplier: ZHUYUAN_C6_BULLET_RATIO,
    damageMultiplierOverride: true,
    element: 'ether',
    skillTableNote: `以太余温 ×${afterglowCount} 次 ×${ZHUYUAN_C6_EXTRA_BULLETS} 枚鹿弹（累计消耗${ZHUYUAN_C6_AFTERGLOW_COST}枚霰弹得1次；每枚 ${ZHUYUAN_C6_BULLET_RATIO}% 攻击力）`,
  })
}

function buildZhuYuanResourceResult({ cfg, state }: AgentResourceResultInput) {
  const spec = getAgentSpec(ZHUYUAN_AGENT_ID)
  if (!spec) return {}
  computeZhuYuanShellsTotal(cfg, state) // 写入影画门控的快速装填量
  const shellsTotal = computeZhuYuanShellsTotal(cfg, state)
  const cinema = Math.max(0, Math.floor(Number((cfg as any).zhuyuanCinemaLevel ?? 0)))
  if (cinema >= 6) {
    // 影画6 余温强特耗能-30 → 回能口径：余温次数 × 30 并入开局能量总账（用户口径 2026-08）
    const afterglow = Math.floor(shellsTotal / ZHUYUAN_C6_AFTERGLOW_COST)
    if (afterglow > 0) {
      cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + afterglow * ZHUYUAN_C6_AFTERGLOW_ENERGY
    }
  }
  return { specResources: Object.fromEntries(computeSpecResources(spec, cfg, state)) }
}

function buildZhuYuanResourceSections(input: AgentResourceSectionsInput) {
  const spec = getAgentSpec(ZHUYUAN_AGENT_ID)
  const sections = spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
  const shells = (input.result?.specResources ?? {})[ZHUYUAN_SHELLS_RESOURCE_ID] as
    { initialValue: number; totalGain: number } | undefined
  if (shells) {
    const shellsTotal = Math.max(0, Math.floor(shells.initialValue + shells.totalGain))
    const afterglow = Math.floor(shellsTotal / ZHUYUAN_C6_AFTERGLOW_COST)
    sections.push({
      id: 'zhuyuan-afterglow',
      title: '朱鸢·以太余温（影画6）',
      summary: `余温次数 ≈ ${afterglow}`,
      rows: [
        {
          label: '追加鹿弹',
          value: `${afterglow * ZHUYUAN_C6_EXTRA_BULLETS} 枚`,
          detail: `累计消耗${ZHUYUAN_C6_AFTERGLOW_COST}枚霰弹得1次余温（霰弹总量 ${shellsTotal}），每次追加${ZHUYUAN_C6_EXTRA_BULLETS}枚×${ZHUYUAN_C6_BULLET_RATIO}%攻击力以太鹿弹`,
        },
        {
          label: '余温回能',
          value: `+${afterglow * ZHUYUAN_C6_AFTERGLOW_ENERGY} 能量`,
          detail: `余温强特耗能-30 按回能口径：每次余温等价回 ${ZHUYUAN_C6_AFTERGLOW_ENERGY} 能量（并入开局能量总账）`,
        },
      ],
      footer: '余温回能按整局口径并入 initialEnergyGift（buildResourceResult）。',
    })
  }
  return sections
}

export const zhuYuanMechanic: AgentMechanicModule = {
  id: 'agent:juhufu',
  agentIds: [ZHUYUAN_AGENT_ID],
  name: '朱鸢',
  description: '额外能力暴击率+30%（门控）、核心被动强化霰弹增伤+40%（basic/dashAttack 定向近似，失衡部分走覆盖率滑块）、影画2/4 以太增伤与抗穿；强化霰弹资源循环（spec resource）+ 影画6 以太余温追加鹿弹（buildExecutions）。',
  applyPanel: applyZhuYuanPanel,
  buildCharConfig: buildZhuYuanCharConfig,
  buildExecutions: buildZhuYuanExecutions,
  buildResourceResult: buildZhuYuanResourceResult,
  resourceSections: buildZhuYuanResourceSections,
  settings,
}
