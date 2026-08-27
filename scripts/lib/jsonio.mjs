// 共享 JSON IO（生成脚本统一入口）。
// 生成产物（public/static/*.json）一律紧凑写：pretty-print 会让 catalog.json 从 ~2.6MB 膨胀到 ~5.2MB，
// 直接拖慢首屏下载与 JSON.parse。人工维护的 spec 文件（src/specs/agents/*.json）保持 pretty。
import { readFileSync, writeFileSync } from 'node:fs'

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * 写 JSON。默认紧凑（无缩进）+ 末尾换行。
 * @param {string} path
 * @param {unknown} data
 * @param {{ compact?: boolean }} [opts]
 */
export function writeJson(path, data, opts = {}) {
  const { compact = true } = opts
  const text = compact ? JSON.stringify(data) : JSON.stringify(data, null, 2)
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`)
}

/** 紧凑写（生成产物用）。 */
export function writeJsonCompact(path, data) {
  return writeJson(path, data, { compact: true })
}

/** 带缩进写（人工维护的 spec / 示例文件用）。 */
export function writeJsonPretty(path, data) {
  return writeJson(path, data, { compact: false })
}
