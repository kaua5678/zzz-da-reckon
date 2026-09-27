/**
 * CC-65：TeamConfigPage 角色专属计数输入框 → 模块声明 characterCountInputs。
 * 对照表 = 原页面写死 v-if 块（1551×2 / 1471 嘲讽取消 / 1541 / 1371×5）逐字段/标签/提示/title/口径。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { agentCharacterCountInputs, characterCountInputValue, characterCountInputClearValue } from '@/composables/agentMechanicView'
import { ACTION_COUNT_BOUNDS } from '@/stores/config'

const LEGACY: Record<string, Array<{ field: string; label: string; hint?: string; title?: string; mode?: string }>> = {
  '1551': [
    { field: 'perfectBlockCount', label: '强特完美格挡', title: '强化特殊技触发完美格挡的次数：每次回复日珥 10 点（下分支耀斑期间强特完美格挡回日珥）' },
    { field: 'assaultOrderCount', label: '强袭训令次数', title: '特殊技：强袭训令的发动次数（格挡招式，伤害计入倍率表 166.4% 以太行）' },
  ],
  '1471': [
    { field: 'tauntCancelCount', label: '嘲讽取消', title: '失衡外强特连段末尾后摇的嘲讽取消次数：每连段末尾强特后摇 = 自身时长（期间不能平A，占用战场时间），一次嘲讽取消一次后摇；失衡内连段默认被连携/大招/瞬拳取消，不计' },
  ],
  '1541': [
    { field: 'promiaNiyingCount', label: '处刑式·匿影', title: '强特变体：耗强特能量（用户自控预算）；每次触发+10寒蚀值，之后可接特殊技「处刑式·重霜」' },
  ],
  '1371': [
    { field: 'yixuanInk2Count', label: '2连墨痕化形' },
    { field: 'yixuanInk3Count', label: '3连墨痕化形', hint: '≤0=自动', title: '≤0/清空 = 自动：总闪能打完失衡内消耗，剩余全部轴外打 3 连墨痕化形（60闪能/次）；填正数覆盖', mode: 'autoIfNonPositive' },
    { field: 'yixuanPerfectBlockCount', label: '完美格挡', hint: '≤0=自动', title: '≤0/清空 = 自动：全完美格挡 = 弹刀次数（每次 #2 赠送 +10 闪能）；填正数覆盖', mode: 'autoIfNonPositive' },
    { field: 'yixuanExtremeAssistCount', label: '极限支援', title: '极限支援换场落雷（225%贯穿力+5闪能/次）；缺省 = 队友正常弹刀次数求和（上限）', mode: 'autoNegOne' },
    { field: 'yixuanBackstageComboCount', label: '墨影凝云合轴', title: '后台使用墨影凝云+霄云劲#5（不消耗战场时间，有倍率行调用/异常积蓄/失衡）' },
  ],
}
// 原页面 min/max
const LEGACY_MINMAX: Record<string, [number, number]> = {
  perfectBlockCount: [0, 999], assaultOrderCount: [0, 999], tauntCancelCount: [0, 99], promiaNiyingCount: [0, 99],
  yixuanInk2Count: [0, 99], yixuanInk3Count: [0, 99], yixuanPerfectBlockCount: [0, 99], yixuanExtremeAssistCount: [-1, 99], yixuanBackstageComboCount: [0, 99],
}
// 原页面 :value 表达式
const LEGACY_VALUE: Record<string, (x: number | undefined) => number | null> = {
  perfectBlockCount: x => x || 0,
  assaultOrderCount: x => x || 0,
  tauntCancelCount: x => x ?? 0,
  promiaNiyingCount: x => x ?? 0,
  yixuanInk2Count: x => x ?? 0,
  yixuanInk3Count: x => ((x ?? 0) > 0 ? x! : null),
  yixuanPerfectBlockCount: x => ((x ?? 0) > 0 ? x! : null),
  yixuanExtremeAssistCount: x => ((x ?? -1) < 0 ? -1 : x!),
  yixuanBackstageComboCount: x => x ?? 0,
}
const LEGACY_CLEAR: Record<string, number> = { yixuanExtremeAssistCount: -1 }

describe('CC-65 角色专属计数输入框 → characterCountInputs', () => {
  it('全 catalog 角色：声明 == 原页面写死块（顺序/字段/标签/提示/title/口径）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1371' }, '', ''])
    const ids = [...new Set(['', ...catalog.agentsMap.keys()])]
    expect(ids.length).toBeGreaterThan(30)
    let hits = 0
    for (const id of ids) {
      const got = agentCharacterCountInputs(id).map(d => JSON.parse(JSON.stringify(d)))
      expect(got, id).toEqual(LEGACY[id] ?? [])
      hits += got.length
    }
    expect(hits).toBe(9)
    expect(agentCharacterCountInputs(null)).toEqual([])
    expect(agentCharacterCountInputs(undefined)).toEqual([])
  }, 60000)

  it('显示值 / 清空值 / min-max 与原页面逐值一致', () => {
    const raws: Array<number | undefined> = [undefined, -5, -1, 0, 1, 3, 99, 999]
    for (const decls of Object.values(LEGACY)) {
      for (const d of decls) {
        const inp = { mode: d.mode as 'autoIfNonPositive' | 'autoNegOne' | undefined }
        for (const x of raws) expect(characterCountInputValue(inp, x), `${d.field}/${x}`).toBe(LEGACY_VALUE[d.field](x))
        expect(characterCountInputClearValue(inp), d.field).toBe(LEGACY_CLEAR[d.field] ?? 0)
        const b = ACTION_COUNT_BOUNDS[d.field as keyof typeof ACTION_COUNT_BOUNDS]
        expect([b.min, b.max], d.field).toEqual(LEGACY_MINMAX[d.field])
      }
    }
  })

  it('页面源码锁：不再按 1551/1541/1371 写死，写入统一走 setActionCount', () => {
    const src = readFileSync(resolve(__dirname, '../../views/TeamConfigPage.vue'), 'utf-8')
    for (const id of ['1551', '1541', '1371']) expect(src).not.toContain(`agentId === '${id}'`)
    expect(src).toContain('v-for="inp in characterCountInputs"')
    expect(src).toContain('configStore.setActionCount(configStore.selectedSlot, inp.field')
  })
})
