<script setup lang="ts">
import { ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import { exportApi } from '../api/exportApi'
import { paperApi, type PaperBatchView, type ProductionVersion, type Reservation } from '../api/paperApi'
import type { ExportTask } from '../stores/imposition'

const props = defineProps<{
  batches: PaperBatchView[]
  versions: ProductionVersion[]
  reservations: Reservation[]
}>()

const queryClient = useQueryClient()
const { data: tasks } = useQuery({
  queryKey: ['export-tasks'],
  queryFn: async () => (await exportApi.list()).data,
  initialData: [] as ExportTask[],
})

const legacyBatch = ref('LOT-7202')
const continueBatch = ref<Record<string, string>>({})

const invalidateAll = () => {
  queryClient.invalidateQueries({ queryKey: ['export-tasks'] })
  queryClient.invalidateQueries({ queryKey: ['paper-batches'] })
  queryClient.invalidateQueries({ queryKey: ['paper-reservations'] })
  queryClient.invalidateQueries({ queryKey: ['paper-versions'] })
}

const confirmMut = useMutation({
  mutationFn: async (p: { id: string; batchId: string }) => (await exportApi.confirmLegacy(p.id, p.batchId)).data,
  onSuccess: invalidateAll,
})
const resumeMut = useMutation({
  mutationFn: async (id: string) => (await exportApi.resume(id)).data,
  onSuccess: invalidateAll,
})
const recalcMut = useMutation({
  mutationFn: async (p: { reservationId: string; batchId: string }) => (await paperApi.recalculate(p.reservationId, p.batchId)).data,
  onSuccess: invalidateAll,
})

function activeFor(task: ExportTask) {
  return props.reservations.find((r) => r.id === task.reservationId)
}
function isBlocked(task: ExportTask) {
  const r = activeFor(task)
  return task.status === '待复核' || task.frozen || r?.status === '缺口'
}
function canResume(task: ExportTask) {
  const r = activeFor(task)
  return task.status !== '已完成' && !isBlocked(task) && !!r && ['已占用', '已开工'].includes(r.status)
}
function errText(err: unknown, forId: string, currentId?: string) {
  if (forId !== currentId) return ''
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? String(err)
}
function continueBatches(task: ExportTask, r?: Reservation) {
  // 新批续作只列出能覆盖剩余用量的纸批
  const need = r ? Math.max(r.requested - r.held, 1) : 100
  return props.batches.filter((b) => b.available >= need)
}
</script>

<template>
  <section class="panel">
    <div class="panel-head"><h3>导出任务与分片留档</h3><Tag value="未开工随预留排队" severity="info" /></div>
    <div class="queue-list">
      <article v-for="task in tasks.filter((t) => t.resumable)" :key="task.id" class="queue-card" :class="{ blocked: isBlocked(task) }">
        <div class="queue-head">
          <div><strong>{{ task.name }}</strong><small>{{ task.id }} · {{ task.updatedAt }}</small></div>
          <Tag :value="task.status" :severity="task.status === '已完成' ? 'success' : task.status === '待复核' ? 'danger' : task.status === '生成中' ? 'info' : 'warn'" />
        </div>
        <ProgressBar :value="task.progress" :showValue="false" :style="{ height: '7px', margin: '8px 0' }" />
        <p v-if="task.blockedReason" class="block-reason"><i class="pi pi-exclamation-triangle" />{{ task.blockedReason }}</p>
        <p v-if="activeFor(task)" class="rsv-link">
          预留单 {{ activeFor(task)!.id }} · {{ activeFor(task)!.status }}
          （{{ activeFor(task)!.held }}/{{ activeFor(task)!.requested }} 张<template v-if="activeFor(task)!.gap"> · 缺口 {{ activeFor(task)!.gap }}</template>）
        </p>
        <p v-if="errText(confirmMut.error.value, task.id, confirmMut.variables.value?.id)" class="block-reason">
          <i class="pi pi-times-circle" />{{ errText(confirmMut.error.value, task.id, confirmMut.variables.value?.id) }}
        </p>
        <p v-if="errText(resumeMut.error.value, task.id, resumeMut.variables.value)" class="block-reason">
          <i class="pi pi-times-circle" />{{ errText(resumeMut.error.value, task.id, resumeMut.variables.value) }}
        </p>

        <div v-if="task.shards?.length" class="shards">
          <div v-for="s in task.shards" :key="s.id" class="shard" :class="s.state">
            <i :class="s.state === '已完成' ? 'pi pi-check-circle' : s.state === '冻结保留' ? 'pi pi-lock' : 'pi pi-clock'" />
            <span>{{ s.name }}</span>
            <small>{{ s.batchLabel ?? '未占纸' }}</small>
          </div>
        </div>

        <!-- 旧任务：无预留单号，必须重新确认纸批后才能占用库存 -->
        <div v-if="task.status === '待复核'" class="queue-op">
          <select v-model="legacyBatch">
            <option v-for="b in batches.filter((b) => b.available > 100)" :key="b.id" :value="b.id">{{ b.id }} · 可预留 {{ b.available }} 张</option>
          </select>
          <Button size="small" label="重新确认纸批并占用" icon="pi pi-check" :loading="confirmMut.isPending.value"
            @click="confirmMut.mutate({ id: task.id, batchId: legacyBatch })" />
        </div>

        <!-- 纸批失效已开工：已完成分片保留，续作必须改到新纸批 -->
        <div v-else-if="task.frozen && activeFor(task)" class="queue-op">
          <select v-model="continueBatch[task.id]">
            <option value="" disabled>在新纸批上重算后续分片…</option>
            <option v-for="b in continueBatches(task, activeFor(task))" :key="b.id" :value="b.id">{{ b.id }} · 可预留 {{ b.available }} 张</option>
          </select>
          <Button size="small" label="改批重算" icon="pi pi-sync" :disabled="!continueBatch[task.id]" :loading="recalcMut.isPending.value"
            @click="recalcMut.mutate({ reservationId: activeFor(task)!.id, batchId: continueBatch[task.id] })" />
        </div>
        <p v-else-if="task.frozen && !activeFor(task)" class="hint">预留已失效且无接替单，请到左侧预留账对失效单改批重算。</p>

        <div v-if="task.status !== '已完成'" class="queue-op">
          <Button size="small" :label="canResume(task) ? '恢复 / 续跑分片' : '恢复被拦截'" icon="pi pi-play"
            :disabled="!canResume(task)" :loading="resumeMut.isPending.value" @click="resumeMut.mutate(task.id)" />
        </div>
        <p v-else class="done-note">全部分片完成，预留已结单。</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.queue-list { padding: 8px 14px 14px; display: grid; gap: 10px; max-height: 720px; overflow: auto; }
.queue-card { border: 1px solid #e3e9e9; border-radius: 9px; padding: 11px 12px; display: grid; gap: 4px; }
.queue-card.blocked { background: #fffaf4; border-color: #efd9c3; }
.queue-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.queue-head small { display: block; color: #8a969c; font-size: 9px; margin-top: 3px; }
.block-reason { margin: 4px 0 0; font-size: 10px; color: #a3562b; display: flex; gap: 5px; align-items: flex-start; }
.rsv-link { margin: 2px 0 0; font-size: 10px; color: #5b7d8a; }
.shards { display: grid; gap: 4px; margin: 6px 0; }
.shard { display: grid; grid-template-columns: 18px 1fr; gap: 2px 6px; font-size: 10px; color: #68777e; align-items: center; }
.shard small { grid-column: 2; color: #98a3a8; }
.shard.已完成 i { color: #3f9a68; }
.shard.冻结保留 { color: #a8722c; }
.shard.冻结保留 i { color: #c7913d; }
.shard.待生成 i { color: #a7b2b7; }
.queue-op { display: flex; gap: 8px; margin-top: 6px; }
.queue-op select { flex: 1; padding: 7px 8px; border: 1px solid #cfd9db; border-radius: 7px; font-size: 11px; }
.done-note { margin: 6px 0 2px; font-size: 10px; color: #3f9a68; }
.hint { margin: 6px 0 2px; font-size: 10px; color: #8a6a3b; }
</style>
