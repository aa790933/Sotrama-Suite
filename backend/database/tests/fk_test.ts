import DatabaseCore from '../core';
import { getDefaultMetaFieldValueMap } from '../../helpers';
import { SchemaMap, SchemaStub } from 'schemas/types';
import { getTestDbConfig } from './dbTestConfig';

const testDbConfig = getTestDbConfig('test_books_core');

const Customer = {
  name: 'Customer',
  label: 'Customer',
  fields: [
    { fieldname: 'name', label: 'Name', fieldtype: 'Data', required: true },
    {
      fieldname: 'email',
      label: 'Email',
      fieldtype: 'Data',
      placeholder: 'john@thoe.com',
    },
    {
      fieldname: 'phone',
      label: 'Phone',
      fieldtype: 'Data',
      placeholder: '9999999999',
    },
  ],
  quickEditFields: ['email'],
  keywordFields: ['name'],
};

const SalesInvoiceItem = {
  name: 'SalesInvoiceItem',
  label: 'Sales Invoice Item',
  isChild: true,
  fields: [
    { fieldname: 'item', label: 'Item', fieldtype: 'Data', required: true },
    {
      fieldname: 'quantity',
      label: 'Quantity',
      fieldtype: 'Float',
      required: true,
      default: 1,
    },
    { fieldname: 'rate', label: 'Rate', fieldtype: 'Float', required: true },
    {
      fieldname: 'amount',
      label: 'Amount',
      fieldtype: 'Float',
      readOnly: true,
    },
  ],
  tableFields: ['item', 'quantity', 'rate', 'amount'],
};

const SalesInvoice = {
  name: 'SalesInvoice',
  label: 'Sales Invoice',
  isSingle: false,
  isChild: false,
  isSubmittable: true,
  keywordFields: ['name', 'customer'],
  fields: [
    {
      label: 'Invoice No',
      fieldname: 'name',
      fieldtype: 'Data',
      required: true,
      readOnly: true,
    },
    { fieldname: 'date', label: 'Date', fieldtype: 'Date' },
    {
      fieldname: 'customer',
      label: 'Customer',
      fieldtype: 'Link',
      target: 'Customer',
      required: true,
    },
    {
      fieldname: 'account',
      label: 'Account',
      fieldtype: 'Data',
      required: true,
    },
    {
      fieldname: 'items',
      label: 'Items',
      fieldtype: 'Table',
      target: 'SalesInvoiceItem',
      required: true,
    },
    {
      fieldname: 'grandTotal',
      label: 'Grand Total',
      fieldtype: 'Currency',
      readOnly: true,
    },
  ],
};

const schemaMap = {
  SingleValue: {
    name: 'SingleValue',
    fields: [
      { fieldname: 'name', label: 'Name', fieldtype: 'Data' },
      { fieldname: 'parent', label: 'Parent', fieldtype: 'Data' },
      { fieldname: 'fieldname', label: 'Fieldname', fieldtype: 'Data' },
      { fieldname: 'value', label: 'Value', fieldtype: 'Text' },
      { fieldname: 'createdBy', label: 'Created By', fieldtype: 'Data' },
      { fieldname: 'modifiedBy', label: 'Modified By', fieldtype: 'Data' },
      { fieldname: 'created', label: 'Created', fieldtype: 'Datetime' },
      { fieldname: 'modified', label: 'Modified', fieldtype: 'Datetime' },
    ],
    isSingle: true,
  },
  Customer: Customer as SchemaStub,
  SalesInvoiceItem: SalesInvoiceItem as SchemaStub,
  SalesInvoice: SalesInvoice as SchemaStub,
  SystemSettings: {
    name: 'SystemSettings',
    fields: [
      {
        fieldname: 'countryCode',
        label: 'Country Code',
        fieldtype: 'Data',
        default: 'in',
      },
      {
        fieldname: 'dateFormat',
        label: 'Date Format',
        fieldtype: 'Data',
        default: 'dd/mm/yyyy',
      },
      {
        fieldname: 'locale',
        label: 'Locale',
        fieldtype: 'Data',
        default: 'en',
      },
    ],
    isSingle: true,
  },
} as unknown as SchemaMap;

async function main() {
  // Clean database
  const adminDb = new DatabaseCore(undefined, {
    ...testDbConfig,
    database: 'test',
  });
  await adminDb.connect();
  await adminDb.query(`DROP TABLE IF EXISTS test_books_core.singlevalue`);
  await adminDb.query(`DROP TABLE IF EXISTS test_books_core.customer`);
  await adminDb.query(`DROP TABLE IF EXISTS test_books_core.salesinvoice`);
  await adminDb.query(`DROP TABLE IF EXISTS test_books_core.salesinvoiceitem`);
  await adminDb.query(`DROP TABLE IF EXISTS test_books_core.systemsettings`);
  await adminDb.close();

  const db = new DatabaseCore(undefined, testDbConfig);
  await db.connect();
  db.setSchemaMap(schemaMap);

  // Migrate
  await db.migrate();

  // Check FK constraint exists
  const fks = await db.query(`
    SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salesinvoice' AND REFERENCED_TABLE_NAME IS NOT NULL
  `);
  console.log('FK constraints:', JSON.stringify(fks, null, 2));

  // Test 1: Insert SalesInvoice with non-existent Customer - should fail
  console.log(
    '\n--- Test 1: Insert SalesInvoice referencing non-existent Customer ---'
  );
  try {
    await db.insert('SalesInvoice', {
      name: 'SINV-1001',
      customer: 'NonExistentCustomer',
      account: 'Debtors',
      submitted: false,
      cancelled: false,
      ...getDefaultMetaFieldValueMap(),
    });
    console.log('FAIL: Insert should have thrown FK constraint error');
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg?.includes('foreign key constraint') ||
      msg?.includes('errno: 1452') ||
      msg?.includes('1452')
    ) {
      console.log(
        'PASS: FK violation correctly rejected:',
        msg.split('\\n')[0]?.trim()
      );
    } else {
      console.log('UNEXPECTED ERROR:', msg?.split('\\n')[0]?.trim());
    }
  }

  // Test 2: Insert Customer, then SalesInvoice - should succeed
  console.log('\\n--- Test 2: Insert Customer, then SalesInvoice ---');
  await db.insert('Customer', {
    name: 'John Whoe',
    email: 'john@whoe.com',
    ...getDefaultMetaFieldValueMap(),
  });
  try {
    await db.insert('SalesInvoice', {
      name: 'SINV-1001',
      customer: 'John Whoe',
      account: 'Debtors',
      submitted: false,
      cancelled: false,
      ...getDefaultMetaFieldValueMap(),
    });
    console.log('PASS: Insert succeeded with valid Customer reference');
  } catch (err) {
    console.log(
      'FAIL: Insert should not have thrown:',
      (err as Error).message.split('\\n')[0]?.trim()
    );
  }

  // Test 3: Delete Customer with existing SalesInvoice - should fail
  console.log(
    '\\n--- Test 3: Delete Customer with existing SalesInvoice reference ---'
  );
  try {
    await db.delete('Customer', 'John Whoe');
    console.log('FAIL: Delete should have thrown FK constraint error');
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg?.includes('foreign key constraint') ||
      msg?.includes('errno: 1452') ||
      msg?.includes('1452') ||
      msg?.includes('cannot delete or update')
    ) {
      console.log(
        'PASS: FK constraint correctly prevented delete:',
        msg.split('\\n')[0]?.trim()
      );
    } else {
      console.log('UNEXPECTED ERROR:', msg?.split('\\n')[0]?.trim());
    }
  }

  // Test 4: Delete SalesInvoice first, then Customer - should succeed
  console.log('\\n--- Test 4: Delete SalesInvoice first, then Customer ---');
  await db.delete('SalesInvoice', 'SINV-1001');
  try {
    await db.delete('Customer', 'John Whoe');
    console.log('PASS: Delete succeeded after removing dependent record');
  } catch (err) {
    console.log(
      'FAIL: Delete should not have thrown:',
      (err as Error).message.split('\\n')[0]?.trim()
    );
  }

  await db.close();
  console.log('\\n=== FK Constraint Tests Complete ===');
}

main().catch(console.error);
