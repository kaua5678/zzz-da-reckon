/**
 * R65 batchA —— **§R64-J1 `hidden` 的 UI 面语义缺口**判据（「可点但拨了没反应」= 面向用户的缺陷）。
 *
 * ## 闸门判定：前提假设**成立**（本任实测，行为层）
 *
 * R64 交接 §2.1 的前提 = 「界面上仍有『可点但无任何数值效果』的控件是面向用户的缺陷」。
 * 本任逐条跑真管线（真 `setupHarness` → 真 `useResourceCalc`）：
 *
 * | 条 | `hidden` | `effects` | 拨 checkbox/覆盖率 ⇒ damagePoolRows 全行 sha256 | 判定 |
 * |---|---|---|---|---|
 * | `1061/corin_c2_enemy_phys_res` | true | 1 | **1 个变体**（三档逐位相同） | 死控件 |
 * | `1311/yaojiayin.special_aria_buff` | true | 2 | **1 个变体** | 死控件 |
 * | `1391/jufufu.extra_ability_team_decibel` | — | **0** | **1 个变体** | 死控件 |
 * | `1181/grace_c1_team_energy` | — | **0** | **1 个变体** | 死控件 |
 * | `1381/anby_zero_potential_followup` | — | **0** | **1 个变体** | 死控件 |
 * | `1541/promethea_core_team_voidflare` | — | **0** | **1 个变体** | 死控件 |
 * | `1541/promethea_c1_extra_def_ignore` | — | **0** | **1 个变体** | 死控件 |
 *
 * ⇒ **缺口 7 例**（不只是 R64 已知的那 1 例），且**后 5 例根本没有 `hidden`** ——
 * 它们靠「`effects` 为空」逃过了数值通道过滤，却同样渲染出拨不动的 checkbox。
 * 对照组（反过度过滤）：`effects` 为空但 `buffModifiers` 非空的 **5 条**里 **4 条**拨动**确实**改数值
 * （丽娜 C1 / 青衣 C2 / 凯撒 C2 / 诺姆 C2；潘引壶 C6 那条恒等 = 其目标条承载条件不满足，
 * 见 R62 第六句「仪器盲区」）⇒ **不能一刀切「effects 为空就砍控件」**。
 *
 * ## 根因：一个字段背了两件事
 *
 * `hidden` 这个名字声称管 UI，实际全库渲染面**零处读它**（只在数值通道被消费，防双计）。
 * 而真正决定「拨了会不会变」的，是「该条会不会进数值通道」×「结构上有没有可求值的东西」。
 * ⇒ 修法（规则 17 选长期）：**拆语义**
 * · `hidden` → **`singleSourced`**（数值单源化，名字说实话；语义逐条不变）；
 * · 「可交互」→ **从数据派生**，不再靠人肉打标（`src/utils/teammateBuffRows.ts`）
 *   ⇒ 结构上不可能再出现「忘了打某个字段就渲染出死控件」。
 *
 * ## 判据口径（两侧都不取自被测对象 + 免腐化）
 *
 * - 期望值**不读被测模块的常量**：不变量两侧分别来自**数据**（真实 teammateBuffGroups）
 *   与**行为**（真管线读数），谓词只是被检验对象。
 * - ★ **免样本腐化**（R64 教训）：集合一律**运行时派生**（扫全库算出 declared-only / interactive），
 *   不硬编码 id 清单。将来某条被正确实现（加了 effects）⇒ 它自动离开 declared-only 集，
 *   本判据**不会恒红**；同时**反空洞下限**保证集合意外为空时必须红（R62 第七句）。
 * - ★ **探针的绿可能是没跑起来**：每个行为断言都带 `executed = passed + failed` 意义上的
 *   非空断言（读数条数、总伤 > 0），并配一条**活控件正控**证明管线确实在工作。
 * - ⚠ 本任**未**声称 `singleSourced` 能治「死控件」（R64 已证伪：numerically no-op）；
 *   它治的是**语义混淆**。死控件的治法是「不给控件」，即本判据的主体。
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { collectInCombatTeamBuffs } from '@/core/inCombatBuffs'
import {
  isTeammateBuffInteractive, hasComputablePayload, entersNumericChannel,
  interactiveTeammateBuffs, declaredOnlyTeammateBuffs, declaredOnlyReason,
} from '@/utils/teammateBuffRows'
import type { TeammateBuff, TeammateBuffGroup } from '@/types/catalog'

const MAIN = '1591' // 希格莉德（强攻，通用主C位；只作读数载体，不参与断言）
/** 反空洞下限：实测 7（`effects=[] && buffModifiers=[]`）；写成 ≥5 留出合法数据演化余量 */
const MIN_DECLARED_ONLY = 5
/** 反空洞下限：实测 129；谓词写坏（恒 false）时集合会塌到 0 ⇒ 必须红 */
const MIN_INTERACTIVE = 50
/** 反过度过滤下限：modifier-only 里实测 4/5 真驱动读数（潘引壶 C6 是条件型盲区） */
const MIN_MODIFIER_ONLY_LIVE = 3

function rowHash(rows: Array<Record<string, unknown>>): string {
  return createHash('sha256')
    .update(rows
      .map(r => [r.slot, r.agentId, r.moveId, r.type, r.totalDamage, r.note].join('|'))
      .sort().join('\n'))
    .digest('hex').slice(0, 16)
}

/** 全库队友 buff 行（运行时派生，不硬编码） */
async function allRows(): Promise<Array<{ group: string; buff: TeammateBuff }>> {
  await setupHarness([{ agentId: MAIN }, '', ''])
  const cat = useCatalogStore()
  return (cat.teammateBuffGroups as TeammateBuffGroup[])
    .flatMap(g => (g.buffs ?? []).map(b => ({ group: g.id, buff: b })))
}

/**
 * 真管线读数：owner 在 slot1，主C 在 slot0；返回三态（原样 / 强制关 / 强制开）的
 * damagePoolRows 全行 sha256 + 总伤。**每点独立 setupHarness**（R52 坑①）。
 */
async function readingsFor(
  owner: string,
  buffId: string,
  cinema: number,
): Promise<Array<{ mode: string; hash: string; total: number; rows: number }>> {
  const out: Array<{ mode: string; hash: string; total: number; rows: number }> = []
  for (const mode of ['auto', 'off', 'on'] as const) {
    const { config } = await setupHarness([
      { agentId: MAIN, cinemaLevel: 6 },
      { agentId: owner, cinemaLevel: cinema },
      '',
    ])
    for (const b of config.globalBuffs) b.enabled = false
    if (mode !== 'auto') config.toggleTeammateBuff(buffId, mode === 'on')
    config.refreshTrigger++
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 0)) // resourceResult 必须在 await 之后读
    const rows = calc.damagePoolRows.value as unknown as Array<Record<string, unknown>>
    out.push({
      mode,
      hash: rowHash(rows),
      total: Math.round(rows.reduce((s, r) => s + Number(r.totalDamage ?? 0), 0) * 100) / 100,
      rows: rows.length,
    })
  }
  return out
}

describe('R65 batchA · 队友 Buff 死控件缺口（UI 面语义拆分）', () => {
  /**
   * ★★ 判据主体（结构面，全库不变量）：**页面渲染为可交互的条，必须结构上真有效果可算**。
   *
   * 等价陈述：declared-only 集 = 「不进数值通道」∪「没有可求值载荷」。
   * 这是本次修复的契约面 —— 修好之后，「结构上不可能有效果」的条**结构上不可能**拿到控件。
   */
  it('不变量：可交互 ⟺ (进数值通道 ∧ 有可求值载荷)；declared-only 必须是其补集', async () => {
    const rows = await allRows()
    const interactive = interactiveTeammateBuffs(rows.map(r => r.buff))
    const declared = declaredOnlyTeammateBuffs(rows.map(r => r.buff))

    // 完备性：两集互斥且覆盖全库（谓词写坏成恒真/恒假都会在这里露）
    expect(interactive.length + declared.length, '两个集合必须恰好划分全库').toBe(rows.length)

    // 反空洞下限（R62 第七句：集合意外为空时「扫不到」与「真清零」不可区分）
    expect(declared.length,
      `declared-only 条数 ${declared.length} 低于下限 ${MIN_DECLARED_ONLY} —— 谓词可能被写坏成恒 true`).toBeGreaterThanOrEqual(MIN_DECLARED_ONLY)
    expect(interactive.length,
      `可交互条数 ${interactive.length} 低于下限 ${MIN_INTERACTIVE} —— 谓词可能被写坏成恒 false`).toBeGreaterThanOrEqual(MIN_INTERACTIVE)

    // 逐条契约：可交互 ⇒ 进通道 ∧ 有载荷
    for (const b of interactive) {
      expect(entersNumericChannel(b), `${b.id} 被判可交互却没进数值通道`).toBe(true)
      expect(hasComputablePayload(b), `${b.id} 被判可交互却没有任何可求值载荷`).toBe(true)
    }
    // 逐条契约（反向）：declared-only ⇒ 两个理由至少命中一个
    for (const b of declared) {
      const reasonOk = b.singleSourced === true || !hasComputablePayload(b)
      expect(reasonOk, `${b.id} 被判 declared-only 但既不 singleSourced 也有载荷`).toBe(true)
      expect(declaredOnlyReason(b).length, `${b.id} 缺少 declared-only 理由文案`).toBeGreaterThan(0)
    }
  })

  /**
   * ★ 与数值通道**同一判据**（不是两处各写一份）：进通道 ⟺ `!singleSourced`。
   * 用引擎真函数 `collectInCombatTeamBuffs` 验证 `singleSourced` 条**确实**被排除
   * —— 这是改名「语义逐条不变」的零 delta 证据（若改名时写反，这里立刻红）。
   */
  it('数值通道：singleSourced 条不得出现在 collectInCombatTeamBuffs 的结果里', async () => {
    const { config } = await setupHarness([
      { agentId: MAIN, cinemaLevel: 6 },
      { agentId: '1311', cinemaLevel: 6 },
      '',
    ])
    const cat = useCatalogStore()
    const groups = cat.teammateBuffGroups as TeammateBuffGroup[]
    // 把该 owner 全部条打开（否则过滤条件里的 enabled 会掩盖「被 singleSourced 排除」这一事实）
    for (const g of groups) for (const b of g.buffs ?? []) config.toggleTeammateBuff(b.id, true)

    const collected = collectInCombatTeamBuffs(
      [{ agentId: MAIN, cinemaLevel: 6, driveDisc: {} as never }, { agentId: '1311', cinemaLevel: 6, driveDisc: {} as never }],
      {
        teammateBuffGroups: groups,
        driveDiscSetsMap: cat.driveDiscSetsMap as never,
        getAgent: id => cat.getAgent(id) as never,
        getWEngine: id => cat.getWEngine(id) as never,
        isTeammateBuffEnabled: () => true,
      },
    )
    const collectedIds = new Set(collected.map(b => b.id))
    const singleSourced = groups.flatMap(g => g.buffs ?? []).filter(b => b.singleSourced === true)
    expect(singleSourced.length, '全库应有 singleSourced 条（反空洞）').toBeGreaterThan(0)
    for (const b of singleSourced) {
      expect(collectedIds.has(b.id),
        `${b.id} 标了 singleSourced 却仍进了数值通道（防双计失效）`).toBe(false)
    }
    // ★ 反向反锁：**同一 owner** 的非单源化条**必须**进通道 —— 证明上面的排除是「按条判」
    // 而不是「整组都没进」（后者会让本判据变成恒真的橡皮图章）。
    // 选 1311：它同时有 singleSourced 条与普通条（1061 只有前者，做不了这个对照）。
    const ownerOther = groups.flatMap(g => g.buffs ?? [])
      .filter(b => b.ownerId === '1311' && b.singleSourced !== true && (b.effects?.length ?? 0) > 0)
    expect(ownerOther.length, '1311 应有非单源化条（反锁前提）').toBeGreaterThan(0)
    for (const b of ownerOther) {
      expect(collectedIds.has(b.id),
        `${b.id} 是普通条却被排除了 ⇒ 过滤条件写成了「整组排除」`).toBe(true)
    }
  })

  /**
   * ★★ 行为面（**免腐化**）：谓词判为 declared-only 的**每一条**，拨它都必须**不驱动任何读数**。
   *
   * 这正是「不给控件」的正当性证据。集合运行时派生 ⇒ 将来某条被正确实现（拿到 effects）
   * 会自动离开本集合，本判据**不会恒红**。
   */
  it('行为：declared-only 集逐条拨动 ⇒ damagePoolRows 读数恒定（不给控件的正当性）', async () => {
    const rows = await allRows()
    const declared = declaredOnlyTeammateBuffs(rows.map(r => r.buff))
    expect(declared.length).toBeGreaterThanOrEqual(MIN_DECLARED_ONLY)

    let nonConstant = 0
    for (const b of declared) {
      const owner = rows.find(r => r.buff.id === b.id)!.group
      const seen = await readingsFor(owner, b.id, 6)
      // 探针必须有牙：读数非空（否则「恒定」是「没跑起来」的假绿）
      expect(seen.every(s => s.rows > 0), `${b.id} 伤害池为空 ⇒ 读数不可采信`).toBe(true)
      const variants = new Set(seen.map(s => s.hash)).size
      if (variants !== 1) {
        nonConstant++
        // eslint-disable-next-line no-console
        console.log(`[R65] declared-only 却有数值效果：${b.id}`, JSON.stringify(seen))
      }
    }
    expect(nonConstant,
      `${nonConstant} 条被判 declared-only 却驱动了读数 ⇒ 谓词漏判（这些条本该给控件）`).toBe(0)
  })

  /**
   * ★★ 反过度过滤（**正控**）：`effects` 为空但 `buffModifiers` 非空的条**必须仍可交互**，
   * 且其中**至少 N 条**拨动**确实**改数值 —— 证明本修法没有把活控件一起砍掉。
   *
   * ⚠ 刻意**不**要求全部驱动：潘引壶 C6 那条的数值挂在「目标条承载条件满足」上
   * （实测恒等），那是 R62 第六句的**仪器盲区**，不是缺陷 ⇒ 断言取下限而非全等。
   */
  it('反过度过滤：modifier-only 条仍可交互，且其中 ≥N 条真驱动读数', async () => {
    const rows = await allRows()
    const modifierOnly = rows
      .map(r => r.buff)
      .filter(b => (b.effects?.length ?? 0) === 0 && (b.buffModifiers?.length ?? 0) > 0)
    expect(modifierOnly.length, 'modifier-only 样本（反空洞）').toBeGreaterThanOrEqual(4)
    for (const b of modifierOnly) {
      expect(isTeammateBuffInteractive(b),
        `${b.id} 靠 buffModifiers 放大别的条 ⇒ 拨它确实改数值，不得被砍掉控件`).toBe(true)
    }

    let live = 0
    for (const b of modifierOnly) {
      const owner = rows.find(r => r.buff.id === b.id)!.group
      const seen = await readingsFor(owner, b.id, 6)
      expect(seen.every(s => s.rows > 0)).toBe(true)
      if (new Set(seen.map(s => s.hash)).size > 1) live++
    }
    expect(live,
      `modifier-only 里只有 ${live} 条真驱动读数（下限 ${MIN_MODIFIER_ONLY_LIVE}）⇒ 修法把活控件砍了`).toBeGreaterThanOrEqual(MIN_MODIFIER_ONLY_LIVE)
  })

  /**
   * ★ 管线正控（证明上面的「恒定」不是因为伤害池根本没算）：
   * 取一条**普通可交互**的加伤条，拨它必须改读数。
   */
  it('正控：一条普通可交互条拨动 ⇒ 读数确实变化（证明管线在工作）', async () => {
    const rows = await allRows()
    // 运行时挑一条：可交互 + 有 effects + owner 是普通在册角色
    const pick = rows.find(r =>
      isTeammateBuffInteractive(r.buff)
      && (r.buff.effects?.length ?? 0) > 0
      && r.buff.ownerId === '1071') // 凯撒·金｜核心被动：全队攻击 +1000（纯加值，必然咬合）
    expect(pick, '未找到用作正控的可交互条').toBeTruthy()
    const seen = await readingsFor(pick!.group, pick!.buff.id, 6)
    expect(seen.every(s => s.rows > 0)).toBe(true)
    expect(new Set(seen.map(s => s.hash)).size,
      `正控 ${pick!.buff.id} 未咬合（读数 ${JSON.stringify(seen)}）⇒ 本文件其它「恒定」结论不可采信`
    ).toBeGreaterThan(1)
  })
})
