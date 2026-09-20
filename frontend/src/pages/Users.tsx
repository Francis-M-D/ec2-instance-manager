import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createUser,
  deleteUser,
  listUsers,
  ManagedUser,
  resetPassword,
  setUserActive,
  updateUser,
} from '../api/users'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'
import { useAuthStore } from '../store/authStore'

export default function Users() {
  const qc = useQueryClient()
  const { push } = useToast()
  const currentUsername = useAuthStore((s) => s.username)

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: listUsers })

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [generatedPassword, setGeneratedPassword] = useState<{ username: string; password: string } | null>(null)

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setCreateOpen(false)
      push('User created', 'success')
    },
    onError: (err: any) => push(err?.response?.data?.errors?.join(', ') ?? 'Failed to create user', 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: Parameters<typeof updateUser>[1] }) => updateUser(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditing(null)
      push('User updated', 'success')
    },
    onError: (err: any) => push(err?.response?.data?.errors?.join(', ') ?? 'Failed to update user', 'error'),
  })

  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => setUserActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (err: any) => push(err?.response?.data?.errors?.join(', ') ?? 'Action failed', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      push('User deleted', 'success')
    },
    onError: (err: any) => push(err?.response?.data?.errors?.join(', ') ?? 'Failed to delete user', 'error'),
  })

  const resetMutation = useMutation({
    mutationFn: ({ id }: { id: number; username: string }) => resetPassword(id),
    onSuccess: (res, vars) => {
      if (res.generatedPassword) setGeneratedPassword({ username: vars.username, password: res.generatedPassword })
      push('Password reset', 'success')
    },
    onError: () => push('Failed to reset password', 'error'),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Users</h1>
          <p className="text-sm text-slate-500">Admin-managed accounts. There is no public sign-up.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New user</Button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Display name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last login</th>
              <th className="px-4 py-3">Login method</th>
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
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{u.username}</td>
                <td className="px-4 py-3 text-slate-600">{u.displayName}</td>
                <td className="px-4 py-3 text-slate-600">{u.email || '—'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.role === 'Admin' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {u.isActive ? 'Active' : 'Deactivated'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {u.externalProviders.length > 0 ? u.externalProviders.join(', ') : 'Local password'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2 text-xs">
                    <button className="text-slate-600 hover:underline" onClick={() => setEditing(u)}>
                      Edit
                    </button>
                    <button
                      className="text-slate-600 hover:underline"
                      onClick={() => resetMutation.mutate({ id: u.id, username: u.username })}
                    >
                      Reset password
                    </button>
                    {u.username !== currentUsername && (
                      <>
                        <button
                          className="text-amber-600 hover:underline"
                          onClick={() => activeMutation.mutate({ id: u.id, active: !u.isActive })}
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          className="text-rose-600 hover:underline"
                          onClick={() => {
                            if (confirm(`Delete user '${u.username}'? This cannot be undone.`)) {
                              deleteMutation.mutate(u.id)
                            }
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={(input) => createMutation.mutate(input)}
        saving={createMutation.isPending}
      />

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSave={(input) => updateMutation.mutate({ id: editing.id, input })}
          saving={updateMutation.isPending}
        />
      )}

      <Modal
        open={!!generatedPassword}
        onClose={() => setGeneratedPassword(null)}
        title="Password reset"
        footer={<Button onClick={() => setGeneratedPassword(null)}>Done</Button>}
      >
        {generatedPassword && (
          <div className="space-y-2 text-sm">
            <p className="text-slate-600">
              New temporary password for <span className="font-medium">{generatedPassword.username}</span>:
            </p>
            <code className="block rounded-lg bg-slate-100 px-3 py-2 font-mono text-slate-800">
              {generatedPassword.password}
            </code>
            <p className="text-xs text-amber-600">
              This is shown once and not stored anywhere in plaintext. Share it with the user securely.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

function CreateUserModal({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean
  onClose: () => void
  onSave: (input: { username: string; email: string; displayName: string; role: 'Admin' | 'User'; password: string }) => void
  saving: boolean
}) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'Admin' | 'User'>('User')
  const [password, setPassword] = useState('')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New user"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            onClick={() => onSave({ username, email, displayName: displayName || username, role, password })}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Field label="Username">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Display name">
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'Admin' | 'User')}>
            <option value="User">User</option>
            <option value="Admin">Admin</option>
          </select>
        </Field>
        <Field label="Initial password">
          <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-400">12+ characters, with uppercase, lowercase, and a digit.</p>
        </Field>
      </div>
    </Modal>
  )
}

function EditUserModal({
  user,
  onClose,
  onSave,
  saving,
}: {
  user: ManagedUser
  onClose: () => void
  onSave: (input: { email: string; displayName: string; role: 'Admin' | 'User' }) => void
  saving: boolean
}) {
  const [email, setEmail] = useState(user.email)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [role, setRole] = useState<'Admin' | 'User'>(user.role)

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${user.username}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => onSave({ email, displayName, role })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Field label="Display name">
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'Admin' | 'User')}>
            <option value="User">User</option>
            <option value="Admin">Admin</option>
          </select>
        </Field>
      </div>
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
