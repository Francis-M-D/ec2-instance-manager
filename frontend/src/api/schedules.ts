import { api } from './client'

export interface Account {
  key: string
  name: string
  accountId: string
  enabled: boolean
}

export async function listAccounts(): Promise<Account[]> {
  const res = await api.get<Account[]>('/accounts')
  return res.data
}

export interface Schedule {
  id: number
  name: string
  accountKey: string
  regions: string[]
  instanceIds: string[]
  action: 'Start' | 'Stop'
  validFrom: string | null
  validTo: string | null
  recurrenceType: string | null
  daysOfWeek: string[] | null
  timeOfDay: string | null
  cronExpression: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
  createdBy: string
}

export type ScheduleInput = Omit<Schedule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>

export async function listSchedules(): Promise<Schedule[]> {
  const res = await api.get<Schedule[]>('/schedules')
  return res.data
}

export async function createSchedule(input: ScheduleInput): Promise<Schedule> {
  const res = await api.post<Schedule>('/schedules', input)
  return res.data
}

export async function updateSchedule(id: number, input: ScheduleInput): Promise<Schedule> {
  const res = await api.put<Schedule>(`/schedules/${id}`, input)
  return res.data
}

export async function deleteSchedule(id: number): Promise<void> {
  await api.delete(`/schedules/${id}`)
}

export async function setScheduleEnabled(id: number, enabled: boolean): Promise<Schedule> {
  const res = await api.post<Schedule>(`/schedules/${id}/${enabled ? 'enable' : 'disable'}`)
  return res.data
}

export interface DryRunPreview {
  nextRunAt: string
  affectedInstanceIds: string[]
  skippedInstanceIds: string[]
}

export async function dryRunSchedule(id: number, count = 3): Promise<DryRunPreview[]> {
  const res = await api.post<DryRunPreview[]>(`/schedules/${id}/dryRun?count=${count}`)
  return res.data
}
