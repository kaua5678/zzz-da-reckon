/**
 * `@/types/resource` 的公开面（barrel）。
 *
 * 2026-09-11 由单文件 2566 行拆为按域多文件（评审第二梯队 #7）：并行会话的冲突面从「一个巨文件」
 * 收敛到具体域；下游 85 个文件的 import 路径**零改动**（同一路径经目录 index 解析）。
 *
 * 新增类型请放进对应域文件，并在此 re-export（本文件保持「只 re-export、不定义」）。
 */
export type * from './agentResources'
export type * from './config'
export type * from './energy'
export type * from './execution'
export type * from './pools'
export type * from './team'
export type * from './time'

// 唯一的运行时导出（类型面里夹带的一个判定函数）：值导出不能用 `export type *`，单列一行。
export { isFrontlineExecution } from './execution'
