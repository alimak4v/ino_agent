use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const CONNECTORS_DIR: &str = "connectors";
const GENERATED_DIR: &str = "_generated";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub entry: String,
    pub permissions: Vec<String>,
    pub schedule: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorDraft {
    pub manifest: ConnectorManifest,
    pub readme: String,
    pub files: Vec<ConnectorFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorSummary {
    pub manifest: ConnectorManifest,
    pub path: String,
    pub pending: bool,
    pub files: Vec<ConnectorFile>,
}

pub fn connectors_root() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .ok_or_else(|| "Could not resolve application data directory.".to_string())?;
    Ok(base.join("ino-agent").join(CONNECTORS_DIR))
}

pub fn list_connectors() -> Result<Vec<ConnectorSummary>, String> {
    let root = connectors_root()?;
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut connectors = Vec::new();
    read_connector_dir(&root, false, &mut connectors)?;
    read_connector_dir(&root.join(GENERATED_DIR), true, &mut connectors)?;
    connectors.sort_by(|a, b| b.manifest.updated_at.cmp(&a.manifest.updated_at));
    Ok(connectors)
}

pub fn save_draft(mut draft: ConnectorDraft) -> Result<ConnectorSummary, String> {
    normalize_draft(&mut draft)?;
    let root = connectors_root()?
        .join(GENERATED_DIR)
        .join(&draft.manifest.id);
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    write_connector_files(&root, &draft)?;
    summary_from_dir(&root, true)
}

pub fn set_enabled(id: &str, enabled: bool) -> Result<ConnectorSummary, String> {
    let root = connectors_root()?;
    let pending = root.join(GENERATED_DIR).join(id);
    let stable = root.join(id);
    let path = if pending.exists() {
        pending
    } else if stable.exists() {
        stable
    } else {
        return Err("Connector not found.".to_string());
    };

    let mut draft = draft_from_dir(&path)?;
    draft.manifest.enabled = enabled;
    draft.manifest.updated_at = now();
    if enabled
        && path
            .parent()
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            == Some(GENERATED_DIR)
    {
        let destination = root.join(&draft.manifest.id);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        fs::rename(&path, &destination).map_err(|e| e.to_string())?;
        write_manifest(&destination, &draft.manifest)?;
        return summary_from_dir(&destination, false);
    }

    write_manifest(&path, &draft.manifest)?;
    summary_from_dir(&path, false)
}

pub fn parse_model_draft(answer: &str) -> Result<ConnectorDraft, String> {
    for candidate in json_candidates(answer) {
        if let Ok(draft) = serde_json::from_str::<ConnectorDraft>(&candidate) {
            return Ok(draft);
        }
        if let Ok(value) = serde_json::from_str::<Value>(&candidate) {
            if let Some(draft) = parse_flexible_draft(&value)? {
                return Ok(draft);
            }
        }
    }
    Err("The model did not return a valid connector draft.".to_string())
}

pub fn connector_prompt(user_request: &str, tree_title: &str, node_title: &str) -> String {
    format!(
        "Create a local ino-agent connector package for the user's request.\n\nContext:\nTree: {tree_title}\nCurrent branch: {node_title}\nUser request:\n{user_request}\n\nReturn ONLY JSON with this exact shape:\n{{\"manifest\":{{\"id\":\"kebab-case-id\",\"name\":\"Human name\",\"description\":\"short description\",\"version\":\"0.1.0\",\"entry\":\"connector.ts\",\"permissions\":[\"network:https://example.com\",\"write:tree\"],\"schedule\":\"cron or null\",\"enabled\":false,\"created_at\":0,\"updated_at\":0}},\"readme\":\"markdown docs\",\"files\":[{{\"path\":\"connector.ts\",\"content\":\"TypeScript source\"}}]}}\n\nRules:\n- Generate a connector, not prose.\n- Keep enabled=false.\n- Use kebab-case id.\n- Include only relative paths without .. or leading slash.\n- The entry file must exist in files.\n- Prefer connector.ts plus optional config.example.json.\n- The connector source should export an async run(ctx) function.\n- Do not include secrets. Use env/config placeholders.\n- Permissions must be explicit and minimal, such as network:https://domain, read:workspace, write:tree, write:workspace, cron.\n- If the user asks for a schedule, put a cron string in schedule; otherwise null."
    )
}

fn read_connector_dir(
    root: &Path,
    pending: bool,
    connectors: &mut Vec<ConnectorSummary>,
) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(root).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        if let Ok(summary) = summary_from_dir(&entry.path(), pending) {
            connectors.push(summary);
        }
    }
    Ok(())
}

fn summary_from_dir(path: &Path, pending: bool) -> Result<ConnectorSummary, String> {
    let draft = draft_from_dir(path)?;
    Ok(ConnectorSummary {
        manifest: draft.manifest,
        path: path.to_string_lossy().to_string(),
        pending,
        files: draft.files,
    })
}

fn draft_from_dir(path: &Path) -> Result<ConnectorDraft, String> {
    let manifest = fs::read_to_string(path.join("manifest.json")).map_err(|e| e.to_string())?;
    let manifest =
        serde_json::from_str::<ConnectorManifest>(&manifest).map_err(|e| e.to_string())?;
    let readme = fs::read_to_string(path.join("README.md")).unwrap_or_default();
    let mut files = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "manifest.json" || name == "README.md" {
            continue;
        }
        files.push(ConnectorFile {
            path: name,
            content: fs::read_to_string(entry.path()).unwrap_or_default(),
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ConnectorDraft {
        manifest,
        readme,
        files,
    })
}

fn write_connector_files(root: &Path, draft: &ConnectorDraft) -> Result<(), String> {
    write_manifest(root, &draft.manifest)?;
    fs::write(root.join("README.md"), &draft.readme).map_err(|e| e.to_string())?;
    for file in &draft.files {
        let relative = safe_relative_path(&file.path)?;
        if let Some(parent) = root.join(&relative).parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(root.join(relative), &file.content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn write_manifest(root: &Path, manifest: &ConnectorManifest) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(root.join("manifest.json"), raw).map_err(|e| e.to_string())
}

fn normalize_draft(draft: &mut ConnectorDraft) -> Result<(), String> {
    let ts = now();
    let id = slugify(&draft.manifest.id);
    draft.manifest.id = if id.is_empty() {
        format!("connector-{}", Uuid::new_v4().simple())
            .chars()
            .take(24)
            .collect()
    } else {
        id
    };
    draft.manifest.name = clean_text(&draft.manifest.name, "Generated connector", 80);
    draft.manifest.description =
        clean_text(&draft.manifest.description, "Generated by ino-agent", 240);
    draft.manifest.version = clean_text(&draft.manifest.version, "0.1.0", 24);
    draft.manifest.entry = clean_text(&draft.manifest.entry, "connector.ts", 96);
    draft.manifest.enabled = false;
    draft.manifest.created_at = if draft.manifest.created_at > 0 {
        draft.manifest.created_at
    } else {
        ts
    };
    draft.manifest.updated_at = ts;
    safe_relative_path(&draft.manifest.entry)?;
    if !draft
        .files
        .iter()
        .any(|file| file.path == draft.manifest.entry)
    {
        return Err("Connector entry file is missing.".to_string());
    }
    for file in &draft.files {
        safe_relative_path(&file.path)?;
        if file.content.trim().is_empty() {
            return Err(format!("Connector file {} is empty.", file.path));
        }
    }
    draft.readme = if draft.readme.trim().is_empty() {
        format!("# {}\n\nGenerated connector.", draft.manifest.name)
    } else {
        draft.readme.trim().chars().take(12_000).collect()
    };
    draft.manifest.permissions = draft
        .manifest
        .permissions
        .iter()
        .map(|permission| permission.trim().chars().take(160).collect::<String>())
        .filter(|permission| !permission.is_empty())
        .collect();
    Ok(())
}

fn safe_relative_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.starts_with('/') || trimmed.contains("..") {
        return Err(format!("Unsafe connector path: {path}"));
    }
    Ok(PathBuf::from(trimmed))
}

fn parse_flexible_draft(value: &Value) -> Result<Option<ConnectorDraft>, String> {
    let Some(manifest_value) = value.get("manifest") else {
        return Ok(None);
    };
    let manifest = serde_json::from_value::<ConnectorManifest>(manifest_value.clone())
        .map_err(|e| e.to_string())?;
    let readme = value
        .get("readme")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let files = value
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| "Connector files must be an array.".to_string())?
        .iter()
        .filter_map(|file| {
            Some(ConnectorFile {
                path: file.get("path")?.as_str()?.to_string(),
                content: file.get("content")?.as_str()?.to_string(),
            })
        })
        .collect::<Vec<_>>();
    Ok(Some(ConnectorDraft {
        manifest,
        readme,
        files,
    }))
}

fn json_candidates(answer: &str) -> Vec<String> {
    let trimmed = answer.trim();
    let mut candidates = Vec::new();
    if trimmed.starts_with('{') {
        candidates.push(trimmed.to_string());
    }
    let mut offset = 0;
    while let Some(start_rel) = trimmed[offset..].find('{') {
        let start = offset + start_rel;
        let mut depth = 0_i32;
        let mut in_string = false;
        let mut escaped = false;
        for (index, ch) in trimmed[start..].char_indices() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    in_string = false;
                }
                continue;
            }
            match ch {
                '"' => in_string = true,
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        candidates.push(trimmed[start..start + index + ch.len_utf8()].to_string());
                        offset = start + index + ch.len_utf8();
                        break;
                    }
                }
                _ => {}
            }
        }
        if offset <= start {
            break;
        }
    }
    candidates
}

fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in value.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
        if out.len() >= 64 {
            break;
        }
    }
    out.trim_matches('-').to_string()
}

fn clean_text(value: &str, fallback: &str, limit: usize) -> String {
    let clean = value.trim().replace('\n', " ");
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean.chars().take(limit).collect()
    }
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
