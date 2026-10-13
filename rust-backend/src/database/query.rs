//! Pure SQL construction: no pool, no connection, testable without a database.
//! Fixes three core.ts defects: raw identifier interpolation, GROUP BY after ORDER BY, uninterpolated operators.

use serde_json::Value;

use crate::error::BackendError;

/// A bound parameter, converted to a concrete type so sqlx never binds a number as JSON text.
#[derive(Debug, Clone, PartialEq)]
pub enum Bind {
    Null,
    Int(i64),
    Float(f64),
    Text(String),
}

impl From<&Value> for Bind {
    fn from(v: &Value) -> Self {
        match v {
            Value::Null => Bind::Null,
            Value::Bool(b) => Bind::Int(*b as i64),
            Value::Number(n) => n
                .as_i64()
                .map(Bind::Int)
                .or_else(|| n.as_f64().map(Bind::Float))
                // A number too large for i64 or f64 keeps its text form.
                .unwrap_or_else(|| Bind::Text(n.to_string())),
            Value::String(s) => Bind::Text(s.clone()),
            other => Bind::Text(other.to_string()),
        }
    }
}

impl From<String> for Bind {
    fn from(s: String) -> Self {
        Bind::Text(s)
    }
}

impl From<&str> for Bind {
    fn from(s: &str) -> Self {
        Bind::Text(s.to_string())
    }
}

/// The complete set of comparison operators the renderer may request. Anything
/// outside this set is rejected before it reaches the SQL string.
///
/// Same list as `ALLOWED_OPERATORS` in `core.ts:57`, plus the `includes`
/// convenience alias that `#getFiltersArray` rewrites to `like`.
const ALLOWED_OPERATORS: &[&str] = &[
    "=", "!=", "<>", "<", "<=", ">", ">=", "like", "not like", "in", "not in", "is", "is not",
];

fn is_allowed_operator(op: &str) -> bool {
    ALLOWED_OPERATORS.contains(&op)
}

/// Rejects non-plain identifiers; schema and field names here are ASCII, so nothing legitimate is lost.
pub fn check_identifier(name: &str) -> Result<&str, BackendError> {
    if name.is_empty() {
        return Err(BackendError::InvalidIdentifier("empty identifier".into()));
    }
    if name.len() > 64 {
        return Err(BackendError::InvalidIdentifier(format!(
            "identifier longer than 64 characters: {name}"
        )));
    }
    if let Some(bad) = name
        .chars()
        .find(|c| !(c.is_ascii_alphanumeric() || *c == '_' || *c == '$'))
    {
        return Err(BackendError::InvalidIdentifier(format!(
            "identifier contains disallowed character {bad:?}: {name}"
        )));
    }
    Ok(name)
}

/// Backtick-quotes an identifier; doubling backticks keeps it safe on its own.
pub fn ident(name: &str) -> Result<String, BackendError> {
    check_identifier(name)?;
    Ok(format!("`{}`", name.replace('`', "``")))
}

/// Quotes a list of identifiers, or `*` when the list is exactly `["*"]`.
pub fn ident_list(names: &[String]) -> Result<String, BackendError> {
    if names.len() == 1 && names[0] == "*" {
        return Ok("*".to_string());
    }
    names
        .iter()
        .map(|n| ident(n))
        .collect::<Result<Vec<_>, _>>()
        .map(|v| v.join(", "))
}

/// A built statement: SQL text plus its bound parameters, in order.
#[derive(Debug, Clone, PartialEq)]
pub struct Statement {
    pub sql: String,
    pub params: Vec<Bind>,
}

impl Statement {
    pub fn new(sql: impl Into<String>, params: Vec<Bind>) -> Self {
        Self {
            sql: sql.into(),
            params,
        }
    }
}

/// One resolved `field <op> value` comparison.
struct Condition {
    field: String,
    operator: String,
    value: Value,
}

impl Condition {
    /// Emits one comparison, expanding in/not-in arrays; empty in matches nothing, empty not-in matches all.
    fn push(&self, sql: &mut String, params: &mut Vec<Bind>) -> Result<(), BackendError> {
        let column = ident(&self.field)?;

        let is_list_operator = self.operator == "in" || self.operator == "not in";
        if is_list_operator {
            match &self.value {
                Value::Array(items) if items.is_empty() => {
                    sql.push_str(if self.operator == "in" {
                        "1 = 0"
                    } else {
                        "1 = 1"
                    });
                    return Ok(());
                }
                Value::Array(items) => {
                    let holes = vec!["?"; items.len()].join(", ");
                    sql.push_str(&format!("{column} {} ({holes})", self.operator));
                    params.extend(items.iter().map(Bind::from));
                    return Ok(());
                }
                _ => {}
            }
        }

        sql.push_str(&format!("{column} {} ?", self.operator));
        params.push(Bind::from(&self.value));
        Ok(())
    }
}

/// Turns a renderer filter map into conditions like core.ts #getFiltersArray.
/// Unknown operators and third pairs are rejected instead of silently dropped.
pub fn conditions(
    filters: &serde_json::Map<String, Value>,
) -> Result<Vec<Condition>, BackendError> {
    let mut out = Vec::new();

    for (field, value) in filters {
        let pairs: Vec<(&Value, &Value)> = match value {
            Value::Array(items) if items.len() >= 2 && items[0].is_string() => items
                .chunks(2)
                .filter(|c| c.len() == 2)
                .map(|c| (&c[0], &c[1]))
                .collect(),
            _ => vec![(&Value::from("="), value)],
        };

        if let Value::Array(items) = value {
            if items.len() > 4 {
                return Err(BackendError::InvalidArgument(format!(
                    "filter on `{field}` has {} operands; at most two conditions are supported",
                    items.len()
                )));
            }
            if items.len() == 2 && !items[0].is_string() {
                return Err(BackendError::InvalidArgument(format!(
                    "filter on `{field}` must start with an operator string"
                )));
            }
            if items.len() == 3 {
                return Err(BackendError::InvalidArgument(format!(
                    "filter on `{field}` has an operator with no value"
                )));
            }
        }

        for (op_value, operand) in pairs {
            let mut operator = op_value
                .as_str()
                .ok_or_else(|| {
                    BackendError::InvalidArgument(format!(
                        "filter on `{field}`: operator must be a string"
                    ))
                })?
                .trim()
                .to_lowercase();
            if operator == "includes" {
                operator = "like".to_string();
            }

            if !is_allowed_operator(&operator) {
                return Err(BackendError::InvalidArgument(format!(
                    "Unsupported SQL operator: {operator}"
                )));
            }

            let mut operand = operand.clone();
            if operator == "like" && !matches!(operand, Value::Array(_)) {
                if let Value::String(s) = &operand {
                    if !s.contains('%') {
                        operand = Value::String(format!("%{s}%"));
                    }
                }
            }

            check_identifier(field)?;
            out.push(Condition {
                field: field.clone(),
                operator,
                value: operand,
            });
        }
    }

    Ok(out)
}

/// Builds a `WHERE` clause. Returns an empty string when there are no
/// conditions, in which case `params` is untouched.
pub fn where_clause(
    filters: &serde_json::Map<String, Value>,
    params: &mut Vec<Bind>,
) -> Result<String, BackendError> {
    let conds = conditions(filters)?;
    if conds.is_empty() {
        return Ok(String::new());
    }

    let mut parts = Vec::with_capacity(conds.len());
    for cond in &conds {
        let mut piece = String::new();
        cond.push(&mut piece, params)?;
        parts.push(piece);
    }
    Ok(format!(" WHERE {}", parts.join(" AND ")))
}

/// Normalises order to ASC or DESC. Only the two documented values are accepted; typos fail loudly.
pub fn order_direction(order: Option<&str>) -> Result<&'static str, BackendError> {
    match order.map(str::trim) {
        None | Some("") | Some("asc") | Some("ASC") => Ok("ASC"),
        Some("desc") | Some("DESC") => Ok("DESC"),
        Some(other) => Err(BackendError::InvalidArgument(format!(
            "order must be 'asc' or 'desc', got {other:?}"
        ))),
    }
}

fn push_order_by(sql: &mut String, order_by: &[String], order: &str) -> Result<(), BackendError> {
    if order_by.is_empty() {
        return Ok(());
    }
    let cols = order_by
        .iter()
        .map(|c| ident(c))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    sql.push_str(&format!(" ORDER BY {cols} {order}"));
    Ok(())
}

fn push_group_by(sql: &mut String, group_by: &[String]) -> Result<(), BackendError> {
    if group_by.is_empty() {
        return Ok(());
    }
    let cols = group_by
        .iter()
        .map(|c| ident(c))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    sql.push_str(&format!(" GROUP BY {cols}"));
    Ok(())
}

/// LIMIT/OFFSET. MariaDB rejects bare OFFSET, so an offset without limit uses u32::MAX.
fn push_limit(sql: &mut String, params: &mut Vec<Bind>, limit: Option<u32>, offset: Option<u32>) {
    match (limit, offset.filter(|o| *o > 0)) {
        (Some(l), Some(o)) => {
            sql.push_str(" LIMIT ? OFFSET ?");
            params.push(Bind::Int(l as i64));
            params.push(Bind::Int(o as i64));
        }
        (Some(l), None) => {
            sql.push_str(" LIMIT ?");
            params.push(Bind::Int(l as i64));
        }
        (None, Some(o)) => {
            sql.push_str(" LIMIT ? OFFSET ?");
            params.push(Bind::Int(u32::MAX as i64));
            params.push(Bind::Int(o as i64));
        }
        (None, None) => {}
    }
}

/// Assembles `SELECT ... FROM ... WHERE ... GROUP BY ... ORDER BY ... LIMIT`.
#[allow(clippy::too_many_arguments)]
pub fn build_select(
    table: &str,
    fields: &[String],
    filters: &serde_json::Map<String, Value>,
    group_by: &[String],
    order_by: &[String],
    order: Option<&str>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Statement, BackendError> {
    let mut params = Vec::new();
    let mut sql = format!("SELECT {} FROM {}", ident_list(fields)?, ident(table)?);
    sql.push_str(&where_clause(filters, &mut params)?);
    push_group_by(&mut sql, group_by)?;
    push_order_by(&mut sql, order_by, order_direction(order)?)?;
    push_limit(&mut sql, &mut params, limit, offset);
    Ok(Statement::new(sql, params))
}

/// `SELECT COUNT(*) ... WHERE ...`. Only filters apply; paging and ordering are
/// meaningless for a count.
pub fn build_count(
    table: &str,
    filters: &serde_json::Map<String, Value>,
) -> Result<Statement, BackendError> {
    let mut params = Vec::new();
    let where_sql = where_clause(filters, &mut params)?;
    Ok(Statement::new(
        format!("SELECT COUNT(*) FROM {}{where_sql}", ident(table)?),
        params,
    ))
}

/// DELETE with a mandatory filter; refuses to wipe a table.
/// No child cleanup (ON DELETE RESTRICT): callers delete children first.
pub fn build_delete(
    table: &str,
    filters: &serde_json::Map<String, Value>,
) -> Result<Statement, BackendError> {
    if filters.is_empty() {
        return Err(BackendError::InvalidArgument(
            "deleteAll requires a filter; refusing to delete every row".into(),
        ));
    }
    let mut params = Vec::new();
    let where_sql = where_clause(filters, &mut params)?;
    Ok(Statement::new(
        format!("DELETE FROM {}{where_sql}", ident(table)?),
        params,
    ))
}

/// `UPDATE ... SET ... WHERE name = ?`.
pub fn build_update_by_name(
    table: &str,
    assignments: &[String],
    name: &str,
) -> Result<Statement, BackendError> {
    if assignments.is_empty() {
        return Err(BackendError::InvalidArgument(
            "update requires at least one column".into(),
        ));
    }
    let mut params = Vec::new();
    let set = assignments
        .iter()
        .map(|c| format!("{} = ?", ident(c)?))
        .collect::<Result<Vec<_>, BackendError>>()?
        .join(", ");
    params.push(Bind::Text(name.to_string()));
    Ok(Statement::new(
        format!(
            "UPDATE {} SET {set} WHERE {}",
            ident(table)?,
            ident("name")?
        ),
        params,
    ))
}

/// `SELECT <cols> FROM <table> WHERE name = ?`.
pub fn build_select_by_name(
    table: &str,
    fields: &[String],
    name: &str,
) -> Result<Statement, BackendError> {
    let mut sql = format!("SELECT {} FROM {}", ident_list(fields)?, ident(table)?);
    sql.push_str(&format!(" WHERE {} = ?", ident("name")?));
    Ok(Statement::new(sql, vec![Bind::Text(name.to_string())]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn filters(v: serde_json::Value) -> serde_json::Map<String, Value> {
        v.as_object().cloned().unwrap()
    }

    #[test]
    fn rejects_identifiers_that_are_not_plain() {
        for bad in [
            "",
            "a b",
            "a`b",
            "a;b",
            "a.b",
            "a-b",
            "tab\there",
            &"x".repeat(65),
        ] {
            assert!(
                ident(bad).is_err(),
                "expected {bad:?} to be rejected as an identifier"
            );
        }
        for good in [
            "name",
            "SalesInvoiceItem",
            "created",
            "modified",
            "_x",
            "a$b",
        ] {
            assert!(ident(good).is_ok(), "expected {good:?} to be accepted");
        }
    }

    #[test]
    fn a_backtick_in_a_renderer_field_cannot_escape_the_identifier() {
        // `core.ts` interpolates `fields` straight into the statement with only
        // backtick wrapping and the pool allows multiple statements.
        let err = build_select(
            "item",
            &["name) ; DROP TABLE item; --".to_string()],
            &serde_json::Map::new(),
            &[],
            &[],
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(matches!(err, BackendError::InvalidIdentifier(_)));
    }

    #[test]
    fn a_backtick_in_a_filter_key_is_rejected() {
        let err =
            where_clause(&filters(json!({ "name` OR 1=1 --": "x" })), &mut Vec::new()).unwrap_err();
        assert!(matches!(err, BackendError::InvalidIdentifier(_)));
    }

    #[test]
    fn scalar_filter_becomes_equality() {
        let mut params = Vec::new();
        let sql = where_clause(&filters(json!({ "party": "CUST-1" })), &mut params).unwrap();
        assert_eq!(sql, " WHERE `party` = ?");
        assert_eq!(params, vec![Bind::Text("CUST-1".into())]);
    }

    #[test]
    fn includes_becomes_a_wrapped_like() {
        let mut params = Vec::new();
        let sql = where_clause(
            &filters(json!({ "name": ["includes", "acme"] })),
            &mut params,
        )
        .unwrap();
        assert_eq!(sql, " WHERE `name` LIKE ?");
        assert_eq!(params, vec![Bind::Text("%acme%".into())]);
    }

    #[test]
    fn an_explicit_wildcard_is_left_alone() {
        let mut params = Vec::new();
        where_clause(&filters(json!({ "name": ["like", "acme%"] })), &mut params).unwrap();
        assert_eq!(params, vec![Bind::Text("acme%".into())]);
    }

    #[test]
    fn unknown_operators_are_rejected() {
        for bad in [
            json!({ "name": ["Includes!", "x"] }),
            json!({ "name": ["union", "x"] }),
            json!({ "name": ["is not ", "x"] }),
        ] {
            assert!(
                where_clause(&filters(bad.clone()), &mut Vec::new()).is_err(),
                "expected {bad} to be rejected"
            );
        }
    }

    #[test]
    fn in_expands_to_one_placeholder_per_element() {
        let mut params = Vec::new();
        let sql = where_clause(
            &filters(json!({ "company": ["in", ["a", "b", "c"]] })),
            &mut params,
        )
        .unwrap();
        assert_eq!(sql, " WHERE `company` IN (?, ?, ?)");
        assert_eq!(
            params,
            vec![
                Bind::Text("a".into()),
                Bind::Text("b".into()),
                Bind::Text("c".into())
            ]
        );
    }

    #[test]
    fn empty_in_and_not_in_have_sane_meanings() {
        let mut params = Vec::new();
        let sql = where_clause(&filters(json!({ "c": ["in", []] })), &mut params).unwrap();
        assert_eq!(sql, " WHERE 1 = 0", "empty IN must match nothing");

        let mut params = Vec::new();
        let sql = where_clause(&filters(json!({ "c": ["not in", []] })), &mut params).unwrap();
        assert_eq!(sql, " WHERE 1 = 1", "empty NOT IN must match everything");
        assert!(params.is_empty());
    }

    #[test]
    fn two_conditions_on_one_field_are_anded() {
        let mut params = Vec::new();
        let sql = where_clause(
            &filters(json!({ "amount": [">=", 10, "<=", 100] })),
            &mut params,
        )
        .unwrap();
        assert_eq!(sql, " WHERE `amount` >= ? AND `amount` <= ?");
        assert_eq!(params, vec![Bind::Int(10), Bind::Int(100)]);
    }

    #[test]
    fn a_third_condition_is_rejected_rather_than_dropped() {
        let err = where_clause(
            &filters(json!({ "a": [">", 1, "<", 5, "=", 3] })),
            &mut Vec::new(),
        )
        .unwrap_err();
        assert!(err.to_string().contains("at most two"));
    }

    #[test]
    fn clause_order_is_select_where_group_order_limit() {
        let stmt = build_select(
            "salesinvoice",
            &["name".into()],
            &filters(json!({ "submitted": [1] })),
            &["company".into()],
            &["created".into()],
            Some("desc"),
            Some(10),
            Some(20),
        )
        .unwrap();

        assert_eq!(
            stmt.sql,
            "SELECT `name` FROM `salesinvoice` \
             WHERE `submitted` = ? GROUP BY `company` ORDER BY `created` DESC LIMIT ? OFFSET ?"
        );
        assert_eq!(stmt.params.len(), 3);
    }

    #[test]
    fn group_by_precedes_order_by() {
        // `core.ts` emits ORDER BY then GROUP BY, which reverses the meaning of
        // any grouped query.
        let stmt = build_select(
            "t",
            &["*".into()],
            &serde_json::Map::new(),
            &["g".into()],
            &["o".into()],
            Some("asc"),
            None,
            None,
        )
        .unwrap();
        let gi = stmt.sql.find("GROUP BY").unwrap();
        let oi = stmt.sql.find("ORDER BY").unwrap();
        assert!(gi < oi, "GROUP BY must come before ORDER BY: {}", stmt.sql);
    }

    #[test]
    fn offset_without_limit_uses_the_maximum_limit() {
        let stmt = build_select(
            "t",
            &["*".into()],
            &serde_json::Map::new(),
            &[],
            &[],
            None,
            None,
            Some(5),
        )
        .unwrap();
        assert!(stmt.sql.ends_with("LIMIT ? OFFSET ?"));
        assert_eq!(stmt.params, vec![Bind::Int(u32::MAX as i64), Bind::Int(5)]);
    }

    #[test]
    fn a_zero_offset_is_not_an_offset() {
        let stmt = build_select(
            "t",
            &["*".into()],
            &serde_json::Map::new(),
            &[],
            &[],
            None,
            Some(7),
            Some(0),
        )
        .unwrap();
        assert_eq!(stmt.sql, "SELECT * FROM `t` LIMIT ?");
    }

    #[test]
    fn star_passes_through_unquoted() {
        let stmt = build_select(
            "t",
            &["*".into()],
            &serde_json::Map::new(),
            &[],
            &[],
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(stmt.sql, "SELECT * FROM `t`");
    }

    #[test]
    fn order_must_be_asc_or_desc() {
        assert!(order_direction(Some("descending")).is_err());
        assert!(order_direction(Some("ASC")).is_ok());
        assert_eq!(order_direction(None).unwrap(), "ASC");
    }

    #[test]
    fn delete_all_refuses_an_unfiltered_statement() {
        let err = build_delete("t", &serde_json::Map::new()).unwrap_err();
        assert!(err.to_string().contains("refusing to delete every row"));
        assert!(build_delete("t", &filters(json!({ "name": "x" }))).is_ok());
    }

    #[test]
    fn null_filters_bind_as_null() {
        let mut params = Vec::new();
        let sql = where_clause(&filters(json!({ "party": null })), &mut params).unwrap();
        assert_eq!(sql, " WHERE `party` = ?");
        assert_eq!(params, vec![Bind::Null]);
    }

    #[test]
    fn booleans_and_numbers_bind_with_their_own_types() {
        assert_eq!(Bind::from(&json!(true)), Bind::Int(1));
        assert_eq!(Bind::from(&json!(false)), Bind::Int(0));
        assert_eq!(Bind::from(&json!(7)), Bind::Int(7));
        assert_eq!(Bind::from(&json!(1.5)), Bind::Float(1.5));
        assert_eq!(Bind::from(&json!("s")), Bind::Text("s".into()));
    }
}
