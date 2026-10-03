import { createRouter, createWebHashHistory } from 'vue-router'
import OverviewView from './views/OverviewView.vue'
import ImpositionView from './views/ImpositionView.vue'
import ProofsView from './views/ProofsView.vue'
import VersionsView from './views/VersionsView.vue'
import ExportView from './views/ExportView.vue'
import PaperReserveView from './views/PaperReserveView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: OverviewView, meta: { title: '生产总览' } },
    { path: '/imposition', component: ImpositionView, meta: { title: '拼版工作区' } },
    { path: '/proofs', component: ProofsView, meta: { title: '打样审批' } },
    { path: '/versions', component: VersionsView, meta: { title: '版本对比' } },
    { path: '/paper', component: PaperReserveView, meta: { title: '纸张预留账' } },
    { path: '/exports', component: ExportView, meta: { title: '导出任务' } },
  ],
})
