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
            :stroke="hoverNode === i ? '#fff' : 'rgba(255,255,255,0.25)'"
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
              :fill="selectedBossAppearances.has(n.nodeId) ? 'rgba(246,173,85,0.22)' : 'rgba(255,255,255,0.04)'"
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
      <div class="timeline-wrap">
        <svg :viewBox="`0 0 ${svgW} ${strengthSvgH}`" class="timeline-svg">
          <!-- 网格 + Y 轴（复用 Chart1 的血量%尺度） -->
          <g v-for="(y, i) in yTicks" :key="'sg' + i">
            <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
            <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ yLabel(i) }}%</text>
          </g>
          <!-- 每队一条存活横带：覆盖其存活的版本格 -->
          <g v-for="b in strengthBands" :key="b.seed.key" class="strength-row">
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
          <line :x1="ddX(t.index)" :y1="ddPadT" :x2="ddX(t.index)" :y2="ddPlotBottom" stroke="rgba(255,255,255,0.06)" />
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
          stroke="rgba(255,255,255,0.28)"
          stroke-dasharray="4 4"
        />
        <text :x="svgW - ddPadR - 2" :y="ddY(1) - 5" text-anchor="end" class="dd-baseline">100% 标准</text>
        <!-- 散点 -->
        <g v-for="p in ddPoints" :key="`ddp${p.agentId}`">
          <circle
            v-if="p.value != null"
            :cx="ddCX(p.nodeIndex) + ddJitter(p.agentId)"
            :cy="ddY(p.value)"
            r="4"
            :fill="ddColor(p.value)"
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
            <line :x1="chart3X(t.index)" :y1="padT" :x2="chart3X(t.index)" :y2="padT + plotH" stroke="rgba(255,255,255,0.06)" />
            <text :x="chart3X(t.index)" :y="chart3SvgH - 8" class="axis-label x-label" text-anchor="middle">{{ t.label }}</text>
          </g>
          <!-- 点 -->
          <g v-for="(p, i) in chart3Pts" :key="'c3p' + i">
            <circle
              :cx="p.x"
              :cy="p.y"
              r="4.5"
              :fill="p.color"
              :stroke="chart3Hover === i ? '#fff' : 'rgba(255,255,255,0.25)'"
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

      <!-- 折线图：血量%主线 + 金数副线 -->
      <div v-if="simPoints.length > 0" class="timeline-wrap sim-plot">
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
          <polyline :points="simHpLine" class="sim-line" />
          <!-- 金数副线（右轴） -->
          <polyline :points="simGoldLine" class="sim-gold-line" />
          <!-- 金数右轴刻度 -->
          <text v-for="g in 4" :key="'gp' + g" :x="svgW - padR + 2" :y="simGoldY((simGoldMax / 4) * g) + 3" class="axis-label gold-axis-label">{{ Math.round((simGoldMax / 4) * g) }}</text>
          <!-- 点 -->
          <g v-for="(p, i) in simPts" :key="'fp' + i">
            <circle :cx="p.x" :cy="p.y" r="3.5" :fill="p.color" :stroke="simHover === i ? '#fff' : 'rgba(255,255,255,0.25)'" :stroke-width="simHover === i ? 2 : 1" class="trend-point">
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
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NCard, NSelect, NInputNumber, NButton, NProgress } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeTeamTimeline, type NewAgentBench, type SwapKind, type TeamStrengthSeed, type TeamTimelineResult } from '@/composables/teamTimeline'
import { buildNewCharacterRows, computeFilmSimulation, computeNewCharacterPoints, prefillStrongTeamsFromPresets, type FilmSimPoint, type NewCharacterPoint, type NewCharacterRow } from '@/composables/teamTimeline'
import { buildPeriodAxis, type PeriodAxisNode } from '@/composables/bossSchedule'
import { AGENT_RELEASE_NODE, VERSION_NODES, releaseNodeOf, nodeIndexOf } from '@/data/versionTimeline'
import { buildDirectDamageTimeline, type DirectDamagePoint } from '@/composables/multiplierCoefficients'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, BossPresetFile, PhaseView } from '@/types/bossPreset'

const configStore = useConfigStore()
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
const svgW = computed(() => Math.max(480, Math.min(1180, typeof window !== 'undefined' ? window.innerWidth - 120 : 960)))
const padL = 54
const padR = 14
const padT = 26
const plotH = 300
const laneH = 22
const laneGap = 6
const laneTotalH = laneH * 3 + laneGap * 2
// 第 4 条车道：当期 Boss 排期（危局/试炼）
const bossLaneY = padT + plotH + 12 + laneTotalH + laneGap
const xLabelH = 26
const svgH = computed(() => padT + plotH + 12 + laneTotalH + laneGap + laneH + xLabelH)

const nodeCount = computed(() => result.value?.nodes.length ?? 0)
const plotW = computed(() => svgW.value - padL - padR)
const cellW = computed(() => (nodeCount.value > 1 ? plotW.value / nodeCount.value : plotW.value))
function xOf(i: number): number {
  if (nodeCount.value <= 1) return padL + plotW.value / 2
  return padL + (i / (nodeCount.value - 1)) * plotW.value
}

const yMax = computed(() => {
  const maxR = Math.max(...(result.value?.nodes.map(n => n.hpRatio) ?? [0]), 0)
  const target = Math.max(100, maxR * 1.05)
  const step = target <= 200 ? 50 : 100
  return Math.ceil(target / step) * step
})
function yOf(v: number): number {
  return padT + plotH - (v / yMax.value) * plotH
}
const yTicks = computed(() => {
  const step = yMax.value <= 200 ? 50 : 100
  const out: number[] = []
  for (let v = 0; v <= yMax.value; v += step) out.push(yOf(v))
  return out
})
function yLabel(i: number): number {
  const step = yMax.value <= 200 ? 50 : 100
  return i * step
}

const chartPts = computed(() =>
  (result.value?.nodes ?? []).map((n, i) => ({
    x: xOf(i),
    y: yOf(Math.min(n.hpRatio, yMax.value)),
    color: colorOf(n.team[0]),
    isSwap: !!n.swappedIn,
  })),
)
const linePoints = computed(() => chartPts.value.map(p => `${p.x},${p.y}`).join(' '))

const swapGuides = computed(() =>
  (result.value?.nodes ?? [])
    .map((n, i) => (n.swappedIn ? { x: xOf(i) } : null))
    .filter((x): x is { x: number } => x !== null),
)

// 泳道
const laneDefs = computed(() => {
  const nodes = result.value?.nodes ?? []
  const makeLane = (key: string, label: string, slotOf: (n: typeof nodes[number]) => string) => {
    const cells = nodes.map((n, i) => ({
      x: i === 0 ? padL : padL + i * cellW.value,
      color: colorOf(slotOf(n)),
      name: agentName(slotOf(n)),
    }))
    // 换人标签：每段连续同色块首格显示角色名
    const labels: { x: number; text: string }[] = []
    let prev: string | null = null
    nodes.forEach((n, i) => {
      const id = slotOf(n)
      if (id !== prev) {
        labels.push({ x: padL + i * cellW.value + 4, text: agentName(id) })
        prev = id
      }
    })
    return { key, label, cells, labels }
  }
  const laneY = (idx: number) => padT + plotH + 12 + idx * (laneH + laneGap)
  return [
    { ...makeLane('main', '主C', n => n.team[0]), y: laneY(0) },
    { ...makeLane('t1', '队友1', n => n.team[1]), y: laneY(1) },
    { ...makeLane('t2', '队友2', n => n.team[2]), y: laneY(2) },
  ]
})

// X 轴标签：节点多时抽稀
const xTicks = computed(() => {
  const nodes = result.value?.nodes ?? []
  if (nodes.length === 0) return []
  const step = Math.max(1, Math.ceil(nodes.length / 14))
  const out: { x: number; label: string }[] = []
  for (let i = 0; i < nodes.length; i += step) {
    out.push({ x: xOf(i), label: nodes[i].nodeLabel })
  }
  if ((nodes.length - 1) % step !== 0) {
    out.push({ x: xOf(nodes.length - 1), label: nodes[nodes.length - 1].nodeLabel })
  }
  return out
})

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
interface StrengthBand {
  seed: TeamStrengthSeed
  startIndex: number
  endIndex: number
  /** 首次跌出 Top-K 的节点下标（null = 存活到最后） */
  eliminatedAt: number | null
}
const strengthBands = computed<StrengthBand[]>(() => {
  const seeds = result.value?.strengthSeeds ?? []
  const nodeCount = result.value?.nodes.length ?? 0
  const k = Math.max(1, Math.floor(survivalK.value || 1))
  if (seeds.length === 0 || nodeCount === 0) return []
  // 逐节点排名：可达（已实装且未被淘汰）按伤害取前 K；可达集合只增 ⇒ 排名单调不升 ⇒ 淘汰永久
  // 注意：可达集合为空（如首期新队友尚未实装/全被收敛排除）不能提前 break——
  // 否则后续所有期的 Top-K 裁剪都不会执行，弱队全部存活到最后（曾致淘汰失效）
  const eliminatedAt = new Map<string, number>()
  for (let n = 0; n < nodeCount; n++) {
    const reachable = seeds.filter(s => s.startIndex <= n && !eliminatedAt.has(s.key))
    reachable.sort((a, b) => b.damage - a.damage)
    for (let r = k; r < reachable.length; r++) eliminatedAt.set(reachable[r].key, n)
  }
  return seeds
    .map(seed => {
      const cut = eliminatedAt.get(seed.key)
      const endIndex = cut == null ? nodeCount - 1 : cut - 1
      return { seed, startIndex: seed.startIndex, endIndex, eliminatedAt: cut ?? null }
    })
    .filter(b => b.endIndex >= b.startIndex)
})
const strengthSvgH = computed(() => padT + plotH + 12 + xLabelH)
/** 横带 Y = 血量% 尺度，钳制进绘图区 */
function bandY(hpRatio: number): number {
  return yOf(Math.min(hpRatio, yMax.value))
}
function bandTitle(b: StrengthBand): string {
  const team = b.seed.team.map(agentName).join('+')
  const span = `${result.value?.nodes[b.startIndex]?.nodeLabel ?? ''} ~ ${result.value?.nodes[b.endIndex]?.nodeLabel ?? ''}`
  const elim = b.eliminatedAt != null && result.value?.nodes[b.eliminatedAt]
    ? `｜${result.value.nodes[b.eliminatedAt].nodeLabel} 起跌出 Top-${survivalK.value} 淘汰`
    : '｜存活到最后'
  return `${team}｜伤害 ${compact(b.seed.damage)}（${fmt(b.seed.hpRatio, 1)}%）｜${span}${elim}`
}
const hoverCardX = ref(0)
const hoverCardY = ref(0)
function onSvgMove(e: MouseEvent) {
  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
  const relX = e.clientX - rect.left
  const scale = svgW.value / rect.width
  const svgX = relX * scale
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

const ddPadL = 46
const ddPadR = 18
const ddPadT = 18
const ddPadB = 32
const ddSvgH = 268
const ddPlotBottom = ddSvgH - ddPadB

/**
 * 直伤系数图横轴：按节点**宽度权重**排布（修 1.4/2.5 合并卡池列视觉偏窄——
 * 此前按节点索引等距，合并版只有一个节点、只有普通两期版一半宽）。
 * 合并卡池（phaseLabel='合并'，1.4/2.5）一个节点覆盖整个版本 = 2 格；上半/下半 = 1 格。
 */
const ddNodeWidths = VERSION_NODES.map(n => (n.phaseLabel === '合并' ? 2 : 1))
const ddTotalWidth = ddNodeWidths.reduce((a, b) => a + b, 0)
const ddNodeFrac = (() => {
  const lefts: number[] = []
  const centers: number[] = []
  let acc = 0
  for (const w of ddNodeWidths) {
    lefts.push(acc / ddTotalWidth)
    centers.push((acc + w / 2) / ddTotalWidth)
    acc += w
  }
  return { lefts, centers }
})()
function ddPlotSpan(): number {
  return svgW.value - ddPadL - ddPadR
}
/** 节点列左缘（版本网格线 / 测试服阴影） */
function ddX(nodeIndex: number): number {
  return ddPadL + (ddNodeFrac.lefts[nodeIndex] ?? 0) * ddPlotSpan()
}
/** 节点列中心（散点 / 标签） */
function ddCX(nodeIndex: number): number {
  return ddPadL + (ddNodeFrac.centers[nodeIndex] ?? 0) * ddPlotSpan()
}
/** 版本列中心（版本号刻度文字，t.index = 该版本首节点下标） */
function ddTickCenterX(firstIndex: number): number {
  let w = 0
  for (let j = firstIndex; j < VERSION_NODES.length && VERSION_NODES[j].version === VERSION_NODES[firstIndex].version; j++) w += ddNodeWidths[j]
  return ddPadL + (ddNodeFrac.lefts[firstIndex] + w / 2) * ddPlotSpan()
}

const ddVMin = computed(() => {
  const vs = ddPoints.value.map((p) => p.value).filter((v): v is number => v != null)
  return Math.min(0.7, ...(vs.length ? vs : [0.7])) - 0.03
})
const ddVMax = computed(() => {
  const vs = ddPoints.value.map((p) => p.value).filter((v): v is number => v != null)
  return Math.max(1.3, ...(vs.length ? vs : [1.3])) + 0.03
})

function ddY(v: number): number {
  const span = ddVMax.value - ddVMin.value
  return ddPadT + (1 - (v - ddVMin.value) / span) * (ddPlotBottom - ddPadT)
}

const ddYTicks = [0.75, 0.9, 1.0, 1.1, 1.25]

/** 每个版本只标首个节点的版本号 */
const ddXTicks = (() => {
  const seen = new Set<string>()
  return VERSION_NODES.map((n, index) => ({ index, label: n.version })).filter(({ label }) => {
    if (seen.has(label)) return false
    seen.add(label)
    return true
  })
})()

/** 测试服节点阴影（note 含「测试服」）：覆盖该节点列（合并节点 = 2 格宽），随 svgW 响应式 */
const ddTestServerRects = computed(() => {
  const rects: Array<{ x: number; w: number }> = []
  VERSION_NODES.forEach((n, index) => {
    if (!(n.note ?? '').includes('测试服')) return
    const left = ddX(index)
    const w = (ddNodeWidths[index] / ddTotalWidth) * ddPlotSpan()
    rects.push({ x: left, w: Math.max(8, w) })
  })
  return rects
})

function ddJitter(agentId: string): number {
  let h = 0
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) | 0
  return ((h % 7) - 3) * 4
}

function ddColor(v: number): string {
  if (v > 1.05) return '#7dd3fc'
  if (v < 0.95) return '#fdba74'
  return 'rgba(255,255,255,0.55)'
}

function ddNeedLabel(v: number): boolean {
  return Math.abs(v - 1) > 0.05
}

function ddShortName(name: string): string {
  const cleaned = name.replace(/「|」/g, '')
  return cleaned.length > 6 ? `${cleaned.slice(0, 6)}…` : cleaned
}

/** 同节点多个带标签点纵向错开；≥1 标在点上方、<1 标在下方 */
const ddLabelSlots = computed(() => {
  const groups = new Map<number, string[]>()
  for (const p of ddPoints.value) {
    if (p.value == null || !ddNeedLabel(p.value)) continue
    const arr = groups.get(p.nodeIndex) ?? []
    arr.push(p.agentId)
    groups.set(p.nodeIndex, arr)
  }
  const m = new Map<string, number>()
  for (const [, ids] of groups) ids.forEach((id, i) => m.set(id, i))
  return m
})

function ddLabelY(p: DirectDamagePoint): number {
  const v = p.value ?? 1
  const slot = ddLabelSlots.value.get(p.agentId) ?? 0
  return v >= 1 ? ddY(v) - (9 + slot * 13) : ddY(v) + 16 + slot * 13
}

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
const chart3SvgH = padT + plotH + 30
const chart3YMax = computed(() => {
  const maxR = Math.max(...(chart3Points.value.map(p => p.hpRatio) ?? [0]), 0)
  const target = Math.max(100, maxR * 1.05)
  const step = target <= 200 ? 50 : 100
  return Math.ceil(target / step) * step
})
function yOf3(v: number): number {
  return padT + plotH - (v / chart3YMax.value) * plotH
}
const chart3YGrid = computed(() => {
  const step = chart3YMax.value <= 200 ? 50 : 100
  const out: number[] = []
  for (let v = 0; v <= chart3YMax.value; v += step) out.push(yOf3(v))
  return out
})
function chart3YLabel(i: number): number {
  const step = chart3YMax.value <= 200 ? 50 : 100
  return i * step
}
function chart3X(i: number): number {
  const total = VERSION_NODES.length
  if (total <= 1) return padL + plotW.value / 2
  return padL + (i / (total - 1)) * plotW.value
}
const chart3XTicks = computed(() => {
  const step = Math.max(1, Math.ceil(VERSION_NODES.length / 16))
  const out: { index: number; label: string }[] = []
  for (let i = 0; i < VERSION_NODES.length; i += step) out.push({ index: i, label: VERSION_NODES[i].label })
  return out
})
/** 散点：同节点多角色/多队伍横向错开；颜色按队伍构成稳定映射（同队同色，跨角色可对比） */
const chart3Pts = computed(() => {
  const perNode = new Map<string, number>()
  for (const p of chart3Points.value) perNode.set(p.nodeId, (perNode.get(p.nodeId) ?? 0) + 1)
  const seen = new Map<string, number>()
  return chart3Points.value.map(p => {
    const idx = nodeIndexOf(p.nodeId)
    const total = perNode.get(p.nodeId) ?? 1
    const k = seen.get(p.nodeId) ?? 0
    seen.set(p.nodeId, k + 1)
    const offset = (k - (total - 1) / 2) * 7
    return {
      x: chart3X(idx) + offset,
      y: yOf3(Math.min(p.hpRatio, chart3YMax.value)),
      color: colorOf(p.team.join(',')),
      charName: p.charName,
      nodeLabel: p.nodeLabel,
      teamNames: p.team.map(agentName),
      teamNo: p.teamIndex + 1,
      damage: p.damage,
      hpRatio: p.hpRatio,
      goldLabel: p.goldLabel,
    }
  })
})
const chart3Hover = ref(-1)
const chart3HoverInfo = computed(() => chart3Pts.value[chart3Hover.value] ?? null)
const chart3CardX = ref(0)
const chart3CardY = ref(0)
function onChart3Move(e: MouseEvent) {
  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
  const scale = svgW.value / rect.width
  const svgX = (e.clientX - rect.left) * scale
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
    chart3CardX.value = Math.min(rect.width - 240, e.clientX - rect.left + 12)
    chart3CardY.value = e.clientY - rect.top + 8
  } else {
    chart3Hover.value = -1
  }
}

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
const simSvgH = padT + plotH + 30
const simYMax = computed(() => {
  const maxR = Math.max(...(simPoints.value.map(p => p.hpRatio) ?? [0]), 0)
  const target = Math.max(100, maxR * 1.05)
  const step = target <= 200 ? 50 : 100
  return Math.ceil(target / step) * step
})
function simY(v: number): number {
  return padT + plotH - (v / simYMax.value) * plotH
}
const simYGrid = computed(() => {
  const step = simYMax.value <= 200 ? 50 : 100
  const out: number[] = []
  for (let v = 0; v <= simYMax.value; v += step) out.push(simY(v))
  return out
})
function simYLabel(i: number): number {
  const step = simYMax.value <= 200 ? 50 : 100
  return i * step
}
const simGoldMax = computed(() => Math.max(...(simPoints.value.map(p => p.totalGold) ?? [6]), 6))
function simGoldY(g: number): number {
  return padT + plotH - (g / simGoldMax.value) * plotH
}
function simX(i: number): number {
  const n = simPoints.value.length
  if (n <= 1) return padL + plotW.value / 2
  return padL + (i / (n - 1)) * plotW.value
}
const simXTicks = computed(() => {
  const pts = simPoints.value
  const step = Math.max(1, Math.ceil(pts.length / 12))
  const out: { index: number; label: string }[] = []
  for (let i = 0; i < pts.length; i += step) out.push({ index: i, label: pts[i].label })
  if (pts.length > 1 && (pts.length - 1) % step !== 0) out.push({ index: pts.length - 1, label: pts[pts.length - 1].label })
  return out
})
const simPts = computed(() =>
  simPoints.value.map((p, i) => ({
    x: simX(i),
    y: simY(Math.min(p.hpRatio, simYMax.value)),
    color: colorOf(p.team.join(',')),
    label: p.label,
    hpRatio: p.hpRatio,
    totalGold: p.totalGold,
  })),
)
const simHpLine = computed(() => simPts.value.map(p => `${p.x},${p.y}`).join(' '))
const simGoldLine = computed(() =>
  simPoints.value.map((p, i) => `${simX(i)},${simGoldY(Math.min(p.totalGold, simGoldMax.value))}`).join(' '),
)
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
  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
  const scale = svgW.value / rect.width
  const svgX = (e.clientX - rect.left) * scale
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
    simCardX.value = Math.min(rect.width - 260, e.clientX - rect.left + 12)
    simCardY.value = e.clientY - rect.top + 8
  } else {
    simHover.value = -1
  }
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
  color: rgba(255, 255, 255, 0.55);
}
.ctl-check {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
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
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chart-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}
.timeline-svg {
  width: 100%;
  display: block;
  user-select: none;
}
.timeline-wrap {
  position: relative;
}
.grid-line {
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 1;
}
.axis-label {
  fill: rgba(255, 255, 255, 0.45);
  font-size: 10px;
}
.x-label {
  font-size: 9.5px;
}
.trend-line {
  fill: none;
  stroke: #4c8bf5;
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
  fill: rgba(255, 255, 255, 0.5);
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
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}
.hover-card {
  position: absolute;
  z-index: 10;
  background: rgba(24, 24, 32, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
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
  color: #fff;
}
.hc-row {
  color: rgba(255, 255, 255, 0.78);
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
  color: rgba(255, 255, 255, 0.55);
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  white-space: nowrap;
}
.tl-table th {
  color: rgba(255, 255, 255, 0.5);
  font-weight: 600;
  font-size: 11px;
}
.tl-table tr:hover td {
  background: rgba(255, 255, 255, 0.03);
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
  color: rgba(255, 255, 255, 0.7);
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
  color: rgba(255, 255, 255, 0.55);
  font-weight: 500;
}
.bench-note {
  color: rgba(255, 255, 255, 0.45);
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
  color: rgba(255, 255, 255, 0.55);
}
.no-change {
  color: rgba(255, 255, 255, 0.3);
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
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  line-height: 1.8;
  padding: 12px 4px;
}
.dd-svg {
  display: block;
  max-width: 100%;
}
.dd-tick {
  fill: rgba(255, 255, 255, 0.45);
  font-size: 10px;
}
.dd-baseline {
  fill: rgba(255, 255, 255, 0.6);
  font-size: 10px;
}
.dd-label {
  fill: rgba(255, 255, 255, 0.82);
  font-size: 10px;
  paint-order: stroke;
  stroke: rgba(10, 10, 14, 0.85);
  stroke-width: 3px;
}
.dd-caption {
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.5);
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
  color: rgba(255, 255, 255, 0.85);
  padding: 3px 0 6px;
  white-space: nowrap;
}
.ctl-note {
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.45);
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
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
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
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}
.boss-data-title {
  font-size: 12px;
  font-weight: 700;
  color: #f6ad55;
  white-space: nowrap;
}
.boss-data-item {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.72);
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
  stroke: #4c8bf5;
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
</style>
