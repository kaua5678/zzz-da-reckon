/**
 * CC-493：轴内计划口径扫描 / 失衡窗口覆盖率只写一份（src/mechanics/stunWindows.ts）。
 * 源码锁：mechanics/agents 下不再有 `axis.windows[ai] ?? 0` 的手写扫描；`Math.max(1, Number(combatTime) || 180)` 只在 owner。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { forEachSlotAxisAction, stunWindowCoverage } from '@/mechanics/stunWindows'

const AGENTS = join(__dirname, '..', 'agents')
const read = (p: string) => readFileSync(p, 'utf8')

describe('stunWindows（CC-493）', () => {
  it('forEachSlotAxisAction：按轴窗口数回调本槽块，不跳 0 窗，别的槽不回调', () => {
    const axis = {
      axes: [
        { actions: [{ slot: 0, moveId: 'a', count: 2 }, { slot: 1, moveId: 'b', count: 5 }] },
        { actions: [{ slot: 0, moveId: 'c', count: 1 }] },
        { actions: [{ slot: 0, moveId: 'd', count: 7 }] },
      ],
      windows: [3, 0],
    }
    const seen: Array<[string, number]> = []
    forEachSlotAxisAction(axis, 0, (act, wins) => seen.push([act.moveId, wins]))
    expect(seen).toEqual([['a', 3], ['c', 0], ['d', 0]])
  })
  it('stunWindowCoverage：floor 次数 × 窗口 / 战斗秒，封顶 1', () => {
    expect(stunWindowCoverage(3, 16, 180)).toBeCloseTo(48 / 180, 12)
    expect(stunWindowCoverage(2.9, 16, 180)).toBeCloseTo(32 / 180, 12)
    expect(stunWindowCoverage(20, 16, 180)).toBe(1)
    expect(stunWindowCoverage(2, 16, 150)).toBeCloseTo(32 / 150, 12)
  })
  it('源码锁：agents 下无手写轴扫描 / 覆盖率算式', () => {
    const files = readdirSync(AGENTS).filter(f => f.endsWith('.ts'))
    const scan = files.filter(f => read(join(AGENTS, f)).includes('axis.windows[ai] ?? 0'))
    const cov = files.filter(f => read(join(AGENTS, f)).includes('Math.max(1, Number(combatTime) || 180)'))
    expect(scan).toEqual([])
    expect(cov).toEqual([])
    const users = files.filter(f => read(join(AGENTS, f)).includes('forEachSlotAxisAction(axis, '))
    expect(users.length).toBeGreaterThanOrEqual(6)
  })
})
