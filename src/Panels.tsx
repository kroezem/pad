import { useEffect, useRef, useState } from 'react'
import { appendUrl, supabase, type Note } from './supabase'

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState('Copy')
  return <button onClick={async () => {
    try { await navigator.clipboard.writeText(text); setStatus('Copied') }
    catch { setStatus('Unable to copy — select text') }
  }}>{status}</button>
}

function Panel({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = ref.current
    panel?.querySelector<HTMLElement>('button, input')?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key !== 'Tab' || !panel) return
      const elements = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]'))
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [close])
  return <section className="overlay" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
    <header className="bar"><h2>{title}</h2><button onClick={close}>Close</button></header>
    <div className="panel-body">{children}</div>
  </section>
}

type SearchResult = { id: string; created_at: string; archived_at: string; snippet: string; rank: number }
export function History({ close }: { close: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const openRequest = useRef(0)
  useEffect(() => {
    const request = ++generation.current
    setLoading(true)
    setError('')
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('search_notes', { p_query: query, p_limit: 50, p_offset: 0 })
      if (request !== generation.current) return
      if (error) { setError('Unable to search history.'); setResults([]); setMore(false) }
      else { setResults(data || []); setMore(data?.length === 50) }
      setLoading(false)
    }, 250)
    return () => { clearTimeout(timer); generation.current = request + 1 }
  }, [query])
  const loadMore = async () => {
    const request = generation.current
    setLoading(true)
    setError('')
    const { data, error } = await supabase.rpc('search_notes', { p_query: query, p_limit: 50, p_offset: results.length })
    if (request !== generation.current) return
    if (error) setError('Unable to load more notes.')
    else { setResults(previous => [...previous, ...(data || [])]); setMore(data?.length === 50) }
    setLoading(false)
  }
  return <Panel title="History" close={close}>
    {note ? <>
      <div className="detail-bar"><button onClick={() => setNote(null)}>← Back</button><CopyButton text={note.content} /></div>
      <p className="muted">{date(note.created_at)} → {date(note.archived_at!)}</p>
      <pre className="note-detail" tabIndex={0}>{note.content}</pre>
    </> : <>
      <label className="sr-only" htmlFor="search">Search archived notes</label>
      <input id="search" type="search" placeholder="Search history" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />
      {error && <p role="alert" className="error">{error}</p>}
      <div className="history-list" aria-busy={loading}>
        {results.map(item => <button className="history-item" key={item.id} onClick={async () => {
          const request = ++openRequest.current
          const { data, error } = await supabase.from('notes').select('*').eq('id', item.id).eq('status', 'archived').single()
          if (request !== openRequest.current) return
          if (error) setError('Unable to open note.')
          else { setError(''); setNote(data as Note) }
        }}><span className="muted">{date(item.created_at)} → {date(item.archived_at)}</span><span className="snippet">{item.snippet}</span></button>)}
      </div>
      {loading && <p className="muted" role="status">Loading…</p>}
      {!loading && !results.length && !error && <p className="muted">{query ? 'No matching notes.' : 'No archived notes yet.'}</p>}
      {more && <button disabled={loading} onClick={() => void loadMore()}>Load more</button>}
    </>}
  </Panel>
}

type ApiKey = { id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
export function ApiKeys({ close }: { close: () => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [label, setLabel] = useState('iOS Shortcut')
  const [rawKey, setRawKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const refresh = async () => {
    const { data, error } = await supabase.from('api_keys').select('id, label, created_at, last_used_at, revoked_at').order('created_at', { ascending: false })
    if (error) setError('Unable to load API keys.')
    else setKeys(data || [])
    setLoading(false)
  }
  useEffect(() => { void refresh() }, [])
  const generate = async () => {
    setBusy(true); setError(''); setRawKey('')
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const raw = 'pad_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const { error } = await supabase.from('api_keys').insert({ label: label.trim() || 'Untitled key', key_hash: hash })
      if (error) throw error
      setRawKey(raw)
      await refresh()
    } catch { setError('Unable to generate a key.') }
    setBusy(false)
  }
  return <Panel title="API keys" close={close}>
    <p className="muted">Append text from your share sheet or any HTTP client.</p>
    <h3>Append endpoint</h3>
    <div className="copy-row"><code>{appendUrl}</code><CopyButton text={appendUrl} /></div>
    <form className="key-form" onSubmit={event => { event.preventDefault(); void generate() }}>
      <label htmlFor="key-label">Key label</label>
      <input id="key-label" value={label} onChange={event => setLabel(event.target.value)} maxLength={100} />
      <button disabled={busy}>{busy ? 'Generating…' : 'Generate new key'}</button>
    </form>
    {rawKey && <div className="key-reveal"><p>Copy this key now. It won’t be shown again.</p><div className="copy-row"><code>{rawKey}</code><CopyButton text={rawKey} /></div></div>}
    {error && <p role="alert" className="error">{error}</p>}
    <h3>Existing keys</h3>
    {loading && <p className="muted">Loading…</p>}
    {!loading && !keys.length && <p className="muted">No keys yet.</p>}
    {keys.map(key => <div className="key-item" key={key.id}>
      <div><strong>{key.label}</strong><p className="muted">Created {date(key.created_at)}<br />Last used {key.last_used_at ? date(key.last_used_at) : 'never'}</p></div>
      {key.revoked_at ? <span className="muted">Revoked</span> : <button disabled={busy} onClick={async () => {
        setBusy(true); setError('')
        const { error } = await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', key.id)
        if (error) setError('Unable to revoke key.')
        else await refresh()
        setBusy(false)
      }}>Revoke</button>}
    </div>)}
  </Panel>
}
