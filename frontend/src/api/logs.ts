import { api } from './client'

export interface AuditLogEntry {
  id: number
  timestamp: string
  userId: number | null
  userName: string
  actionType: string
  accountKey: string
  region: string
  instanceIds: string[]
  dryRun: boolean
  result: 'Success' | 'Failed' | 'Partial' | string
  message: string
  error: string | null
}

export interface LogFilters {
  accountKey?: string
  region?: string
  instanceId?: string
  actionType?: string
  result?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export interface LogsResponse {
  total: number
  page: number
  pageSize: number
  items: AuditLogEntry[]
}

export async function listLogs(filters: LogFilters): Promise<LogsResponse> {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, String(v))
  })
  const res = await api.get<LogsResponse>(`/logs?${params.toString()}`)
  return res.data
}
