# 死兜底普查与判据 28（r723）

> 范围：src 非测试 `.ts` 里「左侧类型不含 null / undefined 的 `a ?? b`」。工具：TS 类型检查器（不是正则）。
> 提交：`7cb3f8c8`（清理 + cfg 契约）、`6e534cae`（战斗时间单一通道）、`587e767e`（判据 28）。
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
| **外部数据类型**（见 §4） | 126 | 126 | 信任边界豁免 |

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
- 判据行公示豁免数（当前 126）。

| 类别 | owner | 处数 | 数据从哪来 | 移出条件 |
|---|---|---|---|---|
| store 用户态 | `CharacterConfig`、`EnemyConfig`，以及 `stores/config.ts` 的匿名类型 | 38 + 20 + 1 | 队伍预设 JSON、分析场景 `initialState` 克隆、旧存档迁移 | 读入处（setAgent / applyTeamPreset / initialState）补齐全部缺省，并有测试锁住 |
| 用户轴 | `StunAxis`、`StunAxisAction`、`AxisLike`、`AxisActionLike` | 8 | 轴编辑器和预设轴写入 store，`count` / `actions` 可能缺 | 轴读入时规整（缺 count 补 1、缺 actions 补 []） |
| 目录 JSON | `AgentSkills`、`SkillCategory`、`SkillMove`、`SkillRow`、`BuffGroup`、`BuffEffect`、`TeammateBuffGroup`、`TeammateBuff`、`AgentCombatBuffs`，以及 `types/catalog.ts`、`stores/catalog.ts`、`data/moveTableQueries.ts` 的匿名类型 | 42 + 6 | `public/static/*.json`，运行时 fetch | validate:data 校验对应键必有；或 catalog store 加载时规整 |
| Boss 预设 / 期数 | `BossPreset`、`PhaseBuffCard`、`TimelineAxisNode` | 6 | boss-presets.json；`TimelineAxisNode.date` 取自 `PeriodAxisNode.begin` | 同上（validate:data 或加载时规整） |
| 存档导入 | `ArchiveRun`、`ArchiveRunMember` | 4 | 用户提供的文件 | 导入时规整（这一类大概率应该一直豁免） |
| spec JSON | `TeamBuffSpec` | 1 | `src/specs/agents/*.json` | validate:specs 校验 `coverage` 必有，或类型改为可选 |

**`EnemyConfig` 最接近可以移出。** 它的写入方：

- `defaultEnemy`；
- `applyBossPreset`：23 个预设的 `defaults.battleTime` 全是 180；
- `setEnemy`：调用方是 impactVars 扫描和属性页，属性页已带 fallback；
- `initialState` 克隆。

但 `ensureResistanceTables` 仍在兼容旧版单表抗性（`enemy.resistances`），要先确认旧存档路径已不存在。移出后，门会列出 store 边界上 5 处 `.ts` 里的 `configStore.enemy.battleTime ?? 180`（外加 difficultyRatio 的 `?? rr.totalTime`）；`.vue` 里还有 1 处（TeamComparePage），门扫不到，要手删。删完之后，180 只留在 `defaultEnemy`。

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
  - 外部数据的新类型：加进信任边界表，并写清数据从哪来。

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
| 外部数据类型上的 126 处 | 见 §4 | 某数据源加了读入规整或校验，就把对应 owner 移出豁免表；门会列出变成死代码的兜底，逐个删 |
| 同类防御写法：`x != null`、`=== undefined`、`typeof x === 'number'`、`Number.isFinite(x)`，以及套在必填 number 上的 `Number(x)`、`\|\| 默认值` | 语义各有差异（`\|\|` 会吃掉 0），本门只管 `??` | 出现「为绕门改写法」的提交，或这类写法成批出现 |
| `.vue` 里的 `??` | 需要 vue-tsc 的类型信息，普通 TS program 拿不到 | 展示层出现同类事故时，再考虑用 vue-tsc language service 扫 |
| codemod 留下的属性别名（`const dmgBonus = p.dmgBonus` 等 53 处） | 命名读起来有用；只内联了纯改名的别名（jane、千夏、stunAxis） | 无 |

另外，诺姆 / 莱卡恩剩下的私有字段（`normaStunCount`、`lycaonStunCount` 等）是「本轮失衡次数」，确实只在 converge 才有值，「字段为 undefined = 契约没接上」是有意的编码，不属于本类。
