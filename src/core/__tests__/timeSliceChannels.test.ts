/**
 * 时光切片（音擎 13002「说「茄子」」）奖励通道的生效判据（C2 结案）。
 *
 * ## C2 原诊断被实测**推翻**（2026-10-25）
 *
 * backlog 写的是「`bonusRegen` 全库恒 0 ⇒ 该通道**没有数据**」。逐层查完发现**三层都通**：
 * 1. `catalog.json` 的音擎 13002 `selfBuff.effects` 五条数值完整
 *    （闪反 20~32 / 强特 25~40 / 支援 30~48 / 连携 35~55 / 回能 0.7~1.1）；
 * 2. `PanelValues` 五个字段在，且 `applyStat` 的 `default` 分支按键名直加
 *    （不需要逐字段 case —— 我一度加了 5 个 case，实测纯冗余，已删）；
 * 3. `resourceIncome#calcDecibelSource` 早就按 `panel.timeSlice* × 触发次数` 求和。
 *
 * **真正的「恒 0」原因 = 没有一支预设队伍装 13002**（`src/data/teamPresets/*.json` 零命中）
 * ⇒ 93 队普查自然全是 0。这是**取样面**问题，不是引擎缺陷。
 *
 * ⇒ 本判据锁的是「装了就真的有钱」这条因果，而不是去修一个并不存在的 bug。
 *
 * 负控：把任一条 timeSlice 的 value 改成 0 ⇒ ③ 的闭式不等 ⇒ 红。
 */
import { describe, expect, it } from 'vitest'
import { applyEffect } from '@/core/buff'
import { emptyPanel } from '@/core/panel'
import { calcDecibelSource } from '@/core/resource/resourceIncome'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CharacterOperationConfig } from '@/types/resource'

const TIME_SLICE_STATS = [
  'timeSliceDodgeCounterDecibel',
  'timeSliceExSpecialDecibel',
  'timeSliceAssistDecibel',
  'timeSliceChainDecibel',
  'timeSliceEnergyPerTrigger',
] as const

describe('时光切片（13002）奖励通道', () => {
  it('① 通道层：五条 effect 都能落进面板（applyStat 的 default 直加，不需要逐字段 case）', () => {
    const panel = emptyPanel()
    const values = [20, 25, 30, 35, 0.7]
    TIME_SLICE_STATS.forEach((stat, i) => {
      const before = panel[stat]
      applyEffect(panel, {
        id: `probe_${stat}`,
        type: 'fixed',
        stat,
        mode: 'flat',
        value: values[i]!,
      } as never, 1)
      expect(panel[stat] - before, `${stat} 没进面板`).toBeCloseTo(values[i]!, 9)
    })
  })

  it('② 反空洞：面板初值必须是 0 —— 否则上一条会被"初值"骗绿', () => {
    const panel = emptyPanel()
    for (const stat of TIME_SLICE_STATS) expect(panel[stat]).toBe(0)
  })

  it('③ 端到端闭式：装了 13002 的槽位 bonusRegen > 0，且 === 面板值 × 触发次数', () => {
    /**
     * ⚠ 夹具必须给全 `timeSliceTriggerCounts` 读的**全部**计数字段
     * （首版只给 state.dodgeCounterCount、缺 `cfg.quickAssistCount`/`cfg.parryCount` ⇒ NaN）。
     */
    const panel = emptyPanel()
    panel.timeSliceDodgeCounterDecibel = 20
    panel.timeSliceExSpecialDecibel = 25
    panel.timeSliceAssistDecibel = 30
    panel.timeSliceChainDecibel = 35
    panel.timeSliceEnergyPerTrigger = 0.7
    const cfg = {
      panel,
      dodgeCounterCount: 8,
      quickAssistCount: 3,
      parryCount: 2,
      rowTimeLimit: 0,
    } as unknown as CharacterOperationConfig
    const state = { exSpecialCount: 6, ultimateCount: 2, chainCountTotal: 4 }
    const out = calcDecibelSource(cfg, state as never, 0, 4, 180)
    expect(Number.isFinite(out.timeSliceDecibel), '时光切片通道算出 NaN（夹具缺计数字段）').toBe(true)
    expect(out.timeSliceDecibel, '时光切片没进 bonusRegen').toBeGreaterThan(0)
    expect(out.bonusRegen).toBe(out.timeSliceDecibel)
    // 12 秒冷却 ⇒ 触发次数 = min(动作次数, floor(180/12)+1 = 16)；本例各类次数都 < 16，不被封顶
    expect(out.timeSliceDecibel).toBe(20 * 8 + 25 * 6 + 30 * (3 + 2) + 35 * 4)
  })

  it('④ 反空洞（C2 的关键事实）：预设库里**没有**队伍装 13002 ⇒ 93 队普查恒 0 是取样问题', () => {
    const dir = join(process.cwd(), 'src', 'data', 'teamPresets')
    const hits: string[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const raw = readFileSync(join(dir, f), 'utf8')
      if (raw.includes('"13002"')) hits.push(f)
    }
    /**
     * 这条断言**刻意允许将来变化**：一旦有人把 13002 放进预设，它会红，提醒同步更新 C2 的结论
     * （"全库恒 0" 不再成立，普查数字要重跑）。当前实测 = 0 命中。
     */
    expect(hits, '预设库出现了装 13002 的队 ⇒ 请重跑 bonusRegen 普查并更新 C2 结案说明').toEqual([])
  })
})
