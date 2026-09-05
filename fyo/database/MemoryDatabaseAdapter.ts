import { FieldValueMap } from 'backend/database/types';
import { SchemaMap } from 'schemas/types';
import { getSchemas } from 'schemas';
import { DatabaseBase, GetAllOptions, QueryFilter } from 'utils/db/types';
import { Database } from './Database';
import { DocValue, DocValueMap } from 'fyo/core/types';
import { Converter } from 'fyo/core/converter';
import type { Field } from 'schemas/types';
import type { MoneyMaker } from 'pesa';

type FieldMap = Record<string, Record<string, Field>>;

/**
 * Minimal in-memory adapter — test-only.
 *
 * Proves the two-adapter seam: same typed Database interface as IpcDatabaseAdapter,
 * but backed by Maps instead of MariaDB pool/IPC.
 *
 * Intentionally minimal: implements only the typed subset needed for small
 * Fyo test paths (insert/get/getAll/exists + lifecycle). Does NOT emulate:
 * - INFORMATION_SCHEMA / DDL / migrate
 * - FK constraints
 * - DATETIME semantics
 * - MariaDB locking / FOR UPDATE
 * - SingleValue as table — simplified as in-memory map
 *
 * Those remain MariaDB-specific and stay unmocked.
 */
export class MemoryDatabaseAdapter extends DatabaseBase implements Database {
  schemaMap: SchemaMap = {};
  // schemaName -> name -> row (now DocValueMap for external seam)
  #tables = new Map<string, Map<string, DocValueMap>>();
  // parent -> fieldname -> value (for SingleValue) — DocValue
  #singles = new Map<string, Map<string, DocValue>>();
  #closed = false;
  private converter: Converter;
  private fieldMapProvider: () => FieldMap;
  private pesaProvider: () => MoneyMaker;

  constructor(
    fieldMapProvider: () => FieldMap = () => ({} as FieldMap),
    pesaProvider: () => MoneyMaker = () => ((v: unknown) => v) as unknown as MoneyMaker
  ) {
    super();
    this.fieldMapProvider = fieldMapProvider;
    this.pesaProvider = pesaProvider;
    this.converter = new Converter(fieldMapProvider, pesaProvider);
  }

  setProviders(fieldMapProvider: () => FieldMap, pesaProvider: () => MoneyMaker) {
    this.fieldMapProvider = fieldMapProvider;
    this.pesaProvider = pesaProvider;
    this.converter = new Converter(fieldMapProvider, pesaProvider);
  }

  // Lifecycle — typed transport
  // eslint-disable-next-line @typescript-eslint/require-await
  async getSchemaMap(): Promise<SchemaMap> {
    if (Object.keys(this.schemaMap).length === 0) {
      this.schemaMap = getSchemas('-', []);
    }
    return this.schemaMap;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async createNewDatabase(_dbPath: string, countryCode: string): Promise<string> {
    this.schemaMap = getSchemas(countryCode, []);
    this.#tables.clear();
    this.#singles.clear();
    // Seed singles defaults like DatabaseCore.migrate does (simplified)
    for (const [name, schema] of Object.entries(this.schemaMap)) {
      if (schema?.isSingle) {
        const map = new Map<string, DocValue>();
        for (const f of schema.fields) {
          if (f.default !== undefined) map.set(f.fieldname, f.default as DocValue);
        }
        if (map.size) this.#singles.set(name, map);
      }
    }
    this.#closed = false;
    return countryCode;
  }

  async connectToDatabase(_dbPath: string, countryCode?: string): Promise<string> {
    const cc = countryCode ?? 'in';
    if (Object.keys(this.schemaMap).length === 0) {
      return await this.createNewDatabase(_dbPath, cc);
    }
    return cc;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    this.#closed = true;
  }

  // CRUD — minimal typed subset (external seam is DocValueMap, Raw hidden)
  // eslint-disable-next-line @typescript-eslint/require-await
  async insert(schemaName: string, fieldValueMap: DocValueMap): Promise<DocValueMap> {
    const schema = this.schemaMap[schemaName];
    if (schema?.isSingle) {
      const parent = schemaName;
      let map = this.#singles.get(parent);
      if (!map) {
        map = new Map();
        this.#singles.set(parent, map);
      }
      for (const [k, v] of Object.entries(fieldValueMap)) {
        if (v !== undefined) map.set(k, v as DocValue);
      }
      return fieldValueMap;
    }
    let table = this.#tables.get(schemaName);
    if (!table) {
      table = new Map();
      this.#tables.set(schemaName, table);
    }
    const name = (fieldValueMap.name as string) ?? `mem-${Math.random().toString(36).slice(2)}`;
    const row = { ...fieldValueMap, name };
    table.set(name, row);
    return row;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get(schemaName: string, name: string, fields?: string | string[]): Promise<DocValueMap> {
    const schema = this.schemaMap[schemaName];
    if (schema?.isSingle) {
      const map = this.#singles.get(schemaName);
      const out: DocValueMap = {};
      if (!map) return out;
      const fieldList = fields
        ? (Array.isArray(fields) ? fields : [fields])
        : Array.from(map.keys());
      for (const f of fieldList) {
        if (map.has(f)) out[f] = map.get(f)!;
      }
      return out;
    }
    const table = this.#tables.get(schemaName);
    const row = table?.get(name);
    if (!row) return {} as DocValueMap;
    if (!fields) return { ...row };
    const list = Array.isArray(fields) ? fields : [fields];
    const out: DocValueMap = {};
    for (const f of list) out[f] = row[f];
    if (!list.includes('name') && row.name) out.name = row.name;
    return out;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAll(schemaName: string, options: GetAllOptions = {}): Promise<DocValueMap[]> {
    if (schemaName === 'SingleValue') {
      const rows: DocValueMap[] = [];
      for (const [parent, map] of this.#singles.entries()) {
        for (const [fieldname, value] of map.entries()) {
          rows.push({ parent, fieldname, value } as DocValueMap);
        }
      }
      return this.#applyGetAllFilters(rows, options);
    }
    const table = this.#tables.get(schemaName);
    const rows = table ? Array.from(table.values()).map((r) => ({ ...r })) : [];
    return this.#applyGetAllFilters(rows, options);
  }

  async getAllRaw(schemaName: string, options: GetAllOptions = {}): Promise<FieldValueMap[]> {
    // Intentionally leaks Raw — for callers that genuinely need it (search/export)
    // For memory, Raw and Doc are same (no MariaDB type conversion simulated)
    return (await this.getAll(schemaName, options)) as unknown as FieldValueMap[];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getSingleValues(
    ...fieldnames: ({ fieldname: string; parent?: string } | string)[]
  ): Promise<{ fieldname: string; parent: string; value: DocValue }[]> {
    const out: { fieldname: string; parent: string; value: DocValue }[] = [];
    for (const f of fieldnames) {
      const fieldname = typeof f === 'string' ? f : f.fieldname;
      const parent = typeof f === 'string' ? undefined : f.parent;
      if (parent) {
        const v = this.#singles.get(parent)?.get(fieldname);
        if (v !== undefined) out.push({ fieldname, parent, value: v });
      } else {
        for (const [p, map] of this.#singles.entries()) {
          if (map.has(fieldname)) out.push({ fieldname, parent: p, value: map.get(fieldname)! });
        }
      }
    }
    return out;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async rename(schemaName: string, oldName: string, newName: string): Promise<void> {
    const table = this.#tables.get(schemaName);
    const row = table?.get(oldName);
    if (row && table) {
      table.delete(oldName);
      row.name = newName;
      table.set(newName, row);
    }
  }

  async update(schemaName: string, fieldValueMap: DocValueMap): Promise<void> {
    const name = fieldValueMap.name as string;
    if (this.schemaMap[schemaName]?.isSingle) {
      await this.insert(schemaName, fieldValueMap);
      return;
    }
    const table = this.#tables.get(schemaName);
    const existing = table?.get(name);
    if (existing && table) {
      const merged = { ...existing, ...fieldValueMap, name };
      table.set(name, merged);
    } else if (table) {
      table.set(name, { ...fieldValueMap });
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(schemaName: string, name: string): Promise<void> {
    if (this.schemaMap[schemaName]?.isSingle) {
      // For isSingle, delete means clear field? simplified: delete parent map entry if name is fieldname
      const map = this.#singles.get(schemaName);
      if (map) map.delete(name);
      return;
    }
    this.#tables.get(schemaName)?.delete(name);
  }

  async deleteAll(schemaName: string, filters: QueryFilter): Promise<number> {
    const rows = await this.getAll(schemaName, { filters });
    let count = 0;
    for (const r of rows) {
      await this.delete(schemaName, r.name as string);
      count++;
    }
    return count;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async exists(schemaName: string, name?: string): Promise<boolean> {
    if (this.schemaMap[schemaName]?.isSingle) {
      return this.#singles.has(schemaName);
    }
    const table = this.#tables.get(schemaName);
    if (!table) return false;
    if (name === undefined) return table.size > 0;
    return table.has(name);
  }

  #series = new Map<string, number>();

  // eslint-disable-next-line @typescript-eslint/require-await
  async getNextAutoincrementId(schemaName: string): Promise<number> {
    const table = this.#tables.get(schemaName);
    if (!table || table.size === 0) return 1;
    let max = 0;
    for (const name of table.keys()) {
      const n = Number(name);
      if (!isNaN(n) && n > max) max = n;
    }
    return max + 1;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getNextSeriesValue(prefix: string, schemaName: string): Promise<number> {
    const key = `${prefix}:${schemaName}`;
    const current = this.#series.get(key) ?? 0;
    let candidate = current + 1;
    let attempts = 0;
    const table = this.#tables.get(schemaName);
    while (attempts < 5) {
      const padded = prefix + String(candidate).padStart(4, '0');
      if (!table?.has(padded)) break;
      candidate += 1;
      attempts += 1;
    }
    this.#series.set(key, candidate);
    return candidate;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async count(schemaName: string, options: GetAllOptions = {}): Promise<number> {
    // Count must be total matching rows, not limited page — ignore LIMIT/OFFSET
    const filters = options.filters;
    if (schemaName === 'SingleValue') {
      const rows: FieldValueMap[] = [];
      for (const [parent, map] of this.#singles.entries()) {
        for (const [fieldname, value] of map.entries()) {
          rows.push({ parent, fieldname, value } as unknown as FieldValueMap);
        }
      }
      const filtered = filters ? rows.filter((r) => this.#matchesFilters(r as unknown as DocValueMap, filters)) : rows;
      return filtered.length;
    }
    const table = this.#tables.get(schemaName);
    const rows = table ? Array.from(table.values()) : [];
    const filtered = filters ? rows.filter((r) => this.#matchesFilters(r, filters)) : rows;
    return filtered.length;
  }

  // Helpers
  #applyGetAllFilters(rows: DocValueMap[], options: GetAllOptions): DocValueMap[] {
    let out: DocValueMap[] = rows;
    if (options.filters) {
      out = out.filter((r) => this.#matchesFilters(r, options.filters!));
    }
    if (options.fields) {
      const fields = options.fields;
      out = out.map((r) => {
        if (fields.includes('*')) return r;
        const f: DocValueMap = {};
        for (const k of fields) if (k in r) f[k] = r[k];
        return f;
      });
    }
    // orderBy/order/groupBy/offset/limit — minimal: only sort by string compare if requested
    if (options.orderBy) {
      const orderBy = Array.isArray(options.orderBy) ? options.orderBy[0] : options.orderBy;
      const dir = options.order === 'desc' ? -1 : 1;
      if (orderBy) {
        out = [...out].sort((a, b) => {
          const av = a[orderBy];
          const bv = b[orderBy];
          if (av === bv) return 0;
          if (av === undefined) return 1;
          if (bv === undefined) return -1;
          return String(av) < String(bv) ? -1 * dir : 1 * dir;
        });
      }
    }
    if (options.offset || options.limit !== undefined) {
      const start = options.offset ?? 0;
      const end = options.limit !== undefined ? start + options.limit : undefined;
      out = out.slice(start, end);
    }
    return out;
  }

  #matchesFilters(row: DocValueMap, filters: QueryFilter): boolean {
    for (const field in filters) {
      const cond = filters[field];
      let operator = '=';
      let value: unknown = cond;
      if (Array.isArray(cond)) {
        operator = String(cond[0]).toLowerCase();
        value = cond[1];
      }
      const actual = row[field];
      if (operator === '=' && actual !== value) return false;
      if ((operator === '!=' || operator === '<>') && actual === value) return false;
      if (operator === 'in' && Array.isArray(value)) {
        if (!value.includes(actual as never)) return false;
      }
      if (operator === 'not in' && Array.isArray(value)) {
        if (value.includes(actual as never)) return false;
      }
      if (operator === 'like' && typeof value === 'string' && typeof actual === 'string') {
        const pattern = value.replace(/%/g, '');
        if (!actual.includes(pattern)) return false;
      }
      // other ops not needed for minimal slice
    }
    return true;
  }
}
