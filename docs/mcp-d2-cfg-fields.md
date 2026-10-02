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

## 5. D2 §5：模块内 `Record` 强转 → 有类型的 `cfg.<键>`（进行中）

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
- **模块私有的执行标记**（`(exec as Record<…>).<键>`）：在本模块加 `declare module '@/types/resource/execution' { interface SkillExecution { … } }` 扩充，和 cfg 扩充同一规则。
- **`(cfg.x ?? {}) as T`**：改成受检注解 `const n: T = cfg.x ?? {}`——强转会掩盖不匹配，注解会报错（本轮补的类型全靠 tsc 一次过证明）。另删 17 处变冗余的 `as`。
- **坑**：原代码有「`record.k = v` 后又 `cfg.k = v`」的双写（banyue `banyueMoveTimes/Dmg`），改写后变成同一行写两遍 ⇒ 删掉一份（同一对象，零差）。改完 `git diff` 扫一眼相邻重复行。
机械步骤（执行卡第 2–3 步）现由 `scripts/d2-record-apply.py <repo> <模块> [<声明文件>]`（`06b53326`）完成：删 `const record = cfg as …`、`record.`→`cfg.`、把声明文件（4 空格缩进的成员行）并入本模块扩充块，并列出需人工处理的剩余 `record` 引用。验证：vue-tsc `--force` 净（注入错误反证过）、锁反证、zd 0/0、全量 455 文件 / 4162 例、build。

**r393（CC-363 `bb697b35` / CC-364 `a0d4f8a6` / CC-365 `e2cfa3c8`）——判据补洞 + 设置键收口 + 3+1 模块**：
- **CC-363 设置键单一来源补完**：CC-235 的源码锁只认模板字面量 `` `setting:${` ``，于是有 12 个模块 24 处直接写 `'setting:<id>'`（`(cfg as any)[…]` / `Record` 强转 / `record[…]`）绕过 helper——键格式实际上散在 13 个地方。全部改走 `cfgMechanicSettingRaw(cfg, id)`（外层 `Number(… ?? d)` 不动 ⇒ 零差），锁扩到引号字面量（`mechanicSettingCfgSource.test.ts`，反证 23 处命中）。**语义收敛**（这些点位里很多其实该用 `cfgMechanicSetting(cfg, id, fallback)`）**不在本卡**：脏值行为不同，要逐个看，记为可选后续。
- **CC-364 判据补洞**：r391/r392 的「完成」只查 `as unknown as Record`，而 `(cfg as any).k` 是同一个病（键无类型、拼错静默）——r392 标 done 的 yeshuguang 还留着一处。完成锁加 `/\b(input\.)?cfg as any\b/`；本表加两列现值（Record 强转 / `cfg as any`），补登只有 `as any` 的 `xixifu`。**剩余：Record 189 + `cfg as any` 47**（r393 收尾前快照，含非 cfg 对象的 Record）。
- **CC-365**：`orphie` / `caesar` / `anton` 按新判据清零，`remielle` 随 CC-363 归零直接入锁。anton 的 `setRecord(cfg, key, value)` 是「按字符串键写 cfg」的局部 helper，和强转同病 ⇒ 删掉改直接赋值（新坑形态：**按字符串键写 cfg 的小 helper**，执行时 `grep -n "Record<string, unknown>)\[" ` 能扫到）。

### 执行卡（每个模块一张，机械活，可派执行模型）

1. （r393 起）先 `grep -nE "\b(input\.)?cfg as any\b" src/mechanics/agents/<模块>.ts`——脚本不统计 `as any`，这些点同样要补声明、改回 `cfg.<键>`。
   然后 `python3 scripts/d2-record-keys.py . <模块名>`：列出每个强转变量的来源、用到的键、哪些**未声明**（扩充是全局的，脚本已算上所有模块的扩充块）。
2. 来源是本槽 `cfg` 的：未声明键补进**本模块**的 `declare module '@/types/resource/config'` 扩充块（类型看写入点；拿不准写 `number`，tsc 会报）。
   **只有本模块用的键**放本模块；若 `privateCfgFields` 锁或脚本显示别处也用，放公共接口 `types/resource/config.ts`。
3. （第 2–3 步可用 `python3 scripts/d2-record-apply.py . <模块> <声明文件>` 一次完成，再按它的「剩余」清单手改）把 `record.<键>` 改成 `cfg.<键>`、删 `const record = cfg as …`、内联 `(cfg as unknown as Record<string, unknown>).k` 改 `cfg.k`；
   辅助函数若收 `record: Record<string, unknown>` 参数，去掉它、改收 `cfg`。**`Number(x ?? 0)` 等运行时包装一律不动**（保零差）。
4. 字段有类型后变冗余的 `as` 删掉；若 tsc 因 `readonly` 等报错，说明原强转在绕约束——停下来读清楚再决定，别再套一层强转。
5. 来源**不是**本槽 cfg 的（`mateRecord ← mateCfg` 是队友 cfg，同接口，可同样处理；`exec` / `state` / `result` 是别的接口）：查对应接口，同理补声明；不确定就本轮跳过、表里记一句。
6. 把模块名加进 `src/types/__tests__/privateCfgFields.test.ts` 的 `TYPED_CFG_MODULES`（锁住不回退）。
7. 验证：vue-tsc；`ZD_REPO=<wt> bash .zc/perf/zd.sh <tag>` 必须 0/0（变量改名后产物不再逐字节相同，零差是主判据）；该模块相关测试；收尾全量 vitest `--maxWorkers=4`。
8. 本表把状态改为 `done <提交号>`。一次做 3–5 个模块为宜，一个模块一个提交便于回滚。

**已知坑**：`grep` 计数有些 cast 不是对 cfg（`own` / `mateRecord` / `exec` 等），以脚本输出为准；`miyabi` / `xide` / `qingyi` / `yuzuha` 的 cast 不是 `const x = … as …` 形式（脚本「变量」段为空），看「内联」段或直接 grep。

| 模块 | 强转处数（r391） | Record 强转（r393 现值，含非 cfg 对象） | `cfg as any`（r393） | 状态 |
|---|---|---|---|---|
| `yixuan` | 7 | 0 | 0 | done a5e054d1 |
| `yeshuguang` | 14 | 0 | 0 | done 2b0743ce |
| `banyue` | 11 | 0 | 0 | done 2b0743ce |
| `starlightBilly` | 10 | 0 | 0 | done 2b0743ce |
| `sigrid` | 9 | 9 | 1 | 待做 |
| `lucy` | 8 | 8 | 0 | 待做 |
| `phoenix` | 8 | 10 | 0 | 待做 |
| `grace` | 7 | 7 | 4 | 待做 |
| `promia` | 7 | 11 | 0 | 待做 |
| `yidhari` | 7 | 7 | 0 | 待做 |
| `nangong` | 6 | 6 | 0 | 待做 |
| `severian` | 6 | 7 | 0 | 待做 |
| `vivian` | 6 | 5 | 0 | 待做 |
| `aire` | 5 | 6 | 0 | 待做 |
| `anby` | 5 | 5 | 0 | 待做 |
| `ellen` | 5 | 5 | 0 | 待做 |
| `hugo` | 5 | 5 | 0 | 待做 |
| `lighter` | 5 | 5 | 0 | 待做 |
| `roxy` | 5 | 5 | 0 | 待做 |
| `claret` | 4 | 4 | 0 | 待做 |
| `evelyn` | 4 | 4 | 0 | 待做 |
| `miyabi` | 4 | 2 | 0 | 待做 |
| `qianxia` | 4 | 4 | 0 | 待做 |
| `soukaku` | 4 | 4 | 1 | 待做 |
| `zhendou` | 4 | 4 | 0 | 待做 |
| `anbyZero` | 3 | 3 | 0 | 待做 |
| `billy` | 3 | 3 | 0 | 待做 |
| `corin` | 3 | 3 | 0 | 待做 |
| `harumasa` | 3 | 3 | 0 | 待做 |
| `luciaElowen` | 3 | 3 | 0 | 待做 |
| `pulchra` | 3 | 3 | 0 | 待做 |
| `qingyi` | 3 | 3 | 0 | 待做 |
| `seth` | 3 | 3 | 0 | 待做 |
| `trigger` | 3 | 3 | 0 | 待做 |
| `xide` | 3 | 3 | 11 | 待做 |
| `yanagi` | 3 | 3 | 0 | 待做 |
| `yaojiayin` | 3 | 3 | 0 | 待做 |
| `zhuYuan` | 3 | 3 | 7 | 待做 |
| `anton` | 2 | 0 | 0 | done e2cfa3c8 |
| `jane` | 2 | 2 | 0 | 待做 |
| `koleda` | 2 | 2 | 0 | 待做 |
| `nekomata` | 2 | 2 | 0 | 待做 |
| `nicole` | 2 | 2 | 1 | 待做 |
| `panYinhu` | 2 | 2 | 1 | 待做 |
| `piper` | 2 | 2 | 0 | 待做 |
| `rina` | 2 | 2 | 0 | 待做 |
| `soldier11` | 2 | 2 | 0 | 待做 |
| `specPanelBuffs` | 2 | 2 | 2 | 待做 |
| `yuzuha` | 2 | 2 | 0 | 待做 |
| `zhao` | 2 | 2 | 1 | 待做 |
| `ben` | 1 | 1 | 5 | 待做 |
| `caesar` | 1 | 0 | 0 | done e2cfa3c8 |
| `norma` | 1 | 1 | 0 | 待做 |
| `orphie` | 1 | 0 | 0 | done e2cfa3c8 |
| `remielle` | 1 | 0 | 0 | done 8175e6b0（唯一强转是设置读取，CC-363 已改） |
| `xixifu` | — | 0 | 8 | 待做（r393 补登：r391 表没统计 `cfg as any`） |

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
