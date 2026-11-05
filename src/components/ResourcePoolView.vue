<template>
  <div class="resource-pool-view">
    <!-- 比较入口的抬头（ResultPage 不传 ⇒ 零占位） -->
    <div v-if="title" class="rpv-title">{{ title }}</div>
    <!-- 口径说明（只在有快照时显示；未采时下面那块自己写原因，不重复） -->
    <div v-if="reason && snapshot" class="rpv-reason">{{ reason }}</div>

    <!-- 弃轴提示（用户口径 2026-10-16：「用户选择了轴就是想看轴，**悄悄退化等于欺骗用户**」，且要
         「引导用户提高合轴率」）。位置在资源块之前：它改变的是「下面这些数是怎么算出来的」，必须比
         伤害数字先被读到。非轴模式恒不显示（那种模式没有资源要求）。
         「去调合轴率」按钮只在父方接了动作时出现（比较入口没有那个弹窗 ⇒ 只陈述、不给死按钮）。 -->
    <n-alert v-if="axisNotice.show" type="warning" size="small" class="rpv-axis-alert">
      <template #header>{{ axisNotice.title }}</template>
      <div class="rpv-axis-detail">
        <div>{{ axisNotice.detail }}</div>
        <div v-if="axisNotice.action === 'raise-absorb'" class="rpv-axis-actions">
          <n-button v-if="hasComboAlignAction" size="tiny" type="primary" @click="requestComboAlign()">
            去调合轴率
          </n-button>
          <span class="rpv-axis-hint">
            当前 {{ Math.round(axisNotice.currentAbsorb * 100) }}% → 可试到 {{ Math.round(axisNotice.ceiling * 100) }}%
          </span>
        </div>
      </div>
    </n-alert>

    <!-- 机制「入场券」未满足（用户口径 2026-11-04：「没弹刀就没围猎……用户误认为莱卡恩弱就不透明了」）。
         判据住 `composables/capabilityGateNotice.ts`（纯函数 + 单测），本组件只渲染；
         与弃轴提示同一位置：它改变「下面这些数是怎么算出来的」，必须比伤害数字先被读到。 -->
    <n-alert v-if="capabilityNotice.show" type="warning" size="small" class="rpv-gate-alert">
      <template #header>{{ capabilityNotice.title }}</template>
      <div class="rpv-gate-detail">
        <div>{{ capabilityNotice.detail }}</div>
      </div>
    </n-alert>
    <!-- 计算失真（用户口径 2026-11-04：「提醒了计算失真就行了，不用管错误计算的逻辑」）——
         用户手填的交互次数超出 Boss 出手频率时**只说明差额、不拦**：计算照常完成，
         引擎只兑现装得下的量（core/bossAttackBudget）。与上面两条同位置：它同样是「下面这些数怎么来的」。 -->
    <n-alert v-if="budgetNotice.show" type="info" size="small" class="rpv-gate-alert">
      <template #header>{{ budgetNotice.title }}</template>
      <div class="rpv-gate-detail">
        <div>{{ budgetNotice.detail }}</div>
      </div>
    </n-alert>
    <!-- 未采（没有这一档的快照）⇒ 如实写「未采」+ 原因，**不补造、不编 0**（用户口径） -->
    <div v-if="!snapshot" class="rpv-empty">
      <div class="rpv-empty-title">资源池：未采</div>
      <div class="rpv-empty-reason">{{ reason || RESOURCE_POOL_NOT_COLLECTED }}</div>
    </div>

    <template v-else>
          <div class="pool-summary-row">
        <!-- 时间分配汇总：账本（引擎收费口径）与物化（真打出去的动作行）并列，留白可归因 -->
        <n-card size="small" class="pool-summary-card" :bordered="true">
          <template #header>
            <span class="pool-title">时间分配汇总</span>
          </template>
          <div class="pool-summary-body">
            <div class="pool-stat">
              <span class="pool-stat-label">时间预算</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.budget, 1) }}s</span>
              <span class="pool-stat-detail">战斗 {{ fmt(teamTimeSummary.battleTime, 0) }}s − 无敌 {{ fmt(teamTimeSummary.invincibleTime, 0) }}s</span>
            </div>

            <div class="pool-subtitle">账本口径 · 引擎按此分配平A池</div>
            <div class="pool-stat">
              <span class="pool-stat-label">必要前台</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.requiredFrontline, 1) }}s</span>
              <span class="pool-stat-detail">动作前台 {{ fmt(teamTimeSummary.actionFrontline, 1) }}s − 合轴抵扣 {{ fmt(teamTimeSummary.comboAlignDeduction, 1) }}s</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">平A分配</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.basicTotal, 1) }}s</span>
              <span class="pool-stat-detail">可分配池 {{ fmt(teamTimeSummary.remainingFrontlinePool, 1) }}s · 已分 {{ poolFillText }}</span>
            </div>

            <div class="pool-subtitle">物化口径 · 与角色卡时间条同源</div>
            <div class="pool-stat highlight">
              <span class="pool-stat-label">前台净占用</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.rowsNet, 1) }}s</span>
              <span class="pool-stat-detail">真正打出去的动作（必要行 + 平A行）</span>
            </div>
            <div class="pool-stat" :class="teamTimeSummary.slack > 5 ? 'danger' : 'bonus'">
              <span class="pool-stat-label">时间留白</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.slack, 1) }}s</span>
              <span class="pool-stat-detail">{{ slackHint }}</span>
            </div>
            <!-- 留白四项分解（精确闭合：slack == 下列四项之和）。「其中」现在是字面成立的，
                 旧版的「其中平A行缩水」不成立（实测 117.57s 而留白 0.00s）故删除。 -->
            <div v-if="teamTimeSummary.ledgerInflation > 1" class="pool-stat danger">
              <span class="pool-stat-label">其中账本虚高</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.ledgerInflation, 1) }}s</span>
              <span class="pool-stat-detail">必要时间估高（estimate + 折叠残差），无对应动作行</span>
            </div>
            <div v-if="teamTimeSummary.basicUnspent > 1" class="pool-stat danger">
              <span class="pool-stat-label">其中池没打出来</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.basicUnspent, 1) }}s</span>
              <span class="pool-stat-detail">平A池分到了却没物化成任何动作行（真留白）</span>
            </div>
            <div v-if="teamTimeSummary.poolResidual < -1" class="pool-stat">
              <span class="pool-stat-label">其中池超分</span>
              <span class="pool-stat-value">{{ fmt(-teamTimeSummary.poolResidual, 1) }}s</span>
              <span class="pool-stat-detail">平A分配超过了可分配池（欠打回填放宽所致），抵掉一部分留白</span>
            </div>
            <!-- 合轴抵扣·三项分解（用户口径 2026-10-16「这个也要在时间统计里面标注合轴了多少时间」）。
                 系统里有**两个独立旋钮**：综合吸收（引擎按 comboAlignAbsorbRatio 闭式解）与逐招合轴
                 （结果页弹窗逐行调）；再加轴预设自带的轴内节省。三项都列出来，用户才看得出
                 「我调的那个 40% 到底贡献了多少」——此前只有一个汇总量。 -->
            <div v-if="teamTimeSummary.comboAlignDeduction > 1" class="pool-stat">
              <span class="pool-stat-label">其中合轴抵扣</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.comboAlignDeduction, 1) }}s</span>
              <span class="pool-stat-detail">被队友合轴吸收掉的前台时间，账本已扣、物化行仍在，故表现为留白</span>
            </div>
            <div v-if="teamTimeSummary.comboAlignBreakdown.absorb > 0.5" class="pool-stat pool-stat-indent">
              <span class="pool-stat-label">· 综合吸收</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.comboAlignBreakdown.absorb, 1) }}s</span>
              <span class="pool-stat-detail">
                队友前台按「合轴吸收率 {{ Math.round(comboAlignAbsorbPct) }}%」并行让出（0% = 关掉它）——
                <b>这是引擎按该比例闭式解算出来的</b>，不是逐招填的
              </span>
            </div>
            <div v-if="teamTimeSummary.comboAlignBreakdown.perMove > 0.5" class="pool-stat pool-stat-indent">
              <span class="pool-stat-label">· 逐招合轴</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.comboAlignBreakdown.perMove, 1) }}s</span>
              <span class="pool-stat-detail">
                下面「合轴率调节」里逐行填的比例（用户覆盖 ?? 倍率表默认）
              </span>
            </div>
            <div v-if="teamTimeSummary.comboAlignBreakdown.axisOverlap > 0.5" class="pool-stat pool-stat-indent">
              <span class="pool-stat-label">· 轴内节省</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.comboAlignBreakdown.axisOverlap, 1) }}s</span>
              <span class="pool-stat-detail">轴预设自带的失衡内跨角色并行（如般岳强特时琉音抱拳）</span>
            </div>
            <div v-if="teamTimeSummary.comboAlignBreakdown.axisOverlapOverridden > 0.5" class="pool-stat pool-stat-indent">
              <span class="pool-stat-label">· 其中被取大吃掉</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.comboAlignBreakdown.axisOverlapOverridden, 1) }}s</span>
              <span class="pool-stat-detail">轴内节省与逐招/吸收重叠的部分，引擎只认较大的那一份（防双计，故不叠加）</span>
            </div>
            <!-- UV 面：池物化成模块行（时间真花掉，非留白）。**故意不挂「其中」**——
                 它不计入留白分解，列在这里只为回答「我的平A池去哪了」。 -->
            <div v-if="teamTimeSummary.basicRematerialized > 1" class="pool-stat">
              <span class="pool-stat-label">平A池改走模块行</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.basicRematerialized, 1) }}s</span>
              <span class="pool-stat-detail">池没缩水、只是打成了模块专属行（时间守恒，与留白无关）</span>
            </div>
            <div v-if="teamTimeSummary.truncatedRows.length > 0" class="pool-stat danger">
              <span class="pool-stat-label">时间截断</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.overflow, 1) }}s</span>
              <span class="pool-stat-detail">{{ truncationHintText }}</span>
            </div>
            <div v-if="!teamTimeSummary.timeBudgetConverged" class="pool-stat danger">
              <span class="pool-stat-label">时间预算未收敛</span>
              <span class="pool-stat-value">{{ teamTimeSummary.timeBudgetPasses }} 轮耗尽</span>
              <span class="pool-stat-detail">残差仍在变，结果可能停在错误值</span>
            </div>
            <div class="pool-per-slot">
              <span v-for="item in teamTimeSummary.perSlot" :key="item.slot" class="slot-chip">
                {{ item.name }}: 账本 {{ fmt(item.requiredFrontline, 1) }} / 物化 {{ fmt(item.necRows, 1) }} / 平A {{ fmt(item.basic, 1) }}s<span v-if="item.basicModuleRows > 1">（其中模块行 {{ fmt(item.basicModuleRows, 1) }}）</span>
              </span>
            </div>
          </div>
        </n-card>

        <!-- 失衡池汇总 -->
        <n-card size="small" class="pool-summary-card" :bordered="true">
          <template #header>
            <span class="pool-title">失衡池汇总</span>
          </template>
<template v-if="stunPoolResult">
          <div class="pool-summary-body">
            <div class="pool-stat">
              <span class="pool-stat-label">全队失衡值</span>
              <span class="pool-stat-value">{{ fmt(stunPoolResult.totalStunBuildUp, 1) }}</span>
            </div>
            <div class="pool-stat" v-if="stunPoolResult.inAxisStunTotal > 0">
              <span class="pool-stat-label">其中轴内失效</span>
              <span class="pool-stat-value rpv-dim">{{ fmt(stunPoolResult.inAxisStunTotal, 1) }}（毛失衡 {{ fmt(stunPoolResult.grossStunBuildUp, 1) }}）</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">Boss失衡值</span>
              <span class="pool-stat-value">{{ fmt(stunPoolResult.bossStunValue) }}</span>
            </div>
            <div class="pool-stat highlight">
              <span class="pool-stat-label">失衡次数</span>
              <span class="pool-stat-value">{{ stunPoolResult.stunCount }} 次</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">连携次数</span>
              <span class="pool-stat-value">{{ stunPoolResult.chainCountTotal }} 次</span>
            </div>
            <!--
              **已完整 N 次失衡 + 下一窗进度 X%**（用户口径 2026-10-28 §2.2，逐字）：
              > 「打完了 3 失衡，还积累了 56% 的失衡」/「进入第四失衡了，但是只打了 6s 就结束了」
              ——两个量分开读：**失衡值不够 = 下一窗没开**（进度 <100%）；**窗开了但短 = 时间不够**
              （时钟截短在逐窗时间轴里标）。

              窗内发呆 = 空闲归属容器（发呆等效于后台、啥都没做）；窗开了没人打的秒数必须可见。
              ⚠ 非轴队没有逐窗轨迹（hasTrace=false）：发呆**不编造**（不写 0）。
            -->
            <div class="pool-stat" v-if="continuousStun">
              <span class="pool-stat-label">下一窗进度</span>
              <span class="pool-stat-value" title="净失衡值攒向下一窗的进度：<100% = 失衡值不够，下一窗开不出来">
                还积累了 {{ (continuousStun.nextWindowProgress * 100).toFixed(1) }}%
              </span>
            </div>
            <!--
              **三读数拆分**（用户 2026-11-01，逐字）：「这个平a填充是**足够分配**的情况，**如果资源不够**，
              要么是**平a填充了导致失衡不够，打不出新失衡或者新失衡残缺**，要么是**失衡打了但是时间不够
              无法填充**，导致最后一窗变成**残缺的只有前半部分**。」
              ⇒ 一个「兑现比例」把两条互斥的稀缺通道混着算了，这里按 A/B/C 拆开读：
              · **A 失衡值不够**：窗内平A填充不产失衡值（填一秒少一秒攒条）⇒ 看「窗内填充」+ 上方「下一窗进度」；
              · **B 时间不够**：窗排到 180s 外 ⇒ 末窗被时钟截短（在「逐窗兑现」卡头计数）；
              · **C 窗开了没牌**：轴块 + 平A都填不满 ⇒ 发呆（容器不是缺陷，用户 2026-10-28）。
              ⚠ 非轴队 hasTrace=false：三读数都不可推演 ⇒ 不编造（整块不显示）。
            -->
            <div class="pool-stat" v-if="stunRealization && stunRealization.hasTrace">
              <span class="pool-stat-label">兑现窗数</span>
              <span class="pool-stat-value"
                :title="`只算轴动作 ${stunRealization.axisOnlyWindows.toFixed(2)} 窗 / 含平A填充 ${stunRealization.realizedWindows.toFixed(2)} 窗（计划 ${stunRealization.plannedWindows} 窗）。差值 = 平A填充把窗「填满」撑起来的那部分——它不产失衡值（通道 A），旧读数会把它当成兑现完整（2026-11-01 认定的盲区）。`">
                轴动作 {{ stunRealization.axisOnlyWindows.toFixed(2) }} / 含填充 {{ stunRealization.realizedWindows.toFixed(2) }} 窗
              </span>
            </div>
            <div class="pool-stat" v-if="stunRealization && stunRealization.hasTrace && stunRealization.fillSeconds > 0.05"
              :class="{ highlight: stunRealization.fillSeconds > 0.05 }">
              <span class="pool-stat-label">窗内填充</span>
              <span class="pool-stat-value" title="通道 A：窗内平A填充**不产失衡值**（用户 2026-10-28「填充是产出端、窗内作废」）⇒ 每填一秒就少一秒攒条。它同时会把窗填满，所以不能当「兑现完整」读。">
                {{ stunRealization.fillSeconds.toFixed(2) }} 秒
              </span>
            </div>
            <div class="pool-stat" v-if="stunRealization && stunRealization.hasTrace"
              :class="{ highlight: stunRealization.idleSeconds > 0.05 }">
              <span class="pool-stat-label">窗内发呆</span>
              <span class="pool-stat-value" title="通道 C：窗口开着、轴动作打完了、三个槽的平A预算也都见底 ⇒ 这段秒数没人打（不是打满）。发呆等效于后台（用户 2026-10-28），是容器不是缺陷。">
                {{ stunRealization.idleSeconds.toFixed(2) }} 秒
              </span>
            </div>
            <div class="pool-per-slot">
              <span v-for="(val, i) in stunPoolResult.perSlotStun" :key="i" class="slot-chip">
                {{ slotNames[i] ?? `槽${i}` }}: {{ fmt(val, 1) }}
              </span>
            </div>
          </div>
        </template>
<div v-else class="rpv-empty-reason">{{ blockState.stunPool.reason }}</div>
</n-card>

      </div>

      <!-- 逐窗兑现（用户口径 2026-10-27：「资源池页面如果开了轴模式，能显示 n 次轴的动作块的
           丢失填充可视化吗」）。三份输入全在快照里（既有单一来源）；非轴队 / 弃轴 ⇒ hasTrace=false
           ⇒ **如实写「无 + 原因」**（T188 用户口径：缺读数不补造、不编 0，也不把块藏起来）。 -->
      <n-card size="small" class="axis-window-card" :bordered="true">
        <template #header>
          <div class="axis-window-header">
            <span class="pool-title">逐窗兑现（轴模式）</span>
            <!-- 三读数按 A/B/C 口径措辞（用户 2026-11-01）：
                 动作 = 轴块真打出的秒数；填充 = 通道 A 的物理量（不产失衡值）；发呆 = 通道 C（容器不是缺陷）。
                 时钟截短（连续失衡的终点）当前被 solveTeam.physicalMax 钳在 0 窗 ⇒ 恒 0，暂不上屏；
                 A10 四步放开让末窗真被截短后再露出。 -->
            <template v-if="axisWindows.hasTrace">
<span class="axis-window-summary">
              轴 {{ axisWindows.windows.length }} 窗 · 动作 {{ fmt(axisWindows.totals.actionSeconds, 1) }}s
              · 填充 {{ fmt(axisWindows.totals.fillSeconds, 1) }}s<span class="rpv-dim" title="通道 A：窗内平A填充不产失衡值 ⇒ 填一秒就少一秒攒条">（不产失衡）</span>
              <template v-if="axisWindows.totals.idleSeconds !== null"> · 发呆 {{ fmt(axisWindows.totals.idleSeconds, 1) }}s</template>
              <template v-if="axisWindows.totals.skippedTimes > 0"> · 跳过 {{ axisWindows.totals.skippedTimes }} 次</template>
            </span>
            <!-- 二元相位时序（连续失衡专项）：积攒 → 窗 交替 + 余量段；Σ相位秒 === 有效战斗时间（恒等式）。
                 纯读骨架，先让「先积攒后窗口、剩余动作贴剩余窗口」看得见；部分窗 frac 待步 2。 -->
            <span v-if="stunPhaseTimeline?.hasTrace" class="axis-window-summary"
              title="二元相位时序：积攒段（窗外，攒失衡值）→ 窗段（吃易伤，窗内不攒条）交替，末尾余量段对应「下一窗攒了多少」。Σ相位秒恒 === 有效战斗时间。">
              · 相位 积攒 {{ fmt(stunPhaseTimeline.buildSeconds, 1) }}s / 窗 {{ fmt(stunPhaseTimeline.windowSeconds, 1) }}s
              <template v-if="stunPhaseTimeline.trailingSeconds > 0.05"> / 余量 {{ fmt(stunPhaseTimeline.trailingSeconds, 1) }}s</template>
            </span>
            <!-- 部分窗读数（连续失衡的「窗口时间只给一截」）：分母 = 余量/开窗成本（候选 A，引擎自洽）；
                 候选 B 用余量/e（§1 原式）实测多为 >1。⚠ 纯读数额，**未进覆盖率/伤害**（步 3 待定）。 -->
            <span v-if="stunPhaseTimeline?.hasTrace && stunPhaseTimeline.trailingFraction > 0.001" class="axis-window-summary"
              title="失衡满了但窗口时间没开完：余量 ÷ 开窗成本 = 下一窗能兑现的条数比例，× 名义窗长 = 下一窗只给的部分时长。⚠ 只读读数，尚未进覆盖率/伤害。">
              · 下一窗只给 {{ (stunPhaseTimeline.trailingFraction * 100).toFixed(0) }}%（{{ fmt(stunPhaseTimeline.trailingWindowSeconds, 1) }}s）
            </span>
            <!-- 池排出的窗数 vs 轴实际排的窗数：fixed / tail / bestEffort 类型的轴不吃完剩余窗口，
                 差额窗口**没有轴块**（不是「轴打空了」）——不点明会被读成逐窗图少画了几窗 -->
            <span
              v-if="stunPoolResult && stunPoolResult.stunCount !== axisWindows.windows.length"
              class="axis-window-summary"
              title="池按资源排出 K 窗；轴的窗数由预设/类型决定（fixed / tail / bestEffort 不吃剩余窗口）⇒ 差额那几窗没有轴块"
            >池报 {{ stunPoolResult.stunCount }} 窗（差额无轴块）</span>
          </template>
</div>
        </template>
        <AxisWindowChart v-if="axisWindows.hasTrace" :windows="axisWindows.windows" :fill-moves="axisFillMoveGroups" />
        <div v-else class="rpv-empty-reason">{{ blockState.axisWindows.reason }}</div>
      </n-card>

      <!-- 三角色资源池卡片（快照保证 resourceResult 非空；characters 空 = 技能数据不完整） -->
      <template v-if="resourceResult">
      <div v-if="resourceResult.characters.length > 0" class="card-row">
        <ResourceResultCard
          v-for="charResult in resourceResult.characters"
          :key="charResult.slot"
          :result="charResult"
          :agent-name="agentNames[charResult.agentId] || charResult.agentId"
          :specialty="getSpecialty(charResult.agentId)"
          :stun-pool-result="stunPoolResult"
          :stun-discrete-label="stunDiscrete?.label ?? null"
          :anomaly-pool-result="anomalyPoolResult"
          :liuyin-hug="liuyinHugSplit"
          :agent-names="agentNames"
          :total-time="resourceResult.totalTime"
        />
      </div>
      <div v-else class="rpv-empty">
        <div class="rpv-empty-title">无法计算</div>
        <div class="rpv-empty-reason">请确保队伍中至少有1名角色且技能数据完整</div>
      </div>
      </template>
        <!-- 积蓄池汇总 -->
        <n-card size="small" class="pool-summary-card" :bordered="true">
          <template #header>
            <span class="pool-title">积蓄池汇总</span>
          </template>
<template v-if="anomalyPoolResult">
          <div class="pool-summary-body">
            <div v-for="prog in anomalyPoolResult.perElement" :key="prog.element" class="pool-stat">
              <span class="pool-stat-label">{{ elementLabel(prog.element) }}</span>
              <span class="pool-stat-value">{{ fmt(prog.totalBuildUp, 1) }}</span>
              <span class="pool-stat-detail">{{ prog.triggerCount }} 次</span>
            </div>
            <div class="pool-stat highlight">
              <span class="pool-stat-label">异常触发</span>
              <span class="pool-stat-value">{{ anomalyPoolResult.totalTriggerCount }} 次</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">紊乱次数</span>
              <span class="pool-stat-value">{{ anomalyPoolResult.disorderCount }} 次</span>
            </div>
            <div class="pool-stat bonus">
              <span class="pool-stat-label">喧响奖励</span>
              <span class="pool-stat-value">+{{ fmt(anomalyPoolResult.decibelBonus) }}</span>
              <span class="pool-stat-detail">各触发者完整奖励之和；下方各角色 = 个人获得（含队友伴随50%）</span>
            </div>
            <div class="pool-per-slot">
              <span v-for="(val, i) in anomalyPoolResult.perSlotBonus" :key="i" class="slot-chip">
                {{ slotNames[i] ?? `槽${i}` }}: +{{ fmt(val) }}
              </span>
            </div>
          </div>

          <!-- 异常覆盖率 -->
          <div v-if="anomalyPoolResult.coverage" class="pool-coverage-section">
            <div class="pool-subtitle">异常覆盖率</div>
            <div class="pool-summary-body">
              <div class="pool-stat highlight">
                <span class="pool-stat-label">综合覆盖率</span>
                <span class="pool-stat-value">{{ (anomalyPoolResult.coverage.coverageRate * 100).toFixed(1) }}%</span>
              </div>
              <div v-if="anomalyPoolResult.coverage.windCoverageRate > 0" class="pool-stat">
                <span class="pool-stat-label">风化/乱流窗口</span>
                <span class="pool-stat-value">{{ (anomalyPoolResult.coverage.windCoverageRate * 100).toFixed(1) }}%</span>
                <span class="pool-stat-detail">非风窗口 {{ ((1 - anomalyPoolResult.coverage.windCoverageRate) * 100).toFixed(1) }}%</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">总DoT时间</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.coverage.totalDoTTime) }}s</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">有效DoT</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.coverage.effectiveDoTTime) }}s</span>
                <span class="pool-stat-detail">-{{ fmt(anomalyPoolResult.coverage.invincibleTime) }}s 无敌</span>
              </div>
              <div v-if="anomalyPoolResult.coverage.physicalCoverageRate > 0" class="pool-stat">
                <span class="pool-stat-label">畏缩覆盖</span>
                <span class="pool-stat-value">{{ (anomalyPoolResult.coverage.physicalCoverageRate * 100).toFixed(1) }}%</span>
                <span class="pool-stat-detail">+{{ (anomalyPoolResult.coverage.physicalCoverageRate * 7.5).toFixed(2) }}% 失衡</span>
              </div>
              <div v-if="anomalyPoolResult.coverage.frostCoverageRate > 0" class="pool-stat">
                <span class="pool-stat-label">霜寒覆盖</span>
                <span class="pool-stat-value">{{ (anomalyPoolResult.coverage.frostCoverageRate * 100).toFixed(1) }}%</span>
                <span class="pool-stat-detail">+{{ (anomalyPoolResult.coverage.frostCoverageRate * 10).toFixed(2) }}% 暴击伤害</span>
              </div>
            </div>
          </div>

          <!-- 紊乱伤害（无风属性时） -->
          <div v-if="anomalyPoolResult.disorderDamage" class="pool-coverage-section">
            <div class="pool-subtitle">紊乱伤害</div>
            <div class="pool-summary-body">
              <div class="pool-stat highlight">
                <span class="pool-stat-label">总紊乱伤害</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.disorderDamage.totalDamage) }}</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">紊乱次数</span>
                <span class="pool-stat-value">{{ anomalyPoolResult.disorderDamage.count }} 次</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">平均/次</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.disorderDamage.avgDamage) }}</span>
              </div>
            </div>
          </div>

          <!-- 乱流伤害（有风属性时） -->
          <div v-if="anomalyPoolResult.turbulenceDamage" class="pool-coverage-section">
            <div class="pool-subtitle">乱流伤害（风属性）</div>
            <div class="pool-summary-body">
              <div class="pool-stat highlight">
                <span class="pool-stat-label">总乱流伤害</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.turbulenceDamage.totalDamage) }}</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">乱流次数</span>
                <span class="pool-stat-value">{{ anomalyPoolResult.turbulenceDamage.count }} 次</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">强化乱流</span>
                <span class="pool-stat-value">{{ anomalyPoolResult.turbulenceDamage.boostedCount }} 次</span>
                <span class="pool-stat-detail">风蚀+150%倍率</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">平均/次</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.turbulenceDamage.avgDamage) }}</span>
              </div>
            </div>

            <!-- 角色模块伤害汇总段（CC-444：原爱丽丝专块 → poolSummary 钩子） -->
            <div v-for="sec in poolSummarySections" :key="sec.title" class="pool-coverage-section">
              <div class="pool-subtitle">{{ sec.title }}</div>
              <div class="pool-summary-body">
                <div v-for="st in sec.stats" :key="st.label" class="pool-stat" :class="st.tone">
                  <span class="pool-stat-label">{{ st.label }}</span>
                  <span class="pool-stat-value">{{ st.value }}</span>
                  <span v-if="st.detail" class="pool-stat-detail">{{ st.detail }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
<div v-else class="rpv-empty-reason">{{ blockState.anomalyPool.reason }}</div>
</n-card>

        <!-- 异常虚拟面板 -->
        <n-card v-if="anomalyVirtualPanels.length > 0" size="small" class="virtual-panel-card" :bordered="true">
          <template #header>
            <span class="pool-title">异常虚拟面板</span>
          </template>
<template v-if="anomalyVirtualPanels.length > 0">
          <div v-for="vp in anomalyVirtualPanels" :key="vp.element" class="virtual-panel-block">
            <div class="virtual-panel-title">{{ elementLabel(vp.element) }}异常 · 总积蓄 {{ fmt(vp.totalBuildUp, 1) }}</div>
            <div class="virtual-panel-table">
              <div class="virtual-panel-row virtual-panel-head">
                <span>角色</span>
                <span>积蓄</span>
                <span>权重</span>
                <span>攻击</span>
                <span>精通</span>
                <span>增伤</span>
                <span>穿透率</span>
                <span>穿透值</span>
                <span>异化度</span>
              </div>
              <div v-for="row in vp.rows" :key="row.slot" class="virtual-panel-row">
                <span>{{ row.name }}<span v-if="row.settlementEligible === false" class="virtual-panel-gifted">（赠）</span></span>
                <span>{{ fmt(row.buildup, 1) }}</span>
                <span>{{ (row.weight * 100).toFixed(1) }}%</span>
                <span>{{ fmt(row.atk, 1) }}</span>
                <span>{{ fmt(row.anomalyProficiency, 1) }}</span>
                <span>{{ fmt(row.dmgBonus, 1) }}%</span>
                <span>{{ fmt(row.penRatio, 1) }}%</span>
                <span>{{ fmt(row.penFlat, 1) }}</span>
                <span>{{ fmt(row.refringe, 1) }}%</span>
              </div>
              <div class="virtual-panel-row virtual-panel-virtual">
                <span>{{ vp.virtual.name }}</span>
                <span>{{ fmt(vp.virtual.buildup, 1) }}</span>
                <span>100%</span>
                <span>{{ fmt(vp.virtual.atk, 1) }}</span>
                <span>{{ fmt(vp.virtual.anomalyProficiency, 1) }}</span>
                <span>{{ fmt(vp.virtual.dmgBonus, 1) }}%</span>
                <span>{{ fmt(vp.virtual.penRatio, 1) }}%</span>
                <span>{{ fmt(vp.virtual.penFlat, 1) }}</span>
                <span>{{ fmt(vp.virtual.refringe, 1) }}%</span>
              </div>
            </div>
          </div>
        </template>
<div v-else class="rpv-empty-reason">{{ blockState.virtualPanels.reason }}</div>
</n-card>

        <!-- 异常事件明细 -->
        <n-card v-if="anomalyEventRows.length > 0" size="small" class="pool-summary-card anomaly-event-card" :bordered="true">
          <template #header>
            <span class="pool-title">异常事件明细</span>
          </template>
<template v-if="anomalyEventRows.length > 0">
          <div class="event-table-wrap expanded">
            <table class="event-table">
              <thead>
                <tr>
                  <th>事件</th>
                  <th>来源</th>
                  <th>次数</th>
                  <th>当前公式</th>
                  <th>读取字段</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="event in anomalyEventRows" :key="event.id">
                  <td class="event-name">{{ event.label }}</td>
                  <td>{{ event.source }}</td>
                  <td class="event-count">{{ fmt(event.count, 1) }}</td>
                  <td class="event-formula">
                    <div>{{ event.formula }}</div>
                    <div v-if="event.note" class="event-note">{{ event.note }}</div>
                  </td>
                  <td class="event-fields">{{ event.fields.join(' · ') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
<div v-else class="rpv-empty-reason">{{ blockState.anomalyEvents.reason }}</div>
</n-card>

        <!-- 特殊动作汇总 -->
        <n-card size="small" class="pool-summary-card" :bordered="true">
          <template #header>
            <span class="pool-title">特殊动作喧响</span>
          </template>
<template v-if="specialActionBonus">
          <div class="pool-summary-body">
            <div class="pool-stat">
              <span class="pool-stat-label">弹刀 ({{ fmt(sumOf(specialActionBonus.perSlotParry), 1) }}次)</span>
              <span class="pool-stat-value">+{{ fmt(specialActionBonus.parry) }}</span>
              <span class="pool-stat-detail">{{ unitPriceText(PARRY_DECIBEL_BONUS) }}</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">连携 ({{ fmt(sumOf(specialActionBonus.perSlotChain), 1) }}次)</span>
              <span class="pool-stat-value">+{{ fmt(specialActionBonus.chain) }}</span>
              <span class="pool-stat-detail">{{ unitPriceText(CHAIN_DECIBEL_BONUS) }}</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">闪避反击 ({{ fmt(sumOf(specialActionBonus.perSlotDodgeCounter), 1) }}次)</span>
              <span class="pool-stat-value">+{{ fmt(specialActionBonus.dodgeCounter) }}</span>
              <span class="pool-stat-detail">{{ unitPriceText(DODGE_COUNTER_DECIBEL_BONUS) }}</span>
            </div>
            <div class="pool-stat bonus">
              <span class="pool-stat-label">总计</span>
              <span class="pool-stat-value">+{{ fmt(specialActionBonus.total) }}</span>
              <span class="pool-stat-detail">完整奖励之和；下方各角色 = 个人获得（含队友伴随50%）</span>
            </div>
            <div class="pool-per-slot">
              <span v-for="(val, i) in specialActionBonus.perSlotBonus" :key="i" class="slot-chip">
                {{ slotNames[i] ?? `槽${i}` }}: +{{ fmt(val) }}
              </span>
            </div>
          </div>
        </template>
<div v-else class="rpv-empty-reason">{{ blockState.specialAction.reason }}</div>
</n-card>
      <!-- 算出伤害后换算分数（用户 2026-10-28）：三条曲线（普通 / 绝境 / 木桩）各不相同，
           纯展示、不重新求值。曲线单一来源 data/deadlyAssaultScore.ts。 -->
      <DeadlyAssaultScoreCard :team-damage="teamTotalDamage" />

      <n-card v-if="teamOverview.length > 0" size="small" class="team-overview-card" :bordered="true">
        <template #header>
          <span class="pool-title">团队总览</span>
        </template>
        <div class="team-overview-table">
          <div class="team-overview-row team-overview-head">
            <span>角色</span>
            <span>伤害占比</span>
            <span>积蓄占比</span>
            <span>失衡占比</span>
            <span>能量</span>
            <span>喧响</span>
            <span>强特/终结</span>
          </div>
          <div v-for="row in teamOverview" :key="row.slot" class="team-overview-row">
            <span>{{ row.name }}</span>
            <span>{{ fmt(row.damage, 0) }} · {{ row.damagePct.toFixed(1) }}%</span>
            <span>{{ fmt(row.buildup, 1) }} · {{ row.buildupPct.toFixed(1) }}%</span>
            <span>{{ fmt(row.stun, 0) }} · {{ row.stunPct.toFixed(1) }}%</span>
            <span>{{ fmt(row.energy, 1) }}</span>
            <span>{{ fmt(row.decibel, 1) }}</span>
            <span>{{ fmt(row.exSpecialCount, 1) }} / {{ fmt(row.ultimateCount, 1) }}</span>
          </div>
        </div>
      </n-card>

      <!-- 伤害占比 -->
      <n-card v-if="damageShareCategories.length > 0" size="small" class="damage-share-card" :bordered="true">
        <template #header>
          <span class="pool-title">伤害占比与 3D 构成透视</span>
        </template>

        <!-- 3D 团队伤害构成图表 -->
        <TeamDamage3DChart
          :total-damage="teamTotalDamage"
          :categories="damageShareCategories"
          :characters="characterDamageShares"
          style="margin-bottom: 14px;"
        />

        <div class="damage-share-summary">
          <span>团队总伤害</span>
          <b>{{ fmt(teamTotalDamage, 0) }}</b>
        </div>
        <div class="share-category-row">
          <div v-for="cat in damageShareCategories" :key="cat.key" class="share-category-chip">
            <span>{{ cat.label }}</span>
            <b>{{ fmt(cat.damage, 0) }}</b>
            <span>{{ cat.pct.toFixed(1) }}%</span>
          </div>
        </div>
        <div v-for="share in characterDamageShares" :key="share.agentId" class="share-character">
          <div class="share-character-head">
            <span>{{ share.name }}</span>
            <b>{{ share.pct.toFixed(1) }}%</b>
          </div>
          <div class="share-character-cats">
            <span v-for="cat in share.categories" :key="cat.key" class="share-character-chip">
              {{ cat.label }} {{ fmt(cat.damage, 0) }} · {{ cat.pct.toFixed(1) }}%
            </span>
          </div>
        </div>
        <div class="share-note">极性紊乱、极性强击等角色专属事件暂未建模；异放事件已按角色/事件在个人伤害占比中显示。</div>
      </n-card>

      <!-- 伤害来源分解（诊断：总伤害异常时定位是倍率错还是属性区错） -->
      <n-card v-if="damageSourceBreakdown.length > 0" size="small" class="damage-source-card" :bordered="true">
        <template #header>
          <div class="damage-pool-header">
            <span>伤害来源分解</span>
            <span class="damage-pool-total">总伤害 {{ fmt(teamTotalDamage, 0) }} ≈ 直伤倍率×属性区 + 异常倍率×属性区</span>
          </div>
        </template>
        <div class="damage-source-table">
          <div class="damage-pool-row damage-pool-head damage-source-row damage-source-row-stun">
            <span>角色</span>
            <span>族</span>
            <span>总伤害</span>
            <span>总倍率(%)</span>
            <span>属性区（有失衡）</span>
            <span>属性区（无失衡）</span>
            <span title="有失衡 − 无失衡 占「有失衡」的比例，即 Boss 失衡窗把这一族伤害放大了多少">失衡期贡献率</span>
            <span title="该族伤害里落在失衡窗内的占比（伤害加权）——捏轴越集中、越贴窗，数越大">失衡爆发效率</span>
            <span>无倍率行伤害</span>
          </div>
          <template v-for="b in damageSourceBreakdown" :key="b.slot">
            <div v-if="b.direct.damage > 0 || b.direct.flatDamage > 0" class="damage-pool-row damage-source-row damage-source-row-stun">
              <span>{{ b.agentName }}</span>
              <span class="damage-type">直伤</span>
              <span class="damage-total">{{ fmt(b.direct.damage, 0) }}</span>
              <span>{{ fmt(b.direct.multiplier, 0) }}</span>
              <span>{{ fmt(b.direct.attrRegion, 0) }}</span>
              <span class="damage-source-nostun" title="只抹掉 Boss 失衡窗，常驻易伤（扳机 35%/55% 等）保留">{{ fmt(b.direct.attrRegionNoStun, 0) }}</span>
              <span class="damage-source-rate">{{ pctText(b.direct.stunContributionRate) }}</span>
              <span class="damage-source-rate">{{ pctText(b.direct.burstEfficiency) }}</span>
              <span>{{ fmt(b.direct.flatDamage, 0) }}</span>
            </div>
            <div v-if="b.anomaly.damage > 0 || b.anomaly.flatDamage > 0" class="damage-pool-row damage-source-row damage-source-row-stun">
              <span>{{ b.agentName }}</span>
              <span class="damage-type">异常</span>
              <span class="damage-total">{{ fmt(b.anomaly.damage, 0) }}</span>
              <span>{{ fmt(b.anomaly.multiplier, 0) }}</span>
              <span>{{ fmt(b.anomaly.attrRegion, 0) }}</span>
              <span class="damage-source-nostun" title="只抹掉 Boss 失衡窗，常驻易伤（扳机 35%/55% 等）保留">{{ fmt(b.anomaly.attrRegionNoStun, 0) }}</span>
              <span class="damage-source-rate">{{ pctText(b.anomaly.stunContributionRate) }}</span>
              <span class="damage-source-rate">{{ pctText(b.anomaly.burstEfficiency) }}</span>
              <span>{{ fmt(b.anomaly.flatDamage, 0) }}</span>
            </div>
          </template>
          <div class="damage-pool-row damage-source-row damage-source-row-stun damage-source-total-row">
            <span>全队</span>
            <span class="damage-type">合计</span>
            <span class="damage-total">{{ fmt(damageSourceTotals.damage, 0) }}</span>
            <span>{{ fmt(damageSourceTotals.multiplier, 0) }}</span>
            <span>{{ fmt(damageSourceTotals.attrRegion, 0) }}</span>
            <span class="damage-source-nostun" title="只抹掉 Boss 失衡窗，常驻易伤（扳机 35%/55% 等）保留">{{ fmt(damageSourceTotals.attrRegionNoStun, 0) }}</span>
            <span class="damage-source-rate">{{ pctText(damageSourceTotals.stunContributionRate) }}</span>
            <span class="damage-source-rate">{{ pctText(damageSourceTotals.burstEfficiency) }}</span>
            <span>{{ fmt(damageSourceTotals.flatDamage, 0) }}</span>
          </div>
        </div>
        <div class="share-note">
          属性区 = 有倍率行的伤害 ÷ (总倍率/100)，即每 100% 倍率对应的面板×乘区伤害；无倍率行（固定/附伤公式）单列。
          <b>属性区（无失衡）</b>只抹掉 Boss 失衡窗，非失衡期也生效的常驻易伤（如扳机 35%/55% 的 Always 通道）仍保留 ——
          「失衡期贡献率」= 1 − 无失衡/有失衡，就是本队 Boss 失衡系统对该族伤害的放大比例；
          <b>失衡爆发效率</b> = 该族伤害落在失衡窗内的占比（伤害加权），直接读该角色把伤害打进场的能力。
          合计行的倍率/属性区按伤害族合并后计算（两族倍率不同，属性区不能直接相加）。
        </div>
      </n-card>

      <!-- 伤害池 -->
      <n-card v-if="damagePoolRows.length > 0" size="small" class="damage-pool-card" :bordered="true">
        <template #header>
          <div class="damage-pool-header">
            <span>伤害池</span>
            <span class="damage-pool-total">总伤害 {{ fmt(teamTotalDamage, 0) }}</span>
          </div>
        </template>
        <div class="damage-pool-table">
          <div class="damage-pool-row damage-pool-head">
            <span>角色</span>
            <span>类型</span>
            <span>事件</span>
            <span>属性/来源</span>
            <span>次数</span>
            <span>单次</span>
            <span>失衡易伤</span>
            <span>总伤</span>
            <span>说明 / 公式</span>
          </div>
          <div v-for="row in damagePoolRows" :key="row.id" class="damage-pool-row">
            <span>{{ row.agentName }}</span>
            <span class="damage-type">{{ row.type }}</span>
            <span class="damage-name">{{ row.name }}</span>
            <span>{{ elementLabel(row.element) }} · {{ row.source }}</span>
            <span>{{ fmt(row.count, 2) }}</span>
            <span>{{ fmt(row.perDamage, 0) }}</span>
            <span
              class="damage-stun-vuln"
              :class="stunVulnClassOf(row)"
              :title="stunVulnTitleOf(row)"
            >{{ appliedVulnOf(row) }}</span>
            <span class="damage-total">{{ fmt(row.totalDamage, 0) }}</span>
            <span class="damage-note">
              <template v-if="row.note">{{ row.note }}</template>
              <span v-if="row.formula" class="damage-formula">{{ row.formula }}</span>
              <template v-if="!row.note && !row.formula">-</template>
            </span>
          </div>
          <div class="damage-pool-row damage-pool-footer">
            <span class="damage-pool-footer-label">加权有效易伤</span>
            <span class="damage-pool-footer-value">
              {{ stunVulnSummary.weightedVuln.toFixed(3) }}
              <span class="damage-pool-footer-sub">
                （信用 +{{ stunVulnSummary.weightedCredit.toFixed(3) }} / 满额 +{{ stunVulnSummary.fullCredit.toFixed(2) }}
                = {{ (stunVulnSummary.coverageRate * 100).toFixed(1) }}%）
              </span>
            </span>
          </div>
          <div v-if="stunVulnPerSlot.length > 1 && stunVulnSummary.fullCredit > 1e-9" class="damage-pool-row damage-pool-slots">
            <span class="damage-pool-footer-label">逐人增幅</span>
            <span v-for="p in stunVulnPerSlot" :key="p.slot" class="damage-pool-slot-item">
              {{ p.name }} <b>+{{ p.credit.toFixed(3) }}</b>
              <span class="damage-pool-footer-sub">（兑现 {{ (p.coverageRate * 100).toFixed(0) }}% · 额外伤害 {{ fmt(p.total - p.total / p.weightedVuln, 0) }}）</span>
            </span>
          </div>
          <!-- 用户裁决 2026-10-19：非轴不做自动认领，只如实报出「你填的贡献率」 -->
          <div v-if="noAxisVulnShareNotice" class="damage-pool-row damage-pool-conc-note">
            <span class="damage-pool-footer-label">非轴易伤</span>
            <span class="damage-pool-footer-value">
              <span class="damage-pool-footer-sub">{{ noAxisVulnShareNotice }}</span>
            </span>
          </div>
        </div>
      </n-card>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * **资源池共享视图**（T188，用户 2026-11-03 口径）：把**资源页那一整套**做成一个组件，由「一个档位
 * 快照」喂进来，**ResultPage 与各比较入口共用** ⇒ 以后加一块资源展示只改这一处（本仓最怕「两处漂移」）。
 *
 * ## 口径（用户逐字）
 * > 「我在**很多地方的比较**中都会要求**完整的资源展示页显示**，**资源页的一切**支撑了结果的有效性
 * >  和可溯源性。」
 *
 * ⇒ 不是摘要卡：**完整 = 默认全含**——池摘要 · 失衡池 · 轴窗卡（逐窗兑现图）· 异常池 · 虚拟面板 ·
 * 异常事件 · 特殊动作加成 · 队伍总览 · 伤害占比 / 伤害来源 / 伤害池 · 三角色资源卡全在。
 * ⇒ 缺读数（非轴队 / 弃轴 / 未采）⇒ 该块**如实写「无/未采」+ 原因**（判据住
 * `composables/resourcePoolView.ts#resourceBlockStates`），**不补造、不编 0**。
 *
 * ## 取数（硬约束）
 * 本组件**不读任何 store 的读数字段**，只读 prop `snapshot`（一个档位快照）+ 目录（取名/职业，静态）。
 * 原因：比较入口的「这一档」是**差分重放**出来的，页面 store 属于**当前档** ⇒ 现读会显示另一个档的数字
 * （见 `composables/curvePointPool.ts` 头注释）。构造快照的唯一入口 =
 * `composables/resourcePoolView.ts#resourcePoolSnapshotFromCalc`（ResultPage 传 UI 现场，比较入口传
 * 该档重放场景）——两个入口喂进来的是**同一种东西**。
 *
 * ## 渲染（本组件只有渲染 + 取名，判定与派生全在 composable）
 * 模板正文从 `views/ResultPage.vue` **原样搬来**（逐块搬、逐块点通），页面级符号改为快照别名：
 * `resourceResult` / `stunPoolResult` / … 这些名字与页面原先逐块读 `calc.*.value` 时**逐字一致**。
 */
import { computed, useAttrs } from 'vue'
import { NCard, NAlert, NButton } from 'naive-ui'
import ResourceResultCard from '@/components/ResourceResultCard.vue'
import AxisWindowChart from '@/components/AxisWindowChart.vue'
import TeamDamage3DChart from '@/components/charts/TeamDamage3DChart.vue'
import DeadlyAssaultScoreCard from '@/components/charts/DeadlyAssaultScoreCard.vue'
import { fmt } from '@/utils/format'
import { damageElementLabel as elementLabel } from '@/utils/agentLabelMaps'
import { useCatalogStore } from '@/stores/catalog'
import { useStunDiscreteDisplay } from '@/composables/stunDiscreteDisplay'
import {
  buildTeamTimeSummary,
  poolFillText as poolFillTextOf,
  slackHint as slackHintOf,
  truncationHint as truncationHintOf,
} from '@/composables/teamTimeSummary'
import { axisMoveNameResolver } from '@/composables/axisMoveName'
import { useStunVulnDisplay } from '@/composables/stunVulnDisplay'
import { axisFallbackNoticeOf } from '@/composables/axisFallbackNotice'
import { capabilityGateNoticeOfSnapshot } from '@/composables/capabilityGateNotice'
import { bossAttackBudgetNoticeOfSnapshot } from '@/composables/bossAttackBudgetNotice'
import { PARRY_DECIBEL_BONUS, CHAIN_DECIBEL_BONUS, DODGE_COUNTER_DECIBEL_BONUS } from '@/data/anomalyDecibelBonuses'
import { DECIBEL_COMPANION_RATIO } from '@/data/decibelCompanion'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
import { computeDamageSourceTotals } from '@/composables/resourceCalc/helpers'
import {
  RESOURCE_POOL_NOT_COLLECTED,
  axisFillMoveGroupsOf,
  axisWindowsOf,
  anomalyEventRowsOf,
  characterDamageSharesOf,
  damageShareCategoriesOf,
  resourceBlockStates,
  teamOverviewOf,
  type ResourcePoolSnapshot,
} from '@/composables/resourcePoolView'

const props = withDefaults(defineProps<{
  /** **一个档位**的资源池快照（唯一入参）；`null` ⇒ 渲染「未采 + reason」（不补造） */
  snapshot: ResourcePoolSnapshot | null
  /** 抬头（比较入口写「哪一档」；ResultPage 不传） */
  title?: string
  /** 口径 / 来历说明（比较入口写「这一档的现场是哪来的」；ResultPage 不传） */
  reason?: string
}>(), { title: '', reason: '' })

/**
 * 父方是否接了「去调合轴率」（`@adjust-combo-align`）。
 * 只有结果页有那个弹窗 ⇒ 比较入口**不给死按钮**（按钮只在动作真的接上了才出现）。
 */
const attrs = useAttrs()
const hasComboAlignAction = computed(() => typeof attrs.onAdjustComboAlign === 'function')
function requestComboAlign(): void {
  const listener = attrs.onAdjustComboAlign
  if (typeof listener === 'function') (listener as () => void)()
}

const catalogStore = useCatalogStore()

/**
 * 快照别名：名字与页面原先逐块读 `calc.*.value` 时**逐字一致**（模板正文因此不用改）。
 * ⚠ 这里的 `?? 缺省` 只在 `snapshot === null` 时可达，而那条分支整块走「未采」占位
 * （模板 `<template v-else>`）⇒ **不会把「没量到」显示成 0**。
 */
const snapshot = computed(() => props.snapshot)
const resourceResult = computed(() => snapshot.value?.resourceResult ?? null)
const stunPoolResult = computed(() => snapshot.value?.stunPool ?? null)
const anomalyPoolResult = computed(() => snapshot.value?.anomalyPool ?? null)
const specialActionBonus = computed(() => snapshot.value?.specialActionBonus ?? null)
const damagePoolRows = computed(() => snapshot.value?.damagePoolRows ?? [])
const teamTotalDamage = computed(() => snapshot.value?.damage ?? 0)
const damageSourceBreakdown = computed(() => snapshot.value?.damageSourceBreakdown ?? [])
const damageSourceTotals = computed(() => snapshot.value?.damageSourceTotals ?? computeDamageSourceTotals([]))
const anomalyVirtualPanels = computed(() => snapshot.value?.anomalyVirtualPanels ?? [])
const poolSummarySections = computed(() => snapshot.value?.poolSummarySections ?? [])
const agentNames = computed(() => snapshot.value?.agentNames ?? {})
const slotNames = computed(() => snapshot.value?.slotNames ?? [])
const slotLabels = computed(() => snapshot.value?.slotLabels ?? [])
const slotAgentIds = computed(() => snapshot.value?.slotAgentIds ?? [])
const panels = computed(() => snapshot.value?.panels ?? [])
/** 连续失衡读数（完整 N 次 + 下一窗进度 X%；无池读数 ⇒ null，不编 0） */
const continuousStun = computed(() => snapshot.value?.continuousStun ?? null)
/** 已兑现窗口读数（窗内发呆 / 空闲容器；无池读数 ⇒ null，不编 0） */
const stunRealization = computed(() => snapshot.value?.stunRealization ?? null)
/** 二元相位时序（积攒 / 窗 / 余量）；该档没有池读数时引擎也不产出 ⇒ null */
const stunPhaseTimeline = computed(() => snapshot.value?.stunPhaseTimeline ?? null)

/** 三态（有读数 / 无读数 + 原因 / 未采）：页面据此渲染，**不把块藏起来** */
const blockState = computed(() => resourceBlockStates(snapshot.value))

/**
 * 残疾失衡载荷（逻辑在 `composables/stunDiscreteDisplay.ts`；展示层不 import `@/core`）。
 * ⚠ 传 **ref 给模板**、**不在 setup 顶层写 `.value`**（旧写法踩过 TDZ，见该模块头注释）。
 * 窗长 / 有效时长取**快照里那一档**的值——比较入口的那一档与页面现场可能不同队（队友失衡延时不同）。
 */
const stunDiscrete = useStunDiscreteDisplay({
  pool: () => stunPoolResult.value,
  windowDuration: () => snapshot.value?.windowDuration ?? null,
  effectiveTime: () => snapshot.value?.effectiveTime ?? null,
})

/** 全队时间分配汇总（账本口径 vs 物化口径 + 留白归因）；计算在 `composables/teamTimeSummary.ts` */
const teamTimeSummary = computed(() => buildTeamTimeSummary({
  rr: resourceResult.value,
  battleTime: snapshot.value?.battleTime ?? 0,
  invincibleTime: snapshot.value?.invincibleTime ?? 0,
  nameOf: (agentId, slot) => agentNames.value[agentId] || `槽${slot}`,
}))
const poolFillText = computed(() => poolFillTextOf(teamTimeSummary.value))
const slackHint = computed(() => slackHintOf(teamTimeSummary.value, fmt))
const truncationHintText = computed(() => truncationHintOf(teamTimeSummary.value, fmt))

/**
 * 招式名解析：**共享解析器**（`composables/axisMoveName.ts`）——平A 标识 → 模块连段名 →
 * 目录倍率表 → 回落 `moveId`（**不编名字**）。槽位 → agentId 走快照（该档的队伍，不是页面现场）。
 */
const axisMoveName = axisMoveNameResolver({
  agentIdOf: slot => slotAgentIds.value[slot] ?? '',
  skillsOf: agentId => catalogStore.getAgentSkills(agentId),
})
/** 槽位 → 角色名（1-based 旧口径：总览 / 逐窗图道名 / 填充分组共用一份） */
const slotLabelOf = (slot: number): string => slotLabels.value[slot] ?? `${slot + 1} 号位`

/** 逐窗兑现图（轴窗即失衡窗 ⇒ 一张图同时把轴与失衡画出来）；非轴队 / 弃轴 ⇒ 空视图 + 「无 + 原因」 */
const axisWindows = computed(() => axisWindowsOf(snapshot.value, axisMoveName, slotLabelOf))
/** 窗尾填充 → 真实招式（与伤害侧同一个兜底池函数与同一份资源读数） */
const axisFillMoveGroups = computed(() => axisFillMoveGroupsOf(snapshot.value, axisMoveName, slotLabelOf))

/** 伤害占比 / 个人占比 / 队伍总览 / 异常事件行：判定口径全在 `composables/resourcePoolView.ts` */
const damageShareCategories = computed(() => damageShareCategoriesOf(damagePoolRows.value, teamTotalDamage.value))
const characterDamageShares = computed(() => (snapshot.value ? characterDamageSharesOf(snapshot.value) : []))
const teamOverview = computed(() => (snapshot.value
  ? teamOverviewOf(snapshot.value, characterDamageShares.value, agentId => catalogStore.getAgent(agentId))
  : []))
const anomalyEventRows = computed(() => (snapshot.value ? anomalyEventRowsOf(snapshot.value) : []))

/** 失衡易伤可见化（账本 Open #2）——依赖以最小读数注入：**只给 Boss 失衡易伤基数** */
const { appliedVulnOf, stunVulnClassOf, stunVulnTitleOf, stunVulnSummary, stunVulnPerSlot } = useStunVulnDisplay({
  // getter ⇒ 每次读都是**当前快照**的值（不用 setup 那一刻的冻结值）
  enemy: { get stunVuln() { return snapshot.value?.enemyStunVuln ?? 0 } },
  panels,
  damagePoolRows,
})

/** 琉音好评转大拆分（资源卡展示；零求值影响） */
const liuyinHugSplit = computed(() => ({
  hug60: snapshot.value?.ultPromoteHug60 ?? 0,
  hug90: Math.max(0, (snapshot.value?.ultPromoteCount ?? 0) - (snapshot.value?.ultPromoteHug60 ?? 0)),
}))

/**
 * 非轴「易伤贡献率」φ 的「来源可见」标注（用户裁决 2026-10-19：非轴不做自动认领、由用户自己填）。
 * 只在**非轴** + φ ≠ 100% 时显示；轴模式不显示（轴里每一招在不在窗内是引擎实算的）。
 */
const noAxisVulnShareNotice = computed<string | null>(() => {
  const s = snapshot.value
  if (!s || s.isAxisMode) return null
  const share = s.noAxisVulnShare
  if (!(share < 1)) return null
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  return `非轴·易伤贡献率 ${Math.round(share * 100)}%：时间覆盖 ${pct(s.stunCoverage)} × 你填的 ${pct(share)} = ${pct(s.stunCoverage * share)}`
    + `（100% = 每招均匀摊；去队伍配置页调）`
})

/** 百分比展示（伤害来源分解的「失衡期贡献率 / 失衡爆发效率」两列）：一位小数，与页面其它百分比一致 */
function pctText(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

/** 合轴吸收率（综合旋钮）——三项分解里「综合吸收」那行的口径说明要显示它（读**该档**的设置） */
const comboAlignAbsorbPct = computed(() => Math.round((snapshot.value?.comboAlignAbsorbRatio ?? 0) * 100))

/** 特殊动作喧响卡的次数求和（与喧响值同源 = 引擎本轮实际计入的每槽次数） */
const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** 特殊动作喧响卡说明文字「单价/次 · 伴随 单价×50%」（单价与伴随比例读 data 单一来源，不手写） */
function unitPriceText(unit: number): string {
  return `${unit}/次 · 伴随${unit * DECIBEL_COMPANION_RATIO}`
}

/** 职业（资源卡标签）；catalog 是唯一来源 */
function getSpecialty(agentId: string): string {
  return catalogStore.getAgent(agentId)?.specialty ?? ''
}

/**
 * 弃轴提示：读数全部来自**快照**（该档的轴开关 / 吸收率 / 弃轴读数 / 自动轴命中），
 * 判定口径住 `composables/axisFallbackNotice.ts`（纯函数 + 单测）。
 */
/**
 * 机制「入场券」未满足提示：读数全部来自**快照**（该档的交互次数现状 + 该档的资源结果），
 * 判定口径住 `composables/capabilityGateNotice.ts`（纯函数 + 单测）。与弃轴提示并列：两者都是
 * 「下面这些数是怎么算出来的」的更正，必须比伤害数字先被读到。
 */
const capabilityNotice = computed(() => capabilityGateNoticeOfSnapshot(
  { resourceResult: snapshot.value?.resourceResult ?? null, slotLabels: snapshot.value?.slotLabels },
  (slot, field) => snapshot.value?.interactionCounts[slot]?.[field] ?? 0,
))

/**
 * **计算失真提示**（用户口径 2026-11-04：「提醒了计算失真就行了，不用管错误计算的逻辑」）。
 *
 * 与上面那条「入场券」提示**同一条渲染通道**（交接 §五 明确要求复用，不另开一套 UI），
 * 但回答的是另一个问题：「我填的交互次数为什么没兑现」。
 * 判定口径住 `composables/bossAttackBudgetNotice.ts`（纯函数 + 单测），本组件只渲染。
 */
const budgetNotice = computed(() => {
  const snap = snapshot.value
  if (!snap) return { show: false, title: '', detail: '', misses: [] }
  // 入参与快照同形 ⇒ 整份传（预算分母从 snap.resourceResult.plannedStunCount 取，与引擎同源）。
  // ⚠ 别改成读 snap.stunCoverage（上一轮派生量，实测与引擎差 8 次：引擎兑现 66 却提示 58）。
  return bossAttackBudgetNoticeOfSnapshot(snap)
})

const axisNotice = computed(() => axisFallbackNoticeOf(
  {
    useStunAxis: snapshot.value?.useStunAxis ?? false,
    getMechanicSetting: (id, fallback) => (id === COMBO_ALIGN_ABSORB_RATIO_SETTING
      ? snapshot.value?.comboAlignAbsorbRatio ?? fallback
      : fallback),
  },
  snapshot.value?.axisFallback ?? false,
  snapshot.value?.autoActive ?? false,
))
</script>

<style scoped src="./resourcePool/resource-pool-view.css"></style>
