use crate::store::{BranchPlan, BranchPlanItem, ChatContextMessage, ChatSettings};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::thread;

const DEFAULT_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";

pub fn chat_completion(
    settings: &ChatSettings,
    messages: &[ChatContextMessage],
) -> Result<String, String> {
    ensure_settings(settings)?;
    let payload = request_payload(settings, messages, false);
    let mut child = curl_command(settings, false)
        .arg("--write-out")
        .arg("\n%{http_code}")
        .arg("--data-binary")
        .arg("@-")
        .arg(normalize_endpoint(&settings.endpoint))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start curl: {e}"))?;

    child
        .stdin
        .as_mut()
        .ok_or_else(|| "Failed to open curl stdin.".to_string())?
        .write_all(payload.as_bytes())
        .map_err(|e| e.to_string())?;

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let split = stdout
        .rfind('\n')
        .ok_or_else(|| format!("API response did not include an HTTP status. {stderr}"))?;
    let body = stdout[..split].trim();
    let status = stdout[split + 1..]
        .trim()
        .parse::<u16>()
        .map_err(|e| format!("Could not parse API status: {e}"))?;

    if status >= 400 {
        return Err(format!("API error {status}: {}", clip(body, 1200)));
    }
    if !output.status.success() && !stderr.is_empty() {
        return Err(stderr);
    }

    let parsed = serde_json::from_str::<Value>(body).map_err(|e| {
        format!(
            "Could not parse API response: {e}. Body: {}",
            clip(body, 800)
        )
    })?;
    let content = extract_choice_content(&parsed, false).trim().to_string();
    if content.is_empty() {
        return Err("The model returned an empty answer.".to_string());
    }
    Ok(content)
}

pub fn chat_completion_stream<F>(
    settings: &ChatSettings,
    messages: &[ChatContextMessage],
    mut on_delta: F,
) -> Result<String, String>
where
    F: FnMut(String),
{
    ensure_settings(settings)?;
    let payload = request_payload(settings, messages, true);
    let mut child = curl_command(settings, true)
        .arg("--data-binary")
        .arg("@-")
        .arg(normalize_endpoint(&settings.endpoint))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start curl: {e}"))?;

    child
        .stdin
        .as_mut()
        .ok_or_else(|| "Failed to open curl stdin.".to_string())?
        .write_all(payload.as_bytes())
        .map_err(|e| e.to_string())?;
    drop(child.stdin.take());

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open curl stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open curl stderr.".to_string())?;
    let stderr_handle = thread::spawn(move || {
        let mut stderr_text = String::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_string(&mut stderr_text);
        stderr_text
    });

    let mut answer = String::new();
    let mut error_lines = Vec::new();
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| e.to_string())?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if !line.starts_with("data:") {
            error_lines.push(line.to_string());
            continue;
        }

        let data = line.trim_start_matches("data:").trim();
        if data == "[DONE]" {
            break;
        }

        let Ok(parsed) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        let delta = extract_choice_content(&parsed, true);
        if delta.is_empty() {
            continue;
        }
        answer.push_str(&delta);
        on_delta(delta);
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    let stderr = stderr_handle.join().unwrap_or_default().trim().to_string();
    let answer = answer.trim().to_string();

    if !status.success() && answer.is_empty() {
        let body = error_lines.join("\n");
        if !body.trim().is_empty() {
            return Err(format!("API error: {}", clip(&body, 1200)));
        }
        if !stderr.is_empty() {
            return Err(stderr);
        }
        return Err(format!("curl exited with status {status}"));
    }
    if answer.is_empty() {
        return Err("The model returned an empty answer.".to_string());
    }
    Ok(answer)
}

pub fn parse_branch_plan(answer: &str, limit: usize) -> Option<BranchPlan> {
    let limit = limit.clamp(2, 8);
    for candidate in json_candidates(answer) {
        let Ok(parsed) = serde_json::from_str::<Value>(&candidate) else {
            continue;
        };
        let Some(object) = parsed.as_object() else {
            continue;
        };
        if !object
            .get("should_branch")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return None;
        }

        let source = ["branches", "children", "nodes", "items"]
            .iter()
            .find_map(|key| object.get(*key))
            .and_then(Value::as_array)?;

        let mut branches = Vec::new();
        let mut seen = HashSet::new();
        for item in source {
            let mut title = None;
            let mut context = String::new();
            if let Some(raw) = item.as_str() {
                title = clean_title_from_value(raw);
            } else if let Some(item_object) = item.as_object() {
                if let Some(raw_title) = branch_text_field(item, &["title", "name", "label"]) {
                    title = clean_title_from_value(&raw_title);
                }
                context = branch_text_field(
                    item,
                    &["context", "description", "summary", "focus", "purpose"],
                )
                .unwrap_or_default();
                if context.is_empty() {
                    context = item_object
                        .get("content")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                }
            }

            let Some(title) = title else {
                continue;
            };
            let lower = title.to_lowercase();
            if !seen.insert(lower) {
                continue;
            }
            if context.is_empty() {
                context = format!("Эта ветка выделена для отдельного рассмотрения темы: {title}.");
            }
            branches.push(BranchPlanItem { title, context });
            if branches.len() >= limit {
                break;
            }
        }

        if branches.len() < 2 {
            return None;
        }
        let question = object
            .get("question")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                let names = branches
                    .iter()
                    .map(|branch| branch.title.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "Похоже, это лучше разложить по отдельным веткам: {names}. Создать отдельные ветки под каждое направление?"
                )
            });
        return Some(BranchPlan { question, branches });
    }
    None
}

fn ensure_settings(settings: &ChatSettings) -> Result<(), String> {
    if settings.api_key.trim().is_empty() {
        return Err("API key is empty. Open chat settings and add your key.".to_string());
    }
    if settings.model.trim().is_empty() {
        return Err("Model is empty. Open chat settings and choose a model.".to_string());
    }
    Ok(())
}

fn request_payload(
    settings: &ChatSettings,
    messages: &[ChatContextMessage],
    stream: bool,
) -> String {
    let messages = messages
        .iter()
        .map(|message| json!({ "role": message.role, "content": message.content }))
        .collect::<Vec<_>>();
    json!({
        "model": settings.model,
        "messages": messages,
        "temperature": 0.7,
        "stream": stream,
    })
    .to_string()
}

fn curl_command(settings: &ChatSettings, stream: bool) -> Command {
    let mut command = Command::new("curl");
    command
        .arg("--silent")
        .arg("--show-error")
        .arg("--fail-with-body");
    if stream {
        command.arg("--no-buffer");
    }
    command
        .arg("--location")
        .arg("--max-time")
        .arg("120")
        .arg("--connect-timeout")
        .arg("20")
        .arg("--header")
        .arg("Content-Type: application/json")
        .arg("--header")
        .arg(format!("Authorization: Bearer {}", settings.api_key.trim()));
    command
}

fn normalize_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return DEFAULT_ENDPOINT.to_string();
    }
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn extract_choice_content(data: &Value, stream_delta: bool) -> String {
    let Some(choice) = data
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
    else {
        return String::new();
    };
    let message = if stream_delta {
        choice.get("delta").or_else(|| choice.get("message"))
    } else {
        choice.get("message")
    };
    message
        .and_then(|message| message.get("content"))
        .map(extract_text_from_content)
        .unwrap_or_default()
}

fn extract_text_from_content(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    let Some(parts) = content.as_array() else {
        return String::new();
    };
    parts
        .iter()
        .filter_map(|part| {
            if let Some(text) = part.as_str() {
                return Some(text.to_string());
            }
            part.get("text")
                .or_else(|| part.get("content"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>()
        .join("")
}

fn json_candidates(answer: &str) -> Vec<String> {
    let trimmed = answer.trim().to_string();
    let mut out = vec![trimmed.clone()];

    for prefix in ["```json", "```"] {
        if let Some(stripped) = trimmed.strip_prefix(prefix) {
            let stripped = stripped
                .strip_suffix("```")
                .unwrap_or(stripped)
                .trim()
                .to_string();
            out.push(stripped);
        }
    }

    if let (Some(start), Some(end)) = (trimmed.find('['), trimmed.rfind(']')) {
        if start < end {
            out.push(trimmed[start..=end].to_string());
        }
    }
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            out.push(trimmed[start..=end].to_string());
        }
    }
    out
}

fn clean_title_from_value(value: &str) -> Option<String> {
    let mut title = value.trim().to_string();
    title = title
        .trim_start_matches(|ch: char| {
            ch.is_ascii_digit()
                || ch.is_whitespace()
                || matches!(ch, '.' | ')' | '(' | '-' | '*' | '|' | ':' | ';')
        })
        .trim()
        .to_string();
    title = title
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`'))
        .trim()
        .to_string();
    let title = title.chars().take(96).collect::<String>();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn branch_text_field(item: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        item.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn clip(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}
