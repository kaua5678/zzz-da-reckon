/**
 * CC-D3 / CC-D1 裁决落地判据（2026-09-25，真管线级）。
 *
 * 两条都是「专属归属/公式漏项」类缺陷，共同点：**单测层看不见**——
 *  `anomalyPool.test.ts` 只能证纯函数的归属判据，证不了「1621 队在真管线里确实不再
 *  产出维琳娜行」；`liuyin.test.ts` 只断言行存在，证不了「贯穿力含 sheerForceFlat」。
 * 故本文件走 `setupHarness` + `useResourceCalc` 读真实 `damagePoolRows`。
 *
 * 反向验证纪律（规则 9）：每条判据都要能**被改坏**——
 *  · CC-D3：把 `resolveVelinaCorrosion` 换回按 `windCharSlot` 取面板 ⇒ ① ② 红；
 *  · CC-D1：把 `calcPenetrationPower` 换回 `atk*0.3 + hp*0.1` ⇒ ③ 红（delta 变 0）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

/** 真管线读伤害池（每次独立 pinia；返回全行，调用方自己筛） */
async function rowsFor(team: Array<{ agentId: string }>) {
  const { config } = await setupHarness(team as any)
  const calc = useResourceCalc()
  return { config, calc, rows: calc.damagePoolRows.value as any[] }
}

describe('CC-D3：风蚀是维琳娜专属资源（不按「队里第一个风属性」归属）', () => {
  /**
   * 实测（修复前）：1621/1141/1031 队 `velinaCorrosionSource = {turbulence:3, micro:2,
   * broad:1, boosted:1}`，产出「维琳娜微域气旋风异放」8 355 +「维琳娜风蚀替换广域气旋」
   * 7 347，两条都挂在**洛克茜**名下；1631 队另有 5 936 挂在赛维里安名下。
   */
  it('非维琳娜风队（1621 洛克茜 / 1631 赛维里安）不产出任何维琳娜气旋行', async () => {
    for (const windId of ['1621', '1631']) {
      const { calc, rows } = await rowsFor([
        { agentId: windId },
        { agentId: '1141' },
        { agentId: '1031' },
      ])
      // ① 池子里不该有名字带「维琳娜」的行
      const velinaRows = rows.filter(r => String(r.name ?? '').includes('维琳娜')
        || String(r.id ?? '').includes('velina-corrosion'))
      expect(velinaRows, `${windId} 队不该产出维琳娜气旋行（实测：${velinaRows.map(r => r.name).join('/')}）`)
        .toHaveLength(0)
      // ② 风蚀源整体不存在（不只是次数为 0）
      expect((calc.anomalyPoolResult.value as any)?.corrosionSource,
        `${windId} 队不该有 corrosionSource`).toBeUndefined()
      // ③ 乱流本身仍在（回归锁：风蚀专属 ≠ 乱流专属）
      const turb = rows.filter(r => r.type === '乱流')
      expect(turb.length, `${windId} 队仍应有乱流（风化是通用机制）`).toBeGreaterThan(0)
    }
  })

  it('维琳娜本人在队 ⇒ 风蚀照常结算（正面锁，防修过头）', async () => {
    const { calc, rows } = await rowsFor([
      { agentId: '1561' },
      { agentId: '1141' },
      { agentId: '1031' },
    ])
    expect((calc.anomalyPoolResult.value as any)?.corrosionSource).toBeTruthy()
    expect(rows.filter(r => String(r.id ?? '').includes('velina-corrosion')).length)
      .toBeGreaterThan(0)
  })
})

describe('CC-D1：琉音额外能力「命破队友 400% 贯穿力」含 sheerForceFlat', () => {
  /**
   * 基底 = `atk×0.3 + hp×0.1 + sheerForceFlat`（`core/damage.ts#calcPenetrationPower`）。
   * 修复前 `damagePool.ts:1020` 内联式漏了第三项 ⇒ 潘引壶[通窍]（全队 sheerForceFlat）
   * 对该行完全无效。实测：面板 sheerForceFlat 176.022 → 0，该行伤害 delta = **0**。
   */
  it('潘引壶[通窍]的贯穿力提升 ⇒ 琉音附加伤害行严格变大', async () => {
    // 琉音(1481) 在 slot1 ⇒ 上一位 = slot0 = 仪玄(1371，命破)；slot2 潘引壶(1421) 供拐
    const { config, calc } = await rowsFor([
      { agentId: '1371' },
      { agentId: '1481' },
      { agentId: '1421' },
    ])
    const rowOf = () => (calc.damagePoolRows.value as any[]).find(r => r.id === 'liuyin-ex-direct-0')

    const on = rowOf()
    expect(on, '琉音额外能力直伤行进池（前置条件）').toBeTruthy()
    expect(on.note).toContain('命破队友 400% 贯穿力')

    config.toggleTeammateBuff('pan_yinhu.core_open_meridians_sheer_force', false)
    const off = rowOf()
    config.toggleTeammateBuff('pan_yinhu.core_open_meridians_sheer_force', true)

    expect(off, '关掉拐后行仍应在（只应变小，不应消失）').toBeTruthy()
    expect(on.count).toBe(off.count)                       // 次数不受影响
    expect(on.totalDamage, '开启[通窍]后该行伤害必须严格变大（CC-D1：贯穿力含 sheerForceFlat）')
      .toBeGreaterThan(off.totalDamage)
    // 量级锁：不是浮点噪声，而是 400% 基底的真实增量
    const ratio = on.totalDamage / off.totalDamage
    expect(ratio, `增量比例异常（${ratio.toFixed(4)}）`).toBeGreaterThan(1.01)
  })
})
