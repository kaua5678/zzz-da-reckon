/**
 * 照（1341）—— 整局近似口径
 *
 * 原文来源：data/raw/nanoka_1341_zh.json（Nanoka zh，抓于 2026-08-19）。
 * - 核心 Lv.12：每 1000 点初始最大生命值提高 1.4% 暴击率；影画6 将该效果提升至 125%。
 * - 影画2：生命回复触发后，自身攻击 +20%（50 秒，整局按满覆盖）。
 * - 影画4：开启帷幕获得 250 喧响；终结技、连携技、最终裁决暴伤 +40%。
 *
 * 近似：进场 100 霜寒值可直接开启一次帷幕，影画4 的 250 喧响按开局一次性赠送。
 * 未建模：霜寒值后续积攒与重复开帷幕；影画6 最终裁决蓄力附伤 ×140% 及蓄力时长不消耗
 * （catalog 仅有 140.1% 攻击力本体，缺少蓄力时长池与生命附伤执行，禁止误乘本体倍率）。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
} from '../types'

export const ZHAO_ID = '1341'
export const ZHAO_CORE_CRIT_PER_1000_HP = 1.4
export const ZHAO_C6_CORE_MULTIPLIER = 1.25
export const ZHAO_C2_SELF_ATK_PCT = 20
export const ZHAO_C4_DECIBEL = 250
export const ZHAO_C4_CRIT_DMG = 40

export const ZHAO_C4_MOVE_IDS = new Set([
  '1341008', // 普通攻击：最终裁决
  '1341013', // 连携技：临时合作
  '1341014', // 终结技：兔兔连斩 #1
  '1341023', // 终结技：兔兔连斩 #2
])

function applyPanel({ cinemaLevel, outOfCombatPanel, panel }: AgentPanelInput): void {
  const hp = Math.max(0, Number(outOfCombatPanel.hp ?? 0))
  const coreMultiplier = cinemaLevel >= 6 ? ZHAO_C6_CORE_MULTIPLIER : 1
  const coreCritRate = hp / 1000 * ZHAO_CORE_CRIT_PER_1000_HP * coreMultiplier
  panel.critRate = (panel.critRate ?? 0) + coreCritRate
  panel.zhaoCoreCritRate = coreCritRate

  if (cinemaLevel >= 2) {
    const selfAtkBonus = Math.max(0, Number(outOfCombatPanel.atk ?? 0)) * ZHAO_C2_SELF_ATK_PCT / 100
    panel.atk = (panel.atk ?? 0) + selfAtkBonus
    panel.zhaoCinema2SelfAtk = selfAtkBonus
  }
}

function buildCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.zhaoCinemaLevel = cinemaLevel ?? 0
  if ((cinemaLevel ?? 0) >= 4) {
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + ZHAO_C4_DECIBEL
  }
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinemaLevel = Math.max(0, Math.floor(Number((cfg as any).zhaoCinemaLevel ?? 0)))
  if (cinemaLevel < 4) return
  for (const exec of executions) {
    if (!exec.moveId || !ZHAO_C4_MOVE_IDS.has(exec.moveId)) continue
    exec.critDmgBonus = (exec.critDmgBonus ?? 0) + ZHAO_C4_CRIT_DMG
  }
}

export const zhaoMechanic: AgentMechanicModule = {
  id: 'agent:zhao',
  agentIds: [ZHAO_ID],
  name: '照·最佳同事',
  description: '初始生命转暴击、影画2自身增攻、影画4开帷幕喧响与指定招式暴伤、影画6核心强化。',
  applyPanel,
  buildCharConfig,
  patchExecutions,
}

export default zhaoMechanic
