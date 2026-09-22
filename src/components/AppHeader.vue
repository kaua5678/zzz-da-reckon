<template>
  <div class="app-header">
    <div class="header-left">
      <div class="brand">
        <span class="brand-badge">ZZZ</span>
        <span class="brand-title">伤害计算器</span>
      </div>
    </div>
    <div class="header-center">
      <div class="tab-section">
        <div class="tab-section-label">配置</div>
        <n-tabs
          :value="setupTabValue"
          type="line"
          size="large"
          class="header-tabs"
          @update:value="onTabChange"
        >
          <n-tab-pane name="team" tab="队伍配置" />
          <n-tab-pane name="attribute" tab="属性配置" />
          <n-tab-pane name="resource" tab="倍率表" />
        </n-tabs>
      </div>
      <div class="tab-section">
        <div class="tab-section-label">分析</div>
        <n-tabs
          :value="analyzeTabValue"
          type="line"
          size="large"
          class="header-tabs"
          @update:value="onTabChange"
        >
          <n-tab-pane name="result" tab="资源池" />
          <n-tab-pane name="resourceUtilization" tab="资源利用率" />
          <n-tab-pane name="stunAxis" tab="失衡轴" />
          <n-tab-pane name="timeline" tab="时间图表" />
        </n-tabs>
      </div>
      <div class="tab-section">
        <div class="tab-section-label">对比</div>
        <n-tabs
          :value="compareTabValue"
          type="line"
          size="large"
          class="header-tabs"
          @update:value="onTabChange"
        >
          <n-tab-pane name="teamCompare" tab="队伍对比" />
          <n-tab-pane name="breakerCompare" tab="位置对比" />
          <n-tab-pane name="freeCompare" tab="自由对比" />
          <n-tab-pane name="runArchive" tab="实战对比" />
        </n-tabs>
      </div>
      <div class="tab-section">
        <div class="tab-section-label">规划</div>
        <n-tabs
          :value="planTabValue"
          type="line"
          size="large"
          class="header-tabs"
          @update:value="onTabChange"
        >
          <n-tab-pane name="charIncrement" tab="角色兑现" />
          <n-tab-pane name="bossHp" tab="血量膨胀" />
        </n-tabs>
      </div>
      <div class="tab-section dev-section">
        <div class="tab-section-label">开发</div>
        <n-tabs
          :value="developerTabValue"
          type="line"
          size="large"
          class="header-tabs dev-tabs"
          @update:value="onTabChange"
        >
          <n-tab-pane name="debug" tab="公式/字段" />
          <n-tab-pane name="wengineFields" tab="音擎字段" />
          <n-tab-pane name="logic" tab="逻辑编辑" />
          <n-tab-pane name="mechanic" tab="机制表" />
          <n-tab-pane name="multiplierCoeff" tab="倍率系数记录" />
        </n-tabs>
      </div>
    </div>
    <div class="header-right">
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button quaternary circle size="small" class="theme-toggle" @click="themeStore.toggle()">
            <template #icon>
              <n-icon>
                <SunnyOutline v-if="themeStore.mode === 'dark'" />
                <MoonOutline v-else />
              </n-icon>
            </template>
          </n-button>
        </template>
        {{ themeStore.mode === 'dark' ? '切换到明亮模式' : '切换到夜间模式' }}
      </n-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NIcon, NTabs, NTabPane, NTooltip } from 'naive-ui'
import { MoonOutline, SunnyOutline } from '@vicons/ionicons5'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'

const configStore = useConfigStore()
const themeStore = useThemeStore()

const setupTabs = ['team', 'attribute', 'resource']
const analyzeTabs = ['result', 'resourceUtilization', 'stunAxis', 'timeline']
const compareTabs = ['teamCompare', 'breakerCompare', 'freeCompare', 'runArchive']
const planTabs = ['charIncrement', 'bossHp']
const developerTabs = ['debug', 'wengineFields', 'logic', 'mechanic', 'multiplierCoeff']
const sectionValue = (tabs: string[]) =>
  computed(() => (tabs.includes(configStore.activeTab) ? configStore.activeTab : ''))
const setupTabValue = sectionValue(setupTabs)
const analyzeTabValue = sectionValue(analyzeTabs)
const compareTabValue = sectionValue(compareTabs)
const planTabValue = sectionValue(planTabs)
const developerTabValue = sectionValue(developerTabs)

function onTabChange(tab: string) {
  configStore.activeTab = tab
}
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  min-height: 60px;
  background: var(--app-header-bg);
  /* 原 var(--wa-80)：顶栏描边与页面通用描边不是同一条线，接 --app-border。
     再加一层 --shadow-1 —— 明亮模式顶栏是白、页面底是淡灰蓝，没有投影时
     滚动内容会从顶栏下方"贴"过去，分不出层次。 */
  border-bottom: 1px solid var(--app-border);
  box-shadow: var(--shadow-1);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  backdrop-filter: blur(10px);
}

/* 斜向扫描纹理：45° 细线，2px 一循环。铺在顶栏整面但压在内容之下（z-index:0 +
   子元素 position:relative），提供「机械外壳」触感而不干扰可读性。
   ⚠ 不用 background-image 叠在 .app-header 自身上：那会与 backdrop-filter 的
   毛玻璃层叠加顺序打架（实测纹理会被模糊糊掉）。故独立 ::before 层。 */
.app-header::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    45deg,
    var(--shell-grid-line) 0,
    var(--shell-grid-line) 1px,
    transparent 1px,
    transparent 7px
  );
  /* 纹理向右淡出：左侧品牌区最实、右侧工具区最净，形成视觉重心 */
  mask-image: linear-gradient(90deg, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.35) 55%, transparent 100%);
}

/* 底部霓虹导轨：压在 border-bottom 之上，横贯屏宽的品牌色渐变 */
.app-header::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  pointer-events: none;
  background: var(--shell-rail);
}

/* 纹理/导轨是 absolute，其余内容必须抬到同一层叠上下文之上 */
.header-left,
.header-center,
.header-right {
  position: relative;
  z-index: 1;
}

.header-left {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 7px;
  border-radius: 7px;
  /* ZZZ S级金（#FFB500，游戏 S 抽卡金）：品牌锚点，亮暗两模式同值 */
  background: linear-gradient(135deg, var(--app-accent-gold), var(--app-accent-gold-soft));
  color: var(--brand-ink);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 2px;
  line-height: 1;
  box-shadow: var(--brand-glow);
  /* 高光掠过动画需要裁剪边界 */
  position: relative;
  overflow: hidden;
}

/* 金属高光：一道 20° 斜白条，hover 时从左掠到右。
   静止时停在左侧框外（left:-60%），不产生任何视觉噪声。 */
.brand-badge::after {
  content: '';
  position: absolute;
  top: -50%;
  bottom: -50%;
  left: -60%;
  width: 40%;
  transform: skewX(-20deg);
  background: linear-gradient(90deg, transparent, var(--brand-sheen), transparent);
  opacity: 0;
}

.brand:hover .brand-badge::after {
  animation: brand-sheen-sweep var(--dur-slow) var(--ease-out);
}

@keyframes brand-sheen-sweep {
  from {
    left: -60%;
    opacity: 1;
  }
  to {
    left: 120%;
    opacity: 0;
  }
}

/* 无障碍：尊重系统「减少动效」偏好 */
@media (prefers-reduced-motion: reduce) {
  .brand:hover .brand-badge::after {
    animation: none;
  }
}

.brand-title {
  font-size: var(--text-3xl);
  font-weight: var(--weight-bold);
  color: var(--app-text-solid);
  letter-spacing: 1px;
  white-space: nowrap;
}

.header-right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.theme-toggle {
  color: var(--fg-2);
  /* 图标按钮的悬停反馈：原本只有 naive 默认的底色变化，太弱。
     加一层旋转——日/月图标切换时有「天体运行」的暗示。 */
  transition: color var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.theme-toggle:hover {
  color: var(--app-accent-gold);
  transform: rotate(-18deg);
}

@media (prefers-reduced-motion: reduce) {
  .theme-toggle:hover {
    transform: none;
  }
}

/* 键盘可达性：顶栏是纯图标按钮密集区，原本 Tab 过去完全没有视觉反馈 */
.theme-toggle:focus-visible {
  outline: none;
  box-shadow: var(--ring-focus);
}

.header-center {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 支持换行的浏览器在溢出时退回起点对齐，避免 center + overflow 把左侧裁得滚不到 */
  justify-content: safe center;
  /* 空间不足时以「区块段」为单位换行，而不是横向裁切——保证首个 tab 始终可点 */
  flex-wrap: wrap;
  gap: 18px;
  row-gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.header-center::-webkit-scrollbar {
  display: none;
}

.tab-section {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.tab-section-label {
  /* 从裸文字升级为胶囊贴片：原本 12px 灰字与 tab 文字混在一起，
     扫视时分不清「这是分组名」还是「这是一个可点的 tab」。
     ⚠ 墨色必须按**贴片底**选而不是页面底（tinted-contrast 判据）：
     实测 --app-text-dim 压在 --shell-chip-bg 上只有 dark 4.42 / light 3.27，
     **低于 4.5** ⇒ 上抬到 --app-text（dark 15.2 / light 13.9）。
     分组名是要被读的文字、不是装饰：视觉层级改由字号(11px)+字距+胶囊底承担，
     不靠压低墨色——压墨换来的「次要感」代价是可读性，11px 尺寸上尤其不划算。 */
  color: var(--app-text);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  letter-spacing: 1px;
  padding: 2px var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--shell-chip-bg);
  border: 1px solid var(--shell-chip-line);
  white-space: nowrap;
}

/* 分隔线挂在各段 ::before 上，与段作为一个整体参与换行，避免孤儿竖线掉在行首 */
.tab-section + .tab-section::before {
  content: '';
  flex: 0 0 auto;
  width: 1px;
  height: 24px;
  background: var(--wa-120);
}

.header-tabs {
  --n-tab-text-color: var(--wa-600);
  --n-tab-text-color-active: var(--app-text-solid);
  --n-tab-text-color-hover: var(--wa-850);
  --n-tab-bar-color: var(--app-primary);
  --n-tab-font-size: 14px;
  white-space: nowrap;
}

/* 激活 tab 的下划线加辉光：naive 默认只是一条实色 bar，在密集的 5 段
   导航里「当前在哪」需要更强的锚点。用 filter 而非 box-shadow——
   bar 是伪元素，box-shadow 会被裁掉。 */
.header-tabs :deep(.n-tabs-bar) {
  filter: drop-shadow(var(--shell-tab-glow));
}

.dev-tabs {
  --n-tab-bar-color: var(--dev-accent);
}

.dev-tabs :deep(.n-tabs-bar) {
  filter: drop-shadow(var(--dev-accent-glow));
}

@media (max-width: 900px) {
  .app-header {
    padding: 0 12px;
    gap: 10px;
  }

  .brand-title {
    display: none;
  }

  .tab-section-label {
    display: none;
  }

  .tab-section + .tab-section::before {
    display: none;
  }
}
</style>
