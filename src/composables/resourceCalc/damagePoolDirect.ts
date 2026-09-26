/**
 * 逐角色主循环·段 D「逐招直伤」—— 自 `composables/resourceCalc/damagePool.ts#buildDamagePoolRows`
 * 的 :423–671 原样外提（CC-9b，2026-09-25，零行为搬迁）。
 *
 * 职责：`for (const exec of charResult.executions)` 逐招结算直伤（含 `emitExecDirect` 闭包、
 * `seenDirectIds` 去重），以及 `if (isAxis)` 轴内直读技能表兜底。
 *
 * 与外层闭包的通信面 = `CharRowsEnv`：共享输出数组 `rows`（经 `pushDirect` 闭包按原顺序 push，
 * 禁止换成返回值拼接）+ `ctx` 快照 + 只读局部量/闭包（`isAxis` / `axisSlots` / `axisSplitFor` /
 * `pushDirect` / `seenDirectIds` / `xixifuToxinInAxisFraction`）。函数**不** import
 * `./damagePool`（只 `import type` `DamagePoolContext`，运行时无环），也不写任何外层可变量
 * ——`pushDirect` / `seenDirectIds` 自带闭包写共享 `rows`，其余全是只读查询。
 *
 * 依赖方向：本文件不得 import `./damagePool`（值）；只依赖类型与同目录兄弟模块
 * （`./skillRows` / `./panelPhases` / `./helpers`）与引擎子模块（`@/core/*`、`@/mechanics` 等）。
 */
import { panelAt } from '@/core/panel'
import { allocateAxisWindows } from '@/core/stunAxisStack'
import { getAgentMechanic } from '@/mechanics'
import { LIUYIN_EX_MOVE_IDS } from '@/mechanics/agents/liuyin'
import { MINGWANG_BASE_PER_STACK } from '@/mechanics/agents/banyue'
import { getSkillLevelCoef } from '@/core/skillLevel'
import type { Agent, AgentSkills, PanelValues } from '@/types/catalog'
import type { AnomalyEventExecution, CharacterResourceResult } from '@/types/resource'
import { findMoveById } from './skillRows'
import { buildMechanicTeamMembers } from './panelPhases'
import type { DamagePoolRow } from './helpers'
// 纯类型：运行时被擦除，与 damagePool.ts 的 `emitCharDirectRows` 值导入不构成运行时环。
import type { DamagePoolContext } from './damagePool'

/** 循环头（`damagePool.ts` :416–421）定义的 4 个本槽局部量 + charResult。 */
export interface CharLocals {
  charResult: CharacterResourceResult
  slot: number
  agent: Agent | undefined
  skills: AgentSkills | undefined
  liuyinSrc: CharacterResourceResult['liuyinMechanicSource']
}

/** `pushDirect` 的行入参（照 `damagePool.ts` 原内联类型，逐位保留）。 */
export interface DirectRowInput {
  id: string; slot: number; agentId: string; name: string; element: string; source: string; count: number; multiplier: number; note?: string; skillDamageTarget?: any; moveId?: string; critRateBonus?: number; critDmgBonus?: number; dmgBonus?: number; sheerDmgBonus?: number; flatDamageBonus?: number; resIgnore?: number; basisValueOverride?: number; basisLabelOverride?: string; stunOverride?: number; defIgnore?: number; penRatioBonus?: number; sourceTag?: 'gift' | 'stun' | 'self'
}

/** `pushRelease` 的行入参（照 `damagePool.ts` 原内联类型，逐位保留）。 */
export interface ReleaseRowInput {
  id: string; slot: number; agentId: string; name: string; count: number; multiplier: number; source: string; note?: string; element?: string; panel?: PanelValues; settlementPanel?: PanelValues; releaseCrit?: AnomalyEventExecution['releaseCrit']; stunnedOverride?: number
}

/** 三段共用的显式环境：把原 `buildDamagePoolRows` 里被主循环三段读取的闭包量显式化（调用期间不变）。 */
export interface CharRowsEnv {
  ctx: DamagePoolContext
  /** 共享输出数组：按原顺序 push，禁止换成返回值拼接 */
  rows: DamagePoolRow[]
  /** 调用处传 `Boolean(isAxis)`（三段只作真值判断） */
  isAxis: boolean
  /** 轴内涉及的槽位（`damagePool.ts` 入口按 `allocMap` 算出） */
  axisSlots: Set<number>
  /** 把一个 (slot, moveId) 的总单位数切成轴内/轴外两段 */
  axisSplitFor: (slot: number, moveId: string, totalUnits: number) => { inUnits: number; outUnits: number }
  /** 伴随事件易伤 0/1（非轴回落全局覆盖率） */
  axisStunFor: (moveId: string) => number
  /** 直伤行结算并 push 进共享 `rows` */
  pushDirect: (row: DirectRowInput) => void
  /** 异放行结算并 push 进共享 `rows` */
  pushRelease: (row: ReleaseRowInput) => void
  /** 解析异放倍率（固定 releaseMultiplier 或「原异常单次倍率 × 比例」） */
  releaseMultiplierFor: (event: AnomalyEventExecution, element: string, triggerPanel: PanelValues, stunCov: number) => number
  /** 失衡内 dominant 归因候选（时间线实际活跃元素） */
  inStunAttributionCandidates: () => Array<{ element: string; autoRatio: number }>
  /** 异放失衡易伤拆分（失衡内全额 / 轴外无易伤） */
  releaseStunSegments: (event: AnomalyEventExecution, element: string, count: number, carrierInAxisFraction?: number) => Array<{ count: number; stunned: number; suffix: string; tag: string }>
  /** 同 slot 同 moveId 多行 id 去重计数（原地变更） */
  seenDirectIds: Map<string, number>
  /** 希希芙蚀骨轴内占比 */
  xixifuToxinInAxisFraction: (slot: number, cr: any) => number
  /** 槽位显示名 */
  agentName: (agentId: string, slot: number) => string
  /** 终极技轴内占比（琉音6命余音等「终结技驱动附伤」） */
  ultimateInAxisFraction: (slot?: number) => number
}

/**
 * 段 D「逐招直伤」（零行为搬迁，CC-9b）。
 * 函数体 = 原 `buildDamagePoolRows` :423–671 逐字保留（仅去 4 空格公共缩进），
 * 只在头部解构 `env.ctx` / `env` / `cl`；其余表达式一字不改。
 */
export function emitCharDirectRows(env: CharRowsEnv, cl: CharLocals): void {
  const {
    configStore, catalogStore,
    damagePanels, stunCoverage, axisAllocation: allocMap, attachedInAxisMap: attachedInAxis,
    stunPoolResult, effectiveStunAxes,
    banyueMingwangStacks, yixuanNingshenMap, peiluoKagerouMap, corinStunBonusMap,
    axisScalarBySlot,
  } = env.ctx
  const {
    isAxis, axisSlots, axisSplitFor, pushDirect, seenDirectIds, xixifuToxinInAxisFraction,
  } = env
  const { charResult, slot, agent, skills, liuyinSrc } = cl

  for (const exec of charResult.executions) {
    if ((exec.damageMultiplier ?? 0) <= 0) continue
    // 秒均行（普通平A basic_attack 等）：count=0、totalTime=秒数、damageMultiplier=秒均倍率%。
    // 伤害 = 秒均倍率 × 时间，按 1 次、总倍率结算（通用逻辑：所有角色平A都是秒均倍率算的）。
    const isPerSecondRow = exec.count <= 0 && (exec.totalTime ?? 0) > 0
    if (!isPerSecondRow && exec.count <= 0) continue
    // 琉音三个强特（石头/剪刀/布）在非失衡轴模式下由下方专用块按“失衡次数”拆分易伤，跳过通用直伤。
    // 2026-09-17 round 21 夜 A 编排层棘轮：原判据 `charResult.agentId === '1481' && !isAxis && LIUYIN_EX_MOVE_IDS.has(…)
    // ⇒ **agentId 项删除**、只留 `liuyinSrc && !isAxis && LIUYIN_EX_MOVE_IDS.has(…)`。
    // 为什么这不是简单字段门控的「顺手去冗余」：本行的语义是「**跳过通用路径**，把结算权交给下方
    // 专用块」——故 `liuyinSrc` 在这里必须同时证明「下方专用块确实会重放本行」，否则删掉 agentId
    // 会让某些行**两边都不算**（静默少伤）。两件事同源，逐一证明：
    //   ① 行归属：`1481011/12/13` 在 catalog 里**只属于 1481 的 special 段**（`agentSkills` 实测
    //      62 个角色中 owner 唯一 = 1481，`occurrences === 1`）⇒ 非 1481 槽位不可能存在这三行。
    //      且 `liuyin.ts` 是它们的**唯一产行方**（`cfg.skipGenericExSpecial = true` 关掉通用强特行，
    //      故引擎不会按 `exSpecialMoveId` 另发一版；`buildLiuyinExecutions` 按 1→3 连打 push）。
    //   ② 重放条件：下方专用块 = `if (liuyinSrc && !isAxis) {…}`，**与本行门控的共用项完全一致**
    //      （同一个 `liuyinSrc`、同一个 `!isAxis`）⇒ 本行 `continue` 时专用块必然执行，且其
    //      `exMult` 表正是遍历 `charResult.executions` 里 `LIUYIN_EX_MOVE_IDS` 且有倍率的行构建的
    //      ⇒ 被跳过的行**必然**被重放（`mult(moveId) > 0` 成立）。无「两边都不算」的第三态。
    //   ③ 赠链/赠大不会把这三行搬到别人槽位：诺姆赠链搬的是**目标队友自己的连携技** moveId
    //      （`normaHatChain.ts` 取 `findChainAttack(targetSkills)`），琉音赠大搬的是**目标队友的终结技**
    //      （`liuyinPromote.ts` 取 `ultimateMoveId`）——两者都取「目标自己的招」，不会产生 1481 的强特行。
    if (liuyinSrc && !isAxis && LIUYIN_EX_MOVE_IDS.has(exec.moveId)) continue
    const move = findMoveById(skills, exec.moveId)
    const mechanic = getAgentMechanic(charResult.agentId)
    // 2026-09-16 编排层棘轮（R15-a）：柏妮思影画4/6 原在此处按 `charResult.agentId === '1171'`
    // 取本槽命座并写行级 `exec.critRateBonus`/`exec.resIgnore` —— 已迁进
    // `burnice.ts#patchBurniceExecutions`（读模块自己 cfg 的 burniceCinemaLevel，通道不变）。
    const critRateBonus = exec.critRateBonus ?? 0
    const critDmgBonus = exec.critDmgBonus ?? 0
    // 招式限定抗性无视：执行字段（各模块 patchExecutions 写入，如仪玄影画2 终/强特 15% 以太减抗、
    // 柏妮思 C6 双喷 25% 火抗无视）
    const resIgnore = exec.resIgnore ?? 0
    const resolved = mechanic?.resolveExecutionDamage?.({
      slot,
      agent: agent ?? null,
      skills,
      move,
      exec,
      team: buildMechanicTeamMembers(configStore, catalogStore),
      cinemaLevel: configStore.team[slot]?.cinemaLevel ?? 0,
      potentialLevel: configStore.team[slot]?.potentialLevel ?? 6,
    })
    const element = resolved?.element ?? move?.damageElement ?? agent?.damageElement ?? 'physical'
    const execPanel = panelAt(damagePanels, slot)
    const execSkillLevelBonus = execPanel?.skillLevelBonus ?? 0
    const execDamageCoef = execSkillLevelBonus > 0 ? getSkillLevelCoef(execSkillLevelBonus).damageCoef : 1
    // 同 slot 同 moveId 多行（如诺姆膛温替换连携 vs 通用连携）id 加序号去重
    const baseId = `direct-${slot}-${exec.moveId}`
    const dup = seenDirectIds.get(baseId) ?? 0
    seenDirectIds.set(baseId, dup + 1)
    const rowId = dup > 0 ? `${baseId}-${dup}` : baseId
    const unitMultiplier = (exec.damageMultiplier ?? 0) * execDamageCoef
    const totalUnits = isPerSecondRow ? (exec.totalTime ?? 0) : exec.count
    const baseNote = `${resolved?.note ?? exec.skillTableNote ?? ''}${isPerSecondRow ? '（平A：秒均倍率 × 时间）' : ''}${execSkillLevelBonus > 0 ? ` · 技能等级系数×${execDamageCoef.toFixed(4)}` : ''}`
    const emitExecDirect = (units: number, stunOverride: number, idSuffix: string, extraNote: string, sourceTag?: 'gift' | 'stun' | 'self') => {
      if (units <= 0 || unitMultiplier <= 0) return
      // 本槽的标量覆盖（非轴折算臂 + 与轴无关的标量臂）。**按槽位取**——这些值对全角色全部行同值，
      // 没有 moveId 可索引，合并成裸标量会泄漏给队友行（见 `AxisScalarOverlays` 头注释）。
      const overlayScalar = axisScalarBySlot.get(slot)
      // 般岳明王：6命满覆盖（applyPanel 全局 +39%）；非6命轴模式按时间轴扫描层数（8s 窗口，怒相二连触发）；
      // 非6命非轴模式按覆盖率滑块近似（满层3×5%×覆盖率）。
      // 2026-09-16 round 16 编排层棘轮：原 `charResult.agentId === '1471'` + `additionalAbilityActive` +
      // `cinemaLevel < 6` 三重门控已迁进 `banyue.ts#axisWindowOverlays`（两臂都由模块给：
      // 轴臂 → 桶（层数）/ 非轴臂 → `banyueMingwangPct` 标量）。此处只剩「轴/非轴选哪条臂」。
      let mingwangDmgBonus = 0
      if (isAxis) {
        const stacks = banyueMingwangStacks.get(exec.moveId ?? '') ?? 0
        if (stacks > 0) mingwangDmgBonus = stacks * MINGWANG_BASE_PER_STACK
      } else {
        mingwangDmgBonus = overlayScalar?.banyueMingwangPct ?? 0
      }
      // 可琳额外能力扫除帮手：命中失衡敌人自身伤害+35%。
      // 轴模式按 buff 轴扫描（轴内所有招式都在失衡窗口内，普攻段归并 basic_attack 聚合行键），
      // 且只吃轴内段（stunOverride=0 的轴外段敌人未失衡，不符合「命中失衡敌人」条件）；
      // 非轴模式按覆盖率滑块近似（默认 0.5，用户口径）。
      // 2026-09-16 round 16 编排层棘轮：原 `charResult.agentId === '1061'` + `additionalAbilityActive`
      // 门控已迁进 `corin.ts#axisWindowOverlays`；此处保留 `stunOverride > 0` 的**段级**门控
      // （轴外段不吃，与角色判据无关）。
      let corinStunBonus = 0
      if (isAxis) {
        corinStunBonus = stunOverride > 0 ? (corinStunBonusMap.get(exec.moveId ?? '') ?? 0) : 0
      } else {
        corinStunBonus = overlayScalar?.corinStunBonusPct ?? 0
      }
      // 希格莉德额外能力·天际联军：命中[浸染]敌人伤害+15% × 风化侵染覆盖率
      // （用户口径 2026-02：直接读风化覆盖率；无风角色=0）。
      // 2026-09-16 round 16 编排层棘轮：**与轴模式无关**（原分支里 `isAxis` 不出现）⇒
      // 整支迁进 `sigrid.ts#axisWindowOverlays`，此处只剩取值。
      const sigridInfectionBonus = overlayScalar?.sigridInfectionPct ?? 0
      // 悠真额外能力（失衡/异常并集 +40%）：轴模式「失衡专属 buff 轴内直加」（2026-09-03，
      // 可琳扫除帮手同款分段通道）——patchHarumasaExecutions 已把公共异常部分（40×异常覆盖率）
      // 摊入全部行，这里只补失衡独有部分 40×(1−异常覆盖)，且仅轴内段（stunOverride>0，敌人失衡）加；
      // 轴外段敌人未失衡、只吃异常部分。非轴走 patch 并集口径（不加此处）。
      let harumasaStunOnlyBonus = 0
      // 2026-09-15 编排层棘轮：原判据 `charResult.agentId === '1201' && isAxis && exec.harumasaStunOnly !== undefined`。
      // agentId 判断**冗余**——该字段的唯一写入方 = `harumasa.ts:329` 的 patchExecutions
      // （只在 `cycle.axisActive` 时写自己的行）⇒ 字段存在即蕴含「是悠真且轴模式」（判据同 T6）。
      if ((exec as any).harumasaStunOnly !== undefined) {
        harumasaStunOnlyBonus = stunOverride > 0 ? Math.max(0, Number((exec as any).harumasaStunOnly)) : 0
      }
      // 仪玄凝神：三臂（C6满覆盖 / 非C6轴内扫描 / 非C6非轴折算）**全在模块**
      // （`yixuan.ts#axisWindowOverlays`）——C6 臂与非轴臂产「本槽全行同值」的标量
      // `yixuanNingshen`（走 `scalarBySlot`，避免泄漏给队友行），非 C6 轴臂产 moveId 桶。
      // 2026-09-17 round 21 夜 A 编排层棘轮：原判据 `charResult.agentId === '1371' &&
      // (execPanel?.additionalAbilityActive ?? 0) > 0` 三重门控 + 三臂已整段迁进模块
      // （T7 裁决把注册 default 与伤害池 fallback 归一为 0.5 ⇒ 迁移 0 delta）。
      // ⚠ 按槽位取标量（这些值对全角色全部行同值，裸标量会泄漏给队友行）。
      const yixuanNingshen = overlayScalar?.yixuanNingshen
        ?? (isAxis ? yixuanNingshenMap.get(exec.moveId ?? '') : undefined)
        ?? { critDmg: 0, sheerDmg: 0 }
      // 佩洛伊斯阳炎：轴模式按 buff 轴扫描（上分支后 21s 窗口，仅上分支/决算终结吃）；
      // 非轴模式 = `40 × 覆盖率滑块`（模块标量）× **行级配对比例**。
      // 2026-09-17 round 21 夜 A 编排层棘轮：原判据 `charResult.agentId === '1551'`
      // + 两臂已整段迁进 `specPanelBuffs.ts#peiluoProminenceMechanic.axisWindowOverlays`
      // （轴臂 → `peiluoKagerouMap` 桶 / 非轴臂 → `peiluoKagerouPct` 标量）。
      // ⚠ 配对比例**留在行上**（`peiluoKagerouPairRatio` 的唯一写入方 = 本角色模块的
      // `patchExecutions`）——它逐 moveId 不同（只有决算 `1551016` 乘
      // `min(上分支,决算)/决算`），进不了「全行同值」的标量，故消费端在此乘回：
      // `标量 × 行级比例` 即原式 `PEILUO_KAGEROU_CRIT × 覆盖率 × 配对比例`，逐位等价。
      const peiluoPairRatio = exec.moveId === '1551016' ? ((exec as any).peiluoKagerouPairRatio ?? 0) : 1
      const peiluoKagerouCrit = isAxis
        ? (peiluoKagerouMap.get(exec.moveId ?? '') ?? 0)
        : (overlayScalar?.peiluoKagerouPct ?? 0) * peiluoPairRatio
      pushDirect({
        id: `${rowId}${idSuffix}`,
        slot,
        agentId: charResult.agentId,
        name: exec.moveName,
        element,
        source: resolved?.source ?? exec.moveId,
        count: isPerSecondRow ? 1 : units,
        multiplier: unitMultiplier * (isPerSecondRow ? units : 1),
        note: `${baseNote}${extraNote}${mingwangDmgBonus > 0 ? ` · 明王+${mingwangDmgBonus.toFixed(1)}%${isAxis ? '（轴内覆盖）' : '（覆盖率近似）'}` : ''}${corinStunBonus > 0 ? ` · 失衡增伤+${corinStunBonus.toFixed(1)}%${isAxis ? '（buff轴）' : '（覆盖率近似）'}` : ''}${harumasaStunOnlyBonus > 0 ? ` · 失衡增伤+${harumasaStunOnlyBonus.toFixed(1)}%（轴内直加）` : ''}${sigridInfectionBonus > 0 ? ` · 浸染增伤+${sigridInfectionBonus.toFixed(1)}%（风化覆盖率×15%）` : ''}${yixuanNingshen.critDmg > 0 ? ` · 凝神暴伤+${yixuanNingshen.critDmg.toFixed(0)}%${isAxis ? '（buff轴）' : '（覆盖率近似）'}` : ''}${yixuanNingshen.sheerDmg > 0 ? ` · 凝神贯穿+${yixuanNingshen.sheerDmg.toFixed(0)}%` : ''}`,
        moveId: exec.moveId,
        critRateBonus,
        critDmgBonus: critDmgBonus + yixuanNingshen.critDmg + peiluoKagerouCrit,
        dmgBonus: (exec.dmgBonus ?? 0) + mingwangDmgBonus + corinStunBonus + sigridInfectionBonus + harumasaStunOnlyBonus,
        sheerDmgBonus: (exec.sheerDmgBonus ?? 0) + yixuanNingshen.sheerDmg,
        flatDamageBonus: exec.flatDamageBonus,
        basisValueOverride: exec.basisValueOverride,
        basisLabelOverride: exec.basisLabelOverride,
        resIgnore,
        defIgnore: exec.defIgnore ?? 0,
        penRatioBonus: exec.penRatioBonus,
        skillDamageTarget: exec.skillDamageTarget,
        stunOverride,
        sourceTag: sourceTag ?? exec.source,
      })
    }
    if (isAxis && exec.chainGift) {
      // 诺姆膛温换连携（赠送连携招式=上一位队友本人的连携技，注入时带 chainGift 标记）：
      // 吃失衡易伤的次数 = 轴内实际执行的赠块数（':gift' 后缀 key，受窗口时间门控：占时间、超窗跳过）
      // 或旧表达 norma-hat-chain 标记块；其余赠送在失衡外触发、不吃易伤。
      let giftInUnits = 0
      for (const [key, alloc] of Object.entries(allocMap)) {
        if (key.endsWith(':norma-hat-chain') || key.endsWith(':gift')) giftInUnits += alloc.inAxisUnits
      }
      const inUnits = Math.min(totalUnits, Math.max(0, giftInUnits))
      emitExecDirect(inUnits, 1, '', '', exec.source)
      emitExecDirect(totalUnits - inUnits, 0, '-out', ' · 轴外（无失衡易伤）')
    } else if (isAxis && exec.autoSplitByStun) {
      // CD 驱动的后台自动行（通用机制，如猫又超凶爪印每秒 dot）：不按捏轴认领、无放置语义，
      // 轴模式改按失衡时间占比拆「占比内吃满易伤 / 其余无易伤」（非轴模式本就走全局覆盖率）。
      // 附加在特定招式上的事件不走此路——它们经 attachedEvents 跟随父动作判断是否在轴内。
      const inUnits = Math.min(totalUnits, Math.round(totalUnits * Math.max(0, Math.min(1, stunCoverage))))
      emitExecDirect(inUnits, 1, '', ' · 失衡内（CD自动行按占比）')
      emitExecDirect(totalUnits - inUnits, 0, '-out', ' · 轴外（CD自动行按占比，无易伤）')
    } else if (isAxis && axisSlots.has(slot) && (exec.moveId === '1521019' || exec.moveId === 'xixifu_shigu_special')) {
      // 希希芙蚀骨：失衡内回复的毒素由蛇吻手动消耗 → 全部在失衡内爆发（吃满易伤），其余轴外无易伤
      const frac = xixifuToxinInAxisFraction(slot, charResult)
      const inUnits = Math.min(totalUnits, Math.round(totalUnits * frac))
      emitExecDirect(inUnits, 1, '', ' · 失衡内毒素爆发')
      emitExecDirect(totalUnits - inUnits, 0, '-out', ' · 轴外毒素（无失衡易伤）')
    } else if (isAxis && axisSlots.has(slot) && attachedInAxis[exec.moveId] !== undefined) {
      // **伴随事件**（附伤/异放，注册面 = 模块的 `attachedEvents`）：自身不占轴内块，
      // 故不能按自己的 moveId 查 `axisSplitFor`（查不到 ⇒ 整段被判轴外、零易伤）。
      // 改按**父动作的轴内占比**拆段——`attachedInAxisMap` 已把 child → frac 算好
      // （frac = Σ父动作轴内单位 / Σ父动作全局总单位，与直伤 `axisSplitFor` 同源）。
      //
      // ⚠ 2026-09-17 用户口径：「附伤或者异放等事件需要绑定轴内的动作块，以此计算易伤数量」。
      // 本分支即该口径的通用落点（此前只有 5 处**逐 moveId 硬编码**的 `axisStunFor` 调用，
      // 模块自己产的附伤行**没有通用通道** ⇒ 未登记的附伤在轴内恒零易伤）。
      // 实测漏计样本：橘福福影画6 爆米花（`1391_c6_popcorn`，由旋转 `1391010` 驱动）
      // 252 次、占总伤 **21.73%**，补注册+本分支后才有易伤。
      const attachFrac = Math.max(0, Math.min(1, attachedInAxis[exec.moveId]!))
      const inUnits = Math.min(totalUnits, Math.round(totalUnits * attachFrac))
      emitExecDirect(inUnits, 1, '', ' · 失衡内（伴随事件跟随父动作）')
      emitExecDirect(totalUnits - inUnits, 0, '-out', ' · 轴外（伴随事件跟随父动作）')
    } else if (isAxis && axisSlots.has(slot)) {
      // 捏轴：把总单位切成轴内（易伤=1）/轴外（易伤=0）两段
      const split = axisSplitFor(slot, exec.moveId, totalUnits)
      emitExecDirect(split.inUnits, 1, '', '', exec.source)
      emitExecDirect(split.outUnits, 0, '-out', ' · 轴外（无失衡易伤）')
    } else {
      // 兜底臂 = **轴模式下未进轴的槽位**（如换的辅助、没捏进轴）或**非轴模式**。
      // 2026-09-16 round 17 编排层棘轮（R15-c）：原来这里住着两条 `charResult.agentId` 判据
      // （`:567` 叶瞬光关键招满易伤 / `:570` 雨果非轴白名单），现已迁进各自模块的
      // `stunOverrideForMove`（唯一写入方 = 本角色模块 ⇒ 判据同 T6）。此处只做「认领 / 不认领」分流。
      // ⚠ 两处的 `isAxis` 口径**刻意不对称**（叶瞬光无 `!isAxis` 项、雨果有）：叶瞬光那一支在
      // 轴模式下**未进轴槽位**也会命中（`axisSlots.has(slot)` 为假 ⇒ 外层链落到这里），
      // 故 `isAxis` 必须原样递进模块、不能在本层先判 —— 顺手统一 = 静默改行为。
      const claimed = mechanic?.stunOverrideForMove?.({ slot, moveId: exec.moveId, isAxis: !!isAxis })
      if (claimed) {
        emitExecDirect(totalUnits, claimed.stunOverride, '', claimed.note, exec.source)
      } else {
        // 未进轴的槽位（如换的辅助、没捏进轴）按全局覆盖率单独算
        emitExecDirect(totalUnits, stunCoverage, '', '', exec.source)
      }
    }
  }

  // 轴内直读技能表（通用兜底）：动作池「[表]」块被放置但模块未生成执行行的招式——
  // 按放置块数×窗口数出直伤（吃全额易伤）；不占时间预算、窗内不产失衡值（引擎既定口径）
  if (isAxis) {
    const backed = new Set(charResult.executions.map(e => e.moveId))
    const tblAlloc = allocateAxisWindows(effectiveStunAxes, Math.round(stunPoolResult?.stunCount ?? 0))
    const placedTable = new Map<string, number>()
    effectiveStunAxes.forEach((axis, ai) => {
      const wins = tblAlloc[ai] ?? 0
      for (const act of axis.actions) {
        if (act.slot !== slot) continue
        const mid = act.moveId
        if (backed.has(mid) || !/^\d+$/.test(mid)) continue
        placedTable.set(mid, (placedTable.get(mid) ?? 0) + Math.max(0, Math.floor(act.count || 1)) * wins)
      }
    })
    const tblSkills = catalogStore.agentSkillsByAgentMap.get(configStore.team[slot]?.agentId ?? '')
    for (const [mid, count] of placedTable) {
      if (count <= 0) continue
      const move = findMoveById(tblSkills, mid)
      const dmgRow = (move?.rows ?? []).find((r: any) => r.kind === 'damageMultiplier')
      const mult = Number(dmgRow?.values?.[0] ?? 0)
      if (!move || !(mult > 0)) continue
      pushDirect({
        id: `direct-${slot}-${mid}-table`,
        slot, agentId: charResult.agentId,
        name: `${move.name?.zhCN || mid}（表）`,
        element: move.damageElement ?? catalogStore.agentsMap.get(charResult.agentId)?.damageElement ?? 'physical',
        source: '轴内·技能表直读',
        count, multiplier: mult,
        note: '该招式未单独建模：按技能表倍率直读，吃失衡易伤；不占时间预算、窗内不产失衡值',
        moveId: mid,
        stunOverride: 1,
      })
    }
  }

}
