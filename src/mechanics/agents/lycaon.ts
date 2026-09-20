import type {
  AgentMechanicModule,
  AgentCharConfigInput,
  AgentResourceInput,
  AgentPanelInput,
  AgentTeamConfigInput,
} from '../types'
import type { SkillMove } from '@/types/catalog'
import type { CharacterOperationConfig, CharacterResourceResult } from '@/types/resource'

/**
 * 莱卡恩（1141）战斗逻辑（用户确认口径，2026-08）：
 * - 角色定位：击破（stun）/冰属性。拐力（核心被动冰抗-25% + 其他属性伤害+30%、
 *   额外能力失衡易伤+35%）由 teammate-buffs.json 承载，不在本模块实现。
 * - 核心被动·金属狼足（用户确认：玩家只打蓄力段所以能吃满）：
 *   [普通攻击]蓄力段 / 闪避反击 / 冲刺攻击的失衡值提升 80%（Lv7 满级）→
 *   面板 stunBuildUpBonus__basic / __dodgeCounter / __dashAttack = 80（加算乘区，
 *   与驱动盘震星迪斯科等通用失衡提升同区加算，不做乘法近似）。
 * - 潜能觉醒·掠冰：围猎后台普攻/冲刺/闪反期间局内冲击力按 `potentialLevel` 取档
 *   （II~VI = 5/7.5/10/12.5/15%；用户口径：这是局内冲击力，加成到面板看实际）
 *   → applyPanel 局内 impact ×(1+档位/100)（面板级近似全覆盖；围猎期间生效）。
 *   ⚠ R59 修复：原实现写死 ×1.15（= VI 满档）⇒ `potentialLevel` 滑块完全不进计算。
 * - 影画6·冷酷猎手（用户确认：莱卡恩自己 50% 增伤全覆盖）：applyPanel 面板 dmgBonus +50。
 * - 影画4·保持风度（护盾）：不建模（用户确认）。
 * - 影画2·能量回馈（用户确认）：使敌人失衡或触发队友[连携技]时回 5 能量 → 次数 =
 *   (失衡次数 + 队伍连携总次数) × 5，由资源池 calcEnergySource 结算（lycaonC2Energy）。
 * - 影画1·满月蓄势（用户确认）：
 *   强特双模式：点按 40 能量 → 狂猎时刻 #1+#2；长按 60 能量 → #1+#3；
 *   滑块 lycaon.exHoldRatio 分配点按/长按，默认全长按。
 *   C1：强特失衡值提升 12%（8s CD → 覆盖率滑块 lycaon.c1Coverage，只给有限次强特）；
 *   长按蓄力中 #3 额外 +10% → 22%。实现为执行级 stunBuildUpBonus（与面板同乘区加算）。
 * - 围猎（2.6 潜能激发，用户确认口径）：
 *   - 次数 = 失衡次数（开场 1 次用于打第一失衡，每失衡刷新 1 次 → "每一失衡都能打一次"）。
 *   - 蓄力段：带冰积蓄的 #2/#4/#6/#8/#10/#11 是蓄力段；围猎后台只打 #2→#4→#6 短循环。
 *   - 一次围猎：① 弹刀 → 开场冰舞（1141027，必定合轴，完整数值）；② 后台跟随前台角色
 *     闪反次数打后台闪避反击（次数 = 队伍其他角色 dodgeCounterCount 之和；仅伤害+失衡值）；
 *     ③ 后台时间 − 闪反时间 = 真正围猎平A时间（蓄力短循环）；④ 收尾冰舞（自动，完整数值）。
 *     一轮失衡两个冰舞。围猎后台蓄力平A/闪反都吃核心被动失衡提升（basic/dodgeCounter 面板区）。
 *   - 后台时间模型：后台时间 = 总时间 − 无敌 − 失衡时长×次数 − 莱卡恩前台时间；
 *     平A时间 = max(0, 后台时间 − 闪反时间)，每次 ≤ 8s。
 *   - 忽略：围猎提前结束每剩余 1s → 下次冰舞失衡 +6%；招架支援强化（黄光弹刀 2→1）。
 * - 近似点：开场/收尾冰舞按倍率表完整数值；后台闪反/蓄力平A无积蓄/喧响/能量（显式 0）；
 *   潜能冲击按面板级全覆盖近似（围猎期间生效）；C2 连携次数取队伍连携总次数。
 * - 未建模：前台普攻的蓄力段口径（基础 #3 秒均，蓄力段失衡提升已由面板 basic 区覆盖）。
 */
/**
 * 潜能觉醒·掠冰（index 0 占位，1 = I 无觉醒，2..6 = II..VI）：
 * [围猎]状态持续期间，作为非当前操作中代理人发动普攻/冲刺攻击/闪避反击时，冲击力提升 5/7.5/10/12.5/15%。
 *
 * ⚠ 这是**潜能觉醒**轴（raw `potential_detail`），与 `talent.1..6`（影画）是两条独立轴。
 * R59 修复：原实现写死 `panel.impact *= 1.15`（VI 满档）⇒ `potentialLevel` 滑块完全不进计算
 * （四臂正交实测 A==B、C==D，见 lycaonCinemaTier.test.ts）。
 */
// @fact agent:1141/潜能觉醒冲击力 口径: 潜能觉醒·掠冰按 `potentialLevel` 取档 II~VI = 5/7.5/10/12.5/15%（围猎后台普攻/冲刺/闪反期间局内冲击力），与影画（cinemaLevel）无关 | 据 raw nanoka_missing/full/1141.json `potential_detail` + R59 四臂正交实测@2026-09-20 | 验 src/mechanics/__tests__/lycaonCinemaTier.test.ts | 锚 src/mechanics/agents/lycaon.ts#LYCAON_POTENTIAL_IMPACT_PCT | 信 确认
// ⟳复核: nanoka 若刷新 1141 的 potential_detail，逐档对账 II~VI 是否仍为 5/7.5/10/12.5/15 | 到期 2027-03-31
export const LYCAON_POTENTIAL_IMPACT_PCT = [0, 0, 5, 7.5, 10, 12.5, 15] as const

export const lycaonMechanic: AgentMechanicModule = {
  id: 'agent:1141',
  agentIds: ['1141'],

  applyPanel({ cinemaLevel, panel, potentialLevel }: AgentPanelInput) {
    // 核心被动·金属狼足：普攻蓄力/闪反/冲刺失衡 +80%（Lv7 满级；增强后含闪反/冲刺）
    const CHARGE_STUN_BONUS = 80
    panel.stunBuildUpBonus__basic = (panel.stunBuildUpBonus__basic ?? 0) + CHARGE_STUN_BONUS
    panel.stunBuildUpBonus__dodgeCounter = (panel.stunBuildUpBonus__dodgeCounter ?? 0) + CHARGE_STUN_BONUS
    panel.stunBuildUpBonus__dashAttack = (panel.stunBuildUpBonus__dashAttack ?? 0) + CHARGE_STUN_BONUS
    // 潜能觉醒·掠冰：围猎后台普攻/冲刺/闪反期间**局内冲击力**按 potentialLevel 取档
    // （II~VI = 5/7.5/10/12.5/15%）。用户口径：这是局内冲击力，加成到面板看实际。
    // ⚠ R59 修复：原实现写死 `* 1.15`（= VI 满档）⇒ `potentialLevel` 滑块完全不进计算。
    const potLv = Math.max(1, Math.min(6, Math.floor(Number(potentialLevel ?? 6))))
    panel.impact = (panel.impact ?? 0) * (1 + LYCAON_POTENTIAL_IMPACT_PCT[potLv] / 100)
    // 影画6·冷酷猎手：莱卡恩自己对目标伤害 +50%（用户口径：全覆盖）
    if (cinemaLevel >= 6) {
      panel.dmgBonus = (panel.dmgBonus ?? 0) + 50
    }
  },

  buildCharConfig({ cfg, cinemaLevel, skills }: AgentCharConfigInput) {
    // 围猎后台蓄力平A的秒均倍率：蓄力短循环 #2→#4→#6（用户确认，后台只打这三段循环）
    const CHARGE_MOVE_IDS = ['1141002', '1141004', '1141006']
    let dmgSum = 0
    let dazeSum = 0
    let tSum = 0
    for (const id of CHARGE_MOVE_IDS) {
      const mv = findMoveById(skills, id)
      dmgSum += rowValue(mv, 'damage')
      dazeSum += rowValue(mv, 'daze')
      tSum += mv?.actionTime ?? 0
    }
    if (tSum > 0) {
      cfg.lycaonChargePerSec = dmgSum / tSum
      cfg.lycaonChargeDazePerSec = dazeSum / tSum
    }
    // 前台普攻秒均（用户确认：玩家只打蓄力段 → 全部蓄力段 #2/#4/#6/#8/#10/#11 平均 × 平A时间）
    const ALL_CHARGE_IDS = ['1141002', '1141004', '1141006', '1141008', '1141010', '1141011']
    let fDmgSum = 0
    let fDazeSum = 0
    let fTimeSum = 0
    for (const id of ALL_CHARGE_IDS) {
      const mv = findMoveById(skills, id)
      fDmgSum += rowValue(mv, 'damage')
      fDazeSum += rowValue(mv, 'daze')
      fTimeSum += mv?.actionTime ?? 0
    }
    if (fTimeSum > 0) {
      cfg.lycaonFrontChargePerSec = fDmgSum / fTimeSum
      cfg.lycaonFrontChargeDazePerSec = fDazeSum / fTimeSum
    }
    // 围猎后台闪避反击单次失衡倍率（1141019）
    cfg.lycaonDodgeDaze = rowValue(findMoveById(skills, '1141019'), 'daze')
    // 冰舞（1141027）完整数值：开场/收尾冰舞有异常积蓄与喧响
    const iceDance = findMoveById(skills, '1141027')
    cfg.lycaonIceDanceAnomaly = rowValue(iceDance, 'anomaly_buildup')
    cfg.lycaonIceDanceDecibel = rowValue(iceDance, 'decibel_recovery')
    // 强特三段喧响（执行行 enrich 回填同值用；type 要求 decibelRecovery 必填）
    const exDecibels: Record<string, number> = {}
    for (const id of ['1141015', '1141016', '1141017']) {
      exDecibels[id] = rowValue(findMoveById(skills, id), 'decibel_recovery')
    }
    cfg.lycaonExDecibels = exDecibels

    // 命座等级（buildExecutions 无 cinemaLevel 输入，经 cfg 传递）
    cfg.lycaonCinemaLevel = cinemaLevel

    // 强特双模式（用户口径）：点按 40 能量 → #1+#2（1.717s）；长按 60 能量 → #1+#3（2.501s）
    const holdRatio = clamp01(cfgNum(cfg, 'lycaon.exHoldRatio', 1))
    cfg.exSpecialEnergyConsume = EX_TAP_ENERGY * (1 - holdRatio) + EX_HOLD_ENERGY * holdRatio
    cfg.exSpecialActionTime = EX_TAP_TIME * (1 - holdRatio) + EX_HOLD_TIME * holdRatio
    cfg.skipGenericExSpecial = true
    cfg.exSpecialCountFloor = true
    // C1 覆盖率（8s CD → 覆盖率滑块，只给有限次强特强化）
    cfg.lycaonC1Coverage = clamp01(cfgNum(cfg, 'lycaon.c1Coverage', 1))
    // C2 回能（5 能量/次；次数 = 失衡次数 + 队伍连携总次数，由 useResourceCalc 注入 lycaonC2Energy）
    cfg.lycaonC2EnergyPerTrigger = cinemaLevel >= 2 ? 5 : 0
  },

  /**
   * 围猎输入注入（规则 6 落点，2026-09-16 T26 批次 0c 自 `convergence.ts` 的
   * `merged.agentId === '1141'` 分支迁入；round 12 批次 2 追加第 4 个字段）。
   *
   * **不需要轴上下文**的三个字段（原：`stunCount` / `base.totalTime` / `base.invincibleTime`）：
   * - `lycaonStunCount` ← `stunCount`（同一变量）
   * - `lycaonTotalTime` ← `combatTime`（派发点传的正是 `base.totalTime ?? 180`，
   *   而 `ResourceCalcConfig.totalTime` 是必填 number ⇒ `??` 不触发，逐位等价）
   * - `lycaonInvincibleTime` ← `cfg.invincibleTime`（两者同源于 `configStore.enemy.invincibleTime`——
   *   `base` 在 `convergence.ts` 未加 `?? 0`，`cfg` 在 `resourceCalc/helpers.ts` 加了 `?? 0`）
   *
   * **需要轴上下文**的一个字段（round 12 批次 2 迁入，用 `axis.windowSeconds`）：
   * - `lycaonWindowDuration` ← `axis.windowSeconds`。原实现写 `computeWindowDuration()`
   *   （= `enemy.stunTime + 4 + 全队 stunDurationBonusSeconds`），而契约的 `windowSeconds`
   *   就是**同一个函数的返回值**（`convergence.ts` 派发点：`windowSeconds: computeWindowDuration()`）
   *   ⇒ 逐位等价。⚠ 该字段**不判 `axis.active`**：原实现在轴/非轴**都**写同一个窗口时长，
   *   等价要求保留（`forceNoAxis` 退化时轴仍解析过，窗口时长与轴开关无关）。
   *   ⚠ 契约缺 `axis` 时**不写**（`undefined`）——与批次 1（1201/1241）同款约定：
   *   「字段 undefined」唯一编码「契约没接上」，由 `axisContext.test.ts` 精确断言分辨，
   *   而不是写一个看着合法的默认值把断路掩盖掉（消费端 `?? 16` 是既存兜底，不是新通道）。
   *
   * ⚠ **`lycaonC2Energy` 的契约缺口已在 round 20（2026-09-17 C-γ 收尾批）补齐并迁入**，
   * 本分支的**最后一个字段**就此消失（`convergence.ts` 的 `agentId === '1141'` 分支整段删除
   * ⇒ **棘轮 −1**）。原来的「不可迁」理由与现在补齐的两个量必须留在痕里（别再重新论证）：
   * · 字段值 = `c2Per > 0 ? (stunCount + teamChainTotal) * c2Per : 0`，`teamChainTotal` 分两臂：
   *   — **轴臂**（`axisActive`）：`Σ_slots chainTotalBySlot − chainTotalBySlot[本槽]`
   *     ⇒ 契约早够（`axis.chainTotalBySlot`）；
   *   — **非轴臂**：`Σ_{队友} chainCountPerStun × countStun`，其中
   *     `countStun = projectStunPlanForCounts(stunCount, base.stunPlanProjection ?? 'off')`
   *     （`convergence.ts` 的 C7 计数投影）。默认 `'off'` 时它与 `stunCount` **恒等**（0 delta），
   *     但**难度阶梯 G4「取整（失衡→计数投影）」**（`difficultyLadder.ts` 置
   *     `time.stunPlanProjection = 2`）会把它打开 ⇒ 用未投影的 `stunCount` 迁移就是**静默改语义**。
   * · 缺口因此是**两个量**（不是 R15 分诊说的一个）：① C7 计数投影值 `countStun`
   *   （新契约 `AgentTeamConfigInput.countStun`，派发器递 `:472` 已算好的结果——投影方式本身
   *   不在模块可达面上，且注册成 `MechanicSetting` 会变资源利用率页的用户可见滑块 = 产品级口径）；
   *   ② 队友 `chainCountPerStun` 的 **store 原值**（挂进 `interactions` 契约的逐槽快照：
   *   `characters` 上那份被 `buildCharConfig` 写过 `?? (isSupport ? 0 : 1)` 兜底，而 store 默认 `0`
   *   ⇒ 没调过滑块时两份不同值，读 cfg 是静默改语义 —— 与 `interactionScale`/`parrySplit`
   *   同族的「必须读 store」形态）。
   * · 复刻的**唯一**一处不对称：`countStun` 只出现在**非轴臂**（最终式用的是实数的 `stunCount`），
   *   但本实现仍把整个字段门控在 `countStun !== undefined` 上 —— 这样「契约没接上」在全臂上
   *   都编码成 `undefined`（可被测试分辨），而不是半接状态。
   *
   * ✅ `lycaonBackstageDodgeCount` **已于 round 14（2026-09-16 批次 4）迁入**——那轮新增的
   * `interactions` 契约（store 口径**未缩放**交互次数）正是为它和仪玄 1371 的 `yixuanExtremeAssistCap`
   * 补的（两处需要同一个量：`characters` 上那份已被 `interactionScale` 缩放、被 `parrySplit` 改写）。
   */
  applyTeamConfig: ({ cfg, phase, stunCount, countStun, combatTime, axis, interactions }: AgentTeamConfigInput) => {
    if (phase !== 'converge') return
    cfg.lycaonStunCount = stunCount
    cfg.lycaonTotalTime = combatTime
    cfg.lycaonInvincibleTime = cfg.invincibleTime ?? 0
    if (axis) cfg.lycaonWindowDuration = axis.windowSeconds
    // `lycaonBackstageDodgeCount` = 队伍**其他**槽位的**未缩放**闪反次数之和（round 14 批次 4 迁入，
    // 用本轮新增的 `interactions` 契约）。⚠ 原实现读 `configStore.team` **store 原值**——
    // `characters` 上那份已被 `interactionScale` 缩放（实测 scale=0.125 时 store 10 → cfg 0）
    // ⇒ 读 `characters` 是**静默改语义**，故必须走本契约（理由见 `AgentInteractionContext`）。
    // ⚠ 过滤口径**逐位保留**：原式是 `ci !== cfg.slot && c?.agentId ? …`——**带 `agentId` 存在判据**
    // （与仪玄那条只看槽位号的不同！两条口径刻意不统一：空槽残留计数在本条被排除）。
    // ⚠ 双判据门控：缺 `interactions` 即不写（`undefined` 唯一编码「契约没接上」，
    // 消费端 `?? 0` 是既存兜底、不是本通道的默认值）。
    const ownSlot = Number(cfg.slot)
    if (interactions) {
      let backstageDodgeCount = 0
      for (const [slotKey, snap] of Object.entries(interactions.bySlot)) {
        if (Number(slotKey) === ownSlot || !snap?.agentId) continue
        backstageDodgeCount += snap.dodgeCounterCount ?? 0
      }
      cfg.lycaonBackstageDodgeCount = backstageDodgeCount
    }

    // 影画2·能量回馈（`lycaonC2Energy`）= (失衡次数 + 队友连携总次数) × 5（用户确认：
    // **排除莱卡恩自己**，只算队友的连携）。原实现是 `convergence.ts` 的
    // `merged.agentId === '1141'` 分支，round 20 C-γ 整段迁入（算式逐位保留）。
    //
    // ⚠ **C7 契约门控**：缺 `countStun` 即**不写**（非轴臂要拿投影版次数算队友连携；
    // `undefined` 唯一编码「契约没接上」，不许写 0 冒充 —— 0 是合法的失衡次数）。
    if (countStun !== undefined) {
      // 臂选判据与原实现逐位一致：`axisActive ? 轴臂 : 非轴臂`（`axis.active` 就是派发点的
      // `axisActive`，含 `forceNoAxis` 退化判据）。
      // · 轴臂 = Σ 全槽轴内连携块 − 本槽那份（**不是** Σ 队友：原式就是这么写的，逐位保留）。
      // · 非轴臂 = Σ_{队友} store 原值 `chainCountPerStun` × **countStun**（投影值！不是 stunCount），
      //   过滤口径逐位保留 `ci !== cfg.slot && c?.agentId`（带 `agentId` 判据 ⇒ 排除空槽残留计数）。
      // ⚠ 非轴臂的队友连携量必须走 `interactions`（store 原值快照），不许读 `characters`
      //   上那份被 `?? (isSupport ? 0 : 1)` 兜底过的 cfg——默认值分裂，见上方契约缺口沿革。
      let teamChainTotal: number | undefined
      if (axis?.active) {
        teamChainTotal = Object.values(axis.chainTotalBySlot).reduce((a, b) => a + b, 0)
          - (axis.chainTotalBySlot[ownSlot] ?? 0)
      } else if (axis && interactions) {
        let sum = 0
        for (const [slotKey, snap] of Object.entries(interactions.bySlot)) {
          if (Number(slotKey) === ownSlot || !snap?.agentId) continue
          sum += (snap.chainCountPerStun ?? 0) * countStun
        }
        teamChainTotal = sum
      }
      // 臂材料缺任何一份都**不写**（`undefined` 可分辨，胜过写一个看着合法的数）。
      if (teamChainTotal !== undefined) {
        const c2Per = cfg.lycaonC2EnergyPerTrigger ?? 0
        cfg.lycaonC2Energy = c2Per > 0 ? (stunCount + teamChainTotal) * c2Per : 0
      }
    }
  },

  buildExecutions({ cfg, state, executions }: AgentResourceInput) {
    // 前台平A（引擎 basic_attack 汇总行）改按全部蓄力段秒均（用户确认：玩家只打蓄力段 → 吃招式限定，
    // 失衡提升已由面板 stunBuildUpBonus__basic = 80 承担，这里只覆盖倍率）
    const frontPerSec = cfg.lycaonFrontChargePerSec
    const frontDazePerSec = cfg.lycaonFrontChargeDazePerSec
    if (frontPerSec && frontDazePerSec) {
      const plainBasic = executions.find(e => e.moveId === 'basic_attack' && !e.damageMultiplierOverride)
      if (plainBasic) {
        plainBasic.damageMultiplier = frontPerSec
        plainBasic.damageMultiplierOverride = true
        plainBasic.dazeMultiplier = frontDazePerSec
        plainBasic.dazeMultiplierOverride = true
        plainBasic.skillTableNote = '前台平A按全部蓄力段（#2/#4/#6/#8/#10/#11）平均秒均 × 平A时间（用户口径：玩家只打蓄力段）；失衡提升吃核心被动 basic 区 +80%'
      }
    }

    const exCount = state.exSpecialCount
    if (exCount <= 0) return
    const cinema = cfg.lycaonCinemaLevel ?? 0
    const holdRatio = clamp01(cfgNum(cfg, 'lycaon.exHoldRatio', 1))
    const tap = Math.round(exCount * (1 - holdRatio))
    const hold = Math.max(0, exCount - tap)
    // C1 强化次数：8s CD → floor(战斗时间/8) × 覆盖率，封顶强特总数
    const totalTime = cfg.lycaonTotalTime ?? 180
    const c1Coverage = clamp01(cfg.lycaonC1Coverage ?? 1)
    const strongCount = cinema >= 1
      ? Math.min(exCount, Math.max(0, Math.floor(totalTime / 8)) * c1Coverage)
      : 0
    const holdStrong = Math.min(hold, strongCount)
    const tapStrong = Math.max(0, strongCount - holdStrong)
    const holdPlain = hold - holdStrong
    const tapPlain = tap - tapStrong

    const c1Note = cinema >= 1 ? '（影画1强化）' : ''
    // 点按：狂猎时刻 #1 + #2（40 能量）
    pushEx(executions, cfg, '1141015', tapPlain, EX_TAP_ENERGY, 0, '狂猎时刻 #1（点按）')
    pushEx(executions, cfg, '1141016', tapPlain, EX_TAP_ENERGY, 0, '狂猎时刻 #2（点按）')
    pushEx(executions, cfg, '1141015', tapStrong, EX_TAP_ENERGY, 12, `狂猎时刻 #1（点按${c1Note}）`)
    pushEx(executions, cfg, '1141016', tapStrong, EX_TAP_ENERGY, 12, `狂猎时刻 #2（点按${c1Note}）`)
    // 长按：狂猎时刻 #1 + #3（60 能量；#3 蓄力额外 +10% → 22%）
    pushEx(executions, cfg, '1141015', holdPlain, EX_HOLD_ENERGY, 0, '狂猎时刻 #1（长按）')
    pushEx(executions, cfg, '1141017', holdPlain, EX_HOLD_ENERGY, 0, '狂猎时刻 #3（长按）')
    pushEx(executions, cfg, '1141015', holdStrong, EX_HOLD_ENERGY, 12, `狂猎时刻 #1（长按${c1Note}）`)
    pushEx(executions, cfg, '1141017', holdStrong, EX_HOLD_ENERGY, 22, `狂猎时刻 #3（长按蓄力${c1Note}）`)
  },

  patchExecutions({ cfg, executions }: AgentResourceInput) {
    const huntCount = cfg.lycaonStunCount ?? 0
    if (huntCount <= 0) return

    const windowDur = cfg.lycaonWindowDuration ?? 16
    const totalTime = cfg.lycaonTotalTime ?? 180
    const invincible = cfg.lycaonInvincibleTime ?? 0
    const backstageDodgeCount = cfg.lycaonBackstageDodgeCount ?? 0

    // 莱卡恩前台时间 = 自身执行计划全部招式总时间（平A/强特/终结/连携/闪反/弹刀/支援突击）
    const frontTime = executions.reduce((sum, e) => sum + (e.totalTime ?? 0), 0)

    // 围猎可用后台时间（用户口径）：总时间 - 无敌时间 - 失衡总时长 - 莱卡恩前台时间
    const backstageTotal = Math.max(0, totalTime - invincible - huntCount * windowDur - frontTime)
    if (backstageTotal <= 0) return

    // 后台闪反时间 = 闪反次数 × 闪避反击 actionTime（1141019 = 0.6s）
    const DODGE_ACTION_TIME = 0.6
    const dodgeTime = backstageDodgeCount * DODGE_ACTION_TIME
    // 真正的围猎平A时间 = 后台时间 - 闪反时间（每次围猎 ≤ 8s）
    const huntBasicTotal = Math.max(0, Math.min(8 * huntCount, backstageTotal - dodgeTime))

    // ① + ④ 开场冰舞（弹刀后触发，必定合轴）+ 收尾冰舞（围猎结束自动）：
    // 1141027 完整数值（damage/daze/异常积蓄/喧响），不占前台时间
    executions.push({
      moveId: '1141027',
      moveName: '支援突击：复仇反扑·冰舞（围猎·开场+收尾）',
      category: 'assist',
      count: huntCount * 2,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.lycaonIceDanceDecibel ?? 0,
      totalDecibelRecovery: (cfg.lycaonIceDanceDecibel ?? 0) * huntCount * 2,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      anomalyBuildUp: cfg.lycaonIceDanceAnomaly ?? 0,
      skillTableNote: `围猎开场（弹刀后必定合轴）+ 收尾（自动）各 1 次/失衡 × ${huntCount} 次；完整数值（含异常积蓄/喧响）`,
    })

    // ② 后台闪避反击（跟随前台角色闪反，仅伤害+失衡值；失衡提升由面板 dodgeCounter 区承担）
    if (backstageDodgeCount > 0 && (cfg.lycaonDodgeDaze ?? 0) > 0) {
      executions.push({
        moveId: '1141019',
        moveName: '闪避反击（围猎·后台跟随）',
        category: 'dodge',
        count: backstageDodgeCount,
        actionTime: 0,
        comboAlignRatio: 0,
        totalTime: 0,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0, // 显式 0：后台招式仅伤害+失衡值（enrich 尊重显式 0）
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        anomalyBuildUp: 0,
        skillTableNote: `围猎后台跟随闪反 × ${backstageDodgeCount} 次（队伍其他角色闪反次数之和）；仅伤害+失衡值（吃核心被动闪反失衡+80%）`,
        timeBucket: 'backstage',
      })
    }

    // ③ 围猎后台蓄力平A：#2→#4→#6 短循环秒均 × 平A时间（仅伤害+失衡值；失衡提升由面板 basic 区承担）
    const perSec = cfg.lycaonChargePerSec ?? 0
    const dazePerSec = cfg.lycaonChargeDazePerSec ?? 0
    if (huntBasicTotal > 0 && (perSec > 0 || dazePerSec > 0)) {
      executions.push({
        moveId: 'basic_attack',
        moveName: '普通攻击（围猎·后台蓄力 #2→#4→#6）',
        category: 'basic',
        count: 0,
        actionTime: 0,
        comboAlignRatio: 0,
        totalTime: huntBasicTotal,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0,
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        damageMultiplier: perSec,
        damageMultiplierOverride: true,
        dazeMultiplier: dazePerSec,
        dazeMultiplierOverride: true,
        anomalyBuildUp: 0,
        skillTableNote: `围猎·后台蓄力平A：${huntBasicTotal.toFixed(1)}s（后台 ${backstageTotal.toFixed(1)}s − 闪反 ${dodgeTime.toFixed(1)}s，每次≤8s × ${huntCount}）；仅伤害+失衡值（吃核心被动蓄力失衡+80%）`,
        timeBucket: 'backstage',
      })
    }
  },

  settings: [
    {
      id: 'lycaon.exHoldRatio',
      label: '莱卡恩·长按强特占比（点按/长按分配）',
      description: '强化特殊技：狂猎时刻 两种施放——点按 40 能量（#1+#2，1.717s）与长按 60 能量（#1+#3，2.501s）。本滑块为长按占比，默认 100%（全长按，倍率更高）。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
    {
      id: 'lycaon.c1Coverage',
      label: '莱卡恩·影画1强特失衡强化覆盖率',
      description: '影画1：狂猎时刻失衡值 +12%（长按蓄力 #3 额外 +10% → 22%），8 秒冷却触发一次。按覆盖率折算强化次数 = min(强特总数, floor(战斗时间/8) × 覆盖率)，默认 100%。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
  ],
}

// 强特双模式常量（用户口径）
const EX_TAP_ENERGY = 40
const EX_HOLD_ENERGY = 60
const EX_TAP_TIME = 0.767 + 0.95 // 狂猎时刻 #1 + #2
const EX_HOLD_TIME = 0.767 + 1.734 // 狂猎时刻 #1 + #3
// 强特段 actionTime（倍率表）
const EX_MOVE_TIMES: Record<string, number> = {
  '1141015': 0.767,
  '1141016': 0.95,
  '1141017': 1.734,
}

function pushEx(
  executions: CharacterResourceResult['executions'],
  cfg: { exSpecialComboAlignRatio?: number; lycaonExDecibels?: Record<string, number> },
  moveId: string,
  count: number,
  energy: number,
  stunBuildUpBonus: number,
  label: string,
): void {
  if (count <= 0) return
  const actionTime = EX_MOVE_TIMES[moveId] ?? 1
  const decibel = cfg.lycaonExDecibels?.[moveId] ?? 0
  executions.push({
    moveId,
    moveName: `强化特殊技：${label}`,
    category: 'special',
    count,
    actionTime,
    comboAlignRatio: cfg.exSpecialComboAlignRatio ?? 0,
    totalTime: count * actionTime,
    totalComboAlignTime: count * actionTime * (cfg.exSpecialComboAlignRatio ?? 0),
    energyConsume: energy,
    totalEnergyConsume: energy * count,
    decibelRecovery: decibel,
    totalDecibelRecovery: decibel * count,
    ...(stunBuildUpBonus > 0 ? { stunBuildUpBonus } : {}),
    ...(stunBuildUpBonus > 0 ? { skillTableNote: `影画1强化：失衡值提升 +${stunBuildUpBonus}%（乘区加算）` } : {}),
  })
}

function findMoveById(skills: { categories: { moves: SkillMove[] }[] } | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const found = cat.moves.find(m => m.id === moveId)
    if (found) return found
  }
  return null
}

function rowValue(move: SkillMove | null | undefined, rowId: string): number {
  const row = move?.rows?.find(r => r.id === rowId)
  return row?.values?.[0] ?? 0
}

function cfgNum(cfg: CharacterOperationConfig, key: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record[`setting:${key}`] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
