import { useEffect, useRef, useState } from 'react'
import { readChatStream } from '../lib/chat-stream'
import '../styles/chat.css'

type Card = { id: string; modalities?: { vision?: boolean }; supported_endpoints?: string[] }
type Message = { id: string; role: 'user' | 'assistant'; text: string; image?: string }

export function Chat({ apiBase }: { apiBase: string }) {
  const [models, setModels] = useState<Card[]>([])
  const [model, setModel] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [image, setImage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('正在连接模型…')
  const abort = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const vision = models.find(item => item.id === model)?.modalities?.vision === true

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`${apiBase}/v1/models`, { signal: controller.signal, headers: { 'X-Pinggy-No-Screen': '1' } }).then(async response => {
      if (!response.ok) throw new Error(`模型列表请求失败：HTTP ${response.status}`)
      const payload = await response.json()
      const cards: Card[] = (payload.data ?? []).filter((item: Card) =>
        !item.supported_endpoints || item.supported_endpoints.includes('/v1/chat/completions'))
      if (!cards.length) throw new Error('服务没有返回聊天模型')
      setModels(cards); setModel(cards[0].id); setStatus('已连接，可以开始对话')
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause.message ?? cause)) })
    return () => controller.abort()
  }, [apiBase])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])
  useEffect(() => () => abort.current?.abort(), [])

  async function upload(file?: File) {
    if (!file) return
    setError('')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('请选择 PNG、JPEG 或 WebP 图片'); return
    }
    if (file.size > 10 * 1024 * 1024) { setError('请选择小于 10 MB 的图片'); return }
    setUploading(true)
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('图片读取失败'))
        reader.readAsDataURL(file)
      })
      setImage(data)
    } catch (cause) { setError(String(cause)) }
    finally { setUploading(false) }
  }

  async function send() {
    if (busy || uploading || !model || (!text.trim() && !image)) return
    const user: Message = { id: crypto.randomUUID(), role: 'user', text: text.trim() || '请描述这张图片。', image }
    const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', text: '' }
    const history = [...messages.filter(item => item.text || item.image), user]
    setMessages([...history, assistant]); setText(''); setImage(undefined)
    setBusy(true); setError(''); setStatus('正在生成…')
    const controller = new AbortController(); abort.current = controller
    let answer = ''
    let finished = false
    let timing: any
    try {
      const response = await fetch(`${apiBase}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pinggy-No-Screen': '1' }, signal: controller.signal,
        body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true },
          enable_thinking: false, max_tokens: 2048,
          messages: history.map(item => ({ role: item.role, content: item.image ? [
            { type: 'image_url', image_url: { url: item.image } },
            { type: 'text', text: item.text },
          ] : item.text })),
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error?.message ?? `请求失败：HTTP ${response.status}`)
      }
      if (!response.body) throw new Error('浏览器未收到输出流')
      await readChatStream(response.body, chunk => {
        const choice = chunk.choices?.[0]
        if (choice?.delta?.content) {
          answer += choice.delta.content
          setMessages(current => current.map(item => item.id === assistant.id ? { ...item, text: answer } : item))
        }
        if (choice?.finish_reason) {
          finished = true
          if (choice.finish_reason === 'length') setError('回答已达到输出长度限制，可以继续追问。')
        }
        if (chunk.timings) timing = chunk.timings
      })
      if (!finished) throw new Error('连接提前结束，回答可能不完整')
      setStatus(timing ? `完成 · 首 Token ${Math.round(timing.ttft_ms)} ms · ${Number(timing.predicted_per_second).toFixed(1)} tokens/s` : '回答完成')
    } catch (cause) {
      if (controller.signal.aborted) setStatus('已停止生成')
      else { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('生成失败') }
    } finally {
      abort.current = null; setBusy(false)
      if (!answer) setMessages(current => current.filter(item => item.id !== assistant.id))
    }
  }

  return <main className="chat-page">
    <header className="chat-heading">
      <div><h1>和模型聊一聊</h1><p>中文对话、代码和图片理解</p></div>
      <div className="chat-controls">
        <select aria-label="选择聊天模型" value={model} disabled={busy || messages.length > 0} onChange={event => setModel(event.target.value)}>
          {models.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
        </select>
        <button className="button" disabled={busy || uploading} onClick={() => { setMessages([]); setImage(undefined); setError(''); setStatus('新对话') }}>新对话</button>
      </div>
    </header>
    <section className="chat-history" aria-label="对话记录" aria-live="polite">
      {!messages.length && <div className="chat-empty"><h2>你好，有什么想聊的？</h2><p>输入问题，或上传一张图片。</p>
        <div className="chat-suggestions">{['用中文介绍一下你自己', '写一个 Python 快速排序函数', '解释什么是大语言模型'].map(prompt =>
          <button key={prompt} onClick={() => setText(prompt)}>{prompt}</button>)}</div>
      </div>}
      {messages.map(item => <article key={item.id} className={`chat-message chat-message--${item.role}`}>
        <span className="chat-role">{item.role === 'user' ? '你' : 'Qwen'}</span>
        {item.image && <img className="chat-image" src={item.image} alt="发送给模型的图片" />}
        <div className="chat-text">{item.text || '正在思考…'}</div>
        {item.role === 'assistant' && item.text && <button className="chat-copy" onClick={() => {
          void navigator.clipboard.writeText(item.text).then(() => setStatus('回答已复制')).catch(() => setError('复制失败，请手动选择文本复制'))
        }}>复制回答</button>}
      </article>)}
      <div ref={bottom} />
    </section>
    <footer className="chat-composer">
      {error && <p role="alert" className="chat-error">{error}</p>}
      {image && <div className="chat-attachment"><img src={image} alt="待发送的图片" /><button className="button" disabled={busy} onClick={() => setImage(undefined)}>移除图片</button></div>}
      <textarea aria-label="输入消息" placeholder="输入消息… Enter 发送，Shift+Enter 换行" value={text} disabled={busy} rows={3}
        onChange={event => setText(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
        }} />
      <div className="chat-composer-actions">
        <div><input ref={picker} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = '' }} />
          <button className="button" disabled={!vision || busy || uploading} onClick={() => picker.current?.click()}>{uploading ? '读取中…' : '上传图片'}</button>
          <span className="chat-hint">{vision ? '支持图片 · 最大 10 MB' : '当前模型未启用图片输入'}</span></div>
        {busy ? <button className="button chat-stop" onClick={() => abort.current?.abort()}>停止生成</button> :
          <button className="button chat-send" disabled={!model || uploading || (!text.trim() && !image)} onClick={() => void send()}>发送消息 ↗</button>}
      </div>
      <p className="chat-status" role="status">{status}</p>
    </footer>
  </main>
}
