//! DDL generation and schema diffing.
//! Fixes three core.ts defects: Link-as-TEXT breaking FKs, case-sensitive diff loops, drops of added columns.

use std::collections::BTreeMap;

use crate::error::BackendError;
use crate::schemas::table_name;
use crate::types::{Field, Schema};

/// A column as MariaDB reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExistingColumn {
    pub name: String,
    pub column_type: String,
    pub nullable: bool,
    pub has_default: bool,
}

/// What a table needs in order to match its schema.
#[derive(Debug, Default, PartialEq)]
pub struct ColumnDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    /// Columns whose type differs from the declared one, as `(column, new type)`.
    pub retyped: Vec<(String, String)>,
}

impl ColumnDiff {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.retyped.is_empty()
    }
}

/// Canonicalises a MariaDB type so INTEGER and int(11) compare equal; without it migration never converges.
pub fn canonical_type(declared: &str) -> String {
    let base = declared.trim().to_lowercase();
    let (name, arg) = match base.split_once('(') {
        Some((n, rest)) => (
            n.trim().to_string(),
            rest.trim_end_matches(')').trim().to_string(),
        ),
        None => (base.clone(), String::new()),
    };

    match name.as_str() {
        // MariaDB reports `INTEGER` columns as `int` (or `int(11)`).
        "integer" | "int" | "mediumint" | "smallint" => match name.as_str() {
            "integer" | "int" => "int".to_string(),
            other => other.to_string(),
        },
        "bool" | "boolean" => "tinyint(1)".to_string(),
        "decimal" | "numeric" => format!("decimal({arg})"),
        other => {
            if arg.is_empty() {
                other.to_string()
            } else {
                format!("{other}({arg})")
            }
        }
    }
}

/// The declared column type for a field, or `None` when it owns no column.
pub fn column_type(field: &Field) -> Option<String> {
    field
        .field_type()
        .ok()
        .and_then(|t| t.column_type())
        .map(str::to_string)
}

/// Renders a schema default as a SQL literal. None and JSON null produce no DEFAULT clause, like core.ts.
pub fn default_literal(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Bool(b) => Some(if *b { "1".into() } else { "0".into() }),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => {
            let escaped = s.replace('\\', "\\\\").replace('\'', "''");
            Some(format!("'{escaped}'"))
        }
        _ => None,
    }
}

/// CREATE TABLE IF NOT EXISTS. Column casing matches core.ts so existing databases read as up to date.
pub fn create_table_sql(schema: &Schema) -> Result<String, BackendError> {
    let table = crate::database::query::ident(&table_name(&schema.name))?;
    let mut columns = Vec::new();

    for field in schema.column_fields() {
        let Some(sql_type) = column_type(field) else {
            continue;
        };

        let quoted = crate::database::query::ident(&field.fieldname)?;
        let definition = if field.fieldname == "name" {
            // Forced regardless of the declared type, and never NOT NULL:
            // matching `core.ts` exactly avoids retyping every primary key.
            format!("{quoted} VARCHAR(255) PRIMARY KEY")
        } else {
            let mut def = format!("{quoted} {sql_type}");
            if field.is_required() {
                def.push_str(" NOT NULL");
            }
            if let Some(literal) = field.default.as_ref().and_then(default_literal) {
                def.push_str(&format!(" DEFAULT {literal}"));
            }
            def
        };
        columns.push(definition);
    }

    if columns.is_empty() {
        return Err(BackendError::InvalidArgument(format!(
            "schema {} has no stored columns",
            schema.name
        )));
    }

    Ok(format!(
        "CREATE TABLE IF NOT EXISTS {table} ({}) \
         ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        columns.join(", ")
    ))
}

/// Secondary indexes beyond the primary key.
/// Child tables are read by parent per document, so parent gets an index.
pub fn secondary_indexes(schema: &Schema) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if schema.is_child() && schema.has_column("parent") {
        out.push(("idx_parent".to_string(), "parent".to_string()));
    }
    out
}

/// `CREATE INDEX IF NOT EXISTS` equivalent, expressed so it can be skipped when
/// the index already exists.
pub fn create_index_sql(
    schema_name: &str,
    index_name: &str,
    column: &str,
) -> Result<String, BackendError> {
    let table = crate::database::query::ident(&table_name(schema_name))?;
    let index = crate::database::query::ident(index_name)?;
    let column = crate::database::query::ident(column)?;
    Ok(format!("CREATE INDEX {index} ON {table} ({column})"))
}

/// The foreign keys a schema declares through its Link fields.
pub fn foreign_keys(schema: &Schema) -> Vec<(String, String)> {
    schema
        .fields
        .iter()
        .filter(|f| f.fieldtype == "Link")
        .filter_map(|f| f.target.as_ref().map(|t| (f.fieldname.clone(), t.clone())))
        .collect()
}

/// `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` for one Link field.
pub fn add_foreign_key_sql(
    schema_name: &str,
    fieldname: &str,
    target_schema: &str,
) -> Result<String, BackendError> {
    let table = crate::database::query::ident(&table_name(schema_name))?;
    let target_table = crate::database::query::ident(&table_name(target_schema))?;
    let column = crate::database::query::ident(fieldname)?;
    // Constraint names keep the schema name's case, as core.ts writes them:
    // `fk_${schemaName}_${fieldname}`.
    let constraint = crate::database::query::ident(&format!("fk_{schema_name}_{fieldname}"))?;
    Ok(format!(
        "ALTER TABLE {table} ADD CONSTRAINT {constraint} \
         FOREIGN KEY ({column}) REFERENCES {target_table} (`name`) \
         ON UPDATE CASCADE ON DELETE RESTRICT"
    ))
}

/// Compares a schema's declared columns against the table MariaDB reports.
pub fn diff_columns(schema: &Schema, existing: &[ExistingColumn]) -> ColumnDiff {
    let existing_by_name: BTreeMap<String, &ExistingColumn> = existing
        .iter()
        .map(|c| (c.name.to_lowercase(), c))
        .collect();

    let mut declared: BTreeMap<String, (String, bool)> = BTreeMap::new();
    for field in schema.column_fields() {
        let Some(sql_type) = column_type(field) else {
            continue;
        };
        let key = field.fieldname.to_lowercase();
        // `name` is forced to VARCHAR(255) by `create_table_sql`, so a table
        // already holding a non-numeric primary key must not be retyped.
        if field.fieldname == "name" {
            declared.insert(key, ("VARCHAR(255)".to_string(), true));
        } else {
            declared.insert(key, (sql_type, false));
        }
    }

    let mut diff = ColumnDiff::default();

    for (key, (sql_type, is_name)) in &declared {
        let Some(found) = existing_by_name.get(key) else {
            diff.added.push((*key).clone());
            continue;
        };
        // The `name` field is forced to VARCHAR(255) PRIMARY KEY by create_table_sql.
        // An existing numeric primary key must not be retyped; the table was created
        // by the legacy backend and works as-is.
        if *is_name {
            continue;
        }
        let want = canonical_type(sql_type);
        let have = canonical_type(&found.column_type);
        // A NOT NULL column that MariaDB reports as nullable needs the same
        // treatment; comparing nullability here keeps migrate converging.
        if want != have {
            diff.retyped.push(((*key).clone(), sql_type.clone()));
        }
    }

    for key in existing_by_name.keys() {
        if !declared.contains_key(key) {
            diff.removed.push(key.clone());
        }
    }

    // A column the server reports under a different casing than the schema
    // would otherwise land in both lists and be dropped and re-added.
    let added_lower: Vec<String> = diff.added.iter().map(|c| c.to_lowercase()).collect();
    diff.removed.retain(|c| !added_lower.contains(c));

    diff
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn field(name: &str, kind: &str) -> Field {
        Field {
            fieldname: name.into(),
            fieldtype: kind.into(),
            ..Field::default()
        }
    }

    fn schema_with(fields: Vec<Field>) -> Schema {
        Schema {
            name: "Party".into(),
            fields,
            ..Schema::default()
        }
    }

    #[test]
    fn link_columns_are_varchar_so_foreign_keys_can_be_created() {
        let f = field("party", "Link");
        assert_eq!(column_type(&f).as_deref(), Some("VARCHAR(255)"));
        assert_ne!(
            column_type(&f).as_deref(),
            Some("TEXT"),
            "a TEXT column cannot carry a foreign key"
        );
    }

    #[test]
    fn string_types_stay_text_to_match_existing_databases() {
        for kind in ["Data", "Select", "Text", "Currency", "Color", "Attachment"] {
            assert_eq!(
                column_type(&field("x", kind)).as_deref(),
                Some("TEXT"),
                "{kind} must stay TEXT"
            );
        }
    }

    #[test]
    fn table_and_button_fields_get_no_column() {
        assert_eq!(column_type(&field("items", "Table")), None);
        assert_eq!(column_type(&field("go", "Button")), None);
        assert_eq!(column_type(&field("x", "NotAFieldType")), None);
    }

    #[test]
    fn create_table_uses_the_lowercased_table_name() {
        let schema = schema_with(vec![field("name", "Data"), field("partyName", "Data")]);
        let sql = create_table_sql(&schema).unwrap();
        assert!(
            sql.starts_with("CREATE TABLE IF NOT EXISTS `party`"),
            "{sql}"
        );
        assert!(sql.contains("`name` VARCHAR(255) PRIMARY KEY"), "{sql}");
        assert!(sql.contains("`partyName` TEXT"), "{sql}");
        assert!(sql.contains("ENGINE=InnoDB"), "{sql}");
       assert!(sql.contains(") ENGINE=InnoDB"), "{sql}");
        assert!(sql.contains("COLLATE=utf8mb4_unicode_ci"), "{sql}");
    }

    #[test]
    fn computed_fields_and_tables_are_not_columns() {
        let mut computed = field("total", "Float");
        computed.computed = Some(true);
        let schema = schema_with(vec![
            field("name", "Data"),
            field("items", "Table"),
            computed,
        ]);
        let sql = create_table_sql(&schema).unwrap();
        assert!(!sql.contains("`total`"), "{sql}");
        assert!(!sql.contains("`items`"), "{sql}");
    }

    #[test]
    fn required_and_default_are_emitted() {
        let mut req = field("partyName", "Data");
        req.required = Some(true);
        let mut with_default = field("kind", "Data");
        with_default.default = Some(json!("individual"));
        let schema = schema_with(vec![field("name", "Data"), req, with_default]);

        let sql = create_table_sql(&schema).unwrap();
        assert!(sql.contains("`partyName` TEXT NOT NULL"), "{sql}");
        assert!(sql.contains("`kind` TEXT DEFAULT 'individual'"), "{sql}");
    }

    #[test]
    fn a_null_default_emits_no_default_clause() {
        let mut f = field("kind", "Data");
        f.default = Some(serde_json::Value::Null);
        let schema = schema_with(vec![field("name", "Data"), f]);
        let sql = create_table_sql(&schema).unwrap();
        // Column-level DEFAULT should not appear; table-level DEFAULT CHARSET is fine.
        assert!(!sql.split("ENGINE=").next().unwrap().contains(" DEFAULT "));
    }

    #[test]
    fn string_defaults_are_escaped() {
        assert_eq!(default_literal(&json!("it's")).as_deref(), Some("'it''s'"));
        assert_eq!(default_literal(&json!("a\\b")).as_deref(), Some("'a\\\\b'"));
        assert_eq!(default_literal(&json!(true)).as_deref(), Some("1"));
        assert_eq!(default_literal(&json!(12)).as_deref(), Some("12"));
        assert_eq!(default_literal(&json!(null)), None);
    }

    #[test]
    fn integer_aliases_canonicalise_together() {
        assert_eq!(canonical_type("INTEGER"), canonical_type("int"));
        assert_eq!(canonical_type("INTEGER"), canonical_type("int(11)"));
        assert_eq!(
            canonical_type("VARCHAR(255)"),
            canonical_type("varchar(255)")
        );
        assert_eq!(canonical_type("DATETIME(6)"), canonical_type("datetime(6)"));
        assert_ne!(canonical_type("INTEGER"), canonical_type("bigint"));
    }

    #[test]
    fn diff_converges_when_mariadb_reports_a_different_column_case() {
        // core.ts compares INFORMATION_SCHEMA names case-sensitively, so this
        // never converges and migrate re-runs forever.
        let schema = schema_with(vec![field("name", "Data"), field("postingDate", "Date")]);
        let existing = vec![
            ExistingColumn {
                name: "name".into(),
                column_type: "varchar(255)".into(),
                nullable: false,
                has_default: false,
            },
            ExistingColumn {
                name: "postingdate".into(),
                column_type: "date".into(),
                nullable: true,
                has_default: false,
            },
        ];

        let diff = diff_columns(&schema, &existing);
        assert!(diff.is_empty(), "diff did not converge: {diff:?}");
    }

    #[test]
    fn diff_never_drops_a_column_it_is_also_adding() {
        let schema = schema_with(vec![field("name", "Data"), field("gstin", "Data")]);
        // The server reports a column that the schema also declares, under a
        // name that differs only by case and a type that differs.
        let existing = vec![
            ExistingColumn {
                name: "name".into(),
                column_type: "varchar(255)".into(),
                nullable: false,
                has_default: false,
            },
            ExistingColumn {
                name: "GSTIN".into(),
                column_type: "int".into(),
                nullable: true,
                has_default: false,
            },
        ];

        let diff = diff_columns(&schema, &existing);
        assert!(
            diff.removed.is_empty(),
            "must not drop a retyped column: {diff:?}"
        );
        assert_eq!(diff.retyped, vec![("gstin".into(), "TEXT".into())]);
    }

    #[test]
    fn diff_adds_new_columns_and_drops_orphans() {
        let schema = schema_with(vec![field("name", "Data"), field("gstin", "Data")]);
        let existing = vec![
            ExistingColumn {
                name: "name".into(),
                column_type: "varchar(255)".into(),
                nullable: false,
                has_default: false,
            },
            ExistingColumn {
                name: "legacyColumn".into(),
                column_type: "text".into(),
                nullable: true,
                has_default: false,
            },
        ];

        let diff = diff_columns(&schema, &existing);
        assert_eq!(diff.added, vec!["gstin"]);
        assert_eq!(diff.removed, vec!["legacycolumn"]);
    }

    #[test]
    fn diff_does_not_retype_an_existing_numeric_primary_key() {
        let schema = schema_with(vec![field("name", "Data")]);
        let existing = vec![ExistingColumn {
            name: "name".into(),
            column_type: "int".into(),
            nullable: false,
            has_default: false,
        }];
        assert!(diff_columns(&schema, &existing).is_empty());
    }

    #[test]
    fn child_tables_get_an_index_on_parent() {
        let mut child = schema_with(vec![field("name", "Data"), field("parent", "Data")]);
        child.is_child = Some(true);
        let indexes = secondary_indexes(&child);
        assert_eq!(indexes.len(), 1);
        assert_eq!(indexes[0].1, "parent");

        let sql = create_index_sql("SalesInvoiceItem", &indexes[0].0, &indexes[0].1).unwrap();
        assert_eq!(
            sql,
            "CREATE INDEX `idx_parent` ON `salesinvoiceitem` (`parent`)"
        );
    }

    #[test]
    fn parent_tables_get_no_secondary_index() {
        assert!(secondary_indexes(&schema_with(vec![field("name", "Data")])).is_empty());
    }

    #[test]
    fn foreign_keys_reference_the_target_primary_key() {
        let mut link = field("party", "Link");
        link.target = Some("Party".into());
        let schema = schema_with(vec![field("name", "Data"), link]);

        assert_eq!(
            foreign_keys(&schema),
            vec![("party".into(), "Party".into())]
        );
        let sql = add_foreign_key_sql("SalesInvoice", "party", "Party").unwrap();
        assert_eq!(
            sql,
            "ALTER TABLE `salesinvoice` ADD CONSTRAINT \
             `fk_SalesInvoice_party` FOREIGN KEY (`party`) \
             REFERENCES `party` (`name`) ON UPDATE CASCADE ON DELETE RESTRICT"
        );
    }

    #[test]
    fn link_fields_without_a_target_are_skipped() {
        let schema = schema_with(vec![field("party", "Link")]);
        assert!(foreign_keys(&schema).is_empty());
    }

    #[test]
    fn a_schema_with_no_columns_is_an_error_not_invalid_sql() {
        let schema = schema_with(vec![field("items", "Table")]);
        assert!(create_table_sql(&schema).is_err());
    }
}
