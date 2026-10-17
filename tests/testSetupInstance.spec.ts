import { DateTime } from 'luxon';
import { CreateCOA } from 'src/setup/createCOA';
import setupInstance from 'src/setup/setupInstance';
import { SetupWizardOptions } from 'src/setup/types';
import test from 'tape';
import { getValueMapFromList } from 'utils';
import {
  getTestDbPath,
  getTestFyo,
  getTestSetupWizardOptions,
  setupTestFyo,
} from './helpers';

const setupOptions = getTestSetupWizardOptions();
const fyo = getTestFyo();

setupTestFyo(fyo, __filename);

test('Item values persist after save and reopening the document', async (t) => {
  const accounts = await fyo.db.getAllRaw('Account', {
    fields: ['name', 'accountType', 'rootType', 'isGroup'],
  });
  const incomeAccount = accounts.find(
    (account) => account.rootType === 'Income' && !account.isGroup
  );
  const costOfGoodsSold = accounts.find(
    (account) => account.accountType === 'Cost of Goods Sold' && !account.isGroup
  );

  if (!incomeAccount || !costOfGoodsSold) {
    t.fail('the setup fixture must provide income and cost-of-goods-sold accounts');
    t.end();
    return;
  }

  const itemName = `Regression Item ${Date.now()}`;
  const item = fyo.doc.getNewDoc('Item', {
    name: itemName,
    itemCode: 'REG-ITEM-001',
    itemType: 'Product',
    for: 'Both',
    unit: 'Unit',
    rate: 123.45,
    description: 'Item persistence regression',
    incomeAccount: incomeAccount.name as string,
    expenseAccount: costOfGoodsSold.name as string,
  });

  await item.sync();
  const reopened = await fyo.doc.getDoc('Item', itemName, {
    skipDocumentCache: true,
  });

  t.equal(reopened.name, itemName, 'saved item can be reopened by name');
  t.equal(reopened.itemCode, 'REG-ITEM-001', 'item code persists');
  t.equal(reopened.description, 'Item persistence regression', 'description persists');
  t.equal(reopened.for, 'Both', 'select fields persist');
  t.equal(
    reopened.rate?.toString(),
    item.rate?.toString(),
    'currency field persists without losing its value'
  );
  t.end();
});

test('Chart of Accounts keeps root and child accounts valid and setup is resumable', async (t) => {
  const before = await fyo.db.getAllRaw('Account', {
    fields: ['name', 'parentAccount', 'rootType', 'isGroup'],
  });
  const root = before.find(
    (account) => !account.parentAccount && account.rootType && account.isGroup
  );
  const child = before.find((account) => !!account.parentAccount);

  t.ok(root, 'a root account may have no parent');
  t.ok(child, 'the chart contains child accounts');

  if (root && child) {
    const parent = before.find((account) => account.name === child.parentAccount);
    t.ok(parent, 'child account parent exists');
    t.equal(child.rootType, parent?.rootType, 'child retains the parent root type');
  }

  await new CreateCOA(setupOptions.chartOfAccounts, fyo).run();
  const after = await fyo.db.getAllRaw('Account', { fields: ['name'] });
  t.equal(after.length, before.length, 're-running chart setup does not duplicate accounts');
  t.end();
});

test('setupInstance can be resumed without duplicating chart accounts', async (t) => {
  const before = await fyo.db.getAllRaw('Account', { fields: ['name'] });

  await setupInstance(getTestDbPath(), setupOptions, fyo);

  const after = await fyo.db.getAllRaw('Account', { fields: ['name'] });
  t.equal(after.length, before.length, 'rerunning setup does not duplicate accounts');
  t.ok(
    await fyo.db.exists('PaymentMethod', 'Cash'),
    'the default Cash payment method is available after setup'
  );
  t.ok(
    await fyo.db.exists('PaymentMethod', 'Bank'),
    'the default Bank payment method is available after setup'
  );
  t.end();
});

test('check setup Singles', async (t) => {
  const setupFields = [
    'companyName',
    'country',
    'fullname',
    'email',
    'bankName',
    'fiscalYearStart',
    'fiscalYearEnd',
    'currency',
  ];

  const setupSingles = await fyo.db.getSingleValues(...setupFields);
  const singlesMap = getValueMapFromList(setupSingles, 'fieldname', 'value');

  for (const field of setupFields) {
    let dbValue = singlesMap[field];
    const optionsValue = setupOptions[field as keyof SetupWizardOptions];

    if (dbValue instanceof Date) {
      dbValue = DateTime.fromJSDate(dbValue).toISODate();
    }

    t.equal(
      dbValue as string,
      optionsValue,
      `${field}: (${dbValue}, ${optionsValue})`
    );
  }
});

test('check null singles', async (t) => {
  const nullFields = ['gstin', 'logo', 'phone', 'address'];
  const nullSingles = await fyo.db.getSingleValues(...nullFields);

  t.equal(
    nullSingles.length,
    0,
    `null singles: ${JSON.stringify(nullSingles)}`
  );
});

test.onFinish(async () => {
  await fyo.close();
});
