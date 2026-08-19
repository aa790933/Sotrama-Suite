import {
  Cashflow,
  IncomeExpense,
  TopExpenses,
  TotalCreditAndDebit,
  TotalOutstanding,
} from 'utils/db/types';
import { ModelNameEnum } from '../../models/types';
import DatabaseCore from './core';
import { BespokeFunction } from './types';
import { DocItem, ReturnDocItem } from 'models/inventory/types';
import { safeParseFloat } from 'utils/index';

export class BespokeQueries {
  [key: string]: BespokeFunction;

  static async getLastInserted(
    db: DatabaseCore,
    schemaName: string
  ): Promise<number> {
    const rows = (await db.query(
      `SELECT CAST(name AS UNSIGNED) as num FROM \`${schemaName.toLowerCase()}\` ORDER BY num DESC LIMIT 1`
    )) as { num: number }[];

    const num = rows?.[0]?.num;
    if (num === undefined) {
      return 0;
    }
    return num;
  }

  static async getTopExpenses(
    db: DatabaseCore,
    fromDate: string,
    toDate: string
  ) {
    const query = (await db.query(
      `SELECT account, SUM(CAST(debit AS DECIMAL(18,6)) - CAST(credit AS DECIMAL(18,6))) as total
        FROM \`accountingledgerentry\`
       WHERE reverted = ? AND account IN (
          SELECT name FROM \`account\` WHERE rootType = 'Expense'
       )
       AND date BETWEEN ? AND ?
       GROUP BY account
       ORDER BY total DESC
       LIMIT 5`,
      [0, fromDate, toDate]
    )) as { account: string; total: number }[];

    return query as TopExpenses;
  }

  static async getTotalOutstanding(
    db: DatabaseCore,
    schemaName: string,
    fromDate: string,
    toDate: string
  ) {
    return (
      (await db.query(
        `SELECT SUM(CAST(baseGrandTotal AS DECIMAL(18,6))) as total,
              SUM(CAST(outstandingAmount AS DECIMAL(18,6))) as outstanding
        FROM \`${schemaName.toLowerCase()}\`
       WHERE submitted = ? AND cancelled = ?
       AND date BETWEEN ? AND ?`,
        [1, 0, fromDate, toDate]
      )) as TotalOutstanding[]
    )[0];
  }

  static async getCashflow(db: DatabaseCore, fromDate: string, toDate: string) {
    const query = (await db.query(
      `SELECT
         SUM(CAST(debit AS DECIMAL(18,6))) as inflow,
         SUM(CAST(credit AS DECIMAL(18,6))) as outflow,
         DATE_FORMAT(date, '%Y-%m') as yearmonth
        FROM \`accountingledgerentry\`
       WHERE reverted = ?
       AND account IN (
          SELECT name FROM \`account\`
         WHERE accountType IN ('Cash', 'Bank') AND isGroup = ?
       )
       AND date BETWEEN ? AND ?
       GROUP BY yearmonth`,
      [0, 0, fromDate, toDate]
    )) as Cashflow;
    return query;
  }

  static async getIncomeAndExpenses(
    db: DatabaseCore,
    fromDate: string,
    toDate: string
  ) {
    const income = (await db.query(
      `SELECT SUM(CAST(credit AS DECIMAL(18,6)) - CAST(debit AS DECIMAL(18,6))) as balance,
              DATE_FORMAT(date, '%Y-%m') as yearmonth
        FROM \`accountingledgerentry\`
       WHERE reverted = ?
       AND date BETWEEN ? AND ?
       AND account IN (
          SELECT name FROM \`account\` WHERE rootType = 'Income'
       )
       GROUP BY yearmonth`,
      [0, fromDate, toDate]
    )) as IncomeExpense['income'];

    const expense = (await db.query(
      `SELECT SUM(CAST(debit AS DECIMAL(18,6)) - CAST(credit AS DECIMAL(18,6))) as balance,
              DATE_FORMAT(date, '%Y-%m') as yearmonth
        FROM \`accountingledgerentry\`
       WHERE reverted = ?
       AND date BETWEEN ? AND ?
       AND account IN (
          SELECT name FROM \`account\` WHERE rootType = 'Expense'
       )
       GROUP BY yearmonth`,
      [0, fromDate, toDate]
    )) as IncomeExpense['expense'];

    return { income, expense };
  }

  static async getTotalCreditAndDebit(db: DatabaseCore) {
    return (await db.query(
      `SELECT
         account,
         SUM(CAST(credit AS DECIMAL(18,6))) as totalCredit,
         SUM(CAST(debit AS DECIMAL(18,6))) as totalDebit
        FROM \`accountingledgerentry\`
       GROUP BY account`
    )) as unknown as TotalCreditAndDebit;
  }

  static async getStockQuantity(
    db: DatabaseCore,
    item: string,
    location?: string,
    fromDate?: string,
    toDate?: string,
    batch?: string,
    serialNumbers?: string[]
  ): Promise<number | null> {
    let sql = `SELECT SUM(CAST(quantity AS DECIMAL(18,6))) as total FROM \`${ModelNameEnum.StockLedgerEntry.toLowerCase()}\` WHERE item = ?`;
    const params: unknown[] = [item];

    if (location) {
      sql += ` AND location = ?`;
      params.push(location);
    }

    if (batch) {
      sql += ` AND batch = ?`;
      params.push(batch);
    }

    if (serialNumbers?.length) {
      const placeholders = serialNumbers.map(() => '?').join(', ');
      sql += ` AND serialNumber IN (${placeholders})`;
      params.push(...serialNumbers);
    }

    if (fromDate) {
      sql += ` AND date > ?`;
      params.push(fromDate);
    }

    if (toDate) {
      sql += ` AND date < ?`;
      params.push(toDate);
    }

    const value = (await db.query(sql, params)) as Record<
      string,
      number | null
    >[];
    if (!value.length) {
      return null;
    }

    return value[0][Object.keys(value[0])[0]];
  }

  static async getReturnBalanceItemsQty(
    db: DatabaseCore,
    schemaName: ModelNameEnum,
    docName: string
  ): Promise<Record<string, ReturnDocItem> | undefined> {
    const returnDocRows = (await db.query(
      `SELECT name, returnAgainst FROM \`${schemaName.toLowerCase()}\` WHERE returnAgainst = ? AND submitted = ? AND cancelled = ?`,
      [docName, 1, 0]
    )) as { name: string }[];
    const returnDocNames = returnDocRows.map((r) => r.name);

    if (!returnDocNames.length) {
      return;
    }

    const placeholders = returnDocNames.map(() => '?').join(', ');

    let itemSelect = '';
    let groupByClause = '';

    if (
      [ModelNameEnum.SalesInvoice, ModelNameEnum.PurchaseInvoice].includes(
        schemaName
      )
    ) {
      itemSelect = ', item, batch';
      groupByClause = ' GROUP BY item, batch';
    }

    if (
      [ModelNameEnum.Shipment, ModelNameEnum.PurchaseReceipt].includes(
        schemaName
      )
    ) {
      itemSelect = ', item, batch, serialNumber';
      groupByClause = ' GROUP BY item, batch, serialNumber';
    }

    const returnedItems = (await db.query(
      `SELECT item${itemSelect}, SUM(CAST(quantity AS DECIMAL(18,6))) as quantity
       FROM \`${schemaName.toLowerCase()}item\`
       WHERE parent IN (${placeholders})${groupByClause}`,
      [...returnDocNames]
    )) as DocItem[];

    if (!returnedItems.length) {
      return;
    }

    const docItems = (await db.query(
      `SELECT name${itemSelect}, SUM(CAST(quantity AS DECIMAL(18,6))) as quantity
       FROM \`${schemaName.toLowerCase()}item\`
       WHERE parent = ?${groupByClause}`,
      [docName]
    )) as DocItem[];

    const docItemsMap = BespokeQueries.#getDocItemMap(docItems);
    const returnedItemsMap = BespokeQueries.#getDocItemMap(returnedItems);

    const returnBalanceItems = BespokeQueries.#getReturnBalanceItemQtyMap(
      docItemsMap,
      returnedItemsMap
    );
    return returnBalanceItems;
  }

  static #getDocItemMap(docItems: DocItem[]): Record<string, ReturnDocItem> {
    const docItemsMap: Record<string, ReturnDocItem> = {};
    const batchesMap:
      | Record<
          string,
          { quantity: number; serialNumbers?: string[] | undefined }
        >
      | undefined = {};

    for (const item of docItems) {
      if (!!docItemsMap[item.item]) {
        if (item.batch) {
          let serialNumbers: string[] | undefined;

          if (!docItemsMap[item.item].batches![item.batch]) {
            docItemsMap[item.item].batches![item.batch] = {
              quantity: item.quantity,
              serialNumbers,
            };
          } else {
            docItemsMap[item.item].batches![item.batch] = {
              quantity: (docItemsMap[item.item].batches![item.batch].quantity +=
                item.quantity),
              serialNumbers,
            };
          }
        } else {
          docItemsMap[item.item].quantity += item.quantity;
        }

        if (item.serialNumber) {
          const serialNumbers: string[] = [];

          if (docItemsMap[item.item].serialNumbers) {
            serialNumbers.push(...(docItemsMap[item.item].serialNumbers ?? []));
          }

          serialNumbers.push(...item.serialNumber.split('\n'));
          docItemsMap[item.item].serialNumbers = serialNumbers;
        }
        continue;
      }

      if (item.batch) {
        let serialNumbers: string[] | undefined = undefined;
        if (item.serialNumber) {
          serialNumbers = item.serialNumber.split('\n');
        }

        batchesMap[item.batch] = {
          serialNumbers,
          quantity: item.quantity,
        };
      }

      let serialNumbers: string[] | undefined = undefined;

      if (!item.batch && item.serialNumber) {
        serialNumbers = item.serialNumber.split('\n');
      }

      docItemsMap[item.item] = {
        serialNumbers,
        batches: batchesMap,
        quantity: item.quantity,
      };
    }
    return docItemsMap;
  }

  static #getReturnBalanceItemQtyMap(
    docItemsMap: Record<string, ReturnDocItem>,
    returnedItemsMap: Record<string, ReturnDocItem>
  ): Record<string, ReturnDocItem> {
    const returnBalanceItems: Record<string, ReturnDocItem> | undefined = {};
    const balanceBatchQtyMap:
      | Record<
          string,
          { quantity: number; serialNumbers: string[] | undefined }
        >
      | undefined = {};

    for (const row in docItemsMap) {
      const balanceSerialNumbersMap: string[] | undefined = [];
      let balanceQty = safeParseFloat(-docItemsMap[row].quantity);
      const docItem = docItemsMap[row];
      const returnedDocItem = returnedItemsMap[row];
      const docItemHasBatch = !!Object.keys(docItem.batches ?? {}).length;

      if (returnedItemsMap) {
        for (const item in returnedItemsMap) {
          if (docItemHasBatch && item !== row) {
            continue;
          }

          balanceQty = -(
            Math.abs(balanceQty) + returnedItemsMap[item].quantity
          );

          const returnedItem = returnedItemsMap[item];

          if (docItem.serialNumbers && returnedItem.serialNumbers) {
            for (const serialNumber of docItem.serialNumbers) {
              if (!returnedItem.serialNumbers.includes(serialNumber)) {
                balanceSerialNumbersMap.push(serialNumber);
              }
            }
          }
        }
      }

      if (docItemHasBatch && docItem.batches) {
        for (const batch in docItem.batches) {
          const docItemSerialNumbers = docItem.batches[batch].serialNumbers;
          const itemSerialNumbers = docItem.batches[batch].serialNumbers;
          let balanceSerialNumbers: string[] | undefined;

          if (docItemSerialNumbers && itemSerialNumbers) {
            balanceSerialNumbers = docItemSerialNumbers.filter(
              (serialNumber: string) =>
                itemSerialNumbers.indexOf(serialNumber) == -1
            );
          }

          const ItemQty = Math.abs(docItem.batches[batch].quantity);
          let balanceQty = safeParseFloat(-ItemQty);

          if (!returnedDocItem || !returnedDocItem?.batches) {
            continue;
          }

          const returnedItem = returnedDocItem?.batches[batch];

          if (!returnedItem) {
            balanceBatchQtyMap[batch] = {
              quantity: balanceQty,
              serialNumbers: balanceSerialNumbers,
            };
            continue;
          }

          balanceQty = -(
            Math.abs(safeParseFloat(-ItemQty)) -
            Math.abs(returnedDocItem.batches[batch].quantity)
          );

          balanceBatchQtyMap[batch] = {
            quantity: balanceQty,
            serialNumbers: balanceSerialNumbers,
          };
        }
      }

      returnBalanceItems[row] = {
        quantity: balanceQty,
        batches: balanceBatchQtyMap,
        serialNumbers: balanceSerialNumbersMap,
      };
    }

    return returnBalanceItems;
  }

  static async getPOSTransactedAmount(
    db: DatabaseCore,
    fromDate: Date,
    toDate: Date,
    lastShiftClosingDate?: Date
  ): Promise<Record<string, number> | undefined> {
    let sql = `SELECT name, returnAgainst FROM \`${ModelNameEnum.SalesInvoice.toLowerCase()}\` WHERE isPOS = ? AND date BETWEEN ? AND ?`;
    const params: unknown[] = [1, fromDate.toISOString(), toDate.toISOString()];

    if (lastShiftClosingDate) {
      sql += ` AND created > ?`;
      params.push(lastShiftClosingDate.toISOString());
    }

    const invoices = (await db.query(sql, params)) as {
      name: string;
      returnAgainst: string | null;
    }[];

    if (!invoices.length) {
      return;
    }

    const sinvNames = invoices.map((row) => row.name);
    const invoiceSignMap = invoices.reduce<Record<string, number>>(
      (map, inv) => {
        map[inv.name] = inv.returnAgainst ? -1 : 1;
        return map;
      },
      {}
    );

    const paymentEntryRows = (await db.query(
      `SELECT parent, referenceName FROM \`${ModelNameEnum.PaymentFor.toLowerCase()}\` WHERE referenceName IN (${sinvNames
        .map(() => '?')
        .join(', ')})`,
      [...sinvNames]
    )) as { parent: string; referenceName: string }[];

    const paymentEntryNames = paymentEntryRows.map((doc) => doc.parent);

    if (!paymentEntryNames.length) {
      return;
    }

    const groupedAmounts = (await db.query(
      `SELECT paymentMethod, name, SUM(CAST(amount AS DECIMAL(18,6))) as amount
       FROM \`${ModelNameEnum.Payment.toLowerCase()}\`
       WHERE name IN (${paymentEntryNames.map(() => '?').join(', ')})
       GROUP BY paymentMethod, name`,
      [...paymentEntryNames]
    )) as {
      paymentMethod: string;
      name: string;
      amount: number;
    }[];

    const transactedAmounts: Record<string, number> = {};

    for (const row of groupedAmounts) {
      const paymentRefs = (await db.query(
        `SELECT referenceName FROM \`${ModelNameEnum.PaymentFor.toLowerCase()}\` WHERE parent = ?`,
        [row.name]
      )) as { referenceName: string }[];

      for (const ref of paymentRefs) {
        const sign = invoiceSignMap[ref.referenceName] ?? 1;
        const signedAmount = Number(row.amount) * sign;

        transactedAmounts[row.paymentMethod] =
          (transactedAmounts[row.paymentMethod] ?? 0) + signedAmount;
      }
    }

    return transactedAmounts;
  }
}
