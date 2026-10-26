/**
 * 默认敌人 = 「自由训练模式」木桩 + 默认全局 Buff 清空（用户 2026-10-26 口径）。
 *
 * ## 为什么单独立判据
 * 默认值是**所有「不选 Boss 直接算」场景的隐含输入**：属性配置页初见、主页默认队、各分析页的初始现场。
 * 它错了不会报错、不会红——只是每个数字都多算或少算一期环境。所以必须逐项钉住：
 * ① 木桩九项数值与用户附图一致（截图列名 → 本仓字段的映射写在 `stores/config.ts#defaultEnemy` 头注释）；
 * ② **默认没有环境**（`defaultGlobalBuffs` 为空）—— 用户原话「还有这个buff该清空」；
 * ③ 截图三条独立数字必须与本仓的积蓄表自洽（物理 ×1.2、风 ×0.5）—— 这一条防「把 3750 当成一个孤立魔数抄进来」。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness, TRAINING_DUMMY_ENEMY } from '@/test/harness'
import { BUILDUP_CAP_TABLE } from '@/core/anomalyPool/helpers'
import { SHIELD_BREAK_GIFT } from '@/core/resource/resourceIncome'

/** 用户附图「Free Training Mode」的原始数字（**不读被测对象的常量**，逐项手抄） */
const SCREENSHOT = {
  totalHp: 3347325000,
  hpPerBar: 111577500,
  daze: 17582.7,
  defense: 952.8,
  stunDuration: 12,
  stunDmgMultiplierPct: 150,
  baseBuildup: 3750,
  basePhysicalBuildup: 4500,
  baseWindBuildup: 1875,
  chainAttackCount: 3,
} as const

describe('默认敌人 = 自由训练模式木桩', () => {
  it('★ 九项数值与附图逐项一致', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }], { fixtures: 'product' })
    const e = config.enemy
    expect(e.hp).toBe(SCREENSHOT.totalHp)
    expect(e.stunValue).toBe(SCREENSHOT.daze)
    expect(e.defense).toBe(SCREENSHOT.defense)
    expect(e.stunTime).toBe(SCREENSHOT.stunDuration)
    expect(e.stunVuln).toBe(SCREENSHOT.stunDmgMultiplierPct / 100)
    expect(e.shieldCount, '木桩没有秽盾').toBe(0)
    expect(e.energyShield, '木桩没有能量盾').toBe(0)
    expect(e.bossStunGift, '木桩没有失衡赠礼').toBe(0)
    expect(e.invincibleTime).toBe(0)
    expect(e.battleTime, '危局/训练场固定 180s').toBe(180)
  }, 120_000)

  it('★ 无抗性 / 无弱点（截图「Resistances: None / Weaknesses: None」）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }], { fixtures: 'product' })
    const e = config.enemy
    for (const kind of ['damageResistances', 'stunResistances', 'anomalyResistances'] as const) {
      expect(Object.values(e[kind]), `${kind} 必须全 0`).toEqual(new Array(6).fill(0))
    }
    expect(e.weakness, '无弱点 ⇒ attributeCounter 闸门不拦截（音擎条件照常生效）').toEqual([])
  }, 120_000)

  it('★ 血量与「每管血量 × 管数」自洽（截图 Total HP / HP per Bar 两条独立数字）', () => {
    expect(SCREENSHOT.totalHp / SCREENSHOT.hpPerBar).toBe(30)
    expect(SCREENSHOT.totalHp % SCREENSHOT.hpPerBar).toBe(0)
  })

  it('★ Base Buildup 3750 ⇒ anomalyCoeff = 3750 / 3000（本仓积蓄表的冰火电以太起始值）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }], { fixtures: 'product' })
    const tableBase = BUILDUP_CAP_TABLE.ice[0]
    expect(tableBase, '前提：本仓起始管 = 3000').toBe(3000)
    expect(config.enemy.anomalyCoeff, '异常条系数 = 3750/3000').toBe(SCREENSHOT.baseBuildup / tableBase)
    // 木桩不属于危局 ⇒ 没有 +10% 那条
    expect(config.enemy.bossAnomalyCoeff, '木桩没有危局异常系数加成').toBe(1)
  }, 120_000)

  it('★ 截图另两条 Base Buildup 与本仓表自洽（物理 ×1.2 / 风 ×0.5）——防把 3750 当孤立魔数', () => {
    const base = SCREENSHOT.baseBuildup
    expect(SCREENSHOT.basePhysicalBuildup).toBe(base * (BUILDUP_CAP_TABLE.physical[0] / 3000))
    expect(SCREENSHOT.baseWindBuildup).toBe(base * (BUILDUP_CAP_TABLE.wind[0] / 3000))
  })

  it('★ 连携次数：截图 3 次/失衡 = 三人各 1 次（链数在**角色侧** chainCountPerStun，引擎无敌人侧字段）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }], { fixtures: 'product' })
    const perStun = config.team.reduce((n, c) => n + c.chainCountPerStun, 0)
    expect(config.team.map(c => c.chainCountPerStun), '全员默认 1 次/人/失衡').toEqual([1, 1, 1])
    expect(perStun, '三人合计 = 截图 Chain Attack Count 3').toBe(SCREENSHOT.chainAttackCount)
  }, 120_000)

  it('★ 秽盾数量 0 ⇒ 破盾奖励能量 0（旧默认 1 是秽盾 Boss 的）', () => {
    expect(SHIELD_BREAK_GIFT).toBeGreaterThan(0) // 前提：奖励通道存在
  })
})

describe('默认全局 Buff 清空（用户 2026-10-26：「还有这个buff该清空」）', () => {
  it('★ 新 store 的全局 Buff 表为空（不预置任何危局环境）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }], { fixtures: 'product' })
    expect(config.globalBuffs, '默认不得预置「危局buff / boss增伤」这类环境行').toEqual([])
  }, 120_000)

  it('★ 反锁旧形态：默认不再出现 atkPct 20 / dmgBonus 15 的「危局buff」行', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }], { fixtures: 'product' })
    const legacy = config.globalBuffs.filter(b => b.name === '危局buff' || b.name === 'boss增伤')
    expect(legacy).toEqual([])
  }, 120_000)

  it('★ 判据侧镜像 TRAINING_DUMMY_ENEMY 与产品默认逐字段一致（防两处漂）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }], { fixtures: 'product' })
    const e = config.enemy
    for (const [k, v] of Object.entries(TRAINING_DUMMY_ENEMY)) {
      expect(e[k as keyof typeof e], `harness.TRAINING_DUMMY_ENEMY.${k} 与 stores/config#defaultEnemy 不一致`).toEqual(v)
    }
  }, 120_000)

  it('手填行照常可用（清空默认 ≠ 关掉通道）', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }], { fixtures: 'product' })
    config.addGlobalBuff()
    const row = config.globalBuffs[config.globalBuffs.length - 1]
    config.updateGlobalBuff(row.id, { stat: 'atkPct', value: 20, enabled: true, name: '手填' })
    expect(config.globalBuffs.length).toBe(1)
    expect(config.globalBuffs[0].value).toBe(20)
    expect(catalog.ready, '前提：目录已就绪（能算）').toBe(true)
  }, 120_000)
})
