# 分析器独立场景（数据隔离）：设计、验证与迁移进度

> 第 369 轮（lane arena-C，2026-10-01）起草，CC-343。第 1 阶段代码 `02049db9`。
> 本文是这条线的唯一主档：动机、设计、判据、逐个分析器的迁移状态、迁移配方、后续阶段、决定与回退点。
> 代码侧入口：`src/composables/analysisScenario.ts`（头注释）、`src/stores/config.ts`「独立场景出生态」段、
> `src/composables/useResourceCalc.ts#createResourceCalc`。判据：`src/composables/__tests__/analysisScenario.test.ts`。

## 0. 现状一句话

第 1 阶段已落地：底座（出生态 + 资源计算工厂 + 场景）和一个试点分析器（角色兑现曲线 `computeIncrementPass`）。
其余 7 个分析器模块（11 处 `snapshotStore` / `restoreStore`）仍改写 UI store 再恢复；另有 `TeamComparePage` 用快照拼缓存键。迁移清单与配方见 §4、§5。

## 1. 为什么要做

分析器要逐队改写配置再求值：换队、进 Boss 房间、改命座 / 音擎、开关轴……过去它们直接改写**页面正在用的 UI config store**，
跑完靠 `configSnapshot.ts` 的 `snapshotStore` / `restoreStore` 恢复。这个结构本身有三类缺陷：

1. **快照只覆盖部分字段，漏一个就泄漏**。`StoreSnapshot` 是手列的字段子集；CC-251 / 278 / 338 / 339 / 340 修的都是「漏快照 → 跑完 UI 现场被改」。
   每新增一个会被分析器写到的 state，都要记得补进快照——这条规则只能靠人记。
2. **异步分析器 yield 时 UI 看得见中间态**。角色兑现曲线、时间线图表、抽卡规划、自由对比都在求值循环里 `await` 让出主线程。
   让出期间 UI store 里是「某个基底队 + 某个 Boss 房间」：页面上绑在 UI store 的计算会为每个中间态重算，用户此时的编辑会在恢复时被覆盖。
3. **calc 与 store 隐式耦合**。分析器收一个 `calc` 参数、内部再调 `useConfigStore()` 改写——两者必须恰好是同一份现场，类型系统看不出来，传错就静默错配。

用户口径（提示词「唯一不变量」）：只做让架构更通用或更简单的改动。本线的收益是**结构性**的：隔离由构造保证，而不是由「快照字段列全了」保证；
分析器的输入输出变成显式参数，为 `batchTask.ts`（`9b523a0a`，提交说明：「接线须先完成数据隔离」）和日后放进 worker 铺路。

## 2. 设计（第 1 阶段已实现）

### 2.1 三个原语

| 原语 | 位置 | 作用 |
|---|---|---|
| `createConfigModel(catalog, initialState?)` | `src/stores/config.ts` | 配置的唯一实现（UI store 只是它的 Pinia 适配）。新增可选的**出生态** `initialState`：键 = `$state` 的键，值是调用方独占的深拷贝 |
| `createResourceCalc(config, catalog)` | `src/composables/useResourceCalc.ts` | 资源计算的唯一实现，显式注入配置与目录。`useResourceCalc()` 只剩一行：`createResourceCalc(useConfigStore(), useCatalogStore())`。导出类型 `ResourceCalc` |
| `createAnalysisScenario(source?, catalog?)` / `withAnalysisScenario(fn, source?)` | `src/composables/analysisScenario.ts` | 以 `source`（缺省 UI store）的当前现场为出生态，建独立 config model + 绑在它上面的资源计算，全部放在一个 `effectScope` 里；`dispose()` 停掉。`withAnalysisScenario` = 建 → 跑 → finally dispose |

分析器只认 `AnalysisContext = { config, calc }`：在 `config` 上随意改写，读 `calc` 的结果；**不调 `useConfigStore()`，不做快照恢复**。
页面（或 chartRunners 这类运行器）负责建场景和销毁：`await withAnalysisScenario(s => computeX({ scenario: s, ... }))`。

### 2.2 出生态为什么必须写在 watcher 注册之前

`createConfigModel` 里有几个依赖 state 的 watcher：

- 副词条预算设置 watcher（**pre-flush**）：`mechanicSettings` 的预算键一变，下一拍把三个槽的配装重刷成推荐值。
  它的 getter 每次返回新数组，所以**整体替换 `mechanicSettings`** 就会触发，与值变没变无关。
- 队友 buff watcher（sync）：队伍一变就按队伍改写 `teammateBuffSelections` 的 enabled。
- 控制技折算 watcher（sync）：按承接槽位重算 `appliedBoss.parryTotal`（幂等）。

如果先建 model 再逐键写入源现场（「朴素注水」），这些 watcher 会把注水当成用户改动：最直接的后果是副词条 watcher 下一拍把用户手改的配装刷回推荐值，
场景不再等于源现场。`analysisScenario.test.ts` 的「① 反例」把这件事钉成了测试：朴素注水后立刻比较相同，`await` 一拍后队伍配装不同。

所以出生态在 `createConfigModel` 内部、**全部 state ref 已声明、依赖 state 的 watcher 一个都还没注册**的位置写入
（`config.ts`「独立场景出生态」段；它上方唯一的 `watch` 只看目录加载）。watcher 只见出生之后的修改。

- 出生态键表 `stateRefs` 手列 23 个 ref；`initialState` 里出现未登记的键**直接抛错**。新增 state ref 忘了登记 ⇒ 每个场景测试都会红，不会静默缺字段。
- 新 ref 若声明在出生态段之后，TS 会报「声明前使用」，同样拦得住。
- UI store 不传 `initialState`，行为不变。

### 2.3 场景的 `config` 对象

`createAnalysisScenario` 返回的 `config` 是 `reactive({ ...model, $state })`，类型标成 config store：

- 有 model 的全部 state / getter / action；
- `$state` 是同一批 ref 的 reactive 视图，键集合取自源的 `$state`（memo 键 `calcOutputMemo` 读它，与 Pinia 的 `$state` 同语义）；
- **没有** Pinia 的 `$patch` / `$subscribe` / `$reset` / `$onAction`：分析器与求值管线都不调它们（全仓只有 `ImpactChart.vue` 对 UI store 用 `$patch`）。
  这是「类型比实际宽」的已知差，§6 第 5 步收窄类型后消除。

深拷贝用 `cloneConfigState`：逐层 `toRaw`（state 里是响应式代理，`structuredClone` 不收代理），保留 `undefined` / `Infinity` / `NaN`（JSON 往返会把后两者变成 `null`）。

### 2.4 一次运行一个场景

分析器跑完会把场景留在「最后一个队 + 最后一个房间」。所以**每次运行建一个新场景**，不要跨运行复用（复用就等于让第二次从第一次的残留出发）。
建场景只是建 ref / computed，不求值，成本可忽略（实测见 §3）。代价：每个场景的 `calcOutputMemo` 从冷启动开始，跨运行不再复用页面 calc 的 16 条 LRU——
角色兑现曲线前后耗时 15.6s / 15.9s，可忽略。

## 3. 第 1 阶段验证

- `vue-tsc -b` 0 错。
- `analysisScenario.test.ts`（5 例）：
  - ① 出生态 = 源现场：源现场带非缺省副词条上限 + 手改 0 号位副词条 + 手动关掉的队友 buff + Boss 房间；场景 `$state` 与源逐字相同，`await` 一拍后仍相同；
  - ① 反例：朴素注水，一拍后队伍配装被刷回推荐值（锁住出生态写入点）；
  - ② 隔离：场景里换人、进另一期 Boss 房间、改机制设置、求值 ⇒ 源 store `$state` 与 UI calc 的总伤都不变；
  - ③ 等值：同一现场，场景 calc 与 UI calc 的队伍总伤逐位相同，两边同步进 Boss 房间后仍相同；
  - ④ 源码锁：`createResourceCalc` 函数体不出现 `useConfigStore()` / `useCatalogStore()`；`MIGRATED_ANALYZERS` 里的文件不调 `useConfigStore()`、不调 `snapshotStore(` / `restoreStore(`。
- `charIncrementInt.test.ts`：原「快照恢复」只比跑完后的队伍 id；现改为**每次进度回报（紧接 yield）时整份 `$state` 与开跑前逐字相同**，跑完也相同。性能比值 22.6×（线 100×）。
- **A/B 零差**：同一现场（副词条上限 18），旧 API（`2d781b67`，改写 UI store + 快照恢复）与新 API（场景）各跑一遍全归档 `computeIncrementPass`，
  输出（9 期、78 次基底队求值的逐队分数）逐字节相同（md5 `53ecb939`）；耗时 15.6s / 15.9s。探针未入库（`/home/kaua/calc-arch/arenaC/zzScenarioProbe.{old,new}.test.ts`、`ab.sh`）。
- 全量 verify：全量 verify EXIT 0（449 文件 / 4126 测试通过，16 / 29 跳过，228.9s）。

## 4. 迁移进度（每迁一个：改本表 + 把文件加进 `analysisScenario.test.ts` 的 `MIGRATED_ANALYZERS`）

| 分析器 | 入口 | 调用方 | 同步 / 异步 | 状态 |
|---|---|---|---|---|
| 角色兑现曲线 `composables/charIncrement.ts` | `computeIncrementPass` | `views/CharIncrementPage.vue` | 异步（每 4 队 yield） | ✅ 第 369 轮 `02049db9` |
| 时间线 `composables/teamTimeline.ts` | `computeTeamTimeline` / `computeNewCharacterPoints` / `computeSlotComparePoints` / `computeSlotSweepPoints`（4 处快照） | `composables/charts/chartRunners.ts`、`composables/teamCompareSweep.ts` | 异步 | 待迁（建议第一个：4 处快照、yield 中间态最多） |
| 菲林模拟 `composables/teamTimelineFilm.ts` | `computeFilmSimulation` | `chartRunners.ts` | 异步 | 待迁（与时间线同批，同一运行器） |
| 抽卡规划 `composables/pullPlannerEngine.ts` | `runPullPlanner` | `components/charts/PullPlannerChart.vue` | 异步 | 待迁 |
| 自由对比 `composables/freeCompare/engine.ts` | `computeFreeCompare` | `views/FreeComparePage.vue` | 异步 | 待迁 |
| 位置对比 `composables/positionCompare.ts` | `computePositionCompare` | `views/PositionComparePage.vue` | 同步 | 待迁 |
| 难度曲线 `composables/difficultyCurve.ts`（内含 `difficultyLadder`） | `computeDifficultyCurves` | `views/TeamComparePage.vue` | 同步 | 待迁 |
| 队伍对比 `composables/teamCompare.ts` | `computeTeamComparePoints` | `views/TeamComparePage.vue` | 同步 | 待迁（单测用假 calc `engineScoreCalc(config, score)`，见 §5 第 5 步） |
| `views/TeamComparePage.vue:1139` | 只用 `snapshotStore(configStore)` 拼会话缓存键，不恢复 | — | — | 删 configSnapshot 前改成状态指纹（如 `JSON.stringify(cloneConfigState(configStore.$state))`，或只取求值相关键） |

## 5. 迁移配方（一个分析器一张卡，零差简化卡）

1. 读认领表 `/home/kaua/calc-arch/LANE-CLAIMS.md`，登记分析器文件 + 调用方 + 测试，建自己的 worktree。
2. 分析器签名：把「`calc` 参数 + 内部 `useConfigStore()`」换成 `scenario: AnalysisContext`（选项对象里加字段，或第一个参数改成 `ctx`），
   函数体 `const { config: configStore, calc } = scenario`，其余代码不动。
3. 删掉 `snapshotStore` / `restoreStore` 与只为恢复存在的 `try / finally`（函数体反缩进一级；`git diff -w` 看真实改动）。
4. 调用方改成 `await withAnalysisScenario(s => computeX({ scenario: s, ... }))`；同步分析器同样可以用（`withAnalysisScenario` 返回 Promise，调用方本来就在 async 的点击处理里）。
   页面里若 `useResourceCalc()` 只为传给分析器，一起删掉。
5. 测试：
   - 真引擎测试：`computeX(useResourceCalc(), ...)` 改成 `withAnalysisScenario(s => computeX({ scenario: s, ... }))`；
   - 「跑完 store 已恢复」类断言改成「调用方 `$state` 全程不变」（异步的在 `onProgress` 里查，参照 `charIncrementInt.test.ts`）；
   - 假 calc 测试：直接传 `{ config: harness 的 store, calc: 假 calc }`。分析器不关心 calc 从哪来；隔离是调用方的事，这类测试本来也不测隔离。
6. 把文件加进 `analysisScenario.test.ts` 的 `MIGRATED_ANALYZERS`，改本文 §4 的状态。
7. 零差：照 §3 的 A/B 法，旧 API 在主仓库 HEAD 的临时 worktree 跑、新 API 在自己的 worktree 跑，同一现场同一输入，输出逐字节比较；再跑全量 verify。
8. 提交说明：`refactor(CC-343): <分析器> 改在独立场景求值（简化卡：A/B 逐字节相同）`。

## 6. 后续阶段

1. **S2 迁完 §4 的 7 个模块**（顺序：时间线 + 菲林（同一运行器）→ 抽卡规划 → 自由对比 → 位置对比 → 难度曲线 → 队伍对比）。异步的先做，收益最大。
2. **S3 删 `configSnapshot.ts`**：没有调用方后删文件与测试；`TeamComparePage` 的缓存键改用状态指纹；CC-278 相关源码锁改成「分析器不调 `useConfigStore()`」（即 `MIGRATED_ANALYZERS` 变成「全部分析器」的扫描）。
3. **S4 接 `batchTask.ts`**：每个任务一个场景（或一个场景跑完一批再 dispose），任务间天然隔离；之后才谈 worker。
4. **S5 收窄类型（可选）**：管线与分析器里 `ReturnType<typeof useConfigStore>` 的参数改成 `ConfigModel`（`config.ts` 已导出），场景就不必把 model 标成 store 类型；
   各文件里的 `ReturnType<typeof useResourceCalc>`（现 10 处）换成导入 `ResourceCalc`。只在顺手时做，不为降计数单独开卡。

## 7. 决定与依据

- **调用方建场景，分析器只收上下文**（而不是分析器内部自建场景）：依赖显式、测试可注入假 calc、日后同一个分析器能在 worker 里拿 worker 本地的 model 跑。
  代价是「调用方要记得用场景」——由 `MIGRATED_ANALYZERS` 源码锁兜住分析器侧；页面侧只有 `withAnalysisScenario` 一种写法。
- **出生态放进 `createConfigModel`**（而不是在场景模块里先建 model 再注水 + `await nextTick()` 让 watcher 先跑）：
  后者要求场景模块知道「哪个 watcher 怎么触发」，且把建场景变成异步；出生态对未来新增的 watcher 也成立。
- **`$state` 视图键取自源的 `$state`**：与 Pinia 对 state 的分类完全一致，memo 键覆盖的字段与 UI 实例相同。
- **不改其余 7 个分析器模块**：第 1 阶段只证明底座与一个试点（A/B 逐字节相同）；逐个迁移是机械活，按 §5 一张卡一个，单独可回退。

## 8. 坑

- 场景的 `config` 没有 `$patch` / `$subscribe` / `$reset` / `$onAction`。分析器里需要「批量写」就直接赋值字段或调 action。
- `createResourceCalc` 与已迁移分析器里不得调 `useConfigStore()` / `useCatalogStore()`：会静默读回 UI 现场（源码锁④）。
- 新增 state ref 必须登记进 `config.ts` 出生态键表，否则建场景直接抛错。
- 一次运行一个场景；`withAnalysisScenario` 出错也会 dispose。
- 场景里 `effectScope(true)` 是脱离父作用域的：在组件 setup 里建也不会随组件卸载自动停，必须 `dispose()`（用 `withAnalysisScenario` 就不会漏）。

## 9. 回退点

- 第 1 阶段整体：`git revert 02049db9`（出生态参数、工厂化、场景模块、试点迁移一起回退；UI 行为不变）。
- 只回退试点：恢复 `charIncrement.ts` / `CharIncrementPage.vue` / `charIncrementInt.test.ts` 三个文件到 `2d781b67`，并从 `MIGRATED_ANALYZERS` 删掉该项。
