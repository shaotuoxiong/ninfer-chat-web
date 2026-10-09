import { memo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { PluggableList } from 'unified'
import type { Root, RootContent } from 'mdast'
import type { Element, ElementContent } from 'hast'
import { ChatIcon } from './ChatIcon'

// Convert only a plain HTML line break. Other response HTML is never interpreted.
function remarkLineBreaks() {
  return (tree: Root) => {
    function visit(parent: { children: RootContent[] }) {
      parent.children = parent.children.map(node => {
        if (node.type === 'html' && /^<br\s*\/?\s*>$/i.test(node.value.trim())) return { type: 'break' }
        if ('children' in node) visit(node as unknown as { children: RootContent[] })
        return node
      })
    }
    visit(tree)
  }
}
function plainText(node: Element | ElementContent): string {
  if (node.type === 'text') return node.value
  return 'children' in node ? node.children.map(plainText).join('') : ''
}
function CodeBlock({ node, children }: { node?: Element; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code') as Element | undefined
  const classes = code?.properties.className
  const language = (Array.isArray(classes) ? classes : []).find(name => String(name).startsWith('language-'))
  async function copy() {
    try { await navigator.clipboard.writeText(code ? plainText(code).replace(/\n$/, '') : ''); setCopied(true); setError(false) }
    catch { setError(true) }
  }
  return <div className="chat-code-block"><div className="chat-code-header"><span>{language ? String(language).slice(9) : '代码'}</span>
    <button type="button" onClick={() => void copy()} aria-label="复制代码"><ChatIcon name="copy" />{error ? '请手动复制' : copied ? '已复制' : '复制代码'}</button></div>
    <pre>{children}</pre></div>
}
const remarkPlugins = [remarkGfm, remarkLineBreaks]
const rehypePlugins: PluggableList = [[rehypeHighlight, { detect: false, ignoreMissing: true }]]
export const MessageText = memo(function MessageText({ text }: { text: string }) {
  return <div className="chat-markdown"><Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} skipHtml
    components={{
      pre: ({ node, children }) => <CodeBlock node={node}>{children}</CodeBlock>,
      table: ({ node: _node, children, ...props }) => <div className="chat-table-scroll" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table {...props}>{children}</table></div>,
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      img: ({ alt }) => <span className="chat-image-description">[图片{alt ? `：${alt}` : ''}]</span>,
    }}>{text}</Markdown></div>
})
