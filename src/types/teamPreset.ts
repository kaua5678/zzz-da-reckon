/** 预设队伍对比（危局决策层）：队伍 × 加金顺序 × Boss × 当期 buff → 难度/伤害散点 */

/**
 * 加金步骤：一步 = 一个角色 +1 影画，一把音擎 +1 精炼，或一把音擎本体（都算金，UI 直接显示 label 消除歧义）。
 * 音擎本体获取：kind='wengine' 且带 wEngineId = 装备该音擎（1 限定金，value 固定 1，精炼从 1 起步）。
 * 例：00 卢西娅 4 限定金 = 3 角色本体 + 铸梦炉歌本体 → [{label:"卢西娅 专武（本体）",slot:2,kind:"wengine",value:1,wEngineId:"14145"}]。
 */
export interface GoldStep {
  /** 展示名（如 "主C 1命"、"专武精炼2"、"卢西娅 专武（本体）"），直接显示不做歧义 */
  label: string
  /** 目标槽位 0-2 */
  slot: number
  /** cinema=影画 / wengine=音擎（带 wEngineId = 本体获取；不带 = 精炼） */
  kind: 'cinema' | 'wengine'
  /** 目标值：cinema 0-6 / wengine 1-5（精炼1=本体，不算金，默认态；获取步固定 1） */
  value: number
  /** 音擎获取步：要装备的音擎 id（精炼步不带此字段） */
  wEngineId?: string
}

/**
 * 交互条目：一种操作类型及其次数（决定横轴难度，预设队伍手填固定值）。
 * 内置类型：parry(弹刀) / dodge(闪避反击) / quickAssist(快速支援)。
 * 角色专属交互用自定义 type（如 banyueGoldenParry 般岳金身弹刀），
 * 难度权重查 INTERACTION_WEIGHTS，条目可 weight 覆盖。
 */
export interface InteractionItem {
  type: string
  /** 次数 */
  count: number
  /** 难度权重覆盖（缺省按类型查 INTERACTION_WEIGHTS，未知类型=1） */
  weight?: number
  /** 作用于哪个槽位（缺省 0=主C） */
  slot?: number
  /** 显示名（缺省查 INTERACTION_LABELS，再 fallback type） */
  label?: string
}

/** 预设队伍驱动盘模板（缺省整块用空，走角色默认推荐） */
export interface TeamPresetDriveDisc {
  fourPieceSetId: string
  twoPieceSetId: string
  /** 主词条（槽位 → statId），缺省按角色推荐 */
  mainStats?: Record<number, string>
  /** 副词条分配（词条数），缺省默认 */
  subStatAllocation?: Record<string, number>
}

/**
 * 预设队伍的难度/玩法变体（队伍分类）：同一队伍不同操作难度档（如「5嗔火10大」vs「普通轴」），
 * 加载时展开成独立预设条目（id = `${队伍id}__${变体id}`，名 = `${队伍名}·${变体名}`），
 * 在队伍对比页作为两个点列分开对比。队伍本体带 variants 后，未分类的基础条目不再出现。
 */
export interface TeamPresetVariant {
  /** 变体 id 后缀（英文 kebab） */
  id: string
  /** 展示名（如 "5嗔火10大"、"普通轴"） */
  name: string
  /** 说明/备注（追加到预设 note，写该难度的达成条件，如「5 次嗔火 + 好评≥390」） */
  note?: string
  /** 该难度的交互清单（缺省沿用预设本体 interactions；决定横轴难度 + 映射引擎参数） */
  interactions?: InteractionItem[]
  /** 绑定失衡轴预设 id（src/data/stunAxisPresets 里的 preset id；缺省 = 不绑定，走自动匹配/用户轴）。
   *  对比计算时优先用该轴（固定 axes 或条件 plans 均可），保证难度档与轴一一对应。 */
  stunAxisPresetId?: string
  /** 该难度存在的最低总限定金（低于此金数不生成对比点；表达「配置要求」，如 5嗔火10大 需琉音回能足够高） */
  minGold?: number
}

/** 预设队伍 */
export interface TeamPreset {
  /** 唯一 id（英文 kebab） */
  id: string
  /** 展示名 */
  name: string
  /** 说明/备注 */
  note?: string
  /** 队伍：按槽位 0/1/2 的 agentId，须三项齐全 */
  team: [string, string, string]
  /** 各槽位基础音擎 id（缺省 '' = 自动推荐）。基础音擎 = 0 金档的配装：常驻/A 音擎不计限定金；
   *  限定专武作为「音擎本体」加金步（见 GoldStep.wEngineId），从基础音擎往上买。 */
  wEngines?: [string, string, string]
  /** 各槽位驱动盘模板（缺省 = 自动推荐） */
  driveDiscs?: [TeamPresetDriveDisc, TeamPresetDriveDisc, TeamPresetDriveDisc]
  /** 加金顺序：从基础金（限定角色 0 命 + 精炼1）开始，按序应用前 N 步；每步 = 1 限定金 */
  goldSteps: GoldStep[]
  /**
   * 常驻角色步进（可选）：给队伍里的常驻 S / 非限定角色的命座、精炼，不占限定金。
   * 口径：预设默认全量应用（即预设自带的常驻配置）；想改就改这个数组，改完重跑一次对比即可。
   * 示例：莱卡恩 1命 → [{ "label": "莱卡恩 1命", "slot": 1, "kind": "cinema", "value": 1 }]
   */
  standardSteps?: GoldStep[]
  /** 交互清单（手填固定值，决定横轴难度） */
  interactions: InteractionItem[]
  /** 每次失衡的连携次数（per-slot，缺省按角色推荐） */
  chainCountPerStun?: [number, number, number]
  /** 平A时间分配权重（per-slot，缺省按角色推荐） */
  basicAttackTimeWeight?: [number, number, number]
  /** 难度/玩法变体（队伍分类）：有此字段时加载展开成多个条目，本条目本身不再出现 */
  variants?: TeamPresetVariant[]
  /** 绑定失衡轴预设 id（缺省不绑定；变体可各自覆盖，见 TeamPresetVariant.stunAxisPresetId） */
  stunAxisPresetId?: string
  /** 该预设存在的最低总限定金（低于此金数不生成对比点；变体可覆盖） */
  minGold?: number
  /** 展开标记：本条目由哪个源预设展开而来（仅加载器写入；保存回写 goldSteps 时重定向到源文件） */
  variantOf?: string
}

/** 一个计算点（散点图上的点） */
export interface TeamComparePoint {
  presetId: string
  presetName: string
  /** 金数 = 总限定金（常驻角色/非限定音擎不计） */
  goldCount: number
  /** 金数明细（如 "6金：主C1命 + 卢西娅1命"） */
  goldLabel: string
  /** 常驻配置明细（如 "莱卡恩1命"，无常驻步进为空） */
  standardGoldLabel?: string
  /** 各槽位最终影画（含常驻步进） */
  cinemas: [number, number, number]
  /** 各槽位最终音擎精炼（含常驻步进） */
  wengineMods: [number, number, number]
  /** 横轴：难度 = Σ(count × weight) */
  difficulty: number
  /** 难度明细（如 "弹刀8×1.0 + 闪避4×1.2"） */
  difficultyDetail: string
  /** 交互清单（原始） */
  interactions: InteractionItem[]
  /** 总伤害 */
  damage: number
  /** 伤害/血量 × 100%（100 = 击杀，200 = 两倍血量） */
  hpRatio: number
  /** Boss 血量 */
  bossHp: number
  /** 应用的当期 buff 牌标题（无 buff 为空） */
  buffTitle?: string
  /** 全局时间是否超过可用时间（轴内动作 + 交互 + Boss 无敌 > battleTime，标记可行性低） */
  timeExceeded: boolean
  /** 时间明细（如 "轴时间 42.3s + 交互 18.5s + 无敌 0s = 60.8s / 180s"） */
  timeDetail: string
}

/** 内置交互类型 → 难度权重（条目可 weight 覆盖；未知类型默认 1） */
export const INTERACTION_WEIGHTS: Record<string, number> = {
  parry: 1.0, // 弹刀
  dodge: 1.2, // 闪避反击
  quickAssist: 0.6, // 快速支援
  block: 1.0, // 格挡（星徽·比利动力压制期间格挡等）
  banyueGoldenParry: 1.5, // 般岳金身弹刀（角色专属交互示例）
  banyueDualCounter: 2.0, // 般岳双反（完美闪避+金身弹刀组合，一次攻击吃两下交互）
  tauntCancel: 0, // 嘲讽取消（般岳失衡外连段末尾后摇取消；配置类交互，不计难度）
}
