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
 * 本测试锁死：她的全交互网格上 收敛、次数为整数。
 * （CC-147，2026-09-28：原「零种子 vs 高种子逐位一致」一档随注入种子通道删除——引擎恒从默认种子
 * 起跑，种子无关由构造保证，不再可测也不再需要测。）
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { calcTeamResources } from '@/core/resource'
import type { ResourceCalcConfig } from '@/types/resource'

beforeEach(() => {
  mockStaticFetch()
})

async function baseConfig(): Promise<ResourceCalcConfig> {
  newPinia()
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  config.setAgent(0, '1051'); config.setWEngine(0, '14105')
  config.setAgent(1, '1141')
  config.setAgent(2, '1451'); config.setWEngine(2, '14145')
  config.setActionCount(0, 'quickAssistCount', 3)
  config.setActionCount(0, 'chainCountPerStun', 1)
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

describe('伊德海莉 refund 双稳态护栏（交互网格）', () => {
  // 显式超时：本用例跑 5×6 网格 = 30 次完整 calcTeamResources（单跑 ~1.6s），
  // 全量并行下会被 CPU 竞争拖到 5s 以上而撞 vitest 默认 5000ms 上限（2026-09-10 实测 5535ms 假红）。
  it('parry×dodge 网格：收敛、整数次数', async () => {
    const base = await baseConfig()
    for (let parry = 0; parry <= 8; parry += 2) {
      for (let dodge = 0; dodge <= 10; dodge += 2) {
        const cfg = JSON.parse(JSON.stringify(base)) as ResourceCalcConfig
        cfg.characters[0].parryCount = parry
        cfg.characters[0].dodgeCounterCount = dodge
        const cold = calcTeamResources(JSON.parse(JSON.stringify(cfg)))
        expect(cold.converged, `parry=${parry} dodge=${dodge} 应收敛`).toBe(true)
        expect(Number.isInteger(cold.characters[0].exSpecialCount), `parry=${parry} dodge=${dodge} 终局次数应为整数`).toBe(true)
      }
    }
  }, 30_000)
})
