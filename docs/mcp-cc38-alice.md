# CC-38 设计稿与实施记录：爱丽丝在 core / 编排层的残留去角色化

> lane lead-arena-0925c，2026-09-27 第 53 轮。判据 22（core 角色前缀字段棘轮）**22 → 7**，爱丽丝清零。
> 提交见 `docs/mcp-r22d1-batch12-field-census.md` §5.40。

## 1. 现状（改前，rf3 快照 15 计）

| 字段 | 计 | 位置 | 性质 |
|---|---|---|---|
| `aliceSparkOverride` | 3 | `roundInputs.ts` `calcAnomalyPoolInput` 形参 ×2、`convergence.ts` 依赖签名 ×1 | 局部命名 |
| `aliceSpark` | 3 | `roundInputs.ts` 形参落地的局部量 | 局部命名 |
| `aliceSparkThisRound` | 3 | `convergence.ts` 本轮赠送次数局部量（ap0 / ap1 两处传参） | 局部命名 |
| `aliceSparkCountOf` | 2 | `convergence.ts` 值导入 `@/mechanics/agents/alice` 并调用（编排层按身份取值） | 身份耦合 |
| `aliceSwordWillSource` | 1 | `outerCycle.ts` 外层收敛签名直读爱丽丝资源明细 | 身份耦合 |
| `aliceCoweringDot` | 3 | `core/anomalyPool.ts` 异常池输出字段（局部量 ×2 + 返回键 ×1） | 输出字段名 |

## 2. 方案与决定

### 38a 纯改名（−9）
- `aliceSparkOverride` → `giftedPolarAssaultOverride`；`aliceSpark` → `giftedPolarAssault`；`aliceSparkThisRound` → `giftedPolarAssaultThisRound`。
- 依据：这些量的语义是「异常池 `giftedTriggerCounts['physical_polar_assault']` 的赠送次数」，与提供方是谁无关。

### 38b 模块能力 `giftedPolarAssaultCount(char)`（−3）
- 签名：`AgentMechanicModule.giftedPolarAssaultCount?(char: CharacterResourceResult): number`（`src/mechanics/types.ts`）。
- 爱丽丝实现：`(c) => c.aliceSwordWillSource?.sparkCount ?? 0`（`alice.ts` 的 `aliceMechanic`）。
- 编排层：`convergence.ts` 对 `rr.characters` 按 `getAgentMechanic(c.agentId)` 派发并**求和**；`outerCycle.ts` 逐角色投影同一值（无此能力 ⇒ 0，与原字段缺省同形，签名字符串逐字不变）。
- 删除导出 helper `aliceSparkCountOf`（除编排层外无调用方，grep 确认）。
- **等价性**：原实现取队内**第一个**爱丽丝的值；队伍角色不重复 ⇒ 求和 = 该值。若日后允许同角色多槽，此处语义要复核（求和 vs 取首个）。

### 38c 异常池输出字段 `aliceCoweringDot` → `coweringDot`（−3）
- **推翻 CC-24（census §5.17 第 3 条 / §5.18）的「不改」口径**。当时依据是「结果对象键，被 rowsnap 消费，改了会影响 rowsnap 键」。本轮实测：`dump-H2a.json` / `rows-H2a.json` 中 `Cowering` 出现 **0 次**，perf 快照不序列化这个键；改名后 dump / rows 逐位零差（只有 `__ms` 不同）。
- 改名范围（整词 13 处 / 7 文件）：`types/resource/pools.ts` 1（注释里保留 1 次旧名）、`core/anomalyPool.ts` 3、`views/ResultPage.vue` 1、`mechanics/agents/alice.ts` 2、`mechanics/types.ts` 1（注释）、`mechanics/__tests__/alice.test.ts` 2、`composables/__tests__/convergenceNightB.test.ts` 3。
- **不改**：类型名 `AliceCoweringDotResult`、函数名 `calcAliceCoweringDot`（首字母大写或非前缀，不计入判据 22；纯观感，留给以后顺手改）；爱丽丝 cfg 字段 `aliceEnabled` / `aliceCowering*`（模块自有）。

## 3. 验证（均已通过）

| 步 | 结果 |
|---|---|
| vue-tsc -b | 0 |
| 单测 alice / outerFeedback / convergenceNightB / anomalyPool / checkGuards | 38ab 180 条中仅 checkGuards 2 条红（棘轮未改，预期）；38c 44 条通过 |
| dump / rowsnap vs H2a | 两步均只有 `__ms` 差 |
| 反向①（`giftedPolarAssaultCount` 恒 0） | dump **25 键**出差（`auto-1401-*`），单测红 2 |
| 反向②（异常池 `coweringDot` 置 undefined） | rowsnap **29 键**出差，单测红 4 |
| `npm run verify` | EXIT=0（提交 `7b865bf`） |

脚本：`/home/kaua/calc-arch/cc38.py`、`z38.sh`、`cc38c.py`、`z38c.sh`。

## 4. 回退点
单个提交（38a/b/c 共改 `alice.ts`、`types.ts`，无法按文件拆分，合并提交）。`git revert 7b865bf` 即回到 22 计（棘轮常量在同一提交内）。

## 5. 已知坑（写给后来者）
- 「输出键被快照消费」这类口径，动手前先 `grep -c` 基线 JSON 实测，不要沿用旧结论。
- rf3 只扫 `src/core/*.ts`、`resourceCalc/*.ts`、`useResourceCalc.ts`；`types/resource/pools.ts` 注释里保留的旧名不计。
