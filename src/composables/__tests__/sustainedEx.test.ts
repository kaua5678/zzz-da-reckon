/**
 * 「单次释放必打招 + 可持续招」强特（src/data/sustainedEx.ts + 引擎接线）护栏。
 *
 * 口径（用户 2026-09）：
 * - 直接耗能 = 必打段（起手/收尾），倍率全额；
 * - 持续耗能（点/秒）= 决定持续段时长；
 * - 持续段倍率基准秒 = 该 move 的 actionTime（= ether_purify/100），缩放 = 倍率 × (持续秒/actionTime)。
 */
import { describe, expect, it } from 'vitest'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { SUSTAINED_EX_SPECS, sustainedDamageScale } from '@/data/sustainedEx'
import { findMoveById } from '@/composables/resourceCalc/helpers'

describe('sustainedEx：缩放基准 = actionTime（不是 1 秒）', () => {
  it('妮可蓄力 430.6% 对应 0.7418s；蓄 1 秒 = ×(1/0.7418)', async () => {
    const { catalog } = await setupHarness([{ agentId: '1031' }])
    const skills = catalog.getAgentSkills('1031')
    const move = findMoveById(skills, '1031103')
    expect(move?.actionTime).toBeCloseTo(0.742, 3) // ether_purify 74.18 / 100
    const spec = SUSTAINED_EX_SPECS['1031']
    expect(sustainedDamageScale(spec, move)).toBeCloseTo(spec.sustain.maxSeconds / (move!.actionTime!), 6)
  })

  it('派派引擎转 375.2% 对应 0.4667s（2圈）；满蓄 3s = ×(3/0.4667)', async () => {
    const { catalog } = await setupHarness([{ agentId: '1281' }])
    const skills = catalog.getAgentSkills('1281')
    const move = findMoveById(skills, '1281010')
    const spec = SUSTAINED_EX_SPECS['1281']
    expect(move?.actionTime).toBeCloseTo(0.467, 3)
    expect(sustainedDamageScale(spec, move)).toBeCloseTo(3 / move!.actionTime!, 6)
  })
})

describe('sustainedEx：真引擎发三段行（起手/持续/收尾）', () => {
  async function deploy(agentId: string) {
    await setupHarness([{ agentId }, { agentId: '1211' }, { agentId: '' }])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === agentId)!
    return char.executions
  }

  it('可琳·小心裙角 = 回旋 + 持续(满蓄2071.4%) + 爆炸，且强特不再走通用行', async () => {
    const exs = await deploy('1061')
    expect(exs.some(e => e.moveId === '1061011')).toBe(true) // 回旋
    expect(exs.some(e => e.moveId === '1061013')).toBe(true) // 爆炸
    const sus = exs.find(e => e.moveId === '1061012')! // 持续
    expect(sus).toBeTruthy()
    expect(sus.damageMultiplier).toBeCloseTo(2071.4, 3) // maxSeconds == actionTime → 满倍率
    // 通用强特行（乱琼之类）被 skipGenericExSpecial 抑制：可琳的强特只该是这三段
    expect(exs.some(e => e.category === 'special' && e.moveId === '1061012' && e.damageMultiplierOverride)).toBe(true)
  })

  it('派派 = 引擎转(满蓄3s缩放) + 非常重下砸(必打)', async () => {
    const exs = await deploy('1281')
    const sus = exs.find(e => e.moveId === '1281010')!
    const fin = exs.find(e => e.moveId === '1281009')!
    expect(sus).toBeTruthy()
    expect(fin).toBeTruthy()
    const at = findMoveById(useCatalogStore().getAgentSkills('1281'), '1281010')!.actionTime!
    expect(sus.damageMultiplier).toBeCloseTo(375.2 * (3 / at), 0)
    expect(fin.damageMultiplier).toBeCloseTo(1226.7, 3)
  })

  it('妮可 = 蓄力 + 炮击#2+#3 + 能量场(必放)', async () => {
    const exs = await deploy('1031')
    expect(exs.some(e => e.moveId === '1031103')).toBe(true) // 蓄力
    expect(exs.some(e => e.moveId === '1031104')).toBe(true) // 炮击#2
    expect(exs.some(e => e.moveId === '1031105')).toBe(true) // 炮击#3
    expect(exs.some(e => e.moveId === '1031106')).toBe(true) // 能量场
  })
})
