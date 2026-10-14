---
title: Application boundaries
description: Responsibilities and safe change boundaries in the Electron/Vue application.
---

# Application boundaries

Sotrama Suite uses Vue for the user interface, Electron for desktop integration, TypeScript for application and database services, and MariaDB for persistent company data. Keep one authoritative implementation for each business rule and make component boundaries explicit.

## Responsibilities

- **Vue renderer:** presentation, interaction, form state, and report rendering. It must not connect directly to MariaDB or own privileged operating-system operations.
- **Electron preload:** a small, explicit, allow-listed API between the renderer and the main process.
- **Electron main process:** application lifecycle, windows, dialogs, printing, file operations, updates, provisioning, and IPC validation.
- **TypeScript application/database services:** authoritative business behavior, data validation, document operations, database transactions, schema changes, and MariaDB connectivity.
- **MariaDB:** persistent company data shared by authorized desktop clients in a LAN deployment.

## Request flow

```text
Vue renderer
  -> allow-listed preload API
  -> Electron main process / IPC router
  -> TypeScript application and database services
  -> MariaDB
```

## Change safely

1. Inspect callers before changing an interface or database method.
2. Preserve transaction boundaries and atomicity for parent/child records, accounting postings, and number-series allocation.
3. Keep SQL values parameterized and validate dynamic table/column names against trusted schema metadata.
4. Treat schema patches as ordered, repeatable operations and test upgrade behavior against representative legacy fixtures.
5. Before a risky migration, take a verified backup and test restoration into a separate database.
6. Add regression tests for failure paths, not only successful operations.
7. Keep database credentials and company records out of renderer code, logs, and test fixtures.

## Validation checklist

- Run `yarn lint:check`, `yarn typecheck`, and the relevant tests.
- Use disposable MariaDB fixtures for database integration tests; never point migration tests at production data.
- Test packaging and host-specific behavior on supported operating systems when changing Electron integration.
- Keep the documentation aligned with the shipped application and update links when pages move.
