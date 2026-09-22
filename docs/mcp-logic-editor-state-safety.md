# MCP 开发：逻辑编辑器配置安全

## 分析与范围

- `storage.ts` 只做 JSON 解析与浅合并；`rowFusions: {}` 等合法 JSON 可以进入 store，随后在 `setActiveRowFusionRules` 的 `.filter()` 处失败。
- `importJson` 只检查三个顶层数组，不检查数组元素、数值或版本；错误规则可替换有效状态并进入倍率计算。
- 自动保存先写 localStorage 再更新运行时融合规则；`SecurityError` / `QuotaExceededError` 会中断这条链路。手动保存也没有失败提示。
- 本次仅处理逻辑编辑器的输入、恢复与持久化边界，不改角色数值、伤害公式、默认规则、存储 key 或游戏数据，不调整既有验证阈值。
- 工作区已有 UI 外壳 WIP：不改 AppHeader、global.css、check-tokens；README 只追加本记录索引并更新文档计数，保留原有内容。

## 方案与验收判据

1. 一个无依赖的运行时解码器服务于 JSON 导入、缓存恢复和保存。校验根对象、版本、三类数组及元素字段；数值必须有限，步长为正，上限与融合倍率非负。
2. 显式导入要求三个数组齐全；兼容省略 version 的旧导出。缓存恢复继续兼容缺少部分集合的旧数据，显式空数组不被默认值覆盖；损坏缓存回落默认值且不在读取时覆盖原文。
3. 导入先完整校验，再整体替换状态；失败不得修改当前草稿、已生效倍率或缓存。自定义标识仍为字符串，不新增实体白名单。
4. 保存只激活有效配置的独立快照。无效编辑保留草稿与上一次有效倍率；存储失败不阻止有效规则在当前会话生效。页面应说明失败、保留内存数据并提示导出备份，不能误报已保存。
5. 对象属性 JSON 与完整配置使用相同的递归 JSON 校验，允许现有嵌套数组/对象，叶子只允许字符串、有限数字、布尔值或 null，拒绝循环引用。

类型复核：首版按 `ResourceSpec.properties` 的旧声明只允许原始值；真实默认值往返测试在 `objects[43].properties.stateDurationsByStage` 处失败。查证 `src/specs/agents/1591.json` 确有合法阶段数组，因此否决“删除/拒绝结构化元数据”，改为修正共享类型并递归校验；真实默认值逐值相等的断言保持不变。

## 验证计划

- 先用现有 API 的回归用例复现坏缓存、无效导入与写入异常；修复后同一批用例必须通过。
- 解码器正/负控：仓库真实默认值、导出回导、旧格式、缺失/错误类型、非有限数值、未知版本与错误路径。
- Pinia 集成：导入原子性、倍率实际生效、存储失败仍更新倍率、无效草稿不泄漏到运行时、保存恢复后清除错误。
- 执行 `get_diagnostics`、定向 Vitest、全量检查/构建与浏览器点通；所有项目命令通过 MCP `wsl_exec`。
- 不重生成数值快照，不删除或放宽断言；最终记录实际结果及未完成项。

## 实测结果

- 改前 `npm run check`：3252 passed / 29 skipped / 1 failed；唯一失败为 `difficultyCurve.test.ts` 切轴用例的既有 300 秒超时，当时另有测试进程并发。未改阈值，单独复测该文件 `--maxWorkers=1`：24/24 通过（切轴用例约 236 秒）。
- 修复前新增的最小回归：3 failed / 1 passed，分别命中坏缓存放行、存储异常外抛、错误倍率导入未被拒绝。
- 修复后定向命令 `npx vitest run src/logicEditor/__tests__ src/stores/__tests__/logicEditor.test.ts --maxWorkers=1`：68/68 通过（64 新增 + 4 既有）；`npm run typecheck` 通过。
- 对象类型修正的扫描证据：全 spec 资源 properties 只有一处非 null 结构化字段，即 `1591.json` 的 `stateDurationsByStage: [8,7,6]`；原始 JSON 未改。
- 主工作区 `npm run build` 通过；构建保留 >1000 kB 分包提示，未修改阈值。
- 浏览器 `node scripts/ui-logic-editor-check.mjs` 通过：真实文件导入、四种无效导入的状态/缓存不变、配额异常提示、内存修改仍能导出、重试保存后告警消除、同 id 对象重新导入不复用旧文本、亮色主题坏缓存重载；零 JS 错误。脚本复用 `ui-check.mjs`，独立浏览器 profile，结束时关闭浏览器与静态服务；导出测试捕获 Blob，不写用户下载目录。
- `get_diagnostics`：0 error / 0 warning；主工作区类型检查通过。新增/修改文件统一 LF。

### 全量验证与并行工作区隔离

直接在主工作区运行 `VITEST_MAX_WORKERS=4 npm run verify` 得到 3314 passed / 29 skipped / 3 failed：一条仍为切轴超时，另外两条是验证过程中协作者新建 `docs/mcp-r65j1-decibel-cap-verdict.md` 占位文件导致的 README 文档索引失败。没有覆盖或删除对方文件；对方随后补齐其文档索引，本记录的索引也保留。

为避免把并行半成品算成本轮变更，在 `3c5c124` 上创建临时 detached worktree，覆盖本轮 13 文件与原有 4 个 UI WIP 文件，共 17 文件；排除仅在验收过程中新增的其他车道 WIP。重型文件与其余文件按互补集合分批，**没有少跑测试或提高超时**：

```bash
npm run check-guards
npm run check-tokens
npm run validate:data
npm run validate:specs
npm run verify:recording
npx vitest run src/composables/__tests__/difficultyCurve.test.ts --maxWorkers=1
npx vitest run --maxWorkers=4 --exclude='**/difficultyCurve.test.ts'
npm run build
```

实测退出码 **0**：20 guards / 12 tokens / 365 data / 1055 specs / 189 recording checks；Vitest **24 + 3293 = 3317 passed，29 既有 skipped**；类型检查与构建通过。录入校验仍报告 12 条档案缺段/状态行告警，未在本轮修改角色档案。

收工回到当前主工作区复核：`npm run check-guards` 20/20 通过（README 与实际 28 份文档一致）；上述定向 Vitest 68/68 再次通过；13 个交付文件全部 LF，`git diff --check` 通过。

长请求客户端曾返回 `TypeError: terminated`，但 WSL 任务继续完成；结果以执行端 `/tmp/zzz-mcp-snapshot-verify.exit` 的 `0` 与 `/tmp/zzz-mcp-snapshot-verify.log` 为证，不把断线当作测试结果，也不自动重放未知状态的工具调用。

收工核对：本轮源码/测试/脚本及原有 UI WIP 与验收快照逐文件 SHA-256 一致；README 的额外变化仅为另一车道追加文档与 27→28 计数，已保留。补丁工具改变的本轮 5 个既有源码可执行位已恢复；未动原有 AppHeader 文件模式差异。没有更新数值基线、安装新依赖、提交或推送。
