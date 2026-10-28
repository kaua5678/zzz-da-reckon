/**
 * 收敛轮输入 helpers（CC-11a 2026-09-25 自 `convergence.ts` 原样迁入；此前 #10 自 useResourceCalc 迁入 convergence）。
 *
 * 为什么建：评审 #10 =「把编排巨函数里的收敛域代码搬进 `resourceCalc/convergence.ts`，给 agentId 特判一个落点」。
 * 本文件先收**轮输入簇**（提取器/风与爱丽丝检测/异常池入参/自动轴解析/栈轴构建/次数展开——runCalcRound 的
 * 前置材料，共 ~260 行）；`runCalcRound`/`runOuterLoop` 本体因闭包面 33 个外层名（含可变 let）需 **ctx 设计**
 * 分轮再搬（设计要点见 .claude 账本），不盲搬。
 *
 * 形态：工厂函数（**每组件实例一份**——簇里有 computed，模块级创建会成单例泄漏）；
 * deps 注入的是 store 实例与 computed ref 本体（响应性、求值时机与迁移前一致）；
 * 成员函数名与外层解构名一致 ⇒ 调用方除 import + 一次工厂调用外**零改动**。
 *
 * 行为锚判据：timeGolden / timeFillRatchet delta=0（规则 10）。
 */
import { computed, type ComputedRef } from 'vue'
import type { ConfigModel } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { calcAnomalyPool } from '@/core/anomalyPool'
import type { AnomalySkillExecution } from '@/core/anomalyPool/helpers'
import type { AnomalyPoolResult } from '@/types/resource/pools'
import type { StunSkillExecution } from '@/core/stunPool'
import type { StunAxis, ResourceCalcConfig, TeamResourceResult } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import { AXIS_BASIC_UNIT_SECONDS } from '@/core/stunAxis'
import type { ExecutedMoveCount, StackActionCost, StackAxisInput, StackSequenceEntry } from '@/core/stunAxisStack'
import { axisKindOf, allocateAxisWindows } from '@/core/stunAxisStack'
import { resolveStunAxisPlan, autoStunAxisPresetOf, cloneStunAxes } from '@/data/stunAxisPresets'
import { AUTO_AXIS_PRESET_HINTS, getAgentMechanic, teamMechanicSlots } from '@/mechanics'
import { extractSkillExecutions, axisMoveEndsStunWindow, axisMoveActionTimeOf, axisMoveFreeOfDecibelOf } from './helpers'
import { findMoveById, fusedRowReader } from '@/data/moveTableQueries'
import { findChainAttack } from '@/core/resource/moveLookup'
import { supplyTargetTeamSlot } from '@/core/resource/crossAgentSupply'
import { findWindSlot } from './anomalyPanels'
import { chainMoveKind } from '@/data/chainMoveKind'
import { movePerformanceGroupOf } from '@/data/movePerformanceGroups'
import { ULTIMATE_COST_DEFAULT } from '@/data/resourceDefaults'
import { parseMoveEnergyCost } from '@/core/resource/moveLookup'
import { panelAt } from '@/core/panel'

/**
 * 赠品连携族（诺姆膛温换连携）：**一次失衡 0~1 个**（用户口径 2026-10-27）——
 * 「诺姆的资源短时间内不可能回复那么多……如果前面有赠品连携了，这次失衡的后面兜底部分就不让放，
 * 因为一个轴内总量不大于 1」。族的判定在引擎（`stunAxisStack#StackActionCost.fillFamily`），
 * 这里只给两种轴块形态（`:gift` 与旧 `norma-hat-chain`）打上同一个族名。
 */
const GIFT_CHAIN_FAMILY = 'gift-chain'
const GIFT_CHAIN_PER_WINDOW = 1

type StunAxisAction = StunAxis['actions'][number]
type AxisOwnerCatalog = Pick<ReturnType<typeof useCatalogStore>, 'agentSkillsByAgentMap'>

/**
 * 兜底池（2026-10-27）的资源读数：`expandBasicFill` 钩子的可选入参来源。
 *
 * 三个量都取自**本轮引擎结果**的同一角色切片（`CharacterResourceResult`），字段语义见
 * `mechanics/typesHooks.ts#BasicFillInput`。全字段可选 ⇒ 调用方没有该读数时不传，
 * 钩子据此区分「没有读数」与「读数为 0」。
 */
export interface FillResourceBudget {
  /** `CharacterResourceResult.energySource.total`（闪能总量） */
  energy?: number
  /** `CharacterResourceResult.decibelSource.total`（喧响总量） */
  decibel?: number
  /** `CharacterResourceResult.executedExSpecialCount`（本轮真打出来的强特次数） */
  exSpecial?: number
  /**
   * **本槽本轮真物化出来的招式次数**（moveId → Σcount，含连段展开前的行）——兜底池的**硬上界**。
   *
   * 为什么放在引擎侧而不是让模块自己猜：钩子能返回任何 moveId，但**只有真的出行才产生伤害**。
   * 认领一个没有行的招式不会加伤，却会让引擎把这部分秒数记成「已认领」⇒ 该归平A的窗尾秒数蒸发。
   * 故引擎按本表**逐招夹紧**，并把夹掉的秒数**退回平A**（退化口径），模块不必自己算上限。
   * `basic` 是秒数伪键，不查本表。
   */
  executed?: Readonly<Record<string, number>>
}

/** 该角色能否把这个轴动作解析成自己的东西：连段 / 招式表 / 模块轴块展开（与 buildStackAxes 的解析链同序） */
function axisActionResolvableBy(agentId: string, act: StunAxisAction, catalog: AxisOwnerCatalog): boolean {
  if (!agentId) return false
  const mod = getAgentMechanic(agentId)
  if (mod?.combos?.[act.moveId]) return true
  const skills = catalog.agentSkillsByAgentMap.get(agentId)
  if (findMoveById(skills, act.moveId)) return true
  return !!mod?.expandAxisAction?.({
    slot: act.slot, moveId: act.moveId, count: act.count, startTime: act.startTime ?? 0, cinemaLevel: 0,
    actionTimeOf: id => findMoveById(skills, id)?.actionTime ?? 0,
  })
}

/**
 * CC-389 残留判据（保守）：本槽当前角色解析不了，**且**能证明属于另一个角色 ⇒ 残留（换人后留在轴上的别人的动作）。
 * 谁都不认领的 id 维持原口径不丢——模块合成行（雨果 `1291_ultimate_verdict_bonus`、`miyabi_frostburn_break` 等）
 * 与通用 `evade_assist` 不在招式表里，按「本人能否解析」判会误杀（r415 探针：编辑器可放置的 492 个块里 7 个如此）。
 * `basic` / `norma-hat-chain` 是位置性标记块，不属于任何角色。锁：`composables/__tests__/staleAxisActionCc389.test.ts`。
 */
export function isStaleAxisActionFor(
  act: StunAxisAction,
  team: ReadonlyArray<{ agentId?: string | null } | null | undefined>,
  catalog: AxisOwnerCatalog,
): boolean {
  if (act.moveId === 'basic' || act.moveId === 'norma-hat-chain') return false
  const own = team[act.slot]?.agentId ?? ''
  /**
   * T178（用户裁决 2026-10-16）：**本角色声明不用失衡内轴 ⇒ 落在它槽里的轴块一律丢弃**。
   * 用户逐字：「因为我已经捏了他的3种强化状态的流程了。**失衡次数是用来计数连携的**。
   * 所以她已经有自己的所谓爆发轴了。**可以禁止她用失衡内的轴**」。
   * 现唯一声明者 = 叶瞬光 1431（`yeshuguang.ts#axisExcluded`）。
   * 走本函数 = 复用既有的「残留块丢弃」通路（UI 标灰 + 引擎不执行），无需新机制。
   */
  if (own && getAgentMechanic(own)?.axisExcluded) return true
  if (axisActionResolvableBy(own, act, catalog)) return false
  for (const other of catalog.agentSkillsByAgentMap.keys()) {
    if (other !== own && axisActionResolvableBy(other, act, catalog)) return true
  }
  return false
}

export function createConvergenceRoundInputs(deps: {
  configStore: ConfigModel
  catalogStore: ReturnType<typeof useCatalogStore>
  panels: ComputedRef<PanelValues[]>
  resourceConfig: ComputedRef<ResourceCalcConfig | null>
}) {
  const { configStore, catalogStore, panels, resourceConfig } = deps

  /**
   * 从某个资源池结果按槽位提取 execs（异常 + 失衡一次拿齐）；`skipGift` = 只取「装配前」口径（赠行单独结算）。
   * CC-491 前异常/失衡各写一遍同一个循环（含判据 17 注释）。
   */
  function extractExecsFrom(res: TeamResourceResult, skipGift = false): { anomalyExecs: AnomalySkillExecution[]; stunExecs: StunSkillExecution[] } {
    const anomalyExecs: AnomalySkillExecution[] = []
    const stunExecs: StunSkillExecution[] = []
    for (let i = 0; i < 3; i++) {
      const char = configStore.team[i]
      if (!char?.agentId) continue
      const skills = catalogStore.agentSkillsByAgentMap.get(char.agentId)
      // ⚠ 判据 17：`i` 是 **team** 下标（该数组稠密、按槽位排列），而 `panels.value` **按位置压缩**
      // （空槽不 push）⇒ `panels.value[i]` 在前导/中间空槽时取到**别人那份**面板
      // （实测 `[空,1581,1031]`：i=1 时 team[1]=1581，而 panels.value[1] 盖章 slot 2）。
      // 故必须 `panelAt` 按盖章身份取。2026-09-18 round 21 夜发现并修复。
      const one = extractSkillExecutions(i, char.agentId, skills ?? undefined, res, catalogStore, panelAt(panels.value, i) ?? null, configStore, { skipGift })
      anomalyExecs.push(...one.anomalyExecs)
      stunExecs.push(...one.stunExecs)
    }
    return { anomalyExecs, stunExecs }
  }

  /** 异常 execs（见 extractExecsFrom） */
  function extractAnomalyExecsFrom(res: TeamResourceResult, skipGift = false): AnomalySkillExecution[] {
    return extractExecsFrom(res, skipGift).anomalyExecs
  }

  /** 失衡 execs（见 extractExecsFrom） */
  function extractStunExecsFrom(res: TeamResourceResult, skipGift = false): StunSkillExecution[] {
    return extractExecsFrom(res, skipGift).stunExecs
  }

  /** 风属性检测（复用；判据唯一实现 = `findWindSlot`） */
  const windInfo = computed(() => {
    const slot = findWindSlot(configStore, catalogStore)
    return { hasWindChar: slot >= 0, windCharSlot: slot }
  })

  /** 异常池入参设置（CC-25 自 aliceInfo 改名；目前唯一提供方 = 爱丽丝模块 `anomalyPoolSetup`）：仅承载与 resourceResult 无关的畏缩结算配置。
   *  极性强击赠送计数不在此读——本 computed 读 resourceResult（= calcOutput.value.resourceResult）
   *  会在 calcOutput 自身求值内构成循环依赖（首算恒读空，曾致极性强击行整行缺失），
   *  由 calcAnomalyPoolInput 的 giftedPolarAssaultOverride 注入本轮资源结果。 */
  const anomalyPoolSetupInfo = computed(() => {
    // ⚠ **本行的「循环依赖」只与读 `resourceResult` 有关，与身份查找无关**（2026-09-17 夜间批 B 实测澄清）：
    // 头注释那条禁令针对的是 `aliceSlotOf(rr)` / `aliceSparkCountOf(rr)` 那族**读资源结果**的模块 helper
    // （`aliceSlotOf` 从 `rr.characters` 数槽位 ⇒ 在 `calcOutput` 自身求值内读它会首算恒空）。
    // 本行的输入只有 `configStore` + `catalogStore` 两个 store（均在本工厂的 deps 里、与 `calcOutput` 无关），
    // 故走 `findSlotByIdentity` 是**同一表达式**、不引入任何对 `resourceResult` 的读 ⇒ 不成环。
    // 判据：`convergenceNightB.test.ts` 的等价性 oracle + 前导空槽实算（爱丽丝在槽 2 仍解析出 slot）。
    // CC-25：找槽改为「第一个挂了 anomalyPoolSetup 能力的槽位」（原按身份 `findSlotByIdentity(…, ['1401'])`；
    // 输入仍只有两个 store + resourceConfig ⇒ 不读 resourceResult ⇒ 不成环，上面那条澄清照样成立）。
    const slot = configStore.team.findIndex(c => c.agentId && getAgentMechanic(c.agentId)?.anomalyPoolSetup)
    if (slot < 0) return null
    const setup = getAgentMechanic(configStore.team[slot].agentId)?.anomalyPoolSetup
    // ⚠ 按**身份**查（`.find(c => c.slot === …)`），不用 `characters[slot]` 下标：该数组按位置
    // 压缩（`buildCharConfig` 跳过空槽），前导/中间空槽时 `characters[slot]` 取到 undefined
    // ⇒ `aliceEnabled` 读不到 ⇒ 整个 setup 静默返回 null（畏缩 DOT 配置整块丢失）。
    const cfg = resourceConfig.value?.characters.find(c => c.slot === slot)
    if (!cfg || !setup) return null
    const res = setup(cfg)
    return res ? { slot, ...res } : null
  })

  /**
   * 构建积蓄池（参数化 stunCoverage + 异常 execs）。恒返回 AnomalyPoolResult：
   * CC-423 删除原 `if (execs.length === 0) return null`——calcAnomalyPool 对空 execs 返回合法空池
   * （perElement [] / 触发 0 / perSlotBonus 全 0 / coverage 全 0），空集不是整池缺失（CC-417 同型）。
   */
  function calcAnomalyPoolInput(stunCov: number, execs: AnomalySkillExecution[], giftedPolarAssaultOverride?: number, giftedSlotFallback?: number): AnomalyPoolResult {
    const wind = windInfo.value; const setup = anomalyPoolSetupInfo.value
    const giftedPolarAssault = giftedPolarAssaultOverride ?? 0
    return calcAnomalyPool({
      executions: execs, panels: panels.value,
      bossCoeff: configStore.enemy.anomalyCoeff, anomalyCoeff: configStore.enemy.bossAnomalyCoeff,
      enemyAnomalyResistances: configStore.enemy.anomalyResistances,
      totalTime: configStore.enemy.battleTime, invincibleTime: configStore.enemy.invincibleTime,
      enemyDefense: configStore.enemy.defense, enemyDefReduction: 0,
      enemyResistances: configStore.enemy.damageResistances, enemyResReduction: 0,
      stunned: stunCov, stunMultiplier: configStore.enemy.stunVuln,
      hasWindChar: wind.hasWindChar, windCharSlot: wind.windCharSlot,
      coweringConfig: setup?.coweringConfig,
      // CC-78：赠送注入不再要求 anomalyPoolSetup 声明者（原 `setup &&`）；槽位 setup 优先，否则第一个有赠送的槽（giftedPolarAssault.ts 头注释）
      giftedTriggerCounts: giftedPolarAssault > 0 ? { 'physical_polar_assault': giftedPolarAssault } : undefined,
      giftedTriggerSlot: setup?.slot ?? giftedSlotFallback,
      teamMechanics: teamMechanicSlots(configStore.team),
    })
  }

  /** 通用自动轴（用户口径：所有预设队伍都对应预设失衡轴，捏了轴就自动启用）：
   * 按槽位通配匹配 stunAxisPresets 命中即自动选用（章鱼体系按 命座 chapter × 有琉 选档）；
   * 手动配置过轴（条件方案或手动轴）时手动优先，自动让路。 */
  const autoPreset = computed(() => autoStunAxisPresetOf(configStore, AUTO_AXIS_PRESET_HINTS)) // CC-349 单源
  const autoActive = computed(() => {
    if (!autoPreset.value) return false
    return configStore.stunAxisPlans.length === 0 && configStore.stunAxes.length === 0
  })

  /**
   * CC-389：本轮生效轴的唯一出口——先按来源解析（resolveAxesBySource），再丢掉「换人后残留的别人的动作」。
   * 轴动作存 `{ slot, moveId }`，`setAgent` / 预设 / 独立场景换人都不改轴。修前：新角色招式表里查不到旧角色的 moveId ⇒
   * buildStackAxes 的能量 / 时长 / 喧响成本全 0 ⇒ 栈遍历把它当免费零时长动作照单执行（r415 实测：换上来的 1311 执行席德 1461015
   * 4 次 + 连段 xide-bengzhui 6 次，伤害 +6.5%；另一预设 −2.5%）。放在这里 ⇒ 展示（effectiveStunAxes）、栈遍历、决算截断同源。
   */
  function resolveAxes(stunCount: number, goodReview: number, energyBySlot: Record<number, number>): { axes: StunAxis[]; planName: string | null } {
    const r = resolveAxesBySource(stunCount, goodReview, energyBySlot)
    return { axes: dropStaleAxisActions(r.axes), planName: r.planName }
  }

  /** 无残留时原样返回（不复制，保持引用）；有残留时只复制受影响的轴 */
  function dropStaleAxisActions(axes: StunAxis[]): StunAxis[] {
    const isStaleAxisAction = (act: StunAxisAction) => isStaleAxisActionFor(act, configStore.team, catalogStore)
    if (!axes.some(ax => ax.actions.some(isStaleAxisAction))) return axes
    return axes.map(ax => (ax.actions.some(isStaleAxisAction)
      ? { ...ax, actions: ax.actions.filter(a => !isStaleAxisAction(a)) }
      : ax))
  }

  /** 按来源解析当前轮生效的轴：手动条件轴方案 → 手动 stunAxes → 通用自动预设（按资源量自选） */
  function resolveAxesBySource(stunCount: number, goodReview: number, energyBySlot: Record<number, number>): { axes: StunAxis[]; planName: string | null } {
    const cinemaBySlot: Record<number, number> = {}
    configStore.team.forEach((c, i) => { cinemaBySlot[i] = c.cinemaLevel })
    if (configStore.stunAxisPlans.length > 0) {
      const r = resolveStunAxisPlan(configStore.stunAxisPlans, { stunCount, goodReview, energyBySlot, cinemaBySlot })
      if (r) return { axes: r.axes, planName: r.plan.name }
    }
    if (configStore.stunAxes.length > 0) {
      return { axes: configStore.stunAxes, planName: null }
    }
    const auto = autoPreset.value
    if (auto) {
      if (auto.plans && auto.plans.length > 0) {
        const r = resolveStunAxisPlan(auto.plans, { stunCount, goodReview, energyBySlot, cinemaBySlot })
        if (r) return { axes: r.axes, planName: `${auto.name}·${r.plan.name}` }
      }
      if (auto.axes && auto.axes.length > 0) {
        return { axes: cloneStunAxes(auto.axes), planName: auto.name }
      }
    }
    return { axes: [], planName: null }
  }

  /** 把用户轴定义转换成栈遍历引擎的动作成本（含连段打包、转大不扣喧响、伊德海莉1命 60→50） */
  /**
   * **轴内角色专属资源的供给量**（T169）：按槽位问各角色模块要（`axisSwaySupply` 能力）。
   *
   * 为什么住这里：与 `buildStackAxes` 同层（同样的「按槽位派发模块能力」模式），
   * 且两处栈调用点（`convergence.ts` 的 inAxisFractionProvider 与执行集合）必须**同源**——
   * 放两份实现就会像闪能/喧响那样出现「一处传了、一处没传」的静默分歧（规则 11）。
   * 未声明该能力的角色恒 0 ⇒ 不耗专属资源的块不受影响（纯追加语义）。
   */
  function buildStackSwaySupply(axes: StunAxis[], stunCount: number, goodReview: number, axisAutoTrim: number): Record<number, number> {
    const out: Record<number, number> = {}
    for (const cfg of resourceConfig.value?.characters ?? []) {
      const supply = getAgentMechanic(cfg.agentId)?.axisSwaySupply
      if (!supply) continue
      // ⚠ **必须递真实轴定义 + 真实窗数**：供给量由「轴内捏了几块连段（× 窗口数）」推出
      // （怒相需求 → 山威供给）。递空轴/零窗 ⇒ 模块只能回落读 cfg 里上一轮或构建相的字段
      // ⇒ 怒相与供给量都不对（实测 liuyin 容量 6 块却放行 8 块，见 `banyue.ts#axisSwaySupply`）。
      // ⚠ **必须递「总次数」口径**：`actionCountsBySlot` 在 `AgentAxisContext` 里的语义就是
      // 「轴内捏块**总**次数（= 每窗模板 × 窗数）」，模块按它推怒相需求。递每窗模板会**少算窗数**
      // ⇒ 需求偏低 ⇒ 供给偏低（实测把 10 块的轴按 2 块算）。
      const winAlloc = allocateAxisWindows(axes, stunCount, { goodReview: Math.max(0, goodReview) })
      const totalByMove: Record<string, number> = {}
      axes.forEach((ax, ai) => {
        for (const act of ax.actions) {
          if (act.slot !== cfg.slot) continue
          totalByMove[act.moveId] = (totalByMove[act.moveId] ?? 0) + Math.max(0, act.count) * (winAlloc[ai] ?? 0)
        }
      })
      const v = supply({
        slot: cfg.slot,
        cfg,
        axis: { axes, windows: winAlloc, actionCountsBySlot: { [cfg.slot]: totalByMove } },
        axisAutoTrim,
      })
      if (v > 0) out[cfg.slot] = v
    }
    return out
  }

  /**
   * **缺省兜底槽 = 主C**（用户口径 2026-10-27，逐字）：
   * > 「在低命情况下琉音会填充一些平a，但作为击破手，**失衡内主打伤害的窗口不如让主c来打**。」
   *
   * 旧口径 = 引擎的「轴内动作耗时最长的槽」（`stunAxisStack#mainCSlotOf`）——击破手在轴里捏的招多时，
   * 窗内平A就落到击破位上。新口径按三把尺依次判（都是**已有输入**，不新增用户旋钮）：
   * ① **平A 权重**最高（`basicAttackTimeWeight`，用户可调；支援/防护缺省 0、后台类角色另有模块声明 0）；
   * ② 职业更适合吃失衡窗（强攻 / 异常 / 命破 > 尖兵 > 击破 > 支援 / 防护）；
   * ③ 槽位靠前者（并列时给稳定答案，不做没有依据的取舍）。
   * 全部 0 分（权重全 0 且职业都不在表里）⇒ 返回 undefined，交回引擎旧口径。
   */
  function mainCAttackSlotOf(axis: StunAxis): number | undefined {
    /** 职业「吃失衡窗」的先验次序（不是伤害计算，只决定**兜底平A归谁**） */
    const SPECIALTY_RANK: Record<string, number> = {
      attack: 3, anomaly: 3, rupture: 3, sharpen: 2, stun: 1, support: 0, defense: 0,
    }
    const slots = [...new Set(axis.actions.map(a => a.slot))].sort((a, b) => a - b)
    if (slots.length === 0) return undefined
    let best: number | undefined
    let bestScore = 0
    for (const slot of slots) {
      const cfg = configStore.team[slot]
      const weight = Math.max(0, Number(cfg?.basicAttackTimeWeight) || 0)
      const rank = SPECIALTY_RANK[catalogStore.getAgent(cfg?.agentId ?? '')?.specialty ?? ''] ?? 0
      // 权重优先（×10 让任何一档权重压过职业次序），同分再看职业
      const score = weight * 10 + rank
      if (score > bestScore) { bestScore = score; best = slot }
    }
    return bestScore > 0 ? best : undefined
  }

  function buildStackAxes(axes: StunAxis[]): StackAxisInput[] {
    return axes.map(axis => {
      const axisActions: StackActionCost[] = []
      /** 已收过喧响的融合组（`slot:主段moveId`）——同一次动作的分段不重复收费（用户裁决 2026-10-22） */
      const decibelChargedGroups = new Set<string>()
      // 60/90 转大块是琉音（1481）好评赠送终结技的专属机制：队伍无琉音时跳过（不当作普通轴动作执行，
      // 否则无琉音队伍也会打出 promoteVariant 块的终结技——2026-08 修复）
      // CC-43e（2026-09-27）：「转大块归谁」由模块声明 `ownsPromoteVariantAxisBlocks`（琉音），编排层无身份判定。
      // 原为 `findSlotByIdentity(…, ['1481']) >= 0`；琉音 teammateBuffId 即自身 id ⇒ 按 agentId 派发等价。
      const hasPromoteVariantOwner = configStore.team.some(c =>
        !!c.agentId && getAgentMechanic(c.agentId)?.ownsPromoteVariantAxisBlocks === true)
      for (const act of axis.actions) {
        if (act.promoteVariant && !hasPromoteVariantOwner) continue
        // 诺姆转连携块（norma-hat-chain）与赠品连携块（怒焰·赠 sourceTag='gift'）：
        // 都标记「赠送连携吃失衡易伤」的轴内单位，不占目标自身连携次数/喧响。
        if (act.moveId === 'norma-hat-chain' || act.sourceTag === 'gift') {
          if (act.sourceTag === 'gift') {
            // 赠块 = 真实连携块：占失衡窗口时间（参与时间门控，超窗被跳过=不吃易伤），
            // 但不耗闪能/喧响；moveId 加 ':gift' 后缀独立计数，避免与普通连携块合并。
            const gSkills = catalogStore.agentSkillsByAgentMap.get(configStore.team[act.slot]?.agentId ?? '')
            const gMove = findMoveById(gSkills, act.moveId)
            // 赠品连携同族每窗 ≤1（`GIFT_CHAIN_FAMILY`；用户口径见 stunAxisStack#StackActionCost.fillFamily）
            axisActions.push({ slot: act.slot, moveId: `${act.moveId}:gift`, count: act.count, actionTime: gMove?.actionTime ?? 0, energyCost: 0, decibelCost: 0, startTime: act.startTime ?? 0, fillFamily: GIFT_CHAIN_FAMILY, maxPerWindow: GIFT_CHAIN_PER_WINDOW })
          } else {
            /**
             * **诺姆转连携的本体 = 受赠队友（主C）自己的连携块**（用户口径 2026-10-27，逐字）：
             * > 「诺姆转连携其本体是主c的连携块，**不应该和普通连携有差别**。」
             *
             * 修前 = **0 时长纯标记块**：只让赠送连携行（`chainGift`）拿到轴内次数，自己不占窗口时间
             * ⇒ 普通连携块占时间、它不占，同一件事两种读法。
             * 现在按普通连携收：时长取**受赠队友**连携技的 `actionTime`（与 `chainGift` 的
             * `secondsPerUnit → targetCfg.chainActionTime` 同源），落点取 `supplyTargetTeamSlot`
             * （与赠送行的归属**同一个函数**）⇒ 它占的是主C 的时间线、排在他自己动作之后。
             */
            const cfgs = resourceConfig.value?.characters ?? []
            const providerIdx = cfgs.findIndex(c => !!c.agentId && !!getAgentMechanic(c.agentId)?.chainGift)
            const recipientSlot = providerIdx >= 0
              ? supplyTargetTeamSlot(cfgs[providerIdx]!, cfgs.map(c => c.slot))
              : -1
            const recipientSkills = recipientSlot >= 0
              ? catalogStore.agentSkillsByAgentMap.get(configStore.team[recipientSlot]?.agentId ?? '')
              : undefined
            const recipientChain = recipientSkills ? findChainAttack(recipientSkills, fusedRowReader) : null
            axisActions.push({
              slot: recipientSlot >= 0 ? recipientSlot : act.slot,
              moveId: 'norma-hat-chain',
              count: act.count,
              actionTime: recipientChain?.actionTime ?? 0,
              energyCost: 0,
              decibelCost: 0,
              startTime: act.startTime ?? 0,
              // 与 ':gift' 块**同一族**：一次失衡 0~1 个赠品连携，前面放过了后面就不再放
              fillFamily: GIFT_CHAIN_FAMILY,
              maxPerWindow: GIFT_CHAIN_PER_WINDOW,
            })
          }
          continue
        }
        // CC-43f（2026-09-27）：角色轴内伪块由模块钩子 `expandAxisAction` 展开（现实现：希格莉德破阵连段 → 三段）。
        // 按本块所在槽的 agentId 派发；原为 `act.moveId === 'sigrid-pozhen'` 内联 + 希格莉德常量值导入。
        {
          const exAgentId = configStore.team[act.slot]?.agentId ?? ''
          const exSkills = catalogStore.agentSkillsByAgentMap.get(exAgentId)
          const expanded = getAgentMechanic(exAgentId)?.expandAxisAction?.({
            slot: act.slot,
            moveId: act.moveId,
            count: act.count,
            startTime: act.startTime ?? 0,
            cinemaLevel: configStore.team[act.slot]?.cinemaLevel ?? 0,
            actionTimeOf: id => findMoveById(exSkills, id)?.actionTime ?? 0,
          })
          if (expanded) {
            axisActions.push(...expanded)
            continue
          }
        }
        const agentId = configStore.team[act.slot]?.agentId ?? ''
        const skills = catalogStore.agentSkillsByAgentMap.get(agentId)
        const cinema = configStore.team[act.slot]?.cinemaLevel ?? 0
        const combo = getAgentMechanic(agentId)?.combos?.[act.moveId]
        let energyCost = 0
        let actionTime = 0
        let decibelCost = 0
        // T169：连段块可声明**角色专属资源**成本（般岳山威）——由栈做通用门控，供给侧见 `axisSwaySupply`
        let swayCost = 0
        if (combo) {
          // 连段：能量按打包口径；影画覆盖经 combo.energyCostAtCinema（CC-69；如伊德海莉单次碾 1 命 60→50，原按 moveId 写死）
          energyCost = combo.energyCostAtCinema && cinema >= combo.energyCostAtCinema.minCinema ? combo.energyCostAtCinema.energyCost : combo.energyCost
          swayCost = Math.max(0, combo.swayCost ?? 0)
          for (const mv of combo.moves) {
            const m = findMoveById(skills, mv.moveId)
            actionTime += (m?.actionTime ?? 0) * mv.count
          }
        } else {
          const move = findMoveById(skills, act.moveId)
          energyCost = parseMoveEnergyCost(move?.energyCost).energyConsume
          /**
           * ## 轴内 `basic` 块必须按「单位 = 1 秒」定价（2026-10-29 修）
           *
           * 用户报告：「克拉蕾预设失衡轴中间的平a显示为0秒……新的指标提示我每窗都发呆1秒，
           * 可视化也显示中间是0秒的basic块。」
           *
           * 根因：`basic` 是轴**位置性标记块**（不是 catalog 行）⇒ `findMoveById(skills, 'basic')`
           * 恒 `undefined` ⇒ `actionTime = 0`。于是该槽的排布游标不前进：
           * 实测 `preset-1611-any` 4.2s 起手的 `count=2` 平A块两条轨迹
           * （4.2425 / actionTime 0 / 4.2425）⇒ 与下一块（显式 5.2s）之间留下
           * **0.9575s 缝隙**，被记进 `idleSegments`（= 用户看到的「每窗发呆 1 秒」），
           * 平A 块本身在可视化里宽度为 0。
           *
           * 口径来源（**不是新口径，是与既有单一事实源对齐**）：
           *   · `core/stunAxis.ts#AXIS_BASIC_UNIT_SECONDS`（=1，`basic` 的 `count` 单位就是秒）；
           *   · 旧轴引擎同值：`useResourceCalc` 的 `perActionDuration[slot:basic]`
           *     （判据 `core/__tests__/stunAxis.test.ts`「basic 10s 从 11s 起手」按 1s/单位折算）；
           *   · 编辑器候选同为 1 秒/块（`StunAxisPage#moveOptions: actionTime: 1`）。
           * ⚠ 栈侧漏定价 = 两条引擎对同一份轴给出不同时间账（本函数修的就是这个分叉）。
           */
          const isBasicBlock = act.moveId === 'basic'
          // 轴块 duration 覆盖倍率表 actionTime（新机制：仪玄轴内凝云术可延长/缩短蓄力 0-2s）
          actionTime = act.duration ?? (isBasicBlock ? AXIS_BASIC_UNIT_SECONDS : move?.actionTime ?? 0)
          // 终结技喧响消耗：读**本槽 cfg 的 ultimateCost**（角色口径，模块在 buildCharConfig
          // 里写自己那份，如佩洛伊斯 1551 = 2000），缺省回落全局默认 3000。
          // 2026-09-15 arch 棘轮：原为 `agentId === '1551' ? 2000 : 3000` 硬编码特判——
          // 而 `specPanelBuffs.ts:174` 早已写 `cfg.ultimateCost = PEILUO_ULT_COST`（2000），
          // 故该 agentId 判断**冗余**（判据同 T6：字段唯一写入方 = 该角色模块 ⇒ 不需要再认人）。
          decibelCost = resolveAxisUltimateDecibelCost(chainMoveKind(skills, act.moveId) === 'ultimate', resourceConfig.value?.characters, act.slot)
          // 60/90 转大块是琉音好评赠送的终结技（白送，不耗目标喧响），只占窗口时间不扣喧响
          if (act.promoteVariant) decibelCost = 0
          /**
           * T171：**名字带 `Ultimate:` ≠ 由喧响购买** —— 本槽角色声明「这个块不扣喧响」时按 0 收。
           *
           * 用户口径 2026-10-15 逐字：「很多角色都有多个大招，虽然有大招标签，但其实**不是喧响大**……
           * **术法大自己消耗术法值，不消耗喧响**。还有什么**叶瞬光斩妄开天是收尾，不消耗喧响**。」
           *
           * 实测缺陷：仪玄 `1371020`（符法千重）由**术法值**购买（模块 `SHUFA_ULT_COST`，spec 单一来源），
           * 却因英文名是 `Ultimate: Endless Talisman Suppression` 被收满 3000 喧响
           * ⇒ 4 支仪玄队全被判「喧响不足」而截断（`yixuan-trigger` 喧响 12692 ÷ 3000 = **4.23 个**，
           * 本够打 4 个大招）。**只免喧响，不免窗口时间**（`actionTime` 不受影响）。
           */
          if (axisMoveFreeOfDecibelOf(configStore.team[act.slot]?.agentId, act.moveId)) decibelCost = 0
          /**
           * **同一次动作的分段只收一次喧响**（用户裁决 2026-10-22）。
           *
           * 场景：奥菲与玛格莎终结技「与火共舞」= #1 旋转攻击 + #2 激光，原文
           * 「向前发动旋转攻击，**然后**向前方发射激光」= 一次发动、两段演出。
           * 轴里两段都捏时修前**收两次 3000、产出只有一份**（实测 2.8813M / 6000，单段 3000）。
           *
           * 用户逐字：「奥菲斯的大招应该把动作块合在一起，因为他会自动放完两个倍率，
           * 只需要 3k 喧响，旋转完了可以自动发射激光」
           *
           * 修法 = 按**多段演出组**去重（`movePerformanceGroupOf`，单一事实源 = `MOVE_PERFORMANCE_GROUPS`）：
           * 同组只收一次，先命中者收全额、其余段 0。
           * ⚠ 与 **融合组**（`moveFusions`）**不是一回事**：融合组是「多段合成一份倍率」（引擎只物化主段，
           * 兄弟段不得成行，有 `moveFusion.test.ts` 双计护栏锁死）；本组是「**每段各算各的伤害**、
           * 但**同一次发动**只花一次喧响」（奥菲 #1 旋转 1398.3% + #2 激光 932.2% 两段都出伤害）。
           * ⚠ 也与 T133（`axisMoveFreeOfDecibel`「这个大招不由喧响买」）**不是同一件事**：
           * 本族**确实由喧响买**，只是被数了两遍。
           */
          const performanceGroup = movePerformanceGroupOf(act.moveId)
          if (performanceGroup) {
            const groupKey = `${act.slot}:${performanceGroup}`
            if (decibelChargedGroups.has(groupKey)) decibelCost = 0
            else decibelChargedGroups.add(groupKey)
          }
        }
        // 合成行（无倍率表条目）的动作时长兜底由本槽模块能力 `axisMoveActionTime` 提供（CC-39b；
        // 现唯一实现 = 雨果强特终结一击），保证窗口截断按「块结束时刻」而非「块起点」算剩余失衡时间。
        actionTime = axisMoveActionTimeOf(configStore.team[act.slot]?.agentId, act.moveId, actionTime)
        // 窗口终结（决算）：佩洛伊斯右分支 1551016；雨果强特终结一击(1291_ex_verdict_final) 永远结束失衡；
        // 雨果终结技本体(1291018) 仅 C0/C1 结束失衡——影画2「终结技决算不结束失衡」不截断窗口（0命2命区分）。
        const slotCinema = configStore.team[act.slot]?.cinemaLevel ?? 0
        // CC-39b：由本槽角色模块能力 `endsStunWindow` 判定（convergence 决算截断同源）
        const endsWindow = axisMoveEndsStunWindow(configStore.team[act.slot]?.agentId, act.moveId, slotCinema)
        axisActions.push({
          slot: act.slot,
          moveId: act.moveId,
          count: act.count,
          actionTime,
          energyCost,
          decibelCost,
          ...(swayCost > 0 ? { swayCost } : {}),
          startTime: act.startTime ?? 0,
          // 佩洛伊斯右分支·永陷幽囚 / 雨果决算 = 决算：做完时清空窗口剩余失衡时间（填充归零+窗口截断）
          ...(endsWindow ? { endsStunWindow: true } : {}),
        })
      }
      // 缺省兜底槽 = 主C（用户口径 2026-10-27；轴显式声明时原样用）
      const defaultFiller = axis.basicFillerSlot === undefined ? mainCAttackSlotOf(axis) : undefined
      return {
        actions: axisActions,
        // ⚠ `count` **只在 `fixed` 轴上有语义**（T155 四阶段分配：tail 恒 1 窗 / bestEffort 0-1 窗 /
        // fallback 吃剩余）。非 fixed 轴上传 `count` 会让栈内部的 `allocateAxisWindows` 把它当精确次数
        // ⇒ **覆盖掉外层已经算好的分配**（实测 `比琉通用` 轴0 残留 `count:3` + kind=fallback：
        // 外层 winAlloc=[2,1] 正确，但栈按 3 执行 ⇒ 失衡 3 次却打 3 窗、伤害 24.99M vs 24.59M）。
        // 故这里按 kind 过滤：只有 fixed 传递次数，其余传 undefined（= 让栈按同一套规则自行分配）。
        count: axisKindOf(axis) === 'fixed' ? axis.count : undefined,
        kind: axisKindOf(axis),
        ...(axis.basicFillerSlot !== undefined
          ? { basicFillerSlot: axis.basicFillerSlot }
          : defaultFiller !== undefined
            ? { basicFillerSlot: defaultFiller, fillerDefaulted: true }
            : {}),
        // 进轴残痕值（点数）：栈引擎只透传，消费方 = 克拉蕾模块的轴内时序推演
        entryGash: Math.max(0, Number(axis.entryGash ?? 0)),
      }
    })
  }

  /**
   * 把栈遍历 executed（轴动作块）展开成具体招式轴内单位数：
   * - 连段展开成内部招式（如 连段·双次 → 2×极寒重碾 + …）；
   * - 兜底平A填充按槽位映射（模块钩子 expandBasicFill，如伊德海莉映射到蓄力循环的下砸+平A；未声明映射到 basic 秒数）。
   *
   * `fillResources` = 兜底池的资源读数（可选，见 `FillResourceBudget`）。缺省 ⇒ 钩子拿不到资源，
   * 只能按时间切分（旧调用点逐位不变）。
   *
   * @fact engine:兜底池 口径: 兜底填充能认领的招式量**只能是本轮真物化出来的量**——引擎按 `FillResourceBudget.executed`（本轮各行 Σcount）**逐招夹紧**，夹掉的秒数退回 `basic`；只靠失衡分数的 `min(1,·)` 挡不住「认领不存在的招式」，那会**静默抢走平A的轴内秒数** | 据 用户@2026-10-27「他本身作为一个产出招式的地方，而不从余量池拿取」·钉「不能凭空多算」+「把 e 物化」 | 验 src/composables/__tests__/expandBasicFillPool.test.ts | 锚 src/composables/resourceCalc/roundInputs.ts#expandExecutedToCounts | 信 确认
   * ⟳复核: 出现第二个声明兜底池的角色、或 executed 计数通道（CharacterResourceResult.executions）改口径时，重核「认领上限 = 本轮行数」是否仍成立 | 到期 2027-06-30
   */
  function expandExecutedToCounts(
    executed: Record<string, ExecutedMoveCount>,
    basicFillBySlot: Record<number, number>,
    fillResources?: Readonly<Record<number, FillResourceBudget>>,
    /**
     * 可选出参：产出端**生成的 basic 秒数**（按槽位）。填充是产出端、不抽窗外平A池
     * （用户口径 2026-10-28）⇒ 失衡逐招作废的分子要把这部分剔掉——它不在任何
     * 招式行的分母里，计入会让窗外的 basic 行被多扣。被认领的真实招式
     * （expandBasicFill 夹紧部分）照旧计入（它们有自己的行）。
     */
    generatedBasicSecOut?: Record<number, number>,
  ): Record<string, ExecutedMoveCount> {
    const out: Record<string, ExecutedMoveCount> = {}
    /**
     * @param inAxisCount 其中落在失衡窗口内的部分（跨界小数；见 `ExecutedMoveCount`）
     */
    const add = (slot: number, moveId: string, count: number, inAxisCount = count) => {
      if (count <= 0) return
      const key = `${slot}:${moveId}`
      const cur = out[key]
      if (cur) { cur.count += count; cur.inAxisCount += inAxisCount } else out[key] = { slot, moveId, count, inAxisCount }
    }
    for (const v of Object.values(executed)) {
      const agentId = configStore.team[v.slot]?.agentId ?? ''
      const combo = getAgentMechanic(agentId)?.combos?.[v.moveId]
      if (combo) {
        // 连段展开：内部招式按**同一跨界比例**摊（连段块整体跨界时，内部各招同比例进窗）
        const ratio = v.count > 0 ? v.inAxisCount / v.count : 1
        for (const mv of combo.moves) add(v.slot, mv.moveId, mv.count * v.count, mv.count * v.count * ratio)
      } else {
        add(v.slot, v.moveId, v.count, v.inAxisCount)
      }
    }
    for (const [slotStr, fillSec] of Object.entries(basicFillBySlot)) {
      const slot = Number(slotStr)
      const fillerAgentId = configStore.team[slot]?.agentId ?? ''
      // CC-63：角色专属平A兜底由模块钩子 expandBasicFill 展开（现：伊德海莉蓄力循环 / 「11号」火力镇压）；
      // 原为此处 `fillerAgentId` 写死两个角色的 if/else 分支。未声明 ⇒ 通用 basic 秒数。
      const fillSkills = catalogStore.agentSkillsByAgentMap.get(fillerAgentId)
      const budget = fillResources?.[slot]
      const actionTimeOf = (id: string) => findMoveById(fillSkills, id)?.actionTime
      const fillExpanded = getAgentMechanic(fillerAgentId)?.expandBasicFill?.({
        fillSec,
        actionTimeOf,
        // 兜底池资源读数：缺省不传（不是 0）——「没有读数」与「读数为 0」对模块是两件事
        ...(budget?.energy !== undefined ? { energyAvailable: budget.energy } : {}),
        ...(budget?.decibel !== undefined ? { decibelAvailable: budget.decibel } : {}),
        ...(budget?.exSpecial !== undefined ? { exSpecialAvailable: budget.exSpecial } : {}),
      })
      if (!fillExpanded) { add(slot, 'basic', fillSec); if (generatedBasicSecOut) generatedBasicSecOut[slot] = (generatedBasicSecOut[slot] ?? 0) + fillSec; continue }
      // 没有 executed 读数（旧调用点 / 非轴路径）⇒ 不做任何夹紧，逐位保持钩子输出
      if (!budget?.executed) { for (const e of fillExpanded) add(slot, e.moveId, e.count); continue }
      /**
       * **逐招夹紧到「真物化出来的次数」**（兜底池，2026-10-27 用户口径「把 e 物化」）：
       * 钩子返回的 moveId 可能根本没有行（角色没打出来 / 模块没发）⇒ 认领它不会加伤，
       * 却会让窗尾秒数「已用掉」。故按 `budget.executed` 夹紧。
       *
       * 退回口径 = **只退夹掉的那部分秒数**（`claimed − taken`），不是「fillSec − 已用」：
       * 后一种会把历史上就不计秒的余量（如伊德海莉每循环的 1s 蓄力）也倒进平A，
       * 改变既有角色的读数——夹紧要修的只是「认领了不存在的招式」这一类。
       */
      let basicSec = 0
      let claimedSec = 0
      let takenSec = 0
      for (const e of fillExpanded) {
        if (e.moveId === 'basic') { basicSec += Math.max(0, e.count); continue }
        const cap = budget.executed[e.moveId]
        const want = Math.max(0, e.count)
        const take = cap === undefined ? 0 : Math.min(want, Math.max(0, cap))
        const at = Math.max(0, actionTimeOf(e.moveId) ?? 0)
        claimedSec += want * at
        if (!(take > 0)) continue
        add(slot, e.moveId, take)
        takenSec += take * at
      }
      basicSec += Math.max(0, claimedSec - takenSec)
      if (basicSec > 0) {
        add(slot, 'basic', basicSec)
        if (generatedBasicSecOut) generatedBasicSecOut[slot] = (generatedBasicSecOut[slot] ?? 0) + basicSec
      }
    }
    return out
  }

  /**
   * 把栈遍历的**逐次执行序列**展开成真实 moveId，并**保留顺序**（2026-10-12，克拉蕾轴内残痕时序用）。
   *
   * 与 `expandExecutedToCounts` 的关系：后者按 key 聚合（丢顺序，用于「次数」类消费）；
   * 本函数是它的**保序版**——连段块展开成内部招式（每个 term 一条，保持 term 声明序），
   * 非连段块原样透传；兜底平A填充作为 `basic`（count = 秒数）**追加在末尾**
   * （口径正确：平A填充发生在轴内块都放完之后，见 `stunAxisStack` 的 `basicFillBySlot`）。
   *
   * ⚠ 只做「键 → 真实 moveId」的展开，不做任何计数聚合 ⇒ 消费者拿到的是**有序事件流**。
   */
  function expandSequenceToMoveIds(
    sequence: readonly StackSequenceEntry[],
    basicFillBySlot: Record<number, number>,
  ): StackSequenceEntry[] {
    const out: StackSequenceEntry[] = []
    for (const v of sequence) {
      if (v.count <= 0) continue
      const agentId = configStore.team[v.slot]?.agentId ?? ''
      const combo = getAgentMechanic(agentId)?.combos?.[v.moveId]
      if (combo) {
        for (const mv of combo.moves) {
          // 连段各段共用块的 startTime（段内先后由 `count` 表达，不另造时刻）
          if (mv.count > 0) out.push({ slot: v.slot, moveId: mv.moveId, count: mv.count * v.count, startTime: v.startTime, window: v.window })
        }
      } else {
        out.push({ slot: v.slot, moveId: v.moveId, count: v.count, startTime: v.startTime, window: v.window })
      }
    }
    // 兜底平A填充：追加在末尾（count = 秒数，消费方按自己的秒均积累率折算）。
    // ⚠ **本函数不吃模块钩子**（与 `expandExecutedToCounts` 的兜底池展开不同）：它是保序事件流，
    //   喂的是模块的**轴内时序推演**（现唯一消费者 = 克拉蕾残痕链）。声明了 `expandBasicFill` 的角色
    //   （伊德海莉 / 11号 / 格莉丝）若将来也要读本序列，必须先把填充展开成真实招式，
    //   否则会看到「次数账里有特殊技、时序里只有 basic」的两把尺。
    // ⚠ 无显式 startTime（填充发生在轴内块都放完之后，由栈内部决定起止）⇒ 记 0 表示「窗内末段」，
    //   消费方展示时按「填充」标注即可，不要当成 t=0 的真实动作。
    for (const [slotStr, fillSec] of Object.entries(basicFillBySlot)) {
      // 兜底填充是**跨全部窗口的合计秒数**（不是每窗），故不标窗号语义、归到末窗之后（window = 0 = 不限窗）
      if (fillSec > 0) out.push({ slot: Number(slotStr), moveId: 'basic', count: fillSec, startTime: 0, window: 0 })
    }
    return out
  }

  return {
    extractAnomalyExecsFrom, extractStunExecsFrom, autoPreset, autoActive,
    resolveAxes, buildStackAxes, buildStackSwaySupply, expandExecutedToCounts, expandSequenceToMoveIds, calcAnomalyPoolInput,
  }
}


/**
 * 轴内某动作的**终结技喧响消耗**（纯函数，导出供单测直接钉住）。
 *
 * 口径：只对「英文名含 `ultimate`」的招式收费（其余 0）；消耗取**本槽 cfg 的 `ultimateCost`**
 * （角色模块在 `buildCharConfig` 写自己那份，如佩洛伊斯 1551 = 2000），未设则回落全局默认 3000。
 *
 * 为什么抽出来（2026-09-15 arch 棘轮）：原实现是硬编码 `agentId === '1551' ? 2000 : 3000`，
 * 而 `specPanelBuffs.ts:174` 早已写 `cfg.ultimateCost = PEILUO_ULT_COST` ⇒ 该 agentId 判断**冗余**
 * （判据同 T6：字段唯一写入方 = 该角色模块）。抽纯函数是为了让「按**槽位**读、不是按 agentId 认人」
 * 这条口径**可被单测直接证伪**——只断言「配置里有 2000」是不够的（那是输入，不是被改的那行），
 * 必须断言解析结果**随槽位变化**（实测教训：第一版测试断言在输入上，反向验证时照样绿）。
 */
export function resolveAxisUltimateDecibelCost(
  isUltimate: boolean,
  chars: ReadonlyArray<{ ultimateCost?: number }> | undefined,
  slot: number,
): number {
  // CC-319：原收英文名、只判 `includes('ultimate')`（不看分类）⇒ 轴里放青衣普攻「Penultimate」块会被扣 3000 喧响。
  // 现由调用方用 `chainMoveKind(...) === 'ultimate'` 判定后传入。
  if (!isUltimate) return 0
  return chars?.[slot]?.ultimateCost ?? ULTIMATE_COST_DEFAULT
}
