import { api } from './client'

export interface ManagedUser {
  id: number
  username: string
  email: string
  displayName: string
  role: 'Admin' | 'User'
  isActive: boolean
  createdAt: string
  createdBy: string
  lastLoginAt: string | null
  externalProviders: string[] // populated once an OIDC provider is wired up
}

export interface CreateUserInput {
  username: string
  email: string
  displayName: string
  role: 'Admin' | 'User'
  password: string
}

export interface UpdateUserInput {
  email: string
  displayName: string
  role: 'Admin' | 'User'
}

export async function listUsers(): Promise<ManagedUser[]> {
  const res = await api.get<ManagedUser[]>('/users')
  return res.data
}

export async function createUser(input: CreateUserInput): Promise<ManagedUser> {
  const res = await api.post<ManagedUser>('/users', input)
  return res.data
}

export async function updateUser(id: number, input: UpdateUserInput): Promise<ManagedUser> {
  const res = await api.put<ManagedUser>(`/users/${id}`, input)
  return res.data
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`)
}

export async function setUserActive(id: number, active: boolean): Promise<ManagedUser> {
  const res = await api.post<ManagedUser>(`/users/${id}/${active ? 'activate' : 'deactivate'}`)
  return res.data
}

export async function resetPassword(id: number, newPassword?: string): Promise<{ generatedPassword: string | null }> {
  const res = await api.post<{ generatedPassword: string | null }>(`/users/${id}/reset-password`, {
    newPassword: newPassword || null,
  })
  return res.data
}
