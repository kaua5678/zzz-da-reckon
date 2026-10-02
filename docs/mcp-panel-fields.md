# PanelValues 未声明字段盘点（r400 / CC-374）

> lane arena-E · 2026-10-02 第 400 轮。代码提交 `823b7261`（删 9 个零读者字段）。
> 复跑：r402 起不再需要。签名收紧后 vue-tsc 本身就是这份盘点，脚本已删（回滚：`git show 1f5094bb:scripts/audit-panel-fields.mjs`）。
> **r402 全部完成，D2-PV 销号**：S1 `632e4009`、S3 `72feeeee`（r401）；S2+S4 `8efcb274`、堵 `as any` 后门 `5b899453`（r402）。之后新增面板字段按 §6 规则。
> 关系：`docs/mcp-write-only-props.md`（CC-190）按**已声明属性的符号**查只写不读；索引签名上的**未声明**字段是它的盲区，本文补这一块。

## 0. 结论

- **根**：`PanelValues`（`src/types/catalog.ts`）末尾的 `[key: string]: number` 让任何模块都能往面板上写任意键、编译器不拦。r398（命座夹带）、r399（`velinaEnabled` / `aliceEnabled` 身份标记）修掉的都是靠它才成立的 hack。
- **方法**：把签名临时删掉跑 `vue-tsc -b --force`，编译器报出的每一处就是一次「靠索引签名才成立」的访问。比正则扫描准：变量名、解构、`DeepReadonly` 面板都能定位。
- **规模比预想小**（删掉 9 个字段之后）：全删签名 164 处报错，其中具名字段 51 个、动态键访问 53 处、其他 11 处。若改用模板字面量签名 `` [key: `${string}__${string}`]: number `` 覆盖定向属性键，剩 111 处：具名 39 个、动态 34 处、其他 11 处。
- **意外发现：命座自检被零读者字段短路**。`composables/cinemaUplift.ts` 的三态判据是「`changedFields` 非空 ⇒ `ok`」，模块在 `applyPanel` 里盖的 `xxxCinemaN = 1` 这类**没人读**的标记会让面板「变了」，于是**不管效果是否在面板生效，自检都显示 ok**。r400 删了 9 个（§2）。
- **终态（决定）**：去掉 `[key: string]: number`，让编译器成为锁。§4 分四个阶段做，每阶段可单独提交、zd 0/0 验收。不做「名单守卫」：签名去掉后类型系统本身就拦住新夹带，比任何名单都全。（r401 修订顺序：S1 → S3 → S2+S4 同一提交。）

## 1. 四类访问与各自的正确归宿

| 类 | 例 | 数量（none 模式） | 归宿 |
|---|---|---|---|
| A 定向属性键 `${stat}__${target}` | `skillDmgBonus__basic`、`stunBuildUpBonus__dashAttack`、`enemyIceResReduction__exSpecial` | 12 个具名 + 19 处动态（= none 与 template 两次运行之差） | 模板字面量索引签名（§4 S4）：这是 buff 系统合法的动态通道（`core/buff.ts#targetedStatKey`） |
| B 通用属性但没声明 | `timeSlice*Decibel`、`backstageEnergyRegenFlat`、`zhenyuanEnergyPerTrigger`（catalog.json 按名写入、`utils/statMeta.ts` 有登记、`core/resource/resourceIncome.ts` 读），`potentialLevel`、`turbulenceResIgnore`、`windInfectionRate`、`refringe` | 14 个（cross） | 在 `PanelValues` 里显式声明（§4 S1） |
| C 模块私有字段 | `miyabiCinema4`、`velinaCinema2`、`liuyinGoodReviewAtkBonus`、`triggerAdditionalStunBuildUp` | 24 个（single）+ 1 个（test-only） | 按 D2 规则在模块内 `declare module '@/types/catalog'` 扩充（§4 S2）；零读者的删除 |
| D 动态字符串键网关 | `core/buff.ts`×13、`components/FinalPanel.vue`×7、`StatPanel.vue`×4、`views/DebugPage.vue`×3、`specs/runtime.ts`×3、`cinemaUplift.ts`×2、`test/specVerify.ts`×2 | 34（template 模式） | 收敛到一个受检访问器（§4 S3），像 `cfgMechanicSetting` 之于 cfg |

## 2. r400 已处理：9 个零读者字段（CC-374 `823b7261`）

**删除判据**（以后同类照此）：面板字段必须有读者（代码、spec JSON、`statMeta` 展示表三者之一，`grep -rnw <字段> src public/static` 为证）。**唯一例外**是「留痕」：与真实属性写在同一个块里、给命座自检 UI 提供可读名字的字段（如 `panel.atk += x; panel.zhaoCinema2SelfAtk = x`），保留。

| 字段 | 模块 | 效果实际在哪 |
|---|---|---|
| `aliceCinema1` / `aliceCinema2` / `aliceCinema6` | alice | C1/C2 写真实属性（`enemyDefReduction` / `anomalyDmgBonus`…）；C6 是执行级额外攻击 |
| `miyabiEnabled` / `miyabiCinema2` | miyabi | 纯标记，零读者 |
| `miyabiCinema2EntryFrostFall` | miyabi | C2 入场 6 落霜在落霜资源里按 `cfg.miyabiCinemaLevel` 结算 |
| `miyabiFrostburnDmgBonus` | miyabi | C4 霜灼·破 +30% 在 `resolveExecutionDamage` 按 `cinemaLevel` 结算 |
| `velinaCinema1` | velina | C1 已改走通用字段 `turbulenceResIgnore`（CC-36b），旧标记残留 |
| `velinaCinema4` | velina | C4 写 `atk` |

**证据**（临时探针，跑 `analyzeCinemaUplift` 于 1401 / 1091 / 1561 单人队全部 6 级，删前删后对比，产物 `calc-arch/arenaE/probe400-*.json`）：
- 伤害提升 18/18 逐位不变；zd `r400b` 0/0。
- 唯一 `warn` 变化：**alice C6 `ok` → `execLevel`**。这是**如实**的：C6 是执行级效果，面板本来就不变，原来的 `ok` 是 `aliceCinema6` 标记伪造的。
- 其余级别仍为 `ok`，只是 `changedFields` 里少了假字段（例：velina C4 现在只列 `atk`）。

**回滚**：`git revert 823b7261`。

## 3. 剩余清单（template 模式，删 9 个之后；`audit-panel-fields.mjs` 原样输出）

读表须知：
- 「W1 R0」只表示 **tsc 看得见的** 读为 0。按字符串键读的（spec JSON 的字段名、`statMeta`、组件 `p[key]`）要另外 grep。例：`velinaAdditionalAbilityActive` 被 `src/specs/agents/1561.json` 读，**不是**死字段。
- `aliceAdditionalAbilityActive`、`hugoEchoCoverage`、`piperMomentumStacks`、`zhaoCoreCritRate` 等有测试读取；要先看测试读它是为了锁行为，还是只为了窥探中间值，再决定去留。
- `harumasaPotentialAtk`、`vivianC4AtkBonus`、`zhaoCinema2SelfAtk`、`zhendouC4HpBonus`、`rinaPotentialPenRatio`、`rinaCinema4EnergyRegen` 都是**留痕**（同块写了真实属性），按 §2 判据保留，S3 时补声明。

<!-- mode=template total=111 named=39 dynamic=34 other=11 -->
| 字段 | 写/读（tsc 可见） | 归属 | 出现文件 |
|---|---|---|---|
| `aliceAdditionalAbilityActive` | W1 R0 | single:alice | mechanics/agents/alice.ts |
| `aliceCinema4` | W1 R1 | single:alice | mechanics/agents/alice.ts |
| `backstageEnergyRegenFlat` | W0 R1 | cross | core/resource/resourceIncome.ts |
| `demaraEnergyGainEfficiency` | W0 R1 | cross | core/resource/resourceIncome.ts |
| `electricSharpDmg` | W1 R4 | test-only | core/__tests__/damage.test.ts, core/__tests__/wEngineBuffs.test.ts |
| `harumasaPotentialAtk` | W1 R0 | single:harumasa | mechanics/agents/harumasa.ts |
| `hugoEchoCoverage` | W1 R0 | single:hugo | mechanics/agents/hugo.ts |
| `hugoStunTeammateAtkBonus` | W1 R0 | single:hugo | mechanics/agents/hugo.ts |
| `liuyinGoodReviewAtkBonus` | W1 R2 | single:liuyin | mechanics/agents/liuyin.ts |
| `miyabiAdditionalAbilityActive` | W1 R1 | single:miyabi | mechanics/__tests__/miyabiAdditionalAbility.test.ts, mechanics/agents/miyabi.ts |
| `miyabiCinema4` | W1 R0 | single:miyabi | mechanics/agents/miyabi.ts |
| `miyabiCinema6` | W1 R0 | single:miyabi | mechanics/agents/miyabi.ts |
| `miyabiHasWindTeammate` | W1 R1 | single:miyabi | mechanics/agents/miyabi.ts |
| `miyabiIceFlameCoverage` | W1 R0 | single:miyabi | mechanics/agents/miyabi.ts |
| `nonOperatingEnergyRegenFlat` | W0 R1 | cross | core/resource/resourceIncome.ts |
| `piperMomentumStacks` | W1 R0 | single:piper | mechanics/agents/piper.ts |
| `potentialLevel` | W2 R6 | cross | composables/__tests__/panelPotentialStamp.test.ts, core/buff.ts, core/panel.ts, mechanics/agents/burnice.ts, mechanics/agents/jane.ts |
| `refringe` | W1 R0 | cross | composables/resourceCalc/anomalyPanels.ts |
| `remielleRadiantTurnDazeBonusPct` | W1 R3 | single:remielle | composables/__tests__/helpersNightC.test.ts, mechanics/agents/remielle.ts |
| `rinaCinema4EnergyRegen` | W1 R0 | single:rina | mechanics/agents/rina.ts |
| `rinaPotentialPenRatio` | W1 R0 | single:rina | mechanics/agents/rina.ts |
| `roaringRideBackstageEnergyRegen` | W0 R1 | cross | core/resource/resourceIncome.ts |
| `timeSliceAssistDecibel` | W0 R1 | cross | core/resource/resourceIncome.ts |
| `timeSliceChainDecibel` | W0 R1 | cross | core/resource/resourceIncome.ts |
| `timeSliceDodgeCounterDecibel` | W0 R1 | cross | core/resource/resourceIncome.ts |
| `timeSliceEnergyPerTrigger` | W1 R2 | cross | core/__tests__/timeSliceChainEnergy.test.ts, core/resource/resourceIncome.ts |
| `timeSliceExSpecialDecibel` | W0 R1 | cross | core/resource/resourceIncome.ts |
| `triggerAdditionalStunBuildUp` | W1 R1 | single:trigger | mechanics/agents/trigger.ts |
| `turbulenceResIgnore` | W1 R1 | cross | core/anomalyPool/helpers.ts, mechanics/agents/velina.ts |
| `velinaAdditionalAbilityActive` | W1 R0 | single:velina | mechanics/agents/velina.ts |
| `velinaCinema2` | W1 R1 | single:velina | mechanics/agents/velina.ts |
| `velinaCinema2CorrosionRate` | W1 R1 | single:velina | mechanics/agents/velina.ts |
| `velinaCinema6` | W1 R2 | single:velina | mechanics/agents/velina.ts |
| `vivianC4AtkBonus` | W1 R0 | single:vivian | mechanics/agents/vivian.ts |
| `windInfectionRate` | W0 R1 | cross | composables/resourceCalc/panelPhases.ts |
| `zhaoCinema2SelfAtk` | W1 R0 | single:zhao | mechanics/agents/zhao.ts |
| `zhaoCoreCritRate` | W1 R0 | single:zhao | mechanics/agents/zhao.ts |
| `zhendouC4HpBonus` | W1 R0 | single:zhendou | mechanics/agents/zhendou.ts |
| `zhenyuanEnergyPerTrigger` | W0 R1 | cross | core/resource/resourceIncome.ts |

动态键访问（TS7053）：`src/components/FinalPanel.vue`×7，`src/components/StatPanel.vue`×4，`src/composables/cinemaUplift.ts`×2，`src/core/buff.ts`×13，`src/specs/runtime.ts`×3，`src/test/specVerify.ts`×2，`src/views/DebugPage.vue`×3

其他：
- src/composables/__tests__/helpersNightC.test.ts:89 TS2352 Conversion of type 'PanelValues' to type 'Record<string, number>' may be a mistake because neither type sufficiently overlaps with the other
- src/core/__tests__/discSetEffects.test.ts:176 TS2353 Object literal may only specify known properties, and 'fireCritDmg' does not exist in type 'PanelValues'.
- src/core/__tests__/discSetEffects.test.ts:179 TS2353 Object literal may only specify known properties, and 'fireCritDmg' does not exist in type 'PanelValues'.
- src/core/__tests__/discSetEffects.test.ts:182 TS2561 Object literal may only specify known properties, but 'iceCritDmg' does not exist in type 'PanelValues'. Did you mean to write 'critDmg'?
- src/core/__tests__/wengineEffectRequirement.test.ts:24 TS2352 Conversion of type 'PanelValues' to type 'Record<string, number>' may be a mistake because neither type sufficiently overlaps with the other
- src/core/__tests__/wengineWearerAgent.test.ts:23 TS2352 Conversion of type 'PanelValues' to type 'Record<string, number>' may be a mistake because neither type sufficiently overlaps with the other
- src/core/panel.ts:62 TS2353 Object literal may only specify known properties, and 'backstageEnergyRegenFlat' does not exist in type 'PanelValues'.
- src/mechanics/__tests__/cinemaAxisBatchA.test.ts:104 TS2352 Conversion of type 'PanelValues | undefined' to type 'Record<string, number> | null' may be a mistake because neither type sufficiently over
- src/mechanics/__tests__/cinemaAxisBatchR62.test.ts:38 TS2352 Conversion of type 'PanelValues' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the othe
- src/mechanics/__tests__/cinemaAxisBatchR62.test.ts:158 TS2352 Conversion of type 'PanelValues' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the othe
- src/mechanics/__tests__/panelBlocksR20h1.test.ts:57 TS2352 Conversion of type 'PanelValues' to type 'Record<string, number>' may be a mistake because neither type sufficiently overlaps with the other

## 4. 分阶段执行卡（每阶段一提交；验收 = vue-tsc `--force` 0 + zd 0/0 + 全量 vitest(4)）

> r401 修订：原 S2 / S4 分两步做不可行（§5 TS2411），合并为一个提交；S3 前移。进度：全部 ✅（r402）。

- **S1 声明通用属性** ✅ r401 `632e4009`：共 15 个（原 14 个 `cross`，加上 emptyPanel 里早有初值却未声明的 `healingAmount`），全部声明为**必填** `number`，不是原计划的 `?:`（§5 TS2411）。emptyPanel 补 5 个初值：`roaringRideBackstageEnergyRegen` 0、`potentialLevel` 6（三个读者原本都 `?? 6`）、`turbulenceResIgnore` 0、`windInfectionRate` 0、`refringe` 0。去掉 `anomalyPanels.ts` 的 `as any`。`cross` 行清零。
- **S3 动态键网关** ✅ r401 `72feeeee`：
  - `src/utils/panelStat.ts` 的 `getPanelStat / setPanelStat / addPanelStat` 是「键名来自数据」时唯一的入口，内部做一次断言。34 处全部改完，template 模式 dynamic 34→0（总数 87→52）。
  - 没采用原计划的「展示组件的 key 取 `keyof PanelValues`」：键来自 statMeta、`elementStatKey`、`Object.keys`，类型上就是 string。硬收紧只能在各个列表处断言，等于把断言分散到各处。
  - 同一提交把 `core/buff.ts` 的批次累加器从面板隐藏键（`__hpAccum` 等，值是对象）移进模块级 WeakMap，两套同构的累加器合并为一套。原因是 `__hpAccum` 匹配 S4 的模板签名：不搬的话，S4 会把一个对象当成 number 放行。锁：`core/__tests__/batchAccum.test.ts`。
- **S2+S4 同一提交** ✅ r402 `8efcb274`（下面 1–6 是当时的执行卡，保留作记录）。结果：签名换成模板签名；13 个模块共声明 21 个私有字段；删 3 个零读者标记（`miyabiCinema4/6`、面板侧的 `aliceAdditionalAbilityActive`）。探针：雅 C4 自检 ok → `execLevel`（如实，效果在执行层），收益 4.43 / 33.775 不变。测试 10 处按计划改完。反证：`panel.fooBar` 报 TS2339、拼错的 `hugoEchoCoverag` 报 TS2551、`panel.foo__bar` 放行。
- **S5（计划外，r402 `5b899453`）堵 `as any` 后门**：签名收紧后，`(panel as any).k` 成了唯一的夹带通道，而盘点脚本看不见它（脚本靠编译报错，`as any` 让编译器闭嘴）。实测 4 处：
  - ben `benDefToAtk`：留痕，声明；
  - lighter `lighterMoraleDmgBonus`：本模块写读，声明；
  - lighter `lighterC1FinisherDmgBonus`：零读者的 C1 标记，删；
  - yeshuguang：多余的 `as any`，去掉。
  加全仓不变式锁（`types/__tests__/privateCfgFields.test.ts`，已反证）。同一提交里 miyabi 的 cfg 强转清零，进 D2 §5 锁表。
- 原执行卡：
  1. 签名换成 `` [key: `${string}__${string}`]: number ``。定向属性键（`skillDmgBonus__basic` 这类）仍然合法。
  2. 同一提交里，24 个 single 字段在所属模块写 `declare module '@/types/catalog' { interface PanelValues { xxx?: number } }`（D2 规则，见 `docs/mcp-d2-cfg-fields.md`；出现第二个**生产**引用者就迁回公共接口）。签名换完后 `?:` 不再与索引签名冲突。字段和所属模块的清单在 r401 后重跑：`node scripts/audit-panel-fields.mjs <临时wt> template out.json`（r401 的结果在 `calc-arch/arenaE/pv401b.json`，25 行具名 + 10 处其他）。改之前每个字段先按 §2 判据确认有读者，零读者的删除，并跑探针。
  3. 剩下 10 处「其他」：
     - 测试里 7 处 `as Record<string, …>`（TS2352）：改用 `getPanelStat`，或改成 `as unknown as`。
     - `discSetEffects.test.ts` 里 `fireCritDmg` / `iceCritDmg` 对象字面量 3 处：`elementStatKey('critDmg', …)` 会拼出这两个键，它们只经网关流动（§5）。改成 `setPanelStat` 写入，**不要**为了让测试编译而在 PanelValues 里声明它们。
  4. 顺手：miyabi 的 `(cfg.panel as any)?.miyabiCinema4 / 6`（`miyabi.ts` 约 183 / 270 行）改成正式读法。
  5. 反证：在某个 `applyPanel` 里写 `panel.fooBar = 1`，必须报 TS2339；写 `panel.foo__bar = 1` 则不报。
  6. 完成后 OPEN-ITEMS 的 D2-PV 销号。不做名单守卫。

## 5. 已知坑

- **cinemaUplift 的 `changedFields` 是全键遍历读者**：删任何面板字段都可能改变命座自检的 `warn` 和 UI 上的「变化字段」列表，zd 测不到这一块。删之前用 §2 的探针法（单人队 `analyzeCinemaUplift` 删前删后对比）。探针写在临时 worktree 里，不入库。
- 盘点脚本会临时改 `catalog.ts`。被 kill 时 finally 不执行，会留下改坏的文件，所以只在临时 worktree 里跑，跑完 `git status` 确认干净。
- `vue-tsc -b` 必须 `--force`，否则增量缓存让报错数偏少。
- 字段归属按「生产代码出现的文件」判断：测试里出现不算第二个引用者。
- **TS2411（r401）**：只要 `[key: string]: number` 还在，显式成员就不能写 `?: number`（`undefined` 不能赋给 `number` 索引）。所以 S1 只能声明为必填（emptyPanel 必须有初值），S2 的模块私有 `?:` 声明也不能先于 S4 换签名。
- **盘点盲区（r401）**：对象展开或非字面量写入（如 `.map(p => ({ ...p, x }))`）不触发多余属性检查，所以表里 W0 不能证明没有写入方，要 grep 核实（`windInfectionRate` 就是在 `useResourceCalc.ts` 里用展开写入的）。另外 TS 对每个对象字面量只报**第一个**多余属性：emptyPanel 要用脚本比较全部键（`healingAmount` 就是这样漏掉的）。
- **只经网关流动的键编译器永远看不到**：数据里的 stat 经 `applyStat` 的 default 分支写入、经 `getPanelStat` 读出（例如 `fireCritDmg`），S4 之后也不会报错。它们的「声明」是 catalog 数据加 statMeta，不是 `PanelValues`。不要把「编译通过」理解为「所有键都已声明」。
- **面板上不要挂非数字的东西**：批次状态这类临时数据按面板对象存 WeakMap（r401 `buff.ts` batchAccum 先例）。挂在面板上会被展开拷贝带走（共享同一引用），被 `Object.keys` 读者看到，还会被模板签名误放行。
- **`as any` 是类型收紧的盲区（r402）**：靠编译报错做的盘点永远看不到 `(x as any).k`。收紧任何类型之后，都要再 grep 一遍 `as any` / `as unknown as Record` 绕过该类型的写法，并加不变式锁。

## 6. 终态之后的规则（r402 起，给后续会话）

- **新面板字段放哪**：
  - 多个模块读写的通用属性：在 `types/catalog.ts` 的 `PanelValues` 里声明（emptyPanel 有初值的写必填）。
  - 只有一个模块读写：在该模块末尾 `declare module '@/types/catalog' { interface PanelValues { xxx?: number } }`。出现第二个**生产**引用者时迁回公共接口（测试读不算）。
  - 键名来自数据（catalog stat、`elementStatKey` 元素键族、`Object.keys`）：用 `utils/panelStat.ts` 的 `getPanelStat / setPanelStat / addPanelStat`，不声明。
  - 批次状态这类非数字的临时数据：不要挂在面板上，按面板对象存 WeakMap（`core/buff.ts` batchAccum 先例）。
- **禁止**：`(panel as any).k`、`panel as unknown as Record`（锁：`privateCfgFields.test.ts`）。测试里需要动态键时，用 `as unknown as Record` 或网关。
- **新增字段前先问「谁读」**：没有读者的标记（尤其是 `xxxCinemaN = 1`）只会让命座自检（`cinemaUplift` 的 changedFields）误判为 ok。要留痕，就和真实属性写在同一块里（§2 判据）。
- 可选的后续收紧（不急，记在这里）：模板签名可以收紧成 `` `${StatKey}__${SkillTargetKind}` ``；元素键族（`fireCritDmg` 等）也可以用映射类型声明。两者都要先确认收益：能拦住哪一类真实错误。没有实例就不做。
