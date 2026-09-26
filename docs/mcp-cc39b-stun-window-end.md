# CC-39b 设计稿与实施记录：「结束失衡窗口的轴块」统一能力

> lane lead-arena-0925c，2026-09-27 第 54 轮。判据 22 **7 → 5**。提交见 census §5.41。

## 1. 现状（改前）

同一判定在两处写死，且各自 import 雨果模块的函数或常量：

| 位置 | 用途 | 写法 |
|---|---|---|
| `convergence.ts` 决算截断（`verdictSecondsLost`） | 轴内决算做完时扣掉窗口剩余失衡秒 | `act.moveId === '1551016' \|\| isHugoEndsWindowMove(moveId, cinema)`，时长 `hugoMoveActionTime(moveId, dur)` |
| `roundInputs.ts` 轴栈动作（`endsStunWindow` 标记） | 轴栈填充归零 + 窗口截断 | `'1551016' \|\| HUGO_EX_VERDICT_MOVE_ID \|\| (HUGO_ULT_MOVE_ID && cinema < 2)`，时长兜底 `actionTime <= 0 && HUGO_EX_VERDICT ⇒ HUGO_EX_FINAL_ACTION_TIME` |

问题：两处必须同源，却是两份手写，而且都带角色字面量。判据 22 计 2（`hugoMoveActionTime`）。

## 2. 方案（已落地）

- 新增模块能力（`src/mechanics/types.ts`）：
  - `endsStunWindow?(moveId, cinemaLevel): boolean`
  - `axisMoveActionTime?(moveId, catalogActionTime): number`
- 实现：
  - 雨果（`hugo.ts`）：`endsStunWindow: isHugoEndsWindowMove`、`axisMoveActionTime: hugoMoveActionTime`，函数体不变。
  - 佩洛伊斯（`specPanelBuffs.ts`）：`peiluoProminenceMechanic.endsStunWindow = (moveId) => moveId === PEILUO_ULT_VERDICT`。
- 单一派发点（`src/composables/resourceCalc/helpers.ts`）：`axisMoveEndsStunWindow(agentId, moveId, cinema)`、`axisMoveActionTimeOf(agentId, moveId, t)`，按**轴块所在槽**的 `configStore.team[act.slot]?.agentId` 派发。convergence 和 roundInputs 都只调这两个函数，**以后新增决算类角色只写模块，不碰编排层**。
- roundInputs 删掉 `@/mechanics/agents/hugo` 的值导入，convergence 删掉 `isHugoEndsWindowMove` / `hugoMoveActionTime` 的导入。

### 等价性论证
- 原判定只看 `moveId`，不看槽位角色；新判定先按槽位角色派发再看 `moveId`。招式 id 带角色前缀（`1551…` / `1291…`），合成行 `1291_ex_verdict_final` 只由雨果模块产出 ⇒ 只会出现在本角色的槽里，两者等价。
- 时长兜底：原式「`≤0` 且 id 命中 ⇒ 常量，否则原值」与 `hugoMoveActionTime` 逐字同义。
- 边界（已知、可接受）：若轴预设里有 slot 与角色不匹配的脏块（比如换人后轴没重算），旧逻辑照判，新逻辑不判。实际上轴随队伍重解析，没有观察到这种情况。

## 3. 验证

| 步 | 结果 |
|---|---|
| vue-tsc -b | 0 |
| 单测 axisStunWindowEnd（新，4 条）/ hugo / stunAxis / peiluo / stunVulnSummary / timeLedgerInvariants | 114 条通过 |
| dump / rowsnap vs H2a | 只有 `__ms` 差 |
| 反向①（佩洛伊斯 `endsStunWindow` 恒 false） | dump **零差**（perf 语料不含佩洛伊斯轴决算截断）；新单测红 1 |
| 反向②（雨果 `axisMoveActionTime` 恒原值） | dump **零差**；新单测红 1 |
| 接线探针（两处调用点改为恒 false，跑 composables / mechanics / core 全部单测） | **stunVulnSummary 雨果 0 命轴集成快照红 2**（案例 B / D）⇒ 调用点接线有集成覆盖 |
| `npm run verify` | EXIT=0（提交 `a1eb71e`） |

脚本：`/home/kaua/calc-arch/cc39b.py`、`z39b.sh`、`p39b.sh`（接线探针）。

## 4. 已知坑 / 未决
- **perf 语料对决算截断零覆盖**（佩洛伊斯、雨果都是）：以后改这条路径不能靠 dump 零差验收，必须跑 `axisStunWindowEnd` + `stunVulnSummary`。佩洛伊斯轴决算截断集成快照 **已补（CC-39c `0f9f329`，`peiluoVerdictTruncation.test.ts`，census §5.43）**。原待办：仿照 `stunVulnSummary.test.ts` 的雨果 0 命轴案例，给佩洛伊斯右分支决算建一条轴快照，锁 `verdictSecondsLost > 0`。
- 常量 `HUGO_EX_VERDICT_MOVE_ID` 等仍由 `hugo.ts` 导出供模块内和测试使用，不删。

## 5. 回退点
`git revert a1eb71e`（单提交，含棘轮常量 5 与新测试文件）。
