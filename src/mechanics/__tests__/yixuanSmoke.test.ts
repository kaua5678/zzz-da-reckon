import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentSpec } from '@/specs/registry'
import { computeYixuanExChain, computeYixuanNingshenBonus } from '@/mechanics/agents/yixuan'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const teammateBuffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    if (String(url).includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (String(url).includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(teammateBuffsText) }
    return { ok: false, json: async () => ({}) }
  }))
})

function teamChar(slot: number, agentId: string, cinemaLevel = 0, overrides: Partial<{ blockCount: number; dodgeCounterCount: number; yixuanInk2Count: number; yixuanInk3Count: number; yixuanPerfectBlockCount: number; yixuanBackstageComboCount: number }> = {}) {
  return {
    slot,
    agentId,
    cinemaLevel,
    wEngineId: '',
    wEngineModLevel: 1,
    driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} },
    parryCount: 6,
    blockCount: 0,
    dodgeCounterCount: 10,
    quickAssistCount: 3,
    chainCountPerStun: 1,
    basicAttackTimeWeight: 1,
    ...overrides,
  }
}

describe('仪玄 spec 机制（1371）', () => {
  it('spec 注册：资源/事件/额外能力条件齐全，事件 moveId 指向倍率表正确行', () => {
    const spec = getAgentSpec('1371')!
    expect(spec.resources.map(r => r.id)).toEqual(['yixuan_shufa_value', 'yixuan_xuanmo_value'])
    expect(spec.additionalAbility?.teamConditions).toEqual([
      { type: 'specialty', values: ['stun', 'support', 'defense'] },
    ])
    expect(spec.events.find(e => e.id === 'yixuan_extra_ult_execution')?.carrierMoveId).toBe('1371020')
    // 玄墨极阵事件已移除：合轴时由模块按玄墨值替换逻辑生成（min(合轴次数, 玄墨值) 次）
    expect(spec.events.some(e => e.id === 'yixuan_xuanmo_basic_execution')).toBe(false)
  })

  it('强特链分解：2连/3连墨痕化形 + 完美格挡 + 剩余全凝云（用户口径）', () => {
    // 收入 540：2连×2（40/次）+ 3连×1（60/次）+ 完美格挡×3（免费）→ 剩余 540-140=400 → 凝云 floor(400/60)=6
    const chain = computeYixuanExChain(540, 2, 1, 3, 0, 2)
    expect(chain.ink1).toBe(3)
    expect(chain.ink3).toBe(3)
    expect(chain.ink4).toBe(1)
    expect(chain.ink2).toBe(3)
    expect(chain.ashen).toBe(6)
    expect(chain.cloud).toBe(6)
    expect(chain.cloudOut).toBe(6)
    expect(chain.flashSpent).toBe(3 * 40 + 1 * 20 + 6 * 60)
    expect(chain.chainSeconds).toBeCloseTo(3 * 2.65 + 1 * 0.966 + 3 * 0.2 + 6 * 2.3, 3)

    // 全部凝云：无墨痕 → 9 循环
    const allCloud = computeYixuanExChain(540, 0, 0, 0, 0, 2)
    expect(allCloud.cloudOut).toBe(9)
    expect(allCloud.flashSpent).toBe(540)

    // 轴内凝云：2 次 × 蓄力 1s（耗能 20+20/次）→ 剩余 540-80=460 → 轴外 7 循环
    const axisChain = computeYixuanExChain(540, 0, 0, 0, 2, 1)
    expect(axisChain.axisCloud).toBe(2)
    expect(axisChain.cloudOut).toBe(7)
    expect(axisChain.flashSpent).toBe(2 * 40 + 7 * 60)
  })

  it('凝神 buff 轴：终结技块触发后 15s 窗口内动作暴伤+40%（影画6 附加贯穿+20%）', () => {
    const axes = [
      { actions: [
        { slot: 0, moveId: '1371014', count: 1, startTime: 0 }, // 大招触发凝神
        { slot: 0, moveId: '1371022', count: 2, startTime: 1 }, // 窗口内 → 暴伤40
        { slot: 0, moveId: '1371009', count: 1, startTime: 20 }, // 窗外 → 0
      ] },
    ]
    const bonus0 = computeYixuanNingshenBonus(0, axes, 0)
    expect(bonus0.get('1371022')).toEqual({ critDmg: 40, sheerDmg: 0 })
    expect(bonus0.has('1371009')).toBe(false)
    // 影画6 凝神（暴伤+40% + 贯穿+20%）已按用户口径改满覆盖（pushDirect 按滑块折算，不走轴扫描）：
    // 扫描函数只服务非 6 命（仅暴伤）
    const bonus6 = computeYixuanNingshenBonus(0, axes, 6)
    expect(bonus6.get('1371022')).toEqual({ critDmg: 40, sheerDmg: 0 })
  })

  it('全管线冒烟：交互链/术法值/符法千重/玄墨极阵产出，60% 招式限定增伤，玄墨异常分桶', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    // 仪玄(0命) + 青衣(击破) + 赛斯(防护)：额外能力触发；2连×2 + 3连×1 + 完美格挡×3 + 后台合轴×3
    config.team[0] = teamChar(0, '1371', 0, { yixuanInk2Count: 2, yixuanInk3Count: 1, yixuanPerfectBlockCount: 3, yixuanBackstageComboCount: 3 })
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const yixuan = out!.characters.find(c => c.agentId === '1371')!
    // 闪能池账本（收敛后实测，改动时按此逐项对账）：
    //   自动回复 360 + 进场赠送 120 + 破秽盾 60 + 额外闪能总账 180
    //     （额外总账 180 = 极限闪避 10×5 + 完美格挡 3×10 + 玄墨异常触发 4×10 + 极限支援落雷 12×5）
    //   + 队友终结技闪能 120（额外能力·玄墨暗涌：队友各 3 次终结 × 20，走 calcCrossAgentEnergy）
    //   = 840 → 循环当量 floor(840 / 60) = 14
    // 口径变更史：本行曾为 13，根因是 f20b2d5 修正了 transformSkillExecutions 语义
    //   （旧代码 `if (usesModuleTransform) continue` 让所有定义该钩子的模块——含仅做面板后处理的
    //   specPanelBuffs 面板 buff 模块——连非普攻失衡/积蓄提取一并被跳过）。赛斯(1271) 属该类模块，
    //   修正后其强特/终结/连携失衡值重新进池 → 失衡次数上升 → 连携/喧响上升 → 队友终结 2→3 次
    //   → 队友终结闪能 80→120，且玄墨异常触发 3→4（+10）→ 闪能池 790→840，当量 13→14。
    expect(yixuan.exSpecialCount).toBe(14)
    // 上游归因锚点：队友终结次数变动会直接改上面的账本，先看这条再查仪玄自身
    expect(out!.characters.filter(c => c.agentId !== '1371').map(c => c.ultimateCount)).toEqual([3, 3])
    // 展示口径 = 计算口径：队友联动回能已并入 energySource.total（含队友终结闪能 120）
    expect(yixuan.energySource.total).toBe(840)
    expect(yixuan.energySource.crossAgent.teamUltimateFlash).toBe(120)
    expect(yixuan.derivedEnergy).toBe(840)
    const chain = yixuan.yixuanExChain!
    expect(chain.ink1).toBe(3)
    expect(chain.ink4).toBe(1)
    // 循环当量 14 = 墨痕化形链 3 + 轴外凝云链 11（当量 13 时为 10，随上面的闪能账本联动）
    expect(chain.cloudOut).toBe(11)
    expect(chain.flashSpent).toBe(3 * 40 + 20 + 11 * 60) // = 800

    // 术法值 = 耗闪能 × 0.667 = 800 × 0.667 ≈ 533.6（转化基数 = chain.flashSpent，不是能量池总额）
    const shufa = yixuan.specResources?.['yixuan_shufa_value']
    expect(shufa.totalGain).toBeCloseTo(800 * 0.667, 1)
    const extraUlts = yixuan.executions.filter(e => e.moveId === '1371020')
    expect(extraUlts[0].count).toBe(4)
    expect(extraUlts[0].damageMultiplier).toBe(2932.5)

    // 玄墨极阵 = 符法千重次数（用户口径：1 次符法千重 → 1 次玄墨极阵）→ 倍率 611
    const xuanmoBasics = yixuan.executions.filter(e => e.moveId === '1371021')
    expect(xuanmoBasics[0].count).toBe(3)
    expect(xuanmoBasics[0].damageMultiplier).toBe(611)

    // 墨影凝云合轴（用户口径）：N=3，玄墨值 M=3（符法千重 3 次）→ N ≤ M 全打玄墨极阵+青溟震击（合轴，actionTime=0）
    const xuanmoStrike = yixuan.executions.find(e => e.moveId === '1371021')
    expect(xuanmoStrike).toBeTruthy()
    expect(xuanmoStrike!.count).toBe(3)
    expect(xuanmoStrike!.actionTime).toBe(0)
    expect(xuanmoStrike!.damageMultiplier).toBe(611) // 倍率表回填
    const qingmingStrike = yixuan.executions.find(e => e.moveId === '1371007')
    expect(qingmingStrike!.count).toBe(3)
    expect(qingmingStrike!.damageMultiplier).toBe(221.7)
    // 无超出部分 → 不打墨影凝云/A5
    expect(yixuan.executions.some(e => e.moveId === '1371005')).toBe(false)
    expect(yixuan.executions.some(e => e.moveId === '1371006')).toBe(false)
    // 聚墨·符法千重-破是影画2 专属：0 命不生成
    expect(yixuan.executions.some(e => e.moveId === '1371_fufa_po')).toBe(false)

    // 玄墨异常独立积蓄槽：所有执行 element = ether_ink（直伤元素仍走倍率表 ether）
    expect(yixuan.executions.length).toBeGreaterThan(0)
    for (const exec of yixuan.executions) {
      expect(exec.element).toBe('ether_ink')
    }

    // 极限支援换场落雷（额外能力）：默认次数 = 队友正常弹刀次数求和（6+6=12），225% 贯穿力
    const assistLightning = yixuan.executions.find(e => e.moveId === '1371_extreme_assist_lightning')
    expect(assistLightning).toBeTruthy()
    expect(assistLightning!.count).toBe(12)
    expect(assistLightning!.damageMultiplier).toBe(225)

    // 核心被动 60% 招式限定
    for (const exec of yixuan.executions) {
      if (['1371009', '1371023', '1371025', '1371022', '1371026', '1371021', '1371020', '1371014', '1371013'].includes(exec.moveId ?? '')) {
        expect(exec.dmgBonus ?? 0, `moveId ${exec.moveId} 应有 60% 招式限定增伤`).toBeGreaterThanOrEqual(60)
      }
    }
    // 全队伤害为正
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('4 失衡轴（3+1）：常规轴 3 窗 + 爆发轴 1 窗（含大招触发凝神 + 凝云），符法千重等事件执行不进轴', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1371')
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')
    // 用户口径：通常 4 失衡 = 前面 3 次按常规轴，最后 1 次按爆发轴（含大招+凝云）
    config.useStunAxis = true
    config.stunAxes = [
      { name: '常规轴', count: 3, actions: [{ slot: 0, moveId: '1371022', count: 1 }], basicFillerSlot: 0 },
      { name: '爆发轴', count: 1, actions: [
        { slot: 0, moveId: '1371014', count: 1, startTime: 0 }, // 青溟云影 → 凝神窗口
        { slot: 0, moveId: '1371022', count: 2, duration: 2, startTime: 2 }, // 凝云（满蓄）吃凝神
      ], basicFillerSlot: 0 },
    ]

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const yixuan = out!.characters.find(c => c.agentId === '1371')!
    const chain = yixuan.yixuanExChain!

    // 轴内凝云 = 常规轴 3 窗×1 + 爆发轴 1 窗×2 = 5（若失衡池收敛 4 次；不足则更少，但至少 >0）
    expect(chain.axisCloud).toBeGreaterThan(0)
    expect(chain.axisCloudSeconds).toBe(2)
    // 轴内行都带失衡强特 +30
    const axisCloud = yixuan.executions.find(e => e.moveId === '1371022' && e.actionTime === 2)
    expect(axisCloud).toBeTruthy()
    expect(axisCloud!.dmgBonus ?? 0).toBeGreaterThanOrEqual(90)
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('失衡轴模式：轴内凝云时长可调（duration 覆盖）、轴内行 +30% 失衡强特增伤、C1 落雷按轴内时间/CD 自动', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1371', 1) // 影画1：落雷按 CD 自动（轴模式 = floor(轴内时间/6)）
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')
    // 轴内每窗捏 2 次凝云术，蓄力 1s（可延长/缩短新机制）
    config.useStunAxis = true
    config.stunAxes = [
      {
        name: '轴1',
        count: 3,
        actions: [
          { slot: 0, moveId: '1371022', count: 2, duration: 1 },
        ],
        basicFillerSlot: 0,
      },
    ]

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const yixuan = out!.characters.find(c => c.agentId === '1371')!
    const chain = yixuan.yixuanExChain!

    // 轴内凝云：每窗 2 次、蓄力 1s（窗口数由失衡池收敛决定）；轴内消耗 40/次 → 剩余 → 轴外满蓄
    expect(chain.axisCloud).toBeGreaterThan(0)
    expect(chain.axisCloudSeconds).toBe(1)
    const income = yixuan.exSpecialCount * 60
    expect(chain.cloudOut).toBe(Math.floor((income - chain.axisCloud! * 40) / 60))

    // 轴内凝云执行：actionTime=1、倍率秒均折算 1343.9×0.5≈672、dmgBonus 含 +30（失衡强特）+60（核心被动）
    // （enrich 会把 moveName 回填成倍率表名，按 actionTime/倍率区分轴内/轴外行）
    const axisCloud = yixuan.executions.find(e => e.moveId === '1371022' && e.actionTime === 1)
    expect(axisCloud).toBeTruthy()
    expect(axisCloud!.count).toBe(chain.axisCloud)
    expect(axisCloud!.damageMultiplier).toBeCloseTo(672, 0)
    // 字段实现确认：轴内行 dmgBonus = 核心被动 60 + 失衡强特 30 = 90（buildExecutions 写入）
    expect(axisCloud!.dmgBonus).toBe(90)
    // 轴外凝云：满蓄回填、无失衡 +30（仅核心被动 60）
    const outCloud = yixuan.executions.find(e => e.moveId === '1371022' && e.actionTime === 2)
    expect(outCloud).toBeTruthy()
    expect(outCloud!.count).toBe(chain.cloudOut)
    expect(outCloud!.damageMultiplier).toBe(1343.9)
    // 轴外行：仅核心被动 60（无失衡 +30）
    expect(outCloud!.dmgBonus).toBe(60)

    // 影画1落雷按 CD 自动：轴内时间 = 窗口数×16s → floor(轴内时间/6) 次（少于非轴模式 floor(180/6)=30）
    const lightning = yixuan.executions.find(e => e.moveId === '1371_c1_lightning')
    expect(lightning).toBeTruthy()
    expect(lightning!.count).toBeGreaterThan(0)
    expect(lightning!.count).toBeLessThan(30)
    expect(lightning!.damageMultiplier).toBe(50)
  })

  it('墨影凝云合轴：N > 玄墨值时超出部分打墨影凝云+A5（用户口径）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    // 0命：符法千重 3 次（术法值 620×0.667≈413.5 → 3，默认 = 全部）；合轴次数 5 → 玄墨值替换 3 + 墨影凝云+A5 ×2
    config.team[0] = teamChar(0, '1371', 0, { yixuanInk2Count: 2, yixuanInk3Count: 1, yixuanPerfectBlockCount: 3, yixuanBackstageComboCount: 5 })
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')

    const calc = useResourceCalc()
    const out = calc.resourceResult.value!
    const yixuan = out.characters.find(c => c.agentId === '1371')!
    const extraUlts = yixuan.executions.filter(e => e.moveId === '1371020')
    const m = extraUlts.reduce((sum, e) => sum + e.count, 0)
    expect(m).toBe(4)

    const xuanmoStrike = yixuan.executions.find(e => e.moveId === '1371021')
    expect(xuanmoStrike!.count).toBe(4)
    const ink = yixuan.executions.find(e => e.moveId === '1371005')
    expect(ink).toBeTruthy()
    expect(ink!.count).toBe(1)
    const strike5 = yixuan.executions.find(e => e.moveId === '1371006')
    expect(strike5!.count).toBe(1)
  })

  it('术法值符法千重次数：默认 = 全部（理论可打次数），文本框可覆盖且封顶', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()

    function run(cinema: number, override: number | undefined): { theoretical: number; actual: number } {
      config.team[0] = teamChar(0, '1371', cinema, { yixuanInk2Count: 2, yixuanInk3Count: 1, yixuanPerfectBlockCount: 3 })
      config.team[1] = teamChar(1, '1251')
      config.team[2] = teamChar(2, '1271')
      config.setMechanicSetting('yixuan.shufaUltCount', override ?? -1)
      const calc = useResourceCalc()
      const yixuan = calc.resourceResult.value!.characters.find(c => c.agentId === '1371')!
      const shufa = yixuan.specResources?.['yixuan_shufa_value']
      const theoretical = Math.floor(shufa.total / 120)
      const actual = shufa?.spendCounts?.['yixuan_extra_ult_spend'] ?? 0
      return { theoretical, actual }
    }

    // 默认 -1 = 自动 = 全部：各命座都打满术法值理论可打次数
    for (const cinema of [0, 1, 6]) {
      const c = run(cinema, undefined)
      expect(c.actual).toBe(c.theoretical)
    }

    // 手动覆盖：填 1 次 → 只打 1 次
    expect(run(0, 1).actual).toBe(1)

    // 手动覆盖超过理论：封顶于理论可打次数
    const cOver = run(0, 99)
    expect(cOver.actual).toBe(cOver.theoretical)

    // 清理
    config.setMechanicSetting('yixuan.shufaUltCount', -1)
  })

  it('影画2/4/6：聚墨·符法千重-破（1200/374.055/62.3425/226.7）、减抗招式限定、静心加权、调息赠送', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1371', 6, { yixuanInk2Count: 2, yixuanInk3Count: 1, yixuanPerfectBlockCount: 3 })
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const yixuan = out!.characters.find(c => c.agentId === '1371')!

    // 符法千重总次数 = 术法值次数（floor(术法值/120)）+ 调息赠送（默认 = 大招次数，30s CD 封顶）
    const extraUlts = yixuan.executions.filter(e => e.moveId === '1371020')
    const totalUlts = extraUlts.reduce((sum, e) => sum + e.count, 0)
    expect(totalUlts).toBeGreaterThan(0)
    const shufa = yixuan.specResources?.['yixuan_shufa_value']
    const shufaUlts = Math.floor(shufa.total / 120)
    expect(totalUlts).toBeGreaterThan(shufaUlts) // 调息赠送 > 0
    // 两条 1371020 执行：调息赠送（模块先 push）+ 术法值驱动（spec 事件）
    expect(extraUlts.length).toBe(2)
    expect(extraUlts[0].count).toBe(totalUlts - shufaUlts)

    // 聚墨·符法千重-破：次数 = 符法千重总次数；数值 = 用户提供（1200 伤害/374.055 失衡/62.3425 喧响/226.7 异常）
    const po = yixuan.executions.find(e => e.moveId === '1371_fufa_po')
    expect(po).toBeTruthy()
    expect(po!.count).toBe(totalUlts)
    expect(po!.damageMultiplier).toBe(1200)
    expect(po!.dazeMultiplier).toBe(374.055)
    expect(po!.decibelRecovery).toBe(62.3425)
    expect(po!.anomalyBuildUp).toBe(226.7)
    expect(po!.dmgBonus ?? 0).toBeGreaterThanOrEqual(60) // 吃核心被动（强化特殊技）

    // 影画2 减抗：终/强特/破执行 resIgnore=15；普攻（霄云劲等）不加
    const poRes = yixuan.executions.find(e => e.moveId === '1371_fufa_po')!
    expect(poRes.resIgnore ?? 0).toBeGreaterThanOrEqual(15)
    const cloudExec = yixuan.executions.find(e => e.moveId === '1371022')!
    expect(cloudExec.resIgnore ?? 0).toBeGreaterThanOrEqual(15) // 强化特殊技
    // 后台合轴（普通攻击）不加减抗
    const backstage = yixuan.executions.find(e => e.moveId === '1371006')
    if (backstage) expect(backstage.resIgnore ?? 0).toBe(0)

    // 影画4 静心：凝云/墨消 dmgBonus 含 30×min(大招次数, 凝云墨消总数)/总数（0 命为 0）
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)

    // 影画6 凝神满覆盖滑块（用户口径）：默认 100%（暴伤+40% + 贯穿+20%，不走轴扫描）；调 0 后伤害应下降
    // （锁定失衡次数避免离散变化干扰对比）
    config.enemy.stunCountLock = 4
    await new Promise(r => setTimeout(r, 10))
    const dmgFull = calc.teamTotalDamage.value
    config.setMechanicSetting('yixuan.c6NingshenCoverage', 0)
    await new Promise(r => setTimeout(r, 10))
    const dmgZero = calc.teamTotalDamage.value
    expect(dmgZero).toBeLessThan(dmgFull * 0.98) // 贯穿+20% + 暴伤+40% 消失 → 显著下降
    config.setMechanicSetting('yixuan.c6NingshenCoverage', 1)
    config.enemy.stunCountLock = -1
    await new Promise(r => setTimeout(r, 10))

    // 6 命赠送的符法千重：真实 moveId 回填行值（2932.5），等级系数（5命 skillLevelBonus=4 → 16级）由伤害池统一乘
    const gifted = yixuan.executions.find(e => e.moveId === '1371020')
    expect(gifted!.damageMultiplier).toBe(2932.5)
  })
})

describe('仪玄失衡延时（影画2，回归：2026-08 修复全队多计）', () => {
  it('影画2：终结技使失衡敌人失衡时长 +3s → windowDuration = 12+4+3 = 19；0 命 = 16', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1371', 2)
    config.team[1] = teamChar(1, '1011')
    config.team[2] = { ...teamChar(2, ''), agentId: '', cinemaLevel: 0, slot: 2 } as any
    config.syncTeammateBuffsFromTeam()
    const calc = useResourceCalc()
    expect(calc.windowDuration.value).toBe(12 + 4 + 3) // 只加一次（非全队 × 角色数）
    config.team[0] = teamChar(0, '1371', 0)
    config.syncTeammateBuffsFromTeam()
    expect(calc.windowDuration.value).toBe(12 + 4)
  })
})
