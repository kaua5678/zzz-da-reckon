/**
 * 露西（1151）—— 用户确认口径
 *
 * 拐力：加油！攻击公式 + 影画4 暴伤（spec teamBuffs）。
 * 终结技回能：下一位 +30、前一位 +10（两人队则另一人 +30）。
 * 加油触发：强特；影画2 连携/终结也触发 → 每次触发 回旋挥击(1151026)。
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
import { fmt } from '@/utils/format'

export const LUCY_ID = '1151'
const MOVE_SPIN = '1151026' // 亲卫队小猪：回旋挥击！
const MOVE_C6_BOMB = '1151_c6_pig_bomb'
const C6_BOMB_MULT = 300

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

function buildCharConfig({ skills, cinemaLevel, team, cfg }: AgentCharConfigInput): void {
  const cinema = cinemaLevel ?? 0
  const record = cfg as unknown as Record<string, unknown>
  record.lucyCinemaLevel = cinema

  const spin = findMove(skills, MOVE_SPIN)
  record.lucySpinDmg = rowVal(spin, 'damage')

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
  return {
    lucyCheer: cheer,
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
  return [{
    id: 'lucy-cheer',
    title: '露西·加油/小猪',
    summary: `加油 ${cheer.cheerTriggers} · 回旋 ${cheer.totalSpins}`
      + (cheer.c6Bombs > 0 ? ` · C6炸 ${cheer.c6Bombs}` : ''),
    rows: [
      { label: '加油触发', value: String(cheer.cheerTriggers), detail: '强特' + (cheer.cheerTriggers > 0 ? '（+2命连携/终结）' : '') },
      { label: '回旋挥击', value: String(cheer.totalSpins), detail: '加油触发 + C6 落地后各 1 次' },
      { label: 'C1 全队回能', value: String(cheer.c1EnergyPerMember), detail: '回旋命中全队 +2/次' },
      { label: 'C6 落地炸', value: String(cheer.c6Bombs), detail: '队友强特次数 × 300% 攻' },
    ],
  }]
}

export const lucyMechanic: AgentMechanicModule = {
  id: 'agent:lucy',
  agentIds: [LUCY_ID],
  name: '露西·加油/小猪',
  description: '终结邻位回能；加油触发回旋挥击；影画1/2/6 回能与落地炸附伤。',
  buildCharConfig,
  buildExecutions,
  buildResourceResult,
  resourceSections,
}

/** 组队后写入各槽位：每大从露西获得的能量、C1 标记 */
export function applyLucyTeamEnergyFlags(characters: CharacterOperationConfig[]): void {
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
