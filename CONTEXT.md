# Sotrama Suite — Domain Context

## Language

- **Company** — legal entity, maps to `Company`/`SystemSettings` (countryCode, currency, fiscalYear). One `PersistedConnection` per company.
- **Connection** — `MariaDBConfig {host,port,user,password,database}` persisted as `PersistedConnection {id,companyName,host,port,user,database,openCount}` and displayed as `ConnectionMetadata {display}`. `connectionId` is the stable identifier; `filesystemPath` never means a DB connection. Identity is `equalsConnection` (host+port+database+user), display is `toSafeDisplay`, resolution (id-or-JSON → config) is `ConnectionStore.resolve`; no SQLite file checks or files-list fallback remain on the main side.
- **PricingEngine** — `models/pricing/PricingEngine.ts` (pure `lineDiscount`/`totalItemDiscount`/`invoiceDiscountAmount`/`totalDiscount`/`lineTax`/`summarizeTaxes`/`sumWithTaxes`; tax path takes pre-signed amounts). `Invoice`/`StockTransfer` delegate; rule fetching is batched per document, `updatePricingRule` applies inline.
- **AccountingLedgerSummary** — `reports/finance/ledgerSummary.ts` (`getLedgerEntries` always `reverted:false` with inclusive JS date bounds, `monthKey`, `parseAmount`); the 5 finance reports delegate to it. `FieldTypeRegistry` (`fyo/core/converter.ts:FieldTypeDescriptor`) dispatches Doc↔Raw conversion per `FieldType`.
- **Database** — `Database` interface at `Fyo.db:Database` (`fyo/database/Database.ts`) — typed `DocValueMap` surface (`insert/get/getAll/update/delete/rename/deleteAll/exists/close/count/getSingleValues/getNextAutoincrementId/getNextSeriesValue`). `RawValueMap` only via narrow `getAllRaw` for `search`/`export`/`reports`.
- **MainDatabase** — `backend/database/core.ts:DatabaseCore` (`MariaDB` `pool`, `FOR UPDATE`, `migrate`, `FK`) + lifecycle (`connect`, `migrate`, `patches`, `backup` `mysqldump` `MYSQL_PWD`, `rawCustomFields`, `getSchemaMap`). Lives in main process, `pool` never in renderer.
- **IpcDatabaseAdapter** — `fyo/database/IpcDatabaseAdapter.ts` renderer adapter, owns `Converter(fieldMapProvider,pesaProvider)` (`Currency`/`Check`/`DATETIME` UTC `{zone:'utc'}`), forwards typed `Database` methods via private `IPC` (`preload.ts:ipc.db.call` → `main/registerIpcMainActionListeners.ts:DB_CALL`).
- **MemoryDatabaseAdapter** — `fyo/database/MemoryDatabaseAdapter.ts` test-only `Map` (no `FK`/`FOR UPDATE`/`DATETIME`/`INFORMATION_SCHEMA` emulation).
- **StockLedger** — `models/inventory/StockLedger.ts` (`getQuantity`/`validateAvailability`/`getCOGS`/`getReturnBalance` over `StockLedgerEntry` via `getAll`/`getAllRaw` + `StockQueue` FIFO). Inventory valuation lives here, not on `Database`.
- **HostProvisioning** — `main/provision/hostProvision.ts` (`provision(config,onProgress?)` → `Connection`) behind the `PlatformInstaller` seam (`main/provision/platformInstallers.ts`: Windows/macOS/Linux adapters owning install, bind-address, firewall, app-user transport). The IPC router exposes one provisioning intent; `HostSetup.vue` only reflects progress.

## Decisions

- **MariaDB authoritative** — `Sotrama` is `Frappe Books` fork but `MariaDB` is the only supported application backend (`b3a866b` `DatabaseCore` `mariadb` `pool`). Multiple Windows PCs share one `MariaDB` host over LAN (`HostSetup.vue`, `DatabaseSelector.vue`).
- **SQLite not supported** — `':memory:'` dummy, `BetterSQLite3` `getDriver()`, SQLite file `dbPath` removed. No `SQLite→MariaDB` data migration; `dbPath` retained only as `connectionId` string for API compat.
- **Seam** — `Fyo.db:Database` is the application seam (`interface` small, `implementation` large). `IPC` is private `implementation` seam, `Converter` is `Database` `implementation` detail, `Memory` proves `two-adapter` rule (`Ipc` production, `Memory` test).
- **Transaction/locking invariants** — `DatabaseCore.transaction` re-entrancy (`if(#txConn) return callback`), `#txConn` ownership, `pool` `connectionLimit:10` `release` only if `owned`, `child` atomic `insert`+`#insertOrUpdateChildren` in one `transaction`, `NumberSeries` `SELECT … FOR UPDATE` +5-attempt, `migrate` `SET FOREIGN_KEY_CHECKS=1` in `finally` (even on DDL failure), `SingleValue` upsert.

## Non-decisions

- `DatabaseHandler` kept as thin `observer`/`schemaMap/fieldMap` facade (deletion test: still owns `observer` events for `Doc`); not removed merely because it existed in `Frappe Books`.
- `DatabaseDemux`/`DatabaseDemuxBase`/`DemuxDatabaseAdapter` kept until `leaveBalance` integration test migrated to `Memory`/`Ipc` typed — not deleted for smallness alone.
