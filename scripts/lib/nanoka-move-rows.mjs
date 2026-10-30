/**
 * nanoka 全量 JSON（`data/raw/nanoka_missing/full/<id>.json`）→ **招式数值行**的单一事实源。
 *
 * 为什么收在这里（2026-10-30）：同一套口径有两个消费方，各抄一份必然在下一次口径订正时分叉
 * （本仓历史上 critRate / 异常精通 / actionTime 都这么错过一次）：
 *   ① `scripts/import-nanoka-beta-agent.mjs` —— 整片重建 catalog 切片的骨架导入；
 *   ② `scripts/sync-nanoka-agent-rows.mjs` —— **热更增量同步**：只改数值行，保住名字、
 *      gachabase 补充列（gash/sharpness）与其它产物（level60 补充字段）——整片重建会把这些抹掉。
 *
 * 口径（原文见 `docs/DATA_FETCHING.md`「gachabase 倍率口径」与坑条）：
 * - Lv12 = (main + growth × 11) / 100（damage_percentage / stun_ratio）；
 *   energy = sp_recovery / 10000；decibel = fever_recovery / 10000；
 *   anomaly = attribute_infliction / 100；ether = ether_purify（原始刻度，动作时间口径用）。
 * - **同一 moveId 会在多个展示 param 行各带一份完整参数**（伤害行 / 失衡行）⇒ **取首次出现，勿累加**。
 * - 能量消耗**不在 param 数值字典里**：同 entry 下独立展示行（name 含「能量消耗」，desc 是「N点」文本），
 *   归属 = 该行之前最近的带 id param 行的 moveId（历史坑：每 moveId 只取首次会把耗能行整个漏掉）。
 */
import { remapTemplateMoveId } from './move-elements.mjs'

/** 招式分类的抓取顺序（与 catalog 的 skillType 同口径） */
export const MOVE_CATS = ['basic', 'dodge', 'special', 'chain', 'assist']

export function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 去掉 `(Test1)` 之类的占位前缀 */
export function stripPrefix(s) {
  return String(s ?? '').replace(/^\(Test\d+\)/, '').trim()
}

/** moveId 占位模板残留重映射（实现见 lib/move-elements.mjs） */
export const remapMoveId = remapTemplateMoveId

/**
 * 秽盾口径 = `import-nanoka-missing.actionTime`（输入为爬虫刻度 ether = raw/100）：
 * 秽盾 = 动作时间 × 100 + 类型加成（闪反 +1.5 / 弹刀 +2.5 / 终结 +5）→ 按中文名识别类型折减。
 */
export function actionTime(etherRaw, zhName) {
  const ether = etherRaw / 100
  let t = ether > 0 ? ether / 100 : 0
  if (/闪避反击/.test(zhName)) t -= 1.5
  else if (/招架支援/.test(zhName)) t -= 2.5
  // 「终结技：入场」是入场动作不是喧响终结，不吃 -5 加成折减
  else if (/(终极技|终结技)/.test(zhName) && !/入场/.test(zhName)) t -= 5
  // actionTimeSanity 全库口径：秽盾 ≤ 类型加成（beta 数据终结技常见）→ 未含加成，时间 = ether/100，禁止钳位 0.001
  if (t <= 0) t = ether > 0 ? ether / 100 : 0
  return Math.round(t * 1000) / 1000
}

/**
 * 逐 moveId 收集派生值（首次出现为准）。
 * @returns {Map<string, {
 *   moveId: string, cat: string, entryName: string, paramName: string,
 *   damage: number, daze: number, energy: number, decibel: number, anomaly: number,
 *   ether: number, attackData: number[], energyCost?: number, raw: object,
 * }>}
 */
export function collectMoveRows(full, selfId) {
  const moves = new Map()
  for (const cat of MOVE_CATS) {
    for (const entry of full.skill?.[cat]?.description ?? []) {
      const entryName = stripPrefix(entry?.name)
      const params = Array.isArray(entry?.param) ? entry.param : []
      const idsOfParam = []
      let lastMoveId = ''
      for (const p of params) {
        const ids = Object.keys(p?.param ?? {})
        if (ids.length > 0) lastMoveId = remapMoveId(ids[ids.length - 1], selfId)
        for (const [rawId, pv] of Object.entries(p?.param ?? {})) {
          const moveId = remapMoveId(rawId, selfId)
          idsOfParam.push([moveId, stripPrefix(p?.name)])
          if (!moves.has(moveId)) {
            moves.set(moveId, { moveId, cat, entryName, paramName: stripPrefix(p?.name), raw: pv, ...derivedOf(pv) })
          }
        }
        // 能量消耗行：无 {Skill:id} 引用，归属前一个带 id 的 param 行
        if (/能量消耗/.test(String(p?.name ?? ''))) {
          const amount = Number(String(p?.desc ?? '').replace(/<[^>]*>|\(Test\d+\)|点/g, '').trim())
          const target = moves.get(lastMoveId)
          if (target && Number.isFinite(amount) && amount > 0) target.energyCost = amount
        }
      }
      // 兜底：同 entry 多段时用「招式名·参数名」区分只出现一次的 id
      if (params.length > 1) {
        const idCount = new Map()
        for (const [id] of idsOfParam) idCount.set(id, (idCount.get(id) ?? 0) + 1)
        for (const [id, pname] of idsOfParam) {
          const m = moves.get(id)
          if (m && idCount.get(id) === 1 && pname) m.entryName = `${m.entryName}·${pname}`
        }
      }
    }
  }
  return moves
}

/** 单条 param 值 → catalog 行刻度（与导入器逐位同源） */
export function derivedOf(pv) {
  return {
    damage: (num(pv.damage_percentage) + num(pv.damage_percentage_growth) * 11) / 100,
    daze: (num(pv.stun_ratio) + num(pv.stun_ratio_growth) * 11) / 100,
    energy: num(pv.sp_recovery) / 10000,
    decibel: num(pv.fever_recovery) / 10000,
    anomaly: num(pv.attribute_infliction) / 100,
    ether: num(pv.ether_purify),
    attackData: Array.isArray(pv.attack_data) ? pv.attack_data.map(num) : [],
  }
}
