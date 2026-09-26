/**
 * 元素 → 面板键映射表（自 `composables/resourceCalc/skillRows.ts` 逐字迁出 —— CC-19c-1，
 * 设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §7.2）。
 *
 * 为什么搬到这里：`mechanics/agents/remielle.ts` 的 `calcVoidflareDamage` 需要这三张表，
 * 而守卫判据 19 禁止 mechanics 按值 import `@/composables`；`src/core/` 是三层都可依赖的公共底
 * （先例 `core/skillLevel.ts`）。`skillRows.ts` 保留 import + export 壳 ⇒ 目录外既有消费者
 * import 路径零改动。
 */

export const ELEMENT_DMG_KEYS: Record<string, string> = {
  physical: 'physicalDmg',
  fire: 'fireDmg',
  ice: 'iceDmg',
  electric: 'electricDmg',
  ether: 'etherDmg',
  wind: 'windDmg',
  lumiflux: 'lumifluxDmg',
  physical_polar_assault: 'physicalDmg',  // 物理变种，使用物理增伤
}

export const ELEMENT_DEF_REDUCTION_KEYS: Record<string, string> = {
  physical: 'enemyPhysicalDefReduction',
  fire: 'enemyFireDefReduction',
  ice: 'enemyIceDefReduction',
  electric: 'enemyElectricDefReduction',
  ether: 'enemyEtherDefReduction',
  wind: 'enemyWindDefReduction',
  lumiflux: 'enemyLumifluxDefReduction',
  physical_polar_assault: 'enemyPhysicalDefReduction',  // 物理变种
}

export const ELEMENT_RES_REDUCTION_KEYS: Record<string, string> = {
  physical: 'enemyPhysicalResReduction',
  fire: 'enemyFireResReduction',
  ice: 'enemyIceResReduction',
  electric: 'enemyElectricResReduction',
  ether: 'enemyEtherResReduction',
  wind: 'enemyWindResReduction',
  lumiflux: 'enemyLumifluxResReduction',
  physical_polar_assault: 'enemyPhysicalResReduction',  // 物理变种
}
