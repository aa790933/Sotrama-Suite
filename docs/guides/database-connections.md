---
title: Database connections
description: Configure local and LAN MariaDB connections for Sotrama Suite.
---

# Database connections

Each company uses a MariaDB database. Multiple Sotrama Suite installations can connect to the same database host when the network and MariaDB permissions allow it.

## Connecting to a host

In the application, add or select a connection and provide the host, port, database name, user, and password. The default MariaDB port is `3306`; use the port configured by your administrator if it differs.

Use a dedicated application database user with access only to the company databases it needs. Do not expose MariaDB directly to the public internet. For LAN access, allow the database port only from trusted client networks and configure MariaDB to listen on the appropriate interface.

## Troubleshooting

- **Connection refused:** confirm the service is running and listening on the selected host and port.
- **Access denied:** check the user, password, and host-specific MariaDB grants.
- **Unknown database:** verify the database name and create it through the application's explicit company-creation flow.
- **Works on the host but not another PC:** check the host firewall, client network, MariaDB bind address, and grants for the remote client.

The Rust sidecar, where enabled, runs locally with the desktop app and connects to MariaDB. It does not open a separate network listener.
