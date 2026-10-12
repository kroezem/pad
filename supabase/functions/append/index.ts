import { createClient } from 'npm:@supabase/supabase-js@2'

const reply = (status: number, body: object) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
  }
  const key = request.headers.get('x-pad-key')
  if (!key || key.length > 256) return reply(401, { error: 'Unauthorized' })
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const { data: apiKey, error: keyError } = await client.from('api_keys')
      .select('id, user_id').eq('key_hash', hash).is('revoked_at', null).maybeSingle()
    if (keyError) return reply(500, { error: 'Unable to authenticate' })
    if (!apiKey) return reply(401, { error: 'Unauthorized' })

    const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    if (type !== 'application/json' && type !== 'text/plain') return reply(415, { error: 'Use JSON or text/plain' })
    // Bound the body while streaming; JSON escaping can use six bytes per character.
    const reader = request.body?.getReader()
    if (!reader) return reply(400, { error: 'Text is required' })
    const chunks: Uint8Array[] = []
    let bytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 650_000) {
        await reader.cancel()
        return reply(413, { error: 'Text is too long' })
      }
      chunks.push(value)
    }
    const body = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
    const raw = new TextDecoder().decode(body)
    let text: unknown = raw
    if (type === 'application/json') {
      try { text = JSON.parse(raw)?.text } catch { return reply(400, { error: 'Invalid JSON' }) }
    }
    if (typeof text !== 'string') return reply(400, { error: 'Text is required' })
    text = text.trimEnd()
    if (!text) return reply(400, { error: 'Text is required' })
    if (Array.from(text as string).length > 100_000) return reply(413, { error: 'Text is too long' })
    const { error } = await client.rpc('append_to_current', { p_user_id: apiKey.user_id, p_text: text })
    if (error) return reply(500, { error: 'Unable to append' })
    const { error: usageError } = await client.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKey.id)
    if (usageError) console.error('Unable to update API key usage timestamp')
    return reply(200, { ok: true })
  } catch {
    return reply(500, { error: 'Unable to append' })
  }
})
