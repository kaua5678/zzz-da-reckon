/**
 * 逐角色主循环·段 X「角色专属附加块」—— 自 `composables/resourceCalc/damagePool.ts#buildDamagePoolRows`
 * 的 :928–1131 原样外提（CC-9b，2026-09-25，零行为搬迁）。
 *
 * 职责：1171 柏妮思机制行（余烬 / 搅拌式 / 灼热抛接法 / C6 特殊余烬）/ 琉音额外能力 / 半月 C6
 * 碎击附伤 / 琉音非轴强特拆分 / 琉音影画6 余音。
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
import { getSkillLevelCoef } from '@/core/skillLevel'
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

  const burniceSrc = charResult.burniceMechanicSource
  // 2026-09-15 编排层棘轮：去掉 `charResult.agentId === '1171'`——`burniceMechanicSource`
  // 的唯一写入方 = `burnice.ts:312` 的 buildResourceResult ⇒ 字段存在即蕴含是该角色（判据同 T6）。
  if (burniceSrc) {
    const burniceSkillCoef = (() => {
      const bonus = panelAt(damagePanels, slot)?.skillLevelBonus ?? 0
      return bonus > 0 ? getSkillLevelCoef(bonus).damageCoef : 1
    })()
    if (burniceSrc.emberTotalTriggerCount > 0 && burniceSrc.emberDamageRatioWithMastery > 0) {
      pushDirect({
        id: 'burnice-ember',
        slot,
        agentId: charResult.agentId,
        name: '柏妮思余烬（含搅拌式附带）',
        element: 'fire',
        source: `普通余烬 ${burniceSrc.emberTriggerCount} 次 + 搅拌式附带 ${burniceSrc.stirringFreeEmberCount} 次`,
        count: burniceSrc.emberTotalTriggerCount,
        multiplier: burniceSrc.emberDamageRatioWithMastery,
        note: `${burniceSrc.emberDamageRatio}%攻击 × (1 + 精通加成)，基础积蓄60`,
        critRateBonus: burniceSrc.cinema4CritRateBonus,
        skillDamageTarget: 'assist',
      })
    }
    if (burniceSrc.stirringCount > 0 && burniceSrc.stirringDamageRatio > 0) {
      pushDirect({
        id: 'burnice-stirring',
        slot,
        agentId: charResult.agentId,
        name: '柏妮思搅拌式',
        element: 'fire',
        source: '溢出燃点消耗20点/次 · 支援攻击',
        count: burniceSrc.stirringCount,
        multiplier: burniceSrc.stirringDamageRatio * burniceSkillCoef,
        note: `Mixed Flame Blend #1 × 0.5 + #2，分类为支援攻击${burniceSkillCoef !== 1 ? ` · 技能等级系数×${burniceSkillCoef.toFixed(4)}` : ''}`,
        critRateBonus: burniceSrc.cinema4CritRateBonus,
        skillDamageTarget: 'assist',
      })
    }
    if (burniceSrc.tossingCount > 0 && burniceSrc.tossingDamageRatio > 0) {
      pushDirect({
        id: 'burnice-tossing',
        slot,
        agentId: charResult.agentId,
        name: '柏妮思灼热抛接法',
        element: 'fire',
        source: '消耗1点流火 · EX Special Attack: Intense Heat Tossing Method',
        count: burniceSrc.tossingCount,
        multiplier: burniceSrc.tossingDamageRatio * burniceSkillCoef,
        note: `强化特殊技，可吃4命暴击率+30%${burniceSkillCoef !== 1 ? ` · 技能等级系数×${burniceSkillCoef.toFixed(4)}` : ''}`,
        critRateBonus: burniceSrc.cinema4CritRateBonus,
        skillDamageTarget: 'exSpecial',
      })
    }
    if (burniceSrc.cinema6SpecialEmberCount > 0 && burniceSrc.cinema6SpecialEmberDamageRatio > 0) {
      pushDirect({
        id: 'burnice-c6-special-ember',
        slot,
        agentId: charResult.agentId,
        name: '柏妮思6命特殊余烬',
        element: 'fire',
        source: '双份命中触发 · 0.5s最多一次 · 不消耗燃点',
        count: burniceSrc.cinema6SpecialEmberCount,
        multiplier: burniceSrc.cinema6SpecialEmberDamageRatio,
        note: `固定${burniceSrc.cinema6SpecialEmberBaseRatio}%攻击，不吃1命/精通加成，无视火抗${burniceSrc.cinema6FireResIgnore}%`,
        critRateBonus: burniceSrc.cinema4CritRateBonus,
        resIgnore: burniceSrc.cinema6FireResIgnore,
        moveId: 'burnice-c6-special-ember',
        stunOverride: axisStunFor('burnice-c6-special-ember'),
        skillDamageTarget: 'assist',
      })
    }
  }

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
  // 般岳影画6：600% 贯穿力火伤附伤是倾山的自动触发事件，次数 = 倾山次数（不可调，不产生资源利用率行）
  // 2026-09-16 编排层棘轮（R15-a）：原判据 `charResult.agentId === '1471' && cinemaLevel >= 6` +
  // 自己去找 `1471009` 行 —— 已改为读**倾山行上的模块标记** `banyueC6CrushAttach`（= 附伤倍率）。
  // 标记的唯一写入方 = `banyue.ts#patchBanyueExecutions`（仅 C6 写自己的倾山行）⇒ 字段存在即蕴含
  // 「是般岳且 C6」（判据同 T6，与本文件 :867 burniceMechanicSource / :941 liuyinMechanicSource 同族）。
  // ⚠ 刻意**不**改成读 `banyueRageCycle.rageCount`：那份是**截断前**的循环次数，而本处口径是
  // 截断后的倾山行 count（原 `executions.find(...)` 读的就是同一行）——换源 = 静默改语义。
  const crushAttachExec = charResult.executions.find(e => (e as any).banyueC6CrushAttach !== undefined)
  if (crushAttachExec) {
    const attachCount = Math.max(0, Math.floor(crushAttachExec.count))
    const attachRatio = Number((crushAttachExec as any).banyueC6CrushAttach)
    if (attachCount > 0 && attachRatio > 0) {
      // 不变量同 :609 —— 有 cfg 必有面板，缺失即契约破坏，响亮失败。
      const panel = panelAt(damagePanels, slot)!
      pushDirect({
        id: 'banyue-c6-crush-attach',
        slot,
        agentId: charResult.agentId,
        name: '影画6·摧岳附伤（倾山自动触发）',
        element: 'fire',
        source: '倾山自动触发',
        count: attachCount,
        multiplier: attachRatio,
        note: `影画6：倾山命中时对周身造成 600% 贯穿力火伤；次数=倾山次数 ×${attachCount}（自动，不可调）`,
        basisValueOverride: calcPenetrationPower(panel),
        basisLabelOverride: '贯穿力（600%附伤）',
        moveId: 'banyue_c6_crush_attach',
        stunOverride: axisStunFor('banyue_c6_crush_attach'),
      })
    }
  }

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
