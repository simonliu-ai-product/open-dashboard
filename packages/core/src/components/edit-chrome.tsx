import { type PointerEvent as ReactPointerEvent, type RefObject, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useEdit } from '../runtime/edit.js'
import { useT } from '../runtime/i18n.js'

type Edge = 'e' | 's' | 'se'

export interface LiveSize {
  span?: number
  height?: number
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function gridMetrics(parent: HTMLElement) {
  const style = getComputedStyle(parent)
  const gap = Number.parseFloat(style.columnGap) || 12
  const width = parent.getBoundingClientRect().width
  return { gap, column: (width - gap * 11) / 12 }
}

/**
 * Siblings slide from where they were to where the new order puts them —
 * measured before and after one synchronous commit, then animated back to
 * rest (FLIP), so a reorder reads as panels making room rather than jumping.
 */
function slideSiblings(nodes: HTMLElement[], change: () => void): void {
  const before = new Map(nodes.map((node) => [node, node.getBoundingClientRect()]))
  change()
  if (reducedMotion()) return
  for (const node of nodes) {
    const first = before.get(node)
    const last = node.getBoundingClientRect()
    if (!first) continue
    const dx = first.left - last.left
    const dy = first.top - last.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: 220,
      easing: EASE,
    })
  }
}

/** Every panel on the page, by title, with where it is now. */
function snapshot(): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>()
  for (const node of document.querySelectorAll<HTMLElement>('[data-panel-title]')) {
    out.set(`p:${node.dataset.panelTitle}`, node.getBoundingClientRect())
  }
  return out
}

/**
 * After a structural change commits, every panel slides from where it was to
 * where it now is. A panel that changed rows is a new DOM node — found again
 * by its title — and starts from wherever it was let go.
 */
function settle(before: Map<string, DOMRect>, carried?: { title: string; rect: DOMRect }): void {
  if (reducedMotion()) return
  for (const node of document.querySelectorAll<HTMLElement>('[data-panel-title]')) {
    const title = node.dataset.panelTitle as string
    const first = carried?.title === title ? carried.rect : before.get(`p:${title}`)
    const last = node.getBoundingClientRect()
    if (!first) continue
    const dx = first.left - last.left
    const dy = first.top - last.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    node.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px)`,
          ...(carried?.title === title ? { boxShadow: 'var(--odd-lift)' } : {}),
        },
        { transform: 'none' },
      ],
      { duration: 260, easing: EASE },
    )
  }
}

interface Caret {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Pointer work for one panel in edit mode. The panel follows the pointer the
 * whole way — lifted while it is carried, stretched while it is resized —
 * while a dashed outline shows where it will land on the grid; letting go
 * settles it there. Nothing touches the source: a finished drag stages one
 * edit, and the save bar writes them all.
 */
export function useEditChrome(
  ref: RefObject<HTMLElement | null>,
  title: string,
  span: number,
  height: number | 'auto',
  rowIndex: number | undefined,
) {
  const edit = useEdit()
  const t = useT()
  const layout = edit.layout[title]
  const enabled = edit.editing && Boolean(layout)
  const [live, setLive] = useState<LiveSize>()
  const [dragging, setDragging] = useState(false)
  const [target, setTarget] = useState<Box>()
  const [caret, setCaret] = useState<Caret>()

  const startResize = (edge: Edge) => (event: ReactPointerEvent) => {
    const element = ref.current
    const parent = element?.parentElement
    if (!element || !parent) return
    event.preventDefault()
    event.stopPropagation()
    const rect = element.getBoundingClientRect()
    const { gap, column } = gridMetrics(parent)
    const maxWidth = parent.getBoundingClientRect().width
    const startX = event.clientX
    const startY = event.clientY
    let next: LiveSize = {}

    const move = (e: PointerEvent) => {
      const width = clamp(rect.width + e.clientX - startX, column, maxWidth)
      const tall = clamp(rect.height + e.clientY - startY, 80, 1600)
      next = {}
      if (edge !== 's') {
        element.style.width = `${width}px`
        next.span = clamp(Math.round((width + gap) / (column + gap)), 1, 12)
      }
      if (edge !== 'e') {
        element.style.height = `${tall}px`
        next.height = clamp(Math.round(tall / 10) * 10, 80, 1600)
      }
      flushSync(() => setLive(next))
      const cell = element.getBoundingClientRect()
      const snappedSpan = next.span ?? span
      setTarget({
        left: cell.left,
        top: cell.top,
        width: edge === 's' ? cell.width : snappedSpan * column + (snappedSpan - 1) * gap,
        height: next.height ?? cell.height,
      })
    }

    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.body.classList.remove('odd-dragging')
      const from = element.getBoundingClientRect()
      // Width was drawn by hand; height is React's (the live size renders it),
      // and clearing it here would leave React thinking it is still set.
      element.style.width = ''
      const set: Record<string, number> = {}
      if (next.span !== undefined && next.span !== span) set.span = next.span
      if (next.height !== undefined && next.height !== height) set.height = next.height
      flushSync(() => {
        if (Object.keys(set).length) edit.stage({ kind: 'props', title, set })
        setLive(undefined)
        setTarget(undefined)
      })
      const to = element.getBoundingClientRect()
      if (
        !reducedMotion() &&
        (Math.abs(from.width - to.width) > 1 || Math.abs(from.height - to.height) > 1)
      ) {
        element.animate(
          [
            { width: `${from.width}px`, height: `${from.height}px` },
            { width: `${to.width}px`, height: `${to.height}px` },
          ],
          { duration: 200, easing: EASE },
        )
      }
    }

    document.body.classList.add('odd-dragging')
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const startReorder = (event: ReactPointerEvent) => {
    const element = ref.current
    const parent = element?.parentElement
    if (!element || !parent || !layout || rowIndex === undefined) return
    event.preventDefault()
    const own = edit.rows?.[rowIndex]
    const current = own ? [...own.titles] : [...layout.siblings]
    const start = element.getBoundingClientRect()
    const grabX = event.clientX - start.left
    const grabY = event.clientY - start.top
    let pointerX = event.clientX
    let pointerY = event.clientY
    let dx = 0
    let dy = 0
    let order = current
    let across: { row: number; index: number } | undefined

    const panelsIn = (row: HTMLElement) =>
      [...row.querySelectorAll<HTMLElement>(':scope > [data-panel-title]')]
        .filter((node) => node !== element)
        .map((node) => ({
          node,
          title: node.dataset.panelTitle as string,
          rect: node.getBoundingClientRect(),
        }))
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)

    const insertionIndex = (others: { rect: DOMRect }[]) => {
      const index = others.findIndex(
        ({ rect }) =>
          pointerY < rect.top || (pointerY < rect.bottom && pointerX < rect.left + rect.width / 2),
      )
      return index === -1 ? others.length : index
    }

    const rowUnderPointer = (): HTMLElement | undefined => {
      const rows = [...document.querySelectorAll<HTMLElement>('.odd-row[data-row-index]')]
      let best: HTMLElement | undefined
      let distance = Number.POSITIVE_INFINITY
      for (const row of rows) {
        const rect = row.getBoundingClientRect()
        const d =
          pointerY < rect.top
            ? rect.top - pointerY
            : pointerY > rect.bottom
              ? pointerY - rect.bottom
              : 0
        if (d < distance) {
          distance = d
          best = row
        }
      }
      return distance < 80 ? best : undefined
    }

    const follow = () => {
      const rect = element.getBoundingClientRect()
      const cell = {
        left: rect.left - dx,
        top: rect.top - dy,
        width: rect.width,
        height: rect.height,
      }
      dx = pointerX - grabX - cell.left
      dy = pointerY - grabY - cell.top
      element.style.transform = `translate(${dx}px, ${dy}px)`
      setTarget(across ? undefined : cell)
    }

    const restoreOwnRow = () => {
      if (order.join('\n') === current.join('\n')) return
      order = current
      slideSiblings(
        panelsIn(parent).map((o) => o.node),
        () => flushSync(() => edit.setLiveOrder(undefined)),
      )
    }

    const move = (e: PointerEvent) => {
      pointerX = e.clientX
      pointerY = e.clientY
      const row = rowUnderPointer()
      if (!row || row === parent) {
        across = undefined
        setCaret(undefined)
        const others = panelsIn(parent)
        const titles = others.map((o) => o.title)
        titles.splice(insertionIndex(others), 0, title)
        if (titles.join('\n') !== order.join('\n')) {
          order = titles
          slideSiblings(
            others.map((o) => o.node),
            () => flushSync(() => edit.setLiveOrder(titles)),
          )
        }
      } else {
        restoreOwnRow()
        const others = panelsIn(row)
        const index = insertionIndex(others)
        across = { row: Number(row.dataset.rowIndex), index }
        const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 12
        const anchor = others[index]?.rect ?? others[others.length - 1]?.rect
        if (anchor) {
          const x = others[index] ? anchor.left - gap / 2 : anchor.right + gap / 2
          setCaret({ left: x - 2, top: anchor.top, width: 4, height: anchor.height })
        }
      }
      follow()
    }

    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.body.classList.remove('odd-dragging')
      const carried = element.getBoundingClientRect()
      const before = snapshot()
      element.style.transform = ''
      const index = order.indexOf(title)
      flushSync(() => {
        if (across) edit.stage({ kind: 'move', title, row: across.row, index: across.index })
        else if (order.join('\n') !== current.join('\n'))
          edit.stage({ kind: 'move', title, row: rowIndex, index })
        edit.setLiveOrder(undefined)
        setTarget(undefined)
        setCaret(undefined)
        setDragging(false)
      })
      settle(before, { title, rect: carried })
    }

    setDragging(true)
    document.body.classList.add('odd-dragging')
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const locked = new Set(layout?.locked ?? [])
  const canReorder =
    enabled && Boolean(layout?.inRow) && rowIndex !== undefined && (edit.rows?.length ?? 0) > 0
  const order = edit.liveOrder?.includes(title)
    ? edit.liveOrder.indexOf(title)
    : edit.panels[title]?.order

  return {
    enabled,
    dragging,
    order,
    span: live?.span ?? span,
    height: live?.height ?? height,
    resizing: Boolean(live),
    grip: canReorder ? (
      <button
        type="button"
        className="odd-grip"
        aria-label={t('Drag to reorder {title}', { title })}
        title={t('Drag to reorder')}
        onPointerDown={startReorder}
      >
        <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
          {[3, 8, 13].map((y) => (
            <g key={y}>
              <circle cx="3" cy={y} r="1.3" fill="currentColor" />
              <circle cx="7" cy={y} r="1.3" fill="currentColor" />
            </g>
          ))}
        </svg>
      </button>
    ) : null,
    handles: enabled ? (
      <>
        {locked.has('span') ? null : (
          <span
            className="odd-handle odd-handle-e"
            onPointerDown={startResize('e')}
            aria-hidden="true"
          />
        )}
        {locked.has('height') ? null : (
          <span
            className="odd-handle odd-handle-s"
            onPointerDown={startResize('s')}
            aria-hidden="true"
          />
        )}
        {locked.has('span') || locked.has('height') ? null : (
          <span
            className="odd-handle odd-handle-se"
            onPointerDown={startResize('se')}
            aria-hidden="true"
          />
        )}
        {live ? (
          <span className="odd-size-badge">
            {live.span ?? span}/12 × {live.height ?? (height === 'auto' ? '—' : height)}
            {live.height !== undefined || height !== 'auto' ? 'px' : ''}
          </span>
        ) : null}
        {caret
          ? createPortal(
              <div
                className="odd-insert-caret"
                style={{
                  left: caret.left,
                  top: caret.top,
                  width: caret.width,
                  height: caret.height,
                }}
                aria-hidden="true"
              />,
              document.body,
            )
          : null}
        {target
          ? createPortal(
              <div
                className="odd-drop-target"
                data-kind={dragging ? 'move' : 'size'}
                style={{
                  left: target.left,
                  top: target.top,
                  width: target.width,
                  height: target.height,
                }}
                aria-hidden="true"
              />,
              document.body,
            )
          : null}
      </>
    ) : null,
  }
}

/**
 * A row's own grip, in edit mode: carry the whole row up or down among the
 * rows of the same section. A line between rows shows where it will land.
 */
export function useRowDrag(rowIndex: number | undefined) {
  const edit = useEdit()
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [line, setLine] = useState<Caret>()
  const row = rowIndex === undefined ? undefined : edit.rows?.[rowIndex]
  const siblings = row ? (edit.rows ?? []).filter((r) => r.parent === row.parent) : []
  const enabled = edit.editing && row !== undefined && siblings.length > 1

  const start = (event: ReactPointerEvent) => {
    const element = ref.current
    if (!element || rowIndex === undefined || !row) return
    event.preventDefault()
    const grabY = event.clientY - element.getBoundingClientRect().top
    let dy = 0
    let pointerY = event.clientY
    let to = rowIndex
    const others = () =>
      [...document.querySelectorAll<HTMLElement>(`.odd-row[data-row-parent="${row.parent}"]`)]
        .filter((node) => node !== element)
        .map((node) => ({
          node,
          index: Number(node.dataset.rowIndex),
          rect: node.getBoundingClientRect(),
        }))
        .sort((a, b) => a.rect.top - b.rect.top)

    const move = (e: PointerEvent) => {
      pointerY = e.clientY
      const rect = element.getBoundingClientRect()
      const top = rect.top - dy
      dy = pointerY - grabY - top
      element.style.transform = `translateY(${dy}px)`
      const list = others()
      let position = list.findIndex(({ rect: r }) => pointerY < r.top + r.height / 2)
      if (position === -1) position = list.length
      const slots = [...list.map((o) => o.index), rowIndex].sort((a, b) => a - b)
      to = slots[position] as number
      const anchor = list[position]?.rect
      const last = list[list.length - 1]?.rect
      const gap = 12
      const y = anchor ? anchor.top - gap / 2 : last ? last.bottom + gap / 2 : rect.top
      setLine({ left: rect.left, top: y - 2, width: rect.width, height: 4 })
    }

    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.body.classList.remove('odd-dragging')
      const carried = element.getBoundingClientRect()
      const before = snapshot()
      element.style.transform = ''
      flushSync(() => {
        if (to !== rowIndex) edit.stage({ kind: 'moveRow', from: rowIndex, to })
        setLine(undefined)
        setDragging(false)
      })
      if (reducedMotion()) return
      const firstTitle = row.titles[0]
      for (const node of document.querySelectorAll<HTMLElement>('[data-panel-title]')) {
        const title = node.dataset.panelTitle as string
        const first = before.get(`p:${title}`)
        if (!first) continue
        const shift = row.titles.includes(title)
          ? carried.top - (before.get(`p:${firstTitle}`)?.top ?? carried.top)
          : 0
        const last = node.getBoundingClientRect()
        const deltaY = first.top + shift - last.top
        if (Math.abs(deltaY) < 1) continue
        node.animate([{ transform: `translateY(${deltaY}px)` }, { transform: 'none' }], {
          duration: 260,
          easing: EASE,
        })
      }
    }

    setDragging(true)
    document.body.classList.add('odd-dragging')
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  return {
    ref,
    dragging,
    parent: row?.parent,
    grip: enabled ? (
      <>
        <button
          type="button"
          className="odd-row-grip"
          aria-label={t('Drag to move this row up or down')}
          title={t('Drag to move this row up or down')}
          onPointerDown={start}
        >
          <svg viewBox="0 0 16 10" width="16" height="10" aria-hidden="true">
            {[3, 8, 13].map((x) => (
              <g key={x}>
                <circle cx={x} cy="3" r="1.3" fill="currentColor" />
                <circle cx={x} cy="7" r="1.3" fill="currentColor" />
              </g>
            ))}
          </svg>
        </button>
        {line
          ? createPortal(
              <div
                className="odd-insert-caret odd-insert-line"
                style={{ left: line.left, top: line.top, width: line.width, height: line.height }}
                aria-hidden="true"
              />,
              document.body,
            )
          : null}
      </>
    ) : null,
  }
}
