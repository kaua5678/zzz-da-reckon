import { describe, expect, it } from 'vitest'
import { DECIBEL_TRACK_CAP, simulateDecibelTrack } from '@/core/resourceTrack'

describe('时间轴喧响轨（对轴模块第一步，用户口径 2026-08-31）', () => {
  // 4 窗 × 18s，间隔均匀：0-18 / 45-63 / 90-108 / 135-153（尾段 27s）
  const windows = [0, 45, 90, 135].map(start => ({ start, duration: 18 }))

  it('回复充足：每窗都够 3000 → 4 大全放、清空再攒', () => {
    // 窗间隙 = 45−18 = 27s（timeline 推进到窗末）；rate=100/s → 每间隙攒 2700。
    // initial=3000：win1 放清零；win2 2700<3000 削；win3 2700+2700=5400→截3000 放；
    // win4 2700 削。要 4 全放需 rate×27 ≥ 3000 → totalRegen ≥ 20000。
    const r = simulateDecibelTrack(windows, 24000, 180, 3000)
    expect(r.ultimateCount).toBe(4)
    expect(r.ultimateCut).toBe(0)
    // win2/3/4 各溢出 2400-3000… rate=133.3×27=3600 → 每窗溢 600 ×3
    expect(r.wasted).toBeCloseTo(3 * 600, 0)
  })

  it('回复只够 3.5 大：第 4 窗削减（司祭 4 喧响大 / 叶释渊 3 大档位）', () => {
    // rate=66.7/s + initial 3000：首窗放；此后 45s 攒 3000 整——恰好每窗放
    // 直到回复总量耗尽。12000 回复 + 3000 初始 = 5 大当量，但窗口只 4 个：
    // 每窗进窗值 3000/3000/3000/3000 → 4 全放。改用更紧的量验证削减：
    const r = simulateDecibelTrack(windows, 9000, 180, 3000)
    // 9000/180=50/s；首窗 initial 3000 放；win2@45s: 50×45=2250 <3000 削减；
    // win3@90s: 2250+2250=4500→截3000 放清零; win4@135s: 50×45=2250 <3000 削减 → 2 大
    expect(r.ultimateCount).toBe(2)
    expect(r.ultimateCut).toBe(2)
  })

  it('无初始喧响：开局窗必削减（均匀回复口径 t=0 无积累）', () => {
    // rate=66.7/s，间隙27s攒1800：win1 enter=0 削; win2 1800 削; win3 3600→截3000 放;
    // win4 1800 削 → 1 大
    const r = simulateDecibelTrack(windows, 12000, 180, 0)
    expect(r.ultimateCount).toBe(1)
    expect(r.ultimateCut).toBe(3)
  })

  it('窗口不贴开局（首窗 20s）：开局段回复计入首窗判定', () => {
    const wins = [{ start: 20, duration: 18 }, { start: 60, duration: 18 }]
    // rate = 50/s + initial 2000；首窗 20s 攒 1000+2000=3000 → 放；60s 时 0+2000=2000 → 削减
    const r = simulateDecibelTrack(wins, 9000, 180, 2000)
    expect(r.ultimateByWindow).toEqual([true, false])
    expect(r.ultimateCount).toBe(1)
  })

  it('零回复/空窗口：全削减不崩', () => {
    expect(simulateDecibelTrack(windows, 0, 180).ultimateCount).toBe(0)
    expect(simulateDecibelTrack([], 9000, 180).ultimateCount).toBe(0)
  })

  it('上限常量与大招消耗一致（3000）', () => {
    expect(DECIBEL_TRACK_CAP).toBe(3000)
  })
})
