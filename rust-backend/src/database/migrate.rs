//! Migration on a dedicated connection; FOREIGN_KEY_CHECKS is restored on it even on failure.
//! Tables are created in one pass, foreign keys in a second, so mutual references succeed.

use sqlx::MySqlConnection;
use tracing::{info, warn};

use crate::database::backup;
use crate::database::crud;
use crate::database::ddl;
use crate::database::patches::{self, Phase};
use crate::database::query;
use crate::database::{Db, MigrationReport};
use crate::error::{BackendError, DbError};

pub async fn run(db: &Db) -> Result<MigrationReport, BackendError> {
    let mut conn = db.pool().inner().acquire().await.map_err(crud::db_err)?;
    // Multiple PCs can launch the app at once. MariaDB DDL is not transactional,
    // so serialize schema changes across Rust processes, not merely per process.
    // Hashing keeps the advisory-lock name within MariaDB's 64-character limit.
    let lock = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT GET_LOCK(SHA2(CONCAT('sotrama:migrate:', DATABASE()), 256), 30)",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(crud::db_err)?;
    if lock != Some(1) {
        return Err(BackendError::Db(DbError::new(
            "timed out waiting for the MariaDB schema migration lock",
        )));
    }

    let result = run_locked(db, &mut conn).await;
    let released = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT RELEASE_LOCK(SHA2(CONCAT('sotrama:migrate:', DATABASE()), 256))",
    )
    .fetch_one(&mut *conn)
    .await;

    match (result, released) {
        (Err(error), _) => {
            // A failed DDL/FK restore makes this session unsafe to reuse. Closing
            // the physical connection also guarantees MariaDB drops its lock.
            let _ = conn.close().await;
            Err(error)
        }
        (Ok(_), Err(error)) => {
            // Do not return a possibly lock-owning connection to the pool.
            let _ = conn.close().await;
            Err(crud::db_err(error))
        }
        (Ok(report), Ok(Some(1))) => Ok(report),
        (Ok(_), Ok(_)) => {
            let _ = conn.close().await;
            Err(BackendError::Db(DbError::new(
                "MariaDB schema migration lock was not released by this connection; the connection was discarded",
            )))
        }
    }
}

async fn run_locked(db: &Db, conn: &mut MySqlConnection) -> Result<MigrationReport, BackendError> {
    let mut report = MigrationReport::default();

    let version = app_version(conn).await?;
    let existing_tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(crud::db_err)?;
    let needs_schema = schema_needs_changes(db, conn).await?;
    let needs_patches = patches::has_pending(conn, &version).await?;
    if existing_tables > 0 && (needs_schema || needs_patches) {
        // A populated database must have a verified backup before the first DDL
        // or patch write. Missing backup tooling blocks migration, not warns.
        backup::create(db, &version).await?;
    }

    // The legacy lifecycle performs one schema pass before patches only for a
    // first-run database (PatchRun does not exist yet). Existing databases run
    // pre-migration patches, then DDL, then post-migration patches.
    let has_patch_history = crud::table_exists(conn, "PatchRun").await?;
    if !has_patch_history {
        run_schema_pass(db, conn, &mut report).await?;
    }

    patches::run_phase(conn, &version, Phase::BeforeMigrate, &mut report).await?;
    run_schema_pass(db, conn, &mut report).await?;
    patches::run_phase(conn, &version, Phase::AfterMigrate, &mut report).await?;
    info!(
        "migrate: {} tables, {} columns added, {} retyped, {} indexes, {} foreign keys",
        report.tables_created.len(),
        report.columns_added.len(),
        report.columns_retyped.len(),
        report.indexes_created.len(),
        report.foreign_keys_created.len()
    );
    Ok(report)
}

async fn schema_needs_changes(db: &Db, conn: &mut MySqlConnection) -> Result<bool, BackendError> {
    for schema in db
        .registry()
        .schemas()
        .values()
        .filter(|schema| !schema.is_single())
    {
        if !crud::table_exists(conn, &schema.name).await? {
            return Ok(true);
        }
        let diff = ddl::diff_columns(schema, &crud::existing_columns(conn, &schema.name).await?);
        if !diff.added.is_empty() || !diff.retyped.is_empty() {
            return Ok(true);
        }
        if !diff.removed.is_empty()
            && matches!(
                std::env::var("SOTRAMA_ALLOW_COLUMN_DROP").as_deref(),
                Ok("1")
            )
        {
            return Ok(true);
        }
        for (index, _) in ddl::secondary_indexes(schema) {
            if !crud::index_exists(conn, &schema.name, &index).await? {
                return Ok(true);
            }
        }
        let existing_fks = crud::foreign_key_columns(conn, &schema.name).await?;
        if ddl::foreign_keys(schema).iter().any(|(field, target)| {
            db.registry().contains(target)
                && !existing_fks
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(field))
        }) {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn app_version(conn: &mut MySqlConnection) -> Result<String, BackendError> {
    if !crud::table_exists(conn, "SingleValue").await? {
        return Ok("0.0.0".to_string());
    }
    let version = sqlx::query_scalar::<_, String>(
        "SELECT `value` FROM `singlevalue` WHERE `fieldname` = 'version' AND `parent` = 'SystemSettings' LIMIT 1",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(crud::db_err)?;
    Ok(version.unwrap_or_else(|| "0.0.0".to_string()))
}

async fn run_schema_pass(
    db: &Db,
    conn: &mut MySqlConnection,
    report: &mut MigrationReport,
) -> Result<(), BackendError> {
    sqlx::query("SET FOREIGN_KEY_CHECKS = 0")
        .execute(&mut *conn)
        .await
        .map_err(crud::db_err)?;

    let previous_error_count = report.errors.len();
    let ddl_result = apply_all(db, conn, report).await;
    let restore = sqlx::query("SET FOREIGN_KEY_CHECKS = 1")
        .execute(&mut *conn)
        .await;
    if let Err(error) = restore {
        report
            .errors
            .push(format!("FOREIGN_KEY_CHECKS could not be restored: {error}"));
        return Err(crud::db_err(error));
    }

    ddl_result?;
    if report.errors.len() > previous_error_count {
        return Err(BackendError::Db(DbError::new(format!(
            "schema migration reported errors; refusing to continue with patches: {}",
            report.errors[previous_error_count..].join("; ")
        ))));
    }
    crud::initialize_single_defaults(conn, db.registry(), db.country_code()).await?;
    Ok(())
}

async fn apply_all(
    db: &Db,
    conn: &mut MySqlConnection,
    report: &mut MigrationReport,
) -> Result<(), BackendError> {
    let registry = db.registry();
    let names: Vec<String> = registry
        .schemas()
        .values()
        .filter(|s| !s.is_single())
        .map(|s| s.name.clone())
        .collect();

    // Pass one: tables and columns.
    let mut created = Vec::new();
    for name in &names {
        let Some(schema) = registry.schemas().get(name) else {
            continue;
        };

        if !crud::table_exists(conn, name).await? {
            let sql = ddl::create_table_sql(schema)?;
            exec(conn, &sql).await?;
            created.push(name.clone());
        } else {
            let diff = ddl::diff_columns(schema, &crud::existing_columns(conn, name).await?);
            if !diff.is_empty() {
                apply_diff(conn, name, &diff, report).await?;
            }
        }

        // New tables need their secondary indexes during this same migration.
        // Skipping the rest of the loop after CREATE TABLE makes a fresh
        // database require a second startup to reach the intended schema.
        for (index_name, column) in ddl::secondary_indexes(schema) {
            if crud::index_exists(conn, name, &index_name).await? {
                continue;
            }
            let sql = ddl::create_index_sql(name, &index_name, &column)?;
            match exec(conn, &sql).await {
                Ok(()) => report.indexes_created.push(index_name),
                Err(e) => report.errors.push(format!("{name}.{index_name}: {e}")),
            }
        }
    }
    report.tables_created.extend(created);

    // Pass two: foreign keys, once every table exists.
    for name in &names {
        let Some(schema) = registry.schemas().get(name) else {
            continue;
        };
        let existing = crud::foreign_key_columns(conn, name).await?;
        for (fieldname, target) in ddl::foreign_keys(schema) {
            if existing.iter().any(|c| c.eq_ignore_ascii_case(&fieldname)) {
                continue;
            }
            if !registry.contains(&target) {
                continue;
            }
            let sql = ddl::add_foreign_key_sql(name, &fieldname, &target)?;
            match exec(conn, &sql).await {
                Ok(()) => report
                    .foreign_keys_created
                    .push(format!("{name}.{fieldname}")),
                Err(e) => report.errors.push(format!("fk {name}.{fieldname}: {e}")),
            }
        }
    }

    Ok(())
}

async fn apply_diff(
    conn: &mut MySqlConnection,
    schema_name: &str,
    diff: &ddl::ColumnDiff,
    report: &mut MigrationReport,
) -> Result<(), BackendError> {
    let table = query::ident(&crate::schemas::table_name(schema_name))?;

    for column in &diff.added {
        let sql = format!(
            "ALTER TABLE {table} ADD COLUMN {} NULL",
            query::ident(column)?
        );
        // A new column is nullable with no default: core.ts adds it NOT NULL,
        // which fails with errno 1364 on a table that already has rows.
        match exec(conn, &sql).await {
            Ok(()) => report.columns_added.push(format!("{schema_name}.{column}")),
            Err(e) => report
                .errors
                .push(format!("add {schema_name}.{column}: {e}")),
        }
    }

    for (column, new_type) in &diff.retyped {
        let sql = format!(
            "ALTER TABLE {table} MODIFY COLUMN {} {new_type}",
            query::ident(column)?
        );
        match exec(conn, &sql).await {
            Ok(()) => report
                .columns_retyped
                .push(format!("{schema_name}.{column}")),
            Err(e) => report
                .errors
                .push(format!("retype {schema_name}.{column}: {e}")),
        }
    }

    for column in &diff.removed {
        if !confirm_drop(&format!("{schema_name}.{column}")) {
            continue;
        }
        let sql = format!("ALTER TABLE {table} DROP COLUMN {}", query::ident(column)?);
        match exec(conn, &sql).await {
            Ok(()) => report
                .columns_removed
                .push(format!("{schema_name}.{column}")),
            Err(e) => report
                .errors
                .push(format!("drop {schema_name}.{column}: {e}")),
        }
    }

    Ok(())
}

/// Drops need SOTRAMA_ALLOW_COLUMN_DROP=1; otherwise the column stays and is recorded.
fn confirm_drop(column: &str) -> bool {
    let allowed = matches!(
        std::env::var("SOTRAMA_ALLOW_COLUMN_DROP").as_deref(),
        Ok("1")
    );
    if !allowed {
        warn!("keeping {column}: set SOTRAMA_ALLOW_COLUMN_DROP=1 to drop it");
    }
    allowed
}

async fn exec(conn: &mut MySqlConnection, sql: &str) -> Result<(), BackendError> {
    sqlx::query(sql)
        .execute(&mut *conn)
        .await
        .map_err(crud::db_err)?;
    Ok(())
}
