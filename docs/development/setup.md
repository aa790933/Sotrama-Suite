---
title: Development setup
description: Prepare a local checkout for Sotrama Suite development.
---

# Development setup

## Requirements

- Git
- Node.js 24.x and Corepack, using the Yarn version declared by `package.json`
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

Database integration tests require a disposable MariaDB instance configured with the `TEST_DB_*` variables used by the test suite. Never point migration tests at a production database.
