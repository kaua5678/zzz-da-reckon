import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildExportWorkbook, exportExcelFile } from '@/utils/exportExcel'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

describe('Excel 导出（utils/exportExcel）', () => {
  it('工作簿含 4 个 sheet，操作表配置快照与资源表次数/喧响与计算结果一致', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1531', cinemaLevel: 1, wEngineId: '13004', wEngineModLevel: 5,
      driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} },
      parryCount: 4, blockCount: 0, dodgeCounterCount: 10, quickAssistCount: 3, chainCountPerStun: 1, basicAttackTimeWeight: 1 } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1,
      driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} },
      parryCount: 10, blockCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1 } as any
    config.setEnemy({ battleTime: 180, invincibleTime: 21, stunValue: 14068 })
    config.syncTeammateBuffsFromTeam()

    const calc = useResourceCalc()
    const out = calc.resourceResult.value!
    expect(out).not.toBeNull()

    // 模块 buildResourceResult 有写 cfg 的副作用：damagePoolRows 首读可能触发状态更新，复读取稳定快照
    void calc.damagePoolRows.value
    const rows = calc.damagePoolRows.value

    const wb = await buildExportWorkbook({
      team: config.team,
      enemy: config.enemy,
      agentNameOf: (agentId, slot) => calc.agentNames.value[agentId] ?? `槽${slot + 1}`,
      wEngineNameOf: id => id ? (catalog.getWEngine(id)?.name?.zhCN ?? id) : '',
      resourceResult: out,
      damagePoolRows: rows,
      stunPoolResult: calc.stunPoolResult.value,
      anomalyPoolResult: calc.anomalyPoolResult.value,
    })

    const XLSX = await import('xlsx')
    expect(wb.SheetNames).toEqual(['操作表', '资源表', '伤害行明细', '异常池'])

    // 操作表：全局参数 + 角色快照（比利 1命 13004 弹刀4）
    const ops = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets['操作表'], { header: 1 })
    const flat = JSON.stringify(ops)
    expect(flat).toContain('14068')
    expect(flat).toContain('13004')
    expect(flat).toContain('星徽引擎')
    const billyRow = ops.find(r => String(r[1]) === '1531')!
    expect(billyRow[3]).toBe(1) // 命座
    expect(billyRow[7]).toBe(4) // 弹刀

    // 资源表：喧响总量与终结技次数来自计算结果（次数 = floor(total/3000) 同口径）
    const res = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets['资源表'], { header: 1 })
    const resBilly = res.find(r => r[0] === 0)!
    expect(resBilly[3]).toBe(out.characters[0].ultimateCount)
    expect(resBilly[12]).toBe(Math.round(out.characters[0].decibelSource.total))

    // 伤害行明细：全队总伤 = Σ 同一快照 damagePoolRows
    const dmg = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets['伤害行明细'], { header: 1 })
    const totalRow = dmg.find((r: (string | number | null)[]) => r[0] === '全队总伤')!
    const expected = Math.round(rows.reduce((s, r) => s + r.totalDamage, 0))
    expect(totalRow[1]).toBe(expected)
    expect(expected).toBeGreaterThan(0)

    // 写盘冒烟：xlsx 序列化不抛错
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
    expect(buf.length).toBeGreaterThan(1000)

    // 下载路径（浏览器专属 API 在 node 环境 stub）：文件名 + 触发点击
    const clicks: string[] = []
    const anchor: Record<string, unknown> = {
      href: '',
      download: '',
      click: () => clicks.push('download'),
    }
    vi.stubGlobal('document', { createElement: () => anchor })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} })
    try {
      await exportExcelFile({
        team: config.team,
        enemy: config.enemy,
        agentNameOf: (agentId, slot) => calc.agentNames.value[agentId] ?? `槽${slot + 1}`,
        wEngineNameOf: () => '',
        resourceResult: out,
        damagePoolRows: rows,
        stunPoolResult: calc.stunPoolResult.value,
        anomalyPoolResult: calc.anomalyPoolResult.value,
      }, '测试队伍')
      expect(clicks).toEqual(['download'])
      expect(anchor.download).toMatch(/^测试队伍-\d{4}-\d{2}-\d{2}\.xlsx$/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
