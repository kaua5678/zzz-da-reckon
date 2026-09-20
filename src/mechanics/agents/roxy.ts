import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterResourceResult, RoxyWindEnergySource } from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecEventExecutions } from '@/specs/mechanics'

/**
 * 洛克茜（1621）v12 重录（2026-09-03，nanoka 3.2.12+18601660）：
 * - 核心被动·热夜初拥（Lv.7 原文）：每消耗 25 点能量获得 1 点[风能]（上限 3 点）；
 *   初始能量自动回复 >1.2 时，每超过 0.01 攻击 +5（上限 960）、冲击 +0.4（上限 76.8）；
 *   恕不远送命中[风化] → [浸染]还原、队友[浸染]增益按职业等：依赖风化队伍，未建模（note）。
 * - 额外能力·辉金心脏（强攻/命破/锋御队友）：自身伤害 +8%+1.2%/级（Lv.7 = 15.2%）；
 *   攻击命中 → 失衡易伤倍率 +30%（至失衡结束，满覆盖近似）+ 失衡时长 +2s；
 *   敌方[风化]时风/浸染直伤 +8%（按风化覆盖率近似全伤通道）；进场回 40 能量（勘域 180s）；
 *   风化延长 20s（无数值）；强特后异常积蓄效率 +30%（50s，满覆盖近似，未接）。
 * - 资源循环（v12）：小心风寒（1621007，10 能量启动 +30/s 自旋）→ 结束自动 敬请安息（1621023）
 *   消耗全部[风能]（每 1 点 = 额外 1621021 一段 + 生成 1 个[风眼]，上限 9 同时存在、30s 自爆/超限最早引爆）；
 *   风眼爆鸣 1621022；敬请安息后场上+自身≥3 → 自动 恕不远送（1621005，引爆至多 3 个风眼：
 *   3 个同命中 → 巨旋风 1621020（1s）；不足 → 小旋风 1621019（1s/个，v12 = 1 秒）；终结技 +1 点[风能]。
 * - 影画：C1 敬请安息命中 → 全抗-15%（50s）+ 自身暴伤+40%；C2 小心风寒失衡易伤 +30%（v12：旧 25% → 30%）
 *   + 流势/自旋维持（机动向不建模）；C4 招架+1/闪反+2 能量 + 终结 +20% 伤（失衡+10% 未单接）；
 *   C6 无视 15% 风抗（v12：旧 20% → 15%）+ 巨旋风 ×250%（失衡+20% 未单接）+ [余响]每次引爆额外 2 次
 *   巨旋风——该式是**共同上界**（单向高估、不可能低估；精确值受原文未给的时长/节拍参数阻塞，已登记 debt）。
 */
const ROXY_AGENT_ID = '1621'
/** 风能：每 25 能量 +1 点（核心被动 Lv.7），存量上限 3；终结技额外 +1 点 */
export const ENERGY_PER_WIND_ENERGY = 25
export const WIND_ENERGY_MAX = 3
/** 敬请安息每消耗 1 点[风能]：额外 1621021（52.5%）+ 生成 1 个[风眼] */
export const WIND_EYE_PER_ENERGY = 1
export const WIND_EYE_MAX = 9
/** 恕不远送：引爆至多 3 个风眼；3 个同命中 → 巨旋风（1621020）；不足 → 小旋风（1621019，1s/个） */
export const SEND_OFF_BURST_MAX = 3
export const MINI_TORNADO_SECONDS = 1
/** moveId（v12）：小心风寒/自旋每秒/敬请安息/额外段/风眼爆鸣/小旋风每秒/巨旋风每秒/恕不远送/终结 */
const EX_CHILL_MOVE_ID = '1621007'
const SPIN_SECOND_MOVE_ID = '1621008'
const REST_PEACE_MOVE_ID = '1621023'
const PER_ENERGY_EXTRA_MOVE_ID = '1621021'
const EYE_BURST_MOVE_ID = '1621022'
const MINI_TORNADO_MOVE_ID = '1621019'
const MEGA_TORNADO_MOVE_ID = '1621020'
const SEND_OFF_MOVE_ID = '1621005'
const ROXY_ULT_MOVE_ID = '1621012'
/** 影画1：敬请安息命中 → 全抗-15%（50s）+ 自身暴伤+40% */
export const ROXY_C1_CRIT_DMG = 40
export const ROXY_C1_RES_REDUCTION = 15
/** 影画2：小心风寒命中 → 失衡易伤+30%（v12：旧 25% → 30%）+ 小心风寒失衡值+5% */
export const ROXY_C2_STUN_VULN = 30
export const ROXY_C2_EX_CHILL_DAZE_BONUS = 5
/** 影画4：招架回1/闪反回2 能量 + 终结技伤害+20%（失衡值+10%） */
export const ROXY_C4_PARRY_ENERGY = 1
export const ROXY_C4_DODGE_ENERGY = 2
export const ROXY_C4_ULT_DMG = 20
export const ROXY_C4_ULT_DAZE_BONUS = 10
/** 影画6：无视 15% 风抗（v12：旧 20% → 15%）+ 巨旋风倍率 ×250%（失衡值+20%）+ 余响 2 次/引爆（上界） */
export const ROXY_C6_WIND_RES_REDUCTION = 15
export const ROXY_C6_MEGA_TORNADO_MULT = 2.5
export const ROXY_C6_MEGA_DAZE_BONUS = 20
export const ROXY_C6_ECHO_BURSTS = 2
/** 额外能力：自身伤害 +8%+1.2%/级（Lv.7 = 15.2%）；进场回 40 能量 */
export const ROXY_AA_DMG_BONUS_LV7 = 8 + 1.2 * 6
export const ROXY_AA_ENTER_ENERGY = 40
/** 转模：初始能量回复 >1.2 → 每 0.01：攻击 +5（上限 960）、冲击 +0.4（上限 76.8） */
export const ROXY_REGEN_ATK_PER_0_01 = 5
export const ROXY_REGEN_ATK_CAP = 960
export const ROXY_REGEN_IMPACT_PER_0_01 = 0.4
export const ROXY_REGEN_IMPACT_CAP = 76.8

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const category of skills.categories) {
    const move = category.moves.find(item => item.id === moveId)
    if (move) return move
  }
  return null
}

function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  return move.rows.find(row => row.id === rowId)?.values[0] ?? 0
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** engine 侧同款读取器（`buildResourceResult` 的入参是 `CharacterOperationConfig`，不是 `AgentCharConfigInput`） */
function cfgRate(cfg: unknown, id: string, fallback = 1): number {
  const value = Number((cfg as Record<string, unknown> | undefined)?.[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

/** spec `adjustable` 的比例统一钳到 `[0, 2]`（与 spec 声明的 min/max 同源；缺省 1 = 旧口径） */
function clampRate(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? Math.max(0, Math.min(2, num)) : 1
}

/** 两条 `adjustable` 的 id（spec 声明与本模块消费同源引用，规则 11 单一事实源） */
export const ROXY_WIND_ENERGY_RATE_ID = '1621.roxy_wind_energy.wind_energy_per_30_energy.rate'
export const ROXY_WIND_EYE_RATE_ID = '1621.roxy_wind_eye.wind_eye_from_cannon.rate'

/**
 * 洛克茜风能/风眼资源（v12 + 用户手法 2026-09-03）：
 * 手法：强特长按（小心风寒→自旋）直到获得 3 风能就松手 → 敬请安息消耗全部风能。
 * 每轮强特 = 风能 +3（自旋 75 能量 = 2.5s × 30/s → 每 25 能量 +1 ×3）+ 终结技 +1；
 * 每轮敬请安息消耗 3 点（= 3 额外段 1621021 + 3 风眼）→ 恕不远送 = floor(消耗/3) = 每轮 1 次巨旋风（1s），
 * 无余数（3/轮 手法下小旋风恒 0，留作余数兜底）。
 */
export function computeRoxyWindEnergy(input: {
  exSpecialCount: number
  exSpecialEnergyConsume?: number
  ultimateCount?: number
  spinSeconds?: number
  cinemaLevel?: number
  /** 风能转化率（spec `adjustable`，缺省 1）——缩放「每轮耗能」这一侧，见下 */
  energyRate?: number
  /** 风眼转化率（spec `adjustable`，缺省 1）——缩放「风能 → 风眼」的生成数，见下 */
  eyeRate?: number
}): RoxyWindEnergySource {
  const exCount = Math.max(0, Math.floor(input.exSpecialCount))
  const spinSeconds = Math.max(0, Number(input.spinSeconds ?? 2.5))
  const cinema = Math.max(0, Math.floor(Number(input.cinemaLevel ?? 0)))
  const energyRate = clampRate(input.energyRate)
  const eyeRate = clampRate(input.eyeRate)
  // 每轮自旋耗能 = 自旋秒 × 30/s（+ 10 启动）；风能 = 每 25 能量 +1，手法按 3 点/轮攒满
  // ⚠ `ENERGY_PER_WIND_ENERGY = 25` 是**原文口径**（nanoka 3.2 raw 的 passive Lv.1~7 逐字 7 处
  // 「每消耗25点能量，获得1点[风能]」，3.3.3 构建同样 25）。spec `1621.json` 曾写「30」= 2026-08-04
  // 一份 scratch 摘要（`data/raw/_archive/scratch/spec_notes_1621.txt:4`）的**笔误**，
  // `docs/MECHANICS_IMPLEMENTATION.md:149` 早已记为「旧口径已废除」⇒ **不要**把 25 改成 30
  // （R51 隔离 worktree 实测：改成 30 ⇒ `roxy`/`specialMechanics` 5 failed，全管线伤害 −1.59%）。
  const energySpentTotal = exCount * (10 + spinSeconds * 30)
  // `adjustable` 的计数源就是「每消耗 N 点能量」⇒ 比例必须乘在**耗能**这一侧（不是 gain）：
  // 乘 gain 会让 `energySpentTotal`（有独立执行行 `totalEnergyConsume`）与风能脱钩 ⇒ 双账。
  const energyPerRound = (spinSeconds * 30 + 10) * energyRate
  const windEnergyGain = exCount * Math.floor(energyPerRound / ENERGY_PER_WIND_ENERGY)
    + Math.max(0, Math.floor(Number(input.ultimateCount ?? 0)))
  // 存量上限 3：每发敬请安息至多消耗 3 点 → 总消耗 = min(总获得, 强特次数 × 3)
  const windEnergyConsumed = Math.min(windEnergyGain, exCount * WIND_ENERGY_MAX)
  // ── 风眼账本（R51 用户裁决「对该资源进行建模，计数，回复和消耗」）──────────────────
  // 原文 `special.description[3]`：「每消耗1点[风能]，在攻击后额外造成一次风属性伤害，
  // 并在原地生成1个[风眼]」⇒ 风眼**生成数 = 消耗的风能点数 × WIND_EYE_PER_ENERGY**（本条 = 回复侧）。
  const windEyeGenerated = Math.floor(windEnergyConsumed * WIND_EYE_PER_ENERGY * eyeRate + 1e-9)
  // ⚠ **恕不远送与大小旋风必须从「风眼数」推，不能从「风能消耗」推**：原文 `description[1]`
  // 的触发条件是「场上[风眼]和自身[风能]共计至少3个」⇒ 消耗侧是**风眼**。
  // 默认 `eyeRate=1` 且 `WIND_EYE_PER_ENERGY=1` 时 `windEyeGenerated === windEnergyConsumed`
  // ⇒ 本式与旧式 `floor(windEnergyConsumed / 3)` **逐位相同**（改的是口径来源不是数值）。
  // ── 风眼「同时存量≤9 / 30s 自然引爆 / 超限最早引爆」时序口径（R52 收口，原 debt 销号）──────
  // 原文 `special.description[4]`：「持续30秒后自动引爆；最多同时存在9个，超出上限后**最早生成**的
  // 会自动引爆」= FIFO 队列 + 逐事件计时。R52 把逐事件队列**真建出来**跑闸门（全库 5702 次引擎求值：
  // 105 预设 + 60 角色 × 命座 0/3/4/5/6），结论 = **默认手法下本式与真队列逐位相同**，理由是结构性的：
  //   单发风眼上界 = `min(WIND_ENERGY_MAX=3, floor(单轮耗能/25))` ≤ 3；
  //   而每次恕不远送恰引爆 `SEND_OFF_BURST_MAX`=3 ⇒ 队**每发清空**，队列长度恒 ≤ 3 < 9
  //   ⇒ 9 上限与 30s 自爆**结构性不可达**（不是「影响小」，是「到不了」）。
  // 默认 `spinSeconds=2.5` ⇒ 单轮耗能 10+75=85 ⇒ `floor(85/25)`=3 ⇒ 风眼数恒为 3 的倍数
  // ⇒ 连余数项都恒 0 ⇒ 本式**就是**原文语义的精确解，不是近似。
  // ⚠ 两个**滑块域**边界（默认域之外仍是近似；逐事件真值需要引擎没有的「逐发绝对时刻」）：
  //   ① `eyeRate > 4/3`（spec `adjustable` 上限 2）⇒ 单发可 > 3 ⇒ 9 上限真的咬合，本式**高估**
  //      （本文件夹具实测 `rate=2`：本式 so=86 / FIFO so=43）；
  //   ② `spinSeconds < 65/30`（≈2.1667）⇒ 单发 1~2 ⇒ 局末留 1~2 个未触发的眼，本式把余数计成
  //      小旋风而 FIFO 判其未发动 ⇒ 小旋风偏乐观（本文件夹具实测 `spin=0.5`：本式 mini=2 / FIFO=0）。
  // ⚠ 为什么不把真队列落进引擎：`buildExecutions`/`buildResourceResult` 的入参只有**整局总量**
  // （`IterationState` 无逐动作时刻、`SkillExecution` 无时间戳），轴内 `StunAxisAction.startTime`
  // 也只是**相对窗口起点**、窗口绝对时刻全仓无生产者 ⇒ 落真队列必须**编造**发次间隔，那等于把
  // 未建模假设写进伤害数（R52 侦察的实测证据，见 `.claude/PROMPT-handoff-round52.md` §3）。
  // ⚠ 同样刻意**不**把 `WIND_EYE_MAX` 当总量上限用：那是「同时存在」上限，按总量钳会让
  // `sendOffCount` 从 38 塌成 3（R51 侦察实测）——属把时序约束误当总量约束，比不建模更错。
  // @fact agent:1621/风眼时序 近似: 「同时存量≤9 / 30s 自然引爆」在默认手法下**结构性不可达**（单发风眼 ≤ WIND_ENERGY_MAX=3 < 9，且每发恕不远送清空队列）⇒ `sendOffCount = floor(windEyeGenerated/SEND_OFF_BURST_MAX)` 是精确解而非近似；天花板 = 滑块域 `eyeRate>4/3`（单发>3 ⇒ 9 上限咬合，本式高估）与 `spinSeconds<65/30`（局末余留眼被本式计成小旋风） | 据 nanoka 3.2 raw special.description[4]@2026-09-20·R52 全库 5702 次引擎求值零 delta@2026-09-20 | 验 src/mechanics/__tests__/roxyWindEyeTiming.test.ts | 锚 src/mechanics/agents/roxy.ts#computeRoxyWindEnergy | 信 确认
  // ⟳复核: 引擎若获得「逐发绝对时刻」通道（或在 eyeRate>1 滑块域落地真 FIFO 队列）时复核本近似边界 | 到期 2027-03-31
  const sendOffCount = Math.floor(windEyeGenerated / SEND_OFF_BURST_MAX)
  // ── 影画6 [余响]：**方向可证 / 幅度不可定**（R53 收口，取代 R52 的「方向未定」）────────────
  // 原文 `talent.6.desc`（`data/raw/nanoka_missing/full/1621.json:2119`；EN 同构
  // 「A Giant Windstorm is generated at the target's location every 3s, for a total of 2
  //  additional Giant Windstorms. Repeated triggers stack the number of additional Giant
  //  Windstorm **instances** generated and refresh the duration of Afterecho.」）：
  //   「[特殊技：恕不远送]引爆[风眼]生成巨型风旋时，主目标会被赋予[余响]效果，**每间隔3秒**在目标
  //     位置生成一次巨型风旋，**共额外生成2次**巨型风旋，重复触发时额外生成次数**叠加**且**刷新**
  //     [余响]的持续时间」。
  //
  // ★【定理·方向已定】「共额外生成2次」= **每次触发至多追加 2 次** ⇒ 无论「叠加/刷新」怎么解释，
  //   总量恒 ≤ `2 × 引爆数` ⇒ **本式是所有自洽读法的共同上界** ⇒ 本式**只可能高估，不可能低估**。
  //   （R53 把 4 种读法 × 7 个时长 × 全网格共 4224 次求值全部验过，零越界；见
  //    `src/mechanics/__tests__/roxyEchoTiming.test.ts` 的 `echoUpperBoundHolds`。）
  //   ⇒ 这一条**纠正 R52-J1 记的「方向未定」**：方向是定的（单向高估），未定的只是**幅度**。
  //
  // ⚠【阻塞·幅度不可定】精确值取决于两个**任何可达源都没给出**的参数：
  //   ① [余响] **持续时间 D**——原文只说「刷新持续时间」，**从不给秒数**；
  //   ② 「每间隔3秒」是**每实例各自计时**还是**目标身上单一节拍**——双语只把「叠加」的对象写成
  //      `instances`、把「刷新」的对象写成 `duration`，**没说节拍归谁**。
  //   实测分歧（本文件夹具 n=43、跨度 45.86s）：D=6 ⇒ 17 次 / D=12 ⇒ 19 / D=30 ⇒ 25 /
  //   D=180 ⇒ 60 / 逐实例独立 ⇒ 86 ⇒ **合法区间 [17, 86]，跨度 5.1×**。
  //   ⇒ 落「精确值」必须**编造 D**，那正是 R52 立下的纪律所禁止的（把未建模假设写进伤害数比
  //     留着有界近似更坏）⇒ 正解 = **保留上界 + 把幅度登记为 debt + 挂 ⟳复核**。
  //   ⚠ 与 R52 风眼那条的区别：风眼是**证明到不了**（结构性不可达 ⇒ 销号）；本条是**到得了但算不准**
  //     （有界高估 ⇒ 登记 debt）。**两者结论不同，别互相照抄。**
  // @fact agent:1621/余响时序 近似: [余响] 每次恕不远送至多追加 2 次巨型风旋（原文「共额外生成2次」）⇒ `megaTornadoCount = sendOffCount × (1 + 2)` 是**所有自洽读法的共同上界**（4 读法 × 7 时长 × 全网格 4224 次求值零越界）⇒ 本式**单向高估、不可能低估**（纠正 R52-J1 的「方向未定」）；天花板 = 精确值需 [余响] 持续秒数 D 与「3s 节拍归属」（每实例 vs 单状态），二者**原文与全部可达外部源均未给出**（nanoka 中英双语、noun_3.2.3.json、fandom/prydwen/game8/hakush 全查不到）⇒ 合法区间实测 [17, 86]（默认夹具 n=43），落精确值必须编造 D | 据 nanoka 3.2 raw talent.6.desc@2026-09-20·R53 全库对账+4 读法穷举@2026-09-20 | 验 src/mechanics/__tests__/roxyEchoTiming.test.ts | 锚 src/mechanics/agents/roxy.ts#computeRoxyWindEnergy | 信 高
  // ⟳复核: 官方若补充 [余响] 持续秒数或 buff 表（可裁决「3s 节拍归属」）时，用真逐事件时间轴替换本上界并销 debt | 到期 2027-03-31
  // debt: 余响总量口径天花板 「每间隔3秒生成一次 / 共额外生成2次 / 次数叠加且刷新持续时间」是时序约束，
  // 总量口径只能给出**共同上界** `2×引爆数`（单向高估，已证不可能低估）；精确值需原文未给出的
  // 持续秒数 D 与节拍归属，实测合法区间 [17, 86]（5.1×）⇒ 溢出/排队浪费未建模。升级路径 = 拿到
  // [余响] 的 buff 表定义（D + 节拍归属）或用户裁决该读法后落逐事件时间轴
  // （登记于 check-guards DEBT_REGISTRY；口径与证据见上方 `@fact agent:1621/余响时序`）。
  const megaTornadoCount = sendOffCount + (cinema >= 6 ? sendOffCount * ROXY_C6_ECHO_BURSTS : 0)
  const miniTornadoCount = Math.max(0, windEyeGenerated - sendOffCount * SEND_OFF_BURST_MAX)

  return {
    energySpentTotal,
    windEnergyGain,
    windEnergyCap: WIND_ENERGY_MAX,
    windEnergyConsumed,
    windEyeGenerated,
    windEyeDestroyed: windEyeGenerated,
    sendOffCount,
    megaTornadoCount,
    miniTornadoCount,
    miniTornadoSeconds: miniTornadoCount * MINI_TORNADO_SECONDS,
    spinSeconds,
    note: 'v12+手法（用户 2026-09-03）：长按强特攒满 3 风能（自旋 2.5s×30/s≈75 能量）松手 → 敬请安息消耗 3（3 额外段+3 风眼）→ 恕不远送 1 次巨旋风（1s）；终结技 +1 风能。',
  }
}

function buildRoxyCharConfig({ skills, cfg, cinemaLevel }: AgentCharConfigInput): void {
  cfg.skipGenericExSpecial = true
  const record = cfg as unknown as Record<string, unknown>
  record.roxyCinemaLevel = cinemaLevel ?? 0
  // v12 moveIds
  record.roxyExChillMoveId = findMoveById(skills, EX_CHILL_MOVE_ID)?.id ?? ''
  record.roxySpinSecondMoveId = findMoveById(skills, SPIN_SECOND_MOVE_ID)?.id ?? ''
  record.roxyRestPeaceMoveId = findMoveById(skills, REST_PEACE_MOVE_ID)?.id ?? ''
  record.roxyPerEnergyExtraMoveId = findMoveById(skills, PER_ENERGY_EXTRA_MOVE_ID)?.id ?? ''
  record.roxyEyeBurstMoveId = findMoveById(skills, EYE_BURST_MOVE_ID)?.id ?? ''
  record.roxyMiniTornadoMoveId = findMoveById(skills, MINI_TORNADO_MOVE_ID)?.id ?? ''
  record.roxyMegaTornadoMoveId = findMoveById(skills, MEGA_TORNADO_MOVE_ID)?.id ?? ''
  record.roxySendOffMoveId = findMoveById(skills, SEND_OFF_MOVE_ID)?.id ?? ''
  record.roxySpinSeconds = Math.max(0, cfgSetting(cfg, 'roxy.spinSeconds', 2))
  record.roxySpinSecondDamage = getRowValue(findMoveById(skills, SPIN_SECOND_MOVE_ID), 'damage')
  // 自旋喧响表值（1621008 decibel_recovery，每秒口径——与同行 damage 已录的「每秒 × spinSeconds」口径一致；
  // 行值经 decibelRecoveryOverride 跳过表值回填，见 buildRoxyExecutions）
  record.roxySpinSecondDecibel = getRowValue(findMoveById(skills, SPIN_SECOND_MOVE_ID), 'decibel_recovery')
  cfg.mechanicRowValues = {
    [PER_ENERGY_EXTRA_MOVE_ID]: getRowValue(findMoveById(skills, PER_ENERGY_EXTRA_MOVE_ID), 'damage'),
    [EYE_BURST_MOVE_ID]: getRowValue(findMoveById(skills, EYE_BURST_MOVE_ID), 'damage'),
    [MINI_TORNADO_MOVE_ID]: getRowValue(findMoveById(skills, MINI_TORNADO_MOVE_ID), 'damage'),
    [MEGA_TORNADO_MOVE_ID]: getRowValue(findMoveById(skills, MEGA_TORNADO_MOVE_ID), 'damage'),
    [SEND_OFF_MOVE_ID]: getRowValue(findMoveById(skills, SEND_OFF_MOVE_ID), 'damage'),
  }
  // 影画4：招架支援回1能量/次 + 闪避反击回2能量/次（招式内至多1次）
  if ((cinemaLevel ?? 0) >= 4) {
    const energy = (cfg.parryCount ?? 0) * ROXY_C4_PARRY_ENERGY + (cfg.dodgeCounterCount ?? 0) * ROXY_C4_DODGE_ENERGY
    if (energy > 0) cfg.initialEnergyGift = Number(cfg.initialEnergyGift ?? 0) + energy
  }
  // 额外能力·辉金心脏：进场回 40 能量（勘域 180s 一次 → 每局一次；门控未接，note）
  cfg.initialEnergyGift = Number(cfg.initialEnergyGift ?? 0) + ROXY_AA_ENTER_ENERGY
  // 影画失衡值（v12 原文「失衡值提升」）：预缩倍率表 daze 值，patchRoxyExecutions 经 dazeMultiplierOverride 精确结算
  if ((cinemaLevel ?? 0) >= 2) {
    record.roxyExChillDaze = getRowValue(findMoveById(skills, EX_CHILL_MOVE_ID), 'daze') * (1 + ROXY_C2_EX_CHILL_DAZE_BONUS / 100)
  }
  if ((cinemaLevel ?? 0) >= 4) {
    record.roxyUltDaze = getRowValue(findMoveById(skills, ROXY_ULT_MOVE_ID), 'daze') * (1 + ROXY_C4_ULT_DAZE_BONUS / 100)
  }
  if ((cinemaLevel ?? 0) >= 6) {
    record.roxyMegaDaze = getRowValue(findMoveById(skills, MEGA_TORNADO_MOVE_ID), 'daze') * (1 + ROXY_C6_MEGA_DAZE_BONUS / 100)
  }
}

function applyRoxyPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  // 核心被动转模（v12）：初始能量回复 >1.2 → 每 0.01：攻击 +5（上限960）、冲击 +0.4（上限76.8）
  const regen = Math.max(0, Number((panel as any).energyRegen ?? 1.2) - 1.2)
  const atkBonus = Math.min(ROXY_REGEN_ATK_CAP, Math.round((regen / 0.01) * ROXY_REGEN_ATK_PER_0_01))
  const impactBonus = Math.min(ROXY_REGEN_IMPACT_CAP, (regen / 0.01) * ROXY_REGEN_IMPACT_PER_0_01)
  if (atkBonus > 0) panel.atk = (panel.atk ?? 0) + atkBonus
  if (impactBonus > 0) panel.impact = (panel.impact ?? 0) + impactBonus
  // 额外能力：自身伤害 +15.2%（Lv.7；门控由团队条件，面板统一施加——无强攻/命破/锋御队略高估，note）
  panel.dmgBonus = (panel.dmgBonus ?? 0) + ROXY_AA_DMG_BONUS_LV7
  const cinema = cinemaLevel ?? 0
  if (cinema >= 1) {
    panel.critDmg = (panel.critDmg ?? 0) + ROXY_C1_CRIT_DMG
    panel.enemyResReduction = (panel.enemyResReduction ?? 0) + ROXY_C1_RES_REDUCTION
  }
  if (cinema >= 2) {
    panel.stunDmgMultiplierBonus = (panel.stunDmgMultiplierBonus ?? 0) + ROXY_C2_STUN_VULN
  }
  if (cinema >= 6) {
    panel.enemyWindResReduction = (panel.enemyWindResReduction ?? 0) + ROXY_C6_WIND_RES_REDUCTION
  }
}

function buildRoxyResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const record = cfg as unknown as Record<string, unknown>
  return {
    roxyWindEnergySource: computeRoxyWindEnergy({
      exSpecialCount: state.exSpecialCount,
      exSpecialEnergyConsume: cfg.exSpecialEnergyConsume,
      ultimateCount: state.ultimateCount,
      spinSeconds: Number(record.roxySpinSeconds ?? 0),
      cinemaLevel: Number(record.roxyCinemaLevel ?? 0),
      // ⚠ 两处调用点（buildResourceResult / buildExecutions）都**必须**传这两个 rate：
      // 只传一处会让「账本」与「执行行」分叉（行数按未缩放生成、账本按缩放生成）。
      energyRate: cfgRate(cfg, ROXY_WIND_ENERGY_RATE_ID),
      eyeRate: cfgRate(cfg, ROXY_WIND_EYE_RATE_ID),
    }),
  }
}

function buildRoxyExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const source = computeRoxyWindEnergy({
    exSpecialCount: state.exSpecialCount,
    exSpecialEnergyConsume: cfg.exSpecialEnergyConsume,
    ultimateCount: state.ultimateCount,
    spinSeconds: Number(record.roxySpinSeconds ?? 0),
    cinemaLevel: Number(record.roxyCinemaLevel ?? 0),
    energyRate: cfgRate(cfg, ROXY_WIND_ENERGY_RATE_ID),
    eyeRate: cfgRate(cfg, ROXY_WIND_EYE_RATE_ID),
  })
  const exCount = Math.max(0, Math.floor(state.exSpecialCount))
  if (exCount > 0) {
    // 小心风寒（1621007）+ 自旋（1621008 每秒）+ 敬请安息（1621023）
    executions.push({
      moveId: EX_CHILL_MOVE_ID, moveName: '强化特殊技：小心风寒', category: 'special',
      count: exCount, actionTime: 0, comboAlignRatio: 0,
      totalTime: 0, totalComboAlignTime: 0,
      energyConsume: 10, totalEnergyConsume: exCount * 10,
      energyRecovery: 0, totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
    const spinMoveMult = Number((cfg as unknown as Record<string, unknown>).roxySpinSecondDamage ?? 0)
    const spinDecibelPerSec = Number(record.roxySpinSecondDecibel ?? 0)
    if (source.spinSeconds > 0) {
      // @fact agent:1621/自旋喧响每秒口径 口径: 自旋(1621008)倍率表 damage=2608.6 与 decibel_recovery=84.343 同为「每秒」值——damage 侧已按 每秒×spinSeconds 录入并被 roxy 测试锁定，喧响同构：行值=84.343×spinSeconds/次、总=×exCount；表值直填会把持续段少算 spinSeconds 倍，故 decibelRecoveryOverride 跳过 enrich 表值覆盖 | 据 catalog 1621008 行值+damage 侧已录口径@2026-09-08 | 验 src/core/__tests__/decibelRowParity.test.ts | 锚 src/mechanics/agents/roxy.ts#SPIN_SECOND_MOVE_ID | 信 高
      executions.push({
        moveId: SPIN_SECOND_MOVE_ID, moveName: '自旋（每秒，耗能 30/s）', category: 'special',
        count: exCount, actionTime: 0, comboAlignRatio: 0,
        totalTime: 0, totalComboAlignTime: 0,
        energyConsume: 0, totalEnergyConsume: 0,
        decibelRecovery: spinDecibelPerSec * source.spinSeconds,
        totalDecibelRecovery: exCount * spinDecibelPerSec * source.spinSeconds,
        decibelRecoveryOverride: true,
        energyRecovery: 0, totalEnergyRecovery: 0,
        timeBucket: 'backstage',
        damageMultiplier: spinMoveMult * source.spinSeconds,
        damageMultiplierOverride: true,
      })
    }
    executions.push({
      moveId: REST_PEACE_MOVE_ID, moveName: '强化特殊技：敬请安息（风炮）', category: 'special',
      count: exCount, actionTime: 0, comboAlignRatio: 0,
      totalTime: 0, totalComboAlignTime: 0,
      energyConsume: 0, totalEnergyConsume: 0,
      energyRecovery: 0, totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }
  const spec = getAgentSpec(ROXY_AGENT_ID)
  if (!spec) return
  const generated = buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts: {
      roxyPerEnergyExtraCount: source.windEnergyConsumed,
      roxyEyeBurstCount: source.windEyeGenerated,
      roxySendOffCount: source.sendOffCount,
      roxyMiniTornadoSeconds: source.miniTornadoSeconds,
      roxyMegaTornadoCount: source.megaTornadoCount,
    },
    getRowValue: (moveId, rowId) => (rowId === 'damage' ? ((cfg as any).mechanicRowValues?.[moveId] ?? 0) : 0),
  })
  executions.push(...generated)
}

function patchRoxyExecutions({ cfg, state: _state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.roxyCinemaLevel ?? 0)))
  for (const exec of executions) {
    // 影画2：小心风寒（1621007）失衡值 +5%
    if (cinema >= 2 && exec.moveId === EX_CHILL_MOVE_ID) {
      const d = Number(record.roxyExChillDaze ?? 0)
      if (d > 0) {
        exec.dazeMultiplier = d
        exec.dazeMultiplierOverride = true
      }
    }
    if (cinema >= 4 && exec.moveId === ROXY_ULT_MOVE_ID) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + ROXY_C4_ULT_DMG
      // 影画4：终结技（1621012）失衡值 +10%
      const d = Number(record.roxyUltDaze ?? 0)
      if (d > 0) {
        exec.dazeMultiplier = d
        exec.dazeMultiplierOverride = true
      }
    }
    // 影画6：巨型风旋（1621020）倍率 ×250%（含余响生成行，共用 moveId）失衡值 +20%
    if (cinema >= 6 && exec.moveId === MEGA_TORNADO_MOVE_ID) {
      exec.damageMultiplier = (exec.damageMultiplier ?? 0) * ROXY_C6_MEGA_TORNADO_MULT
      exec.damageMultiplierOverride = true
      const d = Number(record.roxyMegaDaze ?? 0)
      if (d > 0) {
        exec.dazeMultiplier = d
        exec.dazeMultiplierOverride = true
      }
    }
  }
}

function buildRoxyResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.roxyWindEnergySource
  if (!source) return []
  return [
    {
      id: 'roxy-wind-energy',
      title: '洛克茜风能',
      summary: `风能 +${source.windEnergyGain} · 敬请安息消耗 ${source.windEnergyConsumed} · 风眼 × ${source.windEyeGenerated}`,
      rows: [
        { label: '强特/终结耗能', value: `${fmt(source.energySpentTotal)}`, detail: '每 25 能量获得 1 点风能（核心被动 Lv.7）+ 终结技 +1' },
        { label: '风能获取', value: `+${source.windEnergyGain}`, detail: '存量上限 3（每发敬请安息至多消耗 3）' },
        { label: '敬请安息消耗', value: `-${source.windEnergyConsumed}`, detail: '每点 = 额外 1621021 一段 + 生成 1 个风眼' },
      ],
      footer: source.note,
    },
    {
      id: 'roxy-wind-eye',
      title: '洛克茜风眼·恕不远送',
      summary: `风眼 ${source.windEyeGenerated} · 恕不远送 × ${source.sendOffCount} · 巨旋风 ${source.megaTornadoCount} · 小旋风 ${source.miniTornadoSeconds}s`,
      rows: [
        { label: '风眼生成', value: `${source.windEyeGenerated} 个`, detail: `同时存在上限 ${WIND_EYE_MAX}（默认手法下单发 ≤ 3 ⇒ 结构性不可达）、30s 自爆/超限最早引爆（爆鸣 1621022 × ${source.windEyeDestroyed}）` },
        { label: '恕不远送', value: `${source.sendOffCount} 次`, detail: '敬请安息后场上+自身≥3 → 自动发动（引爆至多 3 个风眼）' },
        { label: '巨型风旋', value: `${source.megaTornadoCount} 次`, detail: '3 个风眼同时命中 → 巨旋风（1621020）持续 1 秒；影画6 ×250%' },
        { label: '微型风旋', value: `${fmt(source.miniTornadoSeconds)}s`, detail: '不足 3 个的余数 → 小旋风（1621019）1s/个' },
      ],
      footer: 'v12 口径；余响（影画6 每 3s 额外 2 次巨旋风）按「2×引爆数」计——该式是共同上界（单向高估），精确值受原文未给的时长/节拍参数阻塞，见模块 @fact agent:1621/余响时序。',
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'roxy.spinSeconds',
    label: '洛克茜自旋秒数',
    description: '手法（用户 2026-09-03）：长按强特到获得 3 风能就松手 = 自旋 75 能量/30每秒 = 2.5 秒；自旋每秒 2608.6% 风伤。',
    default: 2.5,
    min: 0,
    max: 10,
    step: 0.5,
    suffix: '秒',
  },
]

export const roxyMechanic: AgentMechanicModule = {
  id: 'agent:roxy',
  agentIds: [ROXY_AGENT_ID],
  name: '洛克茜',
  description: 'v12：风能（25能量/点+终结+1）→ 敬请安息（消耗全部，每点额外段+1风眼）→ 风眼爆鸣/恕不远送（引爆至多3 → 巨旋风或小旋风）+ 自旋每秒伤害；核心转模（能量回复>1.2→攻击/冲击）；C1 全抗-15%/暴伤+40%、C2 易伤+30%、C4 回能+终结+20%、C6 风抗15%+巨旋风×250%。',
  applyPanel: applyRoxyPanel,
  buildCharConfig: buildRoxyCharConfig,
  buildExecutions: buildRoxyExecutions,
  patchExecutions: patchRoxyExecutions,
  buildResourceResult: buildRoxyResourceResult,
  resourceSections: buildRoxyResourceSections,
  settings,
}
