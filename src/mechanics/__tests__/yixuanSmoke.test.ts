import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPiniaWithFixtures, setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentSpec } from '@/specs/registry'
import { DEFAULT_INK3_RATIO, computeYixuanExChain, computeYixuanNingshenBonus, splitInkByRatio, yixuanMechanic, yixuanOverlay } from '@/mechanics/agents/yixuan'
import { getAgentMechanic } from '@/mechanics/registry'

beforeEach(() => {
  newPiniaWithFixtures()
  mockStaticFetch()
})

function teamChar(slot: number, agentId: string, cinemaLevel = 0, overrides: Partial<{ blockCount: number; dodgeCounterCount: number; yixuanInk2Count: number; yixuanInk3Count: number; yixuanPerfectBlockCount: number }> = {}) {
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
    const chain = computeYixuanExChain(540, 2, 1, 3, 0, 2, { ink2Seconds: 0.2, ashenSeconds: 0.3 })
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
    const allCloud = computeYixuanExChain(540, 0, 0, 0, 0, 2, { ink2Seconds: 0.2, ashenSeconds: 0.3 })
    expect(allCloud.cloudOut).toBe(9)
    expect(allCloud.flashSpent).toBe(540)

    // 轴内凝云：2 次 × 蓄力 1s（耗能 20+20/次）→ 剩余 540-80=460 → 轴外 7 循环
    const axisChain = computeYixuanExChain(540, 0, 0, 0, 2, 1, { ink2Seconds: 0.2, ashenSeconds: 0.3 })
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
    config.team[0] = teamChar(0, '1371', 0, { yixuanInk2Count: 2, yixuanInk3Count: 1, yixuanPerfectBlockCount: 3 })
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const yixuan = out!.characters.find(c => c.agentId === '1371')!
    // 闪能池账本（收敛后实测，改动时按此逐项对账）：
    //   自动回复 360 + 进场赠送 120 + 破秽盾 60 + 额外闪能总账 180
    //     （额外总账 180 = 极限闪避 10×5 + 完美格挡 3×10 + 玄墨异常触发 4×10 + 极限支援落雷 12×5）
    //   + 队友终结技闪能 80（额外能力·玄墨暗涌：青衣2+赛斯2 = 4 次终结 × 20，走 calcCrossAgentEnergy）
    //   = 800 → 循环当量 floor(800 / 60) = 13
    // 口径变更史：本行曾为 13，根因是 f20b2d5 修正了 transformSkillExecutions 语义
    //   （旧代码 `if (usesModuleTransform) continue` 让所有定义该钩子的模块——含仅做面板后处理的
    //   specPanelBuffs 面板 buff 模块——连非普攻失衡/积蓄提取一并被跳过）。赛斯(1271) 属该类模块，
    //   净失衡模型（2026-08 收敛）：非失衡占比缩放全来源净失衡，超时残缺失衡折小数；
    //   连携 daze 不再自引用 → 失衡次数/连携/喧响 回落 → 当量稳定在 13。
    //   历史对照：旧发散模型曾达 14（连携 daze 白送），13→14 的修复被净失衡正确替代。
    //   队友终结次数（2026-08-23 重推导）：赛斯喧响在净失衡模型下少跨一档（3→2 次）→
    //   队友终结闪能 120→80、总账 840→800，当量仍为 13。
    // 2026-09-03 再基线（异常积蓄利用率默认修正：支援/防护 0.1→1.0——赛斯为防护，
    //   其电积蓄不再 ×0.1 → 异常触发/喧响抬升 → 平A池回能 0.45→12.01）：
    //   总账 800.45→812.01、derivedEnergy 806.5→810.52，当量 13 不变
    //   （口径历史/根因见 stores/config.ts getAnomalyUtilizationRate 注释）。
    // 时间轴喧响轨（2026-08-31，收敛门控版）：轨仅在 stunCount 收敛稳定后启用——
    // 本队 stunCount 在大招数稳定前已收敛（轮序早于轨），轨未介入 → 保持总量口径 13。
    // （比琉队等「stunCount 先稳定」的队伍轨才削减——见 billySmoke；时间轨原型 core/resourceTrack.ts 已于 CC-187 删除）
    // 2026-09-07 喧响收入修复：仪玄喧响 8030→12000+ → 玄墨异常触发回闪能结构变化 → 强特 13→14
    // 2026-09-08 喧响账本行级化（Σ buildExecutions 行，债务清偿）：后台合轴喧响由「4招全加」
    // 聚合改为行级二选一（合轴替换对语义），仪玄/队友喧响结构变化 → 轨削减回摆 → 强特 14→13
    // 2026-09-20 外层不动点「冷启动首轮不入环」修复：本队外层由 `cycle`（伪 2-循环，rounds=2）
    //   收敛为 `stable`（rounds=4）⇒ 队友终结次数回到 3/3，`calcCrossAgentEnergy` 的
    //   `teamUltimateFlash` 由 0 回到 **120**（2 名队友 × 3 次终结 × 20）⇒ 闪能总账
    //   800.45 → **843.07** ⇒ 当量 floor(843.07/60) = **14**（跨过 14 档线 840）。
    //   逐项实测（探针 2026-09-20）：自动回复 360 + 进场赠送 120 + 破秽盾 60 + 额外闪能总账 180
    //   （极限闪避 10×5 + 完美格挡 3×10 + 玄墨异常触发 4×10 + 极限支援落雷 12×5）
    //   + 队友终结技闪能 **120** = 840 + 小数份额 = 843.07。
    //   这是外层收敛态变化的**链式后果**，不是仪玄机制改动。
    //
    // ⚠ **T141：当量 14 → 15**（吸收改「取满容量」+ 闸门常开 ⇒ 该值由 14 变为 15）。
    //   变的量 = `exSpecialCount` = 循环当量 floor(闪能总账 / 60)。本队 Σ净必要 < 预算，
    //   旧闸门「必须有溢出」⇒ 不吸收；T141 闸门常开后吸收生效 ⇒ 腾出的前台时间回流平A池
    //   ⇒ 仪玄闪能总账实测 **873.00 → 920.10** ⇒ floor(920.10/60) = **15**（跨过 900 档线）。
    //   同源链式后果（本用例另两条断言实测同步变化，见下方对应注释）：
    //   队友终结技次数 [3,3] → **[4,4]**、`teamUltimateFlash` 120 → **160**。
    //   归因自证：本队轴态 `axisStateOf` 两态均为 `partial(decibel:2)` 逐位相同 ⇒ 不是轴态迁移。
    // ⚠ **2026-10-23 15 → 14**：删除「保底4喧响」通道的**预期后果**（逐条归因见下）。
    // ② 根因（A/B 实测，不是猜测）：在 HEAD（未改动树）上把 `guaranteeUltimate` 强行改成 `false`
    //    单独跑本用例 ⇒ 同样 15→14、同样 5→6，**两处逐位复现** ⇒ 就是那条通道造成的。
    // ③ 机理：修前 `decibelParryActive = guaranteeUltimate && interactionTopUpSlot < 0`。本队没有
    //    般岳（`interactionTopUpSlot < 0`），而 `guaranteeUltimate = axisActive || 用户勾选` ⇒ 轴态下
    //    恒真 ⇒ 引擎给主C 注入「只给喧响」弹刀（`parryDecibelOnlyCount`），抬了主C 喧响。
    //    通道删除后这笔注入消失 ⇒ 仪玄闪能总账回落、当量 15 → **14**。
    // ④ 确认有意：用户裁决「这个保底是余孽，不要再用了」= 要的就是这笔注入消失。
    expect(yixuan.exSpecialCount).toBe(14)
    // 上游归因锚点（时间轴喧响轨 2026-08-31 更新）：轨按窗口时序推演——2 失衡窗口间隔 90s，
    // 队友进窗攒不足 3000（青衣 2813/赛斯 2866）→ 大招全削减 [0, 0]（原总量口径 [2, 2]）；
    // 玄墨暗涌队友终结回闪能 80→0 → 总账 800→684、当量 13→11。
    // 2026-09-07 喧响收入修复：仪玄 shareable 1702→3788 → 队友伴随进窗够 3000 → 轨削减解除 [2,2]→[3,3]
    // 2026-09-08 行级账本：青衣喧响回落（行级真相），进窗不足 3000 → 轨削减青衣 [3,3]→[2,3]
    // 2026-09-09 能量收入行级 Σ：青衣模块预计算行（1251004/08/09，第一段审计 MODULE_VALUE，
    // 旧聚合通道从不计行值）首次进账本 → 青衣强特↑ → 其行级喧响收入↑ → 队友进窗回到 3000
    // 之上 → 轨削减解除 [2,3]→[3,3]
    // 2026-09-28 CC-154：模块计数改读计数通道（physical 物理次数）⇒ 青衣醉花轮数 2×失衡按物理次数计 ⇒ 青衣终结 3→4 ⇒ [3,4]
    // 2026-10-03 CC-394（r420）：青衣强特月上海棠融合三段（喧响随融合组同源相加，moveLookup#channelMetricsOf）⇒ 青衣喧响↑ ⇒ 青衣终结 3→4 ⇒ [4,4]
    // ⚠ **2026-10-05 更新 [4,4] → [3,3]**（§20.5-3 轴态吃吸收后）：本队由「轴臂超预算 ⇒ 弃轴 ⇒ 非轴」
    // 变为「轴臂也吸收 ⇒ 留轴态」⇒ 队友终结技次数按**轴内计数**（用户口径 2026-10-05：
    // 「开了轴模式，那么每失衡连携就不用看了，直接用轴内计数就行」）⇒ 各减 1。
    // （链式后果：队友终结各减 1 ⇒ `teamUltimateFlash` 随之为 2 名队友 × 2 次 × 20 = 80，
    //   闪能总账与「当量 14」那条断言的耦合见下方对应注释；本条只钉「轴态走轴内计数」新契约。）
    // ⚠ **T141：[3,3] → [4,4]**（吸收改「取满容量」+ 闸门常开 ⇒ 该值由 3/3 变为 4/4）。
    //   变的量 = 两名队友的 `ultimateCount`（各 3 → 4）。同源于上一条：吸收常开 ⇒ 全队时间结构
    //   变化 ⇒ 队友各多打 1 次终结。轴态 `axisStateOf` 两态逐位相同 ⇒ 不是轴态迁移，
    //   「轴内计数」这条消费口径一条没动。
    // ⚠ **2026-10-23 [4,4] → [3,3]**：同上一条的连锁后果（队友终结技闪能 160 → 120 档回摆）。
    // HEAD 上把 `guaranteeUltimate` 置 false 的 A/B 同样复现 —— 判据本意（"队友各多打一次终结"
    // 这条链式关系的存在性）由下面的 `teamUltimateFlash` 同源断言继续承担。
    expect(out!.characters.filter(c => c.agentId !== '1371').map(c => c.ultimateCount)).toEqual([3, 3])
    // 2026-09-03 用户裁决：能量总账/derived 的数值断言删除——计算器未定型前数值断言会
    // 钉死中间态（展示=内核同源不变式由 energyConsistency.test 承担）；玄墨回能字段断言语义保留。
    // 2026-09-07：队友大招 [2,2]→[3,3] → 队友终结闪能 80→120
    // 2026-09-08 行级账本：队友大招 [3,3]→[2,3] → 队友终结闪能 120→100（5×20）
    // 2026-09-09 能量行级 Σ：队友大招 [2,3]→[3,3] → 队友终结闪能 100→120（6×20）
    // 2026-09-28 CC-154：队友大招 [3,3]→[3,4] → 队友终结闪能 120→140（7×20）
    // 2026-10-03 CC-394（r420）：队友大招 [3,4]→[4,4] → 队友终结闪能 140→160（8×20）
    // 2026-10-05 §20.5-3（轴态吃吸收 ⇒ 本队留轴态）：队友大招 [4,4]→**[3,3]**（轴内计数）
    //   → 队友终结闪能 160→**120**（6×20）。本条与上一条 `ultimateCount` 同源，必须同步。
    // ⚠ **T141：队友大招 [3,3] → [4,4]、闪能 120 → 160**（吸收改「取满容量」+ 闸门常开 ⇒
    //   该值由 120 变为 160；与上一条 `ultimateCount` 同源，两条同步改）。
    //   变的量 = 队友（青衣 1251 / 赛斯 1271）的终结技次数与 `calcCrossAgentEnergy` 的
    //   `teamUltimateFlash`（= 2 名队友 × 4 次 × 20 = 160）。吸收常开 ⇒ 仪玄腾出前台 ⇒
    //   全队时间结构变化 ⇒ 队友各多打 1 次终结。**不是**轴态迁移：`axisStateOf` 两态逐位相同
    //   （均 `partial(decibel:2)`），故 2026-10-05 的「轴内计数」契约原样保留、只是计数本身变大。
    // ⚠ **2026-10-23 160 → 120**：同一条删除的连锁后果（队友终结 [4,4] → [3,3] ⇒ 2×3×20 = 120）。
    // 它与上面那条 `ultimateCount` 断言**同源**（120 = 3+3 次 × 20 闪能/次），因此两处必须一起改，
    // 单独改一处会留下"账不平"的假锚。HEAD 上置 `guaranteeUltimate = false` 的 A/B 逐位复现。
    expect(yixuan.energySource.crossAgent.teamUltimateFlash).toBe(120)
    const chain = yixuan.yixuanExChain!
    // 手填口径锁结构（轨 2026-08-31：income 随队友大招削减回落，cloudOut/flashSpent 为收敛值不锁数）
    expect(chain.ink1).toBe(3)
    expect(chain.ink4).toBe(1)
    expect(chain.cloudOut).toBeGreaterThan(0)
    expect(chain.flashSpent).toBeGreaterThan(0)
    const shufa = yixuan.specResources?.['yixuan_shufa_value']!
    expect(shufa.totalGain).toBeGreaterThan(0)
    const extraUlts = yixuan.executions.filter(e => e.moveId === '1371020')
    expect(extraUlts[0].count).toBeGreaterThan(0)
    expect(extraUlts[0].damageMultiplier).toBe(2932.5)
    expect(extraUlts[0].actionTime, '符法千重施放时间应计入前台（catalog 1371020 = 2.267s）').toBe(2.267)
    /**
     * ⚠ **T197（用户裁决 2026-10-22）**：后台墨影凝云 + 霄云劲#5 整套删除——
     * 「交互里面的后台墨影凝云 + 霄云劲#5也删除，因为他们本质是合轴率系统出来之前的代替产物，
     * 现在该直接用合轴率代表一切」。
     * ⇒ 玄墨极阵 / 青溟震击 / 墨影凝云 / 霄云劲#5 这四条「合轴」行都不再产出（它们是后台代替品）。
     * 真实合轴由全局旋钮 `time.comboAlignAbsorbRatio` 表达，不再逐招记账。
     */
    for (const gone of ['1371021', '1371007', '1371005', '1371006']) {
      expect(yixuan.executions.some(e => e.moveId === gone), `后台合轴行 ${gone} 已删除`).toBe(false)
    }
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

  it('3连墨痕化形/完美格挡 ≤0 = 自动（用户口径 2026-08）：剩余闪能全打 3 连（cloudOut=0），完美格挡=弹刀次数', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    // 与上一条同队伍，但不填墨痕/格挡（缺省 0 = 自动）；teamChar 弹刀默认 6
    config.team[0] = teamChar(0, '1371', 0)
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')

    const calc = useResourceCalc()
    const yixuan = calc.resourceResult.value!.characters.find(c => c.agentId === '1371')!
    const chain = yixuan.yixuanExChain!
    // 自动完美格挡 = **有效**弹刀次数。
    /**
     * ## ⚠ 2026-10-15（T171）期望值 6 → 4：**降配是合法行为**，且「弹刀免预算」是**误读**
     *
     * 本用例上一次改期望值（6→5→4）被 2026-10-05 判为「方向本身就错」，理由是
     * 「弹刀是低成本黄光反应，不存在撑不下预算的物理约束」。**用户 2026-10-15 纠正了那条裁决的语义**：
     * > 「这个裁决的意思是**弹刀可以自动填充**，解决的问题是之前**弹刀总是被固定住不能填充**。
     * >   实际上**弹刀该吃时间预算**，你这里交互降配感觉又是老问题了，**你从默认 0 往上爬为什么会降配**」
     * ⇒ 那条裁决要的是「**别把弹刀钉死**」（自动填充），**不是**「弹刀免时间预算」。
     *
     * ### 本次为何重新触发降配（实测归因，非猜测）
     *
     * T171 修了「仪玄符法千重被按喧响收费」⇒ 本队轴从**弃轴**变**可行** ⇒ 轴内动作开始占前台时间
     * ⇒ 超 180s ⇒ 引擎按既有机制降配（`DOWNSCALED_INTERACTION_FIELDS` 含 `parryCount`）：
     *
     * | | 轴态 | interactionScale | 净占用 | 完美格挡 |
     * |---|---|---|---|---|
     * | 修前 | 弃轴 `fallback=true` | 1（无降配） | 179.1s（overflow 1.217s） | 6 |
     * | 修后 | 轴可行 | **0.625** | 176.8s（overflow 0） | **4**（`round(6×0.625)`） |
     *
     * ⚠ **这不是「爬升导致降配」**：全库 16 支空曲线队实测 `scale=1`（压根没降配，是真·资源不足）；
     * 降配只在本队这类「轴刚变可行、时间刚好卡线」的队上出现，且降配后净占用确实落回预算内（176.8 ≤ 180）。
     * ⇒ 判据保留原意「有效弹刀 = 配置值 × 降配」——只是**降配在合法时会发生**。
     * ⟳复核: 若本队有效弹刀再次偏离 4，先查 `interactionScale` 是否变了（引擎行为），再考虑改本期望值 | 到期 2027-03-31
     */
    /**
     * ⚠ **2026-10-21 round 29：4 → 5**（轴态降配臂落地）。
     *
     * 本队现在保轴（不再弃轴），轴内交互次数经降配后重排 ⇒ 有效弹刀 +1。
     * 判据本意（「有效弹刀 = 链内完美格挡次数、且与 ink2 同步」）不变。
     */
    // ⚠ **2026-10-23 5 → 6**：同一条删除的连锁后果（A/B 见上一条用例的归因：HEAD 上把
    // `guaranteeUltimate` 置 false 即复现）。机理 = 少了「只给喧响」弹刀占用的前台时间 ⇒
    // 时间预算宽松一档 ⇒ 本队不再触发降配（`interactionScale` 回到 1）⇒ 有效弹刀 = 配置值 **6**。
    // 判据本意（「有效弹刀 = 链内完美格挡次数、且与 ink2 同步」）不变。
    expect(chain.perfectBlockCount).toBe(6)
    expect(chain.ink2).toBe(6)
    // 自动 3 连：income（= 循环当量 × 60）打完轴内消耗后剩余全部打 3 连（60/次）→ 轴外凝云清零
    expect(chain.ink2Count).toBe(0)
    // 时间轴喧响轨（2026-08-31）：队友大招削减 → 玄墨暗涌闪能归零 → income 回落。
    // ink 自动拆分与循环当量各自独立收敛，不再锁定具体值（轨口径下随收敛波动），
    // 锁行为不变量：自动 3 连全部用尽剩余闪能（cloudOut=0）、#1 行数 = 2连+3连之和
    expect(chain.cloudOut).toBe(0)
    expect(chain.ink1).toBe((chain.ink2Count ?? 0) + (chain.ink3Count ?? 0))
    // 手填 ≥1 仍覆盖自动（上一条测试的 2连×2+3连×1 手填口径不变）
  })

  it('影画4 自动：保留 1 轮凝云作为 C4 静心载体（轴外凝云=1，非 0）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1371', 4) // 影画4
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')

    const calc = useResourceCalc()
    const yixuan = calc.resourceResult.value!.characters.find(c => c.agentId === '1371')!
    const chain = yixuan.yixuanExChain!
    // C4 激活 → 自动 3 连少打 1 次，留出 1 轮凝云当载体（轨口径下数值随收敛波动，锁行为不变量）
    expect(chain.cloudOut).toBe(1)
    expect(chain.ink2Count).toBe(0)
    expect(chain.ink3Count).toBeGreaterThan(0)
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
    // 锁窗（2026-08-23）：充足性约束（4b9ab22）会把裸默认配置的失衡窗口压到 0，本用例验证轴接线，
    // 按「操作够就能打 N 次失衡」口径锁 4 窗（与命座提升率页同款机制），隔离约束保持原场景。
    config.enemy.stunCountLock = 4

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const yixuan = out!.characters.find(c => c.agentId === '1371')!
    const chain = yixuan.yixuanExChain!

    // 轴内凝云 = 常规轴 3 窗×1 + 爆发轴 1 窗×2 = 5（锁窗 4 次）
    expect(chain.axisCloud).toBeGreaterThan(0)
    expect(chain.axisCloudSeconds).toBe(2)
    // 轴内行都带失衡强特 +30
    const axisCloud = yixuan.executions.find(e => e.moveId === '1371022' && e.actionTime === 2)
    expect(axisCloud).toBeTruthy()
    expect(axisCloud!.dmgBonus ?? 0).toBeGreaterThanOrEqual(90)
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('★ 符法千重（1371020）不扣喧响——术法值购买的大招不是喧响大（用户口径 2026-10-15）', async () => {
    /**
     * ## 锁什么
     *
     * 用户口径逐字：
     * > 「**很多角色都有多个大招**，虽然有大招标签，但其实**不是喧响大**。但实际这种是**不耗喧响**的，
     * >   **术法大自己消耗术法值，不消耗喧响**。……我不知道还有哪些角色逻辑错误了，**目前你就先修仪玄吧**。」
     *
     * 修前缺陷：编排层判「是不是大招」只看英文名是否以 `Ultimate:` 开头
     * （`data/chainMoveKind#chainMoveKind`）⇒ 符法千重（EN `Ultimate: Endless Talisman Suppression`）
     * 被收满 3000 喧响。实测后果：4 支仪玄队全被判「喧响不足」而截断
     * （`.zc/perf/T171scope2.perf.ts`：`yixuan-trigger-lucia` 喧响 12692 ÷ 3000 = **4.23 个**，
     * 本够打 4 个大招，却因多收这一个而差 4 招）。
     *
     * ## 负控（删掉被锁行为后本测试确实变红）
     *
     * 删掉模块的 `axisMoveFreeOfDecibel` 声明 ⇒ 「栈不为符法千重扣喧响」断言红。
     */
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1371')
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')
    config.useStunAxis = true
    // 轴里同时捏「真喧响大」（1371014）与「术法值大」（1371020），逐块对账
    config.stunAxes = [
      {
        name: '对账轴', count: 1,
        actions: [
          { slot: 0, moveId: '1371014', count: 1 }, // 青溟云影：**真喧响大**，应扣 3000
          { slot: 0, moveId: '1371020', count: 1 }, // 符法千重：术法值购买，**不应扣喧响**
        ],
        basicFillerSlot: 0,
      },
    ]
    config.enemy.stunCountLock = 1
    const calc = useResourceCalc()
    const st = calc.stackTraversalResult.value
    expect(st, '轴应被注入（否则本判据零覆盖）').not.toBeNull()
    /**
     * 栈的 `decibelUsed` 只应含**真喧响大**那一个 3000。
     * 修前 = 6000（两个都被按 ultimate 收费）⇒ 本断言即负控。
     */
    expect(st!.decibelUsed, '符法千重不该扣喧响（只应扣青溟云影的 3000）').toBeCloseTo(3000, 6)
    // 反空洞：真喧响大**必须**照扣（否则「都免了」也能让上一条变绿）
    expect(st!.decibelUsed, '青溟云影是真喧响大，必须照扣').toBeGreaterThan(0)
    // 该块仍占窗口时间（只免喧响、不免时间）
    const exec = Object.values(st!.executed).find(e => e.moveId === '1371020')
    expect(exec, '符法千重仍应被执行（免的是喧响不是执行）').toBeTruthy()
  })

  it('★ 两处判据同源：收费侧与「喧响缺口」侧都认同一个豁免（T171 潜在同族缺陷）', async () => {
    /**
     * ## 锁什么
     *
     * 同一份「这个块要不要喧响」的判定在**两处**：
     *  · **收费侧** `resourceCalc/roundInputs`（给轴栈打 `decibelCost`）；
     *  · **缺口侧** `resourceCalc/convergence#axisUltimateNeed`（算 `ultimateCountNeeded`
     *    喂给 `computeInteractionTopUp`，决定补几次弹刀）。
     *
     * 修前只有收费侧认豁免 ⇒ 缺口侧仍把符法千重数成「需要喧响的大招」
     * ⇒ 会补出**本不需要的弹刀**（T162「幻影缺口」同族）。
     * ⚠ 今天不可触发（唯一声明 `computeInteractionTopUp` 的是般岳，它没有非喧响大），
     * 但任何「有非喧响大 + 声明补齐能力」的角色一上线就会踩 ⇒ 本条锁**两处同源**。
     *
     * ## 负控（删掉被锁行为后本测试确实变红）
     *
     * 删掉 `convergence#axisUltimateNeed` 里那行 `axisMoveFreeOfDecibelOf` 的 `continue`
     * ⇒ 缺口侧把 1371020 也数进去。本用例用「栈的喧响耗」作观测点（收费侧），
     * 同源断言由下面两条互补覆盖：收费侧读数 + 缺口侧入参推导。
     */
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1371')
    config.team[1] = teamChar(1, '1251')
    config.team[2] = teamChar(2, '1271')
    config.useStunAxis = true
    // 轴里同时捏「真喧响大」（1371014）与「术法值大」（1371020）
    config.stunAxes = [{
      name: '同源对账轴', count: 1,
      actions: [{ slot: 0, moveId: '1371014', count: 1 }, { slot: 0, moveId: '1371020', count: 1 }],
      basicFillerSlot: 0,
    }]
    config.enemy.stunCountLock = 1
    const calc = useResourceCalc()
    const st = calc.stackTraversalResult.value
    expect(st, '轴应被注入（否则本判据零覆盖）').not.toBeNull()
    // 收费侧：只扣真喧响大的 3000
    expect(st!.decibelUsed, '收费侧只认真喧响大').toBeCloseTo(3000, 6)
    /**
     * 缺口侧（同源断言）：豁免判据本身是**同一个函数**。
     * 直接钉「模块声明对 1371020 为 true、对 1371014 为 false」——
     * 两处都调它 ⇒ 只要这条成立，两处就不可能分叉（规则 11 单一事实源）。
     */
    const free = getAgentMechanic('1371')?.axisMoveFreeOfDecibel
    expect(free, '仪玄必须声明该能力（否则两处都退回按名字收费）').toBeDefined()
    expect(free!('1371020'), '符法千重（术法值购买）⇒ 不扣喧响').toBe(true)
    expect(free!('1371014'), '青溟云影是真喧响大 ⇒ 必须照扣（负控：别把两个都免了）').toBe(false)
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
    // 锁窗（2026-08-23，同上）：隔离充足性约束，按轴声明锁 3 窗。
    config.enemy.stunCountLock = 3

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const yixuan = out!.characters.find(c => c.agentId === '1371')!
    const chain = yixuan.yixuanExChain!

    // 轴内凝云：每窗 2 次、蓄力 1s（锁窗 3）；轴内消耗 40/次
    expect(chain.axisCloud).toBeGreaterThan(0)
    expect(chain.axisCloudSeconds).toBe(1)
    const income = yixuan.exSpecialCount * 60
    // 新口径（2026-08）：轴内消耗后剩余闪能全部自动打 3 连墨痕化形（60/次）→ 轴外凝云清零
    expect(chain.cloudOut).toBe(0)
    expect(chain.ink3Count).toBe(Math.floor((income - chain.axisCloud! * 40) / 60))
    expect(yixuan.executions.some(e => e.moveId === '1371022' && e.actionTime === 2)).toBe(false)

    // 轴内凝云执行：actionTime=1、倍率秒均折算 1343.9×0.5≈672、dmgBonus 含 +30（失衡强特）+60（核心被动）
    // （enrich 会把 moveName 回填成倍率表名，按 actionTime/倍率区分轴内/轴外行）
    const axisCloud = yixuan.executions.find(e => e.moveId === '1371022' && e.actionTime === 1)
    expect(axisCloud).toBeTruthy()
    expect(axisCloud!.count).toBe(chain.axisCloud)
    expect(axisCloud!.damageMultiplier).toBeCloseTo(672, 0)
    // 字段实现确认：轴内行 dmgBonus = 核心被动 60 + 失衡强特 30 = 90（buildExecutions 写入）
    expect(axisCloud!.dmgBonus).toBe(90)
    // 轴外 3 连墨痕化形自动补位：#1 行次数 = 3连次数（无 2 连手填）
    const ink1 = yixuan.executions.find(e => e.moveId === '1371009')
    expect(ink1).toBeTruthy()
    expect(ink1!.count).toBe(chain.ink3Count)
    expect(ink1!.dmgBonus).toBe(60)

    // 影画1落雷按 CD 自动：轴内时间 = 窗口数×16s → floor(轴内时间/6) 次（少于非轴模式 floor(180/6)=30）
    const lightning = yixuan.executions.find(e => e.moveId === '1371_c1_lightning')
    expect(lightning).toBeTruthy()
    expect(lightning!.count).toBeGreaterThan(0)
    expect(lightning!.count).toBeLessThan(30)
    expect(lightning!.damageMultiplier).toBe(50)
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
      const shufa = yixuan.specResources?.['yixuan_shufa_value']!
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
    const shufa = yixuan.specResources?.['yixuan_shufa_value']!
    const shufaUlts = Math.floor(shufa.total / 120)
    // 轨口径（2026-08-31）：调息赠送默认 = 大招次数，大招被轨削减时赠送可为 0 → 锁 ≥（不恒正）
    expect(totalUlts).toBeGreaterThanOrEqual(shufaUlts)
    // 两条 1371020 执行：调息赠送（模块先 push）+ 术法值驱动（spec 事件）；
    // 轨口径（2026-08-31）：赠送 0 时模块不 push 该行 → 至少 1 条（术法值驱动）
    expect(extraUlts.length).toBeGreaterThanOrEqual(1)
    // 轨口径（2026-08-31）：赠送行可能不存在（调息赠送 0）→ 首行不再恒为赠送行；
    // 断言首行 count ≤ 总次数（结构 sanity）
    expect(extraUlts[0].count).toBeLessThanOrEqual(totalUlts)

    // 聚墨·符法千重-破：次数 = 符法千重总次数（模块 totalFuFaUlts）；数值 = 用户提供（1200 伤害/374.055 失衡/62.3425 喧响/226.7 异常）
    // 已知不一致（2026-09-07 喧响收入修复暴露，轨削减依赖行传播专项）：时间轴喧响轨把物化
    // 1371020 行削到 8，而 po 行仍按模块 totalFuFaUlts=11 计——依赖行传播待轨专项
    // 2026-09-08 喧响账本行级化 + 环规范化停点：6命队 totalFuFaUlts 11→8（行级账本下
    // 大招/术法值收敛到新停点），轨削减不再介入 → po 与物化 1371020 行同值，旧不一致消失
    // 2026-09-09 能量收入行级 Σ：术法值增益（闪能驱动）随账本微升 → shufaUlts 5→6 →
    // 物化 1371020 总次数 8→9；po 行仍按模块相位 totalFuFaUlts=8——「轨/相位对物化行的
    // 调整不回传 po」相位分裂再现（2026-09-07 同族，依赖行传播待轨专项），锁当前差值=1，
    // 轨专项落地时连同本差值一起重裁。
    const po = yixuan.executions.find(e => e.moveId === '1371_fufa_po')
    expect(po).toBeTruthy()
    // 2026-09-11 降配验收三臂化（见同文件「3连墨痕化形/完美格挡」条）：超预算的交互被收进可行域后时间腾出
    // → 术法值增益驱动的 1371020 物化行 9 次，po 行同步 9 ⇒ **相位分裂差值 1→0**（旧的「轨/相位对物化行的
    // 调整不回传 po」不一致在本配置下消失）。
    // 2026-09-19 R37-J5 v2（动态合轴）：弃轴后非轴态不再降配（溢出由队友前台吸收），外层失衡 2→3 次 ⇒ 术法值/闪能收入
    // 再升一档 → 1371020 物化行 10 次，po 行同步 10（相位分裂差值仍 0）。
    /**
     * ⚠ **2026-10-21 round 29：10 → 9**（轴态降配臂落地）。
     *
     * 注释里「弃轴后非轴态不再降配」那条前提已废——本队现在保轴，走轴态降配 ⇒
     * 术法值/闪能收入随交互档位重排，1371020 物化行 9 次（相位分裂差值仍 0）。
     */
    /**
     * ⚠ **2026-10-26：9 → 8**（并行会话 `6d75175e`「删除 quickAssistCount 全链路」后未同步本断言）。
     *
     * 归因（规则 10 四步，A/B 已跑）：
     * · `ac24828c`（删快支之前）本文件 **20 例全绿**，该值 = **9**；
     * · `6d75175e` 之后 = **8**。差 1 次符法千重。
     * 机制链：手动快支下线 ⇒ 本槽交互档位重排 ⇒ 术法值/闪能收入降一档 ⇒ `floor(术法值/120) + 调息赠送` 少 1 次。
     * **不是相位分裂**：下一条 `totalUlts - po!.count === 0` 仍成立（po 行与物化 1371020 行**同步**为 8），
     * 即「轨/相位对物化行的调整不回传 po」这个老毛病在本配置下依旧消失 ⇒ 判据本意未退化。
     */
    expect(po!.count).toBe(8)
    expect(totalUlts - po!.count).toBe(0)
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

describe('CC-17：仪玄 directRowBonus（凝神，标量优先 / 轴臂桶 / 先暴伤后贯穿）', () => {
  const exec = (moveId: string) => ({ moveId } as never)

  it('非轴臂：读本槽标量，note「凝神暴伤…（覆盖率近似）」（无贯穿段）', () => {
    const rb = yixuanMechanic.directRowBonus!({
      exec: exec('1371009'), isAxis: false, stunOverride: 0,
      overlay: yixuanOverlay.wrap({ flat: { critDmg: 20, sheerDmg: 0 } }),  // CC-437：不透明 overlay 经模块 channel 构造
    })!
    expect(rb.critDmgBonus).toBe(20)
    expect(rb.sheerDmgBonus).toBe(0)
    expect(rb.note).toBe(' · 凝神暴伤+20%（覆盖率近似）')
  })

  it('轴臂：标量缺席时查本槽桶，note「（buff轴）」', () => {
    const rb = yixuanMechanic.directRowBonus!({
      exec: exec('1371009'), isAxis: true, stunOverride: 1,
      overlay: yixuanOverlay.wrap({ byMove: new Map([['1371009', { critDmg: 40, sheerDmg: 0 }]]) }),
    })!
    expect(rb.critDmgBonus).toBe(40)
    expect(rb.note).toBe(' · 凝神暴伤+40%（buff轴）')
  })

  it('C6 标量优先于轴桶；note **先暴伤后贯穿**', () => {
    const rb = yixuanMechanic.directRowBonus!({
      exec: exec('1371009'), isAxis: true, stunOverride: 1,
      overlay: yixuanOverlay.wrap({
        byMove: new Map([['1371009', { critDmg: 40, sheerDmg: 0 }]]),
        flat: { critDmg: 40, sheerDmg: 20 },
      }),
    })!
    expect(rb.critDmgBonus).toBe(40)
    expect(rb.sheerDmgBonus).toBe(20)
    expect(rb.note).toBe(' · 凝神暴伤+40%（buff轴） · 凝神贯穿+20%')
  })

  it('两段皆 0 → null', () => {
    expect(yixuanMechanic.directRowBonus!({
      exec: exec('1371009'), isAxis: false, stunOverride: 0, overlay: undefined,
    })).toBeNull()
  })
})

describe('T173 2连/3连比例滑块（用户口径 2026-10-15）', () => {
  /**
   * 用户逐字：
   * > 「我预定的轴模式会**优先耗闪能**，剩下的能量就给**非失衡期的三连**……这两个不用在交互这里让用户填了，
   * >   而是**用滑块让用户选择比例，全打3连或者全打2连或者在中间**。」
   *
   * ## 锁什么
   *
   * ① **三档比例（0 / 0.5 / 1）下 2连:3连 分配按比例变**；
   * ② **总量守恒**：`ink2 + ink3` 不随比例变（比例只重分配，不改总量推导）；
   * ③ **默认 r=1 逐位等于改前**（全 3 连 = 旧自动口径 ⇒ 未动滑块的队 0 delta）。
   *
   * ## 负控（必做）
   *
   * 把 `ink3RatioOf` 写死成 0（或忽略参数）⇒ 本用例红（见收尾报告实测输出）。
   */
  async function runRatio(ratio: number) {
    await setupHarness([{ agentId: '1371' } as never, { agentId: '1251' } as never, { agentId: '1271' } as never])
    const config = useConfigStore()
    config.setMechanicSetting('yixuan.ink3Ratio', ratio)
    const calc = useResourceCalc()
    const chain = calc.resourceResult.value!.characters.find(c => c.agentId === '1371')!.yixuanExChain!
    return { chain, dmg: calc.teamTotalDamage.value }
  }

  it('★ 三档比例：2连:3连 按比例分配，且总量守恒（0 → 全2连 / 1 → 全3连）', async () => {
    /**
     * ⚠ **纯函数层先锁守恒**（管线层会因外层不动点反馈有 ±1 的迭代差，见下条断言）：
     * `splitInkByRatio(total, r)` 是**唯一**做分配的地方，它的契约是「只搬不改总量」。
     */
    for (const total of [0, 1, 3, 7, 15, 16, 23]) {
      for (const r of [0, 0.25, 0.5, 0.75, 1]) {
        const s = splitInkByRatio(total, r)
        expect(s.ink2 + s.ink3, `total=${total} r=${r} 必须守恒`).toBe(total)
        expect(s.ink2).toBeGreaterThanOrEqual(0)
        expect(s.ink3).toBeGreaterThanOrEqual(0)
      }
    }
    // 端点语义：0 = 全 2 连、1 = 全 3 连（用户口径「全打3连或者全打2连」）
    expect(splitInkByRatio(15, 0)).toEqual({ ink2: 15, ink3: 0 })
    expect(splitInkByRatio(15, 1)).toEqual({ ink2: 0, ink3: 15 })
    // 中间：按比例（15 × 0.5 = 7.5 → round = 8 次 3 连，补数给 2 连）
    expect(splitInkByRatio(15, 0.5)).toEqual({ ink2: 7, ink3: 8 })

    // 真管线：三档比例下 3 连次数单调不降、2 连次数单调不增（方向判据，不锁具体收敛值）
    const at = [] as Array<{ r: number; ink2: number; ink3: number; total: number }>
    for (const r of [0, 0.5, 1]) {
      const { chain } = await runRatio(r)
      at.push({ r, ink2: chain.ink2Count ?? 0, ink3: chain.ink3Count ?? 0, total: (chain.ink2Count ?? 0) + (chain.ink3Count ?? 0) })
    }
    for (const a of at) {
      if (a.r === 0) expect(a.ink3, 'r=0 = 全 2 连 ⇒ 0 次 3 连').toBe(0)
      if (a.r === 1) expect(a.ink2, 'r=1 = 全 3 连 ⇒ 0 次 2 连').toBe(0)
    }
    expect(at[0]!.ink2, 'r=0 必须比 r=0.5 的 2 连多').toBeGreaterThan(at[1]!.ink2)
    expect(at[2]!.ink3, 'r=1 必须比 r=0.5 的 3 连多').toBeGreaterThan(at[1]!.ink3)
    /**
     * ⚠ **总量守恒在管线层是「±1 迭代差」而不是逐位相等**（实测，写清免得后人误判为缺陷）：
     * 分配结果反过来喂 `exSpecialCount`（`估算 2连/3连 的闪能消耗 → income → 循环当量`）⇒
     * 外层不动点在不同分配下可能停在相邻档（实测 r=0/1 收到 14~15、r=0.5 收到 15~16）。
     * ⇒ 这里锁的是**同一分配下的守恒**（纯函数已逐位锁死）+ 管线层**量级不漂**（≤2）。
     */
    for (const a of at) expect(Math.abs(a.total - at[0]!.total), `r=${a.r} 总量不得偏离基线 ${at[0]!.total} 超过 2`).toBeLessThanOrEqual(2)
  }, 300_000)

  it('★ 默认 r=1（全 3 连）= 改前自动口径：不设滑块与显式设 1 逐位相同（0 delta）', async () => {
    /**
     * 规则 10「不静默改数」的机器面：默认值必须复现改前行为，
     * 否则全库所有仪玄队的读数都会在无人动过滑块的情况下变。
     */
    const { chain: withDefault, dmg: d1 } = await runRatio(1)
    await setupHarness([{ agentId: '1371' } as never, { agentId: '1251' } as never, { agentId: '1271' } as never])
    const config = useConfigStore()
    const calc = useResourceCalc()
    const chain = calc.resourceResult.value!.characters.find(c => c.agentId === '1371')!.yixuanExChain!
    // 显式设 1 vs 缺省（注册 default = 1）
    expect(chain.ink2Count).toBe(withDefault.ink2Count)
    expect(chain.ink3Count).toBe(withDefault.ink3Count)
    expect(chain.cloudOut).toBe(withDefault.cloudOut)
    expect(chain.flashSpent).toBe(withDefault.flashSpent)
    expect(calc.teamTotalDamage.value).toBeCloseTo(d1, 6)
    expect(config.getMechanicSetting('yixuan.ink3Ratio', DEFAULT_INK3_RATIO)).toBe(1)
  }, 300_000)

  it('★ 手填优先：任一输入框填正数 ⇒ 比例滑块不生效（与既有 ≤0=自动 哨兵一致）', async () => {
    /**
     * 用户口径「这两个不用在交互这里让用户填了，而是用滑块」——但**手填通道没被删**
     * （`yixuanSmoke` 多条既有用例锁着 2连×2+3连×1 的手填口径，删了会静默改它们的读数）。
     * ⇒ 三档优先级：手填 3连 ≥1 ＞ 手填 2连 ≥1 ＞ 比例滑块。
     */
    await setupHarness([{ agentId: '1371' } as never, { agentId: '1251' } as never, { agentId: '1271' } as never])
    const config = useConfigStore()
    const calc = useResourceCalc()
    // 比例设成 0（全 2 连），但手填 3连 = 1 ⇒ 必须仍打 1 次 3 连（比例不生效）
    config.setMechanicSetting('yixuan.ink3Ratio', 0)
    config.setActionCount(0, 'yixuanInk3Count', 1)
    config.setActionCount(0, 'yixuanInk2Count', 2)
    let chain = calc.resourceResult.value!.characters.find(c => c.agentId === '1371')!.yixuanExChain!
    expect(chain.ink3Count, '手填 3连=1 ⇒ 比例 0 不得把它清成 0（哨兵语义）').toBe(1)
    expect(chain.ink2Count, '手填 2连=2 原样').toBe(2)
    // 只手填 2连 ⇒ 3连走改前的自动算式（不与比例相乘）
    config.setActionCount(0, 'yixuanInk3Count', 0)
    chain = calc.resourceResult.value!.characters.find(c => c.agentId === '1371')!.yixuanExChain!
    expect(chain.ink2Count).toBe(2)
    expect(chain.ink3Count).toBeGreaterThan(0)
    // 清空两个手填 ⇒ 回到比例档（r=0 ⇒ 全 2 连、0 次 3 连）
    config.setActionCount(0, 'yixuanInk2Count', 0)
    chain = calc.resourceResult.value!.characters.find(c => c.agentId === '1371')!.yixuanExChain!
    expect(chain.ink3Count).toBe(0)
    expect(chain.ink2Count).toBeGreaterThan(0)
  }, 300_000)
})

