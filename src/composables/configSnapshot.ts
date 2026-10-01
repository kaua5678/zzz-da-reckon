/**
 * 分析器「现场快照 / 恢复」唯一实现（CC-251）。
 *
 * 用途：队伍对比 / 难度曲线 / 自由对比 / 时间线 / 胶片 / 位置对比等分析器会反复把别的队伍写进 configStore 跑管线；
 * 进函数先 `snapshotStore`，`try/finally` 里 `restoreStore`，跑完不留痕。TeamComparePage 还拿快照当会话缓存键。
 *
 * 快照范围 = 分析器会改写的全部 store 状态：team / enemy / appliedBoss / 失衡轴 / 全局 buff / **队友 buff 选择**。
 * 队友 buff 选择必须在 team 之后恢复：`team.splice` 会触发 team watcher（flush:'sync'）→ syncTeammateBuffsFromTeam
 * 按派生结果改写 enabled，覆盖掉用户手动开关（CC-251 修前 teamCompare / teamTimelineStore 两份副本漏了这一项，
 * 只有 positionCompare 的私有副本是对的）。
 * CC-340：appliedBoss 改为 clone 深拷贝（防 syncBossInteractionPlan 就地改写 parryTotal 污染快照），
 * 并把 mechanicSettings 与 timeWeightStrategy 纳入快照（防 applyBossPreset 自动写 guarantee.stun=1 泄漏到用户现场）。
 */
import { type useConfigStore, type CharacterConfig, type EnemyConfig, type GlobalBuffRow, type StunAxisState } from '@/stores/config'

type ConfigStore = ReturnType<typeof useConfigStore>
type TeammateBuffSelections = Record<string, { enabled: boolean; coverage: number }>

export interface StoreSnapshot extends StunAxisState {
  team: CharacterConfig[]
  enemy: EnemyConfig
  appliedBoss: ConfigStore['appliedBoss']
  globalBuffs: GlobalBuffRow[]
  buffSelections: TeammateBuffSelections
  mechanicSettings: Record<string, number>
  timeWeightStrategy: ConfigStore['timeWeightStrategy']
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export function snapshotStore(configStore: ConfigStore): StoreSnapshot {
  return {
    team: clone(configStore.team),
    enemy: clone(configStore.enemy),
    appliedBoss: clone(configStore.appliedBoss),
    ...configStore.getAxisState(),
    globalBuffs: clone(configStore.globalBuffs),
    buffSelections: clone(configStore.teammateBuffSelections as TeammateBuffSelections),
    mechanicSettings: { ...configStore.mechanicSettings },
    timeWeightStrategy: configStore.timeWeightStrategy,
  }
}

export function restoreStore(configStore: ConfigStore, snap: StoreSnapshot): void {
  configStore.team.splice(0, configStore.team.length, ...snap.team)
  configStore.setEnemy(snap.enemy)
  configStore.appliedBoss = clone(snap.appliedBoss)
  configStore.setAxisState(snap)
  configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...clone(snap.globalBuffs))
  // 必须在 team 之后：team.splice 已同步触发 sync 改写 enabled，这里整表覆盖回快照
  const selections = configStore.teammateBuffSelections as TeammateBuffSelections
  for (const key of Object.keys(selections)) delete selections[key]
  Object.assign(selections, clone(snap.buffSelections))
  for (const key of Object.keys(configStore.mechanicSettings)) delete configStore.mechanicSettings[key]
  Object.assign(configStore.mechanicSettings, snap.mechanicSettings)
  configStore.timeWeightStrategy = snap.timeWeightStrategy
}
