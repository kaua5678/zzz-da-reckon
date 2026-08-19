## 变更说明

<!-- 一句话说清改了什么、为什么 -->

## 验收（必填，AGENTS.md §1 规则 1/7）

- [ ] `npm run verify` 全绿（validate:data + validate:specs + vitest + typecheck + build）
- [ ] `npm run docs:status` 重新生成过（CI 会检查漂移）
- [ ] 基线失败先诊断根因再动手（规则 8）

## verifier + coverage（必填，AGENTS.md §1 规则 7）

- **verifier**：哪个命令/测试证明本改动生效（贴命令 + 关键输出）
- **coverage**：影响哪些角色/页面/文件

## 录入/机制类改动额外自检

- [ ] 每个机制 = spec 字段 + 生效测试（防死数据铁律，SOP §0）
- [ ] 自定义模块角色的 spec 字段死数据已处理（validate:specs 强制检查）
- [ ] 命座效果录完跑过「资源利用率页·命座提升率」，无「⚠无变化」警示
- [ ] 行匹配一律用 `moveId`，不按 name/note
- [ ] `character-mechanics.json` / `character-constellations.json` 已同步（validate:data 护栏）
- [ ] 新测试用 `src/test/harness.ts`（`setupHarness`/`mockStaticFetch`），未复制三文件 fetch stub

## 数值改动额外自检

- [ ] 数值只经 `scripts/` 导入/爬取脚本改，未手改 `public/static/catalog.json` 本体
- [ ] 静态 JSON 只改目标 id，未整文件重 dump（SOP §6.9）

## 文档同步

- [ ] 受影响的 docs 已同步（README §6 清单，知识单一事实源在代码）
