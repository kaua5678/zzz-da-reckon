/**
 * 从 catalog 推「下一级加金步」（不用预设在文件里手排的 goldSteps）。
 *
 * 为什么单独成文件（2026-10-25）：这条逻辑原先只在 `teamTimelineStore.ts`（时间线用），
 * 而队伍对比页的加金候选**只认 `preset.goldSteps`** ⇒ 96 个预设里 73 个 `goldSteps: []`
 * 的队，`resolveGoldLevel` 把它们钳到 `[基础金, 基础金+0]`，金数滑块 0-6 实际只出 1 个点。
 * 现在两队共用这一份（规则 11：跨角色/跨页共享的加金候选只有一处实现）。
 *
 * 依赖方向：本文件**不 import `teamCompare`**（`teamCompare` 要 import 它）——只依赖
 * `limitedGold`（限定身份）、`signatureWEngine`（专武判定）与 catalog 结构。
 */
import type { Agent } from '@/types/catalog'
import type { GoldStep, TeamPreset } from '@/types/teamPreset'
import type { useCatalogStore } from '@/stores/catalog'
import { isLimitedSAgentId, isLimitedSWengineId } from '@/composables/limitedGold'
import { signatureWEngineOf } from '@/composables/signatureWEngine'
import { localized } from '@/utils/format'
import type { TeamGoldState } from '@/composables/teamTimeline'

/** 限定 S 音擎（与 `teamCompare.isLimitedWEngine` 同一判据；此处直接用单一事实源，不经 catalog 别名解析） */
function isLimitedW(wEngineId: string): boolean {
  return isLimitedSWengineId(wEngineId)
}

/** 基础音擎（0 金档）：
 * - 限定 S 角色：基础档直接带专属音擎（限定 → 计 1 金，与「队伍对比」基础档 = 0命1精+专武 同口径）；
 * - 非限定槽位：只选不占金的音擎（专属优先，其次同职业常驻/A 级）。 */
export function baseWEngineFor(agent: Agent | null | undefined, catalog: ReturnType<typeof useCatalogStore>): string {
  if (!agent) return ''
  const ws = catalog.displayWEngines
  const sig = signatureWEngineOf(catalog, agent.id)
  if (isLimitedSAgentId(agent.id)) {
    // 有专武就带专武；没有 ⇒ **留空**（`''` = 该槽基础档没有限定音擎，不占金）。
    // ⚠ 不退回「同职业第一把限定音擎」：那是**别人的**专武，会让基础金凭空 +1 且伤害方向随机
    // （用户 2026-10-26：「这三人有专武，可能推荐配置暂时没写」⇒ 缺的是归属数据，不是该发别人的武器）。
    return sig?.id ?? ''
  }
  if (sig && !isLimitedW(sig.id)) return sig.id
  const freeSpec = ws.find(w => w.specialty === agent.specialty && !isLimitedW(w.id))
  if (freeSpec) return freeSpec.id
  if (sig) return sig.id
  const sameSpec = ws.find(w => w.specialty === agent.specialty)
  return sameSpec?.id ?? ws[0]?.id ?? ''
}

/**
 * 槽位最佳限定音擎（花 1 金获取的候选）——**只认该角色自己的专武**。
 *
 * 用户 2026-10-26 报障「自动加金感觉完全不准」实测（全库 96 预设 × 509 个首级候选）：
 * 33 步花 1 金反而掉伤害，其中最大 −14.6%。归因时抓到的主要形状是**买别人的专武**：
 * `catalogGoldSteps` 原先在「该角色没有限定专武」时退到「同职业第一把限定音擎」，
 * 于是给丽娜（1211，常驻 S，专武 14121 不计金）发「思络成歌 14149」（千夏的，要求**物理**强特）、
 * 给莱卡恩（1141，常驻 S）发「昨夜来电 14148」（琉音的）、给格莉丝（1181，常驻 S）发
 * 「霰落星殿 14109」（星见雅的，要求**冰**伤）。这三把的被动都挂在主人的元素/招式上，
 * 换上去只剩白值：实测 −5.2~−14.6%（每队）。
 *
 * ⇒ 退回 null（该槽不出换装步），把「买别人的专武」这条伪候选从根本上删掉。
 * 影画/精炼步不受影响；自带限定专武的角色（`sig` 是限定）照旧出换装/精炼。
 *
 * ⚠ 全库复测后仍有 13 步「自己的专武但换上去不划算」（基础档已由自动下位穿上更强的 A 级）——
 * 那是**搜索结果**问题不是候选池问题，留给用户看数据后再定（见 `docs/ENGINE_PIPELINE_GUIDE.md` 坑 61 的「剩余 13 步」）。
 */
export function bestLimitedWEngineFor(agent: Agent | null | undefined, catalog: ReturnType<typeof useCatalogStore>): string | null {
  if (!agent) return null
  const sig = signatureWEngineOf(catalog, agent.id)
  return sig && isLimitedW(sig.id) ? sig.id : null
}

/** 基础档配装态（0 命 0 步 + 各槽基础音擎，精炼 1） */
export function baseStateFor(team: [string, string, string], catalog: ReturnType<typeof useCatalogStore>): TeamGoldState {
  return {
    cinemas: [0, 0, 0],
    wengineMods: [1, 1, 1],
    wEngines: [
      baseWEngineFor(catalog.getAgent(team[0]), catalog),
      baseWEngineFor(catalog.getAgent(team[1]), catalog),
      baseWEngineFor(catalog.getAgent(team[2]), catalog),
    ],
  }
}

/**
 * 预算感知的确定性加金步清单（主C优先：主C影画1..6 → 主C精炼2..5 → 队友1 → 队友2）。
 * 供「搜索排名」与**未声明 goldSteps 的预设**用：每队按目标金数做一次确定性分配（1 次伤害求值），
 * 排名即「所选金数下的大致强度」，比基础金排名更贴近最优加金结果（换人时机正确）。
 * 与 applyGoldSteps 同口径（总限定金、钳制到 [基础金, 基础金+步数]）。
 */
export function buildBudgetAwareGoldSteps(
  team: [string, string, string],
  catalog: ReturnType<typeof useCatalogStore>,
): { steps: GoldStep[]; baseWEngines: [string, string, string] } {
  const steps: GoldStep[] = []
  const baseWEngines = baseStateFor(team, catalog).wEngines
  for (let s = 0; s < 3; s++) {
    const agent = catalog.getAgent(team[s])
    if (!agent) continue
    const name = localized(agent.name, `槽位${s + 1}`)
    if (isLimitedSAgentId(team[s])) {
      for (let c = 1; c <= 6; c++) steps.push({ label: `${name} ${c}命`, slot: s, kind: 'cinema', value: c })
    }
    const baseW = baseWEngines[s]
    if (baseW && isLimitedW(baseW)) {
      for (let m = 2; m <= 5; m++) steps.push({ label: `${name} 精炼${m}`, slot: s, kind: 'wengine', value: m })
    }
  }
  return { steps, baseWEngines }
}

/**
 * 预设**未声明** `goldSteps`（= 作者只给了 01 基线）时的加金阶梯。
 *
 * 语义（用户 2026-10-25：「这个金数0-6感觉并不是0-6」）：空 `goldSteps` 不是「这队不能加金」，
 * 而是「作者没排顺序」⇒ 由 catalog 推一份确定性阶梯，让金数滑块真的能拉。
 * **确定性**（不是逐金贪婪）⇒ 1 次求值/金档，快路径成本不随阶梯长度增长。
 * 想按伤害挑最优分配 = 勾「最优加金」（`computeOptimalGoldAllocations` 会拿同一份阶梯当候选池）。
 *
 * 与 `buildBudgetAwareGoldSteps` 的差别（**只有这一处**）：起点读**预设声明的基础音擎**
 * `baseWEngines`，而不是 `baseStateFor` 推的「限定角色一律上专武」。
 * 原因：`applyGoldSteps` 实际就是从 `preset.wEngines` 起装的；若预设给限定角色声明了
 * **非限定**基础音擎（如蕾米埃尔队用双生泣星 13008），按 baseStateFor 生成的「精炼 2..5」步
 * 会去精炼那把 A 级音擎——那步既不占金（`memberLimitedGold` 不认 13008）又让
 * `resolveGoldLevel` 以为多花了金 ⇒ 金数与标签对不上（实测差 4 金）。这里改成：
 * 基础音擎是限定的 ⇒ 出精炼步；不是限定的 ⇒ 出「换装最佳限定音擎（本体）」步再出精炼步。
 */
export function catalogGoldSteps(
  team: [string, string, string],
  baseWEngines: readonly (string | null | undefined)[],
  catalog: ReturnType<typeof useCatalogStore>,
): GoldStep[] {
  const steps: GoldStep[] = []
  for (let s = 0; s < 3; s++) {
    const agent = catalog.getAgent(team[s])
    if (!agent) continue
    const name = localized(agent.name, `槽位${s + 1}`)
    if (isLimitedSAgentId(team[s])) {
      for (let c = 1; c <= 6; c++) steps.push({ label: `${name} ${c}命`, slot: s, kind: 'cinema', value: c })
    }
    const curW = baseWEngines[s] ?? ''
    if (curW && isLimitedW(curW)) {
      for (let m = 2; m <= 5; m++) steps.push({ label: `${name} 精炼${m}`, slot: s, kind: 'wengine', value: m })
      continue
    }
    const best = bestLimitedWEngineFor(agent, catalog)
    if (!best) continue
    steps.push({ label: `${name} 换${localized(catalog.getWEngine(best)?.name, best)}（本体）`, slot: s, kind: 'wengine', value: 1, wEngineId: best })
    for (let m = 2; m <= 5; m++) steps.push({ label: `${name} 精炼${m}`, slot: s, kind: 'wengine', value: m })
  }
  return steps
}

/**
 * 队伍对比点循环要用的加金阶梯：预设有 `goldSteps` 就用作者的，没有就用 catalog 的确定性阶梯。
 * **未声明才补**——作者排过顺序的预设逐位不变（`toBe` 判据钉住同一个数组引用）。
 */
export function goldStepsForPreset(preset: TeamPreset, catalog: ReturnType<typeof useCatalogStore>): GoldStep[] {
  if (preset.goldSteps.length > 0) return preset.goldSteps
  return catalogGoldSteps(preset.team, preset.wEngines ?? [], catalog)
}
