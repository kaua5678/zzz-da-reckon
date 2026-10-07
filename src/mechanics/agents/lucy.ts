/**
 * 露西（1151）—— 用户确认口径
 *
 * 拐力：加油！攻击公式 + 影画4 暴伤（spec teamBuffs）。
 * 终结技回能：下一位 +30、前一位 +10（两人队则另一人 +30）。
 * 加油触发：强特；影画2 连携/终结也触发 → 每次触发 回旋挥击(1151026)。
 * 抄家伙(1151023-25)：4–6 秒调用一次（冷却可调，默认4），每次三段倍率之和，后台自动不占前台时间。
 * 影画1：回旋挥击命中全队 +2 能量。
 * 影画6：加油下队友强特命中 → 小猪落地 300% 攻火伤 + 一次回旋挥击。
 */
import { moduleExecRow, RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentNextRoundFeedbackInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { ModuleFeedback } from '../types'
import type { CharacterOperationConfig, CharacterResourceResult, SkillExecution } from '@/types/resource'
import { mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import { findMoveById as findMove, getRowValue as rowVal } from '@/data/moveTableQueries'
import { ultNeighborPerTargetAmounts } from '@/mechanics/ultNeighborEnergy'
import { cinemaLevelOf } from '@/data/cinemaLevel'

const cfgNum = mechanicSettingReader(() => lucyMechanic.settings)
export const LUCY_ID = '1151'
const MOVE_SPIN = '1151026' // 亲卫队小猪：回旋挥击！
const MOVE_C6_BOMB = '1151_c6_pig_bomb'
const C6_BOMB_MULT = 300
// 亲卫队小猪：抄家伙！三段（#1 186 / #2 255.1 / #3 351，合计 792.1%）
const MOVE_BOAR_1 = '1151023'
const MOVE_BOAR_2 = '1151024'
const MOVE_BOAR_3 = '1151025'
export const LUCY_BOAR_CD_DEFAULT = 4
export const LUCY_BOAR_CD_MIN = 4
export const LUCY_BOAR_CD_MAX = 6

export interface LucyCheerInput {
  cinemaLevel: number
  exSpecialCount: number
  chainCountTotal: number
  ultimateCount: number
  /** 队友强特次数合计（不含露西） */
  teammateExSpecialTotal: number
}

export interface LucyCheerResult {
  cheerTriggers: number
  spinsFromCheer: number
  c6Bombs: number
  spinsFromC6: number
  totalSpins: number
  c1EnergyPerMember: number
}

/** 加油/回旋/C6 次数纯函数（可单测） */
export function computeLucyCheer(input: LucyCheerInput): LucyCheerResult {
  const cinema = cinemaLevelOf(input.cinemaLevel)
  const ex = Math.max(0, Math.floor(input.exSpecialCount || 0))
  const chain = Math.max(0, Math.floor(input.chainCountTotal || 0))
  const ult = Math.max(0, Math.floor(input.ultimateCount || 0))
  const mateEx = Math.max(0, Math.floor(input.teammateExSpecialTotal || 0))

  // 加油：强特；影画2 + 连携 + 终结
  let cheer = ex
  if (cinema >= 2) cheer += chain + ult
  const spinsFromCheer = cheer
  const c6Bombs = cinema >= 6 ? mateEx : 0
  const spinsFromC6 = c6Bombs
  const totalSpins = spinsFromCheer + spinsFromC6
  const c1EnergyPerMember = cinema >= 1 ? totalSpins * 2 : 0

  return {
    cheerTriggers: cheer,
    spinsFromCheer,
    c6Bombs,
    spinsFromC6,
    totalSpins,
    c1EnergyPerMember,
  }
}


function pushExec(
  executions: SkillExecution[],
  moveId: string,
  moveName: string,
  category: string,
  count: number,
  dmg: number,
  note: string,
  actionTime = 0,
) {
  if (count <= 0 || dmg <= 0) return
  executions.push(moduleExecRow({
    moveId,
    moveName,
    category,
    count,
    actionTime,
    ...RECOVERY_OFF,
    damageMultiplier: dmg,
    damageMultiplierOverride: true,
    element: 'fire',
    skillTableNote: note,
  }))
}

/** 抄家伙调用冷却（秒），钳制到 4–6；缺省 4 */
export function lucyBoarCd(cfg: CharacterOperationConfig): number {
  const raw = cfgNum(cfg, 'lucy.boarCd')
  return Math.max(LUCY_BOAR_CD_MIN, Math.min(LUCY_BOAR_CD_MAX, raw))
}

/** 抄家伙调用次数 = floor(前台时间 / cd)；后台自动不占前台时间 */
export function computeLucyBoarCount(frontlineTime: number, cd: number): number {
  const t = Math.max(0, Number(frontlineTime) || 0)
  const c = Math.max(0.1, Number(cd) || LUCY_BOAR_CD_DEFAULT)
  return Math.floor(t / c)
}

function buildCharConfig({ skills, cinemaLevel, team: _team, cfg }: AgentCharConfigInput): void {
  const cinema = cinemaLevelOf(cinemaLevel)
  cfg.lucyCinemaLevel = cinema

  const spin = findMove(skills, MOVE_SPIN)
  cfg.lucySpinDmg = rowVal(spin, 'damage')

  // 抄家伙：三段倍率之和作为单次调用总倍率
  const boarDmg =
    rowVal(findMove(skills, MOVE_BOAR_1), 'damage')
    + rowVal(findMove(skills, MOVE_BOAR_2), 'damage')
    + rowVal(findMove(skills, MOVE_BOAR_3), 'damage')
  cfg.lucyBoarComboDmg = boarDmg
}

/** 「cfg + state → 加油循环」的唯一装配（CC-283：buildExecutions 与 buildResourceResult 共用）。 */
function lucyCheerOf(cfg: AgentResourceResultInput['cfg'], state: AgentResourceResultInput['state']) {
  return computeLucyCheer({
    cinemaLevel: cinemaLevelOf(cfg.lucyCinemaLevel),
    exSpecialCount: state.exSpecialCount ?? 0,
    chainCountTotal: state.chainCountTotal ?? 0,
    ultimateCount: state.ultimateCount ?? 0,
    teammateExSpecialTotal: Math.max(0, Math.floor(Number(cfg.lucyTeammateExTotal ?? 0))),
  })
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cheer = lucyCheerOf(cfg, state)

  const spinDmg = Number(cfg.lucySpinDmg ?? 0) || 0
  pushExec(
    executions,
    MOVE_SPIN,
    '亲卫队小猪：回旋挥击！',
    'basic',
    cheer.totalSpins,
    spinDmg,
    `回旋挥击 ×${cheer.totalSpins}（加油 ${cheer.spinsFromCheer}`
      + (cheer.spinsFromC6 > 0 ? ` + C6 ${cheer.spinsFromC6}` : '')
      + '）',
  )

  // 抄家伙：4–6 秒调用一次，每次打出三段倍率之和；后台自动，不占前台时间
  const boarCd = lucyBoarCd(cfg)
  const boarCount = computeLucyBoarCount(state.frontlineTime ?? 0, boarCd)
  const boarDmg = Number(cfg.lucyBoarComboDmg ?? 0) || 0
  pushExec(
    executions,
    MOVE_BOAR_1,
    '亲卫队小猪：抄家伙！',
    'basic',
    boarCount,
    boarDmg,
    `抄家伙 ×${boarCount}（${boarCd}s/次，三段倍率之和）`,
  )

  if (cheer.c6Bombs > 0) {
    pushExec(
      executions,
      MOVE_C6_BOMB,
      '影画6·小猪落地爆炸',
      'basic',
      cheer.c6Bombs,
      C6_BOMB_MULT,
      `C6 落地炸 ×${cheer.c6Bombs}（队友强特次数，300% 攻击力火伤）`,
    )
  }
}

function buildResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const cheer = lucyCheerOf(cfg, state)
  const boarCd = lucyBoarCd(cfg)
  const boarCount = computeLucyBoarCount(state.frontlineTime ?? 0, boarCd)
  return {
    lucyCheer: cheer,
    lucyBoarCount: boarCount,
    lucyBoarCd: boarCd,
    specResources: {
      lucy_cheer: {
        id: 'lucy_cheer',
        name: '加油！触发',
        initialValue: 0,
        maxValue: null,
        totalGain: cheer.cheerTriggers,
        gains: {
          ex: Math.max(0, Math.floor(state.exSpecialCount ?? 0)),
          chain_ult: Math.max(0, cheer.cheerTriggers - Math.max(0, Math.floor(state.exSpecialCount ?? 0))),
        },
        bonusCount: 0,
        total: cheer.cheerTriggers,
        remaining: 0,
        spendCounts: { spin: cheer.totalSpins },
        spendCosts: {},
      },
    },
  }
}

function resourceSections({ result }: AgentResourceSectionsInput) {
  const cheer = result?.lucyCheer
  if (!cheer) return []
  const boarCount = Number(result?.lucyBoarCount ?? 0) || 0
  const boarCd = Number(result?.lucyBoarCd ?? LUCY_BOAR_CD_DEFAULT) || LUCY_BOAR_CD_DEFAULT
  return [{
    id: 'lucy-cheer',
    title: '露西·加油/小猪',
    summary: `加油 ${cheer.cheerTriggers} · 回旋 ${cheer.totalSpins} · 抄家伙 ${boarCount}`
      + (cheer.c6Bombs > 0 ? ` · C6炸 ${cheer.c6Bombs}` : ''),
    rows: [
      { label: '加油触发', value: String(cheer.cheerTriggers), detail: '强特' + (cheer.cheerTriggers > 0 ? '（+2命连携/终结）' : '') },
      { label: '回旋挥击', value: String(cheer.totalSpins), detail: '加油触发 + C6 落地后各 1 次' },
      { label: '抄家伙调用', value: String(boarCount), detail: `前台时间 / ${boarCd}s，三段合计 792.1%` },
      { label: 'C1 全队回能', value: String(cheer.c1EnergyPerMember), detail: '回旋命中全队 +2/次' },
      { label: 'C6 落地炸', value: String(cheer.c6Bombs), detail: '队友强特次数 × 300% 攻' },
    ],
  }]
}

/**
 * 露西 C6「下一轮反馈」（`nextRoundFeedback` 钩子，2026-09-16 arch 棘轮第 6 批自
 * `convergence.ts#computeLucyNextRoundFeedback` 逐字搬入，规则 6）：队友强特合计（→ 下一轮 `applyTeamConfig(converge)` 写 `lucyTeammateExTotal`，影画6 回旋预估用）。
 *
 * 只读结果、只返回线程值，**不写 cfg**（r397 CC-371：钩子输入 `DeepReadonly`，49ecb777「钩子输入只有输出通道可写」；
 * 原先的首轮 cfg 写回是死写——写在 `runCalcRound` 的本轮局部克隆上，所有读者都在钩子之前的资源装配阶段，
 * 写后零读，判死依据见 `docs/mcp-nextround-writeback.md`）。
 * 原先还每轮给全队写 `lucyCheerSpinsEstimate`「回旋预估提示」：唯一读者 `perTargetAmounts` 在钩子**之前**执行 ⇒
 * 恒读到 0、恒走现算分支（与提示同一公式、取本轮 state），连同读取与声明一起删除。
 */
function lucyNextRoundFeedback({ teamResult }: AgentNextRoundFeedbackInput): ModuleFeedback {
  let mateEx = 0
  for (const ch of teamResult.characters) {
    if (ch.agentId !== LUCY_ID) mateEx += ch.exSpecialCount ?? 0
  }
  return { lucyTeammateEx: mateEx }
}

export const lucyMechanic: AgentMechanicModule = {
  crossAgentEnergyLabels: [{ key: 'lucyEnergy', label: '露西回能', detail: '终结邻位 + 影画1 回旋全队' }],  // CC-445
  // 队伍级机制（原先由 useResourceCalc 手工 import + 调用 applyLucyTeamEnergyFlags）：
  // 露西终结邻位回能 + 影画1 回旋全队回能标记。只在 build 阶段动手，与迁移前的调用时机一致。
  applyTeamConfig: ({ cfg, characters, phase, threads }) => {
    if (phase === 'converge') {
      // 2026-09-15 arch 棘轮第 2 批：注入上一轮「队友强特合计（不含自己）」——影画1 回能预估用。
      // 自 `convergence.ts` 的 `merged.agentId === '1151'` 分支搬入（规则 6）。
      if (cfg && threads) {
        cfg.lucyTeammateExTotal = (threads.moduleFeedback?.lucyTeammateEx ?? 0)
      }
      return
    }
    if (phase !== 'build') return
    applyLucyTeamEnergyFlags(cfg, characters)
  },
  /**
   * 跨槽位供给：终结技**邻位回能** + 影画1 回旋全队回能（每次 +2）。
   *
   * 2026-09-15 core 棘轮批次3 自 `core/resource/helpers.ts#calcCrossAgentEnergy` 的
   * `findIndex(c => c.agentId === '1151')` 迁出（规则 6）。原逻辑两段：① 邻位回能
   * （下一位 30 / 上一位 10）× 露西终结技次数；② 影画1 门控下 `spinEst × 2` 给**全队每人**
   * （故 perTargetAmounts 对每个非自己槽位都加同一份 spinEst×2）。
   *
   * `spinEst` = 1 命基础 + 影画2（＋连携＋终结）+ 影画6（＋队友强特合计 `lucyTeammateExTotal`，converge 注入），
   * 读**露西自己的 cfg** + 本轮 state 现算（r397 CC-371 删掉了恒为 0 的 `lucyCheerSpinsEstimate` 优先分支）。
   */
  crossAgentSupply: {
    kind: 'neighbor-ult-energy',
    displayKey: 'lucyEnergy',
    supply: () => 0,
    perTargetAmounts: ({ ownSlot, teamSize, cfg, state }) => {
      const slots = Array.from({ length: teamSize }, (_, i) => i)
      const ults = Math.max(0, Math.floor(state.ultimateCount ?? 0))
      const out = ultNeighborPerTargetAmounts(ownSlot, teamSize, state.ultimateCount)
      // 影画1 回旋全队回能：每个非自己槽位都得同一份
      if (Number(cfg.lucyC1Enabled ?? 0) > 0) {
        const cinema = cinemaLevelOf(cfg.lucyCinemaLevel)
        const spinEst = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
          + (cinema >= 2 ? Math.max(0, Math.floor(state.chainCountTotal ?? 0)) + ults : 0)
          + (cinema >= 6 ? Math.max(0, Number(cfg.lucyTeammateExTotal ?? 0)) : 0)
        // ⚠ C1 回旋回能是**全队每人**（含露西自己）——迁移前原式无条件 `lucyEnergy += spinEst*2`，
        // 与上面「邻位回能不给提供者自己」不同。第一版我照邻位习惯跳过自己 ⇒ timeGolden 红
        // （agent:1151:c6.slot0）。逐位保留原语义。
        for (const s of slots) out[s] = (out[s] ?? 0) + spinEst * 2
      }
      return out
    },
  },
  id: 'agent:lucy',
  agentIds: [LUCY_ID],
  name: '露西·加油/小猪',
  description: '终结邻位回能；加油触发回旋挥击；抄家伙按冷却周期调用；影画1/2/6 回能与落地炸附伤。',
  settings: [{
    id: 'lucy.boarCd',
    label: '露西·抄家伙调用冷却',
    description: '亲卫队小猪：抄家伙！每 4–6 秒调用一次（三段合计 792.1%），默认按最快的 4 秒计。',
    default: LUCY_BOAR_CD_DEFAULT,
    min: LUCY_BOAR_CD_MIN,
    max: LUCY_BOAR_CD_MAX,
    step: 0.5,
    suffix: '秒',
  }],
  buildCharConfig,
  buildExecutions,
  buildResourceResult,
  resourceSections,
  nextRoundFeedback: lucyNextRoundFeedback,
}

/** 组队后写入各槽位：C1 标记与命座（邻位回能走 crossAgentSupply；原 lucyEnergyPerLucyUlt 写入从无读取方，CC-191 删） */
function applyLucyTeamEnergyFlags(lucy: CharacterOperationConfig, characters: CharacterOperationConfig[]): void {
  // （CC-383：本人 = 派发器给的 `cfg`；派发器只对在队模块、按 cfg.agentId 取模块调用，不再在 characters 里自找）
  const cinema = cinemaLevelOf(lucy.lucyCinemaLevel)
  for (const c of characters) {
    c.lucyC1Enabled = cinema >= 1 ? 1 : 0
    c.lucyCinemaLevel = cinema
  }
  // 队友强特合计（收敛时 iterate 用 prev；执行层用最终 state，先占位 0，useResourceCalc 注入）
  lucy.lucyTeammateExTotal = lucy.lucyTeammateExTotal ?? 0
}


/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
/**
 * r406：本模块 `buildResourceResult` 写、`resourceSections` 等读的结果字段（模块扩充，纯类型、零运行时）。
 * 此前未声明 ⇒ 写端无类型、读端 `as any`，拼错键两头都不报错。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 露西加油循环明细 */
    lucyCheer?: LucyCheerResult
    /** 露西野猪次数 */
    lucyBoarCount?: number
    /** 露西野猪 CD（秒） */
    lucyBoarCd?: number
  }
}

declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 露西命座等级（buildCharConfig 写） */
    lucyCinemaLevel?: number
    /** 露西旋转攻击伤害倍率（buildCharConfig 从倍率表预存） */
    lucySpinDmg?: number
    /** 露西野猪连击伤害倍率（buildCharConfig 预存） */
    lucyBoarComboDmg?: number
    /** 露西影画1：回旋挥击全队回能标记 */
    lucyC1Enabled?: number
    /** 露西：队友强特合计（编排注入） */
    lucyTeammateExTotal?: number
  }
}

/**
 * D2（CC-359/360）：本模块自产自读的跨轮反馈键（nextRoundFeedback 产出、下一轮本模块读回），声明随模块走，不堆在 `mechanics/types.ts`。
 * 仍是 `ModuleFeedback` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/mechanics/types' {
  interface ModuleFeedback {
    /** 露西 C6 队友强特合计（C1 回能预估） */
    lucyTeammateEx?: number
  }
}
