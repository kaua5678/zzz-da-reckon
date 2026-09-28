/**
 * 直伤/异放的**减防（enemyDefReduction）通道**回归 —— 2026-09-08 修复。
 *
 * bug 形态：`damagePool.pushDirect` 只把「行级 moveId 限定无视防御」`row.defIgnore` 传给
 * `calcDirectDamage`，**面板通用 `enemyDefReduction` / `enemyDefFlatReduction` 被静默丢弃**
 * （异放的 `pushRelease` 同样只传 releaseModifier 的异放限定值）——于是「减防/无视防御」整条
 * 通道在直伤上失效：妮可核心 40%（满覆盖）、叶瞬光 C1 20%、席德 C2 20%、伊芙琳 C1、
 * 爱芮 C2、千夏 C1、音擎 千面日陨/索魂影眸 全部只进面板不进伤害。
 * 实测：妮可队（猫又/琉音/妮可）总伤 -21%、席德+妮可队 -29%；异常质量侧
 * （`calcAnomalyMass` 直接读施加者面板）本来就吃得到 → 直伤角色相对偏低。
 *
 * 口径：`docs/GAME_TERM_TO_CODE_FIELD.md` §4「防御力降低 X% / 无视目标 X% 防御力 → enemyDefReduction
 * （同字段加算）」「防御力降低 X 点 → enemyDefFlatReduction」；`docs/mechanism-reference.md`
 * 结算区含减防。面板通用值与行级 moveId 限定值加算，不重复。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

/** 防御区（单一来源口径：core/damage.ts#calcDefenseMultiplier，794 = 60级等级基数） */
const defZone = (defense: number, defReduction: number) => 794 / (794 + defense * (1 - defReduction / 100))

describe('直伤减防通道（面板 enemyDefReduction 必须进伤害）', () => {
  it('全局减防 20% → 主C 直伤按防御区比值抬升（修复前比值恒 1）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1021' }, { agentId: '1481' }, { agentId: '1311' }])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.applyBuildRecommendationForSlot(i)
    const calc = useResourceCalc()
    const directDamageOf = (agentId: string) =>
      calc.damagePoolRows.value.filter(r => r.agentId === agentId && r.type === '直伤')
        .reduce((s, r) => s + r.totalDamage, 0)

    const before = directDamageOf('1021')
    expect(before).toBeGreaterThan(0)

    config.globalBuffs.push({
      id: 'test-defdown-20', name: '测试·减防20%', stat: 'enemyDefReduction',
      value: 20, enabled: true, targetSkillType: 'all',
    } as never)
    const after = directDamageOf('1021')

    const expected = defZone(config.enemy.defense, 20) / defZone(config.enemy.defense, 0)
    expect(after / before, `直伤比值 ${(after / before).toFixed(4)} vs 防御区比值 ${expected.toFixed(4)}`)
      .toBeCloseTo(expected, 6)
  })

  it('固定减防（enemyDefFlatReduction）同样生效（进穿透值通道）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1021' }, { agentId: '1481' }, { agentId: '1311' }])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.applyBuildRecommendationForSlot(i)
    const calc = useResourceCalc()
    const directDamageOf = () =>
      calc.damagePoolRows.value.filter(r => r.agentId === '1021' && r.type === '直伤')
        .reduce((s, r) => s + r.totalDamage, 0)

    const before = directDamageOf()
    config.globalBuffs.push({
      id: 'test-defdown-flat-100', name: '测试·减防100点', stat: 'enemyDefFlatReduction',
      value: 100, enabled: true, targetSkillType: 'all',
    } as never)
    const after = directDamageOf()

    const expected = defZone(config.enemy.defense, 0) === 0 ? 1 : (794 / (794 + config.enemy.defense - 100)) / defZone(config.enemy.defense, 0)
    expect(after / before, `直伤比值 ${(after / before).toFixed(4)}`).toBeCloseTo(expected, 6)
  })

  it('异放行同样吃面板通用减防（pushRelease 通道）', async () => {
    // 南宫羽/柚叶/星见雅：异放（颤音）来自南宫羽、无 releaseModifier 减防 → 纯面板通用值通道
    const { catalog, config } = await setupHarness([{ agentId: '1511' }, { agentId: '1411' }, { agentId: '1091' }])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.applyBuildRecommendationForSlot(i)
    const calc = useResourceCalc()
    const releaseOf = () => calc.damagePoolRows.value.filter(r => r.type === '异放')
      .reduce((s, r) => s + r.totalDamage, 0)

    const before = releaseOf()
    expect(before).toBeGreaterThan(0)
    config.globalBuffs.push({
      id: 'test-defdown-20', name: '测试·减防20%', stat: 'enemyDefReduction',
      value: 20, enabled: true, targetSkillType: 'all',
    } as never)
    const after = releaseOf()
    const expected = defZone(config.enemy.defense, 20) / defZone(config.enemy.defense, 0)
    expect(after / before, `异放比值 ${(after / before).toFixed(4)} vs 防御区比值 ${expected.toFixed(4)}`)
      .toBeCloseTo(expected, 6)
  })
})

/**
 * CC-175（第 199 轮）：calcAnomalyDamage 契约——结算面板上的减防 / 固定减防 / 减抗由函数内部读取，入参只传面板之外的额外量。
 * 修复前：① 四个调用点都把结算面板减抗再传一次 ⇒ 异常 / 异放减抗双计（自初始提交）；② 标准异常行通用减防传 0 且函数内不读 ⇒ 漏计；
 * ③ 异放行把面板固定减防再传一次 ⇒ 双计。上面「直伤 / 异放」用例头注释说的「异常质量侧本来就吃得到」只对紊乱 / 乱流
 * （calcAnomalyMass）成立，标准异常伤害行走的是 calcAnomalyDamage。
 */
describe('CC-175 异常 / 异放结算区减防减抗只计一次', () => {
  const setup = async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1511' }, { agentId: '1411' }, { agentId: '1091' }])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.applyBuildRecommendationForSlot(i)
    for (const k of Object.keys(config.enemy.damageResistances)) config.enemy.damageResistances[k] = 0
    const calc = useResourceCalc()
    const anomalyOf = () => calc.damagePoolRows.value.filter(r => r.id.startsWith('anomaly-damage-')).reduce((s, r) => s + r.totalDamage, 0)
    const releaseOf = () => calc.damagePoolRows.value.filter(r => r.type === '异放').reduce((s, r) => s + r.totalDamage, 0)
    return { config, anomalyOf, releaseOf }
  }

  it('标准异常行吃面板通用减防（修复前比值恒 1）', async () => {
    const { config, anomalyOf } = await setup()
    const before = anomalyOf()
    expect(before).toBeGreaterThan(0)
    config.globalBuffs.push({ id: 'test-defdown-20', name: '测试·减防20%', stat: 'enemyDefReduction', value: 20, enabled: true, targetSkillType: 'all' } as never)
    const expected = defZone(config.enemy.defense, 20) / defZone(config.enemy.defense, 0)
    expect(anomalyOf() / before).toBeCloseTo(expected, 6)
  })

  it('面板通用减抗 20% 对异常行与异放行都只计一次（抗性全 0 ⇒ 比值 1.2；双计时为 1.4）', async () => {
    const { config, anomalyOf, releaseOf } = await setup()
    const a0 = anomalyOf(), r0 = releaseOf()
    expect(a0).toBeGreaterThan(0)
    expect(r0).toBeGreaterThan(0)
    config.globalBuffs.push({ id: 'test-resdown-20', name: '测试·减抗20%', stat: 'enemyResReduction', value: 20, enabled: true, targetSkillType: 'all' } as never)
    expect(anomalyOf() / a0).toBeCloseTo(1.2, 6)
    expect(releaseOf() / r0).toBeCloseTo(1.2, 6)
  })

  it('异放行固定减防只计一次', async () => {
    const { config, releaseOf } = await setup()
    const before = releaseOf()
    config.globalBuffs.push({ id: 'test-defdown-flat-100', name: '测试·减防100点', stat: 'enemyDefFlatReduction', value: 100, enabled: true, targetSkillType: 'all' } as never)
    const expected = (794 / (794 + config.enemy.defense - 100)) / defZone(config.enemy.defense, 0)
    expect(releaseOf() / before).toBeCloseTo(expected, 6)
  })
})
