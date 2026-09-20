import { api } from './client'

export interface AuthResponse {
  token: string
  username: string
  role: 'Admin' | 'User'
}

export interface Me {
  id: number
  username: string
  email: string
  displayName: string
  role: 'Admin' | 'User'
}

// There is no public registration — accounts are created by an
// administrator only (see api/users.ts + pages/Users.tsx).
export async function login(username: string, password: string): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>('/auth/login', { username, password })
  return res.data
}

export async function getMe(): Promise<Me> {
  const res = await api.get<Me>('/auth/me')
  return res.data
}
