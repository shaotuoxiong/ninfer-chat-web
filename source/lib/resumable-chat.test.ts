import { expect, test } from 'bun:test'
import { resumableChat } from './resumable-chat'

function response(events: any[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
}
test('reconnect resumes from the last event without generating or displaying duplicate text', async () => {
  const original = globalThis.fetch
  let calls = 0
  const offsets: number[] = []
  globalThis.fetch = (async (_url: any, init: any) => {
    offsets.push(JSON.parse(init.body).after)
    calls++
    return calls === 1 ? response([{ resume: { seq: 1 }, choices: [{ delta: { content: '第一' } }] }]) :
      response([{ resume: { seq: 1 }, choices: [{ delta: { content: '重复' } }] },
        { resume: { seq: 2 }, choices: [{ delta: { content: '第二' }, finish_reason: 'stop' }] }])
  }) as any
  let text = ''
  try {
    await resumableChat('/api', { request_id: 'fixed' }, {}, new AbortController().signal,
      chunk => { text += chunk.choices[0].delta.content }, () => {})
    expect(text).toBe('第一第二')
    expect(offsets).toEqual([0, 1])
  } finally { globalThis.fetch = original }
})
test('genuine server errors do not retry a failed generation', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => { calls++; return response([{ error: { message: '模型异常' } }]) }) as any
  try {
    await expect(resumableChat('/api', {}, {}, new AbortController().signal, () => {}, () => {})).rejects.toThrow('模型异常')
    expect(calls).toBe(1)
  } finally { globalThis.fetch = original }
})
