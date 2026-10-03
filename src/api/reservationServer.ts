import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import type { ExportTask } from '../stores/imposition'

/* ------------------------------------------------------------------ */
/* 领域类型：纸批库存 / 拼版版本 / 预留单 / 用量计算                     */
/* ------------------------------------------------------------------ */

export type Grain = '纵向' | '横向'

export type PaperBatch = {
  id: string
  grade: string          // 纸张等级/品名
  maker: string
  width: number          // mm
  height: number         // mm
  gsm: number            // 克重
  grain: Grain
  onHand: number         // 剩余库存（张）
  fingerprint: string    // 规格+纸纹+剩余数量的摘要，任一项变化即重算
  note?: string
}

export type DemandCalc = {
  copies: number
  impressions: number    // 印面数（正反面合计）
  platesPerSheet: number // 一张全张上机可排的版位数（双面印位）
  sheetsPerCopy: number  // 每册印张（向上取整）
  oversPercent: number   // 放数 %
  wastePercent: number   // 裁切损耗 %
  netSheets: number      // 放数后
  requiredSheets: number // 含裁切损耗的最终预留张数
  formula: string
}

export type ReservationStatus = '已占用' | '缺口' | '已开工' | '已完成' | '已失效' | '已释放'
export type ReservationSource = '生产提交' | '失效重算' | '旧任务复核'

export type Alternative = {
  batchId: string
  label: string
  atp: number
  covers: boolean
  match: '规格一致' | '等级差异' | '纸纹不符' | '尺寸不符'
  reason: string
}

export type Reservation = {
  id: string
  seq: number                       // 全局到达序号，先到先占的凭证
  versionId: string
  versionName: string
  taskId?: string
  batchId: string
  batchFingerprint: string
  calc: DemandCalc
  requested: number
  held: number                      // 实际占用张数
  gap: number                       // 缺口张数
  status: ReservationStatus
  source: ReservationSource
  reason?: string                   // 失效/缺口原因
  supersededBy?: string             // 失效重算后由哪张新单接替
  predecessor?: string              // 重算自哪张旧单
  alternatives: Alternative[]
  createdAt: string
}

export type VersionStatus = '未开工' | '排队中' | '生产中' | '已中断' | '已完成'
export type ProductionVersion = {
  id: string
  name: string
  sheetWidth: number                // 版位尺寸（全张上机）
  sheetHeight: number
  platesPerSheet: number
  pages: number
  copies: number
  oversPercent: number
  wastePercent: number
  requiredGsm: number
  requiredGrade: string
  grain: Grain
  status: VersionStatus
  activeReservationId?: string
  updatedAt: string
}

type Db = {
  batches: PaperBatch[]
  versions: ProductionVersion[]
  reservations: Reservation[]
  tasks: ExportTask[]
  seqCounter: number
}

/* ------------------------------------------------------------------ */
/* 种子数据                                                            */
/* ------------------------------------------------------------------ */

function fingerprintOf(b: Pick<PaperBatch, 'width' | 'height' | 'gsm' | 'grain' | 'onHand'>) {
  // 规格、纸纹方向或剩余数量任一变化都会改变指纹
  return `FP-${b.width}x${b.height}-${b.gsm}g-${b.grain[0]}-${b.onHand}`
}

const seedBatches: PaperBatch[] = ([
  { id: 'LOT-7201', grade: '东帆铜版纸 128g', maker: '东帆纸业', width: 720, height: 1020, gsm: 128, grain: '纵向', onHand: 21000, note: '主力库位 A-12' },
  { id: 'LOT-7202', grade: '东帆铜版纸 128g', maker: '东帆纸业', width: 720, height: 1020, gsm: 128, grain: '纵向', onHand: 42000, note: '主力库位 A-14' },
  { id: 'LOT-7203', grade: '东帆铜版纸 128g', maker: '东帆纸业', width: 720, height: 1020, gsm: 128, grain: '横向', onHand: 18000, note: '纸纹横向，仅横纹活件' },
  { id: 'LOT-7204', grade: '金雪铜版纸 120g', maker: '金雪纸业', width: 720, height: 1020, gsm: 120, grain: '纵向', onHand: 36000, note: '克重不同，需客户书面确认' },
  { id: 'LOT-6401', grade: '东帆铜版纸 128g', maker: '东帆纸业', width: 640, height: 900, gsm: 128, grain: '纵向', onHand: 50000, note: '尺寸不符，需重新拼版' },
] as Omit<PaperBatch, 'fingerprint'>[]).map((b) => ({ ...b, fingerprint: fingerprintOf(b) }))

const seedVersions: ProductionVersion[] = [
  { id: 'VER-R5', name: 'R5 基线（已审批）', sheetWidth: 720, sheetHeight: 1020, platesPerSheet: 8, pages: 48, copies: 3000, oversPercent: 4, wastePercent: 2.5, requiredGsm: 128, requiredGrade: '铜版纸', grain: '纵向', status: '已中断', updatedAt: '09-25 16:42' },
  { id: 'VER-R6', name: 'R6 生产版（锁定）', sheetWidth: 720, sheetHeight: 1020, platesPerSheet: 8, pages: 48, copies: 3000, oversPercent: 4, wastePercent: 2.5, requiredGsm: 128, requiredGrade: '铜版纸', grain: '纵向', status: '未开工', updatedAt: '10-03 08:20' },
  { id: 'VER-S2', name: 'S2 加印版', sheetWidth: 720, sheetHeight: 1020, platesPerSheet: 8, pages: 48, copies: 3200, oversPercent: 5, wastePercent: 3, requiredGsm: 128, requiredGrade: '铜版纸', grain: '纵向', status: '未开工', updatedAt: '10-03 08:25' },
]

const seedTasks: ExportTask[] = [
  {
    id: 'EXP-0925-01', name: '印刷交付包 · PDF/X-4（R5 基线）', progress: 72, status: '待复核', updatedAt: '09-25 16:42', resumable: true, versionId: 'VER-R5', frozen: true,
    blockedReason: '无预留单号，旧纸批归属需重新确认',
    shards: [
      { id: 'SEG-01', name: '分片 1-16 · 封面/版权页', state: '冻结保留', batchId: 'LOT-7201', batchLabel: 'LOT-7201（旧批占用）' },
      { id: 'SEG-02', name: '分片 17-32 · 剧照/曲目表', state: '冻结保留', batchId: 'LOT-7201', batchLabel: 'LOT-7201（旧批占用）' },
      { id: 'SEG-03', name: '分片 33-48 · 创作团队/封底', state: '待生成' },
      { id: 'SEG-04', name: '预检与色彩控制条报告', state: '待生成' },
    ],
  },
  { id: 'EXP-0925-02', name: '数字样张低分辨率预览', progress: 100, status: '已完成', updatedAt: '09-25 15:18', resumable: false },
  { id: 'EXP-1003-01', name: '印刷交付包 · PDF/X-4（R6 生产）', progress: 0, status: '排队中', updatedAt: '10-03 08:30', resumable: true, versionId: 'VER-R6', shards: [
    { id: 'R6-S1', name: '分片 1-16 · 封面/版权页', state: '待生成' },
    { id: 'R6-S2', name: '分片 17-32 · 剧照/曲目表', state: '待生成' },
    { id: 'R6-S3', name: '分片 33-48 · 创作团队/封底', state: '待生成' },
    { id: 'R6-S4', name: '预检与色彩控制条报告', state: '待生成' },
  ] },
  { id: 'EXP-1003-02', name: '加印交付包 · PDF/X-4（S2）', progress: 0, status: '排队中', updatedAt: '10-03 08:31', resumable: true, versionId: 'VER-S2', shards: [
    { id: 'S2-S1', name: '分片 1-16 · 封面/版权页', state: '待生成' },
    { id: 'S2-S2', name: '分片 17-32 · 剧照/曲目表', state: '待生成' },
    { id: 'S2-S3', name: '分片 33-48 · 创作团队/封底', state: '待生成' },
    { id: 'S2-S4', name: '预检与色彩控制条报告', state: '待生成' },
  ] },
]

/* ------------------------------------------------------------------ */
/* 持久化（localStorage 模拟服务端台账）                                */
/* ------------------------------------------------------------------ */

const DB_KEY = 'print-reservation-ledger-v1'

function freshDb(): Db {
  return {
    batches: structuredClone(seedBatches),
    versions: structuredClone(seedVersions),
    reservations: [],
    tasks: structuredClone(seedTasks),
    seqCounter: 1000,
  }
}

function loadDb(): Db {
  const raw = localStorage.getItem(DB_KEY)
  if (!raw) return freshDb()
  try {
    const db = JSON.parse(raw) as Db
    // 旧纸批指纹自愈：规格/纸纹/剩余数量与指纹不一致，说明台账被外部改动过
    db.batches.forEach((b) => {
      const fp = fingerprintOf(b)
      if (b.fingerprint !== fp) b.fingerprint = fp
    })
    return db
  } catch {
    return freshDb()
  }
}

let db: Db = loadDb()

function persist() {
  localStorage.setItem(DB_KEY, JSON.stringify(db))
}

/* ------------------------------------------------------------------ */
/* 纯函数：用量计算 / 可预留库存 / 替代纸批                             */
/* ------------------------------------------------------------------ */

export function calcDemand(input: { copies: number; pages: number; platesPerSheet: number; oversPercent: number; wastePercent: number }): DemandCalc {
  const { copies, pages, platesPerSheet, oversPercent, wastePercent } = input
  // 双面拼版：每个版位承载一个印面（正面或反面），印面数 = 页数
  const impressions = pages
  // 每册印张 = 印面数 / 单张上机版位数，向上取整（不足一张按一张领纸）
  const sheetsPerCopy = Math.max(1, Math.ceil(impressions / platesPerSheet))
  const base = copies * sheetsPerCopy
  const netSheets = Math.round(base * (1 + oversPercent / 100))
  const requiredSheets = Math.round(netSheets * (1 + wastePercent / 100))
  return {
    copies,
    impressions,
    platesPerSheet,
    sheetsPerCopy,
    oversPercent,
    wastePercent,
    netSheets,
    requiredSheets,
    formula: `印张用量 = ⌈${impressions} 印面 ÷ ${platesPerSheet} 版位/张⌉ × ${copies} 册 × (1+${oversPercent}%放数) × (1+${wastePercent}%裁切损耗) = ${sheetsPerCopy} × ${copies} × ${(1 + oversPercent / 100).toFixed(2)} × ${(1 + wastePercent / 100).toFixed(3)} = ${requiredSheets} 张`,
  }
}

const ACTIVE: ReservationStatus[] = ['已占用', '缺口', '已开工']

export function activeHolds(batchId: string, source: Reservation[] = db.reservations): number {
  // 已占用 / 缺口单的 held 部分都锁住库存；已失效、已释放、已完成不再占用
  return source
    .filter((r) => r.batchId === batchId && ACTIVE.includes(r.status))
    .reduce((sum, r) => sum + r.held, 0)
}

export function atp(batch: PaperBatch, source: Reservation[] = db.reservations): number {
  // 可预留量 = 剩余库存 − 该批所有有效预留占用
  return Math.max(0, batch.onHand - activeHolds(batch.id, source))
}

function evaluateBatch(batch: PaperBatch, v: ProductionVersion, available: number): { match: Alternative['match']; reason: string } {
  const sameSize = batch.width === v.sheetWidth && batch.height === v.sheetHeight
  if (!sameSize) return { match: '尺寸不符', reason: `${batch.width}×${batch.height}mm 与版位 ${v.sheetWidth}×${v.sheetHeight}mm 不符，需重新拼版` }
  if (batch.grain !== v.grain) return { match: '纸纹不符', reason: `${batch.grain}纸纹，活件要求${v.grain}，折页/装订方向不允许` }
  if (batch.gsm !== v.requiredGsm) return { match: '等级差异', reason: `${batch.gsm}g 与要求 ${v.requiredGsm}g 不一致，需客户书面确认` }
  return { match: '规格一致', reason: available >= 0 ? '规格、克重、纸纹全部一致' : '规格一致' }
}

function findAlternatives(v: ProductionVersion, required: number, excludeBatchId: string): Alternative[] {
  return db.batches
    .filter((b) => b.id !== excludeBatchId)
    .map((b) => {
      const available = atp(b)
      const verdict = evaluateBatch(b, v, available)
      return {
        batchId: b.id,
        label: `${b.id} · ${b.grade}`,
        atp: available,
        covers: available >= required && verdict.match === '规格一致',
        match: verdict.match,
        reason: verdict.reason,
      }
    })
    // 优先展示可完全覆盖的同规格批，其次同尺寸不同等级，纸纹/尺寸不符沉底
    .sort((a, b) => Number(b.covers) - Number(a.covers) || b.atp - a.atp)
}

/* ------------------------------------------------------------------ */
/* 互斥链：所有写操作排队执行，模拟两个调度同时提交时的先到先占         */
/* ------------------------------------------------------------------ */

let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => T | Promise<T>): Promise<T> {
  const run = chain.then(() => job())
  // 无论本单成功失败，队列继续向下处理
  chain = run.then(() => undefined, () => undefined)
  return run
}

const now = () => {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* 预留单核心操作                                                       */
/* ------------------------------------------------------------------ */

type CreateInput = {
  versionId: string
  batchId: string
  taskId?: string
  copies?: number
  oversPercent?: number
  wastePercent?: number
  source?: ReservationSource
  predecessor?: string
}

function nextSeq() {
  db.seqCounter += 1
  return db.seqCounter
}

function createReservation(input: CreateInput): Reservation {
  const v = db.versions.find((item) => item.id === input.versionId)
  if (!v) throw httpError(404, `拼版版本 ${input.versionId} 不存在`)
  const batch = db.batches.find((item) => item.id === input.batchId)
  if (!batch) throw httpError(404, `纸批 ${input.batchId} 不存在`)

  // 同一版本只允许一张活动预留（重算场景先把旧单作废再建）
  const existing = db.reservations.find((r) => r.versionId === v.id && ACTIVE.includes(r.status))
  if (existing && !input.predecessor) {
    throw httpError(409, `版本 ${v.name} 已有活动预留单 ${existing.id}（${existing.status}），请先释放或改走失效重算`)
  }

  const calc = calcDemand({
    copies: input.copies ?? v.copies,
    pages: v.pages,
    platesPerSheet: v.platesPerSheet,
    oversPercent: input.oversPercent ?? v.oversPercent,
    wastePercent: input.wastePercent ?? v.wastePercent,
  })
  const required = calc.requiredSheets
  const available = atp(batch)
  const hold = Math.min(required, available)
  const gap = required - hold
  const status: ReservationStatus = gap > 0 ? '缺口' : '已占用'

  const id = `RSV-${String(nextSeq()).padStart(4, '0')}`
  const reservation: Reservation = {
    id,
    seq: db.seqCounter,
    versionId: v.id,
    versionName: v.name,
    taskId: input.taskId,
    batchId: batch.id,
    batchFingerprint: batch.fingerprint,
    calc,
    requested: required,
    held: hold,
    gap,
    status,
    source: input.source ?? '生产提交',
    predecessor: input.predecessor,
    alternatives: gap > 0 ? findAlternatives(v, required, batch.id) : [],
    createdAt: now(),
  }
  db.reservations.unshift(reservation)

  // 未开工拼版和关联导出任务跟着排队
  if (v.status === '未开工' || v.status === '已中断') v.status = '排队中'
  v.activeReservationId = id
  v.updatedAt = reservation.createdAt
  const task = input.taskId ? db.tasks.find((t) => t.id === input.taskId) : db.tasks.find((t) => t.versionId === v.id)
  if (task && task.status !== '已完成') {
    task.status = '排队中'
    task.reservationId = id
    task.frozen = false
    task.blockedReason = undefined
    task.updatedAt = reservation.createdAt
  }
  persist()
  return reservation
}

/** 纸批规格、纸纹方向或剩余数量一变：该批活动预留全部失效并重算 */
function invalidateBatch(batch: PaperBatch, cause: string): { invalidated: string[]; recomputed: string[] } {
  const invalidated: string[] = []
  const recomputed: string[] = []
  const actives = db.reservations.filter((r) => r.batchId === batch.id && ACTIVE.includes(r.status))
  for (const old of actives) {
    const wasStarted = old.status === '已开工'
    old.status = '已失效'
    old.reason = cause
    invalidated.push(old.id)

    const v = db.versions.find((item) => item.id === old.versionId)
    const task = db.tasks.find((t) => t.id === old.taskId || (v && t.versionId === v.id))

    if (wasStarted || (task && task.progress > 0)) {
      // 已开工：保留已完成分片但单独留档，待生成分片等新批后续作，禁止混入旧纸批
      if (v) { v.status = '已中断'; v.activeReservationId = undefined; v.updatedAt = now() }
      if (task) {
        task.status = '已中断'
        task.frozen = true
        task.blockedReason = `纸批 ${batch.id} 已变更，${old.id} 失效；已完成分片保留，需在新纸批上重算后续分片`
        task.shards = (task.shards ?? []).map((s) =>
          s.state === '已完成'
            ? { ...s, state: '冻结保留' as const, batchId: s.batchId ?? batch.id, batchLabel: `${s.batchId ?? batch.id} · 失效前完成，单独留档` }
            : s,
        )
        task.updatedAt = now()
      }
      continue
    }

    // 未开工：自动重算排队（旧单保留留痕，新单为「失效重算」）
    const candidates = findAlternatives(v!, old.requested, batch.id)
    const cover = candidates.find((c) => c.covers)
    if (cover) {
      const fresh = createReservation({
        versionId: old.versionId,
        batchId: cover.batchId,
        taskId: old.taskId,
        source: '失效重算',
        predecessor: old.id,
      })
      old.supersededBy = fresh.id
      fresh.reason = `原批 ${batch.id} 失效后自动改占`
      recomputed.push(fresh.id)
    } else {
      // 没有可覆盖替代：版本与任务留在队列等纸
      if (v) { v.status = '排队中'; v.activeReservationId = undefined }
      if (task) {
        task.status = '排队中'
        task.frozen = true
        task.blockedReason = `原批 ${batch.id} 失效，暂无可覆盖纸批，等待补纸或人工选批`
      }
    }
  }
  return { invalidated, recomputed }
}

function adjustBatchPatch(batchId: string, patch: Partial<PaperBatch>): { batch: PaperBatch; effect: ReturnType<typeof invalidateBatch> } {
  const batch = db.batches.find((b) => b.id === batchId)
  if (!batch) throw httpError(404, `纸批 ${batchId} 不存在`)
  const before = { spec: fingerprintOf(batch), gsm: batch.gsm, grain: batch.grain }
  const next: PaperBatch = {
    ...batch,
    width: patch.width ?? batch.width,
    height: patch.height ?? batch.height,
    gsm: patch.gsm ?? batch.gsm,
    grain: patch.grain ?? batch.grain,
    onHand: patch.onHand ?? batch.onHand,
    note: patch.note ?? batch.note,
  }
  next.fingerprint = fingerprintOf(next)
  const changed = next.fingerprint !== before.spec
  if (!changed) return { batch: next, effect: { invalidated: [], recomputed: [] } }

  const causeParts: string[] = []
  if (next.gsm !== before.gsm) causeParts.push(`克重 ${before.gsm}g→${next.gsm}g`)
  if (next.grain !== before.grain) causeParts.push(`纸纹 ${before.grain}→${next.grain}`)
  if (next.onHand !== batch.onHand) causeParts.push(`剩余 ${batch.onHand}→${next.onHand} 张`)
  if (next.width !== batch.width || next.height !== batch.height) causeParts.push(`规格 ${batch.width}×${batch.height}→${next.width}×${next.height}`)
  Object.assign(batch, next)
  const effect = invalidateBatch(batch, `纸批指纹变更（${causeParts.join('，')}），原预留全部失效重算`)
  persist()
  return { batch, effect }
}

function recalcReservation(reservationId: string, targetBatchId: string): Reservation {
  const old = db.reservations.find((r) => r.id === reservationId)
  if (!old) throw httpError(404, `预留单 ${reservationId} 不存在`)
  if (!['缺口', '已占用', '已失效'].includes(old.status)) {
    throw httpError(409, `预留单 ${reservationId} 状态为 ${old.status}，不能改批重算`)
  }
  const v = db.versions.find((item) => item.id === old.versionId)
  const task = old.taskId
    ? db.tasks.find((t) => t.id === old.taskId)
    : db.tasks.find((t) => t.versionId === old.versionId && t.status !== '已完成')
  const taskId = task?.id
  if (task && task.progress > 0 && old.status === '已占用') {
    throw httpError(409, `任务 ${task.id} 已有完成分片（${task.progress}%），不能直接改批；请先在纸批台账触发失效，再走新批续作流程`)
  }
  if (ACTIVE.includes(old.status)) {
    old.status = '已释放'
    old.reason = `人工改批至 ${targetBatchId}`
  }
  // 已失效的已开工单：任务此前已冻结，建单时同步解冻排队，保留旧分片留档
  if (old.status === '已失效' && task) {
    task.frozen = false
    task.blockedReason = undefined
  }
  const fresh = createReservation({
    versionId: old.versionId,
    batchId: targetBatchId,
    taskId,
    source: '失效重算',
    predecessor: old.id,
  })
  old.supersededBy = fresh.id
  persist()
  return fresh
}

function releaseReservation(reservationId: string): Reservation {
  const r = db.reservations.find((item) => item.id === reservationId)
  if (!r) throw httpError(404, `预留单 ${reservationId} 不存在`)
  if (!ACTIVE.includes(r.status)) throw httpError(409, `预留单 ${reservationId} 状态为 ${r.status}，无需释放`)
  r.status = '已释放'
  r.reason = '调度手动释放，库存回到可预留池'
  const v = db.versions.find((item) => item.id === r.versionId)
  if (v && v.activeReservationId === r.id) v.activeReservationId = undefined
  persist()
  return r
}

/** 旧任务复核：无预留单号的任务，重新确认纸批后按复核来源建单，才能占用库存 */
function confirmLegacy(taskId: string, batchId: string): { task: ExportTask; reservation: Reservation } {
  const task = db.tasks.find((t) => t.id === taskId)
  if (!task) throw httpError(404, `导出任务 ${taskId} 不存在`)
  if (!task.versionId) throw httpError(409, `任务 ${taskId} 没有关联拼版版本，无法核算用量`)
  if (task.status !== '待复核' && task.reservationId) throw httpError(409, `任务 ${taskId} 已有预留单 ${task.reservationId}，无需复核`)

  const reservation = createReservation({
    versionId: task.versionId,
    batchId,
    taskId,
    source: '旧任务复核',
  })
  reservation.reason = '旧任务无预留单号，重新确认纸批后续作'
  // 旧批上已完成的分片保留并显式标注，续作在新批上补齐，不混纸
  task.shards = (task.shards ?? []).map((s) =>
    s.state === '冻结保留'
      ? { ...s, state: '冻结保留', batchLabel: `${s.batchId ?? '旧批'} · 复核前完成，单独留档` }
      : s,
  )
  task.frozen = false
  task.blockedReason = undefined
  task.status = '排队中'
  task.reservationId = reservation.id
  task.updatedAt = now()
  const v = db.versions.find((item) => item.id === task.versionId)
  if (v) v.status = '排队中'
  persist()
  return { task, reservation }
}

/* ------------------------------------------------------------------ */
/* 开工：恢复/续跑导出任务；已完成分片保留，缺新预留一律拦截             */
/* ------------------------------------------------------------------ */

function resumeTask(taskId: string): ExportTask {
  const task = db.tasks.find((t) => t.id === taskId)
  if (!task) throw httpError(404, `导出任务 ${taskId} 不存在`)

  if (task.status === '待复核') {
    throw httpError(409, `任务 ${taskId} 是无预留单号的旧任务，必须先重新确认纸批（待复核 → 排队中）`)
  }
  if (task.frozen) throw httpError(409, task.blockedReason ?? `任务 ${taskId} 已冻结：原纸批预留失效，需在新纸批上重算后续分片`)
  if (task.status === '已完成') return task

  const reservation = task.reservationId ? db.reservations.find((r) => r.id === task.reservationId) : undefined
  if (!reservation) throw httpError(409, `任务 ${taskId} 没有有效预留单，不能占用库存开工`)
  if (reservation.status === '缺口') throw httpError(409, `预留单 ${reservation.id} 尚缺 ${reservation.gap} 张，补齐或改占替代纸批后才能开工`)
  if (reservation.status === '已失效' || reservation.status === '已释放') throw httpError(409, `预留单 ${reservation.id} 已${reservation.status}，请改走失效重算`)

  const batch = db.batches.find((b) => b.id === reservation.batchId)
  if (!batch || batch.fingerprint !== reservation.batchFingerprint) {
    throw httpError(409, `纸批 ${reservation.batchId} 指纹已变化，预留单 ${reservation.id} 失效，请重新选批`)
  }

  // 每次恢复推进一个待生成分片（按 16 页/分片逐片落盘）；冻结保留的旧分片原样留档，续作在新批上完成，不混纸
  task.shards = task.shards ?? defaultShards(task)
  const nextShard = task.shards.find((s) => s.state === '待生成')
  if (nextShard) {
    nextShard.state = '已完成'
    nextShard.batchId = batch.id
    nextShard.batchLabel = `${batch.id} · ${reservation.status === '已开工' ? '同批续作' : '新批续作'}`
  }
  const done = task.shards.filter((s) => s.state === '已完成' || s.state === '冻结保留').length
  const total = (task.shards ?? []).length
  task.progress = total ? Math.round((done / total) * 100) : 100
  task.status = task.progress >= 100 ? '已完成' : '生成中'
  task.updatedAt = now()

  if (task.progress >= 100) {
    reservation.status = '已完成'
    reservation.reason = '分片全部完成，预留结单'
    const v = db.versions.find((item) => item.id === task.versionId)
    if (v) v.status = '已完成'
  } else if (reservation.status === '已占用') {
    reservation.status = '已开工'
    const v = db.versions.find((item) => item.id === task.versionId)
    if (v && v.status !== '生产中') v.status = '生产中'
  }
  persist()
  return task
}

function defaultShards(task: ExportTask) {
  return [
    { id: `${task.id}-S1`, name: '分片 1-16', state: '待生成' as const },
    { id: `${task.id}-S2`, name: '分片 17-32', state: '待生成' as const },
    { id: `${task.id}-S3`, name: '预检与色彩控制条报告', state: '待生成' as const },
  ]
}

/** 演示：两个调度几乎同时提交同一纸批，按互斥链先到先占 */
export type RaceOutcome = { seq: number; versionId: string; reservation?: Reservation; error?: string }

function raceSubmit(versionIds: string[], batchId: string): RaceOutcome[] {
  const outcomes: RaceOutcome[] = []
  versionIds.forEach((versionId) => {
    const seq = db.seqCounter + 1
    try {
      const taskId = db.tasks.find((t) => t.versionId === versionId && t.status !== '已完成')?.id
      const reservation = createReservation({ versionId, batchId, taskId })
      outcomes.push({ seq: reservation.seq, versionId, reservation })
    } catch (err) {
      db.seqCounter += 1
      outcomes.push({ seq, versionId, error: (err as Error).message })
    }
  })
  return outcomes
}

function httpError(status: number, message: string): Error & { response: { status: number; data: { error: string } } } {
  const err = new Error(message) as Error & { response: { status: number; data: { error: string } } }
  err.response = { status, data: { error: message } }
  return err
}

/* ------------------------------------------------------------------ */
/* Axios 适配路由（写操作全部走互斥链）                                 */
/* ------------------------------------------------------------------ */

const LATENCY = 140

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}

export const reservationAdapter: AxiosAdapter = async (config) => {
  await new Promise((resolve) => setTimeout(resolve, LATENCY))
  const url = config.url ?? ''
  const method = config.method ?? 'get'
  const body = (config.data ? JSON.parse(config.data as string) : {}) as Record<string, unknown>

  try {
    // ---- 读 ----------------------------------------------------------------
    if (method === 'get' && url === '/api/paper/batches') {
      // 读时也校验指纹，防止外部改动静默吞掉
      db.batches.forEach((b) => {
        const fp = fingerprintOf(b)
        if (b.fingerprint !== fp) b.fingerprint = fp
      })
      return ok(config, structuredClone(db.batches.map((b) => ({ ...b, available: atp(b), holds: activeHolds(b.id) }))))
    }
    if (method === 'get' && url === '/api/paper/versions') {
      return ok(config, structuredClone(db.versions))
    }
    if (method === 'get' && url === '/api/paper/reservations') {
      return ok(config, structuredClone(db.reservations))
    }
    if (method === 'get' && url === '/api/print/export-tasks') {
      return ok(config, structuredClone(db.tasks))
    }

    // ---- 写（串行化，保证先到先占） ------------------------------------------
    if (method === 'post' && url === '/api/paper/reservations') {
      return ok(config, await enqueue(() => createReservation(body as unknown as CreateInput)))
    }
    if (method === 'post' && url === '/api/paper/reservations/race') {
      const { versionIds, batchId } = body as { versionIds: string[]; batchId: string }
      return ok(config, await enqueue(() => raceSubmit(versionIds, batchId)))
    }
    let m = url.match(/^\/api\/paper\/batches\/([^/]+)$/)
    if (method === 'patch' && m) {
      return ok(config, await enqueue(() => adjustBatchPatch(m![1], body as Partial<PaperBatch>)))
    }
    m = url.match(/^\/api\/paper\/reservations\/([^/]+)\/recalculate$/)
    if (method === 'post' && m) {
      const { batchId } = body as { batchId: string }
      return ok(config, await enqueue(() => recalcReservation(m![1], batchId)))
    }
    m = url.match(/^\/api\/paper\/reservations\/([^/]+)\/release$/)
    if (method === 'post' && m) {
      return ok(config, await enqueue(() => releaseReservation(m![1])))
    }
    m = url.match(/^\/api\/print\/export-tasks\/([^/]+)\/confirm-legacy$/)
    if (method === 'post' && m) {
      const { batchId } = body as { batchId: string }
      return ok(config, await enqueue(() => confirmLegacy(m![1], batchId)))
    }
    m = url.match(/^\/api\/print\/export-tasks\/([^/]+)\/resume$/)
    if (method === 'post' && m) {
      return ok(config, await enqueue(() => resumeTask(m![1])))
    }
    if (method === 'post' && url === '/api/paper/reset') {
      return ok(config, await enqueue(() => { db = freshDb(); persist(); return { reset: true } }))
    }

    return { data: { error: 'Not Found' }, status: 404, statusText: 'Not Found', headers: {}, config }
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status ?? 500
    const data = (err as { response?: { data?: unknown } }).response?.data ?? { error: String(err) }
    // 自定义 adapter 不会替我们按 validateStatus reject，4xx/5xx 必须显式抛出
    const error = new Error((data as { error?: string }).error ?? 'Request failed') as Error & { response?: { status: number; data: unknown }, config: InternalAxiosRequestConfig }
    error.response = { status, data }
    error.config = config
    throw error
  }
}
