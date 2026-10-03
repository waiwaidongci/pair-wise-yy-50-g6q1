import axios, { type AxiosAdapter } from 'axios'
import type { ExportTask } from '../stores/imposition'
import { useImpositionStore } from '../stores/imposition'

const adapter: AxiosAdapter = async (config) => {
  await new Promise((resolve) => setTimeout(resolve, 160))
  const store = useImpositionStore()

  if (config.url === '/api/print/export-tasks' && config.method === 'get') {
    return { data: structuredClone(store.tasks), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (config.url === '/api/print/export-tasks' && config.method === 'post') {
    const input = JSON.parse(config.data) as ExportTask
    if (!store.tasks.some((t) => t.id === input.id)) store.tasks.push(input)
    return { data: structuredClone(input), status: 200, statusText: 'OK', headers: {}, config }
  }
  if (config.url?.match(/^\/api\/print\/export-tasks\/[^/]+\/resume$/) && config.method === 'post') {
    const id = config.url.split('/').at(-2)
    const task = store.tasks.find((item) => item.id === id)
    if (task && task.resumable) {
      task.status = '生成中'
      task.progress = Math.max(task.progress, 12)
      task.updatedAt = '刚刚'
    }
    return { data: structuredClone(task), status: 200, statusText: 'OK', headers: {}, config }
  }
  return { data: null, status: 404, statusText: 'Not Found', headers: {}, config }
}

const client = axios.create({ adapter })

export const exportApi = {
  list: () => client.get<ExportTask[]>('/api/print/export-tasks'),
  create: (task: ExportTask) => client.post<ExportTask>('/api/print/export-tasks', task),
  resume: (id: string) => client.post<ExportTask>(`/api/print/export-tasks/${id}/resume`),
}
