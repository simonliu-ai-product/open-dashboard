import type { OpenDashboardConfig } from '@open-dashboard/core'

export default {
  datasources: {
    shop: { type: 'sqlite', file: 'data/shop.db' },
    marketing: { type: 'sqlite', file: 'data/marketing.db' },
  },
  defaultSource: 'shop',
  assistant: {
    provider: 'gemini',
    model: process.env.ASSISTANT_MODEL ?? '',
    apiKey: process.env.GEMINI_API_KEY,
  },
} satisfies OpenDashboardConfig
