/**
 * check-guards 登记数据表（CC-85 2026-09-27，census §5.91 自 scripts/check-guards.mjs 逐字拆出）。
 * - RATCHET_BURNDOWN：棘轮 burn-down 登记表（改棘轮基线常量时 frozen 必须同步改）
 * - DEBT_REGISTRY：技术债登记簿（源码 debt 标记 ⇔ 本表条目，双向校验）
 * - CALIBER_TRIGGER_ALLOWLIST：游戏语义口径缺 ⟳复核 触发器的存量豁免
 * 判据逻辑仍在 scripts/check-guards.mjs，它 import 本文件并原样转出（测试 / zc.mjs 照旧从 check-guards 取）。
 * 本文件在 DEBT_SCAN_SELF_REFERENTIAL 里（债务登记文本本身不算源码 debt 标记）。
 */

/**
 * 棘轮 burn-down 登记表。每条：
 * - file/detect：基线所在与「怎么量当前值」
 * - frozen：冻结时的值（= 代码里的 BASELINE 常量）
 * - target：承诺下调到的值（可为 0 = 全清）
 * - due：承诺到期日（ISO）
 * - plan：一句「怎么降」（让接手者知道从哪下手，而不是只看到一个数字）
 */
export const RATCHET_BURNDOWN = [
  {
    id: 'agentId 分支',
    file: 'src/composables/useResourceCalc.ts + src/composables/resourceCalc/**',  // 度量面 = listAgentBranchFiles()（2026-09-12 口径纠正：单文件会被「搬家」骗过）
    frozen: 1,  // 2026-09-27 CC-63 3→**1**（真清偿：fillerAgentId 1051/1041 → 模块钩子 expandBasicFill；与 AGENT_BRANCH_BASELINE 同步）。
    // 旧注：2026-09-24 CC-12 **换尺** 1→**3**（口径纠正，不是退步；与 AGENT_BRANCH_BASELINE 常量同步改）。
    // 新形态 = 「局部 const 由 `.agentId`/`.id`/`teammateBuffId` 初始化，随后与四位数字字面量比较」
    // ⇒ 实测新增 2 行：`convergence.ts:302`（`fillerAgentId === '1051'`）/ `:311`（`'1041'`）。
    // 依据 AGENTS 规则 17②（度量口径纠正不适用「棘轮只减不增」）+ 17⑥（先分类再定计量单位）。
    // 旧读数 1 = `anomalyPanels.ts` 的动态比较（未变）；core 无此形态 ⇒ core 保持 5。
    // 以下为更早沿革：R51 **简狂热块迁出编排层** 2→**1**（本批 **−1**，按**工作树实测**归因；
    // 与 `AGENT_BRANCH_BASELINE` 常量同步改，两处一致）。站点 = `panelPhases.ts` 的
    // `agent.id === '1261' || agent.teammateBuffId === '1261'` 两臂（**同一行** ⇒ 棘轮按行去重只 −1，
    // 与 R20-h1 A11/A12 同款的「行 vs 表达式」陷阱）：**用户裁决**「jane.passionCoverage 一并注册成
    // MechanicSetting」⇒ 该块唯一输入进 `AgentPanelInput.settings` ⇒ 整块迁进 `jane.ts#applyJanePanel`
    // （走模块自己的 `settings` 读，不再需要编排层按 agentId 分支）。**同一批同时接线 `jane.frenzyActive`**
    // （用户裁决「接线」：原来两处调用点硬编码 `frenzyActive: true` ⇒ 滑块零读值点）。
    // 判据 `mechanicSettingsEffect.test.ts` + `helpersNightC.test.ts`（该文件原有「未注册」断言按
    // 它自己预告的方向翻转 = 沿革兑现，不是放宽）。⚠ 剩余 1 行 = `anomalyPanels.ts:97` 的
    // **动态比较** `a.teammateBuffId === id`（分类器判「无法自动分类」⇒ 需符号解析，非本轮面）。
    // 沿革（R21 夜 D）：**convergence.ts 最后 2 行清零** 4→**2**（**−2**，按**工作树实测**归因；
    // 与 `AGENT_BRANCH_BASELINE` 常量同步改，两处一致）。两条站点 = 该文件 `characters.map` 里
    // 最后两处 cfg-merge 分支，夜 B 已查明是「缺输入通道」而非 DRY 机会 ⇒ 本轮**先补契约再迁**：
    // `:826` 雨果 1291 ⇒ `hugo.ts#applyHugoTeamConfig`、`:849` 般岳 1471 ⇒ `banyue.ts#applyBanyueTeamConfig`。
    // 两条新契约（`guarantee` / `boss`，均只读 + 只在 converge 有值 + 不兜底）+ 一条既有能力补齐
    // （`getAgentSkills`，与 `AgentAxisOverlayInput`/`AgentNextRoundFeedbackInput` 同名入参同款）。
    // **`guarantee.*` 刻意不注册 MechanicSetting**（夜 B 实测它不在 `getRegisteredMechanicSettings()` 里
    // ⇒ 模块侧读不到；而补注册会把被难度阶梯/归档部署程序化改写的内部实验旋钮变成资源利用率页
    // 用户可见滑块 = 产品级口径，用户未裁决）⇒ 只递算好的布尔结果，**没有**新增/修改任何注册表条目。
    // 逐位等价 = 227 态全字段指纹（6 队形 × 5 保底组合 × 2 轴态 + 3 Boss 态 + 18 强队预设 × 2 命座
    // + 62 角色 × 2 命座 + 雨果/般岳 solo 轴态）迁移前后**逐文件 md5 全等、diff 键 0/227**
    // （corpus md5 `778111ae94e820469bfe10c48d0b0d30` 两侧相同）；敏感性自证：雨果值 +0.5 ⇒ 10 键红、
    // 般岳 `autoTopUp` 短路 ⇒ 26 键红。判据 `convergenceNightD.test.ts`；反向验证 5 组精确红。
    // 另：`@fact engine:轴内块数落地` 的**锚点随实现**从 `convergence.ts` 迁到
    // `hugo.ts#applyHugoTeamConfig`；`CALIBER_TRIGGER_ALLOWLIST` 的**键随之改指**
    // （判据 15 的豁免面按「文件 + 主体」键控，不改指即红）。
    // ⚠ **这是路径跟随、不是销号**——该口径的 `⟳复核` 触发器**仍未补**、口径内容一字未改
    // ⇒ 存量面 `game` 条数不变（80）。⚠ 派活方核正：本行原写「并补 `⟳复核` 到期日」，
    // 与 `CALIBER_TRIGGER_ALLOWLIST` 处的注释（「触发器仍未补」）**互相矛盾**；实际以后者为准
    // （`grep -c "⟳复核" src/mechanics/agents/hugo.ts` = **0**）。补它会打穿 `checkGuards.test.ts`
    // 的 `>= 80` 硬地板（还债反被判红）⇒ 需连同该绝对地板一起裁决，不在该批授权面内。
    // 以下为更早沿革：R21 夜 A **damagePool.ts 最后 3 处** 12→**9**（本批 **−3**，按**工作树实测**归因：
    // 落地时另有并行会话在改 convergence.ts/helpers.ts（租约 session-c0a1/session-6f61），
    // 剥离本批四文件后实测为 **12** ⇒ 24→9 的 −15 里只有 −3 属本批，一一对应三个站点：
    // `:428` 琉音强特跳过通用行（删 agentId 项、`liuyinSrc` 上提到槽位循环头与专用块共用判据；
    // 论证写在 damagePool.ts 该行注释：行归属 moveId 全局唯一 + 重放条件共用项一致 + 赠链赠大不搬这三行）、
    // `:510` 仪玄凝神三臂（迁 `yixuan.ts#axisWindowOverlays`，C6/非C6非轴两臂 → 标量 `yixuanNingshen`，
    // 非C6轴臂 → 既有桶；T7 裁决 `a6adca7` 归一 0.5 后 0 delta）、
    // `:524` 佩洛伊斯阳炎两臂（迁 `specPanelBuffs.ts#peiluoProminenceMechanic.axisWindowOverlays`，
    // 非轴臂 → 标量 `peiluoKagerouPct = 40×覆盖率`，**行级配对比例留在行上**由消费端乘回；
    // ⚠ 本处刻意**无**额外能力门控——阳炎出自核心被动，别照抄般岳/可琳）。
    // 零新契约（只往既有 `AxisScalarOverlays` 加两个字段）；判据 `damagePoolNightA.test.ts`；
    // 逐位等价 = 10 队 × 2 轴态 × 9 滑块档 = 200 态全行 sha256，迁移前后 TOTAL_SHA 完全相同。
    // 以下为更早沿革：R20-h1 同槽面板批 39→**32**（新尺，2026-09-17 round 20 **实测**：`helpers.ts#computePanelPhases` 的 7 个「同槽自面板块」（A6 1531/A7 1041/A8 1321/A9 1391/A10 1551/A11 1481/A12 1571）迁进各角色模块自己的 `applyPanel`——零新契约（A9/A10 是给 `specPanelBuffs` 的两个工厂模块**新增**钩子，接口 `types.ts:443` 早已声明）、零产品级口径；逐位等价证据 = 31 队 × 3 槽 × in/out = **162 行全字段指纹 diff 为空**，判据 `panelBlocksR20h1.test.ts` 16 例 + 既有精确断言未改一行即全绿 + 反向验证 5 组精确红。⚠ **−7 不是任务书预估的 −6**：新尺**按行去重**，A11/A12 的 `id`/`teammateBuffId` 两臂**写在同一行** ⇒ 各只降 1 行（7 块 = 7 行 / 9 表达式）；任务书按表达式把 A11/A12 各算 −2，与其引用的分诊报告 §1「18 行 / 25 表达式按行去重」矛盾 ⇒ 按实测改，沿革见下方「R20-h1 批」）；C-γ 1141 收尾迁移 40→**39**（新尺，2026-09-17 round 20 C-γ **实测**：`convergence.ts` 的 `agentId === '1141'` 分支整段删除——最后一个字段 `lycaonC2Energy` 迁进 `lycaon.ts#applyTeamConfig`；补两个**纯加法**只读契约 `AgentTeamConfigInput.countStun`（C7 计数投影版失衡次数）+ `AgentInteractionSnapshot.chainCountPerStun`（store 原值；`characters` 上那份被 `?? (isSupport ? 0 : 1)` 兜底 ⇒ 与 store 分裂——⚠ **实测纠正 R18 分诊**：「store=0 → cfg=1」是错的（`0 ?? 1 === 0`），分裂只在 store 侧字段缺失时发生）。判据 `lycaonC2Contract.test.ts` **18 例**（层②两臂分叉为核心：`stunCount=3.6`/`round` ⇒ `countStun=4`，四投影给出可分辨值）；`axisContext.test.ts` 48 例 + `lycaonSmoke.test.ts` **13 例未改一行即全绿**）；C-β 反馈迁移 42→40；⚠ 2026-09-17 round 19 **换尺（口径纠正，不是退步）**：15 → 42 —— 见下方沿革「换尺批」；C-α 反馈迁移 17→15（旧尺不变）；79（2026-09-12 口径纠正后按**提交态**实测）→ 65（2026-09-13 T2：helpers.ts 额外能力门控簇 14 处收敛为数据驱动表 ADDITIONAL_GATE_BUFFS + evalAdditionalAbilityBuffGates，SOP §6.2 语义逐位保留，生效回归见 additionalGate.test.ts）→ **56**（2026-09-15 arch 棘轮第 2 批：convergence.ts 的 cfg-merge 簇 9 处 `merged.agentId === '…'` 跨轮反馈注入改由各模块 `applyTeamConfig` 读 `AgentTeamConfigInput.threads` 快照写自己那份 cfg；timeGolden 16 键 0 delta）→ **55**（2026-09-15 同批第 3 小簇：轴内终结技喧响消耗 `agentId === '1551' ? 2000 : 3000` → 读本槽 `cfg.ultimateCost`）→ **53**（2026-09-15 同批第 4 小簇：`nomra 1571` 的 normaStunCount/Coverage/BattleTime 与 `qingyi 1251` 的 qingyiStunCount 注入迁进各自模块的 applyTeamConfig——消费方只有本模块，且 hook 入参已含 stunCount/combatTime；timeGolden 0 delta，反向验证删注入 ⇒ 精确红）→ **47**（2026-09-15 `damagePool.ts` 五处「模块 source 字段 ⇒ 角色标识」去冗余）→ **34**（2026-09-16 最大单簇 −13：`convergence.ts` 5 个 `compute*NextRoundFeedback` 纯函数（1541/1381/1151/1331/1191）迁进各模块新的 `nextRoundFeedback` 钩子，契约递整份本轮结果 + 上一轮线程快照，返回 `Partial<CalcRoundThreads>`；timeGolden 0 delta（含 dmg 信息项），逐站点反向验证见 AGENT_BRANCH_BASELINE 注释）→ **32**（2026-09-16 round 11 批次 1 −2：1201 悠真 + 1241 朱鸢的轴内块计数迁进各自模块的 `applyTeamConfig`，新增 `AgentTeamConfigInput.axis` 轴上下文契约（设计卡 §3 方案 A，零新通道——`characters` 本就带 axisInSeconds/axisActionCounts/axisUltimateTotal，本契约只是把散落字段收成显式快照）；timeGolden `grep -c dmg:` == 0，反向验证 6 组见 AGENT_BRANCH_BASELINE 注释）→ **29**（2026-09-16 round 12 批次 2 −3：1531 星徽·比利（**combo 展开**）+ 1591 希格莉德（非 C6 封顶 = Σwindows）+ 1511 南宫羽（单 moveId `1511013` 走 `axis`；同分支的 `inStunWindowTriggers` 走 `threads`）三个分支迁进各自模块的 `applyTeamConfig`；1141 莱卡恩本轮只迁 `lycaonWindowDuration`（分支仍在 ⇒ **−0**，`lycaonC2Energy` 实测仍缺 C7 计数投影契约、`lycaonBackstageDodgeCount` 仍缺未缩放交互次数）。timeGolden `grep -c dmg:` == 0，反向验证 6 组逐处精确红——沿革详见 AGENT_BRANCH_BASELINE 注释）→ **27**（2026-09-16 round 13 批次 3 −2：1051 伊德海莉的 `yidhariStunCount` + 轴内连段反推 `yidhariInStunExCount`/`yidhariInStunEnergyCost` 迁进 `yidhari.ts#applyYidhariTeamConfig`（**条件写形态**逐位保留：只在 `axis.active && 合计>0` 时写，消费端按 `!== undefined` 选通路），**外加删掉 round 12 判死但超授权面的 1511 死写块 −1**；⚠ **1371 仪玄未迁**——设计卡 §6 证伪闸门触发（剥分支后 `yixuanSmoke` 9 failed），受控两臂实验定位到**唯一**缺口 = `yixuanExtremeAssistCap` 需「未缩放队友弹刀和」（`characters` 上那份已被 interactionScale缩放/parrySplit 改写，6 个 1371 预设实测 3~5 队分化）；把该量按 store 口径递入后 `yixuanSmoke` 13 passed全绿 ⇒ 其余 7 字段迁移逐位等价、缺口即 T5 登记的「未缩放交互次数」（与 1141 同族）⇒ 保留分支、如实挂账。`timeGolden` 对 1051 结构性盲（7 预设全 0 命 ⇒ chapter-0 轴用裸 id、无 combo 键 ⇒ 反推恒 0），判据由 `axisContext.test.ts` 24→29 例承担，反向验证 4 组精确红）→ **25**（2026-09-16 round 14 批次 4 **−2**：**补「未缩放交互次数」契约**（`AgentTeamConfigInput.interactions` = `AgentInteractionContext`，store 口径逐槽快照；`characters` 上那份已被 `interactionScale` 缩放/被 `parrySplit` 改写）⇒ **1371 仪玄整条分支迁进 `yixuan.ts#applyYixuanTeamConfig`**（8 字段分五通道：轴内量走 `axis`、`yixuanC1LightningCount` 的两臂走**算出来的** `axisInSeconds > 0`（非 `axis.active`）、线程量走 `threads`、橘福福 `+=` 项按身份 `characters.some`、缺口量 `yixuanExtremeAssistCap` 与 `yixuanFlashBonus` 走 `interactions`）。⚠ **−2 不是 −1**：该分支含两行计数（`'1371'` + 其中的 `'1391'` 橘福福判据），后者改成模块内常量比较。**同一契约顺收 1141 的 `lycaonBackstageDodgeCount`**（过滤口径刻意不同：带 `agentId` 判据 ⇒ 排除空槽），但 `lycaonC2Energy` 仍缺 C7 ⇒ 1141 分支保留 ⇒ **−0**。core 保持 **6**（本批未触 `src/core/**`）。`timeGolden` `grep -c dmg:` 实测 **== 0**；`yixuanSmoke` **13 passed**（证伪闸门）；`axisContext.test.ts` **29 → 48 例**；反向验证 **6 组**逐处精确红（含「数据源换成 `characters`」⇒ `yixuanSmoke` 精确 1 例红 `expected 8 to be 9`），逐组还原 + md5 自证——沿革详见 AGENT_BRANCH_BASELINE 注释）→ **23**（2026-09-16 round 15 **R15-a −2**：`damagePool.ts` 分诊切批第一批，零新契约——**:408 柏妮思影画4/6** 迁进 `burnice.ts#patchBurniceExecutions`（读模块自己 cfg 的 `burniceCinemaLevel`，写既有行级通道 `exec.critRateBonus`/`exec.resIgnore`）、**:970 般岳影画6 摧岳附伤** 改读倾山行上的模块标记 `banyueC6CrushAttach`（唯一写入方 = `banyue.ts#patchBanyueExecutions`，仅 C6 写 —— 判据同 T6）。新增判据 `damagePoolBatchR15a.test.ts` **13 例全精确值**（跳③四条行级分支 + 跳①三档命座 + 正控/反锁成对）；`timeGolden` `grep -c "dmg:"` 实测 **== 0**；反向验证 **5 组**精确红（C4 臂短路⇒5 例 / C6 只留 1171012⇒2 例 / 标记不写⇒3 例 / 标记值硬编码 999⇒2 例 / 消费块短路⇒1 例），逐组还原 + md5 自证——沿革详见 AGENT_BRANCH_BASELINE 注释）→ **20**（2026-09-16 round 16 **R15-b −3**：`axisWindowOverlays` 契约扩三个入参（`isAxis` 真轴模式布尔 / `additionalAbilityActive` / `windInfectionRate`）+ `settings`，并把**派发器的 `axes.length === 0` 早退删掉**（那行让「非轴折算臂」物理不可达）——`:441` 般岳明王（非轴臂 → 标量 `banyueMingwangPct`，桶仍只装**层数**）· `:455` 可琳扫除帮手（非轴臂 → 标量 `corinStunBonusPct`；桶值恒 `CORIN_ADDITIONAL_DMG` 的不变量不许被污染）· `:466` 希格莉德浸染（**与轴模式无关**，整支迁入 `sigrid.ts`，走新契约的 `windInfectionRate`）三处 `charResult.agentId` 判据迁进各自模块。⚠ **实测纠正 R15 分诊一处前提**：它建议 `:466` 从 `cfg.panel.windInfectionRate` 取 rate，探针实测该字段在 `patchExecutions` 时点恒 `undefined`（`computePanelPhases` 只写 `infectionZoneBonus`）⇒ 走 cfg 是断路（浸染增伤静默恒 0），改由编排层从 `damagePanels` 盖章值递入。⚠ **`:484` 仪玄凝神未迁**（**−0**）：实测发现注册 default `yixuan.ningshenCoverage = 0` 与伤害池原式 fallback **0.5** 分裂，迁移会把 0.5 静默改成 0（−20% 暴伤）⇒ 属产品级口径，保留分支待裁决。`timeGolden` `grep -c "dmg:"` 实测 **== 0**；反向验证 **6 组**精确红（含「标量表按错槽位取」⇒ 精确 1 例红）。见 AGENT_BRANCH_BASELINE 注释）→ **18**（2026-09-16 round 17 **R15-c −2**：新增**行级失衡易伤自报契约** `AgentMechanicModule.stunOverrideForMove`（入参 `AgentStunOverrideInput` = `slot`/`moveId`/`isAxis`；返回 `AgentStunOverride { stunOverride, note }` 或 `null` = 不认领）⇒ 迁走 `damagePool.ts` **兜底臂**的两条 `charResult.agentId` 判据：`:567` 叶瞬光「关键招明心境满易伤」→ `yeshuguang.ts#stunOverrideForMove`（⚠ **刻意无 `!isAxis` 项**——轴内分段链的 `axisSlots.has(slot)` 为假时兜底臂在轴模式下也被问到）、`:570` 雨果「非轴只有连携/决算吃满、其余明确 0」→ `hugo.ts#stunOverrideForMove`（⚠ **有 `!isAxis` 项**；且 `stunOverride: 0` 是**认领**、不许折成 `null` ⇒ 否则非白名单行回落覆盖率静默变大）。**两处口径不对称是设计、逐位保留**（R14 分诊 §4.1）。新增判据 `damagePoolBatchR17c.test.ts` **14 例全精确值**（含「同一 moveId 白名单内/外给不同 `stunMult`」成对对照与跨槽泄漏反锁）；**逐位等价实验**：HEAD 源码换回工作区跑 60 态全行指纹（sha256）对拍 ⇒ **60/60 一致**，`md5sum` 自证还原；既有 `yeshuguang.test.ts`(25)/`hugo.test.ts`(18)/`hugoVerdictLanding`/`hugoStunVulnMatrixProbe`/`nonAxisStunVulnProbe`/`damagePoolAdditionalAbilityGate`(4) **未改一行即全绿**。core 保持 **6**（本批未触 `src/core/**`）。见 AGENT_BRANCH_BASELINE 注释 → **17**（2026-09-17 round 18 **R15-d −1**：`damagePool.ts:162` 叶瞬光「帷幕易伤封顶」的 `row.agentId === '1431'` 判据删除——**依据 T6 判据**（该分支的 `yeshuguangStunCapMult` 身份字段 + 新增 `yeshuguangVeilStunBase` 基数，**唯一写入方 = `yeshuguang.ts#applyPanel`**；本批把面板阶段硬编码块 `helpers.ts` 的 `if (agent.id === '1431')` 一并迁进模块，让「唯一写入方 = 该角色模块」**真成立**，而不是停在编排层的 `agent.id` 判据上）。**三项门控逐位保留**：① 身份（非本角色 `emptyPanel()` 恒 0）② `stunForThis > 0`（「轴外段不吃帷幕封顶」的**必要**门控，R14 §4.2 实测；依赖行级 `stunOverride` ⇒ 刻意留在伤害池）③ `stunDmgMultiplierBonusCapAlways` 全仓零写入（R14 §4.3）⇒ 算式里原样保留但不搬。契约 = `AgentPanelInput.enemyStunVuln`（`configStore.enemy.stunVuln` 的**面板阶段**只读快照）；⚠ **刻意不走** R14 建议的 `AgentTeamConfigInput.enemy`——`applyTeamMechanics` 是 cfg **写入**钩子（build/converge/postRound），而消费点在 `computePanelPhases` 与 `pushDirect` 之间，cfg 快照够不着；**没有**给 `AgentTeamConfigInput` 加任何字段。`timeGolden` `grep -c "dmg:"` == 0；新判据 `damagePoolBatchR18d.test.ts` **15 例**（跳③算式 3 + 跳③盖章 4 + 跳①真管线 4 + 跳②门控 4；**成对对照** = 把 boss 易伤推到 2.5/3.5 让封顶真咬合——⚠ 默认 1.5 下帷幕基数**恰等于**回落值，短路后落回同一个数）；**逐位等价 60/60 全行原文 diff 为空**（10 队 × 3 轴态 × 2 命座）+ `md5sum -c` 自证还原；反向验证逐组精确红。见 AGENT_BRANCH_BASELINE 注释
    target: 0,
    due: '2026-12-31',
    plan: '逐角色把编排层特判迁进模块：applyTeamConfig 三阶段钩子，或声明式钩子（axisWindowOverlays / backstageAutoFill / producesInteractionTopUp 等有先例）。跨轮反馈走 `AgentTeamConfigInput.threads`（2026-09-15 新增的通用通道，别再逐字段铺开契约）；「读本轮结果算下一轮」类走 `nextRoundFeedback`（2026-09-16 新增，递整份本轮结果 + `prevThreads`，返回 `Partial<CalcRoundThreads>`）；**轴内计数/窗口量走 `axis` 契约**（2026-09-16 round 11 落地：“active / axes / windows / windowSeconds / actionCountsBySlot / ultimateTotalBySlot / chainTotalBySlot”，只读快照、只在 converge 相位有值 ⇒ 模块侧 `phase !== \'converge\' || !axis` 双判据门控）。hot spot（**2026-09-17 round 21 夜 D 后按新尺实测**，总数 **7**）：useResourceCalc.ts(3) > helpers.ts(2) > liuyinPromote.ts(1) = normaHatChain.ts(1)。⚠ **`convergence.ts` 已于夜 D 清零**（该文件从 8 → 2 → **0**）。⚠ 三批归因（工作树实测，剥离并行会话后各自量）：夜 A = damagePool.ts 8→2「−6 里 −3 属本批」（见 `frozen` 行）；**夜 B = convergence.ts 8→2（−6，本批）**；夜 C = helpers.ts 8→2（−6）。上一读数（round 20 R20-h1 后，总数 32）：convergence.ts(8) = damagePool.ts(8) > helpers.ts(11) > useResourceCalc.ts(3) > liuyinPromote.ts(1) = normaHatChain.ts(1)。⚠ 换尺前（round 19 当刻，总数 42）的读数是 helpers.ts(18) > convergence.ts(11) > damagePool.ts(8)；更早的「convergence.ts(10) > damagePool(3) > helpers(4)」是**旧尺（只数 `agentId ===`）**的读数，三者不可直接比（新尺多算 `.id`/`teammateBuffId` 两形态，且 R20-h1 让 helpers 从 18 降到 11）。**下一批候选（按价值）**：⭐ **helpers.ts 已按 `R20-A-helpers-triage.md` 的 §4 切 4 批：✅ 批次 1（R20-h1，7 块同槽面板，−7）已完成；下一批 = 批次 2（A1 `:610` 耀嘉音源面板判死，单独立项勿混批）**；再往后 = 批次 3（A2/A3/A4/A5 跨槽 P2 批，⚠ **必须先补队伍级面板契约**——分诊 §2.1 受控实验实证直接搬进 per-role `applyPanel` 会静默失效）；批次 4（A13/A15/C1/D1 化石与跨槽混合批，需裁决先行；A14 简 35 行块受 `jane.passionCoverage` 未注册阻塞）。✅ **夜 B 查实 → 夜 D 已结清**：convergence.ts 那剩 2 行是「跨轮 cfg 注入」类、不是 DRY 机会——`:817` 雨果 / `:840` 般岳，两者的**字段契约与消费端都已就位**（hugo.ts 读 `hugoAxisExVerdictCount` 选通路、banyue.ts 读 `banyueInteractionTopUp`），但迁移需要的**输入通道缺失**：`autoTopUp` 依赖 `guarantee.fury`/`guarantee.ultimate`/`banyue.autoTopUpInteractions` 与 `configStore.appliedBoss`，其中 `guarantee.*` **未注册** MechanicSetting（`getRegisteredMechanicSettings()` 不含它，实测）⇒ 不在 `AgentTeamConfigInput.settings` 里，模块侧读不到。**夜 D 按「补只读快照契约」解决（不是注册 setting）**：新增 `AgentTeamConfigInput.guarantee` + `.boss`（均只在 converge 有值、不兜底）+ 补 `getAgentSkills`（既有同名入参先例）⇒ 两行迁进各自模块，**该文件清零**，棘轮 4→2。⭐ 另一条线以 T42 只读分诊的 §D 为准（报告 `/home/kaua/.dsh/session-manager/reports/R18-triage-helpers-convergence.md`）：✅ **C-α（`convergence.ts` 的 C8 叶瞬光逐云 + C10 格莉丝轮换）已于 round 19 完成**（旧尺 −2，提交 `8a4b47b`）；次推 C-β（橘福福符法千重 + 莱特能量）；第三 C-γ 1141 收尾（⚠ 分诊实测：**只补 `countStun` 不够**，非轴臂还要队友 `chainCountPerStun` 的 store 原值，`MechanicTeamMember` 没有该字段且**不能**用 `characters` 上那份代替——默认值分裂）。以下为更早的沿革（保留供追溯）：批次 3 已做一半——1051 伊德海莉**已迁**（2026-09-16 round 13）；**1371 仪玄仍留**（设计卡 §6 证伪闸门**已触发**：唯一缺口 = `yixuanExtremeAssistCap` 需「未缩放队友弹刀和」= T5 的「未缩放交互次数」契约缺口，与 1141 的 `lycaonBackstageDodgeCount` 同族 ⇒ 先补契约再迁，两处一起解锁）。⚠ **任务卡曾预期 1051 迁完解锁 core 棘轮 2 处（`helpers.ts:1271` + `resource.ts:595`）——该前提实测已证伪**：那两处守卫早在 `0bb2611`（16→12）与 `97cc65c`（8→6）就已按 T6 判据删除，均**早于** round 11；core 当前 6 行的逐行清单见 `CORE_AGENT_BRANCH_BASELINE` 头注释。故本轮 core 保持 6 不变。✅ 1511 的 `if (prevInStunWindowTriggers <= 0) { … if (c.agentId === \'1511\') … }` 死写块**已于 round 13 删除**（−1，静态判死依据见 `AGENT_BRANCH_BASELINE` 沿革），同时删掉因此未使用的解构 `prevInStunWindowTriggers`。⚠ 已知**契约缺口**（迁移前先补，别硬迁）：C7「计数投影失衡次数」`countStun`（阻碍 1141 的 `lycaonC2Energy`）、「未缩放交互次数」（阻碍 1141 的 `lycaonBackstageDodgeCount`，`characters` 上已被 interactionScale 缩放）。架构评审 #10 → #2',
  },
  {
    id: 'core agentId 分支',
    file: 'src/core/resource.ts + core/resource/helpers.ts',
    frozen: 0,  // 2026-09-25 CC-6c 3→**0**（−3，按工作树实测归因；与 CORE_AGENT_BRANCH_BASELINE 常量同步）：删 `resource.ts` 最后三处 agentId 特判（比利终局重推过滤 `:477` + 终局旗标复位 1531/1051）——整块迁成模块能力 `finalizePass`（starlightBilly / yeshuguang 声明 `stage='preTail'`、yidhari 声明 `stage='tail'`）+ 引擎通用执行器 `core/resource/finalizePasses.ts`；同批 core 角色 import 保持 0。逐位等价 = dump/rowsnap A/B 排除 __ms 零差异（624 场景）+ billy/yeshuguang/yidhari/truncationRefold/warmStart/seedInvariance/convergenceProbe 全绿；反向验证两次（yidhari stage 改 'preTail' ⇒ 带 1051 场景精确红；注释 yeshuguang 能力 ⇒ 带 1431 场景精确红）。以下为更早沿革：2026-09-25 CC-6b 5→**3**（−2，按工作树实测归因；与 CORE_AGENT_BRANCH_BASELINE 常量同步）：删 `helpers.ts` / `resource.ts` 收敛后两处 `findIndex(c => c.agentId === '1451')`（`luciaSlot`）——整块迁成模块能力 `curtainTriggers`（luciaElowen.ts）+ 跨槽供给 `curtain-open`（yidhari.ts）+ 引擎执行器 `core/resource/curtain.ts`；同批 core 角色 import 4→2。逐位等价 = dump A/B 排除 __ms 零差异（624 场景）+ rowsnap 零差 + lucia/yidhari 测试全绿；反向验证 = yidhari 的 `curtain-open` supply 返回 0 ⇒ dump 带 1051+1451 场景精确红。以下为更早沿革：2026-09-24 CC-6a 6→**5**（−1，按工作树实测归因；与 CORE_AGENT_BRANCH_BASELINE 常量同步）：`helpers.ts` 般岳（1471）强特次数分支迁进模块能力 `exSpecialCount`（banyue.ts#banyueMechanic），引擎经 getAgentMechanic 查询；同批 core 角色 import 5→4。逐位等价 = dump A/B 排除 __ms 零差异（624 场景）+ banyue.test 全绿；反向验证 = 注释掉能力声明 ⇒ dump 含 1471 场景精确红。以下为更早沿革：2026-09-11 评审冻结 36（resource.ts 16 + helpers.ts 20）→ 26（2026-09-13 T6 首次真清偿 −10）→ 18（2026-09-13 crossAgentSupply 收口 −8）→ **12**（2026-09-15 批次2 −4：helpers.ts 里 4 处 yidhari 守卫化简——1 处 `!==` 短路左操作数（yidhariRefund）+ 2 处 `if (cfg.agentId !== '1051')`（yidhariBurn×2）+ 1 处 `agentId === '1051' && 字段!==undefined`；判据 = 相关字段唯一写入方 = yidhari.ts 模块且无默认值 ⇒ 字段判据完全覆盖角色判据，timeGolden 0 delta，反向验证破坏该字段消费 ⇒ preset:yidhari-qingyi-lucia 精确红）。详见 CORE_AGENT_BRANCH_BASELINE 头注释的沿革
    target: 0,
    due: '2027-03-31',
    plan: '剩 18 处：① 先把 convergence.ts:957 的 yidhariInStunExCount / :1074 的 billyAxisActive 写入方挪进对应角色模块，再删 helpers.ts:1271 与 resource.ts:595 的守卫（现不冗余）；② `!==` 短路形态逐处论证后化简；③ 跨角色查找（findIndex 找队友槽位）与纯 agentId 写入（billyFinalizeChain / yidhariFinalizeEx 由引擎写角色字段）属真特判，需走 applyTeamConfig / convergence 落点（评审 #10）；④ 同批新增判据 12（core role-import 棘轮 7 处）——它是本条的**语义补强面**：agentId 字面量清零 ≠ 角色无关，引擎静态 import 角色模块同样要清',
  },
  {
    id: 'core 角色模块引用',
    file: 'src/core/** → @/mechanics/agents/*',
    frozen: 0,  // 2026-09-25 CC-6d 2→**0**（−2，与 CORE_ROLE_IMPORT_BASELINE 常量同步）：删 `anomalyPool.ts` 与 `anomalyPool/helpers.ts` 的 `@/mechanics/agents/velina` 值导入（`resolveVelinaCorrosion`）——该块由模块能力 `anomalyCorrosion`（velina.ts 声明）+ 引擎执行器 `core/anomalyPool/corrosion.ts#resolveAnomalyCorrosion`（按 `input.agentMechanics` 取首个非 undefined）认领；异常池契约是纯数据、无 agentId 派发上下文，故调用方把注册表递进 `calcTurbulenceDamage`。同批 core agentId 基线 **3 不变**（本卡不碰 agentId 字面量）。⚠ 已知语义差（lead 已核）：调用方不传 `agentMechanics` 且面板带 `velinaEnabled` 时旧式仍结算、新式不结算；仓库内唯一不传的调用方 `onStunBuildup.test.ts` 面板无标记 ⇒ 两边皆 undefined。2026-09-25 CC-6b 4→**2**（−2，与 CORE_ROLE_IMPORT_BASELINE 常量同步）：删 `helpers.ts` 与 `resource.ts` 的 `@/mechanics/agents/luciaElowen` 值导入（该块由模块能力 curtainTriggers + 跨槽供给 curtain-open 认领）。2026-09-13 架构诊断实测（不含测试）：赠链族契约落地后剩余 5 处 —— luciaElowen×3 / banyue×1 / norma×1 / liuyin×1 / velina×2
    target: 0,
    due: '2027-03-31',
    plan: '⚠ 迁移前提已实测证伪（2026-09-13 T8）：5 处全是活引用、0 死引用；三处（velina / banyue / luciaElowen）都需**引擎契约改动**（给 AgentMechanicModule 加「引擎期求值」能力 + 把注册表穿进 calcTurbulenceDamage 等签名），不是机械迁移——详见 CORE_ROLE_IMPORT_BASELINE 头注释的逐条实测依据。勿按「可直接删死引用」的原计划重走',
  },
  {
    id: '展示层越层 import',
    file: 'src/views + src/components',
    frozen: 1,  // 2026-09-27 CC-53 2→1（ImpactChart 影响变量表 + 读写 → 编排层 src/composables/impactVariables.ts，含柏妮思占比变量与 % 换算口径）。CC-52 3→2（ImpactChart runOptimizerForSlot0 的 computeOptimalSubStats + getTemplate → 编排层 src/composables/substatOptimizer.ts#computeSubstatAllocationForSlot）。CC-51 5→3（TeamConfigPage 局外面板 calcPanel + applyTargetedStat → 编排层 src/composables/outOfCombatPanel.ts#computeOutOfCombatPanel，与局内 computePanel 对称）。CC-50 6→5（StunAxisPage 的 allocateAxisWindows → 编排层 src/composables/stunAxisView.ts#axisWindowCounts；纯转发，页面侧改 computed 缓存）。CC-49 8→6（TeamConfigPage + ImpactChart 的 buildTeammateBuffSourceContext 依赖组装 → 编排层 src/composables/teammateBuffContext.ts）。CC-48 10→8（StunAxisPage 的 banyue/yixuan 值导入 → 模块能力 axisEditorBlockMarks / 声明 axisMoveMeta，经 agentMechanicView 门面）。CC-47 14→10（展示层 getAgentMechanic×4 → 编排层门面 src/composables/agentMechanicView.ts）。2026-09-11 评审冻结 23 → 15（2026-09-13 T7 首次真清偿 −8：纯常量/纯函数下沉 src/data，原位置改 re-export + 展示层改 import 路径，vue-tsc 0 错、@fact 锚 93/93 不变）→ **14**（2026-09-20 round 44：结果页失衡易伤可见化搬进 composables/stunVulnDisplay.ts，calcStunMultiplier 越层 import 随实现上移；同 sharpCritMultiplier 先例）。下沉清单与「剩 14 处为何不能下沉」见 EXHIBITION_LAYER_IMPORT_BASELINE 头注释
    target: 1,  // 2026-09-27 CC-54 0→1：剩下 1 处 = MechanicsTablePage 的 agentSpecs（只读 JSON 注册表），拍板永久保留，理由见 plan 与 census §5.61；frozen=target ⇒ burndown 判 done。探测器口径不变（agentSpecs 仍会被计数，新增越层 import 照样判红）
    due: '2026-12-31',
    plan: '**已收尾**（CC-47~CC-53 共 14→1）。剩 1 处 = MechanicsTablePage.vue 的 `agentSpecs`（@/specs/registry）：import.meta.glob 读出的只读 JSON 数据表，页面只做下拉选项与关键词过滤，无任何计算；包一层纯转发只会把数字压成 0 而耦合不降（= 2026-09-12 口径纠正所反对的「搬家骗尺」），且 mechanics/stores/logicEditor/resourceCalc 同样直接读它 ⇒ 永久保留（target=1）。若日后判据 7 改为按模块豁免 @/specs/registry（数据层），属换尺，须单独成批并把 frozen/target/基线一起改成 0',
  },
  {
    id: '手册 §4 行数',
    file: 'docs/ENGINE_PIPELINE_GUIDE.md',
    frozen: 718,  // 任务卡立项基线 1340（§4 常见坑表行数）。口径纠正归因 2026-09-12：原以密度 0.287→0.15 计还款，批量拆薄实测**反效果**（散文删得比证据数字快，密度反升）——密度留作防变差天花板（判据 11），还款改量行数 = 任务卡主口径「§4 −40%」。2026-09-13 一轮达标并结算 1340→804（−40%）；**二轮（T4）804 → 719（−85，累计 −46%）**：拆坑 22（22→6）/ 25（32→7）/ 34（24→7）/ 36（31→6），手法 = 合并折行 + 删过程叙事句，实测数字/文件:行锚点/否决记录/判据行一律保留；**三轮（静默缺口体检）719 → 718 并结算**：新增坑 38⑤（四类静默缺口 + 判据 13/14/15 索引，2 行）+ 症状索引追加，代价从坑 38 的 ②③ 折行压缩里出（删的是重复叙述与冗词，实测数字/命令/否决记录全留）
    target: 718,
    due: '2026-10-31',
    plan: '✅ 已两轮到点（2026-09-13）：1340→804（−40%）→719（−46%）。坑19（341→133）/ 18 / 30+31（85→23）/ 33（164→85）/ 35（168→71）/ 22·25·34·36 四栏化后再压折行。余量见 T4 报告「信息密度下限」段——坑 19/31/33/35 否决记录已逐条一事一行，再压只能动证据（不许）；后续若再拆按同法「合并折行 + 删叙事句」并**再次结算 frozen**，无叙事项不硬压',
  },
  {
    id: '游戏语义口径复核触发器',
    file: 'src/**、scripts/**、docs/**（手写 @fact 声明行，种类=口径/映射，排除工程元口径；docs 自 2026-09-15 起入语料）',
    frozen: 82,  // 2026-09-13 实测（判据 15 上线时）：83 条游戏语义口径里仅 1 条有触发器（本轮新挂的 effectiveTime「无敌≠秽盾」），其余 82 条此前**全部是「永不过期」的**——`effectiveTime.ts` 那条「无敌（秽盾/转阶段动画）」挂了 14 天，用户 2026-09-13 才纠正
    target: 0,
    due: '2026-12-31',
    plan: '逐条补 `⟳复核: <到点判什么> | 到期 <YYYY-MM-DD>`（@fact 行尾或下一行注释；解析器只认 据/验/锚/信，追加不破坏 parseFactLine），补一条从 CALIBER_TRIGGER_ALLOWLIST 删一条（漏删即红 = 棘轮只减不增）。优先补**时效敏感**的：nanoka 原文转录的（版本更新即失效）、口径依赖「用户当时裁决」且游戏已改版的、标了 [猜测]/近似 的。到期日建议 2026-12-31（下个大版本后复核）',
  },
  {
    id: '死通道豁免清单',
    file: 'scripts/lib/dead-channel-scan.mjs DEAD_CHANNEL_ALLOWLIST',  // R46 结构熵切面：清单随实现迁走（路径跟随，不是销号）；改动仍须连 frozen 一起
    frozen: 7,  // 2026-09-20 **销号 1 条**（`difficultyLadder.maxSteps`：棘轮报「已不再命中」，字段仍在、
    // 只是 R46 结构熵切面 refactor 后扫描器不再判它为「只读不写」）⇒ 8 → **7** = 现 workload
    // （allowlist 8 条里含 1 条 namesake 误报样本 `runArchiveImport.resistances`，按 countDeadChannelWorkload
    // 口径不计入待处置量 ⇒ 8−1 = 7）。棘轮只减不增，销号即下调。
    // 2026-09-13 首轮实测 15（判据 14 上线时冻结）→ 14（2026-09-14 T15 审计 #13：
    // 扣掉 1 条 kind:'namesake' 的误报记录 runArchiveImport.resistances —— 它的候选永不消失、
    // 永远不会 stale，算进待处置量会让棘轮**永远还不完**。口径见 countDeadChannelWorkload）
    // → **8**（2026-09-15 销号 7 条**假阳性**，三个检测器缺陷，**不是调基线蒙混**）：
    //   · 段 A 3 条（coverageMap / moduleInputRows ×2）—— 读判定漏「裸标识符读 + 位置实参」
    //   · 段 B 4 条（stunAxisPresets 的 chapter / guarantee —— 写判定不扫 JSON；
    //     difficultyLadder 的 minGain / multiplierCoefficients 的 zeroEnergyRow —— 写判定漏对象**简写**）
    // 现况（2026-09-20 销号后）：A 零读零写 2（runArchiveImport 的 weaknesses/hpTotal，确无消费点）/
    // B 只读不写 5（allowlist 里 B 段 6 条，含 1 条 namesake 误报样本 runArchiveImport.resistances
    // 不计入 workload，已在 why 里如实标注）/
    // C 手写 d.mts 漂移 **0**（上线即把 16 个漏声明一次补齐 = 判据的正确用法）。
    // 三类（除误报样本外）都是存量：通道在、类型在、编译过，就是没人用
    target: 0,
    due: '2026-12-31',
    plan: '逐条「接上或删掉」二选一——接上消费点（如 phaseDelayedCooldown 的 blockSeconds 接 frontBlockSeconds、轴预设 chapter 补数据）或删死字段；处置一条从 DEAD_CHANNEL_ALLOWLIST 删一条（漏删即红 = 棘轮只减不增）。⚠ 不许「为绿而登记」：新增豁免必须写 why（怎么证明它是死的），否则判据退化成橡皮图章',
  },
  {
    id: '名词表未处理',
    file: 'scripts/lib/noun-triage.json（源 = data/raw/nanoka_missing/noun_3.2.3.json）',
    frozen: 40,  // 2026-09-14 口径纠正（T15 审计 #4）：原写 frozen: 0 且度量只数 unhandled ⇒
    // 判据 13 上线时就把 40 条判成 deferred 清零，**current 恒 0 / done=true，41 条挂账从提醒面消失**
    // ——与「游戏语义口径复核触发器」首版同型缺陷（存量一登记，棘轮就自称还清）。
    // 现度量 = unhandled（红灯）+ deferred（已挂账存量）＝ 41（27 modeled / 41 deferred / 0 unhandled，
    // 40 条 unhandled 按「挂账」处置：敌人情报 2 + 角色真缺口 3 + 活动武备 35 全段判范围外，
    // 登记落点 docs/MECHANICS_IMPLEMENTATION.md §3.05）。
    // ⚠ 这个棘轮有两件事：① unhandled 必须恒 0（源新增名词必须同步对账）；② deferred 是**存量**
    // 不是「已还清」，处置一条降一条（销号路径 = 建模后转 modeled，或改判范围外并从这里去掉）。
    target: 0,
    due: '2026-12-31',
    plan: '① 硬判据：unhandled 恒 0 + 源/账键集合相等（源新增名词必须同步对账）；② burn-down：41 条 deferred 逐条处置——能建模的转 modeled（补 src 消费锚点），确认范围外的改判并从清单移除。⚠ 不许「为绿而登记」：deferred 必须带 registeredAt（文件:行）+ since（日期）',
  },
  {
    id: '滑块生效测试存量',
    file: 'scripts/lib/settings-coverage.mjs SETTINGS_UNTESTED_BACKLOG（扫描面 = 运行时 getRegisteredMechanicSettings）',
    frozen: 0,   // ★ 2026-09-20 round 51 管理员 AD **7 → 0：清单清空**（达成 `target`）。
    // 与 `SETTINGS_UNTESTED_BACKLOG.length` 同步改，两处一致 —— 同 `AGENT_BRANCH_BASELINE` 纪律；
    // `checkGuards.test.ts` 的成对锁 `frozen === BACKLOG.length` 也同步。
    // 余 7 条经**用户 2026-09-20 一轮裁决**全部处置：甲 1391 两条**接线**（模块读 rate）、
    // 乙 1621 两条**接线**（乘耗能 / 风眼账本）、乙 1611 一条**删化石声明**（模块早已招式计算）、
    // 乙 1561 一条**合并**到模块既有滑块、丙 `jane.frenzyActive` **接线** + 附 `jane.passionCoverage`
    // **一并注册**。判据 4 读数 **173/180 → 179/179**。
    // ★ 机制**不因清零而失效**：新滑块仍走 `newGaps` 判红并逐条具名在册（清零 ≠ 判据关闭）。
    // 落地测试：`src/mechanics/__tests__/adminRulingEffect.test.ts`（9 例，全走真管线）。
    //
    // 沿革：round 50 补完 Form-B/C/D 21 条后 **28 → 7**（当时余 7 条全是「待用户裁决」，
    // 既不算已测也不豁免；请单 `/home/kaua/r50-scratch/evidence/R50-RULING-request-dead-sliders.md`）。
    //
    // `SETTINGS_UNTESTED_BACKLOG.length` 同步改，两处一致 —— 同 `AGENT_BRANCH_BASELINE` 纪律；
    // `checkGuards.test.ts` 的成对锁 `frozen === BACKLOG.length` 也同步）。
    // 2026-09-20 round 49 **换尺时实测 60**（口径纠正，不是退步；规则 17②），
    // 同批**第二批**补了 16 条 spec adjustable（Form-E）的真管线生效测试后 **60 → 44**
    // （与 `SETTINGS_UNTESTED_BACKLOG.length` 同步改，两处一致 —— 同 `AGENT_BRANCH_BASELINE` 纪律）。
    // 第三批再 +1（1551 peiluo_perfect_block_gain：fixture 补 `perfectBlockCount` 后三点线性）⇒ **60 → 43**。
    // 换尺读数：扫描面从「agents/*.ts 的 `settings: [` 块起始正则」（35 模块 / 84 id）换成
    // **运行时注册表**（55 模块 / **180 id**）后，实测 **60 条**注册了但无任何测试引用。
    // ⚠ 换尺前这 60 条**零可问责性**（旧面看不见它们，既不红也不点名）；换尺后逐条具名在册 + 本行 due
    // ⇒ 可问责性**上升**。`newGaps` 判红逻辑未动 ⇒ 新增滑块仍然红（棘轮的防变差职责完整保留）。
    // 分型：**Form-E 38 条**（`<四位数>.<resource>.<rule>.rate` = spec `adjustable`，经
    // `specs/resources.ts:150` 的 `setting:${adjustable.id}` 按构造消费）· **Form-B/C/D 22 条**
    // （模块自己 `setting()` 读的覆盖率/次数滑块）。全域 180 里另 96 条是**换尺修好的漏扫面**
    // （旧面 84 → 新面 180，其中 120 条已有测试引用）。
    target: 0,
    due: '2027-03-31',
    plan: '按型分批补「改滑块→面板/结果确实变」的生效测试，每补一条从 SETTINGS_UNTESTED_BACKLOG 删一行'
      + '**并把本行 frozen 同步下调**：'
      + '① **Form-E（38 条）：✅ 全清**（R49 第一批 16 + R50 第二批 15 = 31 条已测；余 7 条经 R49 分诊证实'
      + '是**真缺陷**、需用户裁决，见 §R49-J1 与 `jane.frenzyActive`，**不计入本棘轮的可补面**）——'
      + '`src/specs/__tests__/adjustableEffect.test.ts` 表驱动，全部走真管线 + 三点比例性。'
      + '★ R50 实测补充三条挑活规律（写进该测试文件头注释）：`chainCountTotal` 型 **必须 `stunCountLock`**'
      + '（默认队伍失衡次数收敛到 0 ⇒ 光给 `chainCountPerStun` 仍恒 0）；`max: 1` 型的第三点取 0.5 而非 2；'
      + '收敛反馈型（1591）**不严格成比例**，强断言 = 归零 + 与同一份结果解闭式恒等式。'
      + '② **Form-B/C/D（21 条）：✅ 全清**（R50 一轮补完，`src/mechanics/__tests__/mechanicSettingsEffect.test.ts`'
      + '22 个 it：18 强比例/精确闭式 + 2 弱单调 + 1 类别判据）。★ 三条挑活大坑（写进该文件头注释）：'
      + '`config.enemy.battleTime` 才是全局时长（槽位传是静默无效）· `useStunAxis=false` 不足以关轴'
      + '（通配预设 `仪其他.json` = [\'1371\',\'*\',\'*\'] ⇒ 主 C 仪玄时多数队伍自动进轴 ⇒ '
      + '`stunExCoverage` 被强制 0，须换无预设命中队伍）· 每点必须独立 `setupHarness`'
      + '（跨值复用 ⇒ 收敛态污染 ⇒ 假 no-delta）。★ 反向验证：`setMechanicSetting` 恒写 0 ⇒ 21/21 全红。'
      + '③ **余 7 条 = §R50-J1 的三类「注册了但不生效」**（甲 2 / 乙 4 / 丙 1）——**需用户裁决**'
      + '（接线 vs 删声明），**本棘轮已无可补面**；请单见 OPEN-ITEMS §R50-J1。'
      + '⚠ 必须**走真管线**（`setMechanicSetting` → `resourceResult`/`computePanelPhases`），**不许**直调钩子'
      + '+ 手写 cfg —— R48 实测：手写 cfg 会抹掉「生产代码写不写这个字段」这个自由度，让断链「通过」'
      + '（`anbyC2StunCoverage` 曾因此掩盖恒等 0.5 的真缺陷）。'
      + '⚠ 不许把本清单当豁免面用（那是放宽判据）；`jane.frenzyActive` 一条需**用户裁决**（见 OPEN-ITEMS §R48-J1）'
      + '——它是真死声明，补测试会红，应先裁决再动。',
  },
  {
    id: 'core 角色前缀字段',
    file: 'src/core/** + src/composables/resourceCalc/** + useResourceCalc.ts（口径见 scripts/lib/core-role-field-ratchet.mjs）',
    frozen: 0,  // 2026-09-27 CC-40 5→0 清零（liuyinPromote.ts → ultimatePromote.ts；moduleFeedback 键 lighterTeamEnergy→consumedTeamEnergy、yixuanFuFaForJufufu→teamUltimateExtra；叶瞬光面板字段 → veilStunCapMult / veilStunVulnBase）。此后即硬门：新增任何 角色前缀Xxx 标识符即红；2026-09-27 CC-39b 7→5（终结失衡窗口招式 → 模块能力 endsStunWindow / axisMoveActionTime，convergence 去 hugoMoveActionTime、佩洛伊斯 1551016 字面量）；2026-09-27 CC-38 22→7（爱丽丝：spark 局部量去前缀、模块能力 giftedPolarAssaultCount、异常池输出 aliceCoweringDot→coweringDot，爱丽丝清零）；2026-09-27 CC-39a 31→22（雨果决算返还 → 模块能力 stunRefundRatio，去 findSlotByIdentity(1291)；roundInputs hugoCinema → slotCinema）；2026-09-27 CC-37 34→31（简面板字段 janeAssaultCritDmgBonus → 通用名 selfAssaultCritDmgBonus）；2026-09-27 CC-36b 40→34（维琳娜 1 命乱流抗性无视 → 面板字段 turbulenceResIgnore；6 命风化加成 → 模块能力 windAnomalyBonus）；2026-09-27 CC-36a 63→40（维琳娜风蚀量去角色名：corrosionSource / cinema2CorrosionRate / 气旋计数局部量）；2026-09-27 CC-35d-B3 76→63（琉音好评转大去身份查找 → 模块能力 ultimateGiftSource）；2026-09-27 CC-35d-B2 83→76（琉音跳过通用强特直伤 → 模块能力 skipsGenericDirectRow，删 CharLocals.liuyinSrc）；2026-09-27 CC-35d-B1 92→83（琉音出口改名 liuyinPromoteCount/Hug60 → ultPromoteCount/Hug60）；2026-09-27 CC-35d-A 103→92（诺姆装配后赠送连携 → 模块能力 chainGift，normaHatChain.ts 改名 chainGift.ts）；2026-09-27 CC-35c-D 123→103（core/resource/helpers.ts 赠链局部量去角色名 normaGift*/liuyinGift* → chainGift*/ultGift*）；2026-09-27 CC-35c-C 125→123（露西亚 C4 cfg 字段改通用名 decibelPerCurtainTrigger）；2026-09-27 CC-35c-B 130→125（莱特 / 耀嘉音队友 buff 来源面板修正 → 模块能力 adjustTeammateBuffSource）。2026-09-27 CC-35c 134→130（全队异常持续时间通用规则臂 → 模块能力 teamAnomalyDurationBonus，删 rinaSlot 等）。2026-09-27 CC-35b 146→134（仪玄 5 / 普罗米娅 1 交互栏次数改由模块 buildCharConfig 从 char 读入）。2026-09-27 CC-35a 148→146（anomalyPanels 蕾米埃尔异化度展示列迁模块能力 anomalyRefringePct）。2026-09-27 CC-34c② 149→148（蕾米埃尔 Radiant Turn 失衡乘区读点迁模块能力 skillDazeMultiplier）。2026-09-27 CC-34c/d 155→149（蕾米埃尔花羽轮舞喧响读点迁 buildRemielleCharConfig + 删 3 个 re-export 壳）。2026-09-27 CC-34b 171→155（蕾米埃尔垂虹 / Radiant Turn 7 个 cfg 字段与两个招式查找函数迁 remielle.ts#buildRemielleCharConfig）。前序：2026-09-27 CC-34a 219→171（蕾米埃尔 14 个 + 叶瞬光 2 个角色专属面板属性：core/buff.ts 删等价 case、core/panel.ts 初值改由 data/agentPanelStats.ts 表铺开；substatOptimizer remielleATK→sourceATK）。前序：2026-09-27 CC-33 231→219（悠真 harumasaStunOnly → 通用行级字段 stunOnlyDmgBonus；希希芙 xixifuToxinInAxisFraction → 模块能力 directRowAxisSplit）。前序：2026-09-27 CC-32b 254→231（CrossAgentEnergy 5 个角色具名字段 → bySource 字典；莱特 cfg 字段 → 通用 crossAgentFlatEnergyBySource）。前序：2026-09-27 CC-32a 270→254（core/resource/crossAgentEnergy.ts 席德正兵回能内联块 → 模块 crossAgentSupply vanguard-energy）。前序：2026-09-27 CC-31 326→270（CalcRoundThreads 14 个模块下一轮反馈具名字段 → moduleFeedback 字典，键定义移 mechanics/types.ts 的 ModuleFeedback）。前序：2026-09-27 CC-30 332→326（remielleEntryPanels → entrySnapshotPanels 纯改名：全槽进场快照面板，无角色判定）。前序：2026-09-27 CC-29 340→332（useResourceCalc 简 6 命事件按身份分支 → jane 模块 anomalyEventRecords）。前序：2026-09-27 CC-28 357→340（useResourceCalc remielleVoidflareEvents 编排层角色分支 → 模块能力 anomalyEventRecords）。2026-09-27 CC-26b 363→357（rowBuild 蕾米埃尔光辉回转后台行迁模块能力 backstageAutoRows）。2026-09-27 CC-26 403→363（core/resource 蕾米埃尔垂虹必做动作 + 特殊虚耀事件迁模块能力 extraNecessaryAction / buildAnomalyEvents）。2026-09-27 CC-25 410→403（roundInputs aliceInfo → anomalyPoolSetupInfo，爱丽丝畏缩配置迁模块能力 anomalyPoolSetup）。2026-09-27 CC-24 420→410（畏缩配置通用化 aliceCoweringConfig → coweringConfig）。2026-09-27 CC-23 430→420（般岳交互补齐：banyueSlot 身份找槽 → producesInteractionTopUp 声明式 + computeInteractionTopUp 模块能力，局部量改名 interactionTopUpSlot）。2026-09-27 CC-22 447→430（爱丽丝剑仪外部次数源迁模块 nextRoundFeedback + applyTeamConfig 改读 threads，删 AgentTeamConfigInput/panelPhases 专用字段）。2026-09-26 CC-21 462→447（全队异常乘区 remielleAnomalyMultiplier → 模块能力 globalAnomalyMultiplierFactor + 通用改名 globalAnomalyMultiplier）。2026-09-26 CC-20 499→462 = 口径纠正不是进步（ROLE_FIELD_EXEMPT 追加 trigger* 触发者通用名 5 个 / 37 处误报，规则 17②）。2026-09-26 CC-19c-2 535→499（蕾米埃尔耀变/特殊虚耀迁 extraAnomalyRows）。2026-09-26 CC-19c-1 545→535（蕾米埃尔虚耀辅助函数迁 mechanics/agents/remielle.ts）。2026-09-26 CC-19b 601→545（爱丽丝极性强击/C6/畏缩 + 简 C6 迁 extraAnomalyRows）。2026-09-26 CC-19a 613→601（柏妮思 C6 灼烧迸发迁 extraAnomalyRows）。2026-09-26 CC-18b 623→613（琉音重击附加 / 非轴强特拆分 / 影画6余音迁 extraDirectRows）。2026-09-26 CC-18a 661→623（柏妮思附加直伤 + 半月 C6 摧岳附伤迁 extraDirectRows）。2026-09-26 CC-17 712→661（axis overlay 按槽归属 + directRowBonus；修可琳 basic_attack 轴模式泄漏）。2026-09-26 CC-16 733→712（banyueTopUp→interactionTopUp 线程字段 + useResourceCalc.interactionTopUp，纯改名零差；已低于 target 720）。2026-09-26 CC-15 759→733（赠行通用命名：ultimateGiftTimeReserved/chainGiftTimeReserved/chainGift 等，纯改名零差；已低于 target 740）。2026-09-26 CC-14e 763→759（卢西娅帷幕写回并入 onFinalAssemble）。2026-09-26 CC-14d 766→763（热启动反馈字段改模块声明 feedbackCfgKeys；已低于 target 765）。2026-09-26 CC-14c 775→766（装配期写回迁模块 onFinalAssemble）。2026-09-26 CC-14a 803→775（诺姆/青衣/莱卡恩/比利/仪玄/安东 6 个角色专属能量项迁模块能力 bonusEnergy）。前值：2026-09-26 CC-14b 821→803（伊德海莉燃血喧响迁模块）。立项：首次普查 905 − 误报 triggerCount 84 = 821（docs/mcp-r22d1-batch12-field-census.md §5）。与 CORE_ROLE_FIELD_BASELINE 同步改。
    target: 0,  // 2026-09-27 CC-38 后重设（前 target 10 已达成；实测 7 − 12 < 0 取 0 = 清零目标）。2026-09-27 CC-39a 后重设（前 target 28 已达成），实测 22 − 12。2026-09-27 CC-36a 后重设（前 target 51 已达成），实测 40 − 12。2026-09-27 CC-35d-B3 后重设（前 target 71 已达成），实测 63 − 12。2026-09-27 CC-35d-B1 后重设（前 target 91 已达成），实测 83 − 12。2026-09-27 CC-35c-D 后重设（前 target 122 已达成），实测 103 − 12。2026-09-27 CC-35b 后重设（前 target 143 已达成），实测 134 − 12。2026-09-27 CC-34b 后重设（前 target 159 已达成），实测 155 − 12。2026-09-27 CC-34a 后重设（前 target 207 已达成），实测 171 − 12。2026-09-27 CC-33 后重设（前 target 219 已达成），实测 219 − 12。2026-09-27 CC-32b 后重设（前 target 242 已达成），实测 231 − 12。2026-09-27 CC-32a 后重设（前 target 258 已达成），实测 254 − 12。2026-09-27 CC-31 后重设（前 target 314 已达成），实测 270 − 12。2026-09-27 CC-30 后重设（前 target 328 已达成），实测 326 − 12。2026-09-27 CC-28 后重设（前 target 351 已达成），实测 340 − 12。2026-09-27 CC-26 后重设（前 target 398 已达成），实测 363 − 12。2026-09-27 CC-24 后重设（前 target 418 已达成），实测 410 − 12。2026-09-27 CC-22 后重设（前 target 435 已达成），实测 430 − 12。2026-09-26 CC-21 后重设（前 target 450 已达成），实测 447 − 12。2026-09-26 CC-20 换尺同步平移 487→450（−37，与 frozen 同口径；非达成重设）。2026-09-26 CC-19c-2 后重设（前 target 533 已达成），lead 复核。实测 499 − 12：remielle rowAccounting/substatOptimizer 8（需设计稿）+ luciaC4DecibelPerTrigger/janeAssaultCritDmgBonus 零散 + 普查下一簇，约 12 处；可逆。前注：2026-09-26 CC-19b 后重设（前 target 589 已达成），lead 复核。实测 545 − 12：remielle rowAccounting/substatOptimizer 8（需设计稿）+ luciaC4DecibelPerTrigger/janeAssaultCritDmgBonus 零散 + 普查下一簇，约 12 处；可逆。前注：2026-09-26 CC-19a 后重设（前 target 611 已达成），lead 复核。实测 601 − 12：remielle rowAccounting/substatOptimizer 8（需设计稿）+ luciaC4DecibelPerTrigger/janeAssaultCritDmgBonus 零散 + 普查下一簇，约 12 处；可逆。前注：2026-09-26 CC-18a 后重设（前 target 649 已达成），lead 复核。实测 623 − 12：remielle rowAccounting/substatOptimizer 8（需设计稿）+ luciaC4DecibelPerTrigger/janeAssaultCritDmgBonus 零散 + 普查下一簇，约 12 处；可逆。前注：2026-09-26 CC-17 后重设（前 target 700 已达成 = 661）：remielle rowAccounting/substatOptimizer 8（需设计稿）+ luciaC4DecibelPerTrigger/janeAssaultCritDmgBonus 零散 + 普查下一簇，约 12 处；可逆。前注：2026-09-26 CC-16 后重设（前 target 720 已于 CC-16 提前达成 = 712）：remielle rowAccounting/substatOptimizer 8（需设计稿）+ luciaC4DecibelPerTrigger/janeAssaultCritDmgBonus 零散 + 普查下一簇，约 12 处；可逆。前注：2026-09-26 CC-15 后重设（前 target 740 已于 CC-15 提前达成 = 733）：banyueTopUp 通用化（外层 ≥6）+ luciaC4DecibelPerTrigger/janeAssaultCritDmgBonus 零散 + remielle rowAccounting/substatOptimizer（需设计稿）约 13+ 处；可逆。前注：2026-09-26 CC-14d 后重设（前 target 765 已于 CC-14d 提前达成 = 763）：CC-14e 卢西娅帷幕写回（assembleSlot luciaCurtain*）+ B 类槽位定位变量首批，约 23 处；可逆，按实际节奏再调
    due: '2026-12-31',
    plan: 'CC-14e 卢西娅帷幕写回迁模块能力（census 文档 §1）→ B 类槽位定位变量按角色逐卡（remielleSlot/aliceSlot/janeSlot…）；remielle 簇需先出设计稿',
  },
  {
    id: 'core 角色名中缀/子目录',
    file: 'src/core/** + src/composables/resourceCalc/** + useResourceCalc.ts（口径见 scripts/lib/core-role-field-ratchet.mjs 判据 23 段）',
    frozen: 0,  // 2026-09-27 CC-43c 4→0 **清零为硬门**（computeLiuyinHugCounts 值导入 → 琉音模块能力 promoteHugCounts）。CC-43f 6→4（roundInputs 希格莉德破阵展开 → 模块钩子 expandAxisAction）。CC-43e 8→6（roundInputs hasLiuyin 身份判定 → 模块声明 ownsPromoteVariantAxisBlocks）。CC-43d 13→8（computeRemielleEntryPanel → computeEntrySnapshotPanel 零差改名）。CC-43b 立尺 13（CC-43a 先零差改名 7 个纯命名项后实测）：computeLiuyinHugCounts 4 / computeRemielleEntryPanel 5 / hasLiuyin 2 / SIGRID_LANCE_SEGMENT_IDS 2
    target: 0,
    due: '2026-12-31',
    plan: 'census §5.47 立卡：CC-43c 琉音转大次数（computeLiuyinHugCounts 值导入 → 模块能力）、CC-43d 蕾米入场面板（computeRemielleEntryPanel 迁模块/通用化）、CC-43e hasLiuyin 身份字面量 → 模块能力、CC-43f 希格莉德枪段 id 常量 → 模块能力',
  },
]

/**
 * 代码里的 debt: 标记注册表（AGENTS 规则 12）。新增标记必须在此登记（登记时写「到期动作」）；
 * 标记从代码里删除（债还清）必须同步销号，否则下面对不上即红。
 * 格式：'<file>:<标记关键词>' -> { since: '引入日期', due: '到期动作' }
 */
export const DEBT_REGISTRY = {
  // 2026-09-04：全局实数化收敛重构（正反馈模块统一连续通道 + 逐模块重校准）。伊德海莉
  // refund 双稳态已 targeted 修复（calcEnergySource 解析不动点 + iterate 阻尼实数 + 终局整数
  // 重推），全局松弛会重排所有带时间/资源循环模块的均衡（sigrid 出枪式消失前例）。
  // ⚠ 本项覆盖 helpers.ts:1270（1a 标记），按 R24 明确结论保留（批 1-1 通用连续通道抽象开工前不许删）。
  // 2026-09-26 CC-13：批 1-1 通用连续通道已落地，债本体仍在。
  'src/core/resource/helpers.ts:全局实数化收敛重构': { since: '2026-09-04', due: '专项立项：正反馈模块统一连续通道 + 逐模块重校准（sigrid/般岳等带时间/资源循环模块均衡重排风险，前例 bdcf52f 锚点漂移 8 处）' },
  // 2026-09-07：喧响/能量收入聚合近似 vs 倍率行矩阵（用户裁决：矩阵求和口径，竖向列全行级）。
  // 仪玄实测行级 5628 vs 聚合 1702；约 50 个模块有 decibelRecovery:0 硬编码。
  // 喧响侧已清偿销号（2026-09-08：账本改 Σ buildExecutions 行级收入，口径条目见 helpers.ts
  // rowDecibelTotal 上方「喧响收入行级Σ」，生效测试 decibelRowParity.test.ts）。
  // 能量侧已清偿销号（2026-09-09：第一段债务清账 07481b8 + 第二段 Σ 切换，口径条目见 helpers.ts
  // rowEnergyTotal 上方「能量收入行级Σ」，生效测试 energyRowParity.test.ts）。
  // 2026-09-07：横向动作覆盖缺斤少两（用户实测口径）——物化执行行少于实战动作序列，竖向字段
  // 已行级而横向无逐角色锚点。修复 = 实数化专项逐角色收口（弹刀反推/合轴自动填充同族手法）。
  'src/composables/resourceCalc/convergence.ts:轮换动作覆盖实数化': { since: '2026-09-07', due: '实数化专项逐角色收口（1481/1371 前例），以归档对拍定每角色动作锚点' },
  // 2026-09-10（账本 Open #6：spec JSON 的 debt: 标记纳入扫描）：柚叶转积蓄的贡献行挂柚叶槽位，
  // 若其积蓄在目标异常池占比最大会被误判为施加者——实际异常角色积蓄远大于支援柚叶，属已接受近似。
  'src/specs/agents/1411.json:贡献挂柚叶槽位': { since: '2026-09-10', due: '施加者判定按「除柚叶外最大贡献者」收口时销号；无专项计划则维持近似（已在 note 明示可接受）' },
  // 2026-09-11（用户三问：溢出是真的吗 / 合轴率能否周转 / 截断后资源该不该降）：实测确认
  // 资源池的能量/喧响/次数取**未截断**的收敛账本，装配期截断只削行 ⇒ 有截断时两者不自洽
  // （般+诺+卢全关档：槽0 回能账本 200 vs 截断后 Σ行 140，截断 66.8s / 21 条行）。止血已落
  // （截断可见 + 难度轴交互按存活率缩）；正解 = A 项：截断后行重收敛（先按预算重分配平A池、
  // 交互只取达成目标的最少要求，装不下就重收敛到截断为 0）。
  'src/core/resource.ts:截断不回灌资源循环': { since: '2026-09-11', due: 'A 项立项：截断后行重收敛（含全库 delta 归因）；落地后销号（止血的可见性/交互缩不销）' },
  // 2026-09-25（R2-E F3 用户裁决：登记为债务挂账，不立即重构）：TeamBuffSpec.target 声明了
  // team/enemy/both 定向，但运行时全仓零消费点（引擎与 collectInCombatTeamBuffs 均不读，
  // 渲染面也不读）⇒ 「声明了但实现没接」的死通道（规则 16）。误传的第二死通道 includeOwner
  // 在 TeamBuffSpec 里本就不存在（活跃同名字段在 core/inCombatBuffs.ts，不归本条）。
  'src/specs/types.ts:声明了 team/enemy/both 定向': { since: '2026-09-25', due: '裁决走向后销号：要么引擎按 target 分流（team→队友/enemy→敌方/both→两者）并接进 collectInCombatTeamBuffs，要么删字段并清全库 spec 同名键（validate:specs 同步放行）' },
  // 2026-09-12（账本交接欠账）：克拉蕾残痕「同时最多 3 层」是**时序**约束，整局总量口径只能表达成
  // 「不钳制 + 消耗需求封顶」⇒ 极端配装（积累速率 ≫ 消耗节奏）下偏乐观。上条会话因 check-guards.mjs
  // 被并行会话占用、按规则 13 先记账本不登记，本条补登（代码标记在 claret.ts gashStacks 计算处）。
  //   ★ 2026-09-20 round 54（管理员 AG）：**仍保留**，但内容按实测**改写**（不是原样留也不是销号）——
  //     ① 【定理】`consumed = min(L, Ds)` 是**所有自洽读法的共同上界且紧**：`L∈0..12 × Ds∈0..12 ×
  //        全部交错` = **10 400 599 个交错零越界**；细粒度交错（积累与消耗交替）**可达**该界，而平A 项
  //        按定义就是「秒均 × 时间」（连续）⇒ 细粒度交错正是本式自身隐含的读法 ⇒ **单向高估、不可能低估**。
  //     ② 【天花板·纠正原表述】病态「先攒满再消耗」读法取 `min(L,Ds,cap)` ⇒ 幅度 `max(0, min(L,Ds)−cap)`，
  //        咬合**充要条件 = `L>3 且 Ds>3`**（任一 ≤3 则本式精确）。实测默认夹具 `L`=24~26/`Ds`=4 ⇒ **≤1 层**；
  //        滑块推满 `Ds`=80 ⇒ ≤53 层。⚠ 原记的「积累远快于消耗节奏 ⇒ 偏乐观」**把两个因子说成一个**：
  //        误差**不随积累速率 L 单调放大**，而是被 `Ds` 与 `cap` 夹住（L 再大，幅度也 ≤ `Ds−cap`）。
  //     ③ 【为什么不落真队列】本条**不需要绝对时刻**（原文无任何时长/衰减子句，层只被毁伤消耗 ⇒ 纯计数约束），
  //        故 R52 对风眼成立的那条否决理由（「引擎无逐发绝对时刻 ⇒ 必须编造发次间隔」）**对本条不成立**。
  //        但引擎同样没有**逐事件顺序**通道，且已证本式是**紧**上界（不可再改进）⇒ 保留 + 挂 `⟳复核`。
  //     ④ 外部复核（R54 侦察）：nanoka zh/en/ja/ko × 3.2/3.3.0/3.3.2/3.3.3 **逐字符串零差异**；
  //        官方名词表 `3000038` 只写「最多叠加3层」；同段落对猩红铭刻 16s / 残锋 40s / 锐能 180s / 喧响 18s
  //        **都明写秒数** ⇒ 残痕的省略是**刻意的**，不是漏抄。证据 `/home/kaua/r54-scratch/evidence/`。
  'src/mechanics/agents/claret.ts:残痕总量口径天花板': { since: '2026-09-12', due: '已证 `min(L,Ds)` 为紧上界（10400599 交错零越界 + 可达）⇒ 无「更准的近似」可落；仅当引擎获得**逐事件顺序**通道（或官方补充 [残痕] 时长/衰减子句，可裁决病态读法归属）时复核并销号' },
  // ✅ 2026-09-20 round 52：洛可茜风眼「同时存量≤9 / 30s 自然引爆 / 超限最早引爆」时序 debt
  // **已结清（销号）**。R51 登记时按「需要逐事件时序队列」挂账；R52 把该队列**真建出来**跑闸门
  // （全库 5702 次引擎求值 = 105 预设 + 60 角色 × 命座 0/3/4/5/6）⇒ **零 delta**，且理由是**结构性**的：
  // 单发风眼上界 ≤ `WIND_ENERGY_MAX`=3 < 9（9 上限不可达），每发恕不远送恰引爆 3 个 ⇒ 队列每发清空
  // （长度恒 ≤ 3，30s 自爆不可达）；默认 `spinSeconds=2.5` ⇒ 风眼数恒为 3 的倍数 ⇒ 现行式**就是**原文
  // 语义的精确解，不是近似。⚠ **不是「影响小所以不建」而是「证明到不了」**——两者是不同的结论。
  // 天花板（滑块域 `eyeRate>1.34` 单发可 >3 ⇒ 9 上限真咬合、本式高估；`spinSeconds<2.25` ⇒ 局末余留眼
  // 被计成小旋风）与「为什么不落真队列（引擎无逐发绝对时刻，落真队列必须编造发次间隔）」已按规则 12
  // 改写为模块内 `@fact … 近似:` + `⟳复核 到期 2027-03-31`，不再占 debt 位。
  // 证据（三版预言机 + 全库 delta + 穷举等价域）见 `/home/kaua/r52-scratch/evidence/`。
  // 2026-09-20 round 53（管理员 AF）：洛可茜影画6 **[余响]** 时序 —— **新登记**（同族第三债，但结论与
  // 前两条都不同，别互相照抄）。原文 `talent.6.desc`：「每间隔3秒生成一次巨型风旋，共额外生成2次，
  // 重复触发时额外生成次数叠加且刷新[余响]的持续时间」。
  //   ★【方向已定，纠正 R52-J1】「共额外生成2次」⇒ 总量恒 ≤ `2×引爆数` ⇒ 现行式 `mega = sendOff×(1+2)`
  //     是**所有自洽读法的共同上界**（R53 实测 4 读法 × 7 个时长 × 全网格 = 4224 次求值**零越界**）
  //     ⇒ **单向高估、不可能低估**。R52-J1 记的「方向未定」到此收口为「方向已定」。
  //   ⚠【幅度不可定】精确值需两个原文未给的参数：① [余响] **持续秒数 D**（原文只说「刷新持续时间」，
  //     从不给数值）；② 「3s 节拍」归属（每实例各自计时 vs 目标身上单一节拍——双语只把「叠加」对象
  //     写成 `instances`、把「刷新」对象写成 `duration`，没说节拍归谁）。实测合法区间
  //     **D=6 ⇒ 17 / D=12 ⇒ 19 / D=30 ⇒ 25 / D=180 ⇒ 60 / 逐实例 ⇒ 86**（默认夹具 n=43、跨度 45.86s）
  //     ⇒ **[17, 86]，跨度 5.1×**。落精确值必须**编造 D** ⇒ 按 R52 纪律（不把未建模假设写进伤害数）
  //     保留上界 + 登记本债 + 挂 `⟳复核 2027-03-31`。
  //   ⚠ 与 §R51-J1 风眼的区别：风眼是**证明到不了**（结构性不可达 ⇒ 销号）；本条是**到得了但算不准**
  //     （有界高估 ⇒ 登记 debt）。**两者处置不同，是本任刻意区分的。**
  //   证据 = `/home/kaua/r53-scratch/evidence/`（4 读法穷举 + 全库对账 + 反向验证探针）。
  'src/mechanics/agents/roxy.ts:余响总量口径天花板': { since: '2026-09-20', due: '拿到 [余响] 的 buff 表定义（持续秒数 D + 3s 节拍归属）或用户裁决该读法后，落逐事件时间轴替换上界并销号；若用户裁决接受「2×引爆数」为上界近似则销号并留 @fact' },
}

/**
 * 存量口径豁免清单（棘轮基线）：key = `<file>:<line> <subject>`。
 * ⚠ 这张表只许**缩短**：给某条口径补上 `⟳复核` 行之后，从本表删掉该行（漏删即红 = stale）。
 * 为什么允许存量豁免：85 条一次性补完不现实，全红会逼人**删判据**（判据死掉比缺口更糟）。
 */
export const CALIBER_TRIGGER_ALLOWLIST = [
  "src/composables/difficultyCurve.ts engine:难度曲线/x轴",
  "src/composables/difficultyCurve.ts engine:难度曲线/伤害归因",
  "src/composables/difficultyCurve.ts engine:难度曲线/交互项截断缩",
  "src/composables/difficultyCurve.ts engine:难度曲线/关键次数标注",
  "src/composables/difficultyCurve.ts engine:难度曲线/全关基线",
  "src/composables/difficultyCurve.ts engine:操作难度/角力权重",
  // ⚠ 2026-09-17 round 21 夜D：`engine:轴内块数落地` 的**键随实现改路径**——
  // 该口径的实现在夜D 从 `convergence.ts` 整块迁进 `hugo.ts#applyHugoTeamConfig`（规则 6），
  // 故豁免键从 `src/composables/resourceCalc/convergence.ts` 改指 `src/mechanics/agents/hugo.ts`。
  // **这是路径跟随、不是销号**：口径内容一字未改、触发器仍未补 ⇒ 存量面（game 条数）不变。
  // ✅ 2026-09-18 round 21 夜 派活方**已把那条绝对地板换掉**（`checkGuards.test.ts`）：
  // 原 `expect(r.game.length).toBeGreaterThanOrEqual(80)` 是一条「不许还债」的地板——
  // 完整还债（补 `⟳复核` + 销号本清单条目）会让 `game` 80 → 79 而精确红
  // （实测 `expected 79 to be greater than or equal to 80`，其余判据全绿）。
  // 已改为钉真正的不变量（`ALLOWLIST.length === game.length` + 两侧非空）；
  // 实测「新增裸奔口径仍被拦」（`missing` 非空 ⇒ 红）⇒ 护栏未变松。
  // ⇒ **现在补这条 `⟳复核` 是安全的**（销号后 `game` 79 不再触发任何断言）。
  "src/composables/resourceCalc/damagePool.ts engine:damage/减防通道",
  "src/composables/resourceCalc/damagePool.ts engine:damage/非轴失衡易伤",
  "src/composables/resourceCalc/feasibilitySearch.ts engine:降配搜索/非下闭可行集",
  // ⚠ 2026-09-18 round 22 / T67-a1 刀 A：`disc:覆盖率并入范围` 的**键随实现改路径**——
  // 该口径的实现（`mergeTeamDiscEffectCoverages` 及其头注释 @fact）随 B 簇整段迁进
  // `resourceCalc/panelPhases.ts`，故豁免键从 `helpers.ts` 改指 `panelPhases.ts`。
  // **这是路径跟随、不是销号**：口径内容一字未改、触发器仍未补 ⇒ 存量面（game 条数）不变。
  "src/composables/resourceCalc/panelPhases.ts disc:覆盖率并入范围",
  "src/composables/resourceCalc/ultimatePromote.ts engine:实战档位喧响计数",
  "src/composables/resourceCalc/ultimatePromote.ts engine:失衡次数不动点",
  "src/composables/stunVulnSummary.ts engine:失衡易伤可见化/加权信用",
  "src/composables/teamCompare.ts engine:操作难度/权重可调",
  "src/composables/timeWeightAllocation.ts engine:分配策略/主C判定",
  "src/core/damage.ts engine:damage/乘区顺序",
  "src/core/effectiveTime.ts engine:stun/时间守恒",
  "src/core/panel.ts engine:driveDisc/固定主词条",
  // ⚠ R43 结构熵切面：`engine:时间线截断` 的实现与 @fact 随截断族整段迁进
  // `core/resource/timeTruncation.ts`，故豁免键**随之改指**。**这是路径跟随、不是销号**：
  // 口径内容一字未改、触发器仍未补 ⇒ 存量面（game 条数）不变。
  "src/core/resource/timeTruncation.ts engine:时间线截断",
  "src/core/resource/helpers.ts yidhari:refund不动点",
  "src/core/resource/helpers.ts engine:合轴预算抵扣",
  "src/core/resource/helpers.ts engine:单角色前线上限",
  "src/core/resource.ts engine:欠打回填",
  "src/core/resource.ts engine:折叠环上限",
  "src/core/resource.ts engine:热启动逐位透明",
  "src/core/resource.ts engine:判稳含平A时间",
  "src/core/resource.ts engine:收敛环停点规范化",
  "src/core/resource.ts engine:fusedGroupMetrics/一次动作整段量",
  "src/core/resource.ts engine:findChainAttack/多段连携",
  "src/data/counterAssists.ts data:反制支援/招式配对",
  "src/data/exSpecialPlans.ts engine:exSpecialPlan/千夏拍照",
  "src/data/exSpecialPlans.ts engine:exSpecialPlan/成本类型化",
  "src/data/moveFusions.ts engine:moveFusion/飞雪斩击",
  "src/data/moveFusions.ts engine:moveFusion/春临",
  "src/data/moveFusions.ts engine:moveFusion/兔兔连斩",
  "src/data/moveFusions.ts engine:moveFusion/孤影断獠",
  "src/data/moveFusions.ts engine:moveFusion/泡泡糖轰炸",
  "src/data/moveFusions.ts engine:autoField/能量场不占前台时间",
  "src/data/sustainedEx.ts engine:sustainedEx/基准秒",
  "src/data/teamPresets.ts preset:队伍分类口径",
  "src/mechanics/__tests__/remielle.test.ts agent:1581/异化C2加算单写者",
  "src/mechanics/agents/banyue.ts engine:banyue/补齐时间上限",
  "src/mechanics/agents/claret.ts agent:1611/锐能·终结技回复",
  "src/mechanics/agents/claret.ts agent:1611/初始暴伤转暴击",
  "src/mechanics/agents/claret.ts agent:1611/平A双基准",
  "src/mechanics/agents/claret.ts agent:1611/琢形送残痕",
  "src/mechanics/agents/claret.ts agent:1611/铭刻窗口·停表",
  "src/mechanics/agents/ellen.ts agent:1191/喧响行级回填审计",
  "src/mechanics/agents/liuyin.ts agent:1481/60转大上限",
  "src/mechanics/agents/liuyin.ts agent:1481/强特计划估时",
  "src/mechanics/agents/nicole.ts agent:1031/影画1能量场",
  "src/mechanics/agents/piper.ts agent:1281/动力",
  "src/mechanics/agents/piper.ts agent:1281/影画2",
  "src/mechanics/agents/remielle.ts agent:1581/耀变倍率提升",
  "src/mechanics/agents/roxy.ts agent:1621/自旋喧响每秒口径",
  "src/mechanics/agents/sigrid.ts agent:1591/出枪式段时间",
  "src/mechanics/agents/sigrid.ts agent:1591/影画1溢出",
  "src/mechanics/agents/sigrid.ts agent:1591/敛枪式估时",
  "src/mechanics/agents/sigrid.ts agent:1591/出枪式机会计数",
  "src/mechanics/agents/sigrid.ts agent:1591/影画6破阵提速",
  "src/mechanics/agents/sigrid.ts agent:1591/影画1第三段送机会",
  "src/mechanics/agents/soukaku.ts agent:1131/强特",
  "src/mechanics/agents/starlightBilly.ts agent:1531/链数实数化",
  "src/mechanics/agents/yeshuguang.ts agent:1431/帷幕易伤",
  "src/mechanics/agents/yeshuguang.ts agent:1431/自动选轴",
  "src/mechanics/agents/yeshuguang.ts agent:1431/短轴资源",
  "src/mechanics/agents/yeshuguang.ts agent:1431/轮数实数化",
  "src/mechanics/agents/zhao.ts agent:1341/EQ合轴",
  "src/mechanics/agents/zhuYuan.ts agent:1241朱鸢特化",
  "src/mechanics/agents/zhuYuan.ts agent:1241/压制以太弹时间",
  "src/stores/config.ts engine:平A权重阶梯",
  "src/stores/config.ts engine:交互基准",
  "src/types/resource/team.ts engine:收敛读数归属",
  "src/views/TeamComparePage.vue sweepPage:第三人候选圈定",
  "scripts/import-nanoka-bosses.mjs data:bossBodySize",
  "scripts/import-nanoka-v12.mjs data:1611/反制支援两行秽盾基数",
]
