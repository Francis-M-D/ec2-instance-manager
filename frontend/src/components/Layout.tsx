import { NavLink, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

const baseLinks = [
  { to: '/', label: 'Dashboard' },
  { to: '/schedules', label: 'Schedules' },
  { to: '/logs', label: 'Logs' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  const { username, role, logout } = useAuthStore()
  const links = role === 'Admin' ? [...baseLinks, { to: '/users', label: 'Users' }] : baseLinks

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-brand-gradient shadow-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-8">
            <span className="text-lg font-bold text-white">⚡ EC2 Manager</span>
            <nav className="flex gap-1">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === '/'}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      isActive ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-white">
            <span className="opacity-90">
              {username} {role && <span className="text-white/60">({role})</span>}
            </span>
            <button onClick={logout} className="rounded-lg bg-white/15 px-3 py-1.5 hover:bg-white/25">
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
