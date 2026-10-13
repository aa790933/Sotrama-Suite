---
title: Contributing
description: How to make and validate changes to Sotrama Suite.
---

# Contributing

Start with a focused change and inspect the callers before changing an interface. Preserve database invariants, especially transaction ownership, number-series locking, and the rule that the renderer never owns a database connection.

## Pull requests

1. Explain the user-visible problem and the expected behavior.
2. Add a regression test when the change fixes a bug or alters a contract.
3. Run lint, type checks, and the relevant tests locally.
4. For Rust database changes, include MariaDB-backed coverage when SQL behavior or migrations change.
5. Document configuration changes and operational requirements.

Avoid logging passwords, connection strings, invoice contents, or other business data. Keep comments for decisions or constraints that are not obvious from the code.
