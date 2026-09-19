/**
 * 判据 2「编排层 agentId 分支棘轮」+ core 延伸的实现面（R46 结构熵切面，纯搬运）。
 *
 * 度量口径（2026-09-12 口径纠正）：度量范围 = `useResourceCalc.ts` + 整个 `resourceCalc/` 目录——
 * 原口径只量单文件，评审 #10 把收敛域代码搬进 `resourceCalc/` 时**特判跟着代码一起搬**，
 * 标称「−45」实为净 0。教训：**度量范围必须跟着代码走**，否则棘轮只奖励重构、不奖励清偿。
 *
 * ⚠ 棘轮基线 `AGENT_BRANCH_BASELINE` / `CORE_AGENT_BRANCH_BASELINE` 在本文件；
 *   改基线必须**连 `RATCHET_BURNDOWN` 的 frozen 一起改**（R44 实证：只跑 check-guards
 *   看不见，`npm run verify` 会红 `expected 15 to be 14`）。
 * ⚠ 本文件是 check-guards.mjs 判据 2 的**实现**；`runAllChecks` 经 re-export 壳消费。
 * ⚠ 纯搬运保真：正文与搬出前逐字节相同（仅整体 `export` 保留 + 新增本序言）。
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { countIdentityBranchLinesInFiles } from './agent-identity-lines.mjs'

/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

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

/** AGENT_BRANCH_BASELINE 的沿革（编年史）已移至 docs/AGENT_ID_BURNDOWN_LOG.md（规则 8 分层契约：编年叙事不进代码）。
 *  当前读数 = 2；口径与判据见本文件下方注释与 RATCHET_BURNDOWN 登记表。 */
export const AGENT_BRANCH_BASELINE = 2
// R21 夜 D（2026-09-17 round 21 夜 D）**convergence.ts 最后 2 行清零：4 → 2**（按**工作树实测**归因）。
// 两条站点 = 该文件 `characters.map` 里最后两处 cfg-merge 分支，两者都是「缺输入通道」而非 DRY 机会
// （夜 B 已查明并挂账，本轮**补契约后迁走**）：
//  · `:826` 雨果 1291（`hugoAxisRemainingStunSeconds !== undefined` 门控的三字段块）
//    ⇒ `hugo.ts#applyHugoTeamConfig`。取数：轴本体/窗口数走 `axis`、**上一轮失衡池整数次数**走
//    `threads.prevPoolStunCount`（⚠ 坑36 口径：**不能**用 `axis.windows`——那是本轮不动点实数，
//    两者在收敛期分叉）、动作时长查表走本轮新增的 `getAgentSkills` 契约（与
//    `AgentAxisOverlayInput`/`AgentNextRoundFeedbackInput` 同名入参同款）。
//    **条件写形态逐位保留**：`cycleFromInput` 用 `!== undefined` 选通路 ⇒ 「写 0」≠「不写」。
//    连 `@fact engine:轴内块数落地` 一起迁移锚点（`convergence.ts` → `hugo.ts#applyHugoTeamConfig`），
//    并按判据 15 补 `⟳复核` 到期日（同时从 `CALIBER_TRIGGER_ALLOWLIST` 删旧行）。
//  · `:849` 般岳 1471（整块 `banyueAxisEx` / `banyueAxisActive` / `banyueInteractionTopUp` + 弹刀/双反注入）
//    ⇒ `banyue.ts#applyBanyueTeamConfig`。取数：轴内量走 `axis`、补齐量走 `threads.banyueTopUp`、
//    保底开关走本轮新增的 `guarantee` 契约、自动补齐设置走**已注册** setting
//    `banyue.autoTopUpInteractions`（default 1，`settings` 契约与 `getMechanicSetting` 同源同值）。
//    `topUp.parry>0||topUp.dual>0` 条件写 + 非补齐态字面量 `{parry:0,dual:0}` 逐位保留。
// **新增契约（两条，均只读、均只在 converge 相位有值、均不兜底）**：
//  ① `AgentTeamConfigInput.guarantee: { stun; fury; ultimate }` —— `guarantee.*` **刻意不注册**
//     `MechanicSetting`：`resolveMechanicSettings()` 只遍历注册表 ⇒ 模块侧读不到（夜 B 实测），
//     而**补注册是错的**——它同时被难度阶梯（`GUARANTEE_KEYS`）与归档部署程序化改写，注册它会把
//     内部实验旋钮变成资源利用率页的用户可见滑块（产品级口径，用户未裁决）。⇒ 只递算好的布尔结果。
//  ② `AgentTeamConfigInput.boss: { parryTotal; parryNoFollowUpTotal; parryDecibelOnlyTotal }`
//     —— Boss 预设的**输入侧**声明值（本轮拆分结果另走 `threads.parrySplit`）；递扁平三项而非
//     `appliedBoss` 整份，因为后者是 store 可写引用（不给模块改用户 Boss 配置的手柄）。
//  **棘轮实降 2 的判据**：`check-guards` 该条 `4→2`（HEAD 隔离 worktree 实测 4/4 全绿为基线）。
//  **逐位等价**：227 态全字段指纹（6 队形 × 5 保底组合 × 2 轴态 + 3 Boss 预设态 + 18 强队预设 × 2 命座
//  + 62 角色 × 2 命座 + 雨果/般岳 solo 轴态），迁移前后**逐文件 md5 全等、diff 键 0/227**
//  （corpus md5 `778111ae94e820469bfe10c48d0b0d30` 两侧相同）；敏感性自证：雨果值 +0.5 ⇒ 10 键红、
//  般岳 `autoTopUp` 短路 ⇒ 26 键红 ⇒ 指纹不是空转。
//  判据 `convergenceNightD.test.ts`；反向验证 5 组精确红（见该文件头注释的表）。core 保持 **6**（未触 core）。

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
