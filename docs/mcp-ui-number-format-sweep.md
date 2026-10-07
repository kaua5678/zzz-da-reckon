# 界面长浮点普查 + ui-check「未格式化数值」闸门（r716–r718，arena-G）

> 起因：r710 记下失衡轴页「轴轮数 2.7757914099116654 轮」，此后一直挂在未决里。r716 判断它是**一类**缺陷：
> 计算结果不经 `fmt` 直接插值进页面。处理分三步：普查 → 源头一律经 `fmt` → ui-check DOM 体检加判据，防止再犯。
> 判据：不再逐处修，改为按类修并加闸门；以后新页面漏了 `fmt`，ui-check 会自动判失败。
> 基线 origin `36532c87`。提交：`37b74b0e`（源头格式化）· `e88b72f8`（月城柳 fields）· `296b5f70`（闸门）· 本文所在的文档提交。
> 过程：r716 10:37 开工，约 12:00 因 ngrok 离线中断；r717 12:03 续做，12:36 再次离线；r718 12:49 续完。三轮之间未提交。

## 1. 方法

工具都在仓外 `/home/kaua/calc-arch/g716/`，不入 git。

### 1.1 页头页签普查（sweep716.sh）

- 做法：用 `python3 -m http.server` 起静态服务提供构建产物，ui-check 经 CDP 逐队伍、逐页签操作，读 `document.body.innerText`，用 `/\d+\.\d{5,}|NaN|Infinity|undefined/` 扫描。
  - 套队调用 pinia `config.applyTeamPreset`，和预设按钮、r710 探针走同一路径。
- 覆盖范围（基线构建）：
  - 10 队 × 10 个按队页签；
  - 8 个不按队页签：公式/字段、音擎字段、逻辑编辑、倍率系数记录，以及 4 个对比页（未点计算）；
  - 85 支编号预设（teams-all.txt）× 资源池 / 失衡轴。
- 结果：
  - 85 × 2 共 170 页，92 页命中：资源池 77 页，失衡轴 15 页；
  - 10 × 10 + 8 页里命中 14 页，在资源池、失衡轴、队伍配置三个页签和倍率系数记录页；
  - 归纳为 66 个文本模式，约 20 处源头；
  - 积蓄池总值一项就出现在 63/85 支队；
  - 倍率系数记录页的 `5.55835` 是数据原始系数，属于合法显示。

### 1.2 页内子页签补扫（subtab716.sh + subscan.js，r718）

- 漏层：1.1 只扫了各页签的**默认视图**。全站页内子页签只有 4 组：
  - 页头：已扫；
  - FinalPanel：资源池页，按槽位分页；
  - ResultPage：资源池页，资源/动作池 · 异常池 · 伤害池；
  - LogicEditorPage：属性转模 · 对象库 · 倍率融合。
  - 合轴率调节弹窗里还有按角色分的页签，要点按钮才出现，改为静态读模板：只有招式名没经 `fmt`，它本来就是文本。
- 做法：在页面里按 DOM 顺序找下一个没点过的子页签，点开、等 700ms、扫描，点开后新出现的嵌套页签也会被点到。资源池页每队扫一遍，逻辑编辑页与队伍无关，只扫一次。
- 结果：在已打补丁 A 的构建上，又查出 4 处源头（§2 表中标 r718 的行）和 1 个渲染崩溃（§4）。
  - 修完后：85 支编号预设 × 7 个视图 + 逻辑编辑页 5 个视图 = **600 个视图 0 命中**，5 段 ui-check 全程零 JS 错误；
  - 耗时：每队约 12s，17 队一段约 175s。

### 1.3 命名预设与引擎侧（fx718.perf.ts 探针）

- UI 普查只套 85 支编号预设，它们只换成员。命名预设另有配置，全部预设共 104 个。
- 「异常事件明细」的四路来源用 node 侧探针逐预设检查，四路是：异常池 `anomalyEvents`、`moduleAnomalyEventRecords`、`anomalyDamageEvents`、`resourceResult.characters[].anomalyEventExecutions`。查出：
  - `fields` 不是数组的 4 处：全部是月城柳极性紊乱，见 §4；
  - 次数带长小数的 3 处：`yidhari-roxy-lucia` 紊乱 0.6666666666666667、乱流 3.333333333333333，`claret-roxy-rina` 乱流 3.3333333333333335。
  - 说明：r716 记的「异常、紊乱、乱流次数都是整数」只对按槽分配的次数成立，池级事件的次数不是整数。

## 2. 源头与修法

| 位置 | 原先显示（例） | 修法 |
|---|---|---|
| ResourceResultCard.vue | 强特 17.327374229734996 次 · 耗能 50/次 × 17.327… = 866.36… 点；终结技次数与消耗乘积；失衡贡献 `N次 ×`；积蓄池总值 11240.503981928483；执行值 / 渲染次数（风华 base + extra） | 次数 `fmt(x, 1)`；单价与乘积 `fmt(x)`；积蓄、执行值 `fmt(x, 1)` |
| StunAxisPage.vue | 动作池 `终幕·惘 ×3.2242085900883346`（含 title）；窗口时长；`共 N 次`；`×count`；轴轮数 2.7757914099116654 轮；轴内闪能 / 喧响消耗 `640 / 2366.8990000000003`；栈超支警告 | 次数和合计 `fmt(x, 1)`；「实际 ×? 次」缺结果时由 `?` 改为全站缺省符 `-` |
| TeamConfigPage.vue | 音擎覆盖率 23.703703703703706% | `fmt(x, 1)` |
| specs/mechanics.ts | 通用资源行「初始 · 获取 · 消耗 · 剩余」、获取值和消耗次数 | 数值 `fmt(x)`，消耗次数 `fmt(x, 1)` |
| core/stunAxis.ts | 超额警告 `超额 N（需X，剩Y）` | `fmt(x, 1)` |
| yidhari.ts | note / 资源段「极寒重碾 失衡内8.852496701732367 + 非失衡6.147…」 | `fmt(x, 1)` |
| burnice.ts | 单喷 / 双喷次数 | `fmt(x, 1)` |
| promia.ts | 掌控248.64000000000001 | `fmt(x, 1)` |
| ResultPage.vue（r718） | 异常池「特殊动作喧响」`连携 (2.7757914099116654次)` 等四项；伤害池「强特/终结」列 `16.38878374419999 / 5`；异常事件明细「次数」列 | `fmt(x, 1)` |
| LogicEditorPage.vue（r718） | 倍率融合预览 `466 × 1.268884120171674 = 591.3000000000001` | 底数和乘积 `fmt(x)`，系数 `fmt(x, 4)`。数据不改：1171 搅拌式规则 `enabled`，改数据会影响计算 |

格式口径：

- 次数用 `fmt(x, 1)`，与卡内 countText 同口径；
- 能量、喧响的单价和乘积用 `fmt(x)`，失衡轴页的合计用 `fmt(x, 1)`；
- 通用资源卡的数值用 `fmt(x)`。

**恒为整数的量不加格式化**，避免写防御性代码：

- `stunCount` 是 floor 的结果，见 pools.ts:48 注释；
- `perSlotTriggerCounts` 由 `distributeIntegerByWeight` 分配。

新旧整页逐词比对（6 队 × 队伍配置 / 资源池 / 失衡轴，共 18 页，textdiff.py）：

- 142 个差异片段的骨架（把数字换成 #）全部相同，即文字改动为 0；
- 片段里共 160 对数字：105 对是旧值按 0/1/2 位舍入，55 对数值相等（只加了千分位，或是同一片段里没变的数）。

## 3. 闸门：ui-check DOM 体检判「未格式化数值」（`296b5f70`）

- 函数 `scripts/lib/ui-check-runtime.mjs#rawNumberLeaks(text, limit=20)`：
  - 正则 `/\d\.\d{7,}|\bNaN\b|\bInfinity\b/`；
  - 每处命中带 24 字前文，空白压成单个空格，免得 innerText 的换行把失败清单拆碎；
  - 手写的 `.d.mts` 已同步声明。
- 接线：`scripts/ui-check.mjs` 在 DOM 体检之后调用它，命中就加一条 failures「页面显示未格式化的数值 N 处（浮点噪声 / NaN / Infinity：展示处漏了 fmt）」，后面列出各处片段。PASS 文案加上「无未格式化数值」。
- **阈值 ≥7 位小数**，依据如下：
  - src/data 数字字面量实测：恰好 5 位的 3 个（全是 5.55835），6 位的 0 个，≥7 位的 0 个；
  - src 非测试代码里 ≥7 位的字面量，除注释外只有 `src/specs/agents/1171.json:108` 的行融合系数 1.268884120171674，它只在倍率融合预览里显示，现已用 `fmt(x, 4)`；
  - 浮点噪声通常 ≥10 位；
  - 普查用 ≥5 位，范围更宽，命中靠人工归类；闸门用 ≥7 位，不会误报数据系数。
- 防线测试：
  - 新闸门跑旧构建（`36532c87`）的失衡轴页：FAIL 10 处；跑新构建：PASS；
  - 修复前的逻辑编辑页倍率融合子页签：被判 FAIL 2 处。这个视图普查漏掉了，闸门照样拦下；
  - 难度曲线标准流程（AGENTS.md 的命令）：PASS，7s；散点：PASS。
- 单测：uiCheck.test 加 2 例，一例测判定边界，一例测 ui-check 确实消费了它。

## 4. 月城柳极性紊乱执行行缺 fields（`e88b72f8`）

- 现象：资源池页 → 异常池，「异常事件明细」表的 `event.fields.join` 抛 `TypeError: Cannot read properties of undefined (reading 'join')`，表格渲染中断。
  - 涉及 4 支含 1221 的编号预设：auto-1091-1221-1581、auto-1221-1511-1211、auto-1221-1511-1411、auto-1221-1561-1411；
  - 是 1.2 补扫时 ui-check 报出的 JS 错误。
- 根因：`buildYanagiAnomalyEvents` 用 `as AnomalyEventExecution` 断言，绕过了必填的 `fields`。这是全 src 唯一一处这种断言。
- 修法：
  - 去掉断言。`AgentEventInput.events` 本身就是 `AnomalyEventExecution[]`，push 进去的对象字面量会按完整类型检查；
  - 补上 `fields: ['exSpecialCount', 'yanagi.extraThrustCount', 'yanagiCinemaLevel']`；
  - 删掉不再使用的类型导入。
- 不改的地方：规格类型 `specs/types.ts:116` 的 `fields` 是可选的，执行类型里是必填的。从规格转换过来的两处（`specs/mechanics.ts:66`、`ResourceResultCard.vue:644`）各自写了 `?? []`。契约边界清楚，保持现状。

## 5. zd 零差归因（AGENTS.md 规则 10）

- `zd.sh r718-fmt`：DUMP 26 处，ROWS 27 处。全部只变 `resourceResult` 哈希那一段，伤害总值、失衡池、伤害池行逐位不变。
- 探针 dx718.perf.ts 照 rowsnap 的场景顺序复刻（default / c0 / c6 / w / heavy / axis），在基线临时 worktree 和改后各跑一次，用 ddiff.mjs 逐叶比对。27 个差异叶子分两种：
  - 6 个 `.rr.characters[0].yidhariHpSource.note`：来自 yidhari.ts:201 的 note「极寒重碾 失衡内X + 非失衡Y」改用 `fmt(x, 1)`。场景是 5 支 yidhari-*-lucia 加 auto-1051-1141-1451，均为 c6（0 号位 1051 伊德海莉），例如 8.852496701732367 → 8.9。属于 `37b74b0e`。
  - 21 个 `.rr.characters[].anomalyEventExecutions[].fields`：4 支月城柳预设 × 5 个场景，加 auto-1091-1221-1581/axis，值从 undefined 变成 3 个字段名。属于 `e88b72f8`。
- 没有任何数值叶子变化，不涉及金样，不需要 `TIME_GOLDEN_UPDATE`。
- 其余改动（模板、`build*ResourceSections`、mechanics.ts 展示文案、stunAxis 警告）不进 `resourceResult`，zd 测不到，由 §1 的普查和 §3 的闸门覆盖。

## 6. 更正与教训

- **「难度曲线 260s 出不了图」是误判**，r716/r717 的现场记录里写过这条。
  - 原因：2D 难度曲线画的是 `class="curve-seg"` 线段，不是 polyline，当时等的是 `polyline`。
  - 按 AGENTS.md 标准命令 `--wait-for .curve-seg` 实测：7s PASS。
  - 教训：等待用的选择器照 AGENTS.md 抄，不凭记忆。
- 普查只扫默认视图，会漏掉页内子页签（§1.2）。UI 普查不套命名预设，用 node 侧探针补（§1.3）。
- 给 `scripts/lib/*.mjs` 加导出时，手写的 `.d.mts` 要同步，否则 vue-tsc 报 TS2305，check-guards 报死通道 C 类。正确做法是补声明，不是加豁免。

## 7. 候选（未做）与回退

- 候选：让 ui-check 内置「逐个点开子页签再体检」，把仓外的 subscan.js 收进 ui-check-runtime。
  - 现状：闸门只体检终态页面，子页签里漏了 `fmt`，要等流程正好走到那里才会判失败。
  - 什么时候做：再出现「子页签里漏 fmt、却先被用户看到」时就做。
- 回退：`git revert 37b74b0e`（格式化）、`e88b72f8`（月城柳）、`296b5f70`（闸门）三者互相独立。
  - 注意：只回退格式化而保留闸门的话，经过资源池或失衡轴的 ui-check 流程会被闸门判失败，这正是闸门的作用。
