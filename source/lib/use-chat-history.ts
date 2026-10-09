import { useEffect, useRef, useState, type SetStateAction } from 'react'
import { deleteConversation, loadConversations, newConversation, saveConversation,
  type Conversation, type Message } from './chat-history'

export function useChatHistory(busy: boolean) {
  const [threads, setThreads] = useState<Conversation[]>(() => [newConversation()])
  const [activeId, setActiveId] = useState('')
  const [ready, setReady] = useState(false)
  const [storageError, setStorageError] = useState('')
  const active = threads.find(thread => thread.id === activeId) ?? threads[0]
  const latest = useRef(active)
  latest.current = active
  const deleting = useRef<string | null>(null)
  const report = (cause: unknown) => setStorageError(`对话保存不可用：${cause instanceof Error ? cause.message : String(cause)}。请检查浏览器存储空间。`)

  useEffect(() => {
    let cancelled = false
    void loadConversations().then(saved => {
      if (cancelled) return
      if (saved.conversations.length) {
        const sorted = saved.conversations.sort((a, b) => b.updated - a.updated)
        setThreads(sorted)
        setActiveId(sorted.some(thread => thread.id === saved.activeId) ? saved.activeId! : sorted[0].id)
      }
      setReady(true)
    }).catch(cause => { if (!cancelled) { report(cause); setReady(true) } })
    return () => { cancelled = true }
  }, [])

  const persist = () => {
    const thread = latest.current
    if (thread.id === deleting.current) return
    void saveConversation(thread).then(() => setStorageError('')).catch(report)
  }
  useEffect(() => {
    if (!ready) return
    // Throttle during token streaming; always save completed answers immediately.
    if (!busy) persist()
  }, [active, ready, busy])
  useEffect(() => {
    if (!ready) return
    const timer = busy ? setInterval(persist, 500) : undefined
    const hidden = () => { if (document.visibilityState === 'hidden') persist() }
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      if (timer) clearInterval(timer)
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [ready, busy])

  function update(change: (thread: Conversation) => Conversation) {
    setThreads(current => current.map(thread => thread.id === latest.current.id ? change(thread) : thread))
  }
  function setMessages(value: SetStateAction<Message[]>) {
    update(thread => {
      const messages = typeof value === 'function' ? value(thread.messages) : value
      return { ...thread, messages, updated: Date.now(),
        title: messages.find(message => message.role === 'user')?.text.slice(0, 28) || '新对话' }
    })
  }
  function setModel(value: SetStateAction<string>) {
    update(thread => ({ ...thread, model: typeof value === 'function' ? value(thread.model) : value }))
  }
  function create() {
    persist()
    const thread = newConversation(active.model)
    setThreads(current => [thread, ...current]); setActiveId(thread.id)
  }
  function select(id: string) { persist(); setActiveId(id) }
  async function remove() {
    const id = active.id
    deleting.current = id
    try {
      await deleteConversation(id)
      const remaining = threads.filter(thread => thread.id !== id)
      const next = remaining[0] ?? newConversation(active.model)
      setThreads(remaining.length ? remaining : [next]); setActiveId(next.id)
    } catch (cause) { deleting.current = null; report(cause) }
  }
  return { ready, threads, activeId: active.id, messages: active.messages, model: active.model,
    setMessages, setModel, create, select, remove, storageError }
}
