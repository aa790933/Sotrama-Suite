---
title: CI and releases
description: Automated checks, Rust builds, and documentation publishing.
---

# CI and releases

GitHub Actions runs the TypeScript and Electron checks alongside Rust formatting, linting, tests, native builds, and MariaDB integration tests. Native Rust artifacts are built on the matching operating-system runner so the executable matches its target platform.

The documentation site is built with VitePress and published to GitHub Pages when documentation or its workflow changes on the default branch. Pull requests run the documentation build without publishing. The Pages workflow uses a read-only repository token for checkout and the dedicated Pages deployment permission for publishing.

If a workflow fails, inspect the first failing step and reproduce that check locally where practical. A successful compile alone does not establish migration safety; review the populated-schema and restore checks as well.
