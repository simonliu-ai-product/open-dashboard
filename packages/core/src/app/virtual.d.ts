declare module 'virtual:open-dashboard/manifest' {
  export const dashboards: {
    id: string
    load: () => Promise<{ default: unknown; meta?: import('../runtime/types.js').DashboardMeta }>
  }[]
}

interface ImportMeta {
  readonly hot?: {
    on(event: string, callback: (data: unknown) => void): void
    off?(event: string, callback: (data: unknown) => void): void
  }
}
