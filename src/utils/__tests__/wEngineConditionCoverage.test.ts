/**
 * 音擎效果行的覆盖率滑块必须覆盖「有触发条件但无 coverage 字段」的效果（2026-10-18）。
 *
 * 与驱动盘 `discEffectRows#adjustable` 同一口径：`condition` 是触发信号 ⇒ 要给 uptime 滑块。
 * 修前 `TeamConfigPage#collectWEngineGroupEffects` 的判据只有 stacked/coverage/durationSeconds，
 * 于是「拥有充能效果」「从背后攻击命中」「拥有 2 层增益效果」这类**既无时长也无 coverage** 的条件效果
 * 既没有滑块、引擎又恒按 100% 结算 —— 用户看不出这条按多少覆盖率算的。
 *
 * 本测试直接读 catalog 数据 + 与页面同一条判据（源码锁：判据必须包含 `condition`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const catalog = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as { wEngines: { id: string; name?: { zhCN?: string }; effect?: { selfBuff?: { effects?: { stat?: string; condition?: string; coverage?: unknown; durationSeconds?: number | null; type?: string }[]; durationSeconds?: number | null }; teamBuff?: { effects?: { stat?: string; condition?: string; coverage?: unknown; durationSeconds?: number | null; type?: string }[]; durationSeconds?: number | null } } }[] }

const page = readFileSync(new URL('../../views/TeamConfigPage.vue', import.meta.url), 'utf8')

/** 页面里的判据（与 TeamConfigPage#collectWEngineGroupEffects 同形） */
function hasCoverage(e: { type?: string; coverage?: unknown; condition?: string; durationSeconds?: number | null }, groupDuration?: number | null): boolean {
  return e.type === 'stacked' || !!e.coverage || !!e.condition || e.durationSeconds != null || groupDuration != null
}

describe('音擎条件效果有覆盖率滑块', () => {
  it('源码锁：页面判据必须含 condition（否则条件类效果又变成「恒开」）', () => {
    expect(page, 'collectWEngineGroupEffects 的 hasCoverage 判据丢了 condition').toMatch(
      /hasCoverage:[\s\S]{0,240}?\|\| !!effect\.condition/,
    )
  })

  it('catalog 里所有带 condition 的音擎效果都满足判据', () => {
    const missing: string[] = []
    for (const w of catalog.wEngines) {
      for (const group of [w.effect?.selfBuff, w.effect?.teamBuff]) {
        for (const e of group?.effects ?? []) {
          if (!e.stat || !e.condition) continue
          if (!hasCoverage(e, group?.durationSeconds)) missing.push(`${w.id} ${w.name?.zhCN ?? ''} ${e.stat}（${e.condition}）`)
        }
      }
    }
    expect(missing, `条件效果缺滑块：\n${missing.join('\n')}`).toEqual([])
  })
})
