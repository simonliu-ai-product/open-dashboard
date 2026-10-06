import type { DatasourceConfig } from '../config.js'
import { openBigquery } from './bigquery.js'
import { openClickhouse } from './clickhouse.js'
import { openDuckdb } from './duckdb.js'
import { openFiles } from './files.js'
import { openHttp } from './http.js'
import { openMcp } from './mcp.js'
import { openMssql } from './mssql.js'
import { openMysql } from './mysql.js'
import { openOracle } from './oracle.js'
import { openPostgres } from './postgres.js'
import { DRIVERS } from './registry.js'
import { openSnowflake } from './snowflake.js'
import { openSqlite } from './sqlite.js'
import { type Datasource, DatasourceError } from './types.js'

export function openDatasource(
  name: string,
  config: DatasourceConfig,
  root: string,
): Promise<Datasource> {
  switch (config.type) {
    case 'sqlite':
      return openSqlite(name, config, root)
    case 'postgres':
      return openPostgres(name, config, root)
    case 'mysql':
      return openMysql(name, config, root)
    case 'mssql':
      return openMssql(name, config, root)
    case 'oracle':
      return openOracle(name, config, root)
    case 'duckdb':
      return openDuckdb(name, config, root)
    case 'clickhouse':
      return openClickhouse(name, config, root)
    case 'bigquery':
      return openBigquery(name, config, root)
    case 'snowflake':
      return openSnowflake(name, config, root)
    case 'http':
      return openHttp(name, config)
    case 'mcp':
      return openMcp(name, config)
    case 'json':
    case 'csv':
      return openFiles(name, config, root)
    default:
      throw new DatasourceError(
        `datasource "${name}": unknown type "${(config as { type?: string }).type}" — use one of ${DRIVERS.map((d) => d.type).join(', ')}`,
        500,
      )
  }
}

export { DRIVERS, type DriverInfo, driverFor } from './registry.js'
export type { Datasource, QueryOptions } from './types.js'
export { DatasourceError, errorMessage } from './types.js'
