import type { Field, RawValue } from '../../schemas/types';
import type DatabaseCore from './core';
export type { FieldValueMap } from '../../utils/db/types';

export interface GetQueryBuilderOptions {
  offset?: number;
  limit?: number;
  groupBy?: string | string[];
  orderBy?: string | string[];
  order?: 'desc' | 'asc';
}

export type ColumnDiff = { added: Field[]; removed: string[] };
export type AlterConfig = {
  schemaName: string;
  diff: ColumnDiff;
  newForeignKeys: Field[];
};

export type NonExtantConfig = {
  schemaName: string;
  nonExtant: {
    fieldname: string;
    value: RawValue;
  }[];
};

export type UpdateSinglesConfig = {
  update: string[];
  updateNonExtant: NonExtantConfig[];
};

export type MigrationConfig = {
  pre?: () => Promise<void> | void;
  post?: () => Promise<void> | void;
};

export interface Patch {
  name: string;
  version: string;
  patch: {
    execute: (db: DatabaseCore) => Promise<void>;
    beforeMigrate?: boolean;
  };
  priority?: number;
}

export type DbType =
  | 'text'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'binary';


export type { RawCustomField } from '../../schemas/types';
export type { SingleValue } from '../../utils/db/types';
