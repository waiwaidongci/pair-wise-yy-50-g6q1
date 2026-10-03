<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { useImpositionStore, type ExportTask } from '../stores/imposition'
import { useInventoryStore } from '../stores/inventory'
import { exportApi } from '../api/exportApi'
import ReservationDialog from '../components/ReservationDialog.vue'

const store = useImpositionStore()
const inventory = useInventoryStore()
const queryClient = useQueryClient()

onMounted(() => inventory.load())

const { data: tasks, isPending } = useQuery({
  queryKey: ['export-tasks'],
  queryFn: async () => (await exportApi.list()).data,
  initialData: store.tasks,
})
const resumeMutation = useMutation({
  mutationFn: async (id: string) => (await exportApi.resume(id)).data,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['export-tasks'] }),
})
const createMutation = useMutation({
  mutationFn: async (task: ExportTask) => (await exportApi.create(task)).data,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['export-tasks'] }),
})

const reserveVisible = ref(false)
const reservePreset = ref<{ taskId?: string; revisionId?: string }>({})

function openReserve(task: ExportTask) {
  reservePreset.value = { taskId: task.id, revisionId: task.revisionId }
  reserveVisible.value = true
}

function newTask() {
  const id = `EXP-${Date.now().toString().slice(-6)}`
  const task: ExportTask = {
    id,
    name: '印刷交付包 · PDF/X-4',
    progress: 0,
    status: '排队中',
    updatedAt: '刚刚',
    resumable: true,
    revisionId: store.revision,
    slices: 0,
    totalSlices: 24,
  }
  createMutation.mutate(task)
  reservePreset.value = { taskId: id, revisionId: task.revisionId }
  reserveVisible.value = true
}

function statusSeverity(status?: string) {
  return status === '已完成' ? 'success' : status === '已中断' ? 'danger' : status === '生成中' ? 'warn' : 'info'
}
function paperSeverity(status: string) {
  return status === '已预留' ? 'success' : status === '待料' ? 'warn' : 'danger'
}
function reservationIdOf(task: ExportTask) {
  return inventory.reservations.find((r) => r.exportTaskId === task.id && (r.status === '已占用' || r.status === '已核销'))?.id
}

function onReserved() {
  inventory.refresh()
  queryClient.invalidateQueries({ queryKey: ['export-tasks'] })
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">EXPORT JOBS / 导出任务</p>
        <h1>交付包与断点恢复</h1>
        <p class="muted">中断任务保留已完成分片；续作前必须有有效的纸张预留单，纸批变更后须重新确认，不得混入旧纸批。</p>
      </div>
      <Button label="新建印刷交付包" icon="pi pi-plus" @click="newTask" />
    </div>

    <Message severity="info" :closable="false" class="mb-3">
      未开工拼版与关联导出任务在纸张预留生效前排队；预留单因纸批规格 / 纸纹 / 数量变更失效后，已完成分片保留但须重新确认预留单才能继续占用库存。
    </Message>

    <div class="export-grid">
      <section class="panel">
        <div class="panel-head"><h3>导出队列</h3><span class="muted">Axios 模拟 REST</span></div>
        <div v-if="isPending" class="loading">正在加载导出任务…</div>
        <div v-else class="task-list">
          <article v-for="task in (tasks ?? store.tasks)" :key="task.id">
            <div class="task-head">
              <div>
                <strong>{{ task.name }}</strong>
                <small>{{ task.id }} · {{ task.updatedAt }}<template v-if="reservationIdOf(task)"> · 预留单 {{ reservationIdOf(task) }}</template></small>
              </div>
              <div class="tags">
                <Tag :value="task.status" :severity="statusSeverity(task.status)" />
                <Tag :value="inventory.taskPaperStatus(task)" :severity="paperSeverity(inventory.taskPaperStatus(task))" />
              </div>
            </div>
            <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '8px' }" />
            <div class="task-foot">
              <span>{{ task.progress }}%<template v-if="task.slices"> · 已完成 {{ task.slices }}/{{ task.totalSlices }} 分片</template></span>
              <template v-if="task.status !== '已完成'">
                <Button
                  v-if="inventory.taskPaperStatus(task) === '已预留'"
                  label="恢复任务"
                  icon="pi pi-play"
                  size="small"
                  :loading="resumeMutation.isPending.value"
                  @click="resumeMutation.mutate(task.id)"
                />
                <Button
                  v-else
                  :label="inventory.taskPaperStatus(task) === '待料' ? '预留纸张后开工' : '重新确认预留单'"
                  icon="pi pi-lock"
                  size="small"
                  severity="warn"
                  @click="openReserve(task)"
                />
              </template>
              <Button v-else label="打开结果" icon="pi pi-external-link" size="small" text />
            </div>
            <div v-if="inventory.taskPaperStatus(task) === '待复核'" class="paper-note">
              <i class="pi pi-info-circle" />
              <span>旧任务无有效预留单（或纸批已变更失效）。已完成的 {{ task.slices }}/{{ task.totalSlices }} 分片已保留，重新确认预留单后可继续生成，不会复用旧纸批。</span>
            </div>
            <div v-else-if="inventory.taskPaperStatus(task) === '待料'" class="paper-note wait">
              <i class="pi pi-hourglass" />
              <span>拼版尚未开工，正在排队等待纸张预留；预留生效后自动进入生产。</span>
            </div>
          </article>
        </div>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-head"><h3>交付包内容</h3><Tag :value="store.revision" /></div>
          <div class="package-list">
            <div><i class="pi pi-file-pdf" /><span>拼版 PDF/X-4</span><strong>待生成</strong></div>
            <div><i class="pi pi-check-circle" /><span>预检报告 JSON</span><strong>{{ store.validations.length }} 项</strong></div>
            <div><i class="pi pi-check-circle" /><span>色彩控制条报告</span><strong>已包含</strong></div>
            <div><i class="pi pi-check-circle" /><span>打样审批记录</span><strong>{{ store.proofs.length }} 轮</strong></div>
            <div><i class="pi pi-check-circle" /><span>纸张预留单</span><strong>{{ inventory.activeReservationCount }} 张有效</strong></div>
          </div>
        </section>
        <section class="panel recovery">
          <div class="panel-head"><h3>恢复说明</h3></div>
          <p>任务分片按 16 页一组写入临时目录。纸批规格、纸纹方向或剩余数量变更后，原预留单失效并重新核算；已完成分片继续复用，但必须凭新预留单续作，不得混入旧纸批。</p>
          <Button label="清理已完成任务" severity="secondary" outlined fluid />
        </section>
      </aside>
    </div>

    <ReservationDialog v-model:visible="reserveVisible" :preset="reservePreset" @reserved="onReserved" />
  </section>
</template>

<style scoped>
.export-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
.mb-3 { margin-bottom: 12px; }
.loading { padding: 30px; color: #75838a; text-align: center; }
.task-list { padding: 8px 16px 16px; }
.task-list article { padding: 15px 0; border-bottom: 1px solid #e9eeee; }
.task-head, .task-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.task-head { margin-bottom: 11px; }
.task-head strong, .task-head small { display: block; }
.task-head small { margin-top: 4px; color: #7c898e; font-size: 10px; }
.tags { display: flex; gap: 5px; }
.task-foot { margin-top: 9px; }
.task-foot > span { color: #68777e; font-size: 10px; }
.paper-note { display: flex; gap: 7px; margin-top: 9px; padding: 8px 10px; border-radius: 6px; background: #fdf3e7; color: #8a6d3b; font-size: 11px; line-height: 1.5; }
.paper-note.wait { background: #eef6f4; color: #3b6f66; }
.package-list { padding: 8px 16px 16px; }
.package-list div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid #edf1f1; font-size: 11px; }
.package-list i { color: #397d64; }
.package-list strong { color: #536b72; font-size: 10px; }
.recovery p { padding: 0 16px; color: #67767d; font-size: 11px; line-height: 1.6; }
.recovery :deep(.p-button) { width: calc(100% - 32px); margin: 0 16px 16px; }
@media (max-width: 1000px) { .export-grid { grid-template-columns: 1fr; } }
</style>
