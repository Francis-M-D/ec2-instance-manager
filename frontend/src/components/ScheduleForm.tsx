import { useState } from 'react'
import Button from './Button'
import Modal from './Modal'
import { Schedule, ScheduleInput } from '../api/schedules'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Props {
  open: boolean
  onClose: () => void
  onSave: (input: ScheduleInput) => void
  accounts: { key: string; name: string }[]
  initial?: Schedule
  saving: boolean
}

export default function ScheduleForm({ open, onClose, onSave, accounts, initial, saving }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [accountKey, setAccountKey] = useState(initial?.accountKey ?? accounts[0]?.key ?? '')
  const [regions, setRegions] = useState(initial?.regions.join(',') ?? '')
  const [instanceIds, setInstanceIds] = useState(initial?.instanceIds.join(',') ?? '')
  const [action, setAction] = useState<'Start' | 'Stop'>(initial?.action ?? 'Start')
  const [mode, setMode] = useState<'windowed' | 'cron'>(initial?.cronExpression ? 'cron' : 'windowed')
  const [validFrom, setValidFrom] = useState(initial?.validFrom?.slice(0, 16) ?? '')
  const [validTo, setValidTo] = useState(initial?.validTo?.slice(0, 16) ?? '')
  const [recurrenceType, setRecurrenceType] = useState(initial?.recurrenceType ?? 'None')
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>(initial?.daysOfWeek ?? [])
  const [timeOfDay, setTimeOfDay] = useState(initial?.timeOfDay?.slice(0, 5) ?? '08:00')
  const [cronExpression, setCronExpression] = useState(initial?.cronExpression ?? '')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [errors, setErrors] = useState<string[]>([])

  function toggleDay(day: string) {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  function submit() {
    const errs: string[] = []
    if (!name.trim()) errs.push('Name is required')
    if (!accountKey) errs.push('Account is required')
    if (!validFrom) errs.push('Valid from is required')
    if (mode === 'windowed' && recurrenceType === 'Weekly' && daysOfWeek.length === 0)
      errs.push('Select at least one day of week')
    if (errs.length > 0) {
      setErrors(errs)
      return
    }

    onSave({
      name,
      accountKey,
      regions: regions.split(',').map((r) => r.trim()).filter(Boolean),
      instanceIds: instanceIds.split(',').map((r) => r.trim()).filter(Boolean),
      action,
      validFrom: validFrom ? new Date(validFrom).toISOString() : null,
      validTo: validTo ? new Date(validTo).toISOString() : null,
      recurrenceType: mode === 'windowed' ? recurrenceType : null,
      daysOfWeek: mode === 'windowed' && recurrenceType === 'Weekly' ? daysOfWeek : null,
      timeOfDay: mode === 'windowed' && recurrenceType !== 'None' ? `${timeOfDay}:00` : null,
      cronExpression: mode === 'cron' ? cronExpression : null,
      enabled,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit schedule' : 'New schedule'} wide>
      <div className="space-y-3 text-sm">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Account">
            <select className="input" value={accountKey} onChange={(e) => setAccountKey(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name} ({a.key})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Action">
            <select className="input" value={action} onChange={(e) => setAction(e.target.value as 'Start' | 'Stop')}>
              <option value="Start">Start</option>
              <option value="Stop">Stop</option>
            </select>
          </Field>
        </div>

        <Field label="Regions (comma-separated)">
          <input className="input" value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="us-east-1,ap-south-1" />
        </Field>
        <Field label="Specific instance IDs (blank = all matching filters)">
          <input className="input" value={instanceIds} onChange={(e) => setInstanceIds(e.target.value)} placeholder="i-0123,i-0456" />
        </Field>

        <div className="flex gap-4 border-t border-slate-100 pt-3">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === 'windowed'} onChange={() => setMode('windowed')} />
            Windowed recurrence
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === 'cron'} onChange={() => setMode('cron')} />
            Cron expression
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Valid from">
            <input type="datetime-local" className="input" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label="Valid to (optional)">
            <input type="datetime-local" className="input" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </Field>
        </div>

        {mode === 'windowed' ? (
          <>
            <Field label="Recurrence type">
              <select className="input" value={recurrenceType ?? 'None'} onChange={(e) => setRecurrenceType(e.target.value)}>
                <option value="None">None (one-off)</option>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
              </select>
            </Field>
            {recurrenceType === 'Weekly' && (
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => toggleDay(d)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      daysOfWeek.includes(d) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
            {recurrenceType !== 'None' && (
              <Field label="Time of day">
                <input type="time" className="input" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
              </Field>
            )}
          </>
        ) : (
          <Field label="Cron expression">
            <input className="input font-mono" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} placeholder="0 8 * * MON-FRI" />
          </Field>
        )}

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded text-brand-600" />
          Enabled
        </label>

        {errors.length > 0 && (
          <ul className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving}>
          Save
        </Button>
      </div>

      <style>{`.input { width: 100%; border: 1px solid #cbd5e1; border-radius: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.875rem; }
      .input:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 2px #ddd6fe; }`}</style>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}
