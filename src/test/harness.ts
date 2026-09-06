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
import { useConfigStore, interactionBaselineFor } from '@/stores/config'

const catalogText = readFileSync(new URL('../../public/static/catalog.json', import.meta.url), 'utf8')
const teammateBuffsText = readFileSync(new URL('../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const buildRecsText = readFileSync(new URL('../../public/static/build-recommendations.json', import.meta.url), 'utf8')
const bossPresetsText = readFileSync(new URL('../../public/static/boss-presets.json', import.meta.url), 'utf8')

/** 单槽位默认配置（对齐 billySmoke 模板；各测试按需覆盖） */
export const TEST_BASE_CHAR = {
  wEngineId: '',
  wEngineModLevel: 1,
  potentialLevel: 6,
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

/** stub fetch 返回四个静态文件（catalog/teammate-buffs/build-recommendations/boss-presets） */
export function mockStaticFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(teammateBuffsText) }
    if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(buildRecsText) }
    if (u.includes('/static/boss-presets.json')) return { ok: true, json: async () => JSON.parse(bossPresetsText) }
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

/**
 * 把队伍写进 config.team（'' = 空槽），随后 syncTeammateBuffsFromTeam()。
 *
 * ⚠️ 交互次数（弹刀/闪反/格挡）走仓库单一事实源 `interactionBaselineFor`（支援/防护 = 0，
 * 其余 弹刀6/闪反10，角色专属默认优先），**不再用 `TEST_BASE_CHAR` 的固定值**——固定值给辅助
 * 也发 10 次闪反/6 次弹刀，与部署路径（`runArchiveDeploy` 同一基准）语义不一致，曾让探针把
 * "辅助被主C抢时间"当成机制缺陷报出（2026-09-07）。槽位显式传入的值优先，测试要什么数就写什么。
 */
export function setTeam(
  config: ReturnType<typeof useConfigStore>,
  team: Array<HarnessTeamSlot | ''>,
): void {
  const catalog = useCatalogStore()
  for (let i = 0; i < 3; i++) {
    const t = team[i]
    const agentId = t ? t.agentId : ''
    const base = agentId
      ? interactionBaselineFor(agentId, catalog.getAgent(agentId)?.specialty)
      : { parry: 0, dodge: 0, block: 0, dual: 0 }
    config.team[i] = {
      slot: i,
      agentId,
      cinemaLevel: t ? (t.cinemaLevel ?? 0) : 0,
      ...TEST_BASE_CHAR,
      // 职业基准兜底（TEST_BASE_CHAR 之后、槽位显式值之前，保证"显式 > 基准 > 通用默认"）
      parryCount: base.parry,
      dodgeCounterCount: base.dodge,
      blockCount: base.block,
      // driveDisc 深拷贝：TEST_BASE_CHAR 是模块级常量，浅展开会让三槽共享同一 driveDisc
      //（mainStats/subStatAllocation 互相污染——曾让诊断/deploy 测试的配装推荐互相覆盖）
      driveDisc: structuredClone(TEST_BASE_CHAR.driveDisc),
      ...(t ? t : {}),
    } as never
  }
  config.syncTeammateBuffsFromTeam()
}

/**
 * 一站式装配：新建 pinia → stub fetch → 加载 catalog/teammate-buffs → 填充队伍。
 * 返回 { catalog, config } 供测试直接使用。
 *
 * ⚠️ **默认不应用配装推荐**（`recommendedBuild: false`）——有意为之：应用推荐会跑副词条优化器
 * （慢）且改变既有测试的数值基线。但代价必须知道：**默认队伍穿的是 `setAgent` 兜底盘
 * （34200 棘刺玫瑰 = 2件套防御+16%），主C也穿防御套**，而且不报错、数字自洽。
 * 拿默认档算伤害/失衡再外推到实战 = 整体偏低（2026-09-07 实测：同一低金归档部署
 * 伤害/血量 16.9%（兜底防御套）vs 56.3%（推荐配装））。
 * 要"接近部署"的口径 → 传 `{ recommendedBuild: true }`。
 */
export async function setupHarness(
  team: Array<HarnessTeamSlot | ''>,
  opts: { loadTeammateBuffs?: boolean; recommendedBuild?: boolean } = {},
) {
  setActivePinia(createPinia())
  mockStaticFetch()
  const catalog = await loadCatalogStore(opts.loadTeammateBuffs ?? true)
  const config = useConfigStore()
  setTeam(config, team)
  if (opts.recommendedBuild) {
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) if (team[i]) config.applyBuildRecommendationForSlot(i)
  }
  return { catalog, config }
}
