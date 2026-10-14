---
title: IPC protocol
description: The boundary between Electron and the Rust database process.
---

# IPC protocol

Electron's main process starts the Rust executable as a child process and exchanges one JSON-RPC message per line over standard input and output for database operations. The database client assigns request IDs and can keep multiple calls pending; the database server processes input lines sequentially. Responses are validated against the expected success or error envelope before reaching the application.

ERPNext HTTPS requests use a separate `--serve-api` process mode so they do not depend on an open database. It accepts typed JSON-lines requests and correlates out-of-order responses by request ID, with bounded concurrency and request/response sizes. ERPNext requests are restricted to the integration path; main-process error telemetry uses a separate POST-only purpose. Both reject redirects and unsafe headers, and keep request credentials on stdin rather than argv or inherited environment variables. The Electron IPC sender check and ERPNext endpoint policy remain in the host before renderer requests cross this bridge.

Database credentials are passed through the child process environment, not command-line arguments. The client enforces request timeouts, captures diagnostics from standard error, and rejects outstanding calls if the process exits or emits malformed protocol output. Writes are not automatically retried because the caller may not know whether a timed-out write committed.

Keep standard output protocol-only. New backend methods should validate arguments at the IPC boundary, use bound SQL parameters for values, return structured errors, and avoid logging credentials or business records.
