/**
 * CC-456 源码锁：LocalizedString 显示名只允许经 `utils/format#localized`（对象在手）或
 * `stores/catalog#agentName`（只有 id）解析，禁止再手抄 `x.name.zhCN ?? …` 回退链。
 * 背景（r573 普查）：`localized` 早已声明为单一事实源，但仓库里仍有 52 处手抄、回退口径四种并存
 * （`?? id` / `?? en ?? id` / `?? en ?? 槽位N` / `?.slice(0,5) || 槽N`），迁移从未完成。
 * 放行的只有「en+zh 拼接后做关键字匹配」的匹配器（不是显示），按文件登记允许的命中数：
 * 新增一处手抄会让对应文件超出计数 ⇒ 本测试变红：改为 `localized(x.name, fallback)` /
 * `catalogStore.agentName(id)`；确属匹配器的，在 ALLOWED 里加一并写明理由。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { localized } from '@/utils/format'

const SRC = join(__dirname, '..', '..')
/** `.name.zhCN ?? …` / `.name?.zhCN ?? …` / `.name?.zhCN?.slice(` */
const HAND_COPY = /\.name\??\.zhCN\s*\?\?|\.name\??\.zhCN\?\.slice\(/g
/** 匹配器：取 en+zh 做 includes/lowercase 关键字判断，不是显示值 */
const ALLOWED: Record<string, number> = {
  'core/damage.ts': 2,                        // moveName 关键字匹配（moveSignalDamageTarget + inferSkillDamageTarget 分类兜底；CC-500 起资源侧转调前者，不再手抄）
  'composables/multiplierCoefficients.ts': 1, // :46 招式名关键字
  'mechanics/agents/remielle.ts': 2,          // 「垂虹」招式识别
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(ts|vue)$/.test(name)) out.push(p)
  }
  return out
}

describe('LocalizedString 显示名单一解析器（CC-456）', () => {
  it('src 下 `.name.zhCN ??` 手抄只出现在登记过的匹配器文件，且不超过登记计数', () => {
    const over: string[] = []
    for (const p of walk(SRC)) {
      const n = (readFileSync(p, 'utf8').match(HAND_COPY) ?? []).length
      if (n === 0) continue
      const rel = relative(SRC, p).replace(/\\/g, '/')
      if (n > (ALLOWED[rel] ?? 0)) over.push(`${rel}:${n}`)
    }
    expect(over).toEqual([])
  })
  it('登记过的匹配器仍然存在（删了就把登记一起删，别留死条目）', () => {
    for (const [rel, n] of Object.entries(ALLOWED)) {
      const got = (readFileSync(join(SRC, rel), 'utf8').match(HAND_COPY) ?? []).length
      expect(`${rel}:${got}`).toBe(`${rel}:${n}`)
    }
  })
  it('localized 口径：字符串原样；对象 zhCN → en → fallback，空串 zhCN 有效不回退', () => {
    expect(localized('艾莲', 'x')).toBe('艾莲')
    expect(localized({ zhCN: '艾莲', en: 'Ellen' }, 'x')).toBe('艾莲')
    expect(localized({ en: 'Ellen' }, 'x')).toBe('Ellen')
    expect(localized({ zhCN: '', en: 'Ellen' }, 'x')).toBe('')
    expect(localized(undefined, '1191')).toBe('1191')
    expect(localized(null)).toBe('')
  })
})
