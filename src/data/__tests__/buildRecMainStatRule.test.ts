/**
 * 邦布精灵配装推荐 · 主词条规则的机器护栏（2026-10-20）。
 *
 * 为什么有这条：`build-recommendations.json` 的 4/5/6 主词条此前用「候选全局贪心」生成，
 * 与 nanoka 页面显示不一致（实测 24/62 角色），且给 1631/1641 写出了**该槽不合法**的词条
 * （5 槽暴伤 / 6 槽穿透 / 4 槽掌控 / 5 槽精通 / 6 槽火伤）。这类错误不会让任何 UI 报错——
 * 推荐块照常渲染，用户照着配出的是打不出的盘。
 *
 * 判据（三条，各自拦一种真实失败模式）：
 *   ① **合法槽**：每条推荐的主词条必须在该槽合法词条池里（`SLOT_POOL_IDS`）。
 *      失败模式 = 数据里出现「4 槽暴伤以外 / 6 槽穿透」这种游戏内不可能存在的盘。
 *   ② **规则可复现**：用存档 raw（`data/raw/nanoka_missing/full/<id>.json`）按站点规则重算，
 *      必须与 `build-recommendations.json` 逐槽一致。失败模式 = 有人手改 JSON / 忘了重跑同步脚本。
 *   ③ **规则本体**：`assignMainStatProps` 对三个既有夹具（1431/1461/1571，规则推广当年的
 *      人工条目）与 1581（用户 2026-10-20 指出的案例：6 号位 ATK% 优先于能量回复）给出预期值。
 *      失败模式 = 规则被改成「按槽位顺序转发候选」，会把 6 槽答案错抽成下一个候选。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assignMainStatProps, isLegalMainStatProp, SLOT_POOL_IDS } from '../../../scripts/lib/build-recommendation-rule.mjs'

const build = JSON.parse(
  readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8'),
) as { characters: Record<string, { name: { zhCN: string }; main_stats?: Record<string, { prop: string; name: string }> }> }

const RAW_DIR = new URL('../../../data/raw/nanoka_missing/full/', import.meta.url)

function readRaw(agentId: string) {
  return JSON.parse(readFileSync(new URL(`${agentId}.json`, RAW_DIR), 'utf8')) as {
    fairy_recommend?: Record<string, { prop?: number | string } | undefined>
  }
}

describe('配装推荐主词条（nanoka 站点规则）', () => {
  it('每条推荐的主词条都在该槽合法池里（1631/1641 曾整组非法）', () => {
    const offenders: string[] = []
    for (const [id, rec] of Object.entries(build.characters)) {
      for (const slot of [4, 5, 6] as const) {
        const stat = rec.main_stats?.[String(slot)]
        if (!stat) continue
        if (!isLegalMainStatProp(slot, stat.prop)) {
          offenders.push(`${id} ${rec.name.zhCN} ${slot}号位=${stat.name}(prop ${stat.prop})；合法池=${SLOT_POOL_IDS[slot].join('/')}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('用存档 raw 按站点规则重算，与 JSON 逐槽一致（防手改/漏重跑）', () => {
    const rawIds = new Set(readdirSync(RAW_DIR).filter(f => /^\d+\.json$/.test(f)).map(f => f.replace('.json', '')))
    const drift: string[] = []
    for (const [id, rec] of Object.entries(build.characters)) {
      // 无 raw 存档的角色（老角色）只能靠 ① 的合法槽判据兜底
      if (!rawIds.has(id)) continue
      const want = assignMainStatProps(readRaw(id).fairy_recommend)
      for (const slot of [4, 5, 6] as const) {
        const got = rec.main_stats?.[String(slot)]?.prop ?? null
        const exp = want[slot] ?? null
        if (got !== exp) drift.push(`${id} ${rec.name.zhCN} ${slot}号位：JSON=${got ?? '空'} 规则=${exp ?? '空'}`)
      }
    }
    expect(drift, drift.join('\n')).toEqual([])
  })

  it('规则本体：夹具 + 用户指出的 1581（6 号位 ATK% 优先于能量回复）', () => {
    // 1431/1461/1571 = 规则推广时的人工条目，站点规则必须逐位复现
    expect(assignMainStatProps(readRaw('1431').fairy_recommend)).toEqual({ 4: '21103', 5: '31503', 6: '12102' })
    expect(assignMainStatProps(readRaw('1461').fairy_recommend)).toEqual({ 4: '20103', 5: '31803', 6: '12102' })
    expect(assignMainStatProps(readRaw('1571').fairy_recommend)).toEqual({ 4: '20103', 5: '31603', 6: '30502' })
    // 1581 蕾米埃尔：part6 是能量自动回复，但 part5=ATK% 也是 6 槽合法 ⇒ 6 槽取 ATK%（页面显示 ATK% › Energy Regen）
    expect(assignMainStatProps(readRaw('1581').fairy_recommend)).toEqual({ 4: '31203', 5: '12102', 6: '12102' })
    // 1631/1641：旧贪心写出的非法盘，站点规则给出合法盘
    expect(assignMainStatProps(readRaw('1631').fairy_recommend)).toEqual({ 4: '20103', 5: '23103', 6: '12102' })
    expect(assignMainStatProps(readRaw('1641').fairy_recommend)).toEqual({ 4: '31203', 5: '31603', 6: '31402' })
  })

  it('站点不展示 alt_build 候选：alt 里的词条不得改变槽位答案', () => {
    // 1581 的 alt_build 含 31203/12102；若误把它们并进候选池，6 槽会先命中 31203（非法）再命中 12102，看似无差，
    // 但 1641 这类角色会被 alt 的 12102 顶掉「掌控」⇒ 用 1641 钉住这一点。
    const fr = readRaw('1641').fairy_recommend as Record<string, unknown>
    const withAlt = { ...fr, alt_build: [{ suit_list: [], part_sub_list: [11102] }] }
    expect(assignMainStatProps(withAlt)).toEqual(assignMainStatProps(fr))
  })
})
