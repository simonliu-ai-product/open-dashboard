import type { DatasourceConfig } from '../config.js'

export const MASK = '••••'

/**
 * Secrets reach text by two roads: a driver echoes its connection string in an
 * error, or our own message quotes a config value. Every string that leaves
 * the server — API responses, CLI output, logs — goes through `redact`, which
 * masks the secrets this workspace is configured with (exact values, also
 * URL-encoded) and anything shaped like a credential (URL userinfo, key=value
 * pairs, bearer tokens, private keys) whether or not it was configured.
 */
const known = new Set<string>()

/** Shorter than this, a "secret" would mask ordinary words in messages. */
const MIN_SECRET = 4

const SECRET_NAME = /pass(word|wd)?|pwd|secret|token|private[_-]?key|api[_-]?key|credential|auth/i
const SECRET_ENV = /pass|secret|token|key|credential|auth|dsn|_url$|database_url/i

function add(out: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return
  const text = value.trim()
  if (text.length < MIN_SECRET) return
  out.add(text)
}

/** The password inside `scheme://user:password@host`, if there is one. */
function urlPassword(value: string): string | undefined {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:([^\s@/]+)@/i.exec(value.trim())
  if (!match) return undefined
  try {
    return decodeURIComponent(match[1] as string)
  } catch {
    return match[1]
  }
}

/** `Password=…;` / `Pwd=…` in an ADO.NET or ODBC string. */
function keyValueSecrets(value: string): string[] {
  const out: string[] = []
  for (const m of value.matchAll(/(?:^|;)\s*(?:password|pwd)\s*=\s*("[^"]*"|'[^']*'|[^;]+)/gi)) {
    out.push((m[1] as string).replace(/^["']|["']$/g, ''))
  }
  return out
}

function walk(value: unknown, out: Set<string>, keyName = ''): void {
  if (typeof value === 'string') {
    if (SECRET_NAME.test(keyName)) add(out, value)
    const password = urlPassword(value)
    if (password) add(out, password)
    for (const secret of keyValueSecrets(value)) add(out, secret)
    // DuckDB: CREATE SECRET (KEY_ID 'x', SECRET 'y'), and similar in init statements.
    for (const m of value.matchAll(
      /\b(?:secret|key_id|session_token|token|password)\s+'([^']+)'/gi,
    )) {
      add(out, m[1])
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, out, keyName)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) walk(inner, out, key)
  }
}

/** The secret values in a set of datasource configs. */
export function secretsOf(datasources: Record<string, DatasourceConfig>): string[] {
  const out = new Set<string>()
  walk(datasources, out)
  return [...out]
}

/** Secret-looking environment variables: their passwords, or the whole value when it is not a URL. */
export function secretsInEnv(env: NodeJS.ProcessEnv): string[] {
  const out = new Set<string>()
  for (const [name, value] of Object.entries(env)) {
    if (!value || !SECRET_ENV.test(name)) continue
    const password = urlPassword(value)
    if (password) add(out, password)
    else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      for (const secret of keyValueSecrets(value)) add(out, secret)
      // A whole value only when it looks like a credential: long enough, not
      // a path, not a sentence — `NO_AUTH=true` must not mask every "true".
      if (
        value.length >= 8 &&
        !/[\s=;]/.test(value) &&
        !/^[./~]/.test(value) &&
        !/^(true|false|yes|no|on|off|\d+)$/i.test(value)
      )
        add(out, value)
    }
  }
  return [...out]
}

/** Replace the set of known secrets — called whenever the config is (re)loaded. */
export function registerSecrets(values: Iterable<string>): void {
  known.clear()
  for (const value of values) add(known, value)
}

const PATTERNS: [RegExp, string][] = [
  // -----BEGIN … PRIVATE KEY----- … -----END … PRIVATE KEY-----
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, MASK],
  // scheme://user:password@host
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@/]+@/gi, `$1${MASK}@`],
  // "password": "…" in JSON
  [
    /("(?:password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|private_key|api_?key)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
    `$1"${MASK}"`,
  ],
  // password=…  Pwd=…;  token: …  in connection strings, query strings and messages
  [
    /\b(password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|api_?key|sslpassword)(\s*[=:]\s*)(?!["']?••••)("[^"]*"|'[^']*'|[^\s;&,"')]+)/gi,
    `$1$2${MASK}`,
  ],
  // Authorization: Bearer …
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${MASK}`],
]

export function redact(text: string): string {
  if (!text) return text
  let out = text
  // Longest first, so a secret that contains another is masked whole.
  for (const secret of [...known].sort((a, b) => b.length - a.length)) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      if (out.includes(form)) out = out.split(form).join(MASK)
    }
  }
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
  return out
}

/**
 * Deep-redacts every string in a JSON-like value — for error payloads and
 * reports. Never for query results: the user's own data is shown as it is.
 */
export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map(redactValue) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, redactValue(inner)]),
    ) as T
  }
  return value
}
