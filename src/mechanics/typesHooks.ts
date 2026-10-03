/**
 * mechanics 卫星类型：跨槽供给、失衡覆盖、轴 overlay、异常池变换、下一轮反馈、交互补齐、必做动作、异常事件记录、轴编辑标记、次数输入声明。
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
 * 轴窗口覆盖结果：四个**按 moveId 索引**的桶（与 `DamagePoolContext` 同名）+ 一个**按槽位索引**的标量表。
 *
 * 四个桶的数值语义：
 * - `banyueMingwangStacks`：moveId → 明王层数（消费端 × MINGWANG_BASE_PER_STACK）
 * - `yixuanNingshenMap`：moveId → { critDmg, sheerDmg }
 * - `peiluoKagerouMap`：moveId → 阳炎暴伤（0-40）
 * - `corinStunBonusMap`：moveId → 扫除帮手增伤%（轴内恒 CORIN_ADDITIONAL_DMG）
 *
 * ⚠ **CC-17（2026-09-26）起四个桶不再跨模块合并**：`panelPhases.ts#collectAxisWindowOverlays`
 * 改为 `bucketsBySlot: Map<slot, AgentAxisOverlays>`，消费端（`directRowBonus`）只读**本行所属槽**
 * 的桶。**原注释「moveId 全局唯一所以不会串味」已被证伪**：所有角色的普攻聚合行 moveId 都是
 * `'basic_attack'`，而可琳 `corinStunBonusMap` 正是把平A块归并到该键 ⇒ 旧实现（全局桶）会把
 * 可琳扫除帮手 +35% 泄漏给队友的轴内 `basic_attack` 行（设计稿 `docs/mcp-cc17-axis-overlay-consume.md`
 * §2 已实测）。按槽归属后此泄漏面消失；`scalarBySlot` 的按槽口径不变。
 *
 * 新增字段仍遵循：只要值对「全角色全部行」同值（没有 moveId 可索引），就必须走 `scalarBySlot`。
 */
export interface AgentAxisOverlays {
  banyueMingwangStacks?: Map<string, number>
  yixuanNingshenMap?: Map<string, { critDmg: number; sheerDmg: number }>
  peiluoKagerouMap?: Map<string, number>
  corinStunBonusMap?: Map<string, number>
  /**
   * **按槽位索引的标量覆盖**（与四个「按 moveId 索引」的桶并列）。
   *
   * 存在的理由：非轴折算臂与「与轴模式无关的标量臂」的值对**该角色的全部行同值**，没有 moveId 可索引；
   * 若像四个桶那样合并成一个裸标量，**队友行也会读到它**（静默把本角色的增伤泄漏给全队，
   * 且 `damagePoolAdditionalAbilityGate.test.ts` 的反锁会红 —— 这条是 2026-09-16 round 16 设计时
   * 发现的真实泄漏面，四个桶不受影响是因为 moveId 全局唯一）。
   */
  scalarBySlot?: Map<number, AxisScalarOverlays>
}

/**
 * 单槽位的**标量**覆盖（`AgentAxisOverlays.scalarBySlot` 的值类型）。
 *
 * 每个字段的**写入方唯一 = 对应角色模块** ⇒ 「字段存在」即蕴含「是本角色」（判据同 T6）。
 * 所有字段都只在模块自己的参与门控（额外能力/命座/轴模式）通过时才写。
 */
export interface AxisScalarOverlays {
  /** 般岳明王·**非轴折算臂**：百分比 = `MINGWANG_BASE_PER_STACK × 3 × 覆盖率滑块` */
  banyueMingwangPct?: number
  /** 可琳扫除帮手·**非轴折算臂**：百分比 = `CORIN_ADDITIONAL_DMG × 覆盖率滑块` */
  corinStunBonusPct?: number
  /**
   * 仪玄凝神。两个来源共用本字段（消费端同形同义，故不拆）：
   * - **C6 满覆盖臂**（不分轴/非轴，优先于轴臂）：`{ critDmg: round(40×c6滑块), sheerDmg: round(20×c6滑块) }`
   * - **非 C6 非轴折算臂**：`{ critDmg: round(40×覆盖率滑块), sheerDmg: 0 }`（贯穿只由 C6 给）
   *
   * ⚠ 与 `yixuanNingshenMap` 桶的**分工**：非 C6 **轴**模式仍走桶（逐 moveId 扫描值），
   * 本标量只覆盖「对本槽全部行同值」的两臂（见本接口头注释的泄漏论证）。
   */
  yixuanNingshen?: { critDmg: number; sheerDmg: number }
  /**
   * 佩洛伊斯阳炎·**非轴折算臂**：百分比 = `PEILUO_KAGEROU_CRIT × 覆盖率滑块`（0-40）。
   *
   * ⚠ **为什么是标量**：非轴臂的算式是 `40 × 覆盖率 × 配对比例`，其中**配对比例是行级的**
   * （只有决算 `1551016` 乘 `min(上分支,决算)/决算`，其余行恒 1）。配对比例由模块自己写在
   * 该行的 `peiluoKagerouPairRatio` 上（`patchExecutions`），消费端读行取用 ⇒ 本标量只需承载
   * 「与行无关的那一半」（`40 × 覆盖率`），标量 × 行级比例即得原式。
   *
   * ⚠ 与 `yixuanNingshen`/`banyueMingwangPct` 一样是「对本槽全部行同值」⇒ 必须走 `scalarBySlot`。
   * 消费端只在**非轴**模式读它（轴模式仍走 `peiluoKagerouMap` 桶）。
   *
   * ⚠ 参与门控 = **仅「本模块被派发」（= 1551 在队）**，**不**门控 `additionalAbilityActive`——
   * 阳炎出自**核心被动**（上分支终结技），不是额外能力（`PEILUO_KAGEROU_CRIT` 头注释）。
   * 逐位保留原伤害池行为（原式除 agentId 外无参与门控）。
   */
  peiluoKagerouPct?: number
  /** 希格莉德浸染增伤（**与轴模式无关**）：百分比 = `SIGRID_INFECTION_DMG × 队伍风化侵染覆盖率` */
  sigridInfectionPct?: number
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
  /** 风属性角色槽位 */
  windCharSlot: number
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
  /** 展示口径结果（`normalizeDisplayTime` 后，含赠链/赠大行）；缺省 = 与 teamResult 同源 */
  displayResult?: DeepReadonly<TeamResourceResult>
  /** 调整后结果（诺姆赠链 / 琉音转大落地后，伤害池与执行计划口径）；null = 本轮无调整 */
  adjustedResult?: DeepReadonly<TeamResourceResult> | null
  /** 本轮异常池结果。无异常行队伍 = 合法空池（`core/anomalyPool#emptyAnomalyPool` 同形），**不是 null**（CC-423 流水线层 / CC-434 契约层）。 */
  anomalyPool: DeepReadonly<AnomalyPoolResult>
  /**
   * **上一轮**收敛线程快照（只读）。两个用途：① 首轮守卫（`prev* <= 0` 才写 cfg）；
   * ② 自身反馈输入（如上一轮队友强特合计）。
   */
  prevThreads: Readonly<CalcRoundThreads>
  /** 战斗时间（秒；已含 `?? 180` 兜底，与 `applyTeamConfig` 的 combatTime 同源） */
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
  /** 单次补齐弹刀的原始动作时间（招架支援 + 支援突击，秒）；缺省 0 = 不做时间合法性判定 */
  perParrySeconds?: number
  /** 单次补齐双反的原始动作时间（秒）；cfg 暂未暴露该字段时留 0 */
  perDualSeconds?: number
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
