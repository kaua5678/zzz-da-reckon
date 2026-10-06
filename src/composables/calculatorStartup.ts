import { readonly, ref } from 'vue'
import { useCatalogStore, type CatalogLoadStatus } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useLogicEditorStore } from '@/stores/logicEditor'

/**
 * 计算器启动入口：完整加载后才开放编辑；错误可见，start() 同时也是显式重试。
 * 目录依赖与请求去重归 catalog store；是否还能自动填默认队伍归 config store，
 * 不把防重置标志放在页面实例里，因此新的页面实例也不能覆盖用户配置。
 */
export function useCalculatorStartup() {
  const catalog = useCatalogStore()
  const config = useConfigStore()
  // 行融合规则（逻辑编辑器的持久化状态，缺省 = spec 默认规则）是计算输入：store 一建立就 setActiveRowFusionRules。
  // 原先只有 LogicEditorPage 会建立它 ⇒ 没打开过那一页时规则全空，同一配置的结果取决于用户点没点过那一页（r697）。
  useLogicEditorStore()
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
