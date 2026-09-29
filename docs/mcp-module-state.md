# 模块私有状态借道共享 cfg：测量与决策（第 307 轮）

> 结论先行：**不做运行时「模块私有状态袋」迁移，也不做类型声明搬家**。依据是测量结果：真正有风险的那一层（可重复调用钩子写的私有键）只有 29 个，已经被 CC-290～292 的行为锁全部覆盖。其余 358 个私有键是「建 base 时写一次」或「每轮新克隆上写一次」，结构上不会出 CC-288～291 那类问题。迁移面有 387 个键、60 个模块，收益主要是整洁，按唯一判据（更通用 / 更简单，而不是降计数）不值得做。
> 回退 / 重开条件：见 §4。

## 1. 问题

CC-285～292 连续 4 类缺陷（死写入、写得太晚、非幂等累加、提前 return 留旧值）的根源相同：角色模块把只有自己读的中间量写在共享的 `CharacterOperationConfig`（cfg）上，正确性靠调用顺序和每个模块手写的 prev 扣减维持。第 306 轮交接要求先测量：私有通道到底有多少、集中在哪里，再决定是否设计统一的「模块私有状态袋」。

## 2. 测量（`node scripts/cfg-key-census.cjs`，TypeScript AST + 按词匹配读者，近似）

agents 模块写入的 cfg 键共 476 个，按「谁读」×「在哪个钩子里写」分类：

| 读者分类 | 键数 / 模块数 | once（仅 buildCharConfig） | round（含 applyTeamConfig） | repeat（其他可重复调用钩子） |
|---|---|---|---|---|
| a 只在本模块读（私有通道） | 387 / 60 | 307 | 51 | **29** |
| b 只被外部读（core / resourceCalc / spec cfgField / store） | 33 / 26 | 19 | 4 | 10 |
| c 本模块和外部都读 | 55 / 45 | 29 | 13 | 13 |
| 无读者 | 1 | 1 | 0 | 0 |

钩子层级的含义（第 303～306 轮读 convergence.ts 确认）：
- **once**：`buildCharConfig` 只在构建 base cfg 时调用一次，写进去的是模块常量（命座、面板派生值、行倍率等），之后只读。不会残留、不会累加。
- **round**：`applyTeamConfig` 每轮每相位对新克隆（`convergence.ts:424` 的 `{ ...base cfg }`）调用一次。本轮写、本轮读，下一轮重新克隆，不会跨轮残留。
- **repeat**：buildExecutions / patchExecutions / materializePhaseState / buildAnomalyEvents / onFinalAssemble / estimateExSpecialTime / nextRoundFeedback 等，会在同一份 cfg 上被内层迭代、underfillProbe、装配重复调用。**CC-288～291 的缺陷全部出在这一层。**

a/repeat 的 29 个键（全部）：grace（graceBasicPoolPrev / graceC4EnergyGift / gracePulseGrenadeCount）、luciaElowen（luciaCurtain* ×3）、lucy（lucyCheerSpinsEstimate / lucyTeammateExTotal）、nangongMinePairs、nekomataHitPurrGain、orphieC2DecibelGift、panYinhuC2EnergyTotal、phoenixChargedCount、promia（promiaAttackFrostGain / promiaTriggerHitCount / promiaTeammateReleaseCount）、peiluoProminenceLedger、starlightBilly（billyChainCount / billyChainHp / billyFullThrottleCount / billyFinalizeChain）、vivian（vivianTeamExTotal / vivianAnomalyTriggerTotal）、yeshuguang（yeshuguangAutoAxis / yeshuguangCycle / yeshuguangFinalizeForms / yeshuguangFrozenZhaoying）、yidhariExternalHealPct、zhuYuanC6AfterglowEnergy。

类型声明：私有键中有 153 个声明在共享类型 `types/resource/config.ts`（837 行）上，234 个未声明（经 `record` / `as any` 访问）。

## 3. 决策

### 3.1 运行时状态袋（如 `cfg.moduleState[moduleId]` 由引擎统一清空 / 保留）：**不做**

- 风险层只有 a/repeat 的 29 个键，已由 `hookReplay.test`（重放一致 + 无陈旧值，覆盖全部 repeat 钩子）、`idempotentCfgWrite.test`（AST 累加锁）、`lateCfgWrite.test` 兜底。锁是按行为判定的，新模块写出同类问题会直接红。
- 状态袋并不能自动消除这类问题：引擎仍要按钩子层级决定「何时清空」。例如 lucy / promia / vivian 的键是**有意的轮间通道**（nextRoundFeedback → applyTeamConfig），清空会改变收敛。所以状态袋要么复刻现有的层级规则，要么给每个键加声明。这是把现有复杂度搬家，不是消除复杂度。
- 还要同步改 materializeRows 的 cfg 快照 / 恢复、`outerFeedbackSignature` 的投影、spec cfgField 的读取路径（b / c 类），迁移面 387 键 × 60 模块，回归风险高。

### 3.2 私有键的类型声明搬出共享类型：**不做**

- 153 个私有键声明在共享类型上，确实让 `CharacterOperationConfig` 臃肿；但搬家只改类型、不改行为，收益是「共享类型变短」，属于整洁性改动。
- 共享类型上的私有字段也没有被别的层滥用：按定义，a 类键没有外部读者；core 读角色前缀字段已经被 CC-14a 系列规则 / 锁禁止。
- 不加新棘轮（例如「新私有键不得声明在共享类型」）：那是计数型约束，用户明确不要。

## 4. 回退 / 重开条件

以下任一情况出现时，重新评估 3.1：
- hookReplay 允许名单开始增长（出现无法修成幂等、只能放行的钩子）；
- 新增 repeat 层私有键的速度明显上升（重跑 `node scripts/cfg-key-census.cjs` 对比本表 29）；
- 需要把管线搬到无 Vue / worker 环境，cfg 必须可序列化、模块状态必须可分离。
