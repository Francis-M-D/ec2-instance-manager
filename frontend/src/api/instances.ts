import { api } from './client'

export interface InstanceListItem {
  instanceId: string
  name: string
  state: string
  dnsEnabled: boolean
  publicIp: string | null
  privateIp: string | null
  region: string
  accountKey: string
  launchTime: string | null
  instanceType: string | null
}

export interface Tag {
  key: string
  value: string
}

export interface InstanceDetail extends InstanceListItem {
  tags: { key: string; value: string }[]
}

export interface ActionSkip {
  instanceId: string
  reason: string
}

export interface ActionResult {
  wouldStart: string[]
  wouldStop: string[]
  wouldSkip: ActionSkip[]
  errors: Record<string, unknown>[]
}

export interface InstanceFilters {
  accountKeys: string[]
  regions: string[]
  statuses: string[]
  search: string
  hideProtected: boolean
}

export async function listInstances(filters: InstanceFilters): Promise<InstanceListItem[]> {
  const params = new URLSearchParams()
  if (filters.accountKeys.length) params.set('accountKeys', filters.accountKeys.join(','))
  if (filters.regions.length) params.set('regions', filters.regions.join(','))
  if (filters.statuses.length) params.set('statuses', filters.statuses.join(','))
  if (filters.search) params.set('search', filters.search)
  if (filters.hideProtected) params.set('dnsOnly', 'true')
  const res = await api.get<InstanceListItem[]>(`/instances?${params.toString()}`)
  return res.data
}

export async function getInstance(instanceId: string, accountKey: string, region: string): Promise<InstanceDetail> {
  const res = await api.get<InstanceDetail>(
    `/instances/${instanceId}?accountKey=${accountKey}&region=${region}`,
  )
  return res.data
}

export async function startInstances(
  accountKey: string,
  region: string,
  instanceIds: string[],
  dryRun: boolean,
): Promise<ActionResult> {
  const res = await api.post<ActionResult>('/instances/start', { accountKey, region, instanceIds, dryRun })
  return res.data
}

export async function stopInstances(
  accountKey: string,
  region: string,
  instanceIds: string[],
  dryRun: boolean,
): Promise<ActionResult> {
  const res = await api.post<ActionResult>('/instances/stop', { accountKey, region, instanceIds, dryRun })
  return res.data
}
