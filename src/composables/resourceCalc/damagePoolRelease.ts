/**
 * 逐角色主循环·段 R「异放 / 异常事件行」—— 自 `composables/resourceCalc/damagePool.ts#buildDamagePoolRows`
 * 的 :672–927 原样外提（CC-9b，2026-09-25，零行为搬迁）。
 *
 * 职责：`for (const event of charResult.anomalyEventExecutions)` 逐事件出异放 / 极性紊乱 /
 * 直伤事件行（含 Boss 异常状态轴归因、失衡内占比拆段）。
 *
 * 与外层闭包的通信面 = `CharRowsEnv`（定义在 `./damagePoolDirect`）：共享输出数组 `rows`
 * （`rows.push` 与 `pushRelease` / `pushDirect` 闭包，按原顺序 push，禁止换成返回值拼接）
 * + `ctx` 快照 + 只读局部量/闭包。函数**不** import `./damagePool`（只 `import type`
 * `DamagePoolContext`，运行时无环），也不写任何外层可变量。
 *
 * 依赖方向：本文件不得 import `./damagePool`（值）；只依赖类型与同目录兄弟模块
 * （`./helpers`）与引擎子模块（`@/core/*` 等）。
 */
import { panelAt } from '@/core/panel'
import { attributeCountByStateChain } from '@/core/stunAxis/inStunAnomaly'
import { allocateAxisWindows } from '@/core/stunAxisStack'
import { getBaseElement, getMainApplierSlot, distributeIntegerByWeight } from '@/core/anomalyPool/helpers'
import { safeElement } from './helpers'
import type { CharRowsEnv, CharLocals } from './damagePoolDirect'

/**
 * 段 R「异放 / 异常事件行」（零行为搬迁，CC-9b）。
 * 函数体 = 原 `buildDamagePoolRows` :672–927 逐字保留（仅去 4 空格公共缩进），
 * 只在头部解构 `env.ctx` / `env` / `cl`；其余表达式一字不改。
 */
export function emitCharReleaseRows(env: CharRowsEnv, cl: CharLocals): void {
  const {
    configStore,
    damagePanels, stunCoverage, axisAllocation: allocMap,
    anomalyPoolResult, bossAnomalyState, stunPoolResult, effectiveStunAxes,
    computeWindowDuration,
  } = env.ctx
  const {
    rows, isAxis, pushDirect, pushRelease, releaseMultiplierFor,
    inStunAttributionCandidates, releaseStunSegments, agentName,
  } = env
  const { charResult, slot, agent } = cl

  for (const event of charResult.anomalyEventExecutions ?? []) {
    if (event.count <= 0) continue
    if (event.eventType === 'release') {
      // 不变量：**有 cfg 必有面板**（`buildCharConfig` 里 `computePanel` 是它 return 的前置，
      // 见 helpers.ts:1674）⇒ 能走到这里（charResult 存在）的槽必然 panelAt 命中。
      // 故这里**不**做 `?? 兜底/continue`：命中失败 = 压缩数组/盖章契约被破坏，应**响亮失败**
      // 而不是静默少几行伤害（静默正是本类缺陷最难查之处，见 scripts/lib/compacted-slot-index.mjs）。
      const triggerPanel = panelAt(damagePanels, slot)!
      // 异放跟随载体招式（前台绑定，玩家捏轴可精确控制）：失衡内占比 = 载体块轴内单位 / 载体总数
      const carrierInAxisFraction = event.followCarrierInStun && event.carrierMoveId
        ? (() => {
            const inAxis = allocMap[`${slot}:${event.carrierMoveId}`]?.inAxisUnits ?? 0
            // 载体总次数：执行行 count → 模块显式 carrierTotalCount（事件次数与载体不成 1:1 时，
            // 如薇薇安落羽生花异放=落羽生花次数×命中异常占比，分母必须用落羽生花次数本身）
            // → 事件次数兜底（柏妮思灼热抛接法/格莉丝脉冲手雷只生成异放事件、无执行行，
            // 每次载体动作恰好触发一次异放）
            const total = charResult.executions.find(e => e.moveId === event.carrierMoveId)?.count
              ?? event.carrierTotalCount
              ?? Math.max(0, Math.floor(event.count))
            return total > 0 ? Math.max(0, Math.min(1, inAxis / total)) : 0
          })()
        : undefined
      if (event.element === 'dominant') {
        // 异放元素 = 目标当前异常状态。Boss 异常状态轴点时归因（v2.2，与极性紊乱同口径）：
        // 轴模式下事件次数按代表窗内均匀取样时刻查当时状态分摊——链上元素无手动
        // releaseShare 覆盖才启用，手动分配/非轴模式回落下方覆盖率权重路径。
        const totalRelease = Math.max(0, Math.floor(event.count))
        const bossRel = isAxis ? bossAnomalyState : null
        const relWindows = bossRel?.stateChainsPerWindow.length ?? 0
        const relAnySegment = !!bossRel && (bossRel.stateChainsPerWindow.some(c => c.length > 0) || bossRel.windOverlayPerWindow.some(c => c.length > 0))
        if (bossRel && relWindows > 0 && relAnySegment) {
          const relNs = event.eventId.split('_')[0] ?? 'release'
          const chainEls = [...new Set(
            bossRel.stateChainsPerWindow.flat().concat(bossRel.windOverlayPerWindow.flat()).map(s => s.element),
          )]
          const hasManualShare = chainEls.some(el => configStore.getMechanicSetting(`${relNs}.releaseShare:${el}`, -1) >= 0)
          if (!hasManualShare) {
            const D = bossRel.windowDuration && bossRel.windowDuration > 0 ? bossRel.windowDuration : computeWindowDuration()
            // 与极性紊乱同口径：总次数均分到各真实失衡窗，逐窗按该窗状态链取样
            const alloc = allocateAxisWindows(effectiveStunAxes, Math.round(stunPoolResult?.stunCount ?? 0))
            const rIdx = bossRel.windowEntryIdx ?? bossRel.stateChainsPerWindow.map((_, i) => i)
            const rWeights = rIdx.map(ei => alloc[ei] ?? 0)
            const winShares = rWeights.some(w => w > 0)
              ? distributeIntegerByWeight(totalRelease, rWeights)
              : distributeIntegerByWeight(totalRelease, Array(relWindows).fill(1))
            const merged = new Map<string, number>()
            for (let w = 0; w < relWindows; w++) {
              const chain = [...(bossRel.stateChainsPerWindow[w] ?? []), ...(bossRel.windOverlayPerWindow[w] ?? [])]
              for (const p of attributeCountByStateChain(winShares[w] ?? 0, chain, D, agent?.damageElement ?? 'physical')) {
                merged.set(p.element, (merged.get(p.element) ?? 0) + p.count)
              }
            }
            const parts = [...merged.entries()].map(([element, count]) => ({ element, count })).sort((a, b) => b.count - a.count)
            const shares = distributeIntegerByWeight(totalRelease, parts.map(p => p.count))
            for (let i = 0; i < parts.length; i++) {
              const count = shares[i] ?? 0
              if (count <= 0) continue
              const element = parts[i].element
              const prog = anomalyPoolResult?.perElement.find(p => p.element === element)
              const baseSlot = prog ? getMainApplierSlot(prog.contributions) : slot
              for (const seg of releaseStunSegments(event, element, count, carrierInAxisFraction)) {
                pushRelease({
                  id: `release-${slot}-${event.eventId}-${element}${seg.suffix}`,
                  slot,
                  agentId: charResult.agentId,
                  name: event.eventName,
                  count: seg.count,
                  multiplier: releaseMultiplierFor(event, element, triggerPanel, seg.stunned < 0 ? stunCoverage : seg.stunned),
                  source: event.carrierMoveName || event.carrierMoveId || event.eventId,
                  note: `${event.note ?? ''}；${element}·Boss异常状态轴·按触发时刻状态归因${seg.tag ? `；${seg.tag}` : ''}`,
                  element,
                  panel: panelAt(damagePanels, baseSlot) ?? triggerPanel,
                  settlementPanel: triggerPanel,
                  releaseCrit: event.releaseCrit,
                  stunnedOverride: seg.stunned < 0 ? undefined : seg.stunned,
                })
              }
            }
            continue
          }
        }
        const axisCandidates = isAxis ? inStunAttributionCandidates() : []
        let attributionLabel = '失衡内活跃元素归因'
        let candidates = axisCandidates
        if (candidates.length === 0) {
          attributionLabel = '异常覆盖占比分配'
          const coverageRates = anomalyPoolResult?.coverage?.perElementCoverageRate ?? {}
          candidates = Object.entries(coverageRates)
            .filter(([, rate]) => rate > 0)
            .map(([element, rate]) => ({ element, autoRatio: rate }))
          if (candidates.length === 0) candidates = [{ element: agent?.damageElement ?? 'physical', autoRatio: 1 }]
        }
        const settingNs = event.eventId.split('_')[0] ?? 'release'
        const userWeights = candidates.map(({ element, autoRatio }) => ({
          element,
          weight: Math.max(0, configStore.getMechanicSetting(`${settingNs}.releaseShare:${element}`, autoRatio)),
        }))
        const totalWeight = userWeights.reduce((sum, item) => sum + item.weight, 0)
        const effectiveWeights = totalWeight > 0
          ? userWeights
          : candidates.map(({ element, autoRatio }) => ({ element, weight: autoRatio }))
        const effectiveTotal = effectiveWeights.reduce((sum, item) => sum + item.weight, 0) || 1
        const counts = distributeIntegerByWeight(
          totalRelease,
          effectiveWeights.map(item => item.weight / effectiveTotal),
        )
        for (let i = 0; i < effectiveWeights.length; i++) {
          const count = counts[i] ?? 0
          if (count <= 0) continue
          const element = effectiveWeights[i].element
          const prog = anomalyPoolResult?.perElement.find(p => p.element === element)
          const baseSlot = prog ? getMainApplierSlot(prog.contributions) : slot
          for (const seg of releaseStunSegments(event, element, count, carrierInAxisFraction)) {
            pushRelease({
              id: `release-${slot}-${event.eventId}-${element}${seg.suffix}`,
              slot,
              agentId: charResult.agentId,
              name: event.eventName,
              count: seg.count,
              multiplier: releaseMultiplierFor(event, element, triggerPanel, seg.stunned < 0 ? stunCoverage : seg.stunned),
              source: event.carrierMoveName || event.carrierMoveId || event.eventId,
              note: `${event.note ?? ''}；${element}·${attributionLabel}${seg.tag ? `；${seg.tag}` : ''}`,
              element,
              panel: panelAt(damagePanels, baseSlot) ?? triggerPanel,
              settlementPanel: triggerPanel,
              releaseCrit: event.releaseCrit,
              stunnedOverride: seg.stunned < 0 ? undefined : seg.stunned,
            })
          }
        }
        continue
      }
      const fixElement = event.element ?? 'wind'
      for (const seg of releaseStunSegments(event, fixElement, event.count, carrierInAxisFraction)) {
        if (seg.count <= 0) continue
        pushRelease({
          id: `release-${slot}-${event.eventId}${seg.suffix}`,
          slot: slot,
          agentId: charResult.agentId,
          name: event.eventName,
          count: seg.count,
          multiplier: releaseMultiplierFor(event, fixElement, triggerPanel, seg.stunned < 0 ? stunCoverage : seg.stunned),
          source: event.carrierMoveName || event.carrierMoveId || event.eventId,
          note: `${event.note ?? ''}${seg.tag ? `；${seg.tag}` : ''}`,
          element: fixElement,
          settlementPanel: triggerPanel,
          releaseCrit: event.releaseCrit,
          stunnedOverride: seg.stunned < 0 ? undefined : seg.stunned,
        })
      }
    } else if (event.eventType === 'polar_disorder') {
      // 极性紊乱 = 原本[紊乱]效果的25%伤害（池收敛后取紊乱均伤），不清除目标异常状态；
      // C2 门控在模块侧。归因（用户口径 2026-08-24「看当前时间点是什么属性异常状态」）：
      // 轴模式 dominant 走 Boss 异常状态轴——事件次数按代表窗内均匀取样时刻查当时状态链
      // 分摊到元素（标准链优先、风化覆盖层补空档）；无状态轴数据时 dominant 回落覆盖率最高者。
      const dd = anomalyPoolResult?.disorderDamage
      const polarRatio = event.polarDisorderRatio ?? 0.25
      const perEvent = (dd?.avgDamage ?? 0) * polarRatio
      const boss = isAxis ? bossAnomalyState : null
      const bossWindows = boss?.stateChainsPerWindow.length ?? 0
      const anySegment = !!boss && (boss.stateChainsPerWindow.some(c => c.length > 0) || boss.windOverlayPerWindow.some(c => c.length > 0))
      let parts: Array<{ element: string; count: number }> = []
      if (perEvent > 0 && event.count > 0 && event.element === 'dominant' && boss && bossWindows > 0 && anySegment) {
        const D = boss.windowDuration && boss.windowDuration > 0 ? boss.windowDuration : computeWindowDuration()
        // 事件总次数均分到各真实失衡窗，逐窗按该窗状态链取样归因（展开后每窗链可能不同）
        // 事件总次数按各条目的失衡数加权分配到代表窗，逐窗按状态链取样归因
        const alloc = allocateAxisWindows(effectiveStunAxes, Math.round(stunPoolResult?.stunCount ?? 0))
        const wIdx = boss.windowEntryIdx ?? boss.stateChainsPerWindow.map((_, i) => i)
        const weights = wIdx.map(ei => alloc[ei] ?? 0)
        const winShares = weights.some(w => w > 0)
          ? distributeIntegerByWeight(Math.max(0, Math.floor(event.count)), weights)
          : distributeIntegerByWeight(Math.max(0, Math.floor(event.count)), Array(bossWindows).fill(1))
        const merged = new Map<string, number>()
        for (let w = 0; w < bossWindows; w++) {
          const chain = [...(boss.stateChainsPerWindow[w] ?? []), ...(boss.windOverlayPerWindow[w] ?? [])]
          for (const p of attributeCountByStateChain(winShares[w] ?? 0, chain, D, agent?.damageElement ?? 'ether')) {
            merged.set(p.element, (merged.get(p.element) ?? 0) + p.count)
          }
        }
        parts = [...merged.entries()].map(([element, count]) => ({ element, count })).sort((a, b) => b.count - a.count)
        const shares = distributeIntegerByWeight(Math.max(0, Math.floor(event.count)), parts.map(p => p.count))
        for (let i = 0; i < parts.length; i++) {
          const shareCount = shares[i] ?? 0
          if (shareCount <= 0) continue
          // 极性基数用「现在的基础值」（用户口径）：当前状态元素的紊乱明细均摊；
          // 池无该元素明细时回落全池均摊
          const el = parts[i].element
          const elDetails = (dd?.details ?? []).filter(d => getBaseElement(d.element) === getBaseElement(el))
          const elEvents = elDetails.reduce((s, d) => s + (d.events ?? 0), 0)
          const elDamage = elDetails.reduce((s, d) => s + (d.damage ?? 0), 0)
          const perEventEl = elEvents > 0 ? (elDamage / elEvents) * polarRatio : perEvent
          if (perEventEl <= 0) continue
          rows.push({
            id: `polar-${slot}-${event.eventId}-${el}`,
            slot,
            agentId: charResult.agentId,
            agentName: agentName(charResult.agentId, slot),
            type: '极性紊乱',
            name: event.eventName,
            element: safeElement(el),
            source: event.carrierMoveName || event.carrierMoveId || event.eventId,
            count: shareCount,
            perDamage: perEventEl,
            totalDamage: perEventEl * shareCount,
            note: `${event.note ?? ''}；${el}·Boss异常状态轴·按触发时刻状态归因·基数=该元素紊乱均摊`,
          })
        }
        continue
      }
      let polarElement = event.element
      if (polarElement === 'dominant') {
        const axisBest = [...(isAxis ? inStunAttributionCandidates() : [])]
          .sort((a, b) => b.autoRatio - a.autoRatio)[0]?.element
        if (axisBest) polarElement = axisBest
        else {
          const rates = anomalyPoolResult?.coverage?.perElementCoverageRate ?? {}
          polarElement = Object.entries(rates).filter(([, r]) => r > 0).sort((a, b) => b[1] - a[1])[0]?.[0]
            ?? agent?.damageElement ?? 'ether'
        }
      }
      if (perEvent > 0 && event.count > 0) {
        rows.push({
          id: `polar-${slot}-${event.eventId}`,
          slot,
          agentId: charResult.agentId,
          agentName: agentName(charResult.agentId, slot),
          type: '极性紊乱',
          name: event.eventName,
          element: safeElement(polarElement),
          source: event.carrierMoveName || event.carrierMoveId || event.eventId,
          count: event.count,
          perDamage: perEvent,
          totalDamage: perEvent * event.count,
          note: event.note ?? '',
        })
      }
    } else if (event.eventType === 'direct_damage') {
      // 直伤事件（如薇薇安预言 DoT、加农转子额外伤害）：倍率 = 攻击力 × damageMultiplier%。
      // 缺 damageMultiplier 的事件（spec 事件走专用结算块）跳过，避免双计。
      const mult = event.damageMultiplier ?? 0
      if (mult > 0 && event.count > 0) {
        pushDirect({
          id: `direct-damage-${slot}-${event.eventId}`,
          slot,
          agentId: charResult.agentId,
          name: event.eventName,
          element: event.element ?? agent?.damageElement ?? 'physical',
          source: event.carrierMoveName || event.carrierMoveId || event.eventId,
          count: event.count,
          multiplier: mult,
          note: event.note ?? event.formula ?? '',
        })
      }
    }
  }

}
