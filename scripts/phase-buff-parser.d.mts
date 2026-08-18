/** scripts/phase-buff-parser.mjs 的类型声明（供 vitest/UI 消费） */

export interface PhaseBuffCond {
  /** [2名档, 3名档]；应用时按队伍实际异常人数选档 */
  anomalyCount?: [number, number]
  /** 强攻/异常/击破/命破…限定 */
  specialty?: string
}

export interface PhaseBuffEffect {
  stat: string
  value: number
  targetSkillType?: string
  cond?: PhaseBuffCond
  note?: string
}

export interface PhaseBuffCard {
  title: string
  testOnly: boolean
  effects: PhaseBuffEffect[]
  unparsed: string[]
}

export declare function parsePhaseBuff(title: string, desc: string): PhaseBuffCard
export declare function effectLabel(eff: PhaseBuffEffect): string
export declare const ELEMENT_MAP: Record<string, string>
