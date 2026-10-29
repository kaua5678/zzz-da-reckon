/**
 * 「当前显示哪一期」的判据（2026-10-29）：`composables/phaseSelection.ts`。
 *
 * 用户实报：「点了部署，切到属性配置，他部署的 boss 和 buff 也没有自动勾选」。
 * 根因不在写入侧（实测 store 里 appliedBoss=40012/690481 + 2 行 layer-buff enabled 都对），
 * 而在**显示侧**：两个卡各自「默认 = 最新一期」，而归档快照最新一季（690481）比期视图最新一期（690501）**晚一季**
 * ⇒ 页面停在 690501 这个归档里一条 run 都没有的期上，于是「已应用」标不显示、环境卡还报「本期还没有应用 Boss」。
 *
 * 本文件锁两条：① 默认期的优先序（含真数据的判别性）；② 响应式派生（部署 / 换 Boss 后自动跟上，不需要重挂页面）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { defaultPhaseIdOf, usePhaseSelection } from '@/composables/phaseSelection'
import { latestPhaseIdOf, sortedPhaseViews } from '@/utils/phaseBuff'
import type { BossPresetFile } from '@/types/bossPreset'
import type { RunArchiveFile } from '@/composables/runArchiveImport'
import { submissionToDeploy } from '@/composables/runArchiveImport'
import type { BossPreset } from '@/types/bossPreset'

const bp = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
const ra = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as RunArchiveFile
const presets = bp.bosses as BossPreset[]

describe('defaultPhaseIdOf：已应用房间的期 ＞ 候选首项', () => {
  const listed = ['690501', '690491', '690481']

  it('已应用房间的期在候选里 ⇒ 用它（不是最新一期）', () => {
    expect(defaultPhaseIdOf(listed, '690481')).toBe('690481')
  })

  it('没应用 Boss（null / undefined）⇒ 最新一期（候选首项，调用方按新→旧给）', () => {
    expect(defaultPhaseIdOf(listed, null)).toBe('690501')
    expect(defaultPhaseIdOf(listed, undefined)).toBe('690501')
  })

  it('已应用相位不在候选里（数据漂移 / 没有期视图）⇒ 回落最新一期，不摆一个选不出来的期', () => {
    expect(defaultPhaseIdOf(listed, '999999')).toBe('690501')
  })

  it('候选为空 ⇒ 空串（页面显示空态，不编一期）', () => {
    expect(defaultPhaseIdOf([], '690481')).toBe('')
  })
})

describe('usePhaseSelection：响应式派生（部署 / 换 Boss 后页面自动跟上）', () => {
  it('appliedBoss 从「没有」变成「部署了 690481」⇒ selected 跟着变（不需要重挂页面）', () => {
    const applied = ref<string | null>(null)
    const { selected } = usePhaseSelection(() => ['690501', '690481'], () => applied.value)
    expect(selected.value).toBe('690501')
    applied.value = '690481'
    expect(selected.value, '部署后必须切到部署的那一期').toBe('690481')
  })

  it('用户手选之后不再被 appliedBoss 拽走', () => {
    const applied = ref<string | null>(null)
    const { selected, pick } = usePhaseSelection(() => ['690501', '690481'], () => applied.value)
    pick('690501')
    applied.value = '690481'
    expect(selected.value, '用户选过就听用户的').toBe('690501')
  })

  it('手选不在候选里的期 ⇒ 忽略（不摆一个选不出来的期）', () => {
    const { selected, pick } = usePhaseSelection(() => ['690501', '690481'], () => null)
    pick('999999')
    expect(selected.value).toBe('690501')
  })
})

describe('真数据：这条口径必须有判别力（否则判据本身是摆设）', () => {
  it('★ 归档快照里最新那条 run 的期 ≠ 期视图最新一期 ⇒ 默认期必须取前者', () => {
    const viewIds = sortedPhaseViews(bp).map(v => v.phaseId)
    const seasons = [...new Set(ra.runs.map(r => r.seasonId))]
      .sort((a, b) => (ra.seasons[b]?.start ?? '').localeCompare(ra.seasons[a]?.start ?? ''))
    const run = ra.runs.find(r => r.seasonId === seasons[0])!
    const room = ra.rooms[run.targetId]
    const deploy = submissionToDeploy(run, room, presets, room?.seasonStart)
    const appliedPhaseId = deploy.boss?.phaseId ?? null

    expect(appliedPhaseId, '归档最新一季必须能解析出相位').toBeTruthy()
    expect(latestPhaseIdOf(bp), '前提：期视图最新一期确实在归档里没有 run').not.toBe(appliedPhaseId)
    expect(defaultPhaseIdOf(viewIds, appliedPhaseId), '默认期 = 部署的那一期').toBe(appliedPhaseId)
    // 反证：修前的「一律最新期」会停在另一期上（这条判据能区分新旧两种实现）
    expect(defaultPhaseIdOf(viewIds, null)).toBe(latestPhaseIdOf(bp))
  })
})
