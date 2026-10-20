import { DATA_UPDATED, type HostDeps, onHostMessage } from './host.js'

const deps = (over: Partial<HostDeps> = {}) => {
  const calls: string[] = []
  const parent = { postMessage: (m: unknown) => calls.push(`ack ${(m as { type: string }).type}`) }
  const d: HostDeps = {
    parent,
    readBuiltAt: async () => '2026-10-20T19:05:00',
    forget: () => calls.push('forget'),
    setBuiltAt: (b) => calls.push(`builtAt ${b}`),
    refresh: () => calls.push('refresh'),
    reload: () => calls.push('reload'),
    ...over,
  }
  return { d, calls, parent }
}

describe('host contract', () => {
  it('answers, forgets what it read, and refreshes in place', async () => {
    const { d, calls, parent } = deps()
    expect(await onHostMessage(parent, { type: DATA_UPDATED }, d)).toBe(true)
    expect(calls).toEqual([
      'ack open-x:data-updated:ack',
      'forget',
      'builtAt 2026-10-20T19:05:00',
      'refresh',
    ])
  })

  /* An access key that ran out reads as a failed fetch: only a fresh page gets a new one. */
  it('reloads when the new data cannot be read', async () => {
    const { d, calls, parent } = deps({
      readBuiltAt: async () => {
        throw new Error('403')
      },
    })
    await onHostMessage(parent, { type: DATA_UPDATED }, d)
    expect(calls.at(-1)).toBe('reload')
    expect(calls).not.toContain('refresh')
  })

  it('ignores messages from anything but its host, and other messages', async () => {
    const { d, calls, parent } = deps()
    expect(await onHostMessage({}, { type: DATA_UPDATED }, d)).toBe(false)
    expect(await onHostMessage(parent, { type: 'something-else' }, d)).toBe(false)
    expect(calls).toEqual([])
  })
})
