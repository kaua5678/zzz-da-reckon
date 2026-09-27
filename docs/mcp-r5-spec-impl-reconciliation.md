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
- [ ] 第 3 刀：核实其余 Z 类，并按 §4 做 S 类字段的取值 × 分支对照。
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

### D8 `exclusiveGroup`（Z7）：零读取，同套驱动盘 4pc 全队效果多人穿戴时重复叠加 → 真实差异（仅重复穿戴场景）
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
- 拿不准按 S（§2 规则）：`rarity`、`isTeammateOnly`、`teammateBuffId`、`basicBenchmarkMoveId`、`ownerAgentId` 等放在「S 待第 3 刀」。
