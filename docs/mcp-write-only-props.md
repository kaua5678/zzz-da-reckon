# 接口属性「只写不读」普查（CC-190）

> lead-arena-0925c · 2026-09-28 第 213 轮。代码提交 `f516e95f`。
> 复跑：仓库根执行 `node scripts/audit-write-only-props.cjs > /tmp/wo.tsv`（约 2–3 分钟）。
> 列：声明位置 / 字段 / opt|req / 写入数 / 测试读取数。第 213 轮删完后是 148 条；第 214 轮补上 JSON 语料后降到 100 条；CC-191 清掉 T1 的 20 条后预计约 80 条。
>
> **⚠ 第 214 轮勘误**：第 213 轮版本的名字兜底**没扫 JSON**，而 spec 解释器按字符串键读 cfg（`countField` / `initialValueField` / `enabledField`…，键名只在 `src/specs/agents/*.json` 里）。结果原 T1 的 37 条里有 **17 条其实被 spec 读取**，按旧表删会出错。脚本已补 JSON 语料（§3），下面的表都是补后重新生成的。

## 0. 结论

- **起因**：CC-189 的 `LevelOverride.gold` 在注册表里写、求值器从来不读，结果是一个用户可见的假选项。现有死通道扫描（`scripts/lib/dead-channel-scan.mjs`）A 段报「零读零写」、B 段报「只读不写」，**都按名字全仓计数**。`gold` 这种常见名在别处被读过就洗白了，所以按名字永远扫不出来。
- **方法**（脚本头注释有详细说明）：
  - ① TS LanguageService 按**符号**查引用，生产代码零读取的属性入候选；
  - ② 再按名字在全 src（含 .vue）找任何形式的读取（成员访问、字符串键、解构、裸名运算），一个都没有的才留下。
  - 为什么要两段：只用 ①，1182 条，大量是内联结构类型参数读取（`cfg: { x?: T }`，引用连不到接口上）和 .vue 读取；加上 ② 后剩 158 条。② 会因同名局部变量漏报，宁漏不误，所以输出是**高置信候选，不是判定**。
- **不做成守卫**（决定）：噪音形态需要人工分诊（结果对象被测试读、JSON 数据类型字段、给 UI 预留的元数据），做成红灯会逼人为了变绿乱删。脚本以只读审计的形式留在 `scripts/audit-*` 系列。回退：删掉该脚本即可。
- **有没有真 bug**：逐条查了所有「输入 / 开关 / 契约」类候选，**没有发现数值 bug**。发现的是 5 个误导性的假契约字段和 1 处常量双源，已在 CC-190 修掉（§1），zd DIFF 0。其余是死暂存、死展示字段，留给低级模型清理（§2）。

## 1. CC-190 已处理（f516e95f）

| 字段 | 问题 | 处理 |
|---|---|---|
| `core/damage.ts` 两个入参接口的 `enemyLevel` | 伤害公式固定按**攻击方 60 级**（794 常量，:73 注释），敌人等级从来不参与计算；调用方 `poolDamage.ts` 照传 `env.enemy.level`，看起来像生效了 | 删掉字段和 2 处生产写入、9 处测试写入 |
| `AxisContext.ultimateTotalBySlot`（`mechanics/types.ts`） | 零读取；模块实际读的是 `cfg.axisUltimateTotal` | 删掉字段、convergence 注入和 3 处测试夹具 |
| `CrossAgentSupplyInput.targetState`（`typesHooks.ts`） | 零读取 | 删掉字段和 `crossAgentSupply.ts` 注入 |
| `InCombatTeamBuff.includeOwner` | 冗余标签：排除装备者**实际由 `excludeTargetAgentIds` 实现**。只改这个标签不会有任何效果，是个会误导人的假开关 | 删掉；`InCombatTeamBuff` 改为 `TeammateBuff` 别名；头注释改写为真实机制；`specs/types.ts` 注释同步 |
| `BossAnomalyStateResult.stunsTotal` | 注释声称「事件总次数按 stunsTotal 缩放」，实际消费端 `damagePoolRelease.ts` 按 `windowEntryIdx` 逐条目加权，从来不读它。CC-155（第 178 轮）改过它的来源，当时文档已记下「1082 零影响」 | 删掉字段和注入 |
| 爱丽丝 6 命 `C6_DAMAGE_RATIO` / `C6_MAX_TRIGGERS_PER_STATE` | **常量与字面量双源**：伤害行写死 `skillMultiplier: 3300`，设置项写死 `max: 6`，同名常量只写进 cfg 的 3 个死字段。改常量不会生效 | 伤害行改为 `C6_DAMAGE_RATIO * 100`，设置项改为 `max: C6_MAX_TRIGGERS_PER_STATE`；删掉 cfg 死写和 `config.ts` 3 个字段 |
| freeCompare `MetricDef.higherBetter` | 零读取，但它是**真实的方向元数据**（含 3 个 false）；注释声称「表格胜负着色」，这个功能并不存在 | **保留**，注释改实话（标明无消费方）。要做着色时直接用它 → **CC-204（第 227 轮）已实现着色，现有消费方 `bestSeriesIndexByLevel`** |

验证：vue-tsc 0；zd（`.zc/perf/zd.sh k213`）DUMP / ROWS 均为 DIFF 0；verify EXIT=0（3827 passed，用例数不变）。

## 2. 待办（可以交给低级模型，逐批零差验收）

**通用规程（每条都要做）**：
1. `grep -rnw <字段> src scripts public/static` 看全部出现点，**包括 JSON**（spec 按字符串键读 cfg）。内联结构类型（`cfg: { foo?: number }`）里的同名声明也算出现点，要确认它所在的函数体也没读。
2. 确认只有「写入 + 类型声明」，删掉写入行和声明（连同声明上方的 `/** */` 注释块）。写入语句右侧的局部变量如果因此变成未使用，`vue-tsc -b` 会报 TS6133，连带删掉即可。**如果变成未使用的是一个机制常量，先停下**：那说明对应机制可能根本没实现，要查清楚再删。
3. 一个函数如果删完后只剩「往全队 cfg 写这个字段」，就整函数删掉，连同调用它的 `applyTeamConfig`（CC-191 的丽娜 / 苍角）；再搜测试里有没有「某角色必须声明 applyTeamConfig」的名单断言要同步（`teamHook.test.ts`）。
4. 每批（≤10 个字段）跑 `npx vue-tsc -b`、`bash .zc/perf/zd.sh <tag>` 要求 DIFF 0，最后跑 `npm run verify`。**zd 报差但你只改了数据文件里的展示字符串**（note / fields）时，把那个数据文件临时还原成 HEAD 版本再跑一次 zd，DIFF 0 就证明代码零差（CC-191 的做法）。
5. **碰到「删了会让某个展示变空」或「读取方在 .vue 里用了别名」，停下，这条改标「保留：<理由>」**，不要硬删。
6. 做完在本表对应行尾加 `[done <commit>]` 或 `[保留：理由]`，不删行。

### T1 · `CharResourceConfig` 的 cfg 死暂存：**已完成（CC-191，9e0d4adf）**

补上 JSON 语料后剩 21 条：删 20 条，保留 1 条。逐条核查时顺带确认了几条「注释暗示本该被读」的情况，都不是 bug：
- `normaHatToChainCount`：注释声称「供资源池注入 C4 喧响」。实际 C4 早已改走 chainGift 声明的 `decibelPerUnit`（`crossAgentSupply.ts#giftDecibelForCfg`），三处过期注释已改正。
- `rinaEnergyPerRinaUlt` / `soukakuEnergyPerSoukakuUlt` / `lucyEnergyPerLucyUlt`：邻位回能的真实通道是 `crossAgentSupply`（neighbor-ult-energy）。丽娜、苍角的 `applyTeamConfig` 只做写这个死字段这一件事，已整条删除。`teamHook.test.ts` 的行为用例（邻位回能按 30/10 到账）删前删后都通过，证明它们是死的。
- `liuyinHug60Count`：用户设置 `liuyin.hug60Count` 在 `liuyin.ts:546`、`ultimatePromote.ts:210` 被直接读取，cfg 里那份只是死副本，**不是假控件**。
- `exSpecialCostAmount` / `exSpecialResourceId`：资源型强特次数由 `exSpecialResourcePaidCount`（模块资源账本）给出（`core/resource/helpers.ts#resolveExSpecialCount`），不读每发成本。
- 删完后**没有任何机制常量变成未使用**，说明没有「常量在、机制没实现」的假机制。

| 字段 | 声明 | 其余出现点（非测试） | 测试读取数 |
|---|---|---|---|
| `exSpecialCostAmount` | `src/types/resource/config.ts:104` | `src/composables/resourceCalc/helpers.ts:550` | 0 | [done 9e0d4adf]
| `exSpecialResourceId` | `src/types/resource/config.ts:106` | `src/composables/resourceCalc/helpers.ts:551` | 0 | [done 9e0d4adf]
| `velinaColorElement` | `src/types/resource/config.ts:225` | `src/mechanics/agents/velina.ts:60`, `src/mechanics/agents/velina.ts:249`, `src/mechanics/agents/velina.ts:392`, `src/mechanics/agents/velina.ts:470` | 0 | [done 9e0d4adf]
| `velinaCondensedCycloneMoveId` | `src/types/resource/config.ts:237` | `src/mechanics/agents/velina.ts:255` | 0 | [done 9e0d4adf]
| `roxyMiniTornadoMoveId` | `src/types/resource/config.ts:272` | `src/mechanics/agents/roxy.ts:259` | 0 | [done 9e0d4adf]
| `claretMaimMoveId` | `src/types/resource/config.ts:280` | `src/mechanics/agents/claret.ts:431` | 0 | [done 9e0d4adf]
| `claretBloodBurialMoveId` | `src/types/resource/config.ts:282` | `src/mechanics/agents/claret.ts:432` | 0 | [done 9e0d4adf]
| `aliceCoweringBuildUpEfficiency` | `src/types/resource/config.ts:338` | `src/mechanics/agents/alice.ts:209` | 0 | [done 9e0d4adf]
| `isSupport` | `src/types/resource/config.ts:404` | `src/mechanics/agents/lycaon.ts:174`, `src/mechanics/agents/lycaon.ts:222`, `src/mechanics/types.ts:478`, `src/mechanics/types.ts:504` … | 0 | [done 9e0d4adf]
| `timeAvailableFrontlineSeconds` | `src/types/resource/config.ts:426` | `src/core/resource/foldLoop.ts:136` | 0 | [done 9e0d4adf]
| `miyabiEnabled` | `src/types/resource/config.ts:440` | `src/mechanics/agents/miyabi.ts:110`, `src/mechanics/agents/miyabi.ts:172` | 0 | [done 9e0d4adf]
| `miyabiFrostMoonMoveId` | `src/types/resource/config.ts:442` | `src/mechanics/agents/miyabi.ts:173` | 0 | [done 9e0d4adf]
| `miyabiFrostMoonCount` | `src/types/resource/config.ts:444` | `src/mechanics/agents/miyabi.ts:174` | 0 | [done 9e0d4adf]
| `liuyinHug60Count` | `src/types/resource/config.ts:454` | `src/mechanics/agents/liuyin.ts:242` | 0 | [done 9e0d4adf]
| `normaHatToChainCount` | `src/types/resource/config.ts:605` | `src/mechanics/agents/norma.ts:501`, `src/mechanics/agents/norma.ts:503`, `src/composables/resourceCalc/chainGift.ts:55` | 0 | [done 9e0d4adf]
| `jufufuHuweiHits` | `src/types/resource/config.ts:643` | `src/mechanics/agents/specPanelBuffs.ts:672` | 0 | [done 9e0d4adf]
| `jufufuTigerChainCount` | `src/types/resource/config.ts:645` | `src/mechanics/agents/specPanelBuffs.ts:673` | 0 | [done 9e0d4adf]
| `rinaEnergyPerRinaUlt` | `src/types/resource/config.ts:670` | `src/core/resource/crossAgentSupply.ts:193`, `src/mechanics/agents/rina.ts:142`, `src/mechanics/agents/rina.ts:319` | 0 | [done 9e0d4adf]
| `lucyEnergyPerLucyUlt` | `src/types/resource/config.ts:672` | `src/mechanics/agents/lucy.ts:424` | 0 | [done 9e0d4adf]
| `soukakuEnergyPerSoukakuUlt` | `src/types/resource/config.ts:696` | `src/mechanics/agents/soukaku.ts:111` | 0 | [done 9e0d4adf]
| `timeFeasibleScale` | `src/types/resource/config.ts:815` | `src/core/resource/helpers.ts:212`, `src/core/resource/helpers.ts:536`, `src/core/resource/helpers.ts:550`, `src/core/resource/helpers.ts:551` | 0 | **保留**：挂着登记的 `@fact`（诊断量写回口径，有复核到期），是有意保留的诊断量

### T2 · 结果 / 中间对象的死字段（74 条，**进行中**：诺姆 3 条已删，CC-192 10817931）

> 第 215 轮裁决：T2 只是无害的展示载荷，删除收益小，**不再占 lead 整轮**。适合派给子代理（dsflash）逐批做，由 lead 做 zd / verify 验收；测试读取数 > 0 的默认保留。

**误报比例明显更高**：图表布局对象（`directDamageChart` 的 `lefts` / `centers`…）常被 .vue 以同名局部变量解构后使用；只被测试读的诊断字段（测试读取数 > 0）**默认保留**，除非测试本身只是在断言这个字段存在。第 213 轮抽查过的三组：
- `anbyZero.teamFollowupDmgBonus`：额外能力已经走 spec teamBuffs 生效，这个字段是死的展示副本；
- `phoenix` 的 `c1CritDmg` / `emberGain`：specResources 诊断字段，`emberGain` 恒为 0；
- `yeshuguang.feiguangPerForm`：标了 `@deprecated` 的兼容字段。

这三组都可以删。

> **第 228 轮（CC-205，d95a2957）**：这三组已处理，但 `anbyZero.teamFollowupDmgBonus` **最终没删**：结果卡写死了过时的 +25%，死字段算的才是真值（满潜 50%），改为让卡片读它。⇒ **剩余条目先分类再动手**：(a) 纯死 → 删；(b) 对应某处写死 / 过时的展示或注释 → 让展示读字段（真 bug）；(c) 仅测试读 → 保留。详见 `mcp-stun-dual-source.md` §24.52。

| 字段 | 声明 | 其余出现点（非测试） | 测试读取数 |
|---|---|---|---|
| `withDiscs` | `src/core/panel.ts:258` | `src/core/panel.ts:285`, `src/core/panel.ts:323` | 6 |
| `exRefundEnergy` | `src/types/resource/energy.ts:73` | `src/core/resource/resourceIncome.ts:121`, `src/core/resource/resourceIncome.ts:145`, `src/core/resource/resourceIncome.ts:160` | 1 |
| `skillTableResolved` | `src/types/resource/execution.ts:63` | `src/composables/resourceCalc/helpers.ts:345`, `src/composables/resourceCalc/helpers.ts:409`, `src/composables/resourceCalc/helpers.ts:415`, `src/composables/resourceCalc/skillRows.ts:160` … | 0 |
| `truncatedRatio` | `src/types/resource/execution.ts:119` | `src/core/resource/timeTruncation.ts:126` | 1 |
| `cutEnergyRecovery` | `src/types/resource/execution.ts:146` | `src/core/resource/timeTruncation.ts:141` | 1 |
| `cutDecibelRecovery` | `src/types/resource/execution.ts:148` | `src/core/resource/timeTruncation.ts:142` | 2 |
| `windEnergyCap` | `src/types/resource/agentResources.ts:86` | `src/mechanics/agents/roxy.ts:236` | 0 |
| `assaultCritBaseRate` | `src/types/resource/agentResources.ts:192` | `src/mechanics/agents/jane.ts:81` | 1 |
| `assaultCritRatePerMastery` | `src/types/resource/agentResources.ts:193` | `src/mechanics/agents/jane.ts:82` | 0 |
| `cinema6SpecialEmberTotalDamage` | `src/types/resource/agentResources.ts:252` | `src/mechanics/agents/burnice.ts:188`, `src/mechanics/agents/burnice.ts:255` | 1 |
| `anomalyProficiencyBonus` | `src/types/resource/agentResources.ts:305` | `src/mechanics/agents/nangong.ts:111` | 1 |
| `impactFromMastery` | `src/types/resource/agentResources.ts:306` | `src/mechanics/agents/nangong.ts:106`, `src/mechanics/agents/nangong.ts:112` | 2 |
| `vibratoMax` | `src/types/resource/agentResources.ts:308` | `src/mechanics/agents/nangong.ts:114` | 0 |
| `beatCap` | `src/types/resource/agentResources.ts:314` | `src/mechanics/agents/nangong.ts:120` | 0 |
| `hatToChainCost` | `src/types/resource/agentResources.ts:417` | `src/mechanics/agents/norma.ts:175` | 0 | [done 10817931]
| `barrageSeconds` | `src/types/resource/agentResources.ts:419` | `src/mechanics/agents/norma.ts:135`, `src/mechanics/agents/norma.ts:176` | 0 | [done 10817931]
| `barrageCoverage` | `src/types/resource/agentResources.ts:421` | `src/mechanics/agents/norma.ts:134`, `src/mechanics/agents/norma.ts:135`, `src/mechanics/agents/norma.ts:177` | 0 | [done 10817931]
| `yisha4NecessaryTime` | `src/types/resource/agentResources.ts:471` | `src/mechanics/agents/qingyi.ts:250` | 3 |
| `zuiHuaTime` | `src/types/resource/agentResources.ts:473` | `src/mechanics/agents/qingyi.ts:92`, `src/mechanics/agents/qingyi.ts:93`, `src/mechanics/agents/qingyi.ts:110`, `src/mechanics/agents/qingyi.ts:239` … | 0 |
| `dreamTarget` | `src/types/resource/agentResources.ts:482` | `src/mechanics/agents/luciaElowen.ts:301` | 0 |
| `rageDiDongComboCount` | `src/types/resource/agentResources.ts:535` | `src/mechanics/agents/banyue.ts:129`, `src/mechanics/agents/banyue.ts:130`, `src/mechanics/agents/banyue.ts:132`, `src/mechanics/agents/banyue.ts:303` … | 1 |
| `inkCycles` | `src/types/resource/agentResources.ts:579` | `src/mechanics/agents/yixuan.ts:206` | 0 |
| `cloudCycles` | `src/types/resource/agentResources.ts:581` | `src/mechanics/agents/yixuan.ts:207` | 0 |
| `cloudChargeSeconds` | `src/types/resource/agentResources.ts:595` | `src/mechanics/agents/yixuan.ts:214` | 0 |
| `derivedEnergy` | `src/types/resource/agentResources.ts:665` | `src/core/resource/helpers.ts:244`, `src/core/resource/helpers.ts:245`, `src/core/resource/assembleSlot.ts:187`, `src/composables/freeCompare/metrics.ts:253` … | 2 |
| `perSlotParry` | `src/types/resource/agentResources.ts:752` | `src/core/anomalyPool.ts:452`, `src/core/anomalyPool.ts:456`, `src/core/anomalyPool.ts:458`, `src/core/anomalyPool.ts:463` … | 2 |
| `perSlotDodgeCounter` | `src/types/resource/agentResources.ts:756` | `src/core/anomalyPool.ts:454`, `src/core/anomalyPool.ts:456`, `src/core/anomalyPool.ts:460`, `src/core/anomalyPool.ts:465` … | 0 |
| `inAxisFraction` | `src/types/resource/pools.ts:29` | `src/core/stunPool.ts:167`, `src/core/stunPool.ts:171`, `src/core/stunPool.ts:182`, `src/composables/resourceCalc/ultimatePromote.ts:288` … | 2 |
| `inAxisStun` | `src/types/resource/pools.ts:31` | `src/core/stunPool.ts:171`, `src/core/stunPool.ts:172`, `src/core/stunPool.ts:183`, `src/core/stunPool.ts:190` … | 2 |
| `stunRefundValue` | `src/types/resource/pools.ts:53` | `src/core/stunPool.ts:204`, `src/core/stunPool.ts:220`, `src/core/stunPool.ts:240` | 1 |
| `truncationBeforeRefoldSeconds` | `src/types/resource/team.ts:68` | `src/core/resource.ts:296`, `src/core/resource.ts:386` | 1 |
| `chainGiftTimeReserved` | `src/types/resource/team.ts:160` | `src/core/resource.ts:375` | 2 |
| `teammateOpenCount` | `src/core/resource/curtain.ts:30` | `src/core/resource/curtain.ts:33`, `src/core/resource/curtain.ts:46`, `src/core/resource/curtain.ts:51`, `src/core/resource/curtain.ts:54` … | 0 |
| `grossFrontline` | `src/core/resource/timeOccupation.ts:48` | `src/core/resource/timeOccupation.ts:56`, `src/core/resource/timeOccupation.ts:101` | 1 |
| `creditApplied` | `src/core/resource/timeOccupation.ts:52` | `src/core/resource/timeOccupation.ts:103` | 1 |
| `followUpMoveId` | `src/data/counterAssists.ts:27` | `src/data/counterAssists.ts:36` | 4 |
| `dashCount` | `src/mechanics/agents/ellen.ts:104` | `src/mechanics/agents/ellen.ts:173`, `src/mechanics/agents/ellen.ts:174`, `src/mechanics/agents/ellen.ts:192`, `src/mechanics/agents/ellen.ts:395` | 0 |
| `extraBursts` | `src/mechanics/agents/ellen.ts:111` | `src/mechanics/agents/ellen.ts:168`, `src/mechanics/agents/ellen.ts:199` | 2 |
| `teamFollowupDmgBonus` | `src/mechanics/agents/anbyZero.ts:75` | `src/mechanics/agents/anbyZero.ts:150` | 0 · **不删**：结果卡改读它（原写死 +25%）CC-205 |
| `masteryExcess` | `src/mechanics/agents/promia.ts:78` | `src/mechanics/agents/promia.ts:99`, `src/mechanics/agents/promia.ts:110` | 2 |
| `feiguangPerForm` | `src/mechanics/agents/yeshuguang.ts:196` | `src/mechanics/agents/yeshuguang.ts:284`, `src/mechanics/agents/yeshuguang.ts:312` | 0 · 已删 CC-205 |
| `feiguangScaleEach` | `src/mechanics/agents/yeshuguang.ts:197` | `src/mechanics/agents/yeshuguang.ts:285`, `src/mechanics/agents/yeshuguang.ts:313` | 0 |
| `dmgPerSec` | `src/mechanics/agents/qingyi.ts:73` | `src/mechanics/agents/qingyi.ts:111`, `src/types/resource/config.ts:552` | 0 |
| `rageDiDongComboCount` | `src/mechanics/agents/banyue.ts:129` | `src/mechanics/agents/banyue.ts:130`, `src/mechanics/agents/banyue.ts:132`, `src/mechanics/agents/banyue.ts:303`, `src/types/resource/agentResources.ts:535` … | 2 |
| `c1CritDmg` | `src/mechanics/agents/phoenix.ts:115` | `src/mechanics/agents/phoenix.ts:467` | 0 · 已删 CC-205 |
| `emberGain` | `src/mechanics/agents/phoenix.ts:118` | `src/mechanics/agents/phoenix.ts:470` | 0 · 已删 CC-205 |
| `deltaVsBest` | `src/composables/teamCompare.ts:761` | `src/composables/teamCompare.ts:751`, `src/composables/teamCompare.ts:954` | 2 |
| `totalGoldA` | `src/composables/teamTimeline.ts:894` | `src/composables/teamTimeline.ts:977` | 0 |
| `totalGoldB` | `src/composables/teamTimeline.ts:895` | `src/composables/teamTimeline.ts:978` | 0 |
| `goldLabelA` | `src/composables/teamTimeline.ts:896` | `src/composables/teamTimeline.ts:979` | 1 |
| `goldLabelB` | `src/composables/teamTimeline.ts:897` | `src/composables/teamTimeline.ts:980` | 1 |
| `bankBefore` | `src/composables/pullPlanner.ts:246` | `src/composables/pullPlanner.ts:347` | 1 |
| `bankAfter` | `src/composables/pullPlanner.ts:247` | `src/composables/pullPlanner.ts:348` | 2 |
| `changedFields` | `src/composables/cinemaUplift.ts:46` | `src/composables/cinemaUplift.ts:21`, `src/composables/cinemaUplift.ts:246`, `src/composables/cinemaUplift.ts:254`, `src/composables/cinemaUplift.ts:259` | 1 |
| `basicRows` | `src/composables/teamTimeSummary.ts:33` | `src/composables/teamTimeSummary.ts:178` | 1 |
| `idle` | `src/composables/teamTimeSummary.ts:85` | `src/core/resource/helpers.ts:362`, `src/core/resource/crossAgentSupply.ts:114`, `src/core/resource/foldLoop.ts:98`, `src/core/resource/foldLoop.ts:105` … | 0 |
| `usedLevels` | `src/composables/difficultyDescent.ts:115` | `src/composables/difficultyDescent.ts:339` | 0 |
| `lefts` | `src/composables/directDamageChart.ts:115` | `src/composables/directDamageChart.ts:152`, `src/composables/directDamageChart.ts:157`, `src/composables/directDamageChart.ts:164`, `src/composables/directDamageChart.ts:169` … | 1 |
| `centers` | `src/composables/directDamageChart.ts:116` | `src/composables/directDamageChart.ts:153`, `src/composables/directDamageChart.ts:158`, `src/composables/directDamageChart.ts:165`, `src/composables/directDamageChart.ts:200` | 0 |
| `plotSpan` | `src/composables/directDamageChart.ts:118` | `src/composables/directDamageChart.ts:163`, `src/composables/directDamageChart.ts:164`, `src/composables/directDamageChart.ts:165`, `src/composables/directDamageChart.ts:172` … | 5 |
| `labelSlots` | `src/composables/directDamageChart.ts:133` | `src/composables/directDamageChart.ts:191`, `src/composables/directDamageChart.ts:194`, `src/composables/directDamageChart.ts:203` | 0 |
| `strengthVsEnvironment` | `src/composables/inflationCurve.ts:113` | `src/composables/inflationCurve.ts:24`, `src/composables/inflationCurve.ts:207`, `src/composables/inflationCurve.ts:233` | 2 |
| `cumulativePct` | `src/composables/inflationCurve.ts:123` | `src/composables/inflationCurve.ts:185` | 5 |
| `clamped` | `src/composables/inflationCurve.ts:271` | `src/composables/teamCompare.ts:586`, `src/composables/teamCompare.ts:588`, `src/composables/teamCompare.ts:589`, `src/composables/teamTimeline.ts:361` … | 3 |
| `teamLanes` | `src/composables/pullPlannerChart.ts:66` | `src/composables/pullPlannerChart.ts:115`, `src/composables/pullPlannerChart.ts:132`, `src/composables/pullPlannerChart.ts:140` | 11 |
| `authorCount` | `src/composables/pullValue.ts:97` | `src/composables/pullValue.ts:303` | 1 |
| `medianScore` | `src/composables/pullValue.ts:99` | `src/composables/pullValue.ts:305` | 0 |
| `capCount` | `src/composables/pullValue.ts:100` | `src/composables/pullValue.ts:306` | 3 |
| `filteredCards` | `src/composables/pullValueChart.ts:84` | `src/composables/pullValueChart.ts:130`, `src/composables/pullValueChart.ts:133`, `src/composables/pullValueChart.ts:198` | 2 |
| `gradeFilteredCards` | `src/composables/pullValueChart.ts:86` | `src/composables/pullValueChart.ts:133`, `src/composables/pullValueChart.ts:135`, `src/composables/pullValueChart.ts:198` | 1 |
| `barMaxW` | `src/composables/pullValueChart.ts:99` | `src/composables/pullValueChart.ts:152`, `src/composables/pullValueChart.ts:182`, `src/composables/pullValueChart.ts:199` | 2 |
| `higherBetter` | `src/composables/freeCompare/metrics.ts:67` | `src/composables/freeCompare/metrics.ts:119`, `src/composables/freeCompare/metrics.ts:126`, `src/composables/freeCompare/metrics.ts:133`, `src/composables/freeCompare/metrics.ts:140` … | 0 · **已消费（CC-204），出表** |
| `verificationId` | `src/specs/verify.ts:7` | `src/specs/verify.ts:50` | 0 |
| `targeted` | `src/utils/discEffectRows.ts:71` | `src/core/resource/tailPipeline.ts:110`, `src/utils/discEffectRows.ts:141`, `src/mechanics/agents/starlightBilly.ts:181`, `src/mechanics/agents/starlightBilly.ts:406` … | 0 |

### T2 收尾（第 229 轮）：全量分类后整体「不做」

- **分类**：由 dsflash 子代理只读完成（66 行，逐字段 grep 字段与其语义对应的展示文本），lead 抽查了 b 类全部和 a 类若干。结果：a 纯死 16 / b 展示写死 7 / c 仅测试读 43 / d 误报 0。
- **b 类 7 条都不是 bug**：`windEnergyCap`（上限 3）、`assaultCritBaseRate` / `assaultCritRatePerMastery`（20% / 0.1%）、`vibratoMax`（4）、`beatCap`（100）、`dreamTarget`（500 点）、`cloudChargeSeconds`（满蓄 2s）。写死的都是稳定的游戏常量，数值与字段当前值全部相等，没有 CC-205 那种已经过时的值。改成插值只是把一处字面量换成另一处引用，按唯一判据没有架构收益。
- **决定：T2 整体不做**。a 类 16 条是一两行的诊断载荷，删除不让架构更通用或更简单，不单独立卡；**顺手改到所在文件时可以一并删**（名单见下表的 a 类）。c 类按第 215 轮裁决保留。
- 回退点：若日后要删 a 类，直接按下表逐条删，每条只涉及声明与写入两处。

#### T2 字段分类（k229）

口径：`docs/mcp-write-only-props.md` §T2 表（91–164 行）。跳过末尾已标「已删 / 不删 / 出表」的 5 行
（`teamFollowupDmgBonus` 不删、`feiguangPerForm`/`c1CritDmg`/`emberGain` 已删 CC-205、`higherBetter` 出表 CC-204）
以及 CC-192 已删的诺姆 3 行（`hatToChainCost`/`barrageSeconds`/`barrageCoverage`，section 头注明「诺姆 3 条已删」）。
分类：a=纯死字段可删；b=展示层写死/过时（真 bug）；c=只被测试读；d=其实有非测试读取（本批未发现 d）。

| 字段 | 声明文件:行 | 分类 | 证据（文件:行 + 一句话） |
|---|---|---|---|
| `withDiscs` | `src/core/panel.ts:258` | c | 非测试零读；测试读 6 处（`core/__tests__/discSetEffects.test.ts:398`、`panelProbe.test.ts:89`）。 |
| `exRefundEnergy` | `src/types/resource/energy.ts:73` | c | 非测试零读；测试读 1 处（`core/__tests__/energyRowParity.test.ts:130`）。 |
| `skillTableResolved` | `src/types/resource/execution.ts:63` | c | 非测试零读；测试读 2 处（`mechanics/__tests__/trigger.test.ts:272`、`panYinhu.test.ts:144`）。 |
| `truncatedRatio` | `src/types/resource/execution.ts:122` | c | 非测试零读；测试/probe 读 3 处（`timeTruncation.test.ts:37`）。 |
| `cutEnergyRecovery` | `src/types/resource/execution.ts:169` | c | 非测试零读；测试读 1 处（`timeTruncation.test.ts:87`）。 |
| `cutDecibelRecovery` | `src/types/resource/execution.ts:171` | c | 非测试零读；测试读 2 处（`timeTruncation.test.ts:88-89`）。 |
| `windEnergyCap` | `src/types/resource/agentResources.ts:86` | b | 卡片写死「存量上限 3」（`mechanics/agents/roxy.ts:453`），字段算于 `roxy.ts:236`。 |
| `assaultCritBaseRate` | `src/types/resource/agentResources.ts:192` | b | 卡片写死「基础20%」（`mechanics/agents/jane.ts:199`），字段算于 `jane.ts:81`。 |
| `assaultCritRatePerMastery` | `src/types/resource/agentResources.ts:193` | b | 卡片写死「×0.1%」（`mechanics/agents/jane.ts:199`），字段算于 `jane.ts:82`。 |
| `cinema6SpecialEmberTotalDamage` | `src/types/resource/agentResources.ts:252` | c | 非测试零读；测试读 1 处（`specialMechanics.test.ts:430`）；卡片只显示 count×ratio。 |
| `anomalyProficiencyBonus` | `src/types/resource/agentResources.ts:305` | c | 非测试零读；测试读 1 处（`nangongSmoke.test.ts:31`）；模块 description 提「精通+120」但不渲染。 |
| `impactFromMastery` | `src/types/resource/agentResources.ts:306` | c | 非测试零读；测试读 2 处（`nangongSmoke.test.ts:30`、`specialMechanics.test.ts:534`）。 |
| `vibratoMax` | `src/types/resource/agentResources.ts:308` | b | 卡片写死「滑块可调 0-4」（`nangong.ts:433`）与设置 `max: 4`（`nangong.ts:458`），字段算于 `nangong.ts:114`。 |
| `beatCap` | `src/types/resource/agentResources.ts:314` | b | 卡片写死「上限 100」（`nangong.ts:421`），字段算于 `nangong.ts:120`。 |
| `yisha4NecessaryTime` | `src/types/resource/agentResources.ts:466` | c | 非测试零读；测试读 3 处（`qingyi.test.ts:57/66/107`）。 |
| `zuiHuaTime` | `src/types/resource/agentResources.ts:468` | a | 非测试零读、测试零读；计算于 `qingyi.ts:239/251`，卡片只显示合计 `necessaryTime`。 |
| `dreamTarget` | `src/types/resource/agentResources.ts:477` | b | 卡片标题写死「（500点）」（`luciaElowen.ts:375`），字段算于 `luciaElowen.ts:301`。 |
| `rageDiDongComboCount` | `src/types/resource/agentResources.ts:530` | c | 非测试零读；测试读 3 处（`banyue.test.ts:56/71/334`）；卡片读同值 `diDongRageCount`。 |
| `inkCycles` | `src/types/resource/agentResources.ts:574` | a | 非测试零读、测试零读；计算于 `yixuan.ts:206`，卡片只列 ink1/ink3/ink4。 |
| `cloudCycles` | `src/types/resource/agentResources.ts:576` | a | 非测试零读、测试零读；计算于 `yixuan.ts:207`。 |
| `cloudChargeSeconds` | `src/types/resource/agentResources.ts:590` | b | 卡片写死「满蓄 2s/次」（`yixuan.ts:949`），字段算于 `yixuan.ts:214`。 |
| `derivedEnergy` | `src/types/resource/agentResources.ts:660` | c | 非测试零读；测试读 9 处（`energyConsistency.test.ts:19` 等）。 |
| `perSlotParry` | `src/types/resource/agentResources.ts:747` | c | 非测试零读；测试读 2 处（`parrySplitInt.test.ts:186/235`）。 |
| `perSlotDodgeCounter` | `src/types/resource/agentResources.ts:751` | a | 非测试零读、测试零读；`ResultPage.vue:556` 只读 `perSlotBonus`。 |
| `inAxisFraction` | `src/types/resource/pools.ts:29` | c | 非测试零读；测试读 3 处（`liuyinPromote.test.ts:40` 等）。 |
| `inAxisStun` | `src/types/resource/pools.ts:31` | c | 非测试零读；测试读 2 处（`stunPool.test.ts:55` 等）。 |
| `stunRefundValue` | `src/types/resource/pools.ts:53` | c | 非测试零读；测试读 1 处（`stunPool.test.ts:72`）。 |
| `truncationBeforeRefoldSeconds` | `src/types/resource/team.ts:68` | c | 非测试零读；测试读 2 处（`truncationRefold.test.ts:61` 等）。 |
| `chainGiftTimeReserved` | `src/types/resource/team.ts:160` | c | 非测试零读；测试读 2 处（`timeLedgerInvariants.test.ts:64`、`giftMoveTimeLedger.test.ts:49`）。 |
| `teammateOpenCount` | `src/core/resource/curtain.ts:30` | a | `CurtainInfo` 字段无任何读取（`:46` 的局部量传给了 `curtainTriggers`，字段本身零读）。 |
| `grossFrontline` | `src/core/resource/timeOccupation.ts:48` | c | 非测试零读；测试读 1 处（`difficultyCurve.test.ts:253`）。 |
| `creditApplied` | `src/core/resource/timeOccupation.ts:52` | c | 非测试零读；测试读 1 处（`difficultyCurve.test.ts:254`）。 |
| `followUpMoveId` | `src/data/counterAssists.ts:27` | c | 非测试零读；测试读 4 处（`counterAssist.test.ts:79` 等）；生产只读同表的 `moveId`。 |
| `dashCount` | `src/mechanics/agents/ellen.ts:104` | a | 非测试零读、测试零读（仅注释提及）；返回同值 `dashChargedCount` 被卡片使用。 |
| `extraBursts` | `src/mechanics/agents/ellen.ts:111` | c | 非测试零读；测试读 2 处（`ellen.test.ts:86/101`）。 |
| `masteryExcess` | `src/mechanics/agents/promia.ts:78` | c | 非测试零读；测试读 2 处（`promia.test.ts:48/52`）。 |
| `feiguangScaleEach` | `src/mechanics/agents/yeshuguang.ts:195` | a | 非测试零读、测试零读；计算于 `yeshuguang.ts:282`，卡片只显示 `feiguangFullCasts`。 |
| `dmgPerSec` | `src/mechanics/agents/qingyi.ts:73` | a | 非测试零读、测试零读；计算于 `qingyi.ts:111`（`config.ts:522` 是同名内联声明）。 |
| `rageDiDongComboCount` | `src/mechanics/agents/banyue.ts:129` | c | 与 `agentResources.ts:530` 同字段的模块内声明；非测试零读，测试读 3 处（`banyue.test.ts:56/71/334`）。 |
| `deltaVsBest` | `src/composables/teamCompare.ts:761` | c | 非测试零读；测试读 2 处（`teamCompare.test.ts:639/642`）；页面读 `lossPct`/`isBest`。 |
| `totalGoldA` | `src/composables/teamTimeline.ts:894` | c | 非测试零读；测试读 1 处（`timeChartsPresentation.test.ts:184`）。 |
| `totalGoldB` | `src/composables/teamTimeline.ts:895` | a | 非测试零读、测试零读；`SlotCompareChart.vue` 汇总表不渲染金数。 |
| `goldLabelA` | `src/composables/teamTimeline.ts:896` | c | 非测试零读；测试读 1 处（`teamTimeline.test.ts:510`）。 |
| `goldLabelB` | `src/composables/teamTimeline.ts:897` | c | 非测试零读；测试读 1 处（`teamTimeline.test.ts:511`）。 |
| `bankBefore` | `src/composables/pullPlanner.ts:246` | c | 非测试零读；测试读 1 处（`pullPlanner.test.ts:160`）。 |
| `bankAfter` | `src/composables/pullPlanner.ts:247` | c | 非测试零读；测试读 2 处（`pullPlanner.test.ts:159/160`）。 |
| `changedFields` | `src/composables/cinemaUplift.ts:46` | c | 非测试零读；测试读 1 处（`cinemaUplift.test.ts:104`）；页面读 `warn`。 |
| `basicRows` | `src/composables/teamTimeSummary.ts:33` | c | 非测试零读；测试读 1 处（`teamTimeSummary.test.ts:44`）。 |
| `idle` | `src/composables/teamTimeSummary.ts:85` | a | 非测试零读、测试零读（`convergenceProbe` 的 `idle` 是它自己的局部量）；`ResultPage.vue` 不显示。 |
| `usedLevels` | `src/composables/difficultyDescent.ts:115` | a | 非测试零读、测试零读；面板用 `DescentPoint.levels`（`DifficultyDescentPanel.vue:273`）。 |
| `lefts` | `src/composables/directDamageChart.ts:115` | c | 非测试零读；测试读 1 处（`directDamageChart.test.ts:90`）。 |
| `centers` | `src/composables/directDamageChart.ts:116` | a | 非测试零读、测试零读；内部 `cx` 用局部量，返回对象字段零消费。 |
| `plotSpan` | `src/composables/directDamageChart.ts:118` | c | 非测试零读；测试读 5 处（`directDamageChart.test.ts:56` 等）。 |
| `labelSlots` | `src/composables/directDamageChart.ts:133` | a | 非测试零读、测试零读；内部 `labelY` 用局部量，返回对象字段零消费。 |
| `strengthVsEnvironment` | `src/composables/inflationCurve.ts:113` | c | 非测试零读；测试读 2 处（`inflationCurve.test.ts:162/176`）；注释明示「保留但勿用作结论」。 |
| `cumulativePct` | `src/composables/inflationCurve.ts:123` | c | 非测试零读；测试读 5 处（`inflationCurve.test.ts:44` 等）。 |
| `clamped` | `src/composables/inflationCurve.ts:271` | c | 非测试零读；测试读 3 处（`inflationCurve.test.ts:232` 等）；`PullValueChart.vue:297` 仅注释。 |
| `teamLanes` | `src/composables/pullPlannerChart.ts:66` | c | 非测试零读；测试读 9 处（`pullPlannerChart.test.ts:80` 等）；页面用 `visibleTeamLanes`。 |
| `authorCount` | `src/composables/pullValue.ts:97` | c | 非测试零读；测试读 1 处（`pullValue.test.ts:279`）。 |
| `medianScore` | `src/composables/pullValue.ts:99` | a | 非测试零读、测试零读；卡片无对应展示。 |
| `capCount` | `src/composables/pullValue.ts:100` | c | 非测试零读；测试读 3 处（`pullValue.test.ts:109` 等）。 |
| `filteredCards` | `src/composables/pullValueChart.ts:84` | c | 非测试零读；测试读 2 处（`pullValueChart.test.ts:45/46`）。 |
| `gradeFilteredCards` | `src/composables/pullValueChart.ts:86` | c | 非测试零读；测试读 1 处（`pullValueChart.test.ts:53`）。 |
| `barMaxW` | `src/composables/pullValueChart.ts:99` | c | 非测试零读；测试读 2 处（`pullValueChart.test.ts:133/134`）。 |
| `verificationId` | `src/specs/verify.ts:7` | a | 非测试零读、测试零读；`SpecVerificationResult` 由测试消费但从不读该字段。 |
| `targeted` | `src/utils/discEffectRows.ts:71` | a | 非测试零读、测试零读；`TeamConfigPage.vue:448` 只渲染 `condition`/`gateText`。 |

#### b 类详细说明（展示层写死同一量 → 应让展示读字段）

1. **`windEnergyCap`**（声明 `src/types/resource/agentResources.ts:86`；字段计算 `src/mechanics/agents/roxy.ts:236`）
   - 语义：洛克茜[风能]存量上限（`WIND_ENERGY_MAX = 3`）。
   - 写死处：`src/mechanics/agents/roxy.ts:453` 结果卡「风能获取」detail = `'存量上限 3（每发敬请安息至多消耗 3）'`（字面 3）。
   - 修法：detail 改读 `source.windEnergyCap`（或常量插值），字段接入展示。

2. **`assaultCritBaseRate`**（声明 `src/types/resource/agentResources.ts:192`；字段计算 `src/mechanics/agents/jane.ts:81`）
   - 语义：简的强击暴击基础率（`ASSAULT_CRIT_BASE = 20`）。
   - 写死处：`src/mechanics/agents/jane.ts:199` 结果卡「强击暴击率」detail = `` `基础20% + 异常精通×0.1%` ``（字面 20）。
   - 修法：detail 用 `${source.assaultCritBaseRate}%` 插值。

3. **`assaultCritRatePerMastery`**（声明 `src/types/resource/agentResources.ts:193`；字段计算 `src/mechanics/agents/jane.ts:82`）
   - 语义：简的强击暴击率每点异常精通加成（`ASSAULT_CRIT_PER_MASTERY = 0.1`）。
   - 写死处：同 `src/mechanics/agents/jane.ts:199` 的「×0.1%」（字面 0.1）。
   - 修法：detail 用 `${source.assaultCritRatePerMastery}%` 插值。

4. **`vibratoMax`**（声明 `src/types/resource/agentResources.ts:308`；字段计算 `src/mechanics/agents/nangong.ts:114`）
   - 语义：南宫羽颤音层数上限（`VIBRATO_MAX = 4`）。
   - 写死处：`src/mechanics/agents/nangong.ts:433` 结果卡 detail = `` `当前按 ${source.vibratoStacks} 层近似（滑块可调 0-4）` ``（字面 4）；另 `nangong.ts:458` 设置项 `max: 4` 同源。
   - 修法：detail 与设置 `max` 改读/插值 `source.vibratoMax`。

5. **`beatCap`**（声明 `src/types/resource/agentResources.ts:314`；字段计算 `src/mechanics/agents/nangong.ts:120`）
   - 语义：南宫羽重拍持有上限（`BEAT_CAP = 100`）。
   - 写死处：`src/mechanics/agents/nangong.ts:421` 结果卡「进场」detail = `'上限 100'`（字面 100）。
   - 修法：detail 改读 `source.beatCap`。

6. **`dreamTarget`**（声明 `src/types/resource/agentResources.ts:477`；字段计算 `src/mechanics/agents/luciaElowen.ts:301`）
   - 语义：卢西娅·艾洛温梦境值全局目标（`DREAM_TARGET = 500`）。
   - 写死处：`src/mechanics/agents/luciaElowen.ts:375` 结果卡标题 = `'卢西娅·梦境值计划（500点）'`（字面 500）。
   - 修法：标题改读 `source.dreamTarget`。

7. **`cloudChargeSeconds`**（声明 `src/types/resource/agentResources.ts:590`；字段计算 `src/mechanics/agents/yixuan.ts:214`）
   - 语义：仪玄凝云术蓄力秒数（轴内按轴时长，轴外满蓄 `CLOUD_MAX_SECONDS = 2`）。
   - 写死处：`src/mechanics/agents/yixuan.ts:949` 结果卡「凝云术链（轴外）」detail = `'剩余闪能全打凝云，满蓄 2s/次（60闪能/循环）'`（字面 2）。
   - 修法：detail 改读 `source.cloudChargeSeconds`（轴外分支即该值）。

> 说明：b 类中「写死量」与字段当前取值均相等，属**双源漂移隐患**（改常量后展示不跟随），修法统一为「展示读字段」；本批未发现像 CC-205 `teamFollowupDmgBonus` 那样写死值与字段值**已经不等**的过时项。
> 另：`cutEnergyRecovery`/`cutDecibelRecovery` 对应 `teamTimeSummary.ts:209` 的「被砍招式的回能/喧响仍计在账本里（待 A 项修）」——该缺口有登记的 debt（`core/resource.ts:322`），非过时文案，故仍归 c。

### T3 · 数据类型字段（5 条）· **不做**

描述 JSON 数据形状的接口字段，由数据或导入脚本提供、代码不读，这是正常的。删掉类型字段不会删数据，只会让类型失真。（第 213 轮这里有 31 条，补 JSON 语料后大部分被识别为「数据里有」，不再出现。）

| 字段 | 声明 | 其余出现点（非测试） | 测试读取数 |
|---|---|---|---|
| `enemyLumifluxStunResReduction` | `src/types/catalog.ts:158` | `src/core/panel.ts:102` | 0 |
| `enemyLumifluxAnomalyResReduction` | `src/types/catalog.ts:166` | `src/core/panel.ts:110` | 0 |
| `second` | `src/types/catalog.ts:595` |  | 0 |
| `skill_priority` | `src/types/catalog.ts:632` |  | 0 |
| `displayValue` | `src/types/catalog.ts:658` | `src/core/damage.ts:321`, `src/core/damage.ts:329`, `src/core/damage.ts:338`, `src/core/damage.ts:352` … | 0 |

## 3. 审计脚本已知盲区

- **JSON 字符串键读取**：第 214 轮已补（`src` 与 `public/static` 下所有 `.json` 里的 `"name"` 一律算读取，从严）。代价：spec 事件的 `fields` 元数据数组这种**非读取**引用也会让字段被洗白（宁漏不误）。
- **同名局部变量**：名字兜底按名字匹配，同名局部变量会让死字段漏报。
- **结构类型参数**：TS `findReferences` 连不到内联结构类型的同名属性，所以 ① 段的候选量很大，靠 ② 段收敛。
- 审计**不做守卫**（理由见 §0），只作只读审计。
