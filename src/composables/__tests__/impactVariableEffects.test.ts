/**
 * 伤害影响与响应面分析的变量表判据（2026-10-25，用户：可选变量太少，「比如 boss 防御就没让选」）。
 *
 * 判据针对的是「表里挂了字段、采样却是一条平线」这类静默缺陷——引擎不读的字段照样能进下拉、照样画得出曲线：
 * ① **每条静态变量都真的改变结果**：按变量自己的 `defaultRange` 两端各写一次，被观测的量必须不同。
 *    观测通道按语义分开：伤害类看队伍总伤；`stunResistance` 看失衡池总失衡值（它先改攒条、次数取整后未必改总伤）。
 *    抗性类按元素分区验证 ⇒ 每元素各有一支专属队伍（六张元素键不是只挂了个名字）。
 * ② **不可收录字段的反向判据**：`hp` / `level` 引擎不读（hp 只被消费端做「伤害 ÷ 血量」派生，等级系数是常量
 *    `LEVEL_COEFF_60`）⇒ 断言改了也不影响总伤。哪天它们有了伤害侧消费者，这条会红，届时才把字段加进表。
 * ③ **采样区间覆盖真实域**：boss-presets 的 159 个相位里出现过的取值必须落在 `defaultRange` 内，
 *    否则整条曲线落在真实域外（旧 `bossStunValue` 区间 [500,8000] 对真实域 14068~23277 就是这种情况）。
 * ④ **分组完整**：每条变量都有非空 group，且静态表按组连续排列（下拉组顺序 = 首次出现顺序，见 core 表注释）。
 *
 * 动态变量（机制设置 / 异放占比）的建表与读写由 `impactVariables.test.ts` 覆盖；采样隔离由 `impactSampling.test.ts` 覆盖。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { IMPACT_VARIABLES, type ImpactVariable } from '@/core/impactVars'
import { IMPACT_PRESET_PAIRS, impactVarOptions } from '@/composables/impactVariables'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

/** 每元素一支队伍：该元素角色打主力 + 两名非该元素队友（保证失衡 / 积蓄 / 伤害三条通道都有该元素的行） */
const ELEMENT_TEAM: Record<string, string> = {
  physical: '1401',
  fire: '1171',
  ice: '1191',
  electric: '1521',
  ether: '1511',
  wind: '1621',
}

const RES_TABLE_OF = (id: string): 'damageResistances' | 'stunResistances' | 'anomalyResistances' | null =>
  id.endsWith('StunResistance') ? 'stunResistances' : id.endsWith('AnomalyResistance') ? 'anomalyResistances' : id.endsWith('Resistance') ? 'damageResistances' : null

/** 变量 id → 元素（只有抗性类变量带元素前缀） */
const ELEMENT_OF = (id: string): string => id.replace(/(Stun|Anomaly)?Resistance$/, '')

interface Reading { damage: number; stunBuildUp: number }

/** 在独立场景上把变量写到两端，读回两端的观测值（不碰 UI 现场，同 impactSampling 的隔离口径） */
async function sampleEnds(agentId: string, v: ImpactVariable, lo: number, hi: number): Promise<[Reading, Reading]> {
  await setupHarness([{ agentId }, { agentId: '1311' }, { agentId: '1161' }], { recommendedBuild: true })
  return withAnalysisScenario(async s => {
    const read = (): Reading => ({
      damage: s.calc.teamTotalDamage.value,
      stunBuildUp: s.calc.stunPoolResult.value?.totalStunBuildUp ?? -1,
    })
    v.write(s.config, lo)
    await tick()
    const a = read()
    v.write(s.config, hi)
    await tick()
    const b = read()
    return [a, b] as [Reading, Reading]
  })
}

describe('伤害影响分析的静态变量表（2026-10-25 补齐 Boss / 环境字段）', () => {
  it('① 每条变量写到区间两端都会改变结果（伤害类看总伤，失衡抗性看失衡池）', async () => {
    expect(IMPACT_VARIABLES.length, '变量表非空（防表被清空后判据空转）').toBeGreaterThanOrEqual(20)
    for (const v of IMPACT_VARIABLES) {
      const table = RES_TABLE_OF(v.id)
      const agentId = table ? ELEMENT_TEAM[ELEMENT_OF(v.id)] : '1171'
      expect(agentId, `${v.id} 找不到专属队伍`).toBeTruthy()
      const [[a, b]] = [await sampleEnds(agentId, v, v.defaultRange[0], v.defaultRange[1])]
      if (table === 'stunResistances') {
        expect(b.stunBuildUp, `${v.id} 改了不影响失衡池总失衡值（通道死了？）`).not.toBe(a.stunBuildUp)
      } else {
        expect(b.damage, `${v.id} 改了不影响队伍总伤（通道死了？）`).not.toBe(a.damage)
      }
    }
  }, 300000)

  it('② 反例：hp / level 不是伤害侧输入（所以不进采样轴）', async () => {
    await setupHarness([{ agentId: '1171' }, { agentId: '1021' }, { agentId: '1131' }], { recommendedBuild: true })
    const [a, b] = await withAnalysisScenario(async s => {
      const read = () => s.calc.teamTotalDamage.value
      s.config.setEnemy({ hp: 1, level: 1 })
      await tick()
      const lo = read()
      s.config.setEnemy({ hp: 999_999_999, level: 99 })
      await tick()
      return [lo, read()] as const
    })
    expect(b).toBe(a)
  }, 300000)

  it('③ 采样区间覆盖 boss-presets 的真实取值域（否则曲线整段在真实域外）', () => {
    const file = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'))
    const phases = (file.bosses as Array<{
      monster: { stunVuln: number; stunTime: number }
      defaults: { battleTime: number; invincibleTime?: number; shieldCount: number; energyShield: number; stunGiftRatio?: number }
      phases: Array<{ stunValue: number; stunTime?: number; defense: number; bossAnomalyCoeff: number; stunGiftRatio?: number; stunGift?: number }>
    }>).flatMap(b => b.phases.map(p => ({
      stunValue: p.stunValue,
      stunTime: b.monster.stunTime,
      stunVuln: b.monster.stunVuln,
      battleTime: b.defaults.battleTime,
      invincibleTime: b.defaults.invincibleTime ?? 0,
      shieldCount: b.defaults.shieldCount,
      energyShield: b.defaults.energyShield,
      bossAnomalyCoeff: p.bossAnomalyCoeff,
      bossStunGift: Math.round((p.stunGiftRatio ?? b.defaults.stunGiftRatio ?? 0) * p.stunValue),
      defense: p.defense,
    })))
    expect(phases.length, '相位样本非空（防数据文件挪走后判据空转）').toBeGreaterThan(100)
    /** 变量 id → 相位字段（只列有真实域的；抗性表另有 6 键，取值域见下） */
    const FIELD: Record<string, keyof (typeof phases)[number]> = {
      bossStunValue: 'stunValue',
      defense: 'defense',
      stunTime: 'stunTime',
      stunVulnerability: 'stunVuln',
      bossStunGift: 'bossStunGift',
      shieldCount: 'shieldCount',
      energyShield: 'energyShield',
      bossAnomalyCoeff: 'bossAnomalyCoeff',
      bossInvincible: 'invincibleTime',
      totalTime: 'battleTime',
    }
    for (const [id, key] of Object.entries(FIELD)) {
      const v = IMPACT_VARIABLES.find(x => x.id === id)!
      expect(v, `${id} 不在变量表里`).toBeTruthy()
      const values = phases.map(p => p[key] as number)
      expect(Math.min(...values), `${id} 的区间下界 ${v.defaultRange[0]} 高于真实最小值`).toBeGreaterThanOrEqual(v.defaultRange[0])
      expect(Math.max(...values), `${id} 的区间上界 ${v.defaultRange[1]} 低于真实最大值`).toBeLessThanOrEqual(v.defaultRange[1])
    }
  })

  it('④ 每条变量都归组；分组选项按组聚合；3D 快捷对比对的 id 全在变量表里', () => {
    const ids = new Set(IMPACT_VARIABLES.map(v => v.id))
    for (const p of IMPACT_PRESET_PAIRS) {
      expect(ids.has(p.x), `快捷对比对「${p.label}」的 x=${p.x} 不在变量表里`).toBe(true)
      expect(ids.has(p.y), `快捷对比对「${p.label}」的 y=${p.y} 不在变量表里`).toBe(true)
    }
    // 分组选项 = 变量表折叠（展示字段一一对应，顺序不变）
    const groups = impactVarOptions(IMPACT_VARIABLES)
    expect(groups.flatMap(g => g.children.map(c => c.value))).toEqual([...ids])
    for (const g of groups) expect(g.children.length, `分组 ${g.label} 为空`).toBeGreaterThan(0)
  })

  it('⑤ 静态表按组连续排列（下拉顺序 = 表内首次出现顺序）', () => {
    for (const v of IMPACT_VARIABLES) expect(v.group, `${v.id} 没有分组`).toBeTruthy()
    const seen = new Set<string>()
    let prev = ''
    for (const v of IMPACT_VARIABLES) {
      if (v.group === prev) continue
      expect(seen.has(v.group), `${v.group} 在表里被拆成了不连续的两段`).toBe(false)
      seen.add(v.group)
      prev = v.group
    }
    expect(seen.has('Boss 数值')).toBe(true)
    expect(seen.size, '至少 4 组（Boss 数值 / 战斗环境 / 抗性 / 队伍时间分配）').toBeGreaterThanOrEqual(4)
  })
})
