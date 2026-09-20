/* 安东（1111）机制模块。
 * 用户确认口径：核心打桩+24%、电钻+40%按 catalog 执行 moveId；C1 每个实际电钻招式额外回能最多5点并进入能量总账；C2 护盾不进伤害；C3/C5 通用技能等级**由通用规则建模、本模块不写**（R62 订正双计，见下方长注释）；C4 全队暴击+10%（spec teamBuffs，source 影画四自动门控）；C6 仅爆发普攻与爆发闪反，24%满层增伤默认全覆盖。
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

// ⚠⚠ **R62 订正：本文件原有 `applyPanel` 钩子，只做「3/5 命技能等级 +2/+4」——那是第二写者 ⇒ 双计。**
//
// 通用规则 `panelPhases.ts#computePanelPhases:658`（及 `:711` 的第二站点）已**无条件**给所有角色写
// `panel.skillLevelBonus = cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0`；唯一豁免条件
// `agentHasCinemaSkillLevelBuff(agent)` **只查 catalog `combatBuffs.cinemaBuffs[].buff.effects[]`
// 里有没有 `stat === 'skillLevelBonus'`**。安东 catalog 的 C3/C5 两条 cinemaBuffs 的
// **`effects` 是空数组**（描述文本写了「技能等级+2」，但没有 effect 对象）⇒ 豁免不成立 ⇒ 通用规则照给
// ⇒ 同一件事被写两遍。
//
// 实测（R62 真管线 `{1111, 1211, ''}`；`skillLevelBonus` 读 `computePanelPhases(0).inCombat`，
// `dmg` 读真 `useResourceCalc().teamTotalDamage`；隔离 worktree @ `3db9b32`）：
//
// | 影画 | 修复前 slb | 技能等级 | damageCoef | 正确 slb/等级 | 修复前 dmg | 修复后 dmg | delta |
// |---|---|---|---|---|---|---|---|
// | c0/c2 | 0 | 12 | 1.0000 | 0 / 12 | 1,138,683 | 同 | 0 |
// | c3/c4 | **4** | **16** | **1.1818** | 2 / 14 | 1,211,521 | 1,175,102 | — |
// | c5/c6 | **8** | **20** | **1.3636** | 4 / 16 | 1,478,935 | 1,264,475 | — |
//
// `core/skillLevel.ts` 头注释明确只有三档 **12 / 14 / 16**（「16（5命以上）」是**上界**）
// ⇒ C3 起就吃到 C5 满档、C5 起技能等级 **20 超上界**。副作用：**C5→C6 伤害 delta 因封顶恒 0**
//（双计把 C6 顶到上界之上）⇒ **端到端完全看不见这条缺陷** —— 这正是「边界差一」形态的隐蔽处。
// 时间金标 delta（隔离 worktree，改动前 == pristine 快照）：**4 条全纯伤害、全 1111**
// （c3 -7.436% / c4 -7.447% / c5 -12.963% / c6 -12.963%），**时间账零变化**。
//
// 正解 = **删掉该钩子**（同 `piper.ts` 头注释 ⑤「影画3/5 技能等级 +2/+4 已由通用规则建模，
// 模块不重复实现」）。**不是**给 catalog 补 `effects` —— 那会让 `collectAgentBuffs` 的 `applyStat`
// 通道再写一遍，仍然是两个写者。
//
// @fact agent:1111/影画3-5 口径: 影画3「技能等级+2」与影画5「技能等级+2」**只由通用规则** `computePanelPhases` 写入 `panel.skillLevelBonus`（c3=2 / c5=4 ⇒ 技能等级 14/16，上界 16）；`anton.ts` **不得**再写该字段（曾双计致 c3=4 / c5=8、技能等级 20 超上界，R62 订正） | 据 raw talent.3/talent.5 desc 逐字「技能等级+2」@2026-09-20 + 用户确认口径@2026-08 | 验 src/mechanics/__tests__/cinemaAxisBatchR62.test.ts | 锚 src/mechanics/agents/anton.ts#ANTON_ID | 信 确认
// ⟳复核: 跑 `npx vitest run cinemaAxisBatchR62` —— 若 c3/c5 的 skillLevelBonus 又变回 4/8（或 `agentHasCinemaSkillLevelBuff` 被改成认「描述文本」而安东 catalog 补了 effects），说明双计回来了 | 到期 2027-03-31

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
  description: '精确执行行增伤、C1回能总账、C6爆发招式增伤、额外能力感电追加（release 45% 感电倍率）。C3/C5 技能等级由通用规则建模，本模块不写（R62 订正双计）。',
  settings: [
    { id: 'anton.additionalShockRatio', label: '感电追加触发率', description: '额外能力·通力合作：爆发状态内每4次暴击触发一次感电追加的触发率（含暴击率折算；安东在感电队默认满触发）', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
  ],
  buildCharConfig: ({ cfg, cinemaLevel }) => setRecord(cfg, 'antonCinemaLevel', cinemaLevel),
  patchExecutions,
  buildAnomalyEvents: buildAntonAnomalyEvents,
}

export default antonMechanic
