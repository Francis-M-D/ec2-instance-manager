import { useQuery } from '@tanstack/react-query'
import { listAccounts } from '../api/schedules'
import { useAuthStore } from '../store/authStore'

export default function Settings() {
  const username = useAuthStore((s) => s.username)
  const { data: accounts = [], isLoading } = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-lg font-semibold text-slate-800">Settings</h1>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Current user</h2>
        <p className="text-sm text-slate-600">{username}</p>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Configured AWS accounts</h2>
        {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
        {!isLoading && accounts.length === 0 && (
          <p className="text-sm text-slate-400">No accounts configured yet.</p>
        )}
        <ul className="divide-y divide-slate-100">
          {accounts.map((a) => (
            <li key={a.key} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <div className="font-medium text-slate-800">{a.name}</div>
                <div className="text-xs text-slate-400">
                  key: {a.key} · account ID: {a.accountId}
                </div>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                {a.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">Credentials are never shown here or returned by the API.</p>
      </div>
    </div>
  )
}
