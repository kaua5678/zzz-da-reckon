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
import type { StackActionCost } from '@/core/stunAxisStack'
import { resolveStunAxisPlan, autoStunAxisPresetOf, cloneStunAxes } from '@/data/stunAxisPresets'
import { AUTO_AXIS_PRESET_HINTS, getAgentMechanic, teamMechanicSlots } from '@/mechanics'
import { extractSkillExecutions, axisMoveEndsStunWindow, axisMoveActionTimeOf } from './helpers'
import { findMoveById } from '@/data/moveTableQueries'
import { findWindSlot } from './anomalyPanels'
import { chainMoveKind } from '@/data/chainMoveKind'
import { ULTIMATE_COST_DEFAULT } from '@/data/resourceDefaults'
import { parseMoveEnergyCost } from '@/core/resource/moveLookup'
import { panelAt } from '@/core/panel'

type StunAxisAction = StunAxis['actions'][number]
type AxisOwnerCatalog = Pick<ReturnType<typeof useCatalogStore>, 'agentSkillsByAgentMap'>

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
  function buildStackAxes(axes: StunAxis[]): { actions: StackActionCost[]; count?: number; basicFillerSlot?: number }[] {
    return axes.map(axis => {
      const axisActions: StackActionCost[] = []
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
            axisActions.push({ slot: act.slot, moveId: `${act.moveId}:gift`, count: act.count, actionTime: gMove?.actionTime ?? 0, energyCost: 0, decibelCost: 0, startTime: act.startTime ?? 0 })
          } else {
            // norma-hat-chain：纯标记块（0 时长，旧预设表达，无条件标记吃易伤次数）
            axisActions.push({ slot: act.slot, moveId: 'norma-hat-chain', count: act.count, actionTime: 0, energyCost: 0, decibelCost: 0, startTime: act.startTime ?? 0 })
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
        if (combo) {
          // 连段：能量按打包口径；影画覆盖经 combo.energyCostAtCinema（CC-69；如伊德海莉单次碾 1 命 60→50，原按 moveId 写死）
          energyCost = combo.energyCostAtCinema && cinema >= combo.energyCostAtCinema.minCinema ? combo.energyCostAtCinema.energyCost : combo.energyCost
          for (const mv of combo.moves) {
            const m = findMoveById(skills, mv.moveId)
            actionTime += (m?.actionTime ?? 0) * mv.count
          }
        } else {
          const move = findMoveById(skills, act.moveId)
          energyCost = parseMoveEnergyCost(move?.energyCost as Record<string, string> | undefined).energyConsume
          // 轴块 duration 覆盖倍率表 actionTime（新机制：仪玄轴内凝云术可延长/缩短蓄力 0-2s）
          actionTime = act.duration ?? move?.actionTime ?? 0
          // 终结技喧响消耗：读**本槽 cfg 的 ultimateCost**（角色口径，模块在 buildCharConfig
          // 里写自己那份，如佩洛伊斯 1551 = 2000），缺省回落全局默认 3000。
          // 2026-09-15 arch 棘轮：原为 `agentId === '1551' ? 2000 : 3000` 硬编码特判——
          // 而 `specPanelBuffs.ts:174` 早已写 `cfg.ultimateCost = PEILUO_ULT_COST`（2000），
          // 故该 agentId 判断**冗余**（判据同 T6：字段唯一写入方 = 该角色模块 ⇒ 不需要再认人）。
          decibelCost = resolveAxisUltimateDecibelCost(chainMoveKind(skills, act.moveId) === 'ultimate', resourceConfig.value?.characters, act.slot)
          // 60/90 转大块是琉音好评赠送的终结技（白送，不耗目标喧响），只占窗口时间不扣喧响
          if (act.promoteVariant) decibelCost = 0
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
          startTime: act.startTime ?? 0,
          // 佩洛伊斯右分支·永陷幽囚 / 雨果决算 = 决算：做完时清空窗口剩余失衡时间（填充归零+窗口截断）
          ...(endsWindow ? { endsStunWindow: true } : {}),
        })
      }
      return { actions: axisActions, count: axis.count, basicFillerSlot: axis.basicFillerSlot }
    })
  }

  /**
   * 把栈遍历 executed（轴动作块）展开成具体招式轴内单位数：
   * - 连段展开成内部招式（如 连段·双次 → 2×极寒重碾 + …）；
   * - 兜底平A填充按槽位映射（模块钩子 expandBasicFill，如伊德海莉映射到蓄力循环的下砸+平A；未声明映射到 basic 秒数）。
   */
  function expandExecutedToCounts(
    executed: Record<string, { slot: number; moveId: string; count: number }>,
    basicFillBySlot: Record<number, number>,
  ): Record<string, { slot: number; moveId: string; count: number }> {
    const out: Record<string, { slot: number; moveId: string; count: number }> = {}
    const add = (slot: number, moveId: string, count: number) => {
      if (count <= 0) return
      const key = `${slot}:${moveId}`
      const cur = out[key]
      if (cur) cur.count += count
      else out[key] = { slot, moveId, count }
    }
    for (const v of Object.values(executed)) {
      const agentId = configStore.team[v.slot]?.agentId ?? ''
      const combo = getAgentMechanic(agentId)?.combos?.[v.moveId]
      if (combo) {
        for (const mv of combo.moves) add(v.slot, mv.moveId, mv.count * v.count)
      } else {
        add(v.slot, v.moveId, v.count)
      }
    }
    for (const [slotStr, fillSec] of Object.entries(basicFillBySlot)) {
      const slot = Number(slotStr)
      const fillerAgentId = configStore.team[slot]?.agentId ?? ''
      // CC-63：角色专属平A兜底由模块钩子 expandBasicFill 展开（现：伊德海莉蓄力循环 / 「11号」火力镇压）；
      // 原为此处 `fillerAgentId` 写死两个角色的 if/else 分支。未声明 ⇒ 通用 basic 秒数。
      const fillSkills = catalogStore.agentSkillsByAgentMap.get(fillerAgentId)
      const fillExpanded = getAgentMechanic(fillerAgentId)?.expandBasicFill?.({
        fillSec,
        actionTimeOf: id => findMoveById(fillSkills, id)?.actionTime,
      })
      if (fillExpanded) {
        for (const e of fillExpanded) add(slot, e.moveId, e.count)
      } else {
        add(slot, 'basic', fillSec)
      }
    }
    return out
  }

  return {
    extractAnomalyExecsFrom, extractStunExecsFrom, autoPreset, autoActive,
    resolveAxes, buildStackAxes, expandExecutedToCounts, calcAnomalyPoolInput,
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
