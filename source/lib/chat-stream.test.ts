import { expect, test } from 'bun:test'
import { readChatStream } from './chat-stream'

function stream(text: string) {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({ start(controller) {
    // Real HTTP chunks may split any UTF-8 character, CRLF separator or JSON field.
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  } })
}
test('stream preserves Chinese across byte boundaries and handles CRLF, usage and DONE', async () => {
  const chunks: any[] = []
  await readChatStream(stream('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[],"usage":{"completion_tokens":2}}\n\ndata: [DONE]\n\n'), chunk => chunks.push(chunk))
  expect(chunks[0].choices[0].delta.content).toBe('你好')
  expect(chunks[1].usage.completion_tokens).toBe(2)
  expect(chunks).toHaveLength(2)
})
test('in-band server errors reject even when HTTP streaming succeeded', async () => {
  await expect(readChatStream(stream('data: {"error":{"message":"vision_disabled"}}\n\n'), () => {})).rejects.toThrow('vision_disabled')
})
