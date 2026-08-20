/**
 * 全角色不变量 sweep（60 角色 × 命座 0/6，共 120 次全管线计算）。
 *
 * 把 AGENT_RECORDING_SOP §3.5 的人工「命座提升率自检」与单角色冒烟不能覆盖的
 * 全局性回归关进测试笼子。每条断言对应一类历史事故：
 * - 前台时间不溢出：模块 buildExecutions 物化专属动作行（雅霜月架势/叶瞬光飞光/柏妮思双喷/
 *   星徽比利EX链等）占用前台但曾未计入必要时间 → Σ执行行时间 > 战斗时间（般岳金身弹刀/双反
 *   漏计的同款 bug 泛化版，2026-08 引擎时间收敛外层循环修复）；容差 0.5s 吸收量化残差与合轴节约。
 * - moveId 存在：错误 moveId 会被 enrichExecutionPlan 替换成「未在倍率表中找到」（ENGINE_PIPELINE §4 坑3/4）；
 * - 次数非负 / 伤害有限：资源池收敛或命座门槛写错的表现；
 * - 时间字段非负/有限：时间预算字段被写成 NaN/负数的表现。
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

/** 逐 (角色, 命座) 记录全队伤害，供末尾的「命座必须有效果」不变量比对（零额外算力）。 */
const damageByAgentCinema = new Map<string, number>()

/** 命座状态表：agentId → 是否至少有一级命座被声明为已实现（implemented* 前缀） */
const constellations: Record<string, { cinemas?: { cinema: number; status?: string }[] }> =
  JSON.parse(readFileSync(new URL('../../../public/static/character-constellations.json', import.meta.url), 'utf8')).characters ?? {}
function declaresImplementedCinema(agentId: string): boolean {
  return (constellations[agentId]?.cinemas ?? []).some(c => String(c.status ?? '').startsWith('implemented'))
}

describe(`全角色不变量 sweep（${agentIds.length} 角色 × 命座 ${CINEMA_LEVELS.join('/')}）`, () => {
  for (const agentId of agentIds) {
    for (const cinemaLevel of CINEMA_LEVELS) {
      it(`${agentId} 命座${cinemaLevel}：时间不溢出 / moveId 有效 / 次数非负 / 伤害有限`, async () => {
        const { config } = await setupHarness([{ agentId, cinemaLevel }])
        const calc = useResourceCalc()
        const out = calc.resourceResult.value
        expect(out, `${agentId} 资源结果为 null`).not.toBeNull()
        const battleTime = config.enemy.battleTime ?? 180

        for (const c of out!.characters) {
          // 时间预算不变量（引擎时间收敛外层循环已保证）：执行计划前台时间 ≤ 战斗时间 + 容差
          const ta = c.timeAllocation
          expect(Number.isFinite(ta?.frontlineTime ?? 0), `${agentId} ${c.agentId} frontlineTime 非有限`).toBe(true)
          expect(Number.isFinite(ta?.backstageTime ?? 0), `${agentId} ${c.agentId} backstageTime 非有限`).toBe(true)
          expect(
            (ta?.frontlineTime ?? 0),
            `${agentId} ${c.agentId} 前台时间溢出：${(ta?.frontlineTime ?? 0).toFixed(2)}s > ${battleTime}s`,
          ).toBeLessThanOrEqual(battleTime + 0.5)
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
        damageByAgentCinema.set(`${agentId}:${cinemaLevel}`, damage)

        // 收敛可观测性（三层不动点都要落地，别只看内层）：
        // 时间预算外层耗尽上限 = 仍有执行行前台时间超出战斗时间（通常是模块推了占前台的行
        // 却没计入 estimateExSpecialTime）；失衡外层 maxIter = 反馈量还在变，结果可能停在非稳定点。
        const conv = out!.convergence
        expect(conv, `${agentId} 缺收敛诊断`).toBeTruthy()
        expect(
          conv.timeBudgetConverged,
          `${agentId} 命座${cinemaLevel} 时间预算外层未收敛：${conv.timeBudgetPasses} 轮后仍溢出 ${conv.timeBudgetResidualSeconds.toFixed(2)}s`,
        ).toBe(true)
        expect(
          conv.outerExit,
          `${agentId} 命座${cinemaLevel} 失衡外层耗尽迭代上限（${conv.outerRounds} 轮），失衡/异常反馈未稳定`,
        ).not.toBe('maxIter')
      })
    }
  }

  /**
   * 防死数据（AGENTS 规则 5 的自动化版）：命座必须真的进计算。
   *
   * 原先这条只有人工路径——去「资源利用率页·命座提升率」用肉眼找橙色「⚠无变化」。
   * 但上面的 sweep 已经把每个角色的命座0/命座6 全管线都算过了，比一下就是零额外算力，
   * 而「录了机制但没接进计算」正是本项目最高频的事故类型。
   *
   * 判据：命座状态表里至少有一级标了 implemented* 的角色，damage(C6) 必须 > damage(C0)。
   * 即便角色专属命座全是「未描述」，C3/C5 的通用技能等级+2 也会经 skillLevelBonus 抬倍率，
   * 因此单角色场景下这条对全部有状态表条目的角色都应成立。
   * 失败含义：该角色 0→6 命一分伤害都没多 → 命座效果没接进任何计算通道（死数据），
   * 或状态表把未实现的命座标成了 implemented（状态表撒谎）。
   */
  it('命座有效性不变量：声明已实现命座的角色，命座6 伤害必须高于命座0（防死数据）', () => {
    const offenders: string[] = []
    const missing: string[] = []
    for (const agentId of agentIds) {
      const d0 = damageByAgentCinema.get(`${agentId}:0`)
      const d6 = damageByAgentCinema.get(`${agentId}:6`)
      if (d0 == null || d6 == null) {
        missing.push(agentId)
        continue
      }
      if (!declaresImplementedCinema(agentId)) continue
      if (!(d6 > d0)) {
        offenders.push(`${agentId}（C0=${d0.toFixed(0)} → C6=${d6.toFixed(0)}，提升 ${(((d6 - d0) / d0) * 100).toFixed(3)}%）`)
      }
    }
    expect(missing, `以下角色缺少 sweep 伤害采样：${missing.join(', ')}`).toHaveLength(0)
    expect(
      offenders,
      `以下角色声明了已实现的命座，但 0→6 命伤害没有提升（命座效果未接进计算 = 死数据，或状态表标错）：\n  ${offenders.join('\n  ')}`,
    ).toHaveLength(0)
  })
})
