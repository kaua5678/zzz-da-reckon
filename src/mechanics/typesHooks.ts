/**
 * mechanics 卫星类型：跨槽供给、失衡覆盖、轴 overlay、异常池变换、下一轮反馈、交互补齐、必做动作、异常事件记录、轴编辑标记、次数输入声明；
 * 以及原先只在 `AgentMechanicModule` 里写成字面量的六个钩子形状（r732，见文件末尾），`promoteHugCounts` 的入参（r752）。
 * CC-83（2026-09-27，census §5.90）自 `mechanics/types.ts` 逐字拆出；types.ts 原样转出，导入方不用改。
 */
import type { DeepReadonly } from 'vue'
import type { ActionCountField } from '@/stores/config'
import type { AgentSkills, PanelValues } from '@/types/catalog'
import type { AnomalyContribution, AnomalyPoolResult, CharacterOperationConfig, IterationState, StunAxis, TeamResourceResult } from '@/types/resource'
import type { CalcRoundThreads } from '@/composables/resourceCalc/roundThreads'

/**
 * 跨槽位供给声明（`AgentMechanicModule.crossAgentSupply`）。
 *
 * 一个模块可声明**多条**（如诺姆既有赠链又有膛温喧响）；引擎按 `kind` 查询，同一 kind
 * 在一队内只应有**一个**提供者（多提供者时引擎取注册顺序首个并上报，不静默求和）。
 */
export interface CrossAgentSupplySpec {
  /**
   * 供给类别。引擎按类别查询与执行（新类别 = 两边各加一个消费点，不是新角色各加一个分支）：
   * - `'gift-chain:chain'`：赠**连携行**给队友（占用队友前台时间）——诺姆膛温帽子把戏
   * - `'gift-chain:ultimate'`：赠**终结技行**给队友——琉音好评转大
   *   （两者同属赠链但落点行不同 ⇒ 类别按「赠什么行」区分，不按「谁赠的」区分：
   *    同队可同时存在，引擎取**全部**同类提供者各自出数，不静默合并）
   * - `'curtain-open'`：队友**开帷幕**次数（供 `curtainTriggers` 能力消费，伊德海莉终结技即此例）
   * - `'neighbor-ult-energy'`（丽娜/苍角/露西邻位终结回能）/ `'vanguard-energy'`（席德正兵回能，CC-32a）：
   *   多落点回能，走 `perTargetAmounts` + `displayKey`（派发器 `perTargetEnergyByProvider`）
   * - 后续批次：`'c4-burst'`
   */
  kind: string
  /**
   * 本 pass 的供给量（单位随 kind：'gift-chain' = 赠送动作**次数**）。
   *
   * **必须是纯函数**：只读入参与自己 cfg 上的模块写入字段，不得依赖 store/DOM/时间。
   * 引擎会在内层热循环与折叠环里反复调用它（一次求值可达数百次）。
   *
   * `targetCfg` 由引擎先按 `targetSlot()` 解析后传入（部分类别的供给量依赖落点：
   * 如琉音转大要按目标槽的连携次数做 60/90 拆分）。槽位无效时 `targetCfg` 为 undefined，
   * 此时应返回 0。
   */
  supply(input: CrossAgentSupplyInput): number
  /**
   * 供给落点槽位（缺省 = 上一位队友，环绕跳过空槽，与 `resolveTeammateTargetSlot` 同口径）。
   * 入参 `ownSlot` 与返回值都是**编队槽位**（`cfg.slot`），`occupiedSlots` = 已上场槽位；引擎负责映射回 `configs` 下标（CC-180）；返回 -1 或空槽 = 无落点。
   * 模块自己读 `cfg` 上的设置字段（如 `setting:liuyin.ultimateTargetSlot`，值为编队槽位）——
   * 引擎不解释角色私有设置键。
   */
  targetSlot?(input: { ownSlot: number; occupiedSlots: readonly number[]; cfg: CharacterOperationConfig }): number
  /**
   * **多落点**供给（可选，优先级高于 `targetSlot`）：一次给出「槽位 → 该落点得到的量」的完整映射。
   *
   * 为什么需要（2026-09-15 core 棘轮批次3，丽娜/苍角/露西邻位回能）：这些机制的落点是
   * 「**下一位队友 30 + 上一位队友 10**」——同一提供者对不同落点给**不同的量**，
   * 而 `targetSlot()` 只能表达单落点 + `supply()` 单值。故补这个可选槽位（不破坏既有提供者）。
   * 返回的 `Record` 的 key 是**槽位下标**，value 是该落点获得的量（本类别语义 = 能量总量）。
   * 引擎遍历提供者求和（见 `neighborUltEnergyByProvider`）；不需要多落点的类别继续用 `supply()`+`targetSlot()`。
   *
   * （r397 CC-371 删除了从未被引擎提供、也无模块读取的 `targetCfgOf` 入参；它服务的露西
   * `lucyCheerSpinsEstimate` 是死通道，见 `docs/mcp-nextround-writeback.md`。要按落点读 cfg 时再按需加回。）
   */
  perTargetAmounts?(input: {
    /** 提供者的 `configs` 下标（返回 Record 的 key 同为 `configs` 下标） */
    ownSlot: number
    /** 已上场人数（= `configs.length`，不含空槽；两人队的「另一位」语义靠它） */
    teamSize: number
    cfg: CharacterOperationConfig
    state: IterationState
  }): Record<number, number>
  /**
   * 提供者**自己那一槽**的回写钩子（可选，CC-32a 2026-09-27）：`calcCrossAgentEnergy` 在算提供者自己
   * （`slotIndex === ownSlot`）时调用一次，允许把「读落点状态得出的量」写回**提供者自己的 cfg**。
   * 席德 `'vanguard-energy'` 即此例：写 `xideVanguardEnergySpent = floor(正兵强特次数) × 正兵强特耗能`
   * 供钢能资源循环读。时机与迁移前引擎内联块逐位一致（iterate 与最终装配两处调用都会触发）。
   * ⚠ 唯一允许的副作用 = 写**自己**的 cfg；不得写其他槽、不得依赖 store。
   */
  onOwnSlotCrossAgentEnergy?(input: {
    ownSlot: number
    cfg: CharacterOperationConfig
    configs: readonly CharacterOperationConfig[]
    states: readonly IterationState[]
  }): void
  /**
   * 本供给在 `CrossAgentEnergy` 里对应的**展示明细键**（可选）。
   *
   * 为什么需要（2026-09-15 core 棘轮批次3）：`CrossAgentEnergy` 暴露
   * `rinaUltEnergy` / `soukakuUltEnergy` / `lucyEnergy` 三个「来源」字段供
   * `ResourceResultCard.vue` 逐条展示，迁移前引擎靠 `findIndex(c => c.agentId === '1211')`
   * 之类把值填进对应字段。现在改由**模块自报键名**、引擎按 key 聚合
   * （`neighborUltEnergyByProvider` 的 `byDisplayKey`）⇒ 引擎侧零角色名，
   * 而 UI 字段名与语义不变（新增提供者只需声明自己的 key + 在 UI 加一行）。
   */
  displayKey?: string
  /**
   * 单个供给单位占用**落点槽**的前台秒数（缺省 = 落点 cfg 的 `ultimateActionTime`）。
   * 用于折叠环/欠打试探把赠送时间计入行测量（否则预留被读成 idle → refund 双击）。
   */
  secondsPerUnit?(input: { targetCfg: CharacterOperationConfig; ownCfg: CharacterOperationConfig }): number
  /**
   * 本类别受轴模式抑制时为 true（缺省 false = 轴内外同口径）。
   * 琉音赠大即此例：轴内次数由轴预设 decide，通用公式在轴模式会算出另一个数，
   * 故轴模式跳过供给（2026-09-10 实测口径，见 docs 坑19①）。
   */
  axisSuppressed?: boolean
  /**
   * 每个供给单位给**提供者自己**带来的额外喧响（缺省 0 = 不产）。
   * 诺姆影画4「膛温换连携」即此例：每次赠链 +200 不可分享喧响（影画4 门控在模块内判，
   * 未达命座时本函数返回 0）——引擎不该为此 import 该角色模块。
   */
  decibelPerUnit?(input: { cfg: CharacterOperationConfig }): number
}

/** `crossAgentSupply.supply()` 入参：纯数据，引擎在热循环里可直接构造 */
export interface CrossAgentSupplyInput {
  /** 提供者自己的 cfg */
  cfg: CharacterOperationConfig
  /** 提供者自己上一轮/本轮的收敛状态 */
  state: Readonly<IterationState>
  /** 供给落点槽的 cfg（槽位无效时 undefined ⇒ 返回 0） */
  targetCfg?: CharacterOperationConfig
  /** 失衡次数（**计数通道**：引擎各调用点传 `stunCountForCountChannel` / `countStunOf`，CC-141 起；少数只要单位量的调用点传 0） */
  stunCount: number
  /** 战斗总时长（秒） */
  totalTime: number
}

/**
 * 行级失衡易伤自报钩子入参（规则 6 落点，2026-09-16 round 17 / R15-c）。
 *
 * 存在的理由：`damagePool.ts` 的「未进轴槽位」兜底臂里曾住着两条 `charResult.agentId` 判据
 * （`:567` 叶瞬光 / `:570` 雨果），它们否决的是**同一件事**——「本行吃多少失衡易伤」，
 * 而这正是角色自己的战斗口径（明心境满易伤 / 雨果非轴白名单），却写死在编排层。
 *
 * ⚠ **两处的 `isAxis` 口径刻意不对称，不许顺手统一**（R14 分诊 §4.1 实测）：
 * `:567`（叶瞬光）**没有** `!isAxis` 项、`:570`（雨果）**有**。因为伤害池的
 * `else if (isAxis && axisSlots.has(slot))` 可能为假（轴模式下**未进轴的槽位**），
 * 此时 `isAxis === true` 也会落到本兜底臂 ⇒ 叶瞬光那一支在轴模式下仍会生效。
 * 统一两者 = 静默改行为。
 */
export interface AgentStunOverrideInput {
  /** 本模块角色所在槽位（编排层按注册表逐模块派发；槽位号 ≠ 数组下标，见规则 17） */
  slot: number
  /** 本行执行行的 moveId */
  moveId: string
  /**
   * **真·轴模式布尔** = 伤害池 `damagePool.ts` 的同名局部量
   * （CC-302：= 引擎 `CalcRoundResult.axisActive`，经 `useResourceCalc#axisMode`），口径与
   * `AgentAxisOverlayInput.isAxis` **逐字相同**（那边的不等价于 `axes.length > 0` 的论证同样适用）。
   *
   * ⚠ 它只说明「本帧是轴模式」，**不说明本行有没有被轴认领**——认领与否由伤害池的
   * `axisSlots` 链先判，本钩子只在链尾被问。故模块**不要**用 `isAxis` 反推「本行在轴内」。
   */
  isAxis: boolean
}

/**
 * 行级失衡易伤自报结果（`AgentMechanicModule.stunOverrideForMove` 的返回类型）。
 *
 * ⚠ `stunOverride: 0` 与「不认领（返回 null）」**语义不同**、不许互相代替：
 * 前者是明确声明「本行不吃失衡易伤」（雨果非白名单招），后者是「本模块不管本行，
 * 请伤害池回落全局覆盖率」。伤害池消费端据此分流（`stunOverride !== undefined` 三元，
 * `damagePool.ts:148-156`）——把 0 折成 null 会让雨果的非白名单行静默吃上覆盖率。
 */
export interface AgentStunOverride {
  /** 本行吃失衡易伤的比例 0-1（0 = 明确不吃、1 = 吃满） */
  stunOverride: number
  /** 行 note 追加段（空串 = 不加）。模块负责逐字给出，伤害池不做文案映射 */
  note: string
}

export interface AgentAxisOverlayInput {
  /** 本模块角色所在槽位（编排层按注册表逐模块派发；模块无需自己 findIndex） */
  slot: number
  /** 生效失衡轴（**判模式不要用它**——见 `isAxis`；本钩子只管轴内覆盖与同角色的非轴折算） */
  axes: DeepReadonly<StunAxis[]>
  cinemaLevel: number
  /** 倍率表访问（可琳等需要把普攻段归并到 'basic_attack' 聚合行键时查 basic 段 moveId） */
  getAgentSkills: (agentId: string) => { categories: { id: string; moves: { id: string }[] }[] } | undefined
  /**
   * **真·轴模式布尔** = 伤害池 `damagePool.ts` 的同名局部量
   * （CC-302：= 引擎 `CalcRoundResult.axisActive`，经 `useResourceCalc#axisMode`）。
   *
   * ⚠ **它不等价于 `axes.length > 0`**（2026-09-16 round 16 实测口径，设计卡 §16）：
   * `forceNoAxis` 轴退化时对外返回的 `resolvedAxes` 被清空为 `[]`（`convergence.ts:1422`），
   * 而 `effectiveStunAxes` 回落到 `configStore.stunAxes`（**用户手动轴，可能非空**）⇒
   * 存在第三态「`axes` 非空但 `isAxis === false`」。**必须用本字段判模式**，用 `axes.length`
   * 会让轴退化态静默走错支（扫描值 vs 折算值）。
   *
   * 反向蕴含成立：`isAxis === true` ⇒ `axes.length > 0`（引擎 `axisActive` 要求 `resolvedAxes.length > 0`，
   * 且非退化态下对外 `resolvedAxes` 即局部值）。
   */
  isAxis: boolean
  /**
   * 本槽角色**额外能力是否触发**（= 该槽 `damagePanels` 上 `additionalAbilityActive > 0`，
   * 与伤害池原来的 `(execPanel?.additionalAbilityActive ?? 0) > 0` **同源同值**）。
   *
   * 存在的理由：迁移前「额外能力未触发 ⇒ 本机制不参与」这条门控与 `agentId` 判据**同级写在伤害池**里。
   * 判据搬进模块后门控必须一起搬——**漏搬 = 轴内桶/折算值在额外能力未触发时静默生效**
   * （数值静默变大，既有测试不会红）。
   */
  additionalAbilityActive: boolean
  /**
   * 本槽的**队伍风化侵染覆盖率**（= `damagePanels` 上盖章的 `windInfectionRate`，队伍无风角色时 0）。
   *
   * 为什么不读 `cfg.panel`：`windInfectionRate` **不是** `computePanel` 的产物
   * （`computePanelPhases` 只写 `infectionZoneBonus`），它只由编排层 `useResourceCalc` 的
   * `damagePanels` computed 盖章。**2026-09-16 round 16 实测**：`cfg.panel.windInfectionRate`
   * 与 `computePanel().windInfectionRate` 双双为 `undefined` ⇒ 走 cfg 是**断路**
   * （R15 分诊把它标为「静态可达，未实测」，实测结论是**不可达**）。
   */
  windInfectionRate: number
  /** 已解析的机制滑块值（与 `AgentPanelInput.settings` 同源；非轴折算臂读它，缺省回落注册 default） */
  settings: Readonly<Record<string, number>>
}

/**
 * 模块私有的轴窗口 overlay（CC-437，设计稿 `docs/mcp-cc437-axis-overlay-opaque.md`）：
 * 编排层只按槽存取、**不解释内容**；只有产出它的模块会在 `directRowBonus` 里把它读回。
 * 形状由模块自己定义，经 `axisOverlayChannel<T>()` 收窄（wrap / read 两个零开销 cast）。
 *
 * 不变量（编排层保证，CC-17 起即成立）：`DirectRowBonusInput.overlay` 恒为**本行所属模块**在同帧
 * `axisWindowOverlays` 的返回或 undefined——所以模块内的 cast 是安全的。
 * 若将来出现「模块 A 的窗口要加成到模块 B 的行」（跨槽 overlay），不透明值做不到，应另开显式的跨角色
 * 供给钩子（`crossAgentSupply` 一族），不要回到共享命名桶。
 *
 * 历史（CC-17 2026-09-26 → CC-437 2026-10-03）：此前编排层把各模块的轴窗口结果合并成一张共享命名桶表
 * （`AgentAxisOverlays` 4 个 moveId 桶 + `AxisScalarOverlays` 5 个按槽标量）。CC-17 发现全局合并会让可琳扫除帮手
 * 经公共键 `'basic_attack'` 泄漏给队友轴内普攻行，改为**按槽归属**；CC-437 再把字段本身迁回各模块私有
 * （sigrid / peiluo / corin / banyue / yixuan 各自的 `XxxOverlay` + `xxxOverlay` channel），共享类型只剩这个 brand。
 * 「对本角色全部行同值、没有 moveId 可索引」的标量与「逐 moveId」的桶现在都在模块私有对象里并存，
 * 按槽归属由编排层 `collectAxisWindowOverlays` → `axisOverlayBySlot.get(本行 slot)` 保证。
 */
export type AgentAxisOverlay = { readonly [AXIS_OVERLAY_BRAND]: true }
declare const AXIS_OVERLAY_BRAND: unique symbol

/** 模块侧类型收窄助手：`wrap` 在 `axisWindowOverlays` 用，`read` 在 `directRowBonus` 用；建议导出供测试读返回值。 */
export function axisOverlayChannel<T>() {
  return {
    wrap: (v: T): AgentAxisOverlay => v as unknown as AgentAxisOverlay,
    // 测试读钩子返回时自己 `!` 掉 null（本文件按 noNullRoundCc418 锁不写 `| null`）
    read: (o: AgentAxisOverlay | undefined): T | undefined => o as unknown as T | undefined,
  }
}

/** transformAnomalyPool 钩子输入（calcAnomalyPool 内部，perElement 之前） */
/** 异常池钩子收到的身份（r399 CC-373）：`transformAnomalyPool` 与 `anomalyCorrosion` 共用。 */
export interface AnomalyHookSelf {
  slot: number
  /** `panelAt(panels, slot)`（`panels` 按位置压缩，不能按下标取）；面板缺失 ⇒ undefined */
  panel: DeepReadonly<PanelValues> | undefined
}

export interface AgentAnomalyTransformInput {
  /**
   * 本模块角色**自己那一槽**（r399 CC-373）：引擎只对**在队**模块派发本钩子，并按模块 `agentIds`
   * 定位槽位（`mechanics/registry.ts#teamMechanicSlots`）。原先引擎把钩子派给**全部已注册**模块，
   * velina / alice 只好在 `applyPanel` 往自己面板盖 `velinaEnabled` / `aliceEnabled` 标记、再扫 `panels`
   * 认回自己（同 r398 `ReleaseModifierInput.self` 修掉的那类 hack）；标记已删。
   */
  self: AnomalyHookSelf
  /** 已按元素分组的积蓄贡献（可变：模块可 push 新贡献） */
  elementMap: Map<string, AnomalyContribution[]>
  panels: DeepReadonly<PanelValues[]>
  bossCoeff: number
  anomalyCoeff: number
  enemyAnomalyResistances: Record<string, number>
  /** 队伍是否有风属性角色（乱流模式） */
  hasWindChar: boolean
  /** 引擎预算的非风元素触发总次数（turbulenceCount 上限前，供风蚀状态机等使用） */
  preTurbulenceCount: number
  /** 引擎预算的风元素触发次数（供风蚀状态机 windTriggerCount 参数） */
  preWindTriggerCount: number
  /** 单次积蓄计算函数（引擎注入，避免模块反向 import 引擎形成循环依赖） */
  calcPerHitBuildUp(baseBuildUp: number, panel: PanelValues, elementRes: number, element: string): number
}

/**
 * `nextRoundFeedback` 钩子输入 —— 本轮已收敛的**结果快照** + 上一轮线程 + 本轮 cfg（全部只读）。
 *
 * **唯一输出通道 = 返回值**（→ `threadsNext.moduleFeedback` → 下一轮 `applyTeamConfig(converge)` 读 `threads` 写 cfg）。
 * r397 CC-371：曾有 4 个模块在这里强转写回 cfg，经证实全是死写（本轮局部克隆、写后零读）已删；
 * `nextRoundFeedback.test.ts` 用深冻结输入调用**全部**已注册钩子，任何写入都会抛错。
 *
 * 与 `AgentTeamConfigInput` 的关系（为什么不能复用）：那个钩子的语义是「按相位写 cfg」，
 * 入参是**次数类标量**（exCounts/stunCount/combatTime）；本钩子的语义是「读本轮全队结果、
 * 算下一轮反馈」，入参必须是**本轮收敛结果本体**（资源结果 + 异常池），返回值还要参与
 * `threadsNext`。逐字段铺开会让契约随每个新反馈线性增长（同 `threads` 快照的理由），
 * 故这里递整份结果对象，模块自取。
 */
export interface AgentNextRoundFeedbackInput {
  /** 本模块角色所在槽位（编排层按槽位序逐模块派发；模块无需自己 findIndex） */
  slot: number
  /**
   * **本模块自己那份 cfg**（只读）。由派发器直接给（它正在遍历这个对象），模块**不要**用
   * `characters[slot]` 反查——`characters` 是**按位置压缩**的数组（`buildCharConfig` 跳过空槽），
   * 槽位号 ≠ 下标：前导空槽时 `characters[slot]` 会取到 `undefined` 或**别人那份 cfg**
   * （2026-09-16 实测：`['', 1041, 1191]` 时 1191 的 `characters[2]` 为 undefined）。
   */
  cfg: DeepReadonly<CharacterOperationConfig>
  /**
   * 本轮全队 cfg（只读）。这是 `runCalcRound` 从 `base.characters` 逐轮 spread 出的**本轮局部克隆**，
   * 钩子派发时本轮资源装配已结束 ⇒ 就算写进去也没有读者（r397 CC-371 实证，见 `docs/mcp-nextround-writeback.md`）。
   */
  characters: DeepReadonly<CharacterOperationConfig[]>
  /** 本轮装配后（`calcTeamResources` + `enrichExecutionPlan`）的全队资源结果 */
  teamResult: DeepReadonly<TeamResourceResult>
  /** 展示口径结果（`normalizeDisplayTime` 后，含赠链/赠大行）。**必填**（CC-436）：流水线恒传 `rrShown`，模块侧不再 `?? teamResult`。 */
  displayResult: DeepReadonly<TeamResourceResult>
  /**
   * 调整后结果（诺姆赠链 / 琉音转大落地后，伤害池与执行计划口径）。**必填、非 null**（CC-435）：
   * 流水线自 CC-422 起恒传 `adj2`（无调整时与 `teamResult` 同形），模块侧不再需要 `?? teamResult` 兜底。
   */
  adjustedResult: DeepReadonly<TeamResourceResult>
  /** 本轮异常池结果。无异常行队伍 = 合法空池（= `calcAnomalyPool` 跑空输入的结果），**不是 null**（CC-423 流水线层 / CC-434 契约层）。 */
  anomalyPool: DeepReadonly<AnomalyPoolResult>
  /**
   * **上一轮**收敛线程快照（只读）。两个用途：① 首轮守卫（`prev* <= 0` 才写 cfg）；
   * ② 自身反馈输入（如上一轮队友强特合计）。
   */
  prevThreads: Readonly<CalcRoundThreads>
  /** 战斗时间（秒）= 编排层 `base.totalTime`（= `enemy.battleTime`），与 `applyTeamConfig` 的 combatTime 同源 */
  combatTime: number
  /** 倍率表访问（零号·安比按 moveId 现场推断 `additionalAttack`，与伤害池 infer 同口径） */
  getAgentSkills: (agentId: string) => AgentSkills | undefined
}

/** 轴模式自动补齐的交互次数（保底语义：在用户输入之上补多少，不覆盖输入）。CC-23 自 banyue.ts 迁入 */
export interface InteractionTopUp {
  /** 弹刀（普通弹刀 parry）补齐次数：补喧响（+215/次） */
  parry: number
  /** 双反补齐次数：补嗔火（+10/次） */
  dual: number
  /** 本次补齐需要的原始动作时间（秒，未扣合轴）；调用方未提供单次时长时为 0 */
  requiredSeconds: number
  /** 补齐时间超过 AUTO_TOPUP_TIME_LIMIT_SEC → 本次补齐非法（次数已清零，轴应退化） */
  illegal: boolean
  /**
   * **割线步的读数存根**：本轮「已装刀数 → 该槽喧响」的那一格（2026-10-19）。
   *
   * 为什么挂在返回值上：模块是纯函数、不持有跨轮历史，而割线步要的是 `(applied[k-1], dec[k-1])`
   * 与 `(applied[k], dec[k])` 两个点。上一轮的 `dec` 在 `threads` 里没有独立字段
   * （`decibelRegenBySlot` 是**本轮写、下一轮读**的预算，不是上一轮读数）⇒ 由本字段随补齐量
   * 一起跨轮携带，`convergence.ts` 下一轮直接读它当「prev」，不另开线程字段。
   *
   * 缺省（老调用方 / 纯函数直调）= 不给 ⇒ 模块回落常数单价 301.35（逐位等于旧行为）。
   */
  measured?: { applied: number; next: number; decibelNow: number }
}

/** `computeInteractionTopUp` 能力入参（CC-23 自 banyue.ts `computeBanyueInteractionTopUp` 的 opts 迁入，字段逐字保留） */
export interface InteractionTopUpInput {
  dodgeCount: number
  parryCount: number
  blockCount: number
  dualCounterCount: number
  cinemaLevel: number
  /** 轴内捏的块次数（moveId → 次数，含连段块） */
  axisEx: Record<string, number>
  /** 轴内需要的终结技总次数（块 × 窗口数） */
  ultimateCountNeeded: number
  /** 保底怒相（嗔火）次数下界：需求 = max(轴内怒相需求, 此值)，供保底4嗔火开关 */
  minRageCount?: number
  /** 终结技喧响消耗（默认 3000） */
  ultimateCost: number
  /** 当前喧响供给（般岳个人；终结技次数 = 个人喧响 / 终结技消耗，非全队总和） */
  decibelHave: number
  /**
   * **秽盾破后送的闪能**（点 = `shieldCount × SHIELD_BREAK_GIFT`）。
   *
   * ⚠ **必须与 `computeBanyueRageCycle` 的闪能口径同源**：般岳的嗔火缺口按
   * `flashBase = 秒回×战斗时间 + 进场 + 秽盾` 算。补齐侧漏传 ⇒ 按**无盾**口径算出一个
   * **幻影嗔火缺口** ⇒ 补本不需要的交互（T162 实测：管线补 2 次弹刀、纯函数同参补 0 次，
   * 伤害 54.825M → 54.257M，打破 `topUpMonotonic`）。
   */
  shieldFlashGift?: number
  /** 单次补齐弹刀的原始动作时间（招架支援 + 支援突击，秒）；缺省 0 = 不做时间合法性判定 */
  perParrySeconds?: number
  /**
   * 单次补齐双反的原始动作时间（秒）；缺省 0 = 不做时间合法性判定（与 `perParrySeconds` 同款容错）。
   *
   * ⚠ T140a 前**无生产写点**（字段声明了但调用方一直没递）⇒ 双反需求算出来的 `requiredSeconds`
   * 只含弹刀，双反在时间面上完全不可见：既躲过 >200s 合法性判定，也躲过预算封顶
   * （实测 r=0.5/0.6：封顶对 `dual=12` 无感，轴退化判据读到的净占用低于真装量）。
   * 现由 `convergence.ts` 从 **catalog 动作时长**递入（`moveActionTimes`，单一事实来源，
   * 见 `utils/moveActionTimeCfg`）：双反 = 不动如山(1471011) + 支援突击：冲霄(1471029)，
   * 与本模块 `estimateExSpecialTime` 的 `blockDualTime` 同一对招式、同一份表。
   */
  perDualSeconds?: number
  /**
   * **最后一怒相窗口的闪能浪费**（点；缺省 = 模块声明的默认）。
   *
   * ⚠ **必须与 `computeBanyueRageCycle` 的闪能口径同源**（同 `shieldFlashGift` 的 T162 先例，规则 11）：
   * 补齐侧问的是「还差多少嗔火才够目标怒相数」，它内部要跑同一条嗔火固定点。漏传 ⇒ 补齐按**默认值**算、
   * 而账本按**用户填写值**算 ⇒ 用户填 0 时补齐算出一个**幻影嗔火缺口**、补本不需要的交互
   * （正是 T162「两套账」那类缺陷的形态）。由**模块自己**的能力包装器（`banyue.ts#computeInteractionTopUp`）
   * 从 `gate.settings` 读同一设置 id 后递入（设置 id 的家在模块，判据 26；编排层只递 `gate.settings` 事实），
   * 与账本路径的 `cfgNum(cfg, 'banyue.wastedFlash')` 同一 id。
   */
  wastedFlash?: number
  /** 战斗时间（秒，= `enemy.battleTime`）：闪能秒回按整场战斗折算（r726 前模块内写死 180） */
  battleTime: number
  /**
   * **本轮计划里已经装进去的弹刀补齐量**（= 上一轮 `threads.interactionTopUp.parry`）。
   *
   * ⚠ 为什么必须递：`decibelHave` 是**已经含**这 N 刀自己喧响的读数（补齐刀会产凶响、
   * 还会挤平A产凶响）。若缺口仍按「需求 − decibelHave」算 ⇒ **装得越多、算出的缺口越小**
   * ⇒ 反推不动（装 N → 算 0 → 再装 N）。T172 实测 `banyue-trigger-lucia` r=0.6 落进
   * `已装 1 → 算出 4` / `已装 4 → 算出 1` 的 2-环，而 taunt（后摇）只是改变环相位
   * ⇒ 外层「取最后一轮」选中不同成员 ⇒ 取消后摇反而掉伤害（用户 2026-10-19 报的那个现象）。
   *
   * 缺省 0 = 「假装计划里没有补齐」⇒ 与 T172 之前的行为**不同**（旧行为等价于恒按已装 0 算，
   * 因为缺口从不算净量）。编排层必须递真实值（见 `convergence.ts`）。
   */
  appliedParryCount?: number
  /**
   * **实测边际单价的两个读数对**（割线步；缺省 = 回落常数 `PARRY_TOPUP_DECIBEL_UNIT`）。
   *
   * 为什么需要它：常数单价 301.35 假设「每多装一刀 = 多 301.35 喧响」，而实测该边际
   * **随队塌缩到 0**（弹刀行被轴/交互预算钳住后，再多装刀也不产喧响）⇒ 常数单价给出
   * 「还缺 5 刀」的假缺口 ⇒ 「缺 ⇒ 装 ⇒ 不涨 ⇒ 还缺」的极限环。用实测 `Δ喧响/Δ弹刀`
   * 当分母即可让缺口算式与真实供给同量纲（`solveTeam.ts` 那条否决记录的末句药方）。
   *
   * `appliedPrev/decibelPrev` = **上一轮**的（已装刀数, 该槽喧响），`appliedNow/decibelNow` = **本轮**。
   * 由 `convergence.ts` 从 `prevInteractionTopUp` 与本轮 `rr.characters[slot].decibelSource.total` 填。
   */
  measuredParryUnit?: {
    appliedPrev: number
    decibelPrev: number
    appliedNow: number
    decibelNow: number
  }
}

/**
 * `computeInteractionTopUp` 能力的门控输入（CC-295）：是否补齐由**模块**判定（门控公式只在模块里写一份），
 * 编排层只递事实。`axisActive` = convergence 的 `axisActive`（与 `AgentTeamConfigInput.axis.active` 同源）；
 * `guarantee` = 保底开关快照（`guarantee.*` 不注册 MechanicSetting，理由见 `AgentTeamConfigInput.guarantee`）；
 * `settings` = `resolveMechanicSettings(configStore)`（与 applyTeamConfig 的 `settings` 同一函数）。
 */
export interface InteractionTopUpGate {
  axisActive: boolean
  guarantee: Readonly<{ fury: boolean; ultimate: boolean }>
  settings: Readonly<Record<string, number>>
}

/** `extraNecessaryAction` 能力返回值（CC-26）。moveId 为空 ⇒ 只预留时间、不补执行行（迁移前口径） */
export interface ExtraNecessaryAction {
  count: number
  moveId?: string
  moveName: string
  actionTime: number
  comboAlignRatio: number
  /** 单次喧响。undefined（CC-197）⇒ 行不写喧响字段，展示层 enrich 与账本 rowAccounting 均回落倍率表；显式 0 = 禁用 */
  decibelRecovery?: number
}

/** `anomalyEventRecords` 能力入参（CC-28） */
export interface AgentAnomalyEventRecordsInput {
  /** 本模块角色所在槽位 */
  slot: number
  /** 本槽面板（`panelAt(panels, slot)`；派发侧已按判据 17 取，缺失则不派发） */
  panel: PanelValues
  /** 槽位 0..2 的 agentId（空槽为 undefined 或 ''），仅供文案 */
  teamAgentIds: readonly (string | undefined)[]
  /** 异常池逐槽触发次数（`AnomalyPoolResult.perSlotAnomalyTriggers`，缺省 []） */
  perSlotAnomalyTriggers: readonly number[]
  /** 本槽命座（`configStore.team[slot].cinemaLevel ?? 0`；CC-29 简 6 命） */
  cinemaLevel: number
  /** 异常池逐属性触发次数（`AnomalyPoolResult.perElement` 按 element 取**首条** triggerCount；无该属性则缺键）（CC-29） */
  perElementTriggerCounts: Readonly<Partial<Record<string, number>>>
}

/**
 * 轴编辑器逐块标注（CC-48，`AgentMechanicModule.axisEditorBlockMarks` 的值类型）。
 * trigger = 触发块（自身不享受窗口）；active = 落在窗口内；layers = 层数（无层数概念的实现给 0）。
 */
export interface AxisEditorBlockMark {
  trigger: boolean
  active: boolean
  layers: number
}

/**
 * CC-65：角色专属计数输入框声明（见 `AgentMechanicModule.characterCountInputs`）。
 * mode 缺省 = 显示 `值 ?? 0`、清空写 0；
 * 'autoIfNonPositive' = 值 ≤0 显示为空（placeholder「自动」）、清空写 0；
 * 'autoNegOne' = 负值/缺省显示 -1、清空写 -1。
 */
export interface CharacterCountInputDecl {
  field: ActionCountField
  label: string
  /** 标签后的灰字提示（field-hint） */
  hint?: string
  /** 整个 field 的悬浮说明 */
  title?: string
  mode?: 'autoIfNonPositive' | 'autoNegOne'
}
// ---- CC-451（2026-10-04）：交互次数 store 原值快照契约，自 mechanics/types.ts 逐字迁入（钩子入参 AgentTeamConfigInput.interactions 的形状）----
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
 *   ② `parrySplit`（失衡四舍五入反推）：**改写**击破位/主C 的 `parryCount`（实测带叶释渊
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

// ---- 钩子的入参 / 返回形状（r732）：原先只在 AgentMechanicModule 里写成字面量，实现钩子的模块各抄一遍（判据 29 ③）。
//      语义见 types.ts 里对应钩子的注释；types.ts 原样转出，模块照旧从 '../types' 引用。

/** `resolveExecutionDamage` 的产出：本行改按的元素，及来源 / 说明（返回 null = 走通用规则） */
export interface AgentDamageResolution { element: string; source?: string; note?: string }

/** `releaseModifier` 的产出：异放限定的减抗 / 减防与说明 */
export interface ReleaseModifier { enemyResReduction: number; enemyDefReduction?: number; note: string }

/** 四种交互的次数（弹刀 / 闪反 / 格挡 / 双反）：角色声明的默认（`interactionDefaults`）与职业基准同一形状 */
export interface InteractionCounts { parry: number; dodge: number; block: number; dual: number }

/**
 * **交互爬升声明**（T173，用户口径 2026-10-15；见 `AgentMechanicModule.interactionClimb`）。
 *
 * ## 为什么需要它（与 `interactionDefaults` 的分工）
 *
 * `interactionDefaults` 只能表达「本角色会打哪些交互」+「从 0 爬到基准」。
 * 而仪玄的后台墨影凝云是另一种形态——用户逐字：
 * > 「**仪玄后台墨痕化形可以爬升，相当于白给的招式**，但注意**自动爬升上限是他已有后台的 50%**，
 * >   不能说他后台全都在合轴。**这个值也可以调整**。」
 *
 * ⇒ 它是「**相对已有量按比例放宽**」的旋钮，不是「绝对值从 0 爬到某数」。故单列一条声明通道。
 *
 * ## 契约（三条，缺一条会静默失效）
 *
 * 1. `field` 是**次数类** store 字段（`ActionCountField`）——爬升 = 逐档 `setActionCount`；
 * 2. `anchorOf(rr)` 读出**本轮**该角色的「已有量」（分母）。⚠ **必须按轮取**：它是收敛后的值
 *    （外层不动点每轮都可能变），构建期算一次会把上限钉死在首轮；
 * 3. `capOf(anchor, get)` 给出上限 = `floor(anchor × 比例)`，比例经 `get` 从**模块声明的
 *    MechanicSetting** 读——**默认值只写在模块 settings 里**（规则 11 / CC-508 单一来源），
 *    本契约不复制常量。
 */
/**
 * `AgentMechanicModule.interactionClimb` 的形状（契约三条见上方头注释）。
 *
 * ⚠ **T176 清理**：原同时导出一个 `InteractionClimbInput`（`{ rr; bySlot }`）——
 * 它**全仓零消费者**（`anchorOf(rr)` 直接收 `TeamResourceResult`，不需要那层包装），
 * 被 `deadChannelLs` 判为死导出 ⇒ 已删（规则 12：YAGNI，留着的"设计草稿形态"没人用就是负担）。
 */
export interface InteractionClimbDecl {
  /** 被爬升的次数字段（`ActionCountField`；⚠ 哨兵语义字段不得声明进来——`0` 与「不做」同义的字段爬了会改语义） */
  field: ActionCountField
  /**
   * **本轮已有量**（上限的分母）。参数是模块自己的结果行 `CharacterResourceResult`；
   * 模块查不到自己那份 ⇒ 返回 0（= 无已有后台 ⇒ 上限 0 ⇒ 不爬，语义即「没得爬」）。
   * ⚠ 用 `CharacterResourceResult` 而不是 cfg：已有量是**收敛后**的读数，cfg 上那份是输入。
   */
  anchorOf(rr: TeamResourceResult): number
  /**
   * **爬升终点上限**（该字段允许被写到的最大值，**含 anchor 本身**）：
   * 「自动爬升 ≤ 已有后台 × 比例」⇒ 返回 `anchor + floor(anchor × 比例)`。
   * 比例从 `get(settingId, default)` 读——**默认值只在模块 `settings` 声明里**（CC-508 单一来源）。
   */
  capOf(anchor: number, get: (settingId: string, fallback: number) => number): number
}

/** `expandAxisAction` 的入参（`actionTimeOf` 由编排层提供） */
export interface AgentAxisActionExpandInput {
  slot: number
  moveId: string
  count: number
  startTime: number
  cinemaLevel: number
  actionTimeOf: (moveId: string) => number
}

/** `selfBurnDecibel` 的入参（`providerUltCount` 的口径见钩子注释） */
export interface AgentSelfBurnDecibelInput {
  cfg: CharacterOperationConfig
  basicAttackTime: number
  exSpecialCount: number
  providerUltCount: number
}

/** `onFinalAssemble` 的入参（唯一调用方 = core，五个字段每次全传 ⇒ 必填） */
export interface AgentFinalAssembleInput {
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
}

/**
 * `promoteHugCounts` 的入参（r752 CC-535；原为四个位置参数）：赠大提供者「好评 → 60/90 转大次数」算法。
 * 不含 store 读取器：`resourceCalc/ultimatePromote.ts#promoteHugCountsOf` 派发时绑定。
 */
export interface PromoteHugInput {
  goodReviewTotal: number
  /** 失衡次数（不传 `targetChainCountTotal` 时也当连携窗口数） */
  stunCount: number
  /** 目标队友连携总数（60 转大吃的是它的连携窗口）；缺省 = 按失衡次数 */
  targetChainCountTotal?: number
  /** 60 档上限覆盖：只有轴模式传（轴声明的 60 抱拳次数）；缺省 = 提供者读自己的设置 */
  hug60Cap?: number
}
/**
 * **轴内角色专属资源的供给量**（T169，2026-10-15）：本槽在轴态可用于消耗该资源的**总量**（点）。
 *
 * 与 `combos[].swayCost` 配对使用：声明了消耗就必须声明供给（否则一律被门控跳过）。
 * 引擎只把它透传给 `stunAxisStack` 的 `swayBySlot`，不认识资源名（判据 26）。
 *
 * 般岳：供给 = 轴内连段块数推出的怒相需求 × 4 点山威（每进一次怒相 +4）。
 * ⚠ **无循环依赖**：连段块 `energyCost = 0`（耗山威）⇒「执行几块」不影响怒相数。
 * ⚠ **住本文件**：`types.ts` 有 1400 行上限（`typesSplitCc83.test`），新卫星类型按 CC-83 放这里。
 */
/**
 * 供给扫描只需要的「轴动作最小形状」——**不重抄 `ExecutedMoveCount`**（判据 29）：
 * 这里要的是**轴定义里的动作**（`slot`/`moveId`/`count`），与「已执行招式的计数」是不同含义的量。
 */
export interface AxisSwaySupplyAction {
  readonly slot: number
  readonly moveId: string
  readonly count: number
}

export interface AxisSwaySupplyInput {
  slot: number
  cfg: CharacterOperationConfig
  /**
   * 本轮生效轴（结构类型，不引 `types.ts#AgentAxisContext`——那会成环，
   * 且扫描算子 `forEachSlotAxisAction` 只要求 `{ axes, windows }` 两样）。
   */
  axis: {
    readonly axes: ReadonlyArray<{ readonly actions: ReadonlyArray<AxisSwaySupplyAction> }>
    readonly windows: ReadonlyArray<number>
    readonly actionCountsBySlot: Readonly<Record<number, Readonly<Record<string, number>>>>
  }
  /** T165 挤压臂本轮削减的「自动多打」份数（0 = 不削）——容量必须与账本同 trim，否则出幽灵块 */
  axisAutoTrim: number}

// ---- 模块「能力声明形状」（CC-83 第二批，2026-10-17）：原先是 `AgentMechanicModule` 里的内联字面量。
//      按判据 29③ 的口径起名——「两处以上的类型字面量彼此逐字段相同，又没有名字」时给它起名，
//      各处改成引用名字。这里六个形状**目前各只有一个声明方**，起名的直接收益是：
//      ① 消费方（门面 / 引擎执行器）能用名字标注，不再 `Parameters<NonNullable<...>>` 反推；
//      ② `AgentMechanicModule` 的成员注释不再被形状体撑开，接口读起来是「能力清单」而不是「形状仓库」。
//      ⚠ 低于判据 29③ 门槛的两个（`AxisRageCombos` / `ReleaseShareSpec`，各 2 成员）一并起名：
//      它们与其余四个同族（都是模块往接口上挂的声明），留着内联会让「哪些是形状、哪些是标量」看不出来。

/** `AgentMechanicModule.axisRageCombos`：轴编辑器「怒相连段块」comboId 声明（CC-59；展示层专用） */
export interface AxisRageCombos {
  /** 主连段 */
  readonly primary: string
  /** 与主连段共享配额、优先占用的变体连段 */
  readonly didong: string
}

/** `AgentMechanicModule.releaseShare`：异放占比可调声明（CC-55；展示层专用，不参与计算） */
export interface ReleaseShareSpec {
  /** 必须 == 本模块 dominant 异放事件 eventId 的首段（burnice_flowfire_release ⇒ 'burnice'） */
  readonly namespace: string
  /** 控件标题用的显示名（「<label>元素分配」「<label>·<元素>占比」） */
  readonly label: string
}

/**
 * `AgentMechanicModule.teammateDrop`：「每个队友可丢弃的 N 次资源」的队伍级设置声明（2026-10-18；展示层专用，引擎读同一键）。
 *
 * 用户口径：「丢弃开关也很粗糙，不做开关，需要改为丢弃部分，这样子剩余部分进入细致分配算法
 * 就会自动算出打的更少的子弹，实现部分丢弃。如果丢弃全部，进入这个算法也会实现丢弃全部。」
 * ⇒ 每个队友一个「丢弃次数」输入框，丢弃后的剩余次数才进分配 ⇒ 轮数/归属/浪费全自动跟着算。
 */
export interface TeammateDropSpec {
  /** 设置键前缀：键 = `${settingPrefix}:${队友槽位}`（getTeamMechanicSetting） */
  readonly settingPrefix: string
  /** 卡片标题 */
  readonly title: string
  /** 输入框后缀（如「次」） */
  readonly suffix: string
  /** 卡片说明 */
  readonly note: string
}


/** `AgentMechanicModule.axisGashResource`：轴编辑器「进轴残痕值」输入框的归属声明（2026-10-12；展示层专用） */
export interface AxisGashResourceSpec {
  /** 每层点数（克拉蕾 600），供 UI 把「点」换算成「层」显示 */
  perLayer: number
  /** 显示名 */
  label: string
  /**
   * **单次存量上限**（层数）——用户口径 2026-10-12：「单次积累上限1800，我只能1800进去。
   * 当然后面也能积攒出1800」⇒ 池满即溢出、消耗后可再攒满。
   * 展示层据它与 `perLayer` 算「起手值上限 = maxStacks × perLayer」，不经越层 import 取常量。
   */
  maxStacks: number
}

/**
 * `AgentMechanicModule.finalizePass`：**终局整数重推**（规则 6 引擎落点，2026-09-25 CC-6c；1531/1431/1051 先例）。
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
export interface FinalizePassSpec {
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

/**
 * 角色专属的**伤害公式字段**声明（2026-10-22，判据 22「角色知识回模块」）。
 *
 * 属性账要展示「这个角色特有的伤害乘区」（如蕾米的异化度 / 耀变倍率），
 * 但 `core/` 不许写死角色前缀字段 ⇒ 由角色模块自己声明，core 只提供注册表
 * （`core/damageFormulaFields#registerDamageFormulaFields`，经 `mechanics/index` 统一注册）。
 *
 * 注册后的字段会自动并入属性账的公式白名单（`isDamageFormulaStat`）。
 */
export interface DamageFormulaFieldDecl {
  stat: string
  /** 公式角色（与 core/damageFormulaFields#DamageFormulaRole 同值域） */
  role: '伤害基底' | '增伤区' | '暴击区' | '防御穿透区' | '抗性易伤区' | '失衡易伤区' | '异常乘区' | '异常时长'
  note: string
}
