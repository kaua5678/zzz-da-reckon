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
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { calcAnomalyPool, type AnomalySkillExecution } from '@/core/anomalyPool'
import type { StunSkillExecution } from '@/core/stunPool'
import type { StunAxis, ResourceCalcConfig, TeamResourceResult } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import type { StackActionCost } from '@/core/stunAxisStack'
import { resolveStunAxisPlan, selectAutoStunAxisPreset, cloneStunAxes } from '@/data/stunAxisPresets'
import { getAgentMechanic, getRegisteredAgentMechanics } from '@/mechanics'
import { SIGRID_LANCE_SEGMENT_IDS } from '@/mechanics/agents/sigrid'
import { HUGO_EX_VERDICT_MOVE_ID, HUGO_ULT_MOVE_ID, HUGO_EX_FINAL_ACTION_TIME } from '@/mechanics/agents/hugo'
import { extractSkillExecutions } from './helpers'
// 异常面板簇（D 簇）已迁 `./anomalyPanels`（R22 熵批 2 / R22-S2 刀 C）——同目录兄弟模块
// 直接指真实现，不走 `./helpers` 的 re-export 壳（壳只服务目录外的既有消费者面）。
import { findSlotByIdentity } from './anomalyPanels'
// 招式行取值簇（C 簇）已迁 `./skillRows`（R22 熵批 2 / R22-S2 刀 B）——同目录兄弟模块
// 直接指真实现，不走 `./helpers` 的 re-export 壳（壳只服务目录外的既有消费者面）。
import { findMoveById } from './skillRows'
import { ULTIMATE_COST_DEFAULT } from '@/core/resource'
import { panelAt } from '@/core/panel'

export function createConvergenceRoundInputs(deps: {
  configStore: ReturnType<typeof useConfigStore>
  catalogStore: ReturnType<typeof useCatalogStore>
  panels: ComputedRef<PanelValues[]>
  resourceConfig: ComputedRef<ResourceCalcConfig | null>
  globalAnomalyMultiplier: ComputedRef<number>
}) {
  const { configStore, catalogStore, panels, resourceConfig, globalAnomalyMultiplier } = deps

/** 从某个资源池结果提取异常 execs（参数化）；`skipGift` = 只取「装配前」口径（赠行单独结算） */
  function extractAnomalyExecsFrom(res: TeamResourceResult, skipGift = false): AnomalySkillExecution[] {
    const execs: AnomalySkillExecution[] = []
    for (let i = 0; i < 3; i++) {
      const char = configStore.team[i]
      if (!char?.agentId) continue
      const skills = catalogStore.agentSkillsByAgentMap.get(char.agentId)
      // ⚠ 判据 17：`i` 是 **team** 下标（该数组稠密、按槽位排列），而 `panels.value` **按位置压缩**
      // （空槽不 push）⇒ `panels.value[i]` 在前导/中间空槽时取到**别人那份**面板
      // （实测 `[空,1581,1031]`：i=1 时 team[1]=1581，而 panels.value[1] 盖章 slot 2）。
      // 故必须 `panelAt` 按盖章身份取。2026-09-18 round 21 夜发现并修复。
      const { anomalyExecs } = extractSkillExecutions(i, char.agentId, skills ?? undefined, res, catalogStore, panelAt(panels.value, i) ?? null, configStore, { skipGift })
      execs.push(...anomalyExecs)
    }
    return execs
  }

  /** 从某个资源池结果提取失衡 execs（参数化）；`skipGift` 同上 */
  function extractStunExecsFrom(res: TeamResourceResult, skipGift = false): StunSkillExecution[] {
    const execs: StunSkillExecution[] = []
    for (let i = 0; i < 3; i++) {
      const char = configStore.team[i]
      if (!char?.agentId) continue
      const skills = catalogStore.agentSkillsByAgentMap.get(char.agentId)
      // ⚠ 判据 17：`i` 是 **team** 下标（该数组稠密、按槽位排列），而 `panels.value` **按位置压缩**
      // （空槽不 push）⇒ `panels.value[i]` 在前导/中间空槽时取到**别人那份**面板
      // （实测 `[空,1581,1031]`：i=1 时 team[1]=1581，而 panels.value[1] 盖章 slot 2）。
      // 故必须 `panelAt` 按盖章身份取。2026-09-18 round 21 夜发现并修复。
      const { stunExecs } = extractSkillExecutions(i, char.agentId, skills ?? undefined, res, catalogStore, panelAt(panels.value, i) ?? null, configStore, { skipGift })
      execs.push(...stunExecs)
    }
    return execs
  }

  /** 风属性检测（复用） */
  const windInfo = computed(() => {
    let hasWind = false; let slot = -1
    for (let i = 0; i < 3; i++) {
      const a = configStore.team[i]?.agentId ? catalogStore.agentsMap.get(configStore.team[i].agentId) : null
      if (a?.damageElement === 'wind') { hasWind = true; slot = i; break }
    }
    return { hasWindChar: hasWind, windCharSlot: slot }
  })

  /** 异常池入参设置（CC-25 自 aliceInfo 改名；目前唯一提供方 = 爱丽丝模块 `anomalyPoolSetup`）：仅承载与 resourceResult 无关的畏缩结算配置。
   *  极性强击赠送计数不在此读——本 computed 读 resourceResult（= calcOutput.value.resourceResult）
   *  会在 calcOutput 自身求值内构成循环依赖（首算恒读空，曾致极性强击行整行缺失），
   *  由 calcAnomalyPoolInput 的 aliceSparkOverride 注入本轮资源结果。 */
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

  /** 构建积蓄池（参数化 stunCoverage + 异常 execs） */
  function calcAnomalyPoolInput(stunCov: number, execs: AnomalySkillExecution[], aliceSparkOverride?: number) {
    if (execs.length === 0) return null
    const wind = windInfo.value; const setup = anomalyPoolSetupInfo.value
    const aliceSpark = aliceSparkOverride ?? 0
    return calcAnomalyPool({
      executions: execs, panels: panels.value,
      bossCoeff: configStore.enemy.anomalyCoeff, anomalyCoeff: configStore.enemy.bossAnomalyCoeff,
      enemyAnomalyResistances: configStore.enemy.anomalyResistances ?? configStore.enemy.resistances ?? {},
      totalTime: configStore.enemy.battleTime ?? 180, invincibleTime: configStore.enemy.invincibleTime,
      enemyDefense: configStore.enemy.defense, enemyDefReduction: 0,
      enemyResistances: configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}, enemyResReduction: 0,
      stunned: stunCov, stunMultiplier: configStore.enemy.stunVuln,
      hasWindChar: wind.hasWindChar, windCharSlot: wind.windCharSlot,
      velinaCinema2CorrosionRate: configStore.getMechanicSetting('velina.cinema2CorrosionRate', 2 / 3),
      globalAnomalyMultiplier: globalAnomalyMultiplier.value,
      coweringConfig: setup?.coweringConfig,
      giftedTriggerCounts: setup && aliceSpark > 0 ? { 'physical_polar_assault': aliceSpark } : undefined,
      giftedTriggerSlot: setup?.slot,
      agentMechanics: getRegisteredAgentMechanics(),
    })
  }

  /** 通用自动轴（用户口径：所有预设队伍都对应预设失衡轴，捏了轴就自动启用）：
   * 按槽位通配匹配 stunAxisPresets 命中即自动选用（章鱼体系按 命座 chapter × 有琉 选档）；
   * 手动配置过轴（条件方案或手动轴）时手动优先，自动让路。 */
  const autoPreset = computed(() => {
    if (!configStore.autoYidhariAxis) return null
    const ids = configStore.team.map(c => c.agentId)
    const cinemaBySlot: Record<number, number> = {}
    configStore.team.forEach((c, i) => { cinemaBySlot[i] = c.cinemaLevel ?? 0 })
    return selectAutoStunAxisPreset(ids, cinemaBySlot)
  })
  const autoActive = computed(() => {
    if (!autoPreset.value) return false
    return configStore.stunAxisPlans.length === 0 && configStore.stunAxes.length === 0
  })

  /** 解析当前轮生效的轴：手动条件轴方案 → 手动 stunAxes → 通用自动预设（按资源量自选） */
  function resolveAxes(stunCount: number, goodReview: number, energyBySlot: Record<number, number>): { axes: StunAxis[]; planName: string | null } {
    const cinemaBySlot: Record<number, number> = {}
    configStore.team.forEach((c, i) => { cinemaBySlot[i] = c.cinemaLevel ?? 0 })
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
      // ⚠ 本判定是「队里有没有琉音」⇒ 同一个身份形状，复用 `findSlotByIdentity`（`>= 0` = 存在，
      // 与 `some` 同义）。**但「转大块归琉音所有」这条知识仍留在编排层**（只是从内联回调收成实参）——
      // 真正的 0 判定形态需模块声明「我拥有 promoteVariant 块」（`backstageAutoFill`/
      // `producesInteractionTopUp` 同族），那要给 `AgentMechanicModule` 加新声明字段 =
      // 改 `src/mechanics/types.ts`，超出本批授权面 ⇒ 本批只做 DRY、把缺口如实挂账。
      const hasLiuyin = findSlotByIdentity(configStore, catalogStore, ['1481']) >= 0
      for (const act of axis.actions) {
        if (act.promoteVariant && !hasLiuyin) continue
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
        // 希格莉德破阵连段（连携命中失衡敌人后长按连放敛枪式一至三段）：
        // 展开成真实三段 id 进时间门控——窗内放得下几套就几套（超窗段被跳过=不吃易伤）；
        // C6 加快 25% → 块时长 ×0.75。免费（不耗闪能/喧响）。
        if (act.moveId === 'sigrid-pozhen') {
          const pzSkills = catalogStore.agentSkillsByAgentMap.get(configStore.team[act.slot]?.agentId ?? '')
          const pzScale = (configStore.team[act.slot]?.cinemaLevel ?? 0) >= 6 ? 0.75 : 1
          for (const segId of SIGRID_LANCE_SEGMENT_IDS) {
            const segMove = findMoveById(pzSkills, segId)
            axisActions.push({ slot: act.slot, moveId: segId, count: act.count, actionTime: (segMove?.actionTime ?? 0) * pzScale, energyCost: 0, decibelCost: 0, startTime: act.startTime ?? 0 })
          }
          continue
        }
        const agentId = configStore.team[act.slot]?.agentId ?? ''
        const skills = catalogStore.agentSkillsByAgentMap.get(agentId)
        const cinema = configStore.team[act.slot]?.cinemaLevel ?? 0
        const combo = getAgentMechanic(agentId)?.combos?.[act.moveId]
        let energyCost = 0
        let actionTime = 0
        let decibelCost = 0
        if (combo) {
          // 连段：能量按打包口径；1命单次 60→50
          energyCost = act.moveId === 'yidhari-heavy-single' && cinema >= 1 ? 50 : combo.energyCost
          for (const mv of combo.moves) {
            const m = findMoveById(skills, mv.moveId)
            actionTime += (m?.actionTime ?? 0) * mv.count
          }
        } else {
          const move = findMoveById(skills, act.moveId)
          const raw = move?.energyCost as Record<string, string> | undefined
          if (raw) {
            for (const k of Object.keys(raw)) {
              const n = parseFloat(raw[k])
              if (!Number.isNaN(n) && n > 0) { energyCost = n; break }
            }
          }
          // 轴块 duration 覆盖倍率表 actionTime（新机制：仪玄轴内凝云术可延长/缩短蓄力 0-2s）
          actionTime = typeof (act as { duration?: number }).duration === 'number'
            ? (act as { duration: number }).duration
            : (move?.actionTime ?? 0)
          // 终结技喧响消耗：读**本槽 cfg 的 ultimateCost**（角色口径，模块在 buildCharConfig
          // 里写自己那份，如佩洛伊斯 1551 = 2000），缺省回落全局默认 3000。
          // 2026-09-15 arch 棘轮：原为 `agentId === '1551' ? 2000 : 3000` 硬编码特判——
          // 而 `specPanelBuffs.ts:174` 早已写 `cfg.ultimateCost = PEILUO_ULT_COST`（2000），
          // 故该 agentId 判断**冗余**（判据同 T6：字段唯一写入方 = 该角色模块 ⇒ 不需要再认人）。
          decibelCost = resolveAxisUltimateDecibelCost(move?.name?.en, resourceConfig.value?.characters, act.slot)
          // 60/90 转大块是琉音好评赠送的终结技（白送，不耗目标喧响），只占窗口时间不扣喧响
          if (act.promoteVariant) decibelCost = 0
        }
        // 雨果强特终结一击（合成行 1291_ex_verdict_final）无倍率表条目：动作时长用模块常量兜底，
        // 保证窗口截断按「块结束时刻」而非「块起点」算剩余失衡时间。
        if (actionTime <= 0 && act.moveId === HUGO_EX_VERDICT_MOVE_ID) actionTime = HUGO_EX_FINAL_ACTION_TIME
        // 窗口终结（决算）：佩洛伊斯右分支 1551016；雨果强特终结一击(1291_ex_verdict_final) 永远结束失衡；
        // 雨果终结技本体(1291018) 仅 C0/C1 结束失衡——影画2「终结技决算不结束失衡」不截断窗口（0命2命区分）。
        const hugoCinema = configStore.team[act.slot]?.cinemaLevel ?? 0
        const endsWindow = act.moveId === '1551016'
          || act.moveId === HUGO_EX_VERDICT_MOVE_ID
          || (act.moveId === HUGO_ULT_MOVE_ID && hugoCinema < 2)
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
   * - 兜底平A填充按槽位映射（伊德海莉映射到蓄力循环的下砸+平A，其余映射到 basic 秒数）。
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
      if (fillerAgentId === '1051') {
        // 伊德海莉：basic_attack 已被改写为「蓄力烧血」（无伤害/失衡），兜底平A映射到蓄力循环的 下砸(1051007)+平A(1051003)
        const skills = catalogStore.agentSkillsByAgentMap.get(fillerAgentId)
        const slam = findMoveById(skills, '1051007')
        const follow = findMoveById(skills, '1051003')
        const loopTime = 1 + (slam?.actionTime ?? 0) + (follow?.actionTime ?? 0)
        const loops = loopTime > 0 ? fillSec / loopTime : 0
        add(slot, '1051007', loops)
        add(slot, '1051003', loops)
      } else if (fillerAgentId === '1041') {
        // 「11号」可分配平A时间：普通火力镇压连打填充（全额时间；A45 快速循环已计入必要时间）。
        // 以 #4 为代表行按「火力镇压均值 × 时间」口径折算。
        const skills = catalogStore.agentSkillsByAgentMap.get(fillerAgentId)
        const rep = findMoveById(skills, '1041008')
        const repT = rep?.actionTime ?? 1.828
        const reps = repT > 0 ? fillSec / repT : 0
        add(slot, '1041008', reps)
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
  moveEnName: unknown,
  chars: ReadonlyArray<{ ultimateCost?: number }> | undefined,
  slot: number,
): number {
  if (!String(moveEnName ?? '').toLowerCase().includes('ultimate')) return 0
  return chars?.[slot]?.ultimateCost ?? ULTIMATE_COST_DEFAULT
}
