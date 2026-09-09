/**
 * 驱动盘套装效果行（面板页展示用，纯函数——页面渲染与测试同源）。
 *
 * 为什么单独建这个模块（用户 2026-09-08：「部分靠前的驱动盘的4件套没给属性滑块，
 * 我认为可能是属性都没做」）：原页面只在效果带 `condition`/`maxStacks` 时出一行
 * 覆盖率滑块，于是常驻段（荆棘玫瑰 dmgBonus）、门槛段（山大王/月光骑士颂 teamBuff、
 * 折枝剑歌 掌控门槛）、未建模段（灵魂摇滚 4pc 减伤）**整块不出现**，
 * 用户无从判断「这条效果到底接没接进计算」——实测它们都生效（面板差分可验），
 * 缺的是可见性。本模块把 2pc/4pc 全部效果一律列成行，并如实标出三类状态：
 *   - adjustable：触发/叠层类 → 页面给 uptime 覆盖率滑块（引擎按效果 id 折算，
 *     见 src/composables/resourceCalc/helpers.ts#mergeDiscEffectCoverages）
 *   - gateText：属性/职业/局外属性门槛 → 引擎自动判定，不折算 uptime
 *   - unmodeled：有官方文本但无数值效果（生存向/机制向）→ 明说未建模，不留空白
 */
import { getStatMeta, isPctStat } from './statMeta'

interface EffectLike {
  id?: string
  type?: string
  stat?: string
  mode?: string
  value?: number
  valuePerStack?: number
  maxStacks?: number
  defaultStacks?: number
  condition?: string
  coverage?: unknown
  requirement?: unknown
  target?: unknown
}

interface PieceLike {
  effects?: EffectLike[] | null
  condition?: string | null
  requirement?: unknown
}

export interface DiscSetLike {
  id?: string
  name?: { zhCN?: string; en?: string } | null
  twoPiece?: PieceLike | null
  fourPiece?: {
    effectText?: Record<string, string> | null
    selfBuff?: PieceLike | null
    teamBuff?: PieceLike | null
  } | null
}

export interface DiscEffectRow {
  /** 覆盖率存储键（效果 id）；无 id 的效果引擎无法按 id 折算 → adjustable=false */
  key: string
  setId: string
  /** '4件·自身' | '4件·全队' | '2件' */
  scope: string
  stat: string
  /** 中文属性名（statMeta 单一来源） */
  label: string
  /** '+15%' / '+9%×3层' / '动态结算' */
  valueText: string
  /** 可折算 uptime → 页面给覆盖率滑块 */
  adjustable: boolean
  /** 门槛自动判定说明（有则不给滑块） */
  gateText?: string
  /** 触发条件文本（tooltip） */
  condition?: string
  /** 招式定向（极地重金属普攻/冲刺段等），非全局生效 */
  targeted?: boolean
  /** 该 piece 有官方文本但无数值效果 */
  unmodeled?: boolean
}

export interface DiscRowLabels {
  /** 特化代码 → 中文（attack → 强攻） */
  specialty?: (code: string) => string
  /** 属性代码 → 中文（lumiflux → 流明） */
  attribute?: (code: string) => string
  /** statId → 中文属性名（缺省走 statMeta） */
  stat?: (statId: string) => string
}

const REQUIREMENT_STAT_ZH: Record<string, string> = {
  def: '局外防御',
  critRate: '局外暴击率',
  anomalyMastery: '异常掌控',
  atk: '局外攻击',
}

function requirementText(raw: unknown, labels: DiscRowLabels): string {
  if (!raw || typeof raw !== 'object') return ''
  const req = raw as Record<string, any>
  const parts: string[] = []
  if (req.specialty) parts.push(`限${(labels.specialty ?? String)(req.specialty)}角色`)
  if (req.attribute) parts.push(`限${(labels.attribute ?? String)(req.attribute)}属性`)
  const oos = req.outOfCombatStat
  if (oos?.stat) parts.push(`${REQUIREMENT_STAT_ZH[oos.stat] ?? oos.stat}≥${oos.min ?? '?'}（自动判定）`)
  return parts.join(' · ')
}

function valueTextOf(e: EffectLike): string {
  const unit = e.mode === 'flat' && !isPctStat(e.stat ?? '') ? '' : '%'
  if (e.type === 'stacked') {
    const per = e.valuePerStack ?? e.value ?? 0
    const stacks = e.defaultStacks ?? e.maxStacks ?? 1
    return `+${per}${unit}×${stacks}层`
  }
  if (typeof e.value === 'number') return `+${e.value}${unit}`
  return '动态结算'
}

function rowsOfPiece(
  piece: PieceLike | null | undefined,
  scope: string,
  setId: string,
  labels: DiscRowLabels,
): DiscEffectRow[] {
  const groupCondition = typeof piece?.condition === 'string' ? piece.condition : ''
  const groupGate = requirementText(piece?.requirement, labels)
  return (piece?.effects ?? []).map((e, i) => {
    const gate = [groupGate, requirementText(e.requirement, labels)].filter(Boolean).join(' · ')
    const condition = [groupCondition, typeof e.condition === 'string' ? e.condition : ''].filter(Boolean).join('；')
    const key = String(e.id ?? `${setId}-${scope}-${i}`)
    const statId = String(e.stat ?? '')
    return {
      key,
      setId,
      scope,
      stat: statId,
      label: labels.stat ? labels.stat(statId) : getStatMeta(statId).label,
      valueText: valueTextOf(e),
      // 门槛类由引擎按面板自动判定，再挂 uptime 滑块会双重打折 → 不给
      adjustable: !gate && !!e.id && (!!e.condition || !!e.maxStacks || !!e.coverage),
      ...(gate ? { gateText: gate } : {}),
      ...(condition ? { condition } : {}),
      ...(e.target ? { targeted: true } : {}),
    }
  })
}

function unmodeledRow(setId: string, scope: string, name: string, text: string): DiscEffectRow {
  return {
    key: `${setId}-${scope}-unmodeled`, setId, scope, stat: '', label: `${name}（${scope}）`,
    valueText: '未建模', adjustable: false, unmodeled: true, condition: text,
  }
}

/**
 * 列出当前装配（4件套 + 2件套）的全部套装效果行。
 * 引擎口径（src/core/buff.ts#collectDriveDiscBuffs）：4 件套同样带该套的 2 件段，
 * 所以 4件套自身的 2pc 也要列；4件与2件是同套时只列一次。
 */
export function buildDiscEffectRows(
  four: DiscSetLike | undefined,
  two: DiscSetLike | undefined,
  labels: DiscRowLabels = {},
): DiscEffectRow[] {
  const rows: DiscEffectRow[] = []
  const seen = new Set<string>()
  const push = (list: DiscEffectRow[]) => {
    for (const r of list) {
      const dedupe = `${r.setId}|${r.scope}|${r.key}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      rows.push(r)
    }
  }
  const nameOf = (s: DiscSetLike) => s.name?.zhCN ?? s.name?.en ?? String(s.id ?? '')
  /** 一个套装被穿上时应该出现的段（4件套含其 2 件段） */
  const piecesOfEquippedSet = (set: DiscSetLike, asFour: boolean) => {
    const id = String(set.id ?? '')
    if (asFour) {
      const selfRows = rowsOfPiece(set.fourPiece?.selfBuff, '4件·自身', id, labels)
      const teamRows = rowsOfPiece(set.fourPiece?.teamBuff, '4件·全队', id, labels)
      push(selfRows)
      push(teamRows)
      if (set.fourPiece?.effectText && !selfRows.length && !teamRows.length) {
        push([unmodeledRow(id, '4件', nameOf(set), Object.values(set.fourPiece.effectText)[0] ?? '')])
      }
    }
    const twoRows = rowsOfPiece(set.twoPiece, '2件', id, labels)
    push(twoRows)
    if (!twoRows.length) {
      push([unmodeledRow(id, '2件', nameOf(set), '该套装未录 2 件效果（wiki 快照缺项）')])
    }
  }

  if (four) piecesOfEquippedSet(four, true)
  if (two && String(two.id ?? '') !== String(four?.id ?? '')) piecesOfEquippedSet(two, false)
  return rows
}
