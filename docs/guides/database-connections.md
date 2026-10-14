---
title: Database connections
description: Configure local and LAN MariaDB connections for Sotrama Suite.
---

# Database connections

Each company uses a MariaDB database. Multiple Sotrama Suite installations can connect to the same database host when the network and MariaDB permissions allow it.

## Connecting to a host

In the application, add or select a connection and provide the host, port, database name, user, and password. The default MariaDB port is `3306`; use the port configured by your administrator if it differs.

Use a dedicated application database user with access only to the company databases it needs. Do not expose MariaDB directly to the public internet. For LAN access, allow the database port only from trusted client networks and configure MariaDB to listen on the appropriate interface.

For a multi-PC company, configure every desktop to use the same database host, port, and company database. Each desktop runs its own Sotrama Suite application; the shared MariaDB service runs on the configured database host. Confirm the host has a stable LAN address, the firewall permits port `3306` only from approved clients, and MariaDB grants match the clients' network origin. Do not put the database password in scripts or share it in support logs.

## Troubleshooting

- **Connection refused:** confirm the service is running and listening on the selected host and port.
- **Access denied:** check the user, password, and host-specific MariaDB grants.
- **Unknown database:** verify the database name and create it through the application's explicit company-creation flow.
- **Works on the host but not another PC:** check the host firewall, client network, MariaDB bind address, and grants for the remote client.
- **Migration fails:** review the application logs and MariaDB permissions, verify that a backup is available, and do not bypass safety checks on a populated company database.
- **Different desktops show different custom fields:** confirm they connect to the same database and that custom-field rows and schema metadata are valid.

Each desktop connects to MariaDB using the configured host and credentials. The database service should only be reachable from trusted clients and networks.
