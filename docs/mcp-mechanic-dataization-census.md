# 机制模块数据化盘点（CC-98 · 方向 C 第 1 刀）

> lead-arena-0925c · 2026-09-27 第 117 轮 · 只读盘点，零代码改动。
> 扫描脚本：`.zc/perf/mc98.mjs`（输出 `.zc/perf/mc98.out`；`.zc/` 不进 git，
> 脚本丢失时按 §2 口径可重写，约 80 行）。复跑：`node .zc/perf/mc98.mjs`（在仓库根）。

## 0. 结论（先看这里）

1. **规模**：`src/mechanics/agents/` 下 61 个 `.ts`，内含 **62 个模块对象**
   （`specPanelBuffs.ts` 装了 2 个：佩洛 1551、橘福福 1391），`src/specs/agents/` 有 62 份 spec JSON，
   **与模块一一对应（62/62 有 spec）**。`AgentMechanicModule` 共 91 项能力，**无一项未被使用**。
2. **R3 提案里「按用到哪些能力分档」的口径不成立**：`buildCharConfig` 61/61 个文件在用，`buildExecutions` 55、
   `buildResourceResult` 53，几乎人人都有过程类钩子，按「过程类能力数」分档会 60/61 落「不可」，没有区分度。
3. **改用的口径**：只数「**spec 解释器生成不了**的过程类能力」（下称 X 数）。spec 解释器
   `specToMechanicModule`（`src/specs/mechanics.ts:137`）只生成 7 项：settings、applyPanel、buildCharConfig、
   buildExecutions、buildAnomalyEvents、buildResourceResult、resourceSections。
   结果：**A 档（X=0）2 个 · B 档（X=1–2）30 个文件（31 个模块） · C 档（X≥3）29 个**。
4. **数据化的边界不在能力层，而在钩子内部的 4 种原语**（§4）。方向 C 下一刀应该是「给 spec 加原语」，
   而不是「把某个模块整个换成 spec」。
5. **5 个纯 spec 候选**：潘引壶 1421、柳 1221、妮可 1031、派派 1281、本 1121（§5）。
6. `applyTeamConfig`（36 个）属于跨角色机制，按 AGENTS.md 就该留在代码里，**不列入方向 C 范围**。

## 1. 决定 · 依据 · 影响 · 回退点

- **决定**：放弃 R3 提案里「可 / 部分 / 不可」按能力数分档，改为 X 数分档 + 原语缺口清单。
- **依据**：§3 的覆盖率数据（能力层几乎全员同构）；§4 的抽样（钩子里是可枚举的重复模式）。
- **影响**：`docs/LONG-TERM-DIRECTIONS.md` 方向 C 的切刀顺序改为「原语先行」（见 §6）；本文件不改任何代码与数值。
- **回退点**：纯文档，`git revert` 本提交即可。

## 2. 方法

- 只在 `: AgentMechanicModule = { … }` 对象块（到下一个顶格 `}`）内匹配能力键，避免嵌套对象同名键误中。
  **必须支持简写属性**（`buildCharConfig,`）——首轮扫描漏了这一点，潘引壶、妮可被误判为 0 能力。
- agentId：`agentIds: [...]` 里的字面量，或同文件 `const X = '1421'` 常量回查。首轮只认字面量，62 个里只抽到 3 个。
- 过程类 / 声明类：按 `types.ts` 610–1303 行各能力的签名人工归类（返回值由输入计算、或原地改写数组的为过程类），
  清单写死在脚本的 `PROC` 集合里。
- 模式标签：对整个文件做正则，**是粗筛不是判定**：
  `cinemaStash`（`xxxCinemaLevel = cinemaLevel`）、`pushLiteral`（`executions.push({`）、
  `moveIdPatch`（`moveId ===` / `.has(x.moveId)`）、`idemGift`（`initialEnergyGift` 与 `prev` 同行）、
  `specDelegate`（一行转调 spec 的 resourceSections / computeSpecResources）、`specBase`（以 spec 模块作垫层）、
  `loopWhile`。

## 3. 数据

**能力使用 Top**（按文件数）：buildCharConfig 61 · buildExecutions 55 · applyPanel 54 · buildResourceResult 53 ·
resourceSections 53 · settings 53 · patchExecutions 40 · applyTeamConfig 36 · buildAnomalyEvents 14 ·
estimateExSpecialTime 14 · nextRoundFeedback 11。

**spec 之外的过程类能力 Top**：patchExecutions 40 · applyTeamConfig 36 · estimateExSpecialTime 14 ·
nextRoundFeedback 11 · crossAgentSupply 7 · bonusEnergy 6，其后是 4 个及以下的长尾，共 40 余项。

**模式标签命中**（61 个文件）：pushLiteral 52 · moveIdPatch 50 · cinemaStash 44 · specDelegate 10 ·
idemGift 5 · specBase 5 · loopWhile 2。

**spec 解释器的实际接入**：`computeSpecResources(` 27 处；有 7 个模块的 resourceSections 是一行转调 spec；
grace、nekomata、soldier11、starlightBilly、yixuan 以 `specToMechanicModule(spec)` 为垫层再覆盖。

**分档**：

| 档 | 数量 | 成员 |
|---|---|---|
| A（X=0） | 2 | panYinhu、yanagi |
| B（X=1，仅 patchExecutions） | 8 | nicole、piper、ben、seth、koleda、evelyn、roxy、claret |
| B（X=1–2，其余） | 22 个文件 | caesar、anton、pulchra、billy、zhendou、aire、xixifu、yuzuha、nekomata、qianxia、orphie、anbyZero、jane、corin、anby、qingyi、harumasa、severian、nangong、yaojiayin、specPanelBuffs（2 个模块）等 |
| C（X≥3） | 29 | zhao、soldier11、soukaku、xide、rina、promia、lucy、miyabi、trigger、lycaon、ellen、burnice、hugo、phoenix、lighter、starlightBilly、grace、vivian、luciaElowen、yidhari、norma、liuyin、sigrid、alice、velina、remielle、yixuan、yeshuguang、banyue |

逐模块明细（能力列表、X 列表、标签）见 `.zc/perf/mc98.out`。

## 4. spec 的表达缺口（4 种原语）

读了潘引壶（全文 85 行）、妮可 `patchExecutions`、`specToMechanicModule` 全文后归纳：

| # | 原语 | 现状 | 命中面 | 例 |
|---|---|---|---|---|
| G1 | **无资源的事件行**：「每次 EX 追加 N 行后台追攻」 | spec 的 buildExecutions 开头 `if (!hasResources \|\| !hasEvents) return`，没有资源就不产行 | pushLiteral 52 个文件（上界） | 潘引壶：3 行断脉破穴手 × exCount |
| G2 | **招式补丁规则**：「命座 ≥ n 时，对招式集合 S：某字段 +k / ×k，追加备注」 | spec 没有 patch 概念 | patchExecutions 40、moveIdPatch 50 | 妮可 C1：强化特殊技 dmgBonus +16、异常积蓄 ×1.16 |
| G3 | **命座透传**：把 cinemaLevel 存进 cfg 私有字段，供后续钩子读取 | 每个模块手写一行 | cinemaStash 44 | `cfg.panYinhuCinemaLevel = cinemaLevel` |
| G4 | **幂等回能**：`cfg.initialEnergyGift = max(0, 旧值 − 上轮写入) + 本轮`，再把同一公式镜像到 specResources | 手写，并且要自己记 prev 字段 | idemGift 5 | 潘引壶 C2、可琳 C4 |

G3 可以直接由解释器统一做（spec 里的规则写 `cinemaMin: n` 即可），不需要新增 JSON 字段。
G1 的改动最小：去掉 `hasResources` 门，并允许事件的 count 来自 `state` 计数（如 exSpecialCount）。

## 5. 纯 spec 候选（5 个）

| 模块 | 档 | 需要的原语 | 备注 |
|---|---|---|---|
| panYinhu 1421 | A | G1 + G3 + G4 | 全文已读，三个钩子全是上述原语，**最适合当第一个迁移样本** |
| yanagi 1221 | A | G1（+ buildAnomalyEvents 已有 spec 版） | 只看过扫描结果，没读正文 |
| nicole 1031 | B | G2 + G3，另有能量场倍率覆盖 | 倍率覆盖读的是 cfg 里预先算好的值，可能要带一个 `override` 字段 |
| piper 1281 | B | G2 + G3 | 只看过扫描结果 |
| ben 1121 | B | G1 + G2 + G3 | 只看过扫描结果 |

**已知坑**：候选名单是按扫描选的，只有潘引壶、妮可读过正文。迁移前**必须逐个读全文**，
遇到 applyPanel 里的非 attributeConversions 逻辑、或 settings 里的非资源开关，要降档。

## 6. 下一刀（CC-99，可以直接开工）

> **【第 148 轮评估结论：CC-99 按原范围不做】**（lead-arena-0925c，2026-09-27；REQUIREMENTS R4 段要求的「重新评估是否还做」）
>
> - **G3（命座透传）实测**：`src/mechanics/agents` 中有 61 处 `xxxCinemaLevel = cinemaLevel`，涉及 56 个键。逐键核对写入方和读取方（含 `setRecord` / `cfgNum` 字符串形式）：**没有发现真 bug**。
>   - 安东 `antonCinemaLevel` 经 `setRecord` 写入，是正则误报；
>   - `billyCinemaLevel` 被 `billy.ts` 与 `starlightBilly.ts` 共用，但 cfg 按槽位各一份，各读各的，不串；
>   - 编排层和 core 里出现的键名只在注释或类型声明里，没有越层读取；
>   - 唯一问题：`rina.ts:191` 的 `rinaCinemaLevel` 只写不读（死写，无害，留给以后顺手删）。
>   - phoenix / promia / vivian 另把命座写进 panel 供 `releaseModifier` 读（`ReleaseModifierInput` 只有 panels）。这是已知的走私形状，但目前能用；以后如果给 `ReleaseModifierInput` 加 `team` / 命座，可以一起收掉。
> - **结论**：统一 G3 要改 56 个模块，零差，收益只是「少一行」，属于 R6 禁止的「只为降计数」。G1 和潘引壶迁移同理：为 85 行的模块给解释器加原语（G1 要去掉 `hasResources` 门，会波及所有纯 spec 角色的路径），逻辑正确性没有收益。**不做。**
> - **重开条件**：新角色录入时，如果能靠 G1 / G3 做到纯 spec（不写模块），那时收益是真实的，再按本节原方案做。
> - **评估中的副产物**：发现并修复了普罗米娅有罪推定全队异放减防只对她自己生效的问题（CC-121，改数值，见卡表）。

- **内容**：实现 G1（spec 无资源事件行）+ G3（命座门统一透传），把**潘引壶**迁到「spec + 最薄的 G4 胶水」。
- **验收**：`.zc/perf/zd.sh` 零差（基线取自 HEAD，改动保持未提交时跑）；`npm run verify` 全绿；
  潘引壶模块的过程类钩子少于 3 个。
- **回退点**：潘引壶模块保留原文件，`registry` 里切回即可。
- **2026-09-27 更新：阻塞已解除**。R4（方向 A）被用户撤销，事件钩子接口不会出现，G1–G4 可以独立推进。CC-99 排在 R5（规格-实现对账）之后。以下是原来的阻塞说明，只作历史记录：
- ~~状态：阻塞~~。`docs/LONG-TERM-DIRECTIONS.md` 方向 C 原文：第 2 刀以后排在方向 A 第 3 刀（模块能力加「事件钩子」接口）
  定稿之后，免得模块接口被改两次。G1（事件行）和 G4（回能）都跟事件钩子直接相关，现在做大概率要返工。
- **解锁条件**：方向 A 第 3 刀的事件钩子接口定稿。在此之前**只允许做 G3（命座透传）**，因为它和事件接口无关，
  而且可以单独零差验收；想在空档期推进 C 的，就做 G3。
- **优先级**：R4（方向 A 影子内核，用户需求）按规则 8 排最前。
