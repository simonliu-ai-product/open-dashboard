import type { OpenDashboardConfig } from '@open-dashboard/core'

export default {
  datasources: {
    shop: { type: 'sqlite', file: 'data/shop.db' },
    marketing: { type: 'sqlite', file: 'data/marketing.db' },
  },
  defaultSource: 'shop',
} satisfies OpenDashboardConfig
