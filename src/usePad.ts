import { useEffect, useState } from 'react'
import { supabase, type Note } from './supabase'

type PadState = {
  note: Note | null
  text: string
  conflict: Note | null
  loading: boolean
  saving: boolean
  offline: boolean
  error: string
}
type Draft = { note: Note; text: string }
const initial: PadState = { note: null, text: '', conflict: null, loading: true, saving: false, offline: !navigator.onLine, error: '' }

class PadController {
  state = { ...initial }
  stopped = false
  timer: ReturnType<typeof setTimeout> | undefined
  pending: Promise<void> | null = null
  queued: Note | null = null
  fetchId = 0
  retired = new Set<string>()
  storageKey: string
  constructor(userId: string, private publish: (state: PadState) => void) {
    this.storageKey = `pad:draft:${userId}`
    try {
      const draft: Draft = JSON.parse(localStorage.getItem(this.storageKey) || 'null')
      if (draft?.note?.user_id === userId && typeof draft.text === 'string' && typeof draft.note.content === 'string' && typeof draft.note.version === 'number') {
        this.state.note = draft.note
        this.state.text = draft.text
      }
    } catch { /* Storage can be unavailable in private browsing. */ }
  }
  get dirty() { return !!this.state.note && this.state.text !== this.state.note.content }
  emit(patch: Partial<PadState> = {}) {
    if (this.stopped) return
    if (patch.note && this.state.note && patch.note.id !== this.state.note.id) {
      this.retired.add(this.state.note.id)
    }
    this.state = { ...this.state, ...patch }
    try {
      if (this.dirty) localStorage.setItem(this.storageKey, JSON.stringify({ note: this.state.note, text: this.state.text }))
      else localStorage.removeItem(this.storageKey)
    } catch { /* The in-memory draft still works when storage is full or disabled. */ }
    this.publish(this.state)
  }
  edit = (text: string) => {
    this.emit({ text, error: '' })
    this.schedule()
  }
  schedule() {
    clearTimeout(this.timer)
    if (!this.state.conflict && !this.state.offline) this.timer = setTimeout(() => { void this.save() }, 600)
  }
  receive(note: Note) {
    if (this.stopped || note.status !== 'current' || this.retired.has(note.id)) return
    const newest = this.queued || this.state.conflict || this.state.note
    if (newest && newest.id !== note.id && newest.created_at > note.created_at) return
    if (this.pending) {
      if (!this.queued || this.queued.id !== note.id || this.queued.version < note.version) this.queued = note
      return
    }
    const old = this.state.note
    if (old?.id === note.id && note.version <= old.version) return
    if (this.state.conflict?.id === note.id && note.version <= this.state.conflict.version) return
    if (this.dirty) this.emit({ conflict: note })
    else this.emit({ note, text: note.content, conflict: null, error: '' })
  }
  refresh = async () => {
    const fetchId = ++this.fetchId
    try {
      const { data, error } = await supabase.rpc('get_current_note')
      if (this.stopped || fetchId !== this.fetchId) return
      if (error || !data) throw error || new Error('No note returned')
      this.receive(data as Note)
      this.emit({ loading: false, offline: !navigator.onLine, error: '' })
      this.schedule()
    } catch {
      this.emit({ loading: false, offline: !navigator.onLine, error: navigator.onLine ? 'Unable to load pad. Retry when connected.' : '' })
    }
  }
  save = async (): Promise<void> => {
    clearTimeout(this.timer)
    if (this.pending) {
      await this.pending
      if (this.dirty && !this.state.conflict && !this.state.offline) return this.save()
      return
    }
    if (this.stopped || !this.dirty || this.state.conflict || !this.state.note) return
    if (!navigator.onLine) { this.emit({ offline: true }); return }
    const note = this.state.note
    const text = this.state.text
    ++this.fetchId
    this.emit({ saving: true, error: '' })
    const run = async () => {
      try {
        const { data, error } = await supabase.rpc('save_note', { p_id: note.id, p_content: text, p_expected_version: note.version })
        if (this.stopped) return
        if (error || !data?.note) throw error || new Error('No note returned')
        const server = data.note as Note
        if (data.ok) {
          // Edits typed during the request stay in the draft against the new version.
          this.emit({ note: server, conflict: null, offline: false })
        } else {
          this.emit({ note: server.id === note.id ? note : server, conflict: server, offline: false })
        }
      } catch {
        this.emit({ offline: !navigator.onLine, error: navigator.onLine ? 'Unable to save. Your draft is kept on this device.' : '' })
      }
    }
    this.pending = run()
    await this.pending
    this.pending = null
    ++this.fetchId
    this.emit({ saving: false })
    if (this.queued) {
      const queued = this.queued
      this.queued = null
      this.receive(queued)
    }
    if (this.dirty && !this.state.conflict && !this.state.error && !this.state.offline) this.schedule()
  }
  useTheirs = () => {
    const server = this.state.conflict
    if (server) this.emit({ note: server, text: server.content, conflict: null, error: '' })
  }
  keepMine = () => {
    const server = this.state.conflict
    if (!server) return
    this.emit({ note: server, conflict: null, error: '' })
    void this.save()
  }
  newNote = async () => {
    await this.save()
    if (this.stopped || this.dirty || this.state.conflict || this.state.offline) return false
    try {
      ++this.fetchId
      const { data, error } = await supabase.rpc('new_note')
      if (error || !data) throw error || new Error('No note returned')
      if (this.stopped) return false
      // A draft typed while New was in flight must never be discarded.
      ++this.fetchId
      this.receive(data as Note)
      return true
    } catch {
      this.emit({ offline: !navigator.onLine, error: 'Unable to start a new note.' })
      return false
    }
  }
  stop() { this.stopped = true; clearTimeout(this.timer) }
}

export function usePad(userId: string) {
  const [state, setState] = useState<PadState>(initial)
  const [controller, setController] = useState<PadController | null>(null)
  useEffect(() => {
    const pad = new PadController(userId, setState)
    setController(pad)
    pad.emit()
    void pad.refresh()
    const channel = supabase.channel(`pad:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${userId}` }, (payload) => {
        const note = payload.new as Note
        if (note.status === 'current') pad.receive(note)
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') void pad.refresh() })
    const focus = () => { void pad.refresh() }
    const visibility = () => {
      if (document.visibilityState === 'hidden') void pad.save()
      else void pad.refresh()
    }
    const offline = () => pad.emit({ offline: true })
    const online = () => { pad.emit({ offline: false }); void pad.refresh() }
    const unload = (event: BeforeUnloadEvent) => {
      if (pad.dirty) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    window.addEventListener('beforeunload', unload)
    return () => {
      pad.stop()
      void supabase.removeChannel(channel)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      window.removeEventListener('beforeunload', unload)
    }
  }, [userId])
  return { ...state, controller, dirty: !!state.note && state.text !== state.note.content }
}
