/**
 * 图表「系列筛选」的唯一实现（点图例显隐某条线/某支队/某个 Boss）。
 *
 * 为什么抽出来：同一段交互此前在 `BossHpInflationPage.vue`（血量膨胀图，点图例显隐 Boss 折线）
 * 只有一份，而队伍对比页散点图/难度曲线、时间图表页的多队并存强度与每期新角色强队图
 * **有图例但不能点**（用户的判据：「血量膨胀的曲线图可以筛选，但其他tab的图表似乎没筛选功能」）。
 * 逐页各写一遍 `reactive(new Set())` + toggle + filter 会漂移（AGENTS 规则 11：跨文件共享逻辑
 * 只从单一来源引用），所以收敛到这里；页面只负责把「系列 id 清单」喂进来。
 *
 * 口径（三条都是用户可见行为，有测试钉住）：
 *  ① **默认全可见**：`hidden` 只存「被用户关掉的 id」，不存白名单——重算/换期数/Boss 后冒出来的
 *     新系列自动可见，不需要用户重开一遍；用户关过的 id 会记住。
 *  ② **筛选是纯展示**：隐藏只影响「画什么」，不重算引擎。但隐藏系列必须同时退出**派生量**
 *     （轴上限/刻度/明细表/排名），否则轴按隐藏数据缩放 ⇒ 筛选看起来没生效。各页面在 computed 里
 *     读 `filter(...)` 的返回值或 `isVisible(...)`，**不要**直接读原始数组。
 *     唯一的例外是「Top-K 存活判定」这类**数据性质**（K 是游戏约束，不是显示选项）：
 *     隐藏一队不该让别的队递补存活，那里只跳过绘制。
 *  ③ **不会全关**：最后一个可见系列不允许被关掉（全关的图是空白，分不清「筛没了」还是「没数据」），
 *     该次 `toggle` 被忽略 ⇒ 不变式「任何时刻可见数 ≥ 1」在 API 层就成立，调用方无需再兜。
 *
 * @fact ui:图表/系列筛选 决: 所有多系列图表共用「点图例显隐」筛选：默认全可见、新系列自动可见、用户隐藏记入 `hidden`；隐藏必须同时退出派生量（轴上限/刻度/明细表），否则筛选看着没生效（唯一例外 = Top-K 存活判定这类数据性质，只跳过绘制）；不允许把最后一个可见系列关掉 ⇒ 可见数 ≥1 是 API 层不变式 | 据 用户@2026-09-12 | 验 seriesFilter.test.ts | 锚 src/composables/seriesFilter.ts#useSeriesFilter | 信 确认
 */
import { computed, reactive, type ComputedRef } from 'vue'

/** 系列定义的最小形状：只要有稳定 id 与展示名就能被筛选 */
export interface FilterableSeries {
  id: string
  name: string
}

export interface SeriesFilter {
  /** 某 id 当前是否可见（未知 id 视为可见——新系列默认显示，见 ①） */
  isVisible: (id: string) => boolean
  /** 点图例：可见则隐藏，隐藏则显示；关最后一个可见系列会被忽略（见 ③） */
  toggle: (id: string) => void
  /** 全部显示（清空隐藏集） */
  showAll: () => void
  /** 按可见性过滤任意「带 id」的列表；派生量走这里，别读原始数组（见 ②） */
  filter: <T extends { id: string }>(items: readonly T[]) => T[]
  /** 可见系列数 / 系列总数（图例头部「显示 5/12」用） */
  counts: ComputedRef<{ visible: number; total: number }>
}

/**
 * @param series 系列清单 getter（响应式或普通皆可；顺序即图例顺序）
 */
export function useSeriesFilter(series: () => readonly FilterableSeries[]): SeriesFilter {
  const hidden = reactive(new Set<string>())

  const ids = computed(() => series().map(s => s.id))
  const visibleCount = computed(() => ids.value.filter(id => !hidden.has(id)).length)

  const isVisible = (id: string) => !hidden.has(id)

  function toggle(id: string) {
    if (hidden.has(id)) {
      hidden.delete(id)
      return
    }
    // ③ 不允许关掉最后一个可见系列
    if (visibleCount.value <= 1) return
    hidden.add(id)
  }

  function showAll() {
    hidden.clear()
  }

  function filter<T extends { id: string }>(items: readonly T[]): T[] {
    return items.filter(it => !hidden.has(it.id))
  }

  const counts = computed(() => ({ visible: visibleCount.value, total: ids.value.length }))

  return { isVisible, toggle, showAll, filter, counts }
}
