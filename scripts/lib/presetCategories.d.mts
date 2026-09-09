/** scripts/lib/presetCategories.mjs 的类型声明（供 vitest/TS 消费，先例：scripts/check-guards.d.mts） */

export declare const SPECIALTY_GROUP: Record<string, string>
export declare const SUPPORT_SPECIALTIES: Set<string>
export declare const ELEMENT_LABEL: Record<string, string>
export declare function isCarrySpecialty(specialty: string | undefined): boolean
export declare function resolveCarryAgent(
  team: string[],
  agentOf: (id: string) => any | undefined,
): string | null
export declare function classifyPreset(
  team: string[],
  agentOf: (id: string) => any | undefined,
): { group: string; subgroup: string; carryId: string } | null
