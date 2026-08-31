/* 安东（1111）机制模块。
 * 用户确认口径：核心打桩+24%、电钻+40%按 catalog 执行 moveId；C1 每个实际电钻招式额外回能最多5点并进入能量总账；C2 护盾不进伤害；C3/C5 通用技能等级；C4 按（连携次数+终结次数）×12/战斗时间估算覆盖率，默认全队暴击+10%；C6 仅爆发普攻与爆发闪反，24%满层增伤默认全覆盖。
 * 额外能力·通力合作（同属性/同阵营门控，2026-08-31 接入）：爆发状态下每触发4次暴击，下次攻击命中感电敌人额外结算一次 45% 感电伤害（0.5s ICD 总量口径下不约束）。
 *   触发次数 = 爆发状态内暴击次数/4 × 触发率滑块（anton.additionalShockRatio，默认100% 用户口径）；
 *   结算为 release 事件（element=electric 固定 45% 感电倍率，倍率基准=感电施加者的感电伤害）。
 */
import type { AgentEventInput, AgentMechanicModule, AgentPanelInput, AgentResourceInput } from '../types'
import type { AnomalyEventExecution } from '../../types/resource'

export const ANTON_ID = '1111'

// catalog.json 的实际执行行：full 原始 1111001/2/3/4/5 等不可直接用于消费者匹配。
export const ANTON_PILE_MOVE_IDS = new Set(['1111006', '1111007', '1111008'])
export const ANTON_DRILL_MOVE_IDS = new Set(['1111010', '1111015', '1111019'])
export const ANTON_C6_MOVE_IDS = new Set(['1111006', '1111007', '1111008', '1111015'])
const ANTON_CORE_PILE_BONUS = 24
const ANTON_CORE_DRILL_BONUS = 40
const ANTON_C6_BONUS = 24
const ANTON_C1_MAX_PER_MOVE = 5
/** 额外能力·通力合作：每 4 次暴击触发一次感电追加，额外结算 45% 感电伤害 */
export const ANTON_ADDITIONAL_SHOCK_RATIO = 45
export const ANTON_ADDITIONAL_SHOCK_CRIT_DIVISOR = 4

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
      c1Moves += Math.max(0, exec.count)
      if (cinema >= 1) {
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
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function cfgSetting(cfg: AgentResourceInput['cfg'], id: string): number {
  const value = (cfg as unknown as Record<string, unknown>)[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 额外能力·通力合作：爆发状态内暴击次数 → 感电追加 release 事件（固定 45% 感电倍率）。
 * 暴击次数未知（引擎无逐 hit 暴击计数）→ 用爆发状态执行行的命中次数近似：电钻/打桩行都在爆发状态内。 */
function buildAntonAnomalyEvents({ cfg, events }: AgentEventInput): void {
  const ratio = clampRatio(cfgSetting(cfg, 'anton.additionalShockRatio') || 1)
  if (ratio <= 0) return
  const additionalActive = (cfg.panel.additionalAbilityActive ?? 0) > 0
  if (!additionalActive) return
  // 爆发状态内的攻击次数近似：安东整局的电钻+打桩执行行（爆发状态是安东输出主形态）
  const burstHits = Number((cfg as any).antonC1DrillMoveCount ?? 0)
  const count = Math.floor(burstHits / ANTON_ADDITIONAL_SHOCK_CRIT_DIVISOR * ratio)
  if (count <= 0) return
  events.push({
    eventId: 'anton_additional_shock_release',
    eventName: '通力合作·感电追加',
    eventType: 'release',
    element: 'electric',
    count,
    formula: `releaseMultiplier = 感电单次伤害 × ${ANTON_ADDITIONAL_SHOCK_RATIO}%（每${ANTON_ADDITIONAL_SHOCK_CRIT_DIVISOR}次暴击触发一次，触发率 ${(ratio * 100).toFixed(0)}%）`,
    fields: ['anton.additionalShockRatio', 'antonC1DrillMoveCount'],
    note: '额外结算一次感电伤害，效果等同于原本的45%；0.5秒ICD按总量口径不约束；爆发状态暴击次数按电钻/打桩命中数近似（滑块吸收暴击率与覆盖率）',
  } satisfies AnomalyEventExecution)
}

export const antonMechanic: AgentMechanicModule = {
  id: 'agent:anton',
  agentIds: [ANTON_ID],
  name: '安东·兄弟齐心',
  description: '精确执行行增伤、C1回能总账、C3/C5技能等级、C6爆发招式增伤、额外能力感电追加（release 45% 感电倍率）。',
  settings: [
    { id: 'anton.additionalShockRatio', label: '感电追加触发率', description: '额外能力·通力合作：爆发状态内每4次暴击触发一次感电追加的触发率（含暴击率折算；安东在感电队默认满触发）', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
  ],
  applyPanel,
  buildCharConfig: ({ cfg, cinemaLevel }) => setRecord(cfg, 'antonCinemaLevel', cinemaLevel),
  patchExecutions,
  buildAnomalyEvents: buildAntonAnomalyEvents,
}

export default antonMechanic
