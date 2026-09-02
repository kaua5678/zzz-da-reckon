/**
 * 额外强特计划（通用引擎通道，2026-09 用户裁决「引擎别太窄」）。
 *
 * 背景：findExSpecial 只取第一个「有非空 energyCost 键」的强特 → 免费/窗口门控/替代资源
 * 的次要强特整招丢失（千夏「特别拍照技巧」此前 100% 未发射）。本表表达「同角色另有可释放
 * 的强特」：引擎在通用 EX 行之外补发额外行（行值由 enrich 按 moveId 回填，多段经
 * moveFusions 融合），次数按窗口或模块注入计算，能量成本 0（免费/替代资源由模块自己的
 * 资源账本记，引擎不扣能量）。
 *
 * 模式覆盖（用户 2026-09 举例）：
 * - 千夏(1491) 特别拍照技巧：0 耗能，每 [天使协律]（泡泡糖轰炸施加，40s）窗口 1 次，
 *   每次进入限 1 次 → windowSeconds=40 + capByExCount（天使协律每次强特授予）。
 * - 般岳(1471) 怒相免费连段：怒相内 4 山威免费强特（模式 = 状态入口赠送，按次数近似）；
 *   其模块已 bespoke（skipGenericExSpecial + 怒相循环），此处仅登记模式，不入表。
 * - 克拉蕾(1611) 秘血铸锋：成本走 findExSpecial costType=resource（Sharpness Cost 60 锐能），
 *   次数走 cfg.exSpecialResourcePaidCount 不动点（模块锐能账本写、引擎读），见 claret.ts。
 *
 * 注册表只收「引擎能正确发行的免费强特行」；模块已接管（skipGenericExSpecial）的角色不叠加。
 */
import type { ExtraExPlanRow } from '@/types/resource'

export interface ExtraExPlanEntry {
  moveId: string
  label: string
  count: ExtraExPlanRow['count']
  /** 每发能量成本（缺省 0 = 免费/替代资源强特） */
  energyCost?: number
  /** 依据（raw 原文/口径出处） */
  note: string
}

export const EXTRA_EX_PLANS: Record<string, ExtraExPlanEntry[]> = {
  '1491': [
    {
      moveId: '1491008',
      label: '千夏·强化特殊技·特别拍照技巧（协同）',
      count: { windowSeconds: 40, maxPerWindow: 1, capByExCount: true },
      energyCost: 0,
      note: 'full/1491.json：进入[天使协律]（强化特殊技：泡泡糖轰炸发动时全队添加，40s）后可发动，每次进入限 1 次；「伤害倍率（协同）」={1491008}+{1491019} 经 moveFusions 融合（1905.0%）。',
    },
  ],
}

// @fact engine:exSpecialPlan/千夏拍照 口径: 千夏强特2·特别拍照技巧（协同）=0耗能、每[天使协律]40s窗口1次且≤主强特次数（每次进入限1次）| 据 nanoka full/1491.json + 用户@2026-09 | 验 src/composables/__tests__/exSpecialPlan.test.ts | 锚 src/data/exSpecialPlans.ts#EXTRA_EX_PLANS | 信 确认
// @fact engine:exSpecialPlan/成本类型化 口径: 强特成本按 energyCost 键语义分类（含 energy 键=能量计费；Sharpness Cost 等=替代资源不扣能量；无键=免费），不再把锐能 60 当能量 60 | 据 findExSpecial 2026-09 重写@2026-09 | 验 src/composables/__tests__/exSpecialPlan.test.ts | 锚 src/core/resource.ts#findExSpecial | 信 确认

/** 窗口门控的额外强特次数：每 windowSeconds 秒 1 次（×maxPerWindow），可选不超过主强特次数 */
export function resolveExtraExCount(
  entry: ExtraExPlanEntry | ExtraExPlanRow,
  input: { battleSeconds: number; exCount: number },
): number {
  const window = Math.max(1, entry.count.windowSeconds)
  const perWindow = Math.max(1, entry.count.maxPerWindow ?? 1)
  const windows = Math.floor(Math.max(0, input.battleSeconds) / window)
  let count = windows * perWindow
  if (entry.count.capByExCount) {
    count = Math.min(count, Math.max(0, Math.floor(input.exCount)))
  }
  return count
}
