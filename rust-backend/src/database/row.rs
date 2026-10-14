//! Row decoding: every column read as bytes, converted by declared field type in one place.

use serde_json::{Map, Value};
use sqlx::mysql::MySqlRow;
use sqlx::Column;
use sqlx::Row;

use crate::error::{BackendError, DbError};
use crate::types::{FieldType, Row as RowMap, Schema};

/// Decodes a row to the JSON the renderer converter expects; unknown columns decode as strings.
pub fn decode_row(row: &MySqlRow, schema: Option<&Schema>) -> Result<RowMap, BackendError> {
    let mut out = Map::with_capacity(row.columns().len());

    for (index, column) in row.columns().iter().enumerate() {
        let name = column.name();
        let field_type = schema
            .and_then(|s| s.field(name))
            .and_then(|f| f.field_type().ok());

        out.insert(
            name.to_string(),
            decode_column(row.try_get(index), field_type)?,
        );
    }

    Ok(out)
}

/// Keeps SQL NULL distinct from a driver decoding failure.
fn decode_column(
    result: Result<Option<Vec<u8>>, sqlx::Error>,
    field_type: Option<FieldType>,
) -> Result<Value, BackendError> {
    let bytes = result.map_err(|error| BackendError::from(DbError::from(error)))?;
    Ok(match bytes {
        Some(bytes) => decode_value(&bytes, field_type),
        None => Value::Null,
    })
}

/// Converts a raw column value using the schema's declared type.
pub fn decode_value(bytes: &[u8], field_type: Option<FieldType>) -> Value {
    let text = || String::from_utf8_lossy(bytes).into_owned();

    match field_type {
        Some(FieldType::Int) => text()
            .trim()
            .parse::<i64>()
            .map(Value::from)
            .unwrap_or_else(|_| Value::Null),
        Some(FieldType::Float) | Some(FieldType::Percent) => text()
            .trim()
            .parse::<f64>()
            .map(Value::from)
            .unwrap_or_else(|_| Value::Null),
        // Accept binary TINYINT bytes and their textual representation.
        Some(FieldType::Check) => match bytes.first() {
            Some(0) | Some(b'0') => Value::Bool(false),
            Some(1) | Some(b'1') => Value::Bool(true),
            _ => Value::Null,
        },
        Some(FieldType::Datetime) => Value::String(normalize_datetime(&text())),
        Some(FieldType::Date) | Some(FieldType::Time) => Value::String(text()),
        _ => Value::String(text()),
    }
}

/// Trims DATETIME(6) microseconds to the milliseconds the TypeScript converter produced.
fn normalize_datetime(raw: &str) -> String {
    let Some((head, fraction)) = raw.split_once('.') else {
        return raw.to_string();
    };
    let millis: String = fraction.chars().take(3).collect();
    format!("{head}.{millis}")
}

/// Renders a value for binding in its column type, so STRICT mode never sees a coerced string.
pub fn encode_value(value: &Value, field_type: Option<FieldType>) -> crate::database::query::Bind {
    use crate::database::query::Bind;

    match (field_type, value) {
        (_, Value::Null) => Bind::Null,
        (Some(FieldType::Int), Value::String(s)) => s
            .trim()
            .parse::<i64>()
            .map(Bind::Int)
            .unwrap_or_else(|_| Bind::Text(s.clone())),
        (Some(FieldType::Float | FieldType::Percent), Value::String(s)) => s
            .trim()
            .parse::<f64>()
            .map(Bind::Float)
            .unwrap_or_else(|_| Bind::Text(s.clone())),
        (Some(FieldType::Check), v) => Bind::Int(match v {
            Value::Bool(b) => *b as i64,
            Value::Number(n) => n.as_i64().unwrap_or(0),
            Value::String(s) => i64::from(!matches!(s.as_str(), "" | "0" | "false")),
            _ => 0,
        }),
        (_, v) => Bind::from(v),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sql_null_is_preserved_as_null() {
        assert_eq!(
            decode_column(Ok(None), Some(FieldType::Int)).unwrap(),
            Value::Null
        );
    }

    #[test]
    fn driver_decode_errors_are_not_rewritten_as_null() {
        let error = decode_column(
            Err(sqlx::Error::Protocol("synthetic decode failure".into())),
            Some(FieldType::Int),
        )
        .unwrap_err();

        assert!(error.to_string().contains("synthetic decode failure"));
    }

    #[test]
    fn integers_and_floats_decode_to_numbers() {
        assert_eq!(decode_value(b"42", Some(FieldType::Int)), Value::from(42));
        assert_eq!(decode_value(b"-7", Some(FieldType::Int)), Value::from(-7));
        assert_eq!(
            decode_value(b"1.5", Some(FieldType::Float)),
            Value::from(1.5)
        );
    }

    #[test]
    fn an_unparseable_number_is_null_not_zero() {
        assert_eq!(decode_value(b"abc", Some(FieldType::Int)), Value::Null);
    }

    #[test]
    fn checks_decode_to_booleans() {
        assert_eq!(
            decode_value(b"1", Some(FieldType::Check)),
            Value::Bool(true)
        );
        assert_eq!(
            decode_value(b"0", Some(FieldType::Check)),
            Value::Bool(false)
        );
        assert_eq!(decode_value(b"", Some(FieldType::Check)), Value::Null);
        assert_eq!(
            decode_value(&[1], Some(FieldType::Check)),
            Value::Bool(true)
        );
        assert_eq!(
            decode_value(&[0], Some(FieldType::Check)),
            Value::Bool(false)
        );
    }

    #[test]
    fn datetimes_lose_sub_millisecond_precision() {
        assert_eq!(
            decode_value(b"2026-10-12 07:34:56.123456", Some(FieldType::Datetime)),
            Value::String("2026-10-12 07:34:56.123".into())
        );
        assert_eq!(
            decode_value(b"2026-10-12 07:34:56", Some(FieldType::Datetime)),
            Value::String("2026-10-12 07:34:56".into())
        );
    }

    #[test]
    fn string_types_pass_through_unchanged() {
        let arabic = "شركة".as_bytes();
        assert_eq!(
            decode_value(arabic, Some(FieldType::Data)),
            Value::String("شركة".into())
        );
    }

    #[test]
    fn unknown_columns_decode_as_strings() {
        assert_eq!(
            decode_value(b"whatever", None),
            Value::String("whatever".into())
        );
    }

    #[test]
    fn encoding_is_guided_by_the_declared_type() {
        assert_eq!(
            encode_value(&Value::from("42"), Some(FieldType::Int)),
            crate::database::query::Bind::Int(42)
        );
        assert_eq!(
            encode_value(&Value::from("1.5"), Some(FieldType::Float)),
            crate::database::query::Bind::Float(1.5)
        );
        assert_eq!(
            encode_value(&Value::from("true"), Some(FieldType::Check)),
            crate::database::query::Bind::Int(1)
        );
        assert_eq!(
            encode_value(&Value::Null, Some(FieldType::Int)),
            crate::database::query::Bind::Null
        );
        // A Data column keeps its string form, even a numeric-looking one.
        assert_eq!(
            encode_value(&Value::from("42"), Some(FieldType::Data)),
            crate::database::query::Bind::Text("42".into())
        );
    }
}
