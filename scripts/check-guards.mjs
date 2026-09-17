#!/usr/bin/env node
// 机器护栏：AGENTS.md 里仍靠纯文字守着的规则 → 会大声失败的判据（挂在 check/verify 链首端）。
//
// 为什么存在：本仓库已验证的经验是「让 agent 守规矩的从来不是措辞，是会红的 CI」——
// AGENTS.md 每条硬规则的历史防线（validate:specs / allAgentsSweep / resolve exit 1 / 拆 CI job）
// 全是事故后加的机器判据，加完没有复发。本文件补齐最后几条纯文字规则：
//   1. fetch-stub 冻结   —— AGENTS §3「新测试一律用 src/test/harness.ts，禁止复制 fetch stub」
//   2. agentId 分支棘轮  —— 规则 6「队伍级机制走 applyTeamConfig，禁止往 useResourceCalc 加分支」
//   3. 工作区状态防误提交 —— 规则 13「task-ledger/ledgers 是工作状态不是项目知识」
//   7. 展示层越层棘轮    —— ARCHITECTURE §0「依赖方向：展示 → 编排 → 引擎」
//      （views/components 禁 import @/core|@/mechanics|@/specs；存量冻结只减不增）
//
// 用法：node scripts/check-guards.mjs（npm run check / npm run verify 已挂载）
// 逃生口（都要求显式改本文件，让「例外」在 diff 里留痕）：
//   - fetch-stub：测试迁移到 setupHarness 后，从 FETCH_STUB_ALLOWLIST 删掉对应行（清单与
//     现状做集合相等校验，漏删即红，防清单变死数据）
//   - agentId 棘轮：基线只减不增。下调（进步）需在提交说明写明；上调没有合法路径——
//     角色特例逻辑属于 src/mechanics/agents/<id>.ts 的 applyTeamConfig（派发器在
//     composables/resourceCalc/helpers.ts，见规则 6 / ARCHITECTURE §3）
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 语言层（事实语法/锚点解析）的单一实现在 zc.mjs，护栏只调用不复制（规则 11）
import { auditAuthoredFacts, resolveAnchor, scanAuthoredFacts } from './zc.mjs'
// level60 字段映射规则表（审计/修复/导入脚本三方共用，规则 11）
import { FIELD_RULES } from './lib/level60-rules.mjs'
import { scanScopedStyleReach } from './lib/scoped-style-reach.mjs'
import { scanCompactedSlotIndex, IDX_SAFE_ALLOWLIST } from './lib/compacted-slot-index.mjs'
// 角色身份判定检测面（AST 单源；2026-09-17 round 19 换尺批，见 scripts/lib/agent-identity-lines.mjs 头注释）
import { countIdentityBranchLines, countIdentityBranchLinesInFiles } from './lib/agent-identity-lines.mjs'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// ---- 判据 1：fetch-stub 冻结 ----

/** 直接操纵全局 fetch 的写法（合法路径只有 src/test/harness.ts 一处） */
export const FETCH_STUB_PATTERNS = [
  /\(\s*global\s+as\s+any\s*\)\s*\.\s*fetch\s*=/,
  /\bglobal\s*\.\s*fetch\s*=/,
  /\bglobalThis\s*\.\s*fetch\s*=/,
  /\bvi\s*\.\s*stubGlobal\s*\(\s*['"]fetch['"]/,
]

export function detectFetchStub(content) {
  return FETCH_STUB_PATTERNS.some(re => re.test(content))
}

/**
 * 护栏系统自身文件，不参与扫描：harness.ts 是唯一合法的 fetch stub 实现；
 * checkGuards.test.ts 的 detector fixture 必然包含被禁写法的字面量（自指豁免，非债务）。
 */
export const GUARD_SYSTEM_FILES = [
  'src/test/harness.ts',
  'src/scripts/__tests__/checkGuards.test.ts',
]

/**
 * 存量债务清单：2026-08-30 冻结时的 39 个自带 fetch stub 的测试（全仓库唯一形态是
 * `vi.stubGlobal('fetch'`）。新测试用 setupHarness；存量测试迁移一个删一行。
 */
export const FETCH_STUB_ALLOWLIST = [
]

function walkTestFiles(root) {
  const out = []
  const srcDir = join(root, 'src')
  const rec = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) rec(p)
      else if (name.endsWith('.test.ts')) out.push(relative(root, p).split('\\').join('/'))
    }
  }
  rec(srcDir)
  return out.sort()
}

/** files: [{ path, content }]（path 为仓库相对 posix 路径）→ 违规 path 列表 */
export function fetchStubViolations(files) {
  return files
    .filter(f => !GUARD_SYSTEM_FILES.includes(f.path) && detectFetchStub(f.content))
    .map(f => f.path)
}

export function scanFetchStubs(root = ROOT) {
  const files = walkTestFiles(root).map(path => ({ path, content: readFileSync(join(root, path), 'utf8') }))
  const violations = fetchStubViolations(files)
  const allowed = new Set(FETCH_STUB_ALLOWLIST)
  const stale = FETCH_STUB_ALLOWLIST.filter(p => !violations.includes(p))
  return { violations, stale }
}

// ---- 判据 11：棘轮 burn-down 契约（防「冻结 = 永久化」） ----
//
// 为什么需要：棘轮（agentId 53 / 展示层 23 / check-tokens 各基线）解决了「不许变差」，
// 但**没有解决「什么时候变好」**——实测 `AGENT_BRANCH_BASELINE = 53` 自 2026-08-30 冻结后
// 在 git 历史里**从未被下调过**（`git log -S` 只有 + 没有 -）。护栏因此变成一份「永久的豁免书」：
// 新 agent 看到 53/53 全绿，会读成「这是可接受的状态」而不是「这是待还的债」。
//
// 本判据是**只报不红**的到期提醒（对齐 debt: registry 的 philosophy，但更软）：
// 每条棘轮登记 { current, plan, due }；`zc status` 把「到期/超期/无进展」的棘轮点名。
// 不设红线的理由：红了会逼人**改日期作弊**或**灌水凑数**，反而毁掉测量——
// 与 timeGolden 基线「是测量工具不是开发否决权」（规则 10 用户裁决）同一条哲学。
//
// 到期语义：due 是「承诺下调到 target 的日期」，不是「必须清零」。
// 到期日之后若 current 仍 == frozen 值（零进展），进 stale 列表被点名。

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
    frozen: 4,  // R21 夜 A **damagePool.ts 最后 3 处** 12→**9**（本批 **−3**，按**工作树实测**归因：
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
    plan: '逐角色把编排层特判迁进模块：applyTeamConfig 三阶段钩子，或声明式钩子（axisWindowOverlays / backstageAutoFill / producesInteractionTopUp 等有先例）。跨轮反馈走 `AgentTeamConfigInput.threads`（2026-09-15 新增的通用通道，别再逐字段铺开契约）；「读本轮结果算下一轮」类走 `nextRoundFeedback`（2026-09-16 新增，递整份本轮结果 + `prevThreads`，返回 `Partial<CalcRoundThreads>`）；**轴内计数/窗口量走 `axis` 契约**（2026-09-16 round 11 落地：“active / axes / windows / windowSeconds / actionCountsBySlot / ultimateTotalBySlot / chainTotalBySlot”，只读快照、只在 converge 相位有值 ⇒ 模块侧 `phase !== \'converge\' || !axis` 双判据门控）。hot spot（**2026-09-17 round 21 夜三批并行后按新尺实测**，总数 **9**）：useResourceCalc.ts(3) > convergence.ts(2) = helpers.ts(2) > liuyinPromote.ts(1) = normaHatChain.ts(1)。⚠ 三批归因（工作树实测，剥离并行会话后各自量）：夜 A = damagePool.ts 8→2「−6 里 −3 属本批」（见 `frozen` 行）；**夜 B = convergence.ts 8→2（−6，本批）**；夜 C = helpers.ts 8→2（−6）。上一读数（round 20 R20-h1 后，总数 32）：convergence.ts(8) = damagePool.ts(8) > helpers.ts(11) > useResourceCalc.ts(3) > liuyinPromote.ts(1) = normaHatChain.ts(1)。⚠ 换尺前（round 19 当刻，总数 42）的读数是 helpers.ts(18) > convergence.ts(11) > damagePool.ts(8)；更早的「convergence.ts(10) > damagePool(3) > helpers(4)」是**旧尺（只数 `agentId ===`）**的读数，三者不可直接比（新尺多算 `.id`/`teammateBuffId` 两形态，且 R20-h1 让 helpers 从 18 降到 11）。**下一批候选（按价值）**：⭐ **helpers.ts 已按 `R20-A-helpers-triage.md` 的 §4 切 4 批：✅ 批次 1（R20-h1，7 块同槽面板，−7）已完成；下一批 = 批次 2（A1 `:610` 耀嘉音源面板判死，单独立项勿混批）**；再往后 = 批次 3（A2/A3/A4/A5 跨槽 P2 批，⚠ **必须先补队伍级面板契约**——分诊 §2.1 受控实验实证直接搬进 per-role `applyPanel` 会静默失效）；批次 4（A13/A15/C1/D1 化石与跨槽混合批，需裁决先行；A14 简 35 行块受 `jane.passionCoverage` 未注册阻塞）。⚠ **夜 B 查实：convergence.ts 剩 2 行是「跨轮 cfg 注入」类，不是 DRY 机会**——`:817` 雨果 / `:840` 般岳，两者的**字段契约与消费端都已就位**（hugo.ts 读 `hugoAxisExVerdictCount` 选通路、banyue.ts 读 `banyueInteractionTopUp`），但迁移需要的**输入通道缺失**：`autoTopUp` 依赖 `guarantee.fury`/`guarantee.ultimate`/`banyue.autoTopUpInteractions` 与 `configStore.appliedBoss`，其中 `guarantee.*` **未注册** MechanicSetting（`getRegisteredMechanicSettings()` 不含它，实测）⇒ 不在 `AgentTeamConfigInput.settings` 里，模块侧读不到；给 `AgentTeamConfigInput` 加 `guarantee` 契约 = 改 `src/mechanics/types.ts` + 改冻结面，属独立批次。下一批要动这 2 行，先补该契约。⭐ 另一条线以 T42 只读分诊的 §D 为准（报告 `/home/kaua/.dsh/session-manager/reports/R18-triage-helpers-convergence.md`）：✅ **C-α（`convergence.ts` 的 C8 叶瞬光逐云 + C10 格莉丝轮换）已于 round 19 完成**（旧尺 −2，提交 `8a4b47b`）；次推 C-β（橘福福符法千重 + 莱特能量）；第三 C-γ 1141 收尾（⚠ 分诊实测：**只补 `countStun` 不够**，非轴臂还要队友 `chainCountPerStun` 的 store 原值，`MechanicTeamMember` 没有该字段且**不能**用 `characters` 上那份代替——默认值分裂）。以下为更早的沿革（保留供追溯）：批次 3 已做一半——1051 伊德海莉**已迁**（2026-09-16 round 13）；**1371 仪玄仍留**（设计卡 §6 证伪闸门**已触发**：唯一缺口 = `yixuanExtremeAssistCap` 需「未缩放队友弹刀和」= T5 的「未缩放交互次数」契约缺口，与 1141 的 `lycaonBackstageDodgeCount` 同族 ⇒ 先补契约再迁，两处一起解锁）。⚠ **任务卡曾预期 1051 迁完解锁 core 棘轮 2 处（`helpers.ts:1271` + `resource.ts:595`）——该前提实测已证伪**：那两处守卫早在 `0bb2611`（16→12）与 `97cc65c`（8→6）就已按 T6 判据删除，均**早于** round 11；core 当前 6 行的逐行清单见 `CORE_AGENT_BRANCH_BASELINE` 头注释。故本轮 core 保持 6 不变。✅ 1511 的 `if (prevInStunWindowTriggers <= 0) { … if (c.agentId === \'1511\') … }` 死写块**已于 round 13 删除**（−1，静态判死依据见 `AGENT_BRANCH_BASELINE` 沿革），同时删掉因此未使用的解构 `prevInStunWindowTriggers`。⚠ 已知**契约缺口**（迁移前先补，别硬迁）：C7「计数投影失衡次数」`countStun`（阻碍 1141 的 `lycaonC2Energy`）、「未缩放交互次数」（阻碍 1141 的 `lycaonBackstageDodgeCount`，`characters` 上已被 interactionScale 缩放）。架构评审 #10 → #2',
  },
  {
    id: 'core agentId 分支',
    file: 'src/core/resource.ts + core/resource/helpers.ts',
    frozen: 6,  // 2026-09-11 评审冻结 36（resource.ts 16 + helpers.ts 20）→ 26（2026-09-13 T6 首次真清偿 −10）→ 18（2026-09-13 crossAgentSupply 收口 −8）→ **12**（2026-09-15 批次2 −4：helpers.ts 里 4 处 yidhari 守卫化简——1 处 `!==` 短路左操作数（yidhariRefund）+ 2 处 `if (cfg.agentId !== '1051')`（yidhariBurn×2）+ 1 处 `agentId === '1051' && 字段!==undefined`；判据 = 相关字段唯一写入方 = yidhari.ts 模块且无默认值 ⇒ 字段判据完全覆盖角色判据，timeGolden 0 delta，反向验证破坏该字段消费 ⇒ preset:yidhari-qingyi-lucia 精确红）。详见 CORE_AGENT_BRANCH_BASELINE 头注释的沿革
    target: 0,
    due: '2027-03-31',
    plan: '剩 18 处：① 先把 convergence.ts:957 的 yidhariInStunExCount / :1074 的 billyAxisActive 写入方挪进对应角色模块，再删 helpers.ts:1271 与 resource.ts:595 的守卫（现不冗余）；② `!==` 短路形态逐处论证后化简；③ 跨角色查找（findIndex 找队友槽位）与纯 agentId 写入（billyFinalizeChain / yidhariFinalizeEx 由引擎写角色字段）属真特判，需走 applyTeamConfig / convergence 落点（评审 #10）；④ 同批新增判据 12（core role-import 棘轮 7 处）——它是本条的**语义补强面**：agentId 字面量清零 ≠ 角色无关，引擎静态 import 角色模块同样要清',
  },
  {
    id: 'core 角色模块引用',
    file: 'src/core/** → @/mechanics/agents/*',
    frozen: 5,  // 2026-09-13 架构诊断实测（不含测试）：赠链族契约落地后剩余 5 处 —— luciaElowen×3 / banyue×1 / norma×1 / liuyin×1 / velina×2
    target: 0,
    due: '2027-03-31',
    plan: '⚠ 迁移前提已实测证伪（2026-09-13 T8）：5 处全是活引用、0 死引用；三处（velina / banyue / luciaElowen）都需**引擎契约改动**（给 AgentMechanicModule 加「引擎期求值」能力 + 把注册表穿进 calcTurbulenceDamage 等签名），不是机械迁移——详见 CORE_ROLE_IMPORT_BASELINE 头注释的逐条实测依据。勿按「可直接删死引用」的原计划重走',
  },
  {
    id: '展示层越层 import',
    file: 'src/views + src/components',
    frozen: 15,  // 2026-09-11 评审冻结 23 → 15（2026-09-13 T7 首次真清偿 −8：纯常量/纯函数下沉 src/data，原位置改 re-export + 展示层改 import 路径，vue-tsc 0 错、@fact 锚 93/93 不变）。下沉清单与「剩 15 处为何不能下沉」见 EXHIBITION_LAYER_IMPORT_BASELINE 头注释
    target: 0,
    due: '2026-12-31',
    plan: '剩 15 处全是**真引擎调用**（getAgentMechanic×4 / buildTeammateBuffSourceContext×2 / calcPanel / applyTargetedStat / calcStunMultiplier / allocateAxisWindows / computeOptimalSubStats+getTemplate / readImpactVar+writeImpactVar / agentSpecs / computeBanyueMingwangBlocks+BANYUE_AXIS_MOVE_META / computeYixuanNingshenBlocks），无纯常量可下沉；正解是经编排层（composables/resourceCalc）透出面板/引擎产物，属架构改动，逐条独立立项。纯函数类已全部下沉完毕（23→15）',
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
    file: 'scripts/check-guards.mjs DEAD_CHANNEL_ALLOWLIST',
    frozen: 8,  // 2026-09-13 首轮实测 15（判据 14 上线时冻结）→ 14（2026-09-14 T15 审计 #13：
    // 扣掉 1 条 kind:'namesake' 的误报记录 runArchiveImport.resistances —— 它的候选永不消失、
    // 永远不会 stale，算进待处置量会让棘轮**永远还不完**。口径见 countDeadChannelWorkload）
    // → **8**（2026-09-15 销号 7 条**假阳性**，三个检测器缺陷，**不是调基线蒙混**）：
    //   · 段 A 3 条（coverageMap / moduleInputRows ×2）—— 读判定漏「裸标识符读 + 位置实参」
    //   · 段 B 4 条（stunAxisPresets 的 chapter / guarantee —— 写判定不扫 JSON；
    //     difficultyLadder 的 minGain / multiplierCoefficients 的 zeroEnergyRow —— 写判定漏对象**简写**）
    // 现况：A 零读零写 2（runArchiveImport 的 weaknesses/hpTotal，确无消费点）/ B 只读不写 6（含 1 条
    // namesake 误报样本 runArchiveImport.resistances，已在 why 里如实标注）/
    // C 手写 d.mts 漂移 **0**（上线即把 16 个漏声明一次补齐 = 判据的正确用法）。
    // 三类（除误报样本外）都是存量：通道在、类型在、编译过，就是没人用
    target: 0,
    due: '2026-12-31',
    plan: '逐条「接上或删掉」二选一——接上消费点（如 phaseDelayedCooldown 的 blockSeconds 接 frontBlockSeconds、轴预设 chapter 补数据）或删死字段；处置一条从 DEAD_CHANNEL_ALLOWLIST 删一条（漏删即红 = 棘轮只减不增）。⚠ 不许「为绿而登记」：新增豁免必须写 why（怎么证明它是死的），否则判据退化成橡皮图章',
  },
  {
    id: '名词表未处理',
    file: 'scripts/lib/noun-triage.json（源 = data/raw/nanoka_missing/noun_3.2.3.json）',
    frozen: 41,  // 2026-09-14 口径纠正（T15 审计 #4）：原写 frozen: 0 且度量只数 unhandled ⇒
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
]

/**
 * 计算每条棘轮的 burn-down 状态。
 * `measure(id)` 由调用方注入（避免本文件硬依赖各判据的测量实现）。
 * 返回 [{ ...entry, current, progress, stale, overdue }]
 * - progress = frozen - current（>0 表示已还款）
 * - stale = 已过 due 且零进展（点名；这是本判据存在的唯一理由）
 * - overdue = 已过 due 但还没做完（有进展或已清零 → 提示剩余/收尾，不算 stale）
 *
 * ⚠ 2026-09-12 修一处被 frozen>0 长期掩盖的判据缺陷：原式 `stale: overdue && progress <= 0`
 * 在**已清零**时误报——frozen=0 且 current=0 ⇒ progress=0 ⇒ 判 stale，而同一行 `done` 却是 true
 * （0 ≤ target）。此前所有棘轮 frozen 都 >0，`progress<=0` 恰与「零进展」等价，故从未暴露；
 * agentId 棘轮 8→0 后立刻连红三条（未到期/有进展/清零三个用例），属**判据自身**的错。
 * 修正：先排除已完成（done），再用 progress<=0 判零进展。
 */
export function computeBurndown(measure, today = new Date().toISOString().slice(0, 10)) {
  return RATCHET_BURNDOWN.map(e => {
    const current = measure(e.id)
    const progress = e.frozen - current
    const overdue = today > e.due
    const done = current <= e.target
    return {
      ...e,
      current,
      progress,
      remaining: Math.max(0, current - e.target),
      overdue,
      stale: overdue && !done && progress <= 0,
      done,
      dueSoon: !overdue && daysBetween(today, e.due) <= 30,
    }
  })
}

/** 两个 ISO 日期之间的天数（b - a） */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

// ---- 判据 9：README 文档表 == docs/ 实际文件（防文档清单漂移） ----
//
// 为什么需要：2026-09-11 评审实测 README §6 自述「共 11 份」、表格末尾又写「以本表为准（10 份）」，
// 而 docs/ 实有 13 份（DATA_FETCHING.md 与 multiplier-record.md 不在"唯一权威表"里）。
// CI 只检查 `implementation-status.md` 的漂移，**这类清单漂移完全不可见**——而 README §6 正是
// agent 找文档的入口（AGENTS §0「该改哪先查导航文档」）：表里没有的文档 = 事实上不存在。
//
// 口径：README §6 表格里出现的 `docs/*.md` 集合必须与 `ls docs/*.md` **双向相等**；
// 且节标题里的份数自述必须等于实际值（防"加了文档忘了改数字"）。红：漏登记或份数不符。

/** 从 README 的 §6 段落抽出被登记的文档名（basename） */
export function parseDocTable(readmeText) {
  const start = readmeText.indexOf('## 6.')
  if (start < 0) return { files: [], declaredCount: null }
  const rest = readmeText.slice(start)
  const end = rest.indexOf('\n## ', 1)                 // 下一个二级标题
  const section = end > 0 ? rest.slice(0, end) : rest
  const files = [...section.matchAll(/`docs\/([A-Za-z0-9_.-]+\.md)`/g)].map(m => m[1])
  const cm = section.match(/（(\d+) 份/)
  return { files: [...new Set(files)].sort(), declaredCount: cm ? Number(cm[1]) : null }
}

/** 扫 docs/ 实际 .md 文件（basename 排序） */
export function listDocs(root = ROOT) {
  const dir = join(root, 'docs')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(n => n.endsWith('.md')).sort()
}

/** 返回 { missing, extra, declaredCount, actualCount, countMismatch } */
export function auditDocTable(root = ROOT) {
  const readmePath = join(root, 'README.md')
  if (!existsSync(readmePath)) return null
  const { files, declaredCount } = parseDocTable(readFileSync(readmePath, 'utf8'))
  const actual = listDocs(root)
  const declared = new Set(files)
  return {
    missing: actual.filter(f => !declared.has(f)),      // 实际有、表里没登记
    extra: files.filter(f => !actual.includes(f)),      // 表里登记、实际不存在（断链）
    declaredCount,
    actualCount: actual.length,
    countMismatch: declaredCount !== null && declaredCount !== actual.length,
  }
}

// ---- 判据 10：catalog ↔ raw 对账（防「漏加突破加成」这类全库静默数据错误） ----

/**
 * 为什么要有这条（2026-09-12 事故，见 ENGINE_PIPELINE_GUIDE §4 坑 40）：
 * 导入脚本写「base + 突破加成」类字段时只取了 base → 20 个角色的 level60 暴击被落成了
 * 全库通用裸基值 5/50。因为**大家都一样**，肉眼完全看不出来，也不会让任何测试变红
 * （`core/panel#calcBasePanel` 直接读、别处无补偿通道）——是典型的「静默」错误。
 *
 * **只红「可修且零容差」的字段**：规则表里 `patchable: false`（如 atkBase 对照组）或带容差的
 * 条目不进本判据——它们可能长期存在历史噪声或需人工确认，挂红会逼人去改不该改的东西
 * （进而为了变绿而乱改口径）。这类差异靠人工跑 `node scripts/audit-catalog-level60.mjs` 看全量报告。
 *
 * 单一事实源：规则表在 `scripts/lib/level60-rules.mjs`（与审计/修复脚本共用，规则 11）。
 */
export function auditCatalogLevel60(root = ROOT) {
  const catalogPath = join(root, 'public/static/catalog.json')
  const rawDir = join(root, 'data/raw/nanoka_missing/full')
  if (!existsSync(catalogPath) || !existsSync(rawDir)) return null
  let catalog
  try { catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) } catch { return null }

  const agentsById = new Map((catalog.agents ?? []).map((a) => [String(a.id), a]))
  const rules = FIELD_RULES.filter((r) => r.patchable !== false && !r.tolerance)
  const violations = []
  let compared = 0

  for (const file of readdirSync(rawDir).filter((f) => /^\d+\.json$/.test(f)).sort()) {
    const id = file.replace('.json', '')
    const agent = agentsById.get(id)
    if (!agent) continue
    let raw
    try { raw = JSON.parse(readFileSync(join(rawDir, file), 'utf8')) } catch { continue }
    for (const rule of rules) {
      const want = rule.expected(raw)
      if (want === undefined) continue
      compared++
      const got = agent.level60?.[rule.field]
      if (Math.abs(Number(got ?? 0) - Number(want)) > 1e-9) {
        violations.push({ id, name: agent.name?.zhCN ?? '', field: rule.field, got, want })
      }
    }
  }
  return { compared, violations, fieldNames: rules.map((r) => r.field) }
}

// ---- 判据 11：手册数字 id 密度棘轮（任务卡 2026-09-12「经验手册防历史记录化」第 1 步） ----

/**
 * 度量口径（写死在这里，别处不许另算）：**全文**中 `/\b1\d{3}\b/` 命中次数 ÷ 总行数。
 * - 用「次数」不用「含 id 的行数」：编年史行的特征就是把一队 id 打包在同一行
 *   （`auto-1431-1481-1491 +39.4%`），按行数计会被打包稀释，按次数计才对症。
 * - `\b` 边界天然排除 7 位 moveId（1611028）、5 位 prop id（20101/31201）、boss id（4xxxx）。
 * - 分母是**全文行数**：往手册里加纯协议/判据文字（不含 id）会摊薄密度——这正是期望方向，
 *   案例编年史该进 git 历史与 .claude 账本，不该沉淀在手册里（AGENTS 规则 8 分层契约）。
 * 天花板 = 2026-09-12 实测向上取整留余量后冻结。`MECHANICS_IMPLEMENTATION.md` **不在列**：
 * 它是档案（逐角色口径记录，个体性=本职），任务卡实测后明确不动。
 * ⚠ **天花板是防变差的红灯面，不是还款面**（批量拆薄后的反效果实测，2026-09-12）：
 * 四栏拆薄删的是散文（分母）而判据/否决记录按规则 16③ 必须保测量数字（分子），
 * 于是密度**反升** 0.196→0.237——拿密度当还款目标会奖励灌水。还款量化在
 * burn-down 条目「手册 §4 行数」（frozen 1340 → 804（−40%）→ 719（−46%，二轮结算），还款面 = 任务卡主口径「§4 行数 −40%」）。
 *
 * @fact engine:guards/手册密度 口径: 密度 = /\b1\d{3}\b/ 次数 ÷ 行数，四份方法文档按 2026-09-12 实测冻结天花板；编年叙事只进 git/账本，手册只收协议/口径/证据；还款面 = §4 行数（密度只拦变差，拆薄后反升属口径性质） | 据 任务卡@2026-09-12（用户确认方向）·反效果实测@2026-09-12 | 验 src/scripts/__tests__/checkGuards.test.ts | 锚 scripts/check-guards.mjs#MANUAL_DENSITY_CEILINGS | 信 确认
 */
export const MANUAL_DENSITY_CEILINGS = {
  'docs/ENGINE_PIPELINE_GUIDE.md': 0.30,      // 立项实测 0.287；批量拆薄后 0.237（反升，见头注）
  'docs/AGENT_RECORDING_SOP.md': 0.05,        // 实测 0.037
  'docs/GAME_TERM_TO_CODE_FIELD.md': 0.16,    // 实测 0.147
  'docs/MECHANIC_PATTERNS.md': 0.20,          // 实测 0.187
}

/** 计算四份方法文档的数字 id 密度；文件缺失时该条 density = null（不判红，与判据 10 同风格） */
export function scanManualDensity(root = ROOT) {
  const out = {}
  for (const [rel, ceiling] of Object.entries(MANUAL_DENSITY_CEILINGS)) {
    const p = join(root, rel)
    if (!existsSync(p)) { out[rel] = { ceiling, lines: 0, hits: 0, density: null }; continue }
    const text = readFileSync(p, 'utf8')
    const lines = text.split('\n').length
    const hits = (text.match(/\b1\d{3}\b/g) ?? []).length
    out[rel] = { ceiling, lines, hits, density: Math.round((hits / lines) * 1000) / 1000 }
  }
  return out
}

/** ENGINE_PIPELINE_GUIDE §4「常见坑」区（## 4. 至 ## 5.）行数——burn-down「手册 §4 行数」的还款面度量 */
export function countGuideSection4Lines(root = ROOT) {
  const p = join(root, 'docs/ENGINE_PIPELINE_GUIDE.md')
  if (!existsSync(p)) return NaN
  const lines = readFileSync(p, 'utf8').split('\n')
  const s4 = lines.findIndex(l => l.startsWith('## 4.'))
  const s5 = lines.findIndex(l => l.startsWith('## 5.'))
  return s4 >= 0 && s5 > s4 ? s5 - s4 : NaN
}

/**
 * 复核触发器（任务卡「经验手册防历史记录化」第 5 步；**只报不红**，zc drift 点名）：
 * 方法文档里带有效期的结论，就地挂一行——
 *     ⟳复核: <到点要判什么> | 到期 <YYYY-MM-DD>
 * 到期日 ≤ 今天而标记还在 = 这条结论没人复核过，可能已经过期（事件型触发如「正式服上线」
 * 写成预计复核日）。与判据 11 同族：一个拦新增编年史（红），一个防旧结论静默过期（报）。
 * 机制同 drift 的诚实性：复核查实后改写结论并**撤掉标记**（或顺延日期并写明复核人理由），
 * 不许只删日期装没发生。⚠ 自指陷阱：约定说明文字不许写出可解析的示例日期。
 */
export function scanDocReviewTriggers(root = ROOT, today = new Date().toISOString().slice(0, 10)) {
  const rows = []
  for (const rel of Object.keys(MANUAL_DENSITY_CEILINGS)) {
    const p = join(root, rel)
    if (!existsSync(p)) continue
    const lines = readFileSync(p, 'utf8').split('\n')
    lines.forEach((ln, i) => {
      const m = ln.match(/⟳复核[:：]\s*(.+?)\s*[|｜]\s*到期\s*(\d{4}-\d{2}-\d{2})/)
      if (m) rows.push({ file: rel, line: i + 1, due: m[2], overdue: m[2] <= today, text: m[1].trim() })
    })
  }
  return rows
}

/**
 * 代码侧 `@fact` 的复核触发器**逾期**检查（T15 对抗审计 #3 发现、本轮补的盲区）。
 *
 * 为什么需要：判据 15 的 `hasTrigger` **只查「有没有 ⟳复核 + 到期」**，从不比对今天；
 * 而唯一做逾期比对的 `scanDocReviewTriggers` 只遍历 `MANUAL_DENSITY_CEILINGS` 的**4 本方法文档**，
 * 完全不扫 `src/**` 的 `@fact`。⇒ 代码级口径写上「到期 2026-12-31」后，过期了**永远没人被点名**，
 * 而判据 15 的立项缘起正是「effectiveTime 那条口径挂了 14 天才被用户纠正」——没有逾期检查，
 * 触发器就只是**装饰**（挂上那天与过期那天看起来一样）。
 *
 * 口径：**只报不红**（与 scanDocReviewTriggers 同族；红了会逼人改日期作弊——规则 16 的既有教训）。
 * 数据源复用 `scanCaliberTriggers` 的 `withTrigger`（已是「有触发器的游戏语义口径」全集）。
 */
export function scanCaliberTriggerDue(root = ROOT, today = new Date().toISOString().slice(0, 10)) {
  const { withTrigger } = scanCaliberTriggers(root)
  const rows = []
  for (const t of withTrigger) {
    const p = join(root, t.file)
    if (!existsSync(p)) continue
    const lines = readFileSync(p, 'utf8').split('\n')
    // 触发器可能写在同一行尾部，或紧随其后单独一行（与 scanCaliberTriggers 同口径）
    const near = [lines[t.line - 1] ?? '', lines[t.line] ?? ''].join('\n')
    const m = near.match(/⟳复核[:：]\s*([\s\S]*?)[|｜]\s*到期\s*(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    rows.push({
      file: t.file, line: t.line, subject: t.subject, kind: t.kind,
      due: m[2], overdue: m[2] <= today, text: m[1].replace(/\s+/g, ' ').trim(),
    })
  }
  return rows
}

// ---- 判据 2：编排层 agentId 分支棘轮 ----

/**
 * 度量范围 = **`useResourceCalc.ts` + 整个 `resourceCalc/` 目录**（2026-09-12 口径纠正）。
 *
 * 为什么必须扩到目录（本仓库最新的一条护栏教训）：原口径只量 `useResourceCalc.ts` 一个文件，
 * 而评审 #10 把收敛域代码搬进了 `resourceCalc/`（convergence.ts 等）——**特判跟着代码一起搬**，
 * 于是「把分支搬个家」就能让基线下降。实测编排层四文件合计：
 * 86(4c4bf5d~1，53 基线时代) → 86(502af1c，标称已降到 8) → 78(第 27 轮真清偿 8 处后，提交态)。
 * 即标称「-45」实为**净 0**，全是位移。教训：**度量范围必须跟着代码走**，
 * 否则棘轮只会奖励重构、不奖励清偿。
 */
export const AGENT_BRANCH_DIR = 'src/composables/resourceCalc'
/** 单文件入口（也在度量范围内；历史上是唯一度量点） */
export const AGENT_BRANCH_FILE = 'src/composables/useResourceCalc.ts'

/**
 * 编排层被度量的全部文件（入口 + 目录内所有 .ts）。
 *
 * 只扫**目录直属**的 .ts（不递归），故 `resourceCalc/__tests__/` 天然不在内——
 * 棘轮量的是执行域源码，测试文件里的 `agentId === '...'` 是脚手架不是特判。
 * （2026-09-12 勘误：上一版注释写成「__tests__ 不在该目录下」，实际它在，只是被子目录层级跳过；
 *   结论没错但理由是错的，按规则 16 改正——错理由比没理由更危险。）
 */
export function listAgentBranchFiles(root = ROOT) {
  const dir = join(root, AGENT_BRANCH_DIR)
  const files = [AGENT_BRANCH_FILE]
  if (existsSync(dir)) {
    for (const n of readdirSync(dir).sort()) {
      if (!n.endsWith('.ts')) continue
      const p = join(dir, n)
      if (!statSync(p).isFile()) continue      // 显式排除 __tests__/ 等子目录（不递归）
      files.push(`${AGENT_BRANCH_DIR}/${n}`)
    }
  }
  return files
}

/** 编排层 agentId 特判总数（跨全部度量文件；判据与 zc status 共用本函数，不各写一份）
 *
 * ⚠ **2026-09-17 round 19 换尺**：本函数已从旧正则 `/agentId\s*(===|!==)/` 换成
 * AST 检测面（`lib/agent-identity-lines.mjs`）。旧尺系统性漏计 `agent?.id === '1581'` 与
 * `agent.teammateBuffId === 'remielle'` 两种同义形态（实测漏 27 行），且新写的 `.id ===`
 * 特判永远不被拦。换尺依据 = 规则 17②「度量口径纠正不适用棘轮只减不增」+ 17⑥「先分类，
 * 再定计量单位」；旧正则仍以 `countAgentIdBranchLines` 导出，仅供沿革对账/报告脚本引用。
 */
export function countAgentBranchLines(root = ROOT) {
  return countIdentityBranchLinesInFiles(listAgentBranchFiles(root), f => readFileSync(join(root, f), 'utf8'))
}

/** 旧尺（正则 `/agentId\s*(===|!==)/`）：**已不作为棘轮判据**，保留供沿革对账与报告脚本引用。
 *  头部注释与「注释行豁免」说明见 `countAgentIdBranchLines` 本体。 */
export function countAgentBranchLinesLegacy(root = ROOT) {
  return countAgentIdBranchLinesInFiles(listAgentBranchFiles(root), root)
}

/**
 * 2026-08-30 冻结基线：规则 6 生效前的历史存量（按「含 agentId ===/!== 的行数」计）。
 *
 * 沿革（**单文件口径**）：53（2026-08-30 冻结）→ 52(栈轴 1551) → 48(promia) → 39(四反馈块)
 * → 8(runCalcRound 收线刀) → 0(第 27 轮真清偿 8 处，`useResourceCalc.ts` 该文件清零)。
 *
 * ⚠ **2026-09-12 口径纠正（本条最重要）**：上面那串 53→0 是单文件读数，而 #10 把代码搬进了
 * `resourceCalc/`——特判随之外迁，**编排层全量**实测 86→86→79。即 53→8 的「大降」绝大部分是
 * **位移不是清偿**（四笔注因其实都如实写了「随本体进落点」，是度量范围没跟着代码走）。
 * 故度量改为 `listAgentBranchFiles()`（入口 + 目录），frozen 取纠正后**提交态**实测值 **78**。
 * **78 才是编排层真实的 agentId 特判存量**，逐角色迁 `applyTeamConfig`/声明式钩子才是真 burn-down。
 *
 * ⚠ 取数纪律：基线必须量**提交态（HEAD）**，不能量带并行会话 WIP 的工作树——量错会让 CI 在别人提交后假红。
 * 2026-09-12 +1：78→79 = 菲欧妮（1641）脆弱暴伤档位 tier2 的额外能力 buff-id 过滤（SOP §6.2 标准接线，
 * 17 条同类先例的最新一条；收敛方向 = 声明式 buff 级 teamConditions 替代逐条过滤，勿再新增）。
 * 2026-09-13 −14：79→65 = helpers.ts 额外能力门控簇（14 角色 slot 查找 + evalAdditionalAbility 求值 +
 * 17 条逐 buff-id 过滤）收敛为数据驱动表 `ADDITIONAL_GATE_BUFFS` + `evalAdditionalAbilityBuffGates`
 * （SOP §6.2 语义逐位保留；一一对应护栏 `additionalGate.test.ts`）。真 burn-down 的第一簇。
 * 2026-09-15 −9：65→56 = `convergence.ts` cfg-merge 簇（1381/1391/1431/1151/1541/1331/1161/1181/1191）
 * 的跨轮反馈注入从「编排层逐 agentId 分支写 cfg」改为「模块 applyTeamConfig 读 threads 快照写自己
 * 那份 cfg」（规则 6）。契约面 = `AgentTeamConfigInput.threads`（递整份 `CalcRoundThreads` 快照，
 * 不再逐字段铺开——`roundThreads.ts` 头注释写明它本就是这份集合的单一事实源）。
 * 判据 = `timeGolden` 16 键 **0 delta** + `allAgentsSweep`/`timeFillRatchet`/`underfillRefund` 全绿。
 * 2026-09-15 −1：56→55 = 轴内终结技喧响消耗 `agentId === '1551' ? 2000 : 3000` → 读本槽
 * `cfg.ultimateCost`（`specPanelBuffs.ts:174` 早已写 2000）⇒ agentId 判断冗余（同 T6 判据：
 * 字段唯一写入方 = 该角色模块）。解析抽成导出纯函数 `resolveAxisUltimateDecibelCost`，使
 * 「按槽读、不按 agentId 认人」可被单测直接证伪（教训：断言写在**输入**上会假绿，见 peiluo.test.ts 注释）。
 * 2026-09-15 −2：55→53 = `nomra 1571`（normaStunCount/normaStunCoverage/normaBattleTime）与
 * `qingyi 1251`（qingyiStunCount）的失衡次数注入迁进各自模块的 `applyTeamConfig`（converge 阶段）。
 * 判据同 T6：字段消费方**只有本模块**（`config.ts` 声明、模块内读），且 hook 入参已含
 * `stunCount`/`combatTime` ⇒ 不需要在编排层认人。实测：timeGolden 0 delta；
 * 反向验证（停掉 norma 的注入）⇒ `agent:1571:c6.slot0` 时间账精确变化 = 注入是活反馈。
 * 2026-09-15 −4：51→47（同批「模块 source 字段即角色标识」簇，全在 `damagePool.ts`）= 去掉
 * 5 处 `charResult.agentId === '<id>'` 判断，因为同条件的**模块产物字段**已经蕴含角色：
 *   · 悠真 `harumasaStunOnly`（唯一写入方 harumasa.ts，且只在轴模式写）
 *   · 柏妮思 `burniceMechanicSource`（burnice.ts:312）×1、琉音 `liuyinMechanicSource`（liuyin.ts:387）×3
 * 判据同 T6：字段唯一写入方 = 该角色模块 ⇒ 字段存在即蕴含是该角色。timeGolden 0 delta。
 * ⚠ **同批明确保留的**：`damagePool.ts:406` 的 `charResult.agentId === '1171' ? cinema : 0` **不是冗余**——
 * 它限制的是「只有柏妮思才吃自己 C4 的暴击 30%」，`cinema>=4` 对所有角色都成立，去掉会误伤全队。
 * 2026-09-15 −1：52→51 = `damagePool.ts` 的悠真失衡专属直加
 * `charResult.agentId === '1201' && isAxis && exec.harumasaStunOnly !== undefined`
 * → 去掉 agentId 与 isAxis（`harumasaStunOnly` 的唯一写入方 = `harumasa.ts:329` 的 patchExecutions，
 * 且只在 `cycle.axisActive` 时写 ⇒ 字段存在即蕴含「是悠真且轴模式」，判据同 T6）。timeGolden 0 delta。
 * 2026-09-15 −1：53→52 = `peiluo 1551`（peiluoVerdictCount + extraSelfDecibelReward）迁进
 * `specPanelBuffs` 的 `peiluoProminenceMechanic.applyTeamConfig`。⚠ 两处等价性要点：
 * ① `extraSelfDecibelReward` 是**跨角色共享累加通道**（橘福福/蕾米埃尔/orphie 各自 `+=`）⇒ 必须累加不可覆盖；
 * ② `peiluoVerdictCount` **无条件**写（含轴模式，原分支无门控）——加 `axisMode` 门控 = 行为静默改变，
 *    而该路径 `timeGolden` 覆盖不到（实测不红），靠 `teamHook.test.ts` 的 hook 级用例钉住。
 * 2026-09-15 −5：52→47 = `damagePool.ts` 五处「模块 source 字段 ⇒ 角色标识」去冗余（见上方同批注释）。
 * 2026-09-16 −13：47→**34** = `nextRoundFeedback` 钩子（新契约，本批最大单簇）。
 * 2026-09-16 −2：34→**32** = 轴上下文契约 `AgentTeamConfigInput.axis`（round 11 批次 1，设计卡 §3 方案 A）。
 *   迁走 `convergence.ts` 两处轴内块计数分支：1201 悠真（`harumasaAxisSlash`/`harumasaAxisArrow`/
 *   `harumasaAxisActive`，白名单 = 模块自己的 `HARUMASA_SLASH_MOVE_IDS`/`HARUMASA_ARROW_MOVE_ID`）
 *   与 1241 朱鸢（`zhuYuanAxisEther`/`zhuYuanAxisActive`，白名单 = `ZHUYUAN_SUPPRESS_ETHER_MOVE_IDS`）
 *   ⇒ 计数逻辑回模块，**moveId 白名单从编排层硬编码搬回模块常量**（此前两处各写一份、改一处即静默脱钩）。
 *   契约形状：`axis.active/axes/windows/windowSeconds/actionCountsBySlot/ultimateTotalBySlot/chainTotalBySlot`
 *   （**零新通道**：`characters` 本就带 `axisInSeconds`/`axisActionCounts`/`axisUltimateTotal`，本契约只是把
 *   散落在数组元素上的轴态字段收成一份显式快照；派发点唯一 = `convergence.ts` 的 converge 那次调用）。
 *   相位语义：**只在 converge 有值**（build 相位轴还没解析、postRound 相位语义是「为下一轮」）。
 *   ⚠ 门控是**双判据**（`phase !== 'converge' || !axis`）：只判相位时「派发器忘传 axis」会退化成
 *   静默零值——而 `timeGolden` 对本簇**全盲**（105 预设里 1201/1241 的轴覆盖各 **0 队**；
 *   实测 1241 删掉原分支 `npm run check` 与 `timeGolden` 双双全绿）⇒ 本批新建
 *   `src/mechanics/__tests__/axisContext.test.ts`（11 例）把三跳分别钉死（模块消费 / 派发器透传 / 真管线相位）。
 *   反向验证 6 组，逐组精确红、跑完即还原并 md5 自证：①converge 不传 axis ⇒ 3 例红（axisContext）
 *   +`harumasa.test.ts` 1 例红；②1201 模块短路读 axis ⇒ `harumasa.test.ts`「轴模式失衡专属 buff 行级直加」红；
 *   ③1241 模块短路读 axis ⇒ `zhuYuan.test.ts` **16 passed 不红**（实证该角色零覆盖、正是本批要补的洞）
 *   而 axisContext 3 例红；④postRound 也传 axis ⇒ 相位用例红；⑤派发器丢 axis ⇒ 4 例红；⑥白名单污染 ⇒ 计数用例红。
 *   `timeGolden` 3 passed 且 `grep -c "dmg:"` == **0**。
 *
 * `convergence.ts` 原有 5 个导出纯函数 `compute{Promia,Anby,Lucy,Vivian,Ellen}NextRoundFeedback`
 * （普罗米娅 1541 / 零号·安比 1381 / 露西 1151 / 薇薇安 1331 / 艾莲 1191），每个都在自己函数体里
 * `characters.some(c => c.agentId === '<id>')` 认人 + 逐处 `filter/find(c => c.agentId …)` 排除自身，
 * 共 **13 处** agentId 判断（= 本批降幅）。现整体迁进各角色模块的 `nextRoundFeedback` 钩子。
 *
 * 契约面（照 `crossAgentSupply`（`27918d1`）/ `threads` 快照的既有范式，未另起设计）：
 * `AgentMechanicModule.nextRoundFeedback?(input: AgentNextRoundFeedbackInput)`，入参递**整份本轮结果**
 * （`teamResult` + `displayResult` + `adjustedResult` + `anomalyPool` + `prevThreads` 快照 + `combatTime`
 * + `getAgentSkills`）**与 `cfg`**（模块自己那份，**可写**）；返回 = 本模块的下一轮线程值
 * （`Partial<CalcRoundThreads>`），由编排层 merge 进 `threadsNext`（单一 owner，模块不写 threads）。
 * 派发器 = `collectNextRoundFeedback`（`composables/resourceCalc/helpers.ts`，槽位序 0→1→2、零 agentId）。
 *
 * ⚠ 三条实测纪律（抄本范式前必读）：
 * ① **首轮守卫语义各不相同，逐位保留**：普罗米娅/薇薇安/艾莲 = `prevThreads.<字段> <= 0` 才写回 cfg；
 *    **露西 = 每轮无条件写**（消费端 `crossAgentSupply.perTargetAmounts` 读的就是本轮估计值）。
 *    统一成一种写法 = 静默改行为（单测 `nextRoundFeedback.test.ts` 两种都有断言）。
 * ② **`timeGolden` 对本簇部分站点是盲的**（交接文档纪律 4 的实证）：逐个摘掉模块注册表里的钩子后跑
 *    `timeGolden`，普罗米娅(−7.4%…−13.4%) / 零号·安比 / 薇薇安(−25.8%…−42.3%) / 艾莲(`agent:1191:c6`) 变红，
 *    但 **露西全绿**——它唯一的预设 `auto-1041-1571-1151` 是 0 命，而露西反馈只在 C1/C6 生效。
 *    ⇒ 本批另加 hook 级单测 `src/mechanics/__tests__/nextRoundFeedback.test.ts`（20 例），
 *    其中两条**管线级**用例专补盲区（露西 C6：`crossAgent.lucyEnergy` 58 vs 摘钩子 30；
 *    艾莲影画4：`ellen_cycle.c4EnergyTotal` 16 vs 摘钩子 0）。
 * ③ **不要用 `characters[slot]` 取自己那份 cfg**：`characters` 是**按位置压缩**的数组
 *    （`buildCharConfig` 跳过空槽），槽位号 ≠ 下标；前导空槽时 `characters[slot]` 是 `undefined`
 *    （2026-09-16 实测：`['', 1041, 1191]` 下艾莲影画4 冻结数 4→0 静默失效）。
 *    故 `AgentNextRoundFeedbackInput` 显式给 `cfg`。⚠ 存量另有 19 处 `characters[slot]`
 *    （`applyTeamConfig` 等，含 `7e377cb` 引入的那批）有同一缺陷，属**既存问题、本批未动**。
 *
 * **32 → 29 沿革（2026-09-16 round 12 批次 2，设计卡 §5 批次 2 + 可选第三处）**：`convergence.ts` 的
 * `characters.map` 里再迁走三个 `merged.agentId === '…'` 分支，均改读 `AgentTeamConfigInput` 的
 * 既有契约（`axis` / `threads`，round 11 落地的整份快照，零新通道）：
 *  · **1531 星徽·比利** → `starlightBilly.ts#applyBillyTeamConfig`：`billyAxisEx`（轴内捏块，
 *    含 **combo 展开**——轴块命中 `combos['billy-ex-chain']` 时展开成 动力压制/孤轮/摇曳 三子招式
 *    各 `count × mv.count × wins`；整块只记一次会少一个量级）+ `billyAxisActive` + `billyStunCoverage`
 *    （后者 = 派发器对所有角色通用注入的 `teamStunCoverage`，与旧 `provStunCoverage` 同源同值）。
 *    ⚠ 未顺手删 `core/resource.ts:523`——core 侧已明确记载试过改字段判据并**否决**（见
 *    `CORE_AGENT_BRANCH_BASELINE` 沿革）。
 *  · **1591 希格莉德** → `sigrid.ts#applySigridTeamConfig`：`sigridAxisPozhenSets`（`sigrid-pozhen`
 *    块 × 窗口数 + C6 的 gift 连携块）+ `sigridAxisActive`；**非 C6 前封顶 = Σ`axis.windows`**
 *    （= 已分配窗口总数，**不是 `windows.length`**——多轴且某轴 0 窗时后者会高估）。
 *  · **1511 南宫羽** → `nangong.ts#buildNangongTeamConfig`（**可选第三处**）：`nangongQuickAssistPlaced`
 *    （轴内**单** moveId `1511013` 块 × 窗口数，走 `axis`）**+** `inStunWindowTriggers`（走 `threads`
 *    ——它是上一轮「失衡内异常 v2 平均每窗触发数」的**线程值副本**，原实现读的 `prevInStunWindowTriggers`
 *    与 `threads.inStunWindowTriggers` 是同一对象同一字段）。⚠ 两条路刻意分开：**读线程**与**写 cfg**
 *    是两个不同动作，混成一条会把「为下一轮」的语义写进本轮 cfg。
 *  · **1141 莱卡恩（棘轮 −0，分支仍在）**：只迁走 `lycaonWindowDuration` ← `axis.windowSeconds`
 *    （= 同一个 `computeWindowDuration()` 返回值）。⚠ 任务卡预期「契约已解锁 2 字段 ⇒ 1141 −1」
 *    **实测不成立**：`lycaonC2Energy` 的非轴臂需 `countStun`（C7 计数投影版失衡次数，
 *    `projectStunPlanForCounts(stunCount, base.stunPlanProjection)`），而该全局量**不在契约上、
 *    也不是注册的 `MechanicSetting`**（`grep -rn stunPlanProjection src/mechanics/ src/specs/` = 0 命中）
 *    ⇒ 用未投影的 `stunCount` 迁移是静默改语义（难度阶梯 G4「取整」会打开该开关）。故 1141 分支保留。
 * 测试：`src/mechanics/__tests__/axisContext.test.ts` 自 11 例扩到 **24 例**（combo 展开逐键精确值 /
 * Σwindows 封顶与 `windows.length` 的可分辨反例 / C6 gift 门槛 / windowSeconds 取值 + C2 不得由钩子写 /
 * 1511 双路分离 / ★1141 端到端精确值 `21.2465` vs 短路回落 `?? 16` 的 `24`），全精确值、不用 `> 0`。
 * 验收：`timeGolden` `grep -c "dmg:"` == **0**；`check-guards` 17/17；反向验证 6 组逐处精确红（见提交说明）。
 *
 * **29 → 27 沿革（2026-09-16 round 13 批次 3，设计卡 §5 批次 3）**：`convergence.ts` 再迁走两处中的一处，
 * 外加一处**死写**删除（净 −2）：
 *  · **1051 伊德海莉** → `yidhari.ts#applyYidhariTeamConfig`：`yidhariStunCount` ← `stunCount`
 *    （**轴无关**，轴/非轴恒写）+ `yidhariInStunExCount` / `yidhariInStunEnergyCost` ← `axis`
 *    （轴内连段反推：`yidhari-heavy-single` = 1 重碾/50-60 闪能、`yidhari-heavy-double` = 2 重碾/85，
 *    各 × 块数 × 窗口数）。⚠ **头号风险是「条件写」形态**：这两个字段只在 `axis.active && 合计>0`
 *    时写（≠ 恒写 0）——`core/resource/helpers.ts#resolveExSpecialCount` 用 `!== undefined`
 *    选通路（有 = 失衡内次数已知、按 `(总闪能−失衡内成本)/消耗` 反推非失衡；缺 = 纯能量预算口径）。
 *    ⚠ 成本档读的是**槽 0** 命座（原实现逐字 `configStore.team[0]?.cinemaLevel`，非本槽），
 *    此处逐位保留；轴预设把 1051 钉在槽 0（`1章-琉`/`1章其他` 的 `team[0]==='1051'`，
 *    且全部章鱼轴块 `slot` 实测恒 0）⇒ 全部可命中路径同值。
 *  · **死写删除 −1**：`convergence.ts` 的 `if (prevInStunWindowTriggers <= 0) { … c.agentId === '1511' … }`
 *    写回块（round 12 复核「确为死写但超授权面」，本批授权处置）。判死用**静态**证据（死写不可能有
 *    测试变红）：`characters` 是该轮 `base.characters.map` 的局部克隆，该写入点之后**零引用**，
 *    其间唯一闭包 `inAxisFractionProvider` 只捕获 `rr.characters` 且调用点在写入之前
 *    ⇒ 写入一个此后无人读的对象。同时删掉因此变为未使用的解构 `prevInStunWindowTriggers`
 *    （`vue-tsc` TS6133 抓出）。1511 的真实消费路 = 模块读 `threads`（批次 2 已迁）。
 *  · **1371 仪玄 —— 未迁，分支保留**：证伪闸门**已触发**（见下），棘轮 −0。
 *
 * ⚠ **1371 的证伪闸门已触发（本批最重要的实测结论，是「需扩契约」的有效结论、不是失败）**：
 * 按设计卡 §6 剥掉引擎侧 1371 分支、把 8 个字段搬进模块 `applyTeamConfig` 后跑 `yixuanSmoke.test.ts`
 * ⇒ **9 failed / 4 passed**（超出卡里点名的 3 条）。逐输入受控两臂实验证明缺口**只有一个**：
 * `yixuanExtremeAssistCap` 的原实现读 `configStore.team` 的**未缩放、未跑 parrySplit** 的队友弹刀和，
 * 而契约可见的 `characters` 上那份已被 `interactionScale` 缩放、被 parrySplit 改写。实测差距
 * （全 6 个 1371 预设）：无 boss 时 3/6 队分化（`yixuan-roxy-lucia` storeΣ=6 vs mergedΣ=2、
 * `auto-1371-1481-1451` 6 vs 4、`auto-1371-1571-1451` 6 vs 5——三队都开了降配 `interactionScale`）；
 * 带叶释渊预设（parryTotal=13）时 5/6 队分化（mergedΣ 变 13/9，storeΣ 恒 6）。**臂 B 实验**
 * （把 store 口径和经 axis 递进去、其余 7 字段照搬模块）⇒ `yixuanSmoke` **13 passed 全绿**，证明：
 * （a）其余 7 个字段的迁移逐位等价；（b）唯一缺口 = 「**未缩放交互次数**」，正是 `OPEN-ITEMS.md`
 * §2 T5 已登记的契约缺口（与 1141 的 `lycaonBackstageDodgeCount` **同一个**缺口）。⇒ 保留分支、如实挂账。
 * 测试：`axisContext.test.ts` 自 24 例扩到 **29 例**（1051 五例：单/双次碾逐位精确值、1 命成本档、
 * 多轴窗口对齐、★条件写形态（合计 0 / 轴退化 / 缺 axis 三种都不写，且 stunCount 照写）、相位门控）。
 * 反向验证 4 组（全精确红）：① 模块短路 axis ⇒ 3 例红；② 恒写（丢条件形态）⇒ 1 例红；
 * ③ 丢 1 命成本档 ⇒ 1 例红；④ 派发点不传 axis ⇒ 4 例红。
 * ⚠ `timeGolden` 对本处**结构性盲**（实测）：7 个含 1051 的预设全是 0 命 ⇒ 命中 chapter-0 轴预设
 * （`0章-琉`/`0章其他`），其中章鱼招式以**裸 id**（`1051011`/`1051012`）表达、**没有** combo 键
 * ⇒ 连段反推恒 0（迁移前后都只写 `yidhariStunCount`）。带 `yidhari-heavy-*` 的 `1章-*` 预设只在
 * 1051 **≥1 命**时命中。故本处判据只能由 `axisContext.test.ts` 承担（`grep -c "dmg:"` 实测 == 0）。
 *
 * ── 2026-09-16 round 14 批次 4：27 → **25**（−2）────────────────────────────────
 * **补「未缩放交互次数」契约 ⇒ 迁 1371 仪玄整条分支（−2）+ 顺收 1141 的 `lycaonBackstageDodgeCount`（−0）**。
 *
 * · **新契约 `AgentTeamConfigInput.interactions`**（`AgentInteractionContext`：`bySlot` 按槽位键控的
 *   `{ agentId, parryCount, blockCount, dodgeCounterCount, dualCounterCount, quickAssistCount }` 快照）。
 *   存在的理由（本轮实测）：契约里 `characters` 那份 cfg 的交互次数**已被改过两道**——
 *   ① `interactionScale`（非轴降配）`Math.round(x × scale)`；② `parrySplit`（保底4失衡反推）**改写**
 *   击破位/主C 的 `parryCount`。而两个原实现读的都是 **`configStore.team` 原值**：
 *   · 仪玄 `yixuanExtremeAssistCap`（Σ队友弹刀）——round 13 受控两臂实验已证：用合并值 ⇒ `yixuanSmoke`
 *     **9 failed**；按 store 口径递入 ⇒ **13 passed**；
 *   · 莱卡恩 `lycaonBackstageDodgeCount`（Σ队友闪反）——同族缺口（round 12 已挂账）。
 *   ⇒ 一次契约扩展解锁两处。**只读 + 只在 converge 相位有值 + 派发器不做 `?? {}` 兜底 +
 *   模块侧双判据门控**（`phase !== 'converge'` 早退 + `!interactions` 时不写依赖字段）。
 *
 * · **`convergence.ts` 的 `merged.agentId === '1371'` 整条分支删除**——8 个字段全部迁进
 *   `yixuan.ts#applyYixuanTeamConfig`，分五个通道（逐字段口径与三处「逐位保留」形态钉在模块注释）：
 *   ① 轴内量（`yixuanAxisEx` / `yixuanAxisCloudSeconds` 的 `duration ?? 2` 加权 + **无权重写 2** /
 *      `yixuanAxisActive` 恒写含 false）走 `axis`；
 *   ② `yixuanC1LightningCount` 走**算出来的** `axisInSeconds > 0`（= `Σ windows × windowSeconds`，
 *      **不是** `axis.active`——`forceNoAxis` 退化时两者不同值）⇒ 轴/非轴**两臂**都保留；
 *   ③ 线程量（`yixuanAnomalyTriggerFlash` ← `min(18, max(0, floor(auricInkFlash)))`）走 `threads`；
 *   ④ `extraSelfDecibelReward` 的橘福福项（`+=` `prevFuFa × 300`）走 `threads` + **按身份** `characters.some`；
 *   ⑤ 缺口量 `yixuanExtremeAssistCap` + 参与求和极的 `yixuanFlashBonus`（`+=`）走 `interactions`。
 *   ⚠ **−2 不是 −1**：该分支含**两行**被计数（`merged.agentId === '1371'` 与其中的
 *   `c.agentId === '1391'` 橘福福判据）——后者随迁移改成模块内的 `JUFUFU_AGENT_ID` 常量比较，
 *   编排层不再有该特判。
 *
 * · **1141 分支仍存在（−0）**：`lycaonBackstageDodgeCount` 已迁（走同一 `interactions` 契约，
 *   过滤口径**刻意不同**：带 `agentId` 判据 ⇒ 排除空槽残留计数；仪玄那条只看槽位号），
 *   但 `lycaonC2Energy` 仍缺 C7 计数投影量（`countStun = projectStunPlanForCounts(stunCount,
 *   stunPlanProjection)`，模块读不到 `stunPlanProjection`）⇒ 保留分支，如实挂账。
 *
 * · **core 保持 6**：本批未触碰 `src/core/**`（契约扩展是编排层加法），core 棘轮零变化。
 *
 * **反向验证 6 组（全精确红，逐组还原 + md5 自证）**：
 *   ① 派发点 `bySlot` 恒空（契约在但数据空）⇒ `axisContext` 2 例 + `yixuanSmoke` **3 例**红
 *      （含端到端「极限支援落雷次数」与 1141 那条端到端）；
 *   ② 模块短路 `axis` 通道 ⇒ `axisContext` 5 例 + `yixuanSmoke` **2 例**红（4 失衡轴 3+1 / 轴内凝云时长）；
 *   ③ 模块短路 `threads` 通道 ⇒ 2 例红（玄墨线程值 + 独立门控）；
 *   ④ `yixuanFlashBonus` 的 `+=` 改成覆盖 ⇒ 6 例红（含 `expected 105 to be 175`）；
 *   ⑤ 模块短路 `interactions` 通道 ⇒ `axisContext` 3 例 + `lycaonSmoke` **1 例**红；
 *   ⑥ **数据源换成 `characters`**（已缩放/已 parrySplit 改写——即本轮要修的缺口本身）⇒
 *      `yixuanSmoke` 精确 1 例红（`expected 8 to be 9`）⇒ 证明「必须读 store」不是猜测。
 *
 * 判据面：`axisContext.test.ts` **29 → 48 例**（+19：1371 的 8 字段逐条 + 三通道独立门控 +
 * 1141 两条 + 派发器跳②两条 + 真管线跳①端到端一条）；`timeGolden` `grep -c "dmg:"` 实测 **== 0**；
 * `yixuanSmoke` **13 passed**（本轮证伪闸门）；`npm run check` **2471 passed**。
 *
 * **25 → 23 沿革（2026-09-16 round 15 R15-a：`damagePool.ts` 分诊切批第一批，零新契约）**：
 * round 14 的只读分诊（`~/.dsh/session-manager/reports/R14-triage-damagePool.md`，11 处逐处清单 +
 * 分 6 组 + 四批切分）判定本文件 11 处**不同形**，并给出「先做零契约批」的建议。本批照做两处：
 *  · **:408 柏妮思影画4/6** → `burnice.ts#patchBurniceExecutions`（该模块**新增**钩子）。
 *    原判据 `charResult.agentId === '1171' ? configStore.team[slot]?.cinemaLevel ?? 0 : 0` 后跟两条：
 *    C4 → `category ∈ {special, assist}` 的行 `critRateBonus += 30`；C6 → `1171012`/`1171013`
 *    各 `resIgnore += 25`。**通道不变**（damagePool 本来就在读 `exec.critRateBonus`/`exec.resIgnore`
 *    再 `?? 0` 透传，:409/:412 是这两条的唯一消费者）⇒ 搬进模块 = 值逐位不变（`timeGolden`
 *    `grep -c "dmg:"` 实测 **== 0**）。命座改读模块自己那份 cfg 的 `burniceCinemaLevel`
 *    （`buildCharConfig` 无条件写，模块内先例 4 处）——正是本批要消灭的「编排层替角色认人」。
 *    ⚠ 顺带把 `buildExecutions` / `buildAnomalyEvents` 里**各写一份**的 15 行 `computeBurniceMechanic`
 *    入参收成 `burniceMechanicSourceOf(cfg, state)` 单一入口（两份逐字相同，漂移风险）。
 *  · **:970 般岳影画6 摧岳附伤** → 改为读**倾山行上的模块标记** `banyueC6CrushAttach`（= 附伤倍率，
 *    唯一写入方 = `banyue.ts#patchBanyueExecutions`，**仅 C6** 写自己的 `MOVE.qingShan` 行）
 *    ⇒ 字段存在即蕴含「是般岳且 C6」（T6 判据，与本文件 `burniceMechanicSource`/`liuyinMechanicSource`
 *    同族）。**刻意不改成模块直接产执行行**：这条附伤是倾山的自动触发事件，不占前台时间、不进资源
 *    账本、不产资源利用率行——push 成执行行会连带改时间预算/失衡/积蓄三本账（原注释即此意）。
 *    **刻意不改成读 `banyueRageCycle.rageCount`**：那份是**截断前**的循环次数，而本处口径是
 *    截断后的倾山行 `count`（原 `executions.find('1471009').count` 读的就是同一行）⇒ 换源 = 静默改语义。
 *
 * · **判据面（本批新增）**：`src/composables/__tests__/damagePoolBatchR15a.test.ts`（**13 例**，
 *   全部精确值）——跳③模块钩子四条行级分支（C0 不伪造 / C4 三态 / C6 精确到 moveId / `+=` 累加）
 *   + 跳①真管线（C0·C4·C6 三档命座、般岳 C5 vs C6、附伤次数 == 倾山次数）+ **正控与反锁成对**
 *   （「般岳 C6 有标记」与「非 1171/1471 队零泄漏」）。新增本文件的理由：迁走后这两处
 *   **没有任何既有测试**能区分「迁移成功」与「静默失效」。
 * · **反向验证 5 组（全精确红，逐组还原 + `md5sum -c` 自证）**：
 *   ① C4 臂短路 ⇒ 5 例红（`expected [undefined,…] to deeply equal [30,30,…]` 等）；
 *   ② C6 臂只留 `1171012`（删 `1171013`）⇒ 2 例红（`expected [25,undefined,…] to equal [25,25,…]`）
 *      ——证明「精确到 moveId」这条断言真的在锁 1171013，`> 0` 型断言会漏；
 *   ③ 般岳标记不写 ⇒ 3 例红（`expected undefined to be 600`）；
 *   ④ 标记值硬编码 999 ⇒ 2 例红（`expected 999 to be 600`）——证明消费端真的读标记值；
 *   ⑤ damagePool 消费块短路（标记在但没人消费）⇒ 1 例红（附伤行整行消失）。
 * · **剩余分布（R15-a 后）**：`damagePool.ts` **11 → 9** · `convergence.ts` 10 · `helpers.ts` 4。
 *
 * ── 2026-09-16 round 16 **R15-b（−3，编排 23 → 20）**：`axisWindowOverlays` 契约扩容 ──────────
 * 迁走 `damagePool.ts` 三处 `charResult.agentId` 判据，落到模块自己的 `axisWindowOverlays` 钩子：
 *  · **:441 般岳明王**（原 `=== '1471' && (execPanel?.additionalAbilityActive ?? 0) > 0 && cinemaLevel < 6`，
 *    内层 `if (isAxis) 扫描层数 / else 覆盖率折算`）→ `banyue.ts#axisWindowOverlays`。
 *    轴臂仍给 `banyueMingwangStacks`（**层数**，消费端 ×`MINGWANG_BASE_PER_STACK`）；非轴臂给
 *    **标量** `banyueMingwangPct = 5 × 3 × cov` —— ⚠ 折算结果**不是层数**，塞进桶会让消费端再乘一次每层 5%。
 *  · **:455 可琳扫除帮手**（原 `=== '1061' && aaActive > 0`，内层 `if (isAxis) … else …`）→ `corin.ts`。
 *    非轴臂给标量 `corinStunBonusPct = CORIN_ADDITIONAL_DMG × cov`。**刻意不复用桶**：桶值恒
 *    `CORIN_ADDITIONAL_DMG`(35) 是模块与 `types.ts` 双重文档化、且 `teamHookMigration.test.ts`
 *    **精确断言**的不变量（`get('basic_attack') === 35`），写 `35×cov` 会让它失真。
 *    轴臂的**段级**门控 `stunOverride > 0`（轴外段敌人未失衡）留在伤害池——它与角色判据无关。
 *  · **:466 希格莉德浸染**（原 `=== '1591' && aaActive > 0`，**`isAxis` 不出现** ⇒ 与轴模式无关）
 *    → `sigrid.ts`，整支迁走，走新契约的 `windInfectionRate`。
 *
 * **契约面（本批的核心改动）**：`AgentAxisOverlayInput` 补 4 个字段 —— `isAxis`（真轴模式布尔）/
 * `additionalAbilityActive` / `windInfectionRate` / `settings`；`AgentAxisOverlays` 新增
 * `scalarBySlot: Map<number, AxisScalarOverlays>`。
 *  · ⚠ **`isAxis` 不能等价成 `axes.length > 0`**：`forceNoAxis` 轴退化时对外 `resolvedAxes` 被清空
 *    为 `[]`（`convergence.ts:1422`），而 `effectiveStunAxes` 回落到 `configStore.stunAxes`
 *    （用户手动轴，**可能非空**）⇒ 存在第三态「`axes` 非空但 `isAxis === false`」。故递的是
 *    **伤害池 `:101` 那个表达式本身**（`(configStore.useStunAxis || autoActive) && stunAxisResult`）。
 *  · ⚠ **派发器的 `if (axes.length === 0) return out` 已删**：留任一个早退（派发器那行、或模块内的
 *    `if (axes.length === 0) return null`）都会让非轴折算臂**物理不可达**（钩子根本不被调用）——
 *    那正是 R14/R15 分诊反复点名的「契约缺口」。现由各模块按 `isAxis` 自己分臂。
 *  · ⚠ **标量表必须按槽位键控**：四个既有桶只靠「moveId 全局唯一」避免串味（`corinStunBonusMap`
 *    里只有 1061 的键，别人查不到自己），而标量对**全角色全部行同值**、没有 moveId 可索引 ⇒
 *    合并成裸标量会把本角色的增伤**泄漏给队友行**（`damagePoolAdditionalAbilityGate.test.ts`
 *    的反锁就是拦这个）。
 *
 * **⚠ 实测纠正 R15 分诊一处前提（这就是本批最有价值的产出）**：分诊 §2.2 建议 `:466` 用
 * `cfg.panel.windInfectionRate`，并自标「静态可达，**未实测**」。round 16 探针实测：
 * `cfg.panel.windInfectionRate === undefined` **且** `computePanel().windInfectionRate === undefined`
 * —— 该字段**不是** `computePanelPhases` 的产物（那里只写 `infectionZoneBonus`，见 `helpers.ts:885` 附近），
 * 只由编排层 `damagePanels` computed 盖章（`useResourceCalc.ts:508`）⇒ **走 cfg 是断路**，
 * 浸染增伤会静默恒 0（无测试会红）。故契约递的是**盖章后**的值。
 *
 * **⚠ `:484` 仪玄凝神未迁（−0，刻意留分支）**：它本是**三臂**（C6 / 非C6轴 / 非C6非轴），
 * 迁移前实测发现一处**默认值分裂**——注册 default `yixuan.ningshenCoverage = 0`
 * （`yixuan.ts` settings 表）vs 伤害池原式 fallback **0.5**（`:502`）。`resolveMechanicSettings`
 * 恒以**注册 default 铺满**（`helpers.ts:239-247`）⇒ 模块侧读 `settings` 会拿到 **0**，
 * 而现网行为是 **0.5** ⇒ 迁移会把非轴凝神暴伤从 `round(40×0.5)=20` 静默改成 **0**。
 * 这是**产品级口径**（哪份默认值对）⇒ 按任务卡「需要改产品级口径就停下来找人」保留分支，
 * 挂到 round 17 裁决。**没有实测就不要按分诊的「三臂可迁」直接搬**——分诊只做了静态分析。
 *
 * · **判据面**：`teamHookMigration.test.ts` 的轴窗口覆盖段 **10 → 13 例**（补三条非轴折算臂 +
 *   希格莉德浸染 + 门控边界，全**精确值**）；既有 `banyue.test.ts`(54) / `corin.test.ts`(20) /
 *   `sigrid.test.ts`(27) / `damagePoolAdditionalAbilityGate.test.ts`(4) **未改一行即全绿**
 *   —— 这是「迁移逐位等价」最强的证据（它们走真管线读 note 精确串）。
 * · **反向验证 6 组（全精确红，逐组还原 + `md5sum -c` 自证）**：见下批报告。
 * · **剩余分布（R15-b 后）**：`damagePool.ts` **9 → 6** · `convergence.ts` 10 · `helpers.ts` 4。
 *   下一批候选：R15-c（行级 `stunOverride` 自报 ⇒ `:558`/`:561`，−2；⚠ 那两处 `isAxis` 口径**不对称**，
 *   必须逐位保留）· R15-d（`enemy.stunVuln` 快照 ⇒ `:155`，−1）· 1141 收尾（C7 计数投影 ⇒ −1）·
 *   `:484` 仪玄（**先裁决默认值分裂**，再迁，−1）。
 *
 * ── 2026-09-16 round 17 **R15-c（−2，编排 20 → 18）**：行级 `stunOverride` 自报契约 ─────────────
 * 迁走 `damagePool.ts` 兜底臂里的两条 `charResult.agentId` 判据（`:567`/`:570`），
 * 落到新的声明式钩子 `AgentMechanicModule.stunOverrideForMove`（入参 `AgentStunOverrideInput`：
 * `slot` / `moveId` / `isAxis`；返回 `AgentStunOverride { stunOverride, note }` 或 `null` = 不认领）。
 *
 *  · **为什么单列一条契约**：那两处否决的是**同一件事**（本行吃多少失衡易伤），
 *    而这正是角色自己的战斗口径；写死在伤害池里每加一个角色都要再改编排层（规则 6 要消灭的形状）。
 *  · ⚠ **两处的 `isAxis` 口径刻意不对称，逐位保留**（R14 分诊 §4.1）：叶瞬光 `:567` **没有**
 *    `!isAxis` 项、雨果 `:570` **有**。因为轴内分段链是 `else if (isAxis && axisSlots.has(slot))`，
 *    而 `axisSlots.has(slot)` 在「轴模式下本槽没进轴」时为假 ⇒ **兜底臂在轴模式下也会被问到**
 *    ⇒ 叶瞬光的关键招在轴模式下仍吃满、雨果的关键招则落全局覆盖率。**统一两者 = 静默改行为**。
 *  · ⚠ **`stunOverride: 0` ≠ 「不认领」**：前者 = 明确「不吃易伤」（雨果非白名单招），
 *    后者 = 回落全局覆盖率。把 0 折成 null 会让雨果的非白名单行静默吃上覆盖率
 *    （`damagePoolBatchR17c.test.ts` 以「强特起手精确 1 vs 队友行覆盖率 1.2916…」成对钉住）。
 *  · ⚠ `:567` 的 `isAxis` 项虽恒为 false，但**整支不是死的**——同一条 `else if` 的分支前提
 *    （`axisSlots.has(slot)` 为假）可达（R14 分诊 §4.1）⇒ 不许按「恒 false ⇒ 死代码」删。
 *  · 未使用 import 已清：`YESHUGUANG_FULL_STUN_MOVES` / `HUGO_FULL_STUN_MOVES`
 *    （`veilStunMultiplier` 仍被帷幕封顶路径使用，保留）。
 *
 * · **判据面**：新增 `damagePoolBatchR17c.test.ts` **14 例全精确值**（跳③钩子级 6 例 +
 *   跳①真管线 6 例 + **跳②口径不对称管线级 2 例**），两条新手法：
 *   ① **成对对照**（同一 moveId 在白名单内/外必须给出**不同**的 `stunMult`：1.5 vs 1.15 / 1.2333…，
 *   使「短路后恰好落回同一个数」的数值巧合无法伪装）；
 *   ② **跨槽泄漏反锁**（队友行不得出现本角色 note）。
 *   既有 `yeshuguang.test.ts`(25) / `hugo.test.ts`(18) / `hugoVerdictLanding`(1) /
 *   `hugoStunVulnMatrixProbe`(1) / `nonAxisStunVulnProbe`(1) / `damagePoolAdditionalAbilityGate`(4)
 *   **未改一行即全绿** ⇒ 迁移逐位等价的强证据。
 * · **逐位等价实验（本批最强证据）**：把 HEAD 的四份源码换回工作区跑 60 态指纹对拍
 *   （10 队 × {非轴, 0命轴, 轴但槽0未进轴} × {C0, C6}；指纹 = `id|slot|agentId|moveId|stunMult|count|totalDamage|note`
 *   的 sha256）⇒ **60/60 完全一致**，随后 `md5sum` 自证还原。
 * · **剩余分布（R15-c 后）**：`damagePool.ts` **6 → 4**（`:162` 帷幕封顶 / `:412` 琉音强特 /
 *   `:494` 仪玄凝神 / `:508` 佩洛伊斯阳炎）· `convergence.ts` 10 · `helpers.ts` 4。
 * · **R15-d（2026-09-17 round 18，−1）**：`damagePool.ts:162` 叶瞬光「帷幕易伤封顶」的
 *   `row.agentId === '1431'` 判据删除。**依据 = T6 判据**：该分支的两项判据字段
 *   `yeshuguangStunCapMult`（身份）+ 新增 `yeshuguangVeilStunBase`（基数）的**唯一写入方
 *   都是 `yeshuguang.ts#applyPanel`**——本批把面板阶段硬编码块（`helpers.ts` 的
 *   `if (agent.id === '1431')`）一并迁进模块，让「唯一写入方 = 该角色模块」**真正成立**，
 *   而不是停在编排层的 `agent.id` 判据上。**三项门控逐位保留**：① 身份判据（
 *   `yeshuguangStunCapMult` 非 0；非本角色 `emptyPanel()` 恒 0）；② `stunForThis > 0`
 *   （「轴外段不吃帷幕封顶」的**必要**门控，R14 分诊 §4.2 实测，**不是冗余**——依赖行级
 *   `stunOverride`，面板阶段拿不到 ⇒ 刻意留在伤害池）；③ `stunDmgMultiplierBonusCapAlways`
 *   全仓零写入（R14 §4.3）⇒ 算式里原样保留但**不搬**。
 *   契约 = `AgentPanelInput.enemyStunVuln`（`configStore.enemy.stunVuln` 的**面板阶段**
 *   只读快照）。⚠ **刻意不走** R14 分诊建议的 `AgentTeamConfigInput.enemy`：`applyTeamMechanics`
 *   是 **cfg 写入**钩子（build/converge/postRound），而本处消费点在 `computePanelPhases`
 *   （面板阶段）与 `pushDirect`（行构建）之间 —— cfg 快照够不着；面板阶段的 `applyPanel`
 *   是唯一同时看得见「本槽 panel 的 bonus 三项」与「boss 基础易伤」的落点。
 *   **没有**给 `AgentTeamConfigInput` 加任何字段。
 *   实测：`check-guards` **17/17**（17/17，core 6/6）；新判据 `damagePoolBatchR18d.test.ts`
 *   **15 例**（跳③算式 3 + 跳③盖章 4 + 跳①真管线 4 + 跳②门控 4）；**成对对照**手法 = 把
 *   boss 易伤推到 2.5/3.5 让封顶真咬合（⚠ 默认 1.5 下帷幕基数**恰等于**回落值 ⇒ 短路后
 *   落回同一个数，不断言不出来）；**逐位等价实验** = HEAD 六份源码换回工作区跑
 *   10 队 × 3 轴态 × 2 命座 = 60 态，全行**原文**（不只指纹）diff 为空 + `md5sum -c` 自证还原。
 *   剩余分布：`damagePool.ts` **4 → 3**（`:412` 琉音强特 / `:494` 仪玄凝神 / `:508` 佩洛伊斯阳炎）·
 *   `convergence.ts` 10 · `helpers.ts` 4。
 *   下一批候选：`:508` 佩洛伊斯（需把 `peiluoKagerouPairRatio` 一起递进契约，−1）·
 *   1141 收尾（C7 计数投影 `countStun` ⇒ −1）· `helpers.ts`/`convergence.ts`（**先派只读分诊**）·
 *   `:494` 仪玄（**先裁决默认值分裂**，产品级口径）。
 *
 * **=== 2026-09-17 round 19 换尺批（口径纠正 15 → 42，规则 17②）===**
 *
 * ⚠ **这不是退步，是尺子变准**（规则 17②：棘轮防「代码变差」，不防「度量漏计」）。先例：
 * 2026-09-12 frozen 8→78（注释原文「78 才是编排层真实的 agentId 特判存量」）。
 *
 * 旧尺 `/agentId\s*(===|!==)/` 的漏计面（T48 报告 `/home/kaua/.dsh/session-manager/reports/T48-a2.md` 实测）：
 *  · `agent?.id === '1581'` / `agent.id !== '1311'` —— 同义的角色判定，正则完全不命中；
 *  · `agent.teammateBuffId === 'remielle'` —— 同上（`teammateBuffId` 在旧 check-guards 里零出现）。
 * ⇒ 新写的这两种形态**永远不会被拦**，「只减不增」对它们是空的。
 *
 * 换尺后实测（AST 单源 = `lib/agent-identity-lines.mjs`，check-guards 与报告脚本共用同一 visitor）：
 *  · 编排层 = **42 行 / 62 比较表达式**；逐行人工核对**无假阳性**（42 行全是角色判定）。
 *  · 形态分布：`agentId` 15 · `id` 34 · `teammateBuffId` 20（**有重叠**：同行双形态 20 行 ⇒ 形态数不可相加）。
 *  · 观察项（**不进度量、也不删除**）：非角色 `.id` 比较 17 条 —— 动态 7（`r.id === rowId` 族）
 *    + 非四位字符串 10；局部别名（`fillerAgentId === '1051'`）2 条。
 *  · 组件对账：新尺 42 = 旧尺 15（全部被新尺覆盖，`legacyLinesNotBusiness` 恒 0）+ 新增 27；
 *    ⚠ C-α 批（同 round，先行提交）已把两条反馈迁走，故**换尺当刻的旧尺读数是 15 而非 17**。
 *  · core 面**不受影响**（core 6 行全是裸 `agentId`，两个尺子同值 6）⇒ `CORE_AGENT_BRANCH_BASELINE` 不动。
 *
 * 换尺与改代码**分属两批**（规则 17②唯一纪律「换尺与改代码不得混批」）：本批只换尺、零运行时改动；
 * C-α（17→15）已在上一提交 `8a4b47b` 落地并单独验收。
 *
 *
 * **=== 2026-09-17 round 20 R20-h1 同槽面板批（39 → 32，−7）===**
 * `helpers.ts` 7 个「同槽自面板块」迁进各模块 `applyPanel`（A6 1531 / A7 1041 / A8 1321 /
 * A9 1391 / A10 1551 / A11 1481 / A12 1571）。零新契约（`AgentPanelInput` 已足）。
 * ⚠ 实测 −7 而非分诊预估的 −6：A11/A12 各含 `id`+`teammateBuffId` 双形态，按行去重后各算 2 行。
 * 逐位等价：31 队 × 3 槽 × (inCombat+outOfCombat) = **162 行全字段指纹，两侧 md5 一致**。
 *
 * **=== 2026-09-17 round 20 R20-h3 跨槽批（32 → 28，−4）===**
 * `helpers.ts#computePanelPhases` 里两组**跨槽**硬编码块迁进来源角色模块的新钩子
 * `teamPanelEffects`（契约 `AgentTeamPanelEffectInput`，声明式：来源角色自报「我在队时给谁加什么」）：
 * · 莱特 1161 影画4 后场队友能量效率 +10%×占比（**本人不吃**）
 * · 耀嘉音 1311 咏叹华彩全队增伤/暴伤（**含自己**）+ 影画4 职业分支（**排除自己**）
 * ⚠ 这批是 **P2 陷阱**（round 15 规划曾建议「搬进来源角色 `applyPanel`」= 错）：`applyPanel` 逐槽位
 * 派发、只传该槽自己的 `panel` ⇒ 搬错会让**来源自己**吃到本该给队友的加成，且既有断言
 * （`lighter.test.ts:170` 队友 +5 / 本人 0）会精确红。故新契约值得单独立项而不是复用 `applyPanel`。
 * ⚠ 实测 −4 而非分诊预估的 −5（分诊把 A4/A5 记为 −3，实际双形态按行去重后为 −2）。
 * 逐位等价：200+ 队形 × 2 滑块三端点 × 3 槽 × 局内/局外 = **4932 行全字段指纹，两侧 md5 一致**。
 *
 * **=== 2026-09-17 夜间批（28 → 24，−4）===**
 * 抽出共用 helper `findSlotByIdentity`（`helpers.ts`）收敛「按角色身份找槽位」的重复形状：
 * `damagePool.ts` 5 处内联 `findIndex` → 一行 helper 调用（该文件 8 → 3）。
 * ⚠ **净 −4 而非 −5**：helper 自身那行判定（`ids.some(id => a.id === id || a.teammateBuffId === id)`）
 * 也计入棘轮（`helpers.ts` 7 → 8）——这是**抽象层留一行换 18 处站点**的投资，不是退步。
 *
 * ⚠ **本批顺带查实的数据面事实（判死动作，本批未做）**：catalog 里 `teammateBuffId` 只有 5 个取值
 * （1171/1261/1411/1511/1581）且**全部等于自身 id** ⇒ 各处 `a.teammateBuffId === 'X'` 的右臂
 * 恒等于左臂；而反复出现的别名 **`'remielle'` 不是任何角色的 teammateBuffId**
 * （它只是 catalog 里 `remielleRefringeCoefficient` 之类 stat/effect 名的前缀）⇒ 那些
 * `a.teammateBuffId === 'remielle'` 是**当前数据面下的死分支**。**未删**（判死需引擎实测背书 + 独立批次）；
 * 由 `findSlotByIdentity.test.ts` 把该事实钉住：remielle 若真成为别名，那里立刻红。
 *
 * **=== 2026-09-18 R21 夜批（24 → 9 → 7）===**
 * 派活方预批 + 三批并行工人（T61/T62/T63）+ 派活方收尾：
 * · `findSlotByIdentity` 抽出后，`damagePool.ts` 5 处内联 findIndex → 1 行调用（该文件清零）；
 * · 夜 A 把该文件最后 3 处（琉音强特跳过 / 仪玄凝神三臂 / 佩洛伊斯阳炎两臂）迁进各模块
 *   `axisWindowOverlays`（T7 裁决归一默认值后仪玄 0 delta；佩洛伊斯无需新契约——行级配对比例
 *   的唯一写入方本来就是本模块 `patchExecutions`）；
 * · 夜 B `convergence.ts` 8→2、夜 C `helpers.ts` 8→2；
 * · 收尾 `liuyinPromote.ts` / `normaHatChain.ts` 各 1 处 → 复用 helper（本轮 9→7）。
 * ⚠ **剩 7 行中已查明 2 行不是 DRY 机会**（`convergence.ts` 雨果/般岳 cfg-merge）：
 * 字段契约与消费端都就位，但迁移所需输入通道缺失——`autoTopUp` 依赖 `guarantee.fury` /
 * `guarantee.ultimate` / `banyue.autoTopUpInteractions` 与 `appliedBoss`，其中 **`guarantee.*`
 * 未注册 MechanicSetting**（实测）⇒ 不在 `AgentTeamConfigInput.settings` 里、模块侧读不到。
 * 补该契约 = 改 `types.ts` + 冻结面 ⇒ 独立批次（已派 T65）。
 * · 收尾再迁 `useResourceCalc.ts` 3 处（蕾米倍率 / 蕾米虚耀 / 简 C6）⇒ 本轮 **9 → 7 → 4**。
 * ⚠ **剩 4 行的逐行定性**：`convergence.ts` 2 = 雨果/般岳 cfg-merge（待 T65 补 `guarantee` 契约）；
 * `helpers.ts` 2 = ① `findSlotByIdentity` **自身的实现行**（抽象层单一判定点——18 处形状收敛成这一行，
 * 是投资不是残留）② 简 C6 块（受 `jane.passionCoverage` **未注册**阻塞：注册它会让内部实验开关变成
 * 资源利用率页的用户可见滑块 = 产品级口径，需用户裁决 ⇒ 夜 C 如实保留未擅自动）。
 *
 * **=== 同夜：判据 17 扫描器盲区修复（与棘轮无关，但同属「护栏对真实写法失明」类）===**
 * `compacted-slot-index.mjs` 原正则只认 `panels[slot]`，漏掉真实形态 `panels.value[slot]`
 * （实测盲区 8 处）⇒ 补齐 `(?:\.value)?` 后抓出 `useResourceCalc.ts` **4 处真缺陷**
 * （用 team 下标索引压缩面板数组；实测 `[空,1581,1031]` 时读到槽位 2 那个角色的面板）。
 * 4 处改 `panelAt`，判据 17 违规 4 → **0**。反向验证：盲区版对注入违规报 0 处、修复版报 1 处。
 * 沿革（换尺前，旧尺口径）：17（2026-09-17 round 18 **R15-d −1**）→ 15（C-α −2）
 *
 * **=== 2026-09-17 round 20 C-β 批（新尺 42 → 40，−2）===**
 *
 * 迁走 `convergence.ts` 的两条「下一轮反馈」（均在旧尺下也各计 1 行 `agentId` 判据）：
 *  · C6 仪玄 1371 符法千重行计数（`ch.agentId === '1371'`，旧 `:994`）⇒
 *    产出 `yixuanFuFaForJufufu` 的 `yixuan.ts#yixuanNextRoundFeedback`。
 *  · C9 莱特 1161 能量守卫（`characters.some(c => c.agentId === '1161')`，旧 `:1257`）⇒
 *    产出 `lighterTeamEnergy` 的 `lighter.ts#lighterNextRoundFeedback`
 *    （顺带消掉 `estimateTeamNormalEnergyConsumed` 在编排层的第二次调用，规则 11）。
 * ⚠ **`teamUltimateForJufufu` 刻意留在编排层**（本批的归属判断）：它是「全队 `ultimateCount`
 * 之和 + 符法千重分量」，与 1371/1391 在不在队都无关，而 `collectNextRoundFeedback` 只对
 * **在队**模块派发 ⇒ 挂进任一角色模块都会让缺那一方的队伍静默归零（实测「有 1391 无 1371」
 * 的队 `teamUltimateForJufufu` = 8，挂进 1371 模块后变 0）。分量现由
 * `teamUltimateBaseNext + (feedbackNext.yixuanFuFaForJufufu ?? 0)` 合成，逐位等价。
 *
 * 实测：`check-guards` **18/18**（角色判定 **40/40**，core 6/6）。判据
 * `src/mechanics/__tests__/nextRoundFeedbackR20.test.ts` **11 例**（层①精确值 4 · 层②来源
 * 隔离 2 · 层③真派发器/前导空槽/乱序槽位 2 · 层④下游两轮消费 2 · 反锁 1）。
 * **逐位等价实验**：12 队 × 2 轴态 = **24/24 线程指纹逐字一致**（HEAD worktree vs 工作区）。
 * `timeGolden` `grep -c "dmg:"` == **0**。
 *
 * **=== 2026-09-17 round 20 C-γ 批（新尺 40 → 39，−1）===**
 *
 * 迁走 `convergence.ts` 的 `merged.agentId === '1141'` 分支——该分支的**最后一个**字段
 * `lycaonC2Energy`（影画2 能量回馈）⇒ `lycaon.ts#applyTeamConfig`，分支整段删除。
 * 沿革（逐字段迁出的批次）：`lycaonStunCount`/`lycaonTotalTime`/`lycaonInvincibleTime`
 * （T26 批次 0c）→ `lycaonWindowDuration`（round 12 批次 2，走 `axis`）→
 * `lycaonBackstageDodgeCount`（round 14 批次 4，走 `interactions`）→ `lycaonC2Energy`（本批）。
 *
 * 补的两个只读契约（**纯加法**：不读它的模块 0 delta）：
 *  · `AgentTeamConfigInput.countStun` = **计数投影版**失衡次数
 *    （`projectStunPlanForCounts(stunCount, stunPlanProjection)`）。⚠ 与 `stunCount` 在
 *    **难度阶梯 G4（round）打开时不等价**（默认 off 下恒等 ⇒ `timeGolden` 与 `lycaonSmoke`
 *    都分辨不出来——这正是必须补契约、而不是用 `stunCount` 硬迁的理由）。
 *  · `AgentInteractionSnapshot.chainCountPerStun`（**store 原值**）——`characters` 上那份被
 *    `buildCharConfig` 写过 `?? (isSupport ? 0 : 1)` 兜底 ⇒ 与 store 侧分裂。
 *    ⚠ **实测纠正 R18 分诊一处前提**：它写「store=0 → cfg=1」是**错的**（`0 ?? 1 === 0`）；
 *    分裂只在 store 侧字段**缺失（`undefined`）**时发生，判据直接构造缺失态钉住。
 *
 * 实测：`check-guards` **18/18**（角色判定 **39/39**，core 6/6）。判据
 * `src/mechanics/__tests__/lycaonC2Contract.test.ts` **18 例**（层①精确值 6 · 层②两臂分叉 4
 * · 层③真派发器 4 · 层④契约门控 3 + 真管线 1）。`timeGolden` `grep -c "dmg:"` == **0**；
 * `axisContext.test.ts` 48 例与 `lycaonSmoke.test.ts` **13 例未改一行即全绿**（逐位等价的最强证据）。
 *
 * **=== 2026-09-17 round 20 R20-h1 批（新尺 39 → 32，−7）===**
 *
 * `helpers.ts` 分诊报告 `R20-A-helpers-triage.md` §4 **批次 1**「同槽零契约批」：把该文件
 * `computePanelPhases` 里的 **7 个「同槽自面板块」**的角色判定迁进各角色模块自己的 `applyPanel`
 * （全部 `agent.id === '<自己>'` 且只写当前 `panel` ⇒ **不触 P2 跨槽陷阱**，该陷阱已在 §2.1 受控实验
 * 实证只命中 A2/A3/A4/A5 那 4 行、属批次 3）：
 *
 * | 块 | 原行 | 判定 | 落点 |
 * |---|---|---|---|
 * | A6 | `:769` | `agent.id === '1531'` | `starlightBilly.ts#applyStarlightBillyPanel` → `specBase.applyPanel` |
 * | A7 | `:786` | `agent.id === '1041'` | `soldier11.ts#applySoldier11Panel`（与既有绝焰块合并） |
 * | A8 | `:796` | `agent.id === '1321'` | `evelyn.ts#applyEvelynPanel`（**乘法、位置敏感**） |
 * | A9 | `:803` | `agent.id === '1391'` | `specPanelBuffs.ts#jufufuTigerRoarMechanic.applyPanel`（**新增钩子**） |
 * | A10 | `:814` | `agent.id === '1551'` | `specPanelBuffs.ts#peiluoProminenceMechanic.applyPanel`（**新增钩子**） |
 * | A11 | `:829` | `id === '1481' \|\| teammateBuffId === '1481'` | `liuyin.ts#applyLiuyinPanel` |
 * | A12 | `:837` | `id === '1571' \|\| teammateBuffId === '1571'` | `norma.ts#applyNormaPanel` |
 *
 * ⚠ **−7 而非任务书预估的 −6**：新尺**按行去重**（判据 17⑥ 的计量单位 = 行），而 A11/A12 是
 * 「双形态同行」（两臂写在同一行）⇒ **各只降 1 行**，7 块 = **7 行**（25 表达式中 9 条、18 行中
 * 7 行）。任务书把 A11/A12 各算 −2（按**表达式**计），与其引用的分诊报告 §1「18 行 / 25 表达式
 * **按行去重**」自相矛盾。**实测为准**（规则 10：基线是测量工具；规则 17⑥：口径纠正先分类再定
 * 计量单位）：`countIdentityBranchLines` 实测 18 → 11（helpers.ts），全仓 39 → **32**。
 * 已把算式写进报告 §3，供派活方对账。
 *
 * **零新契约**（本批刻意不触 `types.ts`）：A6/A7/A8/A11/A12 落点钩子已存在（A6/A7 需与既有
 * `applyPanel` 合并）；A9/A10 需**新增 `applyPanel`**，但接口 `AgentMechanicModule.applyPanel`
 * 早已在 `types.ts:443` 声明 ⇒ 纯新增、不动契约。
 *
 * **逐位保留的三处硬约束**（违反即静默改语义）：
 *  · **A8 乘法位置敏感**：`panel.atk = Math.round(panel.atk * (1 + 0.15))` 进模块后**早于**其后
 *    所有 `panel.atk +=`。已核实两者之间**没有任何 `panel.atk` 写入**（区间内写的是
 *    `energyGainEfficiency`/`dmgBonus`/`critDmg`/`anomalyBuildUpEfficiency`/`stunBuildUpBonus`/
 *    `enemyPhysicalResReduction`；其余 atk 写入块全带 `agent.id === '<自己>'` 门控 ⇒ 对本槽不触发）
 *    ⇒ 上取整基数逐位相同。算式原样保留 `1 + 0.15`（不折叠成 `1.15`，虽实测同一 double）。
 *  · **A11 顺序约束**：`:829` 读 `panel.liuyinGoodReviewAtkBonus`，该值由同文件 `:220` 写入
 *    ⇒ 合并后严格保持「先写 bonus、后折算」（否则读恒 0 ⇒ 面板静默少 500×覆盖率）。
 *  · **A11/A12 右臂是死分支**（`'1481'`/`'1571'` 不在 catalog 的 5 个 `teammateBuffId`
 *    —— 1261/1581/1411/1171/1511 —— 里，§3.2 静态穷举已证）⇒ **逐位保留不删**，连整条析取
 *    （`agent.id === 'x' || agent.teammateBuffId === 'x'`）一并搬进模块：删右臂是**语义变更**
 *    不是清理（将来数据面填上该 `teammateBuffId`，该臂会复活），且**无测试会红**。
 *
 * **逐位等价实验**：31 队 × 3 槽 × (inCombat + outOfCombat) = **162 行全字段指纹 diff 为空**
 * （迁移前 HEAD 抓 `/tmp/r20h1-before.txt`，迁移后 `diff` 0 行）——比单点断言更强的证据。
 * 判据 `src/mechanics/__tests__/panelBlocksR20h1.test.ts` **16 例**（层①精确值 + 层②滑块端点
 * 0/0.5/1 + 层③真派发器接线 + 层④命座/额外能力门控边界 + 交叉隔离反锁）；各模块**既有**精确断言
 * （`jufufu.test.ts:102/111`、`peiluo.test.ts:33/149/263`、`soldier11.test.ts:167/216`）
 * **未改一行即全绿**。反向验证 **5 组**逐组精确红 + `md5sum -c` 自证还原（见报告 §5）。
 * `timeGolden` `grep -c "dmg:"` == **0**。
 *
 * ⚠ **本批唯一改动的既有测试**：`soldier11.test.ts:126` 的 `applyPanel` **直调** fixture 补
 * `settings: {}`（该钩子迁入后读 `AgentPanelInput.settings`；派发点 `computePanelPhases` 恒传，
 * 直调测试须补齐——同款 fixture 见 `piper.test.ts:51`/`hugo.test.ts:334`）。**断言值一字未改**。
 *
 * ── 2026-09-17 round 21 夜 A（`damagePool.ts` 最后 3 处角色判定，24 → **9**，**−3** 归本批）──
 *
 * ⚠ **读数说明**：本批落地时 `git status` 显示另有并行会话正在改 `convergence.ts` / `helpers.ts`
 * （持租约 session-c0a1 / session-6f61）。故 24 → 9 的 **−15 里有 −12 不属于本批**：剥离本批四个文件
 * 后实测为 **12**（`git stash push` 四文件 → `check-guards` → `stash pop` 自证还原），
 * **本批真实 delta = 9 − 12 = −3**，与三个站点一一对应。归因按**工作树实测**而非提交态
 * （`report-agent-identity.mjs --worktree`，该脚本默认取 HEAD 提交态、会漏掉并行 WIP）。
 *
 * 三处逐处（每处都做了「迁移前后全行指纹对拍」= 0 delta，不是只靠既有测试不红）：
 *  · **`:428` 琉音强特跳过通用行** —— `charResult.agentId === '1481'` 项**删除**，留
 *    `liuyinSrc && !isAxis && LIUYIN_EX_MOVE_IDS.has(…)`（`liuyinSrc` 上提到槽位循环头，
 *    与下方专用块**共用同一个判据**）。为何不是「顺手去冗余」：本行语义是**跳过通用路径、
 *    把结算权交给下方专用块** ⇒ 删 agentId 必须同时证明专用块会重放该行，否则「两边都不算」
 *    （静默少伤）。三条论证（行归属 moveId 全局唯一 / 重放条件与本行门控共用项一致 /
 *    赠链赠大不会搬这三行到别槽）写在 `damagePool.ts` 该行注释里。
 *  · **`:510` 仪玄凝神三臂** —— `agentId === '1371'` + `additionalAbilityActive` 门控 + 三臂
 *    整段迁进 `yixuan.ts#axisWindowOverlays`：C6 臂与非 C6 非轴臂产**标量** `yixuanNingshen`
 *    （走 `scalarBySlot`——两者都「对本槽全部行同值」，复用桶会泄漏给队友行），非 C6 轴臂仍走桶。
 *    ✅ 阻塞本处的「默认值分裂」已由用户裁决 `a6adca7` 归一为 0.5 ⇒ 迁移 0 delta
 *    （实测：`yixuan.ningshenCoverage` 0/0.5/1 三档指纹互不相同，且 default == 0.5 那档）。
 *  · **`:524` 佩洛伊斯阳炎两臂** —— `agentId === '1551'` 两臂迁进
 *    `specPanelBuffs.ts#peiluoProminenceMechanic.axisWindowOverlays`：轴臂走桶不变，
 *    非轴臂 → 标量 `peiluoKagerouPct = 40 × 覆盖率滑块`。⚠ **行级配对比例留在行上**
 *    （`peiluoKagerouPairRatio` 的唯一写入方 = 本模块 `patchExecutions`，逐 moveId 不同
 *    ⇒ 进不了「全行同值」的标量），消费端 `标量 × 行级比例` = 原式，逐位等价。
 *    ⚠ 本处**刻意无** `additionalAbilityActive` 门控——阳炎出自**核心被动**（上分支终结技），
 *    不是额外能力；别照抄般岳/可琳那两支（那是额外能力机制）。
 *  · **零新契约**：`scalarBySlot` / `AxisScalarOverlays` 是 round 16 既有通道，本批只**新增两个
 *    字段**（`yixuanNingshen` 早已声明但零写入、本批首次接线；`peiluoKagerouPct` 新增）。
 *  · 判据 `damagePoolNightA.test.ts`（三处逐处精确值 + 反锁）；`timeGolden` `grep -c "dmg:"` == 0；
 *    逐位等价指纹 = 10 队 × 2 轴态 × 9 滑块档 = **200 态全行 sha256，迁移前后 TOTAL_SHA 完全相同**
 *    （`0d9386e0e52e7e10f52cfb0506a6fe0ddf5eb138e9b9f087bf49b434893fe3cf`）。
 *
 * ⚠ **本批改动的既有测试 = `teamHookMigration.test.ts` 两条断言（2 处，加强不是放宽）**：
 * 「仪玄凝神」「佩洛伊斯阳炎」两个用例原本断言 `axisWindowOverlays({isAxis:false})` **`toBeNull()`**，
 * 用例标题里明写「**非轴臂仍在伤害池**」——那条注释正是本批要消灭的状态（旧注释同时是 TODO 与判据）。
 * 改法照 round 16 先例（**同文件同 describe**，commit `b83e82c` 给般岳/可琳做过同一件事：
 * `toBeNull()` → 「桶留空 + 标量表给精确折算值」）：换成精确折算值 + 滑块两端 + 命座分叉 +
 * 额外能力门控 + 两臂互斥 ⇒ **断言数与信息量都增加**（原 2 条 → 现 2 条各 6~8 个精确断言）。
 * 「分支被直接删掉」这种形态**仍有判据**（删掉后标量为 `undefined` ⇒ 红），不是把护栏拆了。
 * ⚠ 真管线判据（含「行级配对比例**真被消费端乘上**」——该点**只能**在真管线测，
 * 单测 `patchExecutions` 再断言字段值**证明不了**消费端乘了它）在 `damagePoolNightA.test.ts`。
 */
export const AGENT_BRANCH_BASELINE = 4

/**
 * 引擎层 agentId 特判棘轮（2026-09-11 评审补的口子）。
 *
 * 为什么单独一条：规则 6 的棘轮此前只盯 `useResourceCalc.ts`（编排层），而 **core/ 引擎层是豁免区**——
 * 评审实测 core 里沉淀了 36 处 `agentId === 'xxxx'` 特判（resource.ts 16 + resource/helpers.ts 20），
 * 无任何护栏。它们与编排层那 53 处同根（角色逻辑没回到 `src/mechanics/agents/<id>.ts`），
 * 且更隐蔽：core 号称「角色无关的纯函数引擎」，读代码的人会默认这里没有角色名。
 *
 * ⚠ 为什么不"一次清零"：这些特判承载真实机制（赠链槽位定位、终结技归属、命破分支…），
 * 迁移需要先有落点（评审 #10 的 convergence.ts 与 applyTeamConfig 通道）。故与 agentId 棘轮同款：
 * 冻结存量、只减不增，把「清零」变成 burn-down 契约（见 RATCHET_BURNDOWN）而非一次性工程。
 */
export const CORE_AGENT_BRANCH_FILES = ['src/core/resource.ts', 'src/core/resource/helpers.ts']
/** 2026-09-11 冻结基线（评审实测 36 = 16 + 20）→ **26**（2026-09-13 T6 首次真清偿 −10，见下沿革）；只减不增。
 *
 * 36 → 26 沿革（2026-09-13，T6）：删掉 10 处「`cfg.agentId === 'X' && cfg.<该角色模块专属字段>`」里的
 * **冗余 agentId 判断**——判据是「该字段的唯一写入方 = X 的角色模块」（模块只对自己的 cfg 运行，
 * 故字段存在/为真即蕴含 agentId === 'X'）。逐处核实唯一写入方后化简，`timeGolden` 3 tests **0 数值 delta**：
 *  · `yidhariContinuousEx`（唯一写入方 `src/mechanics/agents/yidhari.ts:148`）→ 去掉 7 处守卫
 *    （resource.ts 的 yidhariContinuousPresent / yidhariFinalizeIdx；helpers.ts 的 resolveExSpecialCount
 *    refund 分支 / decibelExCount / yidhariRealUlt / exForTime / storedEx）
 *  · `normaCinemaLevel`（唯一写入方 `src/mechanics/agents/norma.ts:236`）→ 去掉 2 处守卫
 *    （resource.ts 的 normaC4Decibel；helpers.ts 的赠链喧响分支；非诺姆 cfg 恒 undefined → `?? 0` → false）
 *  · `antonC1EnergyGift`（唯一写入方 `src/mechanics/agents/anton.ts:53` 的 setRecord）→ 去掉 1 处三元守卫
 *    （`n()` 把 undefined 映射为 0，与原三元 else 分支同值；与紧邻的 yixuanFlashBonus 无守卫写法同款）
 * **有意不动**的两类（下一批候选，勿按本条口径照抄删除）：
 *  · `!==` 短路形态（helpers.ts 的 `cfg.agentId !== '1051' || yidhariRefundPer <= 0` 等）——删左操作数会把
 *    「非目标角色一律返回 0」变成「只看字段」，语义不等价，需逐处论证。
 *  · **写入方在编排层而非角色模块**的字段：`yidhariInStunExCount` ← `convergence.ts:957`、
 *    `billyAxisActive` ← `convergence.ts:1074` ——编排层可能对任意 cfg 写它们，「字段存在」不蕴含
 *    「是该角色」，故 helpers.ts:1271 与 resource.ts:595 的守卫**不冗余**，保留。
 *    正解是把这两个写入方挪进对应模块（再删守卫），不是先删守卫。
 *
 * 26 → 18 沿革（2026-09-13，`crossAgentSupply` 架构收口）：赠链族 8 处槽位查找
 * （`findIndex(c => c.agentId === '1571'/'1481')`，散在 resource.ts 的折叠环/试探/装配三处 × 多个副本）
 * 改成引擎按**能力类别**查询（`findCrossAgentSupplySlots(configs, 'gift-chain:chain'|'gift-chain:ultimate')`），
 * 数量与落点由模块的 `crossAgentSupply` 自报；详见判据 12（静态角色 import 棘轮）的说明。
 * `timeGolden` 3 tests **0 delta**（105 预设 + 60 角色×命座 0/6）。
 *
 * 18 → 12 沿革（2026-09-15 批次2，−6）：把 `!==` 短路与 `agentId === X && 字段` 两类守卫的
 * **左操作数**删掉，换成纯字段判据（判据同 T6：字段唯一写入方 = 该角色模块 ⇒ 字段即蕴含角色）：
 *  · `helpers.ts` yidhari 族 4 处：`cfg.agentId !== '1051' || yidhariRefundPer <= 0` → `yidhariRefundPer <= 0`
 *    （refund 量派生自模块写的 `yidhariRefundPerOutStunEx`）；两处 `if (cfg.agentId !== '1051') return 0`
 *    （烧血喧响 ×2）→ `if (cfg.yidhariDecibelPerHpPct === undefined) return 0`；
 *    另有 1 处 `agentId === '1051' && 字段 !== undefined` → 纯字段判定。
 *    ⚠ 判别字段必须选**无 `?? 默认` 回退**的那个（`yidhariDecibelPerHpPct`）：同分支的
 *    `yidhariExHealMissingHpPct ?? 0.75` / `yidhariExternalHealPct ?? 0` 对任意 cfg 都有值，不能当判据。
 *  · ⚠ **不成立的一类**（本次试过并回退，留痕）：`resource.ts:518` 的
 *    `configs.filter(c => c.agentId === '1531' && billyAxisActive !== 1)` **不能**改成字段判据——
 *    `billyFinalizeChain` 的初值 `false` 由本文件 :965 的 `if (cfg.agentId === '1531')` 循环写入
 *    （非 undefined = 已初始化），故 `billyFinalizeChain === false` 会把非比利 cfg 一并纳入重推。
 *    该类属「按角色复位旗标」的跨 cfg 循环，不在 T6 冗余判据范围内。
 *  · 12 → 11（2026-09-15 同批）：`helpers.ts` 的席德正兵回能
 *    `configs.findIndex(c => c.agentId === '1461')` → 按**字段**找槽
 *    `findIndex(c => c.xideVanguardSlot !== undefined)`（该字段唯一写入方 = `xide.ts` 的
 *    applyTeamConfig，build 阶段早于本函数 ⇒ 字段存在即蕴含是席德的 cfg）。
 *    这是 `crossAgentSupply` 同族的「引擎按能力/字段查询」落点，0 delta。
 *  · 11 → **8**（2026-09-15 同批，**本批最大的一处**；−3 = 三段调用点 + 删掉的两个旧 helper 内部各一处）：丽娜/苍角/露西的「终结技邻位回能」
 *    从引擎三段角色专属数学（`calcRinaUltEnergy` / `calcSoukakuUltEnergy` / 露西内联块，
 *    各含一个 `findIndex(c => c.agentId === '<id>')`）改为**能力类别查询**：
 *    三个模块声明 `crossAgentSupply.kind = 'neighbor-ult-energy'` + 新增契约槽位
 *    `perTargetAmounts()`（一次给出「槽位→该落点得到多少」，因为邻位机制是
 *    **下一位 30 / 上一位 10 两个落点不同量**，单落点的 `targetSlot()` 表达不了）
 *    + `displayKey`（模块自报 `CrossAgentEnergy` 的展示明细键，引擎按 key 聚合 ⇒ 引擎零角色名）。
 *    引擎侧只剩 `neighborUltEnergyByProvider()` 一次调用；两个旧 helper 已删，
 *    原测试改走新路径（断言值与口径不变）。
 *    ⚠ 两条踩过的坑（都靠 timeGolden 抓到）：① **引擎侧不要跳过「提供者自己」**——
 *    丽娜/苍角的邻位分配内部已排除自己，而露西影画1 的「回旋全队回能」**含她自己**，
 *    一刀切 skip 会少算；② 提供的 `perTargetAmounts` 读的是**提供者自己那份 cfg**，
 *    若某量是编排层「写给全队」的估计值，两边取值时机可能不同（本批实测该差异不成立，
 *    但契约里保留了 `targetCfgOf` 供需要时用）。
 *  · 8 → **6**（2026-09-15 同批）：伊德海莉烧血的跨槽查找（`findIndex(c => c.agentId === '1051')`
 *    ×2，helpers.ts 与 resource.ts 各一处）→ 按**模块专属字段** `yidhariDecibelPerHpPct`
 *    找槽（唯一写入方 = yidhari.ts 的 buildCharConfig，无条件写且无 `?? 默认`）。
 *    ⚠ **卢西娅那两处（'1451'）试过并回退**：`luciaCinemaLevel` 写在编排层的另一份 cfg 上，
 *    在 `iterate` / 收敛后两条路径上实测**都是 undefined** ⇒ 改字段判据会让 `luciaSlot` 恒 -1
 *    （帷幕触发数归零，`luciaElowen.test.ts` 的 `yidhariExternalHealPct` 12.8 → 0 精确红）。
 *    ⇒ 「字段唯一写入方」是**必要非充分**条件：还要验证该字段在**消费点所在的那份 cfg** 上有值
 *    （T6 判据的补充：写入时机/所在对象必须与读取点一致）。
 *  · **剩余 4 处的性质**（引擎层真特判，需先有派发落点，别再逐处硬删）：
 *    - `helpers.ts` 般岳(`1471`) 强特次数分支 —— 调模块专属求解器 `computeBanyueCycleFromCfg`
 *      （落点 = 让该模块声明一个「强特次数求解器」能力，引擎按能力查询，同
 *      `crossAgentSupply`/`backstageAutoFill` 范式；需要设计，不是删守卫）。
 *    - `resource.ts:523` 比利(`1531`) 终局整数重推过滤 + `:962/:963` 的
 *      比利/伊德海莉终局旗标复位 —— 按角色**复位自己那份 cfg**的跨 cf​g 循环。
 *      ⚠ 试过改字段判据并**否决**：`billyFinalizeChain` 初值 `false` 由 `:962` 的
 *      `if (cfg.agentId === '1531')` 循环写入（非 undefined = 已初始化）⇒ 字段判据会
 *      把非比利 cfg 一并纳入重推。详见 `resource.ts:518` 附近注释。
 *
 * ⚠ **2026-09-16 round 13 实测更正（防后来者按过期前提重走）**：任务卡 round 13（`.claude/PROMPT-handoff-round13-axis-batch3.md`）
 * 与设计卡 §1.2/§5 都写「1051 迁完**同时解锁 core 棘轮 2 处**：`core/resource/helpers.ts:1271` +
 * `core/resource.ts:595` 的 yidhari 守卫 ⇒ core 6→4」。**该前提已证伪**——那两处守卫**早已不存在**：
 *  · `helpers.ts` 的 `if (cfg.agentId === '1051' && cfg.yidhariInStunExCount !== undefined)` 由
 *    **`0bb2611`**（2026-09-16，core 16→12，T6 判据）删除；
 *  · `resource.ts` 的 `findIndex(c => c.agentId === '1051')` ×2 由 **`97cc65c`**（2026-09-16，core 8→6，
 *    改按 `yidhariDecibelPerHpPct` 字段找槽）删除。
 *  两者都**早于** round 11（`e1c26b2`）与 round 12（`aeb3f6f`）；逐提交实测计数 =
 *  `50271c5` 26 · `0bb2611` 12 · `97cc65c` 6 · `e1c26b2` 6 · `aeb3f6f` 6 · HEAD 6。
 *  故 round 13 迁走 1051 的编排层分支**不改变** core 计数（core 保持 **6**，本轮不动）。
 *  **HEAD 剩余 6 行（逐行，审计用）**：`resource.ts:523`（比利终局重推过滤，已明确否决改字段判据）·
 *  `:747`（`luciaSlot`，试过改字段判据并回退——见上方 T6 补充条件）· `:968`（比利旗标复位）·
 *  `:969`（**伊德海莉 `yidhariFinalizeEx` 复位**——本轮唯一与 1051 相关的一行，属上方明文归类的
 *  「按角色**复位自己那份 cfg** 的跨 cfg 循环」，**不在** T6 冗余判据范围内，本轮不动）·
 *  `helpers.ts:1254`（般岳强特次数分支）· `helpers.ts:1389`（`luciaSlot`）。
 *  ⇒ 「core 6→4」在**当前树**上无可达路径；真要降 core 需先做上方「剩余 4 处的性质」里的能力契约。
 */
export const CORE_AGENT_BRANCH_BASELINE = 6

/** 跨多个文件计 agentId 分支总行数（与 countAgentIdBranchLines 同口径） */
export function countAgentIdBranchLinesInFiles(files, root = ROOT) {
  return files.reduce((n, f) => n + countAgentIdBranchLines(readFileSync(join(root, f), 'utf8')), 0)
}

/**
 * 计一个文件里的 agentId 特判行数（棘轮唯一计数口径）。
 *
 * ⚠ 2026-09-12 收紧：**注释行不计**（原口径把注释也算进去，与 `detectExhibitionLayerImport`
 * 的同款豁免不一致）。实测踩过：迁移时在注释里写「原本是 `findIndex(c => c.agentId === 'xxxx')`」
 * 解释来龙去脉，反而被自己数成 1 处违规（代码其实已清零）——**口径惩罚了写文档的人**。
 * 豁免规则与本文件既有判据 7 完全一致（`//`/`*`/`/*` 开头的行），不引入第二套注释语法实现。
 *
 * 收紧后实测：度量面无任何注释行命中（79 与 36 均不含注释），故**基线数值不变**，属纯硬化。
 */
export function countAgentIdBranchLines(content) {
  return content.split('\n').filter(l => {
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false
    return /agentId\s*(===|!==)/.test(l)
  }).length
}

// ---- 判据 3：工作区状态文件防误提交 ----

/** 允许被 git 跟踪的 .claude/ 白名单（本仓库历史遗留：本地权限配置） */
export const CLAUDE_TRACKED_ALLOWLIST = ['.claude/settings.local.json']

export function findForbiddenTracked(trackedPaths) {
  return trackedPaths.filter(p =>
    (p === '.claude/task-ledger.md' || p.startsWith('.claude/ledgers/') || p.startsWith('.zcode/') || p.startsWith('.zc/')
      || p.startsWith('.freebuff/'))
    || (p.startsWith('.claude/') && !CLAUDE_TRACKED_ALLOWLIST.includes(p)),
  )
}

// ---- 判据 7：展示层越层 import 棘轮 ----
//
// 规则来源：ARCHITECTURE §0「依赖方向：展示 → 编排 → 引擎」——views/components 只读编排层产物，
// 不直接 import 引擎（@/core）或录入层（@/mechanics、@/specs）。
//
// 为什么是棘轮而不是一次清零：2026-09-11 评审实测 24 处（23 运行时 + 1 import type），
// 其中多数是常量/纯函数（sharpCritMultiplier / ULTIMATE_COST_DEFAULT / scoreForDamageRatio /
// SKILL_DMG_TARGET_LABELS…）。正解是下沉 src/data/ 或经编排层透出，但逐条属独立任务；
// 先冻结防恶化（复制 agentId 棘轮的已验范式）。豁免 import type：纯类型不产生运行时依赖。

/** 展示层目录（只扫 .vue；它们的逻辑入口就是 <script setup>） */
export const EXHIBITION_LAYER_DIRS = ['src/views', 'src/components']

/** 禁止的越层目标：引擎/录入层（@/core、@/mechanics、@/specs） */
export const EXHIBITION_LAYER_FORBIDDEN = /@\/(?:core|mechanics|specs)(?:\/|['"])/

/**
 * 2026-09-11 冻结基线（评审时实测 23 处运行时越层 import；另有 1 处 `import type` 按豁免不计）
 * → **15**（2026-09-13 T7 首次真清偿 −8）。只减不增：迁走一处 → 把基线下调到新值；上调没有合法路径。
 *
 * 23 → 15 沿革（纯常量/纯函数下沉 `src/data/`，原位置改 re-export ⇒ 引擎侧调用点、测试、
 * `@fact` 锚零改动，规则 11 单一事实源不破；实测 vue-tsc 0 错、@fact 锚 93/93 不变）：
 *  · `SKILL_DMG_TARGETS`/`SKILL_DMG_TARGET_LABELS`/`normalizeSkillDamageTarget`
 *    `core/buff.ts` → `data/skillDamageTargets.ts`（buff.ts re-export）
 *    ⇒ 属性配置页 + 调试页 2 处
 *  · `scoreForDamageRatio`（含 SCORE_CURVES/cap/逆函数，整模块纯）
 *    `core/deadlyAssaultScore.ts` → `data/deadlyAssaultScore.ts`（core 留 re-export 壳）⇒ 实战对比页 1 处
 *  · `ANOMALY/DISORDER/TURBULENCE_DECIBEL_BONUS`
 *    `core/anomalyPool/helpers.ts` → `data/anomalyDecibelBonuses.ts`（helpers import+re-export）
 *    ⇒ 结果卡 1 处
 *  · `ULTIMATE_COST_DEFAULT` `core/resource.ts` → `data/resourceDefaults.ts`（resource.ts re-export）⇒ 队伍配置页 1 处
 *  · `BOSS_ENTRY_ANOMALY_OPTIONS` `core/stunAxis/inStunAnomaly.ts` → `data/bossEntryAnomalyOptions.ts` ⇒ 失衡轴页 1 处
 *  · `sharpCritMultiplier` `core/damage.ts` → `data/sharpCritMultiplier.ts`（damage.ts re-export）
 *    ⇒ 面板卡 + 属性面板 2 处。⚠ 偏离 T7 简报的「本批不要碰」清单：简报把它列为「真引擎调用，
 *    需经编排层透出或改架构」，但**实测它是纯函数**（2 个标量入参 → 1 个数，无 import/无状态），
 *    且本文件 :489 的设计注释早已把它列进「常量/纯函数，正解是下沉 src/data/」名单
 *    （原出处 = 2026-09-11 架构评审快照，快照已删、未落地项迁 .claude 账本）——无需架构改动。如需回退，把该函数搬回 damage.ts +
 *    两个组件 import 改回 `@/core/damage` 即可（棘轮基线同步回调 15→17）。
 *
 * **剩 15 处不能再按本法下沉**（逐处核过，全是真引擎调用或注册表读取，无纯常量）：
 * getAgentMechanic×4 / buildTeammateBuffSourceContext×2 / calcPanel / applyTargetedStat /
 * calcStunMultiplier / allocateAxisWindows / computeOptimalSubStats+getTemplate /
 * readImpactVar+writeImpactVar（收 configStore，非纯）/ agentSpecs / computeBanyueMingwangBlocks+
 * BANYUE_AXIS_MOVE_META / computeYixuanNingshenBlocks。它们要经编排层透出，属架构改动。
 */
export const EXHIBITION_LAYER_IMPORT_BASELINE = 15

// ---- 判据 12：引擎层「静态依赖具体角色模块」棘轮 ----
//
// 为什么需要（2026-09-13 架构诊断）：agentId 棘轮是**词法**判据（`/agentId\s*(===|!==)/`），
// 双向失真——既漏掉等价写法（`c.liuyinCinemaLevel !== undefined` 不被计数），
// 又**完全看不见**强得多的耦合形态：`core/` 直接 `import ... from '@/mechanics/agents/<角色>'`。
// 实测病灶：`core/resource.ts` 曾住着 135 行「诺姆怎么赠链、琉音怎么转大」的角色数学
// （`normaGiftChainInfo` / `liuyinGiftChainInfo` / `liuyinGiftTime`），它们不写 id 字面量
// ⇒ 棘轮零意见，但**新角色接赠链必须改引擎**——正是规则 6 要消灭的形状。
//
// 度量面 = `src/core/**` 对 `@/mechanics/agents/*` 的**值**导入（`import type` 豁免：纯类型不产生
// 运行时依赖，与判据 7 同款豁免）。正解 = 模块经 `AgentMechanicModule` 钩子/声明式字段暴露能力
// （`crossAgentSupply` / `axisWindowOverlays` / `backstageAutoFill` …），引擎按能力查询、不按角色查询。

/** 引擎层目录（依赖方向最内层，应当角色无关） */
export const CORE_LAYER_DIR = 'src/core'

/** 角色模块路径（值导入 = 硬耦合；type-only 豁免） */
const CORE_ROLE_IMPORT_RE = /^\s*import\s+(?!type\s)[^'"]*from\s+['"]@\/mechanics\/agents\/[^'"]+['"]/

/**
 * 2026-09-13 冻结基线：诊断时实测 **7 处**（不含测试）——
 * `core/resource.ts` 1（luciaElowen）+ `core/resource/helpers.ts` 4（luciaElowen / banyue / norma / liuyin）
 * + `core/anomalyPool.ts` 1 + `core/anomalyPool/helpers.ts` 1（均 velina）。
 * 同批 `crossAgentSupply` 契约落地后**赠链族数学**（135 行）已迁进 norma/liuyin 模块，
 * 但引擎侧仍有 4 处对本批未迁移能力的直接引用（见下），故冻结 7。
 * 只减不增：迁一处 → 把基线下调到新值；上调没有合法路径。
 *
 * 剩余 5 处的迁移前提**已被实测证伪（2026-09-13 T8，勿照原计划重走）**：
 * 原本预期「赠链族迁走后会剩零调用死引用可删」——**实测 0 个死引用**，5 处 import 的每个符号都有活调用：
 *  · `velina#simulateVelinaCorrosionState` ×2（anomalyPool.ts:328 / anomalyPool/helpers.ts:1195）——
 *    **不能只删**：模块的 `transformAnomalyPool` 钩子已算过一次，但用的是**预算值** `preTurbulenceCount`，
 *    而 core 这两处是**最终值**二次结算（注释原文「风蚀状态机按最终乱流次数重新结算」）⇒ **有意双轨**，
 *    删任一处都改数值；且两处 core 的 `cinema2CorrosionRate` 兜底来源还不一样，连合并都不能证逐位等价。
 *  · `banyue#computeBanyueCycleFromCfg`/`readAxisExCounts` ×1——函数本身纯（只吃 cfg），但它读的
 *    `banyueAxisEx` **由编排层逐轮注入**（convergence.ts:980），模块 `buildCharConfig` 跑在 cfg 合并**之前**
 *    ⇒ 预先算会读到过期值。改「converge 相位算好写 cfg」则**测试直调 `calcTeamResources` 的路径不经过钩子**
 *    ⇒ 静默回落通用「闪能/20」公式（正是该分支存在的原因）⇒ 必须设计成缺失时**大声失败**，属引擎改动。
 *  · `luciaElowen#computeLuciaCurtainTriggers` ×2——入参全是**引擎收敛态**，且两个相位各调一次
 *    （iterate 内用 prevStates / 收敛后用最终 states），脱钩同样需「core 经注册表向模块要值」+ 穿参数。
 *
 * ⇒ **三处都是引擎契约改动**（给 `AgentMechanicModule` 加「引擎期求值」能力 + 把注册表穿进
 * `calcTurbulenceDamage` 等签名），不是机械迁移。原计划里「norma/liuyin/velina 可直接删」**已证伪**
 * （norma/liuyin 那两条随赠链族一起迁走了；velina 那条不成立）。
 */
export const CORE_ROLE_IMPORT_BASELINE = 5

/** 扫 `src/core/**` 里对具体角色模块的值导入 → [{ file, line, text }]（**不含测试**：测试自由引用模块） */
export function scanCoreRoleImports(root = ROOT) {
  const sites = []
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { rec(p); continue }
      if (!n.endsWith('.ts') || n.endsWith('.d.ts')) continue
      const rel = relative(root, p).split(sep).join('/')
      if (rel.includes('__tests__') || rel.endsWith('.test.ts')) continue
      readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        if (CORE_ROLE_IMPORT_RE.test(l)) sites.push({ file: rel, line: i + 1, text: l.trim().slice(0, 110) })
      })
    }
  }
  rec(join(root, CORE_LAYER_DIR))
  return { count: sites.length, sites }
}

/**
 * 单行判定：是否构成越层依赖。
 * 计入 `import ... from '@/core/...'`、`export ... from ...`、动态 `import('@/core/...')`；
 * 豁免：注释行、`import type`（类型面不产生运行时边）。
 */
export function detectExhibitionLayerImport(line) {
  const t = line.trim()
  if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false
  if (/^import\s+type\b/.test(t)) return false
  const hasImportSyntax = /\bfrom\s+['"]/.test(t) || /\bimport\s*\(\s*['"]/.test(t)
  return hasImportSyntax && EXHIBITION_LAYER_FORBIDDEN.test(t)
}

/** 扫一个 .vue 源码的越层 import 行数 */
export function countExhibitionLayerImports(content) {
  return content.split('\n').filter(detectExhibitionLayerImport).length
}

/** 扫展示层全部 .vue，返回 { count, sites: [{ file, line, text }] }（sites 供归因输出） */
export function scanExhibitionLayerImports(root = ROOT) {
  const sites = []
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) rec(p)
      else if (n.endsWith('.vue')) {
        const rel = relative(root, p).split(sep).join('/')
        readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
          if (detectExhibitionLayerImport(l)) sites.push({ file: rel, line: i + 1, text: l.trim().slice(0, 100) })
        })
      }
    }
  }
  for (const d of EXHIBITION_LAYER_DIRS) rec(join(root, d))
  return { count: sites.length, sites }
}

// ---- 判据 4：滑块生效测试（「加了滑块但没有测试引用」= 死数据风险） ----

/**
 * 存量缺口清单：2026-08-30 冻结时 77 个 settings id 里 49 个无任何测试引用。
 * 棘轮：新增滑块必须带「改滑块→结果确实变」的测试（AGENTS §2 滑块行 / 规则 5 同源思想）；
 * 存量补了测试就从下面删一行（漏删不红——与 fetch-stub 不同，多行清单无害但会过期，
 * 所以对「清单里其实已测」的行打 warn 提醒回收）。
 *
 * 2026-08-31 00:07 追加：orphie.frontSwitchRatio / jufufu.frontSwitchRatio 是并行会话
 * 时间预算任务的进行中 WIP（冻结清单后几分钟新增），其账本 Goal 含「补生效测试」。
 * 若该任务收尾后此二行仍在且无测试，即真实缺口。
 */
export const UNTESTED_SETTINGS_ALLOWLIST = [
]

/** 从 mechanics 模块源码抽 settings 块里的 id（字符串字面量 + 常量引用两种形态） */
export function extractSettingIds(moduleSource) {
  const lines = moduleSource.split('\n')
  let inBlock = false, depth = 0, buf = []
  for (const ln of lines) {
    if (!inBlock && /\bsettings\s*:\s*\[/.test(ln)) {
      inBlock = true
      depth = (ln.match(/\[/g) ?? []).length - (ln.match(/\]/g) ?? []).length
      buf = [ln]
      if (depth <= 0) inBlock = false
      continue
    }
    if (inBlock) {
      buf.push(ln)
      depth += (ln.match(/\[/g) ?? []).length - (ln.match(/\]/g) ?? []).length
      if (depth <= 0) inBlock = false
    }
  }
  if (!buf.length) return []
  const block = buf.join('\n')
  const literal = [...block.matchAll(/\bid\s*:\s*['"]([\w.\-]+)['"]/g)].map(m => m[1])
  const consts = [...block.matchAll(/\bid\s*:\s*([A-Z_][A-Z0-9_]*)\b/g)].map(m => {
    const def = moduleSource.match(new RegExp(`(?:const|let)\\s+${m[1]}\\s*=\\s*['"]([\\w.\\-]+)['"]`))
    return def ? def[1] : `UNRESOLVED:${m[1]}`
  })
  return [...literal, ...consts]
}

/**
 * 扫 src/mechanics/agents/ 的 settings 声明与全部 *.test.ts 的引用。
 * 返回 { declared: Map(module -> [ids]), untested: [module::id], stale: [清单里已测的] }
 */
export function scanSettingsCoverage(root = ROOT) {
  const agentsDir = join(root, 'src/mechanics/agents')
  const declared = new Map()
  for (const f of readdirSync(agentsDir).filter(f => f.endsWith('.ts'))) {
    const src = readFileSync(join(agentsDir, f), 'utf8')
    const ids = extractSettingIds(src)
    if (ids.length) declared.set(f, ids)
  }
  // 全部测试文本（src 下递归）
  const testTexts = []
  const rec = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) rec(p)
      else if (n.endsWith('.test.ts')) testTexts.push(readFileSync(p, 'utf8'))
    }
  }
  rec(join(root, 'src'))
  const allTests = testTexts.join('\n')
  const untested = []
  for (const [mod, ids] of declared) for (const id of ids) if (!allTests.includes(id)) untested.push(`${mod}::${id}`)
  const stale = UNTESTED_SETTINGS_ALLOWLIST.filter(e => !untested.includes(e))
  return { declared, untested, stale }
}

// ---- 判据 5：debt: 标记注册表（防「later = never」） ----

/**
 * 代码里的 debt: 标记注册表（AGENTS 规则 12）。新增标记必须在此登记（登记时写「到期动作」）；
 * 标记从代码里删除（债还清）必须同步销号，否则下面对不上即红。
 * 格式：'<file>:<标记关键词>' -> { since: '引入日期', due: '到期动作' }
 */
export const DEBT_REGISTRY = {
  // 2026-09-04：全局实数化收敛重构（正反馈模块统一连续通道 + 逐模块重校准）。伊德海莉
  // refund 双稳态已 targeted 修复（calcEnergySource 解析不动点 + iterate 阻尼实数 + 终局整数
  // 重推），全局松弛会重排所有带时间/资源循环模块的均衡（sigrid 出枪式消失前例）。
  'src/core/resource/helpers.ts:全局实数化收敛重构': { since: '2026-09-04', due: '专项立项：正反馈模块统一连续通道 + 逐模块重校准（sigrid/般岳等带时间/资源循环模块均衡重排风险，前例 bdcf52f 锚点漂移 8 处）' },
  // 2026-09-05：末轮欠打回填（可行性门控）把 refund 从「pass0 冻结成 0」救回来，但仍是
  // 「一次内层收敛」粒度的离散试探——同一天花板的第二个标记点，随上面那条专项落地一并销号。
  'src/core/resource.ts:全局实数化收敛重构': { since: '2026-09-05', due: '随 helpers.ts 同名词条一并销号（实数化收敛后折半试探不再需要）' },
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
  // 2026-09-12（账本交接欠账）：克拉蕾残痕「同时最多 3 层」是**时序**约束，整局总量口径只能表达成
  // 「不钳制 + 消耗需求封顶」⇒ 极端配装（积累速率 ≫ 消耗节奏）下偏乐观。上条会话因 check-guards.mjs
  // 被并行会话占用、按规则 13 先记账本不登记，本条补登（代码标记在 claret.ts gashStacks 计算处）。
  'src/mechanics/agents/claret.ts:残痕总量口径天花板': { since: '2026-09-12', due: '残痕层数按消耗节奏窗口钳制（需逐动作时序模拟，与实数化收敛专项同族）；若用户裁决接受总量口径近似则销号并留 @fact' },
  // 2026-09-13（静默缺口体检）：[秽盾] 全仓无建模——这是判据 13（名词表三态）抓到的**样本缺口**。
  // 原文 noun_3.2.3.json #2000002：高额防御/减伤/抗打断且不失衡、可被攻击削减、打破时净除伤害 + 回能/闪能。
  // 现状：`shieldCount` 只承载「破盾奖励次数→折能量」，不是盾本体；且旧头注释把秽盾当**无敌时间**
  // （2026-09-13 用户已纠正，口径见 src/core/effectiveTime.ts 的 @fact engine:time/无敌≠秽盾）。
  // 代码标记在 effectiveTime.ts 的未建模说明处；挂账登记落点亦见 docs/MECHANICS_IMPLEMENTATION.md §3.05。
  'src/core/effectiveTime.ts:秽盾机制': { since: '2026-09-13', due: '秽盾专项立项：① 破盾回能/闪能（每破一盾为代理人回能）② 削盾量通道（秽盾量/100 = 动作时间，见 mechanism-reference §7.4）③ 防御/减伤乘区（+80% 防御、25% 减伤，贯穿同样生效）④ 破盾「秽盾净除」伤害。四者都不许复用 invincibleTime（那是真无敌）。落地后销号' },
}

/**
 * 自指豁免：标记扫描器自身必然包含被扫描模式的字面量（与 GUARD_SYSTEM_FILES 同一性质，
 * 非债务）。scripts/zc.mjs 的事实抽取器把 'debt:' 列为 MARKERS 之一，头注释也统计它的
 * 出现次数——若不豁免，装上 zc 当天就会凭空多出两条「未登记债务」。
 */
// @fact engine:guards/自指豁免 口径: 扫描器自身含被扫模式的字面量属自指、不计违规（fetch-stub 用 GUARD_SYSTEM_FILES，debt 用本清单，事实扫描用占位符跳过） | 据 实测@2026-09-01·复核@2026-09-04·复核@2026-09-08 | 验 src/scripts/__tests__/zc.test.ts | 锚 scripts/check-guards.mjs#DEBT_SCAN_SELF_REFERENTIAL | 信 确认
export const DEBT_SCAN_SELF_REFERENTIAL = ['scripts/zc.mjs']

/** codebase 里实际的 debt: 标记 → [{ file, text }, ...]（text 为 'debt:' 后整段说明） */
export function scanDebtMarkers(root = ROOT) {
  const markers = []
  const rec = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      const rel = relative(root, p).split(sep).join('/')
      if (statSync(p).isDirectory()) {
        if (n === 'node_modules' || n === 'dist' || n === '__tests__') continue
        rec(p)
      } else if (/\.(ts|mjs|py)$/.test(n) && n !== 'check-guards.mjs' && !DEBT_SCAN_SELF_REFERENTIAL.includes(rel)) {
        const src = readFileSync(p, 'utf8')
        for (const ln of src.split('\n')) {
          const m = ln.match(/debt:\s*(.+)/)
          if (!m) continue
          markers.push({ file: rel, text: m[1].trim() })
        }
      } else if (/\.json$/.test(n) && rel.startsWith('src/specs/agents/')) {
        // 2026-09-10（账本 Open #6）：spec JSON 的 notes 里也写 debt: 标记，此前扫描不覆盖
        // → 既不计数也不登记（1411.json 那条债静默至今）。spec 是单行 JSON，逐行扫描即可。
        const src = readFileSync(p, 'utf8')
        for (const ln of src.split('\n')) {
          const m = ln.match(/debt:\s*(.+)/)
          if (!m) continue
          markers.push({ file: rel, text: m[1].trim().slice(0, 200) })
        }
      }
    }
  }
  rec(join(root, 'src'))
  rec(join(root, 'scripts'))
  return markers
}

/** 注册表 key 形如 '<file>:<关键词>'；标记与注册条目匹配 = 文件相同 && 标记文本包含关键词 */
export function matchDebtRegistry(markers) {
  const registered = Object.keys(DEBT_REGISTRY)
  const splitKey = (k) => [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
  const unregistered = markers.filter(m =>
    !registered.some(k => { const [f, kw] = splitKey(k); return f === m.file && m.text.includes(kw) }))
  const cleared = registered.filter(k => {
    const [f, kw] = splitKey(k)
    return !markers.some(m => m.file === f && m.text.includes(kw))
  })
  return { unregistered, cleared }
}

function listTrackedFiles(root) {
  try {
    return execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return null // 非 git 环境（如 zip 解包）跳过本判据，CLI 会打 warning
  }
}

// ---- 判据 13：名词表三态对账（防「数据在源里但没人消费」） ----
//
// 为什么需要：2026-09-13 实测——`data/raw/nanoka_missing/noun_3.2.3.json` 68 条名词里，
// [秽盾]（键 2000002）**全仓零消费锚点**：原文写「获得高额的防御力、减伤加成和抗打断能力提升
// 且不会失衡；代理人能通过攻击削减[秽盾]」「被打破时…回复能量或闪能」，而仓库只把
// `shieldCount` 当「破盾奖励次数」折能量——盾本体的防御/减伤/削盾量/破盾净除全无建模，
// 且 `core/effectiveTime.ts` 头注释还把秽盾当成**无敌时间**（旧口径，2026-09-13 用户已纠正）。
//
// 这类缺口**没有任何失败测试**：源数据在、代码也在，只是两者之间没有连线。机器不红 ⇒ 人不知道。
// 本判据把三态变成机器判据：**已建模**（src 有可解析消费锚点）/ **已挂账**（登记位置 + since）/
// **未处理**（两者皆无）——未处理即红。
//
// 三态数据由 `scripts/lib/noun-triage.json` 承载（逐条判定 + 证据），本判据只做**校验**：
// ① 覆盖完整性（源里的键一个不许漏、也不许多）
// ② `modeled` 的锚必须能被 `resolveAnchor` 解析（断锚 = 口径已过期，同判据 6 的哲学）
// ③ `deferred` 必须有 `registeredAt` + `since`（挂账不是"口头说说"，要有落点与日期）
// ④ 源数据自身变化（新增/删除名词）必须同步对账文件——否则新名词静默进来没人判
//
// 为什么允许「挂账」态：一次性把 68 条全修完不现实，全红会逼人**关掉判据**（判据失效）。
// 挂账 = 诚实处置（同 debt: registry / RATCHET_BURNDOWN 的哲学），未处理才是静默缺口。

/** 名词表三态对账文件（逐条判定 + 证据；由人工/子代理维护，本判据校验其自洽性） */
export const NOUN_TRIAGE_FILE = 'scripts/lib/noun-triage.json'
/** 名词表源（nanoka 原文；`noun*.json` 的当前唯一实文件） */
export const NOUN_SOURCE_FILE = 'data/raw/nanoka_missing/noun_3.2.3.json'
/** 三态取值（改这里 = 改判据语义，diff 里留痕） */
export const NOUN_STATES = ['modeled', 'deferred', 'unhandled']

/**
 * 名词表源文件的最小键数（**只减不增地**冻结；2026-09-14 实测 68）。
 *
 * 为什么要有（T15 对抗审计 #8 发现、本轮实测复核）：判据是「源里的键都要有对账」，
 * 于是**把源文件清空成 `{}` 反而全绿**（无项可审 = missing/extra/unhandled 全空）。
 * 源文件是 nanoka 原文转录的**外部事实面**，不该由本仓库的对账动作反向改写——
 * 键数一旦减少就是「源被削了」，必须红。要合法减少先改这个常量并写清为什么。
 */
export const NOUN_SOURCE_MIN_KEYS = 68

/**
 * 校验名词表三态对账。返回 { ok, source, triage, missing, extra, badState, noEvidence,
 * brokenAnchor, noRegister, unhandled, sourceShrunk }。
 *
 * 文件缺失：**源在、对账文件没了 = 红**（T15 审计 #2：那正是「把账本删掉就绿」的逃生通道）；
 * 只有两者都不在才返回 null（环境不全不误伤——与判据 9/10 同风格）。
 */
export function auditNounTriage(root = ROOT, resolveAnchorFn = resolveAnchor) {
  const srcPath = join(root, NOUN_SOURCE_FILE)
  // 最小键数下限只在**真实仓库**生效：单测 fixture 就是 1–2 条的最小样例（`root !== ROOT`
  // ⇒ 降级为「源/账至少一方的存在性必须自洽」那两条，不校验绝对条数）。
  // 否则每个最小 fixture 都得凑满 68 条噪音数据，判据的可测性反而被这条下限吃掉。
  const minKeys = root === ROOT ? NOUN_SOURCE_MIN_KEYS : 0
  const triagePath = join(root, NOUN_TRIAGE_FILE)
  const hasSource = existsSync(srcPath)
  const hasTriage = existsSync(triagePath)
  if (!hasSource && !hasTriage) return null
  if (hasSource && !hasTriage) {
    return {
      ok: false, source: {}, triage: { entries: {} }, sourceKeys: [], missing: [], extra: [],
      badState: [], noEvidence: [], brokenAnchor: [], noRegister: [], unhandled: [],
      sourceShrunk: [`源文件在（${NOUN_SOURCE_FILE}）但对账文件缺失（${NOUN_TRIAGE_FILE}）→ 补回对账文件（删账本不能让判据变绿）`],
    }
  }
  if (!hasSource && hasTriage) {
    return {
      ok: false, source: {}, triage: {}, sourceKeys: [], missing: [], extra: [],
      badState: [], noEvidence: [], brokenAnchor: [], noRegister: [], unhandled: [],
      sourceShrunk: [`对账文件在（${NOUN_TRIAGE_FILE}）但源文件缺失（${NOUN_SOURCE_FILE}）→ 源是外部事实面，不该被删`],
    }
  }
  const source = JSON.parse(readFileSync(srcPath, 'utf8'))
  const triage = JSON.parse(readFileSync(triagePath, 'utf8'))
  const entries = triage.entries ?? {}
  const sourceKeys = Object.keys(source)
  const triagedKeys = Object.keys(entries)
  const missing = sourceKeys.filter(k => !triagedKeys.includes(k))
  const extra = triagedKeys.filter(k => !sourceKeys.includes(k))
  const badState = []
  const noEvidence = []
  const brokenAnchor = []
  const noRegister = []
  const unhandled = []
  // 源被削（清空 = 无项可审 = 全绿）是最廉价的假绿通道，见 NOUN_SOURCE_MIN_KEYS
  const sourceShrunk = sourceKeys.length < minKeys
    ? [`源键数 ${sourceKeys.length} < 冻结下限 ${minKeys}（${NOUN_SOURCE_FILE}）→ 源是 nanoka 转录的事实面，不该变少；确需下调先改 NOUN_SOURCE_MIN_KEYS 并写明理由`]
    : []
  for (const [key, e] of Object.entries(entries)) {
    if (!NOUN_STATES.includes(e.state)) badState.push(`${key} ${e.name ?? ''} → state=${e.state}`)
    // trim：纯空格/换行不算证据（T15 审计 #9）
    if (!e.evidence?.trim()) noEvidence.push(`${key} ${e.name ?? ''}`)
    if (e.state === 'modeled') {
      const r = resolveAnchorFn(e.anchor, root)
      if (!r.ok) brokenAnchor.push(`${key} ${e.name ?? ''} → ${e.anchor ?? '(缺锚)'}（${r.reason}）`)
    }
    if (e.state === 'deferred' && (!e.registeredAt || !e.since)) {
      noRegister.push(`${key} ${e.name ?? ''} → registeredAt=${e.registeredAt ?? '(缺)'} since=${e.since ?? '(缺)'}`)
    }
    if (e.state === 'unhandled') unhandled.push(`${key} ${e.name ?? ''}｜${e.evidence ?? '（无证据）'}`)
  }
  const ok = missing.length === 0 && extra.length === 0 && badState.length === 0
    && noEvidence.length === 0 && brokenAnchor.length === 0 && noRegister.length === 0
    && unhandled.length === 0 && sourceShrunk.length === 0
  return { ok, source, triage, sourceKeys, missing, extra, badState, noEvidence, brokenAnchor, noRegister, unhandled, sourceShrunk }
}

// ---- 判据 14：死通道扫描（防「接口/参数在但实现没接」） ----
//
// 为什么需要：2026-09-13 连续发现三类「机器不红、人就发现不了」的通道：
//   ① **导出的可选项零调用**——`difficultyCurve.ts` 曾有从未接线的 `goldLevel` 死参数
//      （`bac9ce9` 引入 → `82c323a` 移除）。类型上可选、编译通过、测试不红，就是没人传。
//   ② **引擎读的配置字段全库零数据**——`invincibleTime`：引擎 6 处读、面板可写、类型有，
//      但 `boss-presets.json` 23 boss / **159 期相**里只有 12 个 boss 有值、期相 **0** 条 ⇒ 通道空转。
//   ③ **手写 `.d.mts` 声明与 `.mjs` 实际导出漂移**——`check-guards.d.mts` 曾漏声明
//      `CORE_ROLE_IMPORT_BASELINE`，而 `checkGuards.test.ts` 从 `.mjs` 具名 import ⇒ TS2305。
//      `.d.mts` 是**手写的影子 API**，被 `tsconfig.app` 的 `src/**` 消费 ⇒ 漂移只在 `vue-tsc` 暴露。
//
// 三条子判据都是**只报不红 + 白名单豁免（带 since/due）**：首轮必然有存量误报（外部契约字段、
// 预留通道、测试专用），一次性全红会逼人关掉判据。红线只给「**新增未登记**」——
// 与 debt: registry（判据 5）同款：豁免要写进清单（diff 里留痕），清单过期（已不再命中）也红。

/** 死通道豁免清单：key = `A|<file>:<line> <name>` 形式，value = { since, due, why } */
export const DEAD_CHANNEL_ALLOWLIST = {
  // 段 A：导出可选项零读零写（goldLevel 模式）
  // ⚠ 2026-09-15 销号 3 条（**假阳性**，非真债）：coverageMap / moduleInputRows ×2 全部是
  // **完全接通的活通道**，因读判定漏了「裸标识符 + 位置实参」形态而被误记成死通道
  // （详见 scanDeadOptionalProps 头注的取证）。修检测器后这 3 条自然不再命中 ⇒ 从清单删除
  // （棘轮只减不增：留着即 stale 红）。
  'A|src/composables/runArchiveImport.ts weaknesses': {
    since: '2026-09-13',
    action: '归档导入的弱点字段未消费——归档只做单条部署对照（用户裁决 2026-09），确认无用途后删',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '归档导入 DTO 的展示字段；按用户裁决归档不作误差判据，可能永远不需要',
  },
  'A|src/composables/runArchiveImport.ts hpTotal': {
    since: '2026-09-13',
    action: '同 weaknesses，随归档导入 DTO 一并处置',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '归档导入 DTO 字段，无消费点',
  },
  // 段 B：可选项只读不写（invincibleTime 模式；`?? 默认值` 兜底 ⇒ 静默走默认）
  'B|src/composables/difficultyLadder.ts minGain': {
    since: '2026-09-13',
    action: 'LadderOpts.minGain 无人传（minGainRatio 才是活通道）——确认为无用则删，或接上调用点后销号',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写：实现读 `opts.minGain ?? 0`，全仓零写入点（同族的 minGainRatio 有调用点）',
  },
  'B|src/composables/difficultyLadder.ts maxSteps': {
    since: '2026-09-13',
    action: 'LadderOpts.maxSteps 无人传（走 `?? 24` 默认）——确认默认即唯一口径则删字段',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写：实现读 `opts.maxSteps ?? 24`，全仓零写入点',
  },
  // ⚠ 2026-09-15 销号 2 条（**假阳性**）：`minGain`（difficultyLadder）与 `zeroEnergyRow`
  // （multiplierCoefficients）被判「只读不写」，但实测都有写入点，只是形态是**对象字面量简写**
  // （`{ …, zeroEnergyRow }` / 调用点的 `minGain,`）——而原写判定 `reWrite` 要求冒号。
  // 修 scanReadOnlyOptionalProps（补 reShorthand，逐行排除 const/let/var 绑定）后自然不再命中。
  // `zeroEnergyRow` 证据链：`:146` 计算 → `:149` 用它打标 → `:164` 简写写入 → `:299` 消费。
  'B|src/composables/pullPlannerEngine.ts freePoolPerSpecialty': {
    since: '2026-09-13',
    action: '抽卡规划器的 freePoolPerSpecialty 无人传——接上 UI 或删除',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写（走 `?? 默认`）；抽卡价值只用期望值口径（用户裁决 2026-09-01），该字段疑似旧模拟残留',
  },
  'B|src/composables/timeWeightBalancer.ts minWeight': {
    since: '2026-09-13',
    action: 'minWeight 只读不写——确认默认值即唯一口径则删字段',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写（走 `?? 默认`）',
  },
  // ⚠ 本条是**扫描器已知盲区的产物**，登记理由与上面几条（真死通道）不同：见 why + kind。
  // kind: 'namesake' ⇒ 它是「名字撞车」的记录，不是「待处置的死通道」——
  // 故**不进 burn-down 计数**（见 countDeadChannelWorkload）：它的 reads 恒 > 0，候选永远不会消失，
  // 拿它当待办会让棘轮永远还不完（T15 审计 #13）。真正的处置对象是上面那些 kind 缺省的条目。
  'B|src/composables/runArchiveImport.ts resistances': {
    kind: 'namesake',
    since: '2026-09-13',
    action: '归档 DTO 的 resistances 字段——与 weaknesses/hpTotal 同族（活动/归档 JSON 契约面），随归档 DTO 一并确认删留',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '**名字撞车导致的误报**（实测核实）：本扫描器按字段名全仓计数，reads=21 全部来自 src/stores/config.ts 的**同名但无关**字段 `EnemyConfig.resistances`（旧版单表抗性，:1068/:1285 有兼容读取）；归档的 `ArchiveRoom.resistances` 自身零消费者（run-archive.json 实测 0 处出现该键）。这是 T10 报告的盲区②「跨类型同名结构写入」的样本——判据 14 是字段名级启发式，不是符号级引用分析。**留着这条登记而非删掉判据**：它如实记录了「此处有一个名字撞车的字段」，且 T10 用 TypeScript LanguageService 复核过同族字段（weaknesses/hpTotal 真为零读零写）。',
  },
  'B|src/core/damage.ts isRupture': {
    since: '2026-09-13',
    action: 'DirectDamageInput.isRupture 零写入——函数体内已用 profile 判贯穿，确认冗余后删',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写：`input.isRupture ? RUPTURE_DAMAGE_PROFILE : …` 的兼容入参，全仓调用点都改传 specialDamageProfile（resolveSpecialDamageProfile），该入参已成死通道',
  },
  'B|src/core/effectiveTime.ts blockSeconds': {
    since: '2026-09-13',
    action: 'phaseDelayedCooldown 的 blockSeconds 形参无人传（走 `?? c` 旧口径）——接上 frontBlockSeconds 或删形参',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写；注意 frontBlockSeconds 是被测试与调用方用的活通道，死的是 phaseDelayedCooldown 的这个形参',
  },
  // ⚠ 2026-09-15 销号 2 条（**假阳性**）：`stunAxisPresets` 的 chapter / guarantee 被判「只读不写、
  // 预设数据里没人填」，但实测**数据就在 JSON 里**：`src/data/stunAxisPresets/{0章-琉,0章其他,
  // 1章-琉,1章其他}.json` 各有 `"chapter": 0/1`（`stunAxisPresets.test.ts:153-156` 逐条断言），
  // `5火10大.json` 有 `guarantee`。原判据只在 `.ts/.vue` 语料里找写入 ⇒ 数据驱动的字段一律误判。
  // 修 scanReadOnlyOptionalProps（写判定语料扩到 JSON）后自然不再命中，故从清单删除。
  // 原 why「chapter 疑似未填」是**错的**（规则 16：文档/注释也会骗 agent，故此处留痕纠正）。
  // 段 C（手写 .d.mts 漂移）**首轮即清零**：本判据上线时把 check-guards.d.mts 的漏声明一次补齐
  // （16 个：判据 12 的 CORE_LAYER_DIR/scanCoreRoleImports + 判据 13/14/15 的全部新导出），
  // 故无 C 段豁免条目——这正是判据该有的用法：发现漂移 → 补齐声明 → 清单为空。
  // ⚠ 以后 C 段真出现漂移，正解同样是补声明而不是登记豁免。
}

/**
 * 去掉**注释**与**字符串字面量**，供判据 14 的字段名计数使用。
 *
 * 为什么需要（2026-09-14 实测缺陷，两段各自独立咬过一次）：
 * 本判据按**字段名文本**计数，于是任何「不是代码」的地方出现 `name:` / `.name` 都算活引用。
 * ① **字符串字面量**：并行车道新增的 `deadChannelLs.test.ts` 里一行 `{ resistances: {} }`
 *    夹具构造串，让判据 14-B 当场 10→9——真实死通道 `B|…runArchiveImport.ts resistances`
 *    被抹掉，判据反而报「豁免过期」而红。
 * ② **注释**（同日 T15 对抗审计发现、实测复核）：`// TODO: resistances: 待接` 或
 *    `/* blockSeconds: 旧口径 *​/` 同样算写入点 ⇒ 一条 TODO 注释就能把真死通道洗白。
 *    这是**唯一会因日常写 TODO 而静默失效**的形态。
 * 顺序要紧：**先剥注释再去串**。反过来的话，`// '` 这种注释里的引号会先把「串」开在错误位置，
 * 把后半段真代码整段吞掉（实测：反过来做会把 `const a = 1` 之后的行吃光）。
 * 去两侧（reads/writes）口径一致，B 段实测恢复为冻结基线 10 条。
 *
 * ③ **复合赋值**（2026-09-15 实测缺陷，false-red 面）：写入检测原式 `\.name\s*=(?!=)`
 *    只认简单赋值，不认 `??=` / `||=` / `&&=`。自由对比工作台的 `FreeCompareSeries.downgrades?`
 *    在 `engine.ts` 用 `(out[si].downgrades ??= [])` 写入，却被判 `writes=0` 打成死通道——
 *    **把已接上的通道报成死的**，会逼人去登记假豁免（比漏报更危险）。
 *    修复 = 正则加 `(?:\?\?|\|\||&&)?` 前缀（A/B 两段同改）；实测只清掉这 1 条误报，
 *    其余冻结条目零变化。判据 `checkGuards.test.ts`「复合赋值也算写入」钉住。
 */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // 块注释（含 JSDoc）
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')   // 行注释（避开 `https://` 的假注释）
}

export function stripCommentsAndStrings(text) {
  return stripStringLiterals(stripComments(text))
}

/**
 * 按 `root` 键控的记忆化（判据 14 两个扫描器的性能修复，2026-09-16）。
 *
 * ## 为什么要（实测）
 * `scanDeadOptionalProps` / `scanReadOnlyOptionalProps` 是**纯函数**：同一 root 在同一次
 * 运行内结果恒定。但它们的实现是「对**每条候选声明**都遍历全部源文件」——
 * 实测 A 段：309 条声明 × 4 条正则 × 457 个文件 ≈ **565 万次正则匹配**，
 * 且每条声明都把 1.2MB 语料**重新 `stripCommentsAndStrings` 一遍**（实测该步单独 ≈ 20s）。
 * 而 `checkGuards.test.ts` 里三条用例会**重复调用**同一扫描器 ⇒ 重复序列实测 **37.1s**。
 *
 * ## ⚠ 为什么缓存键**必须含 root**（这是本修复唯一的风险点）
 * 测试用 `mkdtempSync` 造**各自的 fixture root** 调同一函数（`checkGuards.test.ts` 的
 * 「零读零写 = 死」等一组用例）。实测：fixture root 返回 `[]`、真实 root 返回 2 条 ——
 * 若只按函数名缓存，第二次调用就会**拿到另一个 root 的结果**，把死通道判据变成
 * 「第一个 root 说了算」的假绿。故键 = `函数名 + root`。
 * （fixture 用 `mkdtempSync` 保证路径唯一 ⇒ 不会两个不同内容共用同一键。）
 *
 * ⚠ 仅在同一次进程内有效；测试若改动 fixture 后**重新扫描同一 root**，须自行失效
 * （当前无此用法：每个 fixture 都是新 root）。
 */
const scanCache = new Map()
function memoScan(key, root, compute) {
  const k = key + '\u0000' + root
  if (scanCache.has(k)) return scanCache.get(k)
  const v = compute()
  scanCache.set(k, v)
  return v
}

/**
 * 去掉**字符串字面量**（模板串 / 单引号串 / 双引号串）。
 * 见 `stripCommentsAndStrings` 的说明——判据 14 用前者，本函数保留为可单测的最小单元。
 */
export function stripStringLiterals(text) {
  return text
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
}

/**
 * 段 A：导出可选项**零读零写**（`goldLevel` 模式）。
 * 范围 = `src/{core,composables,data}/**` 非测试文件里缩进 2–4 空格的 `name?: T` 声明。
 * 判定 = 全仓（含测试）既无读取形态也无写入形态（写入 = `name:` / `.name =`）。
 * 排除声明行自身（否则每个声明都自计一次写入）。计数前先去注释与字符串（见 stripCommentsAndStrings）。
 *
 * ⚠ **读判定必须含「裸标识符」形态**（2026-09-15 修，本判据上线以来最贵的一次假阳性）：
 * 原先 `reRead` 只认 `.name` / `??` / 解构 / `,name] =` 四种，于是**形参位置传参**与
 * **裸标识符真值判断**全都不算读。实测后果：3 条**完全接通**的通道被判「零读零写」进豁免清单——
 *   · `coverageMap` —— `buff.ts:777` 读 `coverageMap?.get(e.id)`（可选链）+
 *     `panel.ts:280/285` 以**位置实参**传入（`applyBuffs(a, b, config.effectCoverageMap)`）
 *   · `moduleInputRows` —— `helpers.ts:958-960` 真值判断 + `.length=0` + `.push()`（全裸标识符）+
 *     `resource.ts:77` 位置实参；`resource.ts:846-847` 传 `preModuleExecutions`，:898 被
 *     `buildResourceResult` 消费（**活通道，端到端可用**）
 * 这类假阳性的方向最坏：它把「已接好的通道」记成债，逼后来人去「接」一个本来就通的线
 * （或按清单「删死字段」把功能删掉）——与判据 14 立项目的（找真断线）恰好相反。
 * 修法 = 增一条 `reBare`：标识符**不以 `.` 开头**（排除 `x.name` 成员名与声明本身）、
 * 且右侧**不是单冒号**（排除 `name:` 对象字面量写入 = 写、以及 `name?:` 声明）。
 */
export function scanDeadOptionalProps(root = ROOT) {
  return memoScan('A', root, () => scanDeadOptionalPropsUncached(root))
}

function scanDeadOptionalPropsUncached(root) {
  const files = walkSrcFiles(root)
  const texts = files.map(f => [relPosix(root, f), readFileSync(f, 'utf8')])
  // strip 一次、全声明复用（见 memoScan 头注释：原先每条声明都重 strip 全语料，实测 ≈20s）
  const stripped = texts.map(([rel, text]) => [rel, stripCommentsAndStrings(text)])
  const decls = []
  for (const [rel, text] of texts) {
    if (rel.includes('__tests__')) continue
    if (!/^src\/(core|composables|data)\//.test(rel)) continue
    text.split('\n').forEach((ln, i) => {
      const m = ln.match(/^\s{2,4}(\w+)\?\s*:\s*\S/)
      if (m) decls.push({ file: rel, line: i + 1, name: m[1] })
    })
  }
  const count = (name, excludeFile, excludeLine) => {
    const reRead = new RegExp('[.\\?]\\.?' + name + '\\b|\\b' + name + '\\s*\\?\\?|\\{\\s*' + name + '\\s*[,}]|\\b' + name + '\\s*[,}]\\s*=', 'g')
    // 裸标识符读（2026-09-15 补）：非成员访问、非对象字面量键、非可选声明。
    // `(?!\s*:\s*[^:=])` 放行 `name: value`（写）与 `name?: T`（声明），但 `name ? a : b` 里
    // 的 `name` 后跟空格+`?`+空格，不匹配 `:` ⇒ 仍算读（三元真值判断是真读）。
    const reBare = new RegExp('(?<![.\\w$])' + name + '\\b(?!\\s*:)(?!\\s*\\?\\s*:)', 'g')
    const reWrite = new RegExp('(^|[\\s{,(])' + name + '\\s*:(?!:)', 'g')
    const reAssign = new RegExp('\\.' + name + '\\s*(?:\\?\\?|\\|\\||&&)?=(?!=)', 'g')
    let reads = 0, writes = 0
    // 复用预先 strip 好的语料（原先在此对每条声明重 strip 全部文件）
    for (const [rel, strippedText] of stripped) {
      let t = strippedText
      if (rel === excludeFile) {
        const lines = t.split('\n')
        lines.splice(excludeLine - 1, 1)
        t = lines.join('\n')
      }
      reads += (t.match(reRead) ?? []).length + (t.match(reBare) ?? []).length
      writes += (t.match(reWrite) ?? []).length + (t.match(reAssign) ?? []).length
    }
    return { reads, writes }
  }
  const dead = []
  for (const d of decls) {
    const { reads, writes } = count(d.name, d.file, d.line)
    if (reads === 0 && writes === 0) dead.push({ ...d, reads, writes, key: `A|${d.file} ${d.name}` })
  }
  return dead
}

/**
 * 段 B：可选项**只读不写**（`invincibleTime` 模式的字段级同款：引擎读、面板可写、数据不给）。
 * 实现里有 `?? 默认值` 兜底 ⇒ 缺数据时静默走默认，不报错——正是"通道空转"的形态。
 *
 * ⚠ **数据文件里的键必须算「写」**（2026-09-15 修第二个假阳性）：原先写判定只在 `.ts/.vue`
 * 语料里找 `name:`，于是**由 JSON 供给的字段**一律被判「只读不写」。实测后果：
 * `stunAxisPresets` 的 `chapter` / `guarantee` 被判死通道，而它们**有数据**：
 *   · `chapter` —— `src/data/stunAxisPresets/{0章-琉,0章其他,1章-琉,1章其他}.json` 各有
 *     `"chapter": 0/1`，且 `stunAxisPresets.ts:234` 真按它过滤
 *   · `guarantee` —— `5火10大.json` 有值，`TeamConfigPage.vue:1140` 读它
 * 与判据 10（catalog/raw 对账）同族：**数值的唯一事实源常在 JSON 而非 TS**，
 * 只看 TS 会把「数据驱动」误判成「通道空转」。
 */
export function scanReadOnlyOptionalProps(root = ROOT) {
  return memoScan('B', root, () => scanReadOnlyOptionalPropsUncached(root))
}

function scanReadOnlyOptionalPropsUncached(root) {
  const files = walkSrcFiles(root)
  const texts = files.map(f => [relPosix(root, f), readFileSync(f, 'utf8')])
  // strip 一次、全声明复用（同 A 段；原先每条声明重 strip 全语料）
  const stripped = texts.map(([rel, text]) => [rel, stripCommentsAndStrings(text)])
  // 数据语料（2026-09-15 补）：JSON 里的 `"name":` 即「有人供给这个字段」。
  const jsonTexts = []
  for (const dir of ['src', 'public/static']) {
    const rec = (d) => {
      if (!existsSync(d)) return
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(n)) rec(p) }
        else if (n.endsWith('.json')) jsonTexts.push([relPosix(root, p), readFileSync(p, 'utf8')])
      }
    }
    rec(join(root, dir))
  }
  const decls = []
  for (const [rel, text] of texts) {
    if (rel.includes('__tests__')) continue
    if (!/^src\/(core|composables|data)\//.test(rel)) continue
    text.split('\n').forEach((ln, i) => {
      const m = ln.match(/^\s{2,4}(\w+)\?\s*:\s*\S/)
      if (m) decls.push({ file: rel, line: i + 1, name: m[1] })
    })
  }
  const count = (name, excludeFile, excludeLine) => {
    const reRead = new RegExp('[.\\?]\\.?' + name + '\\b|\\b' + name + '\\s*\\?\\?|\\{\\s*' + name + '\\s*[,}]|\\b' + name + '\\s*[,}]\\s*=', 'g')
    const reWrite = new RegExp('(^|[\\s{,(])' + name + '\\s*:(?!:)', 'g')
    const reAssign = new RegExp('\\.' + name + '\\s*(?:\\?\\?|\\|\\||&&)?=(?!=)', 'g')
    // 简写属性写（2026-09-15 修第三个假阳性）：`{ …, zeroEnergyRow }` 与 `zeroEnergyRow: v` 等价，
    // 但 reWrite 要求冒号 ⇒ 简写形态被判「零写入」。实测事故：`multiplierCoefficients.ts:164`
    // 的 `zeroEnergyRow,` 是**真写**（:146 计算、:149 用它打标、:299 消费），却被记成只读不写。
    //
    // ⚠ 必须限定「该标识符处在对象/数组**字面量**里」——否则 `Math.max(minGain, base * …)`
    // 这类**函数实参**会被误判成对象简写（那不是写、是读），把**真死通道洗白**
    // （本判据最坏的失效方向；第一版用「前面有 `{` 或有 `,`」就踩了：`minGain` 只有读却因
    //  该行被判「有写入」而退出死通道集合——靠「真死通道仍报」的反向用例抓到）。
    // 判据 = 逐字符扫该标识符**之前**的前缀，跟踪小括号深度；深度为 0 时最后出现的
    // 开符是 `{` 或 `[` ⇒ 在字面量里 = 简写写；是 `(`（函数实参）⇒ 不算写。
    // 同时排除 `const/let/var/function` 绑定声明行。
    // 注意匹配起点：`name` 可能在行首（仅缩进）⇒ 不能用 `[\s{,(]` 作前置捕获，
    // 否则 match.index 落在前一个空白上、前缀切错（第一版即此 bug，`zeroEnergyRow,` 未被识别）。
    const reShorthand = new RegExp('(?<![.\\w$])' + name + '\\s*(?=[,}])', 'g')
    let reads = 0, writes = 0
    // 复用预先 strip 好的语料（原先对每条声明重 strip 全部文件）
    // 同段 A：夹具串/注释里的 `resistances:` 曾把本条真实的死通道抹掉（见 stripCommentsAndStrings）
    for (const [rel, strippedText] of stripped) {
      let t = strippedText
      if (rel === excludeFile) {
        const lines = t.split('\n')
        lines.splice(excludeLine - 1, 1)
        t = lines.join('\n')
      }
      // 简写写判定：必须扫**整份文本**并维护**定界符栈**。
      // 两个反例逼出了正确形态（都实测过）：
      //   ① 按行扫 ⇒ 对象字面量跨行（`units.push({` 在前、`zeroEnergyRow,` 在 20 行后）看不到 `{`；
      //   ② 只认「小括号深度 0 时的 `{`」⇒ 上例的 `{` 在 `push(` 里面（深度 1）照样漏。
      // 正确判据 = 该标识符处**栈顶**是 `{` 或 `[`（= 处在对象/数组字面量里 = 简写写）；
      // 栈顶是 `(`（函数实参，如 `Math.max(minGain, …)`）= 读，不算写。
      let shorthandWrites = 0
      {
        const stack = []
        const bindRe = new RegExp('\\b(?:const|let|var|function)\\s+' + name + '\\b')
        const lineOf = (idx) => { const i = t.lastIndexOf('\n', idx - 1); return t.slice(i + 1, t.indexOf('\n', idx) === -1 ? t.length : t.indexOf('\n', idx)) }
        reShorthand.lastIndex = 0
        let m
        let cursor = 0
        while ((m = reShorthand.exec(t))) {
          for (; cursor < m.index; cursor++) {
            const ch = t[cursor]
            if (ch === '(' || ch === '{' || ch === '[') stack.push(ch)
            else if (ch === ')' || ch === '}' || ch === ']') stack.pop()
          }
          const top = stack[stack.length - 1]
          if (!bindRe.test(lineOf(m.index)) && (top === '{' || top === '[')) shorthandWrites++
        }
      }
      reads += (t.match(reRead) ?? []).length
      writes += (t.match(reWrite) ?? []).length + (t.match(reAssign) ?? []).length + shorthandWrites
    }
    // JSON 供给（与 reWrite 同形态：`"name": value`）
    const reJsonWrite = new RegExp('"' + name + '"\\s*:', 'g')
    for (const [, t] of jsonTexts) writes += (t.match(reJsonWrite) ?? []).length
    return { reads, writes }
  }
  const out = []
  for (const d of decls) {
    const { reads, writes } = count(d.name, d.file, d.line)
    if (reads > 0 && writes === 0) out.push({ ...d, reads, writes, key: `B|${d.file} ${d.name}` })
  }
  return out
}

/**
 * 段 C：手写 `.d.mts` 与实际 `.mjs` **运行时导出**的一致性（TS2305 模式）。
 * 只看「值声明」（`export declare const/function/class/enum`），`interface`/`type` 是纯类型、
 * 不进运行时导出表，误报为漂移。
 *
 * 两个方向都报：
 * - `declared-not-exported`：`.d.mts` 声明了 `.mjs` 没有的值 ⇒ 具名 import 即 **TS2305**
 *   （实测事故：`CORE_ROLE_IMPORT_BASELINE`）。
 * - `exported-not-declared`：`.mjs` 导出了但影子 API 没写 ⇒ TS 侧看不见（本轮实测 2 处）。
 *
 * 实现用**静态抽取**而非 `import()`：本文件自己就是被对账对象之一，动态 import 会成环
 * （实测 `unsettled top-level await`），且执行 `.mjs` 顶层副作用对「导出表」这件事是多余的。
 */
export function scanDtsDrift(root = ROOT) {
  const dir = join(root, 'scripts')
  if (!existsSync(dir)) return { pairs: [], declaredNotExported: [], exportedNotDeclared: [] }
  const dts = []
  const rec = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) { if (!['node_modules', 'dist'].includes(n)) rec(p); continue }
      if (n.endsWith('.d.mts')) dts.push(p)
    }
  }
  rec(dir)
  const pairs = []
  const declaredNotExported = []
  const exportedNotDeclared = []
  for (const dtsPath of dts.sort()) {
    const mjsPath = dtsPath.replace(/\.d\.mts$/, '.mjs')
    if (!existsSync(mjsPath)) continue
    const dtsText = readFileSync(dtsPath, 'utf8')
    const mjsText = readFileSync(mjsPath, 'utf8')
    const typeOnly = new Set([...dtsText.matchAll(/export declare (?:interface|type)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]))
    const declared = [...new Set([...dtsText.matchAll(/export declare (?:const|function|class|enum|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]))]
    // `export * from '<spec>'` 递归解析（T15 审计 #11）：从 .mjs 所在目录解析相对路径，
    // 越出 root 或文件不存在时返回 null（→ 标记名进 runtime，判据变红而非静默）
    const rtSeen = new Set()
    const rtResolve = (spec) => {
      const dir = dirname(mjsPath)
      const abs = spec.startsWith('.') ? join(dir, spec) : null
      if (!abs || !existsSync(abs) || relPosix(root, abs).startsWith('..')) return null
      if (rtSeen.has(abs)) return { source: '', resolve: null }   // 防环
      rtSeen.add(abs)
      return { source: readFileSync(abs, 'utf8'), resolve: rtResolve }
    }
    const runtime = extractRuntimeExports(mjsText, rtResolve)
    const relDts = relPosix(root, dtsPath)
    const relMjs = relPosix(root, mjsPath)
    const dOnly = declared.filter(d => !runtime.includes(d))
    const eOnly = runtime.filter(e => !declared.includes(e) && !typeOnly.has(e))
    pairs.push({ dts: relDts, mjs: relMjs, declared: declared.length, runtime: runtime.length })
    // key 逐符号展开（不是整组一个 key）：豁免/销号要能精到单个符号，
    // 否则「补了一个声明」就得把整组 key 重写一遍（清单会变成一次性消耗品）
    for (const n of dOnly) declaredNotExported.push({ dts: relDts, mjs: relMjs, names: [n], key: `C|${relDts}#${n}` })
    for (const n of eOnly) exportedNotDeclared.push({ dts: relDts, mjs: relMjs, names: [n], key: `C|${relDts}#${n}` })
  }
  return { pairs, declaredNotExported, exportedNotDeclared }
}

/**
 * 从 `.mjs` 源码静态抽取**运行时导出名**。
 * 覆盖四种合法写法：`export function/const/class/let/var <名>`、`export { a, b as c }`、
 * `export { x } from './y.mjs'`（re-export 也是运行时导出）、**`export * from './y.mjs'`**
 * （barrel 写法，2026-09-14 补，T15 审计 #11）。`export type`/`export default` 不计
 * ——前者不进运行时表，后者无具名绑定（本仓 scripts/ 实测零 default export，判据会锁死这条假设）。
 *
 * `export * from './y.mjs'` 必须**递归解析目标文件**（它把目标的所有具名导出原样re-export）：
 * 不解析就会把整组符号误判成 `declared-not-exported` 假红。递归带 visited 集合防环，
 * 目标文件缺失或越出 root 时**不静默**——记一条 `✗` 标记名，让判据变红而不是假装通过。
 *
 * @param source `.mjs` 源码
 * @param resolve 可选：把 `from '<spec>'` 解析成绝对路径（缺省 = 不递归，只当无导出）
 */
export function extractRuntimeExports(source, resolve = null) {
  const names = new Set()
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim()
      if (!seg) continue
      const as = seg.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      names.add(as ? as[2] : seg)
    }
  }
  for (const m of source.matchAll(/^export\s+\*\s+from\s*['"]([^'"]+)['"]/gm)) {
    if (!resolve) continue
    const target = resolve(m[1])
    if (!target) { names.add(`✗ unresolved export * from '${m[1]}'`); continue }
    for (const n of extractRuntimeExports(target.source, target.resolve)) names.add(n)
  }
  return [...names].sort()
}

/** `src/**` 下所有 .ts/.vue 文件（跳过 node_modules/dist/.git） */
function walkSrcFiles(root) {
  const out = []
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(n)) rec(p) }
      else if (/\.(ts|vue)$/.test(n)) out.push(p)
    }
  }
  rec(join(root, 'src'))
  return out.sort()
}

function relPosix(root, p) {
  return relative(root, p).split(sep).join('/')
}

/**
 * 死通道 burn-down 的**真实剩余工作量** = 豁免清单里 `kind !== 'namesake'` 的条数。
 *
 * 为什么单列这个函数（2026-09-14，T15 审计 #13）：namesake 条目（如 `resistances`）是
 * 「扫描器名字撞车」的**记录**，不是待处置的死通道——它的候选永远存在（reads 恒 > 0），
 * 永远不会 stale，把它算进 burn-down 会让棘轮**永远还不完**（假「有存量」）。
 * 反之若把它从清单删掉，判据又会对它误报 fresh。故：留在清单、但不计工作量。
 * `why` 里必须写明是 namesake（本函数只看 kind，不猜）。
 */
export function countDeadChannelWorkload(allowlist = DEAD_CHANNEL_ALLOWLIST) {
  return Object.values(allowlist).filter(v => v.kind !== 'namesake').length
}

/**
 * 按白名单豁免死通道候选；返回 { fresh, allowlisted, stale }。
 *
 * `stale`（清单里已不再命中的行）**只在同一段内计算**（key 前缀 `A|`/`B|`/`C|`）——
 * 三段各查各的：若拿 global key 列表去比单个段的命中集，A 段的条目会被 B 段调用误报成 stale。
 *
 * ⚠ **必须显式传 `segment`**（2026-09-14 修，T15 审计 #5 发现）：
 * 首版 `segments` 从 candidates 推断，于是「某段被清干净 ⇒ 该段候选集为空 ⇒ 该段永不查 stale」
 * ——实测 A 段清空后清单里 5 条 `A|` 记录永久留存，且棘轮读数照常下降（度量 = allowlisted.length，
 * 候选没了自然 0）。**「修好了但忘了销号」恰好是这个判据要抓的形态，却因为修好了而看不见**。
 * 现改为由**调用方声明本次扫的是哪一段**：候选为空也照常查该段 stale（空 = 全 stale = 红）。
 *
 * 不传 `segment` 时退回「从候选推断段」（`fresh`/`allowlisted` 仍然正确，`stale` 在空候选时为
 * 空数组）——**只给不理解 scope 的旧调用方兜底**，生产接线一律显式传。
 */
export function applyDeadChannelAllowlist(candidates, segment = null) {
  const keys = Object.keys(DEAD_CHANNEL_ALLOWLIST)
  const fresh = candidates.filter(c => !keys.includes(c.key))
  const allowlisted = candidates.filter(c => keys.includes(c.key))
  const hit = new Set(candidates.map(c => c.key))
  const segOf = (k) => k.slice(0, k.indexOf('|') + 1)
  // 显式 scope 优先（空候选也查）；否则从候选推断（旧行为，空候选 = 不查）
  const segments = segment
    ? new Set([segment.endsWith('|') ? segment : segment + '|'])
    : new Set(candidates.map(c => segOf(c.key)))
  const stale = segments.size === 0 ? [] : keys.filter(k => segments.has(segOf(k)) && !hit.has(k))
  return { fresh, allowlisted, stale }
}

// ---- 判据 15：口径复核触发器强制（防「旧结论静默过期」） ----
//
// 为什么需要：`zc drift` 已有「锚文件在『据』日期之后被改过」的点名机制，但它是**只报不红**，
// 且只看「锚文件 mtime」——看不见「口径本身需要定期复核」这件事。实测：手写 `@fact` 93 条里
// 85 条是**游戏语义**（口径=已定的算法/语义），而带 `⟳复核` 触发器的**一条都没有**
// （docs 里仅 3 条）⇒ 所有口径都是"永不过期"的，包括 `effectiveTime.ts` 那条
// 「无敌（秽盾/转阶段动画）」——用户 2026-09-13 才纠正，代码里已挂了 14 天没人发现。
//
// 判据形态 = **棘轮 + 豁免清单（带 since/due）**：
// - 存量口径进豁免清单（一次性），新增游戏语义口径缺 `⟳复核` 行 = 红；
// - 豁免清单条目补齐触发器后销号（清单过期即红 ⇒ burn-down，防「冻结 = 永久豁免」）；
// - 触发器写在 `@fact` 的**下一行注释**（`⟳复核: <到点判什么> | 到期 <YYYY-MM-DD>`）——
//   解析器只认 `据|验|锚|信` 槽位，未知前缀直接忽略 ⇒ 行尾追加不破坏 `parseFactLine`。
//
// 「游戏语义」判定 = 主体**不是**工程元口径（`engine:guards` / `engine:zc` / `ui:` / `utils:`）
// 且种类 ∈ {口径, 映射}。工程元口径的"复核"由守卫自己保证（判据红了就有人看），不需要挂日期。

/**
 * 工程元口径主体前缀（这些的复核靠守卫红，不靠日期提醒）——
 * `engine:guards`（护栏自身口径）/ `engine:zc`（工具链）/ `ui:`（UI 契约）/
 * `utils/`、`utils:`（通用工具）/ `engine:mechanics单一事实源`（校验器元规则）。
 * 用前缀匹配：主体写法既有 `utils:format` 也有 `utils/format/localized`（`/` 分隔）。
 */
export const CALIBER_NON_GAME_SUBJECTS = [
  'engine:guards', 'engine:zc', 'ui:', 'utils:', 'utils/',
  'engine:mechanics',
]
/** 需要复核触发器的种类（口径=已定语义；映射=术语↔字段对应，游戏改版即失效） */
export const CALIBER_TRIGGER_KINDS = ['口径', '映射']

/**
 * 工程元口径的**锚文件位**：`scripts/**`（工具链）· `docs/**`（手册）· `src/utils/**`（通用格式化/
 * 展示工具，与游戏机制无关）。
 *
 * `src/utils/**` 收进来的依据 = `docs/ARCHITECTURE.md` §0 的五层模型里它不属于任何机制层，
 * 内容是 `format.ts`（数字/本地化格式化）/ `statMeta.ts`（属性元数据）/ `modelingGaps.ts`（缺口提示）/
 * `image.ts`（图片 URL）这类纯工具——实测仓库里唯一的 `utils/` 前缀事实就是
 * `@fact utils/format/localized`（LocalizedString 解析口径，锚 src/utils/format.ts）。
 * 见 `isEngineeringFact` 的组合判据说明。
 */
export function isEngineeringAnchor(file) {
  return /^(scripts|docs|src\/utils)\//.test(file)
}

/**
 * 是否为「工程元口径」= subject 前缀命中 **且** 锚文件在工程位。
 *
 * 单看前缀是可逃逸白名单（作者改个 subject 就绕开判据）；单看文件位又会把
 * 「写在 src/ 里的工具函数口径」（如 `utils/format/localized`）误判成游戏口径。
 * 两者**同时**成立才豁免 —— 逃逸路径只剩「把锚挪出 src/**」，那已是真工程元口径。
 */
export function isEngineeringFact(fact, file) {
  return CALIBER_NON_GAME_SUBJECTS.some(p => fact.subject.startsWith(p)) && isEngineeringAnchor(file)
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
  "src/composables/resourceCalc/convergence.ts engine:轴内块数落地",
  "src/composables/resourceCalc/damagePool.ts engine:damage/减防通道",
  "src/composables/resourceCalc/damagePool.ts engine:damage/非轴失衡易伤",
  "src/composables/resourceCalc/feasibilitySearch.ts engine:降配搜索/非下闭可行集",
  "src/composables/resourceCalc/helpers.ts disc:覆盖率并入范围",
  "src/composables/resourceCalc/liuyinPromote.ts engine:实战档位喧响计数",
  "src/composables/resourceCalc/liuyinPromote.ts engine:失衡次数不动点",
  "src/composables/stunVulnSummary.ts engine:失衡易伤可见化/加权信用",
  "src/composables/teamCompare.ts engine:操作难度/权重可调",
  "src/composables/timeWeightAllocation.ts engine:分配策略/主C判定",
  "src/core/damage.ts engine:damage/乘区顺序",
  "src/core/effectiveTime.ts engine:stun/时间守恒",
  "src/core/panel.ts engine:driveDisc/固定主词条",
  "src/core/resource/helpers.ts engine:能量收入行级Σ",
  "src/core/resource/helpers.ts engine:喧响收入行级Σ",
  "src/core/resource/helpers.ts engine:时间线截断",
  "src/core/resource/helpers.ts yidhari:refund不动点",
  "src/core/resource/helpers.ts engine:合轴预算抵扣",
  "src/core/resource/helpers.ts engine:单角色前线上限",
  "src/core/resource.ts engine:欠打回填",
  "src/core/resource.ts engine:折叠环上限",
  "src/core/resource.ts engine:热启动逐位透明",
  "src/core/resource.ts engine:判稳含平A时间",
  "src/core/resource.ts engine:收敛环停点规范化",
  "src/core/resource.ts engine:资源账本/截断",
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

/**
 * 扫游戏语义口径缺 `⟳复核` 触发器的情况。
 * 「有没有触发器」= 该 `@fact` 行本身或**紧邻的下一行**（都是注释）里出现 `⟳复核` + `到期 <日期>`。
 * 返回 { game: [{file,line,subject,kind}], withTrigger, missing, stale }。
 */
export function scanCaliberTriggers(root = ROOT, facts = null) {
  const scanned = facts ?? scanAuthoredFacts(root)
  const game = []
  const withTrigger = []
  for (const s of scanned) {
    const f = s.fact
    if (!f || !CALIBER_TRIGGER_KINDS.includes(f.kind)) continue
    // 工程元口径豁免 = **subject 前缀命中 且 锚文件在工程位（scripts/ 或 docs/）**。
    // 为什么必须加后半条（2026-09-14 修，T15 审计 #10）：原先只看前缀，而前缀由作者自由书写
    // ⇒ **游戏口径只要把 subject 写成 `ui:agent/1561风华上限` 就整条不进 game 集**，
    // 既不红也不进清单（实测逃逸成功：game=0 / missing=0）。
    // 加锚文件判据后，「工程前缀 + 游戏代码」这一组合会被**当成游戏口径**要求触发器——
    // 逃逸要么放弃前缀、要么把锚挪出 src/**（后者是真工程元口径，合理）。
    if (isEngineeringFact(f, s.file)) continue
    const p = join(root, s.file)
    const lines = existsSync(p) ? readFileSync(p, 'utf8').split('\n') : []
    // 本行 + 下一行（允许 `⟳复核` 写在 @fact 行的尾部，或紧随其后单独一行）
    const near = [s.raw ?? '', lines[s.line] ?? ''].join('\n')
    const hasTrigger = /⟳复核[:：]/.test(near) && /到期\s*\d{4}-\d{2}-\d{2}/.test(near)
    const row = { file: s.file, line: s.line, subject: f.subject, kind: f.kind }
    if (hasTrigger) withTrigger.push(row)
    else game.push({ ...row, key: `${s.file} ${f.subject}` })
  }
  const exempt = new Set(CALIBER_TRIGGER_ALLOWLIST)
  const missing = game.filter(g => !exempt.has(g.key))
  const hit = new Set(game.map(g => g.key))
  const stale = CALIBER_TRIGGER_ALLOWLIST.filter(k => !hit.has(k))
  return { game, withTrigger, missing, stale }
}

// ---- 汇总 ----

/**
 * 全部判据。
 * **async**：判据 14-C 需要 `import()` 各 `.mjs` 拿运行时导出表（与手写 `.d.mts` 对账）——
 * 静态 import 会成环（本文件就是被对账对象之一）。
 */
export function runAllChecks(root = ROOT) {
  const results = []

  const { violations, stale } = scanFetchStubs(root)
  const extra = violations.filter(p => !FETCH_STUB_ALLOWLIST.includes(p))
  results.push({
    name: 'fetch-stub freeze (AGENTS §3: 新测试一律走 setupHarness)',
    ok: extra.length === 0 && stale.length === 0,
    detail: [
      ...extra.map(p => `  ✗ 新增 fetch stub：${p} → 改用 src/test/harness.ts 的 setupHarness / mockStaticFetch / setTeam`),
      ...stale.map(p => `  ✗ 清单过期：${p} 已迁移但仍在 FETCH_STUB_ALLOWLIST，删掉该行`),
    ],
  })

  const branchFiles = listAgentBranchFiles(root)
  const branches = countAgentBranchLines(root)
  results.push({
    name: `agentId ratchet (规则 6: 队伍级机制走 applyTeamConfig) ${AGENT_BRANCH_FILE} + resourceCalc/ = ${branches}/${AGENT_BRANCH_BASELINE}`
      + ` [AST 三形态: agentId/.id(四位数字)/teammateBuffId]`,
    ok: branches === AGENT_BRANCH_BASELINE,
    detail: branches > AGENT_BRANCH_BASELINE
      ? [`  ✗ 角色判定 ${AGENT_BRANCH_BASELINE}→${branches}：角色特例逻辑写进编排层了（度量面 ${branchFiles.length} 个文件）。移到 src/mechanics/agents/<id>.ts 的 applyTeamConfig（三阶段钩子）或声明式钩子（axisWindowOverlays / backstageAutoFill 等），派发器在 composables/resourceCalc/helpers.ts`,
        '  → 度量口径 = AST 三形态（`agentId` / `.id` 四位数字 / `teammateBuffId`），按行去重；',
        '     查当前清单：node scripts/report-agent-identity.mjs --md（分类 + 证据 + 观察项）']
      : branches < AGENT_BRANCH_BASELINE
        ? [`  ✗ 角色判定 ${AGENT_BRANCH_BASELINE}→${branches}：是进步，把 check-guards.mjs 的 AGENT_BRANCH_BASELINE 下调到 ${branches}（棘轮只减不增）`]
        : [],
  })

  // 引擎层同款棘轮（规则 6 在 core 的延伸；此前 core 是豁免区，评审实测 36 处无护栏）
  const coreBranches = countAgentIdBranchLinesInFiles(CORE_AGENT_BRANCH_FILES, root)
  results.push({
    name: `core agentId ratchet (规则 6 延伸: 引擎层角色无关) ${CORE_AGENT_BRANCH_FILES.join(' + ')} = ${coreBranches}/${CORE_AGENT_BRANCH_BASELINE}`,
    ok: coreBranches === CORE_AGENT_BRANCH_BASELINE,
    detail: coreBranches > CORE_AGENT_BRANCH_BASELINE
      ? [`  ✗ core 内 agentId 特判 ${CORE_AGENT_BRANCH_BASELINE}→${coreBranches}：引擎层应当角色无关。`,
        '    → 角色机制回 src/mechanics/agents/<id>.ts；跨角色联动走 applyTeamConfig 三阶段钩子；',
        '      确实需要引擎侧通用通道的，抽成 cfg 字段由模块写入（engine 读字段、不读 agentId）']
      : coreBranches < CORE_AGENT_BRANCH_BASELINE
        ? [`  ✗ core 内 agentId 特判 ${CORE_AGENT_BRANCH_BASELINE}→${coreBranches}：是进步，把 CORE_AGENT_BRANCH_BASELINE 下调到 ${coreBranches}（棘轮只减不增）`]
        : [],
  })

  const tracked = listTrackedFiles(root)
  if (tracked === null) {
    results.push({ name: 'workspace state not tracked (规则 13: 工作状态 ≠ 项目知识)', ok: true, detail: ['  ⚠ 非 git 环境，跳过'] })
  } else {
    const bad = findForbiddenTracked(tracked)
    results.push({
      name: 'workspace state not tracked (规则 13: 工作状态 ≠ 项目知识)',
      ok: bad.length === 0,
      detail: bad.map(p => `  ✗ 工作区状态文件被跟踪：${p} → git rm --cached（.zcode/ .zc/ .freebuff/ 已 gitignore）`),
    })
  }

  // ---- 判据 7：展示层越层 import 棘轮（ARCHITECTURE §0 依赖方向） ----
  const layer = scanExhibitionLayerImports(root)
  results.push({
    name: `exhibition-layer ratchet (ARCHITECTURE §0: 展示 → 编排 → 引擎，views/components 禁 import 引擎/录入层) = ${layer.count}/${EXHIBITION_LAYER_IMPORT_BASELINE}`,
    ok: layer.count === EXHIBITION_LAYER_IMPORT_BASELINE,
    detail: layer.count > EXHIBITION_LAYER_IMPORT_BASELINE
      ? [
        `  ✗ 越层 import ${EXHIBITION_LAYER_IMPORT_BASELINE}→${layer.count}：展示层直接 import 了 @/core|@/mechanics|@/specs`,
        '    → 常量/纯函数下沉 src/data/，或经编排层（composables）透出；import type 不算越层',
        ...layer.sites.slice(0, 12).map(s => `      ${s.file}:${s.line}  ${s.text}`),
      ]
      : layer.count < EXHIBITION_LAYER_IMPORT_BASELINE
        ? [`  ✗ 越层 import ${EXHIBITION_LAYER_IMPORT_BASELINE}→${layer.count}：是进步，把 check-guards.mjs 的 EXHIBITION_LAYER_IMPORT_BASELINE 下调到 ${layer.count}（棘轮只减不增）`]
        : [],
  })

  // ---- 判据 12：引擎层静态依赖具体角色模块棘轮（agentId 棘轮的语义补强面） ----
  const coreRole = scanCoreRoleImports(root)
  results.push({
    name: `core role-import ratchet (规则 6 语义面: 引擎按能力查询, 不按角色查询) src/core/** → @/mechanics/agents/* = ${coreRole.count}/${CORE_ROLE_IMPORT_BASELINE}`,
    ok: coreRole.count === CORE_ROLE_IMPORT_BASELINE,
    detail: coreRole.count > CORE_ROLE_IMPORT_BASELINE
      ? [
        `  ✗ 引擎层新增对具体角色模块的值导入 ${CORE_ROLE_IMPORT_BASELINE}→${coreRole.count}：`,
        '    → 角色数学回 src/mechanics/agents/<id>.ts，经 `AgentMechanicModule` 声明式字段暴露能力',
        '      （crossAgentSupply / axisWindowOverlays / backstageAutoFill / transformAnomalyPool …），',
        '      引擎按**能力**查询（`getAgentMechanic(id)?.<能力>`），不 import 具体模块、不写 id 字面量。',
        '    → 为什么另立判据：agentId 棘轮是词法判据，看不见这种耦合（它不写 id）——实测病灶是',
        '      core/resource.ts 曾住 135 行诺姆/琉音赠链数学，新角色接赠链必须改引擎。',
        ...coreRole.sites.slice(0, 12).map(s => `      ${s.file}:${s.line}  ${s.text}`),
      ]
      : coreRole.count < CORE_ROLE_IMPORT_BASELINE
        ? [`  ✗ core role-import ${CORE_ROLE_IMPORT_BASELINE}→${coreRole.count}：是进步，把 CORE_ROLE_IMPORT_BASELINE 下调到 ${coreRole.count}（棘轮只减不增）`]
        : [],
  })

  const settings = scanSettingsCoverage(root)
  const newGaps = settings.untested.filter(e => !UNTESTED_SETTINGS_ALLOWLIST.includes(e))
  results.push({
    name: `settings coverage (规则 12/§2: 滑块声明必须有「改了确实变」测试) 已测 ${[...settings.declared.values()].flat().length - settings.untested.length}/${[...settings.declared.values()].flat().length}`,
    ok: newGaps.length === 0,
    detail: [
      ...newGaps.map(e => `  ✗ 新滑块无测试引用：${e} → 补「改滑块→面板/结果确实变」的生效测试（ARCHITECTURE.md §3 滑块行，般岳 rageGainCoverage 曾静默失效）`),
      ...settings.stale.map(e => `  ⚠ 清单可回收：${e} 已有测试，从 UNTESTED_SETTINGS_ALLOWLIST 删掉该行`),
    ],
  })

  const markers = scanDebtMarkers(root)
  const { unregistered, cleared } = matchDebtRegistry(markers)
  results.push({
    name: `debt registry (规则 12: debt: 标记防「later = never») ${markers.length - unregistered.length}/${markers.length} 登记`,
    ok: unregistered.length === 0 && cleared.length === 0,
    detail: [
      ...unregistered.map(m => `  ✗ 未登记的 debt 标记：${m.file}: ${m.text.slice(0, 40)}… → 在 check-guards.mjs 的 DEBT_REGISTRY 登记一条（since=引入日期, due=到期动作）`),
      ...cleared.map(m => `  ✗ 已还清但未销号：${m} → 标记已不在代码里，从 DEBT_REGISTRY 删除该条`),
    ],
  })

  // ---- 判据 9：README §6 文档表 == docs/ 实际文件（防清单漂移不可见） ----
  const docs = auditDocTable(root)
  results.push({
    name: docs === null
      ? 'docs table (README §6 == docs/*.md) ⚠ 无 README，跳过'
      : `docs table (README §6 == docs/*.md) ${docs.actualCount} 份`,
    ok: docs === null || (docs.missing.length === 0 && docs.extra.length === 0 && !docs.countMismatch),
    detail: docs === null ? [] : [
      ...docs.missing.map(f => `  ✗ docs/${f} 未登记进 README §6 文档表 → 补一行（表里没有的文档 = agent 找不到）`),
      ...docs.extra.map(f => `  ✗ README §6 登记了 docs/${f}，但文件不存在 → 断链，删该行或补文件`),
      ...(docs.countMismatch ? [`  ✗ README §6 自述「${docs.declaredCount} 份」，实际 ${docs.actualCount} 份 → 改节标题里的数字`] : []),
    ],
  })

  // ---- 判据 6：手写 @fact 的锚必须解析得到（语言层，规则 8/9 的机器面） ----
  // 抽取自散文的事实不受约束（存量）；作者手写的 @fact 是新增承诺，必须能钉在代码上，
  // 否则口径会悄悄过期——这正是文档腐烂的形态，只是换了个更短的载体。
  // 语料含 docs/ 的声明行（2026-09-15 术语表 review 补的盲区）：规则 8 允许手册写「口径」，
  // 若不入语料则手册里的 @fact 断锚/缺据都不红——实测 3 条 docs 事实此前完全不可见。
  const authored = auditAuthoredFacts(root)
  results.push({
    name: `@fact anchors (语言层: 手写口径必须有据 + 锚得住) ${authored.scanned.length - authored.violations.length}/${authored.scanned.length}`,
    ok: authored.violations.length === 0,
    detail: authored.violations.map(v => {
      const how = {
        'parse-failed': '语法不合法 → node scripts/zc.mjs lang 看语法',
        'no-provenance': '缺「据」→ 补 | 据 用户@YYYY-MM-DD 或 实测@YYYY-MM-DD',
        'anchor-missing': '缺「锚」→ 补 | 锚 <路径>#<符号>（口径实现在哪）',
        'file-missing': '锚文件不存在 → 口径已过期，改锚或删事实',
        'symbol-missing': '锚符号不存在 → 实现改名/删除了，复核口径后改锚',
      }[v.problem] ?? v.problem
      return `  ✗ ${v.file}:${v.line} ${how}`
    }),
  })

  // ---- 判据 10：catalog level60 ↔ raw 源对账（坑 40：漏加突破加成是静默错误） ----
  const lv60 = auditCatalogLevel60(root)
  results.push({
    name: lv60 === null
      ? 'catalog/raw level60 对账 ⚠ 缺 catalog 或 raw 目录，跳过'
      : `catalog/raw level60 对账 (${lv60.fieldNames.join('/')}) ${lv60.compared - lv60.violations.length}/${lv60.compared}`,
    ok: lv60 === null || lv60.violations.length === 0,
    detail: lv60 === null ? [] : [
      ...lv60.violations.slice(0, 20).map(v =>
        `  ✗ ${v.id} ${v.name} level60.${v.field}: ${v.got} → 应为 ${v.want}（漏加满级突破加成？）`),
      ...(lv60.violations.length > 20 ? [`  …另有 ${lv60.violations.length - 20} 条`] : []),
      ...(lv60.violations.length > 0 ? [
        `  → 修：node scripts/patch-level60-ascension.mjs --write（改完跑 npm run verify 并量 timeGolden delta）`,
        `  → 全量报告（含不进本判据的容差/对照组）：node scripts/audit-catalog-level60.mjs`,
      ] : []),
    ],
  })

  // ---- 判据 11：手册数字 id 密度棘轮（任务卡 2026-09-12：防手册编年史化） ----
  const density = scanManualDensity(root)
  const dense = Object.entries(density).filter(([, d]) => d.density !== null && d.density > d.ceiling)
  results.push({
    name: dense.length === 0
      ? `手册密度棘轮 (规则 8 分层契约: 协议/口径/证据进手册, 编年史进 git/账本) ${Object.keys(density).length}/${Object.keys(density).length} 达标`
      : `手册密度棘轮 ✗ ${dense.length} 份超天花板`,
    ok: dense.length === 0,
    detail: dense.map(([f, d]) =>
      `  ✗ ${f} 密度 ${d.density} > 天花板 ${d.ceiling}（hits ${d.hits}/行 ${d.lines}）`
      + ` → 新案例叙事进 .claude 账本或 git，手册条目按「症状/根因/判据/否决记录」四栏模板写`),
  })

  // ---- 判据 13：名词表三态对账（防「数据在源里但没人消费」） ----
  const noun = auditNounTriage(root)
  const nounCounts = noun === null ? null : noun.triage.entries && {
    modeled: Object.values(noun.triage.entries).filter(e => e.state === 'modeled').length,
    deferred: Object.values(noun.triage.entries).filter(e => e.state === 'deferred').length,
    unhandled: noun.unhandled.length,
  }
  results.push({
    name: noun === null
      ? `名词表三态对账 ⚠ ${NOUN_SOURCE_FILE} 与 ${NOUN_TRIAGE_FILE} 均缺失，跳过`
      : `名词表三态对账 (${NOUN_SOURCE_FILE}: ${noun.sourceKeys.length} 条 → modeled ${nounCounts?.modeled ?? 0} / deferred ${nounCounts?.deferred ?? 0} / unhandled ${nounCounts?.unhandled ?? 0})`,
    ok: noun === null || noun.ok,
    detail: noun === null ? [] : [
      ...(noun.sourceShrunk ?? []).map(s => `  ✗ 源面异常：${s}`),
      ...noun.missing.map(k => `  ✗ 源里有但未对账：${k} ${noun.source[k]?.name ?? ''} → 在 ${NOUN_TRIAGE_FILE} 补一条三态判定`),
      ...noun.extra.map(k => `  ✗ 对账文件多出源里没有的键：${k} → 源数据已变，删该条`),
      ...noun.badState.map(s => `  ✗ state 非法：${s} → 只许 ${NOUN_STATES.join(' / ')}`),
      ...noun.noEvidence.map(s => `  ✗ 缺 evidence：${s} → 写一句话（在哪找到的什么 / 搜了什么没找到）`),
      ...noun.brokenAnchor.map(s => `  ✗ modeled 但锚解析不到：${s} → 改锚或降级为 deferred/unhandled（断锚 = 口径已过期）`),
      ...noun.noRegister.map(s => `  ✗ deferred 但缺登记：${s} → 补 registeredAt（<文件>:<行>）与 since（日期）`),
      ...noun.unhandled.map(s => `  ✗ 未处理（红）：${s} → 建模（补 src 消费锚点）或挂账（登记进 docs 待办/DEBT_REGISTRY）；`
        + '挂账也是合法处置，见判据 13 头注释'),
      ...(noun.unhandled.length > 0 ? [
        `  → 数据在源里但没人消费 = 无失败测试的静默缺口（[秽盾] 就是这么漏了 14 天）。`,
        `  → 本轮只要求「每条有着落」：modeled 给锚 / deferred 给登记 / unhandled 清零。`,
      ] : []),
    ],
  })

  // ---- 判据 14：死通道扫描（防「接口/参数在但实现没接」） ----
  {
    // 显式传段：候选为空时也要查该段清单是否该销号（见 applyDeadChannelAllowlist 的 ⚠ 说明）
    const deadA = applyDeadChannelAllowlist(scanDeadOptionalProps(root), 'A')
    const deadB = applyDeadChannelAllowlist(scanReadOnlyOptionalProps(root), 'B')
    const dts = scanDtsDrift(root)
    const dtsDrift = [...dts.declaredNotExported, ...dts.exportedNotDeclared]
    const dtsFresh = applyDeadChannelAllowlist(dtsDrift, 'C')
    const fresh = [...deadA.fresh, ...deadB.fresh, ...dtsFresh.fresh]
    const stale = [...deadA.stale, ...deadB.stale, ...dtsFresh.stale]
    const counts = `A 零读零写 ${deadA.allowlisted.length} / B 只读不写 ${deadB.allowlisted.length} / C dts 漂移 ${dtsFresh.allowlisted.length}`
    results.push({
      name: `死通道扫描 (规则 16: 接口在实现没接) ${counts} 已豁免`,
      ok: fresh.length === 0 && stale.length === 0,
      detail: [
        ...fresh.map(c => `  ✗ 新增未登记死通道：${c.key}${'reads' in c ? `（reads=${c.reads} writes=${c.writes}）` : ''}`
          + ` → 接上消费点，或在 check-guards.mjs 的 DEAD_CHANNEL_ALLOWLIST 登记一条（since/due/why）`),
        ...stale.map(k => `  ✗ 豁免清单过期：${k} → 已不再命中，从 DEAD_CHANNEL_ALLOWLIST 删掉该条（棘轮只减不增）`),
        ...(fresh.length > 0 || stale.length > 0 ? [
          '  → 三类形态：A 导出的可选项零调用（goldLevel 模式）/ B 可选项只读不写、`?? 默认值` 静默兜底',
          '    （invincibleTime 模式：引擎读、面板可写、数据不给）/ C 手写 .d.mts 与 .mjs 运行时导出漂移（TS2305 模式）。',
        ] : []),
      ],
    })
  }

  // ---- 判据 15：口径复核触发器强制（防「旧结论静默过期」） ----
  {
    const cal = scanCaliberTriggers(root, authored.scanned)
    results.push({
      name: `口径复核触发器 (规则 8/16: 游戏语义口径必须挂 ⟳复核 到期日) 已挂 ${cal.withTrigger.length} / 待补 ${cal.missing.length}`,
      ok: cal.missing.length === 0 && cal.stale.length === 0,
      detail: [
        ...cal.missing.slice(0, 20).map(m => `  ✗ 游戏语义口径缺复核触发器：${m.key} → 在 @fact 行尾或下一行注释补`
          + ' `⟳复核: <到点判什么> | 到期 <YYYY-MM-DD>`（解析器只认 据/验/锚/信 槽位，追加不影响 parseFactLine）'),
        ...(cal.missing.length > 20 ? [`  …另有 ${cal.missing.length - 20} 条`] : []),
        ...cal.stale.map(k => `  ✗ 豁免清单过期：${k} → 该口径已补触发器，从 CALIBER_TRIGGER_ALLOWLIST 删掉该行（棘轮只减不增）`),
        ...(cal.missing.length > 0 ? [
          `  → 到期与否不在本判据（这里只查「有没有」触发器，防止口径"永不过期"），逾期点名见 ` + "`zc drift`" + ` / #scanCaliberTriggerDue，`,
          `     `+"`zc drift`"+` 查「到没到期」并点名逾期项。工程元口径（${CALIBER_NON_GAME_SUBJECTS.join(' / ')}）豁免——它们的复核靠守卫红。`,
        ] : []),
      ],
    })
  }

  // ---- 判据 16：scoped 样式可达性（防「规则留在别处的 scoped 里，消费组件吃不到」） ----
  {
    const reach = scanScopedStyleReach(root)
    const KIND_LABEL = {
      'views-css': 'src/views 下的 scoped css',
      'shared-css': '共享 scoped-src 文件',
      'page-inline': '页面内联 scoped',
      'component-inline': '他组件内联 scoped',
    }
    const kindLabel = k => k.split('+').map(x => KIND_LABEL[x] ?? x).join(' + ')
    results.push({
      name: `scoped 样式可达性 (规则 16: 组件用了「看不见的 scoped 定义」的类) 失配 ${reach.violations.length} 处`
        + (reach.skip ? `（${reach.skip}，跳过）` : `（定义面 ${reach.defs} 条 / 消费组件 ${reach.consumers} 个）`),
      ok: reach.skip !== null || reach.violations.length === 0,
      detail: [
        ...reach.violations.slice(0, 15).map(v => `  ✗ .${v.cls} 用在 ${v.component}，但只在 ${v.definedIn}（${kindLabel(v.kind)}）里定义`
          + ` → 该规则对这个组件**不生效**（scoped 选择器带的是定义方的 data-v-*）`),
        ...(reach.violations.length > 15 ? [`  …另有 ${reach.violations.length - 15} 处`] : []),
        ...(reach.violations.length > 0 ? [
          '  → 症状是「屏幕上少了一条线/一处字号」，编译过、测试绿、ui-check 也不报 ⇒ 只能靠本判据。',
          '  → 修法三选一：① 类是跨块共享的 ⇒ 搬进 src/styles/chart-blocks.css（各块用 <style scoped src> 载入，',
          '     **特异性不变**、源码一份）；② 只有该组件用 ⇒ 搬进组件自己的 css（或全局 charts.css）；',
          '     ③ 消费组件确实要用 ⇒ 补 `<style scoped src>` 载入定义文件，或在自己内联 scoped 里补一份（注明出自定义方）。',
          '  → 别无出处地「复制一份到组件里」了事（规则 11 双份必漂移；实测 dd-caption 两份已漂 11 vs 11.5px）。',
        ] : []),
      ],
    })
  }

  // ---- 判据 17：压缩数组按槽位号索引（防「槽位号 ≠ 下标」整类静默缺陷回来） ----
  {
    const scan = scanCompactedSlotIndex(root)
    results.push({
      name: `压缩数组槽位索引 (判据 17: characters/panels/damagePanels/remielleEntryPanels 的下标 ≠ 槽位号) 违规 ${scan.violations.length} 处`
        + `（豁免 ${IDX_SAFE_ALLOWLIST.length} 条 / 扫 ${scan.scanned} 行）`,
      ok: scan.violations.length === 0,
      detail: [
        ...scan.violations.slice(0, 15).map(v => `  ✗ ${v.file}:${v.line}  ${v.array}[${v.key}] → ${v.text}`),
        ...(scan.violations.length > 15 ? [`  …另有 ${scan.violations.length - 15} 处`] : []),
        ...(scan.violations.length > 0 ? [
          '  → 四数组按**位置压缩**（buildCharConfig/computePanel 跳过空槽）⇒ 槽位号 ≠ 下标；',
          '     前导/中间空槽时静默取到 undefined 或**别人那份对象**（实测：艾莲影画4 冻结 4→0、回能 16→0，',
          '     格雷丝写进队友 cfg，奥菲丝/薇薇安/蕾米埃尔直接抛 TypeError），且**无任何既有测试会变红**。',
          '  → 修法：① 模块内取自己那份 ⇒ 用派发器直给的 `cfg`（AgentTeamConfigInput.cfg /',
          '     AgentNextRoundFeedbackInput.cfg）；② 取队友那份 / 任何面板 ⇒ `.find(x => x.slot === slot)`，',
          '     面板族还可用 `panelAt(panels, slot)`（src/core/panel.ts，带未盖章密集数组兜底）。',
          '  → 确属**下标语义**（非槽位号）的用法走 scripts/lib/compacted-slot-index.mjs 的 IDX_SAFE_ALLOWLIST，',
          '     每条必须写明理由（棘轮只减不增；理由不成立就该改代码而不是加豁免）。',
        ] : []),
      ],
    })
  }

  return { results, ok: results.every(r => r.ok) }
}

// ---- CLI ----
const invokedAsCli = process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
if (invokedAsCli) {
  const { results, ok } = runAllChecks()
  for (const r of results) {
    console.log(`${r.ok ? 'ok' : '✗'} ${r.name}`)
    for (const d of r.detail) console.log(d)
  }
  if (!ok) { console.log(`${results.filter(r => !r.ok).length} guard check(s) failed`); process.exit(1) }
  console.log(`${results.length} guard checks passed`)
}
