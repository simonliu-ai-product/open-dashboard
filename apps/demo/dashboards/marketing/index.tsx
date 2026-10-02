import {
  BarChart,
  Dashboard,
  type DashboardMeta,
  Filters,
  LineChart,
  Row,
  Stat,
  Table,
  TimeRange,
} from '@open-dashboard/core'

export const meta: DashboardMeta = {
  title: '行銷成效',
  locale: 'zh-TW',
  currency: 'USD',
  createdAt: '2026-10-02T00:00:00.000Z',
}

export default function Marketing() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange label="期間" default="90d" options={['30d', '90d', '6m', '12m']} />
      </Filters>

      <Row>
        <Stat title="廣告花費" query="totals" column="spend" format="currency" />
        <Stat title="付費通路帶來的營收" query="totals" column="revenue" format="currency" />
        <Stat title="ROAS" query="totals" column="roas" format={{ maximumFractionDigits: 2 }} />
      </Row>

      <Row height={320}>
        <BarChart
          title="各通路 ROAS"
          query="channel_return"
          x="channel"
          y="roas"
          format={{ maximumFractionDigits: 2 }}
          horizontal
          span={5}
        />
        <LineChart
          title="每週 ROAS"
          query="return_by_week"
          x="week"
          y="roas"
          series="channel"
          format={{ maximumFractionDigits: 1 }}
          span={7}
        />
      </Row>

      <Row height={240}>
        <Table
          title="各通路明細"
          query="channel_return"
          columns={[
            { key: 'channel', label: '通路' },
            { key: 'spend', label: '花費', format: 'currency' },
            { key: 'revenue', label: '營收', format: 'currency' },
            { key: 'roas', label: 'ROAS', format: { maximumFractionDigits: 2 } },
            { key: 'cost_per_customer', label: '每位新客成本', format: 'currency' },
          ]}
        />
      </Row>
    </Dashboard>
  )
}
