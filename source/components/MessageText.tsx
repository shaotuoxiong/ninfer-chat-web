import { Fragment } from 'react'
function inline(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> :
    part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : <Fragment key={index}>{part}</Fragment>)
}
// Render common model formatting through React text nodes; never evaluate response HTML.
export function MessageText({ text }: { text: string }) {
  return <div className="chat-markdown">{text.split('```').map((part, index) => {
    if (index % 2) {
      const newline = part.indexOf('\n')
      const language = newline >= 0 ? part.slice(0, newline).trim() : ''
      const code = newline >= 0 ? part.slice(newline + 1).replace(/\n$/, '') : part
      return <div className="chat-code-block" key={index}><div>{language || '代码'}</div><pre><code>{code}</code></pre></div>
    }
    return <Fragment key={index}>{part.split(/\n\s*\n/).filter(Boolean).map((paragraph, block) => {
      const heading = /^(#{1,4})\s+(.+)$/.exec(paragraph)
      return heading ? <h3 key={block}>{inline(heading[2])}</h3> : <p key={block}>{inline(paragraph)}</p>
    })}</Fragment>
  })}</div>
}
