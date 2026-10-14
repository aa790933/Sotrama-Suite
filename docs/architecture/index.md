---
title: Architecture
description: How the Sotrama Suite desktop application is structured.
---

# Architecture

Sotrama Suite combines an Electron desktop host, a Vue renderer, TypeScript application services, and MariaDB persistence. The renderer requests privileged work through a narrow Electron IPC boundary; database connections and operating-system operations stay in the main process.

```text
Vue renderer
    │ allow-listed IPC methods
    ▼
Electron preload
    ▼
Electron main process and IPC router
    ├── host operations: files, dialogs, printing, provisioning, updates
    └── TypeScript database services
              │ MariaDB driver
              ▼
            MariaDB
```

The Electron main process is the trust boundary for privileged operations and owns database connectivity. The renderer must not open database connections or receive database credentials. See [application boundaries](/architecture/application-boundaries), [database layer](/architecture/database), and [IPC protocol](/architecture/ipc).
