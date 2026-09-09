/**
 * 倍率融合（src/data/moveFusions.ts + resourceCalc/helpers.ts fusedRowValue）护栏。
 *
 * 口径（用户 2026-09）：nanoka 原文 param.desc 用 `{Skill:A}+{Skill:B}*n` 编码
 * 「哪些段属于同一次动作」。同一招式名下多个 param = 多个独立动作，不能混加。
 * 星见雅强化特殊技·飞雪：斩击(#1+#2)=第一次 E，追击(#3+#4)=第二次 E（再耗 40 能量，通常不打）。
 *
 * 本文件同时锁「一次动作」在**倍率通道**（fusedRowValue / enrichExecutionPlan 回填）与
 * **时间通道**（findChainAttack → cfg.chainActionTime，结果页「单次 x.xx s」）两侧口径一致：
 * 只融一侧会让伤害按整段算、时间按头段算（2026-09-11 连携技显示 0.515s 即此错配）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { teamPresets } from '@/data/teamPresets'
import { fusedRowValue, getRowValue, findMoveById } from '@/composables/resourceCalc/helpers'
import { findChainAttack, findUltimate } from '@/core/resource'
import { moveFusionByMoveId, MOVE_FUSION_GROUPS } from '@/data/moveFusions'

describe('倍率融合：fusedRowValue（单一事实源 moveFusions）', () => {
  it('星见雅·斩击 = 飞雪#1 + 飞雪#2 = 788.3%（第一次 E）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1091' }])
    const skills = catalog.getAgentSkills('1091')
    expect(fusedRowValue(skills, '1091009', 'damage')).toBeCloseTo(315.8 + 472.5, 6)
    // 未登记融合的段仍走单段值
    expect(getRowValue(findMoveById(skills, '1091009'), 'damage')).toBeCloseTo(315.8, 6)
  })

  it('星见雅·追击 = 飞雪#3 + 飞雪#4 = 967.2%（第二次 E，独立动作）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1091' }])
    const skills = catalog.getAgentSkills('1091')
    expect(fusedRowValue(skills, '1091011', 'damage')).toBeCloseTo(386.9 + 580.3, 6)
    // 斩击(#1+#2)与追击(#3+#4)是两个组，不能混加
    expect(fusedRowValue(skills, '1091009', 'damage')).not.toBeCloseTo(315.8 + 472.5 + 386.9 + 580.3, 6)
  })

  it('星见雅·连携技春临 = #1+#2+#3 = 1258.3%（一次连携全打）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1091' }])
    const skills = catalog.getAgentSkills('1091')
    expect(fusedRowValue(skills, '1091015', 'damage')).toBeCloseTo(377.6 + 377.6 + 503.1, 6)
  })

  it('加权融合：希希芙·毒牙 = #1×3 + #2', async () => {
    const { catalog } = await setupHarness([{ agentId: '1521' }])
    const skills = catalog.getAgentSkills('1521')
    const g = moveFusionByMoveId.get('1521008')!
    expect(g.terms).toEqual([
      { moveId: '1521008', count: 3 },
      { moveId: '1521009', count: 1 },
    ])
    const expected = getRowValue(findMoveById(skills, '1521008'), 'damage') * 3
      + getRowValue(findMoveById(skills, '1521009'), 'damage')
    expect(fusedRowValue(skills, '1521008', 'damage')).toBeCloseTo(expected, 6)
  })

  it('珂蕾妲·沸腾熔炉 = 打击(#1) + 引爆(#2)', async () => {
    const { catalog } = await setupHarness([{ agentId: '1101' }])
    const skills = catalog.getAgentSkills('1101')
    expect(fusedRowValue(skills, '1101104', 'damage')).toBeCloseTo(305.2 + 1212.1, 6)
  })

  it('月城柳·月华流转 = 突刺(#1) + 下砸(#2)', async () => {
    const { catalog } = await setupHarness([{ agentId: '1221' }])
    const skills = catalog.getAgentSkills('1221')
    expect(fusedRowValue(skills, '1221022', 'damage')).toBeCloseTo(327.7 + 756.2, 6)
  })

  it('简·萨霍夫跳 = 连续攻击(#1+#2) + 终结一击(#3)', async () => {
    const { catalog } = await setupHarness([{ agentId: '1261' }])
    const skills = catalog.getAgentSkills('1261')
    expect(fusedRowValue(skills, '1261007', 'damage')).toBeCloseTo(602.2 + 965 + 323, 6)
  })

  it('照·兔兔连斩 = #1 + #2 = 4375.2%，整段 1.8336s（秽盾 500 加成拆成 400+100）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1341' }])
    const skills = catalog.getAgentSkills('1341')
    expect(fusedRowValue(skills, '1341014', 'damage')).toBeCloseTo(3499.9 + 875.3, 6)
    // 时长侧：catalog 原为 #1 0.467（减满 500）/ #2 null（减满 500 得负数）；
    // 用户口径 2026-09-11「第一行 −400、第二行 −100，奖励分成两半，用秒均积蓄=100 来算」
    // → 1.4666 + 0.367 = 1.8336s（定点修正走 scripts/patch-move-action-time.mjs）
    expect(findUltimate(skills as never)?.actionTime).toBeCloseTo(1.4666 + 0.367, 4)
  })

  it('真斗·孤影·断獠（连打最大） = #1 + #2 = 1141.0%', async () => {
    const { catalog } = await setupHarness([{ agentId: '1441' }])
    const skills = catalog.getAgentSkills('1441')
    expect(fusedRowValue(skills, '1441024', 'damage')).toBeCloseTo(333.9 + 807.1, 6)
  })

  it('千夏·泡泡糖轰炸 = #1 + #2 = 1827.4%（完整强特）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1491' }])
    const skills = catalog.getAgentSkills('1491')
    expect(fusedRowValue(skills, '1491007', 'damage')).toBeCloseTo(1588.3 + 239.1, 6)
  })

  it('千夏·特别拍照技巧（协同） = #1 + #2——仅登记口径（引擎不选 0 能耗强特）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1491' }])
    const skills = catalog.getAgentSkills('1491')
    expect(fusedRowValue(skills, '1491008', 'damage')).toBeCloseTo(1656.4 + 248.6, 6)
  })

})

describe('倍率融合：真引擎回填（enrichExecutionPlan）', () => {
  it('部署星见雅后，飞雪执行行倍率 = 斩击 788.3%、春临 = 1258.3%', async () => {
    await setupHarness([{ agentId: '1091' }, { agentId: '1031' }, { agentId: '1131' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1091')?.executions ?? []
    const ex = exs.find(e => e.moveId === '1091009')
    const chain = exs.find(e => e.moveId === '1091015')
    expect(ex).toBeTruthy()
    expect(ex?.damageMultiplier).toBeCloseTo(788.3, 3)
    expect(ex?.dazeMultiplier).toBeCloseTo(
      getRowValue(findMoveById(useCatalogStore().getAgentSkills('1091'), '1091009'), 'daze')
      + getRowValue(findMoveById(useCatalogStore().getAgentSkills('1091'), '1091010'), 'daze'),
      3,
    )
    expect(chain?.damageMultiplier).toBeCloseTo(1258.3, 3)
  })

  it('部署照后，终结技执行行倍率 = 兔兔连斩 4375.2%', async () => {
    await setupHarness([{ agentId: '1341' }, { agentId: '1091' }, { agentId: '1031' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1341')?.executions ?? []
    const ex = exs.find(e => e.moveId === '1341014')
    expect(ex).toBeTruthy()
    expect(ex?.damageMultiplier).toBeCloseTo(4375.2, 3)
    // 引擎只物化主段：#2 不再单独成行，避免双计
    expect(exs.some(e => e.moveId === '1341023')).toBe(false)
  })
})

describe('倍率融合：时间通道（连携技「单次时长」）', () => {
  /**
   * 症状（用户 2026-09-11 报）：结果页「连携技…单次 0.515s」——比全队连携基线（1.2~3.5s，
   * 队友莱卡恩 2.084）小一个量级。根因与倍率侧同源：catalog 把一次连携拆成 #1/#2/#3，
   * `findChainAttack` 只回头段 → 倍率走融合、时间没走。本组锁两侧「一次动作」口径一致。
   */
  const MIYABI_CHAIN_TIME = 0.515 + 0.515 + 0.687 // 春临 #1+#2+#3 = 1.717s

  it('findChainAttack(1091) 时长 = 春临三段之和（与伤害融合同口径）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1091' }])
    const info = findChainAttack(catalog.getAgentSkills('1091') as never)
    expect(info).toBeTruthy()
    // 主段仍是 #1：伤害/合轴/轴块按 moveId 匹配，不许换成尾段
    expect(info!.moveId).toBe('1091015')
    expect(info!.actionTime).toBeCloseTo(MIYABI_CHAIN_TIME, 6)
  })

  it('引擎执行行：星见雅连携技单次 = 1.717s、总时长 = 次数 × 1.717', async () => {
    await setupHarness([{ agentId: '1091' }, { agentId: '1141' }, { agentId: '1151' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1091')?.executions ?? []
    const chain = exs.find(e => e.moveId === '1091015')
    expect(chain).toBeTruthy()
    expect(chain!.actionTime).toBeCloseTo(MIYABI_CHAIN_TIME, 6)
    expect(chain!.totalTime).toBeCloseTo(chain!.count * MIYABI_CHAIN_TIME, 6)
    // 兄弟段不另起执行行（融在主段上，时间不许双计）
    expect(exs.some(e => e.moveId === '1091016' || e.moveId === '1091017')).toBe(false)
  })

  it('未登记融合组的连携不受影响（单段仍取自身时长）', async () => {
    await setupHarness([{ agentId: '1091' }, { agentId: '1141' }, { agentId: '1151' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1141')?.executions ?? []
    expect(exs.find(e => e.moveId === '1141020')?.actionTime).toBeCloseTo(2.084, 6)
  })
})

describe('倍率融合：全通道「一次动作」口径（用户裁决 2026-09-11）', () => {
  /**
   * 用户口径原话：「倍率表必须融合，因为连携本身就是打3段…游戏内一个连携就把三行倍率全打了」
   * 「时间不是以招式为单元的吗，怎么会如此偷懒」→ 时间/喧响与倍率必须同一口径；
   * 「只有炮击算时间，能力场是自动攻击，不算时间」→ 自动攻击段 countsTime:false（打伤害不站场）。
   */
  it('强特时间：雅·飞雪斩击行 0.387 → 0.967s（#1+#2 一次动作），耗能仍只计一次 40', async () => {
    await setupHarness([{ agentId: '1091' }, { agentId: '1141' }, { agentId: '1151' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1091')?.executions ?? []
    const ex = exs.find(e => e.moveId === '1091009')
    expect(ex).toBeTruthy()
    expect(ex!.actionTime).toBeCloseTo(0.387 + 0.58, 6)
    expect(ex!.energyConsume).toBe(40) // 耗能是前缀项，一次动作只计一次
  })

  it('连携喧响：雅·春临行 69.05 → 230.1475（三段全打，喧响照算）', async () => {
    await setupHarness([{ agentId: '1091' }, { agentId: '1141' }, { agentId: '1151' }])
    const { resourceResult } = useResourceCalc()
    const chain = resourceResult.value?.characters.find(c => c.agentId === '1091')?.executions
      .find(e => e.moveId === '1091015')
    expect(chain!.decibelRecovery).toBeCloseTo(69.0525 + 69.0525 + 92.0425, 4)
    expect(chain!.totalDecibelRecovery).toBeCloseTo(chain!.count * 230.1475, 2)
  })

  it('妮可·连携/终结：倍率与喧响融三段，时间只算炮击段（能量场=自动攻击）', async () => {
    await setupHarness([{ agentId: '1031' }, { agentId: '1141' }, { agentId: '1151' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1031')?.executions ?? []
    const chain = exs.find(e => e.moveId === '1031301')
    const ult = exs.find(e => e.moveId === '1031304')
    expect(chain).toBeTruthy()
    expect(ult).toBeTruthy()
    // 炮击 #1(0.25)+#2(0.25) 占前台；能量场 #3(0.75) 不占
    expect(chain!.actionTime).toBeCloseTo(0.25 + 0.25, 6)
    expect(ult!.actionTime).toBeCloseTo(0.36, 6)
    // 倍率/喧响三段（连携）/两段（终结）全算
    expect(chain!.damageMultiplier).toBeCloseTo(210.4 + 210.4 + 566.8, 3)
    expect(chain!.decibelRecovery).toBeCloseTo(43.45 + 43.45 + 130.35, 4)
    expect(ult!.damageMultiplier).toBeCloseTo(1293.6 + 1746.6, 3)
    // 兄弟段不另起行（融合在主段，时间/倍率都不双计）
    expect(exs.some(e => ['1031302', '1031303', '1031305'].includes(String(e.moveId)))).toBe(false)
  })

  it('妮可·强特能量场行：actionTime 记 0（不站场），倍率照算（sustainedEx countsTime）', async () => {
    await setupHarness([{ agentId: '1031' }, { agentId: '1141' }, { agentId: '1151' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1031')?.executions ?? []
    const field = exs.find(e => e.moveId === '1031106')
    const bombard = exs.find(e => e.moveId === '1031104')
    expect(field).toBeTruthy()
    expect(field!.actionTime).toBe(0)
    expect(field!.totalTime).toBe(0)
    expect(field!.damageMultiplier).toBeGreaterThan(0) // 能量场倍率照算
    expect(bombard!.actionTime).toBeCloseTo(0.371, 6) // 炮击段照常占时间
  })

  it('诺姆膛温换连携（回填）= 一次完整连携：雅做目标时赠送行 1258.3% / 1.717s', async () => {
    const { config } = await setupHarness([
      { agentId: '1571', cinemaLevel: 4 },
      { agentId: '1011' },
      { agentId: '1091' }, // 上一位队友（环绕）= slot 2
    ])
    config.enemy.stunCountLock = 4
    const { resourceResult } = useResourceCalc()
    const ally = resourceResult.value!.characters.find(c => c.slot === 2)!
    const gift = ally.executions.find(e => e.normaGiftChain)
    expect(gift).toBeTruthy()
    expect(gift!.moveId).toBe('1091015')
    expect(gift!.damageMultiplier).toBeCloseTo(1258.3, 1)
    expect(gift!.actionTime).toBeCloseTo(1.717, 3)
    expect(gift!.decibelRecovery).toBeCloseTo(230.1475, 2)
  })

  it('双计护栏：登记融合组的兄弟段永不出现在执行计划里', async () => {
    const agents = [...new Set(MOVE_FUSION_GROUPS.map(g => g.agentId))]
    const offenders: string[] = []
    for (const agentId of agents) {
      await setupHarness([{ agentId }])
      const { resourceResult } = useResourceCalc()
      const ids = new Set((resourceResult.value?.characters[0]?.executions ?? []).map(e => String(e.moveId)))
      for (const g of MOVE_FUSION_GROUPS.filter(g => g.agentId === agentId)) {
        const siblings = g.terms.map(t => t.moveId).filter(id => id !== g.moveId && ids.has(id))
        if (siblings.length) offenders.push(`${agentId}/${g.moveId} 兄弟段成行: ${siblings.join(',')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('倍率融合：模块接管段不入表（防双计 · 防后人重登记）', () => {
  /**
   * 判据（moveFusions 头注释同款）：catalog 的段行若**已由角色模块自己发射**，就不能再进融合组——
   * 登记 = 主段把兄弟段加进来 + 兄弟段自己还有一行 = 双计。两条实测：
   * - 莱卡恩 1141：`lycaon.ts` 按点按/长按推 `1141016`（点按 #2）/`1141017`（长按 #3），
   *   长按一次 = #1(505.4%) + #3(1075%) = 1580.4%（= nanoka「蓄力伤害倍率」#1+#3）；
   * - 雨果 1291：`hugo.ts` 明说「倍率表拆为起手 1291009 与终结 1291010；模块补齐终结一击」，
   *   终结段以合成行 `1291_ex_normal_final`(709.8%) / `1291_ex_verdict_final`(3552.7%) 发射。
   * 所以这两族只允许模块口径，**不得**登记融合组。
   */
  it('莱卡恩/雨果 的强特多段由模块发射 → 主段不得登记融合组', async () => {
    await setupHarness([{ agentId: '1141' }, { agentId: '1151' }, { agentId: '1011' }])
    const leoRows = useResourceCalc().resourceResult.value?.characters
      .find(c => c.agentId === '1141')?.executions ?? []
    expect(leoRows.some(e => String(e.moveId) === '1141017')).toBe(true) // 长按段由模块发射
    expect(moveFusionByMoveId.has('1141015')).toBe(false) // 登记即与模块行双计

    await setupHarness([{ agentId: '1291' }, { agentId: '1151' }, { agentId: '1011' }])
    const hugoRows = useResourceCalc().resourceResult.value?.characters
      .find(c => c.agentId === '1291')?.executions ?? []
    expect(hugoRows.some(e => String(e.moveId).startsWith('1291_ex_'))).toBe(true)
    expect(moveFusionByMoveId.has('1291009')).toBe(false)
  })

  it('全预设库：登记组的兄弟段永不作为执行行出现（含模块发射）', async () => {
    const offenders: string[] = []
    const siblingsOf = new Map<string, string[]>()
    for (const g of MOVE_FUSION_GROUPS) {
      siblingsOf.set(g.moveId, g.terms.map(t => t.moveId).filter(id => id !== g.moveId))
    }
    for (const p of teamPresets) {
      if (!Array.isArray(p.team) || p.team.length !== 3) continue
      await setupHarness(p.team.map((id: string) => ({ agentId: id })))
      const chars = useResourceCalc().resourceResult.value?.characters ?? []
      for (const c of chars) {
        const ids = new Set(c.executions.map(e => String(e.moveId)))
        for (const e of c.executions) {
          const sibs = siblingsOf.get(String(e.moveId))
          if (!sibs?.length) continue
          const hits = sibs.filter(id => ids.has(id))
          if (hits.length) offenders.push(`${p.id} ${e.moveId} 兄弟段成行: ${hits.join(',')}`)
        }
      }
    }
    expect(offenders).toEqual([])
  }, 600_000)
})

// 探针：只做诊断，PROBE_FUSION=1 时打印雅队伍飞雪/春临的融合后倍率与总伤害
describe('探针：融合生效后雅队伤害', () => {
  it.runIf(process.env.PROBE_FUSION)('打印融合后倍率', async () => {
    const archive = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as any
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as any
    await setupHarness([{ agentId: '1091' }, { agentId: '1031' }, { agentId: '1131' }])
    const configStore = useConfigStore()
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    const { resourceResult, teamTotalDamage } = useResourceCalc()
    const { submissionToDeploy } = await import('@/composables/runArchiveImport')
    const { applyDeployConfig } = await import('@/composables/runArchiveDeploy')
    const run = archive.runs.find((r: any) => r.team.some((m: any) => m.agentId === '1091') && r.bossKilled)
    const room = archive.rooms[run.targetId]
    applyDeployConfig(configStore, submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart), bossFile.bosses, bossFile.phaseViews ?? [])
    const hp = configStore.enemy.hp ?? 0
    const dmg = teamTotalDamage.value ?? 0
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1091')?.executions ?? []
    console.log('\n融合探针：', run.id, 'boss', room?.bossNameZh, 'HP', Math.round(hp), 'DMG', Math.round(dmg), 'ratio', (dmg / hp * 100).toFixed(1) + '%')
    for (const e of exs) {
      if (['1091009', '1091015'].includes(e.moveId)) console.log('  ', e.moveName, '×' + e.count, 'mult', e.damageMultiplier)
    }
    expect(exs.find(e => e.moveId === '1091009')?.damageMultiplier).toBeCloseTo(788.3, 3)
  }, 120000)
})
