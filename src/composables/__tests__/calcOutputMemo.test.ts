/**
 * calcOutput 记忆化的等价性与失效性（2026-09-23 mcp-engine）。
 *
 * ① 搜索型调用（难度爬梯：大量「改 → 读 → 改回」）在记忆化开/关下**逐位相同**，且确有命中；
 * ② 命中后改任何进键的输入都会失效（改 store 字段 / 机制参数 / 行融合规则），不返回陈旧结果；
 * ③ （已删：原「降配单调闸门开启时绕过记忆化」随闸门删除，T23；编号保留，历史文档按 ④⑤ 引用。）
 * ④ 审查补测（ENG-R1）：冷热启动缓存下 on/off 对照、命中结果被深冻结后下游仍逐位相同（下游不原地改）、
 *    目录整体替换失效、纯 UI 态（切 tab/切槽）不失效也不改值。
 * ⑤ CC-354/355 源码锁：记忆化键深读 config.$state ⇒ 写入即失效，不存在「手动失效」这个概念。
 *    src 代码行（注释除外）不得出现 `refreshTrigger` / `triggerRefresh`；store 外的新输入必须做成响应式。
 * ⑥ r707：LRU 跨实例共享（模块级）——第二个实例读同一状态只命中，不再算一遍外层不动点。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useUiStore } from '@/stores/ui'
import { getCalcOutputMemoStats, setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { applyTimeWeightAllocation } from '@/composables/timeWeightAllocation'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import { teamPresets } from '@/data/teamPresets'
import { DEFAULT_STUN_PLAN_PROJECTION_CODE } from '@/core/stunPlanProjection'

beforeEach(() => { newPinia(); mockStaticFetch() })
afterEach(() => { setCalcOutputMemoEnabled(true); setActiveRowFusionRules([]) })

async function runSearch(memo: boolean, presetId: string) {
  setCalcOutputMemoEnabled(memo)
  newPinia(); mockStaticFetch()
  const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  applyTeamToStore(config, teamPresets.find(p => p.id === presetId)!)
  config.timeWeightStrategy = 'static'
  const trail: number[] = [calc.teamTotalDamage.value]
  // 边际均衡：内部大量「试改权重 → 读伤害 → 还原」
  applyTimeWeightAllocation({ calc, configStore: config }, 'marginal-equalize')
  trail.push(calc.teamTotalDamage.value)
  // 手工回滚循环：改机制参数再改回，读数必须回到原值
  const before = calc.teamTotalDamage.value
  // 改走再改回：「回」= 缺省编码（不写死 0，否则切缺省时本用例误红，CC-144 第 168 轮）
  const alt = DEFAULT_STUN_PLAN_PROJECTION_CODE === 2 ? 3 : 2
  config.setMechanicSetting('time.stunPlanProjection', alt)
  trail.push(calc.teamTotalDamage.value)
  config.setMechanicSetting('time.stunPlanProjection', DEFAULT_STUN_PLAN_PROJECTION_CODE)
  trail.push(calc.teamTotalDamage.value)
  expect(calc.teamTotalDamage.value).toBe(before)
  const rr = calc.resourceResult.value!
  return { trail, weights: config.team.map(c => c.basicAttackTimeWeight), counts: rr.characters.map(c => [c.exSpecialCount, c.ultimateCount, c.timeAllocation?.necessaryTime]) }
}

describe('calcOutput 记忆化', () => {
  it('搜索型调用：记忆化开/关逐位相同，且确有命中', async () => {
    // 夹具沿革（2026-10-09，预设库重生成 85→77 条）：原 `auto-1521-1361-1311`（希希芙/「扳机」/耀嘉音）
    // 新库无此组合 ⇒ 换槽序改名后的 `auto-1521-1481-1311`（希希芙/琉音/耀嘉音，同主C 希希芙）。
    for (const id of ['auto-1521-1481-1311', 'banyue-liuyin-lucia']) {
      const off = await runSearch(false, id)
      const s0 = getCalcOutputMemoStats()
      const on = await runSearch(true, id)
      const s1 = getCalcOutputMemoStats()
      expect(on, id).toEqual(off)
      expect(s1.hits - s0.hits, `${id} 应有命中`).toBeGreaterThan(0)
    }
  }, 300_000)

  it('失效：store 字段 / 机制参数 / 行融合规则变化都不返回陈旧结果', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1521-1481-1311')!)
    config.timeWeightStrategy = 'static'
    const d0 = calc.teamTotalDamage.value
    // 命座（store 字段）
    const c0 = config.team[0]!.cinemaLevel
    config.setCinemaLevel(0, c0 === 6 ? 0 : 6)
    const d1 = calc.teamTotalDamage.value
    expect(d1).not.toBe(d0)
    config.setCinemaLevel(0, c0)
    expect(calc.teamTotalDamage.value).toBe(d0)
    // 敌方（深层嵌套字段、非 action 直接写）
    const hp = config.enemy.defense
    config.enemy.defense = hp * 2
    expect(calc.teamTotalDamage.value).not.toBe(d0)
    config.enemy.defense = hp
    expect(calc.teamTotalDamage.value).toBe(d0)
    // 行融合规则（store 之外的全局响应式输入）：把主 C 平A 的伤害行 ×2
    const rr = calc.resourceResult.value!
    const exec = rr.characters[0]!.executions.find(e => e.moveId !== 'basic_attack' && e.count > 0)!
    setActiveRowFusionRules([{ id: 'x', moveId: String(exec.moveId), rowId: 'damage', multiplier: 2, enabled: true } as never])
    const d2 = calc.teamTotalDamage.value
    expect(d2).toBeGreaterThan(d0)
    setActiveRowFusionRules([])
    expect(calc.teamTotalDamage.value).toBe(d0)
  }, 300_000)

  it('清空热启动缓存后，同配置记忆化开/关逐位相同（命中不依赖热启动种子）', async () => {
    const read = async (memo: boolean) => {
      setCalcOutputMemoEnabled(memo)
      newPinia(); mockStaticFetch()
      const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      applyTeamToStore(config, teamPresets.find(p => p.id === 'banyue-liuyin-lucia')!)
      config.timeWeightStrategy = 'static'
      const first = calc.teamTotalDamage.value
      // 换一个配置再回来：memo 开 ⇒ 命中；memo 关 ⇒ 热启动种子重算。两边必须相同
      config.setMechanicSetting('time.stunPlanProjection', 2)
      void calc.teamTotalDamage.value
      config.setMechanicSetting('time.stunPlanProjection', 0)
      return [first, calc.teamTotalDamage.value, JSON.stringify(calc.resourceResult.value?.characters.map(c => [c.exSpecialCount, c.ultimateCount]))]
    }
    expect(await read(true)).toEqual(await read(false))
  }, 300_000)

  it('命中返回的结果被深冻结后，下游 computed 仍逐位相同（全链路不原地改结果）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'banyue-liuyin-lucia')!)
    config.timeWeightStrategy = 'static'
    // 先显式写入往返用的机制参数（「缺省缺键」与「写成 0」是两个不同的 state）
    config.setMechanicSetting('time.stunPlanProjection', 0)
    const d0 = calc.teamTotalDamage.value
    const rows0 = JSON.stringify(calc.damagePoolRows.value.map(r => [r.slot, r.moveId, r.totalDamage]))
    const deepFreeze = (o: unknown, seen = new Set<unknown>()): void => {
      if (o === null || typeof o !== 'object' || seen.has(o)) return
      seen.add(o); Object.freeze(o)
      for (const v of Object.values(o as object)) deepFreeze(v, seen)
    }
    deepFreeze(calc.resourceResult.value)
    deepFreeze(calc.stunPoolResult.value)
    deepFreeze(calc.anomalyPoolResult.value)
    // 离开再回来 ⇒ 命中同一（已冻结）对象 ⇒ 全部下游 computed 从冻结对象重建；原地写会在严格模式抛错
    config.setMechanicSetting('time.stunPlanProjection', 2)
    void calc.teamTotalDamage.value
    const s0 = getCalcOutputMemoStats()
    config.setMechanicSetting('time.stunPlanProjection', 0)
    expect(calc.teamTotalDamage.value).toBe(d0)
    const s1 = getCalcOutputMemoStats()
    expect({ hits: s1.hits - s0.hits, misses: s1.misses - s0.misses, bypass: s1.bypass - s0.bypass }).toEqual({ hits: 1, misses: 0, bypass: 0 })
    expect(JSON.stringify(calc.damagePoolRows.value.map(r => [r.slot, r.moveId, r.totalDamage]))).toBe(rows0)
    void calc.damageSourceBreakdown.value
    void calc.anomalyDamageEvents.value
    void calc.stackTraversalResult.value
    void calc.specialActionBonus.value
  }, 300_000)

  it('目录整体替换会失效；纯 UI 态（切 tab / 切槽）不失效、不改值', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1521-1481-1311')!)
    config.timeWeightStrategy = 'static'
    const d0 = calc.teamTotalDamage.value
    // 纯界面态住在 ui store（CC-356）：不在 config `$state` 里 ⇒ 不进键、不重算
    expect(Object.keys(config.$state)).not.toContain('activeTab')
    expect(Object.keys(config.$state)).not.toContain('selectedSlot')
    const ui = useUiStore()
    const s0 = getCalcOutputMemoStats()
    ui.activeTab = ui.activeTab === 'team' ? 'result' : 'team'
    ui.selectSlot((ui.selectedSlot + 1) % 3)
    expect(calc.teamTotalDamage.value).toBe(d0)
    const s1 = getCalcOutputMemoStats()
    expect(s1.misses).toBe(s0.misses)
    // 目录整体替换（值相同、身份不同）⇒ 必须重算（miss），且值不变
    catalog.catalog = { ...catalog.catalog! }
    expect(calc.teamTotalDamage.value).toBe(d0)
    expect(getCalcOutputMemoStats().misses).toBeGreaterThan(s1.misses)
  }, 300_000)

  it('r707：记忆化跨实例共享——第二个实例读同一状态只命中、不重算', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1521-1481-1311')!)
    config.timeWeightStrategy = 'static'
    const d0 = useResourceCalc().teamTotalDamage.value
    const s0 = getCalcOutputMemoStats()
    // = 应用级时间权重分配读页面实例刚算过的状态（r707 探针）；实例私有 LRU 会再算一遍外层不动点
    expect(useResourceCalc().teamTotalDamage.value).toBe(d0)
    const s1 = getCalcOutputMemoStats()
    expect({ hits: s1.hits - s0.hits, misses: s1.misses - s0.misses }).toEqual({ hits: 1, misses: 0 })
  }, 300_000)

  it('CC-354/355：不存在手动失效（无 refreshTrigger / triggerRefresh，写入即失效）', () => {
    const root = resolve(__dirname, '../..')
    const files: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'test') walk(p) }
        else if (/\.(ts|vue)$/.test(n)) files.push(p)
      }
    }
    walk(root)
    const comment = /^\s*(\/\/|\*|\/\*|<!--)/
    const hits: string[] = []
    for (const p of files) {
      const rel = relative(root, p).split('\\').join('/')
      readFileSync(p, 'utf-8').split('\n').forEach((line, i) => {
        if (!comment.test(line) && /\b(refreshTrigger|triggerRefresh)\b/.test(line.replace(/\/\/.*$/, ''))) hits.push(`${rel}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
    // 自证：判据能抓到旧形态
    expect(/\b(refreshTrigger|triggerRefresh)\b/.test('    configStore.refreshTrigger')).toBe(true)
  })
})
