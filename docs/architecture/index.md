---
title: Architecture
description: How the Sotrama Suite desktop application is structured.
---

# Architecture

Sotrama Suite combines an Electron desktop host, a Vue renderer, and a MariaDB-backed application model. The renderer requests privileged work through a typed Electron IPC boundary; database connections and operating-system operations stay in the main process.

```text
Vue renderer
    │ typed database calls
    ▼
Electron preload and IPC router
    ├── host operations: files, dialogs, printing, provisioning
    └── database adapter
          ├── TypeScript DatabaseCore (current default)
          └── Rust sidecar (explicit opt-in)
                    │ JSON-RPC over stdio
                    ▼
                  MariaDB
```

The Rust sidecar communicates over standard input and output using line-delimited JSON-RPC. Standard output is reserved for protocol messages; diagnostic logging goes to standard error. The sidecar does not expose a network port.

The Rust adapter is an opt-in integration path until migration and data-conversion parity is demonstrated against populated databases on supported platforms. See [Rust backend status](/architecture/rust-backend), [database layer](/architecture/database), and [IPC protocol](/architecture/ipc).
