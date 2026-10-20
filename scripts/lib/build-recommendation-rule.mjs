/**
 * nanoka 邦布精灵「主词条推荐」的**站点规则**（单一事实源；sync 脚本与护栏测试共用）。
 *
 * 规则（2026-10-20 实测反推 + 62 角色逐位对拍）：
 *   对 4 / 5 / 6 **每个槽位独立**，按 `part4 → part5 → part6 → part_sub` 的顺序取
 *   **第一个在该槽合法的词条**；四个都没命中则留空。
 *
 * 为什么必须独立取、且不能用 alt_build：
 * - 站点页面（`zzz.nanoka.cc/character/<id>` 的 Recommended Build 块）渲染的就是
 *   `ml = [part4, part5, part6, part_sub].filter(合法槽)`，每槽再取该列表首项
 *   （bundle 见 `_app/immutable/nodes/9.*.js`：`xl = eo.map(slot => ({slot, stats: ml.filter(...)}))`）。
 * - 旧实现是「候选池全局去重贪心」：前面槽位用掉的词条，后面槽位只能顺延到次选
 *   ⇒ 与站点显示不一致（实测 24/62 角色），且 1631/1641 甚至写出**该槽不合法**的词条
 *   （暴伤只在 4 槽、精通只在 4 槽）。
 * - `alt_build[].part_sub_list` 是**备选配装**的副属性，不参与主词条选择
 *   （用它反而会引入站点没显示的候选；实测加入后与页面 61/61 的对拍就开始漂）。
 *
 * 合法词条池（prop id → 语义）与站点 bundle 里的 `to={4:Set,5:Set,6:Set}` 逐位一致：
 * 4 槽：生命 / 攻击 / 防御 / 暴击率 / 暴伤 / 异常精通
 * 5 槽：生命 / 攻击 / 防御 / 穿透率 / 六属性伤害加成
 * 6 槽：生命 / 攻击 / 防御 / 冲击力 / 能量自动回复 / 异常掌控
 */

/** 槽位合法主词条（prop id，顺序不影响判定，只用于合法性检查） */
export const SLOT_POOL_IDS = {
  4: ['11102', '12102', '13102', '20103', '21103', '31203'],
  5: ['11102', '12102', '13102', '23103', '31503', '31603', '31703', '31803', '31903', '32303'],
  6: ['11102', '12102', '13102', '12202', '30502', '31402'],
}

/** 参与主词条选择的字段（顺序 = 站点给出的优先级；alt_build 刻意不在其中） */
export const MAIN_STAT_FIELDS = ['part4', 'part5', 'part6', 'part_sub']

/**
 * 按站点规则算出 4 / 5 / 6 槽的主词条 prop id。
 * @param {Record<string, { prop?: number | string } | undefined>} fairy nanoka `fairy_recommend` 块
 * @returns {{ 4?: string, 5?: string, 6?: string }}
 */
export function assignMainStatProps(fairy) {
  const candidates = []
  for (const key of MAIN_STAT_FIELDS) {
    const p = fairy?.[key]
    if (!p?.prop) continue
    const prop = String(p.prop)
    if (Number(prop) <= 0) continue // 0 / 空 = 该槽无推荐，站点同样过滤
    candidates.push(prop)
  }
  /** @type {{ 4?: string, 5?: string, 6?: string }} */
  const out = {}
  for (const slot of /** @type {const} */ ([4, 5, 6])) {
    const hit = candidates.find(prop => SLOT_POOL_IDS[slot].includes(prop))
    if (hit) out[slot] = hit
  }
  return out
}

/** 该词条是否在槽位非法（护栏/脚本共用；未知 prop 一律判非法） */
export function isLegalMainStatProp(slot, prop) {
  return SLOT_POOL_IDS[slot]?.includes(String(prop)) ?? false
}
