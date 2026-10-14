---
title: Database layer
description: Database interfaces, adapters, and MariaDB ownership boundaries.
---

# Database layer

The renderer uses the `Database` interface defined by the Fyo core. Its methods cover document CRUD, existence and count checks, single values, number series, and transaction-oriented operations. Raw database values are exposed only through narrow methods used by search, export, and reports.

The production adapter forwards calls through Electron IPC. The main process owns the connection pool, schema migrations, and database credentials. The in-memory adapter exists for tests and deliberately does not emulate MariaDB-specific locking, foreign keys, or information-schema behavior.

## Database implementation

The TypeScript database implementation owns connection management, CRUD operations, SQL generation, schema migration, legacy patches, and the application's backup/restore workflow. SQL values must be bound as parameters. Dynamic identifiers must be validated against trusted schema metadata and quoted safely because SQL parameters cannot represent table or column names.

MariaDB is the authoritative store. Each desktop connects to the configured database host; the Electron application is a client and is not itself a database server. For multi-PC deployments, each desktop must use the same company database and suitable least-privilege database credentials.
