/** scripts/lib/slowest-first-sequencer.mjs 的类型声明（判据 14-C 逐符号对账）。
 *
 * 继承 `BaseSequencer`（vitest/node）——`sort` 换成按实测耗时降序，`shard` 仍用基类实现
 * （分片与排序是两件事，本类不接管分片）。
 */
export default class SlowestFirstSequencer {
  constructor(ctx?: unknown)
  /** 按 `scripts/lib/test-durations.json` 的实测秒数降序；未测到的排最后，同耗时保持原序 */
  sort<T>(files: T[]): Promise<T[]>
  /** 基类实现（分片算法不变） */
  shard<T>(files: T[]): Promise<T[]>
}
