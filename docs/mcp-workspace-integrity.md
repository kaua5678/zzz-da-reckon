# 共享工作区状态与归属记录完整性

## 范围与基线

- 用户授权持续自主开发与分批提交；不推送、不回滚其它会话 WIP。
- 前一批 `ac4ac53`：副词条 15 条契约，工作树全量 check 3244 passed / 29 skipped，typecheck/build 通过；干净提交复验另行记录。
- 本任务只改协作工具、相关测试与导航，不改计算器公式/数据/数值快照。

## 盘上证据

1. `scripts/zc.mjs#git` 对输出 `.trim()` 后再 `parsePorcelain`：当前真实首行 `" M README.md"` 被解析为 `EADME.md`。文件 mtime 读不到，可能不再提示该文件的并行 WIP。
2. `verbDone` 把全工作树 `changed` 写进当前 lane；`recentlyOwnedPaths` 又把这些路径一律当作自己所有。构造自己/他人各一文件，后续 `detectForeignWip` 结果为空，外国 WIP 被吞掉。

## 实施前预测 / Next

### A：路径传输

- 使用 Git porcelain v1 `-z --untracked-files=all`，原始输出不得 trim。
- NUL parser 保留任意合法文件名字符，处理 rename/copy 的双路径记录；保留旧换行文本入口兼容。
- 真 Git + 真 CLI 夹具中，README 首字符、中文/引号/换行文件名必须完整，未跟踪目录应展开。
- 旧代码应在新判据上失败；不改变状态谓词或把解析失败当作干净工作区。

### B：所有权

- `changed` 仍是全工作区快照，不再冒充所有权；另记基于本 lane 活跃租约的明确 `ownedPaths`。
- 只有 `ownedPaths` 可用于近期归属；旧日志缺少明确归属时采取保守提醒，不从全树 changed 猜主人。
- 目录租约按路径边界覆盖子文件；其它 lane、过期租约、无效/未来日志时间都不扩大归属豁免。
- 真 CLI 收工后再释放租约，别人的文件仍应进入 foreign WIP 提示；原有 journal 不改写。

## 提交与验证

A/B 分开提交；共享 Git 夹具沿用现有安全隔离实现，避免重复 fixture。
每批读失败原因、跑针对性回归和类型检查；最终全量 check/verify 与构建。
本任务不提高 frozen、不取消守卫；所有权字段改变的是错误归属，不是放宽协作规则。

## 结果

- A 的新回归在旧实现 **4/4 failed**；真 CLI journal 实测记录 `EADME.md` 与折叠目录，而不是 README 与实际子文件。
- A 修复后：zcWorkspace 4 + zc 44 + identity 24 = **72/72 passed**；类型检查通过。既有 Git 隔离夹具抽到 `src/test/gitHarness.ts`，两类测试共用。
- A 使用 raw NUL 读取，不再通过 trim 的通用 git 文本助手；rename/copy 原路径单独保留，截断记录响亮失败。
- A 已独立提交为 `7725feb`；B 新增 5 条归属回归在旧实现全部失败（5 failed / A 的 4 passed）。
- B 修复后 77/77 定向用例及类型检查通过：全树 `changed` 保留作快照，归属只记活跃本 lane 租约覆盖的 `ownedPaths`；旧日志没有明确归属时只作历史，不改写、不猜主人。
- 兼容代价：旧 lane 的历史工作可能重新收到“疑似 WIP”提醒；这比静默屏蔽他人改动安全。文件级租约不能区分同一文件的不同 hunks，共享文件仍需显式差异审查。
- 合并工作树全量 `VITEST_MAX_WORKERS=4 npm run check`：**3253 passed / 29 既有 skipped**；20 guards、12 token checks 通过。类型检查与生产构建通过，快照和数值路径无变化。
- 当前实际工作区已验证首项为 `README.md`（不再是 EADME.md）；明确本车道仅拥有 mine.ts 的日志不会再吞掉 foreign.ts 提醒。
- 提交后继续在干净 HEAD 运行完整 verify，避免其它 UI WIP 影响结论。
