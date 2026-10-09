<template>
  <n-space vertical size="large">
    <!-- ① 记忆模式开关 -->
    <div class="mp-row">
      <n-switch v-model:value="memory.recording" />
      <div class="mp-row-text">
        <div class="mp-row-title">记忆模式</div>
        <div class="mp-row-hint">
          打开后，改动<b>立刻</b>计入记忆并实时保存（关闭时改动不计入）。当前承载：
          队友 Buff 的<b>开关</b>记入<b>队伍记忆</b>（勾选随队伍组成变），<b>覆盖率</b>记入<b>全局记忆</b>（换队仍适用）。
          两层都没有记录 = 临时改动，会被默认值覆盖。
        </div>
      </div>
    </div>

    <!-- ② 可见报错 / 提示（解析失败绝不静默回落） -->
    <n-alert v-if="memory.error" type="error" :show-icon="true" closable @close="memory.clearMessages()">
      {{ memory.error }}
    </n-alert>
    <n-alert v-else-if="memory.notice" type="success" :show-icon="true" closable @close="memory.clearMessages()">
      {{ memory.notice }}
    </n-alert>

    <n-divider style="margin: 0" />

    <!-- ③ 当前记忆摘要 -->
    <div>
      <div class="mp-row">
        <div class="mp-row-text">
          <div class="mp-row-title">当前记忆</div>
          <div class="mp-row-hint">
            全局 {{ memory.summary.globalEntries }} 条 · 队伍 {{ memory.summary.teams }} 支（共 {{ memory.summary.teamEntries }} 条）
            <template v-if="memory.teamKeys.length">
              ：{{ memory.teamKeys.map(k => teamLabel(k)).join('、') }}
            </template>
          </div>
        </div>
      </div>

      <n-space size="small" style="margin-top: 10px" align="center">
        <n-button size="small" @click="doExport()">导出 JSON 文件</n-button>
        <n-button size="small" @click="fileInput?.click()">导入 JSON 文件</n-button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          class="mp-file"
          @change="onImportFile"
        >
        <n-input
          v-model:value="slotName"
          size="small"
          placeholder="记忆名称"
          style="width: 160px"
        />
        <n-button size="small" @click="memory.saveSlot(slotName)">存为具名记忆</n-button>
      </n-space>
    </div>

    <!-- ④ 具名记忆槽（「加载某个记忆文件」的本地多份） -->
    <div v-if="memory.slots.length">
      <div class="mp-row-title">具名记忆（{{ memory.slots.length }}）</div>
      <div class="mp-slot-list">
        <div v-for="slot in memory.slots" :key="slot.name" class="mp-slot">
          <span class="mp-slot-name">{{ slot.name }}</span>
          <span class="mp-slot-time">{{ shortTime(slot.savedAt) }}</span>
          <n-button size="tiny" @click="loadSlot(slot.name)">加载</n-button>
          <n-button size="tiny" quaternary @click="memory.deleteSlot(slot.name)">删除</n-button>
        </div>
      </div>
    </div>

    <n-divider style="margin: 0" />

    <!-- ⑤ 恢复出厂（**不是**「加载某个记忆文件」——两个独立操作） -->
    <div class="mp-row">
      <div class="mp-row-text">
        <div class="mp-row-title">恢复出厂值</div>
        <div class="mp-row-hint">
          清空全部记忆，一切回到开发者标准值（= 加载一份「全为不修改」的记忆文件）。
          执行前会把当前记忆<b>自动备份</b>成一个具名记忆，随时可加载回来。
          <br>⚠ 这与「加载某个记忆文件」是两件事：那个是恢复你存过的<b>某一份</b>。
        </div>
      </div>
      <n-button size="small" type="warning" secondary @click="doFactoryReset()">恢复出厂值</n-button>
    </div>
  </n-space>
</template>

<script setup lang="ts">
/**
 * 用户记忆面板（设置弹层的「用户记忆」页签）。
 *
 * 五块 = 用户口径的五条落地：记忆模式开关 / 可见报错 / 当前记忆摘要 / 具名记忆槽 / 恢复出厂。
 * **恢复出厂与加载记忆是两个独立按钮**（用户裁决：两者是不同操作，别做成一个）。
 *
 * 所有状态与写盘都在 `stores/memory.ts`（单一来源）；本组件只做展示与「导入后让记忆在配置上生效」。
 */
import { ref } from 'vue'
import { NAlert, NButton, NDivider, NInput, NSpace, NSwitch } from 'naive-ui'
import { useMemoryStore } from '@/stores/memory'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'

const memory = useMemoryStore()
const config = useConfigStore()
const catalog = useCatalogStore()

const slotName = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const nameOf = (agentId: string): string => {
  const agent = catalog.agentsMap.get(agentId)
  return agent?.name.zhCN || agent?.name.en || agentId
}

/** 队伍身份键（成员 id 集合，顺序无关）→ 展示名 */
function teamLabel(key: string): string {
  const stored = memory.file.teams[key]?.label
  if (stored) return stored
  return key.split('+').filter(Boolean).map(nameOf).join(' / ') || key
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function doExport() {
  const blob = new Blob([memory.exportText()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `zzz-记忆-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  if (!picked) return
  const ok = memory.importText(await picked.text())
  if (ok) config.applyMemoryReset()
}

/** 加载具名槽后让记忆在当前配置上生效（同导入） */
function loadSlot(name: string) {
  if (memory.loadSlot(name)) config.applyMemoryReset()
}

function doFactoryReset() {
  memory.factoryReset()
  config.applyMemoryReset()
}
</script>

<style scoped>
.mp-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-6);
}

.mp-row-text {
  flex: 1;
  min-width: 0;
}

.mp-row-title {
  color: var(--app-text-solid);
  font-size: var(--text-xl);
  font-weight: var(--weight-medium);
}

.mp-row-hint {
  color: var(--fg-2);
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  margin-top: var(--space-2);
}

.mp-file {
  display: none;
}

.mp-slot-list {
  margin-top: var(--space-4);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.mp-slot {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-md);
}

.mp-slot + .mp-slot {
  border-top: 1px solid var(--app-border);
}

.mp-slot-name {
  flex: 1;
  min-width: 0;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-slot-time {
  color: var(--fg-3);
  font-size: var(--text-sm);
}
</style>
