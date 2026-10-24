/**
 * registry settings 跨模块命名空间（2026-10-24 beta 快照批）。
 *
 * 背景：`settingDefaults` 原是全局唯一 Map——beta 冻结副本模块（`<id>v<n>`）与正主声明
 * 同名滑块时启动即抛错。改造后：跨模块同 id 允许并存，全局裸 id 索引**首注册优先**
 * （活体模块先注册 ⇒ 活体缺省胜出）；模块内同 id 重复仍是录入错误。
 * 语义口径：同名滑块 = 全局一个取值槽，用户值两版共享（对比口径一致）。
 */
import { describe, expect, it } from 'vitest'
import {
  getRegisteredMechanicSettings,
  registerAgentMechanic,
  resolveMechanicSettingMap,
} from '../registry'
import type { AgentMechanicModule } from '../types'

function mod(id: string, agentIds: string[], settings: AgentMechanicModule['settings']): AgentMechanicModule {
  return { id, agentIds, settings } as AgentMechanicModule
}

const setting = (id: string, def: number) => ({ id, label: id, description: id, default: def })

describe('registry settings 跨模块同 id 命名空间', () => {
  it('正主与 beta 副本同名滑块可并存，全局索引首注册优先', () => {
    registerAgentMechanic(mod('live', ['9test1'], [
      setting('shared', 1),
      setting('onlyLive', 10),
    ]))
    // 不抛 = 注册成功（旧行为在这里 throw 'setting shared already registered'）
    registerAgentMechanic(mod('liveV1', ['9test1v1'], [
      setting('shared', 2),
      setting('onlyV1', 20),
    ]))

    const ids = new Map(getRegisteredMechanicSettings().map(s => [s.id, s.default]))
    expect(ids.get('shared')).toBe(1) // 首注册（活体）胜出，不是后注册的 2
    expect(ids.get('onlyLive')).toBe(10)
    expect(ids.get('onlyV1')).toBe(20)
  })

  it('用户值覆盖缺省：同名滑块两版共享同一取值', () => {
    const resolved = resolveMechanicSettingMap({ shared: 9 })
    expect(resolved.shared).toBe(9)
    expect(resolved.onlyLive).toBe(10) // 未设值回落首注册缺省
  })

  it('模块内同 id 重复声明仍抛错', () => {
    expect(() =>
      registerAgentMechanic(mod('dupSelf', ['9test2'], [
        setting('a', 1),
        setting('a', 2),
      ])),
    ).toThrow('declares setting a twice')
  })

  it('agentId 重复注册仍抛错（beta 副本必须改 id）', () => {
    registerAgentMechanic(mod('another', ['9test3'], []))
    expect(() => registerAgentMechanic(mod('another2', ['9test3'], []))).toThrow('already registered')
  })
})
