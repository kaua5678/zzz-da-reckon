/**
 * 固化产物：docs/multiplier-record.md —— 「描述倍率表的句子」与倍率表一样静止。
 *
 * 老角色的倍率不会变，所以描述角色性质的句子也静态入库：数据（catalog.json）、
 * 标准表常数（@/data/standardMultiplierTable）或聚合口径任一变化都会让本测试漂移变红，
 * 此时跑 `npm run gen:multiplier-record` 再生成并随数据改动一起提交。
 * 手改 docs/multiplier-record.md 无效（会被下次再生成覆盖）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Agent, AgentSkills } from '@/types/catalog'
import {
  deriveCoefficientReport,
  type CoefficientReport,
} from '@/composables/multiplierCoefficients'
import { STANDARD_ROW_IDS, type StandardRowId } from '@/data/standardMultiplierTable'

const catalogData = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as { agents: Agent[]; agentSkills: AgentSkills[] }

const report: CoefficientReport = deriveCoefficientReport(catalogData.agents, catalogData.agentSkills)

const ROW_LABELS: Record<StandardRowId, string> = {
  damage: '伤害',
  daze: '失衡',
  energy_recovery: '回能',
  decibel_recovery: '喧响',
  anomaly_buildup: '积蓄',
  ether_purify: '秽盾',
  attack_data_0: '专属资源',
}

const SPECIALTY_LABELS: Record<string, string> = {
  attack: '强攻',
  stun: '击破',
  anomaly: '异常',
  support: '支援',
  defense: '防护',
  rupture: '命破',
  edgeguard: '戍卫',
  sharpen: '锐化',
}

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`
}

/** 确定性渲染：所有排序来自演算结果本身的稳定顺序（vertical 按 agentId，其余按 catalog 遍历序） */
function renderRecord(r: CoefficientReport): string {
  const lines: string[] = []
  lines.push('<!-- 由 src/composables/multiplierCoefficients.ts 演算生成（npm run gen:multiplier-record）；手改会被覆盖。 -->')
  lines.push('')
  lines.push('# 倍率表系数演算记录（角色性质固化描述）')
  lines.push('')
  lines.push('口径：实际录入值(Lv12) = 标准式(const + b×t [+ c×e]) × 等级系数(伤害×2/失衡×1.5) × 稀有度系数(限定S×1.1 / 常驻S×1.05，只乘伤害与失衡；命破伤害×0.8；闪能耗能利用率另×1.2) × 角色系数。纵向系数 = 干净类型比值中位数（排除强化特殊技、轻/重招架、未分类）；直伤系数 = 支援突击伤害列比值。标准表常数见 `src/data/standardMultiplierTable.ts`。')
  lines.push('')
  lines.push(`覆盖角色数：${r.vertical.length}。`)
  lines.push('')
  lines.push('## 一、角色系数总表')
  lines.push('')
  lines.push('| 角色 | 稀有度 | 职业 | 失衡 | 喧响 | 积蓄 | 回能 | 秽盾 | 直伤 |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const v of r.vertical) {
    const c = (id: StandardRowId) => pct(v.coefficients[id]?.value)
    lines.push(
      `| ${v.agentName} (${v.agentId}) | ${v.rarity} | ${SPECIALTY_LABELS[v.specialty] ?? v.specialty} | ${c('daze')} | ${c('decibel_recovery')} | ${c('anomaly_buildup')} | ${c('energy_recovery')} | ${c('ether_purify')} | ${pct(v.directDamage?.value)} |`,
    )
  }
  lines.push('')
  lines.push('## 二、角色性质描述（偏离 100% 超过 ±2% 的列）')
  lines.push('')
  const neutral: string[] = []
  for (const v of r.vertical) {
    const parts: string[] = []
    for (const id of STANDARD_ROW_IDS) {
      if (id === 'damage') continue
      const coef = v.coefficients[id]
      if (coef && Math.abs(coef.value - 1) > 0.02) parts.push(`${ROW_LABELS[id]}×${coef.value.toFixed(2)}`)
    }
    if (v.directDamage && Math.abs(v.directDamage.value - 1) > 0.02) parts.push(`直伤×${v.directDamage.value.toFixed(2)}`)
    if (parts.length) lines.push(`- **${v.agentName}(${v.agentId})**：${parts.join('、')}。`)
    else neutral.push(`${v.agentName}(${v.agentId})`)
  }
  lines.push('')
  lines.push(`无角色系数（全列与标准一致）：${neutral.join('、')}。`)
  lines.push('')
  lines.push('## 三、招式特定偏差（单招式比值 vs 本角色列基准，±5% 以上）')
  const deviationsByAgent = new Map<string, CoefficientReport['deviations']>()
  for (const d of r.deviations) {
    const list = deviationsByAgent.get(d.agentId) ?? []
    list.push(d)
    deviationsByAgent.set(d.agentId, list)
  }
  for (const [agentId, list] of deviationsByAgent) {
    lines.push('')
    lines.push(`### ${list[0].agentName}(${agentId})`)
    for (const d of list) {
      lines.push(
        `- ${d.moveName}【${d.moveTypeLabel}·${ROW_LABELS[d.rowId]}】比值 ${(d.ratio * 100).toFixed(1)}% / 基准 ${(d.baseline * 100).toFixed(1)}% → 偏差 ×${d.deviation.toFixed(2)}`,
      )
    }
  }
  lines.push('')
  return lines.join('\n')
}

const isGen = !!process.env.GEN_MULTIPLIER_RECORD
const artifactPath = new URL('../../../docs/multiplier-record.md', import.meta.url)

describe.skipIf(isGen)('固化产物 docs/multiplier-record.md', () => {
  it('与演算结果无漂移（红了就跑 npm run gen:multiplier-record）', () => {
    const committed = readFileSync(artifactPath, 'utf8')
    expect(committed).toBe(renderRecord(report))
  })
})

it.runIf(isGen)('再生成固化产物', () => {
  writeFileSync(artifactPath, renderRecord(report))
  expect(true).toBe(true)
})
