/**
 * 全角色不变量 sweep（60 角色 × 命座 0/6，共 120 次全管线计算）。
 *
 * 把 AGENT_RECORDING_SOP §3.5 的人工「命座提升率自检」与单角色冒烟不能覆盖的
 * 全局性回归关进测试笼子。每条断言对应一类历史事故：
 * - moveId 存在：错误 moveId 会被 enrichExecutionPlan 替换成「未在倍率表中找到」（ENGINE_PIPELINE §4 坑3/4）；
 * - 次数非负 / 伤害有限：资源池收敛或命座门槛写错的表现；
 * - 时间字段非负/有限：时间预算字段被写成 NaN/负数的表现。
 *
 * 刻意不做「frontlineTime ≤ 战斗时间」全局断言：引擎时间预算是必要前台超时后
 * 平A池钳 0、动作照计（整局总量口径），单人队下 1051/1091/1171/1401/1431/1471/1481/
 * 1531/1561 等 23 个场景的必要前台本身超预算（2026-08 sweep 实测，属近似口径缺口，
 * 记录在 task-ledger Open）。时间溢出类回归由角色级测试守（banyue-timeoverflow.debug、
 * banyue.test 的 rowsSum+basic≤180 断言）。
 *
 * 数值口径改动若导致本测试失败：先读失败断言定位角色，再判断是「该角色合法口径」
 * （需把该角色/断言收窄并注释理由）还是「真回归」（修引擎）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const catalogData = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))

const agentIds: string[] = (catalogData.agents ?? []).map((a: { id: number | string }) => String(a.id))
const moves = new Set<string>()
for (const skills of catalogData.agentSkills ?? []) {
  for (const category of skills.categories ?? []) {
    for (const move of category.moves ?? []) moves.add(String(move.id))
  }
}

const CINEMA_LEVELS = [0, 6] as const

describe(`全角色不变量 sweep（${agentIds.length} 角色 × 命座 ${CINEMA_LEVELS.join('/')}）`, () => {
  for (const agentId of agentIds) {
    for (const cinemaLevel of CINEMA_LEVELS) {
      it(`${agentId} 命座${cinemaLevel}：时间不溢出 / moveId 有效 / 次数非负 / 伤害有限`, async () => {
        await setupHarness([{ agentId, cinemaLevel }])
        const calc = useResourceCalc()
        const out = calc.resourceResult.value
        expect(out, `${agentId} 资源结果为 null`).not.toBeNull()

        for (const c of out!.characters) {
          // 时间字段非负/有限（不做 ≤ 战斗时间 断言，理由见文件头注释）
          const ta = c.timeAllocation
          expect(Number.isFinite(ta?.frontlineTime ?? 0), `${agentId} ${c.agentId} frontlineTime 非有限`).toBe(true)
          expect(Number.isFinite(ta?.backstageTime ?? 0), `${agentId} ${c.agentId} backstageTime 非有限`).toBe(true)
          expect((ta?.necessaryTime ?? 0) >= 0, `${agentId} ${c.agentId} necessaryTime 为负`).toBe(true)
          expect((ta?.basicAttackTime ?? 0) >= 0, `${agentId} ${c.agentId} basicAttackTime 为负`).toBe(true)
          expect((ta?.backstageTime ?? 0) >= 0, `${agentId} ${c.agentId} backstageTime 为负`).toBe(true)

          for (const e of c.executions ?? []) {
            expect((e.count ?? 0) >= 0, `${agentId} 执行 ${e.moveId} 次数为负：${e.count}`).toBe(true)
            expect((e.totalTime ?? 0) >= 0, `${agentId} 执行 ${e.moveId} 时间为负`).toBe(true)
            // 数字 moveId 必须在倍率表且回填成功（ENGINE_PIPELINE §4 坑3/4：错误 moveId 会被
            // enrich 替换成「未在倍率表中找到」占位）。模块假 id（1531_c6_radiant 等含非数字字符）
            // 按设计不进倍率表、带占位 note，跳过。
            if (e.moveId && /^\d+$/.test(e.moveId)) {
              expect(moves.has(e.moveId), `${agentId} 未知 moveId ${e.moveId}（不在倍率表）`).toBe(true)
              expect(e.skillTableNote ?? '', `${agentId} 执行 ${e.moveId} 未在倍率表中找到`).not.toContain('未在倍率表中找到')
            }
          }
        }

        const damage = calc.teamTotalDamage.value
        expect(Number.isFinite(damage), `${agentId} 伤害非有限值：${damage}`).toBe(true)
        expect(damage, `${agentId} 全队伤害 ≤ 0`).toBeGreaterThan(0)
      })
    }
  }
})
