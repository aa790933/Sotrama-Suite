//! Line-delimited JSON-RPC over stdio. Logs go to stderr; stdout is protocol only.
//! Method names and envelope match main/ipc/router.ts:dbCall so IpcDatabaseAdapter works unchanged.

use std::sync::Arc;

use serde_json::{json, Value};
use sqlx::{Acquire, MySqlConnection};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tracing::{debug, warn};

use crate::database::crud;
use crate::database::Db;
use crate::error::{BackendError, WireResponse};
use crate::schemas::Registry;
use crate::types::{DatabaseMethod, GetAllOptions};

/// The `db.*` wire method names this server answers.
const M_CONNECT: &str = "db.connect";
const M_SCHEMA: &str = "db.schema";
const M_PING: &str = "db.ping";
const M_CLOSE: &str = "db.close";
const M_CALL: &str = "db.call";

pub struct IpcServer {
    db: Arc<Db>,
}

impl IpcServer {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    pub async fn serve(self) -> std::io::Result<()> {
        let stdin = BufReader::new(tokio::io::stdin());
        let mut lines = stdin.lines();
        let mut stdout = tokio::io::stdout();

        while let Some(line) = lines.next_line().await? {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let response = match serde_json::from_str::<Value>(line) {
                Ok(request) => self.handle(request).await,
                Err(e) => {
                    // Without an id there is nobody to answer.
                    warn!("malformed request: {e}");
                    continue;
                }
            };

            let Some(response) = response else {
                continue;
            };

            stdout.write_all(format!("{response}\n").as_bytes()).await?;
            stdout.flush().await?;
        }

        Ok(())
    }

    async fn handle(&self, request: Value) -> Option<Value> {
        // This private protocol intentionally supports integer IDs only, matching
        // RustBackendClient. Invalid requests with a usable ID receive an error
        // envelope instead of hanging the caller until its timeout.
        let id = request
            .get("id")
            .filter(|id| id.as_i64().is_some() || id.as_u64().is_some())
            .cloned()?;
        let result = if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
            Err(BackendError::InvalidArgument(
                "jsonrpc must be '2.0'".into(),
            ))
        } else if let Some(method) = request.get("method").and_then(Value::as_str) {
            let params = request
                .get("params")
                .cloned()
                .unwrap_or(Value::Array(vec![]));
            if !params.is_array() {
                Err(BackendError::InvalidArgument(
                    "params must be an array".into(),
                ))
            } else {
                debug!("ipc: {method}");
                self.dispatch(method, params).await
            }
        } else {
            Err(BackendError::InvalidArgument(
                "method must be a string".into(),
            ))
        };

        Some(match result {
            Ok(data) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": serde_json::to_value(WireResponse::ok(data)).unwrap_or(Value::Null),
            }),
            Err(e) => {
                let wire = WireResponse::err(&e);
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": serde_json::to_value(&wire).unwrap_or(Value::Null),
                })
            }
        })
    }

    async fn dispatch(&self, method: &str, params: Value) -> Result<Value, BackendError> {
        match method {
            M_PING => {
                self.db
                    .pool()
                    .health_check()
                    .await
                    .map_err(BackendError::from)?;
                Ok(json!({ "ok": true }))
            }
            M_SCHEMA => Ok(json!(self.db.registry().schemas())),
            M_CONNECT => Ok(json!({ "countryCode": self.db.country_code() })),
            M_CLOSE => {
                self.db.close().await;
                Ok(json!({ "ok": true }))
            }
            M_CALL => self.call(params).await,
            other => Err(BackendError::InvalidArgument(format!(
                "unknown ipc method: {other}"
            ))),
        }
    }

    async fn call(&self, params: Value) -> Result<Value, BackendError> {
        let args = params
            .as_array()
            .ok_or_else(|| BackendError::InvalidArgument("db.call expects an array".into()))?;
        if args.is_empty() {
            return Err(BackendError::InvalidArgument(
                "db.call needs a method".into(),
            ));
        }

        let method: DatabaseMethod = args[0]
            .as_str()
            .ok_or_else(|| BackendError::InvalidArgument("method must be a string".into()))?
            .parse()
            .map_err(BackendError::InvalidArgument)?;

        let rest = &args[1..];

        // Closing the pool while holding one of its connections would hang.
        if method == DatabaseMethod::Close {
            self.db.close().await;
            return Ok(Value::Null);
        }

        let mut conn = self
            .db
            .pool()
            .inner()
            .acquire()
            .await
            .map_err(BackendError::from)?;
        let mut tx = conn.begin().await.map_err(BackendError::from)?;

        match call_with(&mut tx, self.db.registry(), method, rest).await {
            Ok(value) => {
                tx.commit().await.map_err(BackendError::from)?;
                Ok(value)
            }
            Err(e) => {
                // A failed rollback must not mask the original error.
                let _ = tx.rollback().await;
                Err(e)
            }
        }
    }
}

async fn call_with(
    conn: &mut MySqlConnection,
    registry: &Registry,
    method: DatabaseMethod,
    args: &[Value],
) -> Result<Value, BackendError> {
    let registry = registry.clone();
    let result = match method {
        DatabaseMethod::Insert => {
            let (name, values) = schema_and_map(args)?;
            crud::insert(conn, &registry, &name, &values).await?
        }
        DatabaseMethod::Update => {
            let (name, values) = schema_and_map(args)?;
            crud::update(conn, &registry, &name, &values).await?;
            Value::Null
        }
        DatabaseMethod::Get => {
            let name = arg_str(args, 0)?;
            let key = arg_str(args, 1).unwrap_or_default();
            let fields = args.get(2).map(|v| GetAllOptions::as_list(Some(v)));
            crud::get(conn, &registry, &name, &key, fields.as_deref()).await?
        }
        DatabaseMethod::GetAll => {
            let name = arg_str(args, 0)?;
            let options: GetAllOptions =
                serde_json::from_value(args.get(1).cloned().unwrap_or_else(|| json!({})))
                    .map_err(|e| BackendError::InvalidArgument(format!("getAll options: {e}")))?;
            let rows = crud::get_all(conn, &registry, &name, &options).await?;
            Value::Array(rows.into_iter().map(Value::Object).collect())
        }
        DatabaseMethod::Count => {
            let name = arg_str(args, 0)?;
            // core.ts passes an options object here, not the filter map itself.
            let options: GetAllOptions =
                serde_json::from_value(args.get(1).cloned().unwrap_or_else(|| json!({})))
                    .map_err(|e| BackendError::InvalidArgument(format!("count options: {e}")))?;
            let empty = serde_json::Map::new();
            let count = crud::count(
                conn,
                &registry,
                &name,
                options.filters.as_ref().unwrap_or(&empty),
            )
            .await?;
            json!(count)
        }
        DatabaseMethod::Exists => {
            let name = arg_str(args, 0)?;
            let key = args.get(1).and_then(Value::as_str);
            json!(crud::exists(conn, &registry, &name, key).await?)
        }
        DatabaseMethod::Rename => {
            crud::rename(
                conn,
                &arg_str(args, 0)?,
                &arg_str(args, 1)?,
                &arg_str(args, 2)?,
            )
            .await?;
            Value::Null
        }
        DatabaseMethod::Delete => {
            crud::delete(conn, &registry, &arg_str(args, 0)?, &arg_str(args, 1)?).await?;
            Value::Null
        }
        DatabaseMethod::DeleteAll => {
            let name = arg_str(args, 0)?;
            let filters = args
                .get(1)
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();
            json!(crud::delete_all(conn, &registry, &name, &filters).await?)
        }
        DatabaseMethod::GetSingleValues => {
            let specs: Vec<(String, Option<String>)> = args
                .iter()
                .filter_map(|v| match v {
                    Value::String(s) => Some((s.clone(), None)),
                    Value::Object(m) => Some((
                        m.get("fieldname")?.as_str()?.to_string(),
                        m.get("parent").and_then(Value::as_str).map(str::to_string),
                    )),
                    _ => None,
                })
                .collect();
            let rows = crud::get_single_values(conn, &specs).await?;
            Value::Array(
                rows.into_iter()
                    .map(|(fieldname, parent, value)| {
                        json!({ "fieldname": fieldname, "parent": parent, "value": value })
                    })
                    .collect(),
            )
        }
        DatabaseMethod::GetNextAutoincrementId => {
            json!(crud::next_autoincrement_id(conn, &arg_str(args, 0)?).await?)
        }
        DatabaseMethod::GetNextSeriesValue => {
            json!(crud::next_series_value(conn, &arg_str(args, 0)?, &arg_str(args, 1)?).await?)
        }
        // Handled before the transaction opens, since it closes the pool.
        DatabaseMethod::Close => Value::Null,
    };

    Ok(result)
}

fn arg_str(args: &[Value], index: usize) -> Result<String, BackendError> {
    args.get(index)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| BackendError::InvalidArgument(format!("argument {index} must be a string")))
}

fn schema_and_map(
    args: &[Value],
) -> Result<(String, serde_json::Map<String, Value>), BackendError> {
    let name = arg_str(args, 0)?;
    let values = args
        .get(1)
        .and_then(|v| v.as_object())
        .cloned()
        .ok_or_else(|| BackendError::InvalidArgument("values must be an object".into()))?;
    Ok((name, values))
}
