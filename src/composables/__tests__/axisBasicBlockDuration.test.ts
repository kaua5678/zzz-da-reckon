/**
 * 轴内「平A块」的**时长定价**（2026-10-29，用户报告「中间的平a显示为0秒」）。
 *
 * 用户逐字：「克拉蕾预设失衡轴中间的平a显示为0秒，应该是bug了，我想表达他在两个连携之间a了1秒，
 * 和下一次连携刚好连接上。新的指标提示我每窗都发呆1秒，可视化也显示中间是0秒的basic块。」
 *
 * 根因 = **两条引擎对同一份轴给出不同时间账**：平A块是轴位置性标记块（catalog 里没有这个 id）
 * ⇒ 栈侧 findMoveById(skills, basic) 恒 undefined ⇒ actionTime = 0；而旧轴引擎
 * （useResourceCalc#perActionDuration[slot:basic]）与编辑器候选都按 **1 秒/单位** 计。
 * 后果：该槽排布游标不前进（count=2 的两条轨迹同起点 4.2425 / 时长 0）⇒ 与下一块
 * （显式 5.2s）之间留下 0.9575s 缝隙 ⇒ 被 idleSegments 记成「发呆」，块本身宽度为 0。
 *
 * 三条判据（各拦一种失败模式）：
 *   ① 行为：平A块逐单位 1 秒、起点逐段推进（失败模式 = 又回到 0 时长）；
 *   ② 后果：轴内不再有发呆缝隙、后续块按真实时长顺延（失败模式 = 缝隙被算成发呆）；
 *   ③ 单一事实源：两个消费点都引用 AXIS_BASIC_UNIT_SECONDS（失败模式 = 各写一个 1 / 漏定价）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { stunAxisPresets, cloneStunAxes } from '@/data/stunAxisPresets'
import { AXIS_BASIC_UNIT_SECONDS } from '@/core/stunAxis'

/** 用户报告的原队形（preset-1611-any 通用标准轴：槽 0 克拉蕾 + 任意队友） */
async function runClaretAxis() {
  const preset = stunAxisPresets.find(p => p.id === 'preset-1611-any')
  expect(preset, '标准轴预设必须随仓库发布（用户口述录入）').toBeTruthy()
  await setupHarness([{ agentId: '1611', cinemaLevel: 1 }, { agentId: '1361' }, { agentId: '1211' }] as never)
  const config = useConfigStore()
  config.enemy.stunCountLock = 1
  config.useStunAxis = true
  config.stunAxes = cloneStunAxes(preset!.axes!)
  const calc = useResourceCalc()
  return calc.stackTraversalResult.value!.windowTrace[0]!
}

describe('轴内平A块时长（栈侧定价与旧轴引擎同口径）', () => {
  it('① 逐单位 1 秒、起点逐段推进（预设里 count=2 的块 = 2 秒）', async () => {
    const w = await runClaretAxis()
    const basics = w.actions.filter(a => a.moveId === 'basic')
    expect(basics.length, '轴里那块 count=2 应逐段展开成 2 条轨迹').toBe(2)
    for (const b of basics) expect(b.actionTime, '轴内平A块每单位 = 1 秒').toBeCloseTo(AXIS_BASIC_UNIT_SECONDS, 9)
    expect(basics.map(b => Number(b.startTime.toFixed(4))), '第二段起点 = 第一段起点 + 1 秒').toEqual([4.2425, 5.2425])
  }, 300_000)

  it('② 轴内不再有发呆缝隙（修前 0.9575s），后续块按真实时长顺延', async () => {
    const w = await runClaretAxis()
    expect(w.idleSegments ?? [], '平A块应把缝隙吃掉（修前这里有一条 0.9575s 发呆）').toEqual([])
    // 平A块 4.2425 → 6.2425；下一块显式 startTime = 5.2 是**下界**，真实起点顺延到 6.2425
    // 轴里 1611020 有两条（1.7255 与 平A块之后那条）⇒ 取平A块之后的那条
    const chain = w.actions.filter(a => a.moveId === '1611020').at(-1)!
    expect(Number(chain.startTime.toFixed(4)), '连携块顺延到平A块结束处').toBe(6.2425)
    // 整窗动作毛占用 = 13.701s（修前 11.701s：少算了平A的 2 秒）
    expect(Number(w.actionSeconds.toFixed(3))).toBeCloseTo(13.701, 3)
  }, 300_000)

  it('③ 单一事实源：栈侧与旧轴引擎都引用 AXIS_BASIC_UNIT_SECONDS（不许各写一个 1）', () => {
    const stack = readFileSync(new URL('../resourceCalc/roundInputs.ts', import.meta.url), 'utf8')
    const legacy = readFileSync(new URL('../useResourceCalc.ts', import.meta.url), 'utf8')
    expect(AXIS_BASIC_UNIT_SECONDS).toBe(1)
    expect(stack, '栈侧必须按 AXIS_BASIC_UNIT_SECONDS 给平A块定价').toContain('AXIS_BASIC_UNIT_SECONDS')
    expect(stack, '平A块定价必须走 isBasicBlock 分支').toContain("act.moveId === 'basic'")
    expect(legacy, '旧轴引擎必须引用同一个常量').toContain('AXIS_BASIC_UNIT_SECONDS')
  })
})
