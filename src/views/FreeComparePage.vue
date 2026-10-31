<template>
  <div class="free-compare-page">
    <n-card size="small" :bordered="true">
      <template #header>
        <div class="card-header">
          <span>分析工作台</span>
          <span class="muted">
            预设 = 一组输入参数 · 一次求值 = 一份结果 · 视角 = 表格/折线/切片/3D/差值 · 其余（Boss/队友/锁定角色/配装）都是场景
          </span>
        </div>
      </template>

      <!-- ===== 分析模板（预设） ===== -->
      <div class="ctl-block">
        <div class="ctl-block-title">
          分析模板
          <span class="ctl-hint">预设只存输入（系列/轴/切片/指标/场景）；同一份结果再切视角，避免重复求值</span>
        </div>
        <div class="ctl-row">
          <div class="ctl-field">
            <span class="ctl-label">模板</span>
            <n-select
              v-model:value="presetId"
              :options="presetOptions"
              size="small"
              style="width: 280px"
              @update:value="applyPresetById"
            />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">存为</span>
            <n-input v-model:value="presetName" size="small" style="width: 160px" placeholder="预设名" />
            <n-button size="small" @click="saveCurrentPreset">保存当前</n-button>
            <n-button size="small" quaternary :disabled="!isUserPreset(presetId)" @click="deleteCurrentPreset">删除</n-button>
          </div>
          <span class="ctl-hint">{{ presetHint }}</span>
        </div>
      </div>

      <!-- ===== 系列（被比的东西）===== -->
      <div class="ctl-block">
        <div class="ctl-block-title">
          系列（被比的东西）
          <span class="ctl-hint">配置码 = 两位数字：<b>左 = 影画 0-6，右 = 专武精炼 1-5</b>（21 = 2命+精1，01 = 0命+本体，<b>右位 0 = 无专武</b>）</span>
        </div>
        <div v-for="(s, i) in series" :key="s.key" class="series-row">
          <template v-if="s.kind === 'agent'">
            <n-select
              v-model:value="s.agentId"
              :options="agentOptions"
              size="small"
              filterable
              style="width: 190px"
              placeholder="选角色"
            />
            <span class="code-label">配置码</span>
            <n-input
              v-model:value="s.code"
              size="small"
              style="width: 74px"
              placeholder="21"
              :disabled="axisId === 'setupCode'"
              :status="parseSetupCode(s.code) ? undefined : 'error'"
              :title="axisId === 'setupCode' ? 'x = 配置码时，本列的配置码被 x 档位覆盖（用下面的「配置码序列」控制）；这一格只在其它 x 维度下生效' : '该角色自己的配置码（单人系列只作用于本人，队友走各自的配置码/01 基线）'"
            />
            <span class="code-read">{{ axisId === 'setupCode' ? '被 x 档位覆盖' : codeReadable(s.code) }}</span>
            <n-button size="small" quaternary :disabled="series.length <= 1" @click="removeSeries(i)">移除</n-button>
          </template>
          <template v-else>
            <span class="series-team">{{ s.members.map(m => agentName(m)).join(' + ') }}</span>
            <span class="code-label">只变</span>
            <n-select
              v-model:value="s.variedSlot"
              :options="s.members.map((m, si) => ({ value: si, label: agentName(m) }))"
              size="small"
              style="width: 130px"
            />
            <span class="code-label">基线码</span>
            <n-input
              v-model:value="s.code"
              size="small"
              style="width: 74px"
              placeholder="01"
              :status="parseSetupCode(s.code) ? undefined : 'error'"
              :title="'整队系列的基线码：只变的那一槽随 x 档位，另两槽固定用这个码（01 = 0命1精）'"
            />
            <span class="code-read">{{ codeReadable(s.code) }}</span>
            <n-button size="small" quaternary @click="removeSeries(i)">移除</n-button>
          </template>
        </div>
        <div class="series-actions">
          <n-button size="small" dashed @click="addSeries">+ 加一个系列</n-button>
        </div>
        <div class="ctl-row marginal-row">
          <span class="ctl-label">三人命座边际</span>
          <n-select v-model:value="marginalA" :options="agentOptions" size="small" filterable style="width: 150px" placeholder="队员1" />
          <n-select v-model:value="marginalB" :options="agentOptions" size="small" filterable style="width: 150px" placeholder="队员2" />
          <n-select v-model:value="marginalC" :options="agentOptions" size="small" filterable style="width: 150px" placeholder="队员3" />
          <n-button size="small" :disabled="!canBuildMarginal" @click="buildMarginalLines">生成三条线</n-button>
          <span class="ctl-hint">同一支队，三条线各只变一人的影画（另两人固定 01）；会替换当前系列</span>
        </div>
      </div>

      <!-- ===== x / y ===== -->
      <div class="ctl-block">
        <div class="ctl-block-title">轴与指标</div>
        <div class="ctl-row">
          <div class="ctl-field">
            <span class="ctl-label">x 轴维度</span>
            <n-select v-model:value="axisId" :options="axisOptions" size="small" style="width: 150px" />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">y 轴指标</span>
            <n-select v-model:value="metricId" :options="metricOpts" size="small" style="width: 170px" />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">切片维度（第二变量）</span>
            <n-select v-model:value="sliceKey" :options="sliceOpts" size="small" style="width: 220px" />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">影画上限</span>
            <n-input-number
              v-model:value="cinemaMax"
              :min="0"
              :max="6"
              size="small"
              style="width: 84px"
              :disabled="!cinemaMaxLive"
              :title="cinemaMaxLive ? 'x = 影画 时枚举到几命；充当「切片 = 某角色影画」时也用它当上限' : '当前 x 维度与切片都不用这个上限（只在「x = 影画」或「切片 = 某角色影画」时生效）'"
            />
            <span v-if="!cinemaMaxLive" class="ctl-hint">当前不用</span>
          </div>
          <div v-if="axisId === 'setupCode'" class="ctl-field">
            <span class="ctl-label">配置码序列</span>
            <n-input
              v-model:value="setupCodesText"
              size="small"
              style="width: 190px"
              placeholder="01,11,21,20"
            />
          </div>
          <div class="ctl-field ctl-hint">
            <span class="ctl-label">{{ axisHint }}</span>
          </div>
          <div class="ctl-field ctl-hint">
            <span class="ctl-label">{{ sliceHint }}</span>
          </div>
        </div>
      </div>

      <!-- ===== 条件（约束）===== -->
      <div class="ctl-block">
        <div class="ctl-block-title">
          条件（约束 · 改它不动系列与 x）
          <span class="ctl-hint">例：「维琳娜 0命/1命/2命」就是条件——维琳娜是被锁的场景，柏妮思 vs 菲欧妮才是被比的系列</span>
        </div>
        <div class="ctl-row">
          <div class="ctl-field">
            <span class="ctl-label">Boss</span>
            <n-select
              v-model:value="bossId"
              :options="bossOptions"
              size="small"
              filterable
              clearable
              style="width: 200px"
              placeholder="（沿用当前页面 Boss）"
            />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">当期 Buff</span>
            <n-select
              v-model:value="buffChoice"
              :options="buffOptions"
              size="small"
              style="width: 300px"
              :disabled="!bossId"
            />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">队友（单人系列用）</span>
            <n-select v-model:value="mateA" :options="agentOptions" size="small" filterable clearable style="width: 150px" placeholder="队友1" />
            <n-input
              v-model:value="mateACode"
              size="small"
              style="width: 62px"
              placeholder="配置码"
              :status="mateACode.trim() && !parseSetupCode(mateACode) ? 'error' : undefined"
              :title="'队友1 的配置码：左=影画 0-6，右=精炼 1-5（20 = 2命无专武）。留空 = 跟随系列配置码'"
            />
            <n-select v-model:value="mateB" :options="agentOptions" size="small" filterable clearable style="width: 150px" placeholder="队友2" />
            <n-input
              v-model:value="mateBCode"
              size="small"
              style="width: 62px"
              placeholder="配置码"
              :status="mateBCode.trim() && !parseSetupCode(mateBCode) ? 'error' : undefined"
              :title="'队友2 的配置码：左=影画 0-6，右=精炼 1-5（20 = 2命无专武）。留空 = 跟随系列配置码'"
            />
            <span class="ctl-hint">{{ mateCodeHint }}</span>
          </div>
          <div class="ctl-field">
            <n-checkbox v-model:checked="autoBuild" size="small">推荐配装（慢很多，数值更接近实战）</n-checkbox>
          </div>
          <div class="ctl-field">
            <n-checkbox v-model:checked="stunLock" size="small">锁失衡次数（命座口径）</n-checkbox>
            <span class="ctl-hint">首档自由收敛值逐档钉死（与资源利用率页同口径）；不开 = 含失衡通道</span>
          </div>
        </div>
        <div class="ctl-row">
          <div class="ctl-field">
            <span class="ctl-label">锁定条件</span>
            <n-select v-model:value="condAgentId" :options="agentOptions" size="small" filterable clearable style="width: 150px" placeholder="条件角色（如维琳娜）" />
            <n-input-number v-model:value="condCinema" :min="0" :max="6" size="small" style="width: 84px" />
            <n-button size="small" :disabled="!condAgentId" @click="addCondition">锁定</n-button>
          </div>
          <div class="ctl-field">
            <n-tag v-for="(c, i) in conditions" :key="c.agentId" size="small" closable @close="conditions.splice(i, 1)">
              {{ agentName(c.agentId) }} {{ c.cinema }}命
            </n-tag>
          </div>
        </div>
      </div>

      <!-- ===== 从其他页导入（只读结果，不重新求值） ===== -->
      <div class="ctl-row import-row">
        <span class="ctl-label">导入</span>
        <n-select
          v-model:value="importId"
          :options="transferOptions"
          size="small"
          clearable
          style="width: 280px"
          placeholder="先在队伍对比/时间图表/血量膨胀跑一次"
        />
        <n-button size="small" :disabled="!importId || computing" @click="applyImport">导入</n-button>
        <span class="muted">
          {{ transferOptions.length ? '应用内导入，不重新求值；CSV 只是可选导出' : '暂无跨页结果' }}
        </span>
      </div>

      <!-- ===== 跑 ===== -->
      <div class="ctl-row run-row">
        <n-button type="primary" size="small" :loading="computing" @click="runCompare">对比</n-button>
        <n-button v-if="computing" size="small" quaternary @click="abort">取消</n-button>
        <span class="cost-hint">{{ costHint }}</span>
      </div>
      <div v-if="computing || progress" class="progress-row">
        <n-progress type="line" :percentage="Math.round((progress?.pct ?? 0) * 100)" :show-indicator="false" :height="6" />
        <span class="progress-text">{{ progress?.text ?? '' }}</span>
      </div>
      <n-alert v-if="error" type="error" title="操作失败" style="margin-top: 8px">{{ error }}</n-alert>
    </n-card>

    <!-- ===== 图 ===== -->
    <n-card v-if="result && result.series.length > 0" size="small" :bordered="true">
      <template #header>
        <div class="card-header">
          <span>
            {{ result.metricLabel }} · x = {{ result.axisLabel }}
            <template v-if="result.sliceLabel"> · 切片 = {{ result.sliceLabel }}</template>
          </span>
          <span class="muted">
            <template v-if="imported">导入结果 · 未重新求值</template>
            <template v-else>
              {{ result.evaluations }} 次求值<template v-if="result.pickEvaluations > 0"> + {{ result.pickEvaluations }} 次下位择优</template>
              <template v-if="hasSlices"> · {{ result.slices.length }} 片</template>
              · 耗时 {{ (result.durationMs / 1000).toFixed(1) }}s
              <template v-if="result.skipped > 0"> · {{ result.skipped }} 档无读数</template>
            </template>
          </span>
        </div>
      </template>

      <ChartLegend
        :items="legendItems"
        :color-of="colorOf"
        :is-visible="legend.isVisible"
        :hint="legendHint"
        show-all
        @toggle="legend.toggle"
        @show-all="legend.showAll"
      />

      <div v-if="imported" class="fc-note fc-import">
        <span class="fc-note-label">导入：</span>
        <span>{{ imported.source }} · {{ imported.label }}（只读，未重新求值）</span>
      </div>

      <!-- 环境声明（用户裁决 2026-10-02：环境条件是数据质量关键，不能掐头去尾 ⇒ 每张图自带完整口径） -->
      <div class="fc-note fc-env">
        <span class="fc-note-label">环境：</span>
        <span>{{ result.environmentSummary }}</span>
      </div>
      <div v-if="stunLockNote" class="fc-note">
        <span class="fc-note-label">失衡：</span>
        <span>{{ stunLockNote }}</span>
      </div>

      <div class="fc-toolbar">
        <div class="fc-view-switch">
          <button
            v-for="v in viewDefs"
            :key="v.id"
            class="fc-view-btn"
            :class="{ active: viewMode === v.id }"
            :aria-pressed="viewMode === v.id"
            :title="v.hint"
            @click="viewMode = v.id"
          >{{ v.label }}</button>
        </div>
        <div v-if="result.slices.length > 1" class="ctl-field">
          <span class="ctl-label">当前片</span>
          <n-select v-model:value="selectedSliceId" :options="sliceSelectOptions" size="small" style="width: 150px" />
        </div>
        <div v-if="viewMode === 'delta'" class="ctl-field">
          <span class="ctl-label">基准</span>
          <n-select v-model:value="baselineEntityId" :options="baselineOptions" size="small" style="width: 210px" />
        </div>
        <div v-if="result.levels.length > 2" class="ctl-field">
          <n-checkbox v-model:checked="showStepGain" size="small">标注逐档提升</n-checkbox>
          <n-checkbox v-if="showStepGain" v-model:checked="stepLabelAll" size="small">三线都标</n-checkbox>
        </div>
        <button
          class="fc-view-btn fc-export"
          title="导出完整长表（x × 切片 × 系列；不受图例筛选）"
          @click="exportDatasetCsv"
        >导出 CSV（可选）</button>
        <span class="legend-hint">{{ viewHint }}</span>
        <span v-if="viewMode === 'long'" class="legend-hint">共 {{ longRows.length }} 行（表内滚动）</span>
      </div>

      <div class="fc-view">
        <FreeCompareTable
          v-if="viewMode === 'table' && selectedSlice"
          :levels="result.levels"
          :series="visibleSeries"
          :def="resultDef"
          :show-step-gain="showStepGain"
        />
        <ChartTable
          v-else-if="viewMode === 'long'"
          :columns="longColumns"
          :empty="longRows.length ? '' : '暂无数据'"
          max-height="440px"
        >
          <tr v-for="(r, i) in longRows" :key="i">
            <td>{{ r.xLabel }}</td>
            <td>{{ r.sliceLabel || '全部' }}</td>
            <td>
              <span class="fc-long-dot" :style="{ background: colorOf(r.seriesId) }"></span>{{ r.seriesLabel }}
            </td>
            <td>{{ formatLongValue(r.value) }}</td>
          </tr>
        </ChartTable>
        <div v-else-if="viewMode === 'line'" class="fc-plot-wrap">
          <svg :viewBox="`0 0 ${svgW} ${svgH}`" class="fc-svg">
            <g v-for="(y, i) in yGrid" :key="'g' + i">
              <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
              <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ yLabel(i) }}</text>
            </g>
            <g v-for="(lv, i) in result.levels" :key="'x' + i">
              <text :x="levelX(i)" :y="svgH - 8" class="axis-label x-label" text-anchor="middle">{{ lv.label }}</text>
            </g>
            <polyline
              v-for="s in visibleLines" :key="s.id" :points="s.points" class="fc-line"
              :style="{ stroke: colorOf(s.id) }"
              :stroke-dasharray="s.buffTitle ? '6 4' : undefined"
            />
            <template v-for="s in visibleLines" :key="'p' + s.id">
              <circle
                v-for="(p, i) in s.pts"
                :key="i"
                :cx="p.x" :cy="p.y" r="4"
                :fill="colorOf(s.id)"
                class="trend-point"
              >
                <title>{{ s.label }} · {{ result.levels[i]?.label }}：{{ p.text }}</title>
              </circle>
            </template>
            <text
              v-for="lab in stepLabels"
              :key="lab.key"
              :x="lab.x"
              :y="lab.y"
              text-anchor="middle"
              class="fc-step-label"
              :style="{ fill: lab.color }"
            >{{ lab.text }}</text>
          </svg>
        </div>
        <SliceGridChart
          v-else-if="viewMode === 'grid'"
          :levels="result.levels"
          :panels="slicePanels"
          :color-of="colorOf"
          :format="formatValue"
          :selected-id="selectedSliceId"
          @select="selectedSliceId = $event"
        />
        <FreeCompare3DChart
          v-else-if="viewMode === '3d'"
          :levels="result.levels"
          :slices="result.slices"
          :series="series3d"
          :color-of="colorOf"
          :format="formatValue"
          :x-label="result.axisLabel"
          :slice-label="result.sliceLabel ?? ''"
          :z-label="result.metricLabel"
          :selected-slice-id="selectedSliceId"
          @select-slice="selectedSliceId = $event"
        />
        <FreeCompareLevelDelta
          v-else-if="viewMode === 'step' && selectedSlice"
          :result="result"
          :series="visibleSeries"
          :def="resultDef"
          :color-of="colorOf"
        />
        <SliceGridChart
          v-else-if="viewMode === 'delta'"
          :levels="result.levels"
          :panels="deltaPanels"
          :color-of="colorOf"
          :format="formatDeltaPercent"
          :selected-id="selectedSliceId"
          @select="selectedSliceId = $event"
        />
      </div>

      <!-- 图下数据块（2026-10-27 用户：一个 x 只显示一个提升幅度看不全）——美术单源 = StepGainMatrix -->
      <StepGainMatrix
        v-if="viewMode === 'line' && stepMatrix.rows.length > 0"
        :columns="stepMatrix.levels"
        :rows="stepMatrix.rows"
        :hint="stepMatrixHint"
      />

      <!-- 无专武档实际穿的下位件：按伤害择优挑的（实测同职业三把 A 级差 3~8pp），不显示就没法核对 -->
      <div v-if="downgradeNotes.length > 0" class="fc-note">
        <span class="fc-note-label">无专武档实际穿的下位（按伤害择优）：</span>
        <span v-for="n in downgradeNotes" :key="n" class="fc-note-item">{{ n }}</span>
      </div>
    </n-card>

    <div v-else class="empty-hint">
      选好系列（谁跟谁比）与 x/y，点「对比」。
      模板栏可一键套用「角色配置对比 / 命座曲线 / 专武精炼 / Boss 期数 / 配置×命座切片 / 维琳娜命座切片」；
      「维琳娜几命」这类场景放进<b>条件</b>里锁定。
      结果出来后用<b>表格 / 折线 / 切片 / 3D / 差值</b>换视角——同一份结果，不重复求值。
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 自由对比工作台（2026-09-15）
 *
 * 用户原话（2026-09-14 深夜，逐字）：
 *   「做一个自由选择元素的对比，比如我要比较维琳娜0命1命2命的情况下，柏妮思21对比菲欧尼21，
 *     11对比11，20对比11，01对比01的伤害曲线」
 *   「这就是个自由的对比图表，可以比单人也能比全队，各项数据也能比」「x轴可以自选」
 *   「维琳娜这个是条件」「总之我的要求不明确，就是强大的自由对比功能」
 *
 * 因此本页是**通用工作台**（系列 × x × y × 条件），不是第 N 张专用图。
 * 判据：① 改任一维不动其余；② 加指标/加 x 维度 = 往注册表加一行（`metrics.ts` / `axes.ts`），
 * 本文件不感知具体有哪些指标 —— 下拉是 `METRICS` 直接渲染的。
 *
 * **第二变量（2026-10-17）**：切片维度 = 轴切片（复用 `AXES`）或条件角色影画切片；
 * 与 x 轴抢同一档位字段的组合由 `axes.ts#sliceConflicts` 拒绝（否则一条轴静默失效 = 假维度）。
 * 呈现：多重二维切片（`SliceGridChart`，**纵轴共用一把尺**）+ 3D 折线阵（`FreeCompare3DChart`，
 * 复用 `difficultyCurve3d#project3d` 投影；只读 props、不碰 store）。
 *
 * **工作台化（2026-10-17 第二轮；用户：输入/输出/显示/预设都是重复内容）**：
 * - 输入 = 内置模板 + 用户预设（`freeCompare/presets.ts` / `data/analysisPresets.ts`），预设只存参数；
 * - 求值 = 仍然只调一次 `computeFreeCompare`（不因换视角重算）；
 * - 输出 = 同一份 `FreeCompareResult` 的投影（`freeCompare/views.ts`：表格/折线/切片/3D/差值）；
 * - 联动 = 图例显隐与「当前片」跨视角共用；点切片面板/3D 折线同步切换当前片。
 * 判据：加一种视角 = 往 `ANALYSIS_VIEWS` + 一个 `v-else-if`；加一个模板 = 往 `data/analysisPresets` 加一条。
 *
 * 复用（规则 12，逐个真查过再引用）：
 * - `seriesFilter.ts#useSeriesFilter`：图例点选显隐（隐藏必须同时退出派生量 —— 纵轴按可见线缩放）
 * - `versionChartGeometry#scYRangeOf / scYStepOf / scYOf / scYGridOf / scGridStartOf`：纵轴几何直接复用（CC-427；
 *   此前本页手抄了一份，理由写的是「x 维度动态」——但纵轴几何只吃 y 值与 PlotBox，与 x 无关）
 * - `agentPresentation.ts#colorOf`：系列配色（与全仓图表同一套）
 * - `composables/analysisScenario.ts#withAnalysisScenario`：求值跑在独立场景上（r372，求值器内部已封装，本页不碰）
 */
import { computed, onMounted, ref, watch } from 'vue'
import { FREE_COMPARE_AGENTS } from '@/data/viewAgentDefaults'
import { NAlert, NButton, NCard, NCheckbox, NInput, NInputNumber, NProgress, NSelect, NTag } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import SliceGridChart from '@/components/charts/SliceGridChart.vue'
import FreeCompare3DChart from '@/components/charts/FreeCompare3DChart.vue'
import ChartLegend from '@/components/charts/ChartLegend.vue'
import FreeCompareTable from '@/components/FreeCompareTable.vue'
import FreeCompareLevelDelta from '@/components/FreeCompareLevelDelta.vue'
import StepGainMatrix from '@/components/charts/StepGainMatrix.vue'
import { BUILTIN_ANALYSIS_PRESETS } from '@/data/analysisPresets'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { useBatchOwner } from '@/composables/batchTask'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { colorOf } from '@/composables/charts/agentPresentation'
import ChartTable from '@/components/charts/ChartTable.vue'
import { datasetCsv, datasetFromFreeCompare, resultFromDataset } from '@/composables/analysis/dataset'
import { transferredAnalyses, type TransferredAnalysis } from '@/composables/analysis/transfer'
import { computeFreeCompare } from '@/composables/freeCompare/engine'
import {
  AXIS_BY_ID,
  DEFAULT_AXIS_ID,
  EMPTY_SERIES_SPEC,
  type AxisId,
  type AxisOptions,
  type SeriesSpec,
  type SliceSpec,
  axisOptions as buildAxisOptions,
  parseSliceKey,
  sliceKeyOf,
  sliceConflicts,
  sliceLevelsOf,
  sliceOptions,
  sliceTitleOf,
} from '@/composables/freeCompare/axes'
import { formatSetupCode, parseSetupCode, setupCodeLabel, type SetupCode } from '@/utils/setupCode'
import { METRICS, formatMetric, metricDef, metricOptions, type MetricDef } from '@/composables/freeCompare/metrics'
import {
  deleteUserPreset,
  isUserPreset,
  loadUserPresets,
  newUserPresetId,
  saveUserPreset,
  type WorkbenchPreset,
} from '@/composables/freeCompare/presets'
import {
  ANALYSIS_VIEWS,
  availableViews,
  baselineOptionsOf,
  bestStepIndexByLevel,
  defaultBaselineId,
  deltaPanelsOf,
  fallbackView,
  formatDeltaPercent,
  formatSignedDeltaPercent,
  selectedSliceOf,
  seriesItemsOf,
  stepGainsOf,
  type AnalysisView,
} from '@/composables/freeCompare/views'
import { scGridStartOf, scYGridOf, scYOf, scYRangeOf, scYStepOf } from '@/composables/versionChartGeometry'
import { layoutStepLabels } from '@/composables/charts/stepLabelLayout'
import type { BossPreset, PhaseView } from '@/types/bossPreset'

import { localized } from '@/utils/format'
const catalog = useCatalogStore()

// ---------- 数据 ----------
const bossPresets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])
const error = ref('')

/**
 * 用户原话里的实体，id 见 data/viewAgentDefaults（CC-431）。
 * `burnice` / `phoenix` 只在内置模板（data/analysisPresets.ts）里出现，本页不再直接引用
 * （2026-10-26：默认系列改成单角色 01 后，页面不再预填这两位）。
 */
const VELINA = FREE_COMPARE_AGENTS.velina

interface SeriesRow {
  key: number
  /**
   * 单人 = 本人 + 一对全局基底队友（字段 `agentId`）；
   * 整队 = `members` 三人同队形（2026-10-27 用户：「三条线共图，看前期/后期给谁加金」）——
   * `variedSlot` 只让那一槽跟随 x 档位，另两槽固定用 `code`。
   */
  kind: 'agent' | 'team'
  agentId: string
  members: string[]
  variedSlot: number
  code: string
}

/**
 * 队友配置码（2026-10-25，用户：「队友是固定65丽娜61克拉蕾」）。
 *
 * 为什么不塞进「锁定条件」：条件 = **场景约束**（用户原话「维琳娜 0/1/2 命是条件，柏妮思 vs 菲欧妮才是系列」），
 * 而队友的命座/精炼是**这套配置的一部分**——同一条曲线里队友一直是 65/61，它就是环境常数，
 * 写在「队友」旁边才读得懂。引擎侧两者都落成 `slotCodes`（条件优先级更高）。
 *
 * 留空 = 跟随系列配置码（`code` 会套到全部三槽，见 `engine.ts` 装配段）。
 */
const mateACode = ref('')
const mateBCode = ref('')
/** 队友码提示：非法时直接标出来（跑批前 `runCompare` 也会拦） */
const mateCodeHint = computed(() => {
  const bad = [mateACode.value, mateBCode.value].filter(t => t.trim() && !parseSetupCode(t))
  return bad.length > 0 ? '队友配置码非法：要两位数字（左=影画 0-6，右=精炼 0-5）' : ''
})
let keySeq = 0
/**
 * 初始系列 = **一个**空角色 + 01 基线。
 *
 * 旧值是「柏妮思 21 + 菲欧妮 21」+ x = 配置码序列 01/11/21/20 ⇒ 用户看到的是
 * 「先是两个 21，然后让我比 01/11/21」——那两个 21 是**系列码**，在 x = 配置码下被档位覆盖、
 * 一个数都不影响（用户 2026-10-26 报障：「固定一个角色21，然后让我比较01，11，21，那一开始的21有啥用」）。
 * 现在默认单系列 + 01：这格只在「x = 影画/精炼」时才是"对比的基准"，其余情况下它要么被 x 覆盖
 * （已置灰并写明原因），要么就是这台角色的固定配置。
 */
const series = ref<SeriesRow[]>([{
  key: keySeq++, kind: 'agent', agentId: '', members: ['', '', ''], variedSlot: 0, code: '01',
}])
function addSeries() {
  series.value.push({ key: keySeq++, kind: 'agent', agentId: '', members: ['', '', ''], variedSlot: 0, code: '01' })
}

/**
 * 「三人命座边际」快捷构建（2026-10-27 用户）：
 * 同一支队三条线，每条只变一人的影画（另两人固定 01），看每档给谁加金最赚。
 * 三人只在**这里**选（整队系列行只显示成员 + 可改「只变谁」），避免 3 行 × 3 个下拉的重复输入。
 */
const marginalA = ref('')
const marginalB = ref('')
const marginalC = ref('')
const canBuildMarginal = computed(() => {
  const m = [marginalA.value, marginalB.value, marginalC.value]
  return m.every(Boolean) && new Set(m).size === 3
})
function buildMarginalLines() {
  if (!canBuildMarginal.value) {
    error.value = '三人命座边际：三名队员都要选，且不能重复'
    return
  }
  const members = [marginalA.value, marginalB.value, marginalC.value]
  series.value = [0, 1, 2].map(variedSlot => ({
    key: keySeq++, kind: 'team' as const, agentId: '', members: [...members], variedSlot, code: '01',
  }))
  // 一次配好「看命座边际」的轴/指标（其余条件（Boss/buff/配装）保持用户当前设置）
  axisId.value = 'cinema'
  metricId.value = 'teamTotalDamage'
  cinemaMax.value = 6
  viewMode.value = 'line'
  showStepGain.value = true
  stunLock.value = true
  presetId.value = ''
  result.value = null
  imported.value = null
  selectedSliceId.value = ''
  baselineEntityId.value = ''
  error.value = ''
}
function removeSeries(i: number) {
  series.value.splice(i, 1)
}

const axisId = ref<AxisId>(DEFAULT_AXIS_ID)
const metricId = ref('teamTotalDamage')
const cinemaMax = ref(6)
/**
 * 「影画上限」是否有消费者（2026-10-26）：只喂 `AXES.cinema.levels` 与条件切片的档数。
 * 其它 x 维度 / 无切片时它是个**完全无作用的旋钮**——旧版照样可编辑，用户改完发现数字没变
 * （报障「有些功能感觉是失效的」）。现在直接置灰 + 写「当前不用」。
 */
const cinemaMaxLive = computed(() =>
  axisId.value === 'cinema' || (sliceSpec.value?.kind === 'condition'))
/** 配置码维度的档位序列（用户原话「21/11/20/01」）—— 逗号分隔，非法码在跑批前被拦下 */
const setupCodesText = ref('01,11,21,20')
const autoBuild = ref(false)
/** 切片维度（第二变量）：'' = 单张 2D 图；取值编码见 axes.ts 的 sliceKeyOf/parseSliceKey */
const sliceKey = ref('')
/** 规格 ↔ 下拉值：读取解码，失效时经 setter 编码回 ''（编码只有一份，避免两处手写 `axis:${id}`） */
const sliceSpec = computed<SliceSpec | null>({
  get: () => parseSliceKey(sliceKey.value),
  set: spec => { sliceKey.value = sliceKeyOf(spec) },
})
/** 当前视角：同一份结果的不同投影（切换不重算） */
const viewMode = ref<AnalysisView>('line')
/** 图上标注「逐档提升%」（默认三条线全标；关掉 = 只标每档最优） */
const showStepGain = ref(true)
/** 图上三条线都标（2026-10-27 用户：一个 x 只显示一个提升幅度看不全）；关掉 = 只标每档最优 */
const stepLabelAll = ref(true)
/** 锁失衡次数（命座口径，2026-10-27）：命座边际模板默认开；普通对比默认关（保持既有数字） */
const stunLock = ref(false)
/** 当前片（表格/折线/3D 选中态共用；空 = 结果到达后取第一片） */
const selectedSliceId = ref('')
/** 差值视角的基准系列 */
const baselineEntityId = ref('')

// ---------- 预设（参数模板；结果另算） ----------
const presetId = ref('')
const presetName = ref('')
const userPresets = ref<WorkbenchPreset[]>([])
/** 从其他页导入的分析结果（只读；导入不重新求值） */
const importId = ref('')
const imported = ref<TransferredAnalysis | null>(null)
const transferOptions = computed(() => transferredAnalyses.value.map(x => ({
  value: x.id,
  label: x.source + ' · ' + x.label,
})))
const allPresets = computed<WorkbenchPreset[]>(() => [...BUILTIN_ANALYSIS_PRESETS, ...userPresets.value])
const presetOptions = computed(() => [
  { value: '', label: '（自定义 / 不套模板）' },
  ...BUILTIN_ANALYSIS_PRESETS.map(p => ({ value: p.id, label: '内置 · ' + p.name })),
  ...userPresets.value.map(p => ({ value: p.id, label: '我的 · ' + p.name })),
])
const currentPreset = computed(() => allPresets.value.find(p => p.id === presetId.value) ?? null)
const presetHint = computed(() => {
  const p = currentPreset.value
  if (!p) return '模板只改输入参数；结果要重新点「对比」'
  return (p.note ? p.note + ' · ' : '') + '模板只改输入参数；结果要重新点「对比」'
})

const bossId = ref('')
// ---------- 当期 Buff（用户裁决 2026-10-02：可以带也可以不带；全状态 = 本体 vs 吃拐并排）----------
/**
 * buff 三态：'none' = 不使用 / 'all' = 全状态对比（每系列拆 本体+每张牌 多条线）/ 牌名 = 手动指定一张。
 * 与队伍对比页同口径，但把「自动推荐」换成「全状态对比」——推荐只给赢家，全状态给归因
 * （用户裁决：「自带的结论不智能，不如直接呈现原数据，人类自会分析归因」）。
 */
const buffChoice = ref<string>('none')
/** 当前 Boss 所选期的 buff 牌（期视图按 phaseId 对齐；未选 Boss = 空） */
const currentBuffs = computed(() => {
  const boss = bossPresets.value.find(b => b.id === bossId.value)
  if (!boss) return []
  const phaseId = boss.phases[0]?.phaseId
  return phaseViews.value.find(v => v.phaseId === phaseId)?.buffs ?? []
})
const buffOptions = computed(() => [
  { value: 'none', label: '不使用（默认，快）' },
  { value: 'all', label: `全状态对比（本体 + 每张牌各一条线，慢 ${currentBuffs.value.filter(b => !b.testOnly).length + 1} 倍）` },
  ...currentBuffs.value.map(b => ({
    value: `card:${b.title}`,
    label: `${b.title || '(未命名)'}${b.testOnly ? '（测试服）' : ''}`,
    disabled: b.testOnly,
  })),
])
watch(currentBuffs, () => {
  // 换 Boss 后若手动选的牌不在当期，回到不使用（防「嘴上 A 期牌、身上 B 期」的静默错配）
  const cur = buffChoice.value
  if (cur.startsWith('card:') && !currentBuffs.value.some(b => `card:${b.title}` === cur)) buffChoice.value = 'none'
})
const mateA = ref<string>(VELINA) // 默认把维琳娜当基底队友（对上用户原话的场景）
const mateB = ref('')
const condAgentId = ref('')
const condCinema = ref(0)
const conditions = ref<Array<{ agentId: string; cinema: number }>>([])
function addCondition() {
  if (!condAgentId.value) return
  const i = conditions.value.findIndex(c => c.agentId === condAgentId.value)
  if (i >= 0) conditions.value[i] = { agentId: condAgentId.value, cinema: condCinema.value }
  else conditions.value.push({ agentId: condAgentId.value, cinema: condCinema.value })
  condAgentId.value = ''
}

const agentOptions = computed(() =>
  catalog.displayAgents.map(a => ({ value: a.id, label: `${localized(a.name, a.id)}（${a.rarity}）` })))
const bossOptions = computed(() => bossPresets.value.map(b => ({ value: b.id, label: b.name })))
/** period 维度的档位：所选 Boss 的各期危局，按时间从旧到新（数据里是新→旧） */
const periodOptions = computed(() => [...(bossPresets.value.find(b => b.id === bossId.value)?.phases ?? [])]
  .reverse()
  .map(p => ({ id: p.phaseId, label: p.label })))
const metricOpts = metricOptions()
const axisOptions = buildAxisOptions()
const axisHint = computed(() => AXIS_BY_ID.get(axisId.value)?.hint ?? '')
/** 切片下拉：不与 x 轴抢同一字段；已锁定的条件角色可单独切片（Boss 期数需先选 Boss） */
const sliceOpts = computed(() => sliceOptions(axisId.value, conditions.value, agentName, periodOptions.value.length > 0))
watch([axisId, () => conditions.value.map(c => c.agentId).join(','), () => periodOptions.value.length], () => {
  if (!sliceKey.value) return
  const opt = sliceOpts.value.find(o => o.value === sliceKey.value)
  if (!opt || opt.disabled) sliceSpec.value = null
})

function agentName(id: string): string {
  return catalog.agentName(id)
}
function codeReadable(code: string): string {
  const c = parseSetupCode(code)
  return c ? setupCodeLabel(c) : '（两位数字）'
}

/** 套用模板：只改输入，并清掉旧结果（参数变了还挂着旧图 = 静默错读） */
function applyPresetById(id: string) {
  presetId.value = id
  if (!id) return
  const p = allPresets.value.find(x => x.id === id)
  if (!p) return
  series.value = p.series.map(s => s.members && s.members.length > 0
    ? { key: keySeq++, kind: 'team' as const, agentId: '', members: [...s.members], variedSlot: s.variedSlot ?? 0, code: s.code }
    : { key: keySeq++, kind: 'agent' as const, agentId: s.agentId ?? '', members: ['', '', ''], variedSlot: 0, code: s.code })
  // 整队系列把三人回填到快捷构建区，改完点「生成三条线」即可重出
  const teamRow = series.value.find(s => s.kind === 'team')
  if (teamRow) {
    marginalA.value = teamRow.members[0] ?? ''
    marginalB.value = teamRow.members[1] ?? ''
    marginalC.value = teamRow.members[2] ?? ''
  }
  stunLock.value = p.stunLock
  axisId.value = p.axisId
  sliceKey.value = p.sliceKey
  metricId.value = p.metricId
  cinemaMax.value = p.cinemaMax
  setupCodesText.value = p.setupCodesText
  if (p.bossId) bossId.value = p.bossId
  buffChoice.value = p.buffChoice
  mateA.value = p.mateA
  mateACode.value = p.mateACode
  mateBCode.value = p.mateBCode
  mateB.value = p.mateB
  autoBuild.value = p.autoBuild
  conditions.value = p.conditions.map(c => ({ ...c }))
  viewMode.value = p.view ?? 'line'
  result.value = null
  imported.value = null
  selectedSliceId.value = ''
  baselineEntityId.value = ''
  error.value = ''
}

/** 导入其他页的结果：转成同一 FreeCompareResult 形状，复用现有视角（不求值） */
function applyImport(): void {
  const item = transferredAnalyses.value.find(x => x.id === importId.value)
  if (!item) return
  // readonly 清单里的对象不能直接赋给可变 ref；复制一层（行数可能多，但只在手动导入时发生）
  imported.value = {
    id: item.id,
    source: item.source,
    label: item.label,
    createdAt: item.createdAt,
    dataset: {
      rows: item.dataset.rows.map(r => ({ ...r })),
      xLabel: item.dataset.xLabel,
      sliceLabel: item.dataset.sliceLabel,
      measure: { ...item.dataset.measure },
    },
  }
  presetId.value = ''
  result.value = resultFromDataset(imported.value.dataset)
  error.value = ''
}

function saveCurrentPreset() {
  const name = presetName.value.trim()
  if (!name) { error.value = '先给预设起个名字'; return }
  const rows = series.value.filter(s => s.kind === 'team' ? s.members.every(Boolean) : !!s.agentId)
  if (rows.length === 0) { error.value = '至少选一个系列再保存预设'; return }
  if (rows.some(s => !parseSetupCode(s.code))) { error.value = '配置码不合法，先修正再保存预设'; return }
  if (rows.some(s => s.kind === 'team' && new Set(s.members).size !== s.members.length)) {
    error.value = '整队系列的队员不能重复'; return
  }
  const preset: WorkbenchPreset = {
    id: newUserPresetId(),
    name,
    series: rows.map(s => s.kind === 'team'
      ? { members: [...s.members], variedSlot: s.variedSlot, code: s.code }
      : { agentId: s.agentId, code: s.code }),
    axisId: axisId.value,
    sliceKey: sliceKey.value,
    metricId: metricId.value,
    cinemaMax: cinemaMax.value,
    setupCodesText: setupCodesText.value,
    bossId: bossId.value,
    buffChoice: buffChoice.value,
    mateA: mateA.value,
    mateACode: mateACode.value,
    mateBCode: mateBCode.value,
    mateB: mateB.value,
    autoBuild: autoBuild.value,
    stunLock: stunLock.value,
    conditions: conditions.value.map(c => ({ ...c })),
    view: viewMode.value,
  }
  const list = saveUserPreset(preset)
  if (!list) { error.value = '预设保存失败：浏览器存储不可用或已满'; return }
  userPresets.value = list
  presetId.value = preset.id
  presetName.value = ''
  error.value = ''
}

function deleteCurrentPreset() {
  if (!isUserPreset(presetId.value)) return
  const list = deleteUserPreset(presetId.value)
  if (!list) { error.value = '预设删除失败'; return }
  userPresets.value = list
  presetId.value = ''
  error.value = ''
}

// ---------- 跑批 ----------
const computing = ref(false)
const progress = ref<{ pct: number; text: string } | null>(null)
const result = ref<Awaited<ReturnType<typeof computeFreeCompare>> | null>(null)
/** 批任务归属（S4，CC-343）：新一次对比吊销前任，离开页面也吊销；进度/结果只归当前运行 */
const batchOwner = useBatchOwner()

/** 解析配置码序列（逗号/空格/顿号分隔；非法码返回 null 让调用方拦下并提示） */
function parseSetupCodesText(): string[] | null {
  const raw = setupCodesText.value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean)
  const out: string[] = []
  for (const c of raw) {
    if (!parseSetupCode(c)) return null
    out.push(c)
  }
  return out
}
const setupCodes = computed(() => parseSetupCodesText())

/** 求值器/档位枚举共用的档位参数（x 轴与切片各取所需；影画上限同时管条件切片的档数） */
const axisOpts = computed<AxisOptions>(() => ({
  cinemaMax: cinemaMax.value,
  setupCodes: setupCodes.value ?? [],
  periods: periodOptions.value,
  conditionCinemaMax: cinemaMax.value,
}))

/** 切片档数（无切片 = 1）——代价预告与切片提示共用 */
const sliceCount = computed(() => {
  const s = sliceSpec.value
  if (!s) return 1
  return sliceLevelsOf(EMPTY_SERIES_SPEC, s, axisOpts.value).length
})

/** 条件切片时该角色必须在场（基底队友或系列成员）——不在场 ⇒ 每片数值相同，必须点名而不是静默出平线 */
const sliceConditionInScene = computed(() => {
  const s = sliceSpec.value
  if (!s || s.kind !== 'condition') return true
  return mateA.value === s.agentId || mateB.value === s.agentId
    || series.value.some(row => row.kind === 'team' ? row.members.includes(s.agentId) : row.agentId === s.agentId)
})

const sliceHint = computed(() => {
  const s = sliceSpec.value
  if (!s) return '可选：第二个变量——把图切成多片（或叠成 3D）；与 x 轴抢同一字段的维度不出现'
  const n = sliceCount.value
  const missing = sliceConditionInScene.value ? '' : ' · ⚠ 该角色不在基底队友/系列里，各片数值会相同'
  return '切片 = ' + sliceTitleOf(s, agentName) + ' · ' + n + ' 片（求值量 ×' + n + '）' + missing
})

/** 代价预告：单次全量求值 ~0.3-0.4s（由 TeamComparePage 注释「每队 ~10 次 ≈ 3~4 秒」推算） */
const costHint = computed(() => {
  const levels = AXIS_BY_ID.get(axisId.value)?.levels(EMPTY_SERIES_SPEC, axisOpts.value).length ?? 0
  const nSeries = series.value.filter(s => s.kind === 'team' ? s.members.every(Boolean) : !!s.agentId).length
  // 全状态对比：每个主系列拆 本体+每张可用牌 条输出系列（求值量 ×(牌数+1)）；切片再 × 片数
  const buffMult = buffChoice.value === 'all' ? currentBuffs.value.filter(b => !b.testOnly).length + 1 : 1
  const slices = sliceCount.value
  const n = levels * nSeries * buffMult * slices
  if (n === 0) return ''
  // 含「无专武」档时每系列多 ~(池大小−1) 次择优试算（同 (队友,角色,命座) 键后续档位走缓存；择优结果跨 buff 态复用同缓存）
  const sliceIsWengine = sliceSpec.value?.kind === 'axis' && sliceSpec.value.axisId === 'wengine'
  const hasNoWengine = (setupCodes.value ?? []).some(c => c[1] === '0') || axisId.value === 'wengine' || sliceIsWengine
  const picks = hasNoWengine ? nSeries * buffMult * 2 * (slices > 1 ? slices : 1) : 0
  const sec = Math.round((n + picks) * 0.35)
  return `预计 ${n + picks} 次求值 ≈ ${sec}s${autoBuild.value ? '（开了推荐配装，会更慢）' : ''}${buffMult > 1 ? `（全状态对比 ×${buffMult}）` : ''}${slices > 1 ? `（${slices} 片）` : ''}`
})

async function runCompare() {
  error.value = ''
  const specs: SeriesSpec[] = []
  for (const s of series.value) {
    if (s.kind === 'team') {
      if (!s.members.every(Boolean)) { error.value = '整队系列：三个位置都要选角色（或删除该系列）'; return }
      if (new Set(s.members).size !== s.members.length) { error.value = '整队系列：队员不能重复'; return }
      const teamCode = parseSetupCode(s.code)
      if (!teamCode) { error.value = `配置码「${s.code}」不合法：要两位数字（左=影画 0-6，右=精炼 0-5）`; return }
      specs.push({
        id: `team-${s.members.join('-')}-v${s.variedSlot}-${formatSetupCode(teamCode)}`,
        kind: 'team',
        members: [...s.members],
        variedSlot: s.variedSlot,
        code: teamCode,
      })
      continue
    }
    if (!s.agentId) continue
    const code = parseSetupCode(s.code)
    if (!code) { error.value = `配置码「${s.code}」不合法：要两位数字（左=影画 0-6，右=精炼 1-5）`; return }
    // 逐槽码：槽 0 = 系列角色，槽 1/2 = 两个队友（留空 = 跟随系列码 ⇒ 不写这一格）
    const m1 = mateACode.value.trim() ? parseSetupCode(mateACode.value) : null
    const m2 = mateBCode.value.trim() ? parseSetupCode(mateBCode.value) : null
    const slotCodes: Array<SetupCode | null> = [null, m1, m2]
    specs.push({
      id: `${s.agentId}-${formatSetupCode(code)}${m1 ? '-m1' + formatSetupCode(m1) : ''}${m2 ? '-m2' + formatSetupCode(m2) : ''}`,
      kind: 'agent',
      members: [s.agentId],
      code,
      ...(m1 || m2 ? { slotCodes } : {}),
    })
  }
  if (specs.length === 0) { error.value = '至少选一个系列（选角色 + 填配置码）'; return }
  // 队友配置码：非空但解析不出来 ⇒ 响亮拒绝（静默按"跟随系列码"处理会让用户以为生效了）
  for (const [label, text] of [['队友1', mateACode.value], ['队友2', mateBCode.value]] as const) {
    if (text.trim() && !parseSetupCode(text)) {
      error.value = `${label}配置码「${text}」不合法：要两位数字（左=影画 0-6，右=精炼 0-5）`
      return
    }
  }
  // x = 配置码时档位来自用户输入，非法就在这里拦下（别让非法码静默变成空轴）
  if (axisId.value === 'setupCode') {
    if (setupCodes.value === null) { error.value = '配置码序列里有非法码：每位都要两位数字（左=影画 0-6，右=精炼 1-5）'; return }
    if (setupCodes.value.length === 0) { error.value = '配置码序列是空的'; return }
  }

  if (axisId.value === 'period' && periodOptions.value.length === 0) { error.value = 'x = Boss 期数时，先在「条件」里选一个 Boss（期数 = 该 Boss 的各期危局）'; return }
  const slice = sliceSpec.value
  // 防御：下拉已排除抢字段的组合，但直接改 URL/旧状态进来也要响亮拒绝（静默二选一 = 假维度）
  if (slice && slice.kind === 'axis' && sliceConflicts(slice, axisId.value)) {
    error.value = '切片维度与 x 轴覆盖同一字段，会互相覆盖；请换一个切片维度'; return
  }
  if (slice && sliceCount.value === 0) {
    error.value = '切片维度没有可用档位：Boss 期数切片要先在「条件」里选 Boss'; return
  }

  const run = batchOwner.start()
  computing.value = true
  progress.value = null
  try {
    // r372：对比在独立场景上求值（逐档位 yield，UI store 全程看不到中间态）
    const res = await withAnalysisScenario(scenario => computeFreeCompare(scenario, {
      series: specs,
      axisId: axisId.value,
      axisOptions: axisOpts.value,
      metricId: metricId.value,
      slice,
      constraints: {
        boss: bossPresets.value.find(b => b.id === bossId.value),
        baseTeammates: [mateA.value, mateB.value],
        conditions: conditions.value,
        autoBuild: autoBuild.value,
        stunLock: stunLock.value,
        buffs: currentBuffs.value,
        buffChoice: buffChoice.value === 'all'
          ? 'all'
          : buffChoice.value === 'none'
            ? 'none'
            : currentBuffs.value.find(b => `card:${b.title}` === buffChoice.value) ?? 'none',
      },
      control: { signal: run.signal },
      onProgress: p => run.commit(() => { progress.value = p }),
    }))
    run.commit(() => {
      imported.value = null
      result.value = res
    })
  } catch (e) {
    run.commit(() => { error.value = e instanceof Error ? e.message : String(e) })
  } finally {
    run.commit(() => { computing.value = false; progress.value = null })
  }
}
/** 「取消」按钮：停掉当前运行；已算档位由该运行自己发布（求值器中止时保留已算部分） */
function abort() {
  batchOwner.cancel()
  computing.value = false
  progress.value = null
}

// ---------- 图 ----------
const svgW = 900
const svgH = 340
const padL = 74
const padR = 24
const padT = 18
const plotH = 250

const legend = useSeriesFilter(() => (result.value?.series ?? []).map(s => ({ id: s.id, name: s.label })))
const legendItems = computed(() => seriesItemsOf(result.value))
/** 当前片：表格/折线/3D 选中态共用；id 失效时回落第一片 */
const selectedSlice = computed(() => selectedSliceOf(result.value, selectedSliceId.value))
const visibleSeries = computed(() => legend.filter(selectedSlice.value?.series ?? []))
/** 图例显隐对所有视角生效：按系列 id 过滤（隐藏必须退出派生量） */
const visibleIds = computed(() => new Set(visibleSeries.value.map(s => s.id)))
const sliceSelectOptions = computed(() => (result.value?.slices ?? []).map(s => ({ value: s.id, label: s.label || '全部' })))
/** 可用视角：无切片时隐藏「切片/3D」（与折线重复） */
const viewDefs = computed(() => {
  const allowed = new Set(availableViews(result.value?.slices.length ?? 1, result.value?.levels.length ?? 0))
  return ANALYSIS_VIEWS.filter(v => allowed.has(v.id))
})
const viewHint = computed(() => {
  const def = ANALYSIS_VIEWS.find(v => v.id === viewMode.value)
  const count = result.value?.slices.length ?? 0
  return (def ? def.hint : '') + (count > 1 && viewMode.value === 'line' ? ' · 共 ' + count + ' 片，点「切片」看全部' : '')
})
const baselineOptions = computed(() => baselineOptionsOf(result.value))
const deltaPanels = computed(() => result.value
  ? deltaPanelsOf(result.value, baselineEntityId.value, visibleIds.value)
  : [])

/** 纵轴范围：只看可见系列（隐藏必须退出派生量，否则筛选看着没生效）；几何复用 versionChartGeometry（CC-427） */
const yRange = computed(() =>
  scYRangeOf(
    visibleSeries.value
      .flatMap(s => s.values)
      .filter((v): v is number => v !== null && Number.isFinite(v)),
  ),
)
const plotBox = { padT, plotH }
const yGrid = computed(() => scYGridOf(yRange.value, plotBox))
function yOf(v: number): number {
  return scYOf(v, yRange.value, plotBox)
}
function yLabel(i: number): string {
  const step = scYStepOf(yRange.value)
  const v = scGridStartOf(yRange.value, step) + i * step
  return formatValue(v)
}
function levelX(i: number): number {
  const n = result.value?.levels.length ?? 0
  if (n <= 1) return padL + (svgW - padL - padR) / 2
  return padL + (i / (n - 1)) * (svgW - padL - padR)
}

/**
 * 结果所属指标的定义。CC-204：表格 / 折线 / 纵轴的格式化此前读下拉框当前值 `metricId`——对比完再切指标，
 * 旧结果会按新指标的单位与小数位显示（百分比指标 ×100 等）。一律改读结果自带的 `result.metricId`。
 * 兜底取 METRICS[0]：结果一定带指标（求值器拒绝未注册 id），这里只为让类型非空，格式化点不再逐个判空。
 */
const resultDef = computed<MetricDef>(() => {
  if (imported.value) {
    const m = imported.value.dataset.measure
    return {
      id: m.id,
      label: m.label,
      hint: '导入自其他页面的分析结果',
      scope: 'team',
      digits: m.digits ?? 1,
      unit: m.unit ?? '',
      higherBetter: m.higherBetter ?? true,
      // 导入结果没有引擎向量；只用上面的格式化字段，read 不应被调用
      read: () => ({}),
    }
  }
  return metricDef(result.value?.metricId ?? metricId.value) ?? METRICS[0]
})
/** 同一份结果的长表表示（x × 切片 × 系列）；后续跨页分析类型也产出这个形状 */
const dataset = computed(() => (result.value ? datasetFromFreeCompare(result.value) : null))
/** 长表只显示图例可见系列（跨全部切片），与表格/折线同一把尺 */
const longRows = computed(() => (dataset.value?.rows ?? []).filter(r => visibleIds.value.has(r.seriesId)))
const longColumns = computed(() => [
  { key: 'x', label: 'x · ' + (result.value?.axisLabel ?? '') },
  { key: 'slice', label: result.value?.sliceLabel ?? '切片' },
  { key: 'series', label: '系列' },
  { key: 'value', label: result.value?.metricLabel ?? '值' },
])

function formatValue(v: number): string {
  return formatMetric(resultDef.value, v)
}
function formatLongValue(v: number | null): string {
  return v === null ? '—' : formatValue(v)
}

/** 导出完整长表（不受图例筛选；CSV 保留原始精度） */
function exportDatasetCsv(): void {
  if (!dataset.value) return
  const blob = new Blob([datasetCsv(dataset.value)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'zzz-analysis-long.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 本次结果是否有多个切片（无切片 = 单张 2D 图，沿用原图） */
const hasSlices = computed(() => (result.value?.slices.length ?? 0) > 1)
const slicePanels = computed(() => (result.value?.slices ?? []).map(sl => ({
  id: sl.id,
  label: sl.label,
  series: sl.series.filter(s => visibleIds.value.has(s.id)),
})))
/** 3D 图数据：每个可见系列在每片里的一条道（值按系列 id 对齐，不靠下标跨片对齐） */
const series3d = computed(() => {
  const r = result.value
  if (!r) return []
  const ids = visibleIds.value
  return r.series
    .filter(s => ids.has(s.id))
    .map(s => ({
      id: s.id,
      label: s.label,
      values: r.slices.map(sl => sl.series.find(x => x.id === s.id)?.values ?? []),
    }))
})

const visibleLines = computed(() => visibleSeries.value.map(s => {
  const pts = s.values.map((v, i) => ({
    x: levelX(i),
    y: v === null ? yOf(yRange.value.min) : yOf(v),
    text: v === null ? '—' : formatValue(v),
  }))
  return { id: s.id, label: s.label, buffTitle: s.buffTitle, pts, points: pts.map(p => `${p.x},${p.y}`).join(' ') }
}))

/**
 * 逐档提升标注（2026-10-27）：默认**三条线都标**（用户：「一个 x 轴只显示了一个提升幅度，
 * 把三个人全显示」）；关掉「三线都标」则退化为每档最优一条。
 *
 * 同一 x 上三条线的标签按点 y 从上到下排，相邻至少隔 13px（10px 字 + 3px 间隙）——
 * 只做**垂直避让**：同一 x 的标签共用圆心 x，水平必然重叠，垂直错开即可读；
 * 标签贴线时用 `--chart-halo` 描边（UI_THEME_GUIDE §4）。
 */
const stepLabels = computed(() => {
  const r = result.value
  if (!r || !showStepGain.value || r.levels.length < 2) return []
  const gains = stepGainsOf(visibleSeries.value, r.levels.length)
  const best = bestStepIndexByLevel(gains, resultDef.value.higherBetter)
  const out: Array<{ key: string; x: number; y: number; text: string; color: string }> = []
  for (let i = 1; i < r.levels.length; i++) {
    // 垂直避让算法单源在 composables/charts/stepLabelLayout（纯函数 + 单测，别的折线图可复用）
    const opts = { level: i, topBound: padT + 30, format: formatSignedDeltaPercent }
    if (stepLabelAll.value) {
      const points: Array<{ id: string; x: number; y: number; gain: number; color: string }> = []
      visibleSeries.value.forEach((s, si) => {
        const p = visibleLines.value[si]?.pts[i]
        const g = gains[si]?.[i]
        if (!p || g == null) return
        points.push({ id: s.id, x: p.x, y: p.y, gain: g, color: colorOf(s.id) })
      })
      out.push(...layoutStepLabels(points, opts))
      continue
    }
    const si = best[i]
    if (si < 0) continue
    const s = visibleSeries.value[si]
    const p = visibleLines.value[si]?.pts[i]
    const g = gains[si]?.[i]
    if (!s || !p || g == null) continue
    out.push(...layoutStepLabels([{ id: s.id, x: p.x, y: p.y, gain: g, color: colorOf(s.id) }], opts))
  }
  return out
})

/** 图下逐档矩阵的一格 / 一行（具名类型；判据 27 禁止用类型字面量断言造空数组） */
interface StepMatrixCell { text: string; best: boolean; empty: boolean }
interface StepMatrixRow { id: string; label: string; color: string; cells: StepMatrixCell[] }

/**
 * 图下「逐档提升」矩阵（2026-10-27 用户：怕图上叠字就在下面多一块 UI 显示数据）。
 * 行 = 系列（短标签 = 被变的那个人），列 = C1..Cn，格 = 相对上一档的提升%；
 * 每列绿字 = 该档提升最大。与折线共用 `stepGainsOf` / `bestStepIndexByLevel`（同一把尺）。
 */
const stepMatrix = computed<{ levels: string[]; rows: StepMatrixRow[] }>(() => {
  const r = result.value
  if (!r || r.levels.length < 2) return { levels: [], rows: [] }
  const gains = stepGainsOf(visibleSeries.value, r.levels.length)
  const best = bestStepIndexByLevel(gains, resultDef.value.higherBetter)
  const levels = r.levels.slice(1).map(lv => lv.label)
  return {
    levels,
    rows: visibleSeries.value.map((s, si) => ({
      id: s.id,
      label: s.shortLabel ?? s.label,
      color: colorOf(s.id),
      cells: levels.map((_, j) => {
        const i = j + 1
        const g = gains[si]?.[i]
        return {
          text: g == null ? '—' : formatSignedDeltaPercent(g),
          best: g != null && best[i] === si,
          empty: g == null,
        }
      }),
    })),
  }
})
/** 矩阵右侧提示：当前片 + 绿字含义（与组件解耦，组件只管排版） */
const stepMatrixHint = computed(() => `绿 = 该档最赚 · 当前片：${selectedSlice.value?.label || '全部'}`)

/** 本次结果是否含 buff 拆分（全状态对比 ⇒ 图例提示线型口径） */
const hasBuffSplit = computed(() => (result.value?.series ?? []).some(s => s.buffTitle !== null))
const legendHint = computed(() =>
  '点系列名显隐（表格/折线/切片/3D/差值共用）'
  + (hasBuffSplit.value ? ' · 折线：实线 = 本体，虚线 = 吃当期牌' : ''),
)

/** 本次结果实际锁的失衡次数（开锁时逐系列/逐片可能不同；0 窗 = 没锁成） */
const stunLockNote = computed(() => {
  if (!result.value || imported.value) return ''
  const vals: number[] = []
  let zeroWindow = 0
  for (const sl of result.value.slices) {
    for (const s of sl.series) {
      if (typeof s.stunLock === 'number') vals.push(s.stunLock)
      else if (s.stunLock === null) zeroWindow++
    }
  }
  // 用**结果自带字段**判断，不读当前复选框（改完复选框还没重跑时，旧结果不能被说成新口径）
  if (vals.length === 0) {
    return zeroWindow > 0
      ? '首档自由收敛为 0 窗（无法锁，等于不锁）'
      : '不锁（含失衡通道：C3/C5 多打的失衡窗也算进提升）'
  }
  const uniq = [...new Set(vals)]
  const suffix = zeroWindow > 0 ? `；${zeroWindow} 条首档 0 窗未锁` : ''
  return (uniq.length === 1 ? `锁 ${uniq[0]} 窗（取首档自由收敛值）` : `锁值不一（${uniq.join(' / ')} 窗）`) + suffix
})

/** 无专武档实际穿的下位件（去重；空 = 本次没跑无专武档；切片时逐片收集） */
const downgradeNotes = computed(() => {
  const out: string[] = []
  for (const sl of result.value?.slices ?? []) {
    for (const s of sl.series) {
      for (const d of s.downgrades ?? []) if (!out.includes(d)) out.push(d)
    }
  }
  return out
})

watch(result, r => {
  if (!r) return
  selectedSliceId.value = r.slices[0]?.id ?? ''
  baselineEntityId.value = defaultBaselineId(r)
  viewMode.value = fallbackView(viewMode.value, r.slices.length, r.levels.length)
})

onMounted(async () => {
  userPresets.value = loadUserPresets()
  try {
    const data = await useCatalogStore().loadBossPresets()
    bossPresets.value = data.bosses ?? []
    phaseViews.value = data.phaseViews ?? []
  } catch (e) {
    error.value = `Boss 预设加载失败：${e instanceof Error ? e.message : String(e)}`
  }
})
</script>

<style scoped>
.free-compare-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.card-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.muted {
  font-size: 12px;
  color: var(--fg-3);
}
.ctl-block {
  border-top: 1px solid var(--app-border);
  padding-top: 10px;
  margin-top: 10px;
}
.ctl-block:first-of-type {
  border-top: none;
  margin-top: 0;
}
.ctl-block-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--app-text);
}
.ctl-hint {
  font-size: 12px;
  color: var(--fg-3);
  font-weight: 400;
}
.ctl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.ctl-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ctl-label {
  font-size: 12px;
  color: var(--fg-2);
  white-space: nowrap;
}
.series-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
/* 整队系列：成员只读（在「三人命座边际」区统一选），行内只改「只变谁」与基线码 */
.series-team {
  font-size: 12px;
  color: var(--fg-2);
  min-width: 240px;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.series-actions {
  margin-top: 6px;
}
.marginal-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--app-border);
}
.code-label {
  font-size: 12px;
  color: var(--fg-2);
}
.code-read {
  font-size: 12px;
  color: var(--fg-3);
  min-width: 84px;
}
.run-row {
  margin-top: 12px;
  border-top: 1px solid var(--app-border);
  padding-top: 12px;
}
.cost-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.progress-text {
  font-size: 12px;
  color: var(--fg-3);
}
.legend-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.fc-note {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--fg-3);
}
.fc-import {
  color: var(--c-info);
}
.import-row {
  border-top: 1px dashed var(--app-border);
  padding-top: 8px;
  margin-top: 8px;
}
.fc-note-label {
  color: var(--fg-2);
}
.fc-note-item {
  padding: 1px 7px;
  border: 1px solid var(--line);
  border-radius: 3px;
}
.fc-plot-wrap {
  width: 100%;
  overflow-x: auto;
}
.fc-svg {
  width: 100%;
  min-width: 620px;
  display: block;
}
.grid-line {
  stroke: var(--line);
  stroke-width: 1;
}
.axis-label {
  font-size: 11px;
  fill: var(--fg-3);
}
.fc-line {
  fill: none;
  stroke-width: 2;
}
.trend-point {
  stroke: var(--line-strong);
  stroke-width: 1;
}
/* 逐档提升标注：压在折线上，用主题光晕保证双主题都可读（UI_THEME_GUIDE §4） */
.fc-step-label {
  font-size: 10px;
  font-weight: 600;
  paint-order: stroke;
  stroke: var(--chart-halo);
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}
.fc-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: 4px 0 8px;
}
.fc-view-switch {
  display: inline-flex;
  gap: 4px;
}
.fc-view-btn {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--app-text);
  cursor: pointer;
}
.fc-export {
  margin-left: 4px;
  border-style: dashed;
}
.fc-long-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 5px;
  border-radius: 50%;
}
.fc-view-btn.active {
  border-color: var(--c-success);
  color: var(--c-success);
}
.fc-view {
  min-width: 0;
}
.empty-hint {
  font-size: 13px;
  color: var(--fg-3);
  padding: 16px;
  text-align: center;
}
</style>
