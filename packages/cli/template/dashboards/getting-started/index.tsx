import {
  BarChart,
  Dashboard,
  type DashboardMeta,
  Filters,
  LineChart,
  PieChart,
  Row,
  Stat,
  Table,
  Text,
  TimeRange,
} from '@open-database-dashboard/core'

export const meta: DashboardMeta = {
  title: 'Getting started',
}

export default function GettingStarted() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange default="90d" />
      </Filters>

      <Row>
        <Stat title="Revenue" query="totals" column="revenue" format="currency" />
        <Stat title="Orders" query="totals" column="orders" format="integer" />
        <Stat title="Average order" query="totals" column="average_order" format="currency" />
      </Row>

      <Row height={300}>
        <LineChart title="Revenue by week" query="revenue_by_week" x="week" y="revenue" format="currency" span={8} />
        <PieChart title="By category" query="revenue_by_category" label="category" value="revenue" format="currency" span={4} />
      </Row>

      <Row height={300}>
        <BarChart title="Products by revenue" query="top_products" x="product" y="revenue" format="currency" horizontal span={6} />
        <Text title="What next" span={6}>
          <p>
            Every panel here is a named query in <code>dashboards/getting-started/queries.sql</code> and one line of
            JSX in <code>index.tsx</code>.
          </p>
          <p>Ask your agent:</p>
          <ul>
            <li>
              <code>/connect-database</code> to point this workspace at your own database
            </li>
            <li>
              <code>/create-dashboard</code> and describe what you want to see
            </li>
          </ul>
          <p>Hover a panel and open the inspector to see its SQL and rows, or leave a note for your agent.</p>
        </Text>
      </Row>

      <Table title="Product breakdown" query="top_products" columns={['product', { key: 'orders', format: 'integer' }, { key: 'revenue', format: 'currency', bar: true }]} height={300} />
    </Dashboard>
  )
}
