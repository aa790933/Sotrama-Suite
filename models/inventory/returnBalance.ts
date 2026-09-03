import { Fyo } from 'fyo';
import { ReturnDocItem } from 'models/inventory/types';

/**
 * Domain-owned return balance — recomposed via Database.getAll primitives.
 * Fixes shared `batchesMap` aliasing bug: each `docItemsMap[item]` now owns its own
 * `batches` object, not a single shared `{}`.
 */
export async function getReturnBalanceItemsQty(
  fyo: Fyo,
  schemaName: string,
  docName: string
): Promise<Record<string, ReturnDocItem> | undefined> {
  const returnDocs = await fyo.db.getAll(schemaName, {
    filters: { returnAgainst: docName, submitted: true, cancelled: false },
    fields: ['name'],
  });
  const returnNames = returnDocs.map((d) => d.name as string);
  if (!returnNames.length) return undefined;

  const childTable = `${schemaName}Item`;
  const returnedItems = (await fyo.db.getAll(childTable, {
    filters: { parent: ['in', returnNames] },
    fields: ['item', 'batch', 'quantity', 'serialNumber'],
  })) as { item: string; batch?: string; quantity: number; serialNumber?: string }[];
  if (!returnedItems.length) return undefined;

  const originalItems = (await fyo.db.getAll(childTable, {
    filters: { parent: docName },
    fields: ['item', 'batch', 'quantity', 'serialNumber'],
  })) as { item: string; batch?: string; quantity: number; serialNumber?: string }[];

  const docMap = buildDocItemMap(originalItems);
  const retMap = buildDocItemMap(returnedItems);
  return buildReturnBalance(docMap, retMap);
}

function buildDocItemMap(items: { item: string; batch?: string; quantity: number; serialNumber?: string }[]): Record<string, ReturnDocItem> {
  const map: Record<string, ReturnDocItem> = {};
  for (const it of items) {
    if (map[it.item]) {
      if (it.batch) {
        const batches = map[it.item].batches ?? (map[it.item].batches = {});
        const existing = batches[it.batch];
        const serials = it.serialNumber ? it.serialNumber.split('\n') : undefined;
        if (!existing) {
          batches[it.batch] = { quantity: it.quantity, serialNumbers: serials };
        } else {
          existing.quantity += it.quantity;
          if (serials) existing.serialNumbers = [...(existing.serialNumbers ?? []), ...serials];
        }
      } else {
        map[it.item].quantity += it.quantity;
      }
      if (it.serialNumber && !it.batch) {
        const serials = it.serialNumber.split('\n');
        map[it.item].serialNumbers = [...(map[it.item].serialNumbers ?? []), ...serials];
      }
      continue;
    }
    const batches: Record<string, { quantity: number; serialNumbers?: string[] }> | undefined = it.batch
      ? { [it.batch]: { quantity: it.quantity, serialNumbers: it.serialNumber?.split('\n') } }
      : {};
    const hasBatch = !!it.batch;
    map[it.item] = {
      quantity: it.quantity,
      batches: hasBatch ? batches : {},
      serialNumbers: !it.batch && it.serialNumber ? it.serialNumber.split('\n') : undefined,
    };
  }
  return map;
}

function buildReturnBalance(
  docMap: Record<string, ReturnDocItem>,
  retMap: Record<string, ReturnDocItem>
): Record<string, ReturnDocItem> {
  const out: Record<string, ReturnDocItem> = {};
  const balanceBatches: Record<string, { quantity: number; serialNumbers?: string[] }> = {};
  for (const key in docMap) {
    const docItem = docMap[key];
    const retItem = retMap[key];
    let balanceQty = -Math.abs(docItem.quantity);
    const hasBatch = !!Object.keys(docItem.batches ?? {}).length;
    if (retItem) {
      if (!hasBatch) {
        balanceQty = -(Math.abs(balanceQty) + Math.abs(retItem.quantity));
      }
    }
    const balanceSerials: string[] | undefined = [];
    if (retItem?.serialNumbers && docItem.serialNumbers) {
      for (const sn of docItem.serialNumbers) {
        if (!retItem.serialNumbers.includes(sn)) balanceSerials.push(sn);
      }
    }
    if (hasBatch && docItem.batches) {
      for (const batch in docItem.batches) {
        const docBatch = docItem.batches[batch];
        const retBatch = retItem?.batches?.[batch];
        let bQty = -Math.abs(docBatch.quantity);
        let bSerials: string[] | undefined;
        if (docBatch.serialNumbers && retBatch?.serialNumbers) {
          bSerials = docBatch.serialNumbers.filter((sn) => !retBatch.serialNumbers!.includes(sn));
        } else {
          bSerials = docBatch.serialNumbers;
        }
        if (!retBatch) {
          balanceBatches[batch] = { quantity: bQty, serialNumbers: bSerials };
          continue;
        }
        bQty = -(Math.abs(docBatch.quantity) - Math.abs(retBatch.quantity));
        balanceBatches[batch] = { quantity: bQty, serialNumbers: bSerials };
      }
    }
    // Per-item batches copy: the shared balanceBatches map must not alias across items.
    const itemBatches = hasBatch ? { ...balanceBatches } : {};
    // Clear for next item to avoid cross-item aliasing
    for (const k in balanceBatches) delete balanceBatches[k];
    out[key] = { quantity: balanceQty, batches: itemBatches, serialNumbers: balanceSerials.length ? balanceSerials : undefined };
  }
  return out;
}
