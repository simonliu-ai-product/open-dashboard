import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * A small, obviously fictional database so the first `pnpm dev` shows a working
 * dashboard before the user has connected anything real. Generated here rather
 * than shipped as a binary: it ends on the day the workspace was created, so
 * "last 90 days" has data in it.
 */
export async function writeSampleDatabase(file: string, today = new Date()): Promise<number> {
  const { DatabaseSync } = await import('node:sqlite')
  mkdirSync(dirname(file), { recursive: true })
  rmSync(file, { force: true })
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      ordered_at TEXT NOT NULL,
      product TEXT NOT NULL,
      category TEXT NOT NULL,
      region TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL
    );
    CREATE INDEX orders_ordered_at ON orders(ordered_at);
  `)

  let seed = 7
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  const products: [string, string, number][] = [
    ['Notebook', 'Stationery', 6],
    ['Fountain Pen', 'Stationery', 38],
    ['Desk Lamp', 'Home', 45],
    ['Mug', 'Home', 12],
    ['Backpack', 'Bags', 79],
    ['Tote Bag', 'Bags', 24],
  ]
  const regions = ['North', 'Central', 'South', 'East']
  const pad = (n: number) => String(n).padStart(2, '0')
  const insert = db.prepare(
    'INSERT INTO orders (ordered_at, product, category, region, amount, status) VALUES (?, ?, ?, ?, ?, ?)',
  )

  let count = 0
  db.exec('BEGIN')
  for (let back = 364; back >= 0; back -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
    const perDay = Math.round(6 + (364 - back) / 40 + random() * 6)
    for (let k = 0; k < perDay; k += 1) {
      const [product, category, price] = products[Math.floor(random() * products.length)] as [
        string,
        string,
        number,
      ]
      const quantity = 1 + Math.floor(random() * 3)
      const stamp = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())} ${pad(8 + Math.floor(random() * 14))}:${pad(Math.floor(random() * 60))}:00`
      const status = random() < 0.95 ? 'paid' : 'refunded'
      insert.run(
        stamp,
        product,
        category,
        regions[Math.floor(random() * regions.length)] as string,
        price * quantity,
        status,
      )
      count += 1
    }
  }
  db.exec('COMMIT')
  db.close()
  return count
}
