---
title: Install Sotrama Suite
description: Download and install Sotrama Suite for your desktop platform.
---

# Install Sotrama Suite

Download the current release from [GitHub Releases](https://github.com/aa790933/Sotrama-Suite/releases). Choose the package for your operating system and processor, then follow the installer prompts.

## Supported platforms

- **Windows:** use the signed or published Windows installer supplied with the release.
- **macOS:** choose the Intel or Apple Silicon build that matches your Mac.
- **Linux:** use the package published for your distribution, where available.

The release page is the source of truth for available packages and supported versions. Avoid third-party download mirrors.

## First launch

1. Open Sotrama Suite and choose the application language and country.
2. Create a company database or connect to an existing MariaDB database.
3. Enter the company name, base currency, and fiscal year.
4. Review the chart of accounts and regional tax settings before recording transactions.

## MariaDB connections

Sotrama Suite stores company records in MariaDB. The database may be on the same computer or on a host reachable over your local network. For a remote host, configure its MariaDB bind address, firewall, and database-user grants deliberately. Keep the database password private and restrict network access to trusted machines.

If a connection fails, check the host name, port, database name, credentials, MariaDB service status, and firewall rules. See [Database connections](/guides/database-connections).
