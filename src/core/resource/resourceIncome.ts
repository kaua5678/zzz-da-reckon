/**
 * 单角色资源收入账本（R43 结构熵切面：自 `core/resource/helpers.ts` 纯搬运，零逻辑改动）。
 *
 * 为什么这两个小节是一族：`calcEnergySource` / `calcRawDecibelParts` /
 * `calcDecibelSource` 回答的是同一件事——「**本槽这一轮拿到多少能量与喧响**」，
 * 只是三个刻度（原始通道 / 原始分项 / 含效率与队友分享的最终账本），
 * 且共用同一批行级 Σ（`feasibleRows` + `rowEnergyTotal` / `rowDecibelTotal`）。
 * 依赖只**下行**到 `./crossAgentEnergy.ts`、`./rowAccounting.ts`、`./rowBuild.ts`。
 *
 * ⚠ 随本段迁来的两条 `@fact`（`engine:能量收入行级Σ` / `engine:喧响收入行级Σ`）的
 * 「锚」仍指向 `./rowBuild.ts#feasibleRows`——那正是两条口径的实现落点
 * （「Σ 可行行的行级收入」），口径内容与锚语义均一字未改。
 */
import type {
  CharacterOperationConfig, EnergySource, DecibelSource, IterationState,
} from '@/types/resource'
import { emptyCrossAgentEnergy } from './crossAgentEnergy'
import {
  decibelEfficiencyMultiplier, timeSliceTriggerCounts, rowEnergyTotal, rowDecibelTotal,
} from './rowAccounting'
import { feasibleRows } from './rowBuild'

/** 计算单角色能量回复（单次迭代，基于当前时间分配） */
export function calcEnergySource(
  cfg: CharacterOperationConfig,
  state: IterationState,
  teamCfg: CharacterOperationConfig[],
  shieldCount: number,
  energyShieldCount: number,
  chainCountTotal = 0,
  totalTime = 180,
  /** Σ 队友前台秒（行级能量 buildExecutions 需要，与装配层同语义：不含自己） */
  teamFrontlineSeconds = 0,
): EnergySource {
  const p = cfg.panel
  const n = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

  // 普通能量/闪能共用同一套公式：
  // (基础 × (1 + 百分比加成) + 固定加成) × (1 + 获得效率)。
  // 命破（闪能）：基础自动回复 = flashEnergyRegen（如 2/s）；固定/百分比回能加成只作用于能量，
  // 闪能自己的固定/百分比走 flashEnergyRegenBonusFlat/flashEnergyRegenBonusPct（目前只有影画2 的 0.5/s 闪能回复）。
  const isFlash = cfg.isFlashUser
  const baseRegen = isFlash ? n(p.flashEnergyRegen) : n(p.energyRegen)
  const pctBonus = (isFlash ? n(p.flashEnergyRegenBonusPct) : n(p.energyRegenBonusPct)) / 100
  const flatBonusRate = isFlash ? n(p.flashEnergyRegenBonusFlat) : n(p.energyRegenBonusFlat)
  const normalGainEfficiency = (isFlash ? n(p.flashEnergyGainEfficiency) : n(p.energyGainEfficiency)) / 100

  // 条件固定回能：灼心摇壶按后台时间，思络成歌按非操作/合轴时间。这些是能量回能，命破（闪能）不吃。
  const backstageFlatRate = isFlash ? 0 : n(cfg.backstageRegenBonus) + n(p.backstageEnergyRegenFlat) + n(p.roaringRideBackstageEnergyRegen)
  const nonOperatingFlatRate = isFlash ? 0 : n(cfg.comboAlignRegenBonus) + n(p.nonOperatingEnergyRegenFlat)

  const autoRegen = baseRegen * totalTime
  const pctRegenBonus = baseRegen * pctBonus * totalTime
  const flatRegenBonus = flatBonusRate * totalTime
  const backstageBonus = state.backstageTime * backstageFlatRate
  const comboAlignBonus = state.comboAlignTime * nonOperatingFlatRate

  const preEfficiencyAuto = autoRegen + pctRegenBonus + flatRegenBonus + backstageBonus + comboAlignBonus
  const demaraTriggerCount = cfg.dodgeCounterCount + cfg.quickAssistCount + cfg.parryCount
  const demaraCoverageSeconds = Math.min(totalTime, Math.max(0, demaraTriggerCount * 8))
  const demaraCoverageRate = totalTime > 0 ? demaraCoverageSeconds / totalTime : 0
  const demaraEfficiency = n(p.demaraEnergyGainEfficiency) / 100
  const averageAutoRate = totalTime > 0 ? preEfficiencyAuto / totalTime : 0
  const gainEfficiencyBonus = preEfficiencyAuto * normalGainEfficiency
    + averageAutoRate * demaraCoverageSeconds * demaraEfficiency

  // 招式回复（行级 Σ，记账层 == 展示层，calcRawDecibelParts.skillRegen 同构，2026-09-09 债务清偿）。
  // 旧「平A时间 × 秒均回能」聚合通道删除：平A聚合行 totalEnergyRecovery 本就是同一常量的载体
  // （core buildExecutions：state.basicAttackTime × basicAttackRegenPerSec），恒等部分不变；差异全部
  // 来自模块行与表值回填行——专属链角色行级能量曾系统性漏计（第一段清账后 89 行回填 + 模块预计算行，
  // 如伊德海莉蓄力循环把平A载体置 0、由 slam/follow 行承载闪能，旧聚合按全额平A时间计 = 口径分裂）。
  // 相位隔离复用 materializeRows（cfg 快照 + 恢复，喧响通道同款）；行值语义见 rowEnergyTotal。
  // @fact engine:能量收入行级Σ 口径: skillRegen = Σ 可行行的行级能量收入（rowEnergyTotal，与喧响收入行级Σ 同构；记账层==展示层）。teamFrontlineSeconds 语义 == 装配层（Σ 队友前台秒）。cfg.rowTimeLimit 缺省 = 未截断行（默认路径走 materializeRows，零 delta）；被 calcTeamResources 重折环按上一轮装配 kept 写入时按 feasibleRows（招式行 ≤ kept，与装配同一截断算法）计——债 2「截断不回灌」由外环收敛吸收，账本与展示层同源 | 据 债务审计 07481b8 + 引擎探针@2026-09-09 · 债2批2-1@2026-09-19 R37 | 验 src/core/__tests__/energyRowParity.test.ts + src/core/__tests__/truncationRefold.test.ts | 锚 src/core/resource/rowBuild.ts#feasibleRows | 信 确认
  // ⟳复核: 账本行级收入口径再动、或重折环上限/容差/kept 口径再动时，复核「无 rowTimeLimit 的队 skillRegen 逐位不变」+「重折队 Σcut 只减不增」（truncationRefold.test.ts） | 到期 2026-12-31
  const skillRegen = feasibleRows(cfg, state, chainCountTotal, teamFrontlineSeconds, cfg.rowTimeLimit)
    .reduce((sum, row) => sum + rowEnergyTotal(cfg, row), 0)

  // 辅助大招回复由上层根据其他角色最终终结技次数补入。
  let supportUltimateRegen = 0
  for (const other of teamCfg) {
    if (other.slot === cfg.slot) continue
    if (other.supportUltimateEnergyRegen > 0) {
      // 上层补算，保留循环以便后续接入更细的辅助终结技时间轴。
    }
  }

  const timeSliceTriggers = timeSliceTriggerCounts(cfg, state, chainCountTotal, totalTime)
  const timeSliceEnergy = n(cfg.panel.timeSliceEnergyPerTrigger) * timeSliceTriggers.total
  const zhenyuanEnergy = n(cfg.panel.zhenyuanEnergyPerTrigger) * n(cfg.zhenyuanTriggerCount)

  // 诺姆影画2·帽子把戏：战斗中触发回 25 能量，20 秒冷却；按战斗时间驱动（默认 180s → floor(180/20)=9 次）。
  const hatTrickInterval = n(cfg.normaC2TriggerInterval)
  const hatTrickEnergy = n(cfg.normaC2EnergyPerTrigger) > 0 && hatTrickInterval > 0
    ? Math.max(0, Math.floor(totalTime / hatTrickInterval)) * n(cfg.normaC2EnergyPerTrigger)
    : 0

  // 青衣影画4·稳态电弧屏障：护盾刷新回 5 能量，10 秒冷却；按战斗时间驱动（默认 180s → floor(180/10)=18 次）。
  const qingyiC4Interval = n(cfg.qingyiC4TriggerInterval)
  const qingyiC4Energy = n(cfg.qingyiC4EnergyPerTrigger) > 0 && qingyiC4Interval > 0
    ? Math.max(0, Math.floor(totalTime / qingyiC4Interval)) * n(cfg.qingyiC4EnergyPerTrigger)
    : 0

  // 莱卡恩影画2·能量回馈：使敌人失衡或触发队友[连携技]时回 5 能量；次数 = 失衡次数 + 队伍连携总次数（外层注入总额）
  const lycaonC2Energy = n(cfg.lycaonC2Energy)

  // 比利影画1·闪亮登场：冲刺/闪反原始命中次数合并后按5秒ICD封顶，由模块预计算总额。
  const billyC1Energy = n(cfg.billyC1Energy)

  // 般岳山威回闪能不再走这里：那是**招式级回能**（每发山威强特回 10，C2 +5），已由模块
  // `mechanics/agents/banyue#patchExecutions` 落在执行行 `energyRecovery` 上 ⇒ 经 `skillRegen`
  // （Σ 行级能量收入）进总账。此前用 `banyueSwayRefund` 平行字段加总，导致卡片「闪能·招式回复」
  // 显示 0 而总账里却含这笔（2026-09-11 用户发现；规则 11 单一事实源 + 规则 16 挂活代码）。
  // 仪玄：额外闪能总账（模块在 buildCharConfig 汇总：完美格挡+10/次、极限闪避+5/次、影画1落雷+5/次）
  const yixuanFlashBonus = n(cfg.yixuanFlashBonus)
  // agentId 判断冗余已删：antonC1EnergyGift 唯一写入方 = src/mechanics/agents/anton.ts:53
  // （setRecord 只写本模块自己的 cfg）；n() 把 undefined 映射为 0，与原三元的 else 分支同值
  // ——与上一行 yixuanFlashBonus 的无守卫写法同款。
  const antonC1EnergyGift = n((cfg as any).antonC1EnergyGift)

  const initialGift = cfg.initialEnergyGift
  const shieldBreakGift = shieldCount * 60
  const energyShieldBreakGift = cfg.isFlashUser ? 0 : energyShieldCount * 30

  // 不含伊德海莉 refund 的固定源能量 E0（唯一来源：加一项固定源就补进这里，防两处漂移）
  const e0 = preEfficiencyAuto + gainEfficiencyBonus
    + skillRegen + supportUltimateRegen + timeSliceEnergy + zhenyuanEnergy
    + hatTrickEnergy
    + qingyiC4Energy
    + lycaonC2Energy
    + billyC1Energy
    + yixuanFlashBonus
    + antonC1EnergyGift
    + initialGift + shieldBreakGift + energyShieldBreakGift

  // 伊德海莉：非失衡（溯寒后）极寒重碾每次回闪能；失衡内 = 轴连段反推（有轴）或 每次失衡次数 × 失衡次数，剩余为非失衡。
  // 自指反馈解析求解（2026-09-04 修复 19/20 双稳态）：refund 不回读上一轮整数强特次数
  // （floor 在迭代中途截断反馈 → 同一输入多个不动点，种子相关）。对 50·O = E0 − inStunCost + 15·O
  // 解析求解 O* = (E0 − inStunCost)/35；迭代期用实数 O*（强特次数同实数化 → 唯一不动点），
  // 终局整数重推（yidhariFinalizeEx）才 floor——floor 只发生一次，不在收敛中途截断资源循环。
  const yidhariRefundPer = cfg.yidhariRefundPerOutStunEx !== undefined ? n(cfg.yidhariRefundPerOutStunEx) : 0
  const yidhariRefund = (() => {
    // 原判据 `cfg.agentId !== '1051' || yidhariRefundPer <= 0`：左侧 agentId 判断**冗余**——
    // `yidhariRefundPer` 派生自 `yidhariRefundPerOutStunEx`，其唯一写入方 = `yidhari.ts:145`
    // （模块只写自己那份 cfg）⇒ 该值为 0 即蕴含「不是该角色或未启用」，短路语义由右操作数完全覆盖。
    // 2026-09-15 core 棘轮批次2（T6 冗余判据），timeGolden 0 delta。
    if (yidhariRefundPer <= 0) return 0
    const consume = n(cfg.exSpecialEnergyConsume)
    if (consume <= yidhariRefundPer) return 0
    const finalize = cfg.yidhariFinalizeEx === true
    const quant = (o: number) => (finalize ? Math.floor(o) : o)
    if (cfg.yidhariInStunExCount !== undefined) {
      // 轴模式：失衡内次数固定（轴连段反推），refund 只作用于失衡外强特
      const inStun = n(cfg.yidhariInStunExCount)
      const inStunCost = n(cfg.yidhariInStunEnergyCost ?? inStun * consume)
      const outStar = Math.max(0, (e0 - inStunCost) / (consume - yidhariRefundPer))
      return quant(outStar) * yidhariRefundPer
    }
    // 非轴：失衡内 = min(ex, cap)；ex ≤ cap 无 refund，ex > cap 的溢出部分每发回 refundPer
    const cap = n(cfg.yidhariExPerStun ?? 2) * n(cfg.yidhariStunCount ?? 0)
    if (e0 / consume <= cap) return 0
    const outStar = Math.max(0, (e0 - cap * consume) / (consume - yidhariRefundPer))
    return quant(outStar) * yidhariRefundPer
  })()

  const total = e0 + yidhariRefund

  return {
    autoRegen,
    pctRegenBonus,
    flatRegenBonus,
    backstageBonus,
    comboAlignBonus,
    gainEfficiencyBonus,
    demaraCoverageSeconds,
    demaraCoverageRate,
    skillRegen,
    timeSliceEnergy,
    zhenyuanEnergy,
    hatTrickEnergy,
    qingyiC4Energy,
    lycaonC2Energy,
    billyC1Energy,
    yidhariRefund,
    yixuanFlashBonus,
    antonC1EnergyGift,
    supportUltimateRegen,
    // 队友联动明细在此阶段拿不到其他槽位的收敛次数，由调用方用 calcCrossAgentEnergy 回填
    crossAgent: emptyCrossAgentEnergy(),
    initialGift,
    shieldBreakGift,
    energyShieldBreakGift,
    total,
  }
}


export function calcRawDecibelParts(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal = 0,
  exSpecialCount = state.exSpecialCount,
  ultimateCount = state.ultimateCount,
  totalTime = 180,
  teamFrontlineSeconds = 0,
): { skillRegen: number; bonusRegen: number; timeSliceDecibel: number; shareableTotal: number } {
  // @fact engine:喧响收入行级Σ 口径: skillRegen = Σ 可行行的行级喧响收入（rowDecibelTotal，与伤害/失衡/异常「倍率列逐行进账」同构）。旧「次数×常量」聚合通道删除：聚合行与 buildExecutions 常量同源故恒等，差异全部来自模块行（债务清偿——专属链角色曾系统性低估，仪玄行级 5628 vs 聚合 1702；yixuanBackstageDecibel 聚合项曾把 4 招全加而合轴语义是二选一替换对，行级即修复）。迭代期用本次调用的 exSpecialCount/ultimateCount 覆盖进 rowState（伊德海莉 decibel 通道 floor 口径、实数松弛口径均不变）；teamFrontlineSeconds 语义 == 装配层（Σ 队友前台秒）。cfg.rowTimeLimit 缺省 = 未截断行（默认路径零 delta）；重折环写入时按 feasibleRows 计，与能量行级Σ 同一分支 | 据 债务审计 5761e02 + 引擎探针@2026-09-08 · 债2批2-1@2026-09-19 R37 | 验 src/core/__tests__/decibelRowParity.test.ts + src/core/__tests__/truncationRefold.test.ts | 锚 src/core/resource/rowBuild.ts#feasibleRows | 信 确认
  // ⟳复核: 与能量收入行级Σ 的 ⟳复核 联动（同一分支、同一测试） | 到期 2026-12-31
  const rowState: IterationState = (exSpecialCount !== state.exSpecialCount || ultimateCount !== state.ultimateCount)
    ? { ...state, exSpecialCount, ultimateCount }
    : state
  // 相位隔离（2026-09-08，2026-09-09 收口）：buildExecutions 里仍有多模块写 cfg 缓存字段，本通道
  // 每轮每角色额外调用它（迭代 Step1 + 装配队友分享 n×(n−1) 次），不隔离就会在错误相位覆写。
  // **跨相位写入已全部拆出**（阶段1 第二刀：格莉丝 5 字段 / 叶瞬光 cycle → `materializePhaseState`
  // 引擎侧显式补写；卢西娅 cap 走 `preModuleExecutions` 行基准；仪玄死回写已删）——本快照现在
  // 只兜住「同调用内消费者」的缓存字段。实测格莉丝队 nt −7.14s → 平A池 +5.12s → 轴 frontTotal
  // 180.55→190.66 → 误触轴回退（inStunAttribution 全队红）就是缺这层隔离的样子。
  const rows = feasibleRows(cfg, rowState, chainCountTotal, teamFrontlineSeconds, cfg.rowTimeLimit)
  const skillRegen = rows.reduce((sum, row) => sum + rowDecibelTotal(cfg, row), 0)

  // 奖励回复：池内效果（时光切片）。弹刀/闪反/连携/快支的固定奖励与异常奖励由外部按槽位注入
  // （specialActionDecibelBonusPerSlot / anomalyDecibelBonusPerSlot），避免与展示层双算。
  const timeSliceTriggers = timeSliceTriggerCounts(cfg, state, chainCountTotal, totalTime, exSpecialCount)
  const timeSliceDecibel = (cfg.panel.timeSliceDodgeCounterDecibel ?? 0) * timeSliceTriggers.dodgeCounter
    + (cfg.panel.timeSliceExSpecialDecibel ?? 0) * timeSliceTriggers.exSpecial
    + (cfg.panel.timeSliceAssistDecibel ?? 0) * timeSliceTriggers.assist
    + (cfg.panel.timeSliceChainDecibel ?? 0) * timeSliceTriggers.chain
  const bonusRegen = timeSliceDecibel

  return {
    skillRegen,
    bonusRegen,
    timeSliceDecibel,
    shareableTotal: skillRegen + bonusRegen,
  }
}

/** 计算单角色喧响回复（单次迭代，基于当前招式执行计划） */
export function calcDecibelSource(
  cfg: CharacterOperationConfig,
  state: IterationState,
  teammateShare: number,
  chainCountTotal = 0,
  totalTime = 180,
  /** 额外的不可分享喧响（如卢西娅4命帷幕触发全队每人 +100/次），由调用方按收敛后次数注入 */
  extraUnshareableDecibel = 0,
  /** 特殊动作奖励（弹刀215/闪反10/连携10/快支20，含伴随50%），由全局配置按槽位注入 */
  specialActionBonus = 0,
  /** 异常/紊乱/乱流奖励（含伴随50%），由全局配置按槽位注入（上一轮异常池结果） */
  anomalyBonus = 0,
  /** Σ 队友前台秒（行级喧响 buildExecutions 需要，与装配层同语义：不含自己） */
  teamFrontlineSeconds = 0,
): DecibelSource {
  const efficiency = decibelEfficiencyMultiplier(cfg)
  const raw = calcRawDecibelParts(cfg, state, chainCountTotal, state.exSpecialCount, state.ultimateCount, totalTime, teamFrontlineSeconds)

  // 喧响获得效率完整作用于所有获得来源：开局、招式、奖励、队友伴随。
  const initialGift = cfg.initialDecibelGift * efficiency
  const skillRegen = raw.skillRegen * efficiency
  const bonusRegen = raw.bonusRegen * efficiency
  const timeSliceDecibel = raw.timeSliceDecibel * efficiency
  const teammateShareWithEfficiency = teammateShare * efficiency
  // 伊德海莉烧血喧响：开局场外烧 75% 至 25% + 战斗中把全部回复量烧掉；固定不可分享
  const yidhariBurnDecibel = (() => {
    // 原判据 `cfg.agentId !== '1051'`：改用**模块专属字段**判别（2026-09-15 core 棘轮批次2）。
    // `yidhariDecibelPerHpPct` 的唯一写入方 = `yidhari.ts:113`（模块无条件写自己那份 cfg）⇒
    // 非该角色 cfg 恒 undefined。不能用下面带 `?? 默认` 的两个字段做判据（它们对任意 cfg 都有值），
    // 故显式取这个无默认的字段（判据同 T6；规则 6：引擎按能力/字段查询，不按角色名查询）。
    // timeGolden 0 delta。
    if (cfg.yidhariDecibelPerHpPct === undefined) return 0
    const missing = Math.max(0, Math.min(1, cfg.yidhariExHealMissingHpPct ?? 0.75))
    const decibelPerHp = cfg.yidhariDecibelPerHpPct ?? 10
    const external = Math.max(0, cfg.yidhariExternalHealPct ?? 0)
    const cycleTime = 1 + (cfg.yidhariChargeSlam?.actionTime ?? 0) + (cfg.yidhariBasicFollow?.actionTime ?? 0)
    const cycles = cycleTime > 0 ? Math.floor((state.basicAttackTime ?? 0) / cycleTime) : 0
    const exHeal = (state.exSpecialCount ?? 0) * 33 * missing
    const followHeal = cycles * 10
    return (75 + exHeal + followHeal + external) * decibelPerHp
  })()
  const unshareableBonus = (
    (cfg.extraSelfDecibelReward ?? 0)
    + (cfg.extraSelfDecibelPerUltimate ?? 0) * state.ultimateCount
    + yidhariBurnDecibel
    + extraUnshareableDecibel
  ) * efficiency
  const specialActionBonusWithEfficiency = specialActionBonus * efficiency
  const anomalyBonusWithEfficiency = anomalyBonus * efficiency
  const shareableTotal = skillRegen + bonusRegen
  const total = initialGift + shareableTotal + teammateShareWithEfficiency + unshareableBonus
    + specialActionBonusWithEfficiency + anomalyBonusWithEfficiency

  return {
    initialGift,
    skillRegen,
    bonusRegen,
    timeSliceDecibel,
    specialActionBonus: specialActionBonusWithEfficiency,
    anomalyBonus: anomalyBonusWithEfficiency,
    teammateShare: teammateShareWithEfficiency,
    unshareableBonus,
    yidhariBurnDecibel,
    shareableTotal,
    total,
  }
}
