import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamPanelEffectInput,
  ExtraAnomalyRowGroup,
  ExtraAnomalyRowsInput,
  ReadonlyTeam,
} from '../types'
import { EXTRA_ANOMALY_ROW_ORDER } from '../types'
import type { Agent, PanelValues, SkillMove } from '@/types/catalog'
import type { CharacterResourceResult, RemielleMechanicSource } from '@/types/resource'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'
import { fmt } from '@/utils/format'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { ELEMENT_DMG_KEYS, ELEMENT_DEF_REDUCTION_KEYS, ELEMENT_RES_REDUCTION_KEYS } from '@/core/elementKeys'
import { findMoveById } from '@/data/moveTableQueries'

const REMIELLE_AGENT_ID = '1581'
/**
 * 蕾米埃尔的**队友 buff 归属别名**（`catalog.<agent>.teammateBuffId`）。
 *
 * ⚠ 契约面必须留这一支：各处历史上写的是 `agent.teammateBuffId === 'remielle'`，
 * 而**当前数据面**里 `teammateBuffId` 只有 5 个取值（1171/1261/1411/1511/1581）且全部等于自身 id
 * ⇒ 该右臂恒 false（`findSlotByIdentity.test.ts` 把这个数据面事实钉住了）。删掉会让「数据面将来
 * 真给出别名」时静默失效 —— 与旧正则口径漏计 `.id`/`teammateBuffId` 两形态是同族错误。
 */
const REMIELLE_TEAMMATE_BUFF_ID = 'remielle'
const VOIDFLARE_MAX = 3
const VOIDFLARE_INITIAL = 3
const REFRINGE_COEFFICIENT_PER_AP = 0.02
// @fact agent:1581/耀变倍率提升 口径: 耀变倍率提升=异常精通×0.2%（原文「根据自身异常精通的0.2%提升此伤害倍率」；audit/1581.json 录入快照 + nanoka 3.2.1/3.2.3/3.3.0 + 账本蕾米埃尔.xlsx Q10=1+精通×0.2% + catalog corePassive 公式 x*0.2 四源一致）。旧值 0.1 为录入转写错误：伤害管线一直走 catalog 公式（0.2 正确），本常量只喂资源卡展示，曾致展示口径与引擎相差一半 | 据 原文四源核对@2026-09-07·复核@2026-09-25 | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/mechanics/agents/remielle.ts#LUMINIZE_MULTIPLIER_PER_AP | 信 确认
const LUMINIZE_MULTIPLIER_PER_AP = 0.2

export function computeRemielleMechanic(input: {
  anomalyProficiency: number
}): RemielleMechanicSource {
  const ap = Math.max(0, input.anomalyProficiency)
  return {
    voidflareStored: VOIDFLARE_INITIAL,
    voidflareMax: VOIDFLARE_MAX,
    refringeCoefficient: ap * REFRINGE_COEFFICIENT_PER_AP,
    luminizeMultiplierBonus: ap * LUMINIZE_MULTIPLIER_PER_AP,
    note: '虚曜：最多储存3个，队友触发异常反应生成；花羽轮舞/缭乱终幕/垂虹/惊鸿命中后触发耀变，按储存异常效果强度结算招式对应倍率；异化系数=异常精通×0.02%，耀变倍率提升=异常精通×0.2%。耀变次数由异常池按队友异常触发自动结算，不由用户直接调整。',
  }
}

function buildRemielleResourceResult({ cfg }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    remielleMechanicSource: computeRemielleMechanic({
      anomalyProficiency: cfg.panel.anomalyProficiency ?? 0,
    }),
  }
}

function buildRemielleResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.remielleMechanicSource
  if (!source) return []
  return [
    {
      id: 'remielle-voidflare',
      title: '蕾米埃尔虚曜·耀变',
      summary: `虚曜 ${source.voidflareStored}/${source.voidflareMax} · 耀变由异常池自动结算`,
      rows: [
        { label: '虚曜储存', value: `${source.voidflareStored}/${source.voidflareMax}`, detail: '队友异常反应生成，最多存3个' },
        { label: '耀变触发', value: '自动', detail: '花羽轮舞/缭乱终幕/垂虹/惊鸿命中后触发，次数由队友异常触发池自动计算' },
        { label: '异化系数', value: `${fmt(source.refringeCoefficient)}%`, detail: '异常精通 × 0.02%' },
        { label: '耀变倍率提升', value: `${fmt(source.luminizeMultiplierBonus)}%`, detail: '异常精通 × 0.2%' },
      ],
      footer: source.note,
    },
  ]
}

// ============================================================================
// 蕾米埃尔专属异常辅助函数（CC-19c-1 2026-09-26，设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §7.2）：
// 自 `composables/resourceCalc/anomalyPanels.ts` 逐字迁入（算式/常量值/条件/求值顺序零改动）。
// `anomalyPanels.ts` 保留 import + export 壳 ⇒ `helpers.ts` / `useResourceCalc.ts` /
// `damagePoolAnomaly.ts` / 既有测试的 import 路径零改动。依赖只有 `@/core/skillLevel` /
// `@/core/elementKeys` / `@/utils/format` / `@/types/catalog` 类型。
// ============================================================================
export function getRemielleLevelValue(row: SkillMove['rows'][number] | undefined, skillLevelBonus: number): number {
  if (!row) return 0
  const values = row.values ?? []
  if (!values.length) return 0
  const skillLevel = getSkillLevelCoef(skillLevelBonus).skillLevel
  const levelValues = (row as any).levelValues ?? (row as any).luminizeLevelValues
  if (Array.isArray(levelValues)) {
    const idx = levelValues.indexOf(skillLevel)
    if (idx >= 0) return values[idx] ?? values[0] ?? 0
  }
  if (values.length === 3) {
    return values[skillLevel >= 16 ? 2 : skillLevel >= 14 ? 1 : 0] ?? values[0] ?? 0
  }
  return values[0] ?? 0
}

export function remielleSpecialVoidflareCount(panel: PanelValues): number {
  const firstRound = panel.remielleCinema1SpecialVoidflareCount ?? 0
  if (firstRound <= 0) return 0
  const refillRound = panel.remielleCinema4SpecialVoidflareRefillCount ?? 0
  const c6Multiplier = 1 + Math.max(0, panel.remielleCinema6SpecialVoidflareTriggerMultiplier ?? 0)
  return (firstRound + Math.max(0, refillRound)) * c6Multiplier
}

export interface VoidflareDamageInput {
  sourcePanel: PanelValues
  remiellePanel: PanelValues
  multiplier: number
  element: string
  enemyDefense: number
  enemyResistances: Record<string, number>
  stunMultiplier: number
  /** 是否失衡或失衡易伤覆盖率（0-1） */
  stunned: boolean | number
  cinema1ResIgnore: number
}

export function calcVoidflareDamage(input: VoidflareDamageInput): { damage: number; formula: string } {
  const { sourcePanel: source, remiellePanel: remielle, multiplier, element, enemyDefense, enemyResistances, stunMultiplier, stunned, cinema1ResIgnore } = input

  const baseDmg = source.atk * (multiplier / 100)
  const elementDmg = source[ELEMENT_DMG_KEYS[element]] ?? 0
  const dmgMult = 1 + ((source.dmgBonus ?? 0) + elementDmg) / 100
  const profMult = (source.anomalyProficiency ?? 0) / 100

  const remielleDefReduction = (remielle.enemyDefReduction ?? 0)
    + (remielle.enemyAnomalyDefReduction ?? 0)
    + (remielle[ELEMENT_DEF_REDUCTION_KEYS[element]] ?? 0)
  const effectiveDef = Math.max(0,
    enemyDefense * (1 - (source.penRatio ?? 0) / 100) * (1 - remielleDefReduction / 100)
    - ((source.penFlat ?? 0) + (remielle.enemyDefFlatReduction ?? 0)),
  )
  const defMult = 794 / (794 + effectiveDef)
  const levelMult = 2
  const mass = baseDmg * dmgMult * profMult * defMult * levelMult

  const baseRes = enemyResistances[element] ?? 0
  const sourceResReduction = (source.enemyResReduction ?? 0)
    + (source[ELEMENT_RES_REDUCTION_KEYS[element]] ?? 0)
    + cinema1ResIgnore
  const resMult = 1 - (baseRes - sourceResReduction) / 100

  const anomalyDmgMult = 1 + (remielle.anomalyDmgBonus ?? 0) / 100
  const passiveLuminizeMult = 1 + (remielle.remielleLuminizeMultiplierBonus ?? 0) / 100
  const cinema4LuminizeMult = 1 + (remielle.remielleCinema4LuminizeMultiplierBonus ?? 0) / 100
  const luminizeMult = passiveLuminizeMult * cinema4LuminizeMult
  const refringeMult = 1 + ((remielle.remielleRefringeCoefficient ?? 0) + (remielle.remielleRefringeCoefficientBonusPct ?? 0)) / 100

  const dmgTakenMult = 1 + (remielle.enemyDamageTakenBonus ?? 0) / 100
  let stunBonus = (remielle.stunDmgMultiplierBonus ?? 0) + (remielle.stunDmgMultiplierBonusAlways ?? 0)
  const stunCap = remielle.stunDmgMultiplierBonusCapAlways ?? 0
  if (stunCap > 0) stunBonus = Math.min(stunBonus, stunCap)
  const stunMult = stunned ? Math.max(0, stunMultiplier + stunBonus / 100) : 1

  const damage = mass * resMult * anomalyDmgMult * luminizeMult * refringeMult * stunMult * dmgTakenMult
  const formula = `基础 ${fmt(source.atk)}×${fmt(multiplier)}% × 增伤(1+${fmt((source.dmgBonus ?? 0) + elementDmg)}%) × 精通(${fmt(source.anomalyProficiency ?? 0)}/100) × 防御(${fmt(defMult, 4)}) × 等级(${levelMult}) × 抗性(${fmt(resMult, 4)}) × 异化(${fmt(refringeMult, 4)}) × 异常增伤(1+${fmt(remielle.anomalyDmgBonus ?? 0)}%) × 耀变被动(${fmt(passiveLuminizeMult, 4)}) × 4命(${fmt(cinema4LuminizeMult, 4)}) × 失衡(${fmt(stunMult, 4)}) × 易伤(${fmt(dmgTakenMult, 4)})`

  return { damage, formula }
}

/**
 * 本槽角色是不是蕾米埃尔（**角色身份判定的单一事实源**，规则 11）。
 *
 * 原先这条判据在编排层重复 4 次（`helpers.ts` 的 `:756` 面板块 / `:798` 相变时流块 /
 * `:996` 风染挑槽 / `:1661` cfg 构建），2026-09-17 round 21 夜间批 C 收进本模块：
 * **调用点不再出现身份字面量**，两臂语义（`id` 与 `teammateBuffId` 别名）只在这一处维护。
 */
export function isRemielleAgent(agent: { id?: string; teammateBuffId?: string } | null | undefined): boolean {
  return agent?.id === REMIELLE_AGENT_ID || agent?.teammateBuffId === REMIELLE_TEAMMATE_BUFF_ID
}

/** 蕾米埃尔的**额外能力三档转攻**：队友中存在 [异常] 或同阵营角色时按异常角色数取 1/2/3 档。
 *
 * `active` 门控与档位封顶逐位照搬原 `helpers.ts#resolveRemielleDazeBonus`（原实现读
 * `buildMechanicTeamMembers` + `agent.faction`，本模块从钩子入参拿同一份 `team` 与 `agent`）。
 * 空槽（`agent` 为 null）不参与计数，也不与本人同槽比较 —— 与原实现的 `member.slot === slot` 等价。
 */
function remielleDazeTier(slot: number, agent: Agent, team: ReadonlyTeam): number {
  const faction = agent.faction
  const active = team.some(member => {
    if (member.slot === slot || !member.agent) return false
    return member.agent.specialty === 'anomaly' || (!!faction && member.agent.faction === faction)
  })
  const anomalyCount = team.filter(member => member.agent?.specialty === 'anomaly').length
  return active ? Math.max(1, Math.min(3, anomalyCount)) : 0
}

/** 额外能力三档 → 失衡提升%（0 / 6 / 12 / 35）。 */
function remielleDazeBonusPct(slot: number, agent: Agent, team: ReadonlyTeam): number {
  return [0, 6, 12, 35][remielleDazeTier(slot, agent, team)] ?? 0
}

/**
 * 蕾米埃尔自己的面板块（2026-09-17 round 21 夜间批 C 自 `helpers.ts#computePanelPhases` 迁入）。
 *
 * 语义逐位保留：**只写自己那槽**，两个出口——
 * ① `panel.remielleRadiantTurnDazeBonusPct`（Radiant Turn 行失衡倍率，消费端 `helpers.ts` 的
 *    `foundMove.id === '1581010'` 分支）；
 * ② `cfg.remielleRadiantTurnDazeBonusPct` 由下方 `buildCharConfig` 写（原 `:1661` 的双出口）。
 *
 * ⚠ **同一字段原先有两个写者**（`helpers.ts:757` 面板阶段 + `:1666` cfg 构建阶段各算一遍，
 * 当前值相同故幂等）。本批让**唯一写者 = 本模块**：面板阶段写 ①，cfg 阶段写 ②，
 * 两处都读同一个 `remielleDazeBonusPct` 算式 ⇒ 「字段存在即蕴含是本角色」（判据同 T6）。
 *
 * ⚠ 这是**同槽自面板块**（不触 P2 跨槽陷阱）：`applyPanel` 每个槽都会算到自己，蕾米的
 * `applyPanel` 只在蕾米那槽被派发 —— 与迁移前 `if (agent.id === '1581' …)` 的守卫同义。
 */
function applyRemiellePanel({ slot, agent, team, panel, settings }: AgentPanelInput): void {
  void settings
  if (!isRemielleAgent(agent)) return
  panel.remielleRadiantTurnDazeBonusPct = remielleDazeBonusPct(slot, agent, team)
}

/**
 * 蕾米强特 Radiant Turn 的「**相变时流**」：全队增伤，按蕾米技能等级 12/14/16 对应 18%/21%/24%。
 *
 * 原实现（`helpers.ts:796-804`）在**每个**角色的面板阶段 `findIndex` 找蕾米、读**她**的命座、
 * 给**当前**面板加 `dmgBonus`，且**没有自排除** ⇒ 蕾米本人也吃。本钩子逐位保留这一点。
 *
 * 为什么必须走本钩子而不是 `applyPanel`（`AgentTeamPanelEffectInput` 头注释的分工表）：
 * 该加成**随目标槽位不同而不同**（每个槽都要查一次「蕾米在不在队」）⇒ 写进蕾米自己的
 * `applyPanel` 只会加到蕾米本人面板（R20-h1 分诊 §2.1 的 P2 陷阱是同一族的**实证**教训）。
 *
 * ⚠ 与「相变时流」并列的还有 `resolveRemielleDazeBonus` 那条（`:756`）——那条是**同槽自面板块**，
 * 留在 `applyRemiellePanel`，**不要**搬到这里，否则双计（`AgentTeamPanelEffectInput` 的
 * 「两个钩子都会跑」纪律）。
 */
function applyRemielleTeamPanelEffects({ slot, cinemaLevel, team, panel }: AgentTeamPanelEffectInput): void {
  // ★ 「相变时流」是**一个光环**，不是「每个蕾米各加一次」：原实现用
  // `configStore.team.findIndex(…)` 找**第一个**蕾米、读**她**的命座、给当前面板加**一次**。
  // 本钩子按**来源槽**逐槽派发 ⇒ 不设守卫时「双蕾米队」会加 N 次。
  // ⚠ **这是逐位等价对拍抓到的真回归**（2026-09-17 本批实测：`[1581,1581,1581]` 队
  // `dmgBonus` 由 **33 → 69**，差值 36 = 2 × 18，即多算两份 0 命蕾米的 `(12+0)×1.5`）。
  // ⇒ 只有「槽位最小的那个蕾米」认领本加成，且用**她自己**的命座（与 `findIndex` 首位语义同）。
  // 契约面不冲突：`AgentTeamPanelEffectInput.team` 就是用来做这种「谁是第一来源」判定的
  // （`AgentTeamPanelEffectInput` 纪律「多个来源写同一字段时结果与顺序有关」在这里被消掉——
  //  只会有唯一一个来源真的写）。
  const firstRemielle = [...team].sort((a, b) => a.slot - b.slot).find(m => isRemielleAgent(m.agent))
  if (!firstRemielle || firstRemielle.slot !== slot) return

  // 原式：`remielleCinema >= 5 ? 4 : remielleCinema >= 3 ? 2 : 0` ⇒ 技能等级 12/14/16
  const cinema = cinemaLevel ?? 0
  const skillLevelBonus = cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0
  panel.dmgBonus = (panel.dmgBonus ?? 0) + (12 + skillLevelBonus) * 1.5
}

/** 把「本槽是不是蕾米埃尔」与额外能力档位写进 cfg（原 `helpers.ts:1661-1667` 的 cfg 出口）。 */
function buildRemielleCharConfig({ slot, agent, team, cfg }: AgentCharConfigInput): void {
  if (!isRemielleAgent(agent)) return
  const dazeBonusPct = remielleDazeBonusPct(slot, agent, team)
  // panel 同名字段只由上方 applyRemiellePanel 写（buildCharConfig 的 panel 只读：cfg 是本钩子唯一出口）
  cfg.remielleEnabled = true
  cfg.remielleRadiantTurnDazeBonusPct = dazeBonusPct
}

export const remielleMechanic: AgentMechanicModule = {
  id: 'agent:remielle',
  agentIds: [REMIELLE_AGENT_ID],
  /** 异化系数倍率：1 + (异化度 + 异化度提升) / 100，乘到全队所有异常相关伤害（CC-21 自 useResourceCalc 逐字迁入） */
  globalAnomalyMultiplierFactor: (panel: PanelValues) => {
    const coefficient = (panel.remielleRefringeCoefficient ?? 0) + (panel.remielleRefringeCoefficientBonusPct ?? 0)
    return 1 + coefficient / 100
  },
  name: '蕾米埃尔',
  description: '虚曜/耀变/异化系数：队友异常反应生成虚曜，特定招式命中触发耀变；异化系数与耀变倍率随异常精通提升。',
  applyPanel: applyRemiellePanel,
  teamPanelEffects: applyRemielleTeamPanelEffects,
  buildCharConfig: buildRemielleCharConfig,
  buildResourceResult: buildRemielleResourceResult,
  resourceSections: buildRemielleResourceSections,
  /**
   * 蕾米埃尔专属异常附加行（CC-19c-2 2026-09-26，设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §7.2）：
   * 块 6（耀变 / 特殊虚耀）自 `damagePoolAnomaly.ts` 逐字迁入，order = `EXTRA_ANOMALY_ROW_ORDER.voidflare`（60）。
   * 字段、字段顺序、id / name / type / source / note 模板与 `[0, 1, 2]` 字面量逐字不变（对象键顺序可能进
   * rowsnap 哈希）；`remielleSlot` / `remiellePanel` / `remielleEntryPanel` / `remielleSkills` 用局部别名
   * 保持块体逐字（派发循环里本模块只被自己那槽调用 ⇒ `remielleSlot >= 0` 恒真，别名等价）。
   */
  extraAnomalyRows: ({
    slot, panel, entryPanel, skills, panelOf, teamElement, getTeamMechanicSetting,
    enemy, enemyDamageRes, stunCoverage, anomalyPool, teamAgentId, agentName, elementLabel,
  }: ExtraAnomalyRowsInput): ExtraAnomalyRowGroup[] => {
    const rows: DamagePoolRow[] = []
    const remielleSlot = slot
    const remiellePanel = panel
    const remielleEntryPanel = entryPanel
    const remielleSkills = skills
    if (remiellePanel && remielleEntryPanel) {
      const otherSlots = [0, 1, 2].filter(slot => slot !== remielleSlot)
      const perSlotAnomaly = anomalyPool?.perSlotAnomalyTriggers ?? []
      const voidflareBySlot = otherSlots
        .map(slot => ({
          slot,
          count: Math.max(0, Math.floor(perSlotAnomaly[slot] ?? 0)),
          element: teamElement(slot),
          panel: panelOf(slot),
        }))
        .filter(item => item.count > 0 && item.panel)
      const voidflareTotal = voidflareBySlot.reduce((sum, item) => sum + item.count, 0)

      if (voidflareTotal > 0 && remielleSkills) {
        const skillLevelBonus = remiellePanel.skillLevelBonus ?? 0
        const c1ResIgnore = (remiellePanel.remielleCinema1SpecialVoidflareCount ?? 0) > 0 ? 50 : 0
        const c6LuminizeMultiplier = 1 + Math.max(0, remiellePanel.remielleCinema6LuminizeTriggerMultiplier ?? 0)
        const qBatches = Math.floor(voidflareTotal / 3)
        const firstOtherSlot = otherSlots[0]
        const secondOtherSlot = otherSlots[1]
        const firstPerBatch = otherSlots.length === 1
          ? 3
          : Math.max(0, Math.min(3, Math.floor(getTeamMechanicSetting(`remielle.q:${remielleSlot}`, 1))))
        const secondPerBatch = Math.max(0, 3 - firstPerBatch)
        const qCountBySlot: Record<string, number> = {}
        if (otherSlots.length === 1) {
          qCountBySlot[String(firstOtherSlot)] = qBatches * 3
        } else {
          qCountBySlot[String(firstOtherSlot)] = qBatches * firstPerBatch
          qCountBySlot[String(secondOtherSlot)] = qBatches * secondPerBatch
        }
        const actionRows = [
          {
            id: 'remielle-luminize-assist',
            name: '支援技花羽轮舞·耀变',
            moveId: '1581015',
            countsBySlot: Object.fromEntries(voidflareBySlot.map(item => [item.slot, item.count])),
          },
          {
            id: 'remielle-luminize-ultimate',
            name: '终结技缭乱终幕·耀变',
            moveId: '1581016',
            countsBySlot: qCountBySlot,
          },
          {
            id: 'remielle-luminize-basic',
            name: '普通攻击惊鸿·耀变',
            moveId: '1581008',
            countsBySlot: Object.fromEntries(voidflareBySlot.map(item => [item.slot, item.count * c6LuminizeMultiplier])),
          },
        ]

        for (const action of actionRows) {
          const move = findMoveById(remielleSkills, action.moveId)
          const luminizeRow = move?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
          const multiplier = getRemielleLevelValue(luminizeRow, skillLevelBonus)
          if (multiplier <= 0) continue
          const actionCount = Object.values(action.countsBySlot).reduce((a, b) => a + b, 0)
          if (actionCount <= 0) continue

          for (const item of voidflareBySlot) {
            const count = action.countsBySlot[String(item.slot)] ?? 0
            if (count <= 0 || !item.panel) continue
            const result = calcVoidflareDamage({
              sourcePanel: item.panel,
              remiellePanel,
              multiplier,
              element: item.element,
              enemyDefense: enemy.defense,
              enemyResistances: enemyDamageRes,
              stunMultiplier: enemy.stunVuln,
              stunned: stunCoverage,
              cinema1ResIgnore: c1ResIgnore,
            })
            rows.push({
              id: `${action.id}-${item.slot}`,
              slot: remielleSlot,
              agentId: teamAgentId(remielleSlot),
              agentName: agentName(teamAgentId(remielleSlot), remielleSlot),
              type: '耀变',
              name: action.name,
              element: item.element,
              source: `${agentName(teamAgentId(item.slot), item.slot)} 的${elementLabel(item.element)}异常虚耀`,
              count,
              perDamage: result.damage,
              totalDamage: result.damage * count,
              note: `来源虚耀 ${count} 次 · ${result.formula}`,
            })
          }
        }

        const specialCount = remielleSpecialVoidflareCount(remiellePanel)
        if (specialCount > 0) {
          const rainbowMove = findMoveById(remielleSkills, '1581007')
          const rainbowLuminizeRow = rainbowMove?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
          const rainbowMultiplier = getRemielleLevelValue(rainbowLuminizeRow, skillLevelBonus)
          const specialMultiplier = rainbowMultiplier * 2.5
          if (specialMultiplier > 0) {
            const result = calcVoidflareDamage({
              sourcePanel: remielleEntryPanel,
              remiellePanel: remielleEntryPanel,
              multiplier: specialMultiplier,
              element: 'lumiflux',
              enemyDefense: enemy.defense,
              enemyResistances: enemyDamageRes,
              stunMultiplier: enemy.stunVuln,
              stunned: stunCoverage,
              cinema1ResIgnore: c1ResIgnore,
            })
            rows.push({
              id: 'remielle-special-voidflare',
              slot: remielleSlot,
              agentId: teamAgentId(remielleSlot),
              agentName: agentName(teamAgentId(remielleSlot), remielleSlot),
              type: '特殊虚耀',
              name: '普通攻击垂虹·特殊虚耀',
              element: 'lumiflux',
              source: '蕾米进场记录面板 × 2.5 特殊独立乘区',
              count: specialCount,
              perDamage: result.damage,
              totalDamage: result.damage * specialCount,
              note: `垂虹倍率 ${fmt(rainbowMultiplier)}% × 2.5 · ${result.formula}`,
            })
          }
        }
      }
    }
    if (rows.length === 0) return []
    return [{ order: EXTRA_ANOMALY_ROW_ORDER.voidflare, rows }]
  },
}
