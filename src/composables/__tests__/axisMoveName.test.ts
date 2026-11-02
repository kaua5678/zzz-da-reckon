/**
 * 轴视图招式名共享解析器的判据（2026-10-30 收敛）。
 *
 * 收敛前两份实现且**已经漂移**：逐窗兑现图写「平A」、难度曲线「这一档的轴」裸写内部 id `basic`。
 * 本判据把四档口径逐条钉住：平A 标识 → 模块连段名 → 目录倍率表 → 回落 moveId（**不编名字**）。
 */
import { describe, expect, it } from 'vitest'
import { axisMoveNameResolver, type AxisMoveNameSkills } from '@/composables/axisMoveName'

/** 夹具：只给解析用到的两列（id + 名字），与 `catalogStore.getAgentSkills` 同形入口 */
const skills: AxisMoveNameSkills = {
  categories: [
    { moves: [{ id: '111', name: { zhCN: '测试招式' } }, { id: '222', name: { en: 'Fallback EN' } }] },
  ],
}

const resolve = axisMoveNameResolver({
  agentIdOf: slot => (slot === 0 ? '1471' : ''),
  skillsOf: () => skills,
})

describe('axisMoveNameResolver', () => {
  it('① 平A 标识（引擎兜底池的 basic，不是 catalog 招式）⇒「平A」', () => {
    expect(resolve(0, 'basic')).toBe('平A')
    // 目录里查不到它 —— 不特判就会把内部 id 原样画在轴上
    expect(resolve(2, 'basic')).toBe('平A')
  })

  it('② 角色模块声明的连段名优先于目录（连段块不在倍率表里）', () => {
    expect(resolve(0, 'banyue-combo')).toBe('怒相连段·论道')
    // 同一个 moveId 换到没有该声明的槽位 ⇒ 回落目录 / moveId，不跨角色串名
    expect(resolve(1, 'banyue-combo')).toBe('banyue-combo')
  })

  it('③ 目录倍率表经 localized 单一解析器（zhCN → en；zhCN 空串有效不回退）', () => {
    expect(resolve(0, '111')).toBe('测试招式')
    expect(resolve(0, '222')).toBe('Fallback EN')
  })

  it('④ 三档都不中 ⇒ 回落 moveId 原样（**不编名字**）', () => {
    expect(resolve(0, 'no-such-move')).toBe('no-such-move')
  })

  it('字典缺省（非轴队 / 目录未加载）也不抛错：仍能走 ①②④', () => {
    const bare = axisMoveNameResolver({ agentIdOf: () => '' })
    expect(bare(0, 'basic')).toBe('平A')
    expect(bare(0, '111')).toBe('111')
  })

  it('⑤ 版本化 id（beta 快照 `1601v1`）回落同名 live 角色；只在版本化 id 查不到时才试基名', () => {
    /**
     * 2026-11-03 实报：beta 队（挽昼v2 = `1601v1`）的轴明细/逐窗图把 `1601006` 当名字裸写出来。
     * 实测 beta 旁挂的 `agentSkills` 与 live **同 id 同名字**（`强化特殊技：燃灯·晦尽`）；
     * 当本次会话的目录索引里没有 beta 旁挂（例如页面是在开 beta 之前加载的）时，只有基名查得到 ⇒ 回落基名。
     * **这是按 id 查同一张表，不是编名字**：基名也查不到 ⇒ 仍回落 moveId。
     */
    const viaBase = axisMoveNameResolver({ agentIdOf: () => '1601v1', skillsOf: id => (id === '1601' ? skills : undefined) })
    expect(viaBase(0, '111')).toBe('测试招式')
    const seen: string[] = []
    const ownFirst = axisMoveNameResolver({ agentIdOf: () => '1601v1', skillsOf: id => { seen.push(id); return skills } })
    expect(ownFirst(0, '111')).toBe('测试招式')
    expect(seen, '版本化 id 自己查得到时不得越过它去查基名').toEqual(['1601v1'])
    const none = axisMoveNameResolver({ agentIdOf: () => '1601v1', skillsOf: () => undefined })
    expect(none(0, '111')).toBe('111')
  })

  it('两个调用方绑同一份口径（槽位 → 角色 id 由调用方注入，解析链只有这一条）', () => {
    const perSlot = axisMoveNameResolver({ agentIdOf: s => (s === 1 ? '1471' : ''), skillsOf: () => skills })
    expect(perSlot(1, 'banyue-combo')).toBe('怒相连段·论道')
    expect(perSlot(0, 'banyue-combo')).toBe('banyue-combo')
  })
})
