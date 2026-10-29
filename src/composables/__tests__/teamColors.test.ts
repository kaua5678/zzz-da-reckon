/**
 * 队伍身份色（用户 2026-10-29 报障：「难度曲线上挽昼的几个队都是灰色曲线看不清」）。
 *
 * 本文件锁四件事：
 * 1) **自定义队不再拿到灰**——旧实现是「预设库下标 % 8，未命中兜底 #888」，而自定义队不在
 *    `teamPresets` 里 ⇒ 全部同色（也就是用户看到的那几条灰线）；
 * 2) **同屏可分辨**——勾选清单内任意两队的色号必须不同（≤ 色板长度），且相邻色号色相分得开；
 * 3) **清单外也稳定**——未被勾选的 id（图例重算窗口、刚删掉的队）走哈希兜底，两次取色一致，且不是灰；
 * 4) **源码锁**：页面不许再退回 `teamPresets.find(...)` 反查队伍（自定义队一律查空），
 *    配色不许再退回「兜底灰」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TEAM_PALETTE, assignTeamColors, hashColorIndex, teamColorOf,
} from '@/composables/teamColors'

/** 色值 → 近似色相（0-360，仅用于「两色看得出来是不是同一族」的判断） */
function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return ((h * 60) % 360 + 360) % 360
}

describe('队伍身份色（2026-10-29）', () => {
  it('★ 自定义队（custom-*）不再落到同一种灰：三支自定义队三个色', () => {
    const ids = ['custom-1', 'custom-2', 'custom-3']
    const map = assignTeamColors(ids)
    const colors = ids.map(id => teamColorOf(id, map))
    expect(new Set(colors).size).toBe(3)
    for (const c of colors) expect(c.toLowerCase()).not.toBe('#888')
    // 也不许「同一次会话两次取色不一致」（哈希兜底必须稳定）
    expect(teamColorOf('custom-1', map)).toBe(colors[0])
  })

  it('★ 同屏可分辨：勾选清单里任意两队色号不同（≤ 色板长度）', () => {
    const ids = Array.from({ length: TEAM_PALETTE.length }, (_, i) => i % 2 === 0 ? `custom-${i}` : `auto-${i}`)
    const map = assignTeamColors(ids)
    const colors = ids.map(id => teamColorOf(id, map))
    expect(new Set(colors).size).toBe(ids.length) // 18 队 18 色，一个都不撞
  })

  it('重复 id 不占两个色号（否则第 N 队会拿到第 1 队的色）', () => {
    const map = assignTeamColors(['a', 'a', 'a', 'b', 'c'])
    expect(map).toEqual({ a: TEAM_PALETTE[0], b: TEAM_PALETTE[1], c: TEAM_PALETTE[2] })
  })

  it('清单外的 id：稳定哈希兜底，**永不返回灰**，且与自身一致', () => {
    const map = assignTeamColors(['custom-1'])
    const outside = teamColorOf('auto-9999', map)
    expect(outside).not.toBe('#888')
    expect(teamColorOf('auto-9999', map)).toBe(outside)
    expect(teamColorOf('auto-9999', {})).toBe(outside) // 与有没有勾选它无关
    expect(hashColorIndex('auto-9999')).toBe(hashColorIndex('auto-9999'))
  })

  it('色板本身：无灰/无近灰、长度足够、相邻色号色相相距 ≥ 20°', () => {
    expect(TEAM_PALETTE.length).toBeGreaterThanOrEqual(12)
    expect(new Set(TEAM_PALETTE).size).toBe(TEAM_PALETTE.length) // 色板内无重复
    for (const c of TEAM_PALETTE) {
      expect(c, c).toMatch(/^#[0-9a-f]{6}$/)
      expect(c.toLowerCase(), c).not.toBe('#888')
      const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16)
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${c} 是灰阶（用户报的就是分不清的灰）`).toBeGreaterThan(20)
    }
    for (let i = 1; i < TEAM_PALETTE.length; i++) {
      const a = hueOf(TEAM_PALETTE[i - 1]!), b = hueOf(TEAM_PALETTE[i]!)
      const d = Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
      expect(d, `${TEAM_PALETTE[i - 1]} 与 ${TEAM_PALETTE[i]} 相邻却同色相`).toBeGreaterThanOrEqual(20)
    }
  })

  it('前 8 色互不相近（3~5 队是常态，前几色不能撞）', () => {
    const hues = TEAM_PALETTE.slice(0, 8).map(hueOf)
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.min(Math.abs(hues[i]! - hues[j]!), 360 - Math.abs(hues[i]! - hues[j]!))
        expect(d, `第 ${i + 1} 色与第 ${j + 1} 色同色相`).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it('源码锁：配色单源在 teamColors，散点几何不再自带色板/兜底灰', () => {
    const scatter = readFileSync(join(process.cwd(), 'src/composables/teamCompareScatter.ts'), 'utf8')
    expect(scatter).toContain('assignTeamColors')
    expect(scatter, '散点几何不许再自带色板').not.toContain('#63e2b7')
    expect(scatter, '不许再有兜底灰').not.toContain("'#888'")

    const page = readFileSync(join(process.cwd(), 'src/views/TeamComparePage.vue'), 'utf8')
    // 反查队伍必须走「勾选清单」（含自定义队）——预设库查空会让自定义队的队名/主C/版本轴全空
    expect(page).toContain('selectedPresetById')
    expect(page, '页面不许用预设库反查队伍（自定义队查空）').not.toMatch(/teamPresets\.find\(/)
  })
})
