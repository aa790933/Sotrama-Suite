# Architecture Backlog — Sotrama Suite

> Single source of truth for deepening work. Update at end of every slice, unprompted.
> Evidence is cited, not claimed. Check `git log`, file existence, and `grep` before marking done.

- [x] **ADR-0001 — Drop SQLite, MariaDB-only** — Done: `docs/adr/0001-drop-sqlite-mariadb-only.md:1` (Status: Accepted, 4.3K, 2026-08-30) exists; `src/utils/db.ts:1` is 12 lines / 528 bytes with no `dbErrorActionSymbols`/`DirectoryDoesNotExist`/`UnableToAcquireConnection` (grep `better-sqlite3|DirectoryDoesNotExist` → 0 hits in `src/`/`main/`/`backend/`; only `docs/adr` mentions it historically). Validated by `git log --oneline -3` → `a5fcd58`, `424153b`.

- [x] **Candidate 1 — Deepen Main-process Ipc router** — Done: `main/ipc/router.ts:1` is 599 lines with four typed sub-interfaces `DbOps`/`InstallerOps`/`FileOps`/`AppOps` (`router.ts:97-128`), every `ipc.handle` (31/31) wrapped with `withSender` (`router.ts:524-580`), `asDatabase(databaseManager): Database` (`router.ts:22-48`) injects real `fyo/database/Database.ts:25`, `sanitizeDatabaseName` rejects (`policies.ts:9-14`); **real seam proof** `main/ipc/router.spec.ts:147` now has 51 tests including `IpcRouter + MemoryDatabaseAdapter — real seam (DbOps via Memory)` (`router.spec.ts:147-210`) that constructs `IpcRouter` with `MemoryDatabaseAdapter` (mocking `electron`/`electron-store` at `main/helpers.ts:5` → `utils/config.ts:1` → `electron-store` chain, see `router.spec.ts:147` mock) and asserts `dbCall('get','Party','TestP')` through the seam. Commits `424153b` + `a5fcd58` + `router.spec` fix.

- [ ] **Candidate A+3 — Database seam collapse & MainDatabase lifecycle** — Not started: `backend/database/bespoke.ts:14` still `class BespokeQueries` (17K, 4 refs), `backend/database/manager.ts:228` still `callBespoke` + `BespokeQueries.hasOwnProperty`, `backend/database/core.ts:430` and `bespoke.ts:17,30` still duplicate `getNextSeriesValue`/`getNextAutoincrementId` (5-attempt `FOR UPDATE`). No commit touches this seam since `6eced74`; `git log 6eced74..HEAD --oneline` shows only `424153b`/`a5fcd58`/`3d68b01` (all IPC).

- [ ] **Candidate 5+B — StockService / StockLedger consolidation** — Not started: no `StockService` file (`grep -rn StockService --include="*.ts" models/ → 0`), `models/inventory/StockManager.ts:1` still 8.8K with `deleteAll(StockLedgerEntry)` and `#getStockLedgerEntry`, `reports/inventory/helpers.ts:19` still owns `getRawStockLedgerEntries`/`StockQueue` FIFO, `src/utils/pos.ts` still imports from reports. No commit touches `models/inventory/*` for this.

- [ ] **Candidate 2 — Host provisioning / MariaDB installer state machine** — Not started: `src/pages/HostSetup.vue:1` is still 744 lines / 19 reactive fields with inline `canContinue` and `v-if` 5-deep, `main/mariadbInstall.ts:1` still 908 lines with 12 public functions (`installWindows`/`installMac`/`installLinux` at `288,663,770`) and `if(platform==='win')` branches, no `PlatformInstaller` seam or `HostSetupMachine` state. `git diff 6eced74...HEAD -- src/pages/HostSetup.vue main/mariadbInstall.ts` → only comment change at `HostSetup.vue:739`.

- [ ] **Candidate 4 — Doc↔Raw conversion / FieldTypeRegistry** — Not started: `fyo/core/dbHandler.ts:43` still `class DemuxDatabaseAdapter implements Database` shim (kept per `CONTEXT.md` until `leaveBalance` migrated), `fyo/core/converter.ts:27` still `switch(field.fieldtype)` ×2 with 18 cases, no `schemas/fieldTypes.ts` or `FieldTypeDescriptor` registry. `grep -rn FieldTypeRegistry --include="*.ts" → 0`.

- [x] **Candidate 6 — SQLite dead-code deletion (quick pass)** — Done (incidental): `src/utils/db.ts:1` shrank 98→12 lines (87 deleted) removing `dbErrors`/`handleDirectoryDoesNotExist`/`handleUnableToAcquireConnection`/`showDbErrorDialog`; `grep -r better-sqlite3|DirectoryDoesNotExist|UnableToAcquireConnection --exclude-dir=node_modules → 0` in code (only `docs/adr` historically). FieldType/domain cohesion part still Not started (see above; `models/helpers.ts:1` still 1779 lines, `schemas/index.ts:12` still has 4 switches).

- [ ] **Candidate C — PricingEngine extraction** — Not started: `models/baseModels/Invoice/Invoice.ts:1` still 2095 lines with inline tax/discount/loyalty, no `PricingEngine`/`calculateTotals()` file, `grep -rn PricingEngine --include="*.ts" → 0`, `models/helpers.ts:1237` still `getPricingRule` with N `fyo.db.getAll` loops.

- [ ] **Candidate D — AccountingLedgerSummary** — Not started: `reports/finance/:` still 5 single-query files (`cashflow.ts:1.4K`, `creditDebit.ts:836`, `incomeExpenses.ts:1.7K`, `outstanding.ts:901`, `topExpenses.ts:1.4K`), no `AccountingLedgerSummary` or `getFinancialSummary(period)`; `grep -rn AccountingLedgerSummary|getFinancialSummary → 0`.

---

**Top next:** Move to Candidate A+3 (Database seam collapse + MainDatabase lifecycle) per agreed order `1(done) → A+3 → 5+B → 2 → 4 → 6(done) → C,D`.

*Last verified: 2026-08-31 via `git log --oneline -4` (`a5fcd58`, `424153b`, `6eced74` + `router.spec` fix), `ls -lh main/ipc/router.ts` (599), `grep -c "ipc.handle" main/ipc/router.ts` (31) vs `grep -c "withSender" main/ipc/router.ts` (31), `cat src/utils/db.ts` (12 lines), `main/ipc/router.spec.ts:147` real seam test 51/51, `grep -r sqlite --exclude-dir=node_modules` (0 code hits).*
