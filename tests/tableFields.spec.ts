import type { Field, SchemaMap } from 'schemas/types';
import { resolveTableFields } from 'src/utils/tableFields';
import test from 'tape';

const itemField: Field = {
  fieldname: 'item',
  fieldtype: 'Data',
  label: 'Item',
};

test('table fields safely handle a missing target', (t) => {
  const schemaMap: SchemaMap = {};
  t.deepEqual(
    resolveTableFields(undefined, schemaMap, () => itemField),
    [],
    'undefined target resolves to an empty field list'
  );
  t.deepEqual(
    resolveTableFields('', schemaMap, () => itemField),
    [],
    'empty target resolves to an empty field list'
  );
  t.end();
});

test('table fields safely handle an unknown schema and stale field names', (t) => {
  const schemaMap: SchemaMap = {
    SalesInvoiceItem: {
      name: 'SalesInvoiceItem',
      label: 'Sales Invoice Item',
      fields: [itemField],
      tableFields: ['item', 'missingField'],
    },
  };
  const resolved = resolveTableFields('MissingSchema', schemaMap, () => itemField);
  t.deepEqual(resolved, [], 'unknown schema resolves to an empty field list');

  const fields = resolveTableFields(
    'SalesInvoiceItem',
    schemaMap,
    (_schemaName, fieldname) => (fieldname === 'item' ? itemField : undefined)
  );
  t.deepEqual(fields, [itemField], 'undefined field definitions are excluded');
  t.end();
});
