import { gridCells, placeKeys, TAIWAN_TILES, taiwanTile } from './tile-grid.js'

describe('taiwan tile grid', () => {
  it('has the 22 counties and cities on distinct cells', () => {
    expect(TAIWAN_TILES).toHaveLength(22)
    const cells = new Set(TAIWAN_TILES.map((t) => `${t.col},${t.row}`))
    expect(cells.size).toBe(22)
  })

  it('matches Chinese names with either 台 or 臺, with or without the suffix', () => {
    expect(taiwanTile('台北市')?.name).toBe('臺北市')
    expect(taiwanTile('臺中')?.name).toBe('臺中市')
    expect(taiwanTile('花蓮')?.name).toBe('花蓮縣')
    expect(taiwanTile('新竹')?.name).toBe('新竹市')
    expect(taiwanTile('新竹縣')?.name).toBe('新竹縣')
  })

  it('matches English names and aliases', () => {
    expect(taiwanTile('Taipei')?.name).toBe('臺北市')
    expect(taiwanTile('New Taipei City')?.name).toBe('新北市')
    expect(taiwanTile('Hsinchu')?.name).toBe('新竹市')
    expect(taiwanTile('Hsinchu County')?.name).toBe('新竹縣')
    expect(taiwanTile('chiayi county')?.name).toBe('嘉義縣')
    expect(taiwanTile('Matsu')?.name).toBe('連江縣')
    expect(taiwanTile('Atlantis')).toBeUndefined()
  })

  it('places data keys, using Latin abbreviations for English keys, and lists the misses', () => {
    const { placed, unmatched } = placeKeys(['Taipei', '高雄市', 'Nowhere'])
    expect(placed.get('Taipei')).toMatchObject({ col: 4, row: 1, short: 'TPE' })
    expect(placed.get('高雄市')).toMatchObject({ short: '高雄' })
    expect(unmatched).toEqual(['Nowhere'])
  })

  it('takes a custom grid', () => {
    const grid = { North: [0, 0] as [number, number], South: [0, 1] as [number, number] }
    const { placed, unmatched } = placeKeys(['north', 'East'], grid)
    expect(placed.get('north')).toMatchObject({ col: 0, row: 0, short: 'North' })
    expect(unmatched).toEqual(['East'])
    expect(gridCells(grid)).toHaveLength(2)
  })
})
