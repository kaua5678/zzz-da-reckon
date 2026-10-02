# PanelValues 未声明字段盘点（r400 / CC-374）

> lane arena-E · 2026-10-02 第 400 轮。代码提交 `823b7261`（删 9 个零读者字段）。
> 复跑：`node scripts/audit-panel-fields.mjs <临时worktree> [none|template] [out.json]`（约 15s；**别在主工作区跑**，见脚本头注释）。
> 关系：`docs/mcp-write-only-props.md`（CC-190）按**已声明属性的符号**查只写不读；索引签名上的**未声明**字段是它的盲区，本文补这一块。

## 0. 结论

- **根**：`PanelValues`（`src/types/catalog.ts`）末尾的 `[key: string]: number` 让任何模块都能往面板上写任意键、编译器不拦。r398（命座夹带）、r399（`velinaEnabled` / `aliceEnabled` 身份标记）修掉的都是靠它才成立的 hack。
- **方法**：把签名临时删掉跑 `vue-tsc -b --force`，编译器报出的每一处就是一次「靠索引签名才成立」的访问。比正则扫描准：变量名、解构、`DeepReadonly` 面板都能定位。
- **规模比预想小**（删掉 9 个字段之后）：全删签名 164 处报错，其中具名字段 51 个、动态键访问 53 处、其他 11 处。若改用模板字面量签名 `` [key: `${string}__${string}`]: number `` 覆盖定向属性键，剩 111 处：具名 39 个、动态 34 处、其他 11 处。
- **意外发现：命座自检被零读者字段短路**。`composables/cinemaUplift.ts` 的三态判据是「`changedFields` 非空 ⇒ `ok`」，模块在 `applyPanel` 里盖的 `xxxCinemaN = 1` 这类**没人读**的标记会让面板「变了」，于是**不管效果是否在面板生效，自检都显示 ok**。r400 删了 9 个（§2）。
- **终态（决定）**：去掉 `[key: string]: number`，让编译器成为锁。§4 分四个阶段做，每阶段可单独提交、zd 0/0 验收。不做「名单守卫」：签名去掉后类型系统本身就拦住新夹带，比任何名单都全。

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

- **S1 声明通用属性**（低风险，可交给执行模型）：把 §3 表里 `cross` 的 14 个字段加进 `PanelValues`，用 `?: number`；`emptyPanel()`（`core/panel.ts:62` 起）里已经初始化的用必填 `number`。每个字段写一行注释：谁写（catalog.json 键 / 模块）、谁读。`refringe` 由 `composables/resourceCalc/anomalyPanels.ts:299` 写进虚拟面板（现为 `as any`），声明后去掉强转。完成判据：`audit-panel-fields.mjs` 输出里不再有 `cross` 行。
- **S2 模块私有字段 → `declare module`**：按 D2 规则（`docs/mcp-d2-cfg-fields.md`），只被一个模块引用的字段在该模块里 `declare module '@/types/catalog' { interface PanelValues { xxx?: number } }`，出现第二处引用就迁回公共接口。顺手：miyabi 的 `(cfg.panel as any)?.miyabiCinema4` / `miyabiCinema6`（`miyabi.ts` 约 183/270 行，经 cfg 夹带面板）改成正式读法；miyabi 的 `(cfg as unknown as Record…).miyabiCinemaLevel` 属于 d2 §5 待做。
- **S3 动态键网关**：`core/buff.ts` 的 `panel[key]`（key: string）是 buff 系统的正当通道，收敛成一个导出的 `panelStatRef(panel, key: string)` 读写器（内部一次断言）。展示组件（FinalPanel / StatPanel / DebugPage）的 `p[key]` 改为 key 类型取 `keyof PanelValues`（键来自 `statMeta` 列表时可做到），或者调用同一个读写器。测试里 `as Record<string, number>` 的 7 处同理。
- **S4 换签名（终态 + 锁）**：S1–S3 做完后，`audit-panel-fields.mjs . template` 应当只剩 0 处（或个位数）。这时把 `[key: string]: number` 换成 `` [key: `${string}__${string}`]: number ``：定向属性键（`skillDmgBonus__basic` 这类，buff 系统合法的动态通道）仍然合法，其余未声明的键一律编译失败。更精确的 `` `${StatKey}__${SkillTargetKind}` `` 可以以后再收紧。
  - **顺序不能颠倒**：只要还有 S2 的私有字段或 S3 的 string 键访问，换签名就会编译失败。所以换签名必须放在最后，不能先换。
  - **反证**：在某个 `applyPanel` 里写 `panel.fooBar = 1`，vue-tsc 必须报 TS2339；写 `panel.foo__bar = 1` 则不报（模板签名放行）。
  - 换完后，新模块想往面板塞未声明的键会直接编译失败，必须先 `declare module`，夹带就无处藏身。这时 OPEN-ITEMS 的 D2-PV 可以销号。

## 5. 已知坑

- **cinemaUplift 的 `changedFields` 是全键遍历读者**：删任何面板字段都可能改变命座自检的 `warn` 和 UI 上的「变化字段」列表，zd 测不到这一块。删之前用 §2 的探针法（单人队 `analyzeCinemaUplift` 删前删后对比）。探针写在临时 worktree 里，不入库。
- 盘点脚本会临时改 `catalog.ts`。被 kill 时 finally 不执行，会留下改坏的文件，所以只在临时 worktree 里跑，跑完 `git status` 确认干净。
- `vue-tsc -b` 必须 `--force`，否则增量缓存让报错数偏少。
- 字段归属按「生产代码出现的文件」判断：测试里出现不算第二个引用者。
