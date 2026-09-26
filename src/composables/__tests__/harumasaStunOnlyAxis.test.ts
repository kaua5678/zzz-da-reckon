/**
 * W31 · 悠真轴模式 `stunOnlyDmgBonus` 在伤害池里被消费：读取侧单测（CC-33a 覆盖盲区）。
 *
 * ## 背景
 *
 * `SkillExecution.stunOnlyDmgBonus`（CC-33a 前名 `harumasaStunOnly`）是**行级字段**：
 *  · 唯一写入方 = `mechanics/agents/harumasa.ts#patchHarumasaExecutions`——**仅轴模式**、
 *    额外能力激活、且 `unionCoverage > 0` 时写入，值 = `40 × (1 − 异常覆盖率)`；
 *  · 唯一读取方 = `resourceCalc/damagePoolDirect.ts#emitExecDirect`——按段直加：
 *    `stunOnlyDmgBonus = stunOverride > 0 ? max(0, exec.stunOnlyDmgBonus) : 0`
 *    （轴内段 `stunOverride > 0` 才加；轴外段敌人未失衡不吃），并把它拼进 `dmgBonus`
 *    与 note 片段 ` · 失衡增伤+<v>%（轴内直加）`。
 *
 * ## 为什么必须单独有这个文件
 *
 * perf 语料里**没有走到这条路径**（census §5.28 反向变异实测 0 个 1201 键出差），
 * `timeGolden` 结构性盲；`mechanics/__tests__/harumasa.test.ts` 只钉了**写入侧**
 * （`exec.stunOnlyDmgBonus === 32`），**读取侧（伤害池真正按段直加/拼 note）零覆盖**。
 * 本文件用真实管线把读取侧的两条不变式钉死。
 *
 * ## 前提假设（证伪闸门）
 *
 * 假设「用现有 harness 能跑出轴模式下悠真的直伤行，且其中存在 note 含 `失衡增伤+` 的行」。
 * 实测成立（探针输出见 `.zc/reports/W31.md`）——故本文件保留。
 *
 * ## 负控
 *
 * 把 `damagePoolDirect.ts` 的 `stunOverride > 0 ?` 临时改成 `stunOverride >= 0 ?`，
 * 轴外段（`stunOverride === 0`）也会直加 ⇒ 本文件断言②必须变红（已实测，见报告）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

/** 悠真直伤行（按 agentId 筛，不按下标——规则 17） */
function harumasaDirectRows(calc: ReturnType<typeof useResourceCalc>) {
  return calc.damagePoolRows.value.filter(r => r.agentId === '1201' && r.type === '直伤')
}

/**
 * 组一支队并装一条**真生效**的轴（含悠真飞弦·斩 `1201020` + 甲乙矢 `1201008`）。
 *
 * ⚠ 三个关键口径（缺一个就静默测错）：
 *  ① **异常覆盖率必须 < 1**：`harumasa.abnormalCoverage` 默认 = 1 ⇒ `40 × (1 − 1) = 0`，
 *     轴内行也不会出现 `失衡增伤+`（整条路径静默为空）。这里显式设 0.2 ⇒ 失衡独有部分 = 32。
 *  ② **额外能力必须激活**：写入侧门控 `panel.additionalAbilityActive > 0`。悠真额外能力条件 =
 *     队里有击破/异常（`specs/agents/1201.json` teamConditions）⇒ 槽1 放 1361「扳机」（击破）。
 *  ③ `config.stunAxes` 必须**整体赋值**（不是 push）——push 时 `stunAxisResult` 实测为 null，
 *     轴模式静默走非轴臂（`damagePoolNightA.test.ts:68` 踩过的坑）；下面用非空断言硬闸门兜底。
 */
async function harumasaAxisRows(opts: { axis: boolean }) {
  const { config } = await setupHarness(
    [{ agentId: '1201', cinemaLevel: 6 }, { agentId: '1361' }, { agentId: '1211' }] as never,
    { recommendedBuild: true },
  )
  // 异常覆盖率 0.2 ⇒ 失衡独有部分 = 40 × 0.8 = 32（非 0，路径才可见）
  config.setMechanicSetting('harumasa.abnormalCoverage', 0.2)
  config.autoYidhariAxis = false
  config.stunAxisPlans.splice(0)
  config.stunAxes.splice(0)
  if (opts.axis) {
    config.useStunAxis = true
    config.stunAxes = [{
      name: 'W31 手动轴',
      actions: [
        { slot: 0, moveId: '1201020', count: 3, startTime: 0 }, // 飞弦·斩（轴内）
        { slot: 0, moveId: '1201008', count: 6, startTime: 1 }, // 甲乙矢（轴内）
        { slot: 1, moveId: '1361009', count: 2, startTime: 2 },
      ],
    }] as never
  } else {
    config.useStunAxis = false
  }
  const calc = useResourceCalc()
  return { calc, config }
}

describe('W31 悠真轴模式 stunOnlyDmgBonus：伤害池按段直加（读取侧）', () => {
  it('★ 轴模式：存在 note 含「失衡增伤+」的轴内直伤行，且 id 不以 -out 结尾', async () => {
    const { calc } = await harumasaAxisRows({ axis: true })
    // 硬闸门：轴没真开就响亮失败，别让用例静默走非轴臂
    expect(calc.stunAxisResult.value, '轴模式未生效（stunAxisResult=null）').not.toBeNull()

    const rows = harumasaDirectRows(calc)
    expect(rows.length, '悠真直伤行不应为空').toBeGreaterThan(0)

    // 断言①：至少一条**轴内**行（id 不以 -out 结尾）note 含「失衡增伤+」
    const inRows = rows.filter(r => !String(r.id).endsWith('-out'))
    const markedIn = inRows.filter(r => String(r.note ?? '').includes('失衡增伤+'))
    expect(markedIn.length, '轴内直伤行应有「失衡增伤+」标记（读取侧直加未生效？）').toBeGreaterThan(0)
    // 标记值口径 = 40 × (1 − 0.2) = 32
    for (const r of markedIn) {
      expect(String(r.note)).toContain('失衡增伤+32.0%（轴内直加）')
    }
  })

  it('★ 轴模式：所有 id 以 -out 结尾的直伤行 note 都不含「失衡增伤+」', async () => {
    const { calc } = await harumasaAxisRows({ axis: true })
    expect(calc.stunAxisResult.value).not.toBeNull()

    const rows = harumasaDirectRows(calc)
    const outRows = rows.filter(r => String(r.id).endsWith('-out'))
    // 非空闸门：没有 -out 行时断言②会**真空通过**（负控也就失去意义）
    expect(outRows.length, '轴模式应产出轴外段（-out）行').toBeGreaterThan(0)
    const markedOut = outRows.filter(r => String(r.note ?? '').includes('失衡增伤+'))
    expect(markedOut, '轴外段（敌人未失衡）不得吃失衡专属直加').toEqual([])
  })
})
