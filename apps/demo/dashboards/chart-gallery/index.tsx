import {
  BandChart,
  BoxPlot,
  BulletChart,
  BumpChart,
  CalendarHeatmap,
  Candlestick,
  ChoroplethMap,
  CohortTable,
  ControlChart,
  Dashboard,
  type DashboardMeta,
  DivergingBar,
  DotPlot,
  Dumbbell,
  EcdfChart,
  Filters,
  Histogram,
  HorizonChart,
  Marimekko,
  ParetoChart,
  PivotTable,
  Row,
  Sankey,
  Section,
  SlopeChart,
  SmallMultiples,
  StateTimeline,
  StripPlot,
  SymbolMap,
  TileMap,
  Timeline,
  TimeRange,
  UpSetChart,
  Waterfall,
} from '@open-database-dashboard/core'
import taiwan from './taiwan-counties.json'

export const meta: DashboardMeta = {
  title: '圖表展示',
  locale: 'zh-TW',
  currency: 'USD',
  createdAt: '2026-10-02T00:00:00.000Z',
}

export default function ChartGallery() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange label="期間" default="90d" options={['30d', '90d', '6m', '12m']} />
      </Filters>

      <Section title="比較與排名">
        <Row height={340}>
          <DotPlot
            title="各城市平均客單價"
            query="city_order_value"
            label="city"
            value="avg_order_value"
            format="currency"
            span={4}
          />
          <Dumbbell
            title="各區營收：上一期 → 本期"
            query="region_periods"
            label="region"
            from="previous"
            to="current"
            labels={{ from: '上一期', to: '本期' }}
            format="currency"
            span={4}
          />
          <SlopeChart
            title="各區營收的升降"
            query="region_periods"
            label="region"
            from="previous"
            to="current"
            labels={{ from: '上一期', to: '本期' }}
            format="currency"
            span={4}
          />
        </Row>
        <Row height={300}>
          <BulletChart
            title="各通路營收 vs. 目標"
            query="channel_targets"
            label="channel"
            value="revenue"
            target="target"
            bands={['poor', 'fair']}
            format="currency"
            span={4}
          />
          <DivergingBar
            title="各分類營收成長率"
            query="category_change"
            label="category"
            value="change"
            format="percent"
            span={4}
          />
          <Marimekko
            title="各區的通路組成"
            query="region_channel"
            x="region"
            series="channel"
            value="revenue"
            format="currency"
            span={4}
          />
        </Row>
        <Row height={320}>
          <BumpChart
            title="分類營收名次（近 12 個月）"
            query="category_by_month"
            x="month"
            series="category"
            value="revenue"
            format="currency"
            span={6}
          />
          <Waterfall
            title="營收從上一期到本期"
            query="revenue_bridge"
            label="step"
            value="change"
            type="kind"
            format="currency"
            span={6}
          />
        </Row>
      </Section>

      <Section title="隨時間變化">
        <Row height={240}>
          <CalendarHeatmap
            title="每日訂單數（近一年）"
            query="daily_orders"
            x="day"
            value="orders"
            format="integer"
          />
        </Row>
        <Row height={340}>
          <SmallMultiples
            title="各分類每週營收"
            query="category_by_week"
            x="week"
            y="revenue"
            series="category"
            kind="area"
            format="currency"
            span={6}
          />
          <BandChart
            title="每日營收（近 7 日平均與區間）"
            query="daily_revenue_band"
            x="day"
            y="avg_7d"
            low="low_7d"
            high="high_7d"
            format="currency"
            span={6}
          />
        </Row>
        <Row height={300}>
          <ControlChart
            title="每日退款率"
            query="daily_refund_rate"
            x="day"
            y="refund_rate"
            format="percent"
            span={6}
          />
          <HorizonChart
            title="各區每小時訂單（近 7 天）"
            query="hourly_orders_by_region"
            x="hour"
            series="region"
            y="orders"
            format="integer"
            span={6}
          />
        </Row>
        <Row height={340}>
          <Timeline
            title="最近 30 筆出貨作業"
            query="fulfillment_recent"
            label="worker"
            start="started_at"
            end="finished_at"
            series="stage"
            now
            span={6}
          />
          <Candlestick
            title="生豆每日價格"
            query="bean_prices"
            x="date"
            open="open"
            high="high"
            low="low"
            close="close"
            format="currency"
            span={6}
          />
        </Row>
      </Section>

      <Section title="分佈">
        <Row height={320}>
          <Histogram
            title="訂單金額分佈"
            query="order_values"
            value="order_value"
            format="currency"
            span={4}
          />
          <BoxPlot
            title="各通路的訂單金額"
            query="order_values"
            label="channel"
            value="order_value"
            format="currency"
            span={4}
          />
          <EcdfChart
            title="訂單金額累積分佈"
            query="order_values"
            value="order_value"
            series="channel"
            marks={[0.5, 0.9]}
            format="currency"
            span={4}
          />
        </Row>
        <Row height={300}>
          <StripPlot
            title="各分類的商品售價"
            query="product_prices"
            label="category"
            value="price"
            format="currency"
            span={4}
          />
          <ParetoChart
            title="營收集中在多少客人身上"
            query="customer_revenue"
            label="customer"
            value="revenue"
            format="currency"
            span={8}
          />
        </Row>
      </Section>

      <Section title="流向與組成">
        <Row height={380}>
          <Sankey
            title="從客人來源到下單通路，再到訂單結果"
            query="order_flow"
            source="source"
            target="target"
            value="orders"
            format="integer"
            span={7}
          />
          <UpSetChart
            title="客人在哪些分類組合下單"
            query="category_combinations"
            sets="categories"
            value="customers"
            format="integer"
            span={5}
          />
        </Row>
        <Row height={480}>
          <CohortTable
            title="註冊月份同期群：之後每月仍有下單的比例"
            query="signup_cohorts"
            cohort="cohort"
            period="period"
            value="active"
            size="customers"
          />
        </Row>
      </Section>

      <Section title="地圖">
        <Row height={460}>
          <ChoroplethMap
            title="各縣市營收"
            query="city_revenue"
            geo={taiwan}
            featureKey="name_en"
            region="city"
            value="revenue"
            format="currency"
            span={4}
          />
          <SymbolMap
            title="各城市營收（點大小）"
            query="city_revenue"
            lat="lat"
            lng="lng"
            size="revenue"
            label="city"
            series="region"
            geo={taiwan}
            format="currency"
            span={4}
          />
          <TileMap
            title="各縣市訂單數"
            query="city_revenue"
            region="city"
            value="orders"
            format="integer"
            span={4}
          />
        </Row>
      </Section>

      <Section title="狀態與表格">
        <Row height={260}>
          <StateTimeline
            title="服務健康狀態"
            query="service_status"
            x="checked_at"
            series="service"
            state="status"
            states={{ up: 'good', degraded: 'warning', down: 'critical' }}
          />
        </Row>
        <Row height={300}>
          <PivotTable
            title="各區 × 通路營收"
            query="region_channel"
            rows="region"
            columns="channel"
            value="revenue"
            format="currency"
            totals
            heat
          />
        </Row>
      </Section>
    </Dashboard>
  )
}
