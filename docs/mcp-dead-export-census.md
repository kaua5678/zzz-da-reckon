# 死导出普查与判据推广（r721）· 兼容门面收口（r722）

> 2026-10-07，lane arena-G。基线 origin `321dbe0b`。提交：`dee99c90`（清掉 128 条无生产消费的导出）· `f07238a9`（判据 `scanDeadExports`）。
> 判据实现与口径以 `scripts/lib/dead-channel-ls.mjs#scanDeadExports` 头注释和 `@fact engine:guards/死导出` 为准；本文只记普查、裁决与取舍。
> r722（同日）：基线 origin `fbdbddbf`。提交：`0c69f4d0`（兼容门面收口：14 个门面 60 条转出删除，导入方改到声明处）· `a437a541`（判据：转出口径）。见 §7–§10。

## 1. 问题：死导出判据有三个结构性盲区

- **测试引用算活**。R33 的 `scanDeadExportsLs` 用 LanguageService `findReferences`，program 含 `__tests__`，任何测试引用都让符号「活着」。R33 自己记下的真实病灶正是这一形态：`damage.test.ts` 测的是 `damage.ts` 的死副本，活实现零测试（`zc.mjs#auditAuthoredFacts` 头注释）。旧口径对它恒绿。
- **只扫 `src/core`**。理由是 program 看不见 `.vue`。R34 补了 `auditNonCoreDeadExports`（`.vue` 正则 + 全仓文本兜底），但明确「只报不红」，09-18 之后无人再跑。
- **转出别名与默认导出没人管**。拆模块时为「导入方不用改」留下的 `export {x} from` 门面，导入方迁走后就成了死表面：同一符号两个导入出处，读代码的人会以为它属于门面模块的 API。
- 另：逐导出 `findReferences` 很慢，deadChannelLs ⑫ 单例 37.8s，整个测试文件 49.3s，是 vitest 第 1 片里最慢的文件。

## 2. 普查

- **方法**：一次遍历 program 全部标识符建「原始符号 ← 使用点」反向索引（别名经别名链解析，局部符号归一到导出符号；import / 转出语句本身不算使用；命名空间 `ns.x`、对象解构、简写属性单独解析），按使用点所在文件分为本文件 / 生产 ts / scripts / 测试 / `.vue` import。仓外探针 `/home/kaua/calc-arch/g721/deadexp721.mjs`，全扫约 5s。
- **交叉验证**：零引用（含测试也零）的 5 条，与 R34 审计的 dead 2 + textMentioned 3 是同一批符号，两套独立方法结论一致。探针首版漏了 `const {…} = 命名空间` 的解构（`anomalyPool.ts`、两处 `ResourceCalcHelpers`），误报 7 条 core 死函数；补上后归零，判据单测 ⑩ 已覆盖这一写法。
- **结果**（全 src 2552 个导出，含转出别名）：127 条没有生产消费者，删完后又暴露第二层 1 条，共 128 条。

| 类 | 条数 | 构成 |
|---|---|---|
| A 声明 | 23 | 只被测试引用 21 + 零引用 5 − 登记为测试接口 4 + 第二层 1（`AxisWindowLaneKind`） |
| B 默认导出 | 28 | 角色模块 `export default xMechanic`；全仓零默认导入（测试 1 处） |
| C 转出别名 | 77 | resourceCalc/helpers 20、mechanics/types 14、core/resource/helpers 10、core/resource 6、teamTimeline 4、core/buff 3、core/deadlyAssaultScore 3、anomalyPool/helpers 3、其余 14 |

## 3. 逐条裁决（A 类）

| 符号 | 裁决 | 依据 / 测试怎么改 |
|---|---|---|
| `teamAxisWindowLaneSlot` · `AxisWindowLaneKind` | 删 | CC-448 已被 `teamAxisWindowLanes` 取代（axisWindowLaneDecl.test 甚至锁 StunAxisPage 不得出现它）；整份 Cc62 测试删（3 例，其源码锁被 viewAgentDefaults ③ 全覆盖）；`AxisWindowLaneKind` 只给它当参数类型 |
| `teamHasAxisPresetPreferred` | 删 | 活的 `axisPresetPreferredLabel` 走更通用的 `axisPresetPreferred` 声明；Cc60 / Cc79 改按原写死口径断言 |
| `rowAppliedStunMult` | 删 | 自称「旧签名」；测试改调 `rowAppliedStunMultOf`：回落路径 4 例保留，集成快照按生产方式传整行（快照值不变），等价性改为「新字段 vs 回落」 |
| `damageRatioForScore` | 删 | 分数曲线反函数，生产只用正向；删反函数与往返 4 例 |
| `deflateScoreByInflation` | 删 | 展示层换算从未接入界面；删 2 例 |
| `MIN_SAMPLES_PER_VERSION` | 删 | 旧固定阈值残留（判定早改自校准 `isLowSample`）；唯一断言是「它仍导出」；字段注释同步改 |
| `interactiveTeammateBuffs` · `declaredOnlyTeammateBuffs` | 删 | 渲染面逐条调 `isTeammateBuffInteractive`；集合划分 1 例删，两份全库判据改直接 filter |
| `isEnemyDebuffStat` · `presetTeamKey` · `nodesFrom` · `nodeIdForDate` · `getElementDmgKey` | 删 | 生产不用；专测删，顺带用到的改调活函数（`indexForDate` 下标、`VERSION_NODES.slice`、`elementStatKey('dmg', …)`，保留「烈霜增伤键读冰」用户口径） |
| `AGENT_PALETTE` · `chart3YStepOf` | 删 | 「旧名原样转出」，导入方已迁完 |
| `AgentPanelStatKey` · `BanyueInteractionTopUp` · `DownscaledInteractionField` | 删 | 零引用类型 |
| `setCachedFreezeEnabled` · `isCachedFreezeEnabled` | 删 | 开关从未被拨；`enabled` 改 `const`，「生产构建整段 tree-shake」从此由代码保证 |
| `emptyAnomalyPool` | 搬 `src/test/fixtures.ts` | 注释自述是测试夹具；6 个测试改 import |
| `ALL_VIEW_DEFAULT_AGENT_IDS` | 搬测试侧 | viewAgentDefaults.test 改为自动收集模块内全部角色 id 形态值：新默认值不用登记就进锁 ①（原清单靠手工同步） |
| 记忆化 / 快路径的 4 个读写接口 | 登记 `DEAD_EXPORT_TEST_SEAMS` | 读写模块私有 `let` 状态，搬不进 `src/test`；测试靠它们关缓存对拍 |

B、C 两类用 AST codemod 处理（仓外 `deadfix721.mjs`）：删死转出 / 死默认导出，测试侧 38 + 1 处经由它们的导入改到声明处（保留 `as` 别名与 `import type`）；codemod 刻意不碰前置注释（`core/resource.ts` 的转出壳上挂着两条 `@fact`），删后人工收口孤儿 JSDoc 与「此处 re-export 保持零改动」类失真注释。R22 三刀的壳契约测试（panelPhases / skillRows / anomalyPanels Shell）随转出收窄，「同一绑定」性质对剩余转出照旧。

## 4. 判据：`scanDeadExports`

- 口径：src 非测试 `.ts` 的每个导出（含转出别名）必须有生产消费点；测试侧（`__tests__`、`*.test.ts`、`src/test/`）不算。
- 实现：同 §2 的反向索引；`.vue` 解析 `<script>` 的 import，按名字经被导入模块的导出表落到符号（取代 R34 的正则 + 全仓文本兜底）；命名空间按值用、`import()` 结果未解构 ⇒ 整模块算被用（保守）。
- 例外只有 `DEAD_EXPORT_TEST_SEAMS`（取代自 R34 起为空的 `DEAD_EXPORT_BASELINE`）；条目失效（被删 / 长出生产消费者）进 `staleSeams` 报红。
- 已知不覆盖：只被另一个死导出引用的导出（单层判定）；前者删掉后下一次扫描自然暴露（本轮的 `AxisWindowLaneKind` 就是这样抓到的）。
- 成本：全扫 4.1–4.4s；deadChannelLs ⑫ 37.8s → 3.7s，整个文件 49.3s → 12.9s；扫面从 core 扩到全 src。

## 5. 不做的事与重开条件

- **不做**：给 1232 个「只在本文件使用」的导出去掉 `export`（只是可见性标注，没有死代码，收益不抵改动面）；多层递归判死（单层 + 下次扫描已足够，递归要按声明体追踪引用归属，复杂度不值）；恢复「全仓文本提及」兜底（文档或注释提到一个名字不构成消费）。
- **重开条件**：① 判据出现假红（新的动态取用写法）⇒ 补解析，不加豁免；② `DEAD_EXPORT_TEST_SEAMS` 超过 8 条 ⇒ 复查其中是否有能搬到测试侧的；③ 有人需要恢复某个兼容门面 ⇒ r722 起不再接受：非入口文件不许转出（§8），确属一个域的公共入口才登记 `REEXPORT_ENTRY_FILES` 并写清理由。

## 6. 验证

- vue-tsc 0；check-guards 27；zc.test + checkGuards.test 207/207；deadChannelLs 13/13；tokens 12 / data 367 / specs 1120 / recording 189。
- vitest 263/2174 + 264/2347 = **527 文件 / 4521 例**（原 528 / 4536；−15 例逐条归因见 `dee99c90` 提交说明：Cc62 3、反函数 4、膨胀换算 2、skillRows 壳 1、`presetTeamKey` / `isEnemyDebuffStat` / 集合划分各 1、deadChannelLs 2）。
- zd：DUMP 0 / ROWS 0（引擎输出逐位不变）。
- build：65 文件 64 相同；index.js −569B，归因：`ALL_VIEW_DEFAULT_AGENT_IDS` 顶层计算消失；`anomalyPool/helpers` 与 `resourceCalc/helpers` 被 `import * as` 再解构，打包器物化整份命名空间，其中被删的转出属性消失；叶瞬光模块因 `specPanelBuffs` 不再转出而换位（注册顺序由 `mechanics/index` 显式列表决定）。
- zc drift：154 / 0 / 0。

## 7. 兼容门面收口（r722）

- **问题**：r721 删的是没人经由的转出；剩下的转出都有生产消费者，死导出口径看不见，但它们同样是第二条导入路径——同一符号两个导入点，改名 / 删除要追两处，读者分不清哪个是真身。近一个月约 10 次拆分 / 下沉（R22 三刀、CC-1 / 83 / 86 / 223 / 224 / 228 / 232、r407、r701、09-13 展示层下沉）每次都为「导入方零改动」留一个壳，成了默认做法。附带成本：壳文件的注释随拆分史膨胀（`core/resource/helpers.ts` 六段迁移横幅约 80 行）；R22 为壳专门写了 3 份「同一绑定」契约测试（12 例）；`import * as` 再解构让打包器整份物化命名空间对象（r721 §6 已记）。
- **普查**（仓外 `facade722.mjs`）：非测试 src 文件上转出别处声明的符号共 17 个文件 89 条。保留 4 个入口（§8），其余 14 个门面 60 条：

| 门面 | 条数 | 声明处 |
|---|---|---|
| `composables/resourceCalc/helpers.ts` | 13 | `./panelPhases`（6）、`./anomalyPanels`（7） |
| `core/resource/helpers.ts` | 12 | `./crossAgentEnergy`、`./resourceIncome`、`./timeOccupation`、`./timeTruncation`、`./rowBuild` |
| `core/resource.ts` | 11 | `./resource/moveLookup`（10）、`data/resourceDefaults`（1） |
| `core/anomalyPool/helpers.ts` | 7 | `types/resource`（2）、`data/anomalyDecibelBonuses`（3）、`data/anomalyElement`（2） |
| `core/anomalyPool.ts` | 3 | `./anomalyPool/helpers`、`types/resource`、`data/anomalyDecibelBonuses` |
| `composables/resourceCalc/skillRows.ts` | 3 | `data/moveTableQueries` |
| `core/buff.ts` | 2 | `data/skillDamageTargets`、`data/agentPanelStats` |
| `composables/resourceCalc/convergence.ts` | 2 | `./roundInputs`、`./roundResult` |
| `composables/teamTimeline.ts` | 2 | `./teamTimelineFilm` |
| 其余 5 个各 1 | 5 | `specs/resources` → `types/resource`；`core/damage` → `data/penetrationPower`；`core/deadlyAssaultScore`（整个文件就是壳，删）→ `data/deadlyAssaultScore`；`versionChartGeometry` → `hpRatioAxis`；`impactVariables` → `core/impactVars` |

- **做法**（`0c69f4d0`）：
  1. 前置：三处 `import * as` + 解构改具名导入（`core/anomalyPool.ts` 19 名、`useResourceCalc.ts` 10 名 + 1 处限定调用、`convergence.ts` 1 处限定调用；命名空间限定调用的名字都没有同名局部变量，改名不会遮蔽）；删 R22 三份壳契约测试（锁的对象不存在了；「不许再加壳」改由 §8 的判据统一管）；另 3 处「core 转出与 data 同一绑定」断言删掉（壳删后会退化成 x toBe x）。
  2. codemod（仓外 `refit722.mjs`，基于 r721 的 `deadfix721.mjs`）：目标由程序推出（非入口、非测试 src 文件上、原声明在别的文件的 `ExportSpecifier`），与 §8 判据同一口径；改写全部具名导入方（生产 ts / scripts ts / 测试 190 处，`.vue` 5 个文件 8 个名字用 script 块正则），声明在 `types/resource/*` 的走 `@/types/resource`；同一文件既是导入方又是门面时（如 `resourceCalc/helpers` 从 `@/core/resource` 取 find* 族），导入改写与删转出在同一份原文上合成编辑；删转出后剪掉只为转出而存在的 import 绑定（顺带暴露 `panelPhasesShell` ② 的说法早已过时：`buildCharConfig` 不再走 `computePanel`）；只剩注释的文件删除。命名空间导入只记日志不改。
  3. 收口：37 处 `await import('@/composables/resourceCalc/helpers')` 解构 `computePanelPhases`（codemod 不改动态 import，vue-tsc 报出 37 个 TS2339）改指 `./panelPhases`；codemod 产物规整（相对导入生成了跨目录 `../` 路径 6 处 → `@/`；单类型元素的新语句 `import { type X }` 5 处 → `import type` 或并入已有 `import type`）；注释：门面里的迁移横幅与「此处 re-export 保持零改动」、兄弟模块 10 对「不走 `./helpers` 的 re-export 壳」、data 层 7 个定义落点文件头的「core 原名转出」、3 个孤儿 JSDoc（`DamagePoolRow` 与 `computeSpecResources` 的悬停文档一直挂着别人的说明；`getBaseElement` 的旧 JSDoc 还写着已实现的 `ether_ink`「待实现」，冰 / 烈霜不进变种表的理由定义处已有）。`@fact` 声明位置不动（豁免清单按「声明文件 + 事实 id」作键），只把「留在 re-export 壳处」改为「留在本文件」。
- **结果**：src 生产 65 个文件 +123 −427，测试 112 个文件 +195 −422（含 3 份整删）；60 条转出 → 0；`core/deadlyAssaultScore.ts` 删除，其余 13 个门面只剩自己的声明。

## 8. 判据：转出口径（`a437a541`）

- **口径**：非入口文件转出别处声明的符号（`export {x} from` / `export *` / `import {x}` 再 `export {x}`）= 兼容壳，有生产消费也报红；本地声明的改名导出（`export { own as renamed }`）不算转出。实现在 `scanDeadExports` 同一次遍历里（返回 `shells` / `staleEntries`，扫描耗时不变）；deadChannelLs ⑫ 断言全仓为空，⑭ 夹具锁三种写法报壳、入口放行、本地改名不报、失效条目。
- **入口白名单** `REEXPORT_ENTRY_FILES`（值 = 为什么它是入口）；条目不再转出任何符号进 `staleEntries` 报红：

| 入口 | 理由 |
|---|---|
| `src/mechanics/index.ts` | `@/mechanics` 公共入口：`export *` 汇总 registry / interactionBaseline / types |
| `src/mechanics/types.ts` | 机制契约类型的单一入口：CC-83 / CC-451 按体积预算拆出 typesRows / typesHooks / typesView，分片不是新的域（typesSplitCc83.test 锁形状） |
| `src/types/resource/index.ts` | 资源域类型桶：类型按域拆在 `types/resource/*`，导入方统一走 `@/types/resource` |
| `src/stores/config.ts` | 展示层合规通道：`.vue` 不得 import `@/mechanics`（判据 7），interactionBaseline 三个纯函数经 store 转出 |

- **入口与壳的区分**：入口是一个域的公共面，导入方不该知道符号落在哪个分片；拆出来的是有自己名字与职责的新模块（panelPhases / moveLookup / data 层下沉）就让导入方直连它。`mechanics/types` 与被删的壳成因相似（都因拆分而转出），区别在于前者的卫星文件只是体积分片。
- **反空洞**：用新扫描器扫改动前的 `fbdbddbf`，报 60 条 / 14 个文件，与 §7 普查逐文件一致（`staleEntries` 0、死导出 0），扫描 4.4s。
- **迁移规矩**（取代 ARCHITECTURE 原「原位置留 import + export 两行壳」，该处与判据 19 表格行已同步改）：拆分 / 下沉时同批改导入方。

## 9. 属性级存活：普查结论（不做）

- **动机**：死导出看导出符号，死通道看字段名；想知道能否升到「接口属性符号」级——属性有没有人写、有没有人读。
- **探针**（仓外 `propliv722.mjs`，14s）：6960 个属性签名（可选 1854）、13795 个对象字面量；写入只认上下文类型命中该属性声明的赋值。clean = `.vue` 与 JSON 都没有同名。

| 类别 | 总数 | clean |
|---|---|---|
| 可选 · 生产零写 · 只有测试写 | 186 | 26 |
| 可选 · 全零写 · 生产有读 | 344 | 60 |
| 可选 · 全零写 · 生产零读 | 133 | 17 |
| 生产零读 · 只有测试读 · 生产有写 | 456 | 79 |
| 全零读 · 生产有写 | 635 | 168 |

- **抽查**：26 条 clean 的「可选 · 生产零写 · 只有测试写」以假阳性为主。病根是结构化类型：「输入视图」接口的属性由任意结构兼容的对象供值，写入点的上下文类型是源类型而不是视图接口——`StunRowLike.stunMult` 实际由 `DamagePoolRow` 供值；同类还有 `OuterCyclePickMember.feasible / windowsIn`、`ConvergenceReport.interactionScale`、alice 的内联 cfg。
- **结论**：要做准，必须在每个赋值 / 传参 / 返回点把源类型属性传播到目标类型属性（结构化可赋值性逐属性展开），复杂度与误差都不值；现有按名字的扫描（判据 14、死通道 LS）保持「宁漏不误」。
- **重开条件**：有人愿意做赋值点的属性传播。

## 10. 验证（r722）

- vue-tsc 0；check-guards 27；zc.test + checkGuards.test 207/207；deadChannelLs 14/14（12.7s）；tokens 12 / data 367 / specs 1120 / recording 189。
- vitest 261/2166 + 263/2343 = **524 文件 / 4509 例**（原 527 / 4521；−12 逐文件归因：anomalyPanelsShell 6、panelPhasesShell 3、skillRowsShell 3、anomalyElement「同一对象」1，deadChannelLs ⑭ +1）。
- zd：DUMP 0 / ROWS 0。
- build：65 文件只有 index.js 变（−2590B）。归因：`anomalyPool/helpers`（42 键）与 `resourceCalc/helpers`（23 键）两个命名空间对象不再物化，`anomalyPool.ts` 顶层解构消失；改成直接 const 导入后打包器看得到 `ANOMALY_DURATION` 的字面量，把两处 `ANOMALY_DURATION.wind ?? 30` 折叠为 `.wind`（`wind: 30` 已定义、全仓无写入，等价）；其余为模块顺序移动（归一化短标识符后按语句比对）。
- zc drift：154 / 0 / 0（提交前后各一次）。
- **坑**：判据 25（`record-key-dead-reads`）用 `git ls-files` 取文件，读的是索引——删了源文件未 `git rm` 就跑 check-guards 会 ENOENT，先暂存删除。
