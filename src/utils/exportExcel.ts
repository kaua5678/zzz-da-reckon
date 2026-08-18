/**
 * Excel 导出工具：把队伍配置 + 资源计算结果 + 伤害行导出为多 sheet 工作簿（.xlsx）。
 * Sheet 结构对齐用户手工 Excel 的组织习惯：
 *   操作表（配置快照，字段名稳定，将来可反向导入）/ 资源表 / 伤害行明细 / 异常池
 * xlsx 库按需动态加载（约 400KB min，不进主 bundle）。
 */
import type { CharacterConfig, EnemyConfig } from '@/stores/config'
import type { TeamResourceResult, StunPoolResult, AnomalyPoolResult } from '@/types/resource'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

export interface ExcelExportInput {
  team: CharacterConfig[]
  enemy: EnemyConfig
  /** agentId → 显示名（音擎名同理，由调用方解析） */
  agentNameOf: (agentId: string, slot: number) => string
  wEngineNameOf: (wEngineId: string) => string
  resourceResult: TeamResourceResult | null
  damagePoolRows: DamagePoolRow[]
  stunPoolResult: StunPoolResult | null
  anomalyPoolResult: AnomalyPoolResult | null
}

type Row = (string | number | null)[]

/** Sheet1 操作表：全局参数 + 角色配置快照（数值单元格，便于在 Excel 中改后对照） */
function buildOperationRows(input: ExcelExportInput): Row[] {
  const e = input.enemy
  const rows: Row[] = [
    ['== 全局参数 =='],
    ['战斗时间(s)', e.battleTime, '无敌时间(s)', e.invincibleTime, 'boss失衡值', e.stunValue],
    ['boss防御', e.defense, '秽盾数量', e.shieldCount, '能量盾数量', e.energyShield],
    [null],
    ['== 角色配置 =='],
    ['槽位', 'agentId', '角色', '命座', '音擎id', '音擎', '精修', '弹刀', '闪反', '快支', '每失衡连携', '平A时间权重', '驱动盘4件', '驱动盘2件'],
  ]
  for (const c of input.team) {
    if (!c.agentId) continue
    rows.push([
      c.slot, c.agentId, input.agentNameOf(c.agentId, c.slot), c.cinemaLevel ?? 0,
      c.wEngineId ?? '', input.wEngineNameOf(c.wEngineId ?? ''), c.wEngineModLevel ?? 1,
      c.parryCount ?? 0, c.dodgeCounterCount ?? 0, c.quickAssistCount ?? 0,
      c.chainCountPerStun ?? 0, c.basicAttackTimeWeight ?? 1,
      c.driveDisc?.fourPieceSetId ?? '', c.driveDisc?.twoPieceSetId ?? '',
    ])
  }
  return rows
}

/** Sheet2 资源表：每角色一行，资源次数 + 喧响明细 + 时间分配 */
function buildResourceRows(input: ExcelExportInput): Row[] {
  const rows: Row[] = [
    ['槽位', '角色', '强特次数', '终结技次数', '连携次数', '单管失衡贡献',
      '开局喧响', '招式喧响', '奖励喧响', '队友伴随', '特殊动作奖励', '异常奖励', '喧响总量',
      '必做时间(s)', '平A时间(s)', '前台时间(s)', '后台时间(s)', '合轴时间(s)'],
  ]
  for (const c of input.resourceResult?.characters ?? []) {
    const ds = c.decibelSource
    const t = c.timeAllocation
    rows.push([
      c.slot, input.agentNameOf(c.agentId, c.slot),
      Math.round((c.exSpecialCount ?? 0) * 100) / 100, c.ultimateCount, c.chainCountTotal,
      Math.round((c.totalStunBuildUp ?? 0) * 10) / 10,
      Math.round(ds.initialGift), Math.round(ds.skillRegen), Math.round(ds.bonusRegen),
      Math.round(ds.teammateShare), Math.round(ds.specialActionBonus ?? 0), Math.round(ds.anomalyBonus ?? 0),
      Math.round(ds.total),
      Math.round((t.necessaryTime ?? 0) * 100) / 100, Math.round((t.basicAttackTime ?? 0) * 100) / 100,
      Math.round((t.frontlineTime ?? 0) * 100) / 100, Math.round((t.backstageTime ?? 0) * 100) / 100,
      Math.round((t.comboAlignTime ?? 0) * 100) / 100,
    ])
  }
  const sp = input.stunPoolResult
  if (sp) {
    rows.push([null], ['== 失衡池 =='], ['失衡次数', sp.stunCount, '全队失衡值', Math.round(sp.totalStunBuildUp ?? 0)])
  }
  return rows
}

/** Sheet3 伤害行明细：damagePoolRows 全量 + 占比 */
function buildDamageRows(input: ExcelExportInput): Row[] {
  const total = input.damagePoolRows.reduce((s, r) => s + r.totalDamage, 0)
  const rows: Row[] = [
    ['槽位', '角色', '类型', '招式', 'moveId', '元素', '来源', '次数', '单次伤害', '总伤害', '总伤占比%', '失衡易伤', '备注'],
  ]
  for (const r of input.damagePoolRows) {
    rows.push([
      r.slot, r.agentName, r.type, r.name, r.moveId ?? '', r.element, r.source,
      Math.round(r.count * 100) / 100, Math.round(r.perDamage), Math.round(r.totalDamage),
      total > 0 ? Math.round((r.totalDamage / total) * 10000) / 100 : 0,
      r.stunMult ?? 1, r.note ?? '',
    ])
  }
  rows.push([null], ['全队总伤', Math.round(total)])
  return rows
}

/** Sheet4 异常池：元素触发汇总 + 各槽位分布 */
function buildAnomalyRows(input: ExcelExportInput): Row[] {
  const ap = input.anomalyPoolResult
  if (!ap) return [['异常池', '无数据']]
  const rows: Row[] = [
    ['== 元素触发 ==', null, '全队异常总触发', ap.totalTriggerCount ?? 0, '全队紊乱总次数', ap.disorderCount ?? 0],
    ['元素', '积蓄总量', '异常触发', '积蓄上限'],
  ]
  for (const p of ap.perElement ?? []) {
    rows.push([p.element, Math.round(p.totalBuildUp ?? 0), p.triggerCount ?? 0, p.buildUpCap ?? 0])
  }
  rows.push([null], ['== 槽位分布（触发次数 / 喧响奖励） =='],
    ['槽位', '异常触发', '紊乱触发', '乱流触发', '喧响奖励(含伴随)'])
  const slots = Math.max(
    (ap.perSlotAnomalyTriggers ?? []).length,
    (ap.perSlotDisorderTriggers ?? []).length,
    (ap.perSlotTurbulenceTriggers ?? []).length,
    (ap.perSlotBonus ?? []).length,
  )
  for (let i = 0; i < slots; i++) {
    rows.push([
      i, ap.perSlotAnomalyTriggers?.[i] ?? 0, ap.perSlotDisorderTriggers?.[i] ?? 0,
      ap.perSlotTurbulenceTriggers?.[i] ?? 0, Math.round(ap.perSlotBonus?.[i] ?? 0),
    ])
  }
  return rows
}

/** 组装工作簿（纯数据组装，可在 node 环境测试；不触发下载） */
export async function buildExportWorkbook(input: ExcelExportInput) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const append = (rows: Row[], name: string) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  append(buildOperationRows(input), '操作表')
  append(buildResourceRows(input), '资源表')
  append(buildDamageRows(input), '伤害行明细')
  append(buildAnomalyRows(input), '异常池')
  return wb
}

/** 浏览器端导出：动态加载 xlsx → 生成 .xlsx → Blob 下载 */
export async function exportExcelFile(input: ExcelExportInput, baseName = 'zzz-calculator') {
  const XLSX = await import('xlsx')
  const wb = await buildExportWorkbook(input)
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const date = new Date().toISOString().slice(0, 10)
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}-${date}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
