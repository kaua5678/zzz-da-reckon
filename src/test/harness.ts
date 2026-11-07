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
 * - ⚠ 平A时间权重默认每槽 **1**（不是生产的「支援/防护 = 0」）：回归套件的 golden / 基准全建立在三人均分上，
 *   探针 / 分析脚本要生产口径传 `productionBasicWeights: true`（T11）。
 */
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { vi } from 'vitest'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore, interactionBaselineFor } from '@/stores/config'
import { defaultRowFusionRules } from '@/logicEditor/defaults'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import { installTeamAwareBuildRecommendation } from '@/composables/teamAwareRecommendation'
import { collectInCombatTeamBuffs } from '@/core/inCombatBuffs'
import { applyEffect } from '@/core/buff'
import { emptyPanel } from '@/core/panel'
import type { DriveDiscConfig, PanelValues } from '@/types/catalog'

const catalogText = readFileSync(new URL('../../public/static/catalog.json', import.meta.url), 'utf8')
const teammateBuffsText = readFileSync(new URL('../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const buildRecsText = readFileSync(new URL('../../public/static/build-recommendations.json', import.meta.url), 'utf8')
const bossPresetsText = readFileSync(new URL('../../public/static/boss-presets.json', import.meta.url), 'utf8')
// 更新日志（400 KB）：与 run-archive 同款「按需读」——不是每个用 harness 的测试都需要它
const CHANGELOG_URL = new URL('../../public/static/changelog.json', import.meta.url)

/** 单槽位默认配置（对齐 billySmoke 模板；各测试按需覆盖） */
export const TEST_BASE_CHAR = {
  wEngineId: '',
  wEngineModLevel: 1,
  potentialLevel: 6,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 6,
  blockCount: 0,
  dodgeCounterCount: 10,
  chainCountPerStun: 1,
  basicAttackTimeWeight: 1,
} as const

/**
 * 判据基线敌人 = **测试专用**，与产品默认（`stores/config.ts#defaultEnemy` 的木桩）**解耦**。
 *
 * ## 为什么要有它（2026-10-27）
 * 用户把产品默认改成「自由训练模式木桩」后，**67 条既有判据同时变红**——它们全都从未 `setEnemy`，
 * 一直吃 store 默认。A/B 实测：HEAD 版 config.ts 只红 10 条，换默认后 77 条 ⇒ 那 67 条不是「算错了」，
 * 是「判据的隐含前提被产品默认偷偷改写了」。用户原话：「这测试也是够麻烦的，每次开发都畏手畏脚。」
 *
 * 根因不是默认值改了，而是**判据曾经依赖产品默认**。所以修法是让夹具自带一把**固定的尺子**：
 * 所有走 `setupHarness` 的判据看到的敌人 = 这里的常量，永不随产品默认漂移。
 * ⇒ 以后再改默认，这 67 条一条都不会红，只红真正被默认值影响的那几条（本轮 = 12 条）。
 *
 * ## 取值口径
 * 逐字 = 2026-10-27 之前的产品默认（某期危局 Boss：205,970,837 血 / 15,486 失衡 / 防御 953 / 危局系数 1.1 / 秽盾 1）。
 * **冻结**，不跟随任何产品默认变化；要测木桩请用 `TRAINING_DUMMY_ENEMY`。
 */
export const BASELINE_ENEMY = {
  hp: 205970837,
  stunValue: 15486,
  stunTime: 12,
  stunCountLock: -1,
  stunVuln: 1.5,
  defense: 953,
  level: 70,
  anomalyCoeff: 1,
  bossAnomalyCoeff: 1.1,
  bossStunGift: 0,
  shieldCount: 1,
  energyShield: 0,
  invincibleTime: 0,
  battleTime: 180,
  bodySize: 'large',
} as const

/**
 * 判据基线全局 Buff = 2026-10-27 之前的产品默认（两条危局buff + 一条禁用 boss增伤）。
 * 同上：**冻结**，让判据与「产品默认带不带环境」解耦。
 */
export const BASELINE_GLOBAL_BUFFS = [
  { id: 'b1', name: '危局buff', stat: 'atkPct', value: 20, enabled: true, targetSkillType: 'all' },
  { id: 'b2', name: '危局buff', stat: 'dmgBonus', value: 15, enabled: true, targetSkillType: 'all' },
  { id: 'b3', name: 'boss增伤', stat: 'enemyDamageTakenBonus', value: 0, enabled: false, targetSkillType: 'all' },
] as const

/** 产品默认（木桩）的判据侧镜像：只给「就是要测默认值」的判据用（训练木桩口径） */
export const TRAINING_DUMMY_ENEMY = {
  hp: 3347325000,
  stunValue: 17582.7,
  stunTime: 12,
  stunCountLock: -1,
  stunVuln: 1.5,
  defense: 952.8,
  level: 70,
  anomalyCoeff: 1.25,
  bossAnomalyCoeff: 1,
  bossStunGift: 0,
  shieldCount: 0,
  energyShield: 0,
  invincibleTime: 0,
  battleTime: 180,
  bodySize: 'large',
} as const

/** 队伍槽位输入：agentId 必填，其余字段覆盖 TEST_BASE_CHAR */
export interface HarnessTeamSlot {
  agentId: string
  cinemaLevel?: number
  [key: string]: unknown
}

/**
 * stub fetch 返回静态文件（catalog / teammate-buffs / build-recommendations / boss-presets / run-archive /
 * run-archive-experts / changelog）。
 * `betaAgents` 显式传入才服务 `/static/beta-agents.json`（默认 404，对齐「还没有 beta 快照」的部署态，
 * 保证测试不随工作区是否生成过快照而漂移）；beta 开关本身由测试自行写 localStorage。
 */
export function mockStaticFetch(options?: { betaAgents?: unknown }): void {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(teammateBuffsText) }
    if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(buildRecsText) }
    if (u.includes('/static/boss-presets.json')) return { ok: true, json: async () => JSON.parse(bossPresetsText) }
    if (u.includes('/static/beta-agents.json') && options?.betaAgents !== undefined) {
      return { ok: true, json: async () => options.betaAgents }
    }
    // 3 MB：按需读（不在模块加载时读，免得每个用 harness 的测试文件都付这笔）
    if (u.includes('/static/run-archive.json')) return { ok: true, json: async () => JSON.parse(readFileSync(new URL('../../public/static/run-archive.json', import.meta.url), 'utf8')) }
    // 高手补录（2.3 MB，与主集分开一个文件）：同上按需读。注意两条判断互不包含
    // （'/static/run-archive-experts.json' 不含 '/static/run-archive.json'），顺序不影响命中。
    if (u.includes('/static/run-archive-experts.json')) return { ok: true, json: async () => JSON.parse(readFileSync(new URL('../../public/static/run-archive-experts.json', import.meta.url), 'utf8')) }
    // 400 KB，同上按需读（更新日志只有弹层的测试要）
    if (u.includes('/static/changelog.json')) return { ok: true, json: async () => JSON.parse(readFileSync(CHANGELOG_URL, 'utf8')) }
    return { ok: false, json: async () => ({}) }
  }))
}

/** 新建并激活一个 pinia（beforeEach 隔离用）；**不套用任何敌人夹具**（保留产品默认） */
export function newPinia(): void {
  setActivePinia(createPinia())
}

/**
 * 新建 pinia **并套用判据基线敌人 / 全局 Buff**（2026-10-27）。
 *
 * 为什么需要它：大量老判据在 `beforeEach` 里只写 `newPinia() + mockStaticFetch()` 就自己塞 `config.team`，
 * 从不 `setEnemy` ⇒ 一直吃产品默认。产品默认一改（换成训练木桩）它们就集体变红，
 * 而这批判据测的是**机制**（般岳轴内捏块 / 仪玄术法值……），与「默认敌人是谁」无关。
 *
 * 用法 = `newPinia()` 的直接替代；要测产品默认的判据继续用 `newPinia()`。
 */
export function newPiniaWithFixtures(
  fixtures: 'baseline' | 'product' | { enemy?: Record<string, unknown>; globalBuffs?: readonly unknown[] } = 'baseline',
): void {
  setActivePinia(createPinia())
  applyFixtureDefaults(useConfigStore(), fixtures)
}

/** 加载 catalog（+ 可选 teammate-buffs），返回 catalog store */
async function loadCatalogStore(loadTeammateBuffs = true) {
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
/** setTeam / setupHarness 的夹具口径开关 */
export interface HarnessTeamOptions {
  /** true ⇒ 每槽 `basicAttackTimeWeight` 走生产 `configStore.getDefaultBasicAttackTimeWeight`（支援/防护 = 0）；默认 false = 每槽 1 */
  productionBasicWeights?: boolean
}

export function setTeam(
  config: ReturnType<typeof useConfigStore>,
  team: Array<HarnessTeamSlot | ''>,
  opts: HarnessTeamOptions = {},
): void {
  const catalog = useCatalogStore()
  for (let i = 0; i < 3; i++) {
    const t = team[i]
    // 裸字符串（除空串占位）是调用方误用：`t.agentId` 会静默得到 undefined ⇒ 空队伍，
    // 测试可能因此「因错误的原因通过」。这类静默失败实测踩过（初版特征测试 7/9 假红）。
    if (typeof t === 'string' && t !== '') {
      throw new Error(`[harness] setTeam 槽位 ${i} 收到裸字符串 ${JSON.stringify(t)}；`
        + '请用对象形式 { agentId } 或空串占位（裸 id 会静默变成空队伍）')
    }
    const agentId = t ? t.agentId : ''
    const agent = agentId ? catalog.getAgent(agentId) : null
    const base = agentId
      ? interactionBaselineFor(agentId, agent?.specialty)
      : { parry: 0, dodge: 0, block: 0, dual: 0 }
    // 平A时间权重：**默认每槽 1（TEST_BASE_CHAR），有意不随生产口径**——回归套件 40+ 文件的 golden / 基准都建立在
    // 「三人均分平A池」上；探针 / 分析脚本要生产口径（模块声明优先，支援/防护 = 0，否则 1）时传
    // `productionBasicWeights: true`，走 configStore 同一函数，不在夹具里复制判定逻辑（T11 2026-10-03；
    // 背景：维丹队探针里柚叶 weight=1 分走 1/3 平A池、高估辅助/低估主C，用户 2026-10-01 报）。
    const weightDefault = opts.productionBasicWeights ? config.getDefaultBasicAttackTimeWeight(agent) : TEST_BASE_CHAR.basicAttackTimeWeight
    config.team[i] = {
      slot: i,
      agentId,
      cinemaLevel: t ? (t.cinemaLevel ?? 0) : 0,
      ...TEST_BASE_CHAR,
      // 职业基准兜底（TEST_BASE_CHAR 之后、槽位显式值之前，保证"显式 > 基准 > 通用默认"）
      parryCount: base.parry,
      dodgeCounterCount: base.dodge,
      blockCount: base.block,
      basicAttackTimeWeight: weightDefault,
      // driveDisc 深拷贝：TEST_BASE_CHAR 是模块级常量，浅展开会让三槽共享同一 driveDisc
      //（mainStats/subStatAllocation 互相污染——曾让诊断/deploy 测试的配装推荐互相覆盖）
      driveDisc: structuredClone(TEST_BASE_CHAR.driveDisc),
      ...(t ? t : {}),
    } as never
  }
  config.syncTeammateBuffsFromTeam()
}

/**
 * 把夹具口径写进 config（`setupHarness` 的 `fixtures` 选项实现；也可直接调用）。
 *
 * `'baseline'` = **判据基线**（`BASELINE_ENEMY` + `BASELINE_GLOBAL_BUFFS`）：让判据与产品默认解耦。
 * `'product'` = 不动（保留 store 的产品默认；「测默认值本身」的判据用）。
 * 对象 = 在基线上覆写 `enemy` 字段 / 整体替换 `globalBuffs`（`globalBuffs` 只在这个口径下会被换掉）。
 */
export function applyFixtureDefaults(
  config: ReturnType<typeof useConfigStore>,
  fixtures: 'baseline' | 'product' | { enemy?: Record<string, unknown>; globalBuffs?: readonly unknown[] },
): void {
  if (fixtures === 'product') return
  const base = fixtures === 'baseline' ? {} : fixtures
  config.setEnemy({ ...BASELINE_ENEMY, ...(base.enemy ?? {}) } as never)
  if (fixtures === 'baseline') {
    config.globalBuffs.splice(0, config.globalBuffs.length, ...(BASELINE_GLOBAL_BUFFS.map(r => ({ ...r })) as never[]))
  } else if (fixtures.globalBuffs) {
    config.globalBuffs.splice(0, config.globalBuffs.length, ...(fixtures.globalBuffs as never[]))
  }
}

/**
 * 一站式装配：新建 pinia → stub fetch → 加载 catalog/teammate-buffs → 填充队伍。
 * 返回 { catalog, config } 供测试直接使用。
 * ⚠️ 新建 pinia ⇒ **调用之前**取的 store / `useResourceCalc()` 引用全部作废（指向上一个 pinia）：用返回值，或在调用之后再取。
 * 拿旧引用断言「没变」的用例会恒绿（r698：freeCompareEngine「调用方 store 全程不被改写」就这样落空过）。
 *
 * ⚠️ **默认不应用配装推荐**（`recommendedBuild: false`）——有意为之：应用推荐会跑副词条优化器
 * （慢）且改变既有测试的数值基线。但代价必须知道：**默认队伍穿的是 `setAgent` 兜底盘
 * （34200 荆棘玫瑰 = 2件套防御+16%），主C也穿防御套**，而且不报错、数字自洽。
 * 拿默认档算伤害/失衡再外推到实战 = 整体偏低（2026-09-07 实测：同一低金归档部署
 * 伤害/血量 16.9%（兜底防御套）vs 56.3%（推荐配装））。
 * 要"接近部署"的口径 → 传 `{ recommendedBuild: true }`。
 */
export async function setupHarness(
  team: Array<HarnessTeamSlot | ''>,
  opts: {
    loadTeammateBuffs?: boolean
    recommendedBuild?: boolean
    betaAgents?: unknown
    /**
     * 敌人 / 全局 Buff 的夹具口径：
     * - `'baseline'`（**缺省**）= 套用 `BASELINE_ENEMY` + `BASELINE_GLOBAL_BUFFS`（与产品默认解耦的固定尺子）
     * - `'product'` = **保留产品默认**（只给「就是要断言产品默认值」的判据用，如 trainingDummyDefault）
     * - `{ enemy, globalBuffs }` = 精确指定（判据自己声明要测哪个敌人）
     *
     * ⚠ 2026-10-27：缺省从「吃产品默认」改成「吃判据基线」。理由见 `BASELINE_ENEMY` 头注释——
     * 产品默认一改就让 67 条无关判据变红 = 判据曾经依赖产品默认，那是判据的缺陷不是默认值的错。
     */
    fixtures?: 'baseline' | 'product' | { enemy?: Partial<typeof BASELINE_ENEMY>; globalBuffs?: readonly unknown[] }
  } & HarnessTeamOptions = {},
) {
  setActivePinia(createPinia())
  mockStaticFetch(opts.betaAgents !== undefined ? { betaAgents: opts.betaAgents } : undefined)
  // 与 useCalculatorStartup 同一入口激活行融合规则：测试态 = 生产启动态（r697，原先测试态规则恒空）。
  // 每次调用都重新激活 spec 默认规则；用例要自定规则须在 setupHarness 之后 setActiveRowFusionRules。
  setActiveRowFusionRules(defaultRowFusionRules())
  // 与 src/main.ts 同一启动态：推荐配装接队友暴击（2026-10-29）。判据看到的推荐分配必须与生产一致，
  // 否则「推荐配装在队友给暴击时溢出」这类缺陷在测试面上永远看不见。
  installTeamAwareBuildRecommendation()
  const catalog = await loadCatalogStore(opts.loadTeammateBuffs ?? true)
  const config = useConfigStore()
  applyFixtureDefaults(config, opts.fixtures ?? 'baseline')
  setTeam(config, team, { productionBasicWeights: opts.productionBasicWeights })
  if (opts.recommendedBuild) {
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) if (team[i]) config.applyBuildRecommendationForSlot(i)
  }
  return { catalog, config }
}

/**
 * 走**生产通道**解一组队友 buff 的数值（CC-188）：`collectInCombatTeamBuffs`（含 `buffModifiers`，
 * 如丽娜 C1 ×1.3）→ `applyEffect`，源面板量 x 以 `dynamicSourceValue` 注入，结果叠在 `emptyPanel()` 上。
 * 用途：断言 `teammate-buffs.json` 里公式 / 派生 effect 的数值，而不是在模块里手抄一份公式再测副本。
 * 前置：`catalog.load()` + `catalog.loadTeammateBuffs()` 已完成。
 */
export function resolveTeammateBuffsOnEmptyPanel(enabledBuffIds: readonly string[], sourceValue: number): PanelValues {
  const catalog = useCatalogStore()
  // r411 CC-385：引擎只收在队拥有者的 buff ⇒ 队伍 = 被启用 buff 所在组的拥有者
  const owners = catalog.teammateBuffGroups
    .filter(g => (g.buffs ?? []).some(b => enabledBuffIds.includes(b.id)))
    .map(g => ({ agentId: g.id, cinemaLevel: 6, driveDisc: {} as DriveDiscConfig }))
  const buffs = collectInCombatTeamBuffs(owners, {
    teammateBuffGroups: catalog.teammateBuffGroups,
    driveDiscSetsMap: catalog.driveDiscSetsMap,
    getAgent: id => catalog.getAgent(id),
    getWEngine: id => catalog.getWEngine(id),
    isTeammateBuffEnabled: id => enabledBuffIds.includes(id),
  })
  const panel = emptyPanel()
  for (const buff of buffs) {
    if (!enabledBuffIds.includes(buff.id)) continue
    for (const effect of buff.effects ?? []) applyEffect(panel, { ...effect, dynamicSourceValue: sourceValue })
  }
  return panel
}
