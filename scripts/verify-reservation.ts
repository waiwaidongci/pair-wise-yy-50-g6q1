// 端到端逻辑验证：直接跑 mock adapter（自带 localStorage shim）
class LocalStorageShim {
  private store = new Map<string, string>()
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string) { this.store.set(k, String(v)) }
  removeItem(k: string) { this.store.delete(k) }
  clear() { this.store.clear() }
}
;(globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = new LocalStorageShim()

async function main() {
const { reservationAdapter } = await import('../src/api/reservationServer')
const { default: axios } = await import('axios')
const client = axios.create({ adapter: reservationAdapter })

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { failed++; console.log(`  ❌ ${name} ${detail}`) }
}
const get = async <T,>(url: string) => (await client.get<T>(url)).data
const post = async <T,>(url: string, body?: unknown) => (await client.post<T>(url, body ?? {})).data
const patch = async <T,>(url: string, body?: unknown) => (await client.patch<T>(url, body ?? {})).data

/* 场景 1：印张用量计算 */
console.log('\n[1] 印张用量 = 版位尺寸/放数/裁切损耗')
const r6 = await post<any>('/api/paper/reservations', { versionId: 'VER-R6', batchId: 'LOT-7201' })
console.log('   ', r6.calc.formula)
// ⌈48/8⌉=6 张/册；3000×6=18000；×1.04=18720；×1.025=19188
check('每册印张=6', r6.calc.sheetsPerCopy === 6)
check('放数后=18720', r6.calc.netSheets === 18720, String(r6.calc.netSheets))
check('预留=19188', r6.calc.requiredSheets === 19188, String(r6.calc.requiredSheets))
check('状态已占用', r6.status === '已占用', r6.status)
check('关联版本排队', (await get<any[]>('/api/paper/versions')).find((v) => v.id === 'VER-R6').status === '排队中')
const tasks = await get<any[]>('/api/print/export-tasks')
check('关联导出任务排队且绑定预留单号', tasks.find((t) => t.id === 'EXP-1003-01').reservationId === r6.id)

/* 场景 2：两调度同时提交同一纸批，先到先占，后到缺口+替代批 */
console.log('\n[2] 双调度并发：先到先占 / 后到缺口+可替代纸批')
const race = await post<any[]>('/api/paper/reservations/race', { versionIds: ['VER-R6', 'VER-S2'], batchId: 'LOT-7201' })
// R6 已有活动预留 → 第一个直接冲突；重置后重测干净路径
check('已占用版本拒绝重复占用(409在error里)', race[0].error !== undefined || race[0].reservation?.status === '已占用')

/* 场景 2b：干净重置后的真并发 */
await post('/api/paper/reset')
const race2 = await post<any[]>('/api/paper/reservations/race', { versionIds: ['VER-R6', 'VER-S2'], batchId: 'LOT-7201' })
check('两条结果按序返回', race2.length === 2)
const first = race2.find((r) => r.versionId === 'VER-R6')!.reservation
const second = race2.find((r) => r.versionId === 'VER-S2')!.reservation
check('序号严格递增（先到先占）', first.seq < second.seq, `${first.seq} vs ${second.seq}`)
check('先到 R6 已占用 19188 张', first.status === '已占用' && first.held === 19188)
// S2: ⌈48/8⌉×3200=19200 ×1.05=20160 ×1.03=20765；ATP=5400-19188 → 0
check('后到 S2 为缺口', second.status === '缺口', second.status)
check('后到 held=1812 gap=18953', second.held === 1812 && second.gap === 18953, `held=${second.held} gap=${second.gap}`)
const alt7202 = second.alternatives.find((a: any) => a.batchId === 'LOT-7202')
check('给出可替代 LOT-7202 且可覆盖', alt7202 && alt7202.covers === true && alt7202.match === '规格一致')
const altGrain = second.alternatives.find((a: any) => a.batchId === 'LOT-7203')
check('纸纹不符标红不可覆盖', altGrain.match === '纸纹不符' && altGrain.covers === false)
const altSize = second.alternatives.find((a: any) => a.batchId === 'LOT-6401')
check('尺寸不符不可覆盖', altSize.match === '尺寸不符' && altSize.covers === false)
const altGsm = second.alternatives.find((a: any) => a.batchId === 'LOT-7204')
check('克重差异标等级差异', altGsm.match === '等级差异')

/* 场景 3：缺口改占替代批重算 */
console.log('\n[3] 后到者改占 LOT-7202 重算')
const moved = await post<any>(`/api/paper/reservations/${second.id}/recalculate`, { batchId: 'LOT-7202' })
check('新单已占用', moved.status === '已占用' && moved.requested === 20765 && moved.held === 20765)
check('新单来源=失效重算并留痕', moved.source === '失效重算' && moved.predecessor === second.id)
const oldRow = (await get<any[]>('/api/paper/reservations')).find((r) => r.id === second.id)
check('旧单标记已释放+接替单号', oldRow.status === '已释放' && oldRow.supersededBy === moved.id)

/* 场景 4：纸批剩余数量变 → 失效重算；未开工自动改占 */
console.log('\n[4] 纸批剩余量被另一工单领走 → 指纹变更 → 失效重算')
// 先把 S2 从 7202 挪开，让 R6 的 LOT-7201 失效后能自动改占到 7202
await post(`/api/paper/reservations/${moved.id}/release`)
const before = (await get<any[]>('/api/paper/batches')).find((b) => b.id === 'LOT-7201')
const fpBefore = before.fingerprint
const effect = (await patch<{ effect: any }>('/api/paper/batches/LOT-7201', { onHand: before.onHand - 19500 })).effect
check('指纹改变', fpBefore !== (await get<any[]>('/api/paper/batches')).find((b) => b.id === 'LOT-7201').fingerprint)
check('R6 预留进入失效列表', effect.invalidated.includes(first.id))
check('未开工单自动改占重算 1 张', effect.recomputed.length === 1, JSON.stringify(effect.recomputed))
const ledger = await get<any[]>('/api/paper/reservations')
const successor = ledger.find((r) => r.predecessor === first.id)
check('接替单落在 LOT-7202', successor && successor.batchId === 'LOT-7202' && successor.source === '失效重算', JSON.stringify(successor?.batchId))
// 自动重算后：旧批剩余 1500 < 占用 19188，但占用是“旧指纹时代”锁定的；接替单已在 7202 重新占足
check('接替单足额占用', successor.held === successor.requested, `held=${successor?.held} req=${successor?.requested}`)

/* 场景 5：已开工后纸批变更 → 分片冻结保留，不得在旧批续作 */
console.log('\n[5] 已开工 → 纸批变更 → 分片保留但禁止混入旧批')
await post('/api/paper/reset')
const rsv = await post<any>('/api/paper/reservations', { versionId: 'VER-R6', batchId: 'LOT-7201' })
let t1 = await post<any>('/api/print/export-tasks/EXP-1003-01/resume')
check('首次恢复任务进入生成中（推进 1 分片）', t1.status === '生成中' && t1.progress === 25, `${t1.status} ${t1.progress}%`)
check('预留转为已开工', (await get<any[]>('/api/paper/reservations')).find((r) => r.id === rsv.id).status === '已开工')
const batch = (await get<any[]>('/api/paper/batches')).find((b) => b.id === 'LOT-7201')
await patch('/api/paper/batches/LOT-7201', { grain: '横向' })
const tasks5 = await get<any[]>('/api/print/export-tasks')
const t5 = tasks5.find((t) => t.id === 'EXP-1003-01')
check('任务中断且冻结', t5.status === '已中断' && t5.frozen === true)
const completed = t5.shards.filter((s: any) => s.state === '冻结保留')
const pending = t5.shards.filter((s: any) => s.state === '待生成')
check('已完成分片保留并标注旧批', completed.length > 0 && completed.every((s: any) => s.batchId === 'LOT-7201'), JSON.stringify(completed))
check('待生成分片未被标记成旧批', pending.every((s: any) => !s.batchId))
let blocked = false
try { await post('/api/print/export-tasks/EXP-1003-01/resume') } catch (e: any) { blocked = e.response.status === 409 }
check('旧批直接续作被 409 拦截', blocked)

/* 场景 5b：改占新批后续作；新旧分片分批标注 */
const rsvs5 = await get<any[]>('/api/paper/reservations')
const invalid5 = rsvs5.find((r) => r.versionId === 'VER-R6' && r.status === '已失效')
const newRsv = await post<any>(`/api/paper/reservations/${invalid5.id}/recalculate`, { batchId: 'LOT-7202' })
check('失效单可改批重算', newRsv.status === '已占用' && newRsv.batchId === 'LOT-7202')
// 剩余 3 个待生成分片逐片恢复到完成
let finalT: any
for (let i = 0; i < 3; i++) finalT = await post<any>('/api/print/export-tasks/EXP-1003-01/resume')
check('任务完成', finalT.status === '已完成' && finalT.progress === 100, `${finalT.status} ${finalT.progress}%`)
const labels = finalT.shards.map((s: any) => `${s.state}:${s.batchId}`)
check('旧分片保留旧批标注、新分片属新批（不混纸）',
  labels.filter((l: string) => l === '冻结保留:LOT-7201').length === 1
  && labels.filter((l: string) => l === '已完成:LOT-7202').length === 3,
  JSON.stringify(labels))
check('预留结单', (await get<any[]>('/api/paper/reservations')).find((r) => r.id === newRsv.id).status === '已完成')

/* 场景 6：旧任务无预留单号 → 待复核 → 确认后才能占用 */
console.log('\n[6] 旧任务无预留单号 → 待复核闸门')
await post('/api/paper/reset')
let legacy = (await get<any[]>('/api/print/export-tasks')).find((t) => t.id === 'EXP-0925-01')
check('旧任务初始=待复核且冻结', legacy.status === '待复核' && legacy.frozen === true)
let legacyBlocked = false
try { await post('/api/print/export-tasks/EXP-0925-01/resume') } catch (e: any) { legacyBlocked = e.response.status === 409 }
check('未确认直接恢复被 409 拦截', legacyBlocked)
const confirmed = await post<{ task: any; reservation: any }>('/api/print/export-tasks/EXP-0925-01/confirm-legacy', { batchId: 'LOT-7202' })
check('确认后任务排队且绑定预留单号', confirmed.task.status === '排队中' && confirmed.task.reservationId === confirmed.reservation.id)
check('复核预留来源=旧任务复核', confirmed.reservation.source === '旧任务复核')
check('复核前完成分片保留留档', confirmed.task.shards.filter((s: any) => s.state === '冻结保留').length === 2)
let resumed = await post<any>('/api/print/export-tasks/EXP-0925-01/resume')
resumed = await post<any>('/api/print/export-tasks/EXP-0925-01/resume')
check('确认后可恢复续跑', resumed.status === '已完成', resumed.status)
const resumedShards = resumed.shards.map((s: any) => `${s.state}:${s.batchId ?? '-'}`)
check('续作新分片落在确认纸批', resumedShards.filter((l: string) => l === '已完成:LOT-7202').length === 2, JSON.stringify(resumedShards))

/* 场景 7：库存视图 ATP 口径 */
console.log('\n[7] 可预留库存 = 剩余 - 有效占用（失效/释放不占）')
await post('/api/paper/reset')
const a0 = (await get<any[]>('/api/paper/batches')).find((b) => b.id === 'LOT-7201')
check('初始可预留=剩余', a0.available === a0.onHand && a0.holds === 0)
const rr = await post<any>('/api/paper/reservations', { versionId: 'VER-R6', batchId: 'LOT-7201' })
const a1 = (await get<any[]>('/api/paper/batches')).find((b) => b.id === 'LOT-7201')
check('占用后 ATP 扣减', a1.available === 21000 - 19188 && a1.holds === 19188, `avail=${a1.available}`)
await post(`/api/paper/reservations/${rr.id}/release`)
const a2 = (await get<any[]>('/api/paper/batches')).find((b) => b.id === 'LOT-7201')
check('释放后 ATP 回补', a2.available === 21000 && a2.holds === 0)

console.log(`\n===== 结果：${passed} 通过 / ${failed} 失败 =====`)
if (failed) process.exitCode = 1
}

main()
