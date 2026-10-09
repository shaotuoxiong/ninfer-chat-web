/** Decode SSE without assuming network chunk boundaries match UTF-8 characters or events. */
export async function readChatStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: any) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  function consume(final = false) {
    let match: RegExpExecArray | null
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const event = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      emit(event)
    }
    if (final && buffer.trim()) { emit(buffer); buffer = '' }
  }
  function emit(event: string) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') return
    const chunk = JSON.parse(data)
    if (chunk.error) throw new Error(chunk.error.message ?? '服务返回错误')
    onChunk(chunk)
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      consume(done)
      if (done) break
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
