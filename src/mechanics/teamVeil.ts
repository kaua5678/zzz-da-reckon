/**
 * 全队以太帷幕开启总次数（`teamVeilCountTotal`）—— 队伍级联动通道的单一事实源。
 *
 * 消费方（读自己那份 cfg 的 teamVeilCountTotal）：
 * - 叶瞬光（1431）溯影惊鸿：队友开帷幕每次 +3 局外剑势（需支援/防护）。
 * - 爱芮（1501）合作舞台：每次帷幕开启生成 4 个应援能量（需击破/支援/同阵营/异常）。
 * - 千夏（1491）磨爪器：队伍任意角色开帷幕每次 +2 个磨爪器。
 *
 * 生产方（帷幕开启口径）：
 * - 照（1341）：霜寒值满开帷幕（登场技·霜迸）——computeZhaoVeilCount（2026-08-31）。
 * - 爱芮（1501）/叶瞬光（1431）：终结技开启帷幕（1:1）。
 * - 千夏（1491）：泡泡糖轰炸（70 能量）→ 免费特别拍照技巧 → 1 帷幕，即 70 能量 = 1 帷幕
 *   （特别拍照技巧不耗能、不计入 exSpecialCount，故千夏贡献 = 强特次数 1:1，用户 2026-09-02 确认）。
 *
 * 历史坑：此前该汇总写在 aire.ts / yeshuguang.ts 两份同款 postRound 钩子里，直接写
 * `characters` 克隆——而 runCalcRound 每轮从 base.characters 重新 map 克隆，postRound 的写入
 * 下一轮即丢失（从不生效）。2026-09 改为：useResourceCalc postRound 阶段调本函数算总次数，
 * 经 CalcRoundThreads.teamVeilCountTotal 收敛线程传递，下一轮 characters map 统一注入各 cfg。
 */
import type { CharacterOperationConfig } from '@/types/resource'
import { computeZhaoVeilCount } from './agents/zhao'

/** 爱芮 / 叶瞬光终结技开启帷幕（1:1） */
const ULT_OPEN_AGENT_IDS = new Set(['1501', '1431'])
/** 千夏：泡泡糖轰炸（70 能量）→ 免费特别拍照技巧 → 1 帷幕 = 强特次数 1:1 */
const EX_OPEN_AGENT_IDS = new Set(['1491'])
const ZHAO_ID = '1341'

// @fact agent:1491/帷幕计数 决: 千夏开帷幕 = 泡泡糖轰炸(70能量)→免费特别拍照技巧→1帷幕，即 70能量=1帷幕；特别拍照技巧不耗能、不计入 exSpecialCount，故 teamVeilCountTotal 千夏贡献 = 强特次数(70能量/次) 1:1 | 据 用户@2026-09-02 | 验 src/mechanics/__tests__/teamVeil.test.ts | 锚 src/mechanics/teamVeil.ts#computeTeamVeilCountTotal | 信 确认

export function computeTeamVeilCountTotal(
  characters: CharacterOperationConfig[],
  exCounts: number[],
  ultimateCounts: number[],
  combatTime = 180,
): number {
  let veilTotal = 0
  characters.forEach((mate, index) => {
    const ex = Math.max(0, Math.floor(exCounts[index] ?? 0))
    const ult = Math.max(0, Math.floor(ultimateCounts?.[index] ?? 0))
    if (mate.agentId === ZHAO_ID) {
      veilTotal += computeZhaoVeilCount(ex, ult, combatTime)
    } else if (ULT_OPEN_AGENT_IDS.has(mate.agentId)) {
      veilTotal += ult
    } else if (EX_OPEN_AGENT_IDS.has(mate.agentId)) {
      veilTotal += ex
    }
  })
  return veilTotal
}
