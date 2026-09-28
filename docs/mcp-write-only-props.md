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
