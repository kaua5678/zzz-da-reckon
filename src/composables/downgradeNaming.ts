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
import { defaultDowngradeFor } from '@/data/downgradeWEngines'
import type { Specialty } from '@/types/catalog'

type Catalog = ReturnType<typeof useCatalogStore>

/** 音擎 id → 显示名（缺名回落 id） */
export function downgradeNameOf(catalog: Catalog, wEngineId: string | null | undefined): string {
  if (!wEngineId) return ''
  const w = catalog.getWEngine(wEngineId)
  return w ? localized(w.name, wEngineId) : wEngineId
}

/**
 * 该槽「不选时」会自动穿哪件（= 下位表解析结果），返回 `{ id, name }`；两层表都空 ⇒ `null`。
 * 页面用它渲染「自动（炎炙沸釜）」这种说明，判据用它断言"填 00 不会留空"。
 */
export function autoDowngradeOf(
  catalog: Catalog,
  agentId: string | undefined,
  specialty: Specialty | undefined,
): { id: string; name: string } | null {
  const id = defaultDowngradeFor(agentId, specialty)
  return id ? { id, name: downgradeNameOf(catalog, id) } : null
}
