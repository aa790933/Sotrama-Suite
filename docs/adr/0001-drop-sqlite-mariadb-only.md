# ADR 0001 — Drop SQLite; MariaDB is the sole persistence backend

Status: Accepted
Date: 2026-08-30

## Context

Sotrama Suite is a fork of Frappe Books with **zero production users and zero production data**. The original Frappe Books backend used `better-sqlite3` with a filesystem `dbPath`. As part of the MariaDB migration (`b3a866b` `DatabaseCore` `mariadb` `pool`, `HostSetup.vue`, `DatabaseSelector.vue`), **MariaDB has already replaced SQLite/better-sqlite3 as the primary path**:

- `MainDatabase` is `backend/database/core.ts:DatabaseCore` (MariaDB `pool`, `FOR UPDATE`, `migrate`, `FK`) + `backend/database/manager.ts:DatabaseManager` lifecycle — lives in the main process, `pool` never in the renderer.
- The application seam is `Fyo.db:Database` at `fyo/database/Database.ts` — typed `DocValueMap` surface; `RawValueMap` only via narrow `getAllRaw`. Validated by two **adapters** behind that seam: `IpcDatabaseAdapter` (production) and `MemoryDatabaseAdapter` (test) — the two-adapter rule proves the seam is real.
- `CONTEXT.md:15` already records: *SQLite not supported — `':memory:'` dummy, SQLite file `dbPath` removed, no data migration.*

Remaining SQLite traces are **unmigrated legacy from the original fork**, not active code paths. The most visible example is `src/utils/db.ts:15-17` (`dbErrors.DirectoryDoesNotExist = 'directory does not exist'`, `UnableToAcquireConnection`) — strings emitted by `better-sqlite3`, never by the `mariadb` driver, kept only because they were there before.

There is no data to migrate, no user to break, and no reason to preserve a second persistence path "just in case".

## Decision

**SQLite is permanently dropped, not just replaced. No migration path from SQLite will ever be built.**

- **MariaDB is the sole persistence backend** for both single-user Electron mode and future multi-user LAN mode. Multiple Windows PCs share one MariaDB host over LAN (`HostSetup.vue`, `DatabaseSelector.vue`) — that is the only supported deployment topology.
- **No migration path from SQLite will ever be built.** Do not design, scaffold, or preserve code for SQLite→MariaDB data migration. `dbPath` is retained only as a `connectionId` string for API compatibility (`CONTEXT.md:15`).
- **Any remaining SQLite code is unmigrated legacy and should be deleted outright**, not preserved. This includes dead error strings, dead handlers, and conditional branches that exist only to handle SQLite semantics (e.g. `src/utils/db.ts:15-73` `DirectoryDoesNotExist`/`UnableToAcquireConnection` handlers). Prefer **deleting a shallow module outright** over wrapping it — the **deletion test** here is conclusive: removing those strings/handlers moves no complexity to callers.

This ADR is intentionally **load-bearing**: it exists so future explorers do not re-suggest SQLite support.

## Consequences

- Future **architecture reviews** and **grilling sessions** must not re-surface *"should we support SQLite / migrate old data"* as an open question. Any candidate that proposes re-adding SQLite, dual-backend support, or a migration path **contradicts this ADR** and should be rejected unless this ADR is explicitly reopened with new evidence.
- When a **grilling** session or **code-review** encounters dead SQLite-era code, the default action is **deletion**, not preservation or abstraction. The **locality** win is that MariaDB error handling concentrates in one typed place (`mariadb` error codes / `PingOptions` / `MariaDBConfig` validation), and the **leverage** win is that one `Fyo.db:Database` **interface** covers both single-user and LAN modes without a second **adapter**.
- `CONTEXT.md` and this ADR are the two sources of truth for persistence. If they appear to conflict, this ADR governs.
- **Verification**: after each change, watch GitHub Actions — `test.yml` (MariaDB service + `uitest`) is the relevant CI check. No local full build is required.

## References

- `CONTEXT.md:6-17` — Domain language: `Connection`, `Database`, `MainDatabase`, `IpcDatabaseAdapter`, `MemoryDatabaseAdapter`, seam decisions.
- `backend/database/core.ts:64`, `manager.ts:16` — `MainDatabase` implementation.
- `fyo/database/Database.ts:25` — `Fyo.db:Database` seam (the typed **interface**; `Converter` and `IPC` are **implementation** details).
- `src/utils/db.ts:15-73` — Example dead SQLite legacy to delete.
