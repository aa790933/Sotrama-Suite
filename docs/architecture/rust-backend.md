---
title: Rust backend status
description: Current scope and release gates for the Rust database backend.
---

# Rust backend status

The Rust sidecar is an opt-in MariaDB data layer using Tokio and SQLx. It embeds the tracked JSON schemas at compile time and provides JSON-RPC over standard input and output. Its database methods cover typed document CRUD, child-row reconciliation, custom fields, single values, number series, and value conversion. Each request uses its own pooled connection and transaction; number-series rows and schema migrations use MariaDB locking. Custom-field rows that cannot be decoded now fail connection setup instead of being silently omitted, which avoids clients building different schemas from the same database.

For a populated database, a pending schema change or legacy patch requires a successful logical dump before migration proceeds. Rust records the dump's size and SHA-256 in a neighboring JSON manifest. The sidecar stores these files under the Electron user-data `backups` directory. Restore is a separate command-line operation into a new database; it checks the manifest and checksum, imports to a staging database, and checks that tables and the recorded schema version are present. This is not a substitute for validating important business records after recovery.

The Electron host still owns window lifecycle, dialogs, printing, updates, file operations, and operating-system provisioning. These responsibilities have not been moved into Rust services.

## Enable for integration testing

Set `SOTRAMA_BACKEND=rust` in a test environment. A missing or unhealthy sidecar is reported as an error; the router does not silently switch backends. Do not use this switch with production company data until the gates below have passed.

## Required before making Rust the default

- Run parity tests for CRUD, child rows, custom fields, single values, number series, rollback behavior, and value conversions against populated MariaDB fixtures.
- Test upgrades from representative existing schemas and verify both backup and restore procedures.
- Exercise packaged startup, shutdown, and migration on Windows, macOS, and Linux.
- Confirm the GitHub Actions checks and MariaDB integration workflow pass on the target revision.

The TypeScript database implementation remains the default until these checks provide evidence that existing company data is handled correctly. The sidecar is a client process on each desktop, not a central LAN service; all clients must be configured to use the same MariaDB host and database.
