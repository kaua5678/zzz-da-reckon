import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 希格莉德（1591，冰属性·强攻，罗斯凯利法）。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1591.json + noun.json 术语解析（出枪式=Term:1000029、巡空枪势=Term:1000030、破阵=Term:1000028）。
 *
 * 本模块只承接「执行级」效果；面板级效果（暴击+66%/失衡易伤+20%/额外能力攻击+840/浸染增伤15%/
 * 影画1攻击25%/影画2喧响10%/影画4增伤18%）在 resourceCalc/helpers.ts computePanelPhases 的
 * agent.id === '1591' 块施加（那里才有 configStore 读覆盖率滑块）。
 *
 * 执行级（patchExecutions）：
 * - 影画2：[出枪式]+[普通攻击：敛枪式] 造成伤害的穿透率 +24%（moveId 限定 → exec.penRatioBonus）
 * - 影画1：敛枪式发动机会溢出时，下一次敛枪式最后一击额外 100% 攻击力冰伤 × 覆盖率滑块（近似进敛枪式行 flatDamageBonus）
 * - 影画6：敛枪式一/二/三段最后一击额外 80%/90%/100% 攻击力冰伤（三段近似取中值 90%，进敛枪式行 flatDamageBonus）
 *
 * 未建模（无乘区/时间轴效果，notes 记录）：
 * - [破阵]（连携命中失衡精英/首领进入，长按连放敛枪式一至三段；影画6 取消次数限制、加快发动）
 * - 影画2 巡空枪势持续时间 +2 秒
 */

const SIGRID_AGENT_ID = '1591'

/** 普通攻击：敛枪式（巡空枪势下长按发动） */
export const SIGRID_LANCE_MOVE_ID = '1591002'

/** [出枪式] 集合：凛冽枪尖第四段（整行近似）、乱琼、碎玉、回马枪、冰凌卷地、霜天、冰饕。
 *  原文：凛冽枪尖第四段/强化特殊技乱琼/碎玉/支援突击冰饕/连携技冰凌卷地/终结技霜天/闪避反击回马枪 视为[出枪式]。
 *  凛冽枪尖（1591001）只有第四段算出枪式，倍率表未按段拆行，整行计入为近似。 */
export const SIGRID_CHUQIANG_MOVE_IDS: Set<string> = new Set([
  '1591001', // 普通攻击：凛冽枪尖（仅第四段，整行近似）
  '1591004', // 强化特殊技：乱琼
  '1591005', // 强化特殊技：碎玉
  '1591007', // 闪避反击：回马枪
  '1591008', // 连携技：冰凌卷地
  '1591009', // 终结技：霜天
  '1591012', // 支援突击：冰饕
])

// 影画2 穿透率
const CINEMA2_PEN_RATIO = 24
// 影画1 溢出附加（100% 攻击力）
const CINEMA1_OVERFLOW_RATIO = 100
// 影画6 最后一击附加 80/90/100%（一/二/三段）→ 近似取中值
const CINEMA6_LAST_HIT_RATIO = 90

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function buildSigridCharConfig({ cfg, cinemaLevel, panel }: AgentCharConfigInput): void {
  cfg.sigridCinemaLevel = cinemaLevel
  // 敛枪式最后一击的附加伤害按「局内最终攻击力 × 百分比」进基础区（flatDamageBonus），
  // 此 panel 为 computePanel 的局内权威面板（已含额外能力+840 与影画1 攻击25%）。
  cfg.sigridAtk = Math.max(0, panel?.atk ?? 0)
}

function patchSigridExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).sigridCinemaLevel ?? 0)))
  const atk = Math.max(0, Number((cfg as any).sigridAtk ?? 0))
  for (const exec of executions) {
    if (!exec.moveId) continue
    // 影画2：出枪式 + 敛枪式 穿透率 +24%（moveId 限定，用户口径）
    if (cinema >= 2 && (SIGRID_CHUQIANG_MOVE_IDS.has(exec.moveId) || exec.moveId === SIGRID_LANCE_MOVE_ID)) {
      exec.penRatioBonus = (exec.penRatioBonus ?? 0) + CINEMA2_PEN_RATIO
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画2 穿透率 +${CINEMA2_PEN_RATIO}%（出枪式/敛枪式）`
    }
    // 敛枪式最后一击附加伤害（影画1 溢出 + 影画6 段末），近似为整行基础区固定附加
    if (exec.moveId === SIGRID_LANCE_MOVE_ID) {
      let ratio = 0
      const parts: string[] = []
      if (cinema >= 6) {
        ratio += CINEMA6_LAST_HIT_RATIO
        parts.push(`影画6 最后一击 +${CINEMA6_LAST_HIT_RATIO}%（80/90/100 三段取中值）`)
      }
      if (cinema >= 1) {
        const overflowCov = clamp01(cfgSetting(cfg, 'sigrid.c1OverflowCoverage', 1))
        if (overflowCov > 0) {
          ratio += CINEMA1_OVERFLOW_RATIO * overflowCov
          parts.push(`影画1 机会溢出最后一击 +${CINEMA1_OVERFLOW_RATIO}%×${Math.round(overflowCov * 100)}%`)
        }
      }
      if (ratio > 0 && atk > 0) {
        exec.flatDamageBonus = (exec.flatDamageBonus ?? 0) + atk * ratio / 100
        exec.skillTableNote = `${exec.skillTableNote ?? ''}；${parts.join('、')}`
      }
    }
  }
}

const settings: MechanicSetting[] = [
  {
    id: 'sigrid.corePassiveCoverage',
    label: '希格莉德巡空枪势覆盖率',
    description: '核心被动：巡空枪势状态下暴击率+66%、命中失衡敌人失衡易伤+20% 的时间覆盖率，默认 100%（出枪式命中即刷新，近似常驻）。',
    default: 100,
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  },
  {
    id: 'sigrid.infectionCoverage',
    label: '希格莉德浸染命中覆盖率',
    description: '额外能力·天际联军：命中[浸染]状态敌人时伤害+15% 的覆盖率（队内风异常/染色频率决定），默认 100%。',
    default: 100,
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  },
  {
    id: 'sigrid.cinema4Coverage',
    label: '希格莉德影画4覆盖率',
    description: '影画4·英雄养成中：每次获得巡空枪势伤害+18%（8秒，上限40秒）的覆盖率，默认 100%。',
    default: 100,
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  },
  {
    id: 'sigrid.c1OverflowCoverage',
    label: '希格莉德影画1机会溢出覆盖率',
    description: '影画1·很久很久以前：敛枪式发动机会（上限1）溢出频率，溢出时下一次敛枪式最后一击额外+100%攻击力，默认 100%。',
    default: 100,
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  },
]

export const sigridMechanic: AgentMechanicModule = {
  id: 'agent:sigrid',
  agentIds: [SIGRID_AGENT_ID],
  name: '希格莉德',
  description: '出枪式/巡空枪势/敛枪式：面板效果在 computePanelPhases 施加（暴击+66%、失衡易伤+20%、额外能力攻击/浸染增伤、影画1/2/4）；执行级影画2穿透率+24%（moveId 限定）与影画1/6敛枪式最后一击附加伤害在本模块 patchExecutions。',
  buildCharConfig: buildSigridCharConfig,
  patchExecutions: patchSigridExecutions,
  // spec 资源（敛枪式发动机会）与资源卡沿用 spec 解释器
  buildResourceResult: ({ cfg, state }: AgentResourceResultInput) => ({
    specResources: (() => {
      const spec = getAgentSpec(SIGRID_AGENT_ID)
      return spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {}
    })(),
  }),
  resourceSections: (input: AgentResourceSectionsInput) => {
    const spec = getAgentSpec(SIGRID_AGENT_ID)
    return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
  },
  settings,
}
