/**
 * ⚠ beta 冻结副本（生成文件，勿手改——重跑 snapshot-agent.mjs 会整体覆盖）。
 * 冻结自 src/mechanics/agents/robin.ts @ 619426f4（nanoka 3.4.1+19997538，2026-11-01T07:32:25.332Z）；
 * 角色 id 1661v1；由 scripts/snapshot-agent.mjs 生成，mechanics/index.ts 的 glob 自动注册。
 * 引擎共享件（chargeLock / moduleExecRow 等）不冻结——副本只锁角色自身逻辑。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentTeamConfigInput,
  AgentTeamPanelEffectInput,
  AgentResourceSectionsInput,
} from '../../types'
import { getRowValue } from '@/data/moveTableQueries'
import { effectiveCombatTime } from '@/core/effectiveTime'
import { outOfCombatStat } from '@/mechanics/initialStat'
import { moduleExecRow, RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { panelOfSlot } from '@/core/sourcePanels'
import { applyStat } from '@/core/buff'
import { mechanicSettingPanelReader } from '@/utils/mechanicSettingCfg'
import { fmt } from '@/utils/format'

/**
 * 知更鸟（1661·防护/以太）——v1 测试服占位包（nanoka **3.4.1+19997538** 热更包，2026-10-30 重录），2026-10-25 第三刀。
 *
 * ## 本文档覆盖的两个机制（原文出处都在 spec 1661.json）
 *
 * ### ① 离场守护·全队防御（原文「特殊技：离场技」条目）——**伤害项，不是生存项**
 * > 「[离场守护]状态期间全队角色获得防御力提升，知更鸟初始最大生命值大于16000时，每多拥有1000点
 * >  生命值获得{CAL:44+AvatarSkillLevel(1)*3}点防御，最高不超过{CAL:440+AvatarSkillLevel(1)*30}点，
 * >  该效果在知更鸟结束[离场守护]状态后仍保留15秒。」
 *
 * 落点 = **全队固定防御**（inCombatDefFlat）——锋御以防御力作伤害基底（core/damage.ts 的
 * SHARPEN_DAMAGE_PROFILE.calcBasisValue = panel.def），所以这一条是实打实的伤害项。
 * 读取源 = **知更鸟自己的源面板局外生命**（panelOfSlot(sourcePanels, slot, 'outOfCombat')，
 * 「初始最大生命值」= 局外口径），不读队友面板、不读已叠过局内 buff 的 panel。
 * 数值：Lv12 ⇒ 每满 1000 点 +80、上限 800、门槛 16000；拥有[Buff强化点]时**提升效果与上限各 +25%**。
 *
 * ### ② 登场值 / Buff 强化点循环（原文核心被动 Lv.7 + 特殊技·追加攻击）
 * > 「[离场守护]状态下，知更鸟发动追加攻击可以获得[登场值]，[登场值]最多可以拥有120点；
 * >  当[登场值]大于等于100点时…消耗100点[登场值]发动[登场技]…
 * >  发动[登场技]时，知更鸟获得1个[Buff强化点]，[Buff强化点]最多持有1个」
 * > 「[特殊技：追加攻击]为追加攻击，**每8秒最多可以发动一次**…发动时获得20点[登场值]」
 *
 * 循环：追加攻击 floor(有效战斗时间 / 8) 次 → 每次 +20 → 同时上限 120 ⇒
 * 登场技次数 = floor(登场值总量 / 100)（见 solveRobinEntry；120 对 20/100 这组整数不咬合）。
 * 登场技本体 = moveId 1661011（1.6s，**快速支援**语义），获得 Buff 强化点 ⇒ 下一次进离场守护时
 * 把防御提升再 ×1.25（ROBIN_BUFF_POINT_DEF_MULT）。
 *
 * ## 近似（有意，逐条写明）
 * - **满覆盖近似**：离场守护 80s / 追加攻击 10s CD / 护盾 15s 全不建状态机——追加攻击按 floor(t/10) 满打，
 *   防御提升按常驻上屏（原文「结束后仍保留 15 秒」⇒ 80s 守护 + 15s 尾巴，覆盖率本就近 1）。
 * - **Buff 强化点按满覆盖**：登场技每次 +1、进离场守护必消耗 1（上限 1）⇒ 循环稳态恒有 ⇒ ×1.25 常驻。
 * - 护盾量（3.4.1+19997538：离场技 2% / 追加攻击 4% / 强化追加攻击 6% 生命）、抗打断、无敌、
 *   「全队每毁伤回 15 能量」**不建**：前四者是生存面，
 *   最后一条需要跨角色毁伤计数通道（ModuleFeedback 现无该键），已记在 spec 的「明日实录」。
 *
 * ## 滑块
 * robin.buffPointActive（开关，缺省 1）：Buff 强化点是否常驻。0 = 白板离场守护（判据负控）。
 */
const ROBIN_AGENT_ID = '1661v1'

/** 离场守护·防御：门槛（知更鸟**初始最大生命值**，低于它整条不生效） */
export const ROBIN_DEF_HP_THRESHOLD = 16000
/** 离场守护·防御：每满多少点生命值加一档 */
export const ROBIN_DEF_HP_PER_STEP = 1000
/** 离场守护·防御：每档基础值 = 44 + 3 × 技能等级（Lv12 = 80） */
export const ROBIN_DEF_PER_STEP_BASE = 44
export const ROBIN_DEF_PER_STEP_PER_LEVEL = 3
/** 离场守护·防御：基础上限 = 440 + 30 × 技能等级（Lv12 = 800） */
export const ROBIN_DEF_CAP_BASE = 440
export const ROBIN_DEF_CAP_PER_LEVEL = 30
/** [Buff强化点]：使防御提升效果**及其上限**额外提升 25%（原文核心被动 Lv.7 末段） */
export const ROBIN_BUFF_POINT_DEF_MULT = 1.25
/**
 * 追加攻击 CD（秒）：原文「[特殊技：追加攻击]为追加攻击，**每10秒最多可以发动一次**」。
 * ⚠ 2026-10-30 随 nanoka 3.4.1+19997538 热更由 **8 → 10**（同批：离场守护 60s → 80s、
 *   追加攻击护盾 3% → 4%、强化追加攻击「按最大生命值」系数 0.214+0.028×Lv → 0.256+0.052×Lv、
 *   终结技护盾→生命转化 40% → 50%、[反制支援]成功额外 +1 [Buff强化点]）。CD 是**唯一进产行次数**的那条。
 */
export const ROBIN_AFTERSHOCK_CD_SECONDS = 10
/** 每次追加攻击获得的[登场值] */
export const ROBIN_ENTRY_PER_AFTERSHOCK = 20
/** [登场值]上限 */
export const ROBIN_ENTRY_MAX = 120
/** 触发[登场技]所需[登场值]（也是每次消耗量） */
export const ROBIN_ENTRY_COST = 100

/** 面板钩子侧的设置读口（默认值只来自 settings 声明；CC-508） */
const robinSetting = mechanicSettingPanelReader(() => robinMechanic.settings)

/** 技能等级基数：与 buff 公式通道 dynamicSkillLevel 同口径（12 + skillLevelBonus；此处取 12） */
const SKILL_LEVEL = 12

/**
 * 离场守护·防御提升量（纯函数；判据四臂见 robinGuard.test.ts）。
 *
 *   steps = max(0, floor((hp - 16000) / 1000))        // HP < 16000 ⇒ 0
 *   raw   = min(steps * (44 + 3*Lv), 440 + 30*Lv)      // Lv12: 每档 80 / 上限 800
 *   value = raw * (buffPoint ? 1.25 : 1)               // 只放大已生效的那部分
 *
 * ⚠ floor 是**整档**语义（原文「每多拥有1000点生命值」），余数不足一档不计；
 * ⚠ ×1.25 作用在**已被基础上限钳过**的 raw 上 = 原文「提升效果**与其上限**各 +25%」——
 *    等价于上限 800 → 1000（先乘后钳 800 会在高生命时少算）。
 */
export function robinGuardDefBonus(input: { hp: number; buffPointActive: boolean; skillLevel?: number }): number {
  const hp = Number(input.hp)
  if (!Number.isFinite(hp)) return 0
  const level = Number(input.skillLevel ?? SKILL_LEVEL)
  const steps = Math.max(0, Math.floor((hp - ROBIN_DEF_HP_THRESHOLD) / ROBIN_DEF_HP_PER_STEP))
  if (steps <= 0) return 0
  const perStep = ROBIN_DEF_PER_STEP_BASE + ROBIN_DEF_PER_STEP_PER_LEVEL * level
  const cap = ROBIN_DEF_CAP_BASE + ROBIN_DEF_CAP_PER_LEVEL * level
  const raw = Math.min(steps * perStep, cap)
  return raw * (input.buffPointActive ? ROBIN_BUFF_POINT_DEF_MULT : 1)
}

/**
 * 登场值 / 登场技循环（纯函数；buildExecutions 与判据共用，杜绝两处各算一份）。
 *
 * - 追加攻击次数 = floor(有效战斗时间 / 10)（满覆盖近似：离场守护 80s 覆盖整局，见文件头）；
 * - 登场值总量 = 追加次数 × 20；登场技次数 = floor(总量 / 100)；
 * - entryValue = 最后一次登场技之后**手里还剩的**登场值（展示用，0..120）。
 *
 * ⚠ 为什么不是「总量封 120」：120 是**同时持有**上限，不是整局总量（用户口径「追加上限120」+ 原文
 *   「最多可以拥有120点」）。每消耗 100 点后又能重新攒，故整局可用点数不受 120 钳制；
 *   floor(总量/100) 与逐轮循环在「+20 / 100」这组整数下逐位相同（5 次追加 = 1 次登场技、余 0；
 *   10s CD 下 5 次追击 = 50s）。
 */
export function solveRobinEntry(input: { combatTime: number; teammateFrontlineSeconds?: number }): {
  aftershockCount: number
  entryValue: number
  entrySkillCount: number
} {
  const time = Math.max(0, Number(input.combatTime) || 0)
  // 原文「**队伍中其他操作中的角色**发动任意攻击命中敌人时自动发动」⇒ 没有队友在场就一次都不触发。
  // 用 `teammateFrontlineSeconds`（Σ 队友前台秒）作判据：> 0 ⟺ 队里确有别的角色在场上打过。
  // 这条不是近似的额外假设——单角色队里知更鸟全程离场守护，没有任何人替她触发追击。
  const hasTeammates = Number(input.teammateFrontlineSeconds ?? 0) > 0
  const aftershockCount = hasTeammates ? Math.floor(time / ROBIN_AFTERSHOCK_CD_SECONDS) : 0
  const totalEntry = aftershockCount * ROBIN_ENTRY_PER_AFTERSHOCK
  const entrySkillCount = Math.floor(totalEntry / ROBIN_ENTRY_COST)
  const leftover = Math.max(0, totalEntry - entrySkillCount * ROBIN_ENTRY_COST)
  const entryValue = Math.min(ROBIN_ENTRY_MAX, leftover)
  return { aftershockCount, entryValue, entrySkillCount }
}

function buildRobinCharConfig({ cfg, skills }: AgentCharConfigInput): void {
  const all = skills.categories.flatMap(c => c.moves)
  const timeOf = (id: string) => Math.max(0, all.find(m => m.id === id)?.actionTime ?? 0)
  cfg.robinEntryActionTime = timeOf('1661011')
  cfg.robinAftershockDamage = getRowValue(all.find(m => m.id === '1661005'), 'damage')
  cfg.robinEntryDamage = getRowValue(all.find(m => m.id === '1661011'), 'damage')
  // 1661019 表值（不带 override ⇒ 由引擎按 fusedOf 回填也行，但显式预存让「表值变了」可见）
  cfg.robinCornerAssistDamage = getRowValue(all.find(m => m.id === '1661019'), 'damage')
  cfg.robinCornerAssistDaze = getRowValue(all.find(m => m.id === '1661019'), 'daze')
}

/** 资源结算读数（展示用）：登场技次数 + Buff 强化点稳态。与 buildExecutions 同源调 solveRobinEntry。 */
function buildRobinResourceResult({ cfg, state, teamFrontlineSeconds }: Pick<AgentResourceInput, 'cfg' | 'state' | 'teamFrontlineSeconds'>) {
  const entry = solveRobinEntry({ combatTime: effectiveCombatTime(state, cfg), teammateFrontlineSeconds: teamFrontlineSeconds })
  return {
    robinEntrySource: {
      aftershockCount: entry.aftershockCount,
      entryValue: entry.entryValue,
      entrySkillCount: entry.entrySkillCount,
      // Buff 强化点：登场技每次 +1、进离场守护必消耗 1（上限 1）⇒ 循环稳态恒有
      buffPointActive: entry.entrySkillCount > 0,
      // 队友反制支援次数（converge 相位 applyTeamConfig 写入）→ 1661019 触发次数
      teammateCounterAssists: Math.max(0, Math.floor(Number(cfg.robinTeammateCounterAssists ?? 0))),
    },
  }
}

/**
 * 资源卡分区（展示层）：登场值循环的读数与「离场守护防御」的口径说明。
 * 防御值本身不在这里算——它是面板项（teamPanelEffects），资源卡只解释口径与门槛。
 */
function buildRobinResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.robinEntrySource
  if (!source) return []
  return [
    {
      id: 'robin-entry',
      title: '知更鸟·登场值 / Buff 强化点',
      summary: `追击 ${fmt(source.aftershockCount)} 次 · 登场技 ${fmt(source.entrySkillCount)} 次 · 结余登场值 ${fmt(source.entryValue)}`,
      rows: [
        { label: `追加攻击（${ROBIN_AFTERSHOCK_CD_SECONDS}s CD）`, value: `${fmt(source.aftershockCount)} 次`, detail: '每次 +20 登场值（满覆盖近似：离场守护 80s 覆盖整局）' },
        { label: '登场值上限', value: `${fmt(ROBIN_ENTRY_MAX)}`, detail: '同时持有上限；每 100 点触发一次登场技，余量继续累积' },
        { label: '登场技（≥100 点）', value: `${fmt(source.entrySkillCount)} 次`, detail: '每次消耗 100 点 + 获得 1 个 Buff 强化点（快速支援语义，占前台）' },
        { label: 'Buff 强化点', value: source.buffPointActive ? '常驻' : '无', detail: '离场守护防御提升 ×1.25（上限同步 ×1.25）' },
        {
          label: '角力协同突击（1661019）',
          value: `${fmt(source.teammateCounterAssists)} 次`,
          detail: '触发 = 队伍中**其他**角色发动[反制支援]且[完美反制]（1:1）；自动发动 ⇒ 不占前台时间、不产喧响与秽盾',
        },
      ],
      footer: '离场守护·全队固定防御：每满 1000 点初始生命 +80（上限 800），门槛 16000，Buff 强化点 ×1.25；'
        + '护盾量 / 抗打断 / 每毁伤回 15 能量未建模（生存面 + 缺跨角色毁伤计数通道）。',
    },
  ]
}

/**
 * 队友反制支援次数 → 自己的 1661019 触发次数（converge 相位写入，供 buildExecutions 读）。
 *
 * 为什么读得到：`buildCharConfig` 已把每槽的 `counterAssistCount` 写进**各自**的 cfg
 * （`helpers.ts#buildCharConfig`），而 converge 派发递的是**同一批 cfg 对象**（实测三槽可见）。
 * 口径（原文）：「队伍中**其他**角色发动[反制支援]后，若触发[完美反制]自动发动」
 * ⇒ 只数别槽、不数自己；一次反制支援 = 整组化解 = 一次完美反制 ⇒ 1:1。
 */
function applyRobinTeamConfig({ slot, cfg, characters, phase }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  let teammateCount = 0
  for (const other of characters) {
    if (other.slot === slot) continue
    teammateCount += Math.max(0, Math.floor(Number(other.counterAssistCount) || 0))
  }
  cfg.robinTeammateCounterAssists = teammateCount
}

function buildRobinExecutions({ cfg, state, executions, teamFrontlineSeconds }: AgentResourceInput): void {
  const entry = solveRobinEntry({ combatTime: effectiveCombatTime(state, cfg), teammateFrontlineSeconds: teamFrontlineSeconds })
  // 追加攻击：离场守护期间队友命中触发，后台行（不占前台时间）
  if (entry.aftershockCount > 0) {
    executions.push(moduleExecRow({
      moveId: '1661005',
      moveName: `特殊技：追加攻击（离场守护·队友命中触发，${ROBIN_AFTERSHOCK_CD_SECONDS}s CD）`,
      category: 'special',
      count: entry.aftershockCount,
      damageMultiplier: Number(cfg.robinAftershockDamage ?? 0),
      ...RECOVERY_OFF,
      timeBucket: 'backstage',
      // CC-391 D1：CD 驱动的后台自动行（10s CD，不靠玩家放置）⇒ 轴模式按失衡时间占比吃易伤
      autoSplitByStun: true,
      skillTableNote: `满覆盖近似：floor(有效战斗时间/${ROBIN_AFTERSHOCK_CD_SECONDS})，每次 +20 登场值（同时上限 120）`,
    }))
  }
  // 支援突击·角力协同突击（1661019）：**队友**发动反制支援且完美反制时自动发动。
  // 3.4.1+19997538 起该行 decibel/ether 均为 0、actionTime = 0（自动触发段，不占前台、不产喧响与秽盾，
  // 与新包同批归零的 1661005/1661006 同性质）⇒ 只出伤害 + 失衡。
  const teammateCounter = Math.max(0, Math.floor(Number(cfg.robinTeammateCounterAssists ?? 0)))
  if (teammateCounter > 0) {
    executions.push(moduleExecRow({
      moveId: '1661019',
      moveName: '支援突击：角力协同突击（队友反制支援·完美反制后自动发动）',
      category: 'assist',
      count: teammateCounter,
      actionTime: 0,
      totalTime: 0,
      damageMultiplier: Number(cfg.robinCornerAssistDamage ?? 0),
      dazeMultiplier: Number(cfg.robinCornerAssistDaze ?? 0),
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
      skillTableNote: '触发 = 队伍中**其他**角色发动[反制支援]且触发[完美反制]（1:1）；自动发动，不占前台时间、不产喧响与秽盾',
    }))
  }
  // 登场技：≥100 登场值时被换入发动（快速支援语义），占前台
  if (entry.entrySkillCount > 0) {
    const t = Number(cfg.robinEntryActionTime ?? 0)
    executions.push(moduleExecRow({
      moveId: '1661011',
      moveName: '登场技：登场技（消耗 100 登场值，获 Buff 强化点）',
      category: 'assist',
      count: entry.entrySkillCount,
      actionTime: t,
      totalTime: entry.entrySkillCount * t,
      damageMultiplier: Number(cfg.robinEntryDamage ?? 0),
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
      skillTableNote: '登场技 = 快速支援 + 全队 4% 生命护盾（生存面不录）+ Buff 强化点（离场守护防御 ×1.25）；剩余登场值 ' + fmt(entry.entryValue),
      // ⚠ 3.4.1+19997538 新增：连携技 / 登场技 / 支援突击**发动后触发快速支援，1.5s 内换人自动释放[特殊技：离场]**
      //   ——是换人操作面的连续性，不改本模块的次数解（登场技仍按登场值 ≥100 触发）。
    }))
  }
}

/**
 * 离场守护·全队防御提升（**本模块唯一的伤害项写入点**）。
 *
 * 读**知更鸟自己的源面板局外生命**：sourcePanels 由派发器给出（AgentTeamPanelEffectInput，键 = 槽位号），
 * 与 calcPanel 的 sourcePanelsByOwner 同源同实例；源面板 = 角色自身配置、**不含队友 buff**，
 * 正是「初始最大生命值」的口径（outOfCombat 相位）。
 *
 * 写入走 **inCombatDefFlat 通道**（applyStat 的 CORE_STAT_BY_BONUS flat 分支）：
 * 最终 panel.def = base * (1 + Σpct) + Σflat，即「固定防御、不被局内百分比放大」。
 * 与其它 teamPanelEffects 一样必须是**可交换加法**——flat 累加天然满足。
 */
function applyRobinTeamPanelEffects({ slot, agent, panel, settings, sourcePanels, report }: AgentTeamPanelEffectInput): void {
  if (agent.id !== ROBIN_AGENT_ID) return
  const hp = outOfCombatStat(panelOfSlot(sourcePanels, slot, 'outOfCombat'), 'hp')
  const buffPointActive = robinSetting(settings, 'robin.buffPointActive') > 0
  const bonus = robinGuardDefBonus({ hp, buffPointActive })
  if (!(bonus > 0)) return
  applyStat(panel, 'inCombatDefFlat', bonus, 'flat')
  report?.({ stat: 'inCombatDefFlat', value: bonus, mode: 'flat' })
}

export const robinMechanic: AgentMechanicModule = {
  id: 'agent:1661v1',
  agentIds: [ROBIN_AGENT_ID],
  name: '知更鸟',
  description: 'v1 占位包（3.4.1+19997538 热更）：离场守护·全队固定防御（每 1000 初始生命 +80 / 上限 800 / Buff 点 ×1.25）'
    + ' + 登场值循环（追加攻击 10s CD +20 / 上限 120 / ≥100 触发登场技）；护盾量与「每毁伤回 15 能量」未建模。',
  teamPanelEffects: applyRobinTeamPanelEffects,
  applyTeamConfig: applyRobinTeamConfig,
  // 1661019 已有模块行（队友反制支援触发）⇒ 轴编辑器不得再把它当 [表] 直读候选（会双计）
  axisHiddenMoves: ['1661019'],
  buildCharConfig: buildRobinCharConfig,
  buildExecutions: buildRobinExecutions,
  buildResourceResult: buildRobinResourceResult,
  resourceSections: buildRobinResourceSections,
  settings: [
    {
      id: 'robin.buffPointActive',
      label: '知更鸟｜Buff 强化点常驻（离场守护防御 ×1.25）',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      description: '登场技每循环获得 1 个[Buff强化点]、进离场守护必消耗 1 个（上限 1）⇒ 循环稳态恒有。'
        + '置 0 = 白板离场守护（判据负控 / 配装未堆生命时看基础值）。',
    },
  ],
}

/**
 * D2：本模块私有的 cfg 字段（只有本文件读写；仍是 CharacterOperationConfig 的成员，纯类型零运行时）。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /**
     * 本局**队友**发动[反制支援]的次数（converge 相位由 applyTeamConfig 写入）。
     * 用途 = 1661019「支援突击：角力协同突击」的触发次数：原文
     * 「队伍中**其他**角色发动[反制支援]后，若触发[完美反制]自动发动」——**不含她自己**发动的那几次。
     */
    robinTeammateCounterAssists?: number
    /** 登场技 1661011 动作时长（buildCharConfig 预存） */
    robinEntryActionTime?: number
    /** 追加攻击表值倍率（1661005 damage） */
    robinAftershockDamage?: number
    /** 登场技表值倍率（1661011 damage） */
    robinEntryDamage?: number
    /** 支援突击·角力协同突击表值（1661019 damage / daze） */
    robinCornerAssistDamage?: number
    robinCornerAssistDaze?: number
  }
}

declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 知更鸟登场值 / Buff 强化点循环读数（buildResourceResult 写、展示层读） */
    robinEntrySource?: {
      aftershockCount: number
      entryValue: number
      entrySkillCount: number
      buffPointActive: boolean
      /** 队友反制支援次数 = 角力协同突击 1661019 的触发次数（只数别槽，不含自己） */
      teammateCounterAssists: number
    }
  }
}
