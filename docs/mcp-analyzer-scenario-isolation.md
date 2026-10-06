# 分析器独立场景（数据隔离）：设计、验证与迁移进度

> 第 369 轮（lane arena-C，2026-10-01）起草，CC-343。第 1 阶段代码 `02049db9`；第 372 轮（arena-C）迁完抽卡规划 + 自由对比（`dfe53a2e`）并删 `configSnapshot.ts`（S3，`81b0d2dc`）；第 374 轮（arena-C）S4 接 `batchTask`（取消契约统一 + 结果归属，`423e9de4` + `962e8b9f`）；第 375 轮（arena-E）S5 收窄类型（`3c287f85`）。
> 本文是这条线的唯一主档：动机、设计、判据、逐个分析器的迁移状态、迁移配方、后续阶段、决定与回退点。
> 代码侧入口：`src/composables/analysisScenario.ts`（头注释）、`src/stores/config.ts`「独立场景出生态」段、
> `src/composables/useResourceCalc.ts#createResourceCalc`。判据：`src/composables/__tests__/analysisScenario.test.ts`。

## 0. 现状一句话

S2 / S3 / S4 已全部完成：§4 的 8 个分析器入口与 `TeamComparePage` 会话缓存键都在独立场景上求值，
`configSnapshot.ts`（快照 / 恢复）已删除（`81b0d2dc`），取消与结果归属已统一到 `batchTask.ts`（`423e9de4` + `962e8b9f`）。
S5（收窄类型）已于第 375 轮完成（`3c287f85`，§3.5）：求值管线与分析器不再在类型上依赖 Pinia。
第 376 轮（arena-E）补迁了 §4 原表漏掉的两个**组件内**分析器：伤害影响 2D/3D（CC-345 `56e2f697`，§3.6）与主词条边际效用（CC-346 `1962c4b0`，§3.7，顺带修了「候选之间不还原」的数值缺陷）。
第 377 轮（arena-E）迁完最后一个改写 UI store 的分析器：命座提升率 `composables/cinemaUplift.ts#analyzeCinemaUplift`（CC-347 `887c0ebc`，§3.8，A/B 逐字节相同）。
**至此按 §8 的两条检索，已没有在 UI store 上改写-让出-恢复的分析器。**
`createBatchScheduler`（时间片让步）仍未接线，理由见 §3.4 末段——它只在 worker 化时才需要，没有排定。
历史：第 1 阶段只落地底座 + 一个试点（角色兑现曲线 `computeIncrementPass`），其余 7 个模块当时仍靠 11 处
`snapshotStore` / `restoreStore` 改写 UI store 再恢复。迁移清单与配方见 §4、§5。

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

`createAnalysisScenario` 返回的 `config` 是 `reactive({ ...model, $state })`，类型是 `EvalConfig`（`config.ts`，= `ConfigModel & { $state }`；第 375 轮 S5 前标成 config store）：

- 有 model 的全部 state / getter / action；
- `$state` 是同一批 ref 的 reactive 视图，键集合取自源的 `$state`（memo 键 `calcOutputMemo` 读它，与 Pinia 的 `$state` 同语义）；
- **没有** Pinia 的 `$patch` / `$subscribe` / `$reset` / `$onAction`：分析器与求值管线都不调它们（原先全仓唯一的 `$patch` 在 `ImpactChart.vue`，第 376 轮 CC-345 已删，`src/` 非测试代码现为零）。
  ~~这是「类型比实际宽」的已知差，§6 第 5 步收窄类型后消除。~~ 已消除（第 375 轮 S5）：`EvalConfig` 里没有这四个成员，误调会编译失败。

深拷贝用 `cloneConfigState`：逐层 `toRaw`（state 里是响应式代理，`structuredClone` 不收代理），保留 `undefined` / `Infinity` / `NaN`（JSON 往返会把后两者变成 `null`）。

### 2.4 一次运行一个场景

分析器跑完会把场景留在「最后一个队 + 最后一个房间」。所以**每次运行建一个新场景**，不要跨运行复用（复用就等于让第二次从第一次的残留出发）。
建场景只是建 ref / computed，不求值，成本可忽略（实测见 §3）。代价：每个场景的 `calcOutputMemo` 从冷启动开始，跨运行不再复用页面 calc 的 16 条 LRU——
角色兑现曲线前后耗时 15.6s / 15.9s，可忽略。
（r707 起此代价不复存在：`calcOutputMemo` 改为模块级、全部实例共享；键含 `$state` 全部字段与目录身份，场景与页面同语义 ⇒ 场景读到与页面相同的状态时直接命中、结果逐位相同。隔离针对数据，不针对缓存。）

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

### 3.1 第 371 轮（时间线 + 菲林，`d9e39042`）

- 入口签名 `computeX(calc, opts)` → `computeX(scenario: AnalysisContext, opts)`（第一个位置参数换类型，其余不动）；删 5 处快照恢复与 `try / finally`（`git diff -w`：12 文件 +68 / −96）。
- 运行器 `charts/chartRunners.ts` 的 4 个 runner 与 `teamCompareSweep.ts#useSlotSweep` 改为 `withAnalysisScenario(scenario => computeX(scenario, ...))`；`io.calc` / `opts.calc` 字段删除；
  `TimeChartsPage` / `NewCharacterChart` / `FilmSimChart` / `SlotCompareChart` 里只为传参存在的 `useResourceCalc()` 一并删除。
- 间接依赖核查：时间线 / 菲林调用的 `teamTimelineStore`、`timeWeightBalancer`、`bossRoom` 都不调 `useConfigStore()`；`teamCompare.ts:1102` 有，但那是队伍对比自己的入口，时间线只从它导入纯函数。
- **A/B 逐字节相同**：同一探针（时间线 7 人池、新角色强队轻量档 + 逐金档、同槽对比、第三人海选 4 候选、菲林全期）在旧 HEAD `48f10d3e` 与新 worktree 各跑一遍，输出 md5 均为 `ad4581ba`（16699 字节）。探针未入库：`/home/kaua/calc-arch/arenaD/d371/zzTimelineAB.test.ts`、`ab.sh`。
- 新测试（`teamTimeline.test.ts` 末尾「CC-343 独立场景」）：时间线 + 菲林每次进度回报时 UI `$state` 与开跑前逐字相同。**反证**：同样的断言套在旧 API 上（base worktree 临时测试）失败——旧实现 yield 时 UI 确实看得见中间态。
- 全量 verify EXIT 0（449 文件 / 4129 测试通过）。

### 3.2 第 373 轮（位置对比 T3 + 难度曲线 + 队伍对比，`851f232f`）

- `positionCompare.ts#computePositionCompare`（执行卡 T3）、`difficultyCurve.ts#computeDifficultyCurves`、`teamCompare.ts#computeTeamComparePoints` 三个入口改收 `scenario: AnalysisContext`，函数体首行 `const { config: configStore, calc } = scenario`，轴绑定基准改用 `const baseAxis = configStore.getAxisState()`（`applyAxisBinding` 签名同步收紧为 `snap: StunAxisState`）；删掉 3 处 `snapshotStore / restoreStore` 与 `try / finally`（`git diff -w`：12 文件 +56 / −70）。
- `PositionComparePage.vue#run` 与 `TeamComparePage.vue` 的 `runCompare` / `runCurves` 改为 `await withAnalysisScenario(scenario => ...)`；两页只为传参存在的 `useResourceCalc()` 一并删除；`TeamComparePage.vue:1139` 会话缓存键的 `snap: snapshotStore(configStore)` 改为 `snap: cloneConfigState(configStore.$state)`。
- **A/B 逐字节相同**：
  - 位置对比（6 队 × breaker/support，6 金）：新旧输出 md5 均为 `93495371f9a5f532e43462089a36105f`（5191 字节，`cmp` 无输出）；
  - 队伍对比 + 难度曲线（3 队 × 0/6/12 金开最优加金 + 自动下位 + 期牌，以及 `auto-1521-1361-1311` / `banyue-liuyin-lucia` 含切轴档爬梯）：新旧输出 md5 均为 `f0bf1c28269e365feb74a47b645b5d39`（12867 字节，`cmp` 无输出）。

### 3.3 第 372 轮（抽卡规划 + 自由对比 `dfe53a2e`；S3 删 configSnapshot `81b0d2dc`）

- `pullPlannerEngine.ts`：`EngineOracleOptions.calc` / `PlannerRunOptions.calc` 换成 `scenario: AnalysisContext`，
  `createEngineOracle` 与 `runPullPlanner` 都不再调 `useConfigStore()`；删 `type Calc`、`configSnapshot` 导入与 `try / finally`
  （`git diff -w`：8 文件 +223 / −210，含测试）。oracle 的 `teamScoreCache` / `state.cache` 跟着场景走，一次运行一个场景。
- `freeCompare/engine.ts`：`computeFreeCompare(calc, options)` → `computeFreeCompare(scenario, options)`；
  `makeDowngradeResolver` / `applyConstraintBaseline` / `readMetric` 仍收 `calc` / `configStore` / `catalog`，由首行解包给出。
- 调用方：`PullPlannerChart.vue` / `FreeComparePage.vue` 改用 `withAnalysisScenario`，两处只为传参存在的 `useResourceCalc()` 一并删除。
- **A/B 逐字节相同**（探针未入库：`/home/kaua/calc-arch/arenaC/zzS2bProbe.{old,new}.test.ts`、`ab-r372.sh`；输出连
  `stats.evaluations` / `cacheHits` / `cacheSize` / `pickEvaluations` 一起比对，只剔除 `durationMs`）：
  - 抽卡规划（成型号起点、2 期、beam 2、VCG 开）：md5 `703c3db4553f628755a21d7c7fca8fc2`（1818 字节，27.3s / 27.5s）；
  - 自由对比 · 命座轴（柏妮思 21 vs 菲欧妮 11，cinemaMax 2）：md5 `3293188e4febe623ed3c595367b46b07`（539 字节）；
  - 自由对比 · 期数轴（死路屠夫两期、`dmgBossHpRatio`）：md5 `942e10ac47a7cbe76e51c93178076351`（410 字节）。
- 测试：oracle 冒烟与规划集成改传场景；「快照恢复」断言改为「调用方 `$state` 全程逐字相同」（含 `onProgress` 中途）；
  `bossRoom.test.ts` 的关卡 buff 用例改为在场景里断言 + 查 UI store 全局 Buff 一行不碰；
  `freeCompareEngine.test.ts` 的 ★ 用例改为抓**场景** config（`makeRunner` 的 `onEval` 收 `config` 参数）。
- **源码锁踩到一次真钉子**：`MIGRATED_ANALYZERS` 加项后 ④ 立刻红——`freeCompare/engine.ts` 头注释里写着「不调 `useConfigStore()`」，
  正则按调用形态匹配，**注释也算**。已改成「不读 UI config store」。写这类注释时避开被锁函数名的调用形态。
- **S3（`81b0d2dc`）**：删 `configSnapshot.ts` + `configSnapshot.test.ts`；两条非快照专属判据搬家——CC-278 内联快照源码锁 →
  `analysisScenario.test.ts` ④b，`setAgent(slot, "")` 同步清空该槽音擎 → `stores/__tests__/configModel.test.ts`。
- 全量 verify：`dfe53a2e` EXIT 0（449 文件 / 4129 测试通过，16 / 29 跳过）；`81b0d2dc` EXIT 0（448 文件 / 4125 测试通过，16 / 29 跳过，178.8s）。

### 3.4 第 374 轮（S4 接 `batchTask`：取消契约统一 + 结果归属，`423e9de4` + `962e8b9f`）

- **问题**：`batchTask.ts`（`9b523a0a`，提交说明即写「接线须先完成数据隔离」）自建成起**没有生产调用方**——
  它要解决的两件事在页面上各写了一份：取消（`FreeComparePage` 的 `abortFlag` + `shouldAbort: () => abortFlag`、
  `TeamComparePage` 的 `curveAbort`、`teamCompareSweep` 的 `sweepAbort`），而「只有当前运行才许写进度/结果」
  **一处都没有**（`result.value = await ...` 无条件赋值 ⇒ 旧运行算完会把新运行的结果盖掉）。
- **改法（`423e9de4`，S4a）**：
  - `batchTask.ts`：`BatchControl` 只留 `signal`（废除 `shouldAbort` 回调——此时全仓无生产调用方）；
    新增 `isBatchAborted(control?)`（非抛出探测，给「保留已算部分」的优雅中止用）；导出 `BatchOwner` 类型。
  - `freeCompare/engine.ts` 与 `teamTimeline.ts#computeSlotSweepPoints`：`shouldAbort?: () => boolean` → `control?: BatchControl`，探测改 `isBatchAborted`。
  - `FreeComparePage` / `TeamComparePage`（runCompare + runCurves）/ `teamCompareSweep`：改用 `useBatchOwner()`，
    进度 / 结果 / finally 一律经 `run.commit(...)`，中止按钮改调 `owner.cancel()`；删掉三个手写标志。
- **改法（`962e8b9f`，S4b）**：其余 6 个调用点同样接 owner（`CharIncrementPage`、`PullPlannerChart`、`PositionComparePage`、
  `chartRunners` 的 4 个 runner + 4 个图表组件），并把 `control: { signal: run.signal }` 穿进 7 个分析器
  （`charIncrement`、`teamTimeline` 三个入口、`teamTimelineFilm`、`pullPlanner#planPullStrategy`、`pullPlannerEngine#runPullPlanner`）：
  被新运行顶掉时，旧运行在下一个循环头 `break`（优雅中止，返回已算部分，页面侧 `commit` 丢弃）——不再白跑完 15~27 秒。
- **决定（取消语义）**：`owner.cancel()` **只停计算、不吊销提交权**。原实现（既停算又吊销）与页面
  「取消 / 中止保留已算部分」的既定行为冲突——曲线与海选的进度文案本来就写着「已中止：保留已算的 N 条」。
  吊销只来自两处：`start()` 被新运行顶掉、`dispose()` 页面关闭；`isCurrent()` 因此去掉 `!signal.aborted` 从句
  （它对吊销是冗余的）。`batchTask.test.ts` 把这三条钉成反证。
- **决定（不抛错）**：分析器的 `control` 是优雅中止（break 后返回已算部分），**不改成 `throwIfBatchAborted`**——
  这些页面没有 catch，抛出来会变成未处理的 Promise 拒绝。
- **有意未接的一块**：`createBatchScheduler`（时间片让步）仍未接线。现有分析器全是「保留已算部分」的优雅中止
  （粒度 = 循环头），调度器的 `checkpoint()` 是抛错式取消，语义不同；接它之前要先决定「中止到底丢不丢已算部分」。
  留给必须硬停的路径（worker；把求值搬进 Web Worker 时按时间片切分）。
- **A/B 零差**：同一现场同一输入，HEAD（`425f9412`）与 S4 后各跑一遍，七路输出逐字节相同——
  抽卡规划 md5 `703c3db4553f628755a21d7c7fca8fc2`（1818 字节）、自由对比命座轴 `3293188e4febe623ed3c595367b46b07`（539）、
  自由对比期数轴 `942e10ac47a7cbe76e51c93178076351`（410）、charincrement `4e98fd435d6fdbd58b5a9540b16bd0a9`（1029）、
  teamtimeline `db19b112a7b01581cab65120182cc45f`（5984）、filmsim `3d5c0377ea9469072d84a3ccc6573a71`（2419）、
  slotsweep `1649163395d9c01b44231c2b0b7f3286`（633）。探针未入库：`/home/kaua/calc-arch/arenaC/zzS4Probe.test.ts`、`ab-r374.sh` / `ab-r374b.sh`。
  插曲：teamtimeline 第一轮**两边同样**报「配装推荐数据未加载」（探针忘了 `loadBuildRecommendations`），
  补齐后重跑；随后唯一差异是 `stats.durationMs`（墙钟），剔掉后才逐字节相同——探针剔墙钟字段的规矩由此又多一条。
- **测试**：`batchTask.test.ts` 5/5（新语义反证：取消后可提交、被 `start()` 顶掉后不可提交、卸载后不可提交；
  `isBatchAborted` 与 `throwIfBatchAborted` 同口径、无 control 不炸）；`slotSweep.test.ts` 4/4
  （新增「onProgress 中途取消 ⇒ 至多再算一个候选，已算部分照常返回」）。
  定向 353 项全绿；`vue-tsc -b` 0 错；check-guards 25/25；全量 verify EXIT 0（448 文件 / 4125 测试通过）。

### 3.5 第 375 轮（S5 收窄类型，`3c287f85`，lane arena-E）

- **问题**：管线（`resourceCalc/*`、`createResourceCalc`）与分析器的参数写的是 `ReturnType<typeof useConfigStore>`（Pinia store 类型），
  而独立场景传进来的是普通 reactive model——类型声称「有 `$patch` / `$subscribe` / `$reset` / `$onAction`」，实际没有（§2.3 已知差）。
  这让「求值管线不依赖 Pinia」只是事实、不是契约：日后谁在管线里调 `$patch`，编译期抓不到，场景里运行期才炸；worker 化时也得先拆这层假依赖。
- **改法**：
  - `config.ts` 新增 `EvalConfig = ConfigModel & { readonly $state }`（求值入口所需：model 全部成员 + memo 键读的 `$state`）。
  - `createResourceCalc` 与 `AnalysisContext.config` / `createAnalysisScenario(source)` 收 `EvalConfig`；场景构造处的强转从 store 类型改成 `EvalConfig`。
  - 其余 28 个非测试模块里的 `ReturnType<typeof useConfigStore>` → `ConfigModel`，`ReturnType<typeof useResourceCalc>` → `ResourceCalc`（共 76 处，
    另 `damagePool.ts` 的 `ReturnType<typeof import('@/stores/config').useConfigStore>` 1 处），清掉随之变成无用的类型导入。机械替换脚本：`/home/kaua/calc-arch/arenaE/s5.mjs`（未入库）。
  - 测试与 `src/test/harness.ts` **不改**：它们手里本来就是 Pinia store 实例，store 类型对它们是真话（store 可赋给 `ConfigModel` / `EvalConfig`，`vue-tsc` 证实）。
    唯一改的测试是 `freeCompareEngine.test.ts` 的 `onEval` 回调参数（它收的是场景的 config，旧注解恰好是本轮要消除的那句假话，收窄后编译不过）。
- **验证**：纯类型改动 ⇒ 运行期零差的最强证据是**产物逐字节相同**：主仓库 HEAD（`9f3dacd2`）与改后各 `vite build` 一次，`diff -r` 两个 dist（63 个文件）无输出。
  `vue-tsc -b` 0 错；全量 verify EXIT 0（448 文件 / 4125 测试通过，16 / 29 跳过，172.6s）。
- **回退点**：`git revert 3c287f85`（只动类型注解与类型导入，运行期无变化）。

### 3.6 第 376 轮 CC-345：伤害影响 2D 曲线 / 3D 响应面（`56e2f697`，lane arena-E）

- **为什么漏了**：§4 原表是按 `snapshotStore` / `restoreStore` 的调用方列的；`ImpactChart.vue` 与 `charts/ResponseSurface3D.vue` 不走快照，
  而是在组件里**直接改写 UI store**（逐点 `writeImpactVariable`，快照曲线用 `configStore.$patch({ team })` 换队）、跑完手工写回。
  盘点方法教训：找「改写 UI store 的分析器」要搜**写入 + 让出主线程**的组合，不能只搜某个恢复函数的调用方（本轮用的检索见 §8）。
- **旧实现的三个缺陷**：① 换队与副词条分配的恢复写在 `try` 里，抛错 ⇒ UI 现场留在最后一个采样点（只有变量本身在 finally 写回）；
  ② 「写回原值」不等于恢复：机制设置原先**未设置**（读数取缺省 / 异放占比取覆盖率自动值）时，写回后变成显式值，机制设置里凭空多一个键
  （`impactSampling.test.ts`「① 反例」钉住）；③ 采样期间每次让出主线程，页面上绑 UI store 的所有计算都为中间态重算。
- **改法**：新 `src/composables/impactSampling.ts`：`sampleImpactCurve(scenario, { varId, points, optimizePerPoint?, team?, onProgress?, control? })`、
  `sampleImpactSurface(scenario, { varX, varY, n, onProgress?, control? })`、`impactVariableView` / `readImpactPoint`。变量表与机制设置表在**场景**上按场景队伍现算
  （快照曲线换队后变量随之变，口径同旧：旧实现的 settingMap 是 computed，`$patch` 换队后同样跟着变）。
  两个组件改为 `withAnalysisScenario` + `useBatchOwner`（每条曲线一个场景；快照曲线 = 源现场 + 换队）；删掉写回恢复、`origAllocs`、
  3D 组件的 `writeVar` / `readDamageSnapshot` 两个 prop。**让出主线程的位置与旧组件逐一对应**（pre-flush watcher 只在让出时跑，读数时机一变结果就变）；
  旧 2D 循环里「先把整批 x 写一遍再让出」的空转段删了（每点随后都会重写变量并让出，A/B 证实无影响）。
- **A/B（逐字节相同）**：探针 `/home/kaua/calc-arch/arenaE/zzImpactAB.test.ts`（未入库）把旧组件的采样循环逐行搬进测试、在 UI store 上跑，
  新实现在场景上跑，同一现场（柏妮思 1171 + 1021 + 1131，推荐配装）：静态变量 `bossStunValue` 12 点（md5 `ea4bc0ae`）、机制设置
  `setting.burnice.stirringCount` 7 点（`8117bc0e`）、异放占比自动值变量 `setting.burnice.releaseShare:fire` 7 点（`61c6e5a1`）、
  `totalTime` + 逐点优化副词条 6 点（`e117a5d3`），每项含主曲线 + 0 号位 6 命的快照曲线；3D 两组 5×5（`a144a518`）。全部 `cmp` 相同。
- **测试**：`impactSampling.test.ts` 4 例（隔离：途中每次进度回报与跑完 UI `$state` 逐字不变；反例；曲线点 = UI store 写同值后的读数；
  未知变量 / 取消）；`MIGRATED_ANALYZERS` 加 `impactSampling.ts`。实机点通 `scripts/ui-check.mjs`：资源利用率页 2D 选「Boss」变量计算出折线、
  3D 生成曲面到「重新计算曲面」，均零 JS 错误。全量 verify EXIT 0（449 文件 / 4129 测试通过）。
- **回退点**：`git revert 56e2f697`。

### 3.7 第 376 轮 CC-346：主词条边际效用（`1962c4b0`，lane arena-E；**含口径修正，非零差**）

- **旧实现**（`components/MarginalUtilityCard.vue`）：在 UI store 上逐个把 4/5/6 号位主词条换成候选、每个让出一次、`finally` 写回
  （原先没有主词条的位置写回成 `''`）。**数值缺陷：候选之间不还原**——同一槽位 4 号位试完最后一个候选后，5、6 号位与后续槽位的候选
  都是在「前面各组最后一个候选」叠加后的配装上测的。实测（同上现场，24 个候选）：只有第一组 3 个与单项替换相同，其余全部偏离，
  例如「槽2 #4 → 精通」旧 30,886,771 / 单项替换 35,148,175（差 12%），会把有益替换显示成负增量。
- **决定**：页面文案是「估算替换后的伤害增量」，按**单项替换**（每个候选在原配装上只换一处，试完还原）计算。依据：累积替换的数没有可解释的含义（取决于候选表顺序）。
  回退 = `git revert 1962c4b0`（会连同隔离一起回退）；若只想要旧口径，在 `computeMainStatMarginals` 里去掉 `mainStats[c.slotNum] = original` 一行即可（测试③会红）。
- **改法**：新 `src/composables/mainStatMarginal.ts`（`MAIN_STAT_CANDIDATES`、`mainStatCandidates(config)`、`computeMainStatMarginals(scenario, { control? })`），
  组件只剩 `withAnalysisScenario` + `useBatchOwner` + 排序展示；不再自建 `useResourceCalc()`。
- **验证**：`mainStatMarginal.test.ts` 3 例（隔离 + 每行 = UI store 上单项替换的读数；反证：累积替换第一组相同、之后不同；取消）；
  `MIGRATED_ANALYZERS` 加 `mainStatMarginal.ts`；全量 verify 见队列 §2 第 376 轮交接。

### 3.8 第 377 轮 CC-347：命座提升率（`887c0ebc`，lane arena-E；零差）

- **旧实现**：`analyzeCinemaUplift({ configStore, catalogStore, readDamage, readUltimateTotal, readMetrics?, targetStunCount, ... })`
  在 UI store 上改命座等级与 `enemy.stunCountLock`、每次 `nextTick` 后经页面传入的三个闭包读 UI 现场的 calc，`finally` 恢复全队命座与锁。
  计算期间 UI 会看到中间态（命座 C0..C6 来回跳、失衡锁被钉住）；三个读数闭包让「读哪个现场」变成调用方的责任。
- **改法**：签名改为 `analyzeCinemaUplift(scenario: AnalysisContext, { targetStunCount, slots?, maxLevel?, resolveName?, control? })`；
  新导出 `readCinemaScene(calc)`（伤害 = `teamTotalDamage`，大招 = `resourceResult.characters[].ultimateCount` 之和，指标 = `collectCinemaMetrics`），
  分析器在场景内锁 → `nextTick` → 读 → 解锁 → `nextTick` 的序列与旧实现逐位一致；槽内恢复（CC-338）保留（场景内多槽仍需要），
  末尾的整队 `finally` 恢复删除（场景随 `withAnalysisScenario` dispose）。`catalogStore` 入参删除，内部 `useCatalogStore()`（§7 的决定）。
  `readMetrics` 可选分支随之消失（附加指标恒同帧读）。
- **页面**（`ResourceUtilizationPage.vue#computeCinemaGains`）：`withAnalysisScenario` + `useBatchOwner`；删 `teamUltimateTotal()` 与 `collectCinemaMetrics` / `teamTotalDamage` 的页面侧引用。
  **唯一可见变化**：口径文案用的 `cinemaStunLock` 改为与结果一起 `commit`（原先点按钮即改写，计算中会显示新锁值配旧表），重复点击时旧运行不再覆盖新结果。
- **验证**：A/B 三队（仪玄C2+青衣+赛斯 轴模式 / 1471+1481C1 / 1451+1051+1171，slots 0..2、带指标）旧 API 在 HEAD worktree、新 API 在本 worktree 各跑，JSON **逐字节相同**；
  `cinemaUplift.test.ts` 改写 3 例：①「不碰 UI 现场」= UI store `$subscribe(flush:'sync')` 零写入 + `$state` 逐位相同（反证探针：直接写 store 时计数 > 0）；
  ② 多槽隔离改为同一场景先后跑两次；③「同场景纪律」改为给 `scenario.calc` 套只记录的 Proxy，四个结果字段每次被读时场景锁 = target。
  删「向后兼容：不传 readMetrics」一例（无此分支）。`MIGRATED_ANALYZERS` 加 `cinemaUplift.ts`。全量 verify 见队列 §2 第 377 轮交接。
- **更正**：§6 第 5 条原写「`allAgentsSweep` 也调它」——实际不调（它自己做 C0 vs C6），调用方只有页面与 `cinemaUplift.test.ts`。

### 3.9 第 382 轮 CC-352：实战部署页当期牌自动选择（`7967311a`，lane arena-E）

- view 层漏网：`RunArchivePage.vue#autoPickPeriodBuff` 在 UI store 上逐张写牌 → `setTimeout(40)` → 读伤害。④ 源码锁只扫 `MIGRATED_ANALYZERS`（composables），扫不到 view。
- 迁成 `runArchiveDeploy#pickBestPeriodBuff(ctx, phaseId, cards)`，页面 `withAnalysisScenario` 调用后只写最终结果一次。比较口径与旧 reduce 相同（基准「不用」排第一、严格大于才替换）。
- 普查 views/components 的「await + 读 teamTotalDamage」：其余都已在场景内。

### 3.10 第 421 轮（lane arena-C，CC-395b，`6dbd26b8`）：删掉未接线的抛错式取消，取消契一

- **问题**：`batchTask.ts` 里同时存在两种取消惯用法——生产在用的**优雅式**（分析器循环头 `isBatchAborted` 后 `break`，
  带上已算部分返回）与零调用方的**抛错式**（`createBatchScheduler` 的时间片让步 + `throwIfBatchAborted` 抛 `AbortError`）。
  后者只有自己的测试在调。第 374 轮接线时，「要不要把 scheduler 接进分析器」正是被这两种语义的冲突挡下来的
  （抛错式会丢掉已算部分，与三个页面的「保留已算部分」按钮冲突），最后靠「不接」绕开——**模块里留着一条没人走的取消路径，
  本身就是下一轮再绊一次人的坑**。
- **改法**：删 `createBatchScheduler` / `throwIfBatchAborted` / `SchedulerPlatform` 与其 4 条测试；
  `isBatchAborted` 注释去掉「与抛错式中止共用」的措辞；模块头写清「中止语义只有一种：优雅式」。
  产物 JS 逐字节相同（死代码本就被 tree-shake，A/B 方法见 §8）。
- **依据**：① 生产零调用方，删除无行为风险；② 「留给 worker」的理由不成立——Web Worker 里不需要向主线程让步
  （`yieldToMain` 在 worker 里没有意义），硬停走 `worker.terminate()`；③ 一个 100 行模块里两种取消语义，
  正是第 374 轮差点接错线的诱因，删掉比「留着备用」更简单也更通用。
- **影响**：`BatchControl` 的公开面只剩 `signal` + `isBatchAborted`。日后若真要时间片让步，按当轮需求重写，
  比维护一条没人验证过的路径可靠。
- **回退点**：`git revert 6dbd26b8`（与 CC-395a 的展示层清理同一个提交；只需恢复 scheduler 时
  `git revert -n` 后从该提交里拣回那两段）。

## 4. 迁移进度（每迁一个：改本表 + 把文件加进 `analysisScenario.test.ts` 的 `MIGRATED_ANALYZERS`）

| 分析器 | 入口 | 调用方 | 同步 / 异步 | 状态 |
|---|---|---|---|---|
| 角色兑现曲线 `composables/charIncrement.ts` | `computeIncrementPass` | `views/CharIncrementPage.vue` | 异步（每 4 队 yield） | ✅ 第 369 轮 `02049db9` |
| 时间线 `composables/teamTimeline.ts` | `computeTeamTimeline` / `computeNewCharacterPoints` / `computeSlotComparePoints` / `computeSlotSweepPoints`（4 处快照） | `composables/charts/chartRunners.ts`、`composables/teamCompareSweep.ts` | 异步 | ✅ 第 371 轮 `d9e39042`（arena-D） |
| 菲林模拟 `composables/teamTimelineFilm.ts` | `computeFilmSimulation` | `chartRunners.ts` | 异步 | ✅ 第 371 轮 `d9e39042`（arena-D） |
| 抽卡规划 `composables/pullPlannerEngine.ts` | `runPullPlanner` / `createEngineOracle` | `components/charts/PullPlannerChart.vue` | 异步 | ✅ 第 372 轮 `dfe53a2e` |
| 自由对比 `composables/freeCompare/engine.ts` | `computeFreeCompare` | `views/FreeComparePage.vue` | 异步 | ✅ 第 372 轮 `dfe53a2e` |
| 位置对比 `composables/positionCompare.ts` | `computePositionCompare` | `views/PositionComparePage.vue` | 同步 | ✅ 第 373 轮 `851f232f`（arena-A，T3） |
| 难度曲线 `composables/difficultyCurve.ts`（内含 `difficultyLadder`） | `computeDifficultyCurves` | `views/TeamComparePage.vue` | 同步 | ✅ 第 373 轮 `851f232f`（arena-A） |
| 队伍对比 `composables/teamCompare.ts` | `computeTeamComparePoints` | `views/TeamComparePage.vue` | 同步 | ✅ 第 373 轮 `851f232f`（arena-A） |
| `views/TeamComparePage.vue:1139` | 会话缓存键 `snap` | — | — | ✅ 第 373 轮 `851f232f` 改用 `cloneConfigState(configStore.$state)` |
| 伤害影响 2D / 3D（原在 `components/ImpactChart.vue` / `charts/ResponseSurface3D.vue`，**原表漏列**） | `impactSampling.ts#sampleImpactCurve` / `sampleImpactSurface` | 同左两个组件 | 异步 | ✅ 第 376 轮 `56e2f697`（CC-345，A/B 逐字节相同） |
| 主词条边际效用（原在 `components/MarginalUtilityCard.vue`，**原表漏列**） | `mainStatMarginal.ts#computeMainStatMarginals` | 同左组件 | 异步 | ✅ 第 376 轮 `1962c4b0`（CC-346，含「单项替换」口径修正） |
| 命座提升率 `composables/cinemaUplift.ts`（**原表漏列**） | `analyzeCinemaUplift` | `views/ResourceUtilizationPage.vue#computeCinemaGains` | 异步（nextTick） | ✅ 第 377 轮 `887c0ebc`（CC-347，A/B 逐字节相同） |
| 当期牌自动选择（原在 `views/RunArchivePage.vue#autoPickPeriodBuff`，**原表漏列**） | `runArchiveDeploy.ts#pickBestPeriodBuff` | `views/RunArchivePage.vue` | 同步 | ✅ 第 382 轮 `7967311a`（CC-352，lane arena-E） |

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

1. ~~**S2 迁完 §4 的 7 个模块**~~ ✅ 第 371 / 372 / 373 轮全部完成：时间线 + 菲林 `d9e39042`；抽卡规划 + 自由对比 `dfe53a2e`；位置对比（T3）+ 难度曲线 + 队伍对比 `851f232f`。
2. ~~**S3 删 `configSnapshot.ts`**~~ ✅ 第 372 轮 `81b0d2dc`：8 个分析器 + `TeamComparePage` 缓存键迁完后调用方为零，删模块与测试。`TeamComparePage` 的缓存键已由第 373 轮改成 `cloneConfigState(configStore.$state)`；CC-278 的内联快照源码锁搬到 `analysisScenario.test.ts` ④b（`MIGRATED_ANALYZERS` 现已覆盖全部分析器）。
3. ~~**S4 接 `batchTask.ts`**~~ ✅ 第 374 轮（`423e9de4` + `962e8b9f`）：取消契约统一为 `BatchControl.signal`
   （废除 `shouldAbort` 回调），9 个调用点接 `createBatchOwner`（进度 / 结果 / finally 只归当前运行），
   7 个分析器穿 `control`（被顶掉时下一循环头停算）。「每个任务一个 `withAnalysisScenario`」在 S2 迁完时即已成立
   （`TeamComparePage` 逐队建场景，其余整次运行一个）。~~`createBatchScheduler` 仍未接线~~ **第 421 轮已删除**（连同 `throwIfBatchAborted`）：取消契约只剩优雅式一种，见 §3.10 与 §7。
5. ~~**CC-347 命座提升率迁独立场景**~~ ✅ 第 377 轮 `887c0ebc`（§3.8；下文「`allAgentsSweep` 也调它」有误，见 §3.8 更正）。原文：`analyzeCinemaUplift` 现收 `configStore` + 页面 calc 的读取器
   （`readDamage` / `readUltimateTotal` / `readMetrics`），在 UI store 上改命座与 `enemy.stunCountLock`、finally 恢复。改法：入参换成 `scenario: AnalysisContext`，
   读取器改为在函数内从 `scenario.calc` 读（`teamTotalDamage`、`teamUltimateTotal`、`collectCinemaMetrics({ characters: resourceResult, stunPool, anomalyPool })`——页面现在就是这么拼的，
   见 `ResourceUtilizationPage.vue#computeCinemaGains`），删 originalCinemas / originalStunLock 的恢复；页面改 `withAnalysisScenario` + `useBatchOwner`。
   A/B：旧 API 在主仓库 HEAD 的 worktree、新 API 在自己的 worktree，用 `cinemaUplift.test.ts` 的现场各跑一遍、输出逐字节比较；
   `cinemaUplift.test.ts` 与 `allAgentsSweep.test.ts` 的既有不变量必须继续绿（R1 验收条件）。注意 `allAgentsSweep` 也调它，调用方要一起改。
4. ~~**S5 收窄类型（可选）**~~ ✅ 第 375 轮 `3c287f85`（§3.5）。原文：管线与分析器里 `ReturnType<typeof useConfigStore>` 的参数改成 `ConfigModel`（`config.ts` 已导出），场景就不必把 model 标成 store 类型；
   各文件里的 `ReturnType<typeof useResourceCalc>`（现 10 处）换成导入 `ResourceCalc`。只在顺手时做，不为降计数单独开卡。

## 7. 决定与依据

- **调用方建场景，分析器只收上下文**（而不是分析器内部自建场景）：依赖显式、测试可注入假 calc、日后同一个分析器能在 worker 里拿 worker 本地的 model 跑。
  代价是「调用方要记得用场景」——由 `MIGRATED_ANALYZERS` 源码锁兜住分析器侧；页面侧只有 `withAnalysisScenario` 一种写法。
- **出生态放进 `createConfigModel`**（而不是在场景模块里先建 model 再注水 + `await nextTick()` 让 watcher 先跑）：
  后者要求场景模块知道「哪个 watcher 怎么触发」，且把建场景变成异步；出生态对未来新增的 watcher 也成立。
- **`$state` 视图键取自源的 `$state`**：与 Pinia 对 state 的分类完全一致，memo 键覆盖的字段与 UI 实例相同。
- **不改其余 7 个分析器模块**：第 1 阶段只证明底座与一个试点（A/B 逐字节相同）；逐个迁移是机械活，按 §5 一张卡一个，单独可回退。（S2 已由第 371 / 372 / 373 轮做完。）
- **取消与归属走 `batchTask`，不进 `AnalysisContext`**（第 374 轮决定）：场景是数据沙箱，任务是生命周期，
  两者都每次运行一份但职责不同。分析器在选项里收 `control?: BatchControl`（替换原来的 `shouldAbort`），
  调用方建 owner 并发车；`withAnalysisScenario` 保持「只负责建/销场景」这一件事。
- **`cancel()` 不吊销提交权**（第 374 轮决定）：见 §3.4。若日后要「取消即丢弃已算部分」，
  回退点 = 把 `cancel()` 改回 `current = null; previous?.abort()`，并去掉三个页面中止按钮旁的部分结果展示。
- **取消契一：只保留优雅式中止**（第 421 轮决定，见 §3.10）：`batchTask` 不再保留抛错式 `createBatchScheduler` /
  `throwIfBatchAborted`。若日后要「取消即丢弃已算部分」，不要恢复抛错式，而是在调用方丢结果（页面本来就持有 `commit`
  的发布权）；若需要时间片让步，按当轮需求重写。
- **catalog 不进 `AnalysisContext`，分析器内部仍 `useCatalogStore()`**（第 372 轮决定）：目录是全局只读数据（角色 / 音引擎 / 推荐配装，加载后不再被用户改写），场景不持有独立副本——`createAnalysisScenario` 也是把同一个 catalog store 直接传给 `createResourceCalc`。把它收进上下文对隔离没有收益，却会让每个测试都多传一个字段。源码锁④因此只查 `useConfigStore()`。**再收窄的时机**：等 worker 真的需要自己的目录快照时（S4 / worker 化），那时 `AnalysisContext` 加 `catalog` 才是必要改动。

## 8. 坑

- 场景的 `config` 没有 `$patch` / `$subscribe` / `$reset` / `$onAction`。分析器里需要「批量写」就直接赋值字段或调 action。
- **盘点「还有谁改写 UI store」别只搜恢复函数**（第 376 轮教训：§4 原表按 `snapshotStore` 调用方列，漏了 3 个）。用过的检索：
  ① 同时含 `setTimeout(r, 0)` / `nextTick` 让出与 `configStore.<字段> =` / `set*` / `apply*` 写入的文件；② 组件 / 页面里同时读 `teamTotalDamage` 等计算结果又写 `configStore` 的文件，
  再人工剔除「用户编辑回调」。第 376 轮跑完这两条后，剩下的只有 `cinemaUplift.ts`（第 377 轮已迁；同步的 `substatOptimizer#refineWithRealDamage` 改写后同一拍内还原、不让出，UI 看不到中间态，不算）。
- **迁组件内的分析器要保住让出位置**：pre-flush watcher（如副词条预算设置）只在让出时跑，读数前少一次让出 / 多一次让出都可能改结果；3D 响应面旧实现每 8 点才让出一次、其余点同步读，新实现照抄。
- `createResourceCalc` 与已迁移分析器里不得调 `useConfigStore()`：会静默读回 UI 现场（源码锁④）。`useCatalogStore()` 允许——见 §7 的决定（catalog 是全局只读数据）。
- **写注释别出现被锁函数名的调用形态**：源码锁④ 按调用形态匹配，注释里写「不调 `useConfigStore()`」一样会红（第 372 轮实测踩到，改成「不读 UI config store」）。
- 新增 state ref 必须登记进 `config.ts` 出生态键表，否则建场景直接抛错。
- 一次运行一个场景；`withAnalysisScenario` 出错也会 dispose。
- `owner.cancel()` 只停计算；要「连已算部分一起丢」得调用方自己丢（当前没有这种需求）。
- `useBatchOwner()` 在组件 setup 里调才有 `onScopeDispose`；在 composable 里调（如 `useSlotSweep`）同样生效
  （composable 也在 setup 作用域内被调用）。
- 分析器的 `control` 是优雅中止：break 后返回已算部分，页面侧 `commit` 丢弃。别改成 throw——页面没有 catch。
- 页面里延时的「收起提示」定时器也要过 `run.commit`，否则被顶掉的旧运行会把新运行的进度条清掉。
- 场景里 `effectScope(true)` 是脱离父作用域的：在组件 setup 里建也不会随组件卸载自动停，必须 `dispose()`（用 `withAnalysisScenario` 就不会漏）。

- **`vite build` A/B 别用裸 `diff -r`**（第 421 轮实测）：改任一面页 chunk 会**级联**——`index` 块的
  `__vite__mapDeps` 内嵌全部懒加载块的 8 位内容哈希，它一变，所有 `import "./index-*.js"` 的块跟着变，
  裸 `diff -r` 会报几十条「Only in / 文件不同」（本轮 71 行，其中没有一行是真差异）。判据：把块名里的 8 位哈希
  归一化后再比（本轮 42/52 归一化后逐字节相同；剩下 10 个里 6 个只是引用哈希字符串不同）。
  另：**同一棵树连跑两次 build 逐字节可复现**（本轮实测），所以「两边不一样」只可能是级联或真实改动，不是构建不确定性。
- **（r383 CC-353）view 层的试算循环由 ④c 锁住**：`views/` + `components/` 里同一循环体既写 store 又读计算结果即红。新页面要「逐项试 → 取最优」就写成 `composables/` 里收 `AnalysisContext` 的纯函数，页面 `withAnalysisScenario` 调用（参照 `runArchiveDeploy#pickBestPeriodBuff`）。

## 9. 回退点

- 第 1 阶段整体：`git revert 02049db9`（出生态参数、工厂化、场景模块、试点迁移一起回退；UI 行为不变）。
- 只回退试点：恢复 `charIncrement.ts` / `CharIncrementPage.vue` / `charIncrementInt.test.ts` 三个文件到 `2d781b67`，并从 `MIGRATED_ANALYZERS` 删掉该项。
- 第 372 轮（抽卡规划 + 自由对比）：`git revert dfe53a2e`（恢复快照路径；调用方改回传 `calc`）。
- S3（删 configSnapshot）：`git revert 81b0d2dc`。**顺序要紧**：S3 之后不能再单独把某个分析器退回快照路径——`configSnapshot.ts` 已不在，回退前必须先 `git revert 81b0d2dc`。
- S4：`git revert 962e8b9f` → `git revert 423e9de4`（S4b 用了 S4a 的 `BatchControl` / `isBatchAborted` / `BatchOwner`，顺序反了编译不过）。
- S5：`git revert 3c287f85`（纯类型；与 S4 的回退互不依赖）。
- CC-345（伤害影响）：`git revert 56e2f697`；CC-346（边际效用）：`git revert 1962c4b0`。两者互不依赖。
- 第 421 轮（CC-395）：`git revert 6dbd26b8`（展示层 as any 清理 + scheduler 删除同一个提交；只需恢复 scheduler 时
  `git revert -n` 后从该提交里拣回那两段）。
- CC-347（命座提升率）：`git revert 887c0ebc`（恢复改 UI store + finally 路径与旧测试；与 CC-345/346 互不依赖）。
