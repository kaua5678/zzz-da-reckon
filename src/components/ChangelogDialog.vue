<template>
  <n-modal
    v-model:show="show"
    preset="card"
    title="更新日志"
    class="changelog-dialog"
    style="width: 900px; max-width: 95vw"
  >
    <template #header-extra>
      <span class="cl-summary">{{ summaryText }}</span>
    </template>

    <!-- 工具条：搜索 + 类型筛选。筛选项由数据（file.kinds）驱动，组件不硬编码类型表 -->
    <div class="cl-toolbar">
      <n-input
        v-model:value="keyword"
        size="small"
        clearable
        placeholder="搜索摘要 / 类型 / commit"
        class="cl-search"
      />
      <div class="cl-kinds">
        <button
          type="button"
          class="cl-kind"
          :class="{ 'cl-kind--on': kind === '' }"
          @click="kind = ''"
        >
          全部 <span class="cl-kind-num">{{ totalUnderKeyword }}</span>
        </button>
        <button
          v-for="item in kindOptions"
          :key="item.id"
          type="button"
          class="cl-kind"
          :class="[`cl-kind--${item.id}`, { 'cl-kind--on': kind === item.id }]"
          @click="kind = kind === item.id ? '' : item.id"
        >
          {{ item.label }} <span class="cl-kind-num">{{ item.count }}</span>
        </button>
      </div>
    </div>

    <!--
      虚拟列表：两千多条，全量渲染会让弹层打开明显卡顿（每次筛选还要整棵重渲）。
      固定行高 ⇒ 日期条与日志行同高，靠底色/字重区分（见 changelogView.ts 的 ChangelogRow 注释）。
    -->
    <div class="cl-body">
      <n-empty v-if="rows.length === 0" :description="emptyText" class="cl-empty" />
      <n-virtual-list
        v-else
        :items="rows"
        :item-size="ROW_HEIGHT"
        key-field="key"
        class="cl-list"
      >
        <template #default="{ item }">
          <div v-if="item.type === 'day'" class="cl-day">
            <span class="cl-day-date">{{ item.day }}</span>
            <span class="cl-day-count">{{ item.count }} 条</span>
          </div>
          <div v-else class="cl-entry">
            <span class="cl-entry-type" :class="`cl-entry-type--${item.entry.k}`">{{ item.entry.t }}</span>
            <span class="cl-entry-text" :title="item.entry.s">
              <span v-if="item.entry.bc" class="cl-entry-bc" title="破坏性变更">!</span>{{ item.entry.s }}
            </span>
            <span class="cl-entry-hash">{{ item.entry.h }}</span>
          </div>
        </template>
      </n-virtual-list>
    </div>

    <template #footer>
      <div class="cl-footer">
        <span class="cl-footer-note">
          由 <code>git log</code> 自动生成（<code>npm run gen:changelog</code>）· 仅列已提交的改动
        </span>
        <n-button size="small" :loading="loading" @click="reload">刷新</n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
/**
 * 更新日志弹层（入口 = `AppHeader` 右侧的「更新日志」图标按钮，与设置/主题并列）。
 *
 * 数据来源 = `public/static/changelog.json`（`scripts/gen-changelog.mjs` 从 git 历史生成，
 * CI 有漂移检查）。**按需加载**：打开弹层才 fetch —— 它是 400 KB 的历史数据，
 * 而打开计算器的目的不是读日志，所以不进启动门（`composables/calculatorStartup.ts`）。
 *
 * 逻辑都在 `composables/changelogView.ts`（纯函数，有单测）；本组件只做渲染与取数。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty, NInput, NModal, NVirtualList } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { buildChangelogRows, countEntries, kindCounts } from '@/composables/changelogView'

/** 行高（px）：日期条与日志行**同高**，naive-ui 的虚拟列表才能用固定 item-size。 */
const ROW_HEIGHT = 30

const show = defineModel<boolean>('show', { required: true })
const catalog = useCatalogStore()

const keyword = ref('')
const kind = ref('')
const loading = ref(false)
const loadError = ref<string | null>(null)

const file = computed(() => catalog.changelogFile)

/**
 * 取数（打开时 / 手动刷新）。
 *
 * 失败**只落在弹层里**（loadError），不抛给全局：日志是只读的旁路功能，
 * 它挂了不该影响计算器主体（与启动门的口径相反 —— 见 `calculatorStartup`）。
 */
async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    await catalog.loadChangelog()
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function reload(): void {
  // 刷新 = 重新取一次（store 里已加载的会直接返回缓存；此处清空以强制重取）
  catalog.changelogFile = null
  void load()
}

// 打开时才拉数据（含首次）；关闭不重复请求
watch(show, (open) => {
  if (open && !file.value) void load()
}, { immediate: true })

/** 各 kind 在**当前关键词**下的条数（随搜索变化，避免按钮数字与实际结果不符） */
const counts = computed(() => kindCounts(file.value, keyword.value))
const totalUnderKeyword = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0))

/** 筛选按钮：只出数据里实际出现过、且当前关键词下有条目的 kind */
const kindOptions = computed(() =>
  (file.value?.kinds ?? [])
    .map(k => ({ ...k, count: counts.value[k.id] ?? 0 }))
    .filter(k => k.count > 0),
)

const rows = computed(() => buildChangelogRows(file.value, { keyword: keyword.value, kind: kind.value }))

const summaryText = computed(() => {
  if (loadError.value) return '加载失败'
  if (!file.value) return '加载中…'
  const hit = countEntries(rows.value)
  // 有筛选时补一个「命中 / 总数」，否则只报总数
  return hit === file.value.total
    ? `共 ${file.value.total} 条 · ${file.value.days.length} 天`
    : `命中 ${hit} / ${file.value.total} 条`
})

const emptyText = computed(() => {
  if (loadError.value) return `加载失败：${loadError.value}`
  if (!file.value) return '加载中…'
  return '没有匹配的记录'
})
</script>

<style scoped>
.cl-summary {
  color: var(--fg-3);
  font-size: var(--text-md);
}

.cl-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}

.cl-search {
  width: 260px;
}

.cl-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* 筛选贴片：自带浅底 ⇒ 墨必须走 --fg-2（贴片底上 --fg-3 会掉到 4.5:1 以下，
   见 UI_THEME_GUIDE §5 与 check-tokens 的 tinted-contrast 判据）。 */
.cl-kind {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-5);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--fill-hover);
  color: var(--fg-2);
  font-size: var(--text-md);
  cursor: pointer;
  transition: background var(--ease-out), color var(--ease-out);
}

.cl-kind:hover {
  background: var(--fill-active);
}

/* 选中态走仓库既有的「选中底」语义（--fill-active）而不是实心主色：
   实测（check-tokens 的 tinted-contrast 判据）--app-text-solid 压在 --app-primary 上
   只有 dark 3.10 / light 3.33，均 < 4.5 —— 主色是给按钮/链接用的**深底**，不是贴片底。
   选中靠「底 + 描边 + 墨」三处同时变化区分，无需新增 on-primary 墨令牌（规则 12）。 */
.cl-kind--on {
  background: var(--fill-active);
  border-color: var(--app-primary);
  color: var(--app-text-solid);
}

.cl-kind-num {
  color: inherit;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.cl-body {
  height: 62vh;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--app-inset);
}

.cl-list {
  height: 100%;
}

.cl-empty {
  padding: var(--space-9) 0;
}

/* 日期条与日志行同高（ROW_HEIGHT=30px）：虚拟列表用固定 item-size，混排高度要逐行测量 */
.cl-day {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 var(--space-6);
  background: var(--app-tablehead-bg);
  color: var(--fg-2);
  font-size: var(--text-md);
  font-weight: var(--weight-medium);
}

.cl-day-count {
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
}

.cl-entry {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  height: 30px;
  padding: 0 var(--space-6);
  border-bottom: 1px solid var(--line);
}

.cl-entry-type {
  flex: none;
  width: 4.5em;
  color: var(--fg-2);
  font-size: var(--text-sm);
  text-align: right;
}

/* 类型着色：用语义色令牌（不是数据色），两主题各自成立 */
.cl-entry-type--feature {
  color: var(--c-success-strong);
}

.cl-entry-type--fix {
  color: var(--c-warning-strong);
}

.cl-entry-type--refactor {
  color: var(--c-info-strong);
}

.cl-entry-type--docs {
  color: var(--fg-3);
}

.cl-entry-type--other {
  color: var(--fg-3);
}

.cl-entry-text {
  flex: 1;
  min-width: 0;
  color: var(--app-text);
  font-size: var(--text-lg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cl-entry-bc {
  display: inline-block;
  margin-right: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-xs);
  background: var(--c-danger-soft);
  color: var(--c-danger-strong);
  font-weight: var(--weight-bold);
}

.cl-entry-hash {
  flex: none;
  color: var(--fg-3);
  /* 等宽栈与仓库其他「显示 id/hash」处一致（WEngineFieldPage 的 .engine-id 同款）；
     没有 --app-font-mono 令牌，别在这里发明一个（规则 11：跨文件常量只从单一来源引用）。 */
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: var(--text-sm);
}

.cl-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
}

.cl-footer-note {
  color: var(--fg-3);
  font-size: var(--text-md);
}

.cl-footer-note code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--fg-2);
}
</style>
