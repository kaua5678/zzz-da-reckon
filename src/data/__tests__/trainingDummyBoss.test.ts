/**
 * 「训练木桩」= 分析页「怪物」下拉里的中性选项（用户 2026-11-10：「队伍对比之类的地方，怪物选择默认木桩」）。
 *
 * 判据只钉两件事（其余靠既有测试兜）：
 * ① 木桩 BossPreset 的数值 = `TRAINING_DUMMY_VALUES` = 产品默认敌人 `stores/config.ts#defaultEnemy`；
 * ② **进房间（applyBossRoom）后与「不选 Boss」逐字段相等**——特别是 defense 952.8 不能被
 *    `applyBossPreset` 的取整变成 953（那会让「选木桩」和「不选」出现两个数）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { applyBossRoom } from '@/composables/bossRoom'
import {
  TRAINING_DUMMY_BOSS,
  TRAINING_DUMMY_BOSS_ID,
  TRAINING_DUMMY_VALUES,
  isTrainingDummyBoss,
  withTrainingDummy,
  zeroResistances,
} from '@/data/trainingDummy'

describe('训练木桩 BossPreset', () => {
  it('木桩数值 = 单一事实源（hp/失衡/防御/等级/异常系数/易伤/时间/战斗时间）', () => {
    const phase = TRAINING_DUMMY_BOSS.phases[0]!
    expect(phase.hp).toBe(TRAINING_DUMMY_VALUES.hp)
    expect(phase.stunValue).toBe(TRAINING_DUMMY_VALUES.stunValue)
    expect(phase.defense).toBe(TRAINING_DUMMY_VALUES.defense)
    expect(phase.level).toBe(TRAINING_DUMMY_VALUES.level)
    expect(phase.bossAnomalyCoeff).toBe(TRAINING_DUMMY_VALUES.bossAnomalyCoeff)
    expect(TRAINING_DUMMY_BOSS.monster.stunVuln).toBe(TRAINING_DUMMY_VALUES.stunVuln)
    expect(TRAINING_DUMMY_BOSS.monster.stunTime).toBe(TRAINING_DUMMY_VALUES.stunTime)
    expect(TRAINING_DUMMY_BOSS.defaults.battleTime).toBe(TRAINING_DUMMY_VALUES.battleTime)
    // 无抗性 / 无弱点 / 无秽盾能量盾 / 无关卡 buff
    expect(phase.damageResistances).toEqual(zeroResistances())
    expect(phase.stunResistances).toEqual(zeroResistances())
    expect(phase.anomalyResistances).toEqual(zeroResistances())
    expect(phase.weakness).toEqual([])
    expect(phase.layerBuffs ?? []).toEqual([])
    expect(TRAINING_DUMMY_BOSS.defaults.shieldCount).toBe(0)
    expect(TRAINING_DUMMY_BOSS.defaults.energyShield).toBe(0)
  })

  it('★ 进房间后的敌人 ≡ 不选 Boss 的产品默认（含 defense 952.8 不被取整）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }], { fixtures: 'product' })
    const productDefault = JSON.parse(JSON.stringify(config.enemy))
    // 先把现场弄脏（上一位 Boss 的血量/弱点/秽盾/关卡 buff），再进木桩房间
    config.setEnemy({ hp: 1, defense: 1, shieldCount: 1, weakness: ['火'], bossAnomalyCoeff: 1.1 })
    config.globalBuffs.push({ id: 'layer-buff:old:atkPct:20', name: '关卡·旧', stat: 'atkPct', value: 20, enabled: true })
    applyBossRoom(config, TRAINING_DUMMY_BOSS, TRAINING_DUMMY_BOSS.phases[0]!)
    expect(config.enemy).toEqual(productDefault)
    expect(config.enemy.defense, 'def 952.8 不能被取整成 953').toBe(952.8)
    expect(config.appliedBoss, '木桩不是 Boss 预设，不能留下 appliedBoss').toBeNull()
    expect(config.globalBuffs.filter(r => String(r.id).startsWith('layer-buff:')), '旧关卡 buff 必须清掉').toEqual([])
  }, 120_000)

  it('怪物列表：木桩排第一且幂等（重复插入不会出现两个）', () => {
    const real = [{ id: '30007' }, { id: '30009' }]
    const withDummy = withTrainingDummy(real)
    expect(withDummy[0]!.id).toBe(TRAINING_DUMMY_BOSS_ID)
    expect(withDummy).toHaveLength(3)
    expect(withTrainingDummy(withDummy as { id: string }[])).toHaveLength(3)
    expect(isTrainingDummyBoss(TRAINING_DUMMY_BOSS_ID)).toBe(true)
    expect(isTrainingDummyBoss('30007')).toBe(false)
  })
})
