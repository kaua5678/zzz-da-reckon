/**
 * 图片URL工具函数
 *
 * catalog中的 images.icon 是本地相对路径（/assets/...），
 * 但图片文件通常不在项目中。images.source 有时是直接图片URL，
 * 有时是wiki页面URL。
 *
 * 本函数判断 source 是否为可直接使用的图片URL，
 * 如果是则返回，否则返回 null。
 */

/** 判断URL是否为直接图片链接 */
function isDirectImageUrl(url: string): boolean {
  if (!url) return false
  const lower = url.toLowerCase().split('?')[0]
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')
}

/**
 * 从 catalog 数据的 images 字段获取可用的图片URL
 *
 * 优先使用 source（如果是直接图片URL），因为 icon 路径的本地文件通常不存在
 *
 * @param images catalog中的 images 对象，如 { icon: "/assets/...", source: "https://..." }
 * @returns 可用的图片URL，或 null
 */
export function getImageUrl(images?: { icon?: string; source?: string; portrait?: string }): string | null {
  if (!images) return null
  // 优先检查 source 是否为直接图片URL
  if (images.source && isDirectImageUrl(images.source)) {
    return images.source
  }
  // source 不是图片URL时，尝试 icon（可能本地存在）
  if (images.icon || images.portrait) {
    return images.icon || images.portrait || null
  }
  return null
}
