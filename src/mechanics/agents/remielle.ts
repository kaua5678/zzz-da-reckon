import type {
  AgentCharConfigInput,
  ExtraNecessaryAction,
  AgentMechanicModule,
  AgentPanelInput,
  AgentBackstageRowsInput,
  AgentAnomalyEventRecordsInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamPanelEffectInput,
  ExtraAnomalyRowGroup,
  ExtraAnomalyRowsInput,
  ReadonlyTeam,
  AgentNextRoundFeedbackInput,
  AgentTeamConfigInput,
  ModuleFeedback,
  TeammateBuffGateInput,
} from '../types'
import { EXTRA_ANOMALY_ROW_ORDER } from '../types'
import type { Agent, PanelValues, SkillMove } from '@/types/catalog'
import type { AnomalyEventRecord, CharacterOperationConfig, CharacterResourceResult, SkillExecution } from '@/types/resource'
import { countFrontActions, effectiveBackstageTime, effectiveBattleTime, frontBlockSeconds, phaseDelayedCooldown } from '@/core/effectiveTime'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'
import { fmt, localized } from '@/utils/format'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { LEVEL_MULT_60, defenseMultiplierDetail, resistanceMultiplierDetail } from '@/core/damageMultipliers'
import { calcPanelStunMultiplier, distributeIntegerByWeight } from '@/core/anomalyPool/helpers'
import { enemyResistanceOf, panelElementStat } from '@/utils/elementStatKeys'
import { findMoveById, fusedRowReader } from '@/data/moveTableQueries'
import { channelMetricsOf, type ChannelMoveInfo, type MoveTableLike } from '@/core/resource/moveLookup'
import { specAdditionalAbilityActive } from '@/mechanics/additionalAbilityGates'
import { moduleExecRow } from '@/mechanics/moduleExecRow'
import { cinemaLevelOf } from '@/data/cinemaLevel'

const REMIELLE_AGENT_ID = '1581'
const VOIDFLARE_MAX = 3
const VOIDFLARE_INITIAL = 3
const REFRINGE_COEFFICIENT_PER_AP = 0.02
// @fact agent:1581/耀变倍率提升 口径: 耀变倍率提升=异常精通×0.2%（原文「根据自身异常精通的0.2%提升此伤害倍率」；audit/1581.json 录入快照 + nanoka 3.2.1/3.2.3/3.3.0 + 账本蕾米埃尔.xlsx Q10=1+精通×0.2% + catalog corePassive 公式 x*0.2 四源一致）。旧值 0.1 为录入转写错误：伤害管线一直走 catalog 公式（0.2 正确），本常量只喂资源卡展示，曾致展示口径与引擎相差一半 | 据 原文四源核对@2026-09-07·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30 | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/mechanics/agents/remielle.ts#LUMINIZE_MULTIPLIER_PER_AP | 信 确认
const LUMINIZE_MULTIPLIER_PER_AP = 0.2

export function computeRemielleMechanic(input: {
  anomalyProficiency: number
  splitRounds?: number
}): RemielleMechanicSource {
  const ap = Math.max(0, input.anomalyProficiency)
  return {
    voidflareStored: VOIDFLARE_INITIAL,
    voidflareMax: VOIDFLARE_MAX,
    refringeCoefficient: ap * REFRINGE_COEFFICIENT_PER_AP,
    luminizeMultiplierBonus: ap * LUMINIZE_MULTIPLIER_PER_AP,
    splitRounds: Math.max(0, Math.floor(input.splitRounds ?? 0)),
    note: '虚曜：最多储存3个，队友触发异常反应生成；花羽轮舞/缭乱终幕/垂虹/惊鸿命中后触发耀变，按储存异常效果强度结算招式对应倍率；异化系数=异常精通×0.02%，耀变倍率提升=异常精通×0.2%。耀变次数由异常池按队友异常触发自动结算，不由用户直接调整。',
  }
}

function buildRemielleResourceResult({ cfg }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    remielleMechanicSource: computeRemielleMechanic({
      anomalyProficiency: cfg.panel.anomalyProficiency,
      splitRounds: cfg.panel.remielleSplitRounds ?? 0,

    }),
  }
}

/**
 * 蕾米**飞行轮数**（玩家交流制表口径，用户 2026-10-18：「蕾米队伍中会飞几轮需要额外标注一下，这个是玩家交流的制表之一」）。
 *
 * 一轮 = 攒满 3 个虚曜 → 蕾米出来打「入场（花羽轮舞）→ 有大招放大招（缭乱终幕）→ 最后长按平A（惊鸿）」→
 * 虚曜被长按A 清空 → 回后台继续攒。故轮数 = ⌊虚曜池 / 3⌋（池 = Σ 非本槽的异常触发次数）。
 * 每轮的耀变次数 = 3（入场）+ 3（长按A）+ 3（有大招时）= 6 或 9。
 *
 * 与伤害行同源（`extraAnomalyRows` 用 `cycles` 算载体次数），这里只是把它暴露给资源卡与外部制表。
 */
export function remielleFlightRounds(
  ownSlot: number,
  perSlotAnomalyTriggers: ReadonlyArray<number> | undefined,
): number {
  const pool = [0, 1, 2]
    .filter(slot => slot !== ownSlot)
    .reduce((sum, slot) => sum + Math.max(0, Math.floor(perSlotAnomalyTriggers?.[slot] ?? 0)), 0)
  return Math.floor(pool / REMIELLE_SPECIAL_VOIDFLARE_PER_ROUND)
}

function buildRemielleResourceSections({ result, anomalyPoolResult, teamSettings }: AgentResourceSectionsInput) {
  const source = result.remielleMechanicSource
  if (!source) return []
  // 池 = Σ(队友异常次数 − 该队友丢弃次数)；丢弃后的剩余次数才进分配（与 extraAnomalyRows 同口径）
  const drops: Record<string, number> = {}
  for (const [k, v] of Object.entries(teamSettings ?? {})) {
    const m = /^remielle\.drop:(\d+)$/.exec(k)
    if (m && v > 0) drops[m[1]!] = Math.floor(v)
  }
  const perSlot = [0, 1, 2]
    .filter(slot => slot !== result.slot)
    .map(slot => {
      const total = Math.max(0, Math.floor(anomalyPoolResult?.perSlotAnomalyTriggers[slot] ?? 0))
      const dropped = Math.max(0, Math.min(total, Math.floor(drops[String(slot)] ?? 0)))
      return { slot, total, dropped, kept: total - dropped }
    })
  const pool = perSlot.reduce((sum, x) => sum + x.kept, 0)
  const droppedTotal = perSlot.reduce((sum, x) => sum + x.dropped, 0)
  // 战斗时长 = 前台 + 后台（引擎的 totalTime）；只有资源结果齐全时才知道，缺省按豆子侧判。
  // 飞行段吃的是**后台**时长（相变时流自主行动），她自己的入场/惊鸿是前台、不占这 15s
  const backstageTime = result.timeAllocation.backstageTime
  const beanRounds = remielleFlightRounds(result.slot, anomalyPoolResult?.perSlotAnomalyTriggers)
  const rounds = remielleRoundCount(pool, backstageTime)
  const timeCapped = rounds < beanRounds
  // 拆轮构成（用户 2026-10-18：「调成 1 你就写 6 惊鸿 2 垂鸿」）：拆 1 轮惊鸿 = 2 轮垂虹
  const split = Math.max(0, Math.min(REMIELLE_SPLIT_ROUND_MAX, Math.floor(source.splitRounds)))
  const appliedSplit = Math.min(split, rounds > 0 ? REMIELLE_MAX_FLOWER_FEATHER_ROUNDS : 0)
  const graceRounds = Math.max(0, Math.min(rounds, REMIELLE_MAX_FLOWER_FEATHER_ROUNDS - appliedSplit))
  const rainbowRounds = Math.max(0, Math.min(rounds - graceRounds, appliedSplit * 2))
  return [
    {
      id: 'remielle-voidflare',
      title: '蕾米埃尔虚曜·耀变',
      summary: `飞行 ${rounds} 轮（${graceRounds} 惊鸿 + ${rainbowRounds} 垂虹）· 虚曜池 ${pool}`,
      rows: [
        {
          label: '飞行轮数',
          value: `${rounds} 轮`,
          detail: timeCapped
            ? `豆子够 ${beanRounds} 轮，但后台只有 ${fmt(backstageTime)}s ⇒ 只够飞 ${rounds} 轮（每轮后台飞行 ${fmt(REMIELLE_LUMEN_FLIGHT_SECONDS)}s）`
            : `虚曜池 ${pool} ÷ 3 = ${beanRounds} 轮（后台 ${fmt(backstageTime)}s ÷ ${fmt(REMIELLE_LUMEN_FLIGHT_SECONDS)}s = ${Math.floor(backstageTime / REMIELLE_LUMEN_FLIGHT_SECONDS)} 轮上限，未咬合）`,
        },
        { label: '每轮耀变', value: '6 / 9 次', detail: '入场 3 + 长按A 3（无大招 6 次）；有大招再 +3（9 次）；6 命垂虹/惊鸿耀变次数 ×2' },
        {
          label: '轮次构成',
          value: `${graceRounds} 惊鸿 + ${rainbowRounds} 垂虹`,
          detail: split > 0
            ? `拆轮 ${appliedSplit}：每拆 1 轮惊鸿 ⇒ 少 1 轮惊鸿、多 2 轮垂虹（垂虹也清空 3 豆，故总轮次 +${appliedSplit}）`
            : `拆轮 0（默认）：7 轮全部打惊鸿，多出来的虚曜浪费——普通玩家打法`,
        },
        {
          label: '每轮时长',
          value: `${fmt(REMIELLE_LUMEN_FLIGHT_SECONDS)}s + 入场 + 惊鸿`,
          detail: `浮晖 ${REMIELLE_LUMEN_DRAIN_PER_SECOND}/s 消耗，${REMIELLE_LUMEN_MAX} → ${REMIELLE_LUMEN_FLOWER_FEATHER_THRESHOLD} 需 ${fmt(REMIELLE_LUMEN_FLIGHT_SECONDS)}s 飞行；到阈值退出相变时流，花羽轮舞（≤${REMIELLE_LUMEN_FLOWER_FEATHER_THRESHOLD} 免费，原价 ${REMIELLE_LUMEN_GAIN.flowerFeatherCost} 点）进映曜，惊鸿 +${REMIELLE_LUMEN_GAIN.fleetingGrace} 回满`,
        },
        {
          label: '首轮可能打垂虹',
          value: '耀变 ×½',
          detail: '开局的映曜来自连携技（交叠舞步）；若第一轮只有攒满的 3 豆、没有连携/免费映曜，长按A 只能打垂虹（耀变 160% 而非惊鸿 320%）',
        },
        {
          label: '子弹丢弃',
          value: droppedTotal > 0 ? `${droppedTotal} 次` : '无',
          detail: perSlot.map(x => `${x.slot + 1}号 ${x.dropped}/${x.total}`).join(' · ') + '（丢弃后剩余次数进分配，轮数与归属自动跟着算）',
        },
        { label: '虚曜储存', value: `${source.voidflareStored}/${source.voidflareMax}`, detail: '队友异常反应生成，最多存3个' },
        { label: '异化系数', value: `${fmt(source.refringeCoefficient)}%`, detail: '异常精通 × 0.02%' },
        { label: '耀变倍率提升', value: `${fmt(source.luminizeMultiplierBonus)}%`, detail: '异常精通 × 0.2%' },
      ],
      footer: source.note,
    },
  ]
}

// ============================================================================
// 蕾米埃尔专属异常辅助函数（CC-19c-1 2026-09-26，设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §7.2）：
// 自 `composables/resourceCalc/anomalyPanels.ts` 逐字迁入（算式/常量值/条件/求值顺序零改动）。
// `anomalyPanels.ts` 保留 import + export 壳 ⇒ `helpers.ts` / `useResourceCalc.ts` /
// `damagePoolAnomaly.ts` / 既有测试的 import 路径零改动。依赖只有 `@/core/skillLevel` /
// `@/utils/elementStatKeys`（CC-224 前为 `@/core/elementKeys`）/ `@/utils/format` / `@/types/catalog` 类型。
// ============================================================================
export function getRemielleLevelValue(row: SkillMove['rows'][number] | undefined, skillLevelBonus: number): number {
  if (!row) return 0
  const values = row.values
  if (!values.length) return 0
  const skillLevel = getSkillLevelCoef(skillLevelBonus).skillLevel
  const levelValues = row.levelValues
  if (Array.isArray(levelValues)) {
    const idx = levelValues.indexOf(skillLevel)
    if (idx >= 0) return values[idx] ?? values[0] ?? 0
  }
  if (values.length === 3) {
    return values[skillLevel >= 16 ? 2 : skillLevel >= 14 ? 1 : 0] ?? values[0] ?? 0
  }
  return values[0] ?? 0
}

/** 一命「开局特殊虚耀」每轮个数（状态表 1 命：开局 3 个；1 轮 = 3 个豆 = 打 1 次垂虹） */
export const REMIELLE_SPECIAL_VOIDFLARE_PER_ROUND = 3

// ============================================================================
// 浮晖（Term:1000032）与「一轮」的时长约束（用户 2026-10-18 玩法口径）
//
// 原文：蕾米通过普攻获得浮晖；浮晖达最大值 120 时可进入转换姿态；相变时流状态下浮晖随时间消耗；
// 花羽轮舞「若发动时自身剩余浮晖小于等于 90 点，则本次不再消耗浮晖，并且自身进入映曜状态」，
// 映曜 ⇒ 下一次垂虹升级为惊鸿（耀变 320% vs 垂虹 160%，正好一倍）。
//
// 闭环（用户口述 + 实测段长互相验证）：惊鸿 +120 回满 → 进相变时流 → 2/s 消耗 → 到 90 时退出
// ⇒ 立刻花羽轮舞（≤90 免费，进映曜）→ 惊鸿（+120 回满）→ 再进。
// ⇒ **一轮的物理时长 = 飞行段 15s + 花羽轮舞 + 惊鸿**，与豆子够不够无关；
//    豆子只决定「能不能打满 3 个虚曜」，时长决定「180s 里最多飞几轮」。
// ============================================================================
/** 浮晖上限（原文「最大值 120 点」） */
export const REMIELLE_LUMEN_MAX = 120
/** 花羽轮舞「免费进映曜」的浮晖阈值（原文「小于等于 90 点」） */
export const REMIELLE_LUMEN_FLOWER_FEATHER_THRESHOLD = 90
/**
 * 相变时流期间浮晖消耗速率（点/秒）。
 *
 * @fact agent:1581/浮晖消耗速率 口径: 相变时流期间浮晖按 2 点/秒 消耗（120→90 需 15s，与实战段长中位 15.5s 吻合）；消耗是**纯时间驱动**，自主攻击不额外扣浮晖（段长与攻击数 r=0.895 只是「攻击次数是时间的函数」） | 据 用户@2026-10-18「飞行状态通常15s左右…120自动下降到90需要15s左右，期间有3次攻击」+ 67 段日志反推 | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/mechanics/agents/remielle.ts#REMIELLE_LUMEN_DRAIN_PER_SECOND | 信 确认
 * ⟳复核: 若官方给出明确消耗速率（或相变时流改成固定时长而非资源驱动）⇒ 重核本常量与 `remielleRoundSeconds` | 到期 2027-03-31
 */
/**
 * 惊鸿（长按平A）命中失衡敌人 → **失衡持续时间 +3s**（原文：「招式命中处于失衡状态的敌人时，
 * 敌人的失衡持续时间提升3秒，同一敌人在一次失衡状态下最多受到一次此效果，与同类效果不可叠加」）。
 *
 * ⚠ 2026-10-20 前**完全未实现**：采集侧 `teammate-buffs.json` 的 1581 组里**没有**这条
 * （1511/1551 有、走采集 buff；1581 没有 ⇒ 需模块自己加）。见 `docs/STUN_WINDOW_DURATION.md`。
 * 口径：**满覆盖**——每轮循环都以惊鸿收尾（见本文件「一轮 = 攒满 3 虚曜 → 入场 → 大招 → 惊鸿」）。
 */
export const REMIELLE_GRACE_STUN_DURATION = 3
export const REMIELLE_LUMEN_DRAIN_PER_SECOND = 2
/** 满值飞到「可免费进映曜」阈值所需秒数 = (120 − 90) / 2 = **15s**（= 一轮里的后台飞行段） */
export const REMIELLE_LUMEN_FLIGHT_SECONDS
  = (REMIELLE_LUMEN_MAX - REMIELLE_LUMEN_FLOWER_FEATHER_THRESHOLD) / REMIELLE_LUMEN_DRAIN_PER_SECOND
/**
 * **一场最多打几轮「完整惊鸿」**（用户 2026-10-18）：「通常玩家只能打 7 轮完整惊鸿，更高轮次肯定是把惊鸿轮拆成了
 * 2 次垂鸿轮」。
 *
 * 物理依据：一轮 = 飞行 15s + 花羽轮舞 2.683s + 惊鸿 3.533s ≈ 21.2s ⇒ 180s 里 7 轮 = 148.5s，第 8 轮就要 170s。
 * 超过 7 轮时浮晖循环撑不住（来不及回满再进相变时流）⇒ 长按A 退化为垂虹（耀变 160% / 直伤 390.8%，正好是惊鸿的一半/三分之一）。
 */
/** 默认能打几轮**完整惊鸿**（用户 2026-10-18：「我们默认 7 轮上限」）。 */
export const REMIELLE_MAX_FLOWER_FEATHER_ROUNDS = 7
/**
 * **拆轮**（用户 2026-10-18 逐字）：「如果一个队伍的轮次想达到 8，就要拆一轮惊鸿，如果想达到 9，就要拆 2 轮。
 * 但是垂鸿很少见，普通玩家就正常打 6-7 轮就行，溢出的积蓄也只能浪费。」
 *
 * 机制：一轮完整惊鸿需要后台飞满 15s（120→90）。想多飞一轮，就得有某一波**不到 15s 就换出来**
 * ——那时浮晖还没掉到 90，拿不到映曜 ⇒ 长按A 只能打垂虹（耀变 160% 而非 320%、直伤 390.8% 而非 1194.5%）。
 * 所以「拆 N 轮」= 总轮次 +N，其中 **N 轮由惊鸿降级为垂虹**。
 *
 * 默认 0 = 只打 7 轮完整惊鸿，多余的虚曜**浪费**（这正是普通玩家的打法）。
 */
export const REMIELLE_SPLIT_ROUND_SETTING = 'remielle.splitRounds'
/** 拆轮上限（4 轮：180s 里再多就打不完了） */
export const REMIELLE_SPLIT_ROUND_MAX = 4
/**
 * 浮晖收支表（原文 `skill.basic.description[4..7].param` 与 `skill.assist.description[7].param[3]`）。
 * 只作展示与文档锚点；引擎只用到 `FLOWER_FEATHER_COST` 与上面两个常量（本轮次模型不逐次模拟浮晖）。
 */
export const REMIELLE_LUMEN_GAIN = {
  basic1: 5,
  basic2: 5,
  basic3: 15,
  basic4: 35,
  solo: 30,
  rainbowEnd: 120,
  fleetingGrace: 120,
  flowerFeatherCost: 40,
} as const

/**
 * **一轮能飞几次 = min(豆子够打几轮, 后台够飞几段)**。
 *
 * - 豆子侧：虚曜池 ÷ 3（每轮惊鸿清空 3 个）；
 * - 时间侧：**后台时间 ÷ 15s**。飞行段吃的是她**在后台**的时长（相变时流自主行动），
 *   她自己的入场/惊鸿是前台，不占这 15s。
 *
 * 用户口径（2026-10-18 逐字）：「他的前台变成 60s，后台不足 120s，不足 8 次 15s……
 * 如果想提高轮次，那肯定有些波次是 15s 以内就打出来的，这时候还没掉到 90，导致打不了惊鸿，
 * 只能打垂鸿。所以这里需要做一个计算，我们默认 7 轮上限，如果一个队伍的轮次想达到 8，就要拆一轮惊鸿，
 * 如果想达到 9，就要拆 2 轮。」
 *
 * ⇒ 本函数只算**总轮次**（豆子 ∩ 后台飞行段）；「前 7 轮惊鸿、超出部分垂虹」由
 *   `REMIELLE_MAX_FLOWER_FEATHER_ROUNDS` 在载体侧拆（`extraNecessaryAction` / `extraAnomalyRows`）。
 */
export function remielleRoundCount(voidflareTotal: number, backstageTime: number): number {
  const beanRounds = Math.floor(Math.max(0, voidflareTotal) / REMIELLE_SPECIAL_VOIDFLARE_PER_ROUND)
  // 后台时长缺省/为 0（无资源结果的外部直调）⇒ 只按豆子判，不引入时间上限
  if (!(backstageTime > 0)) return beanRounds
  const flightRounds = Math.floor(backstageTime / REMIELLE_LUMEN_FLIGHT_SECONDS)
  return Math.max(0, Math.min(beanRounds, flightRounds))
}

/**
 * 特殊虚耀载体「普通攻击：垂虹」施放次数（用户裁决 2026-09-30）：每次垂虹清空全部 3 个特殊虚曜点（1 轮 = 3 个豆 = 打 1 次垂虹）。
 * - `remielleCinema1SpecialVoidflareCount` = **轮次**（catalog buff 描述「特殊虚耀触发轮次」，值 1 = 打 1 次垂虹）；
 * - `remielleCinema4SpecialVoidflareRefillCount` = **个数**（「补充3个特殊虚曜点」，值 3 = 1 轮 = 再打 1 次垂虹）；
 * - 垂虹次数 = 1 命轮次 + 4 命补充轮次 = 1（C1~C3）/ 2（C4~C6）。
 */
export function remielleSpecialVoidflareRainbowCount(panel: PanelValues): number {
  const firstRound = panel.remielleCinema1SpecialVoidflareCount
  if (firstRound <= 0) return 0
  const refill = Math.max(0, panel.remielleCinema4SpecialVoidflareRefillCount)
  return firstRound + Math.floor(refill / REMIELLE_SPECIAL_VOIDFLARE_PER_ROUND)
}

/**
 * 特殊虚耀**耀变次数**（用户裁决 2026-09-30）：特殊虚耀点数不翻倍，C6 的 12 次耀变 = 2 次垂虹 × 6 耀变/次。
 * @fact agent:1581/特殊虚耀垂虹次数 口径: 特殊虚耀点数不翻倍，C6 的 12 次耀变 = 2 次垂虹 × (3 豆/次 × 2 倍耀变)；1 命 1 次垂虹 3 耀变 / 4 命 2 次垂虹 6 耀变 / 6 命 2 次垂虹 12 耀变；6命耀变翻倍字段 = remielleCinema6FleetingGraceVoidflareTriggerMultiplier（用户裁决 2026-09-30：①=③同一效果，LuminizeTriggerMultiplier 为记录错误已删） | 据 用户裁决@2026-09-30 | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/mechanics/agents/remielle.ts#remielleSpecialVoidflareCount | 信 确认
 * ⟳复核: 若官方实装后特殊虚耀机制变更（如点数真的翻倍、或垂虹次数与耀变次数解耦）→ 重核本口径 | 到期 2026-12-31
 */
export function remielleSpecialVoidflareCount(panel: PanelValues): number {
  const rainbowCount = remielleSpecialVoidflareRainbowCount(panel)
  if (rainbowCount <= 0) return 0
  // 每次垂虹耀变数 = 3 豆 × (1 + 6 命耀变翻倍)——①=③同一效果，用 FleetingGrace 字段（用户裁决 2026-09-30）
  const luminizeMultiplier = remielleFleetingGraceMultiplier(panel)
  return rainbowCount * REMIELLE_SPECIAL_VOIDFLARE_PER_ROUND * luminizeMultiplier
}

/**
 * 「普通攻击：垂虹/惊鸿」耀变触发倍率 = 1 + 六命加成（用户裁决 2026-09-30：①=③同一效果，原文「耀变触发2次」=「关联虚耀触发次数翻倍」）。
 * 读 FleetingGrace 字段；LuminizeTriggerMultiplier 为记录错误已删（CC-166）。
 */
export function remielleFleetingGraceMultiplier(panel: PanelValues): number {
  return 1 + Math.max(0, panel.remielleCinema6FleetingGraceVoidflareTriggerMultiplier)
}

export interface VoidflareDamageInput {
  sourcePanel: PanelValues
  remiellePanel: PanelValues
  multiplier: number
  element: string
  enemyDefense: number
  enemyResistances: Record<string, number>
  stunMultiplier: number
  /** 是否失衡或失衡易伤覆盖率（0-1） */
  stunned: boolean | number
  cinema1ResIgnore: number
}

export function calcVoidflareDamage(input: VoidflareDamageInput): { damage: number; formula: string } {
  const { sourcePanel: source, remiellePanel: remielle, multiplier, element, enemyDefense, enemyResistances, stunMultiplier, stunned, cinema1ResIgnore } = input

  const baseDmg = source.atk * (multiplier / 100)
  const elementDmg = panelElementStat(source, 'dmg', element)
  const dmgMult = 1 + (source.dmgBonus + elementDmg) / 100
  const profMult = source.anomalyProficiency / 100

  const remielleDefReduction = remielle.enemyDefReduction
    + remielle.enemyAnomalyDefReduction
    + panelElementStat(remielle, 'enemyDef', element)
  // 防御 / 抗性乘区与等级系数：单一来源 core/damageMultipliers（CC-219，原手写同式）
  const { multiplier: defMult } = defenseMultiplierDetail(
    enemyDefense, remielleDefReduction, remielle.enemyDefFlatReduction, source.penRatio, source.penFlat,
  )
  const levelMult = LEVEL_MULT_60
  const mass = baseDmg * dmgMult * profMult * defMult * levelMult

  const baseRes = enemyResistanceOf(enemyResistances, element)
  const sourceResReduction = source.enemyResReduction
    + panelElementStat(source, 'enemyRes', element)
    + cinema1ResIgnore
  const resMult = resistanceMultiplierDetail(baseRes, sourceResReduction).multiplier

  const anomalyDmgMult = 1 + remielle.anomalyDmgBonus / 100
  const passiveLuminizeMult = 1 + remielle.remielleLuminizeMultiplierBonus / 100
  const cinema4LuminizeMult = 1 + remielle.remielleCinema4LuminizeMultiplierBonus / 100
  const luminizeMult = passiveLuminizeMult * cinema4LuminizeMult
  const refringeMult = 1 + (remielle.remielleRefringeCoefficient + remielle.remielleRefringeCoefficientBonusPct) / 100

  const dmgTakenMult = 1 + remielle.enemyDamageTakenBonus / 100
  // 失衡易伤区：单一来源 core calcStunMultiplier（CC-220），面板入口 calcPanelStunMultiplier（CC-489）。
  // 此前手写 `stunned ? 满乘区 : 1`，把覆盖率（0-1 小数）当布尔用 ⇒ 覆盖率 > 0 即吃满额易伤；且非失衡时漏掉 Always 通道。
  const stunMult = calcPanelStunMultiplier(remielle, stunMultiplier, stunned)

  const damage = mass * resMult * anomalyDmgMult * luminizeMult * refringeMult * stunMult * dmgTakenMult
  const formula = `基础 ${fmt(source.atk)}×${fmt(multiplier)}% × 增伤(1+${fmt(source.dmgBonus + elementDmg)}%) × 精通(${fmt(source.anomalyProficiency)}/100) × 防御(${fmt(defMult, 4)}) × 等级(${levelMult}) × 抗性(${fmt(resMult, 4)}) × 异化(${fmt(refringeMult, 4)}) × 异常增伤(1+${fmt(remielle.anomalyDmgBonus)}%) × 耀变被动(${fmt(passiveLuminizeMult, 4)}) × 4命(${fmt(cinema4LuminizeMult, 4)}) × 失衡(${fmt(stunMult, 4)}) × 易伤(${fmt(dmgTakenMult, 4)})`

  return { damage, formula }
}

/**
 * 本槽角色是不是蕾米埃尔（**角色身份判定的单一事实源**，规则 11）。
 *
 * 原先这条判据在编排层重复 4 次（`helpers.ts` 的 `:756` 面板块 / `:798` 相变时流块 /
 * `:996` 风染挑槽 / `:1661` cfg 构建），2026-09-17 round 21 夜间批 C 收进本模块：
 * **调用点不再出现身份字面量**。CC-276：别名臂（`teammateBuffId === 'remielle'`）随别名字段退役删除，只认 `id`。
 */
export function isRemielleAgent(agent: { id?: string } | null | undefined): boolean {
  return agent?.id === REMIELLE_AGENT_ID
}

/** 蕾米埃尔的**额外能力三档转攻**：队友中存在 [异常] 或同阵营角色时按异常角色数取 1/2/3 档。
 *
 * `active` 门控与档位封顶逐位照搬原 `helpers.ts#resolveRemielleDazeBonus`（原实现读
 * `buildMechanicTeamMembers` + `agent.faction`，本模块从钩子入参拿同一份 `team` 与 `agent`）。
 * 空槽（`agent` 为 null）不参与计数，也不与本人同槽比较 —— 与原实现的 `member.slot === slot` 等价。
 *
 * ⚠ **anomalyCount 含本人**（2026-09-30 用户裁决）：原文「队伍中有 N 名异常角色」含蕾米自己——
 * 蕾米+2 异常队友 = 3 异常 ⇒ tier3；不算蕾米则 3 异常不可能由 2 个队友达到。
 * 此前改成「不含本人」是误改，已回滚（R65-J1 行为层实测：atk_1 的「三态逐位相同」是
 * 互斥档位门控的设计行为——非当前档被 `teammateBuffGate` 过滤，不是数值没接）。
 */
function computeRemielleAdditionalState(
  members: ReadonlyArray<{ slot: number; agentId: string; agent: Agent | null }>,
  slot: number,
  agent: Agent | null | undefined,
): { active: boolean; anomalyCount: number; tier: number } {
  const active = specAdditionalAbilityActive(members, slot, agent) // CC-306：spec 1581 `additionalAbility`
  const anomalyCount = members.filter(member => member.agent?.specialty === 'anomaly').length
  const tier = active ? Math.max(1, Math.min(3, anomalyCount)) : 0
  return { active, anomalyCount, tier }
}

function remielleDazeTier(slot: number, agent: Agent, team: ReadonlyTeam): number {
  return computeRemielleAdditionalState(team, slot, agent).tier
}

/** 额外能力三档 → 失衡提升%（0 / 6 / 12 / 35）。 */
function remielleDazeBonusPct(slot: number, agent: Agent, team: ReadonlyTeam): number {
  return [0, 6, 12, 35][remielleDazeTier(slot, agent, team)] ?? 0
}

/**
 * 蕾米埃尔自己的面板块（2026-09-17 round 21 夜间批 C 自 `helpers.ts#computePanelPhases` 迁入）。
 *
 * 语义逐位保留：**只写自己那槽**，两个出口——
 * ① `panel.remielleRadiantTurnDazeBonusPct`（Radiant Turn 行失衡倍率，消费端 = 本模块 `skillDazeMultiplier`
 *    能力，由 `helpers.ts#extractSkillExecutions` 派发；CC-34c② 前是 helpers 里的 `'1581010'` 内联分支）；
 * ② `cfg.remielleRadiantTurnDazeBonusPct` 由下方 `buildCharConfig` 写（原 `:1661` 的双出口）。
 *
 * ⚠ **同一字段原先有两个写者**（`helpers.ts:757` 面板阶段 + `:1666` cfg 构建阶段各算一遍，
 * 当前值相同故幂等）。本批让**唯一写者 = 本模块**：面板阶段写 ①，cfg 阶段写 ②，
 * 两处都读同一个 `remielleDazeBonusPct` 算式 ⇒ 「字段存在即蕴含是本角色」（判据同 T6）。
 *
 * ⚠ 这是**同槽自面板块**（不触 P2 跨槽陷阱）：`applyPanel` 每个槽都会算到自己，蕾米的
 * `applyPanel` 只在蕾米那槽被派发 —— 与迁移前 `if (agent.id === '1581' …)` 的守卫同义。
 */
function applyRemiellePanel({ slot, agent, team, panel, settings }: AgentPanelInput): void {
  if (!isRemielleAgent(agent)) return
  panel.remielleRadiantTurnDazeBonusPct = remielleDazeBonusPct(slot, agent, team)
  // 拆轮数（用户 2026-10-18）：默认 0 = 只打 7 轮完整惊鸿，多余虚曜浪费
  panel.remielleSplitRounds = Math.max(0, Math.min(
    REMIELLE_SPLIT_ROUND_MAX,
    Math.floor(settings[REMIELLE_SPLIT_ROUND_SETTING] ?? 0),
  ))
  // 丢弃设置（`remielle.drop:<slot>`）：蕾米自己的 applyPanel 读全队三条，写进**自己的**面板
  // （资源卡与 extraAnomalyRows 都从 cfg.panel 读；队友面板不承载这个量）。
  const drops: Record<string, number> = {}
  for (let s = 0; s < 3; s++) {
    const v = Math.max(0, Math.floor(settings[`${REMIELLE_DROP.settingPrefix}:${s}`] ?? REMIELLE_DROP.default))
    if (v > 0) drops[String(s)] = v
  }
  panel.remielleTeammateDrops = drops
  // 惊鸿命中失衡敌人 → 失衡持续时间 +3s（原文；此前完全未实现，见常量注释）
  panel.stunDurationBonusSeconds = panel.stunDurationBonusSeconds + REMIELLE_GRACE_STUN_DURATION
}

/**
 * 蕾米强特 Radiant Turn 的「**相变时流**」：全队增伤，按蕾米技能等级 12/14/16 对应 18%/21%/24%。
 *
 * 原实现（`helpers.ts:796-804`）在**每个**角色的面板阶段 `findIndex` 找蕾米、读**她**的命座、
 * 给**当前**面板加 `dmgBonus`，且**没有自排除** ⇒ 蕾米本人也吃。本钩子逐位保留这一点。
 *
 * 为什么必须走本钩子而不是 `applyPanel`（`AgentTeamPanelEffectInput` 头注释的分工表）：
 * 该加成**随目标槽位不同而不同**（每个槽都要查一次「蕾米在不在队」）⇒ 写进蕾米自己的
 * `applyPanel` 只会加到蕾米本人面板（R20-h1 分诊 §2.1 的 P2 陷阱是同一族的**实证**教训）。
 *
 * ⚠ 与「相变时流」并列的还有 `resolveRemielleDazeBonus` 那条（`:756`）——那条是**同槽自面板块**，
 * 留在 `applyRemiellePanel`，**不要**搬到这里，否则双计（`AgentTeamPanelEffectInput` 的
 * 「两个钩子都会跑」纪律）。
 */
function applyRemielleTeamPanelEffects({ slot, cinemaLevel, team, panel }: AgentTeamPanelEffectInput): void {
  // ★ 「相变时流」是**一个光环**，不是「每个蕾米各加一次」：原实现用
  // `configStore.team.findIndex(…)` 找**第一个**蕾米、读**她**的命座、给当前面板加**一次**。
  // 本钩子按**来源槽**逐槽派发 ⇒ 不设守卫时「双蕾米队」会加 N 次。
  // ⚠ **这是逐位等价对拍抓到的真回归**（2026-09-17 本批实测：`[1581,1581,1581]` 队
  // `dmgBonus` 由 **33 → 69**，差值 36 = 2 × 18，即多算两份 0 命蕾米的 `(12+0)×1.5`）。
  // ⇒ 只有「槽位最小的那个蕾米」认领本加成，且用**她自己**的命座（与 `findIndex` 首位语义同）。
  // 契约面不冲突：`AgentTeamPanelEffectInput.team` 就是用来做这种「谁是第一来源」判定的
  // （`AgentTeamPanelEffectInput` 纪律「多个来源写同一字段时结果与顺序有关」在这里被消掉——
  //  只会有唯一一个来源真的写）。
  const firstRemielle = [...team].sort((a, b) => a.slot - b.slot).find(m => isRemielleAgent(m.agent))
  if (!firstRemielle || firstRemielle.slot !== slot) return

  // 原式：`remielleCinema >= 5 ? 4 : remielleCinema >= 3 ? 2 : 0` ⇒ 技能等级 12/14/16
  const cinema = cinemaLevelOf(cinemaLevel)
  const skillLevelBonus = cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0
  panel.dmgBonus = panel.dmgBonus + (12 + skillLevelBonus) * 1.5
}

/** 从倍率表提取蕾米「普通攻击：垂虹」信息（CC-34b 2026-09-27 由 `core/resource/moveLookup.ts` 逐字迁入）（特殊虚耀跟随该动作触发） */
export function findRemielleRainbowEnd(agentSkills: MoveTableLike): ChannelMoveInfo | null {
  const basic = agentSkills.categories.find(c => c.id === 'basic')
  if (!basic) return null

  const move = basic.moves.find(m => {
    const en = (m.name?.en ?? '').toLowerCase()
    const zh = m.name?.zhCN ?? ''
    return m.id === '1581007' || en.includes("rainbow's end") || zh.includes('垂虹')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move, fusedRowReader)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

/**
 * 从倍率表提取蕾米「普通攻击：惊鸿」（长按A 正版，320% 耀变 / 1194.5% 直伤）。
 *
 * 与垂虹（`findRemielleRainbowEnd`，160% / 390.8%）是**同一按键的两个形态**：
 * 有映曜 ⇒ 惊鸿；无映曜 ⇒ 垂虹。倍率差一倍是耀变侧、差三倍是直伤侧。
 */
export function findRemielleFleetingGrace(agentSkills: MoveTableLike): ChannelMoveInfo | null {
  const basic = agentSkills.categories.find(c => c.id === 'basic')
  if (!basic) return null
  const move = basic.moves.find(m => {
    const name = localized(m.name)
    const en = localized(m.name && typeof m.name === 'object' && 'en' in m.name ? m.name.en : '').toLowerCase()
    return m.id === '1581008' || en.includes('fleeting grace') || name.includes('惊鸿')
  })
  if (!move) return null
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move, fusedRowReader)
  return { moveId: move.id, actionTime, decibelRecovery, comboAlignRatio: move.comboAlignRatio ?? 0 }
}

/** 从倍率表提取蕾米「支援技：花羽轮舞」（每轮入场自动发动，直伤 907.8% / 耀变 320%） */
export function findRemielleFlowerFeatherDance(agentSkills: MoveTableLike): ChannelMoveInfo | null {
  const assist = agentSkills.categories.find(c => c.id === 'assist')
  if (!assist) return null
  const move = assist.moves.find(m => {
    const name = localized(m.name)
    const en = localized(m.name && typeof m.name === 'object' && 'en' in m.name ? m.name.en : '').toLowerCase()
    return m.id === '1581015' || en.includes('flower feather') || name.includes('花羽轮舞')
  })
  if (!move) return null
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move, fusedRowReader)
  return { moveId: move.id, actionTime, decibelRecovery, comboAlignRatio: move.comboAlignRatio ?? 0 }
}

/** 从倍率表提取蕾米后台 Radiant Turn 信息 */
export function findRemielleRadiantTurn(agentSkills: MoveTableLike): ChannelMoveInfo | null {
  const special = agentSkills.categories.find(c => c.id === 'special')
  if (!special) return null

  const move = special.moves.find(m => {
    const en = (m.name?.en ?? '').toLowerCase()
    const zh = m.name?.zhCN ?? ''
    return m.id === '1581010' || en.includes('radiant turn') || zh.includes('radiant turn') || zh.includes('曙光回旋')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move, fusedRowReader)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

/** 把「本槽是不是蕾米埃尔」与额外能力档位写进 cfg（原 `helpers.ts:1661-1667` 的 cfg 出口）。 */
function buildRemielleCharConfig({ slot, agent, skills, team, cfg }: AgentCharConfigInput): void {
  if (!isRemielleAgent(agent)) return
  // 垂虹（特殊虚耀载体）与后台 Radiant Turn 的招式参数（CC-34b 2026-09-27 由 `helpers.ts` cfg 字面量迁入；
  // 原先对每个槽都查一遍并写 '' / 0，读取方只有本模块的 extraNecessaryAction / backstageAutoRows）。
  const rainbowEnd = findRemielleRainbowEnd(skills)
  const radiantTurn = findRemielleRadiantTurn(skills)
  cfg.remielleRainbowEndMoveId = rainbowEnd?.moveId ?? ''
  cfg.remielleRainbowEndActionTime = rainbowEnd?.actionTime ?? 0
  cfg.remielleRainbowEndDecibelRecovery = rainbowEnd?.decibelRecovery ?? 0
  cfg.remielleRainbowEndComboAlignRatio = rainbowEnd?.comboAlignRatio ?? 0
  cfg.remielleRadiantTurnMoveId = radiantTurn?.moveId ?? ''
  cfg.remielleRadiantTurnActionTime = radiantTurn?.actionTime ?? 0
  cfg.remielleRadiantTurnDecibelRecovery = radiantTurn?.decibelRecovery ?? 0
  // 惊鸿（长按A 正版，映曜状态）+ 花羽轮舞（入场）——两招的**直伤**与**时间**都用这里存的参数
  const fleetingGrace = findRemielleFleetingGrace(skills)
  const flowerFeather = findRemielleFlowerFeatherDance(skills)
  cfg.remielleFleetingGraceMoveId = fleetingGrace?.moveId ?? ''
  cfg.remielleFleetingGraceActionTime = fleetingGrace?.actionTime ?? 0
  cfg.remielleFleetingGraceComboAlignRatio = fleetingGrace?.comboAlignRatio ?? 0
  cfg.remielleFlowerFeatherMoveId = flowerFeather?.moveId ?? ''
  cfg.remielleFlowerFeatherActionTime = flowerFeather?.actionTime ?? 0
  cfg.remielleFlowerFeatherComboAlignRatio = flowerFeather?.comboAlignRatio ?? 0
  // 轮数（本轮的「飞了几次」）由资源侧跨轮反馈写回；buildCharConfig 只管招式参数
  // 一命「花羽轮舞」喧响：CC-41（2026-09-27）起改走跨轮反馈（remielleNextRoundFeedback → applyTeamConfig），
  // 原先这里乘的面板次数 `remielleFlowerFeatherDanceCount` 没有任何写入方（效果恒 0），已删除。
  const dazeBonusPct = remielleDazeBonusPct(slot, agent, team)
  // panel 同名字段只由上方 applyRemiellePanel 写（buildCharConfig 的 panel 只读：cfg 是本钩子唯一出口）
  cfg.remielleEnabled = true
  cfg.remielleRadiantTurnDazeBonusPct = dazeBonusPct
}

/**
 * 异化度（%）= 异化系数 + 异化系数提升。CC-35a（2026-09-27）抽出，是全队异常乘区
 * `globalAnomalyMultiplierFactor` 与 `anomalyPanels` 展示列 `refringe` 的唯一来源（原两处各写一遍）。
 */
function remielleRefringePct(panel: Readonly<PanelValues>): number {
  return panel.remielleRefringeCoefficient + panel.remielleRefringeCoefficientBonusPct
}

/**
 * CC-41（2026-09-27，census §5.44）：一命「发动[支援技：花羽轮舞]时，获得 200 点喧响值，18 秒内最多触发 1 次」。
 * 施放次数口径 = 队友触发的虚曜数（非蕾米槽位的异常触发之和，与耀变行 `remielle-luminize-assist` 的次数同源：
 * 模型里每个虚曜由一次花羽轮舞命中消耗），再按 18s 冷却取上限 ⌊战斗时长 / 18⌋（与 orphie 影画 2 的 CD 近似同款）。
 * 次数依赖异常池（晚于资源结算）⇒ 走 moduleFeedback 跨轮键，下一轮 converge 相位写回 cfg。
 */
export const REMIELLE_FLOWER_FEATHER_DANCE_CD_SECONDS = 18
export function remielleFlowerFeatherDanceCasts(
  ownSlot: number,
  perSlotAnomalyTriggers: ReadonlyArray<number> | undefined,
  combatTime: number,
): number {
  const voidflare = [0, 1, 2]
    .filter(slot => slot !== ownSlot)
    .reduce((sum, slot) => sum + Math.max(0, Math.floor(perSlotAnomalyTriggers?.[slot] ?? 0)), 0)
  const cap = Math.floor(Math.max(0, combatTime) / REMIELLE_FLOWER_FEATHER_DANCE_CD_SECONDS)
  return Math.max(0, Math.min(voidflare, cap))
}

function remielleNextRoundFeedback({ slot, anomalyPool, combatTime }: AgentNextRoundFeedbackInput): ModuleFeedback {
  return {
    remielleFlowerFeatherDanceCasts: remielleFlowerFeatherDanceCasts(slot, anomalyPool.perSlotAnomalyTriggers, combatTime),
    // 本轮飞了几轮（豆子侧 ∩ 时间侧）——下一轮 converge 写回 cfg，供 extraNecessaryAction 补「入场 + 惊鸿」两条必做动作行
    remielleRoundsThisRound: remielleFlightRounds(slot, anomalyPool.perSlotAnomalyTriggers),
  }
}

/** CC-41：converge 相位把上一轮花羽轮舞次数 × 每次喧响（面板值，影画 < 1 时为 0）累加进 extraSelfDecibelReward。 */
function applyRemielleTeamConfig({ cfg, phase, threads }: AgentTeamConfigInput): void {
  if (phase !== 'converge' || !threads) return
  // 轮数写回：下一轮 `extraNecessaryAction` 用它补「入场（花羽轮舞）+ 长按A（惊鸿）」两条必做动作行
  // （用户 2026-10-18：「入场技的直伤也没算呀」「打了什么就算什么很难吗」）。
  cfg.remielleRoundsThisRound = Math.max(0, Math.floor(threads.moduleFeedback.remielleRoundsThisRound ?? 0))
  const casts = Math.max(0, Math.floor(threads.moduleFeedback.remielleFlowerFeatherDanceCasts ?? 0))
  const perUse = Math.max(0, cfg.panel.remielleFlowerFeatherDanceDecibelPerUse)
  if (casts <= 0 || perUse <= 0) return
  cfg.extraSelfDecibelReward = cfg.extraSelfDecibelReward + perUse * casts
}

/**
 * **丢弃**（用户 2026-10-18）：「丢弃开关也很粗糙，不做开关，需要改为丢弃部分，这样子剩余部分进入
 * 细致分配算法就会自动算出打的更少的子弹，实现部分丢弃。如果丢弃全部，进入这个算法也会实现丢弃全部。」
 *
 * 键 = `remielle.drop:<槽位>`，值 = 该队友**丢弃的异常次数**（默认 0）。
 * 丢弃后的剩余次数进 `distributeIntegerByWeight` ⇒ 轮数 / 子弹归属 / 浪费量全部自动跟着算，
 * 不做单独分支（丢弃 0 = 全参与；丢弃全部 = 该槽彻底不产子弹）。
 */
const REMIELLE_DROP = {
  settingPrefix: 'remielle.drop',
  default: 0,
} as const

/** CC-64b：受档位门控的 buff id → 附加条件（原 store resolveSpecialTeammateBuffEnabled 的 5 个分支） */
const REMIELLE_BUFF_GATES: Readonly<Record<string, (st: ReturnType<typeof computeRemielleAdditionalState>) => boolean>> = {
  '1581.additional_ability.atk_1_anomaly': st => st.active && st.tier === 1,
  '1581.additional_ability.atk_2_anomaly': st => st.active && st.tier === 2,
  '1581.additional_ability.atk_3_anomaly': st => st.active && st.tier === 3,
  '1581.core_passive.refringe_3_anomaly': st => st.tier === 3,
  '1581.additional_ability.prismatic_buildup': st => st.active,
}

/**
 * CC-64b 档位门控。r410 CC-384：本人由派发器给（`self`），与失衡加成（`remielleDazeTier`）共用同一份 `ReadonlyTeam` + 真实槽位求值；
 * 原 `remielleAdditionalState` 在压缩 `Agent[]` 里按 id 自找、拿下标当槽位，已删。r411 CC-385：不在队不会被询问。
 */
function remielleTeammateBuffGate({ buffId, team, self }: TeammateBuffGateInput): boolean | undefined {
  const gate = REMIELLE_BUFF_GATES[buffId]
  if (!gate) return undefined
  return gate(computeRemielleAdditionalState(team, self.slot, self.agent))
}

export const remielleMechanic: AgentMechanicModule = {
  // 拆轮（用户 2026-10-18）：默认 0 = 7 轮完整惊鸿；每 +1 就多飞一轮，代价是该轮长按A 降级为垂虹
  settings: [
    {
      id: REMIELLE_SPLIT_ROUND_SETTING,
      label: '蕾米拆轮（多飞的轮次）',
      description: '一轮完整惊鸿需要后台飞满 15s（浮晖 120→90）。想多飞一轮就得有一波不到 15s 就换出来——那时浮晖还没到 90，拿不到映曜，长按A 只能打垂虹（耀变 160% 而非 320%、直伤 390.8% 而非 1194.5%）。默认 0 = 只打 7 轮完整惊鸿，多余虚曜浪费（普通玩家打法）。',
      default: 0,
      min: 0,
      max: REMIELLE_SPLIT_ROUND_MAX,
      step: 1,
      suffix: '轮',
    },
  ],

  // CC-64b：额外能力档位门控队友 buff（原 stores/config.ts 写死 1581 + 5 个 buff id）
  teammateBuffGate: remielleTeammateBuffGate,
  // CC-64：新上阵默认不分配平A时间（原 stores/config.ts#defaultBasicAttackTimeWeight 写死 1581）
  defaultBasicAttackTimeWeight: 0,
  // 2026-10-18 用户口径：「蕾米和柚叶这种辅助，初始交互次数也该是 0」——蕾米是**后台飞行**型异常辅助
  // （自身平A权重本来就声明 0），给她发通用弹刀6/闪反10 与「后台型」自相矛盾：实测预设
  // `auto-1581-1511-1411` 清零后 C0 +2.6% / C6 +7.9%（弹刀/闪反白占前台、挤掉队友）。
  // 与伊德海莉同一条通道（`interactionBaseline.ts#interactionBaselineFor`），不是写死名单。
  noGenericInteraction: true,
  // 子弹来源与丢弃（用户 2026-10-18）：每个队友可「丢弃 N 次异常」——丢弃后的剩余次数才进池 ⇒
  // 轮数 / 子弹归属 / 浪费量全部由 `distributeIntegerByWeight` 自动算出（不做单独开关分支）。
  teammateDrop: {
    settingPrefix: REMIELLE_DROP.settingPrefix,
    title: '蕾米虚曜子弹来源',
    suffix: '次',
    note: '每轮只存最新 3 个虚曜。这里填该队友**丢弃的异常次数**（0 = 全参与）：丢弃后剩余次数进分配算法，轮数与子弹归属自动跟着算——填满就实现了「洗掉垃圾子弹」。',
  },
  // CC-42：风化浸染默认挑槽时排除（原 anomalyPanels 内的 isRemielleAgent 跨槽判定）
  excludeFromWindInfectionPick: true,
  // CC-41：一命花羽轮舞喧响（跨轮反馈）
  nextRoundFeedback: remielleNextRoundFeedback,
  applyTeamConfig: applyRemielleTeamConfig,
  id: 'agent:remielle',
  agentIds: [REMIELLE_AGENT_ID],
  // CC-26b：后台飞行状态「光辉回转」自动行（原 core/resource/rowBuild.ts 内联，逐字搬迁）
  backstageAutoRows: remielleRadiantTurnRows,
  // CC-28：虚耀池/耀变/特殊虚耀事件记录（原 useResourceCalc.ts remielleVoidflareEvents 编排层分支，逐字搬迁）
  anomalyEventRecords: remielleAnomalyEventRecords,
  /**
   * 必做动作（三类，全部由资源侧轮数/命座驱动）：
   *
   * ① **入场：支援技花羽轮舞**（每轮 1 次）—— 原文「下次普通换入时自动发动」。
   *    它是**真打出来的招式**（907.8% 直伤 + 320% 耀变），必须占前台时间、必须进直伤池。
   * ② **长按A：普通攻击惊鸿**（每轮 1 次，有映曜时）—— 1194.5% 直伤 + 320% 耀变，同样必须进池。
   * ③ **特殊虚耀载体：垂虹**（一/四/六命，见 CC-26）。
   *
   * 用户口径（2026-10-18 逐字）：「入场技的直伤也没算呀」「打了什么就算什么很难吗」「这个本来就是他的必要时间，
   * 你拿了他的时间算，还不想还吗」——蕾米的前台时间本来就被这些动作占着，补行不是「新增开销」，
   * 是把本来就该记的账记上（修前这些时间没进 necessary，等于白送给她）。
   */
  extraNecessaryAction: (cfg) => {
    const actions: ExtraNecessaryAction[] = []
    // 总轮次 = min(豆子侧, 后台侧) 里**能飞的部分**；拆轮数决定其中几轮打惊鸿、几轮降级垂虹
    const beanRounds = Math.max(0, Math.floor(cfg.remielleRoundsThisRound ?? 0))
    const split = Math.max(0, Math.min(REMIELLE_SPLIT_ROUND_MAX, Math.floor(cfg.panel.remielleSplitRounds ?? 0)))
    const rounds = Math.min(beanRounds, REMIELLE_MAX_FLOWER_FEATHER_ROUNDS + split)
    /**
     * 长按A 的**形态拆分**（用户 2026-10-18）：「通常玩家只能打 7 轮完整惊鸿，更高轮次肯定是把惊鸿轮拆成了
     * 2 次垂鸿轮」。浮晖循环一场只撑得住 7 轮完整惊鸿（15 + 2.683 + 3.533 ≈ 21.2s × 7 = 148.5s，
     * 第 8 轮要 170s）；超过的部分长按A 退化为垂虹（耀变 160% vs 320%、直伤 390.8% vs 1194.5%）。
     * 每多一轮超额 = 1 次花羽轮舞 + 1 次垂虹（而不是 1 次惊鸿）。
     */
    // 拆轮语义（用户 2026-10-18 逐字）：「调成 1 你就写 6 惊鸿 2 垂鸿」——
    // **拆 1 轮惊鸿 = 把它变成 2 轮垂虹**（每轮仍清空 3 豆 ⇒ 拆一轮要多花 3 个豆）。
    // 总轮次 = 7 + split，构成 = (7 − split) 惊鸿 + 2·split 垂虹。
    const appliedSplit = Math.min(split, rounds > 0 ? REMIELLE_MAX_FLOWER_FEATHER_ROUNDS : 0)
    const graceRounds = Math.max(0, Math.min(rounds, REMIELLE_MAX_FLOWER_FEATHER_ROUNDS - appliedSplit))
    const rainbowRounds = Math.max(0, Math.min(rounds - graceRounds, appliedSplit * 2))
    if (rounds > 0 && cfg.remielleFlowerFeatherMoveId) {
      actions.push({
        count: rounds,
        moveId: cfg.remielleFlowerFeatherMoveId,
        moveName: '支援技：花羽轮舞（入场）',
        actionTime: cfg.remielleFlowerFeatherActionTime ?? 0,
        comboAlignRatio: cfg.remielleFlowerFeatherComboAlignRatio ?? 0,
      })
    }
    if (graceRounds > 0 && cfg.remielleFleetingGraceMoveId) {
      actions.push({
        count: graceRounds,
        moveId: cfg.remielleFleetingGraceMoveId,
        moveName: '普通攻击：惊鸿（长按A）',
        actionTime: cfg.remielleFleetingGraceActionTime ?? 0,
        comboAlignRatio: cfg.remielleFleetingGraceComboAlignRatio ?? 0,
      })
    }
    if (rainbowRounds > 0 && cfg.remielleRainbowEndMoveId) {
      actions.push({
        count: rainbowRounds,
        moveId: cfg.remielleRainbowEndMoveId,
        moveName: '普通攻击：垂虹（超额轮·无映曜）',
        actionTime: cfg.remielleRainbowEndActionTime ?? 0,
        comboAlignRatio: cfg.remielleRainbowEndComboAlignRatio ?? 0,
        decibelRecovery: cfg.remielleRainbowEndDecibelRecovery ?? 0,
      })
    }
    const specialCount = remielleSpecialVoidflareUseCount(cfg)
    if (specialCount > 0) {
      actions.push({
        count: specialCount,
        moveId: cfg.remielleRainbowEndMoveId || undefined,
        moveName: '普通攻击：垂虹（特殊虚耀载体）',
        actionTime: cfg.remielleRainbowEndActionTime ?? 0,
        comboAlignRatio: cfg.remielleRainbowEndComboAlignRatio ?? 0,
        decibelRecovery: cfg.remielleRainbowEndDecibelRecovery ?? 0,
      })
    }
    return actions.length > 0 ? actions : null
  },
  // CC-26：特殊虚耀异常事件（原 core/resource/rowBuild.ts#buildAnomalyEventExecutions 内联，逐字搬迁）
  buildAnomalyEvents: ({ cfg, events }) => {
    const specialCount = remielleSpecialVoidflareCount(cfg.panel)
    if (specialCount > 0 && cfg.remielleRainbowEndMoveId) {
      events.push({
        eventId: 'remielle_special_voidflare_event',
        eventName: '特殊虚耀',
        eventType: 'special_voidflare',
        carrierMoveId: cfg.remielleRainbowEndMoveId,
        carrierMoveName: '普通攻击：垂虹',
        count: specialCount,
        formula: 'count = (remielleCinema1SpecialVoidflareCount + remielleCinema4SpecialVoidflareRefillCount/3) × 3 × (1 + remielleCinema6FleetingGraceVoidflareTriggerMultiplier) —— 垂虹次数 × 3 豆 × 6命耀变翻倍',
        fields: [
          'remielleCinema1SpecialVoidflareCount',
          'remielleCinema4SpecialVoidflareRefillCount',
          'remielleCinema6FleetingGraceVoidflareTriggerMultiplier',
          'remielleRainbowEndMoveId',
        ],
        note: '异常事件只记录次数和载体动作；不进入普通招式执行计划，不读取 damageMultiplier。',
      })
    }
  },
  /** 异化系数倍率：1 + (异化度 + 异化度提升) / 100，乘到全队所有异常相关伤害（CC-21 自 useResourceCalc 逐字迁入） */
  globalAnomalyMultiplierFactor: (panel: PanelValues) => 1 + remielleRefringePct(panel) / 100,
  // CC-35a：异化度展示值（anomalyPanels 异常虚拟面板 refringe 列），与上面的乘区同一来源
  anomalyRefringePct: remielleRefringePct,
  name: '蕾米埃尔',
  description: '虚曜/耀变/异化系数：队友异常反应生成虚曜，特定招式命中触发耀变；异化系数与耀变倍率随异常精通提升。',
  applyPanel: applyRemiellePanel,
  teamPanelEffects: applyRemielleTeamPanelEffects,
  buildCharConfig: buildRemielleCharConfig,
  // CC-34c②：Radiant Turn（1581010）失衡独立乘区 1 + 档位%（原 helpers.ts#extractSkillExecutions 内联，逐字迁入）
  skillDazeMultiplier: ({ moveId, panel }) => moveId === '1581010'
    ? 1 + ((panel?.remielleRadiantTurnDazeBonusPct ?? 0) / 100)
    : 1,
  buildResourceResult: buildRemielleResourceResult,
  resourceSections: buildRemielleResourceSections,
  /**
   * 蕾米埃尔专属异常附加行（CC-19c-2 2026-09-26，设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §7.2）：
   * 块 6（耀变 / 特殊虚耀）自 `damagePoolAnomaly.ts` 逐字迁入，order = `EXTRA_ANOMALY_ROW_ORDER.voidflare`（60）。
   * 字段、字段顺序、id / name / type / source / note 模板与 `[0, 1, 2]` 字面量逐字不变（对象键顺序可能进
   * rowsnap 哈希）；`remielleSlot` / `remiellePanel` / `remielleEntryPanel` / `remielleSkills` 用局部别名
   * 保持块体逐字（派发循环里本模块只被自己那槽调用 ⇒ `remielleSlot >= 0` 恒真，别名等价）。
   */
  extraAnomalyRows: ({
    slot, panel, entryPanel, skills, panelOf, teamElement,
    enemy, enemyDamageRes, stunCoverage, anomalyPool, teamAgentId, agentName, elementLabel, charResult,
  }: ExtraAnomalyRowsInput): ExtraAnomalyRowGroup[] => {
    const rows: DamagePoolRow[] = []
    const remielleSlot = slot
    const remiellePanel = panel
    const remielleEntryPanel = entryPanel
    const remielleSkills = skills
    /**
     * 蕾米**本轮实际打出的动作次数**（用户 2026-10-18：「蕾米根本没有打虚耀的动作但是虚耀自动结算了」）。
     *
     * 原文（`Term:1000034` 耀变）：「基于已储存的所有[虚曜]…对敌人造成**招式对应倍率**的属性异常伤害」——
     * 耀变是**招式结束后的附加结算**，没有那个招式就没有耀变。修前三个载体行按「虚曜池 × 每虚曜一次」算
     * （`countsBySlot` = 池大小），与蕾米实际打了几下完全脱钩：队里没出终结技也照算终结技耀变。
     * 现按「招式次数」封顶：花羽轮舞 / 缭乱终幕 / 惊鸿各自 ≤ 本轮执行行里该招式的次数；
     * 惊鸿另受 C6 翻倍与虚曜供给（每发清空 3 豆）双重约束。
     */
    const actionCountOf = (moveId: string): number =>
      Math.max(0, Math.floor(charResult?.executions.find(e => e.moveId === moveId)?.count ?? 0))
    if (remiellePanel && remielleEntryPanel) {
      const otherSlots = [0, 1, 2].filter(slot => slot !== remielleSlot)
      const perSlotAnomaly = anomalyPool?.perSlotAnomalyTriggers ?? []
      const voidflareBySlot = otherSlots
        .map(slot => ({
          slot,
          count: Math.max(0, Math.floor(perSlotAnomaly[slot] ?? 0)),
          element: teamElement(slot),
          panel: panelOf(slot),
        }))
        .filter(item => item.count > 0 && item.panel)
      const voidflareTotal = voidflareBySlot.reduce((sum, item) => sum + item.count, 0)

      const skillLevelBonus = remiellePanel.skillLevelBonus
      const c1ResIgnore = remiellePanel.remielleCinema1SpecialVoidflareCount > 0 ? 50 : 0
      if (voidflareTotal > 0 && remielleSkills) {
        const fleetingGraceMultiplier = remielleFleetingGraceMultiplier(remiellePanel)
        // ---- 一轮 = 3 个虚曜（用户 2026-10-18 玩法口径，逐字）----
        // 「蕾米放 e 就切后台，然后队友打出 3 次异常，积攒 3 个豆，蕾米就出来打入场、有大招放大招、
        //  最后长按平 a。0 命这一套打了 9 次耀变，如果没大招就打 2 个动作 6 次耀变。这就是一轮。」
        // ⇒ ① **每次动作结算「已储存的全部虚曜」**（最多 3 个，不是池里 20 个全算）；
        //    ② 一轮消耗 3 个（惊鸿/垂虹清空）⇒ 轮数 = ⌊虚曜池 / 3⌋；
        //    ③ 每轮里每个载体**各结算一次**（入场 / 大招 / 长按A），且**不能超过蕾米本轮实际打的招式数**
        //       —— 修前按「虚曜池 × 每虚曜一次」算，与蕾米有没有出手完全脱钩（用户：
        //       「蕾米根本没有打虚耀的动作但是虚耀自动结算了」）。
        /**
         * **丢弃**（用户 2026-10-18）：「丢弃开关也很粗糙，不做开关，需要改为丢弃部分，这样子剩余部分进入
         * 细致分配算法就会自动算出打的更少的子弹，实现部分丢弃。如果丢弃全部，进入这个算法也会实现丢弃全部。」
         *
         * ⇒ 丢弃不是「开关」，而是**每个队友一个可丢弃的次数**（`remielle.drop:<slot>`，默认 0）。
         * 丢弃后的剩余次数才进池 ⇒ 轮数、子弹分配、浪费量全部自动跟着算，不需要额外分支。
         */
        const effectiveBySlot = new Map<number, number>()
        for (const item of voidflareBySlot) {
          const dropped = Math.max(0, Math.floor(remiellePanel.remielleTeammateDrops?.[String(item.slot)] ?? REMIELLE_DROP.default))
          effectiveBySlot.set(item.slot, Math.max(0, item.count - dropped))
        }
        const effectiveTotal = [...effectiveBySlot.values()].reduce((a, b) => a + b, 0)
        const storedTotal = Math.min(VOIDFLARE_MAX, effectiveTotal)
        /**
         * **轮数 = ⌊池 / 3⌋，但默认封顶 7**（用户 2026-10-18）：「可以飞九轮但是不能默认飞 9 轮，
         * 提速垂鸿需要部分队伍很严格的效率才行，正常就是 7 轮」⇒ 豆子再多也只按 7 轮打，
         * 想多飞必须显式调 `remielle.splitRounds`（每拆 1 轮 = 少 1 惊鸿、多 2 垂虹）。
         */
        const cycles = Math.min(
          Math.floor(effectiveTotal / REMIELLE_SPECIAL_VOIDFLARE_PER_ROUND),
          REMIELLE_MAX_FLOWER_FEATHER_ROUNDS + Math.max(0, Math.min(REMIELLE_SPLIT_ROUND_MAX, Math.floor(remiellePanel.remielleSplitRounds ?? 0))),
        )
        /**
         * **细致分配**（用户 2026-10-18：「大招固定一个 a 子弹，但总量只有 3 个 a，却打了 7 次大招，
         * 不符合实际」）：不再「入场/长按A 按比例、大招按滑块」两套口径，而是**按每个队友的可用次数
         * 占全部可用次数的比例，把「本次实际要结算的子弹数」整数分摊到各槽**——每次载体各分一次，
         * 于是 A 只有 3 次时，7 次大招里只有 3 次能算成 A 的，其余归 B。
         *
         * 为什么这就是「最新 3 个」的正确近似：池只存最新 3 个，所以每个载体的 3 个子弹天然按
         * 「谁在这一轮里贡献得多」分；分摊到每轮后，A 的 3 个只可能出现在 3 轮里（不会 7 轮都有）。
         */
        const weightSlots = otherSlots.filter(slot => (effectiveBySlot.get(slot) ?? 0) > 0)
        const weightValues = weightSlots.map(slot => effectiveBySlot.get(slot) ?? 0)
        const storedCountBySlot: Record<string, number> = {}
        for (const [slot, n] of distributeIntegerByWeight(storedTotal, weightValues).entries()) {
          if (n > 0) storedCountBySlot[String(weightSlots[slot]!)] = n
        }
        /**
         * 每轮的三个载体次数（用户 2026-10-18 玩法口径）：
         * - 入场 = 支援技花羽轮舞（原文「下次普通换入时自动发动」）⇒ 每轮 1 次，**不受执行行限制**
         *   （引擎不物化该动作：它是换入时自动触发，不是前台动作）；
         * - 大招 = 缭乱终幕 ⇒ 每轮 ≤ 1 次，**受本轮实际大招次数封顶**（没大打就不结算）；
         * - 长按A = 惊鸿 ⇒ 每轮 1 次，消耗并清空虚耀。
         * ⇒ 有大招一轮 9 次（3+3+3）、没大招一轮 6 次（3+3），与用户实测一致。
         */
        // 拆轮（用户 2026-10-18）：「默认 7 轮上限，如果一个队伍的轮次想达到 8，就要拆一轮惊鸿，
        // 如果想达到 9，就要拆 2 轮」⇒ 总轮次受 `7 + split` 封顶，其中超出 7 的部分降级为垂虹。
        // 拆 1 轮惊鸿 = 2 轮垂虹（每轮清空 3 豆）⇒ 总轮次 = 7 + split，构成 = (7 − split) 惊鸿 + 2·split 垂虹。
        const split = Math.max(0, Math.min(REMIELLE_SPLIT_ROUND_MAX, Math.floor(remiellePanel.remielleSplitRounds ?? 0)))
        const appliedSplit = Math.min(split, cycles > 0 ? REMIELLE_MAX_FLOWER_FEATHER_ROUNDS : 0)
        const assistUses = Math.min(cycles, REMIELLE_MAX_FLOWER_FEATHER_ROUNDS + appliedSplit)
        const basicUses = Math.max(0, Math.min(cycles, REMIELLE_MAX_FLOWER_FEATHER_ROUNDS - appliedSplit))
        const overflowRainbowUses = Math.max(0, Math.min(cycles - basicUses, appliedSplit * 2))
        const ultimateUses = Math.min(actionCountOf('1581016'), assistUses)
        /**
         * 每个载体**各自**按可用次数比例分摊（不再是「入场按比例、大招按滑块」两套口径）：
         * 载体次数 × 该槽占比。于是 A 只有 3 次时，7 次大招里只有 3 次算 A 的。
         */
        // ⚠ 按**总子弹数**分摊，不是按「每轮的 3 个」分摊：后者会让 15:15 变成每次 2:1（余数取整的偏置被轮数放大成 14:7）。
        // 正确做法 = 先算总子弹数（= 载体次数 × 3），再整数分摊给各槽。
        const allocateTotal = (uses: number): Record<string, number> => {
          const out: Record<string, number> = {}
          for (const [i, n] of distributeIntegerByWeight(storedTotal * uses, weightValues).entries()) {
            if (n > 0) out[String(weightSlots[i]!)] = n
          }
          return out
        }
        const scaleCounts = (bySlot: Record<string, number>, uses: number, mult = 1): Record<string, number> =>
          Object.fromEntries(Object.entries(bySlot).map(([s, c]) => [s, c * uses * mult]))
        const actionRows = [
          {
            id: 'remielle-luminize-assist',
            name: '支援技花羽轮舞·耀变',
            moveId: '1581015',
            countsBySlot: allocateTotal(assistUses),
          },
          {
            id: 'remielle-luminize-ultimate',
            name: '终结技缭乱终幕·耀变',
            moveId: '1581016',
            countsBySlot: allocateTotal(ultimateUses),
          },
          {
            id: 'remielle-luminize-basic',
            name: '普通攻击惊鸿·耀变',
            moveId: '1581008',
            countsBySlot: scaleCounts(allocateTotal(basicUses), 1, fleetingGraceMultiplier),
          },
          {
            // 超额轮的长按A 退化为垂虹（160% 而非 320%）：不是少打，是形态降级
            id: 'remielle-luminize-rainbow',
            name: '普通攻击垂虹·耀变（超额轮）',
            moveId: '1581007',
            countsBySlot: scaleCounts(allocateTotal(overflowRainbowUses), 1, fleetingGraceMultiplier),
          },
        ]

        for (const action of actionRows) {
          const move = findMoveById(remielleSkills, action.moveId)
          const luminizeRow = move?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
          const multiplier = getRemielleLevelValue(luminizeRow, skillLevelBonus)
          if (multiplier <= 0) continue
          const actionCount = Object.values(action.countsBySlot).reduce((a, b) => a + b, 0)
          if (actionCount <= 0) continue

          for (const item of voidflareBySlot) {
            const count = action.countsBySlot[String(item.slot)] ?? 0
            if (count <= 0 || !item.panel) continue
            const result = calcVoidflareDamage({
              sourcePanel: item.panel,
              remiellePanel,
              multiplier,
              element: item.element,
              enemyDefense: enemy.defense,
              enemyResistances: enemyDamageRes,
              stunMultiplier: enemy.stunVuln,
              stunned: stunCoverage,
              cinema1ResIgnore: c1ResIgnore,
            })
            rows.push({
              id: `${action.id}-${item.slot}`,
              slot: remielleSlot,
              agentId: teamAgentId(remielleSlot),
              agentName: agentName(teamAgentId(remielleSlot), remielleSlot),
              type: '耀变',
              name: action.name,
              element: item.element,
              source: `${agentName(teamAgentId(item.slot), item.slot)} 的${elementLabel(item.element)}异常虚耀`,
              count,
              perDamage: result.damage,
              totalDamage: result.damage * count,
              note: `来源虚耀 ${count} 次 · ${result.formula}`,
            })
          }
        }
      }

      // CC-325：特殊虚耀（1/4/6 命自带虚曜点，垂虹打出）只用蕾米自身面板与技能表，与队友虚耀无关——
      // 原先嵌在 `voidflareTotal > 0` 块内，队友不产生异常（单人 / 无异常队友）时被一并跳过，
      // 而垂虹必做动作（extraNecessaryAction）照扣前台时间 ⇒ 时间扣了、耀变伤害没算。
      const specialCount = remielleSkills ? remielleSpecialVoidflareCount(remiellePanel) : 0
      if (specialCount > 0 && remielleSkills) {
        const rainbowMove = findMoveById(remielleSkills, '1581007')
        const rainbowLuminizeRow = rainbowMove?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
        const rainbowMultiplier = getRemielleLevelValue(rainbowLuminizeRow, skillLevelBonus)
        const specialMultiplier = rainbowMultiplier * 2.5
        if (specialMultiplier > 0) {
          const result = calcVoidflareDamage({
            sourcePanel: remielleEntryPanel,
            remiellePanel: remielleEntryPanel,
            multiplier: specialMultiplier,
            element: 'lumiflux',
            enemyDefense: enemy.defense,
            enemyResistances: enemyDamageRes,
            stunMultiplier: enemy.stunVuln,
            stunned: stunCoverage,
            cinema1ResIgnore: c1ResIgnore,
          })
          rows.push({
            id: 'remielle-special-voidflare',
            slot: remielleSlot,
            agentId: teamAgentId(remielleSlot),
            agentName: agentName(teamAgentId(remielleSlot), remielleSlot),
            type: '特殊虚耀',
            name: '普通攻击垂虹·特殊虚耀',
            element: 'lumiflux',
            source: '蕾米进场记录面板 × 2.5 特殊独立乘区',
            count: specialCount,
            perDamage: result.damage,
            totalDamage: result.damage * specialCount,
            note: `垂虹倍率 ${fmt(rainbowMultiplier)}% × 2.5 · ${result.formula}`,
          })
        }
      }
    }
    if (rows.length === 0) return []
    return [{ order: EXTRA_ANOMALY_ROW_ORDER.voidflare, rows }]
  },
}

/** 特殊虚耀载体「普通攻击：垂虹」施放次数（CC-26 自 core/resource/rowAccounting.ts 迁入；CC-332：每次垂虹清空 3 豆，垂虹次数 = 1/2/2，与耀变次数 3/6/12 分离） */
export function remielleSpecialVoidflareUseCount(cfg: CharacterOperationConfig): number {
  return remielleSpecialVoidflareRainbowCount(cfg.panel)
}

/**
 * 光辉回转后台自动行（CC-26b 自 core/resource/rowBuild.ts#buildExecutions 迁入，计算逐字保留）。
 * `executions` = 构建到派发点为止的执行行（用于数前台动作）；返回新行由构建器 push。
 */
export function remielleRadiantTurnRows({ cfg, state, executions }: AgentBackstageRowsInput): SkillExecution[] {
  const rows: SkillExecution[] = []
  // 蕾米后台飞行状态：每5秒自动释放一次 Radiant Turn；合轴100%，不占前台时间。
  // 后台时间含无敌秒（先扣）；CD 被蕾米本人前台时间插进循环造成相位延后 → 等效使用 CD（core/effectiveTime.ts）；
  // 前台块长 = 前台时间 / 切上次数（切上前台频率 × 非平A前台动作次数；蕾米没有切上频率滑块，频率固定 1）。
  if (cfg.remielleEnabled && cfg.remielleRadiantTurnMoveId) {
    const block = frontBlockSeconds(
      state.frontlineTime,
      countFrontActions(executions, cfg.assistFollowUpMoveId),
      1,
      5,
    )
    const radiantInterval = phaseDelayedCooldown(5, state.frontlineTime, effectiveBattleTime(cfg), block)
    const radiantTurnCount = Math.floor(effectiveBackstageTime(state.backstageTime, cfg) / radiantInterval)
    if (radiantTurnCount > 0) {
      rows.push(moduleExecRow({
        moveId: cfg.remielleRadiantTurnMoveId,
        moveName: 'Special Attack: Ode to Dawn - Radiant Turn（后台）',
        category: 'special',
        count: radiantTurnCount,
        actionTime: cfg.remielleRadiantTurnActionTime ?? 0,
        comboAlignRatio: 1,
        decibelRecovery: cfg.remielleRadiantTurnDecibelRecovery ?? 0,
        totalDecibelRecovery: radiantTurnCount * (cfg.remielleRadiantTurnDecibelRecovery ?? 0),
        timeBucket: 'backstage',
        autoSplitByStun: true, // CC-391 D1：后台飞行每 5 秒自动释放一次 ⇒ 轴模式按失衡时间占比吃易伤（不靠放置）
      }))
    }
  }
  return rows
}

/**
 * 蕾米虚耀池与耀变触发事件（CC-28 自 `useResourceCalc.ts#remielleVoidflareEvents` 迁入，文案/公式逐字保留）。
 * 编排层按槽位派发：`slot` = 蕾米槽位，`panel` = `panelAt(panels, slot)`（判据 17 已在派发侧保证）。
 */
export function remielleAnomalyEventRecords({ slot: ownSlot, panel, teamAgentIds, perSlotAnomalyTriggers }: AgentAnomalyEventRecordsInput): AnomalyEventRecord[] {
  const otherSlots = [0, 1, 2].filter(slot => slot !== ownSlot)
  const perSlotAnomaly = perSlotAnomalyTriggers
  const voidflareTotal = otherSlots.reduce((sum, slot) => sum + Math.max(0, Math.floor(perSlotAnomaly[slot] ?? 0)), 0)
  // CC-325：不在 voidflareTotal=0 时提前 return——特殊虚耀（1/4/6 命自带虚曜点，垂虹打出）与队友异常无关；
  // 提前 return 会把它一并吞掉，而垂虹必做动作（extraNecessaryAction）照扣前台时间 ⇒ 时间扣了、耀变没算。
  // 依赖虚耀池的记录 count 为 0，由末尾 filter(count > 0) 自然剔除。

  const remiellePanel = panel
  // 2026-10-18 用户玩法口径（与 extraAnomalyRows 同源，见那里的注释）：
  // 一轮 = 3 个豆 = 一个动作周期（入场 / 大招 / 长按A 各结算「已储存的全部虚曜」）。
  // 与 `extraAnomalyRows` 的差异只在**载体次数**：本函数是事件账本，不拿执行行（不 in 那个钩子），
  // 故只报「按虚曜供给可结算的轮数 × 每轮结算数」，与伤害行口径同构（伤害行再乘实际动作次数）。
  const storedTotal = Math.min(VOIDFLARE_MAX, voidflareTotal)
  const cycles = Math.floor(voidflareTotal / REMIELLE_SPECIAL_VOIDFLARE_PER_ROUND)
  const fleetingGraceMultiplier = remielleFleetingGraceMultiplier(remiellePanel)
  const specialCount = remielleSpecialVoidflareCount(remiellePanel)
  const perSlotText = otherSlots
    .map(slot => `${teamAgentIds[slot] ?? slot}:${perSlotAnomaly[slot] ?? 0}`)
    .join(' / ')

  const records: AnomalyEventRecord[] = [
    {
      id: 'remielle-voidflare-pool',
      type: 'luminize',
      label: '蕾米虚耀池',
      source: '其他队友异常触发',
      count: voidflareTotal,
      formula: 'voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]',
      fields: ['AnomalyPoolResult.perSlotAnomalyTriggers', '蕾米槽位', perSlotText],
      note: '每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。',
    },
    {
      id: 'remielle-luminize-assist',
      type: 'luminize',
      label: '支援技花羽轮舞·耀变',
      source: '不消耗虚耀（换入时自动发动）',
      count: cycles * storedTotal,
      formula: 'count = 轮数 × 已储存虚曜数（每轮换入结算一次，最多 3 个）',
      fields: ['voidflareTotal', `rounds=floor(voidflareTotal/${REMIELLE_SPECIAL_VOIDFLARE_PER_ROUND})`, 'storedTotal', '1581015 luminizeMultiplier'],
    },
    {
      id: 'remielle-luminize-ultimate',
      type: 'luminize',
      label: '终结技缭乱终幕·耀变',
      source: '不消耗虚耀，每轮一次（有大招才结算）',
      count: cycles * storedTotal,
      formula: 'count = 轮数 × 已储存虚曜数；伤害行再按本轮实际大招次数封顶（来源由用户选择1号队友0-3、2号队友3-0）',
      fields: ['voidflareTotal', 'storedTotal', 'remielle.drop:{slot}'],
    },
    {
      id: 'remielle-luminize-basic',
      type: 'luminize',
      label: '普通攻击惊鸿·耀变',
      source: '消耗并清空虚耀',
      count: cycles * storedTotal * fleetingGraceMultiplier,
      formula: `count = 轮数 × 已储存虚曜数 × ${fleetingGraceMultiplier}${fleetingGraceMultiplier > 1 ? '（6命翻倍）' : ''}`,
      fields: ['voidflareTotal', 'storedTotal', 'remielleCinema6FleetingGraceVoidflareTriggerMultiplier', '1581008 luminizeMultiplier'],
    },
    {
      id: 'remielle-special-voidflare',
      type: 'special_voidflare',
      label: '普通攻击垂虹·特殊虚耀',
      source: '开局特殊虚曜点，垂虹打出并消耗',
      count: specialCount,
      formula: 'count = 垂虹次数 × 3 豆 × (1 + 6命耀变翻倍)；倍率 = 垂虹耀变倍率 × 2.5',
      fields: ['remielleCinema1SpecialVoidflareCount', 'remielleCinema4SpecialVoidflareRefillCount', 'remielleCinema6FleetingGraceVoidflareTriggerMultiplier'],
    },
  ]
  return records.filter(event => event.count > 0)
}

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 蕾米「普通攻击：垂虹」actionTime */
    remielleRainbowEndActionTime?: number
    /** 蕾米「普通攻击：垂虹」喧响回复 */
    remielleRainbowEndDecibelRecovery?: number
    /** 蕾米「普通攻击：垂虹」合轴率 0-1 */
    remielleRainbowEndComboAlignRatio?: number
    /** 蕾米「普通攻击：惊鸿」move id / actionTime / 合轴率（长按A 正版，映曜状态） */
    remielleFleetingGraceMoveId?: string
    remielleFleetingGraceActionTime?: number
    remielleFleetingGraceComboAlignRatio?: number
    /** 蕾米「支援技：花羽轮舞」move id / actionTime / 合轴率（每轮入场自动发动） */
    remielleFlowerFeatherMoveId?: string
    remielleFlowerFeatherActionTime?: number
    remielleFlowerFeatherComboAlignRatio?: number
    /** 本轮飞了几轮（跨轮反馈写入；0/缺省 = 未结算） */
    remielleRoundsThisRound?: number
    /** 每队友槽丢弃的异常次数（键 = 槽位字符串；applyPanel 写，资源卡/分配读） */
    remielleTeammateDrops?: Readonly<Record<string, number>>
    /** 蕾米后台 Radiant Turn move id */
    remielleRadiantTurnMoveId?: string
    /** 蕾米后台 Radiant Turn actionTime */
    remielleRadiantTurnActionTime?: number
    /** 蕾米后台 Radiant Turn 喧响回复 */
    remielleRadiantTurnDecibelRecovery?: number
    /** 蕾米一/四命特殊虚耀跟随的「普通攻击：垂虹」move id（CC-34b 起垂虹 / Radiant Turn 各字段只由 `remielle.ts#buildRemielleCharConfig` 写，非蕾米槽缺省） */
    remielleRainbowEndMoveId?: string
    /** 蕾米后台飞行状态每5秒自动释放一次 Radiant Turn */
    remielleEnabled?: boolean
    /** 蕾米额外能力：Luminous Reflection 状态失衡提升（6/12/35） */
    remielleRadiantTurnDazeBonusPct?: number
  }
}

/**
 * D2（CC-359/360）：本模块自产自读的跨轮反馈键（nextRoundFeedback 产出、下一轮本模块读回），声明随模块走，不堆在 `mechanics/types.ts`。
 * 仍是 `ModuleFeedback` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/mechanics/types' {
  interface ModuleFeedback {
    /** 蕾米埃尔一命：上一轮花羽轮舞施放次数（= 队友虚曜数，按 18s 冷却封顶；CC-41，读回方 remielle.ts#applyRemielleTeamConfig） */
    remielleFlowerFeatherDanceCasts?: number
    /** 上一轮飞了几轮（豆子侧 ⌊池/3⌋；读回方 remielle.ts#applyRemielleTeamConfig ⇒ cfg.remielleRoundsThisRound ⇒ extraNecessaryAction 补入场/惊鸿行） */
    remielleRoundsThisRound?: number
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 蕾米埃尔机制资源明细 */
    remielleMechanicSource?: RemielleMechanicSource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 蕾米埃尔虚曜/耀变/异化系数资源明细 */
export interface RemielleMechanicSource {
  voidflareStored: number
  voidflareMax: number
  refringeCoefficient: number
  luminizeMultiplierBonus: number
  /** 拆轮数（面板值透传；资源卡按它展示「N 惊鸿 + M 垂虹」） */
  splitRounds: number
  note: string
}

/**
 * D2（r402 CC-376，`docs/mcp-panel-fields.md` §4 S2+S4）：本模块私有的面板字段——只有本文件读写（测试读不算引用者），声明随模块走。
 * 仍是 `PanelValues` 的成员（模块扩充，纯类型、零运行时）；出现第二个**生产**引用者时迁回 `types/catalog.ts`。
 */
declare module '@/types/catalog' {
  interface PanelValues {
    /** 失衡加成百分比（`remielleDazeBonusPct`）：本文件写读 */
    remielleRadiantTurnDazeBonusPct?: number
    /** 拆轮数（用户 2026-10-18）：多飞 N 轮，代价是 N 轮惊鸿降级为垂虹。applyPanel 写、载体侧读 */
    remielleSplitRounds?: number
    /** 每队友槽丢弃的异常次数（applyPanel 写；资源卡与 extraAnomalyRows 读） */
    remielleTeammateDrops?: Record<string, number>
  }
}
