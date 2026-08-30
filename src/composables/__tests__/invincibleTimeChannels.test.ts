/**
 * 无敌时间 × 后台/CD 伤害通道（2026-08-30 用户口径）：boss 无敌期间 dot 与后台自动攻击
 * （追加攻击/后台自动招式）都不应打到 boss——次数按有效时间（扣 invincibleTime）折算。
 *
 * 通道清单与口径见 src/core/effectiveTime.ts 头注释；本文件用全管线（useResourceCalc）
 * 验证两个代表性通道：卢西娅追加攻击（battleTime 基准）与橘福福虎威（backstageTime 基准）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const LUCIA_ADDITIONAL_ATTACK = '1451007' // 追加攻击（合唱）
const JUFUFU_HUWEI = '1391005' // 普通攻击：「虎威」（后台自动）

function countExecs(characters: Array<{ agentId: string; executions: Array<{ moveId?: string; count?: number }> }>, agentId: string, moveId: string): number {
  const ch = characters.find(c => c.agentId === agentId)
  return ch?.executions.filter(e => e.moveId === moveId).reduce((sum, e) => sum + (e.count ?? 0), 0) ?? 0
}

describe('无敌时间 × 后台/CD 伤害通道', () => {
  it('卢西娅追加攻击：支援位 0 交互口径下默认 20 次；无敌 60 → 相位延后+后台口径压至 13 次', async () => {
    const { config } = await setupHarness([{ agentId: '1451' }, { agentId: '1391' }, { agentId: '1051' }])
    // 支援位 0 交互（roleInteractionBaseline 页面口径）
    config.setParryCount(0, 0)
    config.setDodgeCounterCount(0, 0)
    config.setQuickAssistCount(0, 3)

    config.setEnemy({ invincibleTime: 0 })
    const calc0 = useResourceCalc()
    const chars0 = calc0.resourceResult.value!.characters
    const baseline = countExecs(chars0, '1451', LUCIA_ADDITIONAL_ATTACK)
    // 默认 180s：CD 封顶 20（实测支援位 F≈16.7s、p≈0.09，滑块全档不挤压）≥ 梦境值预算 → 次数由梦境瓶颈主导（Q/E 收敛浮动 ±1）
    expect(baseline).toBeGreaterThanOrEqual(18)

    config.setEnemy({ invincibleTime: 60 })
    const calc60 = useResourceCalc()
    const chars60 = calc60.resourceResult.value!.characters
    const withInvuln = countExecs(chars60, '1451', LUCIA_ADDITIONAL_ATTACK)
    // 无敌 60：后台时间从 ~163 压到 ~103，cap = floor(B/c') 相位延后再收一点 → 次数明显低于基线
    expect(withInvuln).toBeLessThan(baseline)
    expect(withInvuln).toBeGreaterThanOrEqual(10)
  })

  it('橘福福虎威（后台自动）：后台时间扣无敌后次数严格减少', async () => {
    const { config } = await setupHarness([
      { agentId: '1451' },
      { agentId: '1391', basicAttackTimeWeight: 0 }, // 击破位后台 → 有后台时间
      { agentId: '1051' },
    ])

    config.setEnemy({ invincibleTime: 0 })
    const calc0 = useResourceCalc()
    const huwei0 = countExecs(calc0.resourceResult.value!.characters, '1391', JUFUFU_HUWEI)
    expect(huwei0).toBeGreaterThan(0)

    config.setEnemy({ invincibleTime: 60 })
    const calc60 = useResourceCalc()
    const huwei60 = countExecs(calc60.resourceResult.value!.characters, '1391', JUFUFU_HUWEI)
    // 后台时间 ≈ 180 − 必要前台；扣 60s 无敌后虎威窗口严格收窄（即使轴内连携次数随有效时间略降也不足以翻转）
    expect(huwei60).toBeLessThan(huwei0)
  })

  it('无敌时间增加 → 全队总伤不增（时间变少，任何通道都不应受益）', async () => {
    const { config } = await setupHarness([{ agentId: '1451' }, { agentId: '1391' }, { agentId: '1051' }])

    config.setEnemy({ invincibleTime: 0 })
    const dmg0 = useResourceCalc().teamTotalDamage.value
    config.setEnemy({ invincibleTime: 60 })
    const dmg60 = useResourceCalc().teamTotalDamage.value
    expect(dmg60).toBeLessThan(dmg0)
  })
})
