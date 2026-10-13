---
title: Backup and restore
description: Protect a company database and verify a recovery before using it.
---

# Backup and restore

Backups are useful only when they can be restored. Before an application upgrade or database migration, create a database backup and keep it somewhere separate from the database host.

## Before an upgrade

1. Confirm you can connect to the correct company database.
2. Create a MariaDB dump using your approved database administration procedure.
3. Store the backup in a restricted location; database dumps contain business and potentially personal information.
4. Verify that the dump is non-empty and retain its checksum or other integrity record.
5. Test restoration into a separate database before relying on the backup for recovery.

## Rust backend backup tools

When the Rust backend is explicitly enabled, it creates a backup before applying a pending schema change or legacy patch to a populated database. The dump utility (`mariadb-dump` or `mysqldump`) must be on `PATH`, unless `SOTRAMA_DUMP_PATH` points to the executable. If the backup cannot be completed, the Rust migration stops before applying DDL or patches. Backups and their adjacent `.json` manifests are stored in the application's user-data `backups` directory. The manifest records the source database, schema version, byte size, dump utility, timestamp, and SHA-256 checksum.

The Rust restore command requires both `--restore-backup` and `--restore-to`. It also requires the `mariadb` or `mysql` command-line client on `PATH`. Configure `SOTRAMA_DB_HOST`, `SOTRAMA_DB_PORT`, `SOTRAMA_DB_USER`, `SOTRAMA_DB_PASSWORD`, and `SOTRAMA_DB_NAME` for the target MariaDB server and source database name recorded in the manifest, then run the Rust sidecar with `--restore-backup /path/to/backup.sql --restore-to a_new_database_name`. Keep credentials in environment variables, not command-line arguments. The command refuses to overwrite the configured source database or an existing target and removes the staging database if import or its basic verification fails.

Restore is an operator workflow, not an in-app button. The automatic checks validate the manifest/checksum, successful import, presence of tables, and schema-version match; they do not prove every invoice, stock balance, attachment reference, or report is correct. Verify representative records and reports before selecting the restored database for normal work. Keep another copy of the backup separate from the database host.

The Rust backend remains opt-in while compatibility testing against existing installations is completed. Follow the deployment guidance for the version you are running; do not switch an existing company database to an experimental backend without a tested backup and recovery plan.
