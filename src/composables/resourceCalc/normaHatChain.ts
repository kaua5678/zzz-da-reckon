/**
 * 诺姆「膛温换连携」编排簇（从 useResourceCalc 抽离，纯函数化）。
 *
 * 帽子把戏触发上一位角色的快速支援→替换为连携技，连携归属上一位队友。
 * C4 时诺姆和对应代理人（上一位队友）各 +200 不可分享喧响（unshareableBonus，无伴随获取）。
 */
import { findChainAttack } from '@/core/resource'
import { resolveUltimateTargetSlot } from '@/mechanics/agents/liuyin'
import type { TeamResourceResult } from '@/types/resource'
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { findMoveById } from './helpers'

/**
 * 诺姆膛温换连携：帽子把戏触发上一位角色的快速支援→替换为连携技，连携归属上一位队友。
 * C4 时诺姆和对应代理人（上一位队友）各 +200 不可分享喧响（unshareableBonus，无伴随获取）。
 */
export function applyNormaHatChain(
  base: TeamResourceResult | null,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): TeamResourceResult | null {
  if (!base) return null
  const normaIdx = configStore.team.findIndex(char => {
    const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return a?.id === '1571' || a?.teammateBuffId === '1571'
  })
  if (normaIdx < 0) return base
  const normaResult = base.characters.find(c => c.slot === normaIdx)
  const normaSrc = normaResult?.normaMechanicSource
  if (!normaSrc) return base
  const hatCount = Math.max(0, Math.floor(normaSrc.hatToChainCount))
  if (hatCount <= 0) return base

  // 上一位队友（环绕，排除自己）
  const targetSetting = configStore.getMechanicSetting('liuyin.ultimateTargetSlot', -1)
  const targetSlot = resolveUltimateTargetSlot(normaIdx, configStore.team.length, targetSetting)
  // 帽子把戏替换的是「上一位队友的快速支援→该队友本人的连携技」（用户口径：赠送连携给上一位队友打，
  // 不是诺姆替打自己的 1571018）——连携招式 id/倍率/时长全部取目标队友技能表。
  // C4 喧响（诺姆+队友各 200×次数）已由资源池 calcDecibelSource 计入（buildResourceResult 回写
  // cfg.normaHatToChainCount → 下一轮迭代注入 extraUnshareableDecibel，真实影响终结技次数），
  // applyNormaHatChain 只做连携赠送，不再重复注入喧响。
  // 赠送连携行需自带倍率表值（applyNormaHatChain 在 enrich 之后执行，不走 enrich 回填；
  // 缺倍率则伤害池按 damageMultiplier≤0 跳过、失衡池无 baseDaze——带上后伤害/失衡才进池）
  const targetAgentId = configStore.team[targetSlot]?.agentId ?? ''
  const targetSkills = catalogStore.getAgentSkills(targetAgentId)
  const chainInfo = targetSkills ? findChainAttack(targetSkills) : null
  if (!chainInfo) return base
  const giftedMove = findMoveById(targetSkills, chainInfo.moveId)
  const giftedDamage = giftedMove?.rows?.find(r => r.id === 'damage')?.values?.[0] ?? 0
  const giftedDaze = giftedMove?.rows?.find(r => r.id === 'daze')?.values?.[0] ?? 0
  const giftedAnomaly = giftedMove?.rows?.find(r => r.id === 'anomaly_buildup')?.values?.[0] ?? 0

  return {
    ...base,
    characters: base.characters.map(char => {
      if (char.slot !== targetSlot) return char
      // 上一位队友：连携次数 +hatCount、执行计划补其本人连携技执行（C4 喧响在资源池）
      return {
        ...char,
        chainCountTotal: (char.chainCountTotal ?? 0) + hatCount,
        executions: [...(char.executions ?? []), {
          moveId: chainInfo.moveId,
          moveName: `${giftedMove?.name?.zhCN || '连携技'}（诺姆膛温替换）`,
          category: 'chain',
          count: hatCount,
          actionTime: chainInfo.actionTime,
          comboAlignRatio: chainInfo.comboAlignRatio,
          totalTime: hatCount * chainInfo.actionTime,
          totalComboAlignTime: hatCount * chainInfo.actionTime * chainInfo.comboAlignRatio,
          energyConsume: 0,
          totalEnergyConsume: 0,
          decibelRecovery: chainInfo.decibelRecovery,
          totalDecibelRecovery: chainInfo.decibelRecovery * hatCount,
          energyRecovery: 0,
          totalEnergyRecovery: 0,
          damageMultiplier: giftedDamage,
          damageMultiplierOverride: giftedDamage > 0,
          dazeMultiplier: giftedDaze,
          dazeMultiplierOverride: giftedDaze > 0,
          anomalyBuildUp: giftedAnomaly,
          source: 'gift',
          skillTableNote: '诺姆预热膛温≥80%帽子把戏：上一位队友的快速支援替换为其本人连携技（招式与倍率取该队友技能表）',
          normaGiftChain: true,
        }],
      }
    }),
  }
}
