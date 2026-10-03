import axios from 'axios'
import { calcDemand, reservationAdapter, type Alternative, type DemandCalc, type PaperBatch, type ProductionVersion, type RaceOutcome, type Reservation } from './reservationServer'

const client = axios.create({ adapter: reservationAdapter })

export type PaperBatchView = PaperBatch & { available: number; holds: number }

export const paperApi = {
  batches: () => client.get<PaperBatchView[]>('/api/paper/batches'),
  versions: () => client.get<ProductionVersion[]>('/api/paper/versions'),
  reservations: () => client.get<Reservation[]>('/api/paper/reservations'),
  /** 提交生产：按版位尺寸/放数/裁切损耗核算印张用量，从指定纸批预留 */
  submit: (payload: { versionId: string; batchId: string; taskId?: string; copies?: number; oversPercent?: number; wastePercent?: number }) =>
    client.post<Reservation>('/api/paper/reservations', payload),
  /** 两个调度同时提交同一纸批：服务端互斥链先到先占 */
  race: (versionIds: string[], batchId: string) =>
    client.post<RaceOutcome[]>('/api/paper/reservations/race', { versionIds, batchId }),
  /** 纸批规格/纸纹/剩余数量变更：指纹更新，活动预留失效重算 */
  adjustBatch: (batchId: string, patch: Partial<PaperBatch>) =>
    client.patch<{ batch: PaperBatch; effect: { invalidated: string[]; recomputed: string[] } }>(`/api/paper/batches/${batchId}`, patch),
  /** 缺口/失效单改占可替代纸批重算 */
  recalculate: (reservationId: string, batchId: string) =>
    client.post<Reservation>(`/api/paper/reservations/${reservationId}/recalculate`, { batchId }),
  release: (reservationId: string) =>
    client.post<Reservation>(`/api/paper/reservations/${reservationId}/release`),
  reset: () => client.post<{ reset: boolean }>('/api/paper/reset'),
}

export { calcDemand }
export type { Alternative, DemandCalc, PaperBatch, ProductionVersion, RaceOutcome, Reservation }
