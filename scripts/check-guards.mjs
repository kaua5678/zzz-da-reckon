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
//  19. 录入层→编排层值倒置 —— ARCHITECTURE §0「录入层被编排/引擎经 registry 消费」
//      （mechanics/specs 禁值导入 @/composables，import type 豁免；行为面 + claret 形状锁成对，
//       实现面 scripts/lib/layer-inversion.mjs）
//
// 用法：node scripts/check-guards.mjs（npm run check / npm run verify 已挂载）
// 逃生口（都要求显式改本文件，让「例外」在 diff 里留痕）：
//   - fetch-stub：测试迁移到 setupHarness 后，从 FETCH_STUB_ALLOWLIST 删掉对应行（清单与
//     现状做集合相等校验，漏删即红，防清单变死数据）
//   - agentId 棘轮：基线只减不增。下调（进步）需在提交说明写明；上调没有合法路径——
//     角色特例逻辑属于 src/mechanics/agents/<id>.ts 的 applyTeamConfig（派发器在
//     composables/resourceCalc/panelPhases.ts，见规则 6 / ARCHITECTURE §3）
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 语言层（事实语法/锚点解析）的单一实现在 zc.mjs，护栏只调用不复制（规则 11）
import { auditAuthoredFacts, resolveAnchor, scanAuthoredFacts } from './zc.mjs'
// level60 字段映射规则表（审计/修复/导入脚本三方共用，规则 11）
import { FIELD_RULES } from './lib/level60-rules.mjs'
import {
  reconcileMoveElements,
  moveElementReconcileOk,
  formatMoveElementReconcile,
} from './lib/move-element-reconcile.mjs'
import { scanScopedStyleReach } from './lib/scoped-style-reach.mjs'
import { scanCompactedSlotIndex, IDX_SAFE_ALLOWLIST } from './lib/compacted-slot-index.mjs'
// 判据 19：录入层 → 编排层值倒置（2026-09-19 round 37，见 scripts/lib/layer-inversion.mjs 头注释）
import {
  scanLayerInversion,
  layerInversionOk,
  formatLayerInversion,
  LAYER_INVERSION_MIN_TOTAL_SITES,
} from './lib/layer-inversion.mjs'
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
    frozen: 2,  // R21 夜 D **convergence.ts 最后 2 行清零** 4→**2**（本批 **−2**，按**工作树实测**归因；
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
    frozen: 14,  // 2026-09-11 评审冻结 23 → 15（2026-09-13 T7 首次真清偿 −8：纯常量/纯函数下沉 src/data，原位置改 re-export + 展示层改 import 路径，vue-tsc 0 错、@fact 锚 93/93 不变）→ **14**（2026-09-20 round 44：结果页失衡易伤可见化搬进 composables/stunVulnDisplay.ts，calcStunMultiplier 越层 import 随实现上移；同 sharpCritMultiplier 先例）。下沉清单与「剩 14 处为何不能下沉」见 EXHIBITION_LAYER_IMPORT_BASELINE 头注释
    target: 0,
    due: '2026-12-31',
    plan: '剩 14 处全是**真引擎调用**（getAgentMechanic×4 / buildTeammateBuffSourceContext×2 / calcPanel / applyTargetedStat / allocateAxisWindows / computeOptimalSubStats+getTemplate / readImpactVar+writeImpactVar / agentSpecs / computeBanyueMingwangBlocks+BANYUE_AXIS_MOVE_META / computeYixuanNingshenBlocks），无纯常量可下沉；正解是经编排层（composables/resourceCalc）透出面板/引擎产物，属架构改动，逐条独立立项。纯函数类已全部下沉完毕（23→14）',
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
    frozen: 43,  // 2026-09-20 round 49 **换尺时实测 60**（口径纠正，不是退步；规则 17②），
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
      + '① **Form-E（38 条）优先**——正解是**一条通用 registry 驱动测试**（遍历注册表，min/max 各跑一次'
      + '真管线比 delta）。✅ **已做第一批 16 条**（`src/specs/__tests__/adjustableEffect.test.ts` 表驱动，'
      + 'rate 0/1/2 三点线性 + 基准绝对值）；余 22 条里 12 条已查明是**覆盖导致的真失效**（§见 R49-J1），'
      + '另 10 条需更贴的 fixture（countSource 靠默认队伍没触发的量，如 `perfectBlockCount`/`frostburnBreakCount`）。'
      + '② **Form-B/C/D（22 条）**逐条写角色级断言。'
      + '⚠ 必须**走真管线**（`setMechanicSetting` → `resourceResult`/`computePanelPhases`），**不许**直调钩子'
      + '+ 手写 cfg —— R48 实测：手写 cfg 会抹掉「生产代码写不写这个字段」这个自由度，让断链「通过」'
      + '（`anbyC2StunCoverage` 曾因此掩盖恒等 0.5 的真缺陷）。'
      + '⚠ 不许把本清单当豁免面用（那是放宽判据）；`jane.frenzyActive` 一条需**用户裁决**（见 OPEN-ITEMS §R48-J1）'
      + '——它是真死声明，补测试会红，应先裁决再动。',
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


// ---- 判据 18：招式伤害属性 ↔ nanoka raw 散文对账（R23-N1 / R26-J1：防招式伤害属性静默改回/退化） ----

/** 判据 18 对账执行器（薄包装，核心逻辑见 lib/move-element-reconcile.mjs） */
export function auditMoveElementsAgainstRaw(root = ROOT) {
  const catalogPath = join(root, 'public/static/catalog.json')
  const fullDir = join(root, 'data/raw/nanoka_missing/full')
  if (!existsSync(catalogPath) || !existsSync(fullDir)) return null
  let catalog
  try { catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) } catch { return null }
  return reconcileMoveElements({ catalog, fullDir, enforceFloors: true })
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


// ---- 判据 2：实现已整段迁至 `./lib/agent-branch-ratchet.mjs`（R46 结构熵切面，纯搬运）----
// 本块是 **re-export 壳**：既有消费者（`runAllChecks` / `scripts/zc.mjs` /
// `report-agent-identity.mjs` / `validate-specs.mjs` / `src/scripts/__tests__/*`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**
// （R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改判据口径请改 `./lib/agent-branch-ratchet.mjs`，**不要在本文件重建同形函数**。
import { AGENT_BRANCH_DIR, AGENT_BRANCH_FILE, listAgentBranchFiles, countAgentBranchLines, countAgentBranchLinesLegacy, AGENT_BRANCH_BASELINE, CORE_AGENT_BRANCH_FILES, CORE_AGENT_BRANCH_BASELINE, countAgentIdBranchLinesInFiles, countAgentIdBranchLines } from './lib/agent-branch-ratchet.mjs'
export { AGENT_BRANCH_DIR, AGENT_BRANCH_FILE, listAgentBranchFiles, countAgentBranchLines, countAgentBranchLinesLegacy, AGENT_BRANCH_BASELINE, CORE_AGENT_BRANCH_FILES, CORE_AGENT_BRANCH_BASELINE, countAgentIdBranchLinesInFiles, countAgentIdBranchLines } from './lib/agent-branch-ratchet.mjs'

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


// ---- 判据 7+12：实现已整段迁至 `./lib/layer-import-ratchet.mjs`（R46 结构熵切面，纯搬运）----
// 本块是 **re-export 壳**：既有消费者（`runAllChecks` / `scripts/zc.mjs` /
// `report-agent-identity.mjs` / `validate-specs.mjs` / `src/scripts/__tests__/*`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**
// （R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改判据口径请改 `./lib/layer-import-ratchet.mjs`，**不要在本文件重建同形函数**。
import { EXHIBITION_LAYER_DIRS, EXHIBITION_LAYER_FORBIDDEN, EXHIBITION_LAYER_IMPORT_BASELINE, CORE_LAYER_DIR, CORE_ROLE_IMPORT_BASELINE, scanCoreRoleImports, detectExhibitionLayerImport, countExhibitionLayerImports, scanExhibitionLayerImports } from './lib/layer-import-ratchet.mjs'
export { EXHIBITION_LAYER_DIRS, EXHIBITION_LAYER_FORBIDDEN, EXHIBITION_LAYER_IMPORT_BASELINE, CORE_LAYER_DIR, CORE_ROLE_IMPORT_BASELINE, scanCoreRoleImports, detectExhibitionLayerImport, countExhibitionLayerImports, scanExhibitionLayerImports } from './lib/layer-import-ratchet.mjs'


// ---- 判据 4：实现已整段迁至 `./lib/settings-coverage.mjs`（R46 结构熵切面，纯搬运）----
// 本块是 **re-export 壳**：既有消费者（`runAllChecks` / `scripts/zc.mjs` /
// `report-agent-identity.mjs` / `validate-specs.mjs` / `src/scripts/__tests__/*`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**
// （R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改判据口径请改 `./lib/settings-coverage.mjs`，**不要在本文件重建同形函数**。
import { SETTINGS_UNTESTED_BACKLOG, extractSettingIds, loadRegistrySnapshot, scanSettingsCoverage, settingsCoverageOk, formatSettingsCoverage, SETTINGS_COVERAGE_MIN_MODULES } from './lib/settings-coverage.mjs'
export { SETTINGS_UNTESTED_BACKLOG, extractSettingIds, loadRegistrySnapshot, scanSettingsCoverage, settingsCoverageOk, formatSettingsCoverage, SETTINGS_COVERAGE_MIN_MODULES } from './lib/settings-coverage.mjs'

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
  // ⚠ 本项覆盖 helpers.ts:1270（1a 标记），按 R24 明确结论保留（批 1-1 通用连续通道抽象开工前不许删）。
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
  // 2026-09-12（账本交接欠账）：克拉蕾残痕「同时最多 3 层」是**时序**约束，整局总量口径只能表达成
  // 「不钳制 + 消耗需求封顶」⇒ 极端配装（积累速率 ≫ 消耗节奏）下偏乐观。上条会话因 check-guards.mjs
  // 被并行会话占用、按规则 13 先记账本不登记，本条补登（代码标记在 claret.ts gashStacks 计算处）。
  'src/mechanics/agents/claret.ts:残痕总量口径天花板': { since: '2026-09-12', due: '残痕层数按消耗节奏窗口钳制（需逐动作时序模拟，与实数化收敛专项同族）；若用户裁决接受总量口径近似则销号并留 @fact' },
}

/**
 * 自指豁免：标记扫描器自身必然包含被扫描模式的字面量（与 GUARD_SYSTEM_FILES 同一性质，
 * 非债务）。scripts/zc.mjs 的事实抽取器把 'debt:' 列为 MARKERS 之一，头注释也统计它的
 * 出现次数——若不豁免，装上 zc 当天就会凭空多出两条「未登记债务」。
 */
// @fact engine:guards/自指豁免 口径: 扫描器自身含被扫模式的字面量属自指、不计违规（fetch-stub 用 GUARD_SYSTEM_FILES，debt 用本清单，事实扫描用占位符跳过） | 据 实测@2026-09-01·复核@2026-09-04·复核@2026-09-08 | 验 src/scripts/__tests__/zc.test.ts | 锚 scripts/check-guards.mjs#DEBT_SCAN_SELF_REFERENTIAL | 信 确认
export const DEBT_SCAN_SELF_REFERENTIAL = ['scripts/zc.mjs', 'scripts/lib/dead-channel-scan.mjs']

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


// ---- 判据 14：实现已整段迁至 `./lib/dead-channel-scan.mjs`（R46 结构熵切面，纯搬运）----
// 本块是 **re-export 壳**：既有消费者（`runAllChecks` / `scripts/zc.mjs` /
// `report-agent-identity.mjs` / `validate-specs.mjs` / `src/scripts/__tests__/*`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**
// （R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改判据口径请改 `./lib/dead-channel-scan.mjs`，**不要在本文件重建同形函数**。
import { DEAD_CHANNEL_ALLOWLIST, stripComments, stripCommentsAndStrings, stripStringLiterals, scanDeadOptionalProps, scanReadOnlyOptionalProps, scanDtsDrift, extractRuntimeExports, countDeadChannelWorkload, applyDeadChannelAllowlist } from './lib/dead-channel-scan.mjs'
export { DEAD_CHANNEL_ALLOWLIST, stripComments, stripCommentsAndStrings, stripStringLiterals, scanDeadOptionalProps, scanReadOnlyOptionalProps, scanDtsDrift, extractRuntimeExports, countDeadChannelWorkload, applyDeadChannelAllowlist } from './lib/dead-channel-scan.mjs'

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
  "src/composables/resourceCalc/liuyinPromote.ts engine:实战档位喧响计数",
  "src/composables/resourceCalc/liuyinPromote.ts engine:失衡次数不动点",
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
      ? [`  ✗ 角色判定 ${AGENT_BRANCH_BASELINE}→${branches}：角色特例逻辑写进编排层了（度量面 ${branchFiles.length} 个文件）。移到 src/mechanics/agents/<id>.ts 的 applyTeamConfig（三阶段钩子）或声明式钩子（axisWindowOverlays / backstageAutoFill 等），派发器在 composables/resourceCalc/panelPhases.ts`,
        '  → 度量口径 = AST 三形态（`agentId` / `.id` 四位数字 / `teammateBuffId`），按行去重；',
        '     查当前清单：node scripts/report-agent-identity.mjs --md（分类 + 证据 + 观察项）']
      : branches < AGENT_BRANCH_BASELINE
        ? [`  ✗ 角色判定 ${AGENT_BRANCH_BASELINE}→${branches}：是进步，把 scripts/lib/agent-branch-ratchet.mjs 的 AGENT_BRANCH_BASELINE 下调到 ${branches}（棘轮只减不增）`]
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
        ? [`  ✗ 越层 import ${EXHIBITION_LAYER_IMPORT_BASELINE}→${layer.count}：是进步，把 scripts/lib/layer-import-ratchet.mjs 的 EXHIBITION_LAYER_IMPORT_BASELINE 下调到 ${layer.count}（棘轮只减不增）`]
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
  // ⚠ 冻结清单按 id 本体匹配（`module::id` 里的 id 部分）——见 settings-coverage.mjs 的注释：
  // setting id 全局唯一，而模块 id 会随改名/合并漂移。
  const newGaps = settings.untested.filter(e => !SETTINGS_UNTESTED_BACKLOG.some(b => e.endsWith(`::${b}`)))
  const settingsMin = root === ROOT ? SETTINGS_COVERAGE_MIN_MODULES : 0
  // ⚠ `name` 与加下限前**逐字节相同**（反空洞下限只在 `ok` 与红时 detail 里体现）——这是**有意**的：
  // ① 绿基线输出可 `cmp` 逐字节对拍 ⇒ 证明本改动**零意外扰动**其它 18 条判据（最强保真仪器）；
  // ② 下限口径与 `NOUN_SOURCE_MIN_KEYS`（判据 13，同样不打进绿行）一致，而**不是**
  //    `LAYER_INVERSION_MIN_TOTAL_SITES`（判据 19 那种打进绿行的写法）——两者都是既有先例，此处选前者
  //    是为了拿到 ① 这条保真证明。⚠ 不要为了「让下限更显眼」改这一行：那会牺牲 ①，而可见性已由
  //    `settingsCoverage.test` 的回归锁（常量 >0 + 可红性自证）覆盖。
  // ⚠ R49 换尺后 `已测 N/M` 的分母从 84 变 **180**（M = 运行时注册表 id 数）—— 这是**口径纠正的
  //    可见化**，不是退步：旧读数 84/84 掩盖了 96 个看不见的 id，现读数把真实存量摆上台面。
  results.push({
    name: `settings coverage (规则 12/§2: 滑块声明必须有「改了确实变」测试) 已测 ${[...settings.declared.values()].flat().length - settings.untested.length}/${[...settings.declared.values()].flat().length}`,
    ok: settingsCoverageOk(settings, newGaps, settingsMin),
    // ⚠ detail **恒**由 formatSettingsCoverage 产出（不是只在红时）——`stale` 的「清单可回收」
    // 是**绿也要打印**的 warn（原实现如此，别改成条件输出而静默掉回收提醒）。
    detail: formatSettingsCoverage(settings, newGaps, settingsMin),
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
          + ` → 接上消费点，或在 scripts/lib/dead-channel-scan.mjs 的 DEAD_CHANNEL_ALLOWLIST 登记一条（since/due/why）`),
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


  // ---- 判据 18：招式伤害属性 ↔ nanoka raw 散文对账（R23-N1：防招式伤害属性静默改回/退化） ----
  {
    const report = auditMoveElementsAgainstRaw(root)
    results.push({
      name: report === null
        ? '招式伤害属性对账 ⚠ 缺 catalog 或 raw 目录，跳过'
        : `招式伤害属性对账 (move.damageElement ↔ nanoka raw 散文) ${report.scannedMoves - report.violations.length}/${report.scannedMoves} 招达标`,
      ok: report === null || moveElementReconcileOk(report),
      detail: report === null || moveElementReconcileOk(report) ? [] : formatMoveElementReconcile(report),
    })
  }

  // ---- 判据 19：录入层 → 编排层值倒置（ARCHITECTURE §0 依赖方向；R35-J2 唯一值边 claret.ts 已下沉 data/） ----
  {
    const report = scanLayerInversion(root)
    results.push({
      name: `layer-inversion (判据 19: 录入层 mechanics/specs 禁值导入编排层 @/composables) 值导入 ${report.valueCount} 处`
        + `（type 站点 ${report.typeCount} / 总站点 ${report.total} ≥ ${LAYER_INVERSION_MIN_TOTAL_SITES} 反空洞`
        + ` / 形状锁 ${report.shapeViolations.length} 处 / 扫 ${report.scannedFiles} 文件）`,
      ok: layerInversionOk(report),
      detail: layerInversionOk(report) ? [] : formatLayerInversion(report),
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
