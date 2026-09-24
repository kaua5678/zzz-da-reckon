/**
 * attributeCounter 闸门：装备者自身与队友传播同一判定。
 * 弱点未声明不拦截；已声明且不克制时，装备者和队友都拿不到这组效果。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanel } from '@/composables/resourceCalc/panelPhases'

const phaseBase = {
  phaseId: 'p',
  hp: 1_000_000,
  stunValue: 100,
  defense: 900,
  level: 70,
  bossAnomalyCoeff: 1,
  damageResistances: { ice: 0, ether: 0, electric: 0, fire: 0, physical: 0, wind: 0 },
  stunResistances: { ice: 0, ether: 0, electric: 0, fire: 0, physical: 0, wind: 0 },
  anomalyResistances: { ice: 0, ether: 0, electric: 0, fire: 0, physical: 0, wind: 0 },
}
const monster = { stunVuln: 1.5, stunTime: 10 }
const defaults = { battleTime: 180, shieldCount: 0, energyShield: 0 }

describe('逍遥游球 attributeCounter', () => {
  it('drops the crit buff for the wearer and teammates when the declared weakness is not countered', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1211', wEngineId: '14002', wEngineModLevel: 1 },
      { agentId: '1011', wEngineId: '' },
      '',
    ])
    const yoyo = catalog.getWEngine('14002')
    const r1 = yoyo?.effect?.teamBuff?.effects?.[0]?.value
    expect(r1).toBe(12)

    const wearer = () => computePanel(0, config, catalog)?.critRate ?? 0
    const teammate = () => computePanel(1, config, catalog)?.critRate ?? 0
    const open = { wearer: wearer(), teammate: teammate() }

    config.applyBossPreset({ id: 't' }, { ...phaseBase, weakness: ['电'] }, monster, defaults)
    expect(wearer()).toBeCloseTo(open.wearer, 6)
    expect(teammate()).toBeCloseTo(open.teammate, 6)

    config.applyBossPreset({ id: 't' }, { ...phaseBase, weakness: ['冰'] }, monster, defaults)
    expect(wearer()).toBeCloseTo(open.wearer - 12, 6)
    expect(teammate()).toBeCloseTo(open.teammate - 12, 6)

    // setEnemy 是合并写入；切到未声明弱点必须清掉上一个 Boss，不能粘住「冰」。
    config.applyBossPreset({ id: 't' }, { ...phaseBase, weakness: [] }, monster, defaults)
    expect(config.enemy.weakness).toEqual([])
    expect(wearer()).toBeCloseTo(open.wearer, 6)
    expect(teammate()).toBeCloseTo(open.teammate, 6)
  })

  it('does not zero a prose condition just because a weakness is declared', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1561', wEngineId: '14156', wEngineModLevel: 5 },
      '',
      '',
    ])
    config.applyBossPreset({ id: 't' }, { ...phaseBase, weakness: ['冰'] }, monster, defaults)
    const withWeapon = computePanel(0, config, catalog)?.anomalyProficiency ?? 0
    config.team[0].wEngineId = ''
    const without = computePanel(0, config, catalog)?.anomalyProficiency ?? 0
    // R5：自身 +110，团队 +96，装备者两边都吃到。散文 condition 不因弱点声明被清零。
    expect(withWeapon).toBeCloseTo(without + 206, 6)
  })
})
