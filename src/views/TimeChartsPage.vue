<template>
  <div class="time-charts-page">
    <!-- ============ 控制面板 ============ -->
    <n-card size="small" :bordered="true">
      <div class="chart-controls">
        <div class="ctl-field">
          <span class="ctl-label">主C角色（S级）</span>
          <n-select
            v-model:value="mainAgentId"
            :options="mainAgentOptions"
            size="small"
            filterable
            style="width: 200px"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">Boss</span>
          <n-select
            v-model:value="selectedBossId"
            :options="bossOptions"
            size="small"
            filterable
            style="width: 240px"
            placeholder="选择 Boss（必选，默认最新危局）"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">限定金预算</span>
          <n-input-number
            v-model:value="budget"
            :min="0"
            :max="24"
            size="small"
            style="width: 110px"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">候选队友（策展池）</span>
          <n-select
            v-model:value="candidatePool"
            :options="candidateOptions"
            multiple
            size="small"
            filterable
            style="width: 340px"
            placeholder="至少 2 名；默认 青衣/潘引壶/橘福福/卢西娅/琉音"
          />
        </div>
        <div class="ctl-field">
          <label class="ctl-check">
            <input v-model="autoBuild" type="checkbox" />
            自动配装（推荐+词条优化，慢）
          </label>
          <label class="ctl-check">
            <input v-model="optimalGold" type="checkbox" />
            最优加金分配（逐金贪婪，慢）
          </label>
        </div>
        <div class="ctl-field">
          <n-button type="primary" size="small" :loading="computing" @click="runCompute">
            {{ result ? '重新计算' : '计算' }}
          </n-button>
        </div>
        <div class="ctl-field ctl-hint">
          <span class="ctl-label">说明：只枚举候选池内组合（C(n,2)，每队只算一次——同队跨期面对同一 Boss 数值不变，
            当期 Buff 不参与），默认轻量速算 = 兜底配装 + 主C优先确定性加金；
            勾选「自动配装 / 最优加金」切换全量档（慢）。横轴 = 所选 Boss 登场的危局期数（期号如「45」代表 69045；一版约 3 期、每期 ~14 天，只看普通模式），从其首次登场起算到最新——只对抗这一个 Boss 看队伍成长；角色期数中途实装也算该期可用。</span>
        </div>
      </div>

      <!-- Boss 数据（所选 Boss 最新危局期的数值；换 Boss 即切换） -->
      <div v-if="selectedBoss && selectedPhase" class="boss-data-strip">
        <span class="boss-data-title">Boss 数据 · {{ selectedBoss.name }}</span>
        <span class="boss-data-item">期 {{ selectedPhase.label }}</span>
        <span class="boss-data-item">血量 {{ compact(selectedPhase.hp) }}</span>
        <span class="boss-data-item">失衡值 {{ fmt(selectedPhase.stunValue, 0) }}</span>
        <span class="boss-data-item">防御 {{ selectedPhase.defense }}</span>
        <span class="boss-data-item">Lv{{ selectedPhase.level }}</span>
        <span class="boss-data-item">异常系数 ×{{ selectedPhase.bossAnomalyCoeff }}</span>
        <span class="boss-data-item">失衡倍率 ×{{ selectedBoss.monster.stunVuln }}</span>
        <span class="boss-data-item">失衡时间 {{ fmt(selectedBoss.monster.stunTime, 1) }}s</span>
        <span class="boss-data-item">战斗 {{ selectedBoss.defaults.battleTime }}s</span>
        <span class="boss-data-item">弱点 {{ selectedPhase.weakness.join('/') || '—' }}</span>
        <span class="boss-data-item">抗性 {{ selectedPhase.resistance.join('/') || '—' }}</span>
      </div>

      <!-- 进度条 -->
      <div v-if="computing || progress" class="chart-progress">
        <n-progress
          type="line"
          :percentage="Math.round((progress?.pct ?? 0) * 100)"
          :show-indicator="false"
          :height="6"
        />
        <span class="progress-text">{{ progress?.text ?? '' }}</span>
      </div>
    </n-card>

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
              <title>{{ bossCellTitle(n.nodeId) }}</title>
            </rect>
            <text
              :x="padL + i * cellW + 4"
              :y="bossLaneY + laneH / 2 + 3"
              class="lane-text"
              :class="{ 'boss-hit': selectedBossAppearances.has(n.nodeId) }"
            >{{ bossCellText(n.nodeId) || '—' }}</text>
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

      <!-- 悬浮卡片 -->
      <div
        v-if="hoverNode >= 0 && hoverInfo"
        class="hover-card"
        :style="{ left: hoverCardX + 'px', top: hoverCardY + 'px' }"
      >
        <div class="hc-title">{{ hoverInfo.nodeLabel }}</div>
        <div class="hc-row">队伍：{{ hoverInfo.teamNames.join(' + ') }}</div>
        <div class="hc-row">伤害 {{ compact(hoverInfo.damage) }}（{{ fmt(hoverInfo.hpRatio, 1) }}%）</div>
        <div class="hc-row">{{ hoverInfo.goldLabel }}</div>
        <div v-if="hoverInfo.schedule" class="hc-row">{{ hoverInfo.schedule }}</div>
        <div v-if="hoverInfo.swap" class="hc-row hc-swap">{{ hoverInfo.swap }}</div>
        <div v-if="hoverInfo.bench" class="hc-row hc-bench">{{ hoverInfo.bench }}</div>
      </div>
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
                  v-if="bossCellText(r.nodeId)"
                  :class="{ 'boss-hit': selectedBossAppearances.has(r.nodeId) }"
                >{{ bossCellText(r.nodeId) }}</span>
                <span v-else class="no-change">—</span>
              </td>
              <td>
                <span v-if="r.swappedIn" class="swap-badge">
                  换入 {{ agentName(r.swappedIn) }} ⬅ 换出 {{ agentName(r.swappedOut ?? '') }}
                  <span v-if="r.swapKind" class="swap-kind" :class="r.swapKind">{{ swapKindLabel(r.swapKind, r.swapUpliftPct) }}</span>
                </span>
                <span v-else-if="r.newAgentBench" class="bench-note">{{ benchText(r.newAgentBench) }}</span>
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
    <n-card
      size="small"
      :bordered="true"
      title="限定S首次UP · 版本直伤系数（中心系数 = 支援突击伤害 / 标准值；支援突击通常不随角色改版，偏离即历代直伤膨胀档位）"
    >
      <!-- 档位筛选（点图例显隐；三档就是散点颜色的语义，与图例同一把尺） -->
      <div class="legend">
        <span class="legend-hint">点图例显隐档位</span>
        <div
          v-for="band in ddBandDefs"
          :key="band.id"
          class="legend-item"
          :class="{ off: !ddLegend.isVisible(band.id) }"
          :title="`${band.desc}：点击${ddLegend.isVisible(band.id) ? '隐藏' : '显示'}该档（Y 轴固定 0.7~1.3 档位口径，不随筛选缩放）`"
          @click="ddLegend.toggle(band.id)"
        >
          <span class="swatch" :style="{ background: band.color }"></span><span class="name">{{ band.label }}</span>
        </div>
      </div>
      <svg :width="svgW" :height="ddSvgH" class="dd-svg">
        <!-- 测试服节点阴影 -->
        <rect
          v-for="r in ddTestServerRects"
          :key="`ddts${r.x}`"
          :x="r.x"
          :y="ddPadT"
          :width="r.w"
          :height="ddPlotBottom - ddPadT"
          fill="rgba(246, 173, 85, 0.06)"
        />
        <!-- 版本分隔网格 + 版本号刻度（网格线在版本列左缘，刻度文字在列中心） -->
        <g v-for="t in ddXTicks" :key="`ddx${t.index}`">
          <line :x1="ddX(t.index)" :y1="ddPadT" :x2="ddX(t.index)" :y2="ddPlotBottom" style="stroke: var(--wa-60)" />
          <text :x="ddTickCenterX(t.index)" :y="ddPlotBottom + 14" text-anchor="middle" class="dd-tick">{{ t.label }}</text>
        </g>
        <!-- y 刻度 -->
        <text v-for="t in ddYTicks" :key="`ddy${t}`" :x="ddPadL - 6" :y="ddY(t) + 4" text-anchor="end" class="dd-tick">
          {{ Math.round(t * 100) }}%
        </text>
        <!-- 100% 基准线 -->
        <line
          :x1="ddPadL"
          :y1="ddY(1)"
          :x2="svgW - ddPadR"
          :y2="ddY(1)"
          style="stroke: var(--wa-280)"
          stroke-dasharray="4 4"
        />
        <text :x="svgW - ddPadR - 2" :y="ddY(1) - 5" text-anchor="end" class="dd-baseline">100% 标准</text>
        <!-- 散点（按档位筛选：隐藏档不画；标签槽位仍按全量算 ⇒ 不因筛选而重排） -->
        <g v-for="p in ddVisiblePoints" :key="`ddp${p.agentId}`">
          <circle
            v-if="p.value != null"
            :cx="ddCX(p.nodeIndex) + ddJitter(p.agentId)"
            :cy="ddY(p.value)"
            r="4"
            :style="{ fill: ddColor(p.value) }"
          >
            <title>{{ p.agentName }}（{{ p.nodeLabel }}{{ p.nodeNote ? '，' + p.nodeNote : '' }}）：{{ (p.value * 100).toFixed(1) }}%</title>
          </circle>
          <text
            v-if="p.value != null && ddNeedLabel(p.value)"
            :x="ddCX(p.nodeIndex) + ddJitter(p.agentId)"
            :y="ddLabelY(p)"
            text-anchor="middle"
            class="dd-label"
          >{{ ddShortName(p.agentName) }}</text>
        </g>
      </svg>
      <div class="dd-caption">
        每点 = 一位限定S在其首次 UP 节点的支援突击伤害比值。灰 ≈100%（无直伤特调）、蓝 &gt;105%（当期加强档）、橙 &lt;95%；悬停看数值。3.2 阴影为测试服数据；常驻 S 与 A 级不参与。演算口径见「倍率系数记录」页。
      </div>
    </n-card>

    <!-- ============ Chart 3：每期新角色 · 强队强度（横轴 = 版本，点 = 当期新角色强队，用户清单 + 引擎辅助） ============ -->
    <n-card size="small" :bordered="true">
      <template #header>
        每期新角色 · 强队强度
        <span class="chart-subtitle">横轴 = 版本（卡池期）；点 = 当期新 S 角色的强队（纯用户手填展示，同角色可加多队对比；按当前全部已实装 + 所选金数配装）</span>
      </template>
      <template #header-extra>
        <div class="chart3-actions">
          <span class="ctl-label">未配置强队的角色不出点</span>
          <n-button size="small" type="primary" :loading="chart3Computing" @click="runChart3">
            {{ chart3Points.length > 0 ? '重新计算强队图' : '计算强队图' }}
          </n-button>
        </div>
      </template>

      <!-- 强队清单（版本 → 新角色 → 强队列表；同角色多队 = 同一时间点多点展示） -->
      <div class="table-wrap chart3-list">
        <table class="tl-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>当期新角色</th>
              <th>强队（每支 = 主C + 队友1 + 队友2；可添加多支）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in chart3Rows" :key="row.charId">
              <td>
                {{ row.nodeLabel }}
                <span v-if="row.nodeNote" class="node-note" :title="row.nodeNote">{{ row.nodeNote }}</span>
              </td>
              <td>
                <span class="dot" :style="{ background: colorOf(row.charId) }"></span>{{ agentName(row.charId) }}
              </td>
              <td class="chart3-teams-cell">
                <div v-for="(team, ti) in chart3Teams[row.charId]" :key="ti" class="team-cell chart3-team-inputs">
                  <span class="team-no">{{ ti + 1 }}</span>
                  <n-select
                    v-model:value="team[0]"
                    :options="allAgentOptions"
                    size="tiny"
                    filterable
                    style="width: 118px"
                    placeholder="主C"
                  />
                  <n-select
                    v-model:value="team[1]"
                    :options="allAgentOptions"
                    size="tiny"
                    filterable
                    style="width: 118px"
                    placeholder="队友1"
                  />
                  <n-select
                    v-model:value="team[2]"
                    :options="allAgentOptions"
                    size="tiny"
                    filterable
                    style="width: 118px"
                    placeholder="队友2"
                  />
                  <n-button size="tiny" quaternary @click="removeChart3Team(row.charId, ti)">✕</n-button>
                </div>
                <n-button size="tiny" quaternary dashed class="add-team-btn" @click="addChart3Team(row.charId)">＋ 添加队伍</n-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 强队强度散点 -->
      <div v-if="chart3Points.length > 0" class="timeline-wrap chart3-plot">
        <svg
          :viewBox="`0 0 ${svgW} ${chart3SvgH}`"
          class="timeline-svg"
          @mousemove="onChart3Move"
          @mouseleave="chart3Hover = -1"
        >
          <g v-for="(y, i) in chart3YGrid" :key="'c3g' + i">
            <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
            <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ chart3YLabel(i) }}%</text>
          </g>
          <!-- 100% 击杀线 -->
          <line :x1="padL" :y1="yOf3(100)" :x2="svgW - padR" :y2="yOf3(100)" class="kill-line-ref" />
          <text :x="svgW - padR - 2" :y="yOf3(100) - 5" class="axis-label" text-anchor="end">100% 击杀线</text>
          <!-- X 轴版本刻度 -->
          <g v-for="t in chart3XTicks" :key="'c3x' + t.index">
            <line :x1="chart3X(t.index)" :y1="padT" :x2="chart3X(t.index)" :y2="padT + plotH" style="stroke: var(--wa-60)" />
            <text :x="chart3X(t.index)" :y="chart3SvgH - 8" class="axis-label x-label" text-anchor="middle">{{ t.label }}</text>
          </g>
          <!-- 点 -->
          <g v-for="(p, i) in chart3Pts" :key="'c3p' + i">
            <circle
              :cx="p.x"
              :cy="p.y"
              r="4.5"
              :fill="p.color"
              :style="{ stroke: chart3Hover === i ? 'var(--app-text-solid)' : 'var(--wa-250)' }"
              :stroke-width="chart3Hover === i ? 2 : 1"
              class="trend-point"
            >
              <title>{{ p.charName }}：{{ p.teamNames.join('+') }}（{{ fmt(p.hpRatio, 1) }}%）</title>
            </circle>
          </g>
          <line
            v-if="chart3Hover >= 0"
            :x1="chart3Pts[chart3Hover].x" :y1="padT"
            :x2="chart3Pts[chart3Hover].x" :y2="padT + plotH"
            class="hover-line"
          />
        </svg>

        <!-- 图例（点击显隐某支队；隐藏队的点不画，且退出 Y 轴刻度与悬浮命中——筛选传导到派生量） -->
        <div class="legend">
          <span class="legend-hint">点图例显隐 · 显示 {{ chart3Counts.visible }}/{{ chart3Counts.total }} 支队</span>
          <div
            v-for="s in chart3Series"
            :key="s.id"
            class="legend-item"
            :class="{ off: !chart3Legend.isVisible(s.id) }"
            :title="`${s.name}：点击${chart3Legend.isVisible(s.id) ? '隐藏' : '显示'}（隐藏后不参与 Y 轴刻度）`"
            @click="chart3Legend.toggle(s.id)"
          >
            <span class="swatch" :style="{ background: colorOf(s.id) }"></span>
            <span class="name">{{ s.name }}</span>
          </div>
          <span class="legend-hint legend-action" @click="chart3Legend.showAll()">全显示</span>
        </div>

        <!-- 悬浮卡片 -->
        <div
          v-if="chart3Hover >= 0 && chart3HoverInfo"
          class="hover-card"
          :style="{ left: chart3CardX + 'px', top: chart3CardY + 'px' }"
        >
          <div class="hc-title">{{ chart3HoverInfo.nodeLabel }} · {{ chart3HoverInfo.charName }} · 第{{ chart3HoverInfo.teamNo }}队</div>
          <div class="hc-row">强队：{{ chart3HoverInfo.teamNames.join(' + ') }}</div>
          <div class="hc-row">伤害 {{ compact(chart3HoverInfo.damage) }}（{{ fmt(chart3HoverInfo.hpRatio, 1) }}%）</div>
          <div class="hc-row">{{ chart3HoverInfo.goldLabel }}</div>
        </div>
      </div>
      <div v-else class="empty-hint small-hint">
        为角色配置强队（手填三人或点「引擎建议」）后点「计算强队图」；预填 = 仓库 preset 队伍。
      </div>

      <!-- 进度条 -->
      <div v-if="chart3Computing || chart3Progress" class="chart-progress">
        <n-progress
          type="line"
          :percentage="Math.round((chart3Progress?.pct ?? 0) * 100)"
          :show-indicator="false"
          :height="6"
        />
        <span class="progress-text">{{ chart3Progress?.text ?? '' }}</span>
      </div>
    </n-card>

    <!-- ============ Chart 7：同槽位角色对比（预设中其余两槽相同、所选槽位 A/B 两队） ============ -->
    <n-card size="small" :bordered="true">
      <template #header>
        同槽位角色对比
        <span class="chart-subtitle">
          横轴 = 主C实装节点；每组 = 预设中「其余两槽相同、{{ scSlotLabel }}位恰好一队
          {{ agentName(scAgentA) }}、一队 {{ agentName(scAgentB) }}」的两支队伍；
          {{ agentName(scAgentA) }} 队连成蓝线、{{ agentName(scAgentB) }} 队连成橙线，孰高孰低即该主C下谁更强。
          纵轴 = 伤害自动刻度（贴合数据范围，不看 Boss 血量/击杀线）；Boss 可单独切换（默认跟随顶部），
          不同 Boss 的弱点/抗性对不同角色克制不同。预算/配装口径同顶部各图
        </span>
      </template>
      <template #header-extra>
        <div class="chart3-actions">
          <n-select v-model:value="scSlot" :options="scSlotOptions" size="small" style="width: 92px" />
          <n-select v-model:value="scAgentA" :options="allAgentOptions" size="small" filterable style="width: 140px" />
          <n-select v-model:value="scAgentB" :options="allAgentOptions" size="small" filterable style="width: 140px" />
          <n-select
            v-model:value="scBossId"
            :options="bossOptions"
            size="small"
            filterable
            style="width: 170px"
            placeholder="Boss（默认跟随顶部）"
            @update:value="scBossTouched = true"
          />
          <n-button size="small" type="primary" :loading="scComputing" @click="runSlotCompare">
            {{ scPoints.length > 0 ? '重新对比' : '对比' }}
          </n-button>
        </div>
      </template>

      <!-- 进度条 -->
      <div v-if="scComputing || scProgress" class="chart-progress">
        <n-progress
          type="line"
          :percentage="Math.round((scProgress?.pct ?? 0) * 100)"
          :show-indicator="false"
          :height="6"
        />
        <span class="progress-text">{{ scProgress?.text ?? '' }}</span>
      </div>

      <!-- 双折线 SVG -->
      <div v-if="scPoints.length > 0" class="timeline-wrap chart3-plot">
        <div class="sc-legend">
          <span class="sc-legend-item sc-legend-click" :class="{ off: !scLegend.isVisible('A') }" @click="scLegend.toggle('A')">
            <span class="sc-dot" :style="{ background: SC_COLOR_A }"></span>{{ agentName(scAgentA) }} 队
          </span>
          <span class="sc-legend-item sc-legend-click" :class="{ off: !scLegend.isVisible('B') }" @click="scLegend.toggle('B')">
            <span class="sc-dot" :style="{ background: SC_COLOR_B }"></span>{{ agentName(scAgentB) }} 队
          </span>
          <span class="sc-legend-item">Boss：{{ scBossName }}</span>
          <span class="legend-hint">点队名显隐该线（纵轴按剩下的线缩放）</span>
        </div>
        <svg
          :viewBox="`0 0 ${svgW} ${scSvgH}`"
          class="timeline-svg"
          @mousemove="onScMove"
          @mouseleave="scHover = -1"
        >
          <g v-for="(y, i) in scYGrid" :key="'scg' + i">
            <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
            <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ scYLabel(i) }}</text>
          </g>
          <!-- X 轴版本刻度 -->
          <g v-for="t in chart3XTicks" :key="'scx' + t.index">
            <line :x1="chart3X(t.index)" :y1="padT" :x2="chart3X(t.index)" :y2="padT + plotH" style="stroke: var(--fill-hover)" />
            <text :x="chart3X(t.index)" :y="scSvgH - 8" class="axis-label x-label" text-anchor="middle">{{ t.label }}</text>
          </g>
          <!-- 两条对比折线（图例可显隐；纵轴只按剩下的线缩放） -->
          <polyline v-if="scLegend.isVisible('A')" :points="scLineA" class="sc-line sc-line-a" />
          <polyline v-if="scLegend.isVisible('B')" :points="scLineB" class="sc-line sc-line-b" />
          <!-- 点 -->
          <g v-for="(p, i) in scPts" :key="'scp' + i">
            <circle
              v-if="scLegend.isVisible('A')"
              :cx="p.x" :cy="p.yA" r="4" :fill="SC_COLOR_A"
              :style="{ stroke: scHover === i ? 'var(--app-text-solid)' : 'var(--line-strong)' }"
              :stroke-width="scHover === i ? 2 : 1"
              class="trend-point"
            >
              <title>{{ p.mainName }}：{{ p.teamA.map(agentName).join('+') }}（{{ fmt(p.hpRatioA, 1) }}%）</title>
            </circle>
            <circle
              v-if="scLegend.isVisible('B')"
              :cx="p.x" :cy="p.yB" r="4" :fill="SC_COLOR_B"
              :style="{ stroke: scHover === i ? 'var(--app-text-solid)' : 'var(--line-strong)' }"
              :stroke-width="scHover === i ? 2 : 1"
              class="trend-point"
            >
              <title>{{ p.mainName }}：{{ p.teamB.map(agentName).join('+') }}（{{ fmt(p.hpRatioB, 1) }}%）</title>
            </circle>
          </g>
          <line
            v-if="scHover >= 0"
            :x1="scPts[scHover].x" :y1="padT"
            :x2="scPts[scHover].x" :y2="padT + plotH"
            class="hover-line"
          />
        </svg>

        <!-- 悬浮卡片 -->
        <div
          v-if="scHover >= 0 && scHoverInfo"
          class="hover-card"
          :style="{ left: scCardX + 'px', top: scCardY + 'px' }"
        >
          <div class="hc-title">{{ scHoverInfo.nodeLabel }} · {{ scHoverInfo.mainName }} + {{ scHoverInfo.supportName }}</div>
          <div class="hc-row">蓝 {{ scHoverInfo.teamANames.join(' + ') }}：{{ compact(scHoverInfo.damageA) }}</div>
          <div class="hc-row">橙 {{ scHoverInfo.teamBNames.join(' + ') }}：{{ compact(scHoverInfo.damageB) }}</div>
          <div class="hc-row" :class="scHoverInfo.diff > 0 ? 'sc-diff-a' : scHoverInfo.diff < 0 ? 'sc-diff-b' : ''">{{ scHoverInfo.diffText }}</div>
        </div>
      </div>
      <div v-else class="empty-hint small-hint">
        选对比槽位与两名角色后点「对比」：预设中「其余两槽相同、该槽位恰好一队 A 一队 B」的队伍
        按主C实装节点各连一条线，可直读哪个角色在哪个主C下更强（例：击破位对比琉音 vs 诺姆）。
        换右上角 Boss 看不同克制环境下的胜负变化。
      </div>

      <!-- 汇总表：每组 A/B 强度与胜负，直接回答「哪些队伍 A > B」 -->
      <div v-if="scPoints.length > 0" class="table-wrap sc-table">
        <table class="tl-table">
          <thead>
            <tr>
              <th>主C</th>
              <th>支援</th>
              <th>{{ agentName(scAgentA) }} 队伤害</th>
              <th>{{ agentName(scAgentB) }} 队伤害</th>
              <th>相对差值</th>
              <th>结论</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in scTableRows" :key="i">
              <td><span class="dot" :style="{ background: colorOf(r.mainId) }"></span>{{ agentName(r.mainId) }}</td>
              <td>{{ agentName(r.supportId) }}</td>
              <td>{{ compact(r.damageA) }}</td>
              <td>{{ compact(r.damageB) }}</td>
              <td :class="r.diff > 0 ? 'sc-diff-a' : r.diff < 0 ? 'sc-diff-b' : ''">{{ r.diff > 0 ? '+' : '' }}{{ fmt(r.diff, 1) }}%</td>
              <td :class="r.winner === 'A' ? 'sc-diff-a' : r.winner === 'B' ? 'sc-diff-b' : ''">{{ r.conclusion }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>

    <!-- ============ Chart 4：菲林经济模拟（队伍强度随菲林投入） ============ -->
    <n-card size="small" :bordered="true">
      <template #header>
        菲林经济模拟 · 队伍强度
        <span class="chart-subtitle">主C 固定（顶部选择），队友 = 候选池按当前金数自动换最优（如 琉音换青衣、卢西娅换潘引壶）；起点 = 主C 首次 UP 之后的 Boss 初登场；每期用当期 Boss 数值 + 关卡固有 buff 算强度（伤害/当期 Boss 血量%）</span>
      </template>
      <template #header-extra>
        <div class="chart3-actions">
          <n-button size="small" type="primary" :loading="simComputing" @click="runFilmSim">
            {{ simPoints.length > 0 ? '重新模拟' : '模拟' }}
          </n-button>
        </div>
      </template>

      <!-- 参数表单 -->
      <div class="sim-controls">
        <div class="ctl-field">
          <span class="ctl-label">主C（顶部「主C角色」选择）</span>
          <span class="sim-main-name">{{ agentName(mainAgentId) }}</span>
        </div>
        <div class="ctl-field">
          <span class="ctl-label">队友候选池（顶部「候选队友」；按金数自动换最优双人）</span>
          <span class="sim-main-name">{{ candidatePool.map(agentName).join(' / ') || '—' }}</span>
        </div>
        <div class="ctl-field">
          <span class="ctl-label">初始金数</span>
          <n-input-number v-model:value="simInitialGold" :min="0" :max="24" size="small" style="width: 90px" />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">菲林/版本（≈1金=15000）</span>
          <n-input-number v-model:value="simFilmPerVersion" :min="0" :max="100000" :step="1000" size="small" style="width: 110px" />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">消耗占比（0~1）</span>
          <n-input-number v-model:value="simSpendRatio" :min="0" :max="1" :step="0.05" size="small" style="width: 90px" />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">每版本充值预算（元）</span>
          <n-input-number v-model:value="simBudgetYuan" :min="0" :max="100000" :step="30" size="small" style="width: 110px" />
          <span class="ctl-note">按性价比自动分配：月卡(30元→3300) → 大月卡(68元→≈2600) → 直充(10菲林/元)，汇率固定</span>
        </div>
        <div class="ctl-field">
          <span class="ctl-label">目标卡池（清空银行投入）</span>
          <n-select v-model:value="simTargetPeriod" :options="simTargetOptions" size="small" clearable filterable style="width: 180px" placeholder="无（不加码）" />
        </div>
      </div>

      <!-- 折线图：血量%主线 + 金数副线（图例可点显隐） -->
      <div v-if="simPoints.length > 0" class="timeline-wrap sim-plot">
        <div class="legend">
          <span class="legend-hint">点图例显隐</span>
          <div
            class="legend-item"
            :class="{ off: !simLegend.isVisible('hp') }"
            title="队伍强度（伤害/当期 Boss 血量%）"
            @click="simLegend.toggle('hp')"
          >
            <span class="swatch sim-swatch-hp"></span><span class="name">队伍强度 %</span>
          </div>
          <div
            class="legend-item"
            :class="{ off: !simLegend.isVisible('gold') }"
            title="累计限定金数（右轴）"
            @click="simLegend.toggle('gold')"
          >
            <span class="swatch sim-swatch-gold"></span><span class="name">金数（右轴）</span>
          </div>
        </div>
        <svg
          :viewBox="`0 0 ${svgW} ${simSvgH}`"
          class="timeline-svg"
          @mousemove="onSimMove"
          @mouseleave="simHover = -1"
        >
          <g v-for="(y, i) in simYGrid" :key="'fg' + i">
            <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
            <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ simYLabel(i) }}%</text>
          </g>
          <!-- 100% 击杀线 -->
          <line :x1="padL" :y1="simY(100)" :x2="svgW - padR" :y2="simY(100)" class="kill-line-ref" />
          <text :x="svgW - padR - 2" :y="simY(100) - 5" class="axis-label" text-anchor="end">100%</text>
          <!-- 队伍强度主线 -->
          <polyline v-if="simLegend.isVisible('hp')" :points="simHpLine" class="sim-line" />
          <!-- 金数副线（右轴） -->
          <polyline v-if="simLegend.isVisible('gold')" :points="simGoldLine" class="sim-gold-line" />
          <!-- 金数右轴刻度 -->
          <text v-for="g in (simLegend.isVisible('gold') ? 4 : 0)" :key="'gp' + g" :x="svgW - padR + 2" :y="simGoldY((simGoldMax / 4) * g) + 3" class="axis-label gold-axis-label">{{ Math.round((simGoldMax / 4) * g) }}</text>
          <!-- 点 -->
          <g v-for="(p, i) in simPts" :key="'fp' + i">
            <circle v-if="simLegend.isVisible('hp')" :cx="p.x" :cy="p.y" r="3.5" :fill="p.color" :style="{ stroke: simHover === i ? 'var(--app-text-solid)' : 'var(--wa-250)' }" :stroke-width="simHover === i ? 2 : 1" class="trend-point">
              <title>{{ p.label }}：{{ fmt(p.hpRatio, 1) }}%（{{ p.totalGold }}金）</title>
            </circle>
          </g>
          <!-- X 轴标签（抽稀） -->
          <g v-for="t in simXTicks" :key="'fx' + t.index">
            <text :x="simX(t.index)" :y="simSvgH - 8" class="axis-label x-label" text-anchor="middle">{{ t.label }}</text>
          </g>
          <line v-if="simHover >= 0" :x1="simPts[simHover].x" :y1="padT" :x2="simPts[simHover].x" :y2="padT + plotH" class="hover-line" />
        </svg>

        <!-- 悬浮卡片 -->
        <div v-if="simHover >= 0 && simHoverInfo" class="hover-card" :style="{ left: simCardX + 'px', top: simCardY + 'px' }">
          <div class="hc-title">期 {{ simHoverInfo.label }}</div>
          <div class="hc-row">{{ simHoverInfo.date }} · 队伍 {{ simHoverInfo.teamNames.join('+') }}</div>
          <div class="hc-row">伤害 {{ compact(simHoverInfo.damage) }}（{{ fmt(simHoverInfo.hpRatio, 1) }}%）</div>
          <div class="hc-row">{{ simHoverInfo.totalGold }} 金 · {{ simHoverInfo.goldLabel }}</div>
          <div class="hc-row">菲林：存 {{ simHoverInfo.filmBank }} · 本期投 {{ simHoverInfo.filmSpent }} · 累计 {{ simHoverInfo.filmInvestedTotal }}</div>
        </div>
      </div>
      <div v-else class="empty-hint small-hint">设置模拟参数后点「模拟」：每期按菲林投放 → 占比花/存 → 主C优先买金 → 当期 Boss + buff 出强度。</div>

      <!-- 进度条 -->
      <div v-if="simComputing || simProgress" class="chart-progress">
        <n-progress
          type="line"
          :percentage="Math.round((simProgress?.pct ?? 0) * 100)"
          :show-indicator="false"
          :height="6"
        />
        <span class="progress-text">{{ simProgress?.text ?? '' }}</span>
      </div>
    </n-card>

    <!-- ============ Chart 5：抽卡价值 · 危局兑现（实战归档配对差分） ============ -->
    <n-card size="small" :bordered="true">
      <template #header>
        抽卡价值 · 危局兑现
        <span class="chart-subtitle">按抽取以来在危局实际兑现的分数总和给卡分级（同作者同房间「带卡 vs 不带卡」最佳分差的配对差分——玩家技术与当期环境被差分吸收；数据源 = 实战归档）</span>
      </template>
      <template #header-extra>
        <div class="chart3-actions">
          <n-select
            v-model:value="pvTierFilter"
            :options="pvTierFilterOptions"
            size="small"
            style="width: 130px"
          />
          <n-button size="small" type="primary" :loading="pvComputing" @click="runPullValue">
            {{ pvResult ? '重算' : '计算' }}
          </n-button>
        </div>
      </template>

      <div v-if="pvError" class="empty-hint small-hint">⚠ {{ pvError }}</div>
      <div v-else-if="!pvResult" class="empty-hint small-hint">
        点「计算」加载实战归档并估计每张卡的危局兑现：横轴 = 归档覆盖的危局房间（期 × 关卡），
        每行一张卡、气泡 = 当期边际兑现分（同作者带卡/不带卡最佳分差的中位数，未出场计 0），行末柱 = 累计兑现总和。
        分级 T0~T3 = 限定池累计四分位（配对数 ≥ {{ PV_MIN_PAIRS }} 才参与，否则「样本不足」）。
      </div>

      <template v-else>
        <!-- 窗口摘要 -->
        <div class="pv-summary">
          <span>观测窗口 {{ pvResult.window.firstDate }} ~ {{ pvResult.window.lastDate }}</span>
          <span>{{ pvResult.window.seasonCount }} 个赛季 · {{ pvResult.rooms.length }} 个危局房间 · {{ compact(pvResult.window.runCount) }} 条投稿</span>
          <span>单房间分数上限 65000（删失点：都打满 → 边际计 0）</span>
        </div>

        <!-- 分级筛选（点图例显隐某档；与「层」下拉是两个正交维度：层=卡池归属，分级=兑现强弱） -->
        <div class="legend">
          <span class="legend-hint">点图例显隐分级 · 显示 {{ pvCounts.visible }}/{{ pvCounts.total }} 档（行与排名表同源过滤）</span>
          <div
            v-for="g in pvGradeDefs"
            :key="g.id"
            class="legend-item"
            :class="{ off: !pvGradeLegend.isVisible(g.id) }"
            :title="`${g.desc}：点击${pvGradeLegend.isVisible(g.id) ? '隐藏' : '显示'}该档`"
            @click="pvGradeLegend.toggle(g.id)"
          >
            <span class="swatch" :style="{ background: g.color }"></span><span class="name">{{ g.label }}</span>
          </div>
          <span class="legend-hint legend-action" @click="pvGradeLegend.showAll()">全显示</span>
        </div>

        <!-- 时间轴气泡图：行 = 卡（按累计降序），列 = 房间 -->
        <div class="timeline-wrap pv-plot">
          <svg :viewBox="`0 0 ${svgW} ${pvSvgH}`" class="timeline-svg" @mousemove="onPvMove" @mouseleave="pvHover = ''">
            <!-- Y 轴行标签（角色名 + 分级徽标） -->
            <g v-for="row in pvRows" :key="row.agentId">
              <rect
                :x="0" :y="pvRowY(row.rowIndex) - pvRowH / 2"
                :width="svgW" :height="pvRowH"
                :class="{ 'pv-row-hover': pvHover === row.agentId }"
                class="pv-row-bg"
                @click="pvSelected = pvSelected === row.agentId ? '' : row.agentId"
              >
                <title>{{ pvRowTitle(row) }}</title>
              </rect>
              <text :x="pvLabelW - 6" :y="pvRowY(row.rowIndex) + 3.5" text-anchor="end" class="pv-row-label">
                {{ row.label }}
              </text>
              <text v-if="row.gradeText" :x="pvLabelW + 2" :y="pvRowY(row.rowIndex) + 3.5" class="pv-grade" :class="'pv-' + row.card.grade">
                {{ row.gradeText }}
              </text>
            </g>
            <!-- X 轴房间刻度（抽稀） -->
            <g v-for="t in pvXTicks" :key="'pvx' + t.index">
              <text :x="pvX(t.index)" :y="pvSvgH - 6" text-anchor="middle" class="axis-label x-label">{{ t.label }}</text>
            </g>
            <!-- 实装边界竖线（选中卡） -->
            <g v-if="pvSelectedCard && pvSelectedCard.firstRoomIndex >= 0 && pvSelectedCard.firstRoomIndex < pvResult.rooms.length">
              <line
                :x1="pvX(pvSelectedCard.firstRoomIndex)" :y1="pvPadT - 6"
                :x2="pvX(pvSelectedCard.firstRoomIndex)" :y2="pvSvgH - pvXLabelH"
                class="pv-release-line"
              />
              <text :x="pvX(pvSelectedCard.firstRoomIndex) + 3" :y="pvPadT - 10" class="pv-release-label">实装</text>
            </g>
            <!-- 气泡：边际兑现（红正绿负？——正=橙红高亮，负=蓝） -->
            <g v-for="row in pvRows" :key="'b' + row.agentId">
              <circle
                v-for="(e, i) in row.card.roomEffects"
                :key="row.agentId + i"
                :cx="pvX(i)"
                :cy="pvRowY(row.rowIndex)"
                :r="pvBubbleR(e)"
                :fill="pvBubbleFill(e)"
                :stroke="pvHover === row.agentId || pvSelected === row.agentId ? 'var(--app-text-solid)' : 'var(--wa-150)'"
                :stroke-width="pvHover === row.agentId || pvSelected === row.agentId ? 1.2 : 0.5"
                class="pv-bubble"
              >
                <title>{{ pvBubbleTitle(row.card, e, i) }}</title>
              </circle>
            </g>
            <!-- 行末累计柱 + 数值 -->
            <g v-for="row in pvRows" :key="'c' + row.agentId">
              <rect
                :x="pvBarX" :y="pvBarY(row.card)"
                :width="pvBarW(row.card)" :height="pvBarH"
                :fill="pvBarFill(row.card)"
                rx="2"
                class="pv-bar"
              >
                <title>{{ pvRowTitle(row) }}</title>
              </rect>
              <text :x="pvBarX + pvBarW(row.card) + 4" :y="pvRowY(row.rowIndex) + 3.5" class="pv-bar-label">
                {{ compact(row.card.cumulative) }}
              </text>
            </g>
          </svg>
        </div>

        <!-- 选中卡详情：逐房间边际曲线 -->
        <div v-if="pvSelectedCard" class="pv-detail">
          <div class="pv-detail-title">
            {{ agentName(pvSelectedCard.agentId) }} · {{ pvTierLabel(pvSelectedCard.tier) }}
            <template v-if="pvSelectedCard.releaseDate"> · 实装 {{ pvSelectedCard.releaseDate }}</template>
            · 累计兑现 {{ fmt(pvSelectedCard.cumulative, 0) }} 分（{{ pvSelectedCard.observableRooms }} 期可观测 · 上场 {{ pvSelectedCard.roomsAppeared }} 期 · 顶分在场 {{ pvSelectedCard.frontierRooms }} 期）
            · 场均 {{ fmt(pvSelectedCard.avgPerRoom, 0) }} · 近 3 期场均 {{ fmt(pvSelectedCard.recentAvg, 0) }}
            · 每万菲林 {{ pvSelectedCard.roiPer10kFilm == null ? '—（赠送）' : fmt(pvSelectedCard.roiPer10kFilm, 0) }} 分
            · {{ pvSelectedCard.totalPairs }} 个配对
          </div>
          <div class="pv-detail-bars">
            <div v-for="(e, i) in pvSelectedCard.roomEffects" :key="i" class="pv-detail-bar" :class="{ 'pv-out': e.effect === 0 && !e.appeared }">
              <div
                class="pv-detail-bar-fill"
                :style="{ height: pvDetailBarH(e) }"
                :class="e.effect >= 0 ? 'pv-pos' : 'pv-neg'"
              ></div>
              <span class="pv-detail-bar-label">{{ pvResult.rooms[i]?.label }}</span>
              <span class="pv-detail-bar-val">{{ e.effect === 0 && !e.appeared ? '—' : fmt(e.effect, 0) }}</span>
            </div>
          </div>
        </div>

        <!-- 排名表 -->
        <div class="table-wrap">
          <table class="tl-table">
            <thead>
              <tr>
                <th>#</th>
                <th>卡</th>
                <th>层</th>
                <th>分级</th>
                <th>累计兑现</th>
                <th>场均</th>
                <th>近3期场均</th>
                <th>每万菲林</th>
                <th>上场/可观测</th>
                <th>顶分在场</th>
                <th>配对数</th>
                <th>实装</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(c, i) in pvTableRows"
                :key="c.agentId"
                :class="{ 'pv-sel-row': pvSelected === c.agentId }"
                @click="pvSelected = pvSelected === c.agentId ? '' : c.agentId"
              >
                <td>{{ i + 1 }}</td>
                <td><span class="dot" :style="{ background: colorOf(c.agentId) }"></span>{{ agentName(c.agentId) }}</td>
                <td>{{ pvTierLabel(c.tier) }}</td>
                <td>
                  <span v-if="c.grade" class="pv-grade" :class="'pv-' + c.grade">{{ c.grade }}</span>
                  <span v-else-if="c.totalPairs > 0" class="no-change">样本不足</span>
                  <span v-else class="no-change">—</span>
                </td>
                <td :class="{ 'kill-line': c.cumulative > 0 }">{{ fmt(c.cumulative, 0) }}</td>
                <td>{{ fmt(c.avgPerRoom, 0) }}</td>
                <td :class="{ 'pv-neg-num': c.recentAvg < 0 }">{{ fmt(c.recentAvg, 0) }}</td>
                <td>{{ c.roiPer10kFilm == null ? '—' : fmt(c.roiPer10kFilm, 0) }}</td>
                <td>{{ c.roomsAppeared }}/{{ c.observableRooms }}</td>
                <td>{{ c.frontierRooms }}</td>
                <td>{{ c.totalPairs }}</td>
                <td>{{ c.releaseDate ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="dd-caption">
          口径：边际 = 同房间同一玩家「带该卡最佳分 − 不带最佳分」跨玩家取中位数（作者/房间固定效应被差分吸收；估计 = 玩家选它上场时的 treatment-on-the-treated）；
          未出场 / 无配对 / 实装前计 0；带不带都打满 65000 边际如实计 0（顶部饱和）。「累计兑现」= 实装以来 Σ 边际（无折现）；
          分级 = 限定池（含赠送 S）累计四分位 T0~T3，配对 &lt; {{ PV_MIN_PAIRS }} = 样本不足。A 级基线（妮可/苍角等）是「没卡时的占位选择」，
          负边际 = 与更好卡的机会差，不参与分级。观测窗口 = 归档覆盖的 23 个赛季（更早实装的卡只累计窗口内兑现）。
        </div>
      </template>

      <div v-if="pvComputing" class="chart-progress">
        <n-progress type="line" :percentage="100" :show-indicator="false" :height="6" status="success" processing />
        <span class="progress-text">估计配对差分…</span>
      </div>
    </n-card>

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
import { computeTeamTimeline, type NewAgentBench, type SwapKind, type TeamTimelineResult } from '@/composables/teamTimeline'
import {
  TIMELINE_LAYOUT,
  buildTimelineChart,
  timelineBossLaneY,
  timelineLaneTotalH,
  timelineSvgWidth,
} from '@/composables/timelineChart'
import {
  buildChart3Scatter,
  buildScPts,
  chart3YGridOf,
  chart3YLabelOf,
  chart3YMaxOf,
  chart3YOf,
  linePointsOf,
  scYGridOf,
  scYLabelOf,
  scYRangeOf,
  versionXOf,
  versionXTicksOf,
} from '@/composables/versionChartGeometry'
import { buildFilmSimChart } from '@/composables/filmSimChart'
import { computeStrengthBands, strengthBandTitle, type StrengthBand } from '@/composables/strengthBands'
import { readSvgPointer } from '@/composables/svgPointer'
import { buildNewCharacterRows, computeFilmSimulation, computeNewCharacterPoints, prefillStrongTeamsFromPresets, type FilmSimPoint, type NewCharacterPoint, type NewCharacterRow } from '@/composables/teamTimeline'
import { computeSlotComparePoints, type SlotComparePoint, type SlotCompareSlot } from '@/composables/teamTimeline'
import { buildPeriodAxis, type PeriodAxisNode } from '@/composables/bossSchedule'
import { computePullValue, MIN_PAIRS_FOR_GRADE, type PullValueInput, type PullValueResult, type PvCardRoomEffect, type PvCardTier, type PvCardValue } from '@/composables/pullValue'
import { PLANNER_FILM_PER_VERSION } from '@/data/filmEconomy'
import { runPullPlanner, type PlannerRunResult } from '@/composables/pullPlannerEngine'
import { AGENT_RELEASE_NODE, VERSION_NODES, releaseNodeOf, nodeIndexOf } from '@/data/versionTimeline'
import { buildDirectDamageTimeline, type DirectDamagePoint } from '@/composables/multiplierCoefficients'
import {
  buildDirectDamageChart,
  DD_BAND_DEFS,
  DD_CHART_LAYOUT,
  ddBandOf as ddBandOfPure,
  ddColor as ddColorOf,
  ddJitter as ddJitterOf,
  ddNeedLabel as ddNeedLabelOf,
  ddShortName as ddShortNameOf,
} from '@/composables/directDamageChart'
import { useSeriesFilter } from '@/composables/seriesFilter'
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
/** 节点车道文案：该期危局·普通首个 Boss（多个标注 ×n） */
function bossCellText(nodeId: string): string {
  const p = periodOf(nodeId)
  if (!p || p.normalBosses.length === 0) return ''
  const first = p.normalBosses[0].bossName
  return p.normalBosses.length > 1 ? `${first} 等${p.normalBosses.length}` : first
}
function bossCellTitle(nodeId: string): string {
  const p = periodOf(nodeId)
  if (!p) return '当期无排期数据'
  const parts: string[] = []
  if (p.normalBosses.length > 0) parts.push(`危局·普通：${p.normalBosses.map(b => b.bossName).join('/')}`)
  if (p.criticalBosses.length > 0) parts.push(`危局·困难：${p.criticalBosses.map(b => b.bossName).join('/')}`)
  return parts.join('\n') || '当期无排期数据'
}
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
  const boss = selectedBoss.value
  const phase = selectedPhase.value
  if (!boss || !phase) return
  if (!releaseNodeOf(mainAgentId.value)) return
  const pool = candidatePool.value.filter(id => id !== mainAgentId.value)
  if (pool.length < 2) {
    progress.value = { pct: 1, text: '候选队友至少需要 2 名（不含主C）' }
    setTimeout(() => { progress.value = null }, 2500)
    return
  }
  if (bossPeriodAxis.value.length === 0) {
    progress.value = { pct: 1, text: '所选 Boss 在危局期数数据中无登场记录' }
    setTimeout(() => { progress.value = null }, 2500)
    return
  }
  computing.value = true
  progress.value = { pct: 0, text: '准备…' }
  await nextTick()
  try {
    result.value = await computeTeamTimeline(calc, {
      mainAgentId: mainAgentId.value,
      boss,
      phase,
      budget: budget.value ?? 6,
      // 横轴刻度用期号（seq，如「45」代表 69045）；只算所选 Boss 登场的期数
      axisNodes: bossPeriodAxis.value.map(p => ({ id: p.id, label: `${p.seq}`, date: p.begin })),
      candidatePool: candidatePool.value,
      autoBuild: autoBuild.value,
      optimalGold: optimalGold.value,
      onProgress: p => { progress.value = p },
    })
  } finally {
    computing.value = false
    progress.value = null
  }
}

// ========== 颜色 ==========
const PALETTE = ['#63e2b7', '#63b3ed', '#f6ad55', '#f687b3', '#b794f4', '#f6e05e', '#4fd1c5', '#fc8181', '#68d391', '#90cdf4', '#fbd38d', '#fbb6ce', '#d6bcfa', '#fefcbf', '#81e6d9', '#feb2b2']
function colorOf(agentId: string): string {
  let h = 0
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
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
/** 换人判定徽标文案：上位 +12.4% / 平替 +0.8% */
function swapKindLabel(kind: SwapKind, pct?: number): string {
  const label = kind === 'upgrade' ? '上位' : '平替'
  return pct == null ? label : `${label} ${pct > 0 ? '+' : ''}${fmt(pct, 1)}%`
}
/** 实装未进队标注：X 实装未进队 · 平替（差 y%，可不抽）/ 未上位（差 y%） */
function benchText(b: NewAgentBench): string {
  const names = b.agents.map(agentName).join('/')
  const gap = fmt(Math.abs(b.gapPct), 1)
  return b.kind === 'lateral'
    ? `${names} 实装未进队 · 平替（差 ${gap}%，可不抽）`
    : `${names} 实装未进队 · 未上位（差 ${gap}%）`
}
const hoverInfo = computed(() => {
  const n = result.value?.nodes[hoverNode.value]
  if (!n) return null
  return {
    nodeLabel: n.nodeLabel,
    teamNames: n.team.map(agentName),
    damage: n.damage,
    hpRatio: n.hpRatio,
    goldLabel: n.goldLabel,
    swap: n.swappedIn
      ? `换上 ${agentName(n.swappedIn)}，换下 ${agentName(n.swappedOut!)}` +
        (n.swapKind ? `（${swapKindLabel(n.swapKind, n.swapUpliftPct)}）` : '')
      : '',
    bench: n.newAgentBench ? benchText(n.newAgentBench) : '',
    schedule: (() => {
      const p = periodOf(n.nodeId)
      if (!p) return ''
      const parts: string[] = []
      if (p.normalBosses.length > 0) parts.push(`危局·普通：${p.normalBosses.map(x => x.bossName).join('/')}`)
      if (p.criticalBosses.length > 0) parts.push(`危局·困难：${p.criticalBosses.map(x => x.bossName).join('/')}`)
      return parts.join(' · ')
    })(),
  }
})
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
  const { relX, svgX, rect } = readSvgPointer(e, { w: svgW.value, h: svgH.value })
  if (nodeCount.value <= 0) return
  let best = -1
  let bestDist = Infinity
  chartPts.value.forEach((p, i) => {
    const d = Math.abs(p.x - svgX)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  if (best >= 0 && bestDist < plotW.value / Math.max(1, nodeCount.value)) {
    hoverNode.value = best
    hoverCardX.value = Math.min(rect.width - 240, relX + 12)
    hoverCardY.value = e.clientY - rect.top + 8
  } else {
    hoverNode.value = -1
  }
}
// ============ 限定S首次UP × 版本直伤系数（倍率演算引擎静态推导，见 composables/multiplierCoefficients.ts） ============

const ddPoints = computed(() =>
  buildDirectDamageTimeline(catalogStore.catalog?.agents ?? [], catalogStore.catalog?.agentSkills ?? []),
)

// 几何/标度逻辑已抽到 composables/directDamageChart.ts（纯函数，可单测）；
// 此处只留「模板绑定名 → 图表读数」的薄适配层，模板无需改动。
const dd = computed(() => buildDirectDamageChart({
  points: ddPoints.value,
  svgW: svgW.value,
  versionNodes: VERSION_NODES,
}))
const { padL: ddPadL, padR: ddPadR, padT: ddPadT, svgH: ddSvgH } = DD_CHART_LAYOUT
const ddPlotBottom = DD_CHART_LAYOUT.svgH - DD_CHART_LAYOUT.padB
const ddYTicks = dd.value.yTicks
function ddX(nodeIndex: number): number { return dd.value.x(nodeIndex) }
function ddCX(nodeIndex: number): number { return dd.value.cx(nodeIndex) }
function ddTickCenterX(firstIndex: number): number { return dd.value.tickCenterX(firstIndex) }
function ddY(v: number): number { return dd.value.y(v) }
const ddXTicks = dd.value.xTicks
const ddTestServerRects = computed(() => dd.value.testServerRects)
function ddLabelY(p: DirectDamagePoint): number { return dd.value.labelY(p) }
// 分档/颜色/抖动/截断：无状态纯函数，直接从模块引入
const ddBandDefs = DD_BAND_DEFS
const ddLegend = useSeriesFilter(() => ddBandDefs.map(b => ({ id: b.id, name: b.label })))
/** 可见点（图上画什么）；注意 ddLabelSlots 仍按全量算，筛选不改变标签槽位分配 */
const ddVisiblePoints = computed(() => ddPoints.value.filter(p => p.value == null || ddLegend.isVisible(ddBandOf(p.value))))
function ddJitter(agentId: string): number { return ddJitterOf(agentId) }
function ddColor(v: number): string { return ddColorOf(v) }
function ddBandOf(v: number): string { return ddBandOfPure(v) }
function ddNeedLabel(v: number): boolean { return ddNeedLabelOf(v) }
function ddShortName(name: string): string { return ddShortNameOf(name) }

// ========== Chart 3：每期新角色 · 强队强度（横轴 = 版本，点 = 当期新角色强队） ==========
const chart3Rows = computed<NewCharacterRow[]>(() => buildNewCharacterRows())
/** 强队清单：charId → 强队列表（每支 3 人；同角色多队 = 同一时间点多点展示；空数组 = 不出点）；预填口述预设 */
const chart3Teams = ref<Record<string, [string, string, string][]>>(initChart3Teams())
function initChart3Teams(): Record<string, [string, string, string][]> {
  const out: Record<string, [string, string, string][]> = {}
  const prefill = prefillStrongTeamsFromPresets()
  for (const row of buildNewCharacterRows()) out[row.charId] = prefill[row.charId] ? [prefill[row.charId]] : []
  return out
}
function addChart3Team(charId: string) {
  chart3Teams.value[charId].push(['', '', ''])
}
function removeChart3Team(charId: string, index: number) {
  chart3Teams.value[charId].splice(index, 1)
}
/** 强队成员可选全部角色（S+A；A 级支援如苍角/妮可可作队友） */
const allAgentOptions = computed(() =>
  catalogStore.displayAgents.map(a => ({ value: a.id, label: `${a.name.zhCN ?? a.id}（${a.rarity}）` })),
)

const chart3Computing = ref(false)
const chart3Progress = ref<{ pct: number; text: string } | null>(null)
const chart3Points = ref<NewCharacterPoint[]>([])
async function runChart3() {
  const boss = selectedBoss.value
  const phase = selectedPhase.value
  if (!boss || !phase) return
  chart3Computing.value = true
  chart3Progress.value = { pct: 0, text: '准备…' }
  try {
    chart3Points.value = await computeNewCharacterPoints(calc, {
      rows: chart3Rows.value,
      teams: chart3Teams.value,
      boss,
      phase,
      budget: budget.value ?? 6,
      autoBuild: autoBuild.value,
      optimalGold: optimalGold.value,
      onProgress: p => { chart3Progress.value = p },
    })
  } finally {
    chart3Computing.value = false
    chart3Progress.value = null
  }
}

// ---- Chart 3 SVG ----
// Chart 3 几何：见 composables/versionChartGeometry.ts（纯函数，可单测）
const TB = { padT, plotH }
const chart3SvgH = padT + plotH + 30
const chart3YMax = computed(() => chart3YMaxOf(chart3VisiblePts.value.map(p => p.hpRatio)))
function yOf3(v: number): number { return chart3YOf(v, chart3YMax.value, TB) }
const chart3YGrid = computed(() => chart3YGridOf(chart3YMax.value, TB))
function chart3YLabel(i: number): number { return chart3YLabelOf(i, chart3YMax.value) }
function chart3X(i: number): number { return versionXOf(i, VERSION_NODES.length, padL, plotW.value) }
const chart3XTicks = computed(() => versionXTicksOf(VERSION_NODES, 16))
/** 散点：同节点多角色/多队伍横向错开；颜色按队伍构成稳定映射（同队同色，跨角色可对比） */
/** Chart 3 图例系列 = 队伍构成（与散点颜色同一把钥匙：同队同色、跨角色同一条图例） */
const chart3Series = computed(() => {
  const seen = new Map<string, string>()
  for (const p of chart3Points.value) {
    const key = p.team.join(',')
    if (!seen.has(key)) seen.set(key, p.team.map(agentName).join(' + '))
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }))
})
const chart3Legend = useSeriesFilter(() => chart3Series.value)
const chart3Counts = chart3Legend.counts
/** 可见散点（Y 轴刻度、散点、悬浮命中三者同源 ⇒ 隐藏高值队后轴跟着降） */
const chart3VisiblePts = computed(() => chart3Points.value.filter(p => chart3Legend.isVisible(p.team.join(','))))
const chart3Pts = computed(() => buildChart3Scatter({
  points: chart3VisiblePts.value,
  nodeIndexOf: (id) => nodeIndexOf(id),
  yMax: chart3YMax.value,
  box: TB,
  padL,
  plotW: plotW.value,
  versionTotal: VERSION_NODES.length,
  colorOf: (key) => colorOf(key),
  nameOf: (id) => agentName(id),
}))
const chart3Hover = ref(-1)
const chart3HoverInfo = computed(() => chart3Pts.value[chart3Hover.value] ?? null)
const chart3CardX = ref(0)
const chart3CardY = ref(0)
function onChart3Move(e: MouseEvent) {
  const { svgX, relX, relY, rect } = readSvgPointer(e, { w: svgW.value, h: chart3SvgH })
  let best = -1
  let bestDist = Infinity
  chart3Pts.value.forEach((p, i) => {
    const d = Math.abs(p.x - svgX)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  if (best >= 0 && bestDist < (plotW.value / Math.max(1, VERSION_NODES.length)) * 2) {
    chart3Hover.value = best
    chart3CardX.value = Math.min(rect.width - 240, relX + 12)
    chart3CardY.value = relY + 8
  } else {
    chart3Hover.value = -1
  }
}

// ========== Chart 7：同槽位角色对比（预设中其余两槽相同、所选槽位 A/B 两队） ==========
const SC_COLOR_A = 'var(--c-info)'
const SC_COLOR_B = 'var(--c-warning)'
const scSlot = ref<SlotCompareSlot>(1)
const scSlotOptions: Array<{ value: SlotCompareSlot; label: string }> = [
  { value: 0, label: '主C槽' },
  { value: 1, label: '击破槽' },
  { value: 2, label: '支援槽' },
]
const scAgentA = ref('1481') // 琉音（用户口径示例的对比对象之一）
const scAgentB = ref('1571') // 诺姆·霍洛维尔
const scComputing = ref(false)
const scProgress = ref<{ pct: number; text: string } | null>(null)
const scPoints = ref<SlotComparePoint[]>([])
const scSlotLabel = computed(() => scSlotOptions.find(o => o.value === scSlot.value)?.label ?? '')

// ---- 卡片内 Boss 选择（默认跟随顶部；手动改过后不再跟随） ----
const scBossId = ref('')
const scBossTouched = ref(false)
watch(selectedBossId, v => {
  if (!scBossTouched.value && v) scBossId.value = v
})
const scBoss = computed(() => bossPresets.value.find(b => b.id === scBossId.value) ?? null)
/** 与顶部 selectedPhase 同口径：取该 Boss 最新危局期，否则最新期 */
const scPhase = computed(() => {
  const b = scBoss.value
  if (!b) return null
  const sorted = [...b.phases].filter(p => p.begin).sort((x, y) => y.begin.localeCompare(x.begin))
  return sorted.find(p => p.modeType === 'critical_assault') ?? sorted[0] ?? b.phases[0] ?? null
})
const scBossName = computed(() => scBoss.value?.name ?? '—')

async function runSlotCompare() {
  const boss = scBoss.value
  const phase = scPhase.value
  if (!boss || !phase) {
    scProgress.value = { pct: 1, text: '先选 Boss（卡片右上角，默认跟随顶部）' }
    setTimeout(() => { scProgress.value = null }, 2500)
    return
  }
  if (scAgentA.value === scAgentB.value) {
    scProgress.value = { pct: 1, text: '两名对比角色不能相同' }
    setTimeout(() => { scProgress.value = null }, 2500)
    return
  }
  scComputing.value = true
  scProgress.value = { pct: 0, text: '准备…' }
  await nextTick()
  try {
    scPoints.value = await computeSlotComparePoints(calc, {
      slot: scSlot.value,
      agentA: scAgentA.value,
      agentB: scAgentB.value,
      boss,
      phase,
      budget: budget.value ?? 6,
      autoBuild: autoBuild.value,
      optimalGold: optimalGold.value,
      onProgress: p => { scProgress.value = p },
    })
  } finally {
    scComputing.value = false
    scProgress.value = null
  }
}

// ---- Chart 7 SVG（双折线：A 蓝 / B 橙，横轴 = 主C实装节点；纵轴 = 伤害自动刻度） ----
// Chart 7 几何：见 composables/versionChartGeometry.ts（与 Chart 3 共享版本轴）
const scSvgH = padT + plotH + 30
/** A/B 两线的显隐（图例可点；纵轴按**剩下的线**缩放 ⇒ 只看一队时那条线铺满全高更好读） */
const scLegend = useSeriesFilter(() => [
  { id: 'A', name: agentName(scAgentA.value) },
  { id: 'B', name: agentName(scAgentB.value) },
])
/** 纵轴贴合可见线的伤害范围（±8% 边距），不看 Boss 血量/击杀线，只看相对强弱 */
const scYRange = computed(() => scYRangeOf(scPoints.value.flatMap(p => [
  ...(scLegend.isVisible('A') ? [p.damageA] : []),
  ...(scLegend.isVisible('B') ? [p.damageB] : []),
])))
const scYGrid = computed(() => scYGridOf(scYRange.value, TB))
function scYLabel(i: number): string { return scYLabelOf(i, scYRange.value, compact) }
const scPts = computed(() => buildScPts(scPoints.value, {
  nodeIndexOf: (id) => nodeIndexOf(id),
  range: scYRange.value,
  box: TB,
  padL,
  plotW: plotW.value,
  versionTotal: VERSION_NODES.length,
}))
const scLineA = computed(() => linePointsOf(scPts.value, p => ({ x: p.x, y: p.yA })))
const scLineB = computed(() => linePointsOf(scPts.value, p => ({ x: p.x, y: p.yB })))
const scHover = ref(-1)
const scHoverInfo = computed(() => {
  const p = scPoints.value[scHover.value]
  if (!p) return null
  const diff = p.damageB > 0 ? Math.round(((p.damageA - p.damageB) / p.damageB) * 1000) / 10 : 0
  return {
    nodeLabel: p.nodeLabel,
    mainName: p.mainName,
    supportName: agentName(p.supportId),
    teamANames: p.teamA.map(agentName),
    teamBNames: p.teamB.map(agentName),
    damageA: p.damageA,
    damageB: p.damageB,
    diff,
    diffText: diff > 0
      ? `${agentName(scAgentA.value)} 高 ${fmt(diff, 1)}%`
      : diff < 0
        ? `${agentName(scAgentB.value)} 高 ${fmt(-diff, 1)}%`
        : '两队持平',
  }
})
const scCardX = ref(0)
const scCardY = ref(0)
function onScMove(e: MouseEvent) {
  const { svgX, relX, relY, rect } = readSvgPointer(e, { w: svgW.value, h: scSvgH })
  let best = -1
  let bestDist = Infinity
  scPts.value.forEach((p, i) => {
    const d = Math.abs(p.x - svgX)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  if (best >= 0 && bestDist < (plotW.value / Math.max(1, VERSION_NODES.length)) * 2) {
    scHover.value = best
    scCardX.value = Math.min(rect.width - 260, relX + 12)
    scCardY.value = relY + 8
  } else {
    scHover.value = -1
  }
}
/** 相对差值 = (A−B)/B × 100（伤害口径，不受 Boss 血量影响） */
const scTableRows = computed(() =>
  scPoints.value.map(p => {
    const diff = p.damageB > 0 ? Math.round(((p.damageA - p.damageB) / p.damageB) * 1000) / 10 : 0
    const winner = diff > 0 ? 'A' as const : diff < 0 ? 'B' as const : 'tie' as const
    return {
      ...p,
      diff,
      winner,
      conclusion: winner === 'A'
        ? `${agentName(scAgentA.value)} 更强`
        : winner === 'B'
          ? `${agentName(scAgentB.value)} 更强`
          : '持平',
    }
  }),
)

// ========== Chart 4：菲林经济模拟（队伍强度随菲林投入；主C固定，队友按金数换最优） ==========
const simInitialGold = ref(6)
const simFilmPerVersion = ref(15000)
const simSpendRatio = ref(0.5)
const simBudgetYuan = ref(0)
const simTargetPeriod = ref('')
const simComputing = ref(false)
const simProgress = ref<{ pct: number; text: string } | null>(null)
const simPoints = ref<FilmSimPoint[]>([])

const simTargetOptions = computed(() =>
  bossPeriodAxis.value.map(p => ({ value: p.id, label: `${p.seq} · ${p.label}` })),
)

async function runFilmSim() {
  const boss = selectedBoss.value
  if (!boss) return
  const axis = bossPeriodAxis.value.map(p => ({ id: p.id, label: `${p.seq}`, date: p.begin }))
  if (axis.length === 0) {
    simProgress.value = { pct: 1, text: '所选 Boss 在危局期数数据中无登场记录' }
    setTimeout(() => { simProgress.value = null }, 2500)
    return
  }
  if (candidatePool.value.filter(id => id !== mainAgentId.value).length < 2) {
    simProgress.value = { pct: 1, text: '候选队友至少 2 名（不含主C）' }
    setTimeout(() => { simProgress.value = null }, 2500)
    return
  }
  simComputing.value = true
  simProgress.value = { pct: 0, text: '准备…' }
  try {
    const res = await computeFilmSimulation(calc, {
      boss,
      axisNodes: axis,
      periodViews: phaseViews.value,
      mainAgentId: mainAgentId.value,
      candidatePool: candidatePool.value,
      initialGold: simInitialGold.value ?? 6,
      filmPerVersion: simFilmPerVersion.value ?? 15000,
      spendRatio: simSpendRatio.value ?? 0.5,
      budgetYuanPerVersion: simBudgetYuan.value ?? 0,
      targetPeriodId: simTargetPeriod.value || undefined,
      autoBuild: autoBuild.value,
      onProgress: p => { simProgress.value = p },
    })
    simPoints.value = res.points
  } finally {
    simComputing.value = false
    simProgress.value = null
  }
}

// ---- Chart 4 SVG（血量%主线 + 金数副线） ----
// Chart 4 几何：见 composables/filmSimChart.ts（与 Chart 1/3 共享血量%纵轴）
const sim = computed(() => buildFilmSimChart({
  points: simPoints.value,
  svgW: svgW.value,
  padL,
  plotW: plotW.value,
  box: TB,
  colorOf: (key) => colorOf(key),
}))
const simSvgH = sim.value.svgH
function simY(v: number): number { return sim.value.y(v) }
const simYGrid = computed(() => sim.value.yGrid)
function simYLabel(i: number): number { return sim.value.yLabel(i) }
const simGoldMax = computed(() => sim.value.goldMax)
function simGoldY(g: number): number { return sim.value.goldY(g) }
function simX(i: number): number { return sim.value.x(i) }
const simXTicks = computed(() => sim.value.xTicks)
const simPts = computed(() => sim.value.pts)
const simHpLine = computed(() => sim.value.hpLine)
const simGoldLine = computed(() => sim.value.goldLine)
/** 两条线的显隐（图例可点）；隐藏主线时 Y 轴仍按血量%口径（尺度含义不变，只是不画线） */
const simLegend = useSeriesFilter(() => [
  { id: 'hp', name: '队伍强度 %' },
  { id: 'gold', name: '金数（右轴）' },
])
const simHover = ref(-1)
const simHoverInfo = computed(() => {
  const p = simPoints.value[simHover.value]
  if (!p) return null
  return {
    label: p.label,
    date: p.date,
    teamNames: p.team.map(agentName),
    damage: p.damage,
    hpRatio: p.hpRatio,
    totalGold: p.totalGold,
    goldLabel: p.goldLabel,
    filmBank: p.filmBank,
    filmSpent: p.filmSpent,
    filmInvestedTotal: p.filmInvestedTotal,
  }
})
const simCardX = ref(0)
const simCardY = ref(0)
function onSimMove(e: MouseEvent) {
  const { svgX, relX, relY, rect } = readSvgPointer(e, { w: svgW.value, h: simSvgH })
  let best = -1
  let bestDist = Infinity
  simPts.value.forEach((p, i) => {
    const d = Math.abs(p.x - svgX)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  if (best >= 0 && bestDist < (plotW.value / Math.max(1, simPoints.value.length)) * 2) {
    simHover.value = best
    simCardX.value = Math.min(rect.width - 260, relX + 12)
    simCardY.value = relY + 8
  } else {
    simHover.value = -1
  }
}

// ========== Chart 5：抽卡价值 · 危局兑现（实战归档配对差分；纯展示层，零引擎求值） ==========
const PV_MIN_PAIRS = MIN_PAIRS_FOR_GRADE
const pvComputing = ref(false)
const pvError = ref('')
const pvResult = ref<PullValueResult | null>(null)
const pvTierFilter = ref<'limited' | 'all'>('limited')
const pvTierFilterOptions = [
  { value: 'limited', label: '限定池（含赠送）' },
  { value: 'all', label: '全部（含常驻/A级）' },
]
const pvSelected = ref('')
const pvHover = ref('')

/** 归档懒加载缓存（会话内一次） */
let pvArchive: PullValueInput | null = null

async function runPullValue() {
  pvComputing.value = true
  pvError.value = ''
  try {
    let archive: PullValueInput | null = pvArchive
    if (!archive) {
      const res = await fetch('/static/run-archive.json')
      if (!res.ok) throw new Error(`归档加载失败（HTTP ${res.status}）——run-archive.json 不在 public/static 下`)
      archive = (await res.json()) as PullValueInput
      pvArchive = archive
    }
    pvResult.value = computePullValue(archive)
  } catch (e) {
    pvError.value = e instanceof Error ? e.message : String(e)
  } finally {
    pvComputing.value = false
  }
}

const pvSelectedCard = computed(() => pvResult.value?.cards.find(c => c.agentId === pvSelected.value) ?? null)

/** 图行/表行同源过滤：limited = 限定+赠送（分级主视图）；all = 全部层 */
const pvFilteredCards = computed(() => {
  const r = pvResult.value
  if (!r) return []
  if (pvTierFilter.value === 'limited') return r.cards.filter(c => c.tier === 'limited' || c.tier === 'freeGift')
  return r.cards
})

// ---- 分级筛选（T0~T3 / 样本不足；与「层」下拉正交）----
/** 分级清单（含未参与分级的「样本不足」，它也是一档可筛的类别） */
const PV_GRADE_NONE = 'na'
const pvGradeDefs = [
  { id: 'T0', label: 'T0', desc: '累计兑现前 25%', color: '#ff8f5a' },
  { id: 'T1', label: 'T1', desc: '累计兑现 25~50%', color: '#f6ad55' },
  { id: 'T2', label: 'T2', desc: '累计兑现 50~75%', color: '#a3a3b8' },
  { id: 'T3', label: 'T3', desc: '累计兑现后 25%', color: '#5f6373' },
  { id: PV_GRADE_NONE, label: '样本不足', desc: `配对数 < ${PV_MIN_PAIRS}，不参与分级`, color: 'var(--fg-3)' },
] as const
/** 某张卡属于哪一档（无 grade = 样本不足档） */
function pvGradeOf(card: PvCardValue): string {
  return card.grade ?? PV_GRADE_NONE
}
const pvGradeLegend = useSeriesFilter(() => pvGradeDefs.map(g => ({ id: g.id, name: g.label })))
const pvCounts = pvGradeLegend.counts
/** 分级过滤后的卡（行/排名表共用；层过滤在前、分级在后） */
const pvGradeFilteredCards = computed(() =>
  pvFilteredCards.value.filter(c => pvGradeLegend.isVisible(pvGradeOf(c))),
)
/** 气泡图行 = 过滤后前 16 张（累计降序；行数上限防 SVG 过高） */
const PV_MAX_ROWS = 16
const pvRows = computed(() =>
  pvGradeFilteredCards.value.slice(0, PV_MAX_ROWS).map((card, rowIndex) => ({
    card,
    rowIndex,
    agentId: card.agentId,
    label: agentName(card.agentId),
    gradeText: card.grade ?? (card.totalPairs > 0 ? '·' : ''),
  })),
)
const pvTableRows = computed(() => pvGradeFilteredCards.value)

// ---- SVG 布局 ----
const pvLabelW = 96
const pvBarAreaW = 120
const pvRowH = 22
const pvPadT = 18
const pvXLabelH = 26
const pvSvgH = computed(() => pvPadT + pvRows.value.length * pvRowH + pvXLabelH)
const pvPlotW = computed(() => svgW.value - pvLabelW - pvBarAreaW - 8)
const pvBarX = computed(() => svgW.value - pvBarAreaW + 10)
/** 房间列中心 x（列宽 = pvPlotW / 房间数） */
function pvX(i: number): number {
  const n = pvResult.value?.rooms.length ?? 1
  const cw = pvPlotW.value / Math.max(1, n)
  return pvLabelW + cw * i + cw / 2
}
function pvRowY(rowIndex: number): number {
  return pvPadT + pvRowH * rowIndex + pvRowH / 2
}
const pvMaxAbsEffect = computed(() => {
  let m = 1
  for (const row of pvRows.value) for (const e of row.card.roomEffects) m = Math.max(m, Math.abs(e.effect))
  return m
})
function pvBubbleR(e: { effect: number }): number {
  if (e.effect === 0) return 1.6
  return 2 + 5 * Math.sqrt(Math.abs(e.effect) / pvMaxAbsEffect.value)
}
function pvBubbleFill(e: { effect: number }): string {
  if (e.effect > 0) return '#f6ad55'
  if (e.effect < 0) return '#63b3ed'
  return 'var(--wa-140)'
}
function pvBubbleTitle(card: PvCardValue, e: PvCardRoomEffect, i: number): string {
  const room = pvResult.value?.rooms[i]
  const roomLabel = room ? `${room.label}（${room.runCount} 投稿）` : e.roomKey
  if (!e.appeared && e.effect === 0) return `${agentName(card.agentId)} · ${roomLabel}\n未出场/实装前（计 0）`
  const pairNote = e.pairs > 0 ? `（${e.pairs} 配对中位数）` : '（无配对样本，计 0）'
  return `${agentName(card.agentId)} · ${roomLabel}\n边际兑现 ${fmt(e.effect, 0)} 分${pairNote}${e.frontier ? '｜顶分在场' : ''}`
}
const pvXTicks = computed(() => {
  const rooms = pvResult.value?.rooms ?? []
  const step = Math.max(1, Math.ceil(rooms.length / 12))
  const out: { index: number; label: string }[] = []
  for (let i = 0; i < rooms.length; i += step) out.push({ index: i, label: rooms[i].date.slice(5) })
  if (rooms.length > 1 && (rooms.length - 1) % step !== 0) {
    out.push({ index: rooms.length - 1, label: rooms[rooms.length - 1].date.slice(5) })
  }
  return out
})
/** 行末累计柱（sqrt 尺度防一张大卡压扁全表） */
const pvMaxCum = computed(() => Math.max(1, ...pvRows.value.map(r => Math.max(0, r.card.cumulative))))
const pvBarMaxW = computed(() => pvBarAreaW - 44)
function pvBarW(card: PvCardValue): number {
  if (card.cumulative <= 0) return 0
  return Math.sqrt(card.cumulative / pvMaxCum.value) * pvBarMaxW.value
}
const pvBarH = 10
function pvBarY(card: PvCardValue): number {
  const row = pvRows.value.find(r => r.card === card)
  return row ? pvRowY(row.rowIndex) - pvBarH / 2 : 0
}
function pvBarFill(card: PvCardValue): string {
  if (card.grade === 'T0') return '#ff8f5a'
  if (card.grade === 'T1') return '#f6ad55'
  if (card.grade === 'T2') return '#a3a3b8'
  if (card.grade === 'T3') return '#5f6373'
  /* 原 --wa-160：该档位从未定义（色阶只有 150/200），描边静默失效 */
  return 'var(--wa-150)'
}
function pvRowTitle(row: { card: PvCardValue }): string {
  const c = row.card
  return [
    `${agentName(c.agentId)}（${pvTierLabel(c.tier)}${c.releaseDate ? `，实装 ${c.releaseDate}` : ''}）`,
    `累计兑现 ${fmt(c.cumulative, 0)} 分 · 场均 ${fmt(c.avgPerRoom, 0)} · 近3期 ${fmt(c.recentAvg, 0)}`,
    `上场 ${c.roomsAppeared}/${c.observableRooms} 期 · 顶分在场 ${c.frontierRooms} 期 · ${c.totalPairs} 配对`,
    `每万菲林 ${c.roiPer10kFilm == null ? '—（赠送）' : fmt(c.roiPer10kFilm, 0)} 分${c.grade ? ` · 分级 ${c.grade}` : ''}`,
  ].join('\n')
}
function pvTierLabel(tier: PvCardTier): string {
  return tier === 'limited' ? '限定' : tier === 'freeGift' ? '赠送' : tier === 'standard' ? '常驻' : 'A级'
}
/** 详情逐期柱高（% of max） */
function pvDetailBarH(e: PvCardRoomEffect): string {
  const pctv = (Math.abs(e.effect) / pvMaxAbsEffect.value) * 100
  return `${Math.max(2, pctv)}%`
}
function onPvMove(e: MouseEvent) {
  const { svgY } = readSvgPointer(e, { w: svgW.value, h: pvSvgH.value })
  const idx = Math.floor((svgY - pvPadT) / pvRowH)
  pvHover.value = pvRows.value[idx]?.agentId ?? ''
}

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

// ---- Chart 6 SVG ----
const ppLabelW = 60
const ppPadT = 26
const ppXLabelH = 26
const ppPurchaseH = 44
const ppScorePlotH = 90
const ppLaneH = 20
const ppSvgH = computed(() => {
  const nLanes = 3
  return ppPadT + ppPurchaseH + ppScorePlotH + nLanes * (ppLaneH + 6) + ppXLabelH
})
const ppStepCount = computed(() => ppResult.value?.plan.steps.length ?? 0)
const ppPlotW = computed(() => svgW.value - ppLabelW - 16)
const ppCellW = computed(() => ppPlotW.value / Math.max(1, ppStepCount.value))
function ppX(i: number): number {
  const n = Math.max(1, ppStepCount.value)
  return ppLabelW + (i + 0.5) * (ppPlotW.value / n)
}
const ppXTicks = computed(() => {
  const steps = ppResult.value?.plan.steps ?? []
  const step = Math.max(1, Math.ceil(steps.length / 12))
  const out: { index: number; label: string }[] = []
  for (let i = 0; i < steps.length; i += step) out.push({ index: i, label: steps[i].date.slice(5) })
  if (steps.length > 1 && (steps.length - 1) % step !== 0) {
    out.push({ index: steps.length - 1, label: steps[steps.length - 1].date.slice(5) })
  }
  return out
})
const ppScoreMax = computed(() => Math.max(1, ...(ppResult.value?.plan.steps.map(s => s.assignment.totalScore) ?? [1])))
function ppScoreY(v: number): number {
  const top = ppPadT + ppPurchaseH
  return top + ppScorePlotH - (v / ppScoreMax.value) * ppScorePlotH
}
const ppScorePts = computed(() =>
  (ppResult.value?.plan.steps ?? []).map((s, i) => ({
    x: ppX(i),
    y: ppScoreY(s.assignment.totalScore),
    score: s.assignment.totalScore,
    label: s.periodLabel,
  })),
)
const ppScoreLine = computed(() => ppScorePts.value.map(p => `${p.x},${p.y}`).join(' '))
/** 三房间选队泳道 */
const ppTeamLanes = computed(() => {
  const steps = ppResult.value?.plan.steps ?? []
  const top = ppPadT + ppPurchaseH + ppScorePlotH + 8
  return [0, 1, 2].map(li => ({
    y: top + li * (ppLaneH + 6),
    h: ppLaneH,
    cells: steps.map((s) => {
      const pick = s.assignment.picks[li]
      if (!pick || pick.team.every(m => !m)) return { empty: true, text: '', title: `${s.periodLabel} 房${li + 1}：无可用队` }
      return {
        empty: false,
        text: pick.team.map(agentName).join('+'),
        title: `${s.periodLabel} 房${li + 1}（${pick.bossRoom.bossName}）：${pick.team.map(agentName).join('+')} = ${fmt(pick.score, 0)} 分`,
      }
    }),
  }))
})

// ---- 泳道筛选（点图例显隐：购买 / 期分 / 房1~房3）----
/** 泳道清单：2 个固定泳道 + 3 个房间泳道 */
const ppLaneDefs = [
  { id: 'purchase', label: '购买', desc: '每期买了哪张卡（方块 = 卡，颜色同角色）', color: 'var(--app-primary)', fixed: true },
  { id: 'score', label: '期分', desc: '每期危局总分折线', color: 'var(--app-primary)', fixed: true },
  { id: 'room1', label: '房1', desc: '当期第 1 个 Boss 的选队', color: 'var(--c-info)', roomNo: 1 },
  { id: 'room2', label: '房2', desc: '当期第 2 个 Boss 的选队', color: 'var(--c-info)', roomNo: 2 },
  { id: 'room3', label: '房3', desc: '当期第 3 个 Boss 的选队', color: 'var(--c-info)', roomNo: 3 },
] as const
const ppLegend = useSeriesFilter(() => ppLaneDefs.map(d => ({ id: d.id, name: d.label })))
/** 可见房间泳道（编号沿用原房号 ⇒ 隐藏房2 后房3 仍写「房3」，不会串号） */
const ppVisibleTeamLanes = computed(() =>
  ppTeamLanes.value
    .map((lane, li) => ({ ...lane, roomNo: li + 1 }))
    .filter(lane => ppLegend.isVisible(`room${lane.roomNo}`)),
)
const ppTopValues = computed(() => (ppResult.value?.values ?? []).slice(0, 20))
function ppTierLabel(tier: number): string {
  return tier === 3 ? '满配' : tier === 2 ? '本体+专武' : tier === 1 ? '本体' : '—'
}
</script>

<style scoped>
.time-charts-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chart-controls {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.ctl-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ctl-label {
  font-size: 11px;
  color: var(--wa-550);
}
.ctl-check {
  font-size: 11px;
  color: var(--wa-650);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding-bottom: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.ctl-hint {
  flex: 1 1 280px;
  min-width: 280px;
}
.chart-progress {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.chart-progress .n-progress {
  flex: 1;
}
.progress-text {
  font-size: 11px;
  color: var(--wa-600);
  white-space: nowrap;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chart-subtitle {
  font-size: 12px;
  color: var(--wa-550);
}
.timeline-svg {
  width: 100%;
  display: block;
  user-select: none;
}
.timeline-wrap {
  position: relative;
}
/* ---- 可点图例筛选（与「血量膨胀」页同交互：点一下显隐该系列） ---- */
.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  margin-bottom: 10px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}
.legend-item:hover {
  background: var(--fill-hover);
}
.legend-item.off {
  opacity: 0.35;
  text-decoration: line-through;
}
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex: 0 0 auto;
}
.legend-item .name {
  color: var(--fg-2);
  white-space: nowrap;
}
.legend-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.legend-action {
  cursor: pointer;
  border-bottom: 1px dashed var(--line-strong);
}
/* Chart 4 两条线的图例色块（与图上 stroke 同源：主线 --app-primary、金数副线 --c-warning） */
.sim-swatch-hp {
  background: var(--app-primary);
}
.sim-swatch-gold {
  background: var(--c-warning);
}
.grid-line {
  stroke: var(--wa-80);
  stroke-width: 1;
}
.axis-label {
  fill: var(--wa-450);
  font-size: 10px;
}
.x-label {
  font-size: 9.5px;
}
.trend-line {
  fill: none;
  stroke: var(--app-primary);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.trend-point {
  cursor: pointer;
}
.swap-line {
  stroke: rgba(246, 173, 85, 0.45);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.lane-label {
  fill: var(--wa-500);
  font-size: 10px;
}
.lane-cell {
  stroke: rgba(15, 15, 18, 0.9);
  stroke-width: 0.5;
  opacity: 0.92;
}
.lane-text {
  fill: rgba(10, 10, 14, 0.85);
  font-size: 9px;
  font-weight: 700;
  pointer-events: none;
}
.hover-line {
  stroke: var(--wa-350);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}
.hover-card {
  position: absolute;
  z-index: 10;
  background: var(--app-tooltip-bg);
  border: 1px solid var(--wa-140);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11.5px;
  pointer-events: none;
  max-width: 260px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.hc-title {
  font-weight: 700;
  margin-bottom: 3px;
  /* 原 #fff：明亮模式 .hover-card 底是 rgba(255,255,255,0.97)，白字不可见 */
  color: var(--app-text-solid);
}
.hc-row {
  color: var(--wa-780);
  line-height: 1.5;
}
.hc-swap {
  color: #f6ad55;
  font-weight: 600;
}
.swap-events {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.swap-events-title {
  font-size: 11px;
  color: var(--wa-550);
}
.swap-chip {
  font-size: 11px;
  background: rgba(246, 173, 85, 0.12);
  color: #f6ad55;
  border: 1px solid rgba(246, 173, 85, 0.3);
  border-radius: 6px;
  padding: 2px 8px;
}
.table-wrap {
  overflow-x: auto;
}
.tl-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.tl-table th,
.tl-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--wa-60);
  white-space: nowrap;
}
.tl-table th {
  color: var(--wa-500);
  font-weight: 600;
  font-size: 11px;
}
.tl-table tr:hover td {
  background: var(--wa-30);
}
.tl-table tr.swap-row td {
  background: rgba(246, 173, 85, 0.05);
}
.team-cell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 4px;
}
.kill-line {
  color: #63e2b7;
  font-weight: 700;
}
.gold-cell {
  color: var(--wa-700);
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.swap-badge {
  color: #f6ad55;
  font-weight: 600;
}
.swap-kind {
  font-weight: 700;
  margin-left: 4px;
}
.swap-kind.upgrade {
  color: #ff8f5a;
}
.swap-kind.lateral {
  color: var(--wa-550);
  font-weight: 500;
}
.bench-note {
  color: var(--wa-450);
  font-size: 11px;
}
.boss-hit {
  color: #f6ad55;
  font-weight: 700;
}
.boss-appearance {
  margin-top: 6px;
  font-size: 11px;
  color: #f6ad55;
}
.strength-row {
  cursor: default;
}
.strength-row:hover line {
  stroke-width: 6;
}
.strength-label {
  font-size: 11px;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.55);
  stroke-width: 2.5px;
}
.hc-bench {
  color: var(--wa-550);
}
.no-change {
  color: var(--wa-300);
}
.node-note {
  font-size: 10px;
  color: #f6ad55;
  border: 1px solid rgba(246, 173, 85, 0.35);
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 4px;
}
.empty-hint {
  color: var(--wa-500);
  font-size: 13px;
  line-height: 1.8;
  padding: 12px 4px;
}
.dd-svg {
  display: block;
  max-width: 100%;
}
.dd-tick {
  fill: var(--wa-450);
  font-size: 10px;
}
.dd-baseline {
  fill: var(--wa-600);
  font-size: 10px;
}
.dd-label {
  fill: var(--wa-820);
  font-size: 10px;
  paint-order: stroke;
  stroke: rgba(10, 10, 14, 0.85);
  stroke-width: 3px;
}
.dd-caption {
  margin-top: 6px;
  color: var(--wa-500);
  font-size: 11.5px;
  line-height: 1.7;
}

/* ========== Chart 3：每期新角色 · 强队强度 ========== */
.chart3-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chart3-list {
  max-height: 340px;
  overflow-y: auto;
  margin-bottom: 8px;
}
.chart3-team-inputs {
  gap: 6px;
}
.sim-main-name {
  font-size: 12px;
  color: var(--wa-850);
  padding: 3px 0 6px;
  white-space: nowrap;
}
.ctl-note {
  font-size: 10.5px;
  color: var(--wa-450);
  max-width: 220px;
  line-height: 1.5;
}
.chart3-teams-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}
.chart3-teams-cell .team-cell {
  gap: 6px;
}
.team-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--wa-80);
  color: var(--wa-600);
  font-size: 10px;
  flex: 0 0 auto;
}
.add-team-btn {
  margin-top: 2px;
}
.chart3-plot {
  margin-top: 4px;
}
.kill-line-ref {
  stroke: rgba(99, 226, 183, 0.35);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}
.small-hint {
  font-size: 12px;
  padding: 8px 2px;
}

/* ========== Boss 数据条 ========== */
.boss-data-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  align-items: center;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid var(--wa-70);
  border-radius: 8px;
  background: var(--wa-20);
}
.boss-data-title {
  font-size: 12px;
  font-weight: 700;
  color: #f6ad55;
  white-space: nowrap;
}
.boss-data-item {
  font-size: 11.5px;
  color: var(--wa-720);
  white-space: nowrap;
}

/* ========== Chart 4：菲林经济模拟 ========== */
.sim-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: flex-end;
  margin-bottom: 10px;
}
.sim-plot {
  margin-top: 4px;
}
.sim-line {
  fill: none;
  stroke: var(--app-primary);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.sim-gold-line {
  fill: none;
  stroke: #f6ad55;
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.gold-axis-label {
  fill: rgba(246, 173, 85, 0.75);
}

/* ========== Chart 5：抽卡价值 · 危局兑现 ========== */
.pv-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 11.5px;
  color: var(--wa-600);
  margin-bottom: 8px;
}
.pv-plot {
  margin-bottom: 8px;
}
.pv-row-bg {
  fill: transparent;
  cursor: pointer;
}
.pv-row-hover {
  fill: var(--wa-30);
}
.pv-row-label {
  fill: var(--wa-750);
  font-size: 10.5px;
}
.pv-grade {
  font-size: 9px;
  font-weight: 700;
}
.pv-T0 {
  fill: #ff8f5a;
}
.pv-T1 {
  fill: #f6ad55;
}
.pv-T2 {
  fill: #a3a3b8;
}
.pv-T3 {
  fill: #5f6373;
}
.pv-bubble {
  cursor: pointer;
}
.pv-release-line {
  stroke: var(--app-primary);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
.pv-release-label {
  fill: var(--app-primary);
  font-size: 9px;
}
.pv-bar-label {
  fill: var(--wa-700);
  font-size: 10px;
}
.pv-detail {
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid var(--wa-70);
  border-radius: 8px;
  background: var(--wa-20);
}
.pv-detail-title {
  font-size: 12px;
  color: var(--wa-780);
  line-height: 1.8;
  margin-bottom: 8px;
}
.pv-detail-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 90px;
  overflow-x: auto;
  padding-top: 2px;
}
.pv-detail-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  min-width: 34px;
  height: 100%;
}
.pv-detail-bar-fill {
  width: 12px;
  border-radius: 3px 3px 0 0;
  min-height: 2px;
}
.pv-detail-bar-fill.pv-pos {
  background: #f6ad55;
}
.pv-detail-bar-fill.pv-neg {
  background: #63b3ed;
}
.pv-detail-bar-label {
  font-size: 8.5px;
  color: var(--wa-450);
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  max-height: 46px;
  overflow: hidden;
}
.pv-detail-bar-val {
  font-size: 9px;
  color: var(--wa-650);
  white-space: nowrap;
}
.pv-out {
  opacity: 0.45;
}
.pv-sel-row {
  background: rgba(246, 173, 85, 0.08);
}
.pv-neg-num {
  color: #63b3ed;
}
.pv-detail-bar.pv-out .pv-detail-bar-fill {
  background: var(--wa-120);
}

/* ========== Chart 6：抽卡规划器 ========== */
.pp-plot {
  margin-bottom: 8px;
}
.pp-purchase {
  stroke: rgba(15, 15, 18, 0.9);
  stroke-width: 0.5;
  cursor: default;
}
.pp-purchase-label {
  fill: var(--wa-650);
  font-size: 9px;
}
.pp-score-line {
  fill: none;
  stroke: var(--app-primary);
  stroke-width: 2;
  stroke-linejoin: round;
}
.pp-team-text {
  fill: rgba(10, 10, 14, 0.85);
  font-size: 8.5px;
  font-weight: 700;
  pointer-events: none;
}
.pp-values {
  margin-top: 10px;
}

/* ========== Chart 7：同槽位角色对比 ========== */
.sc-legend {
  display: flex;
  gap: 14px;
  align-items: center;
  font-size: 11px;
  color: var(--fg-3);
  margin-bottom: 4px;
}
.sc-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
/* 可点图例（Chart 7 的 A/B 两队）：点一下显隐该线 */
.sc-legend-click {
  cursor: pointer;
  user-select: none;
  border-radius: var(--radius-md);
  padding: 1px 5px;
}
.sc-legend-click:hover {
  background: var(--fill-hover);
}
.sc-legend-click.off {
  opacity: 0.35;
  text-decoration: line-through;
}
.sc-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.sc-line {
  fill: none;
  stroke-width: 2.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.sc-line-a {
  stroke: var(--c-info);
}
.sc-line-b {
  stroke: var(--c-warning);
}
.sc-table {
  margin-top: 10px;
}
.sc-diff-a {
  color: var(--c-info);
  font-weight: 700;
}
.sc-diff-b {
  color: var(--c-warning);
  font-weight: 700;
}

</style>
