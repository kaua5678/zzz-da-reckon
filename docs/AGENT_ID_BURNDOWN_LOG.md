# agentId 清偿编年史（AGENT_BRANCH_BASELINE 沿革）

> 本文件是 `scripts/check-guards.mjs` 中 `AGENT_BRANCH_BASELINE` 常量的**沿革编年史**（逐轮对账、逐队归因、实验过程）。
> 按 AGENTS.md 规则 8 分层契约，编年叙事进 git 历史与账本、不进代码，故从该文件搬出。
> **当前读数、口径与判据以 `scripts/check-guards.mjs` 为唯一事实源**（该常量旁的指针注释 + `RATCHET_BURNDOWN` 登记表）。

---
2026-08-30 冻结基线：规则 6 生效前的历史存量（按「含 agentId ===/!== 的行数」计）。

沿革（**单文件口径**）：53（2026-08-30 冻结）→ 52(栈轴 1551) → 48(promia) → 39(四反馈块)
→ 8(runCalcRound 收线刀) → 0(第 27 轮真清偿 8 处，`useResourceCalc.ts` 该文件清零)。

⚠ **2026-09-12 口径纠正（本条最重要）**：上面那串 53→0 是单文件读数，而 #10 把代码搬进了
`resourceCalc/`——特判随之外迁，**编排层全量**实测 86→86→79。即 53→8 的「大降」绝大部分是
**位移不是清偿**（四笔注因其实都如实写了「随本体进落点」，是度量范围没跟着代码走）。
故度量改为 `listAgentBranchFiles()`（入口 + 目录），frozen 取纠正后**提交态**实测值 **78**。
**78 才是编排层真实的 agentId 特判存量**，逐角色迁 `applyTeamConfig`/声明式钩子才是真 burn-down。

⚠ 取数纪律：基线必须量**提交态（HEAD）**，不能量带并行会话 WIP 的工作树——量错会让 CI 在别人提交后假红。
2026-09-12 +1：78→79 = 菲欧妮（1641）脆弱暴伤档位 tier2 的额外能力 buff-id 过滤（SOP §6.2 标准接线，
17 条同类先例的最新一条；收敛方向 = 声明式 buff 级 teamConditions 替代逐条过滤，勿再新增）。
2026-09-13 −14：79→65 = helpers.ts 额外能力门控簇（14 角色 slot 查找 + evalAdditionalAbility 求值 +
17 条逐 buff-id 过滤）收敛为数据驱动表 `ADDITIONAL_GATE_BUFFS` + `evalAdditionalAbilityBuffGates`
（SOP §6.2 语义逐位保留；一一对应护栏 `additionalGate.test.ts`）。真 burn-down 的第一簇。
2026-09-15 −9：65→56 = `convergence.ts` cfg-merge 簇（1381/1391/1431/1151/1541/1331/1161/1181/1191）
的跨轮反馈注入从「编排层逐 agentId 分支写 cfg」改为「模块 applyTeamConfig 读 threads 快照写自己
那份 cfg」（规则 6）。契约面 = `AgentTeamConfigInput.threads`（递整份 `CalcRoundThreads` 快照，
不再逐字段铺开——`roundThreads.ts` 头注释写明它本就是这份集合的单一事实源）。
判据 = `timeGolden` 16 键 **0 delta** + `allAgentsSweep`/`timeFillRatchet`/`underfillRefund` 全绿。
2026-09-15 −1：56→55 = 轴内终结技喧响消耗 `agentId === '1551' ? 2000 : 3000` → 读本槽
`cfg.ultimateCost`（`specPanelBuffs.ts:174` 早已写 2000）⇒ agentId 判断冗余（同 T6 判据：
字段唯一写入方 = 该角色模块）。解析抽成导出纯函数 `resolveAxisUltimateDecibelCost`，使
「按槽读、不按 agentId 认人」可被单测直接证伪（教训：断言写在**输入**上会假绿，见 peiluo.test.ts 注释）。
2026-09-15 −2：55→53 = `nomra 1571`（normaStunCount/normaStunCoverage/normaBattleTime）与
`qingyi 1251`（qingyiStunCount）的失衡次数注入迁进各自模块的 `applyTeamConfig`（converge 阶段）。
判据同 T6：字段消费方**只有本模块**（`config.ts` 声明、模块内读），且 hook 入参已含
`stunCount`/`combatTime` ⇒ 不需要在编排层认人。实测：timeGolden 0 delta；
反向验证（停掉 norma 的注入）⇒ `agent:1571:c6.slot0` 时间账精确变化 = 注入是活反馈。
2026-09-15 −4：51→47（同批「模块 source 字段即角色标识」簇，全在 `damagePool.ts`）= 去掉
5 处 `charResult.agentId === '<id>'` 判断，因为同条件的**模块产物字段**已经蕴含角色：
  · 悠真 `harumasaStunOnly`（唯一写入方 harumasa.ts，且只在轴模式写）
  · 柏妮思 `burniceMechanicSource`（burnice.ts:312）×1、琉音 `liuyinMechanicSource`（liuyin.ts:387）×3
判据同 T6：字段唯一写入方 = 该角色模块 ⇒ 字段存在即蕴含是该角色。timeGolden 0 delta。
⚠ **同批明确保留的**：`damagePool.ts:406` 的 `charResult.agentId === '1171' ? cinema : 0` **不是冗余**——
它限制的是「只有柏妮思才吃自己 C4 的暴击 30%」，`cinema>=4` 对所有角色都成立，去掉会误伤全队。
2026-09-15 −1：52→51 = `damagePool.ts` 的悠真失衡专属直加
`charResult.agentId === '1201' && isAxis && exec.harumasaStunOnly !== undefined`
→ 去掉 agentId 与 isAxis（`harumasaStunOnly` 的唯一写入方 = `harumasa.ts:329` 的 patchExecutions，
且只在 `cycle.axisActive` 时写 ⇒ 字段存在即蕴含「是悠真且轴模式」，判据同 T6）。timeGolden 0 delta。
2026-09-15 −1：53→52 = `peiluo 1551`（peiluoVerdictCount + extraSelfDecibelReward）迁进
`specPanelBuffs` 的 `peiluoProminenceMechanic.applyTeamConfig`。⚠ 两处等价性要点：
① `extraSelfDecibelReward` 是**跨角色共享累加通道**（橘福福/蕾米埃尔/orphie 各自 `+=`）⇒ 必须累加不可覆盖；
② `peiluoVerdictCount` **无条件**写（含轴模式，原分支无门控）——加 `axisMode` 门控 = 行为静默改变，
   而该路径 `timeGolden` 覆盖不到（实测不红），靠 `teamHook.test.ts` 的 hook 级用例钉住。
2026-09-15 −5：52→47 = `damagePool.ts` 五处「模块 source 字段 ⇒ 角色标识」去冗余（见上方同批注释）。
2026-09-16 −13：47→**34** = `nextRoundFeedback` 钩子（新契约，本批最大单簇）。
2026-09-16 −2：34→**32** = 轴上下文契约 `AgentTeamConfigInput.axis`（round 11 批次 1，设计卡 §3 方案 A）。
  迁走 `convergence.ts` 两处轴内块计数分支：1201 悠真（`harumasaAxisSlash`/`harumasaAxisArrow`/
  `harumasaAxisActive`，白名单 = 模块自己的 `HARUMASA_SLASH_MOVE_IDS`/`HARUMASA_ARROW_MOVE_ID`）
  与 1241 朱鸢（`zhuYuanAxisEther`/`zhuYuanAxisActive`，白名单 = `ZHUYUAN_SUPPRESS_ETHER_MOVE_IDS`）
  ⇒ 计数逻辑回模块，**moveId 白名单从编排层硬编码搬回模块常量**（此前两处各写一份、改一处即静默脱钩）。
  契约形状：`axis.active/axes/windows/windowSeconds/actionCountsBySlot/ultimateTotalBySlot/chainTotalBySlot`
  （**零新通道**：`characters` 本就带 `axisInSeconds`/`axisActionCounts`/`axisUltimateTotal`，本契约只是把
  散落在数组元素上的轴态字段收成一份显式快照；派发点唯一 = `convergence.ts` 的 converge 那次调用）。
  相位语义：**只在 converge 有值**（build 相位轴还没解析、postRound 相位语义是「为下一轮」）。
  ⚠ 门控是**双判据**（`phase !== 'converge' || !axis`）：只判相位时「派发器忘传 axis」会退化成
  静默零值——而 `timeGolden` 对本簇**全盲**（105 预设里 1201/1241 的轴覆盖各 **0 队**；
  实测 1241 删掉原分支 `npm run check` 与 `timeGolden` 双双全绿）⇒ 本批新建
  `src/mechanics/__tests__/axisContext.test.ts`（11 例）把三跳分别钉死（模块消费 / 派发器透传 / 真管线相位）。
  反向验证 6 组，逐组精确红、跑完即还原并 md5 自证：①converge 不传 axis ⇒ 3 例红（axisContext）
  +`harumasa.test.ts` 1 例红；②1201 模块短路读 axis ⇒ `harumasa.test.ts`「轴模式失衡专属 buff 行级直加」红；
  ③1241 模块短路读 axis ⇒ `zhuYuan.test.ts` **16 passed 不红**（实证该角色零覆盖、正是本批要补的洞）
  而 axisContext 3 例红；④postRound 也传 axis ⇒ 相位用例红；⑤派发器丢 axis ⇒ 4 例红；⑥白名单污染 ⇒ 计数用例红。
  `timeGolden` 3 passed 且 `grep -c "dmg:"` == **0**。

`convergence.ts` 原有 5 个导出纯函数 `compute{Promia,Anby,Lucy,Vivian,Ellen}NextRoundFeedback`
（普罗米娅 1541 / 零号·安比 1381 / 露西 1151 / 薇薇安 1331 / 艾莲 1191），每个都在自己函数体里
`characters.some(c => c.agentId === '<id>')` 认人 + 逐处 `filter/find(c => c.agentId …)` 排除自身，
共 **13 处** agentId 判断（= 本批降幅）。现整体迁进各角色模块的 `nextRoundFeedback` 钩子。

契约面（照 `crossAgentSupply`（`27918d1`）/ `threads` 快照的既有范式，未另起设计）：
`AgentMechanicModule.nextRoundFeedback?(input: AgentNextRoundFeedbackInput)`，入参递**整份本轮结果**
（`teamResult` + `displayResult` + `adjustedResult` + `anomalyPool` + `prevThreads` 快照 + `combatTime`
+ `getAgentSkills`）**与 `cfg`**（模块自己那份，**可写**）；返回 = 本模块的下一轮线程值
（`Partial<CalcRoundThreads>`），由编排层 merge 进 `threadsNext`（单一 owner，模块不写 threads）。
派发器 = `collectNextRoundFeedback`（`composables/resourceCalc/panelPhases.ts`，槽位序 0→1→2、零 agentId）。

⚠ 三条实测纪律（抄本范式前必读）：
① **首轮守卫语义各不相同，逐位保留**：普罗米娅/薇薇安/艾莲 = `prevThreads.<字段> <= 0` 才写回 cfg；
   **露西 = 每轮无条件写**（消费端 `crossAgentSupply.perTargetAmounts` 读的就是本轮估计值）。
   统一成一种写法 = 静默改行为（单测 `nextRoundFeedback.test.ts` 两种都有断言）。
② **`timeGolden` 对本簇部分站点是盲的**（交接文档纪律 4 的实证）：逐个摘掉模块注册表里的钩子后跑
   `timeGolden`，普罗米娅(−7.4%…−13.4%) / 零号·安比 / 薇薇安(−25.8%…−42.3%) / 艾莲(`agent:1191:c6`) 变红，
   但 **露西全绿**——它唯一的预设 `auto-1041-1571-1151` 是 0 命，而露西反馈只在 C1/C6 生效。
   ⇒ 本批另加 hook 级单测 `src/mechanics/__tests__/nextRoundFeedback.test.ts`（20 例），
   其中两条**管线级**用例专补盲区（露西 C6：`crossAgent.lucyEnergy` 58 vs 摘钩子 30；
   艾莲影画4：`ellen_cycle.c4EnergyTotal` 16 vs 摘钩子 0）。
③ **不要用 `characters[slot]` 取自己那份 cfg**：`characters` 是**按位置压缩**的数组
   （`buildCharConfig` 跳过空槽），槽位号 ≠ 下标；前导空槽时 `characters[slot]` 是 `undefined`
   （2026-09-16 实测：`['', 1041, 1191]` 下艾莲影画4 冻结数 4→0 静默失效）。
   故 `AgentNextRoundFeedbackInput` 显式给 `cfg`。⚠ 存量另有 19 处 `characters[slot]`
   （`applyTeamConfig` 等，含 `7e377cb` 引入的那批）有同一缺陷，属**既存问题、本批未动**。

**32 → 29 沿革（2026-09-16 round 12 批次 2，设计卡 §5 批次 2 + 可选第三处）**：`convergence.ts` 的
`characters.map` 里再迁走三个 `merged.agentId === '…'` 分支，均改读 `AgentTeamConfigInput` 的
既有契约（`axis` / `threads`，round 11 落地的整份快照，零新通道）：
 · **1531 星徽·比利** → `starlightBilly.ts#applyBillyTeamConfig`：`billyAxisEx`（轴内捏块，
   含 **combo 展开**——轴块命中 `combos['billy-ex-chain']` 时展开成 动力压制/孤轮/摇曳 三子招式
   各 `count × mv.count × wins`；整块只记一次会少一个量级）+ `billyAxisActive` + `billyStunCoverage`
   （后者 = 派发器对所有角色通用注入的 `teamStunCoverage`，与旧 `provStunCoverage` 同源同值）。
   ⚠ 未顺手删 `core/resource.ts:523`——core 侧已明确记载试过改字段判据并**否决**（见
   `CORE_AGENT_BRANCH_BASELINE` 沿革）。
 · **1591 希格莉德** → `sigrid.ts#applySigridTeamConfig`：`sigridAxisPozhenSets`（`sigrid-pozhen`
   块 × 窗口数 + C6 的 gift 连携块）+ `sigridAxisActive`；**非 C6 前封顶 = Σ`axis.windows`**
   （= 已分配窗口总数，**不是 `windows.length`**——多轴且某轴 0 窗时后者会高估）。
 · **1511 南宫羽** → `nangong.ts#buildNangongTeamConfig`（**可选第三处**）：`nangongQuickAssistPlaced`
   （轴内**单** moveId `1511013` 块 × 窗口数，走 `axis`）**+** `inStunWindowTriggers`（走 `threads`
   ——它是上一轮「失衡内异常 v2 平均每窗触发数」的**线程值副本**，原实现读的 `prevInStunWindowTriggers`
   与 `threads.inStunWindowTriggers` 是同一对象同一字段）。⚠ 两条路刻意分开：**读线程**与**写 cfg**
   是两个不同动作，混成一条会把「为下一轮」的语义写进本轮 cfg。
 · **1141 莱卡恩（棘轮 −0，分支仍在）**：只迁走 `lycaonWindowDuration` ← `axis.windowSeconds`
   （= 同一个 `computeWindowDuration()` 返回值）。⚠ 任务卡预期「契约已解锁 2 字段 ⇒ 1141 −1」
   **实测不成立**：`lycaonC2Energy` 的非轴臂需 `countStun`（C7 计数投影版失衡次数，
   `projectStunPlanForCounts(stunCount, base.stunPlanProjection)`），而该全局量**不在契约上、
   也不是注册的 `MechanicSetting`**（`grep -rn stunPlanProjection src/mechanics/ src/specs/` = 0 命中）
   ⇒ 用未投影的 `stunCount` 迁移是静默改语义（难度阶梯 G4「取整」会打开该开关）。故 1141 分支保留。
测试：`src/mechanics/__tests__/axisContext.test.ts` 自 11 例扩到 **24 例**（combo 展开逐键精确值 /
Σwindows 封顶与 `windows.length` 的可分辨反例 / C6 gift 门槛 / windowSeconds 取值 + C2 不得由钩子写 /
1511 双路分离 / ★1141 端到端精确值 `21.2465` vs 短路回落 `?? 16` 的 `24`），全精确值、不用 `> 0`。
验收：`timeGolden` `grep -c "dmg:"` == **0**；`check-guards` 17/17；反向验证 6 组逐处精确红（见提交说明）。

**29 → 27 沿革（2026-09-16 round 13 批次 3，设计卡 §5 批次 3）**：`convergence.ts` 再迁走两处中的一处，
外加一处**死写**删除（净 −2）：
 · **1051 伊德海莉** → `yidhari.ts#applyYidhariTeamConfig`：`yidhariStunCount` ← `stunCount`
   （**轴无关**，轴/非轴恒写）+ `yidhariInStunExCount` / `yidhariInStunEnergyCost` ← `axis`
   （轴内连段反推：`yidhari-heavy-single` = 1 重碾/50-60 闪能、`yidhari-heavy-double` = 2 重碾/85，
   各 × 块数 × 窗口数）。⚠ **头号风险是「条件写」形态**：这两个字段只在 `axis.active && 合计>0`
   时写（≠ 恒写 0）——`core/resource/helpers.ts#resolveExSpecialCount` 用 `!== undefined`
   选通路（有 = 失衡内次数已知、按 `(总闪能−失衡内成本)/消耗` 反推非失衡；缺 = 纯能量预算口径）。
   ⚠ 成本档读的是**槽 0** 命座（原实现逐字 `configStore.team[0]?.cinemaLevel`，非本槽），
   此处逐位保留；轴预设把 1051 钉在槽 0（`1章-琉`/`1章其他` 的 `team[0]==='1051'`，
   且全部章鱼轴块 `slot` 实测恒 0）⇒ 全部可命中路径同值。
 · **死写删除 −1**：`convergence.ts` 的 `if (prevInStunWindowTriggers <= 0) { … c.agentId === '1511' … }`
   写回块（round 12 复核「确为死写但超授权面」，本批授权处置）。判死用**静态**证据（死写不可能有
   测试变红）：`characters` 是该轮 `base.characters.map` 的局部克隆，该写入点之后**零引用**，
   其间唯一闭包 `inAxisFractionProvider` 只捕获 `rr.characters` 且调用点在写入之前
   ⇒ 写入一个此后无人读的对象。同时删掉因此变为未使用的解构 `prevInStunWindowTriggers`
   （`vue-tsc` TS6133 抓出）。1511 的真实消费路 = 模块读 `threads`（批次 2 已迁）。
 · **1371 仪玄 —— 未迁，分支保留**：证伪闸门**已触发**（见下），棘轮 −0。

⚠ **1371 的证伪闸门已触发（本批最重要的实测结论，是「需扩契约」的有效结论、不是失败）**：
按设计卡 §6 剥掉引擎侧 1371 分支、把 8 个字段搬进模块 `applyTeamConfig` 后跑 `yixuanSmoke.test.ts`
⇒ **9 failed / 4 passed**（超出卡里点名的 3 条）。逐输入受控两臂实验证明缺口**只有一个**：
`yixuanExtremeAssistCap` 的原实现读 `configStore.team` 的**未缩放、未跑 parrySplit** 的队友弹刀和，
而契约可见的 `characters` 上那份已被 `interactionScale` 缩放、被 parrySplit 改写。实测差距
（全 6 个 1371 预设）：无 boss 时 3/6 队分化（`yixuan-roxy-lucia` storeΣ=6 vs mergedΣ=2、
`auto-1371-1481-1451` 6 vs 4、`auto-1371-1571-1451` 6 vs 5——三队都开了降配 `interactionScale`）；
带叶释渊预设（parryTotal=13）时 5/6 队分化（mergedΣ 变 13/9，storeΣ 恒 6）。**臂 B 实验**
（把 store 口径和经 axis 递进去、其余 7 字段照搬模块）⇒ `yixuanSmoke` **13 passed 全绿**，证明：
（a）其余 7 个字段的迁移逐位等价；（b）唯一缺口 = 「**未缩放交互次数**」，正是 `OPEN-ITEMS.md`
§2 T5 已登记的契约缺口（与 1141 的 `lycaonBackstageDodgeCount` **同一个**缺口）。⇒ 保留分支、如实挂账。
测试：`axisContext.test.ts` 自 24 例扩到 **29 例**（1051 五例：单/双次碾逐位精确值、1 命成本档、
多轴窗口对齐、★条件写形态（合计 0 / 轴退化 / 缺 axis 三种都不写，且 stunCount 照写）、相位门控）。
反向验证 4 组（全精确红）：① 模块短路 axis ⇒ 3 例红；② 恒写（丢条件形态）⇒ 1 例红；
③ 丢 1 命成本档 ⇒ 1 例红；④ 派发点不传 axis ⇒ 4 例红。
⚠ `timeGolden` 对本处**结构性盲**（实测）：7 个含 1051 的预设全是 0 命 ⇒ 命中 chapter-0 轴预设
（`0章-琉`/`0章其他`），其中章鱼招式以**裸 id**（`1051011`/`1051012`）表达、**没有** combo 键
⇒ 连段反推恒 0（迁移前后都只写 `yidhariStunCount`）。带 `yidhari-heavy-*` 的 `1章-*` 预设只在
1051 **≥1 命**时命中。故本处判据只能由 `axisContext.test.ts` 承担（`grep -c "dmg:"` 实测 == 0）。

── 2026-09-16 round 14 批次 4：27 → **25**（−2）────────────────────────────────
**补「未缩放交互次数」契约 ⇒ 迁 1371 仪玄整条分支（−2）+ 顺收 1141 的 `lycaonBackstageDodgeCount`（−0）**。

· **新契约 `AgentTeamConfigInput.interactions`**（`AgentInteractionContext`：`bySlot` 按槽位键控的
  `{ agentId, parryCount, blockCount, dodgeCounterCount, dualCounterCount, quickAssistCount }` 快照）。
  存在的理由（本轮实测）：契约里 `characters` 那份 cfg 的交互次数**已被改过两道**——
  ① `interactionScale`（非轴降配）`Math.round(x × scale)`；② `parrySplit`（保底4失衡反推）**改写**
  击破位/主C 的 `parryCount`。而两个原实现读的都是 **`configStore.team` 原值**：
  · 仪玄 `yixuanExtremeAssistCap`（Σ队友弹刀）——round 13 受控两臂实验已证：用合并值 ⇒ `yixuanSmoke`
    **9 failed**；按 store 口径递入 ⇒ **13 passed**；
  · 莱卡恩 `lycaonBackstageDodgeCount`（Σ队友闪反）——同族缺口（round 12 已挂账）。
  ⇒ 一次契约扩展解锁两处。**只读 + 只在 converge 相位有值 + 派发器不做 `?? {}` 兜底 +
  模块侧双判据门控**（`phase !== 'converge'` 早退 + `!interactions` 时不写依赖字段）。

· **`convergence.ts` 的 `merged.agentId === '1371'` 整条分支删除**——8 个字段全部迁进
  `yixuan.ts#applyYixuanTeamConfig`，分五个通道（逐字段口径与三处「逐位保留」形态钉在模块注释）：
  ① 轴内量（`yixuanAxisEx` / `yixuanAxisCloudSeconds` 的 `duration ?? 2` 加权 + **无权重写 2** /
     `yixuanAxisActive` 恒写含 false）走 `axis`；
  ② `yixuanC1LightningCount` 走**算出来的** `axisInSeconds > 0`（= `Σ windows × windowSeconds`，
     **不是** `axis.active`——`forceNoAxis` 退化时两者不同值）⇒ 轴/非轴**两臂**都保留；
  ③ 线程量（`yixuanAnomalyTriggerFlash` ← `min(18, max(0, floor(auricInkFlash)))`）走 `threads`；
  ④ `extraSelfDecibelReward` 的橘福福项（`+=` `prevFuFa × 300`）走 `threads` + **按身份** `characters.some`；
  ⑤ 缺口量 `yixuanExtremeAssistCap` + 参与求和极的 `yixuanFlashBonus`（`+=`）走 `interactions`。
  ⚠ **−2 不是 −1**：该分支含**两行**被计数（`merged.agentId === '1371'` 与其中的
  `c.agentId === '1391'` 橘福福判据）——后者随迁移改成模块内的 `JUFUFU_AGENT_ID` 常量比较，
  编排层不再有该特判。

· **1141 分支仍存在（−0）**：`lycaonBackstageDodgeCount` 已迁（走同一 `interactions` 契约，
  过滤口径**刻意不同**：带 `agentId` 判据 ⇒ 排除空槽残留计数；仪玄那条只看槽位号），
  但 `lycaonC2Energy` 仍缺 C7 计数投影量（`countStun = projectStunPlanForCounts(stunCount,
  stunPlanProjection)`，模块读不到 `stunPlanProjection`）⇒ 保留分支，如实挂账。

· **core 保持 6**：本批未触碰 `src/core/**`（契约扩展是编排层加法），core 棘轮零变化。

**反向验证 6 组（全精确红，逐组还原 + md5 自证）**：
  ① 派发点 `bySlot` 恒空（契约在但数据空）⇒ `axisContext` 2 例 + `yixuanSmoke` **3 例**红
     （含端到端「极限支援落雷次数」与 1141 那条端到端）；
  ② 模块短路 `axis` 通道 ⇒ `axisContext` 5 例 + `yixuanSmoke` **2 例**红（4 失衡轴 3+1 / 轴内凝云时长）；
  ③ 模块短路 `threads` 通道 ⇒ 2 例红（玄墨线程值 + 独立门控）；
  ④ `yixuanFlashBonus` 的 `+=` 改成覆盖 ⇒ 6 例红（含 `expected 105 to be 175`）；
  ⑤ 模块短路 `interactions` 通道 ⇒ `axisContext` 3 例 + `lycaonSmoke` **1 例**红；
  ⑥ **数据源换成 `characters`**（已缩放/已 parrySplit 改写——即本轮要修的缺口本身）⇒
     `yixuanSmoke` 精确 1 例红（`expected 8 to be 9`）⇒ 证明「必须读 store」不是猜测。

判据面：`axisContext.test.ts` **29 → 48 例**（+19：1371 的 8 字段逐条 + 三通道独立门控 +
1141 两条 + 派发器跳②两条 + 真管线跳①端到端一条）；`timeGolden` `grep -c "dmg:"` 实测 **== 0**；
`yixuanSmoke` **13 passed**（本轮证伪闸门）；`npm run check` **2471 passed**。

**25 → 23 沿革（2026-09-16 round 15 R15-a：`damagePool.ts` 分诊切批第一批，零新契约）**：
round 14 的只读分诊（`~/.dsh/session-manager/reports/R14-triage-damagePool.md`，11 处逐处清单 +
分 6 组 + 四批切分）判定本文件 11 处**不同形**，并给出「先做零契约批」的建议。本批照做两处：
 · **:408 柏妮思影画4/6** → `burnice.ts#patchBurniceExecutions`（该模块**新增**钩子）。
   原判据 `charResult.agentId === '1171' ? configStore.team[slot]?.cinemaLevel ?? 0 : 0` 后跟两条：
   C4 → `category ∈ {special, assist}` 的行 `critRateBonus += 30`；C6 → `1171012`/`1171013`
   各 `resIgnore += 25`。**通道不变**（damagePool 本来就在读 `exec.critRateBonus`/`exec.resIgnore`
   再 `?? 0` 透传，:409/:412 是这两条的唯一消费者）⇒ 搬进模块 = 值逐位不变（`timeGolden`
   `grep -c "dmg:"` 实测 **== 0**）。命座改读模块自己那份 cfg 的 `burniceCinemaLevel`
   （`buildCharConfig` 无条件写，模块内先例 4 处）——正是本批要消灭的「编排层替角色认人」。
   ⚠ 顺带把 `buildExecutions` / `buildAnomalyEvents` 里**各写一份**的 15 行 `computeBurniceMechanic`
   入参收成 `burniceMechanicSourceOf(cfg, state)` 单一入口（两份逐字相同，漂移风险）。
 · **:970 般岳影画6 摧岳附伤** → 改为读**倾山行上的模块标记** `banyueC6CrushAttach`（= 附伤倍率，
   唯一写入方 = `banyue.ts#patchBanyueExecutions`，**仅 C6** 写自己的 `MOVE.qingShan` 行）
   ⇒ 字段存在即蕴含「是般岳且 C6」（T6 判据，与本文件 `burniceMechanicSource`/`liuyinMechanicSource`
   同族）。**刻意不改成模块直接产执行行**：这条附伤是倾山的自动触发事件，不占前台时间、不进资源
   账本、不产资源利用率行——push 成执行行会连带改时间预算/失衡/积蓄三本账（原注释即此意）。
   **刻意不改成读 `banyueRageCycle.rageCount`**：那份是**截断前**的循环次数，而本处口径是
   截断后的倾山行 `count`（原 `executions.find('1471009').count` 读的就是同一行）⇒ 换源 = 静默改语义。

· **判据面（本批新增）**：`src/composables/__tests__/damagePoolBatchR15a.test.ts`（**13 例**，
  全部精确值）——跳③模块钩子四条行级分支（C0 不伪造 / C4 三态 / C6 精确到 moveId / `+=` 累加）
  + 跳①真管线（C0·C4·C6 三档命座、般岳 C5 vs C6、附伤次数 == 倾山次数）+ **正控与反锁成对**
  （「般岳 C6 有标记」与「非 1171/1471 队零泄漏」）。新增本文件的理由：迁走后这两处
  **没有任何既有测试**能区分「迁移成功」与「静默失效」。
· **反向验证 5 组（全精确红，逐组还原 + `md5sum -c` 自证）**：
  ① C4 臂短路 ⇒ 5 例红（`expected [undefined,…] to deeply equal [30,30,…]` 等）；
  ② C6 臂只留 `1171012`（删 `1171013`）⇒ 2 例红（`expected [25,undefined,…] to equal [25,25,…]`）
     ——证明「精确到 moveId」这条断言真的在锁 1171013，`> 0` 型断言会漏；
  ③ 般岳标记不写 ⇒ 3 例红（`expected undefined to be 600`）；
  ④ 标记值硬编码 999 ⇒ 2 例红（`expected 999 to be 600`）——证明消费端真的读标记值；
  ⑤ damagePool 消费块短路（标记在但没人消费）⇒ 1 例红（附伤行整行消失）。
· **剩余分布（R15-a 后）**：`damagePool.ts` **11 → 9** · `convergence.ts` 10 · `helpers.ts` 4。

── 2026-09-16 round 16 **R15-b（−3，编排 23 → 20）**：`axisWindowOverlays` 契约扩容 ──────────
迁走 `damagePool.ts` 三处 `charResult.agentId` 判据，落到模块自己的 `axisWindowOverlays` 钩子：
 · **:441 般岳明王**（原 `=== '1471' && (execPanel?.additionalAbilityActive ?? 0) > 0 && cinemaLevel < 6`，
   内层 `if (isAxis) 扫描层数 / else 覆盖率折算`）→ `banyue.ts#axisWindowOverlays`。
   轴臂仍给 `banyueMingwangStacks`（**层数**，消费端 ×`MINGWANG_BASE_PER_STACK`）；非轴臂给
   **标量** `banyueMingwangPct = 5 × 3 × cov` —— ⚠ 折算结果**不是层数**，塞进桶会让消费端再乘一次每层 5%。
 · **:455 可琳扫除帮手**（原 `=== '1061' && aaActive > 0`，内层 `if (isAxis) … else …`）→ `corin.ts`。
   非轴臂给标量 `corinStunBonusPct = CORIN_ADDITIONAL_DMG × cov`。**刻意不复用桶**：桶值恒
   `CORIN_ADDITIONAL_DMG`(35) 是模块与 `types.ts` 双重文档化、且 `teamHookMigration.test.ts`
   **精确断言**的不变量（`get('basic_attack') === 35`），写 `35×cov` 会让它失真。
   轴臂的**段级**门控 `stunOverride > 0`（轴外段敌人未失衡）留在伤害池——它与角色判据无关。
 · **:466 希格莉德浸染**（原 `=== '1591' && aaActive > 0`，**`isAxis` 不出现** ⇒ 与轴模式无关）
   → `sigrid.ts`，整支迁走，走新契约的 `windInfectionRate`。

**契约面（本批的核心改动）**：`AgentAxisOverlayInput` 补 4 个字段 —— `isAxis`（真轴模式布尔）/
`additionalAbilityActive` / `windInfectionRate` / `settings`；`AgentAxisOverlays` 新增
`scalarBySlot: Map<number, AxisScalarOverlays>`。
 · ⚠ **`isAxis` 不能等价成 `axes.length > 0`**：`forceNoAxis` 轴退化时对外 `resolvedAxes` 被清空
   为 `[]`（`convergence.ts:1422`），而 `effectiveStunAxes` 回落到 `configStore.stunAxes`
   （用户手动轴，**可能非空**）⇒ 存在第三态「`axes` 非空但 `isAxis === false`」。故递的是
   **伤害池 `:101` 那个表达式本身**（`(configStore.useStunAxis || autoActive) && stunAxisResult`）。
 · ⚠ **派发器的 `if (axes.length === 0) return out` 已删**：留任一个早退（派发器那行、或模块内的
   `if (axes.length === 0) return null`）都会让非轴折算臂**物理不可达**（钩子根本不被调用）——
   那正是 R14/R15 分诊反复点名的「契约缺口」。现由各模块按 `isAxis` 自己分臂。
 · ⚠ **标量表必须按槽位键控**：四个既有桶只靠「moveId 全局唯一」避免串味（`corinStunBonusMap`
   里只有 1061 的键，别人查不到自己），而标量对**全角色全部行同值**、没有 moveId 可索引 ⇒
   合并成裸标量会把本角色的增伤**泄漏给队友行**（`damagePoolAdditionalAbilityGate.test.ts`
   的反锁就是拦这个）。

**⚠ 实测纠正 R15 分诊一处前提（这就是本批最有价值的产出）**：分诊 §2.2 建议 `:466` 用
`cfg.panel.windInfectionRate`，并自标「静态可达，**未实测**」。round 16 探针实测：
`cfg.panel.windInfectionRate === undefined` **且** `computePanel().windInfectionRate === undefined`
—— 该字段**不是** `computePanelPhases` 的产物（那里只写 `infectionZoneBonus`，见 `helpers.ts:885` 附近），
只由编排层 `damagePanels` computed 盖章（`useResourceCalc.ts:508`）⇒ **走 cfg 是断路**，
浸染增伤会静默恒 0（无测试会红）。故契约递的是**盖章后**的值。

**⚠ `:484` 仪玄凝神未迁（−0，刻意留分支）**：它本是**三臂**（C6 / 非C6轴 / 非C6非轴），
迁移前实测发现一处**默认值分裂**——注册 default `yixuan.ningshenCoverage = 0`
（`yixuan.ts` settings 表）vs 伤害池原式 fallback **0.5**（`:502`）。`resolveMechanicSettings`
恒以**注册 default 铺满**（`helpers.ts:239-247`）⇒ 模块侧读 `settings` 会拿到 **0**，
而现网行为是 **0.5** ⇒ 迁移会把非轴凝神暴伤从 `round(40×0.5)=20` 静默改成 **0**。
这是**产品级口径**（哪份默认值对）⇒ 按任务卡「需要改产品级口径就停下来找人」保留分支，
挂到 round 17 裁决。**没有实测就不要按分诊的「三臂可迁」直接搬**——分诊只做了静态分析。

· **判据面**：`teamHookMigration.test.ts` 的轴窗口覆盖段 **10 → 13 例**（补三条非轴折算臂 +
  希格莉德浸染 + 门控边界，全**精确值**）；既有 `banyue.test.ts`(54) / `corin.test.ts`(20) /
  `sigrid.test.ts`(27) / `damagePoolAdditionalAbilityGate.test.ts`(4) **未改一行即全绿**
  —— 这是「迁移逐位等价」最强的证据（它们走真管线读 note 精确串）。
· **反向验证 6 组（全精确红，逐组还原 + `md5sum -c` 自证）**：见下批报告。
· **剩余分布（R15-b 后）**：`damagePool.ts` **9 → 6** · `convergence.ts` 10 · `helpers.ts` 4。
  下一批候选：R15-c（行级 `stunOverride` 自报 ⇒ `:558`/`:561`，−2；⚠ 那两处 `isAxis` 口径**不对称**，
  必须逐位保留）· R15-d（`enemy.stunVuln` 快照 ⇒ `:155`，−1）· 1141 收尾（C7 计数投影 ⇒ −1）·
  `:484` 仪玄（**先裁决默认值分裂**，再迁，−1）。

── 2026-09-16 round 17 **R15-c（−2，编排 20 → 18）**：行级 `stunOverride` 自报契约 ─────────────
迁走 `damagePool.ts` 兜底臂里的两条 `charResult.agentId` 判据（`:567`/`:570`），
落到新的声明式钩子 `AgentMechanicModule.stunOverrideForMove`（入参 `AgentStunOverrideInput`：
`slot` / `moveId` / `isAxis`；返回 `AgentStunOverride { stunOverride, note }` 或 `null` = 不认领）。

 · **为什么单列一条契约**：那两处否决的是**同一件事**（本行吃多少失衡易伤），
   而这正是角色自己的战斗口径；写死在伤害池里每加一个角色都要再改编排层（规则 6 要消灭的形状）。
 · ⚠ **两处的 `isAxis` 口径刻意不对称，逐位保留**（R14 分诊 §4.1）：叶瞬光 `:567` **没有**
   `!isAxis` 项、雨果 `:570` **有**。因为轴内分段链是 `else if (isAxis && axisSlots.has(slot))`，
   而 `axisSlots.has(slot)` 在「轴模式下本槽没进轴」时为假 ⇒ **兜底臂在轴模式下也会被问到**
   ⇒ 叶瞬光的关键招在轴模式下仍吃满、雨果的关键招则落全局覆盖率。**统一两者 = 静默改行为**。
 · ⚠ **`stunOverride: 0` ≠ 「不认领」**：前者 = 明确「不吃易伤」（雨果非白名单招），
   后者 = 回落全局覆盖率。把 0 折成 null 会让雨果的非白名单行静默吃上覆盖率
   （`damagePoolBatchR17c.test.ts` 以「强特起手精确 1 vs 队友行覆盖率 1.2916…」成对钉住）。
 · ⚠ `:567` 的 `isAxis` 项虽恒为 false，但**整支不是死的**——同一条 `else if` 的分支前提
   （`axisSlots.has(slot)` 为假）可达（R14 分诊 §4.1）⇒ 不许按「恒 false ⇒ 死代码」删。
 · 未使用 import 已清：`YESHUGUANG_FULL_STUN_MOVES` / `HUGO_FULL_STUN_MOVES`
   （`veilStunMultiplier` 仍被帷幕封顶路径使用，保留）。

· **判据面**：新增 `damagePoolBatchR17c.test.ts` **14 例全精确值**（跳③钩子级 6 例 +
  跳①真管线 6 例 + **跳②口径不对称管线级 2 例**），两条新手法：
  ① **成对对照**（同一 moveId 在白名单内/外必须给出**不同**的 `stunMult`：1.5 vs 1.15 / 1.2333…，
  使「短路后恰好落回同一个数」的数值巧合无法伪装）；
  ② **跨槽泄漏反锁**（队友行不得出现本角色 note）。
  既有 `yeshuguang.test.ts`(25) / `hugo.test.ts`(18) / `hugoVerdictLanding`(1) /
  `hugoStunVulnMatrixProbe`(1) / `nonAxisStunVulnProbe`(1) / `damagePoolAdditionalAbilityGate`(4)
  **未改一行即全绿** ⇒ 迁移逐位等价的强证据。
· **逐位等价实验（本批最强证据）**：把 HEAD 的四份源码换回工作区跑 60 态指纹对拍
  （10 队 × {非轴, 0命轴, 轴但槽0未进轴} × {C0, C6}；指纹 = `id|slot|agentId|moveId|stunMult|count|totalDamage|note`
  的 sha256）⇒ **60/60 完全一致**，随后 `md5sum` 自证还原。
· **剩余分布（R15-c 后）**：`damagePool.ts` **6 → 4**（`:162` 帷幕封顶 / `:412` 琉音强特 /
  `:494` 仪玄凝神 / `:508` 佩洛伊斯阳炎）· `convergence.ts` 10 · `helpers.ts` 4。
· **R15-d（2026-09-17 round 18，−1）**：`damagePool.ts:162` 叶瞬光「帷幕易伤封顶」的
  `row.agentId === '1431'` 判据删除。**依据 = T6 判据**：该分支的两项判据字段
  `yeshuguangStunCapMult`（身份）+ 新增 `yeshuguangVeilStunBase`（基数）的**唯一写入方
  都是 `yeshuguang.ts#applyPanel`**——本批把面板阶段硬编码块（`helpers.ts` 的
  `if (agent.id === '1431')`）一并迁进模块，让「唯一写入方 = 该角色模块」**真正成立**，
  而不是停在编排层的 `agent.id` 判据上。**三项门控逐位保留**：① 身份判据（
  `yeshuguangStunCapMult` 非 0；非本角色 `emptyPanel()` 恒 0）；② `stunForThis > 0`
  （「轴外段不吃帷幕封顶」的**必要**门控，R14 分诊 §4.2 实测，**不是冗余**——依赖行级
  `stunOverride`，面板阶段拿不到 ⇒ 刻意留在伤害池）；③ `stunDmgMultiplierBonusCapAlways`
  全仓零写入（R14 §4.3）⇒ 算式里原样保留但**不搬**。
  契约 = `AgentPanelInput.enemyStunVuln`（`configStore.enemy.stunVuln` 的**面板阶段**
  只读快照）。⚠ **刻意不走** R14 分诊建议的 `AgentTeamConfigInput.enemy`：`applyTeamMechanics`
  是 **cfg 写入**钩子（build/converge/postRound），而本处消费点在 `computePanelPhases`
  （面板阶段）与 `pushDirect`（行构建）之间 —— cfg 快照够不着；面板阶段的 `applyPanel`
  是唯一同时看得见「本槽 panel 的 bonus 三项」与「boss 基础易伤」的落点。
  **没有**给 `AgentTeamConfigInput` 加任何字段。
  实测：`check-guards` **17/17**（17/17，core 6/6）；新判据 `damagePoolBatchR18d.test.ts`
  **15 例**（跳③算式 3 + 跳③盖章 4 + 跳①真管线 4 + 跳②门控 4）；**成对对照**手法 = 把
  boss 易伤推到 2.5/3.5 让封顶真咬合（⚠ 默认 1.5 下帷幕基数**恰等于**回落值 ⇒ 短路后
  落回同一个数，不断言不出来）；**逐位等价实验** = HEAD 六份源码换回工作区跑
  10 队 × 3 轴态 × 2 命座 = 60 态，全行**原文**（不只指纹）diff 为空 + `md5sum -c` 自证还原。
  剩余分布：`damagePool.ts` **4 → 3**（`:412` 琉音强特 / `:494` 仪玄凝神 / `:508` 佩洛伊斯阳炎）·
  `convergence.ts` 10 · `helpers.ts` 4。
  下一批候选：`:508` 佩洛伊斯（需把 `peiluoKagerouPairRatio` 一起递进契约，−1）·
  1141 收尾（C7 计数投影 `countStun` ⇒ −1）· `helpers.ts`/`convergence.ts`（**先派只读分诊**）·
  `:494` 仪玄（**先裁决默认值分裂**，产品级口径）。

**=== 2026-09-17 round 19 换尺批（口径纠正 15 → 42，规则 17②）===**

⚠ **这不是退步，是尺子变准**（规则 17②：棘轮防「代码变差」，不防「度量漏计」）。先例：
2026-09-12 frozen 8→78（注释原文「78 才是编排层真实的 agentId 特判存量」）。

旧尺 `/agentId\s*(===|!==)/` 的漏计面（T48 报告 `/home/kaua/.dsh/session-manager/reports/T48-a2.md` 实测）：
 · `agent?.id === '1581'` / `agent.id !== '1311'` —— 同义的角色判定，正则完全不命中；
 · `agent.teammateBuffId === 'remielle'` —— 同上（`teammateBuffId` 在旧 check-guards 里零出现）。
⇒ 新写的这两种形态**永远不会被拦**，「只减不增」对它们是空的。

换尺后实测（AST 单源 = `lib/agent-identity-lines.mjs`，check-guards 与报告脚本共用同一 visitor）：
 · 编排层 = **42 行 / 62 比较表达式**；逐行人工核对**无假阳性**（42 行全是角色判定）。
 · 形态分布：`agentId` 15 · `id` 34 · `teammateBuffId` 20（**有重叠**：同行双形态 20 行 ⇒ 形态数不可相加）。
 · 观察项（**不进度量、也不删除**）：非角色 `.id` 比较 17 条 —— 动态 7（`r.id === rowId` 族）
   + 非四位字符串 10；局部别名（`fillerAgentId === '1051'`）2 条。
 · 组件对账：新尺 42 = 旧尺 15（全部被新尺覆盖，`legacyLinesNotBusiness` 恒 0）+ 新增 27；
   ⚠ C-α 批（同 round，先行提交）已把两条反馈迁走，故**换尺当刻的旧尺读数是 15 而非 17**。
 · core 面**不受影响**（core 6 行全是裸 `agentId`，两个尺子同值 6）⇒ `CORE_AGENT_BRANCH_BASELINE` 不动。

换尺与改代码**分属两批**（规则 17②唯一纪律「换尺与改代码不得混批」）：本批只换尺、零运行时改动；
C-α（17→15）已在上一提交 `8a4b47b` 落地并单独验收。


**=== 2026-09-17 round 20 R20-h1 同槽面板批（39 → 32，−7）===**
`helpers.ts` 7 个「同槽自面板块」迁进各模块 `applyPanel`（A6 1531 / A7 1041 / A8 1321 /
A9 1391 / A10 1551 / A11 1481 / A12 1571）。零新契约（`AgentPanelInput` 已足）。
⚠ 实测 −7 而非分诊预估的 −6：A11/A12 各含 `id`+`teammateBuffId` 双形态，按行去重后各算 2 行。
逐位等价：31 队 × 3 槽 × (inCombat+outOfCombat) = **162 行全字段指纹，两侧 md5 一致**。

**=== 2026-09-17 round 20 R20-h3 跨槽批（32 → 28，−4）===**
`helpers.ts#computePanelPhases` 里两组**跨槽**硬编码块迁进来源角色模块的新钩子
`teamPanelEffects`（契约 `AgentTeamPanelEffectInput`，声明式：来源角色自报「我在队时给谁加什么」）：
· 莱特 1161 影画4 后场队友能量效率 +10%×占比（**本人不吃**）
· 耀嘉音 1311 咏叹华彩全队增伤/暴伤（**含自己**）+ 影画4 职业分支（**排除自己**）
⚠ 这批是 **P2 陷阱**（round 15 规划曾建议「搬进来源角色 `applyPanel`」= 错）：`applyPanel` 逐槽位
派发、只传该槽自己的 `panel` ⇒ 搬错会让**来源自己**吃到本该给队友的加成，且既有断言
（`lighter.test.ts:170` 队友 +5 / 本人 0）会精确红。故新契约值得单独立项而不是复用 `applyPanel`。
⚠ 实测 −4 而非分诊预估的 −5（分诊把 A4/A5 记为 −3，实际双形态按行去重后为 −2）。
逐位等价：200+ 队形 × 2 滑块三端点 × 3 槽 × 局内/局外 = **4932 行全字段指纹，两侧 md5 一致**。

**=== 2026-09-17 夜间批（28 → 24，−4）===**
抽出共用 helper `findSlotByIdentity`（`helpers.ts`）收敛「按角色身份找槽位」的重复形状：
`damagePool.ts` 5 处内联 `findIndex` → 一行 helper 调用（该文件 8 → 3）。
⚠ **净 −4 而非 −5**：helper 自身那行判定（`ids.some(id => a.id === id || a.teammateBuffId === id)`）
也计入棘轮（`helpers.ts` 7 → 8）——这是**抽象层留一行换 18 处站点**的投资，不是退步。

⚠ **本批顺带查实的数据面事实（判死动作，本批未做）**：catalog 里 `teammateBuffId` 只有 5 个取值
（1171/1261/1411/1511/1581）且**全部等于自身 id** ⇒ 各处 `a.teammateBuffId === 'X'` 的右臂
恒等于左臂；而反复出现的别名 **`'remielle'` 不是任何角色的 teammateBuffId**
（它只是 catalog 里 `remielleRefringeCoefficient` 之类 stat/effect 名的前缀）⇒ 那些
`a.teammateBuffId === 'remielle'` 是**当前数据面下的死分支**。**未删**（判死需引擎实测背书 + 独立批次）；
由 `findSlotByIdentity.test.ts` 把该事实钉住：remielle 若真成为别名，那里立刻红。

**=== 2026-09-18 R21 夜批（24 → 9 → 7）===**
派活方预批 + 三批并行工人（T61/T62/T63）+ 派活方收尾：
· `findSlotByIdentity` 抽出后，`damagePool.ts` 5 处内联 findIndex → 1 行调用（该文件清零）；
· 夜 A 把该文件最后 3 处（琉音强特跳过 / 仪玄凝神三臂 / 佩洛伊斯阳炎两臂）迁进各模块
  `axisWindowOverlays`（T7 裁决归一默认值后仪玄 0 delta；佩洛伊斯无需新契约——行级配对比例
  的唯一写入方本来就是本模块 `patchExecutions`）；
· 夜 B `convergence.ts` 8→2、夜 C `helpers.ts` 8→2；
· 收尾 `liuyinPromote.ts` / `normaHatChain.ts` 各 1 处 → 复用 helper（本轮 9→7）。
⚠ **剩 7 行中已查明 2 行不是 DRY 机会**（`convergence.ts` 雨果/般岳 cfg-merge）：
字段契约与消费端都就位，但迁移所需输入通道缺失——`autoTopUp` 依赖 `guarantee.fury` /
`guarantee.ultimate` / `banyue.autoTopUpInteractions` 与 `appliedBoss`，其中 **`guarantee.*`
未注册 MechanicSetting**（实测）⇒ 不在 `AgentTeamConfigInput.settings` 里、模块侧读不到。
补该契约 = 改 `types.ts` + 冻结面 ⇒ 独立批次（已派 T65）。
· 收尾再迁 `useResourceCalc.ts` 3 处（蕾米倍率 / 蕾米虚耀 / 简 C6）⇒ 本轮 **9 → 7 → 4**。
⚠ **剩 4 行的逐行定性**：`convergence.ts` 2 = 雨果/般岳 cfg-merge（待 T65 补 `guarantee` 契约）；
`helpers.ts` 2 = ① `findSlotByIdentity` **自身的实现行**（抽象层单一判定点——18 处形状收敛成这一行，
是投资不是残留）② 简 C6 块（受 `jane.passionCoverage` **未注册**阻塞：注册它会让内部实验开关变成
资源利用率页的用户可见滑块 = 产品级口径，需用户裁决 ⇒ 夜 C 如实保留未擅自动）。
⚠ **2026-09-18 round 22 / T67-a1 刀 A**：那 2 行**随代码分居两文件**（`helpers.ts` 1 =
`findSlotByIdentity` 自身实现行；`panelPhases.ts` 1 = 简 C6 块）——B 簇整段迁出后**总数仍 2/2，
棘轮零变化**（纯搬迁，不新增也不消解判定；逐位指纹 diff 为空佐证语义未动）。

**=== 同夜：判据 17 扫描器盲区修复（与棘轮无关，但同属「护栏对真实写法失明」类）===**
`compacted-slot-index.mjs` 原正则只认 `panels[slot]`，漏掉真实形态 `panels.value[slot]`
（实测盲区 8 处）⇒ 补齐 `(?:\.value)?` 后抓出 `useResourceCalc.ts` **4 处真缺陷**
（用 team 下标索引压缩面板数组；实测 `[空,1581,1031]` 时读到槽位 2 那个角色的面板）。
4 处改 `panelAt`，判据 17 违规 4 → **0**。反向验证：盲区版对注入违规报 0 处、修复版报 1 处。
沿革（换尺前，旧尺口径）：17（2026-09-17 round 18 **R15-d −1**）→ 15（C-α −2）

**=== 2026-09-17 round 20 C-β 批（新尺 42 → 40，−2）===**

迁走 `convergence.ts` 的两条「下一轮反馈」（均在旧尺下也各计 1 行 `agentId` 判据）：
 · C6 仪玄 1371 符法千重行计数（`ch.agentId === '1371'`，旧 `:994`）⇒
   产出 `yixuanFuFaForJufufu` 的 `yixuan.ts#yixuanNextRoundFeedback`。
 · C9 莱特 1161 能量守卫（`characters.some(c => c.agentId === '1161')`，旧 `:1257`）⇒
   产出 `lighterTeamEnergy` 的 `lighter.ts#lighterNextRoundFeedback`
   （顺带消掉 `estimateTeamNormalEnergyConsumed` 在编排层的第二次调用，规则 11）。
⚠ **`teamUltimateForJufufu` 刻意留在编排层**（本批的归属判断）：它是「全队 `ultimateCount`
之和 + 符法千重分量」，与 1371/1391 在不在队都无关，而 `collectNextRoundFeedback` 只对
**在队**模块派发 ⇒ 挂进任一角色模块都会让缺那一方的队伍静默归零（实测「有 1391 无 1371」
的队 `teamUltimateForJufufu` = 8，挂进 1371 模块后变 0）。分量现由
`teamUltimateBaseNext + (feedbackNext.yixuanFuFaForJufufu ?? 0)` 合成，逐位等价。

实测：`check-guards` **18/18**（角色判定 **40/40**，core 6/6）。判据
`src/mechanics/__tests__/nextRoundFeedbackR20.test.ts` **11 例**（层①精确值 4 · 层②来源
隔离 2 · 层③真派发器/前导空槽/乱序槽位 2 · 层④下游两轮消费 2 · 反锁 1）。
**逐位等价实验**：12 队 × 2 轴态 = **24/24 线程指纹逐字一致**（HEAD worktree vs 工作区）。
`timeGolden` `grep -c "dmg:"` == **0**。

**=== 2026-09-17 round 20 C-γ 批（新尺 40 → 39，−1）===**

迁走 `convergence.ts` 的 `merged.agentId === '1141'` 分支——该分支的**最后一个**字段
`lycaonC2Energy`（影画2 能量回馈）⇒ `lycaon.ts#applyTeamConfig`，分支整段删除。
沿革（逐字段迁出的批次）：`lycaonStunCount`/`lycaonTotalTime`/`lycaonInvincibleTime`
（T26 批次 0c）→ `lycaonWindowDuration`（round 12 批次 2，走 `axis`）→
`lycaonBackstageDodgeCount`（round 14 批次 4，走 `interactions`）→ `lycaonC2Energy`（本批）。

补的两个只读契约（**纯加法**：不读它的模块 0 delta）：
 · `AgentTeamConfigInput.countStun` = **计数投影版**失衡次数
   （`projectStunPlanForCounts(stunCount, stunPlanProjection)`）。⚠ 与 `stunCount` 在
   **难度阶梯 G4（round）打开时不等价**（默认 off 下恒等 ⇒ `timeGolden` 与 `lycaonSmoke`
   都分辨不出来——这正是必须补契约、而不是用 `stunCount` 硬迁的理由）。
 · `AgentInteractionSnapshot.chainCountPerStun`（**store 原值**）——`characters` 上那份被
   `buildCharConfig` 写过 `?? (isSupport ? 0 : 1)` 兜底 ⇒ 与 store 侧分裂。
   ⚠ **实测纠正 R18 分诊一处前提**：它写「store=0 → cfg=1」是**错的**（`0 ?? 1 === 0`）；
   分裂只在 store 侧字段**缺失（`undefined`）**时发生，判据直接构造缺失态钉住。

实测：`check-guards` **18/18**（角色判定 **39/39**，core 6/6）。判据
`src/mechanics/__tests__/lycaonC2Contract.test.ts` **18 例**（层①精确值 6 · 层②两臂分叉 4
· 层③真派发器 4 · 层④契约门控 3 + 真管线 1）。`timeGolden` `grep -c "dmg:"` == **0**；
`axisContext.test.ts` 48 例与 `lycaonSmoke.test.ts` **13 例未改一行即全绿**（逐位等价的最强证据）。

**=== 2026-09-17 round 20 R20-h1 批（新尺 39 → 32，−7）===**

`helpers.ts` 分诊报告 `R20-A-helpers-triage.md` §4 **批次 1**「同槽零契约批」：把该文件
`computePanelPhases` 里的 **7 个「同槽自面板块」**的角色判定迁进各角色模块自己的 `applyPanel`
（全部 `agent.id === '<自己>'` 且只写当前 `panel` ⇒ **不触 P2 跨槽陷阱**，该陷阱已在 §2.1 受控实验
实证只命中 A2/A3/A4/A5 那 4 行、属批次 3）：

| 块 | 原行 | 判定 | 落点 |
|---|---|---|---|
| A6 | `:769` | `agent.id === '1531'` | `starlightBilly.ts#applyStarlightBillyPanel` → `specBase.applyPanel` |
| A7 | `:786` | `agent.id === '1041'` | `soldier11.ts#applySoldier11Panel`（与既有绝焰块合并） |
| A8 | `:796` | `agent.id === '1321'` | `evelyn.ts#applyEvelynPanel`（**乘法、位置敏感**） |
| A9 | `:803` | `agent.id === '1391'` | `specPanelBuffs.ts#jufufuTigerRoarMechanic.applyPanel`（**新增钩子**） |
| A10 | `:814` | `agent.id === '1551'` | `specPanelBuffs.ts#peiluoProminenceMechanic.applyPanel`（**新增钩子**） |
| A11 | `:829` | `id === '1481' \|\| teammateBuffId === '1481'` | `liuyin.ts#applyLiuyinPanel` |
| A12 | `:837` | `id === '1571' \|\| teammateBuffId === '1571'` | `norma.ts#applyNormaPanel` |

⚠ **−7 而非任务书预估的 −6**：新尺**按行去重**（判据 17⑥ 的计量单位 = 行），而 A11/A12 是
「双形态同行」（两臂写在同一行）⇒ **各只降 1 行**，7 块 = **7 行**（25 表达式中 9 条、18 行中
7 行）。任务书把 A11/A12 各算 −2（按**表达式**计），与其引用的分诊报告 §1「18 行 / 25 表达式
**按行去重**」自相矛盾。**实测为准**（规则 10：基线是测量工具；规则 17⑥：口径纠正先分类再定
计量单位）：`countIdentityBranchLines` 实测 18 → 11（helpers.ts），全仓 39 → **32**。
已把算式写进报告 §3，供派活方对账。

**零新契约**（本批刻意不触 `types.ts`）：A6/A7/A8/A11/A12 落点钩子已存在（A6/A7 需与既有
`applyPanel` 合并）；A9/A10 需**新增 `applyPanel`**，但接口 `AgentMechanicModule.applyPanel`
早已在 `types.ts:443` 声明 ⇒ 纯新增、不动契约。

**逐位保留的三处硬约束**（违反即静默改语义）：
 · **A8 乘法位置敏感**：`panel.atk = Math.round(panel.atk * (1 + 0.15))` 进模块后**早于**其后
   所有 `panel.atk +=`。已核实两者之间**没有任何 `panel.atk` 写入**（区间内写的是
   `energyGainEfficiency`/`dmgBonus`/`critDmg`/`anomalyBuildUpEfficiency`/`stunBuildUpBonus`/
   `enemyPhysicalResReduction`；其余 atk 写入块全带 `agent.id === '<自己>'` 门控 ⇒ 对本槽不触发）
   ⇒ 上取整基数逐位相同。算式原样保留 `1 + 0.15`（不折叠成 `1.15`，虽实测同一 double）。
 · **A11 顺序约束**：`:829` 读 `panel.liuyinGoodReviewAtkBonus`，该值由同文件 `:220` 写入
   ⇒ 合并后严格保持「先写 bonus、后折算」（否则读恒 0 ⇒ 面板静默少 500×覆盖率）。
 · **A11/A12 右臂是死分支**（`'1481'`/`'1571'` 不在 catalog 的 5 个 `teammateBuffId`
   —— 1261/1581/1411/1171/1511 —— 里，§3.2 静态穷举已证）⇒ **逐位保留不删**，连整条析取
   （`agent.id === 'x' || agent.teammateBuffId === 'x'`）一并搬进模块：删右臂是**语义变更**
   不是清理（将来数据面填上该 `teammateBuffId`，该臂会复活），且**无测试会红**。

**逐位等价实验**：31 队 × 3 槽 × (inCombat + outOfCombat) = **162 行全字段指纹 diff 为空**
（迁移前 HEAD 抓 `/tmp/r20h1-before.txt`，迁移后 `diff` 0 行）——比单点断言更强的证据。
判据 `src/mechanics/__tests__/panelBlocksR20h1.test.ts` **16 例**（层①精确值 + 层②滑块端点
0/0.5/1 + 层③真派发器接线 + 层④命座/额外能力门控边界 + 交叉隔离反锁）；各模块**既有**精确断言
（`jufufu.test.ts:102/111`、`peiluo.test.ts:33/149/263`、`soldier11.test.ts:167/216`）
**未改一行即全绿**。反向验证 **5 组**逐组精确红 + `md5sum -c` 自证还原（见报告 §5）。
`timeGolden` `grep -c "dmg:"` == **0**。

⚠ **本批唯一改动的既有测试**：`soldier11.test.ts:126` 的 `applyPanel` **直调** fixture 补
`settings: {}`（该钩子迁入后读 `AgentPanelInput.settings`；派发点 `computePanelPhases` 恒传，
直调测试须补齐——同款 fixture 见 `piper.test.ts:51`/`hugo.test.ts:334`）。**断言值一字未改**。

── 2026-09-17 round 21 夜 A（`damagePool.ts` 最后 3 处角色判定，24 → **9**，**−3** 归本批）──

⚠ **读数说明**：本批落地时 `git status` 显示另有并行会话正在改 `convergence.ts` / `helpers.ts`
（持租约 session-c0a1 / session-6f61）。故 24 → 9 的 **−15 里有 −12 不属于本批**：剥离本批四个文件
后实测为 **12**（`git stash push` 四文件 → `check-guards` → `stash pop` 自证还原），
**本批真实 delta = 9 − 12 = −3**，与三个站点一一对应。归因按**工作树实测**而非提交态
（`report-agent-identity.mjs --worktree`，该脚本默认取 HEAD 提交态、会漏掉并行 WIP）。

三处逐处（每处都做了「迁移前后全行指纹对拍」= 0 delta，不是只靠既有测试不红）：
 · **`:428` 琉音强特跳过通用行** —— `charResult.agentId === '1481'` 项**删除**，留
   `liuyinSrc && !isAxis && LIUYIN_EX_MOVE_IDS.has(…)`（`liuyinSrc` 上提到槽位循环头，
   与下方专用块**共用同一个判据**）。为何不是「顺手去冗余」：本行语义是**跳过通用路径、
   把结算权交给下方专用块** ⇒ 删 agentId 必须同时证明专用块会重放该行，否则「两边都不算」
   （静默少伤）。三条论证（行归属 moveId 全局唯一 / 重放条件与本行门控共用项一致 /
   赠链赠大不会搬这三行到别槽）写在 `damagePool.ts` 该行注释里。
 · **`:510` 仪玄凝神三臂** —— `agentId === '1371'` + `additionalAbilityActive` 门控 + 三臂
   整段迁进 `yixuan.ts#axisWindowOverlays`：C6 臂与非 C6 非轴臂产**标量** `yixuanNingshen`
   （走 `scalarBySlot`——两者都「对本槽全部行同值」，复用桶会泄漏给队友行），非 C6 轴臂仍走桶。
   ✅ 阻塞本处的「默认值分裂」已由用户裁决 `a6adca7` 归一为 0.5 ⇒ 迁移 0 delta
   （实测：`yixuan.ningshenCoverage` 0/0.5/1 三档指纹互不相同，且 default == 0.5 那档）。
 · **`:524` 佩洛伊斯阳炎两臂** —— `agentId === '1551'` 两臂迁进
   `specPanelBuffs.ts#peiluoProminenceMechanic.axisWindowOverlays`：轴臂走桶不变，
   非轴臂 → 标量 `peiluoKagerouPct = 40 × 覆盖率滑块`。⚠ **行级配对比例留在行上**
   （`peiluoKagerouPairRatio` 的唯一写入方 = 本模块 `patchExecutions`，逐 moveId 不同
   ⇒ 进不了「全行同值」的标量），消费端 `标量 × 行级比例` = 原式，逐位等价。
   ⚠ 本处**刻意无** `additionalAbilityActive` 门控——阳炎出自**核心被动**（上分支终结技），
   不是额外能力；别照抄般岳/可琳那两支（那是额外能力机制）。
 · **零新契约**：`scalarBySlot` / `AxisScalarOverlays` 是 round 16 既有通道，本批只**新增两个
   字段**（`yixuanNingshen` 早已声明但零写入、本批首次接线；`peiluoKagerouPct` 新增）。
 · 判据 `damagePoolNightA.test.ts`（三处逐处精确值 + 反锁）；`timeGolden` `grep -c "dmg:"` == 0；
   逐位等价指纹 = 10 队 × 2 轴态 × 9 滑块档 = **200 态全行 sha256，迁移前后 TOTAL_SHA 完全相同**
   （`0d9386e0e52e7e10f52cfb0506a6fe0ddf5eb138e9b9f087bf49b434893fe3cf`）。

⚠ **本批改动的既有测试 = `teamHookMigration.test.ts` 两条断言（2 处，加强不是放宽）**：
「仪玄凝神」「佩洛伊斯阳炎」两个用例原本断言 `axisWindowOverlays({isAxis:false})` **`toBeNull()`**，
用例标题里明写「**非轴臂仍在伤害池**」——那条注释正是本批要消灭的状态（旧注释同时是 TODO 与判据）。
改法照 round 16 先例（**同文件同 describe**，commit `b83e82c` 给般岳/可琳做过同一件事：
`toBeNull()` → 「桶留空 + 标量表给精确折算值」）：换成精确折算值 + 滑块两端 + 命座分叉 +
额外能力门控 + 两臂互斥 ⇒ **断言数与信息量都增加**（原 2 条 → 现 2 条各 6~8 个精确断言）。
「分支被直接删掉」这种形态**仍有判据**（删掉后标量为 `undefined` ⇒ 红），不是把护栏拆了。
⚠ 真管线判据（含「行级配对比例**真被消费端乘上**」——该点**只能**在真管线测，
单测 `patchExecutions` 再断言字段值**证明不了**消费端乘了它）在 `damagePoolNightA.test.ts`。
