import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getSession, loginEmail, signIn, signOut, watchAuth, type Filter, type Session } from './data'
import { usePad } from './usePad'
import { ApiKeys } from './Panels'
import { Feed } from './Feed'
import { Background, type BackgroundPattern } from './Background'

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

function Composer({ pad, cut, blocked }: { pad: ReturnType<typeof usePad>; cut: () => void; blocked: boolean }) {
  const wrapper = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const selection = useRef({ start: 0, end: 0, direction: 'none' as 'forward' | 'backward' | 'none', scroll: 0 })
  const noteId = pad.note?.id
  const resize = useCallback(() => {
    const element = textarea.current
    if (!element) return
    const scroll = element.scrollTop
    element.style.height = '0px'
    const max = parseFloat(getComputedStyle(element).maxHeight)
    element.style.height = `${Math.min(element.scrollHeight, max || element.scrollHeight)}px`
    element.scrollTop = scroll
  }, [])
  useLayoutEffect(() => {
    resize()
    const element = textarea.current
    if (element && document.activeElement === element) {
      const { start, end, direction, scroll } = selection.current
      element.setSelectionRange(Math.min(start, pad.text.length), Math.min(end, pad.text.length), direction)
      element.scrollTop = scroll
    }
  }, [pad.text, resize])
  useLayoutEffect(() => {
    const element = wrapper.current
    if (!element) return
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--composer-height', `${element.getBoundingClientRect().height}px`))
    observer.observe(element)
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('scroll', resize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('scroll', resize)
    }
  }, [resize])
  useEffect(() => {
    if (noteId && !pad.loading && window.matchMedia('(hover: hover) and (pointer: fine)').matches) textarea.current?.focus({ preventScroll: true })
  }, [noteId, pad.loading])
  const status = pad.offline ? 'Offline' : pad.conflict ? 'Conflict' : pad.error ? 'Unsaved' : pad.saving || pad.dirty ? 'Saving…' : pad.loading ? 'Loading…' : 'Saved'
  return <footer className="composer"><div className="composer-content" ref={wrapper}>
    {pad.conflict && <div className="conflict-banner" role="status"><span>Changed on another device</span><div><button onClick={pad.controller?.useTheirs}>Use theirs</button><button onClick={pad.controller?.keepMine}>Keep mine</button></div></div>}
    {pad.error && <div className="composer-error error" role="alert">{pad.error} <button onClick={() => void pad.controller?.refresh()}>Retry</button></div>}
    <div className="composer-row">
      <textarea ref={textarea} aria-label="Live draft" rows={1} placeholder="Write something…" value={pad.text} disabled={!pad.note || pad.loading || pad.transitioning || blocked} spellCheck={false} onChange={event => {
        selection.current = { start: event.target.selectionStart, end: event.target.selectionEnd, direction: event.target.selectionDirection, scroll: event.target.scrollTop }
        pad.controller?.edit(event.target.value)
      }} onSelect={event => {
        const element = event.currentTarget
        selection.current = { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, scroll: element.scrollTop }
      }} onScroll={event => { selection.current.scroll = event.currentTarget.scrollTop }} onBlur={() => { void pad.controller?.save() }} onKeyDown={event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); cut() }
      }} />
      <button className="cut" disabled={blocked || pad.loading || pad.transitioning || !pad.note || !!pad.conflict || pad.offline || !pad.text.trim()} onClick={cut}>Cut</button>
    </div>
    <div className="composer-meta"><span role="status" aria-live="polite">{status}</span><span className="cut-hint">Ctrl / ⌘ + Enter to cut</span></div>
  </div></footer>
}

function Scratchpad({ session }: { session: Session }) {
  const pad = usePad(session.user.id)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [background, setBackground] = useState<BackgroundPattern>(() => {
    try { return localStorage.getItem('pad:background') === 'topo' ? 'topo' : 'dots' }
    catch { return 'dots' }
  })
  const changeBackground = (pattern: BackgroundPattern) => {
    setBackground(pattern)
    try { localStorage.setItem('pad:background', pattern) } catch { /* Keep the selection for this session. */ }
  }
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [revision, setRevision] = useState(0)
  const search = useRef<HTMLInputElement>(null)
  const closeKeys = useCallback(() => setKeysOpen(false), [])
  const transition = async (id?: string) => {
    if (busy || keysOpen) return
    if (await pad.controller?.transition(id)) setRevision(value => value + 1)
  }
  const logout = async (global: boolean) => {
    setMenu(false)
    if (global && !window.confirm('Sign out on all devices?')) return
    await pad.controller?.save()
    if (pad.controller?.dirty && !window.confirm('This draft has not been saved. Sign out and keep the draft on this device?')) return
    setBusy(true); setAuthError('')
    try { await signOut(global) }
    catch { setAuthError('Unable to sign out. Try again.') }
    setBusy(false)
  }
  return <><Background pattern={background} /><main className="app-shell">
    <header className={`top-bar${searchOpen || query ? ' search-open' : ''}`}>
      <div className="top-column">
        <button className="search-toggle" aria-label="Search blocks" aria-expanded={searchOpen || !!query} onClick={() => { setSearchOpen(true); requestAnimationFrame(() => search.current?.focus({ preventScroll: true })) }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></svg></button>
        <div className="search-field"><label className="sr-only" htmlFor="search">Search blocks</label><input ref={search} id="search" type="search" placeholder="Search pad" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />
          <button className="search-close" aria-label="Close search" onClick={() => { setQuery(''); setSearchOpen(false); search.current?.blur() }}>×</button>
        </div>
        <div className="filters" aria-label="Filter blocks">{(['all', 'text', 'links'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
        <div className="menu-wrap"><button aria-expanded={menu} aria-controls="pad-menu" aria-label="Open menu" onClick={() => setMenu(!menu)}>•••</button>
          {menu && <><button className="menu-dismiss" aria-label="Close menu" onClick={() => setMenu(false)} tabIndex={-1} /><div className="menu" id="pad-menu" onKeyDown={event => { if (event.key === 'Escape') setMenu(false) }}>
            <div className="background-options" role="group" aria-label="Background">
              <span>Background</span>
              <div>{(['dots', 'topo'] as const).map(pattern => <button key={pattern} aria-pressed={background === pattern} onClick={() => changeBackground(pattern)}>{pattern === 'dots' ? 'Dots' : 'Topo'}</button>)}</div>
            </div>
            <button onClick={() => { setMenu(false); setKeysOpen(true) }}>API key</button>
            <button disabled={busy || pad.transitioning} onClick={() => void logout(false)}>Sign out</button>
            <button disabled={busy || pad.transitioning} onClick={() => void logout(true)}>Sign out everywhere</button>
          </div></>}
        </div>
      </div>
    </header>
    {authError && <div className="auth-error error" role="alert">{authError}</div>}
    <Feed userId={session.user.id} query={query} filter={filter} revision={revision} edit={id => void transition(id)} disabled={busy || pad.transitioning || pad.loading || !!pad.conflict || pad.offline} />
    <Composer pad={pad} cut={() => void transition()} blocked={busy || keysOpen} />
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
