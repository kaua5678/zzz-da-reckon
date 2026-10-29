/**
 * 属性配置页「危局环境 Buff」卡的数据面判据（2026-10-26）。
 *
 * 背景（用户原话）：「属性修改下面也列出了很多队友，似乎用不到了。右边是自创buff，没看到危局期数的环境buff」。
 * 本文件锁三件事：
 * ① 期数 → 环境 buff 的解析口径（期视图缺 = null，不编；layer 段只在「已应用 Boss 且正是本期」出现）；
 * ② 「当前选中哪张牌」由**全局 Buff 表本身**派生（不另存页面态）——别页写入 / 手删行都要如实反映；
 * ③ 页面源码锁：选牌的写入唯一入口是 `applyPeriodBuff`（与实战对比部署页同一条通道），
 *    且页面**不试算**（C 档用户口径，ENGINE_PIPELINE_GUIDE §4 坑 53）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  sortedPhaseViews, resolvePhaseEnvironment,
  phaseBuffCardSignature, periodBuffRowsOf, layerBuffRowsOf, periodBuffRowSignature, selectedPeriodBuffCard,
} from '@/utils/phaseBuff'
import type { BossPresetFile, PhaseBuffCard, PhaseView } from '@/types/bossPreset'

const bp = JSON.parse(
  readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
) as BossPresetFile
const views = bp.phaseViews as PhaseView[]

/** 最小行（只需要 id，判定都按前缀） */
const row = (id: string) => ({ id })
const card = (title: string, effects: Array<{ stat: string; value: number }>): PhaseBuffCard =>
  ({ title, testOnly: false, effects, unparsed: [] }) as PhaseBuffCard

describe('期视图排序 / 缺省期', () => {
  it('最新期 = begin 最晚的一期（数据里已是新→旧，排序只兜底）', () => {
    const sorted = sortedPhaseViews(bp)
    expect(sorted.length).toBe(views.length)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].begin >= sorted[i].begin, `第 ${i} 期不该比前一期更新`).toBe(true)
    }
    // 数据本身已是新→旧 ⇒ 兜底排序不许改变口径（首项仍是数据里的最新一期）
    expect(sorted[0].phaseId).toBe(views[0]!.phaseId)
  })

  it('没有期视图 ⇒ 不编一期出来（空表；「缺省期」由 composables/phaseSelection#defaultPhaseIdOf 给空串）', () => {
    expect(sortedPhaseViews(null)).toEqual([])
    expect(sortedPhaseViews({ ...bp, phaseViews: [] })).toEqual([])
  })
})

describe('resolvePhaseEnvironment', () => {
  const phaseId = views[0].phaseId

  it('期视图存在 ⇒ 带出当期可选牌；未应用 Boss ⇒ layer 为 null', () => {
    const env = resolvePhaseEnvironment(bp, null, phaseId)
    expect(env).not.toBeNull()
    expect(env!.phaseId).toBe(phaseId)
    expect(env!.selectable).toEqual(views[0].buffs)
    expect(env!.layer).toBeNull()
  })

  it('期视图不存在 ⇒ null（页面显示空态，不编数据）', () => {
    expect(resolvePhaseEnvironment(bp, null, '999999')).toBeNull()
  })

  it('已应用的 Boss 不是本期 ⇒ 不给 layer（避免拿上期的关卡 buff 冒充本期环境）', () => {
    const other = views[1].phaseId
    const env = resolvePhaseEnvironment(bp, { presetId: '40009', phaseId: other }, phaseId)
    expect(env!.layer).toBeNull()
  })

  it('已应用 Boss 正是本期 ⇒ layer 取该 Boss 该期相位的 layerBuffs（与期视图 bossBuffs 同源）', () => {
    // 找一个「本期期视图里有、且该 Boss 有 layerBuff」的组合
    let found: { presetId: string; phaseId: string } | null = null
    for (const v of views) {
      for (const brief of [...(v.criticalAssault ? [v.criticalAssault] : []), ...v.defense]) {
        if (!brief.presetId) continue
        const phase = bp.bosses.find(b => b.id === brief.presetId)?.phases.find(p => p.phaseId === v.phaseId)
        if (phase && (phase.layerBuffs ?? []).some(c => c.effects.some(e => e.stat))) {
          found = { presetId: brief.presetId, phaseId: v.phaseId }
          break
        }
      }
      if (found) break
    }
    expect(found, '数据里应有 ≥1 个带数值关卡 buff 的「Boss × 期」').toBeTruthy()
    const env = resolvePhaseEnvironment(bp, found!, found!.phaseId)
    expect(env!.layer).not.toBeNull()
    expect(env!.layer!.presetId).toBe(found!.presetId)
    const phase = bp.bosses.find(b => b.id === found!.presetId)!.phases.find(p => p.phaseId === found!.phaseId)!
    expect(env!.layer!.cards).toEqual(phase.layerBuffs)
    expect(env!.layer!.bossName).toBe(bp.bosses.find(b => b.id === found!.presetId)!.name)
  })

  it('已应用 Boss 在预设表里查不到 ⇒ layer 也是 null（数据漂移不冒充）', () => {
    const env = resolvePhaseEnvironment(bp, { presetId: 'no-such-boss', phaseId }, phaseId)
    expect(env!.layer).toBeNull()
  })
})

describe('当期牌 ←→ 全局 Buff 表（选中态由表派生，不另存页面状态）', () => {
  const phaseId = '690501'
  const a = card('甲', [{ stat: 'critDmg', value: 40 }, { stat: 'windDmg', value: 30 }])
  const b = card('乙', [{ stat: 'atkPct', value: 10 }])
  const rowsOfCard = (c: PhaseBuffCard) => c.effects.map(e => row(`period-buff:${phaseId}:${e.stat}:${e.value}`))

  it('行前缀只认本期（别期的行不算选中）', () => {
    const rows = [...rowsOfCard(a), row('period-buff:690491:atkPct:10')]
    expect(periodBuffRowsOf(rows, phaseId).length).toBe(a.effects.length)
    expect(periodBuffRowsOf(rows, '690491').length).toBe(1)
  })

  it('表里是甲的这批行 ⇒ 选中 = 甲；与写入顺序无关（签名排序）', () => {
    const scrambled = [...rowsOfCard(a)].reverse()
    expect(selectedPeriodBuffCard(scrambled, phaseId, [a, b])?.title).toBe('甲')
  })

  it('表里的行不对应下面任何一张牌（如别页按 phase-buff: 写）⇒ null，不假装选中', () => {
    expect(selectedPeriodBuffCard([row('phase-buff:某牌:0')], phaseId, [a, b])).toBeNull()
    // 签名只看已按前缀筛过的行（filter 在 periodBuffRowsOf 里做）⇒ 空表签名 = 空串
    expect(periodBuffRowSignature([])).toBe('')
  })

  it('没有本期行 ⇒ null（页面据此显示「不用」）', () => {
    expect(selectedPeriodBuffCard([row('b1')], phaseId, [a, b])).toBeNull()
  })

  it('★ 同 stat+value 的两张牌签名相同 ⇒ 按签名匹配天然分不开，但签名本身必须稳定（不随 effects 顺序变）', () => {
    const twin = card('甲2', [{ stat: 'critDmg', value: 40 }, { stat: 'windDmg', value: 30 }])
    expect(phaseBuffCardSignature(twin)).toBe(phaseBuffCardSignature(a))
    const reversed = { ...a, effects: [...a.effects].reverse() } as PhaseBuffCard
    expect(phaseBuffCardSignature(reversed)).toBe(phaseBuffCardSignature(a))
  })

  it('关卡行按 (presetId, phaseId) 两段前缀匹配（换 Boss / 换期即不匹配）', () => {
    const rows = [row('layer-buff:40009:690501:atkPct:20'), row('layer-buff:40010:690501:atkPct:20')]
    expect(layerBuffRowsOf(rows, '40009', '690501').length).toBe(1)
    expect(layerBuffRowsOf(rows, '40009', '690491').length).toBe(0)
  })
})

describe('真数据：每期都至少有环境数据可看', () => {
  it('全部期视图都能解析出环境（selectable 可空，但对象必须存在）', () => {
    let withSelectable = 0
    for (const v of views) {
      const env = resolvePhaseEnvironment(bp, null, v.phaseId)
      expect(env, v.phaseId).not.toBeNull()
      if (env!.selectable.length > 0) withSelectable++
    }
    expect(withSelectable, '至少应有若干期带可选牌（全空说明解析/数据断了）').toBeGreaterThan(0)
  })
})

describe('页面源码锁：选牌走唯一写入入口、页面不试算', () => {
  /** 页面源码（去注释：注释里会引用前缀名，不算实现） */
  const page = () => readFileSync(new URL('../../views/AttributeConfigPage.vue', import.meta.url), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('★ 写入只经 applyPeriodBuff（不自己拼 period-buff: 行、不直接改 globalBuffs）', () => {
    const src = page()
    expect(src, '必须调用 applyPeriodBuff').toMatch(/applyPeriodBuff\(configStore, envPhaseId\.value, card\)/)
    // 行 id 的拼装只许在跑 archiveDeploy / phaseBuff 里（页面里出现该前缀只作为**说明文案**，故只看模板串/字面量拼装）
    expect(src, '不许在页面里拼 period-buff: 行 id').not.toMatch(/[`'"](?:period|layer)-buff:\$\{/)
    expect(src, '不许在页面里拼 layer-buff: 行 id').not.toMatch(/[`'"](?:period|layer)-buff:[a-z]/i)
    expect(src, '不许直接改全局 Buff 表').not.toMatch(/globalBuffs\.(?:push|splice|value\s*=)/)
  })

  it('★ 页面不拿伤害做「自动选最优」（C 档用户口径，坑 53）', () => {
    const src = page()
    expect(src).not.toMatch(/teamTotalDamage/)
    expect(src).not.toMatch(/pickBestPeriodBuff/)
  })

  it('★ 关卡固有 buff 只读展示：页面不得调 applyBossLayerBuffs / applyBossRoom（房间入口唯一）', () => {
    const src = page()
    expect(src).not.toMatch(/applyBossLayerBuffs|applyBossRoom/)
  })
})
