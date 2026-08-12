import { Pool, PoolConnection, RowsWithMeta, UpsertResult } from 'mariadb';
import { createPool } from 'mariadb';
import { getDbError, NotFoundError, ValueError } from 'fyo/utils/errors';
import {
  Field,
  FieldTypeEnum,
  RawValue,
  Schema,
  SchemaMap,
  TargetField,
} from '../../schemas/types';
import {
  getIsNullOrUndef,
  getRandomString,
  getValueMapFromList,
} from '../../utils';
import { DatabaseBase, GetAllOptions, QueryFilter } from '../../utils/db/types';
import { getDefaultMetaFieldValueMap, sqliteTypeMap, SYSTEM } from '../helpers';
import {
  AlterConfig,
  ColumnDiff,
  FieldValueMap,
  GetQueryBuilderOptions,
  MigrationConfig,
  NonExtantConfig,
  SingleValue,
  UpdateSinglesConfig,
} from './types';

export interface MariaDBConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

type QueryResult = RowsWithMeta<any> | UpsertResult;

function isUpsertResult(r: QueryResult): r is UpsertResult {
  return 'affectedRows' in r;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === '1' || v === 'true';
  return !!v;
}

export default class DatabaseCore extends DatabaseBase {
  pool: Pool | null = null;
  typeMap = sqliteTypeMap;
  dbPath: string;
   schemaMap: SchemaMap = {};
  connectionParams: MariaDBConfig;

  constructor(dbPath?: string, connectionParams?: MariaDBConfig) {
    super();
    this.dbPath = dbPath ?? ':memory:';
    this.connectionParams = connectionParams ?? {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'books',
    };
  }

  #normalizeTableName(schemaName: string): string {
    return schemaName.toLowerCase();
  }

  #qn(schemaName: string): string {
    return `\`${this.#normalizeTableName(schemaName)}\``;
  }


  static async getCountryCode(config: MariaDBConfig): Promise<string> {
    let countryCode = 'in';
    const db = new DatabaseCore(undefined, config);
    await db.connect();

    let query: { value: string }[] = [];
    try {
      query = (await db.query(
        `SELECT value FROM \`singlevalue\` WHERE fieldname = ? AND parent = ?`,
        ['countryCode', 'SystemSettings']
      )) as { value: string }[];
    } catch {
      // Database not initialized and no countryCode passed
    }

    if (query.length > 0) {
      countryCode = query[0].value;
    }

    await db.close();
    return countryCode;
  }

  setSchemaMap(schemaMap: SchemaMap) {
    this.schemaMap = schemaMap;
  }

  async connect() {
    this.pool = createPool({
      host: this.connectionParams.host,
      port: this.connectionParams.port,
      user: this.connectionParams.user,
      password: this.connectionParams.password,
      database: this.connectionParams.database,
      connectionLimit: 5,
    });
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error('Pool not initialized. Call connect() first.');
    }
    const conn: PoolConnection = await this.pool.getConnection();
    try {
      const result = await conn.query(sql, params);
      return result as QueryResult;
    } finally {
      conn.release();
    }
  }

  /**
   * Run a raw query — this is used by bespoke queries and patches
   * that previously used knex.raw() or knex(table) patterns.
   */
  async raw(sql: string, params?: unknown[]): Promise<QueryResult> {
    return await this.query(sql, params);
  }

  async migrate(config: MigrationConfig = {}) {
    const { create, alter } = await this.#getCreateAlterList();
    const hasSingleValueTable = !create.includes('SingleValue');
    let singlesConfig: UpdateSinglesConfig = {
      update: [],
      updateNonExtant: [],
    };

    if (hasSingleValueTable) {
      singlesConfig = await this.#getSinglesUpdateList();
    }

    const shouldMigrate = !!(
      create.length ||
      alter.length ||
      singlesConfig.update.length ||
      singlesConfig.updateNonExtant.length
    );

    if (!shouldMigrate) {
      return;
    }

    await config.pre?.();
    await this.query('SET FOREIGN_KEY_CHECKS=0');
    for (const schemaName of create) {
      await this.#createTable(schemaName);
    }

    // Now that all tables exist, add foreign key constraints
    for (const schemaName of create) {
      await this.#addForeignKeysToTable(schemaName);
    }

    for (const config of alter) {
      await this.#alterTable(config);
    }

    await this.query('SET FOREIGN_KEY_CHECKS=1');

    if (!hasSingleValueTable) {
      singlesConfig = await this.#getSinglesUpdateList();
    }

    await this.#initializeSingles(singlesConfig);
    await config.post?.();
  }

  async #getCreateAlterList() {
    const create: string[] = [];
    const alter: AlterConfig[] = [];

    for (const [schemaName, schema] of Object.entries(this.schemaMap)) {
      if (!schema || schema.isSingle) {
        continue;
      }

      const exists = await this.#tableExists(schemaName);
      if (!exists) {
        create.push(schemaName);
        continue;
      }

      const diff: ColumnDiff = await this.#getColumnDiff(schemaName);
      const newForeignKeys: Field[] = await this.#getNewForeignKeys(schemaName);
      if (diff.added.length || diff.removed.length || newForeignKeys.length) {
        alter.push({
          schemaName,
          diff,
          newForeignKeys,
        });
      }
    }

    return { create, alter };
  }

  async exists(schemaName: string, name?: string): Promise<boolean> {
    const schema = this.schemaMap[schemaName] as Schema;
    if (schema.isSingle) {
      return this.#singleExists(schemaName);
    }

    let row: unknown[] = [];
    try {
      const sql = name !== undefined
        ? `SELECT 1 FROM ${this.#qn(schemaName)} WHERE name = ? LIMIT 1`
        : `SELECT 1 FROM ${this.#qn(schemaName)} LIMIT 1`;
      const params = name !== undefined ? [name] : [];
      row = await this.query(sql, params) as unknown[];
    } catch (err) {
      if (getDbError(err as Error) !== NotFoundError) {
        throw err;
      }
    }
    return Array.isArray(row) && row.length > 0;
  }

  async insert(
    schemaName: string,
    fieldValueMap: FieldValueMap
  ): Promise<FieldValueMap> {
    // insert parent
    if (this.schemaMap[schemaName]!.isSingle) {
      await this.#updateSingleValues(schemaName, fieldValueMap);
    } else {
      await this.#insertOne(schemaName, fieldValueMap);
    }

    // insert children
    await this.#insertOrUpdateChildren(schemaName, fieldValueMap, false);
    return fieldValueMap;
  }

  async get(
    schemaName: string,
    name = '',
    fields?: string | string[]
  ): Promise<FieldValueMap> {
    const schema = this.schemaMap[schemaName] as Schema;
    if (!schema.isSingle && !name) {
      throw new ValueError('name is mandatory');
    }

    let fieldValueMap: FieldValueMap = {};
    if (schema.isSingle) {
      return await this.#getSingle(schemaName);
    }

    if (typeof fields === 'string') {
      fields = [fields];
    }

    if (fields === undefined) {
      fields = schema.fields.filter((f) => !f.computed).map((f) => f.fieldname);
    }

    const allTableFields: TargetField[] = this.#getTableFields(schemaName);
    const allTableFieldNames: string[] = allTableFields.map((f) => f.fieldname);
    const tableFields: TargetField[] = allTableFields.filter((f) =>
      (fields as string[]).includes(f.fieldname)
    );
    const nonTableFieldNames: string[] = (fields as string[]).filter(
      (f) => !allTableFieldNames.includes(f)
    );

    if (nonTableFieldNames.length) {
      fieldValueMap =
        (await this.#getOne(schemaName, name, nonTableFieldNames)) ?? {};
    }

    if (tableFields.length) {
      await this.#loadChildren(name, fieldValueMap, tableFields);
    }
    return fieldValueMap;
  }

  async getAll(
    schemaName: string,
    options: GetAllOptions = {}
  ): Promise<FieldValueMap[]> {
    const schema = this.schemaMap[schemaName] as Schema;
    if (schema === undefined) {
      throw new NotFoundError(`schema ${schemaName} not found`);
    }

    const hasCreated = !!schema.fields.find((f) => f.fieldname === 'created');

    const {
      fields = ['name'],
      filters,
      offset,
      limit,
      groupBy,
      orderBy = hasCreated ? 'created' : undefined,
      order = 'desc',
    } = options;

    return (await this.#getQueryBuilder(
      schemaName,
      typeof fields === 'string' ? [fields] : fields,
      filters ?? {},
      {
        offset,
        limit,
        groupBy,
        orderBy,
        order,
      }
    )) as FieldValueMap[];
  }

  async deleteAll(schemaName: string, filters: QueryFilter): Promise<number> {
    const sql = this.#buildDeleteSql(schemaName, filters);
    const result = await this.query(sql.sql, sql.params);
    const ok = result as UpsertResult;
    return ok.affectedRows;
  }

  async getSingleValues(
    ...fieldnames: ({ fieldname: string; parent?: string } | string)[]
  ): Promise<SingleValue<RawValue>> {
    const fieldnameList = fieldnames.map((fieldname) => {
      if (typeof fieldname === 'string') {
        return { fieldname };
      }
      return fieldname;
    });

    const sqlParts: string[] = [];
    const params: unknown[] = [];

    fieldnameList.forEach((f, i) => {
      if (i > 0) sqlParts.push(' OR ');
      sqlParts.push('(fieldname = ?');
      params.push(f.fieldname);
      if (f.parent) {
        sqlParts.push(' AND parent = ?');
        params.push(f.parent);
      }
      sqlParts.push(')');
    });

    let values: { fieldname: string; parent: string; value: RawValue }[] = [];
    try {
      const sql = `SELECT fieldname, value, parent FROM \`singlevalue\` WHERE ${sqlParts.join('')}`;
      values = await this.query(sql, params) as { fieldname: string; parent: string; value: RawValue }[];
    } catch (err) {
      if (getDbError(err as Error) === NotFoundError) {
        return [];
      }
      throw err;
    }

    return values;
  }

  async rename(schemaName: string, oldName: string, newName: string) {
    await this.query(
      `UPDATE ${this.#qn(schemaName)} SET name = ? WHERE name = ?`,
      [newName, oldName]
    );
  }

  async update(schemaName: string, fieldValueMap: FieldValueMap) {
    if (this.schemaMap[schemaName]!.isSingle) {
      await this.#updateSingleValues(schemaName, fieldValueMap);
    } else {
      await this.#updateOne(schemaName, fieldValueMap);
    }

    await this.#insertOrUpdateChildren(schemaName, fieldValueMap, true);
  }

  async delete(schemaName: string, name: string) {
    const schema = this.schemaMap[schemaName] as Schema;
    if (schema.isSingle) {
      await this.#deleteSingle(schemaName, name);
      return;
    }

    await this.#deleteOne(schemaName, name);

    const tableFields = this.#getTableFields(schemaName);

    for (const field of tableFields) {
      await this.#deleteChildren(field.target, name);
    }
  }

  async #tableExists(schemaName: string): Promise<boolean> {
    const rows = await this.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [schemaName]
    ) as unknown[];
    return rows.length > 0;
  }

  async #singleExists(singleSchemaName: string): Promise<boolean> {
    const rows = await this.query(
      `SELECT COUNT(*) as count FROM \`singlevalue\` WHERE parent = ?`,
      [singleSchemaName]
    ) as { count: number }[];
    if (typeof rows[0]?.count === 'number') {
      return rows[0].count > 0;
    }
    return false;
  }

  async #dropColumns(schemaName: string, targetColumns: string[]) {
    for (const col of targetColumns) {
        await this.query(`ALTER TABLE ${this.#qn(schemaName)} DROP COLUMN \`${col}\``);
    }
  }

  async prestigeTheTable(schemaName: string, tableRows: FieldValueMap[]) {
    const tempName = `__${schemaName}`;

    await this.query(`DROP TABLE IF EXISTS \`${tempName}\``);
    await this.#createTable(schemaName, tempName);

    if (tableRows.length > 0) {
      const fieldMap = this.schemaMap[schemaName]!;
      const fields = fieldMap.fields.filter((f) => f.fieldtype !== FieldTypeEnum.Table && !f.computed);
      const placeholders = fields.map(() => '?').join(', ');
      const colList = fields.map((f) => `\`${f.fieldname}\``).join(', ');
      const values = tableRows.map((row) => {
        return fields.map((f) => {
          const v = row[f.fieldname];
          return v !== undefined ? v : null;
        });
      });

      for (const rowValues of values) {
        await this.query(
          `INSERT INTO \`${tempName}\` (${colList}) VALUES (${placeholders})`,
          rowValues
        );
      }
    }

    await this.query(`SET FOREIGN_KEY_CHECKS=0`);
    await this.query(`DROP TABLE \`${schemaName}\``);
    await this.query(`RENAME TABLE \`${tempName}\` TO \`${schemaName}\``);
    await this.#addForeignKeysToTable(schemaName);
    await this.query(`SET FOREIGN_KEY_CHECKS=1`);
  }

  async #getTableColumns(schemaName: string): Promise<string[]> {
    const info = await this.query(
      `SELECT COLUMN_NAME as name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [schemaName]
    ) as { name: string }[];
    return info.map((d) => d.name);
  }

  async truncate(tableNames?: string[]) {
    if (tableNames === undefined) {
      const q = await this.query(
        `SELECT TABLE_NAME as name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT LIKE 'sqlite_%' AND TABLE_TYPE = 'BASE TABLE'`
      ) as { name: string }[];
      tableNames = q.map((i) => i.name);
    }

    for (const name of tableNames) {
      await this.query(`DELETE FROM ${this.#qn(name)}`);
    }
  }

  async #getForeignKeys(schemaName: string): Promise<string[]> {
    const foreignKeyList = await this.query(
      `SELECT COLUMN_NAME as from_name FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [schemaName]
    ) as { from_name: string }[];
    return foreignKeyList.map((d) => d.from_name);
  }

   #buildDeleteSql(schemaName: string, filters: QueryFilter) {
    const parts = this.#getFiltersArray(filters);
    const sqlParts: string[] = [`DELETE FROM ${this.#qn(schemaName)}`];
    const params: unknown[] = [];

    if (parts.length > 0) {
      sqlParts.push(' WHERE ');
      parts.forEach((p, i) => {
        if (i > 0) sqlParts.push(' AND ');
        if (p[1] === 'in' && Array.isArray(p[2])) {
          const placeholders = p[2].map(() => '?').join(', ');
          sqlParts.push(`\`${p[0]}\` IN (${placeholders})`);
          params.push(...p[2]);
        } else {
          sqlParts.push(`\`${p[0]}\` ${p[1]} ?`);
          params.push(p[2]);
        }
      });
    }

    return { sql: sqlParts.join(''), params };
   }

  #buildSelectSql(
    schemaName: string,
    fields: string[],
    filters: QueryFilter,
    options: GetQueryBuilderOptions
  ) {
    const params: unknown[] = [];
    const fieldList = fields.map((f) => `\`${f}\``).join(', ');
    let sql = `SELECT ${fieldList} FROM ${this.#qn(schemaName)}`;
    const filterParts = this.#getFiltersArray(filters);
    if (filterParts.length > 0) {
      const whereParts: string[] = [];
      filterParts.forEach((p, i) => {
        const connector = i === 0 ? ' WHERE ' : ' AND ';
        if (p[1] === 'in' && Array.isArray(p[2])) {
          const placeholders = p[2].map(() => '?').join(', ');
          whereParts.push(`${connector}\`${p[0]}\` IN (${placeholders})`);
          params.push(...p[2]);
        } else {
          whereParts.push(`${connector}\`${p[0]}\` ${p[1]} ?`);
          params.push(p[2]);
        }
      });
      sql += whereParts.join('');
    }

    const { orderBy, groupBy, order } = options;
    if (Array.isArray(orderBy)) {
      sql += ' ORDER BY ' + orderBy.map((col) => `\`${col}\` ${order ?? 'ASC'}`).join(', ');
    } else if (typeof orderBy === 'string') {
      sql += ` ORDER BY \`${orderBy}\` ${order ?? 'ASC'}`;
    }

    if (Array.isArray(groupBy)) {
      sql += ' GROUP BY ' + groupBy.map((col) => `\`${col}\``).join(', ');
    } else if (typeof groupBy === 'string') {
      sql += ` GROUP BY \`${groupBy}\``;
    }

    if (options.offset) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(options.limit ?? 18446744073709551615, options.offset);
    } else if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    return { sql, params };
  }

  async #getQueryBuilder(
    schemaName: string,
    fields: string[],
    filters: QueryFilter,
    options: GetQueryBuilderOptions
  ): Promise<FieldValueMap[]> {
    const { sql, params } = this.#buildSelectSql(schemaName, fields, filters, options);
    const result = await this.query(sql, params) as RowsWithMeta<any>[];
    return result as unknown as FieldValueMap[];
  }

  #getFiltersArray(filters: QueryFilter) {
    const filtersArray: [string, string, unknown][] = [];
    for (const field in filters) {
      const value = filters[field];

      let operator: string = '=';
      let comparisonValue: unknown = value;

      if (Array.isArray(value)) {
        operator = String(value[0]).toLowerCase();
        comparisonValue = value[1];

        if (operator === 'includes') {
          operator = 'like';
        }

        if (
          operator === 'like' &&
          typeof comparisonValue === 'string' &&
          !comparisonValue.includes('%')
        ) {
          comparisonValue = `%${comparisonValue}%`;
        }
      }

      filtersArray.push([field, operator, comparisonValue]);

      if (Array.isArray(value) && value.length > 2) {
        const operator2 = String(value[2]);
        const comparisonValue2 = value[3];
        filtersArray.push([field, operator2, comparisonValue2]);
      }
    }

    return filtersArray;
  }

  async #getColumnDiff(schemaName: string): Promise<ColumnDiff> {
    const tableColumns = await this.#getTableColumns(schemaName);
    const validFields = this.schemaMap[schemaName]!.fields.filter(
      (f) => !f.computed
    );
    const diff: ColumnDiff = { added: [], removed: [] };

    for (const field of validFields) {
      const hasDbType = this.typeMap.hasOwnProperty(field.fieldtype);
      if (!tableColumns.includes(field.fieldname) && hasDbType) {
        diff.added.push(field);
      }
    }

    const validFieldNames = validFields.map((field) => field.fieldname);
    for (const column of tableColumns) {
      if (!validFieldNames.includes(column)) {
        diff.removed.push(column);
      }
    }

    return diff;
  }

  async #getNewForeignKeys(schemaName: string): Promise<Field[]> {
    const foreignKeys = await this.#getForeignKeys(schemaName);
    const newForeignKeys: Field[] = [];
    const schema = this.schemaMap[schemaName] as Schema;
    for (const field of schema.fields) {
      if (
        field.fieldtype === FieldTypeEnum.Link &&
        !foreignKeys.includes(field.fieldname)
      ) {
        newForeignKeys.push(field);
      }
    }
    return newForeignKeys;
  }

   #sqlTypeForField(field: Field): string | null {
    const columnType = this.typeMap[field.fieldtype];
    if (!columnType) {
      return null;
    }

    if (columnType === 'integer' || columnType === 'float') {
      return columnType.toUpperCase();
    }

    if (columnType === 'boolean') {
      return 'TINYINT(1)';
    }

    if (columnType === 'date' || columnType === 'datetime' || columnType === 'time') {
      return columnType.toUpperCase();
    }

    // Link fields reference `name` columns which are VARCHAR(255)
    if (field.fieldtype === FieldTypeEnum.Link) {
      return 'VARCHAR(255)';
    }

    if (columnType === 'text' || columnType === 'binary') {
      return 'TEXT';
    }

    return 'TEXT';
  }

  async #buildCreateTableSql(schemaName: string, tableName?: string): Promise<string> {
    tableName ??= schemaName;
    const fields = this.schemaMap[schemaName]!.fields.filter(
      (f) => !f.computed
    );

    const columnDefs: string[] = [];
    const foreignKeys: string[] = [];

    for (const field of fields) {
      if (field.fieldtype === FieldTypeEnum.Table) {
        continue;
      }

      const sqlType = this.#sqlTypeForField(field);
      if (!sqlType) continue;

      let colDef = `\`${field.fieldname}\` ${sqlType}`;

      if (field.fieldname === 'name') {
        colDef = `\`${field.fieldname}\` VARCHAR(255) PRIMARY KEY`;
      }

      if (field.required) {
        colDef += ' NOT NULL';
      } else if (field.default === undefined) {
        // no default
      }

      if (field.fieldtype === FieldTypeEnum.Link && field.target) {
        // Foreign keys are added as separate ALTER TABLE after all tables are created
        // to avoid dependency ordering issues.
      }

      columnDefs.push(colDef);
    }

    const allDefs = [...columnDefs, ...foreignKeys];
    return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${allDefs.join(', ')})`;
  }

  async #alterTable({ schemaName, diff, newForeignKeys }: AlterConfig) {
    if (diff.added.length) {
      for (const field of diff.added) {
        const sqlType = this.#sqlTypeForField(field);
        if (!sqlType) continue;

        let colDef = `\`${field.fieldname}\` ${sqlType}`;
        if (field.required) {
          colDef += ' NOT NULL';
        }

        await this.query(`ALTER TABLE ${this.#qn(schemaName)} ADD COLUMN ${colDef}`);
      }
    }

    if (diff.removed.length) {
      for (const col of diff.removed) {
      await this.query(`ALTER TABLE ${this.#qn(schemaName)} DROP COLUMN \`${col}\``);
      }
    }

    if (newForeignKeys.length) {
      await this.#addForeignKeys(schemaName);
    }
  }

  async #createTable(schemaName: string, tableName?: string) {
    tableName ??= schemaName;
    const sql = await this.#buildCreateTableSql(schemaName, tableName);
    await this.query(sql);
  }

  async #addForeignKeysToTable(schemaName: string) {
    const schema = this.schemaMap[schemaName] as Schema;
    const linkFields = schema.fields.filter(
      (f) => f.fieldtype === FieldTypeEnum.Link && f.target
    );

    for (const field of linkFields) {
      const targetSchema = this.schemaMap[field.target] as Schema;
      if (!targetSchema) continue;

      try {
        const targetTable = (field.target as string).toLowerCase();
        await this.query(
          `ALTER TABLE ${this.#qn(schemaName)} ADD CONSTRAINT \`fk_${schemaName}_${field.fieldname}\` FOREIGN KEY (\`${field.fieldname}\`) REFERENCES \`${targetTable}\` (name) ON UPDATE CASCADE ON DELETE RESTRICT`
        );
      } catch (err: any) {
        // Skip if constraint already exists
        if (!err.message?.includes('Duplicate')) {
          throw err;
        }
      }
    }
  }

  async #getNonExtantSingleValues(singleSchemaName: string) {
    const existingFields = (
      await this.query(
        `SELECT fieldname FROM \`singlevalue\` WHERE parent = ?`,
        [singleSchemaName]
      ) as { fieldname: string }[]
    ).map(({ fieldname }) => fieldname);

    const nonExtant: NonExtantConfig['nonExtant'] = [];
    const fields = this.schemaMap[singleSchemaName]?.fields ?? [];
    for (const { fieldname, default: value } of fields) {
      if (existingFields.includes(fieldname) || value === undefined) {
        continue;
      }

      nonExtant.push({ fieldname, value });
    }

    return nonExtant;
  }

  async #deleteOne(schemaName: string, name: string) {
    await this.query(`DELETE FROM ${this.#qn(schemaName)} WHERE name = ?`, [name]);
  }

  async #deleteSingle(schemaName: string, fieldname: string) {
    await this.query(
      `DELETE FROM \`singlevalue\` WHERE parent = ? AND fieldname = ?`,
      [schemaName, fieldname]
    );
  }

  #deleteChildren(schemaName: string, parentName: string) {
    return this.query(`DELETE FROM \`${schemaName}\` WHERE parent = ?`, [parentName]);
  }

  #runDeleteOtherChildren(
    field: TargetField,
    parentName: string,
    added: string[]
  ) {
    const placeholders = added.map(() => '?').join(', ');
    return this.query(
      `DELETE FROM ${this.#qn(field.target)} WHERE parent = ? AND name NOT IN (${placeholders})`,
      [parentName, ...added]
    );
  }

  #prepareChild(
    parentSchemaName: string,
    parentName: string,
    child: FieldValueMap,
    field: Field,
    idx: number
  ) {
    if (!child.name) {
      child.name ??= getRandomString();
    }
    child.parent = parentName;
    child.parentSchemaName = parentSchemaName;
    child.parentFieldname = field.fieldname;
    child.idx ??= idx;
  }

  async #addForeignKeys(schemaName: string) {
    const tableRows = await this.query(`SELECT * FROM \`${schemaName}\``) as RowsWithMeta<any>[];
    await this.prestigeTheTable(schemaName, tableRows as unknown as FieldValueMap[]);
  }

  async #loadChildren(
    parentName: string,
    fieldValueMap: FieldValueMap,
    tableFields: TargetField[]
  ) {
    for (const field of tableFields) {
      fieldValueMap[field.fieldname] = await this.getAll(field.target, {
        fields: ['*'],
        filters: { parent: parentName },
        orderBy: 'idx',
        order: 'asc',
      });
    }
  }

  async #getOne(schemaName: string, name: string, fields: string[]) {
    const fieldList = fields.map((f) => `\`${f}\``).join(', ');
    const result = await this.query(
      `SELECT ${fieldList} FROM \`${schemaName}\` WHERE name = ?`,
      [name]
    ) as RowsWithMeta<any>[];

    return result.length > 0 ? (result[0] as unknown as FieldValueMap) : undefined;
  }

  async #getSingle(schemaName: string): Promise<FieldValueMap> {
    const values = await this.getAll('SingleValue', {
      fields: ['fieldname', 'value'],
      filters: { parent: schemaName },
      orderBy: 'fieldname',
      order: 'asc',
    });

    const fieldValueMap = getValueMapFromList(
      values,
      'fieldname',
      'value'
    ) as FieldValueMap;
    const tableFields: TargetField[] = this.#getTableFields(schemaName);
    if (tableFields.length) {
      await this.#loadChildren(schemaName, fieldValueMap, tableFields);
    }

    return fieldValueMap;
  }

  async #insertOne(schemaName: string, fieldValueMap: FieldValueMap) {
    if (!fieldValueMap.name) {
      fieldValueMap.name = getRandomString();
    }

    const fields = this.schemaMap[schemaName]!.fields.filter(
      (f) => f.fieldtype !== FieldTypeEnum.Table && !f.computed
    );

    const validMap: FieldValueMap = {};
    for (const { fieldname } of fields) {
      validMap[fieldname] = fieldValueMap[fieldname];
    }

    const colNames = Object.keys(validMap);
    const placeholders = colNames.map(() => '?').join(', ');
    const colList = colNames.map((f) => `\`${f}\``).join(', ');
    const values = colNames.map((f) => validMap[f]);

    await this.query(
      `INSERT INTO ${this.#qn(schemaName)} (${colList}) VALUES (${placeholders})`,
      values
    );
  }

  async #updateSingleValues(
    singleSchemaName: string,
    fieldValueMap: FieldValueMap
  ) {
    const fields = this.schemaMap[singleSchemaName]!.fields.filter(
      (f) => !f.computed && f.fieldtype !== 'Table'
    );
    for (const field of fields) {
      const value = fieldValueMap[field.fieldname] as RawValue | undefined;
      if (value === undefined) {
        continue;
      }

      await this.#updateSingleValue(singleSchemaName, field.fieldname, value);
    }
  }

  async #updateSingleValue(
    singleSchemaName: string,
    fieldname: string,
    value: RawValue
  ) {
    const exists = await this.query(
      `SELECT name FROM \`singlevalue\` WHERE parent = ? AND fieldname = ? LIMIT 1`,
      [singleSchemaName, fieldname]
    ) as { name: string }[];

    if (!exists.length) {
      await this.#insertSingleValue(singleSchemaName, fieldname, value);
    } else {
      await this.query(
        `UPDATE \`singlevalue\` SET value = ?, modifiedBy = ?, modified = ? WHERE parent = ? AND fieldname = ?`,
        [value, SYSTEM, new Date().toISOString().replace('T', ' ').replace('Z', ''), singleSchemaName, fieldname]
      );
    }
  }

  async #insertSingleValue(
    singleSchemaName: string,
    fieldname: string,
    value: RawValue
  ) {
    const updateMap = getDefaultMetaFieldValueMap();
    const fieldValueMap: FieldValueMap = Object.assign({}, updateMap, {
      parent: singleSchemaName,
      fieldname,
      value,
      name: getRandomString(),
    });

    const colNames = Object.keys(fieldValueMap);
    const placeholders = colNames.map(() => '?').join(', ');
    const colList = colNames.map((f) => `\`${f}\``).join(', ');
    const values = colNames.map((f) => fieldValueMap[f]);

    await this.query(
      `INSERT INTO \`singlevalue\` (${colList}) VALUES (${placeholders})`,
      values
    );
  }

  async #getSinglesUpdateList() {
    const update: string[] = [];
    const updateNonExtant: NonExtantConfig[] = [];
    for (const [schemaName, schema] of Object.entries(this.schemaMap)) {
      if (!schema || !schema.isSingle) {
        continue;
      }

      const exists = await this.#singleExists(schemaName);
      if (!exists && schema.fields.some((f) => f.default !== undefined)) {
        update.push(schemaName);
      }

      if (!exists) {
        continue;
      }

      const nonExtant = await this.#getNonExtantSingleValues(schemaName);
      if (nonExtant.length) {
        updateNonExtant.push({
          schemaName,
          nonExtant,
        });
      }
    }

    return { update, updateNonExtant };
  }

  async #initializeSingles({ update, updateNonExtant }: UpdateSinglesConfig) {
    for (const config of updateNonExtant) {
      await this.#updateNonExtantSingleValues(config);
    }

    for (const schemaName of update) {
      const fields = this.schemaMap[schemaName]!.fields;
      const defaultValues: FieldValueMap = fields.reduce((acc, f) => {
        if (f.default !== undefined) {
          acc[f.fieldname] = f.default;
        }

        return acc;
      }, {} as FieldValueMap);

      await this.#updateSingleValues(schemaName, defaultValues);
    }
  }

  async #updateNonExtantSingleValues({
    schemaName,
    nonExtant,
  }: NonExtantConfig) {
    for (const { fieldname, value } of nonExtant) {
      await this.#updateSingleValue(schemaName, fieldname, value);
    }
  }

  async #updateOne(schemaName: string, fieldValueMap: FieldValueMap) {
    const updateMap = { ...fieldValueMap };
    delete updateMap.name;
    const schema = this.schemaMap[schemaName] as Schema;
    for (const { fieldname, fieldtype, computed } of schema.fields) {
      if (fieldtype !== FieldTypeEnum.Table && !computed) {
        continue;
      }

      delete updateMap[fieldname];
    }

    if (Object.keys(updateMap).length === 0) {
      return;
    }

    const colNames = Object.keys(updateMap);
    const setClause = colNames.map((f) => `\`${f}\` = ?`).join(', ');
    const values = colNames.map((f) => updateMap[f]);
    values.push(fieldValueMap.name as string);

    await this.query(
      `UPDATE ${this.#qn(schemaName)} SET ${setClause} WHERE name = ?`,
      values
    );
  }

  async #insertOrUpdateChildren(
    schemaName: string,
    fieldValueMap: FieldValueMap,
    isUpdate: boolean
  ) {
    let parentName = fieldValueMap.name as string;
    if (this.schemaMap[schemaName]?.isSingle) {
      parentName = schemaName;
    }

    const tableFields = this.#getTableFields(schemaName);

    for (const field of tableFields) {
      const added: string[] = [];

      const tableFieldValue = fieldValueMap[field.fieldname] as
        | FieldValueMap[]
        | undefined
        | null;
      if (getIsNullOrUndef(tableFieldValue)) {
        continue;
      }

      for (const child of tableFieldValue) {
        this.#prepareChild(schemaName, parentName, child, field, added.length);

        if (
          isUpdate &&
          (await this.exists(field.target, child.name as string))
        ) {
          await this.#updateOne(field.target, child);
        } else {
          await this.#insertOne(field.target, child);
        }

        added.push(child.name as string);
      }

      if (isUpdate) {
        await this.#runDeleteOtherChildren(field, parentName, added);
      }
    }
  }

  #getTableFields(schemaName: string): TargetField[] {
    return this.schemaMap[schemaName]!.fields.filter(
      (f) => f.fieldtype === FieldTypeEnum.Table
    ) as TargetField[];
  }
}
