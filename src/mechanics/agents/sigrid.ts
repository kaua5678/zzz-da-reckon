import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 希格莉德（1591，冰属性·强攻，罗斯凯利法）。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1591.json + noun.json 术语解析（出枪式=Term:1000029、巡空枪势=Term:1000030、破阵=Term:1000028）。
 *
 * 面板级效果走 applyPanel 读 input.settings（文档化通道）：
 * - 核心被动·天空骑士 Lv.7：巡空枪势暴击率 +66% × 覆盖率；失衡易伤倍率 +20% × 覆盖率
 *   （引擎只在失衡行计入，轴模式窗口内自动生效，非轴按失衡占比折算）
 * - 额外能力·天际联军（[支援]/[击破]队友，声明式 spec.additionalAbility 门控）：
 *   攻击力 +840（Lv60 上限，局内小攻击自拐）；命中[浸染]敌人伤害 +15% × 风化侵染覆盖率
 *   （emitExecDirect 分支读 damagePanels.windInfectionRate，用户口径 2026-02：直接读风化覆盖率）
 * - [砥砺]（连携技·冰凌卷地发动时获得，持续50s）：后续敛枪式伤害 +20%，默认全覆盖，
 *   挂敛枪式三段行 dmgBonus（用户口径 2026-02）
 * - 影画1：自身攻击力 +25%（先乘百分比，再叠加额外能力固定值）
 * - 影画2：喧响值获取效率 +10%（穿透率 +24% 为 moveId 限定，见 patchExecutions；巡空枪势时长 +2s 不建模）
 * - 影画4：每次获得巡空枪势伤害 +18%（8s 上限 40s）× 覆盖率
 *
 * 历史（2026-02 迁移）：面板效果原在 computePanelPhases agent.id==='1591' 硬编码块施加
 * （SOP 废弃绕法①），且滑块按 0-100 百分比声明、消费端 clamp01 按 0-1 消费——UI 拖到中间值
 * 会被钳成 100%，只有 0/100 两档生效。迁移时统一为 0-1 分数刻度。
 *
 * 执行级：
 * - 敛枪式三段执行行（buildExecutions，catalog 真实分段 id）：机会 spend 按一/二/三段轮转均摊
 *   （用户口径：1次机会打1段）；破阵每次失衡送一套三段（免费不耗机会，用户口径）
 * - 影画2：[出枪式]+[敛枪式三段] 穿透率 +24%（moveId 限定 → exec.penRatioBonus）
 * - 影画1：**发动第三段时再送 1 次机会**（自指方程，定点迭代解，增益比 1/3 ⇒ 收敛不发散）；
 *   机会溢出时下一次敛枪式最后一击（第三段）额外 100% 攻击力冰伤 × 溢出覆盖率滑块（**默认 0**：
 *   100% 利用率下储存位常年为空 ⇒ 原文「溢出时」不成立 ⇒ 不计算）
 * - 影画6：敛枪式一/二/三段最后一击额外 80%/90%/100% 攻击力冰伤（真实分段 id，精确建模）；
 *   **破阵段内三段时长 ×0.75**（用户 2026-02 第二轮口径，2026-09-07 从死口径落地为活代码；
 *   轴模式不折——破阵块时间由轴引擎按窗口计账，折两次 = 双算）
 *
 * 未建模（无乘区/时间轴效果，notes 记录）：
 * - 敛枪式格挡成功「刷新巡空枪势 + 送一次机会 + 下一次敛枪式失衡值+100%」（用户裁决 2026-09-07 不做）、
 *   [破阵]的轴内易伤归属（破阵行在轴模式下按轴外处理，待引擎支持）、
 *   影画2 巡空枪势持续时间 +2 秒、敛枪式段数状态机（8/7/6 秒递减与段数升降）
 */

const SIGRID_AGENT_ID = '1591'

/**
 * 敛枪式三段（catalog 倍率表真实 id，轮转一→二→三）。
 * ⚠️ 历史事故（2026-02 用户复查发现）：旧录制把 nanoka skill_list 的 id 当倍率表 id 用——
 * 1591002 实为凛冽枪尖#2（倍率 287.9%）而非敛枪式、1591008 实为敛枪式第二段而非连携技、
 * 1591009 在倍率表中不存在；敛枪式整招缺失且 C2 穿透率挂错 5 个招式。已按 catalog 全表重排。
 */
export const SIGRID_LANCE_SEGMENT_IDS: readonly string[] = ['1591007', '1591008', '1591022']

/**
 * 凛冽枪尖 #1-#4（平A池按段物化的执行行，2026-09-03）。这些行的次数由
 * `countBasicSegments(basicAttackTime, …)` 从平A池推出，**不是独立动作**——机会计数
 * （patchSigridExecutions 行循环）必须跳过它们，否则 #4 会被段行与 countBasicFinisherHits
 * 各数一次 = 双计（用户改判 2026-09-07 删除，见 sigridChuqiangFromState）。
 */
export const SIGRID_BASIC_SEGMENT_MOVE_IDS: readonly string[] = ['1591001', '1591002', '1591004', '1591005']

/** [出枪式] 集合（catalog 真实 id）：凛冽枪尖第四段、乱琼、碎玉、回马枪、冰凌卷地、霜天、冰饕。
 *  凛冽枪尖（1591001-1591005）只有第四段算出枪式。 */
export const SIGRID_CHUQIANG_MOVE_IDS: Set<string> = new Set([
  '1591005', // 普通攻击：凛冽枪尖 #4
  '1591011', // 强化特殊技：乱琼
  '1591012', // 强化特殊技：碎玉
  '1591014', // 闪避反击：回马枪
  '1591015', // 连携技：冰凌卷地
  '1591016', // 终结技：霜天
  '1591021', // 支援突击：冰饕
])

// 面板级常量（nanoka 3.2.3 Lv.7 / 满级影画）
export const SIGRID_CORE_CRIT_RATE = 66
export const SIGRID_CORE_STUN_VULN = 20
export const SIGRID_ADDITIONAL_ATK_FLAT = 840
/** 浸染增伤：15% × 风化侵染覆盖率（emitExecDirect 分支读 damagePanels 的 windInfectionRate，用户口径 2026-02） */
export const SIGRID_INFECTION_DMG = 15
/** [砥砺]（连携技发动时获得）：后续敛枪式伤害 +20%，默认全覆盖（用户口径 2026-02） */
export const SIGRID_DILI_DMG = 20
export const SIGRID_C2_DECIBEL_EFFICIENCY = 10
export const SIGRID_C4_DMG = 18
export const SIGRID_C1_ATK_PCT = 25
// 执行级常量
const CINEMA2_PEN_RATIO = 24
const CINEMA1_OVERFLOW_RATIO = 100
/** 影画6 最后一击附加：一/二/三段 = 80/90/100%（catalog 有真实分段 id，精确建模不再取中值） */
export const SIGRID_C6_LAST_HIT_RATIOS: readonly number[] = [80, 90, 100]

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function settingOf(settings: Readonly<Record<string, number>>, id: string, fallback: number): number {
  const value = Number(settings?.[id])
  return Number.isFinite(value) ? value : fallback
}

/**
 * 面板级机制（核心被动 / 额外能力 / 影画1·2·4）——applyPanel 读 input.settings（已解析滑块，0-1 分数）。
 * 从 computePanelPhases 硬编码块迁入（SOP 废弃绕法① → 文档化通道）。
 * 顺序保持原口径：影画1 攻击先乘百分比，再叠加额外能力固定 +840。
 */
function applySigridPanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  if (!panel) return
  const coreCov = clamp01(settingOf(settings, 'sigrid.corePassiveCoverage', 1))
  if (cinemaLevel >= 1) {
    panel.atk = Math.round((panel.atk ?? 0) * (1 + SIGRID_C1_ATK_PCT / 100))
  }
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    panel.atk = (panel.atk ?? 0) + SIGRID_ADDITIONAL_ATK_FLAT
    // 浸染增伤不在这里：读风化侵染覆盖率（异常池结果），emitExecDirect 分支按覆盖率逐行折算
  }
  panel.critRate = (panel.critRate ?? 0) + SIGRID_CORE_CRIT_RATE * coreCov
  panel.stunDmgMultiplierBonus = (panel.stunDmgMultiplierBonus ?? 0) + SIGRID_CORE_STUN_VULN * coreCov
  if (cinemaLevel >= 2) {
    panel.decibelGainEfficiency = (panel.decibelGainEfficiency ?? 0) + SIGRID_C2_DECIBEL_EFFICIENCY
  }
  if (cinemaLevel >= 4) {
    const c4Cov = clamp01(settingOf(settings, 'sigrid.cinema4Coverage', 1))
    panel.dmgBonus = (panel.dmgBonus ?? 0) + SIGRID_C4_DMG * c4Cov
  }
}

function buildSigridCharConfig({ cfg, cinemaLevel, panel, skills }: AgentCharConfigInput): void {
  cfg.sigridCinemaLevel = cinemaLevel
  // 强化特殊技：默认满覆盖巡空枪势（核心被动覆盖滑块缺省 1，出枪式命中即刷新≈常驻）→
  // 用巡空枪势状态的「碎玉」(1591012, 2096.1%)，而非非巡空枪势的「乱琼」(1591011, 877.7%)。
  // 乱琼仅在前摇未进巡空枪势的首个 E 出现，口径忽略。二者同属[出枪式]，机会/影画2穿透自然成立。
  const suiYu = skills?.categories?.find(c => c.id === 'special')?.moves?.find(m => m.id === '1591012')
  if (suiYu) {
    cfg.exSpecialMoveId = '1591012'
    if (suiYu.actionTime) cfg.exSpecialActionTime = suiYu.actionTime
    const ecRaw = suiYu.energyCost?.['Energy Cost']
    const ec = ecRaw ? parseFloat(ecRaw) : NaN
    if (Number.isFinite(ec) && ec > 0) cfg.exSpecialEnergyConsume = ec
  }
  // 敛枪式最后一击的附加伤害按「局内最终攻击力 × 百分比」进基础区（flatDamageBonus），
  // 此 panel 为 computePanel 的局内权威面板（已含额外能力+840 与影画1 攻击25%）。
  cfg.sigridAtk = Math.max(0, panel?.atk ?? 0)
  // 敛枪式三段元数据从 catalog 预存（buildExecutions 输入无 skills；单一事实源仍是倍率表）
  const basicMoves = skills?.categories?.find(c => c.id === 'basic')?.moves ?? []
  const segments = SIGRID_LANCE_SEGMENT_IDS.map(moveId => {
    const move = basicMoves.find(m => m.id === moveId)
    const row = (id: string) => move?.rows?.find(r => r.id === id)?.values?.[0] ?? 0
    return {
      moveId,
      actionTime: move?.actionTime ?? 0,
      decibelRecovery: row('decibel_recovery'),
      energyRecovery: row('energy_recovery'),
    }
  })
  ;(cfg as unknown as Record<string, unknown>).sigridLanceSegments = segments
  // 平A四段元数据（凛冽枪尖 #1-#4）：#4 命中次数按段循环计数（用户口径：不用平均值×秒数）
  const basicCycle = SIGRID_BASIC_SEGMENT_MOVE_IDS.map(moveId => ({
    moveId,
    actionTime: basicMoves.find(m => m.id === moveId)?.actionTime ?? 0,
  }))
  ;(cfg as unknown as Record<string, unknown>).sigridBasicCycle = basicCycle
}

/**
 * 平A按段循环下的 #4（出枪式）命中次数（用户口径 2026-02：按段数 1-4 循环计数，不用平均数据×秒数）。
 * 压枪（取消 a1/a2）时循环变为 a3→a4：完整循环时长 2.983s → 1.765s，同样平A时间 #4 次数变多。
 * 完整循环各计 1 次 #4；尾部余量推进到 #4（≥ 前三段/前一段时长）再计 1 次。
 */
export function countBasicFinisherHits(basicTime: number, cycle: { moveId: string; actionTime: number }[], pressCancel: boolean): number {
  const segs = pressCancel
    ? cycle.filter(s => s.moveId === '1591004' || s.moveId === '1591005')
    : cycle
  if (segs.length === 0 || basicTime <= 0) return 0
  const cycleTime = segs.reduce((sum, s) => sum + s.actionTime, 0)
  if (cycleTime <= 0) return 0
  const fullCycles = Math.floor(basicTime / cycleTime)
  const tail = basicTime - fullCycles * cycleTime
  // 尾部要推进到 #4：需打完它之前的所有段
  const beforeFinisher = segs.slice(0, -1).reduce((sum, s) => sum + s.actionTime, 0)
  return fullCycles + (tail >= beforeFinisher ? 1 : 0)
}

/**
 * 平A段循环的**每段命中次数**（行级物化用，2026-09-03）。
 * 模型与 countBasicFinisherHits 同构（事件时刻 = 段起点 + k × 循环时长，#4 结果与其完全一致，
 * 保证「机会 = 出枪式#4 命中」与「凛冽枪尖 #4 段行次数」自洽）：
 * hits_i = T ≥ prefix_i ? 1 + floor((T − prefix_i) / cycleTime) : 0。
 * 压枪开：只打 #3/#4（1.765s/循环）；关：打 #1-#4（2.983s/循环）。
 */
// @fact agent:1591/出枪式段时间 口径: 凛冽枪尖 #1-#4 分段行由 `countBasicSegments(basicAttackTime,…)` 推出 ⇒ 占的就是平A池那份时间，必须从通用 basic_attack 聚合行挤出等量时间（只缩时间、保留回能：回能源于整段平A时长而分段行不带 energyRecovery）；伤害侧本就已归零聚合行防双算，时间侧 2026-09-05 才补上 | 据 用户@2026-09-03（段行行级物化）·2026-09-05（时间 carve）·复核@2026-09-08 | 验 src/mechanics/__tests__/sigrid.test.ts#出枪式段的时间占用 | 锚 src/mechanics/agents/sigrid.ts#countBasicSegments | 信 确认
export function countBasicSegments(
  basicTime: number,
  cycle: { moveId: string; actionTime: number }[],
  pressCancel: boolean,
): Record<string, number> {
  const segs = pressCancel
    ? cycle.filter(s => s.moveId === '1591004' || s.moveId === '1591005')
    : cycle
  const out: Record<string, number> = {}
  if (segs.length === 0 || basicTime <= 0) return out
  const cycleTime = segs.reduce((sum, s) => sum + s.actionTime, 0)
  if (cycleTime <= 0) return out
  let prefix = 0
  for (const seg of segs) {
    out[seg.moveId] = basicTime >= prefix - 1e-9 ? 1 + Math.floor((basicTime - prefix) / cycleTime) : 0
    prefix += seg.actionTime
  }
  return out
}

/**
 * applyTeamConfig · converge：记录上一轮收敛的失衡次数。
 * 破阵口径（用户 2026-02）：每次失衡送一套敛枪式三段（免费，不耗机会）→ 触发次数 = 失衡次数。
 */
function applySigridTeamConfig({ slot, characters, phase, stunCount }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  const cfg = characters[slot]
  if (!cfg) return
  ;(cfg as unknown as Record<string, unknown>).sigridStunCount = stunCount
}

/** N 次轮转（一→二→三循环）各段次数：N=4 → (2,1,1) */
export function splitLanceRotation(count: number): [number, number, number] {
  const n = Math.max(0, Math.floor(count))
  return [Math.floor((n + 2) / 3), Math.floor((n + 1) / 3), Math.floor(n / 3)]
}

/**
 * 破阵套数（用户口径 2026-02）——`buildSigridExecutions` 与 `sigridExSpecialTime` 共用，
 * 保证估时与物化同一求解器（消轮间滞后，见 sigridChuqiangFromState 头注）。
 * - 轴模式：轴内「破阵连段」块数（含诺姆赠送连携触发的破阵），由 useResourceCalc 注入；
 *   块经窗口时间门控，窗内放得下几套就几套（易伤归属随之自然成立）
 * - 非轴 C6：连携总次数（每次连携命中失衡敌人触发一次）；非 C6：失衡次数
 */
function sigridPozhenSets(
  cfg: AgentCharConfigInput['cfg'],
  record: Record<string, unknown>,
): number {
  if (record.sigridAxisActive === true) return Math.max(0, Math.floor(Number(record.sigridAxisPozhenSets ?? 0)))
  const cinema = Math.max(0, Math.floor(Number(record.sigridCinemaLevel ?? 0)))
  const raw = cinema >= 6
    ? (cfg.chainCountTotalOverride ?? (cfg.chainCountPerStun ?? 0) * Number(record.sigridStunCount ?? 0))
    : Number(record.sigridStunCount ?? 0)
  return Math.max(0, Math.floor(raw))
}

/**
 * 敛枪式执行行（模块接管，spec event 已删除——旧 carrierMoveId 1591002 是错误 id 且解释器从未接线）：
 * - 巡空枪势轮转：机会 spend 次数按一/二/三段均摊（用户口径：1次机会打1段轮转）
 * - 破阵：每次失衡送一套三段（免费不耗机会，用户口径），段数 = 失衡次数
 * 两部分合并进同一段行（count 相加）；真实 moveId → enrich 从倍率表回填倍率/失衡/积蓄。
 */
// @fact agent:1591/影画1溢出 口径: 影画1「机会**溢出时**下一次敛枪式最后一击+100%攻击力」默认**不计算**（`sigrid.c1OverflowCoverage` 缺省 0，代码侧 fallback 同步为 0）——机会上限 1 次而引擎按「立刻打光」建模（实测 spend 42 / 收入 42.7，储存位常年为空）⇒ 溢出条件不成立；模块无逐事件溢出判定（敛枪式段数状态机未建模），要模拟「攒着不打导致溢出」才调高该滑块 | 据 用户@2026-09-07「不溢出那就不计算呗」·复核@2026-09-08| 验 src/mechanics/__tests__/sigrid.test.ts#影画1溢出 | 锚 src/mechanics/agents/sigrid.ts#buildSigridExecutions | 信 确认
function buildSigridExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const segments = (record.sigridLanceSegments as
    | { moveId: string; actionTime: number; decibelRecovery: number; energyRecovery: number }[]
    | undefined) ?? []
  if (segments.length !== 3) return

  // 机会 spend + 破阵套数：与 sigridExSpecialTime 共用同一求解器（估时/物化不分裂）。
  // 机会命中直算进 cfg 拷贝（2026-09-06 消字段滞后）：原读 cfg.sigridChuqiangHits（上一轮
  // patch 写入）让敛枪式行与估时差一整个轮次演化（≈40s lance）→ 折叠 `+=` 风卷虚增账本。
  const { rotation, pozhenSets, cinema, axisActive } = sigridLanceCounts(cfg, state)

  const atk = Math.max(0, Number(record.sigridAtk ?? 0))
  // 溢出覆盖率缺省 0：引擎按「机会 100% 立刻打光」建模（实测 spend 42 / 收入 42.7，储存位常年为空），
  // 而原文的触发条件是「机会**溢出时**」——储存上限 1 且从不积压 ⇒ 永不溢出 ⇒ 不计算。
  // 代码没有逐事件溢出判定（段数状态机未建模），要模拟「攒着不打导致溢出」才调高此滑块。
  const overflowCov = clamp01(cfgSetting(cfg, 'sigrid.c1OverflowCoverage', 0))

  // 出枪式（凛冽枪尖 #1-4）行级物化（用户口径 2026-09-03）：真实分段行 + 真实时间——
  // 平A汇总行只保留时间载体（patchSigridExecutions 归零伤害/失衡/积蓄），伤害由分段行承载；
  // 压枪开 = 只打 #3/#4（1.765s/循环），关 = 打 #1-#4（2.983s/循环）。
  const basicCycle = (record.sigridBasicCycle as { moveId: string; actionTime: number }[] | undefined) ?? []
  let segTime = 0
  if (basicCycle.length > 0) {
    const pressCancel = cfgSetting(cfg, 'sigrid.pressCancel', 0) >= 0.5
    const segCounts = countBasicSegments(Math.max(0, Number((state as any).basicAttackTime ?? 0)), basicCycle, pressCancel)
    for (const seg of basicCycle) {
      const n = segCounts[seg.moveId] ?? 0
      if (n <= 0) continue
      segTime += n * seg.actionTime
      executions.push({
        moveId: seg.moveId,
        moveName: `普通攻击：凛冽枪尖 #${seg.moveId.slice(-1)}`,
        category: 'basic',
        element: 'ice',
        count: n,
        actionTime: seg.actionTime,
        comboAlignRatio: 0,
        totalTime: n * seg.actionTime,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0,
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
      })
    }
    // ===== 出枪式段不再重复占用平A池（2026-09-05，朱鸢同款修复）=====
    // 分段行由 `countBasicSegments(basicAttackTime, …)` 推出 ⇒ 它们占的**就是平A池那份时间**。
    // 伤害侧早已防双算（patchSigridExecutions 把聚合行 damage/daze/anomaly 归零），但时间侧
    // 漏了：聚合行 totalTime 仍 = basicAttackTime，与分段行相加变成两份（实测 1591/1481/1311
    // 池 8.68s 被计成 8.68 + 7.63）→ 折叠把虚增折进 necessaryTime → 平A池被挤 → 该队留白 20.6s。
    // 只缩**时间**、保留**回能**：平A回能源于整段平A时长，而分段行不带回能（energyRecovery: 0），
    // 按比例一起缩会凭空丢掉她的能量。
    if (segTime > 0) {
      const basicIdx = executions.findIndex(e => e.moveId === 'basic_attack')
      if (basicIdx >= 0) {
        const basicTime = executions[basicIdx].totalTime ?? 0
        executions[basicIdx] = {
          ...executions[basicIdx],
          totalTime: Math.max(0, basicTime - Math.min(basicTime, segTime)),
        }
      }
    }
  }

  for (let i = 0; i < 3; i++) {
    const count = rotation[i] + pozhenSets
    if (count <= 0) continue
    const meta = segments[i]
    // 影画6：各段最后一击附加 80/90/100% 攻击力（精确分段，进基础区 flatDamageBonus）
    let flat = cinema >= 6 && atk > 0 ? atk * SIGRID_C6_LAST_HIT_RATIOS[i] / 100 : 0
    // 影画1：机会溢出时下一次敛枪式的最后一击（= 第三段）额外 +100% × 溢出覆盖率（默认 0，见上）
    if (i === 2 && cinema >= 1 && overflowCov > 0 && atk > 0) {
      flat += atk * CINEMA1_OVERFLOW_RATIO * overflowCov / 100
    }
    // 影画6 破阵「更快发动」：破阵那部分套数时长 ×0.75，轮转部分照常（估时同式，见 sigridLanceCounts）
    const rowTime = (rotation[i] + pozhenSets * sigridPozhenTimeFactor(cinema, axisActive)) * meta.actionTime
    executions.push({
      moveId: meta.moveId,
      moveName: `普通攻击：敛枪式 ${['一', '二', '三'][i]}段`,
      category: 'basic',
      element: 'ice',
      count,
      // [砥砺]（连携技发动时获得，持续50s）：后续敛枪式伤害 +20%，默认全覆盖（用户口径）
      dmgBonus: SIGRID_DILI_DMG,
      actionTime: meta.actionTime,
      comboAlignRatio: 0,
      // 时间记真实时长（轮转 count × actionTime + 破阵套数 × actionTime × 影画6折扣）：敛枪式是
      // 前台真实动作，t=0 会显示「无时间」。
      // 收敛性（2026-09-03 论证，取代 2026-02「正反馈发散 3200 亿秒」旧注释）：
      // 机会来源 = 出枪式命中数 = f(basicAttackTime)（patchSigridExecutions），
      // 敛枪式时间计入必要时间 → 平A池压缩 → 出枪式命中/机会减少 → 敛枪式减少 → 负反馈收敛；
      // 影画1 的「第三段送机会」自指增益比 1/3（每轮只多打 1/3 轮第三段），定点迭代收敛；
      // 折叠循环沿「±1s 量化残差」口径（resource.ts）收敛，无发散路径。
      totalTime: rowTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: meta.decibelRecovery,
      totalDecibelRecovery: count * meta.decibelRecovery,
      energyRecovery: meta.energyRecovery,
      totalEnergyRecovery: count * meta.energyRecovery,
      ...(flat > 0 ? { flatDamageBonus: flat } : {}),
    })
  }
}

/**
 * 机会来源（出枪式命中合计）从 state 直算——与 patchSigridExecutions 的行计数同口径：
 * Σ出枪式招式次数（强特/连携/终结/闪反/支援突击）+ 凛冽枪尖#4 按段循环计数。
 * **一次命中只给一次机会**（原文「任意[出枪式]命中…获得1次机会」）：#4 既在 SIGRID_CHUQIANG_MOVE_IDS
 * 里被行循环数到、又被 countBasicFinisherHits 数一次 = 双计（2026-09-06 曾以「hit→cast 不是 1:1」
 * 为由保留）。**用户改判（2026-09-07）：双计不合理——原文只说回复一次，不能算两次命中，删除。**
 * 实测（1591+1211 推荐配装、丽娜平A权重 0）：敛枪式 49 → 47 次、她 2561万 → 2463万（−3.8%）、
 * 机会收入 44.7——**不是**简单砍掉 1/3：少打几发敛枪式让平A池从 28.3s 回涨到 43.9s，真实 #4
 * 命中随之变多，把砍掉的双计补回了一部分。队友丽娜前台恒定 35.3s 不受影响（敛枪式吃的是她
 * 自己的平A池，不抢队友）。buildExecutions/estimateExSpecialTime 共用本函数，估时与物化才不分裂。
 */
// @fact agent:1591/敛枪式估时 口径: 敛枪式三段行时间（机会 spend + 破阵套数 × 真实 actionTime）由 estimateExSpecialTime 计入必要时间——机会命中从 state 直算（与 patch 行计数同口径），估时与 buildExecutions 共用同一 spec 资源账本，不再经 cfgField 轮间滞后（滞后让估时与行差一轮演化 ≈40s lance，折叠积分器风卷成账本虚高）；出枪式段占平A池时间不进必要时间 | 据 实测@2026-09-06 + 用户@2026-09-07 + 青衣 1571 前例·复核@2026-09-08 | 验 src/mechanics/__tests__/sigrid.test.ts#估时钩子 | 锚 src/mechanics/agents/sigrid.ts#sigridExSpecialTime | 信 高
// @fact agent:1591/出枪式机会计数 口径: 一次[出枪式]命中只记 1 次机会——#4 双计（段行 + countBasicFinisherHits 各数一次）已删；行循环跳过 SIGRID_BASIC_SEGMENT_MOVE_IDS，#4 只由 countBasicFinisherHits 按段循环计数 | 据 用户@2026-09-07（「他说了只回复一次，为什么要打两次」）·复核@2026-09-08| 验 src/mechanics/__tests__/sigrid.test.ts#一次出枪式命中只记一次机会 | 锚 src/mechanics/agents/sigrid.ts#sigridChuqiangFromState | 信 确认
export function sigridChuqiangFromState(
  state: { exSpecialCount: number; ultimateCount: number; chainCountTotal: number; basicAttackTime: number },
  cfg: AgentCharConfigInput['cfg'],
): number {
  const record = cfg as unknown as Record<string, unknown>
  const basicCycle = (record.sigridBasicCycle as { moveId: string; actionTime: number }[] | undefined) ?? []
  const pressCancel = clamp01(cfgSetting(cfg, 'sigrid.pressCancel', 0)) > 0
  const finisherHits = countBasicFinisherHits(Math.max(0, state.basicAttackTime ?? 0), basicCycle, pressCancel)
  return Math.max(0, state.exSpecialCount ?? 0) // 碎玉（出枪式）
    + Math.max(0, state.ultimateCount ?? 0) // 霜天
    + Math.max(0, state.chainCountTotal ?? 0) // 冰凌卷地
    + Math.max(0, cfg.dodgeCounterCount ?? 0) // 回马枪
    + Math.max(0, cfg.parryCount ?? 0) // 支援突击：冰饕
    + finisherHits // 凛冽枪尖#4：按段循环计数，一次命中记一次
}

/**
 * 影画6 破阵「更快发动」：破阵段内敛枪式三段时长 ×0.75。
 * 原文只说「在[破阵]状态下，希格莉德会更快地发动[普通攻击：敛枪式]」，未给数值；
 * ×0.75 是用户 2026-02 第二轮口径（spec notes ③）。**2026-02 起只写在注释/spec notes 里、
 * 代码零实现 = 规则16① 点名的死口径，2026-09-07 落地为活代码。**
 */
// @fact agent:1591/影画6破阵提速 口径: 影画6「破阵状态下更快发动敛枪式」= **破阵套数**那段时长 ×0.75（轮转部分原价）；轴模式不打折（破阵块时间由轴引擎按窗口计账，再折=双算）| 据 用户@2026-02第二轮（spec notes ③）+ 用户@2026-09-07「6命必须实现」·复核@2026-09-08| 验 src/mechanics/__tests__/sigrid.test.ts#影画6 破阵「更快发动」| 锚 src/mechanics/agents/sigrid.ts#sigridPozhenTimeFactor | 信 确认
export const SIGRID_C6_POZHEN_TIME_FACTOR = 0.75

/**
 * 敛枪式套数求解器（**估时与物化唯一共用入口**）：机会 spend 走 spec 资源账本（机会命中由
 * `sigridChuqiangFromState` 从 state 直算，无 cfgField 轮间滞后），破阵套数走 `sigridPozhenSets`。
 * 两处各自实现过一遍、口径漂移过一次（2026-09-06 的估时钩子就是为补分裂而加），故收成一个函数。
 *
 * **影画1 自指反馈（2026-09-07 补）**：原文「发动[敛枪式]**第三段时**，获得[巡空枪势]和**一次**
 * 发动[敛枪式]的机会」——每发第三段再送 1 次机会。第三段次数 ← 机会 ← 第三段次数 是自指方程，
 * 用定点迭代解（增益比 = 1/3，每轮只多打 1/3 轮的第三段 ⇒ 收敛到 O ≈ 1.5×(基础命中 + 破阵套数)，
 * **不是** 2026-02 那次「1次/秒×前台时间」的发散路径）。
 */
// @fact agent:1591/影画1第三段送机会 口径: 影画1「**发动[敛枪式]第三段时**，获得[巡空枪势]和一次发动[敛枪式]的机会」= 每发第三段（含破阵那部分）再送 1 次机会；第三段次数 ← 机会 ← 第三段次数 是自指方程，用**定点迭代**解（≤8 轮，增益比 1/3 ⇒ 收敛到 O ≈ 1.5×(基础命中+破阵套数)），不是 2026-02 那次「1次/秒×前台时间」的发散路径 | 据 用户@2026-09-07「1命第三段敛枪式的机会获取需要实现」·复核@2026-09-08| 验 src/mechanics/__tests__/sigrid.test.ts#影画1「发动第三段时获得巡空枪势和一次机会」| 锚 src/mechanics/agents/sigrid.ts#sigridLanceCounts | 信 确认
function sigridLanceCounts(
  cfg: AgentCharConfigInput['cfg'],
  state: AgentResourceInput['state'] | undefined,
): { rotation: [number, number, number]; pozhenSets: number; cinema: number; axisActive: boolean } {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.sigridCinemaLevel ?? 0)))
  const axisActive = record.sigridAxisActive === true
  const pozhenSets = sigridPozhenSets(cfg, record)
  /** 用给定机会收入解一次 spec 账本 → 轮转总次数 */
  const solveSpend = (income: number): number => {
    const spec = getAgentSpec(SIGRID_AGENT_ID)
    if (!spec || !state) return 0
    const detCfg = { ...cfg, sigridChuqiangHits: income } as AgentCharConfigInput['cfg']
    for (const [, entry] of computeSpecResources(spec, detCfg, state)) {
      const spendCounts = (entry as { spendCounts?: Record<string, number> })?.spendCounts
      if (spendCounts?.sigrid_lance_spend != null) {
        return Math.max(0, Math.floor(Number(spendCounts.sigrid_lance_spend)))
      }
    }
    return 0
  }
  const baseHits = state ? sigridChuqiangFromState(state, cfg) : 0
  let income = baseHits
  if (cinema >= 1 && state) {
    // 定点迭代：income = 基础命中 + (轮转第三段 + 破阵套数)。增益 1/3 ⇒ ≤8 轮即稳定。
    for (let i = 0; i < 8; i++) {
      const third = splitLanceRotation(solveSpend(income))[2] + pozhenSets
      const next = baseHits + third
      if (next === income) break
      income = next
    }
  }
  return { rotation: splitLanceRotation(solveSpend(income)), pozhenSets, cinema, axisActive }
}

/**
 * 破阵段时长折扣因子（估时与物化共用）：影画6 且**非轴模式**才打折——轴模式的破阵块由轴引擎
 * 按窗口时间轴计账，这里再折一次会把同一份节省算两遍。
 */
function sigridPozhenTimeFactor(cinema: number, axisActive: boolean): number {
  return cinema >= 6 && !axisActive ? SIGRID_C6_POZHEN_TIME_FACTOR : 1
}

/**
 * 必做前台时间估计（2026-09-06 补，青衣 1571 同款）：通用公式「次数×单段」只计碎玉，
 * 敛枪式三段行（真实时长 count × actionTime，队内最高 ~58s）此前全靠折叠循环 `+=` 残差
 * 兜底——积分器 windup 是 1591 系「行超账本 +1.08s / 留白 9s / 部分队 cycle」的来源。
 * 这里与 buildSigridExecutions 共用 `sigridLanceCounts` 同一求解器（松弛期同为实数）。
 * 出枪式段（凛冽枪尖 #1-4）占的是平A池时间、不进必要时间。
 */
function sigridExSpecialTime({ cfg, exSpecialCount, state }: AgentExSpecialTimeInput): { necessaryTime: number; comboAlignTime: number } {
  const record = cfg as unknown as Record<string, unknown>
  const segments = (record.sigridLanceSegments as
    | { moveId: string; actionTime: number }[]
    | undefined) ?? []
  const exTime = Math.max(0, exSpecialCount) * (cfg.exSpecialActionTime ?? 0)
  if (segments.length !== 3) return { necessaryTime: exTime, comboAlignTime: exTime * (cfg.exSpecialComboAlignRatio ?? 0) }

  const { rotation, pozhenSets, cinema, axisActive } = sigridLanceCounts(cfg, state)
  // 与 buildSigridExecutions 的 rowTime **同一加权式**（影画6 破阵段 ×0.75），否则估时与物化分裂
  const factor = sigridPozhenTimeFactor(cinema, axisActive)
  let lanceTime = 0
  for (let i = 0; i < 3; i++) {
    lanceTime += (rotation[i] + pozhenSets * factor) * (segments[i]?.actionTime ?? 0)
  }
  return {
    necessaryTime: exTime + lanceTime,
    comboAlignTime: exTime * (cfg.exSpecialComboAlignRatio ?? 0),
  }
}

function patchSigridExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).sigridCinemaLevel ?? 0)))
  // 机会来源（原文：任意[出枪式]命中获得1次机会）：统计出枪式招式次数 + 凛冽枪尖#4 近似，
  // 写 cfg 供下一轮 spec 资源账本读取（cfgField sigridChuqiangHits，轮间收敛）
  const segmentRowIds = new Set<string>(SIGRID_BASIC_SEGMENT_MOVE_IDS)
  let chuqiangHits = 0
  for (const exec of executions) {
    // 跳过平A按段物化的行：它们由 basicAttackTime 推出、不是独立招式。#4（1591005）∈ 出枪式，
    // 若这里数一次、下面 countBasicFinisherHits 再数一次 = 双计（用户改判 2026-09-07 删除）。
    if (exec.moveId && segmentRowIds.has(exec.moveId)) continue
    if (exec.moveId && SIGRID_CHUQIANG_MOVE_IDS.has(exec.moveId)) {
      chuqiangHits += Math.max(0, exec.count ?? 0)
    }
  }
  // #4 命中：按段循环计数（用户口径 2026-02），压枪开关取消 a1/a2 → 循环 1.765s
  const record = cfg as unknown as Record<string, unknown>
  const basicCycle = (record.sigridBasicCycle as { moveId: string; actionTime: number }[] | undefined) ?? []
  const pressCancel = clamp01(cfgSetting(cfg, 'sigrid.pressCancel', 0)) > 0
  chuqiangHits += countBasicFinisherHits(Math.max(0, (state as any)?.basicAttackTime ?? 0), basicCycle, pressCancel)
  ;(cfg as unknown as Record<string, unknown>).sigridChuqiangHits = chuqiangHits

  for (const exec of executions) {
    if (!exec.moveId) continue
    // 平A汇总行降级为时间载体：出枪式（凛冽枪尖 #1-4）已行级物化（buildSigridExecutions），
    // 基准段秒均聚合不再叠加伤害（防双重记账；时间与回能行为保留）
    if (exec.moveId === 'basic_attack') {
      exec.damageMultiplier = 0
      exec.damageMultiplierOverride = true
      exec.dazeMultiplier = 0
      exec.dazeMultiplierOverride = true
      exec.anomalyBuildUp = 0
      continue
    }
    // 影画2：出枪式 + 敛枪式三段 穿透率 +24%（moveId 限定，用户口径）
    if (cinema >= 2 && (SIGRID_CHUQIANG_MOVE_IDS.has(exec.moveId) || SIGRID_LANCE_SEGMENT_IDS.includes(exec.moveId))) {
      exec.penRatioBonus = (exec.penRatioBonus ?? 0) + CINEMA2_PEN_RATIO
    }
  }
}

const settings: MechanicSetting[] = [
  {
    id: 'sigrid.pressCancel',
    label: '希格莉德压枪',
    description: '压枪技巧：取消凛冽枪尖 a1/a2，平A循环变为 a3→a4（2.983s → 1.765s），同样平A时间下 #4 出枪式命中更多 → 敛枪式机会更多。1=开 0=关。',
    default: 0,
    min: 0,
    max: 1,
    step: 1,
    suffix: '',
  },
  {
    id: 'sigrid.corePassiveCoverage',
    label: '希格莉德巡空枪势覆盖率',
    description: '核心被动：巡空枪势状态下暴击率+66%、命中失衡敌人失衡易伤+20% 的时间覆盖率，默认 100%（出枪式命中即刷新，近似常驻）。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'sigrid.cinema4Coverage',
    label: '希格莉德影画4覆盖率',
    description: '影画4·英雄养成中：每次获得巡空枪势伤害+18%（8秒，上限40秒）的覆盖率，默认 100%。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'sigrid.c1OverflowCoverage',
    label: '希格莉德影画1机会溢出覆盖率',
    description: '影画1·很久很久以前：敛枪式发动机会**溢出时**，下一次敛枪式最后一击额外+100%攻击力。机会上限 1 次，而引擎按「每次机会立刻打光」建模 ⇒ 储存位不积压 ⇒ 不溢出 ⇒ 默认 0（不计算）。只有想模拟「攒着不打导致溢出」才调高。',
    default: 0,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const sigridMechanic: AgentMechanicModule = {
  id: 'agent:sigrid',
  agentIds: [SIGRID_AGENT_ID],
  name: '希格莉德',
  description: '出枪式/巡空枪势/敛枪式：面板效果 applyPanel（暴击+66%、失衡易伤+20%、额外能力攻击/浸染增伤、影画1/2/4）；敛枪式三段轮转执行行 + 破阵（每次失衡送一套，免费）在 buildExecutions；影画2穿透率+24%（moveId 限定）与影画1/6最后一击附加在 patchExecutions/buildExecutions。',
  applyPanel: applySigridPanel,
  applyTeamConfig: applySigridTeamConfig,
  buildCharConfig: buildSigridCharConfig,
  estimateExSpecialTime: sigridExSpecialTime,
  buildExecutions: buildSigridExecutions,
  patchExecutions: patchSigridExecutions,
  // spec 资源（敛枪式发动机会）与资源卡沿用 spec 解释器
  buildResourceResult: ({ cfg, state }: AgentResourceResultInput) => ({
    specResources: (() => {
      const spec = getAgentSpec(SIGRID_AGENT_ID)
      return spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {}
    })(),
  }),
  resourceSections: (input: AgentResourceSectionsInput) => {
    const spec = getAgentSpec(SIGRID_AGENT_ID)
    return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
  },
  settings,
}
