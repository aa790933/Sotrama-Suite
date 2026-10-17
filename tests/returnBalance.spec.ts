import test from 'tape';
import { buildReturnBalance } from 'models/inventory/returnBalance';
import { ReturnDocItem } from 'models/inventory/types';

test('return balances subtract already returned non-batch quantities', (t) => {
  const original: Record<string, ReturnDocItem> = {
    Item: { quantity: 2 },
  };
  const returned: Record<string, ReturnDocItem> = {
    Item: { quantity: -1 },
  };

  const balance = buildReturnBalance(original, returned);

  t.equal(balance.Item.quantity, -1, 'one of two units remains returnable');
  t.end();
});

test('return balances preserve per-batch quantities and total remaining quantity', (t) => {
  const original: Record<string, ReturnDocItem> = {
    Item: {
      quantity: 3,
      batches: { BatchA: { quantity: 2 }, BatchB: { quantity: 1 } },
    },
  };
  const returned: Record<string, ReturnDocItem> = {
    Item: { quantity: -1, batches: { BatchA: { quantity: -1 } } },
  };

  const balance = buildReturnBalance(original, returned);

  t.equal(
    balance.Item.batches?.BatchA.quantity,
    -1,
    'one unit remains in BatchA'
  );
  t.equal(
    balance.Item.batches?.BatchB.quantity,
    -1,
    'BatchB remains untouched'
  );
  t.equal(balance.Item.quantity, -2, 'two units remain across both batches');
  t.end();
});

test('return balances never become positive after an over-return', (t) => {
  const original: Record<string, ReturnDocItem> = {
    Item: { quantity: 2, batches: {} },
  };
  const returned: Record<string, ReturnDocItem> = {
    Item: { quantity: -3, batches: {} },
  };

  const balance = buildReturnBalance(original, returned);

  t.equal(balance.Item.quantity, 0, 'over-return is clamped to zero');
  t.end();
});
