/**
 * CC-66：ResourceResultCard 维琳娜腐蚀展示（:611 moveId / :748 agentId + 事件标记）→ 模块声明 resultCardCorrosion。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { agentResultCardCorrosion } from '@/composables/agentMechanicView'

describe('CC-66 ResourceResultCard 腐蚀展示 → resultCardCorrosion', () => {
  it('全 catalog 角色：仅维琳娜声明，值 == 原写死', async () => {
    const { catalog } = await setupHarness([{ agentId: '1561' }, '', ''])
    const ids = [...new Set(['', ...catalog.agentsMap.keys()])]
    expect(ids.length).toBeGreaterThan(30)
    for (const id of ids) {
      const got = agentResultCardCorrosion(id)
      if (id === '1561') expect(got).toEqual({ poolReleaseEventMarker: 'velina-corrosion', broadCycloneMoveId: '1561007' })
      else expect(got, id).toBeUndefined()
    }
    expect(agentResultCardCorrosion(null)).toBeUndefined()
  }, 60000)

  it('源码锁：组件脚本不再写死 1561 / 1561007 / velina-corrosion', () => {
    const src = readFileSync(resolve(__dirname, '../../components/ResourceResultCard.vue'), 'utf-8')
    const script = src.slice(src.indexOf('<script'), src.indexOf('</script>'))
    expect(script.match(/'1561\d*'/g)).toBeNull()
    expect(script).not.toContain('velina-corrosion')
    expect(script).toContain('e.id.includes(cc.poolReleaseEventMarker)')
    expect(script).toContain('row.moveId === cc.broadCycloneMoveId')
  })
})
