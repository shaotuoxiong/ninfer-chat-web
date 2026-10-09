import { useEffect, useState } from 'react'
import type { Conversation } from '../lib/chat-history'
import { ChatIcon } from './ChatIcon'

type Props = { threads: Conversation[]; activeId: string; open: boolean; busy: boolean;
  onToggle: () => void; onNew: () => void; onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>; onDelete: (id: string) => Promise<void> }
function dateGroup(time: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const date = new Date(time); date.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - date.getTime()) / 86400000)
  return days <= 0 ? '今天' : days === 1 ? '昨天' : days < 7 ? '过去 7 天' : '更早'
}
export function HistorySidebar(props: Props) {
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  const [action, setAction] = useState<{ thread: Conversation; type: 'rename' | 'delete' } | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.history-row')) setMenu(null) }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [menu])
  const query = search.trim().toLowerCase()
  const threads = props.threads.filter(thread => thread.messages.length > 0 && (!query ||
    thread.title.toLowerCase().includes(query) || thread.messages.some(message => message.text.toLowerCase().includes(query))))
    .sort((a, b) => b.updated - a.updated)
  const groups = new Map<string, Conversation[]>()
  for (const thread of threads) {
    const key = query ? '搜索结果' : dateGroup(thread.updated)
    groups.set(key, [...(groups.get(key) ?? []), thread])
  }
  async function apply() {
    if (!action || saving) return
    setSaving(true)
    try {
      if (action.type === 'rename') await props.onRename(action.thread.id, name.trim())
      else await props.onDelete(action.thread.id)
      setAction(null)
    } catch { /* The shared storage error is shown in the chat. */ } finally { setSaving(false) }
  }
  return <>
    {props.open && <button className="chat-sidebar-scrim" aria-label="收起历史侧栏" onClick={props.onToggle} />}
    <aside className="chat-sidebar" aria-label="对话历史" aria-hidden={!props.open} inert={!props.open}>
      <div className="sidebar-brand"><span className="sidebar-logo"><ChatIcon name="chat" /></span><strong>nInfer</strong>
        <button className="icon-button" aria-label="收起历史侧栏" title="收起侧栏" onClick={props.onToggle}><ChatIcon name="panel" /></button></div>
      <button className="sidebar-new" disabled={props.busy} onClick={() => { props.onNew(); setMenu(null); setSearch('') }}><ChatIcon name="new" />新对话</button>
      <label className="sidebar-search"><ChatIcon name="search" /><input aria-label="搜索对话" placeholder="搜索对话" value={search} onChange={event => { setSearch(event.target.value); setMenu(null) }} /></label>
      <nav className="sidebar-history" aria-label="历史会话列表">
        {Array.from(groups).map(([group, rows]) => <section key={group}><h2>{group}</h2>{rows.map(thread =>
          <div key={thread.id} className={`history-row ${props.activeId === thread.id ? 'is-active' : ''}`}>
            <button className="history-link" aria-current={props.activeId === thread.id ? 'page' : undefined} disabled={props.busy} title={thread.title} data-thread-id={thread.id}
              onClick={() => { props.onSelect(thread.id); setMenu(null) }}>{thread.title}</button>
            <button className="icon-button history-more" aria-label={`对话操作：${thread.title}`} aria-expanded={menu === thread.id} disabled={props.busy}
              onClick={() => setMenu(menu === thread.id ? null : thread.id)}><ChatIcon name="more" /></button>
            {menu === thread.id && <div className="history-menu">
              <button disabled={props.busy} onClick={() => { setAction({ thread, type: 'rename' }); setName(thread.title); setMenu(null) }}><ChatIcon name="edit" />重命名</button>
              <button className="danger" disabled={props.busy} onClick={() => { setAction({ thread, type: 'delete' }); setMenu(null) }}><ChatIcon name="trash" />删除对话</button>
            </div>}
          </div>)}</section>)}
        {!threads.length && <p className="sidebar-empty">{query ? '没有找到相关对话' : '开始聊天后，对话会出现在这里。'}</p>}
      </nav>
      <div className="sidebar-footer"><span className="storage-dot" /><div>历史自动保存<small>仅保存在此浏览器</small></div></div>
    </aside>
    {action && <div className="chat-dialog-backdrop" onClick={() => !saving && setAction(null)}>
      <section className="chat-dialog" role="dialog" aria-modal="true" aria-label={action.type === 'rename' ? '重命名对话' : '删除对话'} onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape' && !saving) setAction(null)
        if (event.key === 'Tab') {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button:not(:disabled)'))
          const first = controls[0], last = controls.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
        <h2>{action.type === 'rename' ? '重命名对话' : '删除这段对话？'}</h2>
        {action.type === 'rename' ? <form onSubmit={event => { event.preventDefault(); void apply() }}><input aria-label="对话名称" autoFocus maxLength={80} value={name} onChange={event => setName(event.target.value)} />
          <div className="dialog-actions"><button type="button" className="button" disabled={saving} onClick={() => setAction(null)}>取消</button><button className="button primary" disabled={saving || !name.trim()}>保存</button></div></form> :
          <><p>“{action.thread.title}”会从此浏览器中删除，此操作无法撤销。</p><div className="dialog-actions"><button autoFocus className="button" disabled={saving} onClick={() => setAction(null)}>取消</button><button className="button danger-fill" disabled={saving} onClick={() => void apply()}>确认删除</button></div></>}
      </section>
    </div>}
  </>
}
