import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '@/styles/global.css'
// 图表基元样式（跨页共享的 6 个类，2026-09-14 收敛此前各页 scoped 的漂移定义）
import '@/styles/charts.css'
// 共享表格基座（slot 内容属父组件 scope ⇒ 基座必须是全局类，见文件头）
import '@/styles/chart-table.css'
import '@/mechanics'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
