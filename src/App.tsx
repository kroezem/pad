import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { loginEmail, supabase } from './supabase'
import { usePad } from './usePad'
import { ApiKeys, History } from './Panels'

function Login() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <main className="login"><form onSubmit={async event => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail!, password })
      if (error) setError('Unable to sign in. Check your password and try again.')
    } catch { setError('Unable to sign in. Try again.') }
    setBusy(false)
  }}>
    <h1>pad</h1>
    <input className="username" type="text" name="username" autoComplete="username" value={loginEmail} readOnly tabIndex={-1} aria-hidden="true" />
    <label className="sr-only" htmlFor="password">Password</label>
    <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} required autoFocus />
    <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    {error && <p className="error" role="alert">{error}</p>}
  </form></main>
}

function Scratchpad({ session }: { session: Session }) {
  const pad = usePad(session.user.id)
  const [panel, setPanel] = useState<'history' | 'keys' | null>(null)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const selection = useRef({ start: 0, end: 0, direction: 'none' as 'forward' | 'backward' | 'none', scroll: 0 })
  const closePanel = useCallback(() => setPanel(null), [])
  const noteId = pad.note?.id
  useLayoutEffect(() => {
    const element = textarea.current
    if (element && document.activeElement === element) {
      const { start, end, direction, scroll } = selection.current
      element.setSelectionRange(Math.min(start, pad.text.length), Math.min(end, pad.text.length), direction)
      element.scrollTop = scroll
    }
  }, [pad.text])
  useEffect(() => {
    if (noteId && !pad.loading && window.matchMedia('(hover: hover) and (pointer: fine)').matches) textarea.current?.focus()
  }, [pad.loading, noteId])
  const signOut = async (global: boolean) => {
    setMenu(false)
    if (global && !window.confirm('Sign out on all devices?')) return
    await pad.controller?.save()
    if (pad.controller?.dirty && !window.confirm('This draft has not been saved. Sign out and keep the draft on this device?')) return
    setBusy(true); setAuthError('')
    const { error } = await supabase.auth.signOut({ scope: global ? 'global' : 'local' })
    if (error) setAuthError('Unable to sign out. Try again.')
    setBusy(false)
  }
  const status = pad.offline ? 'Offline' : pad.conflict ? 'Conflict' : pad.saving || pad.dirty ? 'Saving…' : pad.loading ? 'Loading…' : pad.error ? 'Unsaved' : 'Saved'
  return <main className="scratchpad">
    <header className="bar">
      <span className="save-status" role="status" aria-live="polite">{status}</span>
      <nav aria-label="Pad actions">
        <button disabled={busy || pad.loading || !pad.note || !!pad.conflict || pad.offline} onClick={async () => { setBusy(true); await pad.controller?.newNote(); setBusy(false) }}>New</button>
        <button onClick={() => setPanel('history')}>History</button>
        <div className="menu-wrap">
          <button aria-expanded={menu} aria-controls="pad-menu" aria-label="Open menu" onClick={() => setMenu(!menu)}>•••</button>
          {menu && <><button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenu(false)} tabIndex={-1} /><div className="menu" id="pad-menu" onKeyDown={event => { if (event.key === 'Escape') setMenu(false) }}>
            <button onClick={() => { setMenu(false); setPanel('keys') }}>API key</button>
            <button disabled={busy} onClick={() => void signOut(false)}>Sign out</button>
            <button disabled={busy} onClick={() => void signOut(true)}>Sign out everywhere</button>
          </div></>}
        </div>
      </nav>
    </header>
    {pad.conflict && <div className="banner" role="status"><span>Changed on another device</span><div><button onClick={pad.controller?.useTheirs}>Use theirs</button><button onClick={pad.controller?.keepMine}>Keep mine</button></div></div>}
    {(pad.error || authError) && <div className="banner error" role="alert"><span>{pad.error || authError}</span><button onClick={() => { setAuthError(''); void pad.controller?.refresh() }}>Retry</button></div>}
    <textarea ref={textarea} aria-label="Current note" value={pad.text} disabled={!pad.note || pad.loading} spellCheck={false} onChange={event => {
      selection.current = { start: event.target.selectionStart, end: event.target.selectionEnd, direction: event.target.selectionDirection, scroll: event.target.scrollTop }
      pad.controller?.edit(event.target.value)
    }} onSelect={event => {
      const element = event.currentTarget
      selection.current = { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop }
    }} onScroll={event => { selection.current.scroll = event.currentTarget.scrollTop }} onBlur={() => { void pad.controller?.save() }} />
    {panel === 'history' && <History close={closePanel} />}
    {panel === 'keys' && <ApiKeys close={closePanel} />}
  </main>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    let authEvent = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) { authEvent = true; setSession(next); setLoading(false) }
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && !authEvent) { setSession(data.session); setError(!!error); setLoading(false) }
    }).catch(() => { if (active) { setError(true); setLoading(false) } })
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  if (loading) return <main className="login"><p className="muted">Loading…</p></main>
  if (error) return <main className="login"><p className="error">Unable to load your session. <button onClick={() => window.location.reload()}>Retry</button></p></main>
  return session ? <Scratchpad key={session.user.id} session={session} /> : <Login />
}
