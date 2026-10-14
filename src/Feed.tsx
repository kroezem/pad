import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { deleteNote, feedNotes, searchNotes, watchNotes, type Block, type Filter } from './data'
import { CopyButton } from './Panels'

const ordered = (items: Block[]) => {
  const unique = new Map<string, Block>()
  for (const item of items) {
    const previous = unique.get(item.id)
    if (!previous || item.sent_at >= previous.sent_at) unique.set(item.id, item)
  }
  return [...unique.values()].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id))
}
const dayKey = (value: string) => new Date(value).toLocaleDateString()
function dayLabel(value: string) {
  const day = new Date(value)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(value) === dayKey(today.toISOString())) return 'Today'
  if (dayKey(value) === dayKey(yesterday.toISOString())) return 'Yesterday'
  return day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}) })
}
function TextBlock({ block, edit, remove, disabled, editing }: { block: Block; edit: (block: Block) => void; remove: (id: string) => void; disabled: boolean; editing: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [actions, setActions] = useState(false)
  const [long, setLong] = useState(false)
  const text = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLElement>(null)
  const lines = block.content.split('\n')
  const code = block.content.includes('\t') || lines.filter(line => /^ {2,}\S/.test(line)).length >= 2 || (block.content.match(/[{};]/g)?.length || 0) >= 6
  const url = /^https?:\/\/\S+$/i.test(block.content.trim()) ? block.content.trim() : null
  useLayoutEffect(() => {
    const element = text.current
    if (!element) return
    const measure = () => setLong(element.scrollHeight > parseFloat(getComputedStyle(element).lineHeight) * 12 + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [block.content, code])
  return <article ref={card} className={`block${actions ? ' actions-open' : ''}${editing ? ' editing' : ''}`} data-note-id={block.id}>
    <div className="block-head"><time dateTime={block.sent_at}>{new Date(block.sent_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
      <div className="block-actions"><span className="secondary-actions"><button disabled={disabled} onClick={() => edit(block)}>Edit</button><button disabled={disabled} onClick={() => remove(block.id)}>Delete</button></span><CopyButton text={block.content} className="block-copy" /></div>
    </div>
    <div ref={text} className={`block-body${long && !expanded ? ' is-collapsed' : ''}`} onClick={() => { if (window.matchMedia('(hover: none)').matches) setActions(!actions) }}>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>{url}</a> : <pre className={code ? 'code' : ''}>{block.content}</pre>}
    </div>
    {long && <button className="show-more" onClick={() => {
      const element = card.current
      const feed = element?.closest('.feed')
      const visibleTop = feed ? feed.getBoundingClientRect().top + parseFloat(getComputedStyle(feed).paddingTop) : 0
      if (expanded && element && feed && element.getBoundingClientRect().top < visibleTop) feed.scrollTop += element.getBoundingClientRect().top - visibleTop
      setExpanded(!expanded)
    }}>{expanded ? 'Show less' : 'Show more'}</button>}
    <div className="touch-actions"><button disabled={disabled} onClick={() => edit(block)}>Edit</button><button disabled={disabled} onClick={() => remove(block.id)}>Delete</button></div>
  </article>
}

type Position = { mode: 'reset' | 'prepend' | 'update'; height: number; top: number; bottom: boolean; anchor?: string; offset?: number }
export function Feed({ userId, query, filter, sent, editingId, edit, disabled }: {
  userId: string; query: string; filter: Filter; sent: Block | null; editingId?: string; edit: (block: Block) => void; disabled: boolean
}) {
  const [items, setItems] = useState<Block[]>([])
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [newBlocks, setNewBlocks] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const moreRef = useRef(false)
  const loadingRef = useRef(false)
  const generation = useRef(0)
  const position = useRef<Position | null>(null)
  const initialized = useRef(false)
  const refreshRef = useRef<() => void>(() => {})
  const eventVersion = useRef(0)
  const searchMode = !!query.trim() || filter !== 'all'
  const capture = useCallback((mode: Position['mode'], arrival = false) => {
    const element = scroller.current
    if (!element) return
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100
    const top = element.getBoundingClientRect().top
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-note-id]')).find(block => block.getBoundingClientRect().bottom >= top)
    position.current = { mode, height: element.scrollHeight, top: element.scrollTop, bottom, anchor: anchor?.dataset.noteId, offset: anchor ? anchor.getBoundingClientRect().top - top : undefined }
    if (arrival && !bottom) setNewBlocks(true)
  }, [])
  useLayoutEffect(() => {
    const element = scroller.current
    const saved = position.current
    if (!element || !saved) return
    position.current = null
    if (saved.mode === 'reset' || (saved.mode === 'update' && saved.bottom)) {
      element.scrollTop = element.scrollHeight
      setNewBlocks(false)
    } else if (saved.mode === 'prepend') element.scrollTop = saved.top + element.scrollHeight - saved.height
    else {
      const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-note-id]')).find(block => block.dataset.noteId === saved.anchor)
      if (anchor && saved.offset !== undefined) element.scrollTop += anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset
      else element.scrollTop = saved.top
    }
  }, [items])

  useEffect(() => {
    const request = ++generation.current
    let active = true
    initialized.current = false
    setLoading(true); setError(''); setNewBlocks(false)
    loadingRef.current = true
    moreRef.current = false
    const fetchWindow = async (reset = false) => {
      const eventsAtStart = eventVersion.current
      const count = reset ? 50 : Math.max(50, itemsRef.current.length)
      try {
        let found: Block[] = []
        let before: string | null = null
        let hasMore = false
        do {
          const page: Block[] = searchMode ? await searchNotes(query.trim(), filter, found.length) : await feedNotes(before)
          found = [...found, ...page]
          hasMore = page.length >= 50
          before = page[page.length - 1]?.sent_at || null
        } while (found.length < count && hasMore)
        if (!active || request !== generation.current) return
        if (eventVersion.current !== eventsAtStart) return
        const previousIds = new Set(itemsRef.current.map(item => item.id))
        capture(reset ? 'reset' : 'update', !reset && found.some(item => !previousIds.has(item.id)))
        setItems(ordered(found)); setMore(hasMore); moreRef.current = hasMore
        setError(''); initialized.current = true
      } catch { if (active) setError('Unable to load messages. Your draft is still available.') }
      finally {
        if (active) { setLoading(false); loadingRef.current = false }
        if (active && eventVersion.current !== eventsAtStart) refreshRef.current()
      }
    }
    let refreshTimer: ReturnType<typeof setTimeout>
    refreshRef.current = () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => { void fetchWindow(!initialized.current) }, 250)
    }
    const timer = setTimeout(() => { void fetchWindow(true) }, searchMode ? 250 : 0)
    const unsubscribe = watchNotes(userId, event => {
      if (!active) return
      if (event.type === 'READY') { refreshRef.current(); return }
      ++eventVersion.current
      if (searchMode) { refreshRef.current(); return }
      if (event.type === 'DELETE') {
        capture('update')
        setItems(previous => previous.filter(item => item.id !== event.id))
      } else {
        capture('update', !itemsRef.current.some(item => item.id === event.note.id))
        setItems(previous => ordered([...previous.filter(item => item.id !== event.note.id), { ...event.note, attachments: previous.find(item => item.id === event.note.id)?.attachments }]))
      }
    })
    const refresh = () => refreshRef.current()
    const visibility = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false; clearTimeout(timer); clearTimeout(refreshTimer); unsubscribe()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [userId, query, filter, searchMode, capture])
  useEffect(() => {
    if (!sent) return
    ++eventVersion.current
    if (searchMode) { refreshRef.current(); return }
    capture('update', true)
    setItems(previous => ordered([...previous.filter(item => item.id !== sent.id), { ...sent, attachments: previous.find(item => item.id === sent.id)?.attachments }]))
  }, [sent, searchMode, capture])

  const loadOlder = async () => {
    if (loadingRef.current || !moreRef.current) return
    loadingRef.current = true; setLoading(true); setError('')
    const request = generation.current
    const eventsAtStart = eventVersion.current
    try {
      const page = searchMode ? await searchNotes(query.trim(), filter, itemsRef.current.length) : await feedNotes(itemsRef.current[0]?.sent_at)
      if (request !== generation.current) return
      if (eventVersion.current !== eventsAtStart) { refreshRef.current(); return }
      capture('prepend')
      setItems(previous => ordered([...page, ...previous]))
      setMore(page.length >= 50); moreRef.current = page.length >= 50
    } catch { if (request === generation.current) setError('Unable to load older messages.') }
    finally { if (request === generation.current) { setLoading(false); loadingRef.current = false } }
  }
  const remove = async (id: string) => {
    if (!window.confirm('Delete this message? This cannot be undone.')) return
    setDeleting(true); setError('')
    try {
      await deleteNote(id)
      ++eventVersion.current
      capture('update'); setItems(previous => previous.filter(item => item.id !== id))
      if (searchMode) refreshRef.current()
    } catch { setError('Unable to delete block.') }
    setDeleting(false)
  }
  return <>
    <div className="feed" ref={scroller} aria-label={searchMode ? 'Search results' : 'Messages'} onScroll={() => {
      const element = scroller.current
      if (!element) return
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 100) setNewBlocks(false)
      if (!searchMode && element.scrollTop < 160) void loadOlder()
    }}>
      <div className="feed-column">
        {more && <button className="load-more" disabled={loading} onClick={() => void loadOlder()}>Load older</button>}
        {loading && <p className="feed-message muted" role="status">Loading…</p>}
        {error && <p className="feed-message error" role="alert">{error} <button onClick={() => refreshRef.current()}>Retry</button></p>}
        {!loading && !items.length && !error && <p className="feed-message muted">{searchMode ? 'No matching messages.' : 'Write something below and send it.'}</p>}
        {items.map((block, index) => <div key={block.id}>
          {(!index || dayKey(items[index - 1].sent_at) !== dayKey(block.sent_at)) && <div className="day-divider">{dayLabel(block.sent_at)}</div>}
          <TextBlock block={block} edit={edit} remove={id => void remove(id)} disabled={disabled || deleting} editing={editingId === block.id} />
        </div>)}
      </div>
    </div>
    {newBlocks && <button className="new-pill" onClick={() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; setNewBlocks(false) }}>Latest ↓</button>}
  </>
}
