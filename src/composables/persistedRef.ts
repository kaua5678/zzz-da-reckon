/**
 * CC-443：页面级「localStorage 持久化的 ref」唯一写法。
 *
 * 此前 TeamComparePage（装填池 / 难度权重）与 TimeChartsPage（候选池）各抄一份同形代码：
 * `try { getItem → JSON.parse → 校验 → 返回 } catch { 回落默认 }` + `watch(deep) → try { setItem } catch {}`。
 * 这里只收「读写策略」（损坏 / 不可用 / 配额满一律静默回落、深监听写回），**校验与迁移留在调用方的 `parse`**
 * （返回 `undefined` = 存档无效 → 用 `fallback()`）。
 *
 * 不收：`stores/theme.ts`（存裸字符串、切换时还要改 <html>）、`logicEditor/storage.ts`（schema 解析 + 错误要上报 UI）。
 */
import { ref, watch, type Ref } from 'vue'

export function persistedRef<T>(
  key: string,
  parse: (stored: unknown) => T | undefined,
  fallback: () => T,
): Ref<T> {
  const value = ref(load()) as Ref<T>
  watch(value, v => {
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* 写不进（隐私模式 / 配额）就只做会话内 */ }
  }, { deep: true })
  return value

  function load(): T {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = parse(JSON.parse(raw))
        if (parsed !== undefined) return parsed
      }
    } catch { /* 损坏 / 不可用回落默认 */ }
    return fallback()
  }
}
