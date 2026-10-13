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

- **Standard** — Generic chart for any business
- **Service Business** — Optimized for consulting, agencies
- **Retail/POS** — Includes inventory & COGS accounts
- **Manufacturing** — Work-in-progress, raw materials
- **Non-Profit** — Fund accounting structure
- **Custom** — Start with minimal accounts

> **Tip:** You can modify the chart of accounts later in Settings → Accounting.

### Step 3: Fiscal Year

- **Start Date** — When your financial year begins
- **End Date** — Auto-calculated (12 months)
- **Naming Series** — Document numbering pattern (e.g., `INV-.YYYY.-`)

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

> **Warning:** Sample data cannot be removed — create a new company if needed.

---

## Multiple Companies

Sotrama Suite supports multiple companies in one installation:

1. **File → New Company** — Creates separate database
2. **File → Switch Company** — Switch between companies
3. Each company has independent:
   - Chart of accounts
   - Transactions
   - Users & permissions
   - Settings

---

## Backup & Restore

### Automatic Backups

- Enabled by default (daily at 2 AM)
- Stored in `~/SotramaSuite/backups/`
- Retains last 30 days

### Manual Backup

```bash
# CLI backup
sotrama-suite backup --company "My Company" --output backup.zip
```

### Restore

1. File → Restore Company
2. Select backup file
3. Enter new company name (cannot overwrite existing)

---

## Next Steps

- [Record your first transaction](/guides/first-transaction)
- [Set up Point of Sale](/guides/pos-setup)
- [Generate financial reports](/guides/reports)