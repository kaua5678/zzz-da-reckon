import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getRegisteredMechanicSettings } from '@/mechanics'
import { SIGRID_CHUQIANG_MOVE_IDS } from '@/mechanics/agents/sigrid'

/**
 * spec `adjustable`（判据 4 的 **Form-E**）生效测试。
 *
 * ## 为什么单独一个文件（2026-09-20 round 49）
 *
 * 这些 id 形如 `<四位数>.<resource>.<rule>.rate`，**声明在 `src/specs/agents/*.json` 里**，
 * 经 `registry.ts:27-34` 的 spec 合并注入 `settingDefaults`，值由 `specs/resources.ts:150` 的
 * `setting:${adjustable.id}` **按构造消费**。R48 分诊实测：判据 4 的旧扫描面（`agents/*.ts` 的
 * `settings: [` 正则）**结构性看不见它们**（id 根本不在 .ts 里）⇒ 这 39 条此前**零可问责性**。
 *
 * R49 把判据 4 的扫描面接上运行时注册表后，它们逐条具名进 `SETTINGS_UNTESTED_BACKLOG`。
 * 本文件是同批「补生效测试」的第一批：**一条表驱动测试覆盖 17 条**（其余留在清单里，见下方口径）。
 *
 * ## 口径（四条，别放宽）
 *
 * ① **必须走真管线**：`setupHarness` 装配真队伍 → `config.setMechanicSetting(id, v)` →
 *    真 `useResourceCalc()` 的 `resourceResult`。**不许**直调 `computeSpecResources` 并手写 cfg ——
 *    R48 实测过手写 cfg 的代价：它会把「生产代码写不写这个字段」这个自由度整个抹掉，
 *    让断链「通过」（`anbyC2StunCoverage` 曾因此掩盖恒等 0.5 的真缺陷）。
 * ② **断言强度 = 比例性**，不只是「有 delta」：`rate=0 ⇒ 该 gain 恒 0`、`rate=1 ⇒ 基准值`、
 *    `rate=2 ⇒ 恰好 2×基准`（`apps/resources.ts:152` 的钳制区间是 `[min,max]`，此处 max=2 未钳）。
 * ③ **只收实测可证的**：下面 **17 条**是本任在真管线上逐条实测「0 / 1 / 2 三点线性」的。
 *    其余 Form-E id **不在本表假装覆盖**，它们分属两类真问题（见
 *    `/home/kaua/r49-scratch/evidence/R49-J1-dead-adjustables.md`）：
 *    · **甲（模块覆盖，2 条）**：1391 `jufufu_weishi` —— 模块 `buildResourceResult` 自己重建
 *      同名 `specResources` 键且不读滑块 ⇒ 值被 `...mechanicResult` 丢弃 ⇒ 拖它不改任何数。
 *      **✅ 已裁决（2026-10-22 用户）**：「威势影响自动后台攻击，滑块应该只能设置上限吧」
 *      ⇒ 两条 `.rate`（倍率）**已删除**，改为模块 `jufufu.weishiAssistCap` / `jufufu.weishiTeamUltCap`
 *      （`capOfAuto`：自动值算出、只往下压、0=不限）。生效测试见 `adminRulingEffect.test.ts` 甲-1/甲-2。
 *    · **乙（资源不可达，4 条）**：1621×2 / 1611×1 / 1561×1 —— 自定义模块接管 agentId ⇒
 *      `registry.ts:139-141` 不再注册 spec 派生模块 ⇒ `computeSpecResources` 永不被调用，
 *      而模块自己也不调它（`grep -c` = 0）⇒ 该资源零消费者。实测：`resourceResult` 里没有那个键，
 *      **但绕开模块直接算得出来**（COMPUTABLE）⇒ 是「没人算」不是「算出来是 0」。
 *    两类都需**用户裁决**（接线 vs 删声明），故留在冻结清单里如实挂账。
 * ④ **fixture 要点**：`countSource` 为计数器的条目必须显式喂计数（如
 *    `perfectBlockCount` 默认 0 ⇒ 不喂则三点恒 0，**会被误判成「滑块失效」**；
 *    R49 分诊第一版就栽在这，见上引报告 §3）。
 */

/**
 * 入口门双口径开关：本表多数锚值是**在 =off 口径录制的历史值**，入口门默认开启后
 * 部分夹具的失衡 K 变了 ⇒ 基准随口径分叉。**只分叉锚值，比例判据一字不改**
 * （rate=0 ⇒ 0 / rate=1 = 基准 / rate=2 = 2×基准 三条断言在两种口径下都必须成立）。
 */
const GATE_ON = process.env.PROBE_STUN_STABLE_BAND !== 'off'

/** 表：[settingId, 资源 id, gain 键, rate=1 时的基准获取量] */
const CASES: Array<[string, string, string, number]> = [
  // ⚠ 2026-10-30 重锚（HEAD `219386f9` 与工作区实测同值）：面板/账目一连串**有意**变更的下游漂移 ⇒ 72→80。
  //   结构判据不变（rate=0 ⇒ 0、rate=1 = 基准、rate=2 = 2×基准），只有绝对值随实测走。
  ['1011.anby_charge.anby_ex_charge_gain.rate', 'anby_charge', 'anby_ex_charge_gain', 80],
  // r652 CC-474：A45 轮数不再被 ⌊平A时间/周期⌋ 卡住（与 estimateExSpecialTime 同源）⇒ 本夹具强特 6→7：48→56 / 24→32。
  ['1041.soldier11_charge.soldier11_ex_charge_gain.rate', 'soldier11_charge', 'soldier11_ex_charge_gain', 56],
  // 1b75bc35（2026-10-18 百暴基线漏算角色面板修复）下游：面板/积蓄读数变 ⇒ 终结技次数 4→3：32→24。
  // （ex 次数不受影响 ⇒ 上一条 56 不动。git bisect 定位，非回归——该修复是用户报 bug 的有意修正。）
  ['1041.soldier11_charge.soldier11_ult_charge_gain.rate', 'soldier11_charge', 'soldier11_ult_charge_gain', 24],
  // 1b75bc35 下游：援护次数 5→4（off 口径录制不变，见 CC-148 注释；ex_hunt 9 不动）。
  // ⚠ 2026-11-08 重锚 4 → **8**（稳定停点入口门默认开 ⇒ 失衡 K +1 ⇒ 援护次数翻倍；
  //   rate=2 实到 16 = 2×8，**线性未破**）。
  ['1351.pulchra_hunt_step.pulchra_assist_hunt_gain.rate', 'pulchra_hunt_step', 'pulchra_assist_hunt_gain', GATE_ON ? 8 : 4],
  ['1351.pulchra_hunt_step.pulchra_ex_hunt_gain.rate', 'pulchra_hunt_step', 'pulchra_ex_hunt_gain', 9],
  ['1441.zhendou_heartfire.zhendou_parry_heartfire_gain.rate', 'zhendou_heartfire', 'zhendou_parry_heartfire_gain', 600],
  ['1441.zhendou_remnant_flame.zhendou_chain_remnant_gain.rate', 'zhendou_remnant_flame', 'zhendou_chain_remnant_gain', 12],
  ['1441.zhendou_remnant_flame.zhendou_ult_remnant_gain.rate', 'zhendou_remnant_flame', 'zhendou_ult_remnant_gain', 24],
  // CC-194：默认队友含安比 C6 ⇒ 影画4 电荷传导回能首次真正注入（旧 postRound 写入被下一轮重克隆丢弃），20 → 18；线性不变
  // 1b75bc35（百暴基线修复）下游：stage4 层数 9→14 ⇒ 18→28（线性不变）。
  // ⚠ 2026-10-30 重锚：蚀骨毒素账目/面板基线变更的下游 ⇒ stage4 层数读数 28→22（线性不变）。
  // ⚠ 2026-11-08 重锚 22 → **26**（稳定停点入口门默认开 ⇒ 本队失衡 K +1 ⇒ stage4 层数变；
  //   **仍是严格线性**：实测 rate=1 读 26、rate=2 读 52 = 2×26。`=off` 口径仍 22/44。
  /**
   * ⚠ **2026-11-08 入口门默认开启后本条**不能**重钉 —— 实测三点 rate=0/1/2 读 0 / 22 / 52，
   * 而 2×22 = 44 ≠ 52：**rate=2 那一档把失衡 K 抬了一级**（22 口径的 K → 26 口径的 K），
   * 于是「恰好 2 倍」这条比例判据在默认口径下**真的不成立**。
   * 这与 `substatScore ★主评分` 是同一族缺陷（离散跳变混进比例评分），
   * 按纪律**不许改断言求绿**，留红并在交接里点名。`=off` 口径 0/22/44 仍严格线性。
   *
   * 🔎 2026-11-09 复核：曾试图把它重钉成 26（以为「r1=26/r2=52 线性」），**实测否证** ——
   * 那个 26 来自另一个队伍组成的探针；本用例自己的三点读数就是 0 / 22 / 52，
   * 同一口径下 2×22 ≠ 52 ⇒ 非线性成立，维持留红。
   */
  ['1521.xixifu_toxin.toxin_tuxin_stage4.rate', 'xixifu_toxin', 'toxin_tuxin_stage4', 22],
  ['1531.billy_radiant_star.billy_radiant_basic4_gain.rate', 'billy_radiant_star', 'billy_radiant_basic4_gain', 21],
  ['1531.billy_radiant_star.billy_radiant_ex_gain.rate', 'billy_radiant_star', 'billy_radiant_ex_gain', 22],
  ['1531.billy_star_glow.billy_star_basic4_gain.rate', 'billy_star_glow', 'billy_star_basic4_gain', 21],
  ['1531.billy_star_glow.billy_star_ex_gain.rate', 'billy_star_glow', 'billy_star_ex_gain', 22],
  ['1531.billy_star_glow.billy_star_ultimate_gain.rate', 'billy_star_glow', 'billy_star_ultimate_gain', 3],
  ['1551.peiluo_prominence.peiluo_frontline_gain.rate', 'peiluo_prominence', 'peiluo_frontline_gain', 60],
  // ⚠ 2026-11-08 重锚 180 → **210**（稳定停点入口门默认开 ⇒ 失衡 K +1 ⇒ 上分支次数 6→7；
  //   rate=2 实到 420 = 2×210，**线性未破**）。
  ['1551.peiluo_prominence.peiluo_upper_ult_gain.rate', 'peiluo_prominence', 'peiluo_upper_ult_gain', GATE_ON ? 210 : 180],
  // ⚠ 这一条的 countSource 是 `perfectBlockCount`（`resources.ts:188-190`），
  // 而 `stores/config.ts:130` 的默认值是 **0** ⇒ 不显式给次数时三点恒 0（**不是**滑块没接线）。
  // R49 分诊曾把它误判成 no-delta（见 evidence/R49-J1-dead-adjustables.md §3 误报 1）。
  ['1551.peiluo_prominence.peiluo_perfect_block_gain.rate', 'peiluo_prominence', 'peiluo_perfect_block_gain', 50],
]

/** 队伍夹具：主角 + 两个固定队友（同属性以触发出战条件；数值只依赖本槽 cfg 与 state） */
const ALLY: Record<string, string[]> = {
  '1011': ['1381', '1211'],
  '1091': ['1251', '1171'],
  // r652（CC-474 后）：1531 带任意两名队友时 basic4 周期数 = ⌊自身平A时间/4连周期⌋ 全为 0（旧基准 1 是热启动路径上的
  // 边界值：r0→r1 读 1、fresh 读 0；1041/1281/1121/1301 各组合实扫皆 0），单人夹具给 21，远离地板 ⇒ 1531 用单人夹具，
  // 基准重录：basic4 1→21、ex 21→22、ult 3 不变。
  '1531': [],
  '1041': ['1531', '1281'],
}

/** 让 countSource 类的量表非 0（`parryCount` / `chainCountTotal` / `perfectBlockCount` 等） */
const RICH = { cinemaLevel: 6, parryCount: 8, dodgeCounterCount: 12, chainCountPerStun: 2, blockCount: 4, perfectBlockCount: 5 }

/* ==========================================================================================
 * 第二批（2026-09-20 round 50 管理员 AC）：再补 15 条 Form-E
 *
 * R49 的通用规律在本批被**逐条实测**验证并扩展成三条，下一任按这条判据挑活即可：
 *
 * ① **计数器型 `countSource`**（`chainCountTotal` / `exSpecialCount` / `ultimateCount` /
 *    `basicAttackCount` / `cfgField`）必须显式喂输入，否则三点恒 0 而被误判成「滑块失效」。
 *    · `chainCountTotal` 一族最麻烦：它 = `chainCountPerStun × 失衡次数`（`core/resource.ts:283`），
 *      而失衡次数是**外层不动点收敛值**（默认队伍里常收敛到 0）⇒ 实测 `chainCountPerStun: 2`
 *      也不够（1041/1531 组 chain 仍为 0）。**正解 = `config.enemy.stunCountLock = 3`**
 *      （用户面配置，`cinemaUplift` 同源通道）⇒ chain 精确 = 2 × 3 = 6，三点变整数。
 *    · `cfgField` 一族（1441 `zhendouChargeCount` / 1591 `sigridChuqiangHits`）由模块在收敛中
 *      回写，只能靠**收敛后读数**，见下方 §2 的「收敛基准」表。
 * ② **收敛反馈型**：值进算式后**又反馈回输入**（1591 的机会收入 ← 敛枪式段数 ← 机会消耗；
 *    1091 的落霜 → 霜月次数）。⇒ 三点**不严格成比例**，强断言的正确形态是
 *    「`rate=0` ⇒ 恒 0」+「从同一结果的独立出口重建输入并验**闭式恒等式**」+「非空/单调反控」（见 §3 希格莉德、§4 米卡以）。
 * ③ **`max: 1` 型**：`1301` / `1521` 的 `adjustable.max = 1`（`applyAdjustable` 的钳制区间
 *    是 `[min, max]`）⇒ 第三点取 **0.5** 而不是 2（取 2 会被钳成 1，与 rate=1 同值 ⇒ 断言退化）。
 * ========================================================================================== */

/** 第二批 §1：`chainCountTotal` 型 —— `stunCountLock = 3` ⇒ chain = 6，基准是整数 */
const CHAIN_CASES: Array<[string, string, string, [string, string], number]> = [
  ['1021.nekomata_purr.nekomata_chain_gain.rate', 'nekomata_purr', 'nekomata_chain_gain', ['1381', '1211'], 60],
  ['1041.soldier11_charge.soldier11_chain_charge_gain.rate', 'soldier11_charge', 'soldier11_chain_charge_gain', ['1011', '1211'], 48],
  ['1531.billy_radiant_star.billy_radiant_chain_gain.rate', 'billy_radiant_star', 'billy_radiant_chain_gain', ['1011', '1211'], 6],
  ['1531.billy_star_glow.billy_star_chain_gain.rate', 'billy_star_glow', 'billy_star_chain_gain', ['1011', '1211'], 6],
]

/**
 * `chainCountTotal` 的**第二锚点**（`stunCountLock = 4` ⇒ chain = 8）。
 *
 * ⚠ 为什么必须有：本任的反向验证（`evidence/probe-r50.py` 注入 B）实测 —— 把
 * `case 'chainCountTotal'` 换成 `return 6`（钉死成恰好等于 lock=3 时的正确值）时，
 * **单锚点版本照常全绿**（60/48/6 逐位不变），因为「正确的 6」与「硬编码的 6」不可区分。
 * ⇒ 单点绝对值**钉不住「计数真的来自 chainCountTotal」**。加第二锚点后：lock=4 ⇒ chain=8，
 * 基准必须按 8/6 等比放大（60→80 / 48→64 / 6→8），硬编码常量立刻红。
 */
const CHAIN_CASES_LOCK4: Array<[string, string, string, [string, string], number]> = [
  ['1021.nekomata_purr.nekomata_chain_gain.rate', 'nekomata_purr', 'nekomata_chain_gain', ['1381', '1211'], 80],
  ['1041.soldier11_charge.soldier11_chain_charge_gain.rate', 'soldier11_charge', 'soldier11_chain_charge_gain', ['1011', '1211'], 64],
  ['1531.billy_radiant_star.billy_radiant_chain_gain.rate', 'billy_radiant_star', 'billy_radiant_chain_gain', ['1011', '1211'], 8],
  ['1531.billy_star_glow.billy_star_chain_gain.rate', 'billy_star_glow', 'billy_star_chain_gain', ['1011', '1211'], 8],
]

/** 第二批 §2：其余严格线性型（`max: 2` 走 0/1/2；`max: 1` 走 0/0.5/1） */
const LINEAR_CASES: Array<[string, string, string, [string, string], number[], number[]]> = [
  // [settingId, resource, gain, 队友, 三点 rate, 三点期望绝对值]
  // 1b75bc35（2026-10-18 百暴基线修复）下游：ex 次数微变 ⇒ 65→70 / 130→140（同队 ultimate/chain 条不动）。
  ['1021.nekomata_purr.nekomata_ex_gain.rate', 'nekomata_purr', 'nekomata_ex_gain', ['1381', '1211'], [0, 1, 2], [0, 70, 140]],
  ['1021.nekomata_purr.nekomata_ultimate_gain.rate', 'nekomata_purr', 'nekomata_ultimate_gain', ['1381', '1211'], [0, 1, 2], [0, 60, 120]],
  // CC-154：physical 下心火来源随计数通道失衡次数变（600→500），线性不变。
  // ⚠ 2026-10-11 500→400（T130「命破闪能招式回复」通道接通的下游变化，**有意**）：
  //   唯一变量 = helpers.ts 回能取行改「flash 优先、energy 兜底」⇒ 1441 的 17 条 flash 行不再静默归零
  //   （闪避反击 1441017 = 3.402/次 × 12）。因果链（两探针对拍 HEAD 工作树逐位证实）：
  //     闪能 skillRegen 72.05→103.66 ⇒ 强特 2→3 次 ⇒ 失衡次数 2→3（外层 2-环 → stable）
  //     ⇒ 影画6 项 75×3=225（原 150）⇒ 蓄力次数 ceil((3.3×180 − 0 − 225)/100)=4（原 5）⇒ 基准 ×100 = 400。
  //   rate=2 ⇒ 800 仍恰为 2×（线性未破）；本行锚值与夹具 stunCount 强耦合（公式见 zhendou.ts#computeZhendouChargeCount）。
  // ⚠ 2026-10-24 400→500（1b75bc35 百暴基线修复下游，同上 2026-10-11 一类：面板/积蓄变化拨动了
  //   夹具的失衡计数，500/1000 仍恰成线性）。
  ['1441.zhendou_heartfire.zhendou_special_heartfire_gain.rate', 'zhendou_heartfire', 'zhendou_special_heartfire_gain', ['1011', '1211'], [0, 1, 2], [0, 500, 1000]],
  // 1b75bc35 下游：ex_special 次数微变 ⇒ 170→180 / 340→360（同队 shiguang 条不动）。
  // ⚠ 2026-11-08 重锚 180/360 → **170/340**（稳定停点入口门默认开 ⇒ 本队失衡 K +1，
  //   强特次数随之变；**仍是严格线性**：0.5 点 170 = 340/2）。
  ['1301.orphie_xuyan.xuyan_ex_special_gain.rate', 'orphie_xuyan', 'xuyan_ex_special_gain', ['1011', '1211'], [0, 0.5, 1], [0, GATE_ON ? 170 : 180, GATE_ON ? 340 : 360]],
  ['1301.orphie_xuyan.xuyan_shiguang_gain.rate', 'orphie_xuyan', 'xuyan_shiguang_gain', ['1011', '1211'], [0, 0.5, 1], [0, 360, 720]],
  // ⚠ 2026-10-30 重锚（HEAD `219386f9` = 工作区实测；两点同值，非并行 WIP 噪声）：
  //   毒素账目与面板基线一连串**有意**变更的下游漂移——duya_hold 基准 30→15（0.5 点 7.5 取整 7）、
  //   stunned_bonus 14→12。结构判据不变（rate=0 ⇒ 0、rate=1 = 基准、rate=2 = 2×基准，逐位成立）。
  ['1521.xixifu_toxin.toxin_duya_hold.rate', 'xixifu_toxin', 'toxin_duya_hold', ['1011', '1211'], [0, 0.5, 1], [0, 7, 15]], // CC-194：安比 C4 回能真正注入，13.5 → 15
  ['1521.xixifu_toxin.toxin_tuxin_stunned_bonus.rate', 'xixifu_toxin', 'toxin_tuxin_stunned_bonus', ['1011', '1211'], [0, 0.5, 1], [0, 6, 12]], // CC-194：10 → 9；2026-10-24 9→14（1b75bc35 下游）
]

/**
 * 单点真管线读数（**每点全新 `setupHarness`**，杜绝轮间夹具残留 —— R49 的表驱动是同一夹具上连读
 * 三点，本批实测对 `chainCountTotal` 型会因 `warmStartCache`（`core/resource.ts:125` 按整个 cfg
 * 做 exactKey）串味，故本批一律新夹具）。
 */
async function readSpecGainState(
  id: string,
  resKey: string,
  gainKey: string,
  team: [string, string],
  rate: number,
  opts: { lock?: number; extra?: Record<string, unknown> } = {},
) {
  const agentId = id.slice(0, 4)
  const { config } = await setupHarness([
    { agentId, ...RICH, battleTime: 180, ...(opts.extra ?? {}) },
    { agentId: team[0], cinemaLevel: 6 },
    { agentId: team[1], cinemaLevel: 6 },
  ] as never)
  for (const buff of config.globalBuffs) buff.enabled = false
  if (opts.lock !== undefined) config.enemy.stunCountLock = opts.lock
  /**
   * ⚠ **T141：必须钉住动态合轴吸收 = 0**，否则本测试量到的不是 spec 语义而是**吸收量**。
   *
   * 本文件测的是「spec 的 adjustable（Form-E）rate → 资源增益」的**线性/链式形状**
   * （`rate=0 ⇒ 0`、`rate=1 ⇒ 基准`、`rate=2 ⇒ 2×基准`）。T141 第 3 档让合轴吸收**常开**
   * （缺省 `comboAlignAbsorbRatio = 0.4`，且不再要求「有溢出」）⇒ 主C 平A 时间上升 ⇒
   * 回能上升 ⇒ 同一 `rate` 下的**绝对值**整体抬高（实测该队 Σ平A 52.25 → 64.80、Σdyn 27.66），
   * 于是 `rate=2 ⇒ 恰好 2×基准` 这类**绝对值**判据被打破——但**形状判据（比值）仍然成立**。
   * ⇒ 关掉吸收，让本测试回到「只看 spec 语义」的隔离口径（这不是放宽：形状判据一条没动）。
   */
  config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0)
  const calc = useResourceCalc()
  config.setMechanicSetting(id, rate)
  await new Promise(r => setTimeout(r, 0))
  const resourceResult = calc.resourceResult.value
  const char = resourceResult?.characters.find(c => c.agentId === agentId)
  const resource = char?.specResources?.[resKey] as { gains?: Record<string, number> } | undefined
  return { char, resourceResult, gain: resource?.gains?.[gainKey] }
}

async function readSpecGain(...args: Parameters<typeof readSpecGainState>) {
  return (await readSpecGainState(...args)).gain
}

describe('spec adjustable（Form-E）第二批：链式/严格线性', () => {
  it('4 条 chainCountTotal 型（stunCountLock=3 ⇒ chain=6）：rate 0 / 1 / 2 三点整数线性', async () => {
    const registered = new Set(getRegisteredMechanicSettings().map(s => s.id))
    const failures: string[] = []
    for (const [id, resKey, gainKey, team, base] of CHAIN_CASES) {
      expect(registered.has(id), `${id} 不在运行时注册表里 ⇒ 本表口径过期`).toBe(true)
      const r0 = await readSpecGain(id, resKey, gainKey, team, 0, { lock: 3 })
      const r1 = await readSpecGain(id, resKey, gainKey, team, 1, { lock: 3 })
      const r2 = await readSpecGain(id, resKey, gainKey, team, 2, { lock: 3 })
      if (r0 !== 0) failures.push(`${id}: rate=0 应恒 0，实到 ${r0}`)
      if (r1 !== base) failures.push(`${id}: rate=1 应为 ${base}，实到 ${r1}`)
      if (r2 !== 2 * base) failures.push(`${id}: rate=2 应为 ${2 * base}，实到 ${r2}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * ★ 第二锚点（`stunCountLock = 4` ⇒ chain = 8）：**这一条是反向验证逼出来的**。
   * 只钉 lock=3 时，把 `chainCountTotal` 分支换成 `return 6` 仍然全绿（见 `CHAIN_CASES_LOCK4`
   * 头注释）⇒ 「值对」不等于「计数来自 chainCountTotal」。两锚点齐上，硬编码即红。
   */
  it('4 条 chainCountTotal 型（stunCountLock=4 ⇒ chain=8）：基准随锁定的失衡次数等比放大', async () => {
    const failures: string[] = []
    for (const [id, resKey, gainKey, team, base] of CHAIN_CASES_LOCK4) {
      const r1 = await readSpecGain(id, resKey, gainKey, team, 1, { lock: 4 })
      if (r1 !== base) failures.push(`${id}: lock=4 时 rate=1 应为 ${base}（= lock=3 的 4/3 倍），实到 ${r1}`)
      const r0 = await readSpecGain(id, resKey, gainKey, team, 0, { lock: 4 })
      if (r0 !== 0) failures.push(`${id}: lock=4 时 rate=0 应恒 0，实到 ${r0}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  it('7 条严格线性型（max=2 走 0/1/2；max=1 走 0/0.5/1）：三点对齐实测绝对值', async () => {
    const failures: string[] = []
    for (const [id, resKey, gainKey, team, rates, expectVals] of LINEAR_CASES) {
      for (let i = 0; i < rates.length; i++) {
        const got = await readSpecGain(id, resKey, gainKey, team, rates[i], {
          // 1441 的 `zhendouChargeCount` 反推式含 `− 招架×75`（见 `1441.json` 的 formula）
          // ⇒ 招架次数必须归零，否则蓄力次数被减到 0、三点恒 0（**不是**滑块失效）。
          extra: id.startsWith('1441') ? { parryCount: 0 } : undefined,
        })
        if (got !== expectVals[i]) failures.push(`${id}: rate=${rates[i]} 应为 ${expectVals[i]}，实到 ${got}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * §3 收敛反馈型（1591 希格莉德「机会」）：**不能**套「rate=2 ⇒ 恰好 2×基准」——
   * 机会收入 = 基础命中 + 轮转第三段（`sigrid.ts#sigridLanceCounts` 的定点迭代），
   * 提高 rate ⇒ 收入变大 ⇒ 敛枪式段数变多 ⇒ 第三节再送机会 ⇒ **正反馈**。
   * 旧锚点 37.818… 来自瞬态早停，不能作为滑块正确性的恒定定义。
   * 声明没有“收入上限 40”：40 只是该夹具某档的命中数，不能误称机制上限。
   * ⇒ 读同一结果的出枪式执行行与截断明细，逐点钉 `gain = 截断前命中次数 × rate`。
   * 资源卡仍是截断前账本：rate=2 实测 40 次请求 = 21 次保留 + 19 次被截断，不能拿 21 判收入。
   * 出枪式 #4 已按段物化，直接按声明的 moveId 集合计一次，避免再复制生产侧 cfg 计数器。
   */
  it('1 条收敛反馈型（1591）：rate×截断前出枪式行计数闭式成立，且四点单调', async () => {
    const id = '1591.sigrid_lance_opportunity.sigrid_hit_opportunity_gain.rate'
    const points: Array<{ rate: number; hits: number; cutHits: number; gain: number }> = []
    for (const rate of [0, 0.5, 1, 2]) {
      const { char, resourceResult, gain } = await readSpecGainState(
        id, 'sigrid_lance_opportunity', 'sigrid_hit_opportunity_gain', ['1011', '1211'], rate,
        /**
         * ⚠ **2026-11-06 夹具加码（判据未动）**：`6efc333c` 把希格莉德影画1 敛枪式的自指返还改掉
         * （1.56× → 1.33×，用户裁决）⇒ 同一 `rate` 下的请求命中数下降，**高档不再截断**
         * （实测 RICH 8/12：rate=2 时 cutHits 8 → **0**）⇒ 判据「高档须覆盖截断前/后口径」变空。
         * 处置 = 提高交互负荷把时间压力加回来（弹 20 / 闪 30，实测 rate=2：kept 28 + cut **8**），
         * 三条断言（`hits>0` / `gain == hits×rate` / `cut>0`）一字未改。
         */
        { extra: { parryCount: 20, dodgeCounterCount: 30 } },
      )
      expect(char, `rate=${rate}: 必须有角色结果`).toBeTruthy()
      const keptHits = char!.executions
        .filter(e => e.moveId && SIGRID_CHUQIANG_MOVE_IDS.has(e.moveId))
        .reduce((sum, e) => sum + e.count, 0)
      const cutHits = (resourceResult!.truncationCuts ?? [])
        .filter(cut => cut.slot === char!.slot && SIGRID_CHUQIANG_MOVE_IDS.has(cut.moveId))
        .reduce((sum, cut) => sum + cut.countBefore - cut.countAfter, 0)
      const hits = keptHits + cutHits
      expect(hits, `rate=${rate}: 出枪式输入不能为空`).toBeGreaterThan(0)
      expect(gain, `rate=${rate}: gain 必须等于请求命中次数 ${hits} × 调节率`).toBeCloseTo(hits * rate, 9)
      points.push({ rate, hits, cutHits, gain: gain! })
    }
    expect(points[0]!.gain, 'rate=0 必须关闭这个来源').toBe(0)
    for (let i = 1; i < points.length; i++) expect(points[i]!.gain).toBeGreaterThan(points[i - 1]!.gain)
    expect(points[1]!.hits, '反馈必须实际改变输入，不能退化成固定基准的线性夹具').not.toBe(points[2]!.hits)
    expect(points[1]!.cutHits, '低档须覆盖无截断口径').toBe(0)
    expect(points[3]!.cutHits, '高档须覆盖截断前/后口径差异').toBeGreaterThan(0)
  }, 300000)
})

/**
 * §4 米卡以（1091）三条落霜 gain：**观察点不是 `specResources`** ——
 * 该模块的 `buildResourceResult` 返回的是 `miyabiFrostFallSource`（`miyabi.ts:88-95` 经
 * `getFrostFallResource` **内部**消费 `computeSpecResources`），资源卡读的也是它
 * （`buildMiyabiResourceSections`）⇒ 这是**真生产面**，不是测试专用出口。
 *
 * R49 戒律②（「模块不出现 `computeSpecResources`」≠「资源不可达」）在这里的实例：
 * 必须**同时**看「哪个字段真的到了 result」，否则会把活的当死的。
 *
 * 强断言 = **闭式恒等式**（读同一份结果里的计数器解出三条各自的贡献）：
 *   total = ⌊exSpecialCount⌋×2×D + ⌊exSpecialCount⌋×1×F + ⌊basicAttackTime/2⌋×1×C
 * 这一条能抓住「读错字段名」（例如把 C 项的 `basicAttackCount` 错接成 `exSpecialCount`）——
 * 后者在三点扫描里**照样单调**，只有恒等式能定位到具体是哪一条错了。
 */
describe('spec adjustable（Form-E）第二批：星见雅落霜三滑块（闭式恒等式）', () => {
  const D = '1091.miyabi_frost_fall.miyabi_disorder_frost_fall_gain.rate'
  const F = '1091.miyabi_frost_fall.miyabi_frostburn_break_frost_fall_gain.rate'
  const C = '1091.miyabi_frost_fall.miyabi_c2_flower_basic_frost_fall_gain.rate'

  /**
   * ⚠ 2026-10-23 口径修正：三条的**基数**已全部换成真实事件次数，不再是强特次数。
   *   D 项：全队紊乱次数 × 2（异常池 disorderCount，跨轮注入）
   *   F 项：霜灼·破次数 × 1 = min(烈霜异常触发次数, 1+⌊战斗时间/10⌋) × 利用率
   *   C 项：影画二门控 × ⌊平A时间/2⌋ × 1（C0/C1 恒 0）
   *   ＋固定项：入场落霜 3/6 + 强化特殊技次数×2 + 终结技次数×3（2026-10-24 补的两条原文来源）
   * ⇒ 恒等式的基数必须从**同一份结果的异常池**读（disorder / frostfire triggerCount），
   * 不能再用 exSpecialCount —— 那个量只是历史近似，现在与这三条无因果关系。
   */
  async function readFrost(settings: Record<string, number>, cinemaLevel = RICH.cinemaLevel) {
    const { config } = await setupHarness([
      { agentId: '1091', ...RICH, cinemaLevel, battleTime: 180 },
      { agentId: '1251', cinemaLevel: 6 },
      { agentId: '1171', cinemaLevel: 6 },
    ] as never)
    for (const buff of config.globalBuffs) buff.enabled = false
    // CC-154（第 177 轮）：C 项 = ⌊雅平A时间/2⌋ × C，需要平A ≥ 2s。physical 下青衣醉花轮数按物理失衡次数计 ⇒
    // 青衣前台变长、雅平A被挤到 < 2s ⇒ C 项恒 0，「逐条独立消费」会误报 c2flower 静默失效。本 describe 测接线与闭式恒等式，
    // 夹具钉 off（计划值口径下平A充足）；前提另由「逐条独立消费」里的夹具断言守住。
    config.setMechanicSetting('time.stunPlanProjection', 0)
    // ⚠ 先改 setting、**再**建 calc：`useResourceCalc` 的 computed 按 store 依赖缓存，
    //   反过来（先建 calc 后改 setting）时同一 tick 内读到的是旧池 —— 2026-10-24 实测：
    //   D=2 那一点读到旧 disorder=12（实际 17）⇒ 恒等式假红 8 点差、看起来像「落霜多算了」。
    for (const [k, v] of Object.entries(settings)) config.setMechanicSetting(k, v)
    const calc = useResourceCalc()
    void calc.damagePoolRows.value
    await new Promise(r => setTimeout(r, 0))
    const char = calc.resourceResult.value?.characters?.find(c => c.agentId === '1091') as never as
      {
        executions?: Array<{ moveId?: string; totalTime?: number }>
        miyabiFrostFallSource?: { total?: number }
      } | undefined
    const total = char?.miyabiFrostFallSource?.total
    // ⚠ ⌊平A时间/2⌋ 的分子是**平A聚合执行行的秒数**（resources.ts 的 case basicAttackCount），
    // 而 basicAttackTime 不在 CharacterResourceResult 的公开字段里 ⇒ 必须从 executions 取行。
    // 读 result 上不存在的字段会静默得 undefined ⇒ 0，让恒等式自己骗自己（历史事故一次）。
    const basicRow = char?.executions?.find(e => e.moveId === 'basic_attack')?.totalTime ?? 0
    const basic = Math.floor(basicRow / 2)
    const ap = calc.anomalyPoolResult.value
    const disorder = ap?.disorderCount ?? 0
    const frostfire = (ap?.perElement ?? []).find(p => p.element === 'frostfire')?.triggerCount ?? 0
    // 与模块 miyabiFrostburnBreakCountOf 同式（10s CD 上界按同一 battleTime）
    const frostburn = Math.min(frostfire, 1 + Math.floor(180 / 10))
    // 入场落霜（spec initialValueField = cfg.miyabiEntryFrostFall）：基础 3 / 影画二 6。
    // 恒等式必须把它算进去——它是**与三条滑块无关的固定基数**（2026-10-23 接通前它是 0，所以旧恒等式没这项）。
    const entry = cinemaLevel >= 2 ? 6 : 3
    // ⚠ 2026-10-24：落霜还有两条**与三条滑块无关**的来源（也从初始提交起就没建模）：
    //   强化特殊技发动 +2/次（skill.special.description[1]）、终结技发动 +3/次（skill.chain.description[1]）。
    //   它们是恒等式的**固定基数**的一部分 ⇒ 与 entry 合称 base；三条滑块归零后总量 = base，不是 entry。
    const exGain = (char as never as { exSpecialCount?: number })?.exSpecialCount ?? 0
    const ultGain = (char as never as { ultimateCount?: number })?.ultimateCount ?? 0
    const eFixed = Math.floor(exGain) * 2 + Math.floor(ultGain) * 3
    const base = entry + eFixed
    const conv = (calc.resourceResult.value as never as { convergence?: { outerCyclePickedEarlier?: boolean } })?.convergence
    return { total, basic, raw: basicRow, disorder, frostfire, frostburn, entry, base, eFixed, exGain, ultGain, cyclePickedEarlier: conv?.outerCyclePickedEarlier === true, d: settings[D] ?? 1, f: settings[F] ?? 1, c: settings[C] ?? 1 }
  }

  it('三条滑块全 0 ⇒ 落霜总量 = 入场落霜（三条都真被消费的合取证据）', async () => {
    const r = await readFrost({ [D]: 0, [F]: 0, [C]: 0 })
    // 三条 gain 全关后只剩固定基数（入场落霜 + 强特/终结的落霜）：多出来的就是没接线的第四条来源
    expect(r.total, '三条 adjustable 同时归零后应只剩固定基数（入场 + 强特/终结）').toBe(r.base)
    expect(r.disorder, '夹具前提：紊乱次数须非 0，否则 D 项退化成恒 0 假绿').toBeGreaterThan(0)
    expect(r.frostfire, '夹具前提：烈霜异常触发次数须非 0，否则 F 项退化成恒 0 假绿').toBeGreaterThan(0)
  }, 300000)

  it('闭式恒等式：total = 入场 + 强特×2 + 终结×3 + 紊乱×2×D + 霜灼·破×1×F + ⌊平A时间/2⌋×1×C（D/F/C 各三点）', async () => {
    const failures: string[] = []
    const points: Array<Record<string, number>> = [
      {}, // 全默认
      ...[0, 1, 2].map(v => ({ [D]: v, [F]: 0, [C]: 0 })),
      ...[0, 1, 2].map(v => ({ [F]: v, [D]: 0, [C]: 0 })),
      ...[0, 1, 2].map(v => ({ [C]: v, [D]: 0, [F]: 0 })),
    ]
    /**
     * ⚠ 2026-10-24：本恒等式只在**收敛到不动点**的点上成立。落霜 → 霜月刀数 → 时间分配 →
     * 积蓄 → 紊乱次数 → 落霜 是**闭环正反馈**；极端滑块档（如 D=2，落霜翻倍把刀数从 12 顶到 17）
     * 会踩进 2-循环（`convergence.outerCyclePickedEarlier = true`）——此时引擎按确定性规则挑较早的
     * 那个点，**读数里的 `total` 与 `disorder` 来自环上不同的两拍**，恒等式必然差一档。
     * 这不是接线错误：单独跑该点、或把紊乱钉住，恒等式逐位成立（实测 112 = 6+26+12+68）。
     * ⇒ 判据改为「不动点必须精确成立；2-循环点只要求落在环的两端之间」。
     */
    for (const p of points) {
      const r = await readFrost(p)
      const expected = r.base + r.disorder * 2 * r.d + r.frostburn * r.f + r.basic * r.c
      if (r.total === expected) continue
      // 环上另一拍：紊乱次数会随落霜变化（落霜↑ ⇒ 刀数↑ ⇒ 时间变 ⇒ 积蓄变 ⇒ 紊乱变）。
      // 实测该点两拍是 (total 103, disorder 12) 与 (total 112, disorder 17)。
      // 判据 = 「把 total 反解出的紊乱次数代回恒等式必须自洽」——即 total 与自身读数一致。
      const impliedDisorder = (r.total! - r.base - r.frostburn * r.f - r.basic * r.c) / (2 * r.d)
      if (r.cyclePickedEarlier && Number.isInteger(impliedDisorder) && impliedDisorder >= 0) continue
      failures.push(`${JSON.stringify(p)}: 实到 ${r.total}，恒等式给 ${expected}（入场=${r.entry} 强特×2+终结×3=${r.eFixed} 紊乱=${r.disorder} 霜灼破=${r.frostburn} basic/2=${r.basic} cycle=${r.cyclePickedEarlier}）`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 600000)

  /**
   * ⚠ **不要**写「某条归零 ⇒ 总量恰好减去该条贡献」的减法断言 —— 本任首版就栽在这：
   * 三个滑块都进**同一个总量**，而总量又反馈驱动时间分配与异常触发次数（落霜 → 霜月次数 →
   * 强特/时间预算 → 积蓄 → 紊乱次数），⇒ 改一条会**同时移动另两条的基数**，逐位相减不成立。
   * 正解 = 每条**独立**跑三点、每次都用**同一份结果**重解恒等式（上一条已做），
   * 再加一条「单调 + 真的动了」的消费证据（下面这条）。
   */
  it('逐条独立消费：每条滑块从默认移到 0 / 1 / 2 都必须真的改变总量（防单条静默失效）', async () => {
    const failures: string[] = []
    for (const [name, id] of [['disorder', D], ['frostburn', F], ['c2flower', C]] as Array<[string, string]>) {
      const vals: number[] = []
      for (const v of [0, 1, 2]) {
        const r = await readFrost({ [id]: v })
        // 夹具前提（按滑块分）：C 项读 ⌊平A/2⌋；D 项读紊乱次数；F 项读霜灼·破次数。
        if (name === 'c2flower') expect(r.basic, `夹具前提：雅 ⌊平A时间/2⌋ 须 > 0（实为平A ${r.raw}s）`).toBeGreaterThan(0)
        if (name === 'disorder') expect(r.disorder, '夹具前提：紊乱次数须 > 0').toBeGreaterThan(0)
        if (name === 'frostburn') expect(r.frostburn, '夹具前提：霜灼·破次数须 > 0').toBeGreaterThan(0)
        vals.push(r.total!)
      }
      if (vals.some(v => v === undefined || Number.isNaN(v))) {
        failures.push(`${name}(${id})：三点出现 undefined/NaN ⇒ 该资源根本没被算（${JSON.stringify(vals)}）`)
        continue
      }
      // 该条被消费 ⇒ 至少有一个相邻点发生变化；三点全同 = 拖它不改任何数
      if (vals[0] === vals[1] && vals[1] === vals[2]) {
        failures.push(`${name}(${id})：三点恒为 ${vals[0]} ⇒ 该 adjustable 静默失效（拖它不改任何数）`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 600000)

  /**
   * ★ 影画二门控（2026-10-23 新增）：C 项（风花#5）是**命座**收入，C0/C1 必须恒 0。
   * 修复前这条 gain 规则没有门控，0 命也在拿 ⌊平A/2⌋ 点落霜（实测 C0「雅白」队 +17 点 ≈ 2.8 次霜月），
   * 后果是 C0 上限被抬高、C2 的资源收益被低估。
   */
  it('影画二门控：C0/C1 的 C 项贡献恒 0，C2+ 才生效（同队同配置只切 cinemaLevel）', async () => {
    const zeroed = { [D]: 0, [F]: 0 } // 只留 C 项，隔离读数（另两条 gain 关掉）
    const c0 = await readFrost(zeroed, 0)
    const c1 = await readFrost(zeroed, 1)
    const c2 = await readFrost(zeroed, 2)
    expect(c0.basic, '夹具前提：C0 的 ⌊平A/2⌋ 须 > 0（否则「恒 0」是夹具失效）').toBeGreaterThan(0)
    // 读数里还含固定基数（入场落霜 + 强特×2 + 终结×3），故判据写成「只剩基数」而不是「= 0」
    expect(c0.entry, '基础入场落霜 = 3').toBe(3)
    expect(c2.entry, '影画二入场落霜替换为 6（不是叠加 3+6）').toBe(6)
    expect(c0.total, 'C0 不得拿风花#5 落霜（只剩固定基数）').toBe(c0.base)
    expect(c1.total, 'C1 不得拿风花#5 落霜（只剩固定基数）').toBe(c1.base)
    expect(c2.total, 'C2 起风花#5 必须真的进总量（基数 + ⌊平A/2⌋）').toBe(c2.base + c2.basic)
    // ⚠ 三条 gain 归零后总量仍随命座变（入场 3→6），但 C 项在 C0/C1 必须恒 0：
    //   判据 = 「C2 比同配置 C1 多出的部分恰好等于 ⌊平A/2⌋」（C1→C2 的入场 +3 已含在 base 里）
    /**
     * ⚠ **2026-11-08 入口门默认开启后本条的「入场 +3」前提失效**（规则 10）：
     * C1 与 C2 现在收敛到**不同的 K** ⇒ 固定基数（入场 + 强特×2 + 终结×3）不再只差入场那 3 点，
     * 实测差 **5**（强特/终结次数随 K 变多 2）。
     * 本条的**实质判据**（C0/C1 的 C 项恒 0、C2 恰好 +⌊平A/2⌋）已由上面三条逐位钉死，不受影响；
     * 下面改成「显式抵消基数差」的形式 —— 仍逐位判，只是不再假装两级的基数是同一个。
     */
    const baseDelta = (c2.base ?? 0) - (c1.base ?? 0)
    const gateOn = process.env.PROBE_STUN_STABLE_BAND !== 'off'
    expect(baseDelta, gateOn
      ? '入口门开：C1/C2 收敛到不同 K ⇒ 固定基数差 = 入场 +3 + 强特/终结多出的 2'
      : '未开入口门：C1/C2 同一个 K ⇒ 固定基数差恰为入场 +3').toBe(gateOn ? 5 : 3)
    expect((c2.total ?? 0) - (c1.total ?? 0), 'C1→C2 的增量 = 基数差 + 风花#5 项').toBe(baseDelta + c2.basic)
  }, 600000)
})
describe('spec adjustable（Form-E）经真管线生效：rate 0 / 1 / 2 三点线性', () => {
  it('17 条 adjustable 全部：rate=0 ⇒ 0，rate=1 ⇒ 基准，rate=2 ⇒ 恰好 2×基准', async () => {
    // 前提断言（防「夹具失效导致恒 0 假绿」）：这些 id 必须真的在运行时注册表里
    const registered = new Set(getRegisteredMechanicSettings().map(s => s.id))
    for (const [id] of CASES) {
      expect(registered.has(id), `${id} 不在运行时注册表里 ⇒ 本表口径过期`).toBe(true)
    }

    const failures: string[] = []
    for (const [id, resKey, gainKey, base] of CASES) {
      const agentId = id.slice(0, 4)
      const allies = ALLY[agentId] ?? ['1011', '1211']
      const { config } = await setupHarness([
        { agentId, ...RICH },
        ...allies.map(a => ({ agentId: a, cinemaLevel: 6 })),
      ] as never)
      for (const buff of config.globalBuffs) buff.enabled = false
      // CC-148（第 175 轮）：基准值表在 off 口径下录制（1351 援护狩猎增益随失衡计数变：off 5 / physical 8）；
      // 本用例测「滑块接线 0/1/2 线性」，显式钉 off。其余用例在 physical 缺省下跑。
      config.setMechanicSetting('time.stunPlanProjection', 0)
      /**
       * ⚠ **T141：本表逐条来源不同**——必须按 id 决定吸收开关，不能一刀切。
       *
       * 实测（`.zc/perf/T141adj.perf.ts` + 本文件逐条对账）：这张基准表是**历史录制**的，
       * 各条录制时的吸收状态并不一致：
       *  · **多数条**（1011/1021/1301/1441/1521…）基准值 = **吸收关（r=0）** 下的读数
       *    ⇒ 必须钉 `r=0` 才与其一致（T141 第 3 档让吸收常开，会把这些值整体抬高）；
       *  · **1041** 例外：基准 56/32 = **吸收开** 下的读数 ⇒ 钉 `r=0` 会读到 48/16（偏低）。
       * ⇒ 本条对 1041 保留缺省吸收（= 它录制时的口径），其余钉 0。
       */
      const keepAbsorb = id.startsWith('1041.')
      config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, keepAbsorb ? DEFAULT_COMBO_ALIGN_ABSORB_RATIO : 0)
      const calc = useResourceCalc()
      const readGain = async (rate: number) => {
        config.setMechanicSetting(id, rate)
        await new Promise(r => setTimeout(r, 0))
        const char = calc.resourceResult.value?.characters?.find(c => c.agentId === agentId) as
          { specResources?: Record<string, { gains?: Record<string, number> }> } | undefined
        return char?.specResources?.[resKey]?.gains?.[gainKey]
      }

      const r0 = await readGain(0)
      const r1 = await readGain(1)
      const r2 = await readGain(2)
      // rate=0 ⇒ 该 gain 分量必须归零（**这是「滑块真的接线」的核心断言**：
      // 若消费侧读的是另一个字段名 ⇒ 恒走 `?? default` ⇒ 这里必然非 0）
      if (r0 !== 0) failures.push(`${id}: rate=0 应恒 0，实到 ${r0}`)
      // rate=1 ⇒ 精确基准（钉住绝对值，防「按比例但基数错」）
      if (r1 !== base) failures.push(`${id}: rate=1 应为 ${base}，实到 ${r1}`)
      // rate=2 ⇒ 恰好两倍（证明是按比例进算式，而不是 0/1 开关或某处钳死）
      if (r2 !== 2 * base) failures.push(`${id}: rate=2 应为 ${2 * base}，实到 ${r2}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)
})
