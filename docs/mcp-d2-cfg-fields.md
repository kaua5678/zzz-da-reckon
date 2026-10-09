# D2：`CharacterOperationConfig` 去巨型化（类型层）

> 第 389 轮（arena-E）建；卡表 CC-359。对应 `.claude/OPEN-ITEMS.md` D2 / 评审 #13 /
> `docs/mcp-agent-development-roadmap.md`「战役 1」阶段 A + 阶段 B 的类型层部分。

## 1. 约定（新角色照此写）

- **只有本模块读写的 cfg 字段，声明写在本模块文件末尾**：
  ```ts
  declare module '@/types/resource/config' {
    interface CharacterOperationConfig {
      /** 说明 */
      fooBarCount?: number
    }
  }
  ```
  这是 TS 模块扩充：仍是同一个 `CharacterOperationConfig`（钩子签名、`cfg.fooBarCount` 访问、cast 一律不用改），
  **纯类型、零运行时**——产物 JS 逐字节不变（r389 用 `vite build` 前后 `diff -r` 64 文件全同验证）。
- **被第二处引用（引擎 / 机制公共层 / 视图 / 另一个角色模块）⇒ 迁回 `types/resource/config.ts` 公共接口**。
- 规则锁：`src/types/__tests__/privateCfgFields.test.ts`——公共接口里出现「剥注释后只被 1 个角色模块引用」的字段即红。
  红了就跑 `python3 scripts/d2-migrate-private-cfg.py . <模块名>`（已有扩充块会并入，不另起第二块）。
- 判据口径：**剥掉注释**后按单词边界匹配非测试源码。注释里的沿革说明不算引用（r389 首轮没剥，
  `convergence.ts` 的迁移沿革注释让 36 个私有字段被误判为公共，第二轮修正）。

## 2. 结果（r389）

- 公共接口 294 → **106** 字段（188 个迁入 26 个角色模块；`types/resource/config.ts` 851 → 459 行）。
- 顺带：公共类型文件不再 import 角色专属类型 `YidhariLoopMove`。
- 为什么这是架构收益而不是降计数：新角色加 cfg 字段 **只改自己的模块**（原先必须改共享类型文件，
  也是并行 lane 撞车热点）；字段声明与唯一读写者同处，读模块即读全它的状态。
- 没做、为什么：**没有**改成「模块私有子接口 + 交叉类型 cast」的强隔离（路线图原案 `AgentSpecificConfig<T>`）。
  那要改 26 个模块里每个钩子的 cfg 访问，收益只是「别的模块访问不到」，而现状 188 个字段本来就只被一处引用。
  扩充块是可逆的下一步前置：要强隔离时把块改成 `interface XxxCfg {...}` + 模块内 `cfg as CharacterOperationConfig & XxxCfg` 即可。
- 回滚：`git revert` CC-359 提交（纯类型，回滚无数值影响）。

## 3. r389 留下的 14 个候选——逐个判定（r390）

| 字段 | 判定 | 依据 |
|---|---|---|
| `chainCountTotalExtra` | 保留（通用契约） | 模块写、`core/resource.ts` 按通用口径加到连携总数；名字不带角色 |
| `exRefundFreeCap` | 保留 | 「连续强特通道」通用字段族（引擎只认字段、不认 agentId） |
| `timePressureSeconds` | 保留 | 引擎写、需要退化的模块读——引擎→模块的通用信号 |
| `crossAgentFlatEnergyBySource` | 保留 | 多提供者跨角色定额能量通道（CC-32b 已泛化） |
| `axisActionCounts` / `axisUltimateTotal` | 保留 | 编排层通用注入（轴内执行计数） |
| `teamUltimateFlashBonus` | 保留，**不改名** | 机制是通用的「队友终结技 × 每次回能」，模块声明量；Flash 只是仪玄能量的叫法。为改名而改名 = 用户不要的空改动 |
| `aliceTeamAssaultCount` / `aliceDisorderCount` | **已迁**（CC-360） | `mechanics/types.ts` 那一处是 `ModuleFeedback` 里的**同名键**，不是对 cfg 字段的引用 ⇒ 判据补「`name?:` 可选声明行不算引用」 |
| `promiaNiyingCount` + 仪玄 4 项 | 保留 | `stores/config.ts` 的 `CharacterConfig` 同名字段 + `defaultCharacter` 字面量；cfg 同名字段由模块 `buildCharConfig` 从 char 拷入，正常 |

结论：剩下的公共 cfg 字段都是引擎契约。**D2 在 cfg 接口上的类型层工作到此为止。**

## 4. CC-360：同一规则推广到另外三处（r390，`859cae1e`）

规则不变：**只有一个角色模块用到的东西，声明随模块走；跨模块 / 跨层的留在公共处**。

- `ModuleFeedback`（`mechanics/types.ts`，跨轮反馈键）：16 键里 14 个是「本模块自产、下一轮本模块读回」⇒ 迁到 10 个模块的扩充块；
  公共接口只剩 `teamUltimateExtra` / `consumedTeamEnergy`，**这张表现在就是「角色↔编排层」反馈耦合的完整清单**（接口头注释已改）。
- `CharacterResourceResult`（`types/resource/agentResources.ts`）：17 个「挂在结果上的角色专属数据」字段（`aliceSwordWillSource` 等）
  只被各自模块写、再由模块自己产展示行读（视图不直接读）⇒ 迁到 17 个模块。
- **整份角色结果类型**：`agentResources.ts` 里 17 份 interface（`AliceSwordWillSource` / `NormaMechanicSource` / `YixuanExChain` …）
  各自只被一个模块引用 ⇒ 整份迁到模块末尾（保留 `export`），文件 722 → 251 行。留下的 `BurniceMechanicSource` / `BanyueRageCycle`
  仍被公共结果接口的持有字段引用（展示契约）、`CorrosionSource` 被异常池引擎用，属正常。
- 工具：`scripts/d2-migrate-private-cfg.py --target cfg|feedback|result|all`（成员级），`scripts/d2-migrate-agent-types.py`（整份类型）。
  锁 `src/types/__tests__/privateCfgFields.test.ts` 4 条（3 个目标接口 + 整份类型），迁移前源码上全红（已反证）。
- 验证：vue-tsc 净、产物 `diff -r` 逐字节相同、zd 0/0、全量 4158 例过。回滚 `git revert 859cae1e`（纯类型，无数值影响）。

## 5. D2 §5：模块内 `Record` 强转 → 有类型的 `cfg.<键>`（r405 完成）

> **r406 后续（CC-380）**：同一个病的其余入口（结果 / 执行行字段的 `as any`、钩子参数 `: any`、`typeof x & Record` 强转）一并清掉，全目录不变式扩到「agents 零 any 类型」。详见架构卡 CC-380。

**状态（r405）**：下表全部 done，两个「不进锁表」例外（yidhari / soukaku）也已消掉。锁由 `TYPED_CFG_MODULES` 名单升级为**全目录不变式**（`src/types/__tests__/privateCfgFields.test.ts`：`src/mechanics/agents/*.ts` 全部文件不得出现 `as unknown as Record<string, unknown>` / `<…cfg/Cfg> as any` / `<…cfg/Cfg> as Record<string, unknown>`），**新角色模块不需要登记，写了就红**。公开函数要收任意字面量（测试传 `setting:` 动态键）时，用 `cfg as Partial<CharacterOperationConfig>` 这种**带类型**的断言读静态键（soukaku 先例）。
剩余同类问题不在本节：其他契约对象（result / state / exec 等）上的 `as any`，见 `docs/mcp-worker-task-queue.md` §2 的下一步。

**为什么做**：D2 立项时的痛点是「跨角色拼写错误无法在编译期暴露」。角色模块里 `X as unknown as Record<string, unknown>` 之后
`record.<键>` 读写**未声明**的键，拼错键名 = 静默读到 `undefined`（守卫 25 只抓「全仓零写入」的键，抓不到「写 A 读 A'」）。
每个模块现在都有自己的 `declare module` 扩充块 ⇒ 未声明键补进去、访问改回 `cfg.<键>`，拼错就编译失败。

**判据**：「这个模块的 cfg 状态键全有类型」，**不是** cast 计数下降。按动态键（`record[field]`）的通用逻辑可以保留，但这样的模块不进完成表，记一句理由。

**试点 r391（CC-361 `a5e054d1`）`yixuan.ts`**：38 处 `record.` → `cfg.`；6 处 `const record = cfg as …` 删除；两个辅助函数去掉 `record` 参数；
5 个未声明键补进本模块扩充块（`yixuanCinemaLevel` / `yixuanExtremeAssistCountInput` / `yixuanC1LightningCount` / `yixuanFlashEnergySpent` / `yixuanXuanmoGain`）；
字段有类型后 4 处 `(cfg.x ?? {}) as Record<string, number>` 与 1 处 `as YixuanExChain | undefined` 变冗余，删掉（强转会掩盖类型不匹配）。
vue-tsc 一次过（**说明 38 处里没有拼错**——这正是现在能被编译器证明的事）；zd 0/0；全量 4159 例过。

**r392（CC-362 `2b0743ce`）`yeshuguang` / `banyue` / `starlightBilly`**：35 处强转 → 0，三模块进 `TYPED_CFG_MODULES`。新出现的三种形态与处理（后续模块照做）：
- **读机制设置键**（`record['setting:<id>']`）：用新增的 `cfgMechanicSettingRaw(cfg, id)`（`utils/mechanicSettingCfg.ts`，返回原始值、不做数字转换；外层 `Number(… ?? x)` 原样保留 ⇒ 零差）。纯数字场景本来就该用 `cfgMechanicSetting(cfg, id, fallback)`，但它对非有限数取 fallback，与原 `Number(raw ?? x)` 在脏值上行为不同 ⇒ 机械迁移一律用 Raw，语义收敛另开卡。
  ~~同形态待迁~~ → **r393 CC-363 `bb697b35` 已全仓收口**（12 模块 24 处，见下）。
  → **r749 CC-532 `1c8b10d3`**：这 24 处已改用模块 reader（默认值只在 settings 声明），`cfgMechanicSettingRaw` 已删除；读机制设置一律用 `mechanicSettingReader` / `mechanicSettingPanelReader`（`utils/mechanicSettingCfg.ts`）。
  → **r750 CC-533 `0487d921`**：读到的设置也不再换算后写回 cfg 私有字段——删了 21 个模块的 56 个镜像字段及其增广声明，读取处直接调 reader（`docs/mcp-basic-pool-carve.md` §15）。
  → **r751 CC-534 `5d737c73`**：剩下两个带第二写入方的设置字段也收了——雨果 `hugoRemainingStunSeconds` 换成只在轴模式写的 `hugoAxisRemainingStunSeconds`（读取处「覆盖 ?? 设置」），柚叶 `yuzuhaChainEntryCount` 删除（影画2 强制连携并进 computeYuzuhaMechanic）（`docs/mcp-basic-pool-carve.md` §16）。
- **模块私有的执行标记**（`(exec as Record<…>).<键>`）：在本模块加 `declare module '@/types/resource/execution' { interface SkillExecution { … } }` 扩充，和 cfg 扩充同一规则。
- **`(cfg.x ?? {}) as T`**：改成受检注解 `const n: T = cfg.x ?? {}`——强转会掩盖不匹配，注解会报错（本轮补的类型全靠 tsc 一次过证明）。另删 17 处变冗余的 `as`。
- **坑**：原代码有「`record.k = v` 后又 `cfg.k = v`」的双写（banyue `banyueMoveTimes/Dmg`），改写后变成同一行写两遍 ⇒ 删掉一份（同一对象，零差）。改完 `git diff` 扫一眼相邻重复行。
机械步骤（执行卡第 2–3 步）现由 `scripts/d2-record-apply.py <repo> <模块> [<声明文件>]`（`06b53326`）完成：删 `const record = cfg as …`、`record.`→`cfg.`、把声明文件（4 空格缩进的成员行）并入本模块扩充块，并列出需人工处理的剩余 `record` 引用。验证：vue-tsc `--force` 净（注入错误反证过）、锁反证、zd 0/0、全量 455 文件 / 4162 例、build。

**r393（CC-363 `bb697b35` / CC-364 `a0d4f8a6` / CC-365 `e2cfa3c8`）——判据补洞 + 设置键收口 + 3+1 模块**：
- **CC-363 设置键单一来源补完**：CC-235 的源码锁只认模板字面量 `` `setting:${` ``，于是有 12 个模块 24 处直接写 `'setting:<id>'`（`(cfg as any)[…]` / `Record` 强转 / `record[…]`）绕过 helper——键格式实际上散在 13 个地方。全部改走 `cfgMechanicSettingRaw(cfg, id)`（外层 `Number(… ?? d)` 不动 ⇒ 零差），锁扩到引号字面量（`mechanicSettingCfgSource.test.ts`，反证 23 处命中）。**语义收敛**（这些点位里很多其实该用 `cfgMechanicSetting(cfg, id, fallback)`）**不在本卡**：脏值行为不同，要逐个看，记为可选后续。
- **CC-364 判据补洞**：r391/r392 的「完成」只查 `as unknown as Record`，而 `(cfg as any).k` 是同一个病（键无类型、拼错静默）——r392 标 done 的 yeshuguang 还留着一处。完成锁加 `/\b(input\.)?cfg as any\b/`；本表加两列现值（Record 强转 / `cfg as any`），补登只有 `as any` 的 `xixifu`。**剩余：Record 189 + `cfg as any` 47**（r393 收尾前快照，含非 cfg 对象的 Record）。
- **CC-365**：`orphie` / `caesar` / `anton` 按新判据清零，`remielle` 随 CC-363 归零直接入锁。anton 的 `setRecord(cfg, key, value)` 是「按字符串键写 cfg」的局部 helper，和强转同病 ⇒ 删掉改直接赋值（新坑形态：**按字符串键写 cfg 的小 helper**，执行时 `grep -n "Record<string, unknown>)\[" ` 能扫到）。

**r394（CC-366 `d6c8455f` / CC-367 `88187356`）——脚本泛化 + 3 模块**：两个助手脚本改用同一套强转识别（三种写法），keys 输出声明骨架；`xide` / `xixifu` / `zhuYuan` 共 32 处 cfg 强转全部由脚本机械改写，人工只写了 6 个键的声明注释和 1 处受检注解，tsc 一次过（注入拼错键反证：tsc 报错 ⇒ 键确实受检）。**查读者别只 grep ts**：`xideInitialSteel` / `xideC1UltSteel` 在 ts 里只写不读，实际由 spec 资源 JSON 按字段名读取（`computeSpecResources(spec, cfg)`），不是死写。**剩余：Record 180 + `cfg as any` 16**（`as any` 只剩 ben 5 / grace 4 / specPanelBuffs 2 / nicole·panYinhu·sigrid·soukaku·zhao 各 1）。

**r395（CC-368 `8f383bd3` / CC-369 `c7627ef3`）——`cfg as any` 全仓清零 + 全仓不变式锁**：8 个模块（ben / grace / specPanelBuffs / nicole / panYinhu / sigrid / soukaku / zhao）补 29 个私有声明，cfg 强转全部改回 `cfg.<键>`；`privateCfgFields.test.ts` 新增**全仓**锁「非测试源码零 `(cfg as any).<键>`」——这是病本身，对所有文件成立，新模块写了就红，不再靠逐模块名单（`(cfg as any)[decl.field]` 动态访问放行：convergence.ts 按声明字段名读，是通用逻辑）。`TYPED_CFG_MODULES` 18 个。**apply 脚本新坑**（CC-368 已修）：别名 `const record = input.cfg as …` 时原实现删不掉该行、却把 `record.` 改成 `cfg.`（未定义变量）；现在同源按来源替换，**混源（同文件既有 `cfg` 又有 `input.cfg` 别名）整体不动并列人工清单**。**公开签名收 `unknown` 的函数**（测试直传字面量）别硬改参数类型，保留局部读取并注明（soukaku）。**剩余：Record 153（含非 cfg 对象）+ `cfg as any` 0**。

**r396（CC-370 `9543b79f`）——第 7 批 7 模块 + 两处脚本误改修复**：lucy / phoenix / promia / yidhari / nangong / severian / vivian 补 44 个私有声明（元数据键按 `metaOf()` 实际返回写对象类型，不再是 `number` 骨架）；nangong 动态写 `cfg[key]`（key 来自字面量元组）可直接受检；promia / severian 私有 `cycleFromCfg(cfg: unknown)` 改 `Pick<CharacterOperationConfig, …>`。`TYPED_CFG_MODULES` 20 个（+nangong +severian）。**apply 脚本新坑（已修）**：同文件里 `record` 还绑定别的对象（lucy nextRound 里 `for (const c of characters) { const record = c as … }` 写**每个队友**；nangong `record:` 形参）时，旧实现全文 `record.`→`cfg.` 会把「写全队」错改成「只写自己」——本轮靠 vue-tsc 的 DeepReadonly 报错才拦下，换个可写类型就是静默错算。现在这类文件按混源停手。**keys 脚本误报（已修）**：先剥注释，注释里提到的已删旧键（vivian CC-91 的 `vivianDanceHit` / `vivianAssistCount`）不再报成未声明。**剩下的不是「漏改」而是三类结构问题**（各模块表格行已注明）：① nextRound 钩子对 `DeepReadonly` cfg 强转写回（lucy / promia / vivian，另有 hugo / ellen / anbyZero / lighter 同型）——49ecb777 定了「钩子输入只有输出通道可写」，而 typesHooks 注释说写回不跨轮生效 ⇒ 下一步用 zd 判死后删写回，而不是放宽类型；② 导出函数签名收 `Record`（yidhari）；③ 借 `panel` 夹带 cfg 字段（phoenix）。**剩余：非测试源码 `as unknown as Record` 120 行（`git grep -n` 计，含非 cfg 对象）+ `cfg as any` 0**。

**r397（CC-371 `07c17341`）——nextRound cfg 写回判死**：r396 剩下的「结构问题 ①」已解决。lucy / promia / vivian / ellen 在 `nextRoundFeedback` 里强转写 cfg，经静态（写在本轮局部克隆上，读者都在钩子之前）+ 动态（zd 0/0、管线锚点不变）判定为死写，已删；依据和锁见 `docs/mcp-nextround-writeback.md`。没有放宽钩子类型，而是在 `nextRoundFeedback.test.ts` 加了**运行时只读锁**：遍历注册表，深冻结输入后调用全部钩子。`TYPED_CFG_MODULES` 23 个（+lucy +promia +vivian）。**剩余：非测试源码 `as unknown as Record` 115 行（含非 cfg 对象）**。剩下的结构问题：② yidhari 导出签名收 Record；③ phoenix 借 panel 夹带（同属「只读入参被写」，见 nextround 文档 §5）。

**r398（CC-372 `1259abd5` / `468d0e05`）——结构问题 ③（phoenix 借 panel 夹带）已解**：根因是 `releaseModifier` 契约缺「我是谁」，于是补上 `self {slot, cinemaLevel, panel}`，同类 hack（phoenix / promia / vivian）一并删除，详见 `docs/mcp-nextround-writeback.md` §6。TYPED 24。**剩余：非测试源码 `as unknown as Record` 114 行（含非 cfg 对象）**；结构问题只剩 ② yidhari 导出签名收 Record。

> **⏹ 2026-10-09 沿革（本句已过期，勿按字面继承）**：上面 r397/r398 的「剩余 115 / 114 行」是**当时点旧数**。
> 收尾复测（2026-10-09）现读数 = **8 处**，其中 **7 处不是角色 cfg 字段**（`analysisScenario.ts:75/81` store `$state` /
> `probeTrace.ts:23` `globalThis` 探针槽 / `truncationRefold.ts:68` 与 `rowBuild.ts:43` 的 `Object.keys` 通用键快照 /
> `cfgField.ts:6/11` spec 按字段名动态读 cfg 的唯一入口 / `config.ts:217` 注释）⇒ **D2 债已清，用户 2026-10-09 裁决销号**
> （判据与现场复核见 `.claude/archive/OPEN-ITEMS-closed-2026-10-09.md` 的 `D2` 条）。剩余 8 处是**通用动态键通道**，不是 D2 债，**不要再按「114 行」立项**。

### 执行卡（每个模块一张，机械活，可派执行模型）

1. （r405 起骨架注释自带「写入 L<n>: 语句；模块内读 N；外部: …」，读 0 且无外部生产读者标 **DEAD?** ⇒ 先查死写再补声明；r405 的注释口径是把它改写成「写入：<语句>」，去掉行号）`python3 scripts/d2-record-keys.py . <模块名> <声明骨架文件>`（r394 CC-366 起三种强转 `as unknown as Record` / `as Record` / `as any` 都统计，并把未声明键写成声明骨架——**骨架里的类型是按用法猜的、注释是 TODO**：先查每个键的全部读写点（`grep -rn <键> src`，**含 `src/data` 的 JSON**——spec 资源会按字段名读 cfg），写清含义与写入方再用）：列出每个强转变量的来源、用到的键、哪些**未声明**（扩充是全局的，脚本已算上所有模块的扩充块）。
2. 来源是本槽 `cfg` 的：未声明键补进**本模块**的 `declare module '@/types/resource/config'` 扩充块（类型看写入点；拿不准写 `number`，tsc 会报）。
   **只有本模块用的键**放本模块；若 `privateCfgFields` 锁或脚本显示别处也用，放公共接口 `types/resource/config.ts`。
3. （第 2–3 步用 `python3 scripts/d2-record-apply.py . <模块> <声明文件>` 一次完成——r394 起也改写 `(cfg as any).k` / `(input.cfg as any).k` / 行首 `;(…)`，并列出剩余强转行与 `record` 引用，按清单手改）把 `record.<键>` 改成 `cfg.<键>`、删 `const record = cfg as …`、内联 `(cfg as unknown as Record<string, unknown>).k` 改 `cfg.k`；
   辅助函数若收 `record: Record<string, unknown>` 参数，去掉它、改收 `cfg`。**`Number(x ?? 0)` 等运行时包装一律不动**（保零差）。
4. 字段有类型后变冗余的 `as` 删掉；若 tsc 因 `readonly` 等报错，说明原强转在绕约束——停下来读清楚再决定，别再套一层强转。
5. 来源**不是**本槽 cfg 的（`mateRecord ← mateCfg` 是队友 cfg，同接口，可同样处理；`exec` / `state` / `result` 是别的接口）：查对应接口，同理补声明；不确定就本轮跳过、表里记一句。
6. ~~把模块名加进 `TYPED_CFG_MODULES`~~ —— r405 起锁是全目录不变式，自动覆盖所有 `src/mechanics/agents/*.ts`，无需登记。
7. 验证：vue-tsc；`ZD_REPO=<wt> bash .zc/perf/zd.sh <tag>` 必须 0/0（变量改名后产物不再逐字节相同，零差是主判据）；该模块相关测试；收尾全量 vitest `--maxWorkers=4`。
8. 本表把状态改为 `done <提交号>`。一次做 3–5 个模块为宜，一个模块一个提交便于回滚。

**已知坑**：`grep` 计数有些 cast 不是对 cfg（`own` / `mateRecord` / `exec` 等），以脚本输出为准；`miyabi` / `xide` / `qingyi` / `yuzuha` 的 cast 不是 `const x = … as …` 形式（脚本「变量」段为空），看「内联」段或直接 grep。

| 模块 | 强转处数（r391） | Record 强转（r393 现值，含非 cfg 对象） | `cfg as any`（r393） | 状态 |
|---|---|---|---|---|
| `yixuan` | 7 | 0 | 0 | done a5e054d1 |
| `yeshuguang` | 14 | 0 | 0 | done 2b0743ce |
| `banyue` | 11 | 0 | 0 | done 2b0743ce |
| `starlightBilly` | 10 | 0 | 0 | done 2b0743ce |
| `sigrid` | 9 | 0 | 0 | done c7627ef3 |
| `lucy` | 8 | 0 | 0 | done 07c17341（r397：nextRound 死写回删除 + `applyLucyTeamEnergyFlags` 多余强转去掉；剩 3 处 `(result as any)` 在结果对象上，不属 cfg） |
| `phoenix` | 8 | 0 | 0 | done 468d0e05（r398 CC-372 1259abd5：releaseModifier 契约补 `self` 后删掉 panel 夹带） |
| `grace` | 7 | 0 | 0 | done c7627ef3 |
| `promia` | 7 | 0 | 0 | done 07c17341（r397 删 nextRound 死写回） |
| `yidhari` | 7 | 3 | 0 | 实质完成 9543b79f，~~不进锁表~~ → **r405 f3a2363d 例外已消（形参 Partial / 带类型断言）**：导出 `computeYidhariHpSource(cfg: Record…)`（测试直传字面量）的 3 个调用点保留局部强转 |
| `nangong` | 6 | 0 | 0 | done 9543b79f |
| `severian` | 6 | 0 | 0 | done 9543b79f |
| `vivian` | 6 | 0 | 0 | done 07c17341（r397 删 nextRound 死写回） |
| `aire` | 5 | 6 | 0 | done a2b2479b（`cycleFromCfg(cfg: unknown)` 形参改真实类型） |
| `anby` | 5 | 5 | 0 | done a2b2479b（anbyBasicCycle 是数组，按读者断言声明；队友 mateRecord 手改） |
| `ellen` | 5 | 5 | 0 | done a2b2479b |
| `hugo` | 5 | 5 | 0 | done 9ee2bcf8 |
| `lighter` | 5 | 5 | 0 | done 9263750f：另删 R20 遗留的零消费者 cfg 链路（lighterBackstageRatio → lighterC4FrontEfficiency）；`exec` / `result` / `state` 上的 `as any` 属其它接口，未动 |
| `roxy` | 5 | 5 | 0 | done a2b2479b |
| `claret` | 4 | 4 | 0 | done a2b2479b（辅助函数 record 形参改收 cfg） |
| `evelyn` | 4 | 4 | 0 | done 767beca2 |
| `miyabi` | 4 | 0 | 0 | done 8efcb274（r402 CC-376：`miyabiCinemaLevel` 2 处 Record 强转改 `cfg.miyabiCinemaLevel`；`(cfg.panel as any)?.miyabiCinema4/6` 改按命座门控；`(result as any)` 改读已声明的 `result.miyabiFrostFallSource`；进锁表） |
| `qianxia` | 4 | 4 | 0 | done 767beca2 |
| `soukaku` | 4 | 1 | 0 | 实质完成 c7627ef3，~~不进锁表~~ → **r405 f3a2363d 例外已消（形参 Partial / 带类型断言）**：`soukakuPerExExtraTime(cfg: unknown)` 公开签名（测试直传字面量）保留 1 处局部 Record 读取；另 1 处 `as unknown as Record` 在 `state` 上，逐模块锁的正则会误伤 |
| `zhendou` | 4 | 4 | 0 | done 9ee2bcf8 |
| `anbyZero` | 3 | 3 | 0 | done 767beca2 |
| `billy` | 3 | 3 | 0 | done 767beca2 |
| `corin` | 3 | 3 | 0 | done 767beca2 |
| `harumasa` | 3 | 3 | 0 | done 767beca2 |
| `luciaElowen` | 3 | 3 | 0 | done 767beca2 |
| `pulchra` | 3 | 3 | 0 | done 9ee2bcf8 |
| `qingyi` | 3 | 3 | 0 | done 767beca2 |
| `seth` | 3 | 3 | 0 | done 767beca2 |
| `trigger` | 3 | 3 | 0 | done 9ee2bcf8（混源 cfg / own，手改） |
| `xide` | 3 | 0 | 0 | done 88187356 |
| `yanagi` | 3 | 3 | 0 | done 767beca2 |
| `yaojiayin` | 3 | 3 | 0 | done 767beca2 |
| `zhuYuan` | 3 | 0 | 0 | done 88187356 |
| `anton` | 2 | 0 | 0 | done e2cfa3c8 |
| `jane` | 2 | 2 | 0 | done 767beca2 |
| `koleda` | 2 | 2 | 0 | done 767beca2 |
| `nekomata` | 2 | 2 | 0 | done 767beca2 |
| `nicole` | 2 | 0 | 0 | done c7627ef3 |
| `panYinhu` | 2 | 0 | 0 | done c7627ef3 |
| `piper` | 2 | 2 | 0 | done 767beca2 |
| `rina` | 2 | 2 | 0 | done 767beca2 |
| `soldier11` | 2 | 2 | 0 | done 767beca2 |
| `specPanelBuffs` | 2 | 0 | 0 | done c7627ef3 |
| `yuzuha` | 2 | 2 | 0 | done 767beca2 |
| `zhao` | 2 | 0 | 0 | done c7627ef3 |
| `ben` | 1 | 0 | 0 | done c7627ef3 |
| `caesar` | 1 | 0 | 0 | done e2cfa3c8 |
| `norma` | 1 | 1 | 0 | done 767beca2 |
| `orphie` | 1 | 0 | 0 | done e2cfa3c8 |
| `remielle` | 1 | 0 | 0 | done 8175e6b0（唯一强转是设置读取，CC-363 已改） |
| `xixifu` | — | 0 | 0 | done 88187356（r393 补登） |

## 6. 字段矩阵（`python3 scripts/d2-cfg-field-matrix.py . --md <out>` 可重生成）

分类：private = 只有 1 个角色模块引用（可迁模块私有）；agents-shared = 只在多个角色模块间；engine = 引擎/机制公共层/视图也引用；dead = 声明后无人引用。

| 分类 | 字段数 |
|---|---|
| engine | 103 |
| agents-shared | 1 |

## private 字段按模块

| 模块 | 私有字段数 |
|---|---|

## 全表

| 字段 | 可选 | 分类 | 角色模块 | 其他引用 |
|---|---|---|---|---|
| `slot` |  | engine | alice, anby, banyue, burnice, caesar, corin, harumasa, hugo, jane, lighter, liuyin, luciaElowen, lucy, lycaon, miyabi, nangong, norma, orphie, phoenix, remielle, rina, sigrid, soukaku, specPanelBuffs, starlightBilly, trigger, velina, xide, yidhari, yixuan, yuzuha, zhuYuan | components/BossCard.vue, components/CharacterCard.vue, components/FinalPanel.vue, components/ResourceResultCard.vue …+76 |
| `agentId` |  | engine | alice, anbyZero, banyue, burnice, caesar, ellen, hugo, jane, lighter, liuyin, luciaElowen, lucy, lycaon, orphie, promia, remielle, trigger, vivian, xide, xixifu, yaojiayin, yeshuguang, yixuan | components/BossCard.vue, components/CharacterCard.vue, components/DifficultyDescentPanel.vue, components/FinalPanel.vue …+108 |
| `isFlashUser` |  | engine | lighter | components/ResourceResultCard.vue, composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/resourceIncome.ts …+1 |
| `panel` |  | engine | aire, alice, anby, anbyZero, anton, banyue, ben, billy, burnice, caesar, claret, corin, ellen, evelyn, grace, harumasa, hugo, jane, koleda, lighter, liuyin, luciaElowen, lycaon, miyabi, nangong, nekomata, norma, orphie, phoenix, piper, promia, pulchra, qianxia, qingyi, remielle, rina, roxy, seth, severian, sigrid, soldier11, specPanelBuffs, starlightBilly, trigger, velina, vivian, xide, xixifu, yanagi, yaojiayin, yeshuguang, yidhari, yixuan, yuzuha, zhao, zhendou, zhuYuan | components/FinalPanel.vue, components/StatPanel.vue, components/charts/DifficultyCurve3DChart.vue, components/charts/ResponseSurface3D.vue …+36 |
| `outOfCombatPanel` | ? | engine | aire, ben, claret, harumasa, liuyin, luciaElowen, nangong, norma, promia, qianxia, vivian, xide, yuzuha, zhao, zhendou | composables/resourceCalc/helpers.ts, composables/resourceCalc/panelPhases.ts, mechanics/types.ts, views/TeamConfigPage.vue |
| `basicAttackRegenPerSec` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `basicAttackDecibelPerSec` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `basicBenchmarkMoveId` | ? | engine |  | composables/resourceCalc/helpers.ts, composables/resourceCalc/skillRows.ts, core/resource/rowBuild.ts |
| `exSpecialMoveId` |  | engine | claret, ellen, koleda, luciaElowen, phoenix, severian, sigrid, yidhari | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/rowBuild.ts, types/resource/agentResources.ts |
| `promiaNiyingCount` | ? | engine | promia | stores/config.ts |
| `freeExSpecialCount` | ? | engine | nangong | core/resource/helpers.ts, core/resource/rowBuild.ts |
| `parryTimeFreeCount` | ? | engine |  | composables/resourceCalc/convergence.ts, core/resource/rowBuild.ts |
| `exSpecialCostType` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts |
| `exSpecialResourcePaidCount` | ? | engine |  | core/resource/helpers.ts |
| `extraExPlans` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `inStunWindowTriggers` | ? | engine | nangong | composables/resourceCalc/convergence.ts, composables/resourceCalc/outerCycle.ts, composables/resourceCalc/roundThreads.ts |
| `exSpecialEnergyConsume` |  | engine | ben, burnice, lighter, liuyin, lycaon, norma, phoenix, pulchra, roxy, severian, sigrid, soukaku, starlightBilly, xide, yanagi, yaojiayin, yidhari, yixuan | components/ResourceResultCard.vue, composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/helpers.ts …+4 |
| `exSpecialActionTime` |  | engine | ellen, liuyin, luciaElowen, lycaon, phoenix, qingyi, severian, sigrid, soldier11, soukaku, yeshuguang, yidhari, zhao | composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts, core/resource/rowBuild.ts |
| `exSpecialDecibelRecovery` |  | engine | starlightBilly, yidhari, yixuan | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `decibelRecoveryByMoveId` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts |
| `energyRecoveryByMoveId` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts |
| `ultimateMoveId` |  | engine | claret, koleda, luciaElowen, specPanelBuffs, yeshuguang | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/ultimatePromote.ts, core/resource/assembleSlot.ts …+1 |
| `ultimateCost` |  | engine | banyue, specPanelBuffs | components/ResourceResultCard.vue, composables/freeCompare/metrics.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts …+5 |
| `ultimateActionTime` |  | engine | liuyin, qingyi, specPanelBuffs, yeshuguang, zhao | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/crossAgentSupply.ts, core/resource/helpers.ts …+1 |
| `ultimateDecibelRecovery` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `chainMoveId` |  | engine | claret, koleda, luciaElowen, yidhari | composables/resourceCalc/helpers.ts, composables/resourceCalc/ultimatePromote.ts, core/resource/assembleSlot.ts, core/resource/rowBuild.ts |
| `chainActionTime` |  | engine | norma, qingyi, yidhari | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `chainDecibelRecovery` |  | engine | yidhari, yixuan | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `chainComboAlignRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `chainCountPerStun` |  | engine | anby, corin, liuyin, lycaon, sigrid, specPanelBuffs, yaojiayin | components/ResourceResultCard.vue, composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/ultimatePromote.ts …+10 |
| `chainCountTotalOverride` | ? | engine | anby, claret, corin, liuyin, sigrid, soldier11, specPanelBuffs | composables/resourceCalc/convergence.ts, core/resource.ts, core/resource/helpers.ts |
| `chainCountTotalExtra` | ? | engine | yuzuha | core/resource.ts |
| `exSpecialComboAlignRatio` |  | engine | lycaon, phoenix, severian, sigrid, soldier11, soukaku | composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts, core/resource/rowBuild.ts |
| `ultimateComboAlignRatio` |  | engine | specPanelBuffs | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `parryCount` |  | engine | banyue, claret, corin, pulchra, qingyi, roxy, sigrid, specPanelBuffs, starlightBilly, trigger, vivian, yaojiayin, yixuan, yuzuha, zhendou, zhuYuan | composables/difficultyDescent.ts, composables/difficultyLadder.ts, composables/liveInteractions.ts, composables/resourceCalc/convergence.ts …+16 |
| `parryNoFollowUpCount` |  | engine | claret | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `parryDecibelOnlyCount` |  | engine |  | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts |
| `dodgeCounterCount` |  | engine | anby, banyue, claret, lycaon, qingyi, roxy, severian, sigrid, starlightBilly, yeshuguang, yixuan | composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/feasibilitySearch.ts, composables/resourceCalc/helpers.ts …+12 |
| `quickAssistCount` |  | engine | corin, qingyi, starlightBilly, yaojiayin | composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, composables/teamCompare.ts …+9 |
| `perfectBlockCount` |  | engine | specPanelBuffs, yixuan | composables/liveInteractions.ts, composables/resourceCalc/helpers.ts, specs/resources.ts, specs/types.ts …+1 |
| `assaultOrderCount` |  | engine | specPanelBuffs | composables/resourceCalc/helpers.ts, stores/config.ts |
| `dodgeCounterMoveId` |  | engine | claret | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `dodgeCounterActionTime` |  | engine | qingyi, starlightBilly | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `dodgeCounterDecibelRecovery` |  | engine | starlightBilly | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `dodgeCounterComboAlignRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `defensiveAssistMoveId` |  | engine | claret, seth | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `defensiveAssistActionTime` |  | engine |  | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `defensiveAssistDecibelRecovery` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `defensiveAssistComboAlignRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `assistFollowUpMoveId` |  | engine | claret, luciaElowen, orphie, remielle, specPanelBuffs, yuzuha | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `assistFollowUpActionTime` |  | engine | qingyi | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `assistFollowUpDecibelRecovery` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `assistFollowUpComboAlignRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistMoveId` | ? | engine | claret | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistActionTime` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistDecibelRecovery` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistComboAlignRatio` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistCount` | ? | engine | claret | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `backstageRegenBonus` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/resourceIncome.ts |
| `comboAlignRegenBonus` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/resourceIncome.ts |
| `zhenyuanTriggerCount` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/resourceIncome.ts |
| `cannonRotorDamageMultiplier` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `cannonRotorCooldownSeconds` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `skipGenericExSpecial` | ? | engine | banyue, ben, burnice, claret, grace, liuyin, luciaElowen, lycaon, norma, roxy, starlightBilly, yixuan | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `exSpecialCountFractional` | ? | engine | burnice | composables/resourceCalc/helpers.ts, core/resource/helpers.ts |
| `mechanicRowValues` | ? | engine | burnice, roxy | specs/mechanics.ts |
| `initialEnergyGift` |  | engine | aire, anby, corin, ellen, grace, liuyin, nicole, panYinhu, phoenix, piper, qianxia, roxy, soldier11, soukaku, starlightBilly, yidhari, yixuan, yuzuha, zhuYuan | composables/resourceCalc/helpers.ts, core/resource/resourceIncome.ts |
| `initialDecibelGift` |  | engine | aire, alice, evelyn, phoenix, specPanelBuffs, yaojiayin, yeshuguang, zhao | composables/resourceCalc/helpers.ts, core/resource.ts, core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `extraSelfDecibelReward` |  | engine | orphie, promia, remielle, specPanelBuffs | composables/resourceCalc/helpers.ts, core/resource.ts, core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `extraSelfDecibelPerUltimate` | ? | engine | specPanelBuffs | core/resource.ts, core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `ultimateEquivalentCount` | ? | engine | yixuan | core/resource.ts, core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exContinuous` | ? | engine | yidhari | core/resource.ts, core/resource/helpers.ts |
| `exFinalize` | ? | engine | yidhari | core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exRefundPerPaid` | ? | engine | yidhari | core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exReservedCount` | ? | engine | yidhari | core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exReservedEnergyCost` | ? | engine | yidhari | core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exRefundFreeCap` | ? | engine | yidhari | core/resource/resourceIncome.ts |
| `healPctPerCurtainProviderUlt` | ? | agents-shared | luciaElowen, yidhari |  |
| `decibelPerCurtainTrigger` | ? | engine | luciaElowen | core/resource/assembleSlot.ts, core/resource/helpers.ts |
| `decibelShareRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/helpers.ts |
| `supportUltimateEnergyRegen` |  | engine | yuzuha | composables/resourceCalc/helpers.ts, core/resource/crossAgentEnergy.ts, core/resource/resourceIncome.ts |
| `timeWeight` |  | engine | luciaElowen | composables/resourceCalc/helpers.ts, core/resource.ts, core/resource/helpers.ts |
| `timeBudgetExcess` | ? | engine | yeshuguang | core/resource.ts, core/resource/foldLoop.ts, core/resource/helpers.ts, core/resource/truncationRefold.ts |
| `timePressureSeconds` | ? | engine | yeshuguang | core/resource/foldLoop.ts |
| `rowTimeLimit` | ? | engine |  | core/resource/resourceIncome.ts, core/resource/rowBuild.ts, core/resource/truncationRefold.ts |
| `tauntCancelCount` | ? | engine | banyue | composables/liveInteractions.ts, composables/resourceCalc/helpers.ts, composables/teamCompare.ts, stores/config.ts …+1 |
| `resourceUtilization` | ? | engine |  | components/AppHeader.vue, composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts, stores/config.ts …+1 |
| `teamUltimateFlashBonus` | ? | engine | yixuan | core/resource/crossAgentEnergy.ts |
| `crossAgentFlatEnergyBySource` | ? | engine | lighter | core/resource/crossAgentEnergy.ts |
| `teamStunCoverage` | ? | engine | nekomata, norma, starlightBilly | composables/resourceCalc/convergence.ts |
| `axisActionCounts` | ? | engine | nekomata | composables/resourceCalc/convergence.ts |
| `axisUltimateTotal` | ? | engine | xixifu | composables/resourceCalc/convergence.ts |
| `teamVeilCountTotal` | ? | engine | aire, qianxia, yeshuguang | composables/resourceCalc/convergence.ts, composables/resourceCalc/outerCycle.ts, composables/resourceCalc/roundThreads.ts |
| `yixuanInk2Count` | ? | engine | yixuan | stores/config.ts |
| `yixuanInk3Count` | ? | engine | yixuan | stores/config.ts |
| `yixuanPerfectBlockCount` | ? | engine | yixuan | composables/liveInteractions.ts, stores/config.ts |
| `yixuanExtremeAssistCount` | ? | engine | yixuan | stores/config.ts |
| `yixuanBackstageComboCount` | ? | engine | yixuan | stores/config.ts |
| `axisInSeconds` | ? | engine | nekomata, yixuan | composables/resourceCalc/convergence.ts |
| `battleTime` | ? | engine | aire, billy, caesar, corin, evelyn, liuyin, nangong, nekomata, nicole, norma, phoenix, piper, promia, qianxia, qingyi, soldier11, trigger, vivian, xixifu, yeshuguang, yixuan | components/charts/TimeChartsControls.vue, composables/difficultyRatio.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/roundInputs.ts …+14 |
| `invincibleTime` | ? | engine | lycaon | components/BossCard.vue, composables/difficultyRatio.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/roundInputs.ts …+16 |
| `bodySize` | ? | engine | ellen, soukaku | composables/bossRoom.ts, composables/resourceCalc/helpers.ts, stores/config.ts, views/AttributeConfigPage.vue |
| `blockCount` | ? | engine | banyue, starlightBilly | composables/agentMechanicView.ts, composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/feasibilitySearch.ts …+10 |
| `dualCounterCount` | ? | engine | banyue | composables/agentMechanicView.ts, composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/feasibilitySearch.ts …+9 |
