//! Translation CSV loading for the Electron host. This command is deliberately
//! independent of MariaDB so language selection still works before connecting.

use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

const MAX_TRANSLATION_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TRANSLATION_ROWS: usize = 100_000;

pub fn load_language_map(directory: &Path, code: &str) -> Result<BTreeMap<String, Value>> {
    if code.is_empty()
        || code.len() > 32
        || !code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        bail!("Invalid language code");
    }

    let path = directory.join(format!("{code}.csv"));
    let metadata = fs::symlink_metadata(&path)
        .with_context(|| format!("Could not load translations for '{code}'"))?;
    if !metadata.file_type().is_file() {
        bail!("Could not load translations for '{code}'");
    }
    if metadata.len() > MAX_TRANSLATION_BYTES {
        bail!("Translation file exceeds the {MAX_TRANSLATION_BYTES}-byte limit");
    }

    let file = fs::File::open(&path)
        .with_context(|| format!("Could not read translations for '{code}'"))?;
    let mut contents = String::new();
    file.take(MAX_TRANSLATION_BYTES + 1)
        .read_to_string(&mut contents)
        .with_context(|| format!("Could not read translations for '{code}'"))?;
    if contents.len() as u64 > MAX_TRANSLATION_BYTES {
        bail!("Translation file exceeds the {MAX_TRANSLATION_BYTES}-byte limit");
    }
    if contents.is_empty() {
        bail!("Could not load translations for '{code}'");
    }
    let rows = parse_csv(&contents).context("Invalid translation CSV")?;
    if rows.len() > MAX_TRANSLATION_ROWS {
        bail!("Translation file exceeds the {MAX_TRANSLATION_ROWS}-row limit");
    }

    let mut map = BTreeMap::new();
    for row in rows {
        let source = row.first().map(String::as_str).unwrap_or_default();
        let translation = row.get(1).map(String::as_str).unwrap_or_default();
        if source.is_empty() || translation.is_empty() {
            continue;
        }

        let mut value = json!({ "translation": translation });
        if let Some(context) = row.get(3).filter(|context| !context.is_empty()) {
            value["context"] = json!(context);
        }
        // Preserve the legacy behavior: later duplicate source strings win.
        map.insert(source.to_owned(), value);
    }

    Ok(map)
}

fn parse_csv(input: &str) -> Result<Vec<Vec<String>>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut chars = input.chars().peekable();
    let mut quoted = false;
    let mut field_started = false;

    while let Some(ch) = chars.next() {
        if quoted {
            match ch {
                '"' if chars.peek() == Some(&'"') => {
                    chars.next();
                    field.push('"');
                }
                '"' => quoted = false,
                other => field.push(other),
            }
            continue;
        }

        match ch {
            '"' if !field_started && field.is_empty() => {
                quoted = true;
                field_started = true;
            }
            ',' => {
                row.push(std::mem::take(&mut field));
                field_started = false;
            }
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
                field_started = false;
            }
            '\r' if chars.peek() == Some(&'\n') => {
                chars.next();
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
                field_started = false;
            }
            other => {
                field.push(other);
                field_started = true;
            }
        }
        if rows.len() > MAX_TRANSLATION_ROWS {
            bail!("CSV contains too many rows");
        }
    }

    if quoted {
        bail!("unterminated quoted field");
    }
    if !field.is_empty() || !row.is_empty() || field_started {
        row.push(field);
        rows.push(row);
    }
    if rows.len() > MAX_TRANSLATION_ROWS {
        bail!("CSV contains too many rows");
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::{load_language_map, parse_csv};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn csv_parser_preserves_escaped_quotes_commas_and_embedded_newlines() {
        let rows = parse_csv("source,translation,unused,context\r\n\"a,b\",\"say \"\"hi\"\"\",,\"line 1\r\nline 2\"\r\n")
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1][0], "a,b");
        assert_eq!(rows[1][1], "say \"hi\"");
        assert_eq!(rows[1][3], "line 1\r\nline 2");
    }

    #[test]
    fn language_map_skips_empty_rows_and_last_duplicate_wins() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("sotrama-translations-{unique}"));
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("en.csv"),
            "source,translation,unused,context\r\nhello,First,,\r\n,ignored,,\r\nhello,Last,,greeting\r\n",
        )
        .unwrap();

        let map = load_language_map(&directory, "en").unwrap();
        assert_eq!(map["hello"]["translation"], "Last");
        assert_eq!(map["hello"]["context"], "greeting");
        assert!(load_language_map(&directory, "../en").is_err());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn malformed_csv_is_rejected() {
        assert!(parse_csv("source,\"unterminated").is_err());
    }
}
