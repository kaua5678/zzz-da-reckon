/**
 * 便携记录小窗 · 读数核心的判据（`composables/recordWindow.ts`）。
 *
 * 覆盖四件事，每件都对应一条用户口径或一条历史事故：
 *  ① **Δ 颜色方向**必须读 `MetricDef.higherBetter`——「越小越好」的指标（前台时间 /
 *     时间预算残差 / 招式截断秒数）方向要反过来。这是用户点名「别自己写一套方向判断」的地方。
 *  ② **持平阈值取展示精度**：小窗上 `+0.00` 却染绿会让用户以为改动生效了。
 *  ③ **分量缺失 ≠ 0**：角色离队后该分量在向量里不存在，必须显示 `—` 而不是假装 0。
 *  ④ **源码锁**：本模块与组件**不得**出现 `useResourceCalc()`——r705 事故（`ImpactChart` 自建第二个
 *     实例 ⇒ 资源利用率页每次状态变化整条管线跑两遍，重队每遍 430–506ms）。
 *     这条判据是本功能最大风险的机器兜底（A4 的性能判据是行为面，这里是形状面）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { TOTAL_KEY, METRICS, metricDef, type Calc } from '@/composables/freeCompare/metrics'
import {
  DEFAULT_PICKS,
  deltaTone,
  formatDelta,
  normalizePicks,
  pickKey,
  pickLabel,
  readRecordRows,
  useRecordRows,
} from '@/composables/recordWindow'

/** 最小 calc 桩：只填被测指标真正读的字段（其余按 `num()` 的语义读成 0） */
function calcStub(over: Partial<Record<string, unknown>> = {}): Calc {
  return {
    teamTotalDamage: { value: 1000 },
    resourceResult: { value: { totalTime: 100, characters: [], convergence: { timeBudgetResidualSeconds: 0 }, overflowSeconds: 0 } },
    damagePoolRows: { value: [] },
    stunPoolResult: { value: { stunCount: 3, totalStunBuildUp: 0, perSlotStun: [] } },
    anomalyPoolResult: { value: { totalTriggerCount: 0, perSlotAnomalyTriggers: [], coverage: { coverageRate: 0 } } },
    windowDuration: { value: 0 },
    ...over,
  } as unknown as Calc
}

const env = { hp: 0 }

describe('recordWindow · Δ 方向（读 MetricDef.higherBetter）', () => {
  it('越大越好的指标：涨 = good、跌 = bad', () => {
    const def = metricDef('teamTotalDamage')!
    expect(def.higherBetter).toBe(true)
    expect(deltaTone(def, 100)).toBe('good')
    expect(deltaTone(def, -100)).toBe('bad')
  })

  it('越小越好的指标方向反过来（前台时间 / 时间残差 / 截断秒数三条实测）', () => {
    for (const id of ['frontlineTime', 'timeBudgetResidual', 'overflowSeconds']) {
      const def = metricDef(id)!
      expect(def.higherBetter, id).toBe(false)
      expect(deltaTone(def, 1), `${id} 变大应变坏`).toBe('bad')
      expect(deltaTone(def, -1), `${id} 变小应变好`).toBe('good')
    }
  })

  it('持平阈值 = 展示精度（digits 位小数），不染成绿/红', () => {
    const def = metricDef('teamTotalDamage')!   // digits 0
    expect(deltaTone(def, 0.4)).toBe('same')
    expect(deltaTone(def, 0.6)).toBe('good')
    const frac = metricDef('timeBudgetResidual')!  // digits 2
    expect(deltaTone(frac, 0.004)).toBe('same')
    expect(deltaTone(frac, -0.02)).toBe('good')
  })

  it('百分比类指标：阈值按 ×0.01 折算（读数是 0~1 的比例）', () => {
    const def = metricDef('anomalyCoverage')!   // digits 1, unit '%' ⇒ 阈值 0.5 × 0.1 × 0.01 = 0.0005
    expect(deltaTone(def, 0.0002)).toBe('same') // 展示仍是 0.0%
    expect(deltaTone(def, 0.02)).toBe('good')   // 展示为 2.0%
  })

  it('null / 非有限值 = none（不猜方向）', () => {
    const def = metricDef('teamTotalDamage')!
    expect(deltaTone(def, null)).toBe('none')
    expect(deltaTone(def, Number.NaN)).toBe('none')
  })

  it('Δ 展示带符号；缺失为 —', () => {
    const def = metricDef('teamTotalDamage')!
    expect(formatDelta(def, 1234)).toBe('+1,234')
    expect(formatDelta(def, -1234)).toBe('-1,234')
    expect(formatDelta(def, null)).toBe('—')
  })
})

describe('recordWindow · 读数与基准', () => {
  it('分量缺失显示 —（不是 0）：角色离队后分人伤害不该假装是 0', () => {
    const rows = readRecordRows(calcStub(), env, [{ metricId: 'dmgBySlot', slot: '1081' }], null)
    expect(rows[0].value).toBeNull()
    expect(rows[0].formatted).toBe('—')
    expect(rows[0].delta).toBeNull()
  })

  it('perSlot 分量按 agentId 取（不是按槽位下标）', () => {
    const calc = calcStub({
      damagePoolRows: { value: [{ agentId: '1081', totalDamage: 300 }, { agentId: '1041', totalDamage: 700 }] },
    })
    const rows = readRecordRows(calc, env, [
      { metricId: 'dmgBySlot', slot: '1041' },
      { metricId: 'dmgBySlot', slot: TOTAL_KEY },
    ], null)
    expect(rows[0].value).toBe(700)
    expect(rows[1].value).toBe(1000)
  })

  it('未登记的指标 id 静默跳过（旧存档不该让整窗崩）', () => {
    const rows = readRecordRows(calcStub(), env, [{ metricId: '不存在的指标', slot: TOTAL_KEY }], null)
    expect(rows).toEqual([])
  })

  it('基准 Δ：capture 后改读数 ⇒ Δ 与方向随之更新', () => {
    // ⚠ 读数必须是**响应式**的（真实 calc 的每个字段都是 computed ref；引擎是惰性「读即重算」）
    const damage = ref(1000)
    const calc = () => calcStub({ teamTotalDamage: { value: damage.value } })
    const picks = [{ metricId: 'teamTotalDamage', slot: TOTAL_KEY }]
    const api = useRecordRows(calc, () => env, () => picks)
    expect(api.hasBaseline.value).toBe(false)
    expect(api.rows.value[0].delta).toBeNull()

    api.capture()
    expect(api.hasBaseline.value).toBe(true)
    expect(api.rows.value[0].delta).toBe(0)
    expect(api.rows.value[0].tone).toBe('same')

    damage.value = 1500
    expect(api.rows.value[0].base).toBe(1000)
    expect(api.rows.value[0].delta).toBe(500)
    expect(api.rows.value[0].tone).toBe('good')

    damage.value = 800
    expect(api.rows.value[0].tone).toBe('bad')

    api.clearBaseline()
    expect(api.hasBaseline.value).toBe(false)
  })

  it('基准不因读数变化而漂移（capture 后基准恒定）', () => {
    const damage = ref(1000)
    const api = useRecordRows(
      () => calcStub({ teamTotalDamage: { value: damage.value } }),
      () => env,
      () => [{ metricId: 'teamTotalDamage', slot: TOTAL_KEY }],
    )
    api.capture()
    damage.value = 2000
    expect(api.rows.value[0].base).toBe(1000)
    expect(api.rows.value[0].delta).toBe(1000)
  })
})

describe('recordWindow · 存档归一化与标签', () => {
  it('剔掉异形项与已下线的指标 id；去重；空则回落默认', () => {
    expect(normalizePicks([{ metricId: 'teamTotalDamage', slot: TOTAL_KEY }])).toEqual([{ metricId: 'teamTotalDamage', slot: TOTAL_KEY }])
    expect(normalizePicks([{ metricId: '已删除的指标', slot: TOTAL_KEY }])).toEqual([...DEFAULT_PICKS])
    expect(normalizePicks([{ metricId: 'teamTotalDamage' }, 'x', null])).toEqual([...DEFAULT_PICKS])
    expect(normalizePicks('不是数组')).toEqual([...DEFAULT_PICKS])
    expect(normalizePicks([
      { metricId: 'teamTotalDamage', slot: TOTAL_KEY },
      { metricId: 'teamTotalDamage', slot: TOTAL_KEY },
    ])).toEqual([{ metricId: 'teamTotalDamage', slot: TOTAL_KEY }])
  })

  it('行 id 唯一且稳定（显隐筛选与基准表都靠它）', () => {
    expect(pickKey({ metricId: 'dmgBySlot', slot: '1081' })).toBe('dmgBySlot|1081')
    const keys = METRICS.flatMap(m => [TOTAL_KEY, '1081'].map(slot => pickKey({ metricId: m.id, slot })))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('标签：全队分量不加角色后缀，分人分量带名字', () => {
    const def = metricDef('dmgBySlot')!
    expect(pickLabel(def, { metricId: 'dmgBySlot', slot: TOTAL_KEY }, () => '雅')).toBe('分人伤害')
    expect(pickLabel(def, { metricId: 'dmgBySlot', slot: '1081' }, () => '雅')).toBe('分人伤害 · 雅')
  })

  it('默认读数非空且全部是注册表里的合法指标', () => {
    expect(DEFAULT_PICKS.length).toBeGreaterThan(0)
    for (const pick of DEFAULT_PICKS) expect(metricDef(pick.metricId), pick.metricId).toBeTruthy()
  })
})

describe('recordWindow · 源码锁（性能风险面）', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')
  /** 去掉注释再判（注释里正是**解释**这条禁令的地方） */
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  it('核心模块与组件都不调用 useResourceCalc()（r705：自建第二实例 ⇒ 管线跑两遍）', () => {
    for (const rel of ['composables/recordWindow.ts', 'components/RecordWindow.vue']) {
      expect(stripComments(read(rel)), rel).not.toMatch(/useResourceCalc\s*\(/)
    }
  })

  it('小窗的 calc 是 props 传入（形状面兜底：组件必须声明 calc prop）', () => {
    const src = read('components/RecordWindow.vue')
    expect(src).toMatch(/defineProps<\{[\s\S]*?calc: Calc/)
  })
})
