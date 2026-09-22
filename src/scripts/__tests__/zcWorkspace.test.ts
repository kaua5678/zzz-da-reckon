import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePorcelain } from '../../../scripts/zc.mjs'
import { withGitFixture, type GitFixture } from '@/test/gitHarness'

/** 复制真实 CLI 到隔离仓库：状态文件也相对临时 ROOT，绝不碰主工作区 .zc。 */
function withZcFixture(run: (fixture: GitFixture) => void) {
  withGitFixture(f => {
    f.write('scripts/zc.mjs', readFileSync(new URL('../../../scripts/zc.mjs', import.meta.url), 'utf8'))
    f.write('README.md', 'committed\n')
    f.write('.gitignore', '.zc/\n')
    f.git('init', '--quiet')
    f.git('add', '--', 'scripts/zc.mjs', 'README.md', '.gitignore')
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
