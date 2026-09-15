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
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterOperationConfig, SkillExecution } from '@/types/resource'

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

function findMove(skills: AgentSkills | undefined, id: string): SkillMove | null {
  if (!skills) return null
  for (const c of skills.categories) {
    const m = c.moves.find(x => x.id === id)
    if (m) return m
  }
  return null
}

function rowVal(move: SkillMove | null | undefined, rowId: string): number {
  const row = move?.rows?.find(r => r.id === rowId)
  const vals = row?.values ?? []
  if (!vals.length) return 0
  return Number(vals[11] ?? vals[vals.length - 1] ?? 0) || 0
}

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
  const cinema = Math.max(0, Math.floor(input.cinemaLevel || 0))
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

/**
 * 邻位回能分配（用户口径）：
 * - 3 人：下一位 +30/大，前一位 +10/大
 * - 2 人：另一人 +30/大（其他10 + 换入额外20）
 */
export function assignLucyUltNeighborEnergy(
  slots: number[],
  lucySlot: number,
): Record<number, number> {
  const out: Record<number, number> = {}
  const others = slots.filter(s => s !== lucySlot)
  if (others.length === 0) return out
  if (others.length === 1) {
    out[others[0]] = 30
    return out
  }
  // 环绕：按槽位排序找邻位
  const ordered = [...slots].sort((a, b) => a - b)
  const idx = ordered.indexOf(lucySlot)
  const next = ordered[(idx + 1) % ordered.length]
  const prev = ordered[(idx - 1 + ordered.length) % ordered.length]
  out[next] = 30
  out[prev] = 10
  return out
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
  executions.push({
    moveId,
    moveName,
    category,
    count,
    actionTime,
    comboAlignRatio: 0,
    totalTime: 0,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: dmg,
    damageMultiplierOverride: true,
    element: 'fire',
    skillTableNote: note,
  } as SkillExecution)
}

function cfgNum(cfg: CharacterOperationConfig, key: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record[`setting:${key}`] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

/** 抄家伙调用冷却（秒），钳制到 4–6；缺省 4 */
export function lucyBoarCd(cfg: CharacterOperationConfig): number {
  const raw = cfgNum(cfg, 'lucy.boarCd', LUCY_BOAR_CD_DEFAULT)
  return Math.max(LUCY_BOAR_CD_MIN, Math.min(LUCY_BOAR_CD_MAX, raw))
}

/** 抄家伙调用次数 = floor(前台时间 / cd)；后台自动不占前台时间 */
export function computeLucyBoarCount(frontlineTime: number, cd: number): number {
  const t = Math.max(0, Number(frontlineTime) || 0)
  const c = Math.max(0.1, Number(cd) || LUCY_BOAR_CD_DEFAULT)
  return Math.floor(t / c)
}

function buildCharConfig({ skills, cinemaLevel, team: _team, cfg }: AgentCharConfigInput): void {
  const cinema = cinemaLevel ?? 0
  const record = cfg as unknown as Record<string, unknown>
  record.lucyCinemaLevel = cinema

  const spin = findMove(skills, MOVE_SPIN)
  record.lucySpinDmg = rowVal(spin, 'damage')

  // 抄家伙：三段倍率之和作为单次调用总倍率
  const boarDmg =
    rowVal(findMove(skills, MOVE_BOAR_1), 'damage')
    + rowVal(findMove(skills, MOVE_BOAR_2), 'damage')
    + rowVal(findMove(skills, MOVE_BOAR_3), 'damage')
  record.lucyBoarComboDmg = boarDmg

  // 邻位回能标记写在全队 cfg 上（由 useResourceCalc 在组队后调用 applyLucyTeamEnergyFlags）
  record.lucyIsLucy = true
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.lucyCinemaLevel ?? 0)))
  const mateEx = Math.max(0, Math.floor(Number(record.lucyTeammateExTotal ?? 0)))
  const cheer = computeLucyCheer({
    cinemaLevel: cinema,
    exSpecialCount: state.exSpecialCount ?? 0,
    chainCountTotal: state.chainCountTotal ?? 0,
    ultimateCount: state.ultimateCount ?? 0,
    teammateExSpecialTotal: mateEx,
  })
  record.lucyCheer = cheer

  const spinDmg = Number(record.lucySpinDmg ?? 0) || 0
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
  const boarDmg = Number(record.lucyBoarComboDmg ?? 0) || 0
  record.lucyBoarCount = boarCount
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

function buildResourceResult({ cfg, state }: AgentResourceResultInput) {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.lucyCinemaLevel ?? 0)))
  const mateEx = Math.max(0, Math.floor(Number(record.lucyTeammateExTotal ?? 0)))
  const cheer = computeLucyCheer({
    cinemaLevel: cinema,
    exSpecialCount: state.exSpecialCount ?? 0,
    chainCountTotal: state.chainCountTotal ?? 0,
    ultimateCount: state.ultimateCount ?? 0,
    teammateExSpecialTotal: mateEx,
  })
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
  const cheer = (result as any)?.lucyCheer as LucyCheerResult | undefined
  if (!cheer) return []
  const boarCount = Number((result as any)?.lucyBoarCount ?? 0) || 0
  const boarCd = Number((result as any)?.lucyBoarCd ?? LUCY_BOAR_CD_DEFAULT) || LUCY_BOAR_CD_DEFAULT
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

export const lucyMechanic: AgentMechanicModule = {
  // 队伍级机制（原先由 useResourceCalc 手工 import + 调用 applyLucyTeamEnergyFlags）：
  // 露西终结邻位回能 + 影画1 回旋全队回能标记。只在 build 阶段动手，与迁移前的调用时机一致。
  applyTeamConfig: ({ slot, characters, phase, threads }) => {
    if (phase === 'converge') {
      // 2026-09-15 arch 棘轮第 2 批：注入上一轮「队友强特合计（不含自己）」——影画1 回能预估用。
      // 自 `convergence.ts` 的 `merged.agentId === '1151'` 分支搬入（规则 6）。
      const cfg = characters[slot]
      if (cfg && threads) {
        ;(cfg as unknown as Record<string, unknown>).lucyTeammateExTotal = threads.lucyTeammateEx
      }
      return
    }
    if (phase !== 'build') return
    applyLucyTeamEnergyFlags(characters)
  },
  /**
   * 跨槽位供给：终结技**邻位回能** + 影画1 回旋全队回能（每次 +2）。
   *
   * 2026-09-15 core 棘轮批次3 自 `core/resource/helpers.ts#calcCrossAgentEnergy` 的
   * `findIndex(c => c.agentId === '1151')` 迁出（规则 6）。原逻辑两段：① 邻位回能
   * （下一位 30 / 上一位 10）× 露西终结技次数；② 影画1 门控下 `spinEst × 2` 给**全队每人**
   * （故 perTargetAmounts 对每个非自己槽位都加同一份 spinEst×2）。
   *
   * `spinEst` 的取值优先级逐位保留原实现：`lucyCheerSpinsEstimate`（上一轮线程写入的估计值）
   * >0 时优先；否则按 1 命基础 + 影画2（＋连携＋终结）+ 影画6（＋队友强特合计）现算。
   * 这三个字段都写在**露西自己的 cfg** 上（本模块 `applyLucyTeamEnergyFlags` 与 converge 注入）。
   */
  crossAgentSupply: {
    kind: 'neighbor-ult-energy',
    displayKey: 'lucyEnergy',
    supply: () => 0,
    perTargetAmounts: ({ ownSlot, teamSize, cfg, state }) => {
      const rec = cfg as unknown as Record<string, unknown>
      const slots = Array.from({ length: teamSize }, (_, i) => i)
      const ults = Math.max(0, Math.floor(state.ultimateCount ?? 0))
      const per = assignLucyUltNeighborEnergy(slots, ownSlot)
      const out: Record<number, number> = {}
      for (const [slot, amount] of Object.entries(per)) out[Number(slot)] = amount * ults
      // 影画1 回旋全队回能：每个非自己槽位都得同一份
      if (Number(rec.lucyC1Enabled ?? 0) > 0) {
        const hint = Math.max(0, Number(rec.lucyCheerSpinsEstimate ?? 0))
        const cinema = Math.max(0, Math.floor(Number(rec.lucyCinemaLevel ?? 0)))
        const spinEst = hint > 0
          ? hint
          : Math.max(0, Math.floor(state.exSpecialCount ?? 0))
            + (cinema >= 2 ? Math.max(0, Math.floor(state.chainCountTotal ?? 0)) + ults : 0)
            + (cinema >= 6 ? Math.max(0, Number(rec.lucyTeammateExTotal ?? 0)) : 0)
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
}

/** 组队后写入各槽位：每大从露西获得的能量、C1 标记 */
function applyLucyTeamEnergyFlags(characters: CharacterOperationConfig[]): void {
  const lucy = characters.find(c => c.agentId === LUCY_ID)
  if (!lucy) return
  const cinema = Math.max(0, Math.floor(Number((lucy as any).lucyCinemaLevel ?? 0)))
  const slots = characters.map(c => c.slot)
  const neigh = assignLucyUltNeighborEnergy(slots, lucy.slot)
  for (const c of characters) {
    const rec = c as unknown as Record<string, unknown>
    rec.lucyEnergyPerLucyUlt = neigh[c.slot] ?? 0
    rec.lucyC1Enabled = cinema >= 1 ? 1 : 0
    rec.lucyCinemaLevel = cinema
  }
  // 队友强特合计（收敛时 iterate 用 prev；执行层用最终 state，先占位 0，useResourceCalc 注入）
  ;(lucy as any).lucyTeammateExTotal = (lucy as any).lucyTeammateExTotal ?? 0
}

export default lucyMechanic
