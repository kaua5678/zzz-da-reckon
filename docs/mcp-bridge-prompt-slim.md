# 搭桥提示词精简（REQUIREMENTS R9）

> lane arena-G（第 700 轮），2026-10-06。产物：`/mnt/c/Users/kaua/Desktop/bridge-prompt-arena.slim.md`（Windows：`C:\Users\kaua\Desktop\bridge-prompt-arena.slim.md`）。原文件 `bridge-prompt-arena.md` 未动（md5 5126b942），替换由用户 / 助手 review 后决定（§4）。
> 需求原文在主仓 `docs/REQUIREMENTS.md` R9（23:44 写入，本轮结束时尚未提交）。
> **状态（r701 核实，2026-10-07）**：用户已于 00:40 批准转正（「助手代改」）。生效提示词迁到 `F:\proj\arena-proxy\bridge-prompt-arena.md`（WSL：`/mnt/f/proj/arena-proxy/bridge-prompt-arena.md`，md5 bbff25b6），`autopilot.js` 的 `BRIDGE_MD` 改为 `path.join(__dirname, "bridge-prompt-arena.md")`；精简前版本存档为 `_prompt-history/bridge-prompt-arena.md.pre-slim-20261007`，桌面那份与全部 `.bak-*` 移进 `_prompt-history/`。生效版的第一节与本文的精简正文相比只改了两处路径（桌面 → `F:\proj\arena-proxy`），引导客户端逐字节相同。下文提到的桌面路径都已过时。

## 0. 结论

- autopilot（`F:\proj\arena-proxy\autopilot.js`）的 `loadBridgePrompt` 取「## 一、粘给 arena 的内容」标题之后、第一个以 `---` 开头的行之前的内容，trim 后每轮发送（:315-327、:1772）。精简只针对这一段；第二节及以后不发送，原样保留。
- 每轮实发段压到原来的 44.2%（字符）/ 46.3%（字节），规则一条没删（§3 逐条对照，共 52 条）。
- 最大的一块是内嵌的完整客户端（约 115 行）。它换成了约 30 行的**引导客户端**（只有 `sh` / `cat`），开工第一步用它拉回 WSL 端的完整客户端。权威版本本来就是 WSL 端那份，所以「内嵌副本过时」这类问题从结构上消失了。完整客户端逐字存档在 slim 文件第二节。

## 1. 字节数（`wc -c`）

| 对象 | 原 | 精简后 | 比例 |
|---|---|---|---|
| 整个文件 | 52,482 B | 46,232 B | 88.1%（第二节多了存档的完整客户端和一条修改记录） |
| 每轮实发段（字节） | 29,512 B | 13,655 B | **46.3%** |
| 每轮实发段（字符，需求里的「19 KB」） | 19,366 | 8,567 | **44.2%** |

验法：`wc -c /mnt/c/Users/kaua/Desktop/bridge-prompt-arena.md /mnt/c/Users/kaua/Desktop/bridge-prompt-arena.slim.md`；实发段用与 autopilot 相同的切分逻辑抽取后再量（r700 已核对：抽取结果与精简正文逐字相同，不少于 200 字符，正文里没有以 `---` 开头的行）。

## 2. 删掉的类别与典型例子

只删了 R9 允许的三类，另有一处顺手修正。

1. **「当初为什么这么定」的长叙事与事故经过（只留结论）**
   - `wsl --terminate` 事故（2026-09-26 卡死 WSL、`wsl -l -v` 无响应、需管理员重启服务）→ 保留「会卡死整个 WSL，沙箱没有权限修复，工作全部停摆」。
   - 「436 个提交跨 7 天没推、远端停在 09-21」的经过 → 保留一句「曾有 436 个提交 7 天没推」。
   - r419 `git stash pop` 弹出别人的 stash（18 个文件冲突）、r401 后台 vitest 只剩半截日志、r424 `c47e153b` vue-tsc 红 9 小时、vitest worker 背景（16 vCPU / 9 GB、r385 / r450 负载）、并行会话的成因推断（arena 对战模式）→ 只留规则本身。
2. **重复叙述（合并成一处）**
   - 并行调用的坑：原「第三个坑」与 r404 修复说明各讲一遍 → 合并为「客户端的坑」第 4 条。
   - 写文件：原「往 WSL 写文件」与第 2 条的括注各讲一遍 → 合并为 `put` 一条，加上 Windows 侧 `apply_patch` 一条。
   - dsh：第 6 条与第 9 条之后的自检、示例分在两处 → 合并为「环境」第 7 条，派活示例移到第四节 4.3。
   - 第 10 条里「与唯一不变的判据一致」重复了开头的判据 → 删掉重复句。
3. **过时内容**
   - 内嵌完整客户端，以及「若你的 `/tmp/mcp.js` 还是 `let id = 1` 就照改」→ 完整客户端不再随正文分发（引导客户端与 WSL 端都是 `process.pid * 1000`）。
   - 基线数字「r696：527 文件 / 4507 用例」已过时（r699 为 529 / 4534），规则本身写的是「以 r6 §8 最新一行为准」→ 只留指针。
   - 旧的错误写法 `cp -r .zc/perf <worktree>/.zc/` 的说明 → 只留正确写法。
4. **顺手修正**：原文的同步命令 `node /tmp/mcp.js cat … > /tmp/mcp.js` 会在 node 启动前被 shell 截断成空文件 → 改为先写 `/tmp/f.js` 再 `mv`。

## 3. 规则没丢：逐条对照

「位置」指 slim 文件第一节里的小节与条目序号。

| # | 原第一节的规则 | 位置 |
|---|---|---|
| 1 | 通过 MCP 操作真实项目；可用文档留待办给低级模型；有完全修改权限，可改文档规则 | 开头第 1 段 |
| 2 | 提示词本身可改：Windows / WSL 两个路径；每轮开工重新读取，下一轮生效 | 开头第 2 段 |
| 3 | 改提示词三步：先备份 `.bak-<原因>-<时间戳>`；写清改了什么、为什么；改完核对关键段落仍在（离线，无人救） | 开头第 2 段（关键段落里加了「引导客户端」） |
| 4 | 「分工」只是思路，可推翻；用户原话「也许我说的分工才是牢笼呢」 | 开头第 2 段 |
| 5 | 任何条款都可推翻或改写，写清依据 | 开头第 2 段 |
| 6 | 唯一不变的判据：架构更通用 / 更简单，不看计数；棘轮指标是工具不是目标；只为降计数的改动是用户不要的大改 | 开头第 3 段 |
| 7 | MCP 端点 URL | 连接（原样） |
| 8 | 写可复用客户端，所有调用都走它，别手搓 curl；协议要点（POST 头、回传 `mcp-session-id`、SSE 先剥帧再 parse、initialize → initialized → tools）；用沙箱里有的 node / python3 | 连接 1–2；协议要点由引导客户端代码体现 |
| 9 | `wsl_exec` 只回 stdout 末尾 6000 字符且不报截断；长文件用客户端 `cat`（按字节分块 + sha256）；超长单行用 `sed` / `grep` 只出尾部，改用 `cut -c`；行首不对 = 被截 | 客户端的坑 1 |
| 10 | 文档每轮一行，单行 < 8 KB（`add-round.py`） | 客户端的坑 3 |
| 11 | 往 WSL 写文件用 base64 分块 + sha256（即 `put`），别用长 heredoc | 客户端的坑 2 |
| 12 | 客户端用法：list / call / sh / cat / put | 连接 2 |
| 13 | 权威顺序 WSL 端优先；开工用 `md5sum` 核对，不一致以 WSL 端为准，别把 WSL 端改回旧版 | 连接 3（完整版不再随正文分发，只剩「WSL 端 vs 本地」两方） |
| 14 | 沙箱 `/tmp` 每轮清空；持久副本 `/home/user/mcp.js`；不一致时从 WSL 端 `cat` 同步 | 连接 1–2 |
| 15 | 客户端代码（含 `id = process.pid * 1000`） | 引导客户端代码；完整版存档在第二节 |
| 16 | 重命令同一时刻只跑一个，轻量查询可并行；报 Duplicate id、ngrok 掉线、桥重启后 `rm -f /tmp/mcp.session` 再串行重发 | 客户端的坑 4 |
| 17 | 开工先 `list` 确认工具 | 连接 4（写明 16 个、含 `wsl_exec`） |
| 18 | 项目在 WSL；git / node / npm / 测试 / 构建一律走 `wsl_exec`，不走 `run_command`（UNC 慢） | 环境 1 |
| 19 | 没有 `wsl_exec` 时的退路：`run_command: wsl -d Ubuntu -e bash -lc "cd … && …"`；不读写 UNC；在交接里注明 | 环境 1 第 1 子条 |
| 20 | 退路也不通 = WSL 挂了：停手、`report_progress` 报一次、偶尔 `tools/list`；`404 ERR_NGROK_3200` = 隧道离线；恢复后先核对 worktree | 环境 1 第 2 子条 |
| 21 | 禁止 `wsl --terminate` / `--shutdown`；只杀具体进程，用方括号写法或 `pgrep` 后 `kill -9 <pid>`；裸 `pkill -f` 会杀掉自己 | 环境 2 |
| 22 | WSL 无连接时自行关机、`/tmp` 清空；产物放 calc-arch；在 WSL 里轮询（≤ 170s）；别在沙箱侧长 sleep；结果可疑先看 `uptime` | 环境 3 |
| 23 | 后台进程活不过调用 ⇒ 前台跑，配 `timeout 285`；zd / build / guards 的耗时；超过 285s 才拆段 | 环境 3 |
| 24 | worker 上限已写进 `vite.config.ts`（默认 4，用 `VITEST_MAX_WORKERS` 加大） | 环境 4 |
| 25 | 开跑前 `pgrep -fc "[w]orkers/forks.js"` 为 0，否则轮询等待 | 环境 4 |
| 26 | 全量 vitest 拆分片（高负载拆 4 或 8 份），各片 passed 之和 = 基线（以 r6 §8 最新一行为准） | 环境 4 |
| 27 | `npm run verify` 拆三段前台跑 | 环境 4 |
| 28 | Windows 侧 `run_command` 写长文件用 `apply_patch`（命令行 8191 字符上限）；WSL 侧用 `put` | 环境 5 + 客户端的坑 2 |
| 29 | 改完代码跑 `get_diagnostics`，语义跳转用 `lsp` | 环境 6 |
| 30 | 多步任务用 `set_todos`，最多一个 `in_progress` | 环境 6 |
| 31 | 分析与方案写进 `docs/mcp-<topic>.md`，LF 结尾 | 环境 6 |
| 32 | dsh 的路径与用法、能力、约 3 秒返回；小事不派；不与它同时写同一个文件；Windows 侧改用 `run_command`；细节见第四节 | 环境 7 |
| 33 | 派活前 pong 自检 | 环境 7 |
| 34 | 派活示例（找出 src/ 下所有 TODO） | 移到第四节 4.3 |
| 35 | 一切结论落盘到 docs；推理出来但没写进文件 = 没完成 | 离线纪律 1 |
| 36 | 不问用户确认；自己决定，写「决定 + 依据 + 影响」；列明禁止的收尾句；拿不准选可逆方案，写回退点 | 离线纪律 2 |
| 37 | 每轮交接三要素；判据：只读文档就能接着干 | 离线纪律 3 |
| 38 | 收尾三件事：交接 → commit → `git push origin master`；推送失败记进文档 | 离线纪律 4 |
| 39 | 不写给人看的汇报，不维护 `PROGRESS.md` | 离线纪律 5 |
| 40 | 用中文回复；不凭记忆描述文件内容，先读再说 | 离线纪律 6 |
| 41 | 新需求看 `REQUIREMENTS.md`：每轮先读、按优先级做、标 `[done <commit>]`、不删条目、再按队列继续；文件不存在就忽略 | 离线纪律 7 |
| 42 | 开工先查现场：ps / `git log -3`（< 15 分钟）/ `ls -lt calc-arch` / `git status` / fetch + `rev-list` 不为 0 先补推 | 并行会话 1 |
| 43 | 在自己的 worktree 跑 `vue-tsc -b --force`；红了最小修或在 §2b 记一行，不 revert 别人；合入前再看 `git status` | 并行会话 2、4 |
| 44 | LANE-CLAIMS：选活前读、避开未 released 的文件、选好立刻追加一行、收工标 released | 并行会话 3 |
| 45 | 有人在跑时：文件不相交、用自己的 worktree、只 add 自己的路径、§2 与 §2b 分开 | 并行会话 4 |
| 46 | 零差在 worktree 跑（mkdir + cp + `ZD_REPO`）；`.zc` 不入 git；不设 `ZD_REPO` 时比对主工作区 | 并行会话 5 |
| 47 | 禁用 `git stash`；替代做法 `cp` + `git show HEAD:` | 并行会话 6 |
| 48 | 孤儿改动（超过 1 小时、无人认领）：审查 → 隔离 verify → 提交或丢弃，在交接里写清 | 并行会话 7 |
| 49 | 测试只为新行为和真会回归的边界写；判断标准 | 反臃肿 1 |
| 50 | 改了共享测试基建后要做反例验证 | 反臃肿 2 |
| 51 | 不写防御性冗余（四类） | 反臃肿 3 |
| 52 | 这不是降低质量；拿不准时问自己 | 反臃肿 4 |

机械核对（r700）：把原正文里反引号包住的 137 个命令、路径、标识符逐个查找。94 个原样出现在 slim 正文里，13 个在第二节（存档的完整客户端或修改记录），其余 30 个逐个判定，分三类：事故叙事；改写后的等价写法（占位符改名、协议头写进代码、`VITEST_MAX_WORKERS=8` → 「要更多就设 `VITEST_MAX_WORKERS`」）；已修正的旧写法。

## 4. 引导客户端实测与替换方法

（r701：替换已由用户完成，见文件头状态；以后改提示词改 `F:\proj\arena-proxy\bridge-prompt-arena.md`，备份放 `_prompt-history/`。）

- 实测（沙箱 node，对真实端点）：`sh` 正常；非零退出码透传（rc 3）；删掉 `/tmp/mcp.session` 后自动重新握手；`cat` 拉回 `/home/kaua/calc-arch/arena-mcp-client.js`，md5 5605337c994f，与现行客户端一致；读 29.5 KB 的多块文件，md5 一致；读不存在的路径时报 `cannot stat`，rc 1。
- 替换（用户决定后）：`cp bridge-prompt-arena.md bridge-prompt-arena.md.bak-pre-slim-<时间戳>`，再 `cp bridge-prompt-arena.slim.md bridge-prompt-arena.md`。autopilot 读的是固定路径 `BRIDGE_MD`，不用改代码。回退：把备份拷回去。
- 替换前若原文件又被改过（md5 不再是 5126b942），先把新改动同步进 slim 版，否则会丢掉那次修改。
