import { describe, expect, it } from 'vitest'
import {
  matchBossPreset,
  submissionToDeploy,
  type ArchiveRun,
  type ArchiveRoom,
  type BossPresetEntry,
} from '@/composables/runArchiveImport'

/** 真实派生的 boss 预设最小样本（name/nameEn/aliases 足以驱动匹配器）。 */
const BOSS_PRESETS: BossPresetEntry[] = [
  { id: '40006', name: '基塔布鲁', nameEn: 'Girtablullu', aliases: [] },
  {
    id: '40008',
    name: '基塔布鲁·滞变畸兽',
    nameEn: 'Girtablullu - Stagnant Aberrant',
    aliases: ['滞变畸兽', 'Girtablullu: Stagnant Aberrant'],
  },
  { id: '30033', name: '秽息司祭', nameEn: 'Miasma Priest', aliases: [] },
]

const ROOM_GIRTA: ArchiveRoom = {
  id: '69043-1',
  bossName: 'Girtablullu - Stagnant Aberrant',
  bossNameZh: '基塔布鲁·滞变畸兽',
  primaryEnemy: 'Girtablullu - Stagnant Aberrant',
  primaryEnemyZh: '基塔布鲁·滞变畸兽',
}

/** 真实样例：铃依依_ 星见雅(6命5精)+南宫羽(6命5精)+柚叶(6命5精)，65000 击杀。 */
const REAL_RUN: ArchiveRun = {
  id: '3f9d1b05-357a-4251-b8ab-6711da63ba3b',
  mode: 'Deadly Assault',
  seasonId: '69043',
  targetId: '69043-1',
  targetLabel: '2026/08/14 - 2026/08/28 | Girtablullu - Stagnant Aberrant',
  authorName: '铃依依_',
  videoUrl: 'https://www.bilibili.com/video/BV1hwhw6BEDy',
  bangbooId: '54010',
  timeSeconds: 82,
  score: 65000,
  bossKilled: true,
  primaryAgentId: '1091',
  submittedAt: '2026-08-27T10:14:19.565Z',
  team: [
    { slot: 1, agentId: '1091', mindscape: 6, weaponId: '14109', phase: 5 },
    { slot: 2, agentId: '1511', mindscape: 6, weaponId: '14151', phase: 5 },
    { slot: 3, agentId: '1411', mindscape: 6, weaponId: '14149', phase: 5 },
  ],
}

describe('submissionToDeploy 队伍映射', () => {
  it('真实样例：slot→index、命座、音擎、精炼 全部直通', () => {
    const cfg = submissionToDeploy(REAL_RUN, ROOM_GIRTA, BOSS_PRESETS)
    expect(cfg.supported).toBe(true)
    expect(cfg.team.map((s) => s.agentId)).toEqual(['1091', '1511', '1411'])
    expect(cfg.team.map((s) => s.slot)).toEqual([0, 1, 2])
    expect(cfg.team.map((s) => s.cinemaLevel)).toEqual([6, 6, 6])
    expect(cfg.team.map((s) => s.wEngineId)).toEqual(['14109', '14151', '14149'])
    expect(cfg.team.map((s) => s.wEngineModLevel)).toEqual([5, 5, 5])
  })

  it('乱序 team（slot 3/1/2）按槽位排序落地', () => {
    const run: ArchiveRun = {
      ...REAL_RUN,
      team: [
        { slot: 3, agentId: '1411', mindscape: 6, weaponId: '14149', phase: 5 },
        { slot: 1, agentId: '1091', mindscape: 6, weaponId: '14109', phase: 5 },
        { slot: 2, agentId: '1511', mindscape: 6, weaponId: '14151', phase: 5 },
      ],
    }
    const cfg = submissionToDeploy(run, ROOM_GIRTA, BOSS_PRESETS)
    expect(cfg.team.map((s) => s.agentId)).toEqual(['1091', '1511', '1411'])
  })

  it('clamp：命座 9→6、精炼 0→1、精炼 7→5；空音擎→null（交自动推荐）', () => {
    const run: ArchiveRun = {
      ...REAL_RUN,
      team: [
        { slot: 1, agentId: '1091', mindscape: 9, weaponId: '', phase: 7 },
        { slot: 2, agentId: '1511', mindscape: 0 },
        { slot: 3, agentId: '1411', mindscape: 6, weaponId: '14149', phase: 0 },
      ],
    }
    const cfg = submissionToDeploy(run, ROOM_GIRTA, BOSS_PRESETS)
    expect(cfg.team[0].cinemaLevel).toBe(6)
    expect(cfg.team[0].wEngineModLevel).toBe(5)
    expect(cfg.team[0].wEngineId).toBeNull()
    expect(cfg.team[1].wEngineId).toBeNull()
    expect(cfg.team[1].wEngineModLevel).toBe(1)
    expect(cfg.team[2].wEngineModLevel).toBe(1)
    // 空音擎 + 缺音擎 都应产生提示
    expect(cfg.warnings.some((w) => w.includes('自动推荐'))).toBe(true)
  })

  it('2 人队：第三槽空 + warning', () => {
    const run: ArchiveRun = {
      ...REAL_RUN,
      team: [
        { slot: 1, agentId: '1091', mindscape: 6, weaponId: '14109', phase: 5 },
        { slot: 2, agentId: '1511', mindscape: 6, weaponId: '14151', phase: 5 },
      ],
    }
    const cfg = submissionToDeploy(run, ROOM_GIRTA, BOSS_PRESETS)
    expect(cfg.team[2].agentId).toBe('')
    expect(cfg.warnings.some((w) => w.includes('槽位 3 无角色'))).toBe(true)
  })

  it('不支持模式（Shiyu Defense）→ supported=false + warning', () => {
    const cfg = submissionToDeploy({ ...REAL_RUN, mode: 'Shiyu Defense' }, ROOM_GIRTA, BOSS_PRESETS)
    expect(cfg.supported).toBe(false)
    expect(cfg.warnings.some((w) => w.includes('暂不支持'))).toBe(true)
  })
})

describe('matchBossPreset Boss 匹配', () => {
  it('精确中文名 → 基塔布鲁·滞变畸兽（40008）', () => {
    const m = matchBossPreset(ROOM_GIRTA, BOSS_PRESETS)
    expect(m?.presetId).toBe('40008')
  })

  it('消歧义：「基塔布鲁」单独命中 40006 而非 40008', () => {
    const room: ArchiveRoom = { id: 'x', bossNameZh: '基塔布鲁' }
    expect(matchBossPreset(room, BOSS_PRESETS)?.presetId).toBe('40006')
  })

  it('英文名精确命中', () => {
    const room: ArchiveRoom = { id: 'x', bossName: 'Miasma Priest' }
    expect(matchBossPreset(room, BOSS_PRESETS)?.presetId).toBe('30033')
  })

  it('别名「滞变畸兽」兜底命中', () => {
    const room: ArchiveRoom = { id: 'x', bossNameZh: '滞变畸兽' }
    expect(matchBossPreset(room, BOSS_PRESETS)?.presetId).toBe('40008')
  })

  it('未收录 Boss（亵渎者）→ null + warning', () => {
    const room: ArchiveRoom = { id: 'x', bossNameZh: '亵渎者', bossName: 'The Defiler' }
    expect(matchBossPreset(room, BOSS_PRESETS)).toBeNull()
    const cfg = submissionToDeploy(REAL_RUN, room, BOSS_PRESETS)
    expect(cfg.boss).toBeNull()
    expect(cfg.warnings.some((w) => w.includes('手动选 Boss'))).toBe(true)
  })

  it('无房间 → Boss 为 null（无房间信息）', () => {
    expect(matchBossPreset(undefined, BOSS_PRESETS)).toBeNull()
    const cfg = submissionToDeploy(REAL_RUN, undefined, BOSS_PRESETS)
    expect(cfg.boss).toBeNull()
  })
})