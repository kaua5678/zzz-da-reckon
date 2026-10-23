/**
 * **难度曲线某一点的资源池**（用户 2026-10-16：「难度曲线中的点对应了计算值吗，能显示其资源池吗」
 * / 「我本来想看看有没有 4 失衡，伤害为什么低」）。
 *
 * ## 为什么是「按需重算」而不是「随点携带」
 *
 * 直接随点携带三份引擎结果 = **41.5KB/点**（实测：队级 resourceResult 30.7KB + stunPool 4.7KB +
 * anomalyPool 6.0KB；一队 2 出数点 + 2 截断档 ≈ 166KB；页面 LRU 24 键 × 10 队 × 6 档 ≈ **38MB**）。
 * 改法 = 每点只带**现场差分**（实测 **2.1KB/点**，见 `configDelta`），用户点开某一档时
 * **重放现场 + 重算一次**（实测一次全队求值 50–120ms，点开时才付）。
 *
 * ## 契约（三条）
 *
 * 1. **重算结果 = 那个点的资源池**：`restoreStateDelta(base, delta)` 后现场与落点那刻**逐字节相同**
 *    ⇒ 重算伤害与该点 `dmg` **逐位相等**（判据 `difficultyCurve.test.ts::★ 重放每点现场` +
 *    `curvePointPool.test.ts`）。
 * 2. **跑在独立场景上**（`withAnalysisScenario`）：不改 UI 现场、不动页面上正在显示的计算
 *    （分析器场景隔离的既有口径，见 `analysisScenario`）。
 * 3. **结果对象带出场景**：`withAnalysisScenario` 跑完即 `dispose`，所以本模块只带出**值快照**
 *    （`resourceResult` / `stunPool` / `anomalyPool` 的 `.value`）——它们是纯数据，dispose 后照常可读。
 *
 * ## 竞态
 *
 * 用户连点两个点 ⇒ 后发者胜（`token` 递增，回来时 token 不匹配就丢弃）。**不许**让先发者的慢结果
 * 覆盖后发者——那会让面板显示「另一个档的资源池」而页面毫无提示。
 */
import { ref } from 'vue'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { restoreStateDelta } from '@/composables/configDelta'
import type { LadderPointScene } from '@/composables/difficultyLadder'
import type { AnomalyPoolResult, StunPoolResult, TeamResourceResult } from '@/types/resource'

export interface CurvePointPoolResult {
  resourceResult: TeamResourceResult
  stunPool: StunPoolResult | null
  anomalyPool: AnomalyPoolResult | null
  /**
   * 本次重算的**总伤害**——必须与该曲线点的 `dmg` **逐位相等**（判据 `curvePointPool.test.ts` ①）。
   * 面板把它显示出来：不相等就是「显示的不是那个点的资源池」，那是本模块唯一要防的事故。
   */
  damage: number
  /** 本次重算耗时（ms）——面板上如实显示「这一次点开花了多久」 */
  ms: number
  /**
   * 该档的**名义失衡窗长 W**（秒）= `useResourceCalc#windowDuration`（含全队失衡延时）。
   * 残疾失衡展示要用它，而它**不能事后从 UI store 重算**：本档现场是差分重放出来的，
   * 队友面板加成来自该档的队伍/命座，页面上的值属于「当前档」而非「用户点开的那一档」。
   */
  windowDuration: number
  /** 该档的**有效战斗时间**（秒）= `useResourceCalc#stunEffectiveTime`（战斗时间 − 无敌时间） */
  effectiveTime: number
}

export function useCurvePointPool() {
  const pool = ref<CurvePointPoolResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** 竞态令牌：只有最后一次 `load` 的结果会被采纳 */
  let token = 0

  /** 清空（关闭面板 / 切换选中点时调用） */
  function clear(): void {
    token++
    pool.value = null
    error.value = null
    loading.value = false
  }

  /**
   * 重算某档的资源池。`scene` 缺省（该档没采到现场，如 `collectScenes` 未开）⇒ 清空并**不编数据**，
   * 由调用方显示「该档未采现场」。
   */
  async function load(scene: LadderPointScene | undefined): Promise<void> {
    const my = ++token
    pool.value = null
    error.value = null
    if (!scene) { loading.value = false; return }
    loading.value = true
    const t0 = performance.now()
    try {
      const out = await withAnalysisScenario(s => {
        restoreStateDelta(s.config, scene.base, scene.delta)
        // 读 `.value` 即触发求值；三份结果同一次求值（与曲线落点同一份读数）
        return {
          resourceResult: s.calc.resourceResult.value,
          stunPool: s.calc.stunPoolResult.value,
          anomalyPool: s.calc.anomalyPoolResult.value,
          damage: s.calc.teamTotalDamage.value,
          windowDuration: s.calc.windowDuration.value,
          effectiveTime: s.calc.stunEffectiveTime.value,
        }
      })
      if (my !== token) return
      if (!out.resourceResult) {
        error.value = '该档现场重算后没有资源结果（现场可能不完整）'
        return
      }
      pool.value = {
        resourceResult: out.resourceResult,
        stunPool: out.stunPool,
        anomalyPool: out.anomalyPool,
        damage: out.damage,
        windowDuration: out.windowDuration,
        effectiveTime: out.effectiveTime,
        ms: performance.now() - t0,
      }
    } catch (e) {
      if (my !== token) return
      error.value = String((e as Error)?.message ?? e)
    } finally {
      if (my === token) loading.value = false
    }
  }

  return { pool, loading, error, load, clear }
}
