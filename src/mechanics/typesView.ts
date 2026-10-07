/**
 * mechanics 卫星类型（CC-451，2026-10-04）：**展示层专用声明**——模块对外宣告「页面该怎么显示我」的契约形状，不参与计算。
 * 来源：CC-444 `poolSummary`（PoolSummary*）/ CC-445 `crossAgentEnergyLabels` / CC-446 `axisDurationInputs` / CC-448 `axisWindowLane` /
 * `resourceSections` 入参，陆续长在 `mechanics/types.ts` 里，把 CC-83 的 1400 行预算顶破（r484 CC-444 起 1418 → r488 1483，
 * 红了 15 小时没人跑全量）。自 types.ts 逐字拆出；types.ts 原样转出，导入方不用改。
 * 消费方：`composables/agentMechanicView.ts` 门面 + 各角色模块声明。
 * ⚠ 与 typesHooks.ts 的分界：typesHooks = 引擎钩子契约（禁 `| null`，CC-435）；本文件 = 展示层声明（允许 `| null`，页面侧本来就是三态）。
 */
import type { DeepReadonly } from 'vue'
import type { AnomalyPoolResult, CharacterResourceResult } from '@/types/resource'
import type { AxisEditorBlockMark } from './typesHooks'
/** CC-444：`poolSummary` 钩子的伤害池行子集（展示层 `DamagePoolRow` 的命名结构子集，mechanics 不 import composables） */
export interface PoolSummaryRowLike {
  agentId: string
  type: string
  count: number
  totalDamage: number
}
export interface AgentPoolSummaryInput {
  /** 全队伤害池行（含其他角色；模块按 agentId / type 自取） */
  damagePoolRows: ReadonlyArray<PoolSummaryRowLike>
  anomalyPoolResult: AnomalyPoolResult | null
  getMechanicSetting: (id: string, fallback: number) => number
}
export interface PoolSummaryStat {
  label: string
  value: string
  detail?: string
  /** 样式语义：highlight=主行 / bonus=加成行；缺省普通行 */
  tone?: 'highlight' | 'bonus'
}
export interface PoolSummarySection {
  title: string
  stats: PoolSummaryStat[]
}
/** CC-445：跨角色回能来源展示标签（键 = `CrossAgentEnergy.bySource` 的展示键） */
export interface CrossAgentEnergyLabel {
  key: string
  label: string
  detail?: string
}
/** CC-446：轴编辑器已放置块的时长输入声明（见 `AgentMechanicModule.axisDurationInputs`） */
export interface AxisDurationInputDecl {
  /** 输入框前缀文字（如「蓄力」） */
  label: string
  /** 悬浮说明 */
  title: string
  min: number
  max: number
  step: number
  /** 清空 / 未设置时的取值；须与引擎侧 `duration` 缺省同源 */
  default: number
}
/** 轴编辑器窗口 lane 声明函数的上下文（lane 拥有者槽位的影画等级） */
export interface AxisWindowLaneCtx { cinemaLevel: number }
/**
 * CC-448：轴编辑器「专属窗口 lane」完整声明（展示层专用，不参与计算；见 `AgentMechanicModule.axisWindowLane`）。
 * CC-62 只声明了种类，banner / 窗长 / 触发判定 / 文案留在 StunAxisPage 按种类分支；两条 lane 后页面成了两份平行副本
 * （般岳明王 / 仪玄凝神各一套 slot/blocks/tag/windowsFor），且仪玄触发判定写死 1371014/1371020 字面量。
 * 现改为页面只跑一份泛型 lane 渲染，所有按角色不同的东西都从本声明取。
 */
export interface AxisWindowLaneDecl {
  /** 种类 id（lane 种类键；`teamAxisWindowLanes` 的结果按 `decl.kind` 区分） */
  kind: string
  /** lane 左侧名字（「明王」「凝神」） */
  name: string
  /** 轴列表上方说明条 */
  banner(ctx: AxisWindowLaneCtx): string
  /** 一次触发的窗口长度（秒），窗口条宽度 = windowSeconds / 失衡窗口 */
  windowSeconds: number
  /** 该块是否触发块（窗口条起点；只在拥有者槽位的块上调用） */
  isTriggerBlock(act: { readonly moveId: string }, ctx: AxisWindowLaneCtx): boolean
  /** 返回文案 ⇒ 整条 lane 铺满、不画窗口条、不打块标（般岳 6 命「满覆盖 +39%」）；缺省 / null ⇒ 正常窗口 */
  fullCoverage?(ctx: AxisWindowLaneCtx): string | null
  /** 窗口条文字 / 样式（mark = 触发块的 `axisEditorBlockMarks` 扫描结果，可能缺省） */
  window(mark: AxisEditorBlockMark | undefined): { label: string; cls: string }
  /** 块上徽标（mark 为该块的扫描结果；null ⇒ 不打） */
  blockTag(mark: AxisEditorBlockMark): { text: string; cls: string } | null
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
