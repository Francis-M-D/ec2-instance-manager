import { create } from 'zustand'

export type Role = 'Admin' | 'User'

interface AuthState {
  token: string | null
  username: string | null
  role: Role | null
  setAuth: (token: string, username: string, role: Role) => void
  logout: () => void
}

const storedToken = sessionStorage.getItem('ec2mgr_token')
const storedUser = sessionStorage.getItem('ec2mgr_username')
const storedRole = sessionStorage.getItem('ec2mgr_role') as Role | null

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  username: storedUser,
  role: storedRole,
  setAuth: (token, username, role) => {
    sessionStorage.setItem('ec2mgr_token', token)
    sessionStorage.setItem('ec2mgr_username', username)
    sessionStorage.setItem('ec2mgr_role', role)
    set({ token, username, role })
  },
  logout: () => {
    sessionStorage.removeItem('ec2mgr_token')
    sessionStorage.removeItem('ec2mgr_username')
    sessionStorage.removeItem('ec2mgr_role')
    set({ token: null, username: null, role: null })
  },
}))
