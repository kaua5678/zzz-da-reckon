# 死兜底普查与判据 28（r723；r724 收窄信任边界）

> 范围：src 非测试 `.ts` 里「左侧类型不含 null / undefined 的 `a ?? b`」。工具：TS 类型检查器（不是正则）。
> 提交：`7cb3f8c8`（清理 + cfg 契约）、`6e534cae`（战斗时间单一通道）、`587e767e`（判据 28）。
> r724：store 用户态与轴移出信任边界（`0d699bb8`），写入方清点见 §4.1。
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
| **外部数据类型**（见 §4） | 126 | 126（r724 后 59） | 信任边界豁免；r724 移出 store 用户态与轴（§4.1） |

- 删除总数 800：其中 93 处 `Number(x ?? d)`（x 为 number）连同 `Number()` 一起删，括号也一并去掉。
- 嵌套 `a ?? b ?? c` 分两轮删，第二轮 4 处。
- 删完后 vue-tsc 只报 7 个 TS6133，都是「只在兜底里用到的参数或常量」，已一并删除：
  - `calcEnergyRegenTotal` 的 `defaultBase`：4 个调用点不再传 1.2，`energyRegen` 的默认值 1.2 只留在 `emptyPanel`。
  - 般岳的 `DEFAULT_DODGE` / `DEFAULT_PARRY` / `DEFAULT_BLOCK` / `DEFAULT_DUAL`：真正的来源是模块的 `interactionDefaults`，「用户确认」的注释已挪过去。
  - 琉音 supply 的 `totalTime`。
  - 伊德海莉 applyTeamConfig 的 `team`。

## 4. 信任边界（判据 28 的豁免表 `DEAD_NULLISH_TRUST_BOUNDARY`）

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

这些留给下一轮，见 r6 §8.0 #28 ④。本轮不做的原因：它们是函数入参契约，单测直调时靠可选参数省略不写，要逐个改调用方和测试；另外 build 相位改传真实战斗时间后，战斗时间不是 180 时 converge 之前的轮次会变（与 r723 诺姆 / 莱卡恩同类的修正），而 zd 的 5 个场景都是 180，量不出来，需要单独做探针归因。

**下一个可移出的候选：目录 JSON 的技能表。** r724 核过 `catalog.json` 的 `agentSkills`：62 个角色 / 310 个分类 / 1352 个招式 / 7455 行，`categories`、`SkillCategory.id` / `moves`、`SkillMove.rows`、`SkillRow.id` / `kind` / `values` 一个不缺。validate:data 本来就读 catalog.json，补上这些键的校验，就能移出 `AgentSkills` / `SkillCategory` / `SkillMove` / `SkillRow`（约 20 处）。`BuffGroup` / `BuffEffect` / `TeammateBuff*` 来自 catalog 与 teammate-buffs.json，要另核。

## 5. 判据 28（`scripts/lib/dead-nullish-gate.mjs`）

- **规则**：同 §2。
  - 扫描范围：src 非测试 `.ts`。不含 `.d.ts`、`*.test.ts`、`*.perf.ts`、`__tests__/`、`src/test/`。
  - 2026-10-07 共扫 296 个文件。反空洞下限是 250。
  - 硬门为 0。
- **program**：取 `tsconfig.app.json` 里的 .ts 文件，与 vue-tsc 同一份编译选项。`.vue` 不扫，因为要 vue-tsc 的类型信息。
- **detector 自证**：在内存里建一个 noLib 小程序，约 30 ms。必填、可选、含 undefined、可选链、索引签名、元素访问、标识符、收窄、调用结果、豁免、注释各覆盖一例。命中行必须恰好是 10、16、19、20，豁免计数必须是 1。
- **反空洞实测**：把 `aire.ts` 换回本轮之前的版本，门报 9 处（`cfg.battleTime ?? 180` ×2、`initialEnergyGift ?? 0`、`initialDecibelGift ?? 0` ×2 等）；换回后为 0。
- **成本**：check-guards 从 14.4 s 增至 16.3 s；`checkGuards.test` 从 31 s 增至 34 s，因为它会跑全部判据。
- **报错时怎么改**：
  - 值确实总在：删掉 `?? 默认值`。默认值只留在源头，即 store 默认、`buildCharConfig` 或 `emptyPanel`。
  - 值真的可能缺：把字段改成可选（加 `?`），让每个读点都看见。
  - 不要换成 `||`、三元或 `=== undefined` 来绕门，那是同一个谎换了个写法。
  - 外部数据的新类型：加进信任边界表，并写清数据从哪来。先确认它真是外部数据：清点写入方，只有 TS 管不到的 JSON、文件或浏览器存储才算（r724 的教训：store 状态曾被误列，见 §4.1）。

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
  - 钩子入参 `combatTime` 保留：anby、corin、harumasa 等模块仍在读。它与 `cfg.battleTime` 同源于 `configStore.enemy.battleTime`，两者都是必填，都没有兜底。
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
| 外部数据类型上的 59 处（r723 为 126，r724 移出 store 用户态与轴） | 见 §4 | 某数据源加了读入规整或校验，就把对应 owner 移出豁免表；门会列出变成死代码的兜底，逐个删。下一个候选是目录 JSON 的技能表（§4.1 末段） |
| 函数入参上的战斗时间默认 180（6 处，§4.1 末表） | 不是数据类型上的死兜底，门管不到；build 相位改传真实战斗时间会改变非 180 场景的 converge 前轮次，要探针归因 | 自选时做（r6 §8.0 #28 ④） |
| 同类防御写法：`x != null`、`=== undefined`、`typeof x === 'number'`、`Number.isFinite(x)`，以及套在必填 number 上的 `Number(x)`、`\|\| 默认值` | 语义各有差异（`\|\|` 会吃掉 0），本门只管 `??` | 出现「为绕门改写法」的提交，或这类写法成批出现 |
| `.vue` 里的 `??` | 需要 vue-tsc 的类型信息，普通 TS program 拿不到 | 展示层出现同类事故时，再考虑用 vue-tsc language service 扫 |
| codemod 留下的属性别名（`const dmgBonus = p.dmgBonus` 等 53 处） | 命名读起来有用；只内联了纯改名的别名（jane、千夏、stunAxis） | 无 |

另外，诺姆 / 莱卡恩剩下的私有字段（`normaStunCount`、`lycaonStunCount` 等）是「本轮失衡次数」，确实只在 converge 才有值，「字段为 undefined = 契约没接上」是有意的编码，不属于本类。
