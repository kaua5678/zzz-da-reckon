/**
 * 命破角色「闪能招式回复」通道生效测试（T130，2026-10-11 修）。
 *
 * 修的是什么：命破角色的**招式回能**在 catalog 里长在 `flash_energy_recovery` 行上（全库 5 人、
 * 61 条非零行：1051/1371/1441/1471/1531），而引擎此前只读 `energy_recovery` ⇒ 这 61 条**全部静默归零**。
 * 修法（两处同判据，展示层与记账层同源）：
 *   ① `composables/resourceCalc/helpers.ts#enrichExecutionPlan`：`fusedOf('flash_energy_recovery') || fusedOf('energy_recovery')`
 *   ② 同文件 `energyRecoveryByMoveId` 构造处（记账层 `rowEnergyTotal` 的表）同款 flash 优先、energy 兜底。
 * 另撤除 `mechanics/agents/banyue.ts` 里 1471029（冲霄）行上的 `...ENERGY_RECOVERY_OFF`。
 *
 * **§3.2 考古结论：历史遗留，不是有意禁用**（任务书要求「先查清当初为什么加」；三条独立证据）：
 *   ① 该零块出自**初始提交** `1a1f8c65`（`git log -S "energyRecovery: 0," -- banyue.ts` 首条即它）——
 *      与其余 84 处模块行零块同批样板，不是为冲霄单独裁决出来的；
 *   ② 它的**喧响半边已被撤除**：`5761e024`「喧响债务审计」按「整招独立执行的真债务 0 删掉、交 enrich 回填」
 *      把该行的 `decibelRecovery/totalDecibelRecovery` 两键删了，**只留下能量两键**；
 *   ③ 能量半边之所以没同批撤：当时引擎还没有闪能通道，撤了回填结果也是 0 ⇒ 撤与不撤无信号可辨。
 *   后续 `eb96ff46`（CC-465）只是把残留两键**具名**成 `ENERGY_RECOVERY_OFF`（79 处批量纯命名重构），
 *   未新增语义。⇒ 全仓无「冲霄闪能已由别处计」的记载，按历史遗留处置。
 *   （若哪天真判为有意禁用，本任务应停下上报而不是直接删——任务书 §3.2 的硬要求。）
 *
 * 判据口径（**数据驱动、不是角色判定**）：同一 moveId 绝不同时有两行（本测试① 实测全库 0 例）
 * ⇒ 「有 flash 行就用 flash、否则用 energy」是互斥且完备的取法。
 *
 * ⚠ 为什么**不能**用 `cfg.isFlashUser` 当判据（本文件第② 条断言的防回归靶心）：
 * `isFlashUser = agent.level60.flashEnergyRegen > 0`（`helpers.ts#buildCharConfig`）是「命破」的
 * **代理量**，而真斗 1441 是命破（`flashEnergyMax = 120`、17 条 flash 行）但 `flashEnergyRegen = 0`
 * ⇒ 代理量对他恒为 false。谁把判据改回 `isFlashUser`，第② 条立刻变红（那是本测试存在的首要理由）。
 *
 * 选位理由：本文件放 `src/composables/__tests__/`（而不是 `src/mechanics/__tests__/`）——
 * 被测对象是**编排层**的回填通道（`enrichExecutionPlan` + `energyRecoveryByMoveId` 都在
 * `composables/resourceCalc/`），断言面是 `useResourceCalc().resourceResult` 的**执行行**（展示层）
 * 与 `resourceConfig.characters[].energyRecoveryByMoveId`（记账层）；`mechanics/__tests__/` 放的是
 * 单个角色模块的口径测试（如 `banyue.test.ts`），而本通道是**跨 5 个角色 + 引擎取行语义**的横切面。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { getRowValue } from '@/data/moveTableQueries'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
import type { CharacterOperationConfig, SkillExecution } from '@/types/resource'

/** 命破队标准拐：琉音(击破) + 卢西娅(支援)——与 .zc/perf/T130flashNumbers.perf.ts 同口径 */
const LIUYIN = '1481'
const LUCIA = '1451'

/** 执行行按 moveId 取（执行行匹配一律用 moveId，规则 3） */
const rowsOf = (execs: readonly SkillExecution[] | undefined, moveId: string) =>
  (execs ?? []).filter(e => e.moveId === moveId)

/**
 * 倍率表行值的**独立**读取器：直接从 catalog 的 `move.rows` 取，不经过 `getRowValue`
 * （后者含逻辑编辑器行规则乘数；这两条 flash 行没有登记行规则，两者应逐位相等——
 * 用直读值作期望，才能证明「执行行的回能确实来自 catalog 那一行」而不是同函数自证）。
 */
function catalogRowValues(agentSkills: { categories: { moves: { id: string, rows?: { id: string, values: number[] }[] }[] }[] } | undefined, rowId: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const cat of agentSkills?.categories ?? []) {
    for (const m of cat.moves) {
      const v = m.rows?.find(r => r.id === rowId)?.values[0]
      if (v !== undefined) out[String(m.id)] = v
    }
  }
  return out
}

/** 跑一队，返回 resourceResult / resourceConfig 两本账（cfg 里含记账层用的 energyRecoveryByMoveId 表） */
async function runTeam(team: Array<{ agentId: string }>) {
  const { catalog } = await setupHarness(team, { recommendedBuild: false })
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value!
  const rc = calc.resourceConfig.value!
  return { catalog, rr, rc }
}

describe('命破闪能招式回复通道（flash_energy_recovery）', () => {
  it('① 正向：般岳预设 1471019 扬砾 / 1471029 冲霄 的回能 == catalog flash 行值 × count', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')
    expect(preset, '预设 banyue-liuyin-lucia 缺失').toBeTruthy()
    applyTeamToStore(config, preset!)
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const banyue = rr.characters.find(c => c.agentId === '1471')!
    expect(banyue, '般岳未进结果').toBeTruthy()

    // 期望值来自 catalog 本体（不是测试里手抄的常量）：1471019 扬砾 = 3.735、1471029 冲霄 = 4.668
    const flash = catalogRowValues(catalog.getAgentSkills('1471'), 'flash_energy_recovery')
    expect(flash['1471019'], 'catalog 里 1471019 必须有 flash_energy_recovery 行').toBe(3.735)
    expect(flash['1471029'], 'catalog 里 1471029 必须有 flash_energy_recovery 行').toBe(4.668)

    for (const moveId of ['1471019', '1471029']) {
      const rows = rowsOf(banyue.executions, moveId)
      expect(rows.length, `${moveId} 必须在执行计划里物化`).toBeGreaterThan(0)
      for (const row of rows) {
        // 正数 = 通道接通（修复前这里是 0，61 条 flash 行全部静默归零）
        expect(row.energyRecovery, `${moveId} 回能应等于 catalog flash 行值`).toBe(flash[moveId])
        expect(row.energyRecovery).toBeGreaterThan(0)
        // 展示层的 total 与 per-count 同源（同一次乘算）
        expect(row.totalEnergyRecovery).toBe(row.energyRecovery! * Math.max(0, row.count))
      }
    }
    // 实测锚（报告数字）：扬砾 ×6 → 22.41、冲霄 ×10 → 46.68
    const yangLi = rowsOf(banyue.executions, '1471019')[0]
    expect(yangLi.totalEnergyRecovery).toBeCloseTo(22.41, 9)
    const chongXiao = rowsOf(banyue.executions, '1471029')[0]
    expect(chongXiao.totalEnergyRecovery).toBeCloseTo(46.68, 9)
  }, 120_000)

  it('② 真斗 1441 臂（防回归靶心）：无预设、手组队，有 flash 行的招式回能 > 0 且等于表值', async () => {
    // 真斗没有队伍预设（src/data/teamPresets/ 里 0 条含 1441）⇒ 手组队
    const { catalog, rr, rc } = await runTeam([
      { agentId: '1441' }, { agentId: LIUYIN }, { agentId: LUCIA },
    ])
    const zhendou = rr.characters.find(c => c.agentId === '1441')!
    const cfg = rc.characters.find(c => c.agentId === '1441') as CharacterOperationConfig
    expect(zhendou).toBeTruthy()
    expect(cfg).toBeTruthy()

    // 前提锁：真斗是**命破**（有 flashEnergyMax 与 17 条 flash 行）但 flashEnergyRegen = 0
    // ⇒ `isFlashUser` 代理量对他恒为 false。这条断言本身就是「不许拿代理量当判据」的证据。
    const agent = catalog.getAgent('1441')!
    expect(agent.level60.flashEnergyMax, '真斗是命破（闪能上限 > 0）').toBeGreaterThan(0)
    expect(agent.level60.flashEnergyRegen, '真斗 flashEnergyRegen = 0（代理量对他失效的根因）').toBe(0)
    expect(cfg.isFlashUser, 'isFlashUser = flashEnergyRegen > 0 ⇒ 真斗为 false').toBe(false)

    const flash = catalogRowValues(catalog.getAgentSkills('1441'), 'flash_energy_recovery')
    expect(Object.keys(flash).length, '真斗应有 17 条 flash 行').toBe(17)

    // 真斗的执行计划里真的会出现、且真有 flash 行的招式：1441017（闪避反击·曜刃·掠阵，10 次）
    // 与 1441024（支援突击·孤影·断獠 #1，6 次）。**不选 basic_attack**：平A聚合行是时间通道
    // （秒均 × 平A时间），不是「招式回能」通道，拿它断言会验错对象。
    const hits: string[] = []
    // ⚠ 期望值必须走**融合组求和**：1441024 登记了「连打最大」融合（#1+#2 = 1441024+1441025，
    // moveFusions.ts#ZHENDOU_ASSIST_BREAKING_FANG）⇒ 行值 = 4.688 + 7.863 = 12.551，不是单段 4.688。
    // （本测试首版按单段断言 ⇒ 实测红：expected 4.688 / received 12.551。融合对 flash 行同样生效，
    //   这正是下面「flash 行也吃融合组求和」那条断言要锁的语义，两处必须同源。）
    const expected = (moveId: string) => moveId === '1441024' ? flash['1441024'] + flash['1441025'] : flash[moveId]
    for (const moveId of ['1441017', '1441024']) {
      const rows = rowsOf(zhendou.executions, moveId)
      expect(rows.length, `${moveId} 必须在真斗执行计划里物化（否则本断言恒真）`).toBeGreaterThan(0)
      expect(flash[moveId], `${moveId} 必须有 flash 行`).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.energyRecovery, `${moveId} 回能应等于 catalog flash 行值（融合组求和）`).toBe(expected(moveId))
        expect(row.energyRecovery).toBeGreaterThan(0)
        expect(row.totalEnergyRecovery).toBe(row.energyRecovery! * Math.max(0, row.count))
      }
      hits.push(moveId)
    }
    expect(hits).toEqual(['1441017', '1441024'])

    // 记账层同判据（`energyRecoveryByMoveId` 表）：若有人把 helpers.ts 的判据改回 `cfg.isFlashUser`，
    // 展示层与这张表会一起归零 ⇒ 上面两条 expect 先红；这条是第二道锁（表本身也必须是 flash 值）。
    const table = cfg.energyRecoveryByMoveId ?? {}
    expect(table['1441017']).toBe(flash['1441017'])
    // 1441024 走融合组求和（见上 expected()），**不是**单段 flash['1441024']=4.688
    expect(table['1441024']).toBe(flash['1441024'] + flash['1441025'])
    expect(table['1441017']).toBeGreaterThan(0)

    // 融合组交叉验证：1441024 登记了「连打最大」融合（#1 + #2 = 1441024 + 1441025，moveFusions.ts）
    // ⇒ 行值 = 4.688 + 7.863 = 12.551（表值求和，不是单段值）。这条同时锁住「flash 行也吃融合组求和」。
    expect(table['1441024']).toBeCloseTo(4.688 + 7.863, 9)
    expect(getRowValue(catalog.getAgentSkills('1441')!.categories.flatMap(c => c.moves).find(m => String(m.id) === '1441024'), 'flash_energy_recovery'))
      .toBe(flash['1441024'])
  }, 120_000)

  it('③ 反向验证：删掉 helpers.ts 的 flash 分支 ⇒ 本条变红（红/绿两态都能跑同一断言）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'banyue-liuyin-lucia')!)
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const banyue = rr.characters.find(c => c.agentId === '1471')!
    const flash = catalogRowValues(catalog.getAgentSkills('1471'), 'flash_energy_recovery')
    const row = rowsOf(banyue.executions, '1471019')[0]
    expect(row, '1471019 必须在执行计划里').toBeTruthy()
    // 修复前：只读 energy_recovery ⇒ 行值为 0（这就是「红」的样子）
    expect(row.energyRecovery, '1471019 回能必须来自 flash_energy_recovery 行').toBe(flash['1471019'])
    expect(row.energyRecovery).toBeGreaterThan(0)
  }, 120_000)

  it('④ 零 delta 臂：非命破角色的回能仍逐位等于 energy_recovery 表值（未被 flash 逻辑污染）', async () => {
    const { catalog, rr } = await runTeam([
      { agentId: '1471' }, { agentId: LIUYIN }, { agentId: LUCIA },
    ])
    // 两位非命破：琉音 1481（只有 energy_recovery 行）、卢西娅 1451（同）
    for (const [agentId, moveId, expected] of [['1481', '1481009', 2.881], ['1481', '1481015', 3.959], ['1451', '1451005', 7.35]] as const) {
      const ch = rr.characters.find(c => c.agentId === agentId)!
      const skills = catalog.getAgentSkills(agentId)!
      expect(catalogRowValues(skills, 'flash_energy_recovery')[moveId], `${agentId} 不该有 flash 行`).toBeUndefined()
      const energy = catalogRowValues(skills, 'energy_recovery')
      expect(energy[moveId], `${agentId} ${moveId} 的 energy_recovery 表值`).toBe(expected)
      const rows = rowsOf(ch.executions, moveId)
      expect(rows.length, `${agentId} ${moveId} 必须在执行计划里物化`).toBeGreaterThan(0)
      for (const row of rows) {
        // 逐位不变：修复只可能给「有 flash 行」的 moveId 换通道，非命破角色没有 flash 行 ⇒ 读数不动
        expect(row.energyRecovery, `${agentId} ${moveId} 回能应逐位等于 energy_recovery 表值`).toBe(energy[moveId])
        expect(row.totalEnergyRecovery).toBe(row.energyRecovery! * Math.max(0, row.count))
      }
    }
  }, 120_000)

  it('⑤ 通道互斥前提（数据驱动判据的底座）：全库同一 moveId 绝不同时有两行，且 flash 只在 5 个命破角色上', async () => {
    // 这条前提若被将来的数据导入破坏，「flash 优先 / energy 兜底」就会变成**静默丢弃**一条通道，
    // 而 `||` 的语义（flash 为 0 时落回 energy）也会同时把「flash 行显式为 0」误判成「没有 flash 行」。
    const { catalog } = await setupHarness([{ agentId: '1471' }], { recommendedBuild: false })
    let both = 0
    let flashOnly = 0
    const agentsWithFlash = new Set<string>()
    for (const skills of catalog.agentSkillsByAgentMap.values()) {
      for (const cat of skills.categories) {
        for (const m of cat.moves) {
          const hasFlash = (m.rows ?? []).some(r => r.id === 'flash_energy_recovery')
          const hasEnergy = (m.rows ?? []).some(r => r.id === 'energy_recovery')
          if (hasFlash && hasEnergy) both++
          else if (hasFlash) { flashOnly++; agentsWithFlash.add(String(skills.agentId)) }
        }
      }
    }
    expect(both, '同一 moveId 同时有 flash 与 energy 行 ⇒ 通道不再互斥').toBe(0)
    expect(flashOnly).toBe(61)
    expect([...agentsWithFlash].sort()).toEqual(['1051', '1371', '1441', '1471', '1531'])
  }, 120_000)
})

/** 合轴吸收比口径（探针同源）：本测试的读数不依赖它，但显式钉住避免将来预设改动时误判 */
void COMBO_ALIGN_ABSORB_RATIO_SETTING
