#!/usr/bin/env node
// Builds data/shop.db: a fictional online coffee-gear store, ending today.
// Deterministic for a given end date, so screenshots and checks are repeatable.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, '..', 'data', 'shop.db')

const pad = (n) => String(n).padStart(2, '0')
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (d) => `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

if (process.argv.includes('--if-missing') && existsSync(file)) process.exit(0)

// The data ends on the day it was generated; a live board over yesterday's
// file would show an empty "today". Regenerate once the day has moved on.
if (process.argv.includes('--if-stale') && existsSync(file)) {
  const existing = new DatabaseSync(file, { readOnly: true })
  const last = existing.prepare('SELECT max(ordered_at) AS last FROM orders').get()?.last
  existing.close()
  if (typeof last === 'string' && last.slice(0, 10) === day(new Date())) process.exit(0)
}

mkdirSync(dirname(file), { recursive: true })
rmSync(file, { force: true })

let seed = 20260101
const random = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (items, weights) => {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = random() * total
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

// Orders through the day: quiet overnight, a lunch bump, the evening peak.
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const HOUR_WEIGHTS = [
  2, 1, 0.6, 0.4, 0.3, 0.4, 0.8, 1.6, 2.6, 3.4, 4, 4.4, 5.2, 5, 4.2, 3.8, 3.8, 4.2, 5, 6.2, 7.2,
  7.6, 6, 3.8,
]

const db = new DatabaseSync(file)
db.exec(`
  PRAGMA journal_mode = DELETE;
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    cost REAL NOT NULL
  );
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    region TEXT NOT NULL,
    city TEXT NOT NULL,
    acquisition_channel TEXT NOT NULL,
    signed_up_at TEXT NOT NULL
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    ordered_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('paid', 'refunded', 'cancelled')),
    channel TEXT NOT NULL,
    region TEXT NOT NULL,
    shipping REAL NOT NULL
  );
  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL
  );
  CREATE TABLE daily_traffic (
    date TEXT NOT NULL,
    source TEXT NOT NULL,
    sessions INTEGER NOT NULL,
    signups INTEGER NOT NULL,
    PRIMARY KEY (date, source)
  );
  CREATE INDEX orders_ordered_at ON orders(ordered_at);
  CREATE INDEX order_items_order ON order_items(order_id);
`)

const products = [
  ['Pour-over Kettle', 'Brewing', 69, 28],
  ['Ceramic Dripper', 'Brewing', 29, 9],
  ['Glass Server 600ml', 'Brewing', 24, 8],
  ['French Press', 'Brewing', 39, 14],
  ['Burr Grinder Pro', 'Grinders', 249, 120],
  ['Hand Grinder', 'Grinders', 119, 52],
  ['Espresso Machine S1', 'Espresso', 899, 520],
  ['Milk Pitcher', 'Espresso', 22, 7],
  ['Tamper 58mm', 'Espresso', 45, 15],
  ['Ethiopia Yirgacheffe 250g', 'Beans', 19, 8],
  ['Colombia Huila 250g', 'Beans', 17, 7],
  ['House Espresso Blend 1kg', 'Beans', 42, 19],
  ['Taiwan Alishan 200g', 'Beans', 28, 13],
  ['Paper Filters (100)', 'Accessories', 8, 2],
  ['Digital Scale', 'Accessories', 49, 18],
  ['Travel Mug', 'Accessories', 32, 11],
]
const productWeights = [5, 9, 6, 6, 2, 3, 0.6, 4, 2, 14, 12, 10, 7, 16, 5, 6]
const insertProduct = db.prepare(
  'INSERT INTO products (id, name, category, price, cost) VALUES (?, ?, ?, ?, ?)',
)
for (const [i, [name, category, price, cost]] of products.entries()) {
  insertProduct.run(i + 1, name, category, price, cost)
}

const regions = {
  North: ['Taipei', 'New Taipei', 'Taoyuan', 'Keelung', 'Hsinchu'],
  Central: ['Taichung', 'Changhua', 'Nantou', 'Miaoli'],
  South: ['Kaohsiung', 'Tainan', 'Chiayi', 'Pingtung'],
  East: ['Hualien', 'Taitung', 'Yilan'],
}
const regionNames = Object.keys(regions)
const regionWeights = [46, 24, 24, 6]
const channels = ['web', 'mobile', 'marketplace']
const acquisition = ['organic', 'paid_search', 'social', 'referral', 'email']
const first = [
  'Mei',
  'Wei',
  'Yu',
  'Chen',
  'Hao',
  'Ting',
  'Jun',
  'Lin',
  'Hsin',
  'Kai',
  'Ann',
  'Ray',
  'Iris',
  'Leo',
  'Nina',
  'Owen',
]
const last = [
  'Chen',
  'Lin',
  'Huang',
  'Chang',
  'Lee',
  'Wang',
  'Wu',
  'Liu',
  'Tsai',
  'Yang',
  'Hsu',
  'Cheng',
]

const end = new Date()
end.setHours(0, 0, 0, 0)
const start = new Date(end)
start.setMonth(start.getMonth() - 18)
const totalDays = Math.round((end - start) / 86_400_000)

const insertCustomer = db.prepare(
  'INSERT INTO customers (id, name, email, region, city, acquisition_channel, signed_up_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
)
const insertOrder = db.prepare(
  'INSERT INTO orders (id, customer_id, ordered_at, status, channel, region, shipping) VALUES (?, ?, ?, ?, ?, ?, ?)',
)
const insertItem = db.prepare(
  'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
)
const insertTraffic = db.prepare(
  'INSERT INTO daily_traffic (date, source, sessions, signups) VALUES (?, ?, ?, ?)',
)

const customers = []
let orderId = 0

db.exec('BEGIN')
for (let d = 0; d <= totalDays; d += 1) {
  const date = new Date(start)
  date.setDate(start.getDate() + d)
  const progress = d / totalDays
  const growth = 1 + progress * 0.9
  const weekday = date.getDay()
  const weekly = weekday === 0 || weekday === 6 ? 1.25 : 1
  const month = date.getMonth()
  const seasonal =
    month === 10 ? 1.45 : month === 11 ? 1.6 : month === 0 ? 1.15 : month === 6 ? 0.85 : 1
  const demand = growth * weekly * seasonal

  for (const [s, source] of acquisition.entries()) {
    const base = [520, 300, 260, 110, 140][s] * demand * (0.85 + random() * 0.3)
    const sessions = Math.round(base)
    const signups = Math.round(sessions * (0.004 + random() * 0.004))
    insertTraffic.run(day(date), source, sessions, signups)
    for (let k = 0; k < signups; k += 1) {
      const region = pick(regionNames, regionWeights)
      const city = regions[region][Math.floor(random() * regions[region].length)]
      const id = customers.length + 1
      const signed = new Date(date)
      signed.setHours(
        Math.floor(random() * 24),
        Math.floor(random() * 60),
        Math.floor(random() * 60),
      )
      const name = `${first[Math.floor(random() * first.length)]} ${last[Math.floor(random() * last.length)]}`
      insertCustomer.run(id, name, `customer${id}@example.com`, region, city, source, stamp(signed))
      customers.push({ id, region })
    }
  }

  const orderCount = Math.round(28 * demand * (0.8 + random() * 0.4))
  for (let k = 0; k < orderCount && customers.length > 0; k += 1) {
    const repeat = random() < 0.55
    const customer = repeat
      ? customers[Math.floor(Math.sqrt(random()) * customers.length * 0.999)]
      : customers[
          Math.max(0, customers.length - 1 - Math.floor(random() * Math.min(60, customers.length)))
        ]
    const at = new Date(date)
    at.setHours(pick(HOURS, HOUR_WEIGHTS), Math.floor(random() * 60), Math.floor(random() * 60))
    const status = pick(['paid', 'refunded', 'cancelled'], [93, 4, 3])
    const channel = pick(channels, [44 - progress * 10, 30 + progress * 14, 26 - progress * 4])
    orderId += 1
    const lines = 1 + Math.floor(random() * random() * 4)
    let subtotal = 0
    const items = []
    for (let l = 0; l < lines; l += 1) {
      const productIndex = pick([...products.keys()], productWeights)
      const [, , price] = products[productIndex]
      const promo = month === 10 && date.getDate() >= 8 && date.getDate() <= 12 ? 0.85 : 1
      const quantity = productIndex >= 9 && productIndex <= 13 ? 1 + Math.floor(random() * 3) : 1
      const unit = Math.round(price * promo * 100) / 100
      subtotal += unit * quantity
      items.push([productIndex + 1, quantity, unit])
    }
    const shipping = subtotal >= 60 ? 0 : 6
    insertOrder.run(orderId, customer.id, stamp(at), status, channel, customer.region, shipping)
    for (const [productId, quantity, unit] of items)
      insertItem.run(orderId, productId, quantity, unit)
  }
}
db.exec('COMMIT')

const counts = db
  .prepare(
    'SELECT (SELECT count(*) FROM customers) AS customers, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS items',
  )
  .get()
db.close()
process.stdout.write(
  `seeded ${file}: ${counts.customers} customers, ${counts.orders} orders, ${counts.items} order items (${day(start)} → ${day(end)})\n`,
)
