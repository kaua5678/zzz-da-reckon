import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 「非轴口径必须如实披露」在**难度曲线页**的延伸判据。
 *
 * ⚠ 2026-10-19 用户裁决改了非轴口径本身：引擎**不再自动认领**非轴易伤
 * （「非轴模式下想自动认领也不能仅仅靠连携和大招，还有其他很多招式，
 *   所以非轴就只能不做，让用户自己填易伤贡献率」）⇒ 图例改为报「你填的贡献率」。
 *
 * 背景（仍成立）：非轴参照点是**关掉轴重算**的，轴点是真实轴 ⇒ 两者口径不同，
 * **不能让用户以为非轴参照是「每招均匀摊」**。图例必须把当前口径说清。
 *
 * 反证：把图例里的 `v-if="noAxisVulnShare != null"` 分支删掉 ⇒ 本判据红。
 */
describe('非轴口径披露（2026-10-19 裁决后）', () => {
  it('★ 图例必须如实报「非轴参照吃的是用户填的易伤贡献率」', () => {
    const src = readFileSync(resolve(__dirname, '../../views/TeamComparePage.vue'), 'utf-8')
    expect(src, '图例要读易伤贡献率').toContain('noAxisVulnShare')
    expect(src, '必须写明非轴不自动认领').toContain('非轴不自动认领')
    expect(src, '必须给出 100% 的含义').toContain('完全均匀摊')
  })
})
