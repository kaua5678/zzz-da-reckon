/**
 * 连携总次数的**唯一**读取口（CC-505，r687；住 core 而非 mechanics：core 只许经 registry 触达 mechanics——coreRuntimeDeps 锁，mechanics 则可自由 import core）。
 *
 * 产品规则：`chainCountTotalOverride ?? chainCountPerStun × 失衡次数`——
 *  - 失衡轴模式由编排层把「各轴按窗口数加权后的最终连携次数」注入 `chainCountTotalOverride`（engine 口径），
 *    有值即为准、不再乘；
 *  - 否则 = 每次失衡连携次数 × 失衡次数（失衡次数由外部失衡池不动点收敛后传入，各调用方自己决定取哪一份：
 *    `countStunOf(globalCfg)` / `countStunPlan` / 模块入参 `stunCount` / 希格莉德的 `sigridStunCount`）。
 *
 * 此前这一行在 10 处各写一遍（core/resource/helpers ×3、core/resource、convergence、anby / corin / sigrid /
 * specPanelBuffs / liuyin），且 helpers 内两份还互相注释「与第一个循环保持一致」。`chainCountPerStun` 在
 * 引擎 cfg 上是必填 number，在模块侧的 Partial cfg 上可缺省 ⇒ 统一 `?? 0`（引擎侧为超集，不改变值）。
 *
 * 不归这里：claret 的 `override ?? state.chainCountTotal ?? 0`（读的是收敛态，不是输入规则）、
 * `chainCountTotalExtra` 的加成（只有 `core/resource.ts` 初态一处，调用方自己加）。
 */
export function chainCountTotalOf(
  cfg: { readonly chainCountTotalOverride?: number; readonly chainCountPerStun?: number },
  stunCount: number,
): number {
  return cfg.chainCountTotalOverride ?? (cfg.chainCountPerStun ?? 0) * stunCount
}
