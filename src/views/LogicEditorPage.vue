<template>
  <div class="logic-editor-page">
    <n-space vertical :size="16">
      <n-card size="small" :bordered="true">
        <template #header>
          <div class="page-header">
            <div>
              <div class="page-title">计算逻辑编辑</div>
              <div class="page-subtitle">默认规则来自已录入角色逻辑</div>
            </div>
            <n-space :size="8">
              <n-button size="small" type="primary" @click="save">保存</n-button>
              <n-button size="small" @click="exportJson">导出 JSON</n-button>
              <n-button size="small" @click="exportSpecJson">生成 Spec JSON</n-button>
              <n-button size="small" @click="fileInput?.click()">导入 JSON</n-button>
              <n-button size="small" type="warning" @click="reset">恢复默认</n-button>
            </n-space>
          </div>
        </template>
        <n-alert type="info" :bordered="false" style="margin-bottom: 12px">
          倍率融合启用后，按 moveId + rowId 在倍率表取值处生效。
        </n-alert>
        <input ref="fileInput" type="file" accept="application/json" hidden @change="onImportFile" />
      </n-card>

      <n-card size="small" :bordered="true">
        <n-tabs v-model:value="activeTab" type="segment">
          <n-tab-pane name="conversion" tab="属性转模">
            <div class="toolbar-row">
              <n-button size="small" @click="logicStore.addAttributeConversion()">新增转模</n-button>
            </div>
            <div class="logic-table-wrap">
              <table class="logic-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>来源属性</th>
                    <th>阶段</th>
                    <th>阈值</th>
                    <th>步长</th>
                    <th>目标属性</th>
                    <th>每步值</th>
                    <th>上限</th>
                    <th>说明</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="rule in logicStore.state.attributeConversions" :key="rule.id">
                    <td><n-input v-model:value="rule.name" size="small" /></td>
                    <td><n-select v-model:value="rule.sourceStat" :options="statOptions" size="small" filterable /></td>
                    <td><n-select v-model:value="rule.sourcePanelPhase" :options="phaseOptions" size="small" /></td>
                    <td><n-input-number v-model:value="rule.threshold" size="small" /></td>
                    <td><n-input-number v-model:value="rule.stepSize" size="small" :min="0.0001" /></td>
                    <td><n-select v-model:value="rule.targetStat" :options="statOptions" size="small" filterable /></td>
                    <td><n-input-number v-model:value="rule.valuePerStep" size="small" /></td>
                    <td><n-input-number v-model:value="rule.cap" size="small" :min="0" /></td>
                    <td><n-input v-model:value="rule.note" size="small" type="textarea" :autosize="{ minRows: 1, maxRows: 2 }" /></td>
                    <td><n-button size="small" quaternary type="error" @click="logicStore.removeAttributeConversion(rule.id)">删除</n-button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <n-empty v-if="logicStore.state.attributeConversions.length === 0" description="暂无属性转模规则" />
          </n-tab-pane>

          <n-tab-pane name="objects" tab="对象库">
            <div class="toolbar-row">
              <n-button size="small" @click="logicStore.addObject()">新增对象</n-button>
            </div>
            <div class="logic-table-wrap">
              <table class="logic-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>名称</th>
                    <th>性质</th>
                    <th>启用</th>
                    <th>属性 JSON</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="object in logicStore.state.objects" :key="object.id">
                    <td><n-input v-model:value="object.id" size="small" /></td>
                    <td><n-input v-model:value="object.name" size="small" /></td>
                    <td><n-select v-model:value="object.nature" :options="natureOptions" size="small" /></td>
                    <td><n-switch v-model:value="object.enabled" size="small" /></td>
                    <td>
                      <n-input
                        :value="propertyTextOf(object)"
                        type="textarea"
                        :autosize="{ minRows: 2, maxRows: 5 }"
                        @update:value="value => onPropertyText(object, value)"
                        @blur="commitPropertyText(object)"
                      />
                    </td>
                    <td><n-button size="small" quaternary type="error" @click="logicStore.removeObject(object.id)">删除</n-button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <n-empty v-if="logicStore.state.objects.length === 0" description="暂无对象" />
          </n-tab-pane>

          <n-tab-pane name="fusion" tab="倍率融合">
            <div class="toolbar-row">
              <n-button size="small" @click="logicStore.addRowFusion()">新增融合</n-button>
            </div>
            <div class="logic-table-wrap">
              <table class="logic-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>角色</th>
                    <th>招式</th>
                    <th>倍率行</th>
                    <th>倍率</th>
                    <th>启用</th>
                    <th>预览</th>
                    <th>说明</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="rule in logicStore.state.rowFusions" :key="rule.id">
                    <td><n-input v-model:value="rule.name" size="small" /></td>
                    <td>
                      <n-select
                        v-model:value="rule.agentId"
                        :options="agentOptions"
                        size="small"
                        filterable
                        @update:value="value => onAgentChange(rule, value)"
                      />
                    </td>
                    <td>
                      <n-select
                        v-model:value="rule.moveId"
                        :options="moveOptionsFor(rule.agentId)"
                        size="small"
                        filterable
                        @update:value="value => onMoveChange(rule, value)"
                      />
                    </td>
                    <td>
                      <n-select v-model:value="rule.rowId" :options="rowOptionsFor(rule.moveId)" size="small" filterable />
                    </td>
                    <td><n-input-number v-model:value="rule.multiplier" size="small" :min="0" /></td>
                    <td><n-switch v-model:value="rule.enabled" size="small" /></td>
                    <td>
                      <span v-if="fusionPreview(rule)" class="preview-value">
                        {{ fusionPreview(rule)?.base }} × {{ rule.multiplier }} = {{ fusionPreview(rule)?.result }}
                      </span>
                      <span v-else class="muted">-</span>
                    </td>
                    <td><n-input v-model:value="rule.note" size="small" type="textarea" :autosize="{ minRows: 1, maxRows: 2 }" /></td>
                    <td><n-button size="small" quaternary type="error" @click="logicStore.removeRowFusion(rule.id)">删除</n-button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <n-empty v-if="logicStore.state.rowFusions.length === 0" description="暂无倍率融合规则" />
          </n-tab-pane>
        </n-tabs>
      </n-card>
    </n-space>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSwitch,
  NTabPane,
  NTabs,
  useMessage,
} from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { useLogicEditorStore } from '@/stores/logicEditor'
import { logicEditorStateToSpecs } from '@/logicEditor/toSpec'
import { STAT_META } from '@/utils/statMeta'
import type { LogicObject, ObjectNature, RowFusionRule } from '@/logicEditor/types'
import type { AgentSkills, SkillMove } from '@/types/catalog'

const catalogStore = useCatalogStore()
const logicStore = useLogicEditorStore()
const message = useMessage()

const activeTab = ref('conversion')
const fileInput = ref<HTMLInputElement | null>(null)
const propertyTexts = reactive<Record<string, string>>({})

const statOptions = STAT_META.map(meta => ({ label: meta.label, value: meta.value }))
const phaseOptions = [
  { label: '局外', value: 'outOfCombat' as const },
  { label: '局内', value: 'inCombat' as const },
]
const natureOptions: Array<{ label: string; value: ObjectNature }> = [
  { label: 'Buff', value: 'buff' },
  { label: '资源', value: 'resource' },
  { label: '事件', value: 'event' },
  { label: '公式', value: 'formula' },
  { label: '自定义', value: 'custom' },
]

const agentOptions = computed(() =>
  catalogStore.displayAgents.map(agent => ({
    label: `${localized(agent.name)} (${agent.id})`,
    value: agent.id,
  })),
)

onMounted(async () => {
  if (!catalogStore.ready) {
    try {
      await catalogStore.load()
    } catch {
      // CalculatorView 已有错误提示
    }
  }
})

function localized(obj: any): string {
  if (!obj) return ''
  if (typeof obj === 'string') return obj
  return obj.zhCN ?? obj.en ?? ''
}

function findMove(moveId: string): SkillMove | null {
  for (const agentId of catalogStore.displayAgents.map(agent => agent.id)) {
    const skills = catalogStore.getAgentSkills(agentId)
    if (!skills) continue
    for (const category of skills.categories) {
      const move = category.moves.find(item => item.id === moveId)
      if (move) return move
    }
  }
  return null
}

function moveOptionsFor(agentId: string): Array<{ label: string; value: string }> {
  const skills = catalogStore.getAgentSkills(agentId)
  if (!skills) return []
  return skills.categories.flatMap(category =>
    category.moves.map(move => ({
      label: `${category.id} · ${localized(move.name)} (${move.id})`,
      value: move.id,
    })),
  )
}

function rowOptionsFor(moveId: string): Array<{ label: string; value: string }> {
  const move = findMove(moveId)
  if (!move) return []
  return move.rows.map(row => ({
    label: `${row.id} · ${row.values?.[0] ?? ''}`,
    value: row.id,
  }))
}

function onAgentChange(rule: RowFusionRule, agentId: string): void {
  rule.agentId = agentId
  const moves = moveOptionsFor(agentId)
  if (moves.length > 0) {
    rule.moveId = moves[0].value
    const rows = rowOptionsFor(rule.moveId)
    if (rows.length > 0) rule.rowId = rows[0].value
  }
}

function onMoveChange(rule: RowFusionRule, moveId: string): void {
  rule.moveId = moveId
  const rows = rowOptionsFor(moveId)
  if (rows.length > 0) rule.rowId = rows[0].value
}

function fusionPreview(rule: RowFusionRule): { base: number; result: number } | null {
  const move = findMove(rule.moveId)
  const row = move?.rows.find(item => item.id === rule.rowId)
  if (!row || row.values?.[0] == null) return null
  const base = row.values[0]
  return { base, result: base * rule.multiplier }
}

function propertyTextOf(object: LogicObject): string {
  if (!(object.id in propertyTexts)) {
    propertyTexts[object.id] = JSON.stringify(object.properties ?? {}, null, 2)
  }
  return propertyTexts[object.id]
}

function onPropertyText(object: LogicObject, value: string): void {
  propertyTexts[object.id] = value
}

function commitPropertyText(object: LogicObject): void {
  const raw = propertyTexts[object.id] ?? '{}'
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    object.properties = parsed as Record<string, string | number | boolean | null>
  } catch {
    message.error('对象属性 JSON 无效')
  }
}

function save(): void {
  logicStore.saveNow()
  message.success('已保存到浏览器')
}

function exportJson(): void {
  const blob = new Blob([logicStore.exportJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'zzz-logic-editor.json'
  link.click()
  URL.revokeObjectURL(url)
}

function exportSpecJson(): void {
  const specs = logicEditorStateToSpecs(logicStore.state)
  const blob = new Blob([JSON.stringify(specs, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'zzz-agent-specs.json'
  link.click()
  URL.revokeObjectURL(url)
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    logicStore.importJson(text)
    message.success('导入成功')
  } catch {
    message.error('导入 JSON 失败')
  } finally {
    input.value = ''
  }
}

function reset(): void {
  if (!window.confirm('确定恢复默认逻辑规则？')) return
  logicStore.reset()
  for (const key of Object.keys(propertyTexts)) delete propertyTexts[key]
  message.success('已恢复默认')
}
</script>

<style scoped>
.logic-editor-page {
  min-height: 400px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
}

.page-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--app-text-solid);
}

.page-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--wa-450);
}

.toolbar-row {
  margin-bottom: 12px;
}

.logic-table-wrap {
  overflow-x: auto;
}

.logic-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.logic-table th,
.logic-table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--wa-80);
  vertical-align: top;
  text-align: left;
}

.logic-table th {
  color: var(--wa-550);
  font-weight: 600;
  white-space: nowrap;
}

.logic-table td {
  min-width: 120px;
}

.preview-value {
  color: #7dd3fc;
  white-space: nowrap;
}

.muted {
  color: var(--wa-350);
}
</style>
