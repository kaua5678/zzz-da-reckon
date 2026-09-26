/**
 * 逐角色主循环·段 X「角色专属附加块」—— 自 `composables/resourceCalc/damagePool.ts#buildDamagePoolRows`
 * 的 :928–1131 原样外提（CC-9b，2026-09-25，零行为搬迁）。
 *
 * 职责：琉音额外能力 / 琉音非轴强特拆分 / 琉音影画6 余音；以及按角色模块能力
 * `extraDirectRows` 派发本槽的附加直伤行（CC-18a 2026-09-26：1171 柏妮思机制行
 * （余烬 / 搅拌式 / 灼热抛接法 / C6 特殊余烬）与 1471 半月 C6 碎击附伤已迁进各自模块，
 * 设计稿 `docs/mcp-cc18-extra-direct-rows.md`）。
 *
 * 与外层闭包的通信面 = `CharRowsEnv`（定义在 `./damagePoolDirect`）：共享输出数组 `rows`
 * （经 `pushDirect` 闭包按原顺序 push，禁止换成返回值拼接）+ `ctx` 快照 + 只读局部量/闭包。
 * 函数**不** import `./damagePool`（只 `import type` `DamagePoolContext`，运行时无环），
 * 也不写任何外层可变量。
 *
 * 依赖方向：本文件不得 import `./damagePool`（值）；只依赖类型与引擎子模块（`@/core/*`、
 * `@/mechanics` 等）。
 */
import { calcPenetrationPower } from '@/core/damage'
import { panelAt } from '@/core/panel'
import { getAgentMechanic } from '@/mechanics'
import { LIUYIN_EX_MOVE_IDS, CINEMA6_ECHO_MAX, CINEMA6_ECHO_RATIO } from '@/mechanics/agents/liuyin'
import type { CharRowsEnv, CharLocals } from './damagePoolDirect'

/**
 * 段 X「角色专属附加块」（零行为搬迁，CC-9b）。
 * 函数体 = 原 `buildDamagePoolRows` :928–1131 逐字保留（仅去 4 空格公共缩进），
 * 只在头部解构 `env.ctx` / `env` / `cl`；其余表达式一字不改。
 */
export function emitCharExtraRows(env: CharRowsEnv, cl: CharLocals): void {
  const {
    configStore, catalogStore,
    damagePanels, stunPoolResult, liuyinPromoteCount,
  } = env.ctx
  const {
    isAxis, axisStunFor, pushDirect, ultimateInAxisFraction,
  } = env
  const { charResult, slot, liuyinSrc } = cl

  // 角色专属附加直伤行（规则 6 迁移落点，CC-18a 2026-09-26，设计稿
  // `docs/mcp-cc18-extra-direct-rows.md` §2-3）：柏妮思块 1 / 半月块 3 已迁进各自模块的
  // `extraDirectRows`，消费端在原块 1 的位置放**一次**调用，按返回顺序 `pushDirect`。
  // 顺序论证见设计稿 §2-3/§3：各块按角色互斥，迁走后对任意角色其自身行的相对顺序与 `rows`
  // 的全局顺序都不变。
  const extra = getAgentMechanic(charResult.agentId)?.extraDirectRows?.({ charResult, slot, panel: panelAt(damagePanels, slot), isAxis, axisStunFor })
  if (extra) for (const row of extra) pushDirect(row)

  // 琉音专属直伤（额外能力）：石头/剪刀/布重击命中时，按上一位队友特性追加伤害。
  // 2026-09-15 编排层棘轮：去掉 `charResult.agentId === '1481'`——`liuyinMechanicSource` 的
  // 唯一写入方 = `liuyin.ts:387` ⇒ 字段存在即蕴含是该角色（判据同 T6）。
  // 2026-09-17 round 21 夜 A：`liuyinSrc` 的声明**上提到槽位循环头**（`damagePool.ts` 的
  // `for (const charResult of …)` 之后）——本块与「跳过通用强特行」那处共用同一个判据，
  // 两处各读一次会掩盖「它们必须同源」这条不变量（见上提处的 ①②③ 论证）。
  if (liuyinSrc && liuyinSrc.extraAbilityActive && liuyinSrc.exHeavyCount > 0) {
    const prevSlot = liuyinSrc.previousTeammateSlot
    const prevPanel = panelAt(damagePanels, prevSlot)
    const prevAgent = prevSlot >= 0 ? (configStore.team[prevSlot]?.agentId ? catalogStore.agentsMap.get(configStore.team[prevSlot].agentId) : null) : null
    const isRupture = prevAgent?.specialty === 'rupture'
    // 贯穿力走引擎单一事实源 `calcPenetrationPower`（= atk×0.3 + hp×0.1 + sheerForceFlat）。
    // CC-D1 2026-09-25 修：原内联式**漏了 `sheerForceFlat`** ⇒ 潘引壶(1421)[通窍]
    // 等「贯穿力提升」拐对该行完全无效（实测：面板 sheerForceFlat 176→0，本行伤害
    // delta = 0；而同文件般岳 C6 附伤用的 `calcPenetrationPower` 是含的 ⇒ 同量两套写法）。
    const basisValue = prevPanel ? (isRupture ? calcPenetrationPower(prevPanel) : prevPanel.atk) : 0
    const ratio = isRupture ? 400 : 320
    const basisLabel = isRupture ? '上一位队友贯穿力' : '上一位队友攻击力'
    if (basisValue > 0) {
      pushDirect({
        id: `liuyin-ex-direct-${prevSlot}`,
        slot,
        agentId: charResult.agentId,
        name: '琉音额外能力·重击附加伤害',
        element: 'physical',
        source: `上一位队友（${prevAgent?.name?.zhCN ?? `槽${prevSlot + 1}`}）${isRupture ? '贯穿力' : '攻击力'} × ${ratio}%`,
        count: liuyinSrc.exHeavyCount,
        multiplier: ratio,
        note: `额外能力专属直伤：${isRupture ? '命破队友 400% 贯穿力' : '强攻队友 320% 攻击力'}`,
        skillDamageTarget: 'exSpecial',
        basisValueOverride: basisValue,
        basisLabelOverride: basisLabel,
      })
    }
  }

  // 琉音三个强特（石头→剪刀→布）按“失衡次数×25 能量留给失衡内第一个强特，剩余非失衡按 1→3 连打”拆分易伤。
  // 非失衡轴模式下通用强特行已跳过，这里重放并拆失衡/非失衡；失衡轴模式仍走轴内易伤归属。
  // 2026-09-15 编排层棘轮：去掉 agentId 判断（`liuyinMechanicSource` 唯一写入方 = liuyin.ts:387）。
  if (liuyinSrc && !isAxis) {
    const stunCount = stunPoolResult?.stunCount ?? 0
    const exTotal = Math.max(0, Math.floor(liuyinSrc.exHeavyCount))
    const exMult = new Map<string, number>()
    for (const e of charResult.executions) {
      if (LIUYIN_EX_MOVE_IDS.has(e.moveId) && (e.damageMultiplier ?? 0) > 0) exMult.set(e.moveId, e.damageMultiplier!)
    }
    const mult = (id: string) => exMult.get(id) ?? 0
    const inStunCount = Math.min(stunCount, exTotal)
    const nonStunCount = Math.max(0, exTotal - inStunCount)
    // 非失衡按 1(石头)→2(剪刀)→3(布) 顺序连打
    const nsRock = Math.floor((nonStunCount + 2) / 3)
    const nsScissors = Math.floor((nonStunCount + 1) / 3)
    const nsPaper = Math.floor(nonStunCount / 3)
    const pushLiuyinEx = (moveId: string, name: string, count: number, stunOverride: number, tag: string) => {
      if (count <= 0 || mult(moveId) <= 0) return
      pushDirect({
        id: `liuyin-ex-${moveId}-${tag}`,
        slot,
        agentId: charResult.agentId,
        name,
        element: 'physical',
        source: tag === 'stun' ? '失衡内首个强特' : '非失衡 1→3 连打',
        count,
        multiplier: mult(moveId),
        note: tag === 'stun' ? '失衡内释放，吃满失衡易伤' : '非失衡释放，无易伤',
        skillDamageTarget: 'exSpecial',
        stunOverride,
      })
    }
    pushLiuyinEx('1481011', '强化特殊技：石头', inStunCount, 1, 'stun')
    pushLiuyinEx('1481011', '强化特殊技：石头', nsRock, 0, 'nonstun')
    pushLiuyinEx('1481012', '强化特殊技：剪刀', nsScissors, 0, 'nonstun')
    pushLiuyinEx('1481013', '强化特殊技：布！', nsPaper, 0, 'nonstun')
  }

  // 琉音影画6·余音：独立直伤，轴模式同样生效（非失衡轴模式下与强特拆分无关，不能包在 !isAxis 内）
  // 2026-09-15 编排层棘轮：同上（字段即角色标识）。
  if (liuyinSrc && liuyinSrc.cinemaLevel >= 6) {
    const promoteCount = liuyinPromoteCount
    const c6EchoMax = Math.max(0, Math.floor(configStore.getMechanicSetting('liuyin.c6EchoMax', CINEMA6_ECHO_MAX)))
    if (promoteCount > 0 && c6EchoMax > 0) {
      const echoCount = promoteCount * c6EchoMax
      pushDirect({
        id: 'liuyin-c6-echo',
        slot,
        agentId: charResult.agentId,
        name: '琉音影画6·余音',
        element: 'physical',
        source: `转大 ${promoteCount} 次 × ${c6EchoMax} 次 × 480%`,
        count: echoCount,
        multiplier: CINEMA6_ECHO_RATIO,
        // 附伤随「队友以终结技入场」的转大触发 → 轴内易伤跟随全队终极技轴内占比（用户口径 2026-08：
        // 6命附伤事件和动作绑定，理应该伴随计数并且吃易伤）；非轴回落全局覆盖率
        stunOverride: isAxis ? ultimateInAxisFraction() : undefined,
        note: `影画6余音：队友经核心被动以终结技入场后，其攻击命中时琉音追加 480% 攻击力物理伤害（视为强特）；每转大最多 ${c6EchoMax} 次（可在资源利用率页调整）。`,
        skillDamageTarget: 'exSpecial',
      })
    }
  }
}
