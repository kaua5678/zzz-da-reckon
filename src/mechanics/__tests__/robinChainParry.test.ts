/**
 * 知更鸟（1661）**[连携招架] → 自动释放[特殊技：万籁与我同歌]**（1661004）。
 *
 * 原文（3.4.3+20278274 描述层）：
 * > 「成功[连携招架]时发动[支援突击]后，若知更鸟不为当前操作角色则自动释放[特殊技：万籁与我同歌]」
 *
 * 口径（用户 2026-11-10，两轮逐字）：
 * ① 「[连携招架]我没找到倍率行，它本身只是 x 弹作为两个人一起招架，有什么新机制吗」⇒ 本体**不产伤害行**；
 * ② 「**x 弹必须是 boss 身上有的**，普通的交替弹不会有。这个计数器只能去 boss 身上取这个次数，
 *    **其他地方不会产**。角色读了 boss x 弹相当于转化为普通弹刀进行方便计算」
 *    ⇒ 触发次数 = Boss 预设 `defaults.xParryTotal`（经 `cfg.bossXParryTotal` 透传），
 *      **不是**队友 parryCount（第一版这么写是错的，本文件锁住这个口径）。
 *
 * 行本体 = 1661004 表值（338.6% / 失衡 200.1 / 喧响 33.2475），backstage 自动、不占前台。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

type BossFile = {
  bosses: {
    id: string
    monster?: { stunVuln: number, stunTime: number }
    defaults: { xParryTotal?: number } & Record<string, unknown>
    phases: { phaseId: string, hp?: number }[]
  }[]
}
const bossFile = JSON.parse(
  readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
) as BossFile
const xBoss = bossFile.bosses.find(b => b.id === '40006')!
const plainBoss = bossFile.bosses.find(b => !(b.defaults.xParryTotal ?? 0))!

function rowOf(rr: any, agentId: string, moveId: string) {
  const ch = rr.characters.find((c: any) => c.agentId === agentId)
  return (ch?.executions ?? []).find((e: any) => String(e.moveId) === moveId)
}

describe('[1661] 连携招架 → 万籁与我同歌（1661004）', () => {
  it('① 数据前提：只有带 X 型金光的 Boss 有 xParryTotal（40006 = 1）', () => {
    expect(xBoss.defaults.xParryTotal).toBe(1)
    expect(plainBoss, '需要一个没有 x 弹的 Boss 做负控').toBeTruthy()
  })

  it('② Boss 有 x 弹 ⇒ 1661004 count = xParryTotal，走后台（不占前台）', async () => {
    await setupHarness([{ agentId: '1601' }, { agentId: '1661' }, { agentId: '1031' }])
    const config = useConfigStore()
    config.applyBossPreset(xBoss as never, xBoss.phases[0] as never, xBoss.monster as never, xBoss.defaults as never)
    const rr = useResourceCalc().resourceResult.value!
    const row = rowOf(rr, '1661', '1661004')
    expect(row, 'Boss 有 x 弹就必须产这一行').toBeTruthy()
    expect(row.count).toBe(1)
    expect(row.timeBucket).toBe('backstage')
    expect(Number(row.damageMultiplier)).toBeGreaterThan(0)
  }, 180000)

  it('③ 负控：Boss 没有 x 弹 ⇒ 不产行；队友普通弹刀再多也不算 x 弹', async () => {
    // 队里有 6 次普通弹刀，但 Boss 无 x 弹 ⇒ 一次都不该触发
    {
      await setupHarness([{ agentId: '1601' }, { agentId: '1661' }, { agentId: '1031' }])
      const config = useConfigStore()
      config.applyBossPreset(plainBoss as never, plainBoss.phases[0] as never, plainBoss.monster as never, plainBoss.defaults as never)
      config.setActionCount(0, 'parryCount', 6)
      const rr = useResourceCalc().resourceResult.value!
      expect(rowOf(rr, '1661', '1661004'), '普通交替弹不产 x 弹').toBeFalsy()
    }
    // 完全没选 Boss（自由木桩）⇒ 同样不产
    {
      await setupHarness([{ agentId: '1601' }, { agentId: '1661' }])
      useConfigStore().setActionCount(0, 'parryCount', 6)
      const rr = useResourceCalc().resourceResult.value!
      expect(rowOf(rr, '1661', '1661004')).toBeFalsy()
    }
  }, 180000)
})
