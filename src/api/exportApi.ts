import axios from 'axios'
import type { ExportTask } from '../stores/imposition'
import { reservationAdapter } from './reservationServer'

// 导出任务与纸张预留账共享同一个 mock 服务端：
// 恢复任务时会校验预留单状态、纸批指纹与分片冻结情况
const client = axios.create({ adapter: reservationAdapter })

export const exportApi = {
  list: () => client.get<ExportTask[]>('/api/print/export-tasks'),
  resume: (id: string) => client.post<ExportTask>(`/api/print/export-tasks/${id}/resume`),
  confirmLegacy: (id: string, batchId: string) =>
    client.post<{ task: ExportTask; reservation: { id: string } }>(`/api/print/export-tasks/${id}/confirm-legacy`, { batchId }),
}
