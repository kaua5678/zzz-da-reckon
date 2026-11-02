import { computed, type ComputedRef } from 'vue'
import type { PanelValues } from '@/types/catalog'
import { calcStunMultiplier } from '@/core/anomalyPool/helpers'
import { computeStunVulnSummary, computeStunVulnBySlot } from '@/composables/stunVulnSummary'
import { rowAppliedStunMultOf, rowFullStunMultOf, rowStunCoverage } from '@/core/stunVulnRow'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

/**
 * 失衡易伤可见化（账本 Open #2）——纯展示映射，从 `views/ResultPage.vue` 原样搬出
 * （2026-09-20 round 44 结构熵切面；函数体逐字节保真）。
 * 行级 stunMult = Boss 失衡易伤分量；生效易伤 = calcStunMultiplier(vuln, 面板加成, frac)。
 * 面板加成取槽 0（主C 惯例，与逐招矩阵探针同口径）；异常行无 stunMult → 显示 '—'、按 1 计。
 *
 * ⚠ 依赖以**同名参数**注入（`panels` / `damagePoolRows`）而不是重命名成 `panelInput` 之类：
 * 这样搬出的正文与原地**逐字节相同**，保真可机器证明（见 R44 报告的保真证明表）。
 *
 * ⚠ T188（2026-11-03）把第一个入参从 `configStore: ConfigModel` 收窄成 **`enemy: { stunVuln }`**：
 * 本函数只读 `configStore.enemy.stunVuln` 这一个量，而共享视图 `ResourcePoolView` 的入参是
 * **一个档位快照**（比较入口那一档是差分重放出来的 ⇒ 展示层不得读 store）。收窄后视图直接喂
 * 快照里的 `enemyStunVuln`，两处不可能再漂移（原先只有这一个读点，改完全库调用点仅此一处）。
 */
export function useStunVulnDisplay(opts: {
  /** 只读这一个量（Boss 失衡易伤基数）；**不许**再从这里读别的 store 字段 */
  enemy: { stunVuln: number }
  panels: ComputedRef<PanelValues[]>
  damagePoolRows: ComputedRef<DamagePoolRow[]>
}) {
  const { enemy, panels, damagePoolRows } = opts

  const stunVulnPanelOf = () => {
    const p0 = panels.value[0]
    return {
      vuln: enemy.stunVuln,
      bonus: p0?.stunDmgMultiplierBonus ?? 0,
      always: p0?.stunDmgMultiplierBonusAlways ?? 0,
      cap: p0?.stunDmgMultiplierBonusCapAlways ?? 0,
    }
  }
  // CC-226：行级覆盖率 / 基数直接取引擎写在行上的 stunCoverage / stunVulnBase（旧写法用 Boss stunVuln 反推，
  // 叶瞬光帷幕行触顶时基数 < stunVuln ⇒ 覆盖率被压低、生效易伤漏掉封顶后的值）。本段不再与 R44 搬迁原文逐字节相同。
  function appliedVulnOf(row: DamagePoolRow): string {
    if (row.stunMult === undefined) return '—'
    return rowAppliedStunMultOf(row, stunVulnPanelOf()).toFixed(3)
  }
  function stunVulnClassOf(row: DamagePoolRow): string {
    if (row.stunMult === undefined) return 'stun-vuln-na'
    const p = stunVulnPanelOf()
    const m = rowAppliedStunMultOf(row, p)
    const full = rowFullStunMultOf(row, p)
    if (m >= full - 1e-6) return 'stun-vuln-full'
    if (m <= 1 + 1e-6) return 'stun-vuln-zero'
    return 'stun-vuln-partial'
  }
  function stunVulnTitleOf(row: DamagePoolRow): string {
    if (row.stunMult === undefined) return '异常行：易伤已在结算内部，不逐行暴露'
    const frac = rowStunCoverage(row, enemy.stunVuln) ?? 0
    return `轴内覆盖 ${(frac * 100).toFixed(0)}% → 生效易伤 ×${appliedVulnOf(row)}`
  }
  // 行级生效易伤映射（全队汇总与逐人共用，避免两处各算一遍漂移）
  const stunVulnAppliedRows = computed(() => {
    const p = stunVulnPanelOf()
    return {
      full: calcStunMultiplier(p.vuln, p.bonus, p.always, p.cap, true),
      rows: damagePoolRows.value.map(row => ({
        slot: row.slot,
        totalDamage: row.totalDamage,
        appliedStunMult: rowAppliedStunMultOf(row, p),
      })),
    }
  })
  const stunVulnSummary = computed(
    () => computeStunVulnSummary(stunVulnAppliedRows.value.rows, stunVulnAppliedRows.value.full))
  /** 逐人失衡易伤增幅（用户 2026-09-13）：全队加权可下钻到每成员，直读「只兑现 X 成」 */
  const stunVulnPerSlot = computed(() => {
    const { full, rows } = stunVulnAppliedRows.value
    const names = new Map<number, string>()
    for (const r of damagePoolRows.value) if (!names.has(r.slot)) names.set(r.slot, r.agentName || `${r.slot + 1}号位`)
    return computeStunVulnBySlot(rows, full).map(p => ({ ...p, name: names.get(p.slot) ?? `${p.slot + 1}号位` }))
  })

  return { appliedVulnOf, stunVulnClassOf, stunVulnTitleOf, stunVulnAppliedRows, stunVulnSummary, stunVulnPerSlot }
}
