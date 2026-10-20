/**
 * 扫描器的**文件读取**工具（2026-10-20）。
 *
 * ## 为什么需要
 * 所有仓库级扫描器都用 `git ls-files` 取文件清单，然后 `readFileSync` 逐个读。
 * 这隐含一个假设：**git 索引 == 磁盘内容**。但开发中经常不成立：
 * `rm src/foo.vue` 之后、`git add` 之前，索引里还有这个文件、磁盘上已经没了
 * ⇒ 扫描器抛 `ENOENT` 崩掉（2026-10-20 实测：删两个图表组件后 `check-guards` 直接
 * `Error: ENOENT ... ContributionHeatmap.vue`，整张护栏表停摆）。
 *
 * 更糟的是**崩掉比读错更危险**：崩了会让人以为「护栏坏了」，而真正的语义是
 * 「这个文件已删除，不该再参与扫描」。
 *
 * ## 策略
 * - 文件不存在 ⇒ **视为空内容并记入 `missing`**（不崩、不静默丢：调用方可以据此报错或忽略）；
 * - 其他 IO 错误（权限等）⇒ 照常抛出（那是真问题，不该被吞掉）。
 *
 * ⚠ `missing` 不是零：调用方若把它当「扫描面」统计，应把缺失文件从分母里剔除并单独报告，
 * 否则「文件消失了 ⇒ 命中数下降 ⇒ 棘轮变绿」会伪装成进步。
 */
import { existsSync, readFileSync } from 'node:fs'

/**
 * 读文件；文件不存在时返回 `null` 而不是抛错。
 *
 * @param absPath 绝对路径（调用方负责拼 root）
 * @returns 文件内容；不存在 = `null`
 */
export function readTextIfExists(absPath) {
  if (!existsSync(absPath)) return null
  return readFileSync(absPath, 'utf8')
}

/**
 * 批量读取（`git ls-files` 风格的相对路径清单）。
 *
 * @param root 仓库根
 * @param relPaths 相对路径数组
 * @returns `texts`（只在存在的文件上）+ `missing`（已删除/丢失的），
 *   两者互斥且并集 = 输入 ⇒ 调用方可以据此把缺失去重报出来。
 */
export function readTextsTolerant(root, relPaths) {
  const texts = new Map()
  const missing = []
  for (const rel of relPaths) {
    const text = readTextIfExists(`${root}/${rel}`)
    if (text === null) { missing.push(rel); continue }
    texts.set(rel, text)
  }
  return { texts, missing }
}
