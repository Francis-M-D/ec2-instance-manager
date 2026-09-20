import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listAccounts } from '../api/schedules'
import { listInstances, startInstances, stopInstances, ActionResult, InstanceListItem } from '../api/instances'
import { StateBadge, DnsBadge } from '../components/Badge'
import Button from '../components/Button'
import MultiSelectDropdown from '../components/MultiSelectDropdown'
import DryRunModal from '../components/DryRunModal'
import { useToast } from '../components/Toast'
import InstanceDetailsModal from '../components/InstanceDetailsModal'

const ALL_STATES = ['pending', 'running', 'shutting-down', 'terminated', 'stopping', 'stopped']

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return 'Unknown error'
}

export default function Dashboard() {
  const { push } = useToast()
  const qc = useQueryClient()

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })

  const [accountKeys, setAccountKeys] = useState<string[]>([])
  const [regions, setRegions] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [hideProtected, setHideProtected] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailsInstance, setDetailsInstance] = useState<InstanceListItem | null>(null)
  const [pendingAction, setPendingAction] = useState<{ action: 'start' | 'stop'; ids: string[] } | null>(null)
  const [dryRunResult, setDryRunResult] = useState<ActionResult | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = 15

  const effectiveAccountKeys = accountKeys.length > 0 ? accountKeys : accounts.map((a) => a.key)

  const {
    data: instances = [],
    isLoading,
    isFetching,
    error: instancesError,
    refetch,
  } = useQuery({
    queryKey: ['instances', effectiveAccountKeys, regions, statuses, search, hideProtected],
    queryFn: () => listInstances({ accountKeys: effectiveAccountKeys, regions, statuses, search, hideProtected }),
    enabled: effectiveAccountKeys.length > 0,
  })

  const regionOptions = useMemo(() => Array.from(new Set(instances.map((i) => i.region))).sort(), [instances])

  const paginated = instances.slice((page - 1) * pageSize, page * pageSize)
  const totalPages = Math.max(1, Math.ceil(instances.length / pageSize))

  const actionMutation = useMutation({
    mutationFn: async ({ action, ids, dryRun }: { action: 'start' | 'stop'; ids: string[]; dryRun: boolean }) => {
      // Group by account+region since the API acts per-account/region.
      const groups = new Map<string, { accountKey: string; region: string; ids: string[] }>()
      for (const id of ids) {
        const inst = instances.find((i) => i.instanceId === id)
        if (!inst) continue
        const key = `${inst.accountKey}::${inst.region}`
        if (!groups.has(key)) groups.set(key, { accountKey: inst.accountKey, region: inst.region, ids: [] })
        groups.get(key)!.ids.push(id)
      }
      const results: ActionResult[] = []
      for (const g of groups.values()) {
        const fn = action === 'start' ? startInstances : stopInstances
        results.push(await fn(g.accountKey, g.region, g.ids, dryRun))
      }
      return results.reduce<ActionResult>(
        (acc, r) => ({
          wouldStart: [...acc.wouldStart, ...r.wouldStart],
          wouldStop: [...acc.wouldStop, ...r.wouldStop],
          wouldSkip: [...acc.wouldSkip, ...r.wouldSkip],
          errors: [...acc.errors, ...r.errors],
        }),
        { wouldStart: [], wouldStop: [], wouldSkip: [], errors: [] },
      )
    },
  })

  function requestAction(action: 'start' | 'stop', ids: string[]) {
    setPendingAction({ action, ids })
    actionMutation.mutate(
      { action, ids, dryRun: true },
      { onSuccess: (res) => setDryRunResult(res) },
    )
  }

  function confirmAction() {
    if (!pendingAction) return
    actionMutation.mutate(
      { ...pendingAction, dryRun: false },
      {
        onSuccess: (res) => {
          const acted = pendingAction.action === 'start' ? res.wouldStart : res.wouldStop
          push(
            `${acted.length} instance(s) ${pendingAction.action === 'start' ? 'started' : 'stopped'}, ${res.wouldSkip.length} skipped`,
            res.errors.length > 0 ? 'error' : 'success',
          )
          setDryRunResult(null)
          setPendingAction(null)
          setSelected(new Set())
          qc.invalidateQueries({ queryKey: ['instances'] })
        },
      },
    )
  }

  async function handleRefresh() {
    // Refetch accounts first — if the account list itself is stale/empty,
    // refetching only 'instances' silently no-ops (enabled stays false).
    await qc.invalidateQueries({ queryKey: ['accounts'] })
    const result = await refetch()
    if (result.error) {
      push('Failed to refresh instances: ' + describeError(result.error), 'error')
    } else {
      push('Instances refreshed', 'success')
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            placeholder="Search by instance ID, name, IP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <MultiSelectDropdown
            label="Account"
            options={accounts.map((a) => a.key)}
            selected={accountKeys}
            onChange={setAccountKeys}
          />
          <MultiSelectDropdown label="Region" options={regionOptions} selected={regions} onChange={setRegions} />
          <MultiSelectDropdown label="Status" options={ALL_STATES} selected={statuses} onChange={setStatuses} />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={hideProtected}
              onChange={(e) => setHideProtected(e.target.checked)}
              className="rounded text-brand-600"
            />
            Hide protected
          </label>
          <Button variant="secondary" onClick={handleRefresh} loading={isFetching} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {instancesError && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
          Couldn't load instances: {describeError(instancesError)}. Click Refresh to try again.
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3 ring-1 ring-brand-200">
          <span className="text-sm font-medium text-brand-800">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
            <Button variant="secondary" onClick={() => requestAction('start', Array.from(selected))}>
              Start
            </Button>
            <Button variant="danger" onClick={() => requestAction('stop', Array.from(selected))}>
              Stop
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={paginated.length > 0 && paginated.every((i) => selected.has(i.instanceId))}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const next = new Set(prev)
                      paginated.forEach((i) => (e.target.checked ? next.add(i.instanceId) : next.delete(i.instanceId)))
                      return next
                    })
                  }}
                />
              </th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Protected</th>
              <th className="px-4 py-3">Public IP</th>
              <th className="px-4 py-3">Private IP</th>
              <th className="px-4 py-3">Region</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  Loading instances…
                </td>
              </tr>
            )}
            {!isLoading && paginated.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  No instances match your filters.
                </td>
              </tr>
            )}
            {paginated.map((inst) => (
              <tr key={inst.instanceId} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(inst.instanceId)}
                    onChange={() => toggleSelect(inst.instanceId)}
                  />
                </td>
                <td className="px-4 py-3">
                  <button className="font-medium text-slate-800 hover:text-brand-600" onClick={() => setDetailsInstance(inst)}>
                    {inst.name}
                  </button>
                  <div className="text-xs text-slate-400">{inst.instanceId}</div>
                </td>
                <td className="px-4 py-3">
                  <StateBadge state={inst.state} />
                </td>
                <td className="px-4 py-3">
                  <DnsBadge enabled={inst.dnsEnabled} />
                </td>
                <td className="px-4 py-3 text-slate-600">{inst.publicIp ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{inst.privateIp ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{inst.region}</td>
                <td className="px-4 py-3 text-slate-600">{inst.accountKey}</td>
                <td className="px-4 py-3">
                  <div
                    className="flex justify-end gap-1"
                    title={inst.dnsEnabled ? 'Action not allowed: this instance is protected (DNS tag is set to Yes).' : ''}
                  >
                    <Button
                      variant="secondary"
                      disabled={inst.dnsEnabled}
                      onClick={() => requestAction('start', [inst.instanceId])}
                      className="px-2 py-1 text-xs"
                    >
                      Start
                    </Button>
                    <Button
                      variant="danger"
                      disabled={inst.dnsEnabled}
                      onClick={() => requestAction('stop', [inst.instanceId])}
                      className="px-2 py-1 text-xs"
                    >
                      Stop
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>
            {instances.length} instance(s) — page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              Prev
            </Button>
            <Button variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Next
            </Button>
          </div>
        </div>
      </div>

      <DryRunModal
        open={!!pendingAction}
        onClose={() => {
          setPendingAction(null)
          setDryRunResult(null)
        }}
        result={dryRunResult}
        action={pendingAction?.action ?? 'start'}
        onConfirm={confirmAction}
        confirming={actionMutation.isPending}
      />

      {detailsInstance && (
        <InstanceDetailsModal
          instance={detailsInstance}
          onClose={() => setDetailsInstance(null)}
          onAction={(action) => {
            setDetailsInstance(null)
            requestAction(action, [detailsInstance.instanceId])
          }}
        />
      )}
    </div>
  )
}
