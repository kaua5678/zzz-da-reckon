/**
 * 招式目标 → 展示标签（展示层单一事实源）。
 *
 * 为什么单独建（2026-10-18）：`target.skillTargets` / `targetSkillType` 会把效果落到
 * `<stat>__<招式族>` 这种**定向字段**（引擎 `core/buff.ts#applyTargetedStat`），而展示层
 * 有两处各自判断「要不要标招式限定」——驱动盘套装效果行（`utils/discEffectRows.ts`）与
 * 音擎效果行（`views/TeamConfigPage.vue#collectWEngineGroupEffects`）。两处各写一份必然漂移，
 * 于是第一处修好了、第二处还在显示「招式类型伤害加成」（实测 14124 两条 basic/dashAttack 段、
 * 14146 两条 basic/ultimate 段）。
 *
 * 判定与引擎同表：`skillTag` 经 `SKILL_TAG_TARGET` 归一（`assistAttack → assist`）；
 * 无目标 / 不可识别 ⇒ 返回 `[]`（= 全招式，不标限定）。
 *
 * ⚠ 本模块只做**展示**。字段是否真的被写进定向键，由引擎的 `TARGETABLE_STATS` 决定
 * （两者不一致时以引擎为准，见 `core/__tests__/skillTargetsCoverage.test.ts`）。
 */
import {
  normalizeSkillDamageTarget,
  SKILL_DMG_TARGET_LABELS,
  SKILL_TAG_TARGET,
} from '@/data/skillDamageTargets'
import type { EffectTarget, SkillDamageTarget } from '@/types/catalog'

/** 只要求「带招式目标」的最小形状（`BuffEffect` 的子集；数据侧与面板侧都能直接传） */
interface TargetLike {
  target?: EffectTarget
  targetSkillType?: string
}

/** 该效果作用在哪些招式族（`[]` = 全招式 / 无定向） */
export function skillTargetsOf(effect: TargetLike): SkillDamageTarget[] {
  const explicit = effect.targetSkillType
  if (explicit) return [normalizeSkillDamageTarget(explicit)]
  const out: SkillDamageTarget[] = []
  for (const t of effect.target?.skillTargets ?? []) {
    if (t.kind === 'skillType' && t.skillType) out.push(normalizeSkillDamageTarget(t.skillType))
    if (t.kind === 'skillTag' && t.skillTag) out.push(normalizeSkillDamageTarget(SKILL_TAG_TARGET[t.skillTag] ?? 'all'))
  }
  const unique = [...new Set(out)].filter(t => t !== 'all')
  return unique
}

/** 「（普通攻击限定）」这类后缀；无定向 ⇒ 空串 */
export function skillTargetSuffix(effect: TargetLike): string {
  const targets = skillTargetsOf(effect)
  if (targets.length === 0) return ''
  return `（${targets.map(t => SKILL_DMG_TARGET_LABELS[t] ?? t).join(' / ')}限定）`
}

/** 给基础标签加招式限定后缀 */
export function withSkillTargetLabel(baseLabel: string, effect: TargetLike): string {
  return `${baseLabel}${skillTargetSuffix(effect)}`
}
