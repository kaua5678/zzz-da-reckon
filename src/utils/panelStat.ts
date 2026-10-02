import type { PanelValues } from '@/types/catalog'

/**
 * 按**运行期字符串键**读写面板——全仓「键名来自数据」的面板访问的唯一入口（r401 CC-375，`docs/mcp-panel-fields.md` §4 S3）。
 *
 * 键的来源：catalog.json / teammate-buffs 的 `stat` / `sourceStat`、spec 的 `targetStat` / `sourceStat` / verification 键、
 * statMeta 列表、`elementStatKey`、`targetedStatKey`、`Object.keys(panel)`——编译期不知道是哪个字段。
 * **编译期已知的字段一律写 `panel.xxx`**（受 `PanelValues` 声明检查），不要为了省事走这里。
 *
 * 现阶段 `PanelValues` 仍带 `[key: string]: number`，下面的断言是冗余的；S4 把它换成
 * `` [key: `${string}__${string}`]: number `` 之后，这里是唯一合法的任意 string 键通道
 * （`scripts/audit-panel-fields.mjs` 的 dynamic 计数应保持 0）。
 * 读返回 `number | undefined`：键可能不在面板上（数据里的新 stat、拼出来的定向键），兜底值由调用方决定。
 */
type PanelBag = Record<string, number | undefined>

export function getPanelStat(panel: Readonly<PanelValues>, key: string): number | undefined {
  return (panel as unknown as Readonly<PanelBag>)[key]
}

export function setPanelStat(panel: PanelValues, key: string, value: number): void {
  ;(panel as unknown as PanelBag)[key] = value
}

/** `panel[key] = (panel[key] ?? 0) + delta` */
export function addPanelStat(panel: PanelValues, key: string, delta: number): void {
  setPanelStat(panel, key, (getPanelStat(panel, key) ?? 0) + delta)
}
