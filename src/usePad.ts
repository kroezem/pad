import { useRef, useState } from 'react'
import { sendNote, updateNote, type Block, type Note } from './data'

export function usePad(userId: string) {
  const storageKey = `pad:draft:${userId}`
  const [text, setText] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (!saved) return ''
      try { const old = JSON.parse(saved); return typeof old?.text === 'string' ? old.text : saved } catch { return saved }
    } catch { return '' }
  })
  const [editing, setEditing] = useState<Block | null>(null)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [sent, setSent] = useState<Note | null>(null)
  const pending = useRef(false)
  const change = (value: string) => {
    setText(value); setFailed(false)
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify({ text: value }))
      else localStorage.removeItem(storageKey)
    } catch { /* Local storage is optional. */ }
  }
  const send = async () => {
    if (pending.current || !text.trim()) return false
    pending.current = true; setSending(true); setFailed(false)
    try {
      const note = editing ? await updateNote(editing.id, text) : await sendNote(text)
      setSent(note); change(''); setEditing(null)
      return true
    } catch { setFailed(true); return false }
    finally { pending.current = false; setSending(false) }
  }
  return { text, editing, sending, failed, sent, change, send,
    edit: (block: Block) => { setEditing(block); change(block.content) },
    cancel: () => { setEditing(null); change('') },
  }
}
