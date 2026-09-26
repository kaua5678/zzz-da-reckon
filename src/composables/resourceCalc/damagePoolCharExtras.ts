/**
 * 逐角色主循环·段 X「角色专属附加块」—— 自 `composables/resourceCalc/damagePool.ts#buildDamagePoolRows`
 * 的 :928–1131 原样外提（CC-9b，2026-09-25，零行为搬迁）。
 *
 * 职责：按角色模块能力 `extraDirectRows` 派发本槽的附加直伤行。柏妮思（余烬 / 搅拌式 / 灼热抛接法 /
 * C6 特殊余烬）与般岳（C6 碎击附伤）于 CC-18a（2026-09-26）迁进各自模块；琉音（额外能力重击附加 /
 * 非轴强特拆分 / 影画6余音）于 CC-18b（2026-09-26）迁进 `liuyin.ts`。本文件只保留这一次派发调用
 * （设计稿 `docs/mcp-cc18-extra-direct-rows.md`）。
 *
 * 与外层闭包的通信面 = `CharRowsEnv`（定义在 `./damagePoolDirect`）：共享输出数组 `rows`
 * （经 `pushDirect` 闭包按原顺序 push，禁止换成返回值拼接）+ `ctx` 快照 + 只读局部量/闭包。
 * 函数**不** import `./damagePool`（只 `import type` `DamagePoolContext`，运行时无环），
 * 也不写任何外层可变量。
 *
 * 依赖方向：本文件不得 import `./damagePool`（值）；只依赖类型与引擎子模块（`@/core/*`、
 * `@/mechanics` 等）。
 */
import { panelAt } from '@/core/panel'
import { getAgentMechanic } from '@/mechanics'
import type { CharRowsEnv, CharLocals } from './damagePoolDirect'

/**
 * 段 X「角色专属附加块」（零行为搬迁，CC-9b；CC-18a/b 逐块外迁后只剩派发）。
 * 保留原 `buildDamagePoolRows` :928–1131 的调用位置与解构面，各角色块已按模块能力外提。
 */
export function emitCharExtraRows(env: CharRowsEnv, cl: CharLocals): void {
  const {
    configStore, catalogStore,
    damagePanels, stunPoolResult, liuyinPromoteCount,
  } = env.ctx
  const {
    isAxis, axisStunFor, pushDirect, ultimateInAxisFraction,
  } = env
  const { charResult, slot } = cl

  // 角色专属附加直伤行（规则 6 迁移落点，CC-18a 2026-09-26，设计稿
  // `docs/mcp-cc18-extra-direct-rows.md` §2-3）：柏妮思块 1 / 半月块 3 已迁进各自模块的
  // `extraDirectRows`，消费端在原块 1 的位置放**一次**调用，按返回顺序 `pushDirect`。
  // 顺序论证见设计稿 §2-3/§3：各块按角色互斥，迁走后对任意角色其自身行的相对顺序与 `rows`
  // 的全局顺序都不变。CC-18b 2026-09-26：琉音块 2 / 4 / 5 迁进 `liuyin.ts`，同一次调用派发。
  const extra = getAgentMechanic(charResult.agentId)?.extraDirectRows?.({
    charResult,
    slot,
    panel: panelAt(damagePanels, slot),
    isAxis,
    axisStunFor,
    teammateAt: (s) => ({ panel: panelAt(damagePanels, s), agent: s >= 0 ? (configStore.team[s]?.agentId ? catalogStore.agentsMap.get(configStore.team[s].agentId) : null) : null }),
    stunCount: stunPoolResult?.stunCount ?? 0,
    promoteCount: liuyinPromoteCount,
    getMechanicSetting: (k, d) => configStore.getMechanicSetting(k, d),
    ultimateInAxisFraction,
  })
  if (extra) for (const row of extra) pushDirect(row)
}
