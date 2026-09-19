/**
 * 资源池通用默认常量（纯数据）。
 *
 * ⚠ 本文件是**定义落点**（2026-09-13 展示层越层棘轮下沉：`src/views/TeamConfigPage.vue` 不得
 * import `@/core`，见 ARCHITECTURE §0 依赖方向）。`src/core/resource.ts` re-export 本常量，
 * 引擎侧调用点与既有引用零改动——**改数值只改这里**。
 */
/** 终结技默认喧响消耗 */
export const ULTIMATE_COST_DEFAULT = 3000
/**
 * 回避支援（Evade Assist）单次动作时间（秒）——「**没有**招架支援的角色」对黄光那一次交互的占用。
 *
 * 口径（用户 2026-09-15）：「回避支援和支援突击用的公式是一样的，而且也有215喧响奖励，
 * 只是前面弹刀的1.16秒换成了1.16秒的时停效果，纯亏时间」⇒ **与轻弹刀同长，但不产伤害/失衡**
 * （时停期间敌人静止、自己也没输出）。
 * 取 1.166 而非字面 1.16：这是轻招架 #1 段的实测众数（56 个有招架的角色里 46 个 = 1.166）。
 * ⚠ raw 里「回避支援」**没有任何 param 块**（`element_type:0 / hit_type:0`），推不出时间，
 * 只能按此口径钉死；`zc drift` 到期要复核。
 */
export const EVADE_ASSIST_ACTION_TIME_SECONDS = 1.166
/**
 * 动态合轴吸收上限（队友前台可被合轴吸收的比例，全局变量；用户口径 2026-09-19 v3）：
 * 「全部吸收比较难——默认队友的 40% 可以被吸收（合轴率），超过了就无力合轴了。」
 * 引擎侧每名非操作角色的吸收容量 = 本值 × 其净必要前台；吸收不完的溢出照旧走封顶 / 装配截断。
 * 用户可在队伍配置页改（机制参数 `time.comboAlignAbsorbRatio`，0 = 不吸收）；难度阶梯把它当杠杆分档推进（G5）。
 */
export const DEFAULT_COMBO_ALIGN_ABSORB_RATIO = 0.4
/** 机制参数键：动态合轴吸收上限（0..1），缺省 DEFAULT_COMBO_ALIGN_ABSORB_RATIO */
export const COMBO_ALIGN_ABSORB_RATIO_SETTING = 'time.comboAlignAbsorbRatio'
/**
 * 回避支援合成执行行的 moveId。catalog 里**不存在**这个 move（raw 无倍率块），故走
 * 「零倍率、只占时间」的合成行写法（先例：般岳后摇 / 猫又超凶爪印 `damageMultiplierOverride`）。
 */
export const EVADE_ASSIST_MOVE_ID = 'evade_assist'
