/**
 * CC-484（r669）：角色配色（调色板 + id 散列）唯一出处 = composables/charts/agentPresentation.ts。
 * timelineChart.ts 的 AGENT_PALETTE / agentColorOf 只是旧名转出，不得再长出第二份调色板。
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { PALETTE, colorOf } from '@/composables/charts/agentPresentation'
import { AGENT_PALETTE, agentColorOf } from '@/composables/timelineChart'

describe('角色配色单一出处（CC-484）', () => {
  it('timelineChart 的旧名就是 agentPresentation 的同一对象', () => {
    expect(agentColorOf).toBe(colorOf)
    expect(AGENT_PALETTE).toBe(PALETTE)
    expect(PALETTE).toHaveLength(16)
    expect(PALETTE).toContain(colorOf('1371'))
  })
  it('源码锁：16 色角色调色板（末色 #feb2b2）只出现在 agentPresentation.ts（teamCompareScatter 的 8 色预设调色板是另一概念：按预设序号配色，不在此锁内）', () => {
    const out = execFileSync('grep', ['-rl', "'#feb2b2'", 'src', '--include=*.ts', '--include=*.vue', '--exclude-dir=__tests__'], { encoding: 'utf8' })
    expect(out.trim().split('\n').sort()).toEqual(['src/composables/charts/agentPresentation.ts'])
  })
})
