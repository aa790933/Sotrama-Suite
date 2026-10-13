---
title: Rust backend status
description: Current scope and release gates for the Rust database backend.
---

# Rust backend status

The Rust sidecar is an opt-in MariaDB data layer using Tokio and SQLx. It embeds the tracked JSON schemas at compile time and provides JSON-RPC over standard input and output. Its database methods cover typed document CRUD, child-row reconciliation, single values, number series, and value conversion. Each request uses its own pooled connection and transaction; number-series rows and schema migrations use MariaDB locking. Its migration path includes ordered legacy patch handling, a verified pre-migration backup for populated databases, and conservative handling of removed columns.

The Electron host still owns window lifecycle, dialogs, printing, updates, file operations, and operating-system provisioning. These responsibilities have not been moved into Rust services.

## Enable for integration testing

Set `SOTRAMA_BACKEND=rust` in a test environment. A missing or unhealthy sidecar is reported as an error; the router does not silently switch backends. Do not use this switch with production company data until the gates below have passed.

## Required before making Rust the default

- Run parity tests for CRUD, child rows, custom fields, single values, number series, transactions, and value conversions against populated MariaDB fixtures.
- Test upgrades from representative existing schemas and verify both backup and restore procedures.
- Exercise packaged startup, shutdown, and migration on Windows, macOS, and Linux.
- Confirm the GitHub Actions checks and MariaDB integration workflow pass on the target revision.

The TypeScript database implementation remains the default until these checks provide evidence that existing company data is handled correctly. The sidecar is a client process on each desktop, not a central LAN service; all clients must be configured to use the same MariaDB host and database.
