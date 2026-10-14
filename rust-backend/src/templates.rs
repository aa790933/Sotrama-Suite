//! Print-template resource loading for the Electron host; no database required.

use std::fs;
use std::io::Read;
use std::path::Path;

use anyhow::{Context, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;

const MAX_TEMPLATE_FILES: usize = 1024;
const MAX_TEMPLATE_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TOTAL_TEMPLATE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
pub struct TemplateFile {
    file: String,
    template: String,
    modified: String,
    width: f64,
    height: u8,
}

pub fn load_templates(
    directory: &Path,
    pos_template_width: Option<f64>,
) -> Result<Vec<TemplateFile>> {
    let mut files = fs::read_dir(directory)
        .with_context(|| format!("Could not list print templates in {}", directory.display()))?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .context("Could not read print template directory entry")
        })
        .collect::<Result<Vec<_>>>()?;
    if files.len() > MAX_TEMPLATE_FILES {
        anyhow::bail!("Print-template directory exceeds the {MAX_TEMPLATE_FILES}-file limit");
    }
    files.sort();

    let mut templates = Vec::with_capacity(files.len());
    let mut total_bytes = 0_u64;
    for file in files {
        let path = directory.join(&file);
        let metadata = fs::symlink_metadata(&path)
            .with_context(|| format!("Could not inspect print template '{file}'"))?;
        if !metadata.file_type().is_file() {
            anyhow::bail!("Print-template entry '{file}' is not a regular file");
        }
        if metadata.len() > MAX_TEMPLATE_FILE_BYTES {
            anyhow::bail!(
                "Print template '{file}' exceeds the {MAX_TEMPLATE_FILE_BYTES}-byte limit"
            );
        }
        if total_bytes.saturating_add(metadata.len()) > MAX_TOTAL_TEMPLATE_BYTES {
            anyhow::bail!(
                "Print-template directory exceeds the {MAX_TOTAL_TEMPLATE_BYTES}-byte total limit"
            );
        }
        let file_handle = fs::File::open(&path)
            .with_context(|| format!("Could not read print template '{file}'"))?;
        let mut template = String::new();
        file_handle
            .take(MAX_TEMPLATE_FILE_BYTES + 1)
            .read_to_string(&mut template)
            .with_context(|| format!("Could not read print template '{file}'"))?;
        if template.len() as u64 > MAX_TEMPLATE_FILE_BYTES {
            anyhow::bail!(
                "Print template '{file}' exceeds the {MAX_TEMPLATE_FILE_BYTES}-byte limit"
            );
        }
        total_bytes = total_bytes.saturating_add(template.len() as u64);
        if total_bytes > MAX_TOTAL_TEMPLATE_BYTES {
            anyhow::bail!(
                "Print-template directory exceeds the {MAX_TOTAL_TEMPLATE_BYTES}-byte total limit"
            );
        }
        let modified = metadata
            .modified()
            .with_context(|| format!("Could not read modification time for '{file}'"))?;
        let modified = DateTime::<Utc>::from(modified).to_rfc3339_opts(SecondsFormat::Millis, true);
        let is_pos = file
            .split('-')
            .nth(1)
            .and_then(|part| part.split('.').next())
            == Some("POS");

        templates.push(TemplateFile {
            file,
            template,
            modified,
            width: if is_pos {
                pos_template_width.unwrap_or(0.0)
            } else {
                0.0
            },
            height: if is_pos { 22 } else { 0 },
        });
    }

    Ok(templates)
}

#[cfg(test)]
mod tests {
    use super::load_templates;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn templates_are_sorted_and_pos_dimensions_match_the_legacy_contract() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("sotrama-templates-{unique}"));
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("Business-POS.template.html"), "pos").unwrap();
        fs::write(directory.join("Basic.template.html"), "basic").unwrap();

        let templates = load_templates(&directory, Some(87.5)).unwrap();
        assert_eq!(templates.len(), 2);
        assert_eq!(templates[0].file, "Basic.template.html");
        assert_eq!(templates[0].width, 0.0);
        assert_eq!(templates[0].height, 0);
        assert_eq!(templates[1].file, "Business-POS.template.html");
        assert_eq!(templates[1].width, 87.5);
        assert_eq!(templates[1].height, 22);
        assert!(templates
            .iter()
            .all(|template| template.modified.ends_with('Z')));

        fs::remove_dir_all(directory).unwrap();
    }
}
