<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import { useImpositionStore } from '../stores/imposition'
import { exportApi } from '../api/exportApi'

const store = useImpositionStore()
const queryClient = useQueryClient()
const { data: tasks, isPending } = useQuery({
  queryKey: ['export-tasks'],
  queryFn: async () => (await exportApi.list()).data,
  initialData: store.tasks,
})
const resumeMutation = useMutation({
  mutationFn: async (id: string) => (await exportApi.resume(id)).data,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['export-tasks'] }),
})

function statusSeverity(status?: string) {
  return status === '已完成' ? 'success'
    : status === '已中断' ? 'danger'
    : status === '待复核' ? 'danger'
    : status === '生成中' ? 'warn'
    : 'info'
}
function resumeError(id: string) {
  return resumeMutation.variables.value === id
    ? ((resumeMutation.error.value as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null)
    : null
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">EXPORT JOBS / 导出任务</p><h1>交付包与断点恢复</h1><p class="muted">任务开工前必须持有有效预留单；纸批失效后已完成分片保留留档，续作在新纸批上补齐，不混入旧批。</p></div>
      <Button label="去纸张预留账提交生产" icon="pi pi-book" outlined @click="$router.push('/paper')" />
    </div>

    <div class="export-grid">
      <section class="panel">
        <div class="panel-head"><h3>导出队列</h3><span class="muted">预留账统一台账</span></div>
        <div v-if="isPending" class="loading">正在加载导出任务…</div>
        <div v-else class="task-list">
          <article v-for="task in (tasks ?? store.tasks)" :key="task.id" :class="{ blocked: task.frozen || task.status === '待复核' }">
            <div class="task-head">
              <div>
                <strong>{{ task.name }}</strong>
                <small>{{ task.id }} · {{ task.updatedAt }}<template v-if="task.reservationId"> · 预留单 {{ task.reservationId }}</template><template v-else> · 无预留单号</template></small>
              </div>
              <Tag :value="task.status" :severity="statusSeverity(task.status)" />
            </div>
            <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '8px' }" />
            <p v-if="task.blockedReason" class="block-reason"><i class="pi pi-exclamation-triangle" />{{ task.blockedReason }}</p>
            <p v-else-if="resumeError(task.id)" class="block-reason"><i class="pi pi-times-circle" />{{ resumeError(task.id) }}</p>

            <div v-if="task.shards?.length" class="shards">
              <span v-for="s in task.shards" :key="s.id" class="shard" :class="s.state">
                <i :class="s.state === '已完成' ? 'pi pi-check-circle' : s.state === '冻结保留' ? 'pi pi-lock' : 'pi pi-clock'" />
                {{ s.name }}<em>{{ s.batchLabel ?? '未占纸' }}</em>
              </span>
            </div>

            <div class="task-foot">
              <span>{{ task.progress }}% · {{ task.progress === 100 ? '文件哈希已校验' : task.frozen ? '已完成分片保留，禁止混入旧批续作' : '保留已完成分片' }}</span>
              <Button v-if="task.status === '待复核'" label="重新确认纸批" icon="pi pi-book" size="small" severity="warning" @click="$router.push('/paper')" />
              <Button v-else-if="task.frozen" label="到预留账改批重算" icon="pi pi-sync" size="small" severity="warning" outlined @click="$router.push('/paper')" />
              <Button v-else-if="task.resumable && task.status !== '已完成'" label="恢复任务" icon="pi pi-play" size="small" :loading="resumeMutation.isPending.value" @click="resumeMutation.mutate(task.id)" />
              <Button v-else-if="task.status !== '已完成'" label="重新生成" icon="pi pi-refresh" size="small" outlined />
              <Button v-else label="打开结果" icon="pi pi-external-link" size="small" text />
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
            <div><i class="pi pi-book" /><span>纸张预留单号与纸批指纹</span><strong>开工前绑定</strong></div>
          </div>
        </section>
        <section class="panel recovery">
          <div class="panel-head"><h3>恢复说明</h3></div>
          <p>任务分片按 16 页一组写入临时目录。纸批变更触发预留失效后，旧批上已完成的分片保留并单独留档；只有在新纸批上重算预留、版本重新排队后，剩余分片才会续跑，最终重新校验 PDF 页面哈希。</p>
          <Button label="打开纸张预留账" severity="secondary" outlined fluid @click="$router.push('/paper')" />
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.export-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
.loading { padding: 30px; color: #75838a; text-align: center; }
.task-list { padding: 8px 16px 16px; }
.task-list article { padding: 15px 0; border-bottom: 1px solid #e9eeee; }
.task-list article.blocked { background: #fffaf4; margin: 0 -10px; padding-left: 10px; padding-right: 10px; border-radius: 8px; border-bottom-color: #efd9c3; }
.task-head, .task-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.task-head { margin-bottom: 11px; }
.task-head strong, .task-head small { display: block; }
.task-head small { margin-top: 4px; color: #7c898f; font-size: 10px; }
.task-foot { margin-top: 9px; }
.task-foot span { color: #68777e; font-size: 10px; }
.block-reason { margin: 8px 0 0; font-size: 11px; color: #a3562b; display: flex; gap: 6px; align-items: center; }
.shards { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.shard { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; padding: 4px 8px; border-radius: 20px; background: #f2f5f5; color: #68777e; }
.shard em { font-style: normal; color: #98a3a8; }
.shard.已完成 { background: #eef8f2; color: #2f7d58; }
.shard.冻结保留 { background: #fbf3e6; color: #a8722c; }
aside { display: grid; gap: 14px; }
.package-list { padding: 8px 16px 16px; }
.package-list div { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid #edf1f1; font-size: 11px; }
.package-list i { color: #397d64; }
.package-list strong { color: #536b72; font-size: 10px; }
.recovery p { padding: 0 16px; color: #67767d; font-size: 11px; line-height: 1.6; }
.recovery :deep(.p-button) { width: calc(100% - 32px); margin: 12px 16px 16px; }
@media (max-width: 1000px) { .export-grid { grid-template-columns: 1fr; } }
</style>
