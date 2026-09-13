/**
 * 技能伤害目标（招式族）枚举 + 标签 + 归一化（纯数据/纯函数）。
 *
 * ⚠ 本文件是**定义落点**（2026-09-13 展示层越层棘轮下沉：`src/views` 不得 import `@/core`，
 * 见 ARCHITECTURE §0 依赖方向）。`src/core/buff.ts` re-export 这三个符号，引擎侧调用点与
 * 既有 `@fact` 锚零改动——**改枚举/文案只改这里**。
 *
 * 无引擎状态依赖：两个常量 + 一个纯函数，展示层（属性配置页 / 调试页）与引擎共用同一份。
 */
import type { SkillDamageTarget } from '@/types/catalog'

export const SKILL_DMG_TARGETS: SkillDamageTarget[] = [
  'all', 'basic', 'special', 'exSpecial', 'ultimate', 'chain', 'assist', 'dodgeCounter', 'dashAttack', 'additionalAttack',
]

export const SKILL_DMG_TARGET_LABELS: Record<SkillDamageTarget, string> = {
  all: '全部招式',
  basic: '普通攻击',
  special: '特殊技',
  exSpecial: '强化特殊技',
  ultimate: '终结技',
  chain: '连携技',
  assist: '支援技',
  dodgeCounter: '闪避反击',
  dashAttack: '冲刺攻击',
  additionalAttack: '追加攻击',
}

export function normalizeSkillDamageTarget(target?: string): SkillDamageTarget {
  if (target && (SKILL_DMG_TARGETS as string[]).includes(target)) return target as SkillDamageTarget
  return 'all'
}
