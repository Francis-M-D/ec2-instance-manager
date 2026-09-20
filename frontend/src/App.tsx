import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { ToastProvider } from './components/Toast'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Schedules from './pages/Schedules'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import Users from './pages/Users'

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

// Only rendered inside RequireAuth (nested route), so a token is already
// guaranteed here — this just adds the role check on top.
function RequireAdmin({ children }: { children: JSX.Element }) {
  const role = useAuthStore((s) => s.role)
  if (role !== 'Admin') return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="/users"
            element={
              <RequireAdmin>
                <Users />
              </RequireAdmin>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  )
}
