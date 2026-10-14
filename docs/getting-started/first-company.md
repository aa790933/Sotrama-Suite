---
title: First company setup
description: Create a company and review its accounting defaults.
---

# First company setup

From the company selector, choose **New Company**. Connect to the intended MariaDB host and database when prompted, then complete the setup wizard.

## Setup wizard

The wizard asks for:

- **Company name**
- **Country**, which supplies regional settings
- **Full name and email** for the company contact
- **Bank name** for the initial bank account
- **Currency**
- **Fiscal-year start and end dates**
- **Chart of accounts**

Currency, fiscal-year dates, and the chart of accounts can be prefilled from the selected country. Review each value before submitting. Choose from the chart-of-accounts options shown in the wizard; the available country-specific charts vary by release.

## Before recording transactions

1. Confirm the company name, country, currency, and fiscal year.
2. Review the generated chart of accounts and the account defaults used by invoices and payments.
3. Review the tax settings available for the selected country.
4. Create a test transaction and check the resulting ledger and reports before entering real business records.

## Demo company

The company selector offers **Create Demo** for a separate demonstration company. Use it to inspect example transactions and workflows without mixing them with the company you intend to use for accounting.

## More than one company

Use the company selector to create a company or open one already configured. Each company uses its own database configuration. For shared use across PCs, configure every installation to connect to the same MariaDB host and company database. See [Database connections](/guides/database-connections).

## Backup and recovery

Before upgrades or schema migrations, create a MariaDB backup and verify that it can be restored. Follow [Backup and restore](/guides/backup-restore) and verify representative records before using a restored database.
