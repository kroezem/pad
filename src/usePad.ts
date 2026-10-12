import { useEffect, useState } from 'react'
import { getCurrentNote, saveNote, cutNote, editNote, watchNotes, type Note } from './data'

type PadState = {
  note: Note | null
  text: string
  conflict: Note | null
  loading: boolean
  saving: boolean
  transitioning: boolean
  offline: boolean
  error: string
}
type Draft = { note: Note; text: string; unsaved?: boolean }
const initial: PadState = { note: null, text: '', conflict: null, loading: true, saving: false, transitioning: false, offline: !navigator.onLine, error: '' }

class PadController {
  state = { ...initial }
  stopped = false
  timer: ReturnType<typeof setTimeout> | undefined
  pending: Promise<void> | null = null
  queued: Note | null = null
  fetchId = 0
  unconfirmed = false
  pendingText: string | null = null
  storageKey: string
  constructor(userId: string, private publish: (state: PadState) => void) {
    this.storageKey = `pad:draft:${userId}`
    try {
      const draft: Draft = JSON.parse(localStorage.getItem(this.storageKey) || 'null')
      if (draft?.note?.user_id === userId && typeof draft.text === 'string' && typeof draft.note.content === 'string' && typeof draft.note.version === 'number') {
        this.state.note = draft.note
        this.state.text = draft.text
        this.unconfirmed = draft.unsaved === true
      }
    } catch { /* Storage can be unavailable in private browsing. */ }
  }
  get dirty() { return !!this.state.note && (this.unconfirmed || this.state.text !== this.state.note.content || (this.pendingText !== null && this.state.text !== this.pendingText)) }
  emit(patch: Partial<PadState> = {}) {
    if (this.stopped) return
    this.state = { ...this.state, ...patch }
    try {
      if (this.dirty) localStorage.setItem(this.storageKey, JSON.stringify({ note: this.state.note, text: this.state.text, unsaved: true }))
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
    if (this.stopped || note.status !== 'current') return
    const newest = this.queued || this.state.conflict || this.state.note
    if (newest && newest.id !== note.id && newest.updated_at > note.updated_at) return
    if (this.pending || this.state.transitioning) {
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
      const data = await getCurrentNote()
      if (this.stopped || fetchId !== this.fetchId) return
      if (!data) throw new Error('No note returned')
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
      if (this.dirty && !this.state.conflict && !this.state.offline && !this.state.error) return this.save()
      return
    }
    if (this.stopped || !this.dirty || this.state.conflict || !this.state.note) return
    if (!navigator.onLine) { this.emit({ offline: true }); return }
    const note = this.state.note
    const text = this.state.text
    ++this.fetchId
    this.pendingText = text
    this.emit({ saving: true, error: '' })
    const run = async () => {
      try {
        const data = await saveNote(note.id, text, note.version)
        if (this.stopped) return
        if (!data?.note) throw new Error('No note returned')
        const server = data.note
        this.pendingText = null
        this.unconfirmed = false
        if (data.ok) {
          // Edits typed during the request stay in the draft against the new version.
          this.emit({ note: server, conflict: null, offline: false })
        } else {
          this.emit({ note: server.id === note.id ? note : server, conflict: server, offline: false })
        }
      } catch {
        this.pendingText = null
        this.unconfirmed = true
        this.emit({ offline: !navigator.onLine, error: navigator.onLine ? 'Unable to save. Your draft is kept on this device.' : '' })
      }
    }
    this.pending = run()
    await this.pending
    this.pending = null
    ++this.fetchId
    this.emit({ saving: false })
    if (this.queued && !this.state.transitioning) {
      const queued = this.queued
      this.queued = null
      this.receive(queued)
    }
    if (this.dirty && !this.state.conflict && !this.state.error && !this.state.offline) this.schedule()
  }
  useTheirs = () => {
    const server = this.state.conflict
    if (server) { this.unconfirmed = false; this.emit({ note: server, text: server.content, conflict: null, error: '' }) }
  }
  keepMine = () => {
    const server = this.state.conflict
    if (!server) return
    this.emit({ note: server, conflict: null, error: '' })
    void this.save()
  }
  transition = async (id?: string) => {
    if (this.state.transitioning || this.state.conflict || this.state.offline) return false
    if (!id && !this.state.text.trim()) return false
    this.emit({ transitioning: true, error: '' })
    await this.save()
    if (this.stopped || this.dirty || this.state.conflict || this.state.offline) {
      this.emit({ transitioning: false })
      if (this.queued) { const queued = this.queued; this.queued = null; this.receive(queued) }
      return false
    }
    try {
      ++this.fetchId
      const note = id ? await editNote(id) : await cutNote()
      if (this.stopped) return false
      ++this.fetchId
      this.unconfirmed = false
      this.emit({ note, text: note.content, conflict: null, transitioning: false })
      if (this.queued) { const queued = this.queued; this.queued = null; this.receive(queued) }
      return true
    } catch {
      this.emit({ transitioning: false, offline: !navigator.onLine, error: id ? 'Unable to edit block.' : 'Unable to cut draft.' })
      if (this.queued) { const queued = this.queued; this.queued = null; this.receive(queued) }
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
    const unsubscribe = watchNotes(userId, event => {
      if (event.type === 'READY') void pad.refresh()
      else if (event.type !== 'DELETE' && event.note.status === 'current') pad.receive(event.note)
    })
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
      unsubscribe()
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      window.removeEventListener('beforeunload', unload)
    }
  }, [userId])
  return { ...state, controller, dirty: controller?.dirty || false }
}
