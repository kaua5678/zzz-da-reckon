/**
 * 引擎探针 —— 面板事实源（防手工汇总 JSON 出错，见 docs/ENTITY_CARDS.md）。
 *
 * 用途：派生数值（暴击预算、面板攻血防、局内 buff 生效结果）**以引擎为权威**。
 * AI/用户想回答「某角色带某音擎暴击率多少」「还差几条暴击词条百暴」时跑本探针，
 * 不要手工从 catalog.json 加总（2026-08-30 事故：手工汇总漏读音擎 effect.selfBuff 的
 * 精炼暴击率，口径直接错）。
 *
 * 运行（gen:multiplier-record 同款环境变量驱动模式）：
 *   PROBE_AGENT=1371 npm run probe:panel
 *   PROBE_AGENT=1371 PROBE_SUBSTATS="critRate=20,hpPct=6" npm run probe:panel
 *   PROBE_AGENT=1371 PROBE_ENGINE=14132 PROBE_MOD=5 PROBE_CINEMA=6 PROBE_FOUR=32700 PROBE_TWO=31000 npm run probe:panel
 *
 * 默认口径：音擎=专武(ownerAgentId 反查) 精炼1 · 命座0 · 主词条/套装=配装推荐 · 副词条空。
 * 未设 PROBE_AGENT 时空跑（普通 vitest run 不输出、不污染测试结果）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Agent, WEngine, DriveDiscConfig, DriveDiscSet, StatRules } from '@/types/catalog'
import { calcPanel } from '@/core/panel'
import { REC_MAIN_STAT_MAP } from '@/stores/config'

const catalog = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as { agents: Agent[]; wEngines: WEngine[]; driveDiscSets: DriveDiscSet[]; statRules: StatRules }
const recs = JSON.parse(
  readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8'),
) as { characters: Record<string, { main_stats?: Record<string, { name: string }>; drive_disc_sets?: { four_piece?: { name_zh?: string }; two_piece?: { name_zh?: string } } }> }

function resolveAgent(token: string): Agent {
  const byId = catalog.agents.find(a => String(a.id) === token)
  if (byId) return byId
  const byName = catalog.agents.filter(a => a.name.zhCN === token || a.name.en === token)
  if (byName.length === 1) return byName[0]
  const bySub = catalog.agents.filter(a => (a.name.zhCN ?? '').includes(token))
  if (bySub.length === 1) return bySub[0]
  throw new Error(`角色「${token}」未命中或歧义（${bySub.length} 个子串候选）——用 id 或全名`)
}

const env = process.env
const probeAgent = env.PROBE_AGENT
const probing = probeAgent != null && probeAgent !== ''

function buildProbeInput() {
  const agent = resolveAgent(probeAgent!)
  const sig = catalog.wEngines.find(e => String(e.ownerAgentId) === String(agent.id))
  const engineToken = env.PROBE_ENGINE ?? ''
  const wEngine = engineToken
    ? catalog.wEngines.find(e => String(e.id) === engineToken || e.name.zhCN === engineToken || e.name.en === engineToken)
    : sig
  if (engineToken && !wEngine) throw new Error(`音擎「${engineToken}」未命中`)

  const rec = recs.characters[String(agent.id)]
  const mainStats: Record<number, string> = {}
  for (const slot of [4, 5, 6] as const) {
    const name = rec?.main_stats?.[String(slot)]?.name
    mainStats[slot] = (name ? REC_MAIN_STAT_MAP[name] : undefined) ?? ''
  }
  const setByName = (n?: string) => catalog.driveDiscSets.find(s => s.name.zhCN === n)?.id ?? ''
  const driveDiscConfig: DriveDiscConfig = {
    fourPieceSetId: env.PROBE_FOUR ?? setByName(rec?.drive_disc_sets?.four_piece?.name_zh),
    twoPieceSetId: env.PROBE_TWO ?? setByName(rec?.drive_disc_sets?.two_piece?.name_zh),
    mainStats: mainStats as DriveDiscConfig['mainStats'],
    subStatAllocation: {},
  }
  for (const pair of (env.PROBE_SUBSTATS ?? '').split(',').filter(Boolean)) {
    const [stat, n] = pair.split('=')
    driveDiscConfig.subStatAllocation[stat] = Number(n)
  }
  return { agent, wEngine, driveDiscConfig }
}

describe('引擎探针：面板事实源', () => {
  it(probing ? `probe ${probeAgent}` : '未设 PROBE_AGENT 时空跑（用法见文件头注释）', () => {
    if (!probing) return
    const { agent, wEngine, driveDiscConfig } = buildProbeInput()
    const setsMap = new Map(catalog.driveDiscSets.map(s => [s.id, s]))
    const result = calcPanel(agent, wEngine, driveDiscConfig, setsMap, [], catalog.statRules, {
      cinemaLevel: Number(env.PROBE_CINEMA ?? 0),
      wEngineModLevel: Number(env.PROBE_MOD ?? 1),
    })

    const fmt = (p: { atk?: number; hp?: number; def?: number; critRate?: number; critDmg?: number; anomalyProficiency?: number; dmgBonus?: number }) =>
      `ATK ${p.atk?.toFixed(0)} · HP ${p.hp?.toFixed(0)} · DEF ${p.def?.toFixed(0)} · 暴击 ${(p.critRate ?? 0).toFixed(1)}%/${(p.critDmg ?? 0).toFixed(0)}% · 精通 ${p.anomalyProficiency ?? 0} · 增伤 ${(p.dmgBonus ?? 0).toFixed(0)}%`

    console.log(`== 探针 ${agent.name.zhCN}(${agent.id}) · 音擎 ${wEngine ? `${wEngine.name.zhCN}(${wEngine.id}) 精炼${env.PROBE_MOD ?? 1}` : '无'} · 命座 ${env.PROBE_CINEMA ?? 0} ==`)
    console.log(`  基础(白值):    ${fmt(result.base)}`)
    console.log(`  +驱动盘主词条: ${fmt(result.withDiscs)}`)
    console.log(`  局外:          ${fmt(result.outOfCombat)}`)
    console.log(`  局内:          ${fmt(result.inCombat)}`)
    console.log(`  副词条: ${JSON.stringify(driveDiscConfig.subStatAllocation)} · 主词条 ${JSON.stringify(driveDiscConfig.mainStats)} · 套装 ${driveDiscConfig.fourPieceSetId || '无'}+${driveDiscConfig.twoPieceSetId || '无'}`)

    const crit = result.inCombat.critRate ?? 0
    const step = catalog.statRules.driveDisc.sRankSubStatBaseStep.critRate
    if (crit < 100) {
      console.log(`  百暴缺口: ${(100 - crit).toFixed(1)}% ≈ 还需 ${Math.ceil((100 - crit) / step)} 条 critRate 副词条（步长 ${step}）`)
    } else {
      console.log(`  暴击已溢出 ${crit.toFixed(1)}%（inCombat 口径，超 100 部分无效）`)
    }

    // 最小有效性断言：探针输出必须是非空有限面板
    expect(Number.isFinite(result.inCombat.atk)).toBe(true)
    expect(result.inCombat.atk).toBeGreaterThan(0)
  })
})
