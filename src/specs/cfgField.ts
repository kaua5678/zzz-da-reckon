import type { CharacterOperationConfig } from '@/types/resource'
import { mechanicSettingCfgKey } from '@/utils/mechanicSettingCfg'

/** spec 数据按字段名读 cfg（valueField / enabledField / carrierField …）。唯一入口：动态键只在这里出现。 */
export function readCfgField(cfg: CharacterOperationConfig, field: string): unknown {
  return (cfg as unknown as Record<string, unknown>)[field]
}

/** 机制可调设置写入 cfg（键 = mechanicSettingCfgKey(id)）；读端是 utils/mechanicSettingCfg.ts 的 cfgMechanicSetting*。 */
export function writeMechanicSettingCfg(cfg: CharacterOperationConfig, settingId: string, value: unknown): void {
  ;(cfg as unknown as Record<string, unknown>)[mechanicSettingCfgKey(settingId)] = value
}
