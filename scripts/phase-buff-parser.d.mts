/** scripts/phase-buff-parser.mjs 的类型声明（供 vitest/UI 消费） */

export interface PhaseBuffCond {
  /** 特性限定（二元）：队伍无该特性角色则该条不生效 */
  specialty?: string
  /** 特性人数分档：队伍中 specialty 角色数达到 thresholds[0]/thresholds[1] 时分别取 values[0]/values[1]。
   *  例 异常 2/3 名 → { specialty:'异常', thresholds:[2,3], values:[30,70] }；
   *  强攻 1/2 名 → { specialty:'强攻', thresholds:[1,2], values:[20,40] }。 */
  countTier?: { specialty: string; thresholds: [number, number]; values: [number, number] }
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
