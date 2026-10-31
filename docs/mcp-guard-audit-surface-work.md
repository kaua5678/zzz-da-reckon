STATUS: done

# 判据「表面功夫」审计（surface-work audit）

> 审计对象：`src/**/__tests__/` 里「读源码文件 → 正则/字符串匹配」的源码锁、`scripts/check-guards.mjs`（31 条）、
> `scripts/check-tokens.mjs`（15 条）、`src/scripts/__tests__/` 下的判据测试。
> 基线提交 `ad9670cb`；`npm run check-guards` = 31/31、`npx vitest run src/scripts/__tests__` = 556 passed（审计前后各一次，均绿）。
> **本轮零代码改动**（工作树干净），只产出本文。

## 0. 一句话结论

本仓库的判据体系**整体是有牙的**（31 条 check-guards 里 **18 条**带反空洞下限、**7 条**带 detector 自证，`RATCHET_BURNDOWN` 11 条有 burn-down 契约）。
真正「表面功夫」的不是判据的**设计**，而是三类**实现细节**：

1. **格式耦合的源码锁**（A 类）：锁的是「这一行怎么写」，不是「这件事成不成立」。无害重构会红，红了你只能改无关的东西。
2. **净额聚合的棘轮**（B 类）：`var()` 总数、手册行数这类**加减混在一起**的单一数字，一处退步能被别处进步吞掉，
   而判据的报错话术还在说「是进步，上调基线」——它**逼你改数字**。
3. **C 类弱断言**：`toBeGreaterThan(0)` 734 处里，相当一部分量的是**恒真命题**（`coverage >= 0`、`index >= 0`）。

另有一条**真正失效的判据**（`core 角色名中缀/子目录` 的 burn-down 没有 measure ⇒ current=NaN ⇒ 永不 stale），
它不属于 A/B/C 任何一类，是**接线断了**。

---

## 1. 清单与计数（先给分布，再给结论）

### 1.1 清点口径

| 面 | 数量 | 取法 |
|---|---|---|
| `src/**/__tests__/` 下 `readFileSync` 的测试 | **215** | `grep -rl readFileSync src --include='*.test.ts'` |
| 其中「读源码 + 正则/字符串匹配」的**源码锁** | **113** | 再要求含 `toMatch(`/`toContain(`/`expect(src` |
| 源码锁里的 `toMatch(` | **203** | 全仓 `toMatch(` 203 处，`not.toMatch(` 70 处 |
| 源码锁里的 `not.toContain(` | **157** | — |
| `check-guards.mjs` 判据 | **31** | `runAllChecks().results.length`（测试也钉了 31） |
| `check-tokens.mjs` 判据 | **15** | `runAllChecks().results.length`（测试也钉了 15） |
| `RATCHET_BURNDOWN` 条目 | **11** | `scripts/lib/guard-registries.mjs` |
| 反空洞下限常量（`*_MIN_*`） | **22 个名字 / 18 条判据生效** | `grep -rhoE '[A-Z_]+_MIN_[A-Z_]+'` |

### 1.2 A/B/C 三类计数（判据侧：31 条 check-guards + 15 条 check-tokens = 46）

| 类别 | 条数 | 具体哪几条 | 判定 |
|---|---|---|---|
| **A（量错对象）** | **0** | —— | 判据侧**没有** A 类：31 条 check-guards 全部量的是「结构/依赖边/扫描面」，不是行尾格式 |
| **B（只量规模/代理）** | **5** | ① `手册 §4 行数`（行数≠信息密度）② `alias ratchet`（`VAR_TOTAL_BASELINE` 净额聚合）③ `hardcoded-color ratchet`（判据名「仅 3 处」≠ 实测 101）④ `settings coverage`（文本 includes ≠ 生效测试）⑤ `手册密度棘轮`（分母可被空行稀释；仓库已自认此局限） | ①②④ 该修（诱导错误动作）；③ 只改标签；⑤ 低优先（已自认） |
| **C（断言太弱/失效）** | **2** | ① `contrast`（缺令牌静默跳过，无受检对数下限）② `core 角色名中缀/子目录` burn-down（measure 缺失 ⇒ NaN ⇒ 永不 stale） | 都该修 |
| **有牙，不该动** | **39** | 见 §4 | 不动 |

> 判据侧的真实强度：31 条 check-guards 里 **18 条**自带反空洞下限（`*_MIN_*` 常量参与 `ok` 计算），
> **7 条**带 detector 自证（`json-dup-keys`/`record-key-dead-reads`/`id-literal`/`literal-assertion`/
> `dead-nullish`/`type-restatement`/`field-writer`），两者部分重叠。**A 类为 0** 说明「量错对象」主要发生在
> **测试侧的源码锁**（§1.3），不在判据侧——这是本轮最重要的分布结论。

### 1.3 A/B/C 三类计数（测试侧：113 个源码锁文件）

| 类别 | 条数 | 形态 | 代表 |
|---|---|---|---|
| **A（格式耦合）** | **2 个文件 / 14 条断言** | `toMatch(/…\\n  xxx\\n/)`：锁死「两空格缩进 + 字段名紧跟换行」 | `noNullRoundCc418`（**13 条**）、`battleTimeDisplaySingleSource`（**1 条**） |
| **A（换行敏感，已修）** | 1（历史） | `split('\\n').length < 1400` | `typesSplitCc83`（2026-10-17 已订正，见 §2.1 A-3） |
| **B（行数/规模）** | **1** | `lineCount < 1400` | `typesSplitCc83` |
| **C（恒真弱断言）** | **48 处** `toBeGreaterThanOrEqual(0)` + 若干 `toBeLessThanOrEqual(1)` | 量的是「值 ≥ 0」= 恒真 | `inStunAttribution`（`triggerCount >= 0` / `avgCoverage >= 0`） |
| **C（非空断言）** | **734** `toBeGreaterThan(0)` / **423** `toBeTruthy()` / **99** `toBeDefined()` | 其中 172 / 72 / 67 落在源码锁文件里 | 全仓 |

---

## 2. 逐条判定（四栏）

### 2.1 A 类：量错对象

#### A-1 `src/composables/__tests__/battleTimeDisplaySingleSource.test.ts:19`

| 栏 | 内容 |
|---|---|
| **判据位置** | `battleTimeDisplaySingleSource.test.ts:19`：`expect(src).toMatch(/\n  totalTime: number\n/)` |
| **类别** | **A**（格式耦合） |
| **Q1 它想防什么** | 结果卡片**必须由 props 收到 `totalTime`**，不许在卡内用「前台 + 后台」自己推——推出来的是**错误的战斗时长**，用户看到的秒数会偏大/偏小。 |
| **Q2 能否被无关改动满足/破坏** | **能破坏**。实测：给该字段加一行行尾注释（`totalTime: number // 前台+后台`）⇒ 判据**红**；缩进从 2 空格改 4 空格 ⇒ **红**；字段拆成两行 ⇒ **红**。这些改动**零语义变化**。 |
| **Q3 有反证用例吗** | 有反向（`not.toMatch(/\b180\b/)`），但正向这条锁的是**排版**，反向那条才是语义。 |
| **为什么在逼人做无意义修改** | 有人给字段补一句注释说明「为什么不许卡内推」——**正是判据想让人知道的事**——判据红。人会做的错事：把注释删掉（知识丢失），或把断言改宽（削弱判据）。 |
| **建议改法** | 改成**结构断言**，不锁缩进：`const iface = src.match(/defineProps<\{([\s\S]*?)\}>/)?.[1] ?? ''` 然后 `expect(iface).toMatch(/(?:^|\n)\s*totalTime\??:\s*number/)`。即「props 类型块里有一个名为 totalTime 的 number 字段」——用 `\s*` 吸收缩进、用 `[^\n]*` 吸收行尾注释。 |

#### A-2 `src/composables/__tests__/noNullRoundCc418.test.ts`（13 条同形）

| 栏 | 内容 |
|---|---|
| **判据位置** | :34 / :42 / :53 / :56 / :74 / :87 / :97 / :117 / :124 / :129 / :136，形态统一为 `toMatch(/export interface X \{[\s\S]*?\n  field: T\n/)` |
| **类别** | **A**（格式耦合）+ 附带**假阴性** |
| **Q1 它想防什么** | 「null 轮」概念退役：`SolveTeamResult.out` / `CalcRoundResult.stunPool` / `AgentNextRoundFeedbackInput.anomalyPool` 等**必须是必填非 null**——否则下游会重新长出「本轮可能没有结果」的分支，而那是一个**不存在的状态**（类型层承认它 ⇒ 死代码 + 误判）。 |
| **Q2 能否被无关改动满足/破坏** | **两个方向都中招**：① **无害改动就红**：实测给字段加 `readonly` ⇒ 红；字段换行/改缩进 ⇒ 红；把 `out` 的字段顺序调换（仍在同一接口内）⇒ 红。② **真正违规却仍绿**（假阴性）：实测把 `pool: StunPoolResult` 从 `PromoteFixpointResult` 搬进**文件里下一个接口** `PromoteFixpointDeps`，判据**仍然绿**（`[\s\S]*?` 不认花括号边界，跨接口也能匹配）。 |
| **Q3 有反证用例吗** | 无。这 13 条**没有一条**做过注入验证（对照：`axisOverlayOpaque` / `svgPresentationAttr` 都做了）。 |
| **为什么妨碍开发** | 加 `readonly`（更严的类型）会被判红——判据在**惩罚更安全的写法**。撞上后人的第一反应是「那我不加 readonly 了」，第二反应是「把正则改宽点」——两条路都在削弱。 |
| **建议改法** | 改成**按花括号配对取接口体**再判字段，并允许修饰符：`const body = sliceInterface(src, 'PromoteFixpointResult')` 然后 `expect(body).toMatch(/(?:^|\n)\s*(?:readonly\s+)?pool:\s*StunPoolResult\b/)`，其中 `sliceInterface` 从 `export interface X {` 起做花括号深度计数取到配对 `}`。这样 `readonly`/缩进/行尾注释都放行，**跨接口则取不到**（假阴性同时消失）。更好的替代：这条判据的本质是**类型必填**，`vue-tsc` 已经能表达——直接写编译期断言（`type _A = { out: CalcRoundResult } extends Pick<SolveTeamResult,'out'> ? true : never`），比源码锁可靠。 |

#### A-3（已修，留作口径参照）`src/mechanics/__tests__/typesSplitCc83.test.ts`

| 栏 | 内容 |
|---|---|
| **判据位置** | :24–25（2026-10-17 已订正） |
| **类别** | **A**（原形态）→ 现在是 **B**（见 §2.2 B-1） |
| **原形态** | `expect(src.split('\n').length).toBeLessThan(1400)`：文件以换行结尾时 split 多切一个空串 ⇒ 1399 行判成 1400 报红，**上限偷偷变成 1399，且取决于文件有没有末尾换行**。 |
| **现状实测** | 已改为先切再剔末尾空项：`types.ts` 实测 **1399 行**，上限 1400 ⇒ **余量只有 1 行**。末尾换行有无不再影响（实测两侧都是 1399）。 |
| **为什么仍要盯** | 上限只剩 1 行 ⇒ 任何**正常**的新类型都必然撞红，而 `types.ts` 有 **1017 行注释**（实测 `grep -cE '^\s*(//|\*|/\*)'`）——最廉价的「变绿」动作就是**删注释**。实测模拟：写回 6 行新类型 ⇒ 红；同时删 6 行注释 ⇒ **绿**。 |

### 2.2 B 类：只量规模/代理

#### B-1 `typesSplitCc83.test.ts:24–25`（行数）

| 栏 | 内容 |
|---|---|
| **判据位置** | `typesSplitCc83.test.ts:25` `expect(lineCount).toBeLessThan(1400)` |
| **类别** | **B** |
| **Q1 它想防什么** | 「新卫星类型别又写回 `types.ts`」——写回去会让共享类型文件重新变成万能桶，模块边界失效。 |
| **Q2 能否被廉价满足** | **能，而且只需要删注释**。实测：写回 6 行新 interface ⇒ 1405 行红；删 6 行 `//` 注释 ⇒ 1399 行**绿**。`types.ts` 有 1017 行注释可用。 |
| **Q3 有反证用例吗** | 只验了「三条转出还在」（`toContain("from './typesRows'")` 等），**没有**验「新类型不许住这儿」。 |
| **为什么诱导错误动作** | 撞上后最省事的修法就是删注释——注释里恰恰是「为什么这么拆」的口径（规则 16）。删完判据绿了，知识没了。 |
| **建议改法** | 把「行数」换成「**结构**」：① 断言 `types.ts` 里只允许出现白名单类型：`const exported = [...src.matchAll(/^export (?:interface|type) (\w+)/gm)].map(m=>m[1])`，再 `expect(new Set(exported)).toEqual(ALLOWED_CORE_TYPES)`（白名单显式登记，新增必须来改这里 ⇒ 强制一次「这个类型该住哪」的决策）。② 保留行数上限但**抬到 1500**，并同时断言「注释行数 ≥ 900」（防「删注释腾地方」）。①是主判据，②只是兜底。 |

#### B-2 `scripts/check-guards.mjs` `手册 §4 行数`（burn-down 条目 + `checkGuards.test.ts:1984`）

| 栏 | 内容 |
|---|---|
| **判据位置** | `guard-registries.mjs:104–107`（`frozen: 753 / target: 753`）+ `checkGuards.test.ts:1984` `expect(cur).toBeLessThanOrEqual(e!.frozen)` |
| **类别** | **B**（且**已经在逼人做无意义修改**，见 Top 5 #1） |
| **Q1 它想防什么** | 手册（`ENGINE_PIPELINE_GUIDE.md` §4）别退化成编年史——它该收「协议/口径/证据」，不该收逐日对账。 |
| **Q2 能否被廉价满足** | **能，且方向反了**。规则 16③ 要求「试过又放弃的方案必须写进 §4 坑条目的否决记录」⇒ **每次正确开发都可能 +N 行**，而 `frozen === target === 753` ⇒ **+1 行就红**。唯一出路是删别处的证据（违反规则 16③）或**上调 frozen**——历史已上调 **5 次**（`grep -c '上调 frozen'` = 5，`grep -c '并结算'` = 8）。 |
| **Q3 有反证用例吗** | 有（`cur < target` 时要结算），但**没有**「新增证据行」的合法路径。 |
| **为什么诱导错误动作** | 加了 2 行否决记录 ⇒ 红 ⇒ 人去**压缩同一条目里的实测数字**（正是规则 16③ 说「不许删」的东西）来凑回 753。这正是「逼人做无意义修改」的定义。 |
| **建议改法** | **把「行数」从判据改成「读数」**：① `checkGuards.test.ts` 里删掉 `expect(cur).toBeLessThanOrEqual(e.frozen)`，只保留 `Number.isFinite(cur)` + 把 `cur` 打进 `zc status`（与结构熵「量体温不治病」同款）。② 真正的防线改为**结构断言**：§4 每个坑条目必须含「症状/根因/判据」三栏；且禁止编年史形态（该区段内 `^\s*\d{4}-\d{2}-\d{2}` 行数 == 0 或 ≤ 已登记上限）。③ `frozen` 保留为「当前读数快照」，只在**结算**时更新，不再当红线。 |

#### B-3 `scripts/check-tokens.mjs` `alias ratchet`（`WA_REF_BASELINE` / `VAR_TOTAL_BASELINE`）

| 栏 | 内容 |
|---|---|
| **判据位置** | `check-tokens.mjs:671`（`WA_REF_BASELINE = 418`）/ `:717`（`VAR_TOTAL_BASELINE = 908`）/ 判定在 `:1223–1233` |
| **类别** | **B**（净额聚合） |
| **Q1 它想防什么** | 新代码别再直引 `--wa-*` 色阶（该用语义别名 `--fg-2`/`--line`），并且**不许把变量改回字面量**（那会冻在单主题）。 |
| **Q2 能否被廉价满足** | **能，净额吞掉退步**：同一提交里「1 处 `var()` 改回字面量（−1）」+「新功能加 2 处 `var()`（+2）」= 净 **+1** ⇒ 判据报的是「**是进步，把 VAR_TOTAL_BASELINE 上调到 X**」。字面量回退**完全不可见**，且判据**逼你去改基线数字**。 |
| **Q3 有反证用例吗** | 无。`checkTokens.test.ts:490` 只断言 `waRefs <= WA_REF_BASELINE`，**没有任何注入验证**证明「改回字面量会红」。 |
| **实测证据** | 近 60 个提交里 **53 个**碰过 `VAR_TOTAL_BASELINE`、**16 个**碰过 `WA_REF_BASELINE`（`git log -G`）。基线每两周动一次 ⇒ 它更像**记账本**而不是**护栏**。 |
| **建议改法** | 把净额换成**分文件、单向**的两个量：① `WA_REF_BASELINE` 保持（只减不增，方向正确）。② 删掉 `VAR_TOTAL_BASELINE`（总数只增不减的棘轮**语义上就是错的**：功能变多必然涨）。③ 新增**「字面量回退」检测**：对每个文件的 `var()` 计数做 per-file 棘轮（`VAR_PER_FILE`），**只许不变或增**；任何文件 `var()` 减少 ⇒ 红并点名「该文件少了 N 处 var()，是删了规则还是改回了字面量？」。这才是「不许改回字面量」的可执行形态。 |

#### B-4 `scripts/check-tokens.mjs` `hardcoded-color ratchet`（判据名与口径不符）

| 栏 | 内容 |
|---|---|
| **判据位置** | `check-tokens.mjs:519`（`HARDCODED_BASELINE`，33 个文件条目，合计 **101**）+ 判据名 `字面色值仅 3 处合法` |
| **类别** | **B**（标签误导，机制本身可用） |
| **Q1 它想防什么** | 字面色值别新增（新增 = 不跟随双主题 ⇒ 亮色档塌）。 |
| **Q2 能否被廉价满足** | 机制上**不能**（per-file 基线是正确形态）。但**判据名说「仅 3 处合法」，实测合计 101** ⇒ 读者会以为「已经有 3 处豁免、其余都干净」，实际是「101 处存量、每文件不许超过自己的历史值」。 |
| **Q3 有反证用例吗** | 无专门注入；但 per-file 双向判定（`>baseline` 红 / `<baseline` 也红要求下调）是有效的。 |
| **建议改法** | ① 判据名改成 `hardcoded-color ratchet (UI_THEME_GUIDE §1: 字面色值按文件只减不增) 合计 101`——**别写「仅 3 处」**。② 加一条**基线条目腐烂检查**：`HARDCODED_BASELINE`/`FONT_SIZE_BASELINE` 里指向不存在文件的条目 ⇒ 红（与 `DEAD_CHANNEL_ALLOWLIST` 的 stale 同款）。实测当前 0 条腐烂，属预防。 |

#### B-5 `scripts/lib/settings-coverage.mjs:201`（「有测试」= 文本 includes）

| 栏 | 内容 |
|---|---|
| **判据位置** | `settings-coverage.mjs:201`：`if (!allTests.includes(id)) untested.push(...)` |
| **类别** | **B**（代理指标：文本出现 ≠ 生效测试） |
| **Q1 它想防什么** | 每个滑块都必须有「**改了确实变**」的测试——否则滑块是死的（般岳 `rageGainCoverage` 曾静默失效）。 |
| **Q2 能否被廉价满足** | **能**：任何 `.test.ts` 里**出现该 id 字符串**就算「有测试」，包括：注释、断言 message、文档串、`expect(x).toBe(0)` 这种根本没拨滑块的引用。实测 182 个 id 里 **109 个**的引用行**不含任何消费形态**（`setMechanicSetting`/`settings:`/`adjustable`）。反例实测：`piper.momentumCoverage` 的「测试」之一是 `zcBrief.test.ts`——那是在测**检索器能不能抽到这个词**，与滑块是否生效**零关系**。 |
| **Q3 有反证用例吗** | 有**部分**：`checkGuards.test.ts` 的「反向验证：setMechanicSetting 恒写 0 ⇒ 21/21 全红」证明了 `adminRulingEffect.test.ts` 那批**是真的**。但那是**那批**的质量，不是**判据**的判别力。 |
| **建议改法** | 把「文本出现」换成「**调用形态**出现」：该 id 必须出现在 `setMechanicSetting(...)` 的实参位或 `settings: { '<id>': ... }` 的键位。再加一条**判别力下限**：补测必须伴随一次「三点比例性」断言（现有 `adjustableEffect.test.ts` 已有此形态，把它变成判据而不是约定）。⚠ 这会一次性把 109 条打成「待复核」——正确处置是**先分诊**（哪些是真消费、哪些只是字面串），再决定补测试还是改判据口径。 |

#### B-6 `scripts/check-guards.mjs` `手册密度棘轮`（`MANUAL_DENSITY_CEILINGS`）

| 栏 | 内容 |
|---|---|
| **判据位置** | `check-guards.mjs:471`（`MANUAL_DENSITY_CEILINGS`）+ `:479`（`scanManualDensity`） |
| **类别** | **B**（分母可被廉价放大；仓库已在 `@fact` 里自认此局限） |
| **Q1 它想防什么** | 手册别退化成编年史——案例叙事该进 git 历史与 `.claude/` 账本，手册只留协议/口径/证据。 |
| **Q2 能否被廉价满足** | **能**：分母是**全文行数**，加空行/加不含 id 的散文都能稀释。实测 `GAME_TERM_TO_CODE_FIELD.md` 现状 density **0.1567**、天花板 0.16 ⇒ 余量仅 **0.0033**。加 10 行空行 ⇒ 0.153（更绿）；反过来**删掉末尾换行**会让 density 变大（更容易红）。也就是说：**这条判据对「加空行」与「写证据」的反应方向相同**。 |
| **Q3 有反证用例吗** | 有口径用例（`checkGuards.test.ts:1955` 用 fixture 验证 4 hits / 7 lines = 4/7），但**没有**「加编年史行会红」的注入验证。 |
| **为什么低优先** | 仓库**已经自认**这条局限：`@fact engine:guards/手册密度` 原文写「拆薄后反升属口径性质」，且把**还款面**改成了 §4 行数。⇒ 它不是「假装有牙」，而是「明确标注了牙口方向」。 |
| **建议改法** | 若将来要收紧：把分母从「全文行数」改成「**非空行数**」（空行不再能稀释），并把分子限定为「**编年史形态行**里的 id 命中」（形如 `auto-<id>-<id>-<id>` 的打包行），而不是全文任何 4 位数字。这样「加证据」不涨分子、「加编年史」必涨。**本轮不建议动**（低收益 + 仓库已自认）。 |
### 2.3 C 类：断言太弱 / 失效

#### C-1 `scripts/check-tokens.mjs:1166 / :1175`（contrast 缺令牌静默跳过）

| 栏 | 内容 |
|---|---|
| **判据位置** | `check-tokens.mjs:1166` `if (!tokens.has(name)) continue` / `:1175` 同形 |
| **类别** | **C**（该红时不红） |
| **Q1 它想防什么** | 关键前景/背景对必须达 WCAG AA（正文 4.5 / 图表 3.0）——明亮模式白底白字的机器兜底。 |
| **Q2 能否被廉价满足** | **能**：令牌被改名/删除时，判据**静默跳过**而不报错。实测删掉 `--c-chart-9` ⇒ 受检对数 15 → **14**，判据仍绿、**无任何下限断言**。`tokens-defined` 会抓到「引用了未定义令牌」，但**抓不到「该被检查的令牌名写错了」**——因为 `CONTRAST_CHART_PAIRS` 里的名字不是 `var()` 引用。 |
| **Q3 有反证用例吗** | 有（`checkTokens.test.ts:438/463` 用修复前的真实值做注入，会红）。但那是**值**的反证，不是**清单**的反证。 |
| **建议改法** | 加一条反空洞下限：`const checked = [...CONTRAST_TEXT_PAIRS, ...CONTRAST_CHART_PAIRS].filter(n => tokens.has(n)).length`，低于 `CONTRAST_PAIRS_MIN = 15`（实测值，只减不增地冻结）就红。并在 `checkTokens.test.ts` 加「删一个 chart 令牌 ⇒ 判据红」的反证。 |

#### C-2 `RATCHET_BURNDOWN` 的 `core 角色名中缀/子目录`（measure 缺失 ⇒ 永久静默）

| 栏 | 内容 |
|---|---|
| **判据位置** | `guard-registries.mjs:224`（条目）+ `zc.mjs:957–995`（`measured` 映射**没有这个 id**） |
| **类别** | **C**（存在但判不了） |
| **Q1 它想防什么** | 标识符/子目录不许带角色名（`computeLiuyinHugCounts` 这类）——它防的是「角色知识回流到编排层」。 |
| **Q2 能否被廉价满足** | **不是满足，是彻底失效**：`measured[id]` 为 `undefined` ⇒ `computeBurndown` 收到 `NaN` ⇒ `current=NaN`、`done=false`、`stale=false`、`remaining=NaN`。实测（今天 `2026-10-17` 与 `2027-06-01` 两个日期都跑过）：该条目**永远不会被 `zc status` 点名**，无论到期与否。 |
| **Q3 有反证用例吗** | 有「存在性」用例（`checkGuards.test.ts:2080` 断言 `frozen === CORE_ROLE_INFIX_BASELINE`），但**没有**「每个 id 都有 measure」的断言。`checkGuards.test.ts:1975` 只对 `手册 §4 行数` **单个 id** 做了「id 出现在 zc.mjs」的检查。 |
| **为什么该修** | 这是**唯一一条真的瞎了的判据**：它自称有 due（`2026-12-31`）、有 plan、有 frozen，实际从不报警。 |
| **建议改法** | ① 在 `checkGuards.test.ts` 加全量断言：`for (const e of RATCHET_BURNDOWN) expect(zcSrc, e.id + ' 缺 measure').toContain("'" + e.id + "'")`。② 在 `zc.mjs` 的 `measured` 里补 `'core 角色名中缀/子目录': () => g.scanCoreRoleInfix(root)?.count ?? NaN`。③ `computeBurndown` 对 `NaN` 应**显式报错**而不是静默：让「量不出来」在 `zc status` 里露头。 |

#### C-3 `toBeGreaterThanOrEqual(0)`（48 处，恒真）

| 栏 | 内容 |
|---|---|
| **判据位置** | 代表：`src/mechanics/__tests__/inStunAttribution.test.ts:49–50`：`expect(el.triggerCount).toBeGreaterThanOrEqual(0)` / `expect(el.avgCoverage).toBeGreaterThanOrEqual(0)` |
| **类别** | **C** |
| **Q1 它想防什么** | 表面上是「覆盖率在 [0,1]、次数非负」的合理性检查。 |
| **Q2 能否被廉价满足** | **恒真**——`triggerCount` 是计数、`avgCoverage` 是比例，除非代码写出 `-1`，否则永真。同一循环里的 `toBeLessThanOrEqual(1)` 才有牙（能抓「覆盖率算成 1.3」），而 `>= 0` 抓不到任何真实缺陷。 |
| **Q3 有反证用例吗** | 无。这 48 处**没有一处**有配套的注入验证。 |
| **为什么该修** | 它们**增加用例数、降低信噪比**：一个恒真断言会让「这个文件 10 个 it 全绿」看起来像 10 项保障，实际只有 6 项。 |
| **建议改法** | 逐处替换为**有判别力的形态**：① `triggerCount` ⇒ `expect(el.triggerCount).toBeGreaterThan(0)`（既然测试前提是「轴内两次触发」，0 就是失败）；② `avgCoverage` ⇒ `toBeCloseTo(期望值, 2)` 或至少 `toBeGreaterThan(0.01)`；③ 无法给出期望值的 ⇒ **删掉**（少一条恒真断言比多一条好）。同类还有 `toBeGreaterThan(0)` 的 734 处——不必全改，但**每处都应回答「什么值会让我红」**；答不出的就是 C。 |

### 2.4 口径正确、无需改动（防止下一个人误删）

见 §4。

---


## 3. 最妨碍开发的 Top 5（按「会逼人做多少无意义修改」排序）

### #1 `手册 §4 行数`（`frozen === target === 753`）

- **什么样的正常改动会撞上**：修完一个坑，按规则 16③ 在 §4 该坑条目里补 2 行「否决记录」。这是**规则强制要求**的动作。
- **撞上后**：`checkGuards.test.ts:1984` 红（`754 > 753`）。人会做三件错事：
  1. 压缩同条目里的**实测数字**（规则 16③ 明令不许删）；
  2. 把否决记录写进 `.claude/`（那里 gitignore，下一个 agent 看不到）；
  3. 上调 `frozen`——历史上已经这么干了 **5 次**（`grep -c '上调 frozen'` = 5）。
- **量级**：规则 16③ 每触发一次就要改一次数字，是**最高频**的「被迫改无关物」。
- **正解**：见 §2.2 B-2（改成读数 + 结构断言）。

### #2 `alias ratchet` 的 `VAR_TOTAL_BASELINE`（净额）

- **什么样的正常改动会撞上**：任何新增 UI 功能（加卡片/加图表）都会增加 `var()` ⇒ `varTotal > 908` ⇒ 红，报错话术是「**是进步，把 VAR_TOTAL_BASELINE 上调到 X**」。
- **撞上后**：改基线数字。实测近 60 提交里 **53 个**动过它——这不是护栏，是**每次都要抄一遍的计数器**。
- **真正的风险**：同一提交里若有 1 处 `var()` 被改回字面量，会被净额吞掉（+2 新功能 −1 回退 = +1 ⇒ 「进步」）。
- **正解**：见 §2.2 B-3（per-file 单向棘轮）。

### #3 `noNullRoundCc418` 的 13 条格式锁

- **什么样的正常改动会撞上**：给接口字段加 `readonly`（更安全）、调整字段顺序（可读性）、给字段补 JSDoc（知识）。
- **撞上后**：13 条里对应那条红，报错信息是「expect(received).toMatch(...)」+ 一大段正则——**读者看不出是格式问题**，只会觉得「这个判据很脆」。人的反应通常是「把正则改宽」⇒ 判据被逐步削弱，而它原本要防的「null 轮复活」**反而更容易漏**（因为 `[\s\S]*?` 本来就跨接口误匹配，见 A-2）。
- **附带**：`battleTimeDisplaySingleSource:19` 同款（加行尾注释就红）。
- **正解**：见 §2.1 A-1/A-2（按花括号配对取接口体 + 允许修饰符）。

### #4 `typesSplitCc83` 的 1399/1400（余量 1 行）

- **什么样的正常改动会撞上**：任何新增共享类型（哪怕只是加一个 `interface` 的 6 行）。
- **撞上后**：`types.ts` 有 1017 行注释，最省事的修法是**删 6 行注释**（实测这样就能从 1405 回到 1399 绿）。而这些注释正是「为什么拆 / 谁该住哪」的口径。
- **为什么排第 4 而不是第 1**：撞上的频率低于 #1（新类型不像否决记录那样每次开发都写），但**一旦撞上，诱导的动作更破坏性**（删知识）。
- **正解**：见 §2.2 B-1（结构白名单 + 注释行数下限）。

### #5 `settings coverage` 的「文本 includes」

- **什么样的正常改动会撞上**：**不会撞红，而是该红不红**——所以它不进「妨碍开发」，但进「虚假安全感」。
- **具体场景**：新加一个滑块，只要在任意测试文件里写一句 `// TODO: 测一下 foo.barBaz`，判据就认为「已测」⇒ `newGaps` 为空 ⇒ 绿。实测 182 个 id 里 **109 个**的引用不含消费形态。
- **为什么仍列 Top 5**：它是**规则 5「每个机制 = spec 字段 + 生效测试」的唯一机器面**，它失效等于规则 5 无护栏。而它「看起来」很强（有 182/182 的读数、有反空洞下限、有 frozen 同步锁）。
- **正解**：见 §2.2 B-5。

> **落选但值得一提**：`contrast` 的缺令牌静默跳过（C-1）与 `core 角色名中缀` 的 measure 缺失（C-2）。
> 前者是「该红不红」但**当前 15/15 全在**（没有实际损失），后者是**唯一真瞎**的判据但只影响一条 burn-down 提醒。
> 两条都该修，但都不如 Top 5 那样**每天**制造摩擦。

---

## 4. 「看着像表面功夫、实际有牙」的判据（防止误删）

这一节是**反向清单**：以下判据形态上像 B/C，实测**有判别力**，**不要**以「只是量规模/只是非空」为由删掉或削弱。

| 判据 | 为什么看起来像表面功夫 | 为什么实际有牙（证据） |
|---|---|---|
| **反空洞下限**（22 个 `*_MIN_*`，18 条判据生效） | 「量扫描面大小」= 典型的规模指标 | 它们防的是**扫描器失明伪装成进步**。实测：`scanScopedStyleReach` 在空仓库返回 `skip='no-src'` 且 0 违规；`scanCompactedSlotIndex` 在空仓库返回 `scanned=0` 且 0 违规；`scanSvgPresentationAttr` 在空仓库返回 0 违规。**没有下限的这三条判据，在扫描面塌陷时全绿**。带下限的 18 条则会红。<br>⚠ 反例：判据 31（SVG 呈现属性）与判据 17（compacted slot）**目前仍无下限**——见 §6 建议。 |
| **`NOUN_SOURCE_MIN_KEYS = 141`** | 一个数字，像拍脑袋 | 防的是「把源文件清空成 `{}` ⇒ 无项可审 ⇒ 全绿」这条最廉价的假绿通道。实测清空源 ⇒ `missing/extra/unhandled` 全空。 |
| **`AGENT_BRANCH_MIN_FILES = 15`** | 同上 | 实测把度量面收窄到单文件（24→1）时 count 仍为 0、判据仍绿——**这正是 2026-10-06 用户质询后补的**。 |
| **detector 自证**（`selfTest`，7 条判据） | 「测自己的检测器」像是自娱自乐 | `json-dup-keys` 的自证是**判别性 fixture**（同对象重复必报 / 不同对象同名必不报）；`id-literal-gate` 的自证覆盖「注释/URL/无引号/5 位 prop/7 位 moveId」五类不该报的形态。**少了任一半，判据要么误伤要么形同虚设**。 |
| **`TINTED_LITERAL_ALLOW_SET` 的 stale 检查** | 一个只有 1 条的豁免表 | `checkTokens.test.ts:495` 断言「被豁免的选择器必须仍存在且仍含字面量」——豁免腐烂（改名后指向空气）会红。**这是豁免表唯一的防腐机制**，删了豁免就变永久橡皮图章。 |
| **`IDX_SAFE_ALLOWLIST` 的逐条验证** | 3 条豁免，像噪音 | `compactedSlotIndex.test.ts:130` 断言每条豁免「文件存在 + 写法仍在 + reason > 20 字」。**没有它，豁免会静默腐烂成永久豁免**。 |
| **`timeGolden` / `timeFillRatchet` 基线** | 「快照 = 死数据」 | 按仓库规则 10 它们是**测量工具不是开发否决权**。它们抓的是「这次改动动了什么」——实测 `c3/c4` 命座盲区就是靠扩测量面发现的（注入 `cinema >= 3 ? 2.5 : 0` ⇒ 旧口径 3 条全绿，新口径 26 条红）。**不要建议削弱或删除**。 |
| **`docs table`（README §6 == docs/**.md）** | 「文档数量」= 形式主义 | 实测它**递归到子目录**（2026-10-06 修）：`docs/proposals/*.md` 曾因只扫顶层而长期不在表内 = agent 找不到。它还校验**所有**份数自述（标题 + 表尾），抓的是 2026-09-11「标题 11 份 / 表尾 10 份 / 实际 13 份」那次事故。 |
| **`RATCHET_BURNDOWN` 的 `frozen ⇔ 基线常量` 双向锁** | 「两处数字相等」像仪式 | 实测 R44 踩过：改了 `AGENT_BRANCH_BASELINE` 漏改 `frozen` ⇒ `check-guards` **19/19 全绿**而 `npm run verify` 红。这条锁是**唯一的跨文件一致性保证**。 |
| **`fetch-stub freeze` 的「清单与现状集合相等」** | 清单为空（`FETCH_STUB_ALLOWLIST = []`），像死代码 | 「漏删即红」的集合相等判定，防的是「迁移了一个但清单没删 ⇒ 清单变死数据」。**空清单 ≠ 判据失效**（与 `SETTINGS_UNTESTED_BACKLOG = []` 同理，机制保留）。 |
| **`手册密度棘轮` 的「拆薄后反升」结论** | 一个反直觉的读数，像 B 类（见 §1.2 ⑤） | 但**它的存在本身有牙**：它证明了「拿密度当还款目标会奖励灌水」，而且**仓库自己把这条局限写进了头注释**（`ENGINE_PIPELINE_GUIDE` 的 `@fact engine:guards/手册密度`）。修法应是**换指标**（见 §2.2 B-6），不是删判据。 |

---

## 5. 「不该动」的完整清单（本轮明确不建议修改）

按用户裁决与本轮实测，以下**一律不动**：

1. **基线快照类**：`src/composables/__tests__/timeGolden.baseline.json`、`timeFillRatchet.baseline.json`
   —— 规则 10：测量工具不是开发否决权。**本轮未读、未改、未建议改**。
2. **反空洞下限**：`NOUN_SOURCE_MIN_KEYS` / `AGENT_BRANCH_MIN_FILES` / `EXHIBITION_LAYER_MIN_FILES` /
   `CORE_ROLE_IMPORT_MIN_FILES` / `ROLE_MODULE_DEP_MIN_FILES` / `CORE_ROLE_SCAN_MIN_FILES` /
   `LEVEL60_MIN_COMPARED` / `AUTHORED_FACTS_MIN_SCANNED` / `SETTINGS_COVERAGE_MIN_MODULES` /
   `LAYER_INVERSION_MIN_TOTAL_SITES` / `ID_LITERAL_MIN_FILES` / `LITERAL_ASSERTION_MIN_FILES` /
   `DEAD_NULLISH_MIN_FILES` / `TYPE_RESTATEMENT_MIN_FILES` / `FIELD_WRITER_MIN_FILES` /
   `RECORD_KEY_MIN_SCANNED_FILES` / `JSON_DUP_SCAN_MIN_FILES` / `MOVE_ELEMENT_MIN_SCANNED` /
   `DOCS_READING_MIN_TESTS` / `DOCS_READING_MIN_SCANNED`
   —— 全部有实测标定（见 §4 表），且多数带「掉到下限以下 = 扫描器坏了，先修扫描器」的报错话术。
3. **detector 自证**（`selfTest`）：7 条判据的自证位。删了等于把「检测器坏了」与「真的干净」混为一谈。
4. **`RATCHET_BURNDOWN` 的 frozen/due/plan 契约**：除 C-2 的 measure 缺失外，结构本身是对的。
5. **`timeGolden`/`timeFillRatchet` 的更新纪律**（规则 10 四步）：不动。

---

## 6. 修复优先级建议（下一轮可直接开工的卡片）

| 优先级 | 卡片 | 改动面 | 验证方式 |
|---|---|---|---|
| **P0** | C-2：给 `core 角色名中缀/子目录` 补 measure + `computeBurndown` 对 NaN 报错 | ✅ 2026-10-30 已落地：度量映射抽成 `scripts/zc.mjs#burndownMeasures`（补该键 + 闭类断言）、`computeBurndown` 标 `measureBroken`、`zc status` 打「measure 断了」 | 实测：`status --json` 该条 `measured null→0` / `done false→true`；**删一个键 ⇒ 用例红 + status 报警**；11 条读数全有限 |
| **P0** | B-3：`VAR_TOTAL_BASELINE` → per-file 单向棘轮 | `check-tokens.mjs`、`checkTokens.test.ts` | 注入「某文件 var() 减少」⇒ 红 |
| **P1** | B-2：`手册 §4 行数` 从判据降为读数 | ✅ 2026-10-30 已落地：判据 34 `scripts/lib/guide-entry-budget.mjs` + `guard-registries.mjs` + `checkGuards.test.ts` | 加 1 行否决记录 ⇒ **不红**（已按此验收）；加编年史行 / 新增超标条目 ⇒ 红 |
| **P1** | A-1/A-2：格式锁改结构锁（按花括号配对 + 允许修饰符） | `battleTimeDisplaySingleSource.test.ts`、`noNullRoundCc418.test.ts` | 加 `readonly` / 改缩进 ⇒ 绿；跨接口搬字段 ⇒ **红** |
| **P2** | B-1：`typesSplitCc83` 加结构白名单 + 注释行数下限 | 该测试文件 | 写回新类型 ⇒ 红；删注释腾地方 ⇒ 红 |
| **P2** | C-1：contrast 加 `CONTRAST_PAIRS_MIN` | `check-tokens.mjs`、`checkTokens.test.ts` | 删一个 chart 令牌 ⇒ 红 |
| **P3** | B-5：`settings coverage` 改「调用形态」匹配 | `settings-coverage.mjs`、`checkGuards.test.ts` | 只在注释里提 id ⇒ 红；真 `setMechanicSetting` ⇒ 绿 |
| **P3** | C-3：`toBeGreaterThanOrEqual(0)` 逐处替换或删除 | 48 处（代表 `inStunAttribution.test.ts`） | 每处回答「什么值会让我红」，答不出即删 |
| **P3** | 补两条缺下限的判据：判据 31（SVG）、判据 17（compacted slot） | `svg-presentation-attr.mjs`、`compacted-slot-index.mjs` | 空仓库扫描 ⇒ 红（现在绿） |

> ⚠ 所有卡片都遵守「**不为变绿而改判据**」：每条都附**注入验证**（改前红、改后绿、反向再红），
> 且 P0/P1 落地时必须跑一次 `npm run check-guards` + `npx vitest run src/scripts/__tests__` 证明没削弱其它判据。

---

## 7. 审计过程留痕（可复现）

```bash
# 基线
git rev-parse --short HEAD            # ad9670cb
npm run check-guards                  # 31 guard checks passed
npx vitest run src/scripts/__tests__  # 25 files / 556 passed

# A 类实测（格式锁）
# 1) battleTimeDisplaySingleSource：给 totalTime 加行尾注释 ⇒ 红（实测 1 failed）
# 2) noNullRoundCc418：加 readonly / 改缩进 ⇒ 红；把 pool 搬进下一个接口 ⇒ 仍绿（假阴性）
# 3) typesSplitCc83：写回 6 行类型 ⇒ 1405 红；删 6 行注释 ⇒ 1399 绿

# B 类实测
# 4) VAR_TOTAL_BASELINE：wa=418 / var=908 与基线相等；规则是「< 红 / > 也红（叫你去上调）」
# 5) §4 行数：countGuideSection4Lines() = 753 == frozen == target
# 6) settings coverage：182 id 里 109 个的引用行不含消费形态

# C 类实测
# 7) contrast：删 --c-chart-9 ⇒ 受检对数 15→14，判据仍绿（无下限）
# 8) burndown：computeBurndown(id => NaN) ⇒ current=NaN / done=false / stale=false（永不点名）

# 反空洞（不该动）
# 9) scanScopedStyleReach(空仓库) = {violations:0, defs:0, consumers:0, skip:'no-src'}
# 10) scanCompactedSlotIndex(空仓库) = {violations:[], scanned:0}
# 11) scanSvgPresentationAttr(空仓库) = []   ← 三者都 0 违规，只有 scoped 有下限
```

**未做**：本轮**没有**修改任何判据、基线或源码；工作树在审计前后均为干净（`git status --porcelain` 空）。
**基线文件**：`timeGolden.baseline.json` / `timeFillRatchet.baseline.json` 未读未改。

---

## 8. 附：`RATCHET_BURNDOWN` 11 条的 frozen 与实测对照

| id | frozen | 实测 current | 状态 |
|---|---|---|---|
| agentId 分支 | 0 | 0 | done |
| core agentId 分支 | 0 | 0 | done |
| core 角色模块引用 | 0 | 0 | done |
| 展示层越层 import | 1 | 1 | done（target=1，永久保留 1 处） |
| 手册 §4 行数 | 753 | 753 | done（**但这是 B-2 的问题所在**） |
| 游戏语义口径复核触发器 | 82 | 75 | 有进展（allowlist 75 + missing 0） |
| 死通道豁免清单 | 1 | 1 | 未动 |
| 名词表未处理 | 59 | 59 | 未动（deferred 59 / unhandled 0） |
| 滑块生效测试存量 | 0 | 0 | done |
| core 角色前缀字段 | 0 | 0 | done |
| **core 角色名中缀/子目录** | 0 | **NaN** | **失效（C-2）** |

> 「frozen 是否等于实测值」：**11 条里 8 条**有显式同步锁（实测值全部相等）；其余 3 条当前也相等但**没有锁**（见下）。
> 「有没有为变绿而调基线的痕迹」：**有，但都是合规的**——`VAR_TOTAL_BASELINE` 的 53 次变动都附了归因注释
> （「纯删除」「同值令牌化」「新增语义别名」），`WA_REF_BASELINE` 的 16 次同理。真正的问题是**机制**（净额）
> 而不是**纪律**（每次都写了理由）。

> **补一条本轮新发现的口径缺口（不单列 A/B/C，属「契约覆盖不全」）**：
> `RATCHET_BURNDOWN` 的「frozen ⇔ 基线常量」双向锁**只覆盖 11 条里的 5 条**——
> `agentId 分支`(:541) / `core agentId 分支`(:542) / `展示层越层 import`(:543) / `core 角色前缀字段`(:2041) / `core 角色名中缀·子目录`(:2080)，
> 外加 `死通道豁免清单`(:1583) 与 `名词表未处理`(:467) 用各自的实测函数锁。
> **没锁的 3 条**：`core 角色模块引用`（`CORE_ROLE_IMPORT_BASELINE`）/ `游戏语义口径复核触发器`（`CALIBER_TRIGGER_ALLOWLIST.length`）/ `滑块生效测试存量`（`SETTINGS_UNTESTED_BACKLOG.length`）。
> 当前三条的 frozen 与常量**恰好相等**（实测 0 / 82 / 0），所以今天没有红；但下一次有人「只改常量不改 frozen」时，
> 这条棘轮会**静默用旧基线算 progress**。建议把 §2.3 C-2 的「全量 id 有 measure」断言**一并扩成「全量 id 有 frozen 同步锁」**。

---

## 9. 落地记录（2026-10-17，本轮实做）

§2.2 B-1 / A-3 的 `typesSplitCc83` 问题已**修完**，判据换形态。这一节记录做了什么、为什么这么做、怎么证明它现在有牙。

### 9.1 先纠正三个数（实测 vs 任务书）

| 说法 | 实测 | 说明 |
|---|---|---|
| `AgentMechanicModule` 单块 796 行 | **793 行**（599–1391，占 56.7%） | 差 3 行，量法差异 |
| 内含 5 个内联字面量形状 | **6 个** | `backstageAutoFill` / `axisRageCombos` / `releaseShare` / `teammateSplit` / `axisGashResource` / `finalizePass` |
| 拆掉能省 52 行 | **103 行** | 之前只数形状体，漏了成员自己的文档注释（38 行里 20 行是注释） |

**最关键的一条实测**：这 793 行里**只有 152 行代码（19.2%）**，注释 639 行（80.6%）；整个 `types.ts` 是 350 行代码 / 1017 行注释。
⇒ 「把 793 行搬到新文件」只是**搬注释**，属于仓库明令禁止的「搬家骗尺」（`layer-import-ratchet.mjs` 头注释的先例：特判跟着代码搬，标称 −45 实为净 0）。
所以**没有**整体搬迁，而是按判据 29③ 的口径给形状起名、搬进 `typesHooks.ts`。

### 9.2 做了什么

| 动作 | 位置 | 效果 |
|---|---|---|
| 6 个内联形状起名 | `typesHooks.ts` 末尾新增 `BackstageAutoFillSpec` / `AxisRageCombos` / `ReleaseShareSpec` / `TeammateSplitSpec` / `AxisGashResourceSpec` / `FinalizePassSpec` | 成员从 103 行内联体变成 6 行引用 |
| `AgentMechanicModule` 改用具名类型 | `types.ts:641/797/909/916/1044/1344` | `backstageAutoFill?: BackstageAutoFillSpec` 等 |
| 转出补齐 | `types.ts` import + `export type` 两块 | 导入方仍写 `from '@/mechanics/types'`（CC-83 的兼容承诺不变） |
| 删掉不再用的 import | `types.ts:12` `NumericCfgField` | 已随形状搬走 |
| **判据换形态** | `typesSplitCc83.test.ts` | 见 §9.3 |

行数：`types.ts` **1399 → 1352**（−47），`typesHooks.ts` 659 → 763（+104）。

### 9.3 判据换了什么形态（这是本轮的重点）

原判据 `expect(lineCount).toBeLessThan(1400)` 的问题不是换行（那个 2026-10-17 已修），而是**它答不了「新类型有没有写回 types.ts」**：
实测写回 6 行新 interface ⇒ 1405 红；**同时删 6 行注释 ⇒ 1399 绿**。而注释里是「为什么这么拆」的口径（规则 16）⇒ 判据在**奖励删知识**。

新形态 = **结构白名单**（主）+ 行数天花板（粗兜底）+ 注释密度下限（防删注释）：

| # | 断言 | 防什么 |
|---|---|---|
| ① | `types.ts` 的 `export interface/type` 名字集合 **== `TYPES_TS_DECLARATIONS`**（24 个显式登记） | 新类型写回 ⇒ 红，强制一次「该住哪」的决策 |
| ② | 三条 `export … from './typesRows'/'./typesHooks'/'./typesView'` 仍在 | 拆出去后删转出 ⇒ 导入方全炸 |
| ③ | 行数 ≤ 1400（实测 1352，余量 48） | 粗兜底，**不再承担**「该不该拆」的判断 |
| ④ | 注释行 ≥ 950（实测 995） | 「删注释腾地方」这条最廉价的变绿路径 |
| ⑤ | 6 个形状必须是具名引用（`^  field\?: TypeName$`），且类型定义在 `typesHooks.ts` | 内联字面量写回去 ⇒ 红 |

### 9.4 反证（该红的时候真的会红）

四条注入全部实测，**每次都先备份再恢复**：

| 注入 | 结果 |
|---|---|
| A：在 `types.ts` 加 `export interface NewSatelliteType {}` | **①红** ✅ |
| B：删 120 行块注释内部行（模拟删注释腾地方） | **④红**（877 < 950）✅ |
| C：删掉全部 `export … from './typesRows'` | **②红** + 转出用例红 ✅ |
| D：只删一条 `typesRows` 转出 | **仍绿** ⚠ 见下 |

**注入 D 暴露了判据自己的一个假阳性**：第一版 ② 写的是 `expect(src).toContain("from './typesRows'")`，
而 `types.ts` 顶部还有 `import … from './typesRows'` ⇒ **删掉转出仍绿**。已改成只认 `^export …\{…\} from '<p>'` 行，
并且 `typesRows` 有两条转出行（`export type` + `export {}`），只删一条仍绿——这是**正确的**（符号仍可导入），
只有全删才红。这条记为「判据自证时发现的判据缺陷」，不是放宽。

### 9.5 没做的事（及理由）

| 候选 | 决定 | 理由 |
|---|---|---|
| 把 `AgentMechanicModule` 整体搬到 `mechanics/module.ts` | **不做** | 它的传递闭包是 **21 个类型 / 1255 行**，剩下只有 24 行 ⇒ 拆完 `types.ts` 是个 2 类型的空壳，而 `module.ts` 变成新的 1255 行大文件 = 把问题搬家。且 793 行里 80.6% 是注释，搬的是注释不是代码。 |
| 把 793 行按能力族切成 5-6 个文件 | **不做** | 成员之间共享 18 个本文件类型 + 57 个外部导入，切分会制造大量交叉 import；且真正的成本在注释量，不在文件数。**若将来要做，判据 ⑤ 已经为「形状必须具名」铺好路**。 |
| 拆 `axisRageCombos` / `releaseShare`（各 2 成员，低于判据 29③ 门槛） | **做了** | 它们与其余四个同族（都是模块往接口上挂的声明），留着内联会让「哪些是形状、哪些是标量」看不出来。 |

### 9.6 验证

```bash
npm run check-guards                     # 31 guard checks passed
npm run check-tokens                     # 15 token checks passed
npx vue-tsc -b                           # exit 0（形状搬迁零类型漂移）
npx vitest run src/mechanics/__tests__/typesSplitCc83.test.ts   # 5 passed
npx vitest run                           # 全量（见 §9.7）
```

**行为零变化**：本轮只动类型声明与测试，未触碰任何运行时逻辑（`typesHooks.ts` / `types.ts` 全是 `export interface` / `import type`，运行时被擦除）。

### 9.7 全量套件（最终）

```
npx vitest run
 Test Files  556 passed | 15 skipped (571)
      Tests  4866 passed | 29 skipped (4895)
exit=0
```

（第一次跑是 `1 failed | 4865 passed`，失败项就是 §9.8 的 6 条死导出；修完复跑全绿。）

### 9.8 全量套件抓到的一处真问题（判据立功，不是误报）

第一次全量 `vitest run` 报了 **1 failed**：

```
FAIL  src/scripts/__tests__/deadChannelLs.test.ts > ⑫ 仓库级：全 src 死导出为空
AssertionError: 死导出：接上生产消费者，或删掉
+ [
+   "src/mechanics/types.ts AxisGashResourceSpec (reexport)",
+   "src/mechanics/types.ts AxisRageCombos (reexport)",
+   "src/mechanics/types.ts BackstageAutoFillSpec (reexport)",
+   "src/mechanics/types.ts FinalizePassSpec (reexport)",
+   "src/mechanics/types.ts ReleaseShareSpec (reexport)",
+   "src/mechanics/types.ts TeammateSplitSpec (reexport)",
+ ]
```

**判据是对的**：我把 6 个类型从 `types.ts` 转出，但它们的唯一消费者是 `AgentMechanicModule` 自己（在 `types.ts` 内部 import 使用），
外部没有任何生产消费点 ⇒ 转出 = 死导出。这正是「接口在、实现没接」那条判据要拦的形状。

**修法**：从 `types.ts` 的 `export type { … }` 里删掉这 6 个（保留 `import type`，`AgentMechanicModule` 仍能用），
类型定义本身留在 `typesHooks.ts`（导出，因为将来消费方——门面 / 引擎执行器——要用名字标注时直接可用）。

⇒ 这条记录的价值：**结构白名单（新判据 ①）与死导出判据是互补的**——前者管「类型住在哪」，后者管「导出的东西有没有人用」。
两者都绿才说明拆分是干净的。
