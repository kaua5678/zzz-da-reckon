<template>
  <div class="team-compare-page">
    <!-- 控制面板 -->
    <n-card size="small" :bordered="true">
      <div class="compare-controls">
        <div class="ctl-field" title="散点 = 各队在各金数档的一个点；难度曲线 = 每队自己的贪心优化路径（x 是累积难度代价，各队不对齐是特性，看形状不看同一 x）；选第三人 = 固定 2 个队友，第三槽在选定候选（职业筛选/手选）里逐个试算排名">
          <span class="ctl-label">图型</span>
          <n-radio-group v-model:value="chartMode" size="small">
            <n-radio-button value="scatter">散点</n-radio-button>
            <n-radio-button value="curve">难度曲线</n-radio-button>
            <n-radio-button value="sweep">选第三人</n-radio-button>
            <n-radio-button value="uplift">命座提升率</n-radio-button>
          </n-radio-group>
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
            max-tag-count="responsive"
            :fallback-option="presetLabelOf"
            style="width: 220px"
            placeholder="选择队伍（可多选）"
            title="默认选中当前筛选分类下的队伍；框内只显示首队 +N，点开下拉可逐个勾选/清空。筛选只决定下拉列出什么，不影响已经选中的队伍（跨分类自由勾选）"
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
        <CustomTeamsEditor v-model:selected-ids="selectedPresetIds" />
        <!--
          每队配置码（用户 2026-10-26：「我想这里写成操作区，比如我从上面勾选的队伍也能写配置码」）：
          放在**队伍选择旁边**、所有图型共用（散点 / 难度曲线 / 第三人 / 提升率都吃同一份覆盖）——
          它改的是「这支队是什么」，不是「这个图型怎么画」。
        -->
        <TeamSlotCodeEditor :presets="selectedPresets" />
        <div class="ctl-field" title="操作难度是主观量（两图共用同一口径）：难度 = Σ(交互次数×权重) + 时间压力秒×权重；散点图横轴同口径。按你的手感改，浏览器本地持久化；预设条目自带 weight 仍最优先">
          <n-popover trigger="click" placement="bottom-end" :style="{ width: '300px' }">
            <template #trigger>
              <n-button size="small" quaternary>难度权重</n-button>
            </template>
            <div class="diff-weight-pop">
              <div class="diff-weight-row" title="时间压力 = 这套轴「要塞进战斗时间得挤出多少秒」= 合轴抵扣掉的秒 + 硬溢出剩下的秒。两者是同一笔秒数（允许溢出一部分正是因为队友可以合轴），所以只有一个权重">
                <span class="diff-weight-label">时间压力（难度点/秒）</span>
                <n-input-number v-model:value="diffWeights.timePressure" size="tiny" :min="0" :max="20" :step="0.5" style="width: 84px" />
              </div>
              <div
                v-for="row in diffWeightRows"
                :key="row.type"
                class="diff-weight-row"
                :title="row.tip"
              >
                <span class="diff-weight-label">{{ row.label }}</span>
                <n-input-number v-model:value="diffWeights.interaction[row.type]" size="tiny" :min="0" :max="20" :step="0.1" style="width: 84px" />
                <!-- 需怪攻击的交互：可开关是否吃非失衡占比（用户口径 2026-09-20「让用户抉择」） -->
                <n-checkbox
                  v-if="row.bossAttack"
                  :checked="!row.formulaOff"
                  size="small"
                  class="diff-weight-boss"
                  @update:checked="v => setBossAttackFormula(row.type, v)"
                >吃非失衡占比</n-checkbox>
                <span v-else class="diff-weight-boss-placeholder" />
              </div>
              <!-- 自编公式（可折叠；默认公式见行内提示） -->
              <n-collapse size="small" class="diff-weight-formula">
                <n-collapse-item title="自编难度公式（进阶）" name="f">
                  <div class="diff-weight-tip">
                    变量：<code>c</code>=次数 <code>w</code>=权重 <code>r</code>=非失衡占比(0..1)
                    <code>k</code>=指数；可用 <code>clamp/floor/max/min/pow/abs/sqrt</code>。
                    <b>幂运算写 <code>pow(a,b)</code> 或 <code>a**b</code></b>（<code>^</code> 是异或，会算错）。
                    默认：需怪攻击的 = <code>c*w/pow(max(r,0.05),k)</code>，其余 = <code>c*w</code>。
                    非法公式自动退化为 <code>c*w</code>。
                  </div>
                  <div v-for="row in diffWeightRows" :key="'f' + row.type" class="diff-weight-row">
                    <span class="diff-weight-label">{{ row.label }}</span>
                    <n-input
                      v-model:value="diffWeights.interactionFormula[row.type]"
                      size="tiny"
                      :placeholder="row.defaultFormula"
                      style="width: 200px"
                    />
                    <n-input-number
                      v-if="row.bossAttack"
                      v-model:value="diffWeights.interactionExponent[row.type]"
                      size="tiny" :min="0" :max="3" :step="0.25" style="width: 64px"
                    />
                  </div>
                </n-collapse-item>
              </n-collapse>
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
        <div class="ctl-field" title="≤12金：自动逐金挑选伤害提升最大的加金组合（含专武本体购买，贪婪搜索，每队多算几轮全量伤害，较慢）；12金以上仍按预设 goldSteps 顺序。⚠ 勾了之后「金数区间」几乎不额外花时间：贪婪链是一次算到 12 金、各档只是链上的前缀点">
          <n-checkbox v-model:checked="optimalGold" size="small">最优加金（≤12金，慢）</n-checkbox>
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
              max-tag-count="responsive"
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
        <div class="ctl-field" title="第三轴 = 时间：把每队主C的首次卡池时间编码成颜色（冷=早 / 暖=晚）与点大小（越新越大）。关闭时颜色仍表示队伍身份（跟图例显隐一致）">
          <n-checkbox v-model:checked="colorByRelease" size="small">按主C实装时间着色</n-checkbox>
        </div>
        <div class="ctl-field" title="显示「同一支队、同一个金数，这笔金投给谁」的分歧：贪婪搜索本来就试算了每档的全部候选（各槽位的下一级影画/精炼/专武本体），此处把被淘汰的候选也列出来，附「选错的代价 %」。需勾选「最优加金」">
          <n-checkbox v-model:checked="showGoldAlternatives" size="small" :disabled="!optimalGold">
            同金分配对比
          </n-checkbox>
        </div>
        </template>
        <!-- 环境模式（只服务难度曲线图型）：勾了 = 看综合实力，不勾 = 看自身实力 -->
        <template v-if="chartMode === 'curve'">
          <!-- 环境模式（用户 2026-10-13）：勾了 = 看综合实力（各期血量膨胀 + 该期 buff），不勾 = 看自身实力 -->
          <div class="version-picks" style="margin-bottom: 4px">
            <n-checkbox
              v-model:checked="curveEnv"
              size="small"
              title="勾上 = 综合实力：每条道走**该队版本内的每一期**（该期 Boss 血量 + 该期 buff 牌）；不勾 = 自身实力：全部队用当前选中那一期、不吃 buff"
            >
              环境（按期数）
            </n-checkbox>
            <template v-if="curveEnv">
              <span>buff：</span>
              <n-select
                v-model:value="curveBuffMode"
                :options="curveBuffModeOptions"
                size="tiny"
                style="width: 190px"
              />
              <n-select
                v-if="curveBuffMode === 'manual'"
                v-model:value="curveManualBuff"
                :options="curveManualBuffOptions"
                size="tiny"
                style="width: 160px"
                placeholder="选牌"
              />
              <span>期数范围：</span>
              <n-select v-model:value="curvePeriodFrom" :options="curvePeriodOptions" size="tiny" style="width: 150px" />
              <span>→</span>
              <n-select v-model:value="curvePeriodTo" :options="curvePeriodOptions" size="tiny" style="width: 150px" />
              <span v-if="curveEnvLanes.length > 0" style="opacity: 0.75">
                （{{ curveEnvLanes.length }} 条道 = 各队 × 其版本内的期）
              </span>
              <!-- 一条道都没有时如实说明原因，否则「点了没反应」看着像坏了 -->
              <span v-else style="opacity: 0.8; color: var(--c-warning)">
                （当前队伍在这个期数范围里没有可跑的道：该队版本槽角色未收录实装版本，或选中 Boss 在这些期都没上岗）
              </span>
            </template>
          </div>
        </template>
        <!-- 选第三人：固定 2 个队友 + 候选范围（职业筛选/手选），不依赖预设队伍（求值口径同「同槽位角色对比」） -->
        <template v-if="chartMode === 'sweep'">
          <div class="ctl-field" title="第三人补进哪个槽位：其余两槽固定，该槽在候选池里逐个试算排名">
            <span class="ctl-label">第三人槽位</span>
            <n-select v-model:value="sweepSlot" :options="sweepSlotOptions" size="small" style="width: 92px" />
          </div>
          <div v-for="fs in sweepFixedSlots" :key="fs" class="ctl-field">
            <span class="ctl-label">固定·{{ slotLabels[fs] }}</span>
            <n-select
              v-model:value="sweepFixedBySlot[fs]"
              :options="agentOptions"
              size="small"
              filterable
              style="width: 132px"
              placeholder="选角色"
            />
          </div>
          <div class="ctl-field" title="候选职业（可多选）：第三人的候选范围，空 = 全部职业。比如固定蕾米埃尔+维琳娜、只勾「异常」→ 第三人在全部异常角色里比">
            <span class="ctl-label">候选职业</span>
            <n-select
              v-model:value="sweepSpecFilter"
              :options="sweepSpecOptions"
              size="small"
              multiple
              style="width: 150px"
              placeholder="全部职业"
            />
          </div>
          <div class="ctl-field" title="在职业筛选内再手选候选人（可多选，空 = 筛选后全部）">
            <span class="ctl-label">候选角色</span>
            <n-select
              v-model:value="sweepCandidateSel"
              :options="sweepCandidateOptions"
              size="small"
              multiple
              filterable
              max-tag-count="responsive"
              style="width: 170px"
              placeholder="筛选后全部"
            />
          </div>
          <div class="ctl-field" title="总限定金预算：限定 S 角色本体 1 金 + 限定音擎本体 1 金 + 影画/精炼每级 1 金；常驻/A 级角色与常驻音擎不计">
            <span class="ctl-label">限定金</span>
            <n-input-number v-model:value="sweepBudget" size="small" :min="0" :max="18" style="width: 70px" />
          </div>
          <div class="ctl-field" title="逐金贪婪挑伤害提升最大的加金组合（每名候选多算几轮，候选多时显著变慢，慎开）；关闭则按主C优先确定性分配（每名候选 1 次求值）">
            <n-checkbox v-model:checked="sweepOptimalGold" size="small">最优加金（慢）</n-checkbox>
          </div>
        </template>
        <template v-if="chartMode === 'uplift'">
          <div class="ctl-field" title="网格行 = Boss（取所选期数范围里出现过的 Boss，每 Boss 一行的最新期）；行数上限控制成本">
            <span class="ctl-label">Boss 行</span>
            <n-input-number v-model:value="upliftBossRows" size="small" :min="1" :max="9" style="width: 70px" />
          </div>
          <div class="ctl-field" title="网格列 = 环境 buff 牌（取自所选期数的最新期视图）；列数上限控制成本">
            <span class="ctl-label">Buff 列</span>
            <n-input-number v-model:value="upliftBuffCols" size="small" :min="1" :max="4" style="width: 70px" />
          </div>
          <div class="ctl-field" title="被评估的槽位（命座提升率按槽位算；缺省主C）">
            <span class="ctl-label">槽位</span>
            <n-select v-model:value="upliftSlot" size="small" :options="slotLabels.map((l, i) => ({ value: i, label: l }))" style="width: 110px" />
          </div>
          <div class="ctl-field" title="最高命座等级（默认 6；调到 3 可把成本减半）">
            <span class="ctl-label">最高命座</span>
            <n-input-number v-model:value="upliftMaxLevel" size="small" :min="1" :max="6" style="width: 70px" />
          </div>
          <div class="ctl-field" title="锁值口径：行 = 每个 Boss 用自己的锁值（各打各的）；表 = 整张表同一个锁值（同一把尺子，跨行可比）。整数台阶型命座（如克拉蕾 C1 残痕效率 +20%）对锁值极敏感，换锁值整档会跳 —— 用「表」更利于横向比">
            <span class="ctl-label">锁值</span>
            <n-select
              v-model:value="upliftLockMode"
              size="small"
              style="width: 130px"
              :options="[{ value: 'grid', label: '整表统一' }, { value: 'row', label: '逐行各自' }]"
            />
          </div>
          <div class="ctl-field" title="同时跑「不锁失衡次数」口径 ⇒ 多出「失衡通道贡献」一列（每格求值翻倍，慢）">
            <n-checkbox v-model:checked="upliftIncludeFree" size="small">含失衡通道</n-checkbox>
          </div>
        </template>
        <n-button
          type="primary" size="small" :loading="computing"
          @click="chartMode === 'scatter' ? runCompare() : chartMode === 'curve' ? runCurves() : chartMode === 'sweep' ? runSweep() : runUpliftGrid()"
        >
          {{ chartMode === 'scatter' ? '计算' : chartMode === 'curve' ? '计算曲线' : chartMode === 'sweep' ? '计算第三人' : '计算提升率网格' }}
        </n-button>
        <n-button v-if="(chartMode === 'curve' || chartMode === 'sweep' || chartMode === 'uplift') && computing" size="small" @click="chartMode === 'curve' ? cancelCurrentRun() : chartMode === 'sweep' ? cancelSweep() : cancelUplift()">中止</n-button>
      </div>

      <!-- 进度 -->
      <div v-if="computing && progress" class="progress-bar">
        <div class="progress-fill" :style="{ width: progress.pct * 100 + '%' }"></div>
        <span class="progress-text">{{ progress.text }}</span>
      </div>

      <div v-if="!computing && chartMode === 'scatter' && points.length > 0" class="compare-note">
        共 {{ visiblePoints.length }}/{{ points.length }} 个点（图例可点显隐队伍，被隐藏的队<b>不计入坐标轴</b>）
        · 纵轴 = 伤害/血量%（100% 击杀线）· 横轴 = 操作难度（交互加权和 + 时间压力秒，权重可在「难度权重」调）· 点半径 = 限定金
      </div>

      <!-- 用户 2026-10-26：「加金不该有排好的序……只能说全01这一片单薄的预设就行，要么给 ui 自己改，要么勾选贪婪，提示下一步」 -->
      <div v-if="!computing && chartMode === 'scatter' && singlePointNotice" class="compare-note">
        {{ singlePointNotice }}
      </div>

      <div v-if="!computing && chartMode === 'curve'" class="compare-note">
        已选 {{ selectedPresets.length }} 队 · 每队用自己的预设配装（0命1精 + 预设音擎/驱动盘/权重/交互）
        · x = 操作难度（Σ交互次数×权重 + <b>时间压力秒</b>×权重，<b>自动算</b>；时间压力 = 合轴抵扣掉的秒 + 硬溢出剩下的秒 = 同一笔秒数，只挂一个权重；交互/时间压力权重都在「难度权重」弹层调）
        · 每队要跑 ~10 次全量伤害（约 3~4 秒/队 ⇒ 预计 ≈{{ fmt(selectedPresets.length * 3.4 / 60, 1) }} 分钟）——
        曲线模式建议只选几支队做「难易强度」对比，跑起来可点「中止」保留已算部分。
      </div>

      <div v-if="!computing && chartMode === 'sweep' && !sweepResult" class="compare-note">
        固定 2 个队友、第三人从<b>选定范围</b>里对比（不依赖预设队伍）：「候选职业」圈范围（空 = 全部），「候选角色」可再手选子集（空 = 筛选后全部）。
        候选逐个以同一预算求值后按伤害排名。口径与时间图表页「同槽位角色对比」一致：预算感知确定性配装（主C优先，每名候选 1 次求值）或勾选「最优加金」逐金贪婪；
        不含当期 buff / 自动下位；未收敛（maxIter）候选跳过并在结果里注明。
      </div>

      <div v-if="teamPresets.length === 0" class="empty-hint">
        暂无预设队伍 —— 复制 <code>src/data/teamPresets/_template.json</code> 到同目录改名编辑（删掉
        <code>disabled</code> 字段），刷新后自动加载。加金顺序/交互清单说明见文件头注释。
      </div>
      <div v-else-if="bossPresets.length === 0" class="empty-hint">
        Boss 预设数据未加载（运行 <code>node scripts/import-nanoka-bosses.mjs</code> 生成
        <code>public/static/boss-presets.json</code>）。
      </div>
      <div v-else-if="chartMode === 'scatter' && !computing && points.length === 0" class="empty-hint guide-hint">
        已预选最新期数 / 全部队伍 / 限定金区间 —— 点「计算」生成散点图（默认不带当期 buff，可下拉开启）。
        限定金只统计限定 S 角色/音擎（常驻角色如莱卡恩不计）；选择越界自动钳制到队伍档位范围。
        「最优加金（≤12金）」默认开启：≤12金自动逐金挑选伤害提升最大的加金组合（含专武本体购买，贪婪搜索，较慢），12金以上仍按预设 goldSteps 顺序；
        「自动下位」默认开启：未穿限定音擎的槽位从「下位装填池」（默认常驻 S + 预设常用 A 级，可增删）按伤害择优穿戴，A 级默认精炼 5、常驻默认精炼 3 可调，预设 wEngines 仅限定音擎保留；
        限定专武作为加金步（goldSteps 里带 wEngineId 的步骤），如星徽·比利队基础 3 金（3 角色本体、无专武），4 金起在对比里逐步买专武，改完重跑一次对比即可。
      </div>
      <div v-else-if="chartMode === 'sweep' && !computing && !sweepResult" class="empty-hint guide-hint">
        选好第三人槽位与两个固定队友 → 圈定候选（「候选职业」勾异常/命破等，或「候选角色」手选）→ 点「计算第三人」。
        固定队友不必来自同一预设队——任何角色组合都可以比；结果为候选伤害排名表（伤害占比条 + 加金明细），直接回答「这两个队友下第三人选谁」。
      </div>
      <!--
        ⚠ **难度曲线算完却一条道都没有**时必须有话说（2026-10-13 用户报「不出图」）：
        此前 `curveData` 为 null ⇒ 四张卡片的 `v-if` 全假 ⇒ **整页空白且无提示**，
        用户分不清「没数据」还是「算坏了」。这里如实说明原因与下一步动作。
      -->
      <div
        v-else-if="chartMode === 'curve' && !computing && curveRows.length > 0 && curveData === null"
        class="empty-hint guide-hint"
      >
        本批队伍在这个期数范围里**没有可跑的道**，所以没有曲线可画。环境模式（按期数）下每条道
        =（队伍 × 该队实装之后、选中 Boss 上岗的某一期），因此「一条道都没有」通常是因为：
        <b>① 选中 Boss 在你选的期数范围里没上岗</b>（换 Boss，或把「期数范围」放宽到头尾之外）；
        <b>② 队伍版本槽角色的实装晚于这些期</b>（换队伍，或用「按主C快选」选个更早实装的）；
        <b>③ 期数范围收得太窄</b>（把起点往前、终点往后各放一点）。
        不想按期数看的话，把「环境（按期数）」**取消勾选**即可回到单期口径（每队一条曲线）。
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
          <!-- 击杀线走 .curve-kill-line（字面色值统一落在样式表，模板不再写 hex） -->
          <line :x1="padL" :y1="yOf(100)" :x2="padL + plotW" :y2="yOf(100)" class="curve-kill-line time-exceeded" stroke-dasharray="6,4" opacity="0.8" />
          <text :x="padL + 4" :y="yOf(100) - 4" class="curve-kill-label time-exceeded" font-size="10">击杀线 100%</text>
          <line v-if="yMax > 200" :x1="padL" :y1="yOf(200)" :x2="padL + plotW" :y2="yOf(200)" class="chart-refline" stroke-dasharray="4,4" />
          <text v-if="yMax > 200" :x="padL + 4" :y="yOf(200) - 4" class="chart-refline-text" font-size="10">200% 两倍血量</text>

          <!-- 坐标轴标签 -->
          <text :x="padL + plotW / 2" :y="padT + plotH + 34" text-anchor="middle" class="chart-axis-label" font-size="11">操作难度（交互加权 + 时间压力）</text>
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

        <!-- 图例（点击显隐该队；隐藏的队同时退出坐标轴与明细表） -->
        <ChartLegend
          :items="scatterLegendItems"
          :color-of="colorOf"
          :is-visible="scatterLegend.isVisible"
          :hint="'点图例显隐 · ' + scatterCounts.visible + '/' + scatterCounts.total"
          show-all
          @toggle="scatterLegend.toggle"
          @show-all="scatterLegend.showAll"
        />

        <!-- 第三轴图例（主C首池时间档；只在开启着色时显示，避免与队伍图例抢注意力） -->
        <div v-if="colorByRelease" class="chart-legend time-legend">
          <span class="legend-hint">第三轴 · 主C首池时间（冷 = 早 / 暖 = 晚，点越大越新）</span>
          <span
            v-for="(r, i) in timeLegend" :key="'tl' + i"
            class="lchip" :title="r.title"
          >
            <span class="ldot" :style="{ background: r.color }"></span>{{ r.label }}（{{ r.count }} 队）
          </span>
        </div>
      </div>
    </n-card>

    <!-- 明细表（跟随图例筛选：隐藏的队不出行） -->
    <n-card v-if="chartMode === 'scatter' && points.length > 0" size="small" :bordered="true" class="detail-card">
      <template #header>明细（{{ visiblePoints.length }}/{{ points.length }} 点）</template>
      <ChartTable :columns="scatterTableColumns" table-class="detail-table chart-table-nowrap" align="right" dense>
            <tr v-for="(p, i) in visiblePoints" :key="i" :class="{ 'time-warn': p.timeExceeded }">
              <td class="td-team" :style="{ color: colorOf(p.presetId) }">{{ p.presetName }}</td>
              <td>
                {{ p.goldLabel }}
                <div v-if="p.standardGoldLabel" class="td-standard">{{ p.standardGoldLabel }}</div>
              </td>
              <td class="td-buff">{{ p.buffTitle || '—' }}</td>
              <td>{{ compact(p.damage) }}</td>
              <td :class="{ kill: p.hpRatio >= 100 }">{{ fmt(p.hpRatio, 1) }}%<template v-if="p.hpRatio > 100"><div class="kill-time">≈{{ killSeconds(p.hpRatio) }}s 击杀</div></template></td>
              <td>{{ fmt(p.difficulty, 1) }}</td>
              <!-- 交互明细：复用既有 `.cell-clamp`（max-width 300px + 换行）——不钳制时该列按最长
                   明细撑到 ~1874px，把 10 列表格拉出横向滚动条（ui-check 判「表格横向溢出」）。
                   2026-09-20 实机点通发现；明细文本随难度项增加会继续变长，故按列钳制而不是删内容。 -->
              <td class="td-detail"><div class="cell-clamp">{{ p.difficultyDetail }}</div></td>
              <td>{{ p.cinemas.join('/') }}</td>
              <td>{{ p.wengineMods.join('/') }}</td>
              <td :class="{ 'time-ok': !p.timeExceeded, 'time-exceeded': p.timeExceeded }">{{ p.timeDetail }}</td>
            </tr>
      </ChartTable>
    </n-card>

    <!-- 同金分配对比（用户 2026-09-14：「同队的不同武器、命座等金数对比」） -->
    <n-card
      v-if="chartMode === 'scatter' && showGoldAlternatives && goldAltRows.length > 0"
      size="small" :bordered="true" class="detail-card"
    >
      <template #header>同金分配对比（同一支队、同一个金数，这笔金投给谁）</template>
      <div class="compare-note">
        贪婪搜索每档会试算**全部**候选（各槽位的下一级影画/精炼/专武本体），此表把被淘汰的也列出来。
        「代价」= 相对该档最优分配的伤害损失（列内按损失升序，★ = 贪婪实际选中的那个）。
      </div>
      <ChartTable :columns="goldAltTableColumns" table-class="detail-table chart-table-nowrap" align="right" dense>
            <tr v-for="(a, i) in goldAltRows" :key="'ga' + i" :class="{ 'ga-best': a.isBest }">
              <td class="td-team" :style="{ color: colorOf(a.presetId) }">{{ a.presetName }}</td>
              <td>{{ a.budgetGold }}金</td>
              <td>{{ a.step.label }}<span v-if="a.isBest"> ★</span></td>
              <td>{{ compact(a.damage) }}</td>
              <td :class="{ 'ga-loss': !a.isBest }">{{ a.isBest ? '— 最优' : '−' + fmt(a.lossPct, 2) + '%' }}</td>
              <td>{{ a.state.cinemas.join('/') }} 命 · 精炼 {{ a.state.wengineMods.join('/') }}</td>
            </tr>
      </ChartTable>
    </n-card>

    <!-- 难度曲线：每队自己的贪心提升路径（x = 自动算的操作难度，各队不对齐是特性） -->
    <n-card v-if="chartMode === 'curve' && curveData" size="small" :bordered="true" class="chart-card">
      <template #header>
        <div class="curve-head">
          <span>难度曲线（{{ curveData.series.length }} 队可见 · 每队自己的 x）</span>
          <n-radio-group v-model:value="curveView" size="small">
            <n-radio-button value="2d">2D 折线</n-radio-button>
            <n-radio-button value="3d">3D 版本轴</n-radio-button>
          </n-radio-group>
        </div>
      </template>
      <div class="compare-note curve-note">
        <b>口径 = 同一支队伍 · 同一个 Boss · 同一套配装</b>（预设基础档：0命1精 + 预设音擎/驱动盘/权重/交互 + 当前期数 Boss）
        ，<b>只让「操作难度」从全关爬到全开</b>——配置不参与曲线（金数提升/换装在散点图型与「角色兑现」看）。
        x = 该队<b>自动算的</b>操作难度<b>绝对值</b>（Σ交互次数×权重 + <b>时间压力秒</b>×权重；交互次数取这一档<b>实打</b>的次数，
        不是预设声明——联合策略调低弹刀、般岳补交互都会算进去；<b>时间压力 = 合轴抵扣掉的秒 + 硬溢出剩下的秒</b>——
        允许溢出一部分正是因为队友可以合轴，所以这是同一笔秒数、只挂一个权重；
        交互/时间压力权重都在「难度权重」弹层调），<b>与散点页横轴同一把尺</b>。
        y = 伤害/血量%。<b>各队起点/走向不齐是特性</b>：比形状（起点 / 斜率 / 天花板 / 提升倍数）；
        <b>虚线段 = 难度回落</b>：那一步的杠杆把交互次数/时间压力减掉了（难度降而伤害升 = 白拿的优化，贪心优先做），
        所以折线会往左走一段（V 型就是这么来的）。
        曲线只算<b>少量关键旋钮点</b>（<b>最低 / 刚好实现轴模式 / 重大进步 / 最高</b>）——旋钮只有两个：
        <b>操作难度</b>（交互次数，非纯收益 ⇒ 取最优分配）与<b>时间压力</b>（合轴吸收率，纯收益 ⇒ 拉满）。
        每点如实报<b>轴态</b>（完整轴 / 跳过 N 招 / 轴不可行 / —）：低难度达不到资源要求而弃轴或跳过招式，
        <b>标注没正常打完就行</b>；高难度到一定程度才打得完。每队约 3~4 秒。
      </div>
      <!-- 3D 版本轴（用户 2026-09-19）：x = 难度、深度 = 版本（预设里在变化的那个角色）、z = 伤害/血量% -->
      <div v-if="curveView === '3d'" class="chart-area">
        <div class="compare-note curve-note">
          <b>版本轴 = 预设队伍里在变化的那个角色</b>（缺省取变化最多的槽位：{{ slotName(versionAxis.defaultSlot) }}），
          同主 C 比不同击破手、同击破手比不同版本主 C 都用它；道序按角色 id 升序（≈ 发布序）。
          <template v-if="versionAxis.ambiguous">
            <b>多个槽位在变</b>（{{ versionAxis.varyingSlots.map(slotName).join(' / ') }}），可逐队指定当版本的角色：
          </template>
        </div>
        <div v-if="versionAxis.ambiguous" class="version-picks">
          <span v-for="lane in versionAxis.lanes" :key="lane.presetId" class="version-pick" :style="{ borderColor: colorOf(lane.presetId) }">
            <span class="ldot" :style="{ background: colorOf(lane.presetId) }"></span>{{ lane.name }}：
            <n-select
              :value="versionOverrides[lane.presetId] ?? versionAxis.defaultSlot"
              :options="versionSlotOptions(lane.presetId)"
              size="tiny"
              style="width: 150px"
              @update:value="v => setVersionOverride(lane.presetId, v)"
            />
          </span>
        </div>
        <div class="version-picks" style="margin-bottom: 4px">
          <span>z 口径：</span>
          <n-radio-group v-model:value="curveZMode" size="small">
            <n-radio-button value="percent">伤害/血量%（击杀线平面）</n-radio-button>
            <n-radio-button value="absolute">绝对伤害 + Boss 血量膨胀</n-radio-button>
          </n-radio-group>
          <span v-if="bossHpCurve.length === 0" style="opacity: 0.7">
            （{{ selectedBoss?.name }} 在当前版本道区间里没有血量记录——膨胀曲线不出，伤害仍可比）
          </span>
        </div>
        <div class="compare-note curve-note">
          <b>版本轴上的血量膨胀曲线</b>（用户 2026-10-13）：<b>虚线 + 垂面</b> = 选中 Boss 的血量剖面，
          横轴位置与各队版本道<b>同一坐标</b>，覆盖道位区间内的<b>每一个版本</b>（同一版本多期取平均；
          该 Boss 没上岗的版本折线跨空档直连，不插值）。两档 z 口径都用它当参考线：
          <b>伤害/血量%</b> 档 = 各版本血量 ÷ <b>当期血量</b>（= 血量膨胀指数，100% 就是当期那把共享尺）；
          <b>绝对伤害</b> 档 = 血量绝对值本身，与各队绝对伤害同一把尺（比的是伤害与血量谁涨得快）。
          位移虚线段 = 难度回落（与 2D 同语义）。
        </div>
        <DifficultyCurve3DChart
          :series="curveData.series"
          @pick="onCurve3dPick"
          :lanes="chart3dLanes"
          :cost-max="curveData.costMax"
          :ratio-max="curveViewport.y.max"
          :color-of="colorOf"
          :point-label="pointLabel"
          :axis-label="curveEnv ? '危局期数（环境：各期血量+buff）' : `版本（${slotName(versionAxis.defaultSlot)}）`"
          :z-mode="curveZMode"
          :abs-max="curveZAbsMax"
          :base-hp="selectedPhase?.hp ?? 0"
          :boss-curve="{ name: `${selectedBoss?.name ?? ''} 血量`, points: bossHpCurve }"
        />
      </div>
      <div v-else class="chart-area">
        <svg :viewBox="viewBox" class="compare-svg">
          <line v-for="(v, i) in curveYTicks" :key="'cyg' + i" :x1="padL" :y1="curveYOf(v)" :x2="padL + plotW" :y2="curveYOf(v)" class="chart-grid" />
          <text v-for="(v, i) in curveYTicks" :key="'cyt' + i" :x="padL - 6" :y="curveYOf(v) + 4" text-anchor="end" class="chart-tick" font-size="10">{{ v }}%</text>
          <line v-for="(t, i) in curveXTicks" :key="'cxg' + i" :x1="t.x" :y1="padT" :x2="t.x" :y2="padT + plotH" class="chart-grid-x" />
          <text v-for="(t, i) in curveXTicks" :key="'cxt' + i" :x="t.x" :y="padT + plotH + 16" text-anchor="middle" class="chart-tick" font-size="10">{{ t.label }}</text>

          <!-- 击杀线：**域内**就画实线；**域外**（数据只到几十%时为了不浪费纵向空间而抬出画面）
               就在顶边画一条带 ⤒ 的短标并写真实值——不许让它静默消失，也不许为它把数据压扁。 -->
          <template v-if="curveViewport.y.max >= 100">
            <line :x1="padL" :y1="curveYOf(100)" :x2="padL + plotW" :y2="curveYOf(100)" class="curve-kill-line time-exceeded" stroke-dasharray="6,4" opacity="0.8" />
            <text :x="padL + 4" :y="curveYOf(100) - 4" class="curve-kill-label time-exceeded" font-size="10">击杀线 100%</text>
          </template>
          <template v-else>
            <line :x1="padL" :y1="padT" :x2="padL + plotW" :y2="padT" class="curve-kill-line time-exceeded" stroke-dasharray="6,4" opacity="0.55" />
            <text :x="padL + 4" :y="padT + 12" class="curve-kill-label time-exceeded" font-size="10">击杀线 100% ⤒ 在画面之上（纵向已按数据缩放）</text>
          </template>

          <text :x="padL + plotW / 2" :y="padT + plotH + 34" text-anchor="middle" class="chart-axis-label" font-size="11">操作难度绝对值（交互加权 + 时间压力，与散点同尺）</text>
          <text :x="14" :y="padT + plotH / 2" text-anchor="middle" class="chart-axis-label" font-size="11" transform="rotate(-90 14 0)">伤害/血量 %</text>

          <!-- **X 轴断口**（用户 2026-10-25「跨度太大，大面积只是横线」）：
               只有真压过才画。断口画成两条斜线 + 「压掉 N 点」，读者一眼知道这段不是线性的。 -->
          <g v-if="curveViewport.x.breaks.length > 0" class="curve-x-breaks">
            <g v-for="(b, bi) in curveViewport.x.breaks" :key="'cxb' + bi">
              <line
                :x1="curveXOf(b.to) - 3" :y1="padT" :x2="curveXOf(b.to) + 3" :y2="padT + plotH"
                class="curve-x-break-line" stroke-width="1.4"
              />
              <text :x="curveXOf(b.from) + 4" :y="padT + plotH - 6" class="curve-x-break-label" font-size="9">
                ⇥ 压掉 {{ fmt(b.to - b.from, 0) }} 点
              </text>
            </g>
          </g>

          <g v-for="(s, si) in curveSeriesPx" :key="'cs' + si">
            <line
              v-for="(g, gi) in s.segs" :key="'cs' + si + '-' + gi"
              :x1="g.x1" :y1="g.y1" :x2="g.x2" :y2="g.y2"
              class="curve-seg"
              :stroke="s.color" :stroke-width="g.back ? 1.6 : 2" :opacity="g.back ? 0.7 : 0.9"
              :stroke-dasharray="g.back ? '4,3' : undefined"
            />
            <!-- 曲线点：**可点** ⇒ 下方展开该档资源池（用户 2026-10-16）。命中区比可见圆大
                 （r=3.5 太小点不中）：外包一层 r=9 的透明圆接指针事件。 -->
            <g v-for="(p, pi) in s.pts" :key="'cp' + si + '-' + pi">
              <!-- **轴态形状**（R10，用户 2026-10-16）：编码唯一事实源 = `axisMarker.ts#axisMarkerOf`。
                   ⚠ 用 `path` 而不是 `circle` + 派生 `fill`：SVG 呈现属性（`fill`/`stroke` 属性）
                   会被任何类选择器压掉（见 UI_THEME_GUIDE §4），而**双色**（半实心）必须跨两个形状。
                   故这里把「实心/半实心/空心」都写成显式 path：颜色仍由队伍色 s.color 表达。 -->
              <path
                v-if="p.axisShape === 'solid'"
                :d="dotPath(p.cx, p.cy, 3.5)" :fill="s.color" opacity="0.9" class="scatter-dot"
              />
              <path
                v-else-if="p.axisShape === 'half'"
                :d="halfPath(p.cx, p.cy, 4)" :fill="s.color" opacity="0.9"
                class="scatter-dot scatter-axis-half" :style="{ stroke: s.color }"
              />
              <path
                v-else
                :d="dotPath(p.cx, p.cy, 3.5)" fill="none" :style="{ stroke: s.color }"
                class="scatter-dot scatter-axis-hollow" stroke-width="1.4"
              />
              <circle
                :cx="p.cx" :cy="p.cy" :r="9" fill="transparent"
                :class="{ 'curve-hit': canInspectPoint(p), 'curve-hit-on': curvePoolPick && curvePoolPick.laneKey === s.laneKey && curvePoolPick.point === p.point && curvePoolPick.cost === p.cost }"
                @mouseenter="curveHover = { si, pi }" @mouseleave="curveHover = null"
                @click="inspectCurvePoint(s.laneKey, p, 'point')"
              >
                <title>{{ `${s.label} · ${pointLabel(p.point)} · ${p.axisLegend}：点击查看该档资源池` }}</title>
              </circle>
            </g>
            <!-- **曲线外的补充点**（用户口径 2026-10-14「同 x 难度的不同 y，是难度曲线外面的
                 补充点」）：空心菱形 + 名称/Δ伤害小字。与曲线点（实心圆）**不同形状** ⇒ 一眼看出
                 「它在曲线外面」；不连线（它不在曲线上，只是同一难度上的另一个选择）。 -->
            <g v-for="(a, ai) in s.altPts" :key="'ca' + si + '-' + ai">
              <path
                class="curve-alt"
                :d="`M ${a.cx} ${a.cy - 5} L ${a.cx + 5} ${a.cy} L ${a.cx} ${a.cy + 5} L ${a.cx - 5} ${a.cy} Z`"
                fill="none" :stroke="a.color" stroke-width="1.6" opacity="0.95"
              />
              <text :x="a.cx" :y="a.cy + 15" text-anchor="middle" class="curve-jump-label curve-alt-label" font-size="9">{{ a.text }}</text>
            </g>
            <!-- **非轴参照点**（用户口径 2026-10-16：「我本意是想展示**非轴模式**的数据的，
                 表示**模拟均匀战斗**而不是集中利用失衡易伤」）：
                 灰色空心小圆 + 虚线连线 —— 表示「同一支队关掉轴、易伤按时间均匀摊」时的走法。
                 与曲线（实心圆 + 实线，集中利用失衡易伤）形状与线型都不同，一眼可分。 -->
            <template v-if="s.noAxisPts.length > 1">
              <line
                v-for="(p, pi) in s.noAxisPts.slice(1)" :key="'cna-l' + si + '-' + pi"
                :x1="s.noAxisPts[pi]!.cx" :y1="s.noAxisPts[pi]!.cy"
                :x2="p.cx" :y2="p.cy"
                class="curve-noaxis-seg" stroke-width="1.2"
              />
            </template>
            <circle
              v-for="(p, pi) in s.noAxisPts" :key="'cna' + si + '-' + pi"
              :cx="p.cx" :cy="p.cy" r="2.5" fill="none"
              class="curve-noaxis-dot" stroke-width="1.2"
            >
              <title>{{ `${s.label} · 非轴参照（关掉轴、易伤按时间均匀摊）：难度 ${fmt(p.cost, 1)} · 伤害 ${compact(p.dmg)}（${fmt(p.ratio, 1)}%）` }}</title>
            </circle>
            <!-- 关键次数跃迁标注（「多了一次」量级）：加一圈 + 点上方文字 -->
            <g v-for="(j, ji) in s.jumpPts" :key="'cj' + si + '-' + ji">
              <circle :cx="j.cx" :cy="j.cy" r="6.5" fill="none" :stroke="s.color" stroke-width="1.2" opacity="0.85" />
              <text
                v-if="j.labeled" :x="j.cx" :y="j.cy - 11 - j.lane * 15"
                text-anchor="middle" class="curve-jump-label" font-size="9"
              >{{ j.text }}</text>
            </g>
            <!-- **被轴砍掉的档**（R10，用户 2026-10-16「4 失衡但某些招式没打出来」）：
                 画在曲线**下方**、不连线、**打叉**。与上面的截断方框（交互被时间线砍）是两回事：
                 那个是「打了但砍短」，这个是「整档不成立」（`axisRequirementMet` 为假）。
                 可点 ⇒ 展开该档资源池（与被砍档同一条 `inspectCurvePoint` 链）。 -->
            <g v-for="(c, ci) in s.cutPts" :key="'cc' + si + '-' + ci">
              <path
                :d="crossPath(c.cx, c.cy, 3.2)" fill="none" :style="{ stroke: s.color }"
                class="scatter-dot curve-axis-cut" stroke-width="1.3" opacity="0.75"
                @mouseenter="cutHover = { si, ci }" @mouseleave="cutHover = null"
                @click="inspectCurvePoint(s.laneKey, c as unknown as CurveDatum, 'axisTruncated', c.reason)"
              >
                <title>{{ `${s.label} · ${pointLabel(c.point)} · 轴态：${c.legend}：点击查看该档资源池` }}</title>
              </path>
            </g>
            <!-- 截断提醒（用户 2026-10-06）：这一档交互被砍 ⇒ 空心方框 + 「还差 N 次」小字。
                 与跃迁标注（圆环 + 文字）用**不同形状**区分，且文字走同一套分道/碰撞剔除防重叠。 -->
            <g v-for="(t, ti) in s.truncPts" :key="'ct' + si + '-' + ti">
              <rect
                :x="t.cx - 4" :y="t.cy - 4" width="8" height="8" rx="1"
                fill="none" :stroke="s.color" stroke-width="1.3" stroke-dasharray="2,1.5" opacity="0.95"
              />
              <text
                v-if="t.labeled" :x="t.cx" :y="t.cy - 11 - t.lane * 15"
                text-anchor="middle" class="curve-trunc-label" font-size="9"
              >{{ t.text }}</text>
            </g>
          </g>

          <g v-if="curveHoverPt">
            <rect :x="curveTtX" :y="curveTtY" :width="curveTtW + 8" :height="curveTtH + 8" rx="3" class="chart-tooltip-box" />
            <text v-for="(line, li) in curveHoverTips" :key="'ctt' + li" :x="curveTtX + 4" :y="curveTtY + 13 + li * 13" class="chart-tooltip-text" font-size="10">{{ line }}</text>
          </g>
        </svg>

        <!-- 图例（点击显隐该队曲线；隐藏的队同时退出坐标轴与两张明细表） -->
        <div class="chart-legend">
          <span class="legend-hint">
            实心圆 = <b>轴模式</b>（失衡易伤集中在轴内高倍率招式）｜
            灰色空心圆 + 虚线 = <b>非轴参照</b>（同一支队关掉轴）——
            <template v-if="noAxisVulnShare != null">
              当前口径：<b>你填的易伤贡献率 {{ Math.round(noAxisVulnShare * 100) }}%</b>（非轴不自动认领；
              <template v-if="noAxisVulnShare < 1">低于 100% = 你认为只兑现了这么多失衡易伤</template>
              <template v-else>100% = 每招按同一比例吃易伤，完全均匀摊</template>）
            </template>
          </span>
          <!-- **轴态图例**（R10，用户 2026-10-16「不知道是无轴 / 完整 4 失衡 / 还是某些招式没打出来」）：
               编码 = 填充形状（不是颜色——颜色已被队伍身份色占用，且同队四点同色）⟹ 双主题 + 色盲都可分。 -->
          <span class="legend-hint curve-axis-legend">
            <b>轴态</b>（形状 = 轴态，颜色仍 = 队伍）：
            <span v-for="(lg, li) in axisLegend" :key="'ax' + li" class="curve-axis-legend-item">
              <svg class="curve-axis-legend-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path v-if="lg.shape === 'solid'" :d="dotPath(8, 8, 4)" class="curve-axis-legend-shape" />
                <template v-else-if="lg.shape === 'half'">
                  <path :d="halfPath(8, 8, 4.5)" class="curve-axis-legend-shape" />
                  <path :d="dotPath(8, 8, 4.5)" fill="none" class="curve-axis-legend-ring" />
                </template>
                <path v-else-if="lg.shape === 'hollow'" :d="dotPath(8, 8, 4)" fill="none" class="curve-axis-legend-ring" />
                <path v-else :d="crossPath(8, 8, 4)" fill="none" class="curve-axis-legend-ring" />
              </svg>
              {{ lg.legend }}<template v-if="lg.onCurve === 'below'">（画在曲线<b>下方</b>、不连线）</template>
            </span>
          </span>
          <span class="legend-hint">
            <b>失衡进度</b>（tooltip）＝ 离下一次完整失衡还差多少失衡值：
            没攒满的那一窗<b>不算易伤</b>（易伤只在完整失衡窗里生效），
            所以它是「再加点配置/交互就能到完整下一档」的提示，不是伤害来源。
          </span>
        </div>
        <ChartLegend
          :items="curveLegendItems"
          :color-of="colorOf"
          :is-visible="curveLegend.isVisible"
          :hint="'点图例显隐 · ' + curveCounts.visible + '/' + curveCounts.total"
          show-all
          @toggle="curveLegend.toggle"
          @show-all="curveLegend.showAll"
        />
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
        「伤害归因（相对上一档）」列 = <b>本档伤害 − 上一档伤害</b>的精确拆分：先列涨得最多的来源，「挤掉」= 跌得最多的，
        「其余」= 剩下全部，三段合计 ≡「伤害」列下方的 Δ。
        <b>「挤掉」来自交互重分配，不是合轴吸收</b>：两个旋钮要分开看——
        <b>合轴吸收（时间旋钮）不会少打</b>，它是<b>提高队友合轴率、让多余的招式不再被截断而是正确打出来</b>
        （实测只抬吸收：伤害大涨、合轴节省 0 → 70s 量级、弃轴转为不弃轴，真少打 ≈ 0）；
        <b>交互取最优（操作旋钮）</b>才会减少低效交互——它按伤害边际重排「哪些招式值得打」，
        被砍掉的是性价比低的那部分（实测大招/紊乱各减，同时强特/角色专属资源增）。
        所以每一点都是<b>有涨有跌、净额为正</b>。
      </div>
      <ChartTable :columns="curveJumpTableColumns" table-class="detail-table chart-table-nowrap" align="right" dense>
            <tr v-for="r in curveJumpRows" :key="r.key">
              <td class="td-team" :style="{ color: r.color }">{{ r.team }}</td>
              <td>{{ fmt(r.cost, 0) }} 点</td>
              <td class="td-detail">{{ pointLabel(r.point) }}</td>
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
      </ChartTable>
    </n-card>

    <!-- 截断提醒板块：交互被砍的档，「要达到手填的交互要求至少需要多少难度」（用户 2026-10-06 口径） -->
    <n-card v-if="chartMode === 'curve' && curveData" size="small" :bordered="true" class="detail-card">
      <template #header>截断提醒（{{ curveTruncRows.length }} 档交互被砍，不含全关起点）</template>
      <div class="compare-note">
        只列<b>交互被砍</b>的爬梯档（本档配置的 N 次 → 实打少于 N，<b>或</b>时间线截断 &gt; 1s）：引擎在装不下时会
        <b>降配缩交互</b>或<b>砍招式行</b>（时间截断），两种都让这一档打不出它配置的次数。
        <b>全关起点不进表</b>：它是曲线的基准（杠杆全关 + 预设声明的交互），不是往上爬的某一档，与爬梯档没有可比性。
        「达标所需难度」= <b>沿这条曲线继续往上爬，第一个能把这 N 次真打出来的档的操作难度</b>；
        <b>曲线内无法达到</b> = 整条曲线都兑现不了这个要求（面板同时给出曲线最多能打到几次，不编造数字）。
        ⚠ 这是<b>提示不是保证</b>：它说的是「这条曲线自己的档位里有没有达标档」，不代表那个难度一定打得出来
        （x 不单调，详见上方口径说明）。
      </div>
      <ChartTable :columns="curveTruncTableColumns" table-class="detail-table chart-table-nowrap" align="right" dense>
            <tr v-for="r in curveTruncRows" :key="r.key">
              <td class="td-team" :style="{ color: r.color }">{{ r.team }}</td>
              <td>{{ fmt(r.cost, 0) }} 点</td>
              <td class="td-detail">{{ pointLabel(r.point) }}</td>
              <td>{{ cntNum(r.hint.filled) }} → {{ cntNum(r.hint.played) }}</td>
              <td class="curve-neg">
                少 {{ cntNum(r.hint.cut) }} 次<template v-if="r.hint.overflow > 1"><br>截断 {{ fmt(r.hint.overflow, 1) }}s</template>
              </td>
              <td>
                <template v-if="r.hint.neededX !== null">≈ {{ fmt(r.hint.neededX, 0) }} 点</template>
                <template v-else><span class="curve-neg">曲线内无法达到</span><div class="td-standard">最多 {{ cntNum(r.hint.maxPlayed ?? 0) }} 次</div></template>
              </td>
            </tr>
            <tr v-for="b in curveTruncBaseOnly" :key="b.key">
              <td class="td-team" :style="{ color: b.color }">{{ b.team }}</td>
              <td colspan="5" class="td-detail">
                只有全关起点被砍（本档交互 {{ cntNum(b.hint.filled) }} → 实打 {{ cntNum(b.hint.played) }} 次<template v-if="b.hint.overflow > 1">，截断 {{ fmt(b.hint.overflow, 1) }}s</template>）：
                起点是曲线基准、不进表；往上爬的各档都足量交付本档配置的交互，没有可对照的被砍档。
              </td>
            </tr>
            <tr v-if="curveTruncRows.length === 0 && curveTruncBaseOnly.length === 0">
              <td colspan="6" class="td-detail">
                本次曲线每一档的交互都足量交付（没有降配缩交互、也没有时间截断）——每一档配置的交互次数都打出来了。
              </td>
            </tr>
      </ChartTable>
    </n-card>

    <!-- 逐点资源池明细（用户 2026-10-16）：点曲线上的点 ⇒ 该档的完整资源池 -->
    <n-card v-if="chartMode === 'curve' && curvePoolPick" size="small" :bordered="true" class="detail-card">
      <template #header>
        <div class="curve-head">
          <span>
            该档资源池 · {{ pointLabel(curvePoolPick.point) }} · 操作难度 {{ fmt(curvePoolPick.cost, 1) }} 点
            <span class="td-muted">（{{ curvePoolPick.laneKey }}）</span>
          </span>
          <n-button size="tiny" @click="curvePoolPick = null; curvePool.clear()">收起</n-button>
        </div>
      </template>
      <div class="compare-note curve-note">
        <b>口径 = 那一点的现场重放</b>（不是全关档、也不是终点档）：面板把该点采到的现场差分写回一个独立场景
        （<code>restoreStateDelta</code>）再算一次 ⇒ <b>伤害与该点读数逐位相等</b>（判据 <code>curvePointPool.test.ts</code>）。
        所以这里的三张资源卡 = <b>曲线该档的资源池</b>：能量/喧响/失衡/积蓄与招式执行计划都按那一档的交互与吸收率算。
        <template v-if="curvePoolPickReason">
          <br>⚠ <b>这一档轴没打完</b>（{{ curvePoolPickReason }}）⇒ 它<b>不在曲线上</b>（按你的口径「达不到要求就不算」），
          但引擎算过的数如实给出来，用来看「差在哪」。
        </template>
      </div>
      <div v-if="curvePoolChangedKeys.length > 0" class="compare-note curve-note">
        这一档相对曲线起点的<b>输入变动</b>：{{ curvePoolChangedKeys.map(stateKeyLabel).join('、') }}
        <span class="td-muted">（面板重算用的就是这份差分；判据 `curvePointPool.test.ts` 断言重算伤害与该点读数逐位相等）</span>
      </div>
      <div v-if="curvePool.loading.value" class="empty-hint">重算该档资源池中…</div>
      <div v-else-if="curvePool.error.value" class="empty-hint curve-neg">重算失败：{{ curvePool.error.value }}</div>
      <template v-else-if="curvePool.pool.value">
        <template v-if="curvePool.pool.value">
        <!-- **这一档的轴**（R10 第 2 条）：逐条列出轴内动作 / 被跳过的招 + 原因 + 打出来的次数。
             数据全部来自引擎读数（`axisDetailOf` 只做分组，不重算判定）。 -->
        <div class="curve-axis-detail">
          <div class="curve-axis-title">
            这一档的轴 · <b>{{ curveAxisDetail.title }}</b>
            <span class="td-muted">（{{ curveAxisDetail.note }}）</span>
          </div>
          <!-- **交互 / 合轴并排**（R10 第 3 条：用户要「对照交互和合轴率看能不能优化」）。
               缺省写「—」并带原因，**不写 0**（0 是测到 0，null 是没测）。 -->
          <div class="curve-axis-compare">
            <span>
              交互 手填 <b>{{ curveAxisCompare.interactionsFilled ?? '—' }}</b>
              / 实打 <b>{{ curveAxisCompare.interactionsPlayed ?? '—' }}</b>
              <span v-if="curveAxisCompare.nullReason.interactionsFilled" class="td-muted">（{{ curveAxisCompare.nullReason.interactionsFilled }}）</span>
            </span>
            <span>
              合轴吸收 <b>{{ curveAxisCompare.absorb === null ? '—' : fmt(curveAxisCompare.absorb * 100, 0) + '%' }}</b>
              <span v-if="curveAxisCompare.nullReason.absorb" class="td-muted">（{{ curveAxisCompare.nullReason.absorb }}）</span>
            </span>
            <span>
              合轴节省 <b>{{ curveAxisCompare.overlapSeconds === null ? '—' : fmt(curveAxisCompare.overlapSeconds, 2) + 's' }}</b>
              <span v-if="curveAxisCompare.nullReason.overlapSeconds" class="td-muted">（{{ curveAxisCompare.nullReason.overlapSeconds }}）</span>
            </span>
          </div>
          <div v-if="curveAxisDetail.skipTotals.length > 0" class="curve-axis-skips">
            跳过原因：
            <span v-for="(t, ti) in curveAxisDetail.skipTotals" :key="t.reason" class="curve-axis-skip-tag">
              {{ t.text }} <b>{{ t.count }}</b> 招<template v-if="ti < curveAxisDetail.skipTotals.length - 1">、</template>
            </span>
          </div>
          <div v-if="curveAxisDetail.skipped.length > 0" class="curve-axis-list">
            <div class="td-muted">被跳过的动作（{{ curveAxisDetail.skipped.length }} 条）</div>
            <div v-for="(k, ki) in curveAxisDetail.skipped" :key="'sk' + ki" class="curve-axis-row curve-axis-row-skip">
              <span class="curve-axis-slot">{{ slotLabels[k.slot] ?? (k.slot + 1) + ' 号位' }}</span>
              <span class="curve-axis-move">{{ k.name }}</span>
              <span class="curve-axis-reason">{{ k.reasonText }}</span>
            </div>
          </div>
          <div v-if="curveAxisDetail.executed.length > 0" class="curve-axis-list">
            <div class="td-muted">轴内实际执行（{{ curveAxisDetail.executed.length }} 条）</div>
            <div v-for="(e, ei) in curveAxisDetail.executed" :key="'ex' + ei" class="curve-axis-row">
              <span class="curve-axis-slot">{{ slotLabels[e.slot] ?? (e.slot + 1) + ' 号位' }}</span>
              <span class="curve-axis-move">{{ e.name }}</span>
              <span class="curve-axis-count">{{ fmt(e.count, 2) }} 次<template v-if="Math.abs(e.inAxisCount - e.count) > 1e-9">（窗内 {{ fmt(e.inAxisCount, 2) }}）</template></span>
            </div>
          </div>
          <div v-else-if="curveAxisDetail.kind !== 'none'" class="empty-hint">
            引擎这一档没有执行任何轴内动作（轴被弃或全被门控掉）——如实为空，不补造。
          </div>
        </div>
        </template>
        <div class="compare-note curve-note">
          总伤害 {{ compact(curvePool.pool.value.damage) }} · 迭代 {{ curvePool.pool.value.resourceResult.iterations }} 次
          {{ curvePool.pool.value.resourceResult.converged ? '·已收敛' : '·未收敛' }}
          · 失衡 {{ curvePool.pool.value.stunPool?.stunCount ?? 0 }} 次
          · 连携 {{ curvePool.pool.value.stunPool?.chainCountTotal ?? 0 }} 次
          · 重算耗时 {{ fmt(curvePool.pool.value.ms, 0) }}ms
        </div>
        <div class="resource-cards">
          <ResourceResultCard
            v-for="c in curvePool.pool.value.resourceResult.characters"
            :key="c.slot"
            :result="c"
            :agent-name="agentNameOf(c.agentId) || c.agentName || c.agentId"
            :specialty="specialtyOf(c.agentId)"
            :stun-pool-result="curvePool.pool.value.stunPool"
            :stun-discrete-label="compareStunDiscrete?.label ?? null"
            :anomaly-pool-result="curvePool.pool.value.anomalyPool"
            :total-time="curvePool.pool.value.resourceResult.totalTime"
          />
        </div>
      </template>
      <div v-else class="empty-hint">该档未采现场（本次曲线没有带现场差分）⇒ 不显示资源池，也不编数据。</div>
    </n-card>

    <!-- 曲线摘要表：难易强度对比看这几列 -->
    <n-card v-if="chartMode === 'curve' && curveData" size="small" :bordered="true" class="detail-card">
      <template #header>
        曲线摘要（{{ curveData.series.length }} 条道可见<template v-if="curveRowsStale"> · <span style="color: var(--c-warning)">环境设置已改，需重算</span></template>）
      </template>
      <ChartTable :columns="curveSummaryColumns" table-class="detail-table chart-table-nowrap" align="right" dense>
            <tr v-for="s in curveData.series" :key="s.laneKey" :class="{ 'curve-flat': s.flat }">
              <td class="td-team" :style="{ color: colorOf(s.presetId) }">{{ s.name }}</td>
              <td v-if="curveRowsHavePeriod" class="td-muted">{{ s.periodLabel || '—' }}</td>
              <td v-if="curveRowsHavePeriod" class="td-muted">{{ (s.hp / 1e6).toFixed(0) }}M</td>
              <td>{{ compact(s.base) }}</td>
              <td>{{ compact(s.final) }}</td>
              <td :class="{ kill: s.gainPct > 0 }">+{{ fmt(s.gainPct, 1) }}%</td>
              <td>{{ fmt(s.gainX, 2) }}×</td>
              <td>{{ fmt(s.totalCost, 0) }} 点</td>
              <td>{{ fmt(s.slope, 1) }}%/点</td>
              <td class="td-detail"><div class="cell-clamp">{{ s.flat ? '无优化空间' : s.steps.map(pointLabel).join(' → ') }}</div></td>
              <td class="td-detail"><div class="cell-clamp">{{ axisColumnText(s) }}</div></td>
              <td v-if="curveHasLimitPoints" class="td-detail">
                <div class="cell-clamp">
                  <template v-if="s.limitPoint">
                    <!-- 极限点（用户口径 2026-10-14「自动上调合轴率只为算一个特殊值」）：
                         达成 ⇒ 报「吸收率 / 杠杆 / 伤害」；未达成 ⇒ 如实说「最多推到 N」。 -->
                    <template v-if="s.limitPoint.found">
                      {{ s.limitPoint.name }}：吸收 {{ (s.limitPoint.absorb! * 100).toFixed(0) }}%
                      <template v-if="Object.keys(s.limitPoint.levers).length > 0">、{{ limitLeverText(s.limitPoint.levers) }}</template>
                      → {{ compact(s.limitPoint.dmg ?? 0) }}
                    </template>
                    <template v-else>{{ s.limitPoint.name }}：最高 {{ s.limitPoint.bestTarget }}/{{ s.limitPoint.targetValue }}（未达成）</template>
                  </template>
                  <template v-else>—</template>
                </div>
              </td>
              <td v-if="curveHasAltPoints" class="td-detail">
                <div class="cell-clamp">
                  <template v-if="s.altPoints.length > 0">
                    <!-- 曲线外补充点（「同 x 不同 y」）：名称 + 与 ④ 的伤害差 -->
                    <span v-for="(a, ai) in s.altPoints" :key="a.id">
                      <template v-if="ai > 0">、</template>
                      {{ a.name }} {{ signedDmg(a.gainVsCurve) }}
                    </span>
                  </template>
                  <template v-else>—</template>
                </div>
              </td>
            </tr>
      </ChartTable>
    </n-card>
    <!-- 选第三人排名表：固定 2 队友下，第三人候选按伤害排名（背景条 = 伤害占比） -->
    <!-- 命座提升率网格（用户 2026-10-20：图表类单独给一个，N×M 格 = Boss × 环境 buff） -->
    <n-card v-if="chartMode === 'uplift'" size="small" :bordered="true" class="detail-card">
      <template #header>
        命座提升率网格
        <span class="td-muted">
          · {{ selectedPresets[0]?.name ?? '（未选队伍）' }} · {{ slotLabels[upliftSlot] ?? '' }}
          · C0→C{{ upliftMaxLevel }} 累计
          · 期数 {{ upliftPhaseView?.label || selectedPeriodId || '（未选）' }}
        </span>
      </template>
      <!-- 前置条件不满足时的如实提示（原来这些是静默 return，点按钮毫无反应） -->
      <div v-if="upliftHint" class="empty-hint guide-hint uplift-hint">{{ upliftHint }}</div>
      <!-- 期数没有可选牌时的如实提示（2026-10-20：最新 3.3 期的牌全是 (Test1)TBD 占位牌） -->
      <div v-if="upliftUsableCards.length === 0" class="empty-hint guide-hint">
        当前期数「{{ upliftPhaseView?.label || selectedPeriodId }}」<b>没有可用的环境 buff 牌</b>
        <template v-if="upliftPhaseView">（{{ upliftPhaseView.buffs.length }} 张全是测试服占位牌 `(Test1)TBD`）</template>
        ⇒ 网格只会有一列「不吃 buff」。想看吃 buff 的对比，把顶部「期数」切到有正式牌的那一期
        （例如 3.2 或更早）。
      </div>
      <div v-if="!upliftResult" class="td-muted">
        选一队 → 点「计算提升率网格」。行 = <b>当前期数</b>里出现过的 Boss，列 = <b>同一期</b>的可选 buff 牌
        （首列恒「不吃」）。每格跑 <b>{{ upliftMaxLevel + 1 }}</b> 次全量求值（锁口径）；
        勾「含失衡通道」再翻一倍，用来量「不锁失衡次数时命座多拿的收益」。
      </div>
      <div v-else class="uplift-grid-wrap">
        <!--
          锁值横幅（用户 2026-10-20「怕误解就改 ui」）：把锁值从**单元格**提到**表头**。
          原来每格都写「锁 N 窗」，读者会以为那是独立参数、进而横向比较不同锁值下的数字 —— 而
          整数台阶型命座（克拉蕾 C1 残痕效率 +20%，层数 = floor(积蓄/层)）在锁 5 / 锁 6 下差 6 倍
          （实测 42.7% vs 7.0%）。锁值是**整把尺子**，必须一眼看出全表用的是不是同一把。
        -->
        <div class="uplift-lock-banner" :class="upliftLockUniform ? 'lock-uniform' : 'lock-mixed'">
          <template v-if="upliftLockUniform">
            <b>全表统一锁 {{ upliftLockValue }} 窗</b>
            <span class="lock-hint">同一把尺子 ⇒ 各行可直接横向比较</span>
          </template>
          <template v-else>
            <b>⚠ 逐行锁值不同（{{ upliftLockSummary }}）</b>
            <span class="lock-hint">锁值不同 ⇒ <b>不同行之间不可直接比</b>；要比请切「锁值 = 整表统一」</span>
          </template>
        </div>
        <table class="uplift-grid">
          <thead>
            <tr>
              <th class="th-corner">Boss</th>
              <th class="th-lock">锁值</th>
              <th v-for="label in upliftResult.colLabels" :key="label">{{ label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in upliftGrid" :key="row.label">
              <td class="th-row">{{ row.label }}</td>
              <td class="th-lock">{{ row.lock ?? '—' }}</td>
              <td v-for="(cell, ci) in row.cells" :key="ci" class="uplift-cell">
                <template v-if="cell">
                  <div class="cell-total">{{ signed1(cell.lockedTotalPct) }}%</div>
                  <div v-if="cell.freeTotalPct != null" class="cell-sub">
                    不锁 {{ signed1(cell.freeTotalPct) }}%
                  </div>
                  <div v-if="cell.stunChannelDeltaPct != null" class="cell-delta" :class="upliftCellClass(cell.stunChannelDeltaPct)">
                    失衡通道 {{ signed1(cell.stunChannelDeltaPct) }}pp
                  </div>
                  <!-- **成本轴**（B7 用户 2026-10-20「现在只有收益没有消耗」）：每级命座恒 1 金，
                       故「每金」= 逐级提升率；累计每金与逐级平均**不等**（复利 vs 算术，见 cinemaUpliftCost 头注释）。 -->
                  <div class="cell-pergold" :title="`每金收益：累计 ${cellCost(cell).perGoldTotalPct?.toFixed(2) ?? '—'}% / 金（共 ${cellCost(cell).totalGold} 金）；逐级平均 ${cellCost(cell).perGoldMeanPct?.toFixed(2) ?? '—'}% / 金`">
                    每金 {{ cellCost(cell).perGoldTotalPct == null ? '—' : signed1(cellCost(cell).perGoldTotalPct!) }}
                    <span v-if="cellCost(cell).best" class="cell-pergold-best">
                      · 最划算 C{{ cellCost(cell).best!.level }}
                    </span>
                  </div>
                  <div class="cell-steps">
                    <span v-for="e in cell.lockedEntries" :key="e.to" class="cell-step" :title="`C${e.to - 1}→C${e.to}：${e.gainPct.toFixed(2)}%（${GOLD_PER_CINEMA_LEVEL} 金 ⇒ 每金 ${e.gainPct.toFixed(2)}%）`">
                      {{ signed1(e.gainPct) }}
                    </span>
                  </div>
                </template>
                <span v-else class="td-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="td-muted grid-note">
          <b>锁 N</b> = {{ upliftLockMode === 'grid' ? '整张表统一（取第一行不吃 buff 的 C0 基线）' : '每行各自（取该行不吃 buff 的 C0 基线）' }}
          —— 单格内 C0→C6 恒用它，这样「命座让失衡次数变多」这条价值不会被重复计入。
          <b>失衡通道</b> = 不锁累计 − 锁累计（正 = 不锁时命座从失衡次数/攒条上多拿了收益）。
          <b>每金</b> = 累计提升率 ÷ 总金数（每级命座恒 1 金，见 <code>goldSteps</code> 口径）；
          「最划算 C{n}」= 逐级里每金收益最高那一级——因为累计每金是**复利**口径，与逐级算术平均不等，两个都要看。
          <br>
          <b>⚠ 整数台阶型命座会对锁值跳变</b>：如克拉蕾 C1「残痕积蓄效率 +20%」，
          层数 = floor(积蓄/每层) ⇒ +20% 是否跨过整数边界取决于基线在哪。
          实测同一队锁 5 窗 C1 增益 42.7%、锁 6 窗只有 7.0%——<b>这是真实的台阶效应，不是算错</b>。
          要比不同 Boss 时请用「整表统一」锁值。
        </div>
      </div>
    </n-card>

    <n-card v-if="chartMode === 'sweep' && sweepResult" size="small" :bordered="true" class="detail-card">
      <template #header>
        第三人对比（固定 {{ agentNameOf(sweepResult.fixed[0]) }} + {{ agentNameOf(sweepResult.fixed[1]) }} ·
        {{ slotLabels[sweepResult.slot] }} · {{ sweepResult.points.length }} 名候选<template v-if="sweepResult.skipped > 0"> · 跳过未收敛 {{ sweepResult.skipped }}</template>）
      </template>
      <div class="compare-note">
        候选范围：{{ sweepSpecLabel }}<template v-if="sweepCandidateSel.length > 0">（手选 {{ sweepCandidateSel.length }} 名）</template>。
        同一 Boss / 期数 / 限定金预算（{{ sweepBudget }}金）下逐候选求值（{{ sweepOptimalGold ? '逐金贪婪最优加金' : '主C优先确定性分配' }}）；
        按伤害降序，名字条长度 = 相对第 1 名的伤害占比。不含当期 buff / 自动下位；各队总金可能低于预算（低于基础金时钳制）。
      </div>
      <ChartTable :columns="sweepTableColumns" table-class="detail-table chart-table-nowrap" align="right" dense>
            <tr v-for="(p, i) in sweepResult.points" :key="p.candidateId" class="sweep-row">
              <td>{{ i + 1 }}</td>
              <td
                class="td-team sweep-name"
                :style="{ background: `linear-gradient(90deg, rgba(99,226,183,0.16) ${sweepBarPct(p.damage)}%, transparent ${sweepBarPct(p.damage)}%)` }"
              >{{ p.candidateName }}</td>
              <td>{{ compact(p.damage) }}</td>
              <td :class="{ kill: p.hpRatio >= 100 }">{{ fmt(p.hpRatio, 1) }}%<template v-if="p.hpRatio > 100"><div class="kill-time">≈{{ killSeconds(p.hpRatio) }}s 击杀</div></template></td>
              <td>{{ p.totalGold }}</td>
              <td class="td-detail"><div class="cell-clamp">{{ goldDetail(p.goldLabel) }}</div></td>
              <td class="td-detail">{{ teamNames(p.team) }}</td>
            </tr>
            <tr v-if="sweepResult.points.length === 0">
              <td colspan="7" class="td-detail">没有可用候选：全部未收敛或候选池为空（检查固定队友选择）。</td>
            </tr>
      </ChartTable>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NCard, NSelect, NInputNumber, NButton, NCheckbox, NInput, NPopover, NRadioGroup, NRadioButton } from 'naive-ui'
import DifficultyCurve3DChart from '@/components/charts/DifficultyCurve3DChart.vue'
import { buildBossHpCurve, buildEnvLanes, deriveVersionAxis, type VersionLane } from '@/composables/difficultyCurve3d'
import { useConfigStore } from '@/stores/config'
import { useStunDiscreteDisplay } from '@/composables/stunDiscreteDisplay'
import { useCatalogStore } from '@/stores/catalog'
import { computeTeamComparePoints, DEFAULT_AUTO_ENGINE_POOL, INTERACTION_LABELS, BOSS_ATTACK_INTERACTIONS, defaultInteractionFormula, type PresetGoldAlternative } from '@/composables/teamCompare'
import { datasetFromTeamGold } from '@/composables/analysis/dataset'
import { publishAnalysis } from '@/composables/analysis/transfer'
import { cloneConfigState, withAnalysisScenario } from '@/composables/analysisScenario'
import { DOWNGRADE_MODS } from '@/composables/downgradeWEngine'
import { persistedRef } from '@/composables/persistedRef'
import { useBatchOwner } from '@/composables/batchTask'
import { runDifficultyCurves } from '@/composables/difficultyCurveRunner'
import { computeCinemaUpliftGrid, type CinemaUpliftGridResult, type GridColSpec, type GridRowSpec } from '@/composables/cinemaUpliftGrid'
import { useCurvePointPool } from '@/composables/curvePointPool'
import { deltaKeys } from '@/composables/configDelta'
import ResourceResultCard from '@/components/ResourceResultCard.vue'
import { findMoveById } from '@/data/moveTableQueries'
import { currentRowFusionRules } from '@/logicEditor/fusion'
import { assignLabelLanes, attributeDmgChanges, estimateLabelWidth, pickNonOverlapping, linkCountToDmg, buildCurveChart, majorChanges, axisColumnText, axisWorseThanNoAxis, type CurveDatum, type DifficultyCurveRow, type KeyCountChange } from '@/composables/difficultyCurve'
import { axisKindLabel } from '@/composables/difficultyAxis'
import { axisCompareOf, axisCutMarkerOf, axisDetailOf, axisMarkerLegend, axisMarkerOf } from '@/composables/axisMarker'
import { planCurveViewport, X_COMPRESS_DEFAULTS, type LaneXRange } from '@/composables/curveViewport'
import { cinemaCostOf, GOLD_PER_CINEMA_LEVEL } from '@/composables/cinemaUpliftCost'
import type { CinemaUpliftEntry as CinemaUpliftEntryType } from '@/composables/cinemaUplift'
import { DEFAULT_NO_AXIS_VULN_SHARE, NO_AXIS_VULN_SHARE_SETTING } from '@/composables/resourceCalc/noAxisVulnShare'
import type { KnobPointName } from '@/composables/difficultyLadder'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { teamPresets } from '@/data/teamPresets'
import { usePresetTeamPicker } from '@/composables/usePresetTeamPicker'
import { useCustomTeamsStore, resolveSelectedPresets } from '@/composables/customTeams'
import CustomTeamsEditor from '@/components/CustomTeamsEditor.vue'
import TeamSlotCodeEditor from '@/components/TeamSlotCodeEditor.vue'
import { engineLabelOf } from '@/composables/enginePicker'
import ChartLegend from '@/components/charts/ChartLegend.vue'
import ChartTable from '@/components/charts/ChartTable.vue'
import { fmt, compact, localized } from '@/utils/format'
import { useScatterGeometry } from '@/composables/teamCompareScatter'
import { useSlotSweep } from '@/composables/teamCompareSweep'
import { useTeamSlotCodes } from '@/composables/teamSlotCodes'
import type { SlotOverrides } from '@/composables/presetSlotOverrides'
import { encodePointTimes, timeLegendRows } from '@/composables/pointTimeAxis'
import type { BossPreset, BossPresetPhase, PhaseBuffCard, PhaseView } from '@/types/bossPreset'
import { releaseDateOf, releaseNodeOf, nodeIndexOf, VERSION_NODES } from '@/data/versionTimeline'
import { buildPeriodAxis } from '@/composables/bossSchedule'
import type { TeamComparePoint, TeamPreset } from '@/types/teamPreset'
import { INTERACTION_WEIGHTS } from '@/types/teamPreset'

const configStore = useConfigStore()

/**
 * R14（T139）无轴易伤估算的开关——**图例必须如实标注非轴参照用哪种口径**
 * （R14 硬约束 2「来源可见」在难度曲线页的延伸）。
 *
 * 为什么需要：非轴参照点（T192）是**关掉轴重算**的 ⇒ 它会自动吃到 R14 的估算加成；
 * 而轴点是真实轴、不吃。实测「轴 vs 非轴」差距因此被压缩（58.1% → 31.4% 等）。
 * 那是设计上的必然（参照语义从「最坏情况」变成「典型玩家」），但**不能让用户以为
 * 自己看的是均匀摊**——所以图例随开关切换措辞。
 */
// 用户裁决 2026-10-19：非轴不做自动认领，曲线页只用来说明「非轴参照吃的是哪个口径」
const noAxisVulnShare = computed(() =>
  configStore.getMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, DEFAULT_NO_AXIS_VULN_SHARE))
const catalogStore = useCatalogStore()


// ========== Boss 预设 ==========
const bossPresets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])
const selectedPeriodId = ref('')
const selectedBossId = ref('')

onMounted(async () => {
  try {
    const data = await useCatalogStore().loadBossPresets()
    bossPresets.value = data.bosses ?? []
    phaseViews.value = data.phaseViews ?? []
    // 默认选最新期数 + 该期第一个 Boss
    const first = allPeriods.value[0]
    if (first) selectedPeriodId.value = first.phaseId
  } catch { /* boss 数据缺失时页面显示引导 */ }
  // 默认选中 = **当前筛选分类下的队伍**（不是全库全选）。口径与实现见
  // `usePresetTeamPicker#defaultSelection`（筛选函数只在 composable 里调用，规则 11 源码锁）。
  // 2026-10-12 用户报障：「默认不要选择 97 个队伍」+「默认选中 97+ 队伍也没算出图啊，跟没选是一样的」。
  // ⚠ 只在挂载时取一次，**不 watch 筛选**——2026-10-11 用户裁决「筛选只决定下拉列出什么，
  // 不清空已选」（跨分类自由勾选），跟着筛选变会破坏那条口径。
  selectedPresetIds.value = defaultSelection()
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

// 敌方体型跟随 boss：CC-350 并入房间入口 `bossRoom#applyBossRoom`（对比在场景里进房间时写场景、不再改 UI store）

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
const { selectedPresetIds, defaultSelection, presetGroupSel, presetSubSel, presetGroupOptionsC, presetSubOptions, presetFilteredOptions, presetLabelOf, quickPickMainC, mainCQuickOptions } = usePresetTeamPicker()  // CC-482：两级筛选 + 主C快选的状态簇，与另一比较页共用
const customTeams = useCustomTeamsStore()
// 自定义队与预设队共用一个 id 命名空间 ⇒ 必须**合并解析**：只查预设库会让自定义队静默消失
// （选中了但算不出来，比报错更难查）。解析口是 customTeams#resolveSelectedPresets，两页同源。
const selectedPresets = computed<TeamPreset[]>(() =>
  resolveSelectedPresets(selectedPresetIds.value, customTeams.defs, customTeams.toCustomPreset),
)

// ========== 金数 ==========
const goldMin = ref(0)
const goldMax = ref(6)
/**
 * 最优加金（≤12金）：不用预设排列顺序，逐金挑伤害提升最大的组合；12金以上回退预设顺序。
 *
 * **缺省 OFF**（用户裁决 2026-10-25 逐字：「C，默认肯定要快速，你有精确需求可以自己打开开关呀」）。
 * 分档依据 = `ENGINE_PIPELINE_GUIDE.md` §4 坑 53 **B 档**（估算/近似级：关掉只是少一个近似，
 * 结果仍自洽）⇒ 缺省 OFF + UI 文案标「慢」。实测成本（同队 8 档）：OFF 18ms/档、ON ~213ms/档。
 * ⚠ 这里不再「静默默认开」——上一版 `ref(true)` 让每次点「计算」都默默跑贪婪，
 * 而 96 个预设里 73 个 `goldSteps` 为空 ⇒ 即便开着也选不出步（白付成本）。
 */
const optimalGold = persistedRef<boolean>('zzz-compare-optimal-gold:v1', v => (typeof v === 'boolean' ? v : undefined), () => false)
/** 同金分配对比表（勾选后收集贪婪搜索的落选候选） */
const showGoldAlternatives = ref(false)
const goldAlternatives = ref<PresetGoldAlternative[]>([])

/** 表行：按 (队伍, 金数) 分组、组内按代价升序（★ 优先），便于一眼看出「投给谁最划算」 */
const goldAltRows = computed(() => {
  const rows = [...goldAlternatives.value]
  rows.sort((a, b) => a.presetId.localeCompare(b.presetId)
    || a.budgetGold - b.budgetGold
    || Number(b.isBest) - Number(a.isBest)
    || a.lossPct - b.lossPct)
  return rows
})
/** 自动下位音擎（缺省开）：非限定槽位从装填池按伤害择优穿戴；选中限定音擎按本体如实计金 */
const autoEngine = ref(true)
/**
 * **每队配置码**（用户 2026-10-26：「我想这里写成操作区，比如我从上面勾选的队伍也能写配置码」）。
 *
 * 取代旧的页面级「逐槽锁定」三格：那张控件对**一张图上的所有队**套同一份覆盖，
 * 于是「诺姆30 队 vs 诺姆11 队」写不出来（两队会被写成同一套）——而那正是用户要做的对比。
 * 现在按 `presetId` 存（`composables/teamSlotCodes`），UI 是 `components/TeamSlotCodeEditor.vue`。
 *
 * 口径 / 判据见 `composables/presetSlotOverrides.ts` 与 `__tests__/presetSlotOverrides.test.ts`。
 */
const teamSlotCodes = useTeamSlotCodes()
/** 自动下位默认精炼档：A 级 / 常驻 S（缺省 DOWNGRADE_MODS，与自由对比「无专武」档同一口径） */
const autoModA = ref(DOWNGRADE_MODS.aRank)
const autoModStd = ref(DOWNGRADE_MODS.standard)
// 装填池：玩家可增删，localStorage 持久化；种子 = 用户准信五件（击破：人为刀俎/燃狱齿轮，辅助：阿炮/逍遥游球/啜泣摇篮）
const AUTO_ENGINE_POOL_KEY = 'zzz-compare-auto-engine-pool'
const autoEnginePool = persistedRef<string[]>(AUTO_ENGINE_POOL_KEY, arr => {
  if (!Array.isArray(arr)) return undefined
  const valid = [...new Set(arr.filter((id: unknown) => typeof id === 'string' && catalogStore.getWEngine(id as string)))] as string[]
  return valid.length > 0 ? valid : undefined
}, () => [...DEFAULT_AUTO_ENGINE_POOL])

// ========== 难度权重（主观量，用户自填；INTERACTION_WEIGHTS 与 1秒=1点只是默认值） ==========
const DIFF_WEIGHTS_KEY = 'zzz-compare-difficulty-weights'
interface DiffWeightsState {
  timePressure: number
  interaction: Record<string, number>
  /**
   * 逐交互类型的**自编难度公式**（用户口径 2026-09-20：「仪玄的 e 弹、佩洛伊斯的完美格挡、
   * 般岳的金身弹刀和双反都需要怪物的一次攻击，所以要算修正。这个我想让用户抉择，哪些是要吃
   * 非失衡占比的，让他自己编公式」）。空串 = 用该类型默认公式。
   */
  interactionFormula: Record<string, string>
  /** 逐类型的指数 k（公式变量 k 的取值）；仅需怪攻击的类型可调 */
  interactionExponent: Record<string, number>
}
const DEFAULT_DIFF_WEIGHTS: DiffWeightsState = {
  // 时间压力 = 硬溢出 + 合轴抵扣（同一笔秒数）：默认 1 秒 = 1 难度点（只有一个权重，见 teamCompare#computeDifficulty）
  timePressure: 1,
  interaction: { ...INTERACTION_WEIGHTS },
  interactionFormula: {},
  interactionExponent: {},
}
function parseDiffWeights(stored: unknown): DiffWeightsState {
  const base: DiffWeightsState = { timePressure: 1, interaction: { ...INTERACTION_WEIGHTS }, interactionFormula: {}, interactionExponent: {} }
  const obj: Record<string, unknown> = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {}
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {})
  // 旧版存的是两个旋钮（overflow/align）——合并成一项后取两者中用户改过的那个（都=默认 1 时不变）
  const legacy = [obj.overflow, obj.align].map(num).filter((v): v is number => v !== undefined)
  const tp = num(obj.timePressure) ?? legacy[0]
  if (tp !== undefined && tp >= 0) base.timePressure = tp
  // 旧版存的是单个全局指数（nonStunExponent）——已改为逐类型公式，旧值**不迁移**
  // （语义不同：旧的是全局乘数，新的是逐项公式；强行映射会造出用户没写过的公式）
  for (const [k, v] of Object.entries(rec(obj.interactionFormula))) {
    if (typeof v === 'string') base.interactionFormula[k] = v
  }
  for (const [k, v] of Object.entries(rec(obj.interactionExponent))) {
    const n = num(v)
    if (n !== undefined) base.interactionExponent[k] = n
  }
  for (const [k, v] of Object.entries(rec(obj.interaction))) {
    const n = num(v)
    if (n !== undefined && n >= 0) base.interaction[k] = n
  }
  return base
}
const diffWeights = persistedRef<DiffWeightsState>(DIFF_WEIGHTS_KEY, parseDiffWeights, () => parseDiffWeights(undefined))
/**
 * 难度权重弹层的行（每个交互类型一行）：
 *  · `bossAttack` = 该类型**需要怪物一次攻击**（`BOSS_ATTACK_INTERACTIONS`）⇒ 显示「吃非失衡占比」开关；
 *  · `formulaOff` = 用户已把它关掉（公式写成 `c*w`）；
 *  · `defaultFormula` = 该类型的默认公式（公式输入框的 placeholder）；
 *  · `tip` = 行提示（说清该类型为什么吃/不吃修正）。
 */
const diffWeightRows = computed(() =>
  Object.keys(INTERACTION_WEIGHTS).map(t => {
    const bossAttack = BOSS_ATTACK_INTERACTIONS.includes(t)
    const userFormula = diffWeights.value.interactionFormula[t]
    return {
      type: t,
      label: INTERACTION_LABELS[t] ?? t,
      bossAttack,
      formulaOff: (userFormula ?? '').trim() === 'c*w',
      defaultFormula: defaultInteractionFormula(t),
      tip: bossAttack
        ? `${INTERACTION_LABELS[t] ?? t}：需要怪物出手一次 ⇒ 失衡期怪物不攻击、没有交互机会 ⇒ 非失衡时间越少越难凑。可关掉（不吃该修正）或自编公式。`
        : `${INTERACTION_LABELS[t] ?? t}：不依赖怪物出手（救场/后摇取消类），不吃非失衡占比修正。`,
    }
  }))

/** 开关某类型的「吃非失衡占比」（用户口径 2026-09-20「让用户抉择」）：关 = 公式写死 `c*w`，开 = 清空用默认 */
function setBossAttackFormula(type: string, on: boolean) {
  if (on) delete diffWeights.value.interactionFormula[type]
  else diffWeights.value.interactionFormula[type] = 'c*w'
}
function resetDiffWeights() {
  diffWeights.value = {
    timePressure: DEFAULT_DIFF_WEIGHTS.timePressure,
    interaction: { ...INTERACTION_WEIGHTS },
    interactionFormula: {},
    interactionExponent: {},
  }
}
/**
 * 「下位装填池」的可选音擎（2026-10-26 用户：「这下拉菜单点进去太多了，能不能把同职业的放在前面，
 * 因为同职业才能触发武器效果」）。
 *
 * 装填池是**逐槽**活动的（同一个池喂给三个槽），所以职业排序取「已选队伍里出现过的职业」并集：
 * 该职业的件进「✓ 可触发」组，其余折进第二组。空选择时退回平铺（不假装知道职业）。
 */
const enginePoolOptions = computed(() => {
  const specialties = new Set(
    selectedPresets.value.flatMap(p => p.team)
      .map(id => (id ? catalogStore.getAgent(id)?.specialty : undefined))
      .filter((s): s is NonNullable<typeof s> => !!s),
  )
  if (specialties.size === 0) {
    return catalogStore.displayWEngines.map(w => ({ value: w.id, label: engineLabelOf(w) }))
  }
  const own = catalogStore.displayWEngines.filter(w => specialties.has((w.effect?.requirement?.specialty ?? w.specialty)))
  const other = catalogStore.displayWEngines.filter(w => !specialties.has((w.effect?.requirement?.specialty ?? w.specialty)))
  return [
    ...(own.length > 0 ? [{ type: 'group' as const, label: '✓ 队内职业（被动可触发）', children: own.map(w => ({ value: w.id, label: engineLabelOf(w) })) }] : []),
    ...(other.length > 0 ? [{ type: 'group' as const, label: '× 其它职业（被动不触发）', children: other.map(w => ({ value: w.id, label: engineLabelOf(w) })) }] : []),
  ]
})

// ========== 计算 ==========
const computing = ref(false)
const progress = ref<{ pct: number; text: string } | null>(null)
const points = ref<TeamComparePoint[]>([])
/**
 * 图型：散点（各队各金档一个点）/ 难度曲线（每队自己的贪心提升路径）/ 第三人海选（固定2队友+全角色扫第三槽）
 * / 命座提升率网格（Boss × 环境buff 的 N×M 格，每格逐级提升率 —— 用户 2026-10-20 裁决「在图表类单独给一个」）
 */
const chartMode = ref<'scatter' | 'curve' | 'sweep' | 'uplift'>('scatter')
/** 曲线结果（原始阶梯，画图与摘要都从它派生） */
const curveRows = ref<DifficultyCurveRow[]>([])

// ========== 命座提升率网格（chartMode === 'uplift'）==========
/**
 * 用户 2026-10-20：「命座提升率在不同环境下提升不同，我认为这个不用在资源利用率里面了，
 * 在图表类单独给一个，伤害贡献多算几次，比如一个方框分成 4 个方框或者 9 个方框，
 * 2 维属性分别是 boss 选择不同，环境 buff 选择不同」。
 *
 * 口径（为什么每格要用**同一个**锁值，见 `cinemaUpliftGrid.ts` 头注释）：
 * 锁值 = 该格 **C0 基线**自由收敛的失衡次数。用「当前配置的池」当锁值会让全01 与全65 锁在不同窗数上
 * （实测同队累计提升率因此从 71.0% 漂到 68.8%，差值全部来自锁值而不是命座）。
 */
const upliftBossRows = ref(3)
const upliftBuffCols = ref(3)
const upliftSlot = ref(0)
const upliftMaxLevel = ref(6)
const upliftIncludeFree = ref(false)
/**
 * 锁值口径（2026-10-20，用户报「提升率跳变」后开放）：
 * - `row`：每行用自己的锁值（各 Boss 各打各的，最贴近「这一关真能打几次」）
 * - `grid`：整张表用同一个锁值（取第一行不吃 buff 的 C0 基线）⇒ **同一把尺子**，跨行可比
 *
 * 为什么需要后者：整数台阶型命座（克拉蕾 C1 残痕效率 +20%，层数 = floor(积蓄/层)）
 * 对锁值极敏感——实测锁 5 ⇒ C1 +42.7%、锁 6 ⇒ +7.0%，差 6 倍。那是真实效应不是算错，
 * 但每行锁值不同时，读者会误读成「同一命座在不同 Boss 下差 6 倍」。
 */
const upliftLockMode = ref<'row' | 'grid'>('grid')
const upliftResult = ref<CinemaUpliftGridResult | null>(null)
/** 无法开始计算时的**可见**原因（空 = 无异常）。原来这些前置条件失败是静默 return。 */
const upliftHint = ref('')
const upliftOwner = useBatchOwner()
/** 期数/队伍/槽位/命座上限一变，旧结果就作废（行与列都按「当前期数」派生 ⇒ 不清会显示上一期的格子） */
watch([selectedPeriodId, selectedPresetIds, upliftSlot, upliftMaxLevel, upliftIncludeFree, upliftLockMode], () => {
  upliftResult.value = null
})

/**
 * 网格行：**当前选中期数**（页面顶部的「期数」下拉）里出现过的 Boss。
 *
 * ⚠ 2026-10-20 修（用户报「没显示吃 buff 的数据」）：原实现是「每 Boss 取它自己的最新期」，
 * 而列取「全局最新期视图」——两者**根本不是同一期**。最新三个 3.3 期（690501/690491/690481）
 * 的牌全是 `(Test1)TBD` 占位牌（`testOnly: true`）且 `begin` 为空串 ⇒ 列被过滤得只剩「不吃」，
 * 用户看到的就是「没有吃 buff 的数据」。现在行与列**同源同一期**。
 */
const upliftRows = computed<GridRowSpec[]>(() => {
  const periodId = selectedPeriodId.value
  if (!periodId) return []
  const out: GridRowSpec[] = []
  const seen = new Set<string>()
  for (const b of bossPresets.value) {
    if (seen.has(b.id)) continue
    const phases = b.phases.filter(p => p.phaseId === periodId)
    if (phases.length === 0) continue
    seen.add(b.id)
    const phase = phases.find(p => p.modeType === 'critical_assault') ?? phases[0]
    if (!phase) continue
    out.push({ boss: b, phase })
    if (out.length >= upliftBossRows.value) break
  }
  return out
})

/** 当前期视图（与行同源：行和列必须是同一期，否则「吃 buff」比较的是两个不同的关卡） */
const upliftPhaseView = computed<PhaseView | null>(
  () => phaseViews.value.find(v => v.phaseId === selectedPeriodId.value) ?? null,
)

/** 该期**可用的** buff 牌（排除 testOnly 占位牌）；0 张 = 该期没有可选牌 */
const upliftUsableCards = computed(() => (upliftPhaseView.value?.buffs ?? []).filter(b => !b.testOnly))

/** 网格列：该期可用牌，按牌数上限截断；首列恒「不吃」。无可用牌时只有「不吃」一列 */
const upliftCols = computed<GridColSpec[]>(() => {
  const out: GridColSpec[] = [{ id: 'none', label: '不吃 buff', card: null }]
  for (const c of upliftUsableCards.value.slice(0, upliftBuffCols.value)) {
    out.push({ id: c.title, label: c.title, card: c })
  }
  return out
})

/** 带符号一位小数（表格单元格用；页面原先没有这个 helper，散点卡用的是局部模板表达式） */
function signed1(v: number | null | undefined): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
}
/** 提升率单元格着色：正 = 成功色 / 负 = 危险色 / |v| < ε 不着色（与资源利用率页同一阈值语义） */
function upliftCellClass(v: number | null | undefined): string {
  const n = Number(v)
  if (!Number.isFinite(n) || Math.abs(n) < 0.05) return ''
  return n > 0 ? 'cell-pos' : 'cell-neg'
}

/** 网格按行优先渲染：每个 Boss 一行，行里按列顺序取格（`lock` = 该行的锁值，提到行首单列显示） */
/**
 * 单元格 → 成本轴（B7）。用 `cinemaUpliftCost`（纯函数、有判据），页面不自己算除法。
 * 同格只算一次会很啰嗦，模板里多次读也不会重跑重活（纯算术，输入是已算好的 entries）。
 */
function cellCost(cell: { lockedEntries: CinemaUpliftEntryType[]; lockedTotalPct: number }) {
  return cinemaCostOf(cell.lockedEntries, cell.lockedTotalPct)
}
const upliftGrid = computed(() => {
  const r = upliftResult.value
  if (!r) return []
  const byId = new Map(r.cells.map(c => [c.id, c]))
  return r.rowLabels.map((label, ri) => {
    const row = upliftRows.value[ri]
    const cells = r.colLabels.map((_, ci) => {
      const col = upliftCols.value[ci]
      return row && col ? byId.get(`${r.cells[0]?.presetId}|${row.boss.id}|${row.phase.phaseId}|${col.id}`) ?? null : null
    })
    /** 行锁值：取该行第一个非空格（同行为行级锁，逐位相同；全空 = 中止时没算到这行） */
    const lock = cells.find(c => c != null)?.baseStunCount ?? null
    return { label, lock, cells }
  })
})

/** 全表是否同一把尺子（决定横幅是绿是黄 —— 用户「怕误解就改 ui」的核心） */
const upliftLockUniform = computed(() => {
  const locks = upliftGrid.value.map(r => r.lock).filter((v): v is number => v != null)
  return locks.length === 0 ? true : new Set(locks).size === 1
})
/** 统一时的锁值（空格场景返回 0，模板里只在 uniform 时用） */
const upliftLockValue = computed(() => upliftGrid.value.find(r => r.lock != null)?.lock ?? 0)
/** 不统一时给一句摘要，如「5 / 6 / 5」 */
const upliftLockSummary = computed(() => upliftGrid.value.map(r => r.lock ?? '—').join(' / '))

async function runUpliftGrid() {
  const presets = selectedPresets.value
  /**
   * ⚠ 提前 return 必须**说出来**（2026-10-20 实机点通时抓到）：修前这里直接 `return`，
   * 用户没选队伍时点「计算提升率网格」**什么都不发生**——没有报错、没有进度、没有提示，
   * 和「按钮坏了」无法区分（ui-check 也因此在 300s 后超时才暴露）。
   */
  if (presets.length === 0) {
    upliftHint.value = '还没选队伍：先在上方「预设队伍」里勾至少一支（或新建自定义队伍），再点计算。'
    return
  }
  upliftHint.value = ''
  const task = upliftOwner.start()
  computing.value = true
  progress.value = null
  try {
    // 只跑第一支队：一张网格已经是 N×M×(maxLevel+1) 次全量求值，多队会把格子挤得看不清
    const preset = presets[0]!
    const result = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset],
      rows: upliftRows.value,
      cols: upliftCols.value,
      slots: [upliftSlot.value],
      maxLevel: upliftMaxLevel.value,
      includeFree: upliftIncludeFree.value,
      lockMode: upliftLockMode.value,
      control: { signal: task.signal },
      onProgress: p => task.commit(() => { progress.value = p }),
    }))
    task.commit(() => { upliftResult.value = result })
  } finally {
    task.commit(() => { computing.value = false; progress.value = null })
  }
}

function cancelUplift() {
  upliftOwner.cancel()
}
/** 难度曲线视图：2D 折线（原图）/ 3D 版本轴（用户 2026-09-19） */
const curveView = ref<'2d' | '3d'>('2d')
/**
 * **环境模式**（用户 2026-10-13）：「勾选了环境，那么就不是看自身实力了，而是想看在不同期数的血量
 * 膨胀上也可以选择对应期数的 buff 作为增幅的综合实力」。
 *
 * - 不勾（缺省）= 自身实力：全部队用当前选中那一期、不吃 buff ⇒ 与改动前**逐位相同**；
 * - 勾上 = 综合实力：每条道 =（预设 × 该队版本内的**每一期**），各吃自己那期的**血量 + buff 牌**。
 *   实测同一 Boss 每版本最多上 2 期 ⇒ 道数 ≈ 队数 × 1~2（用户口径「压力会变成 1~3 倍」）。
 */
const curveEnv = ref(false)
/** buff 三态（用户「勾选与不勾选都要能做，你可以让用户自己选，也可以提供硬算功能」） */
const curveBuffMode = ref<'none' | 'auto' | 'manual'>('none')
const curveManualBuff = ref<string | null>(null)
const curveBuffModeOptions = [
  { value: 'none', label: '不吃 buff（快）' },
  { value: 'auto', label: '每期自动取最优（硬算，慢）' },
  { value: 'manual', label: '手选牌名' },
]
/** 期数范围（用户口径「加个新功能，就是限定期数的开头和结尾，这样相比默认的头尾就缩短了」） */
const curvePeriodFrom = ref<string | null>(null)
const curvePeriodTo = ref<string | null>(null)
/** 3D 版本轴：多个槽位在变时逐队指定「当版本的角色」（presetId → slot），只在本页会话内有效 */
const versionOverrides = ref<Record<string, number>>({})
function setVersionOverride(presetId: string, slot: number | null) {
  if (slot === null || slot === undefined) delete versionOverrides.value[presetId]
  else versionOverrides.value[presetId] = slot
}
/**
 * **输入侧的队伍清单**（选中预设，不依赖计算结果）。
 *
 * ⚠ 为什么必须有一份输入侧的轴（实机踩到）：`versionAxis` 是**从结果行**推的
 * （`visibleCurveRows`），而**环境模式的道表要在发请求前算好**（worker 契约）——
 * 用结果推道表就成了鸡生蛋：第一次点「计算曲线」时 `curveRows` 还是空的 ⇒ 道表为空 ⇒
 * 零行 ⇒ 结果还是空的。实机症状 = **点计算曲线永远等不到图**（超时 300s，零 JS 错误）。
 */
const presetInputs = computed(() => selectedPresets.value.map(p => ({
  presetId: p.id,
  name: p.name,
  team: (p.team ?? ['', '', '']) as readonly string[],
})))

/** 结果侧版本轴（展示用）：只覆盖**可见**队，隐藏队退出轴范围（图例筛选传导） */
const versionAxis = computed(() => deriveVersionAxis(
  visibleCurveRows.value.map(r => {
    const p = teamPresets.find(t => t.id === r.presetId)
    return { presetId: r.presetId, name: r.name, team: (p?.team ?? ['', '', '']) as readonly string[] }
  }),
  versionOverrides.value,
  id => agentNameOf(id),
  // ⑤ 道位按首次 UP 的版本节点序号留空档（未收录角色 → null → 全轴回退等距）
  id => releaseNodeIndexOf(id),
))

/** **输入侧版本轴**（环境模式的道表/道位用；同一套 overrides 与解析器 ⇒ 与结果侧同槽口径） */
const inputVersionAxis = computed(() => deriveVersionAxis(
  presetInputs.value,
  versionOverrides.value,
  id => agentNameOf(id),
  id => releaseNodeIndexOf(id),
))
/**
 * 期数轴节点（环境模式的横轴单位）：**有选中 Boss 的期**才进轴（用户 2026-10-13
 * 「并不是每期一个点，而是有 boss 的期数才会有点」）——`buildPeriodAxis` 收全部 Boss 的全部期，
 * 这里按「选中 Boss 有没有这一期」过滤，并按用户给的头尾范围裁剪。
 *
 * 实测同版本 3 期里该 Boss 通常只上 1~2 期（死路屠夫 3.1 只有 690441/690421）⇒ 每队道数 1~2。
 */
const curvePeriodNodes = computed(() => {
  const boss = selectedBoss.value
  if (!boss) return []
  const has = new Set(boss.phases.map(p => p.phaseId))
  const all = buildPeriodAxis(bossPresets.value).filter(n => has.has(n.id))
  const from = curvePeriodFrom.value
  const to = curvePeriodTo.value
  if (!from && !to) return all
  const iFrom = from ? all.findIndex(n => n.id === from) : 0
  const iTo = to ? all.findIndex(n => n.id === to) : all.length - 1
  if (iFrom < 0 || iTo < 0) return all
  const lo = Math.min(iFrom, iTo)
  const hi = Math.max(iFrom, iTo)
  return all.slice(lo, hi + 1)
})
const curvePeriodOptions = computed(() =>
  curvePeriodNodes.value.map(n => ({ value: n.id, label: n.label })),
)

/** 选中 Boss 在某一期的 phase（环境模式取该期血量/敌人数值的唯一来源） */
function phaseOfPeriod(periodId: string): BossPresetPhase | null {
  return selectedBoss.value?.phases.find(p => p.phaseId === periodId) ?? null
}

/** 该期的 buff 牌（`phaseViews` 按期；测试服占位牌不算） */
function buffsOfPeriod(periodId: string): PhaseBuffCard[] {
  return (phaseViews.value.find(v => v.phaseId === periodId)?.buffs ?? []).filter(b => !b.testOnly)
}

/**
 * 手选牌名的候选：当前期数范围内出现过的全部牌名（并集，去重）——用户要「手选」，候选就该是他
 * 能看到的那些牌，而不是只有当前这一期的。
 */
const curveManualBuffOptions = computed(() => {
  const names = new Set<string>()
  for (const n of curvePeriodNodes.value) for (const b of buffsOfPeriod(n.id)) if (b.title) names.add(b.title)
  return [...names].map(t => ({ value: t, label: t }))
})

/**
 * **环境模式的道表**（发请求前算好的**纯数据**；worker 读不到页面 store，函数过不了 postMessage）。
 *
 * 一条道 =（预设 × 该队**版本槽角色**所属版本内的、选中 Boss 上岗的每一期）。版本槽口径复用
 * `versionAxis`（`deriveVersionAxis` 已按「变化最多的槽 + 并列优先能解析的槽」定好），
 * 再按**首次 UP 日期**把该角色落到期（`indexForDate` 的窗口口径）。
 *
 * 该队一条道都没有（角色未收录 / 该版本内 Boss 没上岗）⇒ 空数组，页面在摘要里如实标注，
 * **不静默塞一条用当期血量的假道**（那会把两种口径混进同一张图）。
 */
const curveEnvLanes = computed(() => {
  if (!curveEnv.value) return []
  return buildEnvLanes(inputVersionAxis.value.lanes, curvePeriodNodes.value, {
    versionOf: versionOfAgent,
    dateOf: releaseDateOf,
  }).map(l => {
    const phase = phaseOfPeriod(l.periodId)
    return phase ? { presetId: l.presetId, key: l.periodId, phase, buffs: buffsOfPeriod(l.periodId) } : null
  }).filter((v): v is NonNullable<typeof v> => v !== null)
})

/** 角色实装版本号（回退归期用；与 `releaseNodeIndexOf` 同源） */
function versionOfAgent(agentId: string): string | null {
  const nodeId = releaseNodeOf(agentId)
  if (!nodeId) return null
  return VERSION_NODES[nodeIndexOf(nodeId)]?.version ?? null
}

/**
 * **环境模式下的 3D 道**：一条道 =（预设 × 该期）——与 `curveEnvLanes` 同源，但这里产出的是
 * 图表要的 `VersionLane` 形状（`frac` = 期数轴位置、`label` 带期标签、`versionIndex` = 期下标）。
 *
 * 为什么不用 `versionAxis.lanes`（版本道）：环境模式下**同期不同队才有可比性**，而版本道会把
 * 同队的两期叠成一条（`frac` 相同）⇒ 图上看不出「同一队在 3.1 与 3.2 的差别」，而那正是本功能的
 * 目的（用户 2026-10-13「你就要把版本换成更细致的期数才能表达完整」）。
 */
const curvePeriodAxis = computed(() => {
  const nodes = curvePeriodNodes.value
  const idxOf = new Map(nodes.map((n, i) => [n.id, i]))
  const lanes: Array<VersionLane & { laneKey: string }> = []
  const seen = new Set<string>()
  // 颜色/标签按 curveEnvLanes 的顺序（= versionAxis 的道序 × 该队的期序），保证与结果行同序
  for (const l of curveEnvLanes.value) {
    /**
     * ⚠ `laneKey` **必须传**（与 `CurveSeries.laneKey` 同一口径）：环境模式下同一队有多条道
     * （一个 presetId 对应多期），图表靠它认 series——缺了就只能按 `presetId` 找，**多条道会一起
     * 落回第一条 series**（图上只剩一条线，其他道画出重复的同一形状）。
     */
    const key = `${l.presetId}::${l.key}`
    if (seen.has(key)) continue
    seen.add(key)
    const node = nodes.find(n => n.id === l.key)
    const idx = idxOf.get(l.key) ?? null
    lanes.push({
      presetId: l.presetId,
      laneKey: key,
      name: node?.label ?? l.key,
      slot: 0,
      agentId: '',
      // 带上队名：环境模式下多条道常落在同一期，光看期标签分不出谁是谁
      label: `${presetNameOf(l.presetId)} · ${node?.label ?? l.key}`,
      y: idx ?? 0,
      versionIndex: idx,
      frac: nodes.length <= 1 ? 0.5 : (idx ?? 0) / Math.max(1, nodes.length - 1),
    })
  }
  const gapped = lanes.length > 0 && new Set(lanes.map(l => l.versionIndex)).size >= 2
  if (!gapped) {
    const n = lanes.length
    lanes.forEach((l, i) => { l.frac = n <= 1 ? 0.5 : i / (n - 1) })
  }
  return { lanes, gapped }
})

/** 预设 id → 队名（环境道标签用；查不到就退回 id，不显示空串） */
function presetNameOf(presetId: string): string {
  return teamPresets.find(t => t.id === presetId)?.name ?? presetId
}

/** 3D 图实际用的道（环境模式 = 期数道；否则 = 版本道） */
const chart3dLanes = computed<Array<VersionLane & { laneKey?: string }>>(() =>
  curveEnv.value ? curvePeriodAxis.value.lanes : versionAxis.value.lanes,
)

/** 版本节点序号解析（versionTimeline）：agent → 首次 UP 节点 → 节点序号（未收录 → null） */
function releaseNodeIndexOf(agentId: string): number | null {
  const nodeId = releaseNodeOf(agentId)
  return nodeId ? nodeIndexOf(nodeId) : null
}
function slotName(slot: number): string {
  return ['主 C 位（槽 1）', '第二位（槽 2）', '第三位（槽 3）'][slot] ?? `槽 ${slot + 1}`
}
function versionSlotOptions(presetId: string) {
  const p = teamPresets.find(t => t.id === presetId)
  return [0, 1, 2].map(slot => ({ value: slot, label: `${slotName(slot)} ${agentNameOf(p?.team[slot])}` }))
}
/** 批任务归属（S4，CC-343）：散点 / 曲线 / 海选三者共用——新一次计算吊销前任，离开页面也吊销。
 *  中止粒度 = 一队（单队阶梯是原子的），已算部分照常出图：取消只停计算，不吊销提交权。 */
const runOwner = useBatchOwner()
/** 「中止」按钮（曲线）：停掉当前运行，已算曲线由该运行自己发布 */
function cancelCurrentRun(): void {
  runOwner.cancel()
  computing.value = false
  progress.value = null
}

/** ③ 会话级曲线缓存（2026-09-19 性能）：同一份输入（Boss/期数/难度权重/机制开关/权重策略/store 快照/预设内容）
 *  切来切去重跑时**零秒出图**。store 快照 = 数值类全量输入的确定性刻画，命中即数学等价；LRU 上限 24。 */
const curveRunCache = new Map<string, { rows: DifficultyCurveRow[] }>()
const CURVE_RUN_CACHE_MAX = 24

/**
 * 3D z 口径（用户 2026-09-19②）：全队同一把当期尺（伤害/血量%，击杀线平面）/ 绝对伤害 + Boss 血量剖面。
 * 两档**都**画血量剖面（用户 2026-10-13「侧视图没能在对应角色的版本编号中表现出选定 boss 在血量膨胀
 * 板块的曲线……把点面改为选定 boss 的曲线面」）——`percent` 档下剖面按「该版本血量 ÷ 当期血量」
 * 换成同一把尺（= 膨胀指数），故「按当前角色版本编号取 Boss 血量当 100%」不再需要第三档口径。
 */
const curveZMode = ref<'percent' | 'absolute'>('percent')

/**
 * 选中 Boss 的血量剖面：覆盖版本道区间内的**每一个版本**（不是只有各道所在的那几点）。
 * 旧口径只取道位所在版本 ⇒ 每条道一个孤立点，3D 里连不成曲线（侧视更是每道一根竖柱）。
 */
const bossHpCurve = computed(() => {
  const boss = selectedBoss.value
  if (!boss) return []
  const mode = selectedPhase.value?.modeType ?? 'defense'
  return buildBossHpCurve(
    versionAxis.value.lanes,
    boss.phases,
    mode,
    idx => VERSION_NODES[idx]?.version ?? null,
  )
})

/** 绝对模式的 z 上限：可见各道所有档的绝对伤害 × Boss 血量样本的共同最大值（同一开关下比增速） */
const curveZAbsMax = computed(() => {
  let m = 1
  for (const s of curveData.value?.series ?? []) {
    for (const p of s.points) m = Math.max(m, p.dmg)
  }
  for (const q of bossHpCurve.value) m = Math.max(m, q.value)
  return m
})

// ========== 图例筛选（点图例显隐某队；两个图型各一份独立状态） ==========
// 隐藏必须传导到派生量：轴上限（yMax/xMax/costMax/ratioMax）、明细表、关键变化、曲线摘要
// 全部读「可见集合」，否则轴按隐藏数据缩放 ⇒ 筛选看着没生效（见 seriesFilter.ts 文件头 ②）。
const scatterLegend = useSeriesFilter(() =>
  [...new Set(points.value.map(p => p.presetId))].map(id => ({
    id,
    name: teamPresets.find(t => t.id === id)?.name ?? id,
  })),
)
/** 可见的散点（图 + 轴 + 明细表同源） */
const visiblePoints = computed(() => points.value.filter(p => scatterLegend.isVisible(p.presetId)))
/**
 * 「只有一个点」时的下一步提示（用户 2026-10-26：「只能说全01这一片单薄的预设就行，
 * 要么给 ui 自己改，要么勾选贪婪，提示下一步」）。
 *
 * 触发条件 = 结果里每支队都只有 1 个金档（= 没勾贪婪，且预设没写回 goldSteps）。
 * 文案只陈述事实 + 给两条**显式**路径，不做「自动帮你选」的动作。
 */
const singlePointNotice = computed(() => {
  if (points.value.length === 0) return ''
  const perTeam = new Map<string, number>()
  for (const p of points.value) perTeam.set(p.presetId, (perTeam.get(p.presetId) ?? 0) + 1)
  const allSingle = [...perTeam.values()].every(n => n === 1)
  if (!allSingle) return ''
  return '当前每队只有「全 01」一个金档：加金顺序不由我们编排（catalog 推的顺序实测 227/285 档选错配装）。'
    + '要更多金档有两条路 —— ① 勾「最优加金」逐金贪婪搜索（慢，但对得上穷举最优，误差 0.38%/档）；'
    + '② 用「逐槽锁定」直接写死每槽的配置码（21 = 2 命 1 精）。'
})
/** 图例计数（顶层 ref 绑定 ⇒ 模板里自动解包，写 `scatterCounts.visible`） */
const scatterCounts = scatterLegend.counts

/**
 * 曲线图例的粒度 = **道**（环境模式下同一队有多条道：一个 presetId 对应多行）。
 * 所以 id 必须是 `laneKeyOf(row)` 而不是 `presetId`——用 presetId 会让同队的两条道**互相覆盖显隐**
 * （点一条藏掉全部）。自身实力模式下 `laneKeyOf = presetId`，与改动前逐位等价。
 */
const laneKeyOf = (r: DifficultyCurveRow): string => (r.periodKey === null ? r.presetId : `${r.presetId}::${r.periodKey}`)
/**
 * 表格的「期数/该期血量」列按**数据**决定（行里有没有期），**不按当前开关**——
 * 否则「切了开关但还没重算」时，旧结果会被套上新列，显示成「期数 — / 血量 206M」这种
 * 半新半旧的假象（实机点通实测到）。
 */
const curveRowsHavePeriod = computed(() => curveRows.value.some(r => r.periodKey !== null))
/**
 * 本批可见曲线里**有没有曲线外补充点**（用户口径 2026-10-14「10大就是选择与否，同 x 难度的
 * 不同 y，是难度曲线外面的补充点」）——没有就**不渲染那一列**（全库只有 1 条预设声明 altAxes，
 * 给 90+ 队常驻一个空列是纯噪声）。
 */
const curveHasAltPoints = computed(() => curveData.value?.series.some(s => s.altPoints.length > 0) ?? false)
/**
 * 本批可见曲线里**有没有极限点**（用户口径 2026-10-14「自动上调合轴率只为算一个特殊值」）——
 * 没有就**不渲染那一列**（全库只有般岳声明 `limitPoint`）。
 */
const curveHasLimitPoints = computed(() => curveData.value?.series.some(s => s.limitPoint !== null) ?? false)
/** 曲线摘要表的动态列（期数/极限点/曲线外补充点只在有数据时出现） */
const curveSummaryColumns = computed(() => {
  const cols = [{ key: 'team', label: '队伍' }]
  if (curveRowsHavePeriod.value) {
    cols.push({ key: 'period', label: '期数' }, { key: 'hp', label: '该期血量' })
  }
  cols.push(
    { key: 'start', label: '全关' }, { key: 'end', label: '终点' },
    { key: 'gain', label: '提升' }, { key: 'x', label: '倍数' },
    { key: 'cost', label: '操作难度' }, { key: 'perCost', label: '收益/难度' },
    { key: 'knob', label: '关键点' }, { key: 'axis', label: '轴态' },
  )
  if (curveHasLimitPoints.value) cols.push({ key: 'limit', label: '极限点' })
  if (curveHasAltPoints.value) cols.push({ key: 'alt', label: '曲线外补充点' })
  return cols
})
/** 极限点杠杆的可读文案（字段名 → 「双反 ×N」；字段名住在声明里，页面只做展示映射） */
function limitLeverText(levers: Record<string, number>): string {
  const label: Record<string, string> = { dualCounterCount: '双反', blockCount: '金身', parryCount: '弹刀', dodgeCounterCount: '闪反' }
  return Object.entries(levers).filter(([, v]) => v > 0).map(([k, v]) => `${label[k] ?? k} ×${v}`).join('、') || '无'
}
/** 结果与当前环境设置不一致（改过开关/buff 态/期数范围但没重算）⇒ 如实提示，不假装结果是最新的 */
const curveRowsStale = computed(() => curveRows.value.length > 0 && curveRowsHavePeriod.value !== curveEnv.value)
const curveLegend = useSeriesFilter(() => curveRows.value.map(r => ({
  id: laneKeyOf(r),
  // 环境模式下同道多期：显示名带上期标签，否则图例里出现几个同名项无法区分
  name: r.periodKey === null ? r.name : `${r.name} · ${r.label}`,
})))
const curveCounts = curveLegend.counts
/** 可见曲线阶梯行（喂给 buildCurveChart，使其轴上限/刻度只按可见队算） */
const visibleCurveRows = computed(() => curveRows.value.filter(r => curveLegend.isVisible(laneKeyOf(r))))

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
  const run = runOwner.start()
  computing.value = true
  progress.value = { pct: 0, text: '' }
  goldAlternatives.value = []
  const all: TeamComparePoint[] = []
  const levels = goldLevels()
  const buffs = currentPhaseView.value?.buffs ?? []
  // 按队伍分批，让出主线程更新进度
  for (let i = 0; i < presets.length; i++) {
    const p = presets[i]
    run.commit(() => { progress.value = { pct: i / presets.length, text: `计算 ${p.name}（${i + 1}/${presets.length}）...` } })
    await new Promise(r => setTimeout(r, 0))
    const alts: PresetGoldAlternative[] = []
    const batch = await withAnalysisScenario(scenario => computeTeamComparePoints(scenario, {
      presets: [p],
      goldLevels: levels,
      boss,
      optimalGold: optimalGold.value,
      // 按队覆盖（`TeamSlotCodeEditor` 写的那份；空 = 不覆盖，逐位不变）
      slotOverrides: teamSlotCodes.overridesFor(p.id),
      goldAlternatives: showGoldAlternatives.value ? alts : undefined,
      phase,
      autoEngine: autoEngine.value,
      autoEngineMods: { aRank: autoModA.value, standard: autoModStd.value },
      autoEnginePool: autoEnginePool.value,
      buffs: buffChoice.value === 'none' ? [] : buffs,
      manualBuffTitle: buffChoice.value === '' || buffChoice.value === 'none' ? undefined : buffChoice.value,
      difficultyWeights: {
        timePressure: diffWeights.value.timePressure,
        interaction: diffWeights.value.interaction,
        interactionFormula: diffWeights.value.interactionFormula,
        interactionExponent: diffWeights.value.interactionExponent,
      },
    }))
    all.push(...batch)
    goldAlternatives.value.push(...alts)
  }
  run.commit(() => {
    points.value = all
    progress.value = { pct: 1, text: `完成：${all.length} 个点` }
    computing.value = false
    if (all.length > 0) {
      const golds = new Set(all.map(p => p.goldCount))
      const label = `${presets.length} 队 × ${golds.size} 金 · ${all.length} 点`
      publishAnalysis({ id: 'team-gold-damage', source: '队伍对比', label, dataset: datasetFromTeamGold(all, { metric: 'damage' }) })
      publishAnalysis({ id: 'team-gold-hp', source: '队伍对比', label: label + ' · 血量%', dataset: datasetFromTeamGold(all, { metric: 'hpRatio' }) })
    }
  })
}

/**
 * 难度曲线：逐队爬自己的贪心阶梯（每队要跑 ~10 次全量伤害，约 3~4 秒）。
 * 口径与散点的差异见 `composables/difficultyCurve.ts` 文件头（不含 buff/加金/自动下位）。
 *
 * **worker 化（2026-10-09）**：单队阶梯是一整段不可切分的同步计算（实机最长 task 3145ms / 3 队 14239ms
 * 覆盖全程），本页此前唯一的让出点在队与队之间 ⇒ 期间 UI 完全冻结。现在整批搬进 Web Worker
 * （`composables/difficultyCurveRunner.ts`，取舍依据与实测读数见其文件头）：
 * · 主线程阻塞归零（3 队实测 maxTask 14239ms → 0ms，墙钟 14226 → 13911ms，**不变慢**）；
 * · 结果逐位不变（worker 调的是同一个 `computeDifficultyCurves`，主线程侧零数值改动）；
 * · 无 Worker 环境（node/vitest）自动回落**原路径**，语义与改动前逐字相同。
 */
async function runCurves() {
  const presets = selectedPresets.value
  const boss = selectedBoss.value
  const phase = selectedPhase.value
  if (presets.length === 0 || !boss || !phase) return
  // ③ 会话缓存：输入逐字节相同 ⇒ 上次的结果数学等价，直接回放
  // ⚠ 环境开关/buff 态/期数范围**必须进 key**：它们改变道表（哪些期、吃哪张牌），
  //   漏进去会让「切了 buff 态却回放旧结果」看起来像开关失灵（本仓库踩过同类：漏传 fusionRules 数值静默漂移）
  const envTable = curveEnv.value
    ? {
      lanes: Object.fromEntries(
        [...new Set(curveEnvLanes.value.map(l => l.presetId))]
          .map(id => [id, curveEnvLanes.value.filter(l => l.presetId === id).map(l => ({ key: l.key, phase: l.phase, buffs: l.buffs }))]),
      ),
      buffMode: curveBuffMode.value,
      ...(curveBuffMode.value === 'manual' && curveManualBuff.value ? { manualBuffTitle: curveManualBuff.value } : {}),
    }
    : undefined
  /**
   * 每队配置码（用户 2026-10-26）：只把**真的写了码**的队放进表里（空表 = 逐位不变）。
   * worker 侧读不到页面 store ⇒ 必须在这里算成纯数据再发（同 `fusionRules` 的硬约束）。
   */
  const slotOverridesByPreset: Record<string, SlotOverrides> = {}
  for (const p of presets) {
    const ov = teamSlotCodes.overridesFor(p.id)
    if (ov.some(o => o !== null)) slotOverridesByPreset[p.id] = ov
  }
  const cacheKey = JSON.stringify({
    boss: boss.id,
    phase,
    snap: cloneConfigState(configStore.$state),
    weights: diffWeights.value,
    presets,
    env: envTable,
    // 覆盖必须进 key：否则改了码仍命中旧缓存，看起来像「写了没用」
    overrides: slotOverridesByPreset,
  })
  const hit = curveRunCache.get(cacheKey)
  if (hit) {
    curveRunCache.delete(cacheKey)
    curveRunCache.set(cacheKey, hit) // LRU touch
    curveRows.value = hit.rows
    progress.value = { pct: 1, text: `缓存命中：输入与上次完全相同（${hit.rows.length} 条曲线，0 秒出图）` }
    setTimeout(() => { progress.value = null }, 2500)
    return
  }
  const run = runOwner.start()
  computing.value = true
  progress.value = { pct: 0, text: '' }
  // 一次曲线运行的全部输入：纯数据（见 `CurveRunRequest` 契约）—— worker 靠它自建现场
  const outcome = await runDifficultyCurves({
    configState: cloneConfigState(configStore.$state) as unknown as Record<string, unknown>,
    // 行融合规则必须显式传：worker 里没有页面 store，缺省会重新激活 spec 默认规则
    // （显式传保证测试 / 自定义规则也带过去）
    fusionRules: currentRowFusionRules(),
    presets,
    boss,
    phase,
    difficultyWeights: {
      timePressure: diffWeights.value.timePressure,
      interaction: diffWeights.value.interaction,
      interactionFormula: diffWeights.value.interactionFormula,
      interactionExponent: diffWeights.value.interactionExponent,
    },
    // 环境模式的道表（纯数据；worker 读不到页面 store）。缺省 = undefined ⇒ 自身实力口径逐位不变
    environment: envTable,
    // 每队配置码覆盖（用户 2026-10-26）：页面操作区写的码压过预设自带 slotCodes；
    // 右位 0（无专武）由 applySlotOverrides 解析成下位表第一件 / 用户点名的下位件
    ...(slotOverridesByPreset ? { slotOverridesByPreset } : {}),
    // 逐点现场差分（用户 2026-10-16「能显示其资源池吗」）：每点 ~2.1KB，点开时才重算资源池
    collectScenes: true,
    // 非轴参照曲线（用户 2026-10-16：「我本意是想展示非轴模式的数据的，表示模拟均匀战斗
    // 而不是集中利用失衡易伤」）⇒ 每点额外一次关轴求值（点 1~4）
    collectNoAxis: true,
  }, {
    signal: run.signal,
    onProgress: (index, total, name) => {
      run.commit(() => { progress.value = { pct: index / total, text: `爬阶梯 ${name}（${index + 1}/${total}，每队约 3~4 秒）...` } })
    },
  })
  const all = outcome.rows
  const aborted = outcome.aborted
  run.commit(() => {
    curveRows.value = all
    if (!aborted) {
      curveRunCache.set(cacheKey, { rows: all })
      while (curveRunCache.size > CURVE_RUN_CACHE_MAX) {
        const oldest = curveRunCache.keys().next().value
        if (!oldest) break
        curveRunCache.delete(oldest)
      }
    }
    progress.value = { pct: 1, text: aborted ? `已中止：保留已算的 ${all.length} 条曲线` : `完成：${all.length} 条曲线` }
    computing.value = false
  })
}

// ========== 选第三人（不依赖预设队伍：固定 2 队友 + 候选范围试算第三槽） ==========
// 候选圈定 / 试算调度 / 结果条形比例搬到 composables/teamCompareSweep.ts（CC-92 结构熵切面，纯搬运）；
// 求值口径在 teamTimeline.ts#computeSlotSweepPoints（@fact slotSweep），候选口径见 @fact sweepPage:第三人候选圈定。
const {
  slotLabels, sweepSlot, sweepSlotOptions, sweepFixedBySlot, sweepSpecFilter, sweepCandidateSel, sweepBudget, sweepOptimalGold, sweepResult,
  sweepFixedSlots, agentOptions, sweepSpecOptions, sweepSpecLabel, sweepCandidateOptions, runSweep, cancelSweep, sweepBarPct,
} = useSlotSweep({ catalogStore, selectedBoss, selectedPhase, progress, computing })

function agentNameOf(id: string | null | undefined): string {
  return id ? catalogStore.agentName(id) : '—'
}
/** 职业（资源卡上的标签）；与 RunArchivePage#getSpecialty 同口径（catalog 是唯一来源） */
function specialtyOf(id: string): string {
  return catalogStore.getAgent(id)?.specialty ?? ''
}
function teamNames(team: [string, string, string]): string {
  return team.map(agentNameOf).join(' + ')
}
/** 加金明细：去掉 goldLabel开头的「N金：」段（总金已在限定金列） */
function goldDetail(label: string): string {
  const i = label.indexOf('：')
  return i >= 0 ? label.slice(i + 1) : label
}
// ========== 图表 ==========
// 散点图几何（画布尺寸/轴上限/刻度/队伍配色）搬到 composables/teamCompareScatter.ts（纯派生量，逐字节保真）。
const {
  svgW, padL, padT, plotW, plotH, viewBox,
  yMax, yOf, xOf, yTicks, yLabel, xTickPositions, xTickLabels, colorOf,
} = useScatterGeometry({ visiblePoints })

// ========== 第三轴：主C首池时间（用户 2026-09-14：「还可以找第三个轴，就是时间」） ==========
// 不做真 3D（可读性 + 零依赖 + 可单测，依据见 composables/pointTimeAxis.ts 文件头）：
// 时间编码成**颜色 + 点大小**叠加在既有 (难度, 伤害) 平面上。
// 缺省关闭，因为颜色当前属队伍身份（图例按队显隐）；开启后颜色改由时间档驱动。
const colorByRelease = ref(false)

/** 每队主C（槽位 0）的实装时间编码；未收录主C → 中性色（不猜时间） */
const timeEncoding = computed(() => {
  const mains = visiblePoints.value.map(p => teamPresets.find(t => t.id === p.presetId)?.team[0] ?? '')
  return encodePointTimes(mains)
})

/** 时间图例（含「主C未收录」条），按档列队伍名 */
const timeLegend = computed(() => {
  const enc = timeEncoding.value
  const namesByBucket = new Map<number, string[]>()
  enc.byIndex.forEach((e, i) => {
    const p = visiblePoints.value[i]
    if (!p) return
    const arr = namesByBucket.get(e.bucketIndex) ?? []
    arr.push(p.presetName)
    namesByBucket.set(e.bucketIndex, arr)
  })
  return timeLegendRows(enc.buckets, enc.unknownCount, bi => [...new Set(namesByBucket.get(bi) ?? [])])
})

const chartPts = computed(() =>
  visiblePoints.value.map((p, i) => {
    const t = timeEncoding.value.byIndex[i]
    const useTime = colorByRelease.value && t && t.bucketIndex >= 0
    return {
      ...p,
      cx: xOf(p.difficulty),
      cy: yOf(Math.min(p.hpRatio, yMax.value)),
      r: 3 + Math.min(p.goldCount, 36) * 0.5 + (useTime ? t.radiusBonus : 0),
      color: useTime ? t.color : colorOf(p.presetId),
      release: t?.release ?? null,
    }
  }),
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

/** 共享表格列定义（表头从 markup 移到数据；单元格仍由 slot 给） */
const scatterTableColumns = [
  { key: 'team', label: '队伍' }, { key: 'gold', label: '限定金' }, { key: 'buff', label: 'Buff' },
  { key: 'damage', label: '伤害' }, { key: 'ratio', label: '伤害/血量' }, { key: 'difficulty', label: '难度' },
  { key: 'detail', label: '交互明细' }, { key: 'cinema', label: '影画' },
  { key: 'wengine', label: '精炼' }, { key: 'time', label: '时间' },
]
const goldAltTableColumns = [
  { key: 'team', label: '队伍' }, { key: 'gold', label: '金数' }, { key: 'target', label: '这笔金投给' },
  { key: 'damage', label: '伤害' }, { key: 'cost', label: '代价' }, { key: 'state', label: '分配后状态' },
]
const curveJumpTableColumns = [
  { key: 'team', label: '队伍' }, { key: 'cost', label: '操作难度' }, { key: 'point', label: '关键点' },
  { key: 'change', label: '关键变化' }, { key: 'damage', label: '伤害' },
  { key: 'attr', label: '伤害归因（相对上一档）' },
]
const curveTruncTableColumns = [
  { key: 'team', label: '队伍' }, { key: 'cost', label: '操作难度' }, { key: 'point', label: '关键点' },
  { key: 'hint', label: '本档交互 → 实打' }, { key: 'cut', label: '被砍' },
  { key: 'needed', label: '达标所需难度' },
]
const sweepTableColumns = [
  { key: 'rank', label: '排名' }, { key: 'third', label: '第三人' }, { key: 'damage', label: '伤害' },
  { key: 'ratio', label: '伤害/血量' }, { key: 'gold', label: '限定金' },
  { key: 'goldDetail', label: '加金明细' }, { key: 'team', label: '队伍' },
]

/** 共享图例项：标签/颜色/悬浮说明都由页面给，ChartLegend 只管外观与事件 */
const scatterLegendItems = computed(() => legendPresets.value.map(p => ({
  id: p.id,
  label: p.name + '（' + p.minGold + '~' + p.maxGold + '金）',
  color: p.color,
  title: p.name + '：点击' + (scatterLegend.isVisible(p.id) ? '隐藏' : '显示') + '（隐藏后不参与坐标轴与明细表）',
})))

// ========== 难度曲线图表（x = 自动算的操作难度，y = 伤害/血量%） ==========
// 只喂可见行 ⇒ costMax/ratioMax/costTicks 全部按可见队算（② 筛选传导到轴）
const curveData = computed(() =>
  visibleCurveRows.value.length > 0 ? buildCurveChart(visibleCurveRows.value, selectedPhase.value?.hp ?? 1) : null,
)
/** 图例要展示**含隐藏队**的完整清单（否则隐藏后图例项消失，点不回来）；数字仍用可见集算的 gainX/gainPct */
const curveAllSeries = computed(() => (curveRows.value.length > 0 ? buildCurveChart(curveRows.value, selectedPhase.value?.hp ?? 1).series : []))
const curveLegendItems = computed(() => curveAllSeries.value.map(s => ({
  id: s.laneKey,
  label: s.label + '（' + fmt(s.gainX, 2) + '× · +' + fmt(s.gainPct, 1) + '%）',
  color: colorOf(s.presetId),
  title: s.label + '：点击' + (curveLegend.isVisible(s.laneKey) ? '隐藏' : '显示') + '（隐藏后不参与坐标轴与明细表）',
})))
/**
 * **曲线取值域**（用户 2026-10-25「xy 轴的标尺合理修改一下」）——唯一事实源 = `curveViewport.ts`。
 * 两个独立病灶：① Y 上界贴合数据（击杀线改「域外锚点」，不再为了它把数据压扁）；
 * ② X 轴只在「某条道占了大部分跨度、中间有大片真空」时压掉空白，并如实画断口。
 */
const curveViewport = computed(() => {
  const series = curveData.value?.series ?? []
  const ratios: number[] = []
  const costs: number[] = []
  const laneRanges: LaneXRange[] = []
  for (const s of series) {
    let min = Infinity; let max = -Infinity
    for (const p of s.points) { ratios.push(p.ratio); costs.push(p.cost); min = Math.min(min, p.cost); max = Math.max(max, p.cost) }
    for (const t of s.axisTruncated) if (t.x !== undefined) { costs.push(t.x); min = Math.min(min, t.x); max = Math.max(max, t.x) }
    if (Number.isFinite(min) && Number.isFinite(max)) laneRanges.push({ laneKey: s.laneKey, min, max })
  }
  // 阈值走导出常量（单一来源）；将来若要给用户旋钮，改这里一处即可
  return planCurveViewport({ ratios, costs, laneRanges, xThresholds: X_COMPRESS_DEFAULTS })
})
/** 归一化位置 → 像素（x 走可能压缩的分段映射，y 走线性） */
function curveXOf(v: number): number {
  return padL + curveViewport.value.x.project(v) * plotW.value
}
function curveYOf(v: number): number {
  const { min, max } = curveViewport.value.y
  const span = max - min
  if (!(span > 0)) return padT + plotH
  return padT + plotH - ((Math.min(max, Math.max(min, v)) - min) / span) * plotH
}
const curveYTicks = computed(() => curveViewport.value.y.ticks)
/** X 刻度：按原值取整齐档，但位置走压缩映射（刻度标的是**真实点数**，不是压缩后位置） */
const curveXTicks = computed(() => {
  const domain = curveViewport.value.x
  if (domain.breaks.length === 0) return (curveData.value?.costTicks ?? [0]).map(c => ({ x: curveXOf(c), label: c }))
  // 压缩时不用等距刻度（等距会切在断口里），改画「每个数据段的两端 + 断口两端」
  const values = new Set<number>()
  for (const b of domain.breaks) { values.add(b.from); values.add(b.to) }
  values.add(domain.min); values.add(domain.max)
  return [...values].sort((a, b) => a - b).map(c => ({ x: curveXOf(c), label: c }))
})
/** 次数显示：整数直接写，小数保留 1 位（引擎次数常带小数，见 difficultyCurve.ts） */
function cntNum(v: number): string {
  return Number.isInteger(v) ? String(v) : fmt(v, 1)
}
/** 「合轴节省」是**秒**不是次数 ⇒ 文案带单位，免得「+91.5」看不出是什么 */
const SECONDS_LABEL = '合轴节省'
const unitOf = (label: string) => (label === SECONDS_LABEL ? 's' : '')

/** 图上标注用短文案：`大招+1` / `合轴节省+91.5s` */
function cntDelta(c: KeyCountChange): string {
  return `${c.label}+${cntNum(c.delta)}${unitOf(c.label)}`
}
/** 面板/tooltip 用完整文案：`大招 7→8` / `合轴节省 0→91.5s` */
function cntRange(c: KeyCountChange): string {
  return `${c.label} ${cntNum(c.from)}→${cntNum(c.to)}${unitOf(c.label)}`
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
/**
 * 轴态形状用的小 path 生成器（R10）。**只做几何**，语义映射住 `axisMarker.ts`。
 *
 * ⚠ 为什么不用 `<circle :fill="...">`：① 半实心要跨两个形状（一个圆 + 半个扇形）才能表达；
 * ② SVG 呈现属性会被类选择器压掉（UI_THEME_GUIDE §4）。故统一走 `path d` + `:fill`/`:style`。
 */
function dotPath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
}
/** 半实心：右半圆填充 + 整圆描边（"轴打了一半"的字面表达，且与空心圆/实心圆都能区分） */
function halfPath(cx: number, cy: number, r: number): string {
  return `M ${cx} ${cy - r} a ${r} ${r} 0 0 1 0 ${2 * r} Z`
}
/** 被砍档的打叉（曲线下方，不连线）——与曲线点形状互斥，见 `axisMarker.ts` 文件头表 */
function crossPath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy - r} L ${cx + r} ${cy + r} M ${cx + r} ${cy - r} L ${cx - r} ${cy + r}`
}

const curveSeriesPx = computed(() => {
  const series = (curveData.value?.series ?? []).map(s => ({
    ...s,
    color: colorOf(s.presetId),
    pts: s.points.map(p => {
      const m = axisMarkerOf(p.axis)
      return { ...p, cx: curveXOf(p.cost), cy: curveYOf(p.ratio), axisShape: m.shape, axisLegend: m.legend }
    }),
    /**
     * **非轴参照点**（用户口径 2026-10-16 二次澄清）：
     * > 「原来是砍掉了，**砍掉是正确的**，因为**残缺的数值不适合展示**。我本意是想展示**非轴模式**的数据的，
     * >   表示**模拟均匀战斗**而不是集中利用失衡易伤。」
     *
     * ⇒ 图上要画的是「同一支队**关掉轴**时的难度-伤害」，而不是「轴没打完的残缺档」。
     * 数据源 = `series.noAxisPoints`（引擎在同一现场关轴重算，见 `difficultyCurve.ts`）。
     */
    noAxisPts: s.noAxisPoints.map(p => ({
      ...p,
      cx: curveXOf(p.cost),
      cy: curveYOf(p.ratio),
    })),
    // 线段化（而不是一条 polyline）：难度**回落**的那段画虚线，一眼看出「白拿的优化」
    segs: s.points.slice(1).map((p, i) => {
      const prev = s.points[i]!
      return {
        x1: curveXOf(prev.cost), y1: curveYOf(prev.ratio),
        x2: curveXOf(p.cost), y2: curveYOf(p.ratio),
        back: p.cost < prev.cost - 1e-9,
      }
    }),
    /**
     * **曲线外的补充点**（用户口径 2026-10-14「同 x 难度的不同 y，是难度曲线外面的补充点」）：
     * 画成**空心菱形**（与曲线点的实心圆区分），不与曲线连线（它不在曲线上）。
     * 空数组 = 该队没有补充点（绝大多数队）。
     */
    altPts: s.altPoints.map(a => ({
      ...a,
      cx: curveXOf(a.x),
      cy: curveYOf(a.ratio),
      color: colorOf(s.presetId),
      text: `${a.name} ${signedDmg(a.gainVsCurve)}`,
    })),
    jumpPts: s.jumps.map(j => ({
      ...j,
      cx: curveXOf(j.cost),
      cy: curveYOf(j.ratio),
      // 图上只显示前 2 项（长标签会互压；完整清单在「关键变化」面板与 tooltip 里）
      text: j.changes.map(cntDelta).slice(0, 2).join('·') + (j.changes.length > 2 ? '…' : ''),
    })),
    // 截断档（用户 2026-10-06）：图上只标「被砍得最狠的前 2 档」（同跃迁标注的取舍口径——
    // 一条曲线能有 5 档被砍，全标必叠；完整清单在「截断提醒」面板与 tooltip 里）。
    /**
     * **被轴砍掉的档**（R10）：画在曲线**下方**、不连线、打叉。
     * 与 `truncPts`（交互被时间线砍，空心方框）是**两个容器**，图形与文案都不许混。
     * 只有该档量到 x（`costOf` 给了）且能在图上定位时才画——没有 x 就是没有可画的坐标，不编一个。
     */
    cutPts: s.axisTruncated
      .filter(t => t.x !== undefined && Number.isFinite(t.x) && t.x >= 0)
      .map(t => ({
        ...t,
        cx: curveXOf(t.x!),
        cy: curveYOf(t.ratio),
        legend: axisCutMarkerOf(t.axis).detail,
      })),
    truncPts: s.truncated.map(t => ({
      ...t,
      cx: curveXOf(t.cost),
      cy: curveYOf(t.ratio),
      text: t.hint.neededX !== null
        ? `还差${fmt(t.hint.cut, 0)}次→需${fmt(t.hint.neededX, 0)}点`
        : `还差${fmt(t.hint.cut, 0)}次→曲线内达不到`,
    })),
  }))
  // 图上标注只保留**每队伤害增量最大的前 2 处**（G5 之后一条曲线能有 7+ 处跃迁，全标必叠；
  // 完整清单在「关键变化」面板与 tooltip 里），再跨队分道 + 碰撞剔除（宁可少标，不糊成一团）。
  const seriesTop = series.map(s => {
    const rank = [...s.jumpPts].sort((a, b) => (b.dmg - s.base) - (a.dmg - s.base))
    return new Set(rank.slice(0, 2))
  })
  // 截断标注：按「砍得最狠」排序取前 2 档（与跃迁同一取舍逻辑：宁可少标，不糊成一团）
  const truncTop = series.map(s => new Set([...s.truncPts].sort((a, b) => b.hint.cut - a.hint.cut).slice(0, 2)))
  const flat: { j: (typeof series)[number]['jumpPts'][number]; base: number }[] = []
  const offsets: number[] = []
  series.forEach((s, si) => {
    offsets.push(flat.length)
    for (const j of s.jumpPts) if (seriesTop[si]!.has(j)) flat.push({ j, base: s.base })
  })
  /**
   * **跃迁标注与截断标注一起分道 + 一起做碰撞剔除**（关键）：两套标注画在同一张图上，
   * 各算各的道必然互压——实测 `ui-check` 的标注重叠体检就是这么抓的。
   * 优先级 = 伤害增量（跃迁）/ 砍掉的次数（截断）——同一把「这一档多重要」的尺。
   */
  const truncFlat: { t: (typeof series)[number]['truncPts'][number]; base: number }[] = []
  series.forEach((s, si) => {
    for (const t of s.truncPts) if (truncTop[si]!.has(t)) truncFlat.push({ t, base: s.base })
  })
  const allBoxes = [
    ...flat.map(f => ({ x: f.j.cx, width: estimateLabelWidth(f.j.text) })),
    ...truncFlat.map(f => ({ x: f.t.cx, width: estimateLabelWidth(f.t.text) })),
  ]
  const lanes = assignLabelLanes(allBoxes, 6)
  const boxes = [
    ...flat.map((f, i) => ({ x: f.j.cx, y: f.j.cy - 11 - (lanes[i] ?? 0) * 15, width: estimateLabelWidth(f.j.text), height: 13 })),
    ...truncFlat.map((f, i) => ({ x: f.t.cx, y: f.t.cy - 11 - (lanes[flat.length + i] ?? 0) * 15, width: estimateLabelWidth(f.t.text), height: 13 })),
  ]
  const priorities = [
    ...flat.map(f => f.j.dmg - f.base),
    ...truncFlat.map(f => f.t.hint!.cut),
  ]
  const keepMask = pickNonOverlapping(boxes, priorities)
  const slotOf = new Map(flat.map((f, gi) => [f.j, gi]))
  const truncSlotOf = new Map(truncFlat.map((f, gi) => [f.t, flat.length + gi]))
  return series.map(s => ({
    ...s,
    jumpPts: s.jumpPts.map(j => {
      const gi = slotOf.get(j)
      return gi === undefined
        ? { ...j, lane: 0, labeled: false }
        : { ...j, lane: lanes[gi] ?? 0, labeled: keepMask[gi] ?? false }
    }),
    truncPts: s.truncPts.map(t => {
      const gi = truncSlotOf.get(t)
      return gi === undefined
        ? { ...t, lane: 0, labeled: false }
        : { ...t, lane: lanes[gi] ?? 0, labeled: keepMask[gi] ?? false }
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
      point: j.point,
      text: j.changes.map(c => cntRangeWithDmg(c, j.dmgChanges)).join('、'),
      attr: attributeDmgChanges(j.dmgChanges),
    })),
  ),
)
/**
 * 关键旋钮点 → 可读标签（tooltip / 面板 / 摘要表共用，**单一措辞来源**）。
 * 点名本身是机器可判定的四态（`KnobPointName`），这里只负责措辞。
 */
const POINT_LABELS: Record<KnobPointName, string> = {
  baseline: '① 最低（全关）',
  axis: '② 刚好实现轴模式',
  progress: '③ 重大进步',
  max: '④ 最高（拉满）',
}
function pointLabel(p: KnobPointName): string {
  return POINT_LABELS[p] ?? p
}
/**
 * 截断提醒面板的行（跨队铺平；数据源 = 各队 `truncated`）。
 * 队内按操作难度升序（沿曲线读），队间保持可见顺序——与图上「曲线的右边部分」读法一致。
 */
const curveTruncRows = computed(() =>
  curveSeriesPx.value.flatMap((s, si) =>
    [...s.truncPts]
      .sort((a, b) => a.cost - b.cost)
      .map((t, ti) => ({
        key: `${s.presetId}-${si}-t${ti}`,
        team: s.name,
        color: s.color,
        cost: t.cost,
        point: t.point,
        hint: t.hint,
      })),
  ),
)
/**
 * 只有全关起点被砍的队（`truncated` 为空、起点 `hint` 非空）：起点不进表，但不让该队静默消失——
 * 截断表给它一行说明（本档交互 → 实打，如实给数）。
 */
const curveTruncBaseOnly = computed(() =>
  curveSeriesPx.value.flatMap((s, si) => {
    const hint = s.truncated.length === 0 ? s.points.find(p => p.point === 'baseline')?.hint : null
    return hint ? [{ key: `${s.presetId}-${si}-base`, team: s.name, color: s.color, hint }] : []
  }),
)
/**
 * **逐点资源池明细**（用户 2026-10-16：「难度曲线中的点对应了计算值吗，能显示其资源池吗」
 * /「我本来想看看有没有 4 失衡，伤害为什么低」）。
 *
 * 数据源 = 该点的**现场差分**（`point.scene`，~2.1KB/点）+ 点开时重算一次（50–120ms，
 * `useCurvePointPool`）——不随点携带 41.5KB 的整份引擎结果（LRU 24 键 × 10 队 × 6 档 ≈ 38MB）。
 * 判据：`curvePointPool.test.ts`（重算伤害与该点 `dmg` 逐位相等 / 三份结果同源 / 竞态后发者胜）。
 */
const curvePool = useCurvePointPool()
/**
 * 残疾失衡载荷（逻辑在 composables/stunDiscreteDisplay.ts；展示层不 import @/core）。
 *
 * ⚠ 必须**声明在 `curvePool` 之后**、且传 **ref** 给模板、不许在 setup 顶层写 `.value`：
 * 旧写法在 `curvePool`（2285 行）之前执行 ⇒ TDZ「Cannot access 'curvePool' before initialization」，
 * 切到难度曲线页签 setup 直接中断（2026-10-22 实测）。
 * 窗长 / 有效时长取**该档资源池重算时的快照**（`curvePool.pool` 一并带出），不用 UI store——
 * 否则「点开某一档看到的残疾失衡」会用当前现场（而非那一档）的队友加成。
 */
const compareStunDiscrete = useStunDiscreteDisplay({
  pool: () => curvePool.pool.value?.stunPool ?? null,
  windowDuration: () => curvePool.pool.value?.windowDuration ?? null,
  effectiveTime: () => curvePool.pool.value?.effectiveTime ?? null,
})
/** 当前选中的点（`null` = 面板收起）。键 = 道键 + 点名，跨队不串味 */
const curvePoolPick = ref<{ laneKey: string; point: KnobPointName; cost: number } | null>(null)
/** 点是否可查明细：该档采到了现场（`collectScenes` 开着） */
function canInspectPoint(p: { scene?: unknown }): boolean {
  return !!p.scene
}
/**
 * 3D 图点选 → 认回 2D 那套「哪一道的哪个档」（`CurveDatum` 从 `buildCurveChart` 的 series 里按
 * `laneKey` + 点名 + 难度三元组查回——3D 组件只报身份，不搬数据，见其 `pick` 事件）。
 */
function onCurve3dPick(laneKey: string, point: KnobPointName, cost: number) {
  const s = curveData.value?.series.find(x => x.laneKey === laneKey)
  const p = s?.points.find(x => x.point === point && Math.abs(x.cost - cost) < 1e-9)
  if (s && p) void inspectCurvePoint(s.laneKey, p, 'point')
}

/** 点开/收起某一档的资源池明细（`source` = 被轴砍掉的档时带理由，面板上如实标注） */
async function inspectCurvePoint(laneKey: string, p: CurveDatum, source: 'point' | 'axisTruncated', reason = '') {
  const same = curvePoolPick.value?.laneKey === laneKey && curvePoolPick.value?.point === p.point && curvePoolPick.value?.cost === p.cost
  if (same) { curvePoolPick.value = null; curvePool.clear(); return }
  curvePoolPick.value = { laneKey, point: p.point, cost: p.cost }
  curvePoolPickReason.value = source === 'axisTruncated' ? reason : ''
  await curvePool.load(p.scene)
}
const curvePoolPickReason = ref('')
/** 轴态图例（唯一来源 = `axisMarkerLegend()`；页面不手写第二套形状↔含义映射） */
const axisLegend = axisMarkerLegend()
/**
 * 「这一档的轴」视图（R10）——**只从本档重算结果读**（`curvePool.pool.value`），不在页面重算判定。
 * `axisDetailOf` 的分组口径住 `composables/axisMarker.ts`（纯函数，有判据）。
 */
const curveAxisDetail = computed(() => {
  const picked = curvePoolPick.value
  const pool = curvePool.pool.value
  // 没选中点 / 本档还没重算完 ⇒ 空态（**不编**一个「无轴」出来）
  const empty = axisDetailOf(
    { kind: 'none', skipped: { time: 0, decibel: 0, energy: 0, sway: 0, family: 0 }, skippedTotal: 0, fallback: false },
    null,
    (slot, moveId) => axisMoveNameOf(slot, moveId),
  )
  if (!picked || !pool) return empty
  const series = curveData.value?.series.find(x => x.laneKey === picked.laneKey)
  // 曲线上的点优先；不在曲线上 = 被轴砍掉的档（`axisTruncated`）
  const pt = series?.points.find(x => x.point === picked.point && Math.abs(x.cost - picked.cost) < 1e-9)
  const axis = pt?.axis
    ?? series?.axisTruncated.find(t => t.point === picked.point && t.x !== undefined && Math.abs(t.x - picked.cost) < 1e-9)?.axis
  if (!axis) return empty
  return axisDetailOf(axis, pool.axisStack, (slot, moveId) => axisMoveNameOf(slot, moveId))
})
/** 交互 / 合轴吸收 / 合轴节省的三项并排（缺省 null + 原因，不写 0——见 `axisCompareOf`） */
const curveAxisCompare = computed(() => {
  const picked = curvePoolPick.value
  if (!picked) return axisCompareOf({})
  const series = curveData.value?.series.find(x => x.laneKey === picked.laneKey)
  const pt = series?.points.find(x => x.point === picked.point && Math.abs(x.cost - picked.cost) < 1e-9)
  const pool = curvePool.pool.value
  return axisCompareOf({
    interactions: pt?.interactions ?? null,
    absorb: pt?.knobs.absorb ?? null,
    stack: pool?.axisStack ?? null,
  })
})
/**
 * 招式名解析（轴视图用）：槽位 → 该槽角色 → 目录招式表。
 * 解析不到就回落 `moveId`（**不编名字**：编一个像真的中文比显示 id 更危险）。
 */
function axisMoveNameOf(slot: number, moveId: string): string {
  const skills = catalogStore.getAgentSkills(configStore.team[slot]?.agentId ?? '')
  const m = findMoveById(skills, moveId)
  // 走单一解析器（CC-456）：手写名称兜底会被 localizedSingleSource 源码锁拦下，别再散写
  return m ? localized(m.name, moveId) : moveId
}
/** 被砍档（R10 打叉）的悬停态：与曲线点 hover（`curveHover`）分开，两者图形不同、文案不同 */
const cutHover = ref<{ si: number; ci: number } | null>(null)
/** 选中点相对运行起点的**输入变动键**（诊断用：一眼看出这一档改了队伍还是机制设置） */
const curvePoolChangedKeys = computed<string[]>(() => {
  const pick = curvePoolPick.value
  if (!pick) return []
  const s = curveData.value?.series.find(x => x.laneKey === pick.laneKey)
  const p = s?.points.find(x => x.point === pick.point && Math.abs(x.cost - pick.cost) < 1e-9)
  return deltaKeys(p?.scene?.delta)
})
/** config state 键 → 可读名（只列难度曲线真会动的那些，其余回落键名——不编一个看起来像真的中文） */
const STATE_KEY_LABELS: Record<string, string> = {
  team: '队伍配置（角色/命座/音擎/驱动盘/交互次数/权重）',
  mechanicSettings: '机制设置（合轴吸收率等）',
  enemy: '敌人（Boss 数值）',
  globalBuffs: '全局 Buff（含关卡 buff）',
  appliedBoss: '已应用 Boss 预设',
  stunAxes: '失衡轴',
  stunAxisPlans: '轴内计划',
  useStunAxis: '轴模式开关',
  timeWeightStrategy: '时间权重策略',
  interactionsLocked: '交互锁定',
  teammateBuffSelections: '队友 Buff 勾选',
  wEngineEffectCoverages: '音擎效果覆盖率',
  discEffectCoverages: '驱动盘效果覆盖率',
  comboAlignOverrides: '合轴率覆盖',
}
function stateKeyLabel(key: string): string {
  return STATE_KEY_LABELS[key] ?? key
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
/**
 * tooltip 高度：最多 7 行（队名 / 难度+伤害 / 本档Δ / 本档新开 / 跃迁 / **截断提醒** / 录取累计），
 * 13px 行距 + 8px 内边距 ⇒ 99；取 110 留余量（截断提醒那一行只有被砍的档才有，故是上界不是常态）。
 */
const curveTtH = 110
const curveTtX = computed(() =>
  curveHoverPt.value ? Math.min(curveHoverPt.value.point.cx + 10, svgW.value - curveTtW - 20) : 0,
)
const curveTtY = computed(() =>
  curveHoverPt.value ? Math.max(0, Math.min(curveHoverPt.value.point.cy - 20, padT + plotH - curveTtH - 10)) : 0,
)
/**
 * 截断提醒的一行文案（tooltip 与面板共用，**同一份口径**）：
 * 「此档交互被砍到 X 次（本档交互 N）· 达标需难度 ≈ Z」/ 曲线内达不到时如实写「曲线内无法达到（最多 M 次）」。
 */
function truncHintText(h: { filled: number; played: number; cut: number; overflow: number; neededX: number | null; maxPlayed: number | null }): string {
  const cut = `此档交互被砍到 ${cntNum(h.played)} 次（本档交互 ${cntNum(h.filled)}${h.cut > 1e-6 ? `，少 ${cntNum(h.cut)} 次` : ''}${h.overflow > 1 ? `，截断 ${fmt(h.overflow, 1)}s` : ''}）`
  const reach = h.neededX !== null
    ? `达标需难度 ≈ ${fmt(h.neededX, 0)} 点`
    : `曲线内无法达到（最多 ${cntNum(h.maxPlayed ?? 0)} 次）`
  return `${cut} · ${reach}`
}
const curveHoverTips = computed(() => {
  const p = curveHoverPt.value
  if (!p) return []
  const { series: s, point } = p
  const band = `${pointLabel(point.point)} · 轴态 ${axisKindLabel(point.axis)}`
    + (point.point === 'baseline'
      ? '（静态权重、无保底、投影 off）'
      : `（交互 ${point.knobs.interactions === 'joint' ? '取最优分配' : '默认'} · 合轴吸收 ${fmt(point.knobs.absorb * 100, 0)}%）`)
  const major = majorChanges(point.changes)
  const minor = point.changes.length - major.length
  const attr = point.dmgChanges.length > 0 ? attributeDmgChanges(point.dmgChanges, 3, 1) : null
  /**
   * 非轴对照 + 坏轴提示（用户口径 2026-10-16）：
   * · 非轴参照 = 「同一支队关掉轴、易伤按时间均匀摊」的伤害（用户要的「模拟均匀战斗」对照）；
   * · 轴 < 非轴 ⇒ **这条轴比不打轴还差**（用户原话：「如果轴内捏一些垃圾招，可能还不如非轴」）——
   *   提示用户复查这条轴，**不是引擎缺陷**（见 `axisWorseThanNoAxis` 头注释）。
   */
  const na = point.noAxis
  const worse = axisWorseThanNoAxis(point)
  const vsNoAxis = na && na.dmg > 0
    ? (point.dmg >= na.dmg
        ? `｜非轴参照 ${compact(na.dmg)}（集中利用多赚 ${fmt((point.dmg / na.dmg - 1) * 100, 1)}%）`
        : `｜非轴参照 ${compact(na.dmg)}（⚠ 打轴反而亏 ${fmt((1 - point.dmg / na.dmg) * 100, 1)}%）`)
    : ''
  return [
    s.name,
    `操作难度 ${fmt(point.cost, 0)} 点 · 伤害 ${compact(point.dmg)}（${fmt(point.ratio, 1)}%）${vsNoAxis}`,
    attr
      ? `较上一档 Δ ${signedDmg(attr.totalDelta)} ← ${attr.top.map(c => `${c.label} ${signedDmg(c.delta)}`).join('、') || '（无正贡献）'}${attr.squeezed.length > 0 ? `｜挤掉 ${attr.squeezed.map(c => `${c.label} ${signedDmg(c.delta)}`).join('、')}` : ''}`
      : '本点无伤害变化（全关起点）',
    band,
    major.length > 0
      ? `跃迁：${major.map(c => cntRangeWithDmg(c, point.dmgChanges)).join('、')}${minor > 0 ? `（另有 ${minor} 项小数级微调）` : ''}`
      : (minor > 0 ? `仅小数级微调 ${point.changes.map(cntRange).join('、')}` : '本档无次数变化'),
    // 坏轴提示（用户 2026-10-16：「轴内捏一些垃圾招，可能还不如非轴」）——提示复查预设，不是引擎缺陷
    ...(worse ? [`⚠ 这条轴比不打轴还差 ${compact(worse)}（轴内可能有低收益招式）⇒ 建议复查该预设的轴`] : []),
    // 截断提醒（用户 2026-10-06）：只有被砍的档才有这一行
    ...(point.hint ? [`⚠ ${truncHintText(point.hint)}`] : []),
    // 连续失衡进度（用户 2026-10-23）：「再加点配置或交互就能达到完整失衡，进入下一阶段」
    ...(point.stunProgress && !point.stunProgress.atStep
      ? [`失衡进度 ${fmt(point.stunProgress.nextWindowProgress * 100, 0)}% —— 已完整 ${point.stunProgress.completeWindows} 次，`
        + `再攒 ${fmt(point.stunProgress.missingBuildUp, 0)} 点失衡值即可达到完整 ${point.stunProgress.completeWindows + 1} 次`
        + (point.stunProgress.missingInEatenWindows != null
          ? `（≈ 再多打 ${fmt(point.stunProgress.missingInEatenWindows, 2)} 个失衡窗的量）`
          : '')]
      : []),
    s.flat
      ? '无优化空间（④ 与 ① 同值）'
      : `关键点 ${s.steps.map(pointLabel).join(' → ')}${s.axisPointMissing ? '｜② 轴在任何难度下都不成立' : ''}`,
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
    // 第三轴（时间）：主C首池；未收录主C 明说「未收录」而不是留空（避免看着像 0/最早）
    p.release ? `主C首池 ${p.release.nodeLabel}（${p.release.date}）` : '主C首池：未收录（不参与时间着色）',
  ]
})

/** 击杀时间（秒）：伤害/血量 > 100% 时 = 战斗时长 × 100/hpRatio（2 倍伤害 → 90s，按 180s 基准） */
function killSeconds(hpRatio: number): number {
  if (hpRatio <= 100) return 0
  const battle = configStore.enemy.battleTime
  return Math.round(battle * 100 / hpRatio)
}

</script>

<style scoped src="./comparePage/team-compare-page.css">
</style>
