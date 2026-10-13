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

The Rust backend creates a backup before applying schema changes or patches to a populated database. It requires `mariadb-dump` or `mysqldump` on `PATH`, unless `SOTRAMA_DUMP_PATH` points to the chosen executable. Backups include a JSON manifest with the source database, application version, size, and SHA-256 checksum.

The Rust restore command requires both `--restore-backup` and `--restore-to`. It refuses to overwrite the source database or an existing target. Restore into a new database, verify it, and then select it in the application only after review.

The Rust backend remains opt-in while compatibility testing against existing installations is completed. Follow the deployment guidance for the version you are running; do not switch an existing company database to an experimental backend without a tested backup and recovery plan.
