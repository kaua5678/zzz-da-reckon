/**
 * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）
 *
 * 域：能量（含闪能）与喧响资源
 * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。
 */

// ============ 能量资源 ============

/**
 * 队友联动回能明细（依赖「其他槽位的次数」的能量来源）。
 *
 * 这些来源既要参与 iterate 的次数推导，也必须出现在最终 energySource 明细里。
 * 单一事实源 = `core/resource/helpers.ts` 的 `calcCrossAgentEnergy`（两处调用同一函数）。
 * 历史事故：曾在 iterate 与最终装配各写一份，且最终明细只补回 supportUltimateRegen，
 * 导致界面「能量/闪能总览」比真正驱动次数的能量少一截（仪玄队友终结闪能 120 全程不可见）。
 */
export interface CrossAgentEnergy {
  /** 辅助角色终结技邻位回能（其他角色 supportUltimateEnergyRegen × 其终结技次数） */
  supportUltimateRegen: number
  /** 模块声明的「队友终结技回闪能」（仪玄额外能力·玄墨暗涌 20/次） */
  teamUltimateFlash: number
  /** 丽娜（1211）终结技按槽位补充能量 */
  rinaUltEnergy: number
  /** 苍角（1131）终结技邻位回能（邻位 30/10） */
  soukakuUltEnergy: number
  /** 露西（1151）终结邻位回能 + 影画1 回旋全队回能 */
  lucyEnergy: number
  /** 莱特（1161）影画4 士气喷发后场回能 */
  lighterC4Energy: number
  /** 席德（1461）额外能力为正兵回能（2 能量/秒 × 席德前台时间，1秒至多1次） */
  xideVanguardEnergy: number
  /** 合计（已计入 EnergySource.total） */
  total: number
}

/** 能量回复来源明细 */
export interface EnergySource {
  /** 自动回复：基础回能 × 战斗时间，不含百分比/固定/效率加成 */
  autoRegen: number
  /** 百分比回能加成：基础回能 × 百分比加成 × 战斗时间 */
  pctRegenBonus: number
  /** 全程固定回能加成：固定加成 × 战斗时间 */
  flatRegenBonus: number
  /** 后台回能加成：后台时间 × 后台固定回能加成（来自灼心摇壶等） */
  backstageBonus: number
  /** 非操作回能加成：合轴/非操作时间 × 非操作固定回能加成（来自思络成歌等） */
  comboAlignBonus: number
  /** 获得效率额外收益：上述自动回能来源 × 能量获得效率（含德玛拉覆盖秒数折算） */
  gainEfficiencyBonus: number
  /** 德玛拉电池II型覆盖秒数：min((闪反+快支+弹刀)×8, 战斗时间) */
  demaraCoverageSeconds: number
  /** 德玛拉电池II型覆盖率：覆盖秒数 / 战斗时间 */
  demaraCoverageRate: number
  /** 招式回复（Σ 执行行的行级能量收入：rowEnergyTotal——平A聚合行载体 + 表值回填行 + 模块预计算行；记账 == 展示，DecibelSource.skillRegen 同构） */
  skillRegen: number
  /** 时光切片触发回能：按闪反/强特/支援/连携触发次数结算 */
  timeSliceEnergy: number
  /** 真元奇枢受伤/回血触发回能：当前需资源轴提供触发次数，默认0 */
  zhenyuanEnergy: number
  /** 诺姆影画2·帽子把戏回能：战斗中触发帽子把戏回25能量，20秒冷却；按战斗时间驱动（180s→9次） */
  hatTrickEnergy: number
  /** 青衣影画4·稳态电弧屏障回能：护盾刷新回5能量，10秒冷却；按战斗时间驱动（180s→18次） */
  qingyiC4Energy: number
  /** 莱卡恩影画2·能量回馈回能：失衡或队友连携触发回5能量；次数 = 失衡次数 + 队伍连携总次数 */
  lycaonC2Energy: number
  /** 比利影画1：冲刺攻击/闪避反击命中回能（合并原始次数后按5秒冷却封顶） */
  billyC1Energy: number
  /** 伊德海莉：非失衡（溯寒后）极寒重碾每次回 15 闪能 */
  yidhariRefund: number
  /** 仪玄：额外闪能总账（完美格挡+10/次、极限闪避+5/次、影画1落雷+5/次，模块汇总进 cfg.yixuanFlashBonus） */
  yixuanFlashBonus: number
  /** 安东影画1：每个实际电钻招式最多回5能量，已计入 total */
  antonC1EnergyGift: number
  /** 辅助大招回复：辅助大招次数 × 每次回能量（= crossAgent.supportUltimateRegen，保留旧字段供界面直读） */
  supportUltimateRegen: number
  /** 队友联动回能明细（已计入 total；单一事实源 calcCrossAgentEnergy） */
  crossAgent: CrossAgentEnergy
  /** 开局赠送（普通人40，仪玄120闪能，般岳/比利60闪能，部分命座额外） */
  initialGift: number
  /** 破秽盾赠送（60点能量/闪能） */
  shieldBreakGift: number
  /** 破能量盾赠送（30点能量，不给命破角色加闪能） */
  energyShieldBreakGift: number
  /** 总计 */
  total: number
}

// ============ 喧响资源 ============

/** 喧响回复来源明细 */
export interface DecibelSource {
  /** 开局赠送（每人1000，部分命座额外） */
  initialGift: number
  /** 招式回复（平A+强特+大招+连携等所有招式的 decibel_recovery 之和） */
  skillRegen: number
  /** 奖励回复（时光切片等池内效果；快支/弹刀/连携奖励见 specialActionBonus） */
  bonusRegen: number
  /** 时光切片额外喧响：按闪反/强特/支援/连携触发次数结算，已计入奖励回复 */
  timeSliceDecibel: number
  /** 特殊动作奖励（弹刀215/闪反10/连携10/快支20，含队友伴随50%）；参与终结技次数推导 */
  specialActionBonus: number
  /** 异常/紊乱/乱流触发奖励（含队友伴随50%）；参与终结技次数推导 */
  anomalyBonus: number
  /** 队友伴随获得（其他队友招式回复的 50% 或 52.5%） */
  teammateShare: number
  /** 不可分享的额外喧响（如蕾米一命花羽轮舞） */
  unshareableBonus: number
  /** 伊德海莉烧血喧响（75%开局 + 回血总量）换算，固定不可分享 */
  yidhariBurnDecibel: number
  /** 总计（不含开局赠送，用于分给队友） */
  shareableTotal: number
  /** 总计（含开局赠送） */
  total: number
}
