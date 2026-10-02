import { normaliseKey } from './geo.js'

export interface Tile {
  /** The canonical name the tile stands for. */
  name: string
  col: number
  row: number
  /** Short label for a tile too small for the full name. */
  short: string
  /** Latin short label, used when the data names places in English. */
  abbr: string
}

/**
 * Taiwan's 22 counties and cities as equal tiles — a layout, not geography:
 * relative positions only, so Taipei is as visible as Hualien. The outlying
 * islands sit to the west: Matsu top, Kinmen middle, Penghu by Chiayi.
 */
export const TAIWAN_TILES: Tile[] = [
  { name: '連江縣', col: 0, row: 0, short: '連江', abbr: 'LJF' },
  { name: '新北市', col: 4, row: 0, short: '新北', abbr: 'NTP' },
  { name: '基隆市', col: 5, row: 0, short: '基隆', abbr: 'KEE' },
  { name: '桃園市', col: 3, row: 1, short: '桃園', abbr: 'TAO' },
  { name: '臺北市', col: 4, row: 1, short: '北市', abbr: 'TPE' },
  { name: '宜蘭縣', col: 5, row: 1, short: '宜蘭', abbr: 'ILA' },
  { name: '新竹市', col: 2, row: 2, short: '竹市', abbr: 'HSC' },
  { name: '新竹縣', col: 3, row: 2, short: '竹縣', abbr: 'HSQ' },
  { name: '苗栗縣', col: 2, row: 3, short: '苗栗', abbr: 'MIA' },
  { name: '臺中市', col: 3, row: 3, short: '中市', abbr: 'TXG' },
  { name: '花蓮縣', col: 4, row: 3, short: '花蓮', abbr: 'HUA' },
  { name: '金門縣', col: 0, row: 4, short: '金門', abbr: 'KIN' },
  { name: '彰化縣', col: 2, row: 4, short: '彰化', abbr: 'CHA' },
  { name: '南投縣', col: 3, row: 4, short: '南投', abbr: 'NAN' },
  { name: '雲林縣', col: 2, row: 5, short: '雲林', abbr: 'YUN' },
  { name: '臺東縣', col: 4, row: 5, short: '臺東', abbr: 'TTT' },
  { name: '澎湖縣', col: 1, row: 6, short: '澎湖', abbr: 'PEN' },
  { name: '嘉義市', col: 2, row: 6, short: '嘉市', abbr: 'CYI' },
  { name: '嘉義縣', col: 3, row: 6, short: '嘉縣', abbr: 'CYQ' },
  { name: '臺南市', col: 2, row: 7, short: '南市', abbr: 'TNN' },
  { name: '高雄市', col: 3, row: 7, short: '高雄', abbr: 'KHH' },
  { name: '屏東縣', col: 3, row: 8, short: '屏東', abbr: 'PIF' },
]

const ALIASES: Record<string, string> = {
  taipei: '臺北市',
  'new taipei': '新北市',
  taoyuan: '桃園市',
  keelung: '基隆市',
  hsinchu: '新竹市',
  'hsinchu county': '新竹縣',
  miaoli: '苗栗縣',
  taichung: '臺中市',
  changhua: '彰化縣',
  nantou: '南投縣',
  yunlin: '雲林縣',
  chiayi: '嘉義市',
  'chiayi county': '嘉義縣',
  tainan: '臺南市',
  kaohsiung: '高雄市',
  pingtung: '屏東縣',
  yilan: '宜蘭縣',
  ilan: '宜蘭縣',
  hualien: '花蓮縣',
  taitung: '臺東縣',
  penghu: '澎湖縣',
  kinmen: '金門縣',
  lienchiang: '連江縣',
  matsu: '連江縣',
}

const BY_NAME = new Map(TAIWAN_TILES.map((tile) => [normaliseKey(tile.name), tile]))

/**
 * A place name from the data → its tile. Accepts 台 or 臺, with or without
 * 市/縣, and English names with or without "City" / "County". A bare 新竹 or
 * 嘉義 (Hsinchu, Chiayi) means the city, as it usually does in sales data.
 */
export function taiwanTile(key: unknown): Tile | undefined {
  const k = normaliseKey(key).replace(/\s+/g, ' ')
  const direct = BY_NAME.get(k)
  if (direct) return direct
  const english = k.replace(/ city$/, '')
  const alias = ALIASES[english] ?? ALIASES[k]
  if (alias) return BY_NAME.get(normaliseKey(alias))
  return BY_NAME.get(`${k}市`) ?? BY_NAME.get(`${k}縣`)
}

export function isLatin(value: unknown): boolean {
  return /^[\x20-\x7e]+$/.test(String(value ?? '').trim())
}

export interface PlacedTile {
  key: string
  col: number
  row: number
  short: string
}

export type GridSpec = 'taiwan' | Record<string, [number, number]>

/**
 * The tiles for a set of data keys: each key placed on the grid, and the keys
 * that found no tile. Keys are matched case- and 台/臺-insensitively.
 */
export function placeKeys(
  keys: unknown[],
  grid: GridSpec = 'taiwan',
): { placed: Map<string, PlacedTile>; unmatched: string[] } {
  const placed = new Map<string, PlacedTile>()
  const unmatched: string[] = []
  const custom =
    grid === 'taiwan'
      ? undefined
      : new Map(Object.entries(grid).map(([name, at]) => [normaliseKey(name), { name, at }]))
  for (const raw of keys) {
    const key = String(raw ?? '')
    if (custom) {
      const hit = custom.get(normaliseKey(key))
      if (hit) placed.set(key, { key, col: hit.at[0], row: hit.at[1], short: hit.name })
      else unmatched.push(key)
      continue
    }
    const tile = taiwanTile(key)
    if (tile)
      placed.set(key, {
        key,
        col: tile.col,
        row: tile.row,
        short: isLatin(key) ? tile.abbr : tile.short,
      })
    else unmatched.push(key)
  }
  return { placed, unmatched }
}

/** Every tile of the grid, so places with no data are still drawn as empty tiles. */
export function gridCells(grid: GridSpec = 'taiwan'): { name: string; col: number; row: number }[] {
  if (grid === 'taiwan') return TAIWAN_TILES.map(({ name, col, row }) => ({ name, col, row }))
  return Object.entries(grid).map(([name, [col, row]]) => ({ name, col, row }))
}
