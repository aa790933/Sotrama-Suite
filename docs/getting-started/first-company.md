---
title: First Company Setup
description: Set up your first company in Sotrama Suite
---

# Creating Your First Company

## Company Setup Wizard

After installation, the **Setup Wizard** guides you through creating your first company.

### Step 1: Basic Information

| Field | Required | Description |
|-------|----------|-------------|
| Company Name | ✅ | Legal business name |
| Abbreviation | ✅ | Short code (e.g., `ABC` for ABC Corp) |
| Country | ✅ | Determines tax rules & compliance |
| Currency | ✅ | Base currency for accounting |

### Step 2: Chart of Accounts

Choose a template:

- **Standard**: generic chart for any business
- **Service Business**: chart for consulting and agencies
- **Retail/POS**: includes inventory and COGS accounts
- **Manufacturing**: work-in-progress and raw materials
- **Non-Profit**: fund accounting structure
- **Custom**: start with minimal accounts

> **Tip:** You can modify the chart of accounts later in Settings → Accounting.

### Step 3: Fiscal Year

- **Start Date**: when your financial year begins
- **End Date**: automatically calculated as 12 months
- **Naming Series**: document numbering pattern (for example, `INV-.YYYY.-`)

### Step 4: Administrator Account

Create the first user (full access):
- Email
- Password
- Full Name

---

## Post-Setup Configuration

### 1. Tax Setup (Country-Specific)

| Country | Required Setup |
|---------|----------------|
| India | GST rates, HSN codes, GSTIN |
| USA | Sales tax jurisdictions |
| EU | VAT rates, VAT ID |
| Algeria | TVA rates, NIF |
| Switzerland | MWST/TVA rates |

Go to **Settings → Accounting → Taxes** to configure.

### 2. Numbering Series

Configure document prefixes:
- Sales Invoice: `SINV-.YYYY.-`
- Purchase Invoice: `PINV-.YYYY.-`
- Payment: `PAY-.YYYY.-`
- Journal Entry: `JV-.YYYY.-`

Settings → Accounting → Numbering Series

### 3. Defaults

Set default accounts for:
- Default Receivable Account
- Default Payable Account
- Default Cash Account
- Default Bank Account
- Default Cost Center

Settings → Accounting → Defaults

---

## Sample Data (Optional)

For exploration, load sample data:
1. Settings → System → **Load Sample Data**
2. Choose: Retail Demo / Service Demo / Manufacturing Demo
3. Explore pre-built transactions, reports, and POS

> **Warning:** Sample data cannot be removed. Create a new company if needed.

---

## Multiple Companies

Sotrama Suite supports multiple companies in one installation:

1. **File → New Company**: creates a separate database
2. **File → Switch Company**: switches between companies
3. Each company has independent:
   - Chart of accounts
   - Transactions
   - Users & permissions
   - Settings

---

## Backup & Restore

### Backup before changes

Do not assume automatic backups are enabled. Before an upgrade or schema migration, create a MariaDB backup using your approved database administration procedure and verify that it can be restored. See [Backup and restore](/guides/backup-restore).

### Restore

Restore is currently an operator workflow for the opt-in Rust backend, not an in-app button. Follow [Backup and restore](/guides/backup-restore) and verify representative records before using a restored database.

---

## Next Steps

- [Review database connection options](/guides/database-connections)
- [Prepare a backup and test recovery](/guides/backup-restore)
- [Read the architecture overview](/architecture/)
