---
name: create-theme
description: Use this skill when the user wants dashboards to look different — brand colours, a company font, "red for up and green for down", softer corners, a darker page, "make the marketing dashboard match our deck" — or to change, rename or apply an existing theme under `themes/`. Covers writing `themes/<id>.json`, choosing which dashboards use it (`meta.theme`) and the workspace default (`theme` in the config). Do NOT use it for a chart that does not exist yet (`create-chart`), for a panel's layout or chart type (`dashboard-authoring`), or for what a chart shows.
---

# Create a theme

A theme is one JSON file, `themes/<id>.json`, that overrides the colours,
fonts and corner radius of the dashboards that use it. Every built-in panel
and every custom chart draws through the same variables, so a theme restyles
all of them without touching any chart.

The user can also edit themes by hand on the **Themes** page of the viewer
(`/themes`), with a live preview. Writing the file yourself is the same thing.

## Step 1 — Ask what it is for

One `AskUserQuestion` call, skipping what the user already said:

1. **Which colours** — brand colours (ask for the hex codes, or a brand guide);
   do not guess a company's colours from its name.
2. **Up and down** — green-up / red-down (the default), or red-up / green-down
   (the Taiwan, China and Japan market convention).
3. **Which dashboards** — one dashboard, several, or the workspace default.
4. **Dark mode** — tune it too, or leave the built-in dark palette.

## Step 2 — Write `themes/<id>.json`

`<id>`: kebab-case or plain letters/digits, e.g. `brand`, `finance-red`.

```json
{
  "name": "Brand",
  "font": "\"Noto Sans TC\", \"PingFang TC\", sans-serif",
  "mono": "\"JetBrains Mono\", ui-monospace, monospace",
  "radius": 6,
  "light": {
    "series": ["#1f4e9c", "#e0782e", "#2e9c6a", "#c9a227", "#9b59b6", "#16a2b8", "#7a4b2a", "#c0392b"],
    "accent": "#1f4e9c",
    "good": "#c62828",
    "bad": "#2e7d32",
    "page": "#f7f6f2",
    "surface": "#ffffff",
    "grid": "#e6e4dc"
  },
  "dark": {
    "series": ["#5b8dd9", "#f0965a", "#4fbf8a", "#e0bd4a", "#b884cf", "#3cc3d6", "#b08060", "#e06656"],
    "good": "#ef5350",
    "bad": "#66bb6a"
  }
}
```

Every field is optional; whatever is left out keeps the built-in value. The
file is validated field by field and anything else is refused, so stay inside
these:

| Field | Value |
| --- | --- |
| `name` | Text, at most 80 characters. Shown in the theme picker. |
| `font`, `mono` | A CSS font-family list: letters (any script — `"微軟正黑體"` is fine), digits, spaces, quotes, commas, dots, hyphens. No `;`, braces or brackets. End with a generic family (`sans-serif`, `monospace`). |
| `radius` | Panel corner radius in px, 0–24. The built-in is 10. |
| `light`, `dark` | Colours for that mode, each optional: |
| `series` | 1–8 colours, `#rgb` or `#rrggbb` — the chart palette, in order. |
| `accent` | Links, focus, the selected item. |
| `good`, `bad` | Up and down: deltas, status. Swap them for red-up markets. |
| `page`, `surface`, `grid` | Page background, panel background, gridlines. |

Text drawn on a coloured mark picks black or white by contrast on its own —
there is no field for it.

### Colour rules

The built-in palette is a validated order; a theme replaces it, so keep what
made it work:

- **Eight series colours that are easy to tell apart**, in the order a chart
  meets them: the first two or three carry most charts, so make those the most
  distinct. Never two near-identical hues side by side.
- **Mid-tone series colours.** Very light colours vanish on a white panel;
  very dark ones on a dark panel. Check both modes.
- **`good` and `bad` must differ in more than hue** (one lighter than the
  other) — they always appear with an arrow, but colour-blind readers still
  need them apart.
- **Backgrounds stay quiet.** `page` and `surface` close to white (light) or
  near-black (dark); the data is the colour on the page, not the chrome.
- If the user only gave light colours, leave `dark` out rather than inventing
  one — dark mode then keeps the built-in palette.

## Step 3 — Apply it

- **One dashboard:** add `theme: '<id>'` to its `meta`:

  ```tsx
  export const meta: DashboardMeta = { title: 'Marketing', theme: 'brand' }
  ```

  (The user can do the same from **Edit** mode: the theme menu in the header
  writes `meta.theme` on Save.)
- **Every dashboard by default:** `theme: '<id>'` in `open-dashboard.config.ts`.
  A dashboard's own `meta.theme` still wins.
- **Back to the built-in look:** remove `meta.theme` (and the config `theme`).

## Step 4 — Check it

Open `/themes/<id>` in the viewer: the preview draws a real dashboard with the
draft. Switch Light / Dark there. Then open each dashboard that uses it. If a
colour is refused, the page and the API name the field.

Tell the user which dashboards now use the theme, and that `themes/<id>.json`
can be edited on the Themes page from now on.
