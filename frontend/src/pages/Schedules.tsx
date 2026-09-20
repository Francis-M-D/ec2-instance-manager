import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createSchedule,
  deleteSchedule,
  dryRunSchedule,
  DryRunPreview,
  listAccounts,
  listSchedules,
  Schedule,
  ScheduleInput,
  setScheduleEnabled,
  updateSchedule,
} from '../api/schedules'
import Button from '../components/Button'
import Modal from '../components/Modal'
import ScheduleForm from '../components/ScheduleForm'
import { useToast } from '../components/Toast'

function recurrenceSummary(s: Schedule): string {
  if (s.cronExpression) return `Cron: ${s.cronExpression}`
  if (s.recurrenceType === 'Daily') return `Daily at ${s.timeOfDay?.slice(0, 5)}`
  if (s.recurrenceType === 'Weekly') return `Weekly ${s.daysOfWeek?.join('/')} at ${s.timeOfDay?.slice(0, 5)}`
  return s.validFrom ? `One-off at ${new Date(s.validFrom).toLocaleString()}` : '—'
}

export default function Schedules() {
  const qc = useQueryClient()
  const { push } = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Schedule | undefined>(undefined)
  const [previewFor, setPreviewFor] = useState<Schedule | null>(null)
  const [preview, setPreview] = useState<DryRunPreview[] | null>(null)

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const { data: schedules = [], isLoading } = useQuery({ queryKey: ['schedules'], queryFn: listSchedules })

  const saveMutation = useMutation({
    mutationFn: (input: ScheduleInput) => (editing ? updateSchedule(editing.id, input) : createSchedule(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      setFormOpen(false)
      setEditing(undefined)
      push('Schedule saved', 'success')
    },
    onError: (err: any) => push(err?.response?.data?.errors?.join(', ') ?? 'Failed to save schedule', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      push('Schedule deleted', 'success')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => setScheduleEnabled(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  })

  async function openPreview(s: Schedule) {
    setPreviewFor(s)
    setPreview(null)
    try {
      const res = await dryRunSchedule(s.id)
      setPreview(res)
    } catch {
      push('Failed to compute dry run preview', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Schedules</h1>
        <Button
          onClick={() => {
            setEditing(undefined)
            setFormOpen(true)
          }}
        >
          + New schedule
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Regions</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Recurrence</th>
              <th className="px-4 py-3">Valid from – to</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && schedules.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  No schedules yet.
                </td>
              </tr>
            )}
            {schedules.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                <td className="px-4 py-3 text-slate-600">{s.accountKey}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {s.regions.map((r) => (
                      <span key={r} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.action === 'Start' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {s.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{recurrenceSummary(s)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {s.validFrom ? new Date(s.validFrom).toLocaleDateString() : '—'} –{' '}
                  {s.validTo ? new Date(s.validTo).toLocaleDateString() : 'open'}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleMutation.mutate({ id: s.id, enabled: !s.enabled })}
                    className={`h-5 w-9 rounded-full transition ${s.enabled ? 'bg-brand-600' : 'bg-slate-300'}`}
                  >
                    <span
                      className={`block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition ${
                        s.enabled ? 'translate-x-4' : ''
                      }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5 text-xs">
                    <button className="text-brand-600 hover:underline" onClick={() => openPreview(s)}>
                      Dry run
                    </button>
                    <button
                      className="text-slate-600 hover:underline"
                      onClick={() => {
                        setEditing(s)
                        setFormOpen(true)
                      }}
                    >
                      Edit
                    </button>
                    <button className="text-rose-600 hover:underline" onClick={() => deleteMutation.mutate(s.id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ScheduleForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={(input) => saveMutation.mutate(input)}
        accounts={accounts}
        initial={editing}
        saving={saveMutation.isPending}
      />

      <Modal open={!!previewFor} onClose={() => setPreviewFor(null)} title={`Dry run — ${previewFor?.name ?? ''}`} wide>
        {!preview && <p className="text-sm text-slate-400">Computing preview…</p>}
        {preview && preview.length === 0 && <p className="text-sm text-slate-400">No upcoming runs in the valid window.</p>}
        {preview && preview.length > 0 && (
          <div className="space-y-4">
            {preview.map((p, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-sm font-medium text-slate-700">{new Date(p.nextRunAt).toLocaleString()}</div>
                <div className="text-xs text-slate-500">
                  <span className="font-medium text-emerald-700">Would affect:</span>{' '}
                  {p.affectedInstanceIds.length > 0 ? p.affectedInstanceIds.join(', ') : 'none'}
                </div>
                <div className="text-xs text-slate-500">
                  <span className="font-medium text-amber-700">Would skip:</span>{' '}
                  {p.skippedInstanceIds.length > 0 ? p.skippedInstanceIds.join(', ') : 'none'}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
