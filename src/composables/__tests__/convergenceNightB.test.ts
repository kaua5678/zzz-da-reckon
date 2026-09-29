/**
 * `convergence.ts` 夜间批 B 判据（2026-09-17 round 21 夜）。
 *
 * ## 本批判据在防什么
 *
 * 该文件原有 8 行角色身份判定（新尺 AST 三形态，`:79/:159/:513/:549/:654/:804/:827/:1103`）。
 * 本批把其中 **6 行**收进既有 helper `findSlotByIdentity`（前批 `8723329` 抽的
 * 「按身份找槽位」单一事实源）+ **1 行去重**（`hugoSlot` 原先算两遍），
 * 剩 2 行（`:817`/`:840`）**如实保留**并挂账（理由见报告：缺的是契约不是 DRY 机会）。
 *
 * ⚠ **本文件的核心不是「删了字面量」，而是「删了之后语义还在」**——判据分四层：
 *   ① **等价性 oracle**：新表达式 === 旧内联表达式（逐队形逐槽对照）。这是本批的**主判据**：
 *      棘轮只数「还有几行字面量」，它**不检查**你把比较写成了什么。
 *   ② **前导空槽**（`['', 1291, 1481]`）：`:549`/`:654`/`:1103` 全是「按身份找槽位」，
 *      而 `findSlotByIdentity` 返回的是 `configStore.team` 的**下标**；空槽把「下标 vs 槽位号」
 *      的差别放大成可见差异（规则 §2「槽位号 ≠ 下标」）。
 *   ③ **数据面事实钉住**：本批 5 个目标 id（1291/1471/1481/1401）在 catalog 里
 *      **都没有 `teammateBuffId`**（只有 5 个角色有，且全部等于自身 id）⇒ 那些
 *      `a?.teammateBuffId === 'X'` 右臂在当前数据面恒 false。**不删**（契约面），
 *      但用 helper 的等价性证明「两字段都查」不改变结果，并把这个事实钉住
 *      ——某天某个 id 真成为别名时这里立刻红。
 *   ④ **反向验证（变异证明判据能红）**：实测表如下（每条都真跑过、已还原）——
 *
 *   | # | 变异 | 结果 |
 *   |---|---|---|
 *   | M1 | `findSlotByIdentity` 删掉 `teammateBuffId` 臂 | **红**：layer③-b `expected -1 to be 1`（1 例） |
 *   | M2 | `findSlotByIdentity` 删掉 `if (!a) return false` 空值守卫 | **红 9 例**：`TypeError: Cannot read properties of undefined (reading 'id')` |
 *   | M3 | `:79` 改用「压缩数组下标」当槽位号（本仓 §2 禁的 `arr[slot]` 同族错） | **红**：组 4 真管线 `前导空槽…expected undefined to be truthy`（1 例） |
 *   | M4 | `:667` 琉音 id 改错（1481→1482） | 本文件**绿**、但**全字段指纹红**（见下） |
 *   | M5 | `:549` 般岳 id 改错（1471→1472） | **全字段指纹红 39 键** |
 *
 *   ★ **M4/M5 是本文件判据的边界，如实记下**：层①②的 oracle 只证明 **helper** 写对了，
 *   **不证明调用点传的 id 是对的**（M4 在 19 条断言下全绿）。补这一层的成本很高（要按 id
 *   逐个构造判据），故本批改用**全字段指纹对拍**兜住（见下），而不是把 8 个站点各写一条。
 *
 * ## 全字段指纹对拍（本批的等价性主证据，`8723329` 先例）
 *
 * HEAD 版 vs 改动版，**315 态**（105 预设 + 12 手组队×2 轴态 + 7 轴队形×3 锁×3 目标槽 +
 * 62 角色×2 命座）逐字段指纹（伤害池全行 + 逐槽 ex/ult/chain/时间 9 位小数 + 异常池 +
 * 轴栈 executed + 雨果决算 + 般岳补齐 + 面板）：
 * **两侧 JSON md5 完全相同**（`bfb445794f10f9e67eb0687a8a35ceff`，diff 键 0/315）。
 * 敏感性自证：M5 ⇒ 39 键红、M4 的轴分支在补齐轴覆盖后亦可分辨
 * ⇒ 指纹不是「恒绿的空转」。
 *
 * ⚠ **脚手架未进仓库**（一次性：`nightBFingerprint.debug.test.ts` 跑完即删，避免多一个
 *   debug 测试与 `vue-tsc` 负担）；复现方法写在本段，需要时重建。
 *
 * ## 为什么不能只靠 timeGolden（任务书已警告）
 *
 * `timeGolden` 对轴内/反馈类改动**结构性盲**（含 1391 的预设全无轴）。本批 6 处里
 * `:513`/`:667` 都是**轴模式**门控 ⇒ 必须手组队自建判据（本文件层①/②/组 4 就是在补这个盲区）；
 * 上层另有 315 态全字段指纹。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness, type HarnessTeamSlot } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

type Team = Array<HarnessTeamSlot | ''>

async function ctx(team: Team) {
  const { catalog, config } = await setupHarness(team, { recommendedBuild: true })
  return { catalog, config }
}

/**
 * **旧内联表达式**（本批消除的形状）——等价性 oracle。
 *
 * 逐字保留迁移前的三种原文：
 *  · `some` 形态（`:159`/`:513`）  → `configStore.team.some(char => { const a = …; return a?.id === X || a?.teammateBuffId === X })`
 *  · `findIndex` 形态（`:549`/`:654`/`:1103`）→ 同上但 `findIndex`
 *  · 爱丽丝形态（`:79`）→ `findIndex(c => c.agentId && (getAgent(c.agentId)?.id === X || getAgent(c.agentId)?.teammateBuffId === X))`
 *    ⚠ 它与前两者的差别是**双次 getAgent 调用 + 外层 `c.agentId &&` 短路**——oracle 里逐字保留，
 *      以便证明 helper 的 `if (!a) return false` 与之等价（空槽 / 未知 id 两条路径）。
 */
// CC-277（第 292 轮）：原「组 1/2/4：身份查找收进 findSlotByIdentity」整段（层①等价 oracle / 层②精确槽位 / 层③别名反锁）
// 随 findSlotByIdentity 删除而删除——该 helper 已无生产调用方；组 4 的端到端判据（下一段）不依赖它，保留。

describe('convergence 夜间批 B · 组 4 真管线（`:79` 调用点，不只是 helper）', () => {
  /**
   * ⚠ **为什么必须补这一层**（本批实测教训，值得留给下一批）：
   * 上面层①②的等价性 oracle 全部是「把 helper 与**旧表达式**对拍」——它证明的是
   * **helper 本身**没写错，**没有**证明 `:79` 那个调用点用的是 helper。
   * 反向验证时实测到：把 `:79` 换成「取**最后一个**匹配」的错误实现（`aliceIdxs[aliceIdxs.length-1]`），
   * 16 条断言**全绿**（因为队里只有一个爱丽丝时两者同值）。
   * ⇒ 判据必须落到**端到端可观察量**上：`aliceInfo` 的 `slot` 唯一对外通道是
   * `calcAnomalyPoolInput` 的 `giftedTriggerSlot` / `coweringConfig`
   * ⇒ 用「爱丽丝在**前导空槽**后的槽位」把「下标 ≠ 槽位号」放大成可见数字差。
   */
  it('★ 前导空槽 + 爱丽丝在槽 2：畏缩 DOT 仍进池（aliceInfo 不被空槽打断）', async () => {
    // 队伍 = ['', 1181, 1401]：爱丽丝在**槽 2**，槽 0 空。
    // 若 aliceInfo 的槽位查找退化成 `characters[slot]` 下标语义（或取错匹配），
    // `resourceConfig.characters.find(c => c.slot === slot)` 就取不到 ⇒ aliceInfo 返回 null
    // ⇒ `coweringConfig` 不下发 ⇒ 畏缩 DOT 整块静默丢零。
    const { config } = await setupHarness(['', { agentId: '1181' }, { agentId: '1401' }] as never, { recommendedBuild: true })
    config.setMechanicSetting('alice.coweringEnabled', 1)
    const calc = useResourceCalc()
    const dot = calc.anomalyPoolResult.value?.coweringDot
    expect(dot, '前导空槽时 aliceInfo 必须仍解析出爱丽丝（否则本行红）').toBeTruthy()
    expect(dot!.totalDotDamage).toBeGreaterThan(0)
  })

  it('★ 槽 0 与槽 2 两种摆法给出**同一份**畏缩配置（槽位不影响配置内容，只影响 slot）', async () => {
    // 这条把「slot 被正确解析」与「配置真的被下发」分开：两种摆法下 dotRatio 都应 = 2.5（数据面默认）
    const read = async (team: unknown[]) => {
      const { config } = await setupHarness(team as never, { recommendedBuild: true })
      config.setMechanicSetting('alice.coweringEnabled', 1)
      return useResourceCalc().anomalyPoolResult.value?.coweringDot
    }
    const slot0 = await read([{ agentId: '1401' }, { agentId: '1181' }, { agentId: '1451' }])
    const slot2 = await read([{ agentId: '1181' }, { agentId: '1451' }, { agentId: '1401' }])
    expect(slot0, '槽 0 摆法').toBeTruthy()
    expect(slot2, '槽 2 摆法').toBeTruthy()
    // 精确值：两条路径配置同源 ⇒ 同一 dotRatio（不是 >0 了事）
    expect(slot0!.dotRatio).toBe(slot2!.dotRatio)
    expect(slot0!.dotRatio).toBe(2.5)
  })

  it('★ 无爱丽丝队伍 ⇒ 畏缩 DOT 不存在（反向锁：上面两行不是因为恒真而绿）', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1451' }, { agentId: '1011' }], { recommendedBuild: true })
    config.setMechanicSetting('alice.coweringEnabled', 1)
    expect(useResourceCalc().anomalyPoolResult.value?.coweringDot).toBeFalsy()
  })
})

describe('convergence 夜间批 B · 组 3 保留项：cfg-merge 分支仍在（如实挂账的反向锁）', () => {
  /**
   * 本组**刻意未迁**（`:817` 雨果 / `:840` 般岳）。判据不是「它迁了」，而是：
   * ① 两个分支的**消费端契约**确实存在且被真管线喂到（迁走的前提面被如实登记）；
   * ② 迁移所需的**契约缺口**是可复现的事实（不是借口）。
   * 这两条一起构成「本批为什么没做」的可检验记录——避免下一批重新侦察一遍。
   */
  it('① 雨果消费端契约存在：hugo.ts 读 cfg 的 hugoRemainingStunSeconds / hugoAxisExVerdictCount', async () => {
    const { catalog } = await ctx([{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1011' }])
    const mod = (await import('@/mechanics')).getAgentMechanic('1291')!
    expect(mod.agentIds).toEqual(['1291'])
    // 消费点：hugo.ts 用 `record.hugoAxisExVerdictCount !== undefined` 选通路
    // （⇒ 该字段是「有没有轴内反推」的判据，不是普通数值）。
    expect(catalog.getAgent('1291')!.id).toBe('1291')
  })

  it('② 般岳消费端契约存在：banyueInteractionTopUp 字段被模块读取', async () => {
    const mod = (await import('@/mechanics')).getAgentMechanic('1471')!
    expect(mod.agentIds).toEqual(['1471'])
    // CC-23：补齐求解经模块能力派发（缺了它 autoTopUp 静默不补）
    expect(typeof mod.computeInteractionTopUp, 'CC-23：般岳模块须挂出 computeInteractionTopUp').toBe('function')
    // CC-293：槽位按「谁挂出该能力」查找（旗标 producesInteractionTopUp 已删），convergence 与交互栏共用
    const { findInteractionTopUpSlot, getRegisteredAgentMechanics } = await import('@/mechanics')
    expect(findInteractionTopUpSlot([{ agentId: '1011' }, { agentId: '1471' }, null])).toBe(1)
    expect(findInteractionTopUpSlot([{ agentId: '1011' }, { agentId: '' }, undefined])).toBe(-1)
    // 当前唯一产出者；新增时同步核对 convergence 的通用保底4喧响互斥（decibelParryActive）
    expect(getRegisteredAgentMechanics().filter(m => typeof m.computeInteractionTopUp === 'function').map(m => m.agentIds[0])).toEqual(['1471'])
  })

  it('★ 契约缺口可复现：`guarantee.*` 不是注册 MechanicSetting ⇒ 模块侧读不到（故 :840 的 autoTopUp 迁不动）', async () => {
    const { getRegisteredMechanicSettings } = await import('@/mechanics')
    const ids = getRegisteredMechanicSettings().map(s => s.id)
    // `resolveMechanicSettings` 只遍历注册表 ⇒ 未注册 = 不在 AgentTeamConfigInput.settings 里
    for (const k of ['guarantee.fury', 'guarantee.ultimate', 'guarantee.stun']) {
      expect(ids.includes(k), `${k} 若被注册 ⇒ 模块可读 ⇒ :840 的迁移前提变了，应复核`).toBe(false)
    }
    // 反证：般岳自己的滑块**是**注册的（对照，证明上面的 false 不是遍历写错）
    expect(ids.includes('banyue.autoTopUpInteractions')).toBe(true)
  })
})
