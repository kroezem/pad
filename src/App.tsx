import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getSession, loginEmail, signIn, signOut, watchAuth, type Block, type Filter, type Session } from './data'
import { usePad } from './usePad'
import { ApiKeys } from './Panels'
import { Feed } from './Feed'
import { Background } from './Background'

function useViewport() {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    const update = () => {
      const top = viewport?.offsetTop || 0
      const overlap = viewport ? Math.max(0, window.innerHeight - viewport.height - top) : 0
      root.style.setProperty('--keyboard-offset', `${overlap}px`)
      root.style.setProperty('--viewport-top', `${top}px`)
      root.style.setProperty('--bottom-safe', overlap > 100 ? '0px' : 'env(safe-area-inset-bottom, 0px)')
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
}

function Login() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <main className="login"><form onSubmit={async event => {
    event.preventDefault()
    setBusy(true); setError('')
    try { await signIn(password) }
    catch { setError('Unable to sign in. Check your password and try again.') }
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

function Composer({ pad, blocked }: { pad: ReturnType<typeof usePad>; blocked: boolean }) {
  const wrapper = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const resize = useCallback(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = '0px'
    const style = getComputedStyle(element)
    element.style.height = `${Math.min(Math.max(element.scrollHeight, parseFloat(style.minHeight)), parseFloat(style.maxHeight))}px`
  }, [])
  useLayoutEffect(() => { resize() }, [pad.text, resize])
  useLayoutEffect(() => {
    const element = wrapper.current
    if (!element) return
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--composer-height', `${element.getBoundingClientRect().height}px`))
    observer.observe(element)
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize) }
  }, [resize])
  useEffect(() => { if (pad.editing) textarea.current?.focus({ preventScroll: true }) }, [pad.editing])
  return <footer className="composer" ref={wrapper}>
    <textarea ref={textarea} aria-label={pad.editing ? 'Edit message' : 'Message'} rows={1} placeholder="Write something…" value={pad.text} disabled={pad.sending || blocked} spellCheck={false} onChange={event => pad.change(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !blocked) { event.preventDefault(); void pad.send() }
    }} />
    <div className="composer-meta"><span role="status" aria-live="polite">{pad.sending ? 'Sending…' : pad.failed ? <>Failed · <button disabled={blocked} onClick={() => void pad.send()}>Retry</button></> : pad.editing ? <>Editing message · <button disabled={blocked} onClick={pad.cancel}>Cancel</button></> : ''}{pad.editing && pad.failed && <> · <button disabled={blocked} onClick={pad.cancel}>Cancel</button></>}</span><div><span className="send-hint">⌘/Ctrl + Enter</span><button className="send" disabled={blocked || pad.sending || !pad.text.trim()} onClick={() => void pad.send()}>Send</button></div></div>
  </footer>
}

function Scratchpad({ session }: { session: Session }) {
  const pad = usePad(session.user.id)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [editTarget, setEditTarget] = useState<Block | null>(null)
  const top = useRef<HTMLElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!editTarget) return
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current
    element?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pad.sending) setEditTarget(null)
      if (event.key !== 'Tab' || !element) return
      const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      if (!buttons.length) { event.preventDefault(); return }
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus({ preventScroll: true }) }
  }, [editTarget, pad.sending])
  const closeKeys = useCallback(() => setKeysOpen(false), [])
  useLayoutEffect(() => {
    const element = top.current
    if (!element) return
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--top-height', `${element.getBoundingClientRect().height}px`))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const edit = (block: Block) => { if (pad.text.trim()) setEditTarget(block); else pad.edit(block) }
  const logout = async (global: boolean) => {
    setMenu(false)
    if (global && !window.confirm('Sign out on all devices?')) return
    setBusy(true); setAuthError('')
    try { await signOut(global) } catch { setAuthError('Unable to sign out. Try again.') }
    setBusy(false)
  }
  const options = (['all', 'text', 'links'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setFiltersOpen(false) }}>{value[0].toUpperCase() + value.slice(1)}</button>)
  return <><Background /><main className="app-shell">
    <header className="top-bar" ref={top}>
      <div className="search-field"><label className="sr-only" htmlFor="search">Search messages</label><input id="search" type="search" placeholder="Search pad" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" /></div>
      <div className="filter-section"><div className="filters" aria-label="Filter messages">{options}</div><button className="filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>{filter[0].toUpperCase() + filter.slice(1)}</button>{filtersOpen && <><button className="menu-dismiss" aria-label="Close filters" onClick={() => setFiltersOpen(false)} /><div className="filter-popover">{options}</div></>}</div>
      <div className="menu-wrap"><button aria-expanded={menu} aria-controls="pad-menu" aria-label="Open menu" onClick={() => setMenu(!menu)}>•••</button>
        {menu && <><button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenu(false)} tabIndex={-1} /><div className="menu" id="pad-menu" onKeyDown={event => { if (event.key === 'Escape') setMenu(false) }}>
          <button onClick={() => { setMenu(false); setKeysOpen(true) }}>API key</button>
          <button disabled={busy || pad.sending} onClick={() => void logout(false)}>Sign out</button>
          <button disabled={busy || pad.sending} onClick={() => void logout(true)}>Sign out everywhere</button>
        </div></>}
      </div>
    </header>
    {authError && <div className="auth-error error" role="alert">{authError}</div>}
    <Feed userId={session.user.id} query={query} filter={filter} sent={pad.sent} editingId={pad.editing?.id} edit={edit} disabled={busy || pad.sending || !!editTarget} />
    <Composer pad={pad} blocked={busy || keysOpen || !!editTarget} />
    {editTarget && <div className="dialog-backdrop"><div ref={dialog} className="draft-dialog" role="dialog" aria-modal="true" aria-label="Draft already in composer"><p>You have text in the composer.</p><button disabled={pad.sending} onClick={async () => { if (await pad.send()) { pad.edit(editTarget); setEditTarget(null) } }}>Send draft first</button><button disabled={pad.sending} onClick={() => { pad.edit(editTarget); setEditTarget(null) }}>Discard draft</button><button disabled={pad.sending} onClick={() => setEditTarget(null)}>Cancel</button>{pad.failed && <p className="error" role="alert">Failed · Try sending again.</p>}</div></div>}
    {keysOpen && <ApiKeys close={closeKeys} />}
  </main></>
}

export default function App() {
  useViewport()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    let authEvent = false
    const unsubscribe = watchAuth(next => {
      if (active) { authEvent = true; setSession(next); setLoading(false); setError(false) }
    })
    void getSession().then(session => {
      if (active && !authEvent) { setSession(session); setLoading(false) }
    }).catch(() => { if (active) { setError(true); setLoading(false) } })
    return () => { active = false; unsubscribe() }
  }, [])
  if (loading) return <main className="login"><p className="muted">Loading…</p></main>
  if (error) return <main className="login"><p className="error">Unable to load your session. <button onClick={() => window.location.reload()}>Retry</button></p></main>
  return session ? <Scratchpad key={session.user.id} session={session} /> : <Login />
}
