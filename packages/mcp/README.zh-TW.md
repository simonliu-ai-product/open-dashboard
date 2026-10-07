# @open-dashboard/mcp

[English](README.md) · **繁體中文**

open-dashboard workspace 的 MCP server。任何支援 Model Context Protocol 的 Agent 框架，都能列出、讀取、查詢、檢查與撰寫 Dashboard——而且它跑在開發伺服器上，Agent 一邊工作，瀏覽器裡的頁面就一邊自動更新。

```bash
pnpm add -D @open-dashboard/mcp
pnpm exec open-dashboard dev --mcp
```

```
  open-dashboard  http://localhost:5473/
  mcp: http://localhost:5473/mcp
```

讓用戶端連到 `http://localhost:5473/mcp`（Streamable HTTP）。每次呼叫都是獨立的，不需要建立 session，任何用戶端都能直接連線。

### 透過 stdio

用戶端會自己啟動 server 的情況（Claude Desktop、多數 Agent 框架），改用 `open-dashboard mcp`。不需要 dev server，同一組工具透過 stdin 與 stdout 提供。

```json
{
  "mcpServers": {
    "open-dashboard": {
      "command": "/path/to/workspace/node_modules/.bin/open-dashboard",
      "args": ["mcp", "--root", "/path/to/workspace"]
    }
  }
}
```

要 `run_sql` 就加上 `--allow-sql`。workspace 只在啟動時讀取一次：改了 `open-dashboard.config.ts` 之後請重新啟動用戶端。

## 工具

| 工具 | 用途 |
| --- | --- |
| `list_dashboards` | 所有 Dashboard：id、標題、面板與用到的查詢。從這裡開始。 |
| `read_dashboard` | 一張 Dashboard 的 `index.tsx` 與所有 `.sql` 檔，各附一個 hash。 |
| `write_dashboard_file` | 寫入 `index.tsx` 或 `<name>.sql`；新的 id 會建立新的 Dashboard。修改既有檔案要帶 `expected`。 |
| `check_dashboard` | 以篩選器的預設值執行所有查詢，並檢查每個面板。 |
| `run_query` | 像面板一樣，執行 Dashboard 裡某個已命名的查詢。 |
| `list_sources` | 所有資料來源、類型，以及是否連得上。 |
| `read_schema` | 資料來源的資料表、欄位、鍵與筆數。 |
| `read_database_doc` / `write_database_doc` | `databases/<source>/database.md`：資料的意義。 |
| `list_charts` | 內建面板，以及 `charts/` 下的自訂圖表。 |
| `list_themes` / `read_theme` / `write_theme` | `themes/` 下的主題，逐欄驗證。 |
| `list_comments` / `add_comment` | 留在面板上、等待處理的備註。 |
| `current_view` | 使用者正在檢視器裡看什麼：「這張 Dashboard」、「這張圖」指的是哪個。 |
| `list_collectors` / `run_collector` | 設定檔裡的收集器：上次執行的結果，以及立刻執行一個。 |
| `run_sql` | Agent 自己寫的唯讀 SQL——只有加上 `--allow-sql` 才會提供。 |

## 撰寫一張 Dashboard

1. `list_sources`，再對該資料來源 `read_schema` 與 `read_database_doc`。
2. `list_charts`——先用內建面板，沒有才自己寫。
3. 用 `write_dashboard_file` 寫入 `queries.sql`（已命名的查詢：`-- name: …`），再寫 `index.tsx`。
4. `check_dashboard`，修正它回報的問題。這時瀏覽器已經更新好了。

## 同時編輯

`read_dashboard`、`read_database_doc` 與 `read_theme` 會為每個檔案回傳 hash。修改既有檔案時要把它當作 `expected` 帶回來：如果檔案在這期間被改過——使用者在檢視器裡調整了版面，或另一個 Agent 寫入了——這次呼叫會以 `409` 拒絕，而不是覆蓋掉對方的修改。重新讀取後再套用一次即可。

## 自己寫 SQL：`--allow-sql`

檢視器從不送出 SQL——網頁只能點名寫在 `.sql` 檔裡的查詢。但 Agent 探索資料時需要更多彈性，所以 `open-dashboard dev --allow-sql`（會一併開啟 `--mcp`）會加上 `run_sql`：一個陳述式、任一資料來源、用該資料庫自己的語法。它和所有查詢一樣是唯讀的——SQLite 以唯讀開啟、Postgres 在 `READ ONLY` 交易中執行、沒有唯讀模式的引擎則檢查寫入關鍵字——所以 `DELETE`、`DROP` 會被驅動程式擋下。預設不開啟，因為開啟後，這個端點上的任何本機 Agent 都能讀取任何資料表。

## 安全

- **只接受本機連線。** 透過 HTTP 時，檢查 Host 與 Origin 標頭：其他網站的網頁無法操作這些工具（擋下 DNS rebinding），其他主機名稱的請求也會被拒絕。兩者都回 `403`，即使用 `open-dashboard dev --host` 把檢視器開放到網路上也一樣。
- **寫入範圍受限**於 `dashboards/<id>/index.tsx`、`dashboards/<id>/*.sql`、`databases/<source>/database.md` 與 `themes/<id>.json`；id 與檔名都會驗證，硬碟上的其他檔案一律寫不進去。
- **錯誤訊息會遮蔽**，和 open-dashboard 印出的所有訊息一樣：錯誤裡的連線字串或金鑰不會傳給 Agent。
- 這裡不驗證呼叫者的身分。要把端點開放到本機以外，需要在前面加一層會驗證身分的反向代理。

## 自行嵌入

一般情況用 `open-dashboard dev --mcp` 就夠了。要自己掛載的話，傳入你開啟的 workspace：

```ts
import { loadConfig, Workspace } from '@open-dashboard/core/node'
import { createOpenDashboardMcpMiddleware } from '@open-dashboard/mcp'

const workspace = new Workspace(await loadConfig(process.cwd()))
app.use('/mcp', createOpenDashboardMcpMiddleware({ workspace }))
```

`createOpenDashboardMcpHandler` 則回傳 Web 標準的 `{ fetch }` 形式，給接受 `Request`、回傳 `Response` 的執行環境使用。

## 授權

MIT
