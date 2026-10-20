# Host integration

`open-dashboard build` writes a static site. Any web server can serve it; a *host* is
a page that frames it and adds its own chrome — sharing, sign-in, a refresh of its
own. This is what a built page and its host may rely on of each other. It is part of
the public surface in [compatibility.md](compatibility.md).

## What a build contains

| File | What it holds |
| --- | --- |
| `index.html`, `d/<id>/index.html` | The viewer; each sets `window.__ODD_SNAPSHOT__ = { base, builtAt }` |
| `data/dashboards.json` | `{ builtAt, dashboards: [...] }` — each dashboard's `id`, `title`, `refresh` (its `meta.refresh`), `sources` and `freshness` |
| `data/d/<id>/<query>.json` | Every stored run of a query, by the filter values it reads |

`builtAt` is wall-clock time without a zone, in the workspace's `timeZone`, so a
reader anywhere sees the dates the build saw.

`freshness` groups the dashboard's sources: `live` (read when a query runs),
`collected` (as of the last collector run where the build was made) and `static`
(as committed). **Rebuilding brings newer data only when `live` is not empty** — a
host deciding whether to rebuild on a schedule, or while someone reads, decides it
from this.

## Embedding

A host that draws its own chrome around the page tells it so, and the page hides its
own sidebar and header:

- `window.__OPEN_X_HOST__ = { embed: true }` before the page's scripts run, or
- `data-open-x-embed` on the page's `<html>` element.

`?kiosk=1` does the same from a URL. (`__COSTAFF_HOST__` and `data-costaff-embed`, the
names this had first, still work.)

## A newer build

After a host has put a newer build at the same address, it posts to the frame:

```js
frame.contentWindow.postMessage({ type: 'open-x:data-updated' }, '*')
```

The page answers `{ type: 'open-x:data-updated:ack' }` to its parent, forgets the data
it read, reads `data/dashboards.json` again for the new `builtAt`, and has every panel
read its data again — the reader's filters, tab and scroll stay where they were. If
the new data cannot be read (an access key that has expired, say), the page reloads
itself.

A host that gets no answer within a moment is framing a page built before this
contract: it reloads the frame instead.

The page acts only on messages from its own parent window.

## Filter combinations a build did not store

`build` stores up to `--max-runs` runs per query. When a reader picks a combination
that was not stored, the page asks its host for
`data/__odd_query.json?id=<dashboard>&name=<query>&params=<json>` and shows that
result if the host answers. A host that cannot run queries answers 404 (a plain
static server does) and the panel says the combination is not in the snapshot.

To run them, a host needs what a default build never contains: `build --queryable`
also writes `data/d/<id>/_queries.json` (each query's SQL, compiled) and
`data/_sqlite/<source>.db` (a copy of each SQLite database the built dashboards
read). **That is your SQL and your whole database in the site.** Build with
`--queryable` only for a host that serves the site behind its own access control,
and never publish such a build to a public host.
