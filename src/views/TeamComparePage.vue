<template>
  <div class="team-compare-page">
    <!-- 控制面板 -->
    <n-card size="small" :bordered="true">
      <div class="compare-controls">
        <div class="ctl-field" title="散点 = 各队在各金数档的一个点；难度曲线 = 每队自己的贪心优化路径（x 是累积难度代价，各队不对齐是特性，看形状不看同一 x）">
          <span class="ctl-label">图型</span>
          <n-radio-group v-model:value="chartMode" size="small">
            <n-radio-button value="scatter">散点</n-radio-button>
            <n-radio-button value="curve">难度曲线</n-radio-button>
          </n-radio-group>
        </div>
        <div
          v-if="chartMode === 'curve'"
          class="ctl-field"
          title="曲线只套预设金步（按 goldSteps 顺序 + 常驻 standardSteps），越界自动钳制到该队档位范围；不含散点页的「最优加金 / 自动下位」"
        >
          <span class="ctl-label">曲线金档</span>
          <n-select v-model:value="curveGold" :options="curveGoldOptions" size="small" style="width: 140px" />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">期数</span>
          <n-select
            v-model:value="selectedPeriodId"
            :options="periodOptions"
            size="small"
            filterable
            style="width: 240px"
            placeholder="先选期数"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">Boss</span>
          <n-select
            v-model:value="selectedBossId"
            :options="bossOptionsForPeriod"
            size="small"
            filterable
            style="width: 260px"
            placeholder="再选该期 Boss"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">预设队伍</span>
          <n-select
            v-model:value="presetGroupSel"
            :options="presetGroupOptionsC"
            size="small"
            style="width: 100px"
            placeholder="职业"
            title="一级分类：先选职业（命破/异常/强攻/击破/支援…），再选属性，最后出队伍"
          />
          <n-select
            v-model:value="presetSubSel"
            :options="presetSubOptions"
            size="small"
            style="width: 100px"
            placeholder="属性"
            title="二级分类：该职业下的属性/体系（如 强攻队·电）"
          />
          <n-select
            v-model:value="selectedPresetIds"
            :options="presetFilteredOptions"
            size="small"
            multiple
            filterable
            style="width: 220px"
            placeholder="选择队伍（可多选）"
          />
          <n-select
            v-model:value="quickPickMainC"
            :options="mainCQuickOptions"
            size="small"
            style="width: 130px"
            placeholder="按主C快选"
            title="选择主C → 勾选替换为仅含该主C的队伍（其他主C的队伍移除）"
            clearable
          />
        </div>
        <div class="ctl-field" title="操作难度是主观量（两图共用同一口径）：难度曲线的 x 轴 = Σ(交互次数×权重) + 合轴溢出秒×权重；散点图横轴同口径。按你的手感改，浏览器本地持久化；预设条目自带 weight 仍最优先">
          <n-popover trigger="click" placement="bottom-end" :style="{ width: '300px' }">
            <template #trigger>
              <n-button size="small" quaternary>难度权重</n-button>
            </template>
            <div class="diff-weight-pop">
              <div class="diff-weight-row">
                <span class="diff-weight-label">合轴溢出（难度点/秒）</span>
                <n-input-number v-model:value="diffWeights.overflow" size="tiny" :min="0" :max="20" :step="0.5" style="width: 84px" />
              </div>
              <div class="diff-weight-row" title="队友合轴解放出来的前台时间（秒）也算难度：对齐得越精确越难打，但换来更多平A/资源 ⇒ 总伤更高">
                <span class="diff-weight-label">队友合轴（难度点/秒）</span>
                <n-input-number v-model:value="diffWeights.align" size="tiny" :min="0" :max="20" :step="0.5" style="width: 84px" />
              </div>
              <div v-for="row in diffWeightRows" :key="row.type" class="diff-weight-row">
                <span class="diff-weight-label">{{ row.label }}</span>
                <n-input-number v-model:value="diffWeights.interaction[row.type]" size="tiny" :min="0" :max="20" :step="0.1" style="width: 84px" />
              </div>
              <n-button size="tiny" style="margin-top: 6px" @click="resetDiffWeights">恢复默认权重</n-button>
            </div>
          </n-popover>
        </div>
        <!-- 以下旋钮只服务散点（曲线口径固定为「预设基础档 + 当前 Boss」，见 difficultyCurve.ts 文件头） -->
        <template v-if="chartMode === 'scatter'">
        <div class="ctl-field">
          <span class="ctl-label">限定金</span>
          <n-input-number v-model:value="goldMin" size="small" :min="0" :max="20" style="width: 70px" />
          <span class="ctl-sep">~</span>
          <n-input-number v-model:value="goldMax" size="small" :min="0" :max="20" style="width: 70px" />
        </div>
        <div class="ctl-field" title="≤12金：自动逐金挑选伤害提升最大的加金组合（含专武本体购买，贪婪搜索，每队多算几轮全量伤害，较慢）；12金以上仍按预设 goldSteps 顺序">
          <n-checkbox v-model:checked="optimalGold" size="small">最优加金（≤12金）</n-checkbox>
        </div>
        <div class="ctl-field" title="未穿限定音擎的槽位自动从下方装填池按伤害择优穿戴；选中的限定音擎按本体（精炼1）如实计入总限定金——有金就是金。预设 wEngines 仅限定音擎保留。关闭则回退预设基础音擎">
          <n-checkbox v-model:checked="autoEngine" size="small">自动下位</n-checkbox>
        </div>
        <template v-if="autoEngine">
          <div class="ctl-field" title="自动下位音擎的默认精炼档：A 级 / 常驻 S">
            <span class="ctl-label">下位精炼 A/常驻</span>
            <n-input-number v-model:value="autoModA" size="small" :min="1" :max="5" style="width: 56px" />
            <span class="ctl-sep">/</span>
            <n-input-number v-model:value="autoModStd" size="small" :min="1" :max="5" style="width: 56px" />
          </div>
          <div class="ctl-field" title="自动下位只在池内试算择优（避免全目录遍历过慢）；池内限定音擎按本体精炼1参与，选中即计金。配置持久化在浏览器本地">
            <span class="ctl-label">下位装填池</span>
            <n-select
              v-model:value="autoEnginePool"
              :options="enginePoolOptions"
              size="small"
              multiple
              filterable
              style="width: 260px"
              placeholder="候选音擎"
            />
          </div>
        </template>
        <div class="ctl-field">
          <span class="ctl-label">当期 Buff</span>
          <n-select
            v-model:value="buffChoice"
            :options="buffOptions"
            size="small"
            style="width: 200px"
            placeholder="自动推荐"
          />
        </div>
        </template>
        <n-button type="primary" size="small" :loading="computing" @click="chartMode === 'scatter' ? runCompare() : runCurves()">
          {{ chartMode === 'scatter' ? '计算' : '计算曲线' }}
        </n-button>
        <n-button v-if="chartMode === 'curve' && computing" size="small" @click="curveAbort = true">中止</n-button>
      </div>

      <!-- 进度 -->
      <div v-if="computing && progress" class="progress-bar">
        <div class="progress-fill" :style="{ width: progress.pct * 100 + '%' }"></div>
        <span class="progress-text">{{ progress.text }}</span>
      </div>

      <div v-if="!computing && chartMode === 'scatter' && points.length > 0" class="compare-note">
        共 {{ points.length }} 个点 · 纵轴 = 伤害/血量%（100% 击杀线）· 横轴 = 操作难度（交互加权和 + 合轴溢出秒，权重可在「难度权重」调）· 点半径 = 限定金
      </div>

      <div v-if="!computing && chartMode === 'curve'" class="compare-note">
        已选 {{ selectedPresets.length }} 队 · 金档 {{ curveGold < 0 ? '预设基础档' : `${curveGold} 金` }}<template
          v-if="curveClampedCount > 0"
        >（{{ curveClampedCount }} 队越界已按各自档位钳制）</template>
        · x = 操作难度（Σ交互次数×权重 + 合轴溢出秒×权重 + <b>队友合轴节省秒</b>×权重，<b>自动算</b>；三项权重在「难度权重」弹层可调）
        · 每队要跑 ~10 次全量伤害（约 3~4 秒/队 ⇒ 预计 ≈{{ fmt(selectedPresets.length * 3.4 / 60, 1) }} 分钟）——
        曲线模式建议只选几支队做「难易强度」对比，跑起来可点「中止」保留已算部分。
      </div>

      <div v-if="teamPresets.length === 0" class="empty-hint">
        暂无预设队伍 —— 复制 <code>src/data/teamPresets/_template.json</code> 到同目录改名编辑（删掉
        <code>disabled</code> 字段），刷新后自动加载。加金顺序/交互清单说明见文件头注释。
      </div>
      <div v-else-if="bossPresets.length === 0" class="empty-hint">
        Boss 预设数据未加载（运行 <code>node scripts/import-nanoka-bosses.mjs</code> 生成
        <code>public/static/boss-presets.json</code>）。
      </div>
      <div v-else-if="!computing && points.length === 0" class="empty-hint guide-hint">
        已预选最新期数 / 全部队伍 / 限定金区间 —— 点「计算」生成散点图（默认不带当期 buff，可下拉开启）。
        限定金只统计限定 S 角色/音擎（常驻角色如莱卡恩不计）；选择越界自动钳制到队伍档位范围。
        「最优加金（≤12金）」默认开启：≤12金自动逐金挑选伤害提升最大的加金组合（含专武本体购买，贪婪搜索，较慢），12金以上仍按预设 goldSteps 顺序；
        「自动下位」默认开启：未穿限定音擎的槽位从「下位装填池」（默认常驻 S + 预设常用 A 级，可增删）按伤害择优穿戴，A 级默认精炼 5、常驻默认精炼 3 可调，预设 wEngines 仅限定音擎保留；
        限定专武作为加金步（goldSteps 里带 wEngineId 的步骤），如星徽·比利队基础 3 金（3 角色本体、无专武），4 金起在对比里逐步买专武，改完重跑一次对比即可。
      </div>
    </n-card>

    <!-- 散点图 -->
    <n-card v-if="chartMode === 'scatter' && points.length > 0" size="small" :bordered="true" class="chart-card">
      <div class="chart-area">
        <svg :viewBox="viewBox" class="compare-svg">
          <!-- 网格 + y 刻度（SVG 颜色统一 class + 主题变量，var() 在 presentation attribute 上不可靠） -->
          <line v-for="(y, i) in yTicks" :key="'g' + i" :x1="padL" :y1="y" :x2="padL + plotW" :y2="y" class="chart-grid" />
          <text v-for="(y, i) in yTicks" :key="'yt' + i" :x="padL - 6" :y="y + 4" text-anchor="end" class="chart-tick" font-size="10">{{ fmt(yLabel(i), 0) }}%</text>
          <line v-for="(x, i) in xTickPositions" :key="'xg' + i" :x1="x" :y1="padT" :x2="x" :y2="padT + plotH" class="chart-grid-x" />
          <text v-for="(x, i) in xTickPositions" :key="'xt' + i" :x="x" :y="padT + plotH + 16" text-anchor="middle" class="chart-tick" font-size="10">{{ fmt(xTickLabels[i], 1) }}</text>

          <!-- 击杀线 100% + 200% 参考线 -->
          <line :x1="padL" :y1="yOf(100)" :x2="padL + plotW" :y2="yOf(100)" stroke="#e88080" stroke-dasharray="6,4" opacity="0.8" />
          <text :x="padL + 4" :y="yOf(100) - 4" fill="#e88080" font-size="10">击杀线 100%</text>
          <line v-if="yMax > 200" :x1="padL" :y1="yOf(200)" :x2="padL + plotW" :y2="yOf(200)" class="chart-refline" stroke-dasharray="4,4" />
          <text v-if="yMax > 200" :x="padL + 4" :y="yOf(200) - 4" class="chart-refline-text" font-size="10">200% 两倍血量</text>

          <!-- 坐标轴标签 -->
          <text :x="padL + plotW / 2" :y="padT + plotH + 34" text-anchor="middle" class="chart-axis-label" font-size="11">操作难度（交互+合轴溢出）</text>
          <text :x="14" :y="padT + plotH / 2" text-anchor="middle" class="chart-axis-label" font-size="11" transform="rotate(-90 14 0)">伤害/血量 %</text>

          <!-- 散点 -->
          <g v-for="(pt, i) in chartPts" :key="i">
            <circle
              :cx="pt.cx" :cy="pt.cy" :r="pt.r" :fill="pt.color" opacity="0.75"
              class="scatter-dot" stroke-width="0.5"
              @mouseenter="hoverIdx = i" @mouseleave="hoverIdx = -1"
            />
          </g>

          <!-- hover tooltip -->
          <g v-if="hoverIdx >= 0 && chartPts[hoverIdx]">
            <circle :cx="chartPts[hoverIdx].cx" :cy="chartPts[hoverIdx].cy" r="5" class="chart-hover-dot" />
            <rect :x="ttX - 4" :y="ttY - 4" :width="ttW + 8" :height="ttH + 8" rx="3" class="chart-tooltip-box" />
            <text v-for="(line, li) in hoverTips" :key="'tt' + li" :x="ttX" :y="ttY + li * 13" class="chart-tooltip-text" font-size="10">{{ line }}</text>
          </g>
        </svg>

        <!-- 图例 -->
        <div class="chart-legend">
          <span v-for="p in legendPresets" :key="p.id" class="lchip" :style="{ borderColor: p.color }">
            <span class="ldot" :style="{ background: p.color }"></span>{{ p.name }}（{{ p.minGold }}~{{ p.maxGold }}金）
          </span>
        </div>
      </div>
    </n-card>

    <!-- 明细表 -->
    <n-card v-if="chartMode === 'scatter' && points.length > 0" size="small" :bordered="true" class="detail-card">
      <template #header>明细（{{ points.length }} 点）</template>
      <div class="detail-table-wrap">
        <table class="detail-table">
          <thead>
            <tr>
              <th>队伍</th><th>限定金</th><th>Buff</th><th>伤害</th><th>伤害/血量</th>
              <th>难度</th><th>交互明细</th><th>影画</th><th>精炼</th><th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in points" :key="i" :class="{ 'time-warn': p.timeExceeded }">
              <td class="td-team" :style="{ color: colorOf(p.presetId) }">{{ p.presetName }}</td>
              <td>
                {{ p.goldLabel }}
                <div v-if="p.standardGoldLabel" class="td-standard">{{ p.standardGoldLabel }}</div>
              </td>
              <td class="td-buff">{{ p.buffTitle || '—' }}</td>
              <td>{{ compact(p.damage) }}</td>
              <td :class="{ kill: p.hpRatio >= 100 }">{{ fmt(p.hpRatio, 1) }}%<template v-if="p.hpRatio > 100"><div class="kill-time">≈{{ killSeconds(p.hpRatio) }}s 击杀</div></template></td>
              <td>{{ fmt(p.difficulty, 1) }}</td>
              <td class="td-detail">{{ p.difficultyDetail }}</td>
              <td>{{ p.cinemas.join('/') }}</td>
              <td>{{ p.wengineMods.join('/') }}</td>
              <td :class="{ 'time-ok': !p.timeExceeded, 'time-exceeded': p.timeExceeded }">{{ p.timeDetail }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>

    <!-- 难度曲线：每队自己的贪心提升路径（x = 自动算的操作难度，各队不对齐是特性） -->
    <n-card v-if="chartMode === 'curve' && curveData" size="small" :bordered="true" class="chart-card">
      <template #header>难度曲线（{{ curveData.series.length }} 队 · 每队自己的 x）</template>
      <div class="compare-note curve-note">
        口径：<b>{{ curveGold < 0 ? '预设基础档（0命1精 + 预设权重/交互/音擎/驱动盘）' : `${curveGold} 金（走预设金步 + 常驻步，越界按各队档位钳制）` }}</b>
        + 当前期数 Boss + 静态权重（不跑自动分配）；<b>不含 buff、不含「最优加金 / 自动下位」</b>
        （曲线要的是跨队同口径的形状，故起点 ≠ 散点页的某个点）。
        x = 该队<b>自动算的</b>操作难度<b>绝对值</b>（Σ交互次数×权重 + 合轴溢出秒×权重；交互次数取这一档<b>实打</b>的次数，
        不是预设声明——联合策略调低弹刀、般岳补交互都会算进去）+ 队友合轴解放出来的前台秒数（合轴率把队友前台压出去多少，越多=对齐越难、总伤越高）；
        三项权重都在「难度权重」弹层调），<b>与散点页横轴同一把尺</b>。
        y = 伤害/血量%。<b>各队起点/走向不齐是特性</b>：比形状（起点 / 斜率 / 天花板 / 提升倍数）；
        <b>x 会往左走</b>——有的杠杆减少交互次数（难度降、伤害升 = 白拿的优化，贪心会优先做）。
        每档只录取有实际增益的目标，负收益目标被丢弃并在下表如实列出。每队约 3~4 秒。
      </div>
      <div class="chart-area">
        <svg :viewBox="viewBox" class="compare-svg">
          <line v-for="(v, i) in curveYTicks" :key="'cyg' + i" :x1="padL" :y1="curveYOf(v)" :x2="padL + plotW" :y2="curveYOf(v)" class="chart-grid" />
          <text v-for="(v, i) in curveYTicks" :key="'cyt' + i" :x="padL - 6" :y="curveYOf(v) + 4" text-anchor="end" class="chart-tick" font-size="10">{{ v }}%</text>
          <line v-for="(t, i) in curveXTicks" :key="'cxg' + i" :x1="t.x" :y1="padT" :x2="t.x" :y2="padT + plotH" class="chart-grid-x" />
          <text v-for="(t, i) in curveXTicks" :key="'cxt' + i" :x="t.x" :y="padT + plotH + 16" text-anchor="middle" class="chart-tick" font-size="10">{{ t.label }}</text>

          <line :x1="padL" :y1="curveYOf(100)" :x2="padL + plotW" :y2="curveYOf(100)" stroke="#e88080" stroke-dasharray="6,4" opacity="0.8" />
          <text :x="padL + 4" :y="curveYOf(100) - 4" fill="#e88080" font-size="10">击杀线 100%</text>

          <text :x="padL + plotW / 2" :y="padT + plotH + 34" text-anchor="middle" class="chart-axis-label" font-size="11">操作难度绝对值（交互加权 + 合轴溢出，与散点同尺）</text>
          <text :x="14" :y="padT + plotH / 2" text-anchor="middle" class="chart-axis-label" font-size="11" transform="rotate(-90 14 0)">伤害/血量 %</text>

          <g v-for="(s, si) in curveSeriesPx" :key="'cs' + si">
            <polyline
              v-if="s.pts.length > 1"
              :points="s.pts.map(p => `${p.cx},${p.cy}`).join(' ')"
              fill="none" :stroke="s.color" stroke-width="2" opacity="0.9"
            />
            <circle
              v-for="(p, pi) in s.pts" :key="'cp' + si + '-' + pi"
              :cx="p.cx" :cy="p.cy" :r="3.5" :fill="s.color" opacity="0.9"
              class="scatter-dot" stroke-width="0.5"
              @mouseenter="curveHover = { si, pi }" @mouseleave="curveHover = null"
            />
            <!-- 关键次数跃迁标注（「多了一次」量级）：加一圈 + 点上方文字 -->
            <g v-for="(j, ji) in s.jumpPts" :key="'cj' + si + '-' + ji">
              <circle :cx="j.cx" :cy="j.cy" r="6.5" fill="none" :stroke="s.color" stroke-width="1.2" opacity="0.85" />
              <text
                v-if="j.labeled" :x="j.cx" :y="j.cy - 11 - j.lane * 15"
                text-anchor="middle" class="curve-jump-label" font-size="9"
              >{{ j.text }}</text>
            </g>
          </g>

          <g v-if="curveHoverPt">
            <rect :x="curveTtX" :y="curveTtY" :width="curveTtW + 8" :height="curveTtH + 8" rx="3" class="chart-tooltip-box" />
            <text v-for="(line, li) in curveHoverTips" :key="'ctt' + li" :x="curveTtX + 4" :y="curveTtY + 13 + li * 13" class="chart-tooltip-text" font-size="10">{{ line }}</text>
          </g>
        </svg>

        <div class="chart-legend">
          <span v-for="s in curveData.series" :key="s.presetId" class="lchip" :style="{ borderColor: colorOf(s.presetId) }">
            <span class="ldot" :style="{ background: colorOf(s.presetId) }"></span>{{ s.name }}（{{ fmt(s.gainX, 2) }}× · +{{ fmt(s.gainPct, 1) }}%）
          </span>
        </div>
      </div>
    </n-card>

    <!-- 关键变化板块：难度爬升时「多了一次什么」（用户 2026-09-10 口径） -->
    <n-card v-if="chartMode === 'curve' && curveData" size="small" :bordered="true" class="detail-card">
      <template #header>关键变化（{{ curveJumpRows.length }} 处跃迁）</template>
      <div class="compare-note">
        只列<b>「多了一次」量级</b>的跃迁（Δ ≥ 1）：多放一次大招/强特/连携、多一次失衡/紊乱/乱流，
        以及角色专属次数（如克拉蕾·毁伤触发、希希芙·蛇影层数来源）。引擎次数常带小数（覆盖率折算、外层不动点），
        +0.1 这类微调不列——鼠标放到曲线点上，tooltip 里能看到该档的<b>全部</b>增量。
        括号里的「终结技系 Δ」是<b>同档同类伤害行一起变了多少，不是因果</b>（伤害同时受权重/易伤/覆盖率影响）；
        「伤害归因」列才是这一档总 Δ 的精确拆分（Σ 分组 ≡ 该档伤害）。
      </div>
      <div class="detail-table-wrap">
        <table class="detail-table">
          <thead>
            <tr><th>队伍</th><th>操作难度</th><th>本档新开</th><th>关键变化</th><th>伤害</th><th>伤害归因（本档 Δ）</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in curveJumpRows" :key="r.key">
              <td class="td-team" :style="{ color: r.color }">{{ r.team }}</td>
              <td>{{ fmt(r.cost, 0) }} 点</td>
              <td class="td-detail">{{ r.opened === null ? '全关起点' : goalLabel(r.opened) }}</td>
              <td class="td-detail"><div class="cell-clamp">{{ r.text }}</div></td>
              <td>
                {{ compact(r.dmg) }}
                <div class="td-standard">{{ signedDmg(r.attr.totalDelta) }}（{{ fmt(r.ratio, 1) }}%）</div>
              </td>
              <td class="td-detail">
                <div class="cell-clamp">
                  {{ r.attr.top.map(c => `${c.label} ${signedDmg(c.delta)}`).join('、') || '（无正贡献）' }}
                  <div v-if="r.attr.squeezed.length > 0" class="curve-neg">
                    挤掉：{{ r.attr.squeezed.map(c => `${c.label} ${signedDmg(c.delta)}`).join('、') }}
                  </div>
                  <div v-if="Math.abs(r.attr.restDelta) > 1" class="td-standard">其余 {{ signedDmg(r.attr.restDelta) }}</div>
                </div>
              </td>
            </tr>
            <tr v-if="curveJumpRows.length === 0">
              <td colspan="6" class="td-detail">
                本次曲线没有「多一次」量级的跃迁：要么该队已饱和，要么爬升只带来小数级微调
                （鼠标停在曲线点上可看每档明细）。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>

    <!-- 曲线摘要表：难易强度对比看这几列 -->
    <n-card v-if="chartMode === 'curve' && curveData" size="small" :bordered="true" class="detail-card">
      <template #header>曲线摘要（{{ curveData.series.length }} 队）</template>
      <div class="detail-table-wrap">
        <table class="detail-table">
          <thead>
            <tr>
              <th>队伍</th><th>金档</th><th>全关</th><th>终点</th><th>提升</th><th>倍数</th>
              <th>操作难度</th><th>收益/难度</th><th>录取顺序</th><th>丢弃目标</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in curveData.series" :key="s.presetId" :class="{ 'curve-flat': s.flat }">
              <td class="td-team" :style="{ color: colorOf(s.presetId) }">{{ s.name }}</td>
              <td>
                {{ s.gold.totalGold }} 金
                <span v-if="s.gold.totalGold !== s.gold.target" class="td-standard">（钳制）</span>
              </td>
              <td>{{ compact(s.base) }}</td>
              <td>{{ compact(s.final) }}</td>
              <td :class="{ kill: s.gainPct > 0 }">+{{ fmt(s.gainPct, 1) }}%</td>
              <td>{{ fmt(s.gainX, 2) }}×</td>
              <td>{{ fmt(s.totalCost, 0) }} 点</td>
              <td>{{ fmt(s.slope, 1) }}%/点</td>
              <td class="td-detail"><div class="cell-clamp">{{ s.flat ? '无优化空间（目标均无增益）' : s.opened.map(goalLabel).join(' → ') }}</div></td>
              <td class="td-detail"><div class="cell-clamp">{{ s.dropped.length === 0 ? '—' : s.dropped.map(d => `${goalLabel(d.id)}（${compact(d.gain)}）`).join('、') }}</div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NCard, NSelect, NInputNumber, NButton, NCheckbox, NPopover, NRadioGroup, NRadioButton } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeTeamComparePoints, DEFAULT_AUTO_ENGINE_POOL, isLimitedWEngine, INTERACTION_LABELS } from '@/composables/teamCompare'
import { assignLabelLanes, attributeDmgChanges, estimateLabelWidth, linkCountToDmg, computeDifficultyCurves, buildCurveChart, majorChanges, type DifficultyCurveRow, type KeyCountChange } from '@/composables/difficultyCurve'
import { DIFFICULTY_GOALS } from '@/composables/difficultyLadder'
import { teamPresets, presetGroupLabels, presetSubgroupLabelsFor, presetsForFilter, firstNonEmptyFilter } from '@/data/teamPresets'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, BossPresetFile, PhaseView } from '@/types/bossPreset'
import type { TeamComparePoint, TeamPreset } from '@/types/teamPreset'
import { INTERACTION_WEIGHTS } from '@/types/teamPreset'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const calc = useResourceCalc()

// ========== Boss 预设 ==========
const bossPresets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])
const selectedPeriodId = ref('')
const selectedBossId = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/static/boss-presets.json')
    if (res.ok) {
      const data = (await res.json()) as BossPresetFile
      bossPresets.value = data.bosses ?? []
      phaseViews.value = data.phaseViews ?? []
      // 默认选最新期数 + 该期第一个 Boss
      const first = allPeriods.value[0]
      if (first) selectedPeriodId.value = first.phaseId
    }
  } catch { /* boss 数据缺失时页面显示引导 */ }
  // 预选全部队伍（不自动计算：计算含 buff 遍历较慢，由用户点「计算」触发）
  selectedPresetIds.value = teamPresets.map(t => t.id)
})

/**
 * 期数优先选择（用户口径）：先选期数，再选该期的 Boss。
 * 期数 = 全部 Boss 期数的并集（新的在前），Boss 下拉只列选中期数里出现过的 Boss。
 */
const allPeriods = computed(() => {
  const map = new Map<string, { phaseId: string; label: string; begin: string; hasCA: boolean }>()
  for (const b of bossPresets.value) {
    for (const ph of b.phases) {
      const cur = map.get(ph.phaseId)
      if (cur) {
        if (ph.modeType === 'critical_assault') cur.hasCA = true
      } else {
        map.set(ph.phaseId, {
          phaseId: ph.phaseId,
          label: ph.label,
          begin: ph.begin,
          hasCA: ph.modeType === 'critical_assault',
        })
      }
    }
  }
  return [...map.values()].sort((a, b) => (b.begin || b.phaseId).localeCompare(a.begin || a.phaseId))
})
const periodOptions = computed(() =>
  allPeriods.value.map(p => ({ value: p.phaseId, label: `${p.label}${p.hasCA ? '（危局）' : ''}` })),
)

/** 选中期数里出现的 Boss（困难优先标注；同 Boss 多关卡去重） */
const bossOptionsForPeriod = computed(() => {
  if (!selectedPeriodId.value) return []
  const out: { value: string; label: string }[] = []
  const seen = new Set<string>()
  for (const b of bossPresets.value) {
    if (seen.has(b.id)) continue
    const phases = b.phases.filter(p => p.phaseId === selectedPeriodId.value)
    if (phases.length === 0) continue
    seen.add(b.id)
    const ph = phases.find(p => p.modeType === 'critical_assault') ?? phases[0]
    out.push({ value: b.id, label: `${b.name}${ph.modeType === 'critical_assault' ? '（困难）' : '（普通）'}` })
  }
  return out
})

watch(selectedPeriodId, () => {
  const opts = bossOptionsForPeriod.value
  if (!opts.some(o => o.value === selectedBossId.value)) {
    selectedBossId.value = opts[0]?.value ?? ''
  }
})

const selectedBoss = computed(() => bossPresets.value.find(b => b.id === selectedBossId.value) ?? null)
const selectedPhase = computed(() => {
  const b = selectedBoss.value
  if (!b) return null
  const phases = b.phases.filter(p => p.phaseId === selectedPeriodId.value)
  return phases.find(p => p.modeType === 'critical_assault') ?? phases[0] ?? b.phases[0] ?? null
})

// 敌方体型跟随 boss（BOSS_BODY_SIZES 手录，2026-09-05）：选中 boss 自动写入敌方配置，
// 艾莲霜锋剑气/苍角风团等体型相关招式经 cfg.bodySize 消费；未录入体型的 boss 默认中型
// （用户口径 2026-09-05），手动改过则在下次切换 boss 前保持。
watch(selectedBoss, (boss) => {
  if (!boss) return
  const size = boss.bodySize ?? 'medium'
  if (configStore.enemy.bodySize !== size) {
    configStore.setEnemy({ bodySize: size })
  }
})

// ========== 当期 Buff ==========
/** 当前期视图（含 buff 牌） */
const currentPhaseView = computed(() => phaseViews.value.find(v => v.phaseId === selectedPeriodId.value) ?? null)
/** buff 选择：'none' = 不使用（默认，不遍历算得快）/ '' = 自动推荐（每队取三张牌伤害最高）/ 牌名 = 手动 */
const buffChoice = ref<string>('none')
const buffOptions = computed(() => [
  { value: 'none', label: '不使用（默认，快）' },
  { value: '', label: '自动推荐（每队取最优，慢 3 倍）' },
  ...(currentPhaseView.value?.buffs ?? []).map(b => ({
    value: b.title,
    label: `${b.title || '(未命名)'}${b.testOnly ? '（测试服）' : ''}`,
    disabled: b.testOnly,
  })),
])
watch([currentPhaseView], () => {
  // 期数切换后若手动选的 buff 不在当期，回到不使用
  const cur = buffChoice.value
  if (cur && cur !== 'none' && !(currentPhaseView.value?.buffs ?? []).some(b => b.title === cur)) buffChoice.value = 'none'
})

// ========== 预设队伍 ==========
const selectedPresetIds = ref<string[]>([])
/** 两级下拉：一级分类（如 命破队）→ 二级队伍 */
// 三级筛选（2026-09-03 用户：一级下拉装 99+ 条太多——先选职业、再选属性、后出队伍）
// 默认选中第一个职业+属性（用户 2026-09-03：打开即有队伍可选——此前全空像「没下拉框」）
const firstFilter = firstNonEmptyFilter()
const presetGroupSel = ref<string | null>(firstFilter.group)
const presetSubSel = ref<string | null>(firstFilter.subgroup)
const presetGroupOptionsC = presetGroupLabels.map(l => ({ label: l, value: l }))
const presetSubOptions = computed(() =>
  (presetGroupSel.value ? presetSubgroupLabelsFor(presetGroupSel.value) : []).map(l => ({ label: l, value: l })),
)
const presetFilteredOptions = computed(() =>
  presetGroupSel.value && presetSubSel.value
    ? presetsForFilter(presetGroupSel.value, presetSubSel.value).map(t => ({ value: t.id, label: t.name }))
    : [],
)
watch([presetGroupSel, presetSubSel], () => {
  // 换筛选即清空已选（避免选中的队伍不在当前筛选内）
  if (presetGroupSel.value && presetSubSel.value) selectedPresetIds.value = []
})
const selectedPresets = computed<TeamPreset[]>(() =>
  teamPresets.filter(t => selectedPresetIds.value.includes(t.id)),
)
/** 按主C快选：选一个主C → 勾选替换为「仅含该主C的队伍」（其他主C的队伍移除）；清空不影响已选 */
const quickPickMainC = ref<string | null>(null)
const mainCQuickOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const t of teamPresets) {
    const main = t.team[0]
    if (!seen.has(main)) seen.set(main, catalogStore.getAgent(main)?.name.zhCN ?? main)
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }))
})
watch(quickPickMainC, main => {
  if (!main) return
  selectedPresetIds.value = teamPresets.filter(t => t.team[0] === main).map(t => t.id)
})

// ========== 金数 ==========
const goldMin = ref(0)
const goldMax = ref(6)
/** 最优加金（≤12金）：不用预设排列顺序，逐金挑提升最大的组合；12金以上回退预设顺序 */
const optimalGold = ref(true)
/** 自动下位音擎（缺省开）：非限定槽位从装填池按伤害择优穿戴；选中限定音擎按本体如实计金 */
const autoEngine = ref(true)
/** 自动下位默认精炼档：A 级 / 常驻 S */
const autoModA = ref(5)
const autoModStd = ref(3)
// 装填池：玩家可增删，localStorage 持久化；种子 = 用户准信五件（击破：人为刀俎/燃狱齿轮，辅助：阿炮/逍遥游球/啜泣摇篮）
const AUTO_ENGINE_POOL_KEY = 'zzz-compare-auto-engine-pool'
function loadAutoEnginePool(): string[] {
  try {
    const raw = localStorage.getItem(AUTO_ENGINE_POOL_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const valid = [...new Set(arr.filter((id: unknown) => typeof id === 'string' && catalogStore.getWEngine(id as string)))] as string[]
        if (valid.length > 0) return valid
      }
    }
  } catch { /* 损坏回落默认 */ }
  return [...DEFAULT_AUTO_ENGINE_POOL]
}
const autoEnginePool = ref<string[]>(loadAutoEnginePool())
watch(autoEnginePool, v => {
  try { localStorage.setItem(AUTO_ENGINE_POOL_KEY, JSON.stringify(v)) } catch { /* 忽略 */ }
}, { deep: true })

// ========== 难度权重（主观量，用户自填；INTERACTION_WEIGHTS 与 1秒=1点只是默认值） ==========
const DIFF_WEIGHTS_KEY = 'zzz-compare-difficulty-weights'
interface DiffWeightsState { overflow: number; align: number; interaction: Record<string, number> }
const DEFAULT_DIFF_WEIGHTS: DiffWeightsState = {
  overflow: 1,
  align: 1,   // 队友合轴解放出来的前台时间：默认 1 秒 = 1 难度点（与溢出同档）
  interaction: { ...INTERACTION_WEIGHTS },
}
function loadDiffWeights(): DiffWeightsState {
  const base: DiffWeightsState = { overflow: 1, align: 1, interaction: { ...INTERACTION_WEIGHTS } }
  try {
    const raw = localStorage.getItem(DIFF_WEIGHTS_KEY)
    if (raw) {
      const obj = JSON.parse(raw)
      if (typeof obj?.overflow === 'number' && Number.isFinite(obj.overflow) && obj.overflow >= 0) base.overflow = obj.overflow
      if (typeof obj?.align === 'number' && Number.isFinite(obj.align) && obj.align >= 0) base.align = obj.align
      if (obj?.interaction && typeof obj.interaction === 'object') {
        for (const [k, v] of Object.entries(obj.interaction)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) base.interaction[k] = v
        }
      }
    }
  } catch { /* 损坏回落默认 */ }
  return base
}
const diffWeights = ref<DiffWeightsState>(loadDiffWeights())
watch(diffWeights, v => {
  try { localStorage.setItem(DIFF_WEIGHTS_KEY, JSON.stringify(v)) } catch { /* 忽略 */ }
}, { deep: true })
const diffWeightRows = computed(() =>
  Object.keys(INTERACTION_WEIGHTS).map(t => ({ type: t, label: INTERACTION_LABELS[t] ?? t })))
function resetDiffWeights() {
  diffWeights.value = { overflow: DEFAULT_DIFF_WEIGHTS.overflow, align: DEFAULT_DIFF_WEIGHTS.align, interaction: { ...INTERACTION_WEIGHTS } }
}
const enginePoolOptions = computed(() =>
  (catalogStore.displayWEngines ?? [])
    .map(w => ({
      value: w.id,
      label: `${w.name.zhCN ?? w.name.en ?? w.id}（${w.rarity}${isLimitedWEngine(w.id) ? '·限定' : ''}）`,
    })),
)

// ========== 计算 ==========
const computing = ref(false)
const progress = ref<{ pct: number; text: string } | null>(null)
const points = ref<TeamComparePoint[]>([])
/** 图型：散点（各队各金档一个点）/ 难度曲线（每队自己的贪心提升路径） */
const chartMode = ref<'scatter' | 'curve'>('scatter')
/** 曲线结果（原始阶梯，画图与摘要都从它派生） */
const curveRows = ref<DifficultyCurveRow[]>([])
/** 曲线模式的中止标志（粒度 = 一队：单队阶梯是原子的；已算部分保留） */
const curveAbort = ref(false)
/**
 * 曲线金档：-1 = 预设基础档（缺省口径）。选具体金数时走 `teamCompare#applyGoldSteps`
 * （= 散点页同源，含 standardSteps 常驻全量应用、越界按该队档位钳制），
 * **不含**散点页的「最优加金 / 自动下位」两层。
 */
const curveGold = ref<number>(-1)
const curveGoldOptions = computed(() => [
  { value: -1, label: '预设基础档' },
  ...Array.from({ length: 13 }, (_, g) => ({ value: g, label: `${g} 金` })),
])
/** 选了金档但越界（该队档位范围更窄）被钳制的队数——如实上报，不静默 */
const curveClampedCount = computed(() => curveRows.value.filter(r => r.gold.totalGold !== r.gold.target).length)

function goldLevels(): number[] {
  const levels: number[] = []
  const min = Math.max(0, Math.min(goldMin.value, goldMax.value))
  const max = Math.max(0, Math.max(goldMin.value, goldMax.value))
  for (let g = min; g <= max; g++) levels.push(g)
  return levels
}

async function runCompare() {
  const presets = selectedPresets.value
  const boss = selectedBoss.value
  const phase = selectedPhase.value
  if (presets.length === 0 || !boss || !phase) return
  computing.value = true
  progress.value = { pct: 0, text: '' }
  const all: TeamComparePoint[] = []
  const levels = goldLevels()
  const buffs = currentPhaseView.value?.buffs ?? []
  // 按队伍分批，让出主线程更新进度
  for (let i = 0; i < presets.length; i++) {
    const p = presets[i]
    progress.value = { pct: i / presets.length, text: `计算 ${p.name}（${i + 1}/${presets.length}）...` }
    await new Promise(r => setTimeout(r, 0))
    all.push(...computeTeamComparePoints(calc, {
      presets: [p],
      goldLevels: levels,
      boss,
      optimalGold: optimalGold.value,      phase,
      autoEngine: autoEngine.value,
      autoEngineMods: { aRank: autoModA.value, standard: autoModStd.value },
      autoEnginePool: autoEnginePool.value,
      buffs: buffChoice.value === 'none' ? [] : buffs,
      manualBuffTitle: buffChoice.value === '' || buffChoice.value === 'none' ? undefined : buffChoice.value,
      difficultyWeights: { overflow: diffWeights.value.overflow, align: diffWeights.value.align, interaction: diffWeights.value.interaction },
    }))
  }
  points.value = all
  progress.value = { pct: 1, text: `完成：${all.length} 个点` }
  computing.value = false
}

/**
 * 难度曲线：逐队爬自己的贪心阶梯（每队要跑 ~10 次全量伤害，约 3~4 秒）。
 * 口径与散点的差异见 `composables/difficultyCurve.ts` 文件头（不含 buff/加金/自动下位）。
 */
async function runCurves() {
  const presets = selectedPresets.value
  const boss = selectedBoss.value
  const phase = selectedPhase.value
  if (presets.length === 0 || !boss || !phase) return
  computing.value = true
  curveAbort.value = false
  progress.value = { pct: 0, text: '' }
  const all: DifficultyCurveRow[] = []
  for (let i = 0; i < presets.length; i++) {
    // 中止粒度 = 一队（单队阶梯是原子的）；已算部分照样出图
    if (curveAbort.value) break
    const p = presets[i]
    progress.value = { pct: i / presets.length, text: `爬阶梯 ${p.name}（${i + 1}/${presets.length}，每队约 3~4 秒）...` }
    await new Promise(r => setTimeout(r, 0))
    all.push(...computeDifficultyCurves(calc, {
      presets: [p],
      boss,
      phase,
      goldLevel: curveGold.value >= 0 ? curveGold.value : undefined,
      difficultyWeights: { overflow: diffWeights.value.overflow, align: diffWeights.value.align, interaction: diffWeights.value.interaction },
    }))
  }
  curveRows.value = all
  progress.value = { pct: 1, text: curveAbort.value ? `已中止：保留已算的 ${all.length} 条曲线` : `完成：${all.length} 条曲线` }
  curveAbort.value = false
  computing.value = false
}

// ========== 图表 ==========
const svgW = computed(() => Math.max(420, Math.min(1100, typeof window !== 'undefined' ? window.innerWidth - 120 : 960)))
const padL = 46, padR = 16, padT = 24, padB = 44
const plotW = computed(() => svgW.value - padL - padR)
const plotH = 340
const viewBox = computed(() => `0 0 ${svgW.value} ${padT + plotH + padB}`)

const yMax = computed(() => {
  const maxRatio = Math.max(...points.value.map(p => p.hpRatio), 0)
  return Math.max(100, Math.ceil(Math.max(maxRatio, 150) / 50) * 50)
})
const xMax = computed(() => {
  const maxD = Math.max(...points.value.map(p => p.difficulty), 1)
  return Math.max(10, Math.ceil(maxD / 5) * 5)
})
function yOf(v: number): number {
  return padT + plotH - (v / yMax.value) * plotH
}
function xOf(v: number): number {
  return padL + (v / xMax.value) * plotW.value
}

const yTicks = computed(() => {
  const ticks: number[] = []
  const step = yMax.value <= 100 ? 20 : yMax.value <= 200 ? 50 : 100
  for (let v = 0; v <= yMax.value; v += step) ticks.push(yOf(v))
  return ticks
})
function yLabel(i: number): number {
  const step = yMax.value <= 100 ? 20 : yMax.value <= 200 ? 50 : 100
  return i * step
}

const xTicks = 5
const xTickPositions = computed(() => {
  const out: number[] = []
  for (let i = 0; i <= xTicks; i++) out.push(xOf((xMax.value / xTicks) * i))
  return out
})
const xTickLabels = computed(() => {
  const out: number[] = []
  for (let i = 0; i <= xTicks; i++) out.push((xMax.value / xTicks) * i)
  return out
})

const PALETTE = ['#63e2b7', '#63b3ed', '#f6ad55', '#f687b3', '#b794f4', '#f6e05e', '#4fd1c5', '#fc8181']
const presetColors = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  teamPresets.forEach((t, i) => { map[t.id] = PALETTE[i % PALETTE.length] })
  return map
})
function colorOf(presetId: string): string {
  return presetColors.value[presetId] ?? '#888'
}

const chartPts = computed(() =>
  points.value.map(p => ({
    ...p,
    cx: xOf(p.difficulty),
    cy: yOf(Math.min(p.hpRatio, yMax.value)),
    r: 3 + Math.min(p.goldCount, 36) * 0.5,
    color: colorOf(p.presetId),
  })),
)

const legendPresets = computed(() => {
  const ids = [...new Set(points.value.map(p => p.presetId))]
  return ids.map(id => {
    const ps = points.value.filter(p => p.presetId === id)
    const t = teamPresets.find(x => x.id === id)
    return {
      id,
      name: t?.name ?? id,
      color: colorOf(id),
      minGold: Math.min(...ps.map(p => p.goldCount)),
      maxGold: Math.max(...ps.map(p => p.goldCount)),
    }
  })
})

// ========== 难度曲线图表（x = 自动算的操作难度，y = 伤害/血量%） ==========
const curveData = computed(() =>
  curveRows.value.length > 0 ? buildCurveChart(curveRows.value, selectedPhase.value?.hp ?? 1) : null,
)
function curveXOf(v: number): number {
  return padL + (v / Math.max(1, curveData.value?.costMax ?? 1)) * plotW.value
}
function curveYOf(v: number): number {
  return padT + plotH - (v / Math.max(1, curveData.value?.ratioMax ?? 100)) * plotH
}
const curveYTicks = computed(() => {
  const max = curveData.value?.ratioMax ?? 100
  const step = max <= 100 ? 20 : max <= 200 ? 50 : 100
  const out: number[] = []
  for (let v = 0; v <= max; v += step) out.push(v)
  return out
})
const curveXTicks = computed(() => (curveData.value?.costTicks ?? [0]).map(c => ({ x: curveXOf(c), label: c })))
/** 次数显示：整数直接写，小数保留 1 位（引擎次数常带小数，见 difficultyCurve.ts） */
function cntNum(v: number): string {
  return Number.isInteger(v) ? String(v) : fmt(v, 1)
}
/** 图上标注用短文案：`大招+1` */
function cntDelta(c: KeyCountChange): string {
  return `${c.label}+${cntNum(c.delta)}`
}
/** 面板/tooltip 用完整文案：`大招 7→8` */
function cntRange(c: KeyCountChange): string {
  return `${c.label} ${cntNum(c.from)}→${cntNum(c.to)}`
}
/**
 * 关键变化文案（同档同类来源对照）：`大招 7→8（终结技系 Δ +78.00万）`。
 * **不是因果声明**——只是这一档里同类伤害行一起变了多少（见 linkCountToDmg 头注释）。
 */
function cntRangeWithDmg(c: KeyCountChange, dmgChanges: { label: string; delta: number }[]): string {
  const link = linkCountToDmg(c.label, dmgChanges)
  return `${cntRange(c)}${link ? `（${link.label} Δ ${signedDmg(link.delta)}）` : ''}`
}

/** 伤害增量带符号：`+683.00万` / `−12.00万` */
function signedDmg(v: number): string {
  return `${v >= 0 ? '+' : '−'}${compact(Math.abs(v))}`
}
const curveSeriesPx = computed(() => {
  const series = (curveData.value?.series ?? []).map(s => ({
    ...s,
    color: colorOf(s.presetId),
    pts: s.points.map(p => ({ ...p, cx: curveXOf(p.cost), cy: curveYOf(p.ratio) })),
    jumpPts: s.jumps.map(j => ({
      ...j,
      cx: curveXOf(j.cost),
      cy: curveYOf(j.ratio),
      // 图上只显示前 2 项（长标签会互压；完整清单在「关键变化」面板与 tooltip 里）
      text: j.changes.map(cntDelta).slice(0, 2).join('·') + (j.changes.length > 2 ? '…' : ''),
    })),
  }))
  // 图上标注只保留**每队伤害增量最大的前 2 处**（G5 合轴率杠杆会让跃迁涨到 17 处，
  // 全标必叠；完整清单在「关键变化」面板与 tooltip 里），再跨队统一分道错开抬升。
  const seriesTop = series.map(s => {
    const keep = new Set(
      [...s.jumpPts]
        .sort((a, b) => (b.dmg - (s.base ?? 0)) - (a.dmg - (s.base ?? 0)))
        .slice(0, 2),
    )
    return s.jumpPts.filter(j => keep.has(j))
  })
  const all = seriesTop.flat()
  const lanes = assignLabelLanes(all.map(j => ({ x: j.cx, width: estimateLabelWidth(j.text) })), 6)
  let k = 0
  return series.map((s, si) => ({
    ...s,
    jumpPts: s.jumpPts.map(j => {
      const idx = seriesTop[si]!.indexOf(j)
      return { ...j, lane: idx < 0 ? 0 : (lanes[k++] ?? 0), labeled: idx >= 0 }
    }),
  }))
})
/** 关键变化面板的行（跨队铺平；数据源 = 各队已过滤过 major 的 `jumps`） */
const curveJumpRows = computed(() =>
  curveSeriesPx.value.flatMap((s, si) =>
    s.jumpPts.map((j, ji) => ({
      key: `${s.presetId}-${si}-${ji}`,
      team: s.name,
      color: s.color,
      cost: j.cost,
      dmg: j.dmg,
      ratio: j.ratio,
      opened: j.opened,
      text: j.changes.map(c => cntRangeWithDmg(c, j.dmgChanges)).join('、'),
      attr: attributeDmgChanges(j.dmgChanges),
    })),
  ),
)
/** 目标 id → 可读标签（tooltip 与摘要表共用）；null = 全关起点 */
function goalLabel(id: string | null): string {
  if (id === null) return '全关起点'
  return DIFFICULTY_GOALS.find(g => g.id === id)?.label ?? id
}
const curveHover = ref<{ si: number; pi: number } | null>(null)
const curveHoverPt = computed(() => {
  const h = curveHover.value
  if (!h) return null
  const s = curveSeriesPx.value[h.si]
  const point = s?.pts[h.pi]
  return s && point ? { series: s, point } : null
})
const curveTtW = 260
const curveTtH = 97
const curveTtX = computed(() =>
  curveHoverPt.value ? Math.min(curveHoverPt.value.point.cx + 10, svgW.value - curveTtW - 20) : 0,
)
const curveTtY = computed(() =>
  curveHoverPt.value ? Math.max(0, Math.min(curveHoverPt.value.point.cy - 20, padT + plotH - curveTtH - 10)) : 0,
)
const curveHoverTips = computed(() => {
  const p = curveHoverPt.value
  if (!p) return []
  const { series: s, point } = p
  const band = point.opened === null ? '全关起点（静态权重、无保底、投影 off）' : `本档新开：${goalLabel(point.opened)}`
  const major = majorChanges(point.changes)
  const minor = point.changes.length - major.length
  const attr = point.dmgChanges.length > 0 ? attributeDmgChanges(point.dmgChanges, 3, 1) : null
  return [
    s.name,
    `操作难度 ${fmt(point.cost, 0)} 点 · 伤害 ${compact(point.dmg)}（${fmt(point.ratio, 1)}%）`,
    attr
      ? `本档 Δ ${signedDmg(attr.totalDelta)} ← ${attr.top.map(c => `${c.label} ${signedDmg(c.delta)}`).join('、') || '（无正贡献）'}${attr.squeezed.length > 0 ? `｜挤掉 ${attr.squeezed.map(c => `${c.label} ${signedDmg(c.delta)}`).join('、')}` : ''}`
      : '本档无伤害变化（全关起点）',
    band,
    major.length > 0
      ? `跃迁：${major.map(c => cntRangeWithDmg(c, point.dmgChanges)).join('、')}${minor > 0 ? `（另有 ${minor} 项小数级微调）` : ''}`
      : (minor > 0 ? `仅小数级微调 ${point.changes.map(cntRange).join('、')}` : '本档无次数变化'),
    s.flat ? '四目标均无增益 ⇒ 无优化空间' : `累计录取 ${s.opened.map(goalLabel).join(' → ')}`,
  ]
})

// hover tooltip
const hoverIdx = ref(-1)
const hoverPt = computed(() => (hoverIdx.value >= 0 ? chartPts.value[hoverIdx.value] : null))
const ttX = computed(() => hoverPt.value ? Math.min(hoverPt.value.cx + 10, svgW.value - ttW - 20) : 0)
const ttY = computed(() => hoverPt.value ? Math.max(0, Math.min(hoverPt.value.cy - 20, padT + plotH - ttH - 10)) : 0)
const ttW = 200
const ttH = 110
const hoverTips = computed(() => {
  const p = hoverPt.value
  if (!p) return []
  return [
    `${p.presetName} · ${p.goldLabel}${p.standardGoldLabel ? ' · ' + p.standardGoldLabel : ''}`,
    `伤害 ${compact(p.damage)}（${fmt(p.hpRatio, 1)}%）${p.buffTitle ? ' · ' + p.buffTitle : ''}${p.hpRatio > 100 ? ` · ≈${killSeconds(p.hpRatio)}s 击杀` : ''}`,
    `难度 ${fmt(p.difficulty, 1)} · ${p.difficultyDetail}`,
    `影画 ${p.cinemas.join('/')} · 精炼 ${p.wengineMods.join('/')}`,
    p.timeExceeded ? `⚠ ${p.timeDetail}` : `✓ ${p.timeDetail}`,
  ]
})

/** 击杀时间（秒）：伤害/血量 > 100% 时 = 战斗时长 × 100/hpRatio（2 倍伤害 → 90s，按 180s 基准） */
function killSeconds(hpRatio: number): number {
  if (hpRatio <= 100) return 0
  const battle = configStore.enemy.battleTime ?? 180
  return Math.round(battle * 100 / hpRatio)
}

</script>

<style scoped>
.team-compare-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.compare-controls {
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

.ctl-sep {
  margin: 0 4px;
  color: var(--wa-400);
}

.progress-bar {
  margin-top: 10px;
  height: 4px;
  background: var(--wa-80);
  border-radius: 2px;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: #63e2b7;
  border-radius: 2px;
  transition: width 0.15s;
}

.progress-text {
  position: absolute;
  top: 8px;
  right: 0;
  font-size: 11px;
  color: var(--wa-500);
}

.compare-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--wa-500);
}

.diff-weight-pop {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.diff-weight-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.diff-weight-label {
  font-size: 12px;
  color: var(--fg-2);
}

.buff-note {
  color: rgba(230, 180, 100, 0.8);
}

.empty-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--wa-600);
  line-height: 1.7;
}

.empty-hint code {
  background: var(--wa-80);
  padding: 1px 5px;
  border-radius: 3px;
}

.chart-card,
.detail-card {
  margin-top: 0;
}

.compare-svg {
  width: 100%;
  height: auto;
  background: var(--wa-15);
  border-radius: 4px;
}

/* SVG 网格/刻度/提示框颜色走主题变量 */
.chart-grid { stroke: var(--wa-60); }
.chart-grid-x { stroke: var(--wa-50); }
.chart-tick { fill: var(--wa-350); }
.chart-refline { stroke: var(--wa-250); }
.chart-refline-text { fill: var(--wa-450); }
.chart-axis-label { fill: var(--wa-500); }
.scatter-dot { stroke: var(--wa-350); }
.chart-hover-dot { fill: var(--app-text-solid); }
.chart-tooltip-box { fill: var(--app-tooltip-bg); stroke: var(--wa-150); }
.chart-tooltip-text { fill: var(--app-tooltip-text); }

/* 长文本列（关键变化 / 伤害归因 / 录取顺序）：auto 布局下 td 的 max-content 会撑破容器，
   实测溢出 191~200px ⇒ 单元格内套一个**限宽 block** 才能可靠换行 */
.cell-clamp {
  max-width: 300px;
  white-space: normal;
  line-height: 1.5;
}

.td-wrap {
  white-space: normal;
  min-width: 150px;
  line-height: 1.5;
}

/* 伤害归因里的「被挤掉」行（负贡献）：用语义 danger 令牌，别加字面色值（令牌棘轮） */
.curve-neg {
  color: var(--c-danger);
  font-size: 11px;
}

/* 关键次数跃迁的图上标注（比刻度亮一档，压过网格线；currentColor 免引 --wa-* 棘轮） */
.curve-jump-label {
  fill: currentColor;
  font-weight: 600;
}

.chart-legend {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.lchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--wa-750);
  border: 1px solid;
  border-radius: 10px;
  padding: 1px 8px;
}

.ldot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.detail-table-wrap {
  overflow-x: auto;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.detail-table th,
.detail-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--wa-60);
  text-align: right;
  white-space: nowrap;
}

.detail-table th {
  color: var(--wa-500);
  font-weight: 600;
}

.detail-table td:first-child,
.detail-table th:first-child {
  text-align: left;
}

.td-team {
  font-weight: 600;
}

.td-detail {
  color: var(--wa-550);
  font-size: 11px;
}

.td-standard {
  color: rgba(230, 180, 100, 0.85);
  font-size: 11px;
}

.kill {
  color: #63e2b7;
  font-weight: 700;
}
.kill-time {
  color: inherit;
  font-weight: 400;
  font-size: 11px;
  opacity: 0.85;
  line-height: 1.3;
}

.time-ok {
  color: var(--wa-400);
  font-size: 11px;
}

.time-exceeded {
  color: #e88080;
  font-weight: 600;
  font-size: 11px;
}

.time-warn {
  background: rgba(255, 80, 80, 0.06);
}

/* 难度曲线口径说明（长文案，行高放宽） */
.curve-note {
  margin: 0 0 8px;
  line-height: 1.7;
}

/* 平台队（四目标均无增益）：弱化整行，提示"没有可优化的空间" */
.curve-flat {
  opacity: 0.6;
}
</style>
