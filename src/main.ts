import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '@/styles/global.css'
// 图表基元样式（跨页共享的 6 个类，2026-09-14 收敛此前各页 scoped 的漂移定义）
import '@/styles/charts.css'
import '@/mechanics'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
