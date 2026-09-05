/**
 * 落点不变性（原「种子不变性」，2026-08 立；2026-09-05 按用户口径改判据）。
 *
 * 原断言：任意初值 → **逐位**同一收敛态。它想防的是不动点滞回（12/3 vs 12/4 那种翻脸），
 * 但把"逐位相等"当成了目标本身——而那只是实数化收敛的**副产品**，不是游戏性质。
 * 实测 124 个预设里 13 队（10%）落点随初值变，其中 7 队只差浮点末位、2 队差 1 次、3 队差 2 次；
 * 而用户可见的稳定性（同配置连续计算不许变）由 warmStart / determinism 逐位守着，本文件不重复承担。
 * ⇒ 判据分两档，见 describe 上方注释。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { calcTeamResources } from '@/core/resource'
import { netFrontlineOccupation } from '@/core/resource/helpers'
import type { ResourceCalcConfig, IterationState } from '@/types/resource'

const captured: ResourceCalcConfig[] = []
vi.mock('@/core/resource', async () => {
  const actual = await vi.importActual<typeof import('@/core/resource')>('@/core/resource')
  return {
    ...actual,
    calcTeamResources: (config: ResourceCalcConfig) => {
      if (captured.length < 4) captured.push(JSON.parse(JSON.stringify(config)))
      return actual.calcTeamResources(config)
    },
  }
})

beforeEach(() => {
  mockStaticFetch()
})

/** 高种子：模拟「从上次收敛态/任意邻域初值出发」的极端情形 */
function inflatedSeed(cfg: ResourceCalcConfig): IterationState[] {
  return cfg.characters.map(c => ({
    basicAttackTime: 5,
    exSpecialCount: 50,
    ultimateCount: 8,
    chainCountTotal: c.chainCountTotalOverride ?? c.chainCountPerStun * 4,
    totalEnergy: 9999,
    totalDecibel: 99999,
    necessaryTime: 50,
    frontlineTime: 60,
    backstageTime: 120,
    comboAlignTime: 10,
  }))
}

function fingerprint(rr: ReturnType<typeof calcTeamResources>) {
  return {
    counts: rr.characters.map(c => `${c.exSpecialCount}/${c.ultimateCount}`),
    basics: rr.characters.map(c => (c.timeAllocation as any).basicAttackTime.toFixed(6)),
    decibels: rr.characters.map(c => ((c as any).decibelSource?.total ?? 0).toFixed(6)),
    converged: rr.converged,
  }
}

async function setupCapture(team: [string, string, string], engines: [string, string, string]) {
  captured.length = 0
  newPinia()
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (let s = 0; s < 3; s++) {
    config.setAgent(s, team[s])
    if (engines[s]) config.setWEngine(s, engines[s])
  }
  const calc = useResourceCalc()
  void calc.resourceResult.value
  expect(captured.length).toBeGreaterThan(0)
  return JSON.parse(JSON.stringify(captured[0])) as ResourceCalcConfig
}

/**
 * 落点判据分两档（用户口径 2026-09-05「以游戏逻辑为主，检测也该改」）：
 *
 * - **逐位相等**：只留给**已完成实数化松弛**的角色（伊德海莉 targeted 前例 + 2026-09-06 起
 *   星徽·比利链数实数化）。对它们逐位是可达标准，放松等于放弃已有成果——所以这条不降档。
 * - **游戏等价**（已无用例，保留档位说明）：未实数化的整数结构模块队从荒谬初值出发可以落到
 *   相邻整数组合（"这一轮多打一次强特"本来就是手法差异，不是 bug）；**逐位相等从来不是游戏
 *   性质，而是实数化收敛的副产品**。原比利/琉音样例 2026-09-06 升回逐位后，本档暂无驻场
 *   用例——再有新的整数结构模块队回归到此档。
 */
describe('连续松弛·落点不变性', () => {
  it('伊德海莉+莱卡恩+卢西娅（已实数化）：零种子 vs 高种子 → 逐位同一收敛态', async () => {
    const cfg = await setupCapture(['1051', '1141', '1451'], ['14105', '', '14145'])
    const cold = calcTeamResources(JSON.parse(JSON.stringify(cfg)))
    const hot = calcTeamResources({ ...JSON.parse(JSON.stringify(cfg)), initialStates: inflatedSeed(cfg) })
    const fc = fingerprint(cold), fh = fingerprint(hot)
    console.log('cold', JSON.stringify(fc)); console.log('hot ', JSON.stringify(fh))
    expect(fh).toEqual(fc)
    expect(cold.converged).toBe(true)
  })

  it('星徽·比利+琉音+卢西娅（比利链数已实数化）：零种子 vs 高种子 → 逐位同一收敛态', async () => {
    const cfg = await setupCapture(['1531', '1481', '1451'], ['13019', '', '14145'])
    const cold = calcTeamResources(JSON.parse(JSON.stringify(cfg)))!
    const hot = calcTeamResources({ ...JSON.parse(JSON.stringify(cfg)), initialStates: inflatedSeed(cfg) })!
    // 2026-09-06 比利链数实数化（1051 骨架）：本队升回逐位档——次数/平A/喧响全部逐位相等
    const fc = fingerprint(cold), fh = fingerprint(hot)
    expect(fh).toEqual(fc)
    // 两种初值都必须过硬不变量：净占用不超战斗时间（超了就是"声称打了 190s"）。
    // 留白不在这里断言——那是 timeFillRatchet 逐队钉的（125 队各有基线）。
    const budget = cfg.totalTime - (cfg.invincibleTime ?? 0)
    const used = netFrontlineOccupation(cold)
    expect(used).toBeLessThanOrEqual(budget + 1)
    expect(cold.converged).toBe(true)
    expect(hot.converged).toBe(true)
  })
})
