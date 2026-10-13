---
title: Rust backend status
description: Current scope and release gates for the Rust database backend.
---

# Rust backend status

The Rust sidecar is an opt-in MariaDB data layer using Tokio and SQLx. It embeds the tracked JSON schemas at compile time and provides JSON-RPC over standard input and output. Its database methods cover typed document CRUD, child-row reconciliation, custom fields, single values, number series, and value conversion. Each `db.call` runs in a transaction on its own pooled connection. Parent updates and child reconciliation therefore commit or roll back together, including malformed child-row input; an unchanged parent update is not mistaken for a missing document. Number-series allocation first establishes the counter row with an upsert, then locks and advances it in the same transaction, including when separate desktops request a previously unused series. Custom-field rows that cannot be decoded now fail connection setup instead of being silently omitted, which avoids clients building different schemas from the same database.

For a populated database, a pending schema change or legacy patch requires a successful logical dump before migration proceeds. Rust records the dump's size and SHA-256 in a neighboring JSON manifest. The sidecar stores these files under the Electron user-data `backups` directory. Restore is a separate command-line operation into a new database; it checks the manifest and checksum, imports to a staging database, and checks that tables and the recorded schema version are present. This is not a substitute for validating important business records after recovery.

The Electron host still owns window lifecycle, dialogs, printing, updates, file operations, and operating-system provisioning. These responsibilities have not been moved into Rust services.

## Enable for integration testing

Set `SOTRAMA_BACKEND=rust` in a test environment. A missing or unhealthy sidecar is reported as an error; the router does not silently switch backends. Do not use this switch with production company data until the gates below have passed.

## Required before making Rust the default

- The hosted MariaDB contract job checks unchanged updates, rollback of a parent update when child reconciliation fails, preservation of the original row after rollback, custom-field loading against an older schema, sequential numbering, and first-allocation concurrency across two independent sidecar processes. These are focused regression checks, not exhaustive parity proof.
- Run broader parity tests for CRUD, child rows, custom fields, single values, number series, rollback behavior, and value conversions against representative populated MariaDB fixtures before changing the default backend.
- Test upgrades from representative existing schemas and verify both backup and restore procedures.
- Exercise packaged startup, shutdown, and migration on Windows, macOS, and Linux.
- Confirm the GitHub Actions checks and MariaDB integration workflow pass on the target revision.

The TypeScript database implementation remains the default until these checks provide evidence that existing company data is handled correctly. The sidecar is a client process on each desktop, not a central LAN service; all clients must be configured to use the same MariaDB host and database.
