# 引擎性能（活文档：现状 · 手段 · 否决记录）

> 每轮优化**更新本文**，不新开 `-rN` 文档（控制文档膨胀）。每轮细节在 git log；这里只留「下一个人需要知道的」。
> 最近更新：2026-09-23 第 3 轮。

## 现状读数

| 度量 | 基线 | 第 1 轮后 | 第 2 轮后 | 第 3 轮后 |
|---|---:|---:|---:|---:|
| 难度曲线 G2 爬梯（般琉卢） | 17.8s | 4.6s | — | — |
| `npm run verify` | 296.8s | 131.0s | — | — |
| 全库 dump（624 场景，calcOutput 记忆关） | — | 68.2s | 51.0s | 45.2s（同口径 52.0s 起，含队友 buff 同步修复） |

## 等价验证手段（改引擎性能前必看）

- **全库 dump**：`.zc/perf/dump.perf.ts`（gitignored；104 预设 × {默认, 槽0 C0/C6, 平A权重扰动, 交互加码, 加码+闸门}），
  每场景记 `teamTotalDamage | hash(resourceResult) | hash(stunPoolResult) | interactionScaleCeiling`。
  改前跑一次存 A、改后跑 B，**0 差异才算等价**；A 自身重跑 0 差异（dump 确定）。
- **profile**：`.zc/perf/engine.perf.ts`（`PERF_PROFILE=1`，带调用者归因）。
- **纯度探针**：先量「重复」是否真是重复，再做记忆（例：`feasibleRows` 同参数重复 35%、行 0 次不同、结果 0 次被改写）。
- 仓内测试：`calcOutputMemo`（记忆开/关 A/B 逐位）+ timeGolden / `landingPointUniqueness`（同输入落点唯一）。
- **全角色护栏** `src/core/__tests__/allAgentsGuards.test.ts`：catalog 枚举全部角色（新角色零配置纳入）× 命座 0/6 × 交互加码，
  验 ① 同配置重算幂等 ② 行物化快路径开/关逐位相同。**dump 只覆盖预设里出现的角色**（首例：1551 不在任何预设，漏检），新快路径一律接进这里。

## 已落地手段与前提（前提失效 = 静默错值）

| 手段 | 位置 | 前提 |
|---|---|---|
| calcOutput 记忆化（LRU 16） | `useResourceCalc.ts` | 输入 = 键：新增**非 store** 的全局响应式输入必须进键；闸门开启时绕过；r707 起模块级、全部实例共享 ⇒ 影响结果的**实例参数**也必须进键 |
| 目录数据 shallowRef | `stores/catalog.ts` | 目录只整体替换，不原地改 |
| `materializeRows` 快照/恢复只补改动值；模块新增键恢复为 undefined 而非 delete（防 cfg 变字典模式，dump −5%） | `core/resource/rowBuild.ts` | 无人以 `in`/`hasOwnProperty` 判 cfg 键（全角色护栏 ②） |
| `feasibleRows` 作用域单槽记忆 | `rowBuild.ts#withFeasibleRowsMemo` | 单次 `iterate` 内 cfg/state 与行不被改写（`@fact engine:物化行作用域记忆`，带复核） |
| 环检测快照存引用 + 预键分桶（仅预键碰撞才算全量 JSON） | `core/resource.ts#runInnerLoop` | `iterate` 返回新数组、不改写入参 |
| `fmt` 快路径（\|r\|<1000 且 ≤3 位小数 ⇒ `String(r)`） | `utils/format.ts` | 载入时探测 locale 不加分组/小数点即 `.`（de_DE 下自动关）；`format.test.ts` 2 万例对照 |
| 引擎读 store 绕过 pinia action 包装 | `stores/selectionReads.ts`（读口径单源）+ `catalogStore.xMap.get` | 全仓无 `$onAction` / pinia 插件；新增读口径加进 `selectionReads` 并让 store 方法委托 |
| 降配闸门兜底复用同档试算 | `useResourceCalc.ts#stageResolveFeasibility` | 同档试算与次序无关（GUIDE 判据⑤受控复现） |

## 否决记录（量过数字，勿重走）

- `materializeRows` 值快照改 `Object.values`：慢 ~5×（105 键对象 4 万次 map 130–155ms vs 790–820ms），dump 52.6→63.8s。
- `fmt` 缓存 `Intl.NumberFormat`：116 vs 112ms，无收益。
- 快照改 `for-in` / 手写循环 / push：2021 vs 1528ms、三者无差（微基准），不改。
- 跨档热启动 / 降配扫描提前终止或成本闸门 / 缩放配置去重：破落点唯一性、可行集非下闭、`cfgUniq` 8/8（GUIDE 判据⑤）。

## 模块写法红线（护栏抓到过的真 bug）

- 钩子**不得** `+=` 缓存对象（`panels.value[i]` / 行 / cfg）。面板加成放 `applyPanel`（每次新建面板）。
  反例：佩洛伊斯耀斑挂 `transformSkillExecutions`（单次计算调 12–16 次）⇒ 伤害 +480%~+640% 且每次重算继续累加，已修（timeGolden 1551 −73.95% = 1.55/5.95）。
- **此条已由机制强制，不靠自觉**（第 4 轮）。三层，新角色零声明自动覆盖：
  1. 编译期：`AgentSkillTransformInput.panel/charResult`、`AgentDamageResolutionInput.exec`、`ReleaseModifierInput.panels` 是 `DeepReadonly`，写入 = tsc 红。
  2. 运行期（仅测试）：`resourceCalc/freezeCached.ts` 深冻结 `panels` 与 `calcOutput`，写入即抛错、栈指肇事行；生产构建里被 tree-shake 掉。
     首跑抓到橘福福 `panel.impact += 50`（面板页冲击取决于资源计算有没有先跑过），已迁 `applyPanel`；`__xxxApplied` 防重入标记全部删除。
  3. 结果：`allAgentsGuards` ③ 历史无关：B→A 与全新直达 A 比面板 / rr / 伤害 / 配置，每个角色在三个槽位各出场一次，外加随机命座/潜能/音擎。
     变异验证：把 buff 同步改成「只开不关」⇒ 62 队里红 11+ 队。
- 行上的伤害定向（`skillDamageTarget`）覆盖用模块字段 `skillDamageTargetOverrides` 声明，由 `enrichExecutionPlan` 统一应用，赠行也应用。
  在钩子里写会被 enrich 的推断值静默冲掉；transform 里写则是改缓存（零号·安比即此，已迁，逐位等价）。
- 派生函数的依赖字段 = watch 源：`TEAMMATE_BUFF_INPUT_KEYS` 同时生成 `deriveTeammateBuffEnabled` 的入参类型与重同步 watch 源。
  旧 watch 手写 `{agentId, cinemaLevel}`，漏了潜能/音擎。
- 第 5 轮：**钩子输入只有输出通道可写**，其余字段一律只读（`ReadonlyTeam`、`Readonly<IterationState>`、feedback / 轴 / 异常 panels 用 `DeepReadonly`），违规写入会让 tsc 报红。
  - `buildCharConfig` 的 `panel` 改为只读后，编译器列出 3 处写入：雨果、蕾米埃尔两处与 `applyPanel` 重复；诺姆 C1 减抗写在 `cfg.panel` 上，这个面板从不进入伤害计算，是死写（C1 的单一来源是 teammate-buff）。3 处均已删除。
  - `cfg` 暂作 scratch：23 个模块在 `buildExecutions` 里写 cfg 的临时键，由 `materializeRows` 负责快照和恢复。探针实测深泄漏为 0，因此不强行迁移。
  - `skills` 暂不收紧：改成只读会让 110+ 个查表辅助函数签名报红，属于噪声，不是真实违规。
  - vue-tsc **查不出** 组件 `v-model` 对只读值的写入，所以只读绑定的页面禁止使用 `v-model`，改为 `:value` + 编辑函数（示例见 `StunAxisPage`）。

## 剩余热点（第 2 轮后，自耗时 / 14.2s profile；第 3 轮已处理前两项的主要部分）

`materializeRows` 1.53s（约 1/3 走「键集变化」慢路径：模块往 cfg **新增**同调用缓存键、恢复时 delete ⇒ cfg 变形）·
`runInnerLoop` 0.73s · GC 0.63s · `iterateBody` 0.57s · `buildExecutions` 0.49s · `enrichExecutionPlan` 包含 0.55s。
