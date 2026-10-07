# 死兜底普查与判据 28（r723；r724 收窄信任边界；r725 信任边界清零；r726 战斗时间单一来源）

> 范围：src 非测试 `.ts` 里「左侧类型不含 null / undefined 的 `a ?? b`」。工具：TS 类型检查器（不是正则）。
> 提交：`7cb3f8c8`（清理 + cfg 契约）、`6e534cae`（战斗时间单一通道）、`587e767e`（判据 28）。
> r724：store 用户态与轴移出信任边界（`0d699bb8`），写入方清点见 §4.1。
> r725：外部 JSON 类型契约（`766a04a0`）——validate:data 按代码转型用的 TS 类型校验全部 JSON 入口，信任边界表删除（59 → 0），见 §4.2。
> r726：战斗时间单一来源（`866b5ef8`）——生产代码里当战斗时间用的 180 只留在 store 的 defaultEnemy，函数入参的缺省改必填；战斗时间 ≠ 180 的差异逐队归因，见 §4.3。
> 普查 / codemod 脚本：`calc-arch/g723/deadnullish.mjs`、`calc-arch/g723/fixnullish.mjs`（不进仓；判据实现在 `scripts/lib/dead-nullish-gate.mjs`）。

## 1. 结论速览

- r723 前（origin `bcb12bfe`）：871 处 / 234 个「类型.字段」/ 127 个文件。右侧永远取不到，却让读者以为值会缺；同一字段还散着不同默认值：般岳 `cfg.blockCount ?? 0` 与 `cfg.blockCount ?? DEFAULT_BLOCK` 并存；战斗时间的兜底有 36 处，默认值有 180、0、totalTime 三种。
- 根因有两层：
  1. 写模块的人（含低级模型）习惯性加兜底，没有机器门拦，评审也拦不住。
  2. `CharacterOperationConfig`（cfg 袋子）里有 21 个字段由 `buildCharConfig` 恒写，却声明成可选。读的人只能信「可能缺」，于是继续补兜底。
- r723 的做法：
  - 先改契约：19 个字段改为必填。
  - 再删引擎内部契约上的死兜底，共 800 处 / 106 个生产文件。
  - 外部数据类型上的 126 处不动，列入信任边界。
  - 最后加判据 28 硬门，防止长回来。
- r724：逐个清点 store 用户态（`CharacterConfig` / `EnemyConfig`）与轴类型的写入方，没有找到 TS 管不到的缺字段来源（store 从未持久化；外部 JSON 只有 Boss 预设与轴预设，改由 validate:data 校验），于是把它们移出豁免表：豁免 126 → 59 处，删读点死兜底 72 处 + `.vue` 4 处，旧版单表抗性兼容层整层删除。
- r725：信任边界清零。代码对 JSON 的转型（`res.json() as T`、`import.meta.glob` 后 `as T`）共 8 个入口，validate:data 改为按这些类型逐字段校验数据、漏登记的入口即红（`scripts/lib/json-contract.mjs`）。首跑查出 31 个键与声明不符，逐条改真（`BuffEffect` 改判别联合、`SkillRow.label` 等改可选、null 归一为缺省）；然后删除豁免表，读点死兜底删 59 处 + `.vue` 6 处。
- r726：战斗时间单一来源。函数入参上的 180 缺省与兜底改必填（生产调用方本来就都传了真实值），build 相位改传真实战斗时间，般岳闪能与仪玄异常回闪上限改按战斗时间算。战斗时间 ≠ 180 的探针只见 6 个般岳队变化，归因到般岳闪能（§4.3）。

## 2. 判定口径

一处 `a ?? b` 算「死」，要同时满足：

1. `a` 去括号后是下面两种之一：
   - 声明过的属性访问，且不是可选链 `?.`。「声明」指属性签名、属性声明、对象字面量属性或参数属性。
   - 标识符。
2. `a` 在该位置的类型（含控制流收窄）不含以下任何一种：null、undefined、any、unknown、void、never、类型参数、索引访问类型、条件类型。

**不算**（类型不可信或语义不同）：

| 形态 | 不算的原因 |
|---|---|
| 元素访问 `a[k] ?? b` | 仓库没开 `noUncheckedIndexedAccess`。`Record<string, T>` 取值的类型不含 undefined，但运行时可能缺键 |
| 走索引签名的点访问 | 同上 |
| 调用结果 `f() ?? b` | 不在本口径内 |
| `\|\|` | 0 和 '' 也会取右侧，是另一种语义 |

控制流收窄也算数。例如伊德海莉在 `if (cfg.yidhariDecibelPerHpPct === undefined) return 0` 之后又写 `cfg.yidhariDecibelPerHpPct ?? 10`，第二处属于死兜底。

## 3. 普查数字（按 owner 类型）

| owner（声明处） | r723 前 | r723 后 | 去向 |
|---|---|---|---|
| `PanelValues`（types/catalog.ts，引擎用 `emptyPanel()` 全量构造） | 326 | 0 | 删除 |
| `CharacterOperationConfig`（cfg 袋子，含模块扩充） | 134（19 个字段改必填后又多出 52 处） | 0 | 删除，共 186 处 |
| `IterationState` | 111 | 0 | 删除 |
| `SkillExecution` | 69 | 0 | 删除 |
| `CharacterResourceResult` | 30（嵌套的第二轮再删 1） | 0 | 删除 |
| 局部标识符（形参 / 局部量） | 21（嵌套的第二轮再删 2） | 0 | 删除 |
| 其他引擎内部类型（AnomalyProgress、ResourceCalcConfig、StunPoolResult 等 22 种） | 54 | 0 | 删除 |
| **外部数据类型**（见 §4） | 126 | 126（r724 后 59，r725 后 0） | r723 豁免；r724 移出 store 用户态与轴（§4.1）；r725 JSON 入口全部由类型契约校验、豁免表删除（§4.2） |

- 删除总数 800：其中 93 处 `Number(x ?? d)`（x 为 number）连同 `Number()` 一起删，括号也一并去掉。
- 嵌套 `a ?? b ?? c` 分两轮删，第二轮 4 处。
- 删完后 vue-tsc 只报 7 个 TS6133，都是「只在兜底里用到的参数或常量」，已一并删除：
  - `calcEnergyRegenTotal` 的 `defaultBase`：4 个调用点不再传 1.2，`energyRegen` 的默认值 1.2 只留在 `emptyPanel`。
  - 般岳的 `DEFAULT_DODGE` / `DEFAULT_PARRY` / `DEFAULT_BLOCK` / `DEFAULT_DUAL`：真正的来源是模块的 `interactionDefaults`，「用户确认」的注释已挪过去。
  - 琉音 supply 的 `totalTime`。
  - 伊德海莉 applyTeamConfig 的 `team`。

## 4. 信任边界（r723–r724 判据 28 的豁免表；r725 删除）

> r725 起本节只是历史记录：豁免表 `DEAD_NULLISH_TRUST_BOUNDARY` 已删除，下表四类数据源全部由 JSON 类型契约校验（§4.2）。

这些类型的值来自 TS 管不到的数据。声明上写的是必填，但读入时没人校验或补齐，所以兜底可能是承重的。豁免规则：

- 具名类型按类型名豁免。
- 匿名的 `{ … }` 字面量类型按声明文件豁免。
- 判据行公示豁免数（r723 为 126，r724 后为 59）。

r724 起 store 用户态与用户轴已移出（§4.1），下表只剩真正来自外部数据的类型。

| 类别 | owner | 处数 | 数据从哪来 | 移出条件 |
|---|---|---|---|---|
| 目录 JSON | `AgentSkills`、`SkillCategory`、`SkillMove`、`SkillRow`、`BuffGroup`、`BuffEffect`、`TeammateBuffGroup`、`TeammateBuff`、`AgentCombatBuffs`，以及 `types/catalog.ts`、`stores/catalog.ts`、`data/moveTableQueries.ts` 的匿名类型 | 42 + 6 | `public/static/*.json`，运行时 fetch | validate:data 校验对应键必有；或 catalog store 加载时规整 |
| Boss 预设 / 期数 | `BossPreset`、`PhaseBuffCard`、`TimelineAxisNode` | 6 | boss-presets.json；`TimelineAxisNode.date` 取自 `PeriodAxisNode.begin` | 同上（validate:data 或加载时规整） |
| 存档导入 | `ArchiveRun`、`ArchiveRunMember` | 4 | 用户提供的文件 | 导入时规整（这一类大概率应该一直豁免） |
| spec JSON | `TeamBuffSpec` | 1 | `src/specs/agents/*.json` | validate:specs 校验 `coverage` 必有，或类型改为可选 |

### 4.1 r724：store 用户态与轴移出豁免表

**结论**：这两类不是外部数据。r723 写的三个来源，r724 逐个核对：

| r723 写的来源 | 核对结果 |
|---|---|
| 旧存档迁移 | 不存在。store 从未持久化：`package.json` 自初始提交 `1a1f8c65` 起没有持久化插件，`git log -S localStorage -- src/stores/config.ts` 为空。`ensureResistanceTables`（把旧版单表 `enemy.resistances` 拆成三张表）和它的 deep watcher 从初始提交起就没有数据源 |
| 分析场景 `initialState` 克隆 | 克隆源是另一个 store 的 `$state`（`createAnalysisScenario`），字段与源一致 |
| 队伍预设 JSON | 只经 `setAgent` / `setWEngine` / `setActionCount` 等 setter 写入。setter 只改已有字段，不会让字段消失 |

全部写入方：

| 类型 | 写入方 | TS 管不到的来源 |
|---|---|---|
| `CharacterConfig` | `defaultCharacter` 全量构造；`setAgent` 和各 setter 只改已有字段；`initialState` 克隆；测试 harness 的 `setTeam`（12 个必填字段齐全） | 无 |
| `EnemyConfig` | `defaultEnemy` 全量构造；`setEnemy` 合并写入（调用方 impactVars、属性页、结果页、bossRoom，传的都是数）；`applyBossPreset`；`initialState` 克隆 | `applyBossPreset` 的入参来自 Boss 预设 JSON |
| 轴：`StunAxis` / `StunAxisAction`，及结构子集 `AxisLike` / `AxisActionLike` | 轴编辑器（新动作 `count: 1`）；`setAxisState` / `applyStunAxisPreset` 深拷贝；条件轴的 `split` 由代码生成；轴预设 | 轴预设的 JSON 文件 |

TS 管不到的只有这两处 JSON，r724 都加进了 validate:data：

- `public/static/boss-presets.json`（运行时 fetch）：每个预设的 `monster.stunVuln` / `stunTime`、`defaults.battleTime` / `shieldCount` / `energyShield`，每个相位的 `hp` / `stunValue` / `defense` / `level` / `bossAnomalyCoeff`，以及三张抗性表的 6 个元素，都必须是有限数。当前 23 个预设 / 159 个相位全部通过。反例：删一个 `battleTime`、删一个抗性元素、把一个 `hp` 置空，报 3 处。
- `src/data/stunAxisPresets/*.json`（`import.meta.glob` 打进包）：原有的单文件检查加上「每条轴有 `actions`，每个动作有整数 `slot`、字符串 `moveId`、有限数 `count`」。当前 21 个文件 / 26 条轴 / 233 个动作全部通过。反例：删一个动作的 `count`，该文件报错。

**读点上的兜底不只是死的，还互相矛盾**，可见它们从来不是「默认值」：

| 读点 | 写的兜底 | store 的真实默认值 |
|---|---|---|
| `stunVulnDisplay` ×2 | `stunVuln ?? 0` | 1.5 |
| convergence 的异常阈值系数 | `bossAnomalyCoeff ?? 1` | 1.1 |
| freeCompare、RunArchivePage | `hp ?? 0` | 205970837 |
| panelPhases 等 11 处 | `cinemaLevel ?? 0` | 6 |
| panelPhases 等 7 处 | `wEngineModLevel ?? 1` | 5 |
| impactVars | `stunVuln ?? 1.5`、`battleTime ?? 180` 等 4 处 | 与 `defaultEnemy` 重复一份 |

**改动**（`0d699bb8`）：

- 豁免表移出 `CharacterConfig`、`EnemyConfig`、`stores/config.ts` 的匿名类型，以及 4 个轴类型：126 → 59 处。
- 门列出的死兜底用同口径 codemod 删除（`calc-arch/g724/fixnullish.mjs --policy=store`）：store 59 处、嵌套第二轮 4 处、`bodySize` 1 处、轴 8 处，共 72 处 / 20 个生产文件。
- `.vue` 不在门内，手删 4 处：RunArchivePage 的 `hp`、TeamComparePage 的 `battleTime ?? 180`、ResultPage 的 `invincibleTime`、AttributeConfigPage 的 `bodySize`。
- 旧版单表抗性兼容层整层删除：`EnemyConfig.resistances?` 字段、`ensureResistanceTables`、`watch(enemy, …, { deep: true, immediate: true })`、`setResistance` 里的调用。读点上的 `?? enemy.resistances ?? {}` 链（.ts 4 处、属性页 3 处）随之收短。
- `EnemyConfig.bodySize` 改必填：`defaultEnemy` 恒写 `'large'`，应用 Boss 时按预设覆盖，读点不再重写 `'large'`。
- `core/impactVars` 的 `ImpactVarConfig.enemy` 五个字段改必填（与 `EnemyConfig` 一致），删掉 4 处重写的默认值和 1 处 `?? {}`。
- 测试：impactVars 的桩补齐 enemy 字段（值取 `defaultEnemy`）；删除 lycaonC2Contract 里「`delete` store 字段，模拟老预设或外部写入」的用例，上面的清点表明不存在这种来源。用例 4509 → 4508。
- 数值：zd DUMP 0 / ROWS 0。

**还没做到「180 只留在 `defaultEnemy`」。** 剩下的不是数据类型上的死兜底，而是函数入参写成可选、默认 180，门管不到：

| 位置 | 写法 |
|---|---|
| `core/effectiveTime.ts` 的 `TimeBasisCfg` | `battleTime?` / `invincibleTime?`，读点 `?? 180` / `?? 0`。生产调用方传的都是 cfg 或 `configStore.enemy`，字段都必填 |
| `composables/difficultyRatio.ts` 的 `RatioEnemyLike` | 字段可选，形参默认 `{}`，`enemy.battleTime ?? rr.totalTime`。两个生产调用方都传 `configStore.enemy` |
| `resourceCalc/panelPhases.ts` 派发器 ×2 | `params.combatTime ?? 180`：build 相位不传 combatTime |
| `mechanics/agents/lighter.ts` | `opts?.combatTime ?? 180`；build 相位直接写 `combatTime: 180` |
| `mechanics/teamVeil.ts` | 形参默认 `combatTime = 180` |
| `billy.ts` / `evelyn.ts` 的 `compute*Cycle` | `battleTime?`，`Number.isFinite(…) ? … : 180` |

这些留给下一轮，见 r6 §8.0 #28 ④。本轮不做的原因：它们是函数入参契约，单测直调时靠可选参数省略不写，要逐个改调用方和测试；另外 build 相位改传真实战斗时间后，战斗时间不是 180 时 converge 之前的轮次会变（与 r723 诺姆 / 莱卡恩同类的修正），而 zd 的 5 个场景都是 180，量不出来，需要单独做探针归因。→ r726 已做，范围扩到全部 20 处，探针归因见 §4.3。

**下一个可移出的候选：目录 JSON 的技能表。** r724 核过 `catalog.json` 的 `agentSkills`：62 个角色 / 310 个分类 / 1352 个招式 / 7455 行，`categories`、`SkillCategory.id` / `moves`、`SkillMove.rows`、`SkillRow.id` / `kind` / `values` 一个不缺。validate:data 本来就读 catalog.json，补上这些键的校验，就能移出 `AgentSkills` / `SkillCategory` / `SkillMove` / `SkillRow`（约 20 处）。`BuffGroup` / `BuffEffect` / `TeammateBuff*` 来自 catalog 与 teammate-buffs.json，要另核。→ r725 已做，范围扩到全部 JSON 入口，并改成按类型自动校验、不再手抄键清单（§4.2）。

### 4.2 r725：JSON 类型契约，信任边界清零

**做法**（`766a04a0`）：

- 代码对 JSON 的转型只有两种形态：catalog store 的 5 个 `res.json() as T`，以及 specs / 队伍预设 / 轴预设经 `import.meta.glob` 后 `as T`。`scripts/lib/json-contract.mjs` 的 `JSON_CONTRACTS` 把这 8 个入口和代码转型用的类型登记在一张表里。
- validate:data 用 TS 类型检查器解析出的类型递归校验数据：
  - 必填属性必须在；string / number / boolean / 字面量 / null 按值核；数组、元组逐元素；索引签名核未声明键的值。
  - 联合按「值的种类相容 + 判别属性一致」选分支，任一分支全过即过，报错时报判别属性对上的那个分支。
  - any / unknown 不核；多余键不报（与 TS 结构类型一致）；函数类型属性跳过。
- 防绕过：`findUncoveredJsonEntries` 扫 src 非测试代码里的 `fetch('/static/*.json')` 与 `import.meta.glob('*.json')`，漏登记即红。静态 `import x from '….json'` 不算入口：开了 resolveJsonModule，TS 按文件内容推断类型（如 enginePools.json）。浏览器存储与文件导入（逻辑编辑器、persistedRef）都过解析函数。
- 自证：内存小程序（noLib）里合法样例零报错，反例逐类命中（必填缺失、原始类型错、字面量越界、判别联合分支、null、元组、模板字面量索引签名）。
- 成本：validate:data 约 1 s → 2 s（建 program 0.8 s，校验 193 个文件不到 0.3 s）。

**首跑查出 31 个键与声明不符**（r724 的手写清单一个都没覆盖到），逐条改真：

| 处理 | 键 | 实况 |
|---|---|---|
| 类型改可选 | `SkillRow.label` | 7455 行里 3462 行不带 |
| 类型改真 | `statDisplay[*].label` | 声明 LocalizedString，60 条全是 string；`useStatLabel` 的兼容分支随删 |
| 类型改可选 | `WEngine.attribute` / `images` / `sources` | 83 把里分别有 48 / 17 / 4 把不带 |
| 类型改判别联合 | `BuffEffect` | derived / formula 的 78 条没有 value；fixed 恒有 value，stacked 恒有 valuePerStack / maxStacks / defaultStacks（398 条全核） |
| 类型改可选 | `BuffGroup.scope` | 驱动盘 4 件套有 29 组不带 |
| 类型改可选 | `SkillCategory.levelRange` | 1611 / 1621 的 10 个分类不带 |
| 类型改可选 | `DriveDiscSet.twoPiece` | 31900 原始朋克不带；hpSourceBreakdown / DebugPage 两处读点原来会抛错，已判空 |
| 类型放宽 | `EffectTarget.kind` | 10 条是 'anomaly'；这些效果的 stat 本身已是异常专属，引擎不按 kind 分派 |
| 类型删字段 | `Boss.level` / `defense` / `resistance` | catalog.bosses 7 条全无，也无人读 |
| 类型删字段 | `ArchiveRoom.id` | run-archive.json 的 rooms 以房间 id 为键、条目不带；标签兜底链里的 `room?.id` 永远为空，随删 |
| 类型改可选 | `BuildSubstat.priority`、`BuildDriveDiscSet.desc2_en / desc4_en` | 1631 不带 |
| 类型放宽 | spec `ResourceRuleSpec.countSource` | 1571 `holdSeconds`、1611 `none` ×3、1621 `windEnergyConsumed`：手写模块角色的说明性取值，spec 资源通道不解析（落 default 计 0），类型注释写明 |
| 数据归一 | `SkillMove.actionTime: null` ×40、`BuffGroup.condition: null` ×12 | null 与缺省同义，删键；`statRules.calculation.outOfCombatEffectFilter.condition: null` 由 r5DataInvariants 钉住，不动 |
| 数据补齐 | 14126 淬锋钳刺一条效果的 `coverage` | 只有 default；补 min 0 / max 1 / step 0.1，与其余 236 条一致 |
| 数据改正 | build-recommendations 1551 / 1591 的 `strategy` | `{}` 改 `[]` |
| 数据补齐 | spec 1081 的 2 个 events、4 个 verifications | 缺 name / status；补名，status 事件取 implemented_approximation（同 spec 总状态），核对记录取 implemented（文档型记录） |
| 数据改正 | spec 1151 `additionalAbility: null` | 删键（类型本就可选） |
| 数据改正 | spec 1481 countSource `combatTime` | 改 `battleTime`：同义、引擎认得的词；琉音走手写模块，数值不变 |

**随后**：

- 判据 28 删除 `DEAD_NULLISH_TRUST_BOUNDARY`（59 → 0），判据行不再报豁免数，detector 自证去掉豁免例。
- 同口径 codemod（`calc-arch/g725/fixnullish.mjs --policy=all`）删读点死兜底 59 处 / 34 个生产文件（含嵌套第二轮 2 处），`.vue` 按同口径手删 6 处（可选链上的不动）。
- 判别联合让几处分支不可达，一并删：hpSourceBreakdown 的「无 type 按 fixed」分支与末尾兜底；inCombatBuffs 对 stacked 的 value 缩放（stacked 只读 valuePerStack）；DebugPage 叠层的 `?? maxStacks ?? 1`。
- validate:data 去重：r724 手写的 Boss 预设标量字段、轴预设逐动作字段，以及队伍预设逐文件的 id / team 形状检查，都由契约覆盖，删掉。检查数 368 → 161，其中 210 条是队伍预设逐文件的两条形状检查。类型表达不了的语义留下：每个预设至少一个相位；三张抗性表（声明为 `Record<string, number>`）六个元素齐；轴 axes / plans 至少其一；动作槽位是整数。
- 测试：cc337 / multiplierCoefficients 的夹具补必填键（值 = 原兜底）；删 teammateBuffDerivation「组内 buffs 缺失」用例（不可能输入，4508 → 4507）与 findMoveById「分类缺 moves」断言；statModeParity 的 DebugPage 源码锚点随调用形态更新（数值列改走 `effectValue(e)`）。
- 数值：zd DUMP 0 / ROWS 0。

**反例实测**（改坏一处 → validate:data 报红并指到类型字段 → 从备份还原，md5 核对）：

| 改坏 | 报 |
|---|---|
| catalog 删一个招式的 rows | `SkillMove.rows` 缺失 |
| catalog 删一条 fixed 效果的 value | `FixedBuffEffect.value` 缺失 |
| teammate-buffs 删一条 stacked 效果的 valuePerStack | `StackedBuffEffect.valuePerStack` 缺失 |
| teammate-buffs 把效果 type 写成 bogus | `…BuffEffect.type` 不符 |
| spec 1081 删 event 的 name | `EventSpec.name` 缺失 |
| 轴预设把动作 count 改成字符串 | `StunAxisAction.count` 应为 number |
| boss-presets 删 monster.stunVuln | `BossPresetMonster.stunVuln` 缺失 |
| boss-presets 删一张抗性表的 fire | 语义检查报该相位 |
| run-archive 删一条 run 的 team | `ArchiveRun.team` 缺失 |
| src 新增 `fetch('/static/zz-new.json')` | 未登记的 JSON 入口 |

**回退**：`git revert 766a04a0`（文档另提交）。豁免表与兜底会一起回来，彼此一致。

### 4.3 r726：战斗时间单一来源（r6 §8.0 #28 ④）

**结论**：生产代码（src 非测试）里，当战斗时间用的 180 只剩 `stores/config.ts` 的 `defaultEnemy.battleTime` 一处。

- 函数入参上的 180 缺省与兜底全部改成必填。
- build 相位改传真实战斗时间。
- 般岳闪能、仪玄异常回闪上限改按战斗时间算。

提交 `866b5ef8`。

**范围**：§4.1 末表列了 6 处。全量 grep 后，作为战斗时间的字面量 180 共 20 处，另有 difficultyRatio 的 `?? rr.totalTime` 一处，分四类：

- 入参缺省
- 兜底
- 模块常量
- 输入框上限

**做法**：

- 先把入参改必填，用 vue-tsc 找调用方。
  - 生产代码零报错，说明生产调用方本来就都传了真实值；缺省只被单测和 build 相位用到。
- 测试按位置补参。
  - 般岳的 `computeBanyueRageCycle` 在命座之后插入 `battleTime`。原第 9 个参数起都是数字，插参后类型照样对得上，漏插会静默错位。
  - 所以不靠 tsc 报错，按位置用 codemod 插了 26 处。

**清单**（22 个生产文件）：

| 位置 | 原写法 | 现在 | 生产行为 |
|---|---|---|---|
| `core/effectiveTime.ts` | `TimeBasisCfg` 两字段可选，`?? 180` / `?? 0` | 拆成 `InvincibleBasis`（只要无敌时间）与 `TimeBasisCfg`（两项），字段都必填 | 不变：调用方传的是 cfg 或 store 的 enemy |
| `composables/difficultyRatio.ts` | `RatioEnemyLike` 可选；形参默认 `{}`；`?? rr.totalTime` | 必填，无默认 | 不变：两处调用方都传 store 的 enemy |
| `resourceCalc/panelPhases.ts` 派发器 ×2 | `params.combatTime ?? 180` | `AgentTeamRoundInput` 里的 `combatTime` 必填；`collectNextRoundFeedback` 同样必填 | build 相位改用真实战斗时间（见下文数值） |
| `useResourceCalc.ts` 的 build 相位 | 不传 combatTime | 传 `enemy.battleTime` | 同上 |
| `mechanics/agents/lighter.ts` | `opts?.combatTime ?? 180`；build 相位写死 `combatTime: 180` | opts 必填；build 相位用钩子给的 combatTime | 同上 |
| `teamVeil.ts` / `zhao.ts` | 形参默认 `combatTime = 180` | 必填 | 不变：convergence 传 `base.totalTime` |
| `billy.ts` / `evelyn.ts` 的 `compute*Cycle` | `battleTime?` + `Number.isFinite(…) ? … : 180` | 必填 | 不变：读 `cfg.battleTime`。伊芙琳的面板调用只读三项覆盖率，战斗时间按 0 占位 |
| `stunWindows.ts` 的 `stunWindowCoverage` | 入参 `unknown`；`\|\| 0` / `\|\| 180` | 入参 `number` | 不变：派发器给的是 number |
| `rowBuild.ts`、`resourceIncome.ts` ×3、`AnomalyPoolInput.totalTime` | 形参默认 `totalTime = 180`（resourceIncome 连带前面的 `chainCountTotal = 0` 等） | 必填 | 不变：生产调用方都传了 |
| `luciaElowen.ts` 的 `computeLuciaCurtainTriggers` | 后三个形参有缺省，含 `totalTime = 180` | 必填；外部直调的回退路径传 `cfg.battleTime` | 不变：探针证实回退路径在流水线里走不到 |
| `remielle.ts` 的反馈钩子 | `teamResult?.totalTime ?? 180` | 读钩子入参 `combatTime` | 不变：两者都等于 `enemy.battleTime` |
| `banyue.ts` | `FLASH_INCOME = 2 * 180 + 60` | 闪能 = 2/s × 战斗时间 + 60。`computeBanyueRageCycle` 增加 `battleTime` 入参；补齐入参增加 `InteractionTopUpInput.battleTime`，由 convergence 传 `base.totalTime` | 战斗时间 ≠ 180 时会变（见下文数值） |
| `yixuan.ts` | `ANOMALY_TRIGGER_MAX = floor(180 / 10)` | `floor(战斗时间 / 10)` | 预设库里没碰到上限，未见变化 |
| `AttributeConfigPage.vue` | 无敌时间输入框 `max: 180` | 上限取 `enemy.battleTime`，与结果页同口径 | 只影响输入上限 |

**数值归因**：

- 战斗时间 180：用 zd 的 5 个场景比对，DUMP 0 / ROWS 0。
- 战斗时间 ≠ 180：用临时探针比对，探针不入库，脚本在 `calc-arch/g726/dumpbt.perf.ts`。
  - 跑 zd 同一套 104 个预设 × 5 种变体；每个预设落定后把 `enemy.battleTime` 设成目标值，逐角色哈希。
  - 基线 = `ba8416c0`。先用基线对基线跑一次，0 / 520，确认探针本身可复现。

| 战斗时间 | 变化 | 范围 |
|---|---|---|
| 150 | 30 / 520 键 | 6 个般岳队 × 5 种变体，总伤 −18.7% ～ +8.3% |
| 150，般岳闪能临时钉回 180 | 0 / 520 | 说明上一行的变化全部来自般岳闪能 |
| 90 | 30 / 520，同 6 队 | −25.1% ～ −5.5% |
| 240 | 30 / 520，同 6 队 | −6.1% ～ +10.1% |

- **其余改动在三种战斗时间下都没有让任何队伍变化**：
  - build 相位写入的值会在 converge / postRound 相位被重算覆盖，例如莱特的 5 队，以及照、爱芮、叶瞬光、千夏所在的队。
  - 卢西娅帷幕的回退路径在流水线里走不到：不含般岳的 19 个卢西娅队都没变。
  - 仪玄 6 队的异常回闪次数没有到上限。
- **般岳的变化是修正**：
  - 原来扫描战斗时间（impactVars 的 totalTime 轴）时，闪能恒按 180 秒算。现在战斗短则闪能少、连段少，伤害下降；战斗长则相反。
  - 个别变体方向相反，例如 240 秒时扳机队的「交互加码」变体为 −6.1%。原因是闪能多了连段就多，要占的前台时间也多，在固定的时间账里会挤掉别的动作。

**测试**：

- 签名随改 14 个测试文件。
- 12 个测试文件的桩原来靠 `?? 180` / `?? 0` 取值，补上 `battleTime: 180` / `invincibleTime: 0`，取原兜底值。
  - 伊德海莉「寒冰触手需额外能力」这条反向用例也一并补上，否则它会因 NaN 而碰巧通过。
- 删 3 条专测兜底的断言：
  - `effectiveBattleTime({})` = 180；
  - `stunWindowCoverage` 的非有限输入回落；
  - `stunWindowCoverage` 的 0 秒回落 180。
- 补 1 条战斗时间 150 的分母断言。
- 用例数不变：524 / 4507。
- 改到锚定函数的 @fact 有 4 条，逐条复核后仍成立，据链各追加 `·复核@2026-10-07`：
  - `engine:操作难度/非失衡占比数据源`
  - `engine:time/无敌≠秽盾`
  - `engine:banyue/补齐时间上限`
  - `agent:1491/帷幕计数`

**没做**：

- 般岳补齐的时间上限 `AUTO_TOPUP_TIME_LIMIT_SEC = 200`。
  - 注释写的是「战斗只有 180 秒，少量合轴吸收不了 20 秒以上的净超出」，按理也随战斗时间变。
  - 但这是用户 2026-09-01 定的数（@fact 锚定）。推广成「战斗时间 + 20」等于改用户口径，记入 §8。
- 其他同类防御写法，例如 trigger / rina / zhendou 里套在必填 number 上的 `Number(x) || 0`。它们不是 180，判据 28 也不管，归入 §8 已有条目。

**回退**：`git revert 866b5ef8`（文档另提交）。

## 5. 判据 28（`scripts/lib/dead-nullish-gate.mjs`）

- **规则**：同 §2。
  - 扫描范围：src 非测试 `.ts`。不含 `.d.ts`、`*.test.ts`、`*.perf.ts`、`__tests__/`、`src/test/`。
  - 2026-10-07 共扫 296 个文件。反空洞下限是 250。
  - 硬门为 0。
- **program**：取 `tsconfig.app.json` 里的 .ts 文件，与 vue-tsc 同一份编译选项。`.vue` 不扫，因为要 vue-tsc 的类型信息。
- **detector 自证**：在内存里建一个 noLib 小程序，约 30 ms。必填、可选、含 undefined、可选链、索引签名、元素访问、标识符、收窄、调用结果、注释各覆盖一例。命中行必须恰好是 8、14、17、18（r725 删豁免表，豁免例随删）。
- **反空洞实测**：把 `aire.ts` 换回本轮之前的版本，门报 9 处（`cfg.battleTime ?? 180` ×2、`initialEnergyGift ?? 0`、`initialDecibelGift ?? 0` ×2 等）；换回后为 0。
- **成本**：check-guards 从 14.4 s 增至 16.3 s；`checkGuards.test` 从 31 s 增至 34 s，因为它会跑全部判据。
- **报错时怎么改**：
  - 值确实总在：删掉 `?? 默认值`。默认值只留在源头，即 store 默认、`buildCharConfig` 或 `emptyPanel`。
  - 值真的可能缺：把字段改成可选（加 `?`），让每个读点都看见。
  - 不要换成 `||`、三元或 `=== undefined` 来绕门，那是同一个谎换了个写法。
  - 值来自 JSON：没有豁免（r725）。字段真会缺就改类型，validate:data 的契约校验会报数据实况；新的 JSON 入口登记进 `scripts/lib/json-contract.mjs` 的 `JSON_CONTRACTS`。浏览器存储与文件导入走解析函数。

## 6. cfg 契约与战斗时间单一通道

**改为必填的 19 个字段**，均由 `buildCharConfig` 恒写，且值不会是 undefined：

| 分组 | 字段 |
|---|---|
| 战斗与敌方 | `battleTime`、`invincibleTime`、`bodySize` |
| 互动次数 | `blockCount`、`dualCounterCount`、`tauntCancelCount` |
| 反制支援（5 个） | `counterAssistMoveId`、`counterAssistActionTime`、`counterAssistDecibelRecovery`、`counterAssistComboAlignRatio`、`counterAssistCount` |
| 炮塔转子（2 个） | `cannonRotorDamageMultiplier`、`cannonRotorCooldownSeconds` |
| 其他 | `zhenyuanTriggerCount`、`moveActionTimes`、`resourceUtilization`、`exSpecialCostType`、`decibelRecoveryByMoveId`、`energyRecoveryByMoveId` |

`outOfCombatPanel` 和 `basicBenchmarkMoveId` 也恒写，但写入的值可能是 undefined，所以保留可选。

试改后 vue-tsc 只在 `helpers.ts` 报这两个字段，说明测试里没有人用带类型标注的残缺字面量来构造 cfg。测试里的 cfg 都是 `as any` 或 `as unknown as`，这些地方要靠跑测试才能发现。

**战斗时间单一通道（消费 r6 §8.0 #13）**：

- **原状**：比利、诺姆、莱卡恩各自抄一份私有副本。
  - `billyBattleTime`：在 `buildCharConfig` 当场抄写。
  - `normaBattleTime`、`lycaonTotalTime`、`lycaonInvincibleTime`：只在 converge 阶段写入，此前读到的是 180 / 0。
- **现状**：
  - 三个模块直接读 `cfg.battleTime` / `cfg.invincibleTime`。
  - 诺姆的 `|| 180` 和 `prev.battleTime ?? 180` 一并去掉。
  - 钩子入参 `combatTime` 保留：anby、corin、harumasa 等模块仍在读。它与 `cfg.battleTime` 同源于 `configStore.enemy.battleTime`，两者都是必填，都没有兜底。r726 起 build 相位也传真实值，派发器不再补 180（§4.3）。
- **数值**：
  - 主页没有战斗时间输入，23 个预设都是 180，所以正常计算逐位不变（zd 0/0）。
  - 只有 impactVars 扫描 battleTime 轴、把它改成非 180 时，诺姆 / 莱卡恩在 converge 之前的轮次会改用真实战斗时间。这是修正，不是回归。

## 7. 测试夹具

很多测试直接调钩子，传的是残缺对象，例如 `cfg: {}`、`panel: { anomalyMastery: 100 }`、`state: {}`，原来全靠模块里的兜底取到值。改法：

- **夹具补齐钩子读到的必填字段**，值等于被删兜底的值（多数是 0，`battleTime` 是 180），断言不变。共 20 个测试文件。
  - 面板优先用 `{ ...emptyPanel(), … }`。
  - 断言绝对值、而 emptyPanel 初值非 0 的字段（如 `critDmg` 初值 50）要显式写 0。
- **删除 4 处专测「不可能输入」的断言**：
  - R19、R20 里缺 `count` 的执行行；
  - `supplySecondsPerUnit` 里缺 `ultimateActionTime` 返回 0 的用例；
  - onStunBuildup 的「面板缺字段不出 NaN」；
  - `supplySecondsPerUnit` 源码锁里数 `ultimateActionTime ??` 出现次数的那条，现在 0 处，并由判据 28 管。
- 用例数不变：524 文件 / 4509 例。

## 8. 不做的事与重开条件

| 事项 | 不做的原因 | 重开条件 |
|---|---|---|
| 恢复信任边界豁免表 | r725 已删：JSON 入口全部由类型契约校验（§4.2），类型可信 | 出现 TS 管不到又登记不进契约表的新入口时，先让它走解析函数，不恢复豁免表 |
| spec 的三个说明性 countSource 取值（holdSeconds / none / windEnergyConsumed） | 只出现在手写模块角色（1571 / 1611 / 1621），spec 资源通道不算它们；收进引擎词表等于为不走这条通道的数据写解析 | 这些角色改走 spec 资源通道时 |
| `BuffGroup.scope` 缺省时读点口径不一（收集器按局内，hpSourceBreakdown 的 hpPhase 按局外） | 缺 scope 的 29 组里没有生命类效果，当前不影响数值 | 缺 scope 的组出现生命类效果时；或统一时顺手把 29 组补上 scope |
| 般岳补齐时间上限 `AUTO_TOPUP_TIME_LIMIT_SEC = 200`（= 180 + 20 秒余量）不随战斗时间 | 用户 2026-09-01 定的数（@fact `engine:banyue/补齐时间上限`），推广成「战斗时间 + 20」要改用户口径；r726 已让般岳闪能随战斗时间，战斗时间上只剩这一处 | 用户确认推广；或战斗时间扫描里出现补齐被误判非法 |
| 同类防御写法：`x != null`、`=== undefined`、`typeof x === 'number'`、`Number.isFinite(x)`，以及套在必填 number 上的 `Number(x)`、`\|\| 默认值` | 语义各有差异（`\|\|` 会吃掉 0），本门只管 `??` | 出现「为绕门改写法」的提交，或这类写法成批出现 |
| `.vue` 里的 `??` | 需要 vue-tsc 的类型信息，普通 TS program 拿不到 | 展示层出现同类事故时，再考虑用 vue-tsc language service 扫 |
| codemod 留下的属性别名（`const dmgBonus = p.dmgBonus` 等 53 处） | 命名读起来有用；只内联了纯改名的别名（jane、千夏、stunAxis） | 无 |

另外，诺姆 / 莱卡恩剩下的私有字段（`normaStunCount`、`lycaonStunCount` 等）是「本轮失衡次数」，确实只在 converge 才有值，「字段为 undefined = 契约没接上」是有意的编码，不属于本类。
