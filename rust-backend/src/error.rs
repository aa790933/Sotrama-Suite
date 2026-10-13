//! Error types. `DbError` keeps the driver's errno/sql_state/fatal so the
//! renderer classifies failures without matching on message text.

use serde::Serialize;
use serde_json::Value;
use std::fmt;

/// A database failure with the driver's own classification preserved.
#[derive(Debug)]
pub struct DbError {
    /// MariaDB/MySQL error number, e.g. 1045 access denied, 2002 connection
    /// refused, 3780 incompatible FK columns.
    pub errno: Option<u16>,
    /// Five-character SQLSTATE, e.g. `28000`, `42S02`, `40001`.
    pub sql_state: Option<String>,
    /// MariaDB sets this when the connection cannot be reused.
    pub fatal: Option<bool>,
    pub message: String,
}

impl DbError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            errno: None,
            sql_state: None,
            fatal: None,
            message: message.into(),
        }
    }

    pub fn is_deadlock(&self) -> bool {
        matches!(self.errno, Some(1213 | 1205))
    }

    pub fn is_duplicate_key(&self) -> bool {
        self.errno == Some(1062)
    }

    /// 1146: table does not exist. Callers probing for optional tables treat it as "nothing there".
    pub fn is_missing_table(&self) -> bool {
        self.errno == Some(1146)
    }

    /// 1049: unknown database. The database is created on first connect.
    pub fn is_unknown_database(&self) -> bool {
        self.errno == Some(1049)
    }

    pub fn is_referential_integrity(&self) -> bool {
        matches!(self.errno, Some(1451 | 1452 | 3780))
    }
}

impl From<sqlx::Error> for DbError {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::Database(db) => {
                let mysql = db.try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>();
                Self {
                    // code() is the SQLSTATE string; errno lives on the MySQL type.
                    errno: mysql.map(|m| m.number()),
                    sql_state: db.code().map(|c| c.into_owned()),
                    // sqlx exposes no fatal flag; these errnos mean the connection is dead.
                    fatal: mysql.map(|m| matches!(m.number(), 1053 | 1927 | 1929)),
                    message: db.to_string(),
                }
            }
            sqlx::Error::PoolTimedOut => Self {
                errno: None,
                sql_state: None,
                fatal: Some(false),
                message: "timed out waiting for a free connection from the pool".into(),
            },
            sqlx::Error::Io(e) => Self {
                errno: None,
                sql_state: None,
                fatal: Some(true),
                message: e.to_string(),
            },
            other => Self {
                errno: None,
                sql_state: None,
                fatal: None,
                message: other.to_string(),
            },
        }
    }
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (&self.errno, &self.sql_state) {
            (Some(e), Some(s)) => write!(f, "[{e}/{s}] {}", self.message),
            (Some(e), None) => write!(f, "[{}] {}", e, self.message),
            (None, Some(s)) => write!(f, "[{s}] {}", self.message),
            (None, None) => f.write_str(&self.message),
        }
    }
}

impl std::error::Error for DbError {}

/// Everything this backend can fail with.
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("{0}")]
    Db(#[from] DbError),

    #[error("unknown schema: {0}")]
    UnknownSchema(String),

    #[error("schema {schema} is not configured for this connection")]
    #[allow(dead_code)]
    NotConfigured { schema: String },

    #[error("{0}")]
    InvalidArgument(String),

    #[error("invalid identifier: {0}")]
    InvalidIdentifier(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization: {0}")]
    Serde(#[from] serde_json::Error),
}

impl From<BackendError> for DbError {
    fn from(e: BackendError) -> Self {
        match e {
            BackendError::Db(e) => e,
            BackendError::UnknownSchema(s) => DbError::new(format!("schema {s} not found")),
            BackendError::NotConfigured { schema } => DbError::new(format!(
                "schema {schema} is not configured for this connection"
            )),
            BackendError::InvalidArgument(s) => DbError::new(s),
            BackendError::InvalidIdentifier(s) => DbError::new(format!("invalid identifier: {s}")),
            BackendError::Io(e) => DbError::new(e.to_string()),
            BackendError::Serde(e) => DbError::new(e.to_string()),
        }
    }
}

/// IPC error shape the renderer expects, plus the driver fields it was losing.
#[derive(Debug, Serialize)]
pub struct WireError {
    pub name: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errno: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fatal: Option<bool>,
}

impl WireError {
    /// Same classes as DatabaseCore, keyed on errno instead of message text.
    pub fn from_error(e: &BackendError) -> Self {
        let db = DbError::from_ref(e);
        Self {
            name: name_for(&db, e).to_string(),
            message: db.message.clone(),
            stack: None,
            // SQLSTATE is exposed separately; don't mislabel it as the driver's
            // symbolic `code` field used by the TypeScript error contract.
            code: None,
            errno: db.errno,
            sql_state: db.sql_state.clone(),
            fatal: db.fatal,
        }
    }
}

impl DbError {
    fn from_ref(e: &BackendError) -> DbError {
        match e {
            BackendError::Db(d) => DbError {
                errno: d.errno,
                sql_state: d.sql_state.clone(),
                fatal: d.fatal,
                message: d.message.clone(),
            },
            other => DbError::new(other.to_string()),
        }
    }
}

fn name_for(db: &DbError, e: &BackendError) -> &'static str {
    if db.is_duplicate_key() {
        return "DuplicateEntryError";
    }
    if db.is_deadlock() {
        return "CannotCommitError";
    }
    if db.is_missing_table() {
        return "NotFoundError";
    }
    if db.is_referential_integrity() {
        return "ForeignKeyError";
    }
    match e {
        BackendError::InvalidArgument(_) | BackendError::InvalidIdentifier(_) => "ValueError",
        BackendError::UnknownSchema(_) | BackendError::NotConfigured { .. } => "NotFoundError",
        _ => "DatabaseError",
    }
}

/// IPC response envelope, matching BackendResponse in backend/database/types.ts.
#[derive(Debug, Serialize)]
pub struct WireResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WireError>,
}

impl WireResponse {
    pub fn ok(data: Value) -> Self {
        Self {
            data: Some(data),
            error: None,
        }
    }

    pub fn err(e: &BackendError) -> Self {
        Self {
            data: None,
            error: Some(WireError::from_error(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_response_matches_backend_response_contract() {
        let value = serde_json::to_value(WireResponse::ok(serde_json::json!({
            "countryCode": "dz"
        })))
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "data": { "countryCode": "dz" } })
        );
    }

    #[test]
    fn error_response_has_renderer_fields() {
        let error = BackendError::InvalidArgument("bad request".into());
        let value = serde_json::to_value(WireResponse::err(&error)).unwrap();
        assert_eq!(value["error"]["name"], "ValueError");
        assert_eq!(value["error"]["message"], "bad request");
        assert!(value.get("data").is_none());
    }

    #[test]
    fn database_error_display_keeps_errno_before_sql_state() {
        let error = DbError {
            errno: Some(1045),
            sql_state: Some("28000".into()),
            fatal: Some(false),
            message: "access denied".into(),
        };
        assert_eq!(error.to_string(), "[1045/28000] access denied");
    }

    #[test]
    fn renderer_error_classification_uses_driver_errno() {
        let duplicate = DbError {
            errno: Some(1062),
            sql_state: Some("23000".into()),
            fatal: Some(false),
            message: "duplicate".into(),
        };
        let duplicate_backend = BackendError::Db(DbError {
            errno: Some(1062),
            sql_state: Some("23000".into()),
            fatal: Some(false),
            message: "duplicate".into(),
        });
        assert_eq!(
            name_for(&duplicate, &duplicate_backend),
            "DuplicateEntryError"
        );

        let missing = DbError {
            errno: Some(1146),
            sql_state: Some("42S02".into()),
            fatal: Some(false),
            message: "missing table".into(),
        };
        let missing_backend = BackendError::Db(DbError {
            errno: Some(1146),
            sql_state: Some("42S02".into()),
            fatal: Some(false),
            message: "missing table".into(),
        });
        assert_eq!(name_for(&missing, &missing_backend), "NotFoundError");
    }

    #[test]
    fn pool_acquisition_timeout_is_classified_as_retriable() {
        let error = DbError::from(sqlx::Error::PoolTimedOut);
        assert_eq!(error.fatal, Some(false));
        assert!(error
            .message
            .contains("timed out waiting for a free connection"));
    }
}
