//! Database facade. Connections are per-call parameters, so a transaction belongs to its task (unlike core.ts #txConn).

pub mod backup;
pub mod crud;
pub mod ddl;
pub mod migrate;
pub mod patches;
pub mod pool;
pub mod query;
pub mod row;

use crate::error::{BackendError, DbError};
use crate::schemas::Registry;
use crate::types::{MariaDBConfig, RawCustomField};

pub use pool::Pool;

/// A pooled, migrated connection plus the schema map it was opened with.
pub struct Db {
    pool: Pool,
    registry: Registry,
    config: MariaDBConfig,
}

impl Db {
    /// Connects and builds the registry. No DDL runs here.
    pub async fn connect(
        config: &MariaDBConfig,
        country_code: &str,
        create_if_missing: bool,
    ) -> Result<Self, BackendError> {
        let pool =
            Pool::connect_with(config, pool::PoolSettings::from_env(), create_if_missing).await?;
        let country_code = if country_code.is_empty() || country_code == "-" {
            resolve_country_code(&pool).await?
        } else {
            country_code.to_string()
        };
        // Only a missing table is expected on first run. Permission, connection,
        // and decoding failures must not silently disable custom fields.
        let custom_fields = custom_fields_or_error(crud::load_custom_fields(&pool).await)?;
        let registry = Registry::build(&country_code, &custom_fields)?;
        Ok(Self {
            pool,
            registry,
            config: config.clone(),
        })
    }

    pub fn pool(&self) -> &Pool {
        &self.pool
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    pub fn country_code(&self) -> &str {
        self.registry.country_code()
    }

    pub fn config(&self) -> &MariaDBConfig {
        &self.config
    }

    /// Creates or updates tables to match the registry.
    pub async fn migrate(&self) -> Result<MigrationReport, BackendError> {
        migrate::run(self).await
    }

    pub async fn close(&self) {
        self.pool.close().await;
    }
}

async fn resolve_country_code(pool: &Pool) -> Result<String, BackendError> {
    let result = sqlx::query_scalar::<_, String>(
        "SELECT `value` FROM `singlevalue` WHERE `fieldname` = 'countryCode' AND `parent` = 'SystemSettings' LIMIT 1",
    )
    .fetch_optional(pool.inner())
    .await;

    match result {
        Ok(Some(code)) if !code.is_empty() => Ok(code),
        Ok(_) => Ok("in".to_string()),
        Err(error) => {
            let error = DbError::from(error);
            if error.is_missing_table() {
                Ok("in".to_string())
            } else {
                Err(error.into())
            }
        }
    }
}

fn custom_fields_or_error(
    result: Result<Vec<RawCustomField>, DbError>,
) -> Result<Vec<RawCustomField>, BackendError> {
    match result {
        Ok(fields) => Ok(fields),
        Err(error) if error.is_missing_table() => Ok(Vec::new()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_missing_custom_fields_table_is_tolerated() {
        let missing_table = DbError {
            errno: Some(1146),
            sql_state: Some("42S02".into()),
            fatal: Some(false),
            message: "Table 'sotrama.customfield' doesn't exist".into(),
        };
        assert!(custom_fields_or_error(Err(missing_table))
            .unwrap()
            .is_empty());

        let permission_denied = DbError {
            errno: Some(1045),
            sql_state: Some("28000".into()),
            fatal: Some(false),
            message: "access denied".into(),
        };
        assert!(matches!(
            custom_fields_or_error(Err(permission_denied)),
            Err(BackendError::Db(error)) if error.errno == Some(1045)
        ));
    }
}

/// What `migrate` actually did, so the main process can report it instead of
/// guessing.
#[derive(Debug, Default, serde::Serialize)]
pub struct MigrationReport {
    pub tables_created: Vec<String>,
    pub columns_added: Vec<String>,
    pub columns_removed: Vec<String>,
    pub columns_retyped: Vec<String>,
    pub indexes_created: Vec<String>,
    pub foreign_keys_created: Vec<String>,
    pub patches_run: Vec<String>,
    pub errors: Vec<String>,
}

impl MigrationReport {
    /// Whether the report contains anything worth showing a user.
    pub fn changed(&self) -> bool {
        !self.tables_created.is_empty()
            || !self.columns_added.is_empty()
            || !self.columns_removed.is_empty()
            || !self.columns_retyped.is_empty()
            || !self.indexes_created.is_empty()
            || !self.foreign_keys_created.is_empty()
            || !self.patches_run.is_empty()
    }
}
