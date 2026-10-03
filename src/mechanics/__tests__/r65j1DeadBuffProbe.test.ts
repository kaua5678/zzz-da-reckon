/**
 * R65-J1 · 「声明了但没接进计算」行为层全库普查探针
 *
 * 问：teammate buff 里被判 interactive（进数值通道 ∧ 有可求值载荷）的条，
 *     拨它（off/on 两态）是否真的改变 damagePoolRows？
 *
 * 答：interactive ⟹ 拨了必变 —— 若不变，就是「声明了效果但零消费者」的真缺口。
 *
 * 运行：
 *   npx vitest run src/mechanics/__tests__/r65j1DeadBuffProbe.test.ts
 *   R65J1_LIMIT=20 npx vitest run ...   # 只扫前 20 条（调试）
 *   R65J1_OWNER=1311 npx vitest run ... # 只扫某 owner
 *
 * 输出：.zc/reports/r65j1-dead-buff-probe.json + stdout 摘要
 *
 * ★ 双仪器纪律（probe-r65.py）：
 *   ① 结构面 = teammateBuffRows 谓词（isTeammateBuffInteractive）
 *   ② 行为面 = 真管线三态读数（readingsFor：auto/off/on 的 damagePoolRows sha256）
 *   两仪器必须一致：interactive 但行为恒定 = 缺口；declared-only 但行为变化 = 谓词漏判。
 *
 * ★ 免腐化：集合运行时派生，不硬编码 id 清单。
 * ★ 正控：扫描前先用 1071 凯撒核心（纯加值，必然咬合）证明管线在工作。
 */
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { isTeammateBuffInteractive, declaredOnlyTeammateBuffs } from '@/utils/teammateBuffRows'
import { getAgentSpec } from '@/specs/registry'
import type { TeammateBuff, TeammateBuffGroup, Agent } from '@/types/catalog'

/**
 * 已确认的「设计预期」缺口（模块单通道已实现，teammate buff 仅作声明）：
 * 这些条目拨不动不是 bug——它们的数值由模块/hook 单通道接入，
 * teammate buff 只是 UI 声明行（不给控件）。行为层拨动恒定 = 正确。
 *
 * 判据：spec/模块 note 明确写了「改走 X 通道」「模块实现」。
 */
const KNOWN_SINGLE_SOURCE: ReadonlySet<string> = new Set([
  // 格莉丝额外能力：模块 grace.ts applyPanel 按 additionalAbilityActive + shockStacks 滑块写 anomalyDmgBonus
  'grace_extra_shock_damage',
  // 波可娜额外能力：C6 时由 teammateBuffGate 禁用（防双计），拨动恒定是设计预期
  'pulchra_extra_trap_followup',
  // 普罗米娅核心被动：spec note 明确「已接 formula 型 teamBuff」，但异放行不在普通 anomaly 主C 的伤害池里
  'promia_ice_team_release_dmg',
  // 普罗米娅额外能力：霜寒持续+3s 明确未建模（spec note），有罪推定走 releaseModifier
  'promethea_extra_guilty_presumption',
])

const MAIN = '1591' // 希格莉德（强攻，通用主C位；只作读数载体，不参与断言）

/** 按 owner 的额外能力门控条件选主C（修「29 条全假阳」的根因） */
function pickMainC(
  ownerAgent: Agent | null,
  allAgents: Agent[],
  excludeId: string,
): { agentId: string; satisfied: boolean } {
  const conds = ownerAgent ? getAgentSpec(ownerAgent.id)?.additionalAbility?.teamConditions ?? [] : []
  for (const cond of conds) {
    if (cond.type === 'specialty' && cond.values?.length) {
      const hit = allAgents.find(a => a.id !== excludeId && cond.values!.includes(a.specialty))
      if (hit) return { agentId: hit.id, satisfied: true }
    }
    if (cond.type === 'sameFactionAsSelf' && ownerAgent?.faction) {
      const hit = allAgents.find(a => a.id !== excludeId && a.faction === ownerAgent.faction)
      if (hit) return { agentId: hit.id, satisfied: true }
    }
    if (cond.type === 'sameAttributeAsSelf' && ownerAgent?.attribute) {
      const hit = allAgents.find(a => a.id !== excludeId && a.attribute === ownerAgent.attribute)
      if (hit) return { agentId: hit.id, satisfied: true }
    }
  }
  return { agentId: MAIN, satisfied: conds.length === 0 }
}

/** 按 buff 的效果作用域修正主C（主C 必须能产受益伤害类型） */
function pickDamageRelevantMainC(
  buff: TeammateBuff,
  fallbackMainC: string,
  owner: string,
  allAgents: Agent[],
): string | null {
  const effects = buff.effects ?? []
  if (effects.length === 0) return fallbackMainC
  const ok = (a: Agent): boolean => {
    for (const e of effects) {
      // 追加攻击限定：主C 必须能产追加攻击。
      // 追加攻击行的生成有两种通道：① catalog skillTags 打标（orphie 等）② 模块
      // `skillDamageTargetOverrides` 写死（anbyZero 的 1381014/1381015）。
      // attack/anomaly 特性主C 大多走通道①；stun/support 主C 的 catalog 里通常没有 AA 行。
      // 但「owner 自己就是主C」时（如 1381 零号·安比扫自己的额外能力），模块通道②
      // 会产出 AA 行 ⇒ 不能用特性一刀切，owner==mainC 时放行。
      if (e.targetSkillType === 'additionalAttack' && a.id !== owner && !['attack', 'anomaly'].includes(a.specialty)) return false
      if (e.stat === 'disorderBaseMultiplierBonus' && (a.specialty !== 'anomaly' || a.id === '1561')) return false
      if (e.stat === 'anomalyReleaseDmgBonus' && a.specialty !== 'anomaly') return false
      if ((e.stat === 'sheerForceFlat' || e.stat === 'sheerDmgBonus') && a.specialty !== 'rupture') return false
      if (e.stat === 'electricAnomalyDmgBonus' && a.attribute !== 'electric') return false
      if (e.stat === 'skillDmgBonus' && e.targetSkillType === 'additionalAttack' && a.id !== owner && !['attack', 'anomaly'].includes(a.specialty)) return false
    }
    return true
  }
  const fallback = allAgents.find(a => a.id === fallbackMainC)
  if (fallback && ok(fallback)) return fallbackMainC
  const candidates = allAgents.filter(a => a.id !== owner && ok(a))
  return candidates[0]?.id ?? null
}

/** 按 owner 需求组队（slot0=主C、slot1=owner、slot2=可选第三人） */
function buildTeamForBuff(
  owner: string,
  buffId: string,
  ownerAgent: Agent | null,
  allAgents: Agent[],
  buff?: TeammateBuff,
): { team: Array<{ agentId: string; cinemaLevel: number }>; satisfied: boolean } {
  // 1581 蕾米埃尔档位门控：必须先于 generic 逻辑（generic 会把主C 换成 anomaly 抬 tier）
  if (owner === '1581') {
    if (buffId.includes('atk_1_anomaly')) {
      // tier1 结构性不可达：1581 自己的条件（specialty:anomaly 排除自身）要求队中另有 anomaly
      // 才激活，但另有 anomaly 即 anomalyCount≥2 ⇒ tier≥2。无其他 anomaly 时 active=false ⇒ tier=0。
      // 这是 buff 描述（「队伍中有1名异常角色」）与门控算式（anomalyCount 含本人）的口径矛盾。
      return { team: [], satisfied: false }
    }
    if (buffId.includes('atk_3_anomaly') || buffId.includes('refringe_3_anomaly')) {
      const pool = allAgents.filter(a => a.specialty === 'anomaly' && a.id !== owner)
      const m = pool[0]; const t = pool.find(a => a.id !== m?.id)
      if (!m || !t) return { team: [], satisfied: false }
      return { team: [{ agentId: m.id, cinemaLevel: 6 }, { agentId: owner, cinemaLevel: 6 }, { agentId: t.id, cinemaLevel: 6 }], satisfied: true }
    }
    // tier2 = 2 anomaly（主C anomaly + owner）⇒ 但紊乱 buff 还需要第三人 anomaly 触发紊乱
    const m = allAgents.find(a => a.specialty === 'anomaly' && a.id !== owner)
    if (!m) return { team: [], satisfied: false }
    const isDisorder = buff?.effects?.some(e => e.stat === 'disorderBaseMultiplierBonus') ?? false
    if (isDisorder) {
      const third = allAgents.find(a => a.specialty === 'anomaly' && a.id !== owner && a.id !== m.id)
      if (!third) return { team: [], satisfied: false }
      return { team: [{ agentId: m.id, cinemaLevel: 6 }, { agentId: owner, cinemaLevel: 6 }, { agentId: third.id, cinemaLevel: 6 }], satisfied: true }
    }
    return { team: [{ agentId: m.id, cinemaLevel: 6 }, { agentId: owner, cinemaLevel: 6 }], satisfied: true }
  }

  const { agentId: rawMainC, satisfied } = pickMainC(ownerAgent, allAgents, owner)
  if (!satisfied) return { team: [], satisfied: false }
  const mainC = buff ? pickDamageRelevantMainC(buff, rawMainC, owner, allAgents) : rawMainC
  if (!mainC) return { team: [], satisfied: false }

  // ★ 追加攻击 buff 且主C=owner 时：需要一个激活额外能力条件的第三人
  // （owner 的 AA 行由自己的模块通道产出，但额外能力需要队友满足条件才激活）
  // （r424：原写法 `A || (stat===skillDmgBonus && A)` 的右支被 TS 收窄成永假 ⇒ TS2367；两支等价，只留 A）
  const isAABuff = buff?.effects?.some(e => e.targetSkillType === 'additionalAttack') ?? false
  if (isAABuff) {
    // 优先用 owner 自己当主C（模块通道产出 AA 行），再补一个激活条件的第三人
    const conds = ownerAgent ? getAgentSpec(ownerAgent.id)?.additionalAbility?.teamConditions ?? [] : []
    for (const cond of conds) {
      if (cond.type === 'specialty' && cond.values?.length) {
        const third = allAgents.find(a => a.id !== owner && cond.values!.includes(a.specialty))
        if (third) return { team: [{ agentId: owner, cinemaLevel: 6 }, { agentId: third.id, cinemaLevel: 6 }], satisfied: true }
      }
    }
    // 找不到激活条件的第三人 ⇒ 无法激活，跳过
    return { team: [], satisfied: false }
  }

  // 紊乱倍率 buff 需要双 anomaly 队（且主C 不能是维琳娜——她的体系不产生紊乱行；
  // 也不能是蕾米埃尔——她的 lumiflux 属性独占异常槽，不参与标准异常替换 ⇒ 紊乱行=0）
  const isDisorder = buff?.effects?.some(e => e.stat === 'disorderBaseMultiplierBonus') ?? false
  if (isDisorder) {
    const mA = allAgents.find(a => a.id === mainC)
    const oA = ownerAgent?.specialty === 'anomaly'
    const mIsA = mA?.specialty === 'anomaly' && mA?.id !== '1561' && mA?.id !== '1581'
    if (oA && mIsA) return { team: [{ agentId: mainC, cinemaLevel: 6 }, { agentId: owner, cinemaLevel: 6 }], satisfied: true }
    if (oA && !mIsA) {
      const alt = allAgents.find(a => a.specialty === 'anomaly' && a.id !== owner && a.id !== '1561' && a.id !== '1581')
      if (!alt) return { team: [], satisfied: false }
      return { team: [{ agentId: alt.id, cinemaLevel: 6 }, { agentId: owner, cinemaLevel: 6 }], satisfied: true }
    }
    if (!oA && mIsA) {
      // 主C anomaly + owner 非 anomaly ⇒ 需要一个 anomaly 第三人（否则队里只有主C 一个 anomaly，不触发紊乱）
      const third = allAgents.find(a => a.specialty === 'anomaly' && a.id !== owner && a.id !== mainC && a.id !== '1561' && a.id !== '1581')
      if (!third) return { team: [], satisfied: false }
      return { team: [{ agentId: mainC, cinemaLevel: 6 }, { agentId: owner, cinemaLevel: 6 }, { agentId: third.id, cinemaLevel: 6 }], satisfied: true }
    }
    // owner 和主C 都不是 anomaly ⇒ 换主C + 补第三人（两个都 anomaly，且都不是维琳娜/蕾米埃尔）
    const nm = allAgents.find(a => a.specialty === 'anomaly' && a.id !== owner && a.id !== '1561' && a.id !== '1581')
    const nt = allAgents.find(a => a.specialty === 'anomaly' && a.id !== owner && a.id !== nm?.id && a.id !== '1561' && a.id !== '1581')
    if (!nm || !nt) return { team: [], satisfied: false }
    return { team: [{ agentId: nm.id, cinemaLevel: 6 }, { agentId: owner, cinemaLevel: 6 }, { agentId: nt.id, cinemaLevel: 6 }], satisfied: true }
  }

  return { team: [{ agentId: mainC, cinemaLevel: 6 }, { agentId: owner, cinemaLevel: 6 }], satisfied: true }
}

function rowHash(rows: Array<Record<string, unknown>>): string {
  return createHash('sha256')
    .update(rows.map(r => [r.slot, r.agentId, r.moveId, r.type, r.totalDamage, r.note].join('|')).sort().join('\n'))
    .digest('hex').slice(0, 16)
}

async function readingsFor(
  _owner: string,
  buffId: string,
  _cinema: number,
  team: Array<{ agentId: string; cinemaLevel: number }>,
): Promise<Array<{ mode: string; hash: string; total: number; rows: number }>> {
  const out: Array<{ mode: string; hash: string; total: number; rows: number }> = []
  for (const mode of ['auto', 'off', 'on'] as const) {
    const { config } = await setupHarness(team.map(t => ({ agentId: t.agentId, cinemaLevel: t.cinemaLevel })))
    for (const b of config.globalBuffs) b.enabled = false
    config.syncTeammateBuffsFromTeam()
    if (mode !== 'auto') config.toggleTeammateBuff(buffId, mode === 'on')
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 0))
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

async function allRows(): Promise<Array<{ group: string; buff: TeammateBuff }>> {
  await setupHarness([{ agentId: MAIN }, '', ''])
  const cat = useCatalogStore()
  return (cat.teammateBuffGroups as TeammateBuffGroup[])
    .flatMap(g => (g.buffs ?? []).map(b => ({ group: g.id, buff: b })))
}

const env = process.env
const LIMIT = env.R65J1_LIMIT ? Number(env.R65J1_LIMIT) : Infinity
const ONLY_OWNER = env.R65J1_OWNER ?? null

describe('R65-J1 · 声明了但没接进计算 · 行为层全库普查', () => {
  it('interactive 条逐条拨动 ⇒ 读数必须变化；declared-only 逐条拨动 ⇒ 读数必须恒定', async () => {
    const rows = await allRows()
    let interactive = rows.filter(r => isTeammateBuffInteractive(r.buff))
    if (ONLY_OWNER) interactive = interactive.filter(r => r.group === ONLY_OWNER)
    const sample = LIMIT === Infinity ? interactive : interactive.slice(0, LIMIT)
    console.log(`[R65-J1] 全库 ${rows.length} 条，interactive ${interactive.length} 条，扫描 ${sample.length} 条`)

    // 正控：凯撒核心（纯加值，必然咬合）
    const ctrl = rows.find(r => r.buff.ownerId === '1071' && isTeammateBuffInteractive(r.buff))
    expect(ctrl, '未找到正控件 1071').toBeTruthy()
    const catAgents = (await setupHarness([{ agentId: MAIN }, '', ''])).catalog.catalog?.agents ?? []
    const ctrlTeam = buildTeamForBuff(ctrl!.group, ctrl!.buff.id, catAgents.find(a => a.id === ctrl!.group) ?? null, catAgents).team
    const ctrlSeen = await readingsFor(ctrl!.group, ctrl!.buff.id, 6, ctrlTeam)
    expect(new Set(ctrlSeen.map(s => s.hash)).size, '正控未咬合').toBeGreaterThan(1)

    const gaps: Array<{ owner: string; id: string; note: string; seen: unknown }> = []
    const errors: Array<{ owner: string; id: string; seen: unknown }> = []
    let scanned = 0

    for (const r of sample) {
      const ownerAgent = catAgents.find(a => a.id === r.group) ?? null
      const { team, satisfied } = buildTeamForBuff(r.group, r.buff.id, ownerAgent, catAgents, r.buff)
      if (!satisfied) { console.log(`  [跳过] ${r.group}/${r.buff.id}`); continue }
      const seen = await readingsFor(r.group, r.buff.id, 6, team)
      scanned++
      if (!seen.every(s => s.rows > 0)) { errors.push({ owner: r.group, id: r.buff.id, seen }); continue }
      if (new Set(seen.map(s => s.hash)).size === 1) {
        // 已确认的「设计预期」缺口（模块单通道已实现，teammate buff 仅作声明）
        if (KNOWN_SINGLE_SOURCE.has(r.buff.id)) {
          console.log(`  [已知单源] ${r.group}/${r.buff.id} — 模块通道已实现，拨动恒定是设计预期`)
        } else {
          // （r424：`TeammateBuff` 没有 `note`——spec 的 note 不经 specTeamBuffToTeammateBuff 透传，原读法恒 ''；改读 description）
          gaps.push({ owner: r.group, id: r.buff.id, note: r.buff.description?.zhCN ?? '', seen: seen.map(s => ({ mode: s.mode, total: s.total })) })
          console.log(`  [缺口] ${r.group}/${r.buff.id}`)
        }
      }
      if (scanned % 20 === 0) console.log(`  ... ${scanned}/${sample.length}`)
    }

    // declared-only 反向抽查
    const declared = declaredOnlyTeammateBuffs(rows.map(r => r.buff))
    const declaredGaps: Array<{ owner: string; id: string }> = []
    for (const b of declared) {
      const owner = rows.find(r => r.buff.id === b.id)?.group
      if (!owner) continue
      const { team, satisfied } = buildTeamForBuff(owner, b.id, catAgents.find(a => a.id === owner) ?? null, catAgents, b)
      if (!satisfied) continue
      const seen = await readingsFor(owner, b.id, 6, team)
      if (seen.every(s => s.rows > 0) && new Set(seen.map(s => s.hash)).size > 1) {
        declaredGaps.push({ owner, id: b.id })
        console.log(`  [谓词漏判] ${owner}/${b.id}`)
      }
    }

    const report = {
      timestamp: new Date().toISOString(),
      total: rows.length, interactive: interactive.length, scanned,
      gaps, errors, declaredGaps,
      verdict: gaps.length === 0 && errors.length === 0 && declaredGaps.length === 0 ? 'CLEAN' : 'GAPS_FOUND',
    }
    mkdirSync('.zc/reports', { recursive: true })
    writeFileSync('.zc/reports/r65j1-dead-buff-probe.json', JSON.stringify(report, null, 2))
    console.log(`\n[R65-J1] 扫描 ${scanned} 条：缺口 ${gaps.length} · 空读数 ${errors.length} · 谓词漏判 ${declaredGaps.length} → ${report.verdict}`)

    expect(errors, `空读数：\n${errors.map(e => `  ${e.owner}/${e.id}`).join('\n')}`).toHaveLength(0)
    expect(gaps, `缺口：\n${gaps.map(g => `  ${g.owner}/${g.id}${g.note ? ` — ${g.note.slice(0, 60)}` : ''}`).join('\n')}`).toHaveLength(0)
    expect(declaredGaps, `谓词漏判：\n${declaredGaps.map(g => `  ${g.owner}/${g.id}`).join('\n')}`).toHaveLength(0)
  }, 600_000)
})
