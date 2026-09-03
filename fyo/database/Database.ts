import { SchemaMap } from 'schemas/types';
import { DatabaseBase, GetAllOptions, QueryFilter } from 'utils/db/types';
import { FieldValueMap } from 'backend/database/types';
import { DocValue, DocValueMap } from 'fyo/core/types';

/**
 * Typed Database interface at the external Fyo.db seam.
 *
 * This is the seam callers (Doc, models, src/utils) depend on.
 * Both the production IpcDatabaseAdapter (renderer → IPC → Main Core)
 * and the test MemoryDatabaseAdapter satisfy this same interface.
 *
 * Two-adapter proof: one interface, two adapters.
 * IPC/maria pool remains an internal implementation detail.
 */
export interface Database extends DatabaseBase {
  // Lifecycle surface of the typed seam
  getSchemaMap(): Promise<SchemaMap>;
  createNewDatabase(dbPath: string, countryCode: string): Promise<string>;
  connectToDatabase(dbPath: string, countryCode?: string): Promise<string>;

  // Typed CRUD — external seam works with DocValueMap (Raw hidden inside adapters)
  insert(schemaName: string, docValueMap: DocValueMap): Promise<DocValueMap>;
  get(schemaName: string, name: string, fields?: string | string[]): Promise<DocValueMap>;
  getAll(schemaName: string, options?: GetAllOptions): Promise<DocValueMap[]>;
  getSingleValues(
    ...fieldnames: ({ fieldname: string; parent?: string } | string)[]
  ): Promise<{ fieldname: string; parent: string; value: DocValue }[]>;
  update(schemaName: string, docValueMap: DocValueMap): Promise<void>;
  // getAllRaw intentionally leaks RawValueMap for callers that genuinely need it (search, export)
  getAllRaw(schemaName: string, options?: GetAllOptions): Promise<FieldValueMap[]>;
  count(schemaName: string, options?: GetAllOptions): Promise<number>;

  // Typed persistence — genuine DB ownership (FOR UPDATE / transaction)
  getNextAutoincrementId(schemaName: string): Promise<number>;
  getNextSeriesValue(prefix: string, schemaName: string): Promise<number>;
}

export type { GetAllOptions, QueryFilter };
