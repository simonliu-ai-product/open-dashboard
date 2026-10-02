# marketing

同一家虛構商店的廣告花費，放在另一個資料庫，用來示範跨資料庫查詢（`-- uses:`）。由 `scripts/seed.mjs` 根據 `shop.daily_traffic` 產生。

## 注意事項

- 只有付費通路：`paid_search`、`social`、`email`。`organic` 和 `referral` 沒有花費，JOIN 時用 LEFT JOIN 從花費這邊出發。
- `channel` 的值和 shop 的 `customers.acquisition_channel` 相同，可以直接對應。

## 資料表

### ad_spend
每天每個通路一列。

- `date` — `YYYY-MM-DD` 文字。
- `spend` — 當天花費（美元）。
- `clicks` — 廣告點擊數。
