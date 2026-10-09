import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from './views/Chat'
import './styles/foundation.css'
import './styles/site.css'

function App() {
  const saved = localStorage.getItem('ninfer-api-base') ?? ''
  const [apiBase, setApiBase] = useState(saved)
  const [input, setInput] = useState(saved)
  const [error, setError] = useState('')
  function connect() {
    try {
      const url = new URL(input.trim())
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
        throw new Error('请输入 HTTPS 服务地址')
      }
      if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '/v1' && url.pathname !== '/v1/')) {
        throw new Error('请输入服务根地址，例如 https://example.com')
      }
      localStorage.setItem('ninfer-api-base', url.origin)
      setApiBase(url.origin); setInput(url.origin); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '服务地址无效') }
  }
  return <><nav className="site-bar"><strong>nInfer · Qwen</strong><span>RTX 4090 · 中文聊天</span>
    <details><summary>服务设置</summary><div className="site-settings"><label htmlFor="api-base">推理服务地址</label>
      <input id="api-base" type="url" placeholder="https://…" value={input} onChange={e => setInput(e.target.value)} />
      <button className="button" onClick={connect}>连接服务</button>
      <p>临时入口到期后，在这里填写新的服务地址。</p>{error && <p role="alert">{error}</p>}</div></details></nav>
    {apiBase ? <Chat key={apiBase} apiBase={apiBase} /> : <section className="connect-card"><h1>欢迎使用 Qwen</h1>
      <p>正在读取服务地址；也可以在右上角“服务设置”中连接。</p><p role="alert">{error}</p></section>}
  </>
}
async function start() {
  try {
    const response = await fetch('./config.json', { cache: 'no-store' })
    if (response.ok) {
      const config = await response.json()
      const current = localStorage.getItem('ninfer-api-base')
      const previous = localStorage.getItem('ninfer-default-base')
      if (config.apiBase && (!current || current === previous)) localStorage.setItem('ninfer-api-base', config.apiBase)
      localStorage.setItem('ninfer-default-base', config.apiBase ?? '')
    }
  } catch { /* Saved or manual service configuration remains available. */ }
  createRoot(document.getElementById('root')!).render(<App />)
}
void start()
