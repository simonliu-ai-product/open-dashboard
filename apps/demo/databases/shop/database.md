# shop

一家虛構的線上咖啡器材店，由 `scripts/seed.mjs` 產生：18 個月的訂單，結束在產生資料的那一刻。數字都是假的，只用來展示。

所有時間都是**當地時間的文字**（`YYYY-MM-DD HH:MM:SS`），沒有時區；直接用字串比較或 SQLite 的 `date()`、`strftime()`。

## 注意事項

- **營收** = `SUM(order_items.quantity * order_items.unit_price)`，只算 `orders.status = 'paid'`。`orders` 沒有總額欄位，運費（`shipping`）不算營收。
- 退款和取消的訂單仍然留在 `orders` 裡，用 `status` 排除。
- `orders.channel` 是**在哪裡下單**；`customers.acquisition_channel` 是**客人最初從哪裡來**。兩者不同，別混用。
- 每年 11 月 8–12 日有 85 折活動，`unit_price` 已經是折後價；要看定價用 `products.price`。
- 「今天」只到資料產生的時間為止，比較「今天 vs 昨天」要比同一時段。

## 資料表

### orders
一列一筆訂單。

- `status` — `paid`、`refunded`、`cancelled`，約 93% 是 paid。
- `channel` — `web`、`mobile`、`marketplace`：下單的地方。
- `region` — `North`、`Central`、`South`、`East`，取自下單客人的 `customers.region`。
- `shipping` — 小計滿 US$60 免運，否則 US$6。不是營收。

### order_items
一列一個商品明細，屬於某張訂單。

- `unit_price` — 實際成交單價（活動期間是折後價），不一定等於 `products.price`。

### products
16 項商品，5 個分類。

- `category` — `Brewing`、`Grinders`、`Espresso`、`Beans`、`Accessories`。
- `price` — 定價。
- `cost` — 進貨成本；毛利 = 成交價 − cost。

### customers
一列一位客人，以註冊時間建立。

- `acquisition_channel` — `organic`、`paid_search`、`social`、`referral`、`email`，和 `daily_traffic.source` 同一組值。
- `city` — 台灣 16 個縣市的英文名稱，座標在 `city_coordinates`。
- `signed_up_at` — 註冊時間。

### daily_traffic
每天每個來源一列。

- `source` — 和 `customers.acquisition_channel` 同一組值，可以直接 JOIN。
- `signups` — 當天由這個來源註冊的客人數。

### city_coordinates
16 個縣市的經緯度（真實座標），用 `city` 對應 `customers.city`。

### fulfillment_jobs
最近兩天已付款訂單的揀貨、包裝、出貨作業。

- `stage` — `pick`、`pack`、`ship`，依序進行。

### bean_prices
生豆每日價格（開、高、低、收），只有平日；和商品售價沒有關聯。

### service_checks
最近三天、每 10 分鐘一次的服務健康檢查，含幾段固定的故障與降級。

- `status` — `up`、`degraded`、`down`。
- `latency_ms` — `down` 時為 0。
