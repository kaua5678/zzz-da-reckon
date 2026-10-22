# 交接提示词 ①：死口径专项排查

> 用途：直接粘给新对话作为任务 brief。
> 背景：2026-10-21 排查比利「格挡 +5 决意」时，它被判定成**注释声明了收益通道、代码从未实现**。
> **2026-10-22 复核推翻了这个前提**（见 §0）：该通道一直是活的，是**判据本身错了**。
> 本文件现在同时是「怎么正确判死口径」的方法说明 + 本轮普查的结论表。

---

## 0. ⚠ 先读：模板案例本身是错的（最重要的一课）

**原判定**（已撤销）：星徽·比利「格挡 +5 决意」是死口径，理由是
`computeAttackDataDetermination` 的入参只有 `chainCountTotal`/`ultimateCount`/`dodgeCounterCount`/
`basicAttackTime` + `parryCount`/`quickAssistCount`，**没有 `blockCount`**；
且「格挡 0/5/10/15 四档星光次数与伤害逐位相同」。

**实测（2026-10-22，真管线 `setupHarness` → `config.setActionCount` → `useResourceCalc`）**：

| 格挡 | 决意 gain（`billy_parry_determination_gain`） | 决意总量 | 星光次数 | 队总伤害（c0） |
|---|---|---|---|---|
| 0 | 0 | 840.84 | 8 | 3,248,662 |
| 5 | 25 | 865.87 | 8 | 3,248,714 |
| 10 | 50 | 890.89 | 8 | 3,248,766 |
| 15 | 75 | 911.78 | **9** | **3,313,281** |

**通道是活的，只是被 100 点阈值量化吃掉了可见性**。它走的是 **spec 解释器**：
`src/specs/agents/1531.json#billy_parry_determination_gain` 声明 `countSource: "blockCount"` × 5 →
`src/specs/resources.ts#resolveGainCount` 按**字符串键**读 `cfg.blockCount` → `computeSpecResources` →
决意总量 → `floor(/100)` 星光次数。模块自己不算这一项，**所以 grep `cfg.blockCount` 找不到消费点**。

**根因（这一类判错的通用形态）**：本仓的`cfg` 有两个读取面——
① 模块直读 `cfg.<字段>`（grep 可见）；
② **spec 解释器按字符串键读**（`countSource` / `countField` / `valueField` / `initialValueField` /
`costSource`…，grep `cfg.<字段>` **完全看不见**）。
只查 ① 就把 ② 的整条通道判成死。

**另一类「看起来死」其实是设计**：资源**不进伤害**的展示型账本（例：佩洛伊斯日珥只校验
「循环打不打得动」，spec note 明写「日珥仅校验循环可行性、不影响伤害」；`perfectBlockCount × 10`
确实改了日珥总量 +200，伤害逐位不变）。判死前先确认「这个资源有没有出口」。
（⚠ 输入框归属见 §3：佩洛伊斯的「强特完美格挡」由 `specPanelBuffs.ts#characterCountInputs` 声明；
菲欧妮虽然读同一字段，却**没有**声明输入框 —— 见「已知可疑」表。）

---

## 一、判据（怎么机械识别，2026-10-22 修正版）

一条口径算「死口径」需**同时**满足：

1. **声明存在**：模块头注释 / `@fact` / `interactionInputs`·`characterCountInputs` label 里出现
   「X 会给 Y」「X 计入 Y」这类断言。
2. **实现缺失**：字段在**全部四个消费面**都找不到读取点——
   ① 模块 `cfg.<字段>`；② spec JSON 的 `countSource`/`countField`/`valueField`/`initialValueField`；
   ③ 引擎 `core/` 的通用字段（`parryCount` 一类）；④ 编排层 `composables/`。
3. **A/B 可证**：把该字段从 0 调到**足以跨过量化阈值**的大值，**伤害读数与执行计划逐位不变**。
   ⚠ 「小步长不变」不算证据——本次事故就是这么误判的（+25 决意跨不过 100 阈值）。

**工具面**：`node scripts/zc.mjs dead-channels`（LS 判据）只覆盖「导出可选属性零写入」，
**不覆盖本类**（它查的是「没人写」，本类要查的是「写了但没人读」/「读了但没接」）。
本类只能**A/B 实测**。

---

## 二、本轮普查结果（2026-10-22）

### 2.1 手段

1. **全交互输入 A/B 扫描**：遍历所有模块声明的 `interactionInputs` / `characterCountInputs` /
   `interactionDefaults` + 所有 spec `countSource ∈ {parryCount, dodgeCounterCount, blockCount,
   perfectBlockCount, quickAssistCount, dualCounterCount}` 的规则，逐条「0 → 30」跑真管线。
   结论：**21 条声明全部有消费点**，无一死口径。
2. **全 spec `adjustable` 滑块 A/B 扫描**：37 条 spec 滑块逐条 `min → max` 跑真管线。
   结论：**0 条是死滑块**。3 条在「穷 fixture」下零 delta，富夹具（弹刀 8+/大招 3+）下全部恢复
   （§2.2 记了这 3 条），**没有一条需要处置**。

   ⚠ 附带发现：`src/specs/__tests__/adjustableEffect.test.ts` 在 **HEAD `d2f53724` 上就已经有
   2 个用例红**（6 passed / 2 failed，与本轮改动无关——本轮只改了 billy 注释 + 新增测试 + 文档）。
   红的断言是**绝对值基准漂移**（例 `1521 toxin_tuxin_stage4` 期望 18 实到 28、
   `1441 zhendou_charge` 期望 400 实到 500、`1301 xuyan_ex` 期望 340 实到 360），
   不是「滑块失效」。按 AGENTS 规则 10 属**基线重标**（重取实测基准），不得为了变绿放宽断言。
   本轮**不动它**（不属本任务面；已在提交说明登记为既有红）。
3. **cfg 字段写读交叉扫描**：模块里 `cfg.<字段> = ` 写入但全仓零非写出现的字段 **0 条**；
   模块读、全仓零写入的字段 **15 条**（全部是历史清理后的**注释残留**，读点已删，属假阳性）；
   spec `cfgField` 引用字段全部有生产写入方（`validate:specs` 已在守）。
4. **死资源扫描**：19 个角色的 spec 资源在 `resourceResult.specResources` 里**没有键**（§2.3）——
   其中 3 个是模块内部消费不回填、16 个是模块完全取代 spec 资源。都不是死通道（AGENTS 规则 4：
   「spec 是记录、真值在模块」），但**spec 里写 `status: implemented` 不代表模块读它**。

### 2.2 穷夹具假死的 3 条滑块（**都不是死滑块**）

| 滑块 | 穷夹具（0 交互 / 默认队） | 富夹具（弹刀 8+、闪反 12+、大招 3+） |
|---|---|---|
| `1391.jufufu_weishi.jufufu_weishi_assist.rate` | 0 delta（`parryCount` 默认 0 ⇒ 计数恒 0） | 7.54M → 8.34M（**有效**） |
| `1391.jufufu_weishi.jufufu_team_ult_weishi_gain.rate` | 0 delta | 6.82M → 9.31M（**有效**） |
| `1551.peiluo_prominence.peiluo_perfect_block_gain.rate` | 0 delta | 日珥总量 +200、伤害 0 delta —— **设计如此**（日珥只校验循环可行性，spec note 明写） |

⇒ 穷夹具下没有需要处置的死滑块。

**✅ 已裁决并落地（2026-10-22，用户）**：1391 这两条**不是「滑块失效」而是「语义错了」**——
用户原话：「威势影响自动后台攻击，滑块应该只能设置上限吧」。
威势不能凭空造：它全部投进山君鼎戏·威势的旋转 → 回来驱动后台自动攻击（虎威 → 虎釜震煞），
所以「倍率」等于替用户多打几次 boss。已改为**模块侧次数上限**：
`jufufu.weishiAssistCap` / `jufufu.weishiTeamUltCap`（`capOfAuto`：自动值算出、滑块只往下压、0=不限），
spec 两条 `adjustable` 删除。生效测试 `adminRulingEffect.test.ts` 甲-1/甲-2 重写为「只压不抬」三点。


### 2.3 spec 资源在 `resourceResult.specResources` 里不出现的 19 个角色（**不是死通道**）

实测（真管线，c6 + 富交互夹具）：下列角色的 spec 资源**没有键**出现在
`resourceResult.characters[i].specResources` 里：

1051 / 1091 / 1121 / 1171 / 1181 / 1261 / 1281 / 1291 / 1401 / 1411 / 1451 / 1471 / 1481 /
1511 / 1561 / 1571 / 1581 / 1611 / 1621。

逐条核对结果分两类，**都不是死通道**：

- **模块内部消费、不回填**（3 个）：1091 雅 `miyabi.ts:78` / 1401 爱丽丝 `alice.ts:193` /
  1561 维琳娜 `velina.ts:98` —— 它们调 `computeSpecResources` 后**直接读结果算次数/时间**，
  不往 `specResources` 写回（`resourceResult` 因此看不到这个键）。
- **模块完全取代 spec 资源**（16 个）：模块在 `buildResourceResult` / 执行计划里手算同名资源，
  根本不调 `computeSpecResources`。

⇒ 本节真正值得记的结论：**spec 的 `status: implemented` 不代表「模块读它」**，
实现证据 = 模块代码 + A/B 测试（AGENTS 规则 4 已写，但此前没有机器面）。
⇒ 建议（未做，属下一轮）：`validate:specs` 加一条「自定义模块角色的 spec 资源必须在模块源码
出现同名 id 或注明『实现位置：』」的检查——`grep -c` 已可零成本实现，
缺的只是「怎么判记录用途」的口径（`note` 已用「实现位置：」标记录条目，可直接复用）。

### 2.4 第二个真发现：菲欧妮「完美格挡」有实现、**没有入口**（✅ 已裁决并落地）

`src/mechanics/agents/phoenix.ts` 读 `cfg.perfectBlockCount`，A/B 实测（真管线）确实进账：
0/10 次 → 焚罪 4 次；**50 次 → 5 次、队总伤害 2.4319M → 2.5258M**。

但**全仓只有佩洛伊斯（`specPanelBuffs.ts`）声明了 `characterCountInputs: perfectBlockCount`**，
`phoenix.ts` 连 `interactionInputs` 都没有 ⇒ 菲欧妮在主页交互栏**没有这个输入框**
（`src/views/**`、`src/components/**` 全域 `perfectBlockCount` 命中 0 处）。

**用户裁决（2026-10-22，逐字）**：「可以，毕竟他有交互收益。此交互需要 boss 产生攻击，
所以要算非失衡占比。此外还有 cd 算出的上限。」
⇒ 三件事，两件由既有通道自动成立、一件需补：
1. **补入口**：`phoenixMechanic.characterCountInputs` 新增 `perfectBlockCount`（label「完美格挡」+ title 写明
   5 点/次 / 10s CD / 吃非失衡占比）；
2. **非失衡占比**：`perfectBlock` 早在 `teamCompare#BOSS_ATTACK_INTERACTIONS` 里 ⇒ 难度侧自动吃修正，
   无需新代码（加注释指向，避免后人重造）；
3. **CD 上限**：`phoenixEmberIncome` 从「`floor(blocks / 10) * 5`」改为
   `min(perfectBlockCount, floor(有效战斗时间 / 10)) × 5`（`minusInvincibleTime` 扣 boss 无敌，与
   `[灼蚀]` 周期火伤同源）。原式是**每 10 次一次**（把「10 秒」读成了「10 次」）—— 语义错，已订正。

### 2.5 已登记 debt

- 无新增。两条裁决（§2.2 1391 威势上限 / §2.4 菲欧妮完美格挡）都已落地，不留债。

---

## 三、遗留与口径备注

| 项 | 结论 |
|---|---|
| `1551` 佩洛伊斯「强特完美格挡」 | 输入框声明在 `specPanelBuffs.ts#characterCountInputs`（仅对 1551 生效）；日珥不进伤害（设计如此），A/B 伤害零变化**不是**死通道 |
| `1471` 般岳 `blockCount` | 脚本扫描会把它报成「无 UI 声明」——**误报**：般岳声明在 `interactionInputs.block`（类型是 `block` 而非字面 `blockCount`） |
| 其它 `interactionInputs` / `characterCountInputs` 缺失面 | 本轮扫「模块读 `cfg.<交互字段>` 但没有任何 UI 声明」的全集：**只有 1641 一条**（已修） |
| `spec adjustable` 的「模块覆盖」类 | 1391 两条已按裁决删声明（改模块上限滑块）；`adjustableEffect.test.ts` 头注释 §甲 的那条记录同步改注 |

---

## 四、执行步骤（下一轮照这个做）

```bash
# 1. 列出候选声明（模块头 + @fact + 交互 label）
grep -rn '@fact' src/ | grep -E '回复|计入|获得|生效' | head -40

# 2. 交叉四个消费面（★ ② 是本轮新增，漏了它就会重犯本次误判）
grep -rn '<字段名>' src/ --include=*.ts --include=*.json | grep -v __tests__      # ① 模块 + ③ 引擎 + ④ 编排
grep -rn '"countSource": "<字段名>"\|"countField": "<字段名>"' src/specs/agents/  # ② spec 解释器

# 3. 对疑似死口径写 A/B 探针（模板 = src/mechanics/__tests__/interactionInputChannels.test.ts）
#    关键：步长要跨过量化阈值（决意 100 / 日珥 90 / 喧响 3000 一类），小步长不变 ≠ 死
```

## 五、验收

- [x] 21 条交互声明全部标记「有实现」（§2.1 第 1 条；逐条 A/B 实测，无一死口径）
- [x] 37 条 spec 滑块全部扫过（§2.1 第 2 条；3 条穷夹具零 delta 已逐条归因，见 §2.2，无死滑块）
- [x] 「死口径」二选一：本轮**没有**要删注释的死口径；**撤销了一条错误结论**（§0），
      并新增一条「有实现但没入口」（§2.4，菲欧妮完美格挡，待裁决）
- [x] 回归锁：`src/mechanics/__tests__/interactionInputChannels.test.ts`（5 例，含反例自证）
- [x] 结果表 = 本文件 §2；检索入口 = README §6 本文件那一行 + `docs/ARCHITECTURE.md` §3 决策树

## 六、注意事项（2026-10-22 增补）

1. **不要只看模块里的 `cfg.<字段>`**：spec 解释器按字符串键读 cfg，是第二个读取面。
2. **不要用小步长判死**：量化阈值（100 决意 / 90 日珥 / 3000 喧响）会把真实通道洗成「逐位不变」。
3. **A/B 探针只改一个变量**、每个点独立 `setupHarness`（收敛态复用会产出假 no-delta）。
4. **发现死口径别急着补实现**：多半是玩法口径问题（要问用户），也可能是「展示型账本」设计。
5. **`node scripts/zc.mjs dead-channels` 查不到本类**：它查「没人写」，本类查「写了没人读」。
