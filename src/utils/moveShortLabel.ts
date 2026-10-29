/**
 * 招式名短标签（窄容器展示层**单一事实源**，2026-10-29）。
 *
 * 症状（用户报）：「挽昼的失衡轴我根本看不清哪个招式是什么名字，**全是一个名字**」。
 * 根因：失衡轴页把目录招式名 `slice(0, 8)` 当标签用，而 8 个字里前 6 个被招式族前缀
 * （「强化特殊技：」）吃掉 ⇒ 只剩 2 个字给招式本体。实测全 catalog 1379 个招式名在 8 字
 * 口径下有 **233 组重名**；挽昼(1601) 四个强化特殊技塌成 2 个名字（见
 * `data/skillDamageTargets#SKILL_DMG_TARGET_SHORT_LABELS` 注释里的逐条对照）。
 *
 * 口径（用户裁决，逐字）：「**前面的招式名简写一下，强特就是强特**」
 *   ⇒ 压的是**前缀**（招式族），招式本体一字不动：
 *      `强化特殊技：燃灯·永昼之炬` → `强特：燃灯·永昼之炬`
 *      `强化特殊技：焚夜·曦生（改）` → `强特：焚夜·曦生（改）`（变体后缀必须留着，
 *      它是 1601016 与 1601106 唯一的区分点）
 *
 * ⚠ **不截断**：本函数返回完整名字，宽度交给 CSS（chip/块各自 ellipsis），全文进 title。
 *   在数据层砍字 = 把「认不出是哪招」这类缺陷写进数据，正式版已经因此赔过一次。
 *
 * @fact ui:失衡轴页/招式名 口径: 轴编辑器的招式名（动作池 chip / 时间轴块 / 招式下拉 / [表] 直读块）走 `shortMoveLabel`——只压招式族前缀（强化特殊技⇒强特、普通攻击⇒普攻…），招式本体与变体后缀（如「（改）」）一字不动、**不做任何长度截断**（宽度由 CSS 省略号收缴，全文进 title）；资源池页仍用引擎全名（`exec.moveName` + moveId），两处取名不合并 | 据 用户@2026-10-29（「前面的招式名简写一下，强特就是强特」） | 验 src/utils/__tests__/moveShortLabel.test.ts | 锚 src/utils/moveShortLabel.ts#shortMoveLabel | 信 确认
 */
import { SKILL_DMG_TARGET_LABELS, SKILL_DMG_TARGET_SHORT_LABELS } from '@/data/skillDamageTargets'
import type { SkillDamageTarget } from '@/types/catalog'

/**
 * 招式族前缀 → 短标签。
 * 枚举那一份从 `SKILL_DMG_TARGET_LABELS` **反查**（单一来源，不手抄）；
 * 这里只补 catalog 里真实出现、但**不属于伤害目标族**的子族前缀
 * （「支援技」是 assist 的全名，而快速/突击/招架/反制支援是它的四个子族，各有独立名字）。
 */
const EXTRA_FAMILY_SHORT: Record<string, string> = {
  快速支援: '快支',
  支援突击: '支突',
  招架支援: '招架',
  反制支援: '反制',
}

const FAMILY_SHORT: Record<string, string> = {
  ...Object.fromEntries(
    (Object.keys(SKILL_DMG_TARGET_LABELS) as SkillDamageTarget[])
      .map(k => [SKILL_DMG_TARGET_LABELS[k], SKILL_DMG_TARGET_SHORT_LABELS[k]]),
  ),
  ...EXTRA_FAMILY_SHORT,
}

/**
 * 招式全名 → 短标签。无「：」分隔（连段块 / 模块自造名如 `[怒]论道`）/ 前缀不在表内 ⇒ 原样返回
 * （**不猜、不砍**）；名字为空 ⇒ 回落 `fallback`（通常是 moveId，不编名字）。
 */
export function shortMoveLabel(rawName?: string | null, fallback = ''): string {
  const name = (rawName ?? '').trim()
  if (!name) return fallback
  const cut = name.search(/[：:]/)
  if (cut < 0) return name
  const family = name.slice(0, cut)
  const body = name.slice(cut + 1).trim()
  const short = FAMILY_SHORT[family]
  return short && body ? `${short}：${body}` : name
}
