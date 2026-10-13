//! Mandatory, verified-before-use logical backups for existing databases before
//! Rust applies a patch or incompatible schema change. A missing dump utility is
//! a hard error, never a warning followed by a destructive migration.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tracing::info;

use crate::database::Db;
use crate::error::{BackendError, DbError};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    database: String,
    app_version: String,
    created_at_utc: String,
    file_name: String,
    file_bytes: u64,
    sha256: String,
    dump_utility: String,
}

/// Create an atomic dump plus manifest. The dump's exit code and non-empty
/// output are both checked before the final filenames become visible.
pub async fn create(db: &Db, app_version: &str) -> Result<PathBuf, BackendError> {
    let dir = std::env::var_os("SOTRAMA_BACKUP_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            BackendError::Db(DbError::new(
                "database migration needs a backup, but SOTRAMA_BACKUP_DIR is not configured",
            ))
        })?;
    tokio::fs::create_dir_all(&dir).await.map_err(io_error)?;

    let (utility, utility_path) = find_dump_utility().await?;
    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let stem = format!(
        "{}_{}_{}_{}",
        safe_component(&db.config().database),
        safe_component(app_version),
        timestamp,
        std::process::id()
    );
    let final_path = dir.join(format!("{stem}.sql"));
    let temp_path = dir.join(format!("{stem}.sql.partial"));
    let manifest_path = dir.join(format!("{stem}.json"));
    let manifest_temp = dir.join(format!("{stem}.json.partial"));

    let output = std::fs::File::create(&temp_path).map_err(io_error)?;
    let config = db.config();
    let mut child = Command::new(&utility_path)
        .arg("--single-transaction")
        .arg("--routines")
        .arg("--events")
        .arg("--hex-blob")
        .arg("--default-character-set=utf8mb4")
        .arg(format!("--host={}", config.host))
        .arg(format!("--port={}", config.port))
        .arg(format!("--user={}", config.user))
        .arg(&config.database)
        .env("MYSQL_PWD", &config.password)
        .stdin(Stdio::null())
        .stdout(Stdio::from(output))
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            BackendError::Db(DbError::new(format!(
                "could not start {utility} for the required database backup: {error}"
            )))
        })?;

    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| BackendError::Db(DbError::new("backup process stderr unavailable")))?;
    let stderr_reader = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes).await;
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let status = match tokio::time::timeout(std::time::Duration::from_secs(300), child.wait()).await
    {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(io_error(error));
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(BackendError::Db(DbError::new(
                "database backup timed out after 300 seconds; migration was not started",
            )));
        }
    };
    let stderr = stderr_reader
        .await
        .unwrap_or_else(|_| "could not read dump utility diagnostics".into());
    if !status.success() {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(BackendError::Db(DbError::new(format!(
            "{utility} failed with {status}; migration was not started. {stderr}"
        ))));
    }

    let metadata = tokio::fs::metadata(&temp_path).await.map_err(io_error)?;
    if metadata.len() == 0 {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(BackendError::Db(DbError::new(format!(
            "{utility} reported success but produced an empty backup; migration was not started"
        ))));
    }
    tokio::fs::rename(&temp_path, &final_path)
        .await
        .map_err(io_error)?;
    let sha256 = sha256_file(&final_path).await?;

    let manifest = BackupManifest {
        database: db.config().database.clone(),
        app_version: app_version.to_string(),
        created_at_utc: chrono::Utc::now().to_rfc3339(),
        file_name: final_path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("backup.sql")
            .to_string(),
        file_bytes: metadata.len(),
        sha256,
        dump_utility: utility,
    };
    let serialized = serde_json::to_vec_pretty(&manifest).map_err(|error| {
        BackendError::Db(DbError::new(format!(
            "cannot encode backup manifest: {error}"
        )))
    })?;
    tokio::fs::write(&manifest_temp, serialized)
        .await
        .map_err(io_error)?;
    tokio::fs::rename(&manifest_temp, &manifest_path)
        .await
        .map_err(io_error)?;
    info!(backup = %final_path.display(), bytes = metadata.len(), "verified database backup completed before migration");
    Ok(final_path)
}

/// Restore into a brand-new database, never over an existing one. Import occurs
/// in the staging database and it is dropped on any import/verification failure,
/// preventing a partially restored database from being mistaken for a valid one.
pub async fn restore_to_new_database(
    config: &crate::types::MariaDBConfig,
    backup_path: &Path,
    target_database: &str,
) -> Result<(), BackendError> {
    let metadata_path = backup_path.with_extension("json");
    let manifest: BackupManifest = serde_json::from_slice(
        &tokio::fs::read(&metadata_path).await.map_err(io_error)?,
    )
    .map_err(|error| BackendError::Db(DbError::new(format!("invalid backup manifest: {error}"))))?;
    let file_name = backup_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let metadata = tokio::fs::metadata(backup_path).await.map_err(io_error)?;
    if manifest.file_name != file_name
        || manifest.file_bytes != metadata.len()
        || metadata.len() == 0
    {
        return Err(BackendError::Db(DbError::new(
            "backup and manifest do not match; refusing to restore",
        )));
    }
    if sha256_file(backup_path).await? != manifest.sha256 {
        return Err(BackendError::Db(DbError::new(
            "backup SHA-256 does not match its manifest; refusing to restore",
        )));
    }
    if target_database == config.database {
        return Err(BackendError::Db(DbError::new(
            "restore target must be a new database name, not the source database",
        )));
    }
    let quoted_target = crate::database::query::ident(target_database)?;
    let admin_options = MySqlConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.user)
        .password(&config.password)
        .charset("utf8mb4")
        .collation("utf8mb4_unicode_ci")
        .ssl_mode(MySqlSslMode::Disabled);
    let admin_pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(15))
        .connect_with(admin_options)
        .await
        .map_err(|error| BackendError::from(crate::error::DbError::from(error)))?;
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?",
    )
    .bind(target_database)
    .fetch_one(&admin_pool)
    .await
    .map_err(|error| BackendError::from(crate::error::DbError::from(error)))?;
    if exists != 0 {
        admin_pool.close().await;
        return Err(BackendError::Db(DbError::new(format!(
            "restore target database `{target_database}` already exists; no data was changed"
        ))));
    }
    sqlx::query(&format!(
        "CREATE DATABASE {quoted_target} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    ))
    .execute(&admin_pool)
    .await
    .map_err(|error| BackendError::from(crate::error::DbError::from(error)))?;

    let result = import_dump(config, backup_path, target_database).await;
    if let Err(error) = result {
        let cleanup = sqlx::query(&format!("DROP DATABASE {quoted_target}"))
            .execute(&admin_pool)
            .await;
        admin_pool.close().await;
        return match cleanup {
            Ok(_) => Err(error),
            Err(cleanup_error) => Err(BackendError::Db(DbError::new(format!(
                "restore failed: {error}; the incomplete staging database `{target_database}` could not be removed: {cleanup_error}"
            )))),
        };
    }

    let target_options = MySqlConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.user)
        .password(&config.password)
        .database(target_database)
        .charset("utf8mb4")
        .collation("utf8mb4_unicode_ci")
        .ssl_mode(MySqlSslMode::Disabled);
    let target_pool = match MySqlPoolOptions::new()
        .max_connections(1)
        .connect_with(target_options)
        .await
    {
        Ok(pool) => pool,
        Err(error) => {
            let cleanup = sqlx::query(&format!("DROP DATABASE {quoted_target}"))
                .execute(&admin_pool)
                .await;
            admin_pool.close().await;
            return match cleanup {
                Ok(_) => Err(BackendError::from(crate::error::DbError::from(error))),
                Err(cleanup_error) => Err(BackendError::Db(DbError::new(format!(
                    "could not verify restored database: {error}; staging database `{target_database}` could not be removed: {cleanup_error}"
                )))),
            };
        }
    };
    let verification = async {
        let tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
        )
        .fetch_one(&target_pool)
        .await
        .map_err(|error| BackendError::from(crate::error::DbError::from(error)))?;
        if tables == 0 {
            return Err(BackendError::Db(DbError::new("restored database contains no tables")));
        }
        let version = sqlx::query_scalar::<_, String>(
            "SELECT `value` FROM `singlevalue` WHERE `fieldname` = 'version' AND `parent` = 'SystemSettings' LIMIT 1",
        )
        .fetch_optional(&target_pool)
        .await
        .map_err(|error| BackendError::from(crate::error::DbError::from(error)))?
        .unwrap_or_else(|| "0.0.0".to_string());
        if version != manifest.app_version {
            return Err(BackendError::Db(DbError::new(format!(
                "restored schema version `{version}` does not match backup manifest version `{}`",
                manifest.app_version
            ))));
        }
        Ok::<(), BackendError>(())
    }.await;
    target_pool.close().await;
    if let Err(error) = verification {
        let cleanup = sqlx::query(&format!("DROP DATABASE {quoted_target}"))
            .execute(&admin_pool)
            .await;
        admin_pool.close().await;
        return match cleanup {
            Ok(_) => Err(error),
            Err(cleanup_error) => Err(BackendError::Db(DbError::new(format!(
                "restore verification failed: {error}; incomplete staging database `{target_database}` could not be removed: {cleanup_error}"
            )))),
        };
    }
    admin_pool.close().await;
    info!(source = %manifest.database, target = target_database, "backup restored and verified into a new database");
    Ok(())
}

async fn import_dump(
    config: &crate::types::MariaDBConfig,
    backup_path: &Path,
    target_database: &str,
) -> Result<(), BackendError> {
    let (utility, utility_path) = find_client_utility().await?;
    let input = std::fs::File::open(backup_path).map_err(io_error)?;
    let mut child = Command::new(&utility_path)
        .arg(format!("--host={}", config.host))
        .arg(format!("--port={}", config.port))
        .arg(format!("--user={}", config.user))
        .arg("--default-character-set=utf8mb4")
        .arg(target_database)
        .env("MYSQL_PWD", &config.password)
        .stdin(Stdio::from(input))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            BackendError::Db(DbError::new(format!(
                "could not start {utility} to restore backup: {error}"
            )))
        })?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| BackendError::Db(DbError::new("restore process stderr unavailable")))?;
    let stderr_reader = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut bytes).await;
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let status = match tokio::time::timeout(std::time::Duration::from_secs(600), child.wait()).await
    {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => return Err(io_error(error)),
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(BackendError::Db(DbError::new(
                "restore import timed out after 600 seconds",
            )));
        }
    };
    let stderr = stderr_reader
        .await
        .unwrap_or_else(|_| "could not read restore diagnostics".into());
    if !status.success() {
        return Err(BackendError::Db(DbError::new(format!(
            "{utility} restore import failed with {status}: {stderr}"
        ))));
    }
    Ok(())
}

async fn find_dump_utility() -> Result<(String, PathBuf), BackendError> {
    if let Some(path) = std::env::var_os("SOTRAMA_DUMP_PATH").filter(|v| !v.is_empty()) {
        let path = PathBuf::from(path);
        if executable_works(&path).await {
            let name = path
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("database dump utility")
                .to_string();
            return Ok((name, path));
        }
        return Err(BackendError::Db(DbError::new(format!(
            "SOTRAMA_DUMP_PATH does not point to a working dump utility: {}",
            path.display()
        ))));
    }
    for candidate in ["mariadb-dump", "mysqldump"] {
        let path = PathBuf::from(candidate);
        if executable_works(&path).await {
            return Ok((candidate.to_string(), path));
        }
    }
    Err(BackendError::Db(DbError::new(
        "a populated database needs a pre-migration backup, but neither mariadb-dump nor mysqldump is available on PATH; install the MariaDB client or set SOTRAMA_DUMP_PATH. No migration was applied",
    )))
}

async fn find_client_utility() -> Result<(String, PathBuf), BackendError> {
    for candidate in ["mariadb", "mysql"] {
        let path = PathBuf::from(candidate);
        if executable_works(&path).await {
            return Ok((candidate.to_string(), path));
        }
    }
    Err(BackendError::Db(DbError::new(
        "restore requires the mariadb or mysql command-line client on PATH",
    )))
}

async fn sha256_file(path: &Path) -> Result<String, BackendError> {
    let mut file = tokio::fs::File::open(path).await.map_err(io_error)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).await.map_err(io_error)?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

async fn executable_works(path: &Path) -> bool {
    Command::new(path)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .is_ok_and(|output| output.status.success())
}

fn safe_component(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

fn io_error(error: impl std::fmt::Display) -> BackendError {
    BackendError::Db(DbError::new(format!("database backup I/O error: {error}")))
}

#[cfg(test)]
mod tests {
    use super::safe_component;

    #[test]
    fn backup_file_components_cannot_inject_paths() {
        assert_eq!(safe_component("sotrama_db"), "sotrama_db");
        assert_eq!(safe_component("../../prod db"), "______prod_db");
        assert_eq!(safe_component(""), "unknown");
    }
}
