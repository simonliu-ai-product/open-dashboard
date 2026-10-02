import { useEffect, useState } from 'react'
import { useT } from '../../runtime/i18n.js'
import { CheckIcon, CopyIcon } from './icons.js'

export function CommandButton({ command, text }: { command: string; text?: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className="odd-command"
      onClick={() => {
        navigator.clipboard?.writeText(`${command} `).then(
          () => setCopied(true),
          () => {},
        )
      }}
    >
      <span className="odd-command-head">
        <code>{command}</code>
        <span className="odd-command-copy" aria-live="polite" data-copied={copied || undefined}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t('Copied') : t('Copy')}
        </span>
      </span>
      {text ? <span className="odd-command-text">{t(text)}</span> : null}
    </button>
  )
}
