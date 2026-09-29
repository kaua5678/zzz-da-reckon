/**
 * CC-251：分析器「现场快照 / 恢复」单一来源（composables/configSnapshot.ts）。
 *
 * 修前 3 份副本：teamCompare.ts（队伍对比 / 难度曲线 / 自由对比 / TeamComparePage 缓存键）、teamTimelineStore.ts
 * （时间线 / 胶片）、positionCompare.ts（位置对比，私有）。只有 positionCompare 快照了 `teammateBuffSelections`：
 * 分析器换队 → setAgent / team watcher（flush:'sync'）→ syncTeammateBuffsFromTeam 按派生结果改写 enabled；
 * restore 的 team.splice 再触发一次 sync ⇒ 用户**手动**关掉的派生开启 buff 被改回开启（覆盖率也可能被新条目占位）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { restoreStore, snapshotStore } from '@/composables/configSnapshot'

beforeEach(() => { newPinia(); mockStaticFetch() })

describe('CC-251 分析器现场快照 / 恢复', () => {
  it('换队后恢复：队伍、以及用户手动改过的队友 buff 开关与覆盖率都回到原样', async () => {
    const { config } = await setupHarness([{ agentId: '1191' }, { agentId: '1211' }, { agentId: '1311' }])
    const sel = config.teammateBuffSelections as Record<string, { enabled: boolean; coverage: number }>
    const key = Object.keys(sel).find(k => sel[k].enabled)
    expect(key, '默认队伍应至少有一个派生开启的队友 buff').toBeTruthy()
    config.toggleTeammateBuff(key!, false)
    config.setTeammateBuffCoverage(key!, 37)
    const before = JSON.stringify(sel)

    const snap = snapshotStore(config)
    config.setAgent(1, '1141')
    config.setAgent(2, '1251')
    expect(config.team.map(c => c.agentId)).toEqual(['1191', '1141', '1251'])
    restoreStore(config, snap)

    expect(config.team.map(c => c.agentId)).toEqual(['1191', '1211', '1311'])
    expect(sel[key!]).toEqual({ enabled: false, coverage: 37 })
    expect(JSON.stringify(sel)).toBe(before)
  })

  it('源码：snapshotStore / restoreStore 只在 configSnapshot.ts 定义（不许再抄私有副本）', () => {
    const root = resolve(__dirname, '../..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        readFileSync(p, 'utf-8').split('\n').forEach((l, i) => {
          if (/function\s+(snapshotStore|restoreStore)\s*\(/.test(l)) hits.push(`${relative(root, p)}:${i + 1}`)
        })
      }
    }
    walk(root)
    expect(hits.map(h => h.split(':')[0]).sort()).toEqual(['composables/configSnapshot.ts', 'composables/configSnapshot.ts'])
  })

  it('CC-278 源码：不许内联抄快照 / 恢复（函数名锁拦不住的形态：charIncrement / pullPlannerEngine 曾各抄一份，漏队友 buff 选择）', () => {
    const root = resolve(__dirname, '../..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        const src = readFileSync(p, 'utf-8')
        const rel = relative(root, p)
        // 内联快照：把 configStore.team 与其它字段打包深拷贝
        if (/JSON\.stringify\(\{\s*team:\s*configStore\.team\b/.test(src)) hits.push(`${rel}:snapshot`)
        // 内联恢复：从快照变量整表回写失衡轴计划（teamCompare 从预设 JSON 写轴不算）
        if (/stunAxisPlans\.splice\(0,\s*configStore\.stunAxisPlans\.length,\s*\.\.\.\(*\s*(snap|s)\b/.test(src)) hits.push(`${rel}:restore`)
      }
    }
    walk(root)
    expect(hits).toEqual(['composables/configSnapshot.ts:restore'])
  })
})
