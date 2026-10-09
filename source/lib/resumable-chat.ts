import { readChatStream } from './chat-stream'

export async function resumableChat(url: string, payload: any, headers: Record<string, string>, signal: AbortSignal,
  onChunk: (chunk: any) => void, onReconnect: (attempt: number) => void) {
  let after = 0
  let finished = false
  for (let attempt = 0; attempt <= 20; attempt++) {
    let serverError = false
    try {
      const response = await fetch(url, { method: 'POST', headers, signal, body: JSON.stringify({ ...payload, after }) })
      if (!response.ok) {
        if ([400, 404, 409, 429].includes(response.status)) serverError = true
        throw new Error(`请求失败：HTTP ${response.status}`)
      }
      if (!response.body) throw new Error('未收到输出流')
      await readChatStream(response.body, chunk => {
        // Skip already applied events after a reconnect.
        const seq = chunk.resume?.seq
        if (typeof seq === 'number' && seq <= after) return
        onChunk(chunk)
        if (typeof seq === 'number') after = seq
        if (chunk.choices?.some((choice: any) => choice.finish_reason)) finished = true
      })
      if (finished) return
      throw new Error('流式连接中断')
    } catch (error) {
      if (signal.aborted || serverError || (error as any)?.serverError) throw error
      // A finish chunk proves completion even if the final transport close failed.
      if (finished) return
      if (attempt === 20) throw new Error('重连暂未成功，回答已在后台保存；刷新页面可继续恢复。')
      onReconnect(attempt + 1)
      await new Promise<void>((resolve, reject) => {
        const done = () => { signal.removeEventListener('abort', stop); resolve() }
        const timer = setTimeout(done, Math.min(1000 * (attempt + 1), 5000))
        const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(new DOMException('Aborted', 'AbortError')) }
        signal.addEventListener('abort', stop, { once: true })
      })
    }
  }
}
