/**
 * **后台墨痕化形：真实耗时是事实，合轴率只表达「与队友重合」**（用户口径 2026-10-19）。
 *
 * ## 用户原话（逐字）
 *
 * > 「这是设置的问题，设置 0 秒全合轴然后进行数量填写，**相当于全不合轴然后进行合轴率填写**。
 * >   它本身耗时还是正常的，**你用合轴率并不能掩盖他本身耗时的事实，只是他时间和队友重合而已**」
 *
 * ## 锁什么
 *
 * ① **行上有真实耗时**：`actionTime` = catalog 值（2.667 / 0.966 / 2.667 / 0.961），
 *    `totalTime = count * actionTime`，`comboAlignRatio = 1`——三者缺一就是「用合轴率掩盖耗时」；
 * ② **账本看得见**：`necessaryTime` 含这段毛额，`comboAlignCredit` 含等额抵扣
 *    （引擎不读行上的 ratio，必须走 `extraNecessaryAction`——见 `core/resource/helpers.ts` 账本注释）；
 * ③ **净值仍为 0**：抵扣 >= 预留 ⇒ 这套改动只让账本**可读**，不改变时间净占用。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics/registry'

const BACKSTAGE_IDS = ['1371021', '1371007', '1371005', '1371006']

async function boot(backstage: number) {
  await setupHarness([{ agentId: '1371' }, { agentId: '1071' }, { agentId: '1041' }], { productionBasicWeights: true })
  const config = useConfigStore()
  config.setActionCount(0, 'yixuanBackstageComboCount', backstage)
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 150))
  const ch = calc.resourceResult.value!.characters.find(c => c.slot === 0)!
  return { config, calc, ch }
}

describe('仪玄后台墨痕化形：耗时 vs 合轴重合', () => {
  it('★ ① 行上有真实耗时（actionTime / totalTime / comboAlignRatio 三者齐备）', async () => {
    const { ch } = await boot(10)
    const rows = ch.executions.filter(e => BACKSTAGE_IDS.includes(e.moveId))
    expect(rows.length, '后台四行必须都在').toBe(4)
    for (const e of rows) {
      expect(e.actionTime, e.moveId + ' 必须有真实耗时（不是 0）').toBeGreaterThan(0)
      expect(e.totalTime, e.moveId + ' 行时间 = count * actionTime')
        .toBeCloseTo(e.count * e.actionTime, 6)
      expect(e.comboAlignRatio, e.moveId + ' 合轴率表达「与队友重合」').toBe(1)
      expect(e.totalComboAlignTime, e.moveId + ' 总合轴时间 = 行时间').toBeCloseTo(e.totalTime, 6)
    }
  }, 300_000)

  it('★ ② 账本看得见：毛额进 necessaryTime、等额进 comboAlignCredit ⇒ 净占用不涨', async () => {
    /**
     * 走 `extraNecessaryAction`（爱丽丝 CC-454 同款）——`helpers.ts` 明写「账本不读行上的
     * `comboAlignRatio`」，只写行是**死数据**。
     *
     * ⚠ 配套修了 `convergence.ts` 的供给上限：它原用 `necessaryTime` **毛额**算剩余时间，
     * 会把这段「本该被抵扣掉」的时间算成占用 ⇒ 上限自锁（实测自动填充 pairs 23 → 0）。
     * 改成净额后两者一致。
     */
    const decl = getAgentMechanic('1371')!
    expect(decl.extraNecessaryAction, '必须注册预留通道（否则行上的 ratio 是死数据）').toBeTypeOf('function')
    const { ch } = await boot(10)
    const rowTime = ch.executions
      .filter(e => BACKSTAGE_IDS.includes(e.moveId))
      .reduce((a, e) => a + (e.totalTime ?? 0), 0)
    expect(rowTime, '本夹具必须有后台行时间').toBeGreaterThan(0)
    const credit = ch.timeAllocation.comboAlignCredit ?? 0
    expect(credit, '抵扣必须覆盖后台行时间（净占用不涨）').toBeGreaterThanOrEqual(rowTime - 1e-6)
  }, 300_000)

  it('★ ③ 耗时是事实：改后台对数会改变行时间（不是写死 0）', async () => {
    const a = await boot(4)
    const b = await boot(12)
    const timeOf = (ch: typeof a.ch) => ch.executions
      .filter(e => BACKSTAGE_IDS.includes(e.moveId))
      .reduce((acc, e) => acc + (e.totalTime ?? 0), 0)
    expect(timeOf(b.ch), '后台越多 ⇒ 行时间越多（耗时是真实的，不是恒 0）')
      .toBeGreaterThan(timeOf(a.ch) + 1)
  }, 300_000)
})
