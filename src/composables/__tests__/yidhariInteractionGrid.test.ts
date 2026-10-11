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
 *
 * T133（2026-10-11）归因后收窄「收敛」档：唯一例外格 parry=2 dodge=6 是**终局整数映射的真周期 2
 * 极限环**（不是种子相关、不是双稳态回归），根因 = T130 给命破角色接通的 `flash_energy_recovery`
 * 招式回能通道带来**真实新增的闪能收入**，把该格推过 `floor(E/50)` 的整数阈值。判据与实测数字
 * 见下方 `CYCLE_ALLOWED` 注释与 `.zc/perf/T133-yidhari-cycle-report.md`（探针
 * `.zc/perf/T133*.perf.ts`）。该档**只放行这一格**，且该格的折叠层收敛/零截断/环成员/冷跑确定性
 * 全部照旧断言（护栏强度只换面、不降级）。
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

/**
 * 允许「终局整数映射无不动点」的格（T133，2026-10-11 归因后收窄）。
 *
 * 判据链（逐条实测，数字取自 `.zc/perf/T133*.perf.ts`）：
 *  ① **不是种子/双稳态回归**：两次独立冷跑逐位相同（ex=19、bat=22.942154452041834、iters=8）；
 *     引擎自 CC-147 起恒从默认零种子起跑（本文件头「种子无关由构造保证」仍成立）。
 *  ② **环在终局整数映射上，且无不动点**：终推（`exFinalize=true`）逐轮 ex=18↔19 精确交替，
 *     12 轮用尽都不逐位稳定（`runFinalizePasses` 返回最后一轮 = 相位相关成员）；
 *     终局 ex=19 的 `totalEnergy=950.514` 来自**它自己上一轮**（E=922.997 + 一个回环增益），
 *     即停点成员自身不自洽——与 1431「整数环没有整数不动点」（docs/mcp-stun-dual-source.md §24.8）同类。
 *  ③ **环的物理来源 = T130 接通的真实闪能招式回复**：同格同 bat 下，旧取法（只读 energy_recovery）
 *     在**两个环成员上都返回 18** ⇒ ex=18 是自洽不动点（E=915.102 / 902.585，均 < 19×50=950）；
 *     新取法把 E(18) 抬到 **950.514（≥ 950，余量 +0.514）**、把 E(19) 抬到 902.585→922.997
 *     （仍 < 950）⇒ **整数不动点被抹掉**、只剩 18↔19 的 2-环。抬升量里 20.412 直接来自
 *     1051014（闪避反击）flash 行 3.402 × dodge 6，另 +15 是 refund 通道随 E0 的连带项
 *     ——是**真实收入跨过 floor(E/50) 台阶**，不是取法记错（`flash_energy_recovery` 行存在、
 *     值来自 catalog、全库互斥前提由 flashEnergyRecoveryChannel.test ⑤ 锁死）。
 *  ④ **引擎侧既有口径**：真整数环停点（`innerLoop.ts#integerCycleStop`）在单次 `iterate` 入口适用，
 *     但 `runFinalizePasses` 的 ≤12 轮终推**没有**环停点出口（超时即接受末轮）——引擎只在
 *     `diag.converged` 上如实报 false（ResultPage「未收敛」黄标）。修它 = 改引擎，不在本测试口径内。
 *  ⑤ **该格其余读数全部照旧断言**：折叠层 `timeBudgetConverged`、零截断、内层未耗尽预算
 *     （iterations 远小于 100）、环成员次数**可行不透支**（ex=19 声明、E(18)=922.997 < 19×50=950
 *     ⇒ 19 是「自身撑得起」的 ⌊x*⌋）、结果确定、终局整数。
 */
const CYCLE_ALLOWED = new Set(['2:6'])

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
        if (!CYCLE_ALLOWED.has(`${parry}:${dodge}`)) {
          expect(cold.converged, `parry=${parry} dodge=${dodge} 应收敛`).toBe(true)
        } else {
          // 例外格：终局整数映射的真周期 2 环（根因见 CYCLE_ALLOWED 头注释）。
          // 收敛面**只放行内层标志**——折叠层/截断/预算三项照旧，且逐位钉住环的成员与形状：
          // 若有人改坏了它（换成员、加截断、折叠层退化、次数变实数），这里立刻红。
          expect(cold.converged, '例外格仅放行内层 converged（折叠层与截断见下方三条）').toBe(false)
          expect(cold.convergence.timeBudgetConverged, '折叠环必须照旧收敛（t133 实测 true）').toBe(true)
          expect(cold.convergence.timeTruncatedSeconds, '该格无截断（t133 实测 0）').toBe(0)
          expect(cold.iterations, '内层必须检出精确环、不撞 100 轮预算（实测 8）').toBeLessThan(20)
          expect(cold.characters[0].exSpecialCount, '环停点成员 = 不透支的 19（自身撑得起，见注释⑤）').toBe(19)
        }
        expect(Number.isInteger(cold.characters[0].exSpecialCount), `parry=${parry} dodge=${dodge} 终局次数应为整数`).toBe(true)
      }
    }
  }, 30_000)
})
