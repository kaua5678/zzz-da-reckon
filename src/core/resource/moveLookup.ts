/**
 * 招式表查询（`find*` 族 + 融合组「一次动作」整段量）—— 自 `core/resource.ts` 迁出（CC-1，2026-09-24）。
 *
 * 职责：只读 `agentSkills`（catalog 招式表）与 `data/moveFusions.ts` 的融合组登记，产出各通道
 * （强特/终结/连携/闪反/招架/支援突击/蕾米两段/平A回能）的 moveId、前台时长、喧响与成本信息；
 * **不参与资源循环**（循环在 `core/resource.ts#calcTeamResources`）。`core/resource.ts` 保留同名
 * re-export 壳，全仓调用方零改动。
 *
 * 依赖方向：本文件**不得** import `core/resource.ts`（防循环依赖）；只依赖类型与 `data/moveFusions`。
 */
import type { ExSpecialCostType } from '@/types/resource'
import { moveFusionByMoveId } from '@/data/moveFusions'

/** 从倍率表数据提取强特信息
 *  在 special category 中找 "EX Special Attack" 的 move
 *  energyCost 从 move.energyCost 字段提取（如 {"Energy Cost": "60"}）
 *  多数角色只取第一个耗能的强特即可；复杂消耗（如柏妮思多种耗能）后续单独修改
 *  2026-09 成本类型化：energyCost 键按语义分类（energy/resource/free）——
 *  替代资源键（如克拉蕾 "Sharpness Cost"（锐能））不再被解析成能量消耗
 */
export function findExSpecial(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string }; energyCost?: Record<string, string>; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; energyConsume: number; costType: ExSpecialCostType; costAmount: number; resourceId?: string; actionTime: number; decibelRecovery: number; energyCostRaw?: Record<string, string>; comboAlignRatio: number } | null {
  const special = agentSkills.categories.find(c => c.id === 'special')
  if (!special) return null

  // 找第一个有 energyCost 且非空的 EX Special
  const exMove = special.moves.find(m => {
    const name = m.name?.en?.toLowerCase() || ''
    return name.includes('ex special') && m.energyCost && Object.keys(m.energyCost).length > 0
  })
  // 如果没找到有 energyCost 的，退而找任意 EX Special
  const fallbackMove = exMove || special.moves.find(m =>
    (m.name?.en?.toLowerCase() || '').includes('ex special')
  )
  if (!fallbackMove) return null

  // 成本类型化：键名含 energy → 能量（含闪能）；否则 → 替代资源；无键 → 免费
  const energyCostRaw = fallbackMove.energyCost
  const keys = energyCostRaw ? Object.keys(energyCostRaw) : []
  const energyKey = keys.find(k => /energy/i.test(k))
  let costType: ExSpecialCostType = 'energy'
  let costAmount = 0
  let resourceId: string | undefined
  if (!energyCostRaw || keys.length === 0) {
    costType = 'free'
  } else if (energyKey) {
    // 优先取 "Energy Cost" 等激活键，其次取第一个可解析为数字的能量键
    const priorityKeys = ['Energy Cost', 'Activation Energy Cost', 'Energy Cost to Use']
    let parsed = 0
    for (const pk of priorityKeys) {
      if (energyCostRaw[pk]) {
        const num = parseFloat(energyCostRaw[pk])
        if (!isNaN(num)) { parsed = num; break }
      }
    }
    if (parsed === 0) {
      for (const k of [energyKey, ...keys]) {
        const num = parseFloat(energyCostRaw[k])
        if (!isNaN(num) && num > 0) { parsed = num; break }
      }
    }
    costAmount = parsed
    if (energyKey.toLowerCase().includes('flash')) resourceId = 'flash'
  } else {
    costType = 'resource'
    // 替代资源：取第一个可解析为数字的量（克拉蕾 Sharpness Cost 60 → 锐能 60）
    for (const k of keys) {
      const num = parseFloat(energyCostRaw[k])
      if (!isNaN(num) && num > 0) { costAmount = num; break }
    }
    resourceId = keys[0]?.toLowerCase().includes('sharpness') ? 'sharpness' : keys[0]
  }

  // 多段强特（登记融合组，如雅·飞雪斩击 = #1+#2）：时间与喧响按一次动作取整段；
  // **耗能不动**——nanoka 把耗能写在前缀项上，一次动作只计一次（坑 31）。
  const { actionTime: exActionTime, decibelRecovery: exDecibel } = channelMetricsOf(agentSkills, fallbackMove)

  return {
    moveId: fallbackMove.id,
    // 能量型照旧计费；替代资源/免费型不再冒充能量 60
    energyConsume: costType === 'energy' ? costAmount : 0,
    costType,
    costAmount,
    resourceId,
    actionTime: exActionTime,
    decibelRecovery: exDecibel,
    energyCostRaw,
    comboAlignRatio: fallbackMove.comboAlignRatio ?? 0,
  }
}

/** 从倍率表数据提取终结技信息
 *  在 chain category 中找 "Ultimate" 的 move（区别于 "Chain Attack"）
 *  注意：终结技消耗3000喧响释放，数据行本身无 decibel_recovery，故 decibelRecovery 恒为0
 */
export function findUltimate(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const chain = agentSkills.categories.find(c => c.id === 'chain')
  if (!chain) return null

  const ultMove = chain.moves.find(m => {
    const name = m.name?.en?.toLowerCase() || ''
    return name.includes('ultimate') && !name.includes('chain attack')
  })
  if (!ultMove) return null

  // 多段终结技（登记组，如妮可 特制以太榴弹 = 炮击 + 能量场）：倍率/喧响取整段，
  // 时间只取站场段（能量场是自动攻击）。
  const { actionTime: ultActionTime, decibelRecovery: ultDecibel } = channelMetricsOf(agentSkills, ultMove)

  return {
    moveId: ultMove.id,
    actionTime: ultActionTime,
    decibelRecovery: ultDecibel,
    comboAlignRatio: ultMove.comboAlignRatio ?? 0,
  }
}

/**
 * 融合组「一次动作」的整段量（前台时长 + 喧响）。moveId 登记了融合组
 * （`data/moveFusions.ts` 单一事实源）时：
 *   - actionTime = Σ (countsTime !== false 的段) actionTime × term.count——
 *     能力场/自动攻击段（妮可 1031303/1031305）打伤害但角色不站场，时间按 0 计；
 *   - decibelRecovery = Σ **全部**段 decibel_recovery × term.count（能量场照样回喧响）。
 * 未登记或组内缺段 → null（回头段原值，保守防半融合）。
 *
 * 为什么必须走登记组而不是「同 category 里的 #N 段全加」：catalog 的多段行既可能是
 * 一次动作的分段（星见雅春临 #1~#3），也可能是两个独立动作（叶瞬光 1431 连携两段
 * 3.3s/2.5s、喧响 218.9 已在全体基线内）——启发式求和会把后者顶成 5.8s 的假时长。
 *
 * 口径声明 `engine:fusedGroupMetrics/一次动作整段量` 随 re-export 壳留在 `core/resource.ts`，
 * 锚改指本函数（CC-1 搬迁）；声明在一处、锚在实现处是既有惯例（同 `data/exSpecialPlans.ts`
 * 声明 → 锚 `findExSpecial`）。
 */
export function fusedGroupMetrics(
  agentSkills: {
    categories: {
      moves: { id: string; actionTime?: number | null; rows?: { id: string; values: number[] }[] }[]
    }[]
  },
  moveId: string,
): { actionTime: number; decibelRecovery: number } | null {
  const group = moveFusionByMoveId.get(moveId)
  if (!group) return null
  const segments = new Map<string, { actionTime?: number | null; rows?: { id: string; values: number[] }[] }>()
  for (const cat of agentSkills.categories) {
    for (const m of cat.moves ?? []) segments.set(String(m.id), m)
  }
  let actionTime = 0
  let decibelRecovery = 0
  for (const term of group.terms) {
    const seg = segments.get(term.moveId)
    if (!seg) return null
    if (term.countsTime !== false) actionTime += (seg.actionTime ?? 0) * term.count
    const row = seg.rows?.find(r => r.id === 'decibel_recovery')
    decibelRecovery += (row?.values[0] || 0) * term.count
  }
  return { actionTime, decibelRecovery }
}

/** 只要时长的那一侧（能力场段按 0 计）——留给只需要 actionTime 的调用方。 */
export function fusedGroupActionTime(
  agentSkills: { categories: { moves: { id: string; actionTime?: number | null; rows?: { id: string; values: number[] }[] }[] }[] },
  moveId: string,
): number | null {
  return fusedGroupMetrics(agentSkills, moveId)?.actionTime ?? null
}

/**
 * 各族 `find*` 的统一出口：一条通道（强特/终结/连携/闪反/招架/支援突击…）取到的
 * 「一次动作」前台时长与喧响。登记了融合组 → 整段量；否则 → 本段量。
 * **时间不是「招式段」的单元，是「一次动作」的单元**——只回头段会把一次动作
 * 的其余段整段漏掉（坑 31：雅连携显示 0.515s，实际一次打三段 1.717s）。
 */
function channelMetricsOf(
  agentSkills: {
    categories: {
      moves: { id: string; actionTime?: number | null; rows?: { id: string; values: number[] }[] }[]
    }[]
  },
  move: { id: string; actionTime?: number | null; rows?: { id: string; values: number[] }[] },
): { actionTime: number; decibelRecovery: number } {
  const fused = fusedGroupMetrics(agentSkills, move.id)
  if (fused) return fused
  return {
    actionTime: move.actionTime ?? 0,
    decibelRecovery: move.rows?.find(r => r.id === 'decibel_recovery')?.values[0] || 0,
  }
}

/** 从倍率表数据提取连携技信息
 *  在 chain category 中找 "Chain Attack" 的 move（区别于 "Ultimate"）
 *  多段连携（登记融合组）取**一次动作**的整段量：倍率/喧响 Σ 全部段、时间 Σ 站场段。
 *  结果页同屏显示「1258.3% / 单次 0.515s」两套口径即为该错配（坑 31）。
 */
// 口径声明 `engine:findChainAttack/多段连携` 随 re-export 壳留在 `core/resource.ts`，锚改指本函数。
export function findChainAttack(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const chain = agentSkills.categories.find(c => c.id === 'chain')
  if (!chain) return null

  const chainMove = chain.moves.find(m => {
    const name = m.name?.en?.toLowerCase() || ''
    return name.includes('chain attack') && !name.includes('ultimate')
  })
  if (!chainMove) return null

  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, chainMove)

  return {
    moveId: chainMove.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: chainMove.comboAlignRatio ?? 0,
  }
}

/** 从倍率表提取轻弹刀（Defensive Assist #1）信息
 *  在 assist category 中找 name 含 "Defensive Assist" 且含 "#1" 的 move
 */
/** 从倍率表提取闪避反击（Dodge Counter）信息 */
export function findDodgeCounter(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number; timeType?: string }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const dodge = agentSkills.categories.find(c => c.id === 'dodge' || c.id === 'dodgecounter')
  if (!dodge) return null

  const move = dodge.moves.find(m => {
    const en = m.name?.en?.toLowerCase() || ''
    const zh = m.name?.zhCN || ''
    return m.timeType === 'dodgeCounter' || en.includes('dodge counter') || zh.includes('闪避反击')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：前台时间与喧响都走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

export function findDefensiveAssist(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const assist = agentSkills.categories.find(c => c.id === 'assist')
  if (!assist) return null

  const defensiveAssists = assist.moves.filter(m =>
    (m.name?.en?.toLowerCase() || '').includes('defensive assist'))
  // 首选 `#1` 段：轻弹刀只取 #1（#2/#3 = 重招架/连续招架，见 ENGINE_PIPELINE_GUIDE §4「弹刀口径三件事」
  // ——引擎取 #1 + 支援突击 = 完整一次弹刀）。
  // **命名约定回退**（2026-09-15 实测）：3.3 新角色 1631/1641 的 catalog `en` 名**不带 `#N`**
  // （zh 侧写成「·轻招架/·重招架/·连续招架失衡倍率」），原式直接返回 null ⇒ 这两个角色
  // **从来没产过轻弹刀行**（白丢 1.166s 前台与 366 失衡）。按 id 升序取第一条 = 轻招架。
  // 安全性实测：56 个有招架的角色里，min-id 与 `#1` 命中仅 3 例不一致 = 1631/1641（本修复目标）
  // 与真斗 1441（它**有** `#1`，仍走首选分支 ⇒ 零变化；其 `#1` 的 actionTime=0 是另一条既存数据缺口）。
  const move = defensiveAssists.find(m => (m.name?.en || '').includes('#1'))
    ?? [...defensiveAssists].sort((a, b) => (Number(a.id) - Number(b.id)) || String(a.id).localeCompare(String(b.id)))[0]
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

/** 从倍率表提取支援突击（Assist Follow-Up）信息
 *  在 assist category 中找 name 含 "Assist Follow-Up" 的 move（取第一个）
 */
export function findAssistFollowUp(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const assist = agentSkills.categories.find(c => c.id === 'assist')
  if (!assist) return null

  const move = assist.moves.find(m => {
    const name = m.name?.en?.toLowerCase() || ''
    return name.includes('assist follow-up') || name.includes('assist follow up')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}


/** 从倍率表提取反制支援（Counter Assist）信息
 *  按登记的 moveId 取行（不按名字扫：克拉蕾的 assist 段里「支援突击」有两条，按名会挑错行）。
 *  融合组（`data/moveFusions.ts#CLARET_COUNTER_ASSIST`）已登记 → 时间/喧响走「一次动作」整段口径：
 *  反制支援本体 + 紧随的专属支援突击（琢形）合成一行，前台动作也只计 1 次。
 */
export function findCounterAssist(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}, moveId: string): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  let move: { id: string; actionTime?: number | null; comboAlignRatio?: number; rows: { id: string; values: number[] }[] } | null = null
  for (const cat of agentSkills.categories) {
    const hit = cat.moves.find(m => String(m.id) === String(moveId))
    if (hit) { move = hit; break }
  }
  if (!move) return null

  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}


/** 从倍率表提取蕾米「普通攻击：垂虹」信息（特殊虚耀跟随该动作触发） */
export function findRemielleRainbowEnd(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const basic = agentSkills.categories.find(c => c.id === 'basic')
  if (!basic) return null

  const move = basic.moves.find(m => {
    const en = (m.name?.en ?? '').toLowerCase()
    const zh = m.name?.zhCN ?? ''
    return m.id === '1581007' || en.includes("rainbow's end") || zh.includes('垂虹')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

/** 从倍率表提取蕾米后台 Radiant Turn 信息 */
export function findRemielleRadiantTurn(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string; zhCN?: string }; rows: { id: string; values: number[] }[]; actionTime?: number | null; comboAlignRatio?: number }[] }[]
}): { moveId: string; actionTime: number; decibelRecovery: number; comboAlignRatio: number } | null {
  const special = agentSkills.categories.find(c => c.id === 'special')
  if (!special) return null

  const move = special.moves.find(m => {
    const en = (m.name?.en ?? '').toLowerCase()
    const zh = m.name?.zhCN ?? ''
    return m.id === '1581010' || en.includes('radiant turn') || zh.includes('radiant turn') || zh.includes('曙光回旋')
  })
  if (!move) return null

  // 一次动作可能被 catalog 拆成多段（登记融合组）：时间与喧响走融合口径（坑 31）。
  const { actionTime, decibelRecovery } = channelMetricsOf(agentSkills, move)

  return {
    moveId: move.id,
    actionTime,
    decibelRecovery,
    comboAlignRatio: move.comboAlignRatio ?? 0,
  }
}

/** 计算平A秒均回能
 *  遍历 basic category，取 #1-#N 普通平A段（排除强化平A），求秒均回能平均值
 */
export function calcBasicAttackRegenPerSec(agentSkills: {
  categories: { id: string; moves: { id: string; name: { en?: string }; actionTime?: number | null; rows: { id: string; values: number[] }[] }[] }[]
}): { energyPerSec: number; decibelPerSec: number } {
  const basic = agentSkills.categories.find(c => c.id === 'basic')
  if (!basic) return { energyPerSec: 0, decibelPerSec: 0 }

  const energyRates: number[] = []
  const decibelRates: number[] = []

  for (const move of basic.moves) {
    const name = move.name?.en || ''
    // 匹配 #1 到 #N 的普通平A段
    const match = name.match(/#\d+/)
    if (!match) continue
    // 排除冲刺攻击、闪避反击等
    if (name.toLowerCase().includes('dash') || name.toLowerCase().includes('dodge')) continue

    const actionTime = move.actionTime
    if (!actionTime || actionTime <= 0) continue

    let energy = 0
    let decibel = 0
    for (const row of move.rows) {
      if (row.id === 'energy_recovery') energy = row.values[0] || 0
      // 命破角色用闪能：平A回复读 flash_energy_recovery（能量回复读 energy_recovery，二者互斥）
      if (row.id === 'flash_energy_recovery') energy = row.values[0] || 0
      if (row.id === 'decibel_recovery') decibel = row.values[0] || 0
    }

    // 排除强化平A：倍率异常高（强化平A伤害通常是普通平A的2-3倍以上）
    let damage = 0
    for (const row of move.rows) {
      if (row.id === 'damage') damage = row.values[0] || 0
    }
    // 简单判定：伤害倍率 > 200% 可能是强化平A（后续可调）
    if (damage > 200) continue

    energyRates.push(energy / actionTime)
    decibelRates.push(decibel / actionTime)
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  return {
    energyPerSec: avg(energyRates),
    decibelPerSec: avg(decibelRates),
  }
}
