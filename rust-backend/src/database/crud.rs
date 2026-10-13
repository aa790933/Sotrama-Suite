//! Document CRUD matching core.ts behaviour; intentional divergences are noted at the call site.

use serde_json::{Map, Value};
use sqlx::{MySqlConnection, Row};

use crate::database::ddl;
use crate::database::query::{self, Bind, Statement};
use crate::database::row::{decode_row, encode_value};
use crate::error::{BackendError, DbError};
use crate::schemas::{table_name, Registry};
use crate::types::{Field, GetAllOptions, RawCustomField, Row as RowMap, Schema};

/// Builds a bound query; the macro keeps the SQL string alive for the borrow.
macro_rules! stmt {
    ($sql:expr, $params:expr) => {{
        let sql: &str = $sql;
        let mut q = sqlx::query(sql);
        for p in $params {
            q = match p {
                Bind::Null => q.bind(Option::<String>::None),
                Bind::Int(v) => q.bind(*v),
                Bind::Float(v) => q.bind(*v),
                Bind::Text(v) => q.bind(v.clone()),
            };
        }
        q
    }};
}

/// A random primary key, matching `getRandomString` in `utils/index.ts`.
pub fn random_name() -> String {
    use rand::Rng;
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::rng();
    let suffix: String = (0..6)
        .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char)
        .collect();
    format!(
        "{suffix}-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    )
}

fn table_of(schema_name: &str) -> Result<String, BackendError> {
    query::ident(&table_name(schema_name))
}

fn schema_of<'a>(registry: &'a Registry, name: &str) -> Result<&'a Schema, BackendError> {
    registry.get(name)
}

fn field_type_of(schema: Option<&Schema>, fieldname: &str) -> Option<crate::types::FieldType> {
    schema
        .and_then(|s| s.field(fieldname))
        .and_then(|f| f.field_type().ok())
}

async fn fetch_rows(
    conn: &mut MySqlConnection,
    st: &Statement,
    schema: Option<&Schema>,
) -> Result<Vec<RowMap>, BackendError> {
    let rows = stmt!(&st.sql, &st.params).fetch_all(&mut *conn).await;
    match rows {
        Ok(rows) => Ok(rows.iter().map(|r| decode_row(r, schema)).collect()),
        Err(e) => Err(DbError::from(e).into()),
    }
}

/// Reads `customfield`. A missing table means a first run, not a failure.
pub async fn load_custom_fields(pool: &sqlx::MySqlPool) -> Result<Vec<RawCustomField>, DbError> {
    // Select the available columns so an older populated installation can
    // still start far enough to run schema migration. Optional columns were
    // added over time and may legitimately be absent before that migration.
    let rows = sqlx::query("SELECT * FROM `customfield`")
        .fetch_all(pool)
        .await
        .map_err(DbError::from)?;

    let mut fields = Vec::with_capacity(rows.len());
    for row in &rows {
        // A malformed custom-field row must fail connection setup. Silently
        // dropping it creates a schema that differs between clients on the LAN.
        let parent = row.try_get("parent").map_err(DbError::from)?;
        let label = optional_custom_field_string(row, "label")?.unwrap_or_default();
        let fieldname = row.try_get("fieldname").map_err(DbError::from)?;
        let fieldtype = row.try_get("fieldtype").map_err(DbError::from)?;
        let is_required = optional_custom_field_flag(row, "isRequired")?.map(|value| value != 0);

        fields.push(RawCustomField {
            parent,
            label,
            fieldname,
            fieldtype,
            is_required,
            section: optional_custom_field_string(row, "section")?,
            tab: optional_custom_field_string(row, "tab")?,
            options: optional_custom_field_string(row, "options")?,
            target: optional_custom_field_string(row, "target")?,
            references: optional_custom_field_string(row, "references")?,
            default: optional_custom_field_string(row, "default")?,
        });
    }
    Ok(fields)
}

fn optional_custom_field_string(
    row: &sqlx::mysql::MySqlRow,
    column: &str,
) -> Result<Option<String>, DbError> {
    match row.try_get::<Option<String>, _>(column) {
        Ok(value) => Ok(value),
        // Old schemas may not have optional custom-field columns yet. A
        // decoding error on a column that does exist is not treated as NULL.
        Err(sqlx::Error::ColumnNotFound(_)) => Ok(None),
        Err(error) => Err(DbError::from(error)),
    }
}

fn optional_custom_field_flag(
    row: &sqlx::mysql::MySqlRow,
    column: &str,
) -> Result<Option<i8>, DbError> {
    match row.try_get::<Option<i8>, _>(column) {
        Ok(value) => Ok(value),
        Err(sqlx::Error::ColumnNotFound(_)) => Ok(None),
        Err(error) => Err(DbError::from(error)),
    }
}

/// `get(schema, name, fields)`: one row plus its child tables.
pub async fn get(
    conn: &mut MySqlConnection,
    registry: &Registry,
    schema_name: &str,
    name: &str,
    fields: Option<&[String]>,
) -> Result<Map<String, Value>, BackendError> {
    let schema = schema_of(registry, schema_name)?;
    if schema.is_single() {
        return get_single(conn, schema_name).await;
    }
    if name.is_empty() {
        return Err(BackendError::InvalidArgument(format!(
            "name is required to read {schema_name}"
        )));
    }

    let requested: Vec<String> = match fields {
        Some(f) if !f.is_empty() => f.to_vec(),
        _ => schema
            .column_fields()
            .map(|f| f.fieldname.clone())
            .collect(),
    };
    let mut columns = Vec::with_capacity(requested.len());
    let mut child_fields: Vec<&Field> = Vec::new();
    for fieldname in &requested {
        match schema.field(fieldname) {
            Some(field) if field.fieldtype == "Table" => child_fields.push(field),
            _ => columns.push(fieldname.clone()),
        }
    }

    let mut out = Map::new();
    if !columns.is_empty() {
        let st = query::build_select_by_name(&table_of(schema_name)?, &columns, name)?;
        if let Some(row) = fetch_rows(conn, &st, Some(schema))
            .await?
            .into_iter()
            .next()
        {
            out = row;
        }
    }

    for field in child_fields {
        let Some(target) = field.target.as_deref() else {
            continue;
        };
        out.insert(
            field.fieldname.clone(),
            Value::Array(
                load_children(conn, registry, target, name)
                    .await?
                    .into_iter()
                    .collect(),
            ),
        );
    }

    Ok(out)
}

/// Child rows for one parent, ordered by `idx`.
async fn load_children(
    conn: &mut MySqlConnection,
    registry: &Registry,
    target: &str,
    parent: &str,
) -> Result<Vec<RowMap>, BackendError> {
    let child_schema = registry.get(target).ok();
    let st = query::build_select(
        &table_of(target)?,
        &["*".to_string()],
        &serde_json::Map::from_iter([("parent".to_string(), Value::String(parent.to_string()))]),
        &[],
        &["idx".to_string()],
        Some("asc"),
        None,
        None,
    )?;
    fetch_rows(conn, &st, child_schema).await
}

/// `getAll`: filters, paging, ordering.
pub async fn get_all(
    conn: &mut MySqlConnection,
    registry: &Registry,
    schema_name: &str,
    options: &GetAllOptions,
) -> Result<Vec<RowMap>, BackendError> {
    let schema = schema_of(registry, schema_name)?;

    let mut fields = GetAllOptions::as_list(options.fields.as_ref());
    if fields.is_empty() {
        fields = vec!["name".to_string()];
    }

    // core.ts sorts by created desc by default; an explicit order_by wins.
    let order_by = match GetAllOptions::as_list(options.order_by.as_ref()).first() {
        Some(col) => vec![col.clone()],
        None if schema.has_column("created") => vec!["created".to_string()],
        None => Vec::new(),
    };
    let order = Some(options.order.as_deref().unwrap_or("desc"));

    let st = query::build_select(
        &table_of(schema_name)?,
        &fields,
        options.filters.as_ref().unwrap_or(&serde_json::Map::new()),
        &GetAllOptions::as_list(options.group_by.as_ref()),
        &order_by,
        order,
        options.limit,
        options.offset,
    )?;

    fetch_rows(conn, &st, Some(schema)).await
}

pub async fn count(
    conn: &mut MySqlConnection,
    registry: &Registry,
    schema_name: &str,
    filters: &serde_json::Map<String, Value>,
) -> Result<i64, BackendError> {
    schema_of(registry, schema_name)?;
    let st = query::build_count(&table_of(schema_name)?, filters)?;
    let row = stmt!(&st.sql, &st.params)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| BackendError::from(DbError::from(e)))?;
    row.try_get::<i64, _>(0)
        .or_else(|_| row.try_get::<i64, _>("COUNT(*)"))
        .map_err(|e| BackendError::from(DbError::from(e)))
}

/// `exists(name)` checks one row; `exists()` with no name checks whether the
/// table holds anything at all.
pub async fn exists(
    conn: &mut MySqlConnection,
    registry: &Registry,
    schema_name: &str,
    name: Option<&str>,
) -> Result<bool, BackendError> {
    let schema = schema_of(registry, schema_name)?;
    let table = table_of(schema_name)?;

    if schema.is_single() {
        let found = sqlx::query("SELECT 1 FROM `singlevalue` WHERE `parent` = ? LIMIT 1")
            .bind(schema_name)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| BackendError::from(DbError::from(e)))?;
        return Ok(found.is_some());
    }

    let sql = match name {
        Some(_) => format!("SELECT 1 FROM {table} WHERE `name` = ? LIMIT 1"),
        None => format!("SELECT 1 FROM {table} LIMIT 1"),
    };
    let mut q = sqlx::query(&sql);
    if let Some(n) = name {
        q = q.bind(n);
    }

    match q.fetch_optional(&mut *conn).await {
        Ok(found) => Ok(found.is_some()),
        Err(e) => {
            // core.ts swallows 1146 here, which also swallows a dropped connection.
            let e = DbError::from(e);
            if e.is_missing_table() {
                Ok(false)
            } else {
                Err(e.into())
            }
        }
    }
}

/// `insert`: the parent row and every child table, in one transaction.
pub async fn insert(
    conn: &mut MySqlConnection,
    registry: &Registry,
    schema_name: &str,
    values: &Map<String, Value>,
) -> Result<Map<String, Value>, BackendError> {
    let schema = schema_of(registry, schema_name)?;
    let mut values = values.clone();

    if schema.is_single() {
        set_single_values(conn, schema_name, &values).await?;
        return Ok(values);
    }

    if values
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty()
    {
        values.insert("name".into(), Value::String(random_name()));
    }

    insert_row(conn, schema, &values).await?;
    sync_children(conn, registry, schema, &values, false).await?;
    Ok(values)
}

/// Column list from the schema, omitting absent keys so column defaults apply.
fn insert_columns(schema: &Schema, values: &Map<String, Value>) -> Vec<String> {
    schema
        .column_fields()
        .map(|f| f.fieldname.clone())
        .filter(|c| values.contains_key(c))
        .collect()
}

async fn insert_row(
    conn: &mut MySqlConnection,
    schema: &Schema,
    values: &Map<String, Value>,
) -> Result<(), BackendError> {
    let columns = insert_columns(schema, values);
    if columns.is_empty() {
        return Err(BackendError::InvalidArgument(format!(
            "insert into {} supplied no known columns",
            schema.name
        )));
    }

    let mut params = Vec::with_capacity(columns.len());
    for c in &columns {
        params.push(encode_value(
            values.get(c).unwrap_or(&Value::Null),
            field_type_of(Some(schema), c),
        ));
    }

    let list = columns
        .iter()
        .map(|c| query::ident(c))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let sql = format!(
        "INSERT INTO {} ({list}) VALUES ({})",
        table_of(&schema.name)?,
        vec!["?"; columns.len()].join(", ")
    );

    stmt!(&sql, &params).execute(&mut *conn).await.map_err(db_err)?;
    Ok(())
}

/// Partial update with children reconciled; unknown keys are rejected before building (errno 1054).
pub async fn update(
    conn: &mut MySqlConnection,
    registry: &Registry,
    schema_name: &str,
    values: &Map<String, Value>,
) -> Result<(), BackendError> {
    let schema = schema_of(registry, schema_name)?;
    if schema.is_single() {
        return set_single_values(conn, schema_name, values).await;
    }

    let name = values
        .get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            BackendError::InvalidArgument("update requires a non-empty `name`".into())
        })?;

    let assignments: Vec<String> = schema
        .column_fields()
        .map(|f| f.fieldname.clone())
        .filter(|c| c != "name" && values.contains_key(c))
        .collect();

    if !assignments.is_empty() {
        let mut params = Vec::with_capacity(assignments.len());
        for c in &assignments {
            params.push(encode_value(
                values.get(c).unwrap_or(&Value::Null),
                field_type_of(Some(schema), c),
            ));
        }
        let st = query::build_update_by_name(&table_of(schema_name)?, &assignments, params, name)?;

        let result = stmt!(&st.sql, &st.params)
            .execute(&mut *conn)
            .await
            .map_err(db_err)?;
        // MariaDB reports zero affected rows when the supplied values are
        // identical to the stored values. Distinguish that no-op from a
        // missing document before returning NotFound.
        if result.rows_affected() == 0 && !crud_exists(conn, schema_name, name).await? {
            return Err(DbError::new(format!("{schema_name} `{name}` does not exist")).into());
        }
    }

    sync_children(conn, registry, schema, values, true).await
}

/// Inserts, updates, then prunes children that are no longer present.
///
/// A child field absent from `values` is left alone; an explicit empty array
/// clears it. That distinction is how the renderer signals removal.
async fn sync_children(
    conn: &mut MySqlConnection,
    registry: &Registry,
    schema: &Schema,
    values: &Map<String, Value>,
    is_update: bool,
) -> Result<(), BackendError> {
    let parent_name = values
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    for field in schema.table_fields() {
        let Some(target) = field.target.as_deref() else {
            continue;
        };
        let Some(Value::Array(children)) = values.get(&field.fieldname) else {
            continue;
        };
        let child_schema = registry.get(target)?;

        let mut kept = Vec::with_capacity(children.len());
        for (index, child) in children.iter().enumerate() {
            let child_map = child.as_object().ok_or_else(|| {
                BackendError::InvalidArgument(format!(
                    "child row {} in {}.{} must be an object",
                    index, schema.name, field.fieldname
                ))
            })?;
            let mut row = child_map.clone();
            if row
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .is_empty()
            {
                row.insert("name".into(), Value::String(random_name()));
            }
            row.insert("parent".into(), Value::String(parent_name.clone()));
            row.insert(
                "parentSchemaName".into(),
                Value::String(schema.name.clone()),
            );
            row.insert(
                "parentFieldname".into(),
                Value::String(field.fieldname.clone()),
            );
            if !row.contains_key("idx") {
                row.insert("idx".into(), Value::from(index));
            }
            kept.push(
                row.get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            );

            let exists =
                crud_exists(conn, target, &row["name"].as_str().unwrap_or_default()).await?;
            if is_update && exists {
                update_row(conn, child_schema, &row).await?;
            } else {
                insert_row(conn, child_schema, &row).await?;
            }
        }

        if is_update {
            prune_children(conn, target, &parent_name, &kept).await?;
        }
    }

    Ok(())
}

async fn crud_exists(
    conn: &mut MySqlConnection,
    schema_name: &str,
    name: &str,
) -> Result<bool, BackendError> {
    let sql = format!(
        "SELECT 1 FROM {} WHERE `name` = ? LIMIT 1",
        table_of(schema_name)?
    );
    Ok(sqlx::query(&sql)
        .bind(name)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| BackendError::from(DbError::from(e)))?
        .is_some())
}

async fn update_row(
    conn: &mut MySqlConnection,
    schema: &Schema,
    values: &Map<String, Value>,
) -> Result<(), BackendError> {
    let assignments: Vec<String> = schema
        .column_fields()
        .map(|f| f.fieldname.clone())
        .filter(|c| c != "name" && values.contains_key(c))
        .collect();
    if assignments.is_empty() {
        return Ok(());
    }
    let params: Vec<Bind> = assignments
        .iter()
        .map(|c| {
            encode_value(
                values.get(c).unwrap_or(&Value::Null),
                field_type_of(Some(schema), c),
            )
        })
        .collect();
    let st = query::build_update_by_name(
        &table_of(&schema.name)?,
        &assignments,
        params,
        values
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )?;
    stmt!(&st.sql, &st.params)
        .execute(&mut *conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

async fn prune_children(
    conn: &mut MySqlConnection,
    target: &str,
    parent: &str,
    keep: &[String],
) -> Result<(), BackendError> {
    if keep.is_empty() {
        let sql = format!("DELETE FROM {} WHERE `parent` = ?", table_of(target)?);
        return stmt!(&sql, &[Bind::Text(parent.to_string())])
            .execute(&mut *conn)
            .await
            .map(|_| ())
            .map_err(db_err);
    }

    let mut params: Vec<Bind> = vec![Bind::Text(parent.to_string())];
    let holes = vec!["?"; keep.len()].join(", ");
    let sql = format!(
        "DELETE FROM {} WHERE `parent` = ? AND `name` NOT IN ({holes})",
        table_of(target)?
    );
    params.extend(keep.iter().map(|k| Bind::Text(k.clone())));
    stmt!(&sql, &params)
        .execute(&mut *conn)
        .await
        .map(|_| ())
        .map_err(db_err)
}

pub async fn rename(
    conn: &mut MySqlConnection,
    schema_name: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), BackendError> {
    let sql = format!(
        "UPDATE {} SET `name` = ? WHERE `name` = ?",
        table_of(schema_name)?
    );
    stmt!(
        &sql,
        &[Bind::Text(new_name.into()), Bind::Text(old_name.into())]
    )
    .execute(&mut *conn)
    .await
    .map(|_| ())
    .map_err(db_err)
}

/// Deletes a document and its direct children, in one transaction.
///
/// core.ts deletes only one level deep, so grandchildren survive their parent.
pub async fn delete(
    conn: &mut MySqlConnection,
    registry: &Registry,
    schema_name: &str,
    name: &str,
) -> Result<(), BackendError> {
    let schema = schema_of(registry, schema_name)?;
    if schema.is_single() {
        let sql = "DELETE FROM `singlevalue` WHERE `parent` = ? AND `fieldname` = ?";
        return stmt!(
            &sql,
            &[Bind::Text(schema_name.into()), Bind::Text(name.into())]
        )
        .execute(&mut *conn)
        .await
        .map(|_| ())
        .map_err(db_err);
    }

    let sql = format!("DELETE FROM {} WHERE `name` = ?", table_of(schema_name)?);
    stmt!(&sql, &[Bind::Text(name.to_string())])
        .execute(&mut *conn)
        .await
        .map_err(db_err)?;

    for field in schema.table_fields() {
        let Some(target) = field.target.as_deref() else {
            continue;
        };
        let sql = format!("DELETE FROM {} WHERE `parent` = ?", table_of(target)?);
        stmt!(&sql, &[Bind::Text(name.to_string())])
            .execute(&mut *conn)
            .await
            .map_err(db_err)?;
    }
    Ok(())
}

/// `deleteAll` returns the number of rows removed.
pub async fn delete_all(
    conn: &mut MySqlConnection,
    registry: &Registry,
    schema_name: &str,
    filters: &serde_json::Map<String, Value>,
) -> Result<u64, BackendError> {
    schema_of(registry, schema_name)?;
    let st = query::build_delete(&table_of(schema_name)?, filters)?;
    Ok(stmt!(&st.sql, &st.params)
        .execute(&mut *conn)
        .await
        .map_err(db_err)?
        .rows_affected())
}

/// Reads every stored value for a single-doc schema.
pub async fn get_single(
    conn: &mut MySqlConnection,
    schema_name: &str,
) -> Result<Map<String, Value>, BackendError> {
    let sql = "SELECT `fieldname`, `value` FROM `singlevalue` WHERE `parent` = ?";
    let rows = stmt!(sql, &[Bind::Text(schema_name.into())])
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| BackendError::from(DbError::from(e)))?;

    let mut out = Map::new();
    for r in rows {
        let fieldname: String = r
            .try_get("fieldname")
            .map_err(|e| BackendError::from(DbError::from(e)))?;
        let value: Option<Vec<u8>> = r
            .try_get("value")
            .map_err(|e| BackendError::from(DbError::from(e)))?;
        out.insert(
            fieldname,
            Value::String(
                value
                    .map(|b| String::from_utf8_lossy(&b).into_owned())
                    .unwrap_or_default(),
            ),
        );
    }
    Ok(out)
}

/// Upserts each provided field of a single-doc schema.
///
/// One statement per field rather than a batch, matching `#updateSingleValues`.
async fn set_single_values(
    conn: &mut MySqlConnection,
    schema_name: &str,
    values: &Map<String, Value>,
) -> Result<(), BackendError> {
    for (fieldname, value) in values {
        if fieldname == "name" {
            continue;
        }
        let bound = encode_value(value, None);
        let existing = sqlx::query_scalar::<_, String>(
            "SELECT `name` FROM `singlevalue` WHERE `parent` = ? AND `fieldname` = ? LIMIT 1",
        )
        .bind(schema_name)
        .bind(fieldname)
        .fetch_optional(&mut *conn)
        .await
        .map_err(db_err)?;

        if existing.is_some() {
            let sql = "UPDATE `singlevalue` SET `value` = ?, `modified` = NOW(6), \
                       `modifiedBy` = '__SYSTEM__' WHERE `parent` = ? AND `fieldname` = ?";
            stmt!(
                &sql,
                &[
                    bound,
                    Bind::Text(schema_name.to_string()),
                    Bind::Text(fieldname.clone()),
                ]
            )
            .execute(&mut *conn)
            .await
            .map_err(db_err)?;
        } else {
            let sql = "INSERT INTO `singlevalue` \
                       (`name`, `parent`, `fieldname`, `value`, `creation`, `modified`, \
                        `modifiedBy`, `createdBy`, `owner`) \
                       VALUES (?, ?, ?, ?, NOW(6), NOW(6), '__SYSTEM__', '__SYSTEM__', '__SYSTEM__')";
            stmt!(
                &sql,
                &[
                    Bind::Text(random_name()),
                    Bind::Text(schema_name.to_string()),
                    Bind::Text(fieldname.clone()),
                    bound,
                ]
            )
            .execute(&mut *conn)
            .await
            .map_err(db_err)?;
        }
    }
    Ok(())
}

/// Adds defaults for missing single-value fields without overwriting user settings.
pub async fn initialize_single_defaults(
    conn: &mut MySqlConnection,
    registry: &Registry,
    country_code: &str,
) -> Result<(), BackendError> {
    for schema in registry
        .schemas()
        .values()
        .filter(|schema| schema.is_single())
    {
        let rows = sqlx::query("SELECT `fieldname` FROM `singlevalue` WHERE `parent` = ?")
            .bind(&schema.name)
            .fetch_all(&mut *conn)
            .await
            .map_err(db_err)?;
        let existing: std::collections::HashSet<String> = rows
            .iter()
            .filter_map(|row| row.try_get::<String, _>("fieldname").ok())
            .collect();
        let mut missing = Map::new();
        for field in &schema.fields {
            if existing.contains(&field.fieldname) {
                continue;
            }
            let value = if schema.name == "SystemSettings" && field.fieldname == "countryCode" {
                Some(Value::String(country_code.to_string()))
            } else {
                field.default.clone()
            };
            if let Some(value) = value {
                missing.insert(field.fieldname.clone(), value);
            }
        }
        set_single_values(conn, &schema.name, &missing).await?;
    }
    Ok(())
}

/// `getSingleValues`: an OR of `(fieldname = ? [AND parent = ?])` groups.
///
/// Omitting `parent` matches every parent holding that fieldname.
pub async fn get_single_values(
    conn: &mut MySqlConnection,
    specs: &[(String, Option<String>)],
) -> Result<Vec<(String, String, Value)>, BackendError> {
    if specs.is_empty() {
        return Ok(Vec::new());
    }

    let mut groups = Vec::with_capacity(specs.len());
    let mut params = Vec::new();
    for (fieldname, parent) in specs {
        match parent {
            Some(p) => {
                groups.push("(`fieldname` = ? AND `parent` = ?)".to_string());
                params.push(Bind::Text(fieldname.clone()));
                params.push(Bind::Text(p.clone()));
            }
            None => {
                groups.push("(`fieldname` = ?)".to_string());
                params.push(Bind::Text(fieldname.clone()));
            }
        }
    }

    let sql = format!(
        "SELECT `fieldname`, `parent`, `value` FROM `singlevalue` WHERE {}",
        groups.join(" OR ")
    );
    let rows = match stmt!(&sql, &params).fetch_all(&mut *conn).await {
        Ok(rows) => rows,
        Err(e) => {
            let e = DbError::from(e);
            return if e.is_missing_table() {
                Ok(Vec::new())
            } else {
                Err(e.into())
            };
        }
    };

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let fieldname: String = r
            .try_get("fieldname")
            .map_err(|e| BackendError::from(DbError::from(e)))?;
        let parent: String = r
            .try_get("parent")
            .map_err(|e| BackendError::from(DbError::from(e)))?;
        let value: Option<Vec<u8>> = r
            .try_get("value")
            .map_err(|e| BackendError::from(DbError::from(e)))?;
        out.push((
            fieldname,
            parent,
            Value::String(
                value
                    .map(|b| String::from_utf8_lossy(&b).into_owned())
                    .unwrap_or_default(),
            ),
        ));
    }
    Ok(out)
}

/// Next autoincrement id. FOR UPDATE serialises concurrent readers; the probe gap-locks empty tables.
pub async fn next_autoincrement_id(
    conn: &mut MySqlConnection,
    schema_name: &str,
) -> Result<i64, BackendError> {
    let table = table_of(schema_name)?;
    // Best-effort, like core.ts: a missing table surfaces from the MAX below.
    let probe = format!("SELECT 1 FROM {table} LIMIT 1 FOR UPDATE");
    let _ = stmt!(&probe, &[] as &[Bind]).fetch_optional(&mut *conn).await;
    // CAST to SIGNED, not UNSIGNED: MariaDB returns an unsigned aggregate as
    // BIGINT UNSIGNED, which sqlx will not decode into `i64`.
    let sql = format!("SELECT MAX(CAST(`name` AS SIGNED)) FROM {table} FOR UPDATE");
    let max: Option<i64> = stmt!(&sql, &[] as &[Bind])
        .fetch_one(&mut *conn)
        .await
        .map_err(db_err)?
        .try_get(0)
        .map_err(|e| BackendError::from(DbError::from(e)))?;
    Ok(max.unwrap_or(0) + 1)
}

/// Next series value. The row is locked FOR UPDATE so concurrent callers serialise.
pub async fn next_series_value(
    conn: &mut MySqlConnection,
    prefix: &str,
    schema_name: &str,
) -> Result<i64, BackendError> {
    // Establish the row before reading it. SELECT ... FOR UPDATE cannot be
    // relied on to serialize two transactions that both observe an absent key;
    // both could otherwise choose the same initial number. The upsert takes
    // the unique-key lock, then the locked read observes the committed counter.
    sqlx::query(
        "INSERT INTO `numberseries` (`name`, `current`, `start`, `padZeros`) \
         VALUES (?, 0, 1, ?) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    )
    .bind(prefix)
    .bind(pad_default())
    .execute(&mut *conn)
    .await
    .map_err(db_err)?;

    let row = sqlx::query(
        "SELECT `current`, `start`, `padZeros` FROM `numberseries` \
         WHERE `name` = ? FOR UPDATE",
    )
    .bind(prefix)
        .fetch_optional(&mut *conn)
    .await
    .map_err(|e| BackendError::from(DbError::from(e)))?;

    let row = row.ok_or_else(|| {
        BackendError::Db(DbError::new(format!(
            "number series `{prefix}` disappeared after it was created"
        )))
    })?;
    let current: Option<i64> = row.try_get("current").map_err(db_err)?;
    let start: Option<i64> = row.try_get("start").map_err(db_err)?;
    let pad_zeros: Option<i32> = row.try_get("padZeros").map_err(db_err)?;
    let start = start.unwrap_or(1);
    let pad_zeros = pad_zeros.unwrap_or_else(pad_default);

    let pad_zeros = if pad_zeros > 0 { pad_zeros as usize } else { 4 };
    let start = start.max(0);
    let mut candidate = match current {
        Some(c) if c != 0 => c.checked_add(1).ok_or_else(|| {
            BackendError::InvalidArgument(format!(
                "number series `{prefix}` exhausted its integer range"
            ))
        })?,
        _ => start,
    };

    let table = table_of(schema_name)?;
    loop {
        let padded = format!("{prefix}{:0>width$}", candidate, width = pad_zeros);
        let exists = sqlx::query(&format!("SELECT 1 FROM {table} WHERE `name` = ? LIMIT 1"))
            .bind(&padded)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| BackendError::from(DbError::from(e)))?
            .is_some();
        if !exists {
            break;
        }
        candidate = candidate.checked_add(1).ok_or_else(|| {
            BackendError::InvalidArgument(format!(
                "number series `{prefix}` exhausted its integer range"
            ))
        })?;
    }

    sqlx::query("UPDATE `numberseries` SET `current` = ? WHERE `name` = ?")
        .bind(candidate)
        .bind(prefix)
        .execute(&mut *conn)
        .await
        .map_err(db_err)?;

    Ok(candidate)
}

fn pad_default() -> i32 {
    4
}

/// Columns as `INFORMATION_SCHEMA` reports them.
pub async fn existing_columns(
    conn: &mut MySqlConnection,
    schema_name: &str,
) -> Result<Vec<ddl::ExistingColumn>, BackendError> {
    let sql = "SELECT `COLUMN_NAME` AS name, `COLUMN_TYPE` AS column_type, \
                      `IS_NULLABLE` AS is_nullable, `COLUMN_DEFAULT` AS column_default \
               FROM INFORMATION_SCHEMA.COLUMNS \
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?";
    let rows = sqlx::query(sql)
        .bind(table_name(schema_name))
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| BackendError::from(DbError::from(e)))?;

    rows.iter()
        .map(|r| {
            Ok(ddl::ExistingColumn {
                name: r.try_get("name").unwrap_or_default(),
                column_type: r.try_get("column_type").unwrap_or_default(),
                nullable: r
                    .try_get::<Option<String>, _>("is_nullable")
                    .ok()
                    .flatten()
                    .map(|v| v.eq_ignore_ascii_case("YES"))
                    .unwrap_or(true),
                has_default: r
                    .try_get::<Option<Vec<u8>>, _>("column_default")
                    .ok()
                    .flatten()
                    .is_some(),
            })
        })
        .collect()
}

pub async fn table_exists(
    conn: &mut MySqlConnection,
    schema_name: &str,
) -> Result<bool, BackendError> {
    let found = sqlx::query(
        "SELECT 1 FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
    )
    .bind(table_name(schema_name))
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| BackendError::from(DbError::from(e)))?;
    Ok(found.is_some())
}

pub async fn index_exists(
    conn: &mut MySqlConnection,
    schema_name: &str,
    index_name: &str,
) -> Result<bool, BackendError> {
    let found = sqlx::query(
        "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
    )
    .bind(table_name(schema_name))
    .bind(index_name)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| BackendError::from(DbError::from(e)))?;
    Ok(found.is_some())
}

/// Link columns that already carry a foreign key.
pub async fn foreign_key_columns(
    conn: &mut MySqlConnection,
    schema_name: &str,
) -> Result<Vec<String>, BackendError> {
    let sql = "SELECT `COLUMN_NAME` FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE \
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? \
                 AND REFERENCED_TABLE_NAME IS NOT NULL";
    let rows = sqlx::query(sql)
        .bind(table_name(schema_name))
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| BackendError::from(DbError::from(e)))?;
    Ok(rows.iter().filter_map(|r| r.try_get(0).ok()).collect())
}

pub(crate) fn db_err(e: sqlx::Error) -> BackendError {
    DbError::from(e).into()
}
