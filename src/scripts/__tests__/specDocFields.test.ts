/**
 * 判据：spec 的「只作文档」字段不进浏览器（2026-10-27 首屏体积专项）。
 *
 * ## 为什么需要这条判据
 *
 * `src/specs/agents/*.json` 被 `import.meta.glob(eager)` 打进**首屏入口 chunk**，其中 `notes`
 * （录入证据原文）占 195 KB raw / 110 KB gz —— 实测占入口 JS gzip 的 21%，而生产运行时**零读取**。
 * 瘦身手段 = 构建期剥离（`vite.config.ts` 的 `zzz-strip-spec-doc-fields` 插件），
 * **JSON 文件本身不动**（它仍是录入证据契约与 `check-guards` 的 `debt:` 扫描面）。
 *
 * ## 这条判据防的两类退化
 *
 * ① **沉默的功能缺失**：若将来有人写了 `spec.notes` 的运行时读取，构建后拿到 `undefined`，
 *    但 vitest 跑的是 serve 变换（插件 `apply: 'build'` 不生效）⇒ **测试全绿、线上报错**。
 *    所以本判据扫生产源码，出现 `spec.notes` 读取即红，并指明「要么改回不剥、要么改读取点」。
 * ② **数据被整体清空**：剥离收益越大越诱人去删 JSON 里的 notes。全库总量下限 + 每文件非空
 *    两道反空洞断言，防「优化成空数组」这种自欺。
 *
 * ⚠ 本判据**不**断言 `dist` 体积（构建产物不进仓库），只用结构与源码锁；
 * 体积回归请跑 `node scripts/bundle-audit.mjs`（同一专项的重入工具）。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { STRIPPED_SPEC_FIELDS, stripSpecDocFields } from '../../../scripts/lib/spec-doc-fields.mjs'

const ROOT = join(__dirname, '..', '..', '..')
const SPEC_DIR = join(ROOT, 'src', 'specs', 'agents')

/** 全库 notes 总量下限（2026-10-27 实测 195 KB）——只防「整体清空」，不锁具体数字 */
const NOTES_TOTAL_MIN_BYTES = 100_000
const SPEC_FILE_MIN = 50

function specFiles(): string[] {
  return readdirSync(SPEC_DIR).filter(f => f.endsWith('.json')).sort()
}

function readSpec(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8')) as Record<string, unknown>
}

describe('spec 文档字段的构建期剥离', () => {
  it('剥离后文档字段消失，运行时字段逐位保留', () => {
    const original = readSpec('1621.json')
    const stripped = JSON.parse(stripSpecDocFields(JSON.stringify(original))) as Record<string, unknown>

    for (const key of STRIPPED_SPEC_FIELDS) {
      expect(original[key], '夹具 1621.json 应声明 ' + key + '（否则本用例空转）').toBeDefined()
      expect(stripped[key], '剥离后不应再有 ' + key).toBeUndefined()
    }
    // 反向：运行时真正消费的字段一个都不能少（这是「剥离」不是「裁剪」）
    for (const key of ['id', 'name', 'agentIds', 'attributeConversions', 'resources', 'rowFusions', 'events', 'stateMachines']) {
      expect(stripped[key], '剥离不得动运行时字段 ' + key).toEqual(original[key])
    }
  })

  it('全库每个 spec 剥完后仍保有计算字段，且文档字段确实被剥掉', () => {
    const files = specFiles()
    expect(files.length, '扫描面不得为空').toBeGreaterThanOrEqual(SPEC_FILE_MIN)

    const offenders: string[] = []
    for (const file of files) {
      const stripped = JSON.parse(stripSpecDocFields(readFileSync(join(SPEC_DIR, file), 'utf8'))) as Record<string, unknown>
      for (const key of STRIPPED_SPEC_FIELDS) {
        if (key in stripped) offenders.push(file + ': ' + key + ' 未被剥离')
      }
      // 契约必填项：剥完还在，说明剥离没有误伤
      for (const required of ['agentIds', 'resources', 'events']) {
        if (!Array.isArray(stripped[required])) offenders.push(file + ': 运行时字段 ' + required + ' 被误删')
      }
    }
    expect(offenders).toEqual([])
  })

  it('反空洞：notes 是录入证据，总量不得被「优化」成空壳', () => {
    let totalBytes = 0
    const emptyFiles: string[] = []
    for (const file of specFiles()) {
      const notes = readSpec(file).notes
      if (!Array.isArray(notes) || notes.length === 0) {
        // beta 冻结副本允许 notes 极少，但正主必须有
        emptyFiles.push(file)
        continue
      }
      totalBytes += JSON.stringify(notes).length
    }
    expect(totalBytes, '全库 notes 总量异常偏小——像是被整体清空过').toBeGreaterThanOrEqual(NOTES_TOTAL_MIN_BYTES)
    expect(emptyFiles.length, '以下 spec 的 notes 为空：' + emptyFiles.join(', ')).toBeLessThanOrEqual(2)
  })

  it('生产源码不得读 spec.notes（构建后是 undefined，测试却看得见 ⇒ 会变成线上炸）', () => {
    /** 允许读 notes 的地方：类型声明、测试基础设施、测试用例、剥离器自身 */
    const ALLOW = [
      'src/specs/types.ts',
      'src/test/',
      'src/specs/__tests__/',
      'src/scripts/__tests__/',
      'src/mechanics/__tests__/',
    ]
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') continue
          walk(abs)
          continue
        }
        if (!/\.(ts|vue)$/.test(entry.name)) continue
        const rel = relative(ROOT, abs).replace(/\\/g, '/')
        if (ALLOW.some(prefix => rel === prefix || rel.startsWith(prefix))) continue
        const text = readFileSync(abs, 'utf8')
        // 只看真正的属性读取（spec.notes / spec?.notes），注释与类型声明不算
        if (/\bspec\??\.notes\b/.test(text)) offenders.push(rel)
      }
    }
    walk(join(ROOT, 'src'))
    expect(offenders, '这些文件读了 spec.notes，但构建后它是 undefined：' + offenders.join(', ')).toEqual([])
  })
})
