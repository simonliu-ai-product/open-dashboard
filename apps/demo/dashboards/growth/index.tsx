import {
  AreaChart,
  BarChart,
  Dashboard,
  type DashboardMeta,
  Filters,
  Row,
  Stat,
  Table,
  Text,
  TimeRange,
} from '@open-database-dashboard/core'

export const meta: DashboardMeta = {
  title: '成長與流量',
  description: '各來源的流量、註冊與轉換，以及新舊客的訂單結構。',
  locale: 'zh-TW',
  currency: 'USD',
  createdAt: '2026-10-02T00:00:00.000Z',
}

export default function Growth() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange label="期間" default="6m" options={['30d', '90d', '6m', '12m', 'ytd', 'all']} />
      </Filters>

      <Row>
        <Stat title="工作階段" query="funnel_totals" column="sessions" format="compact" />
        <Stat title="註冊數" query="funnel_totals" column="signups" format="integer" />
        <Stat title="付款訂單" query="funnel_totals" column="orders" format="integer" />
        <Stat
          title="訂單轉換率"
          description="付款訂單 ÷ 工作階段"
          query="funnel_totals"
          column="conversion"
          format="percent"
        />
      </Row>

      <Row height={320}>
        <AreaChart
          title="每週流量（依來源）"
          query="traffic_by_source"
          x="week"
          y="sessions"
          series="source"
          stacked
          format="compact"
          span={7}
        />
        <BarChart
          title="新客與回購訂單"
          query="new_vs_returning"
          x="month"
          y={['new_customers', 'returning_customers']}
          labels={{ new_customers: '新客', returning_customers: '回購' }}
          stacked
          format="integer"
          span={5}
        />
      </Row>

      <Row height={300}>
        <Table
          title="各獲客管道的客戶品質"
          query="channel_quality"
          columns={[
            { key: 'channel', label: '管道' },
            { key: 'customers', label: '新註冊', format: 'integer' },
            { key: 'buyers', label: '已購買', format: 'integer' },
            { key: 'buyer_rate', label: '購買率', format: 'percent', bar: true },
            { key: 'revenue_per_customer', label: '每位客戶營收', format: 'currency' },
          ]}
          span={8}
        />
        <Text title="指標定義" span={4}>
          <p>
            <strong>訂單轉換率</strong>：期間內付款訂單數除以工作階段數，不排除同一位客戶多次下單。
          </p>
          <p>
            <strong>新客</strong>：該客戶的第一筆付款訂單；之後的訂單都算<strong>回購</strong>。
          </p>
          <p>流量資料來自 daily_traffic，每日依來源彙總。</p>
        </Text>
      </Row>
    </Dashboard>
  )
}
