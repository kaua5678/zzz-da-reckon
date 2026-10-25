/**
 * 配置码（两位数字）= 左位影画 0-6、右位专武精炼 1-5，`20` 读作「2命 无专武」。
 *
 * 用户裁决 2026-09-14（逐字）：「两个数字通常指配置，比如 21 第一个是代表 2命，1 代表专武精炼1」
 * ⇒ `21` = 2 命 + 精炼 1；`01` = 0 命 + 本体。
 * 游戏里没有「精炼 0」，所以右位 0 只能读作「没这把专武」（走基础/自动下位音擎）。
 *
 * 为什么单独成文件（2026-10-25）：自由对比（`composables/freeCompare/axes.ts` 转出）与
 * 队伍对比「逐槽锁定」（`composables/presetSlotOverrides.ts`）要用**同一套**解析/回显口径，
 * 复制一份就会在「0 = 无专武」这条边界上分叉。纯函数、零依赖，谁都能 import。
 */

/** 影画/命座 0-6 + 专武精炼 1-5（0 = 无专武） */
export interface SetupCode {
  /** 影画/命座 0-6 */
  cinema: number
  /** 专武精炼 1-5；**0 = 无专武**（穿下位/常驻音擎） */
  wengine: number
}

/** 配置码字符串（如 "21" / "01" / "20"）→ 结构化。非法返回 null（不抛，UI 直接标红） */
export function parseSetupCode(text: string): SetupCode | null {
  const s = text.trim()
  if (!/^\d{2}$/.test(s)) return null
  const cinema = Number(s[0])
  const wengine = Number(s[1])
  if (cinema > 6) return null
  if (wengine > 5) return null
  return { cinema, wengine }
}

/** 结构化 → 配置码字符串（UI 回显/去重键） */
export function formatSetupCode(c: SetupCode): string {
  return `${c.cinema}${c.wengine}`
}

/** 人类可读标签（图例/悬浮卡）：`21` → 「2命 精1」；`20` → 「2命 无专武」 */
export function setupCodeLabel(c: SetupCode): string {
  return c.wengine === 0 ? `${c.cinema}命 无专武` : `${c.cinema}命 精${c.wengine}`
}
