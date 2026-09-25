/**
 * 终局整数重推执行器（规则 6 引擎落点，2026-09-25 CC-6c）。
 *
 * 取代原先住在 `core/resource.ts` 里的两段角色专属「实数化收尾」闭包：
 *   · preTail（S2 折叠之后、S3a 欠打回填之前）：星徽·比利 `billyFinalizeChain`、叶瞬光
 *     `yeshuguangFinalizeForms`；
 *   · tail（S3a 欠打回填之后、S4 装配之前）：伊德海莉 `yidhariFinalizeEx`。
 * 三者共享同一台 ≤12 轮整数态重推机器，只有「谁参与 / 置哪个旗标 / 何时复位」是角色专属的。
 * 这正是规则 6 要消灭的形状（引擎替某个角色认人），现改为：
 *   · 模块声明能力 `finalizePass`（`AgentMechanicModule`，见 `mechanics/types.ts`）；
 *   · 本文件按 `getAgentMechanic(cfg.agentId)?.finalizePass` 查询，不写 agentId 字面量、
 *     不 import 角色模块（两条 core 棘轮盯着）；
 *   · `iterate` 由调用点**参数注入**（不 import `helpers.ts`，避免引擎内部依赖与循环）。
 *
 * ⚠ **两个 stage 不可合并**（lead 重核 2026-09-25）：preTail 在欠打回填前、tail 在其后，
 * 且截断重折环只重跑 preTail + tail、不复位。合并会让 1051 的重推提前、或让 1531/1431 的
 * 重推延后 ⇒ 数值重排（反向验证：把 yidhari 的 stage 改成 `'preTail'` ⇒ 带 1051 的 dump 非零差异）。
 *
 * ⚠ **复位的不对称性逐位保留**（设计稿曾写成「对所有声明者无条件 reset」，是错的）：
 * `resetFinalizePasses` 对每个**声明了 `finalizePass`** 的 cfg 都调 `reset`，由模块自己决定语义——
 *   · 比利 / 伊德海莉：无条件写 `false`（哪怕 `begin` 从没跑过）；
 *   · 叶瞬光：先判 `yeshuguangContinuousForms === 1` 再写，否则字段保持 `undefined`。
 * 写错会让 `undefined → false` 漂进 cfg，可能进 hash / 热启动键。
 *
 * 复位时机在**装配之后**（`resource.ts` 调用点）：装配行必须仍按终局整数语义出账，
 * 复位只服务于「cfg 被外层不动点 / 热启动复用，下轮回到实数迭代期」。
 */
import type {
  CharacterOperationConfig,
  IterationState,
  ResourceCalcConfig,
} from '@/types/resource'
import { getAgentMechanic } from '@/mechanics'

/** 终局重推轮数上限（原两处闭包同值） */
const FINALIZE_MAX_PASSES = 12

/** 与旧 `runBillyFinalize` / 伊德海莉块逐字同款的 10 字段逐位判稳 */
function statesBitEqual(a: IterationState, b: IterationState): boolean {
  return a.exSpecialCount === b.exSpecialCount && a.ultimateCount === b.ultimateCount
    && a.basicAttackTime === b.basicAttackTime && a.necessaryTime === b.necessaryTime
    && a.frontlineTime === b.frontlineTime && a.backstageTime === b.backstageTime
    && a.comboAlignTime === b.comboAlignTime && a.comboAlignCredit === b.comboAlignCredit
    && a.totalEnergy === b.totalEnergy && a.totalDecibel === b.totalDecibel
}

/**
 * 跑一个 stage 的终局整数重推。
 *
 * 契约：
 *   · `targets` 为空直接返回 `{ states, converged: false }`，**不调 `iterate`**（与旧式
 *     `if (billyFinalizeConfigs.length > 0 || …)` 守卫等价）；
 *   · 对每个 target 调 `begin`（只碰自己那份 cfg），随后 ≤12 轮 `iterate`，全状态逐位稳定才收敛；
 *   · 返回的 `converged` 由调用点以 `if (fp.converged) converged = true` 合并（**不许**写成
 *     `converged = fp.converged`——那会覆盖另一条 stage 的收敛结果）。
 */
export function runFinalizePasses(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  stage: 'preTail' | 'tail',
  iterate: (cfgs: CharacterOperationConfig[], st: IterationState[], config: ResourceCalcConfig) => IterationState[],
  config: ResourceCalcConfig,
): { states: IterationState[]; converged: boolean } {
  const targets = configs.filter(c => {
    const fp = getAgentMechanic(c.agentId)?.finalizePass
    return fp?.stage === stage && fp.applies(c)
  })
  if (targets.length === 0) return { states, converged: false }
  for (const cfg of targets) {
    getAgentMechanic(cfg.agentId)?.finalizePass?.begin(cfg)
  }
  let st = states
  let stable = false
  for (let pass = 0; pass < FINALIZE_MAX_PASSES; pass++) {
    const prev = st
    st = iterate(configs, st, config)
    if (st.length === prev.length && st.every((s, i) => statesBitEqual(s, prev[i]))) {
      stable = true
      break
    }
  }
  return { states: st, converged: stable }
}

/**
 * 装配后复位：cfg 被外层不动点 / 热启动复用，下轮必须回到实数迭代期。
 *
 * 对每个声明了 `finalizePass` 的 cfg 调 `reset`；**不对称语义由模块自己保留**
 * （叶瞬光只在 `yeshuguangContinuousForms === 1` 时写，比利 / 伊德海莉无条件写），见文件头注释。
 */
export function resetFinalizePasses(configs: CharacterOperationConfig[]): void {
  for (const cfg of configs) getAgentMechanic(cfg.agentId)?.finalizePass?.reset(cfg)
}
