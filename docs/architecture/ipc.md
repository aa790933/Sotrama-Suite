---
title: IPC protocol
description: The security boundary between the Vue renderer and Electron main process.
---

# IPC protocol

The Vue renderer communicates with privileged functionality through the Electron preload bridge. The preload exposes individual, allow-listed methods; it must not expose the raw `ipcRenderer` object or a generic channel invocation method. The main process registers handlers and validates incoming payloads before accessing the filesystem, database, operating system, or other privileged resources.

## Security requirements

- Enable context isolation and sandboxing for renderer windows where supported, and apply a restrictive Content Security Policy.
- Validate the sender/frame identity and payload shape for every privileged IPC handler.
- Keep database credentials and raw connections in the main process; never expose them to Vue components.
- Validate external URLs and open them with the operating system only after applying an explicit protocol/host policy.
- Avoid logging passwords, connection strings, invoice contents, or other company data.

When adding an IPC method, document its request/response contract, validate all inputs at the boundary, return predictable errors, and add tests for invalid payloads and unauthorized senders.
