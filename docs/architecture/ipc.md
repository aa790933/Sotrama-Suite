---
title: IPC protocol
description: The boundary between Electron and the Rust database process.
---

# IPC protocol

Electron's main process starts the Rust executable as a child process and exchanges one JSON-RPC message per line over standard input and output. The client assigns request IDs and can keep multiple calls pending; the current Rust server processes input lines sequentially. Responses are validated against the expected success or error envelope before reaching the application.

Database credentials are passed through the child process environment, not command-line arguments. The client enforces request timeouts, captures diagnostics from standard error, and rejects outstanding calls if the process exits or emits malformed protocol output. Writes are not automatically retried because the caller may not know whether a timed-out write committed.

Keep standard output protocol-only. New backend methods should validate arguments at the IPC boundary, use bound SQL parameters for values, return structured errors, and avoid logging credentials or business records.
