import axios, { type AxiosAdapter } from 'axios'

// ---------- 类型 ----------
export type Grain = '纵向' | '横向'

export type PaperBatch = {
  id: string            // 纸批号
  name: string          // 纸张名称
  brand: string          // 品牌
  paperType: string      // 纸种（铜版纸 / 哑粉纸 …）
  width: number          // mm
  height: number         // mm
  grammage: number       // g/m²
  grain: Grain           // 纸纹方向
  sheetCount: number     // 剩余数量（张）
  safetyStock: number    // 安全库存（张）
  location: string       // 库位
  status: '可用' | '偏低' | '停用'
  updatedAt: string
}

export type ReservationStatus = '已占用' | '已核销' | '已失效' | '已释放'

export type ReservationBasis = {
  pageWidth: number      // 版位尺寸（成品宽 mm）
  pageHeight: number     // 版位尺寸（成品高 mm）
  ups: number            // 放数（页/印张）
  orderQty: number       // 印数（份）
  wasteRate: number      // 裁切损耗率
  makeReady: number      // 校版损耗（张）
  theoretical: number    // 理论印张
  cuttingWaste: number   // 裁切损耗（张）
  total: number          // 印张用量（张）
}

export type Reservation = {
  id: string                // 预留单号
  batchId: string
  revisionId: string        // 拼版版本
  exportTaskId?: string     // 关联导出任务
  quantity: number          // 预留印张（= basis.total）
  basis: ReservationBasis
  status: ReservationStatus
  invalidReason?: string
  operator: string
  createdAt: string
  reconfirmedFrom?: string  // 由哪张失效预留单重新确认而来
}

export type ReserveInput = {
  batchId: string
  revisionId: string
  exportTaskId?: string
  pageWidth: number
  pageHeight: number
  ups: number
  orderQty: number
  wasteRate: number
  makeReady: number
  operator: string
}

export type Alternative = PaperBatch & { diffs: string[]; available: number }

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; required: number; available: number; shortage: number; alternatives: Alternative[] }

// ---------- 印张用量计算 ----------
// 印张用量 = 理论印张(印数/放数) + 裁切损耗 + 校版损耗
export function calcSheetUsage(input: {
  pageWidth: number
  pageHeight: number
  ups: number
  orderQty: number
  wasteRate: number
  makeReady: number
}): ReservationBasis {
  const theoretical = Math.ceil(input.orderQty / input.ups)
  const cuttingWaste = Math.ceil(theoretical * input.wasteRate)
  const total = theoretical + cuttingWaste + input.makeReady
  return { ...input, theoretical, cuttingWaste, total }
}

export function batchSpec(batch: PaperBatch): string {
  return `${batch.width}×${batch.height}mm · ${batch.grammage}g · ${batch.paperType} · ${batch.grain}纸纹`
}

// ---------- 模拟数据 ----------
let batches: PaperBatch[] = [
  { id: 'PAP-2609-01', name: '金东铜版纸', brand: '金东', paperType: '铜版纸', width: 720, height: 1020, grammage: 157, grain: '纵向', sheetCount: 5000, safetyStock: 800, location: 'A-03-02', status: '可用', updatedAt: '09-25 09:10' },
  { id: 'PAP-2609-02', name: '金东铜版纸', brand: '金东', paperType: '铜版纸', width: 720, height: 1020, grammage: 157, grain: '横向', sheetCount: 6000, safetyStock: 800, location: 'A-03-04', status: '可用', updatedAt: '09-25 09:10' },
  { id: 'PAP-2609-03', name: '太空梭哑粉纸', brand: '太空梭', paperType: '哑粉纸', width: 720, height: 1020, grammage: 157, grain: '纵向', sheetCount: 4000, safetyStock: 1500, location: 'B-01-06', status: '可用', updatedAt: '09-24 17:40' },
  { id: 'PAP-2609-04', name: '金东铜版纸', brand: '金东', paperType: '铜版纸', width: 720, height: 1020, grammage: 128, grain: '纵向', sheetCount: 8000, safetyStock: 1000, location: 'A-02-01', status: '可用', updatedAt: '09-23 11:20' },
  { id: 'PAP-2609-05', name: '金东铜版纸', brand: '金东', paperType: '铜版纸', width: 630, height: 880, grammage: 157, grain: '纵向', sheetCount: 2600, safetyStock: 600, location: 'C-05-03', status: '可用', updatedAt: '09-22 15:05' },
]

let reservations: Reservation[] = [
  // 在制 R5 加印，占用 PAP-01
  { id: 'RSV-2609-01', batchId: 'PAP-2609-01', revisionId: 'R5', quantity: 149, basis: { pageWidth: 210, pageHeight: 297, ups: 8, orderQty: 1000, wasteRate: 0.03, makeReady: 20, theoretical: 125, cuttingWaste: 4, total: 149 }, status: '已占用', operator: '林青', createdAt: '09-25 09:20' },
  // 已完成的数字样张导出，纸已核销
  { id: 'RSV-2609-02', batchId: 'PAP-2609-04', revisionId: 'R5', exportTaskId: 'EXP-0925-02', quantity: 320, basis: { pageWidth: 210, pageHeight: 297, ups: 8, orderQty: 2600, wasteRate: 0.03, makeReady: 20, theoretical: 325, cuttingWaste: 10, total: 355 }, status: '已核销', operator: '系统', createdAt: '09-25 15:10' },
  // 旧纸批规格变更，预留失效（审计留痕）
  { id: 'RSV-2609-03', batchId: 'PAP-2609-05', revisionId: 'R5', quantity: 88, basis: { pageWidth: 210, pageHeight: 285, ups: 8, orderQty: 500, wasteRate: 0.03, makeReady: 20, theoretical: 63, cuttingWaste: 2, total: 85 }, status: '已失效', invalidReason: '纸批规格变更（210×285 版位不再适用 630×880 纸批）', operator: '林青', createdAt: '09-22 16:00' },
  // 中断的印刷交付包：纸批剩余数量变更 → 预留失效，任务待复核，分片保留
  { id: 'RSV-2609-04', batchId: 'PAP-2609-01', revisionId: 'R6', exportTaskId: 'EXP-0925-01', quantity: 210, basis: { pageWidth: 210, pageHeight: 297, ups: 8, orderQty: 1500, wasteRate: 0.03, makeReady: 20, theoretical: 188, cuttingWaste: 6, total: 214 }, status: '已失效', invalidReason: '纸批剩余数量变更，可用库存减少，需重新核算印张用量并确认预留', operator: '林青', createdAt: '09-25 16:42' },
]

// ---------- 并发互斥：先到者占用，后到者拿到缺口 ----------
let chain: Promise<unknown> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

function heldOn(batchId: string): number {
  return reservations
    .filter((r) => r.batchId === batchId && r.status === '已占用')
    .reduce((sum, r) => sum + r.quantity, 0)
}

function findBatch(id: string) {
  return batches.find((b) => b.id === id)
}

function alternativesFor(batch: PaperBatch, required: number): Alternative[] {
  return batches
    .filter((b) => b.id !== batch.id && b.status !== '停用')
    .filter((b) => b.width === batch.width && b.height === batch.height && b.grammage === batch.grammage)
    .map((b) => {
      const diffs: string[] = []
      if (b.grain !== batch.grain) diffs.push(`${b.grain}纸纹`)
      if (b.paperType !== batch.paperType) diffs.push(b.paperType)
      if (b.brand !== batch.brand) diffs.push(b.brand)
      return { ...b, diffs, available: b.sheetCount - heldOn(b.id) } as Alternative
    })
    .filter((b) => b.available >= required)
    .sort((a, b) => b.available - a.available)
}

function nextReservationId(): string {
  const n = reservations.length + 1
  return `RSV-2609-${String(n).padStart(2, '0')}`
}

function now(): string {
  const d = new Date()
  const p = (v: number) => String(v).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------- 核心：预留（原子操作） ----------
function reserve(input: ReserveInput): Promise<ReserveResult> {
  return withLock(async () => {
    const basis = calcSheetUsage(input)
    const batch = findBatch(input.batchId)
    if (!batch) return { ok: false, required: basis.total, available: 0, shortage: basis.total, alternatives: [] }
    const available = batch.sheetCount - heldOn(batch.id)
    if (available >= basis.total) {
      const reservation: Reservation = {
        id: nextReservationId(),
        batchId: batch.id,
        revisionId: input.revisionId,
        exportTaskId: input.exportTaskId,
        quantity: basis.total,
        basis,
        status: '已占用',
        operator: input.operator,
        createdAt: now(),
      }
      reservations.push(reservation)
      return { ok: true, reservation }
    }
    const shortage = basis.total - available
    return { ok: false, required: basis.total, available, shortage, alternatives: alternativesFor(batch, basis.total) }
  })
}

// ---------- 释放预留 ----------
function releaseReservation(id: string): Promise<Reservation | null> {
  return withLock(async () => {
    const r = reservations.find((item) => item.id === id)
    if (r && r.status === '已占用') r.status = '已释放'
    return structuredClone(r ?? null)
  })
}

// ---------- 纸批变更：规格 / 纸纹 / 数量一变，关联预留单失效重算 ----------
function updateBatch(id: string, patch: Partial<PaperBatch>): Promise<{ batch: PaperBatch; invalidated: Reservation[] }> {
  return withLock(async () => {
    const batch = findBatch(id)
    if (!batch) return { batch: null as unknown as PaperBatch, invalidated: [] }
    const specChanged =
      (patch.width !== undefined && patch.width !== batch.width) ||
      (patch.height !== undefined && patch.height !== batch.height) ||
      (patch.grammage !== undefined && patch.grammage !== batch.grammage) ||
      (patch.paperType !== undefined && patch.paperType !== batch.paperType) ||
      (patch.grain !== undefined && patch.grain !== batch.grain)
    const qtyChanged = patch.sheetCount !== undefined && patch.sheetCount !== batch.sheetCount

    Object.assign(batch, patch)
    if (patch.sheetCount !== undefined) {
      batch.status = patch.sheetCount <= batch.safetyStock ? '偏低' : '可用'
    }
    batch.updatedAt = now()

    const invalidated: Reservation[] = []
    if (specChanged || qtyChanged) {
      const reason = specChanged
        ? '纸批规格或纸纹方向变更，原预留版位尺寸与用纸不再匹配，需重新核算并确认预留'
        : `纸批剩余数量变更（库存调整），可用印张变化，需重新核算印张用量并确认预留`
      for (const r of reservations) {
        if (r.batchId === batch.id && r.status === '已占用') {
          r.status = '已失效'
          r.invalidReason = reason
          invalidated.push(structuredClone(r))
        }
      }
    }
    return { batch: structuredClone(batch), invalidated }
  })
}

// ---------- mock axios adapter ----------
const adapter: AxiosAdapter = async (config) => {
  await new Promise((resolve) => setTimeout(resolve, 180))
  const url = config.url ?? ''
  const method = config.method?.toLowerCase() ?? 'get'

  if (url === '/api/paper/batches' && method === 'get') {
    return { data: structuredClone(batches), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (url === '/api/paper/reservations' && method === 'get') {
    return { data: structuredClone(reservations), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (url === '/api/paper/reservations' && method === 'post') {
    const input = JSON.parse(config.data) as ReserveInput
    return { data: await reserve(input), status: 200, statusText: 'OK', headers: {}, config }
  }
  const releaseMatch = url.match(/^\/api\/paper\/reservations\/([^/]+)\/release$/)
  if (releaseMatch && method === 'post') {
    return { data: await releaseReservation(releaseMatch[1]), status: 200, statusText: 'OK', headers: {}, config }
  }
  const batchMatch = url.match(/^\/api\/paper\/batches\/([^/]+)$/)
  if (batchMatch && method === 'patch') {
    const patch = JSON.parse(config.data) as Partial<PaperBatch>
    return { data: await updateBatch(batchMatch[1], patch), status: 200, statusText: 'OK', headers: {}, config }
  }
  return { data: null, status: 404, statusText: 'Not Found', headers: {}, config }
}

const client = axios.create({ adapter })

export const paperApi = {
  listBatches: () => client.get<PaperBatch[]>('/api/paper/batches'),
  listReservations: () => client.get<Reservation[]>('/api/paper/reservations'),
  reserve: (input: ReserveInput) => client.post<ReserveResult>('/api/paper/reservations', input),
  release: (id: string) => client.post<Reservation | null>(`/api/paper/reservations/${id}/release`),
  updateBatch: (id: string, patch: Partial<PaperBatch>) =>
    client.patch<{ batch: PaperBatch; invalidated: Reservation[] }>(`/api/paper/batches/${id}`, patch),
}
