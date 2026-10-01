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
import { teamGoldOf } from '@/composables/teamCompare'

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
        // 内联恢复：整表回写失衡轴方案（arena-D 第 368 轮起轴状态只经 store 的 setAxisState / applyStunAxisPreset；
        // 修前 difficultyLadder 用 `ctx.config.` 前缀抄了一份，旧正则只认 `configStore.` 没拦住）
        if (!rel.split('\\').join('/').endsWith('stores/config.ts') && /stunAxisPlans(\.value)?\.splice\(0,\s*[\w.]*stunAxisPlans(\.value)?\.length,\s*\.\.\./.test(src)) hits.push(`${rel}:restore`)
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })

  it('CC-340：appliedBoss 深拷贝 + mechanicSettings / timeWeightStrategy 闭环恢复（防 syncBossInteractionPlan 原地改写与 guarantee.stun 泄漏）', async () => {
    const { config } = await setupHarness([{ agentId: '1191' }, { agentId: '1211' }, { agentId: '1311' }])
    const zeroRes = { physical: 0, fire: 0, ice: 0, electric: 0, ether: 0 }
    config.applyBossPreset(
      { id: 'b-test' },
      { phaseId: 'p1', hp: 10000000, stunValue: 4000, defense: 953, level: 70, bossAnomalyCoeff: 0.875, damageResistances: zeroRes, stunResistances: zeroRes, anomalyResistances: zeroRes },
      { stunVuln: 150, stunTime: 15 },
      { battleTime: 180, shieldCount: 0, energyShield: 0, parryTotal: 4, parryNoFollowUpTotal: 0, counterAssistGroups: [2, 2] },
    )
    // 1191 队内无反制支援角色（counterAssistSlot = -1），2 组控制技折入弹刀：parryTotal = 4 + 2 = 6
    expect(config.appliedBoss?.parryTotal).toBe(6)
    delete config.mechanicSettings['guarantee.stun']
    config.timeWeightStrategy = 'static'

    const snap = snapshotStore(config)
    // 模拟分析器换入带反制支援的角色（1611 克拉蕾 → counterAssistSlot = 0，触发 syncBossInteractionPlan 将 parryTotal 改为 4）+ 写入 guarantee.stun=1
    config.setAgent(0, '1611')
    expect(config.appliedBoss?.parryTotal).toBe(4)
    expect(snap.appliedBoss?.parryTotal, '快照里的 appliedBoss 不能被 syncBossInteractionPlan 原地改写').toBe(6)
    config.setMechanicSetting('guarantee.stun', 1)
    config.timeWeightStrategy = 'balanced'

    restoreStore(config, snap)
    expect(config.appliedBoss?.parryTotal).toBe(6)
    expect(config.mechanicSettings['guarantee.stun']).toBeUndefined()
    expect(config.timeWeightStrategy).toBe('static')
  })

  it('T1：globalBuffs 深拷贝恢复（同一份快照反复恢复后原地改写 store 不污染快照）', async () => {
    const { config } = await setupHarness([{ agentId: '1191' }, { agentId: '1211' }, { agentId: '1311' }])
    config.globalBuffs.push({ id: 'test-gb', name: '测试增益', stat: 'atkPct', value: 25, enabled: true })
    const snap = snapshotStore(config)

    config.globalBuffs.splice(0)
    restoreStore(config, snap)
    const restored = config.globalBuffs.find(b => b.id === 'test-gb')
    expect(restored?.value).toBe(25)

    // 恢复后原地改写 store 内的行，再次恢复仍应回到快照原值 25
    restored!.value = 99
    restoreStore(config, snap)
    expect(config.globalBuffs.find(b => b.id === 'test-gb')?.value).toBe(25)
  })

  it('CC-340：setAgent(slot, "") 清空空槽音擎，且 teamGoldOf 跳过空槽不计残留限定音擎金数', async () => {
    const { config } = await setupHarness([{ agentId: '1191' }, { agentId: '1371', wEngineId: '14137' }, { agentId: '1311' }])
    expect(config.team[1].wEngineId).toBe('14137')
    config.setAgent(1, '')
    expect(config.team[1].agentId).toBe('')
    expect(config.team[1].wEngineId, '清空角色槽位时必须同步清空 wEngineId').toBe('')
    expect(teamGoldOf(['1191', '', ''], ['14119', '14137', '14137'], [0, 2, 2], [1, 5, 5])).toBe(2)
  })
})
