/**
 * 结果卡「时间分配」行构建（CC-459，从 ResourceResultCard.vue 抽出为纯函数，便于用 harness 直接锁契约）。
 *
 * 契约（引擎侧，`types/resource/execution.ts` timeBucket 注释）：Σ前台行 totalTime ≡ necessaryTime + basicAttackTime
 * = `timeAllocation.frontlineTime`，由折叠循环强制收敛。因此：
 *  - 行只取 `isFrontlineExecution(exec)`（timeBucket ≠ 'backstage'）——此前卡片画所有 totalTime>0 的行，
 *    1331 的后台桶行 11.7s 被当前台，卡片「总计」191.7s ≠ 180；
 *  - 不再私加柏妮思搅拌/抛接行（初始提交遗留，早于 CC-409 actionTime 单源化；executions 已含 1171010–1171013
 *    灼热摇荡法行，私加行使 1171 卡片「总计」211.3s ≠ 180）。流火·抛接 1171026 引擎本就不计前台——若应计，
 *    走 `burnice.ts` buildExecutions 加行，不在卡片侧补。
 * 锁：`composables/__tests__/actionRowsMatchEngineCc459.test.ts`。
 */
import type { CharacterResourceResult } from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'

export type ActionOperationRow = {
  key: string
  name: string
  color: string
  match: (moveName: string, category: string) => boolean
  frontlineTime: number
  comboAlignTime: number
  operationTime: number
  /** 该动作计划释放次数（执行计划行 count；用户口径 2026-09-19「资源池时间分配显示每个动作释放次数」） */
  count: number
}

export const ACTION_ROW_DEFS: Array<Pick<ActionOperationRow, 'key' | 'name' | 'color' | 'match'>> = [
  { key: 'basic', name: '普通攻击', color: '#61afef', match: (_moveName, category) => category === 'basic' },
  { key: 'exSpecial', name: '强化特殊技', color: '#e06c75', match: (moveName, category) => category === 'special' || moveName.includes('强化特殊技') || moveName.toLowerCase().includes('ex special') },
  { key: 'ultimate', name: '终结技', color: '#c678dd', match: (moveName, category) => category === 'chain' && (moveName.includes('终结技') || moveName.toLowerCase().includes('ultimate')) },
  { key: 'chain', name: '连携技', color: '#d19a66', match: (moveName, category) => category === 'chain' && (moveName.includes('连携技') || moveName.toLowerCase().includes('chain attack') || moveName.toLowerCase().includes('chain') || moveName.toLowerCase().includes('连携')) && !moveName.toLowerCase().includes('ultimate') },
  { key: 'dodgeCounter', name: '闪避反击', color: '#7fdbca', match: (moveName, category) => category === 'dodge' || moveName.includes('闪避反击') || moveName.toLowerCase().includes('dodge counter') },
  { key: 'defensiveAssist', name: '轻弹刀', color: '#56b6c2', match: (moveName, category) => (category === 'assist' && moveName.toLowerCase().includes('defensive assist')) || moveName.includes('轻弹刀') || moveName.toLowerCase().includes('defensive assist') },
  { key: 'assistFollowUp', name: '支援突击', color: '#98c379', match: (moveName, category) => (category === 'assist' && moveName.toLowerCase().includes('assist follow-up')) || moveName.includes('支援突击') || moveName.toLowerCase().includes('assist follow-up') },
]

export function buildActionOperationRows(result: CharacterResourceResult): ActionOperationRow[] {
  const rows: ActionOperationRow[] = []
  let colorIdx = 0
  for (const exec of result.executions) {
    if (!isFrontlineExecution(exec)) continue // 后台桶行已含在 backstageTime，不进前台条
    const frontlineTime = exec.totalTime
    if (frontlineTime <= 0) continue
    const comboAlignTime = exec.totalComboAlignTime
    const matched = ACTION_ROW_DEFS.find(def => def.match(exec.moveName, exec.category))
    const color = matched?.color ?? ACTION_ROW_DEFS[colorIdx % ACTION_ROW_DEFS.length].color
    colorIdx++
    // 名字：basic_attack 行优先用机制改写的 moveName（如伊德海莉「蓄力（烧血）」），
    // 未被改写时显示通用名「普通攻击」
    const name = exec.moveId === 'basic_attack'
      ? (exec.moveName && exec.moveName !== 'basic_attack' ? exec.moveName : '普通攻击')
      : `${exec.moveName} (${exec.moveId})`
    rows.push({
      key: exec.moveId || name,
      name,
      color,
      match: () => true,
      frontlineTime,
      comboAlignTime,
      operationTime: Math.max(0, frontlineTime - comboAlignTime),
      count: Number(exec.count) || 0,
    })
  }

  return rows
}

export type TimeChartRow = { key: string; name: string; time: number; color: string }

/** 时间分配条：各动作操作时间 + 合轴 + 后台；Σ time ≡ 战斗总时长（锁 CC-459） */
export function buildTimeChartRows(result: CharacterResourceResult): TimeChartRow[] {
  const actionRows = buildActionOperationRows(result)
  const rows: TimeChartRow[] = actionRows.map(row => ({ key: row.key, name: row.name, time: row.operationTime, color: row.color }))
  rows.push({ key: 'comboAlign', name: '合轴', time: actionRows.reduce((sum, row) => sum + row.comboAlignTime, 0), color: 'var(--wa-280)' })
  rows.push({ key: 'backstage', name: '后台', time: result.timeAllocation.backstageTime, color: 'var(--wa-120)' })
  return rows
}
