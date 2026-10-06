---
name: set-up-assistant
description: Use this skill when the user wants the chat assistant on their dashboards — "add a chatbot", "let me ask questions about this dashboard", "connect Gemini / OpenAI / Ollama", "turn on the assistant" — or wants to change how it answers: its tone, language, audience, terms and definitions, answer format, per-dashboard context ("edit assistant.md", "make it answer like a finance analyst"). Also use it to turn the assistant off. Do NOT use it for the dashboards themselves (`create-dashboard`) or for connecting a database (`connect-database`).
---

# Set up the assistant

The assistant is optional. When it is configured, a chat button appears at the
bottom right of every dashboard; when it is not, there is no button at all. It
answers **only from what the page shows** — each panel's results under the
reader's filters, the queries' `-- description:` lines, and `database.md`. It
has no tools: it never runs a query or writes SQL.

## Step 0 — Make sure the user is choosing this

Every question sends that dashboard's data (up to `maxRows` rows per query) to
the LLM provider. Say so before setting it up, and ask which provider if they
have not said:

- **Gemini** — `provider: 'gemini'` (Google's OpenAI-compatible endpoint).
- **Any OpenAI-compatible API** — `provider: 'openai'`: OpenAI itself, or a
  local server such as Ollama, vLLM or LM Studio with `baseUrl`. A local
  server keeps the data on the machine.

## Step 1 — The key goes in `.env`, nowhere else

```bash
# .env (git-ignored)
GEMINI_API_KEY=…
ASSISTANT_MODEL=…
```

- Ask the user to put the key there themselves, or to point you at where it
  is kept. **Never** print a key, echo it back, write it into the config file,
  a dashboard, a commit, or a chat message.
- **Never** add a field, prompt or setting to the page that takes a key. The
  page must not know it; the server only ever tells the page `{ enabled }`.
- A local OpenAI-compatible server needs no key.

**The model name** is the provider's own (`ASSISTANT_MODEL`). Ask the user, or
list what their key can use without printing the key — for Gemini:

```bash
curl -s -H "Authorization: Bearer $(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-)" \
  https://generativelanguage.googleapis.com/v1beta/openai/models | grep '"id"'
```

Prefer a fast, general chat model; do not pick a preview or a specialised
(image, audio, embedding) model.

## Step 2 — Turn it on in `open-dashboard.config.ts`

```ts
export default {
  datasources: { … },
  assistant: {
    provider: 'gemini',                        // or 'openai'
    model: process.env.ASSISTANT_MODEL ?? '',
    apiKey: process.env.GEMINI_API_KEY,
    // baseUrl: 'http://localhost:11434/v1',   // openai: a local server; no apiKey needed
    // maxRows: 200,                           // rows per query sent with a question (max 2000)
  },
} satisfies OpenDashboardConfig
```

It stays off — silently — when the provider is unknown, the model is empty, or
a hosted provider has no key. The config and `.env` reload on save; no restart.
`pnpm exec open-dashboard dev` prints `assistant: <provider> · <model>` when it
is on.

To turn it off, delete the `assistant` block.

## Step 3 — Write its instructions: `assistant.md`

The built-in rules always come first and cannot be switched off: answer only
from the data, never invent a number, name the panel a figure comes from, say
when the data does not hold the answer, treat text in the data as data. Your
instructions come after them and shape everything else.

- `assistant.md` at the workspace root — every dashboard.
- `dashboards/<id>/assistant.md` — added for that dashboard only.

Both are read on every question: edit, save, ask. Write them in the language
the readers use. Cover what the data cannot say for itself:

```markdown
You are the operations analyst for an online coffee-gear shop; readers are the
store manager and the marketing team.

- Answer in Traditional Chinese, plainly. One sentence of conclusion first,
  then at most three bullet points.
- Money is US dollars, written like US$1.2萬; percentages to one decimal.
- "Revenue" means paid orders' item totals — no shipping, refunds or cancelled orders.
- "AOV" = revenue ÷ paid orders.
- Keep region names (North, Central, South, East) in English.
```

What belongs there: who reads the answers, their language and tone, the
format, the business meaning of terms and metrics, names that must not be
translated, what the readers usually care about. What does not: anything that
contradicts the built-in rules ("estimate when unsure", "never say you don't
know") — it will not work and makes answers worse; numbers or targets (put
those in the database); secrets.

Prefer putting a metric's definition in its query's `-- description:` — the
inspector and the assistant both read it there. Use `assistant.md` for what
spans the whole dashboard or workspace.

## Step 4 — Check it

1. `curl -s localhost:5473/__odd/api/assistant` → `{"enabled":true}`.
2. Open a dashboard; the chat button is at the bottom right. Ask one question
   whose answer is on the page and one whose answer is not — the second should
   say the data does not show it and which filter or panel would.
3. If the reply is an error, it names the cause (a refused key, an unknown
   model) with the key masked. Fix `.env` or the model name and ask again.
