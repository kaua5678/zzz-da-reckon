/**
 * 专武推荐全覆盖锁（scripts/sync-signature-wengine-recs.mjs 的数据侧护栏）。
 *
 * 口径：凡 catalog.json 中 wEngines[].ownerAgentId 指向某角色的音擎，即为该角色专武；
 * build-recommendations.json 必须给它一条 catalog_wengine_id 命中的「专武推荐」——
 * 否则配装推荐面板不显示专武、「一键应用」（applyBuildRecommendationForSlot）不装专武
 * （初始爬取只覆盖了 30 个角色，曾致橘福福/仪玄等新角色全缺）。
 * 无专武归属的角色快照在 NO_OWNER_ENGINES，新角色专武录入 catalog 后此快照必须同步更新。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
const recs = JSON.parse(readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8'))

const ownerEngine = new Map<string, { id: string; name: { zhCN?: string } }>()
for (const w of catalog.wEngines ?? []) {
  if (!w.ownerAgentId) continue
  const owner = String(w.ownerAgentId)
  expect(ownerEngine.has(owner), `角色 ${owner} 有多把专武归属，catalog 数据需修正`).toBe(false)
  ownerEngine.set(owner, w)
}

/** catalog 无专武归属的角色（更新前先确认专武确实未录入，而不是漏了 ownerAgentId） */
const NO_OWNER_ENGINES = ['1551'] // 佩洛伊斯：专武尚未录入 catalog

describe('专武推荐全覆盖（catalog ownerAgentId → build-recommendations）', () => {
  it('catalog 每个角色都有配装推荐条目', () => {
    const recIds = new Set(Object.keys(recs.characters ?? {}))
    for (const a of catalog.agents ?? [])
      expect(recIds.has(String(a.id)), `角色 ${a.id} ${a.name?.zhCN ?? ''} 缺配装推荐条目`).toBe(true)
  })

  it('有专武归属的角色必有命中的专武推荐（catalog_wengine_id = 专武 id）', () => {
    for (const [agentId, engine] of ownerEngine) {
      const we = recs.characters?.[agentId]?.wengine
      expect(we, `角色 ${agentId} 缺专武推荐（跑 npm run sync:wengine-recs）`).toBeTruthy()
      expect(we.catalog_wengine_id, `角色 ${agentId} 专武推荐未命中目录`).toBe(String(engine.id))
      expect(we.name_zh).toBe(engine.name?.zhCN)
    }
  })

  it('所有 catalog_wengine_id 都能解析到 catalog 音擎（防 id 迁移后悬空）', () => {
    const engineIds = new Set((catalog.wEngines ?? []).map((w: { id: string | number }) => String(w.id)))
    for (const [agentId, rec] of Object.entries(recs.characters ?? {}) as [string, Record<string, any>][]) {
      const id = rec?.wengine?.catalog_wengine_id
      if (!id) continue
      expect(engineIds.has(id), `角色 ${agentId} 专武推荐 catalog_wengine_id=${id} 悬空`).toBe(true)
    }
  })

  it('无专武归属的角色快照 = 佩洛伊斯（新专武录入后必须更新此快照）', () => {
    const recIds = Object.keys(recs.characters ?? {})
    const noOwner = recIds.filter(id => !ownerEngine.has(id)).sort()
    expect(noOwner).toEqual([...NO_OWNER_ENGINES].sort())
  })

  it('橘福福（1391）专武推荐 = 福虓炉炉（14139）——用户报告的缺失回归点', () => {
    expect(recs.characters['1391'].wengine.catalog_wengine_id).toBe('14139')
    expect(recs.characters['1391'].wengine.name_zh).toBe('福虓炉炉')
  })
})
