export type SpecStatus =
  | 'implemented'
  | 'implemented_approximation'
  | 'partially_implemented'
  | 'not_described_not_implemented'

export interface AttributeConversionSpec {
  id: string
  name: string
  sourceStat: string
  sourceValue?: 'panel' | 'energyRegenTotal' | 'energyRegenOutOfCombat'
  sourcePanelPhase: 'outOfCombat' | 'inCombat'
  threshold: number
  stepSize: number
  targetStat: string
  valuePerStep: number
  cap: number | null
  coverage?: number
  status: SpecStatus
  note: string
}

export type ResourceNature = 'resource' | 'state_machine' | 'buff' | 'event' | 'formula' | 'custom'

export interface ResourceRuleSpec {
  id?: string
  trigger: string
  amount?: string | number
  amountPerCount?: number
  count?: number
  countSource?: 'exSpecialCount' | 'energySpent' | 'ultimateCount' | 'basicTime' | 'frontlineTime' | 'backstageTime' | 'battleTime' | 'chainCountTotal' | 'dodgeCounterCount' | 'parryCount' | 'blockCount' | 'quickAssistCount' | 'teamFrontlineSeconds' | 'fixed' | 'teamAssaultCount' | 'disorderCount' | 'frostburnBreakCount' | 'basicAttackCount' | 'baseSparkCount' | 'totalSparkCount' | 'cfgField'
  /** countSource='cfgField' 时读取的 cfg 字段名（模块写入，如星徽·比利招式命中决意合计） */
  countField?: string
  valueSource?: 'fixed' | 'cfgField'
  valueField?: string
  cost?: string | number
  result?: string
  formula?: string
  coverage?: number
  deduct?: boolean
  bonusEnabledField?: string
  bonusCountSource?: 'ultimateCount'
  /** 近似量可调：资源利用率页显示滑块，值以 0-1 比例存（1=100%） */
  adjustable?: {
    id: string
    label: string
    description: string
    default: number
    min?: number
    max?: number
    step?: number
    suffix?: string
  }
  status: SpecStatus
  note?: string
}

export interface ResourceSpec {
  id: string
  name: string
  nature: ResourceNature
  initialValue?: number
  initialValueSource?: 'fixed' | 'cfgField'
  initialValueField?: string
  maxValue?: number | null
  gainRules: ResourceRuleSpec[]
  spendRules: ResourceRuleSpec[]
  feedbackGainRules?: ResourceRuleSpec[]
  properties: Record<string, string | number | boolean | null>
}

export interface RowFusionSpec {
  id: string
  name: string
  agentId: string
  moveId: string
  rowId: string
  multiplier: number
  enabled: boolean
  status: SpecStatus
  note: string
}

export interface EventSpec {
  id: string
  name: string
  trigger: string
  formula?: string
  eventType?: 'special_voidflare' | 'luminize' | 'release' | 'polar_disorder' | 'polar_assault' | 'direct_damage' | 'other'
  /** anomaly=仅异常事件记录；execution=生成实际招式执行（调用倍率表行） */
  executionKind?: 'anomaly' | 'execution'
  countSource?: 'exSpecialCount' | 'ultimateCount' | 'broadCycloneCount' | 'aliceSparkCount' | 'fixed' | 'resourceSpend'
  /** count 的动态来源：模块通过 counts 上下文传入的 key */
  countField?: string
  count?: number
  carrierMoveId?: string
  carrierField?: string
  carrierMoveName?: string
  /** 调用倍率表的哪一行（默认 damage） */
  multiplierRowId?: string
  /** 调用倍率时的缩放系数（如风炮 = 起风倍率 × 0.3） */
  multiplierRatio?: number
  enabledField?: string
  fields?: string[]
  status: SpecStatus
  note?: string
}

export interface VerificationSpec {
  id: string
  name: string
  /** 执行性校验的面板输入；缺省（无 panel/expected）视为文档型已确认记录，运行器跳过 */
  panel?: Record<string, number>
  expected?: Record<string, number>
  tolerance?: number
  status: SpecStatus
}

export interface TeamBuffEffectSpec {
  id?: string
  type?: 'fixed' | 'derived' | 'stacked' | 'formula'
  stat: string
  value?: number
  mode?: 'flat' | 'pct'
  sourceStat?: string
  sourcePanelPhase?: 'outOfCombat' | 'inCombat'
  ratio?: number
  cap?: number
  formula?: { expression?: string; valueUnit?: string }
  targetSkillType?: string
  note?: string
}

export interface TeamBuffSpec {
  id: string
  name: string
  source: string
  description: string
  target: 'team' | 'enemy' | 'both'
  coverage: number
  effects: TeamBuffEffectSpec[]
  status: SpecStatus
  note?: string
}

export interface CounterStateMachineOutput {
  id: string
  kind: 'micro' | 'broad' | 'boosted' | 'refund'
}

export interface CounterStateMachineSpec {
  id: string
  name: string
  initialValue: number
  maxValue: number
  spendThreshold: number
  gainPerEvent: number
  refundPerSpend: number
  outputs: CounterStateMachineOutput[]
  note?: string
}

/** 额外能力/条件触发的队伍条件（声明式）：满足任一条件即触发 */
export type TeamConditionSpec =
  | { type: 'specialty'; values: string[]; excludeSelf?: boolean }
  | { type: 'sameFactionAsSelf' }
  | { type: 'sameAttributeAsSelf' }
  | { type: 'sameSpecialtyAsSelf' }

export interface AdditionalAbilitySpec {
  /** 触发条件（满足任一即触发） */
  teamConditions: TeamConditionSpec[]
  /** 触发后的效果描述 */
  note?: string
}

export interface AgentMechanicSpec {
  schemaVersion: 1
  id: string
  name: string
  agentIds: string[]
  status: SpecStatus
  attributeConversions: AttributeConversionSpec[]
  resources: ResourceSpec[]
  rowFusions: RowFusionSpec[]
  events: EventSpec[]
  verifications: VerificationSpec[]
  stateMachines: CounterStateMachineSpec[]
  teamBuffs?: TeamBuffSpec[]
  /** 额外能力触发条件（声明式，引擎统一判定，满足才生效） */
  additionalAbility?: AdditionalAbilitySpec
  notes: string[]
}
