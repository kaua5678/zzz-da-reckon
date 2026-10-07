/**
 * 装配后「赠送连携」编排簇（CC-35d-A 2026-09-27 由 `normaHatChain.ts#applyNormaHatChain` 通用化）。
 *
 * 提供者 = 首个实现模块能力 `chainGift` 的在队槽位（现唯一实现：诺姆「膛温换连携」——帽子把戏触发
 * 上一位角色的快速支援→替换为该队友本人的连携技）。本文件不认角色：次数 / 招式名后缀 / 说明文案都由能力返回。
 * 引擎侧时间预留走 crossAgentSupply 的 `gift-chain:chain` 通道（core/resource/helpers.ts 的 chainGift*），两者须同源。
 */
import { findChainAttack } from '@/core/resource/moveLookup'
import { fusedRowReader, findMoveById, fusedRowValue, getRowValue } from '@/data/moveTableQueries'
import { supplyTargetTeamSlot } from '@/core/resource/crossAgentSupply'
import type { CharacterOperationConfig, TeamResourceResult } from '@/types/resource'
import type { ConfigModel } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { getAgentMechanic } from '@/mechanics'
import { buildGiftRow } from '@/core/resource/giftRows'

/**
 * 赠送连携：提供者给落点队友赠送 N 次其本人连携技，连携归属该队友。落点 = `supplyTargetTeamSlot`（与引擎时间预留
 * 同一函数、同一份 cfg；`configs` = `resourceConfig.characters`，CC-294）。
 * 诺姆 C4 的 +200 不可分享喧响不在这里（资源池 calcDecibelSource 已计入）。
 */
export function applyChainGift(
  base: TeamResourceResult,
  configStore: ConfigModel,
  catalogStore: ReturnType<typeof useCatalogStore>,
  configs: readonly CharacterOperationConfig[],
): TeamResourceResult {
  // CC-422：`base` 恒非 null（唯一调用点 convergence 传 applyUltimatePromote 的结果），返回也恒非 null。
  // 提供者槽位 = 首个实现 `chainGift` 的在队模块（CC-35d-A；原按身份 findSlotByIdentity(['1571'])，
  // 本库 teammateBuffId 均等于自身 id，按 agentId 派发与之等价）
  const providerSlot = configStore.team.findIndex(m => !!m.agentId && !!getAgentMechanic(m.agentId)?.chainGift)
  if (providerSlot < 0) return base
  const providerResult = base.characters.find(c => c.slot === providerSlot)
  const gift = providerResult ? getAgentMechanic(configStore.team[providerSlot].agentId)?.chainGift?.(providerResult) ?? null : null
  if (!gift) return base
  const hatCount = Math.max(0, Math.floor(gift.count))
  // 引擎占位行（阶段1 ②）以**池口径**为准：hatCount = 0 时撤掉占位行（同 applyUltimatePromote）
  if (hatCount <= 0) {
    if (!base.characters.some(c => c.executions.some(e => e.chainGift))) return base
    return {
      ...base,
      characters: base.characters.map(c => ({
        ...c,
        executions: c.executions.filter(e => !e.chainGift),
      })),
    }
  }

  // 落点与引擎预留同源（CC-294）：提供者模块的 crossAgentSupply.targetSlot 作用在提供者自己的 cfg 上
  const providerCfg = configs.find(c => c.slot === providerSlot)
  if (!providerCfg) return base
  const targetSlot = supplyTargetTeamSlot(providerCfg, configs.map(c => c.slot))
  // 帽子把戏替换的是「上一位队友的快速支援→该队友本人的连携技」（用户口径：赠送连携给上一位队友打，
  // 不是诺姆替打自己的 1571018）——连携招式 id/倍率/时长全部取目标队友技能表。
  // C4 喧响（诺姆+队友各 200×次数）已由模块 chainGift 声明的 decibelPerUnit 经
  // crossAgentSupply#giftDecibelForCfg 计入喧响收入（真实影响终结技次数），
  // applyChainGift 只做连携赠送，不再重复注入喧响。
  // 赠送连携行需自带倍率表值（applyChainGift 在 enrich 之后执行，不走 enrich 回填；
  // 缺倍率则伤害池按 damageMultiplier≤0 跳过、失衡池无 baseDaze——带上后伤害/失衡才进池）
  const targetAgentId = configStore.team[targetSlot]?.agentId ?? ''
  const targetSkills = catalogStore.agentSkillsByAgentMap.get(targetAgentId)
  const chainInfo = targetSkills ? findChainAttack(targetSkills, fusedRowReader) : null
  if (!chainInfo) return base
  const giftedMove = findMoveById(targetSkills, chainInfo.moveId)
  // 赠送的是「一次完整连携」：多段招式（登记融合组，如雅 春临 #1~#3）必须取整段倍率，
  // 否则赠送行只算了第一段（377.6% vs 1258.3%）——与倍率侧同一口径（用户 2026-09-11）。
  const fusedOf = (rowId: string) =>
    fusedRowValue(targetSkills, chainInfo.moveId, rowId)
    ?? getRowValue(giftedMove, rowId) // CC-239：单段回落也吃逻辑编辑器行规则（与 fusedRowValue 分段取值、helpers 主执行同源）
  const giftedDamage = fusedOf('damage')
  const giftedDaze = fusedOf('daze')
  const giftedAnomaly = fusedOf('anomaly_buildup')

  return {
    ...base,
    characters: base.characters.map(char => {
      if (char.slot !== targetSlot) return char
      // 上一位队友：连携次数 +hatCount、执行计划补其本人连携技执行（C4 喧响在资源池）
      //
      // 阶段1 ②（2026-09-10）：**行由引擎物化**（存在/行序），本函数补倍率 + 连携计数，并把
      // 计数/时长**以池为准**写回；找不到行时兜底追加。
      // CC-336：按 `e.chainGift` 精确定位诺姆赠链占位行（避免同槽存在琉音 `source === 'gift'` 赠大行时误覆写），
      // 统一经 `buildGiftRow` 构造行字段，消除补丁与兜底追加两套 13 字段重复。
      const giftIdx = char.executions.findIndex(e => Boolean(e.chainGift))
      const giftRow = buildGiftRow({
        moveId: chainInfo.moveId,
        moveName: `${giftedMove?.name?.zhCN || '连携技'}（${gift.label}）`,
        count: hatCount,
        actionTime: chainInfo.actionTime,
        comboAlignRatio: chainInfo.comboAlignRatio,
        decibelRecovery: chainInfo.decibelRecovery,
        damageMultiplier: giftedDamage,
        dazeMultiplier: giftedDaze,
        anomalyBuildUp: giftedAnomaly,
        skillTableNote: gift.note,
        chainGift: true,
      })
      const executions = giftIdx >= 0
        ? char.executions.map((e, i) => (i === giftIdx ? { ...e, ...giftRow } : e))
        : [...char.executions, giftRow]
      return {
        ...char,
        chainCountTotal: char.chainCountTotal + hatCount,
        executions,
      }
    }),
  }
}
