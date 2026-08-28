/**
 * 苍角（1131）—— 整局近似口径
 *
 * 拐力（teammate-buffs）
 * - 核心·刃旗助威：展旗（默认耗涡流翻倍）→ 全队攻击 初始攻×40% 顶 1000
 *   （文本为自身+入场者传递；整局按全队满覆盖近似，与现有草稿一致）
 * - 额外能力（同属性或同阵营）：耗涡流展旗 → 全队冰伤 +20%
 * - 影画4：展旗命中 → 冰抗 -10%
 *
 * 模块
 * - 影画1：增益时长 +8s → 仅延长覆盖，默认已满覆盖，无额外数值
 * - 影画2：命中概率叠涡流 / 满层转回能 — 不逐帧；略过（标注近似）
 * - 影画3/5：通用技能等级
 * - 影画6：霜染刃旗强化普攻/冲刺次数上限 12、伤害 +45% → 强化段执行级 dmgBonus +45%
 * - 终结技：其他角色 +10 能量，下一位换入额外 +20 → 邻位 30/10（同露西/丽娜）
 *
 * 未建模：涡流层数状态机、展旗触发快支时间轴、霜染 6/12 次次数上限循环。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
} from '../types'
import type { CharacterOperationConfig } from '@/types/resource'

export const SOUKAKU_ID = '1131'

/** 霜染刃旗强化普攻 #1–#3 + 强化冲刺 */
export const SOUKAKU_FROST_MOVE_IDS = new Set([
  '1131004', '1131005', '1131006', '1131016',
])

export const SOUKAKU_C6_DMG_BONUS = 45
export const SOUKAKU_C2_ENERGY_PER_TRIGGER = 1.2

/**
 * 终结技邻位回能：三人下一位 30 / 上一位 10；两人另一位 30。
 */
export function assignSoukakuUltNeighborEnergy(
  slots: number[],
  soukakuSlot: number,
): Record<number, number> {
  const out: Record<number, number> = {}
  const others = slots.filter(s => s !== soukakuSlot)
  if (others.length === 0) return out
  if (others.length === 1) {
    out[others[0]] = 30
    return out
  }
  const ordered = [...slots].sort((a, b) => a - b)
  const idx = ordered.indexOf(soukakuSlot)
  const next = ordered[(idx + 1) % ordered.length]
  const prev = ordered[(idx - 1 + ordered.length) % ordered.length]
  out[next] = 30
  out[prev] = 10
  return out
}

export function applySoukakuTeamEnergyFlags(characters: CharacterOperationConfig[]): void {
  const sk = characters.find(c => c.agentId === SOUKAKU_ID)
  if (!sk) return
  const energy = assignSoukakuUltNeighborEnergy(
    characters.map(c => c.slot),
    sk.slot,
  )
  for (const ch of characters) {
    ;(ch as any).soukakuEnergyPerSoukakuUlt = energy[ch.slot] ?? 0
  }
  ;(sk as any).soukakuCinemaLevel = (sk as any).soukakuCinemaLevel
    ?? Number((sk as any).soukakuCinemaLevel ?? 0)
}

function buildCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.soukakuCinemaLevel = cinemaLevel ?? 0
  // 影画2 满层转回能：涡流满层后再获得涡流 → 回复 1.2 能量。逐帧概率/涡流状态机未建模，
  // 按可调触发次数注入能量池（默认 5 次，用户按实际对局调整）。
  if ((cinemaLevel ?? 0) >= 2) {
    const count = Math.max(0, Math.floor(Number((cfg as any)['setting:soukaku.c2RefundCount'] ?? 5)))
    record.soukakuC2RefundCount = count
    cfg.initialEnergyGift = Number(cfg.initialEnergyGift ?? 0) + SOUKAKU_C2_ENERGY_PER_TRIGGER * count
  }
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).soukakuCinemaLevel ?? 0)))
  if (cinema < 6) return
  for (const exec of executions) {
    if (!exec.moveId || !SOUKAKU_FROST_MOVE_IDS.has(exec.moveId)) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + SOUKAKU_C6_DMG_BONUS
    exec.skillTableNote =
      `${exec.skillTableNote ?? ''}；影画6 霜染强化段伤害 +${SOUKAKU_C6_DMG_BONUS}%`
  }
}

export const soukakuMechanic: AgentMechanicModule = {
  // 队伍级机制（原先由 useResourceCalc 手工 import + 调用 applySoukakuTeamEnergyFlags）：
  // 苍角终结技邻位回能（邻位 30/10）。只在 build 阶段动手，与迁移前的调用时机一致。
  applyTeamConfig: ({ characters, phase }) => {
    if (phase !== 'build') return
    applySoukakuTeamEnergyFlags(characters)
  },
  id: 'agent:soukaku',
  agentIds: [SOUKAKU_ID],
  name: '苍角·刃旗助威',
  description: '展旗攻击拐、额外冰伤、影画2满层回能、影画4减抗、影画6霜染增伤、终结邻位回能。',
  settings: [
    {
      id: 'soukaku.c2RefundCount',
      label: '影画2满层回能次数',
      description: '涡流满层后再获得涡流 → 回复 1.2 能量的触发次数（逐帧概率/涡流状态机未建模，按次数近似）；默认 5 次',
      default: 5,
      min: 0,
      max: 30,
      step: 1,
      suffix: '次',
    },
  ],
  buildCharConfig,
  patchExecutions,
}

export default soukakuMechanic
