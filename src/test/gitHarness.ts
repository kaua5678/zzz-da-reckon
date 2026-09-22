import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

export interface GitFixture {
  root: string
  write: (file: string, content: string) => void
  git: (...args: string[]) => string
  exec: (command: string, args: string[]) => string
}

/** 真 Git 夹具：只写自建临时目录，不继承外部 GIT_* 定位、不运行用户 hooks、不改用户 git config。 */
export function withGitFixture(run: (fixture: GitFixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'zzz-git-fixture-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const exec = (command: string, args: string[]) => execFileSync(command, args,
    { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const git = (...args: string[]) => exec('git', [
    '-c', 'init.templateDir=', '-c', `core.hooksPath=${join(root, 'no-hooks')}`,
    '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    ...args,
  ])
  const write = (file: string, content: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  try { run({ root, write, git, exec }) } finally { rmSync(root, { recursive: true, force: true }) }
}
