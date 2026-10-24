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
 *
 * 另：动作清单下方的「**综合合轴 −X s**」行（`dynamicComboAlignSecondsOf`）不走本模块的行构建——
 * 它是槽级统筹量、不落在任何执行行上，若并进 Σ 会破坏上面那条「Σ行前台 = frontlineTime」契约。
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

/**
 * **综合合轴**（动态合轴吸收）秒数——动作清单下方那一行「综合合轴 −X s」的唯一读数。
 *
 * 用户口径 2026-10-24（逐字）：「合轴就是切人，人在场打完动作但是非当前操作。感觉要展示也是在动作下面
 * 列一行：**综合合轴**。然后说这是 -多少秒」。
 *
 * 为什么**不**做成动作行、也不摊进各行的 `comboAlignTime`：
 * - 引擎只在**槽级**算出这个量（`TimeAllocation.dynamicComboAlignSeconds`），执行行上没有任何标记
 *   说明「哪一招在并行」——把它按行时长比例摊进各行 = 编造一个引擎不知道的归属；
 * - 它本来就是个**统筹量**（`comboAlignAbsorbRatio` × 非操作槽净必要，闭式解），用户明确说
 *   「这个合轴率很难明确细化」⇒ 只报总量。
 *
 * ⚠ 读**实际读数**，不许按吸收比×净必要重算（页面重算会与引擎闭式解分叉，同 `interactionHint.ts`
 * 的口径说明；咬合支时吸收量严格小于容量）。
 *
 * @fact ui:结果卡/综合合轴 口径: 动态合轴吸收在角色卡里只以「综合合轴 −X s」单行呈现（动作清单下方），不摊进各动作行的 comboAlignTime、也不进时间条 Σ（Σ行前台 = frontlineTime 契约）；读数取引擎 TimeAllocation.dynamicComboAlignSeconds 实际值，不按吸收比重算 | 据 用户@2026-10-24（「合轴就是切人，人在场打完动作但是非当前操作…要展示也是在动作下面列一行：综合合轴，然后说这是 -多少秒」+「这个合轴率很难明确细化，本来就是个统筹综合量」） | 验 src/composables/__tests__/dynamicComboAlignRow.test.ts | 锚 src/composables/resourceCard/actionOperationRows.ts#dynamicComboAlignSecondsOf | 信 确认
 * ⟳复核: 若把动态吸收摊进执行行或时间条（用户改口要「细化到招」）时，复核本条口径与 dynamicComboAlignRow.test.ts 的三条断言 | 到期 2027-04-30
 */
export function dynamicComboAlignSecondsOf(result: CharacterResourceResult): number {
  return Math.max(0, result.timeAllocation.dynamicComboAlignSeconds ?? 0)
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
