<template>
  <div class="team-config-page">
    <!-- 预设队伍（下拉，数据源 src/data/teamPresets/，与「队伍对比」页共用） -->
    <div class="preset-row">
      <span class="preset-label">预设队伍</span>
      <n-select
        :value="presetSelectValue"
        :options="presetTeamOptions"
        size="small"
        clearable
        filterable
        style="width: 280px"
        placeholder="选择预设队伍（换人 + 自动配装）"
        @update:value="onPresetSelect"
      />
      <n-button size="small" type="primary" secondary @click="openGoldDialog">
        预设金数
      </n-button>
    </div>

    <!-- 上排：3个角色卡片 -->
    <div class="card-row">
      <CharacterCard
        v-for="i in 3"
        :key="i - 1"
        :slot="i - 1"
        :is-selected="configStore.selectedSlot === i - 1"
        @select="configStore.selectSlot"
      />
    </div>

    <!-- 下排：详细配置区域 + 面板预览 -->
    <div v-if="selectedChar" class="detail-section">
      <n-grid :cols="3" :x-gap="16">
        <!-- 左侧：角色详细配置（占2列） -->
        <n-gi :span="2">
          <n-card size="small" :bordered="true" class="detail-card">
            <template #header>
              <span>角色详细配置 - 槽位 {{ configStore.selectedSlot + 1 }}</span>
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
                        @update:value="v => configStore.setCinemaLevel(configStore.selectedSlot, v)"
                      />
                      <n-input-number
                        :value="selectedChar.cinemaLevel"
                        :min="0"
                        :max="6"
                        size="small"
                        style="width: 80px; margin-left: 12px"
                        @update:value="v => configStore.setCinemaLevel(configStore.selectedSlot, v ?? 0)"
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
                        @update:value="v => configStore.setWEngineModLevel(configStore.selectedSlot, v)"
                      />
                      <n-input-number
                        :value="selectedChar.wEngineModLevel"
                        :min="1"
                        :max="5"
                        size="small"
                        style="width: 80px; margin-left: 12px"
                        @update:value="v => configStore.setWEngineModLevel(configStore.selectedSlot, v ?? 1)"
                      />
                    </div>
                  </div>

                  <!-- 战斗动作次数 -->
                  <div class="section">
                    <div class="section-title">战斗动作次数</div>
                    <n-grid cols="6" :x-gap="8">
                      <n-gi>
                        <div class="field">
                          <span class="field-label">弹刀次数<span v-if="selectedChar.agentId === '1471' && banyueTopUpForSlot && banyueTopUpForSlot.parry > 0" class="field-hint">+{{ banyueTopUpForSlot.parry }}（轴自动）</span></span>
                          <n-input-number
                            :value="selectedChar.parryCount || interactionDefaults.parry"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setParryCount(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi>
                        <div class="field">
                          <span class="field-label">闪避反击</span>
                          <n-input-number
                            :value="selectedChar.dodgeCounterCount || interactionDefaults.dodge"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setDodgeCounterCount(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi v-if="['1471', '1531'].includes(selectedChar.agentId)">
                        <div class="field">
                          <span class="field-label">{{ selectedChar.agentId === '1531' ? '格挡（动力压制）' : '金身格挡' }}</span>
                          <n-input-number
                            :value="selectedChar.blockCount || interactionDefaults.block"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setBlockCount(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi v-if="selectedChar.agentId === '1471'">
                        <div class="field">
                          <span class="field-label">双反<span v-if="banyueTopUpForSlot && banyueTopUpForSlot.dual > 0" class="field-hint">+{{ banyueTopUpForSlot.dual }}（轴自动）</span></span>
                          <n-input-number
                            :value="selectedChar.dualCounterCount || interactionDefaults.dual"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setDualCounterCount(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi v-if="selectedChar.agentId === '1471'">
                        <div class="field" title="失衡外强特连段末尾后摇的嘲讽取消次数：每连段末尾强特后摇 = 自身时长（期间不能平A，占用战场时间），一次嘲讽取消一次后摇；失衡内连段默认被连携/大招/瞬拳取消，不计">
                          <span class="field-label">嘲讽取消</span>
                          <n-input-number
                            :value="selectedChar.tauntCancelCount ?? 0"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setTauntCancelCount(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi v-if="selectedChar.agentId === '1371'">
                        <div class="field">
                          <span class="field-label">2连墨痕化形</span>
                          <n-input-number
                            :value="selectedChar.yixuanInk2Count ?? 0"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setYixuanInk2Count(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi v-if="selectedChar.agentId === '1371'">
                        <div class="field">
                          <span class="field-label">3连墨痕化形</span>
                          <n-input-number
                            :value="selectedChar.yixuanInk3Count ?? 0"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setYixuanInk3Count(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi v-if="selectedChar.agentId === '1371'">
                        <div class="field">
                          <span class="field-label">完美格挡</span>
                          <n-input-number
                            :value="selectedChar.yixuanPerfectBlockCount ?? 0"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setYixuanPerfectBlockCount(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi v-if="selectedChar.agentId === '1371'">
                        <div class="field" title="极限支援换场落雷（225%贯穿力+5闪能/次）；缺省 = 队友正常弹刀次数求和（上限）">
                          <span class="field-label">极限支援</span>
                          <n-input-number
                            :value="(selectedChar.yixuanExtremeAssistCount ?? -1) < 0 ? -1 : selectedChar.yixuanExtremeAssistCount"
                            :min="-1"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setYixuanExtremeAssistCount(configStore.selectedSlot, v ?? -1)"
                          />
                        </div>
                      </n-gi>
                      <n-gi v-if="selectedChar.agentId === '1371'">
                        <div class="field" title="后台使用墨影凝云+霄云劲#5（不消耗战场时间，有倍率行调用/异常积蓄/失衡）">
                          <span class="field-label">墨影凝云合轴</span>
                          <n-input-number
                            :value="selectedChar.yixuanBackstageComboCount ?? 0"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setYixuanBackstageComboCount(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi>
                        <div class="field">
                          <span class="field-label">快速支援</span>
                          <n-input-number
                            :value="selectedChar.quickAssistCount ?? 0"
                            :min="0"
                            :max="99"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setQuickAssistCount(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi>
                        <div class="field">
                          <span class="field-label">连携次数/失衡</span>
                          <n-input-number
                            :value="selectedChar.chainCountPerStun ?? 1"
                            :min="0"
                            :max="3"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setChainCountPerStun(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                      <n-gi>
                        <div class="field">
                          <span class="field-label">平A时间权重</span>
                          <n-input-number
                            :value="selectedChar.basicAttackTimeWeight ?? selectedAgentDefaultTimeWeight"
                            :min="0"
                            :max="99"
                            :step="0.1"
                            size="small"
                            style="width: 100%"
                            @update:value="v => configStore.setBasicAttackTimeWeight(configStore.selectedSlot, v ?? 0)"
                          />
                        </div>
                      </n-gi>
                    </n-grid>
                  </div>

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
                            :value="configStore.getWEngineEffectCoverage(effect.id)"
                            :min="0"
                            :max="100"
                            :step="5"
                            size="small"
                            style="flex: 1"
                            @update:value="v => configStore.setWEngineEffectCoverage(effect.id, v)"
                          />
                          <span class="coverage-value">{{ configStore.getWEngineEffectCoverage(effect.id) }}%</span>
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
                    <n-grid cols="2" :x-gap="8">
                      <n-gi>
                        <div class="field">
                          <span class="field-label">4件套</span>
                          <n-select
                            :value="selectedChar.driveDisc.fourPieceSetId || null"
                            :options="setOptions"
                            filterable
                            size="small"
                            placeholder="选择4件套"
                            @update:value="v => configStore.setFourPieceSet(configStore.selectedSlot, v || '')"
                          />
                        </div>
                      </n-gi>
                      <n-gi>
                        <div class="field">
                          <span class="field-label">2件套</span>
                          <n-select
                            :value="selectedChar.driveDisc.twoPieceSetId || null"
                            :options="setOptions"
                            filterable
                            size="small"
                            placeholder="选择2件套"
                            @update:value="v => configStore.setTwoPieceSet(configStore.selectedSlot, v || '')"
                          />
                        </div>
                      </n-gi>
                    </n-grid>
                    <!-- 套装图标预览 -->
                    <div v-if="fourPieceSetIcon || twoPieceSetIcon" class="set-icons-row">
                      <div v-if="fourPieceSetIcon" class="set-icon-item">
                        <img :src="fourPieceSetIcon" class="set-icon" @error="fourPieceImgError = true" />
                        <span class="set-icon-label">4件套</span>
                      </div>
                      <div v-if="twoPieceSetIcon" class="set-icon-item">
                        <img :src="twoPieceSetIcon" class="set-icon" @error="twoPieceImgError = true" />
                        <span class="set-icon-label">2件套</span>
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
                            @update:value="v => configStore.setMainStat(configStore.selectedSlot, slot, v)"
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
                        <n-text depth="3" style="font-size: 11px">
                          总词条：{{ totalSubStats }}
                        </n-text>
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
                          @update:value="v => configStore.setSubStatCount(configStore.selectedSlot, stat, v ?? 0)"
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
                v-model:value="saveTargetPresetId"
                :options="presetTeamOptions"
                size="small"
                style="width: 240px"
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
            <n-button size="tiny" type="primary" secondary @click="configStore.applyBuildRecommendationForSlot(configStore.selectedSlot)">
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
                <n-text v-if="buildRec.wengine.catalog_wengine_id" depth="2" style="font-size: 11px; color: #52c41a">
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
                <n-tag size="tiny" type="success">4件</n-tag>
                <span class="rec-set-name">{{ buildRec.drive_disc_sets.four_piece.name_zh || buildRec.drive_disc_sets.four_piece.name_en }}</span>
              </div>
              <div v-if="buildRec.drive_disc_sets.two_piece" class="rec-set-row">
                <n-tag size="tiny" type="info">2件</n-tag>
                <span class="rec-set-name">{{ buildRec.drive_disc_sets.two_piece.name_zh || buildRec.drive_disc_sets.two_piece.name_en }}</span>
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
import { ref, computed, watch } from 'vue'
import {
  NCard, NSpace, NGrid, NGi, NSelect, NSlider, NInputNumber, NText,
  NRadioGroup, NRadioButton, NTag, NButton, NModal, useMessage,
} from 'naive-ui'
import { useConfigStore, getInteractionDefaults } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useStatLabel } from '@/composables/useStatLabel'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanel } from '@/composables/resourceCalc/helpers'
import CharacterCard from '@/components/CharacterCard.vue'
import StatPanel from '@/components/StatPanel.vue'
import { calcPanel } from '@/core/panel'
import { applyTargetedStat } from '@/core/buff'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { getImageUrl } from '@/utils/image'
import { isPctStat, phaseStatLabel } from '@/utils/statMeta'
import type { WEngine, WEngineAdvancedStat, PanelValues, TeammateBuff, CharacterBuildRecommendation, BuffEffect, BuffGroup } from '@/types/catalog'
import type { CharacterConfig } from '@/stores/config'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const { statLabel, formatStatValue } = useStatLabel()

// ========== 预设队伍（下拉，与「队伍对比」页共用 src/data/teamPresets/） ==========
import { teamPresets } from '@/data/teamPresets'
import { buildGoldStepsFromConfig, teamGoldOf } from '@/composables/teamCompare'
const presetSelectValue = ref<string | null>(null)
const presetTeamOptions = computed(() => teamPresets.map(t => ({ value: t.id, label: t.name })))
/** 最近一次应用的预设 id（「预设金数」弹窗保存到预设文件时默认目标） */
const lastAppliedPresetId = ref<string | null>(null)
function onPresetSelect(id: string | number | null) {
  const preset = teamPresets.find(t => t.id === id)
  if (preset) {
    lastAppliedPresetId.value = preset.id
    configStore.applyTeamPreset(preset.team)
    // 预设交互清单 → 各角色交互次数（般岳金身弹刀 → blockCount；未列的角色保持原值）
    for (const it of preset.interactions ?? []) {
      const slot = it.slot ?? 0
      if (it.type === 'parry') configStore.setParryCount(slot, it.count)
      else if (it.type === 'dodge') configStore.setDodgeCounterCount(slot, it.count)
      else if (it.type === 'quickAssist') configStore.setQuickAssistCount(slot, it.count)
      else if (it.type === 'banyueGoldenParry') configStore.setBlockCount(slot, it.count)
      else if (it.type === 'banyueDualCounter') configStore.setDualCounterCount(slot, it.count)
    }
  }
  presetSelectValue.value = null // 复位：下拉只做触发，不保持选中态
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
  return agent?.name.zhCN ?? agent?.name.en ?? id
}

// ========== 保存到预设文件（下载 JSON 写回 goldSteps/standardSteps） ==========

const saveTargetPreset = computed(() =>
  teamPresets.find(p => p.id === saveTargetPresetId.value) ?? null,
)

/** 当前队伍与目标预设阵容不一致（步骤按槽位写入预设队伍，需确认） */
const saveTeamMismatch = computed(() => {
  const p = saveTargetPreset.value
  if (!p) return false
  return p.team.some((agentId, i) => agentId !== configStore.team[i]?.agentId)
})

/** 将写入的步骤数预览（随草稿实时更新） */
const saveStepsPreview = computed(() => {
  const { goldSteps, standardSteps } = buildGoldStepsFromConfig(
    configStore.team.map(c => ({ agentId: c.agentId, wEngineId: c.wEngineId })),
    goldDraft.value.cinemas,
    goldDraft.value.mods,
    // 把目标预设的基础音擎作为 baseWEngineIds 传入：
    // 换到与基础音擎不同的「限定音擎」时才写「本体（1金）」加金步，
    // 避免像伊德海莉队（基础音擎=限定专武 14105）被误判成升级步而抬高基础金。
    saveTargetPreset.value?.wEngines ?? [],
  )
  return { gold: goldSteps.length, standard: standardSteps.length }
})

/** 用当前命座/精炼重写目标预设的 goldSteps/standardSteps，返回可下载的 JSON。
 *  目标是难度变体条目（variantOf）时重定向回源预设：goldSteps 为全队共用，
 *  写源文件才能保住 variants 分类，避免另存出一份重复队伍。 */
function buildPresetJson(): { json: string; presetId: string } | null {
  const preset = saveTargetPreset.value
  if (!preset) return null
  const source = (preset.variantOf ? teamPresets.find(p => p.id === preset.variantOf) : undefined) ?? preset
  const { goldSteps, standardSteps } = buildGoldStepsFromConfig(
    configStore.team.map(c => ({ agentId: c.agentId, wEngineId: c.wEngineId })),
    goldDraft.value.cinemas,
    goldDraft.value.mods,
    // 把目标预设的基础音擎作为 baseWEngineIds 传入：
    // 换到与基础音擎不同的「限定音擎」时才写「本体（1金）」加金步，
    // 避免像伊德海莉队（基础音擎=限定专武 14105）被误判成升级步而抬高基础金。
    saveTargetPreset.value?.wEngines ?? [],
  )
  const updated = { ...source, goldSteps, standardSteps }
  return { json: JSON.stringify(updated, null, 2), presetId: source.id }
}

function savePresetJson() {
  const r = buildPresetJson()
  if (!r) {
    message.warning('请先选择目标预设')
    return
  }
  const { json, presetId } = r
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${presetId}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  const tip = `已导出 ${presetId}.json（goldSteps/standardSteps 已按当前命座/精炼重写）：请替换 src/data/teamPresets/${presetId}.json 后刷新页面`
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(json).then(() => message.success(`${tip}（已复制到剪贴板）`)).catch(() => message.success(tip))
  } else {
    message.success(tip)
  }
}

function copyPresetJson() {
  const r = buildPresetJson()
  if (!r) {
    message.warning('请先选择目标预设')
    return
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(r.json)
      .then(() => message.success(`已复制 JSON，粘贴替换 src/data/teamPresets/${r.presetId}.json 后刷新页面`))
      .catch(() => message.warning('复制失败，请用「保存到预设文件」下载'))
  } else {
    message.warning('当前环境不支持剪贴板，请用「保存到预设文件」下载')
  }
}

const selectedChar = computed<CharacterConfig>(() => configStore.team[configStore.selectedSlot])
// 交互次数默认值（如星徽·比利 招架4/闪反0/格挡5）：char 未填（0）时输入框预填展示，计算侧同口径
const interactionDefaults = computed(() => getInteractionDefaults(selectedChar.value?.agentId ?? ''))
// 般岳轴模式自动补齐（保底语义）：弹刀/双反在交互栏输入之上补的量（懒计算，仅般岳选中时求值）
const { banyueInteractionTopUp } = useResourceCalc()
const banyueTopUpForSlot = computed(() => {
  const t = banyueInteractionTopUp.value
  return t && t.slot === configStore.selectedSlot ? t : null
})
const currentAgent = computed(() => {
  const id = selectedChar.value?.agentId
  return id ? catalogStore.getAgent(id) ?? null : null
})
const selectedAgentDefaultTimeWeight = computed(() => configStore.getDefaultBasicAttackTimeWeight(currentAgent.value))
function getTeammateBuffSourceContext() {
  return buildTeammateBuffSourceContext(configStore.team, {
    teammateBuffGroups: catalogStore.teammateBuffGroups,
    driveDiscSetsMap: catalogStore.driveDiscSetsMap,
    statRules: catalogStore.statRules,
    getAgent: (id) => catalogStore.getAgent(id),
    getWEngine: (id) => catalogStore.getWEngine(id),
    isTeammateBuffEnabled: (id) => configStore.isTeammateBuffEnabled(id),
  })
}


/** 图片加载失败状态（切换角色/音擎/套装时重置） */
const wengineImgError = ref(false)
const fourPieceImgError = ref(false)
const twoPieceImgError = ref(false)
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
    return computePanel(configStore.selectedSlot, configStore, catalogStore)
  }
  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return null

  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined

  const { enabledTeammateBuffs, sourcePanelsByOwner } = getTeammateBuffSourceContext()

  // 计算基础面板
  const result = calcPanel(
    agent,
    wEngine,
    char.driveDisc,
    catalogStore.driveDiscSetsMap,
    enabledTeammateBuffs,
    catalogStore.statRules,
    {
      cinemaLevel: char.cinemaLevel,
      wEngineModLevel: char.wEngineModLevel,
      sourcePanelsByOwner,
      effectCoverageMap: configStore.getWEngineEffectCoverageMap(),
    }
  )

  // 应用全局 buff
  const panel = { ...result.outOfCombat }
  for (const buff of configStore.globalBuffs) {
    if (!buff.enabled) continue
    applyTargetedStat(panel, buff.stat, buff.value, isPctStat(buff.stat) ? 'pct' : 'flat', buff.targetSkillType)
  }

  return panel
})

// 可选角色列表（过滤掉已选的）
const availableAgentOptions = computed(() => {
  const used = configStore.usedAgentIds
  const currentId = selectedChar.value?.agentId
  const SPECIALTY_LABEL: Record<string, string> = {
    attack: '强攻',
    stun: '击破',
    anomaly: '异常',
    support: '支援',
    defense: '防护',
    rupture: '裂御',
    edgeguard: '锋御',
    sharpen: '锋御',
  }
  const ATTRIBUTE_LABEL: Record<string, string> = {
    physical: '物理',
    fire: '火',
    ice: '冰',
    electric: '电',
    ether: '以太',
    wind: '风',
    frost: '霜',
    honed_edge: '利刃',
    xuanmo: '玄墨',
  }
  return catalogStore.displayAgents
    .filter(a => !used.includes(a.id) || a.id === currentId)
    .map(a => {
      const name = a.name.zhCN ?? a.name.en ?? a.id
      const specialty = SPECIALTY_LABEL[a.specialty] ?? a.specialty
      const attr = ATTRIBUTE_LABEL[a.attribute] ?? a.attribute
      return {
        label: `${name} · ${a.rarity} · ${specialty} · ${attr}`,
        value: a.id,
      }
    })
})

const wengineOptions = computed(() =>
  catalogStore.displayWEngines.map(w => ({
    label: `${w.name.zhCN ?? w.name.en ?? w.id} (${w.rarity})`,
    value: w.id,
  })),
)

const setOptions = computed(() =>
  catalogStore.displayDriveDiscSets.map(s => ({
    label: s.name.zhCN ?? s.name.en ?? s.id,
    value: s.id,
  })),
)

function onSelectAgent(id: string | null) {
  if (id) {
    configStore.setAgent(configStore.selectedSlot, id)
  }
}

function onSelectWEngine(id: string | null) {
  if (id) {
    configStore.setWEngine(configStore.selectedSlot, id)
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
  return wengine.value.effect.name.zhCN ?? wengine.value.effect.name.en ?? ''
})

const wengineEffectDesc = computed(() => {
  if (!wengine.value) return ''
  return wengine.value.effect.description.zhCN ?? wengine.value.effect.description.en ?? ''
})

function localized(obj: any): string {
  if (!obj) return ''
  if (typeof obj === 'string') return obj
  return obj.zhCN ?? obj.en ?? ''
}

function effectValueText(effect: BuffEffect): string {
  const modValue = (effect as any).modificationValues?.value
  const modPerStack = (effect as any).modificationValues?.valuePerStack
  if (Array.isArray(modValue)) return `${modValue[selectedChar.value.wEngineModLevel - 1] ?? effect.value}`
  if (Array.isArray(modPerStack)) return `${modPerStack[selectedChar.value.wEngineModLevel - 1] ?? effect.valuePerStack} × ${effect.defaultStacks ?? effect.maxStacks ?? 1}层`
  if (effect.type === 'stacked') return `${effect.valuePerStack ?? effect.value} × ${effect.defaultStacks ?? effect.maxStacks ?? 1}层`
  if (effect.type === 'derived') return `${localized((effect as any).sourceLabel) || effect.basis || effect.sourceStat || '来源'} × ${effect.ratio ?? 0}%${effect.cap ? `，上限 ${effect.cap}` : ''}`
  if (effect.type === 'formula') return effect.formula?.expression ?? '公式'
  return `${effect.value ?? 0}`
}

function collectWEngineGroupEffects(group: BuffGroup | null | undefined, source: string) {
  return (group?.effects ?? []).map(effect => {
    const stackText = effect.type === 'stacked'
      ? `${localized((effect as any).stackLabel) || '叠层'} ${effect.defaultStacks ?? effect.maxStacks ?? 1}/${effect.maxStacks ?? effect.defaultStacks ?? 1}`
      : ''
    return {
      ...effect,
      source,
      label: phaseStatLabel(effect.stat, group?.scope ?? 'inCombat'),
      valueText: effectValueText(effect),
      stackText,
      hasCoverage: effect.type === 'stacked' || !!effect.coverage,
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
  const step = (catalogStore.statRules?.driveDisc?.sRankSubStatBaseStep as any)?.[stat] ?? 0
  if (!step) return '-'
  const value = step * count // count即升级步数，不再乘2.25
  return formatStatValue(stat, value, isPctStat(stat) ? 'pct' : 'flat')
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

<style scoped>
.team-config-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preset-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
}

/* 预设金数弹窗 */
.gold-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.gold-slot-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
}

.gold-slot-name {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.gold-slot-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}

.gold-slot-agent {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
}

.gold-slot-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gold-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gold-field-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  width: 28px;
  flex-shrink: 0;
}

.gold-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 4px;
}

.gold-save-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.gold-save-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.gold-save-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  white-space: nowrap;
}

.card-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.detail-section {
  margin-top: 4px;
}

.detail-card {
  width: 100%;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 2px;
}

.row-item {
  display: flex;
  align-items: center;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.field-hint {
  margin-left: 4px;
  color: var(--color-warning, #f0a020);
  font-weight: 600;
}

.wengine-stats {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: row;
  gap: 10px;
}

.wengine-icon-wrapper {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wengine-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.wengine-stats-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wengine-logic-dev {
  margin-top: 8px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.dev-title {
  font-size: 12px;
  font-weight: 700;
  color: #facc15;
  margin-bottom: 4px;
}

.dev-line {
  font-family: Consolas, monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.58);
  line-height: 1.5;
}

.wengine-effect-row {
  padding: 6px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.effect-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.wengine-coverage {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.coverage-label,
.coverage-value {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.set-icons-row {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.set-icon-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.set-icon {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 4px;
}

.set-icon-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.stat-name {
  color: rgba(255, 255, 255, 0.6);
}

.stat-value {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 500;
}

.effect-desc {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.effect-name {
  font-size: 12px;
  font-weight: 600;
  color: rgba(250, 204, 21, 0.9);
  margin-bottom: 4px;
}

.effect-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.5;
}

.sub-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}

.sub-stat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.sub-stat-name {
  flex: 1;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
}

/* 面板预览卡片 */
.panel-card {
  height: 100%;
  min-height: 500px;
}

.panel-content {
  max-height: calc(100vh - 280px);
  overflow-y: auto;
  padding-right: 4px;
}

.panel-content::-webkit-scrollbar {
  width: 4px;
}

.panel-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.panel-empty {
  text-align: center;
  padding: 60px 20px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
}

/* 配装推荐 */
.build-rec-section {
  margin-top: 4px;
}

.rec-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rec-block-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 4px;
}

.rec-wengine-name {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 500;
}

.rec-set-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin-bottom: 2px;
}

.rec-set-name {
  color: rgba(255, 255, 255, 0.8);
}

.rec-mainstat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin-bottom: 2px;
}

.rec-mainstat-slot {
  color: rgba(255, 255, 255, 0.4);
  width: 32px;
  flex-shrink: 0;
}

.rec-mainstat-name {
  color: rgba(255, 255, 255, 0.8);
}

.rec-substat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin-bottom: 2px;
}

.rec-substat-priority {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(82, 196, 26, 0.15);
  color: #52c41a;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.rec-substat-name {
  color: rgba(255, 255, 255, 0.7);
}

.rec-strategy {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
</style>
