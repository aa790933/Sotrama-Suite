import test from 'tape';
import { Fyo } from 'fyo';
import { MemoryDatabaseAdapter } from 'fyo/database/MemoryDatabaseAdapter';
import { models } from 'models/index';
import { DummyAuthDemux } from './helpers';

function getMemoryFyo() {
  return new Fyo({
    database: new MemoryDatabaseAdapter(),
    AuthDemux: DummyAuthDemux,
    isTest: true,
    isElectron: false,
  });
}

async function getInitializedFyo() {
  const fyo = getMemoryFyo();
  await fyo.db.createNewDatabase('', 'in');
  await fyo.initializeAndRegister(models);
  return fyo;
}

test('fresh SalesInvoice formulas resolve without a party (no FK rejection)', async (t) => {
  const fyo = await getInitializedFyo();
  const doc = fyo.doc.getNewDoc('SalesInvoice');
  await doc.runFormulas();
  t.equal(
    doc.get('account'),
    '',
    'account falls back to empty, not a rejected link query'
  );
  t.ok(
    (doc.get('currency') as string | undefined) === undefined ||
      typeof doc.get('currency') === 'string',
    'currency falls back without throwing'
  );
  t.equal(doc.get('loyaltyProgram'), '', 'loyaltyProgram falls back to empty');
  await fyo.close();
  t.end();
});

test('fresh InvoiceItem formulas resolve without an item', async (t) => {
  const fyo = await getInitializedFyo();
  const doc = fyo.doc.getNewDoc('SalesInvoiceItem');
  await doc.runFormulas();
  t.equal(doc.get('account'), '', 'line account falls back to empty');
  t.equal(doc.get('description'), '', 'description falls back to empty');
  t.equal(doc.get('tax'), '', 'tax falls back to empty');
  await fyo.close();
  t.end();
});

test('fresh Payment formulas resolve without party or payment method', async (t) => {
  const fyo = await getInitializedFyo();
  const doc = fyo.doc.getNewDoc('Payment');
  await doc.runFormulas();
  t.ok(
    (doc.get('account') as string | null | undefined) == null ||
      typeof doc.get('account') === 'string',
    'payment account resolves to null/string, never throws'
  );
  t.ok(
    (doc.get('paymentAccount') as string | null | undefined) == null ||
      typeof doc.get('paymentAccount') === 'string',
    'paymentAccount resolves to null/string, never throws'
  );
  await fyo.close();
  t.end();
});
