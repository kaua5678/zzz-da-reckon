<template>
  <div class="time-charts-page">
    <!-- ============ 控制面板 ============ -->
    <!-- 整块已抽组件 components/charts/TimeChartsControls.vue（2026-09-14 第三片）。
         共享控件基元在 src/styles/charts.css；boss-data-* 随组件走。 -->
    <TimeChartsControls
      v-model:main-agent-id="mainAgentId"
      v-model:selected-boss-id="selectedBossId"
      v-model:budget="budget"
      v-model:candidate-pool="candidatePool"
      v-model:auto-build="autoBuild"
      v-model:optimal-gold="optimalGold"
      :main-agent-options="mainAgentOptions"
      :boss-options="bossOptions"
      :candidate-options="candidateOptions"
      :computing="computing"
      :progress="progress"
      :result="result"
      :selected-boss="selectedBoss"
      :selected-phase="selectedPhase"
      @run="runCompute"
    />

    <!-- ============ Chart 1：队伍强度随版本演变 ============ -->
    <n-card v-if="result" size="small" :bordered="true" title="队伍强度随版本演变">
      <template #header-extra>
        <span class="chart-subtitle">
          {{ result.mainName }} · {{ result.bossName }}（{{ result.phaseLabel }}）· {{ result.budget }} 金预算
          ｜ {{ result.nodes.length }} 节点 · {{ result.swapEvents.length }} 次换人
          <template v-if="result.stats.nonConverged > 0"> · {{ result.stats.nonConverged }} 队未收敛已排除</template>
          · 耗时 {{ (result.stats.durationMs / 1000).toFixed(1) }}s
        </span>
      </template>

      <!-- SVG：折线 + 换人标记 + 泳道 -->
      <div class="timeline-wrap">
      <svg
        :viewBox="`0 0 ${svgW} ${svgH}`"
        class="timeline-svg"
        @mousemove="onSvgMove"
        @mouseleave="hoverNode = -1"
      >
        <!-- 折线图网格 -->
        <g v-for="(y, i) in yTicks" :key="'g' + i">
          <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
          <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ yLabel(i) }}%</text>
        </g>

        <!-- 折线 -->
        <polyline :points="linePoints" class="trend-line" />

        <!-- 换人垂直参考线 -->
        <g v-for="(ev, i) in swapGuides" :key="'s' + i">
          <line
            :x1="ev.x" :y1="padT" :x2="ev.x"
            :y2="padT + plotH + laneTotalH"
            class="swap-line"
          />
        </g>

        <!-- 数据点 -->
        <g v-for="(pt, i) in chartPts" :key="'p' + i">
          <circle
            :cx="pt.x" :cy="pt.y"
            :r="pt.isSwap ? 6 : 4"
            :fill="pt.color"
            :style="{ stroke: hoverNode === i ? 'var(--app-text-solid)' : 'var(--wa-250)' }"
            :stroke-width="hoverNode === i ? 2 : 1"
            class="trend-point"
          />
        </g>

        <!-- 泳道：主C / 队友1 / 队友2 -->
        <g v-for="lane in laneDefs" :key="lane.key">
          <text :x="padL - 8" :y="lane.y + laneH / 2 + 3" class="lane-label" text-anchor="end">{{ lane.label }}</text>
          <rect
            v-for="(cell, i) in lane.cells"
            :key="lane.key + i"
            :x="cell.x"
            :y="lane.y"
            :width="cellW + 0.5"
            :height="laneH"
            :fill="cell.color"
            class="lane-cell"
          >
            <title>{{ cell.name }}</title>
          </rect>
          <text
            v-for="(label, i) in lane.labels"
            :key="'l' + lane.key + i"
            :x="label.x"
            :y="lane.y + laneH / 2 + 3"
            class="lane-text"
          >{{ label.text }}</text>
        </g>

        <!-- 泳道：当期 Boss 排期（选中 Boss 命中的节点高亮） -->
        <g>
          <text :x="padL - 8" :y="bossLaneY + laneH / 2 + 3" class="lane-label" text-anchor="end">当期Boss</text>
          <template v-for="(n, i) in result?.nodes ?? []" :key="'b' + n.nodeId">
            <rect
              :x="i === 0 ? padL : padL + i * cellW"
              :y="bossLaneY"
              :width="cellW + 0.5"
              :height="laneH"
              :style="{ fill: selectedBossAppearances.has(n.nodeId) ? 'rgba(246,173,85,0.22)' : 'var(--wa-40)' }"
              :stroke="selectedBossAppearances.has(n.nodeId) ? '#f6ad55' : 'none'"
              stroke-width="1"
              class="lane-cell"
            >
              <title>{{ bossCellTitle(periodOf(n.nodeId)) }}</title>
            </rect>
            <text
              :x="padL + i * cellW + 4"
              :y="bossLaneY + laneH / 2 + 3"
              class="lane-text"
              :class="{ 'boss-hit': selectedBossAppearances.has(n.nodeId) }"
            >{{ bossCellText(periodOf(n.nodeId)) || '—' }}</text>
          </template>
        </g>

        <!-- X 轴节点标签 -->
        <g v-for="(t, i) in xTicks" :key="'x' + i">
          <text
            :x="t.x"
            :y="svgH - 8"
            class="axis-label x-label"
            text-anchor="middle"
          >{{ t.label }}</text>
        </g>

        <!-- 悬浮提示 -->
        <g v-if="hoverNode >= 0">
          <line
            :x1="chartPts[hoverNode].x" :y1="padT"
            :x2="chartPts[hoverNode].x" :y2="padT + plotH"
            class="hover-line"
          />
        </g>
      </svg>

      <!-- 悬浮卡外壳见 components/ChartHoverCard.vue（行内容由 hoverRows 提供） -->
      <ChartHoverCard
        v-if="hoverNode >= 0 && hoverInfo"
        :x="hoverCardX"
        :y="hoverCardY"
        :title="hoverInfo.nodeLabel"
        :rows="hoverRows"
      />
      </div>

      <!-- 换人事件列表 -->
      <div v-if="result.swapEvents.length > 0" class="swap-events">
        <span class="swap-events-title">换人事件：</span>
        <span
          v-for="(ev, i) in result.swapEvents"
          :key="i"
          class="swap-chip"
        >
          {{ ev.nodeLabel }}：换上 {{ agentName(ev.swappedIn) }}（换下 {{ agentName(ev.swappedOut) }}）
          <span v-if="ev.swapKind" class="swap-kind" :class="ev.swapKind">{{ swapKindLabel(ev.swapKind, ev.swapUpliftPct) }}</span>
        </span>
      </div>

      <!-- 选中 Boss 的出场节点摘要 -->
      <div v-if="selectedBossName && selectedBossAppearances.size > 0" class="boss-appearance">
        {{ selectedBossName }} 出场节点（{{ selectedBossAppearances.size }}）：{{ appearanceLabels.join(' · ') || '不在当前主C时间范围内' }}
      </div>
    </n-card>

    <!-- ============ Chart 2：多队并存强度（队伍×版本矩阵，跌出 Top-K 即淘汰） ============ -->
    <n-card v-if="result && result.strengthSeeds.length > 0" size="small" :bordered="true">
      <template #header>
        多队并存强度
        <span class="chart-subtitle">每个版本包容前 K 名；可达集合只增 ⇒ 排名不升，跌出即永久淘汰</span>
      </template>
      <template #header-extra>
        <span class="ctl-label">每期并存 K</span>
        <n-input-number v-model:value="survivalK" :min="1" :max="6" size="small" style="width: 90px" />
      </template>

      <!-- 图例（点击显隐某队横带）。筛选是**纯展示**：Top-K 排名与淘汰判定是数据性质
           （K 是游戏约束，不是显示选项），隐藏某队不会让别的队「递补存活」——只少画一条带 -->
      <div class="legend">
        <span class="legend-hint">点图例显隐 · 显示 {{ strengthCounts.visible }}/{{ strengthCounts.total }} 队</span>
        <div
          v-for="b in strengthBands"
          :key="b.seed.key"
          class="legend-item"
          :class="{ off: !strengthLegend.isVisible(b.seed.key) }"
          :title="`${b.seed.team.map(agentName).join(' + ')}：点击${strengthLegend.isVisible(b.seed.key) ? '隐藏' : '显示'}这条存活带（Top-K 排名不变——K 是游戏约束）`"
          @click="strengthLegend.toggle(b.seed.key)"
        >
          <span class="swatch" :style="{ background: colorOf(b.seed.key) }"></span>
          <span class="name">{{ b.seed.shortLabel }} {{ fmt(b.seed.hpRatio, 1) }}%</span>
        </div>
        <span class="legend-hint legend-action" @click="strengthLegend.showAll()">全显示</span>
      </div>

      <div class="timeline-wrap">
        <svg :viewBox="`0 0 ${svgW} ${strengthSvgH}`" class="timeline-svg">
          <!-- 网格 + Y 轴（复用 Chart1 的血量%尺度） -->
          <g v-for="(y, i) in yTicks" :key="'sg' + i">
            <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
            <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ yLabel(i) }}%</text>
          </g>
          <!-- 每队一条存活横带：覆盖其存活的版本格 -->
          <g v-for="b in visibleStrengthBands" :key="b.seed.key" class="strength-row">
            <line
              :x1="padL + b.startIndex * cellW"
              :y1="bandY(b.seed.hpRatio)"
              :x2="padL + (b.endIndex + 1) * cellW"
              :y2="bandY(b.seed.hpRatio)"
              :stroke="colorOf(b.seed.key)"
              stroke-width="3.5"
              stroke-linecap="round"
            >
              <title>{{ bandTitle(b) }}</title>
            </line>
            <text
              :x="padL + b.startIndex * cellW + 5"
              :y="bandY(b.seed.hpRatio) - 5"
              :fill="colorOf(b.seed.key)"
              class="strength-label"
            >{{ b.seed.shortLabel }} {{ fmt(b.seed.hpRatio, 1) }}%</text>
            <g v-if="b.eliminatedAt != null">
              <line
                :x1="padL + (b.endIndex + 1) * cellW - 4"
                :y1="bandY(b.seed.hpRatio) - 4"
                :x2="padL + (b.endIndex + 1) * cellW + 4"
                :y2="bandY(b.seed.hpRatio) + 4"
                stroke="#ff6b6b"
                stroke-width="1.6"
              />
              <line
                :x1="padL + (b.endIndex + 1) * cellW - 4"
                :y1="bandY(b.seed.hpRatio) + 4"
                :x2="padL + (b.endIndex + 1) * cellW + 4"
                :y2="bandY(b.seed.hpRatio) - 4"
                stroke="#ff6b6b"
                stroke-width="1.6"
              />
              <title>{{ bandTitle(b) }}</title>
            </g>
          </g>
          <!-- X 轴节点标签（抽稀同 Chart1） -->
          <g v-for="(t, i) in xTicks" :key="'sx' + i">
            <text :x="t.x" :y="strengthSvgH - 8" class="axis-label x-label" text-anchor="middle">{{ t.label }}</text>
          </g>
        </svg>
      </div>
    </n-card>

    <!-- ============ 明细表 ============ -->
    <n-card v-if="result" size="small" :bordered="true" title="各版本节点明细">
      <div class="table-wrap">
        <table class="tl-table">
          <thead>
            <tr>
              <th>期数</th>
              <th>队伍（{{ result.mainName }} + 队友）</th>
              <th>伤害</th>
              <th>伤害/血量%</th>
              <th>金数明细</th>
              <th>当期Boss</th>
              <th>变化</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in result.nodes"
              :key="r.nodeId"
              :class="{ 'swap-row': !!r.swappedIn }"
              @mouseenter="hoverNode = i"
              @mouseleave="hoverNode = -1"
            >
              <td>
                {{ r.nodeLabel }}
                <span v-if="r.nodeNote" class="node-note" :title="r.nodeNote">{{ r.nodeNote }}</span>
              </td>
              <td>
                <span class="team-cell">
                  <span class="dot" :style="{ background: colorOf(r.team[0]) }"></span>{{ agentName(r.team[0]) }}
                  <span class="dot" :style="{ background: colorOf(r.team[1]) }"></span>{{ agentName(r.team[1]) }}
                  <span class="dot" :style="{ background: colorOf(r.team[2]) }"></span>{{ agentName(r.team[2]) }}
                </span>
              </td>
              <td>{{ compact(r.damage) }}</td>
              <td :class="{ 'kill-line': r.hpRatio >= 100 }">{{ fmt(r.hpRatio, 1) }}%</td>
              <td class="gold-cell">{{ r.goldLabel }}</td>
              <td>
                <span
                  v-if="bossCellText(periodOf(r.nodeId))"
                  :class="{ 'boss-hit': selectedBossAppearances.has(r.nodeId) }"
                >{{ bossCellText(periodOf(r.nodeId)) }}</span>
                <span v-else class="no-change">—</span>
              </td>
              <td>
                <span v-if="r.swappedIn" class="swap-badge">
                  换入 {{ agentName(r.swappedIn) }} ⬅ 换出 {{ agentName(r.swappedOut ?? '') }}
                  <span v-if="r.swapKind" class="swap-kind" :class="r.swapKind">{{ swapKindLabel(r.swapKind, r.swapUpliftPct) }}</span>
                </span>
                <span v-else-if="r.newAgentBench" class="bench-note">{{ benchText(r.newAgentBench, agentName) }}</span>
                <span v-else class="no-change">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>

    <!-- 未计算时的引导 -->
    <n-card v-else size="small" :bordered="true">
      <div class="empty-hint">
        选择主C、Boss（必选，默认最新危局）与限定金预算后点击「计算」；横轴自动覆盖主C实装起到最新的全部期数，所选 Boss 的历次出场会在「当期Boss」车道高亮。<br />
        示例：仪玄（2.0 上半实装）→ 可见橘福福（2.0 下半）、卢西娅（2.3）、琉音（2.4）、诺姆（3.0）等节点换人带来的队伍强度变化。
      </div>
    </n-card>

    <!-- ============ 限定S首次UP × 版本直伤系数（倍率演算引擎静态推导，无需点计算） ============ -->
    <!-- 整块已抽组件 components/charts/DirectDamageChart.vue（2026-09-14；本图 dd-* 类为该图独占） -->
    <DirectDamageChart :points="ddPoints" :svg-w="svgW" />

    <!-- ============ Chart 3：每期新角色 · 强队强度（横轴 = 版本，点 = 当期新角色强队，用户清单 + 引擎辅助） ============ -->
    <!-- 整块已抽组件 components/charts/NewCharacterChart.vue（2026-09-14）；样式随组件走 -->
    <NewCharacterChart
      :svg-w="svgW"
      :pad-l="padL"
      :pad-r="padR"
      :plot-w="plotW"
      :pad-t="padT"
      :plot-h="plotH"
      :boss="selectedBoss"
      :phase="selectedPhase"
      :budget="budget"
      :auto-build="autoBuild"
      :optimal-gold="optimalGold"
    />

    <!-- ============ Chart 7：同槽位角色对比（预设中其余两槽相同、所选槽位 A/B 两队） ============ -->
    <!-- 整块已抽组件 components/charts/SlotCompareChart.vue（2026-09-14）；样式随组件走 -->
    <SlotCompareChart
      :svg-w="svgW"
      :pad-l="padL"
      :pad-r="padR"
      :plot-w="plotW"
      :pad-t="padT"
      :plot-h="plotH"
      :boss-options="bossOptions"
      :selected-boss-id="selectedBossId"
      :bosses="bossPresets"
      :budget="budget"
      :auto-build="autoBuild"
      :optimal-gold="optimalGold"
    />

    <!-- ============ Chart 4：菲林经济模拟（队伍强度随菲林投入） ============ -->
    <!-- 整块已抽组件 components/charts/FilmSimChart.vue（2026-09-14）；样式随组件走 -->
    <FilmSimChart
      :svg-w="svgW"
      :pad-l="padL"
      :pad-r="padR"
      :plot-w="plotW"
      :pad-t="padT"
      :plot-h="plotH"
      :boss="selectedBoss"
      :axis-nodes="bossPeriodAxis"
      :period-views="phaseViews"
      :main-agent-id="mainAgentId"
      :candidate-pool="candidatePool"
      :auto-build="autoBuild"
    />

    <!-- ============ Chart 5：抽卡价值 · 危局兑现（实战归档配对差分） ============ -->
    <!-- 整块已抽组件 components/charts/PullValueChart.vue（2026-09-14）；样式随组件走 -->
    <PullValueChart :svg-w="svgW" />

    <!-- ============ Chart 6：抽卡规划器（危局最优策略 + VCG 价值） ============ -->
    <n-card size="small" :bordered="true">
      <template #header>
        抽卡规划器 · 危局最优策略
        <span class="chart-subtitle">从起点节点、每版本 {{ PLANNER_FILM }}/菲林收入出发，beam search 规划限定卡抽取（本体/专武/满配阶梯，首 UP 窗口唯一），每期 3 Boss × 9 人不重叠组队最大化危局总分；卡价值 = VCG 反事实差分（禁用重规划的分数损失）</span>
      </template>
      <template #header-extra>
        <div class="chart3-actions">
          <n-select v-model:value="ppPreset" :options="ppPresetOptions" size="small" style="width: 170px" />
          <n-select v-model:value="ppStartDate" :options="ppStartOptions" size="small" style="width: 130px" filterable />
          <n-button size="small" type="primary" :loading="ppComputing" @click="runPlanner">
            {{ ppResult ? '重新规划' : '规划' }}
          </n-button>
        </div>
      </template>

      <!-- 参数 -->
      <div class="sim-controls">
        <div class="ctl-field">
          <span class="ctl-label">起点银行（菲林）</span>
          <n-input-number v-model:value="ppInitialBank" :min="0" :max="500000" :step="5000" size="small" style="width: 120px" />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">每版本菲林（默认 25000）</span>
          <n-input-number v-model:value="ppFilmPerVersion" :min="0" :max="100000" :step="1000" size="small" style="width: 120px" />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">beam 宽度</span>
          <n-input-number v-model:value="ppBeamWidth" :min="1" :max="16" size="small" style="width: 80px" />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">规划期数上限（0=全部）</span>
          <n-input-number v-model:value="ppMaxPeriods" :min="0" :max="47" size="small" style="width: 110px" />
        </div>
        <div class="ctl-field">
          <label class="ctl-check">
            <input v-model="ppWithVcg" type="checkbox" />
            VCG 卡价值归因（每卡一次重规划，慢）
          </label>
        </div>
        <div class="ctl-field ctl-hint">
          <span class="ctl-label">口径：分数 = 60000×伤害/当期Boss血量 + 5000 操作分（全满）；单房上限 65000。
            限定卡首 UP 窗口唯一可购（复刻不建模）；购买阶梯 = 本体 15000 → 专武 10000 → 满配。
            贬值内生（每期 Boss 血量/抗性数据驱动，无折现参数）。
            ⚠ 性能：默认参数（近起点 + beam 2 + 4 期）≈ 十秒级；调远起点/加大 beam/放开期数上限会进入分钟级——
            规划是同步计算，期间页面无响应属正常，请勿连点。想要全角色兑现曲线请用「角色兑现」页（基底队方案，秒级）。</span>
        </div>
      </div>

      <div v-if="ppComputing || ppProgress" class="chart-progress">
        <n-progress type="line" :percentage="Math.round((ppProgress?.pct ?? 0) * 100)" :show-indicator="false" :height="6" />
        <span class="progress-text">{{ ppProgress?.text ?? '' }}</span>
      </div>

      <template v-if="ppResult">
        <!-- 结果摘要 -->
        <div class="pv-summary">
          <span>规划 {{ ppResult!.plan.steps.length }} 期 · 总分 {{ fmt(ppResult!.plan.totalScore, 0) }}（均值 {{ fmt(ppResult!.plan.totalScore / Math.max(1, ppResult!.plan.steps.length), 0) }}/期）</span>
          <span>持有 {{ Object.keys(ppResult!.plan.holdings).filter(k => ppResult!.plan.holdings[k] > 0).length }} 张限定 · 累计花费 {{ compact(ppResult!.plan.totalSpent) }} 菲林 · 终态银行 {{ compact(ppResult!.plan.finalBank) }}</span>
          <span v-if="ppResult!.stats">引擎求值 {{ ppResult!.stats.evaluations }} 次（缓存命中 {{ ppResult!.stats.cacheHits }}）· 耗时 {{ (ppResult!.stats.durationMs / 1000).toFixed(1) }}s</span>
        </div>

        <!-- 泳道图例（点击显隐；泳道各自 y 固定，隐藏后留空位而不重排——避免开关一下整张图跳动） -->
        <div class="legend">
          <span class="legend-hint">点图例显隐泳道</span>
          <div
            v-for="d in ppLaneDefs"
            :key="d.id"
            class="legend-item"
            :class="{ off: !ppLegend.isVisible(d.id) }"
            :title="`${d.desc}：点击${ppLegend.isVisible(d.id) ? '隐藏' : '显示'}`"
            @click="ppLegend.toggle(d.id)"
          >
            <span class="swatch" :style="{ background: d.color }"></span><span class="name">{{ d.label }}</span>
          </div>
          <span class="legend-hint legend-action" @click="ppLegend.showAll()">全显示</span>
        </div>

        <!-- 策略甘特：期数 × 购买/队伍 -->
        <div class="timeline-wrap pp-plot">
          <svg :viewBox="`0 0 ${svgW} ${ppSvgH}`" class="timeline-svg">
            <!-- 期刻度 -->
            <g v-for="t in ppXTicks" :key="'ppx' + t.index">
              <line :x1="ppX(t.index)" :y1="ppPadT - 6" :x2="ppX(t.index)" :y2="ppSvgH - ppXLabelH" class="grid-line" />
              <text :x="ppX(t.index)" :y="ppSvgH - 8" text-anchor="middle" class="axis-label x-label">{{ t.label }}</text>
            </g>
            <!-- 购买泳道 -->
            <template v-if="ppLegend.isVisible('purchase')">
            <text :x="ppLabelW - 6" :y="ppPadT + 8" text-anchor="end" class="lane-label">购买</text>
            <g v-for="(st, i) in ppResult.plan.steps" :key="'ppp' + i">
              <rect
                v-for="(p, j) in st.purchases"
                :key="j"
                :x="ppX(i) - 9"
                :y="ppPadT - 6 + j * 14"
                :width="18" :height="12" rx="3"
                :fill="colorOf(p.agentId)"
                class="pp-purchase"
              >
                <title>{{ st.periodLabel }}：{{ agentName(p.agentId) }} {{ ppTierLabel(p.tier) }}（−{{ p.cost }} 菲林）</title>
              </rect>
              <text v-if="st.purchases.length > 0" :x="ppX(i)" :y="ppPadT + 30" text-anchor="middle" class="pp-purchase-label">
                {{ st.purchases.map(p => agentName(p.agentId)).join('/') }}
              </text>
            </g>
            </template>
            <!-- 分数折线（期总分 + 累计） -->
            <template v-if="ppLegend.isVisible('score')">
            <text :x="ppLabelW - 6" :y="ppScoreY(0) + 4" text-anchor="end" class="lane-label">期分</text>
            <polyline :points="ppScoreLine" class="pp-score-line" />
            <g v-for="(pt, i) in ppScorePts" :key="'pps' + i">
              <circle :cx="pt.x" :cy="pt.y" r="3" fill="var(--app-primary)" class="trend-point">
                <title>{{ pt.label }}：{{ fmt(pt.score, 0) }} 分</title>
              </circle>
            </g>
            </template>
            <!-- 三队伍泳道（当期 3 Boss 的选队） -->
            <template v-for="(lane, li) in ppVisibleTeamLanes" :key="'pptl' + li">
              <text :x="ppLabelW - 6" :y="lane.y + 10" text-anchor="end" class="lane-label">房{{ lane.roomNo }}</text>
              <g v-for="(cell, i) in lane.cells" :key="i">
                <rect
                  :x="ppX(i) - ppCellW / 2" :y="lane.y" :width="ppCellW - 1" :height="lane.h"
                  :fill="cell.empty ? 'var(--wa-30)' : 'rgba(99, 179, 237, 0.13)'"
                  class="lane-cell"
                >
                  <title>{{ cell.title }}</title>
                </rect>
                <text v-if="!cell.empty" :x="ppX(i)" :y="lane.y + lane.h / 2 + 3" text-anchor="middle" class="lane-text pp-team-text">
                  {{ cell.text }}
                </text>
              </g>
            </template>
          </svg>
        </div>

        <!-- VCG 台账 -->
        <div v-if="ppResult.values.length > 0" class="table-wrap pp-values">
          <table class="tl-table">
            <thead>
              <tr>
                <th>卡</th>
                <th>VCG 价值（分）</th>
                <th>禁用后总分</th>
                <th>规划终态档位</th>
                <th>折算（分/万菲林）</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in ppTopValues" :key="v.agentId" :class="{ 'pv-sel-row': v.value > 0 && v.tierInPlan > 0 }">
                <td><span class="dot" :style="{ background: colorOf(v.agentId) }"></span>{{ agentName(v.agentId) }}</td>
                <td :class="{ 'kill-line': v.value > 0 }">{{ fmt(v.value, 0) }}</td>
                <td>{{ fmt(v.baselineTotal, 0) }}</td>
                <td>{{ ppTierLabel(v.tierInPlan) }}</td>
                <td>{{ v.value > 0 && v.tierInPlan > 0 ? fmt(v.value / (v.tierInPlan === 3 ? 17 : v.tierInPlan === 2 ? 2.5 : 1.5), 0) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <div v-else class="empty-hint small-hint">
        选起点预设与起始节点后点「规划」：beam search 在每版本节点展开「买卡 / 攒菲林」分支，
        每期用真实引擎算 3 Boss × 9 人不重叠最优组队，全程最大化危局总分。勾选 VCG 出卡价值台账
        （禁用该卡重规划的分数损失——卢西娅式「专拐被禁 → 被迫用潘引壶」的机会差会直接呈现）。
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NCard, NSelect, NInputNumber, NButton, NProgress } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { type TeamTimelineResult } from '@/composables/teamTimeline'
import {
  TIMELINE_LAYOUT,
  buildTimelineChart,
  timelineBossLaneY,
  timelineLaneTotalH,
  timelineSvgWidth,
} from '@/composables/timelineChart'
import { computeStrengthBands, strengthBandTitle, type StrengthBand } from '@/composables/strengthBands'
import { hoverCardPosition, readSvgPointer } from '@/composables/svgPointer'
import { nearestIndexByX, xHitTolerance } from '@/composables/svgHitTest'
import ChartHoverCard, { type HoverCardRow } from '@/components/ChartHoverCard.vue'
import DirectDamageChart from '@/components/charts/DirectDamageChart.vue'
import PullValueChart from '@/components/charts/PullValueChart.vue'
import NewCharacterChart from '@/components/charts/NewCharacterChart.vue'
import FilmSimChart from '@/components/charts/FilmSimChart.vue'
import SlotCompareChart from '@/components/charts/SlotCompareChart.vue'
import TimeChartsControls from '@/components/charts/TimeChartsControls.vue'
import { buildTimelineHoverInfo } from '@/composables/charts/hoverInfoBuilders'
import {
  buildPlannerChart,
  PP_LANE_DEFS,
  ppTierLabelOf,
} from '@/composables/pullPlannerChart'
import { buildPeriodAxis, type PeriodAxisNode } from '@/composables/bossSchedule'
import { PLANNER_FILM_PER_VERSION } from '@/data/filmEconomy'
import { runPullPlanner, type PlannerRunResult } from '@/composables/pullPlannerEngine'
import { AGENT_RELEASE_NODE, VERSION_NODES, nodeIndexOf } from '@/data/versionTimeline'
import { buildDirectDamageTimeline } from '@/composables/multiplierCoefficients'
import { useSeriesFilter } from '@/composables/seriesFilter'
// 第一片拆分（2026-09-13）：纯展示助手 / 悬浮卡行 / 跑批编排 出函到 composables/charts/
import { benchText, bossCellText, bossCellTitle, colorOf, swapKindLabel } from '@/composables/charts/agentPresentation'
import { timelineHoverRows as buildTimelineHoverRows } from '@/composables/charts/hoverCardRows'
import { runTeamTimelineCompute } from '@/composables/charts/chartRunners'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, BossPresetFile, PhaseView } from '@/types/bossPreset'

useConfigStore()
const catalogStore = useCatalogStore()
const calc = useResourceCalc()

// ========== 主C 选择（只列 S 级：AGENT_RELEASE_NODE 收录即 S 级） ==========
const mainAgentId = ref('1371') // 默认仪玄（用户指定先做仪玄验证）
const mainAgentOptions = computed(() =>
  Object.keys(AGENT_RELEASE_NODE)
    .sort((a, b) => nodeIndexOf(AGENT_RELEASE_NODE[a]) - nodeIndexOf(AGENT_RELEASE_NODE[b]))
    .map(id => ({
      value: id,
      label: `${catalogStore.getAgent(id)?.name.zhCN ?? id}（${AGENT_RELEASE_NODE[id]}）`,
    })),
)

// ========== Boss（必选直选；期数概念已移除——横轴固定为主C实装起到最新） ==========
const bossPresets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])
const selectedBossId = ref('')

/** Boss 最近一次出场开打时间（倒序排列用） */
function latestBeginOf(b: BossPreset): string {
  let latest = ''
  for (const ph of b.phases) {
    if (ph.begin > latest) latest = ph.begin
  }
  return latest
}
const bossOptions = computed(() =>
  [...bossPresets.value]
    .sort((a, b) => latestBeginOf(b).localeCompare(latestBeginOf(a)))
    .map(b => ({ value: b.id, label: b.name })),
)

onMounted(async () => {
  try {
    const res = await fetch('/static/boss-presets.json')
    if (res.ok) {
      const data = (await res.json()) as BossPresetFile
      bossPresets.value = data.bosses ?? []
      phaseViews.value = data.phaseViews ?? []
      // 默认选最新危局 Boss（无危局期数的 Boss 不作默认）
      const withCA = bossOptions.value.filter(o => {
        const b = bossPresets.value.find(x => x.id === o.value)
        return b?.phases.some(p => p.modeType === 'critical_assault')
      })
      selectedBossId.value = withCA[0]?.value ?? bossOptions.value[0]?.value ?? ''
    }
  } catch { /* boss 数据缺失时页面显示引导 */ }
})

const selectedBoss = computed(() => bossPresets.value.find(b => b.id === selectedBossId.value) ?? null)
/** 数值取该 Boss 最新一期：优先危局，否则最新期（结果标题会显示所用期数） */
const selectedPhase = computed(() => {
  const b = selectedBoss.value
  if (!b) return null
  const sorted = [...b.phases].filter(p => p.begin).sort((x, y) => y.begin.localeCompare(x.begin))
  return sorted.find(p => p.modeType === 'critical_assault') ?? sorted[0] ?? b.phases[0] ?? null
})

// ========== 危局期数轴（横轴：一版约 3 期、每期 ~14 天）+ 每期 Boss 排期 ==========
// 演变只看危局·普通（defense）；危局·困难（critical_assault）仅记录不作为轴依据。测试服占位期默认剔除。
const testServerVersions = computed(() => new Set(VERSION_NODES.filter(n => (n.note ?? '').includes('测试服')).map(n => n.version)))
const periodAxis = computed(() =>
  buildPeriodAxis(bossPresets.value, { testServerVersions: testServerVersions.value }),
)
const periodById = computed(() => new Map(periodAxis.value.map(p => [p.id, p])))
/** 所选 Boss 的登场期数（从首次登场起）：横轴只算这些期，体现对抗单 Boss 的队伍成长 */
const bossPeriodAxis = computed(() => {
  const boss = selectedBoss.value
  if (!boss) return []
  return periodAxis.value.filter(p => [...p.normalBosses, ...p.criticalBosses].some(b => b.bossId === boss.id))
})
function periodOf(nodeId: string): PeriodAxisNode | undefined {
  return periodById.value.get(nodeId)
}
// bossCellText / bossCellTitle 已出函 composables/charts/agentPresentation.ts（第一片拆分）；
// 搬迁后入参改为已解析的 PeriodAxisNode，调用点传 `periodOf(nodeId)`，判定与文案逐字不变。
const selectedBossAppearances = computed(() => {
  const out = new Set<string>()
  if (!selectedBossId.value) return out
  for (const [pid, p] of periodById.value) {
    if ([...p.normalBosses, ...p.criticalBosses].some(b => b.bossId === selectedBossId.value)) out.add(pid)
  }
  return out
})
const selectedBossName = computed(() => bossPresets.value.find(b => b.id === selectedBossId.value)?.name ?? '')
const appearanceLabels = computed(() =>
  (result.value?.nodes ?? []).filter(n => selectedBossAppearances.value.has(n.nodeId)).map(n => n.nodeLabel),
)

// ========== 金数 ==========
const budget = ref(6)

// ========== 候选队友策展池（localStorage 持久化；轻量速算 = 只枚举池内 C(n,2) 组合） ==========
const CANDIDATE_POOL_KEY = 'zzz-timeline-candidate-pool'
/** 用户口径种子：仪玄演变路径的队友（青衣/潘引壶/橘福福/卢西娅/琉音） */
const DEFAULT_CANDIDATE_POOL = ['1251', '1421', '1391', '1451', '1481']
const candidatePool = ref<string[]>(loadCandidatePool())
function loadCandidatePool(): string[] {
  try {
    const raw = localStorage.getItem(CANDIDATE_POOL_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const valid = arr.filter((id: unknown) => typeof id === 'string' && id !== '1371' && AGENT_RELEASE_NODE[id as string])
        if (valid.length >= 2) return valid as string[]
      }
    }
  } catch { /* 损坏回落默认 */ }
  return [...DEFAULT_CANDIDATE_POOL]
}
watch(candidatePool, v => {
  try { localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(v)) } catch { /* 忽略 */ }
}, { deep: true })
const autoBuild = ref(false)
const optimalGold = ref(false)
const candidateOptions = Object.keys(AGENT_RELEASE_NODE)
  .sort((x, y) => nodeIndexOf(AGENT_RELEASE_NODE[x]) - nodeIndexOf(AGENT_RELEASE_NODE[y]))
  .map(id => ({ value: id, label: `${catalogStore.getAgent(id)?.name.zhCN ?? id}（${AGENT_RELEASE_NODE[id]}）` }))

// ========== 计算 ==========
const computing = ref(false)
const progress = ref<{ pct: number; text: string } | null>(null)
const result = ref<TeamTimelineResult | null>(null)

async function runCompute() {
  // 校验/装配/调用已出函 composables/charts/chartRunners.ts#runTeamTimelineCompute（第一片拆分，逐字搬迁）
  await runTeamTimelineCompute({
    calc, computing, progress, result,
    boss: selectedBoss.value,
    phase: selectedPhase.value,
    mainAgentId: mainAgentId.value,
    // 横轴刻度用期号（seq，如「45」代表 69045）；只算所选 Boss 登场的期数
    axisNodes: bossPeriodAxis.value.map(p => ({ id: p.id, label: `${p.seq}`, date: p.begin })),
    candidatePool: candidatePool.value,
    budget: budget.value,
    autoBuild: autoBuild.value,
    optimalGold: optimalGold.value,
  })
}

// ========== 颜色 ==========
// PALETTE / colorOf 已出函 composables/charts/agentPresentation.ts（第一片拆分，原样搬迁）
function agentName(id: string): string {
  return catalogStore.getAgent(id)?.name.zhCN ?? id
}

// ========== SVG 布局 ==========
// 时间线图几何/标度已抽到 composables/timelineChart.ts（纯函数，可单测）；
// 此处只留同名适配层（模板与其余图表零改动）。
const svgW = computed(() => timelineSvgWidth(typeof window !== 'undefined' ? window.innerWidth : undefined))
const { padL, padR, padT, plotH, laneH, xLabelH } = TIMELINE_LAYOUT
const laneTotalH = timelineLaneTotalH()
const bossLaneY = timelineBossLaneY()
const tl = computed(() => buildTimelineChart({
  nodes: result.value?.nodes ?? [],
  svgW: svgW.value,
  nameOf: (id) => agentName(id),
  colorOf: (id) => colorOf(id),
}))
const svgH = computed(() => tl.value.svgH)
const nodeCount = computed(() => tl.value.nodeCount)
const plotW = computed(() => tl.value.plotW)
const cellW = computed(() => tl.value.cellW)
const yMax = computed(() => tl.value.yMax)
function yOf(v: number): number { return tl.value.yOf(v) }
const yTicks = computed(() => tl.value.yTicks)
function yLabel(i: number): number { return tl.value.yLabel(i) }
const chartPts = computed(() => tl.value.chartPts)
const linePoints = computed(() => tl.value.linePoints)
const swapGuides = computed(() => tl.value.swapGuides)
const laneDefs = computed(() => tl.value.laneDefs)
const xTicks = computed(() => tl.value.xTicks)

// 悬浮
// 悬浮
const hoverNode = ref(-1)
// swapKindLabel / benchText 已出函 composables/charts/agentPresentation.ts（第一片拆分）；
// benchText 搬迁后需注入 `nameOf`（原闭包本页 agentName），调用点改为传 `agentName`。
/** 构造已出函 composables/charts/hoverInfoBuilders.ts（第二片拆分）；依赖经参数注入 */
const hoverInfo = computed(() =>
  buildTimelineHoverInfo(result.value?.nodes[hoverNode.value], { agentName, periodOf }))

/** 悬浮卡行（外壳组件只负责样式与布局；行内容随图而异）——构造已出函 composables/charts/hoverCardRows.ts */
const hoverRows = computed<HoverCardRow[]>(() => buildTimelineHoverRows(hoverInfo.value))
// ========== 多队并存强度（演示.xlsx 口径：队伍×版本矩阵，跌出 Top-K 即永久淘汰） ==========
const survivalK = ref(3)
const strengthBands = computed<StrengthBand[]>(() =>
  computeStrengthBands(result.value?.strengthSeeds ?? [], result.value?.nodes.length ?? 0, survivalK.value),
)

// ========== 图例筛选（Chart 2：多队并存强度） ==========
// 与散点/曲线不同，这里的筛选**只作用于画不画那条带**：Top-K 排名与淘汰判定是数据性质
// （K 是游戏里的并存约束，不是显示选项），隐藏一队不会让别的队「递补存活」——
// 那会造出一个不存在的强度结论。所以 strengthBands 全量保留，只在模板里按可见性跳过。
const strengthLegend = useSeriesFilter(() =>
  strengthBands.value.map(b => ({ id: b.seed.key, name: b.seed.shortLabel })),
)
const strengthCounts = strengthLegend.counts
/** 图上真正画出的带（隐藏的跳过；排名/淘汰标注仍按全量算） */
const visibleStrengthBands = computed(() => strengthBands.value.filter(b => strengthLegend.isVisible(b.seed.key)))
const strengthSvgH = computed(() => padT + plotH + 12 + xLabelH)
/** 横带 Y = 血量% 尺度，钳制进绘图区 */
function bandY(hpRatio: number): number {
  return yOf(Math.min(hpRatio, yMax.value))
}
function bandTitle(b: StrengthBand): string {
  return strengthBandTitle(b, {
    k: survivalK.value,
    nameOf: (id) => agentName(id),
    labelOf: (i) => result.value?.nodes[i]?.nodeLabel,
    fmtCompact: compact,
    fmtRatio: fmt,
  })
}
const hoverCardX = ref(0)
const hoverCardY = ref(0)
function onSvgMove(e: MouseEvent) {
  const { relX, relY, svgX, rect } = readSvgPointer(e, { w: svgW.value, h: svgH.value })
  if (nodeCount.value <= 0) return
  const { index: best, distance: bestDist } = nearestIndexByX(chartPts.value, svgX)
  if (best >= 0 && bestDist < xHitTolerance(plotW.value, nodeCount.value, 1)) {
    hoverNode.value = best
    const card = hoverCardPosition({ relX, relY, containerWidth: rect.width, cardWidth: 240 })
    hoverCardX.value = card.x
    hoverCardY.value = card.y
  } else {
    hoverNode.value = -1
  }
}
// ============ 限定S首次UP × 版本直伤系数（倍率演算引擎静态推导，见 composables/multiplierCoefficients.ts） ============

const ddPoints = computed(() =>
  buildDirectDamageTimeline(catalogStore.catalog?.agents ?? [], catalogStore.catalog?.agentSkills ?? []),
)

// 几何/标度/分档/筛选全部随组件走（components/charts/DirectDamageChart.vue）。
// 本页只负责把数据传进去：`ddPoints` 是直伤系数时间线。
// ========== Chart 6：抽卡规划器（beam search 最优策略 + VCG 价值归因） ==========
const PLANNER_FILM = PLANNER_FILM_PER_VERSION
const ppPreset = ref<'fresh' | 'established' | 'custom'>('established')
const ppPresetOptions = [
  { value: 'established', label: '成型号（常驻S+A 免费，0 限定）' },
  { value: 'fresh', label: '新号（全限定待抽）' },
  { value: 'custom', label: '自选持有（暂同成型号）' },
]
const ppStartDate = ref('2026-07-08')
/** 起点候选 = 版本节点日期（近 12 个） */
const ppStartOptions = computed(() =>
  VERSION_NODES.slice(-14).map(n => ({ value: n.date, label: `${n.label}（${n.date}）` })),
)
const ppInitialBank = ref(30000)
const ppFilmPerVersion = ref(PLANNER_FILM_PER_VERSION)
const ppBeamWidth = ref(2)
const ppMaxPeriods = ref(1)
const ppWithVcg = ref(false)
const ppComputing = ref(false)
const ppProgress = ref<{ pct: number; text: string } | null>(null)
const ppResult = ref<PlannerRunResult | null>(null)

async function runPlanner() {
  const catalog = catalogStore
  const boss = selectedBoss.value
  if (!boss) {
    ppProgress.value = { pct: 1, text: '先选 Boss（顶部）' }
    setTimeout(() => { ppProgress.value = null }, 2500)
    return
  }
  ppComputing.value = true
  ppProgress.value = { pct: 0, text: '准备…' }
  await nextTick()
  try {
    ppResult.value = await runPullPlanner({
      calc,
      allBosses: bossPresets.value,
      boss,
      periodViews: phaseViews.value,
      allAgentIds: catalog.displayAgents.map(a => a.id),
      preset: ppPreset.value,
      startDate: ppStartDate.value,
      maxPeriods: ppMaxPeriods.value || undefined,
      initialBank: ppInitialBank.value,
      filmPerVersion: ppFilmPerVersion.value,
      beamWidth: ppBeamWidth.value,
      assignmentTopM: 6,
      withVcg: ppWithVcg.value,
      onProgress: p => { ppProgress.value = p },
    })
  } catch (e) {
    ppProgress.value = { pct: 1, text: `规划失败：${e instanceof Error ? e.message : String(e)}` }
    setTimeout(() => { ppProgress.value = null }, 4000)
  } finally {
    ppComputing.value = false
  }
}

// ---- Chart 6 几何与泳道模型：见 composables/pullPlannerChart.ts（纯函数，可单测）----
const ppc = computed(() => buildPlannerChart({
  steps: ppResult.value?.plan.steps ?? [],
  svgW: svgW.value,
  nameOf: (id) => agentName(id),
  fmt,
  isLaneVisible: (id) => ppLegend.isVisible(id),
}))
const ppLaneDefs = PP_LANE_DEFS
const ppLegend = useSeriesFilter(() => ppLaneDefs.map(d => ({ id: d.id, name: d.label })))
const ppLabelW = ppc.value.labelW
const ppPadT = ppc.value.padT
const ppXLabelH = ppc.value.xLabelH
const ppSvgH = computed(() => ppc.value.svgH)
const ppCellW = computed(() => ppc.value.cellW)
function ppX(i: number): number { return ppc.value.x(i) }
const ppXTicks = computed(() => ppc.value.xTicks)
function ppScoreY(v: number): number { return ppc.value.scoreY(v) }
const ppScorePts = computed(() => ppc.value.scorePts)
const ppScoreLine = computed(() => ppc.value.scoreLine)
const ppVisibleTeamLanes = computed(() => ppc.value.visibleTeamLanes)
const ppTierLabel = ppTierLabelOf
const ppTopValues = computed(() => (ppResult.value?.values ?? []).slice(0, 20))
</script>

<style scoped src="./timeCharts/TimeChartsPage.css"></style>
<!-- 图表块通用基元（页内多块共享）：独立文件 + scoped src ⇒ 带本页 scope id、特异性不变，源码仅一份。
     为什么不能放全局表、以及搬运时踩过的「逗号选择器组」坑，见 src/styles/chart-blocks.css 文件头。 -->
<style scoped src="@/styles/chart-blocks.css"></style>
