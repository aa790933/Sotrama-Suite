# Sotrama Suite — Domain Context

## Language

- **Company** — legal entity, maps to `Company`/`SystemSettings` (countryCode, currency, fiscalYear). One `PersistedConnection` per company.
- **Connection** — `MariaDBConfig {host,port,user,password,database}` persisted as `PersistedConnection {id,companyName,host,port,user,database,openCount}` and displayed as `ConnectionMetadata {display}`. `connectionId` is the stable identifier; `filesystemPath` never means a DB connection.
- **Database** — `Database` interface at `Fyo.db:Database` (`fyo/database/Database.ts`) — typed `DocValueMap` surface (`insert/get/getAll/update/delete/rename/deleteAll/exists/close/count/getSingleValues/getNextAutoincrementId/getNextSeriesValue/getStockQuantity(StockQuery)`). `RawValueMap` only via narrow `getAllRaw` for `search`/`export`/`reports`.
- **MainDatabase** — `backend/database/core.ts:DatabaseCore` (`MariaDB` `pool`, `FOR UPDATE`, `migrate`, `FK`) + `backend/database/manager.ts:DatabaseManager` lifecycle (`connect`, `migrate`, `patches`, `backup` `mysqldump` `MYSQL_PWD`, `rawCustomFields`). Lives in main process, `pool` never in renderer.
- **IpcDatabaseAdapter** — `fyo/database/IpcDatabaseAdapter.ts` renderer adapter, owns `Converter(fieldMapProvider,pesaProvider)` (`Currency`/`Check`/`DATETIME` UTC `{zone:'utc'}`), forwards typed `Database` methods via private `IPC` (`preload.ts:ipc.db.call` → `main/registerIpcMainActionListeners.ts:DB_CALL`).
- **MemoryDatabaseAdapter** — `fyo/database/MemoryDatabaseAdapter.ts` test-only `Map` (no `FK`/`FOR UPDATE`/`DATETIME`/`INFORMATION_SCHEMA` emulation).

## Decisions

- **MariaDB authoritative** — `Sotrama` is `Frappe Books` fork but `MariaDB` is the only supported application backend (`b3a866b` `DatabaseCore` `mariadb` `pool`). Multiple Windows PCs share one `MariaDB` host over LAN (`HostSetup.vue`, `DatabaseSelector.vue`).
- **SQLite not supported** — `':memory:'` dummy, `BetterSQLite3` `getDriver()`, SQLite file `dbPath` removed. No `SQLite→MariaDB` data migration; `dbPath` retained only as `connectionId` string for API compat.
- **Seam** — `Fyo.db:Database` is the application seam (`interface` small, `implementation` large). `IPC` is private `implementation` seam, `Converter` is `Database` `implementation` detail, `Memory` proves `two-adapter` rule (`Ipc` production, `Memory` test).
- **Transaction/locking invariants** — `DatabaseCore.transaction` re-entrancy (`if(#txConn) return callback`), `#txConn` ownership, `pool` `connectionLimit:10` `release` only if `owned`, `child` atomic `insert`+`#insertOrUpdateChildren` in one `transaction`, `NumberSeries` `SELECT … FOR UPDATE` +5-attempt, `migrate` `SET FOREIGN_KEY_CHECKS=1` in `finally` (even on DDL failure), `SingleValue` upsert.

## Non-decisions

- `DatabaseHandler` kept as thin `observer`/`schemaMap/fieldMap` facade (deletion test: still owns `observer` events for `Doc`); not removed merely because it existed in `Frappe Books`.
- `DatabaseDemux`/`DatabaseDemuxBase`/`DemuxDatabaseAdapter`/`databaseMethodSet` kept until `leaveBalance` integration test migrated to `Memory`/`Ipc` typed — not deleted for smallness alone.
