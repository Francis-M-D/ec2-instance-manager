const STATE_COLORS: Record<string, string> = {
  running: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20',
  stopped: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  pending: 'bg-amber-100 text-amber-700 ring-amber-600/20',
  stopping: 'bg-amber-100 text-amber-700 ring-amber-600/20',
  'shutting-down': 'bg-amber-100 text-amber-700 ring-amber-600/20',
  terminated: 'bg-rose-100 text-rose-700 ring-rose-600/20',
}

export function StateBadge({ state }: { state: string }) {
  const cls = STATE_COLORS[state] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {state}
    </span>
  )
}

export function DnsBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
      Protected
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-500/20">
      No
    </span>
  )
}

export function ResultBadge({ result }: { result: string }) {
  const map: Record<string, string> = {
    Success: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20',
    Partial: 'bg-amber-100 text-amber-700 ring-amber-600/20',
    Failed: 'bg-rose-100 text-rose-700 ring-rose-600/20',
  }
  const cls = map[result] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {result}
    </span>
  )
}
