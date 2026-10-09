import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePorcelain, recentlyOwnedPaths, detectForeignWip } from '../../../scripts/zc.mjs'
import { withGitFixture, type GitFixture } from '@/test/gitHarness'

/** 复制真实 CLI 到隔离仓库：状态文件也相对临时 ROOT，绝不碰主工作区 .zc。 */
function withZcFixture(run: (fixture: GitFixture) => void) {
  withGitFixture(f => {
    f.write('scripts/zc.mjs', readFileSync(new URL('../../../scripts/zc.mjs', import.meta.url), 'utf8'))
    // zc.mjs 的 import 闭包必须一起复制：只拷 zc.mjs 会让它 import 到不存在的
    // scripts/lib/*.mjs（ERR_MODULE_NOT_FOUND）。新增 zc 的 lib 依赖时同步加这里。
    for (const lib of ['date-utils.mjs']) {
      f.write(`scripts/lib/${lib}`, readFileSync(new URL(`../../../scripts/lib/${lib}`, import.meta.url), 'utf8'))
    }
    f.write('README.md', 'committed\n')
    f.write('.gitignore', '.zc/\n')
    f.git('init', '--quiet')
    f.git('add', '--', 'scripts/zc.mjs', 'scripts/lib', 'README.md', '.gitignore')
    f.git('commit', '--quiet', '-m', 'workspace fixture')
    run(f)
  })
}

describe('zc 工作区状态：Git 路径必须无损', () => {
  it('NUL 格式保留首行状态空格、中文、引号、内嵌换行和路径尾部空格', () => {
    const special = 'docs/中文 "quote"\nfile.ts '
    expect(parsePorcelain(` M README.md\0?? ${special}\0`)).toEqual([
      { status: 'M', path: 'README.md' }, { status: '??', path: special },
    ])
  })

  it('rename/copy 的第二个字段是原路径，不是另一个状态记录', () => {
    expect(parsePorcelain('R  moved.ts\0old.ts\0 C copied.ts\0source.ts\0?? tail.ts\0')).toEqual([
      { status: 'R', path: 'moved.ts', originalPath: 'old.ts' },
      { status: 'C', path: 'copied.ts', originalPath: 'source.ts' },
      { status: '??', path: 'tail.ts' },
    ])
  })

  it('空状态是空数组，但截断的 rename 记录必须大声失败', () => {
    expect(parsePorcelain('')).toEqual([])
    expect(() => parsePorcelain('R  destination.ts\0')).toThrow()
  })

  it('真实 done 链路：首个修改文件不丢字符，未跟踪目录展开为真实文件', () => withZcFixture(f => {
    const special = 'docs/中文 "quote"\nnew.md'
    f.write('README.md', 'changed\n')
    f.write(special, 'new\n')
    f.write('notes/nested.txt', 'nested\n')
    const result = JSON.parse(f.exec(process.execPath, [
      join(f.root, 'scripts/zc.mjs'), 'done', '--as', 'mine',
      '--verifier', 'fixture', '--coverage', 'fixture', '--json',
    ]))
    expect(result.ok).toBe(true)
    const entry = JSON.parse(readFileSync(join(f.root, '.zc/journal.jsonl'), 'utf8').trim())
    expect(entry.changed).toEqual(expect.arrayContaining(['README.md', special, 'notes/nested.txt']))
    expect(entry.changed).not.toContain('EADME.md')
    expect(entry.changed).not.toContain('docs/')
  }))
})


describe('zc 收工归属：工作树快照不是所有权', () => {
  const now = 1_700_000_000_000
  const at = (time = now - 1000) => new Date(time).toISOString()

  it('旧日志只有 changed 时不能把其它会话的 WIP 认成自己的', () => {
    const entries = [{ lane: 'me', at: at(), changed: ['mine.ts', 'foreign.ts'] }]
    expect(recentlyOwnedPaths(entries, 'me', now)).toEqual([])
  })

  it('明确 ownedPaths 去重，且只认本 lane、有效过去时间及时间窗内记录', () => {
    const entries = [
      { lane: 'me', at: at(), changed: ['a.ts', 'foreign.ts'], ownedPaths: ['a.ts', 'a.ts'] },
      { lane: 'other', at: at(), ownedPaths: ['other.ts'] },
      { lane: 'me', at: at(now - 13 * 3600_000), ownedPaths: ['old.ts'] },
      { lane: 'me', at: 'invalid', ownedPaths: ['invalid.ts'] },
      { lane: 'me', at: at(now + 1000), ownedPaths: ['future.ts'] },
    ]
    expect(recentlyOwnedPaths(entries, 'me', now)).toEqual(['a.ts'])
  })

  it('目录租约覆盖子文件但不覆盖相似前缀；过期租约不隐藏变化', () => {
    const changed = ['src/a.ts', 'src-other/a.ts', 'expired/a.ts']
    const leases = [
      { path: 'src/', lane: 'other', at: now, ttlMs: 60000 },
      { path: 'expired', lane: 'other', at: now - 2000, ttlMs: 1000 },
    ]
    const mtimes = Object.fromEntries(changed.map(p => [p, now]))
    expect(detectForeignWip(changed, leases, mtimes, now)).toEqual(['src-other/a.ts', 'expired/a.ts'])
  })

  it('真 CLI 收工/释放后，仅自己活跃租约覆盖的变化属于自己', () => withZcFixture(f => {
    const time = Date.now()
    const changed = ['mine.ts', 'src/child.ts', 'src-other/no.ts', 'foreign.ts', 'held.ts', 'expired.ts']
    for (const p of changed) f.write(p, 'changed\n')
    const leases = [
      { path: 'mine.ts', lane: 'mine', at: time, ttlMs: 60000 },
      { path: 'src', lane: 'mine', at: time, ttlMs: 60000 },
      { path: 'held.ts', lane: 'other', at: time, ttlMs: 60000 },
      // 过期留足一小时：CLI 子进程重新取 Date.now()，WSL 高负载下墙钟会回拨；原先 time - 2000 只差 1 秒，全量分片里偶发被当成活跃租约
      { path: 'expired.ts', lane: 'mine', at: time - 3_600_000, ttlMs: 1000 },
    ]
    f.write('.zc/leases.json', JSON.stringify(leases))
    const result = JSON.parse(f.exec(process.execPath, [join(f.root, 'scripts/zc.mjs'), 'done',
      '--as', 'mine', '--verifier', 'fixture', '--coverage', 'fixture', '--json']))
    const entry = JSON.parse(readFileSync(join(f.root, '.zc/journal.jsonl'), 'utf8').trim())
    expect(entry.changed.slice().sort()).toEqual(changed.slice().sort())
    expect(entry.ownedPaths).toEqual(['mine.ts', 'src/child.ts'])
    expect(result.data.owned).toBe(2)
    f.exec(process.execPath, [join(f.root, 'scripts/zc.mjs'), 'release', '--as', 'mine', '--all', '--json'])
    const remaining = JSON.parse(readFileSync(join(f.root, '.zc/leases.json'), 'utf8'))
    const checkTime = Date.now()
    const own = recentlyOwnedPaths([entry], 'mine', checkTime)
    expect(own).toEqual(['mine.ts', 'src/child.ts'])
    const mtimes = Object.fromEntries(changed.map(p => [p, checkTime]))
    expect(detectForeignWip(changed, remaining, mtimes, checkTime, undefined, own).sort())
      .toEqual(['expired.ts', 'foreign.ts', 'src-other/no.ts'])
  }))

  it('无租约可以记验证快照，但不能凭空认领所有变更', () => withZcFixture(f => {
    f.write('foreign.ts', 'not claimed\n')
    f.exec(process.execPath, [join(f.root, 'scripts/zc.mjs'), 'done', '--as', 'mine',
      '--verifier', 'fixture', '--coverage', 'fixture', '--json'])
    const entry = JSON.parse(readFileSync(join(f.root, '.zc/journal.jsonl'), 'utf8').trim())
    expect(entry.changed).toEqual(['foreign.ts'])
    expect(entry.ownedPaths).toEqual([])
    expect(recentlyOwnedPaths([entry], 'mine')).toEqual([])
  }))
})
