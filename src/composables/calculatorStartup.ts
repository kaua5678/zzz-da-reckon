import { readonly, ref } from 'vue'
import { useCatalogStore, type CatalogLoadStatus } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { defaultRowFusionRules } from '@/logicEditor/defaults'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import { installTeamAwareBuildRecommendation } from '@/composables/teamAwareRecommendation'

/**
 * 计算器启动入口：完整加载后才开放编辑；错误可见，start() 同时也是显式重试。
 * 目录依赖与请求去重归 catalog store；是否还能自动填默认队伍归 config store，
 * 不把防重置标志放在页面实例里，因此新的页面实例也不能覆盖用户配置。
 */
export function useCalculatorStartup() {
  const catalog = useCatalogStore()
  const config = useConfigStore()
  // 行融合规则（spec 声明的默认规则）是计算输入：启动入口激活一次，倍率表取值处按 moveId + rowId 相乘。
  // 原「逻辑编辑」页（用户改规则 + 本地存档）已于 2026-10-26 下线 ⇒ 这里是唯一激活路径；
  // r697 的口径不变：不打开任何页面也生效，测试与生产同态。
  setActiveRowFusionRules(defaultRowFusionRules())
  // 推荐配装接队友暴击（2026-10-29）：必须在 `start()` 里的 `initDefaultTeam()` **之前**装好，
  // 否则默认队伍的配装推荐按旧口径（只算角色自身面板）算 —— 队友给暴击时推荐分配会溢出。
  // 与行融合规则同形态：生产唯一安装点在这里，测试侧镜像在 `src/test/harness.ts#setupHarness`。
  installTeamAwareBuildRecommendation()
  const status = ref<CatalogLoadStatus>('idle')
  const error = ref<string | null>(null)
  let inFlight: Promise<boolean> | null = null

  /** true = 可以开放页面（可能保留了用户队伍）；false = 依赖失败，可再次调用重试。 */
  async function start(): Promise<boolean> {
    if (status.value === 'ready') return true
    if (inFlight) return inFlight
    status.value = 'loading'
    error.value = null
    inFlight = Promise.resolve().then(async () => {
      try {
        await catalog.load()
        await Promise.all([catalog.loadTeammateBuffs(), catalog.loadBuildRecommendations()])
        const failures: string[] = []
        if (!catalog.teammateBuffsReady) failures.push(`队友 Buff 数据加载失败：${catalog.teammateBuffsError ?? '尚未就绪'}`)
        if (!catalog.buildRecsLoaded) failures.push(`配装推荐加载失败：${catalog.buildRecsError ?? '尚未就绪'}`)
        if (failures.length) throw new Error(failures.join('；'))

        config.initDefaultTeam()
        status.value = 'ready'
        return true
      } catch (cause: unknown) {
        error.value = catalog.error
          ? `目录数据加载失败：${catalog.error}`
          : cause instanceof Error ? cause.message : '启动失败，请重试'
        status.value = 'error'
        return false
      } finally {
        inFlight = null
      }
    })
    return inFlight
  }

  return { status: readonly(status), error: readonly(error), start }
}
