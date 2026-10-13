---
title: Development setup
description: Prepare a local checkout for Sotrama Suite development.
---

# Development setup

## Requirements

- Git
- Node.js 24.x and Corepack, using the Yarn version declared by `package.json`
- Rust stable and Cargo for the Rust sidecar
- MariaDB for database integration work
- Platform build prerequisites required by Electron and its native dependencies

## Install and run

```sh
corepack enable
yarn install
yarn dev
```

Run the checks relevant to your change before opening a pull request:

```sh
yarn lint:check
yarn typecheck
yarn test
```

For Rust changes:

```sh
cd rust-backend
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

Database integration tests require a MariaDB instance configured with the `TEST_DB_*` variables used by the Rust workflow. Never point migration tests at a production database.
