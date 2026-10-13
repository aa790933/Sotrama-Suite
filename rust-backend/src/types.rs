//! Types mirroring the schema JSON and IPC payloads.
//! Field stays one flat struct because the JSON is a structural union.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Every key of mariadbTypeMap in backend/helpers.ts, including UI-unused ones in regional schemas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FieldType {
    Data,
    Select,
    Link,
    Date,
    Datetime,
    Table,
    AutoComplete,
    Check,
    AttachImage,
    DynamicLink,
    Int,
    Float,
    Currency,
    Text,
    Color,
    Button,
    Attachment,
    Percent,
    Code,
    Secret,
    Password,
    Time,
}

impl FieldType {
    /// MariaDB column type. Link is VARCHAR(255) so foreign keys survive (errno 3780 on TEXT).
    /// Other string-ish types stay TEXT to match databases the TypeScript backend created.
    pub fn column_type(self) -> Option<&'static str> {
        match self {
            FieldType::Int => Some("INTEGER"),
            FieldType::Float | FieldType::Percent => Some("FLOAT"),
            FieldType::Check => Some("TINYINT(1)"),
            FieldType::Date => Some("DATE"),
            FieldType::Datetime => Some("DATETIME(6)"),
            FieldType::Time => Some("TIME"),
            FieldType::Table | FieldType::Button => None,
            FieldType::Link => Some("VARCHAR(255)"),
            _ => Some("TEXT"),
        }
    }

    /// Whether this field type gets a database column at all.
    pub fn is_stored(self) -> bool {
        self.column_type().is_some()
    }
}

impl std::str::FromStr for FieldType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "Data" => FieldType::Data,
            "Select" => FieldType::Select,
            "Link" => FieldType::Link,
            "Date" => FieldType::Date,
            "Datetime" => FieldType::Datetime,
            "Table" => FieldType::Table,
            "AutoComplete" => FieldType::AutoComplete,
            "Check" => FieldType::Check,
            "AttachImage" => FieldType::AttachImage,
            "DynamicLink" => FieldType::DynamicLink,
            "Int" => FieldType::Int,
            "Float" => FieldType::Float,
            "Currency" => FieldType::Currency,
            "Text" => FieldType::Text,
            "Color" => FieldType::Color,
            "Button" => FieldType::Button,
            "Attachment" => FieldType::Attachment,
            "Percent" => FieldType::Percent,
            "Code" => FieldType::Code,
            "Secret" => FieldType::Secret,
            "Password" => FieldType::Password,
            "Time" => FieldType::Time,
            other => return Err(format!("unknown fieldtype: {other}")),
        })
    }
}

/// A single schema field. Properties that only apply to some field types are
/// optional here exactly as they are optional in the JSON.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub fieldname: String,
    #[serde(default)]
    pub fieldtype: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invisible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub computed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<String>,
    /// The JSON key is `abstract`, a Rust keyword.
    #[serde(default, rename = "abstract", skip_serializing_if = "Option::is_none")]
    pub abstract_: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_custom: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<HashMap<String, String>>,

    // OptionField
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<SelectOption>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_custom: Option<bool>,

    // TargetField (Link, Table)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub create: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit: Option<bool>,

    // DynamicLinkField
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub references: Option<String>,

    // NumberField
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minvalue: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maxvalue: Option<f64>,

    // TextField
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u32>,
}

impl Field {
    pub fn field_type(&self) -> Result<FieldType, String> {
        self.fieldtype.parse()
    }

    pub fn is_computed(&self) -> bool {
        self.computed.unwrap_or(false)
    }

    pub fn is_required(&self) -> bool {
        self.required.unwrap_or(false)
    }

    /// Whether this field owns a column (Table and computed fields do not).
    pub fn is_column(&self) -> bool {
        !self.is_computed() && self.field_type().map(|t| t.is_stored()).unwrap_or(false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Naming {
    #[serde(rename = "autoincrement")]
    AutoIncrement,
    #[serde(rename = "random")]
    Random,
    #[serde(rename = "numberSeries")]
    NumberSeries,
    #[serde(rename = "manual")]
    Manual,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    pub name: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,

    #[serde(default)]
    pub fields: Vec<Field>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_tree: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extends: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_child: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_single: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_abstract: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_fields: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_submittable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword_fields: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quick_edit_fields: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_display_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub create: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub naming: Option<Naming>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remove_fields: Option<Vec<String>>,
}

impl Schema {
    pub fn is_single(&self) -> bool {
        self.is_single.unwrap_or(false)
    }

    pub fn is_child(&self) -> bool {
        self.is_child.unwrap_or(false)
    }

    pub fn is_tree(&self) -> bool {
        self.is_tree.unwrap_or(false)
    }

    pub fn is_submittable(&self) -> bool {
        self.is_submittable.unwrap_or(false)
    }

    /// Column-owning fields in declaration order, so generated SQL stays stable.
    pub fn column_fields(&self) -> impl Iterator<Item = &Field> {
        self.fields.iter().filter(|f| f.is_column())
    }

    /// Child-table fields, in declaration order.
    pub fn table_fields(&self) -> impl Iterator<Item = &Field> {
        self.fields.iter().filter(|f| f.fieldtype == "Table")
    }

    pub fn field(&self, fieldname: &str) -> Option<&Field> {
        self.fields.iter().find(|f| f.fieldname == fieldname)
    }

    pub fn has_column(&self, fieldname: &str) -> bool {
        self.field(fieldname)
            .map(|f| f.is_column())
            .unwrap_or(false)
    }
}

pub type SchemaMap = HashMap<String, Schema>;

/// A raw database row as JSON; child table rows arrive as arrays.
pub type Row = serde_json::Map<String, serde_json::Value>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MariaDBConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
}

/// A row of the `customfield` table, before conversion into a schema `Field`.
#[derive(Debug, Clone)]
pub struct RawCustomField {
    pub parent: String,
    pub label: String,
    pub fieldname: String,
    pub fieldtype: String,
    pub is_required: Option<bool>,
    pub section: Option<String>,
    pub tab: Option<String>,
    pub options: Option<String>,
    pub target: Option<String>,
    pub references: Option<String>,
    pub default: Option<String>,
}

/// A filter value is a scalar or [operator, value(, operator2, value2)].
/// Values stay raw JSON; the query builder validates against an operator allowlist.
pub type QueryFilter = serde_json::Map<String, serde_json::Value>;

/// fields/groupBy/orderBy stay raw JSON (string | string[]) for the query builder to normalise.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAllOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<QueryFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_by: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_by: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<String>,
}

impl GetAllOptions {
    /// Normalises `string | string[]` into a list, dropping blank entries.
    pub fn as_list(value: Option<&serde_json::Value>) -> Vec<String> {
        match value {
            Some(serde_json::Value::String(s)) => {
                if s.trim().is_empty() {
                    Vec::new()
                } else {
                    vec![s.clone()]
                }
            }
            Some(serde_json::Value::Array(a)) => a
                .iter()
                .filter_map(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string)
                .collect(),
            _ => Vec::new(),
        }
    }
}

/// The exact method set routed by main/ipc/router.ts:dbCall.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatabaseMethod {
    Insert,
    Get,
    GetAll,
    GetSingleValues,
    Rename,
    Update,
    Delete,
    DeleteAll,
    Exists,
    Close,
    Count,
    GetNextAutoincrementId,
    GetNextSeriesValue,
}

impl std::str::FromStr for DatabaseMethod {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "insert" => DatabaseMethod::Insert,
            "get" => DatabaseMethod::Get,
            "getAll" => DatabaseMethod::GetAll,
            "getSingleValues" => DatabaseMethod::GetSingleValues,
            "rename" => DatabaseMethod::Rename,
            "update" => DatabaseMethod::Update,
            "delete" => DatabaseMethod::Delete,
            "deleteAll" => DatabaseMethod::DeleteAll,
            "exists" => DatabaseMethod::Exists,
            "close" => DatabaseMethod::Close,
            "count" => DatabaseMethod::Count,
            "getNextAutoincrementId" => DatabaseMethod::GetNextAutoincrementId,
            "getNextSeriesValue" => DatabaseMethod::GetNextSeriesValue,
            other => return Err(format!("Unknown database method: {other}")),
        })
    }
}
