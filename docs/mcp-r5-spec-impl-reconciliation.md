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
| Z1 | `damageBasis` | agentSkills 的倍率行 | 2490 | 0 / 4 | 伤害按什么属性结算（攻击 / 生命 / 防御 / 贯穿力等）。引擎若按别的来源判定，就要核对两者是否一致 | 待核 |
| Z2 | `appliesToOutOfCombatPanel` | 音擎 selfBuff / teamBuff | 95 | 0 / 0 | 这条 buff 是否计入局外面板。引擎完全不读，靠别的逻辑决定，**与 basis 问题同源** | **已核：无差异（冗余字段）**，见 §7 D1 |
| Z3 | `durationSeconds` | 音擎 / 驱动盘 / Boss 效果 | 80 | 1 / 3（只有 piper.ts） | 持续时间。引擎可能用 `coverage`（覆盖率）代替。要确认两者口径是否一致，还是持续时间被忽略了 | 待核 |
| Z4 | `stackGroup` | 效果 | 23 | 0 / 0 | 同组效果是否互斥或共享层数。**完全不读就可能重复叠加** | 待核（优先） |
| Z5 | `statRules.calculation.baseAttackRule` / `baseHpRule` / `baseDefRule` | statRules | 各 1 | 0 / 0 | 基础属性的计算规则。引擎可能自有实现，要对照规则文本 | 待核 |
| Z6 | `statRules.calculation.outOfCombatEffectFilter` | statRules | 1 | 0 / 0 | 哪些效果计入局外面板的过滤规则。**与 Z2、basis 是同一个问题** | **已核：当前数据等价，潜在差异**，见 §7 D2 |
| Z7 | `exclusiveGroup` | 驱动盘 teamBuff | 1 | 0 / 0 | 互斥组。与 Z4 类似 | 待核 |
| Z8 | `settlementType` | 音擎 target | 4 | 0 / 1 | 结算类型 | 待核 |
| Z9 | `cooldownSeconds` | 音擎 / 驱动盘效果 | 3 | 0 / 3 | 冷却。引擎可能用覆盖率吸收了 | 待核 |
| Z10 | `weaknessElements` / `resistanceElements` / `resistanceOverrides` | Boss target | 各 7 | 0 / 0–2 | Boss 的弱点与抗性。引擎可能读的是别处的敌人配置，要确认两个来源一致 | 待核 |
| Z11 | `attackTypes` | agents | 62 | 0 / 0 | 攻击类型（斩击、打击等）。影响某些条件效果 | 待核 |
| Z12 | `relatedAgentId` | 音擎 | 5 | 0 / 0 | 专属音擎对应的角色。可能只影响推荐，不影响计算 | 待核（可能是 D / M 类） |
| Z13 | `statRules.statDisplay.*SheerDmg` / `*CritDmg` 等 | statRules | 各 1 | 0 / 1–5 | 名字像展示配置，但字段名是属性名。要确认引擎有没有对应的属性 | 待核（可能是 D 类） |
| K0 | `basis` | 音擎 / 驱动盘效果 | 22 | 6 / 11（同名假非零） | **已知差异**：CC-96 确认引擎不读 catalog 效果的 basis，按首次触达时的面板值累积。R5 原文把它列为起点 | 已知，待写修复卡 |

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
- [~] 第 2 刀（进行中，第 121 轮完成 Z2、Z6，见 §7；剩余 Z4、K0 和字段归类）：215 种字段按 §2 归类（S / D / M），并逐条核实 Z4、Z6、Z2、K0，写成 D 条目。
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
