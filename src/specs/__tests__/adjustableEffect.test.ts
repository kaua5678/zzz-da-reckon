import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getRegisteredMechanicSettings } from '@/mechanics'

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
 *    · **乙（资源不可达，4 条）**：1621×2 / 1611×1 / 1561×1 —— 自定义模块接管 agentId ⇒
 *      `registry.ts:139-141` 不再注册 spec 派生模块 ⇒ `computeSpecResources` 永不被调用，
 *      而模块自己也不调它（`grep -c` = 0）⇒ 该资源零消费者。实测：`resourceResult` 里没有那个键，
 *      **但绕开模块直接算得出来**（COMPUTABLE）⇒ 是「没人算」不是「算出来是 0」。
 *    两类都需**用户裁决**（接线 vs 删声明），故留在冻结清单里如实挂账。
 * ④ **fixture 要点**：`countSource` 为计数器的条目必须显式喂计数（如
 *    `perfectBlockCount` 默认 0 ⇒ 不喂则三点恒 0，**会被误判成「滑块失效」**；
 *    R49 分诊第一版就栽在这，见上引报告 §3）。
 */

/** 表：[settingId, 资源 id, gain 键, rate=1 时的基准获取量] */
const CASES: Array<[string, string, string, number]> = [
  ['1011.anby_charge.anby_ex_charge_gain.rate', 'anby_charge', 'anby_ex_charge_gain', 72],
  ['1041.soldier11_charge.soldier11_ex_charge_gain.rate', 'soldier11_charge', 'soldier11_ex_charge_gain', 48],
  ['1041.soldier11_charge.soldier11_ult_charge_gain.rate', 'soldier11_charge', 'soldier11_ult_charge_gain', 24],
  ['1351.pulchra_hunt_step.pulchra_assist_hunt_gain.rate', 'pulchra_hunt_step', 'pulchra_assist_hunt_gain', 5],
  ['1351.pulchra_hunt_step.pulchra_ex_hunt_gain.rate', 'pulchra_hunt_step', 'pulchra_ex_hunt_gain', 9],
  ['1441.zhendou_heartfire.zhendou_parry_heartfire_gain.rate', 'zhendou_heartfire', 'zhendou_parry_heartfire_gain', 600],
  ['1441.zhendou_remnant_flame.zhendou_chain_remnant_gain.rate', 'zhendou_remnant_flame', 'zhendou_chain_remnant_gain', 12],
  ['1441.zhendou_remnant_flame.zhendou_ult_remnant_gain.rate', 'zhendou_remnant_flame', 'zhendou_ult_remnant_gain', 24],
  ['1521.xixifu_toxin.toxin_tuxin_stage4.rate', 'xixifu_toxin', 'toxin_tuxin_stage4', 20],
  ['1531.billy_radiant_star.billy_radiant_basic4_gain.rate', 'billy_radiant_star', 'billy_radiant_basic4_gain', 1],
  ['1531.billy_radiant_star.billy_radiant_ex_gain.rate', 'billy_radiant_star', 'billy_radiant_ex_gain', 21],
  ['1531.billy_star_glow.billy_star_basic4_gain.rate', 'billy_star_glow', 'billy_star_basic4_gain', 1],
  ['1531.billy_star_glow.billy_star_ex_gain.rate', 'billy_star_glow', 'billy_star_ex_gain', 21],
  ['1531.billy_star_glow.billy_star_ultimate_gain.rate', 'billy_star_glow', 'billy_star_ultimate_gain', 3],
  ['1551.peiluo_prominence.peiluo_frontline_gain.rate', 'peiluo_prominence', 'peiluo_frontline_gain', 60],
  ['1551.peiluo_prominence.peiluo_upper_ult_gain.rate', 'peiluo_prominence', 'peiluo_upper_ult_gain', 180],
  // ⚠ 这一条的 countSource 是 `perfectBlockCount`（`resources.ts:188-190`），
  // 而 `stores/config.ts:130` 的默认值是 **0** ⇒ 不显式给次数时三点恒 0（**不是**滑块没接线）。
  // R49 分诊曾把它误判成 no-delta（见 evidence/R49-J1-dead-adjustables.md §3 误报 1）。
  ['1551.peiluo_prominence.peiluo_perfect_block_gain.rate', 'peiluo_prominence', 'peiluo_perfect_block_gain', 50],
]

/** 队伍夹具：主角 + 两个固定队友（同属性以触发出战条件；数值只依赖本槽 cfg 与 state） */
const ALLY: Record<string, [string, string]> = {
  '1011': ['1381', '1211'],
  '1091': ['1251', '1171'],
  '1531': ['1041', '1281'],
  '1041': ['1531', '1281'],
}

/** 让 countSource 类的量表非 0（`parryCount` / `chainCountTotal` / `perfectBlockCount` 等） */
const RICH = { cinemaLevel: 6, parryCount: 8, dodgeCounterCount: 12, quickAssistCount: 4, chainCountPerStun: 2, blockCount: 4, perfectBlockCount: 5 }

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
 *    「`rate=0` ⇒ 恒 0」+「逐点钉实测收敛值」+「读同一份结果解**闭式恒等式**」（见 §3 米卡以）。
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
  ['1021.nekomata_purr.nekomata_ex_gain.rate', 'nekomata_purr', 'nekomata_ex_gain', ['1381', '1211'], [0, 1, 2], [0, 65, 130]],
  ['1021.nekomata_purr.nekomata_ultimate_gain.rate', 'nekomata_purr', 'nekomata_ultimate_gain', ['1381', '1211'], [0, 1, 2], [0, 60, 120]],
  ['1441.zhendou_heartfire.zhendou_special_heartfire_gain.rate', 'zhendou_heartfire', 'zhendou_special_heartfire_gain', ['1011', '1211'], [0, 1, 2], [0, 600, 1200]],
  ['1301.orphie_xuyan.xuyan_ex_special_gain.rate', 'orphie_xuyan', 'xuyan_ex_special_gain', ['1011', '1211'], [0, 0.5, 1], [0, 170, 340]],
  ['1301.orphie_xuyan.xuyan_shiguang_gain.rate', 'orphie_xuyan', 'xuyan_shiguang_gain', ['1011', '1211'], [0, 0.5, 1], [0, 360, 720]],
  ['1521.xixifu_toxin.toxin_duya_hold.rate', 'xixifu_toxin', 'toxin_duya_hold', ['1011', '1211'], [0, 0.5, 1], [0, 13.5, 30]],
  ['1521.xixifu_toxin.toxin_tuxin_stunned_bonus.rate', 'xixifu_toxin', 'toxin_tuxin_stunned_bonus', ['1011', '1211'], [0, 0.5, 1], [0, 5, 10]],
]

/**
 * 单点真管线读数（**每点全新 `setupHarness`**，杜绝轮间夹具残留 —— R49 的表驱动是同一夹具上连读
 * 三点，本批实测对 `chainCountTotal` 型会因 `warmStartCache`（`core/resource.ts:125` 按整个 cfg
 * 做 exactKey）串味，故本批一律新夹具）。
 */
async function readSpecGain(
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
  const calc = useResourceCalc()
  config.setMechanicSetting(id, rate)
  await new Promise(r => setTimeout(r, 0))
  const char = calc.resourceResult.value?.characters?.find(c => c.agentId === agentId) as
    { specResources?: Record<string, { gains?: Record<string, number> }> } | undefined
  return char?.specResources?.[resKey]?.gains?.[gainKey]
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
   * 实测三点 `0 / 37.81819993141289 / 80`（80 = 2 × 机会收入上限 40，rate=2 时饱和）。
   * ⇒ 强断言 = 「rate=0 ⇒ 恒 0」+「单调递增」+「逐点钉实测收敛值」（值一漂就红，逼人复核）。
   */
  it('1 条收敛反馈型（1591）：rate=0 ⇒ 0，且三点钉实测收敛值 + 单调', async () => {
    const id = '1591.sigrid_lance_opportunity.sigrid_hit_opportunity_gain.rate'
    const g = (r: number) => readSpecGain(id, 'sigrid_lance_opportunity', 'sigrid_hit_opportunity_gain', ['1011', '1211'], r)
    const r0 = await g(0)
    const rHalf = await g(0.5)
    const r1 = await g(1)
    const r2 = await g(2)
    expect(r0, 'rate=0 ⇒ 该 gain 分量必然恒 0（消费侧读错字段名会恒走 ?? default）').toBe(0)
    expect(rHalf!).toBeCloseTo(21.18043619329764, 6)
    expect(r1!).toBeCloseTo(37.81819993141289, 6)
    // rate=2 时收入饱和到机会上限 40 ⇒ gain = 2 × 40 = 80（**不是** 2 × 37.8：反馈环所致）
    expect(r2!).toBeCloseTo(80, 6)
    expect(r0!).toBeLessThan(rHalf!)
    expect(rHalf!).toBeLessThan(r1!)
    expect(r1!).toBeLessThan(r2!)
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
describe('spec adjustable（Form-E）第二批：米卡以落霜三滑块（闭式恒等式）', () => {
  const D = '1091.miyabi_frost_fall.miyabi_disorder_frost_fall_gain.rate'
  const F = '1091.miyabi_frost_fall.miyabi_frostburn_break_frost_fall_gain.rate'
  const C = '1091.miyabi_frost_fall.miyabi_c2_flower_basic_frost_fall_gain.rate'

  async function readFrost(settings: Record<string, number>) {
    const { config } = await setupHarness([
      { agentId: '1091', ...RICH, battleTime: 180 },
      { agentId: '1251', cinemaLevel: 6 },
      { agentId: '1171', cinemaLevel: 6 },
    ] as never)
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    for (const [k, v] of Object.entries(settings)) config.setMechanicSetting(k, v)
    await new Promise(r => setTimeout(r, 0))
    const char = calc.resourceResult.value?.characters?.find(c => c.agentId === '1091') as never as
      {
        exSpecialCount?: number
        executions?: Array<{ moveId?: string; totalTime?: number }>
        miyabiFrostFallSource?: { total?: number }
      } | undefined
    const total = char?.miyabiFrostFallSource?.total
    const ex = Math.floor(char?.exSpecialCount ?? 0)
    // ⚠ `basicAttackCount` 的分子是**平A聚合执行行的秒数**（`resources.ts:203-204` 的
    // `floor(state.basicAttackTime / 2)`），而 `basicAttackTime` **不在** `CharacterResourceResult`
    // 的公开字段里 ⇒ 必须从 `executions` 里取 `moveId === 'basic_attack'` 那条行的 `totalTime`。
    // 读 result 上不存在的字段会静默得 `undefined ⇒ 0`，让恒等式自己骗自己（本任首版就栽在这）。
    const basicRow = char?.executions?.find(e => e.moveId === 'basic_attack')?.totalTime ?? 0
    const basic = Math.floor(basicRow / 2)
    return { total, ex, basic, raw: basicRow, d: settings[D] ?? 1, f: settings[F] ?? 1, c: settings[C] ?? 1 }
  }

  it('三条滑块全 0 ⇒ 落霜总量恒 0（三条都真被消费的合取证据）', async () => {
    const r = await readFrost({ [D]: 0, [F]: 0, [C]: 0 })
    expect(r.total, '三条 adjustable 同时归零后仍非 0 ⇒ 至少有一条没接线').toBe(0)
    expect(r.ex, '夹具前提：强特次数须非 0，否则本条退化成恒 0 假绿').toBeGreaterThan(0)
  }, 300000)

  it('闭式恒等式：total = ⌊强特⌋×2×D + ⌊强特⌋×1×F + ⌊平A时间/2⌋×1×C（D/F/C 各三点）', async () => {
    const failures: string[] = []
    const points: Array<Record<string, number>> = [
      {}, // 全默认
      ...[0, 1, 2].map(v => ({ [D]: v, [F]: 0, [C]: 0 })),
      ...[0, 1, 2].map(v => ({ [F]: v, [D]: 0, [C]: 0 })),
      ...[0, 1, 2].map(v => ({ [C]: v, [D]: 0, [F]: 0 })),
    ]
    for (const p of points) {
      const r = await readFrost(p)
      const expected = r.ex * 2 * r.d + r.ex * 1 * r.f + r.basic * 1 * r.c
      if (r.total !== expected) {
        failures.push(`${JSON.stringify(p)}: 实到 ${r.total}，恒等式给 ${expected}（ex=${r.ex} basic/2=${r.basic}）`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 600000)

  /**
   * ⚠ **不要**写「某条归零 ⇒ 总量恰好减去该条贡献」的减法断言 —— 本任首版就栽在这：
   * 三个滑块都进**同一个总量**，而总量又反馈驱动时间分配与强特次数（落霜 → 霜月次数 →
   * 强特/时间预算），⇒ 改一条会**同时移动另两条的基准**，逐位相减不成立（实测
   * `disorder` 归零后 `29 → 12` 而不是 `29 − 18 = 11`，因为强特次数同时从 9 变到 6）。
   * 正解 = 每条**独立**跑三点、每次都用**同一份结果**重解恒等式（上一条已做），
   * 再加一条「单调 + 真的动了」的消费证据（下面这条）。
   */
  it('逐条独立消费：每条滑块从默认移到 0 / 1 / 2 都必须真的改变总量（防单条静默失效）', async () => {
    const failures: string[] = []
    for (const [name, id] of [['disorder', D], ['frostburn', F], ['c2flower', C]] as Array<[string, string]>) {
      const vals: number[] = []
      for (const v of [0, 1, 2]) {
        const r = await readFrost({ [id]: v })
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
      const [a1, a2] = ALLY[agentId] ?? ['1011', '1211']
      const { config } = await setupHarness([
        { agentId, ...RICH },
        { agentId: a1, cinemaLevel: 6 },
        { agentId: a2, cinemaLevel: 6 },
      ] as never)
      for (const buff of config.globalBuffs) buff.enabled = false
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
