/**
 * 命座提升率分析器（analyzeCinemaUplift）的行为锁：把「机制录了但没接进计算」从人工肉眼
 * 自检升级成红灯。
 *
 * 背景：AGENTS 规则 5 要求每录一条命座效果后，去「资源利用率页·命座提升率」确认没有橙色
 * 「⚠无变化」角标——这是本项目最高频事故类型（死数据）的唯一检测手段，却只能靠人看。
 * 检测算法原先埋在 ResourceUtilizationPage.vue 里（含 store 改写 + nextTick），测试无法调用。
 * 抽到 composables/cinemaUplift.ts 后，这里锁三件事：
 *   ① 分析器不改坏现场（命座等级与失衡锁必须恢复原值）；
 *   ② 三态自检语义正确（ok / execLevel / unimplemented 的判据）；
 *   ③ 真实角色的已实现命座级别不会被判成 unimplemented。
 *
 * 全角色版的零成本不变量（60 角色 C0 vs C6 伤害必须有提升）在 allAgentsSweep.test.ts，
 * 本文件只覆盖分析器本身的逐级语义，避免重复烧 CI 时间。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { analyzeCinemaUplift, UPLIFT_EPSILON_PCT } from '@/composables/cinemaUplift'

const constellations: Record<string, { cinemas?: { cinema: number; status?: string }[] }> =
  JSON.parse(readFileSync(new URL('../../../public/static/character-constellations.json', import.meta.url), 'utf8')).characters ?? {}

/** 该角色某一级命座是否被状态表声明为「已实现」 */
function declaresImplemented(agentId: string, cinema: number): boolean {
  const entry = (constellations[agentId]?.cinemas ?? []).find(c => c.cinema === cinema)
  return String(entry?.status ?? '').startsWith('implemented')
}

async function analyze(agentId: string, mates: string[] = []) {
  const { config } = await setupHarness([{ agentId }, ...mates.map(id => ({ agentId: id }))])
  const calc = useResourceCalc()
  const catalogStore = useCatalogStore()
  const rows = await analyzeCinemaUplift({
    configStore: config,
    catalogStore,
    readDamage: () => calc.teamTotalDamage.value,
    readUltimateTotal: () => (calc.resourceResult.value?.characters ?? [])
      .reduce((sum, c) => sum + (c.ultimateCount ?? 0), 0),
    targetStunCount: calc.stunPoolResult.value?.stunCount ?? 4,
    slots: [0],
  })
  return { rows, config }
}

describe('analyzeCinemaUplift（命座提升率 + 死数据自检）', () => {
  it('不改坏现场：命座等级与失衡锁在返回前恢复原值', async () => {
    const { config } = await setupHarness([{ agentId: '1371', cinemaLevel: 2 }, { agentId: '1251' }, { agentId: '1271' }])
    const calc = useResourceCalc()
    const catalogStore = useCatalogStore()
    const stunLockBefore = config.enemy.stunCountLock
    const cinemasBefore = config.team.map(c => c?.cinemaLevel ?? 0)

    await analyzeCinemaUplift({
      configStore: config,
      catalogStore,
      readDamage: () => calc.teamTotalDamage.value,
      readUltimateTotal: () => 0,
      targetStunCount: calc.stunPoolResult.value?.stunCount ?? 4,
      slots: [0],
    })

    expect(config.team.map(c => c?.cinemaLevel ?? 0)).toEqual(cinemasBefore)
    expect(config.enemy.stunCountLock).toBe(stunLockBefore)
  })

  it('逐级返回 1..6 且字段自洽（gainPct 有限、warn 三态之一、ult 次数非负）', async () => {
    const { rows } = await analyze('1371', ['1251', '1271'])
    expect(rows).toHaveLength(1)
    const entries = rows[0].entries
    expect(entries.map(e => e.to)).toEqual([1, 2, 3, 4, 5, 6])
    for (const e of entries) {
      expect(Number.isFinite(e.gainPct), `命座${e.to} gainPct 非有限`).toBe(true)
      expect(['ok', 'execLevel', 'unimplemented']).toContain(e.warn)
      expect(e.ultBefore).toBeGreaterThanOrEqual(0)
      expect(e.ultAfter).toBeGreaterThanOrEqual(0)
    }
  })

  it('自检语义：面板有字段变化 → ok；无面板变化但有伤害提升 → execLevel（阈值 UPLIFT_EPSILON_PCT）', async () => {
    const { rows } = await analyze('1371', ['1251', '1271'])
    for (const e of rows[0].entries) {
      if (e.changedFields.length > 0) {
        expect(e.warn, `命座${e.to} 有面板变化却不是 ok`).toBe('ok')
      } else if (e.gainPct >= UPLIFT_EPSILON_PCT) {
        expect(e.warn, `命座${e.to} 无面板变化但有提升，应为 execLevel`).toBe('execLevel')
      } else {
        expect(e.warn).toBe('unimplemented')
      }
    }
  })

  it('防死数据：状态表声明已实现的命座级别不得被判为 unimplemented（仪玄/般岳/卢西娅）', async () => {
    for (const [agentId, mates] of [
      ['1371', ['1251', '1271']],
      ['1471', ['1481', '']],
      ['1451', ['1051', '']],
    ] as const) {
      const { rows } = await analyze(agentId, (mates as readonly string[]).filter(Boolean) as string[])
      const bad = rows[0].entries
        .filter(e => declaresImplemented(agentId, e.to) && e.warn === 'unimplemented')
        .map(e => `影画${e.to}（提升 ${e.gainPct.toFixed(3)}%）`)
      expect(
        bad,
        `${agentId} 以下命座在状态表标了已实现，但面板无变化且伤害无提升（死数据）：${bad.join('、')}`,
      ).toHaveLength(0)
    }
  })
})
