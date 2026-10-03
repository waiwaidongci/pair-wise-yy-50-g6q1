import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { paperApi, type PaperBatch, type Reservation, type ReserveInput, type ReserveResult } from '../api/paperApi'
import type { ExportTask } from './imposition'

export type TaskPaperStatus = '已预留' | '待料' | '待复核'

export const useInventoryStore = defineStore('inventory', () => {
  const batches = ref<PaperBatch[]>([])
  const reservations = ref<Reservation[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load() {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      const [b, r] = await Promise.all([paperApi.listBatches(), paperApi.listReservations()])
      batches.value = b.data
      reservations.value = r.data
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  function heldOn(batchId: string): number {
    return reservations.value
      .filter((r) => r.batchId === batchId && r.status === '已占用')
      .reduce((sum, r) => sum + r.quantity, 0)
  }

  function available(batch: PaperBatch): number {
    return batch.sheetCount - heldOn(batch.id)
  }

  function reservationOfTask(taskId: string): Reservation | undefined {
    return reservations.value.find((r) => r.exportTaskId === taskId)
  }

  // 任务纸张状态：
  //  - 已预留：存在「已占用」预留单（已完成任务视为已核销，不再占用库存）
  //  - 待料：未开工（进度 0）且无有效预留，排队等纸
  //  - 待复核：已开工（有分片）但预留单缺失/失效，须重新确认后才能占用库存
  function taskPaperStatus(task: ExportTask): TaskPaperStatus {
    if (task.status === '已完成') return '已预留'
    const active = reservations.value.find((r) => r.exportTaskId === task.id && r.status === '已占用')
    if (active) return '已预留'
    if (task.progress > 0) return '待复核'
    return '待料'
  }

  async function reserve(input: ReserveInput): Promise<ReserveResult> {
    const { data } = await paperApi.reserve(input)
    await refresh()
    return data
  }

  async function release(id: string) {
    await paperApi.release(id)
    await refresh()
  }

  async function updateBatch(id: string, patch: Partial<PaperBatch>) {
    const { data } = await paperApi.updateBatch(id, patch)
    await refresh()
    return data
  }

  async function refresh() {
    const [b, r] = await Promise.all([paperApi.listBatches(), paperApi.listReservations()])
    batches.value = b.data
    reservations.value = r.data
  }

  const activeReservationCount = computed(() => reservations.value.filter((r) => r.status === '已占用').length)
  const invalidatedCount = computed(() => reservations.value.filter((r) => r.status === '已失效').length)

  return {
    batches,
    reservations,
    loading,
    loaded,
    activeReservationCount,
    invalidatedCount,
    load,
    refresh,
    heldOn,
    available,
    reservationOfTask,
    taskPaperStatus,
    reserve,
    release,
    updateBatch,
  }
})
