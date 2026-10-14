---
title: CI and releases
description: Automated application checks, packaging, tests, and documentation publishing.
---

# CI and releases

GitHub Actions uses `build.yml` for linting, type checks, and Electron packaging, while `test.yml` runs the TypeScript test suite against disposable MariaDB services. Keep application builds and database tests reproducible with the checked-in lockfile. Changes to schema migrations or transaction behavior should include regression tests for both success and failure paths.

The `test.yml` workflow provisions disposable MariaDB databases for integration tests. Never point automated migration tests at a production company database. A failing test run is a release blocker even when the packaging job succeeds.

The documentation site is built with VitePress and published to GitHub Pages from `main`. Pull requests run the documentation checks and build without publishing. The Pages workflow uses read-only repository permissions for checkout and grants `pages: write` plus `id-token: write` only to the deployment job. Keep documentation changes aligned with the shipped application and update links when pages move.

If a workflow fails, inspect the first failing step and reproduce that check locally where practical. A successful compile alone does not establish database safety; test upgrade, backup, restore, and transaction failure behavior where relevant.
