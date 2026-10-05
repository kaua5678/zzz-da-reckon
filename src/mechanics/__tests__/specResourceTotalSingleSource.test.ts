/**
 * CC-486（r671）：spec 资源的「总量」只有一个定义——`computeOneResource` 写进 `SpecResourceResult.total` 的
 * `initialValue + totalGain`。模块读整数计数用 `whole(r.total)`，不许再各自重算一遍（此前 xixifu ×2 / zhuYuan ×2 / xide ×1）。
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

describe('spec 资源总量单一出处（CC-486）', () => {
  it('specs/resources.ts 里 total 的定义恰一处且 = initialValue + totalGain', () => {
    const src = readFileSync('src/specs/resources.ts', 'utf8')
    expect(src.match(/const total = initialValue \+ totalGain\n/g)?.length).toBe(1)
  })
  it('源码锁：src/mechanics 与 src/composables 下无人再写 initialValue + …totalGain', () => {
    let out = ''
    try {
      out = execFileSync('grep', ['-rnE', String.raw`\.initialValue \+ [A-Za-z_.]*totalGain`, 'src/mechanics', 'src/composables', 'src/core', '--include=*.ts', '--exclude-dir=__tests__'], { encoding: 'utf8' })
    } catch (e) { out = (e as { stdout?: string }).stdout ?? '' } // grep 无命中 exit 1
    expect(out.trim()).toBe('')
  })
})
