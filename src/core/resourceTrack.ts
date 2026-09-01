/**
 * 时间轴资源轨（对轴模块第一步：喧响轨，用户口径 2026-08-31）。
 *
 * 背景：引擎资源结算是「整局总量口径」——喧响池 ÷ 3000 = 大招次数，不知道第 N 次
 * 失衡窗口开启时资源够不够。实战中喧响随时间回复（3000 上限封顶、溢出浪费）、
 * 进失衡窗口放清喧响（大招），窗口开早了资源没攒够就放不出大。总量口径会把
 * 后段窗口的大招也算进去 → 虚高。
 *
 * 模型（时间轴口径，均匀回复）：
 * - 180s 战斗按失衡窗口切分为「轴外段 ↔ 失衡窗(18s)」交替的时间线；
 * - 喧响轨：rate = 整局回复总量 / 180s，轴外段按线性累计、到 3000 上限截断
 *   （截断部分记 wasted——回复被上限浪费）；
 * - 每次进窗：若当前喧响 ≥ 3000 → 放大招、清空到 0；否则该窗大招削减（不清空，
 *   继续攒给下一窗）；
 * - 窗内动作本身也产喧响（轴内数据行），按窗口时长折算进回复。
 * - 失衡次数本身不受资源轨影响（失衡池总量口径不变，本轨只决定每窗大招放不放）。
 *
 * 后续：能量/闪能轨（120 上限，进窗不足 → 削减部分招式）在同框架上扩展。
 */

/** 喧响上限（大招消耗，与 ULTIMATE_COST_DEFAULT 同值；单独导出避免引擎反向依赖） */
export const DECIBEL_TRACK_CAP = 3000

export interface ResourceTrackWindow {
  /** 窗口在整局时间线上的起点（秒，0-180） */
  start: number
  /** 窗口时长（秒） */
  duration: number
}

export interface DecibelTrackResult {
  /** 每个窗口的大招是否放行（index 对齐输入窗口） */
  ultimateByWindow: boolean[]
  /** 实际放出的大招数 */
  ultimateCount: number
  /** 被削减的大招数 */
  ultimateCut: number
  /** 回复被上限截断浪费的喧响量 */
  wasted: number
  /** 时间线结束时的剩余喧响（未用完） */
  remaining: number
  /** 诊断明细（每窗的进窗喧响值） */
  windowDetail: Array<{ enter: number; exit: number; ultimate: boolean }>
}

/**
 * 喧响时间轨推演。
 * @param windows     失衡窗口列表（按时间顺序；start 递增）
 * @param totalRegen  整局喧响回复总量（现有引擎 decibelSource.total 减去 initialGift 的口径）
 * @param battleTime  战斗时长（默认 180）
 * @param initial     t=0 初始喧响（进场赠送 initialDecibelGift 等；缺省 0）
 */
export function simulateDecibelTrack(
  windows: ResourceTrackWindow[],
  totalRegen: number,
  battleTime = 180,
  initial = 0,
): DecibelTrackResult {
  const duration = Math.max(1, battleTime)
  const rate = Math.max(0, totalRegen) / duration
  let current = Math.min(DECIBEL_TRACK_CAP, Math.max(0, initial))
  let wasted = 0
  const ultimateByWindow: boolean[] = []
  const windowDetail: DecibelTrackResult['windowDetail'] = []

  const sorted = [...windows].sort((a, b) => a.start - b.start)
  let timeline = 0
  for (const win of sorted) {
    // 轴外段（上一窗口结束 → 本窗口开始）：线性回复 + 上限截断
    const gap = Math.max(0, win.start - timeline)
    const regen = rate * gap
    if (current + regen > DECIBEL_TRACK_CAP) {
      wasted += current + regen - DECIBEL_TRACK_CAP
      current = DECIBEL_TRACK_CAP
    } else {
      current += regen
    }
    // 进窗判定：够 3000 放大招清空；不够削减（保留继续攒）
    const ultimate = current >= DECIBEL_TRACK_CAP - 1e-9
    const enter = current
    if (ultimate) current = 0
    windowDetail.push({ enter, exit: current, ultimate })
    ultimateByWindow.push(ultimate)
    // 窗内：时间照走（窗内动作产喧响已含在 totalRegen 均匀口径里，不重复计）
    timeline = win.start + win.duration
  }
  // 尾段：剩余时间回复（没有下一窗，攒着也放不出 → 计入浪费口径之外的剩余）
  const tail = Math.max(0, duration - timeline)
  current = Math.min(DECIBEL_TRACK_CAP, current + rate * tail)

  const ultimateCount = ultimateByWindow.filter(Boolean).length
  return {
    ultimateByWindow,
    ultimateCount,
    ultimateCut: ultimateByWindow.length - ultimateCount,
    wasted,
    remaining: current,
    windowDetail,
  }
}
