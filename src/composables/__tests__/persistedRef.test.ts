/**
 * CC-443：`persistedRef` 的读写策略锁——有效存档读回、无效（parse 返回 undefined）/ 损坏 JSON / 存储抛错一律回落默认，
 * 改值深监听写回；写回抛错不冒泡。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { persistedRef } from '@/composables/persistedRef'

function fakeStorage(initial: Record<string, string> = {}, opts: { throwOnSet?: boolean; throwOnGet?: boolean } = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k: string) => { if (opts.throwOnGet) throw new Error('denied'); return map.has(k) ? map.get(k)! : null },
    setItem: (k: string, v: string) => { if (opts.throwOnSet) throw new Error('quota'); map.set(k, v) },
  }
}
const KEY = 'zzz-test-persisted'
const parseList = (raw: unknown) => (Array.isArray(raw) && raw.every(x => typeof x === 'string') && raw.length > 0 ? raw as string[] : undefined)
const fallback = () => ['a', 'b']
const saved = (globalThis as { localStorage?: unknown }).localStorage

afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = saved })
beforeEach(() => { vi.restoreAllMocks() })

describe('persistedRef', () => {
  it('有效存档读回', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage({ [KEY]: JSON.stringify(['x']) })
    expect(persistedRef(KEY, parseList, fallback).value).toEqual(['x'])
  })
  it('parse 判无效 / JSON 损坏 / 无存档 / 存储抛错 → 全部回落默认', () => {
    for (const st of [fakeStorage({ [KEY]: JSON.stringify([]) }), fakeStorage({ [KEY]: '{not json' }), fakeStorage(), fakeStorage({}, { throwOnGet: true })]) {
      ;(globalThis as { localStorage?: unknown }).localStorage = st
      expect(persistedRef(KEY, parseList, fallback).value).toEqual(['a', 'b'])
    }
  })
  it('改值（含深层 push）写回；写回抛错不冒泡', async () => {
    const st = fakeStorage()
    ;(globalThis as { localStorage?: unknown }).localStorage = st
    const r = persistedRef(KEY, parseList, fallback)
    r.value.push('c')
    await nextTick()
    expect(JSON.parse(st.map.get(KEY)!)).toEqual(['a', 'b', 'c'])
    const bad = fakeStorage({}, { throwOnSet: true })
    ;(globalThis as { localStorage?: unknown }).localStorage = bad
    const r2 = persistedRef(KEY, parseList, fallback)
    r2.value = ['z']
    await expect(nextTick()).resolves.toBeUndefined()
    expect(r2.value).toEqual(['z'])
  })
})
