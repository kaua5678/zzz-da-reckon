/**
 * config 现场差分判据（T181，生产级「基线 + 差分」口径）。
 *
 * 这四条判据是「逐点明细按需重算」的**全部依据**——第 ③ 条（往返逐字节相同）一旦失守，
 * 重放出来的资源池就不是那个点的资源池，而页面不会报错（只会显示别的档的数字）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { captureState, dedupeSceneBases, deltaKeys, restoreStateDelta, stateDeltaOf } from '@/composables/configDelta'
import { applyBossRoom } from '@/composables/bossRoom'
import { teamPresets } from '@/data/teamPresets'
import { cloneConfigState } from '@/composables/analysisScenario'
import type { BossPresetFile } from '@/types/bossPreset'

const BOSS_FILE = JSON.parse(
  readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
) as BossPresetFile
/** 真实 Boss + 期（合成桩会因字段缺失而炸，见 applyBossPreset 的 monster/defaults 契约） */
const REAL_BOSS = BOSS_FILE.bosses.find(b => b.phases.length > 1)!

const plain = (v: unknown) => JSON.stringify(v)

describe('config 现场差分', () => {
  it('① 未改动 ⇒ 空差分；② 只改 team / mechanicSettings ⇒ 只记这两个键', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1021' }, { agentId: '1031' }, { agentId: '1131' }], { recommendedBuild: true })
    await catalog.loadBuildRecommendations()
    const base = captureState(config)
    expect(deltaKeys(stateDeltaOf(base, captureState(config)))).toEqual([])

    const preset = teamPresets[0]!
    applyBossRoom(config, REAL_BOSS, REAL_BOSS.phases[REAL_BOSS.phases.length - 1]!)
    config.setMechanicSetting('time.stunPlanProjection', 1)
    void preset
    const delta = stateDeltaOf(base, captureState(config))
    // 房间写入会动 enemy / globalBuffs / appliedBoss（applyBossPreset 的字段）⇒ 断言「变化键 ⊆ 期望集合」而非精确相等
    for (const k of deltaKeys(delta)) {
      expect(['team', 'mechanicSettings', 'enemy', 'globalBuffs', 'appliedBoss']).toContain(k)
    }
    expect(deltaKeys(delta)).toContain('mechanicSettings')
  })

  it('③ ★ 往返：restore(base, delta) 与采集时的现场逐字节相同（重放 = 那个点的现场）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1021' }, { agentId: '1031' }, { agentId: '1131' }], { recommendedBuild: true })
    await catalog.loadBuildRecommendations()
    const base = captureState(config)

    // 逐档改写（模拟难度曲线：换人 / 改机制设置 / 改交互次数 / 改权重）
    const steps: (() => void)[] = [
      () => { config.setAgent(0, '1141') },
      () => { config.setMechanicSetting('time.comboAlignAbsorbRatio', 0.25) },
      () => { config.setActionCount(0, 'parryCount', 7); config.setActionCount(1, 'dodgeCounterCount', 3) },
      () => { config.team[0]!.basicAttackTimeWeight = 2 },
      () => { config.setCinemaLevel(0, 6); config.setWEngineModLevel(1, 5) },
    ]
    for (const step of steps) {
      step()
      const now = captureState(config)
      const delta = stateDeltaOf(base, now)
      // 在**被污染的现场**上重放（先破坏，再还原——这才测得出「先整表写回基线」那一句）
      config.setAgent(1, '1511')
      config.setMechanicSetting('sentinel.polluted', 99)
      config.setActionCount(2, 'parryCount', 11)
      restoreStateDelta(config, base, delta)
      expect(plain(config.$state), '重放后的现场必须与采集时逐字节相同').toBe(plain(now))
    }
  })

  it('⑤ 基线去重：内容相同的两份归一成同一对象（省内存）；内容不同**不得**复用（否则重放写错现场）', () => {
    const a = { team: [{ agentId: '1611' }], mechanicSettings: {} }
    const sameContent = { team: [{ agentId: '1611' }], mechanicSettings: {} }
    const different = { team: [{ agentId: '1141' }], mechanicSettings: {} }
    const [x, y, z, undef] = dedupeSceneBases([a, sameContent, different, undefined])
    expect(x, '第一份原样保留').toBe(a)
    expect(y, '内容相同 ⇒ 复用同一个对象（省一份 10.9KB 的拷贝）').toBe(a)
    expect(z, '内容不同 ⇒ 绝不复用').toBe(different)
    expect(undef, 'undefined 原样通过（该行没采现场）').toBeUndefined()
  })

  it('④ 差分确实更省：典型档位差分 < 整份现场的 1/3，且结构化克隆可传（worker 边界）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1021' }, { agentId: '1031' }, { agentId: '1131' }], { recommendedBuild: true })
    await catalog.loadBuildRecommendations()
    const base = captureState(config)
    config.setMechanicSetting('time.comboAlignAbsorbRatio', 0.4)
    config.setActionCount(0, 'parryCount', 5)
    const now = captureState(config)
    const delta = stateDeltaOf(base, now)
    const full = JSON.stringify(now).length
    const diff = JSON.stringify(delta).length
    expect(diff).toBeLessThan(full / 3)
    expect(() => structuredClone(delta)).not.toThrow()
    // 与整份现场一样能被 cloneConfigState 处理（undefined / NaN 保留）
    expect(() => cloneConfigState(delta)).not.toThrow()
  })
})