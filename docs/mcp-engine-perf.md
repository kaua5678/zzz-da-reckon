# 引擎性能优化（calcOutput 记忆化 + 热点修复）

> 2026-09-23 · lane `mcp-engine` · 用户批准高风险改动、允许数值变化（实际**数值零变化**）

## 结论

| 场景 | 之前 | 之后 | 倍数 |
|---|---:|---:|---:|
| 难度曲线 G2 爬梯（般琉卢，FAKE_BOSS） | 17.8s | 4.6s | 3.9× |
| 难度曲线 G1/G3/G4/G5 爬梯（同上） | 79.4s | 26.9s | 2.9× |
| 单次引擎求值（般琉卢，重复读） | 157–233ms | 5–8ms | ≈30× |
| joint-levers 联合搜索（般琉卢） | 4.1s | 1.3s | 3.2× |
| altAxes 用例（全套满载） | 213s | 58s | 3.7× |
| `npm run verify` 全程 | 296.8s | 131.0s | 2.3× |

数值：timeGolden（105 预设 + 60 角色×命座）、seedInvariance、warmStart、行级收入对账、truncationRefold 全部 **0 delta**；
难度爬梯各档伤害逐位不变（例 G2：`38024346.50665935 → 38688779.63977466`，改前改后相同）。

## 方法（实测，不猜）

1. CPU profile（`node:inspector`，200µs 采样）在真实爬梯里取自耗时/包含时间；
2. V8 precise coverage 数函数调用次数；
3. 在 `teamTotalDamage` 读点上按 `config.$state` 签名统计「真重算次数 / 不同配置数」。

关键读数（改前，G2 爬梯）：31 次真重算里只有 **12 个不同配置**；`materializeRows` 自耗时 4.6s/18s；
Vue `get/track/find` + pinia 包装 >10s/40s（目录数据深响应式）；`warmStartExactKey` ~1s（每个缓存条目重算一次键）。

## 改动

1. **calcOutput 记忆化**（`src/composables/useResourceCalc.ts`）：calcOutput 是确定性纯函数，以
   「config 全部 state（排除纯触发器与纯 UI 态）+ 目录对象身份 + teammateBuffsReady + 生效行融合规则」为键，LRU 16。
   - 降配单调闸门（`interactionScaleMonotone`）开启时**绕过**：该路径在求值内写回 store。
   - `setCalcOutputMemoEnabled(false)` 可全局关闭（A/B 对照用）；`getCalcOutputMemoStats()` 读命中统计。
   - `triggerRefresh()` 语义变为「state 未变就复用」：全库调用点均「先改 store 再触发」（已核）。
2. **目录数据 shallowRef**（`src/stores/catalog.ts`）：`catalog` / `teammateBuffGroups` / `buildRecommendations`。
   只会整体替换，全库（含 .vue）无原地改写（已核；`mergeSpecTeamBuffs` 赋值前全量拷贝）。
   ⚠ 将来若要原地改目录，必须整体替换或 `triggerRef`。
3. **materializeRows 快照/恢复**（`src/core/resource/rowBuild.ts`）：不建中间对象；只补回改过的值，键集合变了才 delete。
4. **热启动查找**（`src/core/resource.ts`）：复用已算好的 exactKey。
5. `src/logicEditor/fusion.ts`：新增只读 `activeRowFusionRulesSnapshot()` 供键使用。

## 验证

- `src/composables/__tests__/calcOutputMemo.test.ts`（新，6 例）：
  ① 搜索型调用 memo 开/关逐位相同且确有命中；② store 字段 / 深层嵌套字段 / 行融合规则变化都失效；
  ③ 闸门开启绕过；④ 清热启动缓存后 on/off 对照；⑤ **结果深冻结后命中，全部下游 computed 逐位相同**（证明下游不原地改结果）；
  ⑥ 目录整体替换失效、切 tab/切槽不失效不改值。
- `npm run verify`（最终工作树）：**exit 0**，131.0s；280 文件通过 / 16 跳过，3412 passed / 29 skipped（+3 为本次新测试的净增）；
  recording 189（9 warn，既有）；build 通过；`check-guards` 21/21；`get_diagnostics`（src）0；`git diff --check` 通过。
- 过程中一次 verify exit 2：`vue-tsc -b` 拒绝 `$state as Record<string, unknown>` 的直接断言（TS2352，纯类型），
  改 `as unknown as` 后通过；此前用的 `vue-tsc -p tsconfig.app.json` 没拦住——以 `npm run build` 为准。

## 审查（本地子代理，high）

`eng-r1`：`wb/deepseek-v4.1-flash@high`，只读、仅 `[read]`、10 次读，交付终稿（派发器事后 catalog 校验脚本仍 exit 2，已人工复核父子日志）。
采纳并落地：UI 态误入键导致在同一 cfg 上重跑（→ 排除 `activeTab/selectedSlot/perSlotMarginalGains`，已核引擎零引用）、
热启动缓存对照、结果不可变、目录替换失效、注释与实现不符（toRaw）——均已补测或修正。
审查确认：rowBuild / warmStart 两处与旧版等价，未发现静默错值；config state 无 Map/Set。
未采纳：NaN 键碰撞（需两侧同时 NaN→null 且其余完全相同，未构造出可达反例）。

## 风险（如实）

- 记忆化的正确性依赖「calcOutput 的输入 = 键」。新增**非 store** 的全局响应式输入（类似行融合规则）时必须同步进键。
- 每个 `useResourceCalc()` 实例额外持有 ≤16 份结果（每份含全队执行行），内存略增。
- 剩余热点（改后）：`materializeRows` 自身调用量（inner loop × 可行性降配 8 档）、`buildBanyueExecutions`、GC。
  下一步可做：可行性降配扫描的跨档复用、iterate 内能量/喧响两次 `feasibleRows` 合并。
