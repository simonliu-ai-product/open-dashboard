import {
  AreaChart,
  BarChart,
  Dashboard,
  type DashboardMeta,
  Filters,
  LineChart,
  PieChart,
  Row,
  Select,
  Stat,
  Table,
  TimeRange,
} from '@open-database-dashboard/core'

export const meta: DashboardMeta = {
  title: 'Sales overview',
  refresh: '5m',
  currency: 'USD',
  createdAt: '2026-10-02T00:00:00.000Z',
}

export default function SalesOverview() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange default="90d" />
        <Select name="region" label="Region" query="regions" />
      </Filters>

      <Row>
        <Stat
          title="Revenue"
          query="kpis"
          column="revenue"
          compare="revenue_prev"
          format="currency"
          spark={{ query: 'daily_revenue', y: 'revenue' }}
        />
        <Stat
          title="Paid orders"
          query="kpis"
          column="orders"
          compare="orders_prev"
          format="integer"
        />
        <Stat
          title="Average order value"
          query="kpis"
          column="aov"
          compare="aov_prev"
          format="currency"
        />
        <Stat
          title="Refund rate"
          query="refund_rate"
          column="refund_rate"
          format="percent"
          invert
        />
      </Row>

      <Row height={320}>
        <LineChart
          title="Daily revenue"
          query="daily_revenue"
          x="day"
          y="revenue"
          format="currency"
          span={8}
        />
        <PieChart
          title="Revenue by category"
          query="revenue_by_category"
          label="category"
          value="revenue"
          format="currency"
          span={4}
        />
      </Row>

      <Row height={340}>
        <AreaChart
          title="Weekly revenue by channel"
          query="revenue_by_channel"
          x="week"
          y="revenue"
          series="channel"
          stacked
          format="currency"
          span={7}
        />
        <BarChart
          title="Top 10 products"
          query="top_products"
          x="product"
          y="revenue"
          format="currency"
          horizontal
          span={5}
        />
      </Row>

      <Row height={380}>
        <BarChart
          title="Revenue by region"
          query="revenue_by_region"
          drill="region"
          x="region"
          y="revenue"
          format="currency"
          span={4}
        />
        <Table
          title="Recent orders"
          query="recent_orders"
          columns={[
            { key: 'order_id', label: 'Order' },
            { key: 'ordered_at', label: 'Placed', format: 'text' },
            'customer',
            'region',
            'channel',
            'status',
            { key: 'total', format: 'currency' },
          ]}
          span={8}
        />
      </Row>
    </Dashboard>
  )
}
