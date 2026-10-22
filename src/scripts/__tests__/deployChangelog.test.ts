/**
 * 部署链路的判据：**更新日志只在部署时更新，且部署时必须拿到全历史**。
 *
 * 为什么值得单测（2026-10-22 用户实测「我从 github.io 里看了，网站还是老版本」）：
 * 这是**只在线上才成立**的一类缺陷 —— 本地 `gen:changelog` 跑得再对，只要部署 workflow
 * 用默认的浅克隆 checkout，生成出来的日志就只有 1 条；而 CI 的 `changelog:check` 在
 * `fetch-depth: 0` 的 job 里是绿的 ⇒ 两道防线都绿、线上是残缺站。
 *
 * 三条不变量（每条都对应一次真实踩坑或它的直接下一步）：
 *   ① 部署 job 的 checkout 必须 `fetch-depth: 0`（浅克隆 ⇒ 日志只有 1 条）；
 *   ② 部署时必须**重新生成** `changelog.json`（作品若不随历史重生成，就只能靠人手记得提交，
 *      实测落后过 177 条）；
 *   ③ 生成后必须断言「产物 head == 本次部署提交」，否则残缺时会静默发出去。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const WORKFLOW = readFileSync(new URL('../../../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8')

describe('deploy-pages：更新日志随部署重新生成', () => {
  it('checkout 取全历史（fetch-depth: 0）——否则生成的日志只有一条', () => {
    const checkout = WORKFLOW.slice(WORKFLOW.indexOf('actions/checkout'))
    expect(checkout.slice(0, 200)).toContain('fetch-depth: 0')
  })

  it('部署步骤里真的跑 gen-changelog（不是只靠仓库里那份陈旧产物）', () => {
    expect(WORKFLOW).toContain('node scripts/gen-changelog.mjs')
  })

  it('生成后断言产物 head == 本次部署提交（残缺时红，而不是发出去）', () => {
    expect(WORKFLOW).toContain('Assert changelog covers HEAD')
    expect(WORKFLOW).toContain('git rev-parse --short HEAD')
  })

  it('只有 push 才会触发部署（工作流触发面），并保留手动入口', () => {
    expect(WORKFLOW).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[master\]/)
    expect(WORKFLOW).toContain('workflow_dispatch')
  })
})
