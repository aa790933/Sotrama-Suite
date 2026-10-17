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

## Renderer UI and design system

The renderer is built with Vue and TypeScript. Tailwind CSS 4 is integrated through its Vite plugin; CSS-first theme tokens and light/dark semantic colors live in `src/styles/index.css`, with brand tokens in `src/styles/brand-tokens.css`. Shared interface primitives follow shadcn-vue conventions and use the existing Reka UI and Lucide dependencies. The theme uses the `.dark` class and includes RTL layout support, rather than maintaining a parallel Tailwind 3 JavaScript configuration.

For the schema-backed entity relationships and sequence/component diagrams, see [Data model and UML](/architecture/data-model).
