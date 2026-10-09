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

test('render inline pi, heading math, fraction and display integral', () => {
  const html = render(String.raw`### 证明 $\pi$ 是无理数

圆周率 $\pi = \frac{\text{圆的周长}}{\text{圆的直径}}$。

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$`)
  expect(html).toContain('class="katex"')
  expect(html).toContain('class="katex-display"')
  expect(html).toContain('class="mfrac"')
  expect(html).toContain('<math')
  expect(html).not.toContain('katex-error')
  expect(html).not.toContain('chat-code-block')
})
test('incomplete streaming math falls back without executing TeX links; code stays literal', () => {
  const partial = render(String.raw`$\frac{1}{$`)
  expect(partial).toContain('katex-error')
  const code = render(['`' + String.raw`$\pi$` + '`', '```text', String.raw`$\pi$`, '```'].join('\n'))
  expect(code).not.toContain('class="katex"')
  expect(code).toContain(String.raw`$\pi$`)
  const unsafe = render(String.raw`$\href{javascript:alert(1)}{click}$`)
  expect(unsafe).not.toContain('href="javascript:')
})
