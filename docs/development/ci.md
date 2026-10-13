---
title: CI and releases
description: Automated checks, Rust builds, and documentation publishing.
---

# CI and releases

GitHub Actions has separate responsibilities: `build.yml` runs frontend checks and Electron packaging, including a hosted Windows/MSVC package check; `rust-backend.yml` runs Rust formatting, Clippy, unit tests across Windows, macOS, and Linux, MariaDB-backed migration/restore/JSON-RPC checks, and native sidecar builds. The MariaDB job uses a disposable service database and checks populated-schema preservation, restore into a new database, custom-field loading against an older schema, typed boolean reads and writes, filtered `getAll` and `count`, `exists` for present and missing rows, successful child-row insert/update/pruning, rollback state after a failed child-row update, and first-allocation concurrency across separate sidecar processes. It also injects a SQL trigger to fail `setPaymentReferenceType`, checks the persisted failure flag and unchanged payment row, removes the trigger, then verifies the next migration clears the failure and persists the corrected reference type. These are configured assertions until the hosted job runs, and they are not proof of full production parity by themselves.

The documentation site is built with VitePress and published to GitHub Pages when documentation, its link checker, the existing icon asset, or its workflow changes on `main`. The link checker validates Markdown links/assets and local routes or assets referenced by the VitePress navigation configuration. Pull requests run link and generated-asset checks and build without publishing. The Pages workflow uses read-only repository permissions for checkout and grants `pages: write` plus `id-token: write` only to the deployment job. The build and publish workflows use the checked-in lockfiles; dependency updates should be deliberate rather than generated in CI.

If a workflow fails, inspect the first failing step and reproduce that check locally where practical. A successful compile alone does not establish migration safety; review the populated-schema and restore checks as well.
