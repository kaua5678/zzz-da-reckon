# 下位音擎择优：只留一份实现（r735）

> 代码提交 `6163ff4c`（arena-G r735）；arch CC-517；r6 §8.0 #32 与 §8 第 735 行。
> 一句话：「没穿专武时穿哪把下位」原来有两份实现——队伍对比的自动下位和自由对比的无专武档，各写一遍试穿循环和精炼口径。现在两边都调 `downgradeWEngine.ts`，候选从哪来仍各管各的。

## 1. 起点（origin `c8104e59`）

| | 队伍对比自动下位 | 自由对比无专武档 |
|---|---|---|
| 入口 | `teamCompare.computeAutoEnginePicks`，每队一次 | `freeCompare/engine.ts#pickDowngradeByDamage`，经 `makeDowngradeResolver` 按 (队友组合, 角色, 命座) 缓存 |
| 候选来源 | 页面装填框或预设 `autoEngine` 声明的池（bySlot > byAgent > 整队 > 页面 > 默认五件），可含限定 | 目录里同职业、非专属（`ownerAgentId` 空）、非限定的音擎 |
| 精炼 | 限定 1；A 级缺省 5、常驻 S 缺省 3，页面或预设可覆盖，钳到 1–5 | A 级 5、常驻 S 3；`mods` 参数可覆盖，但生产代码从没传过 |
| 展示名 | `名字 R精炼`，限定加「（限定）」 | `名字 R精炼` |
| 择优判据 | `!best \|\| damage > best.damage` | `Number.isFinite(dmg) && dmg > bestDmg` |
| 单件池 | 照样试算 | 直接穿上，不试算 |
| 没有可选的 | 不会出现：第一件总会先被选中 | 返回 null，store 停在最后一件，解析器再写空音擎 |
| 试算次数 | 不统计 | `computeFreeCompare` 发现缓存变大后重新枚举候选，按「池大小 > 1 ? 池大小 : 0」估算 |

缺省精炼 5 / 3 一共写了三份：`TeamComparePage.vue` 两个输入框的初值、`computeAutoEnginePicks` 里 `clampMod` 的兜底、`engine.ts#downgradeCandidates`。两份实现靠注释「同思路」「同口径」维持；`engine.ts` 里引用 teamCompare 的行号（`:523-524`、`:530-533`、`:651-653`）和 `config.ts:594-599` 都已过期。

判据也已经分叉：队伍对比那份不查读数是否有限。第一件读数为 NaN 时，后面的 `damage > NaN` 恒为假，NaN 那件会一直胜出。

## 2. 改法

- **新模块 `src/composables/downgradeWEngine.ts`**，不依赖 teamCompare，避免两者互相导入：
  - `DOWNGRADE_MODS = { aRank: 5, standard: 3 }`：缺省精炼只在这里写一次。
  - `downgradeCandidateOf(w, mods)`：把目录音擎转成 `DowngradeCandidate { id, mod, label, limited }`。限定按本体 R1，判定用 `isLimitedSWengineId`：`w` 来自目录，id 已经是主 id，用不着 `isLimitedWEngine` 那一步别名解析。
  - `wearBestWEngine(calc, configStore, slot, candidates)`：逐件试穿，把伤害最高的那件留在 store。规则：
    - 读数非有限不选，并列取先出现的；
    - 只有一件时直接穿上，不试算；
    - 没有可选的，就把槽位还原成试穿前的音擎和精炼，`pick` 为 null；
    - 返回 `{ pick, evaluations }`，`evaluations` 是实际试算次数。
- **队伍对比**：`computeAutoEnginePicks` 只保留三件事：解析池、跳过基础音擎是限定的槽位、算精炼覆盖（`clampMod` 的兜底改读 `DOWNGRADE_MODS`）。每个槽位一行：`wearBestWEngine(…, 池.map(w => downgradeCandidateOf(w, mods)))`。`AutoEnginePick` 改为 `DowngradeCandidate` 加 `slot`。
- **自由对比**：
  - 删掉 `pickDowngradeByDamage` 和本文件里的 `DowngradeCandidate`；
  - `downgradeCandidates(catalog, agentId)` 去掉 `mods` 参数，候选由 `downgradeCandidateOf` 生成，再滤掉限定；
  - 解析器把 `wearBestWEngine` 返回的试算次数累加到 `evaluations` 字段，`computeFreeCompare` 直接报它。原来那段「缓存变大就重新枚举候选、按池大小估算」删除，解析器的 `size` 和 `lastPicked` 两个字段也随之删除（`resolve` 本来就返回选中件）。
- **页面**：`TeamComparePage.vue` 两个精炼输入框的初值读 `DOWNGRADE_MODS`。
- **注释**：`engine.ts` 和 `freeCompareEngine.test.ts` 里过期的行号引用改成函数名。
- **测试**：没有新增用例。`teamCompare.test` 里「默认池」那条断言从 `toContain` 收紧为「取池内第一件」：默认五件在该用例的打分下全是 0 分，并列取先。

## 3. 行为

有效输入上结果不变。只有两处不同：

- 队伍对比的单件池不再试算：少一次全量求值，选中的件不变。
- 队伍对比里读数非有限的候选不再能胜出；全部非有限时，该槽不出结果，槽位还原成试穿前的音擎。引擎读数恒为有限值，这种输入不会出现。

自由对比 `pickEvaluations` 的口径不变：单件 0 次，多件等于池大小，缓存命中 0 次。区别只是改由实际试算返回，不再另外估算。

## 4. 验证

- vue-tsc 0；相关测试 7 个文件 85 例；guards 29（判据 28 / 29 = 0/0，扫 298 个文件）；zc.test + checkGuards.test 207。
- tokens 12 / data 161 / specs 462 / recording 189。
- vitest 261/2165 + 263/2342 = 524/4507，与 r734 基线相同。
- zd DUMP 0 / ROWS 0；zc drift 154/0/0。
- build `index-D2_W00Uq.js` 1599.47 kB（`c8104e59` 为 1599.17 kB）。多出的 0.3 kB 没有细查。
- **探针**（不入库，`calc-arch/g735/zz735probe.test.ts`）：同一工作区改前、改后各跑一次，逐字段相同。
  - a，队伍对比：19 个带 goldSteps 的预设，目标金 0–14，开最优加金并收集试算（175 个点、655 条试算），用默认装填池。
  - a2，同上，池换成默认五件加目录里全部 43 件限定 S 音擎。有 11 个点穿上了限定下位，标签带「（限定）」，并计入「含下位限定 N 金」。
  - a3，两组：
    - 全部 104 个预设，精炼覆盖为 A 级 3、常驻 2，0 金，不开最优加金（走 `applyGoldToStore`）；
    - 19 个预设，单件池 `['13115']`，走新加的「单件不试算」分支。
  - f，自由对比无专武档，比对数值、下位注记和择优试算次数，共 4 组：
    - 15 个单人，0–2 命，基底队友维琳娜；
    - 两支整队，配置码分别为 20 和 00；
    - 5 个单人，条件为维琳娜 2 命、无专武。
    - 另外比对 62 个角色的下位池（id、精炼、展示名）。
- **反例**（`neg735.sh`）：
  - 并列改成取后（`>` 改成 `>=`）：队伍对比 2 例变红。默认池取到 14121，期望 13005；预设级 poolRef 池取到 13005，期望 14110。
  - 永远留第一件：自由对比「挑伤害最高的下位」变红。柏妮思穿的是 13008，实测最高的是 13009。
  - 两次改动都已还原。
- **普查**：62 个角色的无专武下位池只有 2 件、3 件、5 件三种大小（分别有 9、35、18 个角色），没有单件池。所以在现有数据上，自由对比走不到单件分支；队伍对比的单件池只会来自预设 `autoEngine` 声明，或者页面装填框里只留了一件。

## 5. 不做

- **候选来源不合并**：队伍对比的池由用户或预设作者显式给出，可以含限定，跨职业的件交给试算自然淘汰；自由对比按「同职业、非专属、非限定」从目录推出候选。两边的口径来自不同的用户裁决，合并就得改掉其中一边的语义。
- **缓存不合并**：自由对比按 (队友组合, 角色, 命座) 缓存，因为同一个键会在一轮对比里跨档位重复出现；队伍对比每队只择优一次，用不着缓存。
- **`wearBestWEngine` 不改成收 `readDamage` 回调**（`goldGreedy.takeBestGoldStep` 收的是回调）：两个调用方读的都是 `calc.teamTotalDamage`，直接收 `Pick<ResourceCalc, 'teamTotalDamage'>` 更简单。
- **不为非有限读数加用例**：引擎读数恒为有限值，这条分支只防不可能的输入（反臃肿规矩）。「并列取先」已经有两条用例钉住（见第 4 节反例第一条）。
- **`isLimitedWEngine` 不动**：store 里的 id 仍要靠它解析别名；`downgradeCandidateOf` 收的是目录音擎，直接用 `isLimitedSWengineId`。
- **`substituteAutoEngines` / `countLimitedAutoApplied` 不动**：它们管的是择优结果怎么并进配装态、怎么计金，与择优本身无关。

## 6. 下一轮候选（r736 已做）

**一次性探针 `freeCompare/__tests__/freeCompareDowngradeProbe.test.ts` 仍在默认套件里跑。** 它是 2026-09-15 的探针（`b3603215`），共 74 行：加载推荐配装，对柏妮思、菲欧妮、维琳娜三人各算专武本体、三把 A 级异常音擎和裸奔的伤害，再用 console.log 打出来。唯一的断言是 `rows.length > 0`。它的结论（裸奔比专武低 34–41%，三把 A 级之间差 3–8pp）已经写进 `engine.ts#applyCodeToSlot` 的注释；「挑伤害最高的那把」由 `freeCompareEngine.test` 的「★★」用例钉住（见第 4 节反例第二条）。

可以删掉这个文件，或者改成只在设了 env 时才跑；同时把 `engine.ts` 注释里的出处改成「一次性探针（已删，数字见本注释）」。删之前先确认没有别处引用它，并按规矩更新 vitest 基线（少 1 个文件、1 例）。

> r736（`4285fce2`）已做：连同普查出的 `zzz_ysg_probe`、`diag-stun` 一起删掉，`engine.ts` 注释出处改指 `b3603215`。基线归因见 `docs/mcp-default-suite-probes.md`。

## 7. 回退

`git revert 6163ff4c`（文档另提交）。
