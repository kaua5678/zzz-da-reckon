/**
 * CC-498：「专武 = ownerAgentId === agentId」只写一份（`composables/signatureWEngine.ts`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signatureWEngineOf } from '@/composables/signatureWEngine'
import type { WEngine } from '@/types/catalog'

const w = (id: string, ownerAgentId?: string) => ({ id, ownerAgentId } as unknown as WEngine)

describe('signatureWEngineOf（CC-498）', () => {
  it('按 ownerAgentId 找专武；无目录 / 无专武 → undefined；只认精确相等', () => {
    const catalog = { displayWEngines: [w('a'), w('b', '1091'), w('c', '1191')] }
    expect(signatureWEngineOf(catalog, '1191')?.id).toBe('c')
    expect(signatureWEngineOf(catalog, '1')).toBeUndefined()
    expect(signatureWEngineOf({ displayWEngines: undefined }, '1091')).toBeUndefined()
  })
  /**
   * 用户 2026-10-26：「这三人有专武，可能推荐配置暂时没写，但以后会写的」。
   *
   * 此前只认 `ownerAgentId` ⇒ 1551 佩洛伊斯 / 1601 挽昼 / 1661 知更鸟被判「无专武」，
   * 加金阶梯于是给他们发**同职业别人的**专武（含 14155 日冕遗蜕——它明明写着「装备者为佩洛伊斯时」）。
   * 第二权威来源 = effect 级 `requirement.wearerAgentIds`。
   */
  it('★ wearerAgentIds 也是专武归属（佩洛伊斯 14155 / 挽昼 14160 / 知更鸟 14166）', async () => {
    const { useCatalogStore } = await import('@/stores/catalog')
    const { setupHarness } = await import('@/test/harness')
    const h = await setupHarness([{ agentId: '1551' }, { agentId: '1601' }, { agentId: '1661' }])
    // 数据现状：14155 走 effect 级 wearerAgentIds=['1551']；14160v1/14166v1 走 ownerAgentId（2026-11-10 起，
    // scripts/tag-wengine-owner.mjs 登记——两人正式服还没上线，音擎只有 v1 占位，归属只能落在这一把上）。
    expect(signatureWEngineOf(h.catalog, '1551')?.id, '1551 走 wearerAgentIds').toBe('14155')
    expect(signatureWEngineOf(h.catalog, '1601')?.id, '1601 → 14160v1（ownerAgentId）').toBe('14160v1')
    expect(signatureWEngineOf(h.catalog, '1661')?.id, '1661 → 14166v1（ownerAgentId）').toBe('14166v1')
    // 反证：别人的专武不能被认领（朱鸢装 14155 是能穿，但不是她的专武）
    expect(signatureWEngineOf(h.catalog, '1241')?.id).not.toBe('14155')
    void useCatalogStore
  }, 120000)

  it('源码锁：src 下（测试除外）不再手写 find(… ownerAgentId === …)', () => {
    const files = [
      'stores/config.ts', 'composables/pullPlannerEngine.ts', 'composables/teamTimelineStore.ts',
      'composables/freeCompare/engine.ts', 'composables/teamCompare.ts', 'composables/signatureWEngine.ts',
    ]
    let defs = 0
    for (const f of files) {
      const src = readFileSync(join(__dirname, '..', '..', f), 'utf8')
      const hits = (src.match(/find\(\w+ => \w+\.ownerAgentId ===/g) ?? []).length
      if (f.endsWith('signatureWEngine.ts')) defs += hits
      else expect(hits, f).toBe(0)
    }
    expect(defs).toBe(1)
  })
})
