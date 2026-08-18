/**
 * 叶瞬光（1431）—— 用户确认口径
 *
 * 无需失衡轴：白毛（明心境）关键伤害一律按满失衡易伤结算；真失衡只送连携次数。
 * 帷幕易伤 = min(最终失衡易伤倍率, 2.1)；影画4 = min(..., 3.0)。
 *
 * 资源（两套不同）：
 * - 局外「剑势」：attack_data_0 + 额外能力队友帷幕×3 + 影画1 进场6；用于启动（照影耗6）。
 * - 明心境内「青溟剑势」：每次进入固定获得 6 点，打满循环花光。
 * - 观止：每次进入基础 2；影画2 每消耗 1 青溟剑势 +1 观止（打满 6 耗 → 观止 8）。
 *
 * 进入：喧响终结 逐云惊霆 / 琉音转大赠送 逐云 / 耗6剑势 登场技照影。
 * 打满一轮：
 *   (灭#1 + 极) → 扶摇势 → (灭#1 + 极)  // 6 青溟剑势
 *   飞光（倍率/时间按 观止/6 等比）
 *   收尾：喧响逐云进 → 斩妄开天；照影/琉音转大进 → 归尘
 */
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentExSpecialTimeEstimate,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterOperationConfig, MechanicSetting, SkillExecution } from '@/types/resource'
import { fmt } from '@/utils/format'

export const YESHUGUANG_ID = '1431'

const MOVE = {
  entryUlt: '1431025', // 终结技：逐云惊霆
  entryAssist: '1431028', // 登场技：照影
  mie1: '1431013', // 斩流光 灭 #1
  ji: '1431009', // 斩流光 极
  fuyao: '1431017', // 扶摇势
  feiguang: '1431018', // 飞光（6 观止满倍率）
  guichen: '1431019', // 归尘
  zhanwang: '1431027', // 斩妄开天
} as const

/** 明心境关键伤害（满易伤） */
export const YESHUGUANG_FULL_STUN_MOVES = new Set<string>([
  MOVE.entryUlt,
  MOVE.entryAssist,
  MOVE.mie1,
  MOVE.ji,
  MOVE.fuyao,
  MOVE.feiguang,
  MOVE.guichen,
  MOVE.zhanwang,
  '1431026', // 明心境连携
  '1431006', '1431007', '1431008', // 分水行
  '1431010', '1431011', '1431012',
  '1431034', '1431035',
])

const SWORD_MAX = 6
const FORM_SWORD = 6
const BASE_GUANZHI = 2
const FEIGUANG_FULL_GUANZHI = 6
const ZHAOYING_COST = 6

function findMove(skills: AgentSkills | undefined, id: string): SkillMove | null {
  if (!skills) return null
  for (const c of skills.categories) {
    const m = c.moves.find(x => x.id === id)
    if (m) return m
  }
  return null
}

function rowVal(move: SkillMove | null | undefined, rowId: string): number {
  const row = move?.rows?.find(r => r.id === rowId)
  const vals = row?.values ?? []
  if (!vals.length) return 0
  return Number(vals[11] ?? vals[vals.length - 1] ?? 0) || 0
}

function cfgNum(cfg: CharacterOperationConfig, key: string, fallback: number): number {
  const raw = Number((cfg as unknown as Record<string, unknown>)[`setting:${key}`] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

export interface YeshuguangCycleInput {
  ultimateCount: number
  /** 琉音转大赠送的逐云次数（编排层注入） */
  giftUltCount: number
  /** 照影进入次数：-1=自动 floor(局外剑势/6) */
  zhaoyingCountSetting: number
  outsideSwordGain: number
  cinemaLevel: number
  battleTime: number
}

export interface YeshuguangCycleResult {
  decibelForms: number
  giftForms: number
  zhaoyingForms: number
  totalForms: number
  outsideSword: number
  swordPerForm: number
  guanzhiPerForm: number
  feiguangScale: number
  finisherZhanwang: number
  finisherGuichen: number
  pairsPerForm: number
  fuyaoPerForm: number
}

/** 纯函数：明心境轮次与观止/收尾拆分（可单测） */
export function computeYeshuguangCycle(input: YeshuguangCycleInput): YeshuguangCycleResult {
  const cinema = Math.max(0, Math.floor(input.cinemaLevel || 0))
  const decibelForms = Math.max(0, Math.floor(input.ultimateCount || 0))
  const giftForms = Math.max(0, Math.floor(input.giftUltCount || 0))
  const outside = Math.max(0, Number(input.outsideSwordGain) || 0)
  const autoZhao = Math.floor(outside / ZHAOYING_COST)
  const zhaoSetting = Math.floor(input.zhaoyingCountSetting)
  const zhaoyingForms = Math.max(0, zhaoSetting >= 0 ? Math.min(zhaoSetting, autoZhao) : autoZhao)

  const totalForms = decibelForms + giftForms + zhaoyingForms
  // 打满：6 青溟剑势；观止 = 2 + (C2 ? 6 : 0)
  const swordPerForm = FORM_SWORD
  const guanzhiPerForm = BASE_GUANZHI + (cinema >= 2 ? swordPerForm : 0)
  const feiguangScale = guanzhiPerForm / FEIGUANG_FULL_GUANZHI
  // 两轮 (灭#1+极)，中间一次扶摇
  const pairsPerForm = 2
  const fuyaoPerForm = 1

  return {
    decibelForms,
    giftForms,
    zhaoyingForms,
    totalForms,
    outsideSword: outside,
    swordPerForm,
    guanzhiPerForm,
    feiguangScale,
    finisherZhanwang: decibelForms, // 仅喧响逐云进 → 斩妄
    finisherGuichen: giftForms + zhaoyingForms,
    pairsPerForm,
    fuyaoPerForm,
  }
}

/** 局外剑势获取：C1 初始 + attack_data_0×非明心境招次数近似 + 帷幕×3 */
export function computeOutsideSwordGain(cfg: CharacterOperationConfig, state: {
  basicAttackTime?: number
  exSpecialCount?: number
  ultimateCount?: number
  dodgeCounterCount?: number
  chainCountTotal?: number
}): number {
  const record = cfg as unknown as Record<string, unknown>
  const initial = Math.max(0, Number(record.yeshuguangSwordInitial ?? 0) || 0)
  const atk0PerSec = Math.max(0, Number(record.yeshuguangAtk0PerSec ?? 0) || 0)
  const basic = Math.max(0, state.basicAttackTime ?? 0)
  const fromBasic = basic * atk0PerSec
  // 闪反/强特/连携等按预存 attack_data_0 均值×次数（buildCharConfig 写入）
  const perDodge = Math.max(0, Number(record.yeshuguangAtk0Dodge ?? 0) || 0)
  const perEx = Math.max(0, Number(record.yeshuguangAtk0Ex ?? 0) || 0)
  const perChain = Math.max(0, Number(record.yeshuguangAtk0Chain ?? 0) || 0)
  const fromDodge = (cfg.dodgeCounterCount ?? 0) * perDodge
  const fromEx = (state.exSpecialCount ?? 0) * perEx
  const fromChain = (state.chainCountTotal ?? 0) * perChain
  const curtains = Math.max(0, Math.floor(Number(record.yeshuguangTeamCurtainCount ?? cfgNum(cfg, 'yeshuguang.teamCurtainCount', 0)) || 0))
  const aa = Number(record.yeshuguangAdditionalAbilityActive ?? 0) > 0
  const fromCurtain = aa ? curtains * 3 : 0
  return initial + fromBasic + fromDodge + fromEx + fromChain + fromCurtain
}

function pushExec(
  executions: SkillExecution[],
  moveId: string,
  moveName: string,
  category: string,
  count: number,
  actionTime: number,
  dmg: number,
  note: string,
  extra?: Partial<SkillExecution>,
) {
  if (count <= 0 || dmg <= 0) return
  executions.push({
    moveId,
    moveName,
    category,
    count,
    actionTime,
    comboAlignRatio: 0,
    totalTime: actionTime * count,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: dmg,
    damageMultiplierOverride: true,
    element: 'physical',
    skillTableNote: note,
    ...extra,
  } as SkillExecution)
}

function buildCharConfig({ skills, cinemaLevel, team, panel, cfg }: AgentCharConfigInput): void {
  const cinema = cinemaLevel ?? 0
  const record = cfg as unknown as Record<string, unknown>
  record.yeshuguangCinemaLevel = cinema

  // 影画1：进场 6 局外剑势
  cfg.yeshuguangSwordInitial = cinema >= 1 ? 6 : 0
  // 影画4：进场 1000 喧响
  if (cinema >= 4) {
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + 1000
  }

  // 通用大招走逐云惊霆（进入明心境）
  cfg.ultimateMoveId = MOVE.entryUlt
  const ult = findMove(skills, MOVE.entryUlt)
  if (ult) {
    cfg.ultimateActionTime = ult.actionTime ?? cfg.ultimateActionTime
  }

  // 明心境爆发由模块生成；强特（定风波）仍走通用能量池（非白毛）
  // 预存倍率/时间
  const dmg: Record<string, number> = {}
  const times: Record<string, number> = {}
  for (const id of Object.values(MOVE)) {
    const mv = findMove(skills, id)
    dmg[id] = rowVal(mv, 'damage')
    times[id] = mv?.actionTime ?? 0
  }
  record.yeshuguangMoveDmg = dmg
  record.yeshuguangMoveTimes = times

  // 局外 attack_data_0：平A 四段加权秒均 + 闪反/强特/连携单次
  const basicIds = ['1431001', '1431002', '1431003', '1431005']
  let basicAtk0 = 0
  let basicTime = 0
  for (const id of basicIds) {
    const mv = findMove(skills, id)
    basicAtk0 += rowVal(mv, 'attack_data_0')
    basicTime += mv?.actionTime ?? 0
  }
  // 一轮快剑总 attack_data_0 / 总时间 ≈ 每秒剑势
  record.yeshuguangAtk0PerSec = basicTime > 0 ? basicAtk0 / basicTime : 0
  record.yeshuguangAtk0Dodge = rowVal(findMove(skills, '1431022'), 'attack_data_0')
  record.yeshuguangAtk0Ex = rowVal(findMove(skills, '1431016'), 'attack_data_0') // 定风波
  record.yeshuguangAtk0Chain = rowVal(findMove(skills, '1431024'), 'attack_data_0')

  const aa = (panel as any)?.additionalAbilityActive ?? 0
  record.yeshuguangAdditionalAbilityActive = aa
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.yeshuguangCinemaLevel ?? 0)))
  const dmg = (record.yeshuguangMoveDmg ?? {}) as Record<string, number>
  const times = (record.yeshuguangMoveTimes ?? {}) as Record<string, number>

  const outside = computeOutsideSwordGain(cfg, state)
  const gift = Math.max(0, Math.floor(Number(record.yeshuguangGiftUltCount ?? 0) || 0))
  const cycle = computeYeshuguangCycle({
    ultimateCount: state.ultimateCount ?? 0,
    giftUltCount: gift,
    zhaoyingCountSetting: cfgNum(cfg, 'yeshuguang.zhaoyingCount', -1),
    outsideSwordGain: outside,
    cinemaLevel: cinema,
    battleTime: cfg.battleTime ?? 180,
  })
  record.yeshuguangCycle = cycle
  record.yeshuguangOutsideSword = outside

  if (cycle.totalForms <= 0) return

  const pairs = cycle.pairsPerForm * cycle.totalForms
  const fuyao = cycle.fuyaoPerForm * cycle.totalForms
  const scale = cycle.feiguangScale

  // 照影进入（登场技）
  pushExec(
    executions,
    MOVE.entryAssist,
    '登场技：照影',
    'assist',
    cycle.zhaoyingForms,
    times[MOVE.entryAssist] ?? 0,
    dmg[MOVE.entryAssist] ?? 0,
    `照影进入明心境 ×${cycle.zhaoyingForms}（耗局外剑势 6/次）`,
  )

  // 灭#1 + 极（每轮 2 对）
  pushExec(
    executions,
    MOVE.mie1,
    '普通攻击：明心境·斩流光 灭 #1',
    'basic',
    pairs,
    times[MOVE.mie1] ?? 0,
    dmg[MOVE.mie1] ?? 0,
    `斩流光·灭#1 ×${pairs}（每轮明心境 2 次，耗青溟剑势）`,
  )
  pushExec(
    executions,
    MOVE.ji,
    '普通攻击：明心境·斩流光 极',
    'basic',
    pairs,
    times[MOVE.ji] ?? 0,
    dmg[MOVE.ji] ?? 0,
    `斩流光·极 ×${pairs}（每轮明心境 2 次，耗青溟剑势）`,
  )
  pushExec(
    executions,
    MOVE.fuyao,
    '普通攻击：明心境·扶摇势',
    'basic',
    fuyao,
    times[MOVE.fuyao] ?? 0,
    dmg[MOVE.fuyao] ?? 0,
    `扶摇势 ×${fuyao}（两轮斩流光之间起飞）`,
  )

  // 飞光：满 6 观止倍率为表值，按观止/6 缩放倍率与时间
  const fgDmg = (dmg[MOVE.feiguang] ?? 0) * scale
  const fgTime = (times[MOVE.feiguang] ?? 0) * scale
  pushExec(
    executions,
    MOVE.feiguang,
    '强化特殊技：明心境·飞光',
    'special',
    cycle.totalForms,
    fgTime,
    fgDmg,
    `飞光 ×${cycle.totalForms}（观止 ${cycle.guanzhiPerForm}/6 → 倍率·时间 ×${fmt(scale * 100, 0)}%）`,
  )

  // 收尾
  pushExec(
    executions,
    MOVE.zhanwang,
    '终结技：斩妄开天',
    'chain',
    cycle.finisherZhanwang,
    times[MOVE.zhanwang] ?? 0,
    dmg[MOVE.zhanwang] ?? 0,
    `斩妄开天 ×${cycle.finisherZhanwang}（喧响逐云进入收尾）`,
  )
  pushExec(
    executions,
    MOVE.guichen,
    '强化特殊技：明心境·归尘',
    'special',
    cycle.finisherGuichen,
    times[MOVE.guichen] ?? 0,
    dmg[MOVE.guichen] ?? 0,
    `归尘 ×${cycle.finisherGuichen}（照影/琉音转大进入收尾）`,
  )
}

function estimateExSpecialTime({ cfg, ultimateCount }: AgentExSpecialTimeInput): AgentExSpecialTimeEstimate | null {
  const record = cfg as unknown as Record<string, unknown>
  const cycle = record.yeshuguangCycle as YeshuguangCycleResult | undefined
  const times = (record.yeshuguangMoveTimes ?? {}) as Record<string, number>
  // 若 cycle 尚未生成，用 ultimateCount 粗估一轮
  const forms = cycle?.totalForms ?? Math.max(0, Math.floor(ultimateCount || 0))
  if (forms <= 0) return null
  const scale = cycle?.feiguangScale ?? (BASE_GUANZHI / FEIGUANG_FULL_GUANZHI)
  const guanzhi = cycle?.guanzhiPerForm ?? BASE_GUANZHI
  const perForm =
    2 * ((times[MOVE.mie1] ?? 0) + (times[MOVE.ji] ?? 0))
    + (times[MOVE.fuyao] ?? 0)
    + (times[MOVE.feiguang] ?? 0) * (guanzhi / FEIGUANG_FULL_GUANZHI)
    + Math.max(times[MOVE.guichen] ?? 0, times[MOVE.zhanwang] ?? 0)
  // 照影进入时间
  const zhao = (cycle?.zhaoyingForms ?? 0) * (times[MOVE.entryAssist] ?? 0)
  const necessaryTime = forms * perForm + zhao
  return { necessaryTime, comboAlignTime: 0 }
}

function buildResourceResult({ cfg, state }: AgentResourceResultInput) {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.yeshuguangCinemaLevel ?? 0)))
  const outside = computeOutsideSwordGain(cfg, state)
  const gift = Math.max(0, Math.floor(Number(record.yeshuguangGiftUltCount ?? 0) || 0))
  const cycle = computeYeshuguangCycle({
    ultimateCount: state.ultimateCount ?? 0,
    giftUltCount: gift,
    zhaoyingCountSetting: cfgNum(cfg, 'yeshuguang.zhaoyingCount', -1),
    outsideSwordGain: outside,
    cinemaLevel: cinema,
    battleTime: cfg.battleTime ?? 180,
  })
  record.yeshuguangCycle = cycle
  const formSwordTotal = cycle.totalForms * FORM_SWORD
  const guanzhiTotal = cycle.totalForms * cycle.guanzhiPerForm
  return {
    yeshuguangCycle: cycle,
    specResources: {
      yeshuguang_sword_momentum: {
        id: 'yeshuguang_sword_momentum',
        name: '局外剑势',
        initialValue: cfg.yeshuguangSwordInitial ?? 0,
        maxValue: SWORD_MAX,
        totalGain: outside - (cfg.yeshuguangSwordInitial ?? 0),
        gains: {
          outside_total: outside,
        },
        bonusCount: 0,
        total: outside,
        remaining: Math.max(0, outside - cycle.zhaoyingForms * ZHAOYING_COST),
        spendCounts: { zhaoying: cycle.zhaoyingForms },
        spendCosts: { zhaoying: cycle.zhaoyingForms * ZHAOYING_COST },
      },
      yeshuguang_qingming_burst: {
        id: 'yeshuguang_qingming_burst',
        name: '明心境·青溟剑势',
        initialValue: 0,
        maxValue: FORM_SWORD,
        totalGain: formSwordTotal,
        gains: { per_form: formSwordTotal },
        bonusCount: 0,
        total: formSwordTotal,
        remaining: 0,
        spendCounts: { burst: cycle.totalForms },
        spendCosts: { burst: formSwordTotal },
      },
      yeshuguang_guanzhi: {
        id: 'yeshuguang_guanzhi',
        name: '观止',
        initialValue: 0,
        maxValue: cinema >= 2 ? 9 : 2,
        totalGain: guanzhiTotal,
        gains: { per_form: guanzhiTotal },
        bonusCount: 0,
        total: guanzhiTotal,
        remaining: 0,
        spendCounts: { feiguang: cycle.totalForms },
        spendCosts: { feiguang: guanzhiTotal },
      },
      yeshuguang_mingxin: {
        id: 'yeshuguang_mingxin',
        name: '明心境',
        initialValue: 0,
        maxValue: 1,
        totalGain: cycle.totalForms,
        gains: {
          decibel: cycle.decibelForms,
          gift: cycle.giftForms,
          zhaoying: cycle.zhaoyingForms,
        },
        bonusCount: 0,
        total: cycle.totalForms,
        remaining: 0,
        spendCounts: {},
        spendCosts: {},
      },
    },
  }
}

function resourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = (result as any)?.yeshuguangCycle as YeshuguangCycleResult | undefined
  if (!cycle) return []
  return [{
    id: 'yeshuguang-cycle',
    title: '叶瞬光·明心境账本',
    summary: `明心境 ${cycle.totalForms} 轮（逐云${cycle.decibelForms}+转大${cycle.giftForms}+照影${cycle.zhaoyingForms}）· 观止${cycle.guanzhiPerForm}/轮`,
    rows: [
      { label: '局外剑势', value: fmt(cycle.outsideSword, 1), detail: 'attack_data_0 + 帷幕×3 + 影画1' },
      { label: '明心境轮次', value: String(cycle.totalForms), detail: `斩妄收尾 ${cycle.finisherZhanwang} · 归尘收尾 ${cycle.finisherGuichen}` },
      { label: '青溟剑势/轮', value: String(cycle.swordPerForm), detail: '进入后固定 6，打满两轮斩流光' },
      { label: '观止/轮', value: String(cycle.guanzhiPerForm), detail: cycle.guanzhiPerForm > 2 ? '基础2+影画2每剑势+1' : '基础2' },
      { label: '飞光缩放', value: `${fmt(cycle.feiguangScale * 100, 0)}%`, detail: '倍率与时间按观止/6' },
    ],
  }]
}

export const yeshuguangSettings: MechanicSetting[] = [
  {
    id: 'yeshuguang.teamCurtainCount',
    label: '叶瞬光·队友整局以太帷幕次数',
    description: '额外能力：每次队友开帷幕 +3 局外剑势（需支援/防护在队）。后续有帷幕角色录入后由编排层自动注入，也可手填。',
    default: 0,
    min: 0,
    max: 30,
    step: 1,
  },
  {
    id: 'yeshuguang.zhaoyingCount',
    label: '叶瞬光·照影进入明心境次数',
    description: '耗 6 局外剑势/次。默认 -1 = 自动 floor(局外剑势/6)；手动填则不超过自动上限。',
    default: -1,
    min: -1,
    max: 20,
    step: 1,
  },
]

export const yeshuguangMechanic: AgentMechanicModule = {
  id: 'agent:yeshuguang',
  agentIds: [YESHUGUANG_ID],
  name: '叶瞬光·明心境',
  description: '白毛明心境打满循环；关键伤害满易伤；帷幕易伤封顶 210%/300%。',
  settings: yeshuguangSettings,
  buildCharConfig,
  buildExecutions,
  estimateExSpecialTime,
  buildResourceResult,
  resourceSections,
}

export default yeshuguangMechanic
