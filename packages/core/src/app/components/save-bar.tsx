import { useT } from '../../runtime/i18n.js'
import type { SaveStatus } from '../lib/use-layout-edit.js'
import { UndoIcon } from './icons.js'

export interface SaveBarProps {
  file: string | undefined
  count: number
  status: SaveStatus
  onUndo: () => void
  onDiscard: () => void
  onSave: () => void
  onReload: () => void
}

/** The one place edit mode's changes are kept, undone, thrown away or written. */
export function SaveBar(props: SaveBarProps) {
  const t = useT()
  const { status, count } = props

  let message: string
  if (status.kind === 'saving') message = t('Saving…')
  else if (status.kind === 'error') message = status.message
  else if (status.kind === 'blocked')
    message = t('Save or discard your changes before switching to Preview.')
  else if (count > 0)
    message = t(count === 1 ? '1 unsaved change' : '{n} unsaved changes', { n: count })
  else if (status.kind === 'saved') message = t('Saved to {file}', { file: props.file ?? '' })
  else
    message = t(
      'Drag a panel’s edges to resize it, its grip to reorder, or the chart button to change it.',
    )

  return (
    <div
      className="odd-savebar"
      role="status"
      data-status={status.kind}
      data-dirty={count > 0 || undefined}
    >
      <span className="odd-savebar-message">{message}</span>
      {status.kind === 'error' && status.stale ? (
        <button type="button" className="odd-button" onClick={props.onReload}>
          {t('Discard and reload')}
        </button>
      ) : null}
      {count > 0 && status.kind !== 'saving' ? (
        <>
          <button
            type="button"
            className="odd-button odd-button-ghost"
            onClick={props.onUndo}
            title={t('Undo (⌘Z)')}
          >
            <UndoIcon />
            {t('Undo')}
          </button>
          <button type="button" className="odd-button odd-button-ghost" onClick={props.onDiscard}>
            {t('Discard')}
          </button>
          <button
            type="button"
            className="odd-button odd-button-primary"
            onClick={props.onSave}
            title={t('Save (⌘S)')}
          >
            {t('Save')}
            <kbd>⌘S</kbd>
          </button>
        </>
      ) : null}
    </div>
  )
}
