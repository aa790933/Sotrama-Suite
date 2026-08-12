import fs from 'fs/promises';
import { RawValueMap } from 'fyo/core/types';
import path from 'path';
import { changeKeys, deleteKeys, getIsNullOrUndef, invertMap } from 'utils';
import { getCountryCodeFromCountry } from 'utils/misc';
import { Version } from 'utils/version';
import { ModelNameEnum } from '../../models/types';
import { FieldTypeEnum, Schema, SchemaMap } from '../../schemas/types';
import { DatabaseManager } from '../database/manager';
import DatabaseCore, { MariaDBConfig } from '../database/core';
import { getRandomString } from '../../utils/index';

const ignoreColumns = ['keywords'];
const columnMap = { creation: 'created', owner: 'createdBy' };
const childTableColumnMap = {
  parenttype: 'parentSchemaName',
  parentfield: 'parentFieldname',
};

const defaultNumberSeriesMap = {
  [ModelNameEnum.Payment]: 'PAY-',
  [ModelNameEnum.JournalEntry]: 'JV-',
  [ModelNameEnum.SalesInvoice]: 'SINV-',
  [ModelNameEnum.PurchaseInvoice]: 'PINV-',
  [ModelNameEnum.SalesQuote]: 'SQUOT-',
} as Record<ModelNameEnum, string>;

async function execute(dm: DatabaseManager) {
  const db = dm.db;
  if (!db || !db.pool) {
    return;
  }

  const version = (
    (await db.query(
      `SELECT value FROM SingleValue WHERE fieldname = ? AND parent = ?`
    )) as { value: string }[]
  )?.[0]?.value;

  /**
   * Versions after this should have the new schemas
   */

  if (version && Version.gt(version, '0.4.3-beta.0')) {
    return;
  }

  /**
   * For MariaDB, this migration patch is no longer needed since
   * migrate() handles schema creation automatically.
   * Just mark the version to prevent re-execution.
   */
  await db.query(
    `INSERT INTO SingleValue (name, parent, fieldname, value, created, modified, createdBy, modifiedBy)
     VALUES (?, 'SystemSettings', 'version', ?, NOW(), NOW(), '__SYSTEM__', '__SYSTEM__')
     ON DUPLICATE KEY UPDATE value = ?`,
    [getRandomString(), '0.5.0-beta.0', '0.5.0-beta.0']
  );
}

// The following migration helpers (copyData, copyNumberSeries, copyLedgerEntries, etc.)
// were used for the SQLite-to-new-schema migration and are no longer needed
// in the MariaDB-only setup. migrate() in DatabaseCore handles schema evolution.

function notNullify(map: RawValueMap, schema: Schema) {
  for (const field of schema.fields) {
    if (!field.required || !getIsNullOrUndef(map[field.fieldname])) {
      continue;
    }

    switch (field.fieldtype) {
      case FieldTypeEnum.Float:
      case FieldTypeEnum.Int:
      case FieldTypeEnum.Check:
        map[field.fieldname] = 0;
        break;
      case FieldTypeEnum.Currency:
        map[field.fieldname] = '0.00000000000';
        break;
      case FieldTypeEnum.Table:
        continue;
      default:
        map[field.fieldname] = '';
    }
  }
}

function deleteOldKeys(map: RawValueMap, newKeys: string[]) {
  for (const key of Object.keys(map)) {
    if (newKeys.includes(key)) {
      continue;
    }

    delete map[key];
  }
}

export default { execute, beforeMigrate: true };
