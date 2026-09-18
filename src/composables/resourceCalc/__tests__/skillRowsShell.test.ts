/**
 * R22 熵批 2（R22-S2 刀 B）判据：`resourceCalc/skillRows.ts` 搬迁后的**壳契约**。
 *
 * 为什么这条判据值得存在（不是形式主义）：刀 B 把 C 簇（招式行取值，14 个符号）整段搬进
 * `./skillRows.ts`，为把目录外既有消费者（`mechanics/agents/*` / `components` / `views` / 测试）
 * 的 import 改动降到 0，`./helpers.ts` 保留 re-export 壳。**壳有两种写法，只有一种能跑**
 * （刀 A 实测，非推测）：
 *
 * - ✅ `import { … } from './skillRows'` + 另起 `export { … }`（**建本地绑定**）
 * - ❌ `export { … } from './skillRows'`（**不建本地绑定**）⇒ `buildCharConfig` 里的
 *   `findMoveById(...)` / `getBasicComboMoves(...)` 找不到标识符，运行时 `ReferenceError`，
 *   且 `vue-tsc -b` 会报 `TS2304`（抓的是**下游调用点**，与本判据抓**外壳契约本身**互补）。
 *
 * 同时反锁「不借搬迁放宽 API」：搬迁前后 `helpers.ts` 的导出面必须**逐符号相同**
 * （刀 B 实测 53 → 53，零增零减；顺手上调公开面 = 无判据的静默扩张，规则 12）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import * as Helpers from '@/composables/resourceCalc/helpers'
import * as SkillRows from '@/composables/resourceCalc/skillRows'
import { buildCharConfig, extractSkillExecutions } from '@/composables/resourceCalc/helpers'

/** C 簇 14 个公开符号（迁移前 helpers.ts 的导出面，迁移后经壳原样可达） */
const C_EXPORTS = [
  'getRowValue',
  'fusedRowValue',
  'ELEMENT_DMG_KEYS',
  'ELEMENT_DEF_REDUCTION_KEYS',
  'ELEMENT_RES_REDUCTION_KEYS',
  'findMoveById',
  'findMoveByEnglishName',
  'isHealingRow',
  'getHealingAmount',
  'getSpecialResourceRecovery',
  'BASIC_BENCHMARK_OVERRIDE',
  'pickThirdNamedBasicSegment',
  'getBasicComboMoves',
  'averageBasicRows',
] as const

/** 留在 `helpers.ts` 的真定义（本刀**不该**把它们搬走：D/E 簇与展示归一） */
const STAYED = ['teamHasAgent', 'findSlotByIdentity', 'normalizeDisplayTime', 'buildCharConfig'] as const

describe('R22 刀 B：skillRows 壳契约', () => {
  it('① C 簇 14 个符号经 ./helpers 壳可达，且与 ./skillRows 是**同一个绑定**', () => {
    for (const name of C_EXPORTS) {
      expect((Helpers as Record<string, unknown>)[name], `helpers.${name} 缺失`).toBeDefined()
      // 同一绑定 = 壳不是第二份实现（单一事实源，规则 11）
      expect((Helpers as Record<string, unknown>)[name], `${name} 壳与真实现不是同一绑定`)
        .toBe((SkillRows as Record<string, unknown>)[name])
    }
  })

  it('② 壳的 import 形式**真能跑**：buildCharConfig / extractSkillExecutions 经壳调 C 簇', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1291' }, { agentId: '1141' }, { agentId: '1041' },
    ] as never)
    // buildCharConfig 内部走 `getBasicComboMoves(...)` / `getRowValue(...)`（壳的**本地绑定**）
    // ——若壳写成 `export … from` 这里抛 `ReferenceError`，正是本判据要拦的形态。
    const cfg = buildCharConfig(0, config, catalog)
    expect(cfg).not.toBeNull()
    expect(cfg!.agentId).toBe('1291')
    // extractSkillExecutions 内部走 `findMoveById(...)`（同一个壳）
    const skills = catalog.getAgentSkills('1291')
    expect(skills).toBeTruthy()
    const { stunExecs, anomalyExecs } = extractSkillExecutions(
      0, '1291', skills, null, catalog, cfg!.panel, config,
    )
    expect(Array.isArray(stunExecs)).toBe(true)
    expect(Array.isArray(anomalyExecs)).toBe(true)
  })

  it('③ 未搬走的符号仍是 helpers.ts 的真定义（不借搬迁把 D/E 簇也顺手挪走）', () => {
    for (const name of STAYED) {
      expect((Helpers as Record<string, unknown>)[name], `helpers.${name} 不该消失`).toBeDefined()
      expect(name in SkillRows, `skillRows.${name} 不该出现`).toBe(false)
    }
  })
})
