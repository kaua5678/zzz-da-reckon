/* 安东（1111）机制模块。
 * 用户确认口径：核心打桩+24%、电钻+40%按 catalog 执行 moveId；C1 每个实际电钻招式额外回能最多5点并进入能量总账；C2 护盾不进伤害；C3/C5 通用技能等级；C4 按（连携次数+终结次数）×12/战斗时间估算覆盖率，默认全队暴击+10%；C6 仅爆发普攻与爆发闪反，24%满层增伤默认全覆盖；额外能力感电追加默认0次，显式次数入口保留，异常复制安全接口待定。
 */
import type { AgentMechanicModule, AgentPanelInput, AgentResourceInput } from '../types'

export const ANTON_ID = '1111'

// catalog.json 的实际执行行：full 原始 1111001/2/3/4/5 等不可直接用于消费者匹配。
export const ANTON_PILE_MOVE_IDS = new Set(['1111006', '1111007', '1111008'])
export const ANTON_DRILL_MOVE_IDS = new Set(['1111010', '1111015', '1111019'])
export const ANTON_C6_MOVE_IDS = new Set(['1111006', '1111007', '1111008', '1111015'])
const ANTON_CORE_PILE_BONUS = 24
const ANTON_CORE_DRILL_BONUS = 40
const ANTON_C6_BONUS = 24
const ANTON_C1_MAX_PER_MOVE = 5

function setRecord(cfg: AgentPanelInput['panel'] | AgentResourceInput['cfg'], key: string, value: unknown) {
  ;(cfg as unknown as Record<string, unknown>)[key] = value
}

function applyPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  if (cinemaLevel >= 3) panel.skillLevelBonus = (panel.skillLevelBonus ?? 0) + 2
  if (cinemaLevel >= 5) panel.skillLevelBonus = (panel.skillLevelBonus ?? 0) + 2
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).antonCinemaLevel ?? 0)))
  let c1Energy = 0
  let c1Moves = 0
  for (const exec of executions) {
    const moveId = exec.moveId
    if (!moveId) continue
    if (ANTON_PILE_MOVE_IDS.has(moveId)) exec.dmgBonus = (exec.dmgBonus ?? 0) + ANTON_CORE_PILE_BONUS
    if (ANTON_DRILL_MOVE_IDS.has(moveId)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + ANTON_CORE_DRILL_BONUS
      if (cinema >= 1) {
        c1Moves += Math.max(0, exec.count)
        c1Energy += Math.min(ANTON_C1_MAX_PER_MOVE, ANTON_C1_MAX_PER_MOVE * Math.max(0, exec.count))
      }
    }
    if (cinema >= 6 && ANTON_C6_MOVE_IDS.has(moveId)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + ANTON_C6_BONUS
    }
  }
  // 进入 calcEnergySource 的单一总账；不按 hit 放大，按实际执行招式计一次上限。
  setRecord(cfg, 'antonC1EnergyGift', c1Energy)
  setRecord(cfg, 'antonC1DrillMoveCount', c1Moves)
  setRecord(cfg, 'antonAdditionalShockCount', Math.max(0, Number((cfg as any).antonAdditionalShockCount ?? 0)))
}

export const antonMechanic: AgentMechanicModule = {
  id: 'agent:anton',
  agentIds: [ANTON_ID],
  name: '安东·兄弟齐心',
  description: '精确执行行增伤、C1回能总账、C3/C5技能等级与C6爆发招式增伤。',
  applyPanel,
  buildCharConfig: ({ cfg, cinemaLevel }) => setRecord(cfg, 'antonCinemaLevel', cinemaLevel),
  patchExecutions,
}

export default antonMechanic
