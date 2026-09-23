# MCP → WSL → 本地子代理通道

> 范围：远程调用协议、受控派发与可复核证据；不改变计算器实现、角色数据或全局 DSH 配置。
> 状态（2026-09-23）：一次原生子代理派发及独立日志审计已通过。后续复跑遇到过 ngrok 503，未盲目重发；这是已验证的窄范围通道，不是已完成的后台任务服务。

## 1. 入口与现场边界

- 项目真身：`/home/kaua/projects/zzz-calculator`；命令统一经过 MCP 的 `wsl_exec`。
- 远程客户端：沙箱 `/tmp/mcp.py`，Python 3 标准库，无新增依赖。
- MCP 握手：`initialize` → 从 HTTP 响应头读取 `mcp-session-id` → `notifications/initialized` → `tools/list` / `tools/call`。每个后续请求回传 session；SSE 按事件拆帧后才解析 JSON。
- 本次发现 16 个 MCP 工具，没有直接暴露 `subagent`、`workflow` 或 `session_admin`。不臆造工具名或参数。
- WSL 原生 `dsh --profile headless --help` 可用，支持一次性任务、`--json` 与显式 session 恢复。
- `headless` 是独立本地协调会话，不等于原生子代理。只有观察到它的 `subagent` 工具调用、子会话及结果，才能声称原生子代理通道跑通。

## 2. 分析与最小方案

```text
远程协调者
  → 可复用 MCP 客户端
  → ShunCode wsl_exec
  → WSL dsh headless（一次性协调会话）
  → 原生 subagent（独立上下文、只读工具）
  → JSON 事件 / 子会话日志 / 最终结果
```

现场配置必须重新核验，不能照抄旧交接：

1. 模型候选仍读 `~/.dsh/model-routing.yaml`。本次窄范围验证选择 fast 档首选，并核对模型支持 `low`。
2. 本次 `~/.dsh/settings.yaml` 已不存在；有效 provider 配置在 `~/.dsh/profiles/web/cordis.patch.yml`。只提取所选 provider，禁止把整份配置或凭据打印到 MCP 输出。
3. `headless` 的默认模型指向 `wb`，但它自身组合的 `llm-pi-ai` 未带 provider 配置。直接运行不能等同于 Web 会话已有的模型能力。
4. 使用临时 `--patch` 注入所需 provider 与只读限制；不编辑全局 profile、不重启现有 Web 服务、不安装依赖。
5. provider 配置临时文件只留在本机私有临时目录；端点 capability、MCP session、凭据和原始配置不得进入仓库。

本次原生委派的关键配置如下。注意 `provider: spawn` 是**子代理运行器**，不是 LLM provider；LLM 路由在 `agentOptions` 内另行固定。

```yaml
- id: tool-subagent
  config:
    provider: spawn
    toolName: subagent
    backgroundMode: one-shot
    modelSelectionSettings: false
    enableRunInBackground: false
    maxDepth: 1
    agentOptions:
      provider: wb
      model: deepseek-v4.1-flash
      reasoningEffort: low
      maxTokens: 4096
    toolFilter:
      allow: [read]
```

以上是本次实测配置，不是永久路由事实源。复跑脚本重新读取 fast 候选，并核对该 provider 的模型/effort 声明；配置迁移或 schema 改变时先停下核对，不猜参数、不偷偷换模型。

### 安全与资源约束

- 一次只开一个原生子代理；前台执行，有明确总超时。
- 子代理工具白名单仅 `read`；禁止写入、shell、联网工具、后台任务与继续委派。
- 两个文件的阅读范围由任务书指定、原始工具日志复核；`read` 白名单是工具级硬限制，不冒称为只挂载两文件的操作系统沙箱。
- 临时协调会话使用 `read-only` sandbox，禁止权限升级；不是只在提示词里写「请只读」。
- 不接管既有用户会话，不使用猜测的 `--session-id`。
- 原有未跟踪资料与他人工作保持原样；没有 `git add`、commit、push、reset 或 clean。
- 完整业务测试不交给子代理。本次验收聚焦通道与文档，不宣称计算结果已重新验收。

## 3. 首次验证契约

**前提假设**：现有本地 DSH 能通过一个临时、受限的 headless 会话调用原生 `subagent`，子代理可读取本仓库文件并返回可核对事实。

**可观察失败**：provider 未注册或鉴权失败；没有真实 `subagent` 调用；子会话没有实际模型请求；返回值与文件不符；权限/文件范围失守；非零退出或超时。任一项发生即记录失败，不以父代理的「完成」文本替代证据。

子代理任务只读 `AGENTS.md` 的协作规则及 `package.json`，报告项目名、`build` / `check` 命令和只读边界，并回传本轮随机标记。父代理不能自行回答来冒充委派。

验收同时检查：

1. MCP 传输成功不等于命令成功：检查 `wsl_exec` 输出中的 `exit_code`。
2. headless 退出码为 0，且本轮 JSON 事件有真实 `subagent` 调用及成功工具结果。
3. 子会话原始日志的 `request/header` 给出实际 provider/model/effort，而不只记录「请求路由」。
4. 子代理确实调用 `read` 读取允许文件；最终事实与主协调者独立读取一致。
5. 本轮前后文件差异仅含明确授权的文档；诊断与文档护栏单独报告。

## 4. 可复用 MCP 命令

```bash
python3 /tmp/mcp.py list
python3 /tmp/mcp.py call read_files '{"files":[{"path":"AGENTS.md"}]}' --text
python3 /tmp/mcp.py call wsl_exec '{"cwd":"/home/kaua/projects/zzz-calculator","command":"dsh --profile headless --help"}' --text
python3 /tmp/mcp.py call apply_patch @/tmp/patch-args.json --text
```

`read_files` 的实际 schema 是 `files: [{path, start_line?, end_line?}]`，不是示意用的 `paths`。长参数使用 `@JSON文件`，项目长文件经 `apply_patch` 分块写入，行尾保持 LF。

客户端按端点隔离缓存 session；明确 HTTP 404 才重新握手并重发。超时、断流或模糊网络故障不自动重放 `tools/call`，避免重复启动代理。通知没有 JSON-RPC 响应；`202` 不被误当作 JSON 解析。

### 沙箱侧的一键复用入口

本次交付的持久副本位于远程沙箱 `/home/user/mcp-client/`，另有同内容下载包。它们不在用户项目的 Git 树里；`/tmp/mcp.py` 仍是本轮实际使用的 MCP 客户端入口。

- `mcp.py`：通用 Streamable HTTP 客户端。
- `local_subagent.py`：经该客户端调用 `wsl_exec`，串联受控派发与独立审计；不是另一个 HTTP 客户端。
- `run-local-subagent.mjs`：在 WSL 执行的最小 headless → 原生 subagent 探针。
- `audit-local-subagent.py`：在 WSL 读取**本次**父子会话日志，核对关系、路由、工具、权限与返回值；不再调用模型。
- `test_mcp.py`：只连沙箱内假 MCP 服务的协议回归，不访问真实端点。

```bash
# 在远程沙箱执行；重新生成一个固定的只读验证任务，会产生模型调用。
python3 /home/user/mcp-client/local_subagent.py

# 不启动新代理，只复核已存在的记录；把占位符换成实际 probe 目录。
python3 /home/user/mcp-client/local_subagent.py --audit-only '<WSL中的probe绝对路径>'

# 只测客户端协议，不调用用户机器。
cd /home/user/mcp-client && python3 -m unittest -v test_mcp.py
```

离开本沙箱使用下载包时，设置私有 `MCP_URL` 并从包目录运行脚本；不要把端点硬编码进仓库。客户端适用于 Linux/WSL（会话锁使用 `fcntl`）。WSL 端复用已安装的 DSH、Node、Python 和 `zstd`，不安装新依赖。

## 5. 验证记录

### 2026-09-23 的已验证结果

| 验收项 | 实测 |
|---|---|
| MCP 初始化 / 跨 CLI 进程 session 复用 / SSE 解析 | PASS；工具发现 16 项 |
| 客户端离线协议回归 | 9/9 通过：SSE 多行/注释/BOM、握手与 session 复用、404 重新握手、5xx 不重放、JSON-RPC/工具错误、JSON 响应、Unicode 参数文件、分页 |
| 原生派发 | 父会话恰好调用 1 次 `subagent`，子会话 `origin=subagent`，父子关系及深度 0→1 已核对 |
| DSH 实际请求路由 | 父子 `request/header` 均为 `wb/deepseek-v4.1-flash`、`reasoningEffort=low`；子请求上限 4096 tokens |
| 子代理可见工具 / 实际调用 | 可见工具恰好 `[read]`；实际 2 次 read，分别读取 `AGENTS.md`、`package.json`；无孙代理 |
| 权限 | 父子日志均为 `read-only`、approval `never`；子会话记录权限继承 |
| 返回值 | 随机标记、项目名及 build/check 命令与独立读取一致；子最终文本 → 工具结果 → 父最终文本逐字一致 |
| 派发期间文件变化 | 非忽略工作文件逐文件哈希差异为 0；不是只比较 git status 的状态字母 |
| 退出 / 加载诊断 | headless 退出 0，工具成功，父子 turn 正常结束，成功运行 stderr 为 0 bytes |
| 文档修改前 / 修改后护栏 | `npm run check-guards` 均为 21/21 通过；README 文档表与 docs/*.md 对账 35 份 |
| 文档导航与行尾 | `zc brief "MCP 本地子代理"` 命中新入口；三份 md 均为 LF、末尾换行、无尾随空白；`git diff --check` 通过 |
| 编辑器诊断 | `get_diagnostics` 在整个工作区返回 0 errors / 0 warnings；这不替代编译或业务测试 |

成功证据目录：`.zc/mcp-local-subagent/probe-fad08501-243a-44f6-915c-d17235f660ba/`。`audit.json` 记录独立核验，`summary.json` 记录探针判据，`events.ndjson` / `stderr.log` 是原始回执；目录已被忽略，不提交。DSH 会话标识只留在本机私有记录，不抄入本文。

实际路由证据指的是 DSH 发出的请求配置，不对上游网关内部最终模型身份作额外保证。首次成功后已通过 `--audit-only` 复核相同证据，无新增模型调用。

### 已捕获的失败与恢复边界

- **进程退出 0 不代表子代理运行过**：第一次临时 patch 漏写 `tool-subagent.config.provider`，DSH 报该插件未激活，父代理返回 blocked，却仍退出 0。验证器因「无 subagent 工具调用」正确判 FAIL。补齐 `provider: spawn` 等完整配置后通过；不能假定 patch 会深合并原 `config`。
- **网络失败不能自动补发派工**：一次复跑收到 HTTP 503 / `ERR_NGROK_3004`。客户端未重放；后续只读查询未发现新增 probe 记录，并成功复核既有 PASS 证据。未发现记录不等于可以证明命令绝未执行；模糊失败要先查本机记录/进程，再决定是否另开新任务。
- **UNC 上的新文件 hard-link 不兼容**：本次 `apply_patch` 的 Add File 报 ENOTSUP，仓库无部分落盘。用 `wsl_exec` 独占创建一行占位文件，再 `read_files` 取版本、`apply_patch` 做带旧上下文的 Update 成功；空文件的无旧上下文 Update 会被拒绝。长正文仍全部走 `apply_patch`，没有 echo/base64 截断路径。

## 6. 交付范围与后续闸门

仓库仅修改本文、`README.md` 文档索引与 `docs/ARCHITECTURE.md` 导航。未改业务代码、数值、测试基线或全局 profile，未暂存/提交/推送。原有工作材料保留；临时 provider overlay 在调用结束后移除，工作日志留在忽略目录。

本次没有新增名为 `subagent` 的 ShunCode MCP 工具，也没有验证可写工人、后台恢复、队列、取消接口、多工人并发或 Web 会话接管。若要把本通道升级为正式派工服务，先明确 task id 与幂等语义、查询/取消生命周期、超时归属、写文件白名单及路由授权，再实现并补故障注入测试；不要把本次固定只读探针当作这些能力已具备。

收工 verifier：客户端 `python3 -m unittest -v test_mcp.py`（9/9）、真实派发与 `--audit-only`、WSL `npm run check-guards`（21/21）、LF/空白与 `git diff --check`、`get_diagnostics`（0 错误/警告）。coverage：三份 md、沙箱客户端及只读通道；未修改计算器实现，本次未重跑全量业务测试或生产构建。`zc done` 只记录本车道归属，不提交任何文件。
