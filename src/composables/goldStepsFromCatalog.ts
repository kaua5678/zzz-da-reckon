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
import type { Agent, WEngine } from '@/types/catalog'
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

/** 某角色能穿、且**不占限定金**的同职业音擎（常驻 S 优先，其次 A）——基础档/下位的共同兜底 */
function freeEngineOf(agent: Agent, ws: ReadonlyArray<WEngine>): WEngine | undefined {
  const same = ws.filter(w => w.specialty === agent.specialty && !isLimitedW(w.id))
  return same.find(w => w.rarity === 'S') ?? same[0]
}

/** 基础音擎（0 金档）：
 * - 限定 S 角色：基础档直接带专属音擎（限定 → 计 1 金，与「队伍对比」基础档 = 0命1精+专武 同口径）；
 * - 非限定槽位：只选不占金的音擎（专属优先，其次同职业常驻/A 级）。 */
export function baseWEngineFor(agent: Agent | null | undefined, catalog: ReturnType<typeof useCatalogStore>): string {
  if (!agent) return ''
  const ws = catalog.displayWEngines
  const sig = signatureWEngineOf(catalog, agent.id)
  if (isLimitedSAgentId(agent.id)) {
    // 有专武就带专武（这就是「01」= 0 命 1 精的 1 精）；没有 ⇒ 退到**不占金**的同职业音擎。
    // ⚠ 两条边界（2026-10-26 统一口径）：
    //   · 不退「同职业第一把限定音擎」——那是**别人的**专武，基础金凭空 +1 且伤害方向随机；
    //   · 也不留空——空音擎实测比专武本体低 34–41%（那是「没带武器」，不是「没抽专武」）。
    if (sig) return sig.id
    return freeEngineOf(agent, ws)?.id ?? ''
  }
  if (sig && !isLimitedW(sig.id)) return sig.id
  const freeSpec = freeEngineOf(agent, ws)
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

/**
 * 预设的**基础音擎**（0 金档实际穿的那三件）= 单一事实源。
 *
 * 用户 2026-10-26 裁决：预设文件**只带 team**，「基础档穿什么」交给同一条默认规则
 * （= 主页「配装推荐 · 一键应用」同一口径）。两条来源，优先级从高到低：
 *   1. `preset.wEngines` **整个字段在场** = 用户/夹具显式配过（逐槽为准，空串 = 该槽不带专武）；
 *   2. 字段缺席（= 现在所有预设文件的形态）= `baseWEngineFor` 派生：
 *      限定角色带自己专武，其余带**不占金**的同职业音擎（= 主页「配装推荐·一键应用」口径）。
 *
 * ⚠ 空串 = 「没配置」不是「没武器」：早前 `preset.wEngines` 里留空会被 `applyTeamPresetConfig`
 * 当成「回落到 setAgent 的自动推荐」，而 `baseGoldOf` 又按空串算 0 金 ⇒ **标签与实穿两套数**
 * （实测 4/96 预设差 1–2 金）。现在两处都读这一个函数，不会再分叉。
 */
export function presetBaseEngines(
  preset: Pick<TeamPreset, 'team' | 'wEngines'>,
  catalog: ReturnType<typeof useCatalogStore>,
): [string, string, string] {
  // **整个字段缺席** ⇒ 三条全派生（= 现在所有预设文件的形态）。
  const declared = preset.wEngines
  const out = [0, 1, 2].map(s => {
    if (!declared) return baseWEngineFor(catalog.getAgent(preset.team[s]), catalog)
    // **声明了数组** ⇒ 逐槽以声明为准；空串 = 「这个槽不带专武」（下位表/自动下位接手），不派生。
    return declared[s] ?? ''
  })
  return [out[0]!, out[1]!, out[2]!]
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
 * 队伍对比点循环要用的加金阶梯 = **只有用户显式配置**，默认空。
 *
 * ## 为什么默认是空的（用户裁决 2026-10-26，逐字）
 *
 * > 「加金不该有排好的序……我想等我把计算逻辑算好后，跑一遍贪婪算出一份提升表，作为快速默认值。
 * >   这样即便偏离也是少数情况，而且不会太严重。但目前引擎还远远不完善，只能说全01这一片单薄的
 * >   预设就行，要么给 ui 自己改，要么勾选贪婪，提示下一步。」
 *
 * 修前：空 `goldSteps` 时用 `catalogGoldSteps` **临时编一份顺序**当默认。
 * 实测（96 队 × 每队 3 档，`autoGoldProbe.test.ts` 三臂对账）：那份顺序 **285 档里 227 档选错配装、
 * 均值比同池最优低 10.32%、最大低 43.40%**；而「勾最优加金」的贪婪链只低 0.38%。
 * ⇒ 「我们自己编的序」是错误答案的主要来源，不能当默认值报给用户。
 *
 * ## 现在的三条路（都要求用户**显式**选）
 *
 * 1. **默认**：空阶梯 ⇒ `resolveGoldLevel` 钳到 `[基础金, 基础金]` ⇒ 只出「全 01」一个点（诚实：不知道就不装作知道）；
 * 2. **勾「最优加金」**：贪婪逐金搜索（`computeOptimalGoldAllocations`），候选池仍是 catalog 推的
 *    （`catalogGoldSteps`，现在只作为**候选池**而不是**顺序**）；
 * 3. **逐槽锁定 / 预设写回 `goldSteps`**：用户的显式配置，原样用。
 *
 * ⚠ `catalogGoldSteps` 仍保留且**只作候选池**用（贪婪的搜索空间）。它的输出顺序无意义——
 * 贪婪会自己按伤害挑；不要把它当前缀阶梯用（那是修前的错误）。
 */
export function goldStepsForPreset(preset: TeamPreset, _catalog: ReturnType<typeof useCatalogStore>): GoldStep[] {
  return preset.goldSteps
}
