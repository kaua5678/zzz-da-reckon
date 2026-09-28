# 接口属性「只写不读」普查（CC-190）

> lead-arena-0925c · 2026-09-28 第 213 轮。代码提交 `f516e95f`。
> 复跑：仓库根执行 `node scripts/audit-write-only-props.cjs > /tmp/wo.tsv`（约 2–3 分钟）。
> 列：声明位置 / 字段 / opt|req / 写入数 / 测试读取数。第 213 轮删完之后是 148 条。

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
| freeCompare `MetricDef.higherBetter` | 零读取，但它是**真实的方向元数据**（含 3 个 false）；注释声称「表格胜负着色」，这个功能并不存在 | **保留**，注释改实话（标明无消费方）。要做着色时直接用它 |

验证：vue-tsc 0；zd（`.zc/perf/zd.sh k213`）DUMP / ROWS 均为 DIFF 0；verify EXIT=0（3827 passed，用例数不变）。

## 2. 待办（可以交给低级模型，逐批零差验收）

**通用规程（每条都要做）**：
1. `grep -rnw <字段> src scripts` 看全部出现点。**内联结构类型**（`cfg: { foo?: number }`）里的同名声明也算出现点，要确认它所在的函数体也没读。
2. 确认只有「写入 + 类型声明」，删掉写入行和声明（连同声明上方那行 `/** */` 注释）。写入语句右侧如果有副作用或被别处复用的局部变量，只删赋值，不删计算。
3. 每批（≤10 个字段）跑 `npx vue-tsc -b`、`bash .zc/perf/zd.sh <tag>`（DIFF 0；若只有 dump 第 2 段变，说明结果对象字段被哈希，按 worker-queue 已知坑用 ZD_DROP 证明零差），最后跑 `npm run verify`。
4. **碰到「删了会让某个展示变空」或「读取方在 .vue 里用了别名」，停下，这条改标「保留：<理由>」**，不要硬删。
5. 做完在本表对应行尾加 `[done <commit>]` 或 `[保留：理由]`，不删行。

### T1 · `CharResourceConfig`（`src/types/resource/config.ts`）的 cfg 死暂存（37 条）

模块 `buildCharConfig` 往 cfg 写，后续没人读。多数是早期「先暂存、后面钩子再读」的残留，读取方已经改走局部变量或 spec。收益：这个近 900 行的杂物类型减少误导，读者看到 `cfg.xxx` 不再以为有消费方。风险低（零差可验）。

| 字段 | 声明 | 其余出现点（非测试） | 测试读取数 |
|---|---|---|---|
| `exSpecialCostAmount` | `src/types/resource/config.ts:104` | `src/composables/resourceCalc/helpers.ts:550` | 0 |
| `exSpecialResourceId` | `src/types/resource/config.ts:106` | `src/composables/resourceCalc/helpers.ts:551` | 0 |
| `velinaAdditionalAbilityActive` | `src/types/resource/config.ts:221` | `src/mechanics/agents/velina.ts:206`, `src/mechanics/agents/velina.ts:247` | 0 |
| `velinaColorElement` | `src/types/resource/config.ts:225` | `src/mechanics/agents/velina.ts:60`, `src/mechanics/agents/velina.ts:249`, `src/mechanics/agents/velina.ts:392`, `src/mechanics/agents/velina.ts:470` | 0 |
| `velinaCondensedCycloneMoveId` | `src/types/resource/config.ts:237` | `src/mechanics/agents/velina.ts:255` | 0 |
| `aliceSwordWillPerSec` | `src/types/resource/config.ts:243` | `src/mechanics/agents/alice.ts:181`, `src/mechanics/agents/alice.ts:217`, `src/mechanics/agents/alice.ts:259` | 0 |
| `aliceExSpecialSwordWill` | `src/types/resource/config.ts:245` | `src/mechanics/agents/alice.ts:182`, `src/mechanics/agents/alice.ts:218`, `src/mechanics/agents/alice.ts:260` | 0 |
| `aliceTeamAssaultSwordWill` | `src/types/resource/config.ts:259` | `src/mechanics/agents/alice.ts:199`, `src/mechanics/agents/alice.ts:221`, `src/mechanics/agents/alice.ts:263` | 0 |
| `aliceDisorderSwordWill` | `src/types/resource/config.ts:261` | `src/mechanics/agents/alice.ts:200`, `src/mechanics/agents/alice.ts:222`, `src/mechanics/agents/alice.ts:264` | 0 |
| `roxyMiniTornadoMoveId` | `src/types/resource/config.ts:272` | `src/mechanics/agents/roxy.ts:259` | 0 |
| `roxyMiniTornadoSeconds` | `src/types/resource/config.ts:274` | `src/mechanics/agents/roxy.ts:402` | 0 |
| `claretMaimMoveId` | `src/types/resource/config.ts:280` | `src/mechanics/agents/claret.ts:431` | 0 |
| `claretBloodBurialMoveId` | `src/types/resource/config.ts:282` | `src/mechanics/agents/claret.ts:432` | 0 |
| `aliceCoweringBuildUpEfficiency` | `src/types/resource/config.ts:338` | `src/mechanics/agents/alice.ts:209` | 0 |
| `aliceCinema2UltSpark` | `src/types/resource/config.ts:340` | `src/mechanics/agents/alice.ts:193`, `src/mechanics/agents/alice.ts:223`, `src/mechanics/agents/alice.ts:265` | 0 |
| `isSupport` | `src/types/resource/config.ts:410` | `src/mechanics/agents/lycaon.ts:174`, `src/mechanics/agents/lycaon.ts:222`, `src/mechanics/types.ts:478`, `src/mechanics/types.ts:504` … | 0 |
| `timeAvailableFrontlineSeconds` | `src/types/resource/config.ts:432` | `src/core/resource/foldLoop.ts:136`, `src/types/resource/config.ts:426` | 0 |
| `miyabiEnabled` | `src/types/resource/config.ts:446` | `src/mechanics/agents/miyabi.ts:110`, `src/mechanics/agents/miyabi.ts:172`, `src/types/resource/config.ts:440` | 0 |
| `miyabiFrostMoonMoveId` | `src/types/resource/config.ts:448` | `src/mechanics/agents/miyabi.ts:173`, `src/types/resource/config.ts:442` | 0 |
| `miyabiFrostMoonCount` | `src/types/resource/config.ts:450` | `src/mechanics/agents/miyabi.ts:174`, `src/types/resource/config.ts:444` | 0 |
| `liuyinHug60Count` | `src/types/resource/config.ts:460` | `src/mechanics/agents/liuyin.ts:242`, `src/types/resource/config.ts:454` | 0 |
| `orphieBladeHits` | `src/types/resource/config.ts:508` | `src/mechanics/agents/orphie.ts:270`, `src/types/resource/config.ts:502` | 0 |
| `xideVanguardEnergySpent` | `src/types/resource/config.ts:516` | `src/mechanics/agents/xide.ts:330`, `src/mechanics/agents/xide.ts:355`, `src/mechanics/typesHooks.ts:74`, `src/types/resource/config.ts:510` | 0 |
| `xixifuInitialToxin` | `src/types/resource/config.ts:528` | `src/mechanics/agents/xixifu.ts:93`, `src/mechanics/agents/xixifu.ts:219`, `src/types/resource/config.ts:522` | 0 |
| `xixifuC2Toxin` | `src/types/resource/config.ts:536` | `src/mechanics/agents/xixifu.ts:104`, `src/mechanics/agents/xixifu.ts:219`, `src/types/resource/config.ts:530` | 0 |
| `zhuyuanC1ChainReload` | `src/types/resource/config.ts:540` | `src/mechanics/agents/zhuYuan.ts:137`, `src/types/resource/config.ts:534` | 0 |
| `zhuyuanC1UltReload` | `src/types/resource/config.ts:542` | `src/mechanics/agents/zhuYuan.ts:138`, `src/types/resource/config.ts:536` | 0 |
| `defAssistCount` | `src/types/resource/config.ts:546` | `src/mechanics/agents/zhuYuan.ts:94`, `src/types/resource/config.ts:540` | 0 |
| `normaHatToChainCount` | `src/types/resource/config.ts:611` | `src/mechanics/agents/norma.ts:501`, `src/mechanics/agents/norma.ts:503`, `src/composables/resourceCalc/chainGift.ts:55`, `src/types/resource/config.ts:605` | 0 |
| `yixuanShufaInitial` | `src/types/resource/config.ts:643` | `src/mechanics/agents/yixuan.ts:383`, `src/types/resource/config.ts:637` | 0 |
| `jufufuHuweiHits` | `src/types/resource/config.ts:649` | `src/mechanics/agents/specPanelBuffs.ts:672`, `src/types/resource/config.ts:643` | 0 |
| `jufufuTigerChainCount` | `src/types/resource/config.ts:651` | `src/mechanics/agents/specPanelBuffs.ts:673`, `src/types/resource/config.ts:645` | 0 |
| `jufufuSpinCount` | `src/types/resource/config.ts:653` | `src/mechanics/agents/specPanelBuffs.ts:674`, `src/types/resource/config.ts:647` | 0 |
| `rinaEnergyPerRinaUlt` | `src/types/resource/config.ts:676` | `src/core/resource/crossAgentSupply.ts:193`, `src/mechanics/agents/rina.ts:142`, `src/mechanics/agents/rina.ts:319`, `src/types/resource/config.ts:670` | 0 |
| `lucyEnergyPerLucyUlt` | `src/types/resource/config.ts:678` | `src/mechanics/agents/lucy.ts:424`, `src/types/resource/config.ts:672` | 0 |
| `soukakuEnergyPerSoukakuUlt` | `src/types/resource/config.ts:702` | `src/mechanics/agents/soukaku.ts:111`, `src/types/resource/config.ts:696` | 0 |
| `timeFeasibleScale` | `src/types/resource/config.ts:821` | `src/core/resource/helpers.ts:212`, `src/core/resource/helpers.ts:536`, `src/core/resource/helpers.ts:550`, `src/core/resource/helpers.ts:551` … | 0 |

### T2 · 结果 / 中间对象的死字段（80 条）

**误报比例明显更高**：图表布局对象（`directDamageChart` 的 `lefts` / `centers`…）常被 .vue 以同名局部变量解构后使用，② 段会漏判成「没读」的反方向也有可能。每条必须先读消费方组件再下结论。只被测试读的诊断字段（测试读取数 > 0）**默认保留**，除非测试本身只是在断言这个字段存在。第 213 轮抽查过的三组：
- `anbyZero.teamFollowupDmgBonus`：额外能力已经走 spec teamBuffs 生效，这个字段是死的展示副本；
- `phoenix` 的 `c1CritDmg` / `emberGain`：specResources 诊断字段，`emberGain` 恒为 0；
- `yeshuguang.feiguangPerForm`：标了 `@deprecated` 的兼容字段。

这三组都不是数值 bug，可以删。

| 字段 | 声明 | 其余出现点（非测试） | 测试读取数 |
|---|---|---|---|
| `schemaVersion` | `src/specs/types.ts:211` | `src/specs/types.ts:210`, `src/logicEditor/toSpec.ts:40` | 1 |
| `withDiscs` | `src/core/panel.ts:258` | `src/core/panel.ts:285`, `src/core/panel.ts:323` | 6 |
| `exRefundEnergy` | `src/types/resource/energy.ts:73` | `src/core/resource/resourceIncome.ts:121`, `src/core/resource/resourceIncome.ts:145`, `src/core/resource/resourceIncome.ts:160` | 1 |
| `skillTableResolved` | `src/types/resource/execution.ts:63` | `src/composables/resourceCalc/helpers.ts:345`, `src/composables/resourceCalc/helpers.ts:409`, `src/composables/resourceCalc/helpers.ts:415`, `src/composables/resourceCalc/skillRows.ts:160` … | 0 |
| `truncatedRatio` | `src/types/resource/execution.ts:119` | `src/core/resource/timeTruncation.ts:126` | 1 |
| `cutEnergyRecovery` | `src/types/resource/execution.ts:146` | `src/core/resource/timeTruncation.ts:141` | 1 |
| `cutDecibelRecovery` | `src/types/resource/execution.ts:148` | `src/core/resource/timeTruncation.ts:142` | 2 |
| `windEnergyCap` | `src/types/resource/agentResources.ts:86` | `src/mechanics/agents/roxy.ts:236` | 0 |
| `assaultCritBaseRate` | `src/types/resource/agentResources.ts:192` | `src/mechanics/agents/jane.ts:81` | 1 |
| `assaultCritRatePerMastery` | `src/types/resource/agentResources.ts:193` | `src/mechanics/agents/jane.ts:82` | 0 |
| `tossingMoveId` | `src/types/resource/agentResources.ts:236` | `src/mechanics/agents/burnice.ts:240` | 0 |
| `cinema6SpecialEmberTotalDamage` | `src/types/resource/agentResources.ts:252` | `src/mechanics/agents/burnice.ts:188`, `src/mechanics/agents/burnice.ts:255` | 1 |
| `cinema6BurnBurstMultiplier` | `src/types/resource/agentResources.ts:254` | `src/mechanics/agents/burnice.ts:257` | 1 |
| `anomalyProficiencyBonus` | `src/types/resource/agentResources.ts:305` | `src/mechanics/agents/nangong.ts:111` | 1 |
| `impactFromMastery` | `src/types/resource/agentResources.ts:306` | `src/mechanics/agents/nangong.ts:106`, `src/mechanics/agents/nangong.ts:112` | 2 |
| `vibratoMax` | `src/types/resource/agentResources.ts:308` | `src/mechanics/agents/nangong.ts:114` | 0 |
| `beatCap` | `src/types/resource/agentResources.ts:314` | `src/mechanics/agents/nangong.ts:120` | 0 |
| `hatToChainCost` | `src/types/resource/agentResources.ts:417` | `src/mechanics/agents/norma.ts:175` | 0 |
| `barrageSeconds` | `src/types/resource/agentResources.ts:419` | `src/mechanics/agents/norma.ts:135`, `src/mechanics/agents/norma.ts:176` | 0 |
| `barrageCoverage` | `src/types/resource/agentResources.ts:421` | `src/mechanics/agents/norma.ts:134`, `src/mechanics/agents/norma.ts:135`, `src/mechanics/agents/norma.ts:177` | 0 |
| `yisha4NecessaryTime` | `src/types/resource/agentResources.ts:471` | `src/mechanics/agents/qingyi.ts:250` | 3 |
| `zuiHuaTime` | `src/types/resource/agentResources.ts:473` | `src/mechanics/agents/qingyi.ts:92`, `src/mechanics/agents/qingyi.ts:93`, `src/mechanics/agents/qingyi.ts:110`, `src/mechanics/agents/qingyi.ts:239` … | 0 |
| `dreamTarget` | `src/types/resource/agentResources.ts:482` | `src/mechanics/agents/luciaElowen.ts:301` | 0 |
| `rageDiDongComboCount` | `src/types/resource/agentResources.ts:535` | `src/mechanics/agents/banyue.ts:129`, `src/mechanics/agents/banyue.ts:130`, `src/mechanics/agents/banyue.ts:132`, `src/mechanics/agents/banyue.ts:303` … | 1 |
| `inkCycles` | `src/types/resource/agentResources.ts:579` | `src/mechanics/agents/yixuan.ts:206` | 0 |
| `cloudCycles` | `src/types/resource/agentResources.ts:581` | `src/mechanics/agents/yixuan.ts:207` | 0 |
| `cloudChargeSeconds` | `src/types/resource/agentResources.ts:595` | `src/mechanics/agents/yixuan.ts:214` | 0 |
| `derivedEnergy` | `src/types/resource/agentResources.ts:665` | `src/core/resource/helpers.ts:244`, `src/core/resource/helpers.ts:245`, `src/core/resource/assembleSlot.ts:187`, `src/composables/freeCompare/metrics.ts:253` … | 2 |
| `specialResources` | `src/types/resource/agentResources.ts:720` |  | 0 |
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
| `teamFollowupDmgBonus` | `src/mechanics/agents/anbyZero.ts:75` | `src/mechanics/agents/anbyZero.ts:150` | 0 |
| `masteryExcess` | `src/mechanics/agents/promia.ts:78` | `src/mechanics/agents/promia.ts:99`, `src/mechanics/agents/promia.ts:110` | 2 |
| `feiguangPerForm` | `src/mechanics/agents/yeshuguang.ts:196` | `src/mechanics/agents/yeshuguang.ts:284`, `src/mechanics/agents/yeshuguang.ts:312` | 0 |
| `feiguangScaleEach` | `src/mechanics/agents/yeshuguang.ts:197` | `src/mechanics/agents/yeshuguang.ts:285`, `src/mechanics/agents/yeshuguang.ts:313` | 0 |
| `dmgPerSec` | `src/mechanics/agents/qingyi.ts:73` | `src/mechanics/agents/qingyi.ts:111`, `src/types/resource/config.ts:552` | 0 |
| `rageDiDongComboCount` | `src/mechanics/agents/banyue.ts:129` | `src/mechanics/agents/banyue.ts:130`, `src/mechanics/agents/banyue.ts:132`, `src/mechanics/agents/banyue.ts:303`, `src/types/resource/agentResources.ts:535` … | 2 |
| `c1CritDmg` | `src/mechanics/agents/phoenix.ts:115` | `src/mechanics/agents/phoenix.ts:467` | 0 |
| `emberGain` | `src/mechanics/agents/phoenix.ts:118` | `src/mechanics/agents/phoenix.ts:470` | 0 |
| `primaryAgentId` | `src/composables/runArchiveImport.ts:38` |  | 3 |
| `submittedAt` | `src/composables/runArchiveImport.ts:39` |  | 0 |
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
| `higherBetter` | `src/composables/freeCompare/metrics.ts:67` | `src/composables/freeCompare/metrics.ts:119`, `src/composables/freeCompare/metrics.ts:126`, `src/composables/freeCompare/metrics.ts:133`, `src/composables/freeCompare/metrics.ts:140` … | 0 |
| `verificationId` | `src/specs/verify.ts:7` | `src/specs/verify.ts:50` | 0 |
| `targeted` | `src/utils/discEffectRows.ts:71` | `src/core/resource/tailPipeline.ts:110`, `src/utils/discEffectRows.ts:141`, `src/mechanics/agents/starlightBilly.ts:181`, `src/mechanics/agents/starlightBilly.ts:406` … | 0 |

### T3 · 数据类型字段（31 条）· **不做**

`types/catalog.ts`、`bossPreset.ts`、`teamPreset.ts` 等描述 JSON 数据形状的接口：字段由导入脚本写入、代码不读，这是正常的（数据比代码消费得多，类型如实描述数据）。删掉类型字段不会删数据，只会让类型失真。**不做**。列在这里只是为了下次普查时不再重复分诊。

| 字段 | 声明 | 其余出现点（非测试） | 测试读取数 |
|---|---|---|---|
| `enemyLumifluxStunResReduction` | `src/types/catalog.ts:158` | `src/core/panel.ts:102` | 0 |
| `enemyLumifluxAnomalyResReduction` | `src/types/catalog.ts:166` | `src/core/panel.ts:110` | 0 |
| `appliesToOutOfCombatPanel` | `src/types/catalog.ts:277` |  | 0 |
| `sourceType` | `src/types/catalog.ts:304` | `src/core/inCombatBuffs.ts:158`, `src/core/inCombatBuffs.ts:195`, `src/stores/catalog.ts:61`, `src/composables/resourceCalc/panelPhases.ts:570` | 0 |
| `sourceCategory` | `src/types/catalog.ts:305` | `src/core/inCombatBuffs.ts:159`, `src/core/inCombatBuffs.ts:196`, `src/stores/catalog.ts:62`, `src/composables/resourceCalc/panelPhases.ts:571` | 0 |
| `sourceKind` | `src/types/catalog.ts:306` | `src/core/inCombatBuffs.ts:160`, `src/core/inCombatBuffs.ts:197`, `src/stores/catalog.ts:63`, `src/composables/resourceCalc/panelPhases.ts:572` | 0 |
| `teammateName` | `src/types/catalog.ts:311` | `src/core/inCombatBuffs.ts:165`, `src/core/inCombatBuffs.ts:202`, `src/stores/catalog.ts:68`, `src/composables/resourceCalc/panelPhases.ts:577` | 0 |
| `defaultLevel` | `src/types/catalog.ts:334` | `src/types/catalog.ts:438` | 0 |
| `attackTypes` | `src/types/catalog.ts:357` |  | 0 |
| `damageBasis` | `src/types/catalog.ts:384` | `src/core/damage.ts:266` | 0 |
| `levelRange` | `src/types/catalog.ts:408` |  | 0 |
| `minLevel` | `src/types/catalog.ts:436` |  | 0 |
| `defaultLevel` | `src/types/catalog.ts:438` | `src/types/catalog.ts:334` | 0 |
| `modification` | `src/types/catalog.ts:457` |  | 0 |
| `calculation` | `src/types/catalog.ts:545` | `src/logicEditor/fusion.ts:13` | 0 |
| `desc2_en` | `src/types/catalog.ts:573` |  | 0 |
| `desc4_en` | `src/types/catalog.ts:574` |  | 0 |
| `desc2_zh` | `src/types/catalog.ts:575` |  | 0 |
| `desc4_zh` | `src/types/catalog.ts:576` |  | 0 |
| `format` | `src/types/catalog.ts:582` | `src/core/damage.ts:11`, `src/core/anomalyPool/helpers.ts:53`, `src/core/discStatMode.ts:15`, `src/views/StunAxisPage.vue:253` … | 0 |
| `second` | `src/types/catalog.ts:595` |  | 0 |
| `nanoka_wengine_id` | `src/types/catalog.ts:602` |  | 0 |
| `nanoka_id` | `src/types/catalog.ts:621` |  | 0 |
| `source_url` | `src/types/catalog.ts:622` |  | 0 |
| `skill_priority` | `src/types/catalog.ts:632` |  | 0 |
| `metadata` | `src/types/catalog.ts:638` | `src/specs/types.ts:66`, `src/logicEditor/validation.ts:62` | 0 |
| `displayValue` | `src/types/catalog.ts:658` | `src/core/damage.ts:321`, `src/core/damage.ts:329`, `src/core/damage.ts:338`, `src/core/damage.ts:352` … | 0 |
| `stageNum` | `src/types/bossPreset.ts:22` | `src/types/bossPreset.ts:198` | 0 |
| `catalogId` | `src/types/bossPreset.ts:120` |  | 0 |
| `iconSource` | `src/types/bossPreset.ts:127` |  | 0 |
| `stageNum` | `src/types/bossPreset.ts:198` | `src/types/bossPreset.ts:22` | 0 |
