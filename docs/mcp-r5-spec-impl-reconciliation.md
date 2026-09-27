# R5 · 规格-实现对账（catalog.json 字段 × 引擎读取）

> lead-arena-0925c · 2026-09-27 第 119 轮起 · 需求原文：`docs/REQUIREMENTS.md` R5。
> 本文件既是差异清单，也是 R5 的进度账本（§6）。

## 0. 判据与硬约束（照抄 R5，写在最前面防止跑偏）

- 判据是「**引擎实现是否符合数据规格**」，**不是**「数值是否接近游戏」。**不引入实测，不拿更接近投稿当验收理由。**
- 数据（nanoka / gachabase 爬取 + 用户口述）**可信，不需要验证**。要查的是引擎有没有按数据的规格去实现。
- 发现差异**先登记**，不顺手改数值；修复走正常 CC 卡流程，零差要求不变（有意的数值变动要在卡里说明）。
- 优先查两类：**零读取**（数据写了，引擎不看）、**读了但语义不同**。
- 已知起点：`basis` 字段被 catalog 效果标注，但引擎不读（CC-96，census §5.103）。

## 1. 方法（第 1 刀：粗筛）

- 脚本 `.zc/perf/r5scan.mjs`（`.zc/` 不进 git；丢失时按本节重写，约 50 行），输出 `.zc/perf/r5scan.out`。
  复跑：在仓库根执行 `node .zc/perf/r5scan.mjs > .zc/perf/r5scan.out`。
- 做法：
  - 递归遍历 `public/static/catalog.json`，收集全部字段名，共 **215 种**。数字键和带空格的数据表头（如 `Energy Cost`）不算字段。
  - 对每种字段名，在 `src/` 的非测试、非 `types/`、非 `.d.ts` 的 `.ts` / `.vue` 里（先去掉注释）统计两个数：
    - **属性访问**：`.key`、`?.key`、`['key']`；
    - **总提及**：独立标识符 `key`。
- 结果：284 个文件；**61 种零属性访问，其中 36 种零提及**。

**粗筛的局限（核实时必须逐条排除）**：
- **假零**：数据经过解构（`const { stackGroup } = e`）、展开（`...effect`）、改名映射，或在 loader 里转成别的字段，都会被漏计。
  「零提及」基本排除了解构，但仍可能有动态键访问。
- **假非零**：同名字段属于别的对象。例如 `basis` 有 6 处属性访问（`resourceCalc/damagePool.ts` 2 处、`FinalPanel.vue`、`DebugPage.vue`），
  但 CC-96 读码确认引擎**不读 catalog 效果的 basis**。同名不等于读的是这个字段。
- 所以**本节只产出候选，结论必须逐条读码得出**（§3 的「状态」列）。

## 2. 字段分类框架（验收要求「覆盖全部字段类型」）

215 种字段分三类，第 2 刀要为每种字段填上类别：

| 类别 | 含义 | 对账要求 | 例 |
|---|---|---|---|
| **S 规格字段** | 决定数值或计算行为 | 必须查清「读不读、怎么读、读得对不对」 | `stat` `value` `mode` `scope` `target` `coverage` `condition` `basis` `stackGroup` `valuePerStack` `maxStacks` `durationSeconds` `buffModifiers` `sourceStat` `formula` `skillTargets` `targetSkillType` `damageBasis` `appliesToOutOfCombatPanel` `exclusiveGroup` `cooldownSeconds` `settlementType` `statRules.calculation.*` |
| **D 展示字段** | 只用于界面显示 | 只登记「展示用」，不查计算 | `zhCN` `en` `label` `name` `description` `icon` `images` `stackLabel` `conditionLabel` `display` |
| **M 元数据** | 来源、校验、版本、出场记录等 | 登记后不查 | `sources` `verification` `url` `legacyIds` `gameVersion` `encounters` `appearances` `modelingNotes` `$schema` `version` |

⚠ 归类本身要读数据确认。例如 `verification.level60Stats` 看起来像元数据，但也可能是引擎应该读的 60 级面板。拿不准的一律按 S 处理。

## 3. 零读取候选（第 1 刀产出，全部待核）

按「catalog 出现次数 × 语义风险」排序。「访问 / 提及」是粗筛计数。

| # | 字段 | 所在 | catalog 出现次数 | 访问 / 提及 | 疑点（待核） | 状态 |
|---|---|---|---|---|---|---|
| Z1 | `damageBasis` | agentSkills 的倍率行 | 2490 | 0 / 4 | 伤害按什么属性结算（攻击 / 生命 / 防御 / 贯穿力等）。引擎若按别的来源判定，就要核对两者是否一致 | **已核：导入合成字段；引擎按 specialty 决定，1611 一致，命破 5 人与字段值不符但字段不是规格**，见 §7 D6 |
| Z2 | `appliesToOutOfCombatPanel` | 音擎 selfBuff / teamBuff | 95 | 0 / 0 | 这条 buff 是否计入局外面板。引擎完全不读，靠别的逻辑决定，**与 basis 问题同源** | **已核：无差异（冗余字段）**，见 §7 D1 |
| Z3 | `durationSeconds` | 音擎 / 驱动盘 / Boss 效果 | 80 | 1 / 3（只有 piper.ts） | 持续时间。引擎可能用 `coverage`（覆盖率）代替。要确认两者口径是否一致，还是持续时间被忽略了 | **已核：默认 100% 与数据约定一致；28 个 fixed 且无 coverage 的效果没有滑块 = 潜在差异（UI）**，见 §7 D7 |
| Z4 | `stackGroup` | 效果 | 23 | 0 / 0 | 同组效果是否互斥或共享层数。**完全不读就可能重复叠加** | **已核：默认无差异，UI 有潜在差异**，见 §7 D3 |
| Z5 | `statRules.calculation.baseAttackRule` / `baseHpRule` / `baseDefRule` | statRules | 各 1 | 0 / 0 | 基础属性的计算规则。引擎可能自有实现，要对照规则文本 | **已核：数据内部不一致，引擎按逐件字段实现**，见 §7 D5 |
| Z6 | `statRules.calculation.outOfCombatEffectFilter` | statRules | 1 | 0 / 0 | 哪些效果计入局外面板的过滤规则。**与 Z2、basis 是同一个问题** | **已核：当前数据等价，潜在差异**，见 §7 D2 |
| Z7 | `exclusiveGroup` | 驱动盘 teamBuff | 1 | 0 / 0 | 互斥组。与 Z4 类似 | **已核：真实差异——同套 4pc teamBuff 多人穿戴时重复叠加**，见 §7 D8 |
| Z8 | `settlementType` | 音擎 target | 4 | 0 / 1 | 结算类型 | **已核：无差异（stat 名已编码结算类型）**，见 §7 D9 |
| Z9 | `cooldownSeconds` | 音擎 / 驱动盘效果 | 3 | 0 / 3 | 冷却。引擎可能用覆盖率吸收了 | **已核：与 Z3 同类，并入 D7** |
| Z10 | `weaknessElements` / `resistanceElements` / `resistanceOverrides` | Boss target | 各 7 | 0 / 0–2 | Boss 的弱点与抗性。引擎可能读的是别处的敌人配置，要确认两个来源一致 | **已核：catalog.bosses 整块无消费方；引擎读 boss-presets.json**，见 §7 D10 |
| Z11 | `attackTypes` | agents | 62 | 0 / 0 | 攻击类型（斩击、打击等）。影响某些条件效果 | **已核：零读取、无消费方、53/62 为空 → 无差异**，见 §7 D11 |
| Z12 | `relatedAgentId` | 音擎 | 5 | 0 / 0 | 专属音擎对应的角色。可能只影响推荐，不影响计算 | **已核：与 ownerAgentId 冗余 → 无差异**，见 §7 D12 |
| Z13 | `statRules.statDisplay.*SheerDmg` / `*CritDmg` 等 | statRules | 各 1 | 0 / 1–5 | 名字像展示配置，但字段名是属性名。要确认引擎有没有对应的属性 | **已核：动态键造成的假零；有计算通路、口径一致 → 无差异**，见 §7 D13 |
| K0 | `basis` | 音擎 / 驱动盘效果 | 22 | 6 / 11（同名假非零） | **已知差异**：CC-96 确认引擎不读 catalog 效果的 basis，按首次触达时的面板值累积。R5 原文把它列为起点 | **已核：零读取，但引擎的批次规则隐式实现了该语义，无差异**，见 §7 D4 |

**第一批优先核实**：Z4、Z6、Z2 加 K0。它们都直接影响面板数值，而且 Z2、Z6、K0 很可能是同一个根因（「局外 / 局内面板」的界定没有按数据规格实现），可以合并成一张卡。

## 4. 「读了但语义不同」的排查入口（第 3 刀）

有访问的 S 类字段要逐个核对语义，第一批：
- `mode`（372 处出现，37 处访问）：数据有哪些取值，引擎的 switch 或 if 是否覆盖了全部取值；有没有取值落进默认分支、被静默忽略。
- `condition`（118 / 10）：条件表达式的语法，引擎的解析器是否支持数据里出现的全部形式。
- `coverage`（127 / 48）：取值范围和含义（0–1 覆盖率，还是次数）。
- `scope`（350 / 16）、`target`（220 / 13）、`skillTargets`（25 / 1）、`targetSkillType`（14 / 20）。
- `valuePerStack` / `maxStacks` / `defaultStacks`：层数的语义是否一致。
- `formula` / `expression` / `sourceStat`：公式求值。

做法：先用 `node -e` 统计每个字段在 catalog 里的**全部取值**，再对照引擎分支。有数据取值、没有对应分支的，就是差异。

## 5. 差异条目格式（第 2 刀起填写）

每条写成：
```
### D<n> <字段>：<一句话差异>
- 数据怎么写：<取值 / 例子，附 catalog 定位>
- 引擎怎么算：<文件:行号 + 逻辑>
- 差在哪：<零读取 / 语义不同>
- 影响面：<哪些角色、音擎、驱动盘，受影响的效果条数>
- 建议修法：<改哪里；是否会产生数值变动；零差要求怎么处理>
```

## 6. 进度账本

- [x] 第 1 刀：粗筛，列出零读取候选 Z1–Z13 和已知 K0（第 119 轮，本文件首次提交）。
- [x] 第 2 刀（第 121 轮 Z2、Z6；第 122 轮 Z4、K0、Z5、Z1；第 123 轮 Z3、Z7–Z12；第 124 轮 Z13、D14 批与字段归类 §8，**完成**）：215 种字段按 §2 归类（S / D / M），并逐条核实 Z4、Z6、Z2、K0，写成 D 条目。
- [~] 第 3 刀（进行中）：按 §4 对 §8「S 待第 3 刀」的 52 个字段做取值 × 分支对照。第 125 轮完成 `mode`（D15–D17）；第 128 轮完成 `condition`（D18）与 `requirement`（D19，已由 CC-102 修复）；第 130 轮完成 `coverage`（D20）；第 131 轮完成 `target`（D21，CC-105 已修）；第 132 轮完成 `buffModifiers`（D22）与 `formula` / `expression`（D23）。
  - 52 个字段中**已核 19 个**：`mode`、`condition`、`requirement`、`outOfCombatStat`、`specialty`（requirement 内）、`coverage`、`default`、`min`、`max`、`step`、`target`、`kind`、`skillTargets`、`skillTag`、`skillType`、`targetSkillType`、`buffModifiers`、`formula`、`expression`（其中 `specialty` 只核了 requirement 内的用法，其他出现位置随角色类字段再核）。
  - 第 133 轮完成效果数值核心一批（D24：`type`、`value`、`valuePerStack`、`maxStacks`、`defaultStacks`、`modificationValues`、`scope`）与 `source` / `sourceStat` / `defaultValue`（D25）⇒ **已核 29 个**。
  - 第 134 轮完成面板类一批（`advancedStat`、`baseStat`、`sRankMaxMainStat`、`sRankSubStatBaseStep`、`stat`，见 **D26 / D27**）⇒ **已核 34 个**。
  - 第 135 轮完成招式类一批（`actionTime`、`energyCost`、`timeType`、`skillTags`、`damageElement`、`levelValues`、`values`、`comboAlignRatio`，见 **D28 / D29**，另开 **D30 待核**）⇒ **已核 42 个**。
  - **剩余 10 个 + `specialty` 其余位置**（身份类）：`agentId`、`attribute`、`basicBenchmarkMoveId`、`buff`、`cinemaLevel`、`isTeammateOnly`、`luminizeLevelValues`、`ownerAgentId`、`rarity`、`teammateBuffId`。
- [ ] 第 4 刀：差异清单按影响面排序，转成 CC 卡（写进 `docs/mcp-calc-core-architecture.md` 卡表），R5 标 done。

## 7. 已核结论（第 2 刀起）

效果管线的函数级图见 `docs/ARCHITECTURE-OVERVIEW.md` §4。

### D1 `appliesToOutOfCombatPanel`：零读取，但与 scope 完全同义 → 无行为差异
- **数据怎么写**：音擎 `selfBuff` 76 处、`teamBuff` 19 处，共 95 处，取值**全部为 `false`**；同一对象上的 `scope` **全部为 `inCombat`**。递归遍历 catalog，`(scope === 'outOfCombat') !== (appliesToOutOfCombatPanel === true)` 的对象为 **0 个**。
- **引擎怎么算**：`core/buff.ts:337–353`，音擎 / 驱动盘组按 `group.scope === 'outOfCombat'` 分入局外，否则局内；不读 appliesToOutOfCombatPanel。
- **差在哪**：零读取，但语义与 scope 重复，当前数据下结果一致。
- **影响面**：无数值影响。
- **建议**：不改引擎。可选做法是 R6 候选 C3：导入脚本校验两者一致，或者删掉这个冗余字段。**不开修复卡。**

### D2 `statRules.calculation.outOfCombatEffectFilter`：引擎写死了规则的一半 → 潜在差异
- **数据怎么写**：`{ "scope": "outOfCombat", "condition": null }`。字面含义是「scope 为局外**且**无条件的效果才计入局外面板」。
- **引擎怎么算**：`core/buff.ts:286–353` 只判断 `scope === 'outOfCombat'`，不看 condition，也不读这条规则。
- **差在哪**：条件那一半没有实现。递归遍历 catalog，scope 为局外且自身或其 effects 带非空 condition 的对象为 **0 个**，所以当前数据下等价。
- **影响面**：目前为零；将来数据若新增「局外 + 条件」的效果，会被错误计入局外面板。
- **建议修法**：R6 候选 C4，局外判定改为读这条规则，同时判断 condition，当前数据下零差。优先级低；R5 第 4 刀转卡时排在有数值影响的条目之后。
- 同批的 `baseAttackRule`（`agent.atkBase + wEngine.atkBase`）、`baseHpRule`、`baseDefRule`（Z5）还没有和 `calcBasePanel`（`core/panel.ts:158`）逐项对照，第 2 刀续做。

### D3 `stackGroup`：零读取；层数不会错，但覆盖率滑块没有按组联动 → 潜在差异（UI 层）
- **数据怎么写**：19 个组，共 23 条效果。15 个组只有 1 个成员（此时 stackGroup 只是标签）。多成员组有 4 个：
  - 青溟笼舍 14137 `qingming_companion`：以太伤害、两条以太贯穿伤害，都是 vps 8/10/10，max 2，def 2；
  - 焰心桂冠 14116 `effect_wiki_951_team_crit_dmg_element_values`：冰暴伤、火暴伤，vps 1.5，max 20，def 20；
  - 淬锋钳刺 14126 `hunting_intent`：物理伤害（叠层，max 3，def 3），加上 `…_anomaly_buildup_efficiency_full_stack`（固定值 40，**满层时**才生效）；
  - 如影相随 32900 `shadow_harmony_stacks`：攻击力%、暴击率，vps 4，max 3，def 3。
  - 语义：同组效果共享同一个叠层状态。
- **引擎怎么算**：
  - `core/buff.ts:648`：`stacks = effect.defaultStacks ?? effect.maxStacks ?? 1`，**按单个效果**取数据里写死的层数，运行时没有层数输入。
  - 覆盖率按 `effect.id` 存：`core/buff.ts:811` `coverageMap.get(e.id)`；来源 `stores/config.ts:954` `setWEngineEffectCoverage(effectId, …)`。
  - 界面 `views/TeamConfigPage.vue:1153` 规定 `hasCoverage = type === 'stacked' || !!coverage`，所以**每个叠层效果各有一个滑块**（`:372`）。
- **差在哪**：
  - 层数：同组成员的 defaultStacks 相同，层数不能在运行时调，**不会出现组内层数不一致**。
  - 淬锋钳刺的「满层才生效」：同组叠层效果默认就是满层（def 3 = max 3），所以默认计算与规格一致。
  - **覆盖率**：同组成员各有一个独立滑块，用户可以调出规格上不可能出现的组合，例如青溟笼舍「以太伤害 100%、以太贯穿 0%」。
- **影响面**：默认配置（覆盖率全是 100%）零影响。只有用户单独拖动组内某个滑块时才会出错，涉及 4 个多成员组共 9 条效果。
- **建议修法**（R5 第 4 刀转卡，零差）：覆盖率的键改成 `stackGroup ?? effect.id`，或者在 `setWEngineEffectCoverage` 里联动同组成员；界面每组只显示一个滑块。默认值不变，所以零差。驱动盘（如影相随）走 `mergeTeamDiscEffectCoverages`（`resourceCalc/panelPhases.ts:720`），这条路径的键还没有核实，转卡时一并查。

### D4 `basis`（K0）：零读取，但引擎的批次规则隐式实现了它 → 无差异，有隐性耦合
- **数据怎么写**：22 处，全部在局内组里：
  - 音擎 selfBuff 9 处（攻击力%），scope 全是 `inCombat`；
  - 音擎 teamBuff 6 处（攻击力% 4 处、生命值% 2 处），scope 全是 `inCombat`；
  - 驱动盘 4 件套 selfBuff 7 处（攻击力%），scope 未写，引擎按局内处理。
  - 取值：20 处 `outOfCombatAtk`，2 处 `outOfCombatHp`。
- **引擎怎么算**：
  - `core/buff.ts:193–215`：在一次 `applyBuffs` 批次内，攻击 / 生命 / 防御的百分比先汇总，再乘在**批次开始时**的面板值上（`getCoreAccumState` 首次触达时记下基底），最后加固定值；`finalizeCoreStatBonuses` 在批次结束时清掉累计状态。
  - `core/panel.ts:338`：局内批次是 `applyBuffs(outOfCombat, buffs.inCombat, …)`，基底就是局外面板。
  - 队友 buff 经 `collectTeammateBuffs` 并入同一个 `collectAllBuffs`（`core/buff.ts:502–585`），也在这个批次内。
  - `resourceCalc/panelPhases.ts` 里 applyEffect / applyStat 只出现在注释中，**没有**在 calcPanel 之外另开批次。
- **差在哪**：没有行为差异。22 处的基底都是局外攻击力或局外生命值，与数据一致。
- **隐性耦合**：一致性依赖两个没有写明的不变量：①所有局内效果在同一个批次里施加；②数据里 basis 只出现 `outOfCombatAtk` 和 `outOfCombatHp`。一旦出现别的取值（例如 CC-96 之前那 4 处 `baseAtk`），引擎会**静默忽略**。
- **建议**（R5 第 4 刀转卡，零差，低成本）：加一条数据校验（`validate-data` 或单测），断言 catalog 里 basis 的取值集合 ⊆ {`outOfCombatAtk`, `outOfCombatHp`}，出现新值就报错，提醒先让引擎支持。**不改引擎。**

### D5 基础属性规则（Z5）：数据内部不一致，引擎按逐件字段实现 → 不是引擎问题
- **数据怎么写**：
  - `statRules.calculation`：`baseAttackRule = "agent.atkBase + wEngine.atkBase"`、`baseHpRule = "agent.hpBase"`、`baseDefRule = "agent.defBase"`，也就是音擎基础值只加到攻击力上。
  - 但有 3 件音擎的 `level60.baseStat = "def"`：猩红渴望 14161（431）、喵运当头 13017（356）、血髓秘匣 13021（356）。它们的基础值是防御，字段名却仍然叫 `atkBase`。
- **引擎怎么算**：`core/panel.ts:178–183` 按 `wEngine.level60.baseStat ?? 'atk'`，把音擎基础值加到对应属性上；这 3 件加到防御。
- **差在哪**：通用规则文本没有覆盖「防御基础值音擎」，与逐件字段冲突。
- **lead 拍板（可逆）**：以逐件的 `baseStat` 为准。依据：字段级数据比通用规则文本更具体，而且 `baseStat` 是后来随新音擎加入的，规则文本显然没有随之更新。**不改引擎，不开修复卡。**
- **回退点**：如果日后确认应以通用规则为准，把 `core/panel.ts:179–182` 改成只加到攻击力即可。这会改变 3 件音擎的面板，需要单独开卡说明数值变动。
- **给用户的一条信息**：statRules 的 `baseDefRule` / `baseHpRule` 文本已经落后于数据，建议在数据导入脚本里补上 baseStat 的说明。

### D6 `damageBasis`（Z1）：导入脚本合成的字段，引擎按 specialty 决定伤害基底 → 不是引擎差异；字段本身有误导性
- **数据怎么写**：agentSkills 各行共 2490 处，其中 `atk` 2465 处，`def` 25 处，**def 全部属于克拉蕾 1611**。
- **字段来源（关键）**：这个字段是**导入脚本合成的**，不是源数据给出的规格：
  - `scripts/import-nanoka-missing.mjs:116–117` 无条件写 `damageBasis: 'atk'`；
  - `scripts/import-nanoka-beta-agent.mjs:223` 也写死 `'atk'`；
  - `scripts/import-nanoka-v12.mjs:128` 只在 `isSharp`（1611）时写 `'def'`；
  - `data/recordings/` 只有 4 个旧文件，62 个角色的主体数据不经过它。
  - 所以 R5 的前提「数据可信」适用于源数据（nanoka / gachabase 原文），**不适用于导入脚本填的默认值**。
- **引擎怎么算**：
  - `core/damage.ts:254–258` `resolveSpecialDamageProfile(agent)`：`specialty === 'rupture'` → 贯穿力基底（攻击×0.3 + 生命×0.1 + 贯穿力提升，`calcPenetrationPower`）；`sharpen` / 锋御 → 防御基底；其余 → 攻击基底。
  - `composables/resourceCalc/damagePool.ts:213` 把 profile 传给 `calcDirectDamage`。
  - **`DirectDamageInput.damageBasis`（`core/damage.ts:265`）是死参数**：声明了但函数内部从不读取；`damagePool.ts:189` 传的是写死的 `'atk'`。
- **逐人比对**：
  - 锋御：只有 1611 一个角色，按 specialty 得到防御基底，与数据里 25 行 `def` 完全重合，**一致**。
  - 命破 5 人（1051 伊德海莉、1371 仪玄、1441 振斗、1471 般岳、1531 星徽·比利）：数据写 `atk`，引擎用贯穿力。由于 `atk` 是导入默认值，**不构成规格冲突**，引擎按游戏的命破规则（贯穿力）计算。
  - 其余 56 人：`atk`，一致。
- **影响面**：无数值影响。问题在于同一件事有两个来源：字段说一套，引擎按 specialty 算另一套。以后的维护者读字段会被误导，比如把命破角色的伤害当成按攻击力结算。
- **建议**（R6 候选 C5，「可归一」）：二选一。
  - (a) 引擎改读 damageBasis，导入脚本按 specialty 填写（命破填 `sheerForce`）；
  - (b) 删掉这个字段和 `DirectDamageInput.damageBasis` 死参数，只保留 specialty 这一个来源。
  - lead 倾向 (b)：数据源本身不提供逐行基底，specialty 才是真实的决定因素，删掉更简单。零差。

### D7 `durationSeconds` / `cooldownSeconds`（Z3、Z9）：引擎用覆盖率代替持续时间，默认 100% 与数据约定一致；28 个效果没有滑块 → 潜在差异（UI 层）
- **引擎怎么读**：catalog 的 `durationSeconds` 零读取。`src/mechanics/agents/piper.ts` 里的同名字段是派派模块自己的动力持续时间，与 catalog 无关。`cooldownSeconds` 同样零读取。
- **引擎怎么代替**：按效果的覆盖率（`effectCoverageMap`，键为 effect.id，`core/buff.ts:811`）折算；没有覆盖率条目时按 100%。队友 buff 的整体覆盖率（`panelPhases.ts:536–539`）只作用于角色的队友 buff，不覆盖音擎和驱动盘。
- **数据约定**：数据里**所有** `coverage.default` 都是 1，与持续时长、冷却无关（例：混沌爵士 31800 持续 5 秒、冷却 7.5 秒，default 仍为 1）。所以「无覆盖率条目按 100%」与数据约定一致，**默认无差异**。R5 硬约束「数据可信」，这里不改任何默认值。
- **缺口**：带持续时间的效果共 96 个，其中 68 个有滑块（`stacked` 或有 `coverage`），**28 个没有滑块**（`fixed` 且无 `coverage`）。界面判定在 `TeamConfigPage.vue` 的 `collectWEngineGroupEffects`：`hasCoverage: effect.type === 'stacked' || !!effect.coverage`。音擎区没有整组开关，所以这 28 个效果用户无法下调，只能按常驻计算：
  - 26 个音擎效果：14143×2、14118、13128×3、14153、14147、14105、13019、13144×2、13012×2、14156、13004、14119×2、13108、13111、14120、13015×2、14129（减防，只持续 3 秒）、14155、14136；
  - 2 个驱动盘：34100 四件套、31600 四件套 teamBuff。驱动盘走 `mergeTeamDiscEffectCoverages`（`panelPhases.ts:728`）另一条路径，是否另有入口可调**未核**，转卡时先核。
  - `cooldownSeconds` 的 3 处（13111、14130、31800）：14130 是 stacked，31800 有 coverage，只有 13111 在上面 28 个之中。
- **不做的修法**：按持续时间 / 冷却推算覆盖率。这需要时序仿真，R4 已撤销，不再提。
- **建议（转卡，零差）**：界面判定改为 `hasCoverage || durationSeconds != null`（效果级或组级），让滑块出现，默认值仍为 1。只影响界面可调性，默认数值不变。

### D8 `exclusiveGroup`（Z7）：零读取，同套驱动盘 4pc 全队效果多人穿戴时重复叠加 → 真实差异（仅重复穿戴场景） ✅ 已由 CC-101 修复（第 127 轮）
- **数据怎么写**：只有原始朋克 31900 的 `fourPiece.teamBuff` 带 `exclusiveGroup: "proto_punk_4pc_team_dmg"`，原文「全队角色造成的伤害提升15%，持续10秒，同名被动效果之间不可叠加」。
- **引擎怎么算**：`core/inCombatBuffs.ts:164–190` 对**每个**穿 4pc 的队友各推入一个 id 为 `drivedisc-team-${set.id}` 的 buff；下游 `teammateBuffSource.ts:78` → `panelPhases.ts:533`（直接拼接）→ `core/buff.ts:502` `collectTeammateBuffs`（逐条展开）全程没有按 id 或互斥组去重。
- **影响面**：两名队友都穿原始朋克 4pc 时，全队 `dmgBonus` 为 +30%（数据为 +15% 且不可叠加）。默认配置和单人穿戴不受影响。证据是读码，尚未用夹具复现。
- **范围口径**：数据只给 31900 标了互斥组。其余 6 套带 teamBuff 的 4pc（33700、33400、33200、32800、31600、31300）数据没有标，按「数据可信」**不**推断它们也互斥。
- **建议（转卡）**：先写夹具复现（两名队友同穿 31900 → 断言只计一次），再在 `collectInCombatTeamBuffs` 按 `group.exclusiveGroup` 去重（同组只保留一个）。数值变化只出现在重复穿戴场景，golden 预计零差；有差时逐条解释。

### D9 `settlementType`（Z8）：零读取，但 stat 名已经编码了结算类型 → 无差异
- **数据**：4 处，都在音擎效果的 `target: {kind: 'anomaly', settlementType}` 上：琳琅鎏心 14156 的 `windAnomalyDmgBonus`（wind）、`turbulenceDamageBonus`（turbulence）；壳中之灵 14150 的 `anomalyDmgBonus`（attribute）、`disorderDamageBonus`（disorder）。
- **引擎**：`core/buff.ts:67–80` `effectSkillDamageTargets` 只认 `skillType` / `skillTag`，`kind: 'anomaly'` 落到 `['all']`，按通用加成施加。
- **为什么无差异**：结算类型已由 stat 决定。唯一需要确认的是 `attribute`（属性异常，不含紊乱）：引擎明确规定紊乱不继承 `anomalyDmgBonus`（`core/damage.ts:604`、`core/anomalyPool/helpers.ts:785`、`:1129`），与数据语义一致。

### D10 Boss 的 `weaknessElements` / `resistanceElements` / `resistanceOverrides`（Z10）：catalog.bosses 整块无消费方 → 无引擎差异，是死数据
- catalog.bosses 共 7 个，全部没有 `phases`；`stores/catalog.ts:163` 导出了 `bosses`，但 `src` 里没有任何使用方。
- 选 Boss 的界面和引擎读的是另一份数据 `public/static/boss-presets.json`（`components/BossSelectCard.vue:153`），敌人弱点来自其中的 `phase.weakness`（`stores/config.ts:1229`）。
- 两份 Boss 数据是否一致**未比对**（不影响计算，因为引擎只读 boss-presets）。建议归入 R6「冗余可简化」：删掉 catalog.bosses，或标注它不是计算来源。

### D11 `attackTypes`（Z11）：零读取，无消费方 → 无差异
- 62 个角色中 53 个为空数组（有值的：slash 5、strike 3、pierce 1）。`src/core`、`src/composables`、`src/stores` 中没有 attackType / slash / strike 的任何引用，也没有效果依赖攻击类型。归 M（元数据）类。

### D12 `relatedAgentId`（Z12）：与 `ownerAgentId` 冗余 → 无差异
- 5 把音擎（14143、14109、14140、14137、14150）带 `relatedAgentId`（角色 slug），它们同时都有 `ownerAgentId`。专武判定读的是 `ownerAgentId`（`composables/freeCompare/engine.ts:93`，与 `teamCompare.ts:359` 同口径）。归 M 类，可在字段归类时标冗余。

### D13 `statRules.statDisplay` 下的属性键（Z13，`*SheerDmg` / `*CritDmg` / `remielle*` 等）：动态键造成的假零 → 无差异
- **粗筛为什么报零**：statDisplay 是「属性 id → {label, display}」字典，按 `statDisplay[stat]` 动态读取（`composables/useStatLabel.ts:16`、`:25`；`core/panel.ts:219` `inferStatMode`），粗筛统计不到键名。
- **计算通路**：数据里用到这些属性的 10 处效果都有计算通路：
  - `${元素}SheerDmg`：`core/damage.ts:192`（命破贯穿伤害）；来源 14153、14147、14105、14137×2；
  - `${元素}SharpDmg`：`core/damage.ts:197`，只在 `usesSharpDmgBonus`（锋御 1611）时计入；来源 14161 猩红渴望，是 1611 的专武 selfBuff，受益者一致；
  - `${元素}CritDmg`：`core/damage.ts:112`；来源 14116 焰心桂冠 teamBuff；
  - `sheerForceFlat`（13014）、`sheerDmgBonus`（33100）：`buff.ts:721` 等处有 case；
  - 其余不在 case 里的键走 `applyStat` 的 default 分支按键名累加（`buff.ts:794`）；蕾米埃尔 14 项专属键由 `data/agentPanelStats.ts` 预铺初值。
- **驱动盘口径**：`inferStatMode` 按 `display` 决定 pct / flat，2026-09-18（R27-J2）已实测穷举驱动盘主词条和副词条池 21 个属性全部登记，见 `panel.ts:188–215` 头注释与 `utils/__tests__/statModeParity.test.ts`。
  - ⚠ **第 125 轮更正**（第 126 轮补：主词条池与副词条池的并集实为 **20** 个属性，旧注释的「21」是误记）：「全部登记」只说明不会落到兜底分支，**不说明口径对**。`display` 是展示字段，拿它决定结算口径是语义错用；6 号位 `impact` / `anomalyMastery` 因此被按固定值结算，与源数据相反。见 **D15**。
- **数据小缺口（无影响）**：statDisplay 没有登记 7 个 `*SharpDmg` 键。标签回退到 `utils/statMeta.ts:76–82`（「电属性锐化增伤」等）；数值格式由调用方传 mode（14161 写的是 `mode: "pct"`，`AttributeConfigPage.vue:522`、`TeamConfigPage.vue:1191` 都会传），界面显示正确。不处理。

### D14 零访问的配置范围 / 蕾米埃尔 / formula 字段（归类时补核）：全部与引擎硬编码一致 → 无差异，有隐性耦合
- `agentSkills[].categories[].levelRange` = `{min 1, max 12, default 12}`：引擎写死技能等级 12 + 加成（`core/skillLevel.ts:39`），与数据一致。
- `wEngines[].modification` = `{minLevel 1, maxLevel 5, defaultLevel 1}`、`agents[].coreSkill.defaultLevel = "max"`：界面配置范围。**默认值口径不同**：`stores/config.ts:134–141` `defaultCharacter` 默认影画 6、精炼 5（计算器有意的「满配」默认），而数据 `defaultLevel` 为 1。数据的 defaultLevel 描述的是配置范围提示，不是游戏计算规则，**lead 拍板保持满配默认，不改**；回退点是 `config.ts:141`。
- `statRules.driveDisc.rarityMaxLevel` = `{S 15, A 12, B 9}`：引擎只支持 S 级驱动盘（主词条数值唯一来源 `sRankMaxMainStat`，`panel.ts:248`、`buff.ts:551`），A / B 两项无消费方。与界面只提供 S 级一致。
- 蕾米埃尔 1581：
  - `canTriggerLuminize`（4 个招式 1581007 / 008 / 015 / 016）：`mechanics/agents/remielle.ts:267`、`:546`、`:552`、`:558`、`:604` 按 id 硬编码的正是这 4 个，集合一致；
  - `remielleLuminizeLevels = [12, 14, 16]`：与 `remielle.ts` `getRemielleLevelValue` 的兜底阈值（14、16）一致；
  - `luminizeFormula` / `remielleLuminizeMultipliers[*].formula`：结果已预算写在 `values` 里，公式文本只起说明作用。
  - 隐性耦合：数据改了招式或阈值，模块不会跟着变。建议在第 4 刀加一条一致性单测（数据中 canTriggerLuminize 的集合等于模块的硬编码集合），零差。
- `combatBuffs…effects[].source.variable = "x"`、`formula.valueUnit = "storedPercent"`（全仓唯一一处，蕾米埃尔折射系数 `x * 0.02`）：`buff.ts:619` `evalFormulaEffect` 用 `expression` 求值，`x` 取 `sourceStat` 的值，`valueUnit` 不参与计算；结果按百分点存储（170 × 0.02 = 3.4，界面 `formatPercent` 显示 3.4%），与引擎全局的百分点口径一致。

## 8. 字段归类（第 2 刀收尾，第 124 轮）

来源：`.zc/perf/r5scan.out` 的 215 种字段名。脚本断言：四类互斥、合计 215。**口径决定**：在 §2 的 S / D / M 之外加第 4 类 **K（结构 / 键名）**。依据：容器字段（`effects`、`fourPiece`……）和「属性 id 作键」的字段（statDisplay、level60 等字典里的 `critDmg`……）没有独立语义，值的语义由内层字段或按键名的通用通路（`buff.ts` `applyStat` 的 default 分支、`damage.ts` 模板键、`panel.ts` `inferStatMode`，见 D13）覆盖。硬归 S 会让 S 清单失去筛选作用。回退点：把 K 并回 S 即可，本节列表不变。

| 类别 | 数量 | 字段 |
|---|---|---|
| **S 已核**（有 D 条目） | 23 | `appliesToOutOfCombatPanel`(D1)、`baseAttackRule`(D5)、`baseDefRule`(D5)、`baseHpRule`(D5)、`basis`(D4)、`canTriggerLuminize`(D14)、`cooldownSeconds`(D7)、`damageBasis`(D6)、`defaultLevel`(D14)、`durationSeconds`(D7)、`exclusiveGroup`(D8)、`levelRange`(D14)、`luminizeFormula`(D14)、`maxLevel`(D14)、`minLevel`(D14)、`outOfCombatEffectFilter`(D2)、`rarityMaxLevel`(D14)、`remielleLuminizeLevels`(D14)、`remielleLuminizeMultipliers`(D14)、`settlementType`(D9)、`stackGroup`(D3)、`valueUnit`(D14)、`variable`(D14) |
| **S 待第 3 刀**（有读取，查「读了但语义是否相同」） | 52 | `actionTime`、`advancedStat`、`agentId`、`attribute`、`baseStat`、`basicBenchmarkMoveId`、`buff`、`buffModifiers`、`cinemaLevel`、`comboAlignRatio`、`condition`、`coverage`、`damageElement`、`default`、`defaultStacks`、`defaultValue`、`energyCost`、`expression`、`formula`、`isTeammateOnly`、`kind`、`levelValues`、`luminizeLevelValues`、`max`、`maxStacks`、`min`、`mode`、`modificationValues`、`outOfCombatStat`、`ownerAgentId`、`rarity`、`requirement`、`scope`、`skillTag`、`skillTags`、`skillTargets`、`skillType`、`source`、`sourceStat`、`specialty`、`sRankMaxMainStat`、`sRankSubStatBaseStep`、`stat`、`step`、`target`、`targetSkillType`、`teammateBuffId`、`timeType`、`type`、`value`、`valuePerStack`、`values` |
| **K 容器 / 结构键** | 32 | `A`、`additionalAbility`、`agents`、`agentSkills`、`B`、`bosses`、`calculation`、`categories`、`cinemaBuffs`、`combatBuffs`、`corePassive`、`coreSkill`、`driveDisc`、`driveDiscSets`、`effect`、`effects`、`fourPiece`、`id`、`level60`、`levels`、`mainStatPools`、`modification`、`moves`、`rows`、`S`、`selfBuff`、`statDisplay`、`statRules`、`subStatPool`、`teamBuff`、`twoPiece`、`wEngines` |
| **K 属性 id 键**（语义见 D13 与 `applyStat`） | 66 | `anomalyMastery`、`anomalyProficiency`、`anomalyReleaseDmgBonus`、`atkBase`、`atkFlat`、`atkPct`、`critDmg`、`critRate`、`defBase`、`defFlat`、`defPct`、`dmgBonus`、`electricCritDmg`、`electricDmg`、`electricSheerDmg`、`enemyAnomalyDefReduction`、`enemyDefFlatReduction`、`enemyDefReduction`、`enemyElectricDefReduction`、`enemyElectricResReduction`、`enemyEtherDefReduction`、`enemyEtherResReduction`、`enemyFireDefReduction`、`enemyFireResReduction`、`enemyIceDefReduction`、`enemyIceResReduction`、`enemyPhysicalDefReduction`、`enemyPhysicalResReduction`、`enemyResReduction`、`enemyWindDefReduction`、`enemyWindResReduction`、`energyMax`、`energyRegen`、`etherCritDmg`、`etherDmg`、`etherSheerDmg`、`fireCritDmg`、`fireDmg`、`fireSheerDmg`、`flashEnergyMax`、`flashEnergyRegen`、`hpBase`、`hpFlat`、`hpPct`、`iceCritDmg`、`iceDmg`、`iceSheerDmg`、`impact`、`penFlat`、`penRatio`、`physicalCritDmg`、`physicalDmg`、`physicalSheerDmg`、`remielleCinema4LuminizeMultiplierBonus`、`remielleCinema6FleetingGraceVoidflareTriggerMultiplier`、`remielleCinema6SpecialVoidflareTriggerMultiplier`、`remielleLuminizeMultiplierBonus`、`remielleRefringeCoefficient`、`sharpCritDmg`、`sharpnessRegen`、`sheerDmgBonus`、`sheerForce`、`sheerForceFlat`、`windCritDmg`、`windDmg`、`windSheerDmg` |
| **D 展示** | 13 | `cinemaName`、`conditionLabel`、`description`、`display`、`effectText`、`en`、`hidden`、`icon`、`images`、`label`、`name`、`stackLabel`、`zhCN` |
| **M 元数据** | 29 | `$schema`、`aliases`、`appearances`、`attackTypes`、`calculationStatus`、`defense`、`effectBuff`、`encounters`、`endDate`、`enemyIntel`、`faction`、`gameVersion`、`legacyIds`、`level60Stats`、`modeId`、`modelingNotes`、`phaseNo`、`playerBuffs`、`playerDebuffs`、`recommendedSpecialties`、`relatedAgentId`、`resistanceElements`、`resistanceOverrides`、`sources`、`startDate`、`url`、`verification`、`version`、`weaknessElements` |

- 归 M 的说明：`relatedAgentId`（D12 冗余）、`attackTypes`（D11 无消费方）、Boss 那批含 `defense`（D10，catalog.bosses 整块无消费方）虽然名字像规格，但都已核实不进计算。
- ⚠ `display` 虽归 D，但 `core/panel.ts:219` `inferStatMode` 拿它决定驱动盘词条的结算口径，这是 D15 的根因；CC-100 修完后它应回到纯展示。
- 拿不准按 S（§2 规则）：`rarity`、`isTeammateOnly`、`teammateBuffId`、`basicBenchmarkMoveId`、`ownerAgentId` 等放在「S 待第 3 刀」。

### D15 驱动盘 6 号位 `impact` / `anomalyMastery` 主词条：引擎按固定值结算，源数据是百分比 → **真实差异（影响 15 个角色的默认配装）** ✅ 已由 CC-100 修复（第 126 轮）
- **源数据怎么写**（R5：「数据是明牌的（nanoka / gachabase 爬取）」）：`public/static/build-recommendations.json`（nanoka 爬取）的 `main_stats` 每项带游戏内 `prop` 和 `format`：
  - 6 号位冲击力 `prop 12202`、`format {0:0.#%}`；6 号位异常掌控 `prop 31402`、`format {0:0.#%}`；
  - 对照：4 号位异常精通 `prop 31203`、`format {0:0}`（固定值，无 `%`）；攻击力% `12102`、生命值% `11102` 与冲击力 `12202` 同属 xx02 百分比变体；
  - 规律无例外：所有百分比主词条的 format 都带 `%`，唯一的固定值主词条（异常精通）不带。
- **catalog 怎么写**：`statRules.driveDisc.sRankMaxMainStat.impact = 18`、`anomalyMastery = 30`，本身不带口径；`statRules.statDisplay.impact.display` 与 `anomalyMastery.display` 都是 `"number"`。
- **引擎怎么算**：`core/panel.ts:219` `inferStatMode` 读 `statDisplay[k].display`：`number` / `integer` 按 flat，`percent` 按 pct。于是 6 号位冲击力按 +18 点、异常掌控按 +30 点结算。`core/buff.ts:551` 的 `roughStats`（4 件套门槛粗算，如折枝剑歌异常掌控 ≥ 115）也按 `level60 + maxMain` 固定值相加，口径相同。测试把这个口径钉住了：`core/__tests__/discSetEffects.test.ts:407` 断言 6 号位冲击力增量恰为 18。
- **差在哪（根因）**：`display` 描述的是**面板属性怎么显示**（冲击力、异常掌控在面板上显示为整数），不描述驱动盘词条按什么结算。拿展示字段当结算规格是语义错用。2026-09-18 R27-J2 的结论（`panel.ts:188–215` 头注释）引用的 4 条证据（statDisplay 的 display、roughStats、`STAT_META.anomalyMastery.mode`、测试注释「94 + 30」）全是仓库内部互相引用，没有一条来自源数据，**被本条推翻**。
- **影响面**：build-recommendations 在 6 号位放冲击力或异常掌控的 15 个角色，默认配装全部受影响（差值 = 基础值 × 比例 − 固定值）：
  - 冲击力（少算 4.1–6.7 点，约 3–5% 失衡效率）：1011（+6.5）、1071（+4.1）、1101（+6.1）、1141（+6.7）、1161（+6.7）、1251（+6.5）、1351（+6.5）、1361（+5.6）；
  - 异常掌控（少算 4.8–15.3 点）：1281（+4.8）、1331（+13.2）、1401（+12.6）、1411（+7.2）、1501（+15.3）、1511（+7.8）、1541（+14.4）；
  - 连带：4 件套门槛判定（roughStats）会随之改变；基础掌控低的角色（1111 / 1121 / 1271 / 1291，基础 86）按 pct 是 86 × 1.3 = 111.8，不再达到折枝剑歌的 115 门槛。这就是 R27-J2 当年「修掉」的现象，按源数据它本来就该不达标。
  - `energyRegen` 的 display 是 `percent`，源数据 `prop 30502` 也带 `%`，一致，不受影响。
- **建议**：见 §9 CC-100。

### D16 驱动盘 31200 震星迪斯科 2 件套：catalog 写成 `impact / flat / 6`，源数据是 `Impact +6%` → **真实差异（导入错误）** ✅ 已由 CC-100 修复（第 126 轮）
- **源数据**：`data/raw/nanoka_equipment.json:52` `"desc2": "Impact +6%"`（韩文「충격력+6%」，build-recommendations 中文「冲击力+6%。」）。
- **catalog**：`driveDiscSets[31200].twoPiece.effects[0] = {id: "effect_wiki_152_2pc", stat: "impact", value: 6, mode: "flat"}`，没有原文字段。
- **引擎**：`core/buff.ts:439–443` 收集 2 件套，`applyStat` 的 `impact` 分支按 mode 走 `applyScalarStatBonus`（`buff.ts:241–245`），所以按 +6 点结算。**引擎忠实执行了 catalog，错在导入**（与 D6 同理：「数据可信」适用于源数据原文，不适用于导入环节产出的值）。
- **对照组**：29 套 2 件套中，33000 法厄同之歌源数据「Anomaly Mastery +8%」，catalog 为 `anomalyMastery / pct / 8`，正确；只有 31200 错。
- **影响面**：穿 31200 2 件套的角色（默认配装多为 4 件套，2 件套场景较少）；青衣基础冲击力 136，应 +8.16，现 +6。
- **建议**：并入 CC-100。

### D17 `mode` 的其余取值：只有 4 个属性按 mode 分流，其余混写无影响 → 无差异
- **数据**：带 mode 的 stat 实例共 411 处（flat 276、pct 135）；17 个属性同时出现 flat 和 pct（如 `critDmg` flat 28 / pct 2、`dmgBonus` flat 38 / pct 6）。
- **引擎**：`applyStat`（`core/buff.ts:664` 起）只在 4 个属性上看 mode：`impact`（`:688`）、`anomalyMastery`（`:691`）经 `applyScalarStatBonus`（`:241–245`，pct 乘基础值、flat 直加）；`energyRegen`（`:694–701`）、`flashEnergyRegen`（`:703–708`）分到 BonusPct / BonusFlat。其余属性都按百分点直接累加，mode 不参与；`atkPct` / `impactPct` / `impactFlat` 等名字自带口径的属性由 `CORE_STAT_BY_BONUS` / `PHASE_SCALAR_STAT_BY_BONUS`（`:159`、`:180`）按名字定口径，也不看 mode。
- **逐条核对**：这 4 个属性在数据中共 40 处（含 `impactPct` 等名字自带口径者），除 D16 外，mode 与原文一致：14140、14141 异常掌控「提升 60 / 30 点」为 flat；14134、14145 能量回复「点 / 秒」为 flat；其余高级属性和效果为 pct。14136 `impactPct` 写了 `mode: flat`，但原文是「冲击力提升 4%」，引擎按名字走 pct，结果正确，mode 只是噪声。
- **建议**：无需改。可在字段归类时把「对非分流属性写 mode」标为无效字段，不做数据清洗（R5 不改数据）。

### D18 `condition`：只有 1 种取值被执行，其余 104 处字符串一律「恒满足 + 覆盖率兜底」；其中 1 处是引擎能判定却没判定的角色限定 → **真实差异（窄）**

- **数据怎么写**（第 128 轮实测，脚本 `/home/kaua/calc-arch/cond1.py`）：118 处 `condition`，null 13 处（与缺省等价），字符串 105 处。位置分三类：音擎组级（`effect.selfBuff/teamBuff.condition`）、驱动盘组级（`fourPiece.selfBuff/teamBuff.condition`）、**effect 级**（`effects[i].condition`，音擎与驱动盘都有）。取值两种写法：camelCase 机器名约 40 种（`exSpecial`、`hpReduced`、`offField`、`enemyHasAnomaly`、`anomalyMasteryAtLeast115Or150`…），其余是中文散文。
- **引擎怎么读**：唯一读取方 `src/core/wengineConditions.ts:30` `wEngineConditionMet`，只在**音擎组级**被调用（`core/buff.ts` `collectWEngineBuffs`、`core/inCombatBuffs.ts` 音擎 teamBuff 通道），只识别 `attributeCounter`（14002 一处），其余返回 true。**驱动盘组级 condition 与所有 effect 级 condition 零读取**。
- **逐类归纳**（105 处全部归入下列之一）：
  1. **已执行**：`attributeCounter`（1 处）。
  2. **触发 / 状态类散文或机器名**（招式命中、层数、前后台、敌方异常状态、HP 降低等，约 94 处）：引擎没有这些战斗状态，文件头注释写明的设计口径是「恒满足，由覆盖率滑块近似」。与数据约定（coverage 默认 1）一致 → **无差异**。没有滑块的 28 个 fixed 效果已登记在 D7，不重复。
  3. **可静态判定、但已由同一对象上的 `requirement` 执行**（9 处）：34000「以太属性代理人…」（effect requirement.attribute=ether）、34100「装备者为流明属性」（attribute=lumiflux）、33300「强攻角色…」（specialty=attack）、33200「击破位装备者…」（组 requirement.specialty=stun + effect outOfCombatStat critRate≥50）、33400「支援位装备者…」（specialty=support）、32700 `anomalyMasteryAtLeast115Or150`（effect outOfCombatStat anomalyMastery≥115）、34200「暴击率按局外防御力自动判定」（outOfCombatStat def≥1000/1800）→ condition 只是说明文字，**无差异**。
  4. **可静态判定、没有任何执行**（1 处）：**14155 日冕遗蜕** effect `effect_wiki_2031_self_ether_res_ignore`（`enemyEtherResReduction` 16）condition「装备者为佩洛伊斯且处于日蚀效果」。前半句是角色限定（1551 佩洛伊斯），数据里没有对应的机器可读 requirement；数据自己在 `verification.effectBuff` 标了 `partially-modeled-agent-restriction`。影响：非佩洛伊斯的以太强攻角色（当前只有 1241 朱鸢）装 14155 时多吃 16% 以太抗性无视（只作用于以太伤害）。→ **真实差异（窄）**，立卡 CC-103，见 §9。✅ 已修（CC-103，第 129 轮）。
- **结论**：condition 这一字段「读了但语义不同」只有第 4 类 1 处。effect 级 condition 零读取本身不是差异（第 2、3 类都由 coverage 或 requirement 表达）。
- **潜在风险（不立卡）**：新数据若把「装备者为 X 属性」只写进 condition 而不写 requirement，会静默生效。防线：CC-102 之后音擎 effect 级 requirement 已生效，录入时应写 requirement。

### D19 `requirement`：音擎 effect 级 requirement 零读取 → **真实差异** ✅ 已修（CC-102，第 128 轮）

- **数据怎么写**（脚本 `/home/kaua/calc-arch/req1.py`，非 null 共 79 处）：音擎 `effect.requirement {specialty,label}` 66；**音擎 effect 级 `{attribute}` 3（全在 14150 壳中之灵）**；驱动盘 effect 级 `{attribute}` 2、`{outOfCombatStat}` 4、`{specialty}` 1；驱动盘 teamBuff 组级 `{specialty}` 3。
- **引擎怎么读**：
  - 音擎 `effect.requirement.specialty`：由 `collectAllBuffs` 的 `matchSpecialty`（`wEngine.specialty === agent.specialty`）实现；`label` 是展示 → 一致。
  - 驱动盘 selfBuff 的 effect 级（`core/buff.ts` `discRequirementMet` / `discEffectPassesRequirement`）、teamBuff 组级与 effect 级（`core/inCombatBuffs.ts` `discTeamRequirementMet`）：specialty / attribute / outOfCombatStat 三种都判定 → 一致（outOfCombatStat 口径：selfBuff 用粗算、teamBuff 用装备者精确面板，已有 @fact 注明，不在本条范围）。
  - **音擎 effect 级 requirement：修前零读取**。`collectWEngineBuffs` 只过组级 condition。
- **差在哪**：14150 的 `etherDmg 20`、`anomalyDmgBonus 10`、`disorderDamageBonus 10` 三条限定以太装备者；非以太异常角色（简、月城柳、柏妮思、星见雅、普罗米娅、菲欧妮、维琳娜、爱丽丝、派派、格莉丝、蕾米埃尔等）装 14150 时多吃 +10% 属性异常增伤与 +10% 紊乱增伤（etherDmg 对非以太伤害本来无效）。
- **修法**：见 §9 CC-102。

### D20 `coverage`：引擎只读 `default`，且全部数据 default = 1；三处「无记录当 100%」与之等价 → **无数值差异**；1 处展示错误 ✅ 已修（CC-104）

- **数据怎么写**（第 130 轮实测，脚本 `/home/kaua/calc-arch/cov1.py`）：127 处，全部是 effect 级。形状 `{default,min,max,step}` 126 处（音擎 81、驱动盘 35、bosses 10），`{default}` 1 处（14126）。取值：`(1,0,1,0.1)` 125、`(1,0,1,0.01)` 1、`(1,-,-,-)` 1 ⇒ **default 全为 1**。另有 162 个 effect 不带 coverage（音擎 fixed 78 / stacked 25，驱动盘 fixed 41 / stacked 2，角色 16）。
- **引擎怎么读**：
  - `core/buff.ts:638` `applyEffect`：`coverage 参数 ?? effect.coverage?.default ?? 1`，fixed / derived / stacked / formula 四型都乘。参数来自 `applyBuffs` 的 `coverageMap`（effect.id → 0..1）。
  - 用户记录（0–100）→ 0..1：音擎 `stores/selectionReads.ts:32` `wEngineEffectCoverageMapOf`（只含有记录的，缺省回落 data default）；驱动盘 `composables/resourceCalc/panelPhases.ts:747` 对全队盘上**每个** effect 写 `discEffectCoverageOf(...) / 100`（**无记录 = 100，不读 data default**）；队友 buff `teammateBuffCoverageOf` 无记录 = 100。
  - `core/substatOptimizer.ts:226` `decomposeEffect`：读 default，但 `type === 'fixed'` 时**不乘**（applyEffect 会乘）。
  - `min` / `max` / `step`：只有 `views/WEngineFieldPage.vue` 展示读取；滑块组件统一 0–100，**不读**数据的 min/max/step（1 处 step 0.01 的效果界面仍按组件步进）。
  - bosses 的 10 处：catalog.bosses 整块无消费方（D10）。
- **差在哪**：
  1. 数值：上述「无记录当 100%」和「fixed 不乘」两类语义与 applyEffect 不同，但 **default 全为 1 ⇒ 当前等价**。拍板**不改代码**（改了也是零差，且驱动盘界面默认值 `stores/config.ts:477` 要同步改，收益为零），改为钉数据前提：新测试 `src/core/__tests__/coverageDefaultInvariant.test.ts` 断言所有 default = 1，失败信息指向这三处。回退点：删掉该测试即可。
  2. 展示：`views/WEngineFieldPage.vue` 把 0..1 比例直接接「%」，显示成「覆盖 1%（0-1，步进0.1）」→ 真实展示错误，CC-104 改为按百分比显示（「覆盖 100%（0-100%，步进10%）」）。
- **结论**：`coverage` 无数值差异；未带 coverage 的效果是否需要滑块已登记在 D7，不重复。

### D21 `target`：引擎不读 `target.kind`，只读 `skillTargets`；skillTag `assistAttack` 被静默丢弃 → **真实差异** ✅ 已修（CC-105，第 131 轮）

- **数据怎么写**（第 131 轮实测，脚本 `/home/kaua/calc-arch/tgt1.py`）：effect 级 `target` 的 kind 有 4 种：`default`（音擎 137、驱动盘 21、bosses 10）、`self`（角色 16）、`skill`（带 `skillTargets`，音擎 19、驱动盘 9）、`anomaly`（带 `settlementType` wind / turbulence / attribute / disorder，14156、14150 共 4 处）。bosses 顶层另有一种 `target {defense, weaknessElements, …}`，是 Boss 属性，catalog.bosses 无消费方（D10）。`skillTargets` 取值：skillType ∈ basic / exSpecial / ultimate / chain / dashAttack / dodgeCounter / additionalAttack；skillTag ∈ exSpecial / dashAttack / **assistAttack**。
- **引擎怎么读**：`core/buff.ts` `effectSkillDamageTargets`：`targetSkillType` 优先，否则遍历 `target.skillTargets`；skillType 经 `normalizeSkillDamageTarget`（`src/data/skillDamageTargets.ts`，未知值 → 'all'）；skillTag **只认** exSpecial / dashAttack / additionalAttack。结果为空时回落 `['all']`。`applyTargetedStat` 对 `TARGETABLE_STATS` 内的 stat 写 `<stat>__<target>`。`target.kind` 与 `settlementType` **零读取**。
- **逐类结论**：
  1. `kind` default / self：等价于「全招式」，与引擎回落一致 → 无差异。
  2. `kind: anomaly` + `settlementType`：stat 名已编码结算类型（windAnomalyDmgBonus / turbulenceDamageBonus / anomalyDmgBonus / disorderDamageBonus），与 D9 同理 → 无差异。另：`src/types/catalog.ts` `EffectTarget.kind` 的联合类型里没有 `'anomaly'`（catalog 以 JSON 读入，类型不校验，不影响运行）；不改。
  3. `targetSkillType` 与 `skillTargets` 同时存在的 13 处：全部一致（单目标且相等）→ 无差异。
  4. 数据里出现的 stat（dmgBonus、electricDmg、skillDmgBonus、stunBuildUpBonus、enemyDefReduction、enemyFireResReduction、etherSheerDmg）都在 `TARGETABLE_STATS` 内，定向生效 → 无差异（新测试逐条钉住）。
  5. **31800 混沌爵士 4pc** `effect_chaos_jazz_4pc_skill_dmg`（dmgBonus 20，原文「[强化特殊技]和[支援攻击]造成的伤害提升20%」）：skillTargets = [skillTag exSpecial, skillTag **assistAttack**]，后者不在白名单被丢弃 ⇒ 只有强化特殊技 +20，**支援技漏算** → **真实差异**。因为 exSpecial 仍被识别，结果非空，不会退化成全招式。
- **修法**：见 §9 CC-105。

### D22 `buffModifiers`：catalog 里 85 处全是空数组 → **无差异**；真正的修饰器在 teammate-buffs.json，引用全部可解析

- **数据怎么写**（第 132 轮实测，脚本 `/home/kaua/calc-arch/bm1.py`）：catalog.json 共 85 处 `buffModifiers`（角色 7、音擎 44、驱动盘 26、bosses 8），**全部为 `[]`**。非空修饰器只在 `public/static/teammate-buffs.json`（不属于 catalog，但同为规格数据）：11 条，全部 `operation: multiplyResolvedValue`，分布在 1411 / 1211 / 1161 / 1251 / 1071 / 1521 / 1421 / 1571 的影画 buff 上。
- **引擎怎么读**：`core/inCombatBuffs.ts:84` 只从**已启用、非 singleSourced 的角色队友拐**收集修饰器，`:89` 只处理 `multiplyResolvedValue`，按 formula / derived（ratio 与 cap 同乘）/ stacked（value 与 valuePerStack 同乘）/ 其他（value）四个分支放大。音擎 / 驱动盘 teamBuff 的 `buffModifiers`（`:153`、`:191`）只被原样搬进 buff 对象，**没有读取方**。
- **核对**：11 条的 `targetBuffIds` / `targetEffectIds` 全部能解析到存在的 buff / effect；目标 effect 类型为 formula 7、stacked 2、fixed 1、derived 1，都有分支；修饰器与目标 buff 都属于同一角色，都不是 singleSourced。
- **结论**：无差异。风险是两类「静默失效」：catalog 出现非空修饰器（无读取方）、teammate-buffs 出现悬空 id 或新 operation。拍板用测试钉住：`src/core/__tests__/buffModifiersIntegrity.test.ts`（CC-106）。回退点：删掉该测试。

### D23 `formula` / `expression`：catalog 只有 2 个 formula 效果 + 8 个招式倍率字符串，都已核 → **无差异**；`valueUnit` 零读取

- **数据怎么写**（脚本 `/home/kaua/calc-arch/fx1.py`）：effect 级 `formula {expression, valueUnit}` 只有 2 处，都在 1581 蕾米埃尔 corePassive（`x * 0.02` → remielleRefringeCoefficient、`x * 0.2` → remielleLuminizeMultiplierBonus，sourceStat = anomalyProficiency，valueUnit = storedPercent）。另有 8 处字符串 `formula`（`100 + skillLevel * 5` 等），在 1581 的招式行 `luminize_multiplier` 与 `remielleLuminizeMultipliers`，D14 已核与模块硬编码一致。
- **引擎怎么读**：`core/buff.ts` `evalFormulaExpression`：字符白名单 + `Function('x','s','p','clamp','floor','max','min', …)`，求值失败返回 0。catalog 的两个表达式只用 `x`，在白名单与可用标识符内，不会静默归零。`valueUnit` 在 `src/` 中只出现在类型声明和 specs 说明里，**零读取**：引擎把表达式结果按 stat 的存储单位直接累加；catalog 两处都是 storedPercent，与 remielle 模块读取这两个 stat 的口径一致（D14）。
- **结论**：无差异。teammate-buffs.json 里的 formula（1411 / 1211 / 1161 / 1521 等）不在 catalog 范围，其修饰器已由 D22 的测试覆盖；表达式本身的正确性属于各角色规格（src/specs），不在 R5。

### D24 效果数值核心字段（`type` / `value` / `valuePerStack` / `maxStacks` / `defaultStacks` / `modificationValues` / `scope`）：全部与引擎读法一致 → **无差异**

- **数据怎么写**（第 133 轮实测，脚本 `/home/kaua/calc-arch/ev1.py`）：effect 293 个，type 只有 fixed（音擎 142 / 驱动盘 70 / 角色 14 / bosses 5）、stacked（音擎 43 / 驱动盘 8 / bosses 5）、formula（角色 2）三种，无缺省、无未知值。stacked 51 个（不含 bosses）：`value` 缺省 47、`value = valuePerStack` 4，**没有把 value 写成总值的**；全部有 `valuePerStack` 与 `maxStacks`，`defaultStacks = maxStacks`（bosses 有 1 处 defaultStacks 0，无消费方）。`modificationValues` 181 个，全部长 5 且第 1 项等于基础字段；音擎 effect 只有 4 个没有 modificationValues（14155 暴击率 20、13142 三条），原文都是不随精炼变化的单值 → 正确。`scope`：effect 级 0 处；组级 角色 247 处全为 inCombat、音擎 102 处全为 inCombat、驱动盘 58 处全缺省。
- **引擎怎么读**：`core/buff.ts` `applyEffect`：fixed = value×cov；stacked = (valuePerStack ?? value)×(defaultStacks ?? maxStacks ?? 1)×cov；derived；formula；未知 type → 0。`applyWEngineModLevel` 按精炼等级替换 value / valuePerStack。scope：`collectAgentBuffs` / `collectWEngineBuffs` / `collectDriveDiscBuffs` 一律「`scope === 'outOfCombat'` 进局外，否则进局内」；驱动盘 2 件套无论 scope 都进局外。
- **结论**：数据形态全部落在引擎读法之内 → 无差异。stacked 满层默认（defaultStacks = maxStacks）与计算器「满配」默认一致。拍板用测试钉住形态：`src/core/__tests__/effectValueInvariant.test.ts`（CC-107）。

### D25 `source` / `sourceStat` / `defaultValue`：catalog 只有 1581 蕾米埃尔两处；引擎实际按**局外**异常精通取值，数据与原文都没写口径 → **语义待定（不改数值）**

- **数据怎么写**：1581 corePassive 两个 formula 效果（`x * 0.02` → remielleRefringeCoefficient、`x * 0.2` → remielleLuminizeMultiplierBonus），`sourceStat: anomalyProficiency`，`source: {variable x, defaultValue 170}`，**没有 `sourcePanelPhase`**。原文：「蕾米埃尔异化度等于自身异常精通的0.02%；……倍率额外提升自身异常精通的0.2%」，没写「初始」。
- **引擎怎么读**：`core/buff.ts` `getEffectSourceValue`：`dynamicSourceValue ?? panel[sourceStat] ?? source.defaultValue`。自身效果没有 `dynamicSourceValue`（`cloneEffectWithSourceValue` 只处理带 `sourcePanelPhase` 的队友效果），所以 x = **应用这条效果那一刻**正在累加的面板值。`collectAllBuffs` 把角色自身 buff 排在局内列表最前，那一刻的异常精通 = 局外面板值。
- **实测**（第 133 轮探针，已写成测试）：无音擎时 局外 170 / 局内 170，coef 3.4；装 14150（局内 AP +90）时 局内 260，coef 仍 3.4（按局内应为 5.2）；再加 34100 4pc 时 局外 200 / 局内 340，coef 4.0（按局内应为 6.8）。
- **差在哪**：口径本身未定。仓库里同类「按自身属性折算」的数据（teammate-buffs.json）：写「初始」的一律 `sourcePanelPhase: outOfCombat`；不写「初始」的有两种——柚叶异常掌控、莱特冲击力用 inCombat，丽娜穿透率、简异常精通用 outOfCombat。没有统一约定，R5 禁止用实测或投稿定口径。另外资源卡展示用的 `mechanics/agents/remielle.ts` `computeRemielleMechanic` 读 `cfg.panel.anomalyProficiency`，与伤害管线的取值时刻不同（只影响展示）。
- **拍板**：**不改数值**，保持当前的「局外异常精通」口径（可逆）。风险在于这个口径是**靠 buff 排列顺序隐式成立的**，调整顺序就会静默改变 1581 的伤害 → 新测试 `src/core/__tests__/remielleSourcePhase.test.ts` 钉住 coef = 0.02 × 局外 AP、bonus = 0.2 × 局外 AP。
- **若日后确认应按局内（实时）异常精通**：给这两个 effect 补 `sourcePanelPhase: "inCombat"`，并让自身 formula 效果在局内其余效果之后再求值（两段式），改写上述测试；影响只限 1581 所在预设，按 CC 卡流程做 zd 归因与 golden delta 表。

### D26 4 件套 `outOfCombatStat` 门槛的取值面板漏掉音擎与局外 buff（审 `advancedStat` / `baseStat` 时发现）→ **语义不同，已修（CC-108）**

- **数据怎么写**：34200 荆棘玫瑰 4pc「装备者**初始防御力**大于等于1000/1800点时，暴击率提升8/16%」，selfBuff.condition「暴击率按装备者**最终局外防御力**自动判定」；32700 折枝剑歌 4pc 异常掌控 ≥115 同类。音擎 `level60.baseStat = def` 3 把（14161 猩红渴望 431、13017 / 13021 各 356，白值加到防御），`advancedStat` 含 defPct 4 把、anomalyMastery pct 4 把。
- **引擎怎么算（修前）**：`core/buff.ts` `collectAllBuffs` 自算 `roughStats`：def = 角色白值 × (1 + 4/5/6 号位防% + 防%副词条) + 184 + 防御副词条；anomalyMastery = 角色白值（× 1.3 若 6 号位掌控）。**漏掉**：音擎白值（baseStat=def）、音擎副属性、本套 2 件套防御 +16%、局外 buff。第 3 刀 requirement 那条（D-requirement，第 305 行）当时把这一口径标为「不在本条范围」。
- **差在哪**：数据写的是最终局外面板，引擎用的是缺项的粗算。例：1611 克拉蕾 + 专武 14161、空副词条，精确局外防御 1614.3（应给第一档 +8% 暴击），粗算 625.1（不给）。同一文件的 teamBuff 侧（山大王 critRate≥50）早已读精确面板，两侧口径不一。round 30 注释说两侧「不得统一」，理由是**粗算值是错的**（漏音擎副属性）——现在改成两侧都读精确面板，该理由不再成立。
- **修法（CC-108）**：删 `roughStats`；`calcPanel` 两段式——第一段不带门槛数据收集 buff（带属性门槛的效果一律不发）并算出局外面板；若 4 件套 selfBuff 带 `outOfCombatStat` 门槛（`discSelfBuffNeedsOutOfCombatPanel`），第二段用第一段局外面板判定门槛、重新收集并重算局外面板。门槛效果都在局内组，第一段面板即「门槛效果之前」的局外面板，不自指。
- **影响面**：zd DIFF 12（dump / rowsnap 各 12），只有 claret-roxy-rina、claret-koleda-rina 两个预设各 6 个变体。golden delta 见 CC-108。
- **口径注记**：局外 buff 包括队友的局外组效果（与 teamBuff 侧 `wearerPanel` 相同）。若日后认定「初始防御力」不含队友局外效果，改 `calcPanel` 第一段传入的面板即可。

### D27 面板类其余字段：`advancedStat.mode` / `target`、`sRankMaxMainStat`、`sRankSubStatBaseStep`、`stat` → **无差异**

- `advancedStat`：83 把音擎全有，`{stat, value, mode}`，13 把多一个 `target: {kind: default}`，引擎（`panel.ts` `calcPanel`）只拷 stat/value/mode，`target` 零读取但全部是缺省值 → 等价。mode 只对 `impact` / `anomalyMastery` / `energyRegen` 有分流（`applyStat`），这三者在音擎副属性里全是 pct，与游戏「冲击力% / 异常掌控% / 能量自动回复%」一致；critRate / critDmg / penRatio 标 flat 但 `applyStat` 对它们不看 mode。
- `baseStat`：只有 def（3 把），缺省 atk；`calcBasePanel` 按 def / hp / atk 分流 → 一致（门槛侧的遗漏见 D26）。
- `sRankMaxMainStat` / `sRankSubStatBaseStep` / `subStatPool` / `statModes`：`applyDriveDiscConfig` 读 4/5/6 主词条、1/2/3 固定主词条、副词条（只收 subStatPool 内的键，值 = 步长 × 步数），mode 按 statModes（CC-100）→ 一致。`substatOptimizer.ts:822` 读同一步长表。
- `stat`：catalog + teammate-buffs 共 87 个不同 stat 键（第 134 轮探针）。78 个是 `emptyPanel()` 已有字段；9 个由 `applyStat` default 分支动态建键：7 个元素分项（`{element}SheerDmg` / `CritDmg` / `SharpDmg`）由 `damage.ts:112/192/197` 按元素拼键读取；`enemy{attribute}AnomalyResReduction` 在收集期按装备者属性落键（D-requirement）；**`shieldAppliedBonus`（14107 奔袭獠牙）零读取**，`utils/statMeta.ts:52` 已标「暂不实现」，计算器不算护盾量 → 不影响伤害，不立卡。

### D28 `energyCost`：三个解析器口径不一；洛克茜强特自旋 30/s 零扣费 → **语义不同，已修（CC-109）**

- **数据怎么写**：115 个招式带 `energyCost`（字符串值的字典），19 种键。单键「Energy Cost」75 处；多键 / 持续型：1031「Charged Attack Energy Cost 20 Energy/sec + Bombard 60」、1281「20 Energy/s」、1621「Energy Cost 10 + Energy Cost Per Second 30」、1171「12.5/s」、1061 三段等；闪能键「Flash Energy Cost」11 处（1371 / 1441 / 1471）。
- **引擎怎么读（三处）**：
  1. `core/resource/moveLookup.ts` `findExSpecial`：优先键「Energy Cost / Activation Energy Cost / Energy Cost to Use」，否则第一个可解析数字（`parseFloat('20 Energy/sec') = 20`）；键含 flash ⇒ 闪能。资源计算的默认单发耗能来自这里。
  2. `composables/multiplierCoefficients.ts` `parseEnergyCost`：跳过 `/s`、`/sec` 值，取第一个非持续项（只用于倍率系数页）。
  3. `composables/resourceCalc/roundInputs.ts:237`（失衡轴动作）：第一个正数。
- **逐角色核对**（第 135 轮探针：60 个有强特的角色逐个比 1 与 2、3）：只有 1031、1281 不同（1 取 20，2 取 60 / 无）。这两人与 1061 由 `data/sustainedEx.ts` `SUSTAINED_EX_SPECS` 接管（固定耗能 + 每秒 × 秒数），覆盖 1 的结果 → 资源侧一致。闪能：命破角色的槽位能量本身就是闪能（`resourceIncome.ts` isFlash），轴里扣闪能即扣该槽能量 → 一致。其余多键角色（1171 / 1141 / 1131 / 1161 / 1091 / 1121 / 1251 / 1051 / 1211 …）要么优先键就是单发耗能，要么模块自设 `exSpecialEnergyConsume`（grep 共 18 个模块）。
- **差在哪**：**1621 洛克茜**。模块 `skipGenericExSpecial = true`，但没有设 `exSpecialEnergyConsume` ⇒ 沿用 1 的「Energy Cost」10；自旋执行行 `energyConsume: 0`（行名却写「耗能 30/s」）。于是强特次数 = 能量 / 10（默认预设约 80 发 / 180s），而同一模块的风能账本 `computeRoxyWindEnergy` 按每发 10 + 30 × 自旋秒（默认 2.5 ⇒ 85）记耗能——账本耗能是能量总收入的约 8 倍。spec `1621.json` 与模块注释都写「10 能量启动 + 30/s 自旋」。
- **修法（CC-109）**：`roxy.ts` 新增 `roxyExEnergyCost`（从 catalog 1621007 读「Energy Cost」与「Energy Cost Per Second」，缺省 10 / 30），`buildRoxyCharConfig` 设 `cfg.exSpecialEnergyConsume = 启动 + 每秒 × spinSeconds`；小心风寒行扣启动、自旋行扣 每秒 × 秒。
- **影响面**：zd DIFF 30 = 含洛克茜的 5 个预设 × 6 变体，无其他预设。伤害大幅下降（见 CC-109 表）。**这是本项目迄今最大的一次数值变化**，依据只有数据与 spec 的耗能原文，没有用实测或投稿。
- **遗留（不立卡，记录）**：失衡轴 `roundInputs.ts:237` 仍按「第一个正数」解析，用户自建轴里放 1031 / 1061 / 1281 的强特块时只扣首项（20）；内置轴预设不含这些块（`git grep` src/data/stunAxisPresets 为 0）。若要统一，改成复用 `findExSpecial` 的键优先级 + `SUSTAINED_EX_SPECS`，需要先定「一个轴块代表一整次强特还是一段」。

### D29 招式类其余字段 → **无差异**（`comboAlignRatio` 等价但不读数据）

- `actionTime`：1352 个招式，null 40、0 29；所有读取方都是 `?? 0` 或 `> 0` 守卫 ⇒ null 按 0 秒，一致。
- `timeType`：normal 1198 / ultimate 72 / parry 50 / dodgeCounter 32。`damage.ts:42`、`resourceCalc/helpers.ts:436`、`moveLookup.ts:234` 读 dodgeCounter，`multiplierCoefficients.ts:47` 读 ultimate；parry 零读取，招架次数来自配置 `parryCount`，招式归属由 category 决定 ⇒ 等价。
- `skillTags`：15 个招式，只有 `additionalAttack`；`damage.ts` `inferSkillDamageTarget` 读 ⇒ 一致（buff 侧的 skillTag 见 D21）。
- `damageElement`：行级与招式级 0 处不一致；85 个招式是物理（非物理角色的普攻前段等）。直伤 `damagePoolDirect.ts:143/306` 取「行 → 招式 → 角色」⇒ 一致。异常侧见 D30。
- `values`：7455 行，除 1581 的 4 行耀变倍率外全部单值（= Lv12，`levelRange.default` 12）；技能等级提升由 `core/skillLevel.ts` `getSkillLevelCoef` 按系数放大 ⇒ 设计如此，一致。
- `levelValues`：只有 1581 的 4 行 `[12,14,16]`，`mechanics/agents/remielle.ts:96` 按 `indexOf(skillLevel)` 取 ⇒ 一致（与 D14 同源）。
- `comboAlignRatio`：只有 1401012（爱丽丝 SW3）一处 0.749；`alice.ts:177` 自算 `1 - 1/actionTime` = 0.74893（actionTime 3.983）。数据是同一规则（前台 1 秒）的四舍五入值，差 7e-5 ⇒ 等价。拍板保持自算（规则比取整值精确）；若改读数据，golden 会有微小差异。

### D30（待核）异常积蓄的属性：数据按招式 / 行写属性，异常侧多处按角色属性归属

- 85 个非物理角色的物理招式，其 `anomaly_buildup` 行 `damageElement = physical`（行级与招式级一致）。游戏内这类招式积蓄的是物理异常。
- 异常侧读取方多处用 `agent.damageElement`：`resourceCalc/anomalyPanels.ts:129/138/163/234`、`damagePoolAnomaly.ts:330`、`damagePoolRelease.ts:89/131/216`、`positionCompare.ts:115/122`。**尚未确认**积蓄是否已在上游按行属性分流（例如 `damagePool.ts:188` `safeElement(row.element)`）。
- 下一轮先查：积蓄行从 `rows[].damageElement` 到异常触发计数的完整路径；若物理行确实被记成角色属性积蓄，属于语义不同，走 CC 卡（影响所有普攻前段为物理的异常 / 紊乱角色）。

## 9. 转卡清单（第 4 刀输入，按影响面排序）

### CC-100（D15 + D16）驱动盘词条的结算口径以源数据为准 ✅ done（第 126 轮，提交号见 git log「fix(CC-100)」）

**实际做法**（与下面的原计划相比有两处调整，均已写明理由）：
- 生成源头：`scripts/` 与 `data/` 中没有任何脚本生成 `statRules` 或 31200 的 2 件套（`patch-disc-sets.mjs` 只补 4 件套和另外几套的 2 件套），catalog 是手工维护的，所以直接改 `public/static/catalog.json`。catalog 是单行 JSON，满足 `JSON.stringify(JSON.parse(x)) + "\n" === x`，用 node 解析改写，逐项比对确认只有两处变化。
- **命名调整**：数据字段叫 `statRules.driveDisc.statModes`（20 个键，按 build-recommendations 的 format 是否带 `%` 填写；*Flat 与 anomalyProficiency 为 flat）。原计划的 `statSettlementMode` 与全局 Buff 通路的 `utils/statMeta.ts#statSettlementMode()` 同名，会与判据 19 混淆，所以改名。
- **结构调整**：判定函数放在新模块 `src/core/discStatMode.ts#driveDiscStatMode`（显式 statModes → 回退 display → 名字启发式）。`panel.ts` 的 `inferStatMode` 委托给它，`buff.ts` 的 roughStats 也用它。不放在 panel.ts 是因为 panel.ts 已经 import buff.ts，反向引用会成环。
- 31200 2 件套 mode 改为 `pct`。
- 测试：改写 `discSetEffects.test.ts` 的 3 条（折枝剑歌门槛改为「1111 按 pct 111.8 不达标 + 1481 按 pct 122.2 达标」双臂；6 号位掌控钉 ×1.3；6 号位冲击力钉基础值 × 0.18）；`discSubstats.test.ts` 用 `modeAs` 切换口径，并新增正控「存在显式 statModes 时只改 display 不改变结算」；`statModeParity.test.ts` 判据 ② 的锚点改到 discStatMode.ts，语义不变（驱动盘口径以 catalog 为准，不得接入 `statSettlementMode(` / statMeta）。

**差异与归因**：
- `zd.sh cc100`：DUMP DIFF 306、ROWS DIFF 316（非零差，符合预期）。
- **反向验证**（`/home/kaua/calc-arch/cc100/zdrev.sh`）：保留全部代码改动，只把 catalog 的 `statModes.impact`、`statModes.anomalyMastery`、31200 2 件套 mode 临时改回 flat，重跑 dump 和 rowsnap 与 HEAD 基线比较 ⇒ **DUMP DIFF 0、ROWS DIFF 0**。这证明：① 全部差异来自 D15 / D16 这三处口径；② 代码重构本身逐位零差。
- 测试层的 5 个失败同样做了反向验证（改回 flat 后 34/34 全绿），然后更新基线：
  - `timeGolden.baseline.json` 重新生成（`TIME_GOLDEN_UPDATE=1`），delta 表见下；
  - `moduleAnomalyEventRecords.test.ts` 的 r2 / lead-empty / jr：1331、1501 的 6 号位掌控升高 ⇒ 同样时长内多触发 1 次异常 ⇒ 虚耀池 +1、支援技 +1、普攻 +2，终结技按 3 个一批不变；
  - `damagePoolBatchR17c.test.ts` 雨果用例：队友 1161 的 6 号位冲击力改按 +18% ⇒ 失衡节奏变化 ⇒ 全局覆盖率折扣 1.2333 → 1.2917，判据本意（≠ 1.5，走覆盖率折扣）不变。
- timeGolden delta 表（60 行，每行对应的 preset 都含 15 人名单中至少一人）：

```text
preset:auto-1371-1251-1451.slack: 1.052 → 1.054 (0.002)
preset:auto-1371-1251-1451.slot0: chain 1.2287→1.2221 (-0.007), basic 10.437→10.449 (0.012), nec 104.749→104.735 (-0.014), front 112.919→112.917 (-0.002), back 67.081→67.083 (0.002)
preset:auto-1371-1251-1451.slot1: basic 10.437→10.449 (0.012)
preset:yidhari-trigger-lucia.slack: 3.660 → 3.622 (-0.038)
preset:yidhari-trigger-lucia.slot0: chain 4.7129→4.7432 (0.030), basic 29.957→29.919 (-0.038), nec 55.022→55.098 (0.076), front 81.318→81.395 (0.077), back 98.682→98.605 (-0.077)
preset:yidhari-trigger-lucia.slot1: basic 29.957→29.919 (-0.038), front 75.357→75.319 (-0.038), back 104.643→104.681 (0.038)
preset:auto-1051-1141-1451.slack: 3.307 → 3.299 (-0.008)
preset:auto-1051-1141-1451.slot0: chain 5.8972→5.9032 (0.006), basic 30.022→30.014 (-0.008), nec 57.585→57.600 (0.015), front 84.299→84.314 (0.015), back 95.701→95.686 (-0.015)
preset:auto-1051-1141-1451.slot1: basic 30.022→30.014 (-0.008), front 72.729→72.721 (-0.008), back 107.271→107.279 (0.008)
preset:yidhari-qingyi-lucia.slack: 2.566 → 3.389 (0.823)
preset:yidhari-qingyi-lucia.slot0: ex 12.0000→11.0000 (-1.000), ult 4.0000→3.0000 (-1.000), chain 3.0724→4.7129 (1.641), basic 33.329→33.680 (0.351), nec 57.325→56.610 (-0.715), front 88.131→86.944 (-1.187), back 91.869→93.056 (1.187)
preset:yidhari-qingyi-lucia.slot1: basic 33.329→33.680 (0.351), front 69.638→70.002 (0.364), back 110.362→109.998 (-0.364)
preset:auto-1321-1161-1311.slot0: chain 2.2857→3.1344 (0.849), basic 39.070→36.205 (-2.865), nec 52.593→54.418 (1.825), front 91.663→90.623 (-1.040), back 88.337→89.377 (1.040)
preset:auto-1321-1161-1311.slot1: chain 2.2857→3.1344 (0.849), basic 39.070→36.205 (-2.865), nec 40.096→42.204 (2.108), front 79.166→78.409 (-0.757), back 100.834→101.591 (0.757)
preset:auto-1321-1161-1311.slot2: chain 2.2857→3.1344 (0.849), nec 9.171→10.968 (1.797), front 9.171→10.968 (1.797), back 170.829→169.032 (-1.797)
preset:auto-1511-1561-1411.slot0: chain 0.8305→0.9509 (0.120), basic 12.339→11.951 (-0.388), nec 51.073→51.331 (0.258), front 63.411→63.283 (-0.128), back 116.589→116.717 (0.128)
preset:auto-1511-1561-1411.slot1: chain 0.8305→0.9509 (0.120), basic 12.339→11.951 (-0.388), nec 80.292→80.553 (0.261), front 92.630→92.504 (-0.126), back 87.370→87.496 (0.126)
preset:auto-1511-1561-1411.slot2: chain 0.8305→0.9509 (0.120), nec 23.958→24.213 (0.255), front 23.958→24.213 (0.255), back 156.042→155.787 (-0.255)
preset:auto-1591-1161-1211.slot0: chain 1.4865→1.4783 (-0.008), basic 14.103→14.147 (0.044), nec 95.823→95.768 (-0.055), front 109.926→109.916 (-0.010), back 70.074→70.084 (0.010)
preset:auto-1591-1161-1211.slot1: chain 1.4865→1.4783 (-0.008), basic 14.103→14.147 (0.044), nec 36.829→36.809 (-0.020), front 50.932→50.956 (0.024), back 129.068→129.044 (-0.024)
preset:auto-1591-1161-1211.slot2: chain 1.4865→1.4783 (-0.008), nec 19.143→19.129 (-0.014), front 19.143→19.129 (-0.014), back 160.857→160.871 (0.014)
preset:billy-qingyi-lucia.slack: 1.188 → 1.081 (-0.107)
preset:billy-qingyi-lucia.slot0: chain 1.2898→1.2727 (-0.017), basic 10.372→10.447 (0.075), nec 98.273→98.232 (-0.041), front 108.644→108.679 (0.035), back 71.356→71.321 (-0.035)
preset:billy-qingyi-lucia.slot1: chain 1.2898→1.2727 (-0.017), basic 10.372→10.447 (0.075), nec 38.115→38.082 (-0.033), front 48.419→48.519 (0.100), back 131.581→131.481 (-0.100)
preset:billy-qingyi-lucia.slot2: chain 1.2898→1.2727 (-0.017), nec 22.916→22.889 (-0.027), front 21.749→21.722 (-0.027), back 158.251→158.278 (0.027)
preset:auto-1091-1511-1211.slot0: chain 1.0988→1.0721 (-0.027), basic 16.155→16.229 (0.074), nec 80.361→80.315 (-0.046), front 89.648→89.676 (0.028), back 90.352→90.324 (-0.028)
preset:auto-1091-1511-1211.slot1: chain 1.0988→1.0721 (-0.027), basic 16.155→16.229 (0.074), nec 51.649→51.592 (-0.057), front 67.805→67.821 (0.016), back 112.195→112.179 (-0.016)
preset:auto-1091-1511-1211.slot2: chain 1.0988→1.0721 (-0.027), nec 20.831→20.786 (-0.045), front 20.831→20.786 (-0.045), back 159.169→159.214 (0.045)
preset:auto-1091-1031-1511.slack: 5.151 → 1.717 (-3.434)
preset:auto-1091-1031-1511.slot0: chain 1.3837→1.3731 (-0.011), basic 17.995→18.018 (0.023), nec 75.482→75.464 (-0.018), front 86.608→90.047 (3.439), back 93.392→89.953 (-3.439)
preset:auto-1091-1031-1511.slot1: chain 1.3837→1.3731 (-0.011), nec 17.984→17.979 (-0.005), front 17.984→17.979 (-0.005), back 162.016→162.021 (0.005)
preset:auto-1091-1031-1511.slot2: chain 1.3837→1.3731 (-0.011), basic 17.995→18.018 (0.023), nec 52.262→52.239 (-0.023), front 70.256→70.257 (0.001), back 109.744→109.743 (-0.001)
preset:auto-1541-1511-1411.slot0: chain 1.3769→1.2354 (-0.141), basic 14.656→15.127 (0.471), nec 66.928→66.588 (-0.340), front 80.467→80.599 (0.132), back 99.533→99.401 (-0.132)
preset:auto-1541-1511-1411.slot1: chain 1.3769→1.2354 (-0.141), basic 14.656→15.127 (0.471), nec 56.046→55.742 (-0.304), front 70.702→70.869 (0.167), back 109.298→109.131 (-0.167)
preset:auto-1541-1511-1411.slot2: chain 1.3769→1.2354 (-0.141), nec 27.715→27.415 (-0.300), front 27.715→27.415 (-0.300), back 152.285→152.585 (0.300)
preset:auto-1541-1561-1411.slack: 1.391 → 1.817 (0.426)
preset:auto-1541-1561-1411.slot0: chain 0.8174→0.7865 (-0.031), basic 7.064→6.955 (-0.109), nec 63.902→64.678 (0.776), front 69.850→69.667 (-0.183), back 110.150→110.333 (0.183)
preset:auto-1541-1561-1411.slot1: chain 0.8174→0.7865 (-0.031), basic 7.064→6.955 (-0.109), nec 79.430→79.363 (-0.067), front 84.828→84.652 (-0.176), back 95.172→95.348 (0.176)
preset:auto-1541-1561-1411.slot2: chain 0.8174→0.7865 (-0.031), nec 23.930→23.865 (-0.065), front 23.930→23.865 (-0.065), back 156.070→156.135 (0.065)
preset:auto-1541-1331-1581.slack: 1.049 → 1.674 (0.625)
preset:auto-1541-1331-1581.slot0: chain 1.2444→1.2358 (-0.009), basic 23.430→22.011 (-1.419), nec 79.626→79.605 (-0.021), front 98.858→98.268 (-0.590), back 81.142→81.732 (0.590)
preset:auto-1541-1331-1581.slot1: chain 1.2444→1.2358 (-0.009), nec 37.197→37.180 (-0.017), front 37.197→37.180 (-0.017), back 142.803→142.820 (0.017)
preset:auto-1541-1331-1581.slot2: chain 1.2444→1.2358 (-0.009), nec 42.896→42.878 (-0.018), front 42.896→42.878 (-0.018), back 137.104→137.122 (0.018)
preset:auto-1221-1511-1411.slot0: chain 1.7234→1.7445 (0.021), basic 21.806→21.740 (-0.066), nec 54.915→54.957 (0.042), front 76.721→76.697 (-0.024), back 103.279→103.303 (0.024)
preset:auto-1221-1511-1411.slot1: chain 1.7234→1.7445 (0.021), basic 21.806→21.740 (-0.066), nec 55.625→55.671 (0.046), front 77.431→77.410 (-0.021), back 102.569→102.590 (0.021)
preset:auto-1221-1511-1411.slot2: chain 1.7234→1.7445 (0.021), nec 25.848→25.893 (0.045), front 25.848→25.893 (0.045), back 154.152→154.107 (-0.045)
preset:auto-1221-1561-1411.slot0: ult 3.0000→4.0000 (1.000), chain 1.3728→1.2887 (-0.084), basic 11.382→10.538 (-0.844), nec 50.664→52.711 (2.047), front 62.045→63.249 (1.204), back 117.955→116.751 (-1.204)
preset:auto-1221-1561-1411.slot1: chain 1.3728→1.2887 (-0.084), basic 11.382→10.538 (-0.844), nec 81.467→81.285 (-0.182), front 92.849→91.823 (-1.026), back 87.151→88.177 (1.026)
preset:auto-1221-1561-1411.slot2: chain 1.3728→1.2887 (-0.084), nec 25.106→24.928 (-0.178), front 25.106→24.928 (-0.178), back 154.894→155.072 (0.178)
preset:auto-1401-1261-1411.slot0: chain 1.1398→1.1287 (-0.011), basic 12.177→12.213 (0.036), nec 90.765→90.742 (-0.023), front 94.975→94.989 (0.014), back 85.025→85.011 (-0.014)
preset:auto-1401-1261-1411.slot1: chain 1.1398→1.1287 (-0.011), basic 12.177→12.213 (0.036), nec 46.244→46.217 (-0.027), front 58.420→58.430 (0.010), back 121.580→121.570 (-0.010)
preset:auto-1401-1261-1411.slot2: chain 1.1398→1.1287 (-0.011), nec 24.613→24.590 (-0.023), front 24.613→24.590 (-0.023), back 155.387→155.410 (0.023)
preset:auto-1261-1561-1411.slot0: chain 1.5911→1.5475 (-0.044), basic 12.583→12.728 (0.145), nec 47.327→47.222 (-0.105), front 59.909→59.950 (0.041), back 120.091→120.050 (-0.041)
preset:auto-1261-1561-1411.slot1: chain 1.5911→1.5475 (-0.044), basic 12.583→12.728 (0.145), nec 81.940→81.845 (-0.095), front 94.523→94.574 (0.051), back 85.477→85.426 (-0.051)
preset:auto-1261-1561-1411.slot2: chain 1.5911→1.5475 (-0.044), nec 25.568→25.476 (-0.092), front 25.568→25.476 (-0.092), back 154.432→154.524 (0.092)
preset:auto-1261-1331-1411.slot0: chain 1.6964→1.7077 (0.011), basic 56.378→56.305 (-0.073), nec 54.862→54.889 (0.027), front 111.241→111.195 (-0.046), back 68.759→68.805 (0.046)
preset:auto-1261-1331-1411.slot1: chain 1.6964→1.7077 (0.011), nec 40.368→40.390 (0.022), front 40.368→40.390 (0.022), back 139.632→139.610 (-0.022)
preset:auto-1261-1331-1411.slot2: chain 1.6964→1.7077 (0.011), nec 28.391→28.415 (0.024), front 28.391→28.415 (0.024), back 151.609→151.585 (-0.024)
preset:auto-1331-1561-1411.slot0: ex 7.0000→8.0000 (1.000), chain 1.7077→1.6856 (-0.022), nec 38.123→38.079 (-0.044), front 38.123→38.079 (-0.044), back 141.877→141.921 (0.044)
preset:auto-1331-1561-1411.slot1: ex 17.0000→18.0000 (1.000), ult 4.0000→5.0000 (1.000), chain 1.7077→1.6856 (-0.022), basic 33.869→27.108 (-6.761), nec 82.192→86.444 (4.252), front 116.062→113.552 (-2.510), back 63.938→66.448 (2.510)
```

**原计划（保留作记录）**：
- **范围**：6 号位 `impact`、`anomalyMastery` 主词条改按 pct；31200 2 件套改为 `impact / pct / 6`；roughStats 同步。
- **开工步骤**：
  1. 找 statRules 和 31200 2 件套的生成源头：`timeout 40 git grep -n "sRankMaxMainStat\|effect_wiki_152_2pc\|statDisplay" -- scripts data`。如果 catalog 由脚本生成，就在脚本里改，并重新生成；如果是手写，直接改 catalog。
  2. 结算口径不能再从 `display` 推断。在 `statRules.driveDisc` 下新增显式映射（建议名 `statSettlementMode`，值 `pct` / `flat`，按 build-recommendations 的 `format` 是否带 `%` 填写），`core/panel.ts` `inferStatMode` 改为先读它，缺失时再回退 `display`。回退点：删掉这个映射即恢复旧行为。新字段要同步 `src/types/catalog.ts` 的 `StatRules` 类型。
  3. `core/buff.ts:551` roughStats：`impact` / `anomalyMastery` 按同一映射计算（pct：`level60 × (1 + maxMain / 100)`）。
  4. 测试：改写 `discSetEffects.test.ts:407`（期望值改为 `1481 基础冲击力 × 0.18`）；新增夹具，断言 6 号位异常掌控按 pct、31200 2 件套按 pct；`statModeParity.test.ts` 按需调整。改写 `panel.ts:188–215` 头注释：写明 R27-J2 被 D15 推翻，证据是 build-recommendations 的 format 与 prop。
  5. 验证：`npx vue-tsc -b`、`npm run verify`、check-guards、`bash .zc/perf/zd.sh cc100`。**预计非零差**，每一条 golden 差异都必须能归到「6 号位 impact / anomalyMastery」或「31200 2 件套」两个原因之一，出现无法归因的差异就停下查原因。
- **与 R5 硬约束的关系**：这不是「顺手改数值」，而是先登记（D15、D16）再立卡；判据是源数据原文（nanoka 的 format / desc2），不是投稿或实测。

### CC-101（D8）同互斥组的全队效果只计一次 ✅ done（第 127 轮，提交号见 git log「fix(CC-101)」）

**实际做法**：
- 先红后绿：新建 `src/core/__tests__/discExclusiveGroup.test.ts`（三人队 1411 / 1241 / 1031），修前「两人同穿 31900」实测全队 `[30, 30, 30]`，复现 D8；修后 `[15, 15, 15]`。
- `src/types/catalog.ts` `BuffGroup` 新增 `exclusiveGroup?: string`。
- `src/core/inCombatBuffs.ts` `collectInCombatTeamBuffs`：队伍循环外维护 `grantedExclusiveGroups`，同组第二次出现时不再推入。先到先得：按槽位顺序，取第一个**通过门槛**的穿戴者（去重在门槛判定之后）。
- 范围口径（拍板）：只对数据显式标了 `exclusiveGroup` 的组去重。其余 6 套带 teamBuff 的 4 件套数据没标，**不**推断互斥；测试钉住「摇摆爵士两人同穿 = +30」与「只有 31900 标了 exclusiveGroup」两条前提。若日后数据给其他套装补标，代码无需改动；若要改成「所有同名 4 件套 teamBuff 都互斥」，回退点是把 `exclusive` 的取值改为 `group.exclusiveGroup ?? set.id`，并改写该测试。
- 验证：`zd.sh cc101` DUMP DIFF 0 / ROWS DIFF 0（现有预设没有同穿原始朋克的队伍），vue-tsc 0，verify 与 check-guards 全绿。

**原计划**：
- 先写夹具复现（两名队友同穿 31900 原始朋克 4 件套 → 断言 dmgBonus 只 +15），再在 `core/inCombatBuffs.ts:164–190` 按 `group.exclusiveGroup` 去重。只影响重复穿戴场景，golden 预计零差。

### CC-102（D19）音擎 effect 级 requirement 生效 ✅ done（第 128 轮，提交号见 git log「fix(CC-102)」）

**实际做法**：
- 先红后绿：新建 `src/core/__tests__/wengineEffectRequirement.test.ts`，修前「简 1261 装 14150」实测 anomalyDmgBonus +10（复现 D19），修后 0；爱芮 1501 仍 +10 / +10 / +90。
- `src/core/wengineConditions.ts`：`WEngineConditionContext` 新增 `wearerSpecialty`；新增 `wEngineEffectRequirementMet(req, ctx)`，按装备者 specialty / attribute 判定，与驱动盘同口径。装备者信息缺省时不拦截（与本文件「未声明不拦截」的既有口径一致，测试夹具不受影响）。`outOfCombatStat` 在音擎数据中 0 处，不判定。
- `src/core/buff.ts` `collectWEngineBuffs`：逐 effect 过 requirement；`collectAllBuffs` 调用处补传 `wearerSpecialty`。
- `src/core/inCombatBuffs.ts` 音擎 teamBuff 通道：同样按**装备者**过 effect 级 requirement（当前数据 0 处，零差，只为口径统一）。
- 验证：`zd.sh cc102` DUMP DIFF 0 / ROWS DIFF 0（现有预设没有非以太角色装 14150）；vue-tsc 0；verify 与 check-guards 全绿。
- **回退点**：删掉 `collectWEngineBuffs` 和 inCombatBuffs 里那一行 `wEngineEffectRequirementMet` 过滤即可恢复原行为。

### CC-103（D18）14155 日冕遗蜕以太抗性无视限定佩洛伊斯 ✅ done（第 129 轮，提交号见 git log「fix(CC-103)」）

**实际做法**：
- 先红后绿：新建 `src/core/__tests__/wengineWearerAgent.test.ts`，修前朱鸢 1241 装 14155 实测 `enemyEtherResReduction` +16（复现 D18），修后 0；佩洛伊斯 1551 仍 +16，两人暴击率 +20 不变。
- `src/types/catalog.ts` `EffectRequirement` 新增 `wearerAgentIds?: string[]`（装备者名单，数据声明、引擎通用判定）。
- `src/core/wengineConditions.ts`：ctx 新增 `wearerAgentId`；`wEngineEffectRequirementMet` 增加名单判定（ctx 缺省不拦截）。
- `src/core/buff.ts` `collectAllBuffs` 与 `src/core/inCombatBuffs.ts` 音擎 teamBuff 通道补传 `wearerAgentId: agent.id`。
- `public/static/catalog.json`：14155 effect `effect_wiki_2031_self_ether_res_ignore` 补 `"requirement":{"wearerAgentIds":["1551"]}`（node 解析改写，断言单行格式不变、锚点唯一且原无 requirement，+42 字节）。
- **守卫核对**：core agentId 棘轮只扫 `src/core/resource.ts`、`src/core/resource/helpers.ts`（`scripts/lib/agent-branch-ratchet.mjs:157`），且度量的是字面身份判定；本改动在 core 里只比较数据给出的名单，不含任何角色 id 字面量，符合棘轮提示的「engine 读字段、不读 agentId」。
- 验证：`zd.sh cc103` DUMP DIFF 0 / ROWS DIFF 0（现有预设没有非 1551 角色装 14155）；vue-tsc 0；verify 与 check-guards 全绿。
- **拍板**：14155 的 `verification.effectBuff = "partially-modeled-agent-restriction"` 未改——「处于日蚀效果」仍由覆盖率兜底，仍属部分建模，标签继续成立。
- **回退点**：删掉 catalog 里那一个 `requirement` 即恢复原数值；类型与判定函数是纯增量，可保留。

### CC-104（D20）coverage 数据前提钉 + 音擎字段页覆盖率展示修正 ✅ done（第 130 轮，提交号见 git log「fix(CC-104)」）

- 新测试 `src/core/__tests__/coverageDefaultInvariant.test.ts`：递归 wEngines / driveDiscSets / agents，断言 `coverage.default` 全为 1（>100 处）。
- `src/views/WEngineFieldPage.vue` `stackCoverageText`：新增 `pctText`，coverage 的 default / min / max / step 乘 100 显示。
- 不触及计算路径，未跑 zd；vue-tsc 0，verify 与 check-guards 全绿。

### CC-105（D21）skillTag `assistAttack` 归一到招式族 `assist` ✅ done（第 131 轮，提交号见 git log「fix(CC-105)」）

**实际做法**：
- 先红后绿：新测试 `src/core/__tests__/skillTargetsCoverage.test.ts` 遍历 catalog 中所有带 `skillTargets`（且无 `targetSkillType`）的效果（14 个），对每个效果调 `applyEffect`，断言只写 `<stat>__<target>` 键、目标集合与数据一致；另断言数据里出现的每个目标都在 `SKILL_DMG_TARGETS` 内。修前唯一失败项 `effect_chaos_jazz_4pc_skill_dmg: got=exSpecial want=assist,exSpecial`。
- `src/core/buff.ts`：三行 skillTag 判断改为表 `SKILL_TAG_TARGET`（exSpecial / dashAttack / additionalAttack / **assistAttack → assist**）。口径依据：`core/damage.ts:52` categoryId `assist` → 招式族 `assist`，即「支援技」行（快速支援 / 招架支援 / 支援突击）。
- **零差比对**：`zd.sh cc105` DUMP DIFF 30 / ROWS DIFF 32，涉及 5 个预设：`auto-1091-1221-1581`、`auto-1221-1511-1211`、`auto-1221-1511-1411`、`auto-1221-1561-1411`、`auto-1561-1171-1411`。归因：build-recommendations 里 4 件套推荐 31800 的只有 1171 柏妮思、1221 月城柳；全库含 1171 或 1221 的预设**恰好就是这 5 个**，一一对应，且全部为伤害上升。代码改动只影响 skillTag = assistAttack 的效果，catalog 中仅此 1 处，因此不需要反向验证。
- **golden 更新**（`timeGolden.baseline.json`，时间账零变化，只有 dmg 变）：

| 预设 | 旧 dmg | 新 dmg | 变化 |
|---|---|---|---|
| auto-1091-1221-1581 | 97130917 | 97159283 | +0.029% |
| auto-1221-1511-1211 | 88654941 | 88689156 | +0.039% |
| auto-1221-1511-1411 | 80818649 | 80851208 | +0.040% |
| auto-1221-1561-1411 | 48385896 | 48414872 | +0.060% |
| auto-1561-1171-1411 | 48462037 | 48916388 | +0.938% |

  柏妮思队涨幅最大，因为它的支援技行占比高于月城柳队；每条都是「31800 装备者的支援技行 +20% 增伤 × 覆盖率 1」。
- 验证：vue-tsc 0；verify 与 check-guards 全绿。
- **回退点**：从 `SKILL_TAG_TARGET` 删掉 `assistAttack` 这一行，并还原 `timeGolden.baseline.json` 的 5 个 dmg。

### CC-106（D22）buffModifiers 数据前提钉 ✅ done（第 132 轮，提交号见 git log「test(CC-106)」）

- 新测试 `src/core/__tests__/buffModifiersIntegrity.test.ts`：① catalog.json 所有 `buffModifiers` 为空（>50 处）；② teammate-buffs.json 修饰器 operation 只能是 `multiplyResolvedValue`、factor 为有限数、目标 buff / effect 全部可解析、目标 type ∈ fixed / formula / derived / stacked。
- 只加测试，不改代码与数据，未跑 zd；verify 与 check-guards 全绿。

### CC-107（D24 + D25）效果数值形态钉 + 蕾米埃尔 sourceStat 口径钉 ✅ done（第 133 轮，提交号见 git log「test(CC-107)」）

- 新测试 `src/core/__tests__/effectValueInvariant.test.ts`（type 四种、fixed 有 value、stacked 有 valuePerStack / maxStacks 且 value 只能等于 valuePerStack、defaultStacks ≤ maxStacks、modificationValues 长 5 且首项等于基础值）。
- 新测试 `src/core/__tests__/remielleSourcePhase.test.ts`（3 组配置下 coef / bonus = 局外 AP × 0.02 / 0.2，且确有局内 AP 加成未计入）。
- 只加测试，不改代码与数据；verify 与 check-guards 全绿。

### CC-108（D26）4 件套属性门槛改读精确局外面板 ✅ done（第 134 轮，提交号见 git log「fix(CC-108)」）

- 代码：`core/buff.ts` 删 `roughStats` 粗算与 `driveDiscStatMode` 导入，`DiscSetRequirementContext.roughStats` → `outOfCombatStats`，新增导出 `discSelfBuffNeedsOutOfCombatPanel`；`collectAllBuffs` 新增 `config.outOfCombatStats`；`core/panel.ts` `calcPanel` 两段式。注释同步：`inCombatBuffs.ts` `discTeamRequirementMet`、`wengineConditions.ts`、`docs/ENTITY_CARDS.md`。
- 测试（`discSetEffects.test.ts`）：
  - 1071 凯撒无防主词条：753.9 × 1.16 + 184 = 1058.5 ⇒ 第一档 +8（原断言 0，原因是粗算漏本套 2pc）。
  - 跨阈改为 1561 防%副词条 4 步（1012.2 发）/ 3 步（982.8 不发），184 与 2pc 16% 各自决定结果。
  - 新增 1611 + 14161（音擎白值与副属性，1614.3 ⇒ 只发第一档）、1111 + 14151 + 6 号位掌控（137.6 ≥115 ⇒ 4pc 暴伤 30 发放）。
  - 删除「`roughStats` 不得再有 critRate 键」的源码形状用例（对象已删除；它防的「粗算值错」问题随粗算一起消失，山大王行为用例保留）。
- **zd**：DIFF 12，全部在 claret-roxy-rina / claret-koleda-rina。
- **golden delta**（timeGolden 已重生成）：

| 预设 | 伤害 | 变化 | 解释 |
|---|---|---|---|
| claret-roxy-rina | 151327785 → 152559072 | +0.814% | 1611 克拉蕾带 14161 + 34200：局外防御 ≈1614 ⇒ 荆棘玫瑰第一档暴击率 +8% 生效（修前粗算 625 不生效）；时间账零变化 |
| claret-koleda-rina | 31590551 → 32450899 | +2.723% | 同一原因；队伍总伤小得多（洛克茜队总伤约为本队 5 倍），克拉蕾占比高，涨幅更大 |

- 验证：vitest discSetEffects 31/31、verify、check-guards 25/25、vue-tsc -b 通过。

### CC-109（D28）洛克茜强特耗能按 10 + 30/s × 自旋秒扣 ✅ done（第 135 轮，提交号见 git log「fix(CC-109)」）

- 代码：`src/mechanics/agents/roxy.ts`（`roxyExEnergyCost`；`buildRoxyCharConfig` 设 `cfg.exSpecialEnergyConsume`；小心风寒 / 自旋两行的耗能）。spec `src/specs/agents/1621.json` 注记同步。
- 测试：新增 `src/mechanics/__tests__/roxyExEnergyCost.test.ts`（解析值 10 / 30；管线单发耗能 = 10 + 30 × spin，spin 2.5 与 1 两点；执行行耗能合计 = 次数 × 单发耗能且 ≤ 能量总收入）。反向验证：换回修前 roxy.ts ⇒ 「expected 10 to be close to 85」红。
  `roxyWindEyeTiming.test.ts` 两条采样假设随强特次数下降而失效，已改：负控 B 改为 spin 0.5 / 1 / 1.5 / 2 至少一个分叉；③ 的「sendOff > 3」只在总眼数 > 9 时判定，并要求至少一个采样点总眼数 > 9。
- **zd**：DIFF 30，全部是含洛克茜的 5 个预设。
- **golden delta**（timeGolden 已重生成）。共同原因：洛克茜强特次数 ≈80 → ≈10（每发耗能 10 → 85），随之失衡次数、喧响 / 终结技次数、队友的失衡窗口伤害都下降；空出的前台时间转为普攻。

| 条目 | 伤害 | 变化 | 失衡次数 | 洛克茜强特次数 |
|---|---|---|---|---|
| agent:1621:c0 | 11806314 → 2141782 | −81.9% | 4 → 2 | 79.07 → 10.25 |
| agent:1621:c3 | 17275923 → 3012697 | −82.6% | 4 → 2 | 79.07 → 10.25 |
| agent:1621:c4 | 17774882 → 3040796 | −82.9% | 4 → 2 | 81.67 → 10.56 |
| agent:1621:c5 | 19204163 → 3280981 | −82.9% | 4 → 2 | 81.67 → 10.56 |
| agent:1621:c6 | 29567487 → 4398273 | −85.1% | 5 → 2 | 81.17 → 10.56 |
| preset:yixuan-roxy-lucia | 134512142 → 61694634 | −54.1% | 5 → 3 | 77.17 → 9.02 |
| preset:yidhari-roxy-lucia | 126948040 → 47766232 | −62.4% | 4 → 2 | 83.26 → 10.15 |
| preset:billy-roxy-lucia | 129190388 → 48597051 | −62.4% | 5 → 2 | 77.17 → 9.28 |
| preset:banyue-roxy-lucia | 112533258 → 38458479 | −65.8% | 5 → 2 | 74.91 → 8.86 |
| preset:claret-roxy-rina | 152559072 → 47295670 | −69.0% | 5 → 2 | 87.10 → 10.58 |

- **留白棘轮**（`timeFillRatchet.baseline.json` 已重生成，11 条全在洛克茜预设）：失衡次数 yixuan 4→3、yidhari / claret / banyue / billy 4→2；留白 yixuan 0→1.1s（强特少了、前台时间出现空档）、yidhari 1.7→1.6、claret 0.1→0、banyue 0.1→0；外层收敛出口 billy stable→cycle、claret cycle→stable。留白变差只有 yixuan 一条，原因同上，接受。
- **回退点**：只需还原 `roxy.ts` 里 `cfg.exSpecialEnergyConsume` 那三行和两行 `energyConsume`，再重生成 golden 与留白棘轮基线。
- 验证：vitest roxy 相关全绿、verify、check-guards、vue-tsc -b。

### 其余（零差、界面层）
- D7：带 `durationSeconds` 的 fixed 效果显示覆盖率滑块（默认值不变）。
- D3：覆盖率按 `stackGroup ?? id` 联动。
- D14：蕾米埃尔 canTriggerLuminize 集合与模块硬编码的一致性单测。
