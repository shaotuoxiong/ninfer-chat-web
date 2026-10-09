const paths = {
  panel: 'M9 4v16M4 4h16v16H4z',
  new: 'M14 5H5v14h14v-9M15 3l6 6M11 13l2-5 5-5 3 3-5 5z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM16 16l5 5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6 6 18',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7',
  send: 'M12 20V4M5 11l7-7 7 7',
  stop: 'M7 7h10v10H7z',
  attach: 'm8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9M7 14l8-8',
  copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
  chat: 'M4 5h16v12H8l-4 4z',
}
export function ChatIcon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3.5 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
