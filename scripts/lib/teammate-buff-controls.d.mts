/** scripts/lib/teammate-buff-controls.mjs 的类型声明（供 vitest/TS 消费，先例：presetCategories.d.mts / check-guards.d.mts） */

/** 渲染面文件（相对仓库根） */
export declare const TEAMMATE_BUFF_VIEW: string
/** 队友 Buff 列表区域起点标记（模板里的 class 名片段） */
export declare const REGION_START: string
/** 队友 Buff 列表区域终点标记 */
export declare const REGION_END: string
/** 受判据约束的控件标签（`<n-checkbox` / `<n-slider`） */
export declare const GUARDED_CONTROLS: string[]
/** 守卫标识符子串（渲染门控里必须出现它） */
export declare const INTERACTIVITY_GUARD: string

/** 从模板源码里切出队友 Buff 列表区域；定位失败返回 null */
export declare function extractTeammateBuffRegion(source: string): string | null

export interface TeammateBuffControlViolation {
  /** 违规控件标签（`<n-checkbox` / `<n-slider`） */
  tag: string
  /** 该控件的开标签属性段（截断后，供人读） */
  opening: string
}

export interface TeammateBuffControlReport {
  /** 区域是否定位成功 */
  regionFound: boolean
  /** 扫到的控件标签列表（反空洞：为空 ⇒ ok=false） */
  controls: string[]
  /** 无渲染门控的控件 */
  violations: TeammateBuffControlViolation[]
  /** 畸形模板（开标签找不到闭合） */
  malformed: string[]
  /** 综合判定 */
  ok: boolean
  /** 渲染面文件不存在 */
  missing: boolean
}

/** 扫描队友 Buff 控件守卫（判据 20 的实现面） */
export declare function scanTeammateBuffControls(root: string): TeammateBuffControlReport
