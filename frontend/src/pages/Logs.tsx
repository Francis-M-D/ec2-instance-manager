import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listLogs } from '../api/logs'
import { ResultBadge } from '../components/Badge'
import Button from '../components/Button'

const ACTION_TYPES = ['ManualStart', 'ManualStop', 'ScheduleStart', 'ScheduleStop']
const RESULTS = ['Success', 'Partial', 'Failed']

export default function Logs() {
  const [accountKey, setAccountKey] = useState('')
  const [region, setRegion] = useState('')
  const [instanceId, setInstanceId] = useState('')
  const [actionType, setActionType] = useState('')
  const [result, setResult] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<number | null>(null)

  const filters = { accountKey, region, instanceId, actionType, result, from, to, page, pageSize: 20 }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['logs', filters],
    queryFn: () => listLogs(filters),
  })

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 20))

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-800">Audit Logs</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <TextField label="Account" value={accountKey} onChange={setAccountKey} />
        <TextField label="Region" value={region} onChange={setRegion} />
        <TextField label="Instance ID" value={instanceId} onChange={setInstanceId} />
        <SelectField label="Action type" value={actionType} onChange={setActionType} options={ACTION_TYPES} />
        <SelectField label="Result" value={result} onChange={setResult} options={RESULTS} />
        <TextField label="From" value={from} onChange={setFrom} type="datetime-local" />
        <TextField label="To" value={to} onChange={setTo} type="datetime-local" />
        <Button
          variant="secondary"
          onClick={() => {
            setPage(1)
            refetch()
          }}
        >
          Apply filters
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Account / Region</th>
              <th className="px-4 py-3">Instances</th>
              <th className="px-4 py-3">Dry run</th>
              <th className="px-4 py-3">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && (data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No log entries match your filters.
                </td>
              </tr>
            )}
            {data?.items.map((l) => (
              <>
                <tr key={l.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                  <td className="px-4 py-3 text-xs text-slate-500">{new Date(l.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-600">{l.userName}</td>
                  <td className="px-4 py-3 text-slate-600">{l.actionType}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {l.accountKey} / {l.region}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {l.instanceIds.length} instance(s)
                    {l.instanceIds.length > 0 && (
                      <span className="ml-1 text-xs text-slate-400" title={l.instanceIds.join(', ')}>
                        ⓘ
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{l.dryRun ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3">
                    <ResultBadge result={l.result} />
                  </td>
                </tr>
                {expanded === l.id && (
                  <tr key={`${l.id}-detail`} className="bg-slate-50">
                    <td colSpan={7} className="px-4 py-3 text-xs text-slate-600">
                      <div>
                        <span className="font-medium">Instances:</span> {l.instanceIds.join(', ') || '—'}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium">Message:</span> {l.message}
                      </div>
                      {l.error && (
                        <div className="mt-1 text-rose-600">
                          <span className="font-medium">Error:</span> {l.error}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>
            {data?.total ?? 0} entries — page {page} of {totalPages}
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
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <input
        type={type}
        className="w-40 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <select
        className="w-36 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}
