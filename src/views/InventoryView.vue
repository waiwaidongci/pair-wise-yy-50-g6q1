<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import { useInventoryStore } from '../stores/inventory'
import { useImpositionStore } from '../stores/imposition'
import { paperApi, type PaperBatch, type ReserveResult } from '../api/paperApi'
import ReservationDialog from '../components/ReservationDialog.vue'

const inventory = useInventoryStore()
const imposition = useImpositionStore()

onMounted(() => inventory.load())

// ---- 预留对话框 ----
const reserveVisible = ref(false)
const reservePreset = ref<{ batchId?: string; taskId?: string; revisionId?: string; orderQty?: number }>({})
function openReserve(batchId?: string) {
  reservePreset.value = { batchId }
  reserveVisible.value = true
}

// ---- 纸批变动（规格 / 纸纹 / 数量 → 失效重算） ----
const editVisible = ref(false)
const editForm = ref<{ id: string; sheetCount: number; grain: '纵向' | '横向'; grammage: number; paperType: string }>({
  id: '', sheetCount: 0, grain: '纵向', grammage: 157, paperType: '',
})
const editResult = ref<{ invalidated: number } | null>(null)
const savingEdit = ref(false)

function openEdit(batch: PaperBatch) {
  editForm.value = { id: batch.id, sheetCount: batch.sheetCount, grain: batch.grain, grammage: batch.grammage, paperType: batch.paperType }
  editResult.value = null
  editVisible.value = true
}
async function saveEdit() {
  savingEdit.value = true
  try {
    const res = await inventory.updateBatch(editForm.value.id, {
      sheetCount: editForm.value.sheetCount,
      grain: editForm.value.grain,
      grammage: editForm.value.grammage,
      paperType: editForm.value.paperType,
    })
    editResult.value = { invalidated: res.invalidated.length }
  } finally {
    savingEdit.value = false
  }
}

// ---- 并发提交演练：两个调度同时锁定同一纸批 ----
const drillVisible = ref(false)
const drillRunning = ref(false)
const drillResults = ref<{ who: string; res: ReserveResult }[]>([])
async function runDrill() {
  drillRunning.value = true
  drillResults.value = []
  drillVisible.value = true
  const payload = {
    batchId: 'PAP-2609-01',
    revisionId: 'R6',
    pageWidth: 210,
    pageHeight: 297,
    ups: 8,
    orderQty: 20000,
    wasteRate: 0.03,
    makeReady: 20,
  }
  try {
    const [a, b] = await Promise.all([
      paperApi.reserve({ ...payload, operator: '调度 A' }),
      paperApi.reserve({ ...payload, operator: '调度 B' }),
    ])
    drillResults.value = [
      { who: '调度 A（先提交）', res: a.data },
      { who: '调度 B（后提交）', res: b.data },
    ]
    await inventory.refresh()
  } finally {
    drillRunning.value = false
  }
}

function releaseDrill() {
  for (const item of drillResults.value) {
    if (item.res.ok) inventory.release(item.res.reservation.id)
  }
  drillResults.value = []
}

function taskName(taskId?: string) {
  if (!taskId) return '—'
  return imposition.tasks.find((t) => t.id === taskId)?.name ?? taskId
}
function batchName(batchId: string) {
  return inventory.batches.find((b) => b.id === batchId)
}
function reservationSeverity(status: string) {
  return status === '已占用' ? 'info' : status === '已核销' ? 'success' : status === '已失效' ? 'danger' : 'secondary'
}
function batchSeverity(status: string) {
  return status === '可用' ? 'success' : status === '偏低' ? 'warn' : 'danger'
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">PAPER RESERVATION / 纸张库存预留账</p>
        <h1>纸批库存与生产预留</h1>
        <p class="muted">提交生产前按版位尺寸、放数与裁切损耗锁定印张用量；先到者占用，后到者取得缺口与可替代纸批。</p>
      </div>
      <div class="actions">
        <Button label="并发提交演练" icon="pi pi-bolt" outlined @click="runDrill" />
        <Button label="新建生产预留" icon="pi pi-plus" @click="openReserve()" />
      </div>
    </div>

    <div class="metric-grid">
      <article class="metric"><span>可用纸批</span><strong>{{ inventory.batches.filter((b) => b.status !== '停用').length }}</strong><small>规格 / 纸纹 / 库位</small></article>
      <article class="metric"><span>已占用预留</span><strong>{{ inventory.activeReservationCount }}</strong><small>锁定中印张</small></article>
      <article class="metric"><span>已失效预留</span><strong class="error">{{ inventory.invalidatedCount }}</strong><small>待重新核算确认</small></article>
      <article class="metric"><span>待复核 / 待料任务</span><strong class="error">{{ imposition.tasks.filter((t) => inventory.taskPaperStatus(t) !== '已预留').length }}</strong><small>占用库存前须重新确认</small></article>
    </div>

    <section class="panel">
      <div class="panel-head"><h3>纸批库存</h3><span class="muted">数量、纸纹或规格变更将使关联预留单失效重算</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>纸批号</th><th>名称 / 规格</th><th>纸纹</th><th>剩余数量</th><th>已预留</th><th>可用</th><th>库位</th><th>状态</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="batch in inventory.batches" :key="batch.id">
              <td><strong>{{ batch.id }}</strong></td>
              <td>
                <div class="cell-main">{{ batch.name }} · {{ batch.grammage }}g</div>
                <small>{{ batch.width }}×{{ batch.height }}mm · {{ batch.paperType }}</small>
              </td>
              <td>{{ batch.grain }}</td>
              <td>{{ batch.sheetCount }} 张</td>
              <td class="held">{{ inventory.heldOn(batch.id) }} 张</td>
              <td><strong class="avail">{{ inventory.available(batch) }} 张</strong></td>
              <td>{{ batch.location }}</td>
              <td><Tag :value="batch.status" :severity="batchSeverity(batch.status)" /></td>
              <td class="row-actions">
                <Button label="变动" icon="pi pi-pencil" text size="small" @click="openEdit(batch)" />
                <Button label="预留" icon="pi pi-lock" text size="small" @click="openReserve(batch.id)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel ledger">
      <div class="panel-head"><h3>预留台账</h3><span class="muted">每张预留单关联纸批、拼版版本与导出任务</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>预留单号</th><th>纸批</th><th>拼版版本</th><th>关联导出任务</th><th>印张用量（计算依据）</th><th>状态</th><th>操作人</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="r in inventory.reservations" :key="r.id" :class="{ invalid: r.status === '已失效' }">
              <td>
                <strong>{{ r.id }}</strong>
                <small>{{ r.createdAt }}</small>
              </td>
              <td>{{ r.batchId }}<small v-if="batchName(r.batchId)">{{ batchName(r.batchId)?.name }}</small></td>
              <td><Tag :value="r.revisionId" severity="info" /></td>
              <td class="task-cell">{{ r.exportTaskId ?? '—' }}<small>{{ taskName(r.exportTaskId) }}</small></td>
              <td>
                <strong>{{ r.quantity }} 张</strong>
                <small>{{ r.basis.pageWidth }}×{{ r.basis.pageHeight }} · 放数 {{ r.basis.ups }} · 印数 {{ r.basis.orderQty }} · 损耗 {{ Math.round(r.basis.wasteRate * 100) }}%</small>
              </td>
              <td>
                <Tag :value="r.status" :severity="reservationSeverity(r.status)" />
                <small v-if="r.status === '已失效'" class="invalid-reason">{{ r.invalidReason }}</small>
              </td>
              <td>{{ r.operator }}</td>
              <td>
                <Button v-if="r.status === '已占用'" label="释放" icon="pi pi-undo" text size="small" severity="secondary" @click="inventory.release(r.id)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ReservationDialog v-model:visible="reserveVisible" :preset="reservePreset" @reserved="() => inventory.refresh()" />

    <!-- 纸批变动 -->
    <Dialog v-model:visible="editVisible" modal header="纸批变动 · 失效重算" :style="{ width: '480px', maxWidth: '94vw' }">
      <div class="edit-form">
        <Message severity="warn" :closable="false">
          变更纸批规格、纸纹方向或剩余数量后，该纸批上所有「已占用」预留单将作废重算；未开工拼版与关联导出任务排队，已完成分片保留但须重新确认预留单才能续作，且不得混入旧纸批。
        </Message>
        <div class="field"><label>纸批号</label><div class="static">{{ editForm.id }}</div></div>
        <div class="field"><label>剩余数量（张）</label><InputNumber v-model="editForm.sheetCount" :min="0" :showButtons="true" /></div>
        <div class="field"><label>纸纹方向</label>
          <Select v-model="editForm.grain" :options="['纵向', '横向']" />
        </div>
        <div class="field"><label>克重（g/m²）</label><InputNumber v-model="editForm.grammage" :min="40" :max="400" :showButtons="true" /></div>
        <div class="field"><label>纸种</label><InputText v-model="editForm.paperType" />
        </div>
        <Message v-if="editResult" severity="error" :closable="false">
          已作废 {{ editResult.invalidated }} 张预留单，关联导出任务已进入待复核/排队。
        </Message>
      </div>
      <template #footer>
        <Button label="取消" text @click="editVisible = false" />
        <Button label="保存并失效重算" icon="pi pi-refresh" :loading="savingEdit" @click="saveEdit" />
      </template>
    </Dialog>

    <!-- 并发演练结果 -->
    <Dialog v-model:visible="drillVisible" modal header="并发提交演练 · 先到者占用" :style="{ width: '560px', maxWidth: '94vw' }">
      <div v-if="drillRunning" class="drill-loading">正在同时提交两个预留请求…</div>
      <div v-else class="drill-results">
        <article v-for="item in drillResults" :key="item.who" :class="['drill-card', item.res.ok ? 'ok' : 'short']">
          <div class="drill-head">
            <strong>{{ item.who }}</strong>
            <Tag :value="item.res.ok ? '已占用' : '缺口'" :severity="item.res.ok ? 'success' : 'danger'" />
          </div>
          <template v-if="item.res.ok">
            <p>预留单号 <b>{{ item.res.reservation.id }}</b>，占用 {{ item.res.reservation.quantity }} 张。</p>
          </template>
          <template v-else>
            <p>可用 {{ item.res.available }} 张，需 {{ item.res.required }} 张，缺口 <b>{{ item.res.shortage }}</b> 张。</p>
            <div v-if="item.res.alternatives.length" class="alt-list">
              <p>可替代纸批：</p>
              <span v-for="alt in item.res.alternatives" :key="alt.id" class="alt-chip">{{ alt.id }} · {{ alt.name }} {{ alt.grain }} · 可用 {{ alt.available }}</span>
            </div>
          </template>
        </article>
        <p class="drill-note">两个调度提交同一纸批时，系统以互斥锁串行化：先到者锁定库存，后到者立即拿到缺口与可替代纸批，不会出现导出到一半缺纸。</p>
      </div>
      <template #footer>
        <Button label="关闭" text @click="drillVisible = false" />
        <Button label="释放演练预留" icon="pi pi-undo" severity="secondary" outlined @click="releaseDrill" />
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; }
.metric .error { color: #b84e35; }
.table-wrap { overflow-x: auto; padding: 4px 16px 16px; }
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th { padding: 10px 8px; border-bottom: 1px solid #e2e8e9; color: #6b7a80; text-align: left; font-size: 11px; font-weight: 700; white-space: nowrap; }
.data-table td { padding: 11px 8px; border-bottom: 1px solid #eef2f2; vertical-align: top; }
.data-table td strong { font-size: 12px; }
.data-table small { display: block; margin-top: 3px; color: #7c898e; font-size: 10px; }
.cell-main { white-space: nowrap; }
.held { color: #8a6d3b; }
.avail { color: #2f6f5e; }
.row-actions { white-space: nowrap; text-align: right; }
.ledger { margin-top: 14px; }
tr.invalid { background: #fdf3f1; }
.invalid-reason { max-width: 220px; color: #b84e35 !important; }
.task-cell { white-space: nowrap; }
.edit-form { display: grid; gap: 13px; }
.field { display: grid; gap: 5px; }
.field label { color: #5f7076; font-size: 11px; font-weight: 700; }
.field .static { padding: 9px 10px; border: 1px solid #cbd5d7; border-radius: 6px; background: #f6f8f8; font-size: 13px; }
.drill-loading { padding: 30px; color: #75838a; text-align: center; }
.drill-results { display: grid; gap: 12px; }
.drill-card { padding: 14px; border: 1px solid #dce3e4; border-radius: 9px; }
.drill-card.ok { border-color: #bfe0d4; background: #f3faf7; }
.drill-card.short { border-color: #e6c3bb; background: #fdf4f2; }
.drill-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.drill-head { display: flex; align-items: center; justify-content: space-between; }
.drill-card p { margin: 0; color: #4c5d63; font-size: 12px; }
.alt-list { margin-top: 9px; display: grid; gap: 6px; }
.alt-list p { color: #6b7a80; font-size: 11px; }
.alt-chip { display: inline-block; width: fit-content; padding: 4px 9px; border-radius: 5px; background: #eef4f4; font-size: 11px; }
.drill-note { margin: 4px 0 0; color: #7c898e; font-size: 11px; line-height: 1.6; }
</style>
