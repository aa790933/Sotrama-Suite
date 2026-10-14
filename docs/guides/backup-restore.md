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

Use the application's supported database administration and backup procedures for the version you are running. The exact backup interface depends on the installation and MariaDB tooling; do not assume a command or option is available unless it is documented for that release. Keep database credentials out of command-line arguments and logs.

Restore is an operator workflow, not an in-app button. The automatic checks validate the manifest/checksum, successful import, presence of tables, and schema-version match; they do not prove every invoice, stock balance, attachment reference, or report is correct. Verify representative records and reports before selecting the restored database for normal work. Keep another copy of the backup separate from the database host.

Do not run destructive schema operations without a verified backup and a recovery plan. Keep a separate copy of the backup away from the database host, and verify representative invoices, balances, stock records, and reports after a restore.
