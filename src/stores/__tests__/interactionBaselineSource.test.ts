/**
 * CC-255：交互基准单一来源 `stores/config#interactionBaselineFor`（角色专属默认 > 职业基准；模块声明
 * noGenericInteraction 时全 0）。修前 4 个分析器（pullPlannerEngine / teamTimelineStore / charIncrement /
 * runArchiveDeploy）各内联一份 `hasCustom ? defs : roleInteractionBaseline(...)`，都漏了 noGenericInteraction，
 * 1051 伊德海莉在抽卡规划 / 时间线 / 卡片增量 / 归档部署里被发弹刀 6 + 闪反 10，而主页与 harness 给 0。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { applyTeamToStore } from '@/composables/teamTimelineStore'

beforeEach(() => { newPinia(); mockStaticFetch() })

describe('CC-255 交互基准单一来源', () => {
  it('行为：时间线轻量装配下 1051（noGenericInteraction）交互全 0；普通主C 仍取职业基准', async () => {
    const { config } = await setupHarness([{ agentId: '1211' }, { agentId: '1311' }, { agentId: '1171' }])
    applyTeamToStore(config, ['1051', '1191', '1311'], { cinemas: [0, 0, 0], wengineMods: [1, 1, 1], wEngines: ['', '', ''] } as never, false)
    const [yidhari, ellen] = config.team
    expect([yidhari.parryCount, yidhari.dodgeCounterCount, yidhari.blockCount]).toEqual([0, 0, 0])
    expect(ellen.parryCount).toBeGreaterThan(0)
    expect(ellen.dodgeCounterCount).toBeGreaterThan(0)
  })

  it('源码：composables / views / components 不许内联「专属交互默认」判定（owner = mechanics/interactionBaseline.ts，CC-478 前为 stores/config.ts）', () => {
    const root = resolve(__dirname, '../..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        const rel = relative(root, p).replace(/\\/g, '/')
        if (rel === 'mechanics/interactionBaseline.ts') continue // CC-478：owner 从 stores/config.ts 搬到 mechanics（config.ts 只剩 re-export）
        readFileSync(p, 'utf-8').split('\n').forEach((l, i) => {
          if (/defs\.parry\s*>\s*0\s*\|\|\s*defs\.dodge\s*>\s*0/.test(l)) hits.push(`${rel}:${i + 1}`)
        })
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
