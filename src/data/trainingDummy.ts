/**
 * 「自由训练模式」木桩 = 分析页「怪物」下拉里的**中性选项**（用户 2026-11-10：「队伍对比之类的地方，怪物选择默认木桩」）。
 *
 * ## 为什么要有这个文件
 * 分析页的「怪物」统一走 `BossPreset` 契约（`composables/bossRoom#applyBossRoom`）。木桩不是任何一期关卡，
 * 但要让队伍对比 / 交互扫描这些页面**默认**落在中性场上（不携带任何一期的血量/抗性/弱点/关卡 buff），
 * 就得把它表达成同一个契约——**不是**给每个页面手写「不选 Boss 时」的分支（那会让同一份默认值有 N 份）。
 *
 * ## 数值单一事实源
 * 木桩九项（血量/失衡/防御/等级/异常系数/失衡易伤/失衡时间/战斗时间/体型）只在这里写一次；
 * `stores/config.ts#defaultEnemy`（不选 Boss 时的产品默认）与 `TRAINING_DUMMY_BOSS`（分析页的怪物选项）
 * 都读它。判据 `src/data/__tests__/trainingDummyBoss.test.ts` 断言两边逐字段一致 + 与用户附图数字一致。
 *
 * ## 进房间时**不复用** `applyBossPreset` 的取整
 * `applyBossPreset` 会把 hp/defense 取整（真实 Boss 数据本来就是整数），木桩的防御是 952.8
 * ⇒ 走那条路会变成 953，与「不选 Boss」的默认值差 0.2。所以 `applyBossRoom` 对木桩走
 * `configStore.applyDefaultEnemy()`（= 直接落 `defaultEnemy()` 的同一份对象），两条入口逐字段相等。
 */
import type { BossPreset } from '@/types/bossPreset'
import type { ResistanceTable } from '@/utils/enemyDebuffStats'

// @fact ui:分析页默认怪物 口径: 队伍对比 / 自由对比 / 交互扫描的「怪物」下拉 = 训练木桩 + 真实 Boss，默认选训练木桩（中性测试场：不带任何一期的血量/抗性/弱点/关卡 buff）；进房间走 bossRoom#applyBossRoom 的木桩分支直接落产品默认敌人，不复用 applyBossPreset 的取整 | 据 用户@2026-11-10「队伍对比之类的地方，怪物选择默认木桩」 | 验 src/data/__tests__/trainingDummyBoss.test.ts | 锚 src/data/trainingDummy.ts#TRAINING_DUMMY_BOSS | 信 确认
// ⟳复核: 游戏换训练场数值 / 新增带怪物下拉的分析页时，重核木桩九项与「新页面是否也默认木桩」 | 到期 2027-05-31
/** 木桩核心数值（单一事实源；改动会同时影响「默认敌人」与「怪物下拉里的木桩」） */
export const TRAINING_DUMMY_VALUES = {
  /** Total HP（用户 2026-10-26 附图 Free Training Mode） */
  hp: 3347325000,
  /** Daze */
  stunValue: 17582.7,
  /** DEF（比真实 Boss 少一位小数取整，所以下面进房间不走取整路径） */
  defense: 952.8,
  level: 70,
  /** Base Buildup 3750 / 本仓起始管 3000 */
  anomalyCoeff: 1.25,
  /** 木桩不在危局 ⇒ 没有 +10% 属性浸染 */
  bossAnomalyCoeff: 1,
  /** 失衡伤害倍率 / 失衡持续时间 */
  stunVuln: 1.5,
  stunTime: 12,
  /** 危局/训练场固定 180s */
  battleTime: 180,
  bodySize: 'large',
} as const

/** 三张全 0 的抗性表（木桩「无抗性 / 无弱点」） */
export function zeroResistances(): ResistanceTable {
  return { physical: 0, fire: 0, ice: 0, electric: 0, ether: 0, wind: 0 }
}

/** 木桩在「怪物」下拉里的 id（不是 nanoka 怪物 id，只有本仓内部使用） */
export const TRAINING_DUMMY_BOSS_ID = 'training-dummy'
/** 木桩唯一的「期数」= 无关卡（页面把期数当一维轴时要有值可落） */
export const TRAINING_DUMMY_PHASE_ID = 'training-dummy'

export function isTrainingDummyBoss(id: string | null | undefined): boolean {
  return id === TRAINING_DUMMY_BOSS_ID
}

/**
 * 木桩的 `BossPreset` 形态（只用于「选怪物」这一层：血量/失衡/防御给 UI 与 hp% 用）。
 * 进房间时 `applyBossRoom` 会识别它是木桩并直接落产品默认敌人（见上方 §进房间）。
 */
export const TRAINING_DUMMY_BOSS: BossPreset = {
  id: TRAINING_DUMMY_BOSS_ID,
  catalogId: null,
  name: '训练木桩',
  nameEn: 'Training Dummy',
  aliases: ['木桩', '自由训练模式', 'Free Training Mode'],
  icon: null,
  iconSource: null,
  isCriticalAssault: false,
  bodySize: TRAINING_DUMMY_VALUES.bodySize,
  monster: {
    stunVuln: TRAINING_DUMMY_VALUES.stunVuln,
    stunTime: TRAINING_DUMMY_VALUES.stunTime,
    name: '训练木桩',
  },
  defaults: {
    battleTime: TRAINING_DUMMY_VALUES.battleTime,
    shieldCount: 0,
    energyShield: 0,
    invincibleTime: 0,
  },
  phases: [
    {
      phaseId: TRAINING_DUMMY_PHASE_ID,
      zoneKey: TRAINING_DUMMY_PHASE_ID,
      version: '—',
      label: '训练木桩（无关卡）',
      begin: '',
      modeType: 'defense',
      stageName: '自由训练模式',
      stageNum: 0,
      level: TRAINING_DUMMY_VALUES.level,
      hp: TRAINING_DUMMY_VALUES.hp,
      stunValue: TRAINING_DUMMY_VALUES.stunValue,
      defense: TRAINING_DUMMY_VALUES.defense,
      bossAnomalyCoeff: TRAINING_DUMMY_VALUES.bossAnomalyCoeff,
      damageResistances: zeroResistances(),
      stunResistances: zeroResistances(),
      anomalyResistances: zeroResistances(),
      weakness: [],
      resistance: [],
    },
  ],
}

/** 在真实 Boss 列表前面插木桩（页面「怪物」下拉的统一入口；幂等，重复调用不会插两次） */
export function withTrainingDummy<T extends { id: string }>(bosses: readonly T[]): (T | BossPreset)[] {
  return bosses.some(b => b.id === TRAINING_DUMMY_BOSS_ID) ? [...bosses] : [TRAINING_DUMMY_BOSS, ...bosses]
}
