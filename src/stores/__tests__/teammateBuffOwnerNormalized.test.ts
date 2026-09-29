/**
 * CC-275（第 290 轮）：队友 buff 拥有者身份归一锁。
 *
 * 采集数据 teammate-buffs.json 里 1171/1261/1411/1511/1581 的 buff `ownerId` / `teammateId` 是拼音 slug，
 * 来源面板只按数字 agentId 登记 ⇒ 查不到来源面板：derived 效果回落 defaultSourceValue（柚叶 3000 ⇒ 恒顶 1200），
 * formula 效果回落**接收者自己的面板**，均与契约「x = 来源角色面板」不符。catalog.mergeSpecTeamBuffs 在加载处归一到组 id。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import type { TeammateBuffGroup } from '@/types/catalog'

const raw = JSON.parse(readFileSync(resolve(__dirname, '../../../public/static/teammate-buffs.json'), 'utf-8')) as TeammateBuffGroup[]

describe('CC-275 队友 buff 拥有者 = 组 id', () => {
  it('加载后每条 buff 的 ownerId / teammateId 都等于所在组 id', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    const bad: string[] = []
    for (const g of catalog.teammateBuffGroups) {
      for (const b of g.buffs) {
        if (b.ownerId !== g.id || (b.teammateId !== undefined && b.teammateId !== g.id)) bad.push(`${g.id}:${b.id}:${b.ownerId}/${b.teammateId}`)
      }
    }
    expect(bad).toEqual([])
    expect(catalog.teammateBuffGroups.length).toBeGreaterThanOrEqual(raw.length)
  })

  it('原始数据里非组 id 的拥有者只可能是已知 slug（新增 slug 需确认它确实指向本组角色）', () => {
    const slugs = new Set<string>()
    for (const g of raw) for (const b of g.buffs) {
      for (const k of [b.ownerId, b.teammateId]) if (k && k !== g.id) slugs.add(`${g.id}=${k}`)
    }
    expect([...slugs].sort()).toEqual(['1171=burnice_white', '1261=jane_doe', '1411=youye', '1511=nangongyu', '1581=remielle'])
  })
})
