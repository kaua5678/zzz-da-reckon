/**
 * R64 batchA —— **§R63-J2 `velina_infection_zone` 死控件**的判据（「同一效果的第二个声明」形态）。
 *
 * ## 本任的闸门判定：交接 §1.4 给的**修法前提被证伪**（这是本文件存在的首要理由）
 *
 * R63 交接 §1.4/§2.2 断言修法 = 给 spec 1561 那条加 `"hidden": true`：
 *   「加 `hidden` 会使 `isTeammateBuffEnabled` 恒 false ⇒ 滑块消失」。
 * **实测三条都不成立**（真管线，spec 条仍在时的读数）：
 *   ① `hidden: true` **不参与** `deriveTeammateBuffEnabled`（`config.ts` 全函数零 `hidden` 判据）
 *      ⇒ `enabled` 仍由「在队 + 影画」派生，实测注入后仍为 **true**（不是恒 false）；
 *   ② `hidden` 只在**数值通道**被消费（`inCombatBuffs.ts:75` / `buff.ts:504` 过滤），
 *      而属性配置页 `v-for="buff in group.buffs"` **不过滤 hidden**
 *      ⇒ 条目与滑块**照旧渲染**（既有先例 `1061/corin_c2_enemy_phys_res` 实测 checkbox+slider 都在）；
 *   ③ 拨覆盖率三档总伤仍**恒 2,144,436.73 附近的同一值** ⇒ 死控件**没被治好**。
 *   ⇒ `hidden` 对本形态是 **no-op**（它治的是「模块已接入 + spec 又录一条」的**双计**，不是「死控件」）。
 *
 * ## 根因（三写者，真正生效的那条是赋值）
 *
 * | # | 写者 | 写法 | 结果 |
 * |---|---|---|---|
 * | W1 | `panelPhases.ts:690` 通用规则 | `panel.infectionZoneBonus = windCharInTeam ? 10 : 0` | **赋值** ⇒ 覆写 buff 通道 |
 * | W2 | `core/buff.ts:795` buff 通道 | `panel.infectionZoneBonus += value` | 被 W1 覆盖（spec 条的值到此为止） |
 * | W3 | `useResourceCalc.ts:705` 编排层 | `infectionZoneBonus: Math.max(0, 10 × 覆盖率)` | **最终赢家**（`damagePanels` 覆盖一切） |
 *
 * ⇒ spec 那条**两个消费者都到不了**：面板面被 W1 覆写，伤害面被 W3 覆写。滑块是纯装饰。
 *
 * ## ★★ 修法选择（R63 最值钱那条：「同一效果还是不同效果？」）
 *
 * 问句的答案由**行为层**给出（见 `it('归属判据')`）：把维琳娜换成**别的风角色**（1621 洛克茜 /
 * 1631 赛维里安）——侵染区**照样给 10**。⇒ 这不是「维琳娜的拐力」，而是**风队通用机制**
 * ⇒ spec 那条是**同一效果的第二个声明**（且归属挂错人）⇒ 正解 = **单源化：撤掉 spec 条目**
 * （不是 `hidden`、更不是 `+=`：`+=` 会变 20 = 双计，正是 R63 警告过的机械照搬）。
 *
 * ## 判据口径（两侧都不取自被测对象）
 *
 * ① **外部事实层**：`docs/mechanism-reference.md` §8.6「风化系数：10%」+ 「**其他风属性角色的
 *    风化系数待实测**」 ⇒ 该机制**按风属性定义**、不按维琳娜定义。期望值钉文档原文，不读被测模块常量。
 * ② **行为层**：真 `setupHarness` → 真 `useResourceCalc()` / 真 `computePanelPhases()`；
 *    每点**独立** `setupHarness`（R52 坑①）。
 * ③ **对抗性反锁**：非风队伍必须给 0（证明读数不是恒真）；两个**不同**风角色给同一个 10
 *    （证明归属不在维琳娜）。
 * ④ **零 delta 取证**：删除前后 6 队 × 4 覆盖率档的全行 sha256 **逐位相同**（见提交说明）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { getAgentSpecsByAgentId } from '@/specs/registry'

const WIND_AGENTS = ['1561', '1621', '1631'] as const
const NON_WIND = '1211'

/**
 * ① 外部事实层：`docs/mechanism-reference.md` §8.6 逐字解析「风化系数：N%」。
 * ⚠ 期望值**不取自被测对象**（R61 最贵教训：`expect(x).toBe(被测模块导出常量)` 是同义反复）。
 */
function rawWindInfectionCoefficient(): number {
  const doc = readFileSync(
    new URL('../../../docs/mechanism-reference.md', import.meta.url), 'utf8')
  const m = doc.match(/风化系数：(\d+(?:\.\d+)?)%/)
  if (!m) throw new Error('mechanism-reference.md 未解析出「风化系数：N%」')
  return Number(m[1])
}

async function panelOf(team: Parameters<typeof setupHarness>[0]) {
  await setupHarness(team)
  return computePanelPhases(0, useConfigStore(), useCatalogStore())?.inCombat as unknown as
    { infectionZoneBonus?: number } | undefined
}

async function totalOf(team: Parameters<typeof setupHarness>[0], cov: number) {
  const { config } = await setupHarness(team)
  for (const b of config.globalBuffs) b.enabled = false
  const calc = useResourceCalc()
  config.setMechanicSetting('wind.infectionCoverage', cov)
  await new Promise(r => setTimeout(r, 60))
  return calc.damagePoolRows.value.reduce((s, r) => s + r.totalDamage, 0)
}

describe('R64 batchA · 侵染区单源化（「同一效果的第二个声明」撤回）', () => {
  /**
   * ★★ 归属判据（**修法选择的决定性证据**）：三个**不同**的风角色给同一个系数。
   * 若侵染是「维琳娜的拐力」，换成 1621/1631 必须为 0 —— 实测不是。
   */
  it('归属：任意风角色(1561/1621/1631)在队**至少**给基础系数 10，与「是不是维琳娜」无关', async () => {
    const want = rawWindInfectionCoefficient()
    expect(want, `mechanism-reference §8.6 声明风化系数 ${want}%`).toBe(10)
    for (const id of WIND_AGENTS) {
      const p = await panelOf([{ agentId: '1591' }, { agentId: id }, ''])
      // 基础值来自通用规则（WIND_INFECTION_BASE_BONUS）；角色**额外**加成叠在上面（见下条）。
      expect(p?.infectionZoneBonus,
        `${id} 在队时侵染区至少为 ${want}（该机制按风属性定义，不按维琳娜定义）`
      ).toBeGreaterThanOrEqual(want)
    }
  })

  /**
   * ★★ 2026-10-26 用户裁决：「没标注的风化侵染区就是 10% 独立直伤增伤，洛克茜说额外 8%，
   *    那么这个侵染区就是 18% 了」。
   *
   * 判据两侧都钉外部事实：10 = mechanism-reference §8.6（原文层），8 = 洛克茜 raw
   * `passive.level.1621507.desc`「敌人处于…[风化]状态下时，敌人受到的[风属性直接攻击伤害]和
   * 触发[浸染]属性的直接攻击伤害额外提升 8%」（原文层）。⇒ 期望 18 不是「读被测对象常量」。
   */
  it('洛克茜额外能力 +8% 与基础 10% **同区加算** ⇒ 该队侵染区 18%（其他风角色仍 10）', async () => {
    const base = rawWindInfectionCoefficient()
    const roxyRaw = readFileSync(new URL('../../../data/raw/nanoka_missing/full/1621.json', import.meta.url), 'utf8')
    const roxy8 = roxyRaw.replace(/<[^>]+>/g, '').match(/触发\[浸染\]属性的直接攻击伤害额外提升(\d+)%/)
    expect(roxy8?.[1], 'raw 1621 应声明浸染直伤 +8%').toBe('8')

    const withRoxy = await panelOf([{ agentId: '1621' }, { agentId: '1591' }, ''])
    expect(withRoxy?.infectionZoneBonus, '洛克茜在队 = 基础 10 + 额外 8 = 18').toBe(base + 8)
    // 对照臂：同一队型换成维琳娜 ⇒ 只有基础 10（证明 +8 是洛克茜的、不是「有风就给 18」）
    const withVelina = await panelOf([{ agentId: '1561' }, { agentId: '1591' }, ''])
    expect(withVelina?.infectionZoneBonus, '维琳娜没有这条额外加成').toBe(base)
  })

  /**
   * ★ 对抗性反锁：**非风**队伍同一读数必须为 0（证明上一条不是恒真）。
   */
  it('反锁：无风角色 ⇒ 系数 0（同一读数能分辨「有风/无风」）', async () => {
    const p = await panelOf([{ agentId: '1591' }, { agentId: NON_WIND }, ''])
    expect(p?.infectionZoneBonus, '队伍无风角色时侵染区不得生效').toBe(0)
  })

  /**
   * ★★ 核心不变量（**本任的修复面**）：spec `teamBuffs` **不得**再声明 `infectionZoneBonus`。
   *
   * 理由：该字段的唯一合法写者是通用规则（W1，按风属性）+ 编排层（W3，按覆盖率）；
   * 任何 spec 声明都会变成「拨不动的死控件」（数值被覆写），且把通用机制**误挂**到某个角色名下。
   */
  /**
   * ★★ 不变量（2026-10-26 换尺）：spec **可以**声明 `infectionZoneBonus`（洛克茜额外能力 +8% 就是这么进的），
   * 但每一条声明都必须**真的进面板**（`panelPhases` 的基础 10% 已是 `+=`，不再是赋值覆写）。
   *
   * 判据取行为面而非静态名单：对每个声明者跑真管线，断言「该角色在队的面板值 = 基础 10 + Σ声明值」。
   * 若有人把基础写回赋值，这里会读到 10 而不是 18 ⇒ 红（这正是 R64 的原始缺陷形态：拨不动的死控件）。
   */
  it('不变量：每条 spec 声明的 infectionZoneBonus 都真的进面板（基础 10 + 声明值，不被覆写）', async () => {
    const declaredBy: string[] = []
    const declaredSum: Record<string, number> = {}
    for (const [owner, spec] of getAgentSpecsByAgentId()) {
      for (const tb of spec.teamBuffs ?? []) {
        for (const e of tb.effects ?? []) {
          if (e.stat !== 'infectionZoneBonus') continue
          declaredBy.push(owner)
          declaredSum[owner] = (declaredSum[owner] ?? 0) + Number(e.value ?? 0)
        }
      }
    }
    expect(declaredBy.length, '扫描面非空（洛克茜额外能力 +8% 在册）').toBeGreaterThan(0)
    const base = rawWindInfectionCoefficient()
    for (const owner of new Set(declaredBy)) {
      // 声明方的额外能力门控需要「强攻/命破/锋御」队友（洛克茜原文如此）⇒ 配 1591（强攻）满足，
      // 否则读到的是基础 10 而不是 18，会把这个「门控没触发」误判成「声明被覆写」。
      const p = await panelOf([{ agentId: owner }, { agentId: '1591' }, ''])
      expect(p?.infectionZoneBonus,
        `${owner} 声明了 infectionZoneBonus，必须真的进面板（基础 ${base} + 声明 ${declaredSum[owner]}）`
      ).toBe(base + declaredSum[owner]!)
    }
  })

  /**
   * ★ 端到端：机制滑块（**唯一活入口**）必须单调驱动总伤 —— 锁「数值仍在、且仍是覆盖率感知的」。
   * 若有人把 W3 也删掉（误以为「重复声明全删」），三档会塌成同值 ⇒ 本断言红。
   */
  it('端到端：wind.infectionCoverage 0/0.5/1 ⇒ 总伤严格单调递增（W3 单源仍活）', async () => {
    const team: Parameters<typeof setupHarness>[0] =
      [{ agentId: '1591' }, { agentId: '1561' }, '']
    const seen: number[] = []
    for (const cov of [0, 0.5, 1]) seen.push(await totalOf(team, cov))
    expect(seen[0], `覆盖率 0 应有伤害读数，实到 ${seen[0]}`).toBeGreaterThan(0)
    expect(seen[0], `0 → 0.5 应递增：${JSON.stringify(seen)}`).toBeLessThan(seen[1]!)
    expect(seen[1], `0.5 → 1 应递增：${JSON.stringify(seen)}`).toBeLessThan(seen[2]!)
  })

  /**
   * ★ 死控件反锁：`velina_infection_zone` 这个 id **不得**再出现在 teammateBuffGroups 里
   * （它是属性配置页的渲染数据源）⇒ 撤条目后条目与覆盖率滑块一并消失。
   */
  it('死控件反锁：teammateBuffGroups 里不得再有 velina_infection_zone', async () => {
    await setupHarness([{ agentId: '1591' }, { agentId: '1561' }, ''])
    const cat = useCatalogStore()
    const cfg = useConfigStore()
    const ids = cat.teammateBuffGroups.flatMap(g => (g.buffs ?? []).map(b => b.id))
    expect(ids, '该条已单源化撤除（数值走 W1/W3）').not.toContain('velina_infection_zone')
    expect(cfg.isTeammateBuffEnabled('velina_infection_zone'),
      'id 不再注册 ⇒ 启用位恒 false').toBe(false)
  })
})
