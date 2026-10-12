import { useEffect, useRef, useState } from 'react'
import { appendUrl, generateKey, listKeys, revokeKey, type ApiKey } from './data'

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [status, setStatus] = useState('Copy')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  return <button className={className} onClick={async () => {
    clearTimeout(timer.current)
    try { await navigator.clipboard.writeText(text); setStatus('Copied') }
    catch { setStatus('Copy failed') }
    timer.current = setTimeout(() => setStatus('Copy'), 1500)
  }} aria-label={status === 'Copy' ? 'Copy full text' : status}>{status}</button>
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

export function ApiKeys({ close }: { close: () => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [label, setLabel] = useState('iOS Shortcut')
  const [rawKey, setRawKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const refresh = async () => {
    try { setKeys(await listKeys()) }
    catch { setError('Unable to load API keys.') }
    setLoading(false)
  }
  useEffect(() => { void refresh() }, [])
  const generate = async () => {
    setBusy(true); setError(''); setRawKey('')
    try { setRawKey(await generateKey(label)); await refresh() }
    catch { setError('Unable to generate a key.') }
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
        try { await revokeKey(key.id); await refresh() }
        catch { setError('Unable to revoke key.') }
        setBusy(false)
      }}>Revoke</button>}
    </div>)}
  </Panel>
}
