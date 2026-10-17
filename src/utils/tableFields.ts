import type { Field, SchemaMap } from 'schemas/types';

/** Resolve a table control's child fields without assuming its target is valid. */
export function resolveTableFields(
  target: unknown,
  schemaMap: SchemaMap,
  getField: (schemaName: string, fieldname: string) => Field | undefined
): Field[] {
  if (typeof target !== 'string' || target.length === 0) {
    return [];
  }

  const schema = schemaMap[target];
  if (!schema) {
    return [];
  }

  return (schema.tableFields ?? [])
    .map((fieldname) => getField(target, fieldname))
    .filter((field): field is Field => field !== undefined && field !== null);
}
