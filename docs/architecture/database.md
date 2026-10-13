---
title: Database layer
description: Database interfaces, adapters, and MariaDB ownership boundaries.
---

# Database layer

The renderer uses the `Database` interface defined by the Fyo core. Its methods cover document CRUD, existence and count checks, single values, number series, and transaction-oriented operations. Raw database values are exposed only through narrow methods used by search, export, and reports.

The production adapter forwards calls through Electron IPC. The main process owns the connection pool, schema migrations, and database credentials. The in-memory adapter exists for tests and deliberately does not emulate MariaDB-specific locking, foreign keys, or information-schema behavior.

## Rust implementation

`rust-backend/src/database` separates connection-pool configuration, CRUD operations, SQL generation, schema migration, legacy patches, and backup/restore. SQL values are bound as parameters. Identifiers are validated and quoted by the query helpers because SQL parameters cannot represent table or column names.

MariaDB remains the authoritative store. Each desktop installation runs its own sidecar and connects to the configured host; the sidecar is not a database server.
