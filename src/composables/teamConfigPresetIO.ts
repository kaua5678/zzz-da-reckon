import { computed, type Ref } from 'vue'
import type { MessageApi } from 'naive-ui'
import { teamPresets } from '@/data/teamPresets'
import { buildGoldStepsFromConfig } from '@/composables/teamCompare'
import type { useConfigStore } from '@/stores/config'

/**
 * 队伍配置页「预设金数 → 保存到预设文件」族（纯搬运自 TeamConfigPage.vue）。
 * 职责：由当前命座/精炼草稿装配可下载的预设 JSON（重写 goldSteps/standardSteps），
 * 以及两个导出入口（下载文件 / 复制到剪贴板）。
 *
 * ⚠ 依赖一律**同名注入**（`configStore` / `goldDraft` / `saveTargetPresetId` / `message`）
 * —— R44 得出的可迁移纪律：改名会让「搬了什么」的口径静默扩大，
 * 逐字节保真证明就再也做不了（R44 首版改名后当场抓到 14 处「真差异」）。
 */
export function useTeamConfigPresetIO({
  configStore, goldDraft, saveTargetPresetId, message,
}: {
  configStore: ReturnType<typeof useConfigStore>
  goldDraft: Ref<{ cinemas: number[]; mods: number[] }>
  saveTargetPresetId: Ref<string | null>
  message: MessageApi
}) {
  // ========== 保存到预设文件（下载 JSON 写回 goldSteps/standardSteps） ==========

  const saveTargetPreset = computed(() =>
    teamPresets.find(p => p.id === saveTargetPresetId.value) ?? null,
  )

  /** 当前队伍与目标预设阵容不一致（步骤按槽位写入预设队伍，需确认） */
  const saveTeamMismatch = computed(() => {
    const p = saveTargetPreset.value
    if (!p) return false
    return p.team.some((agentId, i) => agentId !== configStore.team[i]?.agentId)
  })

  /** 将写入的步骤数预览（随草稿实时更新） */
  const saveStepsPreview = computed(() => {
    const { goldSteps, standardSteps } = buildGoldStepsFromConfig(
      configStore.team.map(c => ({ agentId: c.agentId, wEngineId: c.wEngineId })),
      goldDraft.value.cinemas,
      goldDraft.value.mods,
      // 把目标预设的基础音擎作为 baseWEngineIds 传入：
      // 换到与基础音擎不同的「限定音擎」时才写「本体（1金）」加金步，
      // 避免像伊德海莉队（基础音擎=限定专武 14105）被误判成升级步而抬高基础金。
      saveTargetPreset.value?.wEngines ?? [],
    )
    return { gold: goldSteps.length, standard: standardSteps.length }
  })

  /** 用当前命座/精炼重写目标预设的 goldSteps/standardSteps，返回可下载的 JSON。
   *  目标是难度变体条目（variantOf）时重定向回源预设：goldSteps 为全队共用，
   *  写源文件才能保住 variants 分类，避免另存出一份重复队伍。 */
  function buildPresetJson(): { json: string; presetId: string } | null {
    const preset = saveTargetPreset.value
    if (!preset) return null
    const source = (preset.variantOf ? teamPresets.find(p => p.id === preset.variantOf) : undefined) ?? preset
    const { goldSteps, standardSteps } = buildGoldStepsFromConfig(
      configStore.team.map(c => ({ agentId: c.agentId, wEngineId: c.wEngineId })),
      goldDraft.value.cinemas,
      goldDraft.value.mods,
      // 把目标预设的基础音擎作为 baseWEngineIds 传入：
      // 换到与基础音擎不同的「限定音擎」时才写「本体（1金）」加金步，
      // 避免像伊德海莉队（基础音擎=限定专武 14105）被误判成升级步而抬高基础金。
      saveTargetPreset.value?.wEngines ?? [],
    )
    const updated = { ...source, goldSteps, standardSteps }
    return { json: JSON.stringify(updated, null, 2), presetId: source.id }
  }

  function savePresetJson() {
    const r = buildPresetJson()
    if (!r) {
      message.warning('请先选择目标预设')
      return
    }
    const { json, presetId } = r
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${presetId}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    const tip = `已导出 ${presetId}.json（goldSteps/standardSteps 已按当前命座/精炼重写）：请替换 src/data/teamPresets/${presetId}.json 后刷新页面`
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).then(() => message.success(`${tip}（已复制到剪贴板）`)).catch(() => message.success(tip))
    } else {
      message.success(tip)
    }
  }

  function copyPresetJson() {
    const r = buildPresetJson()
    if (!r) {
      message.warning('请先选择目标预设')
      return
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(r.json)
        .then(() => message.success(`已复制 JSON，粘贴替换 src/data/teamPresets/${r.presetId}.json 后刷新页面`))
        .catch(() => message.warning('复制失败，请用「保存到预设文件」下载'))
    } else {
      message.warning('当前环境不支持剪贴板，请用「保存到预设文件」下载')
    }
  }
  return { saveTargetPreset, saveTeamMismatch, saveStepsPreview, buildPresetJson, savePresetJson, copyPresetJson }
}
