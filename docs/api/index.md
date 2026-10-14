---
title: Project reference
description: Source locations and contracts useful when navigating the codebase.
---

# Project reference

This reference links the main implementation boundaries. The source code and tests remain authoritative when behavior changes.

| Area | Location |
| --- | --- |
| Application database interface | `fyo/database/Database.ts` |
| TypeScript MariaDB implementation | `backend/database/core.ts` |
| Electron IPC router | `main/ipc/router.ts` |
| MariaDB connection and database implementation | `backend/database/core.ts` |
| Shared document schemas | `schemas/` |
| Application build workflow | `.github/workflows/build.yml` |

See [architecture](/architecture/) for the boundaries between these components and [development setup](/development/setup) for local commands.
