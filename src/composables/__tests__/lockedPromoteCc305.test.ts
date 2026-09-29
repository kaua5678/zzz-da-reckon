/**
 * CC-305：锁定失衡（enemy.stunCountLock ≥ 0）下，琉音好评转大次数只由锁定次数决定，不随失衡值联动。
 * 锁定语义（cinemaUplift.ts#readScene）：「操作够就能打 N 次」——防止命座抬失衡值 → 次数 → 转大联动放大的假提升。
 * 原实现只在 promoteFixpoint 之后把池钳到 N（CC-300），不动点内部按自算次数推转大。
 * ⚠ 本场景在修复前也是绿的（实测：60 转大受连携执行行上限约束，执行行已按锁定次数装配；promote 受好评总量约束恒 5）——
 * 这是不变量锁，不是有牙回归；数值（不锁：失衡 3/6 → hug60 3/5；锁 3：均 3/3）记在 dual-source §24.144。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

async function run(stunValue: number, lock: number) {
  const { config } = await setupHarness(
    [{ agentId: '1481' }, { agentId: '1291' }, { agentId: '1161' }] as any,
    { recommendedBuild: true },
  )
  config.useStunAxis = false
  config.enemy.stunValue = stunValue
  config.enemy.stunCountLock = lock
  const calc = useResourceCalc()
  return {
    stun: calc.stunPoolResult.value?.stunCount ?? -1,
    promote: calc.ultPromoteCount.value,
    hug60: calc.ultPromoteHug60.value,
  }
}

describe('CC-305 锁定失衡下转大次数不随失衡值联动', () => {
  it('不锁定时失衡条变化确实改变次数与 60 转大（场景有联动）', async () => {
    const hard = await run(40000, -1)
    const easy = await run(8000, -1)
    expect(easy.stun).toBeGreaterThan(hard.stun)
    expect(easy.hug60).toBeGreaterThan(hard.hug60)
  }, 60000)

  it('锁 3：两种失衡条下池次数都 = 3，转大次数相同', async () => {
    const hard = await run(40000, 3)
    const easy = await run(8000, 3)
    expect(hard.stun).toBe(3)
    expect(easy.stun).toBe(3)
    expect(easy.promote).toBe(hard.promote)
    expect(easy.hug60).toBe(hard.hug60)
  }, 60000)
})
