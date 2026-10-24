<template>
  <n-modal
    v-model:show="show"
    preset="card"
    title="设置"
    class="settings-dialog"
    style="width: 860px; max-width: 95vw"
  >
    <n-tabs v-model:value="tab" type="line" size="small">
      <!-- ================= 记录小窗 ================= -->
      <n-tab-pane name="recordWindow" tab="记录小窗">
        <n-space vertical size="large">
          <div class="sd-row">
            <n-switch v-model:value="ui.recordWindowOpen" />
            <div class="sd-row-text">
              <div class="sd-row-title">常驻悬浮小窗</div>
              <div class="sd-row-hint">
                打开后跨页签常驻：在队伍/属性页改配置，小窗实时看伤害与指标变化。可拖动、可收起。
              </div>
            </div>
          </div>

          <n-divider style="margin: 0" />

          <div>
            <div class="sd-row">
              <div class="sd-row-text">
                <div class="sd-row-title">显示哪些读数</div>
                <div class="sd-row-hint">
                  勾上才显示（当前 {{ ui.recordWindowPickCount }} 项）。分人指标（如分人伤害）可以按角色分别勾。
                </div>
              </div>
              <n-button size="small" @click="ui.resetRecordPicks()">恢复默认读数</n-button>
            </div>

            <div class="sd-picks">
              <div v-for="group in pickGroups" :key="group.metricId" class="sd-pick-group">
                <div class="sd-pick-title">{{ group.label }}</div>
                <div class="sd-pick-items">
                  <n-checkbox
                    v-for="item in group.items"
                    :key="`${item.metricId}|${item.slot}`"
                    :checked="ui.hasRecordPick(item.metricId, item.slot)"
                    size="small"
                    @update:checked="() => ui.toggleRecordPick(item.metricId, item.slot)"
                  >
                    {{ item.shortLabel }}
                  </n-checkbox>
                </div>
              </div>
            </div>
          </div>
        </n-space>
      </n-tab-pane>

      <!-- ================= 用户记忆 ================= -->
      <n-tab-pane name="memory" tab="用户记忆">
        <MemoryPanel />
      </n-tab-pane>

      <!-- ================= Beta 角色 ================= -->
      <n-tab-pane name="betaAgents" tab="Beta 角色">
        <n-space vertical size="large">
          <div class="sd-row">
            <n-switch :value="catalog.betaEnabled" @update:value="onToggleBeta" />
            <div class="sd-row-text">
              <div class="sd-row-title">显示测试服旧版冻结角色</div>
              <div class="sd-row-hint">
                测试服角色被新一版数据覆盖前，可用 <code>node scripts/snapshot-agent.mjs</code> 把旧版整体冻结成
                旁挂角色（id 形如 1091v1）。开关关闭时全库不放出这些 id；打开后它们作为普通角色进入所有
                对比/修改模块，可与新版同屏对比强度。切换后需刷新页面生效。
              </div>
            </div>
          </div>

          <n-divider style="margin: 0" />

          <div v-if="betaSnapshots.length === 0" class="sd-row-hint">
            当前没有已冻结的 beta 角色。
          </div>
          <div v-else>
            <div class="sd-row-title">已冻结快照</div>
            <div v-for="snap in betaSnapshots" :key="snap.betaId" class="sd-row-hint">
              {{ nameOf(snap.betaId) }}（{{ snap.betaId }}）· 源版本 {{ snap.sourceVersion }} · 冻结于 {{ snap.createdAt.slice(0, 10) }}
            </div>
          </div>
        </n-space>
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<script setup lang="ts">
/**
 * 设置弹层（原仓**没有**设置入口；用户口径「小窗开关位置 = 设置里给一个开关」⇒ 本组件即该入口）。
 *
 * 入口在 `AppHeader` 右侧（齿轮），与主题切换并列。
 * 两个页签：① 记录小窗（开关 + 勾选读数）；② 用户记忆（记忆模式 / 导出导入 / 恢复出厂）。
 *
 * 指标勾选清单**直接由 `METRICS` 注册表生成**（规则 11 单一来源；`metricPickOptions`），
 * 本组件不感知具体有哪些指标——注册表加一行，这里自动多一项。
 */
import { computed } from 'vue'
import { NButton, NCheckbox, NDivider, NModal, NSpace, NSwitch, NTabPane, NTabs } from 'naive-ui'
import { useUiStore } from '@/stores/ui'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { TOTAL_KEY } from '@/composables/freeCompare/metrics'
import { metricPickOptions } from '@/composables/recordWindow'
import MemoryPanel from '@/components/MemoryPanel.vue'

const show = defineModel<boolean>('show', { required: true })
const tab = defineModel<string>('tab', { default: 'recordWindow' })

const ui = useUiStore()
const catalog = useCatalogStore()
const config = useConfigStore()

const nameOf = (agentId: string): string => {
  const agent = catalog.agentsMap.get(agentId)
  return agent?.name.zhCN || agent?.name.en || agentId
}

/** beta 开关：落 localStorage 后刷新页面（catalog/teammateBuffs 的合并缓存不热切换，见 catalog store 注释）。 */
function onToggleBeta(on: boolean): void {
  catalog.setBetaEnabled(on)
  setTimeout(() => window.location.reload(), 50)
}

const betaSnapshots = computed(() => catalog.betaAgentsFile?.snapshots ?? [])

/**
 * 勾选清单按指标分组（每指标一组：全队 + 各在队角色）。
 * 选项由 `metricPickOptions` 从 `METRICS` 注册表生成（规则 11）；`scope: 'team'` 的指标只有「全队」一项。
 */
const pickGroups = computed(() => {
  const members = [0, 1, 2]
    .map(slot => ({ slot, agentId: config.team[slot]?.agentId ?? '' }))
    .filter(c => !!c.agentId)
  const options = metricPickOptions(members, nameOf)
  const byMetric = new Map<string, { metricId: string; label: string; items: Array<{ metricId: string; slot: string; shortLabel: string }> }>()
  for (const opt of options) {
    let group = byMetric.get(opt.metricId)
    if (!group) {
      group = { metricId: opt.metricId, label: opt.group, items: [] }
      byMetric.set(opt.metricId, group)
    }
    group.items.push({
      metricId: opt.metricId,
      slot: opt.slot,
      shortLabel: opt.slot === TOTAL_KEY ? '全队' : nameOf(opt.slot),
    })
  }
  return [...byMetric.values()]
})
</script>

<style scoped>
.settings-dialog :deep(.n-card__content) {
  max-height: 70vh;
  overflow-y: auto;
}

.sd-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-6);
}

.sd-row-text {
  flex: 1;
  min-width: 0;
}

.sd-row-title {
  color: var(--app-text-solid);
  font-size: var(--text-xl);
  font-weight: var(--weight-medium);
}

.sd-row-hint {
  color: var(--fg-2);
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  margin-top: var(--space-2);
}

.sd-picks {
  margin-top: var(--space-6);
  max-height: 42vh;
  overflow-y: auto;
  padding-right: var(--space-3);
}

.sd-pick-group + .sd-pick-group {
  margin-top: var(--space-5);
}

.sd-pick-title {
  color: var(--fg-2);
  font-size: var(--text-md);
  font-weight: var(--weight-medium);
  margin-bottom: var(--space-3);
}

.sd-pick-items {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-7);
}
</style>
