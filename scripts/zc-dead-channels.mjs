/**
 * T2 按需工作台：只负责参数、报告与呈现，不另造扫描口径、不写工作区。
 * LS 与基线的唯一实现是 lib/dead-channel-ls.mjs；普通 zc 动词不加载本模块，
 * 本模块的帮助/参数错误也不加载 LS。已知存量不是「安全可删」结论。
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'

const USAGE = 'node scripts/zc.mjs dead-channels [--json] [--help]'
const REVIEW = '先复核消费者与扫描盲区；修正新增项。已消失基线须人工核销，不自动删字段或扩基线。'

function failure(code, message, next = REVIEW) {
  return { ok: false, data: { error: { code, message } }, next }
}

/** 返回 zc 信封的内容部分；root 由真实 CLI 的 ROOT 提供，夹具可用自己的根目录。 */
export async function buildDeadChannelReport(root, args = {}) {
  const unknown = Object.keys(args).filter(k => !['positional', 'json', 'help'].includes(k))
  if ((args.positional?.length ?? 0) > 0 || unknown.length > 0) {
    return failure('INVALID_ARGUMENT', '不接受路径或其它开关：' + [
      ...(args.positional ?? []), ...unknown.map(k => '--' + k),
    ].join(' '), USAGE)
  }
  if (args.help) return { ok: true, data: { help: USAGE + '\n只读扫描；新增死通道/空扫描/扫描失败退出 1，基线存量与待核销项不自动处理。' }, next: null }
  try {
    if (!statSync(join(root, 'src')).isDirectory()) throw new Error('项目 src 必须是目录')
    const {
      scanDeadChannelsLs, diffAgainstBaseline, normalizeBaseKey,
      DEAD_CHANNEL_LS_BASELINE, DEFAULT_SCAN_DIRS,
    } = await import('./lib/dead-channel-ls.mjs')
    const scan = scanDeadChannelsLs({ root })
    if (!Number.isInteger(scan.candidates) || scan.candidates <= 0) {
      return failure('EMPTY_SCAN', 'LS 候选数为 0，不能把扫描面缺失报告为零问题。', '检查项目根目录、src 与扫描范围后重试；不要删除反空洞检查。')
    }
    const { fresh, resolved } = diffAgainstBaseline(scan.dead)
    const freshKeys = new Set(fresh.map(hit => normalizeBaseKey(hit.key)))
    const baseline = new Map(Object.entries(DEAD_CHANNEL_LS_BASELINE).map(([key, entry]) => [
      normalizeBaseKey(key), { key, ...entry },
    ]))
    const known = scan.dead.filter(hit => !freshKeys.has(normalizeBaseKey(hit.key))).map(hit => ({
      ...hit, baseline: baseline.get(normalizeBaseKey(hit.key)),
    }))
    return {
      ok: fresh.length === 0,
      data: {
        root, scope: DEFAULT_SCAN_DIRS, candidates: scan.candidates, ms: scan.ms,
        fresh, known,
        resolved: resolved.map(key => ({ key, stableKey: normalizeBaseKey(key), ...DEAD_CHANNEL_LS_BASELINE[key] })),
      },
      next: REVIEW,
    }
  } catch (error) {
    return failure('SCAN_FAILED', error instanceof Error ? error.message : String(error), '检查 src、TypeScript 依赖与扫描器错误；失败不是「零问题」。')
  }
}

/** 文本与 --json 消费同一份报告，格式化不触发第二次扫描。 */
export function formatDeadChannelReport(result) {
  const d = result.data
  if (d.help) return d.help
  if (d.error) return `✗ ${d.error.code}: ${d.error.message}\n→ ${result.next}`
  const lines = [
    `死通道 LS · 候选 ${d.candidates} · 扫描 ${d.ms}ms`,
    `范围：${d.scope.join(' / ')}`,
    `新增 ${d.fresh.length} · 基线存量 ${d.known.length} · 待核销 ${d.resolved.length}`,
  ]
  for (const hit of d.fresh) {
    lines.push(`✗ 新增 ${hit.file}:${hit.line} ${hit.prop} [${hit.confidence}] — ${hit.evidence}`)
  }
  for (const hit of d.known) {
    lines.push(`· 存量 ${hit.file}:${hit.line} ${hit.prop} [${hit.confidence}] — ${hit.evidence}`)
    lines.push(`  基线 ${hit.baseline.key} · since ${hit.baseline.since} · ${hit.baseline.why}`)
  }
  for (const entry of d.resolved) {
    lines.push(`⟳ 待核销 ${entry.key} · since ${entry.since} · ${entry.why}`)
  }
  if (d.fresh.length === 0) lines.push('无基线外新增；基线存量不等于可直接删除。')
  if (result.next) lines.push('→ ' + result.next)
  return lines.join('\n')
}
