/**
 * 探针：失衡轴「该打哪些招式」自动识别（PROBE_AXISSUGGEST=1 才跑）。
 *
 * 背景（用户 2026-09-03 新任务）：观察 11 个预设轴（9 角色），提炼「失衡该打哪些招式」的
 * 逻辑并验证能否泛化到其他角色。本探针 = 规则的数据面验证工具：
 *   1. 按槽统计伤害池每招式行的伤害/次数；
 *   2. 按「窗内价值 = 伤害占比」排序（轴内打满 1.5×失衡易伤，占比越高越该进窗）。
 * 泛化验证结论（2026-09-03，探针输出比对）：
 *   - 已有预设队（伊德海莉/十一号/般岳/席德/雨果）：探针 top 行 = 预设轴的招式选择 ✓
 *   - 未收录队（星见雅/艾莲/朱鸢/悠真/月城柳/克拉蕾/洛克茜）：同规则给出合理建议 ✓
 *
 * 规则骨架（可用于任何角色/队伍，动作先后顺序无关）：
 *   1. 候选 = 该角色 伤害池直伤行（真实 moveId）+ 模块 combos（轴内块，展开同源）；
 *   2. 价值 = 招式行伤害 / 角色直伤池（降序取高）；
 *   3. 排除 = 异常池行（紊乱/异放/DoT/感电/侵蚀/碎冰——异常池按时序结算，非轴编排项）、
 *      generic 平A汇总（有专项块如快速火刀/霜月流转时用专项块替代）、占比 <~2% 小行、
 *      单次时长 ≥ 窗口 40% 的长动作；
 *   4. 谁进轴 = 队内直伤占比高者（主C 必进；琉音这类高伤害击破也进；低伤害工具人不进，
 *      按全局覆盖率折算——与现有预设一致）；
 *   5. 容量 = 单窗 ~16-25s（stunTime+4+全队失衡延时），推荐集单窗总时长 ≤ 窗口；
 *   6. 次数 = 轴次数 × 每窗可容纳次数（资源/时长约束，捏轴时定）。
 *
 * 跑法：PROBE_AXISSUGGEST=1 npx vitest run src/composables/__tests__/axisSuggestProbe.test.ts
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const TEAMS: Record<string, [string, string, string]> = {
  // —— 已有预设的角色（验证探针能否复现预设选择）——
  伊德海莉: ['1051', '1481', ''],
  十一号: ['1041', '1481', ''],
  般岳: ['1471', '1481', ''],
  席德: ['1461', '1481', '1521'],
  雨果: ['1291', '', ''],
  // —— 未收录角色（泛化验证）——
  星见雅: ['1091', '1251', '1031'],
  艾莲: ['1191', '1141', '1131'],
  朱鸢: ['1241', '1251', '1031'],
  悠真: ['1201', '1251', '1031'],
  月城柳: ['1221', '1251', '1031'],
  克拉蕾: ['1611', '1511', '1031'],
  洛克茜: ['1621', '1551', '1031'],
}

describe('探针：失衡轴招式自动识别', () => {
  it.runIf(process.env.PROBE_AXISSUGGEST)('逐队输出 直伤池占比表（自动识别依据）', async () => {
    for (const [label, team] of Object.entries(TEAMS)) {
      const { config } = await setupHarness(team.map((agentId, s) => ({ agentId, cinemaLevel: s === 0 ? 6 : 0 })))
      config.syncTeammateBuffsFromTeam()
      const calc = useResourceCalc()
      const rows = calc.damagePoolRows.value
      const rr = calc.resourceResult.value
      if (!rr) { console.log(`\n##### ${label}: 无结果`); continue }
      console.log(`\n##### ${label}（窗口 ${((calc as any).windowDuration?.value ?? 16).toFixed(0)}s · 全队 ${fmt(rows.reduce((s, r) => s + r.totalDamage, 0))}）`)
      for (let s = 0; s < 3; s++) {
        if (!team[s]) continue
        const slotRows = rows.filter(r => r.slot === s)
        const slotDmg = slotRows.reduce((sum, r) => sum + r.totalDamage, 0)
        if (slotDmg <= 0) continue
        const chars = calc.resourceResult.value!.characters
        const c = chars.find(ch => ch.slot === s)
        console.log(`  ◆ ${c?.agentName ?? team[s]} 直伤池 ${fmt(slotDmg)}（${slotRows.length} 行）`)
        const byMove = new Map<string, { name: string; dmg: number; count: number; tags: string[] }>()
        for (const r of slotRows) {
          const key = r.moveId ?? r.name
          const e = byMove.get(key) ?? { name: r.name, dmg: 0, count: 0, tags: [] }
          e.dmg += r.totalDamage
          e.count += r.count
          if (r.type !== '直伤') e.tags.push(r.type)
          byMove.set(key, e)
        }
        const list = Array.from(byMove.entries()).map(([mid, e]) => ({ mid, ...e })).sort((a, b) => b.dmg - a.dmg).slice(0, 10)
        for (const entry of list) {
          const mid = entry.mid
          const e = entry
          const pct = slotDmg > 0 ? (e.dmg / slotDmg * 100) : 0
          console.log(`    ${pct >= 2 ? '★' : ' '} ${pct.toFixed(1).padStart(5)}% ${String(mid).padEnd(14)} ${e.name.slice(0, 22).padEnd(22)} ${fmt(e.dmg)} · ${e.count.toFixed(2)} 次${e.tags.length ? ` · [${e.tags.join(',')}]` : ''}`)
        }
      }
    }
    expect(true).toBe(true)
  })
})

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '?'
  return n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n.toFixed(1)
}
