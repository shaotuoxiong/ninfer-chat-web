import { useEffect, useState } from 'react'
export function useChatTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('ninfer-chat-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.dataset.chatTheme = theme
    try { localStorage.setItem('ninfer-chat-theme', theme) } catch { /* Theme remains usable without storage. */ }
  }, [theme])
  return { theme, toggleTheme: () => setTheme(current => current === 'light' ? 'dark' : 'light') }
}
