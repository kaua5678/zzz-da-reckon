/**
 * CC-62：teamAxisWindowLaneSlot 与原 StunAxisPage 写死 findIndex（般岳 1471 / 仪玄 1371）逐值一致。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { teamAxisWindowLaneSlot } from '@/composables/agentMechanicView'

const LEGACY = { mingwang: '1471', ningshen: '1371' } as const

describe('CC-62 专属窗口 lane → 模块声明 axisWindowLane', () => {
  it('全 catalog 角色单人队 × 两种 lane：槽位 == 原 findIndex', async () => {
    const { catalog } = await setupHarness([{ agentId: '1471' }, { agentId: '1371' }, ''])
    const ids = [...catalog.agentsMap.keys()]
    expect(ids.length).toBeGreaterThan(30)
    let hits = 0
    for (const id of ['', ...ids]) {
      for (const pos of [0, 2]) {
        const team = [{ agentId: '' }, { agentId: '' }, { agentId: '' }]
        team[pos] = { agentId: id }
        for (const kind of ['mingwang', 'ningshen'] as const) {
          const got = teamAxisWindowLaneSlot(team, kind)
          expect(got, `${id}@${pos}/${kind}`).toBe(team.findIndex(c => c.agentId === LEGACY[kind]))
          if (got >= 0) hits++
        }
      }
    }
    expect(hits).toBe(4)
  }, 60000)

  it('混合队伍（0/1/2 槽、都不在、空槽 null）', () => {
    const teams = [
      [{ agentId: '1471' }, { agentId: '1371' }, { agentId: '1211' }],
      [{ agentId: '1161' }, { agentId: '1471' }, { agentId: '1371' }],
      [{ agentId: '1371' }, null, { agentId: '1471' }],
      [{ agentId: '1161' }, { agentId: '' }, null],
    ]
    for (const team of teams) {
      for (const kind of ['mingwang', 'ningshen'] as const) {
        expect(teamAxisWindowLaneSlot(team, kind)).toBe(team.findIndex(c => c?.agentId === LEGACY[kind]))
      }
    }
  })

  it('StunAxisPage 不再按 agentId 写死 lane 拥有者', () => {
    const src = readFileSync(resolve(__dirname, '../../views/StunAxisPage.vue'), 'utf8')
    expect(src.includes("=== '1471'")).toBe(false)
    expect(src.includes("=== '1371'")).toBe(false)
  })
})
