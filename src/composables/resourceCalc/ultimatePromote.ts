/**
 * 琉音「好评转大」编排簇（从 useResourceCalc 抽离，纯函数化）。
 *
 * 因果链：抱拳（客诉）命中 → 好评≥90 打开大招选择窗口 → 60 转大（有连携窗口：替换目标队友连携）
 * 或 90 转大（无窗口：白送终结技）。转大终结技 daze 进失衡池 → 失衡次数变 → 60 抱拳默认按
 * 失衡次数 → 转大次数变（正反馈）；开窗次数（阈值结转，见 computeLiuyinHugCounts）有界，正反馈单调
 * 有界必收敛（MAX_PROMOTE_ITER 轮兜底）。倍率表全走目标队友执行计划自然调用。
 */
import { calcStunPool, continuousStunCount, withStunCount } from '@/core/stunPool'
import { effectiveBattleTime, stunWindowDuration, stunWindowFraction } from '@/core/effectiveTime'
import type { StunSkillExecution } from '@/core/stunPool'
import { findUltimate, findChainAttack, fusedGroupActionTime } from '@/core/resource'
import { fusedRowReader } from '@/data/moveTableQueries'
import { supplyTargetTeamSlot } from '@/core/resource/crossAgentSupply'
import type { AgentMechanicModule } from '@/mechanics/types'
import type { CharacterOperationConfig, TeamResourceResult, StunPoolResult } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import type { ConfigModel } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
// 招式行取值簇（C 簇）已迁 `./skillRows`（R22 熵批 2 / R22-S2 刀 B）——同目录兄弟模块
// 直接指真实现，不走 `./helpers` 的 re-export 壳（壳只服务目录外的既有消费者面）。
import { findMoveById, fusedRowValue, getRowValue } from './skillRows'
import { buildGiftRow } from '@/core/resource/giftRows'
import { getAgentMechanic } from '@/mechanics'

/** 琉音好评转大不动点迭代上限（好评≥90 开窗次数有界，正反馈单调收敛，8 轮兜底极端情况） */
const MAX_PROMOTE_ITER = 8

/** 琉音好评转大参数（从某轮资源池结果构建：目标队友、连携/终结技 moveId、好评总量、客诉抱拳数） */
export interface UltimatePromoteParams {
  goodReviewTotal: number
  hug60Setting: number
  targetSlot: number
  chainMoveId: string
  ultimateMoveId: string
  chainCountPerStun: number
  ultDaze: number
  ultElement: string
}

export interface PromoteFixpointResult {
  /** CC-421：恒非 null——`calcStunPool` 无 null 出口且不动点循环至少跑一轮。 */
  pool: StunPoolResult
  hug60: number
  promote: number
  targetSlot: number
  chainMoveId: string
  ultimateMoveId: string
}

export interface PromoteFixpointDeps {
  configStore: ConfigModel
  panels: PanelValues[]
}

/**
 * 叠加琉音好评转大修正的资源池结果：
 * 60 转大 → 目标队友连携 -1、终结技 +1（替换）；90 转大 → 终结技 +1（白送）。
 * 倍率表 damage/daze/anomaly_buildup 由目标队友执行计划自然调用。
 * adj 来自 promoteFixpoint 的收敛结果（runCalcRound 的 R0/R1 内层不动点）。
 */
// @fact engine:实战档位喧响计数 口径: 「实战 N 喧响大」这类档位说法（含「叶释渊 3 例外」）的**口径主体 = 主C 自攒喧响 floor(总/消耗)，不计琉音好评赠大**——赠大只加进展示 `ultimateCount` 并独立成 `source='gift'` 行，是队友产出、不是自己攒的条。实测 Boss 30042（无敌24s/弹刀13）下：叶瞬光自攒 11227 → 3 ✓ 正落该档；仪玄自攒 12087 → 4，超 3 档线仅 87 喧响（边界敏感，**不据此改账**） | 据 用户@2026-09-08（裁决「不计琉音赠大，看自攒 floor」）·复核@2026-09-25·复核@2026-09-27·复核@2026-09-30 | 验 src/composables/__tests__/giftConsumption.test.ts | 锚 src/composables/resourceCalc/ultimatePromote.ts#applyUltimatePromote | 信 确认
export function applyUltimatePromote(
  base: TeamResourceResult,
  adj: { promote: number; hug60: number; targetSlot: number; chainMoveId: string; ultimateMoveId: string } | null,
  catalogStore: ReturnType<typeof useCatalogStore>,
): TeamResourceResult {
  // CC-422：`base` 恒非 null（唯一调用点 convergence 传本轮 rr），返回也恒非 null。
  // 引擎占位行（阶段1 ②）以**池口径**为准：转大次数为 0 时撤掉占位行（引擎推导在退化配置下会多算）
  const promote = adj && adj.targetSlot >= 0 ? adj.promote : 0
  if (promote <= 0 || !adj) {
    if (!base.characters.some(c => (c.executions ?? []).some(e => e.source === 'gift' && !e.chainGift))) return base
    return {
      ...base,
      characters: base.characters.map(c => ({
        ...c,
        executions: (c.executions ?? []).filter(e => !(e.source === 'gift' && !e.chainGift)),
      })),
    }
  }
  const { targetSlot, ultimateMoveId } = adj
  /** CC-145：实际留给赠行的秒数（退还后）；undefined = 未触发退还，沿用引擎值 */
  let reservedUsed: number | undefined
  const out: TeamResourceResult = {
    ...base,
    characters: base.characters.map(char => {
      if (char.slot !== targetSlot) return char
      const skills = catalogStore.agentSkillsByAgentMap.get(char.agentId)
      const ultMoveDef = findMoveById(skills, ultimateMoveId)
      // 赠的是目标自己的终结技 ⇒ 伤害定向随招走：模块声明覆盖优先（零号·安比终结技 = 追加攻击）
      const ultTarget = getAgentMechanic(char.agentId)?.skillDamageTargetOverrides?.[ultimateMoveId] ?? 'ultimate'
      // 转大送出的是「一次完整终结技」：多段终结技（登记融合组，如照·兔兔连斩 #1+#2、
      // 妮可 特制以太榴弹 炮击+能量场）必须取整段倍率与站场时长，只取主段=赠送了半招。
      const fusedOf = (rowId: string) =>
        fusedRowValue(skills, ultimateMoveId, rowId)
        ?? getRowValue(ultMoveDef, rowId) // CC-239：单段回落也吃逻辑编辑器行规则（与 fusedRowValue 分段取值、helpers 主执行同源）
      const ultMult = fusedOf('damage')
      const ultBuildUp = fusedOf('anomaly_buildup')
      const ultActionTime = (skills ? fusedGroupActionTime(skills, ultimateMoveId) : null)
        ?? ultMoveDef?.actionTime ?? 0
      // 转大的终结技是真实动作（目标队友打一次终结技），必须占用前台时间——曾写死 0
      // 导致时间表/资源利用率页看不到转大耗时（用户 2026-09 般琉卢排查）。
      // 时间从目标的平A池挤出（basicAttackTime 扣减），总前台占用守恒，
      // 不额外撑破战斗预算（否则会误触轴退化判定，般岳等轴测试依赖该守恒）。
      const promoteTime = ultActionTime * promote
      // 2026-09-06：非轴模式下赠链时间已由引擎预留（iterate 必要时间计入 promote × 目标终结技时长、
      // 平A池随之收缩——守恒在引擎侧成立，见 TeamResourceResult.ultimateGiftTimeReserved）。
      // 旧 post-hoc carve 只抠 basic_attack 聚合行，目标平A时间住在分段行里时（希格莉德枪尖/
      // 般岳焚身/琉音猜拳）聚合行被抠剩 ~0 → 守恒破、净占用 +7.2s（实测 auto-1591-1481-1311）。
      // 轴模式无预留（轴内 60/90 转大次数由轴预设决定），保留旧 carve 路径。
      const reserved = (base as { ultimateGiftTimeReserved?: number }).ultimateGiftTimeReserved ?? 0
      // CC-145（第 169 轮）**预留退还**：引擎账本按 `ultimateGiftOf`（目标连携数 = cps × 计数失衡，
      // 装配截断**之前**的量）预留赠行，本处 `promote` 按池口径（`promoteFixpoint` 的目标连携数取
      // 上一轮**装配后**的连携行数）。连携被截断时 60 转大窗口变少 ⇒ promote < 引擎次数，多留的秒数
      // 既不在赠行里、也不在平A里 ⇒ 「账本预留 ≠ 装配赠行」（实测 physical 下 auto-1431-1481-1491：
      // 预留 5 次 / 好评 363 只够 2×60+2×90，第 5 次不可行）。差额退回目标平A行（与下方 carve 对称），
      // 并把输出的 `ultimateGiftTimeReserved` 改成实际用量 ⇒ 预留 ≡ 赠行。目标没有 `basic_attack` 聚合行
      // （叶瞬光：平A全是模块分段行、`basicAttackTime` = 0）时差额留作空闲（前台 < 账本，行 ≤ 账本照样成立）。
      // 反向（promote > 引擎次数）不在此处理：那会让行超账本，交给截断口径。
      const refundWanted = reserved > 0 ? Math.max(0, reserved - promoteTime) : 0
      const basicIdx = reserved > 0
        ? (refundWanted > 1e-9 ? char.executions.findIndex(e => e.moveId === 'basic_attack') : -1)
        : char.executions.findIndex(e => e.moveId === 'basic_attack')
      const basicTime = basicIdx >= 0 ? (char.executions[basicIdx].totalTime ?? 0) : 0
      const carve = reserved > 0 ? 0 : Math.max(0, Math.min(basicTime, promoteTime))
      const refund = reserved > 0 && basicIdx >= 0 ? refundWanted : 0
      if (refundWanted > 1e-9) reservedUsed = reserved - refundWanted
      // 轴即最终次数：连携次数已从轴直接读出（N），60/90 转大只叠加赠送大招，不再「连携-1 大招+1」改写。
      // 转大白送的终结技独立成行（source='gift'），不并入目标原始终结技行——否则赠送归因（击破手对比的 gift 列）会丢失。
      // 阶段1 ②（2026-09-10）：**行由引擎物化**（存在/行序），本函数补倍率 + carve，并把
      // 计数/时长**以池为准**写回（引擎推导在退化配置下会与池不同）；找不到行时兜底追加。
      // CC-336：与上方 `promote <= 0` 分支一致加 `!e.chainGift` 门控，统一经 `buildGiftRow` 构造行字段。
      const giftIdx = char.executions.findIndex(e => e.source === 'gift' && !e.chainGift && e.moveId === ultimateMoveId)
      const giftRow = buildGiftRow({
        moveId: ultimateMoveId,
        moveName: '好评转大·队友终结技',
        count: promote,
        actionTime: ultActionTime,
        comboAlignRatio: giftIdx >= 0 ? (char.executions[giftIdx].comboAlignRatio ?? 0) : 0,
        damageMultiplier: ultMult,
        anomalyBuildUp: ultBuildUp,
        skillDamageTarget: ultTarget,
        skillTableNote: '好评转大：赠送队友终结技（白送，不耗喧响/能量）',
      })
      const patched = char.executions.map((e, i) => {
        if (i === basicIdx) return { ...e, totalTime: Math.max(0, (e.totalTime ?? 0) - carve + refund) }
        if (i !== giftIdx) return e
        return { ...e, ...giftRow }
      })
      return {
        ...char,
        ultimateCount: (char.ultimateCount ?? 0) + promote,
        executions: giftIdx >= 0 ? patched : [...patched, giftRow],
      }
    }),
  }
  return reservedUsed === undefined ? out : { ...out, ultimateGiftTimeReserved: reservedUsed }
}

/**
 * 赠终结技提供者槽位（CC-35d-B3 2026-09-27；原按身份 `findSlotByIdentity(['1481'])`）：
 * 首个实现模块能力 `ultimateGiftSource` 的在队槽位，无则 -1。本库 teammateBuffId 均等于自身 id，与原查找等价。
 */
export function ultimateGiftProviderSlot(configStore: ConfigModel): number {
  return configStore.team.findIndex(m => !!m.agentId && !!getAgentMechanic(m.agentId)?.ultimateGiftSource)
}

/** 提供者槽位 + 本轮赠大来源（好评总量）；无提供者或本轮无来源时 null（CC-35d-B3） */
/**
 * CC-43c（2026-09-27）：赠大提供者模块的转大次数算法（能力 `promoteHugCounts`）；队伍无提供者或提供者未实现时 undefined。
 * 替代原 `computeLiuyinHugCounts` 值导入（判据 23）。
 */
export function promoteHugCountsOf(
  configStore: ConfigModel,
): AgentMechanicModule['promoteHugCounts'] {
  const slot = ultimateGiftProviderSlot(configStore)
  if (slot < 0) return undefined
  return getAgentMechanic(configStore.team[slot]?.agentId ?? '')?.promoteHugCounts
}

export function ultimateGiftSourceOf(
  configStore: ConfigModel,
  rr: TeamResourceResult,
): { slot: number; goodReviewTotal: number } | null {
  const slot = ultimateGiftProviderSlot(configStore)
  if (slot < 0) return null
  const res = rr.characters.find(c => c.slot === slot)
  const src = res ? getAgentMechanic(configStore.team[slot].agentId)?.ultimateGiftSource?.(res) ?? null : null
  return src ? { slot, goodReviewTotal: src.goodReviewTotal } : null
}

/** 从某轮资源池结果构建转大参数；队伍无赠大提供者（现为琉音）时返回 null */
export function buildPromoteParams(
  configStore: ConfigModel,
  catalogStore: ReturnType<typeof useCatalogStore>,
  rr: TeamResourceResult,
  configs: readonly CharacterOperationConfig[],
): UltimatePromoteParams | null {
  const gift = ultimateGiftSourceOf(configStore, rr)
  if (!gift) return null
  const hug60Setting = configStore.getMechanicSetting('liuyin.hug60Count', -1)
  // CC-294：落点与引擎 `gift-chain:ultimate` 预留同一函数、同一份提供者 cfg（原在此直读设置重解）
  const providerCfg = configs.find(c => c.slot === gift.slot)
  const targetSlot = providerCfg ? supplyTargetTeamSlot(providerCfg, configs.map(c => c.slot)) : -1
  const targetAgentId = configStore.team[targetSlot]?.agentId ?? ''
  const targetChar = rr.characters.find(c => c.slot === targetSlot)
  const targetSkills = targetAgentId ? catalogStore.agentSkillsByAgentMap.get(targetAgentId) : undefined
  const ult = targetSkills ? findUltimate(targetSkills, fusedRowReader) : null
  const ultMove = ult?.moveId ? findMoveById(targetSkills, ult.moveId) : null
  // CC-244：送出的是「一次完整终结技」⇒ 多段终结技（融合组，如照 1341014、妮可 1031301）取整段失衡值，
  // 与本文件伤害（fusedOf）、helpers 主执行、chainGift 赠送连携同口径；修前只取主段 = 赠送了半招失衡。
  const ultDaze = (ult?.moveId ? fusedRowValue(targetSkills, ult.moveId, 'daze') : null) ?? getRowValue(ultMove, 'daze')
  const chain = targetSkills ? findChainAttack(targetSkills, fusedRowReader) : null
  const ultElement = (targetAgentId && catalogStore.agentsMap.get(targetAgentId)?.damageElement) || 'physical'
  return {
    goodReviewTotal: gift.goodReviewTotal,
    hug60Setting,
    targetSlot,
    chainMoveId: chain?.moveId ?? '',
    ultimateMoveId: ult?.moveId ?? '',
    chainCountPerStun: targetChar?.chainCountPerStun ?? 0,
    ultDaze,
    ultElement,
  }
}

/**
 * 转大不动点：抱拳命中→检查好评≥90 打开大招选择窗口→60 转大（有连携窗口：目标队友连携 -1、终结技 +1）
 * 或 90 转大（无连携窗口：终结技 +1）。倍率表全走目标队友执行计划自然调用。
 * 正反馈：转大终结技 daze 进失衡池 → 失衡次数变 → 60 抱拳默认按失衡次数 → 转大次数变；
 * 开窗次数（阈值结转口径，见 computeLiuyinHugCounts）有界，正反馈单调有界必收敛（MAX_PROMOTE_ITER 轮兜底）。
 */
function adjustStunExecs(
  execs: StunSkillExecution[],
  p: UltimatePromoteParams,
  hug60: number,
  promote: number,
  subtractChain = true,
): StunSkillExecution[] {
  if (hug60 <= 0 && promote <= 0) return execs
  const out: StunSkillExecution[] = []
  let ultPushed = false
  for (const e of execs) {
    if (e.slot === p.targetSlot && e.moveId === p.ultimateMoveId) {
      if (promote > 0) { out.push({ ...e, count: e.count + promote }); ultPushed = true }
      else out.push(e)
    } else if (e.slot === p.targetSlot && e.moveId === p.chainMoveId) {
      // 无轴兜底：60转大消耗连携窗口 → 连携 daze 减 hug60；有轴：连携与60转大独立列出，不互相改写
      if (subtractChain && hug60 > 0) out.push({ ...e, count: Math.max(0, e.count - hug60) })
      else out.push(e)
    } else out.push(e)
  }
  if (promote > 0 && !ultPushed && p.ultDaze > 0) {
    out.push({
      moveId: p.ultimateMoveId,
      moveName: '好评转大·队友终结技',
      slot: p.targetSlot,
      count: promote,
      baseDaze: p.ultDaze,
      element: p.ultElement,
      skillType: 'ultimate',
    })
  }
  return out
}

/** 转大不动点：给定基础失衡 execs 与畏缩覆盖率，迭代（失衡次数 ↔ 好评转大次数）至收敛 */
// @fact engine:失衡次数不动点 口径: **轴/非轴统一**走连续闭式 N*=(g+gf−r)/((1−r)+g·x)（g=毛失衡/阈值、gf=Boss白送/阈值、r=雨果返还、x=N×窗长/有效时间），floor(N*) 即次数——时间域语义：窗口占用 N×窗长，剩余时间才攒条，故「打满 N 次后剩余时间不够一次」自然收敛于 N。**两种模式都必须传时间占比**（旧实现轴模式传 0，只信逐招 fraction：实测 auto-1521-1481-1311 窗口占时间 90% 只扣 4.8% 攒条 → 9 次，而轴栈只填满 3 窗）| 据 用户@2026-09-10「顺序不对：应先攒够再开窗，剩余时间不足则收敛于此」·前身口径 用户@2026-09-08 + 用户实测@2026-09-08（实战对比部署 雅/南宫/柚叶 vs 基塔布鲁·滞变畸兽 显示 0 次；同配置冷启动 4/热启动 0）+ 时间守恒不动点自洽（合并原重复「据」槽）·复核@2026-09-25·复核@2026-09-27·复核@2026-09-30 | 验 src/composables/resourceCalc/__tests__/liuyinPromote.test.ts + src/composables/__tests__/runArchiveDeploy.test.ts | 锚 src/composables/resourceCalc/ultimatePromote.ts#promoteFixpoint | 信 确认
/** 轴内失效比例提供者的返回：逐招 `${slot}:${moveId}` → 窗内份额，加上窗口里被轴块占掉的前台秒数（CC-469′）。 */
export interface InAxisFractionResult { fraction: Record<string, number>; coveredWindowSeconds: number }
export type InAxisFractionProvider = (stunCount: number, execs: StunSkillExecution[]) => InAxisFractionResult
export function promoteFixpoint(
  baseExecs: StunSkillExecution[],
  flinchRate: number,
  p: UltimatePromoteParams | null,
  axisHug: { hug60: number; hug90: number } | null,
  axisMode: boolean,
  deps: PromoteFixpointDeps,
  inAxisFractionProvider?: InAxisFractionProvider,
  refundStunRatio = 0,
  /**
   * CC-305：锁定失衡次数（`enemy.stunCountLock ≥ 0` 时由 convergence 传计数通道值 countStun；缺省 / 负数 = 正常求不动点）。
   * 锁定 = 「操作够就能打 N 次」：不迭代，转大次数（好评 / 连携窗口）、轴内 fraction、窗口时间占比都按 N 算，
   * 池次数钉到 N（withStunCount 重建派生字段）。原先只在外面把池钳到 N（CC-300），内部仍按自算次数推转大 ⇒
   * 命座抬失衡值 → 次数 → 转大联动放大的「假提升」仍从 promote 漏出。
   */
  lockedStunCount?: number,
): PromoteFixpointResult {
  const { configStore, panels } = deps
  const chainCountPerStun = configStore.team.reduce((sum, c) => sum + (c.chainCountPerStun ?? 0), 0)
  // 时间守恒（用户口径 2026-09-01）：窗口内的招式吃易伤但不攒条。
  // 轴模式已有逐招 inAxisFraction 精确扣除；**非轴模式**这里按「上一轮次数推出的窗口占比」折算，
  // 于是本不动点自带负反馈：次数↑ → 占比↑ → 有效攒条↓ → 次数↓，自己收敛到实战档位。
  const effTime = effectiveBattleTime(configStore.enemy)
  const windowDur = stunWindowDuration(
    configStore.enemy.stunTime,
    panels.reduce((sum, p) => sum + (p.stunDurationBonusSeconds ?? 0), 0),
  )
  const runPool = (execs: StunSkillExecution[], inAxis?: InAxisFractionResult, prevStunCount = 0) => calcStunPool({
    executions: execs, panels, bossStunValue: configStore.enemy.stunValue,
    chainCountPerStun, enemyStunResistances: configStore.enemy.stunResistances ?? configStore.enemy.resistances ?? {},
    physicalFlinchCoverageRate: flinchRate,
    inAxisStunFractionByKey: inAxis?.fraction,
    refundStunRatio,
    stunGift: configStore.enemy.bossStunGift ?? 0,
    // **两种模式都传时间占比**（用户 2026-09-10 裁决：失衡次数必须满足时间约束）——
    // 旧实现轴模式传 0（「逐招 fraction 已精确扣除」），实测 auto-1521-1481-1311 窗口占时间 90%
    // 却只扣掉 4.8% 攒条 → 次数 9，而轴栈实际只填满 3 窗（时序不自洽）。
    // CC-469′（r651）：轴模式传「未被轴块覆盖的窗口秒 / 非轴块时间」= stunWindowFraction(N, W, eff − covered, covered)
    //（`lostSeconds` 通道，CC-217 单一实现）；池内与逐招 fraction 复合（stunPool.ts）。非轴模式 covered=0，逐位同旧。
    windowTimeFraction: stunWindowFraction(prevStunCount, windowDur, effTime - (inAxis?.coveredWindowSeconds ?? 0), inAxis?.coveredWindowSeconds ?? 0),
  })

  let stunCount = 0
  let hug60 = 0
  let promote = 0
  /** CC-421：`MAX_PROMOTE_ITER ≥ 1` ⇒ 首轮必执行 `pool = runPool(...)` 后才可能 break ⇒ 定赋值断言成立。 */
  let pool!: StunPoolResult
  const seenStunCounts = new Set<number>()
  const bossStunValue = configStore.enemy.stunValue
  const locked = lockedStunCount != null && lockedStunCount >= 0
  if (locked) stunCount = lockedStunCount
  for (let k = 0; k < MAX_PROMOTE_ITER; k++) {
    // 有轴时：60/90 转大次数直接读轴（轴即最终次数，无连携↔大招改写），否则按好评/连携窗口推导
    let hug90 = 0
    if (p && axisMode) {
      hug60 = axisHug?.hug60 ?? 0
      hug90 = axisHug?.hug90 ?? 0
    } else if (p) {
      const chainExecCount = baseExecs.find(e => e.slot === p.targetSlot && e.moveId === p.chainMoveId)?.count ?? 0
      const targetChainTotal = Math.min(p.chainCountPerStun * stunCount, chainExecCount)
      const hug = promoteHugCountsOf(configStore)?.(p.goodReviewTotal, stunCount, p.hug60Setting, targetChainTotal)
        ?? { hug60: 0, hug90: 0 }  // p 非空 ⇒ 必有提供者；兜底仅防提供者未实现该能力
      hug60 = hug.hug60
      hug90 = hug.hug90
    }
    promote = hug60 + hug90
    const execs = p && promote > 0 ? adjustStunExecs(baseExecs, p, hug60, promote, !axisMode) : baseExecs
    if (axisMode && inAxisFractionProvider && !locked) {
      // CC-469′b（r652）：轴模式**不用**下面的自由闭式（它按 x=N·W/eff 扣全部 gross，而池在轴模式按逐招份额 +
      // 未覆盖窗口份额复合扣除，二者不是同一函数 ⇒ r648 实测闭式 4.46 / 池 3 互相矛盾、按「闭式重复」退出时返回
      // 的池是在别的 N 处求的值）。改为对连续 N 二分池**自身**的不动点 h(N) = continuousStunCount(pool(N)) − N：
      // N↑ ⇒ 栈多排块 + 未覆盖份额↑ ⇒ 有效失衡↓ ⇒ h 单调递减，二分必收敛；返回的池就是在 N* 处求的值，
      // `pool.stunCount = floor(N*)`（差 1 以内的 floor 边界由同源公式保证一致）。每步 = 一次栈遍历 + 一次池。
      const evalAt = (n: number) => runPool(execs, inAxisFractionProvider(n, execs), n)
      let lo = 0
      let hi = Math.max(1, effTime / Math.max(1e-9, windowDur))
      let poolLo = evalAt(lo)
      if (continuousStunCount(poolLo) <= lo) { pool = poolLo; stunCount = lo; break }
      const poolHi = evalAt(hi)
      if (continuousStunCount(poolHi) >= hi) { pool = poolHi; stunCount = hi; break }
      for (let i = 0; i < 40 && hi - lo > 1e-3; i++) {
        const mid = (lo + hi) / 2
        const pm = evalAt(mid)
        if (continuousStunCount(pm) >= mid) { lo = mid; poolLo = pm } else hi = mid
      }
      pool = poolLo
      stunCount = lo
      break
    }
    const inAxis = inAxisFractionProvider ? inAxisFractionProvider(stunCount, execs) : undefined
    // 传上一轮的 stunCount 折算窗口占比（首轮 0 = 与旧行为一致，之后逐轮收敛）
    pool = runPool(execs, inAxis, stunCount)
    if (locked) {
      if (pool.stunCount !== stunCount) pool = withStunCount(pool, stunCount)
      break
    }
    const next = pool.stunCount
    if (next === stunCount) break
    // **两种模式统一走连续闭式求根**（用户 2026-09-10 裁决「顺序：边打边攒 → 攒够开窗 → 剩多久」）：
    // 轴模式原先走「整数迭代 + 2-循环环检测」，其窗口占比只来自轴内逐招 fraction，与「N 次窗口占用
    // N×窗长」的时间账不自洽（实测该队 9 次 vs 轴栈只填满 3 窗）。闭式解在**时间域**上成立：
    // 窗外可用时间 = 有效时间 − N×窗长，攒条量按此折算 → N 天然收敛于「打满 N 次后剩余时间不够一次」。
    // 环检测保留为兜底（闭式不收敛时的保护）。
    if (seenStunCounts.has(next)) break
    seenStunCounts.add(stunCount)
    // 非轴模式：窗口占比是连续量 x = 窗口时长/有效时间，计数映射 N ↦ floor(E(N)/阈值) 是单调递减
    // 阶梯函数——它在相邻两条阶梯间来回跳（实测 0↔6、2↔4），旧实现「检测到重复即停、保留最后池」
    // 返回循环里的任意一支：2026-09-08 用户实测实战对比部署 雅/南宫/柚叶 vs 基塔布鲁·滞变畸兽
    // 显示「失衡 0 次」，同一配置冷启动 4 次、热启动（缓存命中）0 次。
    // 改解连续不动点闭式（阶梯函数的连续极限，floor 后与池的 floor 口径一致）：
    //   E(N) = (毛失衡 + Boss白送) × (1 − xN)，N = E/阈值（雨果返还 r 段：N = (E/阈值 − r)/(1 − r)）
    //   ⇒ N* = (g + gf − r) / ((1 − r) + g·x)，g = 毛失衡/阈值、gf = 白送/阈值。
    // 收缩快（一次迭代即到连续不动点附近），次数不再依赖迭代入口/热启动历史。
    const g = pool.grossStunBuildUp / Math.max(1e-9, bossStunValue)
    const gf = pool.stunGift / Math.max(1e-9, bossStunValue)
    const x = windowDur / Math.max(1e-9, effTime)
    const fixed = (g + gf - refundStunRatio) / ((1 - refundStunRatio) + g * x)
    if (!Number.isFinite(fixed) || Math.abs(fixed - stunCount) < 1e-6) break
    stunCount = Math.max(0, fixed)
  }
  return {
    pool,
    hug60,
    promote,
    targetSlot: p?.targetSlot ?? -1,
    chainMoveId: p?.chainMoveId ?? '',
    ultimateMoveId: p?.ultimateMoveId ?? '',
  }
}
