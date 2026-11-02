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
 * 3. **结果对象带出场景**：`withAnalysisScenario` 跑完即 `dispose`，所以本模块只带出**一个档位快照**
 *    （`composables/resourcePoolView#ResourcePoolSnapshot`）——它是**纯值**，dispose 后照常可读。
 *
 * ## T188（2026-11-03）：快照 = **资源池共享视图的入参**
 *
 * 用户口径：「我在**很多地方的比较**中都会要求**完整的资源展示页显示**，**资源页的一切**支撑了结果的
 * 有效性和可溯源性」⇒ 难度曲线这一档要**就地打开资源页那一整套**。做法不是在这里另写一套展示，而是
 * **在本档的重放场景里调同一个构造入口** `resourcePoolSnapshotFromCalc(s.calc, s.config)`，
 * 把结果喂给 `components/ResourcePoolView.vue`——与 `views/ResultPage.vue` **同一个组件**。
 * 于是「该档快照」的**全部**展示读数（含轴窗三件、伤害占比、队伍总览、异常池…）都来自**同一次求值**，
 * 页面不再各自现读 store（现读会显示**另一个档**，见下）。
 *
 * ⚠ 快照**只在用户点开的那一档**构造一次（`pool` 只持有当前这一档），不随每点携带 ⇒ 上面 38MB 的
 * 结论不变。
 *
 * ## 竞态
 *
 * 用户连点两个点 ⇒ 后发者胜（`token` 递增，回来时 token 不匹配就丢弃）。**不许**让先发者的慢结果
 * 覆盖后发者——那会让面板显示「另一个档的资源池」而页面毫无提示。
 */
import { ref } from 'vue'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { restoreStateDelta } from '@/composables/configDelta'
import { resourcePoolSnapshotFromCalc, type ResourcePoolSnapshot } from '@/composables/resourcePoolView'
import type { LadderPointScene } from '@/composables/difficultyLadder'

export function useCurvePointPool() {
  const pool = ref<ResourcePoolSnapshot | null>(null)
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
   * 由调用方（共享视图的空态）显示「该档未采现场」。
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
        // 读 `.value` 即触发求值：快照里的全部读数来自**这一次**求值（与曲线落点同一份读数）
        return resourcePoolSnapshotFromCalc(s.calc, s.config, { ms: performance.now() - t0 })
      })
      if (my !== token) return
      if (!out) {
        error.value = '该档现场重算后没有资源结果（现场可能不完整）'
        return
      }
      pool.value = out
    } catch (e) {
      if (my !== token) return
      error.value = String((e as Error)?.message ?? e)
    } finally {
      if (my === token) loading.value = false
    }
  }

  return { pool, loading, error, load, clear }
}
