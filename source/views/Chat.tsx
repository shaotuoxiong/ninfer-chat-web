import { useEffect, useRef, useState } from 'react'
import { resumableChat } from '../lib/resumable-chat'
import '../styles/chat.css'
import { useChatHistory } from '../lib/use-chat-history'
import { HistorySidebar } from '../components/HistorySidebar'
import { ChatIcon } from '../components/ChatIcon'
import { MessageText } from '../components/MessageText'
import { CHAT_SYSTEM_PROMPT } from '../lib/chat-prompt'
import { useChatTheme } from '../lib/use-chat-theme'
import { savePendingGeneration, loadPendingGeneration, clearPendingGeneration, saveConversation, type PendingGeneration, type Message } from '../lib/chat-history'

function apiHeaders(apiBase: string): Record<string, string> {
  const hostname = new URL(apiBase).hostname
  if (hostname.includes('.ngrok')) return { 'ngrok-skip-browser-warning': '1' }
  if (hostname.includes('pinggy')) return { 'X-Pinggy-No-Screen': '1' }
  return {}
}

type Card = { id: string; modalities?: { vision?: boolean }; supported_endpoints?: string[] }

export function Chat({ apiBase = window.location.origin }: { apiBase?: string } = {}) {
  const { theme, toggleTheme } = useChatTheme()
  const researchBase = ['127.0.0.1', 'localhost'].includes(new URL(apiBase).hostname) && new URL(apiBase).port === '8080' ? `${new URL(apiBase).protocol}//${new URL(apiBase).hostname}:8081` : apiBase
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 841px)').matches)
  const followOutput = useRef(true)
  const [models, setModels] = useState<Card[]>([])
  const [text, setText] = useState('')
  const [image, setImage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const history = useChatHistory(busy)
  const { messages, model, setMessages, setModel } = history
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('正在连接模型…')
  const abort = useRef<AbortController | null>(null)
  const stopped = useRef(false)
  const currentJob = useRef<PendingGeneration | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const vision = models.find(item => item.id === model)?.modalities?.vision === true

  useEffect(() => {
    if (!history.ready) return
    const controller = new AbortController()
    void fetch(`${apiBase}/v1/models`, { signal: controller.signal, headers: apiHeaders(apiBase) }).then(async response => {
      if (!response.ok) throw new Error(`模型列表请求失败：HTTP ${response.status}`)
      const payload = await response.json()
      const cards: Card[] = (payload.data ?? []).filter((item: Card) =>
        !item.supported_endpoints || item.supported_endpoints.includes('/v1/chat/completions'))
      if (!cards.length) throw new Error('服务没有返回聊天模型')
      setModels(cards); setModel(current => cards.some(card => card.id === current) ? current : cards[0].id); setStatus('已连接，可以开始对话')
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause.message ?? cause)) })
    return () => controller.abort()
  }, [apiBase, history.ready])
  useEffect(() => { followOutput.current = true }, [history.activeId])
  useEffect(() => { if (followOutput.current) bottom.current?.scrollIntoView({ block: 'end' }) }, [messages])
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    const input = composerInput.current
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px` }
  }, [text, history.ready])

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
    const dialogue = [...messages.filter(item => item.text || item.image), user]
    setMessages([...dialogue, assistant]); setText(''); setImage(undefined)
    const payload = { model, stream: true, request_id: assistant.id, stream_options: { include_usage: true },
      enable_thinking: false, max_tokens: 2048,
      messages: [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, ...dialogue.map(item => ({ role: item.role, content: item.image ? [
        { type: 'image_url', image_url: { url: item.image } }, { type: 'text', text: item.text },
      ] : item.text }))] }
    const pending = { key: `pending:${historyId()}`, payload, messages: [...dialogue, assistant], assistantId: assistant.id }
    setBusy(true)
    try {
      await savePendingGeneration(pending)
      const thread = historyThread()
      await saveConversation({ ...thread, messages: pending.messages })
      await runGeneration(pending)
    } catch (cause) { setError(`保存生成任务失败：${String(cause)}`); setBusy(false) }
  }

  function historyId() { return history.activeId }
  function historyThread() { return history.threads.find(thread => thread.id === history.activeId)! }

  async function runGeneration(pending: PendingGeneration) {
    currentJob.current = pending; stopped.current = false
    setBusy(true); setError(''); setStatus('正在判断是否需要联网…')
    const controller = new AbortController(); abort.current = controller
    const assistant = { id: pending.assistantId }
    let answer = ''
    let finished = false
    let timing: any
    try {
      await resumableChat(`${researchBase}/v1/research/chat/completions`, pending.payload,
        { 'Content-Type': 'application/json', ...apiHeaders(researchBase) }, controller.signal, chunk => {
        if (chunk.research) {
          const info = chunk.research
          setStatus(info.stage === 'deciding' ? '正在判断是否需要联网…' : info.stage === 'direct' ? '正在直接回答…' : info.stage === 'searching' ? `正在搜索相关资料（最多 ${info.target ?? 3} 篇）…` : info.stage === 'reading' ? `已读取 ${info.count} 篇，继续读取资料（最多 ${info.target ?? 3} 篇）…` : `已读取 ${info.sources?.length ?? 0} 篇资料，正在生成回答…`)
          if (Array.isArray(info.sources)) setMessages(current => current.map(item => item.id === assistant.id ? { ...item, sources: info.sources } : item))
        }
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
      }, attempt => setStatus(`连接中断，正在重连（${attempt}）…后台继续生成`))
      if (!finished) throw new Error('连接提前结束，回答可能不完整')
      await clearPendingGeneration(pending.key)
      setStatus(timing ? `完成 · 模型首 Token ${Math.round(timing.ttft_ms)} ms · ${Number(timing.predicted_per_second).toFixed(1)} tokens/s` : '回答完成')
    } catch (cause) {
      if (controller.signal.aborted) setStatus('已停止生成')
      else {
        if ((cause as any)?.serverError) await clearPendingGeneration(pending.key)
        setError(cause instanceof Error ? cause.message : String(cause)); setStatus('生成失败')
      }
    } finally {
      if (stopped.current) await clearPendingGeneration(pending.key)
      abort.current = null; currentJob.current = null; setBusy(false)
      if (!answer) setMessages(current => current.filter(item => item.id !== assistant.id))
    }
  }

  useEffect(() => {
    if (!history.ready || busy || abort.current) return
    let cancelled = false
    void loadPendingGeneration(`pending:${history.activeId}`).then(pending => {
      if (!pending || cancelled || abort.current) return
      // Replay from zero into an empty assistant message; no repeated text.
      setMessages(pending.messages.map(item => item.id === pending.assistantId ? { ...item, text: '', sources: [] } : item))
      void runGeneration(pending)
    }).catch(cause => setError(`恢复任务失败：${String(cause)}`))
    return () => { cancelled = true }
  }, [history.ready, history.activeId])

  function stopGeneration() {
    stopped.current = true
    const pending = currentJob.current
    abort.current?.abort()
    if (pending) void fetch(`${researchBase}/v1/research/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...apiHeaders(researchBase) },
      body: JSON.stringify({ request_id: pending.payload.request_id }),
    }).catch(() => setError('停止请求未送达；后台任务可能仍在生成。'))
  }

  function resetComposer() { setImage(undefined); setText(''); setError(''); followOutput.current = true }
  function selectConversation(id: string) {
    history.select(id); resetComposer(); setStatus('已恢复对话，可以继续追问')
    if (window.matchMedia('(max-width: 840px)').matches) setSidebarOpen(false)
  }
  function createConversation() {
    history.create(); resetComposer(); setStatus('新对话')
    if (window.matchMedia('(max-width: 840px)').matches) setSidebarOpen(false)
  }
  if (!history.ready) return <main className="chat-loading"><p role="status">正在恢复对话记录…</p></main>

  return <div data-theme={theme} className={`chat-shell ${sidebarOpen ? '' : 'sidebar-closed'}`}>
    <HistorySidebar threads={history.threads} activeId={history.activeId} open={sidebarOpen} busy={busy || uploading}
      onToggle={() => setSidebarOpen(value => !value)} onNew={createConversation} onSelect={selectConversation}
      onRename={history.rename} onDelete={async id => { await history.remove(id); if (id === history.activeId) resetComposer() }} />
    <main className={`chat-page ${messages.length ? '' : 'is-empty'}`}>
      <header className="chat-heading">
        <div className="chat-heading-left"><button className="icon-button" aria-label={sidebarOpen ? '收起历史侧栏' : '展开历史侧栏'} title="对话历史" onClick={() => setSidebarOpen(value => !value)}><ChatIcon name="panel" /></button>
          <div className="chat-model"><h1>Qwen</h1><select aria-label="选择聊天模型" value={model} disabled={busy || messages.length > 0} onChange={event => setModel(event.target.value)}>
            {models.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select></div>
        </div>
        <div className="chat-heading-actions"><button className="icon-button chat-theme-toggle" onClick={toggleTheme} aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} title={theme === 'light' ? '切换深色主题' : '切换浅色主题'}><ChatIcon name={theme === 'light' ? 'moon' : 'sun'} /></button><span className="chat-connection"><span className={models.length ? 'connected-dot' : 'connecting-dot'} />{models.length ? '已连接' : '连接中'}</span></div>
      </header>
      <section className="chat-history" aria-label="对话记录" aria-live="polite" onScroll={event => {
        const pane = event.currentTarget; followOutput.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 100
      }}>
        {!messages.length && <div className="chat-empty"><span className="chat-welcome-symbol"><ChatIcon name="chat" /></span><h2>有什么可以帮你？</h2><p>聊聊想法，解决问题，或一起写点代码。</p>
          <div className="chat-suggestions">{['用中文介绍一下你自己', '写一个 Python 快速排序函数', '解释什么是大语言模型'].map(prompt =>
            <button key={prompt} onClick={() => setText(prompt)}>{prompt}</button>)}</div>
        </div>}
        <div className="chat-transcript">
          {messages.map(item => <article key={item.id} className={`chat-message chat-message--${item.role}`}>
            <span className="chat-role">{item.role === 'user' ? '你' : 'Qwen'}</span>
            {item.image && <img className="chat-image" src={item.image} alt="发送给模型的图片" />}
            <div className="chat-text">{item.text ? item.role === 'assistant' ? <MessageText text={item.text} /> : item.text : <span className="chat-thinking">{status}</span>}</div>
            {item.role === 'assistant' && item.sources?.length && <details className="chat-sources"><summary>已读取的资料 · {item.sources.length} 篇</summary><ol>{item.sources.map((source, index) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || `来源 ${index + 1}`}</a></li>)}</ol></details>}
            {item.role === 'assistant' && item.text && <button className="chat-copy icon-button" aria-label="复制回答" title="复制回答" onClick={() => {
              void navigator.clipboard.writeText(item.text).then(() => setStatus('回答已复制')).catch(() => setError('复制失败，请手动选择文本复制'))
            }}><ChatIcon name="copy" /></button>}
          </article>)}
          <div ref={bottom} />
        </div>
      </section>
      <footer className="chat-composer">
        {history.storageError && <p role="alert" className="chat-error">{history.storageError}</p>}
        {error && <p role="alert" className="chat-error">{error}</p>}
        <div className="chat-input-box">
          {image && <div className="chat-attachment"><img src={image} alt="待发送的图片" /><button className="icon-button" aria-label="移除图片" disabled={busy} onClick={() => setImage(undefined)}><ChatIcon name="close" /></button></div>}
          <textarea ref={composerInput} aria-label="输入消息" placeholder="向 Qwen 发送消息" value={text} disabled={busy} rows={2}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
            }} />
          <div className="chat-composer-actions">
            <div><input ref={picker} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(event.target.files?.[0]); event.target.value = '' }} />
              <button className="icon-button chat-upload" aria-label="上传图片" title="上传图片" disabled={!vision || busy || uploading} onClick={() => picker.current?.click()}><ChatIcon name="attach" /></button>
              <span className="chat-hint">{uploading ? '读取图片中…' : vision ? '支持图片' : '文字对话'}</span></div>
            {busy ? <button className="chat-stop icon-button" aria-label="停止生成" title="停止生成" onClick={stopGeneration}><ChatIcon name="stop" /></button> :
              <button className="chat-send icon-button" aria-label="发送消息" title="发送消息" disabled={!model || uploading || (!text.trim() && !image)} onClick={() => void send()}><ChatIcon name="send" /></button>}
          </div>
        </div>
        <p className="chat-status" role="status">{busy ? status : status === '已连接，可以开始对话' || status === '新对话' ? '回答可能有误，请核实重要信息。' : status}</p>
      </footer>
    </main>
  </div>
}
