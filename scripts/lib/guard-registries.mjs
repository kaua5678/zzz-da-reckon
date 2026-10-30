/**
 * check-guards 登记数据表（CC-85 2026-09-27，census §5.91 自 scripts/check-guards.mjs 逐字拆出）。
 * - RATCHET_BURNDOWN：棘轮 burn-down 登记表（改棘轮基线常量时 frozen 必须同步改）
 * - DEBT_REGISTRY：技术债登记簿（源码 debt 标记 ⇔ 本表条目，双向校验）
 * - CALIBER_TRIGGER_ALLOWLIST：游戏语义口径缺 ⟳复核 触发器的存量豁免
 * 判据逻辑仍在 scripts/check-guards.mjs，它 import 本文件并原样转出（测试 / zc.mjs 照旧从 check-guards 取）。
 * 本文件在 DEBT_SCAN_SELF_REFERENTIAL 里（债务登记文本本身不算源码 debt 标记）。
 */

/**
 * 棘轮 burn-down 登记表。每条：
 * - file：基线所在（度量实现由 zc/check-guards 注入，不在此重复）
 * - frozen：冻结时的值（= 代码里的 BASELINE 常量）
 * - target：承诺下调到的值（可为 0 = 全清）
 * - due：承诺到期日（ISO）
 * - current：**现在**的状态 + 下一步（≤200 字符；只写「当前值 / 下一步 / 阻塞点」）
 * - history：一句话 + git log 指针（≤120 字符；沿革正文在 git log，不在此展开）
 *
 * ⚠ 为什么拆 current/history（2026-10-23，用户问「总是读到错误内容」）：原单字段 plan 里塞着整条
 * 沿革链（最长一条 3286 字符，「34 → 32 → … → 18 → 17」），读的人（含 agent）看到的是「历史上某刻
 * 是对的」，读不出「现在是多少、接着做什么」——历史沿革冒充当前状态。判据 33 强制两个长度上限。
 */
export const RATCHET_BURNDOWN = [
  {
    id: 'agentId 分支',
    file: 'src/composables/useResourceCalc.ts + src/composables/resourceCalc/**',  // 度量面 = listAgentBranchFiles（单文件会被「搬家」骗过）
    frozen: 0,  // 与 AGENT_BRANCH_BASELINE 同步；改基线必须两处一起改（R44）
    target: 0,
    due: '2026-12-31',
    current: '已清零：新增即红（判据 2）。下一批候选 = helpers.ts 批次 2（A1 :610 耀嘉音源面板判死，单独立项勿混批）。',
    history: '逐批迁移史见 git log --grep="agentId 分支" 与 docs/AGENT_ID_BURNDOWN_LOG.md',
  },
  {
    id: 'core agentId 分支',
    file: 'src/core/resource.ts + core/resource/helpers.ts',
    frozen: 0,  // 与 CORE_AGENT_BRANCH_BASELINE 同步
    target: 0,
    due: '2027-03-31',
    current: '已清零（判据 3 硬门，新增即红）。跨角色 findIndex 类若需迁移须走 applyTeamConfig，别硬删。',
    history: '沿革见 git log --grep="core agentId" 与 docs/AGENT_ID_BURNDOWN_LOG.md',
  },
  {
    id: 'core 角色模块引用',
    file: 'src/core/** → @/mechanics/agents/*',
    frozen: 0,  // 与 CORE_ROLE_IMPORT_BASELINE 同步
    target: 0,
    due: '2027-03-31',
    current: '已清零（判据 6 硬门）。引擎期求值能力属契约改动、非机械迁移，要动先立项。',
    history: '迁移前提的实测否证见 git log --grep="core 角色模块引用"',
  },
  {
    id: '展示层越层 import',
    file: 'src/views + src/components',
    frozen: 0,  // 与 EXHIBITION_LAYER_IMPORT_BASELINE 同步
    target: 0,
    due: '2026-12-31',
    current: '已清零（2026-10-18 MechanicsTablePage 下线，是真删除不是搬家）。新增越层 import 即红。',
    history: 'CC-47~CC-54 逐条清单见 git log --grep="越层"',
  },
  {
    id: '手册 §4 超标条目',
    file: 'docs/ENGINE_PIPELINE_GUIDE.md §4（度量 = 单条 > GUIDE_ENTRY_MAX_LINES(40) 的条数）',
    frozen: 7,  // == GUIDE_ENTRY_OVERBUDGET_ALLOWLIST.length（checkGuards.test.ts 双向锁）
    target: 0,
    due: '2026-12-31',
    current: '现 7 条超标（最长 #33 = 86 行）：拆薄或外链一条销一条。新增条目超标即红（判据 34）。',
    history: '2026-10-30 换尺：总量 1099→1205 是证据句/否决记录不是编年史，见 git log --grep="§4 条目预算"',
  },
  {
    id: '游戏语义口径复核触发器',
    file: 'src/**、scripts/**、docs/**（手写 @fact 声明行，种类=口径/映射，排除工程元口径；docs 自 2026-09-15 起入语料）',
    frozen: 82,  // 判据 15 上线时的存量（此后靠 ALLOWLIST 长度递减）
    target: 0,
    due: '2026-12-31',
    current: '剩 75 条待补 ⟳复核。补一条从 CALIBER_TRIGGER_ALLOWLIST 删一条，漏删即红（棘轮只减不增）。',
    history: '存量口径见 git log --grep="复核触发器"',
  },
  {
    id: '死通道豁免清单',
    file: 'scripts/lib/dead-channel-scan.mjs DEAD_CHANNEL_ALLOWLIST',
    frozen: 1,
    target: 0,
    due: '2026-12-31',
    current: '剩 1 条（pullPlannerEngine.freePoolPerSpecialty，CC-94 裁决保留的调参旋钮）。接上或删字段后销号。',
    history: '历次销号（含假阳性修检测器）见 git log --grep="死通道"',
  },
  {
    id: '名词表未处理',
    file: 'scripts/lib/noun-triage.json（源 = data/raw/nanoka_missing/noun_3.3.12.json）',
    frozen: 59,
    target: 0,
    due: '2026-12-31',
    current: '剩 59 条 deferred（unhandled 必须恒 0）。处置一条降一条：能建模的转 modeled，确认范围外的改判移除。',
    history: '三态口径见 git log --grep="名词表"',
  },
  {
    id: '滑块生效测试存量',
    file: 'scripts/lib/settings-coverage.mjs SETTINGS_UNTESTED_BACKLOG（扫描面 = 运行时 getRegisteredMechanicSettings）',
    frozen: 0,  // 与 SETTINGS_UNTESTED_BACKLOG.length 同步
    target: 0,
    due: '2027-03-31',
    current: '已清零（清单空）。新滑块仍按 newGaps 判红；余 7 条「注册了不生效」需用户裁决，不计入可补面。',
    history: 'R48~R50 分型与三条挑活坑见 git log --grep="滑块生效测试存量"',
  },
  {
    id: 'core 角色前缀字段',
    file: 'src/core/** + src/composables/resourceCalc/** + useResourceCalc.ts（口径见 scripts/lib/core-role-field-ratchet.mjs）',
    frozen: 0,  // 与 CORE_ROLE_FIELD_BASELINE 同步
    target: 0,
    due: '2026-12-31',
    current: '已清零（判据 22 硬门）。新增 <角色>Xxx 标识符即红——角色知识回模块，引擎不读角色字段。',
    history: 'CC-14~CC-40 逐批改名见 git log --grep="角色前缀字段"',
  },
  {
    id: 'core 角色名中缀/子目录',
    file: 'src/core/** + src/composables/resourceCalc/** + useResourceCalc.ts（口径见 scripts/lib/core-role-field-ratchet.mjs 判据 23 段）',
    frozen: 0,  // 与 CORE_ROLE_INFIX_BASELINE 同步
    target: 0,
    due: '2026-12-31',
    current: '已清零（判据 23 硬门）。新增角色名中缀 / core 子目录即红。',
    history: 'CC-43b~CC-43f 立尺与清偿见 git log --grep="角色中缀"',
  },
]

/**
 * 代码里的 debt: 标记注册表（AGENTS 规则 12）。新增标记必须在此登记（登记时写「到期动作」）；
 * 标记从代码里删除（债还清）必须同步销号，否则下面对不上即红。
 * 格式：'<file>:<标记关键词>' -> { since: '引入日期', due: '到期动作' }
 */
export const DEBT_REGISTRY = {
  // 2026-09-04：全局实数化收敛重构（正反馈模块统一连续通道 + 逐模块重校准）。伊德海莉
  // refund 双稳态已 targeted 修复（calcEnergySource 解析不动点 + iterate 阻尼实数 + 终局整数
  // 重推），全局松弛会重排所有带时间/资源循环模块的均衡。
  //   ⚠ 2026-10-10 用户裁决（**元规则**，全文见 OPEN-ITEMS「判据不能阻挡开发」）：
  //     ① 原文此处曾以「sigrid 出枪式消失前例」当**否决理由** ⇒ **已删**。用户原话：
  //        「锚点偏移是开发流程的问题，不是他不符合游戏逻辑……怎么能抱着错误的数据定死金标准呢」。
  //        「出枪式消失」若为真，是**计算逻辑的问题**（= 债 1a 要修的东西），不是「别修」的理由。
  //     ② `timeGolden`/`timeFillRatchet` 是在**未实数化的错误逻辑**下生成的快照 ⇒
  //        「N 队变了」是读数不是罪证。按规则 10 四步处置（量 delta → 逐队归因 → 确认有意 → 重生成）；
  //        逐队归因是**义务**，delta 本身**不是**否决权。
  //     ③ 立项边界**由 agent 自定**（用户：「边界和判据全都可以改」），不要再问「哪些模块能动」。
  // ⚠ 本项覆盖 helpers.ts 的 1a 标记（**当前行号见该文件 `debt:` 处**，此处不写死行号以免再漂）。
  // 2026-09-26 CC-13：批 1-1 通用连续通道已落地，债本体仍在。
  'src/core/resource/helpers.ts:全局实数化收敛重构': { since: '2026-09-04', due: '专项立项：正反馈模块统一连续通道 + 逐模块重校准。**2026-10-10 用户已授权开工，边界自定**；判据 = 逐条可归因 delta（每条绑定「队+量+机理+改动前预测值 vs 实测值」）+ 结构性不变量（落点唯一 / 锁定队逐位相同）全绿 + 逐批 delta 表由用户签字。⚠ 不得以「基线会变」为由拒绝口径修正（规则 10 / 17③）' },
  // ✅ 2026-10-26 已清偿：残锋「全队[锋御] 锐暴 +25%」迁到 spec `1611.teamBuffs`
  // （`claret.additional_ability_residual_edge`，source=「额外能力」⇒ additionalGateBuffTable 自动门控
  // OR 语义）；claret.ts#applyClaretPanel 的自身面板写已删（防双计）。
  // 判据：claretSmoke.test.ts「残锋归属：全队而非自身」（对照组只差残锋这一条）。
  // 2026-10-25：挽昼 v1 占位包第一刀只接了面板层（初始暴伤→暴击、极昼）。极昼原文是 15s 状态
  // （后场不减、强化特殊技/聚锋刷新），当前按满覆盖近似写进 applyPanel——引擎没有逐事件时间通道
  // 表达「刷新窗口」，改成覆盖率滑块也只能得到近似。清偿 = 引擎有逐事件窗口后落真状态机。
  // 2026-10-25：残痕/毁伤抽成锋御通用池（`src/mechanics/gashMaim.ts`）后，**多锋御同队**的整队分配
  // 仍未接线：双锋御队目前不存在（唯一组合 1601+1611 未进任何预设队、也不在难度曲线/归档扫描面里），
  // 而真正的共用池需要「同一时刻哪一槽在消耗」的跨槽顺序。清偿 = 引擎提供跨槽合并时间轴后，
  // 在 applyTeamConfig(postRound) 里收各槽贡献 → 一次 allocateBossGashPool → 写回各槽 cfg。
  'src/mechanics/gashMaim.ts:分配未接线': { since: '2026-10-25', due: '出现第二支双锋御队（预设队/归档/难度曲线任一）时接线：TeamMechanic postRound 收贡献 → allocateBossGashPool → 写回 cfg；轴内改成跨槽合并序列' },
  'src/mechanics/agents/sunbringer.ts:状态机未建模': { since: '2026-10-25', due: '引擎具备逐事件时间通道后落极昼真窗口（当前满覆盖近似；正式包数值若有变化一并重录）' },
  // 2026-09-07：喧响/能量收入聚合近似 vs 倍率行矩阵（用户裁决：矩阵求和口径，竖向列全行级）。
  // 仪玄实测行级 5628 vs 聚合 1702；约 50 个模块有 decibelRecovery:0 硬编码。
  // 喧响侧已清偿销号（2026-09-08：账本改 Σ buildExecutions 行级收入，口径条目见 helpers.ts
  // rowDecibelTotal 上方「喧响收入行级Σ」，生效测试 decibelRowParity.test.ts）。
  // 能量侧已清偿销号（2026-09-09：第一段债务清账 07481b8 + 第二段 Σ 切换，口径条目见 helpers.ts
  // rowEnergyTotal 上方「能量收入行级Σ」，生效测试 energyRowParity.test.ts）。
  // 2026-09-07：横向动作覆盖缺斤少两（用户实测口径）——物化执行行少于实战动作序列，竖向字段
  // 已行级而横向无逐角色锚点。修复 = 实数化专项逐角色收口（弹刀反推/合轴自动填充同族手法）。
  'src/composables/resourceCalc/convergence.ts:轮换动作覆盖实数化': { since: '2026-09-07', due: '实数化专项逐角色收口（1481/1371 前例），以归档对拍定每角色动作锚点' },
  // 2026-09-10（账本 Open #6：spec JSON 的 debt: 标记纳入扫描）：柚叶转积蓄的贡献行挂柚叶槽位，
  // 若其积蓄在目标异常池占比最大会被误判为施加者——实际异常角色积蓄远大于支援柚叶，属已接受近似。
  'src/specs/agents/1411.json:贡献挂柚叶槽位': { since: '2026-09-10', due: '施加者判定按「除柚叶外最大贡献者」收口时销号；无专项计划则维持近似（已在 note 明示可接受）' },
  // 2026-09-11（用户三问：溢出是真的吗 / 合轴率能否周转 / 截断后资源该不该降）：实测确认
  // 资源池的能量/喧响/次数取**未截断**的收敛账本，装配期截断只削行 ⇒ 有截断时两者不自洽
  // （般+诺+卢全关档：槽0 回能账本 200 vs 截断后 Σ行 140，截断 66.8s / 21 条行）。止血已落
  // （截断可见 + 难度轴交互按存活率缩）；正解 = A 项：截断后行重收敛（先按预算重分配平A池、
  // 交互只取达成目标的最少要求，装不下就重收敛到截断为 0）。
  //   ★ 2026-10-09 **第一次销号**（用户裁决）：销号口径**改写**为「结构性溢出队 Σcut 只减不增且如实上报」。
  //     理由：原条件「直到截断为 0」被本仓自己的测试判为**口径上不可达**——
  //     `src/core/__tests__/truncationRefold.test.ts:90` 原文「结构性溢出（必要行 > 预算），
  //     重折不可能清零；清零 = 口径变了，去看 golden」。
  //     代码侧 `debt:` 标记已随之删除（`src/core/resource.ts` 该处改为销号说明）。
  //   ★★ **2026-10-13 用户重新裁决 ⇒ 上面那次销号作废**，本债**重启**：
  //     用户原话「超时砍掉任何招式都该让其计数和各项数据扣除，因为你**根本就打不出这招**。
  //     由于**计算顺序有问题**，所以你搞出回复次数了又截断次数的矛盾行为，**一开始就不该回复啊**」。
  //     ⇒ 判据回到「被砍的招式不得被计数」（不是「Σcut 只减不增」——那只保证如实上报，不保证不计数）。
  //   ★★ **2026-10-14 T151 达成并销号**：展示口径改用 `executedExSpecialCount /
  //     executedUltimateCount / executedChainCountTotal`（= `min(资源允许值, Σ物化行)`，
  //     `src/core/resource/assembleSlot.ts`）⇒ 全库 47 个截断槽「展示值 ≤ 物化行」违规 **0**
  //     （对照臂：仍展示旧资源允许值时 8 队 / 27 槽超报，证明判据非恒真）。
  //     ⚠ 关键设计（勿回退）：**不覆盖** `exSpecialCount / ultimateCount / chainCountTotal` ——
  //     那三个字段同时是**外层失衡不动点的反馈量**（`outerCycle.ts#outerFeedbackSignature`、
  //     `convergence.ts:1122-1132`），覆盖它们会把收敛轨迹改坏（实测 6~14 条结构性断言红）。
  //     生效测试 = `src/core/__tests__/truncationCountDeduction.test.ts`（含反空洞对照臂）。
  // 2026-09-12（账本交接欠账）：克拉蕾残痕「同时最多 3 层」是**时序**约束，整局总量口径只能表达成
  // 「不钳制 + 消耗需求封顶」⇒ 极端配装（积累速率 ≫ 消耗节奏）下偏乐观。上条会话因 check-guards.mjs
  // 被并行会话占用、按规则 13 先记账本不登记，本条补登（代码标记在 claret.ts gashStacks 计算处）。
  //   ★ 2026-09-20 round 54（管理员 AG）：**仍保留**，但内容按实测**改写**（不是原样留也不是销号）——
  //     ① 【定理】`consumed = min(L, Ds)` 是**所有自洽读法的共同上界且紧**：`L∈0..12 × Ds∈0..12 ×
  //        全部交错` = **10 400 599 个交错零越界**；细粒度交错（积累与消耗交替）**可达**该界，而平A 项
  //        按定义就是「秒均 × 时间」（连续）⇒ 细粒度交错正是本式自身隐含的读法 ⇒ **单向高估、不可能低估**。
  //     ② 【天花板·纠正原表述】病态「先攒满再消耗」读法取 `min(L,Ds,cap)` ⇒ 幅度 `max(0, min(L,Ds)−cap)`，
  //        咬合**充要条件 = `L>3 且 Ds>3`**（任一 ≤3 则本式精确）。实测默认夹具 `L`=24~26/`Ds`=4 ⇒ **≤1 层**；
  //        滑块推满 `Ds`=80 ⇒ ≤53 层。⚠ 原记的「积累远快于消耗节奏 ⇒ 偏乐观」**把两个因子说成一个**：
  //        误差**不随积累速率 L 单调放大**，而是被 `Ds` 与 `cap` 夹住（L 再大，幅度也 ≤ `Ds−cap`）。
  //     ③ 【为什么不落真队列】本条**不需要绝对时刻**（原文无任何时长/衰减子句，层只被毁伤消耗 ⇒ 纯计数约束），
  //        故 R52 对风眼成立的那条否决理由（「引擎无逐发绝对时刻 ⇒ 必须编造发次间隔」）**对本条不成立**。
  //        但引擎同样没有**逐事件顺序**通道，且已证本式是**紧**上界（不可再改进）⇒ 保留 + 挂 `⟳复核`。
  //     ④ 外部复核（R54 侦察）：nanoka zh/en/ja/ko × 3.2/3.3.0/3.3.2/3.3.3 **逐字符串零差异**；
  //        官方名词表 `3000038` 只写「最多叠加3层」；同段落对猩红铭刻 16s / 残锋 40s / 锐能 180s / 喧响 18s
  //        **都明写秒数** ⇒ 残痕的省略是**刻意的**，不是漏抄。证据 `/home/kaua/r54-scratch/evidence/`。
  'src/mechanics/agents/claret.ts:残痕总量口径天花板': { since: '2026-09-12', due: '已证 `min(L,Ds)` 为紧上界（10400599 交错零越界 + 可达）⇒ 无「更准的近似」可落；仅当引擎获得**逐事件顺序**通道（或官方补充 [残痕] 时长/衰减子句，可裁决病态读法归属）时复核并销号' },
  // ✅ 2026-09-20 round 52：洛可茜风眼「同时存量≤9 / 30s 自然引爆 / 超限最早引爆」时序 debt
  // **已结清（销号）**。R51 登记时按「需要逐事件时序队列」挂账；R52 把该队列**真建出来**跑闸门
  // （全库 5702 次引擎求值 = 105 预设 + 60 角色 × 命座 0/3/4/5/6）⇒ **零 delta**，且理由是**结构性**的：
  // 单发风眼上界 ≤ `WIND_ENERGY_MAX`=3 < 9（9 上限不可达），每发恕不远送恰引爆 3 个 ⇒ 队列每发清空
  // （长度恒 ≤ 3，30s 自爆不可达）；默认 `spinSeconds=2.5` ⇒ 风眼数恒为 3 的倍数 ⇒ 现行式**就是**原文
  // 语义的精确解，不是近似。⚠ **不是「影响小所以不建」而是「证明到不了」**——两者是不同的结论。
  // 天花板（滑块域 `eyeRate>1.34` 单发可 >3 ⇒ 9 上限真咬合、本式高估；`spinSeconds<2.25` ⇒ 局末余留眼
  // 被计成小旋风）与「为什么不落真队列（引擎无逐发绝对时刻，落真队列必须编造发次间隔）」已按规则 12
  // 改写为模块内 `@fact … 近似:` + `⟳复核 到期 2027-03-31`，不再占 debt 位。
  // 证据（三版预言机 + 全库 delta + 穷举等价域）见 `/home/kaua/r52-scratch/evidence/`。
}

/**
 * 存量口径豁免清单（棘轮基线）：key = `<file>:<line> <subject>`。
 * ⚠ 这张表只许**缩短**：给某条口径补上 `⟳复核` 行之后，从本表删掉该行（漏删即红 = stale）。
 * 为什么允许存量豁免：85 条一次性补完不现实，全红会逼人**删判据**（判据死掉比缺口更糟）。
 */
export const CALIBER_TRIGGER_ALLOWLIST = [
  "src/composables/difficultyCurve.ts engine:难度曲线/x轴",
  "src/composables/difficultyCurve.ts engine:难度曲线/伤害归因",
  "src/composables/difficultyCurve.ts engine:难度曲线/交互项截断缩",
  "src/composables/difficultyCurve.ts engine:难度曲线/关键次数标注",
  "src/composables/difficultyCurve.ts engine:难度曲线/全关基线",
  "src/composables/liveInteractions.ts engine:操作难度/角力权重",
  // ⚠ 2026-09-17 round 21 夜D：`engine:轴内块数落地` 的**键随实现改路径**——
  // 该口径的实现在夜D 从 `convergence.ts` 整块迁进 `hugo.ts#applyHugoTeamConfig`（规则 6），
  // 故豁免键从 `src/composables/resourceCalc/convergence.ts` 改指 `src/mechanics/agents/hugo.ts`。
  // **这是路径跟随、不是销号**：口径内容一字未改、触发器仍未补 ⇒ 存量面（game 条数）不变。
  // ✅ 2026-09-18 round 21 夜 派活方**已把那条绝对地板换掉**（`checkGuards.test.ts`）：
  // 原 `expect(r.game.length).toBeGreaterThanOrEqual(80)` 是一条「不许还债」的地板——
  // 完整还债（补 `⟳复核` + 销号本清单条目）会让 `game` 80 → 79 而精确红
  // （实测 `expected 79 to be greater than or equal to 80`，其余判据全绿）。
  // 已改为钉真正的不变量（`ALLOWLIST.length === game.length` + 两侧非空）；
  // 实测「新增裸奔口径仍被拦」（`missing` 非空 ⇒ 红）⇒ 护栏未变松。
  // ⇒ **现在补这条 `⟳复核` 是安全的**（销号后 `game` 79 不再触发任何断言）。
  "src/composables/resourceCalc/damagePool.ts engine:damage/减防通道",
  "src/composables/resourceCalc/damagePool.ts engine:damage/非轴失衡易伤",
  "src/composables/resourceCalc/feasibilitySearch.ts engine:降配搜索/非下闭可行集",
  // ⚠ 2026-09-18 round 22 / T67-a1 刀 A：`disc:覆盖率并入范围` 的**键随实现改路径**——
  // 该口径的实现（`mergeTeamDiscEffectCoverages` 及其头注释 @fact）随 B 簇整段迁进
  // `resourceCalc/panelPhases.ts`，故豁免键从 `helpers.ts` 改指 `panelPhases.ts`。
  // **这是路径跟随、不是销号**：口径内容一字未改、触发器仍未补 ⇒ 存量面（game 条数）不变。
  "src/composables/resourceCalc/panelPhases.ts disc:覆盖率并入范围",
  "src/composables/resourceCalc/ultimatePromote.ts engine:实战档位喧响计数",
  "src/composables/resourceCalc/ultimatePromote.ts engine:失衡次数不动点",
  "src/composables/stunVulnSummary.ts engine:失衡易伤可见化/加权信用",
  "src/composables/teamCompare.ts engine:操作难度/权重可调",
  "src/composables/timeWeightAllocation.ts engine:分配策略/主C判定",
  "src/core/damage.ts engine:damage/乘区顺序",
  "src/core/effectiveTime.ts engine:stun/时间守恒",
  "src/core/panel.ts engine:driveDisc/固定主词条",
  // ⚠ R43 结构熵切面：`engine:时间线截断` 的实现与 @fact 随截断族整段迁进
  // `core/resource/timeTruncation.ts`，故豁免键**随之改指**。**这是路径跟随、不是销号**：
  // 口径内容一字未改、触发器仍未补 ⇒ 存量面（game 条数）不变。
  "src/core/resource/timeTruncation.ts engine:时间线截断",
  "src/core/resource/helpers.ts yidhari:refund不动点",
  "src/core/resource/helpers.ts engine:合轴预算抵扣",
  "src/core/resource/helpers.ts engine:单角色前线上限",
  "src/core/resource.ts engine:欠打回填",
  "src/core/resource.ts engine:折叠环上限",
  "src/core/resource.ts engine:判稳含平A时间",
  "src/core/resource.ts engine:收敛环停点规范化",
  "src/core/resource.ts engine:fusedGroupMetrics/一次动作整段量",
  "src/core/resource.ts engine:findChainAttack/多段连携",
  "src/data/counterAssists.ts data:反制支援/招式配对",
  "src/data/exSpecialPlans.ts engine:exSpecialPlan/千夏拍照",
  "src/data/exSpecialPlans.ts engine:exSpecialPlan/成本类型化",
  "src/data/moveFusions.ts engine:moveFusion/飞雪斩击",
  "src/data/moveFusions.ts engine:moveFusion/春临",
  "src/data/moveFusions.ts engine:moveFusion/兔兔连斩",
  "src/data/moveFusions.ts engine:moveFusion/孤影断獠",
  "src/data/moveFusions.ts engine:moveFusion/泡泡糖轰炸",
  "src/data/moveFusions.ts engine:autoField/能量场不占前台时间",
  "src/data/sustainedEx.ts engine:sustainedEx/基准秒",
  "src/data/teamPresets.ts preset:队伍分类口径",
  "src/mechanics/__tests__/remielle.test.ts agent:1581/异化C2加算单写者",
  "src/mechanics/agents/banyue.ts engine:banyue/补齐时间上限",
  "src/mechanics/agents/claret.ts agent:1611/锐能·终结技回复",
  "src/mechanics/agents/claret.ts agent:1611/初始暴伤转暴击",
  "src/mechanics/agents/claret.ts agent:1611/平A双基准",
  "src/mechanics/agents/claret.ts agent:1611/琢形送残痕",
  "src/mechanics/agents/claret.ts agent:1611/铭刻窗口·停表",
  "src/mechanics/agents/ellen.ts agent:1191/喧响行级回填审计",
  "src/mechanics/agents/liuyin.ts agent:1481/60转大上限",
  "src/mechanics/agents/liuyin.ts agent:1481/强特计划估时",
  "src/mechanics/agents/nicole.ts agent:1031/影画1能量场",
  "src/mechanics/agents/piper.ts agent:1281/动力",
  "src/mechanics/agents/piper.ts agent:1281/影画2",
  "src/mechanics/agents/remielle.ts agent:1581/耀变倍率提升",
  "src/mechanics/agents/roxy.ts agent:1621/自旋喧响每秒口径",
  "src/mechanics/agents/sigrid.ts agent:1591/出枪式段时间",
  "src/mechanics/agents/sigrid.ts agent:1591/影画1溢出",
  "src/mechanics/agents/sigrid.ts agent:1591/敛枪式估时",
  "src/mechanics/agents/sigrid.ts agent:1591/出枪式机会计数",
  "src/mechanics/agents/sigrid.ts agent:1591/影画6破阵提速",
  "src/mechanics/agents/sigrid.ts agent:1591/影画1第三段送机会",
  "src/mechanics/agents/soukaku.ts agent:1131/强特",
  "src/mechanics/agents/starlightBilly.ts agent:1531/链数实数化",
  "src/mechanics/agents/yeshuguang.ts agent:1431/帷幕易伤",
  "src/mechanics/agents/yeshuguang.ts agent:1431/自动选轴",
  "src/mechanics/agents/yeshuguang.ts agent:1431/短轴资源",
  "src/mechanics/agents/yeshuguang.ts agent:1431/轮数实数化",
  "src/mechanics/agents/zhao.ts agent:1341/EQ合轴",
  "src/mechanics/agents/zhuYuan.ts agent:1241朱鸢特化",
  "src/mechanics/agents/zhuYuan.ts agent:1241/压制以太弹时间",
  "src/stores/config.ts engine:平A权重阶梯",
  "src/mechanics/interactionBaseline.ts engine:交互基准", // CC-478（r658）：口径随函数搬家，条目数不变
  "src/types/resource/team.ts engine:收敛读数归属",
  "src/composables/teamCompareSweep.ts sweepPage:第三人候选圈定",
  "scripts/import-nanoka-bosses.mjs data:bossBodySize",
  "scripts/import-nanoka-v12.mjs data:1611/反制支援两行秽盾基数",
]

/**
 * 判据 25 豁免：无类型记录字符串键「只读不写」的**有意**存量（CC-91，2026-09-27 建立时为空）。
 * 形如 `{ someKey: '理由 + 日期 + 回收条件' }`。只减不增；豁免失效（已不再死读）时判据会要求删除。
 */
export const RECORD_KEY_DEAD_READ_ALLOWLIST = {}

