use crate::store::{KnowledgeChunkInput, KnowledgeSourceInput, MemoryInput, Store};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const MAX_FILE_BYTES: usize = 96_000;
const MAX_COMMAND_OUTPUT_BYTES: usize = 80_000;
const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 8_000;
const MAX_COMMAND_TIMEOUT_MS: u64 = 30_000;
const MAX_INDEX_FILE_BYTES: usize = 512_000;
const MAX_INDEX_FILES: usize = 80;
const MAX_INDEX_CHUNKS: usize = 240;
const INDEX_CHUNK_CHARS: usize = 3_600;
const INDEX_CHUNK_OVERLAP_CHARS: usize = 360;

struct IndexedTextChunk {
    text: String,
    start_offset: usize,
    end_offset: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentToolCall {
    pub tool: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentToolResult {
    pub tool: String,
    pub ok: bool,
    pub content: Value,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolPermissionProfile {
    ReadOnly,
    MemoryWrite,
    CommandRunner,
    WorkspaceWrite,
}

impl AgentToolPermissionProfile {
    pub fn name(self) -> &'static str {
        match self {
            Self::ReadOnly => "read_only",
            Self::MemoryWrite => "memory_write",
            Self::CommandRunner => "command_runner",
            Self::WorkspaceWrite => "workspace_write",
        }
    }

    pub fn allows(self, tool: &str) -> bool {
        match self {
            Self::ReadOnly => matches!(
                tool,
                "search_memory" | "list_files" | "read_file" | "open_target" | "self_review"
            ),
            Self::MemoryWrite => matches!(
                tool,
                "search_memory"
                    | "add_memory"
                    | "list_files"
                    | "read_file"
                    | "open_target"
                    | "index_path"
                    | "self_review"
            ),
            Self::CommandRunner => matches!(
                tool,
                "search_memory"
                    | "list_files"
                    | "read_file"
                    | "run_command"
                    | "open_target"
                    | "self_review"
            ),
            Self::WorkspaceWrite => matches!(
                tool,
                "search_memory"
                    | "add_memory"
                    | "list_files"
                    | "read_file"
                    | "run_command"
                    | "open_target"
                    | "index_path"
                    | "self_review"
            ),
        }
    }
}

pub fn tool_needs_store(tool: &str) -> bool {
    matches!(tool, "search_memory" | "add_memory" | "index_path")
}

pub fn permission_profile_for_request(request: &str) -> AgentToolPermissionProfile {
    if let Some(profile) = permission_profile_from_marker(request) {
        return profile;
    }
    let lower = request.to_lowercase();
    let wants_write_memory = contains_any(
        &lower,
        &[
            "запомни",
            "сохрани в память",
            "добавь в память",
            "проиндексируй",
            "индексируй",
            "index",
            "remember",
            "save memory",
        ],
    );
    let wants_command = contains_any(
        &lower,
        &[
            "запусти",
            "выполни команд",
            "команд",
            "проверь сбор",
            "прогони",
            "тест",
            "build",
            "check",
            "run",
            "command",
            "cargo",
            "npm",
        ],
    );
    match (wants_write_memory, wants_command) {
        (true, true) => AgentToolPermissionProfile::WorkspaceWrite,
        (true, false) => AgentToolPermissionProfile::MemoryWrite,
        (false, true) => AgentToolPermissionProfile::CommandRunner,
        (false, false) => AgentToolPermissionProfile::ReadOnly,
    }
}

fn permission_profile_from_marker(request: &str) -> Option<AgentToolPermissionProfile> {
    let marker = request
        .split("<!-- ino-agent:mode=")
        .nth(1)?
        .split("-->")
        .next()?
        .trim();
    match marker {
        "read" => Some(AgentToolPermissionProfile::ReadOnly),
        "memory" => Some(AgentToolPermissionProfile::MemoryWrite),
        "command" => Some(AgentToolPermissionProfile::CommandRunner),
        "workspace" => Some(AgentToolPermissionProfile::WorkspaceWrite),
        _ => None,
    }
}

pub fn permission_profile_summary(profile: AgentToolPermissionProfile) -> String {
    let tools = [
        (
            "search_memory",
            "semantic recall over long-term memory and indexed knowledge. Args: query string, optional limit number.",
        ),
        (
            "add_memory",
            "save important long-term memory. Args: description string, target string, optional title, source_type, tags array, importance 0-10, memory_kind, confidence 0-1, stability.",
        ),
        (
            "list_files",
            "list files inside workspace. Args: path string, optional limit number.",
        ),
        (
            "read_file",
            "read one text file inside workspace. Args: path string, optional maxBytes number.",
        ),
        (
            "run_command",
            "run a safe command inside workspace without shell. Args: command string, optional cwd string, timeoutMs number.",
        ),
        (
            "open_target",
            "resolve a saved memory target into an openable chat/url/file descriptor. Args: target string.",
        ),
        (
            "index_path",
            "index one supported file or a workspace directory into knowledge chunks. Args: path string, optional limitFiles and limitChunks numbers.",
        ),
        (
            "self_review",
            "ask a separate critic pass to review the agent's reasoning. Args: mode \"full_history\" or \"isolated\", optional question string.",
        ),
    ];
    let allowed = tools
        .iter()
        .filter(|(tool, _)| profile.allows(tool))
        .map(|(tool, description)| format!("- {tool}: {description}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Permission profile: {}\nAllowed tools for this turn:\n{}",
        profile.name(),
        allowed
    )
}

pub fn resolve_target(workspace_root: &Path, target: &str) -> Result<Value, String> {
    open_target(workspace_root, &json!({ "target": target }))
}

pub fn execute_tool(
    store: Option<&mut Store>,
    workspace_root: &Path,
    profile: AgentToolPermissionProfile,
    call: AgentToolCall,
) -> AgentToolResult {
    if !profile.allows(&call.tool) {
        return AgentToolResult {
            tool: call.tool,
            ok: false,
            content: json!({
                "error": "Tool is not allowed by the current permission profile.",
                "permissionProfile": profile.name(),
            }),
        };
    }
    let result = match call.tool.as_str() {
        "search_memory" => {
            let Some(store) = store else {
                return missing_store_result(call);
            };
            search_memory(store, &call.args)
        }
        "add_memory" => {
            let Some(store) = store else {
                return missing_store_result(call);
            };
            add_memory(store, &call.args)
        }
        "list_files" => list_files(workspace_root, &call.args),
        "read_file" => read_file(workspace_root, &call.args),
        "run_command" => run_command(workspace_root, &call.args),
        "open_target" => open_target(workspace_root, &call.args),
        "index_path" => {
            let Some(store) = store else {
                return missing_store_result(call);
            };
            index_path(store, workspace_root, &call.args)
        }
        other => Err(format!("Unknown tool: {other}")),
    };
    match result {
        Ok(content) => AgentToolResult {
            tool: call.tool,
            ok: true,
            content,
        },
        Err(error) => AgentToolResult {
            tool: call.tool,
            ok: false,
            content: json!({ "error": error }),
        },
    }
}

fn missing_store_result(call: AgentToolCall) -> AgentToolResult {
    AgentToolResult {
        tool: call.tool,
        ok: false,
        content: json!({ "error": "Tool requires store access." }),
    }
}

pub fn workspace_root() -> Result<PathBuf, String> {
    let current = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    for candidate in current.ancestors() {
        if candidate.join("package.json").is_file()
            && candidate.join("src-tauri").join("Cargo.toml").is_file()
        {
            return Ok(candidate.to_path_buf());
        }
    }
    Ok(current)
}

fn index_path(store: &mut Store, workspace_root: &Path, args: &Value) -> Result<Value, String> {
    let path = string_arg(args, "path")?;
    let limit_files = args
        .get("limitFiles")
        .or_else(|| args.get("limit_files"))
        .and_then(Value::as_u64)
        .unwrap_or(24)
        .clamp(1, MAX_INDEX_FILES as u64) as usize;
    let limit_chunks = args
        .get("limitChunks")
        .or_else(|| args.get("limit_chunks"))
        .and_then(Value::as_u64)
        .unwrap_or(80)
        .clamp(1, MAX_INDEX_CHUNKS as u64) as usize;
    index_workspace_path(store, workspace_root, &path, limit_files, limit_chunks)
}

pub fn index_workspace_path(
    store: &mut Store,
    workspace_root: &Path,
    path: &str,
    limit_files: usize,
    limit_chunks: usize,
) -> Result<Value, String> {
    let root = resolve_workspace_path(workspace_root, &path)?;
    let files = collect_indexable_files(&root, limit_files)?;
    let mut indexed_files = 0_usize;
    let mut indexed_chunks = 0_usize;
    let mut unchanged_files = 0_usize;
    let mut skipped = Vec::new();
    let mut chunks_out = Vec::new();

    for file in files {
        if indexed_chunks >= limit_chunks {
            break;
        }
        let metadata = fs::metadata(&file).map_err(|e| e.to_string())?;
        let relative = display_workspace_path(workspace_root, &file);
        if metadata.len() as usize > MAX_INDEX_FILE_BYTES && !is_image_file(&file) {
            skipped.push(json!({
                "path": relative,
                "reason": "file too large",
                "bytes": metadata.len(),
            }));
            continue;
        }
        let source_fingerprint = source_fingerprint(&relative, &metadata);
        let source_type = infer_source_type_for_path(&file);
        let source_title = file
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(relative.as_str())
            .to_string();
        let (source, needs_index) = store.prepare_knowledge_source(KnowledgeSourceInput {
            path: relative.clone(),
            title: source_title,
            source_type: source_type.clone(),
            fingerprint: source_fingerprint.clone(),
            bytes: metadata.len() as i64,
            modified_at: modified_at_secs(&metadata),
        })?;
        if !needs_index {
            unchanged_files += 1;
            continue;
        }
        let text = match read_index_text(&file) {
            Ok(text) if !text.trim().is_empty() => text,
            Ok(_) => {
                skipped.push(json!({
                    "path": relative,
                    "reason": "empty text",
                }));
                continue;
            }
            Err(error) => {
                skipped.push(json!({
                    "path": relative,
                    "reason": error,
                }));
                continue;
            }
        };
        indexed_files += 1;
        let chunks = chunk_index_text(&text);
        for (chunk_index, chunk) in chunks.into_iter().enumerate() {
            if indexed_chunks >= limit_chunks {
                break;
            }
            let chunk_fingerprint =
                chunk_fingerprint(&source_fingerprint, chunk_index, &chunk.text);
            let target = format!("{relative}#chunk={}", chunk_index + 1);
            let stored = store.add_knowledge_chunk(KnowledgeChunkInput {
                source_id: source.id.clone(),
                chunk_index: chunk_index as i64,
                text: chunk.text,
                target: format!("{relative}#chunk={}", chunk_index + 1),
                page: None,
                start_offset: chunk.start_offset as i64,
                end_offset: chunk.end_offset as i64,
                fingerprint: chunk_fingerprint,
            })?;
            indexed_chunks += 1;
            chunks_out.push(json!({
                "id": stored.id,
                "sourceId": source.id,
                "path": relative,
                "target": target,
                "startOffset": stored.start_offset,
                "endOffset": stored.end_offset,
            }));
        }
    }

    Ok(json!({
        "path": display_workspace_path(workspace_root, &root),
        "indexedFiles": indexed_files,
        "indexedChunks": indexed_chunks,
        "unchangedFiles": unchanged_files,
        "chunks": chunks_out,
        "skipped": skipped,
    }))
}

fn search_memory(store: &Store, args: &Value) -> Result<Value, String> {
    let query = string_arg(args, "query")?;
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(8)
        .clamp(1, 20) as usize;
    let memories = store.search_memory(&query, limit)?;
    let knowledge = store.search_knowledge(&query, limit)?;
    Ok(json!({
        "memoryResults": memories,
        "knowledgeResults": knowledge,
    }))
}

fn add_memory(store: &mut Store, args: &Value) -> Result<Value, String> {
    let description = string_arg(args, "description")?;
    let target = string_arg(args, "target")?;
    let tags = args.get("tags").and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect::<Vec<_>>()
    });
    let input = MemoryInput {
        title: optional_string_arg(args, "title"),
        description,
        target,
        source_type: optional_string_arg(args, "source_type")
            .or_else(|| optional_string_arg(args, "sourceType")),
        tags,
        importance: args.get("importance").and_then(Value::as_f64),
        memory_kind: optional_string_arg(args, "memory_kind")
            .or_else(|| optional_string_arg(args, "memoryKind")),
        confidence: args.get("confidence").and_then(Value::as_f64),
        stability: optional_string_arg(args, "stability"),
    };
    let item = store.add_memory(input)?;
    serde_json::to_value(item).map_err(|e| e.to_string())
}

fn list_files(workspace_root: &Path, args: &Value) -> Result<Value, String> {
    let path = optional_string_arg(args, "path").unwrap_or_else(|| ".".to_string());
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(80)
        .clamp(1, 200) as usize;
    let dir = resolve_workspace_path(workspace_root, &path)?;
    if !dir.is_dir() {
        return Err("Path is not a directory.".to_string());
    }
    let mut entries = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok();
            json!({
                "name": entry.file_name().to_string_lossy(),
                "path": display_workspace_path(workspace_root, &path),
                "kind": if metadata.as_ref().is_some_and(|m| m.is_dir()) { "dir" } else { "file" },
                "bytes": metadata.filter(|m| m.is_file()).map(|m| m.len()),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| {
        a.get("path")
            .and_then(Value::as_str)
            .cmp(&b.get("path").and_then(Value::as_str))
    });
    entries.truncate(limit);
    Ok(json!({ "entries": entries }))
}

fn read_file(workspace_root: &Path, args: &Value) -> Result<Value, String> {
    let path = string_arg(args, "path")?;
    let max_bytes = args
        .get("maxBytes")
        .or_else(|| args.get("max_bytes"))
        .and_then(Value::as_u64)
        .unwrap_or(MAX_FILE_BYTES as u64)
        .clamp(1, MAX_FILE_BYTES as u64) as usize;
    let file_path = resolve_workspace_path(workspace_root, &path)?;
    if !file_path.is_file() {
        return Err("Path is not a file.".to_string());
    }
    let bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let truncated = bytes.len() > max_bytes;
    let slice = &bytes[..bytes.len().min(max_bytes)];
    let content = String::from_utf8_lossy(slice).to_string();
    Ok(json!({
        "path": display_workspace_path(workspace_root, &file_path),
        "bytes": bytes.len(),
        "truncated": truncated,
        "content": content,
    }))
}

fn run_command(workspace_root: &Path, args: &Value) -> Result<Value, String> {
    let command = string_arg(args, "command")?;
    validate_command_text(&command)?;
    let parts = split_command(&command)?;
    if parts.is_empty() {
        return Err("Command is empty.".to_string());
    }
    validate_program(&parts)?;
    let cwd = optional_string_arg(args, "cwd").unwrap_or_else(|| ".".to_string());
    let cwd = resolve_workspace_path(workspace_root, &cwd)?;
    if !cwd.is_dir() {
        return Err("cwd is not a directory.".to_string());
    }
    let timeout_ms = args
        .get("timeoutMs")
        .or_else(|| args.get("timeout_ms"))
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_COMMAND_TIMEOUT_MS)
        .clamp(1, MAX_COMMAND_TIMEOUT_MS);

    let mut child = Command::new(&parts[0])
        .args(&parts[1..])
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start command: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_handle = stdout.map(read_limited_pipe);
    let stderr_handle = stderr.map(read_limited_pipe);
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(status);
        }
        if started.elapsed() >= Duration::from_millis(timeout_ms) {
            timed_out = true;
            let _ = child.kill();
            break child.wait().ok();
        }
        thread::sleep(Duration::from_millis(25));
    };

    let stdout = stdout_handle
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = stderr_handle
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();
    Ok(json!({
        "command": command,
        "cwd": display_workspace_path(workspace_root, &cwd),
        "exitCode": status.and_then(|s| s.code()),
        "success": status.is_some_and(|s| s.success()) && !timed_out,
        "timedOut": timed_out,
        "durationMs": started.elapsed().as_millis(),
        "stdout": stdout,
        "stderr": stderr,
    }))
}

fn open_target(workspace_root: &Path, args: &Value) -> Result<Value, String> {
    let target = string_arg(args, "target")?;
    if let Some(rest) = target.strip_prefix("chat://tree/") {
        let mut parts = rest.split("/node/");
        let tree_id = parts.next().unwrap_or_default();
        let node_part = parts.next().unwrap_or_default();
        let (node_id, message_id) = node_part
            .split_once("/message/")
            .map(|(node_id, message_id)| (node_id, Some(message_id)))
            .unwrap_or((node_part, None));
        if !tree_id.is_empty() && !node_id.is_empty() {
            return Ok(json!({
                "kind": "chat",
                "target": target,
                "treeId": tree_id,
                "nodeId": node_id,
                "messageId": message_id,
                "openable": true,
            }));
        }
    }
    if target.starts_with("http://") || target.starts_with("https://") {
        return Ok(json!({
            "kind": "url",
            "target": target,
            "openable": true,
        }));
    }
    let path_part = target.split('#').next().unwrap_or(&target);
    let resolved = resolve_workspace_path(workspace_root, path_part)?;
    Ok(json!({
        "kind": if resolved.is_dir() { "directory" } else { "file" },
        "target": target,
        "path": display_workspace_path(workspace_root, &resolved),
        "absolutePath": resolved.display().to_string(),
        "exists": true,
        "openable": true,
    }))
}

fn read_limited_pipe<R: Read + Send + 'static>(mut reader: R) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut output = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let remaining = MAX_COMMAND_OUTPUT_BYTES.saturating_sub(output.len());
                    if remaining == 0 {
                        break;
                    }
                    output.extend_from_slice(&buffer[..count.min(remaining)]);
                }
            }
        }
        String::from_utf8_lossy(&output).to_string()
    })
}

fn resolve_workspace_path(workspace_root: &Path, raw: &str) -> Result<PathBuf, String> {
    let raw_path = Path::new(raw);
    let candidate = if raw_path.is_absolute() {
        raw_path.to_path_buf()
    } else {
        workspace_root.join(raw_path)
    };
    let canonical = candidate.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(workspace_root) {
        return Err("Path is outside the workspace.".to_string());
    }
    Ok(canonical)
}

fn collect_indexable_files(root: &Path, limit: usize) -> Result<Vec<PathBuf>, String> {
    if root.is_file() {
        return Ok(if is_indexable_file(root) {
            vec![root.to_path_buf()]
        } else {
            Vec::new()
        });
    }
    if !root.is_dir() {
        return Err("Path is neither a file nor a directory.".to_string());
    }
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if files.len() >= limit {
            break;
        }
        let mut entries = fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.path());
        for entry in entries {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if should_skip_index_entry(&name) {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else if is_indexable_file(&path) {
                files.push(path);
                if files.len() >= limit {
                    break;
                }
            }
        }
    }
    Ok(files)
}

fn should_skip_index_entry(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".turbo"
    )
}

fn is_indexable_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_lowercase().as_str(),
                "md" | "markdown"
                    | "txt"
                    | "rs"
                    | "ts"
                    | "tsx"
                    | "js"
                    | "jsx"
                    | "py"
                    | "json"
                    | "toml"
                    | "yaml"
                    | "yml"
                    | "css"
                    | "html"
                    | "cpp"
                    | "hpp"
                    | "h"
                    | "pdf"
                    | "png"
                    | "jpg"
                    | "jpeg"
                    | "webp"
                    | "gif"
            )
        })
        .unwrap_or(false)
}

fn read_index_text(path: &Path) -> Result<String, String> {
    if is_image_file(path) {
        return read_image_index_text(path);
    }
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return pdf_extract::extract_text(path)
            .map_err(|e| format!("PDF text extraction failed: {e}"));
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn read_image_index_text(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(file_name);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let mut parts = vec![
        format!("Image file: {file_name}"),
        format!("Image title tokens: {}", readable_path_tokens(stem)),
        format!("Image extension: {extension}"),
        format!("Image size bytes: {}", metadata.len()),
        format!("Image path: {}", path.display()),
    ];
    if let Ok(bytes) = fs::read(path) {
        if let Some((width, height)) = image_dimensions(&bytes) {
            parts.push(format!("Image dimensions: {width}x{height}"));
            parts.push(format!("Image width: {width}"));
            parts.push(format!("Image height: {height}"));
            parts.push(format!(
                "Image orientation: {}",
                if width > height {
                    "landscape"
                } else if height > width {
                    "portrait"
                } else {
                    "square"
                }
            ));
        }
    }
    for sidecar in image_sidecar_paths(path) {
        if sidecar.is_file() {
            let text = fs::read_to_string(&sidecar).unwrap_or_default();
            if !text.trim().is_empty() {
                parts.push(format!(
                    "Sidecar description from {}:\n{}",
                    sidecar
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("sidecar"),
                    text.trim()
                ));
            }
        }
    }
    Ok(parts.join("\n"))
}

fn chunk_index_text(text: &str) -> Vec<IndexedTextChunk> {
    let chars = text.chars().collect::<Vec<_>>();
    if chars.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let end = (start + INDEX_CHUNK_CHARS).min(chars.len());
        let chunk = chars[start..end]
            .iter()
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !chunk.is_empty() {
            chunks.push(IndexedTextChunk {
                text: chunk,
                start_offset: start,
                end_offset: end,
            });
        }
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(INDEX_CHUNK_OVERLAP_CHARS);
    }
    chunks
}

fn source_fingerprint(path: &str, metadata: &fs::Metadata) -> String {
    let mut hasher = DefaultHasher::new();
    "knowledge-source-v1".hash(&mut hasher);
    path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified_at_secs(metadata).hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn chunk_fingerprint(source_fingerprint: &str, chunk_index: usize, text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    "knowledge-chunk-v1".hash(&mut hasher);
    source_fingerprint.hash(&mut hasher);
    chunk_index.hash(&mut hasher);
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn modified_at_secs(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

fn infer_source_type_for_path(path: &Path) -> String {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("pdf") => "pdf".to_string(),
        Some(extension)
            if matches!(
                extension.to_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif"
            ) =>
        {
            "image".to_string()
        }
        Some(extension)
            if matches!(
                extension.to_lowercase().as_str(),
                "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "cpp" | "hpp" | "h"
            ) =>
        {
            "code".to_string()
        }
        _ => "file".to_string(),
    }
}

fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif"
            )
        })
}

fn image_sidecar_paths(path: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    paths.push(path.with_extension(format!(
        "{}.txt",
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("image")
    )));
    paths.push(path.with_extension("txt"));
    paths.push(path.with_extension("md"));
    paths
}

fn readable_path_tokens(value: &str) -> String {
    value
        .replace(['_', '-', '.', '+'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    png_dimensions(bytes)
        .or_else(|| gif_dimensions(bytes))
        .or_else(|| jpeg_dimensions(bytes))
        .or_else(|| webp_dimensions(bytes))
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return None;
    }
    Some((
        u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]),
        u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]),
    ))
}

fn gif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 10 || (!bytes.starts_with(b"GIF87a") && !bytes.starts_with(b"GIF89a")) {
        return None;
    }
    Some((
        u16::from_le_bytes([bytes[6], bytes[7]]) as u32,
        u16::from_le_bytes([bytes[8], bytes[9]]) as u32,
    ))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }
    let mut offset = 2usize;
    while offset + 9 < bytes.len() {
        if bytes[offset] != 0xff {
            offset += 1;
            continue;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        if offset >= bytes.len() {
            break;
        }
        let marker = bytes[offset];
        offset += 1;
        if matches!(marker, 0xd8 | 0xd9 | 0x01) {
            continue;
        }
        if offset + 2 > bytes.len() {
            break;
        }
        let segment_len = u16::from_be_bytes([bytes[offset], bytes[offset + 1]]) as usize;
        if segment_len < 2 || offset + segment_len > bytes.len() {
            break;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            if offset + 7 > bytes.len() {
                break;
            }
            let height = u16::from_be_bytes([bytes[offset + 3], bytes[offset + 4]]) as u32;
            let width = u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]) as u32;
            return Some((width, height));
        }
        offset += segment_len;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 30 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let chunk = &bytes[12..16];
    match chunk {
        b"VP8 " if bytes.len() >= 30 => {
            if bytes[23] != 0x9d || bytes[24] != 0x01 || bytes[25] != 0x2a {
                return None;
            }
            let width = u16::from_le_bytes([bytes[26], bytes[27]]) as u32 & 0x3fff;
            let height = u16::from_le_bytes([bytes[28], bytes[29]]) as u32 & 0x3fff;
            Some((width, height))
        }
        b"VP8L" if bytes.len() >= 25 => {
            if bytes[20] != 0x2f {
                return None;
            }
            let b0 = bytes[21] as u32;
            let b1 = bytes[22] as u32;
            let b2 = bytes[23] as u32;
            let b3 = bytes[24] as u32;
            let width = 1 + (((b1 & 0x3f) << 8) | b0);
            let height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
            Some((width, height))
        }
        b"VP8X" if bytes.len() >= 30 => {
            let width = 1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]);
            let height = 1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]);
            Some((width, height))
        }
        _ => None,
    }
}

fn display_workspace_path(workspace_root: &Path, path: &Path) -> String {
    path.strip_prefix(workspace_root)
        .map(|relative| {
            if relative.as_os_str().is_empty() {
                ".".to_string()
            } else {
                relative.display().to_string()
            }
        })
        .unwrap_or_else(|_| path.display().to_string())
}

fn string_arg(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("Missing string arg: {key}"))
}

fn optional_string_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn validate_command_text(command: &str) -> Result<(), String> {
    if command.chars().count() > 600 {
        return Err("Command is too long.".to_string());
    }
    if command
        .chars()
        .any(|ch| matches!(ch, '|' | ';' | '&' | '>' | '<' | '`' | '$'))
    {
        return Err("Shell operators and substitutions are not allowed.".to_string());
    }
    Ok(())
}

fn validate_program(parts: &[String]) -> Result<(), String> {
    let program = parts[0].as_str();
    let denied = [
        "sudo",
        "su",
        "rm",
        "rmdir",
        "mv",
        "cp",
        "chmod",
        "chown",
        "dd",
        "mkfs",
        "kill",
        "killall",
        "shutdown",
        "reboot",
        "osascript",
    ];
    if denied.contains(&program) {
        return Err(format!("Command `{program}` is not allowed in agent mode."));
    }
    if program == "git" {
        let subcommand = parts.get(1).map(String::as_str).unwrap_or("");
        let allowed = ["status", "diff", "show", "log", "branch", "rev-parse"];
        if !allowed.contains(&subcommand) {
            return Err(format!("git {subcommand} is not allowed in agent mode."));
        }
    }
    Ok(())
}

fn split_command(command: &str) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in command.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(ch);
    }
    if quote.is_some() {
        return Err("Unclosed quote in command.".to_string());
    }
    if escaped {
        current.push('\\');
    }
    if !current.is_empty() {
        parts.push(current);
    }
    Ok(parts)
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}
