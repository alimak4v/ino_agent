use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_MS: u64 = 12_000;
const MAX_TIMEOUT_MS: u64 = 60_000;
const MAX_OUTPUT_LENGTH: usize = 100_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandRequest {
    pub command: String,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
    pub approved: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandSafety {
    pub command: String,
    pub cwd: String,
    pub requires_approval: bool,
    pub reasons: Vec<String>,
    pub blocked: bool,
    pub block_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandResult {
    pub command: String,
    pub cwd: String,
    pub approved: bool,
    pub safety: TerminalCommandSafety,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub timed_out: bool,
    pub diagnosis: String,
}

pub fn assess_command(
    workspace_root: &Path,
    request: &TerminalCommandRequest,
) -> Result<TerminalCommandSafety, String> {
    let command = clean_command(&request.command)?;
    validate_command_text(&command)?;
    let parts = split_command(&command)?;
    if parts.is_empty() {
        return Err("Command is empty.".to_string());
    }
    let cwd = resolve_workspace_path(
        workspace_root,
        request.cwd.as_deref().unwrap_or(".").trim(),
        true,
    )?;
    let mut reasons = Vec::new();
    let program = parts[0].as_str();

    if is_destructive_program(program) {
        reasons.push("delete/overwrite-capable command".to_string());
    }
    if is_install_command(&parts) {
        reasons.push("dependency install".to_string());
    }
    if is_network_command(&parts) {
        reasons.push("network operation".to_string());
    }
    if program == "git" && parts.get(1).is_some_and(|arg| arg == "push") {
        reasons.push("git push".to_string());
    }
    if !is_known_program(program) {
        reasons.push("unknown binary".to_string());
    }
    if program == "git" && is_mutating_git_command(&parts) {
        reasons.push("git mutation".to_string());
    }

    let block_reason = validate_path_args(workspace_root, &cwd, &parts).err();
    let blocked = block_reason.is_some();
    Ok(TerminalCommandSafety {
        command,
        cwd: display_workspace_path(workspace_root, &cwd),
        requires_approval: !reasons.is_empty(),
        reasons,
        blocked,
        block_reason,
    })
}

pub fn run_command(
    workspace_root: &Path,
    request: TerminalCommandRequest,
) -> Result<TerminalCommandResult, String> {
    let safety = assess_command(workspace_root, &request)?;
    if safety.blocked {
        return Err(safety
            .block_reason
            .clone()
            .unwrap_or_else(|| "Command is blocked.".to_string()));
    }
    let approved = request.approved.unwrap_or(false);
    if safety.requires_approval && !approved {
        return Err("Command requires explicit approval.".to_string());
    }
    let parts = split_command(&safety.command)?;
    let cwd = resolve_workspace_path(workspace_root, &safety.cwd, true)?;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1, MAX_TIMEOUT_MS);
    let started = Instant::now();
    let mut child = Command::new(&parts[0])
        .args(&parts[1..])
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start command: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr.".to_string())?;
    let stdout_handle = thread::spawn(move || read_limited(stdout));
    let stderr_handle = thread::spawn(move || read_limited(stderr));
    let timeout = Duration::from_millis(timeout_ms);
    let (exit_code, timed_out) = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break (status.code(), false);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            break (None, true);
        }
        thread::sleep(Duration::from_millis(20));
    };
    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();
    let success = !timed_out && exit_code == Some(0);
    let diagnosis = diagnose(&parts, &stdout, &stderr, timed_out, success);
    Ok(TerminalCommandResult {
        command: safety.command.clone(),
        cwd: safety.cwd.clone(),
        approved,
        safety,
        success,
        stdout,
        stderr,
        exit_code,
        duration_ms: started.elapsed().as_millis(),
        timed_out,
        diagnosis,
    })
}

fn clean_command(command: &str) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("Command is empty.".to_string());
    }
    Ok(command.to_string())
}

fn validate_command_text(command: &str) -> Result<(), String> {
    if command.chars().count() > 800 {
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
        if let Some(active) = quote {
            if ch == active {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
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

fn is_known_program(program: &str) -> bool {
    matches!(
        program,
        "pwd"
            | "ls"
            | "find"
            | "cat"
            | "sed"
            | "head"
            | "tail"
            | "wc"
            | "rg"
            | "grep"
            | "git"
            | "cargo"
            | "npm"
            | "node"
            | "python"
            | "python3"
            | "pytest"
            | "cmake"
            | "ctest"
            | "make"
            | "ninja"
            | "tsc"
            | "npx"
            | "vite"
    )
}

fn is_destructive_program(program: &str) -> bool {
    matches!(
        program,
        "rm" | "rmdir"
            | "mv"
            | "cp"
            | "chmod"
            | "chown"
            | "dd"
            | "truncate"
            | "tee"
            | "touch"
            | "mkdir"
    )
}

fn is_install_command(parts: &[String]) -> bool {
    match parts {
        [program, subcommand, ..] if program == "npm" => {
            matches!(subcommand.as_str(), "install" | "i" | "add")
        }
        [program, flag, subcommand, ..] if program.starts_with("python") && flag == "-m" => {
            subcommand == "pip" && parts.iter().any(|part| part == "install")
        }
        [program, subcommand, ..] if program == "cargo" => subcommand == "install",
        _ => false,
    }
}

fn is_network_command(parts: &[String]) -> bool {
    let program = parts[0].as_str();
    matches!(program, "curl" | "wget" | "ssh" | "scp")
        || (program == "git"
            && parts
                .get(1)
                .is_some_and(|arg| matches!(arg.as_str(), "clone" | "fetch" | "pull" | "push")))
}

fn is_mutating_git_command(parts: &[String]) -> bool {
    if parts.first().map(String::as_str) != Some("git") {
        return false;
    }
    let safe = ["status", "diff", "show", "log", "branch", "rev-parse"];
    !parts
        .get(1)
        .is_some_and(|subcommand| safe.contains(&subcommand.as_str()))
}

fn validate_path_args(workspace_root: &Path, cwd: &Path, parts: &[String]) -> Result<(), String> {
    for arg in parts.iter().skip(1) {
        if arg.starts_with('-') || looks_like_url(arg) || arg.contains('=') {
            continue;
        }
        if arg.contains('*') || arg.contains('?') {
            return Err("Wildcard path arguments are not allowed.".to_string());
        }
        if looks_like_path(arg) {
            let base = if Path::new(arg).is_absolute() {
                PathBuf::new()
            } else {
                cwd.to_path_buf()
            };
            let candidate = base.join(arg);
            let normalized = normalize_candidate_path(&candidate)?;
            if !normalized.starts_with(workspace_root) {
                return Err("Path argument points outside the workspace.".to_string());
            }
        }
    }
    Ok(())
}

fn looks_like_path(arg: &str) -> bool {
    arg.starts_with('.')
        || arg.starts_with('/')
        || arg.contains('/')
        || arg.ends_with(".rs")
        || arg.ends_with(".ts")
        || arg.ends_with(".tsx")
        || arg.ends_with(".js")
        || arg.ends_with(".json")
        || arg.ends_with(".md")
        || arg.ends_with(".toml")
}

fn looks_like_url(arg: &str) -> bool {
    arg.starts_with("http://") || arg.starts_with("https://") || arg.starts_with("git@")
}

fn resolve_workspace_path(
    workspace_root: &Path,
    raw: &str,
    allow_missing: bool,
) -> Result<PathBuf, String> {
    let raw = if raw.trim().is_empty() {
        "."
    } else {
        raw.trim()
    };
    let raw_path = Path::new(raw);
    let candidate = if raw_path.is_absolute() {
        raw_path.to_path_buf()
    } else {
        workspace_root.join(raw_path)
    };
    let normalized = if candidate.exists() {
        candidate.canonicalize().map_err(|e| e.to_string())?
    } else if allow_missing {
        normalize_candidate_path(&candidate)?
    } else {
        return Err("Path does not exist.".to_string());
    };
    if !normalized.starts_with(workspace_root) {
        return Err("Path is outside the workspace.".to_string());
    }
    Ok(normalized)
}

fn normalize_candidate_path(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    Ok(normalized)
}

fn display_workspace_path(workspace_root: &Path, path: &Path) -> String {
    path.strip_prefix(workspace_root)
        .unwrap_or(path)
        .to_string_lossy()
        .trim_start_matches('/')
        .to_string()
}

fn read_limited(mut reader: impl Read) -> String {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let Ok(read) = reader.read(&mut buffer) else {
            break;
        };
        if read == 0 {
            break;
        }
        let remaining = MAX_OUTPUT_LENGTH.saturating_sub(output.len());
        if remaining == 0 {
            truncated = true;
            continue;
        }
        let take = remaining.min(read);
        output.extend_from_slice(&buffer[..take]);
        if take < read {
            truncated = true;
        }
    }
    let mut text = String::from_utf8_lossy(&output).to_string();
    if truncated {
        text.push_str("\n[output truncated]");
    }
    text
}

fn diagnose(
    parts: &[String],
    stdout: &str,
    stderr: &str,
    timed_out: bool,
    success: bool,
) -> String {
    if timed_out {
        return "Command timed out. Long-running dev servers should be stopped or run with a shorter smoke command.".to_string();
    }
    if success {
        return "Command completed successfully.".to_string();
    }
    let combined = format!("{}\n{}", stdout.to_lowercase(), stderr.to_lowercase());
    if combined.contains("command not found") || combined.contains("no such file or directory") {
        return format!(
            "`{}` is missing or a referenced path does not exist. Check dependencies and cwd.",
            parts.first().map(String::as_str).unwrap_or("command")
        );
    }
    if combined.contains("permission denied") {
        return "Permission denied. Check file permissions or avoid executing unknown binaries."
            .to_string();
    }
    if combined.contains("cannot find module")
        || combined.contains("module not found")
        || combined.contains("vite: not found")
    {
        return "Node dependencies are probably missing. Use an explicit approved install step if this is expected.".to_string();
    }
    if combined.contains("failed") || combined.contains("error") {
        return "Command failed. Inspect stderr/stdout and run the smallest relevant repair step."
            .to_string();
    }
    "Command exited with a non-zero status.".to_string()
}
