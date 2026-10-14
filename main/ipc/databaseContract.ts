import type { MariaDBConfig } from '../../utils/mariadb-types';
import type { FieldValueMap, GetAllOptions, QueryFilter } from '../../utils/db/types';
import type { SchemaMap } from '../../schemas/types';

/**
 * Backend-independent database boundary used by Electron IPC.
 * Application routing and business capabilities depend on this contract,
 * never on a concrete database implementation.
 */
export interface RouterDatabase {
  setDbConfig(config: MariaDBConfig): void;
  createNewDatabase(dbPath: string, countryCode: string): Promise<string>;
  connectToDatabase(dbPath: string, countryCode?: string): Promise<string>;
  getSchemaMap(): SchemaMap | Promise<SchemaMap>;
  insert(schemaName: string, values: FieldValueMap): Promise<unknown>;
  get(schemaName: string, name: string, fields?: string | string[]): Promise<unknown>;
  getAll(schemaName: string, options?: GetAllOptions): Promise<unknown[]>;
  getSingleValues(...fields: ({ fieldname: string; parent?: string } | string)[]): Promise<unknown[]>;
  rename(schemaName: string, oldName: string, newName: string): Promise<void>;
  update(schemaName: string, values: FieldValueMap): Promise<void>;
  delete(schemaName: string, name: string): Promise<void>;
  deleteAll(schemaName: string, filters: QueryFilter): Promise<number>;
  exists(schemaName: string, name?: string): Promise<boolean>;
  close(): Promise<void>;
  count(schemaName: string, options?: GetAllOptions): Promise<number>;
  getNextAutoincrementId(schemaName: string): Promise<number>;
  getNextSeriesValue(prefix: string, schemaName: string): Promise<number>;
}
