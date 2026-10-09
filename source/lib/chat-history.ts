export type Message = { id: string; role: 'user' | 'assistant'; text: string; image?: string }
export type Conversation = { id: string; model: string; title: string; messages: Message[]; updated: number }
let database: Promise<IDBDatabase> | undefined
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ninfer-chat-history', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('conversations', { keyPath: 'id' })
      request.result.createObjectStore('settings', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('请关闭其他旧版聊天页面后刷新'))
  })
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('历史保存事务已取消'))
    transaction.onerror = () => reject(transaction.error)
  })
}
export async function loadConversations() {
  const database = await db()
  const transaction = database.transaction(['conversations', 'settings'], 'readonly')
  const done = completed(transaction)
  const conversations = transaction.objectStore('conversations').getAll()
  const active = transaction.objectStore('settings').get('active')
  await done
  return { conversations: conversations.result as Conversation[], activeId: active.result?.value as string | undefined }
}
export async function saveConversation(conversation: Conversation) {
  const database = await db()
  const transaction = database.transaction(['conversations', 'settings'], 'readwrite')
  const done = completed(transaction)
  // Empty placeholders are not answers and must not reappear after a reload.
  transaction.objectStore('conversations').put({ ...conversation,
    messages: conversation.messages.filter(message => message.text || message.image) })
  transaction.objectStore('settings').put({ key: 'active', value: conversation.id })
  await done
}
export async function deleteConversation(id: string) {
  const database = await db()
  const transaction = database.transaction('conversations', 'readwrite')
  const done = completed(transaction)
  transaction.objectStore('conversations').delete(id)
  await done
}
export function newConversation(model = ''): Conversation {
  return { id: crypto.randomUUID(), model, title: '新对话', messages: [], updated: Date.now() }
}
