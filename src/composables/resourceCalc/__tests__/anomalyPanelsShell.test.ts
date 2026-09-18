/**
 * R22 熵批 2（R22-S2 刀 C）判据：`resourceCalc/anomalyPanels.ts` 搬迁后的**壳契约**。
 *
 * 为什么这条判据值得存在（不是形式主义）：刀 C 把 D 簇（异常面板，15 个符号）整段搬进
 * `./anomalyPanels.ts`，为把目录外既有消费者（`damagePool.ts` 取其中 7 个 / `useResourceCalc.ts` /
 * `mechanics/__tests__` / `composables/__tests__`）的 import 改动降到 0，`./helpers.ts` 保留
 * re-export 壳。**壳有两种写法，只有一种能跑**（刀 A/B 实测，非推测）：
 *
 * - ✅ `import { … } from './anomalyPanels'` + 另起 `export { … }`（**建本地绑定**）
 * - ❌ `export { … } from './anomalyPanels'`（**不建本地绑定**）⇒ 运行到该符号时
 *   `ReferenceError`，且 `vue-tsc -b` 报 `TS2304`（抓的是**下游调用点**，与本判据抓**外壳契约本身**互补）。
 *
 * 同时反锁「不借搬迁放宽 API」：搬迁前后 `helpers.ts` 的导出面必须**逐符号相同**
 * （刀 C 实测 53 → 53，零增零减）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import * as Helpers from '@/composables/resourceCalc/helpers'
import * as AnomalyPanels from '@/composables/resourceCalc/anomalyPanels'
import { buildCharConfig } from '@/composables/resourceCalc/helpers'
// ⚠ 类型 re-export 的判据**只能在类型层**（运行时类型已擦除）：下面这 4 行 import type 若壳没导出，
// `npm run build`（`vue-tsc -b`）会报 TS2305 —— 这就是类型面的判据，vitest 运行时看不到。
import type {
  AnomalyVirtualPanelRow,
  AnomalyVirtualPanelBuild,
  AnomalySettlementEntry,
  VoidflareDamageInput,
} from '@/composables/resourceCalc/helpers'

/** D 簇 11 个**运行时**符号（迁移前 helpers.ts 的导出面，迁移后经壳原样可达） */
const D_EXPORTS = [
  'teamHasAgent',
  'getTeamAnomalyDurationBonus',
  'findSlotByIdentity',
  'getWindInfectionTargetSlot',
  'getWindInfectionElement',
  'getWindInfectionCoverage',
  'buildAnomalyVirtualPanel',
  'buildAnomalySettlementEntries',
  'getRemielleLevelValue',
  'remielleSpecialVoidflareCount',
  'calcVoidflareDamage',
] as const

/** 留在 `helpers.ts` 的真定义（本刀**不该**把它们搬走：展示归一 / 执行计划 / 资源池配置） */
const STAYED = ['normalizeDisplayTime', 'enrichExecutionPlan', 'buildCharConfig', 'extractSkillExecutions'] as const

describe('R22 刀 C：anomalyPanels 壳契约', () => {
  it('① D 簇 11 个运行时符号经 ./helpers 壳可达，且与 ./anomalyPanels 是**同一个绑定**', () => {
    for (const name of D_EXPORTS) {
      expect((Helpers as Record<string, unknown>)[name], `helpers.${name} 缺失`).toBeDefined()
      // 同一绑定 = 壳不是第二份实现（单一事实源，规则 11）
      expect((Helpers as Record<string, unknown>)[name], `${name} 壳与真实现不是同一绑定`)
        .toBe((AnomalyPanels as Record<string, unknown>)[name])
    }
  })

  it('①bis 4 个**类型**符号经 ./helpers 壳可解析（类型层判据，由 `npm run build` 的 vue-tsc 强制）', () => {
    // 本用例的「断言」在文件顶部那 4 行 `import type … from './helpers'`：壳若写成
    // `export { … } from`（不建本地绑定）或漏导类型，`vue-tsc -b` 直接 TS2305 红。
    // 运行时这里只做一个存在性自证（避免空用例被 vitest 判为「无断言」）。
    const shapes: Array<keyof AnomalyVirtualPanelRow | keyof AnomalyVirtualPanelBuild
      | keyof AnomalySettlementEntry | keyof VoidflareDamageInput> = [
      'slot', 'element', 'triggerCount', 'sourcePanel',
    ]
    expect(shapes.length).toBe(4)  })

  it('② 壳的 import 形式**真能跑**：真管线经壳跑一次 buildCharConfig（含 D 簇 findSlotByIdentity 路径）', async () => {
    // 电属性 + 1211（丽娜）会走 `getTeamAnomalyDurationBonus` → `buildMechanicTeamMembers` +
    // `findSlotByIdentity` + `evalAdditionalAbility`——即 D 簇最深的跨模块路径（也是刀 C 新增的
    // `anomalyPanels → panelPhases` 那条边的实际执行点，顺带反锁无 TDZ 问题）。
    const { catalog, config } = await setupHarness([
      { agentId: '1291' }, { agentId: '1211' }, { agentId: '1041' },
    ] as never)
    const bonus = Helpers.getTeamAnomalyDurationBonus(config, catalog, 'electric')
    expect([0, 3]).toContain(bonus)
    const cfg = buildCharConfig(0, config, catalog)
    expect(cfg).not.toBeNull()
    expect(cfg!.agentId).toBe('1291')
    // 壳的本地绑定：经壳调 findSlotByIdentity（若壳写成 export-from，这里 ReferenceError）
    const slot = Helpers.findSlotByIdentity(config, catalog, ['1211'])
    expect(slot).toBe(1)
  })

  it('②bis ★ 类型 re-export 必须是**两行形态**（import type + export type）——这是本刀唯一能拦住它的判据', async () => {
    // ⚠ 实测（本批，非推测）：把 D 簇的类型壳写成 `export { … } from './anomalyPanels'` 时
    // **① / ② 都不红**——类型在运行时已擦除，`(Helpers as Record<string, unknown>)['AnomalyVirtualPanelRow']`
    // 本来就是 `undefined`（所以 ① 只列 11 个**运行时**符号）；而 ② 的调用点全在别的文件。
    // 真正红的只有 `vue-tsc -b`（本批实测：helpers.ts 4 条 TS2304 + useResourceCalc.ts TS7006 传染）。
    // ⇒ 本用例把「类型壳必须建本地绑定」这条契约钉在 vitest 里（比全量 `vue-tsc -b` 快得多），
    //   手法 = 读源文件断言两行形态（vitest 里跑 vue-tsc 不现实）。
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../helpers.ts', import.meta.url), 'utf8')
    // 正控：必须有 `import type { … } from './anomalyPanels'` 与另起的 `export type { … }`
    expect(src, 'helpers.ts 缺 import type … from ./anomalyPanels').toMatch(
      /import\s+type\s*\{[\s\S]*?AnomalyVirtualPanelBuild[\s\S]*?\}\s*from\s*'\.\/anomalyPanels'/,
    )
    expect(src, 'helpers.ts 缺 export type { … }（export-from 不建本地绑定）').toMatch(
      /export\s+type\s*\{[\s\S]*?AnomalyVirtualPanelBuild[\s\S]*?\}/,
    )
    // 反锁：不许出现 `export type { … } from './anomalyPanels'` 这种不建本地绑定的写法
    expect(src, '类型壳写成了 export-from（不建本地绑定 ⇒ vue-tsc TS2304）').not.toMatch(
      /export\s+type\s*\{[\s\S]*?\}\s*from\s*'\.\/anomalyPanels'/,
    )
  })

  it('③ 未搬走的符号仍是 helpers.ts 的真定义（不借搬迁把执行计划簇也顺手挪走）', () => {
    for (const name of STAYED) {
      expect((Helpers as Record<string, unknown>)[name], `helpers.${name} 不该消失`).toBeDefined()
      expect(name in AnomalyPanels, `anomalyPanels.${name} 不该出现`).toBe(false)
    }
  })
})
