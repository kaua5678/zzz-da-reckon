import type { Agent, AgentSkills, PanelValues, SkillMove } from '@/types/catalog'
import type {
  AnomalyEventExecution,
  AnomalyContribution,
  AnomalyPoolResult,
  CharacterOperationConfig,
  CharacterResourceResult,
  IterationState,
  MechanicSetting,
  SkillExecution,
  SpecialResourceSection,
} from '@/types/resource'
import type { StunSkillExecution } from '@/core/stunPool'
import type { AnomalySkillExecution } from '@/core/anomalyPool'

/** 队伍中某个槽位的最小上下文快照 */
export interface MechanicTeamMember {
  slot: number
  agentId: string
  agent: Agent | null
  cinemaLevel: number
  wEngineId: string
  wEngineModLevel: number
}

export interface AgentPanelInput {
  slot: number
  agent: Agent
  cinemaLevel: number
  team: MechanicTeamMember[]
  /** 未合并局内 buff 的面板，供“初始属性”类转化读取 */
  outOfCombatPanel: Readonly<PanelValues>
  panel: PanelValues
  /**
   * 已解析的机制滑块值（setting id → 当前值，含默认值兜底）。
   *
   * 覆盖率类滑块（怒相增益/双邦布在外/静心…）本就该在面板阶段生效，直接读本字段即可：
   * `input.settings['banyue.rageGainCoverage'] ?? 1`。
   * 历史坑：applyPanel 早于 cfg 构建、拿不到 configStore，于是出现两种绕法——
   * ① 在 computePanelPhases 里写按 agentId 分支的硬编码块；② 把滑块值经 panel 字段走私。
   * 走私路径曾静默失效（般岳读 `panel.banyueRageCoverage`，而该字段从未被写入 → 滑块无效），
   * 见 AGENT_RECORDING_SOP §3.5「面板 buff 施加点错误」。新代码一律用本字段，勿再走私。
   */
  settings: Readonly<Record<string, number>>
}

export interface AgentCharConfigInput {
  slot: number
  agent: Agent
  skills: AgentSkills
  cinemaLevel: number
  wEngineId: string
  wEngineModLevel: number
  team: MechanicTeamMember[]
  panel: PanelValues
  cfg: CharacterOperationConfig
  getRowValue: (move: SkillMove | null | undefined, rowId: string) => number
}

export interface AgentResourceInput {
  cfg: CharacterOperationConfig
  state: IterationState
  executions: SkillExecution[]
  /** 其他队友前台时间合计（秒），供队友触发类机制使用 */
  teamFrontlineSeconds?: number
}

/**
 * 队伍级钩子的调用阶段（编排层按固定顺序派发，语义必须稳定）：
 * - `build`：全队 cfg 刚构建完（次数全未知，exCounts/stunCount 均为 0）；
 * - `converge`：外层不动点进入本轮，带**上一轮**收敛出的次数（次数反馈用）；
 * - `postRound`：本轮资源结果已出，为**下一轮**注入派生量（如全队能量消耗）。
 */
export type AgentTeamPhase = 'build' | 'converge' | 'postRound'

/**
 * 队伍级机制输入（`applyTeamConfig` 钩子）。
 *
 * 存在的理由：其余钩子都只能改**自己**那一份 cfg，而「我的终结技给邻位回能」「我在后场时
 * 全队能量获得效率 +10%」这类跨槽位联动无处可去，于是长期沉淀成编排层里按 agentId 分支的
 * 手工调用——曾有 5 个 `applyXxxTeamFlags` 被 useResourceCalc 直接 import、在 3 个位置手工
 * 按序调用（其中莱特那条被调 3 次，漏调一处就是静默错值）。
 * 有了本钩子，跨角色联动回到角色模块自己家里，新角色的队伍级机制不必再改 useResourceCalc。
 */
export interface AgentTeamConfigInput {
  /** 本模块角色所在槽位 */
  slot: number
  agent: Agent | null
  cinemaLevel: number
  /** 全队 cfg（**可写**：写任意槽位的字段正是队伍级联动的目的） */
  characters: CharacterOperationConfig[]
  team: MechanicTeamMember[]
  /** 已解析的机制滑块值（与 AgentPanelInput.settings 同源） */
  settings: Readonly<Record<string, number>>
  phase: AgentTeamPhase
  /** 战斗时间（秒） */
  combatTime: number
  /** 各槽位强特次数（build 阶段全 0；converge/postRound 为对应轮次的收敛值） */
  exCounts: number[]
  /** 各槽位终结技次数（build/converge 阶段全 0；postRound 为上一轮收敛值，与 exCounts 同序） */
  ultimateCounts?: number[]
  /** 失衡次数（build 阶段 0） */
  stunCount: number
  /** 全队普通能量消耗（莱特影画4 用；build 阶段 0） */
  teamEnergyConsumed: number
}

export interface AgentExSpecialTimeInput {
  cfg: CharacterOperationConfig
  exSpecialCount: number
  ultimateCount: number
}

export interface AgentExSpecialTimeEstimate {
  /** 强化特殊技占用的必做动作前台时间（秒） */
  necessaryTime: number
  /** 强化特殊技的合轴时间（秒） */
  comboAlignTime: number
}

export interface AgentEventInput {
  cfg: CharacterOperationConfig
  state: IterationState
  events: AnomalyEventExecution[]
  totalTime: number
}

export interface AgentResourceResultInput {
  cfg: CharacterOperationConfig
  state: IterationState
  /** 其他队友前台时间合计（秒），供队友触发类机制使用 */
  teamFrontlineSeconds?: number
}

export interface AgentSkillTransformInput {
  slot: number
  agent: Agent | null
  skills: AgentSkills | undefined
  charResult: CharacterResourceResult
  panel: PanelValues | null
  cinemaLevel: number
  team: MechanicTeamMember[]
  dazeCoef: number
  stunExecs: StunSkillExecution[]
  anomalyExecs: AnomalySkillExecution[]
  getRowValue: (move: SkillMove | null | undefined, rowId: string) => number
  normalizeResourceSkillType: (move: SkillMove | null, execMoveId: string) => string
}

export interface AgentDamageResolutionInput {
  slot: number
  agent: Agent | null
  skills: AgentSkills | undefined
  move: SkillMove | null
  exec: SkillExecution
  team: MechanicTeamMember[]
  cinemaLevel: number
}

export interface ReleaseModifierInput {
  panels: PanelValues[]
}

export interface AgentResourceSectionsInput {
  result: CharacterResourceResult
  anomalyPoolResult?: AnomalyPoolResult | null
}

/**
 * 角色机制模块。
 *
 * 普通角色不需要实现任何钩子，只有专属战斗、资源、命座或展示逻辑才实现对应函数。
 * 所有钩子必须保持纯函数，不能依赖 DOM 或 Pinia store。
 *
 * 模块文件头注释要求（用户确认口径的唯一代码内记录，必须写）：
 * - 角色 ID/名称、用户确认的核心口径（资源计划、次数折算、覆盖率默认值、命座效果取舍）
 * - 近似点与可调项（settings id），未建模项明确列出
 * 示例见 src/mechanics/agents/luciaElowen.ts / yidhari.ts 头注释。
 * 钩子清单以本接口为准（勿在文档中另抄一份）。
 */
export interface AgentMechanicModule {
  /** 模块唯一 id，如 agent:1561 */
  id: string
  /** catalog 中的稳定 agentId 列表 */
  agentIds: string[]
  name?: string
  description?: string
  /** 局内面板计算后追加专属属性 */
  applyPanel?(input: AgentPanelInput): void
  /** 资源池操作配置构建后追加专属字段 */
  buildCharConfig?(input: AgentCharConfigInput): void
  /**
   * 队伍级机制：跨槽位联动（邻位回能、后场全队增益、入场次数汇总等）。
   *
   * 与 `buildCharConfig` 的分工：后者只改自己那份 cfg，本钩子可写**全队** cfg。
   * 按槽位顺序（0→1→2）派发，一轮计算内会被调用三次（phase = build / converge / postRound），
   * 模块必须按 `input.phase` 决定在哪个阶段动手（阶段语义见 AgentTeamPhase）。
   */
  applyTeamConfig?(input: AgentTeamConfigInput): void
  /** 向招式执行计划追加专属动作 */
  buildExecutions?(input: AgentResourceInput): void
  /**
   * 招式执行计划完全构建后（通用+模块追加均就绪）的修正钩子：
   * 模块可对最终执行列表按 moveId/招式标签补专属字段（增伤/暴击/固定附加伤害等）。
   */
  patchExecutions?(input: AgentResourceInput): void
  /**
   * 覆盖强化特殊技（及模块生成的专属必做动作，如卢西娅 A5）的时间占用，在时间池分配前调用。
   * 返回 null 走通用公式 `exSpecialCount × exSpecialActionTime`；否则按返回值计入必做前台时间与合轴时间。
   */
  estimateExSpecialTime?(input: AgentExSpecialTimeInput): AgentExSpecialTimeEstimate | null
  /** 向异常事件执行计划追加专属事件 */
  buildAnomalyEvents?(input: AgentEventInput): void
  /** 向角色资源结果追加专属资源明细 */
  buildResourceResult?(input: AgentResourceResultInput): Partial<CharacterResourceResult>
  /**
   * 是否由 transformSkillExecutions 完全接管非普攻倍率提取。
   * 仅在钩子会自行重建全部非普攻失衡/积蓄执行时开启；只做面板后处理时保持 false。
   */
  replaceSkillExecutionExtraction?: boolean
  /** 倍率表提取阶段，处理专属失衡/积蓄贡献或最终面板后处理 */
  transformSkillExecutions?(input: AgentSkillTransformInput): void
  /** 直伤行元素/来源解析，返回 null 时走通用规则 */
  resolveExecutionDamage?(input: AgentDamageResolutionInput): { element: string; source?: string; note?: string } | null
  /** 异放/乱流释放类伤害的减抗修正 */
  releaseModifier?(input: ReleaseModifierInput): { enemyResReduction: number; note: string }
  /** 生成资源池卡片上的通用专属资源展示段 */
  resourceSections?(input: AgentResourceSectionsInput): SpecialResourceSection[]
  /** 声明可在资源利用率页调整的机制参数 */
  settings?: MechanicSetting[]
  /** 伴随事件：父动作 moveId → 子事件 moveId 列表（父动作完全落在失衡窗口内时，子事件吃失衡易伤） */
  attachedEvents?: Record<string, string[]>
  /** 连段动作：comboId → 复合招式（特殊技+重碾打包成一个栈单位，能量按打包口径一次扣除） */
  combos?: Record<string, { label: string; energyCost: number; moves: { moveId: string; count: number }[] }>
  /**
   * 异常池预构建钩子：在 perElement 积蓄汇总之前调用（引擎已构建 elementMap 并预算 turbulenceCount）。
   * 模块可向 elementMap 注入额外积蓄贡献（如维琳娜风蚀替换广域），或把机制状态写入 store 供引擎消费。
   * 引擎保证：调用顺序在所有模块的 perElement 汇总之前，注入值进入所有下游（触发次数/覆盖率/note）。
   */
  transformAnomalyPool?(input: AgentAnomalyTransformInput): void
}

/** transformAnomalyPool 钩子输入（calcAnomalyPool 内部，perElement 之前） */
export interface AgentAnomalyTransformInput {
  /** 已按元素分组的积蓄贡献（可变：模块可 push 新贡献） */
  elementMap: Map<string, AnomalyContribution[]>
  panels: PanelValues[]
  bossCoeff: number
  anomalyCoeff: number
  enemyAnomalyResistances: Record<string, number>
  /** 队伍是否有风属性角色（乱流模式） */
  hasWindChar: boolean
  /** 风属性角色槽位 */
  windCharSlot: number
  /** 引擎预算的非风元素触发总次数（turbulenceCount 上限前，供风蚀状态机等使用） */
  preTurbulenceCount: number
  /** 引擎预算的风元素触发次数（供风蚀状态机 windTriggerCount 参数） */
  preWindTriggerCount: number
  /** 单次积蓄计算函数（引擎注入，避免模块反向 import 引擎形成循环依赖） */
  calcPerHitBuildUp(baseBuildUp: number, panel: PanelValues, elementRes: number, element: string): number
  /** 跨阶段状态存储：模块写入，引擎在读 velinaCorrosionSource 等时消费 */
  store: Record<string, unknown>
}
