import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamPanelEffectInput,
  MechanicTeamMember,
} from '../types'
import type { Agent } from '@/types/catalog'
import type { CharacterResourceResult, RemielleMechanicSource } from '@/types/resource'
import { fmt } from '@/utils/format'

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
// @fact agent:1581/耀变倍率提升 口径: 耀变倍率提升=异常精通×0.2%（原文「根据自身异常精通的0.2%提升此伤害倍率」；audit/1581.json 录入快照 + nanoka 3.2.1/3.2.3/3.3.0 + 账本蕾米埃尔.xlsx Q10=1+精通×0.2% + catalog corePassive 公式 x*0.2 四源一致）。旧值 0.1 为录入转写错误：伤害管线一直走 catalog 公式（0.2 正确），本常量只喂资源卡展示，曾致展示口径与引擎相差一半 | 据 原文四源核对@2026-09-07 | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/mechanics/agents/remielle.ts#LUMINIZE_MULTIPLIER_PER_AP | 信 确认
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
function remielleDazeTier(slot: number, agent: Agent, team: MechanicTeamMember[]): number {
  const faction = agent.faction
  const active = team.some(member => {
    if (member.slot === slot || !member.agent) return false
    return member.agent.specialty === 'anomaly' || (!!faction && member.agent.faction === faction)
  })
  const anomalyCount = team.filter(member => member.agent?.specialty === 'anomaly').length
  return active ? Math.max(1, Math.min(3, anomalyCount)) : 0
}

/** 额外能力三档 → 失衡提升%（0 / 6 / 12 / 35）。 */
function remielleDazeBonusPct(slot: number, agent: Agent, team: MechanicTeamMember[]): number {
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
function buildRemielleCharConfig({ slot, agent, team, panel, cfg }: AgentCharConfigInput): void {
  if (!isRemielleAgent(agent)) return
  const dazeBonusPct = remielleDazeBonusPct(slot, agent, team)
  // 原实现先写 panel 再写 cfg（两处都是同一个数）⇒ 逐位保留「面板阶段已经写过、cfg 阶段再写一次」
  panel.remielleRadiantTurnDazeBonusPct = dazeBonusPct
  cfg.remielleEnabled = true
  cfg.remielleRadiantTurnDazeBonusPct = dazeBonusPct
}

export const remielleMechanic: AgentMechanicModule = {
  id: 'agent:remielle',
  agentIds: [REMIELLE_AGENT_ID],
  name: '蕾米埃尔',
  description: '虚曜/耀变/异化系数：队友异常反应生成虚曜，特定招式命中触发耀变；异化系数与耀变倍率随异常精通提升。',
  applyPanel: applyRemiellePanel,
  teamPanelEffects: applyRemielleTeamPanelEffects,
  buildCharConfig: buildRemielleCharConfig,
  buildResourceResult: buildRemielleResourceResult,
  resourceSections: buildRemielleResourceSections,
}
