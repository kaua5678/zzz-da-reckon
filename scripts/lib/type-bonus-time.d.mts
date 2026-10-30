/** scripts/lib/type-bonus-time.mjs 的类型声明（供 vitest/TS 消费；先例：scripts/lib/beta-snapshot.d.mts） */

export declare const TYPE_BONUS: Readonly<{ dodgeCounter: number; defensiveAssist: number; ultimate: number }>
export declare const TYPE_BONUS_TOLERANCE: number
/** 反制支援（Counter Assist）系的定点秽盾基数（`ether_purify = 300 + 100t`） */
export declare const COUNTER_ASSIST_ETHER_BASE: number
export declare function counterAssistEtherBase(move?: { id?: string; name?: { zhCN?: string; en?: string } }): number
export declare function inferTypeBonusFromRows(rows?: { etherPurify?: number; anomalyBuildup?: number }): number
export declare function inferTypeBonusFromName(move?: { zhCN?: string; en?: string; timeType?: string }): number
export declare function actionTimeFromPurify(rows?: { etherPurify?: number; anomalyBuildup?: number }): number | null
