/**
 * 环境膨胀 vs 角色强度（新图表的数据服务）——纯函数，零引擎求值、零 store 依赖。
 *
 * ## 回答什么问题
 * 「Boss 血量在涨，新角色有没有跟上？」——把两条**同轴**曲线画在一起：
 *   ① **环境膨胀指数**：按版本聚合的危局/防卫战 Boss 平均血量（归一到首个观测版本 = 100%）；
 *   ② **角色强度锚**：每位限定 S 在其**首池版本**的强度指标（当前 = 版本直伤系数，
 *      来自 `buildDirectDamageTimeline`，与 Chart「限定S首次UP × 版本直伤系数」同源）。
 * 两条线的**相对位置**就是结论：角色强度线持续高于环境线的区段 = 该期新角色「跑赢膨胀」。
 *
 * ## ⚠ 强度轴的口径警告：`版本直伤系数` **不是**角色强度（实测证伪）
 * 首版曾想直接拿 `buildDirectDamageTimeline` 的 `value` 当强度轴去与环境指数相除。
 * **实测证伪**：该值是**支援突击伤害比**（一个设计锚点，衡量「这名角色的支援突击相对标准表
 * 的倍率档」），全库 43 个点里 34 个恒为 ~1.000，只在特定倍率设计处跳档
 * （2.5 合并 1.273 / 2.6 起 1.181 / 3.2 上半 2.068）。用它当「角色强度随时间」会得出
 * 「全库只有 2 人跑赢膨胀（且都是 1.4 的悠真/星见雅，vs=1.0009）」——这个结论**没有意义**，
 * 因为它衡量的不是强度增长。
 *
 * ⇒ **本模块只负责环境侧（`buildInflationSeries`，数据完备、可独立验证）**；
 *   角色侧「跟上与否」的正确度量是 **`hpRatio`（伤害 ÷ 当期 Boss 血量，100% = 击杀）**——
 *   它需要**引擎求值**（`computeNewCharacterPoints` / `computeSlotComparePoints` 同族），
 *   属页面级异步流程，不在本纯函数模块里做。
 *   `buildReleaseStrengths` 保留但**只作「首池节点 ↔ 环境指数」的对照表**（回答「这名角色
 *   实装时环境已膨胀到几成」），**不要**再把 `strengthVsEnvironment` 当结论用——
 *   它的分子是设计锚点不是强度。字段保留是为了页面仍能显示「实装时环境 = X%」这一事实。
 *
 * ## 单位（踩过，务必分清）
 * `DirectDamagePoint.value` 是**比值**（1.0 = 100%，页面显示时才 ×100），而本模块的
 * `InflationPoint.index` 是**百分数**（100 = 首版本）。两者**不同量纲**，直接相除会得到
 * 0.01 这种荒谬值（实测：全库 35 个角色都算出 vs=0.01）。
 * 故 `valuePct` 一律先 ×100 归一到百分数；但**即便归一正确，分子口径仍是错的**（见上）。
 *
 * ## 为什么用「平均血量」而不是「版本系数」（口径，别混）
 * `hpVersionCoeff` 是**同一 Boss 跨期的缩放系数**，实测同版本内不同 Boss 的 `hp/coeff`
 * 比值 CV = 56.9%（Lv70，n=159）⇒ 它**不是**绝对血量，跨 Boss 求平均没有意义。
 * 绝对量在 `phase.hp`：按 `modeType` 分组后每版本稳定 9 个样本（defense 141 期相 / 16 版本），
 * 故本模块的膨胀指数一律走 `hp`。
 *
 * ## 模式隔离（口径）
 * `defense`（防卫战）与 `critical_assault`（危局）**血量量级差 3 倍以上**（实测
 * defense ~200M vs critical_assault ~650M），混在一起求平均会被样本数少的一方带偏。
 * 故 `modeType` 是**必填的分组键**：默认只看 defense（样本最全、覆盖 16 个版本），
 * critical_assault 单独可选。
 *
 * ## 覆盖率的诚实处理
 * 早期版本某些 Boss 尚未登场 ⇒ 每版本样本数 `n` 会 < 满编。**该版本标 `lowSample`**，
 * 由调用方区分显示（不静默当成等权平均——6 个样本的均值与 9 个的不在同一置信度上）。
 * 判定用**自校准**口径（`isLowSample`：样本数 < 本序列最大样本数），实测标记 2.4（n=6 < 满编 9）。
 */
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'
import { AGENT_RELEASE_NODE, VERSION_NODES, nodeIndexOf } from '@/data/versionTimeline'
import type { DirectDamagePoint } from '@/composables/multiplierCoefficients'

/** 纳入膨胀指数的模式（危局血量量级与防卫战差 3 倍，混算会失真） */
export const INFLATION_MODES = ['defense', 'critical_assault'] as const
export type InflationMode = typeof INFLATION_MODES[number]

/** 绝对下限：样本数低于此值判「数据不足」（连一个可用的平均值都撑不起） */
export const MIN_SAMPLES_PER_VERSION = 6

/**
 * lowSample 判定 = **样本数 < 该序列里的最大样本数**（自校准），而非固定阈值。
 *
 * 为什么自校准（2026-09-14 实测踩到）：首版用固定阈值 `samples < 6`，而真实数据里
 * 2.4 版本恰好 n=6 —— **等于阈值 ⇒ 不被标记**，于是「低样本版本」机制在真实数据上
 * **一条都不触发**（vacuous），而文档却写着「2.4 是低样本」。固定阈值还两头不讨好：
 * 数据补全后满编从 9 变 12，阈值又失效。
 * 自校准口径 = 「哪个版本没凑齐该有的 Boss 数」——2.4 的 6 < 满编 9 ⇒ 正确标记。
 * 样本数全相等（数据稀疏或极完整）时无人被标记 = 合理（没有相对短板）。
 */
export function isLowSample(samples: number, maxSamples: number): boolean {
  return samples < maxSamples
}

/** 环境膨胀的一个版本点 */
export interface InflationPoint {
  version: string
  /** 版本序号（用于排序与 x 轴） */
  versionIndex: number
  /** 该版本该模式的 Boss 平均血量（绝对值） */
  avgHp: number
  /** 参与平均的期相数（满编 9；不足 = 有 Boss 尚未登场） */
  samples: number
  /** samples < MIN_SAMPLES_PER_VERSION（置信度低于其他点，图上应区分显示） */
  lowSample: boolean
  /** 归一化指数（= avgHp / 首版本 avgHp × 100；首版本 = 100） */
  index: number
  /** 环比增幅（相对上一版本，%）；首个版本为 null */
  momPct: number | null
  /** 该版本内的起止日期（取全部样本的 min/max begin） */
  begin: string
}

/** 角色在其首池版本的强度锚（与膨胀指数同轴可叠） */
export interface ReleaseStrengthPoint {
  agentId: string
  agentName: string
  nodeId: string
  nodeLabel: string
  version: string
  nodeIndex: number
  /** 首池版本的膨胀指数（用于「强度 vs 环境」比值） */
  environmentIndex: number | null
  /** 强度指标原始值（**比值**，1.0 = 100%，与 directDamageChart 同量纲）；null = 无支援突击样本 */
  value: number | null
  /** 强度指标的百分数形式（= value × 100，与 environmentIndex 同量纲，可直接比） */
  valuePct: number | null
  /**
   * 强度 / 环境 = valuePct ÷ environmentIndex（**两侧都是百分数**）。
   * **>1 = 该角色首池时强度跑赢当期环境**（双基准口径：两边都归一到各自起点）。
   * value 或 environmentIndex 缺失 → null（不猜）。
   */
  strengthVsEnvironment: number | null
}

export interface InflationSeries {
  mode: InflationMode
  /** 按版本序号升序 */
  points: InflationPoint[]
  /** 首版本 id（index = 100 的基准） */
  baseVersion: string
  /** 末版本相对首版本的累计膨胀（%，如 292.3 = 涨到 2.92 倍） */
  cumulativePct: number
}

/** 版本号 → 序号（用 VERSION_NODES 的顺序；未收录的版本排到最后并保持字典序） */
function versionOrder(version: string): number {
  const node = VERSION_NODES.find(n => n.version === version)
  return node ? nodeIndexOf(node.id) : 10_000
}

/**
 * 构建环境膨胀指数序列。
 *
 * @param presets boss-presets.json 的 `bosses`（每条的 `phases[]` 带 `hp`/`modeType`/`begin`）
 * @param mode 纳入的模式（默认 defense）
 */
export function buildInflationSeries(
  presets: ReadonlyArray<Pick<BossPreset, 'phases'>>,
  mode: InflationMode = 'defense',
): InflationSeries {
  // 收集 (version → hp[])
  const buckets = new Map<string, { hp: number[]; begins: string[] }>()
  for (const b of presets) {
    for (const p of b.phases ?? []) {
      if (p.modeType !== mode) continue
      const hp = p.hp
      if (!Number.isFinite(hp) || hp <= 0) continue
      let bucket = buckets.get(p.version)
      if (!bucket) { bucket = { hp: [], begins: [] }; buckets.set(p.version, bucket) }
      bucket.hp.push(hp)
      if (p.begin) bucket.begins.push(p.begin)
    }
  }
  const versions = [...buckets.keys()].sort((a, b) => versionOrder(a) - versionOrder(b) || a.localeCompare(b))
  const baseVersion = versions[0] ?? ''
  const baseAvg = baseVersion ? avg(buckets.get(baseVersion)!.hp) : 0
  // 自校准基准 = 本序列里最全的那个版本的样本数（见 isLowSample）
  const maxSamples = versions.reduce((m, v) => Math.max(m, buckets.get(v)!.hp.length), 0)

  const points: InflationPoint[] = []
  let prevAvg: number | null = null
  for (const v of versions) {
    const bucket = buckets.get(v)!
    const avgHp = avg(bucket.hp)
    const begins = bucket.begins.slice().sort()
    points.push({
      version: v,
      versionIndex: versionOrder(v),
      avgHp,
      samples: bucket.hp.length,
      lowSample: isLowSample(bucket.hp.length, maxSamples),
      // baseAvg = 0（空输入）时不产生 NaN：index 记 100（无信息，调用方按 points.length 判空）
      index: baseAvg > 0 ? (avgHp / baseAvg) * 100 : 100,
      momPct: prevAvg && prevAvg > 0 ? (avgHp / prevAvg - 1) * 100 : null,
      begin: begins[0] ?? '',
    })
    prevAvg = avgHp
  }
  const last = points[points.length - 1]
  return {
    mode,
    points,
    baseVersion,
    cumulativePct: last ? last.index : 100,
  }
}

function avg(xs: ReadonlyArray<number>): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * 把「角色首池节点」锚到膨胀曲线上。
 *
 * ⚠ **本函数的输出不是「角色有没有跟上膨胀」的答案**——见文件头「强度轴的口径警告」：
 * 传入的 `strength[*].value` 是**支援突击倍率锚点**（全库 34/43 恒为 1.000），不是强度。
 * 它现在只服务一件事：**「这名角色实装时，环境已膨胀到首版本的百分之几」**（`environmentIndex`），
 * 这是个纯环境侧事实，与分子口径无关。
 *
 * 口径：
 * - 角色取其**首池节点**（`AGENT_RELEASE_NODE`），节点的 `version` 去膨胀序列里找同版本点；
 * - 找不到同版本（角色实装版本不在 Boss 数据覆盖范围内）→ `environmentIndex = null`，
 *   **不插值也不外推**（外推会给一个没有数据支撑的结论）；
 * - `strengthVsEnvironment` **保留但勿用作结论**（分子口径见上）。
 *
 * @param strength 首池节点列表（如 `buildDirectDamageTimeline` 的输出）
 * @param series 膨胀序列（须与 strength 同一 mode 口径）
 */
export function buildReleaseStrengths(
  strength: ReadonlyArray<DirectDamagePoint>,
  series: InflationSeries,
): ReleaseStrengthPoint[] {
  const byVersion = new Map(series.points.map(p => [p.version, p]))
  const nodeVersion = new Map(VERSION_NODES.map(n => [n.id, n.version]))
  return strength.map(s => {
    const version = nodeVersion.get(s.nodeId) ?? ''
    const env = byVersion.get(version)
    // 单位归一：value 是比值（1.0 = 100%），×100 后才能与 environmentIndex 相除
    const valuePct = s.value == null ? null : s.value * 100
    return {
      agentId: s.agentId,
      agentName: s.agentName,
      nodeId: s.nodeId,
      nodeLabel: s.nodeLabel,
      version,
      nodeIndex: s.nodeIndex,
      environmentIndex: env ? env.index : null,
      value: s.value,
      valuePct,
      strengthVsEnvironment:
        env && valuePct != null && env.index > 0 ? valuePct / env.index : null,
    }
  })
}

/**
 * ⚠ **不要用本函数下「多少人跑赢膨胀」的结论**（分子口径已证伪，见文件头）。
 * 保留它只为统计「环境已走到哪」这一侧：末版本累计膨胀、以及各角色实装时的环境水位分布。
 */

export function summarizeInflationRace(points: ReadonlyArray<ReleaseStrengthPoint>) {
  const scored = points.filter(p => p.strengthVsEnvironment != null)
  const ahead = scored.filter(p => p.strengthVsEnvironment! > 1)
  return {
    scored: scored.length,
    ahead: ahead.length,
    behind: scored.length - ahead.length,
    aheadPct: scored.length > 0 ? (ahead.length / scored.length) * 100 : null,
    /** 跑赢最多的三名（降序） */
    top: ahead.slice().sort((a, b) => b.strengthVsEnvironment! - a.strengthVsEnvironment!).slice(0, 3),
  }
}

/** 便捷入口：直接从 boss-presets.json 的解析结果建序列（页面加载后调一次） */
export function buildInflationFromFile(file: BossPresetFile | null | undefined, mode: InflationMode = 'defense') {
  return buildInflationSeries(file?.bosses ?? [], mode)
}

/** 首池节点 id → 该角色实装版本（供页面按版本过滤用；与 AGENT_RELEASE_NODE 同源） */
export function releaseVersionOf(agentId: string): string | null {
  const nodeId = AGENT_RELEASE_NODE[agentId]
  if (!nodeId) return null
  return VERSION_NODES.find(n => n.id === nodeId)?.version ?? null
}
