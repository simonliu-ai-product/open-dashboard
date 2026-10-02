import {
  BarChart,
  Dashboard,
  type DashboardMeta,
  Filters,
  Row,
  Select,
  Stat,
  Table,
} from '@open-database-dashboard/core'

export const meta: DashboardMeta = {
  title: '即時營運看板',
  description:
    '今天到目前為止的營收與訂單，跟昨天同一時間點比較。營收與訂單數只計已付款訂單；時間以伺服器本地時間為準。',
  refresh: '1m',
  locale: 'zh-TW',
  currency: 'USD',
  createdAt: '2026-10-02T00:00:00.000Z',
}

export default function LiveOps() {
  return (
    <Dashboard>
      <Filters>
        <Select
          name="days"
          label="每小時訂單量"
          options={[
            { value: '7', label: '過去 7 天' },
            { value: '14', label: '過去 14 天' },
          ]}
          default="7"
          allowAll={false}
        />
      </Filters>

      <Row>
        <Stat
          title="今日營收"
          query="today_vs_yesterday"
          column="revenue_today"
          compare="revenue_yesterday"
          compareLabel="vs 昨天同時段"
          format="currency"
        />
        <Stat
          title="今日訂單數"
          query="today_vs_yesterday"
          column="orders_today"
          compare="orders_yesterday"
          compareLabel="vs 昨天同時段"
          format="integer"
        />
        <Stat
          title="今日取消／退款"
          query="today_vs_yesterday"
          column="issues_today"
          compare="issues_yesterday"
          compareLabel="vs 昨天同時段"
          format="integer"
          invert
        />
      </Row>

      <Row height={320}>
        <BarChart
          title="每小時訂單量"
          description="依下單時間，每個整點一格；沒有訂單的時段為 0"
          query="hourly_orders"
          x="hour"
          y={['paid', 'cancelled_or_refunded']}
          labels={{ paid: '已付款', cancelled_or_refunded: '取消或退款' }}
          stacked
          format="integer"
        />
      </Row>

      <Row height={420}>
        <Table
          title="最近 50 筆訂單"
          query="recent_orders"
          columns={[
            { key: 'order_id', label: '訂單' },
            { key: 'ordered_at', label: '下單時間', format: 'text' },
            { key: 'customer', label: '客戶' },
            { key: 'channel', label: '通路' },
            { key: 'status', label: '狀態' },
            { key: 'total', label: '金額', format: 'currency' },
          ]}
          span={7}
        />
        <Table
          title="今天取消或退款的訂單"
          query="today_issues"
          columns={[
            { key: 'order_id', label: '訂單' },
            { key: 'time', label: '時間' },
            { key: 'status', label: '狀態' },
            { key: 'customer', label: '客戶' },
            { key: 'total', label: '金額', format: 'currency' },
          ]}
          span={5}
        />
      </Row>
    </Dashboard>
  )
}
