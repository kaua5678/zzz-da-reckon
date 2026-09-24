# T2：死通道 LanguageService 按需工作台

> 状态（2026-09-23）：已实现 `zc dead-channels`，定向与集成验证见 §5。本地子代理三次委派均未产出可验收报告，实现与验证由远程协调者完成。
> 起点：`1705aeb72cf9`；保留上一轮通道文档及全部无关 WIP，不提交、不推送。

## 1. 待办分诊与事实纠正

`.claude/OPEN-ITEMS.md` T2 的「LS 发现未纳入判据」已不是完整现状：

- `scripts/lib/dead-channel-ls.mjs` 已实现 `scanDeadChannelsLs` 与行号无关的 `diffAgainstBaseline`。
- `src/scripts/__tests__/deadChannelLs.test.ts` 已有 detector、真实仓库棘轮与反向用例。
- `npm run check` 会经 `npm test` 跑 Vitest，因此不能再声称它完全不在 check 链中；它只是不在快速 `check-guards` 阶段重复建 LS program。
- 当前缺口是可发现的独立命令入口，不能为了结待办而重写扫描器、重建基线或删业务字段。

本轮先完成 T2 的按需工作台。不处理 D1–D4、T7 等明确需要用户裁决的产品口径，不重开已被证伪的候选。

## 2. 方案、边界与验收闸门

目标命令：`node scripts/zc.mjs dead-channels [--json]`。

- 复用现有 LS 扫描与基线比较；新命令惰性加载，不给 `status`、`brief` 或 `check-guards` 增加第二次 LS 扫描。
- 同一份报告支持可读文本和结构化 JSON：扫描范围/候选数/耗时、存量、新增、已消失基线项及定位证据。
- 新增未登记死通道返回非零；扫描失败、扫描面为空不能伪装成「零问题」成功。
- 存量基线本身不是失败；已消失条目提示人工核销，不自动修改代码/基线。
- 只读命令：不能创建 `.zc` 状态、写 journal、修改基线或替用户删除字段。
- 实现落在邻近 helper，`zc.mjs` 只负责路由；已有符号口径、字段名保守压制和 Vue 盲区不改变。

**前提假设**：CLI 缺失确实存在；复用同一检测/比对入口可提供按需读数而不改变旧判据。

**可观察失败**：已有等价 CLI；新入口另造一份扫描规则；普通 zc 动词提前加载/运行 LS；无候选或异常仍退出 0；注入新死字段不红；为了通过新命令而放宽基线。任一出现，停止当前修法并说明原因。

**实施前预测**：同一主工作区现有新死通道数应为 0；新增命令不改变计算器行为。定向构造中的新死字段须让命令失败，合法写入须不误报；原有基线和行号平移保持原语义。

## 3. 工人分工与文件归属

- 工人 A：只读核对 T2 现状、API/CLI 接口、最小实现建议及负控；不写文件、不执行命令、不继续委派。
- 协调者：亲自读关键代码，确认建议后用版本校验的 `apply_patch` 实施；代码前跑当前 `npm run check`，不借用历史绿基线。
- 工人 B：实现后的独立只读审查；不自评替代集成验证。
- 仅协调者执行重测试/构建，串行用 WSL；工具回执与子会话实际路由均要核对。

代码白名单：`scripts/zc.mjs`、新 helper `scripts/zc-dead-channels.mjs`、新测试 `src/scripts/__tests__/zcDeadChannels.test.ts`；`scripts/lib/dead-channel-ls.mjs` 只允许修正入口/执行链说明，检测器和基线保持不动。

文档/状态白名单：本文、README 文档索引、ARCHITECTURE 导航、OPEN-ITEMS 的 T2 条目。上一轮通道文档和其余待办不改。

## 4. 验证计划

1. 当前基线 `npm run check`。
2. helper/CLI 正反控、JSON/文本一致、退出码、空扫描失败、行号兼容、零写入与惰性装配回归。
3. 原有 deadChannelLs 与 zc 相关定向测试；真实项目命令输出与直接扫描器读数对账。
4. 由协调者串行跑集成 `npm run verify`，读取完整结果而非只看进程退出；再查 `get_diagnostics`、LF、`git diff --check` 与文件归属。
5. 通过后移除 T2 活条目，将 verifier/coverage 写入 `zc done` 并释放租约；用户保留最终验收权。

## 5. 结果

### 5.1 落地

- `scripts/zc-dead-channels.mjs`：参数校验、报告（fresh / known+基线证据 / resolved）与文本渲染；复用 `scanDeadChannelsLs` / `diffAgainstBaseline` / `normalizeBaseKey`，**零新增扫描规则**。
- `scripts/zc.mjs`：新增 `dead-channels` 动词，动态 import（其它动词不加载 LS）；文本与 `--json` 出自同一次扫描。
- 退出码：新增死通道、零候选（`EMPTY_SCAN`）、扫描异常（`SCAN_FAILED`）、非法参数均为 1；基线存量与待核销项为 0，并只提示人工处理。
- 扫描器 `dead-channel-ls.mjs`、基线、`package.json` 与计算器业务代码均未改。

### 5.2 实测

| 项 | 结果 |
|---|---|
| 改码前基线 `npm run check` | exit 0；278 文件，3402 passed / 29 skipped |
| 主工作区 `zc dead-channels` | 候选 913，新增 0，基线存量 12（逐条带 since/why），待核销 0，exit 0；行号漂移的存量仍按稳定键匹配 |
| 非法参数 `dead-channels bogus` | `INVALID_ARGUMENT`，exit 1 |
| 新测试 `zcDeadChannels.test.ts` | 参数/帮助；缺 src 与零候选失败；基线外死字段红 + 有写入负控绿 + 不创建 `.zc`；真实 CLI JSON/文本同读数与退出码 |
| 定向 4 文件（新测试 + deadChannelLs + zc + zcWorkspace） | 72/72 passed |

| 集成 `npm run verify`（改码后） | guards 21/21、tokens/data/specs/recording 通过；Vitest **3405 passed / 1 failed / 29 skipped**；唯一失败 = `difficultyCurve.test.ts`「切轴档（altAxes）」**超时 420s**（非断言失败） |
| 该失败用例单独复跑 + 余下链路 | 24/24 passed（该用例 312s）；`verify:recording` 189 通过（9 warn）；`npm run build` 通过 |

⚠ 如实记录：altAxes 用例在改码前基线中也要跑 357s，满载全套时贴近 420s 上限，本次越线。它只走引擎爬梯，本次改动没碰引擎和测试配置，因此判定为**既有的时长余量问题**，不归因于 T2。**未**放宽超时，也**未**宣称一次性全绿；建议单独立项处理（给该用例减负，或拆成独立慢测试）。

### 5.3 子代理委派记录（不计成功）

- A1（高质量路由）：64 次只读工具调用，偏离范围后被 360s 硬超时终止。
- A2（低 effort 首选路由）：父会话未派出子代理即超时。
- A3（低 effort 备用路由）：按白名单完成 4 次 read，但未交付终稿即超时。
- 三次均为 read-only / approval never，工作区哈希漂移 0。教训：该本地通道当前适合极短的一次性探针，不适合当设计工人；超时应缩小任务，而非反复重派。
