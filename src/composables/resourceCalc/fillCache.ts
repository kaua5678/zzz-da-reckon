/**
 * 边际填充搜索（`useResourceCalc#computeWithFill`）的**跨渲染缓存**（2026-11-10）。
 *
 * ## 为什么需要
 * 对「留白 > 1s」的队，`computeWithFill` 要额外跑 1~2 次**完整顶层求值**（每个候选 = 一整条外层不动点 +
 * 可行性降配扫描；实测 roxy 这类「搜了但被拒」的队一次交互 ~6s = 3 次顶层求值）。
 * 这段成本只取决于一份确定的输入，而真实交互里同一份输入会被反复求值：
 *  - 搜索型调用方（时间权重分配 / 难度爬梯 / 散点 / 队伍对比）反复「改 → 读 → 改回」；
 *  - 外层 `calcOutputMemo` 只有 16 格（`CALC_OUTPUT_MEMO_MAX`），105 队级别的扫描一轮就把早先的配置
 *    挤出去 —— 回访时外层 miss，填充搜索整段重跑；
 *  - 外层键里有几项**引擎零读点却会换键**（`timeWeightStrategy` / `subStatAllocationManual` /
 *    `appliedBoss.at`）⇒ 「引擎输入一模一样」的两次求值外层照样 miss。
 *
 * ## 与外层 `calcOutputMemo` 的分工（两层互不替代）
 * | 层 | 缓存什么 | 键的粒度 |
 * |---|---|---|
 * | `calcOutputMemo`（既有） | 整条 calcOutput | `configStore.$state` **整体** JSON + 目录身份（宁可多失效） |
 * | 本模块（新增） | **填充搜索本身**（基线 + 候选 + 护栏判定） | 只取**引擎真正读到的**输入（逐项登记，见下） |
 *
 * 本层比外层窄，所以它能在「外层 miss 但引擎输入没变」时接住求值。命中直接返回上一次的 `CalcRoundResult`
 * （同一引用；调用方 `freezeCached` 已把它深冻结）。引擎对同一输入**逐位确定**
 * （`@fact engine:热启动逐位透明`，判据 `landingPointUniqueness` / `allAgentsGuards` ③ 的历史无关性）
 * ⇒「命中 vs 未命中」必须逐位相同，由 `marginalFill.test.ts` 的零漂移用例钉住（逐字段 `toBe`）。
 *
 * ## 键的形状（为什么不是「整个 state」）
 * 用户口径：**不得**把 store 对象本身当键、**不得**把整个 state 深拷贝后当键——那样既说不清「改哪个输入会失效」，
 * 又会被上面那几项粗项打死命中率。这里反过来：**逐项白名单**。
 *  - state 侧 = `FILL_CACHE_KEYED_STATE_KEYS`（引擎读到的每一项）+ `FILL_CACHE_IRRELEVANT_STATE_KEYS`（不读的，
 *    每条带判据）。两张表并集 **必须等于** `Object.keys(configStore.$state)` —— 新增 state ref 忘了登记就红
 *    （`marginalFill.test.ts`「键覆盖登记」用例；漏登记 = 静默错值的经典形态）。
 *  - 引擎输入派生面**直接取 `ResourceCalcConfig` 的产物**：`characters[i].panel` / `outOfCombatPanel`
 *    （build 阶段面板，含天赋 / 音擎 / 驱动盘 / 队友 buff 的全部折算）＋预算标量 ⇒ 派生输入不必逐条登记。
 *  - 目录三张表的**对象身份**（与 `calcOutputMemo` 同一枚 `identityOf` 序号）、行融合规则快照、
 *    队友 buff 就绪位、引擎探针旗标取值（`PROBE_STUN_*` 是 A/B 口径开关，同配置换口径必须 miss）。
 *
 * ## LRU 容量怎么定的（实测，不是拍脑袋）
 * 模块级（与 `calcOutputMemo` 同款：全部实例共享）、容量 `FILL_CACHE_MAX`、命中即提到队尾、超限淘汰**最旧**。
 *
 * 实测（2026-11-10，同一 store + 同一 calc，逐槽 `setAgent` 装配，外层记忆化关、只量本层）：
 * | 容量 | 20 队 × 3 轮 | 102 队 × 2 轮（全库扫描） |
 * |---|---|---|
 * | 32 | 19 命中 / 1 未命中队（66.1%） | **0%**（淘汰 171 次，回访时全被挤掉） |
 * | 64 | 同上 | **0%**（淘汰 139 次） |
 * | **128** | 同上 | **49.8%**（102 条全留得住，第二轮整轮命中） |
 * ⇒ 取 128：本仓「重复求值」的旗舰形态就是全库扫描（timeGolden / timeFillRatchet / 难度曲线 / 散点），
 * 102 个不同配置一轮就超过 64，小容量在该形态下图腾锁死、全是淘汰。内存上界 = 128 × 实测
 * **≈126 KB/条**（`gc` 后保留堆增量，102 条实测 12.54 MB）≈ **16 MB**，有界、可回收，换来全库扫描
 * 第二轮 51× 墙钟（12.6s → 0.25s，外层关时）。
 *
 * ⚠ 诚实读数：**单队交互**（外层开着，改滑块往返）本层命中率是 **0%** —— 外层 `calcOutputMemo` 键更宽
 * （整份 `$state`）且先被问，同一配置的重复读全被它接住（实测 20 次往返：外层 37 命中 / 3 未命中，
 * 本层 0 命中）。本层的价值只在「外层 miss 而引擎输入没变」的三类场合：① 外层容量 16 装不下的多队扫描；
 * ② 外层键里的粗项变了（`timeWeightStrategy` / `appliedBoss.at`）；③ 探针 / 判据显式关外层做 A/B。
 * 本层**不**为这三类去动键（键仍是「引擎真正读到的全部输入」，一项不减）。
 *
 * ## 开关与计数
 * `setCalcOutputMemoEnabled(false)`（测试对拍用）会**连本层一起关**并清空——对拍要的是 HEAD 的「真求值」口径，
 * 只关外层的话本层仍会把上次结果还回来，判据就退化成恒等式。要单独量本层（命中率 / 2,0,0）用
 * `setFillCacheEnabled(true)` 在外层关掉之后再打开它。
 * 计数经 `useResourceCalc#getCalcOutputMemoStats().fill` 对外；`candidates` = 真正跑过的**候选**求值次数
 * ——「同一配置连续求值 3 次 = 2,0,0」这条判据数的就是它。
 */
import type { CalcRoundResult } from './roundResult'
import { probeFlag } from '@/core/probeTrace'

/**
 * 容量上限（LRU）。**超限淘汰最旧**（`Map` 插入序：队首最旧；命中先 delete 再 set 提到队尾）。
 * 取值理由见文件头「LRU」段。改这个数 = 改内存与命中率，必须同步跑一次 `marginalFill` 的墙钟对比。
 */
export const FILL_CACHE_MAX = 128

/**
 * **进键**的 state 项（`configStore.$state` 键名）——引擎一次求值里读到的全部 state。
 *
 * ⚠ 新增 state ref 必须登记进本表或 `FILL_CACHE_IRRELEVANT_STATE_KEYS`；并集 == `$state` 由测试断言。
 */
export const FILL_CACHE_KEYED_STATE_KEYS = [
  /** 队伍：agentId / 命座 / 潜能（天赋档） / 音擎与精炼 / 驱动盘 / 全部交互次数 / 平A权重 / 连携次数 */
  'team',
  /** 敌人：失衡值 / 无敌时间 / 锁定失衡次数 / 失衡时长 / 倍率 / 防御 / 抗性 / 战斗时间 / 秽盾 / 能量盾 */
  'enemy',
  /** 全局 buff（结算侧伤害 + 队伍 buff 行） */
  'globalBuffs',
  /** 队友 buff 选择与手调覆盖率（进面板） */
  'teammateBuffSelections',
  'teammateBuffManualCoverages',
  /** 音擎 / 驱动盘效果覆盖率手调表（进面板） */
  'wEngineEffectCoverages',
  'discEffectCoverages',
  /** 资源利用率覆盖（进每槽 cfg） */
  'resourceUtilization',
  /** 机制参数（getMechanicSetting 的全部读点：时停投影 / 保底 / 控制技槽位 / 副词条预算 …） */
  'mechanicSettings',
  /** 队伍级机制参数（getTeamMechanicSetting） */
  'teamMechanicSettings',
  /** 异常积蓄利用率 / 异常结算份额 */
  'anomalyUtilizationRates',
  'anomalySettlementShares',
  /** 失衡轴三件套 + 仪玄自动轴开关（resolveAxes / autoPreset 读） */
  'stunAxes',
  'stunAxisPlans',
  'useStunAxis',
  'autoYidhariAxis',
  /** 手动锁定交互（非轴降配整块门控） */
  'interactionsLocked',
  /** 逐招合轴比例覆盖（buildCharConfig 读） */
  'comboAlignOverrides',
  /** 当前 Boss 预设（弹刀反推三项 / 控制技组 / 喧响赠礼） */
  'appliedBoss',
] as const

/**
 * **不进键**的 state 项（引擎一次求值都不读它）——每条必须写明判据，别为了消红把引擎读到的项挪进来
 * （那就是「为命中率放宽键」）。
 */
export const FILL_CACHE_IRRELEVANT_STATE_KEYS: Readonly<Record<string, string>> = {
  /**
   * 时间权重策略：只被 `timeWeightAllocation`（它改的是 `team[i].basicAttackTimeWeight`，已在键里的 `team`）
   * 与难度曲线读；引擎侧零读点 —— `grep -rn 'timeWeightStrategy' src/composables/resourceCalc src/core` = 0。
   */
  timeWeightStrategy: '纯策略项：只决定 timeWeightAllocation 往 team.basicAttackTimeWeight 写什么（team 已进键）；引擎零读点',
  /**
   * 副词条「被手改过」标记：只是 config store 里 watcher 的判据（改预算设置时是否覆盖该槽），引擎侧零读点；
   * 真正的分配数值在 `team[i].driveDisc.subStatAllocation`（已进键）。
   */
  subStatAllocationManual: '纯界面判据：决定改预算时是否覆盖该槽；引擎零读点，分配数值在 team[i].driveDisc 里',
}

/** 键版本号：键的形状变了就 +1（旧条目自然作废，不写迁移） */
const FILL_CACHE_KEY_VERSION = 1

/** 命中 / 未命中 / 旁路 / 候选求值 / 基线求值 / 淘汰计数（模块级，与 LRU 一样跨实例共享） */
export const fillCacheStats = {
  hits: 0,
  misses: 0,
  /** 缓存关着时的求值次数（`setCalcOutputMemoEnabled(false)` 的对拍口径） */
  bypass: 0,
  /** 真正跑过的**候选**求值次数（基线之外的额外顶层求值）——判据 ① 数这个 */
  candidates: 0,
  /** 真正跑过的**基线**求值次数（不含候选） */
  baselines: 0,
  /** 因超限被淘汰的最旧条目数（LRU 生效的计数面） */
  evictions: 0,
  /** 当前条目数（写路径同步维护；测试读它断言「不超上限」） */
  size: 0,
}

const fillCache = new Map<string, CalcRoundResult>()
let fillCacheOn = true

/**
 * 开关。生产恒开；两个非生产用法：
 *  ① `setCalcOutputMemoEnabled(false)` 内部会关掉本层（对拍要 HEAD 的真求值口径）；
 *  ② 缓存测试在关掉外层之后再单独打开本层，量「纯重复求值 = 2,0,0」。
 */
export function setFillCacheEnabled(on: boolean): void {
  fillCacheOn = on
}

/** 当前开关（`computeWithFill` 在算键之前先问一句：关着就不必序列化 state，A/B 对拍零额外开销） */
export function fillCacheEnabled(): boolean {
  return fillCacheOn
}

/**
 * 引擎行为受这些探针旗标影响（`solveTeam` 的 A/B 口径开关）。旗标进程内可变（测试会 `=off`
 * 复现改动前读数）⇒ 取值必须进键，否则「同配置换口径」会命中旧口径的结果。
 */
function engineFlagSignature(): string {
  return [
    probeFlag('PROBE_STUN_CONT_TRUNC'),
    probeFlag('PROBE_STUN_STABLE_BAND'),
    probeFlag('PROBE_STUN_NEXT'),
    probeFlag('PROBE_STUN_CONT_COV'),
    probeFlag('PROBE_STUN_CLIP_ITER'),
  ].join('|')
}

/** 键的构成（全部字段都在入参里 ⇒「改一个值键就变」可以单测，不必起引擎） */
export interface FillCacheKeyInput {
  /** `configStore.$state`（只按 `FILL_CACHE_KEYED_STATE_KEYS` 逐项取） */
  state: Record<string, unknown>
  /** 目录三张表的对象身份（整体替换才变） */
  catalogIdentity: number
  teammateBuffGroupsIdentity: number
  buildRecommendationsIdentity: number
  /** 队友 buff 就绪位：未就绪时 resourceConfig 为 null，就绪前后数值不同 */
  teammateBuffsReady: boolean
  /** 行融合规则快照（store 之外的全局响应式输入） */
  rowFusionRules: unknown
  /** `base.characters[i].panel` / `outOfCombatPanel`：build 阶段面板（含天赋 / 音擎 / 驱动盘 / 队友 buff） */
  panels: readonly unknown[]
  /** `ResourceCalcConfig` 的预算标量 + 锁定失衡次数（`computeCalcOutput` 的另外几个入参） */
  engineScalars: readonly unknown[]
}

const KEYED_STATE_SET: ReadonlySet<string> = new Set(FILL_CACHE_KEYED_STATE_KEYS)

/**
 * 登记校验（**生产路径也跑**）：`$state` 出现既不在「进键表」也不在「不读表」里的键 ⇒ 直接抛。
 *
 * 为什么放在运行时而不是只放在测试里：漏登记 = 静默错值（新 state ref 影响引擎、但键里没有它 ⇒
 * 换了值仍命中旧结果），这类缺陷正是本仓最贵的形态。`stores/config.ts#createConfigModel` 对
 * `initialState` 用同一手法（未登记键直接抛）。22 个键的字符串比对，比一次 `JSON.stringify` 便宜两个数量级。
 */
function assertRegistryCovers(state: Record<string, unknown>): void {
  for (const key of Object.keys(state)) {
    if (KEYED_STATE_SET.has(key)) continue
    if (key in FILL_CACHE_IRRELEVANT_STATE_KEYS) continue
    throw new Error(`fillCache: config.$state 的键「${key}」未登记——请加进 FILL_CACHE_KEYED_STATE_KEYS（引擎会读）或 FILL_CACHE_IRRELEVANT_STATE_KEYS（引擎不读，写明判据）`)
  }
}

/** 构造键（纯函数：同入参 ⇒ 同串；`$state` 的键必须先通过登记校验） */
export function fillCacheKey(input: FillCacheKeyInput): string {
  assertRegistryCovers(input.state)
  return JSON.stringify([
    FILL_CACHE_KEY_VERSION,
    FILL_CACHE_KEYED_STATE_KEYS.map(k => [k, input.state[k]]),
    input.catalogIdentity,
    input.teammateBuffGroupsIdentity,
    input.buildRecommendationsIdentity,
    input.teammateBuffsReady,
    input.rowFusionRules,
    input.panels,
    input.engineScalars,
    engineFlagSignature(),
  ])
}

/**
 * 读缓存（命中就把它提到队尾 = LRU；返回同一结果对象）。
 *
 * 缓存关着时返回 `undefined`（= 未命中），**不计数**：`bypass` 由唯一的生产分支
 * `computeWithFill` 数（它在算键之前就早退了），在这里再数一遍会把同一次求值记两次。
 */
export function fillCacheLookup(key: string): CalcRoundResult | undefined {
  if (!fillCacheOn) return undefined
  const hit = fillCache.get(key)
  if (hit === undefined) { fillCacheStats.misses++; return undefined }
  fillCache.delete(key)
  fillCache.set(key, hit)
  fillCacheStats.hits++
  return hit
}

/** 写缓存（超限淘汰**最旧**；深冻结由调用方 `freezeCached` 负责，与 `calcOutputMemo` 同款） */
export function fillCacheStore(key: string, out: CalcRoundResult): void {
  if (!fillCacheOn) return
  fillCache.set(key, out)
  while (fillCache.size > FILL_CACHE_MAX) {
    fillCache.delete(fillCache.keys().next().value!)
    fillCacheStats.evictions++
  }
  fillCacheStats.size = fillCache.size
}

/**
 * 清空条目（**不清计数**：判据一律用「快照差」读计数，与 `getCalcOutputMemoStats` 的用法一致）。
 * 调用点：`setCalcOutputMemoEnabled(false)`（回到 HEAD 的真求值口径）与缓存测试的 beforeEach。
 */
export function resetFillCache(): void {
  fillCache.clear()
  fillCacheStats.size = 0
}
