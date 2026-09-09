/**
 * 探针：琉音赠大时间**跨层对账**（轴栈窗口 vs 引擎账本 vs 装配 gift 行 vs carve）。
 *
 * 用途：撤 `probeExcludedTeam`（1591 一族）卡在「跨层口径统一」上——本探针把四层各自的
 * 「赠大占了多少秒」量出来，判定是否**重复计量**，供用户裁决口径。不设判据，只打表。
 *
 * 运行（不设 env 时空跑，普通 vitest run 不受影响）：
 *   PROBE_GIFT_TEAM=auto-1591-1481-1211,auto-1591-1481-1311 \
 *     npx vitest run src/composables/__tests__/giftAxisProbe.test.ts
 */
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { isFrontlineExecution } from '@/types/resource'

const env = process.env
const ids = (env.PROBE_GIFT_TEAM ?? '').split(',').map(s => s.trim()).filter(Boolean)
const active = ids.length > 0

const f = (n: number | undefined, d = 3) => (n ?? 0).toFixed(d)

describe.runIf(active)('探针：琉音赠大跨层对账', () => {
  it('逐队打表', async () => {
    const lines: string[] = []
    lines.push(`env PROBE_INCLUDE_1591=${String(process.env.PROBE_INCLUDE_1591)} PROBE_GIFT_TEAM=${String(process.env.PROBE_GIFT_TEAM)}`)
    for (const id of ids) {
      const soloId = id.startsWith('solo:') ? id.slice(5) : ''
      const preset = soloId ? null : teamPresets.find(p => p.id === id)
      if (!soloId && !preset) { lines.push(`### ${id}  ← 预设未命中`); continue }
      const { catalog } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const config = useConfigStore()
      if (soloId) {
        config.setAgent(0, soloId)
      } else {
        for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
        config.applyTeamPreset(preset!.team as [string, string, string])
      }
      const calc = useResourceCalc()
      const rr = calc.resourceResult.value
      if (!rr) { lines.push(`### ${id}  ← 无结果`); continue }
      const stack = calc.stackTraversalResult.value
      const sp = calc.stunPoolResult.value
      const summary = buildTeamTimeSummary({
        rr, battleTime: rr.totalTime,
        invincibleTime: config.enemy.invincibleTime ?? 0,
        nameOf: (_a, slot) => `槽${slot}`,
      })
      lines.push(`\n================ ${id}${preset ? `（${preset.name}）` : ''}`)
      lines.push(`队伍 ${(preset ? preset.team : [soloId]).join('/')} · 失衡 ${sp?.stunCount ?? 0} 次 · 窗口 ${f(calc.windowDuration.value)}s · 战斗 ${rr.totalTime}s`)
      lines.push(`留白 ${f(summary.slack)}s · 超预算 ${f(Math.max(0, -summary.slack))}s · outerExit=${rr.convergence?.outerExit ?? '—'} · tbConv=${rr.convergence?.timeBudgetConverged}`)
      lines.push(`liuyinGiftTimeReserved=${rr.liuyinGiftTimeReserved ?? 0}（引擎账本侧预留；轴模式=0 表示未预留）`)
      const axisPromote = calc.resourceConfig.value?.axisLiuyinPromote
      const giftRowsAll = rr.characters.flatMap(c => (c.executions ?? [])
        .filter(e => e.source === 'gift' || (e as { normaGiftChain?: boolean }).normaGiftChain)
        .map(e => ({ slot: c.slot, moveId: e.moveId, count: e.count, time: e.totalTime ?? 0 })))
      lines.push(`试探/账本侧轴赠大计数=${axisPromote ? `${axisPromote.count}@槽${axisPromote.targetSlot}` : '—'} · 装配侧赠行=${giftRowsAll.map(g => `槽${g.slot}:${g.moveId}×${g.count}@${f(g.time)}`).join(' | ') || '无'}`)

      lines.push(`--- 轴栈（core/stunAxisStack）`)
      const axes = calc.effectiveStunAxes.value ?? []
      lines.push(`  轴预设：${axes.length ? axes.map(a => `${a.name}[${a.actions.map(x => `${x.slot}:${x.moveId}×${x.count}${x.promoteVariant ? `(${x.promoteVariant})` : ''}${x.startTime ? `@${x.startTime}` : ''}`).join(' ')}]`).join(' || ') : '（无）'}`)
      if (!stack) lines.push(`  （无轴：stackTraversalResult=null）`)
      else {
        lines.push(`  timeUsed=${f(stack.timeUsed)}（窗口内动作时长和，含 promoteVariant 赠大块） overlap=${f(stack.overlapSeconds)} windowsUsed=${stack.windowsUsed}`)
        lines.push(`  basicFillBySlot=${JSON.stringify(Object.fromEntries(Object.entries(stack.basicFillBySlot).map(([k, v]) => [k, Math.round(v * 1000) / 1000])))}`)
        const execKeys = Object.entries(stack.executed).map(([k, v]) => `${k}×${v.count}`)
        lines.push(`  executed=${execKeys.join(' | ')}`)
        const ovKeys = Object.entries(stack.overlapByAction).map(([k, v]) => `${k}=${f(v)}`)
        if (ovKeys.length) lines.push(`  overlapByAction=${ovKeys.join(' | ')}`)
        if (stack.skipped.length) lines.push(`  skipped=${stack.skipped.map(s => `${s.slot}:${s.moveId}(${s.reason})`).join(' | ')}`)
        // 资源模型对账（用户 2026-09-10 裁决 #3）：轴栈「实际执行集合」vs 引擎「推导次数」
        const bySlot = new Map<number, Record<string, number>>()
        for (const v of Object.values(stack.executed)) {
          const m = bySlot.get(v.slot) ?? {}
          m[v.moveId] = (m[v.moveId] ?? 0) + v.count
          bySlot.set(v.slot, m)
        }
        for (const c of rr.characters) {
          const ex = bySlot.get(c.slot) ?? {}
          lines.push(`  ↳ 槽${c.slot} 引擎次数 ex=${f(c.exSpecialCount, 3)} ult=${f(c.ultimateCount, 3)} chain=${f(c.chainCountTotal, 3)} | 槽位资源 闪能=${f(c.energySource?.total, 1)} 喧响=${f(c.decibelSource?.total, 1)} | 轴栈 executed=${Object.entries(ex).map(([k, v]) => `${k}×${v}`).join(' ') || '—'}`)
        }
      }

      const bd = calc.damageSourceBreakdown.value as unknown as { rows?: { label?: string; value?: number }[] } | null
      if (bd?.rows?.length) {
        const top = [...bd.rows].filter(r => (r.value ?? 0) > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 8)
        lines.push(`--- 伤害来源 top8：${top.map(r => `${r.label ?? '?'}=${Math.round(r.value ?? 0)}`).join(' | ')}`)
      }
      lines.push(`--- 逐槽：账本 vs 物化行`)
      for (const c of rr.characters) {
        const rows = (c.executions ?? []).filter(e => isFrontlineExecution(e) && (e.totalTime ?? 0) > 0)
        const rowSum = rows.reduce((s, e) => s + (e.totalTime ?? 0), 0)
        const ledger = (c.timeAllocation.necessaryTime ?? 0) + (c.timeAllocation.basicAttackTime ?? 0)
        const giftRows = (c.executions ?? []).filter(e => e.source === 'gift')
        lines.push(`  槽${c.slot} ${c.agentId}：账本 ${f(ledger)}（nec ${f(c.timeAllocation.necessaryTime)}+basic ${f(c.timeAllocation.basicAttackTime)}） · 行Σ ${f(rowSum)} · 差 ${f(rowSum - ledger)} · 前台 ${f(c.timeAllocation.frontlineTime)} 后台 ${f(c.timeAllocation.backstageTime)}`)
        lines.push(`      行：${rows.map(e => `${e.moveId}×${e.count}@${f(e.totalTime)}${e.source ? `[${e.source}]` : ''}`).join(' | ')}`)
        if (giftRows.length) {
          lines.push(`      gift 行：${giftRows.map(e => `${e.moveId}×${e.count}@${f(e.totalTime)}（单次 ${f(e.actionTime)}）`).join(' | ')}`)
          // 对照组：同 moveId 的**自身**行（经 enrich 回填）——用于判断赠行若改由 enrich 回填是否同值
          for (const g of giftRows) {
            const twin = (c.executions ?? []).find(e => e !== g && e.moveId === g.moveId)
            if (!twin) { lines.push(`      ↳ ${g.moveId} 无同 moveId 对照行`); continue }
            const pick = (e: typeof g) => `dmg=${e.damageMultiplier ?? '—'}${e.damageMultiplierOverride ? '(ov)' : ''} daze=${e.dazeMultiplier ?? '—'}${e.dazeMultiplierOverride ? '(ov)' : ''} anom=${e.anomalyBuildUp ?? '—'}${e.anomalyBuildUpOverride ? '(ov)' : ''} db=${e.decibelRecovery ?? '—'}${e.decibelRecoveryOverride ? '(ov)' : ''} tgt=${e.skillDamageTarget ?? '—'}`
            lines.push(`      ↳ 同 moveId 对照：gift[${pick(g)}] vs 自身[${pick(twin)}]`)
          }
        }
        const ov = Object.entries(stack?.overlapByAction ?? {}).filter(([k]) => k.startsWith(`${c.slot}:`))
        if (ov.length) lines.push(`      轴合轴扣减：${ov.map(([k, v]) => `${k}=${f(v)}`).join(' | ')}`)
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 600_000)
})
