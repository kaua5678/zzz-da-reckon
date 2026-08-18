/** Boss 预设（public/static/boss-presets.json，由 scripts/import-nanoka-bosses.mjs 生成） */

export interface BossPresetPhase {
  /** nanoka 期数 id（如 690471） */
  phaseId: string
  /** 关卡 key（如 69047201） */
  zoneKey: string
  /** 版本号（如 3.2；version.json 未收录时兜底） */
  version: string
  /** 期数标签：版本 · 开始日期 */
  label: string
  /** 开始日期（YYYY-MM-DD HH:mm:ss） */
  begin: string
  /** critical_assault = 危局强袭战(异构) / defense = 防卫战·试炼 */
  modeType: 'critical_assault' | 'defense'
  /** 关卡中文名 */
  stageName: string
  stageNum: number
  level: number
  hp: number
  stunValue: number
  defense: number
  /** 异常条系数 = 1 + attribute_infliction/100（危局 = 1.1） */
  bossAnomalyCoeff: number
  damageResistances: Record<string, number>
  stunResistances: Record<string, number>
  anomalyResistances: Record<string, number>
  /** 弱点/抗性元素中文标签 */
  weakness: string[]
  resistance: string[]
  goals?: { s?: number; a?: number; b?: number }
}

/** 怪物本体固有属性（不随期数变，来自 nanoka zh/monster/<id>.json） */
export interface BossPresetMonster {
  /** 失衡伤害倍率 = (100 + stun_damage_taken_ratio/100)/100（1.5 / 1.25） */
  stunVuln: number
  /** 失衡持续时间(s) = 10000 / destroy_recover_rate（12 / 15.02） */
  stunTime: number
  /** 怪物中文名 */
  name: string
}

/** 应用时随预设加载的默认值（手动维护：危局固定 180s；秽盾/能量盾按 Boss 手填） */
export interface BossPresetDefaults {
  /** 战斗时间（危局强袭战固定 180s） */
  battleTime: number
  /** 秽盾数量（如 名可名 1） */
  shieldCount: number
  /** 能量盾数量（默认 0） */
  energyShield: number
  /** Boss 无敌不可攻击时间（秒，如秽盾/转阶段动画；缺省 0，当前端数据不全时留空） */
  invincibleTime?: number
}

export interface BossPreset {
  /** nanoka 怪物 id（如 40009） */
  id: string
  /** catalog.json bosses 对应 id（无则空） */
  catalogId?: string | null
  /** 中文名 */
  name: string
  nameEn: string
  aliases: string[]
  /** 本地图标路径（无图则 null） */
  icon: string | null
  iconSource: string | null
  /** 是否危局强袭战异构 Boss */
  isCriticalAssault: boolean
  /** 怪物本体固有属性（失衡倍率/失衡时间） */
  monster: BossPresetMonster
  /** 应用时加载的默认值（战斗时间/秽盾/能量盾） */
  defaults: BossPresetDefaults
  /** 出现过的期数（新的在前） */
  phases: BossPresetPhase[]
}

export interface BossPresetFile {
  generatedAt: string
  source: string
  note: string
  bosses: BossPreset[]
  /** 期视图：按期数 + 普通/困难分组 + 当期 buff（Boss 选择 UI 用） */
  phaseViews?: PhaseView[]
}

// ========== 期视图（Boss 选择 UI） ==========

/** 当期 buff 牌（scripts/phase-buff-parser.mjs 解析结果） */
export interface PhaseBuffCard {
  title: string
  /** (Test1)TBD 测试服占位：不参与解析/推荐 */
  testOnly: boolean
  /** 解析出的效果（stat 为引擎字段，兼容 GlobalBuffRow） */
  effects: PhaseBuffEffect[]
  /** 未命中规则表的原文段落（UI 展示，用户可手动补全局 Buff） */
  unparsed: string[]
}

export interface PhaseBuffEffect {
  /** 引擎字段名（critDmg / iceDmg / stunDmgMultiplierBonus …） */
  stat: string
  value: number
  /** 招式限定（basic/exSpecial/ultimate/chain…） */
  targetSkillType?: string
  /** 条件：异常特性 2/3 名分档 / 特性限定 */
  cond?: {
    /** [2名档, 3名档]；应用时按队伍实际异常人数选档 */
    anomalyCount?: [number, number]
    /** 强攻/异常/击破/命破…限定；队伍无该特性角色则该条不生效 */
    specialty?: string
  }
  /** 原文段落（溯源） */
  note?: string
}

/** 当期 Boss 简览（困难/普通都是危局强袭战：一期 = 1 困难 + 3 普通） */
export interface PhaseBossBrief {
  presetId?: string
  /** 关卡 key（用于定位预设 phase，应用时用） */
  zoneKey?: string
  monsterId: string
  name: string
  weakness: string[]
  resistance: string[]
  hp: number
  stunValue: number
  defense: number
  level: number
  bossAnomalyCoeff?: number
  stageName?: string
  stageNum?: number
  /** 当期关卡固有 buff（layer_buff 解析结果，应用 Boss 时写入全局 Buff 表） */
  bossBuffs?: PhaseBuffCard[]
}

export interface PhaseView {
  phaseId: string
  version: string
  label: string
  begin: string
  end: string
  /** 困难模式（危局强袭战，1 个 Boss，可应用） */
  criticalAssault: PhaseBossBrief | null
  /** 普通模式（防卫战·试炼，3 个 Boss，只读） */
  defense: PhaseBossBrief[]
  /** 当期危局可选 buff 牌（3 张） */
  buffs: PhaseBuffCard[]
}
