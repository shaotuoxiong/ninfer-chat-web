import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageText } from './MessageText'
const render = (text: string) => renderToStaticMarkup(<MessageText text={text} />)
test('render model headings, nested lists and tables with safe line breaks', () => {
  const html = render('### 比较\n\n1. 第一项\n   - 子项\n\n| 项目 | 内容 |\n| --- | --- |\n| Qwen | 第一行<br>第二行 |')
  expect(html).toContain('<h3>比较</h3>')
  expect(html).toContain('<ol>')
  expect(html).toContain('<ul>')
  expect(html).toContain('<table>')
  expect(html).toMatch(/第一行<br\/>\s*第二行/)
  expect(html).not.toContain('&lt;br&gt;')
})
test('never execute raw response HTML or unsafe links; preserve code literal', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert(1))\n\n```html\n<br>\n```')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('href="javascript:')
  expect(html).toContain('&lt;')
  expect(html).toContain('hljs-')
  expect(html).toContain('复制代码')
})
