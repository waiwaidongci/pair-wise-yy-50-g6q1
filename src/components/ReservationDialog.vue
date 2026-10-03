<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import Divider from 'primevue/divider'
import { useInventoryStore } from '../stores/inventory'
import { useImpositionStore } from '../stores/imposition'
import { calcSheetUsage, type Alternative, type ReserveResult } from '../api/paperApi'

const props = defineProps<{
  visible: boolean
  preset?: { batchId?: string; taskId?: string; revisionId?: string; orderQty?: number }
}>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  reserved: [reservationId: string]
}>()

const inventory = useInventoryStore()
const imposition = useImpositionStore()

const form = ref({ batchId: '', orderQty: 1000, ups: 8, wasteRate: 0.03, makeReady: 20 })
const result = ref<ReserveResult | null>(null)
const submitting = ref(false)

const pageSize = computed(() => {
  const page = imposition.pages[0]
  return { width: page?.width ?? 210, height: page?.height ?? 297 }
})

const basis = computed(() =>
  calcSheetUsage({
    pageWidth: pageSize.value.width,
    pageHeight: pageSize.value.height,
    ups: form.value.ups,
    orderQty: form.value.orderQty,
    wasteRate: form.value.wasteRate,
    makeReady: form.value.makeReady,
  }),
)

const batchOptions = computed(() =>
  inventory.batches
    .filter((b) => b.status !== '停用')
    .map((b) => ({
      label: `${b.id} · ${b.name} ${b.grammage}g ${b.grain}纸纹（可用 ${inventory.available(b)} 张）`,
      value: b.id,
      available: inventory.available(b),
    })),
)

const selectedBatch = computed(() => inventory.batches.find((b) => b.id === form.value.batchId))
const submitLabel = computed(() => (result.value?.ok ? '已预留' : '确认预留并提交生产'))

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      form.value = {
        batchId: props.preset?.batchId ?? inventory.batches[0]?.id ?? '',
        orderQty: props.preset?.orderQty ?? 1000,
        ups: imposition.positions.length || 8,
        wasteRate: 0.03,
        makeReady: 20,
      }
      result.value = null
    }
  },
)

function close() {
  emit('update:visible', false)
}

async function submit() {
  if (!form.value.batchId) return
  submitting.value = true
  try {
    const task = imposition.tasks.find((t) => t.id === props.preset?.taskId)
    const res = await inventory.reserve({
      batchId: form.value.batchId,
      revisionId: props.preset?.revisionId ?? task?.revisionId ?? imposition.revision,
      exportTaskId: props.preset?.taskId,
      pageWidth: pageSize.value.width,
      pageHeight: pageSize.value.height,
      ups: form.value.ups,
      orderQty: form.value.orderQty,
      wasteRate: form.value.wasteRate,
      makeReady: form.value.makeReady,
      operator: '当前用户',
    })
    result.value = res
    if (res.ok) emit('reserved', res.reservation.id)
  } finally {
    submitting.value = false
  }
}

async function pickAlternative(alt: Alternative) {
  form.value.batchId = alt.id
  result.value = null
  await submit()
}
</script>

<template>
  <Dialog :visible="visible" modal header="提交生产 · 纸张预留" :style="{ width: '640px', maxWidth: '94vw' }" @update:visible="emit('update:visible', $event)">
    <div class="reserve-form">
      <Message severity="info" :closable="false">
        提交生产前按版位尺寸、放数与裁切损耗算出印张用量，从指定纸批预留。两个调度同时提交同一纸批时，先到者占用，后到者取得缺口与可替代纸批。
      </Message>

      <div class="field">
        <label>指定纸批</label>
        <Select v-model="form.batchId" :options="batchOptions" optionLabel="label" optionValue="value" placeholder="选择纸批" />
        <small v-if="selectedBatch">{{ selectedBatch.name }} · {{ selectedBatch.width }}×{{ selectedBatch.height }}mm · {{ selectedBatch.grammage }}g · {{ selectedBatch.grain }}纸纹 · 库位 {{ selectedBatch.location }}</small>
      </div>

      <div class="calc-grid">
        <div class="field"><label>版位尺寸 (mm)</label><div class="static">{{ pageSize.width }} × {{ pageSize.height }}</div></div>
        <div class="field"><label>放数（页/印张）</label><InputNumber v-model="form.ups" :min="1" :max="64" :showButtons="true" /></div>
        <div class="field"><label>印数（份）</label><InputNumber v-model="form.orderQty" :min="1" :showButtons="true" /></div>
        <div class="field"><label>裁切损耗率</label><InputNumber v-model="form.wasteRate" :min="0" :max="0.2" :minFractionDigits="2" :maxFractionDigits="2" :step="0.01" mode="decimal" /></div>
        <div class="field"><label>校版损耗（张）</label><InputNumber v-model="form.makeReady" :min="0" :max="500" :showButtons="true" /></div>
      </div>

      <div class="basis">
        <div><span>理论印张</span><strong>{{ basis.theoretical }} 张</strong></div>
        <div><span>裁切损耗</span><strong>+ {{ basis.cuttingWaste }} 张</strong></div>
        <div><span>校版损耗</span><strong>+ {{ basis.makeReady }} 张</strong></div>
        <Divider />
        <div class="total"><span>印张用量</span><strong>{{ basis.total }} 张</strong></div>
      </div>

      <div v-if="result && result.ok" class="result-ok">
        <Message severity="success" :closable="false">
          预留成功 · 预留单号 <b>{{ result.reservation.id }}</b>，已从 {{ selectedBatch?.id }} 占用 {{ result.reservation.quantity }} 张。
        </Message>
      </div>
      <div v-else-if="result && !result.ok" class="result-short">
        <Message severity="error" :closable="false">
          该纸批可用 {{ result.available }} 张，需 {{ result.required }} 张，缺口 <b>{{ result.shortage }}</b> 张（该纸批已被先到调度占用）。
        </Message>
        <div v-if="result.alternatives.length" class="alt-list">
          <p>可替代纸批（同规格、有库存）：</p>
          <button v-for="alt in result.alternatives" :key="alt.id" class="alt-item" @click="pickAlternative(alt)">
            <div>
              <strong>{{ alt.id }} · {{ alt.name }}</strong>
              <small>{{ alt.width }}×{{ alt.height }}mm · {{ alt.grammage }}g · 可用 {{ alt.available }} 张</small>
            </div>
            <div class="alt-tags">
              <Tag v-for="d in alt.diffs" :key="d" :value="d" severity="warn" />
              <Tag value="选用" severity="success" />
            </div>
          </button>
        </div>
        <p v-else class="no-alt">暂无同规格可替代纸批，请调整印数或等待纸批补货。</p>
      </div>
    </div>

    <template #footer>
      <Button label="取消" text @click="close" />
      <Button :label="submitLabel" icon="pi pi-check" :loading="submitting" :disabled="!form.batchId || result?.ok" @click="submit" />
    </template>
  </Dialog>
</template>

<style scoped>
.reserve-form { display: grid; gap: 14px; }
.field { display: grid; gap: 5px; }
.field label { color: #5f7076; font-size: 11px; font-weight: 700; }
.field small { color: #7c898e; font-size: 10px; }
.field .static { padding: 9px 10px; border: 1px solid #cbd5d7; border-radius: 6px; background: #f6f8f8; font-size: 13px; }
.calc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.basis { display: grid; gap: 6px; padding: 12px 14px; border: 1px solid #dce3e4; border-radius: 8px; background: #f7faf9; font-size: 12px; }
.basis > div { display: flex; align-items: center; justify-content: space-between; }
.basis span { color: #6b7a80; }
.basis strong { color: #26373d; }
.basis .total strong { color: #b84e35; font-size: 16px; }
.result-ok, .result-short { display: grid; gap: 10px; }
.alt-list { display: grid; gap: 7px; }
.alt-list p { margin: 0; color: #6b7a80; font-size: 11px; }
.alt-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid #cfe0dd; border-radius: 7px; background: #f3f9f7; cursor: pointer; text-align: left; }
.alt-item:hover { border-color: #3b8a7a; background: #eaf5f2; }
.alt-item strong, .alt-item small { display: block; }
.alt-item small { margin-top: 3px; color: #7c898e; font-size: 10px; }
.alt-tags { display: flex; gap: 5px; }
.no-alt { margin: 0; color: #b84e35; font-size: 11px; }
</style>
