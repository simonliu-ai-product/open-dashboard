import type { OpenDashboardConfig } from '@open-database-dashboard/core'

export default {
  datasources: {
    shop: { type: 'sqlite', file: 'data/shop.db' },
  },
} satisfies OpenDashboardConfig
