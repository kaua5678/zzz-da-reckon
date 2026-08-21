# 机制模式目录（游戏文本 → 计算逻辑的翻译词典）

> 状态：v0.1 —— 分类学与四级确定性模型已定，数据基于全部 60 角色的实测提炼（228 条模式条目）。

> 本文档定位：给 AI 录入者的**模式匹配词典**——拿到一段游戏技能文本，先在这里找到它属于哪个模式，
> 再按模式的固定落点与验收标准落地。公式与数值本体仍在倍率表/代码里，本文档不重复。
>
> 三层愿景（用户定义，本文档按此组织）：
> 1. **不凹分的理解水平**：资源循环、属性、倍率等确定性内容由 AI 全自动正确录入（L0+L1，机器可验证）；
> 2. **凹分只录一部分**：最优化思想（轴设计/最优资源分配/上限操作）由用户拍板，录入面缩到最小（L3 协议）；
> 3. **凹分思想再提炼**：每次 L3 拍板沉淀成模式，新角色命中时自动降级为 L1/L2（§4 提炼路径）。

## 0. 30 秒使用法

翻译一条机制 = 依次回答四问：

1. **触发句式是什么？** → 到 §2 的维度表里按措辞指纹匹配
2. **效果落到哪个维度？** → 9 选 1
3. **确定性几级？** → L0 数据直读 / L1 规则直译 / L2 需要近似滑块 / L3 需要用户拍板
4. **按模板落地 + 验收** → L2 必加滑块 + 生效测试；L3 走 §4 录入协议；L0/L1 走对应落点 + golden 值

## 1. 确定性四级：全自动化的边界

| 级 | 含义 | 谁来翻译 | 怎么验收 | 实测占比（60 角色） |
|---|---|---|---|---|
| **L0 catalog 直读** | 倍率/面板/攻速/动作时间/等级成长——数据即事实 | 导入脚本（nanoka 爬取） | `validate:data` 完整性护栏 | ~2%（条目里显式出现少，因为大部分直读不在 spec 里） |
| **L1 deterministic_rule** | 文本规则确定：CD 驱动次数、固定倍率、"每 X 秒一次"、公式转模 | AI 直接翻译成代码 | 模块测试 golden 值 / verifications | ~46% |
| **L2 approximation** | "覆盖率/占比/默认次数"必须近似：buff 覆盖、状态常驻、命中频率 | AI 建模 + **可调滑块暴露假设** | 「改滑块 → 结果确实变」生效测试 | ~43% |
| **L3 user_meta** | 凹分理解：轴设计、最优资源分配、上限操作逻辑 | **用户拍板**（[已确认] 或 [猜测·]） | verifications 固化 golden 值 + 命座提升率自检 | ~10% |

**要义**：L0+L1 就是你说的"不凹分也能正确录入"的全部内容；L2 是"AI 建模、用户调节"的协作区；
L3 是当前唯一必须人肉的部分，也是未来自动化收益最高的部分（§4）。

## 2. 九个计算维度（效果落点）

### D1 catalog_direct —— 倍率/面板直读
- **指纹**：无"效果文本"——倍率表行、基础属性、动作时间、等级成长
- **落点**：`public/static/catalog.json`（唯一事实源，脚本导入，勿手改）
- **验收**：`validate:data`（完整性/孤儿 id/状态表同步）
- **范例索引**（录新角色时对照；实现落点与测试均经 grep 验证存在）

| 模式子类 | 角色 | 触发句式 | 实现落点 | 验收 | 等级 |
|---|---|---|---|---|---|
| 倍率表行直读 | 通用 | 从 SkillMove.rows 取 damage/daze/anomaly_buildup/decibel_recovery | `getRowValue (composables/resourceCalc/helpers.ts)` | 无 | L0 |
| 基础属性面板直读 | 通用 | 角色+音擎基础属性进面板（hp/atk/def/暴击/冲击/精通…） | `calcBasePanel (core/panel.ts)` 读 `agent.level60.*Base` | catalogData.test.ts | L0 |
| 等级成长系数 | 通用 | 技能等级 → 伤害/失衡系数（12 级基准，3 命+2、5 命+4） | `getSkillLevelCoef (core/skillLevel.ts)` `(skillLevel+10)/22` | skillLevel.test.ts | L0 |
| 倍率表等级分段取值 | 蕾米埃尔 | 倍率表按技能等级索引 levelValues 取分段值 | `pickRemielleLevelValue (core/damage.ts)` | 无 | L0 |
| 动作时间直读 | 通用 | 强特/终结/连携动作时间从 catalog move.actionTime 读 | `findExSpecial (core/resource.ts)` `move.actionTime ?? 0` | 无 | L0 |
| catalog 数据加载（唯一事实源） | 通用 | fetch('/static/catalog.json') 脚本导入 | `load (stores/catalog.ts)` | catalogData.test.ts | L0 |

### D2 panel_effect —— 面板字段型（buff/减抗/转模）
- **指纹**："自身攻击提升X%"、"敌人X抗性降低Y%"、"每点A提高B"、"处于X状态时…"
- **落点**：`applyPanel`（读 `input.settings` 取滑块，勿走私 panel 字段）；属性转模走 `attributeConversions` + `applySpecAttributeConversions`
- **验收**：面板 diff 生效测试（例：banyue 怒相增益 0/0.5/1 三档差 300/36/36）
- **范例索引**（录新角色时对照；实现落点与测试均经 grep 验证存在）

| 模式子类 | 角色 | 触发句式 | 实现落点 | 验收 | 等级 |
|---|---|---|---|---|---|
| 状态增益·覆盖率滑块 | 般岳(1471) | 强特后贯穿+300/火伤+36%/暴伤+36% | applyBanyuePanel（banyue.ts） | banyue.test.ts | L2 |
| 额外能力暴击+减抗 | 朱鸢(1241) | 额外能力暴击+30%；C4无视25%以太抗性 | applyZhuYuanPanel（zhuYuan.ts） | zhuYuan.test.ts | L1 |
| 属性转模·精通→攻击 | 简(1261) | 精通>120每点+2攻击（上限600） | applyJanePanel（jane.ts） | 无 | L1 |
| 属性转模·hp→贯穿力 | 伊德海莉(1051) | 核心被动 hp→贯穿力 0.1/点 | applyYidhariPanel（yidhari.ts） | 无 | L1 |
| 减抗+精通转模 | 爱丽丝(1401) | C4无视10%物理抗性+精通转掌控 | applyAlicePanel（alice.ts） | 无 | L1 |
| 生命转攻击·转模 | 卢西娅(1451) | C6 以太帷幕内 生命2%→攻击 | applyLuciaPanel（luciaElowen.ts） | luciaElowen.test.ts | L1 |

### D3 multiplier —— 乘区型（增伤/暴伤/贯穿/易伤）
- **指纹**："伤害提升X%"、"暴击伤害+X%"、"无视Y%防御"、"失衡易伤+X%"
- **落点**：全局加 panel 字段；**招式限定的按 moveId 集合在 `patchExecutions` 加 exec 级字段**（ENGINE_PIPELINE §4 坑11：星辉类指定招式增伤不要挂全局）
- **验收**：moveId 级 golden 值（该加的招式有、不该加的没有）
- **范例索引**（录新角色时对照；实现落点与测试均经 grep 验证存在）

| 模式子类 | 角色 | 触发句式 | 实现落点 | 验收 | 等级 |
|---|---|---|---|---|---|
| 招式限定增伤 | 妮可(1031) | C1 强化特殊技伤害+16% | patchExecutions（nicole.ts） | nicole.test.ts | L1 |
| 核心暴伤定向挂载 | 艾莲(1191) | 核心被动指定招式暴伤+ | patchEllenExecutions（ellen.ts） | ellen.test.ts | L1 |
| 强特倍率拆分 | 雨果(1291) | 强特拆决算/普通两段结算 | patchHugoExecutions（hugo.ts） | hugo.test.ts | L1 |
| 额外能力乘区 | 伊芙琳(1321) | 额外能力×1.25 连携/终结增伤 | patchEvelynExecutions（evelyn.ts） | evelyn.test.ts | L1 |
| 覆盖率增伤 | 悠真(1201) | 核心暴伤定向+C2电壶增伤 | patchHarumasaExecutions（harumasa.ts） | harumasa.test.ts | L2 |
| 覆盖率增伤·挂普攻 | 可琳(1061) | 核心专注 电锯斩击+37.5% | patchCorinExecutions（corin.ts） | corin.test.ts | L2 |

### D4 count_cycle —— 次数/循环型（资源循环、层数状态机）
- **指纹**："每次命中得1层"、"消耗N层"、"每 X 次触发一次"
- **落点**：简单计数走 spec resources 解释器；复杂循环走模块纯函数（computeXxxCycle）；「模块写 cfg、spec 读」用 `countSource: cfgField`
- **验收**：循环次数 golden 值 + 全管线冒烟
- **范例索引**（录新角色时对照；实现落点与测试均经 grep 验证存在）

| 模式子类 | 角色 | 触发句式 | 实现落点 | 验收 | 等级 |
|---|---|---|---|---|---|
| 简单计数（spec resources 解释器 + 模块分账） | 猫又 | 呼噜能量按「消耗占比」分给尾巴失踪术 30 点/绒爪穿刺 40 点 | `adjustPurrSpendCounts (nekomata.ts)` + `computeSpecResources` | 无 | L2 |
| 复杂循环（模块纯函数） | 伊芙琳 | 燎索点每满 3 点替换下一次绞勒式为月辉丝·绊 | `computeEvelynCycle (evelyn.ts)` | evelyn.test.ts | L2 |
| 资源兑换双上限（用户口径） | 耀嘉音 | 付费震音 = min(⌊能量/25⌋, 入场次数) | `computeYaojiayinTremolos (yaojiayin.ts)` | yaojiayin.test.ts | L3 |
| 复杂循环（模块纯函数） | 悠真 | 甲乙矢命中/锋芒叠层；每 12 次甲乙矢生成一次电磁爆炸 | `computeHarumasaCycle (harumasa.ts)` | harumasa.test.ts | L2 |
| 复杂循环（模块纯函数） | 扳机 | 狙击命中得绝意，普通协奏耗 3 绝意/冥狱耗 5 绝意 | `computeTriggerCycle (trigger.ts)` | trigger.test.ts | L2 |
| 模块写 cfg、spec 读（valueSource/countSource: cfgField） | 朱鸢 | 强化霰弹获取/消耗循环；影画1 快速装填连携 6/终结 9 | `computeZhuYuanShellsTotal (zhuYuan.ts)` + `spec 1241.json` | zhuYuan.test.ts | L1 |

### D5 time_window —— 时间窗口/CD 驱动型
- **指纹**："X秒内最多一次"、"每X秒"、"状态持续Y秒"
- **落点**：`floor(战斗时间 / CD)` 次数折算进 cfg；覆盖率进 panel；**占前台时间的动作必须计 estimateExSpecialTime**（否则时间预算外层兜底压缩平A池）
- **验收**：次数 golden 值；占用前台的行在 sweep 断言不溢出
- **范例索引**（录新角色时对照；实现落点与测试均经 grep 验证存在）

| 模式子类 | 角色 | 触发句式 | 实现落点 | 验收 | 等级 |
|---|---|---|---|---|---|
| CD 次数折算进 cfg（floor 开局能量） | 妮可 | 触发核心减益回 5 能量，15s CD | `buildCharConfig (nicole.ts)` `NICOLE_C2_CD=15` → `floor(battleTime/15)×5` | nicole.test.ts | L1 |
| CD 次数折算（floor 前台时间） | 露西 | 抄家伙调用次数 = floor(前台时间 / cd)，后台不占前台 | `computeLucyBoarCount (lucy.ts)` `lucyBoarCd` 钳制 4–6s | lucy.test.ts | L1 |
| CD 次数折算进回能/喧响（10s 上限） | 爱芮 | 异放触发回 4 能量 + 70 喧响，10 秒一次 | `buildAireCharConfig (aire.ts)` `AIRE_C4_CD_SECONDS=10` → `floor(t/10)` | aire.test.ts | L1 |
| CD 次数 × 覆盖率滑块 | 莱卡恩 | 影画1 强化攻击 8s CD 触发一次 | `buildExecutions (lycaon.ts)` `min(exCount, floor(t/8)×lycaonC1Coverage)` | lycaonSmoke.test.ts | L2 |
| CD 次数折算（蓄力段） | 耀嘉音 | 影画6 精准支援追加随想曲蓄力段，10s CD | `computeYaojiayinTremolos (yaojiayin.ts)` `YAOJIAYIN_C6_CAPRICCIO_CD=10` → `min(precise, floor(t/10))` | yaojiayin.test.ts | L1 |
| 占前台时间 estimateExSpecialTime | 诺姆 | 长按延长射击占前台（点射#1 0.493s + 弹头 0.74s + 延长/s） | `estimateExSpecialTime (norma.ts)` 返回 necessaryTime | normaSmoke.test.ts | L1 |

### D6 resource_pool —— 能量/闪能/喧响资源池
- **指纹**："回复X能量"、"消耗Y喧响"、"进入战场获得Z闪能"、"每降低1%生命获得…"
- **落点**：`calcEnergySource` 或跨角色回能走 `calcCrossAgentEnergy`（单一事实源）；喧响走 decibel 通道；入场赠送 `initialEnergyGift`
- **验收**：energySource 账本逐项对账（yixuanSmoke 的账本注释模式）；derivedEnergy 与 exSpecialCount 口径一致
- **范例索引**（录新角色时对照；实现落点与测试均经 grep 验证存在）

| 模式子类 | 角色 | 触发句式 | 实现落点 | 验收 | 等级 |
|---|---|---|---|---|---|
| 入场闪能赠送 | 仪玄(1371) | 进场恢复全部闪能（120） | buildYixuanCharConfig→cfg.initialEnergyGift（yixuan.ts） | yixuanSmoke.test.ts | L1 |
| 烧血喧响·decibel | 伊德海莉(1051) | 每降低1%生命回复10喧响 | computeYidhariHpSource（yidhari.ts） | 无 | L1 |
| CD驱动回能 | 莱卡恩(1141) | C2 失衡+连携次数×5能量 | buildCharConfig→cfg.lycaonC2EnergyPerTrigger（lycaon.ts） | lycaonSmoke.test.ts | L1 |
| CD驱动回能 | 诺姆(1571) | C2 帽子把戏回25能量/20s | buildNormaCharConfig→cfg.normaC2EnergyPerTrigger（norma.ts） | normaSmoke.test.ts | L1 |
| 终结技邻位回能 | 丽娜(1211) | 终结技 下一位+30/上一位+10 | assignRinaUltNeighborEnergy（rina.ts） | rina.test.ts | L1 |
| 邻位+全队回能 | 露西(1151) | 终结邻位+30/10；C1全队+2 | assignLucyUltNeighborEnergy（lucy.ts） | lucy.test.ts | L1 |

### D7 team_link —— 队伍联动型
- **指纹**："队伍存在X时"、"全队攻击+"、"邻位角色…"、"同属性队友…"
- **落点**：静态拐力进 `teammate-buffs.json`（按命座门控）；动态/需要次数的走 `applyTeamConfig` 三阶段钩子（禁止往 useResourceCalc 加 agentId 分支）
- **验收**：teamHook.test.ts 模式（crossAgent 明细作观测口）；条件门控测试（不满足条件=0）
- **范例索引**（录新角色时对照；实现落点与测试均经 grep 验证存在）

| 模式子类 | 角色 | 触发句式 | 实现落点 | 验收 | 等级 |
|---|---|---|---|---|---|
| 静态拐力（teammate-buffs fixed） | 凯撒 | 荣光之盾持有者攻击力提升 1000 点 | teammate-buffs.json 1071（fixed atkFlat） | caesar.test.ts | L1 |
| 静态拐力（teammate-buffs stacked） | 青衣 | 羁服每层使失衡易伤 +4%，最多 20 层 | teammate-buffs.json 1251（stacked stunDmgMultiplierBonus，defaultStacks=20） | 无 | L2 |
| 静态拐力（teammate-buffs formula） | 耀嘉音 | 咏叹华彩全队伤害/暴伤随特殊技等级 | `computeAriaBonuses (yaojiayin.ts)` + teammate-buffs.json 1311 | yaojiayin.test.ts | L1 |
| 动态邻位回能（applyTeamConfig build） | 丽娜 | 终结技邻位回能 30/隔位 10 | `applyTeamConfig` → `applyRinaTeamEnergyFlags (rina.ts)` | teamHook.test.ts | L1 |
| 动态邻位回能（applyTeamConfig build） | 露西 / 苍角 | 终结技其他角色 +10 能量，下一位换入额外 +20 | `applyTeamConfig` → `applyLucyTeamEnergyFlags (lucy.ts)` / `applySoukakuTeamEnergyFlags (soukaku.ts)` | teamHook.test.ts | L1 |
| 动态三阶段（applyTeamConfig build/converge/postRound） | 莱特 | 影画4 后场喷发回能 +4/次（18s CD），后场占比滑块 | `applyTeamConfig` → `applyLighterTeamEnergyFlags (lighter.ts)` | teamHook.test.ts | L2 |

### D8 damage_event —— 附伤/事件伤害行
- **指纹**："额外造成X%攻击力伤害"、"追加Y%…"、"每N次生成一次…"
- **落点**：模块 `buildExecutions`/`patchExecutions` 推合成行（假 moveId 防 daze/anomaly 双计）；倍率 override `damageMultiplierOverride`
- **验收**：行存在 + 倍率 golden + 假 id 不进失衡/异常池
- **范例索引**（录新角色时对照；实现落点与测试均经 grep 验证存在）

| 模式子类 | 角色 | 触发句式 | 实现落点 | 验收 | 等级 |
|---|---|---|---|---|---|
| 合成执行行（buildExecutions + 假 moveId） | 珂蕾妲 | 影画6 饱和爆破额外 360% 攻击力伤害 | `buildKoledaExecutions (koleda.ts)`（moveId `1101_c6_saturation_explosion`） | koleda.test.ts | L1 |
| 合成执行行（buildExecutions + 假 moveId） | 朱鸢 | 影画6 以太余温：累计消耗 12 枚追加 4 枚×220% 鹿弹 | `buildZhuYuanExecutions (zhuYuan.ts)`（moveId `zhuyuan_c6_afterglow_bullets`） | zhuYuan.test.ts | L1 |
| 合成执行行（buildExecutions + 假 moveId） | 悠真 | 影画6 每 12 次甲乙矢生成 1500% 电磁爆炸 | `buildHarumasaExecutions (harumasa.ts)`（moveId `1201_c6_electromagnetic_explosion`） | harumasa.test.ts | L2 |
| 合成执行行（buildExecutions + 假 moveId） | 赛斯 | 影画6 雷霆击感电终结一击额外 500% 攻击力、必暴+暴伤 60% | `buildSethExecutions (seth.ts)`（moveId `1271_c6_finish_strike`） | seth.test.ts | L2 |
| 合成执行行（buildExecutions + 假 moveId） | 扳机 | 影画4 断离 200% 攻击/120% 冲击；影画6 凶弹 1200% 电伤 | `buildTriggerExecutions (trigger.ts)`（moveId `1361_c4_duanli`） | trigger.test.ts | L2 |
| 合成执行行（buildExecutions + 假 moveId） | 露西 | 影画6 加油下队友强特 → 小猪落地 300% 攻火伤 | `buildExecutions (lucy.ts)`（moveId `1151_c6_pig_bomb`） | lucy.test.ts | L1 |

### D9 stun_axis —— 失衡轴型
- **指纹**："失衡时…"、"失衡窗口内…"、"每失衡打X轮…"
- **落点**：失衡轴预设 JSON + 轴引擎；窗口内增伤按轴时间轴扫描或覆盖率滑块；「每失衡打几轮」是 L3 凹分口径
- **验收**：轴预设测试 + 窗口内/外差值断言
- **范例索引**（录新角色时对照；实现落点与测试均经 grep 验证存在）

| 模式子类 | 角色 | 触发句式 | 实现落点 | 验收 | 等级 |
|---|---|---|---|---|---|
| 窗口内增伤按剩余失衡秒数（滑块） | 雨果 | 决算按触发时剩余失衡秒数额外倍率（前5s 每秒+280%，5~15s 每秒+100%，上限 3400%） | `computeHugoVerdictMultiplier (hugo.ts)` | hugo.test.ts | L2 |
| 每失衡打 N 轮（凹分口径） | 青衣 | 每失衡打 2 轮醉花月云转（1 轮 = 100% 电压） | `computeQingyiSource (qingyi.ts)` `ROUNDS_PER_STUN=2` | 无 | L3 |
| 窗口终结动作截断 | 佩洛伊斯 | 决算（1551016）做完清空窗口剩余失衡时间 | `calcStunAxisStack (stunAxisStack.ts)` `endsStunWindow` | stunAxisStack.test.ts | L1 |
| 窗口分配（精确轮数 / 兜底吃剩余） | 通用轴引擎 | count 有值 = 精确轮数，缺省 = 兜底吃剩余窗口 | `allocateAxisWindows (stunAxisStack.ts)` | stunAxisStack.test.ts | L1 |
| 跨边界动作窗口覆盖折算 | 通用轴引擎 | 跨边界动作按窗口内时长比例折算轴内易伤 | `computeInAxisRatio (stunAxis.ts)` | stunAxis.test.ts | L1 |
| 失衡轴预设 JSON（自动加载 + 匹配） | 般岳/琉音 | 好评溢出爆发轴：默认常规轴，好评富余逐窗升级爆发轴 | `stunAxisPresets.ts`（import.meta.glob 加载 `stunAxisPresets/*.json`，如 般琉通用.json） | stunAxisPresets.test.ts | L0 |

## 3. 维度 × 确定性 实测分布

（实测：228 条模式条目 / 全部 60 角色）

| 维度 | L0 直读 | L1 直译 | L2 近似 | L3 凹分 | 合计 |
|---|---|---|---|---|---|
| panel_effect | 0 | 19 | 22 | 2 | 43 |
| resource_pool | 0 | 18 | 20 | 5 | 43 |
| team_link | 0 | 21 | 10 | 1 | 32 |
| damage_event | 2 | 15 | 14 | 1 | 32 |
| multiplier | 0 | 16 | 10 | 2 | 28 |
| count_cycle | 0 | 5 | 13 | 7 | 25 |
| stun_axis | 0 | 8 | 4 | 3 | 15 |
| time_window | 0 | 3 | 6 | 1 | 10 |
| 合计 | 2 | 105 | 99 | 22 | 228 |

**读表**：L1 直译(105)+L0 直读(2) 合计 47% —— 这些就是你说的「不凹分也能全自动正确录入」的部分；L2 近似(99, 43%) 是「AI 建模 + 用户调滑块」的协作区；L3 凹分(22, 10%) 是当前唯一必须人肉拍板的，也正是 §4 提炼路径的主攻对象。count_cycle 维度里 L3 占比最高(7/25)，说明「循环次数/资源分配」是凹分理解最密集的地方。

## 4. L3（凹分思想）的录入协议与提炼路径

### 4.1 录入协议（当前）
- 口径必须写进 spec `notes`：操作逻辑 + 近似点 + 默认值理由；用户确认的写 `[已确认]` 并同步 `verifications`（自动变 golden 测试）
- 不确定的写 `[猜测·高/中/低]`，格式 `实现:<字段/模块> | 依据:"<原文>" | 待核对:<点>`
- 每个 L3 至少一个可调滑块（把"凹分假设"暴露成旋钮），默认值 = 用户口径

### 4.2 提炼路径（目标态：L3 → L2/L1 的模式提取）
每次 L3 拍板 = 一条潜在模式。沉淀四要素：
1. **触发句式指纹**（这次用户说的原文）
2. **用户输入了什么**（一个轴？一个占比？一个循环次数？）
3. **我们把它变成了什么**（公式/滑块/轴预设——具体代码位置）
4. **可泛化到什么句式**

模式候选先在本文档 §5 登记；新角色文本命中同一指纹时，AI 先试 L2 自动建模、用户只复核默认值——
这就是"凹分思想提炼"的落地机制：**人肉的判断每发生一次，就把它变成下次机器能直接用的规则**。

## 5. 模式候选登记表

### 已提炼的模式候选（降级样例：L3 拍板过一次后，下次同句式可自动套用）

| 候选模式 | 触发句式 | 等级 | 来源 | 降级条件 |
|---|---|---|---|---|
| 失衡窗内固定循环 | 「每失衡打 N 轮X」 | L3→L2 | 青衣(1251)、莱卡恩(1141) | 同句式 → AI 出 N 轮模板，用户只调 N |
| 资源兑换双上限 | 「次数=min(⌊资源/单价⌋, 触发上限)」 | L3→L1 | 耀嘉音(1311) 付费震音 | 同句式 → 自动套 min 模板 |
| 后台时间分配模型 | 「后台时间怎么分给招式」 | L3→L1 | 莱卡恩(1141) 围猎平A | 同类角色（后台击破）→ 复用模板 |
| 必定暴击口径 | 「X必定暴击」 | L3→L1 | 凯撒(1071) 影画6 | 主目标口径默认建模，用户复核 |
| 条件状态覆盖率 | 「生命低于X%/处于Y状态时…」 | L3→L2 | 伊德海莉(1051) 低血增伤 | 覆盖率滑块，默认值用户给一次 |
| 状态余量折算 | 「超过阈值部分转化为增益」 | L3→L1 | 青衣(1251) 醉花超75% | 余量公式模板 |

### 待提炼的 L3 原始条目（从 50 角色实测抽出的全部 user_meta，逐条沉淀候选）

| 原始条目 | 触发句式 | 来源角色 |
|---|---|---|
| 低血增伤·HP平衡点 | 生命值低于50%…伤害最多提升100% | 1051 |
| 影画6·必定暴击单目标口径 | 盾击/支援之锋必定暴击、伤害+50%，主目标再+50% | 1071 |
| 围猎次数=失衡次数 | 次数 = 失衡次数…每一失衡都能打一次 | 1141 |
| 一轮失衡两个冰舞 | 开场冰舞…收尾冰舞…一轮失衡两个冰舞 | 1141 |
| 后台时间分配模型 | 围猎平A时间 = max(0, 后台时间−闪反时间) | 1141 |
| 昂扬满层冲击力公式 | 每层冰火伤+1.25%，超170每10点再+0.25% | 1161 |
| 失衡额外增伤覆盖率滑块 | 攻击处于失衡状态的敌人时，该增益额外提升40% | 1241 |
| 闪络电压分配循环 | 每失衡打2轮醉花月云转，1轮=100%电压 | 1251 |
| 醉花超75%电压增益 | 超75%部分25%→伤害+25%/失衡+12.5% | 1251 |
| 震音付费循环用户口径 | 付费震音=min(⌊能量/25⌋, 入场次数) | 1311 |
| 影画4 队内职业分支 | 强攻300%攻附加行；异常/击破+50%×覆盖 | 1311 |
| 明心境打满轴档位 | full/short 档少打灭极省时间 | 1431 |
| 梦境值500点计划 | 目标500梦境值覆盖20次追加攻击 | 1451 |
| 嗔火怒相循环 | 嗔火120点焚身进入怒相 | 1471 |
| 猫凝视触发未建模 | 强攻300%/异常480%属性伤害 | 1491 |
| HP池烧血约束链数 | 动力压制消耗16%生命上限生命值 | 1531 |
| 主循环动力压制→孤轮 | 动力压制自动衔接孤轮特技 | 1531 |
| 闪能池付费强特分配 | 摇曳和抓地都是60闪能强特 | 1531 |
| 大招三分支分配模型 | 上分支-[终结技：万军诛绝] | 1551 |
| 未建模破阵连放 | [破阵]下长按连续释放敛枪式一至三段 | 1591 |
| 强特链闪能账本 | 2连墨痕化形40闪能、3连60闪能、完美格挡免费 | 1371 |
| 墨影凝云合轴 | 1点玄墨值把合轴招式替换为玄墨极阵+青溟震击 | 1371 |

## 6. 决策流程图

```
技能文本
  ├─ 有没有"效果文本"？─ 否 → D1 catalog 直读（导入脚本）
  └─ 有 → 措辞指纹匹配（§2 九个维度）
        ├─ 落点 = 面板字段 → D2   ├─ 落点 = 乘区     → D3
        ├─ 落点 = 次数/层数 → D4   ├─ 落点 = 时间窗口 → D5
        ├─ 落点 = 资源池   → D6   ├─ 落点 = 队伍联动 → D7
        ├─ 落点 = 伤害行   → D8   └─ 落点 = 失衡轴   → D9
        ↓
      确定性判定：规则确定？→ L1 直译
        ↓ 否
      需要近似？→ L2：建模 + 滑块 + 生效测试
        ↓ 否（凹分口径）
      → L3：用户拍板 + [已确认]/verifications + 登记模式候选（§5）
```

## 7. 反模式（60 角色里实测踩过的翻译错误）

| 反模式 | 症状 | 正确姿势 |
|---|---|---|
| 招式限定 buff 挂全局 | 伤害虚高（作用到不该作用的招式） | D3 的 moveId 级 patchExecutions |
| 覆盖率滑块经 panel 走私 | 滑块静默失效（般岳怒相增益事故） | D2 的 `input.settings` 直读 |
| 附伤用真实 moveId | daze/anomaly 双计 | D8 的假 moveId |
| CD 次数忘记 × 覆盖率 | 回能/次数虚高 | D5 的 floor + 滑块 |
| 转模重复声明 | 基底双计（般岳 hp→贯穿力历史） | D2 先查基底公式再声明转模 |
| 队伍联动写进编排层 | useResourceCalc 73 个 agentId 分支 | D7 的 applyTeamConfig |
