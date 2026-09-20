import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { CharacterResourceResult, JaneMechanicSource, MechanicSetting } from '@/types/resource'
import { fmt } from '@/utils/format'

const JANE_AGENT_ID = '1261'
/** 普通攻击：萨霍夫跳（融合主段，见 src/data/moveFusions.ts JANE_SOMERSAULT） */
const JANE_SOMERSAULT_MOVE_ID = '1261007'
const ASSAULT_CRIT_BASE = 20
const ASSAULT_CRIT_PER_MASTERY = 0.1
const ASSAULT_CRIT_DMG = 50
const FRENZY_BUILD_UP_BONUS_CORE = 25
const MASTERY_ATK_THRESHOLD = 120
const ATK_PER_MASTERY_OVER = 2
const ATK_FROM_MASTERY_CAP = 600
const POTENTIAL_ASSAULT_CRIT_DMG = 30

/** 覆盖率/开关类滑块统一收敛到 [0,1]；非有限值回退 `fallback`（勿回退 0：会把「未注入」变成「归零」）。 */
function clamp01(value: unknown, fallback = 1): number {
  const num = Number(value)
  return Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : fallback
}

export function computeJaneMechanic(input: {
  anomalyProficiency: number
  frenzyActive: boolean
  frontlineSeconds: number
}): JaneMechanicSource {
  const mastery = Math.max(0, input.anomalyProficiency)
  const assaultCritRate = ASSAULT_CRIT_BASE + mastery * ASSAULT_CRIT_PER_MASTERY
  return {
    assaultCritBaseRate: ASSAULT_CRIT_BASE,
    assaultCritRatePerMastery: ASSAULT_CRIT_PER_MASTERY,
    assaultCritRate,
    assaultCritDmgBonus: POTENTIAL_ASSAULT_CRIT_DMG,
    frenzyBuildUpBonus: FRENZY_BUILD_UP_BONUS_CORE,
    atkFromMastery: Math.min(ATK_FROM_MASTERY_CAP, Math.max(0, mastery - MASTERY_ATK_THRESHOLD) * ATK_PER_MASTERY_OVER),
    frenzyActive: input.frenzyActive,
    biteSeconds: Math.max(0, input.frontlineSeconds),
    note: '啮咬：攻击命中使敌人进入状态，持续10秒；强击对啮咬目标可暴击（基础20%+精通0.1%/点，暴伤50%），潜能觉醒满级额外+30%强击暴伤；狂热物理积蓄效率与精通转攻、额外能力痛点、影画1/6 面板区见 resourceCalc/helpers 简专属分支（jane.passionCoverage 滑块默认90%）。',
  }
}

/**
 * 狂热面板块（R51 从 `composables/resourceCalc/panelPhases.ts` 迁入，规则 6）。
 *
 * ## 为什么现在才迁得动（2026-09-20 round 51，用户裁决）
 *
 * R20-h1 批次 1 / A11 分诊判定「迁不动」：本块唯一输入 `jane.passionCoverage` **当时未注册**
 * 成 MechanicSetting ⇒ 不在 `AgentPanelInput.settings` 里（`resolveMechanicSettings` 只铺注册项），
 * 迁进本函数会把用户滑块值静默丢掉（逐位对拍实测：滑块 0.5 的队 `physicalAnomalyBuildUpEfficiency`
 * 由 47.5 掉到 0）。**用户 R51 裁决「一并注册成 MechanicSetting」** ⇒ 障碍消失，本块迁入。
 * ★ 两块必须**同批**迁：`frenzyActive`（总闸）与 `passionCoverage`（覆盖率）现在读同一个
 * `settings` 字段，只迁一块、另一块留在 `panelPhases.ts` 会与这里**双计**。
 *
 * ## 口径（用户 R51 裁决，逐字）
 *
 * - **狂热块**（物理积蓄 +25%、精通>120 每点 +2 攻击上限 600）与**影画1 块**（物理积蓄 +15%、
 *   精通增伤 0.1%/点上限 30%）**都吃** `frenzyActive` 总闸 ⇒ 关闭时**双双归零**。
 *   依据：1 命条目原文自述「按狂热覆盖率折算」⇒ 它本就以狂热为前提。
 * - **额外能力·痛点**（物理积蓄 +20%、敌人异常时 +15%）**不吃**总闸：痛点是「额外能力」，
 *   与狂热状态无绑定。
 * - **影画6 双暴 +20/40 不吃**总闸：6 命自身写「触发强击即狂热」（是狂热的**来源**，不是后果）。
 * - ⚠ `frenzyActive` 缺省 **1**（狂热是简的常驻核心状态）；只有显式 0 才关闭。
 *   原实现两处调用点**硬编码 true** 且滑块零读值点（R48/R50/R51 三任实测 `IDENTICAL`）⇒ 现真正被读。
 *
 * ⚠ **判据原样保留 `teammateBuffId === '1261'` 右臂**（数据面守卫，同 `liuyin.ts` 先例）：
 * `'1261'` 确实在 catalog 的 `teammateBuffId` 清单里（1261/1581/1411/1171/1511，且 1261
 * 指向自己）⇒ 该臂**当前就 true**，但派发点按 `agent.id` 寻址而等价（自己指向自己）。
 * 删它是语义变更不是清理：将来数据面若把别的角色指向 1261，该角色的面板也要走本块。
 */
function applyJanePanel({ panel, settings, agent, slot, team, cinemaLevel }: AgentPanelInput): void {
  const source = computeJaneMechanic({
    anomalyProficiency: panel.anomalyProficiency ?? 0,
    // 传 true：本函数的产物只用于**非狂热门控**字段（强击暴击率/暴伤/精通转攻），
    // 狂热门控在下面 `frenzyFactor` 处统一施加，避免两处各判一次导致口径漂移。
    frenzyActive: true,
    frontlineSeconds: 0,
  })
  panel.assaultCritRate = (panel.assaultCritRate ?? 0) + source.assaultCritRate
  panel.assaultCritDmg = (panel.assaultCritDmg ?? 0) + ASSAULT_CRIT_DMG
  // 潜能觉醒只给简自身触发的强击吃，乱流不继承；由异常池按 janeAssaultCritDmgBonus 单独结算。
  panel.janeAssaultCritDmgBonus = source.assaultCritDmgBonus

  // ⚠ 身份守卫必须**容忍直调**（`jane.test.ts` 曾只传 `{ panel }` 就调本钩子，见该文件）：
  // 缺失 `agent` 时按「是简」放行（本模块本来就只被简的槽位派发），而不是抛 TypeError。
  if (agent && !(agent.id === JANE_AGENT_ID || agent.teammateBuffId === JANE_AGENT_ID)) return
  const settingsMap = settings ?? {}
  const teamMembers = team ?? []

  // ── 狂热面板块（原 panelPhases.ts:650-684，逐位迁移 + 新增总闸）──────────────────
  const frenzy = clamp01(settingsMap['jane.frenzyActive'] ?? 1)
  const passionCoverage = clamp01(settingsMap['jane.passionCoverage'] ?? 0.9)
  // 狂热关闭 ⇒ 狂热块与 1 命块归零；痛点/6 命不受影响（口径见函数头注释）。
  const frenzyFactor = frenzy * passionCoverage
  const anomalyProficiency = panel.anomalyProficiency ?? 0

  // 狂热：物理积蓄+25%；精通>120时每点+2攻击，最多600。
  panel.physicalAnomalyBuildUpEfficiency = (panel.physicalAnomalyBuildUpEfficiency ?? 0) + 25 * frenzyFactor
  if (anomalyProficiency > MASTERY_ATK_THRESHOLD) {
    panel.atk = (panel.atk ?? 0)
      + Math.min(ATK_FROM_MASTERY_CAP, (anomalyProficiency - MASTERY_ATK_THRESHOLD) * ATK_PER_MASTERY_OVER) * frenzyFactor
  }

  // 额外能力：痛点。物理积蓄+20%；敌人处于异常状态时额外+15%（按100%覆盖）。
  // ⚠ 不吃 `frenzy` 总闸（额外能力与狂热状态无关，见函数头注释）。
  const additionalActive = teamMembers.some(member =>
    member.slot !== slot && member.agent && (
      member.agent.specialty === 'anomaly' || member.agent.faction === agent?.faction
    ),
  )
  if (additionalActive) {
    panel.physicalAnomalyBuildUpEfficiency = (panel.physicalAnomalyBuildUpEfficiency ?? 0) + 20
    panel.physicalAnomalyBuildUpEfficiency = (panel.physicalAnomalyBuildUpEfficiency ?? 0) + 15
  }

  // 1命：物理积蓄+15%；每点精通增伤0.1%，最多30%，按狂热覆盖率折算（吃总闸，见函数头注释）。
  if ((cinemaLevel ?? 0) >= 1) {
    panel.physicalAnomalyBuildUpEfficiency = (panel.physicalAnomalyBuildUpEfficiency ?? 0) + 15 * frenzyFactor
    panel.dmgBonus = (panel.dmgBonus ?? 0) + Math.min(30, anomalyProficiency * 0.1) * frenzyFactor
  }

  // 6命：触发强击即狂热，狂热覆盖率按100%；双暴+20/40。不吃总闸（6命是狂热的来源）。
  if ((cinemaLevel ?? 0) >= 6) {
    panel.critRate = (panel.critRate ?? 0) + 20
    panel.critDmg = (panel.critDmg ?? 0) + 40
  }
}

function buildJaneResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    janeMechanicSource: computeJaneMechanic({
      anomalyProficiency: cfg.panel.anomalyProficiency ?? 0,
      frenzyActive: true,
      frontlineSeconds: state.frontlineTime,
    }),
  }
}

function buildJaneResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.janeMechanicSource
  if (!source) return []
  return [{
    id: 'jane-mechanic',
    title: '简·啮咬/狂热/强击暴击',
    summary: `强击暴击率 ${fmt(source.assaultCritRate)}% · 狂热 ${source.frenzyActive ? '生效' : '未生效'}`,
    rows: [
      { label: '啮咬覆盖', value: `${fmt(source.biteSeconds)}s`, detail: '攻击命中使敌人陷入啮咬，持续10秒' },
      { label: '强击暴击率', value: `${fmt(source.assaultCritRate)}%`, detail: `基础20% + 异常精通×0.1%` },
      { label: '强击暴击伤害', value: '50%', detail: '强击对啮咬目标可暴击' },
      { label: '潜能强击暴伤', value: `+${source.assaultCritDmgBonus}%`, detail: '潜能觉醒：致命舞步' },
      { label: '狂热积蓄提升', value: `+${source.frenzyBuildUpBonus}%`, detail: '物理异常积蓄效率（核心，默认满覆盖）' },
      { label: '精通转攻击', value: `+${fmt(source.atkFromMastery)}`, detail: '精通>120每点+2，上限600' },
    ],
    footer: source.note,
  }]
}

const settings: MechanicSetting[] = [
  {
    id: 'jane.frenzyActive',
    label: '简狂热状态生效',
    description: '狂热总闸：关闭时「狂热」块（物理积蓄+25%、精通转攻）与「影画1」块（物理积蓄+15%、精通增伤）双双归零；额外能力·痛点与影画6 双暴不受影响（与狂热状态无绑定）。狂热是简的常驻核心状态，默认生效。',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    suffix: '',
  },
  {
    // R51 注册（用户裁决）：此前只由 `ResourceUtilizationPage.vue` 一张手写卡片驱动
    // （`configStore.getMechanicSetting('jane.passionCoverage', 0.9)`），**不在注册表里** ⇒
    // 不在 `AgentPanelInput.settings` 内 ⇒ 面板块只能留在 `panelPhases.ts` 的 agentId 分支里。
    // 注册后本模块自己读得到（`applyJanePanel`），手写卡片同步删除以避双滑块。
    id: 'jane.passionCoverage',
    label: '简狂热覆盖率',
    description: '狂热状态的时间覆盖率：直接按比例折算「狂热」块（物理积蓄+25%、精通转攻）与「影画1」块（物理积蓄+15%、精通增伤）。默认 90%。',
    default: 0.9,
    min: 0,
    max: 1,
    step: 0.01,
    suffix: '%',
  },
]

/** 记录命座等级（萨霍夫跳次数用） */
function buildJaneCharConfig({ cfg, cinemaLevel }: AgentCharConfigInput): void {
  ;(cfg as unknown as Record<string, unknown>).janeCinemaLevel = cinemaLevel ?? 0
}

/** 萨霍夫跳：狂热进场 1 次 + 影画1 额外 1 次；数值同平A、仅额外回复狂热（融合组见 moveFusions）。 */
function buildJaneExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).janeCinemaLevel ?? 0)))
  const count = 1 + (cinema >= 1 ? 1 : 0)
  if (count <= 0) return
  executions.push({
    moveId: JANE_SOMERSAULT_MOVE_ID,
    moveName: '普通攻击：萨霍夫跳',
    category: 'basic',
    count,
    actionTime: 0,
    comboAlignRatio: 0,
    // totalTime=0：萨霍夫跳时间已含在平A前台预算内，只补伤害（数值同平A、回复狂热）
    totalTime: 0,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    timeBucket: 'basic',
  })
}

export const janeMechanic: AgentMechanicModule = {
  id: 'agent:jane',
  agentIds: [JANE_AGENT_ID],
  name: '简',
  description: '啮咬/狂热/强击暴击：攻击施加啮咬10秒，强击对啮咬目标可暴击（基础20%+精通0.1%/点，暴伤50%）；萨霍夫跳（狂热1次+影画1+1次）；影画1/6 面板区。',
  applyPanel: applyJanePanel,
  buildCharConfig: buildJaneCharConfig,
  buildExecutions: buildJaneExecutions,
  buildResourceResult: buildJaneResourceResult,
  resourceSections: buildJaneResourceSections,
  settings,
}
