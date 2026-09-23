# altAxes 慢测试提速（不放宽超时）

> 2026-09-23 · lane `mcp-altaxes` · 协调者 + 1 名本地只读工人（default 档 = high）

## 问题

`src/composables/__tests__/difficultyCurve.test.ts` 的「切轴档（altAxes）」用例是 `npm run verify` 的唯一红：
基线单跑 242–312s，全套并行负载下超过 420s 预算判超时。上一轮（2026-09-22）只把预算 300s → 420s，未解决根因。
本轮约束：**不得放宽超时**。

## 实测耗时分解（临时探针，已删除）

探针与原用例同 boss/phase/预设，包裹每个目标的 `apply` 计时（含一次引擎求值），单跑总计 299s：

| 目标 | 试开次数 | 合计 | 单次最大 |
|---|---:|---:|---:|
| G2 弹刀/交互联合搜索（joint-levers） | 6 | 197.3s | 80.3s |
| G1 权重均衡（marginal-equalize） | 4 | 55.9s | 20.7s |
| G4 取整 | 6 | 16.1s | 3.7s |
| G5 合轴吸收 | 8 | 14.1s | 2.4s |
| G3 保底 | 2 | 5.5s | 2.8s |

爬梯录取序列：`G3 → AXIS:fury5-ult10 → G1 → G5 → G2`，丢弃 G4、G5（增益 0）。
结论：**G2 联合搜索占 2/3**，且与本用例的契约无关。

## 本用例的契约

1. 切轴档作为 AXIS 目标进入爬梯，被裁决（录取或进 dropped），不许静默消失；
2. 录取 id 均来自目标集或切轴档；
3. 若录取，伤害单调不减；
4. 跑完现场恢复（轴态未启用）。

G2 的真实爬梯已由同文件「每队一条曲线、伤害单调不减，且算完恢复现场」用例（缺省全目标）覆盖。

## 改动

- `src/composables/difficultyCurve.ts`：`DifficultyCurveOptions` 新增可选 `baseGoals`——替换基础目标集，
  **切轴档仍由生产路径按 `preset.altAxes` 追加**。缺省行为不变（`TeamComparePage.vue` 不传，零影响）。
  - 不直接用既有 `goals`：它是完全覆盖，不追加切轴档；测试若自行复刻 `makeAltAxisGoal` + `baseAxisSnap`，
    复刻漂移时可能绑错轴仍全绿（工人指出的风险 ②）。
- `difficultyCurve.test.ts` 本用例：`baseGoals = DIFFICULTY_GOALS \ {G2}`；断言由「任意 `AXIS:*`」
  收紧为「确切的 `AXIS:${preset.altAxes[0].id}`」；预算 **420_000 → 300_000**（回到同文件口径）。

## 结果

- 本用例：299s → **107.4s**；整文件 24/24，126s（单跑）。
- `get_diagnostics`（src/composables）0。
- 完整 `npm run verify`：**exit 0**，296.8s；279 文件通过 / 16 跳过，3406 passed / 29 skipped；
  recording 189 通过（9 warn，既有）；build 通过。全套并行负载下本用例 213.4s（预算 300s，余量约 29%）。
- `check-guards` 21/21；`git diff --check` 通过；文档 LF。

## 风险（如实）

- 去掉 G2 后爬梯语境变了，AXIS 的真实命运（录取/丢弃）可能与全目标时不同；断言对两者都放行，
  所以本用例**不再**覆盖「AXIS 与 G2 竞争」的排序。此前该断言同样是或关系，未因此变弱。
- 若将来 G1 也显著变慢，同法可再剔；更彻底的做法是把 1–3 条下沉为 `difficultyLadder.test.ts` 的桩 ctx 用例。

## 工人记录

| 工人 | 路由 | 结果 |
|---|---|---|
| alt-a1 | `wb/deepseek-v4.1-flash@high`，子代理工具仅 `[read]`，read-only，8 次读 | **成功**：交付终稿（根因 = joint-levers；指出 `goals` 完全覆盖会吞切轴档 → 断言变红而非假绿；复刻快照有绑错轴风险）。派发器事后因 catalog 校验脚本断言抛错（exit 2），但父子日志已人工复核：父子关联、路由、只读、读取范围均符合。 |

证据：`.zc/mcp-altaxes/jobs/alt-a1/`、`.zc/mcp-altaxes/probe.json`、`.zc/mcp-t2/commands/altaxes-probe|altaxes-after|altaxes-verify/`。
