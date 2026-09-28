/**
 * CC-227：特殊动作喧响（弹刀 215 / 连携 10 / 闪反 10 / 快支 20）的每槽输入次数只在引擎侧组装一次
 * （`composables/resourceCalc/convergence.ts`，注入后的 cfg：含交互缩放、Boss 弹刀反推拆分、只给喧响弹刀、般岳补齐），
 * 结果随 `CalcRoundResult.specialActionBonus` 交给展示层。旧写法在 useResourceCalc 用 store 原值另拼一份，
 * 20 态探针 11 态与引擎不一致（例：1431-1481-1491 默认 Boss 旧展示 3050 vs 引擎 900）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import type { BossPresetFile } from '@/types/bossPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

describe('特殊动作喧响单一来源（CC-227）', () => {
  it('源码锁：calcSpecialActionBonus 只在 convergence.ts 调用', () => {
    const SRC = join(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n)
        if (statSync(f).isDirectory()) { if (n !== '__tests__') walk(f); continue }
        if (!/\.(ts|vue)$/.test(n)) continue
        const rel = relative(SRC, f).replace(/\\/g, '/')
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          const t = line.trim()
          if (t.startsWith('//') || t.startsWith('*')) return
          if (/\bcalcSpecialActionBonus\s*\(/.test(line) && !/export function calcSpecialActionBonus/.test(line)) hits.push(`${rel}:${i + 1}`)
        })
      }
    }
    walk(SRC)
    expect(hits.map(h => h.split(':')[0])).toEqual(['composables/resourceCalc/convergence.ts'])
  })

  it('展示 = 引擎实值：雨果队 + 秽息司祭(30033) 主C 弹刀 = 反推拆分结果 13（旧规则只在主C 配置弹刀为 0 时才用拆分 ⇒ 停在配置值 6）', async () => {
    const { config } = await setupHarness([{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }], { recommendedBuild: true })
    const preset = bossData.bosses.find(b => b.id === '30033')!
    config.applyBossPreset({ id: preset.id }, preset.phases[0] as never, preset.monster as never, preset.defaults as never)
    const calc = useResourceCalc()
    const split = calc.parrySplitResult.value!
    const bonus = calc.specialActionBonus.value!
    expect(config.team[0].parryCount).toBe(6)
    expect(split.mainDpsParry + split.mainDpsNoFollowUp).toBe(13)
    expect(bonus.perSlotParry[0]).toBe(split.mainDpsParry + split.mainDpsNoFollowUp)
    expect(bonus.perSlotParry[0]).not.toBe(config.team[0].parryCount)
    expect(bonus.parry).toBe(bonus.perSlotParry.reduce((a, b) => a + b, 0) * 215)
  })
})
