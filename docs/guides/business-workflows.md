---
title: Business workflows
description: A practical starting point for company setup, accounts, tax, items, invoicing, and payments.
---

# Business workflows

Use this guide as a practical orientation for the business records available in Sotrama Suite. The exact fields and options depend on your enabled modules, regional settings, and company configuration.

## Before entering transactions

1. Complete [first-company setup](/getting-started/first-company) and verify the company country, fiscal year, and base currency.
2. Review the chart of accounts and make sure the accounts needed for sales, purchases, cash, banks, taxes, and receivables/payables exist.
3. Configure number series, tax defaults, and print settings before creating documents that will be sent to customers or suppliers.
4. If multiple workstations use the same company, configure them to use the same MariaDB company database and confirm backup/restore procedures.

## Chart of accounts {#chart-of-accounts}

Open **Chart of Accounts** to review the account tree. Confirm account groups and account types before posting transactions. Use the application's account creation and validation flow; avoid directly editing database rows or changing account identifiers after transactions exist.

## Opening balances {#opening-balances}

Prepare opening balances from an agreed cut-off date and reconcile the source figures before entering them. Use the supported opening-entry workflow and confirm the trial balance balances afterward. Do not use ordinary backdated invoices as a substitute for a controlled opening balance migration unless your accounting policy explicitly requires that approach.

## Taxes {#taxes}

Configure tax records and defaults for the applicable jurisdiction before using them on invoices. Check the rate, effective date, account mapping, and whether the tax is recoverable or payable. Validate sample sales and purchase documents and their resulting reports before production use.

## Items and pricing {#items-and-pricing}

Create the items or services you actually sell or purchase, and verify their units, default income/expense accounts, prices, and tax defaults. If inventory is enabled, review stock units, locations, and batch/serial tracking settings before posting stock-affecting transactions.

## Customers and suppliers {#customers-and-suppliers}

Create a `Party` record with the correct role (customer, supplier, or both). Verify contact details, currency, address, tax identifier, and default account where applicable. Avoid creating duplicate party records for the same legal entity.

## Invoices and payments {#invoices-and-payments}

Create a sales invoice for a customer or a purchase invoice for a supplier, review the line items, taxes, totals, dates, and accounts, then submit it through the application workflow. Record receipts and payments using the Payment workflow and allocate them to the appropriate invoice references. Review outstanding balances and the general ledger after posting.

## Safety checklist

- Test the workflow with non-production records before processing live transactions.
- Verify totals, taxes, party balances, and ledger reports after posting.
- Use the application's reversal/return workflows to correct submitted financial records; do not delete ledger rows manually.
- Take a backup before bulk imports, configuration changes, or database migrations, and test restoring it into a separate database.
