/**
 * 分析器独立场景（composables/analysisScenario，r369）判据：
 * ① 出生态 = 源现场（含 watcher 敏感字段：非缺省副词条上限 + 手改副词条、手动关掉的队友 buff、Boss 房间），
 *    下一拍 watcher 跑完后仍相同；反例：出生之后再逐键注水，副词条 watcher 下一拍把配装刷回推荐值
 *    ——这条反例锁住「initialState 必须在 watcher 注册之前写入」（stores/config.ts「独立场景出生态」段）；
 * ② 隔离：场景内换人 / 进 Boss 房间 / 改机制设置 / 求值，源 store 的 $state 与 UI 计算结果都不变；
 * ③ 等值：同一现场，场景 calc 与 UI calc 的队伍总伤逐位相同，两边同步改写后仍相同；
 * ④ 源码锁：createResourceCalc 函数体不查全局 store；已迁移分析器不调 useConfigStore()、不做快照恢复。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'
import { setupHarness } from '@/test/harness'
import { createConfigModel } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyBossRoom } from '@/composables/bossRoom'
import { cloneConfigState, createAnalysisScenario, withAnalysisScenario } from '@/composables/analysisScenario'
import { SUBSTAT_CAP_SETTING } from '@/core/substatOptimizer'
import type { BossPresetFile } from '@/types/bossPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

/** 已迁到独立场景的分析器（迁一个加一个；进度表见 docs/mcp-analyzer-scenario-isolation.md §4） */
const MIGRATED_ANALYZERS = ['../charIncrement.ts', '../teamTimeline.ts', '../teamTimelineFilm.ts', '../pullPlannerEngine.ts', '../freeCompare/engine.ts', '../positionCompare.ts', '../difficultyCurve.ts', '../teamCompare.ts', '../impactSampling.ts', '../mainStatMarginal.ts', '../cinemaUplift.ts']

/** 让 pre-flush watcher 与宏任务都跑完 */
async function flush(): Promise<void> {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
}

const plain = (v: unknown): string => JSON.stringify(v)

/** 一个「watcher 敏感」的源现场：每一项都是朴素注水会被改写、或快照曾漏掉的字段 */
async function customizedSource() {
  const { catalog, config } = await setupHarness([{ agentId: '1021' }, { agentId: '1031' }, { agentId: '1131' }], { recommendedBuild: true })
  // 非缺省副词条上限：UI store 自己的 watcher 会重刷推荐配装——先让它跑完
  config.setMechanicSetting(SUBSTAT_CAP_SETTING, 18)
  await flush()
  // 再手改 0 号位副词条（≠ 推荐值）
  const alloc = (config.team[0]!.driveDisc.subStatAllocation ?? {}) as Record<string, number>
  const [stat, count] = Object.entries(alloc).sort((a, b) => b[1] - a[1])[0]!
  config.setSubStatCount(0, stat, count - 1)
  // 手动关掉一个已启用的队友 buff
  const enabledId = Object.entries(config.teammateBuffSelections).find(([, s]) => s.enabled)?.[0]
  if (enabledId) config.teammateBuffSelections[enabledId]!.enabled = false
  // Boss 房间：敌人参数 + appliedBoss + 关卡 buff 行
  const preset = bossData.bosses.find(b => b.phases.length > 1)!
  applyBossRoom(config, preset, preset.phases[preset.phases.length - 1]!)
  await flush()
  return { catalog, config, preset }
}

describe('分析器独立场景', () => {
  it('① 出生态 = 源现场（含 watcher 敏感字段），watcher 下一拍也不改写', async () => {
    const { config } = await customizedSource()
    const scenario = createAnalysisScenario()
    try {
      expect(Object.keys(scenario.config.$state)).toEqual(Object.keys(config.$state))
      expect(plain(scenario.config.$state)).toBe(plain(config.$state))
      await flush()
      expect(plain(scenario.config.$state)).toBe(plain(config.$state))
    } finally {
      scenario.dispose()
    }
  })

  it('① 反例：出生之后逐键注水，副词条 watcher 下一拍把配装刷回推荐值', async () => {
    const { catalog, config } = await customizedSource()
    const scope = effectScope(true)
    try {
      const naive = scope.run(() => reactive(createConfigModel(catalog)))! as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(config.$state)) naive[key] = cloneConfigState(value)
      expect(plain(naive.team)).toBe(plain(config.team))
      await flush()
      expect(plain(naive.team)).not.toBe(plain(config.team))
    } finally {
      scope.stop()
    }
  })

  it('② 隔离：场景内换人 / 进 Boss 房间 / 改设置 / 求值，源 store 与 UI 计算都不变', async () => {
    const { catalog, config, preset } = await customizedSource()
    const uiCalc = useResourceCalc()
    const uiDamage = uiCalc.teamTotalDamage.value
    const before = plain(config.$state)
    const other = catalog.displayAgents.find(a => !a.hidden && !config.team.some(c => c.agentId === a.id))!
    await withAnalysisScenario(async scenario => {
      scenario.config.setAgent(0, other.id)
      applyBossRoom(scenario.config, preset, preset.phases[0]!)
      scenario.config.setMechanicSetting('test.scenario-sentinel', 37)
      expect(scenario.calc.teamTotalDamage.value).toBeGreaterThan(0)
      await flush()
      expect(scenario.config.team[0]!.agentId).toBe(other.id)
      expect(plain(scenario.config.$state)).not.toBe(before)
      expect(plain(config.$state)).toBe(before)
    })
    expect(plain(config.$state)).toBe(before)
    expect(uiCalc.teamTotalDamage.value).toBe(uiDamage)
  })

  it('③ 等值：同一现场，场景与 UI 的队伍总伤逐位相同；两边同步改写后仍相同', async () => {
    const { config, preset } = await customizedSource()
    const uiCalc = useResourceCalc()
    const scenario = createAnalysisScenario()
    try {
      const ui0 = uiCalc.teamTotalDamage.value
      expect(ui0).toBeGreaterThan(0)
      expect(scenario.calc.teamTotalDamage.value).toBe(ui0)
      const phase = preset.phases[0]!
      applyBossRoom(config, preset, phase)
      applyBossRoom(scenario.config, preset, phase)
      expect(scenario.calc.teamTotalDamage.value).toBe(uiCalc.teamTotalDamage.value)
    } finally {
      scenario.dispose()
    }
    expect(() => scenario.dispose()).not.toThrow()
  })
})

describe('源码锁', () => {
  it('④ createResourceCalc 函数体不查全局 store；已迁移分析器不调 useConfigStore()、不做快照恢复', () => {
    const urc = readFileSync(new URL('../useResourceCalc.ts', import.meta.url), 'utf8')
    const at = urc.indexOf('export function createResourceCalc(')
    expect(at).toBeGreaterThan(0)
    expect(urc.slice(at)).not.toMatch(/use(Config|Catalog)Store\(\)/)
    for (const rel of MIGRATED_ANALYZERS) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      expect(src, rel).not.toMatch(/useConfigStore\(\)/)
      expect(src, rel).not.toMatch(/\b(snapshotStore|restoreStore)\(/)
    }
  })

  it('④b CC-278：不许再把「现场快照 / 恢复」抄回来（函数名锁拦不住的形态；configSnapshot.ts 已随 S3 删除）', () => {
    // 搬自 configSnapshot.test.ts（r372 S3 删该模块时保留）：函数名锁只能拦住叫 snapshotStore / restoreStore 的副本，
    // 拦不住把 configStore.team 打包深拷贝的**内联**快照——charIncrement / pullPlannerEngine 当初正是各抄了一份，
    // 漏掉队友 buff 选择（CC-278）。现在全部分析器都该在独立场景上跑，任何形式的现场打包都是回退。
    const root = resolve(__dirname, '../..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        const src = readFileSync(p, 'utf-8')
        const rel = relative(root, p).split('\\').join('/')
        // 内联快照：把 configStore.team 与其它字段打包深拷贝
        if (/JSON\.stringify\(\{\s*team:\s*configStore\.team\b/.test(src)) hits.push(`${rel}:snapshot`)
        // 内联恢复：整表回写失衡轴方案（轴状态只经 store 的 setAxisState / applyStunAxisPreset）
        if (rel !== 'stores/config.ts' && /stunAxisPlans(\.value)?\.splice\(0,\s*[\w.]*stunAxisPlans(\.value)?\.length,\s*\.\.\./.test(src)) hits.push(`${rel}:restore`)
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
