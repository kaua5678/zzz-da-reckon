/**
 * R22 熵批 1（T67-a1 刀 A）判据：`resourceCalc/panelPhases.ts` 搬迁后的**壳契约**。
 *
 * 为什么这条判据值得存在（不是形式主义）：刀 A 把 B 簇整段搬进 `./panelPhases.ts`，为把
 * 51 个 `computePanelPhases` 消费者与既有测试的 import 改动降到 0，`./helpers.ts` 保留
 * re-export 壳。**壳有两种写法，只有一种能跑**（本批实测，非推测）：
 *
 * - ✅ `import { … } from './panelPhases'` + 另起 `export { … }`（**建本地绑定**）
 * - ❌ `export { … } from './panelPhases'`（**不建本地绑定**）⇒ `buildCharConfig` 里的
 *   `computePanel(slot, …)` 找不到标识符，运行时实测 `ReferenceError: computePanel is not defined`
 *   （`helpers.ts:976`）。
 *
 * ⚠ **派活方核正（2026-09-18 round 22，隔离 worktree 复现两次）**：本文件初版头注释写
 * 「第二种写法**类型检查也过**（`vue-tsc` 0 错）」——**该陈述不成立，已删除**。
 * 实测把壳改成纯 `export { … } from` 后 `npx vue-tsc -b --noEmit` **exit 2**，
 * 报 4 条 `TS2304: Cannot find name 'buildMechanicTeamMembers' / 'computePanel'`
 * （`helpers.ts:282/977/1159/1244`）⇒ **类型检查抓得到**，只是它抓的是**下游调用点**，
 * 而本判据抓的是**外壳契约本身**（两者互补，不是「类型检查看不见」）。
 * 保留本判据的理由因此改为：② 它把「壳必须建本地绑定」这条**契约**钉在测试里（含负控），
 * 而不是依赖「某天有人恰好跑了 `vue-tsc`」——`npx vitest run` 比全量 `vue-tsc -b` 快得多，
 * 且本判据失败信息直接指向根因（`ReferenceError: computePanel is not defined`）。
 * 同理 ③ 的「不借搬迁放宽 API」也是类型检查**不会**拦的（多导出一个符号是合法 TS）。
 *
 * 同时反锁「不借搬迁放宽 API」：三个私有 helper 迁移前就不是 `helpers.ts` 的导出面，
 * 搬进新文件后同样不许导出（规则 12 最小实现阶梯；顺手上调公开面 = 无判据的静默扩张）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import * as Helpers from '@/composables/resourceCalc/helpers'
import * as PanelPhases from '@/composables/resourceCalc/panelPhases'
import { buildCharConfig } from '@/composables/resourceCalc/helpers'

/** B 簇 10 个公开符号（迁移前 helpers.ts 的导出面，迁移后经壳原样可达） */
const B_EXPORTS = [
  'buildMechanicTeamMembers',
  'computePanel',
  'computePanelPhases',
  'computeRemielleEntryPanel',
  'resolveMechanicSettings',
  'applyTeamMechanics',
  'collectNextRoundFeedback',
  'collectAxisWindowOverlays',
  'ADDITIONAL_GATE_BUFFS',
  'evalAdditionalAbilityBuffGates',
] as const

/** 迁移前后都不是导出面的私有 helper（不许因搬迁而公开） */
const PRIVATE = ['teamDiscs', 'mergeTeamDiscEffectCoverages', 'agentHasCinemaSkillLevelBuff'] as const

describe('R22 刀 A：panelPhases 壳契约', () => {
  it('① B 簇 10 个符号经 ./helpers 壳可达，且与 ./panelPhases 是**同一个绑定**', () => {
    for (const name of B_EXPORTS) {
      expect((Helpers as Record<string, unknown>)[name], `helpers.${name} 缺失`).toBeDefined()
      // 同一绑定 = 壳不是第二份实现（单一事实源，规则 11）
      expect((Helpers as Record<string, unknown>)[name], `${name} 壳与真实现不是同一绑定`)
        .toBe((PanelPhases as Record<string, unknown>)[name])
    }
  })

  it('② 壳的 import 形式**真能跑**：buildCharConfig 经壳调 computePanel（export-from 写法在此炸）', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1291' }, { agentId: '1141' }, { agentId: '1041' },
    ] as never)
    // buildCharConfig 内部走 `computePanel(...)`（壳的**本地绑定**）——若壳写成 `export … from`
    // 这里抛 `ReferenceError: computePanel is not defined`，正是本判据要拦的形态。
    const cfg = buildCharConfig(0, config, catalog)
    expect(cfg).not.toBeNull()
    expect(cfg!.slot).toBe(0)
    expect(cfg!.agentId).toBe('1291')
    expect(cfg!.panel).toBeTruthy()
  })

  it('③ 私有 helper 不 re-export（不借搬迁放宽 API）', () => {
    for (const name of PRIVATE) {
      expect((Helpers as Record<string, unknown>)[name], `helpers.${name} 不该导出`).toBeUndefined()
      expect(name in PanelPhases, `panelPhases.${name} 不该导出`).toBe(false)
    }
  })
})
