# nextRoundFeedback 的 cfg 写回判死（r397 CC-371 `07c17341`）

> 一句话：`nextRoundFeedback` 钩子里对 cfg 的强转写回**全是死写**，已删除；钩子输入改由**运行时深冻结测试**守住只读，覆盖注册表里的全部钩子。
> 回退：`git revert 07c17341`（纯删除 + 测试改写，zd 0/0，回退不影响任何输出）。

## 1. 背景

- 钩子契约：`AgentNextRoundFeedbackInput`（`src/mechanics/typesHooks.ts`）的 `cfg` / `characters` / 结果都是 `DeepReadonly`。49ecb777 定下「钩子输入只有输出通道可写」，这里唯一的输出通道是**返回值**：返回值 → `threadsNext.moduleFeedback` → 下一轮 `applyTeamConfig(converge)` 读 `threads` 再写 cfg。
- 但 r396 之前，注释里还写着「可写」，而且有 4 个模块用 `cfg as unknown as Record<string, unknown>` 强转绕过类型去写 cfg：
  - lucy：每轮给全队写 `lucyCheerSpinsEstimate` / `lucyTeammateExTotal`；
  - promia：首轮写 `promiaTriggerHitCount` / `promiaTeammateReleaseCount`；
  - vivian：首轮写 `vivianTeamExTotal` / `vivianAnomalyTriggerTotal`；
  - ellen：首轮写 `ellenFreezeCount`。
- r396 曾怀疑 hugo / anbyZero / lighter 也是同一种写法。核实结果：它们的强转在 `applyTeamConfig` / `buildCharConfig` 里，那里的入参本来就可写，跟这个钩子无关。

## 2. 判死依据

### 静态（`src/composables/resourceCalc/convergence.ts`，行号以 `07c17341` 为准）

1. **`:410`**：`const characters = base.characters.map(cfg => { const merged = { ...cfg, … } … })`。每轮、每个槽位都 spread 出新对象，写入只会落在**本轮局部克隆**上，不会碰到 `base.characters`，也不会跨轮保留。
2. **`:668`**：`enrichExecutionPlan(calcTeamResources({ characters, … }))` 是本轮**唯一一次**资源装配。上面这些键的读者都在装配期间执行：
   - lucy `:175` 和 `perTargetAmounts`（由 `core/resource/crossAgentSupply.ts:233` 同步调用）；
   - promia `computePromiaVerdict`；
   - vivian `cycleFromInput`；
   - ellen `:254/:269`。
3. **`:946`**：`collectNextRoundFeedback` 在装配**之后**才派发。此后 `characters` 只被 `:965/:966`（读 `agentId`）和 `computeTeamVeilCountTotal`（读帷幕相关字段）用到；`:1098` 的 return 不带出 `characters`。
4. 这 7 个键全仓只在各自的模块文件里出现，没有其他钩子读它们，data / specs 的 JSON 也不读（vivian 那两个键在 `specs/agents/1331.json` 里只出现在说明文字中）。
5. 先例是同一种论证：`convergence.ts:1068` 附近的注释记录了 round 13 删掉的 `inStunWindowTriggers` 死写。

### 动态

- zd `r397` / `r397b`：DUMP 0 / ROWS 0。
- `nextRoundFeedback.test.ts` 的管线锚点没变：露西 C6 `lucyEnergy = 58`（有钩子 58，摘掉钩子 30），艾莲影画4 冻结回能 = 冻结数 × 每次回能。
- 全量 vitest 455 个文件 / 4192 个测试通过。

## 3. 顺带删掉的死通道

- **`lucyCheerSpinsEstimate`**：唯一读者是 `perTargetAmounts` 里的 `hint > 0 ? hint : 现算`，它在钩子之前执行，所以恒读到 0，永远走「现算」分支。现算公式和钩子里那份是同一个（取本轮 state）。读取、写入和声明一起删掉了。
- **`perTargetAmounts.targetCfgOf`**（typesHooks）：一个可选入参，引擎从来没传过，也没有模块读过。它原本就是为上面这个提示「按落点读」准备的，一起删掉。

## 4. 锁：运行时只读（而不是名单）

- `nextRoundFeedback.test.ts` 末段「★ 只读输入」：用 `getRegisteredAgentMechanics()` 遍历**所有**带钩子的模块（目前 11 个），按 `agentIds` 逐个展开，把输入深冻结后调用钩子，要求不抛错。ESM 是严格模式，写冻结对象会抛 TypeError。
- 夹具的设计是让旧写回分支都能走到：本角色在结果行里、有队友、异常池非空、线程是首轮状态。
- **反证**：往艾莲钩子里塞回 `;(cfg as unknown as Record<string, unknown>).ellenFreezeCount = …` 后，该用例和「前导空槽」用例都红。
- ⚠ **坑**：模块身份字段是 **`agentIds`（数组）**，不是 `agentId`。第一版写成 `m.agentId`，cfg 里就没有 agentId，所有守卫都不成立，写回分支根本没走到，反证也**不红**。vue-tsc `-b` 也没报 `m.agentId` 不存在（测试文件可能不在 tsc 的 project 里）⇒ **锁必须反证**。

## 5. 后续（同一种病的其他落点）

只读入参被强转写入，不止这一个钩子。还有：
- phoenix `applyPanelBuffs` 里的 `;(panel as unknown as Record<string, unknown>).phoenixCinemaLevel = cinemaLevel`，借 panel 夹带命座，让 `releaseModifier` 能读到；
- `types.ts` / `typesHooks.ts` 里其他标了 `DeepReadonly<…>` 的入参（`panels`、`charResult`、`exec`、`result`、`anomalyPoolSetup(cfg)`、`axes`）。

做法同本轮：先查写入落在哪个对象上、之后谁读；死写就删；活写就改走正式通道（例如 phoenix 的 `releaseModifier` 能不能直接拿到 cfg 或命座）。最后把「深冻结调用」锁推广到对应钩子。具体见 `docs/mcp-worker-task-queue.md` §2 下一步。

## 6. r398 进展：releaseModifier 契约补「我是谁」（CC-372 `1259abd5` / 锁表 `468d0e05`）

- **病**：`ReleaseModifierInput` 只给全队 `panels`，模块不知道哪一槽是自己。于是 phoenix、promia、vivian 都在 `applyPanel` 里往自己面板上**夹带**命座（promia 还夹带了额外能力门控），再用 `panels.find(p => p.xxxCinemaLevel !== undefined)` 把自己认回来。三份同构 hack，能写成全靠 `PanelValues` 的 `[key: string]: number` 索引签名。
- **它不是「只读入参被写」**：面板阶段的 panel 本来就是可写的输出通道。真正的问题是**契约缺身份**，模块只能把身份塞进数据里。所以修法是补契约，而不是加冻结锁。
- **改法**：
  - 新契约：`ReleaseModifierInput = { self: { slot, cinemaLevel, panel } }`。`panels` 删掉后，「扫全队面板认自己」在**编译期**就写不出来，类型本身就是锁。
  - 派发方：`damagePool.ts#releaseModifierSelf` 按模块的 `agentIds` 定位槽位。命座取 `team[slot].cinemaLevel`，和 `panelPhases` 的 `applyPanel` 同一来源；命座提升率（`cinemaUplift.ts:212`）也是改这里再恢复，所以不会读错。面板用 `panelAt` 按身份取。测试也调用同一个函数。
  - 4 个模块（phoenix / promia / vivian / velina）改为读 `self`；3 个模块的夹带写入删除。velina 的 `velinaCinema*` 面板字段另有消费方，保留。
  - 验证：zd 0/0。phoenix 因此零强转，进了锁表（TYPED 24）。
- **剩余同类**：
  - **`velina.ts#findVelinaPanel`** 用 `panel.velinaEnabled` 标记扫面板认维琳娜，消费方是 **core 层**：`core/anomalyPool.ts:325`、`core/anomalyPool/helpers.ts:1167` 的风蚀归属。这比上面那个更深：core 在认一个具体角色，违反了规则 6「编排层不认人」。修法方向：异常池输入里由模块能力声明「风蚀归属槽位」（参照 `anomalyPoolSetup` 钩子的写法），core 只读声明。
  - **`PanelValues` 的索引签名**（`types/catalog.ts:190`）是所有夹带的根源。直接去掉牵涉面很大，要先盘点所有「模块私有面板字段」，按 D2 的做法改成模块 `declare module` 扩充，再收紧签名。登记在 OPEN-ITEMS「PanelValues 索引签名」。
