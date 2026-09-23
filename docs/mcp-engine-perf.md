# 引擎性能（活文档：现状 · 手段 · 否决记录）

> 每轮优化**更新本文**，不新开 `-rN` 文档（控制文档膨胀）。每轮细节在 git log；这里只留「下一个人需要知道的」。
> 最近更新：2026-09-23 第 2 轮。

## 现状读数

| 度量 | 基线 | 第 1 轮后 | 第 2 轮后 |
|---|---:|---:|---:|
| 难度曲线 G2 爬梯（般琉卢） | 17.8s | 4.6s | — |
| `npm run verify` | 296.8s | 131.0s | — |
| 全库 dump（624 场景，calcOutput 记忆关） | — | 68.2s | 51.0s |

## 等价验证手段（改引擎性能前必看）

- **全库 dump**：`.zc/perf/dump.perf.ts`（gitignored；104 预设 × {默认, 槽0 C0/C6, 平A权重扰动, 交互加码, 加码+闸门}），
  每场景记 `teamTotalDamage | hash(resourceResult) | hash(stunPoolResult) | interactionScaleCeiling`。
  改前跑一次存 A、改后跑 B，**0 差异才算等价**；A 自身重跑 0 差异（dump 确定）。
- **profile**：`.zc/perf/engine.perf.ts`（`PERF_PROFILE=1`，带调用者归因）。
- **纯度探针**：先量「重复」是否真是重复，再做记忆（例：`feasibleRows` 同参数重复 35%、行 0 次不同、结果 0 次被改写）。
- 仓内测试：`calcOutputMemo` / `feasibleRowsMemo`（记忆开/关 A/B 逐位）+ timeGolden / seedInvariance / warmStart。

## 已落地手段与前提（前提失效 = 静默错值）

| 手段 | 位置 | 前提 |
|---|---|---|
| calcOutput 记忆化（LRU 16） | `useResourceCalc.ts` | 输入 = 键：新增**非 store** 的全局响应式输入必须进键；闸门开启时绕过 |
| 目录数据 shallowRef | `stores/catalog.ts` | 目录只整体替换，不原地改 |
| `materializeRows` 快照/恢复只补改动值 | `core/resource/rowBuild.ts` | — |
| `feasibleRows` 作用域单槽记忆 | `rowBuild.ts#withFeasibleRowsMemo` | 单次 `iterate` 内 cfg/state 与行不被改写（`@fact engine:物化行作用域记忆`，带复核） |
| 环检测快照存引用 | `core/resource.ts#runInnerLoop` | `iterate` 返回新数组、不改写入参 |
| 引擎读 store 绕过 pinia action 包装 | `stores/selectionReads.ts`（读口径单源）+ `catalogStore.xMap.get` | 全仓无 `$onAction` / pinia 插件；新增读口径加进 `selectionReads` 并让 store 方法委托 |
| 降配闸门兜底复用同档试算 | `useResourceCalc.ts#stageResolveFeasibility` | 同档试算与次序无关（GUIDE 判据⑤受控复现） |

## 否决记录（量过数字，勿重走）

- `materializeRows` 值快照改 `Object.values`：慢 ~5×（105 键对象 4 万次 map 130–155ms vs 790–820ms），dump 52.6→63.8s。
- `fmt` 缓存 `Intl.NumberFormat`：116 vs 112ms，无收益。
- 跨档热启动 / 降配扫描提前终止或成本闸门 / 缩放配置去重：破 seedInvariance、可行集非下闭、`cfgUniq` 8/8（GUIDE 判据⑤）。

## 剩余热点（第 2 轮后，自耗时 / 14.2s profile）

`materializeRows` 1.53s（约 1/3 走「键集变化」慢路径：模块往 cfg **新增**同调用缓存键、恢复时 delete ⇒ cfg 变形）·
`runInnerLoop` 0.73s · GC 0.63s · `iterateBody` 0.57s · `buildExecutions` 0.49s · `enrichExecutionPlan` 包含 0.55s · `warmStartExactKey` 0.23s。
