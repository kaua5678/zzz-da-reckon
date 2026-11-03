<template>
  <div class="team-config-page">
    <!-- 预设队伍（下拉，数据源 src/data/teamPresets/，与「队伍对比」页共用） -->
    <div class="preset-row">
      <span class="preset-label">预设队伍</span>
      <n-select
        v-model:value="cfgPresetGroupSel"
        :options="cfgPresetGroupOptions"
        size="small"
        style="width: 100px"
        placeholder="职业"
        title="先选职业 → 属性 → 队伍（2026-09-03 三级筛选；换人 + 自动配装）"
      />
      <n-select
        v-model:value="cfgPresetSubSel"
        :options="cfgPresetSubOptions"
        size="small"
        style="width: 100px"
        placeholder="属性"
        title="该职业下的属性/体系"
      />
      <n-select
        :value="presetSelectValue"
        :options="cfgPresetTeamOptions"
        :disabled="!catalogStore.buildRecsLoaded"
        :loading="catalogStore.buildRecsLoading"
        size="small"
        clearable
        filterable
        style="width: 240px"
        placeholder="选择预设队伍"
        @update:value="onPresetSelect"
      />
      <n-button size="small" type="primary" secondary @click="openGoldDialog">
        预设金数
      </n-button>
    </div>

    <n-alert
      v-if="!catalogStore.buildRecsLoaded"
      :type="catalogStore.buildRecsStatus === 'error' ? 'error' : 'info'"
      title="配装推荐未就绪"
      style="margin-bottom: 12px"
    >
      <p>{{ catalogStore.buildRecsError ?? '正在准备配装推荐' }}。推荐就绪后才能应用队伍预设。</p>
      <n-button size="small" :loading="catalogStore.buildRecsLoading" @click="catalogStore.loadBuildRecommendations()">
        {{ catalogStore.buildRecsStatus === 'error' ? '重试加载推荐' : '加载推荐' }}
      </n-button>
    </n-alert>

    <!-- 副词条自动分配预算（局外配装参数，2026-10-28 自资源利用率页迁入：
         它喂「配装推荐 · 一键应用 / 最优分配」，不是局内资源利用率） -->
    <n-card size="small" class="substat-budget-card" :bordered="true">
      <template #header>副词条自动分配预算</template>
      <div class="substat-budget-row">
        <span class="substat-budget-item">单属性上限
          <n-input-number :value="configStore.getMechanicSetting('optimizer.substatCap', 20)" size="tiny" :min="5" :max="39" :step="1" suffix="步" style="width:110px;margin-left:6px" @update:value="v => configStore.setMechanicSetting('optimizer.substatCap', Math.round(v ?? 20))" />
        </span>
        <span class="substat-budget-item">总步数 2词条
          <n-input-number :value="configStore.getMechanicSetting('optimizer.totalSteps2', 0)" size="tiny" :min="0" :max="60" :step="1" suffix="步" style="width:110px;margin-left:6px" @update:value="v => configStore.setMechanicSetting('optimizer.totalSteps2', Math.round(v ?? 0))" />
        </span>
        <span class="substat-budget-item">3词条
          <n-input-number :value="configStore.getMechanicSetting('optimizer.totalSteps3', 0)" size="tiny" :min="0" :max="60" :step="1" suffix="步" style="width:110px;margin-left:6px" @update:value="v => configStore.setMechanicSetting('optimizer.totalSteps3', Math.round(v ?? 0))" />
        </span>
        <span class="substat-budget-item">4词条
          <n-input-number :value="configStore.getMechanicSetting('optimizer.totalSteps4', 0)" size="tiny" :min="0" :max="60" :step="1" suffix="步" style="width:110px;margin-left:6px" @update:value="v => configStore.setMechanicSetting('optimizer.totalSteps4', Math.round(v ?? 0))" />
        </span>
        <span class="substat-budget-note">0 = 档位默认（2词→32 / 3词→39 / 4词→43）；修改后自动重算配装推荐</span>
      </div>
    </n-card>

    <!-- 上排：3个角色卡片 -->
    <div class="card-row">
      <CharacterCard
        v-for="i in 3"
        :key="i - 1"
        :slot="i - 1"
        :is-selected="uiStore.selectedSlot === i - 1"
        @select="uiStore.selectSlot"
      />
    </div>

    <!-- 下排：详细配置区域 + 面板预览 -->
    <div v-if="selectedChar" class="detail-section">
      <n-grid :cols="3" :x-gap="16">
        <!-- 左侧：角色详细配置（占2列） -->
        <n-gi :span="2">
          <n-card size="small" :bordered="true" class="detail-card">
            <template #header>
              <span>角色详细配置 - 槽位 {{ uiStore.selectedSlot + 1 }}</span>
            </template>

            <n-grid :cols="2" :x-gap="20">
              <!-- 左侧：角色、影画、音擎 -->
              <n-gi>
                <n-space vertical :size="14">
                  <!-- 角色选择 -->
                  <div class="section">
                    <div class="section-title">角色选择</div>
                    <n-select
                      :value="selectedChar.agentId || null"
                      :options="availableAgentOptions"
                      placeholder="选择角色"
                      filterable
                      size="small"
                      @update:value="onSelectAgent"
                    />
                  </div>

                  <!-- 影画等级 -->
                  <div class="section">
                    <div class="section-title">影画等级</div>
                    <div class="row-item">
                      <n-slider
                        :value="selectedChar.cinemaLevel"
                        :min="0"
                        :max="6"
                        :step="1"
                        style="flex: 1"
                        @update:value="v => configStore.setCinemaLevel(uiStore.selectedSlot, v)"
                      />
                      <n-input-number
                        :value="selectedChar.cinemaLevel"
                        :min="0"
                        :max="6"
                        size="small"
                        style="width: 80px; margin-left: 12px"
                        @update:value="v => configStore.setCinemaLevel(uiStore.selectedSlot, v ?? 0)"
                      />
                    </div>
                  </div>

                  <!-- 潜能等级 -->
                  <div class="section">
                    <div class="section-title">潜能等级</div>
                    <!--
                      潜能开关（2026-11-01 用户口径）：开关必须**紧贴标签**（曾写 margin-left:auto 把它顶到行最右，
                      用户实测"看不到"）；同时也踩过一次「模板用了 n-switch 但本文件没 import NSwitch ⇒ 未解析标签、
                      静默不渲染」（naive 组件是逐文件显式 import，没有全局注册，vue-tsc 看不见）——
                      两者都在 src/views/__tests__ 之外的实机 ui-check 里才暴露。
                    -->
                    <div v-if="supportsPotentialSwitch" class="row-item" style="margin-bottom: 8px">
                      <span class="field-label" style="display: inline-flex; align-items: center; gap: 8px">启用潜能
                        <n-switch
                          :value="selectedChar.potentialEnabled !== false"
                          size="small"
                          @update:value="(v: boolean) => configStore.setPotentialEnabled(uiStore.selectedSlot, v === true)"
                        />
                      </span>
                      <span class="field-hint">{{ selectedChar.potentialEnabled === false ? '已关：潜能整条不生效（等价潜能 I）' : '已开' }}</span>
                    </div>
                    <div class="row-item">
                      <n-slider
                        :value="selectedChar.potentialLevel ?? 6"
                        :min="1"
                        :max="6"
                        :step="1"
                        style="flex: 1"
                        @update:value="v => configStore.setPotentialLevel(uiStore.selectedSlot, v)"
                      />
                      <n-input-number
                        :value="selectedChar.potentialLevel ?? 6"
                        :min="1"
                        :max="6"
                        size="small"
                        style="width: 80px; margin-left: 12px"
                        @update:value="v => configStore.setPotentialLevel(uiStore.selectedSlot, v ?? 6)"
                      />
                    </div>
                  </div>

                  <!-- 音擎选择 -->
                  <div class="section">
                    <div class="section-title">音擎选择</div>
                    <n-select
                      :value="selectedChar.wEngineId || null"
                      :options="wengineOptions"
                      placeholder="选择音擎"
                      filterable
                      size="small"
                      @update:value="onSelectWEngine"
                    />
                  </div>

                  <!-- 精修等级 -->
                  <div class="section">
                    <div class="section-title">精修等级</div>
                    <div class="row-item">
                      <n-slider
                        :value="selectedChar.wEngineModLevel"
                        :min="1"
                        :max="5"
                        :step="1"
                        style="flex: 1"
                        @update:value="v => configStore.setWEngineModLevel(uiStore.selectedSlot, v)"
                      />
                      <n-input-number
                        :value="selectedChar.wEngineModLevel"
                        :min="1"
                        :max="5"
                        size="small"
                        style="width: 80px; margin-left: 12px"
                        @update:value="v => configStore.setWEngineModLevel(uiStore.selectedSlot, v ?? 1)"
                      />
                    </div>
                  </div>

                  <!-- 战斗动作次数 + 保底目标（折叠 tag） -->
                  <n-collapse class="section" :default-expanded-names="['battle-actions']">
                    <n-collapse-item title="战斗动作与保底目标" name="battle-actions">
                      <div class="guarantee-row">
                        <span class="section-title" style="margin-right: 12px">保底目标</span>
                        <n-checkbox :checked="guaranteeStun" @update:checked="v => setGuarantee('stun', v)">失衡次数四舍五入</n-checkbox>
                        <span v-if="guaranteeStunHint" class="muted" style="font-size: 12px; margin-right: 8px">{{ guaranteeStunHint }}</span>
                        <!-- 嗔火是般岳专属资源：队里没有般岳不显示（引擎侧 banyueSlot>=0 才消费） -->
                        <n-checkbox v-if="teamHasGuaranteeFury" :checked="guaranteeFury" @update:checked="v => setGuarantee('fury', v)">保底4嗔火</n-checkbox>
                      </div>
                      <!-- 动态合轴吸收上限（全局变量，用户口径 2026-09-19：默认队友的 40% 可以被吸收，超过了就无力合轴） -->
                      <div class="guarantee-row" title="Σ必要前台超预算时，队友前台按溢出量被合轴吸收（与操作角色并行），每名队友最多被吸收其净必要前台的这个比例；超过就无力合轴，剩余溢出照旧封顶/装配截断。难度曲线的「全关」按 0 算，G5 分档推进到此上限。">
                        <span class="section-title" style="margin-right: 12px">合轴吸收上限</span>
                        <n-input-number
                          :value="comboAlignAbsorbPct"
                          :min="0"
                          :max="100"
                          :step="5"
                          size="small"
                          style="width: 100px"
                          @update:value="v => setComboAlignAbsorbPct(v ?? 40)"
                        />
                        <span class="muted" style="font-size: 12px; margin-left: 8px">% 队友前台可被吸收（0 = 不吸收；缺省 40）</span>
                      </div>
                      <!-- 非轴「易伤贡献率」（用户裁决 2026-10-19：非轴不做自动认领，让用户自己填） -->
                      <div class="guarantee-row" title="没捏轴（非轴模式）时，引擎按「每招均匀落在失衡里」算易伤——真人会把大技能留到失衡窗，实际兑现的易伤比均匀摊更高，但哪个招式进窗只有你自己知道。所以这一项不由引擎猜：你按自己的打法填「时间覆盖率里实际兑现了多少」。100% = 每招均匀摊（旧口径，缺省）；觉得偏低就往下调。轴模式不受影响（轴里已经写明了每一招在不在失衡里）。">
                        <span class="section-title" style="margin-right: 12px">非轴·易伤贡献率</span>
                        <n-slider
                          :value="noAxisVulnSharePct"
                          :min="0"
                          :max="100"
                          :step="5"
                          style="width: 220px; display: inline-block; vertical-align: middle"
                          @update:value="v => setNoAxisVulnSharePct(v ?? 100)"
                        />
                        <span class="muted" style="font-size: 12px; margin-left: 8px">{{ noAxisVulnSharePct }}%（100% = 每招均匀摊；调低 = 你认为无轴打法只兑现了这么多失衡易伤）</span>
                      </div>
                      <!-- 手动锁定交互（用户口径 2026-10-06）：勾选 = 下方交互次数是用户明确意图，引擎不缩量、装不下如实报截断 -->
                      <div class="guarantee-row" title="勾选：下方「战斗动作次数」按你填的算——次数是明确的难度设定，引擎不再按时间可行性自动缩减交互，而是尽量用合轴（队友前台并行吸收）装下；实在装不下就在结果页如实报「时间截断 X 秒」。不勾选：装不下时引擎**按比例缩小你填的交互次数**（缩的是同一份输入，不是另算一套）。⚠ 另有一条**与本次数无关**的自动通道：Boss 声明了弹刀预算（如叶释渊 13 刀）时，引擎会按「失衡次数四舍五入」**反推弹刀次数**并填充（开关在同一行的「失衡次数四舍五入」）。">
                        <div class="guarantee-row" data-testid="interaction-strategy-controls" title="按完整引擎总伤给各槽选交互次数：提高交互到下一个节点若伤害提高就提高、否则不提高（失衡次数是分配结果，不是目标）。手动锁定时不改写输入。">
                          <span class="section-title" style="margin-right: 12px">自动最优交互（整队）</span>
                          <n-select
                            :value="configStore.timeWeightStrategy"
                            :options="timeWeightModeOptions"
                            :disabled="configStore.interactionsLocked || configStore.enemy.stunCountLock >= 0"
                            size="small"
                            style="width: 170px"
                            @update:value="v => configStore.setTimeWeightStrategy(v)"
                          />
                          <span class="muted" style="font-size: 12px; margin-left: 8px">0 交互 / 最优 / 最高 三档；失衡次数是结果不是目标</span>
                        </div>
                        <n-checkbox :checked="configStore.interactionsLocked" @update:checked="v => (configStore.interactionsLocked = v)">手动锁定交互</n-checkbox>
                        <span class="muted" style="font-size: 12px; margin-left: 8px">{{ interactionsLockedHint }}</span>
                      </div>
                      <div class="section-title">战斗动作次数</div>
                      <!-- 交互栏提示（用户口径 2026-10-14）：软 = 平A 被挤压/合轴在吸收；硬 = 超合轴上限 ⇒ 招式被截断。
                           纯函数 `buildInteractionHint`（引擎读数，非页面重算）⇒ 见 src/composables/interactionHint.ts -->
                      <div v-if="interactionHint.level !== 'none'" class="interaction-hint" :class="interactionHint.level" :title="interactionHintTitle">
                        {{ interactionHint.text }}
                      </div>
                      <!--
                        交互栏自适应网格（2026-10-17 用户报「交互栏太小了，输入框的数字都显示不出来」）。
                        原写法 `n-grid cols="6"` ⇒ 6 列**固定等分**：半栏宽 421px 减去 5×8px 间隙后
                        每格 **63.5px**，而 naive 的 n-input-number 默认带**加减按钮**（后缀实测占 36px）
                        ⇒ 输入区只剩 **5.5px**（实测 clientWidth=6、scrollWidth=9~18）⇒ 「10」这种两位数
                        直接看不见。现在改成 CSS 网格 auto-fill：每格至少 96px（够显示 3 位数 + 加减按钮），
                        半栏放 4 列、整栏放 6+ 列，按可用宽度自动排 —— 不再写死列数。
                      -->
                      <div class="action-grid">
                        <div>
                          <div class="field" title="对黄光的一次交互次数。招架型角色＝弹刀（轻弹刀＋支援突击）；回避型角色＝回避支援（1.166s 时停，不产伤害与失衡）＋支援突击。一个角色只能其一（用户 2026-09-15 口径）">
                            <span class="field-label">弹刀/回避次数<span v-if="interactionTopUpForSlot && interactionTopUpForSlot.parry > 0" class="field-hint">+{{ interactionTopUpForSlot.parry }}（自动补齐）</span><span v-if="parrySplitForSlot" class="field-hint">{{ parrySplitForSlot.label }}</span><span v-if="counterAssistForSlot > 0" class="field-hint">（控制技 {{ counterAssistForSlot }} 组已转反制支援）</span></span>
                            <n-input-number
                              :value="selectedChar.parryCount || interactionDefaults.parry"
                              :min="0"
                              :max="99"
                              size="small"
                              style="width: 100%"
                              @update:value="v => configStore.setActionCount(uiStore.selectedSlot, 'parryCount', v ?? 0)"
                            />
                          </div>
                        </div>
                        <div>
                          <div class="field">
                            <span class="field-label">闪避反击</span>
                            <n-input-number
                              :value="selectedChar.dodgeCounterCount || interactionDefaults.dodge"
                              :min="0"
                              :max="99"
                              size="small"
                              style="width: 100%"
                              @update:value="v => configStore.setActionCount(uiStore.selectedSlot, 'dodgeCounterCount', v ?? 0)"
                            />
                          </div>
                        </div>
                        <div v-if="interactionInputs.block">
                          <div class="field">
                            <span class="field-label">{{ interactionInputs.block?.label }}</span>
                            <n-input-number
                              :value="selectedChar.blockCount || interactionDefaults.block"
                              :min="0"
                              :max="99"
                              size="small"
                              style="width: 100%"
                              @update:value="v => configStore.setActionCount(uiStore.selectedSlot, 'blockCount', v ?? 0)"
                            />
                          </div>
                        </div>
                        <div v-if="interactionInputs.dualCounter">
                          <div class="field">
                            <span class="field-label">{{ interactionInputs.dualCounter?.label }}<span v-if="interactionTopUpForSlot && interactionTopUpForSlot.dual > 0" class="field-hint">+{{ interactionTopUpForSlot.dual }}（自动补齐）</span></span>
                            <n-input-number
                              :value="selectedChar.dualCounterCount || interactionDefaults.dual"
                              :min="0"
                              :max="99"
                              size="small"
                              style="width: 100%"
                              @update:value="v => configStore.setActionCount(uiStore.selectedSlot, 'dualCounterCount', v ?? 0)"
                            />
                          </div>
                        </div>
                        <!-- CC-65：角色专属计数输入框 → 模块声明 characterCountInputs（原 1551×2 / 1471 嘲讽取消 / 1541 / 1371×5 写死块） -->
                        <div v-for="inp in characterCountInputs" :key="inp.field">
                          <div class="field" :title="inp.title">
                            <span class="field-label">{{ inp.label }}<span v-if="inp.hint" class="field-hint">{{ inp.hint }}</span></span>
                            <n-input-number
                              :value="characterCountInputValue(inp, selectedChar[inp.field])"
                              :min="ACTION_COUNT_BOUNDS[inp.field].min"
                              :max="ACTION_COUNT_BOUNDS[inp.field].max"
                              size="small"
                              style="width: 100%"
                              :placeholder="inp.mode === 'autoIfNonPositive' ? '自动' : undefined"
                              @update:value="v => configStore.setActionCount(uiStore.selectedSlot, inp.field, v ?? characterCountInputClearValue(inp))"
                            />
                          </div>
                        </div>
                        <div>
                          <div class="field">
                            <span class="field-label">连携次数/失衡</span>
                            <n-input-number
                              :value="selectedChar.chainCountPerStun ?? 1"
                              :min="0"
                              :max="3"
                              size="small"
                              style="width: 100%"
                              @update:value="v => configStore.setActionCount(uiStore.selectedSlot, 'chainCountPerStun', v ?? 0)"
                            />
                          </div>
                        </div>
                        <div>
                          <div class="field">
                            <span class="field-label">平A时间权重</span>
                            <n-input-number
                              :value="selectedChar.basicAttackTimeWeight ?? selectedAgentDefaultTimeWeight"
                              :min="0"
                              :max="99"
                              :step="0.1"
                              size="small"
                              style="width: 100%"
                              @update:value="v => configStore.setActionCount(uiStore.selectedSlot, 'basicAttackTimeWeight', v ?? 0)"
                            />
                          </div>
                        </div>
                        <div>
                          <div class="field">
                            <span class="field-label">
                              权重分配策略
                              <n-tooltip trigger="hover" style="max-width: 360px">
                                <template #trigger><span class="field-hint">?</span></template>
                                **静态** = 不自动分配，用静态默认权重（强攻/异常/击破=1、支援/防护=0）或手填值。
                                **均衡（快，默认）** = 按**团队总伤**在槽位间转移平A 时间（≈3 倍求值）。
                                **联合（慢）** = 均衡 + 再搜**弹刀次数**（≈15~20 次求值 ~1.5s），硬门=不发生时间线截断
                                （前台净占用不超过总时间），越界候选一律回滚，所以弹刀不会无限加。
                                后两档都是坐标上升（只接受总伤上升）⇒ 逐队总伤不会变差；失衡次数/时间账的挪动如实上报。
                                队伍变更/切换档位时触发；**切回静态不会还原已写回的值**（要干净静态值就重新套一次预设）。
                              </n-tooltip>
                            </span>
                            <n-select
                              :value="configStore.timeWeightStrategy"
                              size="small"
                              style="width: 100%"
                              :options="timeWeightModeOptions"
                              @update:value="v => configStore.setTimeWeightStrategy(v)"
                            />
                          </div>
                        </div>
                      </div>
                    </n-collapse-item>
                  </n-collapse>

                  <!-- 音擎属性加成 -->
                  <div v-if="wengine" class="section">
                    <div class="section-title">音擎属性加成</div>
                    <div class="wengine-stats">
                      <div v-if="wengineImageUrl" class="wengine-icon-wrapper">
                        <img :src="wengineImageUrl" :alt="wengine.name.zhCN" class="wengine-icon" @error="wengineImgError = true" />
                      </div>
                      <div class="wengine-stats-text">
                        <div class="stat-row">
                          <span class="stat-name">{{ wengine.level60.baseStat === 'def' ? '基础防御' : '基础攻击' }}</span>
                          <span class="stat-value">{{ wengine.level60.atkBase }}</span>
                        </div>
                        <div v-if="wengine.level60.advancedStat" class="stat-row">
                          <span class="stat-name">{{ phaseStatLabel(wengine.level60.advancedStat.stat, 'outOfCombat') }}</span>
                          <span class="stat-value">{{ formatWEngineStat(wengine.level60.advancedStat) }}</span>
                        </div>
                        <div v-if="wengineEffectDesc" class="effect-desc">
                          <div class="effect-name">{{ wengineEffectName }}</div>
                          <div class="effect-text">{{ wengineEffectDesc }}</div>
                        </div>
                      </div>
                    </div>
                    <div class="wengine-logic-dev">
                      <div class="dev-title">音擎逻辑字段（开发）</div>
                      <div class="dev-line">
                        id={{ wengine.id }} · 稀有度={{ wengine.rarity }} · 职业={{ wengine.specialty }} · 匹配={{ wengine.specialty === currentAgent?.specialty ? '是' : '否' }}
                      </div>
                      <div
                        v-for="effect in wEngineLogicEffects"
                        :key="effect.id"
                        class="wengine-effect-row"
                      >
                        <div class="effect-tags">
                          <n-tag size="tiny" :bordered="false">{{ effect.source }}</n-tag>
                          <n-tag size="tiny" :bordered="false">{{ effect.type }}</n-tag>
                          <n-tag size="tiny" :bordered="false">{{ effect.stat }}</n-tag>
                          <n-tag size="tiny" :bordered="false">{{ effect.mode }}</n-tag>
                          <n-tag v-if="effect.stackText" size="tiny" :bordered="false">{{ effect.stackText }}</n-tag>
                        </div>
                        <div class="dev-line">
                          {{ effect.label }} = {{ effect.valueText }}
                        </div>
                        <div
                          v-if="effect.hasCoverage"
                          class="wengine-coverage"
                        >
                          <span class="coverage-label">覆盖率</span>
                          <n-slider
                            :value="effectiveWEngineCoverages[effect.id] ?? 100"
                            :min="0"
                            :max="100"
                            :step="5"
                            size="small"
                            style="flex: 1"
                            @update:value="v => setWEngineCoverageLinked(effect.id, v)"
                          />
                          <span class="coverage-value">{{ fmt(effectiveWEngineCoverages[effect.id] ?? 100, 1) }}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </n-space>
              </n-gi>

              <!-- 右侧：驱动盘配置 -->
              <n-gi>
                <n-space vertical :size="14">
                  <!-- 套装选择 -->
                  <div class="section">
                    <div class="section-title">套装选择</div>
                    <n-grid cols="3" :x-gap="8">
                      <n-gi>
                        <div class="field">
                          <span class="field-label">{{ threeInline ? '2件套 A' : '4件套' }}</span>
                          <n-select
                            :value="selectedChar.driveDisc.fourPieceSetId || null"
                            :options="setOptions"
                            filterable
                            size="small"
                            :placeholder="threeInline ? '选择第一套 2 件套' : '选择4件套'"
                            @update:value="v => configStore.setFourPieceSet(uiStore.selectedSlot, v || '')"
                          />
                        </div>
                      </n-gi>
                      <n-gi>
                        <div class="field">
                          <span class="field-label">{{ threeInline ? '2件套 B' : '2件套' }}</span>
                          <n-select
                            :value="selectedChar.driveDisc.twoPieceSetId || null"
                            :options="setOptions"
                            filterable
                            size="small"
                            :placeholder="threeInline ? '选择第二套 2 件套' : '选择2件套'"
                            @update:value="v => configStore.setTwoPieceSet(uiStore.selectedSlot, v || '')"
                          />
                        </div>
                      </n-gi>
                      <n-gi>
                        <!-- 第三套（2 件套）= 2+2+2 开关（用户 2026-10-29：洛克茜「摇摆2+月光2+34400×2」） -->
                        <div class="field">
                          <span class="field-label">第三套（2 件套）</span>
                          <n-select
                            :value="selectedChar.driveDisc.thirdTwoPieceSetId || null"
                            :options="setOptions"
                            filterable
                            clearable
                            size="small"
                            placeholder="留空 = 4+2"
                            @update:value="v => configStore.setThirdTwoPieceSet(uiStore.selectedSlot, v || '')"
                          />
                        </div>
                      </n-gi>
                    </n-grid>
                    <n-text v-if="threeInline" depth="3" style="font-size: 11px; display: block; margin-top: 4px">
                      已选第三套 ⇒ 形态 <b>2+2+2</b>：三套各 2 件，上面两套也**只按 2 件计**（4 件套效果不生效）。清空第三套即回到 4+2。
                    </n-text>
                    <!-- 套装图标预览 -->
                    <div v-if="fourPieceSetIcon || twoPieceSetIcon || thirdPieceSetIcon" class="set-icons-row">
                      <div v-if="fourPieceSetIcon" class="set-icon-item">
                        <img :src="fourPieceSetIcon" class="set-icon" @error="fourPieceImgError = true" />
                        <span class="set-icon-label">{{ threeInline ? '2件套 A' : '4件套' }}</span>
                      </div>
                      <div v-if="twoPieceSetIcon" class="set-icon-item">
                        <img :src="twoPieceSetIcon" class="set-icon" @error="twoPieceImgError = true" />
                        <span class="set-icon-label">{{ threeInline ? '2件套 B' : '2件套' }}</span>
                      </div>
                      <div v-if="thirdPieceSetIcon" class="set-icon-item">
                        <img :src="thirdPieceSetIcon" class="set-icon" @error="thirdPieceImgError = true" />
                        <span class="set-icon-label">第三套</span>
                      </div>
                    </div>

                    <!-- 套装效果清单（2026-09-08）：2pc/4pc 全部效果一律列出行——
                         触发/叠层类给覆盖率滑块，门槛类标「自动判定」，无效果的标「未建模」。
                         此前只出条件类，常驻/门槛套装看着像「属性没做」。 -->
                    <div v-if="discEffectRows.length" class="disc-coverage-section">
                      <div class="field-label" style="margin-top: 6px">套装效果（条件/叠层类可折算覆盖率）</div>
                      <div v-for="r in discEffectRows" :key="r.key" class="disc-coverage-row" :title="r.condition || r.gateText || ''">
                        <n-tag size="tiny" :bordered="false">{{ r.scope }}</n-tag>
                        <span class="coverage-label">
                          {{ r.label }} {{ r.valueText }}
                        </span>
                        <n-slider
                          v-if="r.adjustable"
                          :value="configStore.getDiscEffectCoverage(r.key)"
                          :min="0"
                          :max="100"
                          :step="5"
                          size="small"
                          style="flex: 1"
                          @update:value="v => setDiscCoverageLinked(r.setId, r.key, v)"
                        />
                        <span v-else style="flex: 1" />
                        <span class="coverage-value">
                          <template v-if="r.unmodeled">未建模</template>
                          <template v-else-if="r.gateText">门槛自动判定</template>
                          <template v-else-if="r.adjustable">{{ configStore.getDiscEffectCoverage(r.key) }}%</template>
                          <template v-else>恒开</template>
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- 主词条配置 -->
                  <div class="section">
                    <div class="section-title">主词条配置（4/5/6号位）</div>
                    <n-grid cols="4" :x-gap="8">
                      <n-gi v-for="slot in [4, 5, 6] as const" :key="slot">
                        <div class="field">
                          <span class="field-label">{{ slot }}号位</span>
                          <n-select
                            :value="selectedChar.driveDisc.mainStats?.[slot]"
                            :options="mainStatOptions(slot)"
                            size="small"
                            placeholder="主词条"
                            @update:value="v => configStore.setMainStat(uiStore.selectedSlot, slot, v)"
                          />
                        </div>
                      </n-gi>
                    </n-grid>
                  </div>

                  <!-- 副词条分配 -->
                  <div class="section">
                    <div class="section-title">
                      <n-space align="center" justify="space-between" style="width: 100%">
                        <span>副词条分配</span>
                        <n-space align="center" size="small">
                          <!-- 最优分配（2026-10-25 用户裁决「可以给一个最优计算的按钮」）：B 档显式开关——
                               缺省不自动跑，按钮文案自带成本；写入后本槽转「手动」（见 stores/config.ts#setSubStatAllocation） -->
                          <n-tooltip trigger="hover">
                            <template #trigger>
                              <n-button
                                size="tiny"
                                type="primary"
                                secondary
                                :loading="optimalComputing"
                                :disabled="!selectedChar?.agentId"
                                @click="runOptimalSubStats"
                              >
                                最优分配
                              </n-button>
                            </template>
                            按真实伤害配平本槽：4 号位主词条（暴击率↔爆伤）+ 2 件套（双爆）+ 副词条一起求
                            （含队友 buff / 全局 Buff，与伤害管线同一面板）。起点 = 上面的「配装推荐」默认档。
                            每次尝试都是真实求值（精修 4–44 次 + 组合 ≤4 次，实测 0.1–1.5 秒，上限 80 次）；
                            只要结果里暴击没白堆（面板暴击 ≤ 封顶 + 1 条）就不写溢出态。
                            写入后本槽标记「手动」，改预算设置不会再覆盖它（恢复自动分配点「配装推荐 · 一键应用」）。
                          </n-tooltip>
                          <!-- 自动/手改状态：预算设置只重算「自动」的槽位（见 stores/config.ts 的 watcher），
                               手改后要恢复自动分配，点「配装推荐 · 一键应用」 -->
                          <n-tag size="tiny" :bordered="false" :type="subStatManual ? 'warning' : 'default'">
                            {{ subStatManual ? '手动' : '自动（跟随预算设置）' }}
                          </n-tag>
                          <n-text depth="3" style="font-size: 11px">
                            总词条：{{ totalSubStats }}
                          </n-text>
                        </n-space>
                      </n-space>
                    </div>

                    <div class="sub-stats-grid">
                      <div
                        v-for="stat in subStatPool"
                        :key="stat"
                        class="sub-stat-row"
                      >
                        <span class="sub-stat-name">{{ statLabel(stat) }}</span>
                        <n-input-number
                          :value="getSubStatCount(stat)"
                          :min="0"
                          :max="54"
                          size="small"
                          style="width: 96px"
                          @update:value="v => configStore.setSubStatCount(uiStore.selectedSlot, stat, v ?? 0)"
                        />
                        <n-text depth="3" style="font-size: 11px; width: 56px; text-align: right">
                          {{ getSubStatValue(stat) }}
                        </n-text>
                      </div>
                    </div>
                  </div>
                </n-space>
              </n-gi>
            </n-grid>
          </n-card>
        </n-gi>

        <!-- 右侧：面板预览（占1列） -->
        <n-gi :span="1">
          <n-card size="small" :bordered="true" class="panel-card">
            <template #header>
              <n-space align="center" justify="space-between" style="width: 100%">
                <span>局内面板预览</span>
                <n-radio-group v-model:value="panelMode" size="small">
                  <n-radio-button value="inCombat">局内</n-radio-button>
                  <n-radio-button value="outOfCombat">局外</n-radio-button>
                </n-radio-group>
              </n-space>
            </template>
            <div v-if="currentPanel" class="panel-content">
              <StatPanel :panel="currentPanel" :damage-element="currentAgent?.damageElement" :default-expanded="['basic', 'base-10', 'dmg', 'stun', 'anomaly-build-up', 'anomaly-damage', 'enemy']" compact-preview />
            </div>
            <div v-else class="panel-empty">
              请选择角色以查看面板
            </div>
          </n-card>
        </n-gi>
      </n-grid>
    </div>

    <!-- 预设金数弹窗：设置当前队伍各槽位影画/精炼（金数口径见 teamCompare.ts） -->
    <n-modal
      v-model:show="goldDialogVisible"
      preset="card"
      title="预设金数"
      style="width: 640px; max-width: 95vw"
      :mask-closable="false"
    >
      <n-space vertical :size="14">
        <n-text depth="3" style="font-size: 12px; display: block">
          设置当前队伍的影画（命座）与精炼。金数口径：限定 S 角色本体/音擎本体各 1 金，影画与精炼每级 1 金；
          常驻角色（莱卡恩等）与常驻音擎不计。「应用」只改当前队伍配置（「队伍对比」页走预设文件的 goldSteps）；
          如需把当前命座/精炼写回预设文件，用下方「保存到预设文件」。
        </n-text>

        <!-- 加金档位快捷按钮（口径见 _template.json note：两位 = 一角色「影画+精炼」） -->
        <div class="gold-tiers">
          <n-button
            v-for="t in GOLD_TIERS"
            :key="t.label"
            size="tiny"
            secondary
            @click="applyTier(t)"
          >
            {{ t.label }}
          </n-button>
        </div>

        <!-- 各槽位：影画 + 精炼 -->
        <div v-for="i in 3" :key="i - 1" class="gold-slot-row">
          <div class="gold-slot-name">
            <span class="gold-slot-label">槽位 {{ i }}</span>
            <span class="gold-slot-agent">{{ agentName(i - 1) }}</span>
          </div>
          <div class="gold-slot-fields">
            <div class="gold-field">
              <span class="gold-field-label">影画</span>
              <n-slider
                :value="goldDraft.cinemas[i - 1]"
                :min="0"
                :max="6"
                :step="1"
                :disabled="!configStore.team[i - 1]?.agentId"
                style="flex: 1"
                @update:value="v => (goldDraft.cinemas[i - 1] = v ?? 0)"
              />
              <n-input-number
                :value="goldDraft.cinemas[i - 1]"
                :min="0"
                :max="6"
                size="small"
                :disabled="!configStore.team[i - 1]?.agentId"
                style="width: 64px"
                @update:value="v => (goldDraft.cinemas[i - 1] = v ?? 0)"
              />
            </div>
            <div class="gold-field">
              <span class="gold-field-label">精炼</span>
              <n-slider
                :value="goldDraft.mods[i - 1]"
                :min="1"
                :max="5"
                :step="1"
                :disabled="!configStore.team[i - 1]?.agentId"
                style="flex: 1"
                @update:value="v => (goldDraft.mods[i - 1] = v ?? 1)"
              />
              <n-input-number
                :value="goldDraft.mods[i - 1]"
                :min="1"
                :max="5"
                size="small"
                :disabled="!configStore.team[i - 1]?.agentId"
                style="width: 64px"
                @update:value="v => (goldDraft.mods[i - 1] = v ?? 1)"
              />
            </div>
          </div>
        </div>

        <!-- 保存到预设文件：把当前命座/精炼写回 goldSteps/standardSteps（浏览器无法直接写项目文件 → 下载 JSON 替换） -->
        <div class="gold-save-section">
          <div class="gold-save-row">
            <n-space align="center" :size="8">
              <span class="gold-save-label">保存到预设</span>
              <n-select
                v-model:value="saveTargetGroupSel"
                :options="cfgPresetGroupOptions"
                size="small"
                style="width: 90px"
                placeholder="职业"
              />
              <n-select
                v-model:value="saveTargetSubSel"
                :options="saveTargetSubOptions"
                size="small"
                style="width: 90px"
                placeholder="属性"
              />
              <n-select
                v-model:value="saveTargetId"
                :options="saveTargetOptions"
                size="small"
                filterable
                style="width: 220px"
                placeholder="选择目标预设文件"
              />
            </n-space>
            <n-space>
              <n-button size="small" :disabled="!saveTargetPresetId" @click="copyPresetJson">复制 JSON</n-button>
              <n-button size="small" type="primary" :disabled="!saveTargetPresetId" @click="savePresetJson">保存到预设文件</n-button>
            </n-space>
          </div>
          <n-text v-if="saveTargetPreset" depth="3" style="font-size: 12px; display: block">
            将把当前命座/精炼重写为 {{ saveStepsPreview.gold }} 条 goldSteps + {{ saveStepsPreview.standard }} 条 standardSteps（常驻角色/音擎不计限定金）。
            点击后下载 <code>{{ saveTargetPreset.id }}.json</code>，替换 <code>src/data/teamPresets/{{ saveTargetPreset.id }}.json</code> 后刷新页面生效。
          </n-text>
          <n-text v-if="saveTeamMismatch" type="warning" style="font-size: 12px; display: block">
            ⚠ 当前队伍与「{{ saveTargetPreset?.name }}」的阵容不一致，步骤将按槽位写入该预设队伍，请确认后再保存。
          </n-text>
        </div>

        <div class="gold-footer">
          <n-text style="font-size: 12px">
            总限定金：{{ goldTotal }} 金（影画 {{ goldDraft.cinemas.join('/') }} · 精炼 {{ goldDraft.mods.join('/') }}）
          </n-text>
          <n-space>
            <n-button size="small" @click="goldDialogVisible = false">取消</n-button>
            <n-button size="small" type="primary" @click="applyGoldDraft">应用</n-button>
          </n-space>
        </div>
      </n-space>
    </n-modal>

    <!-- 配装推荐（邦布精灵推荐） -->
    <div v-if="selectedChar?.agentId && buildRec" class="build-rec-section">
      <n-card size="small" :bordered="true">
        <template #header>
          <n-space align="center" justify="space-between" style="width: 100%">
            <span>配装推荐 - {{ buildRec.name.zhCN || buildRec.name.en }}</span>
            <n-button size="tiny" type="primary" secondary @click="configStore.applyBuildRecommendationForSlot(uiStore.selectedSlot)">
              一键应用
            </n-button>
          </n-space>
        </template>

        <n-grid :cols="4" :x-gap="12">
          <!-- 专武推荐 -->
          <n-gi v-if="buildRec.wengine">
            <div class="rec-block">
              <div class="rec-block-title">专武推荐</div>
              <div class="rec-wengine">
                <span class="rec-wengine-name">{{ buildRec.wengine.name_zh || buildRec.wengine.name_en }}</span>
                <n-text depth="3" style="font-size: 11px; display: block">
                  攻击 {{ buildRec.wengine.atk }} · {{ buildRec.wengine.sub_stat }}
                </n-text>
                <n-text v-if="buildRec.wengine.catalog_wengine_id" depth="2" style="font-size: 11px; color: var(--c-success)">
                  已匹配目录
                </n-text>
                <n-text v-else depth="3" style="font-size: 11px; color: #faad14">
                  未匹配目录
                </n-text>
              </div>
            </div>
          </n-gi>

          <!-- 驱动盘套装 -->
          <n-gi :span="buildRec.wengine ? 1 : 2">
            <div class="rec-block">
              <div class="rec-block-title">驱动盘套装</div>
              <div v-if="buildRec.drive_disc_sets.four_piece" class="rec-set-row">
                <n-tag size="tiny" type="success">{{ recThreeInline ? '2件·A' : '4件' }}</n-tag>
                <span class="rec-set-name">{{ buildRec.drive_disc_sets.four_piece.name_zh || buildRec.drive_disc_sets.four_piece.name_en }}</span>
              </div>
              <div v-if="buildRec.drive_disc_sets.two_piece" class="rec-set-row">
                <n-tag size="tiny" type="info">{{ recThreeInline ? '2件·B' : '2件' }}</n-tag>
                <span class="rec-set-name">{{ buildRec.drive_disc_sets.two_piece.name_zh || buildRec.drive_disc_sets.two_piece.name_en }}</span>
              </div>
              <div v-if="buildRec.drive_disc_sets.third_two_piece" class="rec-set-row">
                <n-tag size="tiny" type="info">第三套</n-tag>
                <span class="rec-set-name">{{ buildRec.drive_disc_sets.third_two_piece.name_zh || buildRec.drive_disc_sets.third_two_piece.name_en }}</span>
              </div>
              <div v-if="buildRec.drive_disc_sets.alt_two_piece" class="rec-set-row">
                <n-tag size="tiny" type="warning" secondary>备选</n-tag>
                <span class="rec-set-name">{{ buildRec.drive_disc_sets.alt_two_piece.name_zh || buildRec.drive_disc_sets.alt_two_piece.name_en }}</span>
              </div>
            </div>
          </n-gi>

          <!-- 主词条 -->
          <n-gi>
            <div class="rec-block">
              <div class="rec-block-title">主词条（4/5/6）</div>
              <div v-for="slot in [4, 5, 6]" :key="slot" class="rec-mainstat-row">
                <span class="rec-mainstat-slot">{{ slot }}号</span>
                <span class="rec-mainstat-name">{{ buildRec.main_stats?.[String(slot) as '4' | '5' | '6']?.name || '-' }}</span>
              </div>
            </div>
          </n-gi>

          <!-- 副词条优先级 -->
          <n-gi>
            <div class="rec-block">
              <div class="rec-block-title">副词条优先级</div>
              <div v-for="sub in buildRec.substats" :key="sub.prop" class="rec-substat-row">
                <span class="rec-substat-priority">{{ sub.priority }}</span>
                <span class="rec-substat-name">{{ sub.name }}</span>
              </div>
            </div>
          </n-gi>
        </n-grid>

        <!-- 策略说明 -->
        <div v-if="buildRec.strategy && buildRec.strategy.length > 1" class="rec-strategy">
          <n-text depth="3" style="font-size: 11px">
            {{ buildRec.strategy.slice(1).join(' · ') }}
          </n-text>
        </div>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import {
  NCard, NSpace, NGrid, NGi, NSelect, NSlider, NInputNumber, NText, NAlert,
  NRadioGroup, NRadioButton, NTag, NButton, NModal, NCollapse, NCollapseItem, NCheckbox, NSwitch, NTooltip, useMessage,
} from 'naive-ui'
import { useConfigStore, getInteractionDefaults, ACTION_COUNT_BOUNDS } from '@/stores/config'
import { useUiStore } from '@/stores/ui'
import { useCatalogStore } from '@/stores/catalog'
import { useStatLabel } from '@/composables/useStatLabel'
import { effectAtModLevel } from '@/composables/wEngineEffectDisplay'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanel } from '@/composables/resourceCalc/panelPhases'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { computeLoadoutPlanForSlot, slotPanelCritReader } from '@/composables/substatOptimizer'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import { DEFAULT_NO_AXIS_VULN_SHARE, NO_AXIS_VULN_SHARE_SETTING } from '@/composables/resourceCalc/noAxisVulnShare'
import CharacterCard from '@/components/CharacterCard.vue'
import StatPanel from '@/components/StatPanel.vue'
import { computeOutOfCombatPanel } from '@/composables/outOfCombatPanel'
import { getImageUrl } from '@/utils/image'
// ⚠ `isPctStat` = **展示**口径（UI 显示 % 还是绝对值）；全局 Buff 结算要的是 `statSettlementMode`（结算口径）——
// CC-51 起局外面板的全局 Buff 结算已搬到 composables/outOfCombatPanel.ts（那里用 statSettlementMode，
// 用展示口径会让同一份 Buff 在预览与引擎算出两个面板，实测 anomalyMastery 178 vs 192.4）。
import { isPctStat, phaseStatLabel } from '@/utils/statMeta'
import { compact, fmt, localized } from '@/utils/format'
import { groupEnginesForAgent } from '@/composables/enginePicker'
import { discSetGapLabel } from '@/utils/modelingGaps'
import { SPECIALTY_LABEL, ATTRIBUTE_LABEL } from '@/utils/agentLabelMaps'
import { buildDiscEffectRows } from '@/utils/discEffectRows'
import { withSkillTargetLabel } from '@/utils/skillTargetLabel'
import { stackGroupPeerIds } from '@/utils/stackGroupCoverage'
import type { WEngine, WEngineAdvancedStat, PanelValues, CharacterBuildRecommendation, BuffEffect, BuffGroup } from '@/types/catalog'
import type { CharacterConfig } from '@/stores/config'
import { agentCharacterCountInputs, characterCountInputValue, characterCountInputClearValue, agentInteractionInputs, teamHasGuaranteeFuryOwner, agentSupportsPotentialSwitch } from '@/composables/agentMechanicView'

const configStore = useConfigStore()
const uiStore = useUiStore()
const catalogStore = useCatalogStore()
const { statLabel, formatStatValue } = useStatLabel()

// ========== 预设队伍（下拉，与「队伍对比」页共用 src/data/teamPresets/） ==========
import { teamPresets } from '@/data/teamPresets'
import { usePresetFilter } from '@/composables/usePresetTeamPicker'
import { teamGoldOf, applyTeamPresetConfig } from '@/composables/teamCompare'
import { useTeamConfigPresetIO } from '@/composables/teamConfigPresetIO'
import { buildInteractionHint } from '@/composables/interactionHint'
const presetSelectValue = ref<string | null>(null)

/**
 * 交互/权重策略选项（默认 balanced；用户 2026-09-10 裁决，见 stores/config.ts#timeWeightStrategy）。
 *
 * 用户 2026-11-03：「通过交互次数最优调整一个队伍的 dps，不该是难度曲线的专利」
 * ⇒ 新增 zero / interaction-optimum / max 三档，入口就放在**交互栏旁**：
 *  · zero = 0 交互（全关原点，与难度曲线 ① 同义）；
 *  · interaction-optimum = 自动最优交互（净收益项拉满 + 按总伤取交互驻点）；
 *  · max = 最高操作难度（在最优基础上再把净收益项拉到用户上限）。
 */
const timeWeightModeOptions = [
  { label: '自动最优交互', value: 'interaction-optimum' },
  { label: '最高操作难度', value: 'max' },
  { label: '0 交互（全关）', value: 'zero' },
  { label: '静态（手填）', value: 'static' },
  { label: '均衡（快）', value: 'balanced' },
  { label: '联合（慢）', value: 'joint' },
]
/** 三级筛选（2026-09-03 用户：一级下拉装 99+ 条太多；cascader 弹层选项被裁剪 → 改三联动，
 *  与队伍/击破对比页同款交互；选项一律显示正式队伍名）。 */
const { groupSel: cfgPresetGroupSel, subSel: cfgPresetSubSel, groupOptions: cfgPresetGroupOptions, subOptions: cfgPresetSubOptions, teamOptions: cfgPresetTeamOptions } = usePresetFilter()  // CC-482
// 2026-10-11：两级各可「不限」（值为 null），故判据不再要求两级都选中——任一级一变就复位触发值，
// 否则从具体分类切到「不限」时上一次的触发值会留在框上。
watch([cfgPresetGroupSel, cfgPresetSubSel], () => { presetSelectValue.value = null })
/** 金数弹窗保存目标：三联动（职业/属性/队伍），选中即写 saveTargetPresetId */
const { groupSel: saveTargetGroupSel, subSel: saveTargetSubSel, subOptions: saveTargetSubOptions, teamOptions: saveTargetOptions } = usePresetFilter({ group: cfgPresetGroupSel.value, subgroup: cfgPresetSubSel.value })  // CC-482
const saveTargetId = ref<string | null>(null)
watch([saveTargetGroupSel, saveTargetSubSel], () => { saveTargetId.value = null })
watch(saveTargetId, id => { saveTargetPresetId.value = id })
/** 最近一次应用的预设 id（「预设金数」弹窗保存到预设文件时默认目标） */
const lastAppliedPresetId = ref<string | null>(null)
function onPresetSelect(id: string | number | null) {
  presetSelectValue.value = null // 下拉只做触发，即使未就绪也复位。
  const preset = teamPresets.find(t => t.id === id)
  if (!preset) return
  // 不排队等待推荐：延迟执行一次旧选择，同样可能覆盖用户期间的新编辑。
  if (!catalogStore.buildRecsLoaded) {
    message.warning('配装推荐尚未就绪，请加载成功后重新选择预设。')
    return
  }
  try {
    // CC-351：与分析器同一映射（预设音擎 / 交互等），主页算的就是队伍对比报的那支队；命座 / 精炼保留用户档位
    applyTeamPresetConfig(configStore, preset)
    lastAppliedPresetId.value = preset.id
  } catch (cause: unknown) {
    message.error(cause instanceof Error ? cause.message : '应用队伍预设失败')
  }
}

// ========== 预设金数（设置当前队伍各槽位影画/精炼，金数口径见 teamCompare.ts） ==========
const goldDialogVisible = ref(false)
const goldDraft = ref<{ cinemas: number[]; mods: number[] }>({ cinemas: [0, 0, 0], mods: [1, 1, 1] })

/** 加金档位快捷按钮（口径见 _template.json note：两位 = 一角色「影画+精炼」） */
const GOLD_TIERS: { label: string; cinemas: [number, number, number]; mods: [number, number, number] }[] = [
  { label: '全队 0命1精', cinemas: [0, 0, 0], mods: [1, 1, 1] },
  { label: '全队 2命1精（212121）', cinemas: [2, 2, 2], mods: [1, 1, 1] },
  { label: '主C 6命1精（612121）', cinemas: [6, 2, 2], mods: [1, 1, 1] },
  { label: '全队 6命1精（616161）', cinemas: [6, 6, 6], mods: [1, 1, 1] },
  { label: '全队 6命5精（656565）', cinemas: [6, 6, 6], mods: [5, 5, 5] },
]

const message = useMessage()

/** 保存到预设文件：目标预设 id（默认最近应用的预设） */
const saveTargetPresetId = ref<string | null>(null)

function openGoldDialog() {
  // 从当前队伍初始化草稿（刚应用预设 = 预设队伍）
  goldDraft.value = {
    cinemas: configStore.team.map(c => c.cinemaLevel),
    mods: configStore.team.map(c => c.wEngineModLevel),
  }
  saveTargetPresetId.value = lastAppliedPresetId.value
  goldDialogVisible.value = true
}

function applyTier(t: { cinemas: number[]; mods: number[] }) {
  goldDraft.value.cinemas = [...t.cinemas]
  goldDraft.value.mods = [...t.mods]
}

function applyGoldDraft() {
  for (let slot = 0; slot < 3; slot++) {
    configStore.setCinemaLevel(slot, goldDraft.value.cinemas[slot])
    configStore.setWEngineModLevel(slot, goldDraft.value.mods[slot])
  }
  goldDialogVisible.value = false
}

/** 弹窗内实时显示的总限定金（限定 S 角色/音擎 + 影画/精炼每级，常驻不计） */
const goldTotal = computed(() =>
  teamGoldOf(
    configStore.team.map(c => c.agentId),
    configStore.team.map(c => c.wEngineId),
    goldDraft.value.cinemas,
    goldDraft.value.mods,
  ),
)

function agentName(slot: number): string {
  const id = configStore.team[slot]?.agentId
  if (!id) return '（未选角色）'
  const agent = catalogStore.getAgent(id)
  return localized(agent?.name, id)
}

// ========== 保存到预设文件（下载 JSON 写回 goldSteps/standardSteps） ==========
// 实现已外置到 composables/teamConfigPresetIO.ts（依赖同名注入，见该文件头注释）。
// `buildPresetJson` 只被 savePresetJson/copyPresetJson 内部消费（两者已随实现外置），
// 页面侧不再直接引用 ⇒ 不解构（解构出来会触发 vue-tsc TS6133）。
const { saveTargetPreset, saveTeamMismatch, saveStepsPreview, savePresetJson, copyPresetJson } =
  useTeamConfigPresetIO({ configStore, goldDraft, saveTargetPresetId, message })

const selectedChar = computed<CharacterConfig>(() => configStore.team[uiStore.selectedSlot])
// 潜能开关（2026-11-01）：只有声明 potentialSwitch 的角色露出——老角色（11号等）不显示、行为不变
const supportsPotentialSwitch = computed(() => agentSupportsPotentialSwitch(selectedChar.value?.agentId))
// CC-65：角色专属计数输入框（模块声明）
const characterCountInputs = computed(() => agentCharacterCountInputs(selectedChar.value?.agentId))
// CC-65b：交互栏专属输入框（格挡/双反）
const interactionInputs = computed(() => agentInteractionInputs(selectedChar.value?.agentId))
// 交互次数默认值（如星徽·比利 招架4/闪反0/格挡5）：char 未填（0）时输入框预填展示，计算侧同口径
const interactionDefaults = computed(() => getInteractionDefaults(selectedChar.value?.agentId ?? ''))
// ========== 保底目标（0/1 勾选；预设轴/队伍应用时自动填充） ==========
// CC-65b：「保底4嗔火」开关归属走模块声明 ownsGuaranteeFury
const teamHasGuaranteeFury = computed(() => teamHasGuaranteeFuryOwner(configStore.team))
const guaranteeStun = computed(() => configStore.getMechanicSetting('guarantee.stun', 0) !== 0)
const guaranteeFury = computed(() => configStore.getMechanicSetting('guarantee.fury', 0) !== 0)
/**
 * ⚠ 2026-10-23：`guaranteeUltimateHint`（喧响四舍五入·诚实显示）已随「保底4喧响」功能整体删除。
 * 用户裁决：「保底4喧响我记得已经删了啊，现在的是根据喧响四舍五入吧。保底4喧响太没有实际价值了」
 * 「改吧，这个保底是余孽，不要再用了」。
 * 本项原本在页面手写「缺口 X → ⌈X/215⌉ = N 次」提示（CC-229 才改成直读引擎决策），
 * 功能删除后引擎不再产出该决策，提示一并删除——不再有任何 UI 入口。
 */
function setGuarantee(kind: 'stun' | 'fury', v: boolean) {
  configStore.setMechanicSetting(`guarantee.${kind}`, v ? 1 : 0)
}
// 非轴·易伤贡献率 φ（用户裁决 2026-10-19：引擎不替用户认领，改成用户自己填）。机制参数键与缺省值
// 走单一来源（composables/resourceCalc/noAxisVulnShare.ts），页面不复制字面量（规则 11）。
// 措辞按「游戏场景措辞」——**不出现「集中度」这种术语**。
const noAxisVulnSharePct = computed(() =>
  Math.round(configStore.getMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, DEFAULT_NO_AXIS_VULN_SHARE) * 100))
function setNoAxisVulnSharePct(v: number) {
  const pct = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : DEFAULT_NO_AXIS_VULN_SHARE * 100
  configStore.setMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, Math.round(pct) / 100)
}

// 动态合轴吸收上限（机制参数 time.comboAlignAbsorbRatio，0..1；页面按百分比录入）
const comboAlignAbsorbPct = computed(() =>
  Math.round(configStore.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO) * 100))
function setComboAlignAbsorbPct(v: number) {
  const pct = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : DEFAULT_COMBO_ALIGN_ABSORB_RATIO * 100
  configStore.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, Math.round(pct) / 100)
}
// 自动补齐（保底语义，轴模式或保底开关驱动，现唯一产出者般岳；CC-296 起非轴也显示）：弹刀/双反在交互栏输入之上补的量（懒计算，仅产出者槽位选中时非空；
// 槽位 = 挂出 computeInteractionTopUp 能力的角色（CC-293），故弹刀提示不必再判角色 id —— CC-65b）
const { interactionTopUp, parrySplitResult, guaranteeStunShortfallResult, resourceResult, effectiveWEngineCoverages } = useResourceCalc()
/**
 * 手动锁定交互·诚实显示（用户口径 2026-10-06「实在做不到就说哪里做不到」）：
 * 勾选后引擎不缩交互 ⇒ 装不下的部分不再被降配吸收，只会表现为**装配期截断**。
 * 这里把 `overflowSeconds` 直接露出来（引擎读数，非页面自算），避免「勾了却没反应」的错觉。
 * 未勾选时不显示（自动降配会把截断压到容差内，读数没有解释价值）。
 */
const interactionsLockedHint = computed(() => {
  // 更正（2026-11-03）：旧文案「引擎按难度曲线自动调交互次数」把两条不相干的通道说混了——
  // 本开关只管**非轴降配**（时间可行性缩你填的次数）；「按 Boss 弹刀预算反推弹刀」由「失衡次数四舍五入」管。
  if (!configStore.interactionsLocked) return '（未勾选：装不下时引擎按时间可行性自动缩交互次数）'
  const cut = resourceResult.value?.overflowSeconds ?? 0
  return cut > 1
    ? `（已锁定：装不下，时间截断 ${cut.toFixed(1)}s —— 结果页「时间截断」有被砍招式明细）`
    : '（已锁定：当前配置装得下，按你填的次数计算）'
})
/** 失衡次数四舍五入·未达成如实显示（CC-156）：弹刀预算内补不满时引擎按实际池计数算，这里把降级露出来 */
const guaranteeStunHint = computed(() => {
  const s = guaranteeStunShortfallResult.value
  if (!s) return ''
  const why = s.cause === 'parry-exhausted' ? `，Boss 弹刀 ${s.parryTotal} 次已全部反推给击破位仍不够`
    : s.cause === 'no-parry-budget' ? '，当前 Boss 没有可反推的弹刀预算' : ''
  return `（未达成：失衡池 ${s.stunCount} 次${why}）`
})
const interactionTopUpForSlot = computed(() => {
  const t = interactionTopUp.value
  return t && t.slot === uiStore.selectedSlot ? t : null
})
/**
 * **交互栏提示**（用户口径 2026-10-14，逐字）：
 * > 「需要在交互栏旁边给个提示，**平A时间被挤压成多少秒，合轴率提升，是软提示**，
 * >  **硬提示是你这个交互提升超过合轴上限后，招式因为超时而截断**。」
 *
 * 判据全在纯函数 `buildInteractionHint`（引擎读数：平A 池 / 合轴吸收 / 截断明细），
 * 页面只做渲染与槽位传递。⚠ 传**槽位号**（`uiStore.selectedSlot`），函数内部按身份 `.find`
 * —— `characters` 按位置压缩，槽位号 ≠ 下标（AGENTS §2）。
 * ⚠ 容差用函数缺省（1s，= 引擎 `TIME_BUDGET_TOLERANCE_SECONDS`）——**展示层不得 import `@/core`**
 * （exhibition-layer 棘轮），故不在此引用该常量；两处同值由 `interactionHint.test.ts` 锁。
 */
const interactionHint = computed(() =>
  buildInteractionHint(resourceResult.value, uiStore.selectedSlot))
const interactionHintTitle = computed(() => {
  const h = interactionHint.value
  const parts = [
    `平A 池 ${h.basicAttackTime.toFixed(2)}s`,
    h.absorbedSeconds > 0 ? `合轴吸收 ${h.absorbedSeconds.toFixed(1)}s` : '',
    h.truncatedSeconds > 0 ? `时间截断 ${h.truncatedSeconds.toFixed(1)}s` : '',
  ].filter(Boolean)
  return parts.join(' · ')
})
// Boss 预设弹刀反推（失衡次数四舍五入）：击破位显示「→ 有效次数（含无突击弹刀/保底反推）」、未手填的主C 显示「→ 剩余（Boss 默认）」
const parrySplitForSlot = computed<{ label: string } | null>(() => {
  const p = parrySplitResult.value
  if (!p) return null
  const slot = uiStore.selectedSlot
  const char = configStore.team[slot]
  if (!char?.agentId) return null
  if (slot === p.breakerSlot) {
    const total = p.breakerParry + p.breakerNoFollowUp + p.breakerDecibelOnly
    if (total <= 0) return null
    const noFollowNote = p.breakerNoFollowUp > 0 ? `含无突击 ${p.breakerNoFollowUp}` : ''
    const decibelOnlyNote = p.breakerDecibelOnly > 0 ? `只喧响 ${p.breakerDecibelOnly}` : ''
    const topUpNote = p.topUp > 0 ? `保底反推 +${p.topUp}` : ''
    const notes = [noFollowNote, decibelOnlyNote, topUpNote].filter(Boolean).join(' · ')
    return { label: `→ ${total}${notes ? `（${notes}）` : ''}` }
  }
  if (slot === 0 && (char.parryCount ?? 0) <= 0 && p.mainDpsParry > 0) {
    return { label: `→ ${p.mainDpsParry}（主C补齐）` }
  }
  return null
})
/** 本槽位承接的反制支援次数（= boss 控制技组数，store 折算；0 = 该槽位不替换/未应用带控制技的 Boss）。
 *  次数由 Boss 预设决定、非手填，故只在标签里露出，不给输入框（避免与「弹刀次数」抢同一个数）。 */
const counterAssistForSlot = computed(() =>
  configStore.counterAssistSlot === uiStore.selectedSlot
    ? (configStore.appliedBoss?.counterAssistGroups?.length ?? 0)
    : 0,
)
// 自动轴命中 → 保底目标预填：CC-349 移至 UI store 会话效果（stores/config#useConfigStore），不再依赖本页挂载
const currentAgent = computed(() => {
  const id = selectedChar.value?.agentId
  return id ? catalogStore.getAgent(id) ?? null : null
})
const selectedAgentDefaultTimeWeight = computed(() => configStore.getDefaultBasicAttackTimeWeight(currentAgent.value))


/** 图片加载失败状态（切换角色/音擎/套装时重置） */
const wengineImgError = ref(false)
const fourPieceImgError = ref(false)
const twoPieceImgError = ref(false)
const thirdPieceImgError = ref(false)
watch(() => selectedChar.value?.wEngineId, () => { wengineImgError.value = false })
watch(() => selectedChar.value?.driveDisc?.fourPieceSetId, () => { fourPieceImgError.value = false })
watch(() => selectedChar.value?.driveDisc?.twoPieceSetId, () => { twoPieceImgError.value = false })

const wengine = computed<WEngine | null>(() => {
  const id = selectedChar.value?.wEngineId
  if (!id) return null
  return catalogStore.getWEngine(id) ?? null
})

/** 音擎图片URL（source为直接图片链接时可用） */
const wengineImageUrl = computed(() => {
  if (!wengine.value?.images || wengineImgError.value) return null
  return getImageUrl(wengine.value.images)
})

/** 4件套图标URL */
const fourPieceSetIcon = computed(() => {
  const setId = selectedChar.value?.driveDisc?.fourPieceSetId
  if (!setId || fourPieceImgError.value) return null
  const set = catalogStore.getDriveDiscSet(setId)
  if (!set?.images) return null
  return getImageUrl(set.images)
})

/** 推荐条目是否 2+2+2（给了第三套就是；标签跟着变，避免把「第一套 2 件」读成 4 件套） */
const recThreeInline = computed(() => !!buildRec.value?.drive_disc_sets.third_two_piece)

/** 是否 2+2+2 形态（第三套已选）——判定单源 = driveDisc.thirdTwoPieceSetId 本身（引擎同口径） */
const threeInline = computed(() => !!selectedChar.value?.driveDisc?.thirdTwoPieceSetId)

/** 第三套图标URL */
const thirdPieceSetIcon = computed(() => {
  const setId = threeInline.value ? selectedChar.value?.driveDisc?.thirdTwoPieceSetId : undefined
  if (!setId || thirdPieceImgError.value) return null
  const set = catalogStore.getDriveDiscSet(setId)
  if (!set?.images) return null
  return getImageUrl(set.images)
})

/** 2件套图标URL */
const twoPieceSetIcon = computed(() => {
  const setId = selectedChar.value?.driveDisc?.twoPieceSetId
  if (!setId || twoPieceImgError.value) return null
  const set = catalogStore.getDriveDiscSet(setId)
  if (!set?.images) return null
  return getImageUrl(set.images)
})

// 面板模式：局内 / 局外
const panelMode = ref<'inCombat' | 'outOfCombat'>('inCombat')

/** 计算当前选中角色的面板 */
const currentPanel = computed<PanelValues | null>(() => {
  const char = selectedChar.value
  if (!char?.agentId) return null
  if (panelMode.value === 'inCombat') {
    return computePanel(uiStore.selectedSlot, configStore, catalogStore, effectiveWEngineCoverages.value)
  }
  // CC-51：局外面板（基础面板 + 全局 Buff）搬到编排层，与局内 computePanel 对称（判据 7）
  return computeOutOfCombatPanel(uiStore.selectedSlot, configStore, catalogStore)
})

// 特化/属性中文名：定义已外置到 utils/agentLabelMaps.ts（角色下拉标签 + 套装效果门槛标签共用同一份）

// 可选角色列表（过滤掉已选的）
const availableAgentOptions = computed(() => {
  const used = configStore.usedAgentIds
  const currentId = selectedChar.value?.agentId
  return catalogStore.displayAgents
    .filter(a => !used.includes(a.id) || a.id === currentId)
    .map(a => {
      const name = localized(a.name, a.id)
      const specialty = SPECIALTY_LABEL[a.specialty] ?? a.specialty
      const attr = ATTRIBUTE_LABEL[a.attribute] ?? a.attribute
      return {
        label: `${name} · ${a.rarity} · ${specialty} · ${attr}`,
        value: a.id,
      }
    })
})

/**
 * 音擎下拉：**同职业排前面**（用户 2026-10-26：「这下拉菜单点进去太多了，能不能把同职业的放在前面，
 * 因为同职业才能触发武器效果」）。
 *
 * 85 件平铺的下拉里，跨职业的 60 多件穿了只有白值、被动全废（`wEngineEffectRequirementMet` 直接 false）。
 * 现在分两组：「✓ 同职业（被动可触发）」+「× 其它职业（被动不触发）」，组内保持原顺序
 * （该角色实战常用件排最前）。口径在 `composables/enginePicker.ts`（有判据）。
 */
const wengineOptions = computed(() =>
  groupEnginesForAgent(
    catalogStore.displayWEngines,
    selectedChar.value?.agentId ? catalogStore.getAgent(selectedChar.value.agentId)?.specialty : undefined,
    selectedChar.value?.agentId,
  ),
)

const setOptions = computed(() =>
  catalogStore.displayDriveDiscSets.map(s => ({
    // 未建模角标（2pc/4pc 只有文本无数值效果，选了也是白板）
    label: localized(s.name, s.id) + discSetGapLabel(s),
    value: s.id,
  })),
)

/** 当前角色 2pc/4pc 效果清单（常驻/门槛/触发分类如实标出，触发类一条一个覆盖率滑块） */
const discEffectRows = computed(() => {
  const dd = selectedChar.value?.driveDisc
  if (!dd) return []
  const four = dd.fourPieceSetId ? catalogStore.driveDiscSetsMap.get(dd.fourPieceSetId) : undefined
  const two = dd.twoPieceSetId ? catalogStore.driveDiscSetsMap.get(dd.twoPieceSetId) : undefined
  // 2+2+2：第三套进清单 ⇒ 三套各 2 件、无 4 件段（与 core/buff.ts#resolveDiscSetPieces 同口径）
  const third = dd.thirdTwoPieceSetId ? catalogStore.driveDiscSetsMap.get(dd.thirdTwoPieceSetId) : undefined
  return buildDiscEffectRows(four, two, {
    specialty: code => SPECIALTY_LABEL[code] ?? code,
    attribute: code => ATTRIBUTE_LABEL[code] ?? code,
    stat: code => statLabel(code),
  }, third)
})

function onSelectAgent(id: string | null) {
  if (id) {
    configStore.setAgent(uiStore.selectedSlot, id)
  }
}

function onSelectWEngine(id: string | null) {
  if (id) {
    configStore.setWEngine(uiStore.selectedSlot, id)
  }
}

function formatWEngineStat(stat: WEngineAdvancedStat): string {
  if (!stat) return '-'
  const val = stat.value
  if (stat.mode === 'pct' || stat.mode === 'decimal') {
    return `${val}%`
  }
  return String(val)
}

const wengineEffectName = computed(() => {
  if (!wengine.value) return ''
  return localized(wengine.value.effect.name)
})

const wengineEffectDesc = computed(() => {
  if (!wengine.value) return ''
  return localized(wengine.value.effect.description)
})

function effectValueText(raw: BuffEffect): string {
  // CC-210：精炼取值走引擎同一函数 applyWEngineModLevel（经 composable），不再自己索引 modificationValues
  const effect = effectAtModLevel(raw, selectedChar.value.wEngineModLevel)
  if (effect.type === 'stacked') return `${effect.valuePerStack ?? effect.value} × ${effect.defaultStacks ?? effect.maxStacks ?? 1}层`
  if (effect.type === 'derived') return `${localized(effect.sourceLabel) || effect.basis || effect.sourceStat || '来源'} × ${effect.ratio ?? 0}%${effect.cap ? `，上限 ${effect.cap}` : ''}`
  if (effect.type === 'formula') return effect.formula?.expression ?? '公式'
  return `${effect.value ?? 0}`
}

function collectWEngineGroupEffects(group: BuffGroup | null | undefined, source: string) {
  return (group?.effects ?? []).map(effect => {
    const stackText = effect.type === 'stacked'
      ? `${localized(effect.stackLabel) || '叠层'} ${effect.defaultStacks ?? effect.maxStacks ?? 1}/${effect.maxStacks ?? effect.defaultStacks ?? 1}`
      : ''
    return {
      ...effect,
      source,
      // 定向标签（2026-10-18）：与驱动盘套装行共用 `utils/skillTargetLabel`。
      // 修前音擎行只显示「招式类型伤害加成」，看不出这条是普攻/冲刺攻击/终结技限定
      // （实测 14124 两条 basic/dashAttack、14146 两条 basic/ultimate 全部丢失招式信息）。
      label: withSkillTargetLabel(phaseStatLabel(effect.stat, group?.scope ?? 'inCombat'), effect),
      valueText: effectValueText(effect),
      stackText,
      // CC-111（R5 D7）：带持续时间（效果级或组级）的 fixed 效果也给滑块（引擎 applyEffect 对 fixed 同样乘覆盖率；默认 100% 不变）。
      // 2026-10-18（与驱动盘 `discEffectRows#adjustable` 同一口径）：`condition` 也是触发信号 ——
      // 「拥有充能效果」「从背后攻击命中」「拥有 2 层增益效果」这类**没有时长也没有 coverage 字段**的条件效果
      // 修前既没有滑块、引擎又恒按 100% 结算 ⇒ 页面上看不出「这条到底按多少覆盖率算的」。
      // 实测 7 条（14124/14102/14138/14146×2/14152）。给了滑块后默认仍是 100%（行为不变），
      // 但用户能把「打不满」的情况表达出来。
      hasCoverage: effect.type === 'stacked' || !!effect.coverage || !!effect.condition
        || effect.durationSeconds != null || group?.durationSeconds != null,
    }
  })
}

const wEngineLogicEffects = computed(() => {
  if (!wengine.value || !['S', 'A'].includes(wengine.value.rarity)) return []
  return [
    ...collectWEngineGroupEffects(wengine.value.effect?.selfBuff, '自身'),
    ...collectWEngineGroupEffects(wengine.value.effect?.teamBuff, '团队'),
  ]
})

// CC-111（R5 D3）：同 stackGroup 的效果共享叠层状态 ⇒ 覆盖率滑块联动（引擎仍按 effect.id 读）。
function setWEngineCoverageLinked(effectId: string, v: number) {
  const members = wEngineLogicEffects.value.filter(e => !!e.id).map(e => ({ id: e.id as string, stackGroup: e.stackGroup }))
  for (const id of stackGroupPeerIds(members, effectId)) configStore.setWEngineEffectCoverage(id, v)
}
function setDiscCoverageLinked(setId: string, key: string, v: number) {
  const members = discEffectRows.value.filter(r => r.setId === setId && r.adjustable).map(r => ({ id: r.key, stackGroup: r.stackGroup }))
  for (const id of stackGroupPeerIds(members, key)) configStore.setDiscEffectCoverage(id, v)
}

function mainStatOptions(slot: number) {
  const pool = catalogStore.statRules?.driveDisc?.mainStatPools?.[String(slot)] ?? []
  return pool.map((s: string) => ({
    label: statLabel(s),
    value: s,
  }))
}

const subStatPool = computed(() => {
  return catalogStore.statRules?.driveDisc?.subStatPool ?? [
    'hpFlat', 'atkFlat', 'defFlat', 'hpPct', 'atkPct', 'defPct',
    'critRate', 'critDmg', 'anomalyProficiency', 'penFlat',
  ]
})

function getSubStatCount(stat: string): number {
  return selectedChar.value?.driveDisc?.subStatAllocation?.[stat] ?? 0
}

function getSubStatValue(stat: string): string {
  const count = getSubStatCount(stat)
  if (!count) return '-'
  const step = catalogStore.statRules?.driveDisc?.sRankSubStatBaseStep?.[stat] ?? 0
  if (!step) return '-'
  const value = step * count // count即升级步数，不再乘2.25
  return formatStatValue(stat, value, isPctStat(stat) ? 'pct' : 'flat')
}

/** 当前槽位的副词条是「手改」还是「自动分配」（决定改预算设置时会不会被重算，见 stores/config.ts） */
const subStatManual = computed(() => !!configStore.subStatAllocationManual[uiStore.selectedSlot])

/**
 * 「最优分配」：在**独立场景**上跑双爆配平（composables/substatOptimizer.ts#computeLoadoutPlanForSlot），
 * 把 **4 号位主词条 / 2 件套 / 副词条一起**写回 UI store（载入到的 4 号位与 2 件套都是双爆来源，
 * 配平宽度 = 10 + 3.33 条词条，只写副词条兑现不了溢出折算；口径见该模块文件头「双爆配平」段）。
 * 不写 UI store 试算这一点不变（CC-343 口径）。
 *
 * 为什么是显式按钮而不是默认行为（ENGINE_PIPELINE_GUIDE §4 坑 53 的 B 档）：
 * 一次 = 组合枚举 + 精修，实测 4–44 次全量求值（上限 maxEvals=80，组合数另计 ≤4）≈ 0.1–1.5s，
 * 且结果是「近似最优」不是不变量；默认静默跑会让每次换人/改预算都卡一下，还会替用户改 4 号位与套装。
 */
const optimalComputing = ref(false)
async function runOptimalSubStats() {
  const slot = uiStore.selectedSlot
  if (!selectedChar.value?.agentId || optimalComputing.value) return
  optimalComputing.value = true
  try {
    const res = await withAnalysisScenario(async (s) => {
      const char = s.config.team[slot]
      if (!char?.agentId) return null
      const before = s.calc.teamTotalDamage.value ?? 0
      let evals = 0
      const plan = computeLoadoutPlanForSlot(
        slot,
        s.config,
        catalogStore,
        {
          readDamage: () => { evals++; return s.calc.teamTotalDamage.value ?? 0 },
          readPanelCrit: slotPanelCritReader(s.calc, slot),
        },
        s.calc.effectiveWEngineCoverages.value,
      )
      if (!plan) return null
      if (plan.mainStat4) char.driveDisc.mainStats[4] = plan.mainStat4
      char.driveDisc.twoPieceSetId = plan.twoPieceSetId
      char.driveDisc.subStatAllocation = plan.subStatAllocation
      await nextTick()
      return { plan, before, after: s.calc.teamTotalDamage.value ?? 0, evals }
    })
    if (!res) { message.warning('当前槽位没有可配平的分配（角色/配装推荐未就绪）'); return }
    configStore.setSubStatAllocation(slot, res.plan.subStatAllocation)
    // 配平是联合的：4 号位 / 2 件套 翻动了才写（没翻就不动用户现场）
    if (res.plan.flippedMainStat4 && res.plan.mainStat4) configStore.setMainStat(slot, 4, res.plan.mainStat4)
    if (res.plan.flippedTwoPiece) configStore.setTwoPieceSet(slot, res.plan.twoPieceSetId)
    const delta = res.before > 0 ? (res.after / res.before - 1) * 100 : 0
    const steps = Object.values(res.plan.subStatAllocation).reduce((a, b) => a + b, 0)
    const flips = [
      res.plan.flippedMainStat4 ? `4号位→${statLabel(res.plan.mainStat4)}` : '',
      res.plan.flippedTwoPiece ? '2件套换双爆配平' : '',
    ].filter(Boolean)
    message.success(
      `已写入最优分配：${steps} 步${flips.length ? ` · ${flips.join(' · ')}` : ''} · 全队伤害 ${compact(res.before)} → ${compact(res.after)}`
      + `（${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%，${res.evals} 次求值）`,
    )
  } catch (e) {
    message.error(e instanceof Error ? `最优分配失败：${e.message}` : '最优分配失败')
  } finally {
    optimalComputing.value = false
  }
}

const totalSubStats = computed(() => {
  const alloc = selectedChar.value?.driveDisc?.subStatAllocation
  if (!alloc) return 0
  const validStats = new Set(subStatPool.value)
  return Object.entries(alloc).reduce((sum, [stat, v]) => sum + (validStats.has(stat) ? (v || 0) : 0), 0 as number)
})

// ============ 配装推荐 ============

/** 当前角色的配装推荐 */
const buildRec = computed<CharacterBuildRecommendation | undefined>(() => {
  const agentId = selectedChar.value?.agentId
  if (!agentId) return undefined
  return catalogStore.getBuildRecommendation(agentId)
})
</script>

<style scoped src="./teamConfigPage/team-config-page.css"></style>
