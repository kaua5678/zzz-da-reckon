/**
 * 主题 Store - 明亮/夜间模式切换（持久化到 localStorage）
 * 切换时同步 <html> 的 light class、color-scheme 与 PWA theme-color；
 * 颜色本体在 src/styles/global.css 的 :root（夜间默认）与 html.light（明亮）两套变量里。
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'zzz-theme'
const THEME_COLOR: Record<ThemeMode, string> = { dark: '#0f172a', light: '#edf1f7' }

function readInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage 不可用（隐私模式等）时回落默认夜间
  }
  return 'dark'
}

function applyMode(mode: ThemeMode) {
  document.documentElement.classList.toggle('light', mode === 'light')
  document.documentElement.style.colorScheme = mode
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[mode])
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readInitialMode())
  applyMode(mode.value) // store 首次使用即应用（挂载前的 class 由 index.html 预置脚本负责）

  function toggle() {
    mode.value = mode.value === 'dark' ? 'light' : 'dark'
  }

  watch(mode, (m) => {
    try {
      localStorage.setItem(STORAGE_KEY, m)
    } catch {
      // 写不进就只做会话内切换
    }
    applyMode(m)
  })

  return { mode, toggle }
})
