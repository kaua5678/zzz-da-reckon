# 死导出普查与判据推广（r721）

> 2026-10-07，lane arena-G。基线 origin `321dbe0b`。提交：`dee99c90`（清掉 128 条无生产消费的导出）· `f07238a9`（判据 `scanDeadExports`）。
> 判据实现与口径以 `scripts/lib/dead-channel-ls.mjs#scanDeadExports` 头注释和 `@fact engine:guards/死导出` 为准；本文只记普查、裁决与取舍。

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
- **重开条件**：① 判据出现假红（新的动态取用写法）⇒ 补解析，不加豁免；② `DEAD_EXPORT_TEST_SEAMS` 超过 8 条 ⇒ 复查其中是否有能搬到测试侧的；③ 有人需要恢复某个兼容门面 ⇒ 先接上真实的生产消费者再加转出。

## 6. 验证

- vue-tsc 0；check-guards 27；zc.test + checkGuards.test 207/207；deadChannelLs 13/13；tokens 12 / data 367 / specs 1120 / recording 189。
- vitest 263/2174 + 264/2347 = **527 文件 / 4521 例**（原 528 / 4536；−15 例逐条归因见 `dee99c90` 提交说明：Cc62 3、反函数 4、膨胀换算 2、skillRows 壳 1、`presetTeamKey` / `isEnemyDebuffStat` / 集合划分各 1、deadChannelLs 2）。
- zd：DUMP 0 / ROWS 0（引擎输出逐位不变）。
- build：65 文件 64 相同；index.js −569B，归因：`ALL_VIEW_DEFAULT_AGENT_IDS` 顶层计算消失；`anomalyPool/helpers` 与 `resourceCalc/helpers` 被 `import * as` 再解构，打包器物化整份命名空间，其中被删的转出属性消失；叶瞬光模块因 `specPanelBuffs` 不再转出而换位（注册顺序由 `mechanics/index` 显式列表决定）。
- zc drift：154 / 0 / 0。
