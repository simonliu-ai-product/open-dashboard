# open-database-dashboard

**說出你想看的 Dashboard，Coding Agent 就幫你在自己的資料庫上把它做出來，而且是即時的。**

[English](README.md)

![用 open-dashboard 做出來的銷售 Dashboard](.github/assets/screenshot.png)

Grafana、Superset 要你自己一格一格拖拉組出 Dashboard；open-dashboard 反過來：你跟
Claude Code（或任何 Coding Agent）說「我要看每月營收、前十名商品、各區訂單，還要能依
區域篩選」，它就把 SQL 和面板寫進你的 workspace，畫面隨著它寫的內容即時熱更新。

設計思路跟 open-slide、open-doc、open-sheet 一致：產出物是 Agent 擅長撰寫的純文字檔，
框架負責渲染，每個 workspace 都附上 Skills，教 Agent 整套工作流程。

## 快速開始

```bash
npx @open-database-dashboard/cli init my-dashboards
cd my-dashboards
pnpm install
pnpm dev                     # http://localhost:5473
```

內附一個範例 SQLite 資料庫與「Getting started」Dashboard。接著在 Agent 裡輸入：

```
/connect-database  連到 .env 裡 WAREHOUSE_URL 的 Postgres
/create-dashboard  每週各方案的註冊數、MRR 趨勢，以及用量最高的 20 個帳號
```

## 一個 Dashboard 長什麼樣子

```
dashboards/sales-overview/
  queries.sql     具名 SQL，任何 SQL 工具都能直接跑
  index.tsx       有哪些面板、順序、各自顯示哪些欄位
```

- **SQL 放在 `.sql` 檔**，用 `-- name:` 命名；面板只用名稱引用查詢。
- **篩選器**：`<TimeRange>` 綁定 `:from`／`:to`，`<Select name="region">` 綁定
  `:region`（選「全部」時為 NULL）；篩選值會寫進網址，篩過的畫面可以直接分享連結。
- **面板**：`Stat`（含與前一期比較、迷你趨勢線）、`LineChart`、`AreaChart`、
  `BarChart`（分組／堆疊／橫向）、`PieChart`（甜甜圈）、`Table`（可排序、欄內長條）、`Text`。
- 12 欄格線版面、淺色／深色主題、自動重新整理、`meta.locale` 支援 `zh-TW` 數字與日期格式。

## 工作循環

1. **Agent 探索資料**：`open-dashboard schema` 列出所有資料表、欄位、主外鍵與筆數；
   `open-dashboard query "SELECT …"` 看真實資料與欄位型別。
2. **Agent 撰寫** `queries.sql` 與 `index.tsx`，畫面即時更新。
3. **Agent 自我驗證**：`open-dashboard check` 用預設篩選值實際跑過每一支查詢，
   SQL 錯誤、引用不存在的查詢、沒有篩選器提供的參數、面板指定了查詢結果裡沒有的欄位，
   都會直接報錯。
4. **你來檢視**：滑過面板打開 Inspector，可以看到 SQL、參數、資料列與耗時；
   在「Note for your agent」寫下「這張改成依通路拆開」，備註會直接寫進原始碼、
   放在該面板旁邊，再請 Agent `/apply-comments` 套用。

## 支援的資料庫

| `type` | 資料庫 | 安裝 | 同時涵蓋 |
| --- | --- | --- | --- |
| `sqlite` | SQLite | Node 22.13+ 內建 | |
| `postgres` | PostgreSQL | `pnpm add pg` | Supabase、Neon、RDS/Aurora、Cloud SQL、AlloyDB、Redshift、CockroachDB、TimescaleDB |
| `mysql` | MySQL | `pnpm add mysql2` | MariaDB、PlanetScale、TiDB、RDS/Aurora |
| `mssql` | SQL Server | `pnpm add mssql` | Azure SQL Database／Managed Instance |
| `oracle` | Oracle | `pnpm add oracledb` | Autonomous Database（thin 模式，不需 Instant Client） |
| `duckdb` | DuckDB | `pnpm add @duckdb/node-api` | 直接查詢 Parquet、CSV、JSON 檔 |
| `clickhouse` | ClickHouse | `pnpm add @clickhouse/client` | ClickHouse Cloud |
| `bigquery` | BigQuery | `pnpm add @google-cloud/bigquery` | |
| `snowflake` | Snowflake | `pnpm add snowflake-sdk` | |

`open-dashboard drivers` 會列出每一種的設定範例。連線密碼放在 `.env`（已列入 `.gitignore`），
修改設定檔或 `.env` 不需要重啟 dev server。除了 BigQuery 與 Snowflake 之外，每個引擎都有
跨資料庫一致性測試對真實伺服器驗證；這兩個雲端服務則以模擬的 SDK 測試。

## 安全性

- **瀏覽器永遠不會送出 SQL**：它只能要求「執行 dashboard `y` 的查詢 `x`」，
  伺服器執行的是硬碟上的檔案內容，沒有任何接受原始 SQL 的 API。
- **所有查詢都是唯讀**，各引擎採用它能提供的最強方式：唯讀開檔（SQLite、DuckDB）、
  `READ ONLY` 交易（Postgres、Oracle、MySQL）、`readonly=2`（ClickHouse）、先 dry-run
  確認是 SELECT（BigQuery）。DDL 會隱式 commit 或根本沒有唯讀交易的引擎（MySQL、Oracle、
  SQL Server、Snowflake、DuckDB），另外要求查詢必須是單一 SELECT。仍建議使用唯讀的資料庫
  帳號，`/connect-database` 會提供各引擎的授權語法。
- **BigQuery 有花費上限**：預估掃描量超過 `maximumBytesBilled`（預設 10 GiB）的查詢會在
  執行前就被拒絕。
- **參數一律綁定**，不會字串拼接。
- 查詢結果有筆數上限（預設 5,000 筆），請在 SQL 裡先彙總。

## 隨 workspace 附上的 Skills

| Skill | 用途 |
| --- | --- |
| `/connect-database` | 新增資料來源、`.env`、安裝驅動，並用 `sources`＋`schema` 驗證 |
| `/create-dashboard` | 探索資料 → 確認指標定義 → 寫查詢 → 組面板 → `check` |
| `/dashboard-authoring` | 技術參考：查詢檔格式、參數、所有元件、格式、各資料庫 SQL 方言 |
| `/current-dashboard` | 從 viewer 目前畫面判斷「這張圖」指的是哪個面板 |
| `/apply-comments` | 套用你在 Inspector 留下的備註 |

## 開發

```bash
mise install && pnpm install
pnpm dev        # 以種子資料產生的 SQLite 電商資料跑 demo，port 5473
pnpm test && pnpm typecheck && pnpm check
```

架構與不變量請見 [CLAUDE.md](CLAUDE.md)。

## 授權

MIT
