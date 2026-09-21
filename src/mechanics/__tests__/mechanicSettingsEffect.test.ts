import { describe, expect, it } from 'vitest'
import { setupHarness, type HarnessTeamSlot } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getRegisteredMechanicSettings } from '@/mechanics'
// 跨文件常量只从单一来源引用（规则 11）：被断言的两条口径改了就跟着变，不复制字面量。
import { BURIAL_MAIM_PER_CAST } from '@/mechanics/agents/claret'
import { CINEMA6_ECHO_RATIO } from '@/mechanics/agents/liuyin'

/**
 * 模块自读 `setting(<id>)` 型 MechanicSetting（判据 4 的 **Form-B/C/D**）生效测试。
 *
 * ## 为什么单独一个文件（2026-09-20 round 50）
 *
 * 判据 4 的冻结清单 `scripts/lib/settings-coverage.mjs#SETTINGS_UNTESTED_BACKLOG` 里，Form-E
 * （`<四位数>.<resource>.<rule>.rate`，spec `adjustable`，已被 `adjustableEffect.test.ts` 覆盖）
 * 之外还剩 **21 条 Form-B/C/D**：它们不是 spec 字段，而是**角色模块自己**经
 * `cfg['setting:<id>']` / 面板 `AgentPanelInput.settings` 读的覆盖率/次数滑块。
 * 扫描面看不见它们（id 不在 spec 里、消费点也不在 `settings: [...]` 块里），
 * 故此前**零可问责性**——本文件逐条补齐。
 *
 * ## 口径（四条，别放宽）
 *
 * ① **必须走真管线**：`setupHarness` 装配真队伍 → `config.setMechanicSetting(id, v)` →
 *    真 `useResourceCalc()` 的 `resourceResult` / `damagePoolRows` / `panels`。
 *    **禁止**直调角色模块的钩子 + 手写 cfg —— 手写 cfg 会把「生产代码写不写这个字段」这个
 *    自由度整个抹掉，让断链「通过」（`anbyC2StunCoverage` 曾因此掩盖恒等 0.5 的真缺陷；
 *    `helpers.ts:630-633` 才是 `setting:<id>` 的唯一注入点，手写 cfg 会绕开它）。
 * ② **每个探针点独立 `setupHarness`**：同一个 harness 跨值复用会因收敛态污染产出**假 no-delta**
 *    （R50 侦察实测：`nangong.releaseCoverage` 的三点就是这么被骗到 `stunCount = 0` 的）。
 *    本文件的 `probe()` 一律**每点全新装队**，不做任何跨点缓存。
 * ③ **断言失败累积进 `failures: string[]`** 再一次性 `expect(failures, failures.join('\n')).toEqual([])`
 *    —— 否则第一条失败就中断，一个 21 条的批次要跑 21 轮才看得全（`adjustableEffect.test.ts` 同款）。
 * ④ **断言强度 = 比例性/精确闭式**，不只是「有 delta」：尽量断言 `实测 === 闭式(读数, v)`，
 *    这样夹具漂移（换队友、收敛值变）不会假红，而**接错字段名**必然红。
 *
 * ## ⚠ 三条必须先读的坑（R50 侦察实测，下一个补测试的人一定会再踩）
 *
 * 1. **`config.enemy.battleTime` 才是全局时长**，槽位里传 `battleTime` 是**静默无效**的：
 *    `harness.setTeam` 会把它原样塞进 team 槽，但 burnice（`burnice.ts:314` 读
 *    `frontlineTime + backstageTime`）与 yixuan（`cfg.battleTime`）读的是**敌方/全局**那份。
 *    `burnice.stirringCount` 第一版三点不动就是这个原因（槽位传 600 完全无效）。
 * 2. **`useStunAxis = false` 不足以关掉轴**：`axisActive = (configStore.useStunAxis || autoActive)
 *    && resolvedAxes.length > 0`，而 `autoActive = selectAutoStunAxisPreset(team)` 按**槽位通配**
 *    匹配预设。预设表里有通配预设 `src/data/stunAxisPresets/仪其他.json` = `['1371','*','*']`
 *    ⇒ **只要主 C 是仪玄，绝大多数队伍都会自动进轴**。`yixuan.ts:612` 在轴内把
 *    `stunExCoverage` **强制 0** ⇒ 光关开关无效，必须同时换到**无预设命中的队伍**
 *    （本文件实测 `['1611','1371','1481']` 有效）。`yixuan.stunExCoverage` /
 *    `yeshuguang.zhaoyingCount` / `yixuan.c6GiftUltCount` 三条都吃这一条。
 * 3. **`panels` 数组按位置压缩且带 `slot` 戳** ⇒ 一律 `panels.find(p => p.slot === N)`，
 *    **禁** `panels[N]`（判据 17 会红）：空槽时下标 ≠ 槽位号，会拿到别人那份面板。
 */

/** 统一"喂饱交互"夹具：让依赖弹刀/闪反/格挡/连携计数的量表非 0（同 `adjustableEffect.test.ts`） */
const RICH = {
  cinemaLevel: 6,
  parryCount: 8,
  dodgeCounterCount: 12,
  quickAssistCount: 4,
  chainCountPerStun: 2,
  blockCount: 4,
  perfectBlockCount: 5,
}

/** 队友槽（默认 C6，与被测角色同待遇；个别 id 需要改命座时显式传） */
function mates(ids: string[], extra: Array<Record<string, unknown>> = []): HarnessTeamSlot[] {
  return ids.map((agentId, i) => ({ agentId, cinemaLevel: 6, ...(extra[i] ?? {}) }) as HarnessTeamSlot)
}

/**
 * 单点真管线读数（**每点全新 `setupHarness`**，见头注释口径②）。
 *
 * `read` 拿到的是真 `useResourceCalc()` 的三件产物：`resourceResult.characters`（按 agentId 找）、
 * `damagePoolRows`、`panels`。返回值就是断言要的标量/行，**不在探针里做任何加工**——
 * 闭式一律写在断言里，这样"接错字段"能在断言文本里一眼看出。
 */
async function probe<T>(
  team: Array<HarnessTeamSlot | ''>,
  settingId: string,
  value: number,
  read: (calc: ReturnType<typeof useResourceCalc>) => T,
  opts: { lock?: number; battleTime?: number; axis?: boolean } = {},
): Promise<T> {
  const { config } = await setupHarness(team)
  for (const buff of config.globalBuffs) buff.enabled = false
  if (opts.lock !== undefined) config.enemy.stunCountLock = opts.lock
  if (opts.battleTime !== undefined) config.enemy.battleTime = opts.battleTime
  if (opts.axis !== undefined) config.useStunAxis = opts.axis
  const calc = useResourceCalc()
  config.setMechanicSetting(settingId, value)
  await new Promise(r => setTimeout(r, 0))
  return read(calc)
}

/** 取被测角色的资源结果（缺失时抛错——静默 `undefined` 会退化成恒等式自骗） */
function charOf(calc: ReturnType<typeof useResourceCalc>, agentId: string) {
  const char = calc.resourceResult.value?.characters?.find(c => c.agentId === agentId)
  if (!char) throw new Error(`资源结果里没有 ${agentId}（队伍装配失败？）`)
  return char
}

/** 前提断言：这些 id 必须真的在运行时注册表里（否则本文件的口径已过期，红得比断言本身更早） */
const REGISTERED = new Set(getRegisteredMechanicSettings().map(s => s.id))

describe('模块自读 MechanicSetting（Form-B/C/D）生效：规范值型（精确线性）', () => {
  it('前提：本批 21 条 id 全在运行时注册表里', () => {
    const ids = [
      'banyue.diDongComboCount', 'burnice.flowCountUtilization', 'burnice.singleSpraySeconds',
      'burnice.stirringCount', 'claret.bloodBurialCount', 'claret.chainInWindowCoverage',
      'claret.cleaveSpecialCount', 'claret.gashCoverage', 'liuyin.c6EchoMax', 'liuyin.hug60Count',
      'liuyin.previousTeammateSlot', 'lucia.additionalAttackCount', 'lucia.frontSwitchRatio',
      'nangong.releaseCoverage', 'nangong.vibratoStacksPerRelease', 'norma.holdSeconds',
      'roxy.spinSeconds', 'sigrid.cinema4Coverage', 'yeshuguang.zhaoyingCount',
      'yixuan.c6GiftUltCount', 'yixuan.stunExCoverage',
    ]
    const missing = ids.filter(id => !REGISTERED.has(id))
    expect(missing, `不在运行时注册表里 ⇒ 本文件口径过期：${missing.join(', ')}`).toEqual([])
  })

  /**
   * `norma.holdSeconds`：`norma.ts:262` 的 `clamp(cfgNum(…, 2), 0, 2)` → `:263`
   * `cfg.exSpecialEnergyConsume = 40 + 20·hold`（`EX_SPECIAL_ENERGY_COST = 40`、
   * `HOLD_ENERGY_PER_SEC = 20`，均文件内常量；此处按字面写闭式，改口径即红）。
   *
   * ⚠ 别用「延长行是否存在」当 v=0.5 的证据：实测 v=0.5 时热量非 0（44）但**行用 `floor(hold)`=0**，
   * 延长行完全不存在；也别断言 `heatTotal`（实测非单调 734→700→726→704→734），
   * 它含热量回收反馈。`exSpecialEnergyConsume` 是**最干净**的观测点（纯输入→输出，无反馈）。
   */
  it('norma.holdSeconds：exSpecialEnergyConsume === 40 + 20·v（三点 0 / 1 / 2）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1571', ...RICH }, ...mates(['1371', '1431'])]
    const failures: string[] = []
    for (const v of [0, 1, 2]) {
      const consume = await probe(team, 'norma.holdSeconds', v,
        calc => charOf(calc, '1571').exSpecialEnergyConsume, { lock: 3 })
      const expected = 40 + 20 * v
      if (consume !== expected) failures.push(`v=${v}: exSpecialEnergyConsume 应为 ${expected}，实到 ${consume}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `roxy.spinSeconds`：`roxy.ts:157` 的 `max(0, cfgSetting(…, 2))` → `:247-259` 自旋行
   * `1621008` 的 `decibelRecovery = 表值(84.343) · spinSeconds`（`decibelRecoveryOverride: true`）。
   *
   * ⚠ 只断言**行级** `decibelRecovery` / `damageMultiplier`（无上限、精确线性）：
   * 风能/风眼/送别系在 `spinSeconds ≥ 2.1667` 后饱和（`windEnergyConsumed` 封顶 3/EX，
   * v=2.5 与 v=4/5 都是 129，v=10 甚至回落到 123）⇒ 拿风能做三点会得出"滑块反向"的假结论。
   * v=0 时该行**不存在**（`source.spinSeconds > 0` 守卫），断言行缺失而不是 count=0。
   */
  it('roxy.spinSeconds：行 1621008 decibelRecovery === 84.343·v（三点 0 / 1 / 2.5）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1621', ...RICH }, ...mates(['1371', '1431'])]
    const failures: string[] = []
    const DECIBEL_PER_SEC = 84.343 // catalog `1621008` decibel_recovery（每秒口径，@fact agent:1621/自旋喧响每秒口径）
    for (const v of [0, 1, 2.5]) {
      const row = await probe(team, 'roxy.spinSeconds', v,
        calc => charOf(calc, '1621').executions.find(e => e.moveId === '1621008'), { lock: 3 })
      if (v === 0) {
        if (row) failures.push(`v=0: 自旋行应缺失（spinSeconds>0 守卫），实到 ${JSON.stringify(row)}`)
        continue
      }
      if (!row) { failures.push(`v=${v}: 自旋行不存在 ⇒ 滑块没接线`); continue }
      const expected = DECIBEL_PER_SEC * v
      // ⚠ `decibelRecovery` 在 `SkillExecution` 里是可选的（`execution.ts:39`）⇒ 缺字段读成
      // `undefined` 会让 `Math.abs(NaN) > 1e-6` 静默为 false、**假绿**；必须显式判缺失。
      if (row.decibelRecovery === undefined) {
        failures.push(`v=${v}: 自旋行缺少 decibelRecovery 字段（override 没落上）`)
      } else if (Math.abs(row.decibelRecovery - expected) > 1e-6) {
        failures.push(`v=${v}: decibelRecovery 应为 ${expected}，实到 ${row.decibelRecovery}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `burnice.flowCountUtilization`：`burnice.ts:289` 的 `clamp(cfgSetting(…, 1), 0, 1)`
   * → `:183-187`：`flowCountEffective = floor(flowCountRaw·v)`、`flowFireCount = floor(eff/12)`。
   *
   * ⚠ **不要硬编 4/9**：`flowCountRaw` 随夹具变（本队实测 111）。闭式一律用**同一次读数**里的
   * `flowCountRaw` 解，这样夹具漂移不假红。⚠ 双重 floor ⇒ v=0.5 的 4 不是 9 的一半，
   * 这是**口径不是缺陷**（`floor` 在乘之后：先按覆盖率折有效流火数，再按 12/次折抛接次数）。
   */
  it('burnice.flowCountUtilization：eff === floor(raw·v) 且 fire === floor(eff/12)（三点 0 / 0.5 / 1）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1171', ...RICH }, ...mates(['1481', '1371'])]
    const failures: string[] = []
    for (const v of [0, 0.5, 1]) {
      const src = await probe(team, 'burnice.flowCountUtilization', v,
        calc => charOf(calc, '1171').burniceMechanicSource)
      if (!src) { failures.push(`v=${v}: burniceMechanicSource 缺失`); continue }
      const expectedEff = Math.floor(src.flowCountRaw * v)
      const expectedFire = Math.floor(expectedEff / 12)
      if (src.flowCountEffective !== expectedEff) {
        failures.push(`v=${v}: flowCountEffective 应为 floor(${src.flowCountRaw}×${v})=${expectedEff}，实到 ${src.flowCountEffective}`)
      }
      if (src.flowFireCount !== expectedFire) {
        failures.push(`v=${v}: flowFireCount 应为 floor(${expectedEff}/12)=${expectedFire}，实到 ${src.flowFireCount}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `burnice.singleSpraySeconds`：`burnice.ts:285` 的 `clamp(cfgSetting(…, 1.89), 0, 1.89)`
   * → `:123-137` 与 `:385` 单喷持续行 `1171010` 的 `actionTime = s1`、
   * `damageMultiplier = 1088.3·s1/1.89`（`SINGLE_SUSTAINED_BASE = 1088.3`、上限 1.89s）。
   *
   * ⚠ **队伍总伤害对这条不单调**：v=0 时强特更便宜，省下的秒被回收 ⇒ 总伤反而更高。
   * **禁止**写 `dmg(0) < dmg(default) < dmg(max)`，只断言行级量。
   */
  it('burnice.singleSpraySeconds：行 1171010 actionTime === v 且 mult ≈ 1088.3·v/1.89（v=0 断言行缺失）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1171', ...RICH }, ...mates(['1481', '1371'])]
    const failures: string[] = []
    const BASE = 1088.3 // catalog `1171010` damage（= 1.89s 满持续倍率，SINGLE_SUSTAINED_BASE）
    const MAX_S = 1.89
    for (const v of [0, 0.5, 1.89]) {
      const row = await probe(team, 'burnice.singleSpraySeconds', v,
        calc => charOf(calc, '1171').executions.find(e => e.moveId === '1171010'))
      if (v === 0) {
        if (row) failures.push(`v=0: 单喷持续行应缺失（s1<=0 ⇒ singleCount=0），实到 ${JSON.stringify(row)}`)
        continue
      }
      if (!row) { failures.push(`v=${v}: 单喷持续行不存在 ⇒ 滑块没接线`); continue }
      if (Math.abs(row.actionTime - v) > 1e-9) {
        failures.push(`v=${v}: actionTime 应为 ${v}，实到 ${row.actionTime}`)
      }
      const expected = BASE * v / MAX_S
      if (Math.abs((row.damageMultiplier ?? 0) - expected) > 1e-6) {
        failures.push(`v=${v}: damageMultiplier 应为 ${expected}，实到 ${row.damageMultiplier}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `burnice.stirringCount` ★ 弱断言（v=0 是**哨兵 = AUTO**，不是零）：
   * `burnice.ts:288` 的 `max(0, floor(cfgSetting(…, 0)))` → `:176-178`
   * `stirringCount = min(requested === 0 ? stirringMaxCount : requested, stirringMaxCount)`。
   *
   * ⇒ **UI min 也是 0，无法通过该滑块表达「0 次搅拌」**（原文「默认 0 = 自动取满」），
   * 故这里断言的是**三段闭式**而非比例：`count === min(v===0 ? max : v, max)`、
   * `free === count`（`stirringFreeEmberCount = stirringCount`）、
   * `raw === ember + 2·count`（`FLOW_COUNT_PER_STIRRING_EMBER = 2`）。
   *
   * ⚠ **必须把 `config.enemy.battleTime` 设短**（头注释坑 1）：180s ⇒ `stirringMaxCount = 0`
   * 全程 no-op（`max = floor((totalIgnition − ember×8)/20)`，本队 180s 时为 0）；
   * 60s 时 `max = 9` 才有观测。`max = 0` 时该 id 是**合法 no-op**，不是缺陷。
   * 三点取 v = 1 / 3 / 9（**避开 0 哨兵**，否则第一点会比 max 而不是 0）。
   */
  it('burnice.stirringCount：count === min(v===0?max:v, max) 且 free === count、raw === ember + 2·count（battleTime=60）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1171', ...RICH }, ...mates(['1481', '1371'])]
    const failures: string[] = []
    for (const v of [0, 1, 3, 9]) {
      const src = await probe(team, 'burnice.stirringCount', v,
        calc => charOf(calc, '1171').burniceMechanicSource, { battleTime: 60 })
      if (!src) { failures.push(`v=${v}: burniceMechanicSource 缺失`); continue }
      if (src.stirringMaxCount <= 0) {
        failures.push(`v=${v}: 夹具失效 —— stirringMaxCount = ${src.stirringMaxCount}（battleTime=60 时本队应为 9）⇒ 本条退化成恒 0 假绿`)
        continue
      }
      const expected = Math.min(v === 0 ? src.stirringMaxCount : v, src.stirringMaxCount)
      if (src.stirringCount !== expected) {
        failures.push(`v=${v}: stirringCount 应为 min(${v === 0 ? 'max' : v}, ${src.stirringMaxCount})=${expected}，实到 ${src.stirringCount}`)
      }
      if (src.stirringFreeEmberCount !== src.stirringCount) {
        failures.push(`v=${v}: stirringFreeEmberCount 应 === stirringCount(${src.stirringCount})，实到 ${src.stirringFreeEmberCount}`)
      }
      const expectedRaw = src.emberTriggerCount + 2 * src.stirringCount
      if (src.flowCountRaw !== expectedRaw) {
        failures.push(`v=${v}: flowCountRaw 应为 ember(${src.emberTriggerCount}) + 2×stirring(${src.stirringCount})=${expectedRaw}，实到 ${src.flowCountRaw}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)
})

describe('模块自读 MechanicSetting（Form-B/C/D）生效：拆分/消耗次数型', () => {
  /**
   * `banyue.diDongComboCount`：`banyue.ts:248` 的形参 `diDongComboCount`（模块经 `setting:` 通道读入）
   * → `:305-307` 怒相外连段拆分：
   *   `diDongComboOut = min(diDongCombo, comboOut)`、`lunDaoComboOut = max(0, comboOut − diDongComboOut)`。
   *
   * 这是**纯分配**滑块（不改变连段总数）：把怒相外自动连段在「地动→山摇·怒」与「论道→狮子吼·怒」
   * 两种连段之间重新分配。⇒ 闭式两条都是**恒等式**（读数自洽），不依赖任何硬编夹具值。
   *
   * ⚠ 三点取 v = 0 / 4 / 8 **不要取 0/10/20**：`comboOut` 由闪能上限钉死（本队实测 8），
   * >8 即饱和、10 与 20 与 8 逐位相同 ⇒ 第三点会退化成"与饱和点同值"的假 no-delta。
   * ⚠ `diDongRecoveryCount ≈ round(10·v/8)` 是**带舍入**的（v=3 ⇒ 4 而非 3），
   * 别把后摇拆分写成严格比例（那是 `comboOutRecovery × lunDaoShare` 的 `Math.round`）。
   */
  it('banyue.diDongComboCount：diDongOut === min(v, comboOut) 且 lunDaoOut === comboOut − diDongOut（三点 0 / 4 / 8）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1471', ...RICH }, ...mates(['1481', '1371'])]
    const failures: string[] = []
    for (const v of [0, 4, 8]) {
      const cyc = await probe(team, 'banyue.diDongComboCount', v,
        calc => charOf(calc, '1471').banyueRageCycle)
      if (!cyc) { failures.push(`v=${v}: banyueRageCycle 缺失`); continue }
      if (cyc.comboOutCount <= 0) {
        failures.push(`v=${v}: 夹具失效 —— comboOutCount = ${cyc.comboOutCount}（闪能非 0 才有怒相外连段）⇒ 本条退化成恒 0 假绿`)
        continue
      }
      const expectedDiDong = Math.min(v, cyc.comboOutCount)
      if (cyc.diDongOutCount !== expectedDiDong) {
        failures.push(`v=${v}: diDongOutCount 应为 min(${v}, comboOut=${cyc.comboOutCount})=${expectedDiDong}，实到 ${cyc.diDongOutCount}`)
      }
      const expectedLunDao = cyc.comboOutCount - cyc.diDongOutCount
      if (cyc.lunDaoOutCount !== expectedLunDao) {
        failures.push(`v=${v}: lunDaoOutCount 应为 comboOut − diDongOut = ${expectedLunDao}，实到 ${cyc.lunDaoOutCount}`)
      }
      // 纯分配：两种连段之和守恒（改滑块只搬运，不改总数）
      if (cyc.diDongOutCount + cyc.lunDaoOutCount !== cyc.comboOutCount) {
        failures.push(`v=${v}: diDongOut + lunDaoOut = ${cyc.diDongOutCount + cyc.lunDaoOutCount} ≠ comboOutCount ${cyc.comboOutCount} ⇒ 不是纯分配`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `claret.cleaveSpecialCount`：`claret.ts` 的 `max(0, floor(cfgSetting(…, 1)))` →
   *   `maimStackBudget = cleave + 3·burial`（★ **层预算**，R54 起**不含** c6Extra）；
   *   `maimDemand = maimStackBudget + c6Extra`（展示用总量）；
   *   `gashStackConsumed = min(gashStacks, max(0, maimStackBudget)) · coverage`；
   *   `maimFromCleave = min(gashStackConsumed, cleave)`。
   *
   * ★ **R54（2026-09-20）修正**：旧版把 `c6Extra` 并进 `maimDemand` 后**又拿 demand 当层预算**，
   *   白白抬高钳位上限 ⇒ `maimCount` 虚高（实测 62/253 夹具、最大 +8 次）。原文依据：
   *   `talent.6.desc`「重击命中敌人时，**不消耗[残痕]**直接触发1次单体[毁伤]」。
   *   本测试的闭式随之改为**层预算**口径（用 `maimDemand − maimFromC6` 解出，不硬编 burial）。
   *
   * 闭式全部用**同一次读数里的字段**解，两条关键项都不硬编：
   * · `c6Extra` 就是结果里的 `maimFromC6`（`claret.ts` 的 `maimFromC6: c6Extra`）——
   *   R50 侦察实测它在两次运行里分别是 0 与 10（`chainCountTotal`/`ultimateCount` 收敛反馈敏感），
   *   **禁止写死**。
   * · `maimFromCleave === min(consumed, cleave)` 是**带上限的 min 形式**：`gashStacks` 不够时
   *   提前触顶（把 cleave 抬到 6 实测 v=4 ⇒ 10 而非 12）。
   *
   * ⚠ v=0 **不是零效果点**：只是去掉斩金断铁那一份消耗，葬血强袭（默认 1）仍在。
   * ⚠ 需要 `gashStacks > 0`（本队实测 6）；`gashStacks` 本身**不随覆盖率变化**。
   */
  it('claret.cleaveSpecialCount：maimFromCleave === min(consumed, v) 且 maimDemand === 层预算 + c6（三点 0 / 1 / 3）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1611', ...RICH }, ...mates(['1481', '1371'])]
    const failures: string[] = []
    const BURIAL_DEFAULT = 1 // `claret.ts` 的 cfgSetting fallback（本测试不动 burial）
    for (const v of [0, 1, 3]) {
      const src = await probe(team, 'claret.cleaveSpecialCount', v,
        calc => charOf(calc, '1611').claretSharpResourceSource)
      if (!src) { failures.push(`v=${v}: claretSharpResourceSource 缺失`); continue }
      if (src.gashStacks <= 0) {
        failures.push(`v=${v}: 夹具失效 —— gashStacks = ${src.gashStacks}（需 > 0 才有消耗可观测）⇒ 本条退化成恒 0 假绿`)
        continue
      }
      const expectedFromCleave = Math.min(src.gashStackConsumed, v)
      if (src.maimFromCleave !== expectedFromCleave) {
        failures.push(`v=${v}: maimFromCleave 应为 min(consumed=${src.gashStackConsumed}, ${v})=${expectedFromCleave}，实到 ${src.maimFromCleave}`)
      }
      // 层预算 = cleave + 3·burial（★ R54：**不含** c6 —— C6 原文「不消耗[残痕]」）
      const budget = v + BURIAL_MAIM_PER_CAST * BURIAL_DEFAULT
      const expectedDemand = budget + (src.maimFromC6 ?? 0)
      if (src.maimDemand !== expectedDemand) {
        failures.push(`v=${v}: maimDemand 应为 层预算(${budget}) + c6(${src.maimFromC6})=${expectedDemand}，实到 ${src.maimDemand}`)
      }
      const expectedConsumed = Math.min(src.gashStacks, Math.max(0, budget))
      if (src.gashStackConsumed !== expectedConsumed) {
        failures.push(`v=${v}: gashStackConsumed 应为 min(stacks=${src.gashStacks}, 层预算=${budget})=${expectedConsumed}（覆盖率默认 100），实到 ${src.gashStackConsumed}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `claret.bloodBurialCount`：`claret.ts:410` 的 `max(0, floor(cfgSetting(…, 1)))` → `:235-239`
   *   `maimFromBurial = min(gashStackConsumed − maimFromCleave, burial · BURIAL_MAIM_PER_CAST)`（3/次）。
   *
   * ⚠ **单断言 `maimFromBurial === 3·v` 只在 `consumed − fromCleave ≥ 3v` 时成立** ——
   * 把 cleave 抬到 6 会提前触顶（实测 v=4 ⇒ 10 而非 12）⇒ 本测试断言上面那条 **min 形式**。
   * ⚠ 不要用 `maimDemand === cleave + 3v + c6Extra` 里的 `c6Extra` 常数（见上一条备注）；
   * `maimFromBurial` 的 min 形式对 `c6Extra` **不敏感**（c6Extra 只抬高 demand，不抬高上限）。
   * ★ R54：需求侧闭式改为「层预算 + c6」（层预算不含 c6，见上一条）。
   */
  it('claret.bloodBurialCount：maimFromBurial === min(consumed − fromCleave, 3·v)（三点 0 / 1 / 3）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1611', ...RICH }, ...mates(['1481', '1371'])]
    const failures: string[] = []
    for (const v of [0, 1, 3]) {
      const src = await probe(team, 'claret.bloodBurialCount', v,
        calc => charOf(calc, '1611').claretSharpResourceSource)
      if (!src) { failures.push(`v=${v}: claretSharpResourceSource 缺失`); continue }
      if (src.gashStacks <= 0) {
        failures.push(`v=${v}: 夹具失效 —— gashStacks = ${src.gashStacks} ⇒ 本条退化成恒 0 假绿`)
        continue
      }
      const expected = Math.min(src.gashStackConsumed - src.maimFromCleave, BURIAL_MAIM_PER_CAST * v)
      if (src.maimFromBurial !== expected) {
        failures.push(`v=${v}: maimFromBurial 应为 min(${src.gashStackConsumed} − ${src.maimFromCleave}, ${BURIAL_MAIM_PER_CAST}×${v})=${expected}，实到 ${src.maimFromBurial}`)
      }
      // 同一份读数解出的需求侧恒等式（c6Extra 用结果里的 maimFromC6，不硬编）
      // ★ R54：层预算 = cleave(1) + 3·v，**不含** c6
      const budget = 1 + BURIAL_MAIM_PER_CAST * v // cleave 默认 1（本测试不动它）
      const expectedDemand = budget + (src.maimFromC6 ?? 0)
      if (src.maimDemand !== expectedDemand) {
        failures.push(`v=${v}: maimDemand 应为 层预算(1 + ${BURIAL_MAIM_PER_CAST}×${v})=${budget} + c6(${src.maimFromC6})=${expectedDemand}，实到 ${src.maimDemand}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `claret.gashCoverage`：`claret.ts` 的 `max(0, min(1, min(100, cfgSetting(…, 100))/100))`
   * → `gashStackConsumed = min(gashStacks, max(0, **层预算**)) · coverage`
   * 与 `maimCount = floor(gashStackConsumed) + c6Extra`。
   *
   * 闭式 = `consumed === min(stacks, 层预算) · (min(100,v)/100)`。
   * ★ R54：`层预算 = maimDemand − maimFromC6`（不含 c6；旧版误用 `maimDemand`）。
   * ⚠ `floor` 在乘**之后**（`maimCount` 才 floor）⇒ 严格说 `consumed` 不是比例量，
   * 但 0/50/100 三点上 `3 × 0.5 = 1.5` 不是整数 —— 本测试用**实测读数**解闭式，不假设整除。
   * ⚠ 三点要落在「floor 后互不相同的区间」：本队 `min(stacks, 层预算) = 3`，0/1.5/3 安全。
   */
  it('claret.gashCoverage：gashStackConsumed === min(stacks, 层预算)·v/100 且 maimCount === floor(consumed)+c6（三点 0 / 50 / 100）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1611', ...RICH }, ...mates(['1481', '1371'])]
    const failures: string[] = []
    const seen: number[] = []
    for (const v of [0, 50, 100]) {
      const src = await probe(team, 'claret.gashCoverage', v,
        calc => charOf(calc, '1611').claretSharpResourceSource)
      if (!src) { failures.push(`v=${v}: claretSharpResourceSource 缺失`); continue }
      // ★ R54：层预算 = maimDemand − maimFromC6（C6 原文「不消耗[残痕]」⇒ 不进层预算）
      const budget = src.maimDemand - (src.maimFromC6 ?? 0)
      const cap = Math.min(src.gashStacks, Math.max(0, budget))
      const expected = cap * (Math.min(100, v) / 100)
      seen.push(src.gashStackConsumed)
      if (Math.abs(src.gashStackConsumed - expected) > 1e-9) {
        failures.push(`v=${v}: gashStackConsumed 应为 min(${src.gashStacks}, 层预算${budget})×${v}/100=${expected}，实到 ${src.gashStackConsumed}`)
      }
      const expectedMaim = Math.floor(src.gashStackConsumed) + (src.maimFromC6 ?? 0)
      if (src.maimCount !== expectedMaim) {
        failures.push(`v=${v}: maimCount 应为 floor(${src.gashStackConsumed}) + c6(${src.maimFromC6})=${expectedMaim}，实到 ${src.maimCount}`)
      }
    }
    // 三点真的互不相同（防"floor 后压平 ⇒ 断言退化"）
    if (new Set(seen).size !== seen.length) {
      failures.push(`三点 gashStackConsumed 出现重复（${JSON.stringify(seen)}）⇒ 点位退化成假 no-delta，请重挑夹具`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `claret.chainInWindowCoverage`：`claret.ts:398` 的 `min(1, cfgSetting(…, 100)/100)`
   * → `:546-553` 的 `stopwatchCoverage` → `computeInscriptionExtension`（`:526-539`）
   * → `claretSharpResourceSource.inscriptionWindowSeconds`（= 全局总延长秒，`claret.ts:610`）。
   *
   * 闭式：`window(v) = chains·2 + (v/100)·(chains·chainAction + ults·ultAction)` —— 对 `v/100`
   * **严格线性**（R50 侦察实测 0/50/100 ⇒ 12 / 25.983 / 39.966，误差 < 1e-6）。
   * 这里不断言绝对秒数（`chains`/`chainAction` 随夹具与收敛漂），改断言**线性插值恒等式**
   * `w(50) === (w(0) + w(100))/2`：它等价于"滑块按比例进算式"，但对基线漂移免疫。
   *
   * ⚠ 闭式里 `chains × 2s` 的「秒表赠送」项**不乘覆盖率**（`computeInscriptionExtension` 第一项），
   * 所以 `w(0)` 不是 0 而是 `chains·2`；⚠ 台账 `while` 循环在 `3·16 + ext > basicAttackTime`
   * 后 `k` 停在被 1 ⇒ `inscriptionTime` 饱和 ⇒ **覆盖率不可观测**（换更"连携多"的队会静默压平）。
   */
  it('claret.chainInWindowCoverage：inscriptionWindowSeconds 对 v/100 严格线性（三点 0 / 50 / 100）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1611', ...RICH }, ...mates(['1481', '1371'])]
    const failures: string[] = []
    const w: Record<number, number> = {}
    for (const v of [0, 50, 100]) {
      const raw = await probe(team, 'claret.chainInWindowCoverage', v,
        calc => charOf(calc, '1611').claretSharpResourceSource?.inscriptionWindowSeconds)
      if (raw === undefined || !Number.isFinite(raw)) { failures.push(`v=${v}: inscriptionWindowSeconds 不可得（${raw}）`); continue }
      w[v] = raw
    }
    if (w[0] !== undefined && w[50] !== undefined && w[100] !== undefined) {
      if (!(w[100] > w[0])) {
        failures.push(`w(100)=${w[100]} 未大于 w(0)=${w[0]} ⇒ 覆盖率完全没生效（或铭刻时间已饱和压平）`)
      }
      const mid = (w[0] + w[100]) / 2
      if (Math.abs(w[50] - mid) > 1e-6) {
        failures.push(`线性插值不成立：w(50) 应为 (w(0)+w(100))/2 = ${mid}，实到 ${w[50]}（w0=${w[0]} w100=${w[100]}）`)
      }
      // 「秒表赠送」项（chains×2s）不乘覆盖率 ⇒ w(0) 必须 > 0，否则说明该队无连携窗口、本条无观测
      if (!(w[0] > 0)) failures.push(`w(0)=${w[0]} 应为 chains×2s > 0（连携窗口赠送项）⇒ 夹具无连携，本条无从观测`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)
})

describe('模块自读 MechanicSetting（Form-B/C/D）生效：琉音（含跨层消费点）', () => {
  /**
   * 琉音夹具：**队友必须显式喂 `chainCountPerStun: 2`**。
   *
   * `promoteFixpoint`（`liuyinPromote.ts:277`）里 60 转大的上限走
   * `targetChainTotal = min(chainCountPerStun·stunCount, chainExecCount)`，
   * 而 `chainCountPerStun` 取自**槽位 cfg**（`configStore.team` 逐槽相加，`:242`）。
   * 队友槽不喂 ⇒ 只有琉音自己那 2，`min(2·stun, …)` 会把上限压到 2——
   * 那时 `hug60` 三点看起来"没反应"，**不是滑块坏了**（这是本文件实测踩到的第二个坑）。
   */
  const LIUYIN_TEAM: HarnessTeamSlot[] = [
    { agentId: '1481', ...RICH },
    { agentId: '1371', cinemaLevel: 6, chainCountPerStun: 2 },
    { agentId: '1431', cinemaLevel: 6, chainCountPerStun: 2 },
  ]

  /**
   * `liuyin.c6EchoMax` ★ **本批唯一一条消费点不在自己模块**的 id：
   * 声明在 `liuyin.ts:500`，但真实消费在**伤害池**
   * `src/composables/resourceCalc/damagePool.ts:1116` 的
   * `Math.max(0, Math.floor(configStore.getMechanicSetting('liuyin.c6EchoMax', 12)))`
   * → `:1118` 的 `echoCount = promoteCount · c6EchoMax`（`if (promoteCount > 0 && c6EchoMax > 0)` 守卫）。
   *
   * ⇒ **只能走真管线才测得到**（手写 cfg 完全碰不到 `configStore.getMechanicSetting`）。
   *
   * 闭式：`row.count === liuyinPromoteCount · v`、`row.multiplier === 480`（`CINEMA6_ECHO_RATIO`）、
   * `row.totalDamage === perUnit · count`（严格线性）。`liuyinPromoteCount` 从**同一份管线**读
   * （本队 lock=3 实测 4），不硬编。v=0 时**行缺失**（`:1117` 的 `c6EchoMax > 0` 守卫）——
   * ⚠ R50 侦察第一版就把它写成 `count === 0` 而 FAIL。
   */
  it('liuyin.c6EchoMax：row.count === promote·v，且 totalDamage 按 promote 倍数线性（三点 0 / 3 / 12）', async () => {
    const failures: string[] = []
    let perUnit: number | undefined
    for (const v of [0, 3, 12]) {
      const r = await probe(LIUYIN_TEAM, 'liuyin.c6EchoMax', v, calc => {
        const rows = calc.damagePoolRows.value.filter(x => x.name === '琉音影画6·余音')
        return { promote: calc.liuyinPromoteCount.value, rows }
      }, { lock: 3 })
      if (r.promote <= 0) {
        failures.push(`v=${v}: 夹具失效 —— liuyinPromoteCount = ${r.promote}（需 > 0 否则行恒缺失）⇒ 本条退化成假绿`)
        continue
      }
      if (v === 0) {
        if (r.rows.length !== 0) failures.push(`v=0: 余音行应缺失（echoCount=0 守卫），实到 ${r.rows.length} 行`)
        continue
      }
      if (r.rows.length !== 1) { failures.push(`v=${v}: 余音行应恰好 1 行，实到 ${r.rows.length} 行`); continue }
      const row = r.rows[0]
      const expectedCount = r.promote * v
      if (row.count !== expectedCount) {
        failures.push(`v=${v}: count 应为 promote(${r.promote})×${v}=${expectedCount}，实到 ${row.count}`)
      }
      if (row.multiplier !== CINEMA6_ECHO_RATIO) {
        failures.push(`v=${v}: multiplier 应为 ${CINEMA6_ECHO_RATIO}，实到 ${row.multiplier}`)
      }
      // 线性性锚点：单次伤害（= totalDamage/count）必须与 v 无关
      const unit = row.totalDamage / row.count
      if (perUnit === undefined) perUnit = unit
      else if (Math.abs(unit - perUnit) > 1e-9) {
        failures.push(`v=${v}: 单次伤害 ${unit} 与首点 ${perUnit} 不同 ⇒ totalDamage 不是按 count 线性`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `liuyin.hug60Count`：声明 `liuyin.ts:470`；读 `liuyin.ts:257`（`floor(cfgNum(…, -1))`）
   * 与 `liuyinPromote.ts:164`（`configStore.getMechanicSetting(…, -1)`）→ `computeLiuyinHugCounts`。
   *
   * 闭式：`hug60 === min(v, chainWindows, 2·stunCount)`（三重夹紧，`liuyin.ts:112-116`）。
   * 本夹具（lock=3 + 队友各 chainCountPerStun=2）实测上限 == 4 ⇒ 三点取 v = 0 / 2 / 4 全在线性段。
   *
   * ⚠ **默认 −1 = AUTO（= min(stunCount, chainWindows)），不是 0**：实测 −1 ⇒ 2、0 ⇒ 0。
   * ⚠ 超过上限后被夹紧（实测 v=5/8 ⇒ 4）⇒ **别拿 5 或 8 当 max 点**（R50 侦察第一版就是这么 FAIL 的）。
   */
  it('liuyin.hug60Count：hug60 === v（三点 0 / 2 / 4 全在上限内）且 promote === hug60 + hug90', async () => {
    const failures: string[] = []
    for (const v of [0, 2, 4]) {
      const r = await probe(LIUYIN_TEAM, 'liuyin.hug60Count', v, calc => ({
        hug60: calc.liuyinPromoteHug60.value, promote: calc.liuyinPromoteCount.value,
      }), { lock: 3 })
      if (r.promote <= 0) {
        failures.push(`v=${v}: 夹具失效 —— liuyinPromoteCount = ${r.promote} ⇒ 本条无从观测`)
        continue
      }
      if (r.hug60 !== v) {
        failures.push(`v=${v}: hug60 应为 ${v}（v ≤ 上限 4），实到 ${r.hug60} —— 超过上限说明点位越界，请复核夹具`)
      }
      if (r.promote < r.hug60) {
        failures.push(`v=${v}: promote(${r.promote}) < hug60(${r.hug60}) ⇒ 60 档是 90 档的子集，违反 promote = hug60 + hug90`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `liuyin.previousTeammateSlot` ★ **类别判据（不是比例量）**：
   * 声明 `liuyin.ts:460`；读 `:251` → `resolvePreviousTeammateSlot(slot, teamLength, setting)`
   *   （`:147-151`：`setting >= 0 && setting < teamLength && setting !== ownSlot ⇒ setting`，
   *    否则回落到 `(ownSlot−1+teamLength) % teamLength`）。
   *
   * 这是「专属直伤读哪个队友的面板」的**身份选择**，没有单调/比例可言：
   * ⚠ **v=0 与 v=2 都落到 slot 2**（0 == 琉音自己槽 ⇒ 走回落分支），
   * 三点取 0/1/2 会看到「同值→异值→同值」的非单调形状，**这不是缺陷**。
   *
   * 替代判据（R50 侦察给的两条，这里两条都用）：
   * ① **语义**：`slot === (v >= 0 && v < 3 && v !== 0) ? v : 2`（琉音在槽 0，队伍 3 人）；
   * ② **伤害面**：`slot === 1` 时重击附加伤害行总伤 **严格大于** `slot === 2` 时
   *    （槽 1 队友 1371 的攻击面板更高，实测 106955.94 > 75897.69）——
   *    这条是「读数真的换了面板」的**独立**证据，语义断言单独存在时可能只是回显了设置值。
   */
  it('liuyin.previousTeammateSlot：slot === 1 时附加伤害严格大于 slot === 2（类别判据 + 语义回落）', async () => {
    const readSlot = (v: number) => probe(LIUYIN_TEAM, 'liuyin.previousTeammateSlot', v, calc => {
      const c = calc.resourceResult.value?.characters?.find(x => x.agentId === '1481')
      const row = calc.damagePoolRows.value.find(r => r.name === '琉音额外能力·重击附加伤害')
      return {
        slot: (c as { liuyinMechanicSource?: { previousTeammateSlot: number } } | undefined)
          ?.liuyinMechanicSource?.previousTeammateSlot,
        total: row?.totalDamage,
      }
    }, { lock: 3 })

    // 琉音在槽 0；0 是自己槽 ⇒ 回落 (0−1+3)%3 = 2；1 是合法他人槽 ⇒ 用它
    const expected = new Map<number, number>([[0, 2], [1, 1], [2, 2]])
    const failures: string[] = []
    const totals: Record<number, number | undefined> = {}
    for (const v of [-1, 0, 1, 2]) {
      const r = await readSlot(v)
      if (r.slot === undefined) { failures.push(`v=${v}: previousTeammateSlot 不可得`); continue }
      const exp = v === -1 ? 2 : expected.get(v)! // −1 = AUTO = 队伍顺序中琉音前一位（环绕）= 2
      if (r.slot !== exp) failures.push(`v=${v}: slot 应为 ${exp}，实到 ${r.slot}`)
      totals[v] = r.total
      if (r.total === undefined) failures.push(`v=${v}: 重击附加伤害行缺失（伤害面判据无从比较）`)
    }
    // 伤害面判据：不同槽 ⇒ 面板不同 ⇒ 总伤不同，且槽 1 > 槽 2
    if (totals[1] !== undefined && totals[2] !== undefined) {
      if (!(totals[1] > totals[2])) {
        failures.push(`伤害面：slot=1 总伤(${totals[1]}) 应严格大于 slot=2(${totals[2]}) ⇒ 读数没真的换面板`)
      }
    }
    // v=0 与 v=2 同槽 ⇒ 伤害必须逐位相同（同槽同面板，任何差异都说明另有隐藏通道）
    if (totals[0] !== undefined && totals[2] !== undefined && totals[0] !== totals[2]) {
      failures.push(`v=0 与 v=2 同读槽 2，总伤应逐位相同，实到 ${totals[0]} vs ${totals[2]}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)
})

describe('模块自读 MechanicSetting（Form-B/C/D）生效：卢西娅 / 南宫羽 / 希格莉德', () => {
  /**
   * `lucia.additionalAttackCount`：`luciaElowen.ts:400` 的 `cfgNum(cfg,'lucia.additionalAttackCount',20)`
   * → `additionalAttackCapOf`（`:395-415`）→ `computeLuciaDreamPlan`（`:70`）
   *   `additionalAttackCount = min(cap, floor(dreamTotal/25))`、
   *   `additionalAttackDreamCost = 25 · count`（`ADDITIONAL_ATTACK_DREAM_COST = 25`）。
   *
   * 强断言（区间内）：`count === v` 且 `cost === 25·v`。
   * ⚠ **饱和点依夹具而变**（本队实测 lock=3 ⇒ 17、lock=6 ⇒ 18；另一份并行侦察在别队实测 16）
   * ⇒ 三点必须落在**你自己实测的上限内**（这里取 0 / 10 / 17），或断言
   * `count === min(v, baseline(v=40))`。本测试两条都做：三点绝对值 + 上限自洽。
   */
  it('lucia.additionalAttackCount：count === v 且 cost === 25·v（三点 0 / 10 / 17，另验 40 触顶）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1451', ...RICH }, ...mates(['1371', '1431'])]
    const failures: string[] = []
    const readCount = (v: number) => probe(team, 'lucia.additionalAttackCount', v, calc => {
      const src = charOf(calc, '1451').luciaMechanicSource
      return { count: src?.additionalAttackCount, cost: src?.additionalAttackDreamCost, dream: src?.dreamTotal }
    }, { lock: 3 })

    // 先测运行时上限（v=40 必然被夹到上限）——闭式用它，不硬编 16/17
    const cap = (await readCount(40)).count ?? 0
    if (cap <= 0) failures.push(`上限读数为 ${cap} ⇒ 本条无从观测`)
    for (const v of [0, 10, 17]) {
      const r = await readCount(v)
      const expected = Math.min(v, cap)
      if (r.count !== expected) {
        failures.push(`v=${v}: additionalAttackCount 应为 min(${v}, cap=${cap})=${expected}，实到 ${r.count}`)
      }
      const expectedCost = 25 * (r.count ?? 0)
      if (r.cost !== expectedCost) {
        failures.push(`v=${v}: additionalAttackDreamCost 应为 25×count(${r.count})=${expectedCost}，实到 ${r.cost}`)
      }
    }
    // 防退化：三点读数必须两两不同（全同 = 三点都落在饱和支 ⇒ 断言退化，不是滑块坏）
    const vals = [(await readCount(0)).count, (await readCount(10)).count, (await readCount(17)).count]
    if (new Set(vals).size !== vals.length) {
      failures.push(`三点读数出现重复（${JSON.stringify(vals)}）⇒ 至少一点已饱和，请下移点位`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `lucia.frontSwitchRatio` ★ **弱断言（单调，不比例）**：
   * `luciaElowen.ts:410` 的 `cfgNum(cfg,'lucia.frontSwitchRatio',1)` —— **仅**在 `additionalAttackCapOf`
   * 一处消费 → `core/effectiveTime.ts:105` 的 `frontBlockSeconds` → `:77` 的 `phaseDelayedCooldown`
   * → **追加上限**（不是时间预算、不是前台时间本身）。
   *
   * `block = F/max(1, frontActions·ratio)`，再经 `cd' = 8 + (F/W)(block/2)`、`cap = floor(B_eff/cd')`，
   * 带 floor 与收敛反馈 ⇒ 实测 10 → 14 → 16 **单调但不按比例**。
   * ⇒ 判据 = 严格单调 `count(0) < count(1)`，并额外汇总中间点确认单调不减。
   *
   * ⚠ **露西娅必须主 C 位（槽 0）**：放队友位时该滑块是**合法 no-op**（三次都是 20，
   * 因为梦境池上限 20 先生效、CD 项永不 binding）——本测试已实测确认，不当作缺陷。
   * ⚠ 实测某些相邻点会相同（floor + 收敛巧合）⇒ **不要**断言严格逐点递增，只断言两端严格、
   * 中间单调不减。
   */
  it('lucia.frontSwitchRatio：count(0) < count(1)（弱：单调不比例；露西娅必须槽 0）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1451', ...RICH }, ...mates(['1051', '1431'])]
    const readCount = (v: number) => probe(team, 'lucia.frontSwitchRatio', v, calc =>
      charOf(calc, '1451').luciaMechanicSource?.additionalAttackCount, { lock: 3 })
    const c0 = await readCount(0)
    const cHalf = await readCount(0.5)
    const c1 = await readCount(1)
    expect(c0, 'ratio=0 ⇒ 块长最大 ⇒ 追加上限最小；不可为 undefined').toBeTypeOf('number')
    // 弱判据：只断两端严格递增（不断言比例，也不断言逐点严格递增——实测相邻点可相同）
    expect(c0!).toBeLessThan(c1!)
    expect(cHalf!).toBeGreaterThanOrEqual(c0!)
    expect(cHalf!).toBeLessThanOrEqual(c1!)
    expect(c1!).toBeGreaterThan(0)
  }, 300000)

  /**
   * `nangong.releaseCoverage`：`nangong.ts:279` 的 `clampRatio(setting(cfg,'nangong.releaseCoverage',1))`
   * （另一处 `:349`）→ `:280` 的 `releaseCount = Math.round(stunCount · coverage)`
   * （`nangongStunCount` 由 `:142-143` 从失衡池写入）。
   *
   * 强断言（**需 `stunCountLock = 4`**，R50 侦察实测：要整数比例就必须 lock=4）：
   * `releaseCount === Math.round(stunCount·v)`，lock=4 时恰好等价于 `4v`。
   * 这里用**同一次读数解出的 `stunCountLock`**做闭式，并对锁值加一条前提断言。
   *
   * ⚠ v=0 时**事件与伤害池行都不存在**（`releaseCount > 0` 守卫）——断言行缺失，不是 count=0。
   * ⚠ **别断言 `totalDamage` 与 count 成比例**：主导元素伤害按 boss 异常状态**分段摊到多行**，
   * 各行 count 变动不均匀（实测 count 2→3 时 ether 行不变、ether_ink 行翻倍）。
   *
   * ⚠⚠ 「**每个探针点独立 `setupHarness`**」这条纪律就是被本 id 逼出来的：R50 侦察跨值复用同一
   * harness 时 `nangongMechanicSource.stunCount` 读到 0（收敛态污染），三点全 0 = **假 no-delta**。
   * 本文件的 `probe()` 天然每点新装队，这条断言就是它的回归护栏。
   */
  it('nangong.releaseCoverage：releaseCount === round(4·v)（lock=4；v=0 断言事件与行均缺失）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1511', ...RICH }, ...mates(['1371', '1431'])]
    const failures: string[] = []
    for (const v of [0, 0.5, 1]) {
      const r = await probe(team, 'nangong.releaseCoverage', v, calc => {
        const c = charOf(calc, '1511')
        const ev = (c.anomalyEventExecutions ?? []).find(e => e.eventId === 'nangong_vibrato_release')
        return { release: c.nangongMechanicSource?.releaseCount, evCount: ev?.count, evFields: ev?.fields }
      }, { lock: 4 })
      const expected = Math.round(4 * v) // lock=4 ⇒ stunCount = 4（下一条前提断言保证）
      if (v === 0) {
        if (r.evCount !== undefined) failures.push(`v=0: 颤音异放事件应缺失（releaseCount>0 守卫），实到 count=${r.evCount}`)
        if (r.release !== 0) failures.push(`v=0: releaseCount 应为 0，实到 ${r.release}`)
        continue
      }
      if (r.release !== expected) {
        failures.push(`v=${v}: releaseCount 应为 round(4×${v})=${expected}，实到 ${r.release}`)
      }
      // 事件面与资源面同源（防"资源算了但事件没发"）
      if (r.evCount !== r.release) {
        failures.push(`v=${v}: 事件 count(${r.evCount}) 应 === releaseCount(${r.release})`)
      }
      if (!r.evFields?.some(f => String(f).includes('releaseMultiplier='))) {
        failures.push(`v=${v}: 事件 fields 缺少 releaseMultiplier（倍率未解析）：${JSON.stringify(r.evFields)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `nangong.vibratoStacksPerRelease`：`nangong.ts:272` 的
   * `Math.floor(setting(cfg,'nangong.vibratoStacksPerRelease', 0))`（另一处 `:347`）
   * → `:274-283`：`stacks = v > 0 ? min(4, v) : (轴内触发数 > 0 ? … : 4)`；
   *   `flat = round(450·(1 + (25 + C2?10)/100 · stacks))`（`RELEASE_FLAT_MULTIPLIER = 450`、
   *   `VIBRATO_STACK_PCT = 25`；**C2+ ⇒ `stackPct = 35`**）。
   *
   * 强断言（**避开哨兵**）：`multiplier === round(450·(1 + stackPct/100 · v))`。
   * 三点取 **v = 1 / 2 / 4**（C6 实测 608 / 765 / 1080）。
   *
   * ⚠ **默认 0 是哨兵 = AUTO，非轴模式解析为满层 4** ⇒ `v=0` 与 `v=4` **逐字节相同**
   * （实测 stacks 4 / mult 1080）。若拿 0 当「零效果点」会得到**假 no-delta**。
   * ⚠ 倍率是 `Math.round` ⇒ C0/C1（stackPct=25）时 v=1 得 563 而非 562.5，断言必须走 round 形式。
   * ⚠⚠ **`NangongMechanicSource` 并没有 `cinemaLevel` 字段**（`agentResources.ts:295-307`）——
   * 想"从结果里读命座"会静默得 `undefined ⇒ stackPct=25`，让本该 608 的 C6 读数被算成 563 而**假红**。
   * 本测试改用**双锚点**（同一 v 各跑一次 C6 与 C0 队伍）把 `stackPct` 这一支**钉死**：
   * 两个命座档的期望值不同（608 vs 563），任何一侧接错都立刻红。
   */
  it('nangong.vibratoStacksPerRelease：multiplier === round(450·(1+stackPct/100·v))（双锚点 C6/C0，三点 1 / 2 / 4）', async () => {
    const failures: string[] = []
    // 双锚点：C6 ⇒ stackPct 35（C2 加成在位）；C0 ⇒ stackPct 25。两者都用测试自己传入的命座，
    // **不从结果里读**（那个字段不存在，见上引 ⚠）。
    const anchors: Array<[string, number, number]> = [['C6', 6, 35], ['C0', 0, 25]]
    for (const [label, cinema, stackPct] of anchors) {
      const team: HarnessTeamSlot[] = [
        { agentId: '1511', ...RICH, cinemaLevel: cinema },
        ...mates(['1371', '1431']),
      ]
      for (const v of [1, 2, 4]) {
        const r = await probe(team, 'nangong.vibratoStacksPerRelease', v, calc => {
          const c = charOf(calc, '1511')
          return {
            stacks: c.nangongMechanicSource?.vibratoStacks,
            mults: [...new Set(calc.damagePoolRows.value
              .filter(x => x.name === '南宫羽·颤音异放').map(x => x.multiplier))],
          }
        }, { lock: 3 })
        if (r.stacks !== v) failures.push(`${label} v=${v}: vibratoStacks 应为 ${v}（≤4），实到 ${r.stacks}`)
        if (r.mults.length === 0) { failures.push(`${label} v=${v}: 伤害池没有颤音异放行 ⇒ 本条无从观测`); continue }
        const expected = Math.round(450 * (1 + (stackPct / 100) * v))
        for (const m of r.mults) {
          if (m !== expected) {
            failures.push(`${label} v=${v}: multiplier 应为 round(450·(1+${stackPct}%·${v}))=${expected}，实到 ${m}`)
          }
        }
      }
    }
    // 哨兵语义：0 与 4 逐字节相同（把"0 当零效果点"这一误判钉成可观测事实）
    const sentinelTeam: HarnessTeamSlot[] = [{ agentId: '1511', ...RICH }, ...mates(['1371', '1431'])]
    const sentinel = await probe(sentinelTeam, 'nangong.vibratoStacksPerRelease', 0, calc => {
      const c = charOf(calc, '1511')
      return {
        stacks: c.nangongMechanicSource?.vibratoStacks,
        mults: [...new Set(calc.damagePoolRows.value
          .filter(x => x.name === '南宫羽·颤音异放').map(x => x.multiplier))],
      }
    }, { lock: 3 })
    if (sentinel.stacks !== 4) failures.push(`v=0（哨兵）应解析为满层 4，实到 ${sentinel.stacks}`)
    // 哨兵 ⟺ 满层：v=0 的倍率必须与 v=4（C6 锚点）一致
    const v4 = await probe(sentinelTeam, 'nangong.vibratoStacksPerRelease', 4, calc => [
      ...new Set(calc.damagePoolRows.value.filter(x => x.name === '南宫羽·颤音异放').map(x => x.multiplier)),
    ], { lock: 3 })
    if (JSON.stringify(sentinel.mults) !== JSON.stringify(v4)) {
      failures.push(`哨兵语义：v=0 的倍率 ${JSON.stringify(sentinel.mults)} 应与 v=4 的 ${JSON.stringify(v4)} 相同（都 = 满层 4）`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `sigrid.cinema4Coverage`：`sigrid.ts:147` 的 `clamp01(settingOf(settings,'sigrid.cinema4Coverage',1))`
   * —— 位于 **`applySigridPanel`**（`:131-150`），走 **`applyPanel` 钩子 / `AgentPanelInput.settings`
   * 通道**（不是 `cfg['setting:…']`）→ `panel.dmgBonus += 18 · cov`（`SIGRID_C4_DMG = 18`）。
   *
   * ⚠ 这条**只能经 ⑨panel 面观测**：`panels` 数组按位置压缩且带 `slot` 戳 ⇒
   * 一律 `panels.find(p => p.slot === 0)`，**禁** `panels[0]`（头注释坑 3，判据 17 会红）。
   *
   * 强断言：Δ（相对 v=0 基线）`=== 18·v` —— 用差分而不是绝对值，这样无需硬编队友 buff 给的基础值。
   * ⚠ **C4 以下该滑块是合法 no-op**（三次同值）——不是断链，本测试不测 C0。
   * ⚠ 别把 `dmgBonus` 的 +18 直接当成「伤害 +18%」：它只是多个加算区之一（实测总伤约 +13.8%）。
   */
  it('sigrid.cinema4Coverage：Δpanel.dmgBonus === 18·v（三点 0 / 0.5 / 1，C4+，panels.find 按 slot）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1591', ...RICH }, ...mates(['1371', '1431'])]
    const readBonus = (v: number) => probe(team, 'sigrid.cinema4Coverage', v, calc =>
      calc.panels.value.find(p => p.slot === 0)?.dmgBonus)
    const base = await readBonus(0)
    const failures: string[] = []
    if (base === undefined) failures.push('slot 0 面板不可得（panels 按位置压缩 ⇒ 必须 find(slot===0)）')
    for (const [v, expectedDelta] of [[0.5, 9], [1, 18]] as Array<[number, number]>) {
      const got = await readBonus(v)
      if (got === undefined) { failures.push(`v=${v}: 面板不可得`); continue }
      const delta = got - (base ?? 0)
      if (Math.abs(delta - expectedDelta) > 1e-9) {
        failures.push(`v=${v}: ΔdmgBonus 应为 18×${v}=${expectedDelta}，实到 ${delta}（v=0 基线 ${base} → ${got}）`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)
})

describe('模块自读 MechanicSetting（Form-B/C/D）生效：叶瞬光 / 仪玄（★ 轴模式陷阱）', () => {
  /**
   * ★★ **本组三条全部踩同一个坑：`useStunAxis = false` 不足以关掉轴。**
   *
   * `axisActive = (configStore.useStunAxis || autoActive) && resolvedAxes.length > 0`，
   * 而 `autoActive = selectAutoStunAxisPreset(team)` 按**槽位通配**匹配
   * `src/data/stunAxisPresets/*.json`。表里有通配预设
   * **`仪其他.json` = `['1371','*','*']`** ⇒ **只要槽 0 是仪玄，绝大多数队伍都会自动进轴**。
   *
   * 后果分两种（R50 侦察实测）：
   * · `yixuan.ts:612` 在 `axisActive` 时把 `stunExCoverage` **强制 0**（滑块被轴吃掉）；
   * · 轴模式还会改写资源账本 ⇒ `yeshuguang.zhaoyingCount` / `yixuan.c6GiftUltCount` 的读数变味。
   *
   * ⇒ **正解 = 换到无预设命中的队伍**，且仪玄放**队友位**。本文件固定用
   * **`['1611','1371','1481']`**（仪玄在槽 1，实测 `autoPreset = null`、`yixuanAxisActive` 为假）。
   *
   * ⚠⚠ 另一条**实测证实会适得其反**的路：**不要**用 `config.autoYidhariAxis = false` 去"关自动轴"。
   * 对仪玄主 C 的队伍它会把**轴外墨烬影消行也一并弄没**（实测 `['1371','1431','1481']` +
   * `autoYidhariAxis=false` ⇒ `1371026` 行**不存在** ⇒ 观测点彻底消失，无任何可比）。
   * ⚠ 也不是所有队友位都行：`['1431','1371','1481']` 同为队友位却**没有** `1371026` 行
   * （与叶瞬光进队有关）⇒ 请**固定**用 `['1611','1371','1481']` 或 `['1591','1371','1431']`。
   */
  const NO_AXIS_TEAM: HarnessTeamSlot[] = [
    { agentId: '1611', cinemaLevel: 6, chainCountPerStun: 2 },
    { agentId: '1371', ...RICH },
    { agentId: '1481', cinemaLevel: 6, chainCountPerStun: 2 },
  ]

  /**
   * `yixuan.stunExCoverage`：声明 `yixuan.ts:964`；读 `:612`
   * （`axisActive ? 0 : cfgNum(cfg,'yixuan.stunExCoverage',0)`）→ `:675`
   *   `outAshenBonus = round(30·stunExCov) + c4Bonus`，写进**轴外**墨烬影消行 `dmgBonus`。
   *
   * 强断言：`dmgBonus === 基线 + round(30·v)`，基线 = v=0 那次读到的值（本夹具实测 90 =
   * 核心被动 60 + 额外能力 30×0）——**用差分**，这样不硬编 60、也不受 C4 静心项影响
   * （`c4Bonus` 与 v 无关，是同一行的常数偏置）。
   *
   * 实测：v=0 ⇒ 90；v=0.25 ⇒ 98；v=0.5 ⇒ 105；v=1 ⇒ 120（差值 0 / 8 / 15 / 30 = `round(30v)`）。
   *
   * ⚠ 断言的锚点必须**同时**校验前提：`yixuanAxisActive` 为假（否则滑块被轴强制 0，
   * 三点恒 90 —— 那会表现为"滑块坏了"，实为夹具错）。
   */
  it('yixuan.stunExCoverage：ΔdmgBonus(1371026) === round(30·v)（三点 0 / 0.25 / 1；无轴队）', async () => {
    const failures: string[] = []
    const readBonus = (v: number) => probe(NO_AXIS_TEAM, 'yixuan.stunExCoverage', v, calc => {
      const c = charOf(calc, '1371')
      const row = c.executions.find(e => e.moveId === '1371026')
      return {
        axisActive: (c as unknown as Record<string, unknown>).yixuanAxisActive,
        count: row?.count, dmgBonus: row?.dmgBonus, auto: calc.autoActive.value,
      }
    }, { lock: 3 })

    const base = await readBonus(0)
    if (base.axisActive === true) {
      failures.push('夹具失效 —— yixuanAxisActive 为真（命中 axis preset？）⇒ 滑块被强制 0，本条退化成三点恒值')
    }
    if (base.auto === true) failures.push(`夹具失效 —— autoActive 为真（matchedPlan=${'仪其他?'}）⇒ 请换无预设命中的队伍`)
    if (base.dmgBonus === undefined) {
      failures.push('v=0: 轴外墨烬影消行 1371026 不存在 ⇒ 本条无观测点（请固定用 [\'1611\',\'1371\',\'1481\']）')
    }
    for (const v of [0.25, 0.5, 1]) {
      const r = await readBonus(v)
      if (r.dmgBonus === undefined) { failures.push(`v=${v}: 轴外墨烬影消行不存在`); continue }
      const expected = (base.dmgBonus ?? 0) + Math.round(30 * v)
      if (r.dmgBonus !== expected) {
        failures.push(`v=${v}: dmgBonus 应为 基线(${base.dmgBonus}) + round(30×${v})=${expected}，实到 ${r.dmgBonus}`)
      }
      // 同一行还应在（行存在性也是"轴外分支活着"的证据）
      if (r.count !== base.count) {
        failures.push(`v=${v}: 行 count 从 ${base.count} 变到 ${r.count} ⇒ 覆盖率不该改次数（只改 dmgBonus）`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `yixuan.c6GiftUltCount`：声明 `yixuan.ts:984`；读 `:627`
   * （`Math.floor(cfgNum(cfg,'yixuan.c6GiftUltCount',-1))`）→ `:629-631`：
   *   `giftUlts = C6 ? max(0, min(v>=0 ? v : ultCount, giftCap)) : 0`、
   *   `giftCap = floor(battleTime/30)`（`C6_GIFT_INTERVAL = 30`）、
   *   `xuanmo = shufaUlts + giftUlts`。
   *
   * 观测点 = `specResources['yixuan_xuanmo_value'].total`（最干净）。闭式用**差分**：
   * `xuanmo(v) === xuanmo(0) + min(v, giftCap)` —— `xuanmo(0)` 是术法值驱动的符法千重次数
   * （随夹具变，实测 7），**不硬编**。
   *
   * ⚠ **v = −1 是 AUTO（= 大招次数）**，与 v=0 不同（实测 11 vs 7）——别把 −1 当 0。
   * ⚠ `giftCap` 随 `battleTime` 变（180s ⇒ 6；90s ⇒ 3，实测 xuanmo 5/7/8 对 0/2/99）⇒
   * 第二锚点必须把 `enemy.battleTime` 一起改，否则只是重复第一锚点。
   */
  it('yixuan.c6GiftUltCount：Δxuanmo === min(v, floor(battleTime/30))（主锚 0/2/6 + battleTime=90 次锚）', async () => {
    const failures: string[] = []
    const readXuanmo = (v: number, battleTime: number) => probe(NO_AXIS_TEAM, 'yixuan.c6GiftUltCount', v, calc =>
      charOf(calc, '1371').specResources?.yixuan_xuanmo_value?.total as number | undefined,
      { lock: 3, battleTime })

    // 主锚点：battleTime = 180 ⇒ giftCap = 6
    const base180 = await readXuanmo(0, 180)
    if (base180 === undefined) failures.push('battleTime=180: 玄墨值资源不可得')
    for (const v of [2, 6]) {
      const got = await readXuanmo(v, 180)
      if (got === undefined) { failures.push(`v=${v}: 玄墨值不可得`); continue }
      const expected = (base180 ?? 0) + Math.min(v, 6)
      if (got !== expected) {
        failures.push(`bt=180 v=${v}: xuanmo 应为 基线(${base180}) + min(${v}, cap 6)=${expected}，实到 ${got}`)
      }
    }
    // 饱和：v=99 必须与 v=6 相同（cap 恰好 6），否则 cap 的口径不是 floor(180/30)
    const sat180 = await readXuanmo(99, 180)
    const at6 = await readXuanmo(6, 180)
    if (sat180 !== undefined && at6 !== undefined && sat180 !== at6) {
      failures.push(`bt=180: v=99 应被夹到与 v=6 同值（cap=floor(180/30)=6），实到 ${sat180} vs ${at6}`)
    }
    // 第二锚点：battleTime = 90 ⇒ giftCap = 3 —— 防"cap 被硬编成 6"
    const base90 = await readXuanmo(0, 90)
    const sat90 = await readXuanmo(99, 90)
    if (base90 === undefined || sat90 === undefined) {
      failures.push('battleTime=90: 玄墨值不可得')
    } else if (sat90 - base90 !== 3) {
      failures.push(`bt=90: cap 应为 floor(90/30)=3（xuanmo 从 ${base90} 到 ${sat90}），实到 ${sat90 - base90} ⇒ 触顶口径不对或夹具漂移`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  /**
   * `yeshuguang.zhaoyingCount`：声明 `yeshuguang.ts:690`；读 `:371`
   * （`cfgNum(cfg,'yeshuguang.zhaoyingCount',-1)`）→ `resolveCycle`（`:365`）
   * → `computeYeshuguangCycle`（`:203`）`:219`：
   *   `zhaoyingForms = max(0, v>=0 ? min(v, autoZhao) : autoZhao)`、`autoZhao = outsideSword/6`。
   *
   * ⚠ **2026-09-20 终局整数化后口径变了**（`@fact agent:1431/终局整数化`，用户口径「余数剑势本来就
   * 该留着不打」）：照影是「攒满 6 点剑势 ⇒ 变身一次」的**离散触发**，迭代期保持实数（防正反馈环），
   * **终局**由引擎置 `yeshuguangFinalizeForms` 后 floor 一次 ⇒ **本探针读到的（终局产物）是整数**：
   *   `autoZhao = floor(outsideSword/6)`。探针读 `specResources`（终局物化结果）⇒ 闭式按整数商解。
   * （迭代期实数语义由 `yeshuguang.test.ts#轮数实数化` 直接钉 `computeYeshuguangCycle`（不带
   * `finalizeForms`）⇒ 那里逐位保留旧语义，两条用例分工不重叠。）
   *
   * 观测点 = `specResources['yeshuguang_mingxin'].gains['zhaoying']`（另 `guanzhi.total`、
   * `sword_momentum.remaining` 同步变）。闭式三条（全部用**同一份读数**里的量解）：
   *   ① `zhaoying === Math.min(v, floor(autoZhao))`；
   *   ② `guanzhi === totalForms·guanzhiPerForm`（`BASE_GUANZHI = 2` + C2 追加 `FORM_SWORD = 6`）；
   *   ③ `remaining === outsideSword − 6·zhaoying`（`ZHAOYING_COST = 6`）。
   *
   * ⚠★ **三点必须落在 `autoZhao` 之内**。`autoZhao` **很小**（本任实测此队 2.33），
   * 取 `-1 / 9.5 / 20` 会**三点全部饱和**成同一个值 —— 这正是 R50 侦察第一版三点不动的**唯一根因**
   * （修正版已推翻初版"轴模式"归因：与轴无关，同队同配置只换采样点即得 0/1/2 线性）。
   * ⇒ 本测试固定取 **v = 0 / 1 / 2**，并**显式断言三点互不相同**把这个退化模式钉成红。
   */
  it('yeshuguang.zhaoyingCount：zhaoying === min(v, floor(autoZhao)) 且 guanzhi/remaining 同步（两点 0 / 1，终局整数化）', async () => {
    const team: HarnessTeamSlot[] = [
      { agentId: '1431', ...RICH },
      { agentId: '1371', cinemaLevel: 6, chainCountPerStun: 2 },
      { agentId: '1481', cinemaLevel: 6, chainCountPerStun: 2 },
    ]
    const failures: string[] = []
    const readings: number[] = []
    /**
     * 采样点：终局整数化后本队 `autoZhao = floor(1.877) = 1` ⇒ `min(v,1)` 在 v=1 与 v=2 上饱和成
     * 同一个值（旧实数口径 `min(2,1.877)=1.877 ≠ min(1,1.877)=1`，故旧点位有效）。
     * 点位改为 **v = 0 / 1**（都在 autoZhao 之内且互不相同）。
     */
    for (const v of [0, 1]) {
      const r = await probe(team, 'yeshuguang.zhaoyingCount', v, calc => {
        const c = charOf(calc, '1431')
        const sr = c.specResources as Record<string, {
          total?: number, remaining?: number, gains?: Record<string, number>
        }> | undefined
        return {
          zhaoying: sr?.yeshuguang_mingxin?.gains?.zhaoying,
          totalForms: sr?.yeshuguang_mingxin?.total,
          guanzhi: sr?.yeshuguang_guanzhi?.total,
          remain: sr?.yeshuguang_sword_momentum?.remaining,
          outside: sr?.yeshuguang_sword_momentum?.total,
          axis: (c as unknown as Record<string, unknown>).yeshuguangCycle,
        }
      })
      if (r.zhaoying === undefined) { failures.push(`v=${v}: mingxin.zhaoying 不可得（spec key 改名？）`); continue }
      readings.push(r.zhaoying)
      // autoZhao = floor(outsideSword/6)（**终局整数化**，见本条头注释）；用它解闭式
      const autoZhao = Math.floor((r.outside ?? 0) / 6)
      const expected = Math.min(v, autoZhao)
      if (Math.abs(r.zhaoying - expected) > 1e-9) {
        failures.push(`v=${v}: zhaoying 应为 min(${v}, autoZhao=${autoZhao})=${expected}，实到 ${r.zhaoying}`)
      }
      // 观止：totalForms × guanzhiPerForm（C2+ ⇒ 2+6=8/轮）
      const forms = r.totalForms ?? 0
      const expectedGuanzhi = forms * 8
      if (Math.abs((r.guanzhi ?? -1) - expectedGuanzhi) > 1e-6) {
        failures.push(`v=${v}: guanzhi 应为 totalForms(${forms})×8=${expectedGuanzhi}，实到 ${r.guanzhi}`)
      }
      // 剩余剑势 = outsideSword − 6·zhaoying（ZHAOYING_COST = 6）
      const expectedRemain = Math.max(0, (r.outside ?? 0) - 6 * r.zhaoying)
      if (Math.abs((r.remain ?? -1) - expectedRemain) > 1e-6) {
        failures.push(`v=${v}: remaining 应为 outsideSword(${r.outside}) − 6×${r.zhaoying}=${expectedRemain}，实到 ${r.remain}`)
      }
    }
    // ★ 防退化（本条的核心教训）：采样点必须互不相同，否则就是"全落进饱和支"
    if (readings.length >= 2 && new Set(readings).size !== readings.length) {
      failures.push(`采样点 zhaoying 出现重复（${JSON.stringify(readings)}）⇒ 全部饱和在 min(v, autoZhao) 的同一支；`
        + '请把点位下移到 autoZhao 之内（R50 侦察第一版就栽在这，与轴无关）')
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)
})
