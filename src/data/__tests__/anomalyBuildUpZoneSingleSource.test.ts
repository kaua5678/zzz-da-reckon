/**
 * CC-429 锁：异常积蓄「掌控 × 效率」两区与自动回能括号项全仓只许一处实现。
 * 修前 StatPanel.vue 各抄一份：`Math.floor(p.anomalyMastery) / 100 × (1 + eff/100)` 与 `(base × pct + flat) × 效率`；
 * 引擎若改 floor 规则 / 加算口径，面板展示会静默分叉。
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { anomalyBuildUpAfterMasteryAndEfficiency } from '@/data/anomalyElement'
import { calcPerHitBuildUp } from '@/core/anomalyPool/helpers'
import { emptyPanel } from '@/core/panel'

const SRC = join(__dirname, '../..')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(name)) out.push(p)
  }
  return out
}
const stripComments = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n')

describe('CC-429 异常积蓄两区 / 自动回能单源', () => {
  it('引擎 calcPerHitBuildUp = 共用两区 × 抗性区；展示用 base=1 得乘数', () => {
    const panel = { ...emptyPanel(), anomalyMastery: 123.7, anomalyBuildUpEfficiency: 10, electricAnomalyBuildUpEfficiency: 5 }
    const mult = anomalyBuildUpAfterMasteryAndEfficiency(1, panel, 'electric')
    expect(mult).toBeCloseTo(1.23 * 1.15, 12)              // floor(123.7) = 123；10 + 5 加算
    expect(calcPerHitBuildUp(100, panel, 0, 'electric')).toBeCloseTo(100 * mult, 9)
    expect(anomalyBuildUpAfterMasteryAndEfficiency(1, panel, 'electric', 20)).toBeCloseTo(1.23 * 1.35, 12)
  })
  it('源码锁：floor(anomalyMastery) 与 energyRegenBonusPct 的算术只在 data 层出现', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, '/')
      if (rel === 'data/anomalyElement.ts' || rel === 'data/agentPanelStats.ts') continue
      const src = stripComments(readFileSync(f, 'utf-8'))
      if (/Math\.floor\((p|panel|props\.panel)\.anomalyMastery/.test(src)) offenders.push(rel + ' (floor anomalyMastery)')
      if (rel.endsWith('.vue') && /energyRegenBonusPct\s*\?\?\s*0\)\s*\/\s*100/.test(src)) offenders.push(rel + ' (energyRegen 手抄)')
    }
    expect(offenders).toEqual([])
  })
})
