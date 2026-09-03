import { Doc } from 'fyo/model/doc';
import { isPesa } from 'fyo/utils';
import { ValueError } from 'fyo/utils/errors';
import { DateTime } from 'luxon';
import { Field, FieldType, FieldTypeEnum, RawValue, TargetField } from 'schemas/types';
import { getIsNullOrUndef, safeParseFloat, safeParseInt } from 'utils';
import { Attachment, DocValue, DocValueMap, RawValueMap } from './types';
import type { MoneyMaker } from 'pesa';

type FieldMap = Record<string, Record<string, Field>>;

/**
 * # Converter
 *
 * Basically converts serializable RawValues from the db to DocValues used
 * by the frontend and vice versa.
 *
 * ## Value Conversion
 * It exposes two static methods: `toRawValue` and `toDocValue` that can be
 * used elsewhere given the fieldtype.
 *
 * ## Map Conversion
 * Two methods `toDocValueMap` and `toRawValueMap` are exposed but should be
 * used only from the `dbHandler`.
 */

export class Converter {
  fieldMapProvider: () => FieldMap;
  pesaProvider: () => MoneyMaker;

  constructor(
    fieldMapProvider: () => FieldMap,
    pesaProvider: () => MoneyMaker
  ) {
    this.fieldMapProvider = fieldMapProvider;
    this.pesaProvider = pesaProvider;
  }

  toDocValueMap(
    schemaName: string,
    rawValueMap: RawValueMap | RawValueMap[]
  ): DocValueMap | DocValueMap[] {
    rawValueMap ??= {};
    if (Array.isArray(rawValueMap)) {
      return rawValueMap.map((dv) => this.#toDocValueMap(schemaName, dv));
    } else {
      return this.#toDocValueMap(schemaName, rawValueMap);
    }
  }

  toRawValueMap(
    schemaName: string,
    docValueMap: DocValueMap | DocValueMap[]
  ): RawValueMap | RawValueMap[] {
    docValueMap ??= {};
    if (Array.isArray(docValueMap)) {
      return docValueMap.map((dv) => this.#toRawValueMap(schemaName, dv));
    } else {
      return this.#toRawValueMap(schemaName, docValueMap);
    }
  }

  static toDocValue(value: RawValue, field: Field, fyoOrPesa: unknown): DocValue {
    const pesa = (fyoOrPesa as { pesa?: MoneyMaker })?.pesa ?? (fyoOrPesa as MoneyMaker);
    const descriptor = fieldTypeRegistry[field.fieldtype];
    if (descriptor) {
      return descriptor.toDoc(value, field, pesa);
    }
    return toDocString(value, field);
  }

  static toRawValue(value: DocValue, field: Field, fyoOrPesa: unknown): RawValue {
    const pesa = (fyoOrPesa as { pesa?: MoneyMaker })?.pesa ?? (fyoOrPesa as MoneyMaker);
    const descriptor = fieldTypeRegistry[field.fieldtype];
    if (descriptor) {
      return descriptor.toRaw(value, field, pesa);
    }
    return toRawString(value, field);
  }

  #toDocValueMap(schemaName: string, rawValueMap: RawValueMap): DocValueMap {
    const fieldValueMap = this.fieldMapProvider()[schemaName] ?? {};
    const docValueMap: DocValueMap = {};

    for (const fieldname in rawValueMap) {
      const field = fieldValueMap[fieldname];
      const rawValue = rawValueMap[fieldname];
      if (!field) {
        docValueMap[fieldname] = rawValue as DocValue;
        continue;
      }

      if (Array.isArray(rawValue)) {
        const parentSchemaName = (field as TargetField).target;
        docValueMap[fieldname] = rawValue.map((rv) =>
          this.#toDocValueMap(parentSchemaName, rv)
        );
      } else {
        docValueMap[fieldname] = Converter.toDocValue(
          rawValue,
          field,
          this.pesaProvider()
        );
      }
    }

    return docValueMap;
  }

  #toRawValueMap(schemaName: string, docValueMap: DocValueMap): RawValueMap {
    const fieldValueMap = this.fieldMapProvider()[schemaName] ?? {};
    const rawValueMap: RawValueMap = {};

    for (const fieldname in docValueMap) {
      const field = fieldValueMap[fieldname];
      const docValue = docValueMap[fieldname];
      if (!field) {
        // Unknown field (e.g., test Party without schema) — pass through as Data
        rawValueMap[fieldname] = docValue as RawValue;
        continue;
      }

      if (Array.isArray(docValue)) {
        const parentSchemaName = (field as TargetField).target;

        rawValueMap[fieldname] = docValue.map((value) => {
          if (value instanceof Doc) {
            return this.#toRawValueMap(parentSchemaName, value.getValidDict());
          }

          return this.#toRawValueMap(parentSchemaName, value);
        });
      } else {
        rawValueMap[fieldname] = Converter.toRawValue(
          docValue,
          field,
          this.pesaProvider()
        );
      }
    }

    return rawValueMap;
  }
}

export type FieldTypeDescriptor = {
  toDoc: (value: RawValue, field: Field, pesa: MoneyMaker) => DocValue;
  toRaw: (value: DocValue, field: Field, pesa: MoneyMaker) => RawValue;
};

const fieldTypeRegistry: Partial<Record<FieldType, FieldTypeDescriptor>> = {
  [FieldTypeEnum.Currency]: {
    toDoc: (value, field, pesa) => toDocCurrency(value, field, pesa),
    toRaw: (value, field, pesa) => toRawCurrency(value, pesa, field),
  },
  [FieldTypeEnum.Date]: {
    toDoc: (value, field) => toDocDate(value, field),
    toRaw: (value, field) => toRawDate(value, field),
  },
  [FieldTypeEnum.Datetime]: {
    toDoc: (value, field) => toDocDate(value, field),
    toRaw: (value, field) => toRawDateTime(value, field),
  },
  [FieldTypeEnum.Int]: {
    toDoc: (value, field) => toDocInt(value, field),
    toRaw: (value, field) => toRawInt(value, field),
  },
  [FieldTypeEnum.Float]: {
    toDoc: (value, field) => toDocFloat(value, field),
    toRaw: (value, field) => toRawFloat(value, field),
  },
  [FieldTypeEnum.Check]: {
    toDoc: (value, field) => toDocCheck(value, field),
    toRaw: (value, field) => toRawCheck(value, field),
  },
  [FieldTypeEnum.Link]: {
    toDoc: (value, field) => toDocString(value, field),
    toRaw: (value, field) => toRawLink(value, field),
  },
  [FieldTypeEnum.Attachment]: {
    toDoc: (value, field) => toDocAttachment(value, field),
    toRaw: (value, field) => toRawAttachment(value, field),
  },
  [FieldTypeEnum.Button]: {
    toDoc: (value, field) => toDocString(value, field),
    toRaw: () => null,
  },
};

function toDocString(value: RawValue, field: Field) {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  throwError(value, field, 'doc');
}

function toDocDate(value: RawValue, field: Field) {
  if ((value as unknown) instanceof Date) {
    return value;
  }

  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throwError(value, field, 'doc');
  }

  const date = DateTime.fromISO(value.replace(' ', 'T'), { zone: 'utc' }).toJSDate();
  if (date.toString() === 'Invalid Date') {
    throwError(value, field, 'doc');
  }

  return date;
}

function toDocCurrency(value: RawValue, field: Field, pesa: MoneyMaker) {
  if (isPesa(value)) {
    return value;
  }

  if (value === '') {
    return pesa(0);
  }

  if (typeof value === 'string') {
    return pesa(value);
  }

  if (typeof value === 'number') {
    return pesa(value);
  }

  if (typeof value === 'boolean') {
    return pesa(Number(value));
  }

  if (value === null) {
    return pesa(0);
  }

  throwError(value, field, 'doc');
}

function toDocInt(value: RawValue, field: Field): number {
  if (value === '') {
    return 0;
  }

  if (typeof value === 'string') {
    value = safeParseInt(value);
  }

  return toDocFloat(value, field);
}

function toDocFloat(value: RawValue, field: Field): number {
  if (value === '') {
    return 0;
  }

  if (typeof value === 'boolean') {
    return Number(value);
  }

  if (typeof value === 'string') {
    value = safeParseFloat(value);
  }

  if (value === null) {
    value = 0;
  }

  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }

  throwError(value, field, 'doc');
}

function toDocCheck(value: RawValue, field: Field): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return !!safeParseFloat(value);
  }

  if (typeof value === 'number') {
    return Boolean(value);
  }

  throwError(value, field, 'doc');
}

function toDocAttachment(value: RawValue, field: Field): null | Attachment {
  if (!value) {
    return null;
  }

  if (typeof value !== 'string') {
    throwError(value, field, 'doc');
  }

  try {
    return (JSON.parse(value) as Attachment) || null;
  } catch {
    throwError(value, field, 'doc');
  }
}

function toRawCurrency(value: DocValue, pesa: MoneyMaker, field: Field): string {
  if (isPesa(value)) {
    return value.store;
  }

  if (getIsNullOrUndef(value)) {
    return pesa(0).store;
  }

  if (typeof value === 'number') {
    return pesa(value).store;
  }

  if (typeof value === 'string') {
    return pesa(value).store;
  }

  throwError(value, field, 'raw');
}

function toRawInt(value: DocValue, field: Field): number {
  if (typeof value === 'string') {
    return safeParseInt(value);
  }

  if (getIsNullOrUndef(value)) {
    return 0;
  }

  if (typeof value === 'number') {
    return Math.floor(value);
  }

  throwError(value, field, 'raw');
}

function toRawFloat(value: DocValue, field: Field): number {
  if (typeof value === 'string') {
    return safeParseFloat(value);
  }

  if (getIsNullOrUndef(value)) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  throwError(value, field, 'raw');
}

function toRawDate(value: DocValue, field: Field): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    value = new Date(value);
  }

  if (value instanceof Date) {
    return DateTime.fromJSDate(value).toISODate();
  }

  if (value instanceof DateTime) {
    return value.toISODate();
  }

  throwError(value, field, 'raw');
}

function toRawDateTime(value: DocValue, field: Field): string | null {
  if (value === null || value === '') {
    return null;
  }

  // MariaDB's DATETIME rejects ISO-8601 with a 'T' separator and/or a trailing
  // 'Z' timezone designator (SQLState 22007 / errno 1292). Emit the
  // space-separated, timezone-naive UTC form that MariaDB accepts, matching
  // the format used for the singlevalue `modified` column elsewhere. The
  // driver parses this back into a Date on read (with TZ=UTC), so the UTC
  // microsecond instant is preserved end-to-end.
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (value instanceof DateTime) {
    date = value.toJSDate();
  } else if (typeof value === 'string') {
    date = new Date(value);
  } else {
    throwError(value, field, 'raw');
  }

  if (Number.isNaN(date.getTime())) {
    throwError(value, field, 'raw');
  }

  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function toRawCheck(value: DocValue, field: Field): number {
  if (typeof value === 'number') {
    value = Boolean(value);
  }

  if (typeof value === 'boolean') {
    return Number(value);
  }

  throwError(value, field, 'raw');
}

function toRawString(value: DocValue, field: Field): string | null {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  throwError(value, field, 'raw');
}

function toRawLink(value: DocValue, field: Field): string | null {
  if (value === null || !(value as string)?.length) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  throwError(value, field, 'raw');
}

function toRawAttachment(value: DocValue, field: Field): null | string {
  if (!value) {
    return null;
  }

  if (
    (value as Attachment)?.name &&
    (value as Attachment)?.data &&
    (value as Attachment)?.type
  ) {
    return JSON.stringify(value);
  }

  throwError(value, field, 'raw');
}

function throwError<T>(value: T, field: Field, type: 'raw' | 'doc'): never {
  throw new ValueError(
    `invalid ${type} conversion '${String(
      value
    )}' of type ${typeof value} found, field: ${JSON.stringify(field)}`
  );
}
