/**
 * 界面态 Store（CC-356，2026-10-02 arena-E r386）：当前页签、队伍配置页选中的槽位、实战对比页最近一次部署、记录小窗。
 *
 * 从 config store 搬出来的原因：它们**不是计算输入**。住在 config 里时，calcOutput 记忆化键要特判排除
 * （原 `CALC_MEMO_KEY_EXCLUDE`）、独立分析场景的出生态要白白复制、`$state` 快照（难度曲线会话缓存键）
 * 会因切槽而失配。搬走后 config `$state` = 全部计算输入，记忆化键直接取整个 `$state`。
 *
 * 规则：引擎 / 管线 / 分析器不得读本 store（槽位要作为参数传进去）；新的纯界面态放这里，不放 config。
 *
 * ## 记录小窗的界面态（2026-10-09）
 * 小窗的开关 / 位置 / 收起 / 勾选指标都是**纯界面态**，一律住这里，理由同上（进 config 会让
 * 每次拖动/勾选都让 calcOutput 记忆化键失效 ⇒ 全量重算）。其中三项走 `persistedRef`
 * （页面级 localStorage ref 的唯一写法）持久化：开关、位置、勾选指标——刷新后小窗该还在原处。
 * **收起状态刻意不持久化**（刷新即展开：收起是临时动作，不该让用户下次打开以为小窗没了）。
 *
 * @fact ui:记录小窗/界面态归属 口径: 小窗开关/位置/收起/勾选指标住 stores/ui.ts（界面态），不进 config store——config.$state 是 calcOutput 记忆化键，进键字段一变就全量重算；开关/位置/勾选三项经 persistedRef 持久化，收起状态不持久化 | 据 用户@2026-10-09·口径=「设置里给一个开关，开启后常驻」 | 验 src/composables/__tests__/recordWindow.test.ts | 锚 src/stores/ui.ts#useUiStore | 信 确认
 * ⟳复核: 若 config.$state 不再是 calcOutput 记忆化键、或界面态迁出本 store，复核「小窗界面态不进 config」这条归属 | 到期 2026-12-31
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { persistedRef } from '@/composables/persistedRef'
import { DEFAULT_PICKS, normalizePicks, type MetricPick } from '@/composables/recordWindow'
import type { ArchiveRun, DeployConfig } from '@/composables/runArchiveImport'

/** localStorage 键（改键名 = 用户旧设置丢失，故集中在这里、带版本后缀） */
export const RECORD_WINDOW_OPEN_KEY = 'zzz-record-window:open:v1'
export const RECORD_WINDOW_POS_KEY = 'zzz-record-window:pos:v1'
export const RECORD_WINDOW_PICKS_KEY = 'zzz-record-window:picks:v1'

/** 归一化位置：越界/非法一律回落右下角（0.78, 0.62）——窗口缩到比小窗还小时也不会跑到屏外 */
function parsePos(raw: unknown): { x: number; y: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  // unknown 入参用 `in` + typeof 收窄（判据 27：不在用处另写类型字面量）
  if (!('x' in raw) || !('y' in raw)) return undefined
  const { x, y } = raw
  if (typeof x !== 'number' || typeof y !== 'number') return undefined
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
}

const DEFAULT_POS = { x: 0.78, y: 0.62 }

export const useUiStore = defineStore('ui', () => {
  /** 当前页签（AppHeader 切换、CalculatorView 按它渲染页面） */
  const activeTab = ref<string>('team')
  /** 队伍配置页 / 调试页当前编辑的槽位 */
  const selectedSlot = ref<number>(0)

  function selectSlot(slot: number) {
    selectedSlot.value = slot
  }

  // ========== 实战对比页的部署态（2026-10-29） ==========

  /**
   * 最近一次「部署」的归档 run + 它的部署配置。
   *
   * 为什么住这里：页面由 `CalculatorView` 的 `<component :is="currentPage" />` 渲染，**切页签 = 卸载重挂**
   * ⇒ 原来的页面局部 ref（selected / lastWarnings / lastDeploy）一切页就被清空，切回来只剩空态
   * （用户 2026-10-29 实报「点了部署，切页再回来他就消失了」）。而 configStore 里部署写下的东西
   * （队伍 / Boss 房间 / layer-buff 行）**都还在** ⇒ 两边各说各话。
   *
   * 为什么**不**进 config store：它不是计算输入（`$state` = 计算输入 = calcOutput 记忆化键，进键就白重算一次全网）。
   * 为什么存 run + deploy 而不是只存 run id：页面的期视图 / Boss 预设是异步加载的，只存 id 就得等数据到齐再重算
   * `submissionToDeploy`，重挂首帧会闪一次空态；存下来的 deploy 与部署那一刻逐位相同，回放不会漂。
   *
   * @fact ui:实战对比页/部署态归属 口径: 最近一次部署（run + DeployConfig）住 stores/ui.ts，不进 config store（它不是计算输入）、也不留在页面局部 ref（页面切页签即卸载重挂，局部 ref 会被清空） | 据 用户实报@2026-10-29 | 验 src/views/__tests__/archiveDeployUiState.test.ts | 锚 src/stores/ui.ts#useUiStore | 信 确认
   * ⟳复核: 若 CalculatorView 改成 keep-alive（页面不再重挂）或部署态改为可持久化（刷新后还在），复核「部署态住 ui store 且不持久化」这条归属 | 到期 2027-01-31
   */
  const archiveDeploy = ref<{ run: ArchiveRun; deploy: DeployConfig } | null>(null)

  /** 记下一次部署（实战对比页「部署」按钮唯一写入口） */
  function setArchiveDeploy(run: ArchiveRun, deploy: DeployConfig) {
    archiveDeploy.value = { run, deploy }
  }

  // ========== 记录小窗（界面态，见文件头注释） ==========

  /** 设置里的开关：打开后小窗常驻（跨页签） */
  const recordWindowOpen = persistedRef<boolean>(
    RECORD_WINDOW_OPEN_KEY,
    raw => (typeof raw === 'boolean' ? raw : undefined),
    () => false,
  )
  /** 悬浮位置（归一化 0..1，相对「可用区域」= 视口 − 窗口尺寸） */
  const recordWindowPos = persistedRef<{ x: number; y: number }>(
    RECORD_WINDOW_POS_KEY,
    parsePos,
    () => ({ ...DEFAULT_POS }),
  )
  /** 勾选的读数行（指标 × 分量） */
  const recordWindowPicks = persistedRef<MetricPick[]>(
    RECORD_WINDOW_PICKS_KEY,
    raw => normalizePicks(raw),
    () => [...DEFAULT_PICKS],
  )
  /** 收起（只留标题条）；不持久化——刷新即展开 */
  const recordWindowCollapsed = ref(false)

  /** 设置面板里的「显示 N 项」：勾选数与去重后的实际行数一致（normalizePicks 已去重） */
  const recordWindowPickCount = computed(() => recordWindowPicks.value.length)

  /** 勾选/取消一行读数（设置面板用）。取消最后一行会被忽略——空窗分不清「筛没了」还是「没数据」 */
  function toggleRecordPick(metricId: string, slot: string) {
    const idx = recordWindowPicks.value.findIndex(p => p.metricId === metricId && p.slot === slot)
    if (idx >= 0) {
      if (recordWindowPicks.value.length <= 1) return
      recordWindowPicks.value.splice(idx, 1)
      return
    }
    recordWindowPicks.value.push({ metricId, slot })
  }

  /** 是否已勾选（设置面板的 checkbox 状态） */
  function hasRecordPick(metricId: string, slot: string): boolean {
    return recordWindowPicks.value.some(p => p.metricId === metricId && p.slot === slot)
  }

  /** 恢复默认勾选（出厂读数清单，与「记忆」无关） */
  function resetRecordPicks() {
    recordWindowPicks.value = [...DEFAULT_PICKS]
  }

  return {
    activeTab, selectedSlot, selectSlot,
    archiveDeploy, setArchiveDeploy,
    recordWindowOpen, recordWindowPos, recordWindowPicks, recordWindowCollapsed,
    recordWindowPickCount, toggleRecordPick, hasRecordPick, resetRecordPicks,
  }
})
