import { useEffect, useRef, useState } from 'react'
import type { ParamValue } from '../../config.js'
import { useT } from '../../runtime/i18n.js'
import { Blocks, parseBlocks } from '../../runtime/markdown.js'
import { api } from '../lib/api.js'

interface Message {
  role: 'user' | 'assistant'
  content: string
  error?: boolean
}

const SUGGESTIONS = ['Summarize this dashboard', 'What changed the most?', 'Anything unusual?']

/** Whether the server has an assistant configured. Re-asked when the config reloads. */
export function useAssistantEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let live = true
    const load = () =>
      api.assistant().then(
        (status) => live && setEnabled(status.enabled),
        () => live && setEnabled(false),
      )
    load()
    const onChange = (data: unknown) => {
      if (!(data as { id?: string } | undefined)?.id) load()
    }
    import.meta.hot?.on('odd:queries-changed', onChange)
    return () => {
      live = false
      import.meta.hot?.off?.('odd:queries-changed', onChange)
    }
  }, [])
  return enabled
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 9.5h7M8.5 12.5h4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Assistant({
  dashboard,
  title,
  params,
}: {
  dashboard: string
  title: string
  params: () => Record<string, ParamValue>
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the reply as it grows
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => () => abort.current?.abort(), [])

  const ask = async (question: string) => {
    const text = question.trim()
    if (!text || busy) return
    const history = [...messages.filter((m) => !m.error), { role: 'user' as const, content: text }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setDraft('')
    setBusy(true)
    const controller = new AbortController()
    abort.current = controller
    const replace = (message: Message) =>
      setMessages((current) => [...current.slice(0, -1), message])
    try {
      await api.ask(
        dashboard,
        params(),
        history.map(({ role, content }) => ({ role, content })),
        (reply) => replace({ role: 'assistant', content: reply }),
        controller.signal,
      )
    } catch (error) {
      if (!controller.signal.aborted)
        replace({ role: 'assistant', content: (error as Error).message, error: true })
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  const stop = () => abort.current?.abort()

  return (
    <>
      {open ? (
        <section className="odd-chat" aria-label={t('Ask about this dashboard')}>
          <header className="odd-chat-head">
            <span className="odd-chat-title">{title}</span>
            <button
              type="button"
              className="odd-icon-button"
              title={t('New conversation')}
              aria-label={t('New conversation')}
              disabled={messages.length === 0 || busy}
              onClick={() => setMessages([])}
            >
              <Icon d="M8 3v10M3 8h10" />
            </button>
            <button
              type="button"
              className="odd-icon-button"
              title={t('Close chat')}
              aria-label={t('Close chat')}
              onClick={() => setOpen(false)}
            >
              <Icon d="M4 4l8 8M12 4l-8 8" />
            </button>
          </header>

          <div className="odd-chat-messages" ref={list} aria-live="polite">
            {messages.length === 0 ? (
              <div className="odd-chat-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => ask(t(suggestion))}>
                    {t(suggestion)}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((message, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: messages only append, so position is identity
                  key={i}
                  className="odd-chat-message"
                  data-role={message.role}
                  data-error={message.error || undefined}
                >
                  {message.role === 'assistant' && !message.content && busy ? (
                    <span className="odd-chat-typing" role="status" aria-label={t('Loading…')}>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : message.role === 'assistant' && !message.error ? (
                    <Blocks blocks={parseBlocks(message.content)} />
                  ) : (
                    message.content
                  )}
                </div>
              ))
            )}
          </div>

          <form
            className="odd-chat-input"
            onSubmit={(event) => {
              event.preventDefault()
              ask(draft)
            }}
          >
            <textarea
              ref={input}
              rows={1}
              value={draft}
              placeholder={t('Ask about this dashboard…')}
              aria-label={t('Ask about this dashboard')}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  ask(draft)
                }
              }}
            />
            {busy ? (
              <button
                type="button"
                className="odd-chat-send"
                title={t('Stop')}
                aria-label={t('Stop')}
                onClick={stop}
              >
                <Icon d="M5 5h6v6H5z" />
              </button>
            ) : (
              <button
                type="submit"
                className="odd-chat-send"
                title={t('Send')}
                aria-label={t('Send')}
                disabled={!draft.trim()}
              >
                <Icon d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
              </button>
            )}
          </form>
        </section>
      ) : null}
      <button
        type="button"
        className="odd-chat-fab"
        aria-expanded={open}
        title={t('Ask about this dashboard')}
        aria-label={t('Ask about this dashboard')}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <Icon d="M4 6l4 4 4-4" /> : <ChatIcon />}
      </button>
    </>
  )
}
