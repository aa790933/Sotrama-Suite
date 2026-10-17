import test from 'tape';
import { Payment } from 'models/baseModels/Payment/Payment';

test('payment filters safely handle a missing document', (t) => {
  const filters = Payment.filters;
  const missingDoc = null as never;

  t.deepEqual(
    filters.party!(missingDoc),
    {},
    'party filter accepts no document'
  );
  t.deepEqual(
    filters.account!(missingDoc),
    {},
    'account filter accepts no document'
  );
  t.deepEqual(
    filters.paymentAccount!(missingDoc),
    {},
    'payment-account filter accepts no document'
  );
  t.end();
});

test('payment account filters reflect invoice return direction', (t) => {
  const filters = Payment.filters;
  const salesReturn = {
    paymentType: 'Pay',
    paymentMethod: 'Cash',
    referenceType: 'SalesInvoice',
  } as never;
  const purchaseReturn = {
    paymentType: 'Receive',
    paymentMethod: 'Cash',
    referenceType: 'PurchaseInvoice',
  } as never;

  t.deepEqual(
    filters.paymentAccount!(salesReturn),
    { accountType: 'Receivable', isGroup: false },
    'sales returns settle the receivable account'
  );
  t.deepEqual(
    filters.account!(purchaseReturn),
    { accountType: 'Payable', isGroup: false },
    'purchase returns settle the payable account'
  );
  t.deepEqual(
    filters.paymentAccount!(purchaseReturn),
    { accountType: 'Cash', isGroup: false },
    'cash purchase returns use a cash account'
  );
  t.end();
});
