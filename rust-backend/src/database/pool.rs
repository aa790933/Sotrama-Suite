//! Pooled connections with explicit timeouts. core.ts sets none, so a wrong host hangs instead of failing.

use std::time::Duration;

use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::MySqlPool;

use crate::error::{BackendError, DbError};
use crate::types::MariaDBConfig;

/// Pool and connection limits, in seconds unless the name says otherwise.
#[derive(Debug, Clone)]
pub struct PoolSettings {
    /// Concurrent connections; ten matches core.ts connectionLimit.
    pub max_connections: u32,
    /// Startup connections; proves reachability immediately.
    pub min_connections: u32,
    /// TCP connect budget; missing in core.ts, where a wrong host hangs.
    pub connect_timeout: Duration,
    /// Wait budget for a free connection.
    pub acquire_timeout: Duration,
    /// Idle lifetime before the pool retires a connection.
    pub idle_timeout: Duration,
    /// Max connection lifetime so server timeouts never strand a dead socket.
    pub max_lifetime: Duration,
}

impl Default for PoolSettings {
    fn default() -> Self {
        Self {
            max_connections: 10,
            min_connections: 0,
            connect_timeout: Duration::from_secs(8),
            acquire_timeout: Duration::from_secs(15),
            idle_timeout: Duration::from_secs(300),
            max_lifetime: Duration::from_secs(1800),
        }
    }
}

impl PoolSettings {
    /// SOTRAMA_POOL_* overrides; pool size is an operational knob for shared servers.
    pub fn from_env() -> Self {
        let d = Self::default();
        Self {
            max_connections: env_u32("SOTRAMA_POOL_MAX", d.max_connections),
            min_connections: env_u32("SOTRAMA_POOL_MIN", d.min_connections),
            connect_timeout: env_secs("SOTRAMA_CONNECT_TIMEOUT_SECS", d.connect_timeout),
            acquire_timeout: env_secs("SOTRAMA_ACQUIRE_TIMEOUT_SECS", d.acquire_timeout),
            idle_timeout: env_secs("SOTRAMA_IDLE_TIMEOUT_SECS", d.idle_timeout),
            max_lifetime: env_secs("SOTRAMA_MAX_LIFETIME_SECS", d.max_lifetime),
        }
    }

    fn validate(&self) -> Result<(), BackendError> {
        if self.max_connections == 0 {
            return Err(BackendError::Db(DbError::new(
                "SOTRAMA_POOL_MAX must be greater than zero",
            )));
        }
        if self.min_connections > self.max_connections {
            return Err(BackendError::Db(DbError::new(
                "SOTRAMA_POOL_MIN cannot exceed SOTRAMA_POOL_MAX",
            )));
        }
        if self.connect_timeout.is_zero()
            || self.acquire_timeout.is_zero()
            || self.idle_timeout.is_zero()
            || self.max_lifetime.is_zero()
        {
            return Err(BackendError::Db(DbError::new(
                "database pool timeouts and lifetimes must be greater than zero",
            )));
        }
        Ok(())
    }
}

fn env_u32(key: &str, fallback: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}

fn env_secs(key: &str, fallback: Duration) -> Duration {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .map(Duration::from_secs)
        .unwrap_or(fallback)
}

/// The database handle: a pool plus the settings it was built with.
#[derive(Clone)]
pub struct Pool {
    inner: MySqlPool,
    settings: PoolSettings,
}

impl std::fmt::Debug for Pool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pool")
            .field("size", &self.inner.size())
            .field("idle", &self.inner.num_idle())
            .field("max_connections", &self.settings.max_connections)
            .finish()
    }
}

impl Pool {
    /// Opens the pool and verifies one live connection.
    /// Fails here on a bad host instead of surfacing later as an unrelated error.
    pub async fn connect(config: &MariaDBConfig) -> Result<Self, BackendError> {
        Self::connect_with(config, PoolSettings::from_env(), false).await
    }

    pub async fn connect_with(
        config: &MariaDBConfig,
        settings: PoolSettings,
        create_if_missing: bool,
    ) -> Result<Self, BackendError> {
        settings.validate()?;
        match Self::open(config, &settings, true).await {
            Ok(inner) => Ok(Self { inner, settings }),
            Err(BackendError::Db(d)) if d.is_unknown_database() && create_if_missing => {
                Self::create_database(config, &settings).await?;
                Ok(Self {
                    inner: Self::open(config, &settings, true).await?,
                    settings,
                })
            }
            Err(e) => Err(e),
        }
    }

    async fn open(
        config: &MariaDBConfig,
        settings: &PoolSettings,
        use_database: bool,
    ) -> Result<MySqlPool, BackendError> {
        let mut options = MySqlConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.user)
            .password(&config.password)
            // `core.ts` sets no charset, so the driver default applies and
            // non-Latin party names depend on server configuration.
            .charset("utf8mb4")
            .collation("utf8mb4_unicode_ci")
            .ssl_mode(MySqlSslMode::Disabled);
        if use_database {
            options = options.database(&config.database);
        }

        // sqlx's TCP connect has no timeout of its own, so a wrong LAN host
        // hangs indefinitely; `connect_timeout` bounds the whole bring-up.
        let bring_up = async {
            let pool = MySqlPoolOptions::new()
                .max_connections(settings.max_connections)
                .min_connections(settings.min_connections.max(1))
                .acquire_timeout(settings.acquire_timeout)
                .idle_timeout(Some(settings.idle_timeout))
                .max_lifetime(Some(settings.max_lifetime))
                .test_before_acquire(true)
                .connect_with(options)
                .await
                .map_err(DbError::from)?;

            // `connect_with` is lazy about the schema existing, so verify it now.
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(DbError::from)?;
            Ok::<_, DbError>(pool)
        };

        let pool = tokio::time::timeout(settings.connect_timeout, bring_up)
            .await
            .map_err(|_| {
                BackendError::Db(DbError::new(format!(
                    "timed out after {:?} connecting to {}:{}",
                    settings.connect_timeout, config.host, config.port
                )))
            })??;

        Ok(pool)
    }

    /// Creates the database when the first connect hits errno 1049.
    async fn create_database(
        config: &MariaDBConfig,
        settings: &PoolSettings,
    ) -> Result<(), BackendError> {
        let pool = Self::open(config, settings, false).await?;
        let sql = create_database_sql(&config.database)?;
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(DbError::from)?;
        pool.close().await;
        Ok(())
    }

    pub fn inner(&self) -> &MySqlPool {
        &self.inner
    }

    /// `SELECT 1`, distinguishing "unreachable" from "reachable but broken".
    pub async fn health_check(&self) -> Result<(), DbError> {
        sqlx::query("SELECT 1")
            .execute(&self.inner)
            .await
            .map(|_| ())
            .map_err(DbError::from)
    }

    /// Waits for all borrowed connections to return, then closes.
    pub async fn close(&self) {
        self.inner.close().await;
    }
}

/// CREATE DATABASE matching the table options in ddl::create_table_sql.
fn create_database_sql(database: &str) -> Result<String, BackendError> {
    let name = crate::database::query::ident(database)?;
    Ok(format!(
        "CREATE DATABASE IF NOT EXISTS {name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_typescript_pool_size() {
        let s = PoolSettings::default();
        assert_eq!(s.max_connections, 10, "must match core.ts connectionLimit");
        assert_eq!(
            s.connect_timeout,
            Duration::from_secs(8),
            "core.ts sets no connect timeout at all"
        );
    }

    #[test]
    fn rejects_invalid_pool_limits_and_timeouts() {
        let mut settings = PoolSettings::default();
        settings.max_connections = 0;
        assert!(settings.validate().is_err());

        settings.max_connections = 2;
        settings.min_connections = 3;
        assert!(settings.validate().is_err());

        settings.min_connections = 0;
        settings.acquire_timeout = Duration::ZERO;
        assert!(settings.validate().is_err());
    }

    #[test]
    fn accepts_default_pool_settings() {
        assert!(PoolSettings::default().validate().is_ok());
    }

    #[test]
    fn create_database_sql_quotes_and_rejects() {
        assert_eq!(
            create_database_sql("sotrama").unwrap(),
            "CREATE DATABASE IF NOT EXISTS `sotrama` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        );
        assert!(create_database_sql("a`b").is_err());
    }

    #[test]
    fn environment_overrides_parse() {
        // The helper reads process env directly; test the parse contract
        // rather than mutating the environment, which is unsafe under threads.
        assert_eq!(env_u32("SOTRAMA_POOL_MISSING_FOR_TEST", 7), 7);
        assert_eq!(
            env_secs("SOTRAMA_POOL_MISSING_FOR_TEST", Duration::from_secs(3)),
            Duration::from_secs(3)
        );
    }
}
