---
title: Database connections
description: Configure local and LAN MariaDB connections for Sotrama Suite.
---

# Database connections

Each company uses a MariaDB database. Multiple Sotrama Suite installations can connect to the same database host when the network and MariaDB permissions allow it.

## Connecting to a host

In the application, add or select a connection and provide the host, port, database name, user, and password. The default MariaDB port is `3306`; use the port configured by your administrator if it differs.

Use a dedicated application database user with access only to the company databases it needs. Do not expose MariaDB directly to the public internet. For LAN access, allow the database port only from trusted client networks and configure MariaDB to listen on the appropriate interface.

For a multi-PC company, configure every desktop to use the same database host, port, and company database. Each desktop runs its own Electron process and, when enabled, its own local Rust sidecar; neither desktop hosts the shared database for the others. Confirm the database host has a stable LAN address, the firewall permits port `3306` only from approved clients, and MariaDB grants match the clients' network origin. Do not put the database password in scripts or share it in support logs.

## Troubleshooting

- **Connection refused:** confirm the service is running and listening on the selected host and port.
- **Access denied:** check the user, password, and host-specific MariaDB grants.
- **Unknown database:** verify the database name and create it through the application's explicit company-creation flow.
- **Works on the host but not another PC:** check the host firewall, client network, MariaDB bind address, and grants for the remote client.
- **Rust migration stops before changing the schema:** inspect the sidecar log for a backup-tool, backup-directory, or migration-lock error. Do not bypass the backup gate on a populated company database; fix the cause and take a separate verified backup first.
- **Different desktops show different custom fields:** confirm they connect to the same database and that custom-field rows are valid. The Rust sidecar now fails startup on custom-field decoding errors rather than silently ignoring malformed rows.

The Rust sidecar, where enabled, runs locally with the desktop app and connects to MariaDB. It does not open a separate network listener.
