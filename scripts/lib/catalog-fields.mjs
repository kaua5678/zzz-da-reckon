// catalog.json 顶层字段白名单（单一事实源）。
// 与 src/types/catalog.ts 的 `export interface Catalog` 字段一一对应，改动必须两侧同步。
// 消费方：scripts/minify-static.mjs（剔除 legacy 死键）+ scripts/validate-data.mjs（机器护栏）。
export const CATALOG_FIELDS = [
  'agents',
  'agentSkills',
  'wEngines',
  'driveDiscSets',
  'bosses',
  'statRules',
]
