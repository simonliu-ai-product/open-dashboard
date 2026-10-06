// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import type { Row } from '../config.js'
import { HostContext, type HostContextValue } from '../runtime/context.js'
import type { QueryRun } from '../runtime/types.js'
import { daysOff, Gantt, readTasks, startsTooEarly } from './gantt.js'

globalThis.ResizeObserver = class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 900, height: 400 } } as ResizeObserverEntry],
      this as never,
    )
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const PLAN: Row[] = [
  {
    id: 'spec',
    task: 'Spec',
    phase: 'Plan',
    start: '2026-10-05',
    end: '2026-10-07',
    after: null,
    done: 1,
  },
  {
    id: 'design',
    task: 'Design',
    phase: 'Plan',
    start: '2026-10-08',
    end: '2026-10-14',
    after: 'spec',
    done: 40,
  },
  {
    id: 'build',
    task: 'Build',
    phase: 'Make',
    start: '2026-10-12',
    end: '2026-10-23',
    after: 'design',
    done: 0,
  },
  {
    id: 'ship',
    task: 'Ship',
    phase: 'Make',
    start: '2026-10-26',
    end: null,
    after: 'build, qa',
    done: null,
  },
]

const CALENDAR: Row[] = [
  { date: '20261010', isHoliday: 1, description: '國慶日' },
  { date: '20261011', isHoliday: 1, description: '' },
  { date: '20261017', isHoliday: 0, description: '補行上班' },
]

const props = {
  title: 'Plan',
  query: 'plan',
  label: 'task',
  start: 'start',
  end: 'end',
  id: 'id',
  after: 'after',
  progress: 'done',
  group: 'phase',
  holidays: 'calendar',
}

function run(name: string, rows: Row[]): QueryRun {
  return {
    query: { name, source: 'db', sql: 'SELECT 1', file: 'q.sql', line: 1 },
    params: {},
    result: {
      columns: Object.keys(rows[0] as object).map((column) => ({
        name: column,
        type: 'string' as const,
      })),
      rows,
      truncated: false,
      elapsedMs: 1,
    },
  }
}

function host(): HostContextValue {
  return {
    id: 'test',
    meta: { title: 'Test' },
    tick: 0,
    refresh: () => {},
    inspect: () => {},
    onParams: () => {},
    fetchQuery: async (name: string) =>
      name === 'calendar' ? run(name, CALENDAR) : run(name, PLAN),
  } as HostContextValue
}

afterEach(cleanup)

describe('readTasks', () => {
  const { tasks, groups } = readTasks(PLAN, props)

  it('reads a date-only end as inclusive and a missing end as a milestone', () => {
    const spec = tasks[0]
    expect(spec && (spec.stop - spec.start) / 86_400_000).toBe(3)
    expect(tasks[3]?.milestone).toBe(true)
    expect(groups).toEqual(['Plan', 'Make'])
  })

  it('reads progress as a fraction or a percentage, and splits predecessors', () => {
    expect(tasks.map((task) => task.progress)).toEqual([1, 0.4, 0, undefined])
    expect(tasks[3]?.after).toEqual(['build', 'qa'])
  })

  it('flags a task that starts before its predecessor is done', () => {
    const [, design, build] = tasks
    expect(design && build && startsTooEarly(build, design)).toBe(true)
    expect(tasks[0] && design && startsTooEarly(design, tasks[0])).toBe(false)
  })

  it('lets a milestone fall on the last day of its predecessor', () => {
    const [spec, done] = readTasks(
      [
        { task: 'Spec', start: '2026-10-05', end: '2026-10-07' },
        { task: 'Signed off', start: '2026-10-07', end: null },
      ],
      props,
    ).tasks
    expect(spec && done && startsTooEarly(done, spec)).toBe(false)
  })
})

describe('daysOff', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00`).getTime()

  it('takes weekends off unless the calendar makes one a working day', () => {
    const calendar = daysOff(CALENDAR)
    expect(calendar.off(day('2026-10-09'))).toBe(false)
    expect(calendar.off(day('2026-10-10'))).toBe(true)
    expect(calendar.name(day('2026-10-10'))).toBe('國慶日')
    expect(calendar.off(day('2026-10-17'))).toBe(false)
    expect(calendar.off(day('2026-10-18'))).toBe(true)
  })

  it('falls back to weekends without a calendar', () => {
    const calendar = daysOff(undefined)
    expect(calendar.off(day('2026-10-10'))).toBe(true)
    expect(calendar.off(day('2026-10-12'))).toBe(false)
  })
})

describe('<Gantt>', () => {
  it('draws phases, bars, a milestone, links and the conflict', async () => {
    let container!: HTMLElement
    await act(async () => {
      container = render(
        <HostContext.Provider value={host()}>
          <Gantt {...props} />
        </HostContext.Provider>,
      ).container
    })
    expect(container.querySelectorAll('.odd-gantt-summary')).toHaveLength(2)
    expect(container.querySelectorAll('.odd-gantt-milestone')).toHaveLength(1)
    expect(container.querySelectorAll('.odd-gantt-link')).toHaveLength(3)
    expect(container.querySelectorAll('.odd-gantt-link.odd-gantt-late')).toHaveLength(1)
    expect(container.querySelector('.odd-gantt-holiday title')?.textContent).toBe('國慶日')
    expect(container.textContent).toContain('qa')
  })
})
