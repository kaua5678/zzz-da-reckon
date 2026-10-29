/**
 * 实战对比页「部署态」的界面判据（2026-10-29）。
 *
 * 用户实报：「我点击部署后，切换页面再回来他就消失了」。
 * 根因：页面由 `CalculatorView` 的 `<component :is="currentPage" />` 渲染 —— **切页签 = 卸载重挂**，
 * 而部署态（选中的 run / 部署配置 / 告警）原本是页面局部 ref ⇒ 一切页就被清空；而 configStore 里
 * 部署写下的队伍 / Boss 房间 / layer-buff 行都还在（实测 appliedBoss + 2 行 layer-buff enabled）——两边各说各话。
 *
 * 判据形态 = **同一 pinia、两个组件实例**（正是「切走再切回来」的形状）：
 * 第一次挂载渲染出空态 → 部署（写 ui store）→ 第二次挂载必须渲染出那条 run 的对比面板。
 * 若部署态退回页面局部 ref，第二次挂载必然是空态 ⇒ 本条红。
 * （不能真在 node 里 `app.mount`：vitest 环境是 node，且 naive-ui 的 Follower 在无 document 时会抛。
 *  所以用 SSR 渲染真实 `<script setup>`：组件实例是新的、store 是同一个，挂载语义等价，够本判据用。）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, getActivePinia, setActivePinia, type Pinia } from 'pinia'
import { setup as setupCssrSsr } from '@css-render/vue3-ssr'
import { setupHarness } from '@/test/harness'
import { useUiStore } from '@/stores/ui'
import { submissionToDeploy, type RunArchiveFile } from '@/composables/runArchiveImport'
import { latestPhaseIdOf } from '@/utils/phaseBuff'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'

const bp = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
const ra = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as RunArchiveFile
const presets = bp.bosses as BossPreset[]

/** 归档里最新一季的第一条 run（部署路径的真实输入） */
function latestRun() {
  const seasons = [...new Set(ra.runs.map(r => r.seasonId))]
    .sort((a, b) => (ra.seasons[b]?.start ?? '').localeCompare(ra.seasons[a]?.start ?? ''))
  const run = ra.runs.find(r => r.seasonId === seasons[0])!
  const room = ra.rooms[run.targetId]
  return { run, deploy: submissionToDeploy(run, room, presets, room?.seasonStart) }
}

/**
 * 渲染一次 RunArchivePage（新组件实例；pinia 由调用方给 ⇒ 可以模拟「切走再回来」）。
 *
 * ⚠ SSR 下 naive-ui 的 `Follower` 会去挂 `document.head`（node 环境没有 document ⇒ ReferenceError），
 * 这是 TeamComparePage / AttributeConfigPage 整页不能 SSR 的同一个原因。装 css-render 的 SSR 适配器
 * （naive-ui 自带依赖，生产 SSR 用的就是它）后样式走收集器、不碰 document，页面就能在 node 里渲染。
 */
async function renderPage(pinia: Pinia): Promise<string> {
  const mod = await import('@/views/RunArchivePage.vue')
  const app = createSSRApp(mod.default as never)
  app.use(pinia)
  setupCssrSsr(app)
  app.config.warnHandler = () => {}
  return renderToString(app)
}

/** 标签去掉后的纯文本（断言文案用；SSR 输出里标签与文本会拆行） */
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('部署态跨「切页签再回来」存活（同一 pinia、新组件实例）', () => {
  it('★ 第一次挂载是空态 → 部署 → 第二次挂载仍是那条 run 的对比面板', async () => {
    await setupHarness([{ agentId: '1371' }, { agentId: '1481' }, { agentId: '1451' }], { recommendedBuild: true })
    // 用 harness 建的那个 pinia：catalog 等数据都在里面（换新 pinia 会让页面读到空目录）
    const pinia = getActivePinia()!
    const ui = useUiStore()

    const before = textOf(await renderPage(pinia))
    expect(before, '没部署过 ⇒ 空态').toContain('左侧点「部署」后')

    const { run, deploy } = latestRun()
    // 相当于「在第一次挂载里点了部署」：写 ui store（不碰组件实例）
    ui.setArchiveDeploy(run, deploy)

    const after = textOf(await renderPage(pinia))
    expect(after, '切回来必须还在（部署态住 store，不是页面局部 ref）').toContain(String(run.score))
    expect(after, '玩家实战段').toContain('玩家实战')
    expect(after, '计算器段').toContain('计算器（理论理想配装）')
    expect(after).not.toContain('左侧点「部署」后')
    // 部署配置本身也在（当期 Buff 行 / 建模缺口都读它）
    expect(ui.archiveDeploy?.deploy.team.map(s => s.agentId)).toEqual(deploy.team.map(s => s.agentId))
  }, 300_000)

  it('换一个 pinia（＝新会话）没有部署态：不把上一次的选择漏进新会话', async () => {
    await setupHarness([{ agentId: '1371' }, { agentId: '1481' }, { agentId: '1451' }])
    const { run, deploy } = latestRun()
    const first = createPinia()
    setActivePinia(first)
    useUiStore().setArchiveDeploy(run, deploy)

    const second = createPinia()
    setActivePinia(second)
    expect(useUiStore().archiveDeploy, '界面态不跨会话共享').toBeNull()
  }, 300_000)
})

/**
 * 「部署完切到属性配置页，Boss 与那期的 buff 要对得上」——用户实报的第二半
 * （「他部署的 boss 和 buff 也没有自动勾选」）。
 *
 * 写入侧本来就是对的（实测 appliedBoss=40012/690481 + 2 行 layer-buff enabled），错在**显示侧默认期**：
 * 归档快照最新一季 = 690481，期视图最新一期 = 690501（归档里一条 run 都没有）⇒ 卡片停在 690501，
 * 「已应用」标不显示、环境卡还报「本期还没有应用 Boss」。
 */
describe('★ 部署后属性配置页：Boss 卡与环境卡都停在部署的那一期', () => {
  async function renderAttributePage(pinia: Pinia): Promise<string> {
    const mod = await import('@/views/AttributeConfigPage.vue')
    const app = createSSRApp(mod.default as never)
    app.use(pinia)
    setupCssrSsr(app)
    app.config.warnHandler = () => {}
    return renderToString(app)
  }

  it('环境卡显示部署 Boss 的关卡固有 buff（且不再报「本期还没有应用 Boss」）', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1371' }, { agentId: '1481' }, { agentId: '1451' }])
    await catalog.loadBossPresets()
    await catalog.loadBuildRecommendations()
    const pinia = getActivePinia()!
    const { run, deploy } = latestRun()
    // 走生产部署路径（实战对比页「部署」按钮做的就是这件事）
    const { applyDeployConfig } = await import('@/composables/runArchiveDeploy')
    applyDeployConfig(config, deploy, presets)
    useUiStore().setArchiveDeploy(run, deploy)

    const text = textOf(await renderAttributePage(pinia))
    const phaseId = deploy.boss!.phaseId!
    expect(text, '环境卡的期数 = 部署的那一期').toContain(`（${phaseId}）`)
    expect(text, '环境卡要说清关卡 buff 已进表').toContain('已写入全局 Buff 表')
    expect(text, '部署的 Boss 名字要出现在当期的关卡 buff 段').toContain(deploy.boss!.name)
    expect(text, '★ 修前就是这句（停在别的一期上，layer 段查不出来）').not.toContain('本期还没有应用 Boss')
    // 反证：两个期号不同的日子里，卡片不得停在期视图最新一期（判别力前提见 phaseSelection.test.ts 同款断言；
    // 哪天归档快照追平到最新一期，这条自动失效，上面那条正证仍然有效）
    const latest = latestPhaseIdOf(bp)
    if (latest && latest !== phaseId) {
      expect(text, `★ 修前这里是期视图最新一期 ${latest}`).not.toContain(`（${latest}）`)
    }
  }, 300_000)
})

/**
 * 源码锁：两条回归的**形状**（有人又把状态搬回页面局部 ref / 又把默认期写死最新期）。
 *
 * 上面的 SSR 判据已经按行为锁住了这两件事的当前表现，这里再加一层「换回旧写法就红」的形状锁 ——
 * 行为判据要靠数据凑出判别力（归档快照与期视图最新一期不同号才成立），形状锁不依赖数据。
 * 写法与理由同 `utils/__tests__/phaseEnvironmentBuff.test.ts` 的页面源码锁。
 */
describe('源码锁：部署态住 ui store、默认期跟随已应用房间', () => {
  const src = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf-8')

  it('实战对比页：部署态不做页面局部 ref，写入走 uiStore.setArchiveDeploy', () => {
    const page = src('views/RunArchivePage.vue')
    expect(page, '必须把部署写给 ui store').toMatch(/uiStore\.setArchiveDeploy\(/)
    expect(page, '部署态必须从 ui store 读').toMatch(/uiStore\.archiveDeploy/)
    expect(page, '不许再留页面局部的部署态 ref（切页签即丢）')
      .not.toMatch(/const\s+(selected|lastDeploy|lastWarnings)\s*=\s*ref/)
  })

  it('属性配置页 + Boss 卡：期数走 usePhaseSelection（已应用房间 ＞ 最新期）', () => {
    for (const rel of ['views/AttributeConfigPage.vue', 'components/BossSelectCard.vue']) {
      const page = src(rel)
      expect(page, `${rel}：必须用 usePhaseSelection`).toMatch(/usePhaseSelection\(/)
      expect(page, `${rel}：把已应用房间的相位喂给选择器`).toMatch(/appliedBoss\?\.phaseId/)
      expect(page, `${rel}：不许再写死「最新一期」`).not.toMatch(/latestPhaseIdOf\(/)
    }
  })
})
