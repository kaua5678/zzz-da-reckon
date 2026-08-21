/**
 * 版本时间线：卡池期（上半/下半）节点 + S 级角色实装版本（agentId → 节点）。
 *
 * 数据来源（用户指定参考，已交叉核对）：
 * - https://zzz.163.moe/banners —— 全 UP/复刻卡池时间轴（S 级：1.0~3.1 全 44 位 + 3.2 测试服 3 位）
 * - B 站「绝区零卡池记录」（2026-08，已更新至 3.1 版本上）—— 上半/下半拆分与 A 级随池
 * - https://zzz.163.moe/endgame —— 危局强袭战期数时间（最新实装期 2026-09，3.1 收尾）
 *
 * 口径（用户拍板）：
 * - **只收 S 级角色**（四星太多不做）；常驻 S（猫又/11号/珂蕾妲/莱卡恩/格莉丝/丽娜）记 1.0-1。
 * - 3.2 节点（佩洛伊斯/克拉蕾/洛克茜）为仓库已收录的测试服数据（未实装/即将实装，note 标注）。
 * - 上半/下半日期：上半 = 版本开始日（来源可靠），下半 = 版本开始 + ~42 天近似（仅展示用，
 *   图表横轴按节点序号，不按日期）。希格莉德 3.1 下半 2026-08-19 已确认（TapTap 卡池公告）。
 *
 * 时间图表页（TimeChartsPage）数据源：队伍演变搜索按「版本节点」增量进行——
 * 每个节点只评估「该节点新实装 S 级角色」组成的候选队伍；队伤只与队伍/Boss/金数有关、
 * 与节点无关，因此增量搜索是精确的（见 composables/teamTimeline.ts 头注释）。
 */

export interface VersionNode {
  /** 节点 id：'2.0-1' = 2.0 上半、'2.0-2' = 2.0 下半、'1.4' = 合并卡池 */
  id: string
  /** 版本号（如 '2.0'） */
  version: string
  /** 卡池形态：'上半' | '下半' | '合并' */
  phaseLabel: string
  /** 展示名（如 '2.0 上半'） */
  label: string
  /** 节点起始日期（YYYY-MM-DD，下半为近似） */
  date: string
  /** 特殊说明（如 3.2 测试服数据未实装） */
  note?: string
}

/** 全部版本节点（有序：越新越靠后） */
export const VERSION_NODES: VersionNode[] = [
  { id: '1.0-1', version: '1.0', phaseLabel: '上半', label: '1.0 上半', date: '2024-07-04', note: '公测' },
  { id: '1.0-2', version: '1.0', phaseLabel: '下半', label: '1.0 下半', date: '2024-07-30' },
  { id: '1.1-1', version: '1.1', phaseLabel: '上半', label: '1.1 上半', date: '2024-08-14' },
  { id: '1.1-2', version: '1.1', phaseLabel: '下半', label: '1.1 下半', date: '2024-09-04' },
  { id: '1.2-1', version: '1.2', phaseLabel: '上半', label: '1.2 上半', date: '2024-09-25' },
  { id: '1.2-2', version: '1.2', phaseLabel: '下半', label: '1.2 下半', date: '2024-10-15' },
  { id: '1.3-1', version: '1.3', phaseLabel: '上半', label: '1.3 上半', date: '2024-11-06' },
  { id: '1.3-2', version: '1.3', phaseLabel: '下半', label: '1.3 下半', date: '2024-11-27' },
  { id: '1.4', version: '1.4', phaseLabel: '合并', label: '1.4 合并', date: '2024-12-18', note: '星见雅&悠真 合并卡池' },
  { id: '1.5-1', version: '1.5', phaseLabel: '上半', label: '1.5 上半', date: '2025-01-22' },
  { id: '1.5-2', version: '1.5', phaseLabel: '下半', label: '1.5 下半', date: '2025-02-12' },
  { id: '1.6-1', version: '1.6', phaseLabel: '上半', label: '1.6 上半', date: '2025-03-12' },
  { id: '1.6-2', version: '1.6', phaseLabel: '下半', label: '1.6 下半', date: '2025-04-02' },
  { id: '1.7-1', version: '1.7', phaseLabel: '上半', label: '1.7 上半', date: '2025-04-23' },
  { id: '1.7-2', version: '1.7', phaseLabel: '下半', label: '1.7 下半', date: '2025-05-14' },
  { id: '2.0-1', version: '2.0', phaseLabel: '上半', label: '2.0 上半', date: '2025-06-06' },
  { id: '2.0-2', version: '2.0', phaseLabel: '下半', label: '2.0 下半', date: '2025-06-27' },
  { id: '2.1-1', version: '2.1', phaseLabel: '上半', label: '2.1 上半', date: '2025-07-16' },
  { id: '2.1-2', version: '2.1', phaseLabel: '下半', label: '2.1 下半', date: '2025-08-06' },
  { id: '2.2-1', version: '2.2', phaseLabel: '上半', label: '2.2 上半', date: '2025-09-04' },
  { id: '2.2-2', version: '2.2', phaseLabel: '下半', label: '2.2 下半', date: '2025-09-25' },
  { id: '2.3-1', version: '2.3', phaseLabel: '上半', label: '2.3 上半', date: '2025-10-15' },
  { id: '2.3-2', version: '2.3', phaseLabel: '下半', label: '2.3 下半', date: '2025-11-05' },
  { id: '2.4-1', version: '2.4', phaseLabel: '上半', label: '2.4 上半', date: '2025-11-26' },
  { id: '2.4-2', version: '2.4', phaseLabel: '下半', label: '2.4 下半', date: '2025-12-17' },
  { id: '2.5', version: '2.5', phaseLabel: '合并', label: '2.5 合并', date: '2025-12-30', note: '照&叶瞬光 合并卡池' },
  { id: '2.6-1', version: '2.6', phaseLabel: '上半', label: '2.6 上半', date: '2026-02-06' },
  { id: '2.6-2', version: '2.6', phaseLabel: '下半', label: '2.6 下半', date: '2026-02-27' },
  { id: '2.7-1', version: '2.7', phaseLabel: '上半', label: '2.7 上半', date: '2026-03-24' },
  { id: '2.7-2', version: '2.7', phaseLabel: '下半', label: '2.7 下半', date: '2026-04-15' },
  { id: '2.8-1', version: '2.8', phaseLabel: '上半', label: '2.8 上半', date: '2026-05-06' },
  { id: '2.8-2', version: '2.8', phaseLabel: '下半', label: '2.8 下半', date: '2026-05-27' },
  { id: '3.0-1', version: '3.0', phaseLabel: '上半', label: '3.0 上半', date: '2026-06-17' },
  { id: '3.0-2', version: '3.0', phaseLabel: '下半', label: '3.0 下半', date: '2026-07-08' },
  { id: '3.1-1', version: '3.1', phaseLabel: '上半', label: '3.1 上半', date: '2026-07-29' },
  { id: '3.1-2', version: '3.1', phaseLabel: '下半', label: '3.1 下半', date: '2026-08-19' },
  { id: '3.2-1', version: '3.2', phaseLabel: '上半', label: '3.2 上半', date: '2026-09-09', note: '测试服数据（未实装/即将实装）' },
]

/** 节点 id → 下标（有序） */
export const VERSION_NODE_INDEX: Record<string, number> = Object.fromEntries(
  VERSION_NODES.map((n, i) => [n.id, i]),
)

/**
 * S 级角色实装节点（agentId → 节点 id）。只收 S 级（用户口径：四星不做），
 * **唯一特例：潘引壶（1421，A 级）**——贯穿拐演变路径必需（仪玄 2.0 上真实起手队 =
 * 仪玄+青衣+潘引壶，2.3 起被同 niche 的卢西娅完全上位替换），随仪玄 2.0 上半实装。
 * 依据 https://zzz.163.moe/banners（S 级首UP时间轴）+ B 站卡池记录（上半/下半拆分）逐期核对：
 * 常驻 S（猫又/11号/珂蕾妲/莱卡恩/格莉丝/丽娜）与 1.0 首期限定（艾莲/朱鸢）同属 1.0。
 * 注：目录里 妮可/苍角/露西 被标成 S 是 catalog 导入 bug（游戏内为四星），
 * 不在此表（时间线只认本表，不受该 bug 影响）；潘引壶已修为 A 且作为特例收录。
 */
export const AGENT_RELEASE_NODE: Record<string, string> = {
  // 1.0 开服（常驻 S + 首期限定）
  '1021': '1.0-1', // 猫又（常驻）
  '1041': '1.0-1', // 11号（常驻）
  '1101': '1.0-1', // 珂蕾妲（常驻）
  '1141': '1.0-1', // 莱卡恩（常驻）
  '1181': '1.0-1', // 格莉丝（常驻）
  '1211': '1.0-1', // 丽娜（常驻）
  '1191': '1.0-1', // 艾莲
  '1241': '1.0-2', // 朱鸢
  // 1.1
  '1251': '1.1-1', // 青衣
  '1261': '1.1-2', // 简
  // 1.2
  '1071': '1.2-1', // 凯撒
  '1171': '1.2-2', // 柏妮思
  // 1.3
  '1221': '1.3-1', // 月城柳
  '1161': '1.3-2', // 莱特
  // 1.4（合并卡池）
  '1201': '1.4', // 悠真
  '1091': '1.4', // 星见雅
  // 1.5
  '1311': '1.5-1', // 耀嘉音
  '1321': '1.5-2', // 伊芙琳
  // 1.6
  '1381': '1.6-1', // 零号·安比
  '1361': '1.6-2', // 扳机
  // 1.7
  '1331': '1.7-1', // 薇薇安
  '1291': '1.7-2', // 雨果
  // 2.0
  '1371': '2.0-1', // 仪玄
  '1421': '2.0-1', // 潘引壶（A 级特例，随仪玄实装；贯穿拐演变路径必需）
  '1391': '2.0-2', // 橘福福
  // 2.1
  '1411': '2.1-1', // 柚叶
  '1401': '2.1-2', // 爱丽丝
  // 2.2
  '1461': '2.2-1', // 席德
  '1301': '2.2-2', // 奥菲丝·马格努森&「鬼火」
  // 2.3
  '1451': '2.3-1', // 卢西娅·艾洛温
  '1051': '2.3-2', // 伊德海莉
  // 2.4
  '1481': '2.4-1', // 琉音
  '1471': '2.4-2', // 般岳
  // 2.5（合并卡池）
  '1341': '2.5', // 照
  '1431': '2.5', // 叶瞬光
  // 2.6
  '1491': '2.6-1', // 千夏
  '1501': '2.6-2', // 爱芮
  // 2.7
  '1511': '2.7-1', // 南宫羽
  '1521': '2.7-2', // 希希芙
  // 2.8
  '1541': '2.8-1', // 普罗米娅
  '1531': '2.8-2', // 星徽·比利
  // 3.0
  '1561': '3.0-1', // 维琳娜
  '1571': '3.0-2', // 诺姆·霍洛维尔
  // 3.1
  '1581': '3.1-1', // 蕾米埃尔
  '1591': '3.1-2', // 希格莉德
  // 3.2（测试服/未实装）
  '1551': '3.2-1', // 佩洛伊斯
  '1611': '3.2-1', // 克拉蕾
  '1621': '3.2-1', // 洛克茜
}

/** 角色实装节点 id；未知角色（四星/未收录）返回 null */
export function releaseNodeOf(agentId: string): string | null {
  return AGENT_RELEASE_NODE[agentId] ?? null
}

/** 节点 id 有序下标；未知节点返回 -1 */
export function nodeIndexOf(nodeId: string): number {
  return VERSION_NODE_INDEX[nodeId] ?? -1
}

/** 从某节点（含）到最新节点的切片 */
export function nodesFrom(nodeId: string): VersionNode[] {
  const i = nodeIndexOf(nodeId)
  return i < 0 ? [] : VERSION_NODES.slice(i)
}
