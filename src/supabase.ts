import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
export const loginEmail = import.meta.env.VITE_PAD_LOGIN_EMAIL?.trim()
if (!url || !anonKey || !loginEmail) {
  throw new Error('pad requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_PAD_LOGIN_EMAIL. Set them in .env.local or the deployment environment.')
}
export const appendUrl = `${url.replace(/\/$/, '')}/functions/v1/append`
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})
export type Note = {
  id: string
  user_id: string
  content: string
  version: number
  status: 'current' | 'archived'
  created_at: string
  archived_at: string | null
}
