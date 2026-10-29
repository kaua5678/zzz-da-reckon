/**
 * 下位音擎的**页面显示名**（用户 2026-10-26：「填 00 或者其他不带专武的配置时，我在哪里勾选下位武器呢？」
 * ⇒ 不光要能选，还要能看见「没选时引擎会穿哪件」）。
 *
 * 为什么不直接 `catalog.wEngineName(id)`：`displayWEngines` 已过滤掉 hidden 条目，
 * 而表里的下位件全是 A 级/常驻 S（都在），所以这里就是薄薄一层兜底命名
 * （catalog 缺名时回落 id，绝不返回空串——空串会让「自动」看起来像「没有」）。
 */
import type { useCatalogStore } from '@/stores/catalog'
import { localized } from '@/utils/format'


type Catalog = ReturnType<typeof useCatalogStore>

/** 音擎 id → 显示名（缺名回落 id） */
export function downgradeNameOf(catalog: Catalog, wEngineId: string | null | undefined): string {
  if (!wEngineId) return ''
  const w = catalog.getWEngine(wEngineId)
  return w ? localized(w.name, wEngineId) : wEngineId
}

// 原 autoDowngradeOf（包一层 defaultDowngradeFor + 命名）零引用，2026-10-29 删：
// 页面（TeamSlotCodeEditor）直接下调 downgradeNameOf / data/downgradeWEngines#defaultDowngradeFor。
