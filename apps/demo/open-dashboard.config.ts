import type { OpenDashboardConfig } from '@open-dashboard/core'

export default {
  datasources: {
    shop: { type: 'sqlite', file: 'data/shop.db' },
    marketing: { type: 'sqlite', file: 'data/marketing.db' },
  },
  defaultSource: 'shop',
  // The fictional data ends today: regenerate it once the day moves on.
  collectors: {
    seed: { run: 'node scripts/seed.mjs --if-stale', every: '1h', source: 'shop' },
  },
  assistant: {
    provider: 'gemini',
    model: process.env.ASSISTANT_MODEL ?? '',
    apiKey: process.env.GEMINI_API_KEY,
    reasoningEffort: process.env.ASSISTANT_REASONING_EFFORT,
  },
} satisfies OpenDashboardConfig
