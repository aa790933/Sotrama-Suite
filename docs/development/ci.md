---
title: CI and releases
description: Automated checks, Rust builds, and documentation publishing.
---

# CI and releases

GitHub Actions has separate responsibilities: `build.yml` runs the frontend checks and Electron packaging, including a hosted Windows/MSVC package check; `rust-backend.yml` runs Rust formatting, Clippy, unit tests across Windows, macOS, and Linux, MariaDB-backed migration/restore/JSON-RPC checks, and native sidecar builds. The MariaDB job uses a disposable service database and exercises populated-schema preservation, restore into a new database, custom-field loading against an older schema, unchanged updates, rollback state after a failed child-row update, sequential number-series progression, and first-allocation concurrency across separate sidecar processes. These jobs are validation gates, not proof of production parity by themselves.

The documentation site is built with VitePress and published to GitHub Pages when documentation or its workflow changes on `main`. Pull requests build without publishing. The Pages workflow uses read-only repository permissions for checkout and grants `pages: write` plus `id-token: write` only to the deployment job. The build and publish workflows use the checked-in lockfiles; dependency updates should be deliberate rather than generated in CI.

If a workflow fails, inspect the first failing step and reproduce that check locally where practical. A successful compile alone does not establish migration safety; review the populated-schema and restore checks as well.
