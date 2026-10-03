<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import QueuePanel from '../components/QueuePanel.vue'
import { paperApi, type PaperBatchView, type ProductionVersion, type RaceOutcome, type Reservation } from '../api/paperApi'
import { calcDemand } from '../api/reservationServer'

const queryClient = useQueryClient()
const invalidate = () => {
  queryClient.invalidateQueries({ queryKey: ['paper-batches'] })
  queryClient.invalidateQueries({ queryKey: ['paper-reservations'] })
  queryClient.invalidateQueries({ queryKey: ['paper-versions'] })
  queryClient.invalidateQueries({ queryKey: ['export-tasks'] })
}

const { data: batches } = useQuery({ queryKey: ['paper-batches'], queryFn: async () => (await paperApi.batches()).data, initialData: [] as PaperBatchView[] })
const { data: versions } = useQuery({ queryKey: ['paper-versions'], queryFn: async () => (await paperApi.versions()).data, initialData: [] as ProductionVersion[] })
const { data: reservations } = useQuery({ queryKey: ['paper-reservations'], queryFn: async () => (await paperApi.reservations()).data, initialData: [] as Reservation[] })

/* ---------------- ① 提交生产：算用量 + 预留 ---------------- */

const selectedVersion = ref('VER-R6')
const selectedBatch = ref('LOT-7201')
const copiesOverride = ref<number | null>(null)
const oversOverride = ref<number | null>(null)
const wasteOverride = ref<number | null>(null)
const submitResult = ref<Reservation | null>(null)

const version = computed(() => versions.value.find((v) => v.id === selectedVersion.value))
const previewCalc = computed(() => {
  if (!version.value) return null
  return calcDemand({
    copies: copiesOverride.value ?? version.value.copies,
    pages: version.value.pages,
    platesPerSheet: version.value.platesPerSheet,
    oversPercent: oversOverride.value ?? version.value.oversPercent,
    wastePercent: wasteOverride.value ?? version.value.wastePercent,
  })
})
const targetBatch = computed(() => batches.value.find((b) => b.id === selectedBatch.value))
const previewAfter = computed(() => (targetBatch.value && previewCalc.value ? targetBatch.value.available - previewCalc.value.requiredSheets : null))

const submitMutation = useMutation({
  mutationFn: async () => {
    submitResult.value = null
    return (await paperApi.submit({
      versionId: selectedVersion.value,
      batchId: selectedBatch.value,
      copies: copiesOverride.value ?? undefined,
      oversPercent: oversOverride.value ?? undefined,
      wastePercent: wasteOverride.value ?? undefined,
    })).data
  },
  onSuccess: (data) => { submitResult.value = data; invalidate() },
})
const submitError = computed(() => (submitMutation.isError.value ? errorText(submitMutation.error.value) : null))
function errorText(err: unknown): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? String(err)
}

/* ---------------- ② 双调度同时提交同一纸批 ---------------- */

const raceResult = ref<RaceOutcome[] | null>(null)
const raceMutation = useMutation({
  mutationFn: async () => {
    raceResult.value = null
    return (await paperApi.race(['VER-R6', 'VER-S2'], 'LOT-7201')).data
  },
  onSuccess: (data) => { raceResult.value = data; invalidate() },
})

/* ---------------- ③ 纸批变更：被领走 / 纸纹变化 ---------------- */

const adjustMutation = useMutation({
  mutationFn: async (payload: { batchId: string; patch: Partial<PaperBatchView> }) => (await paperApi.adjustBatch(payload.batchId, payload.patch)).data,
  onSuccess: () => invalidate(),
})

/* ---------------- ④ 缺口改占 / 释放 ---------------- */

const recalcMutation = useMutation({
  mutationFn: async (payload: { reservationId: string; batchId: string }) => (await paperApi.recalculate(payload.reservationId, payload.batchId)).data,
  onSuccess: () => invalidate(),
})
const releaseMutation = useMutation({
  mutationFn: async (id: string) => (await paperApi.release(id)).data,
  onSuccess: () => invalidate(),
})

const resetMutation = useMutation({
  mutationFn: async () => (await paperApi.reset()).data,
  onSuccess: () => { submitResult.value = null; raceResult.value = null; invalidate() },
})

function statusSeverity(status: string): 'success' | 'danger' | 'warn' | 'info' | 'secondary' {
  return status === '已占用' || status === '已完成' ? 'success'
    : status === '缺口' ? 'danger'
    : status === '已开工' ? 'info'
    : status === '已失效' ? 'warn'
    : 'secondary'
}

const ledger = computed(() => [...reservations.value].sort((a, b) => b.seq - a.seq))

function onRecalcSelect(reservationId: string, event: Event) {
  const select = event.target as HTMLSelectElement
  const batchId = String(select.value)
  if (batchId) recalcMutation.mutate({ reservationId, batchId })
  select.value = ''
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">PAPER RESERVATION LEDGER / 纸张预留账</p>
        <h1>纸批库存 × 拼版版本 × 导出任务</h1>
        <p class="muted">提交生产前按版位尺寸、放数与裁切损耗核算印张用量并从指定纸批预留；同批并发先到先占，纸批指纹一变即失效重算。</p>
      </div>
      <Button label="重置台账演示数据" icon="pi pi-refresh" severity="secondary" outlined :loading="resetMutation.isPending.value" @click="resetMutation.mutate()" />
    </div>

    <div class="ledger-grid">
      <div class="ledger-main">
        <!-- ① 提交生产 -->
        <section class="panel">
          <div class="panel-head"><h3>① 提交生产前预留</h3><Tag value="用量自动核算" severity="info" /></div>
          <div class="submit-body">
            <div class="form-grid">
              <label>拼版版本
                <select v-model="selectedVersion">
                  <option v-for="v in versions" :key="v.id" :value="v.id">{{ v.id }} · {{ v.name }}（{{ v.copies }} 册 / {{ v.pages }}P）</option>
                </select>
              </label>
              <label>指定纸批
                <select v-model="selectedBatch">
                  <option v-for="b in batches" :key="b.id" :value="b.id">{{ b.id }} · {{ b.grade }} · {{ b.grain }} · 可预留 {{ b.available }} 张</option>
                </select>
              </label>
              <label>印数（覆盖版本默认）<input v-model.number="copiesOverride" type="number" min="1" placeholder="默认取版本印数" /></label>
              <label>放数 %<input v-model.number="oversOverride" type="number" min="0" step="0.5" placeholder="默认取版本放数" /></label>
              <label>裁切损耗 %<input v-model.number="wasteOverride" type="number" min="0" step="0.1" placeholder="默认取版本损耗" /></label>
            </div>

            <div v-if="previewCalc && version" class="calc-box">
              <div class="calc-row"><span>版位尺寸</span><strong>{{ version.sheetWidth }} × {{ version.sheetHeight }}mm · {{ version.platesPerSheet }} 版位/张 · 纸纹{{ version.grain }}</strong></div>
              <div class="calc-row"><span>每册印张</span><strong>⌈{{ previewCalc.impressions }} ÷ {{ previewCalc.platesPerSheet }}⌉ = {{ previewCalc.sheetsPerCopy }} 张/册</strong></div>
              <div class="calc-row"><span>放数后用纸</span><strong>{{ previewCalc.copies }} × {{ previewCalc.sheetsPerCopy }} × (1+{{ previewCalc.oversPercent }}%) = {{ previewCalc.netSheets }} 张</strong></div>
              <div class="calc-row total"><span>预留印张（含裁切损耗 {{ previewCalc.wastePercent }}%）</span><strong>{{ previewCalc.requiredSheets }} 张</strong></div>
              <div v-if="targetBatch" class="calc-row" :class="(previewAfter ?? 0) >= 0 ? 'ok' : 'short'">
                <span>提交后 {{ targetBatch.id }} 可预留余量</span>
                <strong>{{ previewAfter }} 张（{{ (previewAfter ?? 0) >= 0 ? '足够占用' : `缺口 ${Math.abs(previewAfter ?? 0)} 张` }}）</strong>
              </div>
              <div>
                <Button label="提交生产并预留" icon="pi pi-lock" :loading="submitMutation.isPending.value" @click="submitMutation.mutate()" />
              </div>
            </div>

            <div v-if="submitResult" class="result" :class="submitResult.status === '已占用' ? 'ok' : 'gap'">
              <div class="result-head">
                <Tag :value="submitResult.status" :severity="statusSeverity(submitResult.status)" />
                <strong>{{ submitResult.id }} · 序号 #{{ submitResult.seq }}</strong>
                <span class="muted">{{ submitResult.createdAt }}</span>
              </div>
              <p v-if="submitResult.status === '已占用'">已从 {{ submitResult.batchId }} 预留 <strong>{{ submitResult.held }}</strong> 张，版本 {{ submitResult.versionName }} 与关联导出任务已进入排队。</p>
              <template v-else>
                <p>仅占用 {{ submitResult.held }} 张，<strong>缺口 {{ submitResult.gap }} 张</strong>，任务排队等待补纸或改批。可替代纸批：</p>
                <div v-for="alt in submitResult.alternatives.filter((a) => a.match === '规格一致' || a.match === '等级差异')" :key="alt.batchId" class="alt-row">
                  <div><strong>{{ alt.label }}</strong><small>{{ alt.reason }} · 可预留 {{ alt.atp }} 张</small></div>
                  <Tag :value="alt.match" :severity="alt.match === '规格一致' ? 'success' : 'warn'" />
                  <Button size="small" :label="alt.covers ? `改占 ${alt.batchId}` : '库存不足'" :disabled="!alt.covers"
                    @click="recalcMutation.mutate({ reservationId: submitResult!.id, batchId: alt.batchId })" />
                </div>
              </template>
            </div>
            <div v-if="submitError" class="banner error"><i class="pi pi-times-circle" />{{ submitError }}</div>
          </div>
        </section>

        <!-- ② 双调度 -->
        <section class="panel">
          <div class="panel-head"><h3>② 两个调度同时提交同一纸批</h3><Tag value="先到先占" severity="warn" /></div>
          <div class="race-body">
            <p class="muted">模拟 R6（3000 册）与 S2（3200 册）的调度在同一时刻争抢 LOT-7201。服务端写操作经互斥链串行处理，按全局到达序号占用库存。建议先「重置台账」再演示。</p>
            <div class="race-actions">
              <Button label="双调度同时提交 LOT-7201" icon="pi pi-bolt" severity="warn" outlined :loading="raceMutation.isPending.value" @click="raceMutation.mutate()" />
            </div>
            <div v-if="raceResult" class="race-result">
              <div v-for="outcome in raceResult" :key="outcome.versionId" class="race-row" :class="outcome.reservation?.status === '已占用' ? 'win' : 'lose'">
                <div>
                  <strong>序号 #{{ outcome.seq }} · {{ outcome.versionId }}</strong>
                  <small v-if="outcome.reservation">
                    {{ outcome.reservation.id }} → {{ outcome.reservation.status }}
                    （申请 {{ outcome.reservation.requested }} / 占用 {{ outcome.reservation.held }}<template v-if="outcome.reservation.gap"> / 缺口 {{ outcome.reservation.gap }}</template>）
                  </small>
                  <small v-else class="err">{{ outcome.error }}</small>
                </div>
                <Tag v-if="outcome.reservation" :value="outcome.reservation.status" :severity="statusSeverity(outcome.reservation.status)" />
              </div>
              <p v-if="raceResult.some((o: RaceOutcome) => o.reservation?.status === '缺口')" class="hint">
                <i class="pi pi-info-circle" />后到者拿到缺口与可替代纸批列表，可在下方预留账中一键改占 LOT-7202 重算。
              </p>
            </div>
          </div>
        </section>

        <!-- ③ 纸批库存 -->
        <section class="panel">
          <div class="panel-head"><h3>③ 纸批库存与指纹</h3><span class="muted">规格 / 纸纹 / 剩余数量任一变化 → 预留失效重算</span></div>
          <div class="batch-table">
            <div class="batch-row head"><span>纸批</span><span>规格</span><span>纸纹/克重</span><span>剩余 / 占用 / 可预留</span><span>库存事件模拟</span></div>
            <div v-for="b in batches" :key="b.id" class="batch-row">
              <span><strong>{{ b.id }}</strong><small>{{ b.grade }} · {{ b.maker }}</small><small class="fp">{{ b.fingerprint }}</small></span>
              <span>{{ b.width }}×{{ b.height }}mm</span>
              <span>{{ b.grain }} · {{ b.gsm }}g</span>
              <span class="stock"><strong>{{ b.onHand }}</strong> / <em>{{ b.holds }}</em> / <b :class="{ low: b.available < 1000 }">{{ b.available }}</b></span>
              <span class="batch-ops">
                <Button size="small" text label="被另一工单领走 1200 张" :loading="adjustMutation.isPending.value"
                  @click="adjustMutation.mutate({ batchId: b.id, patch: { onHand: b.onHand - 1200 } })" />
                <Button size="small" text label="改纸纹" severity="warning" :loading="adjustMutation.isPending.value"
                  @click="adjustMutation.mutate({ batchId: b.id, patch: { grain: b.grain === '纵向' ? '横向' : '纵向' } })" />
              </span>
            </div>
          </div>
          <p v-if="adjustMutation.isSuccess.value && adjustMutation.data.value" class="hint effect-hint">
            <i class="pi pi-check-circle" />已变更 {{ adjustMutation.data.value.batch.id }}（新指纹 {{ adjustMutation.data.value.batch.fingerprint }}）：
            失效 {{ adjustMutation.data.value.effect.invalidated.length }} 单，自动改占重算 {{ adjustMutation.data.value.effect.recomputed.length }} 单。
          </p>
        </section>

        <!-- ④ 预留账 -->
        <section class="panel">
          <div class="panel-head"><h3>④ 预留账（按时序留痕）</h3><span class="muted">{{ ledger.length }} 张预留单</span></div>
          <div v-if="ledger.length === 0" class="empty">还没有预留单，先在上方提交生产。</div>
          <div v-else class="rsv-list">
            <article v-for="r in ledger" :key="r.id" class="rsv-card" :class="r.status">
              <div class="rsv-head">
                <div><strong>{{ r.id }} · #{{ r.seq }}</strong><small>{{ r.versionName }} → {{ r.batchId }} · {{ r.source }} · {{ r.createdAt }}</small></div>
                <Tag :value="r.status" :severity="statusSeverity(r.status)" />
              </div>
              <div class="rsv-meta">
                <span>申请 <b>{{ r.requested }}</b></span>
                <span>占用 <b>{{ r.held }}</b></span>
                <span :class="{ gapnum: r.gap > 0 }">缺口 <b>{{ r.gap }}</b></span>
                <span class="fp">批指纹 {{ r.batchFingerprint }}</span>
              </div>
              <p v-if="r.reason" class="reason">
                <i class="pi pi-info-circle" />{{ r.reason }}
                <template v-if="r.supersededBy"> · 接替单 <b>{{ r.supersededBy }}</b></template>
                <template v-if="r.predecessor"> · 重算自 <b>{{ r.predecessor }}</b></template>
              </p>
              <div v-if="r.alternatives.length" class="alts">
                <small>可替代纸批：</small>
                <span v-for="alt in r.alternatives" :key="alt.batchId" class="alt-chip" :class="alt.match === '规格一致' ? 'ok' : alt.match === '等级差异' ? 'warn' : 'bad'">
                  {{ alt.batchId }} · {{ alt.match }} · 可预留 {{ alt.atp }}{{ alt.covers ? ' · 可覆盖' : '' }}
                </span>
              </div>
              <div class="rsv-ops">
                <Button v-if="r.status === '缺口' || r.status === '已占用'" size="small" label="释放预留" icon="pi pi-unlock" text severity="secondary"
                  :loading="releaseMutation.isPending.value" @click="releaseMutation.mutate(r.id)" />
                <select v-if="r.status === '缺口'" :value="''"
                  @change="onRecalcSelect(r.id, $event)">
                  <option value="" disabled>改占替代纸批重算…</option>
                  <option v-for="alt in r.alternatives" :key="alt.batchId" :value="alt.batchId" :disabled="!alt.covers">
                    {{ alt.batchId }} · {{ alt.match }} · {{ alt.atp }} 张{{ alt.covers ? '' : '（不足）' }}
                  </option>
                </select>
              </div>
            </article>
          </div>
        </section>
      </div>

      <!-- 侧栏 -->
      <aside class="ledger-side">
        <section class="panel">
          <div class="panel-head"><h3>⑤ 拼版版本排队状态</h3></div>
          <div class="version-list">
            <div v-for="v in versions" :key="v.id" class="version-row">
              <div><strong>{{ v.id }}</strong><small>{{ v.name }}</small><small v-if="v.activeReservationId">预留 {{ v.activeReservationId }}</small></div>
              <Tag :value="v.status" :severity="v.status === '已完成' ? 'success' : v.status === '生产中' ? 'info' : v.status === '已中断' ? 'danger' : 'warn'" />
            </div>
          </div>
        </section>
        <QueuePanel :batches="batches" :versions="versions" :reservations="reservations" />
      </aside>
    </div>
  </section>
</template>

<style scoped>
.ledger-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
.ledger-main { display: grid; gap: 14px; }
.ledger-side { display: grid; gap: 14px; position: sticky; top: 14px; }
.form-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px 12px; }
.form-grid label { display: grid; gap: 5px; font-size: 11px; color: #5e6d74; font-weight: 600; }
select, input { width: 100%; padding: 8px 9px; border: 1px solid #cfd9db; border-radius: 7px; font: inherit; font-size: 12px; background: #fff; color: #26373d; }
.submit-body { padding: 16px; display: grid; gap: 14px; }
.calc-box { border: 1px solid #dde6e6; border-radius: 9px; background: #f6f9f8; padding: 13px 14px; display: grid; gap: 8px; }
.calc-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: #5a6a71; }
.calc-row strong { color: #2c3f45; font-size: 12px; text-align: right; }
.calc-row.total { border-top: 1px dashed #c3cfd0; padding-top: 8px; }
.calc-row.total strong { color: #b8612a; font-size: 15px; }
.calc-row.ok strong { color: #2f7d58; }
.calc-row.short strong { color: #b4452f; }
.result { border-radius: 9px; padding: 12px 14px; font-size: 12px; display: grid; gap: 8px; }
.result.ok { border: 1px solid #bfe0cd; background: #f0f9f3; }
.result.gap { border: 1px solid #f0cbbf; background: #fdf4f0; }
.result-head { display: flex; align-items: center; gap: 10px; }
.result-head .muted { margin-left: auto; font-size: 10px; }
.alt-row { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 8px 10px; background: #fff; border: 1px solid #e6e0db; border-radius: 7px; }
.alt-row small { display: block; color: #7d898f; margin-top: 3px; }
.banner { padding: 9px 12px; border-radius: 8px; font-size: 12px; display: flex; gap: 8px; align-items: center; }
.banner.error { color: #a13b26; background: #fdeee9; border: 1px solid #f3c8bb; }
.race-body { padding: 14px 16px 16px; display: grid; gap: 12px; }
.race-body > p { margin: 0; font-size: 12px; }
.race-actions { display: flex; gap: 10px; }
.race-result { display: grid; gap: 8px; }
.race-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 11px 13px; border-radius: 8px; border: 1px solid #e3e9e9; }
.race-row.win { background: #f1f9f4; border-color: #bfe0cd; }
.race-row.lose { background: #fdf4f0; border-color: #f0cbbf; }
.race-row strong, .race-row small { display: block; font-size: 12px; }
.race-row small { margin-top: 4px; color: #7a878d; }
.race-row small.err { color: #a13b26; }
.hint { font-size: 11px; color: #6d7c83; display: flex; gap: 6px; align-items: center; margin: 0; }
.effect-hint { padding: 0 16px 14px; }
.batch-table { padding: 6px 16px 12px; }
.batch-row { display: grid; grid-template-columns: 1.5fr 0.8fr 0.9fr 1.2fr 1.3fr; gap: 10px; align-items: center; padding: 11px 4px; border-bottom: 1px solid #edf1f1; font-size: 12px; }
.batch-row.head { font-size: 10px; color: #8a969c; font-weight: 700; letter-spacing: .05em; }
.batch-row small { display: block; color: #8a969c; margin-top: 3px; }
.batch-row .fp { font-family: monospace; font-size: 9px; color: #a0abaf; }
.stock b { color: #2f7d58; }
.stock b.low { color: #b4452f; }
.stock em { font-style: normal; color: #c4872f; }
.batch-ops { display: flex; gap: 4px; flex-wrap: wrap; }
.empty { padding: 26px; text-align: center; color: #8a969c; font-size: 12px; }
.rsv-list { padding: 8px 16px 16px; display: grid; gap: 10px; }
.rsv-card { border: 1px solid #e5ebeb; border-radius: 9px; padding: 12px 14px; display: grid; gap: 9px; }
.rsv-card.已占用, .rsv-card.已开工 { border-left: 3px solid #3f9a68; }
.rsv-card.缺口 { border-left: 3px solid #c7553a; background: #fffaf8; }
.rsv-card.已失效 { border-left: 3px solid #d9a04d; background: #fdf9f2; }
.rsv-card.已完成 { border-left: 3px solid #7ba7b0; }
.rsv-card.已释放 { opacity: .65; }
.rsv-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.rsv-head small { display: block; color: #808d93; font-size: 10px; margin-top: 3px; }
.rsv-meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 11px; color: #67767d; }
.rsv-meta .gapnum, .rsv-meta .gapnum b { color: #b4452f; }
.rsv-meta .fp { font-family: monospace; font-size: 9px; color: #a0abaf; }
.reason { margin: 0; font-size: 11px; color: #8a6a3b; }
.alts { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.alts small { color: #8a969c; font-size: 10px; }
.alt-chip { font-size: 10px; padding: 4px 8px; border-radius: 20px; border: 1px solid; }
.alt-chip.ok { color: #2f7d58; background: #eef8f2; border-color: #bfe0cd; }
.alt-chip.warn { color: #a8722c; background: #fbf3e6; border-color: #ecd6ae; }
.alt-chip.bad { color: #909aa0; background: #f3f5f5; border-color: #dde3e4; }
.rsv-ops { display: flex; gap: 10px; align-items: center; }
.rsv-ops select { max-width: 280px; }
.version-list { padding: 8px 14px 12px; display: grid; gap: 6px; }
.version-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 4px; border-bottom: 1px solid #edf1f1; gap: 8px; }
.version-row small { display: block; color: #8a969c; font-size: 10px; margin-top: 3px; }
@media (max-width: 1100px) { .ledger-grid { grid-template-columns: 1fr; } .ledger-side { position: static; } }
@media (max-width: 760px) { .form-grid { grid-template-columns: 1fr; } .batch-row { grid-template-columns: 1fr 1fr; } }
</style>
