/**
 * 测试公共 harness —— fetch 三文件 stub + pinia + 队伍装配的唯一实现。
 *
 * 背景：历史上 40+ 测试文件各自复制「catalog/teammate-buffs/build-recommendations 三文件
 * fetch stub + createPinia + config.team 填充」样板（AGENT_RECORDING_SOP §7 坑 1 模板）。
 * 本文件是该样板的唯一实现（single source of truth）：
 * - 新增测试一律 `import { setupHarness } from '@/test/harness'`，不再复制 stub；
 * - 需要自定义队伍/加载步骤的测试可用 mockStaticFetch + newPinia + setTeam 自由组合。
 *
 * 默认口径（对齐 billySmoke / batchAWave1 模板的并集）：
 * - 加载 catalog + teammate-buffs（额外能力/拐力门控需要）；
 * - 装配 config.team 后调用 syncTeammateBuffsFromTeam()；
 * - 每槽位默认 TEST_BASE_CHAR，可经 HarnessTeamSlot 逐字段覆盖。
 */
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { vi } from 'vitest'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'

const catalogText = readFileSync(new URL('../../public/static/catalog.json', import.meta.url), 'utf8')
const teammateBuffsText = readFileSync(new URL('../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const buildRecsText = readFileSync(new URL('../../public/static/build-recommendations.json', import.meta.url), 'utf8')

/** 单槽位默认配置（对齐 billySmoke 模板；各测试按需覆盖） */
export const TEST_BASE_CHAR = {
  wEngineId: '',
  wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 6,
  blockCount: 0,
  dodgeCounterCount: 10,
  quickAssistCount: 3,
  chainCountPerStun: 1,
  basicAttackTimeWeight: 1,
} as const

/** 队伍槽位输入：agentId 必填，其余字段覆盖 TEST_BASE_CHAR */
export interface HarnessTeamSlot {
  agentId: string
  cinemaLevel?: number
  [key: string]: unknown
}

/** stub fetch 返回三个静态文件（catalog/teammate-buffs/build-recommendations） */
export function mockStaticFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(teammateBuffsText) }
    if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(buildRecsText) }
    return { ok: false, json: async () => ({}) }
  }))
}

/** 新建并激活一个 pinia（beforeEach 隔离用） */
export function newPinia(): void {
  setActivePinia(createPinia())
}

/** 加载 catalog（+ 可选 teammate-buffs），返回 catalog store */
export async function loadCatalogStore(loadTeammateBuffs = true) {
  const catalog = useCatalogStore()
  await catalog.load()
  if (loadTeammateBuffs) await catalog.loadTeammateBuffs()
  return catalog
}

/** 把队伍写进 config.team（'' = 空槽），随后 syncTeammateBuffsFromTeam() */
export function setTeam(
  config: ReturnType<typeof useConfigStore>,
  team: Array<HarnessTeamSlot | ''>,
): void {
  for (let i = 0; i < 3; i++) {
    const t = team[i]
    config.team[i] = {
      slot: i,
      agentId: t ? t.agentId : '',
      cinemaLevel: t ? (t.cinemaLevel ?? 0) : 0,
      ...TEST_BASE_CHAR,
      ...(t ? t : {}),
    } as never
  }
  config.syncTeammateBuffsFromTeam()
}

/**
 * 一站式装配：新建 pinia → stub fetch → 加载 catalog/teammate-buffs → 填充队伍。
 * 返回 { catalog, config } 供测试直接使用。
 */
export async function setupHarness(
  team: Array<HarnessTeamSlot | ''>,
  opts: { loadTeammateBuffs?: boolean } = {},
) {
  setActivePinia(createPinia())
  mockStaticFetch()
  const catalog = await loadCatalogStore(opts.loadTeammateBuffs ?? true)
  const config = useConfigStore()
  setTeam(config, team)
  return { catalog, config }
}
