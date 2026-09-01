/**
 * 实战归档校准（composables/runArchiveCalibration.ts）的护栏。
 *
 * 三层：
 * ① 区间观测口径——归档不拆「伤害分/操作分」，预测落在可行区间内必须记 0 误差，
 *    否则会把「操作分未知」当成模型误差，报告直接失真；
 * ② 统计与分层——误差汇总、击杀四象限、分层偏差排序（排查从这里起头）；
 * ③ 抽样确定性——同种子同样本，改动前后才可比。
 */
import { describe, expect, it } from 'vitest'
import {
  OPERATION_SCORE_MAX,
  damageScoreBounds,
  groupBias,
  killOutcome,
  signedError,
  stratifiedSample,
  summarizeCalibration,
  type CalibrationCase,
} from '@/composables/runArchiveCalibration'

const mkCase = (over: Partial<CalibrationCase> = {}): CalibrationCase => ({
  runId: 'r', mode: 'Deadly Assault', hard: false, team: ['1011', '1021', '1031'],
  actualScore: 50000, actualKill: false, predictedDamageScore: 50000, predictedKill: false, damageRatio: 0.8,
  ...over,
})

describe('区间观测：归档分数不是点观测', () => {
  it('击杀 → 伤害分恰好 60000（区间退化成点）', () => {
    expect(damageScoreBounds(65000, true)).toEqual([60000, 60000])
    expect(damageScoreBounds(61000, true)).toEqual([60000, 60000])
  })

  it('未击杀 → [总分−操作分上限, 总分]，且钳制在 [0, 60000]', () => {
    expect(damageScoreBounds(50000, false)).toEqual([50000 - OPERATION_SCORE_MAX, 50000])
    expect(damageScoreBounds(3000, false)).toEqual([0, 3000])
    // 总分 64000 未击杀 ⇒ 伤害分 ≥ 64000−5000 = 59000，且 ≤ 60000（上界截断）
    expect(damageScoreBounds(64000, false)).toEqual([59000, 60000])
  })

  it('预测落在区间内 = 0 误差；出界才按到最近边界算（高估为正、低估为负）', () => {
    const b = damageScoreBounds(50000, false) // [45000, 50000]
    expect(signedError(47000, b)).toBe(0)
    expect(signedError(52000, b)).toBe(2000)
    expect(signedError(40000, b)).toBe(-5000)
  })
})

describe('统计：误差汇总与击杀四象限', () => {
  it('四象限命名：fp = 预测击杀但实战没杀（高估）', () => {
    expect(killOutcome(true, false)).toBe('fp')
    expect(killOutcome(false, true)).toBe('fn')
    expect(killOutcome(true, true)).toBe('tp')
    expect(killOutcome(false, false)).toBe('tn')
  })

  it('汇总：inside 记 0、bias 有符号、准确率/查准/查全自洽', () => {
    const cases = [
      mkCase({ predictedDamageScore: 48000 }), // 区间内 → 0
      mkCase({ predictedDamageScore: 56000 }), // +6000
      mkCase({ actualKill: true, predictedKill: true, predictedDamageScore: 60000 }), // 点命中 → 0
      mkCase({ actualKill: true, predictedKill: false, predictedDamageScore: 40000 }), // -20000, fn
    ]
    const s = summarizeCalibration(cases)
    expect(s.n).toBe(4)
    expect(s.insideRate).toBe(0.5)
    expect(s.meanBias).toBeCloseTo((0 + 6000 + 0 - 20000) / 4, 6)
    expect(s.mae).toBeCloseTo((0 + 6000 + 0 + 20000) / 4, 6)
    expect(s.kill).toMatchObject({ tp: 1, fn: 1, tn: 2, fp: 0 })
    expect(s.kill.accuracy).toBeCloseTo(3 / 4, 6)
    expect(s.kill.precision).toBeCloseTo(1, 6)
    expect(s.kill.recall).toBeCloseTo(0.5, 6)
  })

  it('空输入不炸（除零保护）', () => {
    const s = summarizeCalibration([])
    expect(s.n).toBe(0)
    expect(Number.isFinite(s.mae)).toBe(true)
    expect(Number.isFinite(s.meanBias)).toBe(true)
  })
})

describe('分层偏差：按绝对偏差排序，小样本组被剔除', () => {
  it('偏差最大的组排最前；n < minN 的组不进榜（避免个案噪声上榜）', () => {
    const cases = [
      ...Array.from({ length: 6 }, () => mkCase({ primaryAgentId: 'A', predictedDamageScore: 58000 })), // +8000
      ...Array.from({ length: 6 }, () => mkCase({ primaryAgentId: 'B', predictedDamageScore: 47000 })), // 0
      mkCase({ primaryAgentId: 'C', predictedDamageScore: 60000 }), // 单条大偏差，但样本不足
    ]
    const rows = groupBias(cases, c => c.primaryAgentId ?? '?', 5)
    expect(rows.map(r => r.key)).toEqual(['A', 'B'])
    expect(rows[0].meanBias).toBeCloseTo(8000, 6)
    expect(rows[1].insideRate).toBe(1)
  })
})

describe('分层抽样：确定性 + 小组有代表', () => {
  const items = [
    ...Array.from({ length: 100 }, (_, i) => ({ id: 'big' + i, key: 'big' })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'mid' + i, key: 'mid' })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: 'tiny' + i, key: 'tiny' })),
  ]

  it('同种子同样本（改动前后可比）；异种子不同', () => {
    const a = stratifiedSample(items, 20, i => i.key, 1).map(i => i.id)
    const b = stratifiedSample(items, 20, i => i.key, 1).map(i => i.id)
    const c = stratifiedSample(items, 20, i => i.key, 2).map(i => i.id)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('大组按比例占多数，但小组也必有代表（不被大组淹没）', () => {
    const sample = stratifiedSample(items, 20, i => i.key, 7)
    expect(sample).toHaveLength(20)
    const byKey = new Map<string, number>()
    for (const s of sample) byKey.set(s.key, (byKey.get(s.key) ?? 0) + 1)
    expect(byKey.get('big')).toBeGreaterThan(byKey.get('mid') ?? 0)
    expect(byKey.get('tiny')).toBeGreaterThanOrEqual(1)
    expect(new Set(sample.map(s => s.id)).size).toBe(20) // 不重复
  })

  it('要的比有的多 → 全给', () => {
    expect(stratifiedSample(items, 999, i => i.key)).toHaveLength(items.length)
  })
})
// ── 探针：真引擎批跑归档，出误差报告（PROBE_CALIB=1）──
// 跑法：PROBE_CALIB=1 PROBE_CALIB_N=60 npx vitest run src/composables/__tests__/runArchiveCalibration.test.ts
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { submissionToDeploy, type ArchiveRun, type ArchiveRoom } from '@/composables/runArchiveImport'
import { applyDeployConfig } from '@/composables/runArchiveDeploy'
import { scoreForDamageRatio } from '@/core/deadlyAssaultScore'
import type { BossPresetFile } from '@/types/bossPreset'

describe('探针：真引擎 × 实战归档误差报告', () => {
  it.runIf(process.env.PROBE_CALIB)('分层抽样批跑，出误差分布 + 分层偏差 + 击杀混淆矩阵', async () => {
    const N = Number(process.env.PROBE_CALIB_N ?? 60)
    const seed = Number(process.env.PROBE_CALIB_SEED ?? 20260831)
    const archive = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as {
      runs: ArchiveRun[]
      rooms: Record<string, ArchiveRoom & { seasonStart?: string; bossNameZh?: string }>
    }
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
    await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    const configStore = useConfigStore()
    const catalog = useCatalogStore()
    // 必须显式加载配装推荐：applyTeamPreset 会调 applyBuildRecommendationForSlot，
    // 但 catalog 没加载推荐时它**静默 return false** → 全队裸装上阵。
    // 首版探针就是这么跑出「系统性低估 28159 分、查全率 5%」的假结论的。
    await catalog.loadBuildRecommendations()
    const { teamTotalDamage, stunAxisResult } = useResourceCalc()

    // 只保留「模式支持 + Boss 预设与相位都匹配得上 + 三名角色都在 catalog」的 run
    const usable = archive.runs.filter((run) => {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      if (!deploy.supported || !deploy.boss?.phaseId) return false
      return (run.team ?? []).length === 3 && run.team.every(m => catalog.getAgent(m.agentId))
    })
    const sample = stratifiedSample(usable, N, r => r.targetId, seed)
    console.log('\n=== 样本 ===')
    console.log('归档', archive.runs.length, '条 → 可跑', usable.length, '条 → 分层抽样', sample.length, '条（按 targetId 分层，种子', seed + '）')

    const cases: CalibrationCase[] = []
    const t0 = Date.now()
    for (const run of sample) {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      const hp = configStore.enemy.hp ?? 0
      const damage = teamTotalDamage.value ?? 0
      const ratio = hp > 0 ? damage / hp : 0
      const hard = (run.mode ?? '').includes('Adversity')
      cases.push({
        runId: run.id, mode: run.mode, hard,
        primaryAgentId: run.primaryAgentId, team: run.team.map(m => m.agentId),
        bossId: deploy.boss?.presetId, phaseId: deploy.boss?.phaseId ?? undefined,
        actualScore: run.score, actualKill: run.bossKilled,
        predictedDamageScore: scoreForDamageRatio(ratio, hard ? 'critical_assault' : 'defense'),
        predictedKill: damage >= hp && hp > 0,
        damageRatio: ratio,
        axisActive: stunAxisResult.value != null,
      })
    }
    const elapsed = (Date.now() - t0) / 1000
    const s = summarizeCalibration(cases)
    const nameOf = (id?: string) => (id ? catalog.getAgent(id)?.name?.zhCN ?? id : '?')

    console.log('\n=== 误差（伤害分口径，0-60000；实战分是区间观测，落区间内记 0）===')
    console.log('样本', s.n, '| 落在区间内', (s.insideRate * 100).toFixed(1) + '%',
      '| MAE', Math.round(s.mae), '| 中位误差', Math.round(s.medianError), '| 平均偏差', Math.round(s.meanBias),
      '| p10/p90', Math.round(s.p10) + ' / ' + Math.round(s.p90))
    console.log('低估（可证伪的建模缺口）', s.under.count, '条 · 平均', Math.round(s.under.mean),
      '| 高估（上限高于实战，属正常）', s.over.count, '条 · 平均', Math.round(s.over.mean))
    console.log('伤害/血量比（不被 60000 天花板削顶，看高估侧改动只能看它）：中位', s.ratio.median.toFixed(2),
      '| p90', s.ratio.p90.toFixed(2), '| ≥1（预测能击杀）占比', (s.ratio.overOneRate * 100).toFixed(1) + '%')
    console.log(s.meanBias >= 0
      ? '平均偏差 > 0 = 系统性高估（配装差：归档无驱动盘，计算器按推荐配装算）'
      : '平均偏差 < 0 = 系统性低估（默认口径偏保守：非轴 + 交互基准 + 推荐配装 vs 投稿玩家的极限操作/词条）')
    console.log('注意：归档是 approved 顶尖投稿（幸存者偏差），本报告度量的是「默认口径 vs 顶尖实战」的差，不是引擎绝对准确度')

    console.log('\n=== 击杀判定混淆矩阵（不受操作分影响，最干净的信号）===')
    console.log('预测击杀·实战击杀 tp', s.kill.tp, '| 预测击杀·实战没杀 fp', s.kill.fp,
      '| 预测没杀·实战击杀 fn', s.kill.fn, '| 双方都没杀 tn', s.kill.tn)
    console.log('准确率', (s.kill.accuracy * 100).toFixed(1) + '%',
      '| 查准', (s.kill.precision * 100).toFixed(1) + '%', '| 查全', (s.kill.recall * 100).toFixed(1) + '%')

    // 轴分层：把「口径差（默认非轴）」与「建模差」分开
    const byAxis = groupBias(cases, c => (c.axisActive ? '有轴' : '无轴'), 1)
    console.log('\n=== 分层偏差 · 失衡轴是否生效（口径差 vs 建模差的刀口）===')
    console.log('口径      n   平均偏差  中位误差  区间内  击杀准确率')
    for (const g of byAxis) {
      console.log(g.key.padEnd(8), String(g.n).padStart(3), Math.round(g.meanBias).toString().padStart(9),
        Math.round(g.medianError).toString().padStart(9), ((g.insideRate * 100).toFixed(0) + '%').padStart(7),
        ((g.killAccuracy * 100).toFixed(0) + '%').padStart(10))
    }

    const byAgent = groupBias(cases, c => nameOf(c.primaryAgentId), 4).slice(0, 8)
    console.log('\n=== 分层偏差 · 按主 C（|平均偏差| 降序，n≥4）===')
    console.log('主C            n   平均偏差  中位误差  区间内  击杀准确率')
    for (const g of byAgent) {
      console.log(g.key.padEnd(12), String(g.n).padStart(3), Math.round(g.meanBias).toString().padStart(9),
        Math.round(g.medianError).toString().padStart(9), ((g.insideRate * 100).toFixed(0) + '%').padStart(7),
        ((g.killAccuracy * 100).toFixed(0) + '%').padStart(10))
    }
    const byBoss = groupBias(cases, c => archive.rooms[sample.find(r => r.id === c.runId)?.targetId ?? '']?.bossNameZh ?? c.bossId ?? '?', 4).slice(0, 8)
    console.log('\n=== 分层偏差 · 按 Boss ===')
    console.log('Boss                  n   平均偏差  中位误差  区间内')
    for (const g of byBoss) {
      console.log(g.key.padEnd(20), String(g.n).padStart(3), Math.round(g.meanBias).toString().padStart(9),
        Math.round(g.medianError).toString().padStart(9), ((g.insideRate * 100).toFixed(0) + '%').padStart(7))
    }
    console.log('\n批跑耗时', elapsed.toFixed(1), '秒（' + (elapsed / Math.max(1, cases.length) * 1000).toFixed(0) + ' ms/条）')

    // 与上一次产物对比（同种子同 N 才可比）——「改动前后误差有没有变好」靠这段回答
    const artifactUrl = new URL('../../../.zc/calibration.json', import.meta.url)
    try {
      const prev = JSON.parse(readFileSync(artifactUrl, 'utf8')) as { sample?: { seed?: number; used?: number }; summary?: typeof s }
      if (prev.summary && prev.sample?.seed === seed && prev.sample?.used === cases.length) {
        const d = (a: number, b: number) => (a - b >= 0 ? '+' : '') + Math.round(a - b)
        console.log('\n=== 与上次产物对比（同种子同样本量）===')
        console.log('MAE', Math.round(prev.summary.mae), '→', Math.round(s.mae), '(' + d(s.mae, prev.summary.mae) + ')',
          '| 平均偏差', Math.round(prev.summary.meanBias), '→', Math.round(s.meanBias), '(' + d(s.meanBias, prev.summary.meanBias) + ')',
          '| 击杀准确率', (prev.summary.kill.accuracy * 100).toFixed(1) + '% →', (s.kill.accuracy * 100).toFixed(1) + '%')
      }
    } catch { /* 首次跑没有上次产物，正常 */ }

    mkdirSync(new URL('../../../.zc/', import.meta.url), { recursive: true })
    writeFileSync(new URL('../../../.zc/calibration.json', import.meta.url), JSON.stringify({
      generatedAt: new Date().toISOString(),
      sample: { requested: N, used: cases.length, poolSize: usable.length, archiveSize: archive.runs.length, seed },
      summary: s, byAxis, byAgent, byBoss, cases,
    }, null, 2))
    console.log('产物已写 .zc/calibration.json')

    expect(cases.length).toBeGreaterThan(0)
    expect(s.insideRate).toBeGreaterThanOrEqual(0)
    expect(s.kill.tp + s.kill.fp + s.kill.fn + s.kill.tn).toBe(cases.length)
  }, 3600000)
})
// ── 校准棘轮（进 npm test）：误差只准变好，变差即红 ──
describe('校准棘轮：同种子同样本量，误差不许劣化', () => {
  it('80 条固定样本的 MAE / 击杀准确率 / 区间命中率不劣于基线', async () => {
    const baseline = JSON.parse(readFileSync(new URL('./calibration-baseline.json', import.meta.url), 'utf8')) as {
      seed: number; n: number; summary: { insideRate: number; mae: number; meanBias: number; killAccuracy: number; under: { count: number; mean: number } }
    }
    const archive = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as {
      runs: ArchiveRun[]
      rooms: Record<string, ArchiveRoom & { seasonStart?: string }>
    }
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
    await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    const configStore = useConfigStore()
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    const { teamTotalDamage, stunAxisResult } = useResourceCalc()

    const usable = archive.runs.filter((run) => {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      if (!deploy.supported || !deploy.boss?.phaseId) return false
      return (run.team ?? []).length === 3 && run.team.every(m => catalog.getAgent(m.agentId))
    })
    const sample = stratifiedSample(usable, baseline.n, r => r.targetId, baseline.seed)
    const cases: CalibrationCase[] = sample.map((run) => {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      const hp = configStore.enemy.hp ?? 0
      const damage = teamTotalDamage.value ?? 0
      const hard = (run.mode ?? '').includes('Adversity')
      return {
        runId: run.id, mode: run.mode, hard, primaryAgentId: run.primaryAgentId,
        team: run.team.map(m => m.agentId), bossId: deploy.boss?.presetId, phaseId: deploy.boss?.phaseId ?? undefined,
        actualScore: run.score, actualKill: run.bossKilled,
        predictedDamageScore: scoreForDamageRatio(hp > 0 ? damage / hp : 0, hard ? 'critical_assault' : 'defense'),
        predictedKill: damage >= hp && hp > 0, damageRatio: hp > 0 ? damage / hp : 0,
        axisActive: stunAxisResult.value != null,
      }
    })
    const s = summarizeCalibration(cases)
    const how = '→ 若是有意的口径变更：npm run probe:calibration 后把 .zc/calibration.json 的 summary 抄进 calibration-baseline.json，并在提交说明写明原因'
    // 只卡**低估侧**：计算器算上限，预测低于真实发生过的成绩 = 可证伪的建模缺口（用户 2026-09-01 口径）。
    // 高估侧不卡——上限高于普通实战属正常，卡它等于逼着把引擎往归档分数上拟合。
    expect(s.n, '样本量必须与基线一致').toBe(baseline.n)
    expect(s.under.count, '低估条数增加（新的建模缺口）' + how).toBeLessThanOrEqual(baseline.summary.under.count)
    expect(Math.abs(s.under.mean), '低估幅度加深 ' + how).toBeLessThanOrEqual(Math.abs(baseline.summary.under.mean) * 1.005)
    // 基线过期提醒（与 check-guards 的「清单可回收」同思路：进步了就该收紧）
    if (s.under.count < baseline.summary.under.count || Math.abs(s.under.mean) < Math.abs(baseline.summary.under.mean) * 0.95) {
      console.warn('⚠ 校准基线可收紧：低估 ' + baseline.summary.under.count + ' 条/' + Math.round(baseline.summary.under.mean)
        + ' → ' + s.under.count + ' 条/' + Math.round(s.under.mean) + '，把新值写进 calibration-baseline.json')
    }
  }, 300000)
})