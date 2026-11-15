import type { QueryRun } from './types.js'

/**
 * The result each panel on the page last showed, by its element — what a
 * whole-dashboard download writes, a sheet per panel in page order. Held
 * weakly: a panel that leaves the page leaves the map.
 */
const runs = new WeakMap<Element, { title: string; run: QueryRun }>()

export function rememberRun(node: Element, title: string, run: QueryRun): void {
  runs.set(node, { title, run })
}

/** The panels under `root` that have rows to write, in the order they are on the page. */
export function panelRunsOn(root: ParentNode): { title: string; run: QueryRun }[] {
  return [...root.querySelectorAll('[data-panel-title]')]
    .map((node) => runs.get(node))
    .filter((entry): entry is { title: string; run: QueryRun } =>
      Boolean(entry?.run.result.columns.length),
    )
}
