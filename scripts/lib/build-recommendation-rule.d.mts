/** scripts/lib/build-recommendation-rule.mjs 的类型声明（供 vitest / vue-tsc 消费，先例：json-dup-keys.d.mts） */

/** 槽位合法主词条（prop id） */
export declare const SLOT_POOL_IDS: Record<4 | 5 | 6, string[]>
/** 参与主词条选择的字段（顺序 = 站点优先级） */
export declare const MAIN_STAT_FIELDS: string[]
/** 按站点规则算出 4/5/6 槽的主词条 prop id（每槽独立取首个合法候选） */
export declare function assignMainStatProps(
  // 只读 part4/part5/part6/part_sub，其余键（alt_build / part_sub_list …）不参与
  fairy: Record<string, unknown> | undefined,
): Partial<Record<4 | 5 | 6, string>>
/** 该词条是否在该槽合法（未知 prop 一律判非法） */
export declare function isLegalMainStatProp(slot: number, prop: string | number): boolean
