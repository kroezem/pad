import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
export const loginEmail = import.meta.env.VITE_PAD_LOGIN_EMAIL?.trim()
if (!url || !anonKey || !loginEmail) {
  throw new Error('pad requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_PAD_LOGIN_EMAIL. Set them in .env.local or the deployment environment.')
}
export const appendUrl = `${url.replace(/\/$/, '')}/functions/v1/append`
const client = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})
export type Session = { user: { id: string } }
export type Attachment = { id: string; storage_path: string; filename: string; mime_type: string; size_bytes: number }
export type Block = {
  id: string
  content: string
  created_at: string
  archived_at: string
  attachments?: Attachment[]
  snippet?: string
  rank?: number
}
export type Note = Omit<Block, 'archived_at'> & {
  user_id: string
  version: number
  status: 'current' | 'archived'
  archived_at: string | null
  updated_at: string
  last_edited_at: string
}
export type Filter = 'all' | 'text' | 'links'
export type ApiKey = { id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
export type NoteEvent = { type: 'INSERT' | 'UPDATE'; note: Note } | { type: 'DELETE'; id: string } | { type: 'READY' }

export async function getSession(): Promise<Session | null> {
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  return data.session
}
export function watchAuth(callback: (session: Session | null) => void) {
  const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => callback(session))
  return () => subscription.unsubscribe()
}
export async function signIn(password: string) {
  const { error } = await client.auth.signInWithPassword({ email: loginEmail!, password })
  if (error) throw error
}
export async function signOut(everywhere = false) {
  const { error } = await client.auth.signOut({ scope: everywhere ? 'global' : 'local' })
  if (error) throw error
}
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return data as T
}
async function noteRpc(name: string, args?: Record<string, unknown>): Promise<Note> {
  const data = await rpc<Note | Note[]>(name, args)
  const note = Array.isArray(data) ? data[0] : data
  if (!note?.id) throw new Error('No note returned')
  return note
}
export const getCurrentNote = () => noteRpc('get_current_note')
export const cutNote = () => noteRpc('new_note')
export const editNote = (id: string) => noteRpc('edit_note', { p_id: id })
export const deleteNote = (id: string) => rpc<void>('delete_note', { p_id: id })
export const saveNote = (id: string, content: string, version: number) =>
  rpc<{ ok: boolean; note: Note }>('save_note', { p_id: id, p_content: content, p_expected_version: version })
export const feedNotes = (before: string | null = null, limit = 50) =>
  rpc<Block[]>('feed_notes', { p_before: before, p_limit: limit })
export const searchNotes = (query: string, filter: Filter, offset = 0, limit = 50) =>
  rpc<Block[]>('search_notes', { p_query: query, p_filter: filter, p_offset: offset, p_limit: limit })

const watchers = new Map<string, { listeners: Set<(event: NoteEvent) => void>; close: () => void }>()
export function watchNotes(userId: string, callback: (event: NoteEvent) => void) {
  let watcher = watchers.get(userId)
  if (!watcher) {
    const listeners = new Set<(event: NoteEvent) => void>()
    const dispatch = (event: NoteEvent) => listeners.forEach(listener => listener(event))
    const channel = client.channel(`pad:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes', filter: `user_id=eq.${userId}` }, payload => dispatch({ type: 'INSERT', note: payload.new as Note }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes', filter: `user_id=eq.${userId}` }, payload => dispatch({ type: 'UPDATE', note: payload.new as Note }))
      // Supabase cannot filter DELETE events; consumers remove only IDs already in their own feed.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes' }, payload => dispatch({ type: 'DELETE', id: payload.old.id as string }))
      .subscribe(status => { if (status === 'SUBSCRIBED') dispatch({ type: 'READY' }) })
    watcher = { listeners, close: () => { void client.removeChannel(channel) } }
    watchers.set(userId, watcher)
  }
  watcher.listeners.add(callback)
  return () => {
    const active = watchers.get(userId)
    active?.listeners.delete(callback)
    if (active && !active.listeners.size) { active.close(); watchers.delete(userId) }
  }
}
export async function listKeys(): Promise<ApiKey[]> {
  const { data, error } = await client.from('api_keys').select('id, label, created_at, last_used_at, revoked_at').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
export async function generateKey(label: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const raw = 'pad_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const { error } = await client.from('api_keys').insert({ label: label.trim() || 'Untitled key', key_hash: hash })
  if (error) throw error
  return raw
}
export async function revokeKey(id: string) {
  const { error } = await client.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
