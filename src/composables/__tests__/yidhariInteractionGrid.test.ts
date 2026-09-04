/**
 * 伊德海莉 refund 反馈双稳态护栏（2026-09-04）：
 * 极寒重碾非失衡每发回 15 闪能 = 自指反馈（ex 同时出现在能量方程两侧）。旧实现回读上一轮
 * 整数强特次数再 floor → 同一输入在物理区间内存在多个整数不动点（19/20/21），落点依赖种子
 * （零种子 vs 高种子/热启动不同收敛态，曾现于 parry4/dodge10、parry8/dodge2 等交互组合）。
 *
 * 修复口径（用户：floor 应该最后算，不在迭代中途截断资源循环）：
 * - calcEnergySource 对 refund 反馈解析求解（E0/(消耗−15)），迭代期 refund 与强特次数均为实数；
 * - 必要时间信道用实数终结技期望（喧响/消耗），消除喧响阈值处整数大招 4↔5 翻转造成的 2-循环；
 * - 终局整数重推（calcTeamResources ≤3 轮）：floor 一次后重收敛，结果整数、种子无关。
 *
 * 本测试锁死：她的全交互网格上 零种子 vs 高种子 逐位一致、收敛、次数为整数。
 * 若修复被回退（如改回“迭代期 floor + 回读整数次数”），本网格会出现 BAD 点。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { calcTeamResources } from '@/core/resource'
import type { ResourceCalcConfig, IterationState } from '@/types/resource'

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
    // 平A时间到 1e-3 s：引擎外层时间预算判据自身是 maxExcess ≤ 1e-6 + 首轮 refund 冻结
    // （测量相关残余 ~1e-6 s 量级），6 位小数是比引擎判据更严的精度，锁 3 位即可。
    basics: rr.characters.map(c => (c.timeAllocation as any).basicAttackTime.toFixed(3)),
    decibels: rr.characters.map(c => ((c as any).decibelSource?.total ?? 0).toFixed(2)),
    converged: rr.converged,
  }
}

async function baseConfig(): Promise<ResourceCalcConfig> {
  newPinia()
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  config.setAgent(0, '1051'); config.setWEngine(0, '14105')
  config.setAgent(1, '1141')
  config.setAgent(2, '1451'); config.setWEngine(2, '14145')
  config.setQuickAssistCount(0, 3)
  config.setChainCountPerStun(0, 1)
  const calc = useResourceCalc()
  // 轮询等 pipeline 装配完成（就绪门：teammate-buffs 落位后 resourceConfig 才非 null）
  let cfg: ResourceCalcConfig | null = null
  for (let i = 0; i < 50; i++) {
    void calc.resourceResult.value
    const v = calc.resourceConfig.value
    if (v && v.characters.length === 3) {
      cfg = JSON.parse(JSON.stringify(v)) as ResourceCalcConfig
      break
    }
    await new Promise(r => setTimeout(r, 10))
  }
  expect(cfg, 'pipeline 装配超时（resourceConfig 未就绪）').toBeTruthy()
  return cfg!
}

describe('伊德海莉 refund 双稳态护栏（交互网格 × 种子）', () => {
  it('parry×dodge 网格：零种子 vs 高种子 逐位一致、收敛、整数次数', async () => {
    const base = await baseConfig()
    for (let parry = 0; parry <= 8; parry += 2) {
      for (let dodge = 0; dodge <= 10; dodge += 2) {
        const cfg = JSON.parse(JSON.stringify(base)) as ResourceCalcConfig
        cfg.characters[0].parryCount = parry
        cfg.characters[0].dodgeCounterCount = dodge
        const cold = calcTeamResources(JSON.parse(JSON.stringify(cfg)))
        const hot = calcTeamResources({ ...JSON.parse(JSON.stringify(cfg)), initialStates: inflatedSeed(cfg) })
        expect(fingerprint(hot), `parry=${parry} dodge=${dodge} 种子应无关`).toEqual(fingerprint(cold))
        expect(cold.converged, `parry=${parry} dodge=${dodge} 应收敛`).toBe(true)
        expect(Number.isInteger(cold.characters[0].exSpecialCount), `parry=${parry} dodge=${dodge} 终局次数应为整数`).toBe(true)
      }
    }
  })
})
