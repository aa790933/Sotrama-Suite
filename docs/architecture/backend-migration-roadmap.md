---
title: Backend migration roadmap
description: Evidence-led plan for keeping the Electron/Vue application typed while completing the Rust backend migration safely.
---

# Backend migration roadmap

## Decision

Keep TypeScript as the default language for application code in the Electron main process, preload contracts, Vue renderer, models used by the renderer, and report presentation. Keep JavaScript for build/release scripts and other tooling where TypeScript adds no useful application contract. Do not convert typed application modules to plain JavaScript merely to reduce the `.ts` count.

Move backend domain rules, authoritative accounting operations, persistence, schema/patch execution, database lifecycle, and server-side integrations into Rust. TypeScript should call a small, explicitly versioned Rust protocol and translate results into renderer-facing shapes; it must not retain a second authoritative implementation of migrated business rules. Vue remains the presentation layer and Electron remains the desktop/OS integration layer.

This is a boundary and correctness migration, not a file-extension target. No Rust cutover is complete until data parity, recovery, packaged startup, and cross-platform integration gates pass.

## Target architecture

```text
Vue renderer (TypeScript; presentation and interaction)
  -> narrow typed preload API (TypeScript; allow-listed IPC only)
  -> Electron main host (TypeScript; windows, OS, permissions, lifecycle)
  -> supervised Rust sidecar (versioned JSONL protocol)
  -> Rust application/domain services
  -> SQLx pool and MariaDB transactions
```

Cross-cutting: typed request/response schemas, structured non-secret diagnostics, bounded messages, explicit timeouts and cancellation, graceful shutdown, migrations and recoverable backups, dependency/security scanning, and platform-specific package tests.

The Rust sidecar should not be exposed as a network listener for local renderer calls. Keep stdio private to the parent/child process, validate every frame and operation, and make the parent the authority for renderer identity and user-facing permissions. Keep the separate HTTPS integration service narrowly scoped and separately authorized.

## Repository scope and current baseline

The initial repository inventory was taken at revision `6566a94` before the current TypeScript-restoration cohort. At that point the application was a Vue 3 / Electron desktop accounting app with strict TypeScript enabled, TypeScript 5.9, `vue-tsc`, MariaDB, and an opt-in Rust sidecar using Tokio and SQLx. The TypeScript inventory was substantial: models (122 files), Fyo domain/data abstractions (44), renderer (`src/`, 83), reports (29), backend (22), and main-process host code (13), plus schemas, tests, utilities, and scripts. The Rust sidecar had 17 `.rs` source files, including database, backup, migration, API, translation, template, IPC, and schema modules. These counts are an inventory baseline, not a promise that every file belongs in Rust.

The dependency manifest currently pins Electron `^43.4.1` and TypeScript `^5.9.3`. Official release listings show Electron 44 and TypeScript 7.0.2 available as of October 2026; TypeScript 6.0 is the transition release for TypeScript 7.0. The Rust release listing shows Rust 1.99.0 released on October 1, 2026. These are upgrade candidates, not automatic instructions to jump every dependency at once. First confirm compatibility of Vue tooling, Electron builder/native modules, the supported Node 24 runtime, SQLx, and all target platforms; then upgrade each toolchain independently with lockfile and CI evidence.

The existing Rust architecture document records that the TypeScript database remains the default until parity and recovery gates pass. Keep that gate. Do not enable Rust by default based solely on unit tests, successful compilation, or a successful packaged startup.

## Workstreams and completion gates

### 0. Establish an evidence-based baseline

- Preserve the working tree and record the exact starting revision, dirty paths, and user-owned changes before each migration batch.
- Inventory runtime responsibilities, import/dependency edges, SQL queries, schema/patch behavior, external integrations, and side effects by domain—not only by file extension.
- Define observable compatibility contracts for requests, results, errors, money/decimal handling, date/time zones, null/missing values, ordering, and transactions.
- Record baseline behavior and performance for representative accounting workflows without using production data or secrets.

**Gate:** a reviewed ownership map identifies the one authoritative implementation for each operation, the Rust/TypeScript boundary, and a test for each externally observable behavior.

### 1. Stabilize the language and process boundary

- Keep strict TypeScript for app code and strengthen type checking incrementally; avoid introducing a second handwritten declaration layer for application modules that are already authored in TypeScript.
- Restore application modules that were converted from typed `.ts` to plain `.js` without a runtime requirement for JavaScript. Keep `.mjs`/`.cjs` where a deliberate ESM/CommonJS tooling or bridge boundary requires it. Perform the restoration in reviewable cohorts and preserve the migration's functional fixes and regression tests.
- Upgrade TypeScript in stages: first evaluate TypeScript 6.0 compatibility and deprecations (including the current `baseUrl`/`ignoreDeprecations` configuration), then adopt TypeScript 7 only when `vue-tsc`, ESLint, build tooling, and all dependencies are compatible. Do not combine a compiler-major migration with a backend domain cutover.
- Upgrade Electron 43 to a supported current release in a separate step, reviewing breaking changes, native dependencies, fuses, ASAR integrity, and sandbox behavior on every target OS.
- Pin a tested stable Rust toolchain in CI and a repository toolchain file; update SQLx and other crates only with compatibility, advisory, license, and integration evidence.
- Use shared, versioned protocol definitions and runtime validation at the process boundary. TypeScript types alone do not validate JSON received from another process.
- Specify protocol version negotiation, request IDs, structured error codes, frame and body limits, timeouts, cancellation, backpressure, restart policy, and shutdown behavior.
- Ensure the preload exposes individual allow-listed methods, never raw `ipcRenderer` or a generic privileged invocation primitive.
- Validate IPC sender/frame identity and payloads before privileged operations.

**Gate:** protocol contract tests cover valid and malformed frames, unsupported versions, unknown methods, oversized input/output, duplicate/unknown IDs, child exit, timeout, restart, and graceful shutdown.

### 2. Move backend domain services in dependency order

Migrate domain logic in coherent vertical slices, each with characterization tests and a single Rust implementation after cutover:

1. Primitive value semantics: money/decimal precision, dates and time zones, IDs, validation, serialization, and conversion rules.
2. Schema-driven document services: field metadata, defaults, validation, naming, child rows, and document lifecycle invariants.
3. Accounting operations: posting, ledger invariants, journal entries, payments, invoices, stock/accounting interactions, and period rules.
4. Report query/aggregation services and exports where the logic is authoritative backend computation; retain Vue/report components for layout, filtering controls, and rendering.
5. Background jobs, synchronization, scheduling, and other server-side work.

Do not mechanically port every `models/` or `reports/` file. Separate domain rules from Vue state, route state, formatting, localization, and presentation first. Keep renderer-side formatting where it is genuinely presentational.

**Gate:** old and Rust implementations produce equivalent results for golden fixtures and generated edge cases; monetary calculations use explicit decimal semantics; error and ordering contracts are documented; no duplicate business rule remains active after cutover.

### 3. Complete the Rust MariaDB data layer

- Complete parity for CRUD, filters, ordering, pagination, child-row reconciliation, custom fields, single values, naming/number series, schema metadata, and value conversion.
- Make transaction boundaries explicit. Parent/child writes, accounting postings, and number allocation must be atomic and safe under concurrent clients.
- Review pool sizing, acquisition timeouts, connection lifetime/health, cancellation, graceful close, retry safety, and failure behavior when MariaDB is unavailable.
- Use parameterized SQL for values and strictly allow-list/quote dynamic identifiers. Review permissions, TLS options, server-version compatibility, and least-privilege database grants.
- Define supported MariaDB versions and test against them in CI.

**Gate:** Rust and TypeScript parity suites pass against disposable MariaDB instances populated with representative legacy schemas and accounting fixtures, including concurrent number allocation and forced failures midway through transactions. No real company data is needed in CI.

### 4. Schema evolution, patches, backup, and restore

- Define a single migration/patch ledger with deterministic ordering, idempotence policy, version checks, and clear recovery behavior.
- Before destructive or nontrivial upgrades, create and verify a consistent logical backup. Document lock/consistency behavior for live MariaDB, disk-space requirements, retention, and failure cleanup.
- Test restore into a new staging database, verify checksum and schema version, then validate row counts and business invariants—not only table presence.
- Test interrupted migration, corrupted/incomplete backup, disk-full, permissions failure, old schema, and rollback/recovery scenarios.
- Never automatically destroy or overwrite the original company database during restore.

**Gate:** repeatable upgrade/backup/restore drills pass on representative old schemas and all supported OSes; operator recovery instructions are tested by someone other than the implementation author.

### 5. Integrations and remaining backend responsibilities

- Move authoritative external-service clients, synchronization rules, validation, and retry/idempotency logic into Rust when those are backend responsibilities.
- Keep Electron dialogs, filesystem selection, window lifecycle, printing orchestration, installer/provisioning UX, and OS-specific integration in the main process. Rust may provide a narrow service when there is a concrete security or correctness benefit.
- Keep translation/template loading in Rust only while it reduces duplicated behavior and packaging remains deterministic; retain localization presentation in Vue.
- Bound all network requests and responses, disable unsafe redirects, validate destinations and headers, redact secrets, and use bounded concurrency and explicit timeout budgets.

**Gate:** contract tests cover external-service failures, rate limits, retries, idempotency, TLS failures, malicious redirects, invalid payloads, and secret redaction.

### 6. Controlled cutover and removal of duplicate backend code

- Keep the current TypeScript database implementation as the reference/fallback until the parity gates pass. Avoid silent fallback during a Rust operation, because it can hide data divergence or repeat non-idempotent writes.
- Run opt-in shadow comparisons only for read-only operations and only on safe fixtures or explicitly approved non-production data. Never dual-write accounting data without a designed reconciliation protocol.
- Enable Rust by default only after a reviewed go/no-go checklist, signed-off migration/recovery drills, and successful cross-platform packaged CI.
- Then remove obsolete TypeScript backend implementations, dead adapters, stale dependencies, and feature flags in separate reviewable batches. Keep TypeScript UI, IPC, and host code.

**Gate:** a release candidate passes parity, data recovery, package integrity, security, and cross-platform startup/shutdown tests; rollback to the previous release is documented and exercised.

### 7. Security, reliability, performance, and maintainability

- Threat-model renderer compromise, malicious IPC input, local sidecar tampering, compromised dependencies, database credential exposure, backup theft, and unsafe update/package paths.
- Follow Electron's security checklist: context isolation, sandboxing, restrictive CSP, safe navigation/window creation, validated IPC senders, no raw privileged API exposure, and safe external URL handling.
- Run formatting, clippy with warnings treated as errors where practical, unit/contract/integration tests, dependency/advisory review, secret scanning, and reproducible lockfile-based builds in CI.
- Add fuzz/property tests for protocol parsing, filters, document validation, serialization, and migration input. Use sanitizers or platform-specific dynamic checks where supported.
- Measure realistic cold start, common CRUD/report latency, pool saturation, memory use, binary/package size, and shutdown time. Optimize based on measured bottlenecks rather than assuming Rust alone guarantees performance.
- Emit structured logs and stable error codes without credentials or personal/company data; define support diagnostics and retention limits.
- Maintain an explicit supported platform/architecture and MariaDB-version matrix.

**Gate:** a security review, dependency review, performance comparison, and operational checklist are attached to the release candidate; no unresolved critical/high-risk finding is accepted without documented mitigation and owner.

### 8. Release and long-term ownership

- Build and verify the sidecar for every supported OS/architecture in hosted CI, package it into the exact resources path, verify executable permissions/signing as applicable, and smoke-test the packaged app.
- Test install, upgrade, launch, database connection, migration, backup/restore, update, crash recovery, and uninstall on Windows, macOS, and Linux.
- Document protocol ownership, database invariants, adding a migration, recovery, release rollback, security reporting, and dependency update cadence.
- Keep CI gates required for merge; use a staged rollout and collect privacy-preserving crash/performance signals only with an appropriate user-facing policy.

**Gate:** all required CI jobs pass on the release tag, package artifacts are verified, release notes describe data/migration risk, and support/recovery documentation is published.

## Quality standards

- **Correctness:** golden tests, property tests, cross-implementation parity, transaction rollback tests, migration fixtures, and invariant checks.
- **Security:** least privilege, validated inputs at every trust boundary, no secrets in argv/logs, TLS verification, bounded resource use, safe update/package process, dependency/advisory scanning, and Electron hardening.
- **Reliability:** explicit timeout/cancellation budgets, bounded queues/pools, predictable restart/shutdown, idempotent retry semantics, recoverable upgrades, and tested restore procedures.
- **Performance:** benchmark representative accounting workloads and database contention; optimize SQL plans, query counts, allocations, serialization, and startup only against measured baselines.
- **Maintainability:** one authoritative implementation per business rule, small modules with clear ownership, idiomatic Rust APIs and errors, strict TypeScript at the UI boundary, documented contracts, and CI-enforced formatting/lints/tests.

These are project gates, not a claim of formal certification or a guarantee of absolute security.

## Primary standards and references

- [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) and [compiler options](https://www.typescriptlang.org/docs/handbook/compiler-options.html): staged compiler migration, JavaScript checking, and configuration deprecations.
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security/), [process model](https://www.electronjs.org/docs/latest/tutorial/process-model), and [IPC guide](https://www.electronjs.org/docs/latest/tutorial/ipc): privilege separation and bridge design.
- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) and [Rust testing guide](https://doc.rust-lang.org/book/ch11-01-writing-tests.html): idiomatic public contracts, errors, and test structure.
- [SQLx Pool](https://docs.rs/sqlx/latest/sqlx/struct.Pool.html) and [Transaction](https://docs.rs/sqlx/latest/sqlx/struct.Transaction.html): connection lifecycle and transactional guarantees.
- [OWASP ASVS](https://owasp.github.io/www-project-application-security-verification-standard/): a structured security verification checklist; use the requirements applicable to a desktop application and its local/remote service boundaries.
- [Rust release announcements](https://blog.rust-lang.org/releases/) and [cargo-deny releases](https://github.com/EmbarkStudios/cargo-deny/releases): review stable toolchains, dependency advisories, licenses, and dependency policy during planned upgrade windows.

## Execution policy

- Work directory by directory for mechanical cleanup, but migrate backend features by vertical slice when behavior crosses directories.
- Preserve unrelated working-tree changes; do not reset, discard, or overwrite user edits.
- Do not make the Rust backend default, remove the TypeScript database reference path, or perform destructive schema work until the relevant gates are demonstrably passing.
- Record each batch's changed paths, checks actually run, blocked checks, and remaining risk. Do not describe an unrun CI job, Cargo test, MariaDB integration, or packaged-app test as passing.

## Current implementation checkpoint (2026-10-14)

- The Rust sidecar contains MariaDB CRUD/child-row reconciliation, schema migration, ordered patch handlers, verified backup/restore, translation/template utility modes, and the bounded HTTPS integration/telemetry service.
- TypeScript now owns the Electron-side Rust process adapters. The former JavaScript modules for the API adapter/client, utility runner, language/template adapters, URL/print policies, app protocol path resolver, print/PDF operations, updater listeners, process listeners, IPC message listeners, and shared main-process helpers have been moved to typed `.ts` modules while preserving the current security checks.
- JavaScript in `scripts/`, `build/`, and package/build configuration remains tooling rather than application backend code. Remaining application JS should be audited by responsibility and migrated only when the runtime contract is safe to preserve.
- **The backend migration is not complete.** The TypeScript `backend/database` implementation remains the default/reference path; the Rust database adapter is opt-in. Rust domain-service parity, broad MariaDB parity/recovery evidence, hosted CI results, and packaged Windows/macOS/Linux integration are still release gates. Do not enable Rust by default or delete the TypeScript reference backend until those gates pass.
