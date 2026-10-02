import {
  Dashboard,
  type DashboardMeta,
  Filters,
  Heatmap,
  Row,
  ScatterChart,
  Select,
  Table,
  TimeRange,
  Treemap,
} from '@open-dashboard/core'

export const meta: DashboardMeta = {
  title: '商品分析',
  locale: 'zh-TW',
  currency: 'USD',
  createdAt: '2026-10-02T00:00:00.000Z',
}

export default function ProductAnalysis() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange label="期間" default="12m" options={['90d', '6m', '12m', 'ytd', 'all']} />
        <Select name="category" label="分類" query="categories" />
      </Filters>

      <Row height={360}>
        <Treemap
          title="商品營收佔比"
          query="product_revenue"
          label="product"
          value="revenue"
          group="category"
          format="currency"
          span={7}
        />
        <ScatterChart
          title="售價與銷量"
          query="product_revenue"
          x="price"
          y="units"
          size="revenue"
          series="category"
          label="product"
          xFormat="currency"
          format="integer"
          span={5}
        />
      </Row>

      <Row height={300}>
        <Heatmap
          title="各分類每月營收"
          query="category_by_month"
          x="month"
          y="category"
          value="revenue"
          format="currency"
          drill={{ filter: 'category', column: 'category' }}
        />
      </Row>

      <Row height={420}>
        <Table
          title="商品明細"
          query="product_revenue"
          columns={[
            { key: 'product', label: '商品' },
            { key: 'category', label: '分類' },
            { key: 'price', label: '售價', format: 'currency' },
            { key: 'units', label: '銷量', format: 'integer' },
            { key: 'revenue', label: '營收', format: 'currency', bar: true },
          ]}
        />
      </Row>
    </Dashboard>
  )
}
