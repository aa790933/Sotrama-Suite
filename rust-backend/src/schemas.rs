//! Schema registry, embedded at compile time from the tracked schemas/ directory.
//! Build order mirrors getSchemas in schemas/index.ts so generated DDL stays stable.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::Value;

use crate::error::BackendError;
use crate::types::{Field, RawCustomField, Schema, SchemaMap, SelectOption};

static SCHEMA_DIR: include_dir::Dir<'static> =
    include_dir::include_dir!("$CARGO_MANIFEST_DIR/../schemas");

/// An immutable, fully-built schema map plus the country it was built for.
#[derive(Debug, Clone)]
pub struct Registry {
    schemas: Arc<SchemaMap>,
    country_code: String,
}

impl Registry {
    /// Builds the registry for a country code, mirroring
    /// `getSchemas(countryCode, [])` in `schemas/index.ts`.
    pub fn build(
        country_code: &str,
        custom_fields: &[RawCustomField],
    ) -> Result<Self, BackendError> {
        let mut map: SchemaMap = build_app_schemas(country_code)?;
        let core = build_core_schemas()?;
        map.extend(core);

        add_meta_fields(&mut map);
        remove_fields(&mut map);
        set_schema_name_on_fields(&mut map);
        add_custom_fields(&mut map, custom_fields);

        Ok(Self {
            schemas: Arc::new(map),
            country_code: country_code.to_string(),
        })
    }

    pub fn schemas(&self) -> &SchemaMap {
        &self.schemas
    }

    pub fn country_code(&self) -> &str {
        &self.country_code
    }

    pub fn get(&self, name: &str) -> Result<&Schema, BackendError> {
        self.schemas
            .get(name)
            .ok_or_else(|| BackendError::UnknownSchema(name.to_string()))
    }

    pub fn contains(&self, name: &str) -> bool {
        self.schemas.contains_key(name)
    }
}

/// Lowercased schema name, matching DatabaseCore#normalizeTableName.
/// Quote the result with query::ident before interpolating it.
pub fn table_name(schema_name: &str) -> String {
    schema_name.to_lowercase()
}

fn read_json<T: serde::de::DeserializeOwned>(path: &str) -> Result<T, BackendError> {
    let file = SCHEMA_DIR
        .get_file(path)
        .ok_or_else(|| BackendError::InvalidArgument(format!("embedded schema missing: {path}")))?;
    let text = std::str::from_utf8(file.contents())
        .map_err(|e| BackendError::InvalidArgument(format!("{path}: {e}")))?;
    serde_json::from_str(text).map_err(|e| BackendError::InvalidArgument(format!("{path}: {e}")))
}

/// Every `*.json` under `prefix`, in a stable order. `include_dir` does not
/// guarantee ordering, and a stable map keeps generated DDL diffable.
fn json_paths_under(prefix: &str) -> Vec<String> {
    let mut paths = Vec::new();
    collect_json(&SCHEMA_DIR, prefix, &mut paths);
    paths.sort();
    paths
}

/// `Dir::files()` only yields direct children, and every schema JSON sits one
/// level down (`app/`, `core/`, `regional/<cc>/`), so the tree is walked here.
fn collect_json(dir: &include_dir::Dir<'_>, prefix: &str, out: &mut Vec<String>) {
    for entry in dir.entries() {
        match entry {
            include_dir::DirEntry::Dir(sub) => collect_json(sub, prefix, out),
            include_dir::DirEntry::File(file) => {
                if let Some(path) = file.path().to_str() {
                    if path.starts_with(prefix) && path.ends_with(".json") {
                        out.push(path.to_string());
                    }
                }
            }
        }
    }
}

fn load_dir(prefix: &str) -> Result<BTreeMap<String, Schema>, BackendError> {
    let mut map = BTreeMap::new();
    for path in json_paths_under(prefix) {
        let schema: Schema = read_json(&path)?;
        if let Some(field) = schema
            .fields
            .iter()
            .find(|field| field.fieldtype.is_empty() && field.abstract_ != Some(true))
        {
            return Err(BackendError::InvalidArgument(format!(
                "{path}: field `{}` is missing fieldtype and is not an abstract placeholder",
                field.fieldname
            )));
        }
        map.insert(schema.name.clone(), schema);
    }
    Ok(map)
}

fn build_core_schemas() -> Result<SchemaMap, BackendError> {
    Ok(abstract_combined(load_dir("core/")?))
}

fn build_app_schemas(country_code: &str) -> Result<SchemaMap, BackendError> {
    let mut app = load_dir("app/")?;

    let regional_path = format!("regional/{country_code}/");
    if SCHEMA_DIR.get_dir(&regional_path).is_some() {
        // Regional schemas overlay app schemas field-by-field; a regional file
        // that names a schema absent from `app/` is added wholesale.
        for path in json_paths_under(&regional_path) {
            let regional: Schema = read_json(&path)?;
            app.entry(regional.name.clone())
                .and_modify(|base| {
                    *base = combine(&regional, base);
                })
                .or_insert(regional);
        }
    }

    Ok(abstract_combined(app))
}

/// Merges extends chains like getAbstractCombinedSchemas: extending schemas gain the parent fields, abstracts drop out.
/// Abstract schemas with no `extends` are kept as standalone (unlike TS which drops them).
fn abstract_combined(schemas: BTreeMap<String, Schema>) -> SchemaMap {
    let abstract_names: Vec<String> = schemas
        .iter()
        .filter(|(_, s)| s.is_abstract == Some(true))
        .map(|(n, _)| n.clone())
        .collect();

    let extending_names: Vec<String> = schemas
        .iter()
        .filter(|(_, s)| {
            s.extends
                .as_deref()
                .is_some_and(|e| abstract_names.iter().any(|a| a == e))
        })
        .map(|(n, _)| n.clone())
        .collect();

    // Abstract schemas that are NOT extended by anyone are kept as standalone.
    let unextended_abstracts: Vec<String> = abstract_names
        .iter()
        .filter(|a| {
            !extending_names
                .iter()
                .any(|e| schemas.get(e).and_then(|s| s.extends.as_deref()) == Some(a))
        })
        .cloned()
        .collect();

    let mut out: SchemaMap = schemas
        .iter()
        .filter(|(n, _)| {
            !abstract_names.contains(n) || unextended_abstracts.contains(n)
        } && !extending_names.contains(n))
        .map(|(n, s)| (n.clone(), s.clone()))
        .collect();

    for name in extending_names {
        let Some(extending) = schemas.get(&name) else {
            continue;
        };
        let Some(parent_name) = extending.extends.as_ref() else {
            continue;
        };
        let Some(parent) = schemas.get(parent_name) else {
            out.insert(name, extending.clone());
            continue;
        };
        out.insert(name, combine(extending, parent));
    }

    out
}

/// Overlays extending on abstract by fieldname; abstract field order is kept so CREATE TABLE stays stable.
fn combine(extending: &Schema, abstract_schema: &Schema) -> Schema {
    let mut fields: BTreeMap<usize, Field> = BTreeMap::new();
    let mut next = 0usize;
    for f in &abstract_schema.fields {
        fields.insert(next, f.clone());
        next += 1;
    }
    for f in &extending.fields {
        let pos = fields
            .iter()
            .find(|(_, existing)| existing.fieldname == f.fieldname)
            .map(|(i, _)| *i);
        match pos {
            Some(i) => {
                fields.insert(i, f.clone());
            }
            None => {
                fields.insert(next, f.clone());
                next += 1;
            }
        }
    }

    Schema {
        label: extending
            .label
            .clone()
            .or_else(|| abstract_schema.label.clone()),
        is_tree: extending.is_tree.or(abstract_schema.is_tree),
        is_child: extending.is_child.or(abstract_schema.is_child),
        is_single: extending.is_single.or(abstract_schema.is_single),
        is_submittable: extending.is_submittable.or(abstract_schema.is_submittable),
        naming: extending.naming.or(abstract_schema.naming),
        title_field: extending
            .title_field
            .clone()
            .or_else(|| abstract_schema.title_field.clone()),
        fields: fields.into_values().collect(),
        ..extending.clone()
    }
}

// Post-processing, in the order `schemas/index.ts` applies it.

fn meta_schema(name: &str) -> Result<Schema, BackendError> {
    read_json(&format!("meta/{name}.json"))
}

/// Appends meta fields per schema kind like addMetaFields, then the name field default.
fn add_meta_fields(map: &mut SchemaMap) {
    let Ok(base) = meta_schema("base") else {
        return;
    };
    let Ok(tree_meta) = meta_schema("tree") else {
        return;
    };
    let Ok(child) = meta_schema("child") else {
        return;
    };
    let Ok(submittable_meta) = meta_schema("submittable") else {
        return;
    };

    let tree = combine(&tree_meta, &base);
    let submittable = combine(&submittable_meta, &base);
    let submittable_tree = combine(&tree, &submittable_meta);

    for schema in map.values_mut() {
        if schema.is_single() {
            continue;
        }

        let meta_fields: Vec<Field> = if schema.is_tree() && schema.is_submittable() {
            submittable_tree.fields.clone()
        } else if schema.is_tree() {
            tree.fields.clone()
        } else if schema.is_submittable() {
            submittable.fields.clone()
        } else if schema.is_child() {
            child.fields.clone()
        } else {
            base.fields.clone()
        };
        schema.fields.extend(meta_fields);

        // Ensure "name" is the first field for all stored schemas (matches Frappe convention).
        if let Some(pos) = schema.fields.iter().position(|f| f.fieldname == "name") {
            if pos != 0 {
                let name_field = schema.fields.remove(pos);
                schema.fields.insert(0, name_field);
            }
        } else {
            schema.fields.insert(0, name_field());
        }
        if schema.title_field.is_none() {
            schema.title_field = Some("name".to_string());
        }
    }
}

fn name_field() -> Field {
    Field {
        fieldname: "name".to_string(),
        label: Some("ID".to_string()),
        fieldtype: "Data".to_string(),
        required: Some(true),
        read_only: Some(true),
        ..Field::default()
    }
}

/// Applies each schema's `removeFields` list. Mirrors `removeFields`.
fn remove_fields(map: &mut SchemaMap) {
    for schema in map.values_mut() {
        let Some(remove) = schema.remove_fields.take() else {
            continue;
        };
        schema.fields.retain(|f| !remove.contains(&f.fieldname));
        for list in [
            &mut schema.table_fields,
            &mut schema.quick_edit_fields,
            &mut schema.keyword_fields,
        ] {
            if let Some(list) = list.as_mut() {
                list.retain(|n| !remove.contains(n));
            }
        }
        if schema
            .link_display_field
            .as_ref()
            .is_some_and(|f| remove.contains(f))
        {
            schema.link_display_field = None;
        }
    }
}

fn set_schema_name_on_fields(map: &mut SchemaMap) {
    for (name, schema) in map.iter_mut() {
        for field in &mut schema.fields {
            field.schema_name = Some(name.clone());
        }
    }
}

/// Appends customfield rows like addCustomFields; duplicates and unknown parents are skipped.
fn add_custom_fields(map: &mut SchemaMap, custom_fields: &[RawCustomField]) {
    for custom in custom_fields {
        let Some(schema) = map.get_mut(&custom.parent) else {
            continue;
        };
        if schema
            .fields
            .iter()
            .any(|f| f.fieldname == custom.fieldname)
        {
            continue;
        }

        let mut field = Field {
            fieldname: custom.fieldname.clone(),
            label: Some(custom.label.clone()),
            fieldtype: custom.fieldtype.clone(),
            section: custom.section.clone(),
            tab: custom.tab.clone(),
            is_custom: Some(true),
            schema_name: Some(custom.parent.clone()),
            ..Field::default()
        };

        if let Some(raw) = custom.options.as_deref() {
            let options: Vec<SelectOption> = raw
                .lines()
                .map(str::trim)
                .filter(|o| !o.is_empty())
                .map(|o| SelectOption {
                    value: o.to_string(),
                    label: o.to_string(),
                })
                .collect();
            if !options.is_empty() {
                field.options = Some(options);
            }
        }

        if let Some(required) = custom.is_required {
            field.required = Some(required);
        }
        field.target = custom.target.clone();
        field.references = custom.references.clone();

        // A required field with no default would fail the `NOT NULL` insert
        // that the TypeScript backend also performs, so drop the requirement.
        if field.is_required() && custom.default.is_some() {
            field.default = custom.default.clone().map(Value::from);
        } else if field.is_required() {
            field.required = Some(false);
        }

        schema.fields.push(field);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> Registry {
        Registry::build("-", &[]).expect("registry builds")
    }

    #[test]
    fn loads_every_app_and_core_schema() {
        let r = registry();
        // Spot-check schemas from every directory that feeds the registry.
        for name in [
            "Item",
            "SalesInvoice",
            "SalesInvoiceItem",
            // Abstract parents are folded into concrete extending schemas and
            // must not appear as standalone tables in the registry.
            "ShipmentItem",
            "PurchaseReceiptItem",
            "POSSettings",
            "SingleValue",
            "SystemSettings",
            "CustomField",
            "PatchRun",
        ] {
            assert!(r.contains(name), "missing schema {name}");
        }
    }

    #[test]
    fn regional_schemas_overlay_the_base_country() {
        let base = Registry::build("-", &[]).unwrap();
        let algeria = Registry::build("dz", &[]).unwrap();

        assert!(algeria.contains("Employee"), "regional schema not loaded");
        assert!(
            !base.contains("Employee"),
            "regional schema leaked into base"
        );

        // Regional overlay wins redefined fields; base-only fields survive.
        let base_party = base.get("Party").unwrap();
        let algeria_party = algeria.get("Party").unwrap();
        assert!(
            algeria_party.fields.len() >= base_party.fields.len(),
            "regional overlay lost fields"
        );
    }

    #[test]
    fn meta_fields_are_appended_per_schema_kind() {
        let r = registry();

        let base = r.get("Item").unwrap();
        for f in ["createdBy", "modifiedBy", "created", "modified"] {
            assert!(base.has_column(f), "base meta field {f} missing");
        }

        let tree = r.get("ItemGroup").unwrap();
        assert!(tree.has_column("lft") && tree.has_column("rgt"));

        let child = r.get("SalesInvoiceItem").unwrap();
        for f in ["idx", "parent", "parentSchemaName", "parentFieldname"] {
            assert!(child.has_column(f), "child meta field {f} missing");
        }

        let submittable = r.get("SalesInvoice").unwrap();
        for f in ["submitted", "cancelled"] {
            assert!(
                submittable.has_column(f),
                "submittable meta field {f} missing"
            );
        }
    }

    #[test]
    fn name_is_the_first_field_of_every_stored_schema() {
        let r = registry();
        for (name, schema) in r.schemas() {
            if schema.is_single() {
                continue;
            }
            assert_eq!(
                schema.fields.first().map(|f| f.fieldname.as_str()),
                Some("name"),
                "schema {name} does not lead with `name`"
            );
        }
    }

    #[test]
    fn singles_get_no_name_field() {
        let r = registry();
        let settings = r.get("SystemSettings").unwrap();
        assert!(settings.is_single());
        assert!(!settings.has_column("name"));
    }

    #[test]
    fn custom_fields_are_appended_and_never_shadow_existing_ones() {
        let r = Registry::build(
            "-",
            &[
                // `tax` already exists on ItemGroup, so this must be ignored.
                RawCustomField {
                    parent: "ItemGroup".into(),
                    label: "Duplicate".into(),
                    fieldname: "tax".into(),
                    fieldtype: "Link".into(),
                    is_required: Some(true),
                    section: None,
                    tab: None,
                    options: None,
                    target: Some("Tax".into()),
                    references: None,
                    default: None,
                },
                // A genuinely new field.
                RawCustomField {
                    parent: "ItemGroup".into(),
                    label: "Bin".into(),
                    fieldname: "binCode".into(),
                    fieldtype: "Data".into(),
                    is_required: Some(true),
                    section: None,
                    tab: None,
                    options: Some("A\nB".into()),
                    target: None,
                    references: None,
                    default: None,
                },
                // Unknown parent is dropped.
                RawCustomField {
                    parent: "NoSuchSchema".into(),
                    label: "Orphan".into(),
                    fieldname: "orphan".into(),
                    fieldtype: "Data".into(),
                    is_required: None,
                    section: None,
                    tab: None,
                    options: None,
                    target: None,
                    references: None,
                    default: None,
                },
            ],
        )
        .unwrap();

        let schema = r.get("ItemGroup").unwrap();
        assert!(
            schema.field("tax").is_some(),
            "original tax field should remain"
        );
        // The custom field with same name should not create a duplicate
        let tax_fields: Vec<_> = schema
            .fields
            .iter()
            .filter(|f| f.fieldname == "tax")
            .collect();
        assert_eq!(
            tax_fields.len(),
            1,
            "custom field should not duplicate existing field"
        );

        let bin = schema.field("binCode").expect("custom field not appended");
        assert_eq!(bin.options.as_ref().map(|o| o.len()), Some(2));
        assert_eq!(bin.is_custom, Some(true));
        // Required with no default is downgraded, so inserts do not fail 1364.
        assert!(!bin.is_required());
    }

    #[test]
    fn table_names_are_lowercase_and_prefixed() {
        assert_eq!(table_name("SalesInvoiceItem"), "salesinvoiceitem");
        assert_eq!(table_name("POSSettings"), "possettings");
    }

    #[test]
    fn schema_json_is_the_only_source() {
        // Guards the deletion of the hand-copied `rust-backend/schema/` tree: if
        // someone reintroduces a copy, these paths must stop resolving.
        assert!(SCHEMA_DIR.get_file("app/Item.json").is_some());
        assert!(SCHEMA_DIR.get_file("meta/base.json").is_some());
    }

    #[test]
    fn abstract_field_markers_are_booleans() {
        let field: Field = serde_json::from_value(serde_json::json!({
            "fieldname": "party",
            "abstract": true
        }))
        .expect("abstract marker should match schema JSON");
        assert_eq!(field.abstract_, Some(true));
        assert!(field.fieldtype.is_empty());
    }
}
