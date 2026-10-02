import type { DeepReadonly } from 'vue'
import type { CharacterConfig } from '@/stores/config'
import type { Agent, AgentSkills, PanelValues, SkillDamageTarget, SkillMove } from '@/types/catalog'
import type {
  AnomalyEventRecord,
  AnomalyEventExecution,
  AnomalyPoolResult,
  BonusEnergyEntry,
  CharacterOperationConfig,
  CharacterResourceResult,
  IterationState,
  NumericCfgField,
  MechanicSetting,
  SkillExecution,
  SpecialResourceSection,
  StunAxis,
  CorrosionSource,
} from '@/types/resource'
import type { StunSkillExecution } from '@/core/stunPool'
import type { SourcePanelsByOwner } from '@/core/buff'
import type { StackActionCost } from '@/core/stunAxisStack'
import type { SubstatTemplate } from '@/core/substatOptimizer'
import type { AnomalySkillExecution, CoweringConfig } from '@/core/anomalyPool'
import type { CalcRoundThreads } from '@/composables/resourceCalc/roundThreads'
// 纯类型：运行时被擦除，不构成 mechanics → composables 值边（判据 19 豁免 import type，见设计稿
// `docs/mcp-cc18-extra-direct-rows.md` §2-1）。
import type { DirectRowInput } from '@/composables/resourceCalc/damagePoolDirect'
import type { DirectRowAxisSplitInput, DirectRowAxisSplit, DirectRowBonusInput, DirectRowBonus, ExtraDirectRowsInput, ExtraAnomalyRowGroup, ExtraAnomalyRowsInput } from './typesRows'
import type { CrossAgentSupplySpec, AgentStunOverrideInput, AgentStunOverride, AgentAxisOverlayInput, AgentAxisOverlays, AgentAnomalyTransformInput, AnomalyHookSelf, AgentNextRoundFeedbackInput, InteractionTopUp, InteractionTopUpInput, InteractionTopUpGate, ExtraNecessaryAction, AgentAnomalyEventRecordsInput, AxisEditorBlockMark, CharacterCountInputDecl } from './typesHooks'

/** 队伍中某个槽位的最小上下文快照 */
export interface MechanicTeamMember {
  slot: number
  agentId: string
  agent: Agent | null
  cinemaLevel: number
  potentialLevel: number
  wEngineId: string
  wEngineModLevel: number
}

/** 钩子收到的队伍快照：只读（队伍是全部钩子共享的派生输入，不是任何钩子的输出通道） */
export type ReadonlyTeam = ReadonlyArray<Readonly<MechanicTeamMember>>

/** `teammateBuffGate` 入参（r410 CC-384）：本人由派发器给出，模块不在 team 里自找。 */
export interface TeammateBuffGateInput {
  buffId: string
  team: ReadonlyTeam
  /** 本人那一槽（组 id = 本人 agentId 且 agent 可查）；不在队 ⇒ undefined */
  self: Readonly<MechanicTeamMember> | undefined
}

export interface AgentPanelInput {
  slot: number
  agent: Agent
  cinemaLevel: number
  potentialLevel: number
  team: ReadonlyTeam
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
  /**
   * Boss **基础失衡易伤倍率**（= `configStore.enemy.stunVuln`，默认 1.5）。
   *
   * 存在的理由（2026-09-17 round 18 / R15-d）：叶瞬光「帷幕易伤」口径 = `min(boss基础易伤 +
   * 队友给的全部失衡易伤加成, 影画封顶 2.1/3.0)`（`veilStunMultiplier`，口径全文见
   * `yeshuguang.ts` 的 `@fact`）。该算式的**唯一外部输入**就是 boss 基础易伤——它住在
   * `configStore.enemy` 上，而 `applyPanel` 早于 cfg 构建、拿不到 configStore。
   * 于是这条角色口径此前写死在伤害池（`damagePool.ts` 的 `row.agentId === '1431'` 分支）。
   *
   * ⚠ 它是**静态敌人配置**、不是相位量：每次面板重算都取当时值（与 `damagePool` 原先
   * 逐行读 `configStore.enemy.stunVuln` 同一份、同一时刻）⇒ 无相位门控、不许做 `?? 0` 兜底
   * （缺字段 = 派发器漏传，应响亮失败而不是静默按 0 算）。
   *
   * ⚠ 与 `AgentAxisOverlayInput` 的教训同款：**不要**改从 `cfg.panel` 读——`cfg.panel` 与
   * `damagePanels` 是两次 `computePanel` 的不同对象实例（`buildCharConfig` 各算一份）。
   */
  enemyStunVuln: number
}

/**
 * 「队伍级面板效果」钩子入参 —— 来源角色（**本模块**）向**目标槽位**的面板贡献加成。
 *
 * ## 为什么需要它（2026-09-17 round 20 R20-h3，规则 6 收尾）
 *
 * `applyPanel` 由 `computePanelPhases(slot, …)` **逐槽位**派发，且只传该槽自己的 `panel`
 * ⇒ 模块**无法**给别人加面板。于是历史上出现两种绕法，都住在编排层：
 * ① `if (agent.id === '1161')` 之类**按目标角色 id** 硬编码块（棘轮计数的那类）；
 * ② 更隐蔽的：在 `computePanelPhases` 里**无条件**给「某个固定 owner 的源面板」写值。
 *
 * 本契约把①收进模块：**来源角色声明「我在队时，给满足条件的目标槽位加什么」**。
 * 编排层只负责「对每个槽位问一遍全队模块」，不再认人（规则 6）。
 *
 * ## 与 `applyPanel` 的分工（不要混用）
 *
 * | | `applyPanel` | 本钩子 |
 * |---|---|---|
 * | 何时 | 目标槽**自己**的面板算完后 | 目标槽面板算完后，**由别的角色**追加 |
 * | 入参 `panel` | 目标槽自己的（可写） | 目标槽自己的（可写）|
 * | 入参 `team`/`slot` | `slot`=自己 | `slot`=**来源**槽，`targetSlot`=目标槽 |
 *
 * ⚠ **同一模块两个钩子都会跑**：`applyPanel` 负责「改自己的面板」，本钩子负责「改别人的」。
 * 若两者都写同一字段、且语义重复，就是**双计**（迁移时最易犯的错）——判断标准：
 * 该加成**是否随目标槽位不同而不同**。是 ⇒ 只能在本钩子里写；否 ⇒ 只能在自己 `applyPanel` 里写。
 *
 * ## 契约纪律
 *
 * - **顺序**：编排层按**槽位序**遍历来源角色（确定性）。故**多个来源写同一字段时结果与顺序有关**⇒
 *   本钩子只允许做**可交换的加法**（`+=`）。若某效果对顺序敏感（乘法、取整、封顶），
 *   **不要用本钩子** —— 那属于目标槽自己的口径，应让目标槽的 `applyPanel` 统一处理。
 * - **目标槽的 `panel` 已含队友 buff 与自己的 `applyPanel` 结果**：本钩子是最后一层
 *   （先自己的、再别人的）⇒ 需要读「已算好的基数」时读它是对的。
 * - **`targetSlot` 是槽位号不是下标**：`team` 是按位置压缩的数组（判据 17）⇒ 要用
 *   `input.team.find(m => m.slot === input.targetSlot)` 取目标成员，**禁** `team[targetSlot]`。
 * - 目标槽为空槽时**不会被派发**（编排层跳过空槽）；`targetAgent` 为 `null` 的成员不会出现。
 */
export interface AgentTeamPanelEffectInput {
  /** **来源**角色所在槽位（= 本模块自己那份 cfg 的槽位） */
  slot: number
  /** 来源角色 */
  agent: Agent
  /** 来源角色的命座等级 */
  cinemaLevel: number
  /** 全队成员（按位置压缩：用 `.find(m => m.slot === …)`，禁下标） */
  team: ReadonlyTeam
  /** 本次要写入的**目标**槽位号 */
  targetSlot: number
  /** 目标槽位的角色（`Agent`，供 `specialty` 等静态属性分支） */
  targetAgent: Agent
  /** 目标槽位的面板（**可写**；已含队友 buff 与该槽自己 `applyPanel` 的结果） */
  panel: PanelValues
  /** 已解析的机制滑块值（同 `AgentPanelInput.settings`） */
  settings: Readonly<Record<string, number>>
}

export interface AgentCharConfigInput {
  slot: number
  agent: Agent
  skills: AgentSkills
  cinemaLevel: number
  potentialLevel: number
  wEngineId: string
  wEngineModLevel: number
  team: ReadonlyTeam
  /**
   * 本槽局内面板（**只读**，2026-09-24）：它会成为 `cfg.panel`，但只供资源侧读取，**不进伤害面板**
   * （伤害走 `damagePanels` ← `applyPanel`）。曾有 3 个模块在此写 panel：两处与 `applyPanel` 重复、
   * 一处（诺姆 C1 减抗）是永不生效的死写。面板字段一律写在 `applyPanel`；本钩子唯一出口 = `cfg`。
   */
  panel: DeepReadonly<PanelValues>
  /**
   * 本槽局外面板（只读，CC-123）：供「初始 X」类转化的**展示值**读取，与 applyPanel 的 `outOfCombatPanel` 同源。
   * 可选：少数模块以局部参数转调基类 buildCharConfig，不带本字段。
   */
  outOfCombatPanel?: DeepReadonly<PanelValues>
  cfg: CharacterOperationConfig
  getRowValue: (move: SkillMove | null | undefined, rowId: string) => number
  /**
   * 本槽队伍配置（只读，CC-35b 2026-09-27）：模块从这里取**本角色专属**的用户输入（交互栏次数等），
   * 而不是让 `helpers.ts#buildCharConfig` 的 cfg 字面量替每个槽拷一遍。可选：部分测试 / 模块内部转调
   * （如仪玄转调 specBase）不传。通用输入（弹刀 / 闪反等）仍由字面量写。
   */
  char?: Readonly<CharacterConfig>
}

export interface AgentResourceInput {
  cfg: CharacterOperationConfig
  state: Readonly<IterationState>
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
 * 本轮生效的**失衡轴上下文**（只读快照；`applyTeamConfig` 的 converge 相位之外为 `undefined`）。
 *
 * 存在的理由（2026-09-16 round 11，设计卡 §3 方案 A）：编排层 `convergence.ts` 里曾有一簇
 * 形状相同的 `merged.agentId === '…'` 分支，做的事都是「按轴内 moveId 白名单 × 窗口数数块数，
 * 写进本槽 cfg」。它们需要三样契约上没有的东西：轴模式布尔、生效轴本体、窗口时长；
 * 而 `characters`（cfg 数组）已经带着 `axisActionCounts` / `axisInSeconds` / `axisUltimateTotal`
 * ⇒ 本接口只是把**散落在数组元素上的轴态字段收成一份显式快照**，不新造通道。
 * 先例：猫又（1211）早就在读 `cfg.axisInSeconds` / `cfg.axisActionCounts`（`nekomata.ts`）。
 *
 * 语义边界（**只读**）：`axis` 由编排层打包传递，模块**只许读**；写它不报错但不会被任何东西看见
 * （与 `threads` 同款纪律——单一时序 owner 在编排层）。模块仍只写**自己那份 cfg**（规则 6）。
 *
 * ⚠ 相位：只有 `phase === 'converge'` 时存在。build 相位轴还没解析（`resolveAxes` 在
 * `runCalcRound` 内）；postRound 相位的语义是「为下一轮」，本轮轴已用过 ⇒ 一律 `undefined`
 * （不是空快照——空快照会让「漏传」与「本轮无轴」不可区分，见测试 `axisContext.test.ts`）。
 */
export interface AgentAxisContext {
  /** 轴模式是否生效（= `runCalcRound` 的 `axisActive`，含 `forceNoAxis` 退化判据：退化时为 false） */
  active: boolean
  /** 本轮生效轴本体（= `resolveAxes` 的返回值；与 `CalcRoundResult.resolvedAxes` 同源） */
  axes: readonly StunAxis[]
  /** 各轴分配的窗口数（= `allocateAxisWindows(axes, stunCount)`；长度与 `axes` 对齐） */
  windows: readonly number[]
  /** 单次失衡窗口时长（秒；= `computeWindowDuration()` = `enemy.stunTime + 4 + 全队 stunDurationBonusSeconds`） */
  windowSeconds: number
  /** 各槽位轴内捏块总次数（= `characters[i].axisActionCounts` 的同源快照，按 slot 键控） */
  actionCountsBySlot: Readonly<Record<number, Readonly<Record<string, number>>>>
  /** 各槽位轴内连携块总次数（= `runCalcRound` 的 `axisChainTotal`；供「队友连携」类读） */
  chainTotalBySlot: Readonly<Record<number, number>>
}

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
  /**
   * **本模块自己那份 cfg**（可写）。由派发器直接给（它正在遍历这个对象）。
   *
   * ⚠ 模块**不要**用 `characters[slot]` 反查自己——`characters` 是**按位置压缩**的数组
   * （`buildCharConfig` 跳过空槽），**槽位号 ≠ 下标**：前导/中间空槽时 `characters[slot]`
   * 会取到 `undefined` 或**别人那份 cfg**（2026-09-16 实测：队 `['', 1041, 1191]` 时
   * 艾莲（槽2）的 `characters[2]` 为 `undefined` ⇒ `applyEllenTeamConfig` 的 converge 分支
   * 把影画4 冻结数写进空气：冻结次数 4→0、回能 16→0，**静默失效、无测试变红**）。
   * 要**队友**那份 cfg 时也别按下标取，用 `characters.find(c => c.slot === …)`。
   *
   * 为什么是「给对象」而不是「给下标」：派发器（`applyTeamMechanics`）本来就是
   * `for (const cfg of characters)`，它手上就是那个对象；给下标等于让每个模块各自重做一次
   * 有损反查。与 `AgentNextRoundFeedbackInput.cfg`（2026-09-16 round 8）同款契约。
   */
  cfg: CharacterOperationConfig
  agent: Agent | null
  cinemaLevel: number
  potentialLevel: number
  /**
   * 全队 cfg（**可写**：写任意槽位的字段正是队伍级联动的目的）。
   * ⚠ **按位置压缩**（空槽被跳过）⇒ 只许用 `.find(c => c.slot === …)`/`.map`/`.some` 等
   * 身份判据访问，**禁止** `characters[槽位号]` 下标索引（槽位号 ≠ 下标）。
   */
  characters: CharacterOperationConfig[]
  team: ReadonlyTeam
  /** 已解析的机制滑块值（与 AgentPanelInput.settings 同源） */
  settings: Readonly<Record<string, number>>
  /** 各槽位的「异常积储主元素」（该角色倍率表 anomaly_buildup 之和最大的 move.damageElement；
   *  派发器预计算，供跨角色转积蓄类机制定位目标元素——agent.damageElement 可能与招式元素不一致，
   *  如星见雅 agent=ice 而招式=frostfire） */
  anomalyBuildupElementBySlot?: Record<number, string | undefined>
  phase: AgentTeamPhase
  /** 战斗时间（秒） */
  combatTime: number
  /** 各槽位强特次数（build 阶段全 0；converge/postRound 为对应轮次的收敛值） */
  exCounts: number[]
  /** 各槽位终结技次数（build/converge 阶段全 0；postRound 为上一轮收敛值，与 exCounts 同序） */
  ultimateCounts?: number[]
  /**
   * 失衡次数（build 阶段 0）。**CC-154（第 177 轮）起 = 计数通道值**（converge / postRound 均由派发器递
   * `countStun`：off 下 ≡ 外层计划值，physical 下 = 上一轮池物理次数，round 等下为投影值）。
   * 模块把它当次数乘、取整成事件次数、或「窗数 × 窗长」算覆盖都直接用本字段。外层计划实数只留在编排层
   * （时间账 / 外层迭代），不下发给模块。审计与依据见 docs/mcp-stun-dual-source.md §18。
   */
  stunCount: number

  /**
   * **计数投影版**失衡次数（= `projectStunPlanForCounts(stunCount, stunPlanProjection)`，只读）。
   *
   * ⚠ 与 `stunCount` **在「难度阶梯 G4 投影打开」时不等价**：`stunCount` 是外层不动点的
   * **实数**计划值（时间账/窗口分配/覆盖率/迭代继续用它，那里实数是对的），而本字段是
   * **计数通道**用的整数投影（`off`/`floor`/`round`/`ceil`，见 `core/stunPlanProjection.ts`）
   * ——凡把它**当次数乘**的地方（连携/喧响/能量）必须用本字段，否则 G4（`round`）打开时
   * 会静默按未投影值算（终局出现「半次连携」正是 C7 要修的东西）。
   *
   * **只有 `phase === 'converge'` 时有值**（与 `axis`/`interactions` 同款相位语义）⇒ 模块若需要它，
   * 必须先 `if (phase !== 'converge' || countStun === undefined) return` **双判据门控**
   * （只判相位不判字段会让「派发器漏传」退化成静默错值）。
   *
   * ⚠ 派发器**不做 `?? 0` 兜底**（缺了就是缺了）：`0` 是一个合法的失衡次数，
   * 用它冒充断路会让「接口没接上」与「这局真的 0 次失衡」不可分辨。
   *
   * 消费先例：莱卡恩 1141 的 `lycaonC2Energy` 非轴臂（round 20 C-γ，原为 `convergence.ts`
   * 的 `agentId === '1141'` 分支）。为什么递算好的值而不是递 `stunPlanProjection` 让模块自算：
   * 投影方式是**全局 cfg 字段**、不是注册 `MechanicSetting`（`grep -rn stunPlanProjection
   * src/mechanics/ src/specs/` = 0 命中），且它会让「只由难度阶梯内部驱动的实验开关」变成
   * 资源利用率页的用户可见滑块（产品级口径，见 R15 分诊 §1.4 路 (b)）——故只递**结果**。
   */
  countStun?: number

  /** 全队普通能量消耗（莱特影画4 用；build 阶段 0） */
  teamEnergyConsumed: number


  /**
   * 上一轮收敛线程（`CalcRoundThreads`）的**只读快照** —— 跨轮反馈的通用输入通道。
   *
   * 为什么递整份快照而不是逐字段铺开（2026-09-15 arch 棘轮第 2 批）：这些量此前由编排层在
   * `convergence.ts` 的 `characters.map` 里**逐 agentId 分支**写进 cfg（9 个
   * `if (merged.agentId === …)`）。逐字段铺开会让契约随每个新反馈线性增长（本批一次要加 9 个），
   * 而 `threads` 本身**已经是**这份集合的单一事实源（`resourceCalc/roundThreads.ts`，头注释写明
   * 它就是为了终结「每加一个反馈要在三处同步加一行」而结构体化的）。
   *
   * 语义与 `teamEnergyConsumed` 同款：**build 阶段是初值**（次数还没产出），
   * converge 阶段带上一轮的收敛值进来 —— 这是「异常池在 `buildExecutions` **之后**才算」这个顺序逼出来的。
   * 模块自己决定读哪个字段、怎么写进 cfg（规则 6：编排层不写角色规则）。
   *
   * ⚠ **只许读**：线程的写回由编排层在 postRound 统一线程化（单一 owner），模块写它会破坏收敛性。
   */
  threads?: Readonly<CalcRoundThreads>

  /**
   * 本轮生效的失衡轴上下文（只读快照）。
   *
   * **只有 `phase === 'converge'` 时有值**（build 相位轴还没解析、postRound 相位语义是「为下一轮」）
   * ⇒ 模块若需要它，必须先 `if (phase !== 'converge' || !axis) return` 双判据门控
   * （只判相位不判字段会让「派发器漏传」退化成静默错值）。形状见 `AgentAxisContext`。
   */
  axis?: Readonly<AgentAxisContext>

  /**
   * **未缩放**的全队交互次数快照（只读）。
   *
   * **只有 `phase === 'converge'` 时有值**（与 `axis` 同款相位语义：build 相位交互次数还没意义、
   * postRound 相位语义是「为下一轮」）⇒ 模块若需要它，必须先
   * `if (phase !== 'converge' || !interactions) return` **双判据门控**
   * （只判相位不判字段会让「派发器漏传」退化成静默零值——那正是要修的形态）。
   *
   * ⚠ 消费方必须**逐位保留**自己原来的过滤口径：两个已知消费点过滤条件**不同**
   * （`team` 是**定长 3 槽**、空槽 `agentId === ''`，见 `buildMechanicTeamMembers`）：
   *   · 仪玄 1371 `yixuanExtremeAssistCap`：`configStore.team.reduce((sum,c,ci) => ci !== cfg.slot ? …)`
   *     —— **不过滤空槽**（空槽残留计数也算，但空槽计数实测恒 0）；
   *   · 莱卡恩 1141 `lycaonBackstageDodgeCount`：`ci !== cfg.slot && c?.agentId ? …`
   *     —— **过滤空槽**。
   * 故本契约把 `agentId` 一并递过去，让各模块写自己的那一条（不要顺手统一）。
   *
   * 形状与 `threads`/`axis` 同款：递整份快照、模块自取（不逐字段铺开）。
   */
  interactions?: Readonly<AgentInteractionContext>

  /**
   * **配装页「保底目标」三开关**的只读快照（round 21 夜D 新增）。
   *
   * 三个值 = `configStore.getMechanicSetting('guarantee.<k>', 0) !== 0`（`convergence.ts` 原文口径），
   * 键为 `stun` / `fury` / `ultimate`。
   *
   * **只有 `phase === 'converge'` 时有值**（与 `axis`/`interactions`/`countStun` 同款相位语义）
   * ⇒ 模块若需要它，必须先 `if (phase !== 'converge' || !guarantee) return` **双判据门控**
   * （只判相位不判字段会让「派发器漏传」退化成静默 false = 静默关掉保底，那正是要修的形态）。
   *
   * ⚠ **缺省即缺省，派发器不做 `?? {…}` 兜底**（与 `axis`/`interactions` 同款纪律）：
   * 伪造一份全 false 的快照会让「契约没接上」与「用户三个开关都没勾」不可分辨——
   * 前者是断路缺陷、后者是合法业务态，混淆二者正是本契约要消灭的形态。
   *
   * **为什么是快照而不是注册 `MechanicSetting`**（本字段存在的全部理由，别重新论证）：
   * `resolveMechanicSettings()` 只遍历 `getRegisteredMechanicSettings()`，而 `guarantee.*`
   * **从未注册**（实测 `getRegisteredMechanicSettings()` 的 id 集合不含它）⇒ 它不在
   * `AgentTeamConfigInput.settings` 里、模块侧读不到。**补注册是错的**：`guarantee.*` 虽由
   * 配装页开关驱动（`TeamConfigPage.vue#setGuarantee`），但它同时被难度阶梯（`difficultyLadder.ts`
   * 的 `GUARANTEE_KEYS`）与归档部署（`runArchiveDeploy.ts`）**程序化改写**——那是内部实验旋钮，
   * 注册进注册表会让它变成资源利用率页面的用户可见滑块（产品级口径，用户未裁决）。
   * ⇒ 只递**当时算好的布尔结果**，不把「怎么算 / 谁在改」暴露给模块（与 `countStun` 同款论证）。
   *
   * 消费先例：般岳 1471 的 `autoTopUp` 系列字段（原为 `convergence.ts` 的
   * `if (merged.agentId === '1471')` 块，round 21 夜D 迁入 `banyue.ts#applyTeamConfig`）。
   */
  guarantee?: Readonly<{ stun: boolean; fury: boolean; ultimate: boolean }>

  /**
   * 本局生效 Boss 预设里**参与弹刀反推**的三项只读快照（round 21 夜D 新增；与 `guarantee` 同族）。
   *
   * 三个值 = `configStore.appliedBoss?.<k> ?? 0`（`convergence.ts` 原文口径）。语义与依据见
   * `core/parrySplit.ts` 头注释与 `convergence.ts` 的「Boss 预设弹刀反推」注释块；
   * `parrySplit` 的**本轮拆分结果**不在这里（那是 `threads.parrySplit`，跨轮量），
   * 本字段只是**输入侧**的 Boss 声明值。
   *
   * 同样的相位语义（**只有 converge 有值**）、同样的**不兜底**纪律（缺省即缺省）。
   *
   * ⚠ 为什么递这三项而不是 `appliedBoss` 整份：Boss 预设对象是 store 里的**可写**引用，
   * 递整份等于给模块一个能改用户 Boss 配置的手柄；而本契约的用途只是「读三个数」
   * （与 `interactions` 递扁平快照而非 store 引用同款最小暴露）。
   */
  boss?: Readonly<{ parryTotal: number; parryNoFollowUpTotal: number; parryDecibelOnlyTotal: number }>

  /**
   * 倍率表访问（`catalogStore.getAgentSkills` 的直通）。
   *
   * 为什么本钩子也需要它（round 21 夜D）：雨果 1291 的轴内「窗口终结」时长反推要读
   * 轴动作的 `actionTime`——`act.duration` 只覆盖仪玄轴内凝云术一类特例，其余动作的时长
   * 只能查倍率表（合成行 `1291_ex_verdict_final` 无条目 ⇒ 走模块常量兜底）。
   *
   * 与 `AgentAxisOverlayInput.getAgentSkills` / `AgentNextRoundFeedbackInput.getAgentSkills`
   * **同款契约同款理由**（那两处已有先例，本处只是把同一能力补给第三个需要它的钩子）；
   * 类型按那两处的并集放宽到「能查 move」的最小结构，避免钩子被迫依赖完整 `AgentSkills`。
   */
  getAgentSkills?: (agentId: string) => { categories: { id?: string; moves: { id: string; actionTime?: number }[] }[] } | undefined
}

/** 上一轮收敛线程的快照类型（结构定义在 `composables/resourceCalc/roundThreads.ts`） */
export type { CalcRoundThreads }

/**
 * 模块「下一轮反馈」键值（CC-31，2026-09-27）：各模块 `nextRoundFeedback` 的返回值，编排层**整份**
 * 存进 `CalcRoundThreads.moduleFeedback`（不逐键拆字段），下一轮各模块从 `threads.moduleFeedback.<键>` 自取。
 * **缺键 = 0**（该角色不在队 / 守卫不成立；与迁移前具名字段初值 0 逐位等价）⇒ 读侧一律 `?? 0`。
 * 键名住在 mechanics 层（这里），编排层（composables/resourceCalc）不再列角色字段名（判据 22）。
 * 新增一条跨轮反馈 = 加一个可选键 + 产出模块 `nextRoundFeedback` 返回它 + 消费方读它。键声明放哪（CC-360）：
 * - **跨层 / 跨模块**（编排层或另一个模块也读写）⇒ 写在这里——本接口 = 「角色间 / 角色↔编排层」反馈耦合的完整清单；
 * - **本模块自产自读**（只有产出模块自己下一轮读回）⇒ 写在该模块末尾的 `declare module '@/mechanics/types'` 扩充块
 *   （r390 迁出 14 个：alice / anbyZero / ellen / grace / lucy / promia / remielle / vivian / yeshuguang / yixuan）。
 * 锁：`src/types/__tests__/privateCfgFields.test.ts`。
 */
export interface ModuleFeedback {
  /** 仪玄符法千重类终结次数（橘福福额外能力 +300 喧响；亦并入编排层 `teamUltimateForJufufu`） */
  teamUltimateExtra?: number
  /** 莱特后场：全队常态能量消耗（converge 相位经通用输入 `teamEnergyConsumed` 递给模块） */
  consumedTeamEnergy?: number
}

/**
 * 单个槽位的**未缩放**交互次数快照（= `configStore.team[slot]` 的 **store 原值**）。
 *
 * 字段全部**必填**（不是可选）：这份快照是「store 那一刻长什么样」的完整拷贝，
 * 缺字段会让消费端分不清「没有这个量」和「这个量是 0」。
 *
 * ⚠ 存的是 `agentId` 的**当时值**（空槽 = `''`，不清零）：清空槽位时 `setAgent` 只改
 * `agentId`、**不重置** `parryCount` 等计数（`stores/config.ts#setAgent` 的基线预填在
 * `if (agent)` 里面）⇒「按 agentId 过滤」与「不过滤」在**空槽残留计数**时结果不同。
 * 故本快照把 `agentId` 一并递过去，让各模块保留自己原来的过滤口径（见下方两条消费注）。
 */
export interface AgentInteractionSnapshot {
  /** 该槽位当时绑定的角色 id（空槽 = `''`） */
  agentId: string
  /** 弹刀次数（store 原值，**未经** `interactionScale` 缩放、**未经** `parrySplit` 反推改写） */
  parryCount: number
  /** 金身格挡/不动如山招架次数（同上：store 原值） */
  blockCount: number
  /** 闪避反击次数（同上：store 原值） */
  dodgeCounterCount: number
  /** 双反次数（同上：store 原值） */
  dualCounterCount: number
  /** 快速支援次数（同上：store 原值） */
  quickAssistCount: number
  /**
   * 每次失衡的连携次数（store 原值，`?? 0`；与 `ACTION_COUNT_BOUNDS` 同族，`0..3`）。
   *
   * 为什么也放进本快照（2026-09-17 round 20 C-γ，莱卡恩 1141 的 `lycaonC2Energy` 非轴臂）：
   * 原式读的正是 `configStore.team[ci].chainCountPerStun`，而 **`characters` 上那份被
   * `buildCharConfig` 写过 `?? (isSupport ? 0 : 1)` 兜底**（`helpers.ts`）——store 侧字段**缺失**
   * （`undefined`）时两份**不同值**（store 侧按 `?? 0` = 0、cfg 侧 = 1）⇒ 读 `characters` 是静默改语义。
   * ⚠ **实测边界**（本批探针实测，纠正 R18 分诊的「store=0 → cfg=1」说法）：`0 ?? 1 === 0`，
   * 故 store 显式 `0` 时两份**同值**，分裂只发生在缺失态（判据直接构造缺失态钉住）。
   * 与第 ①② 道改写（`interactionScale`/`parrySplit`）同族：**本通道的存在理由就是「必须读 store 原值」**。
   *
   * ⚠ 保留消费端原本的过滤口径：1141 那条带 `agentId` 存在判据（空槽残留计数被排除），
   * 与仪玄那条只看槽位号的不同——本快照递 `agentId` 正是为此，不要顺手统一。
   */
  chainCountPerStun: number
}

/**
 * 全队**未缩放**交互次数快照（按 slot 键控）。
 *
 * 存在的理由（2026-09-16 round 14 实测，别重新论证）：契约里 `characters` 那份 cfg 的交互次数
 * **已经被改过两道**——`convergence.ts` 的 `characters.map` 里
 *   ① `interactionScale`（非轴降配）：`Math.round(x × scale)`，实测 scale=0.125 时 store 10 → cfg 0；
 *   ② `parrySplit`（保底4失衡反推）：**改写**击破位/主C 的 `parryCount`（实测带叶释渊
 *      `parryTotal=13` 时 5/6 队 mergedΣ 变 13/9，而 storeΣ 恒 6）+ x 弹刀叠加。
 * 而两个既有实现在迁移前读的是 **`configStore.team` 原值**：
 *   · 仪玄 1371 的 `yixuanExtremeAssistCap`（极限支援换场落雷次数上限 = Σ**队友**弹刀）——
 *     迁移时若读 `characters` 会静默改语义（round 13 受控两臂实验：臂 A 用合并值 ⇒
 *     `yixuanSmoke` **9 failed**；臂 B 把 store 口径和递入 ⇒ **13 passed 全绿**）；
 *   · 莱卡恩 1141 的 `lycaonBackstageDodgeCount`（后台跟随闪反 = Σ**队友**闪反次数）。
 * ③ 第三道改写（2026-09-17 round 20 C-γ 补）：`chainCountPerStun` 在 `buildCharConfig` 被写过
 *    `?? (isSupport ? 0 : 1)` 兜底，而原式读 **store 原值** ⇒ 必须走本快照（见字段注释）。
 *    ⚠ **实测边界**（本批探针实测，纠正 R18 分诊的「store=0 → cfg=1」说法）：`0 ?? 1 === 0`，
 *    故分裂**只在 store 侧字段缺失（`undefined`）时**发生——那时 store 侧 `?? 0` 得 0、cfg 侧得 1。
 * ⇒ 本契约是**加法**（新增只读通道）：不读它的模块数值零变化。
 */
export interface AgentInteractionContext {
  /** 逐槽位的 store 原值快照（键 = 槽位号；含空槽，`agentId === ''`） */
  bySlot: Readonly<Record<number, Readonly<AgentInteractionSnapshot>>>
}

export interface AgentExSpecialTimeInput {
  cfg: CharacterOperationConfig
  exSpecialCount: number
  ultimateCount: number
  /**
   * 上一轮收敛状态（引擎 iterate 传入，外部直调可省略）：模块用它消除「读上一轮
   * buildExecutions 写入 cfg 的结构量」的滞后——星徽·比利链数/最高马力星光即按
   * state.basicAttackTime 当前轮直推（估时与物化共用同一求解器，同一份时间只花一次）。
   */
  state?: Readonly<IterationState>
}

export interface AgentExSpecialTimeEstimate {
  /** 强化特殊技占用的必做动作前台时间（秒） */
  necessaryTime: number
  /** 强化特殊技的合轴时间（秒） */
  comboAlignTime: number
  /**
   * comboAlignTime 是否已含在 necessaryTime 内（GROSS 约定，缺省 = true，如 11号：
   * necessary 按全额 actionTime 计，合轴部分是其中的重叠段）。
   * false = NET 约定（如照/卢西娅：合轴动作已从 necessaryTime 剔除、不占前台）——
   * 团队时间预算只抵扣含在 necessary 内的合轴（防双重记账）。
   */
  comboAlignIncludedInNecessary?: boolean
}

export interface AgentEventInput {
  cfg: CharacterOperationConfig
  state: Readonly<IterationState>
  events: AnomalyEventExecution[]
  totalTime: number
}

export interface AgentResourceResultInput {
  cfg: CharacterOperationConfig
  state: Readonly<IterationState>
  /** 其他队友前台时间合计（秒），供队友触发类机制使用 */
  teamFrontlineSeconds?: number
  /**
   * **物化钩子派发前**引擎已产出的执行行（= `buildExecutions` 钩子当时看到的同一批行）。
   *
   * 存在的理由（阶段1 第二刀 2026-09-09）：钩子里的派生量若在装配期（`buildResourceResult`）还要用，
   * 旧做法是写回 cfg 缓存——那让物化钩子对 cfg 有副作用，试探测量与装配在同一 state 下拿到不同行
   * （卢西娅 `luciaAdditionalAttackCap` 即此）。改成把行基准显式传进来，钩子两处各自用同一纯函数重算，
   * cfg 保持只读。注意基准是**钩子派发前**的行（不含钩子自己 push 的行），与旧写回时的口径逐位一致。
   */
  preModuleExecutions?: SkillExecution[]
  /**
   * **patchExecutions 派发前**的执行行（= `patchExecutions` 钩子当时看到的同一批行，CC-198）。
   * 比 preModuleExecutions 多出 buildExecutions 之后才物化的行：额外强特行（`src/data/exSpecialPlans.ts`，
   * rowBuild 在模块 buildExecutions 之后推入）、backstageAutoRows、闪反/弹刀/反制支援等。
   * 派生量在 patchExecutions 里产行、装配期又要展示的模块读这个（千夏凝视标记供给即此）。
   * 浅拷贝：数组新建、行对象与最终行共享——只读 moveId / count / 时长，不要读 patch 会改写的字段。
   */
  prePatchExecutions?: SkillExecution[]
}

export interface AgentSkillTransformInput {
  slot: number
  agent: Agent | null
  skills: AgentSkills | undefined
  charResult: DeepReadonly<CharacterResourceResult>
  panel: DeepReadonly<PanelValues> | null
  cinemaLevel: number
  potentialLevel: number
  team: ReadonlyTeam
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
  /** 缓存资源结果里的行（跨读者共享）⇒ 只读 */
  exec: DeepReadonly<SkillExecution>
  team: ReadonlyTeam
  cinemaLevel: number
  potentialLevel: number
}

export interface ReleaseModifierInput {
  /**
   * 本模块角色**自己那一槽**（r398 CC-372）：派发方按模块 `agentIds` 在队伍里定位后给出
   * （`composables/resourceCalc/damagePool.ts#releaseModifierSelf`；命座与面板阶段同源 = `team[slot].cinemaLevel`）。
   *
   * 为什么不再给全队 `panels`：模块要的从来是「我自己的命座 / 面板」，却拿不到「我是哪一槽」，
   * 于是 phoenix / promia / vivian 各自在 `applyPanel` 里往自己面板上夹带 `xxxCinemaLevel`，再用
   * `panels.find(p => p.xxxCinemaLevel !== undefined)` 把自己认回来——三份同构 hack，靠 `PanelValues`
   * 的 `[key: string]: number` 索引签名才成立。契约补上身份后，夹带字段全部删除。
   * `slot = -1` ⇒ 本模块不在队（派发只对在队模块发生，防御性给 0 命、无面板）。
   */
  self: { slot: number; cinemaLevel: number; panel: DeepReadonly<PanelValues> | undefined }
}

export interface AgentResourceSectionsInput {
  result: DeepReadonly<CharacterResourceResult>
  anomalyPoolResult?: AnomalyPoolResult | null
  /** 琉音好评转大收敛拆分（60=吃连携窗口 / 90=白送终结技，来自 promoteFixpoint 终值）；
   *  仅结果页注入——归档/难度曲线拿不到不动点终值，缺省时 60/90 拆分行不显示。纯展示载荷。 */
  liuyinHug?: { hug60: number; hug90: number } | null
  /** 全队 agentId→展示名，多角色归因行用（如卢西娅帷幕队友来源）；缺省回退显示 agentId */
  agentNames?: Readonly<Record<string, string>>
}

/**
 * 在队模块 + 其槽位（r399 CC-373）—— `mechanics/registry.ts#teamMechanicSlots` 产出；
 * 异常池（`AnomalyPoolInput.teamMechanics`）据此只对在队模块派发钩子并附 `self`。
 */
export interface TeamMechanic {
  module: AgentMechanicModule
  slot: number
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
  /**
   * **声明式伤害定向覆盖**（2026-09-24）：本角色某些 catalog 招式的 `skillDamageTarget` 不按
   * 类别推断（如零号·安比「连携/终结视为追加攻击」）。由 `enrichExecutionPlan` 在补倍率时统一应用
   * （赠行同样应用），是这类覆盖的**唯一**入口。
   *
   * 为什么不能在钩子里写：`enrichExecutionPlan` 会用推断值覆盖行上已有的定向键（`buildExecutions` /
   * `patchExecutions` 写的会被静默冲掉）；而 `transformSkillExecutions` 在 enrich 之后跑、拿到的是
   * **缓存的**资源结果——旧实现就在那里原地改行（输入现为 `DeepReadonly`，编译期即拒绝）。
   */
  skillDamageTargetOverrides?: Readonly<Record<string, SkillDamageTarget>>
  /**
   * **队伍级面板效果**：本模块角色在队时，向**其它槽位**的面板贡献可加成的修正。
   *
   * 与 `applyPanel` 的分工、顺序纪律、`targetSlot ≠ 下标` 陷阱全文见 `AgentTeamPanelEffectInput`。
   * 典型用途：莱特 C4「后场队友能量效率 +10%」、耀嘉音「咏叹华彩全队增伤」——
   * 迁走编排层 `computePanelPhases` 里那类 `if (agent.id === '…')` 跨槽硬编码块（规则 6）。
   */
  teamPanelEffects?(input: AgentTeamPanelEffectInput): void
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
  /**
   * 后台合轴自动填充声明（用户口径 2026-09-07：合轴可自动填充、不占前台不计难度，反推至保底4失衡）。
   * 声明式（编排层通用执行，无 agentId 分支）：编排层按 deficit=保底目标×bossStunValue−非合轴失衡
   * 反推次数，封顶 floor(可用后台时间/minPeriodSeconds)，写回 cfgField；手动字段 >0 时模块优先用手动。
   */
  backstageAutoFill?: {
    /** 合轴招式行 moveIds（编排层据此实测每对有效失衡） */
    moveIds: string[]
    /** 每对基础失衡（catalog 倍率和；首轮探测用，次轮起实测） */
    perPairBase: number
    /** 自动次数写回的 cfg 字段名（须为 cfg 上声明的数字字段） */
    cfgField: NumericCfgField
    /** 手动输入字段名（>0 优先于自动；须为 cfg 上声明的数字字段） */
    manualField: NumericCfgField
    /** 一对合轴的最短节奏（秒）——供给上限分母 */
    minPeriodSeconds: number
    /** 跟随招式与主招式的失衡值比（每对 = 主招式实测 × (1+ratio)；主招式须为后台独占行，防基础轮转行污染实测） */
    followUpDazeRatio?: number
  }
  /** 向招式执行计划追加专属动作 */
  buildExecutions?(input: AgentResourceInput): void
  /**
   * **物化相位写入**（阶段1 第二刀，2026-09-09）：模块产行后由**引擎**在物化调用点显式落相位状态
   * （如格莉丝「本轮平A池留给下一轮 estimate」、叶瞬光 cycle 缓存）。
   *
   * 为什么单列一个钩子：这类写入的语义是「记住本次物化用的 state」，属于**引擎调用点**的副作用，
   * 不是产行的一部分。写在 `buildExecutions` 里会让产行函数对 cfg 有副作用——`materializeRows`
   * 只能靠快照/恢复兜底，且「同一 (cfg, state) 在不同调用点得到不同行」。拆出来之后产行函数对
   * cfg 只读，引擎在每个物化调用点按同一 state 补写，数值逐位不变（golden 0 delta）。
   * 引擎只在**非试探隔离**的物化路径调用它（`materializeRows` 内部不调，因为那条路径本来就
   * 快照/恢复、写入会被丢弃）。
   */
  materializePhaseState?(input: AgentResourceInput): void
  /**
   * 招式执行计划完全构建后（通用+模块追加均就绪）的修正钩子：
   * 模块可对最终执行列表按 moveId/招式标签补专属字段（增伤/暴击/固定附加伤害等）。
   */
  patchExecutions?(input: AgentResourceInput): void
  /**
   * 招式级失衡**独立乘区**（CC-34c②，2026-09-27）：`resourceCalc/helpers.ts#extractSkillExecutions` 为本槽每个
   * 非普攻招式行求 `baseDaze = 表值 × 技能等级系数 × 本返回值`（缺省 1）。`panel` 为本槽局内面板，可能为 null
   * （部分测试路径不传面板），实现方须自行兜底。与行字段 `stunBuildUpBonus`（和面板失衡值提升**加算**）不是同一乘区。
   * 为什么是纯函数能力而不是 `patchExecutions` 写行字段：派发点就在消费处，面板为 null / 行晚于 patch 加入等
   * 边界与原内联分支逐字一致。首个实现：蕾米埃尔 Radiant Turn（1581010）`1 + 档位%`。
   */
  skillDazeMultiplier?(input: { moveId: string; panel: DeepReadonly<PanelValues> | null }): number
  /**
   * 后台自动释放行（CC-26b）：`rowBuild.ts#buildExecutions` 在闪避反击行**之前**的固定位置派发，
   * 返回的行由构建器 push 进 executions。`input.executions` 是「构建到这一步为止」的只读快照语义
   * （模块用它数前台动作，**不要**改它）。原为 core 内联的蕾米埃尔「光辉回转」后台行。
   * ⚠ 与声明式字段 `backstageAutoFill`（后台自动补位）名字相近但语义无关。
   */
  backstageAutoRows?(input: AgentResourceInput): SkillExecution[]
  /**
   * 异常事件记录（CC-28，展示层）：`useResourceCalc.ts#moduleAnomalyEventRecords` 按槽位 0→2 派发并拼接，
   * 进结果页异常事件表（`ResultPage.vue`）。原为编排层按身份 `['1581']` 的蕾米虚耀池分支。
   */
  anomalyEventRecords?(input: AgentAnomalyEventRecordsInput): AnomalyEventRecord[]
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
  /**
   * 倍率表提取阶段：向 `stunExecs` / `anomalyExecs`（本次调用新建的数组）追加或修改专属失衡/积蓄贡献。
   *
   * **纯度契约**：只许改 `stunExecs` / `anomalyExecs`。`panel` 与 `charResult` 是跨轮/跨重算
   * **共享的缓存对象**（类型 `DeepReadonly`；测试环境下运行期深冻结，写入即抛错）。
   * 面板加成 → `applyPanel`；行字段 → `patchExecutions`；伤害定向 → `skillDamageTargetOverrides`。
   * 背景：`docs/ENGINE_PIPELINE_GUIDE.md` 坑 20。
   */
  transformSkillExecutions?(input: AgentSkillTransformInput): void
  /** 直伤行元素/来源解析，返回 null 时走通用规则 */
  resolveExecutionDamage?(input: AgentDamageResolutionInput): { element: string; source?: string; note?: string } | null
  /**
   * **行级失衡易伤自报**（规则 6 落点，2026-09-16 round 17 / R15-c）。
   *
   * 返回 `{ stunOverride, note }` = 本模块认领本行的易伤口径；
   * 返回 `null`/缺省 = **不认领**（伤害池回落全局失衡覆盖率）。
   * ⚠ `stunOverride: 0` 是**认领且明确不吃**，与 `null` 语义不同（见 `AgentStunOverride`）。
   *
   * 为什么单列声明而不是让编排层按 agentId 分支算：这条口径（叶瞬光明心境关键招满易伤 /
   * 雨果只有连携与决算吃易伤）是**角色自己的**战斗语义，且两处的 `isAxis` 门控**刻意不对称**
   * （详见 `AgentStunOverrideInput` 头注释）——写死在伤害池里每加一个角色都要再改编排层，
   * 正是规则 6 要消灭的形状。
   */
  stunOverrideForMove?(input: AgentStunOverrideInput): AgentStunOverride | null
  /** 异常积储主元素（模块把招式积蓄归并为独立元素时声明，如星见雅 frostfire）；
   *  供跨角色转积蓄机制（柚叶十人十色）定位目标——缺省时派发器按倍率表 anomaly_buildup
   *  之和最大的 move.damageElement 兜底；agent.damageElement 可能与二者不一致（雅 agent=ice）。 */
  anomalyBuildupElement?: string
  /** 异放/乱流释放类伤害的减抗/减防修正（异放限定，不作用于普通直伤） */
  releaseModifier?(input: ReleaseModifierInput): { enemyResReduction: number; enemyDefReduction?: number; note: string }
  /**
   * `releaseModifier` 的作用域（CC-121，2026-09-27）：
   * - `'self'`（缺省）：只作用于**本角色**的异放行（派发键 = 异放行的 agentId）；
   * - `'team'`：作用于**全队任一角色**的异放行（原文「全队角色……造成[异放]时无视 X% 防御」，如普罗米娅有罪推定 / 影画1）。
   * 多个来源的修正相加（与面板 enemyDefReduction 同为加算）。编排层按在场模块的声明汇总，不按 agentId 分支。
   */
  releaseModifierScope?: 'self' | 'team'
  /** 生成资源池卡片上的通用专属资源展示段 */
  resourceSections?(input: AgentResourceSectionsInput): SpecialResourceSection[]
  /** 声明可在资源利用率页调整的机制参数 */
  settings?: MechanicSetting[]
  /**
   * 伴随事件：父动作 moveId → 子事件 moveId 列表。
   * 失衡轴内子事件易伤跟随父动作的「轴内占比」（0-1 分数，栈执行轴内单位 / 全局总单位，
   * 与直伤 axisSplitFor 同源）——全在窗 = 1、全在窗外 = 0、跨边界/部分在窗 = 期望占比。
   */
  attachedEvents?: Record<string, string[]>
  /** 连段动作：comboId → 复合招式（特殊技+重碾打包成一个栈单位，能量按打包口径一次扣除） */
  // CC-69：energyCostAtCinema = 影画 ≥ minCinema 时按 energyCost 覆盖打包能耗（roundInputs 非轴执行计划读；原写死伊德海莉单次碾 1 命 50）
  combos?: Record<string, { label: string; energyCost: number; energyCostAtCinema?: { minCinema: number; energyCost: number }; moves: { moveId: string; count: number }[] }>
  /**
   * 轴编辑器逐块标注（CC-48 2026-09-27；**展示层专用，不参与计算**）：返回 `${axisIndex}:${actionIndex}` → 标注。
   * 展示层经 `composables/agentMechanicView.ts#agentAxisBlockMarks` 以「本角色所在槽位」调用（判据 7：页面不值导入角色模块）。
   * 现实现：般岳（明王窗口，computeBanyueMingwangBlocks）、仪玄（凝神窗口，computeYixuanNingshenBlocks）。
   */
  axisEditorBlockMarks?(input: { axes: ReadonlyArray<{ readonly actions: ReadonlyArray<{ readonly slot: number; readonly moveId: string; readonly count: number; readonly startTime?: number }> }>; slot: number; cinemaLevel: number }): Map<string, AxisEditorBlockMark>
  /** 轴编辑器招式元数据（CC-48；展示层专用）：moveId → { tag 名称前缀, cost 单次耗能 }。现唯一实现：般岳 `BANYUE_AXIS_MOVE_META` */
  axisMoveMeta?: Readonly<Record<string, { tag: string; cost: number }>>
  /** 轴编辑器候选池隐藏的招式（CC-57；展示层专用）。现唯一：伊德海莉 1051012 裸极寒重碾（用连段表达能量消耗更准，避免误导闪能计算） */
  axisHiddenMoves?: readonly string[]
  /** 轴编辑器候选块名后缀（CC-57；展示层专用）：moveId → 后缀。现唯一：仪玄 1371022/1371026「·+30%失衡」（额外能力：命中失衡敌人 +30%） */
  axisMoveSuffix?: Readonly<Record<string, string>>
  /**
   * 轴编辑器「怒相连段块」comboId 声明（CC-59；展示层专用）：primary = 主连段，didong = 与主连段共享配额、优先占用的变体连段。
   * 两者都是本模块 `combos` 的 key。StunAxisPage 用它画明王窗口条、按山威配额（怒相次数 × 2）算可放次数。现唯一：般岳。
   */
  axisRageCombos?: { readonly primary: string; readonly didong: string }
  /**
   * 轴编辑器「角色专属块」（CC-61；展示层专用，不参与计算）：在候选池里追加的伪块（moveId 由编排层 / core 各自识别）。
   * `actionTimeOf(moveId)` 由展示层注入（查本槽技能表；mechanics 不能按值导入 stores）。quota = 候选块「可放」提示上限。
   * 现实现：诺姆（norma-hat-chain「诺姆转连携」标记块，0 时长）、希格莉德（sigrid-pozhen「破阵连段」，三段行动时间和，C6 ×0.75）。
   */
  axisExtraBlocks?(input: { cinemaLevel: number; actionTimeOf: (moveId: string) => number }): ReadonlyArray<{ readonly moveId: string; readonly label: string; readonly actionTime: number; readonly quota: number }>
  /**
   * 轴编辑器「专属窗口 lane」种类（CC-62；展示层专用，不参与计算）：本角色拥有哪一条窗口可视化 lane。
   * 页面按种类找槽位（`teamAxisWindowLaneSlot`），banner 文案 / 窗口长度 / lane 位置仍由页面按种类渲染（属 UI）。
   * 现实现：般岳 'mingwang'（明王 8s 窗，6 命满覆盖）、仪玄 'ningshen'（凝神 15s 窗）。
   */
  axisWindowLane?: 'mingwang' | 'ningshen'
  /**
   * CC-63（2026-09-27）：兜底平A填充秒数 → 本角色的具体招式次数（**计算路径**，非展示层）。
   * 编排层 `roundInputs.ts#expandExecutedToCounts` 按填充槽的 agentId 派发；未声明 ⇒ 通用 `basic` 秒数。
   * `actionTimeOf(moveId)` 由编排层注入（查本槽技能表）；**返回 undefined = 技能表查不到**（各角色兜底口径不同，须区分）。
   * 现实现：伊德海莉（蓄力循环 下砸 1051007 + 平A 1051003）、「11号」（火力镇压 #4 1041008，查不到按 1.828s）。
   */
  expandBasicFill?(input: { fillSec: number; actionTimeOf: (moveId: string) => number | undefined }): ReadonlyArray<{ readonly moveId: string; readonly count: number }>
  /**
   * CC-64（2026-09-27）：新上阵时的默认「平A时间分配权重」（configStore#defaultBasicAttackTimeWeight 读）。
   * 未声明 ⇒ 走通用口径（支援/防护 0，其余 1）。store 按 `agent.id` 与 `agent.teammateBuffId` 各查一次模块。
   * 现实现：蕾米埃尔 0、薇薇安 0（后台/合轴快切，基本不平A）。
   */
  defaultBasicAttackTimeWeight?: number
  /**
   * CC-64b（2026-09-27）：**本角色 buff 组**里队友 buff 的附加启用条件。CC-207 起 store 默认门控与引擎面板阶段共读
   * （`mechanics/additionalAbilityGates.ts#teammateBuffGateBlocks`）：返回 false ⇒ 默认不勾，且用户强行勾上也不生效。
   * 只放**正确性约束**（互斥档位、防双计）；纯默认值偏好不要用本钩子。
   * r403 CC-377：只对**拥有者**派发——组 id = 拥有者 agentId，引擎只把该组的 buff 交给 `getAgentMechanic(group.id)` 的本钩子，
   * 模块不必（也不能）认领别人组里的 buff；返回 undefined = 不表态。
   * r410 CC-384：`team` = 与其它钩子同一份 `ReadonlyTeam`（真实槽位）；`self` = 派发器给的本人那一槽（要求 agent 可查；
   * 不在队 ⇒ undefined，此时仍会被询问，按「不在队」口径作答）。原入参是压缩 `Agent[]` + `selfCinema`，模块只能在列表里
   * 按 id 自找、拿下标当槽位（蕾米埃尔），与同模块其它钩子走两套队伍表示。
   * 现实现：蕾米埃尔（额外能力 tier 1..3 三条攻击 buff、核心被动 refringe_3、prismatic_buildup）；
   * 波可娜（C6 禁用 pulchra_extra_trap_followup，防与 pulchra_cinema_6_trap_all 双计；CC-64c）。
   */
  teammateBuffGate?(input: TeammateBuffGateInput): boolean | undefined
  /**
   * CC-65：TeamConfigPage「角色专属计数输入框」声明（展示层；原页面按角色写死的 v-if 块）。
   * 按数组顺序渲染在「双反」之后；min/max 取 `ACTION_COUNT_BOUNDS[field]`；写入统一走 `configStore.setActionCount`。
   * 显示/清空口径见 `CharacterCountInputDecl.mode`（门面 `characterCountInputValue` / `characterCountInputClearValue`）。
   */
  characterCountInputs?: ReadonlyArray<CharacterCountInputDecl>
  /** CC-65b：按角色的交互次数默认值（主页「战斗动作次数」预填 + 手动队 setAgent 预填；原 stores/config.ts 写死表）。读取入口 `getInteractionDefaults`；无声明 = 全 0。 */
  interactionDefaults?: Readonly<{ parry: number; dodge: number; block: number; dual: number }>
  /** CC-65b：不吃通用交互基准（`interactionBaselineFor` 返回全 0；原 stores/config.ts 写死名单）。 */
  noGenericInteraction?: boolean
  /** CC-65b：TeamConfigPage 交互栏专属输入框（格挡 blockCount / 双反 dualCounterCount）是否显示及标签（展示层）。 */
  interactionInputs?: Readonly<{ block?: { label: string }; dualCounter?: { label: string } }>
  /** CC-65b：队里有本角色才显示「保底4嗔火」开关（展示层；引擎侧由模块自身消费 guarantee.fury）。 */
  ownsGuaranteeFury?: boolean
  /** CC-60：自动失衡轴「章」档位归属（预设 `chapter` 按本角色影画 0 命 → 0 章 / ≥1 命 → 1 章过滤；队中第一个声明者生效）。原 data/stunAxisPresets.ts 与 StunAxisPage 写死伊德海莉 id。 */
  axisPresetChapterOwner?: boolean
  /** CC-60：自动失衡轴同队多预设时，预设 team 含本角色者优先（StunAxisPage 横幅显示「有琉/无琉」）。原写死琉音 id。 */
  axisPresetPreferred?: boolean
  /** CC-79：StunAxisPage 横幅「有X/无X」里代表本角色的简称（如琉音 = '琉'）；缺省用模块 name */
  axisPresetPreferredShort?: string
  /**
   * CC-66：ResourceResultCard 腐蚀状态机展示（展示层；原组件写死维琳娜 id 与 moveId）。
   * - `poolReleaseEventMarker`：异常池 release 事件 id 含此串者补入本角色「异常事件执行」表（资源层拿不到的池后算事件）；
   * - `broadCycloneMoveId`：该 moveId 行的次数列附加 `anomalyPoolResult.corrosionSource.broadCycloneCount × 10`。
   */
  resultCardCorrosion?: Readonly<{ poolReleaseEventMarker: string; broadCycloneMoveId: string }>
  /**
   * CC-67：额外能力门控的角色专属修正（`panelPhases.ts#evalAdditionalAbilityBuffGates` 展平 buffId → active 之后、返回之前调用；
   * 只对在队角色调用，`slot` = 本角色槽位）。原在编排层按 id 写死：凯撒「有任意队友即满足」、菲欧妮 tier3「异常数≥3」。
   * 只允许改写**本角色在 `additionalGateBuffTable` 里的 buff id**（各模块 buff id 不相交 ⇒ 调用顺序无关）。
   */
  adjustAdditionalAbilityGates?(input: { team: ReadonlyTeam; slot: number; gates: Map<string, boolean> }): void
  /**
   * CC-130：队友 buff 的「按接收槽」**效果级**过滤（本角色 = buff 来源）。返回「接收槽 `recipientSlot` 不该吃到的
   * 本角色 buff 效果 id」（`TeammateBuff.effects[].id`）。用于原文只给**特定队友**的拐（席德「明攻」只给[正兵]、
   * 「围杀」只给席德与正兵）——teammate-buffs 的静态数据本身是全队生效。
   *
   * 契约（`panelPhases.ts#applyTeammateBuffRecipientFilters` 强制）：
   * - 只作用于 `ownerId`/`teammateId` = 本角色 id（或其 teammateBuffId 别名）的 buff；别人的效果 id 返回了也不删；
   * - 只作用于 `scope === 'inCombat'` 的 buff ⇒ 局外面板不受影响，`getOutOfCombatPanel` 探针因此可以安全重入；
   * - 探针内部（重入）不再调用本能力。
   * `getOutOfCombatPanel(slot)` = 该槽 `computePanelPhases(...).outOfCombat`（与 CC-129 build 阶段 `cfg.outOfCombatPanel` 同源）。
   */
  teammateBuffRecipientFilter?(input: {
    team: ReadonlyTeam
    /** 本角色（buff 来源）槽位 */
    slot: number
    /** 正在计算面板的接收槽位 */
    recipientSlot: number
    getOutOfCombatPanel: (slot: number) => Readonly<PanelValues> | null
  }): readonly string[]
  /**
   * CC-258：本角色引擎交互字段的**专属类型名**（键见 teamCompare.ts#INTERACTION_LABELS / INTERACTION_WEIGHTS）。
   * 同一 store 字段对不同角色是不同交互（般岳 blockCount = 金身格挡、星徽·比利 blockCount = 普通格挡）⇒
   * 难度轴读引擎次数时按槽位解析类型名（`liveInteractions#engineInteractionItems`）；
   * `dualCounterCount` 只有声明了类型名才进难度轴。
   * 值集合同时是队伍对比难度表要补 0 值条目的专属类型（`teamCompareInteractionTypes`，原 CC-68 `compareInteractionTypes` 并入）。
   */
  interactionFieldTypes?: Readonly<Partial<Record<'blockCount' | 'dualCounterCount', string>>>
  /**
   * 异放占比可调声明（CC-55 2026-09-27；**展示层专用，不参与计算**）：本角色的 dominant 异放事件按元素分配次数时，
   * 引擎（resourceCalc/damagePoolRelease.ts）读机制设置 `${eventId.split('_')[0]}.releaseShare:<元素>`。
   * 声明后，资源页「异放元素分配」卡与影响分析的占比变量会为本角色出控件。
   * ⚠ `namespace` 必须 == 本模块 dominant 异放事件 eventId 的首段（burnice_flowfire_release ⇒ 'burnice'），否则 UI 写的键引擎读不到；
   *   改名会让用户已存的设置失效。label 用于控件标题（「<label>元素分配」「<label>·<元素>占比」）。
   * 现唯一声明：柏妮思。引擎侧对 grace/vivian/aire/yanagi/promia/nangong/phoenix 的 dominant 事件同样读该键，但 UI 未开放（见 census §5.62 未决项）。
   */
  releaseShare?: { readonly namespace: string; readonly label: string }
  /**
   * 「另两名队友分摊 N 个单位」的队伍级设置声明（CC-56 2026-09-27；**展示层专用**，引擎读同一键）：
   * 设置键 = `${settingPrefix}:${本角色槽位}`（getTeamMechanicSetting），值 = 第一位队友每批提供的个数（0~total，缺省 defaultFirst），
   * 第二位 = total − 第一位。资源页经 agentMechanicView#teamTeammateSplit 出卡片，文案取 title / firstSuffix / batchNote。
   * 现唯一声明：蕾米埃尔（Q 每批 3 个耀变，键 remielle.q:<slot>；引擎侧 remielle.ts 用同一常量读取）。
   */
  teammateSplit?: {
    readonly settingPrefix: string
    readonly total: number
    readonly defaultFirst: number
    readonly title: string
    readonly firstSuffix: string
    readonly batchNote: string
  }
  /**
   * 失衡轴窗口覆盖声明（规则 6 迁移落点，2026-09-12 #10 真清偿）：
   * 模块按「轴内时间轴窗口」算出逐 moveId 的加权覆盖量，供伤害池消费。
   *
   * 为什么单列声明而不是让编排层按 agentId 分支算：这些覆盖量是**角色自己的**窗口语义
   * （般岳明王 8s 二连触发 / 仪玄凝神大招后 15s / 佩洛伊斯阳炎上分支后 21s / 可琳扫除帮手），
   * 此前 4 个函数分别被 useResourceCalc 直接 import + 在 computed 里按 agentId 找槽位调用，
   * 每个新角色都要再改编排层（正是规则 6 要消灭的形状）。
   *
   * 返回 null/缺省 = 本模块本帧不参与（无该角色/无轴/命座已满覆盖等）；返回对象即按桶名覆盖。
   * 桶名与伤害池入参同名（1:1 合并，编排层零映射逻辑）。
   */
  axisWindowOverlays?(input: AgentAxisOverlayInput): AgentAxisOverlays | null
  /**
   * **行级 overlay 加成**（规则 6 迁移落点，CC-17 2026-09-26，设计稿
   * `docs/mcp-cc17-axis-overlay-consume.md` §3/§4）：
   * 由**行所属角色**的模块把自己的 `axisWindowOverlays` 原始返回（桶 + 标量）换算成该行的
   * `dmgBonus` / `critDmgBonus` / `sheerDmgBonus` / note 片段。
   *
   * 为什么单列声明而不是让伤害池按角色分支算：这些换算是**角色自己的**窗口语义
   * （般岳明王层数×每层 / 仪玄凝神暴伤贯穿 / 佩洛阳炎配对 / 可琳扫除帮手 / 希格莉德浸染），
   * 且 overlay 自 CC-17 起**按槽归属**——消费端拿到的就是本行 slot 的桶与标量，
   * 不存在「别的角色的项加到了这一行」的可能（设计稿 §5 零差论证）。
   *
   * 返回 null/缺省 = 本行无 overlay 加成。
   */
  directRowBonus?(input: DirectRowBonusInput): DirectRowBonus | null
  /**
   * 行级轴内占比（CC-33b 2026-09-27，类型注释见 `DirectRowAxisSplitInput`）：认领本行则返回占比与 note，
   * 伤害池按占比拆「轴内吃满易伤 / 轴外无易伤」两段；不认领返回 null（走后续通用分支）。
   * 当前实现方 = 希希芙蚀骨（`xixifu.ts`）。
   */
  directRowAxisSplit?(input: DirectRowAxisSplitInput): DirectRowAxisSplit | null
  /**
   * **角色专属附加直伤行**（规则 6 迁移落点，CC-18a 2026-09-26，设计稿
   * `docs/mcp-cc18-extra-direct-rows.md` §2-1/§2-3）：
   * 由行所属角色的模块生成自己的附加直伤行，返回数组，消费端（`damagePoolCharExtras.ts#emitCharExtraRows`）
   * 按返回顺序逐个 `pushDirect`。
   *
   * 为什么单列声明而不是让编排层逐角色拼行：这些行是**角色自己的**机制产出
   * （柏妮思余烬/搅拌式/灼热抛接法/C6 特殊余烬、半月 C6 摧岳附伤），触发判据与字段读法都
   * 只属于该角色模块；原实现散在 `damagePoolCharExtras.ts` 里按 `charResult.xxxMechanicSource`
   * 分支，每加一个角色都要改消费端（正是规则 6 要消灭的形状）。
   *
   * 顺序论证见设计稿 §2-3/§3：各块按角色互斥（同一角色只命中一块），迁走后对任意角色其
   * 自己的行相对顺序不变，`rows` 的全局顺序也不变（角色逐个处理）。
   *
   * 返回 `[]`/缺省 = 本角色无附加直伤行。
   */
  extraDirectRows?(input: ExtraDirectRowsInput): DirectRowInput[]
  /**
   * 通用直伤行跳过（CC-35d-B2 2026-09-27）：`resourceCalc/damagePoolDirect.ts#emitCharDirectRows` 遍历本槽执行行时，
   * 返回 true 的行不走通用直伤结算，改由本模块 `extraDirectRows` 自行重放。**两处门控必须同源**，否则该行
   * 要么两边都不算（静默少伤），要么双计。现唯一实现：琉音非轴模式的三个强特行（石头 / 剪刀 / 布）。
   */
  skipsGenericDirectRow?(input: { charResult: DeepReadonly<CharacterResourceResult>; moveId: string; isAxis: boolean }): boolean
  /**
   * 赠终结技来源（CC-35d-B3 2026-09-27）：`resourceCalc/ultimatePromote.ts#ultimateGiftSourceOf` 取首个实现本能力的在队槽位，
   * 以其资源结果调用；返回 null = 本轮无来源（不做好评转大）。`goodReviewTotal` 驱动转大不动点
   * （`buildPromoteParams` / `promoteFixpoint`），目标 = 上一位队友。引擎时间预留走 `gift-chain:ultimate`
   * （`ultimateGiftOf`），两者须同源。现唯一实现：琉音。
   */
  ultimateGiftSource?(result: DeepReadonly<CharacterResourceResult>): { goodReviewTotal: number } | null
  /**
   * CC-43c（2026-09-27）：赠大提供者的「好评 → 60/90 转大次数」算法（阈值结转贪心）。
   * 编排层 `resourceCalc/ultimatePromote.ts#promoteHugCountsOf` 按 `ultimateGiftProviderSlot` 找到提供者后取用
   * （promoteFixpoint 非轴路径 + convergence 轴模式「剩余好评默认 90」）。现唯一实现：琉音 `computeLiuyinHugCounts`。
   */
  promoteHugCounts?(
    goodReviewTotal: number,
    stunCount: number,
    hug60Setting: number,
    targetChainCountTotal?: number,
  ): { hug60: number; hug90: number; remainingGoodReview: number }
  /**
   * 风化（风属性异常）事件倍率加成（CC-36b 2026-09-27）：`resourceCalc/damagePoolAnomaly.ts` 结算风化事件时，
   * 按**风槽**角色调用（`panel` = 风槽面板，`triggerCount` = 风化触发次数）。返回 `pct`（%，乘到事件倍率上）与
   * 拼到公式说明末尾的 `note`；null = 无加成。现唯一实现：维琳娜 6 命（再次施加风化，按平均剩余时长 +2.5%/s，上限 40%）。
   */
  windAnomalyBonus?(input: { panel: PanelValues | undefined; triggerCount: number }): { pct: number; note: string } | null
  /**
   * 失衡结束时返还进下一次失衡条的比例（0~1，× bossStunValue；CC-39a 2026-09-27）：`resourceCalc/convergence.ts`
   * 对在队各模块求值取**最大值**，传给 `promoteFixpoint` 的失衡池。现唯一实现：雨果决算
   * （有决算时 min(25%, 剩余秒 × 5%)，剩余秒取设置 `hugo.remainingStunSeconds`）。
   */
  stunRefundRatio?(input: { getMechanicSetting: (key: string, dflt: number) => number }): number
  /**
   * **本轮极性强击赠送次数**（CC-38b 2026-09-27，设计稿 `docs/mcp-cc38-alice.md`）：
   * 从本角色资源结果读出「无视积蓄、直接赠送的 physical_polar_assault 触发数」。
   * 编排层（convergence）对 `rr.characters` 派发**求和**后注入异常池 `giftedTriggerCounts`；
   * 外层收敛签名（outerCycle）逐角色投影同一值。现唯一实现：爱丽丝（星芒圆舞曲 #3 次数）。
   */
  giftedPolarAssaultCount?(char: CharacterResourceResult): number
  /**
   * CC-80：本角色本轮**开启以太帷幕的次数**（`mechanics/teamVeil.ts#computeTeamVeilCountTotal` 对在队角色求和，
   * 经收敛线程 teamVeilCountTotal 注入下一轮各 cfg）。入参已 floor 且 ≥ 0。
   * 现实现：爱芮 1501 / 叶瞬光 1431（终结技 1:1）、千夏 1491（强特 1:1）、照 1341（霜寒开帷幕）。原为 teamVeil.ts 写死集合。
   */
  teamVeilCount?(input: { exCount: number; ultimateCount: number; combatTime: number }): number
  /**
   * **副词条优化模板**（CC-81 2026-09-27，census §5.88）。`core/substatOptimizer.ts#getTemplate`
   * 先查本声明，缺省按职业兜底默认模板。原为 core 内按角色 id 为键的 AGENT_TEMPLATES 表。
   */
  substatTemplate?: SubstatTemplate
  /**
   * **本角色的轴块是否结束失衡窗口**（决算类招式；CC-39b 2026-09-27，设计稿
   * `docs/mcp-cc39b-stun-window-end.md`）。编排层经 `resourceCalc/helpers.ts#axisMoveEndsStunWindow`
   * 按轴块所在槽的角色派发：convergence 决算截断剩余失衡秒数 + roundInputs 给轴栈打 `endsStunWindow`。
   * 现实现：佩洛伊斯（右分支决算 1551016）、雨果（强特终结一击恒真；终结技仅影画 < 2）。
   */
  endsStunWindow?(moveId: string, cinemaLevel: number): boolean
  /**
   * CC-42（2026-09-27）：风化浸染「默认挑槽」时跳过本角色（首选轮排除；兜底轮仍可被选中，语义同原 `!isRemielle`）。
   * 读取方：`resourceCalc/anomalyPanels.ts#getWindInfectionTargetSlot`，按槽位 agentId 派发。现实现：蕾米埃尔。
   */
  excludeFromWindInfectionPick?: boolean
  /**
   * **轴块动作时长兜底**（CC-39b）：入参为倍率表 / 块 duration 给出的时长，返回实际用于窗口截断的时长。
   * 用于无倍率表条目的合成行。现唯一实现：雨果（`1291_ex_verdict_final` 且 ≤ 0 时取 1.805s）。
   */
  axisMoveActionTime?(moveId: string, catalogActionTime: number): number
  /**
   * **角色专属异常附加行**（规则 6 迁移落点，CC-19a 2026-09-26，设计稿
   * `docs/mcp-cc19-extra-anomaly-rows.md` §2.1/§2.3）：
   * 由行所属角色的模块生成自己的异常尾段附加行，返回**分组**（`order` 取
   * `EXTRA_ANOMALY_ROW_ORDER` 的值），消费端（`damagePoolAnomaly.ts#emitAnomalyRows`）
   * 跨全队按 `order` 稳定排序后展开 push。
   *
   * 为什么返回分组而不是直接数组：逐槽派发时行顺序会跟着队伍排列变化，而爱丽丝占 3 块
   * 且与简交错，逐槽 push 无法复现原 `damagePoolAnomaly` 的块序（rowsnap 按数组顺序求
   * sha256，零差验收会失效）。分组 + 稳定排序可对任意队伍排列逐位复现原顺序（设计稿 §2.1）。
   *
   * 返回 `[]`/缺省 = 本角色无异常附加行。
   */
  extraAnomalyRows?(input: ExtraAnomalyRowsInput): ExtraAnomalyRowGroup[]

  /**
   * 全队异常伤害乘区因子（CC-21 2026-09-26，census §5.14）：`useResourceCalc#globalAnomalyMultiplier`
   * 对全队各槽的本能力（入参 = 本槽面板）连乘，缺省视为 1；结果经 ctx / roundInputs 注入异常池与伤害池。
   * 现仅蕾米埃尔实现（异化系数）。
   */
  globalAnomalyMultiplierFactor?(panel: PanelValues): number
  /**
   * 异化度展示值（%，CC-35a 2026-09-27）：`resourceCalc/anomalyPanels.ts#buildAnomalyVirtualPanel` 对每个积蓄
   * 贡献行，把**在队**各模块的返回值（以该行的面板为参数）求和，写进 `AnomalyVirtualPanelRow.refringe`
   * （结果页异常虚拟面板表的「异化度」列），不参与伤害计算。伤害乘区另走 `globalAnomalyMultiplierFactor`，
   * 两者应出自同一算式。首个实现：蕾米埃尔。
   */
  anomalyRefringePct?(panel: Readonly<PanelValues>): number
  /**
   * 本角色在队时，全队某属性异常的持续时间延长秒数（CC-35c 2026-09-27，「通用规则臂」）：
   * `resourceCalc/anomalyPanels.ts#getTeamAnomalyDurationBonus(element)` 对在队各模块求值，**取最大值**（不叠加；
   * 现状每种属性至多一个提供者）。未命中返回 0。现有实现：柏妮思 火 +3、丽娜 电 +3（额外能力激活时）、简 物理 +5。
   * ⚠ 爱芮的以太 +3 走 spec `teamBuffs` 的 buff 通道，**不要**在这里再实现（会双计）。
   */
  teamAnomalyDurationBonus?(input: { element: string; slot: number; agent: Agent | null; team: ReadonlyTeam }): number
  /**
   * 修正本角色的**队友 buff 来源面板**（CC-35c-B 2026-09-27）：`resourceCalc/panelPhases.ts#computePanelPhases` 构建
   * `sourcePanelsByOwner` 后，对在队各槽调用（`source` = 以本角色 agentId 为键的条目，可直接替换其 `inCombat` / `outOfCombat`）。
   * 用途：队友 buff 公式读来源面板，而来源面板只含自身配置，缺少某些局内状态（莱特喷发冲击 +20%、耀嘉音 3/5 命技能等级）。
   */
  adjustTeammateBuffSource?(input: { source: SourcePanelsByOwner[string]; cinemaLevel: number }): void
  /**
   * 装配后赠送连携（CC-35d-A 2026-09-27）：`resourceCalc/chainGift.ts#applyChainGift` 取首个实现本能力的在队槽位，
   * 以其资源结果调用。返回 null = 本轮无来源（结果不动）；否则给「上一位队友」（`resolveTeammateTargetSlot`）
   * 赠送 `count` 次该队友本人的连携技（count ≤ 0 时撤掉引擎占位赠送行），`label` 拼在招式名后、`note` 进技能表说明。
   * 引擎的时间预留走 `crossAgentSupply` 的 `gift-chain:chain` 通道，两者必须同源。现唯一实现：诺姆（帽子把戏）。
   */
  chainGift?(result: DeepReadonly<CharacterResourceResult>): { count: number; label: string; note: string } | null
  /**
   * CC-43e（2026-09-27）：本角色「拥有」轴预设里的 `promoteVariant`（60/90 转大）块。
   * 编排层 `roundInputs.ts#buildStackAxes`：队里没有任何声明者时跳过 promoteVariant 块（不当普通轴动作执行）。
   * 声明式（同 `backstageAutoFill` 范式），替代原身份判定 `findSlotByIdentity(['1481'])`。现实现：琉音。
   */
  ownsPromoteVariantAxisBlocks?: boolean
  /**
   * CC-43f（2026-09-27）：把本角色的**轴内伪块**展开成真实栈动作（进失衡窗口时间门控）。
   * 编排层 `roundInputs.ts#buildStackAxes` 按轴块所在槽的 agentId 派发；返回 `undefined` = 不是我的伪块，走通用路径。
   * `actionTimeOf(moveId)` 由编排层提供（查本槽技能表的 actionTime；mechanics 不能按值导入 composables）。
   * 现实现：希格莉德（破阵连段 `sigrid-pozhen` → 敛枪式三段，C6 时长 ×0.75，免费）。
   */
  expandAxisAction?(input: {
    slot: number
    moveId: string
    count: number
    startTime: number
    cinemaLevel: number
    actionTimeOf: (moveId: string) => number
  }): StackActionCost[] | undefined
  /**
   * 交互补齐量求解（CC-23）：编排层（`convergence.ts`）在 autoTopUp 门控成立时，对「挂出本能力的那个槽位」
   * 的模块调用本能力，求下一轮的弹刀/双反补齐量（轮间经 `threads.interactionTopUp` 收敛）。编排层不含角色 id、不 import 角色模块。
   *
   * **能力存在即声明**（CC-293）：槽位由 `registry.ts#findInteractionTopUpSlot` 按「谁实现了本能力」查找，
   * convergence 找槽与 useResourceCalc 交互栏的懒守卫（非本角色队伍不触发全量计算）共用它。
   * 此前另有布尔旗标 `producesInteractionTopUp` 表达同一事实，两者可以不一致（旗标有、能力无 ⇒ 门控打开却静默不补）。
   *
   * **门控归模块**（CC-295）：编排层每轮都调用（只要有产出者槽位），递 `gate` 事实；模块判定本轮不补齐时返回
   * `null` ⇒ 编排层保持上一轮值（与 applyTeamConfig 侧「不用它」配合，行为同迁移前）。此前 convergence 与
   * banyue.ts 各写一份 `(axisActive || fury || ultimate) && 设置 !== 0`，编排层还直读 `banyue.` 设置键。
   */
  computeInteractionTopUp?(opts: InteractionTopUpInput & { gate: InteractionTopUpGate }): InteractionTopUp | null
  /**
   * 异常池入参设置（CC-25）：编排层（`roundInputs.ts` 的 `anomalyPoolSetupInfo`）找到本队第一个挂了
   * 本能力的槽位，按 `characters.find(c => c.slot === slot)` 取**本模块自己那份 cfg** 调用；返回 null =
   * 本轮不启用。返回的 `coweringConfig` 下发给异常池（畏缩 DOT + 紊乱倍率加成），该槽位同时作为
   * 赠送触发（极性强击）的归属槽位 `giftedTriggerSlot`。原先编排层按身份 `findSlotByIdentity(['1401'])`
   * 找槽并直读 `cfg.aliceEnabled` / `cfg.aliceCowering*`。
   * ⚠ 只能读 cfg（与 resourceResult 无关）——调用点在 calcOutput 求值链里，读资源结果会成环（见 roundInputs 头注释）。
   */
  anomalyPoolSetup?(cfg: DeepReadonly<CharacterOperationConfig>): { coweringConfig?: CoweringConfig } | null
  /**
   * 模块专属必做动作（CC-26）：core/resource 经 `rowAccounting.ts#extraNecessaryActionOf` 派发。
   * 返回非 null ⇒ ① `helpers.ts` 必要时间/合轴时间按 `count × actionTime`（× comboAlignRatio）预留；
   * ② `rowBuild.ts#buildExecutions` 在 `moveId` 非空时补一行（category basic，timeBucket necessary）。
   * 原为 core 内联的蕾米埃尔一/四/六命「特殊虚耀 → 垂虹」逻辑。count <= 0 时应返回 null。
   * CC-197 扩展：可返回数组（同一资源驱动动作的多种形态，如爱芮普通/强化第三段）；`state` 为派发侧的迭代态
   * （helpers 预留时 = 上一轮 prevState、rowBuild 补行时 = 本轮 state，收敛后同值），次数依赖资源次数的模块读它。
   * 与「buildExecutions 推 necessary 行 + 折叠残差」相比，本通道的时间**进入账本估计**（Σnecessary），装不下时由
   * 团队级 feasibleScale 等比封顶 + 装配截断——不经 timeBudgetExcess `+=`，没有「占用→池缩→上限缩」的减半问题。
   */
  extraNecessaryAction?(cfg: CharacterOperationConfig, state?: Readonly<IterationState>): ExtraNecessaryAction | readonly ExtraNecessaryAction[] | null
  /**
   * 异常池预构建钩子：在 perElement 积蓄汇总之前调用（引擎已构建 elementMap 并预算 turbulenceCount）。
   * 模块可向 elementMap 注入额外积蓄贡献（如维琳娜风蚀替换广域），或把机制状态写入 store 供引擎消费。
   * 引擎保证：调用顺序在所有模块的 perElement 汇总之前，注入值进入所有下游（触发次数/覆盖率/note）。
   */
  transformAnomalyPool?(input: AgentAnomalyTransformInput): void
  /**
   * **引擎期风蚀状态结算**（规则 6 引擎落点，2026-09-25 CC-6d）。
   *
   * 存在的理由：`core/anomalyPool.ts` 与 `core/anomalyPool/helpers.ts` 曾各自**值导入**
   * `@/mechanics/agents/velina#resolveVelinaCorrosion`（`anomalyPool.ts:332` 终局按最终乱流次数
   * 重结算；`helpers.ts:1210` 的 `calcTurbulenceDamage` 内）——引擎静态 import 角色模块正是规则 6
   * 要消灭的形状（判据 12 core 角色 import 棘轮盯着）。风蚀是**维琳娜专属资源**，归属判据
   * = 派发方给的 `self`（r399 CC-373：引擎只对在队模块派发；原为 `panel.velinaEnabled` 面板标记，CC-D3 2026-09-25）。
   *
   * 契约：**纯函数**（同 `crossAgentSupply.supply` / `exSpecialCount`），只读入参；返回 `undefined`
   * = 本模块不认领 / 队里没有该资源持有者（调用方据此整套跳过风蚀结算）。同一队至多一个模块返回
   * 非 undefined（引擎按注册顺序取首个）。角色专属参数（如维琳娜 2 命风蚀利用率）由模块在 `applyPanel`
   * 读 `settings` 盖章到自己的面板字段、在此读回（CC-27）——本入参不携带任何角色专属量。
   */
  anomalyCorrosion?(input: {
    /** 本模块角色自己那一槽（r399 CC-373，同 `AgentAnomalyTransformInput.self`）；不再给全队 `panels` */
    self: AnomalyHookSelf
    turbulenceCount: number
    windTriggerCount: number
  }): CorrosionSource | undefined
  /**
   * CC-71：风蚀气旋异放事件记录（微域 / 风蚀替换广域）——由认领风蚀（`anomalyCorrosion` 有结果）的模块产出，
   * 引擎在 `core/anomalyPool.ts` 原位置追加（原写死维琳娜文案与倍率字段）。
   */
  anomalyCorrosionEvents?(source: CorrosionSource): AnomalyEventRecord[]
  /**
   * **本轮已收敛 → 算出「下一轮反馈」**（规则 6 在编排层的落点，2026-09-16 立项）。
   *
   * 存在的理由：`convergence.ts` 曾住着 5 个 `compute*NextRoundFeedback` 纯函数
   * （普罗米娅 1541 / 零号·安比 1381 / 露西 1151 / 薇薇安 1331 / 艾莲 1191，共 13 处
   * `agentId ===/!==`）——它们读**全队本轮结果**（`TeamResourceResult` + 异常池）算出下一轮
   * 线程值，一部分**写回自己那份 cfg**（展示端与 module 自读），一部分交给编排层线程化。
   * 这正是规则 6 要消灭的形状：编排层替每个角色认人。
   *
   * 与 `applyTeamConfig({phase:'postRound'})` 的分工：那个是**写 cfg 字段**的通用相位，入参是
   * 次数类标量；本钩子是**读本轮全队结果、返回下一轮线程值**的相位——两者都在 postRound 附近
   * 派发，但本钩子的输入是「本轮收敛结果快照」而不是「次数」，且**返回值**要参与 `threadsNext`。
   * 返回值由编排层统一线程化（单一 owner，模块不写 threads，见 `roundThreads.ts` 头注释）。
   *
   * ⚠ **写回 cfg 的首轮守卫逐位保留在模块里**：「首轮才写」与「每轮都写」是口径差异不是疏忽
   * （普罗米娅/薇薇安/艾莲 = 上一轮线程值 ≤0 才写；**露西 = 每轮无条件写**——消费端读的就是
   * 本轮估计值）。判据见 `prevThreads`（上一轮线程快照）与各模块自己的注释。
   *
   * 返回 = 本模块的**下一轮线程值**（`CalcRoundThreads` 的字段子集），由编排层 merge 后统一
   * 线程化。返回缺省/`undefined` 的字段保持编排层的 0 初值（与迁移前各函数「守卫不成立就返回 0」等价）。
   */
  nextRoundFeedback?(input: AgentNextRoundFeedbackInput): ModuleFeedback | void
  /**
   * **跨槽位供给声明**（规则 6 在引擎层的落点，2026-09-13 立项）。
   *
   * 存在的理由：引擎里长期住着「某角色怎么把资源送给队友」的角色专属数学——赠链族
   * （`core/resource.ts` 的 `normaGiftChainInfo`/`liuyinGiftChainInfo`/`liuyinGiftTime` 等 135 行）
   * 与跨角色回能族（`calcCrossAgentEnergy` 里的露西/莱特/席德分支）。它们**既不被 agentId 棘轮计数**
   * （不写 id 字面量，只 import 那个角色的模块），又必须随角色更新而改引擎——正是规则 6 要消灭的形状。
   *
   * 为什么不搬进 `applyTeamConfig`：那些供给要在**引擎内层热循环**（`iterate`）/折叠环每个 pass 重算，
   * 而 `applyTeamConfig` 由编排层按三相位派发、输入带 configStore——引擎契约 `ResourceCalcConfig`
   * 是纯数据，没有派发钩子所需的上下文。故本声明是**纯函数式**的：引擎每 pass 按类别查询槽位、
   * 调 `supply()` 拿数量、按 `targetSlot()` 落点，全程不含角色 id。
   *
   * 新角色接入 = 只写自己的模块（引擎与编排层零改动），与 `computeInteractionTopUp` /
   * `backstageAutoFill` / `axisWindowOverlays` 同族。
   */
  crossAgentSupply?: CrossAgentSupplySpec
  /**
   * **引擎期强特次数求解**（规则 6 引擎落点，2026-09-24 CC-6a）。
   *
   * 存在的理由：`core/resource/helpers.ts#resolveExSpecialCount` 里曾住着「般岳强特总次数由
   * 嗔火/怒相循环决定」的角色数学——免费强特不耗闪能，不能用通用的 `总能量/强特消耗`；轴内
   * 连段块不重复计。这正是规则 6 要消灭的形状（引擎替某个角色认人）。
   *
   * 契约：**纯函数**（同 `crossAgentSupply.supply`），只读入参与自己 cfg 上的模块写入字段
   * （如 `banyueAxisEx`），不得依赖 store/DOM/时间。返回 `undefined` = 本模块不认领，
   * 引擎回落通用公式（`总能量 ÷ 强特消耗`）。同一 agentId 至多一个模块声明。
   */
  exSpecialCount?(input: { cfg: CharacterOperationConfig; totalEnergy: number }): number | undefined
  /**
   * **引擎期帷幕触发次数求解**（规则 6 引擎落点，2026-09-25 CC-6b）。
   *
   * 存在的理由：`core/resource/helpers.ts#iterate` 与 `core/resource.ts` 收敛后各住着一段
   * 「1451 卢西娅 C4 帷幕触发次数」的角色数学（`computeLuciaCurtainTriggers`），且都要读
   * **队友槽的中间态**（伊德海莉 `ultimateCount`）。这正是规则 6 要消灭的形状。
   *
   * 跨槽消解：队友开帷幕量**不由本能力读队友 state**——由提供者模块声明
   * `crossAgentSupply.kind='curtain-open'`（伊德海莉每次终结技开一次帷幕），引擎用
   * `findCrossAgentSupplySlots` + `crossAgentSupplyCountOf` 收集成标量 `teammateOpenCount`
   * 再传入（见 `core/resource/curtain.ts`）。本能力因此保持**纯函数**：只读入参与自己 cfg。
   *
   * 返回 `undefined` = 本模块不提供帷幕（引擎不认领该槽）；同一 agentId 至多一个模块声明。
   */
  curtainTriggers?(input: {
    cfg: CharacterOperationConfig
    state: Readonly<IterationState>
    /** 队友开帷幕总量（引擎按 `crossAgentSupply.kind='curtain-open'` 收集；无队友时为 0） */
    teammateOpenCount: number
    /** 战斗总时长（秒），用于 15s CD 封顶 */
    totalTime: number
  }): number
  /**
   * **自身烧血喧响**（规则 6 引擎落点，2026-09-26 CC-14b；伊德海莉先例）。
   *
   * 语义：本模块角色因「烧血 → 回血」循环产生的**不可分享**自身喧响（原始量，未乘获得效率）。
   * 调用方负责乘 `decibelEfficiencyMultiplier`；与队友分享比例无关。
   *
   * 为什么单列一个能力：`core/resource/helpers.ts#iterate` 与 `core/resource/resourceIncome.ts`
   * 曾各住着一段伊德海莉专属的「75% 开局烧血 + 回血总量」算式（含缺失生命折算、蓄力重碾 +
   * 平A追击循环、外部治疗）。算式本身是角色独有的，正是规则 6 要消灭的「引擎替某个角色认人」。
   *
   * `providerUltCount` = 帷幕提供者的终结技次数（供外部治疗按次结算部分消费）；已经由
   * `assembleSlot` 把「每次 × 次数」写回 cfg 的调用方传 0（避免重复计入）。
   */
  selfBurnDecibel?(input: {
    cfg: CharacterOperationConfig
    basicAttackTime: number
    exSpecialCount: number
    providerUltCount: number
  }): number
  /**
   * **装配期写回**（规则 6 引擎落点，2026-09-26 CC-14c；伊德海莉先例）。
   *
   * 语义：S4 装配（`core/resource/assembleSlot.ts`）逐槽开头调用，把「依赖帷幕提供者**最终**终结技
   * 次数」的派生量写回本模块自己的 cfg（供结果装配 `selfBurnDecibel(providerUltCount: 0)` 与展示共用）。
   * 只在队伍里有帷幕提供者（`curtain.providerSlot >= 0`）时调用；`providerUltCount` = 提供者终态
   * `ultimateCount`。**槽序即写序**：调用点固定在 assembleSlot 开头，不可重排。
   *
   * 为什么单列：原先 core 用 `yidhariSlot = configs.findIndex(c => c.yidhariDecibelPerHpPct !== undefined)`
   * 认人，再在装配段直接改写 `cfg.yidhariExternalHealPct`——引擎替某个角色认人 + 写角色字段。
   *
   * 2026-09-26 CC-14e：入参扩为「帷幕写回」通用面——`isCurtainProvider` = 本槽是否帷幕提供者
   * （卢西娅 C4 三个写回只在为真时执行）、`curtainTriggers` = 本态帷幕触发总次数、`state`/`totalTime`
   * 供模块自调能力、`curtainOpeners` = 引擎按 `curtain-open` 收集的队友开帷幕原始次数
   * （`agentId` + `rawCount`，已滤掉 0）。**唯一调用方 = core，五个字段每次全传 ⇒ 必填**。
   */
  onFinalAssemble?(input: {
    cfg: CharacterOperationConfig
    providerUltCount: number
    /** 本槽是否帷幕提供者槽（`i === curtain.providerSlot`） */
    isCurtainProvider: boolean
    /** 本态帷幕触发总次数（含队友开帷幕；15s CD 封顶 × 利用率滑块已折算） */
    curtainTriggers: number
    /** 本槽装配期终态 */
    state: IterationState
    /** 战斗总时长（秒） */
    totalTime: number
    /** 队友开帷幕原始次数（引擎按 `crossAgentSupply.kind='curtain-open'` 收集；`rawCount > 0` 才入列） */
    curtainOpeners: Array<{ agentId: string; rawCount: number }>
  }): void
  /**
   * **角色专属能量项**（规则 6 引擎落点，2026-09-26 CC-14a；诺姆/青衣/莱卡恩/比利/仪玄/安东先例）。
   *
   * 语义：本模块角色独有的**固定源能量**（如诺姆影画2 帽子把戏、青衣影画4 稳态电弧屏障、
   * 莱卡恩影画2 能量回馈……），`value` 是**最终能量**（未乘任何系数），调用方直接计入
   * `EnergySource.e0`/`total`，不参与自动回能的百分比/效率乘区。
   *
   * 为什么单列一个能力：`core/resource/resourceIncome.ts#calcEnergySource` 曾住着 6 段
   * 角色专属回能算式（`cfg.normaC2EnergyPerTrigger` / `cfg.qingyiC4EnergyPerTrigger` /
   * `cfg.lycaonC2Energy` / `cfg.billyC1Energy` / `cfg.yixuanFlashBonus` / `cfg.antonC1EnergyGift`），
   * 正是规则 6 要消灭的「引擎替某个角色认人」。
   *
   * 契约：**纯函数**，只读入参与**自己那份 cfg**（模块只报告自己 cfg 上的项）；
   * 返回空数组 = 本模块无专属能量项。同一 agentId 至多一个模块声明。
   */
  bonusEnergy?(input: {
    cfg: CharacterOperationConfig
    totalTime: number
  }): BonusEnergyEntry[]
  /**
   * **终局整数重推**（规则 6 引擎落点，2026-09-25 CC-6c；1531/1431/1051 先例）。
   *
   * 存在的理由：`calcTeamResources` 里曾住着两段角色专属的「实数化收尾」——preTail（S2 折叠
   * 之后、S3a 欠打回填之前）的 1531 链数 / 1431 轮数，tail（S3a 欠打回填之后、S4 装配之前）的
   * 1051 强特次数；三者共享同一台 ≤12 轮重推机器，只有「谁参与 / 置哪个旗标 / 何时复位」是
   * 角色专属的。这正是规则 6 要消灭的形状（引擎替某个角色认人）。
   *
   * 契约：`applies` / `begin` / `reset` 都是**只碰自己那份 cfg** 的操作（`applies` 是纯判据）。
   * 引擎拥有 ≤12 轮 `iterate` + 全状态逐位判稳 + `converged` 上报（执行器
   * `core/resource/finalizePasses.ts#runFinalizePasses`）。
   *
   * ⚠ `stage` 逐位保留两个既有调用时机，**不可合并**（合并会改数值）：
   *   · `'preTail'`：S2 折叠之后、S3a 欠打回填之前（1531 / 1431）
   *   · `'tail'`   ：S3a 欠打回填之后、S4 装配之前（1051）
   *
   * ⚠ `reset` 的**不对称语义由模块自己保留**：`resetFinalizePasses` 对所有声明者都调 `reset`，
   * 但叶瞬光须在 `reset` 内部先判 `yeshuguangContinuousForms === 1` 再写（否则 `undefined → false`
   * 会漂进 cfg / 热启动键），比利 / 伊德海莉无条件写 `false`。
   */
  finalizePass?: {
    stage: 'preTail' | 'tail'
    /** 本模块本 stage 是否参与重推（纯判据，只读自己 cfg） */
    applies(cfg: CharacterOperationConfig): boolean
    /**
     * 置位自己的终局旗标（引擎在重推循环前调用）。`entry` = 本槽的终局入口态（S2 折叠收敛后）——
     * 模块可据它把实数推导量 floor 一次并冻结（CC-160 叶瞬光照影轮数），只读、不得改写。
     */
    begin(cfg: CharacterOperationConfig, entry: IterationState): void
    /**
     * 可选（CC-160，第 187 轮）：终局重推后由引擎**重折一次**（`runFoldLoop`），按整数行重算 S2 折叠残差。
     * 适用：整数化会让本槽物化行明显缩短/伸长（叶瞬光少一轮 ≈ 10.9s），实数期残差原样留下即虚高留白。
     * 未声明 = 不重折（比利实测重折会改 golden/adjustable 且未归因，第 187 轮暂不开，见 stun-dual-source §24.9）。
     */
    refoldAfter?: boolean
    /** 装配后复位（引擎在装配之后调用；不对称语义见上方说明） */
    reset(cfg: CharacterOperationConfig): void
  }
}

// CC-83（2026-09-27，census §5.90）：卫星类型拆到同级 typesRows.ts / typesHooks.ts，这里原样转出，
// 导入方继续写 `from '@/mechanics/types'`。AgentMechanicModule 本体与各 Agent*Input 留在本文件。
export type { DirectRowAxisSplitInput, DirectRowAxisSplit, DirectRowBonusInput, DirectRowBonus, ExtraDirectRowsInput, ExtraAnomalyRowGroup, ExtraAnomalyRowsInput } from './typesRows'
export { EXTRA_ANOMALY_ROW_ORDER } from './typesRows'
export type { CrossAgentSupplySpec, CrossAgentSupplyInput, AgentStunOverrideInput, AgentStunOverride, AgentAxisOverlayInput, AgentAxisOverlays, AxisScalarOverlays, AgentAnomalyTransformInput, AnomalyHookSelf, AgentNextRoundFeedbackInput, InteractionTopUp, InteractionTopUpInput, InteractionTopUpGate, ExtraNecessaryAction, AgentAnomalyEventRecordsInput, AxisEditorBlockMark, CharacterCountInputDecl } from './typesHooks'
