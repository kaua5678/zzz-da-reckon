# 引擎性能优化 · 第 2 轮（纯重复计算消除，逐位等价）

> 2026-09-23 · lane `mcp-engine-r2` · 承接 `docs/mcp-engine-perf.md`（第 1 轮：calcOutput 记忆化 + 目录 shallowRef）。
> 第 1 轮消掉的是「同配置重复求值」；本轮只动**单次求值内部**的重复计算，**数值零变化**。

## 结论

| 度量 | 之前 | 之后 | 变化 |
|---|---:|---:|---:|
| 全库等价 dump（104 预设 × 命座 0/2/6 × 交互加码，624 场景，记忆关） | 68.2s | 51.0s | **−25%** |
| 引擎 profile（104 预设 × N=500 采样，含 profiler 开销） | 20.8s | 14.2s | −32% |

**等价判据**：`.zc/perf/dump.perf.ts` 对每个场景记录
`teamTotalDamage | hash(resourceResult) | hash(stunPoolResult) | interactionScaleCeiling`（calcOutput 记忆关闭，热启动每场景清空）。
基线 dumpA 与自身重跑 dumpA2 **0 差异**（dump 本身确定）；每批改动后的 dumpB/D/E 对 dumpA **0 / 624 差异**。
另：timeGolden / seedInvariance / warmStart / calcOutputMemo / difficultyDescent / difficultyCurve / floatNoiseCycle 全绿，`npm run check`、`npm run build`、`npm run verify` 全绿。

## 方法

1. **CPU profile**（`.zc/perf/engine.perf.ts`，`PERF_PROFILE=1`，带 `__callers` 调用者归因）找自耗时/包含时间；
2. **纯度探针**（`.zc/perf/purity.perf.ts`）在改之前量「重复」是否真是重复：
   - `feasibleRows` 544,410 次调用里 **191,495 次（35%）与上一次参数逐项同身份**；这些重复调用的行 **0 次不同**、首次结果被消费后 **0 次被改写**；
   - `iterate` 85,779 次调用 **0 次改写入参 states**。
3. 每个改动之后跑一次 dump 对 dumpA 逐场景比对（非 0 即回退）。

## 改动（全部逐位等价）

1. **`feasibleRows` 作用域单槽记忆**（`src/core/resource/rowBuild.ts`，`@fact engine:物化行作用域记忆`）
   `iterate` Step 1 对同一槽先后调 `calcEnergySource` 与 `calcRawDecibelParts`，两者各物化一次行；次数不变时第二次是纯重复。
   只在 `withFeasibleRowsMemo`（= 单次 `iterate`）作用域内生效，键 = cfg/state 对象身份 + 3 个数值 `Object.is`，作用域退出清槽；
   `setFeasibleRowsMemoEnabled(false)` 供 A/B。测试：`src/core/__tests__/feasibleRowsMemo.test.ts`（作用域/键语义 + 4 预设 × c0/c6 + 交互加码的端到端 A/B 逐位）。
2. **`runInnerLoop` 环检测快照存引用**（`src/core/resource.ts`）：`structuredClone(cur)` → `push(cur)`。
   依据：`iterate` 返回新数组、不改写入参（探针 0 违规），快照只用于比对/回取；出口路径仍 clone。原 `structuredClone` 自耗时 0.78s。
3. **pinia action 包装绕过**：setup store 返回的每个函数被 pinia 包成 `wrappedAction`（每次调用分配回调数组、派发 `$onAction`），
   引擎热路径每轮调上万次（改前 `wrappedAction` 自耗时 0.99s）。全仓无 `$onAction` 消费者 / pinia 插件（已审计）。
   - 新增 **`src/stores/selectionReads.ts`**：选择表读口径的**单一事实源**（`teammateBuffEnabledOf` / `teammateBuffCoverageOf` /
     `discEffectCoverageOf` / `wEngineEffectCoverageMapOf` / `mechanicSettingOf`）。store 方法委托到这里，引擎直接对 state 调用 ⇒ 两条读路径同一口径。
   - `resolveMechanicSettings`、`computePanelPhases`、`mergeTeamDiscEffectCoverages` 改走上述纯函数。
   - `src/composables/resourceCalc/**` + `useResourceCalc.ts` 的 59 处 `catalogStore.getAgent/getWEngine/getAgentSkills(x)`
     → `catalogStore.agentsMap/wEnginesMap/agentSkillsByAgentMap.get(x)`（三个 getter 函数体本来就只有这一行；返回 `undefined` 语义不变）。
   - 响应式：store 代理上按键读取照常 track，computed 失效行为不变。
4. **降配闸门兜底复用同档试算**（`src/composables/useResourceCalc.ts#stageResolveFeasibility`）：
   `best == null` 且单调闸门开时要落到最小档；扫描的最后一次试算就是这一档 ⇒ 复用，不再重跑一次完整外层不动点。
   依据 = GUIDE 判据⑤的受控复现「同档试算与次序无关」。临时自检（复用值 vs 现场重跑逐字段比对）在 44 个降配相关用例中命中 15 次、**0 次不一致**；
   档不匹配时照旧重跑（防将来改成惰性跳档）。已记入 `docs/ENGINE_PIPELINE_GUIDE.md` 判据⑤。

## 否决记录（量过数字，勿重走）

- **`materializeRows` 值快照改 `Object.values`**：直觉是省掉 JS 侧 keyed load，实测**更慢**——105 键对象上 map 130–155ms vs
  `Object.values` 790–820ms / 4 万次（快/字典模式同），全库 dump 52.6s → 63.8s。已回退，并在代码旁留否决注释。
- **`fmt` 改缓存 `Intl.NumberFormat`**：116 vs 112ms，无收益，不改。
- **跨档热启动 / 降配扫描提前终止 / 成本闸门 / 缩放配置去重**：GUIDE 判据⑤已否决（可行集非下闭、`cfgUniq` 8/8、破坏 seedInvariance）。

## 侧发现

- **异步 watch 让「同步读结果」依赖前序状态**：`setCinemaLevel` 后队友 buff 的重同步走 `watch`（异步 flush），
  同一 tick 内直接读 `teamTotalDamage` 会拿到**上一个预设同槽命座**遗留的 buff 选择（实测 `auto-1461-1521-1361` c0：
  冷起 96,950,059 vs 跟在 1431 c6 之后 117,672,873，差的是 `seed.cinema_2_encirclement_def_ignore.enabled`）。
  UI 不受影响（watch 在渲染前 flush）；**测试/探针**在改命座后同步读结果时必须先 `config.syncTeammateBuffsFromTeam()`
  （A/B 测试已加）。`teamCompare` 等批量路径是否有同类问题未排查——见下方待办。

## 剩余热点（改后 profile，自耗时）

`materializeRows` 1.53s（其中约 1/3 是走「键集变化」慢路径：`buildExecutions` 里 13 个角色模块往 cfg **新增**缓存键，
如 1491 `qianxiaMarkSupply` 1759 次 / 1311 `yaojiayinTremolo` 1528 次，恢复时 delete ⇒ cfg 反复变形）、
`runInnerLoop` 0.73s、GC 0.63s、`iterateBody` 0.57s、`buildExecutions` 0.49s、`warmStartExactKey` 0.23s。

## 待办（下一轮候选，按预期收益）

1. **cfg 缓存键预声明**：让 13 个模块的同调用缓存字段在 `buildCharConfig` 里预置（值 `undefined`），`materializeRows` 恒走快路径、cfg 不变形。
   需逐模块确认「undefined 预置」与「键不存在」在消费端等价（`in` / `hasOwnProperty` / `Object.keys` 用法）。
2. **`enrichExecutionPlan` 记忆**（包含 0.55s）：按 `(agentId, moveId, gift, 融合规则快照)` 缓存与次数无关的字段，`total* = 单次 × count` 现算。
3. **`runCalcRound` 常量前缀上提**（`convergence.ts` ~L518–579）到 `createRunCalcRound` 依赖。
4. 排查 `teamCompare` 批量路径是否受上面「异步 watch」侧发现影响。

